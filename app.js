/* Ricotta Orders -- app state, rendering and event handlers.
   Depends on: DEFAULT_UNITS, PIN consts (config.js), T (i18n.js), icon strings
   (icons.js), lget/lset/api/apiLogin/apiSession/sendOrQueue/flushOutbox
   (storage.js), showConfirm/showAlert/showPrompt/showFormModal/showForcedRefresh
   (modals.js), push helpers (push.js), Rico (assistant.js), hardReload
   (update-check.js). Load this file after all of those; it calls boot() at
   the end.

   Two accounts sign in with their own PIN:
     rozha  every screen
     yunis  Order, Rico, History (cannot delete), Suppliers, Items, Record, Units
   The server decides which screens an account may open (bootstrap.views) and
   enforces the same rules on every request. */
/* ============ State ============ */
const state = {
  lang: 'en',
  account: null,        // 'rozha' | 'yunis' | null (signed out)
  name: '',             // "Rozha" / "Yunis"
  tabs: ['order','assistant','history'],   // this account's three tab-bar screens
  views: [],            // every screen this account may open
  view: 'order',
  pinBuffer: '',
  pinError: '',         // '' | 'wrong' | 'locked' | 'network' | 'session'
  pinBusy: false,       // PIN is being checked with the server
  suppliers: [],
  items: [],
  units: [],
  history: [],
  cart: {},              // itemId -> qty
  search: '',
  orderTab: 'all',        // 'all' | supplierId | '__none'
  itemFormSupplierId: null, // supplier "locked in" for the add-item form
  queue: null,           // array of {supplierId, items, sent} while sending
  activity: [],          // the Record: [{id, ts, action, type, name, fields, by, role}]
  recordFilter: 'all',   // 'all' | 'supplier' | 'item' | 'unit'
  devices: [],           // [{id, account, label, lastLogin, lastSeen, loggedIn, command, handledCommand}]
  deviceId: null,        // this device's own id, generated once and kept locally
  reminder: null,        // daily reminder settings {enabled,time}
  apiOnline: navigator.onLine
};

const LANGS = ['en','ku','ar'];
const LANG_NAMES = {en:'English', ku:'کوردی', ar:'العربية'};
/* A translation for the current language (English if a key is missing). */
function t(key){ const v = T[state.lang] && T[state.lang][key]; return v !== undefined ? v : T.en[key]; }
const isRtl = ()=> state.lang !== 'en';
const isRozha = ()=> state.account === 'rozha';
const canOpen = view=> state.views.includes(view) || view === 'queue';
/* Dates and times always use the digits 1 2 3, in every language. */
function intlLocale(){ return ({en:'en-US', ku:'ckb-IQ', ar:'ar-IQ'})[state.lang] + '-u-nu-latn'; }
const IRAQ_TIME_ZONE = 'Asia/Baghdad';
function formatIraqDateTime(value, options={}){
  const date = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(date.getTime())) return '\u2014';
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: IRAQ_TIME_ZONE, hour12:true, ...options
  }).format(date);
}
/* Reminder values are stored as an Iraq wall-clock HH:MM value for the
   scheduler. Format that value with AM/PM without shifting its hour. */
function formatStoredIraqTime(value){
  const match=String(value||'').match(/^(\d{1,2}):(\d{2})$/);
  if(!match) return value || '\u2014';
  const date=new Date(Date.UTC(2000,0,1,Number(match[1]),Number(match[2])));
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone:'UTC', hour:'numeric', minute:'2-digit', hour12:true
  }).format(date);
}
/* Consistent "nothing here yet" block, used for every empty list. */
function emptyState(msg){
  return `<div class="empty">${ICON_EMPTY}<div class="empty-text">${msg}</div></div>`;
}
/* Escapes text before it's inserted into innerHTML, so a typed name can
   never break out of its tag and inject HTML. */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* Small, self-dismissing confirmation at the bottom of the screen -- used for
   successes, so they don't need an extra tap like a popup does. */
let toastTimer = null;
function toast(msg, kind='ok', {undo} = {}){
  let el = document.getElementById('toast');
  if(!el){ el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.className = 'toast ' + kind + (undo ? ' has-undo' : '');
  el.textContent = '';
  const text = document.createElement('span'); text.textContent = msg; text.dir = 'auto'; el.appendChild(text);
  if(undo){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-undo'; b.textContent = t('undo');
    b.onclick = ()=>{ clearTimeout(toastTimer); el.classList.remove('show'); undo(); };
    el.appendChild(b);
  }
  requestAnimationFrame(()=> el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), undo ? 4800 : 2600);
}

/* ============ Devices ============
   The server keeps one row per device. This device reports "still here"
   every couple of minutes while the app is open (so Rozha can tell "active
   now" from "signed in but idle") and polls for remote commands from the
   Devices screen (log out / refresh). */
const HEARTBEAT_MS = 2*60*1000;       /* how often an open app reports "still here" */
const ACTIVE_WINDOW_MS = 5*60*1000;   /* seen within this long ago = "active now" */
const COMMAND_POLL_MS = 15*1000;

/* A random id for this device, created once and remembered. Not a secret --
   just a way to recognise "this same phone" across sign-ins. */
function ensureDeviceId(){
  let id = lget('deviceId');
  if(!id){
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('d'+Date.now()+Math.random().toString(36).slice(2));
    lset('deviceId', id);
  }
  return id;
}
function myDevice(){ return state.devices.find(d=>d.id===state.deviceId); }
/* "iPhone 16/17 Pro Max" and "App" / "Website" from the label the device sends. */
function deviceParts(d){
  const [kind, how] = String(d.label || '').split('|');
  return {kind: kind || t('deviceNotReported'), how: how === 'App' ? t('deviceApp') : how ? t('deviceWebsite') : ''};
}
function deviceTitle(d){ const p = deviceParts(d); return `${accountLabel(d.account) || t('unnamedDevice')} \u00b7 ${p.kind}`; }
function otherDevices(){ return state.devices.filter(d=>d.id !== state.deviceId); }
function commandIsPending(d){ return !!(d.command && d.command.id !== d.handledCommand); }

function heartbeat(){
  if(!state.account) return;
  api('devices/me', {method:'POST', body:{}});
  flushOutbox();
}
/* Keep the unfinished order on this device so closing or refreshing the app
   does not discard the quantities the user has selected. */
function persistCartDraft(){
  if(!state.account) return;
  const draft=Object.fromEntries(Object.entries(state.cart).filter(([,qty])=>Number.isFinite(Number(qty)) && Number(qty)>0));
  lset('pendingCart:'+state.account,Object.keys(draft).length?draft:null);
}
function restoreCartDraft(){
  if(!state.account) return;
  let saved=lget('pendingCart:'+state.account);
  // Move drafts from older releases into the account opening them once.
  const legacy=lget('pendingCart');
  if(!saved && legacy){
    saved=legacy;
    if(lset('pendingCart:'+state.account,legacy)) lset('pendingCart',null);
  } else if(legacy && saved) lset('pendingCart',null);
  if(!saved || typeof saved!=='object' || Array.isArray(saved)) return;
  const available=new Set(state.items.map(item=>item.id));
  state.cart=Object.fromEntries(Object.entries(saved).filter(([id,qty])=>available.has(id) && Number.isFinite(Number(qty)) && Number(qty)>0).map(([id,qty])=>[id,Math.floor(Number(qty))]));
  persistCartDraft();
}

/* Rozha's Devices screen: tell other devices to log out or refresh. */
async function sendDeviceCommand(type, ids){
  const r = await api('devices/command', {method:'POST', body:{type, ids}});
  if(!r.ok){ await showAlert(t('saveFailed')); return; }
  await refreshDevices();
}
/* Device side: pick up a command aimed at this device. Rozha also gets the
   fresh device list for the Devices screen from the same request. */
let commandCheckBusy = false;
let forcedRefreshOpen = false;
async function checkCommands(){
  if(commandCheckBusy || !state.account) return;
  commandCheckBusy = true;
  try{
    const r = await api('devices');
    if(r.ok && Array.isArray(r.data)){
      const changed = JSON.stringify(r.data) !== JSON.stringify(state.devices);
      state.devices = r.data;
      if(changed && state.view === 'devices') render();
      const me = myDevice();
      if(me && commandIsPending(me) && me.command.id !== lget('handledCommand')) await runCommand(me.command);
    }
  }finally{ commandCheckBusy = false; }
}
async function runCommand(cmd){
  const session = apiSession();
  if(!session || !state.account) return;
  lset('handledCommand', cmd.id);
  if(cmd.type === 'logout'){
    await api('devices/me/ack', {method:'POST', body:{commandId:cmd.id}});
    if(!apiSessionMatches(session)) return;
    signOut(t('forcedLogoutMsg'));
  } else if(cmd.type === 'refresh'){
    if(forcedRefreshOpen) return;
    forcedRefreshOpen = true;
    const accepted = await showForcedRefresh(t('refreshRequiredTitle'), t('refreshRequiredMsg'), t('refreshNow'));
    if(!accepted || !apiSessionMatches(session)) return;
    await api('devices/me/ack', {method:'POST', body:{commandId:cmd.id}});
    if(!apiSessionMatches(session)) return;
    await hardReload();
  }
}
async function refreshDevices(){
  const r = await api('devices');
  if(r.ok && Array.isArray(r.data)){
    state.devices = r.data;
    if(state.view === 'devices') render();
  }
}
const isVisible = ()=> document.visibilityState === 'visible';
setInterval(()=>{ if(isVisible()) checkCommands(); }, COMMAND_POLL_MS);
setInterval(()=>{ if(isVisible()) heartbeat(); }, HEARTBEAT_MS);
document.addEventListener('visibilitychange', ()=>{
  if(isVisible() && state.account){ checkCommands(); heartbeat(); }
});

/* ============ Connection status ============ */
function setApiHealth(online){
  const next = !!online && navigator.onLine;
  if(next === state.apiOnline) return;
  state.apiOnline = next;
  const el = document.getElementById('connectionStatus');
  if(el){ el.classList.toggle('offline', !next); el.innerHTML = `<span></span><em>${next ? t('online') : t('offline')}</em>`; }
  if(next) flushOutbox();
}
window.addEventListener('online', ()=>{ api('health'); });
window.addEventListener('offline', ()=> setApiHealth(false));

/* ============ Session ============ */
/* An account's name written in the current language's script. */
function accountLabel(a){ return a === 'rozha' || a === 'yunis' ? t('accountName')(a) : ''; }
/* Screens each account may open. The server sends the real list with every
   start (bootstrap.views) and checks every request; this copy only covers
   an offline start before that answer arrives. */
const ACCOUNT_VIEWS = {
  rozha: ['order','assistant','history','transfers','stock','suppliers','itemsAdmin','units','record','devices','settings'],
  yunis: ['order','assistant','history','transfers','stock','suppliers','itemsAdmin','units','record']
};
const DEFAULT_TABS = ['order','assistant','history'];
const STOCK_VIEWS = ['transfers','stock','receipts'];
/* Screens that only hold this device's own preferences: every account has
   them, the server never needs to know, and they can't be one of the 3 tabs. */
const DEVICE_VIEWS = ['sounds'];
const tabChoices = ()=>state.views.filter(v=>!DEVICE_VIEWS.includes(v));
function validTabs(tabs){
  const list = Array.isArray(tabs) ? [...new Set(tabs)].filter(v=>tabChoices().includes(v)) : [];
  return list.length === 3 ? list : DEFAULT_TABS.filter(v=>state.views.includes(v));
}
/* Who is signed in (from the sign-in answer, the saved session or bootstrap). */
function applyAccount(a){
  state.account = a.account === 'rozha' || a.account === 'yunis' ? a.account : null;
  state.name = a.name || ({rozha:'Rozha', yunis:'Yunis'})[state.account] || '';
  const views = Array.isArray(a.views) && a.views.length ? a.views : (ACCOUNT_VIEWS[state.account] || []);
  // Transfer and Stock are added here (both accounts have them); the older server list doesn't know them.
  const withStock = state.account ? [...views, ...STOCK_VIEWS.filter(v=>!views.includes(v))] : views;
  state.views = state.account ? [...withStock.filter(v=>!DEVICE_VIEWS.includes(v)), ...DEVICE_VIEWS] : [];
  state.tabs = validTabs(a.tabs);
  if(!canOpen(state.view)) state.view = state.tabs[0] || 'order';
}
/* Loads everything this account needs from the server in one request. */
async function loadData(){
  const r = await api('bootstrap');
  if(!r.ok || !r.data || !r.data.account) return false;
  const d = r.data;
  applyAccount(d);
  saveSessionAccount();
  state.suppliers = d.suppliers || [];
  state.items = d.items || [];
  state.units = (d.units && d.units.length) ? d.units : DEFAULT_UNITS;
  state.history = d.history || [];
  state.historyHasMore = !!d.historyHasMore;
  state.historyOldestLoaded = d.historyOldestLoaded || null;
  state.devices = d.devices || [];
  state.activity = d.activity || [];
  state.reminder = d.reminder || {enabled:false, time:'09:00'};
  state.pars = d.pars || [];
  ricoSetInbox(d.inbox || []);
  // Stock and transfers load in the background; ordering never waits for them.
  if(state.views.includes('stock')) loadStock().then(ok=>{
    if(!ok) return;
    const mine = stockState.tabs && validTabs(stockState.tabs);
    if(mine && mine.join() !== state.tabs.join()){ state.tabs = mine; saveSessionAccount(); render(); }
    else if(['transfers','stock','history','itemsAdmin'].includes(state.view)) render();
    else updateStockBadges();
  });
  return true;
}
/* Keeps the saved session's name and tabs current, so an offline start
   shows the right person and tab bar. */
function saveSessionAccount(){
  const s = apiSession();
  if(s) lset('apiSession', {...s, account:state.account, name:state.name, tabs:state.tabs});
}

/* ============ Desktop installation ============ */
let deferredInstallPrompt = null;
let installPromptDismissed = false;
function isStandaloneApp(){
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
}
function removeInstallPrompt(){ document.getElementById('installPrompt')?.remove(); }
function syncInstallPrompt(){
  removeInstallPrompt();
  if(!deferredInstallPrompt || installPromptDismissed || isStandaloneApp() || !matchMedia('(min-width:960px) and (pointer:fine)').matches) return;
  const card=document.createElement('aside');
  card.id='installPrompt'; card.className='install-prompt'; card.setAttribute('aria-label',t('installTitle'));
  card.innerHTML=`<img class="install-prompt-icon" src="icon-192.png" alt=""><div class="install-prompt-copy"><div class="install-prompt-title">${esc(t('installTitle'))}</div><div class="install-prompt-sub">${esc(t('installSub'))}</div><div class="install-prompt-actions"><button type="button" class="btn btn-ghost" id="installLaterBtn">${esc(t('installLater'))}</button><button type="button" class="btn btn-primary" id="installAppBtn">${esc(t('installAction'))}</button></div></div>`;
  document.body.appendChild(card);
  document.getElementById('installLaterBtn').onclick=()=>{ installPromptDismissed=true; removeInstallPrompt(); };
  document.getElementById('installAppBtn').onclick=async()=>{
    const prompt=deferredInstallPrompt;
    deferredInstallPrompt=null; removeInstallPrompt();
    if(!prompt) return;
    await prompt.prompt();
    const choice=await prompt.userChoice;
    if(choice?.outcome!=='accepted') installPromptDismissed=true;
  };
}
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault(); deferredInstallPrompt=event;
  setTimeout(syncInstallPrompt,1200);
});
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null; installPromptDismissed=true; removeInstallPrompt(); toast(t('installComplete'));
});
document.addEventListener('dblclick',event=>event.preventDefault(),{passive:false});
/* History only loads the last ~120 days at first (bootstrap); this fetches
   one further page of older orders, on request, for the History screen. */
let loadingMoreHistory = false;
async function loadMoreHistory(){
  if(loadingMoreHistory || !state.historyOldestLoaded) return;
  loadingMoreHistory = true;
  try{
    const r = await api('history/more?before='+encodeURIComponent(state.historyOldestLoaded));
    if(r.ok && r.data){
      state.history = [...(r.data.history||[]), ...state.history];
      state.historyHasMore = !!r.data.hasMore;
      state.historyOldestLoaded = r.data.oldestLoaded || null;
      render();
    }
  } finally { loadingMoreHistory = false; }
}
/* Clears this device's sign-in and returns to the PIN pad. */
function signOut(reason, {preserveSession = false} = {}){
  ricoReset();
  if(!preserveSession) clearApiSession();
  forcedRefreshOpen = false;
  state.account = null; state.name = ''; state.views = []; state.tabs = DEFAULT_TABS.slice();
  state.suppliers = []; state.items = []; state.units = []; state.history = [];
  state.activity = []; state.devices = []; state.pars = []; state.reminder = null;
  state.cart = {}; state.search = ''; state.orderTab = 'all'; state.itemFormSupplierId = null;
  state.historyHasMore = false; state.historyOldestLoaded = null;
  ricoSuggestion.data = null; ricoSuggestion.at = 0;
  reminderDraft = null;
  resetStockUi();
  stopStepHold(); rowPress?.cancel();
  state.pinBuffer = ''; state.view = 'order'; state.queue = null;
  finishingQueue = null;
  state.pinError = reason ? 'session' : '';
  state.sessionMsg = reason || '';
  dismissAllModals();
  closeSelSheet(); closeContextMenu();
  document.getElementById('toast')?.remove(); clearTimeout(toastTimer);
  document.getElementById('welcome')?.remove();
  closeLangMenu();
  render();
}
/* A second tab can sign in or out while this tab still has the old account
   mounted. Clear that workspace without removing the second tab's session. */
function handleSessionStorage(event){
  if(!state.account || (event.key !== LS_PREFIX+'apiSession' && event.key !== null)) return;
  let before = null, after = null;
  try{ before = JSON.parse(event.oldValue || 'null')?.token || null; }catch(_){}
  try{ after = JSON.parse(event.newValue || 'null')?.token || null; }catch(_){}
  if(event.key !== null && before === after) return;
  persistCartDraft();
  signOut(t('sessionEnded'), {preserveSession: true});
}
window.addEventListener('storage', handleSessionStorage);
function doLogout(){
  api('logout', {method:'POST'});      // fire-and-forget; the token is dropped locally either way
  signOut();
}
/* Called by storage.js when the server rejects this device's session. */
function onSessionExpired(){
  if(state.account) signOut(t('sessionEnded'));
}

/* ============ Boot ============ */
let loadedOk = false;
/* Offline at start-up: show what we can, say so, and keep trying quietly. */
function retryLoad(){
  toast(t('loadFailed'), 'warn');
  const timer = setInterval(async ()=>{
    if(!state.account){ clearInterval(timer); return; }
    if(!isVisible() || !navigator.onLine) return;
    if(await loadData()){ clearInterval(timer); loadedOk = true; restoreCartDraft(); render(); }
  }, 10000);
}
async function boot(){
  state.deviceId = ensureDeviceId();
  const savedLang = lget('lang');
  state.lang = LANGS.includes(savedLang) ? savedLang : 'en';
  const session = apiSession();
  if(session && (session.account === 'rozha' || session.account === 'yunis')){
    applyAccount(session);
    loadedOk = await loadData();
    if(!loadedOk && !apiSession()) state.account = null;   // the session was rejected
    // Load the saved local draft only after the catalog is available, keeping
    // it intact if the app starts while offline and needs to retry loading.
    if(loadedOk) restoreCartDraft();
  } else if(session){
    clearApiSession();   // a sign-in from before the two accounts: sign in again
  }
  render();
  hideSplash(1450);   // long enough for the ricotta intro to finish playing
  if(state.account){ heartbeat(); checkCommands(); maybeOpenRicoProviderSetup(); }
  if(state.account && !loadedOk) retryLoad();
  // Notifications: register the service worker, read this device's status, and
  // handle being launched from a notification tap.
  initPush().then(()=>{ if(state.account) render(); handleLaunchIntent(); });
}
/* The branded loading screen lives in index.html so it shows instantly.
   It lifts away once the first real screen is on the page and style.css is
   in, and never before the intro has had time to play (so it can't flash). */
