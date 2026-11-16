// Check all last prices (supabase/functions/api/rr-prices.ts): Rico on the Mac reads Ricotta Restaurant's
// invoices and the server keeps them. Checks only new or changed receipts are asked for, cancelled ones
// are removed, lines keep the unit they were bought in, the button asks once and Rico takes it once,
// an automatic read never ends someone's request, and bad input is refused. Runs the real code on a
// small in-memory database.
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/transfers.js';
import { askPrices, takePrices, pricesView, pricesHelperRoute, PRICES_VERSION } from '../supabase/functions/api/rr-prices.ts';

function fakeDb(tables = {}) {
  const from = (t) => {
    const list = tables[t] ??= [];
    let op = 'select', patch = null, selected = false;
    const f = [];
    const run = () => {
      if (op === 'upsert') {
        for (const row of [].concat(patch)) { const at = list.findIndex((r) => r.id === row.id); if (at >= 0) list[at] = { ...list[at], ...row }; else list.push({ ...row }); }
        return { data: null, error: null };
      }
      const hit = list.filter((r) => f.every((x) => x(r)));
      if (op === 'delete') { tables[t] = list.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: selected ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
      return { data: hit.map((r) => structuredClone(r)), error: null };
    };
    const q = {
      select() { selected = true; return q; }, upsert(p) { op = 'upsert'; patch = p; return q; }, update(p) { op = 'update'; patch = p; return q; }, delete() { op = 'delete'; return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; }, is(k, v) { f.push((r) => (r[k] ?? null) === v); return q; }, in(k, v) { f.push((r) => v.includes(r[k])); return q; },
      gte(k, v) { f.push((r) => String(r[k]) >= v); return q; }, lte(k, v) { f.push((r) => String(r[k]) <= v); return q; },
      order() { return q; }, limit() { return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { from, tables };
}
const json = (v, s = 200) => ({ status: s, body: v });
const fail = (e, s = 400) => ({ status: s, body: { error: e } });
const route = (db, path, b) => pricesHelperRoute(db, 'POST', path, b, json, fail);
const rr = (id, day, total, lines = 1) => ({ id, entry_date: day, invoice_number: 'N' + id, supplier_id: 's1', supplier_name: 'Shirka', status: 'open', total_amount: total, delivery_fee: 0, currency_code: 'IQD', line_count: lines, paid: false });

const db = fakeDb({
  app_rr_helper: [{ id: true, last_seen: new Date().toISOString(), version: '2026-11-16.1' }],
  app_rr_catalog: [{ id: true, data: { titems: [{ name: 'Milk', base: 'مل' }] } }],
  app_rr_invoices: [{ id: 'gone', entry_date: '2026-11-03', total: 5, line_count: 1, status: 'open', paid: false, delivery_fee: 0 }],
});

// 1. The month's list: every new receipt is asked for, the cancelled one is removed.
let r = await route(db, 'helper/invoices/plan', { month: '2026-11', rows: [rr('a', '2026-11-02', 1000), rr('b', '2026-11-10', 2000), rr('old', '2026-10-30', 9)] });
assert.equal(r.status, 200);
assert.deepEqual(r.body.need.sort(), ['a', 'b']);
assert.equal(r.body.removed, 1);
assert.ok(!db.tables.app_rr_invoices.some((x) => x.id === 'gone'));

// 2. Saved with their lines: the unit it was bought in, or the item's base unit when it has none.
r = await route(db, 'helper/invoices/save', { invoices: [
  { row: rr('a', '2026-11-02', 1000), lines: [{ inventory_item_id: 'i1', item_name: 'Milk', unit_label: null, quantity: 1000, unit_cost: 1, line_total: 1000 }] },
  { row: rr('b', '2026-11-10', 2000), lines: [{ inventory_item_id: 'i1', item_name: 'Milk', unit_label: 'کارتۆن', quantity: 1, unit_cost: 2000, line_total: 2000 }] },
] });
assert.equal(r.body.saved, 2);
const a = db.tables.app_rr_invoices.find((x) => x.id === 'a');
assert.equal(a.lines[0].unit, 'مل');
assert.equal(db.tables.app_rr_invoices.find((x) => x.id === 'b').lines[0].unit, 'کارتۆن');

// 3. The same list again: nothing to read. A changed total: only that one.
r = await route(db, 'helper/invoices/plan', { month: '2026-11', rows: [rr('a', '2026-11-02', 1000), rr('b', '2026-11-10', 2000)] });
assert.deepEqual(r.body.need, []);
r = await route(db, 'helper/invoices/plan', { month: '2026-11', rows: [rr('a', '2026-11-02', 1500), rr('b', '2026-11-10', 2000)] });
assert.deepEqual(r.body.need, ['a']);

// 4. Bad input is refused.
assert.equal((await route(db, 'helper/invoices/plan', { month: 'nope', rows: [] })).status, 400);
assert.equal((await route(db, 'helper/invoices/plan', { month: '2026-11', rows: 'x' })).status, 400);
assert.equal((await route(db, 'helper/invoices/save', { invoices: Array.from({ length: 11 }, (_, i) => ({ row: rr('x' + i, '2026-11-01', 1), lines: [] })) })).status, 400);
assert.equal((await route(db, 'helper/invoices/save', { invoices: [{ row: {}, lines: [] }] })).status, 400);

// 5. The button: asked once, Rico takes it once, done clears it.
r = await askPrices(db);
assert.equal(r.error, undefined);
assert.equal(r.prices.state, 'asked');
assert.equal((await askPrices(db)).prices.state, 'asked');
assert.equal(await takePrices(db), true);
assert.equal(await takePrices(db), false);
assert.equal((await pricesView(db)).state, 'running');
// An automatic read finishing meanwhile doesn't end the request.
await route(db, 'helper/invoices/done', { ok: true, receipts: 2, read: 0, auto: true });
assert.equal((await pricesView(db)).state, 'running');
await route(db, 'helper/invoices/done', { ok: true, receipts: 2, read: 1 });
const v = await pricesView(db);
assert.equal(v.state, null);
assert.equal(v.result.ok, true);
assert.ok(v.at);

// 6. Rico off, or too old to know the request: said so, nothing asked.
db.tables.app_rr_helper[0].last_seen = new Date(Date.now() - 5 * 60_000).toISOString();
assert.equal((await askPrices(db)).error, 'rico_off');
db.tables.app_rr_helper[0].last_seen = new Date().toISOString();
db.tables.app_rr_helper[0].version = '2026-11-15.3';
assert.ok('2026-11-15.3' < PRICES_VERSION);
assert.equal((await askPrices(db)).error, 'rico_old');
assert.equal(db.tables.app_rr_helper[0].prices_state, null);

console.log('Last prices smoke: PASS (only new or changed receipts read, cancelled removed, units kept, asked and taken once, automatic reads never end a request, Rico off or old said, bad input refused)');
