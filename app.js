/* Ricotta Orders -- app state, rendering and event handlers.
   Depends on: DEFAULT_UNITS, PIN consts (config.js), T (i18n.js), icon strings
   (icons.js), lget/lset/api/apiLogin/apiSession/sendOrQueue/flushOutbox
   (storage.js), showConfirm/showAlert/showPrompt/showFormModal/showForcedRefresh
   (modals.js), push helpers (push.js), Rico (assistant.js), the streak and report card (kitchen.js), hardReload
   (update-check.js). Load this file after all of those; it calls boot() at
   the end.

   Two accounts sign in with their own PIN:
     rozha  every screen and every action, Admin included
     yunis  Order, plus what Rozha gives him in Admin -> Access (screens and actions)
   The server decides which screens an account may open (bootstrap.views) and what it may do
   (bootstrap.roles), and enforces the same rules on every request. */
/* ============ State ============ */
const state = {
  lang: 'en',
  account: null,        // 'rozha' | 'yunis' | null (signed out)
  name: '',             // "Rozha" / "Yunis"
  tabs: ['order','history','manage'],   // the tab-bar screens (at most four; the rest go into More)
  views: [],            // every screen this account may open
  roles: [],            // what this account may do (Rozha: everything)
  adminPage: null,      // the Admin page that is open ('problems', 'security', ...), or its list
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
  recordLimit: 30,      // render older entries only when requested
  devices: [],           // [{id, account, label, lastLogin, lastSeen, loggedIn, command, handledCommand}]
  deviceId: null,        // this device's own id, generated once and kept locally
  reminder: null,        // daily reminder settings {enabled,time}
  apiOnline: navigator.onLine,
  streak: null,          // the kitchen streak {count, best, lit, alive, recoverable}
  pins: []               // this account's pinned item ids (top of the Order screen)
};

const LANGS = ['en','ku','ar'];
const LANG_NAMES = {en:'English', ku:'کوردی', ar:'العربية'};
/* A translation for the current language (English if a key is missing). */
function t(key){ const v = T[state.lang] && T[state.lang][key]; return v !== undefined ? v : T.en[key]; }
const isRtl = ()=> state.lang !== 'en';
const isRozha = ()=> state.account === 'rozha';
/* What this account may do (the server checks the same roles on every request). Changing the catalog
   also needs Manage. */
const canDo = role=> isRozha() || (state.roles.includes(role) && (role !== 'catalog' || state.roles.includes('manage')));
const canOpen = view=> view === 'queue' ? canDo('send') : state.views.includes(view);
/* Dates and times always use the digits 1 2 3, in every language. */
function intlLocale(){ return ({en:'en-US', ku:'ckb-IQ', ar:'ar-IQ'})[state.lang] + '-u-nu-latn'; }
const IRAQ_TIME_ZONE = 'Asia/Baghdad';
// Intl formatters hold native resources. Reuse them across long lists, with a
// small bound so different language/format combinations cannot accumulate.
const dateFormatters = new Map();
/* The months in Kurdish (Sorani), January first; also what search understands in "24 تشرینی یەکەم". */
const KU_MONTHS = ['کانوونی دووەم','شوبات','ئازار','نیسان','ئایار','حوزەیران','تەمووز','ئاب','ئەیلوول','تشرینی یەکەم','تشرینی دووەم','کانوونی یەکەم'];
/* Browsers without Kurdish dates (Chrome, Android) would write them in English. They get the
   Kurdish words iPhones use instead, in Kurdish order ("چوارشەممە 21ی تشرینی یەکەم"). */
const KU_DATES_NATIVE = (()=>{ try{ return Intl.DateTimeFormat.supportedLocalesOf('ckb').length > 0; }catch(_){ return false; } })();
let kuDateWords = null;
function kurdishDates(options){
  // Kurdish times are 12-hour, like the app's other languages.
  const base = new Intl.DateTimeFormat('en-GB-u-nu-latn', options.hour && options.hour12 === undefined ? {...options, hour12:true} : options);
  if(!kuDateWords){
    const en = o=>new Intl.DateTimeFormat('en-GB', {...o, timeZone:'UTC'});
    kuDateWords = {am:'ب.ن', pm:'د.ن'};
    KU_MONTHS.forEach((m, i)=>{
      const d = new Date(Date.UTC(2026, i, 15));
      kuDateWords[en({month:'long'}).format(d)] = kuDateWords[en({month:'short'}).format(d)] = m;
    });
    T.ku.weekdays.forEach((w, i)=>{
      const d = new Date(Date.UTC(2026, 0, 4 + i));
      kuDateWords[en({weekday:'long'}).format(d)] = kuDateWords[en({weekday:'short'}).format(d)] = w;
    });
  }
  return {format(date){
    const parts = base.formatToParts(date);
    return parts.map((p, i)=>{
      if(p.type === 'weekday' || p.type === 'month' || p.type === 'dayPeriod') return kuDateWords[p.value] || kuDateWords[p.value.toLowerCase()] || p.value;
      const next = parts.slice(i + 1).find(x=>x.type !== 'literal');
      if(p.type === 'day' && next?.type === 'month' && kuDateWords[next.value]) return p.value + 'ی';
      return p.type === 'literal' ? p.value.replace(',', '،') : p.value;
    }).join('');
  }};
}
function dateFormatter(options){
  const locale = intlLocale(), key = JSON.stringify([locale, options]);
  if(!dateFormatters.has(key)){
    const formatter = locale.startsWith('ckb') && !KU_DATES_NATIVE ? kurdishDates(options) : new Intl.DateTimeFormat(locale, options);
    if(dateFormatters.size >= 12) dateFormatters.delete(dateFormatters.keys().next().value);
    dateFormatters.set(key, formatter);
  }
  return dateFormatters.get(key);
}
function formatIraqDateTime(value, options={}){
  const date = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  return dateFormatter({
    timeZone: IRAQ_TIME_ZONE, hour12:true, ...options
  }).format(date);
}
/* Reminder values are stored as an Iraq wall-clock HH:MM value for the
   scheduler. Format that value with AM/PM without shifting its hour. */
function formatStoredIraqTime(value){
  const match=String(value||'').match(/^(\d{1,2}):(\d{2})$/);
  if(!match) return value || '';
  const date=new Date(Date.UTC(2000,0,1,Number(match[1]),Number(match[2])));
  return dateFormatter({
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
function toast(msg, kind='ok', {undo, ms} = {}){
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
  clearTimeout(toastTimer);
  // The timer starts once the toast is actually on screen: one raised while the app was in the
  // background used to show up later with its time already spent, and then never left.
  requestAnimationFrame(()=>{
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> el.classList.remove('show'), ms || (undo ? 4800 : 2600));
  });
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden'){ clearTimeout(toastTimer); document.getElementById('toast')?.classList.remove('show'); }
});

/* ============ Devices ============
   The server keeps one row per device. This device reports "still here"
   every couple of minutes while the app is open (so Rozha can tell "active
   now" from "signed in but idle") and polls for remote commands from
   Rozha's Admin screen (log out / refresh). */
const HEARTBEAT_MS = 60*1000;         /* how often an open app reports "still here" */
const ACTIVE_WINDOW_MS = 150*1000;    /* seen within this long ago = "active now" (a missed "still here" is allowed for) */
const FALLBACK_POLL_MS = 15*1000;     /* checks when the live connection is down (see Live changes) */
const SAFETY_POLL_MS = 2*60*1000;     /* and now and then even when it is up */

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
  // "Still here", with the time spent in the app since the last one (put back if it doesn't arrive).
  const seconds = takeUsage();
  api('devices/me', {method:'POST', body:seconds ? {seconds} : {}}).then(r=>{ if(!r.ok) returnUsage(seconds); });
  flushOutbox();
  flushProblems();
  syncSharedDraft();
}
/* Shared drafts keep local edits durable while merging other devices' changes.
   The base quantities are persisted too: reconnecting never blindly replaces
   a newer server draft with an old offline copy. */
let sharedDraft = {account:null, enabled:false, base:{}, revision:0, remote:null, conflicts:[], busy:false, timer:null, epoch:0};
function cleanDraftCart(cart){
  return Object.fromEntries(Object.entries(cart || {}).filter(([,q])=>validOrderQuantity(q) && q>0));
}
function draftChanges(base, cart){
  return [...new Set([...Object.keys(base),...Object.keys(cart)])].filter(id=>(base[id]||0)!==(cart[id]||0))
    .map(itemId=>({itemId,before:base[itemId]||0,after:cart[itemId]||0}));
}
function mergeDraftCarts(base, local, remote){
  const cart={...remote}, conflicts=[];
  for(const c of draftChanges(base,local)){
    if((remote[c.itemId]||0)!==c.before && (remote[c.itemId]||0)!==c.after) conflicts.push(c.itemId);
    if(c.after) cart[c.itemId]=c.after; else delete cart[c.itemId];
  }
  return {cart,conflicts};
}
function resetSharedDraft(){
  clearTimeout(sharedDraft.timer);
  sharedDraft={account:null,enabled:false,base:{},revision:0,remote:null,conflicts:[],busy:false,timer:null,epoch:sharedDraft.epoch+1};
}
function saveDraftMeta(){
  if(!sharedDraft.enabled || sharedDraft.account!==state.account) return;
  lset('draftMeta:'+state.account,{base:sharedDraft.base,revision:sharedDraft.revision});
}
function draftStatusHtml(){
  if(!sharedDraft.enabled) return '';
  if(sharedDraft.conflicts.length){
    const names=sharedDraft.conflicts.map(id=>state.items.find(i=>i.id===id)?.name||id).join(', ');
    return `<div class="form-card"><p role="alert">${esc(t('draftConflict'))} <b dir="auto">${esc(names)}</b></p><div class="form-actions"><button type="button" class="btn btn-ghost" data-draft-choice="remote">${esc(t('draftUseOther'))}</button><button type="button" class="btn btn-primary" data-draft-choice="local">${esc(t('draftKeepMine'))}</button></div></div>`;
  }
  return '';
}
function draftProgressLabel(){
  if(!sharedDraft.enabled) return t('draftLocal');
  return draftChanges(sharedDraft.base,state.cart).length ? t('draftWaiting') : t('draftSynced');
}
function paintDraftStatus(){
  const el=document.getElementById('sharedDraftStatus');
  if(!el) return;
  el.innerHTML=draftStatusHtml();
  const caption=document.querySelector('.draft-state');
  if(caption) caption.textContent=cartCount()?draftProgressLabel():t('selectToStart');
  el.querySelectorAll('[data-draft-choice]').forEach(b=>b.onclick=()=>resolveDraftConflict(b.dataset.draftChoice));
}
function receiveSharedDraft(data, base=sharedDraft.base){
  if(!data || !data.cart || Number(data.revision)<sharedDraft.revision) return;
  const available=new Set(state.items.map(i=>i.id));
  const remote=Object.fromEntries(Object.entries(cleanDraftCart(data.cart)).filter(([id])=>available.has(id)));
  const merged=mergeDraftCarts(base,state.cart,remote);
  for(const item of state.items.filter(i=>i.available===false)){delete merged.cart[item.id];merged.conflicts=merged.conflicts.filter(id=>id!==item.id);}
  sharedDraft.remote=remote; sharedDraft.revision=Number(data.revision)||0; sharedDraft.conflicts=merged.conflicts;
  if(!merged.conflicts.length) sharedDraft.base=remote;
  const changed=JSON.stringify(state.cart)!==JSON.stringify(merged.cart);
  state.cart=merged.cart;
  lset('pendingCart:'+state.account,Object.keys(state.cart).length?state.cart:null);
  saveDraftMeta(); paintDraftStatus();
  if(changed && state.view==='order') refreshOrderView();
}
function startSharedDraft(data){
  if(!data?.cart) return; // Older servers and offline starts keep local drafts.
  if(sharedDraft.account!==state.account){
    resetSharedDraft(); sharedDraft.account=state.account; sharedDraft.enabled=true;
    const meta=lget('draftMeta:'+state.account);
    sharedDraft.base=cleanDraftCart(meta?.base); sharedDraft.revision=0;
  }
  receiveSharedDraft(data);
  scheduleDraftSync();
}
function scheduleDraftSync(){
  if(!sharedDraft.enabled || sharedDraft.account!==state.account) return;
  saveDraftMeta(); paintDraftStatus();
  clearTimeout(sharedDraft.timer);
  sharedDraft.timer=setTimeout(()=>syncSharedDraft(),650);
}
async function syncSharedDraft(){
  if(!sharedDraft.enabled || sharedDraft.busy || !state.account || sharedDraft.account!==state.account) return;
  const epoch=sharedDraft.epoch, account=state.account;
  sharedDraft.busy=true;
  try{
    const changes=draftChanges(sharedDraft.base,state.cart);
    const sent={...state.cart};
    const writing=changes.length>0 && !sharedDraft.conflicts.length;
    const r=await api('draft',writing?{method:'PUT',body:{changes}}:{});
    if(epoch!==sharedDraft.epoch || state.account!==account || r.stale) return;
    if(r.ok || r.status===409) receiveSharedDraft(r.data,writing && r.ok ? sent : sharedDraft.base);
  }finally{
    if(epoch===sharedDraft.epoch){ sharedDraft.busy=false; paintDraftStatus(); }
  }
}
async function resolveDraftConflict(choice){
  if(sharedDraft.busy) return;
  const epoch=sharedDraft.epoch;
  await syncSharedDraft();
  if(epoch!==sharedDraft.epoch) return;
  if(!sharedDraft.remote || !sharedDraft.conflicts.length) return;
  if(choice==='remote') for(const id of sharedDraft.conflicts){
    if(sharedDraft.remote[id]) state.cart[id]=sharedDraft.remote[id]; else delete state.cart[id];
  }
  sharedDraft.base={...sharedDraft.remote}; sharedDraft.conflicts=[];
  persistCartDraft(); if(state.view==='order') refreshOrderView();
  await syncSharedDraft();
}
// Live changes bring the other phone's draft at once; without them, every 8 seconds.
setInterval(()=>{if(document.visibilityState==='visible' && !liveHealthy()) syncSharedDraft();},8000);
/* Keep the unfinished order on this device so closing or refreshing the app
   does not discard the quantities the user has selected. */
function persistCartDraft(){
  if(!state.account) return;
  const draft=Object.fromEntries(Object.entries(state.cart).filter(([,qty])=>Number.isFinite(Number(qty)) && Number(qty)>0));
  lset('pendingCart:'+state.account,Object.keys(draft).length?draft:null);
  scheduleDraftSync();
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
  if(saved && typeof saved==='object' && !Array.isArray(saved)){
    const available=new Set(state.items.filter(item=>item.available!==false).map(item=>item.id));
    state.cart=Object.fromEntries(Object.entries(saved).filter(([id,qty])=>available.has(id) && Number.isFinite(Number(qty)) && Number(qty)>0).map(([id,qty])=>[id,Math.min(MAX_QTY, roundQuantity(Number(qty)))]));
  }
  startSharedDraft(state.sharedDraft);
  persistCartDraft();
}

/* Rozha's Admin screen: tell other devices to log out or refresh. */
async function sendDeviceCommand(type, ids){
  const r = await api('devices/command', {method:'POST', body:{type, ids}});
  if(!r.ok){ await showAlert(t('saveFailed')); return; }
  await refreshDevices();
}
/* Device side: pick up a command aimed at this device. Rozha also gets the
   fresh device list for the Admin screen from the same request. */
