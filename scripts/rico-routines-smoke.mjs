// Rico's routines (supabase/functions/_shared/routines.ts): checked input, the due-time rule, once a
// Baghdad day even with two ticks at once, roles, the usual order from real past orders, and that a
// prepared order only ever lands in the person's own inbox (nothing is sent to a supplier or saved as an order).
import assert from 'node:assert/strict';
import * as R from '../supabase/functions/_shared/routines.ts';

// Input
assert.equal(R.cleanRoutine({ kind: 'remind', text: 'Do the transfers', time: '09:00' }).value.days.length, 7, 'days default to every day');
assert.equal(R.cleanRoutine({ kind: 'remind', text: 'x', time: '9:00' }).error, 'time');
assert.equal(R.cleanRoutine({ kind: 'remind', text: 'x', time: '24:00' }).error, 'time');
assert.equal(R.cleanRoutine({ kind: 'remind', text: '  ', time: '09:00' }).error, 'text');
assert.equal(R.cleanRoutine({ kind: 'remind', text: 'x', time: '09:00', days: [7] }).error, 'days');
assert.equal(R.cleanRoutine({ kind: 'prepare_order', text: 'x', time: '07:00' }).error, 'suppliers', 'a prepared order needs a supplier');
assert.equal(R.cleanRoutine({ kind: 'send_order', text: 'x', time: '07:00' }).error, 'kind', 'there is no kind that sends');
assert.deepEqual(R.cleanRoutine({ kind: 'remind', text: 'x', time: '07:00', supplier_ids: ['s1'] }).value.supplier_ids, [], 'a reminder keeps no suppliers');

