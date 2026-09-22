/* Local + Supabase (cloud) persistence for Ricotta Orders.
   Depends on the global `state` object from app.js (only inside
   function bodies, so load order relative to app.js doesn't matter),
   and on SUPABASE_URL / SUPABASE_ANON_KEY from config.js. */
/* ============ Storage helpers ============ */
/* Always keep a local copy so data survives even when this page is opened
   outside a Claude artifact (e.g. hosted directly, or window.storage fails).
   When window.storage IS available, it's used as the primary/shared store
   and localStorage is kept in sync as an automatic backup. */
const LS_PREFIX = 'ricottaOrders:';
function lget(key){
  try{ const v = localStorage.getItem(LS_PREFIX+key); return v ? JSON.parse(v) : null; }
  catch(e){ return null; }
}
function lset(key, value){
  try{ localStorage.setItem(LS_PREFIX+key, JSON.stringify(value)); }
  catch(e){ console.error('localStorage set failed', e); }
}
/* All shared data goes through the single Edge API.  The browser has no
   PostgREST table/RPC access and never stores configuration secrets. */
const API_URL = `${SUPABASE_URL}/functions/v1/api`;
const API_SESSION_KEY = 'apiSession';
let bootstrapCache = null;
function apiSession(){ return lget(API_SESSION_KEY); }
function apiHeaders(){
  const s = apiSession();
  const h = {'Content-Type':'application/json', 'x-device-id':String(lget('deviceId')||'')};
  if(s && s.token) h.Authorization = `Bearer ${s.token}`;
  return h;
}
async function apiFetch(path, opts={}){
  const res = await fetch(`${API_URL}/${path}`, {...opts, headers:{...apiHeaders(), ...(opts.headers||{})}});
  if(res.status===401){ lset(API_SESSION_KEY, null); lset('session', null); }
  if(!res.ok) return null;
  return await res.json().catch(()=>null);
}
async function apiBootstrap(){
  if(!bootstrapCache) bootstrapCache = await apiFetch('bootstrap');
  return bootstrapCache;
}
/* Shared values keep their existing in-memory shape during the UI migration,
   but their source of truth is now relational server-side data. */
function cloudConfigured(){
  return !!apiSession();
}
async function cloudGet(key){
  const data = await apiBootstrap();
  if(!data) return undefined;
  const names = {orderHistory:'history', activityLog:'activity'};
  return data[names[key]||key] ?? null;
}
async function cloudSet(key, value){
  const ok = await apiFetch(`state/${encodeURIComponent(key)}`, {method:'PUT', body:JSON.stringify({value})});
  if(ok && bootstrapCache){ const names={orderHistory:'history',activityLog:'activity'}; bootstrapCache[names[key]||key]=value; }
  return !!ok;
}
async function sget(key, shared){
  if(window.storage){
    try{
      const r = await window.storage.get(key, shared);
      if(r) return JSON.parse(r.value);
    }catch(e){ /* fall through */ }
  }
  if(shared){
    const cloudVal = await cloudGet(key);
    if(cloudVal !== undefined && cloudVal !== null) return cloudVal;
  }
  return lget(key);
}
async function sset(key, value, shared){
  lset(key, value);
  if(window.storage){
    try{ await window.storage.set(key, JSON.stringify(value), shared); }
    catch(e){ console.error('storage set failed', e); }
  }
  if(shared) await cloudSet(key, value);
}

/* ============ Authentication and settings ============ */
async function rpcCall(fnName, params){
  console.warn('Legacy RPC blocked:', fnName);
  return null;
}
/* Returns 'admin', 'user', or null. */
async function appVerifyPin(pin){
  try{
    const res = await fetch(`${API_URL}/login`, {method:'POST', headers:{'Content-Type':'application/json','x-device-id':String(lget('deviceId')||'')}, body:JSON.stringify({pin})});
    const data = await res.json().catch(()=>null);
    if(!res.ok || !data) return null;
    lset(API_SESSION_KEY, {token:data.token, expiresAt:data.expiresAt, role:data.role});
    bootstrapCache = null;
    return data.role === 'staff' ? 'user' : data.role;
  }catch(e){ console.error('login failed', e); return null; }
}
/* Returns {adminPin,userPin,cloudPassword,supabaseUrl,supabaseKey} if the
   password is correct, else null. */
async function appGetCloudConfig(cloudPassword){
  return await rpcCall('app_get_cloud_config', { p_cloud_password: cloudPassword });
}
/* Returns {adminPin,userPin} if the given admin PIN is currently correct,
   else null. Used only to prefill the Settings form for an admin who is
   already authenticated this session. */
async function appGetPins(currentAdminPin){
  return null; // PINs are intentionally never returned by the server.
}
/* Returns true if currentAdminPin matched and the PINs were updated. */
async function appSetPins(currentAdminPin, newAdminPin, newUserPin){
  const res = await apiFetch('admin/pins', {method:'POST',body:JSON.stringify({adminPin:newAdminPin,staffPin:newUserPin})});
  return !!res?.ok;
}
/* Returns true if cloudPassword matched and the cloud config was updated. */
async function appSetCloudConfig(cloudPassword, newUrl, newKey, newPassword){
  return false; // Cloud connection configuration is no longer a browser feature.
}