let commandCheckBusy = false;
let forcedRefreshOpen = false;
async function checkCommands(){
  if(commandCheckBusy || !state.account) return;
  commandCheckBusy = true; lastCommandCheck = Date.now();
  try{
    const r = await api('devices');
    if(r.ok && Array.isArray(r.data)){
      const changed = JSON.stringify(r.data) !== JSON.stringify(state.devices);
      state.devices = r.data;
      if(changed) paintAdmin();
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
    paintAdmin();
  }
}
const isVisible = ()=> document.visibilityState === 'visible';
/* Endless decorations (style.css: html.still) pause while the app is out of sight, and while the battery
   is low and not charging where the browser says so (Chrome, Android; iPhones keep Low Power Mode to
   themselves). Reduce Motion turns them off completely. */
let lowBattery = false;
function syncMotion(){ document.documentElement.classList.toggle('still', !isVisible() || lowBattery); }
document.addEventListener('visibilitychange', syncMotion);
try{
  if(navigator.getBattery) navigator.getBattery().then(b=>{
    const check = ()=>{ lowBattery = !b.charging && b.level <= .2; syncMotion(); };
    b.addEventListener('levelchange', check); b.addEventListener('chargingchange', check); check();
  }, ()=>{});
}catch(_){ /* no battery information: decorations follow visibility only */ }
syncMotion();
let lastCommandCheck = 0;
setInterval(()=>{ if(isVisible() && (!liveHealthy() || Date.now() - lastCommandCheck > SAFETY_POLL_MS)) checkCommands(); }, FALLBACK_POLL_MS);
setInterval(()=>{ if(isVisible()) heartbeat(); }, HEARTBEAT_MS);
document.addEventListener('visibilitychange', ()=>{
  // Back from WhatsApp: an order whose suppliers are all sent is saved now if it wasn't yet.
  if(isVisible() && state.account){ checkCommands(); heartbeat(); maybeFinishQueue(); liveStart(); }
  else liveStop();
});

/* ============ Live changes ============
   While the app is on screen it keeps one question open with the server: "anything new?" (GET
   signals). The server answers within about a second of a change (an order or item saved anywhere, a
   sign-in or sign-out, a Refresh or Sign Out for this phone, the security log, a message from Rico), or
   after 25 seconds with nothing new, and the app asks again; then only what changed is loaded. When
   the server cannot be reached the older checks run every 15 seconds instead (FALLBACK_POLL_MS). */
const live = {id:0, account:null, stop:null, n:null, kinds:{}, healthyAt:0, fails:0};
const liveHealthy = ()=> Date.now() - live.healthyAt < 40000;
const pause = ms=>new Promise(r=>setTimeout(r, ms));
function liveStart(){
  if(!state.account || !isVisible() || (live.stop && live.account === state.account)) return;
  liveStop();
  if(live.account !== state.account){ live.account = state.account; live.n = null; live.kinds = {}; live.healthyAt = 0; }
  const id = ++live.id, stop = new AbortController();
  live.stop = stop;
  liveLoop(id, stop.signal).finally(()=>{ if(live.id === id) live.stop = null; });
}
function liveStop(){ live.stop?.abort(); live.stop = null; live.healthyAt = 0; }
async function liveLoop(id, signal){
  const account = state.account;
  while(live.id === id && !signal.aborted && state.account === account && isVisible()){
    const started = Date.now();
    const r = await api(`signals?since=${live.n ?? -1}&wait=${live.n === null ? 0 : 25}`, {timeout:35000, signal, quiet:true});
    if(live.id !== id || signal.aborted || state.account !== account) return;
    const n = Number(r.data?.n), kinds = r.data?.kinds;
    if(!r.ok || !Number.isSafeInteger(n) || !kinds || typeof kinds !== 'object' || Array.isArray(kinds)){
      live.fails++; live.healthyAt = 0;
      await pause(Math.min(30000, 1000 * 2 ** Math.min(live.fails, 5)));
      continue;
    }
    live.fails = 0; live.healthyAt = Date.now();
    if(live.n !== null && n !== live.n) liveChanged(kinds, n < live.n);
    live.n = n; live.kinds = kinds;
    // An answer that came back at once with nothing new (something in between that does not wait):
    // never ask again in a tight loop.
    if(Date.now() - started < 1000) await pause(1000);
  }
}
/* A counter that went backwards (the server was reset) counts as every kind changing. */
function liveChanged(kinds, reset){
  const moved = k=> reset || Number(kinds[k] || 0) !== Number(live.kinds[k] || 0);
  if(moved('data')) refreshData('live');
  if(moved('draft')) syncSharedDraft();
  if(moved('devices')) checkCommands();
  if(moved('admin') && state.view === 'admin' && isRozha()) ['security','problems'].forEach(k=>adminFetch(k, true));
  if(moved('inbox')) ricoRefreshInbox();
}
window.addEventListener('online', ()=>liveStart());

/* ============ Connection status ============ */
function setApiHealth(online){
  const next = !!online && navigator.onLine;
  if(next === state.apiOnline) return;
  state.apiOnline = next;
  const el = document.getElementById('connectionStatus');
  if(el) el.hidden = next;
  updateTopbar();   // Offline takes room in the top bar: the screen's name makes way
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
const ALL_ROLES = ['history','manage','catalog','record','transfers','assistant','send','exports','notify','reminders'];
const ACCOUNT_VIEWS = {
  rozha: ['order','assistant','history','transfers','manage','suppliers','itemsAdmin','units','record','admin','settings'],
  yunis: ['order','assistant','history','manage','suppliers','itemsAdmin','units','record','settings']
};
const ACCOUNT_ROLES = {rozha:ALL_ROLES, yunis:ALL_ROLES.filter(r=>r !== 'transfers')};
/* The screens of the tab bar, in order, for whoever is signed in. With four or fewer they are all
   tabs; with more, the first four are and the rest are under More. Rico lives in the top bar and
   Settings in the account sheet. */
const NAV_SCREENS = ['order','history','transfers','manage','record','admin'];
const navScreens = ()=> NAV_SCREENS.filter(v=>state.views.includes(v));
const tabsFor = ()=> navScreens().length ? navScreens().slice(0, 4) : ['order'];
/* Who is signed in (from the sign-in answer, the saved session or bootstrap). */
function applyAccount(a){
  state.account = a.account === 'rozha' || a.account === 'yunis' ? a.account : null;
  state.name = a.name || ({rozha:'Rozha', yunis:'Yunis'})[state.account] || '';
  const views = Array.isArray(a.views) && a.views.length ? a.views : (ACCOUNT_VIEWS[state.account] || []);
  state.views = state.account ? [...new Set([...views, 'settings'])] : [];
  const roles = Array.isArray(a.roles) ? a.roles : (ACCOUNT_ROLES[state.account] || []);
  state.roles = state.account ? roles.filter(r=>ALL_ROLES.includes(r)) : [];
  state.tabs = tabsFor();
  if(!canOpen(state.view)) state.view = state.tabs[0] || 'order';
}
/* Loads everything this account needs from the server in one request. */
async function loadData(){
  const r = await api('bootstrap');
  if(!r.ok || !r.data || !r.data.account) return false;
  lastLoadAt = Date.now();
  applyData(r.data);
  state.offlineSince = null;
  // Kept on this phone so the app still opens with everything when there is no connection (Offline
  // access); signing out removes it.
  if(state.account === r.data.account) lset('bootCache:' + state.account, {at:Date.now(), data:{...r.data, draft:null}});
  return true;
}
/* The last data this phone loaded, when the server can't be reached at start (at most a week old). */
function loadBootCache(){
  const c = lget('bootCache:' + state.account);
  if(!c?.data || c.data.account !== state.account || !(Date.now() - Number(c.at) < 7 * 86400000)) return false;
  applyData(c.data);
  state.sharedDraft = null;   // the shared draft waits for the server; this phone's own draft is kept
  state.offlineSince = Number(c.at);
  return true;
}
function applyData(d){
  applyAccount(d);
  saveSessionAccount();
  state.suppliers = d.suppliers || [];
  state.items = d.items || [];
  state.units = (d.units && d.units.length) ? d.units : DEFAULT_UNITS;
  state.history = d.history || [];
  state.devices = d.devices || [];
  state.activity = d.activity || [];
  state.reminder = d.reminder || {enabled:false, time:'09:00'};
  if(d.streak) streakArrived(d.streak);
  state.pins = Array.isArray(d.pins) ? d.pins : [];
  state.months = Array.isArray(d.months) ? d.months : [];
  state.sharedDraft = d.draft || null;
  ricoSetInbox(d.inbox || []);
  paintStreakChip(false);
}
/* Keeps the saved session's name current, so an offline start shows the
   right person. */
function saveSessionAccount(){
  const s = apiSession();
  if(s) lset('apiSession', {...s, account:state.account, name:state.name, views:state.views, roles:state.roles});
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
  card.innerHTML=`<img class="install-prompt-icon" src="install-icon.webp" width="48" height="48" loading="lazy" decoding="async" alt=""><div class="install-prompt-copy"><div class="install-prompt-title">${esc(t('installTitle'))}</div><div class="install-prompt-sub">${esc(t('installSub'))}</div><div class="install-prompt-actions"><button type="button" class="btn btn-ghost" id="installLaterBtn">${esc(t('installLater'))}</button><button type="button" class="btn btn-primary" id="installAppBtn">${esc(t('installAction'))}</button></div></div>`;
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
/* Clears this device's sign-in and returns to the PIN pad. */
function signOut(reason, {preserveSession = false} = {}){
  liveStop();
  if(state.account) lset('bootCache:' + state.account, null);   // the kitchen's data does not stay on a signed-out phone
  resetSharedDraft(); state.sharedDraft=null;
  ricoReset();
  if(!preserveSession) clearApiSession();
  forcedRefreshOpen = false;
  state.account = null; state.name = ''; state.views = []; state.roles = []; state.adminPage = null; state.tabs = tabsFor();
  state.suppliers = []; state.items = []; state.units = []; state.history = [];
  state.activity = []; state.devices = []; state.reminder = null;
  state.streak = null; state.pins = []; state.months = [];
  try{ updateAppBadge(); }catch(_){}
  viewMemory.clear(); tabMemory.clear(); resetAdmin();
  state.catalogQuery='';state.cart = {}; state.search = ''; state.orderTab = 'all'; state.itemFormSupplierId = null;
  ricoSuggestion.data = null; ricoSuggestion.at = 0;
  reminderDraft = null;
  stopStepHold(); rowPress?.cancel();
  state.pinBuffer = ''; state.view = 'order'; state.queue = null;
  finishingQueue = null;
  state.pinError = reason ? 'session' : '';
  state.sessionMsg = reason || '';
  dismissAllModals();
  closeSelSheet(); closeContextMenu();
  if(typeof spotClose === 'function') spotClose(true);   // search shows the old account's items and orders: it goes at once
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
/* Sign Out signs out straight away (no question first): the PIN brings everything back. */
async function doLogout(){
  const reply=await api('logout',{method:'POST'});
  if(reply.ok || reply.status===401) signOut();
  else toast(t('saveFailed'), 'error');
}
/* Refresh buttons: the arrows turn while the refresh runs (at least one full turn, so it reads as
   a refresh even when the answer is instant). The screen may be drawn again meanwhile, so the
   button is found again by its id. */
async function spinRefresh(btn, run){
  if(btn.classList.contains('refreshing')) return;
  const id = btn.id, started = performance.now();
  btn.classList.add('refreshing'); haptic('light');
  try{ await run(); }
  finally{
    const again = (id && document.getElementById(id)) || btn;
    again.classList.add('refreshing');
    setTimeout(()=>{ again.classList.remove('refreshing'); }, Math.max(0, 750 - (performance.now() - started)));
  }
}
/* Called by storage.js when the server rejects this device's session. */
function onSessionExpired(){
  if(state.account) signOut(t('sessionEnded'));
}

/* ============ Boot ============ */
let loadedOk = false, lastLoadAt = 0, refreshBusy = false, refreshWaiting = false, refreshAgain = false;
/* Orders, items and suppliers saved on the other phone show up here too: at once through Live changes
   ('live'), when the app comes back on screen (force), and every 20 seconds while the live connection is
   down (every 2 minutes as a safety net while it is up). A popup, a picker or typing is never
   interrupted: the screen is redrawn after it. */
const REFRESH_MS = 20000;
const refreshBlocked = () => !!document.querySelector('#modalRoot .modal-overlay, .sel-sheet, .pad-sheet, .ctx-layer') || document.getElementById('langLayer')
  || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
async function refreshData(force){
  if(refreshBusy){ if(force === 'live') refreshAgain = true; return; }
  if(!state.account || !loadedOk || !isVisible() || !navigator.onLine) return;
  const gap = force === 'live' ? 0 : force ? 15000 : liveHealthy() ? SAFETY_POLL_MS : REFRESH_MS;
  if(Date.now() - lastLoadAt < gap) return;
  refreshBusy = true;
  try{
    // A change to what this person may open or do (Admin, Access) redraws the screen too.
    const shown = () => JSON.stringify([state.history, state.items, state.suppliers, state.units, state.account, state.views, state.roles]);
    const before = shown();
    if(await loadData() && shown() !== before) refreshWaiting = true;
  }finally{ refreshBusy = false; }
  repaintAfterRefresh();
  // A change that arrived while this load was under way is loaded too.
  if(refreshAgain){ refreshAgain = false; refreshData('live'); }
}
let repaintTimer = 0;
function repaintAfterRefresh(){
  clearTimeout(repaintTimer);
  if(!refreshWaiting || !state.account) return;
  if(refreshBlocked()){ repaintTimer = setTimeout(repaintAfterRefresh, 3000); return; }
  refreshWaiting = false;
  render();
}
setInterval(()=>refreshData(false), 5000);
document.addEventListener('visibilitychange', ()=>refreshData(true));
/* Offline at start-up: show what we can, say so, and keep trying quietly. */
function retryLoad(){
  toast(state.offlineSince ? t('offlineCached')(formatIraqDateTime(state.offlineSince, {hour:'numeric', minute:'2-digit'})) : t('loadFailed'), 'warn', {ms:4200});
  const timer = setInterval(async ()=>{
    if(!state.account){ clearInterval(timer); return; }
    if(!isVisible() || !navigator.onLine) return;
    if(await loadData()){ clearInterval(timer); loadedOk = true; restoreCartDraft(); restoreQueue(); render(); maybeFinishQueue(); }
  }, 10000);
}
async function boot(){
  // GitHub Pages cannot set frame-ancestors headers. Refuse to expose the sign-in UI in a frame.
  if(window.top!==window.self){
    document.getElementById('app').textContent='Open Ricotta directly to sign in.';
    hideSplash(0);return;
  }
  try{
    state.deviceId = ensureDeviceId();
    lset('faceIdKeys',null); lset('showTransfers',null);   // settings from older versions
    const savedLang = lget('lang');
    state.lang = LANGS.includes(savedLang) ? savedLang : 'en';
    const session = apiSession();
    if(session && (session.account === 'rozha' || session.account === 'yunis')){
      applyAccount(session);
      loadedOk = await loadData();
      if(!loadedOk && !apiSession()) state.account = null;   // the session was rejected
      // Offline: open with what this phone saved last time; the real data replaces it once it loads.
      else if(!loadedOk && loadBootCache()){ restoreCartDraft(); restoreQueue(); }
      // Load the saved local draft only after the catalog is available, keeping
      // it intact if the app starts while offline and needs to retry loading.
      if(loadedOk){ restoreCartDraft(); restoreQueue(); }
    } else if(session){
      clearApiSession();   // a sign-in from before the two accounts: sign in again
    }
    render();
  }catch(e){
    // Whatever goes wrong while starting, the loading screen never stays up: the app says so and offers Refresh.
    console.error('start failed', e);
    try{ showStartFailure(); }catch(_){ /* the loading screen still lifts */ }
    hideSplash(0);
    return;
  }
  hideSplash();
  if(state.account){ heartbeat(); checkCommands(); maybeFinishQueue(); liveStart(); }
  if(state.account && !loadedOk) retryLoad();
  // Notifications: register the service worker, read this device's status, and
  // handle being launched from a notification tap.
  initPush().then(()=>{
    // Subscription discovery must not rebuild a 179-item order list (or reset a PIN being typed).
    const banner=document.querySelector('.push-banner');
    if(state.account && (pushBannerMode() || banner)) render();
    handleLaunchIntent();
  });
}
function showStartFailure(){
  const app = document.getElementById('app');
  const say = (key, fallback)=>{ try{ return t(key) || fallback; }catch(e){ return fallback; } };
  app.dataset.screen = 'error';
  app.innerHTML = `<div class="start-failed" role="alert"><b>${esc(say('startFailedTitle', 'Ricotta could not open'))}</b><p>${esc(say('startFailedText', 'Something went wrong while starting. Refresh to try again.'))}</p><button type="button" class="btn btn-primary" id="startReload">${ICON_REFRESH}<span>${esc(say('refreshNow', 'Refresh'))}</span></button></div>`;
  document.getElementById('startReload').onclick = e=>{ e.currentTarget.classList.add('refreshing'); hardReload(); };
}
/* The branded loading screen lives in index.html so it shows instantly.
   It lifts away once the first real screen is on the page and style.css is
   in. On a fast start it waits only until the green wipe has painted the word
   (about a second after it first appeared), so it never cuts off half-way. */
function cssReady(){
  if(window.__cssReady || getComputedStyle(document.documentElement).getPropertyValue('--bg')) return Promise.resolve();
  return new Promise(res=>{
    document.addEventListener('cssready', res, {once:true});
    setTimeout(res, 4000);   // never keep the app hidden because of a slow stylesheet
  });
}
async function hideSplash(minShown = 1150){
  const el = document.getElementById('splash');
  if(!el || el.dataset.state === 'leaving') return;
  await cssReady();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) minShown=0;
  const wait = Math.max(0, minShown - (performance.now() - (window.__splashStart || 0)));
  await new Promise(r=>setTimeout(r, wait));
  el.dataset.state = 'leaving';
  document.documentElement.classList.remove('booting');
  syncAppearance();
  let gone = false;
  const done = ()=>{ if(gone) return; gone = true; el.remove(); };
  el.addEventListener('animationend', e=>{ if(e.target === el) done(); });
  setTimeout(done, 1400);   // safety net
}
/* ---------- Ricotta on the map (sign-in, Welcome back, Admin) ----------
   One satellite picture of the street around the kitchen (Esri World Imagery), shipped with the app
   so it shows offline, and Ricotta's pin with two soft rings. In "green" the picture takes Ricotta's
   green; Admin shows it in its own colours. Directions opens Ricotta in Apple Maps. */
const RICOTTA_MAP = 'ricotta-map.jpg';
const RICOTTA_MAP_CREDIT = 'Esri, Vantor, Earthstar Geographics, GIS User Community';
const RICOTTA_DIRECTIONS = 'https://maps.apple/p/RvAJw2GV9jAvf_';
const ICON_OUT = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>`;
function ricottaMapWorld({green = true, label = false} = {}){
  return `<div class="rmap-world" aria-hidden="true"><img src="${RICOTTA_MAP}" alt="" width="1792" height="1792" draggable="false" decoding="async">${green ? '<i class="rmap-tint"></i>' : ''}<span class="rmap-pin"><i></i><i></i><b></b>${label ? `<span>${esc(t('mapPinLabel'))}</span>` : ''}</span></div>`;
}
const mapDirections = cls=>`<a class="map-directions ${cls}" href="${RICOTTA_DIRECTIONS}" target="_blank" rel="noopener">${esc(t('directions'))}${ICON_OUT}</a>`;
const mapCredit = ()=>`<span class="map-credit" dir="ltr">${RICOTTA_MAP_CREDIT}</span>`;
/* The map moves a little around Ricotta under a finger or the mouse, with a rubber band past its
   limits. On a phone it springs back to Ricotta when let go; on a computer it stays where it was
   left and the arrow button brings it back. */
function attachMapDrag(map, {limit, springBack}){
  const world = map?.querySelector('.rmap-world');
  if(!world) return;
  const recenter = map.querySelector('.map-recenter');
  let pos = {x:0, y:0}, drag = null;
  const rubber = (v, l)=> Math.abs(v) <= l ? v : Math.sign(v) * (l + (Math.abs(v) - l) * .3);
  const place = ()=>{ world.style.translate = `${pos.x}px ${pos.y}px`; recenter?.classList.toggle('show', Math.abs(pos.x) > 6 || Math.abs(pos.y) > 6); };
  map.onpointerdown = e=>{
    if(e.button > 0 || e.target.closest('a,button')) return;
    drag = {id:e.pointerId, x:e.clientX - pos.x, y:e.clientY - pos.y};
    map.setPointerCapture?.(e.pointerId); map.classList.add('dragging');
  };
  map.onpointermove = e=>{
    if(!drag || e.pointerId !== drag.id) return;
    pos = {x:rubber(e.clientX - drag.x, limit.x), y:rubber(e.clientY - drag.y, limit.y)}; place();
  };
  map.onpointerup = map.onpointercancel = e=>{
    if(!drag || e.pointerId !== drag.id) return;
    drag = null; map.classList.remove('dragging');
    pos = springBack ? {x:0, y:0} : {x:Math.max(-limit.x, Math.min(limit.x, pos.x)), y:Math.max(-limit.y, Math.min(limit.y, pos.y))};
    place();
  };
  if(recenter) recenter.onclick = ()=>{ pos = {x:0, y:0}; place(); };
}

/* After a PIN sign-in: "Welcome back, Yunis" over Ricotta's street in green (it settles from a little
   closer), with a bar that fills while the workspace loads; then it fades and the app rises into place.
   The earlier Welcome, with Rico waving, is kept in git: tag snapshot-2026-10-26-rico-welcome. */
let welcomeShownAt = 0;
function showWelcome(name){
  document.getElementById('welcome')?.remove();
  const el = document.createElement('div');
  el.id = 'welcome'; el.className = 'welcome rmap green'; el.setAttribute('role','status');
  el.innerHTML = `${ricottaMapWorld()}<div class="welcome-shade" aria-hidden="true"></div>
    <div class="welcome-word" dir="ltr" aria-hidden="true">ricotta<i></i></div>
    <span class="sr-only">${esc(t('welcomeName')(name))}</span>
    <div class="welcome-text" aria-hidden="true">
      <p class="welcome-line">${esc(t('welcomeBackLine'))}</p>
      <p class="welcome-name" dir="auto">${esc(name)}</p>
      <div class="welcome-bar"><i></i></div>
      <p class="welcome-sub">${esc(t('welcomeOpening'))}</p>
    </div>`;
  document.body.appendChild(el);
  welcomeShownAt = performance.now();
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('filling')));
  syncAppearance();
}
async function hideWelcome(minShown = 1500){
  const el = document.getElementById('welcome');
  if(!el || el.classList.contains('leaving')) return;
  const still = reducedMotion();
  if(still) minShown = 0;
  const wait = Math.max(0, minShown - (performance.now() - welcomeShownAt));
  await new Promise(r=>setTimeout(r, wait));
  el.classList.add('done');   // the bar fills the last bit
  await new Promise(r=>setTimeout(r, still ? 0 : 240));
  el.classList.add('leaving');
  if(!still) document.querySelector('.content')?.animate?.([{opacity:0, transform:'translateY(16px)'}, {opacity:1, transform:'none'}], {duration:600, easing:'cubic-bezier(.2,.8,.2,1)'});
  setTimeout(()=>{ el.remove(); syncAppearance(); }, still ? 0 : 640);
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
/* Each screen keeps its search and its place while you visit another one, and each supplier tab on
   Order keeps its place too (for this session; signing out forgets them). */
const viewMemory = new Map(), tabMemory = new Map();
const RENDERERS = {
  order:[()=>renderOrder(),()=>attachOrderEvents()], queue:[()=>renderQueue(),()=>attachQueueEvents()],
  history:[()=>renderHistory(),()=>attachHistoryEvents()], suppliers:[()=>renderSuppliers(),()=>attachSupplierEvents()],
  itemsAdmin:[()=>renderItemsAdmin(),()=>attachItemEvents()], units:[()=>renderUnits(),()=>attachUnitEvents()],
  record:[()=>renderRecord(),()=>attachRecordEvents()], admin:[()=>renderAdmin(),()=>attachAdminEvents()],
  manage:[()=>renderItemsAdmin(),()=>attachItemEvents()],
  settings:[()=>renderSettings(),()=>attachSettingsEvents()], assistant:[()=>renderAssistant(),()=>attachAssistantEvents()],
  transfers:[()=>renderTransfers(),()=>attachTransferEvents()]
};
const shellKey = ()=>[state.account, state.lang, state.tabs.join(','), state.views.join(',')].join('|');
/* One screen's page, without its events (render() attaches them). */
function pageHtml(view){
  const draw = (RENDERERS[view] || RENDERERS.order)[0];
  // Rico has his own header, and an Admin page its own (with Admin's back button).
  return `${view === 'assistant' || (view === 'admin' && state.adminPage) ? '' : renderPageHeading()}${view === 'order' ? renderPushBanner() : ''}${managedView(view)?renderManageNav():''}${draw()}`;
}
/* A neighbouring screen drawn for a swipe preview: the screens read state.view while they draw, so it
   is set to that screen for the moment (with its own remembered search) and put back. */
function peekHtml(view){
  const was = {view:state.view, query:state.catalogQuery};
  state.view = view; state.catalogQuery = viewMemory.get(view)?.query || '';
  try{ return pageHtml(view); }
  catch(e){ console.warn('swipe preview', e); return ''; }
  finally{ state.view = was.view; state.catalogQuery = was.query; }
}
function render(){
  applyLangClasses();
  applyPrefs();
  syncAppearance();
  const app = document.getElementById('app');
  if(!state.account){
    app.classList.toggle('static-update', app.dataset.screen === 'login');
    app.dataset.shell = ''; app.dataset.screen = 'login';
    app.innerHTML = renderLogin(); attachLoginEvents(); syncInstallPrompt(); return;
  }
  if(!canOpen(state.view)) state.view = state.tabs[0] || 'order';
  const attach = (RENDERERS[state.view] || RENDERERS.order)[1];
  const content = pageHtml(state.view);
  // The shell (top bar and tab bar) stays mounted while the account, its tabs
  // and the language stay the same.
  const keepShell = app.dataset.shell === shellKey() && app.querySelector('.content');
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
    if(state.view === 'transfers') stack.insertAdjacentHTML('afterbegin', renderTransferBar());
    markActiveNav();
  }else{
    app.innerHTML = `${renderTopbar()}<main class="content" id="mainContent">${content}</main>
      <div class="bottom-stack">${state.view==='order'?renderOrderBottomBar():''}${state.view==='assistant'?renderRicoComposer():''}${state.view==='transfers'?renderTransferBar():''}<div class="nav-row">${renderBottomNav()}<button type="button" class="to-top" id="toTopBtn" aria-label="${esc(t('backToTop'))}" aria-hidden="true" tabindex="-1">${ICON_TO_TOP}</button></div></div>`;
    attachShellEvents();
  }
  app.classList.remove('static-update');
  app.dataset.shell = shellKey(); app.dataset.screen = state.view;
  attachContentEvents();
  attach();
  if(state.view !== 'assistant') document.body.classList.remove('rico-composing');
  updateRicoBadge();
  placeNavIndicator();
  enhanceSegments();
  enhanceSelects();
  if(keepTop !== null){
    const box = scrollBox(); box.scrollTop = keepTop;
    requestAnimationFrame(()=>{ app.querySelector('.content')?.style.removeProperty('min-height'); box.scrollTop = keepTop; });
  }
  updateTopbar();
  paintToTop();
  paintStreakChip(false);
  syncInstallPrompt();
}

/* Rico in the top bar: a green pill with his sparkle and his name, that opens his screen. A red dot
   while he has written first or an order is late (checked every minute); the pill itself stays green. */
function updateRicoBadge(){
  const btn = document.getElementById('ricoTopBtn');
  if(!btn) return;
  const late = ricoLateOrders().length, unread = ricoUnread();
  btn.querySelector('.rico-badge').hidden = !(late || unread);
  btn.setAttribute('aria-label', late ? t('ricoNavLate')(late) : unread ? t('ricoNavUnread') : t('ricoName'));
}
setInterval(()=>{ if(state.account && isVisible()) updateRicoBadge(); }, 60000);
/* Rico answers what just happened: the pill gives one small bounce and its sparkle a quick turn (a small
   dip when the order was cleared). Calling it again restarts the motion from the start. */
function ricoReact(kind = 'up'){
  const btn = document.getElementById('ricoTopBtn');
  if(!btn || reducedMotion()) return;
  btn.dataset.react = kind;
  btn.classList.remove('reacting'); void btn.offsetWidth; btn.classList.add('reacting');
}

/* ============ Navigation ============
   Phones: up to four tabs (Order, History, Transfers, Manage, Record, Admin, whichever this person may
   open); with more than four, the rest are under More. Computers: a sidebar with every screen. Rico
   opens from the top bar and Settings from the account sheet. A lens glides to the current tab, the
   page can be swiped between the tabs, and the bar shrinks to its icons while you scroll down. */
const VIEW_LABEL_KEYS = {manage:'manage',order:'order', assistant:'ricoName', transfers:'transfers', history:'history', suppliers:'suppliers', itemsAdmin:'items', units:'units', record:'record', admin:'adminTitle', settings:'settings', queue:'sendQueueTitle'};
function viewLabel(id){ return t(VIEW_LABEL_KEYS[id] || 'order'); }
function isPhoneLayout(){ return window.innerWidth < 960; }
/* What scrolls: the screen's content inside the app frame (Home Screen app
   on a phone, see boot.js), otherwise the page itself. */
function inAppFrame(){ return document.documentElement.classList.contains('app-shell') && isPhoneLayout(); }
function scrollBox(){ return (inAppFrame() && document.querySelector('.content')) || document.scrollingElement; }
/* Every screen in tab-bar order: the tabs first, then the rest. */
function navOrder(){ return [...state.tabs, ...state.views.filter(v=>!state.tabs.includes(v))]; }
const managedView=v=>['manage','itemsAdmin','suppliers','units'].includes(v);
const moreViews=()=>navScreens().slice(4);
const mainView=v=>managedView(v)?'manage':v;
function viewIndex(v){ const i = navOrder().indexOf(v); return i >= 0 ? i : navOrder().length; }
const reducedMotion = ()=> matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderBottomNav(){
  const button=id=>`<button type="button" class="navbtn" data-view="${id}">${NAV_ICONS[id]||ICON_MORE}<span>${esc(viewLabel(id))}</span>${id==='transfers'?transferNavBadge():''}</button>`;
  const more = moreViews();
  // On a computer the tab bar is the sidebar, with the ricotta mark at its top. More exists only when
  // there are more than four screens.
  return `<nav class="bottomnav" style="--n:${state.tabs.length + (more.length ? 1 : 0)}" aria-label="${esc(t('workspaceLabel'))}"><div class="brand nav-brand" aria-hidden="true"><span class="brand-mark">ricotta</span><span class="dot"></span></div><span class="nav-indicator" aria-hidden="true"></span>${state.tabs.map(button).join('')}${more.length ? `<button type="button" class="navbtn nav-more-btn" id="navMoreBtn" aria-haspopup="true" aria-expanded="false" aria-controls="navMore">${ICON_MORE}<span>${esc(t('more'))}</span></button><div class="nav-more" id="navMore" role="group" aria-label="${esc(t('more'))}">${more.map(button).join('')}</div>` : ''}</nav>`;
}
function renderManageNav(){
  return `<div class="manage-nav"><nav class="manage-sections" aria-label="${esc(t('catalog'))}">${[['manage','items'],['suppliers','suppliers'],['units','units']].filter(([v])=>canOpen(v)).map(([v,k])=>`<button type="button" class="manage-section ${(state.view==='itemsAdmin'?'manage':state.view)===v?'active':''}" data-manage-view="${v}" aria-current="${(state.view==='itemsAdmin'?'manage':state.view)===v?'page':'false'}">${esc(t(k))}</button>`).join('')}</nav></div>`;
}
function setMoreOpen(open){
  const nav=document.querySelector('.bottomnav'),button=document.getElementById('navMoreBtn');
  if(!nav||!button)return;
  nav.classList.toggle('more-open',open);button.setAttribute('aria-expanded',String(open));
}
document.addEventListener('click',event=>{if(!event.target.closest('.bottomnav'))setMoreOpen(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape')setMoreOpen(false);});
function markActiveNav(){
  document.getElementById('navMoreBtn')?.classList.toggle('active',moreViews().includes(state.view));
  const rico = document.getElementById('ricoTopBtn');
  if(rico){ rico.classList.toggle('active', state.view === 'assistant'); if(state.view === 'assistant') rico.setAttribute('aria-current','page'); else rico.removeAttribute('aria-current'); }
  document.querySelectorAll('.bottomnav [data-view]').forEach(b=>{
    const on = b.dataset.view === mainView(state.view);
    b.classList.toggle('active', on);
    if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
}
function barButtons(nav){ return [...nav.querySelectorAll(':scope > .navbtn')]; }
function placeNavIndicator(){
  const nav = document.querySelector('.bottomnav'), ind = nav?.querySelector('.nav-indicator');
  if(!nav || !ind) return;
  markActiveNav();
  if(nav.classList.contains('held')) return;       // while a finger slides along the bar, the finger decides
  barButtons(nav).forEach(b=>b.classList.remove('lens-over'));
  const phone = isPhoneLayout();
  // On a computer the More button is hidden, so the lens goes to the screen's own row.
  const active = phone
    ? (moreViews().includes(state.view)?nav.querySelector('#navMoreBtn'):nav.querySelector(`:scope > .navbtn[data-view="${mainView(state.view)}"]`))
    : nav.querySelector(`.navbtn[data-view="${mainView(state.view)}"]`);
  if(!active || !active.offsetWidth){ ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  // The first placement jumps straight there; after that the highlight glides.
  const first = !nav.classList.contains('has-indicator');
  if(first) ind.style.transition = 'none';
  nav.classList.add('has-indicator');
  if(!phone){
    ind.style.setProperty('--iy', active.offsetTop+'px');
    ind.style.setProperty('--ih', active.offsetHeight+'px');
  }else{
    // The tabs share the bar equally, so the lens is placed by its position (see .nav-indicator): it
    // stays on its tab while the bar itself grows or shrinks.
    ind.style.setProperty('--ip', String(barButtons(nav).indexOf(active)));
  }
  if(first){ void ind.offsetWidth; ind.style.transition = ''; }
}
/* Slides the lens to a fractional tab position (1.5 = halfway between the
   second and third tab); used while a finger is on the bar or the page. */
function setLensPosition(pos){
  const nav = document.querySelector('.bottomnav'), ind = nav?.querySelector('.nav-indicator');
  if(!nav || !ind || !isPhoneLayout()) return;
  const btns = barButtons(nav);
  if(!btns.length) return;
  const p = Math.max(0, Math.min(btns.length-1, pos));
  ind.style.opacity = '1';
  ind.style.setProperty('--ip', p.toFixed(3));
  btns.forEach((x,k)=>x.classList.toggle('lens-over', k===Math.round(p)));
}
/* Hold the tab bar and slide (phones): the lens follows the finger and each
   tab it passes opens with a quick fade. Letting go on More opens More. */
(function initBarSlide(){
  let d = null;   // {id, x0, x, moved, last (button index), frame}
  const nav = ()=>document.querySelector('.bottomnav');
  const open = b=>{ const v = b?.dataset.view; if(v && mainView(state.view) !== v) goView(v, {keepLens:true, fade:true}); };
  document.addEventListener('pointerdown', e=>{
    const bar = e.target.closest?.('.bottomnav');
    if(!bar || !isPhoneLayout() || e.button>0 || e.target.closest('.nav-more')) return;
    d = {id:e.pointerId, x0:e.clientX, x:e.clientX, moved:false, last:barButtons(bar).findIndex(b=>b.classList.contains('active'))};
  });
  document.addEventListener('pointermove', e=>{
    if(!d || e.pointerId!==d.id) return;
    d.x = e.clientX;
    const bar = nav(); if(!bar) return;
    if(!d.moved){
      if(Math.abs(e.clientX-d.x0) < 6) return;
      d.moved = true; setMoreOpen(false); bar.classList.add('held');
      try{ bar.setPointerCapture(e.pointerId); }catch(_){}
    }
    if(d.frame) return;
    d.frame = requestAnimationFrame(()=>{
      if(!d) return;
      d.frame = 0;
      const btns = barButtons(bar), s = slotAt(btns, d.x);
      setLensPosition(s.pos);
      if(s.index !== d.last){ d.last = s.index; open(btns[s.index]); }
    });
  });
  const end = e=>{
    if(!d || e.pointerId!==d.id) return;
    const s = d; d = null; cancelAnimationFrame(s.frame);
    const bar = nav(); if(!bar || !s.moved) return;
    const btn = barButtons(bar)[slotAt(barButtons(bar), e.clientX || s.x).index];
    bar.classList.remove('held');
    open(btn);
    placeNavIndicator();
    if(btn?.id === 'navMoreBtn') setMoreOpen(true);
    // The browser's own click after the slide must not press the tab again.
    const swallow = ev=>{
      if(!bar.contains(ev.target)) return;
      ev.stopPropagation(); ev.preventDefault();
      document.removeEventListener('click', swallow, {capture:true});
    };
    document.addEventListener('click', swallow, {capture:true});
    setTimeout(()=>document.removeEventListener('click', swallow, {capture:true}), 300);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();
/* ============ Switches you can slide ============
   Record's filters, Manage's sections and the small switches (dark mode,
   Rico's history) share one behaviour with the tab bar: a highlight sits
   under the chosen part, and if you hold it and slide, it follows your finger
   and each part it passes opens as it goes. A switch that changes a setting
   (dark mode) waits until you let go. The drag is followed at document
   level, so a row redrawn meanwhile continues it. */
const SEG_ROWS = '.record-filters,.manage-sections,.pill-seg';
const segPills = seg=>[...seg.querySelectorAll('.tab-pill,.manage-section,.pill-seg-btn')];
const segIsOn = el=>el.classList.contains('active') || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
const segLive = seg=>!seg.classList.contains('dark-seg');
const segs = ()=>[...document.querySelectorAll(SEG_ROWS)].filter(seg=>seg.classList.contains('seg'));
/* Where x falls along a row of buttons: the nearest one, and a fractional
   position (1.5 = halfway between the second and third). */
function slotAt(buttons, x){
  const c = buttons.map(el=>{ const r = el.getBoundingClientRect(); return r.left+r.width/2; });
  const order = c.map((v,k)=>[v,k]).sort((m,n)=>m[0]-n[0]);
  let pos = order[order.length-1][1], best = 0;
  c.forEach((v,k)=>{ if(Math.abs(v-x) < Math.abs(c[best]-x)) best = k; });
  if(x <= order[0][0]) pos = order[0][1];
  else for(let k=0;k<order.length-1;k++){ const [c1,i1]=order[k],[c2,i2]=order[k+1]; if(x<=c2){ pos = i1+(i2-i1)*((x-c1)/(c2-c1)); break; } }
  return {index:best, pos};
}
const segSlot = (seg, x)=>slotAt(segPills(seg), x);
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
  const lens = seg.querySelector('.seg-lens'), on = segPills(seg).find(segIsOn);
  if(!lens) return;
  if(!on || !on.offsetWidth){ lens.style.opacity = '0'; return; }
  lens.style.opacity = '1';
  lens.style.setProperty('--lx', on.offsetLeft+'px'); lens.style.setProperty('--lw', on.offsetWidth+'px');
  if(!seg.classList.contains('seg-ready')) seg.classList.add('seg-ready');
}
let segDrag = null;   // {id, x0, x, moved, index (which row), last (part index)}
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
  document.querySelectorAll(SEG_ROWS).forEach(seg=>{
    if(seg.dataset.lens) return;
    seg.dataset.lens = '1'; seg.classList.add('seg');
    const lens = document.createElement('span'); lens.className = 'seg-lens'; lens.setAttribute('aria-hidden', 'true');
    seg.prepend(lens);
    new MutationObserver(()=>segPlace(seg)).observe(seg, {subtree:true, attributes:true, attributeFilter:['class','aria-checked','aria-selected']});
    segPlace(seg);
    if(segDrag && segDrag.moved && segs().indexOf(seg) === segDrag.index) segAdopt(seg);
  });
}
document.addEventListener('pointerdown', e=>{
  const seg = e.target.closest?.(SEG_ROWS);
  if(!seg || !seg.classList.contains('seg') || e.button>0) return;
  segDrag = {id:e.pointerId, x0:e.clientX, x:e.clientX, moved:false, index:segs().indexOf(seg), last:null};
});
document.addEventListener('pointermove', e=>{
  if(!segDrag || e.pointerId!==segDrag.id) return;
  segDrag.x = e.clientX;
  if(!segDrag.moved && Math.abs(e.clientX-segDrag.x0) < 4) return;
  const seg = segs()[segDrag.index]; if(!seg) return;
  if(!segDrag.moved){
    segDrag.moved = true; segDrag.last = segPills(seg).findIndex(segIsOn);
    seg.classList.add('held'); try{ seg.setPointerCapture(e.pointerId); }catch(_){}
  }
  // The highlight follows the finger once per frame; a part opens as the highlight reaches it.
  if(segDrag.frame) return;
  segDrag.frame = requestAnimationFrame(()=>{
    if(!segDrag) return;
    segDrag.frame = 0;
    const cur = segs()[segDrag.index]; if(!cur) return;
    const s = segSlot(cur, segDrag.x);
    segLensTo(cur, s.pos);
    if(s.index === segDrag.last) return;
    segDrag.last = s.index;
    const part = segPills(cur)[s.index];
    if(segLive(cur) && part && !segIsOn(part)) part.click();
  });
});
const segEnd = e=>{
  if(!segDrag || e.pointerId!==segDrag.id) return;
  const d = segDrag; segDrag = null; cancelAnimationFrame(d.frame);
  if(d.moved){                                         // let go: the part under the finger is the one that stays open
    const cur = segs()[d.index], part = cur && segPills(cur)[segSlot(cur, e.clientX || d.x).index];
    if(part && !segIsOn(part)) part.click();
  }
  const seg = segs()[d.index];
  if(seg){ seg.classList.remove('held'); segPills(seg).forEach(x=>x.classList.remove('lens-over')); segPlace(seg); }
  if(!d.moved) return;
  // The browser's own click after a drag must not also press whatever is under the finger.
  const swallow = ev=>{
    if(!segs()[d.index]?.contains(ev.target)) return;
    ev.stopPropagation(); ev.preventDefault();
    document.removeEventListener('click',swallow,{capture:true});
  };
  document.addEventListener('click', swallow, {capture:true});
  setTimeout(()=>document.removeEventListener('click', swallow, {capture:true}), 300);
};
document.addEventListener('pointerup', segEnd);
document.addEventListener('pointercancel', segEnd);
window.addEventListener('resize', ()=>segs().forEach(segPlace));


document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeLangMenu(); });

/* ---------- Page transitions ----------
   Like an iPhone's tab bar, tapping a screen cross-fades to it quickly; only a finger swiping the
   page slides it. Redrawing the same screen never plays an entrance animation. */
const PAGE_TRANSITION = {ms:200};
const SWIPE_MS = 200;
const PAGE_EASE = 'cubic-bezier(.25,.1,.25,1)';
// After a swipe the page is already moving with the finger, so it keeps going and settles without a bounce.
const SWIPE_EASE = 'cubic-bezier(.2,.8,.2,1)';
let glide = null;
function endGlide(){
  if(!glide) return;
  glide.anims.forEach(a=>a.cancel());
  glide.ghost?.remove();
  glide.content.classList.remove('gliding');
  glide = null;
}
const FADE_FRAMES = {inn:[{opacity:0},{opacity:1}], out:[{opacity:1},{opacity:0}]};
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
function goView(view, {fromOffset=0, velocity=0, peek=null, keepLens=false, fade=false} = {}){
  closeLangMenu();setMoreOpen(false);
  if(view !== 'assistant' && ricoRecorder.active) ricoResetVoice();   // leaving Rico drops an unsent recording
  if(!view || view === state.view || !canOpen(view)){ peek?.layer.remove(); return; }
  reminderDraft = null;   // a reminder that wasn't saved stays off
  if(view !== 'admin') state.adminPage = null;
  endGlide();
  const dir = (Math.sign(viewIndex(view) - viewIndex(state.view)) || 1) * (isRtl() ? -1 : 1);
  const old = document.querySelector('.content');
  const width = old ? old.getBoundingClientRect().width : window.innerWidth;
  const quick = fade || (managedView(state.view) && managedView(view));   // within Manage, or sliding along the tab bar
  const frames = old && old.animate && !reducedMotion() ? (fromOffset ? swipeFrames(dir, width) : {inn:[...FADE_FRAMES.inn], out:[...FADE_FRAMES.out]}) : null;
  // The place is saved before the old page moves into its slide-out copy (that empties the page).
  viewMemory.set(state.view, {query:state.catalogQuery || '', top:scrollBox().scrollTop});
  const ghost = frames?.out ? pageGhost(old) : null;
  const remembered = viewMemory.get(view);
  state.catalogQuery = remembered?.query || ''; state.view = view;
  if(view === 'record'){ state.recordFilter = 'all'; state.recordLimit = RECORD_PAGE_SIZE; }
  render();
  scrollBox().scrollTo({top:remembered?.top || 0});
  // The swipe's preview of this page is replaced by the page itself, in the same place.
  peek?.layer.remove();
  // After a swipe in the small (scrolled) tab bar, the bar grows back only once the pages have
  // settled: the bar and the page moving at the same time read as a stutter.
  const growAfter = !!fromOffset && !!frames && !!document.querySelector('.bottomnav.compact');
  if(growAfter){ barQuietUntil = performance.now() + 1200; barLastY = scrollBox().scrollTop; paintToTop(); }
  else quietBar();
  if(view === 'record') refreshActivity();
  if(view === 'admin') refreshDevices();
  if(!keepLens) placeNavIndicator();
  const content = document.querySelector('.content');
  if(!frames || !content){ ghost?.layer.remove(); if(content) content.style.transform = ''; if(growAfter) quietBar(); return; }
  // After a swipe, pages start from where the finger left them.
  if(fromOffset){
    frames.inn[0] = {transform:`translate3d(${dir*width + fromOffset}px,0,0)`};
    frames.out[0] = {transform:`translate3d(${fromOffset}px,0,0)`};
  }
  // After a swipe the pages carry on at the speed the finger let go (this curve starts about four times
  // faster than its average), so there is no seam between dragging and gliding.
  const remaining = Math.max(0, width - Math.abs(fromOffset));
  const swipeMs = Math.round(Math.min(420, Math.max(SWIPE_MS, velocity ? 4 * remaining / Math.abs(velocity) : 300)));
  const opts = fromOffset ? {duration:swipeMs, easing:SWIPE_EASE} : {duration:quick?160:PAGE_TRANSITION.ms, easing:PAGE_EASE};
  content.style.transform = '';
  content.classList.add('gliding');
  const anims = [content.animate(frames.inn, opts)];
  if(ghost) anims.push(ghost.copy.animate(frames.out, opts));
  glide = {anims, ghost:ghost?.layer, content};
  const mine = glide;
  anims[0].finished.then(()=>{ if(glide === mine) endGlide(); if(growAfter && state.view === view) quietBar(); }, ()=>{ if(growAfter) quietBar(); });
}

/* Swipe the page sideways to move between the tabs (phones), like the iPhone's Home Screen: the next
   page is already there beside this one and both follow the finger; let go and they carry on at the
   finger's speed (a short flick is enough: the release speed is projected forward, as iOS does). Past
   the first or last tab the page resists, more the further it is pulled. Anything that scrolls
   sideways on its own, inputs, steppers and open dialogs are left alone. */
const rubberband = (x, size, c = .55)=> (x * size * c) / (size + c * Math.abs(x));
const projectSwipe = (pxPerMs, rate = .995)=> pxPerMs * rate / (1 - rate);
/* The neighbouring page, drawn beside this one in a layer of its own (with its remembered place). */
function pagePeek(view, content){
  const r = content.getBoundingClientRect(), top = viewMemory.get(view)?.top || 0;
  const layer = document.createElement('div');
  layer.className = 'page-ghost page-peek'; layer.setAttribute('aria-hidden','true');
  Object.assign(layer.style, {left:r.left+'px', width:r.width+'px'});
  const copy = content.cloneNode(false);
  copy.removeAttribute('id'); copy.classList.remove('gliding');
  copy.innerHTML = peekHtml(view);
  copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  if(inAppFrame()) Object.assign(copy.style, {top:r.top+'px', width:r.width+'px', height:r.height+'px', transform:''});
  else Object.assign(copy.style, {top:(r.top + window.scrollY - top)+'px', width:r.width+'px', transform:''});
  layer.appendChild(copy);
  document.body.appendChild(layer);
  if(inAppFrame()) copy.scrollTop = top;
  return {view, layer, copy};
}
(function initPageSwipe(){
  let g = null;
  const blocked = el=>el.closest('input,textarea,select,.stepper,.order-tabs,.record-filters,.manage-sections,.pill-seg,.rico-composer,.bottom-stack,.item-sort-list,.day-chips,.unit-grid,.rico-picker-list,.data-table-scroll,#modalRoot .modal-overlay,.ctx-layer,.lang-layer');
  const dropPeek = s=>{ s.peek?.layer.remove(); s.peek = null; };
  document.addEventListener('pointerdown', e=>{
    if(!isPhoneLayout() || e.pointerType==='mouse' || !state.account) return;
    const content = e.target.closest('.content');
    if(!content || blocked(e.target) || !state.tabs.includes(mainView(state.view)) || state.adminPage) return;
    g = {x:e.clientX, y:e.clientY, id:e.pointerId, content, dx:0, mode:null, peek:null, moves:[{x:e.clientX, t:performance.now()}]};
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
    g.moves.push({x:e.clientX, t:performance.now()});
    if(g.moves.length > 6) g.moves.shift();
    const rtl = isRtl() ? -1 : 1, i = state.tabs.indexOf(mainView(state.view)), w = g.content.getBoundingClientRect().width || window.innerWidth;
    const next = i - Math.sign(dx)*rtl;
    const edge = !dx || next < 0 || next >= state.tabs.length;
    g.dx = edge ? rubberband(dx, w) : dx;
    g.content.style.transform = `translate3d(${g.dx}px,0,0)`;
    if(edge){ dropPeek(g); placeNavIndicator(); return; }
    if(g.peek?.view !== state.tabs[next]){ dropPeek(g); g.peek = pagePeek(state.tabs[next], g.content); }
    g.peek.copy.style.transform = `translate3d(${g.dx - Math.sign(g.dx)*w}px,0,0)`;
    setLensPosition(i + (-g.dx*rtl)/w);
  }, {passive:true});
  const end = e=>{
    if(!g || e.pointerId!==g.id) return;
    const s = g; g = null;
    document.body.classList.remove('page-swiping');
    if(s.mode !== 'x'){ dropPeek(s); return; }
    // A sideways swipe that started on a button must not also press it.
    const swallow = ev=>{
      if(!s.content.contains(ev.target)) return;
      ev.stopPropagation(); ev.preventDefault();
      document.removeEventListener('click', swallow, {capture:true});
    };
    document.addEventListener('click', swallow, {capture:true});
    setTimeout(()=>document.removeEventListener('click', swallow, {capture:true}), 350);
    const rtl = isRtl() ? -1 : 1, i = state.tabs.indexOf(mainView(state.view)), w = s.content.getBoundingClientRect().width || window.innerWidth;
    // The finger's speed over its last few moves, in pixels per millisecond.
    const first = s.moves[0], last = s.moves[s.moves.length-1];
    const v = last.t - first.t > 0 ? (last.x - first.x) / (last.t - first.t) : 0;
    const projected = s.dx + projectSwipe(v);
    const next = i - Math.sign(s.dx)*rtl;
    const go = Math.sign(projected) === Math.sign(s.dx) && Math.abs(projected) > w * .5;
    if(go && s.peek && next >= 0 && next < state.tabs.length){
      // The new page carries on from where the finger left it, at the finger's speed.
      goView(state.tabs[next], {fromOffset:s.dx, velocity:v, peek:s.peek});
      return;
    }
    const settle = {duration:380, easing:'cubic-bezier(.2,.8,.2,1)'};
    s.content.animate?.([{transform:`translate3d(${s.dx}px,0,0)`},{transform:'none'}], settle);
    s.content.style.transform = '';
    if(s.peek){
      const away = `translate3d(${-Math.sign(s.dx)*w}px,0,0)`, peek = s.peek;
      peek.copy.style.transform = away;
      const a = peek.copy.animate?.([{transform:`translate3d(${s.dx - Math.sign(s.dx)*w}px,0,0)`},{transform:away}], settle);
      if(a) a.finished.then(()=>peek.layer.remove(), ()=>peek.layer.remove()); else peek.layer.remove();
    }
    placeNavIndicator();
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
  // "Choose a supplier" and similar are prompts, not choices: they stay on the button but not in the list.
  const prompts = [t('chooseSupplier'), t('trChooseUnit')];
  const opts = [...sel.options].filter(o=>(!o.disabled || o.selected) && !(o.value === '' && prompts.includes(o.textContent))).map(o=>({value:o.value, label:o.textContent, on:o.selected}));
  const long = opts.length > 9;
  const wrap = document.createElement('div');
  wrap.id = 'selSheet'; wrap.className = 'sel-sheet';
  wrap.innerHTML = `<div class="sel-scrim"></div><div class="sel-panel" role="dialog" aria-modal="true" aria-label="${esc(selTitle(sel))}">
    <div class="sel-grab"></div><div class="sel-title">${esc(selTitle(sel))}</div>
    ${long ? `<div class="search-wrap sel-search">${ICON_SEARCH}<input class="search-input" type="search" autocomplete="off" placeholder="${esc(t('selSearch'))}"></div>` : ''}
    <div class="sel-list" role="listbox"></div></div>`;
  document.body.appendChild(wrap);
  const list = wrap.querySelector('.sel-list');
  const paint = q=>{
    const shown = globalThis.RicottaSearch.rank(opts,q,o=>o.label);
    list.innerHTML = shown.length ? shown.map(o=>`<button type="button" class="sel-opt${o.on ? ' on' : ''}${o.value === '' ? ' none' : ''}" role="option" aria-selected="${o.on}" data-v="${esc(o.value)}"><span dir="auto">${esc(o.label)}</span>${o.on ? ICON_CHECK : ''}</button>`).join('')
      : `<div class="field-hint">${esc(t('noSearchResults'))}</div>`;
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
    // On a phone the keyboard opens only when the person taps the search box.
    const touch = matchMedia('(pointer: coarse)').matches;
    ((!touch && wrap.querySelector('.sel-search input')) || chosen || list.querySelector('button'))?.focus({preventScroll:true});
  });
}
// Dropdowns drawn after the page (modals) get the same list.
new MutationObserver(muts=>{ if(muts.some(m=>[...m.addedNodes].some(n=>n.nodeType === 1 && (n.matches('select') || n.querySelector('select'))))) enhanceSelects(); })
  .observe(document.documentElement, {childList:true, subtree:true});

/* Our own number pad (phones). A box marked data-pad="int" or "dec" never opens the iPhone keyboard: the box
   itself is not focusable on touch screens (so the page cannot jump), and a tap on it slides this pad up from the
   bottom. Each key writes into the box and fires 'input', so the screen's own handlers work as with typing.
   On a computer the boxes stay normal and are typed into. */
const PAD_TOUCH = matchMedia('(pointer: coarse)');
function enhancePads(root = document){
  if(!PAD_TOUCH.matches) return;
  root.querySelectorAll('input[data-pad]:not(.pad-input)').forEach(inp=>{
    inp.classList.add('pad-input'); inp.readOnly = true; inp.inputMode = 'none'; inp.tabIndex = -1;
    inp.parentElement.dataset.padhost = '';
  });
}
let padState = null;
function padClose(){
  if(!padState) return;
  const {el, input} = padState; padState = null;
  input?.classList.remove('pad-on');
  document.documentElement.classList.remove('pad-open');
  document.body.style.paddingBottom = '';
  el.classList.add('out');
  setTimeout(()=>el.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
}
function padFieldLabel(input){
  return (input.getAttribute('aria-label') || input.closest('.field')?.querySelector('label')?.textContent || '').trim();
}
function padVisible(input){
  // Brings the box above the pad with one gentle scroll, only when the pad would cover it.
  const panel = padState?.el.querySelector('.pad-panel'); if(!panel) return;
  const r = input.getBoundingClientRect(), bottom = window.innerHeight - panel.offsetHeight - 16, top = 90;
  if(r.bottom > bottom) window.scrollBy({top: r.bottom - bottom, behavior: 'smooth'});
  else if(r.top < top) window.scrollBy({top: r.top - top, behavior: 'smooth'});
}
function padOpen(input){
  if(padState?.input === input) return;
  padState?.input?.classList.remove('pad-on');
  closeSelSheet();
  document.activeElement?.blur?.();
  if(!padState){
    const el = document.createElement('div');
    el.className = 'pad-sheet';
    el.innerHTML = `<div class="pad-panel" role="group">
      <div class="pad-head"><span class="pad-label" dir="auto"></span><button type="button" class="pad-done" data-pk="done">${esc(t('padDone'))}</button></div>
      <div class="pad-keys">${['1','2','3','4','5','6','7','8','9','.','0','del'].map(k=>`<button type="button" class="pad-key${k === 'del' ? ' pad-del' : ''}" data-pk="${k}" aria-label="${k === 'del' ? esc(t('delete')) : k}">${k === 'del' ? '<svg width="26" height="20" viewBox="0 0 26 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M8 1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8L1 10z"/><path d="M12 6l8 8M20 6l-8 8" stroke-linecap="round"/></svg>' : k}</button>`).join('')}</div></div>`;
    document.body.appendChild(el);
    padState = {el};
    el.addEventListener('pointerdown', e=>e.preventDefault());
    el.addEventListener('click', e=>{
      const k = e.target.closest('[data-pk]')?.dataset.pk; if(!k || !padState) return;
      if(k === 'done'){ padClose(); return; }
      padKey(k);
    });
    // Holding delete clears the box.
    let hold = 0;
    const del = el.querySelector('.pad-del');
    del.addEventListener('pointerdown', ()=>{ hold = setTimeout(()=>{ if(padState?.input){ padSet(''); hold = -1; } }, 550); });
    ['pointerup','pointerleave','pointercancel'].forEach(ev=>del.addEventListener(ev, ()=>{ if(hold > 0) clearTimeout(hold); }));
    del.addEventListener('click', e=>{ if(hold === -1){ e.stopImmediatePropagation(); hold = 0; } }, true);
  }
  padState.input = input;
  input.classList.add('pad-on');
  const dec = input.dataset.pad === 'dec';
  padState.el.querySelector('[data-pk="."]').disabled = !dec;
  padState.el.querySelector('.pad-label').textContent = padFieldLabel(input);
  document.documentElement.classList.add('pad-open');
  requestAnimationFrame(()=>{
    if(!padState) return;
    document.body.style.paddingBottom = padState.el.querySelector('.pad-panel').offsetHeight + 'px';
    padVisible(input);
  });
}
function padSet(v){
  const input = padState?.input; if(!input) return;
  input.value = v;
  input.dispatchEvent(new Event('input', {bubbles: true}));
}
function padKey(k){
  const input = padState?.input; if(!input || !input.isConnected){ padClose(); return; }
  let v = input.value;
  const max = Number(input.getAttribute('maxlength')) || 14;
  if(k === 'del') v = v.slice(0, -1);
  else if(k === '.'){ if(input.dataset.pad !== 'dec' || v.includes('.')) return; v = (v || '0') + '.'; }
  else { if(v.length >= max) return; v = input.dataset.pad === 'dec' && v === '0' ? k : v + k; }
  padSet(v);
}
document.addEventListener('click', e=>{
  if(!padState && !PAD_TOUCH.matches) return;
  if(e.target.closest('.pad-sheet')) return;
  const host = e.target.closest('[data-padhost]');
  // The − / + beside an amount work as they are and leave the pad as it was.
  if(host && e.target.closest('button,a,select')) return;
  const input = host?.querySelector('input.pad-input');
  if(input && !input.disabled && !input.closest('[hidden]')){ padOpen(input); return; }
  if(padState) padClose();
});
// Boxes drawn later (dialogs) get the pad too.
new MutationObserver(muts=>{ if(PAD_TOUCH.matches && muts.some(m=>[...m.addedNodes].some(n=>n.nodeType === 1 && (n.matches('input[data-pad]') || n.querySelector('input[data-pad]'))))) enhancePads(); })
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
  const titled = y > 64;
  if(titled && title) placeTopbarTitle(bar, title);
  bar.classList.toggle('titled', titled);
}
/* The screen's name sits in the middle of the bar when there is room on both sides; when the buttons
   beside it (the streak, Offline, Rico, the account) take that room, it moves into the free space
   between them instead of sliding under them. */
function placeTopbarTitle(bar, title){
  const b = bar.getBoundingClientRect(), a = bar.querySelector('.topbar-actions')?.getBoundingClientRect();
  if(!a || !b.width) return;
  const pad = 16, gap = 10;
  const lo = isRtl() ? a.right - b.left + gap : pad, hi = isRtl() ? b.width - pad : a.left - b.left - gap;
  const mid = b.width / 2, half = Math.min(mid - lo, hi - mid);
  const centered = half * 2 >= Math.min(title.scrollWidth, 150);
  title.style.left = (centered ? mid : (lo + hi) / 2) + 'px';
  title.style.maxWidth = Math.max(0, centered ? half * 2 : hi - lo) + 'px';
}
// Capturing: in the app frame it is the content, not the page, that scrolls.
document.addEventListener('scroll', updateTopbar, {passive:true, capture:true});
/* Restarts a CSS "bump" animation on an element (used for changing numbers). */
function bump(el){
  if(!el) return;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
/* The browser bar and the iPhone's status bar match the page, light or dark, and the dark green of the
   loading screen while it shows. */
function syncAppearance(){
  const meta=document.querySelector('meta[name="theme-color"]');
  const dark = document.documentElement.classList.contains('dark');
  // Green behind the loading screen, Welcome back and a phone's sign-in (its map reaches the top).
  const splash = document.documentElement.classList.contains('booting') || !!document.getElementById('welcome')
    || (!state.account && matchMedia('(max-width:959px)').matches);
  const color = splash ? '#14382C' : dark ? '#000000' : '#F2F2F7';
  // A Home Screen app can keep the colour it opened with when the tag only changes, so the tag is
  // replaced with a new one.
  if(meta && meta.content !== color){
    const next = document.createElement('meta');
    next.name = 'theme-color'; next.content = color;
    meta.replaceWith(next);
  }
  // The iPhone app matches it behind the page and in the status bar.
  tellApp(splash ? 'page-splash' : dark ? 'page-dark' : 'page-light');
}
/* A small badge identifying who made a change. */
function whoBadge(account){
  const name = accountLabel(account);
  if(!name) return '';
  return `<span class="who-badge"><s aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase())}</s>${esc(name)}</span>`;
}
/* Two display choices for the Order screen, kept per device (both start off). */
const prefOn = key => lget(key) === true;
/* Light or dark: 'off' (light), 'on' (dark) or 'auto' (follows the phone, the default), kept per device. */
const darkMode = () => ['on','off'].includes(lget('darkMode')) ? lget('darkMode') : 'auto';
const DARK_QUERY = matchMedia('(prefers-color-scheme: dark)');
function applyPrefs(){
  document.documentElement.classList.toggle('compact-rows', prefOn('compactRows'));
  const m = darkMode();
  document.documentElement.classList.toggle('dark', m === 'on' || (m === 'auto' && DARK_QUERY.matches));
}
DARK_QUERY.addEventListener?.('change', ()=>{ if(darkMode() === 'auto'){ applyPrefs(); syncAppearance(); } });
/* What each item was last ordered at (newest order that had it), for "Show last quantity". */
let lastQtyCache = {key:'', map:{}};
function lastQtyMap(){
  const last = state.history[state.history.length-1];
  const key = state.history.length + '|' + (last ? last.id : '');
  if(lastQtyCache.key !== key){
    const map = {}, at = {};
    state.history.forEach(h=>{
      const when = Date.parse(h.date) || 0;
      (h.entries||[]).forEach(e=>(e.items||[]).forEach(it=>{
        if(!(it.itemId in at) || when >= at[it.itemId]){ at[it.itemId] = when; map[it.itemId] = it.qty; }
      }));
    });
    lastQtyCache = {key, map};
  }
  return lastQtyCache.map;
}

/* A screen's large title, under the date, with Search beside it (it finds anything in the app). */
function renderPageHeading(){
  const now = new Date(), date = formatIraqDateTime(now, {weekday:'long', day:'numeric', month:'long'});
  return `<header class="page-heading"><time class="page-eyebrow page-date" datetime="${erbilDate(now)}">${esc(date)}</time><div class="page-title-row"><h1>${esc(viewLabel(state.view))}</h1><button type="button" class="heading-search" data-spotlight aria-label="${esc(t('spotTitle'))}" aria-keyshortcuts="Control+K Meta+K /">${ICON_SEARCH}</button></div></header>`;
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
   A translucent bar over the page, like an iPhone app's: the ricotta mark,
   the streak, "Offline" only while the connection is down, and the account
   button (the person's initial) that holds the language and Sign Out. */
const accountInitial = ()=>accountLabel(state.account).trim().charAt(0).toUpperCase();
function renderTopbar(){
  return `
  <header class="topbar">
    <div class="brand-slot"><div class="brand" aria-label="Ricotta Orders"><span class="brand-mark">ricotta</span><span class="dot"></span></div></div>
    <span class="topbar-title" aria-hidden="true"></span>
    <div class="topbar-actions">
      ${renderStreakChip()}
      <div class="chip conn-chip" id="connectionStatus" role="status"${state.apiOnline?' hidden':''}><span></span><em>${esc(t('offline'))}</em></div>
      ${canOpen('assistant') ? `<button type="button" class="rico-top" id="ricoTopBtn" aria-label="${esc(t('ricoName'))}">${ICON_SPARKLE}<span class="rico-top-name">${esc(t('ricoName'))}</span><i class="rico-badge" hidden></i></button>` : ''}
      <button type="button" class="account-btn" id="accountBtn" aria-haspopup="dialog" aria-label="${esc(t('accountMenu')(accountLabel(state.account)))}">${esc(accountInitial())}</button>
    </div>
  </header>`;
}
/* The account sheet: who is signed in, the language, Settings, the privacy
   policy and Sign Out, as grouped rows like the iPhone's own account page. */
function privacyHref(){ return 'privacy.html#' + state.lang; }
function openAccountSheet(){
  const chevron = `<i class="sheet-chevron" aria-hidden="true"></i>`;
  const sheet = openKitchenSheet('account-sheet', `
    <div class="account-head"><span class="account-mono" aria-hidden="true">${esc(accountInitial())}</span><div><b>${esc(accountLabel(state.account))}</b><small>Ricotta Orders</small></div></div>
    <div class="sheet-group">
      <button type="button" class="sheet-row" id="langBtn" aria-haspopup="dialog">${ICON_GLOBE}<span>${esc(t('language'))}</span><em>${esc(LANG_NAMES[state.lang])}</em>${chevron}</button>
      ${canOpen('settings') ? `<button type="button" class="sheet-row" data-account-go="settings">${NAV_ICONS.settings || ''}<span>${esc(t('settings'))}</span>${chevron}</button>` : ''}
      <a class="sheet-row" href="${esc(privacyHref())}">${ICON_SHIELD}<span>${esc(t('privacyPolicy'))}</span>${chevron}</a>
    </div>
    <div class="sheet-group"><button type="button" class="sheet-row danger" id="logoutBtn">${ICON_LOGOUT}<span>${esc(t('logout'))}</span></button></div>`, t('accountMenu')(accountLabel(state.account)));
  const el = sheet.el;
  el.querySelector('#langBtn').onclick = ()=>{ sheet.close(); openLangMenu(document.getElementById('accountBtn')); };
  el.querySelector('[data-account-go]')?.addEventListener('click', ()=>{ sheet.close(); goView('settings'); });
  el.querySelector('#logoutBtn').onclick = ()=>{ sheet.close(); doLogout(); };
  requestAnimationFrame(()=>el.querySelector('#langBtn')?.focus({preventScroll:true}));
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
  // Opened near the bottom of the screen (the phone sign-in), the menu opens upwards.
  const menu = layer.querySelector('.lang-menu'), h = menu.offsetHeight;
  if(r.bottom + 8 + h > window.innerHeight - 8){ menu.style.top = Math.max(8, r.top - 8 - h)+'px'; menu.classList.add('up'); }
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

/* Events on the top bar and tab bar (bound once, when they are built). */
function attachShellEvents(){
  attachNavEvents();
  document.getElementById('accountBtn').onclick = openAccountSheet;
  const ricoBtn = document.getElementById('ricoTopBtn');
  if(ricoBtn){
    ricoBtn.onclick = ()=>goView('assistant');
    ricoBtn.addEventListener('animationend', e=>{ if(e.target === ricoBtn) ricoBtn.classList.remove('reacting'); });
  }
  document.getElementById('streakChip').onclick = openStreakSheet;
}
function attachNavEvents(){
  const nav = document.querySelector('.bottomnav');
  // Tapping the screen you are on takes it back to the top, like an iPhone tab bar.
  nav.querySelectorAll('[data-view]').forEach(b=>b.onclick = ()=>{ if(b.dataset.view === state.view) scrollToTop(); else goView(b.dataset.view); });
  const more = document.getElementById('navMoreBtn');
  if(more) more.onclick=()=>setMoreOpen(!nav.classList.contains('more-open'));
  const top = document.getElementById('toTopBtn');
  if(top) top.onclick = scrollToTop;
}
/* The tab bar gets out of the way while you read (phones): scrolling down shrinks it to its icons,
   scrolling up or coming back near the top brings the names back. Far down a page, a round button
   beside it goes back to the top. A screen that has just opened (or was put back where it was) starts
   with the full bar. */
let barQuietUntil = 0, barLastY = 0;
function setBarCompact(on){ document.querySelector('.bottomnav')?.classList.toggle('compact', !!on && isPhoneLayout()); }
function quietBar(){ barQuietUntil = performance.now() + 450; barLastY = scrollBox().scrollTop; setBarCompact(false); paintToTop(); }
function paintToTop(){
  const b = document.getElementById('toTopBtn');
  if(!b) return;
  const show = !!state.account && state.view !== 'assistant' && scrollBox().scrollTop > window.innerHeight * 1.2;
  if(b.classList.contains('show') === show) return;
  b.classList.toggle('show', show); b.tabIndex = show ? 0 : -1; b.setAttribute('aria-hidden', String(!show));
}
function scrollToTop(){
  scrollBox().scrollTo({top:0, behavior:reducedMotion() ? 'auto' : 'smooth'});
  setBarCompact(false);
}
document.addEventListener('scroll', e=>{
  if(!state.account) return;
  const box = scrollBox();
  if(e.target !== box && !(box === document.scrollingElement && e.target === document)) return;
  const y = box.scrollTop, d = y - barLastY;
  barLastY = y;
  paintToTop();
  if(performance.now() < barQuietUntil || document.body.classList.contains('page-swiping')) return;
  if(y < 40) setBarCompact(false);
  else if(d > 6) setBarCompact(true);
  else if(d < -10) setBarCompact(false);
}, {passive:true, capture:true});
/* Events inside the page that more than one screen uses. */
function attachContentEvents(){
  attachCatalogSearch();
  document.querySelectorAll('[data-spotlight]').forEach(b=>b.onclick = ()=>openSpotlight());
  document.querySelectorAll('[data-manage-view]').forEach(b=>b.onclick=()=>goView(b.dataset.manageView));
  const pushOn = document.getElementById('pushEnableBtn');
  if(pushOn) pushOn.onclick = async ()=>{
    const res = await enablePush();   // straight from the tap: iOS needs that for the permission prompt
    render();
    await showPushEnableResult(res);
  };
  const pushLater = document.getElementById('pushDismissBtn');
  if(pushLater) pushLater.onclick = ()=>{ snoozePushBanner(); render(); };
  document.querySelectorAll('[data-export]').forEach(b=>b.onclick = ()=>openExportSheet(b.dataset.export));
  // "Record" shortcut buttons on the Suppliers / Items screens: jump to the
  // Record already filtered to that kind of change.
  document.querySelectorAll('[data-gorecord]').forEach(b=>b.onclick = ()=>{
    goView('record'); state.recordFilter = b.dataset.gorecord; render();
  });
}

/* ============ Login ============ */
function loginMessage(){
  if(state.pinBusy) return t('signingIn');
  return ({wrong:t('wrongPin'), locked:t('tooManyAttempts'), network:t('loadFailed'), verification:t('securityCheckFailed'), device:t('deviceInUse'), session:state.sessionMsg})[state.pinError] || '';
}
const LOGIN_ERRORS = ['wrong','locked','network','verification'];
/* The sign-in. A phone: Ricotta's street in green at the top with the date and Directions, then a white
   (or black) sheet with "Sign in", six boxes and number keys that answer the moment a finger lands.
   A computer: the green map fills one half and the other half holds only the six boxes; the PIN is typed
   on the keyboard and Esc clears it. A tablet keeps the keys. The message under "Sign in" says what to
   do, "Signing in…", or what went wrong. */
function renderLogin(){
  const date = esc(formatIraqDateTime(new Date(), {weekday:'long', day:'numeric', month:'long'}));
  const key = k=>`<button type="button" class="key" data-key="${k}">${k}</button>`;
  return `
  <div class="login-wrap">
    <section class="login-map rmap green" id="loginMap" aria-label="${esc(t('mapLabel'))}">
      ${ricottaMapWorld({label:true})}
      <div class="login-map-shade" aria-hidden="true"></div>
      <div class="login-map-top">
        <div class="login-word" dir="ltr" aria-label="Ricotta">ricotta<i aria-hidden="true"></i></div>
        <p class="login-date map-glass">${date}</p>
        <button type="button" class="map-recenter map-glass" aria-label="${esc(t('mapRecenter'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5 3.7 10.6c-.8.3-.7 1.5.2 1.7l6.6 1.2 1.2 6.6c.2.9 1.4 1 1.7.2Z"/></svg></button>
      </div>
      <div class="login-map-foot">
        <h2 class="login-tagline">${esc(t('loginTagline'))}</h2>
        <div class="login-place"><span>${esc(t('ricottaPlace'))}</span>${mapDirections('map-glass')}</div>
      </div>
      ${mapCredit()}
    </section>
    <main class="login-panel">
      <p class="login-date login-date-side">${date}</p>
      <div class="login-card">
        <h1 class="login-title">${esc(t('loginTitle'))}</h1>
        <p class="login-sub" id="pinLabel" aria-live="polite"></p>
        <div class="pin-field">
          <div class="pin-boxes" role="img" aria-labelledby="pinLabel" aria-describedby="pinCount"><span class="sr-only" id="pinCount"></span>${'<span class="pin-box"><i></i></span>'.repeat(MAX_PIN_LEN)}</div>
          <input class="pin-input" id="pinInput" type="password" inputmode="numeric" autocomplete="off" maxlength="${MAX_PIN_LEN}" aria-label="${esc(t('loginEnterPin'))}" aria-describedby="pinCount">
        </div>
        <p class="login-hint">${esc(t('loginKeysHint')).replace('Esc', '<kbd>Esc</kbd>')}</p>
      </div>
      <div class="keypad" role="group" aria-label="${esc(t('loginEnterPin'))}">
        ${['1','2','3','4','5','6','7','8','9'].map(key).join('')}
        <button type="button" class="key plain" data-key="clear">${esc(t('clear'))}</button>${key('0')}
        <button type="button" class="key plain" data-key="back" aria-label="${esc(t('deleteDigit'))}"><svg width="24" height="18" viewBox="0 0 26 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M8 1h15a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8L1 10Z"/><path d="m12 6.5 7 7M19 6.5l-7 7"/></svg></button>
      </div>
      <footer class="login-foot">
        <button type="button" class="login-lang" id="loginLangRow" aria-haspopup="dialog" aria-label="${esc(t('language'))}">${ICON_GLOBE}<span>${LANG_NAMES[state.lang]}</span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <a class="login-privacy" href="${esc(privacyHref())}">${esc(t('privacyPolicy'))}</a>
      </footer>
    </main>
  </div>`;
}
/* The boxes fill in as digits are typed and the next one waits with a green ring; they shake and turn
   red on a wrong PIN and ripple while the PIN is checked. */
function updateLoginFeedback(){
  const boxes = document.querySelector('.pin-boxes');
  if(!boxes) return;
  const n = state.pinBuffer.length, bad = LOGIN_ERRORS.includes(state.pinError), msg = loginMessage();
  boxes.classList.toggle('err', bad);
  boxes.classList.toggle('busy', state.pinBusy);
  boxes.querySelectorAll('.pin-box').forEach((box, i)=>{
    box.classList.toggle('filled', i < n);
    box.classList.toggle('on', !state.pinBusy && !bad && i === n);
  });
  document.getElementById('pinCount').textContent = t('pinTyped')(n, MAX_PIN_LEN);
  const sub = document.getElementById('pinLabel');
  sub.textContent = msg || t('loginPinSub');
  sub.classList.toggle('err', !!msg && !state.pinBusy && state.pinError !== 'session');   // "Signing in…" is not an error
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
  if(res.error){
    state.pinError = res.error==='cancelled'?'':res.error; updateLoginFeedback();
    if(LOGIN_ERRORS.includes(state.pinError)) haptic('error');
    setTimeout(()=>{ state.pinBuffer=''; if(!state.account) updateLoginFeedback(); }, 650);
    return;
  }
  await completeSignIn(res);
}
/* After the PIN: "Welcome back, Yunis" covers the workspace while it loads, then lifts. */
async function completeSignIn(res){
  state.pinBuffer = ''; state.pinError = ''; state.view = 'order';
  showWelcome(accountLabel(res.account));
  applyAccount(res);
  const ok = await loadData();
  // A start that fails half-way also ends the sign-in on the server, so it never stays behind on this browser.
  if(!ok){ hideWelcome(0); api('logout', {method:'POST'}); signOut(); state.pinError = 'network'; render(); return; }
  restoreCartDraft(); restoreQueue();
  render();
  maybeFinishQueue();
  hideWelcome();
  heartbeat();
  liveStart();
  if(pushStatus.subscribed) resyncPush();
}
function attachLoginEvents(){
  updateLoginFeedback();
  const lang = document.getElementById('loginLangRow');
  if(lang) lang.onclick = e=>{ e.stopPropagation(); openLangMenu(lang); };
  // A key answers the moment the finger lands on it (a light tick), like the iPhone's passcode pad: it
  // turns green and dips a little, and springs back when the finger lifts.
  document.querySelectorAll('[data-key]').forEach(b=>{
    b.onpointerdown = e=>{ if(e.button > 0 || b.disabled) return; e.preventDefault(); b.classList.add('down'); haptic('light'); pressKey(b.dataset.key); };
    b.onpointerup = b.onpointerleave = b.onpointercancel = ()=>b.classList.remove('down');
    b.onclick = e=>{ if(e.detail === 0) pressKey(b.dataset.key); };   // Enter or Space on a focused key
  });
  // On a computer the boxes hold a hidden field, so the PIN can be typed (or pasted) straight away.
  const pin = document.getElementById('pinInput');
  if(pin){
    pin.oninput = ()=>{ const digits = pin.value.replace(/\D/g, ''); pin.value = ''; [...digits].forEach(d=>pressKey(d)); };
    if(pin.offsetParent && matchMedia('(hover:hover) and (pointer:fine)').matches) pin.focus({preventScroll:true});
  }
  const wide = matchMedia('(min-width:960px)').matches;
  attachMapDrag(document.getElementById('loginMap'), wide ? {limit:{x:140, y:110}, springBack:false} : {limit:{x:90, y:60}, springBack:true});
}
/* Physical keyboards (computers, tablets with a keyboard) type the PIN; the hidden field stays empty. */
document.addEventListener('keydown', e=>{
  if(state.account || e.ctrlKey || e.metaKey || e.altKey) return;
  if(document.querySelector('#modalRoot .modal-overlay') || document.getElementById('langLayer')) return;
  const k = /^[0-9]$/.test(e.key) ? e.key : ({Backspace:'back', Escape:'clear'})[e.key];
  if(!k || !document.querySelector('.pin-boxes')) return;
  e.preventDefault();
  pressKey(k);
});

/* ============ Order screen ============ */
/* Search text the way a person reads it: Kurdish written with Arabic letters still matches (تةمـاتة finds تەماتە).
   Fold look-alike letters so names can be found consistently. */
const FOLD_TEXT = [[/[ً-ٰٟـ​-‏‪-‮⁦-⁩﻿]/g, ''], [/[أإآٱ]/g, 'ا'],
  [/[يىێ]/g, 'ی'], [/[كگ]/g, 'ک'], [/[ةەھہ]/g, 'ه'], [/[ۆۇۊؤ]/g, 'و'],
  [/ڵ/g, 'ل'], [/ڕ/g, 'ر'], [/پ/g, 'ب'], [/چ/g, 'ج'], [/ژ/g, 'ز'], [/ڤ/g, 'ف'],
  [/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)], [/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0)]];
function foldText(s){ return FOLD_TEXT.reduce((t, [re, to]) => t.replace(re, to), String(s ?? '').normalize('NFKC')).toLocaleLowerCase(); }
/* A unit has one name, written in any language, and shows as written everywhere. */
function unitName(u){ return u ? u.en : ''; }
function unitLabel(unitId){ return unitName(state.units.find(x=>x.id===unitId)); }
function supplierName(id){
  const s = state.suppliers.find(x=>x.id===id);
  return s ? s.name : t('noSupplier');
}
const nameCollators = new Map();
function nameCollator(){
  const lang = LANGS.includes(state.lang) ? state.lang : 'en';
  if(!nameCollators.has(lang)) nameCollators.set(lang, new Intl.Collator(({en:'en', ku:'ckb', ar:'ar'})[lang], {sensitivity:'base', numeric:true}));
  return nameCollators.get(lang);
}
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
    <div class="hero-footer"><span class="draft-state">${selCount?draftProgressLabel():t('selectToStart')}</span></div>
  </div>`;
}
/* A small monogram tile for a supplier (first letter, deep green). */
function supplierMono(name){
  const ch = Array.from(String(name||'').trim())[0] || '·';
  return `<span class="supplier-mono" aria-hidden="true">${esc(ch.toLocaleUpperCase())}</span>`;
}
function renderOrderArrangeControl(){
  return canDo('catalog') && state.orderTab!=='all' && state.orderTab!=='__none'
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
    <div id="sharedDraftStatus">${draftStatusHtml()}</div>
    ${renderOrderHero(selectedCount, selectedSupplierCount)}
    <div id="ricoSuggest">${renderRicoSuggestion()}</div>
    <div class="order-quick-actions">
      ${lastMap ? `<button class="quick-btn" id="sameAsLast">${ICON_REPEAT}<span>${t('sameAsLastTime')}</span></button>` : ''}
      <button class="quick-btn clear-order-btn" id="clearOrderBtn" ${cartCount()===0?'disabled':''}>${ICON_DELETE}<span>${t('clearOrder')}</span></button>
    </div>
    ${tabsHtml}
    <div class="search-row">
      <div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itemSearch" aria-label="${t('searchPlaceholder')}" placeholder="${t('searchPlaceholder')}" value="${esc(state.search)}"><button type="button" class="search-clear" id="itemSearchClear" aria-label="${esc(t('clearSearch'))}" ${state.search?'':'hidden'}>&times;</button></div>
      <div class="order-arrange-row" id="orderArrangeRow">${renderOrderArrangeControl()}</div>
    </div>
    <div id="orderResults" aria-live="polite">${groupHtml || emptyState(t('noSearchResults'))}</div>
  `;
}
/* Search only replaces this result region; rebuilding #app on each keystroke
   was the cause of the apparent page refresh on phones. */
function renderOrderResults(){
  const lastQty = prefOn('showLastQty') ? lastQtyMap() : null;
  const q = foldText(state.search.trim());
  const tabFiltered = state.orderTab==='all'
    ? state.items
    : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab);
  const availableItems = tabFiltered.filter(i=>i.available!==false);
  const visibleItems = q ? globalThis.RicottaSearch.rank(availableItems,state.search,itemSearchFields) : availableItems;
  // Favourites lead the list (in a supplier's tab too) and are not repeated in their supplier's group.
  const pinned = !q ? state.pins.map(id=>tabFiltered.find(i=>i.id===id)).filter(i=>i && i.available!==false) : [];

  const groups = Object.create(null);
  visibleItems.forEach(i=>{
    const key = i.supplierId || '__none';
    (groups[key] = groups[key]||[]).push(i);
  });
  const groupHtml = Object.keys(groups).sort((a,b)=>nameCollator().compare(a==='__none'?t('noSupplier'):supplierName(a), b==='__none'?t('noSupplier'):supplierName(b))).map(key=>{
    const label = key==='__none' ? t('noSupplier') : supplierName(key);
    const rows = (q?groups[key]:sortedSupplierItems(groups[key]).filter(i=>!pinned.some(p=>p.id===i.id))).map(i=>itemRowHtml(i, lastQty)).join('');
    return state.orderTab==='all' ? `<div class="supplier-group">
      <div class="supplier-head"><span class="supplier-heading-name">${supplierMono(label)}${esc(label)}<span class="supplier-item-count">${groups[key].length}</span></span></div>
      ${key!=='__none' && cutoffChip(key) ? `<div class="cut-row">${cutoffChip(key)}</div>` : ''}
      <div class="supplier-items-grid">${rows}</div>
    </div>` : `${key!=='__none' && cutoffChip(key) ? `<div class="cut-row">${cutoffChip(key)}</div>` : ''}<div class="supplier-items-grid standalone">${rows}</div>`;
  }).join('');

  const pinnedHtml = pinned.length ? `<div class="supplier-group pinned-group">
      <div class="supplier-head"><span class="supplier-heading-name"><span class="supplier-mono pin-mono" aria-hidden="true">${ICON_PIN}</span>${esc(t('pinnedTitle'))}<span class="supplier-item-count">${pinned.length}</span></span></div>
      <div class="supplier-items-grid">${pinned.map(i=>itemRowHtml(i, lastQty)).join('')}</div>
    </div>` : '';
  return groupHtml ? pinnedHtml + groupHtml : groupHtml;
}
/* One item on the Order screen: name, unit, its note, and - / quantity / +. A pinned item shows twice
   (Pinned and its supplier); both rows share the same quantity. */
function itemRowHtml(i, lastQty){
  const qty = state.cart[i.id] || 0;
  return `
      <div class="item-row ${qty>0?'has-qty':''}" data-item-id="${esc(i.id)}">
        <div class="item-info">
          <div class="item-name">${state.pins.includes(i.id) ? `<span class="item-pin" aria-hidden="true">${ICON_PIN}</span>` : ''}${esc(i.name)}</div>

          <div class="item-unit">${esc(unitLabel(i.unit))}${lastQty && lastQty[i.id] ? ` · <span class="item-last">${esc(t('lastQty')(lastQty[i.id]))}</span>` : ''}${i.note ? ` · <span class="item-note" dir="auto">“${esc(i.note)}”</span>` : ''}</div>
        </div>
        <div class="stepper">
          <button class="step-btn" data-dec="${esc(i.id)}" aria-label="${esc(t('decreaseQty')(i.name))}" ${qty>0?'':'disabled'}>−</button>
          <input class="qty-input" type="number" inputmode="decimal" step="0.001" min="0" max="${MAX_QTY}" value="${qty}" aria-label="${esc(t('quantityFor')(i.name))}" data-qty="${esc(i.id)}">
          <button class="step-btn" data-inc="${esc(i.id)}" aria-label="${esc(t('increaseQty')(i.name))}">+</button>
        </div>
      </div>`;
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
  const quantitySelector = pulseItemId ? `#orderResults [data-qty="${CSS.escape(pulseItemId)}"]` : '#orderResults [data-qty]';
  document.querySelectorAll(quantitySelector).forEach(input=>{
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
    send.disabled = c === 0 || !canDo('send');
    send.querySelector('.send-meta').textContent = sendMeta();
  }
  const clear=document.getElementById('clearOrderBtn');
  if(clear) clear.disabled=c===0;
  const draft=document.querySelector('.draft-state');
  if(draft) draft.textContent=c?draftProgressLabel():t('selectToStart');
  paintRicoSuggestion();
}
/* The most of one item a single order can hold (the server refuses more). */
const MAX_QTY = 99999;
function cartCount(){ return Object.values(state.cart).filter(q=>q>0).length; }
function sendMeta(){
  const c = cartCount();
  const sups = new Set(Object.keys(state.cart).filter(id=>state.cart[id]>0).map(id=>(state.items.find(i=>i.id===id)||{}).supplierId||'__none')).size;
  return c ? `${t('itemsSelected')(c)} · ${t('supplierCount')(sups)}` : '';
}
function renderOrderBottomBar(){
  const c = cartCount();
  // Without the send role the draft is still made here and shared; Rozha sends it.
  const label = canDo('send') ? t('sendOrders') : t('sendNoAccess');
  return `<div class="bottom-bar ${c>0?'show':''}">
    <button class="send-btn" id="sendOrdersBtn" ${c===0 || !canDo('send')?'disabled':''}>
      <span class="send-text"><span class="send-label">${esc(label)}</span><span class="send-meta">${sendMeta()}</span></span>
      <span class="send-go" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span>
    </button>
  </div>`;
}
function attachOrderEvents(){
  paintDraftStatus();
  document.querySelectorAll('[data-ordertab]').forEach(b=>b.onclick=()=>{
    if(state.orderTab===b.dataset.ordertab) return;
    tabMemory.set(state.orderTab, scrollBox().scrollTop);
    state.orderTab = b.dataset.ordertab;
    document.querySelectorAll('[data-ordertab]').forEach(tab=>{
      const active=tab.dataset.ordertab===state.orderTab;
      tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));
    });
    const arrange=document.getElementById('orderArrangeRow');
    arrange.innerHTML=renderOrderArrangeControl();
    attachOrderResultEvents(arrange);
    refreshOrderResults();refreshCartSummary();
    if(tabMemory.has(state.orderTab)) scrollBox().scrollTop = tabMemory.get(state.orderTab);
    animateUi(document.getElementById('orderResults'),[{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'none'}]);
  });
  const search = document.getElementById('itemSearch');
  document.getElementById('itemSearchClear')?.addEventListener('click',()=>{state.search='';search.value='';document.getElementById('itemSearchClear').hidden=true;refreshOrderResults();search.focus();});
  if(search) search.oninput = (e)=>{
    state.search = e.target.value;document.getElementById('itemSearchClear').hidden=!state.search;
    refreshOrderResults();
  };
  attachOrderResultEvents(document.getElementById('orderResults'));
  const tabs=document.getElementById('orderTabs');
  if(tabs){
    // Slides only the strip of supplier tabs (scrollIntoView would also move the page, which lost
    // the remembered place when coming back to Order).
    const centerTab=(pill, smooth)=>{
      const strip=tabs.getBoundingClientRect(), rect=pill.getBoundingClientRect();
      tabs.scrollBy({left:rect.left + rect.width/2 - (strip.left + strip.width/2), behavior:smooth && !reducedMotion() ? 'smooth' : 'auto'});
    };
    const scrollTabs=step=>{
      const pills=[...tabs.querySelectorAll('.tab-pill')];
      if(!pills.length) return;
      const center=tabs.getBoundingClientRect().left+tabs.clientWidth/2;
      let index=0, distance=Infinity;
      pills.forEach((pill,i)=>{const rect=pill.getBoundingClientRect();const d=Math.abs(rect.left+rect.width/2-center);if(d<distance){distance=d;index=i;}});
      centerTab(pills[Math.max(0,Math.min(pills.length-1,index+step))], true);
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
    const active=tabs.querySelector('.tab-pill.active');
    if(active) centerTab(active, false);
  }
  attachOrderResultEvents(document.getElementById('orderArrangeRow'));
  const same = document.getElementById('sameAsLast');
  // Replaces the current order with the last one sent; Undo brings back what was there.
  if(same) same.onclick = ()=>{
    const m = lastOrderMap();
    if(!m) return;
    const before = {...state.cart};
    state.cart = Object.fromEntries(Object.entries(m).filter(([id,qty])=>state.items.some(i=>i.id===id && i.available!==false) && qty>0));
    refreshOrderView();
    ricoReact();
    toast(t('sameAsLastFilled'), 'ok', {undo:()=>{ state.cart = before; refreshOrderView(); }});
  };
  const clear=document.getElementById('clearOrderBtn');
  if(clear) clear.onclick=()=>{
    const before={...state.cart};
    // A cleared order starts over. An order being saved right now is kept; one whose save failed can be
    // cleared too (a save the server refuses would otherwise reopen on every Send), and Undo brings it back.
    const queue=state.queue?.record && state.queue.saveState!=='failed' ? null : state.queue;
    state.cart={};persistCartDraft();if(queue){state.queue=null;persistQueue();}refreshOrderView();paintDraftStatus();
    ricoReact('down');
    toast(t('orderCleared'),'ok',{undo:()=>{ state.cart=before;persistCartDraft();paintDraftStatus(); if(queue&&!state.queue){state.queue=queue;persistQueue();} refreshOrderView(); }});
  };
  const send = document.getElementById('sendOrdersBtn');
  if(send) send.onclick = ()=>startSendQueue();
  const options=document.querySelector('.order-options');
  options?.addEventListener('toggle',()=>{if(options.open)loadRicoSuggestion();});
}
/* Opens Send to suppliers with the current draft (the Send button, and
   Rico's "open send" shortcut). Returns false when there is nothing to send. */
