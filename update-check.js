/* Checks whether a newer version of the app has been deployed, and if so
   prompts the user to reload. Works by re-fetching config.js from the
   server (bypassing the cache) every so often and comparing its
   APP_VERSION against the one this page was loaded with.
   Depends on: APP_VERSION (config.js), t() (app.js), showConfirm (modals.js). */
const UPDATE_CHECK_INTERVAL_MS = 60000; /* check every minute */
let updateCheckBusy = false;
let updatePromptOpen = false;

async function checkForUpdate(){
  if(updateCheckBusy || updatePromptOpen) return;
  updateCheckBusy = true;
  try{
    const res = await fetch(`config.js?_=${Date.now()}`, { cache: 'no-store' });
    if(res.ok){
      const text = await res.text();
      const match = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      const liveVersion = match && match[1];
      if(liveVersion && liveVersion !== APP_VERSION){
        updatePromptOpen = true;
        const ok = await showConfirm(t('updateAvailableMsg'), {
          okLabel: t('updateNow'), cancelLabel: t('later'), okClass: 'btn-primary'
        });
        if(ok){ location.reload(); return; }
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
