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
// Learnt from Ricotta Restaurant's record: Quzi usually arrives as 47.5 kg (largest 53 kg).
{
  const qc = { ...cat, items: [...cat.items, { name: "Quzi", base: "غرام", units: [{ name: "کیلۆ", factor: 1000 }] }], history: { p: { Quzi: { n: 4, q: 47500, hi: 53000 } } } };
  const qr = (qty) => R.check({ ...base, lines: [{ item: "Quzi", unit: "کیلۆ (1000×)", qty, cost: 20000 }] }, qc, {}, {}).warnings.map((x) => x.code).filter((c) => c === "qtyHigh" || c === "qtyLow");
  assert.deepEqual(qr(47.5), []);
  assert.deepEqual(qr(475), ["qtyHigh"], "475 kg for 47.5 is asked about");
  assert.deepEqual(qr(4), ["qtyLow"], "4 kg when 47.5 usually arrives is asked about");
}
console.log("Receipt rules PASS: exact names (spaces, Kurdish letters), units, prices with up to 3 decimals, invoices with zeros, USD totals, delivery, warnings");

// A unit whose name says one size but counts another (Veal Kebab's "غرام" that counts 1000) is never the
// default and is questioned; a gram at 1,000 IQD or more is questioned; a price per gram far from last
// time in another unit is questioned. A correct kilo is not.
{
  const veal = { name: "Veal Kebab - کباب عجل", base: "غرام", units: [{ factor: 1000, name: "غرام" }, { factor: 1000, name: "کیلۆ" }] };
  const vc = { suppliers: ["S"], zones: ["Z"], items: [veal] };
  const vr = (unit, qty, cost) => ({ supplier: "S", invoice: "1", zone: "Z", currency: "IQD", lines: [{ item: veal.name, unit, qty, cost }] });
  assert.equal(R.defaultUnit(veal, []), "کیلۆ (1000×)");
  assert.equal(R.defaultUnit(veal, ["غرام (1000×)"]), "غرام (1000×)");
  const codes = (r, last) => R.check(r, vc, {}, last || {}).warnings.map((w) => w.code).sort();
  assert.deepEqual(codes(vr("غرام (1000×)", 4, 14000)), ["gramPrice", "unitNameOdd"]);
  assert.deepEqual(codes(vr("غرام", 4000, 14000), { "Veal Kebab - کباب عجل|کیلۆ (1000×)|IQD": 14000 }), ["bigTotal", "gramPrice", "unitPriceOdd"]);
  assert.deepEqual(codes(vr("کیلۆ (1000×)", 4, 14000), { "Veal Kebab - کباب عجل|کیلۆ (1000×)|IQD": 14000 }), []);
  assert.deepEqual(codes(vr("غرام", 500, 14)), []);
  console.log("Receipt unit checks PASS: odd unit names never default and are questioned, expensive grams and far-off prices per gram are questioned, a correct kilo is not");
}

// A line is rounded to the dinar like Ricotta Restaurant (10.4 x 1,057.692 is IQD 11,000 there).
assert.equal(R.lineTotal({ qty: 10.4, cost: 1057.692 }, "IQD"), 11000);
assert.equal(R.totals({ currency: "IQD", lines: [{ qty: 10.4, cost: 1057.692 }], delivery: 500 }).total, 11500);
console.log("Receipt totals PASS: each line rounded to the dinar like Ricotta Restaurant");