async function startSendQueue(){
  if(!canDo('send')){ toast(t('sendNoAccess'), 'warn'); return false; }
  if(sharedDraft.conflicts.length){ toast(t('draftConflict')); return false; }
  // An order that is already being saved (or failed to save) is finished first.
  if(state.queue?.record){ goView('queue'); return true; }
  const bySupplier = Object.create(null);
  Object.keys(state.cart).forEach(id=>{
    const qty = state.cart[id]; if(!qty) return;
    const item = state.items.find(i=>i.id===id); if(!item || item.available===false) return;
    const sid = item.supplierId || '__none';
    (bySupplier[sid] = bySupplier[sid]||[]).push({itemId:id, name:item.name, qty, unit:item.unit, sortOrder:item.sortOrder});
  });
  // Not a hard block -- ordering twice in a day can be intentional -- just
  // make sure it's not an accident before it goes out again.
  const already = Object.keys(bySupplier).filter(sid=>sid!=='__none' && sentToSupplierToday(sid));
  if(already.length){
    const names = already.map(sid=>(state.suppliers.find(s=>s.id===sid)||{}).name).filter(Boolean).join(', ');
    if(!(await showConfirm(t('confirmDoubleOrder')(names), {okLabel: t('sendAnother'), okClass: 'btn-primary'}))) return false;
  }
  if(!Object.keys(bySupplier).length) return false;
  // Going back to Order and pressing Send again keeps the suppliers already sent (same items, same amounts):
  // starting over made the order look unsent, and it never reached History.
  const before = state.queue && Date.now() - state.queue.at < QUEUE_KEEP_MS ? state.queue : [];
  state.queue = Object.keys(bySupplier).map(sid=>{
    const old = before.find(e=>e.supplierId===sid);
    return {supplierId: sid, items: bySupplier[sid], sent: !!(old && old.sent && sameQueueItems(old.items, bySupplier[sid]))};
  });
  state.queue.at = Date.now();
  persistQueue();
  goView('queue');
  if(state.queue.every(e=>e.sent)) maybeFinishQueue();
  return true;
}
const sameQueueItems = (a, b)=>{
  const key = list=>list.map(i=>i.itemId+'='+i.qty).sort().join();
  return key(a) === key(b);
};
/* The send queue is kept on this phone (per account) until the order is saved. An iPhone can close the app
   while WhatsApp is open; without this the suppliers already sent were forgotten and the order never
   reached History. A queue left unfinished for 3 hours is dropped (the order itself stays as a draft). */