function cssReady(){
  if(window.__cssReady || getComputedStyle(document.documentElement).getPropertyValue('--bg')) return Promise.resolve();
  return new Promise(res=>{
    document.addEventListener('cssready', res, {once:true});
    setTimeout(res, 4000);   // never keep the app hidden because of a slow stylesheet
  });
}
async function hideSplash(minShown = 500){
  const el = document.getElementById('splash');
  if(!el || el.dataset.state === 'leaving') return;
  await cssReady();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) minShown=0;
  const wait = Math.max(0, minShown - (performance.now() - (window.__splashStart || 0)));
  await new Promise(r=>setTimeout(r, wait));
  el.dataset.state = 'leaving';
  document.documentElement.classList.remove('booting');
  const done = ()=> el.remove();
  el.addEventListener('animationend', e=>{ if(e.target === el) done(); });
  setTimeout(done, 1400);   // safety net
}
/* After a PIN sign-in: "Welcome back, Yunis" with Rico waving covers the
   moment the workspace loads (the ricotta splash is kept for app start). */
let welcomeShownAt = 0;
function showWelcome(name){
  document.getElementById('welcome')?.remove();
  const el = document.createElement('div');
  el.id = 'welcome'; el.className = 'welcome'; el.setAttribute('role','status');
  el.innerHTML = `<div class="welcome-card">
      ${ricoFace('excited','rico-welcome')}
      <div class="welcome-title">${esc(t('welcomeName')(name))}</div>
      <div class="welcome-sub">${esc(t('splashLoading'))}</div>
      <div class="welcome-bar"><i></i></div>
    </div>`;
  document.body.appendChild(el);
  welcomeShownAt = performance.now();
}
async function hideWelcome(minShown = 1300){
  const el = document.getElementById('welcome');
  if(!el) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) minShown = 0;
  const wait = Math.max(0, minShown - (performance.now() - welcomeShownAt));
  await new Promise(r=>setTimeout(r, wait));
  el.classList.add('leaving');
  setTimeout(()=>el.remove(), 460);
}

function applyLangClasses(){
  const rtl = isRtl();
  document.body.classList.toggle('lang-ku', state.lang === 'ku');
  document.body.classList.toggle('lang-ar', state.lang === 'ar');
  document.documentElement.classList.toggle('rtl', rtl);
  document.documentElement.lang = ({en:'en', ku:'ckb', ar:'ar'})[state.lang];
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
}

// Animate only the surface that changed. Cancelling an earlier response keeps
// rapid taps responsive, without queuing animations or rebuilding controls.
const uiMotion = new WeakMap();
function animateUi(element, frames, duration=220){
  if(!element || !element.animate) return;
  uiMotion.get(element)?.cancel();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animation=element.animate(frames,{duration,easing:'cubic-bezier(.2,.8,.2,1)'});
  uiMotion.set(element,animation);
}

/* ============ Render dispatch ============ */
// Keep the navigation shell mounted for route changes. Page changes animate
// through goView; quantity, search and supplier interactions have smaller
// update paths that never rebuild the page.
const RENDERERS = {
  order:[()=>renderOrder(),()=>attachOrderEvents()], queue:[()=>renderQueue(),()=>attachQueueEvents()],
  history:[()=>renderHistory(),()=>attachHistoryEvents()], suppliers:[()=>renderSuppliers(),()=>attachSupplierEvents()],
  itemsAdmin:[()=>renderItemsAdmin(),()=>attachItemEvents()], units:[()=>renderUnits(),()=>attachUnitEvents()],
  record:[()=>renderRecord(),()=>attachRecordEvents()], devices:[()=>renderDevices(),()=>attachDeviceEvents()],
  transfers:[()=>renderTransfers(),()=>attachTransfersEvents()], stock:[()=>renderStock(),()=>attachStockEvents()], receipts:[()=>renderReceipts(),()=>attachReceiptsEvents()],
  settings:[()=>renderSettings(),()=>attachSettingsEvents()], sounds:[()=>renderSoundsView(),()=>attachSoundsEvents()], assistant:[()=>renderAssistant(),()=>attachAssistantEvents()]
};
function render(){
  applyLangClasses();
  setThemeColor();
  const app = document.getElementById('app');
  if(!state.account){
    app.classList.toggle('static-update', app.dataset.screen === 'login');
    app.dataset.shell = ''; app.dataset.screen = 'login';
    app.innerHTML = renderLogin(); attachLoginEvents(); syncInstallPrompt(); return;
  }
  if(!canOpen(state.view)) state.view = state.tabs[0] || 'order';
  const [draw, attach] = RENDERERS[state.view] || RENDERERS.order;
  const content = `${state.view === 'assistant' ? '' : renderPageHeading()}${state.view === 'order' ? renderPushBanner() : ''}${draw()}`;
  // The shell (top bar and tab bar) stays mounted while the account, its tabs
  // and the language stay the same.
  const shellKey = [state.account, state.lang, state.tabs.join(','), state.views.join(',')].join('|');
  const keepShell = app.dataset.shell === shellKey && app.querySelector('.content');
  // Redrawing the same screen keeps your place: lists refill a moment later, and without this the page
  // would shrink for that moment and snap to the top (very visible on a phone with the keyboard up).
  const sameView = keepShell && app.dataset.screen === state.view;
  const box0 = scrollBox(), keepTop = sameView ? box0.scrollTop : null;
  if(sameView) app.querySelector('.content').style.minHeight = app.querySelector('.content').scrollHeight + 'px';
  if(keepShell){
    app.querySelector('.content').innerHTML = content;
    const stack = app.querySelector('.bottom-stack');
    stack.querySelector('.bottom-bar')?.remove();
    stack.querySelector('.rico-composer')?.remove();
    if(state.view === 'order') stack.insertAdjacentHTML('afterbegin', renderOrderBottomBar());
    if(state.view === 'assistant') stack.insertAdjacentHTML('afterbegin', renderRicoComposer());
    markActiveNav();
  }else{
    app.innerHTML = `${renderTopbar()}<main class="content" id="mainContent">${content}</main>
      <div class="bottom-stack">${state.view==='order'?renderOrderBottomBar():''}${state.view==='assistant'?renderRicoComposer():''}${renderBottomNav()}</div>`;
    attachShellEvents();
  }
  app.classList.remove('static-update');
  app.dataset.shell = shellKey; app.dataset.screen = state.view;
  attachContentEvents();
  attach();
  if(state.view !== 'assistant') document.body.classList.remove('rico-composing');
  updateRicoBadge();
  updateStockBadges();
  placeNavIndicator();
  enhanceSegments();
  enhanceSelects();
  if(keepTop !== null){
    const box = scrollBox(); box.scrollTop = keepTop;
    requestAnimationFrame(()=>{ app.querySelector('.content')?.style.removeProperty('min-height'); box.scrollTop = keepTop; });
  }
  updateTopbar();
  syncInstallPrompt();
}

/* A red dot on Rico's tab while an order is late or Rico has written first
   (checked every minute). */
function updateRicoBadge(){
  const dot = document.querySelector('.navbtn[data-view="assistant"] .nav-badge');
  if(!dot) return;
  const late = ricoLateOrders().length, unread = ricoUnread();
  dot.hidden = !(late || unread);
  dot.parentElement.setAttribute('aria-label', late ? t('ricoNavLate')(late) : unread ? t('ricoNavUnread') : t('ricoName'));
  const more = document.getElementById('navMoreBtn');
  if(more) more.classList.toggle('has-badge', !state.tabs.includes('assistant') && !!(late || unread));
}
setInterval(()=>{ if(state.account && isVisible()) updateRicoBadge(); }, 60000);

/* ============ Navigation ============
   Phones: the account's three tabs plus More (a glass panel with the other
   screens and "Edit tabs"). Computers: a sidebar with every screen. A glass
   lens glides to the current tab; on phones it can be held and slid, and
   the page itself can be swiped between the three tabs. */
const VIEW_LABEL_KEYS = {transfers:'navTransfer', stock:'navStock', receipts:'navReceipts', order:'order', assistant:'ricoName', history:'history', suppliers:'suppliers', itemsAdmin:'items', units:'units', record:'record', devices:'devicesTitle', settings:'settings', sounds:'soundsNav', queue:'sendQueueTitle'};
function viewLabel(id){ return t(VIEW_LABEL_KEYS[id] || 'order'); }
function isPhoneLayout(){ return window.innerWidth < 960; }
/* What scrolls: the screen's content inside the app frame (Home Screen app
   on a phone, see boot.js), otherwise the page itself. */
