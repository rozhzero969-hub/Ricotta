// Recipe costs (supabase/functions/_shared/recipe-cost.js): unit conversions to the stock item's base
// unit, the last price paid wins, IQD only (a USD price is never used), missing lines shown as missing (never 0),
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
assert.equal(shake.total, 6);
assert.equal(shake.complete, true);
assert.equal(shake.profit, 14);
assert.equal(shake.margin, 70);
assert.equal(shake.state, 'ok');
assert.equal(shake.suggested, 250, '3 times 6 IQD, rounded up to 250');
// Litres and kilos give the same cost as millilitres and grams.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 0.5, unit: 'l' }, { ingredient: 'i-banana', qty: 0.25, unit: 'kg' }]), ctx).total, 6);
// Pieces from a carton: 3 eggs at 2 each.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 3, unit: 'pc' }]), ctx).total, 6);

// Per serving: a recipe for 4 is priced per serving.
const cake = C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 8, unit: 'pc' }], { yield: 4, price: 10, currency: 'IQD' }), ctx);
assert.equal(cake.total, 16);
assert.equal(cake.perServing, 4);
assert.equal(cake.margin, 60);
assert.equal(cake.state, 'ok', '60% is not under 60%');
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-eggs', qty: 8, unit: 'pc' }], { yield: 4, price: 9, currency: 'IQD' }), ctx).state, 'low');

// Losing money: the cost reaches the price, even before every price is known.
const loss = C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 500, unit: 'ml' }, { ingredient: 'i-eggs', qty: null, unit: 'pc' }], { price: 5, currency: 'IQD' }), ctx);
assert.equal(loss.losing, true);
assert.equal(loss.state, 'loss');
assert.equal(loss.profit, null, 'no profit while a line is missing');

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
// A stock item never bought in the kept invoices: missing price.
const neverBought = C.context({ ingredients, titems, units, invoices: [] });
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 5, unit: 'ml' }]), neverBought).lines[0].status, 'price');
// Before Ricotta Restaurant's list is known, a link is not called gone.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-gone', qty: 5, unit: 'ml' }]), C.context({ ingredients, titems: [], units, invoices })).lines[0].status, 'price');

// Recipes are in IQD only: a USD price is never used. Vanilla was bought only in USD, so it has no cost.
const withUsd = C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 500, unit: 'ml' }, { ingredient: 'i-vanilla', qty: 4, unit: 'g' }], { price: 20 }), ctx);
assert.equal(withUsd.lines[1].status, 'usd');
assert.equal(withUsd.total, 5, 'only the IQD line counts');
assert.equal(withUsd.missing, 1);
assert.equal(withUsd.profit, null);
assert.equal(withUsd.currency, 'IQD');
// The newest IQD price wins over a newer USD one.
const both = C.lastPrices([inv('2026-11-12', '2026-11-12T10:00:00Z', '16', 'USD', [{ item: 'Milk - شیر', unit: 'لیتر', unit_cost: 1 }]), ...invoices]);
assert.equal(both.get('Milk - شیر').cost, 10);
assert.equal(both.get('Milk - شیر').currency, 'IQD');
// A unit saved by name before units came from Manage, Units still works.
assert.equal(C.recipeCost(recipe([{ ingredient: 'i-milk', qty: 1, unit: 'لیتر' }]), ctx).total, 10);

// Stock for the alerts: empty in Main Storage, low (a linked ordering item at its level), ok.
assert.equal(C.stockState(titems[1], new Set()), 'empty');
assert.equal(C.stockState(titems[0], new Set(['Milk - شیر'])), 'low');
assert.equal(C.stockState(titems[2], new Set()), 'ok');
console.log('Recipe cost PASS: g/kg and ml/L, cartons to pieces, last price wins, IQD only, per serving, profit, margin, suggested price, every kind of missing line');
