/* Ricotta Orders -- local storage + the API client.
   Every shared read/write goes through the `api` Edge Function with this
   device's session token; the browser has no direct database access.
   Depends on SUPABASE_URL (config.js). onSessionExpired / setApiHealth are
   defined in app.js and only called at runtime. */

/* ============ Local storage (this device only) ============ */
const LS_PREFIX = 'ricottaOrders:';
function lget(key){
  try{ const v = localStorage.getItem(LS_PREFIX+key); return v ? JSON.parse(v) : null; }
  catch(e){ return null; }
}
function lset(key, value){
  try{
    if(value === null || value === undefined) localStorage.removeItem(LS_PREFIX+key);
    else localStorage.setItem(LS_PREFIX+key, JSON.stringify(value));
  }catch(e){ /* private mode / storage full -- the app still works for this visit */ }
}

/* ============ API client ============ */
const API_URL = `${SUPABASE_URL}/functions/v1/api`;
const API_TIMEOUT_MS = 12000;

function apiSession(){
  const s = lget('apiSession');
  if(s && s.token && s.expiresAt && Date.parse(s.expiresAt) > Date.now()) return s;
  return null;
}
function clearApiSession(){ lset('apiSession', null); }

/* What this device is, for the Devices screen: "iPhone 16/17 Pro Max|App",
   "Windows PC|Chrome"... iPhones don't reveal their exact model to web
   pages, so the model family comes from the screen size. Android phones
   report their model (e.g. SM-S918B) through client hints. Sent with every
   request as x-device-label (plain ASCII). */
const IPHONE_SCREENS = {
  '320x568':'iPhone SE (1st gen)', '375x667':'iPhone SE / 8', '414x736':'iPhone 8 Plus',
  '375x812':'iPhone X / 11 Pro / mini', '414x896@2':'iPhone XR / 11', '414x896@3':'iPhone 11 Pro Max',
  '390x844':'iPhone 12 / 13 / 14', '428x926':'iPhone 13 Pro Max / 14 Plus', '393x852':'iPhone 14 Pro / 15 / 16',
  '430x932':'iPhone 15 Pro Max / 16 Plus', '402x874':'iPhone 16 Pro / 17', '440x956':'iPhone 16/17 Pro Max', '420x912':'iPhone Air',
};
let deviceLabelCache = '';
function deviceLabel(){
  if(deviceLabelCache) return deviceLabelCache;
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const w = Math.min(screen.width, screen.height), h = Math.max(screen.width, screen.height), dpr = Math.round(window.devicePixelRatio || 1);
  let kind;
  if(/iPhone/.test(ua)) kind = IPHONE_SCREENS[`${w}x${h}@${dpr}`] || IPHONE_SCREENS[`${w}x${h}`] || 'iPhone';
  else if(/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) kind = 'iPad';
  else if(/Android/.test(ua)){
    const m = ua.match(/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build|\))/i);
    const model = m && m[1] && m[1] !== 'K' ? m[1].trim() : (lget('deviceModel') || '');
    kind = model ? `Android ${model}` : (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet');
  }
  else if(/CrOS/.test(ua)) kind = 'Chromebook';
  else if(/Windows/.test(ua)) kind = 'Windows PC';
  else if(/Macintosh/.test(ua)) kind = 'Mac';
  else if(/Linux/.test(ua)) kind = 'Linux PC';
  else kind = 'Device';
  const app = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  // "kind|how", e.g. "Windows PC|Website" (the app shows the two parts separately).
  deviceLabelCache = `${kind}|${app ? 'App' : 'Website'}`.replace(/[^\x20-\x7E]/g, '').slice(0, 80);
  return deviceLabelCache;
}
/* Chrome on Android hides the model in the user agent; ask for it once. */
try{
  navigator.userAgentData?.getHighEntropyValues?.(['model']).then(v=>{
    if(v && v.model && v.model !== lget('deviceModel')){ lset('deviceModel', String(v.model).slice(0, 40)); deviceLabelCache = ''; }
  }, ()=>{});
}catch(_){}

/* Returns {ok, status, data}. Never throws. A 401 on a signed-in device means
   the session was revoked (new PINs, remote log out) or expired. */
