// The receipt rules shared by the app, the API and Rico on the Mac (supabase/functions/_shared/receipts.js).
import assert from "node:assert/strict";
import "../supabase/functions/_shared/receipts.js";
const R = globalThis.RicottaReceipts;

const cat = {
  suppliers: ["Jabal Amman", "Coffee Supply", "شوینی لقمان بۆ کەلەشیر و قاز و قەل"],
  zones: ["Main Storage", "Kebab"],
  items: [
    { name: "Frozen Peas - بزالیا سادە", base: "غرام", units: [{ name: "دانە", factor: 400 }, { name: "کارتۆن", factor: 8000 }, { name: "دانە", factor: 400 }] },
    { name: "Los Amigos Cheddar Cheese  - جبن شیدار سائل", base: "غرام", units: [{ name: "دانە", factor: 3000 }] },
    { name: "Yogurt - ماستی ماستاو", base: "غرام", units: [{ name: "جام", factor: 2000 }, { name: "ستل", factor: 1 }] },
    { name: "Roasted Coffee", base: "غرام", units: [{ name: "کیلۆ", factor: 1000 }] },
  ],
};
const base = { supplier: "Jabal Amman", invoice: "00545", zone: "Main Storage", currency: "IQD", rate: null, delivery: 5000,
  lines: [{ item: "Frozen Peas - بزالیا سادە", unit: "دانە (400×)", qty: 4, cost: 2000 }] };

// Units: the base unit first, each bigger unit once, labelled the way Ricotta Restaurant writes them.
assert.deepEqual(R.unitOptions(cat.items[0]).map((u) => u.label), ["غرام", "دانە (400×)", "کارتۆن (8000×)"]);

// A good receipt: totals the way Ricotta Restaurant adds them up; the invoice keeps its zeros.
let c = R.check(base, cat, {}, {});
assert.deepEqual(c.errors, []);
assert.equal(c.items, 8000); assert.equal(c.total, 13000); assert.equal(c.iqd, 13000);

// Names must match exactly: one space less in "Los Amigos Cheddar Cheese  -" is a different item.
c = R.check({ ...base, lines: [{ item: "Los Amigos Cheddar Cheese - جبن شیدار سائل", unit: "دانە (3000×)", qty: 1, cost: 1000 }] }, cat, {}, {});
assert.ok(c.errors.some((e) => e.code === "itemUnknown" && e.line === 1));
c = R.check({ ...base, supplier: "Jabal  Amman" }, cat, {}, {});
assert.ok(c.errors.some((e) => e.code === "supplierUnknown"));

// Numbers: whole prices, quantities with up to 3 decimals, an invoice of digits only, a unit of that item.
// A unit cost may have a dot (up to 3 decimals); more than that, zero or less is refused.
assert.deepEqual(R.check({ ...base, lines: [{ ...base.lines[0], cost: 1250.5 }] }, cat, {}, {}).errors, []);
assert.equal(R.totals({ ...base, delivery: null, lines: [{ ...base.lines[0], cost: 1250.5 }] }).total, 5002);
for (const [bad, code] of [[{ cost: 2000.5555 }, "cost"], [{ cost: 0 }, "cost"], [{ qty: 0 }, "qty"], [{ qty: 1.2345 }, "qty"], [{ unit: "کیلۆ (1000×)" }, "unitUnknown"]])
  assert.ok(R.check({ ...base, lines: [{ ...base.lines[0], ...bad }] }, cat, {}, {}).errors.some((e) => e.code === code), code);
assert.ok(R.check({ ...base, invoice: "12a" }, cat, {}, {}).errors.some((e) => e.code === "invoice"));
assert.ok(R.check({ ...base, zone: "Breakfast" }, cat, {}, {}).errors.some((e) => e.code === "zone"));
assert.ok(R.check({ ...base, lines: [] }, cat, {}, {}).errors.some((e) => e.code === "noLines"));
assert.equal(R.check({ ...base, lines: [{ ...base.lines[0], qty: 2.5 }] }, cat, {}, {}).errors.length, 0);

// USD: whole dollars, a rate (decimals allowed), no delivery; the IQD total uses the rate.
const usd = { ...base, supplier: "Coffee Supply", currency: "USD", rate: 1678.571, delivery: null, lines: [{ item: "Roasted Coffee", unit: "کیلۆ (1000×)", qty: 6, cost: 21 }] };
c = R.check(usd, cat, {}, {});
assert.deepEqual(c.errors, []); assert.equal(c.total, 126); assert.equal(c.iqd, 211500);
assert.ok(R.check({ ...usd, delivery: 5000 }, cat, {}, {}).errors.some((e) => e.code === "deliveryUsd"));
assert.ok(R.check({ ...usd, rate: 1400 }, cat, {}, {}).warnings.some((w) => w.code === "rateOdd"));

// Warnings (sent only after someone confirms them): same item twice, a price jump, a tiny unit, a big total.
c = R.check({ ...base, lines: [base.lines[0], { ...base.lines[0], cost: 2600 }] }, cat, {}, { "Frozen Peas - بزالیا سادە|دانە (400×)|IQD": 2000 });
assert.ok(c.warnings.some((w) => w.code === "duplicate" && w.line === 2 && w.first === 1));
assert.ok(c.warnings.some((w) => w.code === "priceJump" && w.line === 2 && w.pct === 30));
assert.ok(!c.warnings.some((w) => w.code === "priceJump" && w.line === 1));
c = R.check({ ...base, lines: [{ item: "Yogurt - ماستی ماستاو", unit: "ستل (1×)", qty: 2, cost: 9000 }] }, cat, {}, {});
assert.ok(c.warnings.some((w) => w.code === "tinyUnit"));
c = R.check({ ...base, lines: [{ ...base.lines[0], qty: 500 }] }, cat, { bigTotal: 1000000 }, {});
assert.ok(c.warnings.some((w) => w.code === "bigTotal" && w.iqd === 1005000));
console.log("Receipt rules PASS: exact names (spaces, Kurdish letters), units, prices with up to 3 decimals, invoices with zeros, USD totals, delivery, warnings");
