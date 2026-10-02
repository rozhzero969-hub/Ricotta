/* Custom, non-blocking dialogs. Messages, banners and form bodies are trusted
   HTML supplied by the app; dynamic values in that HTML must be escaped by
   the caller. Button labels and input attributes are escaped here. */

const modalDialogs = [];
let modalSequence = 0;
let modalAppState = null;
let modalObserver = null;

function ensureModalRoot() {
  let root = document.getElementById('modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    document.body.appendChild(root);
  }
  return root;
}

/* Update notifications sit above a form without discarding its draft. */
function ensureForceRoot() {
  let root = document.getElementById('forceRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'forceRoot';
    document.body.appendChild(root);
  }
  return root;
}

function topModalDialog() {
  const connected = modalDialogs.filter(d => d.overlay.isConnected);
  return connected.filter(d => d.root.id === 'forceRoot').pop() || connected.pop();
}

function modalFocusable(box) {
  return Array.from(box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
    .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length);
}

/* The app's searchable select sheet lives outside the form's overlay. Its
   own keyboard handler takes over until it closes; forced updates stay above it. */
function modalSelectSheetOpen(dialog) {
  return dialog.root.id !== 'forceRoot' && !!document.querySelector('.sel-sheet:not(.out)');
}

function handleModalKey(event) {
  const dialog = topModalDialog();
  if (!dialog || modalSelectSheetOpen(dialog) || event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (dialog.onCancel) dialog.onCancel();
  } else if (event.key === 'Tab') {
    const fields = modalFocusable(dialog.box);
    const first = fields[0], last = fields[fields.length - 1];
    const active = document.activeElement;
    if (!fields.length) {
      event.preventDefault();
      dialog.box.focus({preventScroll: true});
    } else if (!fields.includes(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({preventScroll: true});
    }
  }
}

function handleModalFocus(event) {
  const dialog = topModalDialog();
  if (!dialog || modalSelectSheetOpen(dialog) || dialog.box.contains(event.target)) return;
  (modalFocusable(dialog.box)[0] || dialog.box).focus({preventScroll: true});
}

function syncModalLayers() {
  const top = topModalDialog();
  modalDialogs.forEach(dialog => {
    dialog.overlay.inert = dialog !== top;
    dialog.overlay.setAttribute('aria-hidden', String(dialog !== top));
    dialog.box.setAttribute('aria-modal', String(dialog === top));
  });
  if (top && !modalAppState) {
    const app = document.getElementById('app');
    modalAppState = {app, inert: app ? app.inert : false};
    if (app) app.inert = true;
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleModalKey, true);
    document.addEventListener('focusin', handleModalFocus);
    /* Also release pending dialogs when sign-out removes their DOM. */
    modalObserver = new MutationObserver(() => {
      modalDialogs.slice().filter(d => !d.overlay.isConnected).forEach(d => releaseModalDialog(d, false));
    });
    modalObserver.observe(document.body, {childList: true, subtree: true});
  } else if (!top && modalAppState) {
    if (modalAppState.app) modalAppState.app.inert = modalAppState.inert;
    modalAppState = null;
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleModalKey, true);
    document.removeEventListener('focusin', handleModalFocus);
    modalObserver.disconnect();
    modalObserver = null;
  }
}

function releaseModalDialog(dialog, restore = true) {
  const index = modalDialogs.indexOf(dialog);
  if (index < 0) return;
  /* A lower dialog finishing must not take focus from the one above it. */
  const higher = topModalDialog();
  modalDialogs.splice(index, 1);
  syncModalLayers();
  if (restore && (!higher || higher === dialog)) {
    const original = dialog.previousFocus;
    const previous = original && original.isConnected ? original : original && original.id ? document.getElementById(original.id) : null;
    if (previous && previous !== document.body && previous !== document.documentElement && previous.isConnected && !previous.disabled && !previous.closest('[inert]')) previous.focus({preventScroll: true});
    else {
      const top = topModalDialog();
      if (top) top.box.focus({preventScroll: true});
    }
  }
  dialog.onRemoved();
}

