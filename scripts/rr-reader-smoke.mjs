// Cloud Rico (supabase/functions/api/rr-reader.ts): the server reads Ricotta Restaurant on its own.
// Checks the lists come out in the Mac helper's shape, invoices are kept with the unit each line was
// bought in, a refused token signs in again once, the PIN and token never reach a cause, a log or a
// reply, and Rozh is alerted once after 15 minutes of failing and once when it works again. Then Rico's
// Invoices skill (rico-invoices.ts): the last price wins, units are kept, and items are found by storage
// moves and by name, saying which. Runs the real code on a small in-memory database.
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/transfers.js';
import { catalogBody, invoiceRow, invoiceLines, readInvoiceMonth, readerConfig, readerTick, readerView, rrClient, ReaderError } from '../supabase/functions/api/rr-reader.ts';
import { lastPrices, priceLookup, invoiceReport, reportTotals } from '../supabase/functions/api/rico-invoices.ts';

const PIN = '7391', TOKEN = 'fake-token-';   // test values only
const rrCount = (u) => u.startsWith('https://pos.shaydattendance.com/api/v1');

/* A tiny in-memory Supabase client with the calls the reader makes. */
function fakeDb(tables = {}) {
  const from = (t) => {
    const list = tables[t] ??= [];
    let op = 'select', patch = null;
    const f = [];
    const run = () => {
      if (op === 'upsert') {
        for (const row of Array.isArray(patch) ? patch : [patch]) {
          const key = 'id' in row ? 'id' : null, at = key ? list.findIndex((r) => r[key] === row[key]) : -1;
          if (at >= 0) list[at] = { ...list[at], ...row }; else list.push({ ...row });
        }
        return { data: null, error: null };
      }
      if (op === 'insert') { list.push(...[].concat(patch)); return { data: null, error: null }; }
      const hit = list.filter((r) => f.every((x) => x(r)));
      if (op === 'delete') { tables[t] = list.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      return { data: hit.map((r) => structuredClone(r)), error: null };
    };
    const q = {
      select() { return q; }, upsert(p) { op = 'upsert'; patch = p; return q; }, insert(p) { op = 'insert'; patch = p; return q; }, delete() { op = 'delete'; return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; }, in(k, v) { f.push((r) => v.includes(r[k])); return q; },
      gte(k, v) { f.push((r) => String(r[k]) >= v); return q; }, lte(k, v) { f.push((r) => String(r[k]) <= v); return q; },
      order() { return q; }, limit() { return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { from, tables };
}

/* Ricotta Restaurant, faked: answers the GETs the reader makes, and counts sign-ins. */
function fakeRR({ expireOnce = false, pinOk = true, down = false } = {}) {
  const calls = [];
  let issued = 0, expired = !expireOnce;
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const path = url.replace('https://pos.shaydattendance.com/api/v1', '');
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (down) throw new TypeError('fetch failed');
    if (path === '/branches') return res(200, [{ id: 'b-1', name: 'Ricotta Erbil' }, { id: 'b-2', name: 'Other' }]);
    if (path === '/auth/pin-login') { if (!pinOk) return res(401, { message: 'bad pin' }); issued++; return res(200, { access_token: TOKEN + issued }); }
    const auth = new Headers(init.headers).get('Authorization');
    if (!auth?.startsWith('Bearer ' + TOKEN)) return res(401, {});
    if (!expired) { expired = true; return res(401, { message: 'expired' }); }
    if (path === '/inventory/units') return res(200, { units: [{ id: 'u-g', name: 'غرام' }, { id: 'u-p', name: 'دانە' }] });
    if (path.startsWith('/inventory/items')) return res(200, { items: [
      { name: 'Mozzarella - پەنیری مۆزارێلا', is_active: true, has_purchase_history: true, usage_unit_id: 'u-g', inventory_unit_name: 'کیلۆ', inventory_factor_to_base: 1000, purchase_unit_name: 'کارتۆن', purchase_factor: 10000,
        stocks: [{ zone_name: 'Main Storage', quantity: 5000 }, { zone_name: 'Breakfast', quantity: 300 }] },
      { name: '-', is_active: true, has_purchase_history: true, usage_unit_id: 'u-p' },
      { name: 'Old Thing', is_active: false, has_purchase_history: true, usage_unit_id: 'u-p' },
      { name: 'Never Bought', is_active: true, has_purchase_history: false, usage_unit_id: 'u-p' }] });
    if (path === '/purchasing/suppliers') return res(200, { suppliers: [{ name: 'Dairy Co', is_active: true }, { name: 'Gone Co', is_active: false }] });
    if (path === '/inventory/zones') return res(200, { zones: [{ name: 'Main Storage' }, { name: 'Pizza' }, { name: 'Breakfast' }] });
    if (path.startsWith('/inventory/movements')) return res(200, { rows: [], movements: [] });
    if (path.startsWith('/purchasing/receipts/summary')) return res(200, { rows: [
      { id: 'r1', entry_date: '2026-11-03', invoice_number: '2601', supplier_id: 's1', supplier_name: 'Dairy Co', status: 'open', total_amount: '120000', delivery_fee: 0, currency_code: 'IQD', line_count: 1, paid: true },
      { id: 'r2', entry_date: '2026-11-09', invoice_number: '2602', supplier_id: 's1', supplier_name: 'Dairy Co', status: 'open', total_amount: '26000', delivery_fee: 5000, currency_code: 'IQD', line_count: 2, paid: false }] });
    const m = path.match(/^\/purchasing\/receipts\/(r\d)\/lines$/);
    if (m) return res(200, m[1] === 'r1'
      ? [{ inventory_item_id: 'i1', item_name: 'Mozzarella - پەنیری مۆزارێلا', unit_label: 'کارتۆن', quantity: 1, unit_cost: 120000, line_total: 120000 }]
      : [{ inventory_item_id: 'i1', item_name: 'Mozzarella - پەنیری مۆزارێلا', unit_label: null, quantity: 2000, unit_cost: 12, line_total: 24000 }]);
    return res(404, {});
  };
  return { fetch, calls, signIns: () => calls.filter((c) => c.path === '/auth/pin-login').length };
}
const secrets = (extra = {}) => (k) => ({ RR_PIN: PIN, RR_BRANCH: 'ricotta erbil', ...extra })[k] ?? '';

// 1. Secrets: the missing ones are named, never their values; the device id has a default.
{
  const c = readerConfig((k) => ({ RR_PIN: PIN })[k] ?? '');
  assert.deepEqual(c.missing, ['RR_BRANCH']);
  assert.equal(c.ready, false);
  assert.equal(readerConfig(secrets()).device, 'ricotta-orders-server-reader');
}

// 2. The lists in the Mac helper's shape: only active, bought, named items; Breakfast left out.
{
  const body = catalogBody({
    units: { units: [{ id: 'u-g', name: 'غرام' }] }, suppliers: [{ name: 'A' }, { name: 'B', is_active: false }], zones: [{ name: 'Main Storage' }, { name: 'نانی بەیانی (Breakfast)' }],
    items: [{ name: 'Lemon', is_active: true, has_purchase_history: true, usage_unit_id: 'u-g', inventory_unit_name: 'کیلۆ', inventory_factor_to_base: 1000, stocks: [{ zone_name: 'Main Storage', quantity: '1500' }, { zone_name: 'Breakfast', quantity: 2 }] },
      { name: '-', is_active: true, has_purchase_history: true }],
  });
  assert.deepEqual(body.suppliers, ['A']);
  assert.deepEqual(body.zones, ['Main Storage']);
  assert.deepEqual(body.items, [{ name: 'Lemon', base: 'غرام', units: [{ name: 'کیلۆ', factor: 1000 }] }]);
  assert.deepEqual(body.titems, [{ name: 'Lemon', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 1500 } }]);
}

// 3. Invoices: the row and its lines, with the unit bought in (the base unit when Ricotta Restaurant has none).
{
  const row = invoiceRow({ id: 9, entry_date: '2026-11-03T00:00:00Z', invoice_number: 77, supplier_name: 'X', total_amount: '1,0', currency_code: 'USD', paid: 'yes', line_count: '2.7' });
  assert.equal(row.id, '9'); assert.equal(row.entry_date, '2026-11-03'); assert.equal(row.currency, 'USD'); assert.equal(row.paid, false); assert.equal(row.total, 0); assert.equal(row.line_count, 2);
  assert.equal(row.rate, null, 'no exchange rate on the row');
  // A USD receipt keeps its exchange rate (IQD for 1 USD); an IQD one has none.
  assert.equal(invoiceRow({ id: 1, currency_code: 'USD', exchange_rate: '1,480' }).rate, 1480);
  assert.equal(invoiceRow({ id: 2, currency_code: 'IQD', exchange_rate: '1480' }).rate, null);
  assert.equal(invoiceRow({ id: 3, currency_code: 'USD', exchange_rate: '0' }).rate, null);
  const lines = invoiceLines([{ item_name: 'Lemon', unit_label: null, quantity: '3', unit_cost: '2000', line_total: '6000' }, { item_name: '' }], () => 'کیلۆ');
  assert.deepEqual(lines, [{ item_id: null, item: 'Lemon', unit: 'کیلۆ', qty: 3, unit_cost: 2000, line_total: 6000, returned: 0, wasted: 0 }]);
}

// 4. A month is stored, unchanged receipts are not read again, and one no longer listed is removed.
{
  const rr = fakeRR(), db = fakeDb({ app_rr_invoices: [{ id: 'gone', entry_date: '2026-11-01', total: 1, line_count: 1, status: 'open', paid: true, delivery_fee: 0 }] });
  const client = rrClient({ pin: PIN, branch: 'b-1', device: 'd' }, { fetch: rr.fetch });
  const first = await readInvoiceMonth(db, client.get, '2026-11', () => 'غرام');
  assert.deepEqual(first, { month: '2026-11', receipts: 2, read: 2, removed: 1 });
  const kept = db.tables.app_rr_invoices;
  assert.deepEqual(kept.map((r) => r.id).sort(), ['r1', 'r2']);
  assert.equal(kept.find((r) => r.id === 'r2').lines[0].unit, 'غرام', 'no unit label: the base unit');
  const again = await readInvoiceMonth(db, client.get, '2026-11', () => 'غرام');
  assert.equal(again.read, 0, 'unchanged receipts are not read again');
}

// 5. A refused token signs in again once, then reads; only GETs after the sign-in; the PIN goes only to sign-in.
{
  const rr = fakeRR({ expireOnce: true });
  let saved = null;
  const client = rrClient({ pin: PIN, branch: 'Ricotta Erbil', device: 'd' }, { fetch: rr.fetch, token: TOKEN + '0', onToken: (t) => { saved = t; } });
  const units = await client.get('/inventory/units');
  assert.equal(units.units.length, 2);
  assert.equal(rr.signIns(), 1, 'signed in again once after the 401');
  assert.equal(saved, TOKEN + '1');
  assert.equal(rr.calls.find((c) => c.path === '/auth/pin-login').body.branch_id, 'b-1', 'branch found by name');
  assert.ok(rr.calls.every((c) => c.method === 'GET' || c.path === '/auth/pin-login'), 'read only');
  assert.ok(rr.calls.filter((c) => c.body).every((c) => c.path === '/auth/pin-login'));
}

// 6. A wrong PIN: a plain cause without the PIN; the branch not found is said too.
{
  const err = await rrClient({ pin: PIN, branch: 'b-1', device: 'd' }, { fetch: fakeRR({ pinOk: false }).fetch }).get('/inventory/units').catch((e) => e);
  assert.ok(err instanceof ReaderError); assert.equal(err.kind, 'pin'); assert.ok(!err.message.includes(PIN));
  const b = await rrClient({ pin: PIN, branch: 'Nowhere', device: 'd' }, { fetch: fakeRR().fetch }).get('/inventory/units').catch((e) => e);
  assert.equal(b.kind, 'branch');
}

// 7. The tick: lists and invoices read, the token kept but never shown, nothing logged with a secret.
const logs = [];
for (const k of ['log', 'error', 'warn', 'info']) { const o = console[k]; console[k] = (...a) => { logs.push(a.join(' ')); return o.call(console, ...a); }; }
{
  const rr = fakeRR(), db = fakeDb(), saves = [], alerts = [];
  const deps = { db, fetch: rr.fetch, get: secrets(), saveCatalog: async (_db, body) => { saves.push(body); return { ok: true }; }, catalogOf: async () => ({ titems: saves[0]?.titems ?? [] }), alert: async (k, w) => { alerts.push([k, w]); } };
  const r = await readerTick(deps);
  assert.deepEqual(r.did, ['catalog', 'invoices']);
  assert.equal(r.problem, null);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].zones, ['Main Storage', 'Pizza']);
  assert.ok(saves[0].history && saves[0].history.days === 28 && saves[0].history.t && saves[0].history.p, 'history built from movements, in the helper shape');
  const st = db.tables.app_rr_reader[0];
  assert.ok(st.token.startsWith(TOKEN), 'token kept for the next run');
  assert.equal(st.log.length, 1); assert.equal(st.log[0].ok, true);
  const again = await readerTick(deps);
  assert.deepEqual(again.did, [], 'nothing due a minute later');
  assert.equal(rr.signIns(), 1, 'the kept token is used');
  const view = await readerView(db, secrets());
  const shown = JSON.stringify(view);
  assert.ok(!shown.includes(TOKEN) && !shown.includes(PIN), 'Admin never sees the token or PIN');
  assert.equal(view.ready, true); assert.equal(view.counts.items, 1); assert.equal(view.counts.invoices, 2);
}

