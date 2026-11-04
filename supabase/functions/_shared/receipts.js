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
  const wholePositive = (v) => Number.isSafeInteger(v) && v > 0;
  const qtyOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 99999 && Math.round(v * 1000) === v * 1000;
  const rateOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100000 && Math.round(v * 1000) === v * 1000;
  /* Money the way Ricotta Restaurant adds it up: each line qty × cost, then the delivery. */
  function totals(r) {
    const items = (r.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
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
      if (!wholePositive(l.cost)) errors.push({ code: 'cost', line: n });
      if (seen.has(l.item)) warnings.push({ code: 'duplicate', line: n, first: seen.get(l.item) });
      else seen.set(l.item, n);
      // A unit that counts as a single gram or millilitre on an item normally bought in bigger units.
      if (opt && opt.factor === 1 && opt.label !== item.base && unitOptions(item).some((o) => o.factor > 1)) warnings.push({ code: 'tinyUnit', line: n });
      const before = last && last[`${l.item}|${l.unit}|${r.currency}`];
      if (before && wholePositive(l.cost) && before > 0) {
        const pct = Math.round(((l.cost - before) / before) * 100);
        if (Math.abs(pct) >= lim.priceJump) warnings.push({ code: 'priceJump', line: n, before, pct });
      }
    });
    const t = totals(r);
    if (!errors.length && t.iqd >= lim.bigTotal) warnings.push({ code: 'bigTotal', iqd: t.iqd, limit: lim.bigTotal });
    return { errors, warnings, ...t };
  }
  globalThis.RicottaReceipts = Object.freeze({ unitOptions, totals, check, MAX_LINES });
})();
