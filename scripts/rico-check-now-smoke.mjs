// Check now: the button asks Rico once, he takes it once, and the answer says what changed in
// Ricotta Restaurant's suppliers, zones, items and units. Runs the real API code on a small in-memory table.
import assert from 'node:assert/strict';
import { askSync, catalogChanges, helperRoute, helperView, SYNC_VERSION } from '../supabase/functions/api/receipts.ts';

// Just enough of the database client for the rows Check now touches (one helper row, one catalog row).
function fakeDb(rows) {
  const from = (table) => {
    let op = 'select', patch = null, filters = [];
    const match = (r) => filters.every(([k, kind, v]) => kind === 'is' ? (r[k] ?? null) === v : r[k] === v);
    const run = () => {
      const list = rows[table] ?? (rows[table] = []);
      if (op === 'update') { const hit = list.filter(match); hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ ...r })), error: null }; }
      if (op === 'upsert') { const r = list.find((x) => x.id === patch.id); if (r) Object.assign(r, patch); else list.push({ ...patch }); return { data: null, error: null }; }
      return { data: list.filter(match).map((r) => ({ ...r })), error: null };
    };
    const q = {
      select() { return q; }, update(p) { op = 'update'; patch = p; return q; }, upsert(p) { op = 'upsert'; patch = p; return q; },
      eq(k, v) { filters.push([k, 'eq', v]); return q; }, is(k, v) { filters.push([k, 'is', v]); return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}) }) } };
}
const json = (b, s = 200) => ({ status: s, body: b });
const fail = (e, s = 400) => ({ status: s, body: { error: e } });
const today = new Date().toISOString().slice(0, 10);
const cat = {
  suppliers: ['Jabal Amman', 'Old Supplier'], zones: ['Main Storage', 'Pizza'],
  items: [{ name: 'Flour', base: 'غرام', units: [{ name: 'کیلۆ', factor: 1000 }] }, { name: 'Salt', base: 'غرام', units: [] }],
  titems: [{ name: 'Flour', base: 'غرام', count: { name: 'کیلۆ', factor: 1000 }, buy: null, stock: {} }, { name: 'Salt', base: 'غرام', count: null, buy: null, stock: {} }],
};
const rows = {
  app_rr_helper: [{ id: true, last_seen: new Date().toISOString(), version: SYNC_VERSION + '.1', photos_cleaned: today, sync_state: null }],
  app_rr_catalog: [{ id: true, data: cat, updated_at: new Date().toISOString() }],
};
const db = fakeDb(rows), H = () => rows.app_rr_helper[0];
const ctx = { db, json, fail, account: null, rozha: false };

// Off, or an older Rico that doesn't know the button: nothing is asked.
H().last_seen = null; assert.equal((await askSync(db, 'rozha')).error, 'rico_off'); H().last_seen = new Date().toISOString();
H().version = '2026-11-14.1'; assert.equal((await askSync(db, 'rozha')).error, 'rico_old'); H().version = SYNC_VERSION + '.1';
assert.equal(helperView(H()).canSync, true);

// Asked once; a second press while it waits doesn't ask again.
const a = await askSync(db, 'yunis');
assert.equal(a.error, undefined); assert.equal(a.helper.sync.state, 'asked'); assert.equal(H().sync_by, 'yunis');
assert.equal((await askSync(db, 'rozha')).error, 'already_checking');

// An older Rico asking for work never takes it; a new one does, once (heartbeat while free, or claim).
assert.equal((await helperRoute(ctx, 'POST', 'helper/heartbeat', { idle: true, version: H().version })).body.checkNow, undefined);
assert.equal((await helperRoute(ctx, 'POST', 'helper/heartbeat', { idle: false, sync: true, version: H().version })).body.checkNow, undefined);
assert.equal((await helperRoute(ctx, 'POST', 'helper/heartbeat', { idle: true, sync: true, version: H().version })).body.checkNow, true);
assert.equal(H().sync_state, 'running');
assert.equal((await helperRoute(ctx, 'POST', 'helper/heartbeat', { idle: true, sync: true, version: H().version })).body.checkNow, undefined);
assert.equal((await askSync(db, 'rozha')).error, 'already_checking');

// He reads the lists: a new item, a unit change, a removed supplier and a new zone are what the answer says.
const next = structuredClone(cat);
next.suppliers = ['Jabal Amman']; next.zones.push('Bar');
next.items.push({ name: 'Sugar', base: 'غرام', units: [] }); next.titems.push({ name: 'Sugar', base: 'غرام', count: null, buy: null, stock: {} });
next.items[0].units = [{ name: 'کیس', factor: 25000 }]; next.titems[0].count = { name: 'کیس', factor: 25000 };
const put = await helperRoute(ctx, 'PUT', 'helper/catalog', { ...next, sync: true });
assert.equal(put.status, 200);
assert.deepEqual(put.body.changes.items.addedNames, ['Sugar']); assert.deepEqual(put.body.changes.items.changedNames, ['Flour']);
assert.deepEqual(put.body.changes.suppliers.removedNames, ['Old Supplier']); assert.deepEqual(put.body.changes.zones.addedNames, ['Bar']);
assert.deepEqual(rows.app_rr_catalog[0].data.items.map((i) => i.name), ['Flour', 'Salt', 'Sugar']);
await helperRoute(ctx, 'POST', 'helper/sync/done', { ok: true });
const done = helperView(H()).sync;
assert.equal(done.state, null); assert.equal(done.result.ok, true); assert.equal(done.result.changes.items.added, 1); assert.equal(done.result.changes.items.changed, 1);

// The 10-minute read (no sync flag) never touches the button's answer.
await helperRoute(ctx, 'PUT', 'helper/catalog', { ...cat });
assert.equal(helperView(H()).sync.result.changes.items.added, 1);

// A failed check says why; a check that never finished stops counting as running after 3 minutes.
await askSync(db, 'rozha'); await helperRoute(ctx, 'POST', 'helper/claim', { sync: true, wait: 0 });
assert.equal(H().sync_state, 'running');
await helperRoute(ctx, 'POST', 'helper/sync/done', { ok: false, error: 'Could not read the unit names from Ricotta Restaurant' });
assert.deepEqual([helperView(H()).sync.result.ok, helperView(H()).sync.result.error], [false, 'Could not read the unit names from Ricotta Restaurant']);
await askSync(db, 'rozha'); await helperRoute(ctx, 'POST', 'helper/claim', { sync: true, wait: 0 });
H().sync_started_at = new Date(Date.now() - 4 * 60_000).toISOString();
assert.deepEqual([helperView(H()).sync.state, helperView(H()).sync.timedOut], [null, true]);
assert.equal((await askSync(db, 'rozha')).error, undefined, 'a stuck check can be asked again');

// Nothing changed: an empty answer. The first read ever has nothing to compare with.
assert.equal(Object.values(catalogChanges(cat, cat)).filter((v) => typeof v === 'object').every((v) => !v.added && !v.removed && !v.changed), true);
assert.equal(catalogChanges({ suppliers: [], zones: [], items: [] }, cat).first, true);
console.log('rico check-now smoke: ok');
