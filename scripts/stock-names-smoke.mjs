// Admin, Stock names (supabase/functions/api/stock-names.ts): each rule finds its problem and gives the
// right name to copy, correct names are left alone, and an AI answer is only used where it is safe.
import assert from 'node:assert/strict';
import { nameProblems, catalogNames, cleanFixes } from '../supabase/functions/api/stock-names.ts';

const codes = n=>nameProblems(n).problems.map(p=>p.code);
const fixed = n=>nameProblems(n).fixed;

// Correct names have no problems.
for (const n of ['Mozzarella - پەنیری مۆزارێلا', 'Al Ameed Medium Coffee 20*225 - قاوەی ئەلعەمید مامناوەند', 'Lemon - لیمۆ', 'Faheta Bread - صمونى فاهيتا'])
  assert.deepEqual(codes(n), [], `${n} is fine`);
// Spacing.
assert.deepEqual(codes('Akkawi  Cheese - پەنیری عەکاوی'), ['double']);
assert.equal(fixed('Akkawi  Cheese - پەنیری عەکاوی'), 'Akkawi Cheese - پەنیری عەکاوی');
assert.deepEqual(codes(' Lemon - لیمۆ '), ['edges']);
assert.equal(fixed(' Lemon - لیمۆ '), 'Lemon - لیمۆ');
assert.deepEqual(codes('Lemon -لیمۆ'), ['separator']);
assert.equal(fixed('Lemon-لیمۆ'), 'Lemon - لیمۆ');
assert.equal(fixed('Lemon – لیمۆ'), 'Lemon - لیمۆ', 'an en dash becomes the plain " - "');
// Letters: Arabic forms inside a Kurdish name become Kurdish (ي ك ة ى).
assert.deepEqual(codes('Almonds - باوي کەم'), ['mixedLetters']);
assert.equal(fixed('Almonds - باوي کەم'), 'Almonds - باوی کەم');
assert.equal(fixed('Cake - كێك'), 'Cake - کێک');
// An Arabic name stays Arabic (no Kurdish letters in it).
assert.deepEqual(codes('Dates - تمر عراقي'), []);
// Digits of two kinds become Western digits.
assert.deepEqual(codes('Pepsi 330ml - پێپسی ٣٣٠'), ['digits']);
assert.equal(fixed('Pepsi 330ml - پێپسی ٣٣٠'), 'Pepsi 330ml - پێپسی 330');
// Latin and Kurdish glued into one word.
assert.ok(codes('Parsleyجەعفەری').includes('glued'));
assert.equal(fixed('Parsleyجەعفەری'), 'Parsley - جەعفەری');
// One language only: found, but no name to copy from the rules.
assert.deepEqual(codes('تەماتە'), ['noEnglish']);
assert.deepEqual(codes('Basil'), ['noLocal']);
assert.equal(fixed('Basil'), 'Basil');

// The names checked: each once, without "-" placeholders.
assert.deepEqual(catalogNames({ titems: [{ name: 'B - ب' }, { name: '-' }, { name: ' - ' }], items: [{ name: 'B - ب' }, { name: 'A - ئ' }] }), ['A - ئ', 'B - ب']);

// AI answers: only names we sent, a real change, numbers kept.
const sent = new Set(['Mozarella - پەنیری مۆزارێلا', 'Coffee 20*225 - قاوە', 'Lemon - لیمۆ']);
const got = cleanFixes({ fixes: [
  { name: 'Mozarella - پەنیری مۆزارێلا', fixed: 'Mozzarella - پەنیری مۆزارێلا', why: 'Misspelled: Mozarella' },
  { name: 'Coffee 20*225 - قاوە', fixed: 'Coffee 20*250 - قاوە', why: 'size' },
  { name: 'Lemon - لیمۆ', fixed: 'Lemon - لیمۆ', why: 'same' },
  { name: 'Not sent - نا', fixed: 'Not sent - نە', why: 'x' },
  { name: 'Mozarella - پەنیری مۆزارێلا', fixed: 'Mozzarela - پەنیری مۆزارێلا', why: 'duplicate' },
] }, sent);
assert.deepEqual(got.map(x=>x.name), ['Mozarella - پەنیری مۆزارێلا'], 'numbers changed, no change, unknown names and duplicates are dropped');
assert.deepEqual(cleanFixes({ nope: 1 }, sent), []);
assert.deepEqual(cleanFixes(null, sent), []);
console.log('Stock names PASS: spacing, separator, mixed letters, digits, glued words and one-language names are found with the right name to copy; correct and Arabic names are left alone; AI fixes only for names sent, real changes and the same numbers');
