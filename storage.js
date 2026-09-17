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
/* Supabase REST (PostgREST) helpers. Table: public.app_data (key text primary key, value jsonb).
   Used for 'shared' keys (suppliers/items/units/orderHistory) so every device
   (kitchen phone, admin phone, etc.) reads and writes the same data. The
   'settings' key (PINs, cloud password) is deliberately NOT readable or
   writable through this generic path -- RLS blocks anon access to it
   entirely. It's only reachable through the narrow RPC functions below.
   'lang' (shared=false) stays device-local only, since it's just a
   per-phone display preference. */
function cloudConfigured(){
  return !!(state.settings && state.settings.supabaseUrl && state.settings.supabaseKey);
}
async function cloudGet(key){
  if(!cloudConfigured()) return undefined;
  try{
    const res = await fetch(
      `${state.settings.supabaseUrl}/rest/v1/app_data?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: { apikey: state.settings.supabaseKey, Authorization: `Bearer ${state.settings.supabaseKey}` } }
    );
    if(!res.ok) return undefined;
    const rows = await res.json();
    return rows.length ? rows[0].value : null;
  }catch(e){ console.error('cloud get failed', e); return undefined; }
}
async function apiCall(action, payload={}){
  const token=lget('ricottaSession')?.token;
  const res=await fetch(`${SUPABASE_URL}/functions/v1/ricotta-api`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...payload})});
  const data=await res.json(); if(!res.ok) throw new Error(data.error||'Request failed'); return data;
}
async function refreshFromServer(){
  const data=await apiCall('bootstrap');
  state.suppliers=data.suppliers||[];
  state.items=(data.items||[]).map(i=>({id:i.id,name:i.name,unit:i.unit_id,supplierId:i.supplier_id}));
  state.units=data.units||[];
  state.history=(data.orders||[]).filter(o=>o.status==='sent').map(o=>({id:o.id,date:o.sent_at||o.created_at,entries:[{supplierId:o.supplier_id||'__none',items:(o.order_lines||[]).map(l=>({itemId:l.item_id,name:l.item_name,unit:l.unit_id,qty:l.quantity}))}]}));
}
async function cloudSet(key, value){
  if(!cloudConfigured()) return;
  try{
    await fetch(`${state.settings.supabaseUrl}/rest/v1/app_data?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: state.settings.supabaseKey,
        Authorization: `Bearer ${state.settings.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
    });
  }catch(e){ console.error('cloud set failed', e); }
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
  if(shared && lget('ricottaSession')){
    if(key==='suppliers') await apiCall('catalog',{table:'suppliers',rows:value});
    if(key==='units') await apiCall('catalog',{table:'units',rows:value});
    if(key==='items') await apiCall('catalog',{table:'items',rows:value.map(i=>({id:i.id,name:i.name,unit_id:i.unit,supplier_id:i.supplierId}))});
  }
}

/* ============ Settings RPCs ============
   The 'settings' row (adminPin, userPin, cloudPassword, supabaseUrl,
   supabaseKey) never comes back from a plain SELECT -- these call
   SECURITY DEFINER Postgres functions instead, each of which requires
   the caller to already know the relevant PIN/password before it will
   reveal or change anything. See ricotta-supabase-setup.sql. */
async function rpcCall(fnName, params){
  if(!cloudConfigured()) return null;
  try{
    const res = await fetch(`${state.settings.supabaseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        apikey: state.settings.supabaseKey,
        Authorization: `Bearer ${state.settings.supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    if(!res.ok) return null;
    return await res.json();
  }catch(e){ console.error('rpc call failed:', fnName, e); return null; }
}
/* Returns 'admin', 'user', or null. */
async function appVerifyPin(pin){
  try{ const r=await apiCall('login',{pin}); lset('ricottaSession',{token:r.token,role:r.role,expiresAt:r.expiresAt}); await refreshFromServer(); return r.role; }catch(e){ return null; }
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
  return await rpcCall('app_get_pins', { p_current_admin_pin: currentAdminPin });
}
/* Returns true if currentAdminPin matched and the PINs were updated. */
async function appSetPins(currentAdminPin, newAdminPin, newUserPin){
  return await rpcCall('app_set_pins', {
    p_current_admin_pin: currentAdminPin, p_new_admin_pin: newAdminPin, p_new_user_pin: newUserPin
  });
}
/* Returns true if cloudPassword matched and the cloud config was updated. */
async function appSetCloudConfig(cloudPassword, newUrl, newKey, newPassword){
  return await rpcCall('app_set_cloud_config', {
    p_cloud_password: cloudPassword, p_new_url: newUrl, p_new_key: newKey, p_new_password: newPassword
  });
}
