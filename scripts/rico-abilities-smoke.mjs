// Rico's newer abilities (supabase/functions/api/rico-abilities.ts): exact sums, two periods compared
// (orders and invoices), one item's whole picture with how much would last N days, a supplier's contact
// card, and how fresh Ricotta Restaurant's data is. Each follows the person's roles: Ahmad only gets sums,
// Yunis without History or Receipts gets no_access, and nothing here writes anything.
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: () => '' } };
const ab = await import('../supabase/functions/api/rico-abilities.ts');
const { _internals } = await import('../supabase/functions/api/assistant.ts');

// 1. Sums: exact, safe, and in the ways people write them.
const ev = x => { const r = ab.evaluate(x); return 'error' in r ? r : r.value; };
assert.equal(ev('13500 * 2.5'), 33750);
assert.equal(ev('(5000 - 1750) / 5000 * 100'), 65);
assert.equal(ev('200 + 10%'), 220, '200 + 10% is 220, as on a phone');
assert.equal(ev('200 - 10%'), 180);
assert.equal(ev('50%'), 0.5);
assert.equal(ev('1,250 × 4'), 5000, 'thousands commas and × are read');
assert.equal(ev('١٢ ÷ ٤'), 3, 'Arabic digits and ÷');
assert.equal(ev('۲^3'), 8, 'Persian-style digits and powers');
assert.equal(ev('-3 + 5'), 2);
assert.ok(ev('1/0').error, 'division by zero is an error, not Infinity');
assert.ok(ev('alert(1)').error, 'nothing but numbers and signs');
assert.ok(ev('2+(3').error);
const calc = ab.calculate({ expressions: ['0.1 + 0.2', '7 / 3'] });
assert.equal(calc.results[0].result, 0.3, 'no floating-point noise');
assert.equal(calc.results[1].rounded, 2.33);

// 2. The periods: this month so far vs the same days of last month (fair), never more than 92 days.
let p = ab.periodsOf({}, '2026-11-18');
assert.deepEqual([p.a, p.b, p.whole_b], [{ from: '2026-11-01', to: '2026-11-18' }, { from: '2026-10-01', to: '2026-10-18' }, { from: '2026-10-01', to: '2026-10-31' }]);
p = ab.periodsOf({}, '2026-03-31');
assert.equal(p.b.to, '2026-02-28', 'a short month stops at its last day');
p = ab.periodsOf({ preset: 'last_7_days' }, '2026-11-18');
assert.deepEqual([p.a, p.b], [{ from: '2026-11-12', to: '2026-11-18' }, { from: '2026-11-05', to: '2026-11-11' }]);
assert.ok(ab.periodsOf({ preset: 'custom', a_from: '2026-11-01' }, '2026-11-18').error);
assert.ok(ab.periodsOf({ preset: 'whenever' }).error);

// A small kitchen: orders on 3 days this month and 1 last month; invoices in both months.
const today = ab.erbilToday();
const daysAgo = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const line = (itemId, name, qty, supplier = 'Veg', unitId = 'kg') => ({ supplierId: supplier === 'Veg' ? 's1' : 's2', supplierName: supplier, itemId, name, unitId, qty });
const history = [
  { id: 'o0', date: daysAgo(40), lines: [line('tom', 'Tomato', 4)] },
  { id: 'o1', date: daysAgo(6), lines: [line('tom', 'Tomato', 5), line('bread', 'Bread', 20, 'Bakery', 'pc')] },
  { id: 'o2', date: daysAgo(3), lines: [line('tom', 'Tomato', 7)] },
  { id: 'o3', date: daysAgo(0), lines: [line('tom', 'Tomato', 6), line('tom', 'Tomato', 1, 'Veg', 'box')] },
];
const items = [{ id: 'tom', name: 'Tomato', aliases: ['تەماتە'], unit_id: 'kg', supplier_id: 's1', stock_item: 'Tomato - تەماتە' }, { id: 'bread', name: 'Bread', unit_id: 'pc', supplier_id: 's2' }, { id: 'tea', name: 'Tea', unit_id: 'kg', supplier_id: 's1' }];
const units = [{ id: 'kg', en: 'kg' }, { id: 'pc', en: 'piece' }, { id: 'box', en: 'box' }];
const suppliers = [{ id: 's1', name: 'Veg', phone: '0750 123 4567' }, { id: 's2', name: 'Bakery', phone: '' }];
const world = (over = {}) => ({ account: 'rozha', full: true, roles: [], catalog: true, now: { date: today },
  can: { history: true, receipts: true, transfers: true, record: true, recipes: true }, history, items, units, suppliers,
  stockOf: new Map([['tom', { stock_item: 'Tomato - تەماتە', qty: 8, unit: 'کیلۆ', empty: false, read_at: new Date().toISOString() }]]), ...over });

