/* ============ Offline ============
   Every tab opens with no connection, from the last data this phone saved for this account (storage.js:
   apiCached, offlineKeep), with one calm line at the top: "Offline, showing data from 10:42".
   - Reads: each screen's last answer is kept (IndexedDB) and shown when the server can't be reached.
   - Changes safe to send later (settings, an item's low stock level, recipes and recipe items, which
     carry their version) are kept in the outbox next to orders and go by themselves once the app is
     online again (storage.js: queueChange, flushOutbox). Until then they say "Will be sent when online".
     One the server refuses (another phone changed the recipe meanwhile) stays on this phone with the
     reason, and the person sends theirs anyway or discards it.
   - What needs the server right away (sending to Rico, approving, deletes, Admin, uploads, Check now,
     Check all last prices, sign-in) is grayed out while offline; a tap says why.
   - Back online, everything that was on screen is read again by itself.
   Depends on: state, t, esc, toast, render, refreshBlocked, formatIraqDateTime, erbilDate (app.js) and
   the outbox and copies in storage.js. */

const offlineReads = new Map();   // account|read -> {at, cached}: when the data on screen was read
/* Called for every read that may be shown offline (storage.js and the screens). */
function offlineRead(name, at, cached){
  if(!state.account) return;
  offlineReads.set(state.account + '|' + name, {at:Number(at) || Date.now(), cached:!!cached});
  // A screen that draws only its own part when its data lands (Admin) gets the line at the top again too.
  clearTimeout(offlineNoteTimer); offlineNoteTimer = setTimeout(paintOfflineNote, 0);
}
let offlineNoteTimer = 0;
const appOffline = ()=> !navigator.onLine || state.apiOnline === false;

