/* Checks whether a newer version of the app has been deployed, by
   re-fetching config.js from the server (bypassing the cache) every so
   often and comparing its APP_VERSION against the one this page was
   loaded with.

   If there's nothing in progress to lose (empty cart, no send queue
   open), the update is applied automatically -- the page just reloads
   itself, no tap needed. If there IS something in progress, it asks
   first (with a "what's new" summary in both languages) so an
   in-progress order is never wiped out from under someone. Once
   dismissed with "Later" for a given version, it won't ask again for
   that same version -- only a version newer than the one already
   declined will prompt again.

   It also never acts while any popup is open (for example the add/edit
   supplier or item form), so a half-filled form is never wiped or covered
   -- it simply tries again on the next check.

   hardReload() is also what an admin's "Refresh" command uses (see
   app.js, Remote commands): it re-downloads every app file first, so the
   reload really does pick up the newest version instead of a cached one.

   openUpdatePopup() is what an "update" push notification opens (see
   push.js): always shows the What's new popup, with an Update button at
   the bottom that reloads the page.

   Depends on: APP_VERSION (config.js), t() and state (app.js),
   showConfirm, showUpdatePopup (modals.js), lset (storage.js). */
const UPDATE_CHECK_INTERVAL_MS = 60000; /* check every minute */
let updateCheckBusy = false;
let updatePromptOpen = false;
let snoozedVersion = null;

/* Every file the page loads. If you add a new .js/.css file, add it here. */
const APP_FILES = ['config.js','icons.js','i18n.js','storage.js','modals.js','push.js','app.js','update-check.js','sw.js','style.css'];

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
  try{ return !state.queue && !Object.values(state.cart).some(q=>q>0); }
  catch(e){ return false; } /* if state isn't ready yet, be conservative and ask */
}

function modalIsOpen(){
  return !!document.querySelector('#modalRoot .modal-overlay');
}

function escUpdateText(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildUpdateMessage(changelogEn, changelogKu, intro){
  const enBlock = changelogEn
    ? `<div style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:4px;">What's new</div><div>${escUpdateText(changelogEn)}</div></div>`
    : '';
  const kuBlock = changelogKu
    ? `<div style="direction:rtl;text-align:right;"><div style="font-weight:800;margin-bottom:4px;">نوێکارییەکان</div><div>${escUpdateText(changelogKu)}</div></div>`
    : '';
  return `<div style="text-align:left;">
    <div style="margin-bottom:10px;">${intro || 'A new update is available. Reload to get it.'}</div>
    ${enBlock}${kuBlock}
  </div>`;
}

/* Reads the live config.js from the server (as text -- it's never run) and
   returns {version, en, ku}, or null if offline / blocked. */
async function fetchLiveInfo(){
  try{
    const res = await fetch(`config.js?_=${Date.now()}`, { cache: 'no-store' });
    if(!res.ok) return null;
    const text = await res.text();
    const ver = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const en = text.match(/CHANGELOG_EN\s*=\s*['"]([^'"]*)['"]/);
    const ku = text.match(/CHANGELOG_KU\s*=\s*['"]([^'"]*)['"]/);
    return { version: ver && ver[1], en: en ? en[1] : '', ku: ku ? ku[1] : '' };
  }catch(e){ return null; }
}

async function checkForUpdate(){
  if(updateCheckBusy || updatePromptOpen) return;
  if(modalIsOpen()) return; /* someone is in the middle of a form -- try again next time */
  updateCheckBusy = true;
  try{
    const res = await fetch(`config.js?_=${Date.now()}`, { cache: 'no-store' });
    if(res.ok){
      const text = await res.text();
      const verMatch = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      const liveVersion = verMatch && verMatch[1];
      if(liveVersion && liveVersion !== APP_VERSION){
        /* A popup may have been opened while the request was in flight. */
        if(modalIsOpen()){ updateCheckBusy = false; return; }
        if(cartIsEmpty()){
          hardReload();
          return;
        }
        if(liveVersion === snoozedVersion){ updateCheckBusy = false; return; }
        const enMatch = text.match(/CHANGELOG_EN\s*=\s*['"]([^'"]*)['"]/);
        const kuMatch = text.match(/CHANGELOG_KU\s*=\s*['"]([^'"]*)['"]/);
        updatePromptOpen = true;
        const ok = await showConfirm(buildUpdateMessage(enMatch && enMatch[1], kuMatch && kuMatch[1]), {
          okLabel: t('updateNow'), cancelLabel: t('later'), okClass: 'btn-primary'
        });
        if(ok){ hardReload(); return; }
        snoozedVersion = liveVersion;
        updatePromptOpen = false;
      }
    }
  }catch(e){ /* offline, or the request was blocked -- just try again later */ }
  updateCheckBusy = false;
}

/* Opened by an "update" notification (tapped, or received while the app is
   open). Unlike checkForUpdate() it always shows the What's new popup --
   even with an empty cart -- and the person reads it, then taps Update at the
   bottom to reload. If they're already on the newest version it says so and
   shows the same What's new text with a plain OK. */
async function openUpdatePopup(){
  if(updatePromptOpen) return;
  updatePromptOpen = true;
  try{
    const live = await fetchLiveInfo();
    const hasUpdate = !!(live && live.version && live.version !== APP_VERSION);
    const en = hasUpdate ? live.en : (live && live.en) || CHANGELOG_EN;
    const ku = hasUpdate ? live.ku : (live && live.ku) || CHANGELOG_KU;
    if(hasUpdate){
      const ok = await showUpdatePopup(
        t('updateAvailableTitle'),
        buildUpdateMessage(en, ku, 'A new update is available. Tap Update to get it.<br>نوێکارییەکی نوێ ئامادەیە. دوگمەی نوێکردنەوە بگوشە.'),
        t('updateNow'), t('later')
      );
      if(ok){ hardReload(); return; }   /* page reloads; flag stays set until then */
    } else {
      await showUpdatePopup(
        t('updateAvailableTitle'),
        buildUpdateMessage(en, ku, 'You already have the latest version.<br>وەشانی نوێترینت هەیە.'),
        'OK', null
      );
    }
  }catch(e){ console.error('update popup failed', e); }
  updatePromptOpen = false;
}

setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
/* Also check whenever the tab comes back into focus, so a phone that was
   backgrounded picks up an update as soon as it's reopened. */
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
