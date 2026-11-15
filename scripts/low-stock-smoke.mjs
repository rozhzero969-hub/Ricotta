// Low stock alerts (supabase/functions/api/low-stock.ts): when Rico writes new stock, an item that dropped
// to its level or below alerts Rozh and Yunis once (an inbox row each and one push), not again while it
// stays low, and again after it went back above. Nothing is written when nothing changed (every write to
// app_items wakes every open app). Runs the real code on a small in-memory table.
import assert from 'node:assert/strict';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/transfers.js';
import '../supabase/functions/_shared/stock-link.js';
import { checkLowStock, lowStockWords, relinkedLowStock } from '../supabase/functions/api/low-stock.ts';

let writes = 0;
function fakeDb(rows) {
  const from = (table) => {
    let op = 'select', patch = null, selected = false;
    const filters = [];
    const run = () => {
      const list = rows[table] ?? (rows[table] = []);
      if (op === 'insert') { list.push(...(Array.isArray(patch) ? patch : [patch])); return { data: null, error: null }; }
      const hit = list.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { if (table === 'app_items') writes++; hit.forEach((r) => Object.assign(r, patch)); return { data: selected ? hit.map((r) => ({ ...r })) : null, error: null }; }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select() { selected = true; return q; }, update(p) { op = 'update'; patch = p; return q; }, insert(p) { op = 'insert'; patch = p; return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; }, in(k, v) { filters.push((r) => v.includes(r[k])); return q; },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return q; }, not(k, _op, v) { filters.push((r) => (r[k] ?? null) !== v); return q; },
      limit() { return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { from };
}

const pushes = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', CRON_SECRET: 'secret' })[k] } };
globalThis.fetch = async (url, init) => { pushes.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response('{}'); };

const cups = (n) => ({ name: 'Paper Cups - کوپی کاغەز', base: 'دانە', count: { name: 'کارتۆن', factor: 50 }, buy: { name: 'کارتۆن', factor: 50 }, stock: { 'Main Storage': n } });
const banana = (g) => ({ name: 'Banana - مۆز', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: { name: 'کیلۆ', factor: 1000 }, stock: { 'Main Storage': g } });
const rows = {
  app_items: [
    { id: 'cups', name: 'Paper cups', stock_item: 'Paper Cups - کوپی کاغەز', low_alert: 4, low_alerted_at: null },
    { id: 'banana', name: 'Banana', stock_item: 'Banana - مۆز', low_alert: 2, low_alerted_at: null },
    { id: 'off', name: 'Tissues', stock_item: 'Paper Cups - کوپی کاغەز', low_alert: null, low_alerted_at: null },
    { id: 'unlinked', name: 'Towels', stock_item: null, low_alert: 3, low_alerted_at: null },
  ],
  app_rr_catalog: [{ id: true, data: { titems: [cups(500), banana(5000)] } }],
  app_rico_inbox: [],
};
const db = fakeDb(rows), item = (id) => rows.app_items.find((r) => r.id === id);
const setStock = (c, b) => { rows.app_rr_catalog[0].data.titems = [cups(c), banana(b)]; };

// Plenty: nothing happens and nothing is written.
assert.equal(await checkLowStock(db), 0);
assert.equal(writes, 0, 'no change: no write to app_items');
assert.equal(pushes.length, 0);

// Cups drop to exactly 4 cartons (200 pieces): one alert, to both accounts.
setStock(200, 5000);
assert.equal(await checkLowStock(db), 1);
assert.ok(item('cups').low_alerted_at, 'marked as alerted');
assert.equal(item('off').low_alerted_at, null, 'no level: never alerted');
assert.equal(item('unlinked').low_alerted_at, null, 'not linked: never alerted');
assert.deepEqual(rows.app_rico_inbox.map((r) => r.account), ['rozha', 'yunis'], 'Rozh and Yunis each get it in the inbox');
assert.equal(pushes.length, 1);
assert.equal(pushes[0].url, 'https://example.supabase.co/functions/v1/send-push');
assert.equal(pushes[0].headers['x-cron-secret'], 'secret');
assert.equal(pushes[0].body.type, 'low-stock');
assert.match(pushes[0].body.bodyEn, /Paper cups.*4 کارتۆن.*left.*alert at.*4 کارتۆن/s, 'counted in cartons, as Ricotta Restaurant counts it');
assert.ok(pushes[0].body.bodyKu && pushes[0].body.bodyAr, 'Kurdish and Arabic too');

// Still low, lower even: no second alert, and nothing written.
const w = writes;
setStock(100, 5000);
assert.equal(await checkLowStock(db), 0);
assert.equal(pushes.length, 1, 'once per drop');
assert.equal(writes, w, 'still low: nothing written');

// Back above, then down again: it alerts again.
setStock(1000, 5000);
assert.equal(await checkLowStock(db), 0);
assert.equal(item('cups').low_alerted_at, null, 'back above its level: ready again');
setStock(150, 1500);
assert.equal(await checkLowStock(db), 2, 'cups again, and banana at 1.5 kilos (alert at 2)');
assert.equal(pushes.length, 2, 'one push for both items');
assert.match(pushes[1].body.bodyEn.replace(/[\u2068\u2069]/g, ''), /Banana: 1\.5 کیلۆ left \(alert at 2 کیلۆ\); Paper cups: 3 کارتۆن left/, 'the lowest for its level first');

// Only some items (a level just saved).
item('banana').low_alerted_at = null;
assert.equal(await checkLowStock(db, { ids: ['cups'] }), 0, 'cups already alerted');
assert.equal(await checkLowStock(db, { ids: [] }), 0);
// Linked to another stock item: starts over, alerts now when already low.
assert.equal(await relinkedLowStock(db, 'cups'), 1);
assert.equal(pushes.length, 3);

// Empty, and many items: a few named and how many more.
const many = Array.from({ length: 6 }, (_, k) => ({ name: `Item ${k}`, low_alert: 1, count: { qty: k ? 1 : 0, unit: 'دانە' } }));
const words = lowStockWords(many);
assert.match(words.en, /Item 0.*none left/);
assert.match(words.en, /and 2 more\.$/);
assert.ok(!words.en.includes('Item 5'));

// A database that can't do it (before the migration): no alert, no crash.
const broken = { from: () => { throw new Error('column app_items.low_alert does not exist'); } };
const mute = console.error; console.error = () => {};
assert.equal(await checkLowStock(broken), 0);
console.error = mute;
console.log('Low stock PASS: alerts Rozh and Yunis once per drop (inbox and one push), counted in the counting format, again after back above, nothing written when nothing changed, never fails the caller');