function inAppFrame(){ return document.documentElement.classList.contains('app-shell') && isPhoneLayout(); }
function scrollBox(){ return (inAppFrame() && document.querySelector('.content')) || document.scrollingElement; }
/* Every screen in tab-bar order: the three tabs first, then the rest. */
function navOrder(){ return [...state.tabs, ...state.views.filter(v=>!state.tabs.includes(v))]; }
function moreViews(){ return state.views.filter(v=>!state.tabs.includes(v)); }
function viewIndex(v){ const i = navOrder().indexOf(v); return i >= 0 ? i : navOrder().length; }
const reducedMotion = ()=> matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderBottomNav(){
  const btn = id=>`
      <button class="navbtn" data-view="${id}">
        ${NAV_ICONS[id]}<span>${esc(viewLabel(id))}</span>${['assistant','transfers','stock'].includes(id)?'<i class="nav-badge" hidden></i>':''}
      </button>`;
  return `<nav class="bottomnav" aria-label="${esc(t('workspaceLabel'))}"><span class="nav-indicator" aria-hidden="true"></span>
    ${state.tabs.map(btn).join('')}
    <button class="navbtn nav-more-btn" id="navMoreBtn" aria-haspopup="true" aria-expanded="false" aria-controls="navMore">${ICON_MORE}<span>${esc(t('more'))}</span></button>
    <div class="nav-more" id="navMore" role="group" aria-label="${esc(t('moreTitle'))}">${moreViews().map(btn).join('')}
      <button class="nav-edit" id="navEditTabs">${ICON_EDIT}<span>${esc(t('editTabs'))}</span></button>
    </div>
  </nav>`;
}
function markActiveNav(){
  document.querySelectorAll('.bottomnav [data-view]').forEach(b=>{
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  document.getElementById('navMoreBtn')?.classList.toggle('active', moreViews().includes(state.view));
}
function barButtons(nav){ return [...nav.querySelectorAll(':scope > .navbtn')]; }
function placeNavIndicator(){
  const nav = document.querySelector('.bottomnav'), ind = nav?.querySelector('.nav-indicator');
  if(!nav || !ind) return;
  markActiveNav();
  const phone = isPhoneLayout();
  // On a computer the More button is hidden, so the lens goes to the screen's own row.
  const active = phone
    ? (moreViews().includes(state.view) ? nav.querySelector('#navMoreBtn') : nav.querySelector(`:scope > .navbtn[data-view="${state.view}"]`))
    : nav.querySelector(`.navbtn[data-view="${state.view}"]`);
  if(!active || !active.offsetWidth){ ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  nav.classList.add('has-indicator');
  if(!phone){
    ind.style.setProperty('--iy', active.offsetTop+'px');
    ind.style.setProperty('--ih', active.offsetHeight+'px');
  }else{
    ind.style.setProperty('--ix', active.offsetLeft+'px');
    ind.style.setProperty('--iw', active.offsetWidth+'px');
  }
}
/* Slides the lens to a fractional tab position (1.5 = halfway between the
   second and third tab); used while a finger is on the bar or the page. */
function setLensPosition(pos){
  const nav = document.querySelector('.bottomnav'), ind = nav?.querySelector('.nav-indicator');
  if(!nav || !ind || !isPhoneLayout()) return;
  const btns = barButtons(nav);
  if(!btns.length) return;
  const p = Math.max(0, Math.min(btns.length-1, pos)), i = Math.floor(p), f = p-i, a = btns[i], b = btns[Math.min(btns.length-1,i+1)];
  ind.style.opacity = '1';
  ind.style.setProperty('--ix', (a.offsetLeft + (b.offsetLeft-a.offsetLeft)*f)+'px');
  ind.style.setProperty('--iw', (a.offsetWidth + (b.offsetWidth-a.offsetWidth)*f)+'px');
  btns.forEach((x,k)=>x.classList.toggle('lens-over', k===Math.round(p)));
}
/* Hold the tab bar and slide: the lens follows the finger and each tab it
   passes opens (with the page transition). Letting go on More opens More. */
function initTabBarLens(nav){
  let down = null;
  const slotAt = x=>{
    const btns = barButtons(nav), c = btns.map(b=>{ const r = b.getBoundingClientRect(); return r.left + r.width/2; });
    let best = 0;
    c.forEach((v,k)=>{ if(Math.abs(v-x) < Math.abs(c[best]-x)) best = k; });
    const order = c.map((v,k)=>[v,k]).sort((m,n)=>m[0]-n[0]);
    let pos = order[order.length-1][1];
    if(x <= order[0][0]) pos = order[0][1];
    else for(let k=0;k<order.length-1;k++){ const [c1,i1]=order[k],[c2,i2]=order[k+1]; if(x<=c2){ pos = i1+(i2-i1)*((x-c1)/(c2-c1)); break; } }
    return {btn:btns[best], pos};
  };
  nav.addEventListener('pointerdown', e=>{
    if(!isPhoneLayout() || e.button>0 || e.target.closest('.nav-more')) return;
    down = {x:e.clientX, id:e.pointerId, moved:false, last:null};
  });
  nav.addEventListener('pointermove', e=>{
    if(!down || e.pointerId!==down.id) return;
    if(!down.moved && Math.abs(e.clientX-down.x) < 8) return;
    if(!down.moved){ down.moved = true; nav.classList.add('held'); try{ nav.setPointerCapture(e.pointerId); }catch(_){} setMoreOpen(false); }
    const s = slotAt(e.clientX);
    setLensPosition(s.pos);
    const view = s.btn?.dataset.view;
    if(view && view !== down.last){ down.last = view; if(view !== state.view){ goView(view, {keepLens:true}); setLensPosition(s.pos); } }
  });
  const end = e=>{
    if(!down || e.pointerId!==down.id) return;
    const wasDrag = down.moved; down = null;
    nav.classList.remove('held');
    barButtons(nav).forEach(b=>b.classList.remove('lens-over'));
    if(wasDrag){
      // The drag must not also count as a tap on the tab under the finger.
      const swallow = ev=>{ ev.stopPropagation(); ev.preventDefault(); };
      nav.addEventListener('click', swallow, {capture:true, once:true});
      setTimeout(()=>nav.removeEventListener('click', swallow, {capture:true}), 300);
      if(slotAt(e.clientX).btn?.id === 'navMoreBtn') setMoreOpen(true);
      placeNavIndicator();
    }
  };
  nav.addEventListener('pointerup', end);
  nav.addEventListener('pointercancel', end);
}
/* ============ Filter rows with a glass lens ============
   Every row of filter pills (History, Record, Stock, Items, Suppliers | Zones)
   gets the same lens as the tab bar: it glides to the chosen pill, and if you
   hold the row and slide, it turns to glass and follows your finger while each
   pill it reaches opens, exactly like the tab bar. Some filters redraw the
   whole screen when they change, so the drag is followed at document level and
   handed to the freshly drawn row. */
const segPills = seg=>[...seg.querySelectorAll('.tab-pill')];
const segs = ()=>[...document.querySelectorAll('.record-filters.seg')];
function segSlot(seg, x){
  const b = segPills(seg), c = b.map(el=>{ const r = el.getBoundingClientRect(); return r.left+r.width/2; });
  const order = c.map((v,k)=>[v,k]).sort((m,n)=>m[0]-n[0]);
  let pos = order[order.length-1][1], best = 0;
  c.forEach((v,k)=>{ if(Math.abs(v-x) < Math.abs(c[best]-x)) best = k; });
  if(x <= order[0][0]) pos = order[0][1];
  else for(let k=0;k<order.length-1;k++){ const [c1,i1]=order[k],[c2,i2]=order[k+1]; if(x<=c2){ pos = i1+(i2-i1)*((x-c1)/(c2-c1)); break; } }
  return {el:b[best], index:best, pos};
}
function segLensTo(seg, pos){
  const lens = seg.querySelector('.seg-lens'), b = segPills(seg); if(!lens || !b.length) return;
  const p = Math.max(0, Math.min(b.length-1, pos)), i = Math.floor(p), f = p-i, a = b[i], n = b[Math.min(b.length-1, i+1)];
  lens.style.opacity = '1';
  lens.style.setProperty('--lx', (a.offsetLeft+(n.offsetLeft-a.offsetLeft)*f)+'px');
  lens.style.setProperty('--lw', (a.offsetWidth+(n.offsetWidth-a.offsetWidth)*f)+'px');
  const near = Math.round(p);
  b.forEach((x,k)=>{ const on = k===near; if(x.classList.contains('lens-over') !== on) x.classList.toggle('lens-over', on); });
}
function segPlace(seg){
  if(seg.classList.contains('held')) return;       // while a finger is on it, the finger decides
  const lens = seg.querySelector('.seg-lens'), on = seg.querySelector('.tab-pill.active');
  if(!lens) return;
  if(!on || !on.offsetWidth){ lens.style.opacity = '0'; return; }
  lens.style.opacity = '1';
  lens.style.setProperty('--lx', on.offsetLeft+'px'); lens.style.setProperty('--lw', on.offsetWidth+'px');
  if(!seg.classList.contains('seg-ready')) seg.classList.add('seg-ready');
}
let segDrag = null;   // {id, x0, x, moved, index (which row), last (pill index)}
/* A row redrawn in the middle of a drag continues it: held, with the lens already under the finger. */
function segAdopt(seg){
  if(!segDrag || !segDrag.moved) return;
  const lens = seg.querySelector('.seg-lens');
  seg.classList.add('held', 'seg-ready');
  if(lens){ lens.style.transition = 'none'; }
  segLensTo(seg, segSlot(seg, segDrag.x).pos);
  if(lens) requestAnimationFrame(()=>requestAnimationFrame(()=>{ lens.style.transition = ''; }));
}
function enhanceSegments(){
  document.querySelectorAll('.record-filters:not([data-lens])').forEach(seg=>{
    seg.dataset.lens = '1'; seg.classList.add('seg');
    const lens = document.createElement('span'); lens.className = 'seg-lens'; lens.setAttribute('aria-hidden', 'true');
    seg.prepend(lens);
    new MutationObserver(()=>segPlace(seg)).observe(seg, {subtree:true, attributes:true, attributeFilter:['class']});
    segPlace(seg);
    if(segDrag && segDrag.moved && segs().indexOf(seg) === segDrag.index) segAdopt(seg);
  });
}
document.addEventListener('pointerdown', e=>{
  const seg = e.target.closest?.('.record-filters.seg');
  if(!seg || e.button>0) return;
  segDrag = {id:e.pointerId, x0:e.clientX, x:e.clientX, moved:false, index:segs().indexOf(seg), last:null};
});
document.addEventListener('pointermove', e=>{
  if(!segDrag || e.pointerId!==segDrag.id) return;
  segDrag.x = e.clientX;
  if(!segDrag.moved && Math.abs(e.clientX-segDrag.x0) < 4) return;
  let seg = segs()[segDrag.index]; if(!seg) return;
  if(!segDrag.moved){
    segDrag.moved = true; segDrag.last = segPills(seg).findIndex(p=>p.classList.contains('active'));
    seg.classList.add('held'); try{ seg.setPointerCapture(e.pointerId); }catch(_){}
  }
  const s = segSlot(seg, e.clientX);
  segLensTo(seg, s.pos);                              // the glass follows the finger, like the tab bar's lens
  if(s.index !== segDrag.last){
    segDrag.last = s.index;
    // The screen changes a moment after the lens settles on a pill, so redrawing never makes the glass stutter.
    clearTimeout(segDrag.timer);
    const index = s.index;
    segDrag.timer = setTimeout(()=>{
      const cur = segs()[segDrag?.index]; if(!cur || !segDrag) return;
      const pill = segPills(cur)[index];
      if(pill && !pill.classList.contains('active')){
        pill.click();                                 // opens that filter (a full redraw replaces the row)
        const n = segs()[segDrag.index];
        if(n && !n.classList.contains('held')) segAdopt(n);
        if(n) segLensTo(n, segSlot(n, segDrag.x).pos);
      }
    }, 90);
  }
});
const segEnd = e=>{
  if(!segDrag || e.pointerId!==segDrag.id) return;
  const d = segDrag; segDrag = null; clearTimeout(d.timer);
  if(d.moved && d.last !== null){                      // let go: the pill under the finger is the one that opens
    const cur = segs()[d.index], pill = cur && segPills(cur)[d.last];
    if(pill && !pill.classList.contains('active')) pill.click();
  }
  const seg = segs()[d.index];
  if(seg){ seg.classList.remove('held'); segPills(seg).forEach(x=>x.classList.remove('lens-over')); segPlace(seg); }
  if(!d.moved) return;
  // The browser's own click after a drag must not also press whatever is under the finger.
  const swallow = ev=>{ ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', swallow, {capture:true, once:true});
  setTimeout(()=>document.removeEventListener('click', swallow, {capture:true}), 300);
};
document.addEventListener('pointerup', segEnd);
document.addEventListener('pointercancel', segEnd);
window.addEventListener('resize', ()=>segs().forEach(segPlace));

function setMoreOpen(open){
  const nav = document.querySelector('.bottomnav'), btn = document.getElementById('navMoreBtn');
  if(!nav || !btn) return;
  nav.classList.toggle('more-open', open);
  btn.setAttribute('aria-expanded', String(open));
}
/* A tap anywhere else, or Escape, closes the More panel. */
document.addEventListener('click', e=>{ if(!e.target.closest('.bottomnav')) setMoreOpen(false); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ setMoreOpen(false); closeLangMenu(); } });

/* ---------- Page transitions ----------
   One animation per screen change, never on a redraw of the same screen
   (a redraw used to replay an entrance animation, so pages seemed to load
   twice). PAGE_TRANSITION picks the style and its length:
     soft   fade in with a small sideways drift   fade   crossfade
     rise   fade in lifting up                     slide  full-width slide
     push   slide over, old page drifts and dims   zoom   grow in slightly
     blur   come into focus                        none   instant */
const PAGE_TRANSITION = {style:'push', ms:950};   // chosen by Rozha
// A swipe is a little quicker: the finger already did part of the move.
const SWIPE_MS = 620;
// A tap: eases in, glides, and settles softly (the motion is spread over the
// whole time instead of jumping in the first moment).
const PAGE_EASE = 'cubic-bezier(.45,.05,.2,1)';
// After a swipe the page is already moving with the finger, so it keeps going.
const SWIPE_EASE = 'cubic-bezier(.2,.55,.25,1)';
let glide = null;
function endGlide(){
  if(!glide) return;
  glide.anims.forEach(a=>a.cancel());
  glide.ghost?.remove();
  glide.content.classList.remove('gliding');
  glide = null;
}
function transitionFrames(dir, w){
  switch(PAGE_TRANSITION.style){
    case 'soft':  return {inn:[{transform:`translate3d(${dir*22}px,0,0)`, opacity:0}, {transform:'none', opacity:1}]};
    case 'fade':  return {inn:[{opacity:0}, {opacity:1}], out:[{opacity:1}, {opacity:0}]};
    case 'rise':  return {inn:[{transform:'translate3d(0,16px,0)', opacity:0}, {transform:'none', opacity:1}]};
    case 'slide': return {inn:[{transform:`translate3d(${dir*w}px,0,0)`}, {transform:'none'}], out:[{transform:'none'}, {transform:`translate3d(${-dir*w}px,0,0)`}]};
    // The old page is fully faded by half-way: the glass is clear, so any of it
    // still showing would read through the new page sliding over it.
    case 'push':  return {inn:[{transform:`translate3d(${dir*w}px,0,0)`}, {transform:'none'}], out:[{transform:'none', opacity:1}, {opacity:0, offset:.45}, {transform:`translate3d(${-dir*w*.3}px,0,0)`, opacity:0}]};
    case 'zoom':  return {inn:[{transform:'scale(.955)', opacity:0}, {transform:'none', opacity:1}]};
    case 'blur':  return {inn:[{filter:'blur(8px)', opacity:0}, {filter:'none', opacity:1}]};
    default: return null;
  }
}
/* After a swipe both pages travel together, edge to edge: the old one slides
   all the way off to the other side while the new one pushes in beside it.
   Nothing fades and nothing overlaps, so no page ever shows through another. */
function swipeFrames(dir, w){
  return {inn:[{transform:`translate3d(${dir*w}px,0,0)`}, {transform:'none'}], out:[{transform:'none'}, {transform:`translate3d(${-dir*w}px,0,0)`}]};
}
/* The page that is leaving, laid exactly where it was. Its parts are moved
   (not copied) into a fixed layer, so even the 179-item Order page costs
   nothing to set up; the fresh page is then drawn into the emptied .content. */
function pageGhost(content){
  const r = content.getBoundingClientRect();
  const scrolled = inAppFrame() ? content.scrollTop : 0;
  const layer = document.createElement('div');
  layer.className = 'page-ghost'; layer.setAttribute('aria-hidden','true');
  Object.assign(layer.style, {left:r.left+'px', width:r.width+'px'});
  const copy = content.cloneNode(false);
  copy.removeAttribute('id');
  while(content.firstChild) copy.appendChild(content.firstChild);
  copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  Object.assign(copy.style, {top:r.top+'px', width:r.width+'px', height:r.height+'px', transform:content.style.transform || ''});
  layer.appendChild(copy);
  document.body.appendChild(layer);
  copy.scrollTop = scrolled;
  return {layer, copy};
}
function goView(view, {fromOffset=0, keepLens=false} = {}){
  setMoreOpen(false); closeLangMenu();
  if(view !== 'assistant' && ricoRecorder.active) ricoResetVoice();   // leaving Rico drops an unsent recording
  if(!view || view === state.view || !canOpen(view)) return;
  reminderDraft = null;   // a reminder that wasn't saved stays off
  endGlide();
  const dir = (Math.sign(viewIndex(view) - viewIndex(state.view)) || 1) * (isRtl() ? -1 : 1);
  const old = document.querySelector('.content');
  const width = old ? old.getBoundingClientRect().width : window.innerWidth;
  const frames = old && old.animate && !reducedMotion() ? (fromOffset ? swipeFrames(dir, width) : transitionFrames(dir, width)) : null;
  const ghost = frames?.out ? pageGhost(old) : null;
  state.view = view;
  if(view === 'record') state.recordFilter = 'all';
  render();
  scrollBox().scrollTo({top:0});
  if(view === 'record') refreshActivity();
  if(view === 'devices') refreshDevices();
  if(!keepLens) placeNavIndicator();
  const content = document.querySelector('.content');
  if(!frames || !content){ ghost?.layer.remove(); if(content) content.style.transform = ''; return; }
  // After a swipe, pages start from where the finger left them.
  if(fromOffset){
    frames.inn[0] = {transform:`translate3d(${dir*width + fromOffset}px,0,0)`};
    frames.out[0] = {transform:`translate3d(${fromOffset}px,0,0)`};
  }
  const opts = fromOffset ? {duration:SWIPE_MS, easing:SWIPE_EASE} : {duration:PAGE_TRANSITION.ms, easing:PAGE_EASE};
  content.style.transform = '';
  content.classList.add('gliding');
  const anims = [content.animate(frames.inn, opts)];
  if(ghost) anims.push(ghost.copy.animate(frames.out, opts));
  glide = {anims, ghost:ghost?.layer, content};
  const mine = glide;
  anims[0].finished.then(()=>{ if(glide === mine) endGlide(); }, ()=>{});
}

/* Swipe the page sideways to move between the three tabs (phones). The page
   follows the finger, the lens follows the page, and a short fling is
   enough. Anything that scrolls sideways on its own, inputs, steppers and
   open dialogs are left alone. */
(function initPageSwipe(){
  let g = null;
  const blocked = el=>el.closest('input,textarea,select,.stepper,.order-tabs,.record-filters,.rico-composer,.bottom-stack,.item-sort-list,.day-chips,.unit-grid,.rico-picker-list,#modalRoot .modal-overlay,.ctx-layer,.lang-layer');
  document.addEventListener('pointerdown', e=>{
    if(!isPhoneLayout() || e.pointerType==='mouse' || !state.account) return;
    const content = e.target.closest('.content');
    if(!content || blocked(e.target) || !state.tabs.includes(state.view)) return;
    g = {x:e.clientX, y:e.clientY, t:performance.now(), id:e.pointerId, content, dx:0, mode:null};
  }, {passive:true});
  document.addEventListener('pointermove', e=>{
    if(!g || e.pointerId!==g.id) return;
    const dx = e.clientX-g.x, dy = e.clientY-g.y;
    if(!g.mode){
      if(Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.mode = Math.abs(dx) > Math.abs(dy)*1.3 ? 'x' : 'y';
      if(g.mode === 'x'){ endGlide(); document.body.classList.add('page-swiping'); }
    }
    if(g.mode !== 'x') return;
    const rtl = isRtl() ? -1 : 1, i = state.tabs.indexOf(state.view);
    const next = i - Math.sign(dx)*rtl;
    const edge = next < 0 || next >= state.tabs.length;
    g.dx = edge ? dx*.28 : dx;
    g.content.style.transform = `translate3d(${g.dx}px,0,0)`;
    if(!edge) setLensPosition(i + (-g.dx*rtl)/window.innerWidth);
  }, {passive:true});
  const end = e=>{
    if(!g || e.pointerId!==g.id) return;
    const s = g; g = null;
    document.body.classList.remove('page-swiping');
    if(s.mode !== 'x') return;
    // A sideways swipe that started on a button must not also press it.
    const swallow = ev=>{ ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, {capture:true, once:true});
    setTimeout(()=>document.removeEventListener('click', swallow, {capture:true}), 350);
    const rtl = isRtl() ? -1 : 1, i = state.tabs.indexOf(state.view);
    const v = s.dx/Math.max(1, performance.now()-s.t);
    const go = Math.abs(s.dx) > window.innerWidth*.26 || Math.abs(v) > .45;
    const next = i - Math.sign(s.dx)*rtl;
    if(go && next >= 0 && next < state.tabs.length){
      // The new page arrives from where the finger left the old one.
      goView(state.tabs[next], {fromOffset:s.dx});
      return;
    }
    const back = s.content.animate?.([{transform:`translate3d(${s.dx}px,0,0)`},{transform:'none'}], {duration:360, easing:'cubic-bezier(.34,1.3,.5,1)'});
    s.content.style.transform = '';
    placeNavIndicator();
    return back;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();
window.addEventListener('resize', ()=>requestAnimationFrame(placeNavIndicator));

/* Typing on a phone. iOS slides the whole screen up to show a field the
   keyboard would cover, which drags the top bar away and leaves the tab bar
   floating on the keyboard. Instead: a tapped field in the lower half is
   first brought up under the top bar (so the keyboard never covers it and
   nothing else has to move), the tab bar steps aside while typing, and
   popups stay centred in the part of the screen that is still visible. */
const TEXT_ENTRY = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]),textarea,select';
(function initTyping(){
  let start = null;
  document.addEventListener('touchstart', e=>{ start = e.touches[0] ? e.touches[0].clientY : null; }, {passive:true});
  document.addEventListener('touchend', e=>{
    const field = e.target.closest && e.target.closest(TEXT_ENTRY);
    const moved = start === null || !e.changedTouches[0] || Math.abs(e.changedTouches[0].clientY - start) > 10;
    // (The app frame needs none of this: it shrinks above the keyboard instead.)
    if(!field || moved || field === document.activeElement || !isPhoneLayout() || inAppFrame() || !field.closest('.content')) return;
    const r = field.getBoundingClientRect();
    if(r.bottom < window.innerHeight * .42) return;
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0) + 14;
    window.scrollBy({top:r.top - top, behavior:'instant'});
  }, {passive:true});
  const typing = on=>document.body.classList.toggle('typing', on);
  document.addEventListener('focusin', e=>typing(!!e.target.matches?.(TEXT_ENTRY)));
  document.addEventListener('focusout', ()=>setTimeout(()=>typing(!!document.activeElement?.matches?.(TEXT_ENTRY)), 60));
  const vv = window.visualViewport;
  if(!vv) return;
  // The keyboard opening fires a burst of viewport events. Following each one made the whole app shake,
  // so the frame is resized once the burst settles, and the field is brought into sight only if it is hidden.
  let fitTimer = 0, lastH = 0;
  const fit = ()=>{
    const root = document.documentElement.style;
    root.setProperty('--vv-top', vv.offsetTop + 'px');
    root.setProperty('--vv-height', vv.height + 'px');
    const resized = Math.abs(vv.height - lastH) > 40; lastH = vv.height;
    const field = document.activeElement;
    if(!resized || !inAppFrame() || !field?.matches?.(TEXT_ENTRY) || !field.closest('.content')) return;
    requestAnimationFrame(()=>{
      const r = field.getBoundingClientRect(), box = scrollBox().getBoundingClientRect();
      if(r.top < box.top + 8 || r.bottom > box.bottom - 8) field.scrollIntoView({block:'center'});
    });
  };
  const settle = ()=>{ clearTimeout(fitTimer); fitTimer = setTimeout(fit, 90); };
  vv.addEventListener('resize', settle); vv.addEventListener('scroll', settle); fit();
})();

/* Our own list for every dropdown: the select stays (it holds the value and fires 'change', so forms and
   tests work as before) but is hidden under a button that opens a sheet from the bottom, with search when long.
   A select can opt out with data-native. */
function selLabel(sel){ const o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; }
function selSync(sel){ const b = sel._selBtn; if(!b) return; b.querySelector('span').textContent = selLabel(sel); b.classList.toggle('placeholder', !sel.value); b.disabled = sel.disabled; }
function enhanceSelects(root = document){
  root.querySelectorAll('select:not([data-native]):not(.sel-native)').forEach(sel=>{
    sel.classList.add('sel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sel-btn';
    btn.innerHTML = '<span dir="auto"></span><i aria-hidden="true"></i>';
    if(sel.id){ btn.id = sel.id + 'Btn'; document.querySelector(`label[for="${CSS.escape(sel.id)}"]`)?.setAttribute('for', btn.id); }
    if(sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    sel._selBtn = btn; sel.after(btn);
    btn.addEventListener('pointerdown', e=>{ if(document.activeElement?.matches?.('input,textarea')) e.preventDefault(); });
    btn.onclick = ()=>openSelSheet(sel);
    sel.addEventListener('change', ()=>selSync(sel));
    new MutationObserver(()=>selSync(sel)).observe(sel, {childList:true, subtree:true, attributes:true, attributeFilter:['disabled']});
    selSync(sel);
  });
}
function selTitle(sel){
  const lab = sel._selBtn?.id && document.querySelector(`label[for="${CSS.escape(sel._selBtn.id)}"]`);
  return (lab?.textContent || sel.closest('.field')?.querySelector('label')?.textContent || sel.getAttribute('aria-label') || '').trim();
}
let activeSelSheet = null;
function closeSelSheet(){ activeSelSheet?.(); }
function openSelSheet(sel){
  closeSelSheet();
  document.activeElement?.blur?.();   // close the keyboard first, so the sheet has the screen
  const opts = [...sel.options].filter(o=>!o.disabled || o.selected).map(o=>({value:o.value, label:o.textContent, on:o.selected}));
  const long = opts.length > 9;
  const wrap = document.createElement('div');
  wrap.id = 'selSheet'; wrap.className = 'sel-sheet';
  wrap.innerHTML = `<div class="sel-scrim"></div><div class="sel-panel" role="dialog" aria-modal="true" aria-label="${esc(selTitle(sel))}">
    <div class="sel-grab"></div><div class="sel-title">${esc(selTitle(sel))}</div>
    ${long ? `<div class="search-wrap sel-search">${ICON_SEARCH}<input class="search-input" type="search" autocomplete="off" placeholder="${esc(t('searchPlaceholder'))}"></div>` : ''}
    <div class="sel-list" role="listbox"></div></div>`;
  document.body.appendChild(wrap);
  const list = wrap.querySelector('.sel-list');
  const paint = q=>{
    const tokens = String(q || '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const shown = opts.filter(o=>tokens.every(x=>o.label.toLocaleLowerCase().includes(x)));
    list.innerHTML = shown.length ? shown.map(o=>`<button type="button" class="sel-opt${o.on ? ' on' : ''}${o.value === '' ? ' none' : ''}" role="option" aria-selected="${o.on}" data-v="${esc(o.value)}"><span dir="auto">${esc(o.label)}</span>${o.on ? '<b aria-hidden="true">✓</b>' : ''}</button>`).join('')
      : `<div class="field-hint">${esc(t('trNoMatch'))}</div>`;
  };
  paint('');
  let closed = false;
  const close = ()=>{
    if(closed) return; closed = true;
    if(activeSelSheet === close) activeSelSheet = null;
    wrap.classList.add('out'); wrap.inert = true;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches) wrap.remove();
    else setTimeout(()=>wrap.remove(), 220);
    document.removeEventListener('keydown', onKey, true);
    if(sel._selBtn?.isConnected) sel._selBtn.focus({preventScroll:true});
  };
  activeSelSheet = close;
  const onKey = e=>{
    if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if(e.key !== 'Tab') return;
    const buttons = [...wrap.querySelectorAll('input,button')].filter(el=>!el.disabled);
    const first = buttons[0], last = buttons[buttons.length - 1];
    if(e.shiftKey && (document.activeElement === first || !wrap.contains(document.activeElement))){ e.preventDefault(); last?.focus(); }
    else if(!e.shiftKey && (document.activeElement === last || !wrap.contains(document.activeElement))){ e.preventDefault(); first?.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.sel-scrim').onclick = close;
  wrap.querySelector('.sel-search input')?.addEventListener('input', e=>paint(e.target.value));
  list.onclick = e=>{
    const b = e.target.closest('[data-v]'); if(!b) return;
    if(sel.value !== b.dataset.v){ sel.value = b.dataset.v; sel.dispatchEvent(new Event('input', {bubbles:true})); sel.dispatchEvent(new Event('change', {bubbles:true})); }
    selSync(sel); close();
  };
  requestAnimationFrame(()=>{
    if(closed) return;
    const chosen = list.querySelector('.on');
    chosen?.scrollIntoView({block:'center'});
    (wrap.querySelector('.sel-search input') || chosen || list.querySelector('button'))?.focus({preventScroll:true});
  });
}
// Dropdowns drawn after the page (modals, lines added to a receipt) get the same list.
new MutationObserver(muts=>{ if(muts.some(m=>[...m.addedNodes].some(n=>n.nodeType === 1 && (n.matches('select') || n.querySelector('select'))))) enhanceSelects(); })
  .observe(document.documentElement, {childList:true, subtree:true});

/* The top bar gains depth once the page scrolls under it, and (like an iOS
   large title) the ricotta mark gives way to the screen's name. */
function updateTopbar(){
  const bar = document.querySelector('.topbar');
  if(!bar) return;
  const y = scrollBox().scrollTop;
  bar.classList.toggle('scrolled', y > 6);
  const title = bar.querySelector('.topbar-title');
  if(title){ const label = viewLabel(state.view); if(title.textContent !== label) title.textContent = label; }
  bar.classList.toggle('titled', y > 64);
}
// Capturing: in the app frame it is the content, not the page, that scrolls.
document.addEventListener('scroll', updateTopbar, {passive:true, capture:true});
/* Restarts a CSS "bump" animation on an element (used for changing numbers). */
function bump(el){
  if(!el) return;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
/* The phone's status bar takes the same colour as the top bar. */
function setThemeColor(){
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = '#EEF1EF';
}

function renderPageHeading(){
  const date = new Intl.DateTimeFormat(intlLocale(), {weekday:'short', day:'numeric', month:'short'}).format(new Date());
  return `<header class="page-heading"><div><div class="page-kicker">${esc(t('workspaceLabel'))}</div><h1>${esc(viewLabel(state.view))}</h1></div><time class="page-date" datetime="${new Date().toISOString().slice(0,10)}">${esc(date)}</time></header>`;
}

/* ============ Notifications: banner ============ */
/* Shown at the top of the Order screen until this device has notifications
   on. On iPhone, outside the Home Screen app it only explains how to install. */
function renderPushBanner(){
  const mode = pushBannerMode();
  if(!mode) return '';
  const text = mode === 'ios' ? t('notifIosHint') : t('notifBannerSub');
  return `<div class="push-banner">
    <div class="push-banner-text"><b>${esc(t('notifBannerTitle'))}</b><br>${esc(text)}</div>
    <div class="push-banner-actions">
      ${mode === 'enable' ? `<button class="btn btn-primary" id="pushEnableBtn">${ICON_BELL} ${esc(t('notifEnable'))}</button>` : ''}
      <button class="btn btn-ghost" id="pushDismissBtn">${esc(t('notifDismiss'))}</button>
    </div>
  </div>`;
}

/* ============ Top bar ============
   The same colour as the page, with Online, the language and a red glass
   log-out button on top of it. */
function langButton(id){
  return `<button type="button" class="chip lang-chip" id="${id}" aria-haspopup="dialog" aria-label="${esc(t('language'))}">${ICON_GLOBE}<span class="lang-code">${state.lang.toUpperCase()}</span><span class="lang-name">${LANG_NAMES[state.lang]}</span>${ICON_CHEVRON}</button>`;
}
function renderTopbar(){
  return `
  <header class="topbar">
    <div class="brand-slot"><div class="brand" aria-label="Ricotta Orders"><span class="brand-mark">ricotta</span><span class="dot"></span></div><span class="topbar-title" aria-hidden="true"></span></div>
    <div class="topbar-actions">
      <div class="chip conn-chip ${state.apiOnline?'':'offline'}" id="connectionStatus"><span></span><em>${esc(state.apiOnline?t('online'):t('offline'))}</em></div>
      ${langButton('langBtn')}
      <button type="button" class="logout-btn" id="logoutBtn" aria-label="${esc(t('logout'))}" title="${esc(t('logout'))}">${ICON_LOGOUT}</button>
    </div>
  </header>`;
}

/* ---------- Language menu ----------
   A glass menu under the language button. Nothing changes until Apply. */
function closeLangMenu(){
  const layer = document.getElementById('langLayer');
  if(!layer) return;
  layer.classList.add('closing');
  setTimeout(()=>layer.remove(), 200);
}
function openLangMenu(anchor){
  closeLangMenu();
  const r = anchor.getBoundingClientRect();
  let pick = state.lang;
  const layer = document.createElement('div');
  layer.id = 'langLayer'; layer.className = 'lang-layer';
  const side = isRtl() ? `left:${Math.max(10, r.left)}px` : `right:${Math.max(10, window.innerWidth - r.right)}px`;
  layer.innerHTML = `<div class="lang-scrim"></div>
    <div class="lang-menu" role="dialog" aria-label="${esc(t('language'))}" style="top:${r.bottom + 8}px;${side}">
      <div class="lang-title">${esc(t('language'))}</div>
      ${LANGS.map(l=>`<button type="button" class="lang-row" data-pick="${l}" lang="${({en:'en',ku:'ckb',ar:'ar'})[l]}" dir="${l==='en'?'ltr':'rtl'}"><span>${LANG_NAMES[l]}</span><i class="lang-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i></button>`).join('')}
      <div class="lang-actions"><button type="button" class="btn btn-ghost" data-lang-cancel>${esc(t('cancel'))}</button><button type="button" class="btn btn-primary" data-lang-apply disabled>${esc(t('apply'))}</button></div>
    </div>`;
  document.body.appendChild(layer);
  const paint = ()=>{
    layer.querySelectorAll('[data-pick]').forEach(b=>b.classList.toggle('sel', b.dataset.pick === pick));
    layer.querySelector('[data-lang-apply]').disabled = pick === state.lang;
  };
  paint();
  layer.querySelector('.lang-scrim').onclick = closeLangMenu;
  layer.querySelector('[data-lang-cancel]').onclick = closeLangMenu;
  layer.querySelectorAll('[data-pick]').forEach(b=>b.onclick = ()=>{ pick = b.dataset.pick; paint(); });
  layer.querySelector('[data-lang-apply]').onclick = ()=>{ closeLangMenu(); setLang(pick); };
  layer.querySelector(`[data-pick="${state.lang}"]`)?.focus({preventScroll:true});
}
function setLang(lang){
  if(!LANGS.includes(lang)) return;
  state.lang = lang; lset('lang', lang); render();
  updatePushLang(lang);   // so future notifications switch language immediately too
}

/* ---------- Edit tabs ----------
   Each account picks the three screens in its tab bar (saved on the server,
   so every phone signed in to that account gets the same tabs). */
function openTabEditor(){
  setMoreOpen(false);
  const picked = state.tabs.slice();
  showFormModal({
    title: t('editTabs'),
    bodyHtml: `<div class="notif-sub">${esc(t('editTabsHint'))}</div><div class="tab-pick" id="tabPick"></div>`,
    okLabel: t('save'),
    onOpen: box=>{
      const list = box.querySelector('#tabPick');
      const paint = ()=>{
        list.innerHTML = tabChoices().map(v=>{ const n = picked.indexOf(v); return `<button type="button" class="tab-pick-row ${n>=0?'on':''}" data-tab="${v}" aria-pressed="${n>=0}">${NAV_ICONS[v]}<span>${esc(viewLabel(v))}</span><b>${n>=0?n+1:''}</b></button>`; }).join('');
        list.querySelectorAll('[data-tab]').forEach(b=>b.onclick = ()=>{
          const v = b.dataset.tab, n = picked.indexOf(v);
          if(n >= 0) picked.splice(n, 1); else if(picked.length < 3) picked.push(v); else { picked.shift(); picked.push(v); }
          paint();
        });
        box.querySelector('#modalFormOk').disabled = picked.length !== 3;
      };
      paint();
    },
    onSubmit: async ()=>{
      if(picked.length !== 3) return {error:t('editTabsNeedThree')};
      // The older server only knows the older screens; a tab bar that uses Transfer or Stock is kept by the stock server.
      const usesStock = picked.some(v=>STOCK_VIEWS.includes(v));
      const mine = await stockApi('tabs', {method:'PUT', body:{tabs:picked}});
      if(usesStock ? !mine.ok : false) return {error:t('saveFailed')};
      if(!usesStock){
        const r = await api('me/tabs', {method:'PUT', body:{tabs:picked}});
        if(!r.ok) return {error:t('saveFailed')};
      }
      stockState.tabs = picked.slice();
      state.tabs = picked.slice();
      saveSessionAccount();
      render();
      toast(t('tabsSaved'));
      return {};
    }
  });
}

/* Events on the top bar and tab bar (bound once, when they are built). */
function attachShellEvents(){
  const nav = document.querySelector('.bottomnav');
  nav.querySelectorAll('[data-view]').forEach(b=>b.onclick = ()=>goView(b.dataset.view));
  document.getElementById('navMoreBtn').onclick = e=>{ e.stopPropagation(); setMoreOpen(!nav.classList.contains('more-open')); };
  document.getElementById('navEditTabs').onclick = e=>{ e.stopPropagation(); openTabEditor(); };
  document.getElementById('langBtn').onclick = e=>{ e.stopPropagation(); openLangMenu(e.currentTarget); };
  document.getElementById('logoutBtn').onclick = ()=>doLogout();
  initTabBarLens(nav);
}
/* Events inside the page that more than one screen uses. */
function attachContentEvents(){
  const pushOn = document.getElementById('pushEnableBtn');
  if(pushOn) pushOn.onclick = async ()=>{
    const res = await enablePush();   // straight from the tap: iOS needs that for the permission prompt
    render();
    await showPushEnableResult(res);
  };
  const pushLater = document.getElementById('pushDismissBtn');
  if(pushLater) pushLater.onclick = ()=>{ snoozePushBanner(); render(); };
  // "Record" shortcut buttons on the Suppliers / Items screens: jump to the
  // Record already filtered to that kind of change.
  document.querySelectorAll('[data-gorecord]').forEach(b=>b.onclick = ()=>{
    goView('record'); state.recordFilter = b.dataset.gorecord; render();
  });
}

/* ============ Login (PIN pad) ============ */
function loginMessage(){
  if(state.pinBusy) return t('signingIn');
  return ({wrong:t('wrongPin'), locked:t('tooManyAttempts'), network:t('loadFailed'), session:state.sessionMsg})[state.pinError] || '';
}
function pinDotClass(i){
  const filled = i < state.pinBuffer.length;
  const next = i === state.pinBuffer.length && !state.pinBusy && !state.pinError;
  return `pin-dot${filled?' filled':''}${next?' next':''}`;
}
function renderLogin(){
  const dots = Array.from({length:MAX_PIN_LEN}).map((_,i)=>`<span class="${pinDotClass(i)}"><span class="core"></span></span>`).join('');
  const keys = ['1','2','3','4','5','6','7','8','9'];
  const bad = ['wrong','locked','network'].includes(state.pinError);
  const msg = loginMessage();
  const word = 'ricotta'.split('').map((c,i)=>`<b style="--i:${i}">${c}</b>`).join('');
  return `
  <div class="login-wrap">
    <div class="login-corner">${langButton('loginLangBtn')}</div>
    <aside class="login-brand-panel">
      <div class="brand-word" dir="ltr">ricotta<span class="brand-word-dot"></span></div>
      <div class="login-brand-content"><div class="brand-kicker">${esc(t('brandKicker'))}</div><div class="brand-message">${esc(t('brandMessage'))}<br><em>${esc(t('brandMessageAccent'))}</em></div><div class="brand-detail">${esc(t('brandDetail'))}</div></div>
      <div class="brand-footer"><span>© ${new Date().getFullYear()} Ricotta</span><span>${esc(t('brandFooter'))}</span></div>
    </aside>
    <div class="login-mobile-brand" aria-hidden="true">
      <div class="login-word">${word}<i></i></div><div class="login-orders">ORDERS</div>
    </div>
    <div class="login-card"><div class="login-inner">
      <div class="login-heading">
        <div class="login-eyebrow">${esc(t('welcomeBack'))}</div>
        <h1 class="login-title">${esc(t('signIn'))}</h1>
        <p class="login-sub">${esc(t('signInSub'))}</p>
      </div>
      <div class="pin-label" id="pinLabel">${esc(t('enterPin'))}</div>
      <div class="pin-dots ${bad?'err':''} ${state.pinBusy?'busy':''}" role="group" aria-labelledby="pinLabel">${dots}</div>
      <div class="login-error ${state.pinError==='session'?'info':''}" role="alert" style="visibility:${msg?'visible':'hidden'};">${esc(msg) || '&nbsp;'}</div>
      <div class="keypad">
        ${keys.map((k,i)=>`<button class="key" data-key="${k}" style="--k:${i}">${k}</button>`).join('')}
        <button class="key clear" data-key="clear" style="--k:9">${esc(t('clear'))}</button>
        <button class="key" data-key="0" style="--k:10">0</button>
        <button class="key backspace" data-key="back" style="--k:11" aria-label="${esc(t('deleteDigit'))}">${ICON_BACKSPACE}</button>
      </div>
    </div></div>
  </div>`;
}
function updateLoginFeedback(){
  const dots = document.querySelector('.pin-dots');
  if(!dots) return;
  dots.classList.toggle('err', ['wrong','locked','network'].includes(state.pinError));
  dots.classList.toggle('busy', state.pinBusy);
  // Class changes alone drive the pop / next-box glow (see .pin-dot in style.css).
  dots.querySelectorAll('.pin-dot').forEach((dot,index)=>{ dot.className = pinDotClass(index); });
  const message = document.querySelector('.login-error');
  message.textContent = loginMessage() || ' ';
  message.style.visibility = loginMessage() ? 'visible' : 'hidden';
  message.classList.toggle('info', state.pinError === 'session');
  document.querySelectorAll('[data-key]').forEach(button=>button.disabled = state.pinBusy);
}
async function pressKey(k){
  if(state.pinBusy) return;
  if(state.pinError && state.pinError !== 'session') state.pinError = '';
  if(k==='clear'){ state.pinBuffer=''; updateLoginFeedback(); return; }
  if(k==='back'){ state.pinBuffer = state.pinBuffer.slice(0,-1); updateLoginFeedback(); return; }
  if(state.pinBuffer.length >= MAX_PIN_LEN) return;
  state.pinBuffer += k;
  if(state.pinBuffer.length < MAX_PIN_LEN){ updateLoginFeedback(); return; }

  state.pinBusy = true; state.pinError = ''; updateLoginFeedback();
  const res = await apiLogin(state.pinBuffer);
  state.pinBusy = false;
  if(res.recovery){ state.pinBuffer = ''; updateLoginFeedback(); startRecovery(res.ticket); return; }
  if(res.error){
    state.pinError = res.error; updateLoginFeedback();
    setTimeout(()=>{ state.pinBuffer=''; if(!state.account) updateLoginFeedback(); }, 650);
    return;
  }
  // Signed in: "Welcome back, Yunis" covers the workspace while it loads, then lifts.
  state.pinBuffer = ''; state.pinError = ''; state.view = 'order';
  showWelcome(accountLabel(res.account));
  applyAccount(res);
  const ok = await loadData();
  if(!ok){ hideWelcome(0); signOut(); state.pinError = 'network'; render(); return; }
  restoreCartDraft();
  render();
  hideWelcome();
  heartbeat();
  if(pushStatus.subscribed) resyncPush();
  maybeOpenRicoProviderSetup();
}
/* The secret code, typed on the keypad instead of a PIN: "Who are you?"
   (only the saved answer, written exactly, goes on; anything else just
   closes), then Rozha's PIN, then new PINs, a new secret code and/or a new
   answer. Saving a PIN or the code signs every phone out. */
async function startRecovery(ticket){
  const name = await showPrompt(esc(t('whoAreYou')), {plain:true, okLabel:t('continue'), cancelLabel:t('cancel')});
  if(name === null) return;
  const step1 = await api('recovery/name', {method:'POST', body:{ticket, name}});
  if(!step1.ok){ if(step1.status === 429){ state.pinError = 'locked'; updateLoginFeedback(); } return; }
  const pin = await showPrompt(esc(t('recoveryRozhaPin')), {password:true, maxLength:6, okLabel:t('continue'), cancelLabel:t('cancel')});
  if(pin === null) return;
  const step2 = await api('recovery/verify', {method:'POST', body:{ticket, pin}});
  if(!step2.ok){ state.pinError = step2.status === 429 ? 'locked' : 'wrong'; updateLoginFeedback(); return; }
  const field = (id, label)=>`<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" data-clear="1"></div>`;
  await showFormModal({
    title: t('recoveryTitle'),
    bodyHtml: `<div class="notif-sub">${esc(t('recoveryHint'))}</div>${field('recRozha', t('recoveryNewRozha'))}${field('recYunis', t('recoveryNewYunis'))}${field('recCode', t('recoveryNewCode'))}`
      + `<div class="field"><label for="recAnswer">${esc(t('recoveryNewAnswer'))}</label><input id="recAnswer" type="text" maxlength="40" autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"><div class="field-hint">${esc(t('recoveryAnswerHint'))}</div></div>`,
    okLabel: t('save'),
    onSubmit: async ()=>{
      const v = id=>document.getElementById(id).value.trim();
      const rozhaPin = v('recRozha'), yunisPin = v('recYunis'), secretCode = v('recCode'), answer = v('recAnswer');
      const given = [rozhaPin, yunisPin, secretCode].filter(Boolean);
      if(!given.length && !answer) return {error:t('recoveryNothing')};
      if(given.some(x=>!/^\d{6}$/.test(x))) return {error:t('pinsInvalidLength')};
      if(new Set(given).size !== given.length) return {error:t('pinsDuplicate')};
      const r = await api('recovery/save', {method:'POST', body:{ticket, rozhaPin, yunisPin, secretCode, answer}});
      if(r.ok){ setTimeout(()=>showAlert(esc(t('recoverySaved'))), 260); return {}; }
      const code = r.data && r.data.error;
      if(code === 'weak_pin') return {error:t('pinsWeak')};
      if(code === 'duplicate_pin') return {error:t('pinsDuplicate')};
      if(r.status === 401) return {error:t('recoveryExpired')};
      return {error:t('saveFailed')};
    }
  });
}
function attachLoginEvents(){
  const lang = document.getElementById('loginLangBtn');
  if(lang) lang.onclick = e=>{ e.stopPropagation(); openLangMenu(lang); };
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick = ()=>pressKey(b.dataset.key));
}
/* Physical keyboards (computers / tablets with a keyboard) can type the PIN. */
document.addEventListener('keydown', e=>{
  if(state.account || e.ctrlKey || e.metaKey || e.altKey) return;
  if(document.querySelector('#modalRoot .modal-overlay') || document.getElementById('langLayer')) return;
  if(/^[0-9]$/.test(e.key)) pressKey(e.key);
  else if(e.key === 'Backspace') pressKey('back');
  else if(e.key === 'Escape') pressKey('clear');
});

/* ============ Order screen ============ */
/* A unit's name in the current language (English when it has none). */
function unitName(u){ return !u ? '' : state.lang === 'ku' ? (u.ku || u.en) : state.lang === 'ar' ? (u.ar || u.en) : u.en; }
function unitLabel(unitId){ return unitName(state.units.find(x=>x.id===unitId)); }
function supplierName(id){
  const s = state.suppliers.find(x=>x.id===id);
  return s ? s.name : t('noSupplier');
}
function nameCollator(){ return new Intl.Collator(({en:'en', ku:'ckb', ar:'ar'})[state.lang], {sensitivity:'base', numeric:true}); }
function sortedByName(rows){ return [...rows].sort((a,b)=>nameCollator().compare(a.name||'', b.name||'')); }
function sortedSupplierItems(rows){
  const custom = rows.some(i=>Number.isInteger(i.sortOrder));
  if(!custom) return sortedByName(rows);
  return [...rows].sort((a,b)=>{
    const ar=Number.isInteger(a.sortOrder)?a.sortOrder:null, br=Number.isInteger(b.sortOrder)?b.sortOrder:null;
    if(ar!==null && br!==null && ar!==br) return ar-br;
    if(ar!==null && br===null) return -1;
    if(ar===null && br!==null) return 1;
    return nameCollator().compare(a.name||'', b.name||'');
  });
}
/* Was anything already sent to this supplier today? Used to warn (not
   block) before sending again. */
function sentToSupplierToday(supplierId){
  const today = erbilDate(new Date().toISOString());
  return state.history.some(rec=> erbilDate(rec.date)===today && rec.entries.some(e=>e.supplierId===supplierId));
}
function lastOrderMap(){
  if(!state.history.length) return null;
  const last = state.history[state.history.length-1];
  const map = {};
  last.entries.forEach(e=>e.items.forEach(it=>{ map[it.itemId] = it.qty; }));
  return map;
}
/* Suppliers the current tab covers, and how many of them have something picked. */
function supplierCoverage(){
  const scope = state.orderTab==='all' ? state.items : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab);
  // Items with no supplier are ordered too, but only real suppliers count here
  // (so the ring agrees with "N items across M suppliers" under it).
  const all = new Set(scope.map(i=>i.supplierId).filter(Boolean));
  const picked = new Set(scope.filter(i=>i.supplierId && (state.cart[i.id]||0)>0).map(i=>i.supplierId));
  return {total:all.size, picked:picked.size};
}
const RING_C = 2*Math.PI*26;
function ringOffset(){ const c=supplierCoverage(); return c.total ? RING_C*(1-c.picked/c.total) : RING_C; }
function renderOrderHero(itemCount=state.items.length, supplierCount=new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size){
  const selCount = cartCount();
  const cov = supplierCoverage();
  return `<div class="hero-card order-hero">
    <div class="hero-copy"><div class="hero-eyebrow">${t('heroEyebrow')}</div>
    <div class="hero-stat" aria-live="polite" aria-label="${esc(t('heroStat')(selCount))}"><span class="hero-count">${selCount}</span><span class="hero-word">${t('heroStatWord')(selCount)}</span></div>
    <div class="hero-sub">${t('heroSub')(itemCount, supplierCount)}</div></div>
    <div class="hero-ring" role="img" aria-label="${esc(t('suppliersCovered')(cov.picked, cov.total))}">
      <svg viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="26" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="7"/><circle class="arc" cx="34" cy="34" r="26" fill="none" stroke="#6FCF9A" stroke-width="7" stroke-linecap="round" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${ringOffset().toFixed(2)}"/></svg>
      <b>${cov.picked}/${cov.total}</b></div>
    <div class="hero-footer"><span class="draft-state">${selCount?t('draftLocal'):t('selectToStart')}</span><span class="hero-signature" aria-hidden="true">ricotta.</span></div>
  </div>`;
}
/* A small monogram tile for a supplier (first letter, deep green). */
function supplierMono(name){
  const ch = Array.from(String(name||'').trim())[0] || '·';
  return `<span class="supplier-mono" aria-hidden="true">${esc(ch.toLocaleUpperCase())}</span>`;
}
function renderOrderArrangeControl(){
  return canOpen('itemsAdmin') && state.orderTab!=='all' && state.orderTab!=='__none'
    ? `<button class="item-sort-trigger" data-sort-supplier="${esc(state.orderTab)}">${t('sortSupplierItems')}</button>` : '';
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
    return emptyState(t('noItemsYet'));
  }
  const tabs = orderTabs();
  if(!tabs.some(tb=>tb.id===state.orderTab)) state.orderTab = 'all';

  const groupHtml = renderOrderResults();
  const selectedCount = state.orderTab==='all' ? state.items.length : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab).length;
  const selectedSupplierCount = state.orderTab==='all' ? new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size : (selectedCount ? 1 : 0);

  const tabsHtml = `<div class="order-tabs-shell">
    <button class="tab-scroll tab-scroll-prev" id="orderTabsPrev" aria-label="${t('previousSuppliers')}">‹</button>
    <div class="order-tabs" id="orderTabs">${tabs.map(tb=>`
      <button class="tab-pill ${state.orderTab===tb.id?'active':''}" aria-pressed="${state.orderTab===tb.id}" data-ordertab="${esc(tb.id)}">${esc(tb.label)}<span class="tab-count">${tb.id==='all'?state.items.length:state.items.filter(i=>(i.supplierId||'__none')===tb.id).length}</span></button>
    `).join('')}</div>
    <button class="tab-scroll tab-scroll-next" id="orderTabsNext" aria-label="${t('nextSuppliers')}">›</button>
  </div>`;

  const lastMap = lastOrderMap();
  return `
    ${renderOrderHero(selectedCount, selectedSupplierCount)}
    <div id="ricoSuggest">${renderRicoSuggestion()}</div>
    ${tabsHtml}
    <div class="order-arrange-row" id="orderArrangeRow">${renderOrderArrangeControl()}</div>
    <div class="search-row">
      <div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itemSearch" aria-label="${t('searchPlaceholder')}" placeholder="${t('searchPlaceholder')}" value="${esc(state.search)}"></div>
      <div class="order-quick-actions">
        ${lastMap ? `<button class="quick-btn" id="sameAsLast">${ICON_REPEAT}${t('sameAsLastTime')}</button>` : ''}
        <button class="quick-btn clear-order-btn" id="clearOrderBtn" ${cartCount()===0?'disabled':''}>${t('clearOrder')}</button>
      </div>
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
    const rows = sortedSupplierItems(groups[key]).map(i=>{
      const qty = state.cart[i.id] || 0;
      return `
      <div class="item-row ${qty>0?'has-qty':''}" data-item-id="${esc(i.id)}">
        <div class="item-info">
          <div class="item-name">${esc(i.name)}</div>
          <div class="item-unit">${esc(unitLabel(i.unit))}</div>
        </div>
        <div class="stepper">
          <button class="step-btn" data-dec="${esc(i.id)}" aria-label="${esc(t('decreaseQty')(i.name))}" ${qty>0?'':'disabled'}>−</button>
          <input class="qty-input" type="number" inputmode="numeric" min="0" value="${qty}" aria-label="${esc(t('quantityFor')(i.name))}" data-qty="${esc(i.id)}">
          <button class="step-btn" data-inc="${esc(i.id)}" aria-label="${esc(t('increaseQty')(i.name))}">+</button>
        </div>
      </div>`;
    }).join('');
    const arrangeButton = canOpen('itemsAdmin') && key!=='__none'
      ? `<button class="item-sort-trigger" data-sort-supplier="${esc(key)}">${t('sortSupplierItems')}</button>` : '';
    return state.orderTab==='all' ? `<div class="supplier-group">
      <div class="supplier-head"><span class="supplier-heading-name">${supplierMono(label)}${esc(label)}<span class="supplier-item-count">${groups[key].length}</span></span>${arrangeButton}</div>
      <div class="supplier-items-grid">${rows}</div>
    </div>` : `<div class="supplier-items-grid standalone">${rows}</div>`;
  }).join('');

  return groupHtml;
}
function refreshOrderResults(){
  const results = document.getElementById('orderResults');
  if(!results) return;
  results.innerHTML = renderOrderResults() || emptyState(t('noSearchResults'));
  attachOrderResultEvents(results);
}
/* Quantity changes keep every row and input mounted, including keyboard
   focus and pointer targets. Filtering is the only path rebuilding results. */
function refreshOrderView(pulseItemId=null){
  persistCartDraft();
  document.querySelectorAll('#orderResults [data-qty]').forEach(input=>{
    if(pulseItemId && input.dataset.qty!==pulseItemId) return;
    const qty=state.cart[input.dataset.qty]||0, row=input.closest('.item-row');
    input.value=qty;
    row.classList.toggle('has-qty',qty>0);
    row.querySelector('[data-dec]').disabled=qty===0;
    if(pulseItemId) bump(input);
  });
  refreshCartSummary();
}
function refreshCartSummary(){
  const c=cartCount();
  // Hero stat
  const hero = document.querySelector('.hero-card');
  if(hero){
    const selectedCount = state.orderTab==='all' ? state.items.length : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab).length;
    const selectedSupplierCount = state.orderTab==='all' ? new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size : (selectedCount ? 1 : 0);
    const stat = hero.querySelector('.hero-stat');
    const count = hero.querySelector('.hero-count');
    const sub = hero.querySelector('.hero-sub');
    if(count && count.textContent !== String(c)){ count.textContent = c; bump(count); }
    hero.querySelector('.hero-word').textContent = t('heroStatWord')(c);
    if(stat) stat.setAttribute('aria-label', t('heroStat')(c));
    if(sub) sub.textContent = t('heroSub')(selectedCount, selectedSupplierCount);
    const cov = supplierCoverage(), ring = hero.querySelector('.hero-ring');
    if(ring){
      ring.querySelector('.arc').setAttribute('stroke-dashoffset', ringOffset().toFixed(2));
      ring.querySelector('b').textContent = `${cov.picked}/${cov.total}`;
      ring.setAttribute('aria-label', t('suppliersCovered')(cov.picked, cov.total));
    }
  }
  // Floating send bar: springs in with the first picked item, away with the last.
  const bar = document.querySelector('.bottom-bar');
  if(bar){
    bar.classList.toggle('show', c>0);
    const send = document.getElementById('sendOrdersBtn');
    send.disabled = c === 0;
    send.querySelector('.send-meta').textContent = sendMeta();
  }
  const clear=document.getElementById('clearOrderBtn');
  if(clear) clear.disabled=c===0;
  const draft=document.querySelector('.draft-state');
  if(draft) draft.textContent=c?t('draftLocal'):t('selectToStart');
  paintRicoSuggestion();
}
function cartCount(){ return Object.values(state.cart).filter(q=>q>0).length; }
function sendMeta(){
  const c = cartCount();
  const sups = new Set(Object.keys(state.cart).filter(id=>state.cart[id]>0).map(id=>(state.items.find(i=>i.id===id)||{}).supplierId||'__none')).size;
  return c ? `${t('itemsSelected')(c)} · ${t('supplierCount')(sups)}` : '';
}
function renderOrderBottomBar(){
  const c = cartCount();
  return `<div class="bottom-bar ${c>0?'show':''}">
    <button class="send-btn" id="sendOrdersBtn" ${c===0?'disabled':''}>
      <span class="send-text"><span class="send-label">${t('sendOrders')}</span><span class="send-meta">${sendMeta()}</span></span>
      <span class="send-go" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span>
    </button>
  </div>`;
}
function attachOrderEvents(){
  document.querySelectorAll('[data-ordertab]').forEach(b=>b.onclick=()=>{
    if(state.orderTab===b.dataset.ordertab) return;
    state.orderTab = b.dataset.ordertab;
    document.querySelectorAll('[data-ordertab]').forEach(tab=>{
      const active=tab.dataset.ordertab===state.orderTab;
      tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));
    });
    const arrange=document.getElementById('orderArrangeRow');
    arrange.innerHTML=renderOrderArrangeControl();
    attachOrderResultEvents(arrange);
    refreshOrderResults();refreshCartSummary();
    animateUi(document.getElementById('orderResults'),[{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'none'}]);
  });
  const search = document.getElementById('itemSearch');
  if(search) search.oninput = (e)=>{
    state.search = e.target.value;
    refreshOrderResults();
  };
  attachOrderResultEvents(document.getElementById('orderResults'));
  const tabs=document.getElementById('orderTabs');
  if(tabs){
    const scrollTabs=step=>{
      const pills=[...tabs.querySelectorAll('.tab-pill')];
      if(!pills.length) return;
      const center=tabs.getBoundingClientRect().left+tabs.clientWidth/2;
      let index=0, distance=Infinity;
      pills.forEach((pill,i)=>{const rect=pill.getBoundingClientRect();const d=Math.abs(rect.left+rect.width/2-center);if(d<distance){distance=d;index=i;}});
      pills[Math.max(0,Math.min(pills.length-1,index+step))].scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest',inline:'center'});
    };
    const prev=document.getElementById('orderTabsPrev');
    const next=document.getElementById('orderTabsNext');
    if(prev) prev.onclick=()=>scrollTabs(-1);
    if(next) next.onclick=()=>scrollTabs(1);
    tabs.addEventListener('wheel',e=>{
      if(Math.abs(e.deltaY)<=Math.abs(e.deltaX)) return;
      e.preventDefault();
      tabs.scrollBy({left:e.deltaY,behavior:'auto'});
    },{passive:false});
    tabs.querySelector('.tab-pill.active')?.scrollIntoView({block:'nearest',inline:'center'});
  }
  attachOrderResultEvents(document.getElementById('orderArrangeRow'));
  const same = document.getElementById('sameAsLast');
  if(same) same.onclick = ()=>{ const m = lastOrderMap(); if(m) state.cart = Object.fromEntries(Object.entries(m).filter(([id,qty])=>state.items.some(i=>i.id===id) && qty>0)); refreshOrderView(); };
  const clear=document.getElementById('clearOrderBtn');
  if(clear) clear.onclick=()=>{
    const before={...state.cart};
    state.cart={};persistCartDraft();refreshOrderView();
    toast(t('orderCleared'),'ok',{undo:()=>{ state.cart=before; persistCartDraft(); refreshOrderView(); }});
  };
  const send = document.getElementById('sendOrdersBtn');
  if(send) send.onclick = ()=>startSendQueue();
  loadRicoSuggestion();
}
/* Opens Send to suppliers with the current draft (the Send button, and
   Rico's "open send" shortcut). Returns false when there is nothing to send. */
async function startSendQueue(){
  if(state.queue?.saveState === 'failed'){ goView('queue'); return true; }
  const bySupplier = {};
  Object.keys(state.cart).forEach(id=>{
    const qty = state.cart[id]; if(!qty) return;
    const item = state.items.find(i=>i.id===id); if(!item) return;
    const sid = item.supplierId || '__none';
    (bySupplier[sid] = bySupplier[sid]||[]).push({itemId:id, name:item.name, qty, unit:item.unit, sortOrder:item.sortOrder});
  });
  // Not a hard block -- ordering twice in a day can be intentional -- just
  // make sure it's not an accident before it goes out again.
  const already = Object.keys(bySupplier).filter(sid=>sid!=='__none' && sentToSupplierToday(sid));
  if(already.length){
    const names = already.map(sid=>(state.suppliers.find(s=>s.id===sid)||{}).name).filter(Boolean).join(', ');
    if(!(await showConfirm(t('confirmDoubleOrder')(names)))) return false;
  }
  if(!Object.keys(bySupplier).length) return false;
  state.queue = Object.keys(bySupplier).map(sid=>({
    supplierId: sid, items: bySupplier[sid], sent:false
  }));
  goView('queue');
  return true;
}
function attachOrderResultEvents(root){
  if(!root) return;
  root.querySelectorAll('[data-sort-supplier]').forEach(button=>button.onclick=()=>openSupplierItemOrder(button.dataset.sortSupplier));
  root.querySelectorAll('[data-inc],[data-dec]').forEach(b=>{
    // Pointer presses are handled by the hold-to-repeat code below; a click
    // with detail 0 comes from the keyboard (Enter or Space).
    b.onclick=e=>{ if(e.detail===0) stepQty(b); };
    b.onpointerdown=e=>startStepHold(b,e);
    b.oncontextmenu=e=>e.preventDefault();
  });
  root.querySelectorAll('[data-qty]').forEach(inp=>{
    inp.onfocus=()=>{ if(inp.value==='0') inp.value=''; else requestAnimationFrame(()=>inp.select()); };
    inp.onblur=()=>{ if(inp.value===''){ inp.value='0'; } };
    inp.onkeydown=e=>{ if(e.key==='Enter') inp.blur(); };
  });
  root.querySelectorAll('.item-row').forEach(row=>{ row.onpointerdown=e=>startRowPress(row,e); });
  root.querySelectorAll('[data-qty]').forEach(inp=>inp.onchange=()=>{
    const id=inp.dataset.qty; const v=Math.max(0, parseInt(inp.value)||0); state.cart[id]=v; refreshOrderView(id);
  });
  root.querySelectorAll('[data-qty]').forEach(inp=>inp.oninput=()=>{
    const id=inp.dataset.qty; state.cart[id]=inp.value===''?0:Math.max(0,parseInt(inp.value)||0);
    persistCartDraft();
    inp.closest('.item-row').classList.toggle('has-qty',state.cart[id]>0);
    inp.closest('.item-row').querySelector('[data-dec]').disabled=state.cart[id]===0;
    refreshCartSummary();
  });
}

/* ============ Order: steppers, press-and-hold menu, Rico suggests ============ */
/* One step up or down, from a tap, a held button or the keyboard. */
function stepQty(btn){
  const id = btn.dataset.inc || btn.dataset.dec;
  if(!id) return;
  const next = btn.dataset.inc ? (state.cart[id]||0)+1 : Math.max(0,(state.cart[id]||0)-1);
  if(next === (state.cart[id]||0)) return;
  state.cart[id] = next;
  refreshOrderView(id);
  playQtyTick(!!btn.dataset.inc);
}
/* Hold + or − and the number keeps going, faster the longer it's held. */
let stepHold = null;
function stopStepHold(){
  if(!stepHold) return;
  clearTimeout(stepHold.timer);
  stepHold.btn.classList.remove('holding');
  stepHold = null;
}
function startStepHold(btn, e){
  if(e.button > 0 || btn.disabled) return;
  e.preventDefault();   // no text selection or focus jump while holding
  stopStepHold();
  stepHold = {btn, timer:0, n:0};
  btn.classList.add('holding');
  stepQty(btn);
  const tick = ()=>{
    if(!stepHold || stepHold.btn !== btn || btn.disabled || !btn.isConnected){ stopStepHold(); return; }
    stepQty(btn); stepHold.n++;
    stepHold.timer = setTimeout(tick, Math.max(45, 150 - stepHold.n*9));
  };
  stepHold.timer = setTimeout(tick, 420);
  const up = ()=>{ stopStepHold(); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}
window.addEventListener('blur', stopStepHold);

/* Press and hold an item row: the page blurs, the row lifts, and a small
   glass menu offers quick amounts, typing a number, or removing it. */
let rowPress = null;
function startRowPress(row, e){
  if(e.button > 0 || e.target.closest('.stepper,button,input')) return;
  const x = e.clientX, y = e.clientY;
  rowPress?.cancel();
  row.classList.add('pressing');
  const press = {row, timer:0, cancel:()=>{
    clearTimeout(press.timer); row.classList.remove('pressing');
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', press.cancel); document.removeEventListener('pointercancel', press.cancel);
    if(rowPress === press) rowPress = null;
  }};
  const move = ev=>{ if(Math.abs(ev.clientX-x) > 8 || Math.abs(ev.clientY-y) > 8) press.cancel(); };
  press.timer = setTimeout(()=>{ press.cancel(); openItemMenu(row); }, 480);
  rowPress = press;
  document.addEventListener('pointermove', move, {passive:true});
  document.addEventListener('pointerup', press.cancel);
  document.addEventListener('pointercancel', press.cancel);
}
function closeContextMenu(){
  const layer = document.getElementById('ctxLayer');
  if(!layer) return;
  layer.classList.add('closing');
  setTimeout(()=>layer.remove(), 220);
}
function openItemMenu(row){
  const id = row.dataset.itemId, item = state.items.find(i=>i.id===id);
  if(!item) return;
  closeContextMenu();
  const qty = state.cart[id] || 0;
  const rect = row.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.id = 'ctxLayer'; layer.className = 'ctx-layer';
  const actions = [[1,t('cmAdd')(1),ICON_PLUS],[5,t('cmAdd')(5),ICON_PLUS],[10,t('cmAdd')(10),ICON_PLUS],['type',t('cmType'),ICON_EDIT]];
  if(qty) actions.push(['remove',t('cmRemove'),ICON_DELETE]);
  const menuH = actions.length*48 + 8, below = rect.bottom + 12 + menuH < window.innerHeight - 90;
  layer.innerHTML = `<div class="ctx-scrim"></div>
    <div class="ctx-preview" style="top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px"></div>
    <div class="ctx-menu ${below?'':'up'}" role="menu" style="${below?`top:${rect.bottom+12}px`:`top:${Math.max(12, rect.top-12-menuH)}px`};${isRtl()?`left:${Math.max(12,rect.left)}px`:`right:${Math.max(12, window.innerWidth-rect.right)}px`}">
      ${actions.map(([a,label,icon])=>`<button type="button" role="menuitem" class="${a==='remove'?'danger':''} ${a==='type'?'sep':''}" data-ctx="${a}"><span>${esc(label)}</span>${icon}</button>`).join('')}
    </div>`;
  const clone = row.cloneNode(true);
  clone.classList.remove('pressing');
  clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  clone.querySelectorAll('button,input').forEach(el=>{ el.tabIndex=-1; el.setAttribute('aria-hidden','true'); });
  layer.querySelector('.ctx-preview').appendChild(clone);
  document.body.appendChild(layer);
  layer.querySelector('.ctx-scrim').onclick = closeContextMenu;
  layer.addEventListener('keydown', e=>{ if(e.key==='Escape') closeContextMenu(); });
  layer.querySelector('[data-ctx]')?.focus({preventScroll:true});
  layer.querySelectorAll('[data-ctx]').forEach(b=>b.onclick=()=>{
    const a = b.dataset.ctx, before = state.cart[id] || 0;
    closeContextMenu();
    if(a === 'type'){ setTimeout(()=>document.querySelector(`#orderResults [data-qty="${CSS.escape(id)}"]`)?.focus(), 240); return; }
    if(a === 'remove'){
      state.cart[id] = 0; refreshOrderView(id);
      toast(t('itemRemoved'), 'ok', {undo:()=>{ state.cart[id] = before; refreshOrderView(id); }});
      return;
    }
    state.cart[id] = before + Number(a); refreshOrderView(id);
  });
}

/* "Rico suggests": today's most due supplier with its usual items, worked
   out on the server from order history (no AI call). Loaded quietly after
   the Order screen appears and cached for a few minutes. */
const ricoSuggestion = {data:null, at:0, busy:false};
const RICO_SUGGEST_TTL = 4*60*1000;
function ricoSuggestionKey(sg){ return sg ? erbilNow().date+'|'+sg.supplierId : ''; }
function currentRicoSuggestion(){
  const sg = ricoSuggestion.data;
  if(!sg || !Array.isArray(sg.lines) || !sg.lines.length) return null;
  if(lget('ricoSuggestHidden') === ricoSuggestionKey(sg)) return null;
  const lines = sg.lines.filter(l=>state.items.some(i=>i.id===l.itemId));
  if(!lines.length || lines.every(l=>(state.cart[l.itemId]||0) >= l.qty)) return null;
  if(sentToSupplierToday(sg.supplierId)) return null;
  return {...sg, lines};
}
function renderRicoSuggestion(){
  const sg = currentRicoSuggestion();
  if(!sg) return '';
  const name = (state.suppliers.find(s=>s.id===sg.supplierId)||{}).name || sg.supplier;
  const day = t('weekdays')[erbilNow().weekday];
  const iso = s=>'\u2068'+s+'\u2069';   // keeps a Kurdish name from flipping an English sentence (and the reverse)
  const text = sg.due && sg.reminder ? t('ricoSuggestDue')(iso(name), formatStoredIraqTime(sg.reminder)) : t('ricoSuggestUsual')(iso(name), day);
  const preview = sg.lines.slice(0,3).map(l=>esc(l.name)).join(' · ') + (sg.lines.length>3 ? ` +${sg.lines.length-3}` : '');
  return `<div class="rico-suggest glass ${sg.due?'due':''}">
    ${ricoFace(sg.due ? 'worried' : 'happy', 'rico-xs')}
    <div class="rico-suggest-text"><b>${esc(t('ricoSuggestsLabel'))}</b><span>${esc(text)}</span><small dir="auto">${preview}</small></div>
    <button type="button" class="btn btn-primary rico-suggest-add" id="ricoSuggestAdd">${esc(t('ricoSuggestAdd')(sg.lines.length))}</button>
    <button type="button" class="rico-suggest-x" id="ricoSuggestHide" aria-label="${esc(t('ricoSuggestDismiss'))}">×</button>
  </div>`;
}
function paintRicoSuggestion(){
  const box = document.getElementById('ricoSuggest');
  if(!box) return;
  const html = renderRicoSuggestion();
  if(box.dataset.html !== html){ box.innerHTML = html; box.dataset.html = html; }
  const add = document.getElementById('ricoSuggestAdd'), hide = document.getElementById('ricoSuggestHide');
  if(add) add.onclick = ()=>{
    const sg = currentRicoSuggestion(); if(!sg) return;
    const before = {...state.cart};
    sg.lines.forEach(l=>{ state.cart[l.itemId] = Math.max(state.cart[l.itemId]||0, Math.max(1, Math.round(Number(l.qty)||1))); });
    persistCartDraft(); refreshOrderView();
    const name = (state.suppliers.find(s=>s.id===sg.supplierId)||{}).name || sg.supplier;
    toast(t('ricoSuggestAdded')(sg.lines.length, '\u2068'+name+'\u2069'), 'ok', {undo:()=>{ state.cart = before; persistCartDraft(); refreshOrderView(); }});
  };
  if(hide) hide.onclick = ()=>{ lset('ricoSuggestHidden', ricoSuggestionKey(ricoSuggestion.data)); paintRicoSuggestion(); };
}
async function loadRicoSuggestion(){
  paintRicoSuggestion();
  if(ricoSuggestion.busy || Date.now() - ricoSuggestion.at < RICO_SUGGEST_TTL) return;
  ricoSuggestion.busy = true;
  try{
    const r = await api('assistant/suggestion');
    ricoSuggestion.at = Date.now();
    if(r.ok) ricoSuggestion.data = r.data && r.data.suggestion || null;
  }finally{ ricoSuggestion.busy = false; }
  if(state.view === 'order') paintRicoSuggestion();
}

/* ============ Send queue ============ */
function buildMessage(entry){
  const lines = sortedSupplierItems(entry.items).map(i=>`• ${i.name} — ${i.qty} ${unitLabel(i.unit)}`);
  const header = ({en:'New order from Ricotta:', ku:'داواکارییەکی نوێ لە چێشتخانەی ریکۆتا:', ar:'طلب جديد من مطبخ ريكوتا:'})[state.lang];
  return header + '\n' + lines.join('\n');
}
function waLink(phone, text){
  let p = (phone||'').replace(/[^0-9]/g,'');
  if(p.startsWith('0')) p = '964' + p.slice(1);
  else if(!p.startsWith('964')) p = '964' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
const ICON_CHAT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5Z"/></svg>`;
const ICON_BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`;
function renderQueue(){
  if(!state.queue) return emptyState(t('noHistory'));
  const done = state.queue.filter(e=>e.sent).length, total = state.queue.length;
  const cards = state.queue.map((e,idx)=>{
    const sup = state.suppliers.find(s=>s.id===e.supplierId);
    const name = sup ? sup.name : t('noSupplier');
    const itemsLine = sortedSupplierItems(e.items).map(i=>`${esc(i.name)} × ${i.qty} ${esc(unitLabel(i.unit))}`).join(' · ');
    const canWhatsApp = !!(sup && sup.phone);
    const sendBtn = canWhatsApp
      ? `<button class="wa-btn ${e.sent?'done':''}" data-send="${idx}">${ICON_CHAT}${e.sent?t('sentSendAgain'):t('sendVia')}</button>`
      : `<button class="wa-btn ${e.sent?'done':''}" data-marksent="${idx}" ${e.sent?'disabled':''}>${e.sent?t('sent'):t('markSent')}</button>`;
    return `<div class="queue-card ${e.sent?'sent':''}">
      <div class="queue-top"><span class="queue-name">${supplierMono(name)}${esc(name)}</span>${e.sent?`<span class="queue-badge">✓ ${t('sent')}</span>`:`<span class="queue-count">${t('itemCount')(e.items.length)}</span>`}</div>
      <div class="queue-items">${itemsLine}</div>
      ${canWhatsApp ? '' : `<div class="queue-note">${esc(!sup ? t('noSupplier') : t('noPhoneOnFile'))} · ${esc(t('markSentHint'))}</div>`}
      <div class="queue-actions">${sendBtn}<button class="pdf-btn" data-pdf="${idx}" aria-label="${esc(t('orderSheet'))}">${NAV_ICONS.record}<span>PDF</span></button></div>
    </div>`;
  }).join('');
  return `<div class="queue-head">
      <button class="queue-back" id="queueBackBtn" aria-label="${esc(t('backToOrder'))}">${ICON_BACK}</button>
      <div class="queue-progress"><div class="queue-progress-label">${t('sentProgress')(done,total)}</div><div class="queue-bar"><i style="--p:${Math.round(done/total*100)}%"></i></div></div>
    </div>
    ${done===total ? `<div class="queue-done" role="status"><span class="tick"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span><b>${t('allSentTitle')}</b><small>${state.queue.saveState === 'failed' ? esc(t('orderRetrySaveHint')) : state.queue.saveState === 'saving' ? esc(t('loading')) : t('allSentSub')}</small></span>${state.queue.saveState === 'failed' ? `<button type="button" class="btn btn-primary" id="queueRetrySave">${esc(t('retry'))}</button>` : ''}</div>` : ''}
    ${cards}`;
}
function markQueueSent(idx){
  const entry = state.queue && state.queue[idx];
  if(!entry) return;
  entry.sent = true;
  render();
  maybeFinishQueue();
}
function attachQueueEvents(){
  const retry = document.getElementById('queueRetrySave');
  if(retry) retry.onclick = ()=>withBusy(retry, maybeFinishQueue);
  const back = document.getElementById('queueBackBtn');
  if(back) back.onclick = ()=>goView('order');
  document.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>{
    const entry = state.queue[parseInt(b.dataset.pdf)]; const supplier = state.suppliers.find(s=>s.id===entry?.supplierId);
    if(entry) printOrderSheet(entry, supplier);
  });
  document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>{
    const idx = parseInt(b.dataset.send);
    const entry = state.queue[idx];
    const sup = state.suppliers.find(s=>s.id===entry.supplierId);
    if(!sup || !sup.phone) return; // button only renders when this is safe, but guard anyway
    window.open(waLink(sup.phone, buildMessage(entry)), '_blank', 'noopener,noreferrer');
    markQueueSent(idx);
  });
  // Suppliers without a WhatsApp number (or items with no supplier) are sent
  // some other way; without this the queue could never finish and the order
  // was never saved to History.
  document.querySelectorAll('[data-marksent]').forEach(b=>b.onclick=()=>markQueueSent(parseInt(b.dataset.marksent)));
}
/* A printable order sheet for one supplier, in the app's language. */
const SHEET_WORDS = {
  en:{title:'Purchase order', none:'No supplier', items:'items', item:'Item', unit:'Unit', qty:'Qty', foot:'Please prepare this order with the quantities listed above. Thank you.'},
  ku:{title:'داواکارییەکی نوێ', none:'بێ دابینکەر', items:'کاڵا', item:'کاڵا', unit:'یەکە', qty:'بڕ', foot:'تکایە داواکارییەکە بەپێی ئەم بڕانە ئامادە بکەن. سوپاس.'},
  ar:{title:'طلب شراء', none:'بدون مورّد', items:'مواد', item:'المادة', unit:'الوحدة', qty:'الكمية', foot:'يرجى تجهيز هذا الطلب بالكميات المذكورة أعلاه. شكرًا لكم.'}
};
// The same fonts as the app: Sora, with Noto Kufi Arabic for every Kurdish or Arabic letter.
const SHEET_FONTS = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;700;800&family=Noto+Kufi+Arabic:wght@400;700;800&display=swap';
function printOrderSheet(entry, supplier){
  const w0 = SHEET_WORDS[state.lang] || SHEET_WORDS.en;
  const supplierLabel = supplier?.name || w0.none;
  const rows = sortedSupplierItems(entry.items).map((item,n)=>`<tr><td>${n+1}</td><td>${esc(item.name)}</td><td>${esc(unitLabel(item.unit))}</td><td class="qty">${item.qty}</td></tr>`).join('');
  const w = window.open('', '_blank'); if(!w) return;
  w.opener = null;
  const printedAt = formatIraqDateTime(new Date(),{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  w.document.write(`<!doctype html><html dir="${isRtl()?'rtl':'ltr'}"><head><meta charset="utf-8"><title>${w0.title} — Ricotta</title><link rel="stylesheet" href="${SHEET_FONTS}"><style>body{font-family:'Sora','Noto Kufi Arabic',Arial,sans-serif;color:#172a21;margin:0;padding:38px}.head{border-bottom:3px solid #1f5c3f;padding-bottom:18px;display:flex;justify-content:space-between;align-items:end}.brand{font-size:39px;letter-spacing:-2px}.eyebrow{color:#1f5c3f;font-weight:800;font-size:13px}.title{font-size:24px;font-weight:800;margin:8px 0}.meta{color:#5c6c63;font-size:13px;text-align:end}table{width:100%;border-collapse:collapse;margin-top:28px}th{background:#1f5c3f;color:#fff;text-align:start;padding:12px;font-size:13px}td{padding:13px 12px;border-bottom:1px solid #dce8df;font-size:14px}tr:nth-child(even){background:#f5f9f6}.qty{font-size:18px;font-weight:800;text-align:center;color:#1f5c3f}.foot{margin-top:28px;padding:15px 18px;background:#ecf6ee;border-radius:10px;color:#1f5c3f;font-weight:700}</style></head><body><header class="head"><div><div class="eyebrow">Ricotta Orders</div><div class="title">${w0.title}</div><div>${esc(supplierLabel)}</div></div><div class="meta">${esc(printedAt)}<br>${entry.items.length} ${w0.items}</div><div class="brand">Ricotta</div></header><table><thead><tr><th>#</th><th>${w0.item}</th><th>${w0.unit}</th><th>${w0.qty}</th></tr></thead><tbody>${rows}</tbody></table><div class="foot">${w0.foot}</div></body></html>`);
  w.document.close(); w.focus();
  // Print once the fonts are in, so Kurdish and Arabic names use Noto Kufi.
  const link = w.document.querySelector('link');
  const fontsIn = new Promise(r=>{ link.onload = link.onerror = r; }).then(()=>{ w.document.body.offsetWidth; return w.document.fonts.ready; });
  Promise.race([fontsIn, new Promise(r=>setTimeout(r,2000))]).then(()=>w.print());
}
let finishingQueue = null;
async function maybeFinishQueue(){
  if(finishingQueue || !state.queue || !state.queue.every(e=>e.sent)) return;
  const queue = state.queue, session = apiSession();
  finishingQueue = queue;
  if(!queue.record) playOrdersSent();
  const record = queue.record || {
    id: 'o'+outboxJobId(), date: new Date().toISOString(), by: state.account,
    entries: state.queue.map(e=>({
      supplierId: e.supplierId,
      supplierName: (state.suppliers.find(s=>s.id===e.supplierId)||{}).name || '',
      items: e.items.map(i=>({itemId:i.itemId, name:i.name, qty:i.qty, unit:i.unit}))
    }))
  };
  queue.record = record;
  queue.saveState = 'saving';
  if(state.view === 'queue') render();
  const result = await sendOrQueue('orders', 'POST', record);
  if(!apiSessionMatches(session) || state.queue !== queue){
    if(finishingQueue === queue) finishingQueue = null;
    return;
  }
  if(result === 'failed'){
    queue.saveState = 'failed'; finishingQueue = null;
    if(state.view === 'queue') render();
    toast(t('saveFailed'), 'error');
    return;
  }
  queue.saveState = 'saved';
  if(!state.history.some(h=>h.id===record.id)) state.history.push(record);
  ricoSuggestion.at = 0;
  // Preserve any quantities edited while the save was waiting on the network.
  queue.forEach(entry=>entry.items.forEach(item=>{ if(state.cart[item.itemId] === item.qty) delete state.cart[item.itemId]; }));
  persistCartDraft();
  if(state.view === 'queue') render();
  // Let the "All orders sent" card land before returning to the Order screen.
  await new Promise(r=>setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1300));
  if(finishingQueue === queue) finishingQueue = null;
  if(!apiSessionMatches(session) || state.queue !== queue) return;
  state.queue = null;
  if(state.view === 'queue') goView('order');
  toast(result === 'saved' ? t('orderSavedToHistory') : result === 'queued' ? t('orderSavedOffline') : t('saveFailed'), result === 'saved' ? 'ok' : 'warn');
}

/* ============ History ============ */
function dayLabel(date){
  const d = new Date(date), today = new Date();
  const key = x=>new Intl.DateTimeFormat('en-CA',{timeZone:IRAQ_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(x);
  const yesterday = new Date(today.getTime()-86400000);
  if(key(d)===key(today)) return t('today');
  if(key(d)===key(yesterday)) return t('yesterday');
  return formatIraqDateTime(d,{weekday:'long',day:'numeric',month:'long'});
}
function orderHistoryCard(rec){
  const time = formatIraqDateTime(rec.date,{hour:'numeric',minute:'2-digit'});
  const supplierLines = rec.entries.map(e=>{
    // Prefer the live name; fall back to the name saved with the order (a deleted supplier).
    const live = state.suppliers.find(s=>s.id===e.supplierId);
    const name = live ? live.name : (e.supplierName || t('noSupplier'));
    const itemsLine = e.items.map(i=>`${esc(i.name)} × ${i.qty} ${esc(unitLabel(i.unit))}`).join(' · ');
    return `<div class="hist-entry"><div class="hist-supplier">${supplierMono(name)}${esc(name)}</div><div class="hist-items">${itemsLine}</div></div>`;
  }).join('');
  return `<div class="hist-card">
    <div class="hist-top">
      <div class="hist-date">${esc(time)}${accountLabel(rec.by) ? ` \u00b7 ${esc(t('sentBy')(accountLabel(rec.by)))}` : ''}</div>
      <div class="row-actions">
        <button class="icon-btn" data-reorderhist="${esc(rec.id)}" aria-label="${esc(t('orderAgain'))}" title="${esc(t('orderAgain'))}">${ICON_REPEAT}</button>
        ${isRozha() ? `<button class="icon-btn danger" data-delhist="${esc(rec.id)}" aria-label="${esc(t('delete'))}" title="${esc(t('delete'))}">${ICON_DELETE}</button>` : ''}
      </div>
    </div>
    ${supplierLines}
  </div>`;
}
/* Orders, transfers and stock counts in one list, newest first, with filter chips. */
function renderHistory(){
  const showOrders = histView.filter === 'all' || histView.filter === 'orders';
  const entries = [];
  if(showOrders) state.history.forEach(rec=>entries.push({ts:new Date(rec.date).getTime(), day:rec.date, html:orderHistoryCard(rec)}));
  if(state.views.includes('stock')) entries.push(...stHistoryEntries());
  entries.sort((a,b)=>b.ts-a.ts);
  const filters = state.views.includes('stock') ? stHistoryFilters() : '';
  if(!entries.length) return stAttentionHtml()+filters+emptyState(histView.filter==='transfers'||histView.filter==='counts' ? esc(t('hcNoTransfers')) : t('noHistory'));
  let lastDay = '';
  const cards = entries.map(e=>{
    const day = dayLabel(e.day);
    const heading = day !== lastDay ? `<div class="hist-day">${esc(day)}</div>` : '';
    lastDay = day;
    return heading + e.html;
  }).join('');
  return stAttentionHtml() + filters + cards + (showOrders && state.historyHasMore ? `<button class="btn btn-ghost load-more" id="loadMoreHistoryBtn">${esc(t('loadMoreHistory'))}</button>` : '');
}
function attachHistoryEvents(){
  attachHistoryStockEvents();
  if(state.views.includes('stock')) stRefreshIfStale();
  const more = document.getElementById('loadMoreHistoryBtn');
  if(more) more.onclick = ()=>{ more.textContent = t('loading'); loadMoreHistory(); };
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
    persistCartDraft();
    goView('order');
    toast(t('reorderReady')(cartCount()));
  });
  document.querySelectorAll('[data-delhist]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteHistory')))) return;
    const id = b.dataset.delhist;
    const r = await api(`orders/${encodeURIComponent(id)}`, {method:'DELETE'});
    if(!r.ok){ await showAlert(t('saveFailed')); return; }
    state.history = state.history.filter(r=>r.id!==id);
    render();
  });
}

