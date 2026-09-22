/* Ricotta Orders -- app state, rendering and event handlers.
   Depends on: DEFAULT_UNITS, SUPABASE_URL, SUPABASE_ANON_KEY, PIN consts
   (config.js), T (i18n.js), icon strings (icons.js), sget/sset/appVerifyPin/
   appGetPins/appSetPins/appGetCloudConfig/appSetCloudConfig (storage.js),
   showConfirm, showAlert, showPrompt, showFormModal and showForcedRefresh
   (modals.js), hardReload (update-check.js, only called at runtime), push helpers
   (push.js: initPush, enablePush, pushBannerMode, ...). Load this file after
   modals.js and push.js. */
/* ============ State ============ */
let state = {
  lang: 'en',
  role: null,           // 'admin' | 'user' | null
  view: 'order',
  pinBuffer: '',
  pinError: false,
  pinExpanded: false,
  justExpanded: false,
  suppliers: [],
  items: [],
  units: [],
  // supabaseUrl/supabaseKey are public connection info, not secrets --
  // see the comment in config.js. adminPin/userPin/cloudPassword are
  // NEVER stored here except transiently, right after a correct RPC
  // check, for as long as the relevant screen needs to display them.
  settings: { supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY },
  adminPinEntered: null,     // this session's admin PIN, kept in memory only,
                             // used to authorize PIN/cloud-config changes
  cloudPasswordEntered: null,
  history: [],
  cart: {},              // itemId -> qty
  search: '',
  orderTab: 'all',        // 'all' | supplierId | '__none'
  cloudUnlocked: false,   // whether the Cloud Setup section is currently revealed
  itemFormSupplierId: null, // supplier "locked in" for the add-item form
  queue: null,           // array of {supplierId, sent} while sending
  activity: [],          // the Record: [{id, ts, action, type, name, fields, by, role}], synced via Supabase
  recordFilter: 'all',   // 'all' | 'supplier' | 'item' | 'unit'
  devices: [],           // [{id, nickname, role, lastLogin, lastSeen, loggedIn, logins}], synced via Supabase
  deviceId: null,        // this device's own id, generated once and kept locally
  reminder: null,        // daily reminder settings {enabled,time}; null = not loaded yet, false = failed to load
  apiOnline: navigator.onLine
};

function t(key){ return T[state.lang][key]; }
/* Consistent "nothing here yet" block: icon + message, used for every empty
   list in the app (Suppliers, Items, History, Record, Devices, Units,
   search results). Kept as one helper so all empty states look the same
   and stay that way if the treatment ever changes. */
function emptyState(msg){
  return `<div class="empty">${ICON_EMPTY}<div class="empty-text">${msg}</div></div>`;
}

/* Escapes text before it's inserted into innerHTML, so an item/supplier/
   unit name typed by staff can never break out of its tag and inject HTML. */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============ Device tracking ============ */
/* Each device has one entry in the shared 'devices' list:
   {id, nickname, role, lastLogin, lastSeen, loggedIn, logins:[newest first]}
   - lastLogin / logins: when the PIN was entered on that device
   - loggedIn: true from login until that device taps Log out
   - lastSeen: refreshed every couple of minutes while the app is open and
     on screen, which is how "active now" is told apart from "logged in but
     the app is closed or idle". */
const HEARTBEAT_MS = 2*60*1000;       /* how often an open app reports "still here" */
const ACTIVE_WINDOW_MS = 5*60*1000;   /* seen within this long ago = "active now" */
const MAX_LOGINS_KEPT = 10;           /* recent logins remembered per device */
let deviceQueue = Promise.resolve();

/* Generates a random id for this device the first time it's needed, and
   remembers it in localStorage from then on. It's not a secret -- just a
   way to recognize "this same phone" across logins. */
function ensureDeviceId(){
  let id = lget('deviceId');
  if(!id){
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('d'+Date.now()+Math.random().toString(36).slice(2));
    lset('deviceId', id);
  }
  return id;
}
/* Changes ONE device's entry (creating it if it doesn't exist yet). Writes
   are queued one after another, and each one re-reads the shared list
   first, so several phones reporting in at the same time don't overwrite
   each other's entries or nicknames. */
function mutateDevices(fn){
  deviceQueue = deviceQueue.then(async ()=>{
    let latest = await sget('devices', true);
    if(!Array.isArray(latest)) latest = state.devices;
    fn(latest);
    latest = pruneDevices(latest);
    state.devices = latest;
    await sset('devices', latest, true);
    if(state.view === 'devices') render();
  }).catch(e=>console.error('device update failed', e));
  return deviceQueue;
}
/* Only devices that are logged in stay in the list. A device that logs out (or that
   an admin logs out) is removed, so the list never fills up with old logins. The one
   exception: a device with a "log out" waiting for it is kept (hidden) until it opens
   the app and picks the command up -- otherwise it would stay signed in -- but not
   longer than 30 days. */
const PENDING_LOGOUT_KEEP_MS = 30*24*60*60*1000;
function pruneDevices(list){
  return list.filter(d=>{
    if(isLoggedIn(d)) return true;
    if(commandIsPending(d) && d.command.type === 'logout'){
      const age = Date.now() - new Date(d.command.ts || 0).getTime();
      return age < PENDING_LOGOUT_KEEP_MS;
    }
    return false;
  });
}
function updateDevice(id, mutate){
  return mutateDevices(list=>{
    let entry = list.find(d=>d.id===id);
    if(!entry){
      // A device that logged out has no entry any more; when it signs in again it
      // gets its old nickname back from this phone instead of being asked again.
      const savedName = id === state.deviceId ? (lget('deviceNickname') || '') : '';
      entry = {id, nickname:savedName, role:'user', lastLogin:null, lastSeen:null, loggedIn:false, logins:[]};
      list.push(entry);
    }
    mutate(entry);
  });
}
/* Called right after a successful PIN login. Marks this device as logged
   in and adds the time to its recent-logins list, then -- only the first
   time this device has ever logged in, i.e. it doesn't have a nickname
   yet -- asks for a nickname. Runs in the background after render() so it
   never delays the login transition. */
async function recordDeviceLogin(role){
  const now = new Date().toISOString();
  await updateDevice(state.deviceId, d=>{
    d.role = role; d.loggedIn = true; d.lastLogin = now; d.lastSeen = now;
    d.logins = [now, ...(d.logins || [])].slice(0, MAX_LOGINS_KEPT);
    // A command that was sent before this login is old news -- without
    // this, an old "log out" could kick the person out right after signing in.
    if(d.command){ d.handledCommand = d.command.id; lset('handledCommand', d.command.id); }
  });
  const entry = state.devices.find(d=>d.id===state.deviceId);
  if(entry && !entry.nickname){
    const name = await showPrompt(t('deviceNamePromptMsg'), {
      placeholder: t('deviceNamePlaceholder'), okLabel: t('save'), cancelLabel: t('skip')
    });
    if(name){ lset('deviceNickname', name); await updateDevice(state.deviceId, d=>{ d.nickname = name; }); }
  }
}
/* "Still here" ping: used at startup when a saved session is restored, every
   couple of minutes while the app is open, and when the app comes back to
   the foreground. */
function touchDevice(){
  const role = state.role;
  if(!role) return Promise.resolve();
  const now = new Date().toISOString();
  return updateDevice(state.deviceId, d=>{
    // An admin already logged this device out and it just hasn't caught up yet:
    // don't flip it back to "logged in" with a heartbeat.
    if(commandIsPending(d) && d.command.type === 'logout') return;
    d.role = role; d.loggedIn = true; d.lastSeen = now;
    if(!d.lastLogin) d.lastLogin = now;
  });
}
function markDeviceLoggedOut(ackId){
  const now = new Date().toISOString();
  return updateDevice(state.deviceId, d=>{
    d.loggedIn = false; d.lastSeen = now;
    if(ackId) d.handledCommand = ackId;
  });
}
/* Signs this device out (used by the Log out button and by an admin's
   remote "log out" command). */
function doLogout(ackId){
  const me = state.devices.find(d=>d.id===state.deviceId);
  if(me && me.nickname) lset('deviceNickname', me.nickname);   // keep the name for the next login
  markDeviceLoggedOut(ackId);
  state.role=null; state.pinBuffer=''; state.view='order'; state.cloudUnlocked=false;
  state.adminPinEntered=null; state.cloudPasswordEntered=null;
  lset('session', null); render();
}

/* ============ Remote commands (admin -> other devices) ============ */
/* An admin can tell another device to log out or to refresh. The command is
   written onto that device's entry in the shared 'devices' list as
   d.command = {id, type:'logout'|'refresh', ts}. Every open device checks
   the list every few seconds; when it sees a command it hasn't handled yet,
   it does it, then records d.handledCommand = command id so the admin can
   see it went through (and so it never runs twice). */
const COMMAND_POLL_MS = 10*1000;
let commandCheckBusy = false;
let forcedRefreshOpen = false;

function newCommandId(){ return 'c'+Date.now()+Math.random().toString(36).slice(2,7); }
function otherDevices(){ return state.devices.filter(d=>d.id !== state.deviceId); }
function commandIsPending(d){ return !!(d.command && d.command.id !== d.handledCommand); }

/* Admin side: put a command on the given devices. */
function sendDeviceCommand(type, ids){
  const ts = new Date().toISOString();
  return mutateDevices(list=>{
    list.forEach(d=>{
      if(!ids.includes(d.id)) return;
      d.command = {id:newCommandId(), type, ts};
      // Logging out takes effect in the list straight away -- the device may be
      // closed and only notice next time it opens, but it is no longer "logged in".
      if(type === 'logout') d.loggedIn = false;
    });
  });
}

