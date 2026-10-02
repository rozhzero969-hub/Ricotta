// Node 24+: push delivery, reminder eligibility, and decay use local mocks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody } from '../supabase/functions/_shared/security.ts';

let tables, queryError = '', rpcCalls, rowPages;
function reset() {
  const active = new Date(Date.now() + 60000).toISOString(), expired = new Date(Date.now() - 60000).toISOString();
  tables = {
    app_push_subscriptions: [
      { endpoint: 'https://fcm.googleapis.com/fcm/send/expired', device_id: 'expired' },
      { endpoint: 'https://web.push.apple.com/active', device_id: 'active' },
      { endpoint: 'https://fcm.googleapis.com/fcm/send/logout', device_id: 'logout' },
      { endpoint: 'https://127.0.0.1/internal', device_id: 'unsafe' },
      { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/legacy', device_id: null },
    ],
    app_devices: [
      { id: 'expired', account: 'rozha', logged_in: true }, { id: 'active', account: 'yunis', logged_in: true },
      { id: 'logout', account: 'rozha', logged_in: true, command: { id: 'command', type: 'logout' }, handled_command: null },
      { id: 'unsafe', account: 'yunis', logged_in: true },
    ],
    app_sessions: [
      { id: '1', device_id: 'expired', account: 'rozha', revoked_at: null, expires_at: expired },
      { id: '2', device_id: 'active', account: 'yunis', revoked_at: null, expires_at: active },
      { id: '3', device_id: 'logout', account: 'rozha', revoked_at: null, expires_at: active },
      { id: '4', device_id: 'unsafe', account: 'yunis', revoked_at: null, expires_at: active },
    ],
    app_item_pars: [{ item_id: 'tomato', last_decay_date: null }],
    app_orders: [{ id: 'order', status: 'sent', sent_at: new Date().toISOString() }],
    app_order_lines: Array.from({ length: 1001 }, (_, i) => ({ id: i, order_id: 'order', item_id: 'tomato', qty: 60 })),
    app_suppliers: [], app_reminder_settings: [], app_assistant_alerts: [], app_rico_inbox: [],
  };
  rpcCalls = []; rowPages = []; queryError = '';
}
const db = {
  rpc(name, args) { assert.equal(name, 'app_internal_decay_stock'); rpcCalls.push(args); return Promise.resolve({ data: true, error: null }); },
  from(table) {
    let action = 'read', change, range;
    const filters = [];
    const run = () => {
      if (table === queryError) return { data: null, error: { message: 'offline' } };
      let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      if (range) { rowPages.push({ table, range }); rows = rows.slice(range[0], range[1] + 1); }
      if (action === 'insert') tables[table] = [...(tables[table] ?? []), ...(Array.isArray(change) ? change : [change])];
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; }, order() { return q; }, or() { return q; }, not() { return q; },
      range(from, to) { range = [from, to]; return q; },
      eq(field, value) { filters.push(row => row[field] === value); return q; },
      is(field, value) { filters.push(row => row[field] === value); return q; },
      gt(field, value) { filters.push(row => row[field] > value); return q; },
      gte(field, value) { filters.push(row => row[field] >= value); return q; },
      in(field, values) { filters.push(row => values.includes(row[field])); return q; },
      insert(row) { action = 'insert'; change = row; return q; },
      maybeSingle() { const result = run(); return Promise.resolve({ ...result, data: result.data?.[0] ?? null }); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  },
};
let handler;
const environment = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', CRON_SECRET: 'test-cron-secret' };
const deno = { env: { get: key => environment[key] }, serve(fn) { handler = fn; } };
const source = (await readFile(new URL('../supabase/functions/send-push/index.ts', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const { loadSubs, stockDecayTick } = new Function('createClient', 'Deno', 'webpush', 'BodyTooLarge', 'InvalidBody', 'isPushEndpoint', 'readJsonBody', stripTypeScriptTypes(source) + '\nreturn { loadSubs, stockDecayTick };')(
  () => db, deno, { setVapidDetails() {}, sendNotification() { assert.fail('push must stay disabled without VAPID'); } }, BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody,
);
reset();
const reminder = await loadSubs(true);
assert.deepEqual(reminder.subs.map(s => s.device_id), ['active']);
assert.equal(reminder.subs[0].account, 'yunis');
assert.equal(reminder.skipped, 4, 'expired sessions, pending logouts, unsafe endpoints and unbound legacy subscriptions are excluded');
assert.equal((await loadSubs(false)).subs.length, 4, 'updates also exclude unsafe endpoints');
assert.deepEqual(await stockDecayTick(), { updated: 1, of: 1 });
assert.equal(rpcCalls[0].p_decay, 1001, 'all order lines beyond PostgREST\'s first 1000 rows contribute to decay');
assert.equal(rowPages.some(page => page.table === 'app_order_lines' && page.range[0] === 1000), true);
reset(); queryError = 'app_orders';
await assert.rejects(stockDecayTick());
assert.equal(rpcCalls.length, 0, 'failed history reads cannot overwrite stock estimates');
reset();
const req = (body, secret = true, method = 'POST') => new Request('https://example.supabase.co/functions/v1/send-push', {
  method, headers: secret ? { 'x-cron-secret': environment.CRON_SECRET } : {}, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
assert.equal((await handler(req({ type: 'reminder-tick' }, false))).status, 403);
assert.equal((await handler(req({}, true, 'GET'))).status, 405);
assert.equal((await handler(req('null'))).status, 400);
const tick = await handler(req({ type: 'reminder-tick' }));
assert.equal(tick.status, 200);
assert.equal((await tick.json()).stockDecay.updated, 1, 'cron still maintains stock when Web Push is unconfigured');
console.log('Backend push smoke: PASS (valid-session reminders, legacy SSRF defense, complete decay history, atomic decay RPC, no-VAPID maintenance)');
