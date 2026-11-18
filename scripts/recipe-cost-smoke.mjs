// Recipe costs (supabase/functions/_shared/recipe-cost.js): unit conversions to the stock item's base
// unit, the last price paid wins, USD receipts in IQD at their rate, missing lines shown as missing (never 0),
// profit, margin and the suggested price. Run: node scripts/recipe-cost-smoke.mjs
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/transfers.js';
import '../supabase/functions/_shared/recipe-cost.js';
const C = globalThis.RicottaRecipeCost;

// Units from Manage, Units: their one name in any language.
const units = [{ id: 'g', en: 'گرام' }, { id: 'kg', en: 'کیلۆگرام' }, { id: 'ml', en: 'مل' }, { id: 'l', en: 'لیتر' }, { id: 'pc', en: 'دانە' }, { id: 'box', en: 'سندوق' }, { id: 'tsp', en: 'teaspoon' }];
const titems = [
  { name: 'Milk - شیر', base: 'مل', count: { name: 'لیتر', factor: 1000 }, buy: { name: 'کارتۆن', factor: 12000 }, stock: { 'Main Storage': 5000 } },
  { name: 'Banana - مۆز', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: { name: 'کیلۆ', factor: 1000 }, stock: { 'Main Storage': 0 } },
  { name: 'Eggs - هێلکە', base: 'دانە', count: { name: 'دانە', factor: 1 }, buy: { name: 'کارتۆن', factor: 24 }, stock: { 'Main Storage': 48 } },
  { name: 'Vanilla - ڤانیلا', base: 'غرام', count: null, buy: null, stock: { 'Main Storage': 100 } },
  { name: 'Syrup - شیلە', base: 'مل', count: null, buy: { name: 'دانە', factor: 750 }, stock: { 'Main Storage': 750 } },
];
const ingredients = [
  { id: 'i-milk', name: 'Milk', stock_item: 'Milk - شیر', unit: 'ml' },
  { id: 'i-banana', name: 'Banana', stock_item: 'Banana - مۆز', unit: 'g' },
  { id: 'i-eggs', name: 'Eggs', stock_item: 'Eggs - هێلکە', unit: 'pc' },
  { id: 'i-vanilla', name: 'Vanilla', stock_item: 'Vanilla - ڤانیلا', unit: 'g' },
  { id: 'i-gone', name: 'Old cream', stock_item: 'Cream 1L - کرێم', unit: 'ml' },
  { id: 'i-syrup', name: 'Syrup', stock_item: 'Syrup - شیلە', unit: 'ml' },
];
const inv = (day, read, number, currency, lines) => ({ entry_date: day, read_at: read, invoice_number: number, supplier_name: 'Dairy', currency, lines });

// Conversions: kilos and grams, litres and millilitres, the stock item's own units, unknown units.
assert.deepEqual(C.measure('کیلۆگرام'), { kind: 'g', f: 1000 });
assert.deepEqual(C.measure('ml'), { kind: 'ml', f: 1 });
assert.deepEqual(C.measure('لیتر'), { kind: 'ml', f: 1000 });
assert.equal(C.measure('سندوق'), null);
assert.equal(C.factor(titems[0], 'لیتر'), 1000, 'its counting unit');
assert.equal(C.factor(titems[0], 'l'), 1000, 'litres in any language');
assert.equal(C.factor(titems[0], 'کارتۆن'), 12000, 'its buying unit');
assert.equal(C.factor(titems[1], 'گرام'), 1, 'grams are its base');
assert.equal(C.factor(titems[1], 'kg'), 1000);
assert.equal(C.factor(titems[2], 'کارتۆن'), 24, 'a carton of 24 pieces');
assert.equal(C.factor(titems[1], 'مل'), null, 'millilitres are not grams');
assert.equal(C.factor(titems[0], 'سندوق'), null, 'a box it is never bought in');

