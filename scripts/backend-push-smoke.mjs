// Node 24+: push delivery, reminder eligibility, use local mocks (no network: the weather service is stubbed too).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody } from '../supabase/functions/_shared/security.ts';

let tables, queryError = '', rpcCalls, rowPages, recoveryCalls, weatherCalls;
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
    app_orders: [{ id: 'order', status: 'sent', sent_at: new Date().toISOString() }],
    app_order_lines: Array.from({ length: 1001 }, (_, i) => ({ id: i, order_id: 'order', item_id: 'tomato', qty: 60 })),
    app_suppliers: [], app_reminder_settings: [], app_assistant_alerts: [], app_rico_inbox: [],
  };
  rpcCalls = []; rowPages = []; queryError = ''; recoveryCalls = 0; weatherCalls = [];
}
const db = {
  rpc(name, args) {
  },
  from(table) {
    let action = 'read', change, range, conflict;
    const filters = [];
    const run = () => {
      if (table === queryError) return { data: null, error: { message: 'offline' } };
      let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      if (range) { rowPages.push({ table, range }); rows = rows.slice(range[0], range[1] + 1); }
      if (action === 'insert') tables[table] = [...(tables[table] ?? []), ...(Array.isArray(change) ? change : [change])];
      if (action === 'update') for (const row of rows) Object.assign(row, change);
      if (action === 'upsert') {
        // Rico's alerts and inbox must never overwrite an earlier copy; a plain upsert replaces the row.
        if (table === 'app_assistant_alerts' || table === 'app_rico_inbox') assert.equal(conflict?.ignoreDuplicates, true);
        const all = tables[table] ?? (tables[table] = []);
        const key = conflict?.onConflict ?? 'id';
        rows = [];
        for(const row of Array.isArray(change) ? change : [change]){
          const existing = all.find(old => old[key] === row[key]);
          if(!existing){ all.push(row); rows.push(row); }
          else if(!conflict?.ignoreDuplicates){ Object.assign(existing, row); rows.push(existing); }
        }
      }
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; }, order() { return q; }, or() { return q; }, not() { return q; }, limit() { return q; },
      range(from, to) { range = [from, to]; return q; },
      eq(field, value) { filters.push(row => row[field] === value); return q; },
      is(field, value) { filters.push(row => row[field] === value); return q; },
      gt(field, value) { filters.push(row => row[field] > value); return q; },
      gte(field, value) { filters.push(row => row[field] >= value); return q; },
      lt(field, value) { filters.push(row => row[field] < value); return q; },
      in(field, values) { filters.push(row => values.includes(row[field])); return q; },
      insert(row) { action = 'insert'; change = row; return q; },
      upsert(row, options) { action = 'upsert'; change = row; conflict = options; return q; },
      update(row) { action = 'update'; change = row; return q; },
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
// Erbil's weather comes from Open-Meteo: answered here, so the test never reaches the internet.
const weather = { current: { temperature_2m: 12.4, weather_code: 61, precipitation: 0.4 },
  daily: { temperature_2m_max: [15], temperature_2m_min: [8], precipitation_probability_max: [80], weather_code: [61] } };
const fetchStub = async (url) => {
  assert.match(String(url), /^https:\/\/api\.open-meteo\.com\//, 'the push function only fetches the weather');
  weatherCalls.push(String(url));
  return new Response(JSON.stringify(weather), { status: 200, headers: { 'content-type': 'application/json' } });
};
const { loadSubs, claimAlert, ricoSays } = new Function('createClient', 'Deno', 'webpush', 'BodyTooLarge', 'InvalidBody', 'isPushEndpoint', 'readJsonBody', 'fetch', stripTypeScriptTypes(source) + '\nreturn { loadSubs, claimAlert, ricoSays };')(
  () => db, deno, { setVapidDetails() {}, sendNotification() { assert.fail('push must stay disabled without VAPID'); } }, BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody, fetchStub,
);
reset();
assert.deepEqual(await Promise.all([claimAlert('fixture-alert','cheer',null),claimAlert('fixture-alert','cheer',null)]),[true,false],'one alert claim wins concurrent retries');
assert.equal(tables.app_assistant_alerts.length,1);
queryError = 'app_assistant_alerts';
await assert.rejects(claimAlert('another-alert','cheer',null),'database errors are not mistaken for previously sent alerts');
queryError = '';
const words = {mood:'happy',en:()=> 'Hello',ku:()=> 'Hello',ar:()=> 'Hello'};
await ricoSays('cheer','fixture-inbox',words); await ricoSays('cheer','fixture-inbox',words);
assert.equal(tables.app_rico_inbox.length,2,'retries leave one inbox message per account');
queryError = 'app_rico_inbox';
await assert.rejects(ricoSays('cheer','other-inbox',words));
reset();
const reminder = await loadSubs(true);
assert.deepEqual(reminder.subs.map(s => s.device_id), ['active']);
assert.equal(reminder.subs[0].account, 'yunis');
assert.equal(reminder.skipped, 4, 'expired sessions, pending logouts, unsafe endpoints and unbound legacy subscriptions are excluded');
assert.equal((await loadSubs(false)).subs.length, 4, 'updates also exclude unsafe endpoints');
reset();
const req = (body, secret = true, method = 'POST') => new Request('https://example.supabase.co/functions/v1/send-push', {
  method, headers: secret ? { 'x-cron-secret': environment.CRON_SECRET } : {}, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
assert.equal((await handler(req({ type: 'reminder-tick' }, false))).status, 403);
assert.equal((await handler(req({}, true, 'GET'))).status, 405);
assert.equal((await handler(req('null'))).status, 400);
const tick = await handler(req({ type: 'reminder-tick' }));
assert.equal(tick.status, 200);
for (const [part, result] of Object.entries(await tick.json())) assert.ok(!result?.error, `the ${part} part of the minute tick runs without an error`);
assert.equal(weatherCalls.length, 1, 'the weather is fetched once');
assert.deepEqual([tables.app_weather?.[0]?.data?.rain, tables.app_weather?.[0]?.data?.max], [true, 15], 'Erbil\'s weather is kept for the app and Rico');
const again = await (await handler(req({ type: 'reminder-tick' }))).json();
assert.deepEqual([again.weather, weatherCalls.length], [{ skipped: 'fresh' }, 1], 'fresh weather is not fetched again on the next tick');

console.log('Backend push smoke: PASS');
