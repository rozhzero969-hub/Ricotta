/* Web Push: registers the service worker, subscribes this device, and
   (admins) sends update notifications / test reminders.

   Works on iOS 16.4+ only when the app is opened from the Home Screen icon.
   Depends on: VAPID_PUBLIC_KEY (config.js), state, t, esc (app.js),
   lget/lset/rpcCall/appVerifyPin (storage.js), showPrompt/showAlert
   (modals.js), openUpdatePopup (update-check.js). All are only used at
   runtime, so load order relative to those files doesn't matter. */

/* Bell icon for the notification buttons (kept here so icons.js is unchanged). */
const ICON_BELL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;

const PUSH_SW_URL = 'sw.js';
const PUSH_BANNER_SNOOZE_MS = 3*24*60*60*1000;  /* "Not now" hides the banner for 3 days */
let pushStatus = { ready:false, supported:false, ios:false, standalone:false, permission:'default', subscribed:false };

function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone(){
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function pushConfigured(){
  return typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 20 && !/^PASTE/i.test(VAPID_PUBLIC_KEY);
}
function urlB64ToUint8Array(b64){
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/* Which banner (if any) the Order screen should show. */
function pushBannerMode(){
  if(!pushStatus.ready || !pushConfigured() || pushStatus.subscribed) return null;
  const snoozed = lget('pushBannerSnoozedAt');
  if(snoozed && Date.now() - snoozed < PUSH_BANNER_SNOOZE_MS) return null;
  if(pushStatus.ios && !pushStatus.standalone) return 'ios';   /* must be added to Home Screen first */
  if(!pushStatus.supported || pushStatus.permission === 'denied') return null;
  return 'enable';
}

/* Reads the current state of this device. Also registers the service worker
   and quietly re-saves an existing subscription so it always exists server-side. */
async function initPush(){
  try{
    pushStatus.ios = isIOS();
    pushStatus.standalone = isStandalone();
    pushStatus.supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    pushStatus.permission = ('Notification' in window) ? Notification.permission : 'denied';
    pushStatus.subscribed = false;
    if(pushStatus.supported && pushConfigured()){
      const reg = await navigator.serviceWorker.register(PUSH_SW_URL);
      const sub = await reg.pushManager.getSubscription();
      pushStatus.subscribed = !!sub && Notification.permission === 'granted';
      if(pushStatus.subscribed) savePushSubscription(sub);
    }
  }catch(e){ console.error('push init failed', e); }
  pushStatus.ready = true;
}

async function savePushSubscription(sub){
  const j = sub.toJSON();
  if(!j.endpoint || !j.keys) return false;
  const ok = await rpcCall('push_save_subscription', { p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth });
  return ok === true;
}

/* Must be called straight from a tap (iOS only shows the permission prompt
   after a user gesture), so requestPermission() is the first await. */
async function enablePush(){
  if(!pushConfigured()) return { ok:false, reason:'notconfigured' };
  if(!pushStatus.supported) return { ok:false, reason:'unsupported' };
  try{
    const perm = await Notification.requestPermission();
    pushStatus.permission = perm;
    if(perm !== 'granted') return { ok:false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
    await navigator.serviceWorker.register(PUSH_SW_URL);
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub) sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    if(!(await savePushSubscription(sub))) return { ok:false, reason:'save' };
    pushStatus.subscribed = true;
    return { ok:true };
  }catch(e){
    console.error('enable push failed', e);
    return { ok:false, reason:'error' };
  }
}
async function disablePush(){
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if(sub){
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await rpcCall('push_remove_subscription', { p_endpoint: endpoint });
    }
  }catch(e){ console.error('disable push failed', e); }
  pushStatus.subscribed = false;
}
function snoozePushBanner(){ lset('pushBannerSnoozedAt', Date.now()); }

/* Shows the right message for a failed enablePush(). */
async function showPushEnableResult(res){
  if(res.ok){ await showAlert(t('notifEnabledMsg')); return; }
  if(res.reason === 'denied') await showAlert(t('notifDeniedMsg'));
  else if(res.reason === 'dismissed') { /* they closed the prompt -- say nothing */ }
  else await showAlert(t('notifFailedMsg'));
}

/* ---------- Admin: sending ---------- */
/* Admin actions need the admin PIN. It's normally still in memory from
   login; if the page was reloaded, ask for it once. */
async function ensureAdminPin(){
  if(state.adminPinEntered) return state.adminPinEntered;
  const pin = await showPrompt(t('reenterAdminPinMsg'), { okLabel:t('unlock'), password:true });
  if(!pin) return null;
  const role = await appVerifyPin(pin);
  if(role !== 'admin'){ await showAlert(t('wrongPin')); return null; }
  state.adminPinEntered = pin;
  return pin;
}
async function callSendPush(type, extra){
  const pin = await ensureAdminPin();
  if(!pin) return { ok:false, reason:'cancelled' };
  try{
    const key = state.settings.supabaseKey;
    const res = await fetch(`${state.settings.supabaseUrl}/functions/v1/send-push`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}` },
      body: JSON.stringify({ type, pin, ...(extra || {}) })
    });
    const data = await res.json().catch(()=>({}));
    if(res.status === 403){ state.adminPinEntered = null; await showAlert(t('wrongPin')); return { ok:false, reason:'pin' }; }
    if(!res.ok) return { ok:false, reason:'error', data };
    return { ok:true, ...data };
  }catch(e){
    console.error('send-push failed', e);
    return { ok:false, reason:'network' };
  }
}
async function reportSendResult(res){
  if(res.reason === 'cancelled' || res.reason === 'pin') return;
  if(!res.ok) await showAlert(t('notifSendFailed'));
  else if(!res.sent) await showAlert(t('notifNoDevices'));
  else await showAlert(t('notifSentMsg')(res.sent));
}
/* "New update" notification to every device that has notifications on. The
   text is the What's new line from the live config.js (so it's right even if
   this admin's own page is a version behind). */
async function sendUpdateNotification(){
  const live = (typeof fetchLiveInfo === 'function') ? await fetchLiveInfo() : null;
  const en = (live && live.en) || CHANGELOG_EN;
  const ku = (live && live.ku) || CHANGELOG_KU;
  const body = [en, ku].filter(Boolean).join('\n');
  const ok = await showConfirm(`<b>${t('sendUpdateNotif')}</b><br>${t('confirmSendUpdateNotif')}<br><br>${esc(en)}`,
    { okLabel:t('notifSend'), okClass:'btn-primary' });
  if(!ok) return;
  await reportSendResult(await callSendPush('update', { title:'Ricotta Orders \u2014 update', body }));
}

/* ---------- Daily reminder settings (stored in Supabase via RPCs) ---------- */
async function loadReminder(){
  const r = await rpcCall('push_get_reminder', {});
  return r && typeof r === 'object' ? { enabled: !!r.enabled, time: r.time || '09:00' } : null;
}
async function saveReminder(enabled, time){
  const pin = await ensureAdminPin();
  if(!pin) return 'cancelled';
  return await rpcCall('push_set_reminder', { p_pin:pin, p_enabled:enabled, p_time:time });
}

/* ---------- Notification taps ---------- */
function handlePushIntent(kind){
  if(kind === 'update') openUpdatePopup();
  else if(kind === 'reminder' && state.role){ state.view = 'order'; render(); }
}
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e => handlePushIntent(e.data && e.data.kind));
}
/* App launched by tapping a notification while it was closed: sw.js opens /?n=<kind>. */
function handleLaunchIntent(){
  try{
    const p = new URLSearchParams(location.search);
    const kind = p.get('n');
    if(!kind) return;
    history.replaceState(null, '', location.pathname);
    handlePushIntent(kind);
  }catch(e){}
}