// Orders: per item, amounts per unit (the box is its own row), never mixed.
const o = ab.compareOrders(world(), { from: daysAgo(6), to: today }, { from: daysAgo(13), to: daysAgo(7) }, { by: 'item' });
assert.equal(o.totals.orders.a, 3); assert.equal(o.totals.orders.b, 0); assert.equal(o.totals.orders.change_pct, null, 'no percent against nothing');
assert.deepEqual(o.rows.find(r => r.name === 'Tomato' && r.unit === 'kg'), { name: 'Tomato', unit: 'kg', a: 18, b: 0, change_pct: null });
assert.equal(o.rows.find(r => r.unit === 'box').a, 1);
const os = ab.compareOrders(world(), { from: daysAgo(6), to: today }, { from: daysAgo(45), to: daysAgo(30) }, { supplier: 'veg' });
assert.deepEqual(os.rows, [{ name: 'Veg', unit: undefined, a: 3, b: 1, change_pct: 200 }], 'a supplier filter keeps only that supplier');

// Spending: from every invoice (IQD and USD apart), the newer period first.
const month = today.slice(0, 7), inv = [
  { id: 'i1', entry_date: daysAgo(1), supplier_name: 'Dairy Co', currency: 'IQD', total: 60000, lines: [{ item: 'Milk', unit: 'لتر', qty: 40, unit_cost: 1500, line_total: 60000 }] },
  { id: 'i2', entry_date: daysAgo(2), supplier_name: 'Veg', currency: 'IQD', total: 26000, lines: [{ item: 'Tomato - تەماتە', unit: 'کیلۆ', qty: 20, unit_cost: 1300, line_total: 26000 }] },
  { id: 'i3', entry_date: daysAgo(9), supplier_name: 'Dairy Co', currency: 'IQD', total: 40000, lines: [{ item: 'Milk', unit: 'لتر', qty: 25, unit_cost: 1600, line_total: 40000 }] },
  // Paid in USD: Ricotta Restaurant keeps its total and lines in IQD, so it is counted in IQD.
  { id: 'i4', entry_date: daysAgo(9), supplier_name: 'Coffee', currency: 'USD', rate: 1500, total: 63750, lines: [{ item: 'Beans', unit: 'کیلۆ', qty: 1, unit_cost: 63750, line_total: 63750 }] },
];
const invDb = { from() { const f = []; const q = { select() { return q; }, gte(k, v) { f.push(r => r[k] >= v); return q; }, lte(k, v) { f.push(r => r[k] <= v); return q; }, limit() { return q; },
  then(res) { return Promise.resolve({ data: inv.filter(r => f.every(fn => fn(r))), error: null }).then(res); } }; return q; } };