/* Device side: look for a command aimed at this device and run it. */
async function checkCommands(){
  if(commandCheckBusy || !state.deviceId) return;
  commandCheckBusy = true;
  try{
    const latest = await sget('devices', true);
    if(Array.isArray(latest)){
      const changed = JSON.stringify(latest) !== JSON.stringify(state.devices);
      state.devices = latest;
      if(changed && state.role === 'admin' && state.view === 'devices') render();
      const me = latest.find(d=>d.id === state.deviceId);
      if(me && me.command && me.command.id !== lget('handledCommand')) await runCommand(me.command);
    }
  }catch(e){ console.error('command check failed', e); }
  commandCheckBusy = false;
}
async function runCommand(cmd){
  if(cmd.type === 'logout'){
    lset('handledCommand', cmd.id);
    if(state.role){
      const root = document.getElementById('modalRoot');
      if(root) root.innerHTML = '';
      doLogout(cmd.id);
      showAlert(t('forcedLogoutMsg'));
    } else {
      updateDevice(state.deviceId, d=>{ d.handledCommand = cmd.id; });
    }
  } else if(cmd.type === 'refresh'){
    if(forcedRefreshOpen) return;
    forcedRefreshOpen = true;
    await showForcedRefresh(t('refreshRequiredTitle'), t('refreshRequiredMsg'), t('refreshNow'));
    lset('handledCommand', cmd.id);
    try{ await updateDevice(state.deviceId, d=>{ d.handledCommand = cmd.id; }); }catch(e){}
    await hardReload();
  }
}
setInterval(()=>{ if(document.visibilityState === 'visible') checkCommands(); }, COMMAND_POLL_MS);
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkCommands();
});
setInterval(()=>{
  if(state.role && document.visibilityState === 'visible') touchDevice();
}, HEARTBEAT_MS);
document.addEventListener('visibilitychange', ()=>{
  if(state.role && document.visibilityState === 'visible') touchDevice();
});
/* Keeps the Devices screen fresh while an admin is looking at it. */
async function refreshDevices(){
  const latest = await sget('devices', true);
  if(Array.isArray(latest)){
    state.devices = latest;
    if(state.view === 'devices') render();
  }
}
setInterval(()=>{
  if(state.role === 'admin' && state.view === 'devices' && document.visibilityState === 'visible') refreshDevices();
}, 30000);
function setApiHealth(online){
  state.apiOnline = !!online && navigator.onLine;
  const el=document.getElementById('connectionStatus');
  if(el){ el.classList.toggle('offline',!state.apiOnline); el.innerHTML=`<span></span>${state.apiOnline?'Online':'Offline'}`; }
}
async function checkConnection(){
  if(!navigator.onLine){ setApiHealth(false); return; }
  const result=await apiFetch('health'); setApiHealth(!!result?.ok);
}
window.addEventListener('online', checkConnection);
window.addEventListener('offline', ()=>setApiHealth(false));
setInterval(()=>{ if(state.role) checkConnection(); }, 30000);

/* ============ Boot ============ */
async function boot(){
  state.deviceId = ensureDeviceId();
  state.lang = await sget('lang', false) || 'en';
  const api = apiSession();
  if(api && api.expiresAt && new Date(api.expiresAt).getTime() > Date.now()){
    state.role = api.role === 'staff' ? 'user' : api.role;
  } else {
    lset(API_SESSION_KEY, null); lset('session', null);
  }
  const [suppliers, items, units, history, devices, activity, lang] = await Promise.all([
    sget('suppliers', true), sget('items', true), sget('units', true),
    sget('orderHistory', true), sget('devices', true), sget('activityLog', true), sget('lang', false)
  ]);
  state.suppliers = suppliers || [];
  state.items = items || [];
  state.units = units || DEFAULT_UNITS;
  if(!units) await sset('units', DEFAULT_UNITS, true);
  state.history = history || [];
  state.devices = devices || [];
  state.activity = Array.isArray(activity) ? activity : [];
  state.lang = lang || 'en';
  // A forced refresh saves the current order selection first; put it back.
  const savedCart = lget('pendingCart');
  if(savedCart && typeof savedCart === 'object'){
    Object.keys(savedCart).forEach(id=>{
      if(state.items.some(i=>i.id===id) && savedCart[id] > 0) state.cart[id] = savedCart[id];
    });
    lset('pendingCart', null);
  }
  render();
  checkConnection();
  // Notifications: register the service worker, read this device's status, and
  // handle being launched from a notification tap.
  initPush().then(()=>{ render(); handleLaunchIntent(); });
  await checkCommands();          // a logout/refresh sent while this device was closed
  if(state.role) touchDevice();   // restored session: mark this device as logged in and seen
}

function applyLangClasses(){
  document.body.className = state.lang === 'ku' ? 'lang-ku' : '';
  document.documentElement.className = state.lang === 'ku' ? 'rtl' : '';
}

/* ============ Render dispatch ============ */
// Entrance animations (.content fade-up, item/list/card pop-in) should only
// play when the *view actually changes* -- switching screens, or swiping
// between supplier tabs on Order -- not on every re-render. render() gets
// called on every cart tweak (+/-, typing a qty), sync, timer tick, etc.,
// which used to replay the animation on every single one of those, since
// app.innerHTML is rebuilt from scratch each time. lastAnimKey remembers the
// last screen/tab we animated for; renders that land on the same key get a
// 'static-update' class instead, which turns those entrance animations off
// (see style.css) while leaving everything else (button taps, modals, the
// brand dot pulse) untouched.
let lastAnimKey = null;
function render(){
  applyLangClasses();
  const app = document.getElementById('app');
  if(!state.role){
    const animKey = 'login';
    app.classList.toggle('static-update', animKey === lastAnimKey);
    lastAnimKey = animKey;
    app.innerHTML = renderLogin(); attachLoginEvents(); return;
  }
  const animKey = state.view + (state.view === 'order' ? ':' + state.orderTab : '');
  app.classList.toggle('static-update', animKey === lastAnimKey);
  lastAnimKey = animKey;
  let body = '';
  if(state.view === 'order') body = renderOrder();
  else if(state.view === 'queue') body = renderQueue();
  else if(state.view === 'history') body = renderHistory();
  else if(state.view === 'suppliers') body = renderSuppliers();
  else if(state.view === 'itemsAdmin') body = renderItemsAdmin();
  else if(state.view === 'units') body = renderUnits();
  else if(state.view === 'record') body = renderRecord();
  else if(state.view === 'devices') body = renderDevices();
  else if(state.view === 'settings') body = renderSettings();

  app.innerHTML = `
    ${renderTopbar()}
    <div class="content">${state.view === 'order' ? renderPushBanner() : ''}${body}</div>
    <div class="bottom-stack">
      ${state.view === 'order' ? renderOrderBottomBar() : ''}
      ${renderBottomNav()}
    </div>
  `;
  attachCommonEvents();
  if(state.view === 'order') attachOrderEvents();
  if(state.view === 'queue') attachQueueEvents();
  if(state.view === 'history') attachHistoryEvents();
  if(state.view === 'suppliers') attachSupplierEvents();
  if(state.view === 'itemsAdmin') attachItemEvents();
  if(state.view === 'units') attachUnitEvents();
  if(state.view === 'record') attachRecordEvents();
  if(state.view === 'devices') attachDeviceEvents();
  if(state.view === 'settings') attachSettingsEvents();
  // The nav scrolls sideways on narrow phones (admins have 8 tabs); keep the current tab in view.
  const activeNav = document.querySelector('.navbtn.active');
  if(activeNav && activeNav.scrollIntoView) activeNav.scrollIntoView({inline:'center', block:'nearest'});
}

/* ============ Notifications: banner (everyone) ============ */
/* Shown at the top of the Order screen until this device has notifications
   on. On iPhone, outside the Home Screen app it only explains how to install. */
function renderPushBanner(){
  const mode = pushBannerMode();
  if(!mode) return '';
  const text = mode === 'ios' ? t('notifIosHint') : t('notifBannerSub');
  return `<div class="push-banner">
    <div class="push-banner-text"><b>${t('notifBannerTitle')}</b><br>${text}</div>
    <div class="push-banner-actions">
      ${mode === 'enable' ? `<button class="btn btn-primary" id="pushEnableBtn">${ICON_BELL} ${t('notifEnable')}</button>` : ''}
      <button class="btn btn-ghost" id="pushDismissBtn">${t('notifDismiss')}</button>
    </div>
  </div>`;
}

