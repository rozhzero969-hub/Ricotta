// Linking ordering items to stock items (supabase/functions/_shared/stock-link.js): real matches pass,
// wrong ones are blocked, and the Main Storage amount uses the buying unit only for whole numbers of it.
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/transfers.js';
import '../supabase/functions/_shared/stock-link.js';
const L = globalThis.RicottaStockLink;
const it = (name, aliases = []) => ({ name, aliases });

const pass = [
  [it('Mozzarella'), 'Mozzarella - پەنیری مۆزارێلا'],
  [it('Mozarella cheese'), 'Mozzarella - پەنیری مۆزارێلا'],
  [it('پەنیری مۆزارێلا'), 'Mozzarella - پەنیری مۆزارێلا'],
  [it('Tomatoes'), 'Tomato - تەماتە'],
  [it('تەماتە'), 'Tomato - تەماتە'],
  [it('Banana'), 'Banana - مۆز'],
  [it('Lemons'), 'Lemon - لیمۆ'],
  [it('Parmesan Cheese'), 'Parmesan - پەنیری پارمیزان'],
  [it('Almarai Milk'), 'Almarai Milk - شیری ئەلمەراعی'],
  [it('Akkawi'), 'Akkawi Cheese - پەنیری عەکاوی'],
  [it('Oil 1L'), 'Oil 1L - زەیتی 1 لیتری'],
  [it('Aleppo pepper'), 'Aleppo Pepper - پول بیبەر'],
  [it('Milk'), 'Milk - شیر'],
  [it('Faheta bread'), 'Faheta Bread - صمونى فاهيتا'],
  [it('Banana', ['موز']), 'مۆز'],
  [it('Fajita bread', ['Faheta']), 'Faheta Bread - صمونى فاهيتا'],
  [it('Al Ameed Coffee'), 'Al Ameed Medium Coffee 20*225 - قاوەی ئەلعەمید ماماناوەند'],
];
const block = [
  [it('Mozzarella'), 'Banana - مۆز'],
  [it('Mozzarella Cheese'), 'Akkawi Cheese - پەنیری عەکاوی'],
  [it('Tomato'), 'Potato - پەتاتە'],
  [it('Lemon'), 'Melon - شمامی'],
  [it('Milk'), 'Almond - بادەم'],
  [it('Almarai Milk'), 'Alfajer Milk 24*380 - شیری ئەلفەجر'],
  [it('Banana'), 'مۆز'],
  [it('Cheese'), 'Akkawi Cheese - پەنیری عەکاوی'],
  [it('Coffee beans'), 'Tea - چا'],
  [it('Oil'), 'Olive Oil - زەیتی زەیتوون'],
];
for (const [i, s] of pass) assert.ok(L.matches(i, s), `${i.name} should link to ${s}`);
for (const [i, s] of block) assert.ok(!L.matches(i, s), `${i.name} must not link to ${s}`);

// Amounts: Parmesan bought by the carton (30 pieces), counted in pieces.
const parm = (n) => ({ name: 'Parmesan', base: 'دانە', count: { name: 'دانە', factor: 1 }, buy: { name: 'کارتۆن', factor: 30 }, stock: { 'Main Storage': n } });
assert.deepEqual(L.amount(parm(60)), { qty: 2, unit: 'کارتۆن', empty: false });
assert.deepEqual(L.amount(parm(30)), { qty: 1, unit: 'کارتۆن', empty: false });
assert.deepEqual(L.amount(parm(31)), { qty: 31, unit: 'دانە', empty: false });
assert.deepEqual(L.amount(parm(29)), { qty: 29, unit: 'دانە', empty: false });
assert.deepEqual(L.amount(parm(0)), { qty: 0, unit: 'دانە', empty: true });
// Banana bought and counted by the kilo (grams in stock).
const banana = (g) => ({ name: 'Banana', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: { name: 'کیلۆ', factor: 1000 }, stock: { 'Main Storage': g } });
assert.deepEqual(L.amount(banana(5000)), { qty: 5, unit: 'کیلۆ', empty: false });
assert.deepEqual(L.amount(banana(5300)), { qty: 5.3, unit: 'کیلۆ', empty: false });
// No buying unit: the counting unit.
assert.deepEqual(L.amount({ name: 'X', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 2500 } }), { qty: 2.5, unit: 'کیلۆ', empty: false });

// Suggestions: the matching stock items, best first; both kinds when there are two; never a wrong one.
const opts = ['Mozzarella - پەنیری مۆزارێلا', 'Mozzarella Block - پەنیری مۆزارێلای پارچە', 'Banana - مۆز', 'Akkawi Cheese - پەنیری عەکاوی', 'Tomato - تەماتە'].map(name => ({ name }));
assert.deepEqual(L.suggest(it('Banana'), opts).map(o => o.name), ['Banana - مۆز'], 'Banana suggests the banana');
assert.deepEqual(L.suggest(it('Mozzarella'), opts).map(o => o.name).sort(), ['Mozzarella - پەنیری مۆزارێلا', 'Mozzarella Block - پەنیری مۆزارێلای پارچە'].sort(), 'both mozzarellas are suggested');
assert.equal(L.suggest(it('Mozzarella'), opts)[0].name, 'Mozzarella - پەنیری مۆزارێلا', 'the closer name first');
assert.deepEqual(L.suggest(it('Pineapple'), opts), [], 'nothing that does not match');

// Level for the Order screen colour: empty, low (less than 3 days at the pace of the last 14 days, at
// least 2 moves) or ok; without usage it is ok.
const carrot = { name: 'Carrot - گێزەر', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 2000 } };
const moves = n => Array.from({ length: n }, () => ({ from_zone: 'Main Storage', lines: [{ item: carrot.name, unit: 'کیلۆ', qty: 2 }] }));
assert.equal(L.level(carrot, L.usage([], [carrot], L.MAIN)).level, 'ok', 'no usage: in stock');
assert.equal(L.level(carrot, L.usage(moves(7), [carrot], L.MAIN)).level, 'low', '14 kg in 14 days, 2 kg left: 2 days, low');
assert.equal(L.level(carrot, L.usage(moves(1), [carrot], L.MAIN)).level, 'ok', 'one move is not enough to judge');
assert.equal(L.level({ ...carrot, stock: { 'Main Storage': 0 } }, new Map()).level, 'empty');
assert.equal(L.level(carrot, L.usage([{ ...moves(1)[0], mode: 'practice' }, ...moves(1)], [carrot], L.MAIN)).level, 'ok', 'practice runs never count');
console.log('Stock links PASS: suggestions (both kinds, never a wrong one), empty/low/ok levels, real names link (typos, plurals, Kurdish, search names), wrong ones are blocked, buying unit only for whole numbers of it');
