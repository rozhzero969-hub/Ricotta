import {turnstileConfig,verifyTurnstile} from '../supabase/functions/_shared/turnstile.ts';
// Node 24+: execute the API handler with an in-memory database and no network.
import assert from 'node:assert/strict';
import {monthKey,monthStart} from '../supabase/functions/_shared/month.ts';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody, securityHeaders, acceptsJson } from '../supabase/functions/_shared/security.ts';

const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const token = 'test-session-token', tokenHash = await digest(token);
let tables, errors, calls, reservation, match, saved, pinResult;
function reset() {
  tables = {
    app_sessions: [{ id: 'session', token_hash: tokenHash, account: 'rozha', device_id: 'device-1', expires_at: new Date(Date.now() + 60000).toISOString(), last_seen_at: new Date().toISOString(), revoked_at: null }],
    app_accounts: [{ id: 'rozha', name: 'Rozha' }],
    app_items: [{ id: 'tomato', name: 'Tomatoes' }], app_suppliers: [{ id: 'supplier', name: 'Supplier' }],
    app_push_subscriptions: [], app_login_attempts: [], app_devices: [{id:"device-1",account:"rozha"}], app_rico_inbox: [], app_audit_events: [],
  };
  errors = new Map(); calls = []; reservation = [1, 2]; match = 'rozha'; saved = true; pinResult = 'ok';
}
let requestAllowed=true;
const db = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (errors.has(name)) return { data: null, error: { message: 'offline' } };
    if (name === 'app_internal_reserve_requests') return {data: requestAllowed, error: errors.has(name)?{message:'offline'}:null};
    if (name === 'app_internal_reserve_login') {
      if (reservation) tables.app_login_attempts.push(...reservation.map(id => ({ id, succeeded: false })));
      return { data: reservation, error: null };
    }
    if (name === 'app_internal_match_code') return { data: match, error: null };
    if (name === 'app_internal_check_account_pin') return { data: args.p_pin === '482916', error: null };
    if (name === 'app_internal_set_pin') return { data: pinResult, error: null };
    if (['app_internal_logout','app_internal_catalog_change','app_internal_device_command','app_internal_delete_order'].includes(name)) return {data:null,error:null};
    if (name === 'app_internal_save_order') return { data: saved, error: null };
    if (name === 'app_internal_streak_hit') return { data: { count: 1, best: 1, changed: true, milestone: false }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  },
  from(table) {
    let action = 'read', change, selected = false;
    const filters = [];
    const run = () => {
      calls.push({ table, action });
      if (errors.has(`${table}:${action}`)) return { data: null, error: { message: 'offline' } };
      const rows = tables[table] ?? [];
      const matching = rows.filter(row => filters.every(filter => filter(row)));
      if (action === 'insert') { rows.push(...(Array.isArray(change) ? change : [change])); tables[table] = rows; }
      if (action === 'update') for (const row of matching) Object.assign(row, change);
      if (action === 'delete') tables[table] = rows.filter(row => !matching.includes(row));
      if (action === 'upsert') for (const row of Array.isArray(change) ? change : [change]) {
        const existing = rows.find(existing => existing.id === row.id);
        existing ? Object.assign(existing, row) : rows.push(row);
        tables[table] = rows;
      }
      return { data: action === 'read' || selected ? matching.map(row => ({ ...row })) : null, count: matching.length, error: null };
    };
    const q = {
      select() { selected = true; return q; },
      eq(field, value) { filters.push(row => row[field] === value); return q; },
      neq(field, value) { filters.push(row => row[field] !== value); return q; },
      not(field, op, value) { filters.push(row => !(op === 'is' ? (row[field] ?? null) === value : row[field] === value)); return q; },
      in(field, values) { filters.push(row => values.includes(row[field])); return q; },
      is(field, value) { filters.push(row => row[field] === value); return q; },
      gt(field, value) { filters.push(row => row[field] > value); return q; },
      lt(field, value) { filters.push(row => row[field] < value); return q; },
      gte(field, value) { filters.push(row => row[field] >= value); return q; },
      range() { return q; }, order() { return q; }, limit() { return q; },
      insert(row) { action = 'insert'; change = row; return q; },
      update(row) { action = 'update'; change = row; return q; },
      upsert(row) { action = 'upsert'; change = row; return q; },
      delete() { action = 'delete'; return q; },
      maybeSingle() { const result = run(); return Promise.resolve({ ...result, data: result.data?.[0] ?? null }); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  },
};
let handler;
const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', SUPABASE_ANON_KEY: 'test' };
const deno = { env: { get: key => environment[key] }, serve(fn) { handler = fn; } };
const source = (await readFile(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const { groupHistory } = new Function('createClient', 'Deno', 'BodyTooLarge', 'InvalidBody', 'isPushEndpoint', 'readJsonBody', 'securityHeaders', 'acceptsJson', 'monthKey', 'monthStart', 'turnstileConfig', 'verifyTurnstile', stripTypeScriptTypes(source) + '\nreturn { groupHistory };')( () => db, deno, BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody, securityHeaders, acceptsJson, monthKey, monthStart,turnstileConfig,verifyTurnstile );
const call = (path, body, method = 'POST', auth = true) => handler(new Request(`https://example.supabase.co/functions/v1/api/${path}`, {
  method, headers: { 'content-type': 'application/json', ...(auth ? { 'x-session-token': token, 'x-device-id': 'device-1' } : {}) },
  ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
}));
const mute = console.error;
console.error = () => {};
try {
  const history = groupHistory([{ id: 'archived', sent_at: '2026-10-01T12:00:00Z' }], [
    { order_id: 'archived', supplier_id: null, supplier_name: 'Former supplier A', item_id: 'a', item_name: 'Tomatoes', qty: 2 },
    { order_id: 'archived', supplier_id: null, supplier_name: 'Former supplier B', item_id: 'b', item_name: 'Apples', qty: 3 },
  ]);
  assert.equal(history[0].entries.length, 2, 'deleting suppliers preserves their separate historical order sections');
  reset();
  const foreign = await handler(new Request('https://example.supabase.co/functions/v1/api/orders',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json','x-session-token':token},body:'{}'}));
  assert.equal(foreign.status,403);assert.equal(calls.length,0,'foreign origins cannot touch the database');
  assert.equal((await handler(new Request('https://example.supabase.co/functions/v1/api/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}))).status,415);
  const preflight=await handler(new Request('https://example.supabase.co/functions/v1/api/orders',{method:'OPTIONS',headers:{Origin:'https://rozhzero969-hub.github.io'}}));
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://rozhzero969-hub.github.io');
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
  const locked=await call('devices/command',{ids:['peer'],type:'logout'},'POST',false);assert.equal(locked.status,401);
  reset();requestAllowed=false;
  const throttled=await call('orders',{});assert.equal(throttled.status,429);assert.equal(throttled.headers.get('Retry-After'),'60');
  assert.equal(calls.some(c=>c.name==='app_internal_save_order'),false);
  requestAllowed=true;reset();errors.set('app_internal_reserve_requests',true);
  assert.equal((await call('orders',{})).status,503,'request limits fail closed');
  reset();tables.app_sessions[0].account='yunis';tables.app_devices[0].account='yunis';
  for(const [path,method,body] of [['devices/command','POST',{ids:['peer'],type:'logout'}],['assistant/setup-status','GET',null],['assistant/groq-key','PUT',{key:'fake'}],['admin/pin','PUT',{account:'yunis',currentPin:'482916',newPin:'591837'}],['push/send','POST',{type:'update'}]])assert.equal((await call(path,body,method)).status,403,`staff cannot use ${path}`);
  assert.equal((await call('reminder',{enabled:true,time:'09:00'},'PUT')).status,200,'staff can set the daily reminder offered on their Settings screen');
  reset();tables.app_sessions[0].account='yunis';tables.app_devices[0].account='yunis';tables.app_sessions[0].device_id=null;
  for(const [path,method] of [['push/subscription','DELETE'],['push/lang','PUT']])assert.equal((await call(path,{endpoint:'https://fcm.googleapis.com/fcm/send/orphan',lang:'en'},method)).status,403,'device-less staff sessions cannot modify orphan subscriptions');
  reset();requestAllowed=false;
  assert.equal((await call('logout',{})).status,200,'logout remains available even when the request budget is exhausted');requestAllowed=true;
  reset();
  const secured=await call('streak',null,'GET');
  for(const [name,value] of [['Cache-Control','no-store'],['X-Content-Type-Options','nosniff'],['X-Frame-Options','DENY']])assert.equal(secured.headers.get(name),value);
  reset();
  for (const malformed of ['null', '[]', '{broken']) assert.equal((await call('orders', malformed)).status, 400);
  assert.equal((await call('orders', { payload: 'ڕ'.repeat(140000) })).status, 413);
  tables.app_sessions[0].expires_at = 'invalid-date';
  assert.equal((await call('orders', {})).status, 401, 'invalid session dates fail closed');

  reset();errors.set('app_internal_logout',true);
  assert.equal((await call('logout',{})).status,503,'failed revocation is never reported as success');
  reset();errors.set('app_internal_device_command',true);
  assert.equal((await call('devices/command',{ids:['device-1'],type:'logout'})).status,503,'failed device command is never reported as success');
  reset();errors.set('app_internal_catalog_change',true);
  assert.equal((await call('items/tomato',{name:'Tomatoes'},'PUT')).status,500);
  reset(); reservation = null;
  assert.equal((await call('login', { pin: '432198' }, 'POST', false)).status, 429);
  assert.equal(calls.some(c => c.name === 'app_internal_match_code'), false, 'quota is reserved before expensive PIN verification');
  reset(); errors.set('app_internal_reserve_login', true);
  assert.equal((await call('login', { pin: '432198' }, 'POST', false)).status, 500);
  assert.equal(calls.some(c => c.name === 'app_internal_match_code'), false, 'broken rate limit cannot disable PIN protection');
  reset(); errors.set('app_sessions:insert', true);
  const failedLogin = await call('login', { pin: '432198' }, 'POST', false);
  assert.equal(failedLogin.status, 503);
  assert.equal((await failedLogin.json()).token, undefined, 'session write failures never return a token');
  reset();
  assert.equal((await call('login', { pin: '432198' }, 'POST', false)).status, 200);
  assert.equal(tables.app_login_attempts.every(row => row.succeeded), true);

  reset();tables.app_devices[0].account='yunis';
  assert.equal((await call('devices',null,'GET')).status,401,'a session cannot control a device currently bound to another account');
  reset();match='yunis';
  const takeover=await handler(new Request('https://example.supabase.co/functions/v1/api/login',{method:'POST',headers:{'content-type':'application/json','x-device-id':'device-1'},body:JSON.stringify({pin:'739152'})}));
  assert.equal(takeover.status,409,'a valid staff PIN cannot take over an active admin device ID');
  assert.equal(tables.app_devices[0].account,'rozha');
  assert.equal(calls.some(c=>c.table==='app_sessions' && c.action==='insert'),false,'conflicting device login issues no new token');
  reset();
  const validOrder = { id: 'order-1', date: new Date().toISOString(), entries: [{ supplierId: 'supplier', items: [{ itemId: 'tomato', name: 'Tomatoes', unit: 'kg', qty: 5 }] }] };
  assert.equal((await call('orders', validOrder)).status, 200);
  const save = calls.find(c => c.name === 'app_internal_save_order');
  assert.deepEqual(save.args.p_lines, [{ supplier_id: 'supplier', supplier_name: 'Supplier', item_id: 'tomato', item_name: 'Tomatoes', unit_id: 'kg', qty: 5 }]);
  assert.equal(calls.some(c => c.table === 'app_orders' || c.table === 'app_order_lines'), false, 'the API delegates all order writes to one transaction');
  assert.match(calls.find(c => c.name === 'app_internal_streak_hit')?.args.p_day ?? '', /^\d{4}-\d{2}-\d{2}$/, 'a saved order counts toward the kitchen streak on its Baghdad day');
  reset(); saved = false;
  assert.equal((await call('orders', validOrder)).status, 200);
  assert.equal(tables.app_rico_inbox.length, 0, 'idempotent retries do not emit another cheer');
  assert.equal(calls.some(c => c.name === 'app_internal_streak_hit'), false, 'idempotent retries do not count the day twice');
  for (const qty of [0, -1, 'NaN', 'Infinity', 100000]) {
    reset();
    const invalid = structuredClone(validOrder); invalid.entries[0].items[0].qty = qty;
    assert.equal((await call('orders', invalid)).status, 400, `reject quantity ${qty}`);
    assert.equal(calls.some(c => c.name === 'app_internal_save_order'), false);
  }
  reset();
  const fastClock = structuredClone(validOrder); fastClock.date = new Date(Date.now() + 10 * 60000).toISOString();
  assert.equal((await call('orders', fastClock)).status, 200, 'a phone whose clock runs fast can still save its order');
  assert.ok(Date.parse(calls.find(c => c.name === 'app_internal_save_order').args.p_date) <= Date.now(), 'a time in the future is saved as now');
  reset();
  const lastMonth = structuredClone(validOrder); lastMonth.date = new Date(Date.parse(monthStart()) - 60000).toISOString();
  assert.equal((await call('orders', lastMonth)).status, 409, 'an order from last month is still refused');
  reset();
  const noItemId = structuredClone(validOrder); delete noItemId.entries[0].items[0].itemId;
  assert.equal((await call('orders', noItemId)).status, 200);
  assert.equal(calls.find(c => c.name === 'app_internal_save_order').args.p_lines[0].item_id, null, 'a line without an item id is saved without one');
  reset();
  assert.equal((await call('push/subscription', { endpoint: 'https://127.0.0.1/internal' }, 'PUT')).status, 400);
  tables.app_push_subscriptions.push({ endpoint: 'https://fcm.googleapis.com/fcm/send/peer', device_id: 'device-2' });
  assert.equal((await call('push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/peer', p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }, 'PUT')).status, 403, 'another device cannot overwrite a subscription');

  reset();
  Object.assign(tables, { app_units: [], app_orders: [], app_order_lines: [], app_reminder_settings: [] });
  const bootRes = await call('bootstrap', undefined, 'GET'); const boot = await bootRes.json(); assert.equal(bootRes.status, 200);
  assert.equal(boot.tabs,undefined);
  assert.equal(boot.theme,undefined);

  // History: only Rozha removes orders. Her own for 15 minutes; any other takes her PIN, and a wrong
  // PIN counts as a failed sign-in. Yunis cannot remove any (he asks her).
  const fresh = new Date().toISOString(), old = new Date(Date.now() - 3600_000).toISOString();
  const deletes = () => calls.filter(c => c.name === 'app_internal_delete_order');
  reset(); tables.app_orders = [{ id: 'fresh', created_by: 'rozha', created_at: fresh }, { id: 'old', created_by: 'rozha', created_at: old }];
  assert.equal((await call('orders/fresh', {}, 'DELETE')).status, 200, 'Rozha can undo her fresh order');
  assert.equal((await call('orders/old', {}, 'DELETE')).status, 403, 'an older order needs Rozha\u2019s PIN');
  assert.equal(deletes().length, 1);
  assert.equal((await call('orders/old', { pin: '111111' }, 'DELETE')).status, 403, 'a wrong PIN deletes nothing');
  assert.equal(deletes().length, 1);
  assert.ok(calls.some(c => c.name === 'app_internal_reserve_login'), 'a wrong PIN counts as a failed sign-in');
  assert.equal((await call('orders/old', { pin: '482916' }, 'DELETE')).status, 200, 'Rozha\u2019s PIN deletes it');
  assert.equal(deletes().at(-1).args.p_actor, 'rozha');
  reset(); tables.app_sessions[0].account = 'yunis'; tables.app_devices[0].account = 'yunis';
  tables.app_orders = [{ id: 'mine', created_by: 'yunis', created_at: fresh }, { id: 'old', created_by: 'yunis', created_at: old }];
  assert.equal((await call('orders/mine', {}, 'DELETE')).status, 403, 'Yunis cannot undo even his own fresh order');
  assert.equal((await call('orders/old', { pin: '482916' }, 'DELETE')).status, 403, 'not even with Rozha\u2019s PIN');
  assert.equal(deletes().length, 0);
  assert.equal(calls.some(c => c.name === 'app_internal_check_account_pin'), false, 'and no PIN is checked for him');
  reset(); reservation = null; tables.app_orders = [{ id: 'old', created_by: 'rozha', created_at: old }];
  assert.equal((await call('orders/old', { pin: '482916' }, 'DELETE')).status, 429, 'after too many wrong PINs deleting waits too');
  assert.equal(deletes().length, 0);

  // Admin -> PINs: Rozha's current PIN first (a wrong one counts as a failed sign-in), no weak PINs.
  reset();
  assert.equal((await call('admin/pin',{account:'yunis',currentPin:'000000',newPin:'591837'},'PUT')).status,403,'a wrong current PIN changes nothing');
  assert.equal(calls.some(c=>c.name==='app_internal_set_pin'),false);
  assert.equal(tables.app_login_attempts.every(row=>!row.succeeded),true,'and counts as a failed sign-in');
  reset();
  assert.equal((await call('admin/pin',{account:'yunis',currentPin:'482916',newPin:'123456'},'PUT')).status,400,'a weak PIN is refused');
  assert.equal(calls.some(c=>c.name==='app_internal_reserve_login'),false,'before any PIN is checked');
  reset();
  assert.equal((await call('admin/pin',{account:'staff',currentPin:'482916',newPin:'591837'},'PUT')).status,400);
  reset(); reservation = null;
  assert.equal((await call('admin/pin',{account:'yunis',currentPin:'482916',newPin:'591837'},'PUT')).status,429,'the sign-in limits apply');
  reset();
  assert.equal((await call('admin/pin',{account:'yunis',currentPin:'482916',newPin:'591837'},'PUT')).status,200);
  assert.deepEqual(calls.find(c=>c.name==='app_internal_set_pin').args,{p_account:'yunis',p_pin:'591837',p_keep_session:'session'},'this session stays signed in');
  assert.equal(calls.find(c=>c.name==='app_internal_check_account_pin').args.p_account,'rozha','the current PIN checked is always Rozha\'s');
  assert.equal(tables.app_audit_events.at(-1).action,'change_pin');
  reset(); pinResult = 'duplicate';
  assert.equal((await (await call('admin/pin',{account:'rozha',currentPin:'482916',newPin:'591837'},'PUT')).json()).error,'duplicate_pin');
  // Transfers is still being made: its routes refuse.
  reset();
  for(const [path,method] of [['stock-items','GET'],['stock-items','PUT'],['stock-items/x/alias','POST'],['stock/read','POST']])assert.equal((await call(path,method==='GET'?null:{},method)).status,423,`${path} waits for Transfers`);

  // Retired sign-in and personalization endpoints are no longer reachable.
  reset();
  for(const path of ['passkey/register-options','passkey/register','passkey'])assert.equal((await call(path,{})).status,404);
  for(const path of ['passkey/login-options','passkey/login'])assert.equal((await call(path,{},'POST',false)).status,401);
  for(const path of ['me/theme','me/tabs'])assert.equal((await call(path,{},'PUT')).status,404);
  // Kitchen notes, repeat orders and the secret code are gone too.
  for(const [path,method] of [['notes','GET'],['notes','POST'],['notes/1/read','POST'],['repeat-orders','GET'],['repeat-orders','POST']])assert.equal((await call(path,method==='GET'?null:{},method)).status,404,`${path} is retired`);
  for(const path of ['recovery/name','recovery/verify','recovery/save'])assert.equal((await call(path,{},'POST',false)).status,401,`${path} is retired`);
} finally { console.error = mute; }
console.log('Backend API smoke: PASS (fail-closed login, session persistence, atomic orders, strict quantities, subscription ownership, Admin PIN change, locked Transfers, retired endpoints)');