/* ============ Topbar & nav ============ */
function renderTopbar(){
  return `
  <div class="topbar">
    <div class="brand"><span class="dot"></span>${t('appName')}</div>
    <div class="topbar-actions">
      <div class="connection-status ${state.apiOnline?'':'offline'}" id="connectionStatus" title="Internet and Supabase API status"><span></span>${state.apiOnline?'Online':'Offline'}</div>
      <button class="pill-btn ${state.lang==='en'?'active':''}" data-lang="en">EN</button>
      <button class="pill-btn ${state.lang==='ku'?'active':''}" data-lang="ku">KU</button>
      <button class="pill-btn" id="logoutBtn">${t('logout')}</button>
    </div>
  </div>`;
}
function renderBottomNav(){
  const tabs = [
    {id:'order', label:t('order')},
    {id:'history', label:t('history')}
  ];
  if(state.role === 'admin'){
    tabs.push({id:'suppliers', label:t('suppliers')});
    tabs.push({id:'itemsAdmin', label:t('items')});
    tabs.push({id:'units', label:t('units')});
    tabs.push({id:'record', label:t('record')});
    tabs.push({id:'devices', label:t('devicesTitle')});
    tabs.push({id:'settings', label:t('settings')});
  }
  return `<div class="bottomnav">
    ${tabs.map(tb=>`
      <button class="navbtn ${state.view===tb.id?'active':''}" data-view="${tb.id}">
        ${NAV_ICONS[tb.id]}<span>${tb.label}</span>
      </button>`).join('')}
  </div>`;
}
function attachCommonEvents(){
  document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=async()=>{
    state.lang = b.dataset.lang; await sset('lang', state.lang, false); render();
    updatePushLang(state.lang);   // so future notifications switch language immediately too
  });
  const pushOn = document.getElementById('pushEnableBtn');
  if(pushOn) pushOn.onclick = async ()=>{
    const res = await enablePush();   // straight from the tap: iOS needs that for the permission prompt
    render();
    await showPushEnableResult(res);
  };
  const pushLater = document.getElementById('pushDismissBtn');
  if(pushLater) pushLater.onclick = ()=>{ snoozePushBanner(); render(); };
  const lo = document.getElementById('logoutBtn');
  if(lo) lo.onclick = ()=> doLogout();
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
    state.view=b.dataset.view;
    if(state.view === 'record') state.recordFilter = 'all';
    render();
    if(state.view === 'record') refreshActivity();
    if(state.view === 'devices') refreshDevices();
  });
  // "Record" shortcut buttons on the Suppliers / Items screens: jump to the
  // Record already filtered to that kind of change.
  document.querySelectorAll('[data-gorecord]').forEach(b=>b.onclick=()=>{
    state.recordFilter = b.dataset.gorecord; state.view = 'record'; render(); refreshActivity();
  });
}

/* ============ Login (PIN pad) ============ */
function renderLogin(){
  const dotCount = MAX_PIN_LEN;
  const dots = Array.from({length:dotCount}).map((_,i)=>{
    const filled = i < state.pinBuffer.length;
    const isNew = false;
    return `<span class="pin-dot ${filled?'filled':''} ${state.pinError?'err':''} ${isNew?'pop':''}"><span class="core"></span></span>`;
  }).join('');
  const keys = ['1','2','3','4','5','6','7','8','9'];
  return `
  <div class="login-wrap">
    <aside class="login-brand-panel"><div class="brand-word">Ricotta</div><div class="brand-message">Restaurant<br>Management<br><em>Made Simple.</em></div><div class="brand-detail">Orders · Suppliers · Inventory</div><div class="brand-footer">© 2026 Ricotta</div></aside>
    <div class="login-card">
    <div class="login-logo">R<span class="dot-i">i</span>cotta</div>
    <div class="login-heading">
      <div class="login-title">${t('signIn')}</div>
      <div class="login-sub">${t('signInSub')}</div>
    </div>
    <div class="pin-label">${t('enterPin')}</div>
    <div class="pin-dots">${dots}</div>
    <div class="login-error" style="visibility:${state.pinError?'visible':'hidden'};">${t('wrongPin')}</div>
    <div class="keypad">
      ${keys.map(k=>`<button class="key" data-key="${k}">${k}</button>`).join('')}
      <button class="key clear" data-key="clear">${t('clear')}</button>
      <button class="key" data-key="0">0</button>
      <button class="key backspace" data-key="back">${ICON_BACKSPACE}</button>
    </div>
    <button class="lang-pill" id="loginLangToggle">${ICON_GLOBE} ${state.lang==='en'?'English':'کوردی'} ${ICON_CHEVRON}</button>
    </div>
  </div>`;
}
function attachLoginEvents(){
  state.justExpanded = false;
  const toggle = document.getElementById('loginLangToggle');
  if(toggle) toggle.onclick = async ()=>{
    state.lang = state.lang==='en' ? 'ku' : 'en';
    await sset('lang', state.lang, false); render();
    updatePushLang(state.lang);   // so future notifications switch language immediately too
  };
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick=async ()=>{
    const k = b.dataset.key;
    if(k==='clear'){ state.pinBuffer=''; state.pinError=false; render(); return; }
    if(k==='back'){
      state.pinBuffer = state.pinBuffer.slice(0,-1); state.pinError=false;
      render(); return;
    }
    if(state.pinBuffer.length>=MAX_PIN_LEN) return;
    state.pinBuffer += k;

    if(state.pinBuffer.length===MAX_PIN_LEN){
      const role = await appVerifyPin(state.pinBuffer);
      if(role){
        state.role=role; if(role==='admin') state.adminPinEntered=state.pinBuffer;
        state.pinBuffer=''; lset('session', role); render();
        recordDeviceLogin(role); return;
      }
      state.pinError = true; render();
      setTimeout(()=>{ state.pinBuffer=''; state.pinError=false; render(); }, 700);
      return;
    }
    render();
  });
}

/* ============ Order screen ============ */
function unitLabel(unitId){
  const u = state.units.find(x=>x.id===unitId);
  if(!u) return '';
  return state.lang==='ku' ? (u.ku||u.en) : u.en;
}
function supplierName(id){
  const s = state.suppliers.find(x=>x.id===id);
  return s ? s.name : t('noSupplier');
}
function nameCollator(){ return new Intl.Collator(state.lang==='ku' ? 'ku' : 'en', {sensitivity:'base', numeric:true}); }
function sortedByName(rows){ return [...rows].sort((a,b)=>nameCollator().compare(a.name||'', b.name||'')); }
function lastOrderMap(){
  if(!state.history.length) return null;
  const last = state.history[state.history.length-1];
  const map = {};
  last.entries.forEach(e=>e.items.forEach(it=>{ map[it.itemId] = it.qty; }));
  return map;
}
function renderOrderHero(itemCount=state.items.length, supplierCount=new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size){
  const selCount = cartCount();
  return `<div class="hero-card">
    <div class="hero-eyebrow">${t('heroEyebrow')}</div>
    <div class="hero-stat">${t('heroStat')(selCount)}</div>
    <div class="hero-sub">${t('heroSub')(itemCount, supplierCount)}</div>
  </div>`;
}
function orderTabs(){
  const tabs = [{id:'all', label:t('allSuppliers')}];
  sortedByName(state.suppliers).forEach(s=>{
    if(state.items.some(i=>i.supplierId===s.id)) tabs.push({id:s.id, label:s.name});
  });
  if(state.items.some(i=>!i.supplierId)) tabs.push({id:'__none', label:t('noSupplier')});
  return tabs;
}
function renderOrder(){
  if(!state.items.length){
    return emptyState(state.role==='admin'?t('noItemsYet'):t('noItemsUser'));
  }
  const tabs = orderTabs();
  if(!tabs.some(tb=>tb.id===state.orderTab)) state.orderTab = 'all';

  const groupHtml = renderOrderResults();
  const selectedCount = state.orderTab==='all' ? state.items.length : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab).length;
  const selectedSupplierCount = state.orderTab==='all' ? new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size : (selectedCount ? 1 : 0);

  const tabsHtml = `<div class="order-tabs">${tabs.map(tb=>`
    <button class="tab-pill ${state.orderTab===tb.id?'active':''}" data-ordertab="${esc(tb.id)}">${esc(tb.label)}</button>
  `).join('')}</div>`;

  const lastMap = lastOrderMap();
  return `
    ${renderOrderHero(selectedCount, selectedSupplierCount)}
    ${tabsHtml}
    <div class="search-row">
      <div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itemSearch" placeholder="${t('searchPlaceholder')}" value="${esc(state.search)}"></div>
      ${lastMap ? `<button class="quick-btn" id="sameAsLast">${t('sameAsLastTime')}</button>` : ''}
    </div>
    <div id="orderResults" aria-live="polite">${groupHtml || emptyState(t('noSearchResults'))}</div>
  `;
}
/* Search only replaces this result region; rebuilding #app on each keystroke
   was the cause of the apparent page refresh on phones. */