/* Close the specific overlay, never a newer dialog sharing the same root.
   Awaiting callers continue after focus has returned and the exit has finished. */
function closeModal(target) {
  const overlay = target && (target.matches('.modal-overlay') ? target : target.querySelector('.modal-overlay:last-child'));
  if (!overlay) return Promise.resolve();
  if (overlay._closePromise) return overlay._closePromise;
  overlay._closePromise = new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      overlay.removeEventListener('animationend', onEnd);
      const dialog = modalDialogs.find(d => d.overlay === overlay);
      /* Release before removal so the active-dialog check can restore focus. */
      if (dialog) releaseModalDialog(dialog);
      overlay.remove();
      resolve();
    };
    const onEnd = event => { if (event.target.matches('.modal-box') && event.animationName === 'sheetOut') finish(); };
    let timer;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {
      overlay.classList.add('closing');
      overlay.addEventListener('animationend', onEnd);
      timer = setTimeout(finish, 260);
    }
  });
  return overlay._closePromise;
}

/* Called on sign-out, including when a session expires during a save. */
function dismissAllModals() {
  modalDialogs.slice().reverse().forEach(dialog => {
    dialog.overlay.remove();
    releaseModalDialog(dialog, false);
  });
}

function createModal(root, html, {role = 'dialog', cancelValue, onCancel} = {}) {
  if (root.id === 'forceRoot' && typeof closeSelSheet === 'function') closeSelSheet();
  const previousFocus = document.activeElement;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const overlay = holder.firstElementChild;
  const box = overlay.querySelector('.modal-box');
  box.setAttribute('role', role);
  box.tabIndex = -1;
  const title = box.querySelector('.modal-title, .force-title');
  const message = box.querySelector('.modal-msg');
  const label = title || message;
  const prefix = 'dialog' + (++modalSequence);
  if (label && label.textContent.trim()) {
    label.id = prefix + 'Label';
    box.setAttribute('aria-labelledby', label.id);
  } else box.setAttribute('aria-label', t('ok'));
  if (title && message) {
    message.id = prefix + 'Description';
    box.setAttribute('aria-describedby', message.id);
  }

  let settled = false;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const dialog = {root, overlay, box, previousFocus, onCancel, onRemoved: () => {
    if (!settled) { settled = true; resolve(cancelValue); }
  }};
  dialog.finish = async (value, keepVisible = false) => {
    if (settled) return;
    settled = true;
    if (!keepVisible) await closeModal(overlay);
    resolve(value);
  };
  dialog.promise = promise;
  root.appendChild(overlay);
  modalDialogs.push(dialog);
  syncModalLayers();
  /* Only the top popup can receive focus (a forced refresh may already be up). */
  dialog.focus = target => { if (topModalDialog() === dialog) (target || box).focus({preventScroll: true}); };
  dialog.focus();
  return dialog;
}

function showConfirm(message, opts = {}) {
  opts = opts || {};
  const okLabel = opts.okLabel || t('delete');
  const cancelLabel = opts.cancelLabel || t('cancel');
  const okClass = ['btn-danger', 'btn-primary', 'btn-ghost'].includes(opts.okClass) ? opts.okClass : 'btn-danger';
  const dialog = createModal(ensureModalRoot(), `
    <div class="modal-overlay"><div class="modal-box">
      <div class="modal-msg">${message}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modalCancelBtn">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${okClass}" id="modalOkBtn">${esc(okLabel)}</button>
      </div>
    </div></div>`, {role: 'alertdialog', cancelValue: false});
  dialog.onCancel = () => dialog.finish(false);
  dialog.box.querySelector('#modalOkBtn').onclick = () => dialog.finish(true);
  const cancel = dialog.box.querySelector('#modalCancelBtn');
  cancel.onclick = dialog.onCancel;
  dialog.focus(cancel);
  return dialog.promise;
}