// Last price wins: the newest receipt date, then the one read last; lines without a price are skipped.
const invoices = [
  inv('2026-11-01', '2026-11-01T10:00:00Z', '10', 'IQD', [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 8 }, { item: 'Banana - مۆز', unit: 'کیلۆ', unit_cost: 3 }]),
  inv('2026-11-10', '2026-11-10T10:00:00Z', '11', 'IQD', [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 10 }, { item: 'Eggs - هێلکە', unit: 'کارتۆن', unit_cost: 48 }]),
  inv('2026-11-05', '2026-11-05T10:00:00Z', '12', 'IQD', [{ item: 'Banana - مۆز', unit: 'کیلۆ', unit_cost: 4 }, { item: 'Milk - شیر', unit: 'لیتر', unit_cost: 99 }]),
  inv('2026-11-12', '2026-11-12T10:00:00Z', '13', 'IQD', [{ item: 'Banana - مۆز', unit: 'کیلۆ', unit_cost: 0 }]),
  inv('2026-11-11', '2026-11-11T10:00:00Z', '14', 'USD', [{ item: 'Vanilla - ڤانیلا', unit: 'غرام', unit_cost: 0.5 }]),
  inv('2026-11-11', '2026-11-11T10:00:00Z', '15', 'IQD', [{ item: 'Syrup - شیلە', unit: 'بوتڵ', unit_cost: 9000 }]),
];
const last = C.lastPrices(invoices);
assert.equal(last.get('Milk - شیر').cost, 10, 'the newest receipt wins, not the highest or the first read');
assert.equal(last.get('Banana - مۆز').cost, 4, 'a line with no price is skipped');
assert.equal(C.priceOf(titems[0], last.get('Milk - شیر')).perBase, 0.01, '10 per litre is 0.01 per ml');
assert.equal(C.priceOf(titems[2], last.get('Eggs - هێلکە')).perBase, 2, 'a carton of 24 at 48 is 2 per piece');
assert.equal(C.priceOf(titems[4], last.get('Syrup - شیلە')).error, 'unit', 'bought in a unit that can not be turned into ml');
assert.equal(C.priceOf(titems[0], undefined), null);

const ctx = C.context({ ingredients, titems, units, invoices });
const recipe = (lines, extra = {}) => ({ id: 'r', data: { yield: 1, lines, ...extra } });

// The owner's example: milk 10 per 1000 ml, 500 ml used = 5; banana 4 per kg, 250 g = 1; recipe 6.
const shake = C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 500, unit: 'ml' }, { ingredient: 'i-banana', qty: 250, unit: 'g' }], { price: 20, currency: 'IQD' }), ctx);
assert.deepEqual(shake.lines.map((l) => [l.status, l.cost]), [['ok', 5], ['ok', 1]]);
assert.equal(shake.total, 6, 'the exact total stays exact');
assert.equal(shake.complete, true);
assert.equal(shake.cost, 250, 'a cost above 0 is never shown as 0: at least 250 IQD');
assert.equal(shake.suggested, 250, '3 times 6 IQD, at least 250');
// Litres and kilos give the same cost as millilitres and grams.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 0.5, unit: 'l' }, { ingredient: 'i-banana', qty: 0.25, unit: 'kg' }]), ctx).total, 6);
// Pieces from a carton: 3 eggs at 2 each.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 3, unit: 'pc' }]), ctx).total, 6);

// Rounding to the nearest 250 IQD (Rozh's choice): costs, profit and the suggested price.
assert.equal(C.ROUND_TO, 250);
assert.deepEqual([0, 100, 124, 125, 374, 375, 6120, 6125, 6380].map(C.roundMoney), [0, 0, 0, 250, 250, 500, 6000, 6250, 6500]);
assert.deepEqual([0, 1, 124, 6120].map(C.roundCost), [0, 250, 250, 6000]);
assert.equal(C.roundMoney(-380), -500, 'a loss rounds the same way');
// Eggs at 2 each (a carton of 24 at 48): 3,060 eggs cost 6,120, shown as 6,000; menu price 9,000.
const big = C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 3060, unit: 'pc' }], { price: 9000 }), ctx);
assert.equal(big.total, 6120);
assert.equal(big.cost, 6000);
assert.equal(big.profit, 3000, 'profit from the rounded cost');
assert.equal(big.margin, 33.3, 'margin from the rounded numbers: 3,000 of 9,000');
assert.equal(big.suggested, 18250, '3 times 6,120 = 18,360, to the nearest 250');
assert.equal(big.state, 'low');
// One recipe is one dish: an old servings number is ignored (old saved data stays harmless).
const old = C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 5000, unit: 'pc' }], { yield: 4, price: 25000, status: 'ready', prep: 10 }), ctx);
assert.equal(old.cost, 10000);
assert.equal(old.profit, 15000);
assert.equal(old.margin, 60);
assert.equal(old.state, 'ok', '60% is not under 60%');
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 5000, unit: 'pc' }], { price: 24000 }), ctx).state, 'low');