/* 10:42 today; 18 Nov, 10:42 on another day. */
function offlineTime(at){
  const d = new Date(at), today = erbilDate(new Date()) === erbilDate(d);
  return formatIraqDateTime(d, today ? {hour:'numeric', minute:'2-digit'} : {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'});
}
/* The reads each screen shows. */
function offlineSources(view){
  if(view === 'recipes' || view === 'recipeItems') return ['recipes'];
  if(view === 'minibar') return ['minibar'];
  if(view === 'stock') return ['stock'];
  if(view === 'admin' && typeof ADMIN_NEEDS !== 'undefined'){
    const keys = ADMIN_NEEDS[state.adminPage || 'home'] || [];
    return keys.length ? keys.map(k=>ADMIN_SOURCES[k]) : ['bootstrap'];
  }
  return ['bootstrap'];
}
/* When the data on this screen was read (the oldest of its reads), and whether it is a kept copy. */
function offlineDataAt(view){
  let at = null, cached = false;
  for(const name of offlineSources(view)){
    const r = offlineReads.get(state.account + '|' + name);
    if(!r) continue;
    if(at === null || r.at < at) at = r.at;
    if(r.cached) cached = true;
  }
  return {at, cached};
}
/* Which kept changes belong to a screen. */
function offlineKinds(view){
  if(view === 'recipes' || view === 'recipeItems') return ['recipe', 'ingredient'];
  if(view === 'settings') return ['setting'];
  if(view === 'manage' || view === 'itemsAdmin' || view === 'order') return ['low'];
  return [];
}
/* The line at the top of a screen. Receipts and Transfers have their own (receipts.js), Rico his own
   composer line. */
function offlineNoteHtml(view){
  if(!state.account || ['receipts', 'transfers', 'assistant'].includes(view)) return '';
  const kinds = offlineKinds(view), failed = kinds.length ? queuedChanges(kinds).filter(j=>j.lastError) : [];
  let line = '';
  if(appOffline()){
    const {at} = offlineDataAt(view), waiting = queuedChanges().filter(j=>!j.lastError).length;
    line = (at ? t('offlineShowing')(offlineTime(at)) : t('offlineNoCopy')) + (waiting ? ' ' + t('offlineWaiting')(waiting) : '');
  }
  return `<div class="offline-slot" id="offlineSlot">${line ? `<p class="rr-offline offline-note" role="status">${esc(line)}</p>` : ''}${failed.map(offlineFailedCard).join('')}</div>`;
}
/* A change the server refused: what it was, why, and the person's two choices. */
function offlineFailedCard(job){
  const conflict = job.lastError === 'recipe_conflict';
  const why = conflict ? t('chgConflict') : (OUTBOX_KINDS[job.kind]?.why?.(job.lastError) || t('chgError'));
  return `<div class="form-card offline-failed" role="alert"><p><b>${esc(t('chgFailedTitle'))}: <span dir="auto">${esc(job.meta?.label || '')}</span></b><br>${esc(why)}</p>
    <div class="form-actions"><button type="button" class="btn btn-ghost" data-chg-discard="${esc(job.id)}">${esc(t('chgDiscard'))}</button><button type="button" class="btn btn-primary" data-chg-retry="${esc(job.id)}">${esc(conflict ? t('chgSendMine') : t('chgTryAgain'))}</button></div></div>`;
}
/* The top line again in place (the connection changed, a change was kept or sent). */
function paintOfflineNote(){
  const slot = document.getElementById('offlineSlot');
  if(!slot || !state.account) return;
  const html = offlineNoteHtml(state.view);
  if(html) slot.outerHTML = html; else slot.innerHTML = '';
}
document.addEventListener('click', async e=>{
  const retry = e.target.closest?.('[data-chg-retry]'), drop = e.target.closest?.('[data-chg-discard]');
  if(!retry && !drop) return;
  const id = (retry || drop).dataset[retry ? 'chgRetry' : 'chgDiscard'], job = queuedChanges().find(j=>j.id === id);
  if(!job) return;
  if(drop){
    discardChange(id);
    await OUTBOX_KINDS[job.kind]?.discarded?.(job);
    paintOfflineNote();
    return;
  }
  if(appOffline()){ toast(t('offlineNeedsNet'), 'warn'); return; }
  retry.disabled = true;
  // "Send mine anyway" sends it over the newer copy: from the version the server has now.
  const patch = OUTBOX_KINDS[job.kind]?.again ? await OUTBOX_KINDS[job.kind].again(job) : null;
  retryChange(id, patch);
  await flushOutbox();
  paintOfflineNote();
});

/* Kept changes that went (or were refused for good): the screens update, and the person hears once. */
function onOutboxSettled(done, failed){
  const kinds = new Set([...done, ...failed].map(x=>x.job.kind));
  for(const kind of kinds){ try{ OUTBOX_KINDS[kind]?.settled?.(done.filter(x=>x.job.kind === kind), failed.filter(x=>x.job.kind === kind)); }catch(e){ console.warn('offline settle', e); } }
  if(failed.length) toast(t('chgFailedToast')(failed.length), 'error', {ms:5000});
  else if(done.some(x=>x.job.meta?.offline)) toast(t('offlineSent'));
  paintOfflineNote();
}

/* ---------- Needs the internet ----------
   One list of what is grayed out while offline (and why); a tap on one says so instead of failing. */
const OFFLINE_BLOCKED = [
  // Rico: asking, his photo, and acting on his cards.
  ['#ricoSendBtn, #ricoAttachBtn, [data-rico-ask], [data-rico-apply], [data-rico-retry], [data-rico-undo], [data-rico-transfer], [data-rc-ask], [data-rc-ask-cat]', 'offlineRicoNet'],
  // Receipts, Transfers and Stock: approving, cancelling, Rico's controls, photos, Check now, limits.
  ['#rrApprove, #tfApprove, #rrCancel, #tfCancel, #rrRetry, #tfRetry, #rrStop, #rrScan, [data-rr-check], [data-rico], #rrLimEdit, #rrLimStd, #rrTgConnect, #tfAutoSet, [data-rr-photos], [data-tf-photos]', 'offlineNeedsNet'],
  // Recipes: delete, photos, Check all last prices, a category's colour.
  ['#rcDeleteRecipe, [data-rc-photo-add], #rcPrices, [data-rc-color]', 'offlineNeedsNet'],
  // Manage and History: adding to the catalog, linking many items, deleting an order.
  ['#supAddBtn, #itemAddBtn, #unitAddBtn, #itemLinkAllBtn, [data-delhist]', 'offlineNeedsNet'],
  // Admin: every action (its pages can still be read).
  ['[data-adh-unlock], [data-devlogout], [data-devrefresh], [data-pin-change], [data-problem-fix], #problemsClear, #secUnlock, #accessStandard, #devLogoutAllBtn, #devRefreshAllBtn, #namesCheck, #cloudRun, [data-restore-day], #healthCheck, [data-health-retry], [data-check-item], .admin-page input[type=checkbox], .admin-page input[type=radio]', 'offlineNeedsNet'],
  // Settings that live on the server's other lists, and notifications.
  ['#pushSwitch, #pushEnableBtn, #memAdd button, [data-mem-del], [data-routine-del], [data-routine-on], [data-sched-del], [data-sched-on], #schedForm button[type=submit], #sheetAsk button', 'offlineNeedsNet'],
];
const OFFLINE_BLOCKED_ALL = OFFLINE_BLOCKED.map(x=>x[0]).join(', ');
(function offlineStyle(){
  const style = document.createElement('style');
  style.id = 'offlineBlockedStyle';
  style.textContent = `html.offline :is(${OFFLINE_BLOCKED_ALL}){opacity:.42;filter:grayscale(1);cursor:not-allowed}`;
  document.head.appendChild(style);
})();
document.addEventListener('click', e=>{
  if(!appOffline()) return;
  const el = e.target.closest?.(OFFLINE_BLOCKED_ALL);
  if(!el) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const reason = OFFLINE_BLOCKED.find(([sel])=>el.matches(sel))?.[1] || 'offlineNeedsNet';
  toast(t(reason), 'warn');
}, true);
/* For actions started from a menu or a key: true (and says why) while offline. */
function offlineBlocked(reason = 'offlineNeedsNet'){
  if(!appOffline()) return false;
  toast(t(reason), 'warn');
  return true;
}

/* ---------- The connection changes ---------- */
let offlineWas = null, offlineRefreshTimer = 0;
function offlineChanged(){
  const now = appOffline();
  document.documentElement.classList.toggle('offline', now);
  if(now === offlineWas) return;
  const back = offlineWas === true && !now;
  offlineWas = now;
  if(!state.account){ if(typeof updateLoginFeedback === 'function' && document.querySelector('.pin-boxes')) updateLoginFeedback(); return; }
  // The screen shows (or stops showing) the line and its grayed buttons; a form being typed in is left alone.
  if(refreshBlocked()) paintOfflineNote(); else render();
  if(back){ clearTimeout(offlineRefreshTimer); offlineRefreshTimer = setTimeout(offlineRefreshAll, 300); }
}
addEventListener('online', ()=>setTimeout(offlineChanged, 0));
addEventListener('offline', offlineChanged);
/* Back online: what waits is sent first, then everything that was shown is read again. */
async function offlineRefreshAll(){
  if(!state.account || appOffline()) return;
  const account = state.account;
  await flushOutbox();
  if(state.account !== account) return;
  if(typeof offlineReloadStart === 'function') await offlineReloadStart();
  if(typeof recipeBook !== 'undefined' && recipeBook.data && recipeBook.account === account) recipeLoad();
  if(typeof minibar !== 'undefined' && minibar.data && minibar.account === account) minibarLoad();
  if(typeof stk !== 'undefined' && stk.data) stockLoad();
  if(typeof rico !== 'undefined' && rico.chats) ricoLoadChats();
  if(state.view === 'admin' && typeof adminLoad === 'function') adminLoad(state.adminPage, true);
  paintOfflineNote();
}

/* ---------- Kept changes over the data shown ----------
   The start-up data (fresh or kept) is the server's: what this phone changed and has not sent yet is
   laid over it, so it never looks undone (and a refused one still shows, with its card). */
function offlineOverlayData(){
  if(!state.account) return;
  for(const j of queuedChanges('setting')) state.settings = {...state.settings, [j.key]:j.body?.value};
  for(const j of queuedChanges('low')){
    const i = (state.items || []).find(x=>x.id === j.key);
    if(!i) continue;
    if(j.body?.level === null || j.body?.level === undefined) delete i.lowAlert; else i.lowAlert = j.body.level;
  }
}
/* An item's low stock level: one whole value (or none), safe to send later. */
OUTBOX_KINDS.low = {
  why(error){ return error === 'not_linked' ? t('lowAlertNeedsLink') : error === 'invalid_input' ? t('lowAlertInvalid') : error === 'not_ready' || error === 'not_found' ? t('lowAlertNotReady') : ''; },
  settled(done){
    for(const {job, data} of done){
      const i = state.items.find(x=>x.id === job.key);
      if(i && data && 'lowAlert' in data){ if(data.lowAlert === null || data.lowAlert === undefined) delete i.lowAlert; else i.lowAlert = data.lowAlert; }
    }
  },
  discarded(){ refreshData('live'); },
};
