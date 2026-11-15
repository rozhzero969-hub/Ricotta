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

// Level for the Order screen colour: empty, low (less than 3 days at the pace of the last 14 days, at
// least 2 moves) or ok; without usage it is ok.
const carrot = { name: 'Carrot - گێزەر', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: { 'Main Storage': 2000 } };
const moves = n => Array.from({ length: n }, () => ({ from_zone: 'Main Storage', lines: [{ item: carrot.name, unit: 'کیلۆ', qty: 2 }] }));
assert.equal(L.level(carrot, L.usage([], [carrot], L.MAIN)).level, 'ok', 'no usage: in stock');
assert.equal(L.level(carrot, L.usage(moves(7), [carrot], L.MAIN)).level, 'low', '14 kg in 14 days, 2 kg left: 2 days, low');
assert.equal(L.level(carrot, L.usage(moves(1), [carrot], L.MAIN)).level, 'ok', 'one move is not enough to judge');
assert.equal(L.level({ ...carrot, stock: { 'Main Storage': 0 } }, new Map()).level, 'empty');
assert.equal(L.level(carrot, L.usage([{ ...moves(1)[0], mode: 'practice' }, ...moves(1)], [carrot], L.MAIN)).level, 'ok', 'practice runs never count');
console.log('Stock links PASS: suggestions (both kinds, never a wrong one; rare words, extra words, sizes, supplier, unit, links already made; sure matches), empty/low/ok levels, real names link (typos, plurals, Kurdish, search names), wrong ones are blocked, buying unit only for whole numbers of it');