// Losing money: the rounded cost reaches the menu price.
const loss = C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 4500, unit: 'pc' }], { price: 9000 }), ctx);
assert.equal(loss.cost, 9000);
assert.equal(loss.profit, 0);
assert.equal(loss.losing, true);
assert.equal(loss.state, 'loss');

// A missing price: no cost, no profit, no margin, no suggested price, even when the rest is priced, and
// the problem names the ingredient without a price.
const half = C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 500, unit: 'ml' }, { ingredient: 'i-eggs', qty: null, unit: 'pc' }, { ingredient: 'i-vanilla', qty: 4, unit: 'g' }], { price: 5 }), ctx);
assert.equal(half.complete, false);
assert.equal(half.total, null);
assert.equal(half.cost, null, 'no cost while an ingredient has no price');
assert.equal(half.profit, null);
assert.equal(half.margin, null);
assert.equal(half.suggested, null);
assert.equal(half.losing, false, 'never called losing money without a full cost');
assert.equal(half.state, 'none');
assert.deepEqual(half.problems, [{ name: 'Eggs', status: 'amount' }]);

// Prices in plain sizes for the Items and ingredients tab.
const per = (t, last) => C.unitPrices(C.priceOf(t, last)).map((u) => [u.unit, Number(u.amount.toFixed(4))]);
assert.deepEqual(per(titems[1], { unit: 'کیلۆ', cost: 4000, currency: 'IQD' }), [['kg', 4000], ['g', 4]], '1 kg = 4,000 IQD, per gram 4 IQD');
assert.deepEqual(per(titems[0], { unit: 'لیتر', cost: 2000, currency: 'IQD' }), [['l', 2000], ['ml', 2]]);
assert.deepEqual(per(titems[2], { unit: 'کارتۆن', cost: 6000, currency: 'IQD' }), [['piece', 250]], 'a carton of 24 at 6,000 is 250 a piece');
assert.deepEqual(C.unitPrices(null), []);
assert.deepEqual(C.unitPrices({ perBase: 5, base: 'سندوق' }), [{ unit: 'other', name: 'سندوق', amount: 5 }]);

// Missing: never 0. Each kind of missing is named.
const missing = C.recipeCost(recipe([
  { ingredient: 'i-eggs', qty: null, unit: 'pc' },        // no amount yet
  { ingredient: 'i-banana', qty: 100, unit: 'ml' },       // ml of a fruit counted in grams
  { ingredient: 'i-gone', qty: 100, unit: 'ml' },         // its stock item is gone from Ricotta Restaurant
  { ingredient: 'i-syrup', qty: 30, unit: 'ml' },         // bought in a unit that can't be turned into ml
  { ingredient: 'nope', qty: 1, unit: 'g' },              // no such ingredient
  { ingredient: 'i-milk', qty: 1, unit: 'tsp' },          // a unit that can't be turned into ml
], { price: 1000 }), ctx);
assert.deepEqual(missing.lines.map((l) => l.status), ['amount', 'unit', 'gone', 'buyUnit', 'link', 'unit']);
assert.ok(missing.lines.every((l) => l.cost === undefined), 'a missing line has no cost, not 0');
assert.equal(missing.missing, 6);
assert.equal(missing.complete, false);
assert.equal(missing.total, null);
assert.equal(missing.state, 'none');
assert.equal(missing.suggested, null);
assert.equal(missing.cost, null);
// A stock item never bought in the kept invoices: missing price.
const neverBought = C.context({ ingredients, titems, units, invoices: [] });
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 5, unit: 'ml' }]), neverBought).lines[0].status, 'price');
// Before Ricotta Restaurant's list is known, a link is not called gone.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-gone', qty: 5, unit: 'ml' }]), C.context({ ingredients, titems: [], units, invoices })).lines[0].status, 'price');

