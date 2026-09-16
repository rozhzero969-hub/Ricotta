/* Local + Supabase (cloud) persistence for Ricotta Orders.
   Depends on the global `state` object from app.js (only inside
   function bodies, so load order relative to app.js doesn't matter). */
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
   Used for 'shared' keys (suppliers/items/units/settings/orderHistory) so every device
   (kitchen phone, admin phone, etc.) reads and writes the same data. 'lang' (shared=false)
   stays device-local only, since it's just a per-phone display preference. */
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
}
