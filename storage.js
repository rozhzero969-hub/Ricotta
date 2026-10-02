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
    return true;
  }catch(e){ return false; /* private mode / storage full -- the app still works for this visit */ }
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
/* A request may finish after a log out or another sign-in. Never let that
   reply update the next account's screen or clear its session. Compare the
   stored token so an ordinary expiry still follows the 401 handling below. */
function apiSessionMatches(session){
  return (session?.token || null) === (lget('apiSession')?.token || null);
}
/* Another tab can change the shared session before this tab receives its
   storage event. Its old screen must not send an action as the new account. */
function apiAccountMatchesUi(session){
  return typeof state === 'undefined' || !state?.account || !session || session.account === state.account;
}
function apiPathIsPublic(path){ return path === 'login' || path === 'health' || path.startsWith('recovery/'); }
function staleApiReply(){ return {ok:false, status:0, data:null, stale:true}; }

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
  const s = apiSession();
  if(!apiPathIsPublic(path) && !apiAccountMatchesUi(s)) return staleApiReply();
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  const sessionCurrent = ()=>apiPathIsPublic(path) || (apiSessionMatches(s) && apiAccountMatchesUi(s));
  const headers = {'Content-Type':'application/json', 'x-device-id':String(lget('deviceId')||''), 'x-device-label':deviceLabel()};
  if(s) headers['x-session-token'] = s.token;
  try{
    const res = await fetch(`${API_URL}/${path}`, {
      method, headers, signal:controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if(!sessionCurrent()) return staleApiReply();
    const data = await res.json().catch(()=>null);
    if(!sessionCurrent()) return staleApiReply();
    setApiHealth(true);
    if(res.status === 401 && s && !apiPathIsPublic(path)){ clearApiSession(); onSessionExpired(); }
    return {ok:res.ok, status:res.status, data};
  }catch(e){
    if(!sessionCurrent()) return staleApiReply();
    setApiHealth(false);
    return {ok:false, status:0, data:null};
  }finally{ clearTimeout(timer); }
}

/* Streams an NDJSON reply (Rico's chat): calls onEvent(object) for every line
   as it arrives. Never throws; network trouble arrives as {type:'error',code:'offline'}. */
async function apiStream(path, body, onEvent, signal){
  const s = apiSession();
  if(!apiPathIsPublic(path) && !apiAccountMatchesUi(s)) return staleApiReply();
  const sessionCurrent = ()=>apiPathIsPublic(path) || (apiSessionMatches(s) && apiAccountMatchesUi(s));
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
    if(!sessionCurrent()){ stop(); return; }
    setApiHealth(true);
    if(res.status === 401 && s && !apiPathIsPublic(path)){ clearApiSession(); onSessionExpired(); return; }
    if(!res.ok){ onEvent({type:'error', code:res.status===429?'busy':'failed'}); return; }
    const handle = line=>{
      if(!sessionCurrent()){ stop(); return false; }
      line = line.trim();
      if(line){ try{ onEvent(JSON.parse(line)); }catch(e){ /* partial or non-JSON line */ } }
      return sessionCurrent();
    };
    if(!res.body || !res.body.getReader){
      for(const line of (await res.text()).split('\n')) if(!handle(line)) break;
      return;
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for(;;){
      const {value, done} = await reader.read();
      if(!sessionCurrent()){ stop(); return; }
      if(done) break;
      buf += dec.decode(value, {stream:true});
      let i;
      while((i = buf.indexOf('\n')) >= 0){
        if(!handle(buf.slice(0, i))){ stop(); return; }
        buf = buf.slice(i + 1);
      }
    }
    handle(buf);
  }catch(e){
    if(!signal?.aborted && sessionCurrent()){
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
   Orders must never be lost to a flaky restaurant Wi-Fi:
   if a write fails it is kept on this device and retried later (on the next
   heartbeat, when the connection comes back, or at the next start-up). */
function outbox(){ const jobs = lget('outbox'); return Array.isArray(jobs) ? jobs : []; }
function outboxJobId(){ return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function retryableApiReply(r){ return r.status === 0 || r.status === 401 || r.status === 408 || r.status === 425 || r.status === 429 || r.status >= 500; }
function outboxJobAccount(job){ return job.account || (typeof job.body?.by === 'string' ? job.body.by : null) || null; }
function queueOutboxJob(path, method, body){
  const jobs = outbox();
  const activeAccount = typeof state === 'undefined' ? null : state?.account;
  const account = (typeof body?.by === 'string' ? body.by : null) || activeAccount || apiSession()?.account || null;
  // Orders have a stable server id: repeat failures of the same order need
  // one retry job, with the original payload preserved.
  const prior = path === 'orders' && method === 'POST' && body?.id && jobs.find(job=>job.path === path && job.method === method && job.body?.id === body.id && (!outboxJobAccount(job) || outboxJobAccount(job) === account));
  if(prior){
    if(!prior.id) prior.id = outboxJobId();
    if(!prior.account && account) prior.account = account;
    const persisted = lset('outbox', jobs) || outbox().some(saved=>saved.id === prior.id);
    return {...prior, persisted};
  }
  const job = {id:outboxJobId(), account, path, method, body};
  const persisted = lset('outbox', [...jobs, job]) || outbox().some(saved=>saved.id === job.id);
  return {...job, persisted};
}
function removeOutboxJob(id){
  const left = outbox().filter(job=>job.id !== id);
  lset('outbox', left.length ? left : null);
}
const outboxRequests = new Map();
async function sendOutboxJob(job){
  const session = apiSession();
  if(job.account && session && job.account !== session.account) return staleApiReply();
  if(outboxRequests.has(job.id)) return outboxRequests.get(job.id);
  const request = api(job.path, {method:job.method, body:job.body});
  outboxRequests.set(job.id, request);
  try{ return await request; }
  finally{ if(outboxRequests.get(job.id) === request) outboxRequests.delete(job.id); }
}
/* Returns 'saved', 'queued' (kept here and retried later) or 'failed'. A
   401 is queued too: the sign-in ran out, and the job is sent after the next
   sign-in to the original account instead of being thrown away. */
async function sendOrQueue(path, method, body){
  // Persist first: closing the tab while the request is in flight must not
  // discard an order. The stable order id makes retrying an ambiguous
  // response safe, and active sends share one request with the heartbeat.
  const job = queueOutboxJob(path, method, body);
  const r = await sendOutboxJob(job);
  if(r.ok){ removeOutboxJob(job.id); return 'saved'; }
  // An unavailable/full device store cannot promise an offline retry. The
  // caller still has the original record and can show the save-failed state.
  if(retryableApiReply(r)) return job.persisted ? 'queued' : 'failed';
  removeOutboxJob(job.id);
  return 'failed';
}
let outboxBusy = false;
async function flushOutbox(){
  const session = apiSession();
  if(outboxBusy || !session) return;
  const pending = outbox();
  if(!pending.length) return;
  outboxBusy = true;
  try{
    // Upgrade old queued writes before the first await. IDs let us remove
    // exactly the completed job from the latest queue, including any writes
    // added while this request was in flight.
    const seen = new Set();
    for(const job of pending){
      if(!job.id || seen.has(job.id)) job.id = outboxJobId();
      if(!job.account && outboxJobAccount(job)) job.account = outboxJobAccount(job);
      seen.add(job.id);
    }
    lset('outbox', pending);
    for(const job of pending){
      if(!apiSessionMatches(session)) break;
      if(job.account && job.account !== session.account) continue;
      const r = await sendOutboxJob(job);
      // Keep transient failures and the untouched jobs for the next retry.
      // Stopping here also avoids hammering an offline/rate-limited server.
      if(!r.ok && retryableApiReply(r)) break;
      removeOutboxJob(job.id);
    }
  }finally{
    outboxBusy = false;
  }
}
