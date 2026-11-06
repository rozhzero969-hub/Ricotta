/* Transfers between storages in Ricotta Restaurant: one set of rules for the app, the API, the
   Telegram bot and Rico on the Mac. Items, units and storages are named exactly as Ricotta Restaurant
   writes them. Stock is kept there per storage in the item's base unit (grams, pieces...); an item
   is counted in its "counting" unit (کیلۆ, سیت...), which is what "available" shows. */
(function () {
  const MAX_LINES = 120;
  const BREAKFAST = /breakfast|بەیانی/i;
  /* The units a transfer of this item can be in: the counting unit first (the default), then the base
     unit, then the buying unit. Each name once; a name given twice with different sizes can't be told
     apart on Ricotta Restaurant's page, so it is marked unclear and can't be used. */
  function unitOptions(item) {
    const out = [];
    const add = (name, factor) => {
      const f = Number(factor);
      if (!name || !(f > 0)) return;
      const same = out.find((o) => o.name === name);
      if (!same) out.push({ name, factor: f });
      else if (same.factor !== f) same.unclear = true;
    };
    // Ricotta Restaurant counts in the item's counting unit; an item without one (Mushroom) it
    // counts in its buying unit (کارتۆن), so that comes first, as on their page.
    if (item && item.count && item.count.name) { add(item.count.name, item.count.factor); add(item.base, 1); add(item.buy && item.buy.name, item.buy && item.buy.factor); }
    else if (item) { add(item.buy && item.buy.name, item.buy && item.buy.factor); add(item.base, 1); }
    return out;
  }
  const round3 = (n) => Math.round(n * 1000) / 1000;
  /* How much of an item is in a storage, in its base unit. */
  const available = (item, zone) => Math.max(0, Number(item && item.stock && item.stock[zone]) || 0);
  /* An amount in base units shown in the counting unit ("3.2 کیلۆ"). */
  function inCounting(item, base) {
    const c = unitOptions(item)[0];
    return c ? { qty: round3(base / c.factor), unit: c.name } : { qty: round3(base), unit: (item && item.base) || '' };
  }
  const qtyOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 999999 && Math.round(v * 1000) === v * 1000;
  /* The storages a transfer can use: Ricotta Restaurant's, without the two Breakfast ones. */
  const zonesOf = (cat) => ((cat && cat.zones) || []).filter((z) => !BREAKFAST.test(z));
  /* The items that can be moved out of a storage: the ones with stock there. */
  const itemsIn = (cat, zone) => ((cat && cat.titems) || []).filter((i) => available(i, zone) > 0);
  /* Everything wrong with a transfer (errors: it can't be sent) and everything to confirm first
     (warnings). `usual`: the usual amount moved per item, in base units, from earlier transfers. */
  function check(t, cat, usual) {
    const errors = [], warnings = [];
    const zones = zonesOf(cat);
    const items = new Map(((cat && cat.titems) || []).map((i) => [i.name, i]));
    if (!t.from) errors.push({ code: 'from' });
    else if (!zones.includes(t.from)) errors.push({ code: 'fromUnknown' });
    if (!t.to) errors.push({ code: 'to' });
    else if (!zones.includes(t.to)) errors.push({ code: 'toUnknown' });
    if (t.from && t.to && t.from === t.to) errors.push({ code: 'sameZone' });
    const lines = Array.isArray(t.lines) ? t.lines : [];
    if (!lines.length) errors.push({ code: 'noLines' });
    if (lines.length > MAX_LINES) errors.push({ code: 'tooManyLines' });
    const seen = new Map(), totalByItem = new Map(), routeAsked = new Set();
    const hist = (cat && cat.history && cat.history.t) || {};
    lines.forEach((l, i) => {
      const n = i + 1, item = items.get(l && l.item);
      if (!item) { errors.push({ code: 'itemUnknown', line: n }); return; }
      const opt = unitOptions(item).find((o) => o.name === l.unit);
      if (!opt) { errors.push({ code: 'unitUnknown', line: n }); return; }
      if (opt.unclear) errors.push({ code: 'unitUnclear', line: n, unit: opt.name });
      if (!qtyOk(l.qty)) { errors.push({ code: 'qty', line: n }); return; }
      const base = round3(l.qty * opt.factor);
      totalByItem.set(l.item, round3((totalByItem.get(l.item) || 0) + base));
      // The same item on two lines is normal (someone came back for more): no warning, the
      // lines are added together for the stock check below.
      if (!seen.has(l.item)) seen.set(l.item, n);
      // The usual amount: from Ricotta Restaurant's own record of the last weeks (Rico reads it once a
      // day) when there are enough moves of this item, otherwise from the transfers made here.
      // Asked only when it is both 3 times the usual and more than anything moved in those weeks, so a
      // big but normal day doesn't ask (tested on a real 24-item transfer: no questions).
      const h = hist[l.item], u = h && h.n >= 3 ? h.q : usual && usual[l.item];
      if (u > 0 && base > u * 3 && (!h || h.n < 3 || base > (h.hi || u) * 1.2)) warnings.push({ code: 'unusual', line: n, times: Math.round((base / u) * 10) / 10, usual: inCounting(item, u) });
      else if (h && h.n >= 5 && u > 0 && base * 10 < u) warnings.push({ code: 'unusualLow', line: n, usual: inCounting(item, u) });
      // Moved often, but never from this storage to that one: perhaps the wrong storage.
      if (h && h.n >= 5 && t.from && t.to && h.r && !h.r[t.from + '>' + t.to] && !routeAsked.has(l.item)) { routeAsked.add(l.item); warnings.push({ code: 'newRoute', line: n, from: t.from, to: t.to }); }
    });
    // Never more than the storage has (all lines of the same item together): Ricotta Restaurant would
    // move the rest and leave this one behind.
    for (const [name, base] of totalByItem) {
      const item = items.get(name), have = available(item, t.from), line = lines.findIndex((l) => l.item === name) + 1;
      if (t.from && base > have + 1e-9) errors.push({ code: 'notEnough', line, have: inCounting(item, have), need: inCounting(item, base) });
      else if (t.from && have > 0 && base >= have - 1e-9) warnings.push({ code: 'allStock', line, have: inCounting(item, have) });
    }
    if (t.yesterday) warnings.push({ code: 'yesterday' });
    return { errors, warnings, count: lines.filter((l) => l && l.item).length };
  }
  globalThis.RicottaTransfers = Object.freeze({ unitOptions, available, inCounting, zonesOf, itemsIn, check, MAX_LINES });
})();
