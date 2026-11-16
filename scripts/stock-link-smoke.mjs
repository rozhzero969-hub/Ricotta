// Linking ordering items to stock items (supabase/functions/_shared/stock-link.js): real matches pass,
// wrong ones don't (the app warns before linking them), suggestions pick the right one, and the Main
// Storage amount uses the buying unit only for whole numbers of it.
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

// Smarter suggestions (live cases from Ricotta Restaurant, 15 Nov): rarer words count for more, the
// stock name's extra words count against it, sizes, supplier, unit, deliveries and links already made.
const live = ['Sunich Mango Juice - شەربەتی سن ئیچ مەنگۆ', 'Sunich Peach Nectar - شەربەتی سن ئیچ خۆخ', 'Sunich Pineapple Juice - شەربەتی سن ئیچ ئەناناس',
  'Sunich Pomegranate Juice - شەربەتی سن ئیچ هەنار', 'Bato Fries - فینگر باتۆ', 'French Lettuce - خاس لولو', 'French Mozzarella', 'Lettuce - خاس',
  'Cooking Cream - كريم طبخ', 'Cooking Oil 18L - زەیتی 18 لیتری', 'Tomato - تەماتە', 'Altunsa Tomato Paste - دۆشاوی تەماتەی ئەلتونسا', 'Altunsa Tuna - تونای ئەلتونسا',
  'Cherry Tomatoes - تەماتە کرزی', 'Strawberries - فراولە', 'Strawberry Ice Cream - ئایس کریمی فراولە', 'Frozen Strawberry - فراولەی بەستوو', 'Vanilla Ice Cream - ئایس کریمی ڤانیلا',
  'Onion Powder - پیاز بۆدرە', 'Garlic Powder - سیر بۆدرە', 'Al Mudhish Milk Powder - شیری بۆدرەی ئەلمودهیش', 'Japanese Panko Breadcrumbs - پانکۆی یابانی', 'Mango Juice - شەربەتی مانگۆ',
  'HP Sauce - سۆسی ئێچ پی', 'Brownies - براونیس', 'Mixed Spices - بەهاراتی تێکەڵ', 'Mixed Frozen Peas - بزالیای تێکەڵ', 'Pepperoni - پیپەرونی', 'Green Pepper - بیبەری سەوز',
  'Bawadi Chicken 1.2Kg - مریشکی بەوادی', 'Bawadi Chicken 1.6Kg - مریشکی بەوادی', 'Kalasher Rice - برنجی کەلەشیر', 'Nawras Rice - برنجی نەورەس', 'Mahmood Rice - برنجی مەحمود',
  'Penne Pasta - پاستای پێنی', 'Almarai Barista Milk - شیری بارستای ئەلمەراعی', 'Turkish Delight - لوقمی تورکی', 'Mersin Labneh Bucket - لەبنەی مێرسین سەتڵ'].map(name => ({ name }));
