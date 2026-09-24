/* Ricotta Orders -- app state, rendering and event handlers.
   Depends on: DEFAULT_UNITS, PIN consts (config.js), T (i18n.js), icon strings
   (icons.js), lget/lset/api/apiLogin/apiSession/sendOrQueue/flushOutbox
   (storage.js), showConfirm/showAlert/showPrompt/showFormModal/showForcedRefresh
   (modals.js), push helpers (push.js), hardReload (update-check.js).
   Load this file after all of those; it calls boot() at the end. */
/* ============ State ============ */
let state = {
  lang: 'en',
  role: null,           // 'admin' | 'user' | null
  view: 'order',
  pinBuffer: '',
  pinError: '',         // '' | 'wrong' | 'locked' | 'network' | 'session'
  pinBusy: false,       // PIN is being checked with the server
  pinPop: false,        // animate the dot that was just typed
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
  devices: [],           // [{id, nickname, role, lastLogin, lastSeen, loggedIn, command, handledCommand}]
  deviceId: null,        // this device's own id, generated once and kept locally
  reminder: null,        // daily reminder settings {enabled,time}
  apiOnline: navigator.onLine
};

function t(key){ return T[state.lang][key]; }
/* Consistent "nothing here yet" block, used for every empty list. */
function emptyState(msg){
  return `<div class="empty">${ICON_EMPTY}<div class="empty-text">${msg}</div></div>`;
}
/* Escapes text before it's inserted into innerHTML, so a name typed by staff
   can never break out of its tag and inject HTML. */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* Small, self-dismissing confirmation at the bottom of the screen -- used for
   successes, so they don't need an extra tap like a popup does. */