const noRead = async () => ({ ok: true });
const sp = await ab.compareSpending(invDb, { from: daysAgo(6), to: today }, { from: daysAgo(13), to: daysAgo(7) }, {}, noRead);
assert.deepEqual(sp.totals.IQD, { a: 86000, b: 103750, change_pct: -17.1 }, 'a USD-paid receipt counts in IQD');
assert.equal(sp.totals.USD.a + sp.totals.USD.b, 0, 'nothing is shown as dollars');
assert.deepEqual(sp.rows.find(r => r.name === 'Dairy Co'), { name: 'Dairy Co', currency: 'IQD', a: 60000, b: 40000, change_pct: 50 });
const spi = await ab.compareSpending(invDb, { from: daysAgo(6), to: today }, { from: daysAgo(13), to: daysAgo(7) }, { by: 'item', item: 'milk' }, noRead);
assert.equal(spi.rows.length, 1); assert.deepEqual([spi.rows[0].qty_a, spi.rows[0].qty_b], [{ 'لتر': 40 }, { 'لتر': 25 }]);
const notSet = await ab.compareSpending({ from() { const q = { select: () => q, gte: () => q, lte: () => q, limit: () => q, then: r => Promise.resolve({ data: [], error: null }).then(r) }; return q; } },
  { from: daysAgo(1), to: today }, { from: daysAgo(3), to: daysAgo(2) }, {}, async () => ({ error: 'not_set_up' }));
assert.equal(notSet.error, 'not_set_up', 'says so when invoices can not be read yet');

// The tool: one card (spending first), rows that changed most, and the roles.
const cards = [];
const c = await ab.comparePeriods(invDb, world(), { preset: 'last_7_days' }, e => cards.push(e), noRead);
assert.equal(c.orders.totals.orders.a, 3); assert.equal(c.spending.totals.IQD.a, 86000);
assert.equal(cards.length, 1); assert.equal(cards[0].proposal.kind, 'compare'); assert.equal(cards[0].proposal.main, 'spending');
assert.deepEqual(cards[0].proposal.totals.map(t => t.key), ['iqd', 'invoices', 'orders', 'lines'], 'no USD line: USD-paid receipts are in IQD');
const yunisNoRoles = world({ account: 'yunis', full: false, can: { history: false, receipts: false } });
assert.equal((await ab.comparePeriods(invDb, yunisNoRoles, {}, () => {}, noRead)).error, 'no_access');
const yunisHistory = world({ account: 'yunis', full: false, can: { history: true, receipts: false } });
const yh = await ab.comparePeriods(invDb, yunisHistory, { preset: 'last_7_days' }, () => {}, noRead);
assert.ok(yh.orders && !yh.spending && yh.spending_note, 'History without Receipts: orders only, and it says why');

// 3. One item: its pace, the last order, the stock in the same unit taken off, and the last price paid.
const io = await ab.itemOverview(invDb, world(), { item: 'tomato', days: 5 }, noRead);
assert.equal(io.item, 'Tomato');
assert.equal(io.ordering.times_ordered, 4);
assert.equal(io.ordering.total_ordered, 22, 'the box line is not added to kilos');
assert.equal(io.ordering.last_order.day, today);
assert.equal(io.in_main_storage.qty, 8);
assert.deepEqual([io.last_price.price, io.last_price.per, io.last_price.stock_item], [1300, 'کیلۆ', 'Tomato - تەماتە'], 'the last price comes from its linked stock item');
assert.equal(io.to_last.in_stock_same_unit, 8, 'کیلۆ and kg are the same unit');
const perDay = io.ordering.per_day;
assert.ok(Math.abs(io.to_last.needed - perDay * 5) < 0.01, 'the daily pace times the days');
assert.ok(Math.abs(io.to_last.to_order - Math.max(0, io.to_last.needed - 8)) < 0.002, 'minus what is in Main Storage');
assert.equal(io.to_last.to_order_whole, Math.max(0, Math.ceil(io.to_last.to_order - 1e-9)));
const tea = await ab.itemOverview(invDb, world(), { item: 'tea', days: 3 }, noRead);
assert.equal(tea.ordering.times_ordered, 0); assert.match(tea.to_last.note, /not ordered/);
assert.equal((await ab.itemOverview(invDb, world(), { item: 'zzzz' }, noRead)).error, 'not_found');
assert.equal((await ab.itemOverview(invDb, yunisNoRoles, { item: 'tomato' }, noRead)).error, 'no_access');
const noPrice = await ab.itemOverview(invDb, yunisHistory, { item: 'tomato' }, noRead);
assert.equal('last_price' in noPrice, false, 'no price without Receipts');

