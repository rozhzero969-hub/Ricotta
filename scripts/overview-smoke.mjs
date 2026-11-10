// Admin's overview (supabase/functions/_shared/overview.js): only real rows are counted, by Baghdad day.
import assert from "node:assert/strict";
import "../supabase/functions/_shared/overview.js";
const O = globalThis.RicottaOverview;

// 23:30 in Baghdad on 9 November is 20:30 UTC; 01:00 in Baghdad on the 10th is still the 9th in UTC.
const now = new Date("2026-11-09T20:30:00Z");
assert.equal(O.baghdadDay("2026-11-09T22:00:00Z"), "2026-11-10", "the day turns at midnight in Baghdad, not UTC");
assert.deepEqual(O.lastDays(now, 3), ["2026-11-07", "2026-11-08", "2026-11-09"]);
assert.equal(O.lastDays(new Date("2026-11-01T10:00:00Z"), 2)[0], "2026-10-31", "across a month");

const orders = [
  { id: "a", sent_at: "2026-11-09T07:03:00Z", sent_by: "yunis" },  // today 10:03
  { id: "b", sent_at: "2026-11-09T13:33:00Z", sent_by: "yunis" },  // today 16:33
  { id: "c", sent_at: "2026-11-08T22:30:00Z", sent_by: "rozha" },  // today 01:30 in Baghdad (8 Nov in UTC)
  { id: "d", sent_at: "2026-11-01T09:00:00Z", sent_by: "yunis" },  // 8 days ago: in 30, not in 7
  { id: "e", sent_at: "2026-10-05T09:00:00Z", sent_by: "yunis" },  // 35 days ago: in neither
];
const lines = [
  { order_id: "a", supplier_name: "Mukhtar" }, { order_id: "a", supplier_name: "Mukhtar" }, { order_id: "b", supplier_name: "Customs" },
  { order_id: "c", supplier_name: "Customs" }, { order_id: "d", supplier_name: "Bakery" }, { order_id: "e", supplier_name: "Old" },
];
const receipts = [
  { id: "r1", status: "saved", total: 4000, currency: "IQD", created_by: "rozha", saved_at: "2026-11-09T12:27:00Z", supplier: "Bread House" },
  { id: "r2", status: "saved", total: 63000.5, currency: "IQD", created_by: "rozha", saved_at: "2026-11-05T12:21:00Z" },
  { id: "r3", status: "saved", total: 12.5, currency: "USD", created_by: "rozha", saved_at: "2026-11-09T10:00:00Z" },
  { id: "r4", status: "problem", supplier: "Mukhtar store", problem: "Invoice not found", created_by: "rozha", updated_at: "2026-11-09T12:10:00Z" },
  { id: "r5", status: "review", created_by: "yunis" },
  { id: "r6", status: "draft" }, { id: "r7", status: "cancelled" },
];
const transfers = [
  { id: "t1", status: "moved", to_zone: "Minibar", created_by: "rozha", moved_at: "2026-11-08T15:15:00Z" },
  { id: "t2", status: "moving", to_zone: "Pizza" },
];
const s = O.summarize({ now, orders, lines, receipts, transfers });

assert.equal(s.today, "2026-11-09");
assert.equal(s.orders.today, 3, "today is counted by the Baghdad day");
assert.equal(s.orders.todayItems, 4);
assert.equal(s.orders.last7, 3);
assert.equal(s.orders.last30, 4, "a 35-day-old order is not in the last 30 days");
assert.equal(s.orders.items30, 5);
assert.equal(s.orders.perDay.length, 14);
assert.deepEqual(s.orders.perDay.at(-1), { day: "2026-11-09", n: 3 });
assert.equal(s.orders.perDay.reduce((n, d) => n + d.n, 0), 4, "14 days hold every order sent in them, and real zeros");
assert.deepEqual(s.orders.suppliers, [{ name: "Customs", n: 2 }, { name: "Mukhtar", n: 2 }, { name: "Bakery", n: 1 }]);
assert.deepEqual(s.orders.last, { at: "2026-11-09T13:33:00Z", by: "yunis" });

assert.equal(s.receipts.today, 2);
assert.deepEqual(s.receipts.todayTotals, { IQD: 4000, USD: 12.5 }, "IQD and USD are never added together");
assert.equal(s.receipts.last7, 3);
assert.deepEqual(s.receipts.last7Totals, { IQD: 67000.5, USD: 12.5 });
assert.equal(s.receipts.active, 1, "drafts and cancelled receipts are not in progress");
assert.deepEqual(s.receipts.problems, [{ id: "r4", at: "2026-11-09T12:10:00Z", by: "rozha", problem: "Invoice not found", supplier: "Mukhtar store" }]);
assert.deepEqual(s.receipts.last, { at: "2026-11-09T12:27:00Z", by: "rozha", supplier: "Bread House" });

assert.equal(s.transfers.today, 0, "yesterday's transfer is not today's");
assert.equal(s.transfers.last7, 1);
assert.equal(s.transfers.active, 1);
assert.deepEqual(s.transfers.last, { at: "2026-11-08T15:15:00Z", by: "rozha", to: "Minibar" });

// Nothing in the window: zeros, and the newest one from before the window is still named.
const empty = O.summarize({ now, lastOrder: { sent_at: "2026-09-01T10:00:00Z", sent_by: "rozha" } });
assert.equal(empty.orders.last30, 0);
assert.deepEqual(empty.orders.suppliers, []);
assert.deepEqual(empty.orders.last, { at: "2026-09-01T10:00:00Z", by: "rozha" });
assert.equal(empty.receipts.last, null, "no receipt ever: no made-up date");
assert.deepEqual(empty.receipts.last7Totals, {});

console.log("overview smoke: ok");