function renderOrderResults(){
  const q = state.search.trim().toLowerCase();
  const tabFiltered = state.orderTab==='all'
    ? state.items
    : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab);
  const visibleItems = tabFiltered.filter(i => !q || i.name.toLowerCase().includes(q));

  const groups = {};
  visibleItems.forEach(i=>{
    const key = i.supplierId || '__none';
    (groups[key] = groups[key]||[]).push(i);
  });
  const groupHtml = Object.keys(groups).sort((a,b)=>nameCollator().compare(a==='__none'?t('noSupplier'):supplierName(a), b==='__none'?t('noSupplier'):supplierName(b))).map(key=>{
    const label = key==='__none' ? t('noSupplier') : supplierName(key);
    const rows = sortedByName(groups[key]).map(i=>{
      const qty = state.cart[i.id] || 0;
      return `
      <div class="item-row ${qty>0?'has-qty':''}">
        <div class="item-info">
          <div class="item-name">${esc(i.name)}</div>
          <div class="item-unit">${esc(unitLabel(i.unit))}</div>
        </div>
        <div class="stepper">
          <button class="step-btn" data-dec="${i.id}">−</button>
          <input class="qty-input" type="number" inputmode="numeric" min="0" value="${qty}" data-qty="${i.id}">
          <button class="step-btn" data-inc="${i.id}">+</button>
        </div>
      </div>`;
    }).join('');
    return state.orderTab==='all' ? `<div class="supplier-group">
      <div class="supplier-head"><span>${esc(label)}</span></div>
      ${rows}
    </div>` : rows;
  }).join('');

  return groupHtml;
}
function refreshOrderResults(){
  const results = document.getElementById('orderResults');
  if(!results) return;
  results.innerHTML = renderOrderResults() || emptyState(t('noSearchResults'));
  attachOrderResultEvents(results);
}
function cartCount(){ return Object.values(state.cart).filter(q=>q>0).length; }
function renderOrderBottomBar(){
  const c = cartCount();
  return `<div class="bottom-bar">
    <button class="send-btn" id="sendOrdersBtn" ${c===0?'disabled':''}>
      ${c>0 ? t('itemsSelected')(c)+' · '+t('sendOrders') : t('sendOrders')}
    </button>
  </div>`;
}
function attachOrderEvents(){
  document.querySelectorAll('[data-ordertab]').forEach(b=>b.onclick=()=>{
    state.orderTab = b.dataset.ordertab; render();
  });
  const search = document.getElementById('itemSearch');
  if(search) search.oninput = (e)=>{
    state.search = e.target.value;
    refreshOrderResults();
  };
  attachOrderResultEvents(document.getElementById('orderResults'));
  document.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.inc; state.cart[id]=(state.cart[id]||0)+1; render();
  });
  document.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.dec; state.cart[id]=Math.max(0,(state.cart[id]||0)-1); render();
  });
  document.querySelectorAll('[data-qty]').forEach(inp=>inp.onchange=()=>{
    const id=inp.dataset.qty; const v=Math.max(0, parseInt(inp.value)||0); state.cart[id]=v; render();
  });
  const same = document.getElementById('sameAsLast');
  if(same) same.onclick = ()=>{ const m = lastOrderMap(); if(m) state.cart = {...m}; render(); };
  const send = document.getElementById('sendOrdersBtn');
  if(send) send.onclick = ()=>{
    const bySupplier = {};
    Object.keys(state.cart).forEach(id=>{
      const qty = state.cart[id]; if(!qty) return;
      const item = state.items.find(i=>i.id===id); if(!item) return;
      const sid = item.supplierId || '__none';
      (bySupplier[sid] = bySupplier[sid]||[]).push({itemId:id, name:item.name, qty, unit:item.unit});
    });
    state.queue = Object.keys(bySupplier).map(sid=>({
      supplierId: sid, items: bySupplier[sid], sent:false
    }));
    state.view='queue'; render();
  };
}
function attachOrderResultEvents(root){
  if(!root) return;
  root.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.inc; state.cart[id]=(state.cart[id]||0)+1; render();
  });
  root.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.dec; state.cart[id]=Math.max(0,(state.cart[id]||0)-1); render();
  });
  root.querySelectorAll('[data-qty]').forEach(inp=>inp.onchange=()=>{
    const id=inp.dataset.qty; const v=Math.max(0, parseInt(inp.value)||0); state.cart[id]=v; render();
  });
}

/* ============ Send queue ============ */
function buildMessage(entry){
  const lines = entry.items.map(i=>`• ${i.name} — ${i.qty} ${unitLabel(i.unit)}`);
  const header = state.lang==='ku' ? 'داواکارییەکی نوێ لە چێشتخانەی ریکۆتا:' : 'New order from Ricotta:';
  return header + '\n' + lines.join('\n');
}
function waLink(phone, text){
  let p = (phone||'').replace(/[^0-9]/g,'');
  if(p.startsWith('0')) p = '964' + p.slice(1);
  else if(!p.startsWith('964')) p = '964' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function renderQueue(){
  if(!state.queue) return emptyState(t('noHistory'));
  const cards = state.queue.map((e,idx)=>{
    const sup = state.suppliers.find(s=>s.id===e.supplierId);
    const name = sup ? sup.name : t('noSupplier');
    const itemsLine = e.items.map(i=>`${esc(i.name)} — ${i.qty} ${esc(unitLabel(i.unit))}`).join(' · ');
    const noSendReason = !sup ? t('noSupplier') : t('noPhoneOnFile');
    return `<div class="queue-card ${e.sent?'sent':''}">
      <div class="queue-top"><span class="queue-name">${esc(name)}</span>${e.sent?`<span class="queue-badge">✓ ${t('sent')}</span>`:''}</div>
      <div class="queue-items">${itemsLine}</div>
      <div class="queue-actions"><button class="pdf-btn" data-pdf="${idx}">Order sheet (PDF)</button>${sup && sup.phone ? `<button class="wa-btn ${e.sent?'done':''}" data-send="${idx}">${e.sent?t('sent'):t('sendVia')}</button>` : `<div class="queue-items">${esc(noSendReason)}</div>`}</div>
    </div>`;
  }).join('');
  return `<div class="section-title">${t('sendQueueTitle')}</div>${cards}`;
}
function attachQueueEvents(){
  document.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>{
    const entry = state.queue[parseInt(b.dataset.pdf)]; const supplier = state.suppliers.find(s=>s.id===entry?.supplierId);
    if(entry) printOrderSheet(entry, supplier);
  });
  document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>{
    const idx = parseInt(b.dataset.send);
    const entry = state.queue[idx];
    const sup = state.suppliers.find(s=>s.id===entry.supplierId);
    if(!sup || !sup.phone) return; // button only renders when this is safe, but guard anyway
    window.open(waLink(sup.phone, buildMessage(entry)), '_blank');
    entry.sent = true;
    render();
    maybeFinishQueue();
  });
}
function printOrderSheet(entry, supplier){
  const ku=state.lang==='ku', title=ku?'داواکارییەکی نوێ':'Purchase order';
  const supplierLabel=supplier?.name||(ku?'بێ دابینکەر':'No supplier');
  const rows=sortedByName(entry.items).map((item,n)=>`<tr><td>${n+1}</td><td>${esc(item.name)}</td><td>${esc(unitLabel(item.unit))}</td><td class="qty">${item.qty}</td></tr>`).join('');
  const w=window.open('', '_blank'); if(!w) return;
  w.document.write(`<!doctype html><html dir="${ku?'rtl':'ltr'}"><head><meta charset="utf-8"><title>${title} — Ricotta</title><style>body{font-family:Arial,'Noto Sans Arabic',sans-serif;color:#172a21;margin:0;padding:38px}.head{border-bottom:3px solid #1f5c3f;padding-bottom:18px;display:flex;justify-content:space-between;align-items:end}.brand{font-size:39px;letter-spacing:-2px}.eyebrow{color:#1f5c3f;font-weight:800;font-size:13px}.title{font-size:24px;font-weight:800;margin:8px 0}.meta{color:#5c6c63;font-size:13px;text-align:end}table{width:100%;border-collapse:collapse;margin-top:28px}th{background:#1f5c3f;color:#fff;text-align:start;padding:12px;font-size:13px}td{padding:13px 12px;border-bottom:1px solid #dce8df;font-size:14px}tr:nth-child(even){background:#f5f9f6}.qty{font-size:18px;font-weight:800;text-align:center;color:#1f5c3f}.foot{margin-top:28px;padding:15px 18px;background:#ecf6ee;border-radius:10px;color:#1f5c3f;font-weight:700}</style></head><body><header class="head"><div><div class="eyebrow">Ricotta Orders</div><div class="title">${title}</div><div>${esc(supplierLabel)}</div></div><div class="meta">${new Date().toLocaleString(ku?'ku':'en-GB')}<br>${entry.items.length} ${ku?'کاڵا':'items'}</div><div class="brand">Ricotta</div></header><table><thead><tr><th>#</th><th>${ku?'کاڵا':'Item'}</th><th>${ku?'یەکە':'Unit'}</th><th>${ku?'بڕ':'Qty'}</th></tr></thead><tbody>${rows}</tbody></table><div class="foot">${ku?'تکایە داواکارییەکە بەپێی ئەم بڕانە ئامادە بکەن. سوپاس.':'Please prepare this order with the quantities listed above. Thank you.'}</div></body></html>`);
  w.document.close(); w.focus(); setTimeout(()=>w.print(),250);
}
async function maybeFinishQueue(){
  if(!state.queue.every(e=>e.sent)) return;
  const record = {
    id: 'o'+Date.now(), date: new Date().toISOString(),
    entries: state.queue.map(e=>({
      supplierId: e.supplierId,
      items: e.items.map(i=>({itemId:i.itemId, name:i.name, qty:i.qty, unit:i.unit}))
    }))
  };
  state.history.push(record);
  await sset('orderHistory', state.history, true);
  state.cart = {};
  state.queue = null;
  state.view = 'order';
  render();
}

/* ============ History ============ */
function renderHistory(){
  if(!state.history.length) return emptyState(t('noHistory'));
  const rows = [...state.history].reverse().map(rec=>{
    const dt = new Date(rec.date).toLocaleString(state.lang==='ku'?'en-GB':'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const supplierLines = rec.entries.map(e=>{
      const name = supplierName(e.supplierId);
      const itemsLine = e.items.map(i=>`${esc(i.name)} (${i.qty} ${esc(unitLabel(i.unit))})`).join(', ');
      return `<div class="hist-supplier">${esc(name)}</div><div class="hist-items">${itemsLine}</div>`;
    }).join('');
    return `<div class="hist-card">
      <div class="hist-top">
        <div class="hist-date">${dt}</div>
        <div class="row-actions">
          <button class="icon-btn" data-reorderhist="${rec.id}" title="${t('orderAgain')}">${ICON_REPEAT}</button>
          <button class="icon-btn danger" data-delhist="${rec.id}" title="${t('delete')}">${ICON_DELETE}</button>
        </div>
      </div>
      ${supplierLines}
    </div>`;
  }).join('');
  return rows;
}
function attachHistoryEvents(){
  document.querySelectorAll('[data-reorderhist]').forEach(b=>b.onclick=()=>{
    const rec = state.history.find(r=>r.id===b.dataset.reorderhist);
    if(!rec) return;
    const cart = {};
    rec.entries.forEach(e=>e.items.forEach(it=>{
      // Skip items that were since deleted from the catalog -- they no
      // longer have anywhere to show up on the order screen.
      if(state.items.some(i=>i.id===it.itemId)) cart[it.itemId] = it.qty;
    }));
    state.cart = cart;
    state.view = 'order';
    render();
  });
  document.querySelectorAll('[data-delhist]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteHistory')))) return;
    const id = b.dataset.delhist;
    if(!(await deleteOrderHistory(id))){ await showAlert('Could not delete this order. Please try again.'); return; }
    state.history = state.history.filter(r=>r.id!==id);
    // Rewrites the single orderHistory row in Supabase with the shorter
    // array, so the deleted order stops taking up space in the database
    // too, not just on this device.
    render();
  });
}