function showAlert(message) {
  const dialog = createModal(ensureModalRoot(), `
    <div class="modal-overlay"><div class="modal-box">
      <div class="modal-msg">${message}</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary" id="modalAlertOkBtn">${esc(t('ok'))}</button></div>
    </div></div>`);
  const ok = dialog.box.querySelector('#modalAlertOkBtn');
  ok.onclick = dialog.onCancel = () => dialog.finish();
  dialog.focus(ok);
  return dialog.promise;
}

/* {password:true}: masked numeric PIN; {secret:true}: masked text;
   {plain:true}: no capitalisation, corrections or spellcheck. */
function showPrompt(message, opts = {}) {
  opts = opts || {};
  const attrs = opts.password || opts.secret
    ? `type="password" ${opts.password ? 'inputmode="numeric"' : ''} autocomplete="off"`
    : opts.plain ? 'type="text" autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"' : 'type="text"';
  const length = Number(opts.maxLength);
  const max = Number.isSafeInteger(length) && length > 0 ? `maxlength="${length}"` : '';
  const dialog = createModal(ensureModalRoot(), `
    <div class="modal-overlay"><div class="modal-box">
      <div class="modal-msg">${message}</div>
      <div class="field"><input id="modalPromptInput" ${attrs} ${max} placeholder="${esc(opts.placeholder || '')}" value="${esc(opts.value || '')}"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modalPromptCancelBtn">${esc(opts.cancelLabel || t('cancel'))}</button>
        <button type="button" class="btn btn-primary" id="modalPromptOkBtn">${esc(opts.okLabel || t('save'))}</button>
      </div>
    </div></div>`, {cancelValue: null});
  const input = dialog.box.querySelector('#modalPromptInput');
  input.setAttribute('aria-labelledby', dialog.box.querySelector('.modal-msg').id);
  dialog.onCancel = () => dialog.finish(null);
  dialog.box.querySelector('#modalPromptOkBtn').onclick = () => dialog.finish(input.value.trim());
  dialog.box.querySelector('#modalPromptCancelBtn').onclick = dialog.onCancel;
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
      event.preventDefault();
      dialog.finish(input.value.trim());
    }
  });
  dialog.focus(input);
  return dialog.promise;
}

/* No cancel or outside dismissal: it remains until the caller reloads. */
function showForcedRefresh(title, message, okLabel) {
  const dialog = createModal(ensureForceRoot(), `
    <div class="modal-overlay"><div class="modal-box">
      <div class="force-title">${esc(title)}</div><div class="modal-msg">${message}</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary" id="forceRefreshBtn">${esc(okLabel)}</button></div>
    </div></div>`, {role: 'alertdialog'});
  const button = dialog.box.querySelector('#forceRefreshBtn');
  button.onclick = () => {
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    dialog.finish(true, true);
  };
  dialog.focus(button);
  return dialog.promise;
}

function showUpdatePopup(message, okLabel, laterLabel) {
  const dialog = createModal(ensureForceRoot(), `
    <div class="modal-overlay"><div class="modal-box">
      <div class="modal-msg">${message}</div><div class="modal-actions">
        ${laterLabel ? `<button type="button" class="btn btn-ghost" id="updLaterBtn">${esc(laterLabel)}</button>` : ''}
        <button type="button" class="btn btn-primary" id="updOkBtn">${esc(okLabel)}</button>
      </div>
    </div></div>`, {cancelValue: false});
  const ok = dialog.box.querySelector('#updOkBtn');
  ok.onclick = () => {
    if (laterLabel) {
      dialog.box.querySelectorAll('button').forEach(button => { button.disabled = true; });
      ok.classList.add('is-busy');
      ok.setAttribute('aria-busy', 'true');
    }
    dialog.finish(true, !!laterLabel);
  };
  const later = dialog.box.querySelector('#updLaterBtn');
  dialog.onCancel = () => dialog.finish(false);
  if (later) later.onclick = dialog.onCancel;
  dialog.focus(later || ok);
  return dialog.promise;
}

