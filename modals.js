/* Custom confirm/alert/prompt dialogs (native confirm()/alert()/prompt()
are blocked inside sandboxed iframe previews). Depends on t() and esc()
from app.js. */

/* ============ Confirm / alert / prompt (custom, non-blocking) ============ */
/* Native confirm()/alert()/prompt() are silently blocked in sandboxed
iframe previews (they just return false/null immediately), which made
confirmations always cancel themselves. These render a small in-page
dialog instead, so they work in any environment. */

function ensureModalRoot() {
  let el = document.getElementById('modalRoot');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modalRoot';
    document.body.appendChild(el);
  }
  return el;
}

/* Lets a dialog slide away before it is removed (instant with reduced motion).
   Returns a promise that resolves once the root is empty again. */
function closeModal(root) {
  const overlay = root && root.querySelector('.modal-overlay');
  if (!overlay || matchMedia('(prefers-reduced-motion: reduce)').matches) { if (root) root.innerHTML = ''; return Promise.resolve(); }
  overlay.classList.add('closing');
  return new Promise(res => setTimeout(() => {
    if (overlay.isConnected) root.innerHTML = '';
    res();
  }, 210));
}
/* Remembers what had focus so closing a dialog returns keyboard users there. */
function rememberFocus() {
  const el = document.activeElement;
  return () => { if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true }); };
}

function showConfirm(message, opts) {
  const okLabel = (opts && opts.okLabel) || t('delete');
  const cancelLabel = (opts && opts.cancelLabel) || t('cancel');
  const okClass = (opts && opts.okClass) || 'btn-danger';
  
  return new Promise(resolve => {
    const root = ensureModalRoot();
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box">
          <div class="modal-msg">${message}</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="modalCancelBtn">${cancelLabel}</button>
            <button class="btn ${okClass}" id="modalOkBtn">${okLabel}</button>
          </div>
        </div>
      </div>`;
      
    const restore = rememberFocus();
    const done = (v) => { closeModal(root).then(restore); resolve(v); };
    const ok = document.getElementById('modalOkBtn');
    ok.onclick = () => done(true);
    document.getElementById('modalCancelBtn').onclick = () => done(false);
    root.querySelector('.modal-box').addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
    ok.focus();
  });
}

function showAlert(message) {
  return new Promise(resolve => {
    const root = ensureModalRoot();
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box">
          <div class="modal-msg">${message}</div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="modalAlertOkBtn">OK</button>
          </div>
        </div>
      </div>`;
      
    const restore = rememberFocus();
    const ok = document.getElementById('modalAlertOkBtn');
    ok.onclick = () => { closeModal(root).then(restore); resolve(); };
    ok.focus();
  });
}

/* Small text input dialog. Resolves with the trimmed string the user typed,
or null if they dismissed/skipped it. Used for the "name this device"
prompt, but generic enough to reuse anywhere a single line of text is
needed. Pass {password:true} for a masked numeric PIN field. */
function showPrompt(message, opts) {
  const okLabel = (opts && opts.okLabel) || t('save');
  const cancelLabel = (opts && opts.cancelLabel) || t('cancel');
  const placeholder = (opts && opts.placeholder) || '';
  const initialValue = (opts && opts.value) || '';
  const inputAttrs = (opts && opts.password) ? 'type="password" inputmode="numeric" autocomplete="off"' : '';
  
  return new Promise(resolve => {
    const root = ensureModalRoot();
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box">
          <div class="modal-msg">${message}</div>
          <div class="field">
            <input id="modalPromptInput" ${inputAttrs} placeholder="${esc(placeholder)}" value="${esc(initialValue)}" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="modalPromptCancelBtn">${cancelLabel}</button>
            <button class="btn btn-primary" id="modalPromptOkBtn">${okLabel}</button>
          </div>
        </div>
      </div>`;
      
    const input = document.getElementById('modalPromptInput');
    input.focus();
    
    const finish = (val) => { 
      closeModal(root);
      resolve(val); 
    };
    
    document.getElementById('modalPromptOkBtn').onclick = () => finish(input.value.trim());
    document.getElementById('modalPromptCancelBtn').onclick = () => finish(null);
    
    input.addEventListener('keydown', e => { 
      if (e.key === 'Enter') finish(input.value.trim());
      if (e.key === 'Escape') finish(null);
    });
  });
}

/* Forced "refresh now" popup, sent by an admin from the Devices tab.
There is deliberately no cancel / close / tap-outside: the only way
forward is the Refresh button. It lives in its own root (#forceRoot),
above every other popup, so it never wipes a half-filled form - it just
sits on top of it until the person taps Refresh. Resolves when tapped
(the caller then reloads the page). */
function ensureForceRoot() {
  let el = document.getElementById('forceRoot');
  if (!el) {
    el = document.createElement('div');
    el.id = 'forceRoot';
    document.body.appendChild(el);
  }
  return el;
}

function showForcedRefresh(title, message, okLabel) {
  return new Promise(resolve => {
    const root = ensureForceRoot();
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box">
          <div class="force-title">${title}</div>
          <div class="modal-msg">${message}</div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="forceRefreshBtn">${okLabel}</button>
          </div>
        </div>
      </div>`;
      
    const btn = document.getElementById('forceRefreshBtn');
    btn.onclick = () => { 
      btn.disabled = true; 
      resolve(); 
    }; /* popup stays up until the caller reloads the page */
  });
}

