// Admin alerts about Ricotta Restaurant's item names (supabase/functions/api/stock-names.ts,
// autoCheckNames): nothing happens while the names are the same; when they change only new names go to
// the AI; Rozh hears once per new mistake (never twice); a name she fixed counts as fixed. Runs the real
// code on a small in-memory database with a pretend AI.
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/transfers.js';
import { autoCheckNames, stockNames, alertWords } from '../supabase/functions/api/stock-names.ts';

function fakeDb(tables) {
  const from = (t) => {
    const list = tables[t] ??= [];
    let op = 'select', patch = null;
    const f = [];
    const run = () => {
      if (op === 'upsert') { const at = list.findIndex((r) => r.id === patch.id); if (at >= 0) list[at] = { ...list[at], ...patch }; else list.push({ ...patch }); return { data: null, error: null }; }
      if (op === 'insert') { list.push(patch); return { data: null, error: null }; }
      return { data: list.filter((r) => f.every((x) => x(r))).map((r) => structuredClone(r)), error: null };
    };
    const q = {
      select() { return q; }, upsert(p) { op = 'upsert'; patch = p; return q; }, insert(p) { op = 'insert'; patch = p; return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; }, in(k, v) { f.push((r) => v.includes(r[k])); return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { from, tables };
}
globalThis.Deno ??= { env: { get: () => undefined } };   // stockNames reads the AI keys (none here)
const items = (names) => ({ id: true, data: { titems: names.map((name) => ({ name })), items: [] }, updated_at: new Date().toISOString() });
const db = fakeDb({ app_rr_catalog: [items(['Milk - شیر', 'Mozarella - پەنیری مۆزارێلا', 'Lemon -لیمۆ'])], app_stock_names: [], app_secrets: [], app_ai_switches: [] });
const sent = [], told = [];
const deps = {
  keys: async () => ({ anthropicKey: 'test' }),
  ask: async (_k, names) => { sent.push(...names); return { provider: 'anthropic', reply: { fixes: names.filter((n) => n.startsWith('Mozarella')).map((n) => ({ name: n, fixed: n.replace('Mozarella', 'Mozzarella'), why: 'Misspelled: Mozarella' })) } }; },
  tell: async (_db, w) => { told.push(w); },
};

// 1. First time: every name to the AI; one alert with both mistakes.
let r = await autoCheckNames(db, deps);
assert.equal(r.did, true);
assert.equal(sent.length, 3);
assert.equal(told.length, 1);
assert.match(told[0].en, /^2 names in Ricotta Restaurant have mistakes\. 2 to fix in all\./);

// 2. Same names again: nothing at all.
r = await autoCheckNames(db, deps);
assert.equal(r.did, false);
assert.equal(sent.length, 3);
assert.equal(told.length, 1);

// 3. Rozh fixes Lemon and a new item arrives: only the two new names go to the AI, no alert (no new mistake).
db.tables.app_rr_catalog[0] = items(['Milk - شیر', 'Mozarella - پەنیری مۆزارێلا', 'Lemon - لیمۆ', 'Sugar - شەکر']);
r = await autoCheckNames(db, deps);
assert.deepEqual(sent.slice(3).sort(), ['Lemon - لیمۆ', 'Sugar - شەکر']);
assert.equal(told.length, 1);
let v = await stockNames(Object.assign(db, {}));
assert.equal(v.rows.length, 1);
assert.equal(v.fixed, 1);

// 4. A new item with a mistake: one alert naming it.
db.tables.app_rr_catalog[0] = items(['Milk - شیر', 'Mozarella - پەنیری مۆزارێلا', 'Lemon - لیمۆ', 'Sugar - شەکر', 'Tea  - چا']);
await autoCheckNames(db, deps);
assert.equal(told.length, 2);
assert.equal(told[1].en, 'A name in Ricotta Restaurant has a mistake: "Tea  - چا". 2 to fix in all. See Admin, Stock names.');
assert.ok(alertWords(['a', 'b'], 5).ku.includes('5'));

console.log('Stock names alerts PASS: unchanged names do nothing, only new names go to the AI, one alert per new mistake, fixed names counted');