// 4. A supplier's card: Call and WhatsApp, only for those who see suppliers' numbers.
const shown = [];
assert.equal(ab.contactSupplier(world(), { supplier: 'veg', message: 'Can you come early tomorrow?' }, e => shown.push(e)).shown, true);
assert.deepEqual([shown[0].proposal.kind, shown[0].proposal.phone, shown[0].proposal.message], ['contact', '0750 123 4567', 'Can you come early tomorrow?']);
assert.equal(ab.contactSupplier(world(), { supplier: 'Bakery' }, () => {}).error, 'no_number');
assert.equal(ab.contactSupplier(world({ full: false, account: 'yunis', roles: ['history'] }), { supplier: 'veg' }, () => {}).error, 'no_access');
assert.equal(ab.contactSupplier(world({ full: false, account: 'yunis', roles: ['send'] }), { supplier: 'veg' }, () => {}).shown, true);

// 5. How fresh the data is, in Rico's CONTEXT.
const now = Date.now(), iso = m => new Date(now - m * 60000).toISOString();
assert.equal(ab.dataStateLine(null), '');
assert.match(ab.dataStateLine({ reader: { catalog_ok_at: iso(3), invoices_ok_at: iso(10) } }, now), /stock and lists read 3 min ago; invoices read 10 min ago/);
assert.doesNotMatch(ab.dataStateLine({ reader: { catalog_ok_at: iso(3), invoices_ok_at: iso(10) } }, now), /OLD/);
const stale = ab.dataStateLine({ reader: { catalog_ok_at: iso(180), invoices_ok_at: iso(180), problem: { kind: 'pin', cause: 'The PIN was refused.', since: iso(120) } }, helper: { last_seen: iso(5) } }, now);
assert.match(stale, /3 h ago/); assert.match(stale, /PROBLEM since 2 h ago: The PIN was refused/); assert.match(stale, /may be OLD/); assert.match(stale, /Mac last seen 5 min ago/);
const ctx = _internals.contextBlock({ ...world(), months: [], rules: [], routines: [], devices: [], streak: null, data: { reader: { catalog_ok_at: iso(200) } }, photo: true }, { account: 'rozha' }, { lang: 'en' });
assert.match(ctx, /Ricotta Restaurant data \(as of now\): stock and lists read 3 h ago/);
assert.match(ctx, /attached a PHOTO/);

// 6. Through Rico's own tool runner: Ahmad gets sums only; the tools and notes are in place.
const run = async (w, name, a) => { const out = []; const r = await _internals.runTool(invDb, w, name, a, e => out.push(e), false); return { r, out }; };
const ahmad = world({ account: 'ahmad', full: false, roles: ['assistant'], catalog: false, can: { history: false, receipts: false, transfers: false, recipes: true } });
assert.equal((await run(ahmad, 'calculate', { expression: '4500 - 1750' })).r.results[0].result, 2750, 'Ahmad can work out a margin');
for (const tool of ['compare_periods', 'item_overview', 'contact_supplier']) assert.equal((await run(ahmad, tool, { item: 'x', supplier: 'veg' })).r.error, 'no_access', tool + ' is closed to Ahmad');
for (const tool of ['calculate', 'compare_periods', 'item_overview', 'contact_supplier']) assert.ok(_internals.TOOLS.some(t => t.name === tool && t.input_schema), tool + ' is one of Rico\'s tools');
assert.match(_internals.MANUAL, /PHOTOS/); assert.match(_internals.MANUAL, /use calculate first/);
assert.doesNotMatch(ab.ABILITY_MANUAL + _internals.MANUAL.split('PHOTOS')[1].split('UNTRUSTED')[0], /[—–]/, 'no dashes in the new notes');

console.log('Rico abilities smoke: PASS (exact sums with %, ×, ÷ and Kurdish/Arabic digits; fair month vs month and week vs week for orders and invoices, USD-paid receipts in IQD; one item\'s pace, stock, last price and how much lasts N days; supplier Call and WhatsApp card by role; data freshness in CONTEXT; Ahmad gets sums only)');
