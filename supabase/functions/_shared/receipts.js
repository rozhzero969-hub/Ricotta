/* Receipts for Ricotta Restaurant: one set of rules for the app, the API and Rico on the Mac, so a
   receipt is checked the same way everywhere. Names are compared exactly as Ricotta Restaurant writes
   them (its Kurdish and Arabic letters, double spaces and digits included); search uses RicottaSearch. */
(function () {
  const MAX_LINES = 120;
  /* What Ricotta Restaurant's unit list shows for an item: its base unit as is, then each bigger unit
     as "name (factor×)". The same unit given twice with the same size is shown once. */
  function unitOptions(item) {
    const out = [], seen = new Set();
    const add = (label, factor) => { if (!seen.has(label)) { seen.add(label); out.push({ label, factor }); } };
    if (item && item.base) add(item.base, 1);
    for (const u of (item && item.units) || []) {
      const f = Number(u.factor);
      if (!u.name || !Number.isFinite(f) || f <= 0) continue;
      add(u.label || `${u.name} (${trimNumber(f)}×)`, f);
    }
    return out;
  }
  function trimNumber(n) { return String(Math.round(n * 1000) / 1000); }
  /* Unit names that say their own size: a gram (or millilitre) is 1, a kilo (or litre) is 1000 of the
     base. A unit whose name says one size and counts another (a "gram" that counts 1000 grams) is wrong
     in Ricotta Restaurant's list and is never chosen by itself; a receipt using it is questioned. */
  const GRAM = /^(غرام|گرام|گرم|غم|gram|grams|gr|g|مل|ملی|میلی|مللی|ml)$/i;
  const KILO = /^(کیلۆ|کیلو|كيلو|كيلۆ|kg|kilo|kilogram|لیتر|لتر|litre|liter|l)$/i;
  const unitWord = (label) => { const m = String(label || '').match(/^(.*?)\s*\(\s*[\d.,]+\s*×\s*\)\s*$/); return (m ? m[1] : String(label || '')).replace(/[\u200e\u200f]/g, '').trim(); };
  function impliedFactor(item, opt) {
    const w = unitWord(opt.label), base = unitWord(item && item.base);
    if (GRAM.test(w)) return 1;
    if (KILO.test(w) && GRAM.test(base)) return 1000;
    return null;
  }
  const unitIsOdd = (item, opt) => { const f = impliedFactor(item, opt); return f != null && f !== opt.factor; };
  /* The unit picked for an item when nothing else says: the one bought last time, else the biggest one
     whose name agrees with its size. */
  function defaultUnit(item, lastLabels) {
    const opts = unitOptions(item);
    const last = (lastLabels || []).find((l) => opts.some((o) => o.label === l));
    if (last) return last;
    const good = opts.filter((o) => !unitIsOdd(item, o));
    const pool = good.length ? good : opts;
    return pool.length ? pool.reduce((a, b) => (b.factor > a.factor ? b : a)).label : '';
  }
  const wholePositive = (v) => Number.isSafeInteger(v) && v > 0;
  const qtyOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 99999 && Math.round(v * 1000) === v * 1000;
  // A unit cost may have a dot (up to 3 decimals), in dinars or dollars.
  const costOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e10 && Math.round(v * 1000) === v * 1000;
  const rateOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100000 && Math.round(v * 1000) === v * 1000;
  /* Money the way Ricotta Restaurant adds it up: each line qty × cost, rounded to the dinar (10.4 ×
     1,057.692 is IQD 11,000 there, not 10,999.997), then the delivery. Dollars keep their cents. */
  function lineTotal(l, currency) {
    const v = (Number(l && l.qty) || 0) * (Number(l && l.cost) || 0);
    return currency === 'USD' ? Math.round(v * 1000) / 1000 : Math.round(v);
  }
  function totals(r) {
    const items = (r.lines || []).reduce((s, l) => s + lineTotal(l, r.currency), 0);
    const itemsRounded = Math.round(items * 1000) / 1000;
    if (r.currency === 'USD') return { items: itemsRounded, delivery: 0, total: itemsRounded, iqd: Math.round(itemsRounded * (Number(r.rate) || 0)) };
    const delivery = Number(r.delivery) || 0;
    return { items: itemsRounded, delivery, total: itemsRounded + delivery, iqd: itemsRounded + delivery };
  }
  /* Everything wrong with a receipt (errors: it cannot be sent) and everything unusual about it
     (warnings: it can be sent once someone has looked). `catalog` is what Rico read from Ricotta
     Restaurant; `limits` the Settings limits; `last` the last price per "item|unit|currency". */
  function check(r, catalog, limits, last) {
    const errors = [], warnings = [];
    const lim = Object.assign({ bigTotal: 1000000, priceJump: 30, rateMin: 1500, rateMax: 1800 }, limits || {});
    const cat = catalog || {};
    const items = new Map((cat.items || []).map((i) => [i.name, i]));
    if (!r.supplier) errors.push({ code: 'supplier' });
    else if (!(cat.suppliers || []).includes(r.supplier)) errors.push({ code: 'supplierUnknown' });
    if (!/^[0-9]{1,30}$/.test(String(r.invoice || ''))) errors.push({ code: 'invoice' });
    if (!(cat.zones || []).includes(r.zone)) errors.push({ code: 'zone' });
    if (r.currency !== 'IQD' && r.currency !== 'USD') errors.push({ code: 'currency' });
    if (r.currency === 'USD') {
      if (!rateOk(r.rate)) errors.push({ code: 'rate' });
      else if (r.rate < lim.rateMin || r.rate > lim.rateMax) warnings.push({ code: 'rateOdd', rate: r.rate, min: lim.rateMin, max: lim.rateMax });
      if (r.delivery) errors.push({ code: 'deliveryUsd' });
    } else if (r.delivery != null && !(Number.isSafeInteger(r.delivery) && r.delivery >= 0)) errors.push({ code: 'delivery' });
    const lines = Array.isArray(r.lines) ? r.lines : [];
    if (!lines.length) errors.push({ code: 'noLines' });
    if (lines.length > MAX_LINES) errors.push({ code: 'tooManyLines' });
    const seen = new Map();
    lines.forEach((l, i) => {
      const n = i + 1, item = items.get(l && l.item);
      if (!item) { errors.push({ code: 'itemUnknown', line: n }); return; }
      const opt = unitOptions(item).find((o) => o.label === l.unit);
      if (!opt) errors.push({ code: 'unitUnknown', line: n });
      if (!qtyOk(l.qty)) errors.push({ code: 'qty', line: n });
      if (!costOk(l.cost)) errors.push({ code: 'cost', line: n });
      if (seen.has(l.item)) warnings.push({ code: 'duplicate', line: n, first: seen.get(l.item) });
      else seen.set(l.item, n);
      // A unit that counts as a single gram or millilitre on an item normally bought in bigger units.
      if (opt && opt.factor === 1 && opt.label !== item.base && unitOptions(item).some((o) => o.factor > 1)) warnings.push({ code: 'tinyUnit', line: n });
      if (opt && unitIsOdd(item, opt)) warnings.push({ code: 'unitNameOdd', line: n, unit: unitWord(opt.label), factor: opt.factor, base: unitWord(item.base) });
      // A gram (or millilitre) costing 1,000 IQD or $1 or more is almost surely the wrong unit or price.
      if (opt && GRAM.test(unitWord(opt.label)) && costOk(l.cost) && l.cost >= (r.currency === 'USD' ? 1 : 1000)) warnings.push({ code: 'gramPrice', line: n, cost: l.cost, unit: unitWord(opt.label), currency: r.currency });
      // The price per gram (or piece) far from what was paid last time in another unit: a wrong unit.
      if (opt && costOk(l.cost) && last) {
        for (const o of unitOptions(item)) {
          if (o.label === l.unit) continue;
          const was = last[`${l.item}|${o.label}|${r.currency}`];
          if (!(was > 0)) continue;
          const now = l.cost / opt.factor, then = was / o.factor, ratio = now / then;
          if (ratio > 3 || ratio < 1 / 3) warnings.push({ code: 'unitPriceOdd', line: n, now, then, base: unitWord(item.base), times: Math.round((ratio > 1 ? ratio : 1 / ratio) * 10) / 10, more: ratio > 1 });
          break;
        }
      }
      // An amount far from what usually arrives of this item (Ricotta Restaurant's record of the last
      // weeks): 135 for 13.5, or kilos typed as grams.
      const h = cat.history && cat.history.p && cat.history.p[l.item];
      if (opt && qtyOk(l.qty) && h && h.n >= 3 && h.q > 0) {
        const base = l.qty * opt.factor, usualQty = Math.round((h.q / opt.factor) * 1000) / 1000, unit = unitWord(opt.label);
        if (base > h.q * 4 && base > (h.hi || h.q) * 2) warnings.push({ code: 'qtyHigh', line: n, usual: usualQty, unit, times: Math.round((base / h.q) * 10) / 10 });
        else if (base * 10 < h.q) warnings.push({ code: 'qtyLow', line: n, usual: usualQty, unit });
      }
      const before = last && last[`${l.item}|${l.unit}|${r.currency}`];
      if (before && costOk(l.cost) && before > 0) {
        const pct = Math.round(((l.cost - before) / before) * 100);
        if (Math.abs(pct) >= lim.priceJump) warnings.push({ code: 'priceJump', line: n, before, pct });
      }
    });
    const t = totals(r);
    if (!errors.length && t.iqd >= lim.bigTotal) warnings.push({ code: 'bigTotal', iqd: t.iqd, limit: lim.bigTotal });
    return { errors, warnings, ...t };
  }
  globalThis.RicottaReceipts = Object.freeze({ unitOptions, totals, lineTotal, check, unitIsOdd, defaultUnit, unitWord, MAX_LINES });
})();