/* Popup form. onSubmit(again) returns {error}, {keepOpen:true, message},
   or a success value. Only explicit Save or Cancel dismisses a draft. */
function showFormModal(opts) {
  const dialog = createModal(ensureModalRoot(), `
    <div class="modal-overlay modal-overlay-top"><div class="modal-box modal-form">
      <div class="modal-title">${opts.title}</div>
      ${opts.banner ? `<div class="modal-banner">${opts.banner}</div>` : ''}
      <div class="modal-body">${opts.bodyHtml}</div>
      <div class="modal-status" id="modalFormStatus" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></div>
      <div class="modal-actions modal-actions-wrap">
        <button type="button" class="btn btn-ghost" id="modalFormCancel">${esc(opts.cancelLabel || t('cancel'))}</button>
        ${opts.againLabel ? `<button type="button" class="btn btn-ghost" id="modalFormAgain">${esc(opts.againLabel)}</button>` : ''}
        <button type="button" class="btn btn-primary" id="modalFormOk">${esc(opts.okLabel || t('save'))}</button>
      </div>
    </div></div>`);
  const box = dialog.box;
  const status = box.querySelector('#modalFormStatus');
  const ok = box.querySelector('#modalFormOk');
  const againButton = box.querySelector('#modalFormAgain');
  let busy = false;
  const setStatus = (message, kind = '') => {
    status.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    status.textContent = message || '';
    status.className = 'modal-status' + (message ? ' ' + kind : '');
  };
  const close = () => { if (!busy) dialog.finish(); };
  dialog.onCancel = close;

  const submit = async again => {
    if (busy || !dialog.overlay.isConnected || dialog.overlay.classList.contains('closing')) return;
    const action = again && againButton ? againButton : ok;
    if (action.disabled) return;
    busy = true;
    const controls = Array.from(box.querySelectorAll('button, input, select, textarea'));
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    action.classList.add('is-busy');
    action.setAttribute('aria-busy', 'true');
    box.querySelector('.modal-body').setAttribute('aria-busy', 'true');
    setStatus(t('loading'), 'pending');
    let result;
    try { result = await opts.onSubmit(!!again); }
    catch (error) {
      console.error('form submit failed', error);
      result = {error: t('saveFailed')};
    }
    /* Session expiry can remove the form while its request is in flight. */
    if (!dialog.overlay.isConnected) return;
    busy = false;
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    action.classList.remove('is-busy');
    action.removeAttribute('aria-busy');
    box.querySelector('.modal-body').removeAttribute('aria-busy');
    result = result || {};
    if (result.error) {
      setStatus(result.error, 'error');
      dialog.focus(status);
      return;
    }
    if (result.keepOpen) {
      box.querySelectorAll('[data-clear]').forEach(control => { control.value = ''; });
      setStatus(result.message || result.msg, 'ok');
      dialog.focus(box.querySelector('[data-clear]') || ok);
      return;
    }
    close();
  };

  ok.onclick = () => submit(false);
  if (againButton) againButton.onclick = () => submit(true);
  box.querySelector('#modalFormCancel').onclick = close;
  box.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !event.isComposing && !event.repeat) {
      event.preventDefault();
      submit(false);
    }
  });
  /* Many existing fields use a separate label without a for attribute. */
  box.querySelectorAll('.field > label:not([for])').forEach(label => {
    const control = label.parentElement.querySelector('input, select, textarea');
    if (control && !label.contains(control)) {
      if (!control.id) control.id = 'dialogField' + (++modalSequence);
      label.htmlFor = control.id;
    }
  });
  if (opts.onOpen) opts.onOpen(box);
  /* Phones wait for a tap, avoiding an unexpected keyboard on opening. */
  if (matchMedia('(pointer: fine)').matches && document.activeElement === box) {
    dialog.focus(modalFocusable(box).find(control => control.matches('input, select, textarea, .sel-btn')));
  }
  return dialog.promise;
}