/* ============ Record (activity log) ============ */
/* Every add / edit / delete of a supplier, item or unit is recorded with the
   date, time and which device did it. The server writes the real entry
   itself, in the same request as the change (so it can't be skipped or
   faked). This only shows it on this phone right away; opening the Record
   screen reloads the server's copy, which replaces it. */
const ACTIVITY_MAX = 500;
function logActivity(entry){
  const rec = {
    id: 'a'+Date.now()+Math.random().toString(36).slice(2,6),
    ts: new Date().toISOString(),
    by: state.name,
    actor: state.account,
    ...entry
  };
  state.activity = [rec, ...state.activity].slice(0, ACTIVITY_MAX);
  return Promise.resolve(true);
}
/* Pulls the newest shared Record (so entries made on other phones show up). */
async function refreshActivity(){
  const r = await api('activity');
  if(r.ok && Array.isArray(r.data)){
    state.activity = r.data;
    if(state.view === 'record') render();
  }
}
/* [[key, oldValue, newValue], ...] -> only the ones that actually changed. */
function diffFields(list){
  return list
    .filter(([, from, to]) => String(from||'') !== String(to||''))
    .map(([k, from, to]) => ({k, from: from||'', to: to||''}));
}
function unitEn(unitId){
  const u = state.units.find(x=>x.id===unitId);
  return u ? u.en : '';
}
function recordFieldLabel(k){
  return ({name:t('name'), phone:t('phone'), unit:t('unit'), supplier:t('supplier'), nameKu:t('kurdishLabel'), nameAr:t('arabicLabel'), reminder:t('reminderShort')})[k] || k;
}
function recordValue(k, v){
  if(k === 'reminder') return reminderText(reminderFromCode(v));
  if(k === 'supplier' && !v) return t('noSupplier');
  if(!v) return '\u2014';
  if(k === 'unit'){
    const u = state.units.find(x=>x.en === v);
    return u ? unitName(u) : v;
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
  const filterHtml = `<div class="record-filters glass" role="group">${filters.map(f=>`
    <button class="tab-pill ${state.recordFilter===f.id?'active':''}" aria-pressed="${state.recordFilter===f.id}" data-recfilter="${f.id}">${f.label}</button>`).join('')}</div>`;
  const rows = state.activity
    .filter(a => state.recordFilter==='all' || a.type===state.recordFilter)
    .sort((a,b)=> new Date(b.ts) - new Date(a.ts));
  const cards = rows.map(a=>{
    const typeLabel = ({supplier:t('typeSupplier'), item:t('typeItem'), unit:t('typeUnit')})[a.type] || a.type;
    const actLabel = ({add:t('actionAdded'), edit:t('actionEdited'), delete:t('actionDeleted')})[a.action] || a.action;
    const dt = formatIraqDateTime(a.ts,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    // Older entries (before the two accounts) may only have a device name, or nothing.
    const who = esc(accountLabel(a.actor) || a.by || t('unnamedDevice'));
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
      <div class="section-title grow">${esc(t('record'))} (${rows.length})</div>
      <button class="btn btn-ghost" id="recRefreshBtn">${ICON_REFRESH} ${esc(t('refresh'))}</button>
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

/* ============ Shared popup pieces ============ */
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
  return formatStoredIraqTime(r.time) + ' \u00b7 ' + dayText;
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

/* ============ Saving one record ============ */
async function saveRecord(table, rec){
  return (await api(`${table}/${encodeURIComponent(rec.id)}`, {method:'PUT', body:rec})).ok;
}
async function deleteRecord(table, id){
  return (await api(`${table}/${encodeURIComponent(id)}`, {method:'DELETE'})).ok;
}

/* ============ Suppliers ============ */
function renderSuppliers(){
  const zonesOn = state.views.includes('stock');
  if(zonesOn && supView.tab === 'zones') return zonesSwitchHtml() + renderZonesPanel();
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
  return `${zonesOn ? zonesSwitchHtml() : ''}
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
        // updatedAt tells the server when the reminder was last changed, so a time that
        // has already passed today starts tomorrow instead of firing the moment you save.
        const reminder = oldCode === newCode ? s.reminder
          : rem.on ? {...newRem, updatedAt: now} : {...(s.reminder||{}), enabled:false, updatedAt: now};
        const next = {...s, name, phone, reminder};
        if(!(await saveRecord('suppliers', next))) return {error: t('saveFailed')};
        Object.assign(s, next);
        logActivity({action:'edit', type:'supplier', name, fields});
      } else {
        const next = {id:'s'+outboxJobId(), name, phone, reminder: rem.on ? {...newRem, updatedAt: now} : null};
        if(!(await saveRecord('suppliers', next))) return {error: t('saveFailed')};
        state.suppliers.push(next);
        logActivity({action:'add', type:'supplier', name,
          fields:[{k:'name', to:name}].concat(phone ? [{k:'phone', to:phone}] : [])
                 .concat(rem.on ? [{k:'reminder', to:newCode}] : [])});
      }
      render();
      if(again){ resetReminderFields(); return {keepOpen:true, message:t('savedMsg')(name)}; }
      toast(t('savedMsg')(name));
      return {};
    }
  });
}
function attachSupplierEvents(){
  document.querySelectorAll('[data-supview]').forEach(b=>b.onclick=()=>{ supView.tab=b.dataset.supview; render(); });
  if(state.views.includes('stock') && supView.tab==='zones'){ attachZonesEvents(); return; }
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
    // The database unassigns that supplier's items by itself.
    if(!(await deleteRecord('suppliers', id))){ await showAlert(t('saveFailed')); return; }
    const unassigned = state.items.filter(i=>i.supplierId===id).length;
    state.suppliers = state.suppliers.filter(s=>s.id!==id);
    state.items.forEach(i=>{ if(i.supplierId===id) i.supplierId=null; });
    if(state.itemFormSupplierId === id) state.itemFormSupplierId = null;
    logActivity({action:'delete', type:'supplier', name:sup.name, unassigned,
      fields:[{k:'name', from:sup.name}].concat(sup.phone ? [{k:'phone', from:sup.phone}] : [])});
    render();
  });
}

/* ============ Items ============ */
function renderItemsAdmin(){
  return `
    <div class="action-row">
      <button class="btn btn-primary add-btn" id="itemAddBtn">${ICON_PLUS} ${t('addItem')}</button>
      <button class="btn btn-ghost" data-gorecord="item">${NAV_ICONS.record} ${t('record')}</button>
    </div>
    ${state.views.includes('stock') ? '<div id="ijList"></div>' : ''}
    ${state.views.includes('stock') && state.items.length ? itemsAdminHeaderHtml() : ''}
    <div class="section-title">${t('items')} (${state.items.length})</div><div id="itemsAdminList">${itemsAdminListHtml()}</div>`;
}
function openSupplierItemOrder(supplierId){
  const supplier=state.suppliers.find(s=>s.id===supplierId);
  if(!supplier) return;
  const draft=sortedSupplierItems(state.items.filter(i=>i.supplierId===supplierId));
  if(!draft.length) return;
  let list;
  showFormModal({
    title:`${t('sortSupplierItems')} · ${esc(supplier.name)}`,
    bodyHtml:`<div class="item-sort-hint">${t('sortSupplierItemsHint')}</div><div id="supplierItemOrderList" class="item-sort-list"></div>`,
    okLabel:t('save'),
    onOpen:(box)=>{
      list=box.querySelector('#supplierItemOrderList');
      list.innerHTML=draft.map((item,index)=>`<div class="item-sort-row" data-item-id="${esc(item.id)}"><span class="item-sort-rank">${index+1}</span><span class="item-sort-name">${esc(item.name)}</span><button type="button" class="item-sort-handle" data-drag-handle aria-label="${esc(t('dragItem')(item.name))}" aria-keyshortcuts="ArrowUp ArrowDown" title="${esc(t('sortSupplierItems'))}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="8" cy="5" r="1.6"/><circle cx="16" cy="5" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="19" r="1.6"/><circle cx="16" cy="19" r="1.6"/></svg></button></div>`).join('');
      const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const rows=()=>[...list.querySelectorAll('.item-sort-row')];
      const updateRanks=()=>rows().forEach((row,index)=>{row.querySelector('.item-sort-rank').textContent=index+1;});
      const moveRow=(row,before)=>{
        if(before===row || (before ? row.nextElementSibling===before : row===list.lastElementChild)) return;
        const previous=new Map(rows().filter(el=>el!==row).map(el=>[el,el.getBoundingClientRect().top]));
        list.insertBefore(row,before);
        updateRanks();
        if(reducedMotion) return;
        rows().filter(el=>el!==row).forEach(el=>{
          const delta=previous.get(el)-el.getBoundingClientRect().top;
          if(Math.abs(delta)>1) el.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:230,easing:'cubic-bezier(.2,.8,.2,1)'});
        });
      };
      const placeAt=(row,y)=>{
        const before=rows().filter(el=>el!==row).find(el=>y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2) || null;
        moveRow(row,before);
      };
      let active=null;
      const modalObserver=new MutationObserver(()=>{
        if(list.isConnected) return;
        if(active?.frame) cancelAnimationFrame(active.frame);
        active?.ghost?.remove();
        active=null;
        modalObserver.disconnect();
      });
      modalObserver.observe(document.getElementById('modalRoot'),{childList:true});
      list.addEventListener('pointerdown',e=>{
        const handle=e.target.closest('[data-drag-handle]');
        if(!handle || e.button!==0 || active) return;
        const row=handle.closest('.item-sort-row');
        active={handle,row,pointerId:e.pointerId,startY:e.clientY,lastY:e.clientY,ghost:null,frame:null};
        handle.setPointerCapture(e.pointerId);
      });
      list.addEventListener('pointermove',e=>{
        if(!active || e.pointerId!==active.pointerId) return;
        active.lastY=e.clientY;
        if(!active.ghost && Math.abs(e.clientY-active.startY)<5) return;
        if(!active.ghost){
          const rect=active.row.getBoundingClientRect();
          const ghost=active.row.cloneNode(true);
          ghost.classList.add('item-sort-ghost');
          Object.assign(ghost.style,{top:`${rect.top}px`,left:`${rect.left}px`,width:`${rect.width}px`,height:`${rect.height}px`});
          document.body.appendChild(ghost);
          active.ghost=ghost;
          active.ghostTop=rect.top;
          active.row.classList.add('is-placeholder');
          const scroll=()=>{
            if(!active?.ghost) return;
            const bounds=list.getBoundingClientRect();
            const edge=40;
            const speed=active.lastY<bounds.top+edge ? -Math.min(16,(bounds.top+edge-active.lastY)/3) : active.lastY>bounds.bottom-edge ? Math.min(16,(active.lastY-(bounds.bottom-edge))/3) : 0;
            if(speed){list.scrollTop+=speed;placeAt(active.row,active.lastY);}
            active.frame=requestAnimationFrame(scroll);
          };
          active.frame=requestAnimationFrame(scroll);
        }
        e.preventDefault();
        active.ghost.style.transform=`translate3d(0,${e.clientY-active.startY}px,0)`;
        placeAt(active.row,e.clientY);
      });
      const finish=e=>{
        if(!active || e.pointerId!==active.pointerId) return;
        if(active.frame) cancelAnimationFrame(active.frame);
        if(active.handle.hasPointerCapture(e.pointerId)) active.handle.releasePointerCapture(e.pointerId);
        if(active.ghost){
          const {ghost,row}=active;
          const end=row.getBoundingClientRect();
          const from=active.lastY-active.startY;
          const settle=()=>{ghost.remove();row.classList.remove('is-placeholder');};
          if(reducedMotion) settle();
          else ghost.animate([{transform:`translate3d(0,${from}px,0)`,opacity:1},{transform:`translate3d(0,${end.top-active.ghostTop}px,0)`,opacity:0}],{duration:190,easing:'ease-out'}).finished.then(settle,settle);
        }
        active=null;
      };
      list.addEventListener('pointerup',finish);
      list.addEventListener('pointercancel',finish);
      list.addEventListener('keydown',e=>{
        const handle=e.target.closest('[data-drag-handle]');
        if(!handle || !['ArrowUp','ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const row=handle.closest('.item-sort-row');
        if(e.key==='ArrowUp' && row.previousElementSibling) moveRow(row,row.previousElementSibling);
        if(e.key==='ArrowDown' && row.nextElementSibling) moveRow(row,row.nextElementSibling.nextElementSibling);
      });
    },
    onSubmit:async()=>{
      const itemIds=[...list.querySelectorAll('.item-sort-row')].map(row=>row.dataset.itemId);
      const result=await api(`supplier-order/${encodeURIComponent(supplierId)}`,{method:'PUT',body:{itemIds}});
      if(!result.ok) return {error:t('saveFailed')};
      itemIds.forEach((id,index)=>{const current=state.items.find(i=>i.id===id);if(current) current.sortOrder=index;});
      render();
      toast(t('savedMsg')(supplier.name));
      return {};
    }
  });
}
function openItemModal(id){
  const existing = id ? state.items.find(i=>i.id===id) : null;
  if(id && !existing) return;
  const stockOn = state.views.includes('stock') && stockState.loaded;
  let createdId = null;   // set once a new item is saved, so a retry after a stock-setup error edits it instead of adding a second one
  const unitOptions = state.units.map(u=>`<option value="${esc(u.id)}" ${existing?.unit===u.id?'selected':''}>${esc(unitName(u))}</option>`).join('');
  // While adding a fresh item, the last supplier picked stays selected so
  // bulk-adding items for one supplier doesn't need reselecting each time.
  const currentSupplierId = existing ? existing.supplierId : state.itemFormSupplierId;
  const supOptions = `<option value="">${existing ? t('noSupplier') : t('chooseSupplier')}</option>` + state.suppliers.map(s=>`<option value="${esc(s.id)}" ${currentSupplierId===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  const lockedSupplier = !existing && state.itemFormSupplierId ? state.suppliers.find(s=>s.id===state.itemFormSupplierId) : null;
  const banner = existing
    ? editingBanner(existing.name, `${unitLabel(existing.unit)} \u00b7 ${existing.supplierId ? supplierName(existing.supplierId) : t('noSupplier')}`)
    : '';
  const par = existing ? (state.pars||[]).find(p=>p.itemId===existing.id) : null;
  showFormModal({
    title: existing ? t('editItem') : t('addItem'),
    banner,
    bodyHtml: `
      <div class="field"><label>${stockOn ? t('itAppName') : t('name')}</label><input id="mfName" data-clear="1" autocomplete="off" value="${esc(existing?.name||'')}"></div>
      <div class="field"><label>${stockOn ? t('itBuying') : t('unit')}</label><select id="mfUnit">${unitOptions}</select>${stockOn ? `<div class="field-hint">${t('itBuyingHint')}</div>` : ''}</div>
      ${stockOn ? itemStockFieldsHtml(existing) : ''}
      <div class="field">
        <label>${t('supplier')}</label>
        <select id="mfSupplier">${supOptions}</select>
        ${existing ? '' : `<div class="field-hint" id="mfSupHint">${lockedSupplier ? esc(t('supplierStaysSelected')(lockedSupplier.name)) : ''}</div>`}
      </div>
      <div class="field stock-box">
        <label class="check-row"><input type="checkbox" id="mfTrackStock" ${par?'checked':''}> ${t('trackStock')}</label>
        <div class="field-hint">${t('trackStockHint')}</div>
      </div>
      <div id="mfParFields" ${par?'':'hidden'}>
        <div class="field"><label>${t('parQty')}</label><input id="mfParQty" type="number" min="1" step="1" value="${par?par.parQty:''}"></div>
        <div class="field"><label>${t('parBusyBoost')}</label><input id="mfParBoost" type="number" min="0" step="5" value="${par?par.busyBoostPct:50}"></div>
        ${par ? `<div class="field-hint">${t('parCurrentEstimate')(par.estQty, unitLabel(existing.unit))}</div>` : ''}
      </div>`,
    okLabel: t('save'),
    againLabel: existing ? null : t('saveAndAddAnother'),
    onOpen: (box)=>{
      if(stockOn) itemStockOnOpen(box);
      const sel = box.querySelector('#mfSupplier');
      const hint = box.querySelector('#mfSupHint');
      if(sel && hint) sel.onchange = ()=>{
        const s = state.suppliers.find(x=>x.id===sel.value);
        hint.textContent = s ? t('supplierStaysSelected')(s.name) : '';
      };
      const track = box.querySelector('#mfTrackStock');
      const parFields = box.querySelector('#mfParFields');
      if(track && parFields) track.onchange = ()=>{ parFields.hidden = !track.checked; };
    },
    onSubmit: async (again)=>{
      const name = document.getElementById('mfName').value.trim();
      const unit = document.getElementById('mfUnit').value;
      const supplierId = document.getElementById('mfSupplier').value || null;
      if(!name) return {error: t('nameRequired')};
      if(!supplierId && (!existing || existing.supplierId)) return {error: t('supplierRequired')};
      const trackStock = document.getElementById('mfTrackStock').checked;
      const parQty = parseFloat(document.getElementById('mfParQty').value);
      const parBoost = parseFloat(document.getElementById('mfParBoost').value);
      if(trackStock && !(parQty > 0)) return {error: t('parQtyRequired')};
      if(stockOn){ const chk = itemStockValidate(document, unit); if(chk.error) return chk; }
      const newSupName = supplierId ? (state.suppliers.find(s=>s.id===supplierId)?.name || '') : '';
      let itemId;
      const editing = existing || (createdId ? state.items.find(x=>x.id===createdId) : null);
      if(editing){
        const i = state.items.find(x=>x.id===editing.id);
        if(!i) return {};
        itemId = i.id;
        const oldSupName = i.supplierId ? (state.suppliers.find(s=>s.id===i.supplierId)?.name || '') : '';
        const fields = diffFields([
          ['name', i.name, name],
          ['unit', unitEn(i.unit), unitEn(unit)],
          ['supplier', oldSupName, newSupName]
        ]);
        if(fields.length){
          const next = {...i, name, unit, supplierId, sortOrder:supplierId===i.supplierId?i.sortOrder:null};
          if(!(await saveRecord('items', next))) return {error: t('saveFailed')};
          Object.assign(i, next);
          logActivity({action:'edit', type:'item', name, fields});
        }
      } else {
        const supplierItems=state.items.filter(i=>i.supplierId===supplierId);
        const maxSort=supplierItems.reduce((max,i)=>Number.isInteger(i.sortOrder)?Math.max(max,i.sortOrder):max,-1);
        const next = {id:'i'+outboxJobId(), name, unit, supplierId, sortOrder:maxSort>=0?maxSort+1:null};
        if(!(await saveRecord('items', next))) return {error: t('saveFailed')};
        itemId = next.id;
        createdId = next.id;
        state.items.push(next);
        state.itemFormSupplierId = supplierId; // keep it locked in for the next item
        logActivity({action:'add', type:'item', name, fields:[
          {k:'name', to:name}, {k:'unit', to:unitEn(unit)}, {k:'supplier', to:newSupName}
        ]});
      }
      // The counting format is its own server call, after the item itself is safely saved.
      if(stockOn){
        const st = await itemStockSave(itemId, document, unit);
        if(st.error){ render(); return {error: t('itSetupFailed') + ' ' + st.error}; }
      }
      // Stock tracking is its own small server call -- it never blocks the
      // item save above, and a failure here is quiet (non-critical).
      const wasTracked = !!par;
      if(trackStock){
        const r = await api(`items/${encodeURIComponent(itemId)}/stock`, {method:'PUT', body:{parQty, busyBoostPct: Number.isFinite(parBoost)?parBoost:50}});
        if(r.ok){
          state.pars = (state.pars||[]).filter(p=>p.itemId!==itemId);
          state.pars.push({itemId, parQty, busyBoostPct: Number.isFinite(parBoost)?parBoost:50, estQty: par?par.estQty:parQty, estUpdatedAt:new Date().toISOString()});
        }
      } else if(wasTracked){
        await api(`items/${encodeURIComponent(itemId)}/stock`, {method:'PUT', body:{track:false}});
        state.pars = (state.pars||[]).filter(p=>p.itemId!==itemId);
      }
      render();
      if(stockOn) stAfterItemSaved(itemId);
      if(again) return {keepOpen:true, message:t('savedMsg')(name)};
      toast(t('savedMsg')(name));
      return {};
    }
  });
}
function bindItemRows(root){
  root.querySelectorAll('[data-edititem]').forEach(row=>row.onclick=()=> openItemModal(row.dataset.edititem));
  root.querySelectorAll('[data-delitem]').forEach(b=>b.onclick=async(e)=>{
    e.stopPropagation();   // don't also open the edit popup
    const id = b.dataset.delitem;
    const item = state.items.find(i=>i.id===id);
    if(!item) return;
    const stockWarn = stockState.loaded && stTotal(id) > 0 ? `<br><b>${esc(t('itDeleteHasStock'))}</b>` : '';
    if(!(await showConfirm(`<b>${esc(item.name)}</b><br>${t('confirmDeleteItem')}${stockWarn}`))) return;
    if(!(await deleteRecord('items', id))){ await showAlert(t('saveFailed')); return; }
    const supName = item.supplierId ? (state.suppliers.find(s=>s.id===item.supplierId)?.name || '') : '';
    state.items = state.items.filter(i=>i.id!==id);
    delete state.cart[id];
    persistCartDraft();
    stockState.settings.delete(id);
    logActivity({action:'delete', type:'item', name:item.name, fields:[
      {k:'name', from:item.name}, {k:'unit', from:unitEn(item.unit)}, {k:'supplier', from:supName}
    ]});
    if(stockState.loaded) loadStock();
    render();
  });
}
function attachItemEvents(){
  document.getElementById('itemAddBtn').onclick = ()=> openItemModal(null);
  if(state.views.includes('stock')) ijMount();
  const list = document.getElementById('itemsAdminList');
  bindItemRows(list);
  // Filter chips and search only replace the list, so typing never loses focus.
  const repaint = ()=>{ list.innerHTML = itemsAdminListHtml(); bindItemRows(list); };
  document.querySelectorAll('[data-itfilter]').forEach(b=>b.onclick=()=>{
    itemsView.filter = b.dataset.itfilter;
    document.querySelectorAll('[data-itfilter]').forEach(x=>{ const on = x===b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
    repaint();
  });
  const search = document.getElementById('itSearch');
  if(search) search.oninput = ()=>{ itemsView.search = search.value; repaint(); };
}

/* ============ Units ============ */
/* Each unit has an English name (required) and optional Kurdish and Arabic
   names; every screen shows the one for the current language. */
function unitFieldsHtml(prefix, u){
  return `<div class="field"><label for="${prefix}En">${esc(t('englishLabel'))}</label><input id="${prefix}En" maxlength="80" data-clear="1" value="${esc(u?.en||'')}" placeholder="${esc(t('unitNamePlaceholder'))}"></div>
    <div class="field"><label for="${prefix}Ku">${esc(t('kurdishLabel'))}</label><input id="${prefix}Ku" dir="rtl" maxlength="80" data-clear="1" value="${esc(u?.ku||'')}"></div>
    <div class="field"><label for="${prefix}Ar">${esc(t('arabicLabel'))}</label><input id="${prefix}Ar" dir="rtl" maxlength="80" data-clear="1" value="${esc(u?.ar||'')}"></div>`;
}
function readUnitFields(prefix){
  const v = id=>document.getElementById(prefix+id).value.trim();
  return {en:v('En'), ku:v('Ku'), ar:v('Ar')};
}
function renderUnits(){
  const chips = state.units.map(u=>{
    const others = [u.en, u.ku, u.ar].filter(x=>x && x !== unitName(u));
    return `<span class="unit-chip"><span class="unit-names"><strong>${esc(unitName(u))}</strong>${others.length ? `<small>${esc([...new Set(others)].join(' · '))}</small>` : ''}</span>
      <button data-editunit="${esc(u.id)}" aria-label="${esc(t('editUnit'))}">${ICON_EDIT}</button>
      <button class="danger" data-delunit="${esc(u.id)}" aria-label="${esc(t('delete'))}">${ICON_DELETE}</button>
    </span>`;
  }).join('');
  return `
    <div class="action-row">
      <button class="btn btn-primary add-btn" id="unitAddBtn">${ICON_PLUS} ${esc(t('addUnit'))}</button>
      <button class="btn btn-ghost" data-gorecord="unit">${NAV_ICONS.record} ${esc(t('record'))}</button>
    </div>
    <div class="section-title">${esc(t('units'))} (${state.units.length})</div>
    ${chips ? `<div class="unit-grid">${chips}</div>` : emptyState(t('noUnitsYet'))}`;
}
function openUnitModal(unit){
  showFormModal({
    title: unit ? t('editUnit') : t('addUnit'),
    banner: unit ? editingBanner(unitName(unit), [unit.en, unit.ku, unit.ar].filter(Boolean).join(' · ')) : '',
    bodyHtml: unitFieldsHtml('mfUnit', unit),
    okLabel: t('save'),
    againLabel: unit ? null : t('saveAndAddAnother'),
    onSubmit: async (again)=>{
      const {en, ku, ar} = readUnitFields('mfUnit');
      if(!en) return {error:t('nameRequired')};
      if(unit){
        const fields = diffFields([['name',unit.en,en],['nameKu',unit.ku||'',ku],['nameAr',unit.ar||'',ar]]);
        if(!fields.length) return {};
        if(!(await saveRecord('units',{id:unit.id,en,ku,ar}))) return {error:t('saveFailed')};
        Object.assign(unit,{en,ku,ar});
        logActivity({action:'edit',type:'unit',name:en,fields});
      }else{
        const next = {id:'u'+outboxJobId(), en, ku, ar};
        if(!(await saveRecord('units', next))) return {error:t('saveFailed')};
        state.units.push(next);
        logActivity({action:'add', type:'unit', name:en,
          fields:[{k:'name', to:en}].concat(ku ? [{k:'nameKu', to:ku}] : [], ar ? [{k:'nameAr', to:ar}] : [])});
      }
      render();
      if(again) return {keepOpen:true, message:t('savedMsg')(en)};
      toast(t('savedMsg')(en));
      return {};
    }
  });
}
function attachUnitEvents(){
  document.getElementById('unitAddBtn').onclick = ()=>openUnitModal(null);
  document.querySelectorAll('[data-editunit]').forEach(b=>b.onclick = ()=>{
    const unit = state.units.find(u=>u.id===b.dataset.editunit);
    if(unit) openUnitModal(unit);
  });
  document.querySelectorAll('[data-delunit]').forEach(b=>b.onclick = async()=>{
    const unit = state.units.find(u=>u.id===b.dataset.delunit);
    if(!unit) return;
    if(!(await showConfirm(`<b>${esc(unitName(unit))}</b><br>${esc(t('confirmDeleteUnit'))}`))) return;
    if(!(await deleteRecord('units', unit.id))){ await showAlert(esc(t('saveFailed'))); return; }
    state.units = state.units.filter(u=>u.id!==unit.id);
    state.items.forEach(i=>{ if(i.unit===unit.id) i.unit=null; });
    logActivity({action:'delete', type:'unit', name:unit.en,
      fields:[{k:'name', from:unit.en}].concat(unit.ku ? [{k:'nameKu', from:unit.ku}] : [], unit.ar ? [{k:'nameAr', from:unit.ar}] : [])});
    render();
  });
}

/* ============ Devices (Rozha) ============ */
/* Which phones are signed in right now, to which account, when each one
   last signed in, and when it was last seen using the app. */
/* Logged in = signed in, no log-out waiting for it, and seen within one
   session length (a sign-in expires after 18 hours even if nobody logs out). */
const SESSION_MS = 18*60*60*1000;
function isLoggedIn(d){
  const seen = Date.parse(d.lastSeen || d.lastLogin || 0) || 0;
  return !!d.loggedIn && Date.now() - seen < SESSION_MS && !(commandIsPending(d) && d.command.type === 'logout');
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
  return formatIraqDateTime(iso,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function renderDevices(){
  const visible = state.devices.filter(isLoggedIn);
  const head = `
    <div class="action-row">
      <div class="section-title grow">${esc(t('devicesTitle'))} (${visible.length})</div>
      <button class="btn btn-ghost" id="devRefreshBtn">${ICON_REFRESH} ${t('refresh')}</button>
    </div>`;

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
    const who = accountLabel(d.account);
    const parts = deviceParts(d);
    const badge = ({active:t('statusActive'), idle:t('statusLoggedIn'), out:t('statusLoggedOut')})[st];
    return `<div class="dev-card">
      <div class="dev-top">
        <div class="dev-name">${esc(who || t('unnamedDevice'))}${isThis ? ` <span class="dev-this">\u00b7 ${esc(t('thisDevice'))}</span>` : ''}</div>
      </div>
      <div class="dev-kind">${/PC|Mac|Chromebook/.test(parts.kind) ? ICON_COMPUTER : NAV_ICONS.devices} <span>${esc(parts.kind)}</span>${parts.how ? `<span class="dev-how">${esc(parts.how)}</span>` : ''}</div>
      <div class="dev-status"><span class="dev-badge dev-${st}">${badge}</span></div>
      <div class="rec-line"><span class="rec-k">${t('lastLoginLabel')}</span> ${fmtDateTime(d.lastLogin)}${d.lastLogin ? ` <span class="dev-ago">(${timeAgo(d.lastLogin)})</span>` : ''}</div>
      ${d.lastSeen ? `<div class="rec-line"><span class="rec-k">${t('lastSeenLabel')}</span> ${timeAgo(d.lastSeen)}</div>` : ''}
      ${commandIsPending(d) ? `<div class="dev-pending">${d.command.type==='logout'?t('cmdLogoutPending'):t('cmdRefreshPending')} \u00b7 ${timeAgo(d.command.ts)}</div>` : ''}
      ${isThis ? '' : `<div class="dev-actions">
        <button class="btn btn-ghost" data-devrefresh="${esc(d.id)}">${ICON_REFRESH} ${t('refreshDevice')}</button>
        ${isLoggedIn(d) ? `<button class="btn btn-danger" data-devlogout="${esc(d.id)}">${t('logoutDevice')}</button>` : ''}
      </div>`}
    </div>`;
  }).join('');

  return `${head}${hero}${bulk}${cards || emptyState(t('noDevicesYet'))}<div class="dev-hint">${t('devicesHint')}</div>`;
}
function attachDeviceEvents(){
  const r = document.getElementById('devRefreshBtn');
  if(r) r.onclick = ()=> refreshDevices();

  document.querySelectorAll('[data-devlogout]').forEach(b=>b.onclick=async()=>{
    const d = state.devices.find(x=>x.id===b.dataset.devlogout);
    if(!d) return;
    const name = esc(deviceTitle(d));
    if(!(await showConfirm(`<b>${name}</b><br>${t('confirmLogoutDevice')}`, {okLabel:t('logoutDevice')}))) return;
    await sendDeviceCommand('logout', [d.id]);
  });
  document.querySelectorAll('[data-devrefresh]').forEach(b=>b.onclick=async()=>{
    const d = state.devices.find(x=>x.id===b.dataset.devrefresh);
    if(!d) return;
    const name = esc(deviceTitle(d));
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

/* ============ Settings (Rozha) ============ */
/* PINs can't be changed here: only through the secret code on the sign-in
   keypad (see startRecovery). */
function renderSettings(){
  const connectionCard = `<div class="section-title">${esc(t('cloudSetup'))}</div><div class="form-card"><div class="cloud-state ${state.apiOnline?'':'offline'}"><span></span><div><b>${esc(state.apiOnline?t('cloudConnectedNote'):t('cloudOfflineNote'))}</b></div></div></div>`;
  return `${connectionCard}${renderRicoSettings()}<div class="app-version">Ricotta Orders · ${esc(APP_VERSION)}</div>`;
}
/* ============ Sounds & notifications (every account) ============ */
/* The daily reminder starts as one switch. Turning it on opens the time,
   a test button and Save; only Save turns it on for real (leaving without
   saving keeps it off). Turning it off saves "off" straight away. */
let reminderDraft = null;   // {time} while the reminder is being set up or changed
function reminderTimeLabel(time){
  const [h, m] = String(time || '09:00').split(':').map(Number);
  return new Intl.DateTimeFormat(intlLocale(), {hour:'numeric', minute:'2-digit'}).format(new Date(2000, 0, 1, h, m));
}
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
  const r = state.reminder || {enabled:false, time:'09:00'};
  const hint = reminderDraft ? t('supplierRemindersHint') : r.enabled ? t('reminderEveryDayAt')(reminderTimeLabel(r.time)) : t('supplierRemindersHint');
  const editor = !reminderDraft ? (r.enabled ? `<button class="btn btn-ghost reminder-change" id="reminderChangeBtn">${esc(t('reminderChangeTime'))}</button>` : '') : `
      <div class="field"><label for="reminderTime">${t('reminderTimeLabel')}</label><input id="reminderTime" type="time" value="${esc(reminderDraft.time)}"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="reminderSaveBtn">${t('reminderSave')}</button>
        <button class="btn btn-ghost" id="reminderTestBtn">${ICON_BELL} ${t('reminderSendNow')}</button>
        <button class="btn btn-ghost" id="reminderCancelBtn">${esc(t('cancel'))}</button>
      </div>`;
  return `<div class="section-title">${t('notifSettingsTitle')}</div>
    <div class="form-card">${device}<hr class="notif-divider">
      <label class="check-row sound-row"><input type="checkbox" id="reminderEnabled" ${r.enabled || reminderDraft ? 'checked' : ''}><span>${esc(t('reminderTitle'))}<small>${esc(hint)}</small></span></label>${editor}</div>`;
}
function attachNotifEvents(){
  const tog = document.getElementById('pushToggleBtn');
  if(tog) tog.onclick = async ()=>{
    if(pushStatus.subscribed){ await disablePush(); render(); return; }
    const res = await enablePush();
    render();
    await showPushEnableResult(res);
  };
  const r = ()=>state.reminder || {enabled:false, time:'09:00'};
  const box = document.getElementById('reminderEnabled');
  if(box) box.onchange = async ()=>{
    if(box.checked){ reminderDraft = {time:r().time}; render(); return; }
    reminderDraft = null;
    if(r().enabled){
      if(!(await saveReminder(false, r().time))){ box.checked = true; await showAlert(t('reminderSaveFailed')); return; }
      state.reminder = {...r(), enabled:false};
      toast(t('reminderTurnedOff'));
    }
    render();
  };
  const change = document.getElementById('reminderChangeBtn');
  if(change) change.onclick = ()=>{ reminderDraft = {time:r().time}; render(); };
  const time = document.getElementById('reminderTime');
  // iPhone's time wheel reports on "change", others on "input": keep both.
  if(time) time.oninput = time.onchange = ()=>{ reminderDraft.time = time.value; };
  const cancel = document.getElementById('reminderCancelBtn');
  if(cancel) cancel.onclick = ()=>{ reminderDraft = null; render(); };
  const save = document.getElementById('reminderSaveBtn');
  if(save) save.onclick = ()=> withBusy(save, async ()=>{
    const value = time.value;
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)){ await showAlert(t('reminderTimeInvalid')); return; }
    if(!(await saveReminder(true, value))){ await showAlert(t('reminderSaveFailed')); return; }
    state.reminder = {enabled:true, time:value};
    reminderDraft = null;
    render();
    toast(t('reminderSaved'));
  });
  const test = document.getElementById('reminderTestBtn');
  if(test) test.onclick = ()=> withBusy(test, async ()=> reportSendResult(await callSendPush('reminder-now')));
}

const SOUND_ROWS = [
  {id:'qty',   label:'soundQtyLabel',   hint:'soundQtyHint',   play:()=>playQtyTick(true)},
  {id:'sent',  label:'soundSentLabel',  hint:'soundSentHint',  play:()=>playOrdersSent()},
];
function renderSoundsView(){
  const row = (id, on, label, hint)=>`<label class="check-row sound-row"><input type="checkbox" id="${id}" ${on?'checked':''}><span>${esc(t(label))}<small>${esc(t(hint))}</small></span></label>`;
  return `${renderNotifSettings()}<div class="section-title">${esc(t('soundsSection'))}</div><div class="form-card"><div class="notif-sub">${esc(t('soundsHint'))}</div>
      ${SOUND_ROWS.map(r=>row('sound-'+r.id, soundOn(r.id), r.label, r.hint)).join('')}</div>`;
}
function attachSoundsEvents(){
  attachNotifEvents();
  SOUND_ROWS.forEach(r=>{
    const box = document.getElementById('sound-'+r.id);
    if(box) box.onchange = ()=>{ setSoundOn(r.id, box.checked); if(box.checked) r.play(); };
  });
}
/* ---- Settings: Rico connection is managed server-side, never from a device. ---- */
function renderRicoSettings(){
  return `<div class="section-title">${t('ricoSettingsTitle')}</div>
    <div class="form-card rico-status-card">
      <div class="rico-set-head">${ricoFace('calm','rico-md')}<div><b>${t('ricoName')}</b><div class="notif-sub" id="ricoProviderState">${t('ricoPoweredBy')}</div></div></div>
      <div class="rico-connection" id="ricoKeyState" aria-live="polite">${t('ricoChecking')}</div>
    </div>`;
}
async function loadRicoStatus(){
  const el = document.getElementById('ricoKeyState');
  if(!el) return;
  const r = await api('assistant/status');
  if(!document.getElementById('ricoKeyState')) return;
  const st = r.ok && r.data ? r.data : null;
  const connected = !!(st && st.configured);
  el.textContent = !st ? t('loadFailed') : connected ? t('ricoConnected') : t('ricoDisconnected');
  el.classList.toggle('connected', connected);
  const provider = document.getElementById('ricoProviderState');
  if(provider && st?.provider === 'groq') provider.textContent = t('ricoPoweredByGroq')(!!st.fallback);
  else if(provider) provider.textContent = t('ricoPoweredByGemini');
}

/* The provider setup is intentionally not a Settings control. Rozha can
   open the one-time route after signing in; the API accepts only a new Groq
   key and never exposes or deletes an existing provider key. */
function ricoSetupRequested(){ return location.hash === '#rico-provider-setup'; }
function closeRicoSetupRoute(){ history.replaceState(null, '', location.pathname + location.search); }
async function maybeOpenRicoProviderSetup(){
  if(!ricoSetupRequested()) return;
  if(!isRozha()){ closeRicoSetupRoute(); return; }
  const status = await api('assistant/setup-status');
  if(!status.ok || status.data?.groqConfigured){ closeRicoSetupRoute(); return; }
  const key = await showPrompt(t('ricoGroqSetupPrompt'), {placeholder:'gsk_…', secret:true, okLabel:t('ricoGroqSave')});
  if(key === null){ closeRicoSetupRoute(); return; }
  const saved = await api('assistant/groq-key', {method:'PUT', body:{key}});
  closeRicoSetupRoute();
  if(saved.ok){ toast(t('ricoGroqSaved')); if(state.view === 'settings') loadRicoStatus(); }
  else await showAlert(saved.data?.error === 'invalid_key' ? t('ricoGroqInvalid') : t('saveFailed'));
}
/* Disables a button while its action runs, so a double tap can't send twice. */
async function withBusy(btn, fn){
  if(!btn || btn.disabled) return;
  btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy','true');
  try{ return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); }
}
function attachSettingsEvents(){
  loadRicoStatus();
}

boot();