// 8. Not set up: nothing read, nothing alerted, Admin names what is missing.
{
  const rr = fakeRR(), db = fakeDb(), alerts = [];
  const r = await readerTick({ db, fetch: rr.fetch, get: () => '', saveCatalog: async () => ({}), catalogOf: async () => ({}), alert: async (k) => { alerts.push(k); } });
  assert.equal(r.notSetUp, true); assert.equal(rr.calls.length, 0); assert.equal(alerts.length, 0);
  assert.deepEqual((await readerView(db, () => '')).missing, ['RR_PIN', 'RR_BRANCH']);
}

// 9. Failing: alert once after 15 minutes (not before, not twice), then once when it works again.
{
  let down = true;
  const rr = fakeRR(), db = fakeDb(), alerts = [];
  const fetch = (u, i) => down ? Promise.reject(new TypeError('fetch failed')) : rr.fetch(u, i);
  const deps = (now) => ({ db, fetch, now, get: secrets(), saveCatalog: async () => ({ ok: true }), catalogOf: async () => ({ titems: [] }), alert: async (k, w) => { alerts.push([k, w]); } });
  const t0 = Date.now();
  const a = await readerTick(deps(t0));
  assert.equal(a.problem.kind, 'down');
  assert.equal(alerts.length, 0, 'no alert at once');
  const since = db.tables.app_rr_reader[0].problem.since;
  await readerTick(deps(Date.parse(since) + 10 * 60_000));
  assert.equal(alerts.length, 0, 'none after 10 minutes');
  await readerTick(deps(Date.parse(since) + 16 * 60_000));
  assert.equal(alerts.length, 1, 'one after 15 minutes');
  assert.equal(alerts[0][0], 'down');
  assert.match(alerts[0][1].en, /Cloud Rico cannot read Ricotta Restaurant/);
  assert.ok(alerts[0][1].ku && alerts[0][1].ar);
  await readerTick(deps(Date.parse(since) + 30 * 60_000));
  assert.equal(alerts.length, 1, 'not again for the same problem');
  assert.equal(db.tables.app_rr_reader[0].problem.since, since, 'since kept while the same problem');
  down = false;
  const ok = await readerTick(deps(Date.now()));
  assert.equal(ok.problem, null);
  assert.equal(alerts.length, 2); assert.equal(alerts[1][0], 'fixed');
  const st = db.tables.app_rr_reader[0];
  assert.equal(st.problem, null); assert.equal(st.alerted, null);
  assert.ok(st.log.length <= 50 && st.log.some((e) => !e.ok && e.cause));
  for (let i = 0; i < 60; i++) { down = true; await readerTick({ ...deps(Date.now()), force: 'all' }); }
  assert.equal(db.tables.app_rr_reader[0].log.length, 50, 'a rolling log of 50 runs');
}