// Transfers: never more than the From storage has (lines of the same item together), the counting unit
// first, a unit name used twice with different sizes can't be used, all-of-it / unusual / yesterday are
// asked about, and the two Breakfast storages are never offered.
{
  await import("../supabase/functions/_shared/transfers.js");
  const T = globalThis.RicottaTransfers;
  const toast = { name: "White Toast - توست أبيض", base: "دانە", count: { name: "سیت", factor: 25 }, buy: { name: "کارتۆن", factor: 250 }, stock: { "Main Storage": 250, Minibar: 0 } };
  const veal = { name: "Veal Kebab", base: "غرام", count: { name: "کیلۆ", factor: 1000 }, buy: { name: "غرام", factor: 1000 }, stock: { "Main Storage": 5000 } };
  const cat = { zones: ["Main Storage", "Minibar", "Breakfast", "نانی بەیانی (Breakfast)"], titems: [toast, veal] };
  assert.deepEqual(T.zonesOf(cat), ["Main Storage", "Minibar"]);
  assert.deepEqual(T.unitOptions(toast).map((u) => u.name), ["سیت", "دانە", "کارتۆن"]);
  assert.ok(T.unitOptions(veal).find((u) => u.name === "غرام").unclear);
  // No counting unit (Mushroom): Ricotta Restaurant counts it in its buying unit, so that comes first.
  assert.deepEqual(T.unitOptions({ name: "Mushroom", base: "دانە", count: null, buy: { name: "کارتۆن", factor: 8 } }).map((u) => u.name), ["کارتۆن", "دانە"]);
  assert.deepEqual(T.unitOptions({ name: "Parsley", base: "دانە", count: null, buy: null }).map((u) => u.name), ["دانە"]);
  assert.deepEqual(T.inCounting(toast, 250), { qty: 10, unit: "سیت" });
  const tr = (lines, extra = {}) => ({ from: "Main Storage", to: "Minibar", lines, ...extra });
  const codes = (r, usual) => { const c = T.check(r, cat, usual || {}); return [...c.errors, ...c.warnings].map((x) => x.code).sort(); };
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 4 }])), []);
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 11 }])), ["notEnough"]);
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 6 }, { item: toast.name, unit: "دانە", qty: 101 }])), ["notEnough"], "the same item twice: no warning, the lines are added together");
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 10 }])), ["allStock"]);
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 4 }]), { [toast.name]: 25 }), ["unusual"]);
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 1 }], { yesterday: true })), ["yesterday"]);
  assert.deepEqual(codes(tr([{ item: veal.name, unit: "غرام", qty: 1 }])), ["unitUnclear"]);
  assert.deepEqual(codes({ from: "Main Storage", to: "Main Storage", lines: [{ item: toast.name, unit: "سیت", qty: 1 }] }), ["sameZone"]);
  assert.deepEqual(codes(tr([{ item: toast.name, unit: "سیت", qty: 1 }], { to: "Breakfast" })), ["toUnknown"]);
  assert.deepEqual(T.itemsIn(cat, "Minibar"), []);
  // Learnt from Ricotta Restaurant's record. Each storage has its own demand: Al Sharqiyah takes about
  // 10 kg of tomato, Pizza about 2 kg; Coca-Cola only ever goes to Minibar.
  {
    const tomato = { name: "Tomato", base: "غرام", count: { name: "کیلۆ", factor: 1000 }, buy: null, stock: { "Main Storage": 200000 } };
    const cola = { name: "Coca-Cola", base: "دانە", count: { name: "دانە", factor: 1 }, buy: null, stock: { "Main Storage": 500 } };
    const hc = { zones: ["Main Storage", "Al Sharqiyah", "Pizza", "Minibar", "Kebab"], titems: [tomato, cola], history: { t: {
      Tomato: { n: 40, q: 4000, hi: 14000, r: { "Main Storage>Al Sharqiyah": { n: 20, q: 10000, hi: 14000 }, "Main Storage>Pizza": { n: 10, q: 2000, hi: 3000 } } },
      "Coca-Cola": { n: 12, q: 48, hi: 96, r: { "Main Storage>Minibar": { n: 12, q: 48, hi: 96 } } },
    } } };
    const w = (item, unit, qty, to) => T.check({ from: "Main Storage", to, lines: [{ item, unit, qty }] }, hc, {}).warnings;
    const codes = (...a) => w(...a).map((x) => x.code);
    assert.deepEqual(codes("Tomato", "کیلۆ", 10, "Al Sharqiyah"), [], "10 kg to Al Sharqiyah is its normal day");
    assert.deepEqual(codes("Tomato", "کیلۆ", 2, "Pizza"), [], "2 kg to Pizza is its normal day");
    assert.deepEqual(codes("Tomato", "کیلۆ", 1.5, "Al Sharqiyah"), [], "a small day is not a typo");
    assert.deepEqual(codes("Tomato", "کیلۆ", 0.5, "Al Sharqiyah"), ["unusualLow"], "0.5 kg to Al Sharqiyah (usually 10 kg) is asked about");
    assert.equal(w("Tomato", "کیلۆ", 0.5, "Al Sharqiyah")[0].zone, "Al Sharqiyah", "and names the storage");
    assert.deepEqual(codes("Tomato", "کیلۆ", 10, "Pizza"), ["unusual"], "10 kg to Pizza (usually 2 kg) is asked about");
    assert.deepEqual(codes("Tomato", "کیلۆ", 135, "Al Sharqiyah"), ["unusual"], "135 for 13.5 is asked about");
    const c = w("Coca-Cola", "دانە", 24, "Pizza");
    assert.deepEqual(c.map((x) => x.code), ["newRoute"], "Coca-Cola to Pizza is asked about");
    assert.deepEqual(c[0].usualTo, ["Minibar"], "with where it usually goes");
    assert.deepEqual(codes("Coca-Cola", "دانە", 24, "Minibar"), [], "Coca-Cola to Minibar is normal");
    assert.equal(T.usualFor(hc, "Tomato", "Main Storage", "Pizza").stat.q, 2000);
    assert.equal(T.usualFor(hc, "Coca-Cola", "Main Storage", "Pizza").never, true);
    // Her two real cases: Pomegranate to Minibar (never goes there) says only that, no "usually 2.7 kg";
    // 15 kg of green pepper to Pizza (Pizza usually gets about 1 kg) is asked about.
    const pom = { name: "Pomegranate", base: "غرام", count: { name: "کیلۆ", factor: 1000 }, buy: null, stock: { "Main Storage": 50000 } };
    const gp = { name: "Green Pepper", base: "غرام", count: { name: "کیلۆ", factor: 1000 }, buy: null, stock: { "Main Storage": 50000 } };
    const real = { zones: ["Main Storage", "Minibar", "Pizza", "Appetizers"], titems: [pom, gp], history: { t: {
      Pomegranate: { n: 40, q: 2700, hi: 6000, r: { "Main Storage>Appetizers": { n: 30, q: 3000, hi: 6000 }, "Main Storage>Breakfast": { n: 2, q: 1000, hi: 1000 } } },
      "Green Pepper": { n: 75, q: 1000, hi: 10500, r: { "Main Storage>Pizza": { n: 12, q: 1000, hi: 2000 }, "Main Storage>Al Sharqiyah": { n: 31, q: 4000, hi: 10500 } } },
    } } };
    const pw = T.check({ from: "Main Storage", to: "Minibar", lines: [{ item: "Pomegranate", unit: "کیلۆ", qty: 8.5 }] }, real, {}).warnings;
    assert.deepEqual(pw.map((x) => x.code), ["newRoute"], "never goes there: only that question");
    assert.deepEqual(pw[0].usualTo, ["Appetizers"], "Breakfast is never suggested");
    const gw = T.check({ from: "Main Storage", to: "Pizza", lines: [{ item: "Green Pepper", unit: "کیلۆ", qty: 15 }] }, real, {}).warnings;
    assert.deepEqual(gw.map((x) => x.code), ["unusual"], "15 kg to Pizza is asked about");
    assert.equal(gw[0].zone, "Pizza");
  }
  console.log("Transfer rules PASS: stock never exceeded (same item added up), counting unit first, unclear units refused, all-of-it / unusual / yesterday asked, no Breakfast storages");
}
