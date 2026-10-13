// Node 24+: execute the API handler with an in-memory database and no network.
import assert from 'node:assert/strict';
import {monthKey,monthStart} from '../supabase/functions/_shared/month.ts';
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
    app_recovery_tickets: [], app_push_subscriptions: [], app_login_attempts: [], app_devices: [], app_rico_inbox: [], app_audit_events: [],
  };
  errors = new Map(); calls = []; reservation = [1, 2]; match = 'rozha'; saved = true;
}
const db = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (errors.has(name)) return { data: null, error: { message: 'offline' } };
    if (name === 'app_internal_register_passkey') {
      const old=tables.app_passkeys.find(k=>k.id===args.p_id);
      if(old && (old.account!==args.p_account || old.public_key!==args.p_public_key || old.alg!==args.p_alg)) return {data:false,error:null};
      if(old) old.device_id=args.p_device;
      else tables.app_passkeys.push({id:args.p_id,account:args.p_account,public_key:args.p_public_key,alg:args.p_alg,sign_count:0,device_id:args.p_device});
      return {data:true,error:null};
    }
    if (name === 'app_internal_reserve_login') {
      if (reservation) tables.app_login_attempts.push(...reservation.map(id => ({ id, succeeded: false })));
      return { data: reservation, error: null };
    }
    if (name === 'app_internal_match_code') return { data: match, error: null };
    if (name === 'app_internal_set_credentials') return { data: 'ok', error: null };
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
const { groupHistory } = new Function('createClient', 'Deno', 'BodyTooLarge', 'InvalidBody', 'isPushEndpoint', 'readJsonBody', 'monthKey', 'monthStart', stripTypeScriptTypes(source) + '\nreturn { groupHistory };')( () => db, deno, BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody, monthKey, monthStart );
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
  assert.equal((await call('me/theme', { theme: 'neon' }, 'PUT')).status, 400, 'unknown themes are refused');
  assert.equal((await call('me/theme', { theme: 'berry' }, 'PUT')).status, 200);
  assert.equal(tables.app_accounts[0].theme, 'berry', 'the chosen theme is saved on the account');
  tables.app_accounts.push({ id: 'yunis', name: 'Yunis', tabs: ['order', 'assistant', 'history'], theme: 'ocean' });
  Object.assign(tables, { app_units: [], app_orders: [], app_order_lines: [], app_reminder_settings: [] });
  const bootRes = await call('bootstrap', undefined, 'GET'); const boot = await bootRes.json(); assert.equal(bootRes.status, 200);
  assert.deepEqual([boot.theme, boot.themes], ['berry', { rozha: 'berry', yunis: 'ocean' }], 'bootstrap carries every account\'s theme');

  reset();
  const ticket = 'verified-ticket';
  tables.app_recovery_tickets.push({ token_hash: await digest(ticket), stage: 'verified', expires_at: new Date(Date.now() + 60000).toISOString() });
  const results = await Promise.all([call('recovery/save', { ticket, rozhaPin: '432198' }, 'POST', false), call('recovery/save', { ticket, rozhaPin: '739152' }, 'POST', false)]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 401]);
  assert.equal(calls.filter(c => c.name === 'app_internal_set_credentials').length, 1, 'a verified recovery capability can change credentials only once');
  reset();
  tables.app_recovery_tickets.push({ token_hash: await digest(ticket), stage: 'code', expires_at: new Date(Date.now() + 60000).toISOString() });
  assert.equal((await call('recovery/name', { ticket, name: 'a'.repeat(40) + 'suffix' }, 'POST', false)).status, 401, 'valid answers cannot be accepted by truncating extra characters');

  /* Face ID (passkeys): a real P-256 key signs a real challenge; replays, other sites, other keys and
     tampered signatures are refused, and new PINs remove every passkey. */
  reset();
  Object.assign(tables, { app_passkeys: [], app_passkey_challenges: [] });
  const b64u = bytes => Buffer.from(bytes).toString('base64url');
  const sha = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const ORIGIN = 'https://rozhzero969-hub.github.io';
  const authData = async (counter, flags = 0x05) => {
    const out = new Uint8Array(37); out.set(await sha(new TextEncoder().encode('rozhzero969-hub.github.io'))); out[32] = flags;
    new DataView(out.buffer).setUint32(33, counter); return out;
  };
  const der = raw => {   // WebCrypto's raw r||s -> the DER form authenticators send
    const int = part => { let v = [...part]; while (v.length > 1 && v[0] === 0) v.shift(); if (v[0] & 0x80) v.unshift(0); return [0x02, v.length, ...v]; };
    const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))]; return new Uint8Array([0x30, body.length, ...body]);
  };
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const credId = b64u(crypto.getRandomValues(new Uint8Array(20)));
  const regOptions = await (await call('passkey/register-options', {})).json();
  assert.equal(regOptions.rpId, 'rozhzero969-hub.github.io');
  const regClient = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: regOptions.challenge, origin: ORIGIN }));
  const register = body => call('passkey/register', { id: credId, clientDataJSON: b64u(regClient), authenticatorData: b64u(body.auth), publicKey: b64u(spki), alg: -7 });
  assert.equal((await register({ auth: await authData(0, 0x01) })).status, 401, 'registering needs Face ID / fingerprint (user verified), not just a tap');
  const regOptions2 = await (await call('passkey/register-options', {})).json();
  const regClient2 = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: regOptions2.challenge, origin: ORIGIN }));
  assert.equal((await call('passkey/register', { id: credId, clientDataJSON: b64u(regClient2), authenticatorData: b64u(await authData(0)), publicKey: b64u(spki), alg: -7 })).status, 200);
  assert.deepEqual(tables.app_passkeys.map(k => [k.id, k.account]), [[credId, 'rozha']], 'only the public key is stored, for the signed-in account');
  const signIn = async ({ origin = ORIGIN, counter = 1, key = keys.privateKey, tamper = false, challenge } = {}) => {
    const c = challenge ?? (await (await call('passkey/login-options', {}, 'POST', false)).json()).challenge;
    const client = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: c, origin }));
    const ad = await authData(counter);
    const signed = new Uint8Array([...ad, ...(await sha(client))]);
    const sig = der(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed)));
    if (tamper) ad[36] ^= 1;
    return { challenge: c, response: await call('passkey/login', { id: credId, clientDataJSON: b64u(client), authenticatorData: b64u(ad), signature: b64u(sig) }, 'POST', false) };
  };
  const good = await signIn();
  assert.equal(good.response.status, 200, 'a real Face ID signature signs in');
  const session = await good.response.json();
  assert.equal(session.account, 'rozha'); assert.ok(session.token, 'and gets a session like the PIN');
  assert.equal((await signIn({ challenge: good.challenge, counter: 2 })).response.status, 401, 'a used challenge cannot be replayed');
  assert.equal((await signIn({ origin: 'https://evil.example' , counter: 3 })).response.status, 401, 'another website cannot use the passkey');
  assert.equal((await signIn({ counter: 4, tamper: true })).response.status, 401, 'a changed authenticator message breaks the signature');
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  assert.equal((await signIn({ counter: 5, key: other.privateKey })).response.status, 401, 'another key cannot sign in as this passkey');
  assert.equal((await signIn({ counter: 1 })).response.status, 401, 'a signature counter that goes backwards (a copied key) is refused');
  assert.equal((await signIn({ counter: 6 })).response.status, 200, 'the real key keeps working');
  errors.set('app_passkeys:update',true);
  assert.equal((await signIn({ counter: 7 })).response.status, 503, 'a failed signature-counter save cannot issue a session');
  errors.delete('app_passkeys:update');
  // New PINs through the secret code end every Face ID sign-in too.
  tables.app_recovery_tickets.push({ token_hash: await digest('pk-ticket'), stage: 'verified', expires_at: new Date(Date.now() + 60000).toISOString() });
  assert.equal((await call('recovery/save', { ticket: 'pk-ticket', rozhaPin: '432198' }, 'POST', false)).status, 200);
  assert.equal(tables.app_passkeys.length, 0, 'changing the PINs removes every passkey');
} finally { console.error = mute; }
console.log('Backend API smoke: PASS (fail-closed login, session persistence, atomic orders, strict quantities, subscription ownership, one-use recovery, Face ID passkeys)');