const QUEUE_KEEP_MS = 3*60*60*1000;
function persistQueue(){
  if(!state.account) return;
  const q = state.queue;
  lset('sendQueue:'+state.account, q ? {
    at: q.at || Date.now(), record: q.record || null, saveState: q.saveState === 'failed' ? 'failed' : null,
    entries: q.map(e=>({supplierId:e.supplierId, items:e.items, sent:!!e.sent}))
  } : null);
}
function restoreQueue(){
  if(!state.account || state.queue) return false;
  const saved = lget('sendQueue:'+state.account);
  if(!saved) return false;
  const entries = Array.isArray(saved.entries) ? saved.entries.filter(e=>e && typeof e.supplierId === 'string' && Array.isArray(e.items) && e.items.length) : [];
  const done = saved.record && state.history.some(h=>h.id===saved.record.id);
  if(done){
    // Saved before the app closed: the draft it came from is finished too.
    entries.forEach(e=>e.items.forEach(item=>{ if(state.cart[item.itemId] === item.qty) delete state.cart[item.itemId]; }));
    persistCartDraft();
  }
  if(!entries.length || done || !(Date.now() - Number(saved.at) < QUEUE_KEEP_MS)){ lset('sendQueue:'+state.account, null); return false; }
  const queue = entries.map(e=>({supplierId:e.supplierId, items:e.items, sent:!!e.sent}));
  queue.at = Number(saved.at);
  if(saved.record && typeof saved.record.id === 'string'){ queue.record = saved.record; queue.saveState = 'failed'; }
  state.queue = queue;
  state.view = 'queue';
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
    const id=inp.dataset.qty; const v=Math.min(MAX_QTY, Math.max(0, readQuantity(inp.value))); state.cart[id]=v; refreshOrderView(id);
  });
  root.querySelectorAll('[data-qty]').forEach(inp=>inp.oninput=()=>{
    const id=inp.dataset.qty; state.cart[id]=inp.value===''?0:Math.min(MAX_QTY, Math.max(0,readQuantity(inp.value)));
    persistCartDraft();
    inp.closest('.item-row').classList.toggle('has-qty',state.cart[id]>0);
    inp.closest('.item-row').querySelector('[data-dec]').disabled=state.cart[id]===0;
    refreshCartSummary();
  });
}

