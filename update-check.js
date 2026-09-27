/* Checks whether a newer version of the app has been deployed, by
   re-fetching config.js from the server (bypassing the cache) every so
   often and comparing its APP_VERSION against the one this page was
   loaded with.

   If there's nothing in progress to lose (empty cart, no send queue open,
   no Rico chat, nothing being typed), the update is applied automatically --
   the page just reloads itself, no tap needed. If there IS something in
   progress, it asks first, so an in-progress order is never wiped out from
   under someone. Once dismissed with "Later" for a given version, it won't
   ask again for that same version.

   It also never acts while any popup is open (for example the add/edit
   supplier or item form), so a half-filled form is never wiped or covered
   -- it simply tries again on the next check.

   hardReload() is also what Rozha's "Refresh" command uses (see app.js,
   Remote commands): it re-downloads every app file first, so the reload
   really does pick up the newest version instead of a cached one.

   openUpdatePopup(message) is what an "update" notification opens (see
   push.js): it shows exactly the words Rozha wrote for this phone's
   language, with an Update button when a newer version is waiting.

   Depends on: APP_VERSION (config.js), t() and state (app.js),
   showConfirm, showUpdatePopup (modals.js), lset (storage.js). */
const UPDATE_CHECK_INTERVAL_MS = 60000; /* check every minute */
let updateCheckBusy = false;
let updatePromptOpen = false;
let snoozedVersion = null;

/* Every file the page loads. If you add a new .js/.css file, add it here. */
const APP_FILES = ['boot.js','config.js','icons.js','i18n.js','storage.js','modals.js','push.js','assistant.js','app.js','update-check.js','sw.js','style.css'];

/* Reloads the page and makes sure the newest files are used. Browsers (and
   GitHub Pages) can keep serving cached copies of the scripts for a few
   minutes, so a plain reload can come back on the old version. Fetching each
   file with cache:'reload' overwrites the cached copy first. The current
   order selection is saved so a forced refresh doesn't lose it. */
async function hardReload(){
  try{ if(state && state.cart && Object.keys(state.cart).length) lset('pendingCart', state.cart); }catch(e){}
  try{
    const page = location.pathname;
    const urls = [page].concat(APP_FILES);
    await Promise.race([
      Promise.all(urls.map(u=>fetch(u, {cache:'reload'}).catch(()=>null))),
      new Promise(r=>setTimeout(r, 5000))   /* never hang on a slow connection */
    ]);
  }catch(e){ /* fall through and reload anyway */ }
  location.reload();
}

function cartIsEmpty(){
  /* Someone typing a PIN or mid sign-in counts as "in progress" too. */
  try{
    // A Rico chat (it lives only in memory) or text being typed also counts.
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.value;
    const chatting = typeof rico !== 'undefined' && (rico.streaming || rico.messages.length || ricoRecorder.active);
    return !state.queue && !state.pinBuffer && !state.pinBusy && !Object.values(state.cart).some(q=>q>0) && !typing && !chatting;
  }
  catch(e){ return false; } /* if state isn't ready yet, be conservative and ask */
}

function modalIsOpen(){
  return !!document.querySelector('#modalRoot .modal-overlay');
}

function escUpdateText(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Reads the live config.js from the server (as text -- it's never run) and
   returns its APP_VERSION, or null if offline / blocked. */
async function fetchLiveVersion(){
  try{
    const res = await fetch(`config.js?_=${Date.now()}`, { cache: 'no-store' });
    if(!res.ok) return null;
    const ver = (await res.text()).match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return ver ? ver[1] : null;
  }catch(e){ return null; }
}

async function checkForUpdate(){
  if(updateCheckBusy || updatePromptOpen || modalIsOpen()) return;   /* never interrupt a half-filled form */
  updateCheckBusy = true;
  try{
    const live = await fetchLiveVersion();
    if(!live || live === APP_VERSION || modalIsOpen()) return;
    if(cartIsEmpty()){ hardReload(); return; }
    if(live === snoozedVersion) return;
    updatePromptOpen = true;
    const ok = await showConfirm(escUpdateText(t('updateReadyMsg')), {
      okLabel: t('updateNow'), cancelLabel: t('later'), okClass: 'btn-primary'
    });
    updatePromptOpen = false;
    if(ok){ hardReload(); return; }
    snoozedVersion = live;
  }finally{ updateCheckBusy = false; }
}

/* Opened by an "update" notification (tapped, or received while the app is
   open). Shows only the message Rozha wrote. When a newer version is
   waiting, Update reloads the app; otherwise the message closes with OK. */
async function openUpdatePopup(message){
  if(updatePromptOpen) return;
  updatePromptOpen = true;
  try{
    const live = await fetchLiveVersion();
    const hasUpdate = !!(live && live !== APP_VERSION);
    const words = String(message || '').trim();
    const body = `<div class="update-words" dir="auto">${escUpdateText(words || t('updateReadyMsg'))}</div>`;
    const ok = await showUpdatePopup(body, hasUpdate ? t('updateNow') : t('ok'), hasUpdate ? t('later') : null);
    if(ok && hasUpdate){ hardReload(); return; }   /* page reloads; flag stays set until then */
  }catch(e){ console.error('update popup failed', e); }
  updatePromptOpen = false;
}

setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
/* Also check whenever the tab comes back into focus, so a phone that was
   backgrounded picks up an update as soon as it's reopened. */
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