// Due
const base = { id: 'r1', account: 'yunis', kind: 'remind', text: 'Do the transfers', supplier_ids: [], time: '09:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true, last_run_day: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
const now = (minutes, date = '2026-11-14', weekday = 6) => ({ date, minutes, weekday });
assert.equal(R.isDue(base, now(8 * 60 + 59)), false, 'not before its time');
assert.equal(R.isDue(base, now(9 * 60)), true, 'at its time');
assert.equal(R.isDue(base, now(11 * 60 + 59)), true, 'a missed tick still runs it within 3 hours');
assert.equal(R.isDue(base, now(12 * 60)), false, 'never more than 3 hours late');
assert.equal(R.isDue({ ...base, last_run_day: '2026-11-14' }, now(9 * 60 + 5)), false, 'once a day');
assert.equal(R.isDue({ ...base, enabled: false }, now(9 * 60 + 5)), false, 'switched off');
assert.equal(R.isDue({ ...base, days: [0] }, now(9 * 60 + 5)), false, 'not one of its days');
assert.equal(R.isDue({ ...base, updated_at: '2026-11-14T07:30:00Z' }, now(10 * 60 + 40)), false, 'made after today\'s time (10:30 Baghdad): starts next time');

// Usual order: items in at least half of that supplier's same-weekday orders, at the median amount.
const ord = (weekday, lines) => ({ weekday, lines: lines.map(([item_id, supplier_id, qty]) => ({ item_id, supplier_id, qty })) });
const past = [ord(6, [['tom', 's1', 10], ['basil', 's1', 2], ['milk', 's2', 5]]), ord(6, [['tom', 's1', 12], ['onion', 's1', 1]]), ord(6, [['tom', 's1', 14], ['basil', 's1', 4]]), ord(3, [['lemon', 's1', 9]])];
const avail = new Set(['tom', 'basil', 'onion', 'lemon']);
assert.deepEqual(R.usualLines(past, 's1', 6, avail), [{ itemId: 'basil', qty: 3 }, { itemId: 'tom', qty: 12 }]);
assert.deepEqual(R.usualLines(past, 's1', 6, new Set(['tom'])), [{ itemId: 'tom', qty: 12 }], 'unavailable items are left out');
assert.deepEqual(R.usualLines(past, 's9', 6, avail), [], 'no past orders: nothing');
assert.ok(R.usualLines(past, 's1', 3, avail).some((l) => l.itemId === 'tom'), 'too few same-weekday orders: the last 4 on any day');

// Runner, with a small fake database
function fakeDb(rows) {
  const writes = [];
  const db = { writes, from(table) {
    const f = []; let patch = null, upsert = null;
    const q = {
      select() { return q; }, limit() { return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; },
      or(expr) { const day = expr.split('neq.')[1]; f.push((r) => r.last_run_day == null || r.last_run_day !== day); return q; },
      update(p) { patch = p; return q; },
      upsert(list) { upsert = list; writes.push({ table, rows: list }); return q; },
      then(res, rej) {
        if (upsert) return Promise.resolve({ error: null }).then(res, rej);
        const hit = (table === 'app_rico_routines' ? rows : []).filter((r) => f.every((fn) => fn(r)));
        if (patch) { hit.forEach((r) => Object.assign(r, patch)); writes.push({ table, patch }); }
        return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(res, rej);
      },
    };
    return q;
  } };
  return db;
}
const pushes = [];
const deps = (over = {}) => ({
  now: now(9 * 60 + 2), canUse: () => true,
  history: async () => ({ orders: past, available: avail, suppliers: new Map([['s1', 'Erbil Veg Market']]) }),
  notify: async (account, words, tag) => { pushes.push({ account, words, tag }); },
  ...over,
});
const rows = [{ ...base }, { ...base, id: 'r2', account: 'rozha', kind: 'prepare_order', text: 'Veg order', supplier_ids: ['s1'], time: '09:00' }];
const db = fakeDb(rows);
const first = await R.runRoutines(db, deps());
assert.equal(first.length, 2, 'both ran');
assert.equal(pushes.length, 2);
assert.deepEqual(pushes.map((p) => p.account).sort(), ['rozha', 'yunis'], 'each push goes only to the routine\'s own person');
const order = db.writes.find((w) => w.rows?.[0]?.kind === 'routine_order').rows[0];
assert.equal(order.account, 'rozha');
assert.deepEqual(order.payload.lines, [{ itemId: 'basil', qty: 3 }, { itemId: 'tom', qty: 12 }], 'the usual lines ride with the message');
assert.ok(db.writes.every((w) => ['app_rico_routines', 'app_rico_inbox'].includes(w.table)), 'nothing but the routine and the inbox is written: no order, nothing to a supplier');
assert.match(pushes.find((p) => p.account === 'rozha').words.en, /Check it and send it/);
const again = await R.runRoutines(db, deps({ now: now(9 * 60 + 3) }));
assert.deepEqual(again, { skipped: 'nothing due' }, 'a second tick the same day does nothing');
assert.equal(pushes.length, 2);

// Roles: someone who lost Rico (or History, for prepared orders) gets nothing.
const db2 = fakeDb([{ ...base, id: 'r3' }]);
assert.deepEqual(await R.runRoutines(db2, deps({ canUse: () => false })), { skipped: 'nothing due' });
assert.equal(db2.writes.length, 0, 'a routine without access is not even claimed');

// Two ticks at the same moment: both see it due, only the one that claims it first runs it.
const db3 = fakeDb([{ ...base, id: 'r4' }]);
const before = pushes.length;
await Promise.all([R.runRoutines(db3, deps()), R.runRoutines(db3, deps())]);
assert.equal(pushes.length - before, 1, 'never twice');
// One-off reminders: "in 30 seconds", "at 17:00", "tomorrow at 9"; fired once, then removed.
const T0 = Date.parse('2026-11-14T11:00:00Z');   // 14:00 Baghdad
assert.equal(R.whenOnce({ in_seconds: 30 }, T0), T0 + 30000);
assert.equal(R.whenOnce({ at: '17:00' }, T0), Date.parse('2026-11-14T14:00:00Z'), 'later today');
assert.equal(R.whenOnce({ at: '09:00' }, T0), Date.parse('2026-11-15T06:00:00Z'), 'a time already passed means tomorrow');
assert.equal(R.whenOnce({ at: '2026-11-15 09:00' }, T0), Date.parse('2026-11-15T06:00:00Z'));
assert.ok(R.whenOnce({ in_seconds: 3 }, T0).error && R.whenOnce({ at: 'soon' }, T0).error && R.whenOnce({ at: '2026-11-13 09:00' }, T0).error, 'too soon, unclear or past is refused');
const once = R.cleanRoutine({ kind: 'remind', text: 'Do the transfers', run_at: T0 + 30000 }, T0).value;
assert.equal(once.time, '14:00'); assert.equal(once.run_at, new Date(T0 + 30000).toISOString());
assert.equal(R.cleanRoutine({ kind: 'prepare_order', text: 'x', run_at: T0 + 60000, supplier_ids: ['s1'] }, T0).error, 'when', 'only reminders are one-off');
const oneRow = { ...base, id: 'o1', ...once, last_run_day: null };
assert.equal(R.isDue(oneRow, now(14 * 60), T0), false, 'not before its moment');
assert.equal(R.isDue(oneRow, now(14 * 60 + 1), T0 + 31000), true, 'due once its moment has come');
const db4 = fakeDb([oneRow]);
db4.from = ((orig) => (table) => { const q = orig.call(db4, table); q.delete = () => { db4.writes.push({ table, deleted: true }); oneRow.gone = true; return q; }; return q; })(db4.from);
const p0 = pushes.length;
await R.runRoutines(db4, deps({ now: now(14 * 60 + 1), nowMs: T0 + 31000 }));
assert.equal(pushes.length - p0, 1, 'the one-off reminder came');
assert.ok(db4.writes.some((w) => w.deleted), 'and was removed');
assert.deepEqual(await R.runRoutines(db4, deps({ now: now(14 * 60 + 2), nowMs: T0 + 91000 })), { skipped: 'nothing due' }, 'never twice');
console.log('Rico routines PASS: one-off reminders (in seconds, at a time, tomorrow) fire once and go, checked input, due within 3 hours once a day, roles, usual order from real orders, only the person\'s own inbox and push, never sent to a supplier');