// 10. A wrong PIN is tried again every 10 minutes, not every minute (it could lock the PIN there).
{
  const rr = fakeRR({ pinOk: false }), db = fakeDb();
  const deps = { db, fetch: rr.fetch, get: secrets(), saveCatalog: async () => ({}), catalogOf: async () => ({}), alert: async () => {} };
  await readerTick(deps);
  await readerTick(deps); await readerTick(deps);
  assert.equal(rr.signIns(), 1, 'one sign-in, then a wait');
  await readerTick({ ...deps, force: 'all' });
  assert.equal(rr.signIns(), 2, 'Read now tries at once');
  const st = JSON.stringify(db.tables.app_rr_reader);
  assert.ok(!st.includes(PIN), 'the PIN is never stored');
}
assert.ok(!logs.some((l) => l.includes(PIN) || l.includes(TOKEN)), 'nothing logged with the PIN or token');

// 11. Last prices: the newest invoice wins, with the unit it was bought in; other units kept apart.
const inv = [
  { entry_date: '2026-11-02', invoice_number: '1', supplier_name: 'Dairy Co', currency: 'IQD', total: 1, paid: true, lines: [{ item: 'Mozzarella', unit: 'کارتۆن', unit_cost: 110000 }, { item: 'Coffee Ice Cream Sweet', unit: 'دانە', unit_cost: 3000 }] },
  { entry_date: '2026-11-09', invoice_number: '2', supplier_name: 'Cheese House', currency: 'IQD', total: 1, paid: false, lines: [{ item: 'Mozzarella', unit: 'کارتۆن', unit_cost: 120000 }, { item: 'Mozzarella', unit: 'کیلۆ', unit_cost: 12500 }] },
  { entry_date: '2026-11-05', invoice_number: '3', supplier_name: 'Import Co', currency: 'USD', total: 1, paid: true, lines: [{ item: 'Pizza Box', unit: 'کارتۆن', unit_cost: 41.456 }] },
];
{
  const got = lastPrices(inv, () => true);
  const moz = got.find((r) => r.item === 'Mozzarella');
  assert.equal(moz.price, 120000); assert.equal(moz.unit, 'کارتۆن'); assert.equal(moz.supplier, 'Cheese House'); assert.equal(moz.day, '2026-11-09'); assert.equal(moz.times, 3);
  assert.deepEqual(moz.otherUnits, [{ unit: 'کیلۆ', price: 12500 }]);
  assert.equal(got.find((r) => r.item === 'Pizza Box').price, 41.46, 'USD to the cent');
  const tot = reportTotals(inv);
  assert.equal(tot.receipts, 3); assert.equal(tot.unpaid, 1); assert.equal(tot.IQD, 2); assert.equal(tot.USD, 1);
}

