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

/* Returns {ok, status, data}. Never throws. A 401 on a signed-in device means
   the session was revoked (PIN change, remote log out) or expired. */
async function api(path, {method='GET', body} = {}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), API_TIMEOUT_MS);
  const s = apiSession();
  const headers = {'Content-Type':'application/json', 'x-device-id':String(lget('deviceId')||'')};
  if(s) headers['x-session-token'] = s.token;
  try{
    const res = await fetch(`${API_URL}/${path}`, {
      method, headers, signal:controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    setApiHealth(true);
    const data = await res.json().catch(()=>null);
    if(res.status === 401 && s && path !== 'login'){ clearApiSession(); onSessionExpired(); }
    return {ok:res.ok, status:res.status, data};
  }catch(e){
    setApiHealth(false);
    return {ok:false, status:0, data:null};
  }finally{ clearTimeout(timer); }
}

/* Returns {role:'admin'|'user'} on success, or {error:'wrong'|'locked'|'network'}. */
async function apiLogin(pin){
  const r = await api('login', {method:'POST', body:{pin}});
  if(r.ok && r.data && r.data.token){
    lset('apiSession', {token:r.data.token, expiresAt:r.data.expiresAt, role:r.data.role});
    return {role: r.data.role === 'staff' ? 'user' : r.data.role};
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
async function sendOrQueue(path, method, body){
  const r = await api(path, {method, body});
  if(r.ok) return true;
  if(r.status === 0 || r.status >= 500){
    lset('outbox', [...outbox(), {path, method, body}]);
  }
  return false;
}
let outboxBusy = false;
async function flushOutbox(){
  if(outboxBusy || !apiSession()) return;
  const pending = outbox();
  if(!pending.length) return;
  outboxBusy = true;
  const left = [];
  for(const job of pending){
    const r = await api(job.path, {method:job.method, body:job.body});
    if(!r.ok && (r.status === 0 || r.status >= 500)) left.push(job);   // 4xx = never going to work; drop it
  }
  lset('outbox', left.length ? left : null);
  outboxBusy = false;
}
