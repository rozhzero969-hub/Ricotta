// Rico's tools for Ricotta Restaurant's stock, prices, spending and transfers (supabase/functions/api/rico-tools.ts):
// the numbers come from the real rows, people without the role get no_access and nothing is read, and
// propose_transfer_draft only ever saves a DRAFT for the person (never sends, approves or moves).
import assert from 'node:assert/strict';
import * as rt from '../supabase/functions/api/rico-tools.ts';

const day = d => { const x = new Date(Date.now() - d * 86400000); return x.toISOString(); };
const tables = {
  app_rr_catalog: [{ id: true, updated_at: day(0), data: {
    zones: ['Main Storage', 'Pizza', 'Minibar'],
    items: [{ name: 'Mozzarella - پەنیری مۆزارێلا', base: 'غرام', units: [{ name: 'کیلۆ', factor: 1000 }] }],
    titems: [
      { name: 'Mozzarella - پەنیری مۆزارێلا', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 10000, Pizza: 2000 } },
      { name: 'Carrot - گێزەر', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 10000 } },
    ] } }],
  app_rr_receipts: [
    { id: 'r1', status: 'saved', supplier: 'Dairy Co', invoice: '1', currency: 'IQD', rate: null, delivery: 0, saved_at: day(1), created_at: day(1), mode: 'real', lines: [{ item: 'Mozzarella - پەنیری مۆزارێلا', unit: 'کیلۆ', qty: 2, cost: 12000 }] },
    { id: 'r2', status: 'saved', supplier: 'Dairy Co', invoice: '2', currency: 'IQD', rate: null, delivery: 0, saved_at: day(5), created_at: day(5), mode: 'real', lines: [{ item: 'Mozzarella - پەنیری مۆزارێلا', unit: 'کیلۆ', qty: 3, cost: 10000 }] },
    { id: 'r3', status: 'saved', supplier: 'Dairy Co', invoice: '3', currency: 'IQD', rate: null, delivery: 0, saved_at: day(2), created_at: day(2), mode: 'practice', lines: [{ item: 'Mozzarella - پەنیری مۆزارێلا', unit: 'کیلۆ', qty: 9, cost: 99000 }] },
    { id: 'r4', status: 'problem', supplier: 'Veg', invoice: '4', currency: 'IQD', problem: 'Rico could not find the supplier', saved_at: null, created_at: day(0), updated_at: day(0), created_by: 'rozha', mode: 'real', lines: [] },
  ],
  app_rr_transfers: [
    { id: 't1', status: 'moved', from_zone: 'Main Storage', to_zone: 'Pizza', moved_at: day(1), created_at: day(1), mode: 'real', lines: [{ item: 'Mozzarella - پەنیری مۆزارێلا', unit: 'کیلۆ', qty: 1 }] },
    { id: 't2', status: 'moved', from_zone: 'Main Storage', to_zone: 'Pizza', moved_at: day(2), created_at: day(2), mode: 'real', lines: [{ item: 'Mozzarella - پەنیری مۆزارێلا', unit: 'کیلۆ', qty: 2 }] },
  ],
};
const inserted = [];
const db = { from(table) {
  const rows = () => (tables[table] || []).slice();
  const f = []; let lim = Infinity, payload = null;
  const q = {
    select() { return q; }, order() { return q; }, limit(n) { lim = n; return q; },
    eq(k, v) { f.push(r => r[k] === v); return q; }, in(k, vs) { f.push(r => vs.includes(r[k])); return q; },
    gte(k, v) { f.push(r => r[k] != null && Date.parse(r[k]) >= Date.parse(v)); return q; },
    insert(row) { payload = row; inserted.push({ table, row }); return q; },
    maybeSingle() { return Promise.resolve(payload ? { data: payload, error: null } : { data: rows().filter(r => f.every(fn => fn(r)))[0] ?? null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: rows().filter(r => f.every(fn => fn(r))).slice(0, lim), error: null }).then(res, rej); },
  };
  return q;
} };
const rozha = () => ({ account: 'rozha', can: { receipts: true, transfers: true, history: true, record: true }, items: [] });
const yunis = () => ({ account: 'yunis', can: { receipts: false, transfers: false }, items: [] });