let toastTimer = null;
function toast(msg, kind='ok'){
  let el = document.getElementById('toast');
  if(!el){ el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.className = 'toast ' + kind;
  el.textContent = msg;
  requestAnimationFrame(()=> el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 2600);
}

/* ============ Devices ============
   The server keeps one row per device. This device reports "still here"
   every couple of minutes while the app is open (so admins can tell "active
   now" from "signed in but idle") and polls for remote commands from an admin
   (log out / refresh). */
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
function otherDevices(){ return state.devices.filter(d=>d.id !== state.deviceId); }
function commandIsPending(d){ return !!(d.command && d.command.id !== d.handledCommand); }

function heartbeat(){
  if(!state.role) return;
  api('devices/me', {method:'POST', body:{}});
  flushOutbox();
}
/* Keep the unfinished order on this device so closing or refreshing the app
   does not discard the quantities the user has selected. */
function persistCartDraft(){
  const draft=Object.fromEntries(Object.entries(state.cart).filter(([,qty])=>Number.isFinite(Number(qty)) && Number(qty)>0));
  lset('pendingCart',Object.keys(draft).length?draft:null);
}
function restoreCartDraft(){
  const saved=lget('pendingCart');
  if(!saved || typeof saved!=='object' || Array.isArray(saved)) return;
  const available=new Set(state.items.map(item=>item.id));
  state.cart=Object.fromEntries(Object.entries(saved).filter(([id,qty])=>available.has(id) && Number.isFinite(Number(qty)) && Number(qty)>0).map(([id,qty])=>[id,Math.floor(Number(qty))]));
  persistCartDraft();
}
/* Right after signing in: ask for a nickname the first time this device is
   used (or restore the one this phone remembers). */
async function afterLogin(){
  const me = myDevice();
  const saved = lget('deviceNickname');
  if(me && me.nickname){ lset('deviceNickname', me.nickname); return; }
  if(saved){ await setDeviceNickname(state.deviceId, saved); return; }
  const name = await showPrompt(t('deviceNamePromptMsg'), {
    placeholder: t('deviceNamePlaceholder'), okLabel: t('save'), cancelLabel: t('skip')
  });
  if(name) await setDeviceNickname(state.deviceId, name);
}
async function setDeviceNickname(id, name){
  if(id === state.deviceId) lset('deviceNickname', name || null);
  const r = await api(`devices/${encodeURIComponent(id)}/nickname`, {method:'PUT', body:{nickname:name}});
  if(r.ok){
    const d = state.devices.find(x=>x.id===id);
    if(d) d.nickname = name;
    if(state.view === 'devices') render();
  }
  return r.ok;
}

/* Admin side: tell other devices to log out or refresh. */
async function sendDeviceCommand(type, ids){
  const r = await api('devices/command', {method:'POST', body:{type, ids}});
  if(!r.ok){ await showAlert(t('saveFailed')); return; }
  await refreshDevices();
}
/* Device side: pick up a command aimed at this device. Admins also get the
   fresh device list for the Devices screen from the same request. */
let commandCheckBusy = false;
let forcedRefreshOpen = false;
async function checkCommands(){
  if(commandCheckBusy || !state.role) return;
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
  lset('handledCommand', cmd.id);
  if(cmd.type === 'logout'){
    await api('devices/me/ack', {method:'POST', body:{commandId:cmd.id}});
    signOut(t('forcedLogoutMsg'));
  } else if(cmd.type === 'refresh'){
    if(forcedRefreshOpen) return;
    forcedRefreshOpen = true;
    await showForcedRefresh(t('refreshRequiredTitle'), t('refreshRequiredMsg'), t('refreshNow'));
    await api('devices/me/ack', {method:'POST', body:{commandId:cmd.id}});
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
  if(isVisible() && state.role){ checkCommands(); heartbeat(); }
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
/* Loads everything this role needs from the server in one request. */
async function loadData(){
  const r = await api('bootstrap');
  if(!r.ok || !r.data) return false;
  const d = r.data;
  state.suppliers = d.suppliers || [];
  state.items = d.items || [];
  state.units = (d.units && d.units.length) ? d.units : DEFAULT_UNITS;
  state.history = d.history || [];
  state.devices = d.devices || [];
  state.activity = d.activity || [];
  state.reminder = d.reminder || {enabled:false, time:'09:00'};
  // The server is the authority on this session's role.
  if(d.role) state.role = d.role === 'staff' ? 'user' : d.role;
  return true;
}
/* Clears this device's sign-in and returns to the PIN pad. */
function signOut(reason){
  const me = myDevice();
  if(me && me.nickname) lset('deviceNickname', me.nickname);
  clearApiSession();
  state.role = null; state.pinBuffer = ''; state.view = 'order'; state.queue = null;
  state.pinError = reason ? 'session' : '';
  state.sessionMsg = reason || '';
  const root = document.getElementById('modalRoot');
  if(root) root.innerHTML = '';
  render();
}
async function doLogout(){
  const me = myDevice();
  if(me && me.nickname) lset('deviceNickname', me.nickname);
  api('logout', {method:'POST'});      // fire-and-forget; the token is dropped locally either way
  signOut();
}
/* Called by storage.js when the server rejects this device's session. */
function onSessionExpired(){
  if(state.role) signOut(t('sessionEnded'));
}

/* ============ Boot ============ */
let loadedOk = false;
/* Offline at start-up: show what we can, say so, and keep trying quietly. */
function retryLoad(){
  toast(t('loadFailed'), 'warn');
  const timer = setInterval(async ()=>{
    if(!state.role){ clearInterval(timer); return; }
    if(!isVisible() || !navigator.onLine) return;
    if(await loadData()){ clearInterval(timer); loadedOk = true; restoreCartDraft(); render(); }
  }, 10000);
}
async function boot(){
  state.deviceId = ensureDeviceId();
  state.lang = lget('lang') || 'en';
  const session = apiSession();
  if(session){
    state.role = session.role === 'staff' ? 'user' : session.role;
    loadedOk = await loadData();
    if(!loadedOk && !apiSession()) state.role = null;   // the session was rejected
    // Load the saved local draft only after the catalog is available, keeping
    // it intact if the app starts while offline and needs to retry loading.
    if(loadedOk) restoreCartDraft();
  }
  render();
  hideSplash();
  if(state.role){ heartbeat(); checkCommands(); }
  if(state.role && !loadedOk) retryLoad();
  // Notifications: register the service worker, read this device's status, and
  // handle being launched from a notification tap.
  initPush().then(()=>{ if(state.role) render(); handleLaunchIntent(); });
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
/* Re-shows the splash for a moment while a signed-in session loads. */
function showSplash(){
  if(document.getElementById('splash')) return;
  const tpl = document.getElementById('splashTpl');
  if(!tpl) return;
  document.body.appendChild(tpl.content.cloneNode(true));
  window.__splashStart = performance.now();
}

function applyLangClasses(){
  document.body.classList.toggle('lang-ku', state.lang === 'ku');
  document.documentElement.classList.toggle('rtl', state.lang === 'ku');
  document.documentElement.lang = state.lang === 'ku' ? 'ckb' : 'en';
  document.documentElement.dir = state.lang === 'ku' ? 'rtl' : 'ltr';
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
// Keep the navigation shell mounted for route changes. Animate a new view
// once; quantity, search and supplier interactions have smaller update paths.
let lastAnimKey = null;
function render(){
  applyLangClasses();
  const app = document.getElementById('app');
  if(!state.role){
    const animKey = 'login';
    app.classList.toggle('static-update', animKey === lastAnimKey);
    lastAnimKey = animKey;
    app.dataset.uiRole = ''; app.dataset.uiLanguage = state.lang;
    app.innerHTML = renderLogin(); attachLoginEvents(); return;
  }
  const animKey = state.view + (state.view === 'order' ? ':' + state.orderTab : '');
  const changedView = animKey !== lastAnimKey;
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

  const content = `${renderPageHeading()}${state.view === 'order' ? renderPushBanner() : ''}${body}`;
  const keepShell=app.dataset.uiRole===state.role && app.dataset.uiLanguage===state.lang && app.querySelector('.content');
  if(keepShell){
    app.querySelector('.content').innerHTML=content;
    const stack=app.querySelector('.bottom-stack');
    stack.querySelector('.bottom-bar')?.remove();
    if(state.view==='order') stack.insertAdjacentHTML('afterbegin',renderOrderBottomBar());
    stack.querySelectorAll('[data-view]').forEach(button=>{
      const active=button.dataset.view===state.view;
      button.classList.toggle('active',active);
      if(active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
  }else{
    app.innerHTML = `${renderTopbar()}<main class="content" id="mainContent">${content}</main>
      <div class="bottom-stack">${state.view==='order'?renderOrderBottomBar():''}${renderBottomNav()}</div>`;
  }
  app.dataset.uiRole=state.role; app.dataset.uiLanguage=state.lang; app.dataset.screen=state.view;
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
  if(activeNav && window.innerWidth<960){
    const nav=activeNav.parentElement, rect=activeNav.getBoundingClientRect(), bounds=nav.getBoundingClientRect();
    nav.scrollLeft+=rect.left+rect.width/2-bounds.left-bounds.width/2;
  }
  if(changedView) animateUi(app.querySelector('.content'),[{opacity:.45,transform:'translateY(8px)'},{opacity:1,transform:'none'}],260);
}

function renderPageHeading(){
  const keys={order:'order',history:'history',suppliers:'suppliers',itemsAdmin:'items',units:'units',record:'record',devices:'devicesTitle',settings:'settings',queue:'sendQueueTitle'};
  const date=new Intl.DateTimeFormat(state.lang==='ku'?'ckb-IQ':'en-GB',{weekday:'short',day:'numeric',month:'short'}).format(new Date());
  return `<header class="page-heading"><div><div class="page-kicker">${t('workspaceLabel')}</div><h1>${t(keys[state.view]||'order')}</h1></div><time class="page-date" datetime="${new Date().toISOString().slice(0,10)}">${esc(date)}</time></header>`;
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
  const other = state.lang === 'en' ? 'ku' : 'en';
  return `
  <div class="topbar">
    <div class="brand" aria-label="Ricotta Orders"><span class="brand-mark">ricotta</span><span class="dot"></span><span class="brand-sub">${t('order') === 'Order' ? 'Orders' : ''}</span></div>
    <div class="topbar-actions">
      <div class="connection-status ${state.apiOnline?'':'offline'}" id="connectionStatus"><span></span><em>${state.apiOnline?t('online'):t('offline')}</em></div>
      <button class="pill-btn lang-switch" data-lang="${other}" lang="${other}">${other==='ku'?'کوردی':'English'}</button>
      <button class="pill-btn icon-pill" id="logoutBtn" aria-label="${t('logout')}" title="${t('logout')}">${ICON_LOGOUT}</button>
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
  return `<nav class="bottomnav" aria-label="${t('workspaceLabel')}">
    ${tabs.map(tb=>`
      <button class="navbtn ${state.view===tb.id?'active':''}" data-view="${tb.id}" ${state.view===tb.id?'aria-current="page"':''}>
        ${NAV_ICONS[tb.id]}<span>${tb.label}</span>
      </button>`).join('')}
  </nav>`;
}
function attachCommonEvents(){
  document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=async()=>{
    setLang(b.dataset.lang);
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
    window.scrollTo({top:0});
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
function setLang(lang){
  state.lang = lang; lset('lang', lang); render();
  updatePushLang(lang);   // so future notifications switch language immediately too
}
function loginMessage(){
  if(state.pinBusy) return t('signingIn');
  return ({wrong:t('wrongPin'), locked:t('tooManyAttempts'), network:t('loadFailed'), session:state.sessionMsg})[state.pinError] || '';
}
function renderLogin(){
  const dots = Array.from({length:MAX_PIN_LEN}).map((_,i)=>{
    const filled = i < state.pinBuffer.length;
    const pop = state.pinPop && i === state.pinBuffer.length - 1;
    return `<span class="pin-dot ${filled?'filled':''} ${pop?'pop':''}"><span class="core"></span></span>`;
  }).join('');
  const keys = ['1','2','3','4','5','6','7','8','9'];
  const bad = ['wrong','locked','network'].includes(state.pinError);
  const msg = loginMessage();
  return `
  <div class="login-wrap">
    <div class="login-mobile-scene" aria-hidden="true">
      <span class="login-orbit orbit-one"></span><span class="login-orbit orbit-two"></span>
      <span class="login-spark spark-one"></span><span class="login-spark spark-two"></span><span class="login-spark spark-three"></span>
    </div>
    <div class="login-mobile-brand" dir="ltr" aria-hidden="true">
      <div class="login-mobile-word">ricotta<span></span></div><div class="login-mobile-orders">ORDERS</div>
    </div>
    <aside class="login-brand-panel"><div class="brand-word" dir="ltr">ricotta<span class="brand-word-dot"></span></div>
      <div class="login-brand-content"><div class="brand-kicker">${t('brandKicker')}</div><div class="brand-message">${t('brandMessage')}<br><em>${t('brandMessageAccent')}</em></div><div class="brand-detail">${t('brandDetail')}</div>
      <div class="brand-illustration" aria-hidden="true"><div class="brand-sheet"><div class="sheet-heading"><span>ricotta.</span><span>↗</span></div><div class="sheet-line long"></div><div class="sheet-line"></div><div class="sheet-rule"></div><div class="sheet-item"><i>✓</i><span></span><b>02</b></div><div class="sheet-item"><i>✓</i><span></span><b>04</b></div><div class="sheet-item"><i>✓</i><span></span><b>01</b></div><div class="sheet-total"><span></span><b>✓</b></div></div><div class="brand-stamp">✓</div></div></div>
      <div class="brand-footer">© ${new Date().getFullYear()} Ricotta <span>${t('brandFooter')}</span></div></aside>
    <div class="login-card">
    <div class="login-logo">ricotta<span class="dot-i"></span></div>
    <div class="login-heading">
      <div class="login-eyebrow">${t('welcomeBack')}</div>
      <div class="login-title">${t('signIn')}</div>
      <div class="login-sub">${t('signInSub')}</div>
    </div>
    <div class="pin-label">${t('enterPin')}</div>
    <div class="pin-dots ${bad?'err':''} ${state.pinBusy?'busy':''}" aria-label="${t('enterPin')}">${dots}</div>
    <div class="login-error ${state.pinError==='session'?'info':''}" role="alert" style="visibility:${msg?'visible':'hidden'};">${esc(msg) || '&nbsp;'}</div>
    <div class="keypad">
      ${keys.map(k=>`<button class="key" data-key="${k}">${k}</button>`).join('')}
      <button class="key clear" data-key="clear">${t('clear')}</button>
      <button class="key" data-key="0">0</button>
      <button class="key backspace" data-key="back" aria-label="Backspace">${ICON_BACKSPACE}</button>
    </div>
    <div class="login-lang">
      <div class="login-lang-menu" id="loginLangMenu" hidden>
        <button type="button" class="login-lang-option ${state.lang==='en'?'active':''}" data-login-lang="en"><span>English</span>${state.lang==='en'?'<i>✓</i>':''}</button>
        <button type="button" class="login-lang-option ku ${state.lang==='ku'?'active':''}" data-login-lang="ku"><span>کوردی</span>${state.lang==='ku'?'<i>✓</i>':''}</button>
      </div>
      <button type="button" class="lang-pill" id="loginLangToggle" aria-haspopup="menu" aria-expanded="false">${ICON_GLOBE}<span class="lang-short">${state.lang==='en'?'EN':'KU'}</span><span class="lang-long">${state.lang==='en'?'English':'کوردی'}</span>${ICON_CHEVRON}</button>
    </div>
    </div>
  </div>`;
}
function updateLoginFeedback(){
  const dots=document.querySelector('.pin-dots');
  if(!dots) return;
  dots.classList.toggle('err',['wrong','locked','network'].includes(state.pinError));
  dots.classList.toggle('busy',state.pinBusy);
  dots.querySelectorAll('.pin-dot').forEach((dot,index)=>{
    const wasFilled=dot.classList.contains('filled'), filled=index<state.pinBuffer.length;
    dot.classList.toggle('filled',filled);
    if(filled && !wasFilled) animateUi(dot,[{transform:'scale(.92)'},{transform:'scale(1.06)'},{transform:'scale(1)'}]);
  });
  const message=document.querySelector('.login-error');
  message.textContent=loginMessage()||'\u00a0';
  message.style.visibility=loginMessage()?'visible':'hidden';
  message.classList.toggle('info',state.pinError==='session');
  document.querySelectorAll('[data-key]').forEach(button=>button.disabled=state.pinBusy);
}
async function pressKey(k){
  if(state.pinBusy) return;
  if(state.pinError && state.pinError !== 'session') state.pinError = '';
  state.pinPop = false;
  if(k==='clear'){ state.pinBuffer=''; updateLoginFeedback(); return; }
  if(k==='back'){ state.pinBuffer = state.pinBuffer.slice(0,-1); updateLoginFeedback(); return; }
  if(state.pinBuffer.length>=MAX_PIN_LEN) return;
  state.pinBuffer += k; state.pinPop = true;
  if(state.pinBuffer.length < MAX_PIN_LEN){ updateLoginFeedback(); return; }

  state.pinBusy = true; state.pinError = ''; updateLoginFeedback();
  const res = await apiLogin(state.pinBuffer);
  state.pinBusy = false;
  if(res.error){
    state.pinError = res.error; updateLoginFeedback();
    setTimeout(()=>{ state.pinBuffer=''; if(!state.role) updateLoginFeedback(); }, 650);
    return;
  }
  // Signed in: bring up the workspace behind the splash, then reveal it.
  state.pinBuffer = ''; state.pinError = ''; state.view = 'order';
  showSplash();
  state.role = res.role;
  const ok = await loadData();
  if(!ok){ hideSplash(0); signOut(); state.pinError = 'network'; render(); return; }
  restoreCartDraft();
  render();
  hideSplash(150);
  heartbeat();
  if(pushStatus.subscribed) resyncPush();
  afterLogin();
}
function attachLoginEvents(){
  const toggle = document.getElementById('loginLangToggle');
  const menu = document.getElementById('loginLangMenu');
  if(toggle && menu){
    const closeMenu = ()=>{ menu.hidden=true; toggle.setAttribute('aria-expanded','false'); };
    toggle.onclick = e=>{
      e.stopPropagation();
      const opening = menu.hidden;
      menu.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if(opening) setTimeout(()=>document.addEventListener('click', closeMenu, {once:true}),0);
    };
    toggle.onkeydown = e=>{ if(e.key==='Escape'){ closeMenu(); toggle.focus(); } };
    menu.onclick = e=>e.stopPropagation();
    menu.querySelectorAll('[data-login-lang]').forEach(option=>option.onclick=()=>setLang(option.dataset.loginLang));
  }
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=> pressKey(b.dataset.key));
}
/* Physical keyboards (desktop / tablets with a keyboard) can type the PIN. */
document.addEventListener('keydown', e=>{
  if(state.role || e.ctrlKey || e.metaKey || e.altKey) return;
  if(document.querySelector('#modalRoot .modal-overlay')) return;
  if(/^[0-9]$/.test(e.key)) pressKey(e.key);
  else if(e.key === 'Backspace') pressKey('back');
  else if(e.key === 'Escape') pressKey('clear');
});

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
function lastOrderMap(){
  if(!state.history.length) return null;
  const last = state.history[state.history.length-1];
  const map = {};
  last.entries.forEach(e=>e.items.forEach(it=>{ map[it.itemId] = it.qty; }));
  return map;
}
function renderOrderHero(itemCount=state.items.length, supplierCount=new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size){
  const selCount = cartCount();
  return `<div class="hero-card order-hero">
    <div class="hero-copy"><div class="hero-eyebrow">${t('heroEyebrow')}</div>
    <div class="hero-stat" aria-live="polite">${t('heroStat')(selCount)}</div>
    <div class="hero-sub">${t('heroSub')(itemCount, supplierCount)}</div></div>
    <div class="hero-mark" aria-hidden="true">${NAV_ICONS.order}</div>
    <div class="hero-footer"><span class="draft-state">${selCount?t('draftLocal'):t('selectToStart')}</span><span class="hero-signature" aria-hidden="true">ricotta.</span></div>
  </div>`;
}
function renderOrderArrangeControl(){
  return state.role==='admin' && state.orderTab!=='all' && state.orderTab!=='__none'
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
    return emptyState(state.role==='admin'?t('noItemsYet'):t('noItemsUser'));
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
    ${tabsHtml}
    <div class="order-arrange-row" id="orderArrangeRow">${renderOrderArrangeControl()}</div>
    <div class="search-row">
      <div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itemSearch" aria-label="${t('searchPlaceholder')}" placeholder="${t('searchPlaceholder')}" value="${esc(state.search)}"></div>
      <div class="order-quick-actions">
        ${lastMap ? `<button class="quick-btn" id="sameAsLast">${t('sameAsLastTime')}</button>` : ''}
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
    const arrangeButton = state.role==='admin' && key!=='__none'
      ? `<button class="item-sort-trigger" data-sort-supplier="${esc(key)}">${t('sortSupplierItems')}</button>` : '';
    return state.orderTab==='all' ? `<div class="supplier-group">
      <div class="supplier-head"><span class="supplier-heading-name">${esc(label)}<span class="supplier-item-count">${groups[key].length}</span></span>${arrangeButton}</div>
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
    if(pulseItemId) animateUi(input,[{transform:'translateY(2px) scale(.88)',opacity:.6},{transform:'translateY(0) scale(1)',opacity:1}],180);
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
    const selCount = cartCount();
    const stat = hero.querySelector('.hero-stat');
    const sub = hero.querySelector('.hero-sub');
    if(stat) stat.textContent = t('heroStat')(selCount);
    if(sub) sub.textContent = t('heroSub')(selectedCount, selectedSupplierCount);
  }
  // Bottom bar send button
  const send = document.getElementById('sendOrdersBtn');
  if(send){
    send.disabled = c === 0;
    send.innerHTML = c>0 ? t('itemsSelected')(c)+' · '+t('sendOrders') : t('sendOrders');
  }
  const clear=document.getElementById('clearOrderBtn');
  if(clear) clear.disabled=c===0;
  const draft=document.querySelector('.draft-state');
  if(draft) draft.textContent=c?t('draftLocal'):t('selectToStart');
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
    if(state.orderTab===b.dataset.ordertab) return;
    state.orderTab = b.dataset.ordertab;
    lastAnimKey='order:'+state.orderTab;
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
  if(clear) clear.onclick=()=>{state.cart={};persistCartDraft();refreshOrderView();};
  const send = document.getElementById('sendOrdersBtn');
  if(send) send.onclick = ()=>{
    const bySupplier = {};
    Object.keys(state.cart).forEach(id=>{
      const qty = state.cart[id]; if(!qty) return;
      const item = state.items.find(i=>i.id===id); if(!item) return;
      const sid = item.supplierId || '__none';
      (bySupplier[sid] = bySupplier[sid]||[]).push({itemId:id, name:item.name, qty, unit:item.unit, sortOrder:item.sortOrder});
    });
    state.queue = Object.keys(bySupplier).map(sid=>({
      supplierId: sid, items: bySupplier[sid], sent:false
    }));
    state.view='queue'; render();
  };
}
function attachOrderResultEvents(root){
  if(!root) return;
  root.querySelectorAll('[data-sort-supplier]').forEach(button=>button.onclick=()=>openSupplierItemOrder(button.dataset.sortSupplier));
  root.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.inc; state.cart[id]=(state.cart[id]||0)+1; refreshOrderView(id);
  });
  root.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.dec; state.cart[id]=Math.max(0,(state.cart[id]||0)-1); refreshOrderView(id);
  });
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

/* ============ Send queue ============ */
function buildMessage(entry){
  const lines = sortedSupplierItems(entry.items).map(i=>`• ${i.name} — ${i.qty} ${unitLabel(i.unit)}`);
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
    const itemsLine = sortedSupplierItems(e.items).map(i=>`${esc(i.name)} — ${i.qty} ${esc(unitLabel(i.unit))}`).join(' · ');
    const noSendReason = !sup ? t('noSupplier') : t('noPhoneOnFile');
    return `<div class="queue-card ${e.sent?'sent':''}">
      <div class="queue-top"><span class="queue-name">${esc(name)}</span>${e.sent?`<span class="queue-badge">✓ ${t('sent')}</span>`:''}</div>
      <div class="queue-items">${itemsLine}</div>
      <div class="queue-actions"><button class="pdf-btn" data-pdf="${idx}">${t('orderSheet')}</button>${sup && sup.phone ? `<button class="wa-btn ${e.sent?'done':''}" data-send="${idx}">${e.sent?t('sent'):t('sendVia')}</button>` : `<div class="queue-items">${esc(noSendReason)}</div>`}</div>
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
  const rows=sortedSupplierItems(entry.items).map((item,n)=>`<tr><td>${n+1}</td><td>${esc(item.name)}</td><td>${esc(unitLabel(item.unit))}</td><td class="qty">${item.qty}</td></tr>`).join('');
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
  const saved = await sendOrQueue('orders', 'POST', record);
  if(!saved) toast(t('orderSavedOffline'), 'warn');
  state.cart = {};
  persistCartDraft();
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
    persistCartDraft();
    state.view = 'order';
    render();
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
   date, time and which device did it. */
const ACTIVITY_MAX = 500;
function logActivity(entry){
  const rec = {
    id: 'a'+Date.now()+Math.random().toString(36).slice(2,6),
    ts: new Date().toISOString(),
    by: (myDevice() || {}).nickname || lget('deviceNickname') || '',
    role: state.role,
    ...entry
  };
  state.activity = [rec, ...state.activity].slice(0, ACTIVITY_MAX);
  return sendOrQueue('activity', 'POST', {entry: rec});
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

/* ============ Admin: saving one record ============ */
async function saveRecord(table, rec){
  return (await api(`${table}/${encodeURIComponent(rec.id)}`, {method:'PUT', body:rec})).ok;
}
async function deleteRecord(table, id){
  return (await api(`${table}/${encodeURIComponent(id)}`, {method:'DELETE'})).ok;
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
        // updatedAt tells the server when the reminder was last changed, so a time that
        // has already passed today starts tomorrow instead of firing the moment you save.
        const reminder = oldCode === newCode ? s.reminder
          : rem.on ? {...newRem, updatedAt: now} : {...(s.reminder||{}), enabled:false, updatedAt: now};
        const next = {...s, name, phone, reminder};
        if(!(await saveRecord('suppliers', next))) return {error: t('saveFailed')};
        Object.assign(s, next);
        logActivity({action:'edit', type:'supplier', name, fields});
      } else {
        const next = {id:'s'+Date.now(), name, phone, reminder: rem.on ? {...newRem, updatedAt: now} : null};
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
    return `<section class="supplier-group admin-item-group"><div class="supplier-head"><span>${esc(label)}</span><span class="supplier-item-count">${groupItems.length}</span></div><div class="admin-item-grid">${rows}</div></section>`;
  }).join('') : emptyState(t('noItemsYet'));
  return `
    <div class="action-row">
      <button class="btn btn-primary add-btn" id="itemAddBtn">${ICON_PLUS} ${t('addItem')}</button>
      <button class="btn btn-ghost" data-gorecord="item">${NAV_ICONS.record} ${t('record')}</button>
    </div>
    <div class="section-title">${t('items')} (${state.items.length})</div>${list}`;
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
        const next = {...i, name, unit, supplierId, sortOrder:supplierId===i.supplierId?i.sortOrder:null};
        if(!(await saveRecord('items', next))) return {error: t('saveFailed')};
        Object.assign(i, next);
        logActivity({action:'edit', type:'item', name, fields});
      } else {
        const supplierItems=state.items.filter(i=>i.supplierId===supplierId);
        const maxSort=supplierItems.reduce((max,i)=>Number.isInteger(i.sortOrder)?Math.max(max,i.sortOrder):-1,-1);
        const next = {id:'i'+Date.now(), name, unit, supplierId, sortOrder:maxSort>=0?maxSort+1:null};
        if(!(await saveRecord('items', next))) return {error: t('saveFailed')};
        state.items.push(next);
        state.itemFormSupplierId = supplierId; // keep it locked in for the next item
        logActivity({action:'add', type:'item', name, fields:[
          {k:'name', to:name}, {k:'unit', to:unitEn(unit)}, {k:'supplier', to:newSupName}
        ]});
      }
      render();
      if(again) return {keepOpen:true, message:t('savedMsg')(name)};
      toast(t('savedMsg')(name));
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
    if(!(await deleteRecord('items', id))){ await showAlert(t('saveFailed')); return; }
    const supName = item.supplierId ? (state.suppliers.find(s=>s.id===item.supplierId)?.name || '') : '';
    state.items = state.items.filter(i=>i.id!==id);
    delete state.cart[id];
    persistCartDraft();
    logActivity({action:'delete', type:'item', name:item.name, fields:[
      {k:'name', from:item.name}, {k:'unit', from:unitEn(item.unit)}, {k:'supplier', from:supName}
    ]});
    render();
  });
}

/* ============ Admin: Units ============ */
function renderUnits(){
  const chips = state.units.map(u=>`
    <span class="unit-chip"><span class="unit-names"><strong>${esc(state.lang==='ku'?(u.ku||u.en):u.en)}</strong><small>${esc(state.lang==='ku'?u.en:(u.ku||u.en))}</small></span>
      <button data-editunit="${esc(u.id)}" aria-label="${t('editUnit')}">${ICON_EDIT}</button>
      <button data-delunit="${esc(u.id)}" aria-label="${t('delete')}">✕</button>
    </span>`).join('');
  return `
    <div class="section-title">${t('units')}</div>
    <div>${chips || emptyState(t('noUnitsYet'))}</div>
    <div class="section-title">${t('addUnit')}</div>
    <div class="form-card">
      <div class="field"><label>${t('englishLabel')}</label><input id="unitEn" placeholder="${t('unitNamePlaceholder')}"></div>
      <div class="field"><label>${t('kurdishLabel')}</label><input id="unitKu" placeholder="${t('unitNameKuPlaceholder')}"></div>
      <div class="form-actions"><button class="btn btn-primary" id="unitAddBtn">${t('add')}</button></div>
    </div>`;
}
function attachUnitEvents(){
  document.querySelectorAll('[data-editunit]').forEach(button=>button.onclick=()=>{
    const unit=state.units.find(u=>u.id===button.dataset.editunit);
    if(!unit) return;
    showFormModal({
      title:t('editUnit'),
      bodyHtml:`<div class="field"><label>${t('englishLabel')}</label><input id="mfUnitEn" value="${esc(unit.en)}" maxlength="80"></div><div class="field"><label>${t('kurdishLabel')}</label><input id="mfUnitKu" value="${esc(unit.ku||'')}" maxlength="80"></div>`,
      okLabel:t('save'),
      onSubmit:async()=>{
        const en=document.getElementById('mfUnitEn').value.trim();
        const ku=document.getElementById('mfUnitKu').value.trim();
        if(!en) return {error:t('nameRequired')};
        const fields=diffFields([['name',unit.en,en],['nameKu',unit.ku||'',ku]]);
        if(!fields.length) return {};
        if(!(await saveRecord('units',{id:unit.id,en,ku}))) return {error:t('saveFailed')};
        Object.assign(unit,{en,ku});
        logActivity({action:'edit',type:'unit',name:en,fields});
        render();
        toast(t('savedMsg')(en));
        return {};
      }
    });
  });
  document.getElementById('unitAddBtn').onclick = async ()=>{
    const en = document.getElementById('unitEn').value.trim();
    const ku = document.getElementById('unitKu').value.trim();
    if(!en){ document.getElementById('unitEn').focus(); return; }
    const next = {id:'u'+Date.now(), en, ku};
    if(!(await saveRecord('units', next))){ await showAlert(t('saveFailed')); return; }
    state.units.push(next);
    logActivity({action:'add', type:'unit', name:en,
      fields:[{k:'name', to:en}].concat(ku ? [{k:'nameKu', to:ku}] : [])});
    render();
    toast(t('savedMsg')(en));
  };
  document.querySelectorAll('[data-delunit]').forEach(b=>b.onclick=async()=>{
    const id = b.dataset.delunit;
    const unit = state.units.find(u=>u.id===id);
    if(!unit) return;
    if(!(await showConfirm(`<b>${esc(unit.en)}</b><br>${t('confirmDeleteUnit')}`))) return;
    if(!(await deleteRecord('units', id))){ await showAlert(t('saveFailed')); return; }
    state.units = state.units.filter(u=>u.id!==id);
    state.items.forEach(i=>{ if(i.unit===id) i.unit=null; });
    logActivity({action:'delete', type:'unit', name:unit.en,
      fields:[{k:'name', from:unit.en}].concat(unit.ku ? [{k:'nameKu', from:unit.ku}] : [])});
    render();
  });
}

/* ============ Admin: Devices ============ */
/* Its own admin tab: which devices are logged in right now, when each one
   last logged in, and when it was last seen using the app. */
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
    return `<div class="dev-card">
      <div class="dev-top">
        <div class="dev-name">${esc(d.nickname) || t('unnamedDevice')}${isThis ? ` <span class="dev-this">\u00b7 ${t('thisDevice')}</span>` : ''}</div>
        <div class="row-actions"><button class="icon-btn" data-editdevice="${esc(d.id)}">${ICON_EDIT}</button></div>
      </div>
      <div class="dev-status"><span class="dev-badge dev-${st}">${badge}</span><span class="dev-role">${roleLabel}</span></div>
      <div class="rec-line"><span class="rec-k">${t('lastLoginLabel')}</span> ${fmtDateTime(d.lastLogin)}${d.lastLogin ? ` <span class="dev-ago">(${timeAgo(d.lastLogin)})</span>` : ''}</div>
      ${d.lastSeen ? `<div class="rec-line"><span class="rec-k">${t('lastSeenLabel')}</span> ${timeAgo(d.lastSeen)}</div>` : ''}
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
      if(!(await setDeviceNickname(id, val))) return {error: t('saveFailed')};
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
/* PINs are stored only as bcrypt hashes on the server, so they are never
   shown -- the admin just types the new ones. */
function renderSettings(){
  const pinsCard = `
    <div class="section-title">${t('changePins')}</div>
    <div class="form-card">
      <div class="field-hint" style="margin-bottom:12px;">${t('pinsChangeHint')}</div>
      <div class="field"><label for="adminPinInput">${t('adminPin')}</label><input id="adminPinInput" type="password" maxlength="6" inputmode="numeric" autocomplete="new-password"></div>
      <div class="field"><label for="userPinInput">${t('userPin')}</label><input id="userPinInput" type="password" maxlength="6" inputmode="numeric" autocomplete="new-password"></div>
      <div class="form-actions"><button class="btn btn-primary" id="pinsSaveBtn">${t('savePins')}</button></div>
    </div>`;
  const connectionCard = `<div class="section-title">${t('cloudSetup')}</div><div class="form-card"><div class="cloud-state ${state.apiOnline?'':'offline'}"><span></span><div><b>${state.apiOnline?t('cloudConnectedNote'):t('cloudOfflineNote')}</b></div></div></div>`;
  return `${pinsCard}${connectionCard}${renderNotifSettings()}<div class="app-version">Ricotta Orders · ${esc(APP_VERSION)}</div>`;
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
  const r = state.reminder || {enabled:false, time:'09:00'};
  const reminder = `
      <div class="notif-sub">${t('supplierRemindersHint')}</div>
      <label class="check-row"><input type="checkbox" id="reminderEnabled" ${r.enabled?'checked':''}> ${t('reminderEnabledLabel')}</label>
      <div class="field"><label for="reminderTime">${t('reminderTimeLabel')}</label><input id="reminderTime" type="time" value="${esc(r.time)}"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="reminderSaveBtn">${t('reminderSave')}</button>
        <button class="btn btn-ghost" id="reminderTestBtn">${ICON_BELL} ${t('reminderSendNow')}</button>
      </div>`;
  return `<div class="section-title">${t('notifSettingsTitle')}</div>
    <div class="form-card">${device}<hr class="notif-divider"><div class="section-title" style="margin-top:0;">${t('reminderTitle')}</div>${reminder}</div>`;
}
/* Disables a button while its action runs, so a double tap can't send twice. */
async function withBusy(btn, fn){
  if(!btn || btn.disabled) return;
  btn.disabled = true; btn.classList.add('is-busy');
  try{ await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}
function attachSettingsEvents(){
  const tog = document.getElementById('pushToggleBtn');
  if(tog) tog.onclick = async ()=>{
    if(pushStatus.subscribed){ await disablePush(); render(); return; }
    const res = await enablePush();
    render();
    await showPushEnableResult(res);
  };
  const save = document.getElementById('reminderSaveBtn');
  if(save) save.onclick = ()=> withBusy(save, async ()=>{
    const enabled = document.getElementById('reminderEnabled').checked;
    const time = document.getElementById('reminderTime').value;
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){ await showAlert(t('reminderTimeInvalid')); return; }
    if(!(await saveReminder(enabled, time))){ await showAlert(t('reminderSaveFailed')); return; }
    state.reminder = { enabled, time };
    toast(t('reminderSaved'));
  });
  const test = document.getElementById('reminderTestBtn');
  if(test) test.onclick = ()=> withBusy(test, async ()=> reportSendResult(await callSendPush('reminder-now')));

  const pinsBtn = document.getElementById('pinsSaveBtn');
  pinsBtn.onclick = ()=> withBusy(pinsBtn, async ()=>{
    const ap = document.getElementById('adminPinInput').value.trim();
    const up = document.getElementById('userPinInput').value.trim();
    if(!/^\d{6}$/.test(ap) || !/^\d{6}$/.test(up)){ await showAlert(t('pinsInvalidLength')); return; }
    if(ap===up){ await showAlert(t('pinsPrefixConflict')); return; }
    const r = await api('admin/pins', {method:'POST', body:{adminPin:ap, staffPin:up}});
    if(!r.ok){ await showAlert(t('pinsSaveFailed')); return; }
    await showAlert(t('pinsSaved'));
    // The server signs every device out after a PIN change, this one included.
    signOut();
  });
}

boot();