/* "What's new" popup opened from an update notification (or the update
checker). Uses #forceRoot like the forced refresh, so it sits on top of any
open form without wiping it. The primary button is at the bottom; tapping it
resolves true (the caller reloads). If laterLabel is given, a second button
is shown that resolves false and just closes the popup. */
function showUpdatePopup(title, message, okLabel, laterLabel) {
  return new Promise(resolve => {
    const root = ensureForceRoot();
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box">
          <div class="force-title">${title}</div>
          <div class="modal-msg">${message}</div>
          <div class="modal-actions">
            ${laterLabel ? `<button class="btn btn-ghost" id="updLaterBtn">${laterLabel}</button>` : ''}
            <button class="btn btn-primary" id="updOkBtn">${okLabel}</button>
          </div>
        </div>
      </div>`;
      
    const ok = document.getElementById('updOkBtn');
    ok.onclick = () => {
      if (laterLabel) ok.disabled = true;   /* stays up while the page reloads */
      else closeModal(root);
      resolve(true);
    };
    
    const later = document.getElementById('updLaterBtn');
    if (later) later.onclick = () => { 
      closeModal(root);
      resolve(false); 
    };
  });
}

/* Popup form used for adding / editing suppliers and items.
opts:
  title           heading text (already translated)
  banner          optional HTML shown under the title (what's being edited)
  bodyHtml        the form fields
  okLabel / cancelLabel
  againLabel      optional; adds a "Save & add another" button
  onOpen (box)    optional; called once the popup is on screen
  onSubmit (again)-- async; runs when Save is tapped. Return:
    {error:'text'}          -> shows the error, popup stays open
    {keepOpen: true, msg}   -> shows message, clears the fields that
                               have data-clear, popup stays open
    anything else           -> popup closes
The popup only closes via Save or Cancel (tapping outside does nothing),
so a half-typed form is never lost by accident. Resolves when it closes. */
function showFormModal(opts) {
  const okLabel = opts.okLabel || t('save');
  const cancelLabel = opts.cancelLabel || t('cancel');
  
  return new Promise(resolve => {
    const root = ensureModalRoot();
    root.innerHTML = `
      <div class="modal-overlay modal-overlay-top">
        <div class="modal-box modal-form">
          <div class="modal-title">${opts.title}</div>
          ${opts.banner ? `<div class="modal-banner">${opts.banner}</div>` : ''}
          <div class="modal-body">${opts.bodyHtml}</div>
          <div class="modal-status" id="modalFormStatus"></div>
          <div class="modal-actions modal-actions-wrap">
            <button class="btn btn-ghost" id="modalFormCancel">${cancelLabel}</button>
            ${opts.againLabel ? `<button class="btn btn-ghost" id="modalFormAgain">${opts.againLabel}</button>` : ''}
            <button class="btn btn-primary" id="modalFormOk">${okLabel}</button>
          </div>
        </div>
      </div>`;
      
    const box = root.querySelector('.modal-box');
    const status = document.getElementById('modalFormStatus');
    const buttons = Array.from(box.querySelectorAll('.modal-actions .btn'));
    
    const setStatus = (msg, kind) => {
      status.textContent = msg || '';
      status.className = 'modal-status' + (msg ? ' ' + kind : '');
    };
    
    const close = () => { 
      closeModal(root);
      resolve(); 
    };
    
    let busy = false;
    const submit = async (again) => {
      if (busy) return;
      busy = true;
      buttons.forEach(b => b.disabled = true);
      setStatus('');
      
      let res;
      try { 
        res = await opts.onSubmit(!!again); 
      } catch(e) { 
        console.error('form submit failed', e); 
      res = { error: t('saveFailed') };
      }
      
      busy = false;
      buttons.forEach(b => b.disabled = false);
      res = res || {};
      
      if (res.error) { 
        setStatus(res.error, 'error'); 
        return; 
      }
      
      if (res.keepOpen) {
        box.querySelectorAll('[data-clear]').forEach(el => { el.value = ''; });
        const firstField = box.querySelector('[data-clear]');
        if (firstField) firstField.focus();
        setStatus(res.message, 'ok');
        return;
      }
      
      close();
    };
    
    document.getElementById('modalFormOk').onclick = () => submit(false);
    
    const againBtn = document.getElementById('modalFormAgain');
    if (againBtn) againBtn.onclick = () => submit(true);
    
    document.getElementById('modalFormCancel').onclick = close;
    
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { 
        e.preventDefault(); 
        submit(false); 
      }
      if (e.key === 'Escape') close();
    });
    
    if (opts.onOpen) opts.onOpen(box);
    
    const first = box.querySelector('input, select');
    if (first) first.focus();
  });
}