// Stock: from the stock Rico read, in the counting unit, only storages that have some.
const s = await rt.stockLevels(db, rozha(), { item: 'mozzarella' });
assert.equal(s.item, 'Mozzarella - پەنیری مۆزارێلا');
assert.deepEqual(s.storages, [{ storage: 'Main Storage', qty: 10, unit: 'کیلۆ' }, { storage: 'Pizza', qty: 2, unit: 'کیلۆ' }]);
// Prices: newest first, practice runs never count, the change is from the previous price.
const p = await rt.priceHistory(db, rozha(), { item: 'Mozzarella' });
assert.equal(p.by_supplier[0].last_price, 12000);
assert.equal(p.by_supplier[0].previous_price, 10000);
assert.equal(p.by_supplier[0].change_pct, 20);
assert.equal(p.by_supplier[0].receipts, 2, 'a practice run is not a price paid');
// Spending: totals of saved receipts (2 x 12,000 + 3 x 10,000).
const sp = await rt.spendingSummary(db, rozha(), { period: 'week' });
assert.equal(sp.receipts, 2);
assert.equal(sp.total_IQD, 54000);
assert.equal(sp.total_USD, 0);
// Transfers: per destination, amounts per unit added up.
const ts = await rt.transfersSummary(db, rozha(), { period: 'week' });
assert.equal(ts.transfers, 2);
assert.deepEqual(ts.by_storage[0].items[0].qty, { 'کیلۆ': 3 });
// Price changes over 10 %.
const pc = await rt.priceChanges(db, rozha(), {});
assert.equal(pc.found, 1);
assert.equal(pc.changes[0].change_pct, 20);
// What needs a person: the stopped receipt, in plain words.
const na = await rt.needsAttention(db, rozha());
assert.equal(na.receipts.length, 1);
assert.match(na.receipts[0].why, /^Stopped: Rico could not find the supplier/);

// Roles: without Receipts or Transfers every tool says no_access.
for (const [fn, args] of [[rt.stockLevels, { item: 'x' }], [rt.priceHistory, { item: 'x' }], [rt.spendingSummary, { period: 'week' }], [rt.transfersSummary, { period: 'week' }], [rt.priceChanges, {}], [rt.needsAttention, undefined]]) {
  assert.equal((await fn(db, yunis(), args)).error, 'no_access', `${fn.name} refuses without the role`);
}
const events = [];
assert.equal((await rt.proposeTransferDraft(db, yunis(), { from: 'Main', to: 'Pizza', lines: [{ item: 'Carrot', qty: 3 }] }, e => events.push(e))).error, 'no_access');
assert.equal(inserted.length, 0, 'nothing is written without the role');

// A transfer draft: checked first; a wrong one saves nothing; a right one is saved as a DRAFT only.
const tooMuch = await rt.proposeTransferDraft(db, rozha(), { from: 'Main Storage', to: 'Pizza', lines: [{ item: 'Carrot', qty: 30 }] }, e => events.push(e));
assert.equal(tooMuch.prepared, false, 'more than is in stock is refused');
assert.equal(inserted.length, 0, 'a refused draft saves nothing');
const w = rozha();
const ok = await rt.proposeTransferDraft(db, w, { from: 'main', to: 'pizza', lines: [{ item: 'carrot', qty: 3 }] }, e => events.push(e));
assert.equal(ok.prepared, true);
assert.equal(inserted.length, 1);
assert.equal(inserted[0].table, 'app_rr_transfers');
assert.equal(inserted[0].row.status, 'draft', 'only ever a draft');
assert.equal(inserted[0].row.created_by, 'rozha');
assert.equal(inserted[0].row.from_zone, 'Main Storage');
assert.equal(inserted[0].row.to_zone, 'Pizza');
assert.deepEqual(inserted[0].row.lines, [{ item: 'Carrot - گێزەر', unit: 'کیلۆ', qty: 3 }]);
for (const k of ['approved_by', 'approved_at', 'sent_at', 'moved_at']) assert.equal(inserted[0].row[k], undefined, `a draft never has ${k}`);
assert.equal(events.at(-1).proposal.kind, 'transfer_draft');
await rt.proposeTransferDraft(db, w, { from: 'Main Storage', to: 'Minibar', lines: [{ item: 'Carrot', qty: 1 }] }, () => {});
assert.equal((await rt.proposeTransferDraft(db, w, { from: 'Main Storage', to: 'Pizza', lines: [{ item: 'Carrot', qty: 1 }] }, () => {})).error, 'limit', 'at most 2 drafts in one reply');
// Receipts are never made by Rico.
assert.ok(!rt.RICO_RR_TOOLS.some(t => /receipt/i.test(t.name) && /propose|create|make/i.test(t.name)), 'no tool makes a receipt');
console.log('Rico tools PASS: stock, prices, spending, transfers, price changes and what needs a person from real rows; no_access without the role; transfer drafts are checked first and only ever saved as drafts');