/* ============ Record (activity log) ============ */
/* Every add / edit / delete of a supplier, item or unit is written here
   with the date, time and which device did it. Stored as one shared row
   ('activityLog') in the same app_data table as everything else, so it
   needs no database changes. Capped so the row can't grow forever. */
const ACTIVITY_MAX = 1000;
let activityQueue = Promise.resolve();

function currentDeviceNickname(){
  const d = state.devices.find(x=>x.id===state.deviceId);
  return d ? (d.nickname || '') : '';
}
/* Adds one entry to the Record. Shows up on this device immediately, then
   is merged into the shared copy. Writes are queued one after another, and
   each one re-reads the shared log first, so quick back-to-back saves (or
   two phones saving at the same moment) don't overwrite each other. */
function logActivity(entry){
  const rec = {
    id: 'a'+Date.now()+Math.random().toString(36).slice(2,6),
    ts: new Date().toISOString(),
    by: currentDeviceNickname(),
    role: state.role,
    ...entry
  };
  state.activity = [...state.activity, rec];
  activityQueue = activityQueue.then(async ()=>{
    let latest = await sget('activityLog', true);
    if(!Array.isArray(latest)) latest = [];
    if(!latest.some(a=>a.id===rec.id)) latest = [...latest, rec];
    if(latest.length > ACTIVITY_MAX) latest = latest.slice(-ACTIVITY_MAX);
    state.activity = latest;
    await sset('activityLog', latest, true);
    if(state.view === 'record') render();
  }).catch(e=>console.error('activity log failed', e));
  return activityQueue;
}
/* Pulls the newest shared Record (so entries made on other phones show up). */
async function refreshActivity(){
  const latest = await sget('activityLog', true);
  if(Array.isArray(latest)){
    state.activity = latest;
    if(state.view === 'record') render();
  }
}
/* [[key, oldValue, newValue], ...] -> only the ones that actually changed. */
function diffFields(list){
  return list
    .filter(([k, from, to]) => String(from||'') !== String(to||''))
    .map(([k, from, to]) => ({k, from: from||'', to: to||''}));
}
function unitEn(unitId){
  const u = state.units.find(x=>x.id===unitId);
  return u ? u.en : '';
}
function recordFieldLabel(k){
  return ({name:t('name'), phone:t('phone'), unit:t('unit'), supplier:t('supplier'), nameKu:t('kurdishLabel'), reminder:t('reminderShort')})[k] || k;
}
function recordValue(k, v){
  if(k === 'reminder') return reminderText(reminderFromCode(v));
  if(k === 'supplier' && !v) return t('noSupplier');
  if(!v) return '\u2014';
  if(k === 'unit'){
    const u = state.units.find(x=>x.en === v);
    return u ? (state.lang==='ku' ? (u.ku||u.en) : u.en) : v;
  }
  return v;
}
function renderRecord(){
  const filters = [
    {id:'all', label:t('filterAll')},
    {id:'supplier', label:t('suppliers')},
    {id:'item', label:t('items')},
    {id:'unit', label:t('units')}
  ];
  const filterHtml = `<div class="order-tabs">${filters.map(f=>`
    <button class="tab-pill ${state.recordFilter===f.id?'active':''}" data-recfilter="${f.id}">${f.label}</button>`).join('')}</div>`;
  const rows = state.activity
    .filter(a => state.recordFilter==='all' || a.type===state.recordFilter)
    .sort((a,b)=> new Date(b.ts) - new Date(a.ts));
  const locale = state.lang==='ku' ? 'en-GB' : 'en-US';
  const cards = rows.map(a=>{
    const typeLabel = ({supplier:t('typeSupplier'), item:t('typeItem'), unit:t('typeUnit')})[a.type] || a.type;
    const actLabel = ({add:t('actionAdded'), edit:t('actionEdited'), delete:t('actionDeleted')})[a.action] || a.action;
    const dt = new Date(a.ts).toLocaleString(locale, {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const who = (a.by ? esc(a.by) : t('unnamedDevice')) + ' \u00b7 ' + (a.role==='admin' ? t('deviceRoleAdmin') : t('deviceRoleStaff'));
    const lines = (a.fields||[]).map(f=>{
      const label = esc(recordFieldLabel(f.k));
      if(a.action === 'edit'){
        return `<div class="rec-line"><span class="rec-k">${label}</span> <span class="rec-old">${esc(recordValue(f.k, f.from))}</span> \u2192 <span class="rec-new">${esc(recordValue(f.k, f.to))}</span></div>`;
      }
      const v = a.action === 'delete' ? f.from : f.to;
      return `<div class="rec-line"><span class="rec-k">${label}</span> ${esc(recordValue(f.k, v))}</div>`;
    }).join('');
    const extra = a.unassigned ? `<div class="rec-line">${t('itemsUnassigned')(a.unassigned)}</div>` : '';
    return `<div class="rec-card">
      <div class="rec-top"><span class="rec-badge rec-${esc(a.action)}">${actLabel}</span><span class="rec-type">${typeLabel}</span></div>
      <div class="rec-name">${esc(a.name)}</div>
      ${lines}${extra}
      <div class="rec-meta">${dt} \u00b7 ${who}</div>
    </div>`;
  }).join('');
  return `
    <div class="action-row">
      <div class="section-title" style="flex:1;margin:0;">${t('record')} (${rows.length})</div>
      <button class="btn btn-ghost" id="recRefreshBtn">${ICON_REFRESH} ${t('refresh')}</button>
    </div>
    ${filterHtml}
    ${cards || emptyState(t('recordEmpty'))}`;
}
function attachRecordEvents(){
  document.querySelectorAll('[data-recfilter]').forEach(b=>b.onclick=()=>{
    state.recordFilter = b.dataset.recfilter; render();
  });
  const r = document.getElementById('recRefreshBtn');
  if(r) r.onclick = ()=> refreshActivity();
}

/* ============ Admin: shared popup pieces ============ */
/* The banner at the top of an edit popup: says what's being edited and
   shows how it looks right now, so it's always clear what you're changing. */
function editingBanner(name, meta){
  return `<div class="modal-banner-label">${t('editingLabel')}</div>
    <div class="modal-banner-name">${esc(name)}</div>
    ${meta ? `<div class="modal-banner-meta">${esc(meta)}</div>` : ''}`;
}


/* ============ Supplier reminders ============ */
/* Each supplier can have its own order reminder:
   supplier.reminder = {enabled, time:'HH:MM' (Erbil time), days:[0..6] (0 = Sunday), updatedAt}
   The server (send-push, checked every minute) sends the notification. */
const DAY_ORDER = [6,0,1,2,3,4,5];   /* Saturday first, like the local week; values match JS getDay() */
const DEFAULT_REMINDER_TIME = '09:00';
function reminderDays(r){
  return (r && Array.isArray(r.days) && r.days.length) ? r.days.map(Number) : [0,1,2,3,4,5,6];
}
/* Short code used in the Record: 'off' or 'HH:MM|6,0,1' */
function reminderCode(r){
  if(!r || !r.enabled) return 'off';
  const days = reminderDays(r);
  return r.time + '|' + DAY_ORDER.filter(d=>days.includes(d)).join(',');
}
function reminderFromCode(code){
  if(!code || code === 'off') return null;
  const parts = String(code).split('|');
  return {enabled:true, time:parts[0], days:(parts[1]||'').split(',').filter(Boolean).map(Number)};
}
function reminderText(r){
  if(!r || !r.enabled) return t('reminderOff');
  const days = reminderDays(r);
  const dayText = days.length === 7 ? t('everyDay') : DAY_ORDER.filter(d=>days.includes(d)).map(d=>t('daysShort')[d]).join(', ');
  return r.time + ' \u00b7 ' + dayText;
}
function reminderFieldsHtml(r){
  const on = !!(r && r.enabled);
  const time = (r && r.time) || DEFAULT_REMINDER_TIME;
  const days = reminderDays(r);
  return `
    <hr class="notif-divider">
    <label class="check-row"><input type="checkbox" id="mfRemOn" ${on?'checked':''}> ${ICON_BELL} ${t('supplierReminderLabel')}</label>
    <div id="mfRemBox" ${on?'':'hidden'}>
      <div class="field"><label>${t('reminderTimeLabel')}</label><input id="mfRemTime" type="time" value="${esc(time)}"></div>
      <div class="field"><label>${t('reminderDaysLabel')}</label>
        <div class="day-chips">${DAY_ORDER.map(d=>`<button type="button" class="day-chip ${days.includes(d)?'on':''}" data-day="${d}">${t('daysShort')[d]}</button>`).join('')}</div>
      </div>
      <div class="notif-sub">${t('supplierReminderHint')}</div>
    </div>`;
}
function attachReminderFields(box){
  const on = box.querySelector('#mfRemOn'), rb = box.querySelector('#mfRemBox');
  on.onchange = ()=>{ rb.hidden = !on.checked; };
  box.querySelectorAll('.day-chip').forEach(b=>b.onclick = ()=> b.classList.toggle('on'));
}
function readReminderFields(){
  const box = document.querySelector('#modalRoot .modal-box');
  return {
    on: box.querySelector('#mfRemOn').checked,
    time: box.querySelector('#mfRemTime').value,
    days: Array.from(box.querySelectorAll('.day-chip.on')).map(b=>Number(b.dataset.day))
  };
}
function resetReminderFields(){
  const box = document.querySelector('#modalRoot .modal-box');
  if(!box) return;
  box.querySelector('#mfRemOn').checked = false;
  box.querySelector('#mfRemBox').hidden = true;
  box.querySelector('#mfRemTime').value = DEFAULT_REMINDER_TIME;
  box.querySelectorAll('.day-chip').forEach(b=>b.classList.add('on'));
}

/* ============ Admin: Suppliers ============ */
function renderSuppliers(){
  const list = state.suppliers.length ? sortedByName(state.suppliers).map(s=>`
    <div class="list-row tappable" data-editsup="${esc(s.id)}">
      <div><div class="name">${esc(s.name)}</div><div class="meta">${esc(s.phone||'')}</div>
        ${s.reminder && s.reminder.enabled ? `<div class="meta rem-line">${ICON_BELL} ${esc(reminderText(s.reminder))}</div>` : ''}</div>
      <div class="row-actions">
        ${s.reminder && s.reminder.enabled ? `<button class="icon-btn" data-testsup="${esc(s.id)}" aria-label="${esc(t('testSupplierReminder'))}">${ICON_BELL}</button>` : ''}
        <span class="icon-btn">${ICON_EDIT}</span>
        <button class="icon-btn danger" data-delsup="${esc(s.id)}">${ICON_DELETE}</button>
      </div>
    </div>`).join('') : emptyState(t('noSuppliersYet'));
  return `
    <div class="action-row">
      <button class="btn btn-primary add-btn" id="supAddBtn">${ICON_PLUS} ${t('addSupplier')}</button>
      <button class="btn btn-ghost" data-gorecord="supplier">${NAV_ICONS.record} ${t('record')}</button>
    </div>
    <div class="section-title">${t('suppliers')} (${state.suppliers.length})</div>${list}`;
}
function openSupplierModal(id){
  const existing = id ? state.suppliers.find(s=>s.id===id) : null;
  if(id && !existing) return;
  showFormModal({
    title: existing ? t('editSupplier') : t('addSupplier'),
    banner: existing ? editingBanner(existing.name, existing.phone) : '',
    bodyHtml: `
      <div class="field"><label>${t('name')}</label><input id="mfName" data-clear="1" autocomplete="off" value="${esc(existing?.name||'')}"></div>
      <div class="field"><label>${t('phone')}</label><input id="mfPhone" data-clear="1" inputmode="tel" placeholder="07xxxxxxxxx" value="${esc(existing?.phone||'')}"></div>
      ${reminderFieldsHtml(existing?.reminder)}`,
    okLabel: t('save'),
    againLabel: existing ? null : t('saveAndAddAnother'),
    onOpen: (box)=> attachReminderFields(box),
    onSubmit: async (again)=>{
      const name = document.getElementById('mfName').value.trim();
      const phone = document.getElementById('mfPhone').value.trim();
      if(!name) return {error: t('nameRequired')};
      const rem = readReminderFields();
      if(rem.on){
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(rem.time)) return {error: t('reminderTimeInvalid')};
        if(!rem.days.length) return {error: t('reminderDaysRequired')};
      }
      const remDays = DAY_ORDER.filter(d=>rem.days.includes(d));
      const newRem = rem.on ? {enabled:true, time:rem.time, days:remDays} : null;
      const newCode = reminderCode(newRem);
      const now = new Date().toISOString();
      if(existing){
        const s = state.suppliers.find(x=>x.id===existing.id);
        if(!s) return {};
        const oldCode = reminderCode(s.reminder);
        const fields = diffFields([['name', s.name, name], ['phone', s.phone, phone], ['reminder', oldCode, newCode]]);
        if(!fields.length) return {};   // nothing changed -- nothing to save or record
        s.name = name; s.phone = phone;
        if(oldCode !== newCode){
          // updatedAt tells the server when the reminder was last changed, so a time that
          // has already passed today starts tomorrow instead of firing the moment you save.
          s.reminder = rem.on ? {...newRem, updatedAt: now} : {...(s.reminder||{}), enabled:false, updatedAt: now};
        }
        await sset('suppliers', state.suppliers, true);
        logActivity({action:'edit', type:'supplier', name, fields});
      } else {
        state.suppliers.push({id:'s'+Date.now(), name, phone, ...(rem.on ? {reminder:{...newRem, updatedAt: now}} : {})});
        await sset('suppliers', state.suppliers, true);
        logActivity({action:'add', type:'supplier', name,
          fields:[{k:'name', to:name}].concat(phone ? [{k:'phone', to:phone}] : [])
                 .concat(rem.on ? [{k:'reminder', to:newCode}] : [])});
      }
      render();
      if(again){ resetReminderFields(); return {keepOpen:true, message:t('savedMsg')(name)}; }
      return {};
    }
  });
}
function attachSupplierEvents(){
  document.getElementById('supAddBtn').onclick = ()=> openSupplierModal(null);
  document.querySelectorAll('[data-editsup]').forEach(row=>row.onclick=()=> openSupplierModal(row.dataset.editsup));
  document.querySelectorAll('[data-testsup]').forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();   // don't also open the edit popup
    const sup = state.suppliers.find(s=>s.id===b.dataset.testsup);
    if(!sup) return;
    if(!(await showConfirm(`<b>${esc(sup.name)}</b><br>${t('confirmTestSupplier')}`, {okLabel:t('notifSend'), okClass:'btn-primary'}))) return;
    reportSendResult(await callSendPush('supplier-test', {supplierId: sup.id}));
  });
  document.querySelectorAll('[data-delsup]').forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();   // don't also open the edit popup
    const id = b.dataset.delsup;
    const sup = state.suppliers.find(s=>s.id===id);
    if(!sup) return;
    if(!(await showConfirm(`<b>${esc(sup.name)}</b><br>${t('confirmDeleteSupplier')}`))) return;
    const unassigned = state.items.filter(i=>i.supplierId===id).length;
    state.suppliers = state.suppliers.filter(s=>s.id!==id);
    state.items.forEach(i=>{ if(i.supplierId===id) i.supplierId=null; });
    if(state.itemFormSupplierId === id) state.itemFormSupplierId = null;
    await sset('suppliers', state.suppliers, true);
    await sset('items', state.items, true);
    logActivity({action:'delete', type:'supplier', name:sup.name, unassigned,
      fields:[{k:'name', from:sup.name}].concat(sup.phone ? [{k:'phone', from:sup.phone}] : [])});
    render();
  });
}