/* ============ Order: steppers, press-and-hold menu, Rico suggests ============ */
/* One step up or down, from a tap, a held button or the keyboard. */
function stepQty(btn){
  playQtyTick(!!btn.dataset.inc);
  const id = btn.dataset.inc || btn.dataset.dec;
  if(!id) return;
  const next = btn.dataset.inc ? Math.min(MAX_QTY, (state.cart[id]||0)+1) : Math.max(0,(state.cart[id]||0)-1);
  if(next === (state.cart[id]||0)) return;
  haptic('selection');
  const first = next > 0 && !cartCount();
  state.cart[id] = next;
  refreshOrderView(id);
  if(first) ricoReact();
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
  const actions = [[1,t('cmAdd')(1),ICON_PLUS],[5,t('cmAdd')(5),ICON_PLUS],[10,t('cmAdd')(10),ICON_PLUS],['type',t('cmType'),ICON_EDIT],
    ['pin', state.pins.includes(id) ? t('unpinItem') : t('pinItem'), ICON_PIN]];
  if(canDo('catalog')) actions.push(['note', t('itemNoteEdit'), ICON_NOTE], ['edit', t('editItem'), ICON_EDIT_ITEM]);
  if(qty) actions.push(['remove',t('cmRemove'),ICON_DELETE]);
  haptic('medium');
  const menuH = actions.length*44 + 16, below = rect.bottom + 12 + menuH < window.innerHeight - 90;
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
    if(a === 'pin'){ togglePin(id); return; }
    if(a === 'note'){ editItemNote(id); return; }
    if(a === 'edit'){ openItemModal(id); return; }
    if(a === 'remove'){
      state.cart[id] = 0; refreshOrderView(id);
      toast(t('itemRemoved'), 'ok', {undo:()=>{ state.cart[id] = before; refreshOrderView(id); }});
      return;
    }
    state.cart[id] = Math.min(MAX_QTY, before + Number(a)); refreshOrderView(id);
  });
}

