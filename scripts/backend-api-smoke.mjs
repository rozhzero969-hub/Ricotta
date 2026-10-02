// Node 24+: execute the API handler with an in-memory database and no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody } from '../supabase/functions/_shared/security.ts';

const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const token = 'test-session-token', tokenHash = await digest(token);
let tables, errors, calls, reservation, match, saved;
function reset() {
  tables = {
    app_sessions: [{ id: 'session', token_hash: tokenHash, account: 'rozha', device_id: 'device-1', expires_at: new Date(Date.now() + 60000).toISOString(), last_seen_at: new Date().toISOString(), revoked_at: null }],
    app_accounts: [{ id: 'rozha', name: 'Rozha', tabs: ['order', 'assistant', 'history'] }],
    app_items: [{ id: 'tomato', name: 'Tomatoes' }], app_suppliers: [{ id: 'supplier', name: 'Supplier' }],
    app_item_pars: [{ item_id: 'tomato', est_qty: 2 }], app_recovery_tickets: [], app_push_subscriptions: [], app_login_attempts: [], app_devices: [], app_rico_inbox: [], app_audit_events: [],
  };
  errors = new Map(); calls = []; reservation = [1, 2]; match = 'rozha'; saved = true;
}
const db = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (errors.has(name)) return { data: null, error: { message: 'offline' } };
    if (name === 'app_internal_reserve_login') {
      if (reservation) tables.app_login_attempts.push(...reservation.map(id => ({ id, succeeded: false })));
      return { data: reservation, error: null };
    }
    if (name === 'app_internal_match_code') return { data: match, error: null };
    if (name === 'app_internal_set_credentials') return { data: 'ok', error: null };
    if (name === 'app_internal_save_order') return { data: saved, error: null };
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
      in(field, values) { filters.push(row => values.includes(row[field])); return q; },
      is(field, value) { filters.push(row => row[field] === value); return q; },
      gt(field, value) { filters.push(row => row[field] > value); return q; },
      gte(field, value) { filters.push(row => row[field] >= value); return q; },
      order() { return q; }, limit() { return q; },
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
const { groupHistory } = new Function('createClient', 'Deno', 'BodyTooLarge', 'InvalidBody', 'isPushEndpoint', 'readJsonBody', stripTypeScriptTypes(source) + '\nreturn { groupHistory };')( () => db, deno, BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody );
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
  for (const malformed of ['null', '[]', '{broken']) assert.equal((await call('orders', malformed)).status, 400);
  assert.equal((await call('orders', { payload: 'ڕ'.repeat(140000) })).status, 413);
  tables.app_sessions[0].expires_at = 'invalid-date';
  assert.equal((await call('orders', {})).status, 401, 'invalid session dates fail closed');

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

  reset();
  const validOrder = { id: 'order-1', date: '2026-10-01T12:00:00Z', entries: [{ supplierId: 'supplier', items: [{ itemId: 'tomato', name: 'Tomatoes', unit: 'kg', qty: 5 }] }] };
  assert.equal((await call('orders', validOrder)).status, 200);
  const save = calls.find(c => c.name === 'app_internal_save_order');
  assert.deepEqual(save.args.p_lines, [{ supplier_id: 'supplier', supplier_name: 'Supplier', item_id: 'tomato', item_name: 'Tomatoes', unit_id: 'kg', qty: 5 }]);
  assert.equal(calls.some(c => c.table === 'app_orders' || c.table === 'app_order_lines'), false, 'the API delegates all order writes to one transaction');
  reset(); saved = false;
  assert.equal((await call('orders', validOrder)).status, 200);
  assert.equal(tables.app_rico_inbox.length, 0, 'idempotent retries do not emit another cheer');
  for (const qty of [0, -1, 'NaN', 'Infinity', 100000]) {
    reset();
    const invalid = structuredClone(validOrder); invalid.entries[0].items[0].qty = qty;
    assert.equal((await call('orders', invalid)).status, 400, `reject quantity ${qty}`);
    assert.equal(calls.some(c => c.name === 'app_internal_save_order'), false);
  }
  reset();
  assert.equal((await call('items/tomato/stock', { track: true, parQty: 10, estQty: 'Infinity' }, 'PUT')).status, 400);
  assert.equal((await call('push/subscription', { endpoint: 'https://127.0.0.1/internal' }, 'PUT')).status, 400);
  tables.app_push_subscriptions.push({ endpoint: 'https://fcm.googleapis.com/fcm/send/peer', device_id: 'device-2' });
  assert.equal((await call('push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/peer', p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }, 'PUT')).status, 403, 'another device cannot overwrite a subscription');

  reset();
  const ticket = 'verified-ticket';
  tables.app_recovery_tickets.push({ token_hash: await digest(ticket), stage: 'verified', expires_at: new Date(Date.now() + 60000).toISOString() });
  const results = await Promise.all([call('recovery/save', { ticket, rozhaPin: '432198' }, 'POST', false), call('recovery/save', { ticket, rozhaPin: '739152' }, 'POST', false)]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 401]);
  assert.equal(calls.filter(c => c.name === 'app_internal_set_credentials').length, 1, 'a verified recovery capability can change credentials only once');
  reset();
  tables.app_recovery_tickets.push({ token_hash: await digest(ticket), stage: 'code', expires_at: new Date(Date.now() + 60000).toISOString() });
  assert.equal((await call('recovery/name', { ticket, name: 'a'.repeat(40) + 'suffix' }, 'POST', false)).status, 401, 'valid answers cannot be accepted by truncating extra characters');
} finally { console.error = mute; }
console.log('Backend API smoke: PASS (fail-closed login, session persistence, atomic orders, strict quantities, subscription ownership, one-use recovery)');