async function api(path, {method='GET', body, timeout=API_TIMEOUT_MS} = {}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  const s = apiSession();
  const headers = {'Content-Type':'application/json', 'x-device-id':String(lget('deviceId')||''), 'x-device-label':deviceLabel()};
  if(s) headers['x-session-token'] = s.token;
  try{
    const res = await fetch(`${API_URL}/${path}`, {
      method, headers, signal:controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    setApiHealth(true);
    const data = await res.json().catch(()=>null);
    if(res.status === 401 && s && path !== 'login' && !path.startsWith('recovery/')){ clearApiSession(); onSessionExpired(); }
    return {ok:res.ok, status:res.status, data};
  }catch(e){
    setApiHealth(false);
    return {ok:false, status:0, data:null};
  }finally{ clearTimeout(timer); }
}

/* Streams an NDJSON reply (Rico's chat): calls onEvent(object) for every line
   as it arrives. Never throws; network trouble arrives as {type:'error',code:'offline'}. */
async function apiStream(path, body, onEvent, signal){
  const s = apiSession();
  const headers = {'Content-Type':'application/json', 'x-device-id':String(lget('deviceId')||''), 'x-device-label':deviceLabel()};
  if(s) headers['x-session-token'] = s.token;
  const streamController = new AbortController();
  const stop = ()=>streamController.abort();
  if(signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, {once:true});
  let timedOut = false;
  const timer = setTimeout(()=>{ timedOut = true; stop(); }, 55000);
  try{
    const res = await fetch(`${API_URL}/${path}`, {method:'POST', headers, body:JSON.stringify(body), signal:streamController.signal});
    setApiHealth(true);
    if(res.status === 401 && s){ clearApiSession(); onSessionExpired(); return; }
    if(!res.ok){ onEvent({type:'error', code:res.status===429?'busy':'failed'}); return; }
    const handle = line=>{ line = line.trim(); if(!line) return; try{ onEvent(JSON.parse(line)); }catch(e){ /* partial or non-JSON line */ } };
    if(!res.body || !res.body.getReader){ (await res.text()).split('\n').forEach(handle); return; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for(;;){
      const {value, done} = await reader.read();
      if(done) break;
      buf += dec.decode(value, {stream:true});
      let i;
      while((i = buf.indexOf('\n')) >= 0){ handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    handle(buf);
  }catch(e){
    if(!signal?.aborted){
      if(timedOut) onEvent({type:'error', code:'busy'});
      else { setApiHealth(false); onEvent({type:'error', code:'offline'}); }
    }
  }finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/* Returns {account, name, tabs} on success, {recovery:true, ticket} when the
   secret code was typed, or {error:'wrong'|'locked'|'network'}. */
async function apiLogin(pin){
  const r = await api('login', {method:'POST', body:{pin}});
  if(r.ok && r.data && r.data.recovery && r.data.ticket) return {recovery:true, ticket:r.data.ticket};
  if(r.ok && r.data && r.data.token){
    const d = r.data;
    lset('apiSession', {token:d.token, expiresAt:d.expiresAt, account:d.account, name:d.name, tabs:d.tabs});
    return {account:d.account, name:d.name, tabs:d.tabs};
  }
  if(r.status === 429) return {error:'locked'};
  if(r.status === 0) return {error:'network'};
  return {error:'wrong'};
}

/* ============ Outbox ============
   Orders and Record entries must never be lost to a flaky restaurant Wi-Fi:
   if a write fails it is kept on this device and retried later (on the next
   heartbeat, when the connection comes back, or at the next start-up). */
function outbox(){ return lget('outbox') || []; }
/* Returns 'saved', 'queued' (kept here and retried later) or 'failed'. A
   401 is queued too: the sign-in ran out, and the job is sent after the next
   sign-in instead of being thrown away. */
async function sendOrQueue(path, method, body){
  const r = await api(path, {method, body});
  if(r.ok) return 'saved';
  if(r.status === 0 || r.status === 401 || r.status >= 500){
    lset('outbox', [...outbox(), {path, method, body}]);
    return 'queued';
  }
  return 'failed';
}
let outboxBusy = false;
async function flushOutbox(){
  if(outboxBusy || !apiSession()) return;
  const pending = outbox();
  if(!pending.length) return;
  outboxBusy = true;
  const left = [];
  for(let i = 0; i < pending.length; i++){
    const job = pending[i];
    const r = await api(job.path, {method:job.method, body:job.body});
    // Keep it for later when offline, on a server error, or when the session
    // just expired (401); any other 4xx will never work, so it is dropped.
    if(!r.ok && (r.status === 0 || r.status === 401 || r.status >= 500)) left.push(job);
    // Signed out: stop here and keep everything that wasn't tried yet.
    if(r.status === 401){ left.push(...pending.slice(i + 1)); break; }
  }
  lset('outbox', left.length ? left : null);
  outboxBusy = false;
}
