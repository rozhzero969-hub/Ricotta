// A chat's name from the AI (assistant.ts cleanTitle): one short line, no quotes, labels, emoji, dashes or
// end marks; too long or empty gives nothing (the app then keeps the first words of the question).
import assert from 'node:assert/strict';
import { cleanTitle } from '../supabase/functions/api/assistant.ts';

assert.equal(cleanTitle('Cheese stock'), 'Cheese stock');
assert.equal(cleanTitle('"Cheese stock."'), 'Cheese stock');
assert.equal(cleanTitle('Title: Late orders today'), 'Late orders today');
assert.equal(cleanTitle('**Price changes** \n more text'), 'Price changes');
assert.equal(cleanTitle('Stock — cheese 🧀'), 'Stock cheese');
assert.equal(cleanTitle('بڕی پەنیر؟'), 'بڕی پەنیر');
assert.equal(cleanTitle(''), null);
assert.equal(cleanTitle('This is far too long to be the short name of a chat in the sidebar list'), null);
console.log('Chat title PASS: short, plain names; long or empty answers fall back');
