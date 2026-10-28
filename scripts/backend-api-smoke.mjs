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
let requestAllowed=true,newResult={ok:true};
const db = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (errors.has(name)) return { data: null, error: { message: 'offline' } };
    if (name === 'app_internal_reserve_requests') return {data: requestAllowed, error: errors.has(name)?{message:'offline'}:null};
    if (name === 'app_internal_reserve_login') {
      if (reservation) tables.app_login_attempts.push(...reservation.map(id => ({ id, succeeded: false })));
      return { data: reservation, error: null };
    }
    if (name === 'app_internal_start_session') {
      if (errors.has('app_sessions:insert')) return {data:null,error:{message:'offline'}};
      if (!['rozha','yunis'].includes(match)) return {data:{error:'invalid_credentials'},error:null};
      for(const row of tables.app_login_attempts) if(args.p_attempt_ids.includes(row.id)) row.succeeded=true;
      if(args.p_device && tables.app_sessions.some(row=>row.device_id===args.p_device && row.account!==match && row.revoked_at===null && row.expires_at>new Date().toISOString())) return {data:{error:'device_in_use'},error:null};
      return {data:{account:match,name:'Test account',expiresAt:new Date(Date.now()+60000).toISOString()},error:null};
    }
    if (['app_internal_item_undo','app_internal_diagnostics'].includes(name)) return {data:newResult,error:null};
    if (['app_internal_security_event','app_internal_add_usage','app_internal_report_problems','app_internal_unlock_signin'].includes(name)) return {data:1,error:null};
    if (name === 'app_internal_security_summary') return {data:{wrongPins24h:0,events:[]},error:null};
    if (name === 'app_internal_catalog_report') return {data:{items:{},suppliers:{}},error:null};
    if (name === 'app_internal_set_roles') return {data:args.p_roles,error:null};
    if (name === 'app_internal_usage_summary') return {data:{people:[],devices:[],days:[]},error:null};
    if (name === 'app_internal_check_account_pin') return { data: args.p_pin === '482916', error: null };
    if (name === 'app_internal_set_pin') return { data: pinResult, error: null };
    if (['app_internal_logout','app_internal_catalog_change','app_internal_device_command','app_internal_delete_order'].includes(name)) return {data:null,error:null};
    if (name === 'app_internal_save_order') return { data: saved, error: null };
    if (name === 'app_internal_streak_hit') return { data: { count: 1, best: 1, changed: true, milestone: false }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  },
  from(table) {
    let action = 'read', change, selected = false, from = 0, to = Infinity;
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
      return { data: action === 'read' || selected ? matching.slice(from,to+1).map(row => ({ ...row })) : null, count: matching.length, error: null };
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
      range(start,end) { from=start; to=end; return q; }, order() { return q; }, limit() { return q; },
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
  reset();
  assert.equal((await call('admin/diagnostics',null,'GET',false)).status,401);
  tables.app_sessions[0].account='yunis';tables.app_devices[0].account='yunis';
  assert.equal((await call('admin/diagnostics',null,'GET')).status,403);
  assert.equal(calls.some(c=>c.name==='app_internal_diagnostics'),false,'staff cannot trigger the privileged diagnostic RPC');
  reset();newResult={checkedAt:new Date().toISOString(),database:true,jobs:[]};
  assert.equal((await call('admin/diagnostics',null,'GET')).status,200);
  assert.deepEqual(calls.find(c=>c.name==='app_internal_diagnostics').args,{p_actor:'rozha'});
  errors.set('app_internal_diagnostics',true);assert.equal((await call('admin/diagnostics',null,'GET')).status,503);
  reset();newResult={ok:true,undoId:'12345678-1234-1234-1234-123456789abc'};
  const deleted=await call('items/tomato',{},'DELETE');assert.equal(deleted.status,200);assert.ok((await deleted.json()).undoId);
  assert.deepEqual(calls.find(c=>c.name==='app_internal_item_undo').args,{p_id:'tomato',p_actor:'rozha',p_device:'device-1',p_restore:false});
  assert.equal((await call('items/restore',{undoId:'invalid'},'POST')).status,400);
  assert.equal((await call('items/restore',{undoId:newResult.undoId},'POST')).status,200);
  assert.equal(calls.filter(c=>c.name==='app_internal_item_undo').at(-1).args.p_restore,true);
  newResult={error:'undo_expired'};assert.equal((await call('items/restore',{undoId:'12345678-1234-1234-1234-123456789abc'},'POST')).status,409);
  errors.set('app_internal_item_undo',true);assert.equal((await call('items/tomato',{},'DELETE')).status,503);
  reset();newResult={ok:true};
  assert.equal((await call('items/merge',{keepId:'a',removeId:'b'})).status,404,'item merging was removed');
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
  for(const [path,method,body] of [['devices/command','POST',{ids:['peer'],type:'logout'}],['admin/pin','PUT',{account:'yunis',currentPin:'482916',newPin:'591837'}],['admin/security','GET',null],['admin/problems','GET',null],['admin/roles','PUT',{account:'yunis',roles:['history']}],['admin/usage','GET',null],['admin/rico','GET',null],['admin/ai','GET',null],['rico/orders','GET',null]])assert.equal((await call(path,body,method)).status,403,`staff cannot use ${path}`);
  assert.equal((await call('push/send',{type:'update'},'POST')).status,400,'the old update notification no longer exists');
  // Yunis's roles are checked on the server: without them each route answers 403.
  reset();tables.app_sessions[0].account='yunis';tables.app_devices[0].account='yunis';tables.app_sessions[0].app_accounts={roles:['history']};
  for(const [path,method,body] of [['orders','POST',{id:'o-role',entries:[{supplierId:'supplier',items:[{itemId:'tomato',name:'Tomatoes',qty:1}]}]}],['items/tomato','PUT',{name:'Tomatoes'}],['items/tomato','DELETE',{}],['suppliers/supplier','PUT',{name:'S'}],
    ['supplier-order/supplier','PUT',{itemIds:['tomato']}],['activity','GET',null],['assistant/inbox','GET',null],['rico-chats','GET',null],['streak/recover','POST',{}],['stock-items','GET',null],
    ['push/send','POST',{type:'assistant',bodyEn:'x'}],['push/send','POST',{type:'reminder-now'}],['reports/catalog','GET',null],['reminder','PUT',{enabled:true,time:'09:00'}]])
    assert.equal((await call(path,body,method)).status,403,`without the role, staff cannot use ${method} ${path}`);
  assert.equal((await call('months',null,'GET')).status,200,'the history role still opens the month archive');
  reset();tables.app_sessions[0].account='yunis';tables.app_devices[0].account='yunis';
  const yunisBoot=await call('bootstrap',null,'GET');assert.deepEqual((await yunisBoot.json()).roles,['history','manage','catalog','record','assistant','send','exports','notify','reminders'],'Yunis has the standard set until Rozha changes it');
  assert.equal((await call('problems',{reports:[{fingerprint:'0123456789abcdef',kind:'error',message:'boom'}]},'POST')).status,200,'any signed-in phone can report a problem');
  assert.equal((await call('problems',{reports:[{fingerprint:'nothex',kind:'error',message:'boom'}]},'POST')).status,400,'problem reports are validated');
  // A long message is cut at 500 characters without splitting an emoji, and control characters are dropped.
  assert.equal((await call('problems',{reports:[{fingerprint:'0123456789abcdef',kind:'error',message:'x'.repeat(499)+'\u{1F600}tail\u0007',stack:'a\r\nb'}]},'POST')).status,200);
  const kept=calls.filter(c=>c.name==='app_internal_report_problems').at(-1).args.p_reports[0];
  assert.equal(Array.from(kept.message).length,500);assert.ok(kept.message.endsWith('\u{1F600}'),'the emoji at the limit stays whole');
  assert.equal(kept.stack,'a\nb');
  assert.equal((await call('problems',{reports:Array.from({length:11},()=>({fingerprint:'0123456789abcdef',kind:'error',message:'x'}))},'POST')).status,400,'at most 10 reports at once');
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
  assert.equal(calls.some(c => c.name === 'app_internal_start_session'), false, 'quota is reserved before expensive PIN verification');
  reset(); errors.set('app_internal_reserve_login', true);
  assert.equal((await call('login', { pin: '432198' }, 'POST', false)).status, 500);
  assert.equal(calls.some(c => c.name === 'app_internal_start_session'), false, 'broken rate limit cannot disable PIN protection');
  reset(); errors.set('app_sessions:insert', true);
  const failedLogin = await call('login', { pin: '432198' }, 'POST', false);
  assert.equal(failedLogin.status, 503);
  assert.equal((await failedLogin.json()).token, undefined, 'session write failures never return a token');
  reset();
  assert.equal((await call('login', { pin: '432198' }, 'POST', false)).status, 200);
  assert.equal(tables.app_login_attempts.every(row => row.succeeded), true);
  assert.equal(calls.some(c=>['app_sessions','app_devices'].includes(c.table) && ['insert','upsert'].includes(c.action)),false,'sign-in writes stay inside one database transaction');
  reset(); match=null;
  assert.equal((await call('login',{pin:'432198'},'POST',false)).status,401);
  assert.equal(tables.app_login_attempts.every(row=>!row.succeeded),true,'wrong PINs retain their failed reservations');

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
  reset();
  tables.app_items = Array.from({length:1005},(_,i)=>({id:'i'+i,name:'Item '+i}));
  tables.app_suppliers = Array.from({length:1002},(_,i)=>({id:'s'+i,name:'Supplier '+i}));
  tables.app_units = Array.from({length:1001},(_,i)=>({id:'u'+i,en:'Unit '+i}));
  const largeBoot = await (await call('bootstrap',undefined,'GET')).json();
  assert.equal(largeBoot.items.length,1005,'bootstrap keeps items past the first database page');
  assert.equal(largeBoot.suppliers.length,1002);
  assert.equal(largeBoot.units.length,1001);


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
  assert.equal(calls.some(c=>c.table==='app_audit_events' && c.action==='insert'),false,'the PIN function records its audit event atomically');
  reset(); pinResult='forbidden';
  assert.equal((await call('admin/pin',{account:'yunis',currentPin:'482916',newPin:'591837'},'PUT')).status,403,'a session revoked before the commit cannot change a PIN');
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
  for(const [path,method] of [['notes','GET'],['notes','POST'],['notes/1/read','POST'],['repeat-orders','GET'],['repeat-orders','POST'],['assistant/status','GET'],['assistant/setup-status','GET'],['assistant/groq-key','PUT'],['admin/ai/key','PUT'],['admin/ai/key','DELETE']])assert.equal((await call(path,method==='GET'?null:{},method)).status,404,`${path} is retired`);
  // F15: a usage batch goes to the database with its id; a database problem is a 503 (the phone keeps the batch).
  reset();
  assert.equal((await call('devices/me', { seconds: 60, batch: '11111111-1111-4111-8111-111111111111' })).status, 200);
  assert.equal(calls.find(c => c.name === 'app_internal_add_usage').args.p_batch, '11111111-1111-4111-8111-111111111111');
  reset(); errors.set('app_internal_add_usage', true);
  assert.equal((await call('devices/me', { seconds: 60, batch: '11111111-1111-4111-8111-111111111111' })).status, 503, 'the phone sends the batch again later');
  // F17: problem reports never keep PINs, tokens, keys, long numbers or web address details.
  reset();
  assert.equal((await call('problems', { reports: [{ fingerprint: 'a'.repeat(16), kind: 'console', message: 'login 482916 failed token=abcdefghijklmnopqrstuvwxyz0123456789 sk-ant-api03-SECRETSECRET https://x.test/a?pin=482916 call 0750 969 2627', stack: 'Bearer abc.def.ghi' }] })).status, 200);
  const stored = calls.find(c => c.name === 'app_internal_report_problems').args.p_reports[0];
  assert.doesNotMatch(JSON.stringify(stored), /482916|abcdefghijklmnop|SECRETSECRET|pin=|969 2627|abc\.def/, 'nothing sensitive is kept');
  assert.match(stored.message, /\[pin\].*\[token\]|\[token\].*\[pin\]/);
  // F28: a device only shows "signed in" while one of its sessions still works.
  reset();
  tables.app_devices = [{ id: 'device-1', account: 'rozha', logged_in: true }, { id: 'device-2', account: 'yunis', logged_in: true }];
  const devices = await (await call('devices', null, 'GET')).json();
  assert.deepEqual(devices.map(d => [d.id, d.loggedIn]), [['device-1', true], ['device-2', false]], 'an expired phone is not shown as signed in');
  // F27: saved Rico chats last 90 days; an older one can't be opened even by its id.
  reset();
  tables.app_rico_chats = [{ id: '33333333-3333-4333-8333-333333333333', account: 'rozha', title: 'old', messages: [], created_at: '2026-01-01T00:00:00Z', updated_at: new Date(Date.now() - 91 * 86400000).toISOString() },
    { id: '44444444-4444-4444-8444-444444444444', account: 'rozha', title: 'new', messages: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
  assert.equal((await call('rico-chats/33333333-3333-4333-8333-333333333333', null, 'GET')).status, 404);
  assert.equal((await call('rico-chats/44444444-4444-4444-8444-444444444444', null, 'GET')).status, 200);
  // F06: an edit that names its fields sends only those to the database; anything else is refused.
  reset();
  assert.equal((await call('items/tomato', { name: 'Cherry tomatoes', note: 'stale note', only: ['name'] }, 'PUT')).status, 200);
  assert.deepEqual(Object.keys(calls.find(c => c.name === 'app_internal_catalog_change').args.p_row).sort(), ['id', 'name', 'updated_at'], 'the stale note is not sent');
  reset();
  assert.equal((await call('items/tomato', { supplierId: 'supplier', sortOrder: null, only: ['supplierId'] }, 'PUT')).status, 200);
  assert.deepEqual(Object.keys(calls.find(c => c.name === 'app_internal_catalog_change').args.p_row).sort(), ['id', 'sort_order', 'supplier_id', 'updated_at']);
  reset();
  assert.equal((await call('suppliers/supplier', { phone: '0750 111 2222', only: ['phone'] }, 'PUT')).status, 200);
  assert.deepEqual(Object.keys(calls.find(c => c.name === 'app_internal_catalog_change').args.p_row).sort(), ['id', 'phone', 'updated_at']);
  reset();
  assert.equal((await call('items/tomato', { name: '', only: ['name'] }, 'PUT')).status, 400, 'a blank name is still refused');
  assert.equal((await call('items/tomato', { created_at: 'x', only: ['created_at'] }, 'PUT')).status, 400, 'unknown fields are refused');
  // F01: History and Record follow the roles everywhere, the start-up data too. Without History the phone gets
  // only today's orders and their suppliers (for "sent today"), with no items, amounts or earlier days.
  const staff = roles => { reset(); tables.app_sessions[0].account = 'yunis'; tables.app_devices[0].account = 'yunis'; tables.app_sessions[0].app_accounts = { roles }; };
  const seedOrders = () => {
    const now = new Date(), yesterday = new Date(Date.now() - 86400000);
    tables.app_orders = [{ id: 'o-today', status: 'sent', created_at: now.toISOString(), sent_at: now.toISOString(), sent_by: 'rozha' },
      ...(yesterday.toISOString() >= monthStart() ? [{ id: 'o-before', status: 'sent', created_at: yesterday.toISOString(), sent_at: yesterday.toISOString(), sent_by: 'rozha' }] : [])];
    tables.app_order_lines = [{ id: 1, order_id: 'o-today', supplier_id: 'supplier', supplier_name: 'Supplier', item_id: 'tomato', item_name: 'Tomatoes', unit_id: 'kg', qty: 5 },
      { id: 2, order_id: 'o-before', supplier_id: 'supplier', supplier_name: 'Supplier', item_id: 'tomato', item_name: 'Tomatoes', unit_id: 'kg', qty: 9 }];
    tables.app_month_summaries = [{ month: '2026-09', data: { orders: 41 } }];
  };
  staff([]); seedOrders();
  const staffBoot = await call('bootstrap', null, 'GET'); assert.equal(staffBoot.status, 200);
  let bootData = await staffBoot.json();
  assert.deepEqual(bootData.history.map(h => h.id), ['o-today'], 'no earlier days without History');
  assert.deepEqual(bootData.history[0].entries, [{ supplierId: 'supplier', supplierName: 'Supplier', items: [] }], 'only which supplier was sent today');
  assert.deepEqual(bootData.months, [], 'no past months without History');
  assert.equal(calls.some(c => c.table === 'app_month_summaries'), false);
  assert.equal((await call('months', null, 'GET')).status, 403);
  staff(['history']); seedOrders();
  bootData = await (await call('bootstrap', null, 'GET')).json();
  assert.equal(bootData.history.length, tables.app_orders.length, 'History shows every order this month');
  assert.equal(bootData.history[0].entries[0].items.length, 1);
  assert.equal(bootData.months.length, 1);
  // F05: a session check that cannot run is a 503 (the phone keeps its session); a bad session is a 401.
  reset(); errors.set('app_sessions:read', true);
  assert.equal((await call('bootstrap', null, 'GET')).status, 503, 'a database hiccup does not sign anyone out');
  reset(); errors.set('app_devices:read', true);
  assert.equal((await call('bootstrap', null, 'GET')).status, 503);
  reset(); tables.app_devices[0].account = 'yunis';
  assert.equal((await call('bootstrap', null, 'GET')).status, 401, 'a device of another account is refused');
  reset(); tables.app_sessions[0].revoked_at = new Date().toISOString();
  assert.equal((await call('bootstrap', null, 'GET')).status, 401);
  reset(); tables.app_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call('bootstrap', null, 'GET')).status, 401);
  for(const path of ['recovery/name','recovery/verify','recovery/save'])assert.equal((await call(path,{},'POST',false)).status,401,`${path} is retired`);
  // Live changes: the counters right away, an answer as soon as one moves, and only kinds and counters.
  reset();tables.app_signals=[{kind:'data',n:7,at:'x'},{kind:'devices',n:9,at:'x'},{kind:'secret',n:99}];
  const now=await (await call('signals?since=-1&wait=0',null,'GET')).json();
  assert.deepEqual(now,{n:9,kinds:{data:7,devices:9}},'kinds and counters only, unknown kinds ignored');
  let started=Date.now();
  setTimeout(()=>{tables.app_signals[0].n=10;},300);
  assert.deepEqual(await (await call('signals?since=9&wait=5',null,'GET')).json(),{n:10,kinds:{data:10,devices:9}},'a change ends the wait');
  assert.ok(Date.now()-started<2600,'within about a second');
  started=Date.now();
  assert.equal((await (await call('signals?since=10&wait=1',null,'GET')).json()).n,10,'nothing new: the same counter');
  assert.ok(Date.now()-started>=900,'after waiting');
  for(const bad of ['since=x','since=-2','since=1.5','since=1&wait=-1'])assert.equal((await call('signals?'+bad,null,'GET')).status,400,bad);
  assert.equal((await call('signals?since=1',null,'GET',false)).status,401,'a session is needed');
  tables.app_sessions[0].account='yunis';tables.app_devices[0].account='yunis';
  assert.equal((await call('signals?since=-1&wait=0',null,'GET')).status,200,'Yunis waits too');
  errors.set('app_signals:read',true);assert.equal((await call('signals?since=-1&wait=0',null,'GET')).status,500);
} finally { console.error = mute; }
console.log('Backend API smoke: PASS (fail-closed login, session persistence, atomic orders, strict quantities, subscription ownership, Admin PIN change, live change signals, locked Transfers, retired endpoints, edits that change only the fields they name, usage batches, redacted problem reports, real signed-in devices, History and Record roles in the start-up data, 503 when the session check cannot run)');