/* ============ Admin: Items ============ */
function renderItemsAdmin(){
  const groups = {};
  state.items.forEach(i=>{ const key=i.supplierId||'__none'; (groups[key] ||= []).push(i); });
  const list = state.items.length ? Object.keys(groups).sort((a,b)=>nameCollator().compare(a==='__none'?t('noSupplier'):supplierName(a), b==='__none'?t('noSupplier'):supplierName(b))).map(key=>{
    const label=key==='__none'?t('noSupplier'):supplierName(key); const groupItems=sortedByName(groups[key]);
    const rows=groupItems.map(i=>`
    <div class="list-row tappable" data-edititem="${esc(i.id)}">
      <div><div class="name">${esc(i.name)}</div><div class="meta">${esc(unitLabel(i.unit))} \u00b7 ${i.supplierId?esc(supplierName(i.supplierId)):t('noSupplier')}</div></div>
      <div class="row-actions">
        <span class="icon-btn">${ICON_EDIT}</span>
        <button class="icon-btn danger" data-delitem="${esc(i.id)}">${ICON_DELETE}</button>
      </div>
    </div>`).join('');
    return `<section class="supplier-group admin-item-group"><div class="supplier-head"><span>${esc(label)}</span><span>${groupItems.length}</span></div><div class="admin-item-grid">${rows}</div></section>`;
  }).join('') : emptyState(t('noItemsYet'));
  return `
    <div class="action-row">
      <button class="btn btn-primary add-btn" id="itemAddBtn">${ICON_PLUS} ${t('addItem')}</button>
      <button class="btn btn-ghost" data-gorecord="item">${NAV_ICONS.record} ${t('record')}</button>
    </div>
    <div class="section-title">${t('items')} (${state.items.length})</div>${list}`;
}
function openItemModal(id){
  const existing = id ? state.items.find(i=>i.id===id) : null;
  if(id && !existing) return;
  const unitOptions = state.units.map(u=>`<option value="${esc(u.id)}" ${existing?.unit===u.id?'selected':''}>${esc(state.lang==='ku'?(u.ku||u.en):u.en)}</option>`).join('');
  // While adding a fresh item, the last supplier picked stays selected so
  // bulk-adding items for one supplier doesn't need reselecting each time.
  const currentSupplierId = existing ? existing.supplierId : state.itemFormSupplierId;
  const supOptions = `<option value="">${t('noSupplier')}</option>` + state.suppliers.map(s=>`<option value="${esc(s.id)}" ${currentSupplierId===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  const lockedSupplier = !existing && state.itemFormSupplierId ? state.suppliers.find(s=>s.id===state.itemFormSupplierId) : null;
  const banner = existing
    ? editingBanner(existing.name, `${unitLabel(existing.unit)} \u00b7 ${existing.supplierId ? supplierName(existing.supplierId) : t('noSupplier')}`)
    : '';
  showFormModal({
    title: existing ? t('editItem') : t('addItem'),
    banner,
    bodyHtml: `
      <div class="field"><label>${t('name')}</label><input id="mfName" data-clear="1" autocomplete="off" value="${esc(existing?.name||'')}"></div>
      <div class="field"><label>${t('unit')}</label><select id="mfUnit">${unitOptions}</select></div>
      <div class="field">
        <label>${t('supplier')}</label>
        <select id="mfSupplier">${supOptions}</select>
        ${existing ? '' : `<div class="field-hint" id="mfSupHint">${lockedSupplier ? esc(t('supplierStaysSelected')(lockedSupplier.name)) : ''}</div>`}
      </div>`,
    okLabel: t('save'),
    againLabel: existing ? null : t('saveAndAddAnother'),
    onOpen: (box)=>{
      const sel = box.querySelector('#mfSupplier');
      const hint = box.querySelector('#mfSupHint');
      if(sel && hint) sel.onchange = ()=>{
        const s = state.suppliers.find(x=>x.id===sel.value);
        hint.textContent = s ? t('supplierStaysSelected')(s.name) : '';
      };
    },
    onSubmit: async (again)=>{
      const name = document.getElementById('mfName').value.trim();
      const unit = document.getElementById('mfUnit').value;
      const supplierId = document.getElementById('mfSupplier').value || null;
      if(!name) return {error: t('nameRequired')};
      const newSupName = supplierId ? (state.suppliers.find(s=>s.id===supplierId)?.name || '') : '';
      if(existing){
        const i = state.items.find(x=>x.id===existing.id);
        if(!i) return {};
        const oldSupName = i.supplierId ? (state.suppliers.find(s=>s.id===i.supplierId)?.name || '') : '';
        const fields = diffFields([
          ['name', i.name, name],
          ['unit', unitEn(i.unit), unitEn(unit)],
          ['supplier', oldSupName, newSupName]
        ]);
        if(!fields.length) return {};   // nothing changed -- nothing to save or record
        i.name = name; i.unit = unit; i.supplierId = supplierId;
        await sset('items', state.items, true);
        logActivity({action:'edit', type:'item', name, fields});
      } else {
        state.items.push({id:'i'+Date.now(), name, unit, supplierId});
        state.itemFormSupplierId = supplierId; // keep it locked in for the next item
        await sset('items', state.items, true);
        logActivity({action:'add', type:'item', name, fields:[
          {k:'name', to:name}, {k:'unit', to:unitEn(unit)}, {k:'supplier', to:newSupName}
        ]});
      }
      render();
      if(again) return {keepOpen:true, message:t('savedMsg')(name)};
      return {};
    }
  });
}
function attachItemEvents(){
  document.getElementById('itemAddBtn').onclick = ()=> openItemModal(null);
  document.querySelectorAll('[data-edititem]').forEach(row=>row.onclick=()=> openItemModal(row.dataset.edititem));
  document.querySelectorAll('[data-delitem]').forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();   // don't also open the edit popup
    const id = b.dataset.delitem;
    const item = state.items.find(i=>i.id===id);
    if(!item) return;
    if(!(await showConfirm(`<b>${esc(item.name)}</b><br>${t('confirmDeleteItem')}`))) return;
    const supName = item.supplierId ? (state.suppliers.find(s=>s.id===item.supplierId)?.name || '') : '';
    state.items = state.items.filter(i=>i.id!==id);
    delete state.cart[id];
    await sset('items', state.items, true);
    logActivity({action:'delete', type:'item', name:item.name, fields:[
      {k:'name', from:item.name}, {k:'unit', from:unitEn(item.unit)}, {k:'supplier', from:supName}
    ]});
    render();
  });
}

/* ============ Admin: Units ============ */
function renderUnits(){
  const chips = state.units.map(u=>`
    <span class="unit-chip">${esc(state.lang==='ku'?(u.ku||u.en):u.en)}
      <button data-delunit="${u.id}">✕</button>
    </span>`).join('');
  return `
    <div class="section-title">${t('units')}</div>
    <div>${chips || emptyState(t('noUnitsYet'))}</div>
    <div class="section-title">${t('addUnit')}</div>
    <div class="form-card">
      <div class="field"><label>English</label><input id="unitEn" placeholder="${t('unitNamePlaceholder')}"></div>
      <div class="field"><label>Kurdish</label><input id="unitKu" placeholder="${t('unitNameKuPlaceholder')}"></div>
      <div class="form-actions"><button class="btn btn-primary" id="unitAddBtn">${t('add')}</button></div>
    </div>`;
}
function attachUnitEvents(){
  document.getElementById('unitAddBtn').onclick = async ()=>{
    const en = document.getElementById('unitEn').value.trim();
    const ku = document.getElementById('unitKu').value.trim();
    if(!en) return;
    state.units.push({id:'u'+Date.now(), en, ku});
    await sset('units', state.units, true);
    logActivity({action:'add', type:'unit', name:en,
      fields:[{k:'name', to:en}].concat(ku ? [{k:'nameKu', to:ku}] : [])});
    render();
  };
  document.querySelectorAll('[data-delunit]').forEach(b=>b.onclick=async()=>{
    const id = b.dataset.delunit;
    const unit = state.units.find(u=>u.id===id);
    if(!unit) return;
    if(!(await showConfirm(`<b>${esc(unit.en)}</b><br>${t('confirmDeleteUnit')}`))) return;
    state.units = state.units.filter(u=>u.id!==id);
    await sset('units', state.units, true);
    logActivity({action:'delete', type:'unit', name:unit.en,
      fields:[{k:'name', from:unit.en}].concat(unit.ku ? [{k:'nameKu', from:unit.ku}] : [])});
    render();
  });
}

/* ============ Admin: Devices ============ */
/* Its own admin tab: which devices are logged in right now, when each one
   last logged in, and when it was last seen using the app. */
/* Logged in = signed in AND no log-out waiting for it. A device an admin has
   already logged out counts as logged out even if it hasn't opened the app yet. */
function isLoggedIn(d){
  return !!d.loggedIn && !(commandIsPending(d) && d.command.type === 'logout');
}
function deviceStatus(d){
  if(!isLoggedIn(d)) return 'out';
  const seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
  return (Date.now() - seen <= ACTIVE_WINDOW_MS) ? 'active' : 'idle';
}
function timeAgo(iso){
  if(!iso) return '\u2014';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if(mins < 1) return t('agoNow');
  if(mins < 60) return t('agoMin')(mins);
  const hrs = Math.floor(mins / 60);
  if(hrs < 24) return t('agoHour')(hrs);
  return t('agoDay')(Math.floor(hrs / 24));
}
function fmtDateTime(iso){
  if(!iso) return '\u2014';
  return new Date(iso).toLocaleString(state.lang==='ku' ? 'en-GB' : 'en-US',
    {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
}
function renderDevices(){
  const visible = state.devices.filter(isLoggedIn);
  const head = `
    <div class="action-row">
      <div class="section-title" style="flex:1;margin:0;">${t('devicesTitle')} (${visible.length})</div>
      <button class="btn btn-ghost" id="devRefreshBtn">${ICON_REFRESH} ${t('refresh')}</button>
    </div>`;
  if(!visible.length) return `${head}${emptyState(t('noDevicesYet'))}`;

  const rank = {active:0, idle:1, out:2};
  const sorted = [...visible].sort((a,b)=>
    rank[deviceStatus(a)] - rank[deviceStatus(b)] ||
    new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0));
  const loggedInCount = visible.length;
  const activeCount = visible.filter(d=>deviceStatus(d)==='active').length;

  const hero = `<div class="hero-card">
    <div class="hero-eyebrow">${t('devicesLoggedInEyebrow')}</div>
    <div class="hero-stat">${t('devicesLoggedInStat')(loggedInCount)}</div>
    <div class="hero-sub">${t('devicesActiveSub')(activeCount)}</div>
  </div>`;

  const others = otherDevices().filter(isLoggedIn);
  const bulk = `<div class="dev-bulk">
      <button class="btn btn-primary" id="devNotifyBtn">${ICON_BELL} ${t('sendUpdateNotif')}</button>
      ${others.length ? `<button class="btn btn-primary" id="devRefreshAllBtn">${ICON_REFRESH} ${t('refreshAllDevices')}</button>
      <button class="btn btn-danger" id="devLogoutAllBtn" ${others.some(isLoggedIn)?'':'disabled'}>${t('logoutAllOthers')}</button>` : ''}
    </div>`;

  const cards = sorted.map(d=>{
    const st = deviceStatus(d);
    const isThis = d.id === state.deviceId;
    const roleLabel = d.role === 'admin' ? t('deviceRoleAdmin') : t('deviceRoleStaff');
    const badge = ({active:t('statusActive'), idle:t('statusLoggedIn'), out:t('statusLoggedOut')})[st];
    const logins = (d.logins && d.logins.length ? d.logins : (d.lastLogin ? [d.lastLogin] : [])).slice(0, 5);
    const recent = logins.length > 1
      ? `<div class="rec-line dev-recent"><span class="rec-k">${t('recentLogins')}</span> ${logins.map(fmtDateTime).join(' \u00b7 ')}</div>`
      : '';
    return `<div class="dev-card">
      <div class="dev-top">
        <div class="dev-name">${esc(d.nickname) || t('unnamedDevice')}${isThis ? ` <span class="dev-this">\u00b7 ${t('thisDevice')}</span>` : ''}</div>
        <div class="row-actions"><button class="icon-btn" data-editdevice="${esc(d.id)}">${ICON_EDIT}</button></div>
      </div>
      <div class="dev-status"><span class="dev-badge dev-${st}">${badge}</span><span class="dev-role">${roleLabel}</span></div>
      <div class="rec-line"><span class="rec-k">${t('lastLoginLabel')}</span> ${fmtDateTime(d.lastLogin)}${d.lastLogin ? ` <span class="dev-ago">(${timeAgo(d.lastLogin)})</span>` : ''}</div>
      ${d.lastSeen ? `<div class="rec-line"><span class="rec-k">${t('lastSeenLabel')}</span> ${timeAgo(d.lastSeen)}</div>` : ''}
      ${recent}
      ${commandIsPending(d) ? `<div class="dev-pending">${d.command.type==='logout'?t('cmdLogoutPending'):t('cmdRefreshPending')} \u00b7 ${timeAgo(d.command.ts)}</div>` : ''}
      ${isThis ? '' : `<div class="dev-actions">
        <button class="btn btn-ghost" data-devrefresh="${esc(d.id)}">${ICON_REFRESH} ${t('refreshDevice')}</button>
        ${isLoggedIn(d) ? `<button class="btn btn-danger" data-devlogout="${esc(d.id)}">${t('logoutDevice')}</button>` : ''}
      </div>`}
    </div>`;
  }).join('');

  return `${head}${hero}${bulk}${cards}<div class="dev-hint">${t('devicesHint')}</div>`;
}
function openDeviceModal(id){
  const d = state.devices.find(x=>x.id===id);
  if(!d) return;
  showFormModal({
    title: t('renameDevice'),
    banner: editingBanner(d.nickname || t('unnamedDevice'), d.role === 'admin' ? t('deviceRoleAdmin') : t('deviceRoleStaff')),
    bodyHtml: `<div class="field"><label>${t('renameDevice')}</label><input id="mfNickname" autocomplete="off" placeholder="${esc(t('deviceNamePlaceholder'))}" value="${esc(d.nickname||'')}"></div>`,
    okLabel: t('save'),
    onSubmit: async ()=>{
      const val = document.getElementById('mfNickname').value.trim();
      if(val === (d.nickname || '')) return {};   // unchanged
      if(id === state.deviceId) lset('deviceNickname', val);
      await updateDevice(id, x=>{ x.nickname = val; });
      return {};
    }
  });
}
function attachDeviceEvents(){
  document.querySelectorAll('[data-editdevice]').forEach(b=>b.onclick=()=> openDeviceModal(b.dataset.editdevice));
  const r = document.getElementById('devRefreshBtn');
  if(r) r.onclick = ()=> refreshDevices();

  document.querySelectorAll('[data-devlogout]').forEach(b=>b.onclick=async()=>{
    const d = state.devices.find(x=>x.id===b.dataset.devlogout);
    if(!d) return;
    const name = esc(d.nickname) || t('unnamedDevice');
    if(!(await showConfirm(`<b>${name}</b><br>${t('confirmLogoutDevice')}`, {okLabel:t('logoutDevice')}))) return;
    await sendDeviceCommand('logout', [d.id]);
  });
  document.querySelectorAll('[data-devrefresh]').forEach(b=>b.onclick=async()=>{
    const d = state.devices.find(x=>x.id===b.dataset.devrefresh);
    if(!d) return;
    const name = esc(d.nickname) || t('unnamedDevice');
    if(!(await showConfirm(`<b>${name}</b><br>${t('confirmRefreshDevice')}`, {okLabel:t('refreshDevice'), okClass:'btn-primary'}))) return;
    await sendDeviceCommand('refresh', [d.id]);
  });
  const notifyBtn = document.getElementById('devNotifyBtn');
  if(notifyBtn) notifyBtn.onclick = ()=> sendUpdateNotification();
  const allRefresh = document.getElementById('devRefreshAllBtn');
  if(allRefresh) allRefresh.onclick = async()=>{
    const ids = otherDevices().filter(isLoggedIn).map(d=>d.id);
    if(!ids.length) return;
    if(!(await showConfirm(t('confirmRefreshAll')(ids.length), {okLabel:t('refreshAllDevices'), okClass:'btn-primary'}))) return;
    await sendDeviceCommand('refresh', ids);
  };
  const allLogout = document.getElementById('devLogoutAllBtn');
  if(allLogout) allLogout.onclick = async()=>{
    const ids = otherDevices().filter(isLoggedIn).map(d=>d.id);
    if(!ids.length) return;
    if(!(await showConfirm(t('confirmLogoutAll')(ids.length), {okLabel:t('logoutAllOthers')}))) return;
    await sendDeviceCommand('logout', ids);
  };
}

/* ============ Admin: Settings ============ */
function renderSettings(){
  // PINs/cloud config live only in the database, gated by functions that
  // require proof the caller already knows the current value -- so an
  // admin who reloaded the page (and lost the in-memory PIN they typed
  // at login) has to re-enter it once before this screen will do anything.
  if(!state.adminPinEntered){
    return `
      <div class="section-title">${t('settings')}</div>
      <div class="form-card">
        <div class="field-hint" style="margin-bottom:10px;">${t('reenterAdminPinMsg')}</div>
        <div class="field"><label>${t('adminPin')}</label><input id="reenterAdminPin" type="password" maxlength="6" inputmode="numeric"></div>
        <div class="form-actions"><button class="btn btn-primary" id="reenterAdminPinBtn">${t('unlock')}</button></div>
      </div>`;
  }

  const pinsCard = `
    <div class="section-title">${t('changePins')}</div>
    <div class="form-card">
      <div class="field"><label>${t('adminPin')}</label><input id="adminPinInput" maxlength="6" inputmode="numeric" value="${esc(state.settings.adminPin||'')}"></div>
      <div class="field"><label>${t('userPin')}</label><input id="userPinInput" maxlength="6" inputmode="numeric" value="${esc(state.settings.userPin||'')}"></div>
      <div class="form-actions"><button class="btn btn-primary" id="pinsSaveBtn">${t('savePins')}</button></div>
    </div>`;

  return `${pinsCard}${renderNotifSettings()}`;
}
/* ---- Settings: Notifications card (this device + daily reminder) ---- */
function renderNotifSettings(){
  let device;
  if(!pushConfigured()){
    device = `<div class="notif-sub">${t('notifNotConfigured')}</div>`;
  } else if(!pushStatus.supported){
    device = `<div class="notif-sub">${t('notifUnsupported')}</div>`;
  } else if(pushStatus.subscribed){
    device = `<div class="notif-status on">${ICON_BELL} ${t('notifThisDevice')}: ${t('notifOn')}<button class="btn btn-ghost" id="pushToggleBtn">${t('notifTurnOff')}</button></div>`;
  } else {
    device = `<div class="notif-status off">${ICON_BELL} ${t('notifThisDevice')}: ${t('notifOff')}<button class="btn btn-primary" id="pushToggleBtn">${t('notifEnable')}</button></div>`;
  }
  let reminder;
  if(state.reminder === false){
    reminder = `<div class="notif-sub">${t('reminderLoadFailed')}</div>`;
  } else if(!state.reminder){
    reminder = `<div class="notif-sub">\u2026</div>`;
  } else {
    reminder = `
      <div class="notif-sub">${t('supplierRemindersHint')}</div>
      <label class="check-row"><input type="checkbox" id="reminderEnabled" ${state.reminder.enabled?'checked':''}> ${t('reminderEnabledLabel')}</label>
      <div class="field"><label>${t('reminderTimeLabel')}</label><input id="reminderTime" type="time" value="${esc(state.reminder.time)}"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="reminderSaveBtn">${t('reminderSave')}</button>
        <button class="btn btn-ghost" id="reminderTestBtn">${ICON_BELL} ${t('reminderSendNow')}</button>
      </div>`;
  }
  return `<div class="section-title">${t('notifSettingsTitle')}</div>
    <div class="form-card">${device}<hr class="notif-divider"><div class="section-title" style="margin-top:0;">${t('reminderTitle')}</div>${reminder}</div>`;
}
function attachNotifSettingsEvents(){
  if(state.reminder === null){
    loadReminder().then(r=>{ state.reminder = r || false; if(state.view === 'settings') render(); });
  }
  const tog = document.getElementById('pushToggleBtn');
  if(tog) tog.onclick = async ()=>{
    if(pushStatus.subscribed){ await disablePush(); render(); return; }
    const res = await enablePush();
    render();
    await showPushEnableResult(res);
  };
  const save = document.getElementById('reminderSaveBtn');
  if(save) save.onclick = async ()=>{
    const enabled = document.getElementById('reminderEnabled').checked;
    const time = document.getElementById('reminderTime').value;
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){ await showAlert(t('reminderSaveFailed')); return; }
    const ok = await saveReminder(enabled, time);
    if(ok === 'cancelled') return;   // PIN prompt cancelled
    if(ok !== true){ await showAlert(t('reminderSaveFailed')); return; }
    state.reminder = { enabled, time };
    await showAlert(t('reminderSaved'));
    render();
  };
  const test = document.getElementById('reminderTestBtn');
  if(test) test.onclick = async ()=> reportSendResult(await callSendPush('reminder-now'));
}
function attachSettingsEvents(){
  const reenterBtn = document.getElementById('reenterAdminPinBtn');
  if(reenterBtn){
    reenterBtn.onclick = async ()=>{
      const pin = document.getElementById('reenterAdminPin').value.trim();
      const role = await appVerifyPin(pin, {reload:false});
      if(role !== 'admin'){ await showAlert(t('wrongPin')); return; }
      state.adminPinEntered = pin;
      const pins = await appGetPins(pin);
      if(pins) state.settings = {...state.settings, adminPin: pins.adminPin, userPin: pins.userPin};
      render();
    };
    return; // nothing else is on the page in this state
  }

  attachNotifSettingsEvents();

  document.getElementById('pinsSaveBtn').onclick = async ()=>{
    const ap = document.getElementById('adminPinInput').value.trim();
    const up = document.getElementById('userPinInput').value.trim();
    if(ap.length!==ADMIN_PIN_LEN || up.length!==USER_PIN_LEN){ await showAlert(t('pinsInvalidLength')); return; }
    if(ap.startsWith(up)){ await showAlert(t('pinsPrefixConflict')); return; }
    const ok = await appSetPins(state.adminPinEntered, ap, up);
    if(!ok){ await showAlert(t('pinsSaveFailed')); return; }
    state.adminPinEntered = ap;
    state.settings = {...state.settings, adminPin: ap, userPin: up};
    await showAlert(t('pinsSaved'));
    render();
  };
}

boot();
