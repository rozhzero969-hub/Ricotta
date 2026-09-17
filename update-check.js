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

   Depends on: APP_VERSION (config.js), t() and state (app.js),
   showConfirm (modals.js). */
const UPDATE_CHECK_INTERVAL_MS = 60000; /* check every minute */
let updateCheckBusy = false;
let updatePromptOpen = false;
let snoozedVersion = null;

function cartIsEmpty(){
  try{ return !state.queue && !Object.values(state.cart).some(q=>q>0); }
  catch(e){ return false; } /* if state isn't ready yet, be conservative and ask */
}

function escUpdateText(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildUpdateMessage(changelogEn, changelogKu){
  const enBlock = changelogEn
    ? `<div style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:4px;">What's new</div><div>${escUpdateText(changelogEn)}</div></div>`
    : '';
  const kuBlock = changelogKu
    ? `<div style="direction:rtl;text-align:right;"><div style="font-weight:800;margin-bottom:4px;">نوێکارییەکان</div><div>${escUpdateText(changelogKu)}</div></div>`
    : '';
  return `<div style="text-align:left;">
    <div style="margin-bottom:10px;">A new update is available. Reload to get it.</div>
    ${enBlock}${kuBlock}
  </div>`;
}

async function checkForUpdate(){
  if(updateCheckBusy || updatePromptOpen) return;
  updateCheckBusy = true;
  try{
    const res = await fetch(`config.js?_=${Date.now()}`, { cache: 'no-store' });
    if(res.ok){
      const text = await res.text();
      const verMatch = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      const liveVersion = verMatch && verMatch[1];
      if(liveVersion && liveVersion !== APP_VERSION){
        if(cartIsEmpty()){
          location.reload();
          return;
        }
        if(liveVersion === snoozedVersion){ updateCheckBusy = false; return; }
        const enMatch = text.match(/CHANGELOG_EN\s*=\s*['"]([^'"]*)['"]/);
        const kuMatch = text.match(/CHANGELOG_KU\s*=\s*['"]([^'"]*)['"]/);
        updatePromptOpen = true;
        const ok = await showConfirm(buildUpdateMessage(enMatch && enMatch[1], kuMatch && kuMatch[1]), {
          okLabel: t('updateNow'), cancelLabel: t('later'), okClass: 'btn-primary'
        });
        if(ok){ location.reload(); return; }
        snoozedVersion = liveVersion;
        updatePromptOpen = false;
      }
    }
  }catch(e){ /* offline, or the request was blocked -- just try again later */ }
  updateCheckBusy = false;
}

setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
/* Also check whenever the tab comes back into focus, so a phone that was
   backgrounded picks up an update as soon as it's reopened. */
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