const first = (i, o = live, ctx) => L.suggest(i, o, 4, ctx)[0]?.name;
const all = (i, o = live, ctx) => L.suggest(i, o, 4, ctx).map(x => x.name);
assert.equal(first(it('عصير سن ایچ خۆخ', ['Sunich peach juice'])), 'Sunich Peach Nectar - شەربەتی سن ئیچ خۆخ', 'peach, not the first Sunich juice');
assert.deepEqual(all(it('فنگر باتوو', ['French fries', 'Frozen fries'])), ['Bato Fries - فینگر باتۆ'], 'French fries are not French lettuce');
assert.equal(first(it('زيت ١٨ لتری', ['Cooking oil 18 liters'])), 'Cooking Oil 18L - زەیتی 18 لیتری', 'oil, not cooking cream');
assert.equal(first(it('معجون طماطه', ['Tomato paste'])), 'Altunsa Tomato Paste - دۆشاوی تەماتەی ئەلتونسا', 'tomato paste is not tomato');
assert.equal(first(it('ئایسکرێمی فراولە', ['Strawberry ice cream', 'Strawberry'])), 'Strawberry Ice Cream - ئایس کریمی فراولە', 'a short search name does not win over the full name');
assert.deepEqual(all(it('حليب مدهش بودرە', ['Mudheesh milk powder', 'Powdered milk'])), ['Al Mudhish Milk Powder - شیری بۆدرەی ئەلمودهیش'], 'Mudheesh is Mudhish; powder alone is not enough');
assert.deepEqual(all(it('خبز بانکۆ')), ['Japanese Panko Breadcrumbs - پانکۆی یابانی'], 'Panko is not Mango');
assert.deepEqual(all(it('(٢٥٥مل) HPصاص', ['HP sauce 255ml', 'Brown sauce'])), ['HP Sauce - سۆسی ئێچ پی'], 'brown sauce is not brownies');
assert.equal(first(it('بزالیا کۆکتیل', ['Mixed vegetables', 'Vegetable cocktail'])), 'Mixed Frozen Peas - بزالیای تێکەڵ', 'mixed alone is not enough');
assert.deepEqual(all(it('بیبەری سەوز', ['Green pepper'])), ['Green Pepper - بیبەری سەوز'], 'pepper is not pepperoni');
assert.equal(first(it('مریشک بوادی ١.٦٠٠ کیلۆ', ['Bawadi chicken 1.6kg'])), 'Bawadi Chicken 1.6Kg - مریشکی بەوادی', 'the same size first (1.600 is 1.6)');
assert.equal(first(it('مریشک بوادی ١.٢٠٠ کیلۆ', ['Bawadi chicken 1.2kg'])), 'Bawadi Chicken 1.2Kg - مریشکی بەوادی');
assert.equal(first(it('برنج نەورەس 5 کیلۆیی', ['Nawras rice 5kg', 'Rice'])), 'Nawras Rice - برنجی نەورەس', 'the brand, not the first rice');
assert.deepEqual(all(it('بێنی پاستا', ['Penne pasta'])), ['Penne Pasta - پاستای پێنی'], 'pasta is not barista');
assert.equal(first(it('لبنە تورکیە', ['Turkish labneh', 'Labneh'])), 'Mersin Labneh Bucket - لەبنەی مێرسین سەتڵ', 'لبنە and لەبنە are one word');
// Signals: who delivered it, the unit, and a link already made.
const rice = it('برنج', ['Rice']), rices = live.filter(o => /Rice/.test(o.name));
const withFrom = rices.map(o => /Mahmood/.test(o.name) ? { ...o, from: ['کۆگای مختار'] } : o);
assert.equal(first(rice, withFrom, { supplier: 'شرکە مختار' }), 'Mahmood Rice - برنجی مەحمود', 'the supplier on its receipts picks it');
assert.ok(L.rank(rice, withFrom, { supplier: 'شرکە مختار' }).find(r => /Mahmood/.test(r.o.name)).why.includes('supplier'));
assert.ok(!L.rank(rice, withFrom, { supplier: 'Kale Company' }).find(r => /Mahmood/.test(r.o.name)).why.includes('supplier'), 'another supplier does not');
assert.ok(L.sameSupplier('صمون گۆلدن برید', 'Golden Bread Bakery · صەمونی گۆڵدن برێد') && L.sameSupplier('ابو ابراهیم قصاب', 'قصاب أبو إبراهيم') && !L.sameSupplier('شرکە مختار', 'شرکە کۆکەکۆلا'), 'supplier names as written on receipts');
const withUnits = rices.map(o => /Nawras/.test(o.name) ? { ...o, units: ['کیس', 'کیلۆ'] } : { ...o, units: ['کارتۆن'] });
assert.ok(L.rank(rice, withUnits, { unit: 'kg' }).find(r => /Nawras/.test(r.o.name)).why.includes('unit'), 'kg is کیلۆ');
const taken = new Map([['Kalasher Rice - برنجی کەلەشیر', 'Kalasher rice']]);
const tk = L.rank(rice, rices, { taken }).find(r => /Kalasher/.test(r.o.name));
assert.ok(tk.warn.includes('taken') && tk.taken === 'Kalasher rice', 'linked already: said, and ranked lower');
const sz = L.rank(it('Cooking oil 1 liter'), live).find(r => /18L/.test(r.o.name));
assert.ok(sz.warn.includes('size'), '1 liter and 18L are different sizes');
// Sure: a clear best match with nothing against it; never when two are close.
assert.ok(L.sure(L.suggest(it('عصير سن ایچ خۆخ', ['Sunich peach juice']), live, 4, {}, true)), 'peach nectar is sure');
assert.ok(!L.sure(L.suggest(it('Rice'), rices, 4, {}, true)), 'three rices: not sure');
assert.ok(!L.sure(L.suggest(rice, rices, 4, { taken }, true).filter(r => /Kalasher/.test(r.o.name))), 'linked to another item: not sure');
// Links already made that may be wrong: the wrong Sunich juice (names pass matches()), another size, an
// item on the same stock item; never a right one, nor another kind of the same thing.
const linked = (x, stockItem) => ({ ...x, stockItem });
const peachItem = it('عصير سن ایچ خۆخ', ['Sunich peach juice']);
const dw = L.doubt(linked(peachItem, 'Sunich Mango Juice - شەربەتی سن ئیچ مەنگۆ'), live);
assert.ok(dw && dw.warn.includes('better') && /Peach Nectar/.test(dw.better.o.name), 'mango for peach: the peach nectar is closer');
assert.equal(L.doubt(linked(peachItem, 'Sunich Peach Nectar - شەربەتی سن ئیچ خۆخ'), live), null, 'the right one: nothing to say');
assert.ok(L.doubt(linked(it('Cooking oil 1 liter'), 'Cooking Oil 18L - زەیتی 18 لیتری'), live).warn.includes('size'), 'another size');
assert.ok(L.doubt(linked(rice, 'Kalasher Rice - برنجی کەلەشیر'), rices, { taken }).warn.includes('taken'), 'another item on it');
assert.ok(L.doubt(linked(rice, 'Banana - مۆز'), [...rices, { name: 'Banana - مۆز' }]).warn.includes('name'), 'a name that does not match');
assert.equal(L.doubt(linked(rice, 'Nawras Rice - برنجی نەورەس'), rices), null, 'another kind of rice: left alone');
assert.equal(L.doubt(linked(rice, 'Gone Rice'), rices), null, 'no longer in the list: said elsewhere');