// A USD receipt counts in IQD at its rate. Vanilla's receipt has no total to compare and no rate of its
// own, and no other USD receipt has one: its 0.5 USD a gram is 750 IQD at the usual 1,500.
assert.equal(C.DEFAULT_RATE, 1500);
const withUsd = C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 500, unit: 'ml' }, { ingredient: 'i-vanilla', qty: 4, unit: 'g' }], { price: 20000 }), ctx);
assert.deepEqual(withUsd.lines.map((l) => [l.status, l.cost]), [['ok', 5], ['ok', 3000]]);
assert.equal(withUsd.lines[1].paid, 'USD', 'the line says it was paid in USD');
assert.equal(withUsd.total, 3005);
assert.equal(withUsd.currency, 'IQD');
const vanilla = ctx.price('Vanilla - ڤانیلا');
assert.equal(vanilla.currency, 'IQD'); assert.equal(vanilla.paid, 'USD'); assert.equal(vanilla.rate, 1500); assert.equal(vanilla.perBase, 750);
// Its own rate wins: 1,450.
const usdInv = (n, day, rate, lines, total, fee = 0) => ({ ...inv(day, day + 'T10:00:00Z', n, 'USD', lines), rate, total, delivery_fee: fee });
assert.equal(C.lastPrices([usdInv('20', '2026-11-13', 1450, [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 2, qty: 3, line_total: 6 }], 0)]).get('Milk - شیر').cost, 2900);
// Ricotta Restaurant keeps a USD receipt's total in IQD, and usually its lines too: lines that add up to
// the total are already in IQD and are not multiplied again (a delivery fee on top is allowed).
const inIqd = C.lastPrices([usdInv('21', '2026-11-13', 1500, [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 3000, qty: 2, line_total: 6000 }], 6000)]).get('Milk - شیر');
assert.equal(inIqd.cost, 3000, 'already in IQD'); assert.equal(inIqd.paid, 'USD'); assert.equal(inIqd.currency, 'IQD');
assert.equal(C.lastPrices([usdInv('22', '2026-11-13', 1500, [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 3000, qty: 2, line_total: 6000 }], 11000, 5000)]).get('Milk - شیر').cost, 3000, 'with its delivery fee');
// Lines in dollars against an IQD total: turned into IQD.
assert.equal(C.lastPrices([usdInv('23', '2026-11-13', 1500, [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 2, qty: 2, line_total: 4 }], 6000)]).get('Milk - شیر').cost, 3000);
// No rate of its own: the newest rate on another USD receipt.
const fb = C.lastPrices([usdInv('24', '2026-11-14', null, [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 2 }], 0), usdInv('25', '2026-11-02', 1600, [{ item: 'Eggs - هێلکە', unit: 'کارتۆن', unit_cost: 1 }], 0)]);
assert.equal(fb.get('Milk - شیر').cost, 3200); assert.equal(fb.get('Milk - شیر').rate, 1600);
assert.equal(C.iqdFactor({ currency: 'IQD', lines: [] }), 1);
// The newest receipt wins whatever it was paid in.
const both = C.lastPrices([inv('2026-11-12', '2026-11-12T10:00:00Z', '16', 'USD', [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 1 }]), ...invoices]);
assert.equal(both.get('Milk - شیر').cost, 1500);
assert.equal(both.get('Milk - شیر').currency, 'IQD');
// A price in another currency (from an older server) is no price, never a wrong one.
const oldUsd = C.context({ ingredients, titems, units, prices: { 'Milk - شیر': { perBase: 0.001, base: 'مل', currency: 'USD' } } });
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 5, unit: 'ml' }]), oldUsd).lines[0].status, 'price');
// A unit saved by name before units came from Manage, Units still works.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 1, unit: 'لیتر' }]), ctx).total, 10);

// Stock for the alerts: empty in Main Storage, low (a linked ordering item at its level), ok.
assert.equal(C.stockState(titems[1], new Set()), 'empty');
assert.equal(C.stockState(titems[0], new Set(['Milk - شیر'])), 'low');
assert.equal(C.stockState(titems[2], new Set()), 'ok');
console.log('Recipe cost PASS: g/kg and ml/L, cartons to pieces, last price wins, USD receipts in IQD at their rate, rounding to the nearest 250 IQD, profit and margin from the rounded numbers, no cost while a price is missing, prices in plain sizes, every kind of missing line');