/* Pinned items sit at the top of the Order screen (kept per account on the server). */
async function togglePin(id){
  const before = state.pins.slice();
  // Items deleted since they were pinned are dropped, so they don't keep using up the 60 places.
  const kept = before.filter(x=>x !== id && state.items.some(i=>i.id === x));
  state.pins = before.includes(id) ? kept : [id, ...kept].slice(0, 60);
  refreshOrderResults();
  const r = await api('me/pins', {method:'PUT', body:{itemIds:state.pins}});
  if(!r.ok){ state.pins = before; refreshOrderResults(); toast(t('saveFailed'), 'error'); }
}
/* A short note on an item, sent with it in the WhatsApp message. */
async function editItemNote(id){
  const i = state.items.find(x=>x.id === id);
  if(!i) return;
  const note = await showPrompt(`<b>${esc(i.name)}</b><br>${esc(t('itemNoteHint'))}`, {value:i.note || '', placeholder:t('itemNoteLabel'), okLabel:t('save'), maxLength:120});
  if(note === null) return;
  const before = i.note || '';
  const next = {...i, note:String(note).trim().slice(0, 120)};
  if(next.note === before) return;
  if(!(await saveRecord('items', next))){ await showAlert(t('saveFailed')); return; }
  Object.assign(i, next);
  logActivity({action:'edit', type:'item', name:i.name, fields:[{k:'note', from:before, to:next.note}]});
  refreshOrderResults();
  toast(t('savedMsg')(i.name));
}

/* "Rico suggests": today's most due supplier with its usual items, worked
   out on the server from order history (no AI call). Loaded quietly after
   the Order screen appears and cached for a few minutes. */
const ricoSuggestion = {data:null, at:0, busy:false};
const RICO_SUGGEST_TTL = 4*60*1000;
function ricoSuggestionKey(sg){ return sg ? erbilNow().date+'|'+sg.supplierId : ''; }
function currentRicoSuggestion(){
  if(!canOpen('assistant')) return null;
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
    sg.lines.forEach(l=>{ state.cart[l.itemId] = Math.max(state.cart[l.itemId]||0, Math.max(1, roundQuantity(Number(l.qty)||1))); });
    persistCartDraft(); refreshOrderView();
    const name = (state.suppliers.find(s=>s.id===sg.supplierId)||{}).name || sg.supplier;
    toast(t('ricoSuggestAdded')(sg.lines.length, '\u2068'+name+'\u2069'), 'ok', {undo:()=>{ state.cart = before; persistCartDraft(); refreshOrderView(); }});
  };
  if(hide) hide.onclick = ()=>{ lset('ricoSuggestHidden', ricoSuggestionKey(ricoSuggestion.data)); paintRicoSuggestion(); };
}
async function loadRicoSuggestion(){
  paintRicoSuggestion();
  if(!canOpen('assistant') || ricoSuggestion.busy || Date.now() - ricoSuggestion.at < RICO_SUGGEST_TTL) return;
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
  const noteOf = i => (state.items.find(x=>x.id === i.itemId) || {}).note;
  const lines = sortedSupplierItems(entry.items).map(i=>`• ${i.name}: ${i.qty} ${unitLabel(i.unit)}${noteOf(i) ? ` (${noteOf(i)})` : ''}`);
  const header = ({en:'New order from Ricotta:', ku:'داواکارییەکی نوێ لە چێشتخانەی ریکۆتا:', ar:'طلب جديد من مطبخ ريكوتا:'})[state.lang];
  return [header, lines.join('\n')].join('\n');
}
/* WhatsApp wants the full international number without + or 00. Iraqi numbers
   written the local way (0750 123 4567 or 750 123 4567) get +964; a number
   that is already international (+964…, 00964…, or another country) is kept.
   Digits typed on a Kurdish or Arabic keyboard (٠٧٥٠…, ۰۷۵۰…) count as 0750…. */