// Level for the Order screen colour: empty, low (less than 3 days at the pace of the last 14 days, at
// least 2 moves) or ok; without usage it is ok.
const carrot = { name: 'Carrot - گێزەر', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 2000 } };
const moves = n => Array.from({ length: n }, () => ({ from_zone: 'Main Storage', lines: [{ item: carrot.name, unit: 'کیلۆ', qty: 2 }] }));
assert.equal(L.level(carrot, L.usage([], [carrot], L.MAIN)).level, 'ok', 'no usage: in stock');
assert.equal(L.level(carrot, L.usage(moves(7), [carrot], L.MAIN)).level, 'low', '14 kg in 14 days, 2 kg left: 2 days, low');
assert.equal(L.level(carrot, L.usage(moves(1), [carrot], L.MAIN)).level, 'ok', 'one move is not enough to judge');
assert.equal(L.level({ ...carrot, stock: { 'Main Storage': 0 } }, new Map()).level, 'empty');
assert.equal(L.level(carrot, L.usage([{ ...moves(1)[0], mode: 'practice' }, ...moves(1)], [carrot], L.MAIN)).level, 'ok', 'practice runs never count');
// Low stock alerts: the level is counted in the counting format (the first unit Ricotta Restaurant counts
// it in), so 4 means 4 kilos for Banana, 4 pieces for Parmesan, 4 cartons for an item counted in cartons.
assert.deepEqual(L.counted(banana(5300)), { qty: 5.3, unit: 'کیلۆ' });
assert.deepEqual(L.counted(parm(60)), { qty: 60, unit: 'دانە' }, 'Parmesan is counted in pieces, not the cartons it is bought in');
const cartons = (n) => ({ name: 'Cups', base: 'دانە', count: { name: 'کارتۆن', factor: 50 }, buy: { name: 'کارتۆن', factor: 50 }, stock: { 'Main Storage': n } });
assert.deepEqual(L.counted(cartons(200)), { qty: 4, unit: 'کارتۆن' });
const noCount = { name: 'Mushroom', base: 'غرام', count: null, buy: { name: 'کارتۆن', factor: 2000 }, stock: { 'Main Storage': 6000 } };
assert.deepEqual(L.counted(noCount), { qty: 3, unit: 'کارتۆن' }, 'no counting unit: counted in its buying unit, as Ricotta Restaurant does');
assert.equal(L.atOrBelow(cartons(200), 4), true, 'equal to the level is low');
assert.equal(L.atOrBelow(cartons(199), 4), true);
assert.equal(L.atOrBelow(cartons(201), 4), false, '4.02 cartons is above 4');
assert.equal(L.atOrBelow(banana(4000), 4), true);
assert.equal(L.atOrBelow(banana(4001), 4), false);
assert.equal(L.atOrBelow(parm(4), 4), true);
assert.equal(L.atOrBelow(parm(5), 4), false);
assert.equal(L.atOrBelow(parm(0), 0), true, 'a level of 0 alerts when it is empty');
assert.equal(L.atOrBelow(parm(0), null), false, 'no level: never');
for (const bad of [null, undefined, '', -1, 'abc', true, 1e9]) assert.equal(L.lowLevel(bad), null, `${bad} is no level`);
assert.equal(L.lowLevel('4'), 4); assert.equal(L.lowLevel(2.5), 2.5); assert.equal(L.lowLevel(0), 0);
// Once per drop: alerted when it reaches the level, not again while it stays low, again after it was back above.
const tcups = cartons(150), rowsOf = (alertedAt) => [{ id: 'cups', stock_item: 'Cups', low_alert: 4, low_alerted_at: alertedAt }];
let ch = L.lowChanges(rowsOf(null), [tcups]);
assert.deepEqual(ch.alert.map(r => [r.id, r.count]), [['cups', { qty: 3, unit: 'کارتۆن' }]]); assert.deepEqual(ch.clear, []);
ch = L.lowChanges(rowsOf('2026-11-15T10:00:00Z'), [tcups]);
assert.deepEqual([ch.alert.length, ch.clear.length], [0, 0], 'still low and already alerted: nothing');
ch = L.lowChanges(rowsOf('2026-11-15T10:00:00Z'), [cartons(500)]);
assert.deepEqual([ch.alert.length, ch.clear], [0, ['cups']], 'back above: ready to alert again');
assert.deepEqual(L.lowChanges(rowsOf(null), [cartons(500)]), { alert: [], clear: [] });
assert.deepEqual(L.lowChanges(rowsOf(null), []), { alert: [], clear: [] }, 'stock item not in the list: nothing changes');
assert.deepEqual(L.lowChanges([{ id: 'x', stock_item: 'Cups', low_alert: null, low_alerted_at: null }], [tcups]), { alert: [], clear: [] });
// Several stock items for one ordering item (Soy sauce linked to three soy sauces).
{
  const soyA = { name: 'Soy Sauce A', base: 'دانە', count: { name: 'دانە', factor: 1 }, buy: { name: 'کارتۆن', factor: 12 }, stock: { 'Main Storage': 15 } };
  const soyB = { name: 'Soy Sauce B', base: 'دانە', count: { name: 'دانە', factor: 1 }, buy: { name: 'کارتۆن', factor: 24 }, stock: { 'Main Storage': 5 } };
  const soyKg = { name: 'Soy Sauce Bulk', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 3000 } };
  const noCount = { name: 'Okra Box', base: 'دانە', count: null, buy: { name: 'کارتۆن', factor: 30 }, stock: { 'Main Storage': 30 } };
  // linksOf: the list first, else the single older link; each name once.
  assert.deepEqual(L.linksOf({ stockItems: ['A', 'B', 'A'] }), ['A', 'B']);
  assert.deepEqual(L.linksOf({ stock_items: [], stock_item: 'Old' }), ['Old'], 'older rows: the single link');
  assert.deepEqual(L.linksOf({}), []);
  // Same kind: added together in pieces, never cartons (15 + 5 = 20 pieces, though 12 or 24 would be a carton each).
  let c = L.combine([soyA, soyB], new Map());
  assert.deepEqual(c.kinds, [{ qty: 20, unit: 'دانە' }]);
  assert.equal(c.multi, true); assert.equal(c.level, 'ok'); assert.equal(c.empty, false);
  assert.deepEqual(c.parts.map((p) => [p.name, p.qty, p.unit]), [['Soy Sauce A', 15, 'دانە'], ['Soy Sauce B', 5, 'دانە']], 'each part with its own amount');
  // Mixed kinds stand side by side, the first link's kind first: "20 pieces + 3 kilos".
  c = L.combine([soyA, soyB, soyKg], new Map());
  assert.deepEqual(c.kinds, [{ qty: 20, unit: 'دانە' }, { qty: 3, unit: 'کیلۆ' }]);
  assert.deepEqual(c.count, { qty: 20, unit: 'دانە' }, 'a low level counts the first kind');
  // An item with no counting unit is counted in its usage unit, never its cartons (30 pieces, not 1 carton).
  assert.deepEqual(L.combine([noCount, soyB], new Map()).kinds, [{ qty: 35, unit: 'دانە' }]);
  // Empty only when all are empty; low on the parts' added pace.
  assert.equal(L.combine([{ ...soyA, stock: { 'Main Storage': 0 } }, { ...soyB, stock: { 'Main Storage': 0 } }], new Map()).level, 'empty');
  const fast = new Map([['Soy Sauce A', { base: 140, n: 5 }], ['Soy Sauce B', { base: 0, n: 0 }]]);   // 10 a day: 20 left is 2 days
  assert.equal(L.combine([soyA, soyB], fast).level, 'low');
  const slow = new Map([['Soy Sauce A', { base: 28, n: 3 }]]);   // 2 a day: 10 days
  assert.equal(L.combine([soyA, soyB], slow).level, 'ok');
  // Low stock alerts on the combined amount: 20 pieces, level 25 alerts; level 10 doesn't.
  const row = (low) => ({ id: 'soy', stock_item: 'Soy Sauce A', stock_items: ['Soy Sauce A', 'Soy Sauce B'], low_alert: low, low_alerted_at: null });
  let ch2 = L.lowChanges([row(25)], [soyA, soyB]);
  assert.equal(ch2.alert.length, 1); assert.deepEqual(ch2.alert[0].count, { qty: 20, unit: 'دانە' });
  ch2 = L.lowChanges([row(10)], [soyA, soyB]);
  assert.equal(ch2.alert.length, 0, 'one part alone (5) is low, but together they are not');
  // A linked stock item no longer in the list: the others still count.
  assert.equal(L.lowChanges([row(25)], [soyA]).alert[0].count.qty, 15);
}
console.log('Stock links PASS: several stock items for one item (added in pieces, mixed kinds side by side, low and alerts on the total); low stock levels (counted in cartons, pieces or kilos as counted; at or below; once per drop); suggestions (both kinds, never a wrong one; rare words, extra words, sizes, supplier, unit, links already made; sure matches; links that may be wrong), empty/low/ok levels, real names link (typos, plurals, Kurdish, search names), wrong ones are blocked, buying unit only for whole numbers of it');