// 12. price_lookup: items moved to the storage in 60 days first, then name matches, each saying which.
{
  const db = fakeDb({
    app_rr_catalog: [{ id: true, data: { zones: ['Main Storage', 'Minibar', 'Pizza'], titems: [] }, updated_at: new Date().toISOString() }],
    app_rr_transfers: [
      { status: 'moved', to_zone: 'Minibar', mode: 'real', moved_at: new Date().toISOString(), lines: [{ item: 'Pizza Box' }] },
      { status: 'moved', to_zone: 'Minibar', mode: 'practice', moved_at: new Date().toISOString(), lines: [{ item: 'Mozzarella' }] }],
    app_rr_invoices: inv.map((r, i) => ({ ...r, id: 'x' + i, entry_date: new Date().toISOString().slice(0, 7) + r.entry_date.slice(7) })),
  });
  const cards = [];
  const w = { can: { receipts: true } };
  const r = await priceLookup(db, w, { storage: 'minibar', query: 'coffee ice cream' }, (e) => cards.push(e), async () => ({}));
  assert.equal(r.storage, 'Minibar');
  assert.deepEqual(r.items.map((x) => [x.item, x.found_by]), [['Pizza Box', 'moved'], ['Coffee Ice Cream Sweet', 'name']]);
  assert.equal(cards[0].proposal.kind, 'price_lookup');
  assert.ok(!r.items.some((x) => x.item === 'Mozzarella'), 'practice moves do not count');
  const none = await priceLookup(db, w, { query: 'caviar' }, () => {}, async () => ({}));
  assert.equal(none.found, 0); assert.match(none.note, /never guess a price/);
  assert.equal((await priceLookup(db, { can: {} }, { query: 'x' }, () => {})).error, 'no_access');
  const notSet = await priceLookup(fakeDb(), w, { query: 'x' }, () => {}, async () => ({ error: 'not_set_up' }));
  assert.equal(notSet.error, 'not_set_up');
  const rep = [];
  const v = await invoiceReport(db, w, { supplier: 'dairy' }, (e) => rep.push(e), async () => ({}));
  assert.equal(v.receipts, 1); assert.equal(rep[0].proposal.kind, 'invoice_report'); assert.equal(rep[0].proposal.supplier, 'dairy');
}

console.log('Cloud Rico smoke: PASS (Mac helper shape, invoices with units, 401 sign-in again, read only, no secrets in causes/logs/Admin, alert after 15 min and when fixed, PIN back-off, rolling log of 50, last price wins, storage moves vs names)');