function waLink(phone, text){
  const raw = String(phone || '').trim().replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6F0);
  let p = raw.replace(/[^0-9]/g,'');
  if(p.startsWith('00')) p = p.slice(2);
  else if(raw.startsWith('+') || p.startsWith('964')){ /* already international */ }
  else if(p.startsWith('0')) p = '964' + p.slice(1);
  else p = '964' + p;
  // Phones open the WhatsApp app itself (wa.me first shows a "Continue to chat" web page);
  // a computer keeps the web link, since the WhatsApp app may not be installed there.
  return waOpensApp() ? `whatsapp://send?phone=${p}&text=${encodeURIComponent(text)}` : `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function waOpensApp(){ return isIOS() || /Android/i.test(navigator.userAgent); }
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
      // A plain link, not window.open: the iPhone always hands a tapped wa.me link to WhatsApp, while
      // opening it from script could fail on one iPhone and work on another.
      ? `<a class="wa-btn ${e.sent?'done':''}" data-send="${idx}" href="${esc(waLink(sup.phone, buildMessage(e)))}"${waOpensApp() ? '' : ' target="_blank" rel="noopener noreferrer"'}>${ICON_CHAT}${e.sent?t('sentSendAgain'):t('sendVia')}</a>`
      : `<button class="wa-btn ${e.sent?'done':''}" data-marksent="${idx}" ${e.sent?'disabled':''}>${e.sent?t('sent'):t('markSent')}</button>`;
    return `<div class="queue-card ${e.sent?'sent':''}">
      <div class="queue-top"><span class="queue-name">${supplierMono(name)}${esc(name)}${e.sent ? '' : cutoffChip(e.supplierId)}</span>${e.sent?`<span class="queue-badge">${ICON_CHECK}${t('sent')}</span>`:`<span class="queue-count">${t('itemCount')(e.items.length)}</span>`}</div>
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
  state.queue.at = Date.now();
  persistQueue();
  render();
  maybeFinishQueue();
}
function attachQueueEvents(){
  const retry = document.getElementById('queueRetrySave');
  if(retry) retry.onclick = ()=>withBusy(retry, maybeFinishQueue);
  const back = document.getElementById('queueBackBtn');
  if(back) back.onclick = ()=>goView('order');
  // The order sheet is a PDF handed to the share sheet (WhatsApp, Files, Print), so nothing opens in a
  // window without a way back.
  document.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>withBusy(b, async()=>{
    const entry = state.queue?.[parseInt(b.dataset.pdf)]; const supplier = state.suppliers.find(s=>s.id===entry?.supplierId);
    if(!entry) return;
    try{ await orderSheetPdf(entry, supplier); }
    catch(e){ console.error('Order sheet failed', e); await showAlert(esc(t('exportFailed'))); }
  }));
  // The link opens WhatsApp by itself. The supplier is marked sent (and saved on this phone) right away, since
  // the iPhone may pause or close the app as WhatsApp opens; the screen is redrawn a moment later, because
  // removing the link while it is being followed would cancel opening WhatsApp.
  document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>{
    const entry = state.queue && state.queue[parseInt(b.dataset.send)];
    if(!entry) return;
    entry.sent = true;
    state.queue.at = Date.now();
    persistQueue();
    setTimeout(()=>{ if(state.view === 'queue') render(); maybeFinishQueue(); }, 0);
  });
  // Suppliers without a WhatsApp number (or items with no supplier) are sent
  // some other way; without this the queue could never finish and the order
  // was never saved to History.
  document.querySelectorAll('[data-marksent]').forEach(b=>b.onclick=()=>markQueueSent(parseInt(b.dataset.marksent)));
}
let finishingQueue = null;
async function maybeFinishQueue(){
  if(finishingQueue || !state.queue || !state.queue.every(e=>e.sent)) return;
  const queue = state.queue, session = apiSession(), streakBefore = {count:0, lit:false, ...state.streak};
  finishingQueue = queue;
  try{
    const record = queue.record || {
      id: 'o'+outboxJobId(), date: new Date().toISOString(), by: state.account,
      entries: state.queue.map(e=>({
        supplierId: e.supplierId,
        supplierName: (state.suppliers.find(s=>s.id===e.supplierId)||{}).name || '',
        items: e.items.map(i=>({itemId:i.itemId, name:i.name, qty:i.qty, unit:i.unit}))
      }))
    };
    if(!queue.record){try{playOrdersSent();haptic('success');ricoReact();}catch(_){/* Audio must never interrupt saving. */}}
    queue.record = record;
    queue.saveState = 'saving';
    persistQueue();   // the same order id after a restart, so it is never saved twice
    if(state.view === 'queue') render();
    const result = await sendOrQueue('orders', 'POST', record);
    if(!apiSessionMatches(session) || state.queue !== queue) return;
    if(result === 'failed'){
      queue.saveState = 'failed';
      persistQueue();
      if(state.view === 'queue') render();
      toast(t('saveFailed'), 'error');
      return;
    }
    queue.saveState = 'saved';
    lset('sendQueue:'+state.account, null);   // saved (or waiting in the outbox): nothing left to resume
    if(!state.history.some(h=>h.id===record.id)) state.history.push(record);
    // The Catalog check-up knows these items were just ordered (nothing here may stop the save finishing).
    try{ record.entries.forEach(e=>e.items.forEach(it=>{ const item = state.items?.find(i=>i.id === it.itemId); if(item) item.lastOrderedAt = record.date; })); }catch(_){}
    ricoSuggestion.at = 0;
    // Preserve any quantities edited while the save was waiting on the network.
    queue.forEach(entry=>entry.items.forEach(item=>{ if(state.cart[item.itemId] === item.qty) delete state.cart[item.itemId]; }));
    persistCartDraft();
    if(state.view === 'queue') render();
    // Let the "All orders sent" card land before returning to the Order screen.
    await new Promise(r=>setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1300));
    if(!apiSessionMatches(session) || state.queue !== queue) return;
    state.queue = null;
    if(state.view === 'queue') goView('order');
    if(result === 'saved'){
      // Rozha can undo for 15 minutes (also from History); the streak may light up.
      toast(t('orderSavedToHistory'), 'ok', isRozha() ? {undo:()=>undoOrder(record.id)} : {});
      try{ refreshStreak({celebrate:true, before:streakBefore}); }
      catch(error){ console.error('After-order extras failed', error); }   // the order is already saved
    } else toast(result === 'queued' ? t('orderSavedOffline') : t('saveFailed'), 'warn');
  }catch(error){
    // Never leave the order stuck on "saving": offer Retry instead.
    console.error('Saving the order failed', error);
    if(state.queue === queue && queue.saveState !== 'saved'){
      queue.saveState = 'failed';
      persistQueue();
      if(state.view === 'queue') render();
    }
  }finally{
    if(finishingQueue === queue) finishingQueue = null;
  }
}

/* ============ History ============ */
function dayLabel(date){
  const d = new Date(date), today = new Date();
  const yesterday = new Date(today.getTime()-86400000);
  if(erbilDate(d)===erbilDate(today)) return t('today');
  if(erbilDate(d)===erbilDate(yesterday)) return t('yesterday');
  return formatIraqDateTime(d,{weekday:'long',day:'numeric',month:'long'});
}
/* One sent order, read like a receipt: the time, who sent it and how much went out on top; each
   supplier with its items one per line (the name, then the amount); Send Again, Undo and Delete at
   the bottom. */
function orderHistoryCard(rec){
  const time = formatIraqDateTime(rec.date,{hour:'numeric',minute:'2-digit'});
  const lineCount = rec.entries.reduce((n,e)=>n + e.items.length, 0);
  const sections = rec.entries.map(e=>{
    // Prefer the live name; fall back to the name saved with the order (a deleted supplier).
    const live = state.suppliers.find(s=>s.id===e.supplierId);
    const name = live ? live.name : (e.supplierName || t('noSupplier'));
    const lines = e.items.map(i=>`<li><span dir="auto">${esc(i.name)}</span><b dir="auto">${i.qty} ${esc(unitLabel(i.unit))}</b></li>`).join('');
    return `<section class="hist-entry"><div class="hist-supplier">${supplierMono(name)}<span dir="auto">${esc(name)}</span></div><ul class="hist-lines">${lines}</ul></section>`;
  }).join('');
  return `<article class="hist-card" data-order-id="${esc(rec.id)}" data-search-row data-search-text="${esc([rec.date,...rec.entries.flatMap(e=>[state.suppliers.find(s=>s.id===e.supplierId)?.name||e.supplierName||'',...e.items.flatMap(l=>[l.name,...(state.items.find(i=>i.id===l.itemId)?.aliases||[])])])].join(' '))}">
    <div class="hist-top">
      <div class="hist-date"><b>${esc(time)}</b>${accountLabel(rec.by) ? `<span>${esc(t('sentBy')(''))}</span>${whoBadge(rec.by)}` : ''}</div>
      <span class="hist-count">${esc(t('itemCount')(lineCount))}${rec.entries.length > 1 ? ` \u00b7 ${esc(t('supplierCount')(rec.entries.length))}` : ''}</span>
    </div>
    ${sections}
    <div class="hist-actions">
      <button type="button" class="btn btn-ghost hist-again" data-reorderhist="${esc(rec.id)}">${ICON_REPEAT}<span>${esc(t('orderAgain'))}</span></button>
      ${canUndoOrder(rec) ? `<button type="button" class="btn btn-ghost hist-undo" data-undohist="${esc(rec.id)}">${esc(t('undo'))}</button>` : ''}
      ${isRozha() ? `<button type="button" class="icon-btn danger" data-delhist="${esc(rec.id)}" aria-label="${esc(t('delete'))}" title="${esc(t('delete'))}">${ICON_DELETE}</button>` : ''}
    </div>
  </article>`;
}
/* Orders for the current Baghdad calendar month, newest first. */
function renderHistory(){
  const entries = state.history.map(rec=>({ts:Date.parse(rec.date), day:rec.date, html:orderHistoryCard(rec)})).sort((a,b)=>b.ts-a.ts);
  const tools = renderReportCard() + `<div class="hist-tools">
    <button type="button" class="btn btn-ghost" id="monthsBtn">${ICON_CALENDAR}<span>${esc(t('monthsTitle'))}</span></button>
    ${state.account === 'rozha' ? `<button type="button" class="btn btn-ghost" id="ricoOrdersBtn">${ICON_SPARKLE}<span>${esc(t('ricoOrdersTitle'))}</span></button>` : ''}
  </div>`;
  if(!entries.length) return tools + emptyState(t('noHistory'));
  let lastDay = '';
  const cards = entries.map(e=>{
    const day = dayLabel(e.day);
    const heading = day !== lastDay ? `<div class="hist-day">${esc(day)}</div>` : '';
    lastDay = day;
    return heading + e.html;
  }).join('');
  return tools + renderCatalogSearch() + cards;
}
function attachHistoryEvents(){
  document.getElementById('reportOpen')?.addEventListener('click', openReportSheet);
  document.getElementById('monthsBtn')?.addEventListener('click', openMonthsSheet);
  document.getElementById('ricoOrdersBtn')?.addEventListener('click', e=>withBusy(e.currentTarget, openRicoOrdersSheet));
  document.querySelectorAll('[data-undohist]').forEach(b=>b.onclick=()=>withBusy(b, ()=>undoOrder(b.dataset.undohist)));
  document.querySelectorAll('[data-reorderhist]').forEach(b=>b.onclick=()=>{
    const rec = state.history.find(r=>r.id===b.dataset.reorderhist);
    if(!rec) return;
    const cart = {};
    rec.entries.forEach(e=>e.items.forEach(it=>{
      // Skip items that were since deleted from the catalog -- they no
      // longer have anywhere to show up on the order screen.
      if(state.items.some(i=>i.id===it.itemId && i.available!==false)) cart[it.itemId] = it.qty;
    }));
    // Replaces the order being made; Undo brings it back.
    const before = {...state.cart};
    state.cart = cart;
    persistCartDraft();
    goView('order');
    toast(t('reorderReady')(cartCount()), 'ok', {undo:()=>{ state.cart = before; persistCartDraft(); if(state.view === 'order') refreshOrderView(); }});
  });
  // Only Rozha can delete an order, and only with her PIN (the server checks it); Yunis asks her.
  document.querySelectorAll('[data-delhist]').forEach(b=>b.onclick=()=>{
    const id = b.dataset.delhist;
    showFormModal({
      title: esc(t('deleteOrderTitle')),
      bodyHtml: `<div class="modal-msg">${esc(t('deleteOrderNote'))}</div><div class="field"><label for="delPin">${esc(t('yourPin'))}</label><input id="delPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></div>`,
      okLabel: t('delete'), okClass: 'btn-danger',
      onSubmit: async ()=>{
        const pin = document.getElementById('delPin').value.trim();
        if(!/^\d{6}$/.test(pin)) return {error:t('pinsInvalidLength')};
        const r = await api(`orders/${encodeURIComponent(id)}`, {method:'DELETE', body:{pin}});
        if(!r.ok){
          const code = r.data && r.data.error;
          return {error: code === 'wrong_pin' ? t('wrongPin') : r.status === 429 ? t('tooManyAttempts') : t('saveFailed')};
        }
        state.history = state.history.filter(h=>h.id!==id);
        // Deleting the day's only order takes that day off the kitchen streak.
        if(r.data && r.data.streak) streakArrived(r.data.streak, null);
        render();
        return {};
      }
    });
  });
}

/* ============ Record (activity log) ============ */
/* Every add / edit / delete of a supplier, item or unit is recorded with the
   date, time and which device did it. The server writes the real entry
   itself, in the same request as the change (so it can't be skipped or
   faked). This only shows it on this phone right away; opening the Record
   screen reloads the server's copy, which replaces it. */
const ACTIVITY_MAX = 500;
const RECORD_PAGE_SIZE = 30;
let activityRefreshId = 0;
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
  const requestId = ++activityRefreshId;
  const r = await api('activity');
  if(requestId === activityRefreshId && r.ok && Array.isArray(r.data)){
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
  return ({name:t('name'), phone:t('phone'), unit:t('unit'), supplier:t('supplier'), nameKu:t('kurdishLabel'), nameAr:t('arabicLabel'), reminder:t('reminderShort'), note:t('recordNote'), aliases:t('searchAliases'), available:t('availableToOrder'), cutoff:t('cutoffShort')})[k] || k;
}
function recordValue(k, v){
  if(k==='aliases'){try{const aliases=JSON.parse(v);if(Array.isArray(aliases))return aliases.join(', ')||t('noValue');}catch(_){} }
  if(k==='available')return t(v==='false'?'unavailable':'availableToOrder');
  if(k === 'reminder') return reminderText(reminderFromCode(v));
  if(k === 'cutoff' && v) return reminderTimeLabel(v);
  if(k === 'supplier' && !v) return t('noSupplier');
  if(!v) return t('noValue');
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
    .filter(a => (state.recordFilter==='all' || a.type===state.recordFilter) && catalogMatches(recordSearchFields(a)))
    .sort((a,b)=> new Date(b.ts) - new Date(a.ts));
  const cards = rows.slice(0, state.recordLimit).map(a=>{
    const typeLabel = ({supplier:t('typeSupplier'), item:t('typeItem'), unit:t('typeUnit')})[a.type] || a.type;
    const actLabel = ({add:t('actionAdded'), edit:t('actionEdited'), delete:t('actionDeleted')})[a.action] || a.action;
    const dt = formatIraqDateTime(a.ts,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    // Older entries (before the two accounts) may only have a device name, or nothing.
    const who = accountLabel(a.actor) ? whoBadge(a.actor) : esc(a.by || t('unnamedDevice'));
    const lines = (a.fields||[]).map(f=>{
      const label = esc(recordFieldLabel(f.k));
      if(a.action === 'edit'){
        return `<div class="rec-line"><span class="rec-k">${label}</span> <span class="rec-old">${esc(recordValue(f.k, f.from))}</span> \u2192 <span class="rec-new">${esc(recordValue(f.k, f.to))}</span></div>`;
      }
      const v = a.action === 'delete' ? f.from : f.to;
      return `<div class="rec-line"><span class="rec-k">${label}</span> ${esc(recordValue(f.k, v))}</div>`;
    }).join('');
    const extra = a.unassigned ? `<div class="rec-line">${t('itemsUnassigned')(a.unassigned)}</div>` : '';
    return `<div class="rec-card" data-search-row data-search-text="${esc(recordSearchFields(a))}">
      <div class="rec-top"><span class="rec-badge rec-${esc(a.action)}">${actLabel}</span><span class="rec-type">${typeLabel}</span></div>
      <div class="rec-name">${esc(a.name)}</div>
      ${lines}${extra}
      <div class="rec-meta">${dt} \u00b7 ${who}</div>
    </div>`;
  }).join('');
  return `
    <div class="action-row">
      <div class="section-title grow" id="recordCount">${esc(t('record'))} (${rows.length})</div>
      <button class="btn btn-ghost" id="recRefreshBtn">${ICON_REFRESH} ${esc(t('refresh'))}</button>
    </div>
    ${filterHtml}${renderCatalogSearch()}
    <div id="recordResults">${cards || emptyState(t(state.catalogQuery?.trim()?'catalogNoResults':'recordEmpty'))}
    ${rows.length > state.recordLimit ? `<button class="btn btn-ghost" id="recMoreBtn">${esc(t('loadMoreRecord'))}</button>` : ''}</div>`;
}
function refreshRecordResults(){
  const wrapper=document.createElement('div');wrapper.innerHTML=renderRecord();
  document.getElementById('recordResults').innerHTML=wrapper.querySelector('#recordResults').innerHTML;
  document.getElementById('recordCount').textContent=wrapper.querySelector('#recordCount').textContent;
  attachCatalogSearch();attachRecordEvents();
}
function attachRecordEvents(){
  const search=document.getElementById('catalogSearch');if(search)search.oninput=()=>{state.catalogQuery=search.value;state.recordLimit=RECORD_PAGE_SIZE;refreshRecordResults();};
  document.querySelectorAll('[data-recfilter]').forEach(b=>b.onclick=()=>{
    state.recordFilter = b.dataset.recfilter; state.recordLimit = RECORD_PAGE_SIZE; render();
  });
  const more = document.getElementById('recMoreBtn');
  if(more) more.onclick = ()=>{ state.recordLimit += RECORD_PAGE_SIZE; render(); };
  const r = document.getElementById('recRefreshBtn');
  if(r) r.onclick = ()=> spinRefresh(r, refreshActivity);
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
  const edit = canDo('catalog');
  return `
    <div class="action-row">
      ${edit ? `<button class="btn btn-primary add-btn" id="supAddBtn">${ICON_PLUS} ${t('addSupplier')}</button>` : ''}
      ${canDo('exports') ? `<button class="btn btn-ghost" data-export="suppliers">${ICON_SHEET} ${esc(t('exportBtn'))}</button>` : ''}
      ${canOpen('record') ? `<button class="btn btn-ghost" data-gorecord="supplier">${NAV_ICONS.record} ${t('record')}</button>` : ''}
    </div>${edit ? '' : `<p class="readonly-note">${esc(t('catalogReadOnly'))}</p>`}
    ${renderCatalogSearch()}<div class="section-title">${t('suppliers')} (${state.suppliers.length})</div><div id="suppliersTable">${renderDataTable('suppliers')}</div>`;
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
      ${reminderFieldsHtml(existing?.reminder)}
      <div class="field"><label for="mfCutoff">${t('cutoffLabel')}</label><input id="mfCutoff" type="time" value="${esc(existing?.cutoff||'')}"><small class="field-hint">${esc(t('cutoffHint'))}</small></div>`,
    okLabel: t('save'),
    againLabel: existing ? null : t('saveAndAddAnother'),
    onOpen: (box)=> attachReminderFields(box),
    onSubmit: async (again)=>{
      const name = document.getElementById('mfName').value.trim();
      const phone = document.getElementById('mfPhone').value.trim();
      const cutoff = document.getElementById('mfCutoff').value.trim().slice(0, 5);
      if(!name) return {error: t('nameRequired')};
      if(cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) return {error: t('reminderTimeInvalid')};
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
        const fields = diffFields([['name', s.name, name], ['phone', s.phone, phone], ['reminder', oldCode, newCode], ['cutoff', s.cutoff || '', cutoff]]);
        if(!fields.length) return {};   // nothing changed -- nothing to save or record
        // updatedAt tells the server when the reminder was last changed, so a time that
        // has already passed today starts tomorrow instead of firing the moment you save.
        const reminder = oldCode === newCode ? s.reminder
          : rem.on ? {...newRem, updatedAt: now} : {...(s.reminder||{}), enabled:false, updatedAt: now};
        const next = {...s, name, phone, reminder, cutoff: cutoff || null};
        if(!(await saveRecord('suppliers', next))) return {error: t('saveFailed')};
        Object.assign(s, next);
        logActivity({action:'edit', type:'supplier', name, fields});
      } else {
        const next = {id:'s'+outboxJobId(), name, phone, reminder: rem.on ? {...newRem, updatedAt: now} : null, cutoff: cutoff || null};
        if(!(await saveRecord('suppliers', next))) return {error: t('saveFailed')};
        state.suppliers.push(next);
        logActivity({action:'add', type:'supplier', name,
          fields:[{k:'name', to:name}].concat(phone ? [{k:'phone', to:phone}] : [])
                 .concat(rem.on ? [{k:'reminder', to:newCode}] : []).concat(cutoff ? [{k:'cutoff', to:cutoff}] : [])});
      }
      render();
      if(again){ resetReminderFields(); return {keepOpen:true, message:t('savedMsg')(name)}; }
      toast(t('savedMsg')(name));
      return {};
    }
  });
}
function attachSupplierEvents(){
  const add = document.getElementById('supAddBtn');
  if(add) add.onclick = ()=> openSupplierModal(null);
  attachDataTable('suppliers', document.getElementById('suppliersTable'));
}
async function testSupplierReminder(id){
  const sup = state.suppliers.find(s=>s.id===id);
  if(!sup) return;
  if(!(await showConfirm(`<b>${esc(sup.name)}</b><br>${t('confirmTestSupplier')}`, {okLabel:t('notifSend'), okClass:'btn-primary'}))) return;
  reportSendResult(await callSendPush('supplier-test', {supplierId: sup.id}));
}
async function deleteSupplier(id){
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
  toast(t('deletedMsg')(sup.name));
}

/* ============ Items ============ */
function renderItemsAdmin(){
  const edit = canDo('catalog');
  return `
    <div class="action-row">
      ${edit ? `<button class="btn btn-primary add-btn" id="itemAddBtn">${ICON_PLUS} ${t('addItem')}</button>
      <button class="btn btn-ghost" id="itemImportBtn">${ICON_DOWNLOAD} ${esc(t('importItems'))}</button>` : ''}
      ${canDo('exports') ? `<button class="btn btn-ghost" data-export="items">${ICON_SHEET} ${esc(t('exportBtn'))}</button>` : ''}
    </div>${edit ? '' : `<p class="readonly-note">${esc(t('catalogReadOnly'))}</p>`}
    ${renderCatalogSearch()}<div class="section-title">${t('items')} (${state.items.length})</div><div id="itemsAdminList">${renderDataTable('items')}</div>`;
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
  const unitOptions = state.units.map(u=>`<option value="${esc(u.id)}" ${existing?.unit===u.id?'selected':''}>${esc(unitName(u))}</option>`).join('');
  // While adding a fresh item, the last supplier picked stays selected so
  // bulk-adding items for one supplier doesn't need reselecting each time.
  const currentSupplierId = existing ? existing.supplierId : state.itemFormSupplierId;
  const supOptions = `<option value="">${existing ? t('noSupplier') : t('chooseSupplier')}</option>` + state.suppliers.map(s=>`<option value="${esc(s.id)}" ${currentSupplierId===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
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
      </div>
      <label class="check-row"><input type="checkbox" id="mfAvailable" ${existing?.available===false?'':'checked'}>${esc(t('availableToOrder'))}</label><div class="field"><label for="mfAliases">${esc(t('searchAliases'))}</label><input id="mfAliases" value="${esc((existing?.aliases||[]).join(', '))}" maxlength="1440" dir="auto"><small class="field-hint">${esc(t('aliasesHint'))}</small></div><div class="field"><label for="mfNote">${esc(t('itemNoteLabel'))}</label><input id="mfNote" maxlength="120" autocomplete="off" dir="auto" value="${esc(existing?.note||'')}"><div class="field-hint">${esc(t('itemNoteHint'))}</div></div>
      `,
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
      const note = document.getElementById('mfNote').value.trim().slice(0, 120), aliases=parseAliases(document.getElementById('mfAliases').value), available=document.getElementById('mfAvailable').checked;
      if(!name) return {error: t('nameRequired')};
      if(!supplierId && (!existing || existing.supplierId)) return {error: t('supplierRequired')};
      const newSupName = supplierId ? (state.suppliers.find(s=>s.id===supplierId)?.name || '') : '';
      const editing = existing;
      if(editing){
        const i = state.items.find(x=>x.id===editing.id);
        if(!i) return {};
        const oldSupName = i.supplierId ? (state.suppliers.find(s=>s.id===i.supplierId)?.name || '') : '';
        const fields = diffFields([
          ['name', i.name, name],
          ['unit', unitEn(i.unit), unitEn(unit)],
          ['supplier', oldSupName, newSupName],
          ['note', i.note || '', note],['aliases',(i.aliases||[]).join(', '),aliases.join(', ')],['available',String(i.available!==false),String(available)]
        ]);
        if(fields.length){
          const next = {...i, name, unit, supplierId, note, aliases, available, sortOrder:supplierId===i.supplierId?i.sortOrder:null};
          if(!(await saveRecord('items', next))) return {error: t('saveFailed')};
          Object.assign(i, next);if(!available){delete state.cart[i.id];persistCartDraft();}
          logActivity({action:'edit', type:'item', name, fields});
        }
      } else {
        const supplierItems=state.items.filter(i=>i.supplierId===supplierId);
        const maxSort=supplierItems.reduce((max,i)=>Number.isInteger(i.sortOrder)?Math.max(max,i.sortOrder):max,-1);
        const next = {id:'i'+outboxJobId(), name, unit, supplierId, note, aliases, available, sortOrder:maxSort>=0?maxSort+1:null};
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
/* Deleting an item asks first, then offers Undo. The server keeps a copy for 10 minutes that only
   this account on this device can bring back; it comes back with its amount in the order. */
async function deleteItemWithUndo(id){
  const account = state.account, item = state.items.find(i=>i.id===id);
  if(!item) return;
  if(!(await showConfirm(`<b>${esc(item.name)}</b><br>${esc(t('confirmDeleteItem'))}`)) || account !== state.account) return;
  const qty = state.cart[id] || 0;
  const r = await api(`items/${encodeURIComponent(id)}`, {method:'DELETE'});
  if(account !== state.account) return;
  if(!r.ok || !r.data?.undoId){ await showAlert(t('saveFailed')); return; }
  const supName = item.supplierId ? (state.suppliers.find(s=>s.id===item.supplierId)?.name || '') : '';
  state.items = state.items.filter(i=>i.id!==id);
  delete state.cart[id];
  persistCartDraft();
  logActivity({action:'delete', type:'item', name:item.name, fields:[
    {k:'name', from:item.name}, {k:'unit', from:unitEn(item.unit)}, {k:'supplier', from:supName}
  ]});
  render();
  let restoring = false;
  toast(t('itemDeleted')(item.name), 'ok', {ms:8000, undo:async()=>{
    if(restoring || account !== state.account) return;
    restoring = true;
    const back = await api('items/restore', {method:'POST', body:{undoId:r.data.undoId}});
    if(account !== state.account) return;
    if(!back.ok){ await showAlert(t('undoExpired')); return; }
    if(await loadData()){
      if(qty && !state.cart[id]) state.cart[id] = qty;
      persistCartDraft(); render(); toast(t('itemRestored'));
    }
  }});
}
function attachItemEvents(){
  const add = document.getElementById('itemAddBtn');
  if(add) add.onclick = ()=> openItemModal(null);
  attachDataTable('items', document.getElementById('itemsAdminList'));
}

/* ============ Units ============ */
/* A unit has one name, written in whatever language suits it (کیلۆ, box, ...). Units used to have
   English, Kurdish and Arabic names; Record still shows those older changes. */
function renderUnits(){
  const chips = state.units.map(u=>`<span class="unit-chip" data-search-row data-unit-id="${esc(u.id)}"><span class="unit-names"><strong dir="auto">${esc(unitName(u))}</strong></span>
      ${canDo('catalog') ? `<button data-editunit="${esc(u.id)}" aria-label="${esc(t('editUnit'))}">${ICON_EDIT}</button>
      <button class="danger" data-delunit="${esc(u.id)}" aria-label="${esc(t('delete'))}">${ICON_DELETE}</button>` : ''}
    </span>`).join('');
  return `
    <div class="action-row">
      ${canDo('catalog') ? `<button class="btn btn-primary add-btn" id="unitAddBtn">${ICON_PLUS} ${esc(t('addUnit'))}</button>` : ''}
      ${canOpen('record') ? `<button class="btn btn-ghost" data-gorecord="unit">${NAV_ICONS.record} ${esc(t('record'))}</button>` : ''}
    </div>
    ${renderCatalogSearch()}<div class="section-title">${esc(t('units'))} (${state.units.length})</div>
    ${chips ? `<div class="unit-grid">${chips}</div>` : emptyState(t('noUnitsYet'))}`;
}
function openUnitModal(unit){
  showFormModal({
    title: unit ? t('editUnit') : t('addUnit'),
    banner: unit ? editingBanner(unitName(unit)) : '',
    bodyHtml: `<div class="field"><label for="mfUnitName">${esc(t('unitNameLabel'))}</label><input id="mfUnitName" dir="auto" maxlength="80" data-clear="1" autocomplete="off" value="${esc(unit?.en||'')}" placeholder="${esc(t('unitNamePlaceholder'))}"></div>`,
    okLabel: t('save'),
    againLabel: unit ? null : t('saveAndAddAnother'),
    onSubmit: async (again)=>{
      const name = document.getElementById('mfUnitName').value.trim();
      if(!name) return {error:t('nameRequired')};
      if(state.units.some(u=>u !== unit && foldText(String(u.en || '').trim()) === foldText(name))) return {error:t('unitExists')};   // کیلۆ and كيلۆ are the same name
      if(unit){
        const fields = diffFields([['name',unit.en,name]]);
        if(!fields.length) return {};
        if(!(await saveRecord('units',{id:unit.id, en:name, ku:null, ar:null}))) return {error:t('saveFailed')};
        Object.assign(unit,{en:name, ku:null, ar:null});
        logActivity({action:'edit',type:'unit',name,fields});
      }else{
        const next = {id:'u'+outboxJobId(), en:name, ku:null, ar:null};
        if(!(await saveRecord('units', next))) return {error:t('saveFailed')};
        state.units.push(next);
        logActivity({action:'add', type:'unit', name, fields:[{k:'name', to:name}]});
      }
      render();
      if(again) return {keepOpen:true, message:t('savedMsg')(name)};
      toast(t('savedMsg')(name));
      return {};
    }
  });
}
function attachUnitEvents(){
  const add = document.getElementById('unitAddBtn');
  if(add) add.onclick = ()=>openUnitModal(null);
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
    logActivity({action:'delete', type:'unit', name:unit.en, fields:[{k:'name', from:unit.en}]});
    render();
  });
}

/* ============ Times ============ */
function timeAgo(iso){
  if(!iso) return t('never');
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if(mins < 1) return t('agoNow');
  if(mins < 60) return t('agoMin')(mins);
  const hrs = Math.floor(mins / 60);
  if(hrs < 24) return t('agoHour')(hrs);
  return t('agoDay')(Math.floor(hrs / 24));
}
function fmtDateTime(iso){
  if(!iso) return t('never');
  return formatIraqDateTime(iso,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
/* ============ Settings (every account) ============
   Appearance, the Order screen's display choices, sounds and notifications,
   all kept on this device. Rozha's tools (PINs, devices, the connection) are
   in Admin. */
function renderAppearance(){
  const dm=darkMode();
  return `<div class="section-title">${esc(t('settingsAppearance'))}</div><div class="form-card"><div class="dark-row"><span>${esc(t('darkLabel'))}<small>${esc(t('darkHint'))}</small></span><div class="pill-seg dark-seg" role="radiogroup" aria-label="${esc(t('darkLabel'))}">${[['off','darkOff'],['on','darkOn'],['auto','darkAuto']].map(([v,k])=>`<button type="button" role="radio" class="pill-seg-btn" aria-checked="${dm===v}" data-dark="${v}">${esc(t(k))}</button>`).join('')}</div></div></div>`;
}
function renderDisplaySettings(){
  const row = (id, on, label, hint)=>`<label class="check-row preference-row"><input type="checkbox" id="${id}" ${on?'checked':''}><span>${esc(t(label))}<small>${esc(t(hint))}</small></span></label>`;
  return `<div class="section-title">${esc(t('settingsOrderScreen'))}</div><div class="form-card">
    ${row('pref-compactRows', prefOn('compactRows'), 'compactRowsLabel', 'compactRowsHint')}
    ${row('pref-showLastQty', prefOn('showLastQty'), 'lastQtyLabel', 'lastQtyHint')}</div>`;
}
function renderOrderSounds(){
  return `<div class="section-title">${esc(t('orderSounds'))}</div><div class="form-card">${[['qty','quantitySound'],['sent','sentSound']].map(([id,key])=>`<label class="check-row preference-row"><input type="checkbox" id="sound-${id}" data-sound="${id}" ${soundOn(id)?'checked':''}><span>${esc(t(key))}</span></label>`).join('')}</div>`;
}
function currentOutbox(){ return outbox().filter(j=>outboxJobAccount(j)===state.account); }
function renderPendingSync(){
 const jobs=currentOutbox();
 if(!jobs.length) return '';
 return `<div class="section-title">${esc(t('pendingSync'))}: ${jobs.length}</div><div class="form-card"><p>${esc(t('pendingSyncHint'))}</p><div class="form-actions"><button class="btn btn-primary" id="syncRetryBtn">${esc(t('syncRetry'))}</button><button class="btn btn-ghost" id="syncExportBtn">${esc(t('syncExport'))}</button></div></div>`;
}
/* App versions look like 2026-10-09.2: compared number by number, so .10 comes after .9. */
function versionCmp(a, b){
  const pa = String(a || '').match(/\d+/g) || [], pb = String(b || '').match(/\d+/g) || [];
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){ const d = (+pa[i] || 0) - (+pb[i] || 0); if(d) return d; }
  return 0;
}
function renderSettings(){
  return `${renderPendingSync()}${renderAppearance()}${renderDisplaySettings()}${renderOrderSounds()}${renderNotifSettings()}${renderHelpSettings()}${renderPrivacySettings()}<div class="app-version">${esc(t('appVersionLine')(APP_VERSION))}</div>`;
}
/* Help: tell Rozha about a problem (it arrives in Admin, Problems), and the keyboard shortcuts. */
function renderHelpSettings(){
  return `<div class="section-title">${esc(t('settingsHelp'))}</div><div class="form-card settings-rows">
    <button type="button" class="settings-row" id="reportProblemBtn">${ICON_REPORT}<span>${esc(t('reportProblem'))}</span><i class="sheet-chevron" aria-hidden="true"></i></button>
    <button type="button" class="settings-row" id="shortcutsBtn">${ICON_KEYBOARD}<span>${esc(t('keyboardShortcuts'))}</span><i class="sheet-chevron" aria-hidden="true"></i></button></div>`;
}
function openReportProblem(){
  showFormModal({
    title: esc(t('reportProblem')),
    bodyHtml: `<p class="modal-msg">${esc(t('reportProblemHint'))}</p><div class="field"><label for="problemText">${esc(t('reportProblemLabel'))}</label><textarea id="problemText" rows="4" maxlength="500" dir="auto"></textarea></div><p class="field-hint">${esc(t('reportProblemPrivacy'))}</p>`,
    okLabel: t('reportSend'),
    onSubmit: async ()=>{
      const text = document.getElementById('problemText').value.trim();
      if(text.length < 3) return {error:t('reportProblemShort')};
      reportProblem('manual', text);
      const sent = await flushProblems();
      toast(!sent ? t('reportQueued') : isRozha() ? t('reportSavedRozha') : t('reportSent'));
      return {};
    }
  });
}
/* Privacy: Rico's AI permission (asked the first time Rico is used, and taken back here),
   the privacy policy, and Sign Out at the very end, like the iPhone's Settings. */
function renderPrivacySettings(){
  return `<div class="section-title">${esc(t('settingsPrivacy'))}</div><div class="form-card">
    <label class="check-row preference-row"><input type="checkbox" id="aiConsent" ${aiConsented()?'checked':''}><span>${esc(t('aiSettingLabel'))}<small>${esc(t('aiSettingHint'))}</small></span></label>
    <a class="settings-link" href="${esc(privacyHref())}">${ICON_SHIELD}<span>${esc(t('privacyPolicy'))}</span><i class="sheet-chevron" aria-hidden="true"></i></a></div>
    <div class="form-card settings-signout-card"><button type="button" class="settings-signout" id="settingsSignOut">${esc(t('logout'))}</button></div>`;
}
/* ============ Notifications (shown in Settings) ============ */
/* The daily reminder starts as one switch. Turning it on opens the time,
   a test button and Save; only Save turns it on for real (leaving without
   saving keeps it off). Turning it off saves "off" straight away. */
let reminderDraft = null;   // {time} while the reminder is being set up or changed
function reminderTimeLabel(time){
  const [h, m] = String(time || '09:00').split(':').map(Number);
  return dateFormatter({hour:'numeric', minute:'2-digit'}).format(new Date(2000, 0, 1, h, m));
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
    <div class="form-card">${device}${canDo('reminders') ? `<hr class="notif-divider">
      <label class="check-row preference-row"><input type="checkbox" id="reminderEnabled" ${r.enabled || reminderDraft ? 'checked' : ''}><span>${esc(t('reminderTitle'))}<small>${esc(hint)}</small></span></label>${editor}` : ''}</div>`;
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

/* Disables a button while its action runs, so a double tap can't send twice. */
async function withBusy(btn, fn){
  if(!btn || btn.disabled) return;
  btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy','true');
  try{ return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); }
}
/* Appearance changes update in place, preserving scroll position. */
function bindAppearance(){
  document.querySelectorAll('[data-dark]').forEach(b=>b.onclick=()=>{
    lset('darkMode',b.dataset.dark==='auto'?null:b.dataset.dark);applyPrefs();syncAppearance();
    document.querySelectorAll('[data-dark]').forEach(x=>x.setAttribute('aria-checked',String(x.dataset.dark===darkMode())));
  });
}
function attachSettingsEvents(){
 const retry=document.getElementById('syncRetryBtn');
 if(retry) retry.onclick=async()=>{retry.disabled=true;await flushOutbox();await loadData();render();};
 const exp=document.getElementById('syncExportBtn');
 if(exp) exp.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(currentOutbox(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ricotta-pending-orders.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  bindAppearance();
  document.querySelectorAll('[data-sound]').forEach(box=>box.onchange=()=>{setSoundOn(box.dataset.sound,box.checked);});
  [['pref-compactRows','compactRows'],['pref-showLastQty','showLastQty']].forEach(([id,key])=>{
    const box = document.getElementById(id);
    if(box) box.onchange = ()=>{ lset(key, box.checked ? true : null); applyPrefs(); };
  });
  const ai = document.getElementById('aiConsent');
  if(ai) ai.onchange = async ()=>{
    if(!ai.checked){ setAiConsent(false); return; }
    ai.checked = await aiConsent();
  };
  document.getElementById('settingsSignOut').onclick = ()=>doLogout();
  document.getElementById('reportProblemBtn').onclick = openReportProblem;
  document.getElementById('shortcutsBtn').onclick = openShortcuts;
  attachNotifEvents();
}

boot();
