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
  /* Rounded down to 3 decimals: a stock amount shown this way can always be typed back and moved. */
  const floor3 = (n) => Math.floor(n * 1000 + 1e-6) / 1000;
  /* How much of an item is in a storage, in its base unit. */
  const available = (item, zone) => Math.max(0, Number(item && item.stock && item.stock[zone]) || 0);
  /* An amount in base units shown in the counting unit ("3.2 کیلۆ"). */
  function inCounting(item, base, down) {
    const c = unitOptions(item)[0], r = down ? floor3 : round3;
    return c ? { qty: r(base / c.factor), unit: c.name } : { qty: r(base), unit: (item && item.base) || '' };
  }
  /* At most 3 decimals: 65.4 * 1000 is 65400.00000000001 in floating point, so it is compared as written. */
  const qtyOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 999999 && Number(v.toFixed(3)) === v;
  /* The storages a transfer can use: Ricotta Restaurant's, without the two Breakfast ones. */
  /* One route's numbers ("Main Storage>Pizza"): {n, q, hi}; an older plain count is {n} only. */
  const routeCount = (v) => (v && typeof v === 'object' ? Number(v.n) || 0 : Number(v) || 0);
  const routeStat = (h, from, to) => { const v = h && h.r && h.r[from + '>' + to]; return v == null ? null : typeof v === 'object' ? v : { n: Number(v) || 0, q: 0, hi: 0 }; };
  /* What this storage usually gets of this item (base units), when it has had it often enough. */
  const usualFor = (cat, item, from, to) => { const h = cat && cat.history && cat.history.t && cat.history.t[item]; const rs = routeStat(h, from, to); return { stat: rs && rs.n >= 3 && rs.q > 0 ? rs : null, never: !!(h && h.n >= 3 && h.r && !(rs && rs.n > 0)) }; };
  const zonesOf = (cat) => ((cat && cat.zones) || []).filter((z) => !BREAKFAST.test(z));
  /* The items that can be moved out of a storage: the ones with stock there. */
  const itemsIn = (cat, zone) => ((cat && cat.titems) || []).filter((i) => available(i, zone) > 0);
  /* Everything wrong with a transfer (errors: it can't be sent) and everything to confirm first
     (warnings). `usual`: the usual amount moved per item, in base units, from earlier transfers. */
  function check(t, cat, usual) {
    const errors = [], warnings = [];
    const zones = zonesOf(cat);
    // Two items with one name: the first one, as the form picks it (a Map keeps the last).
    const items = new Map();
    for (const i of (cat && cat.titems) || []) if (!items.has(i.name)) items.set(i.name, i);
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
      if (!qtyOk(l.qty)) { errors.push({ code: typeof l.qty === 'number' && l.qty > 99999 ? 'qtyTooBig' : 'qty', line: n }); return; }
      const base = round3(l.qty * opt.factor);
      totalByItem.set(l.item, (totalByItem.get(l.item) || 0) + l.qty * opt.factor);
      // The same item on two lines is normal (someone came back for more): no warning, the
      // lines are added together for the stock check below.
      if (!seen.has(l.item)) seen.set(l.item, n);
      // The usual amount: from Ricotta Restaurant's own record of the last weeks (Rico reads it once a
      // day) when there are enough moves of this item, otherwise from the transfers made here.
      // Asked only when it is both 3 times the usual and more than anything moved in those weeks, so a
      // big but normal day doesn't ask (tested on a real 24-item transfer: no questions).
      // Each storage has its own demand (Al Sharqiyah takes 10 kg of tomato a day, Pizza 2 kg every
      // other day): compared with what this storage usually gets when it is known, otherwise the item.
      const h = hist[l.item], rs = routeStat(h, t.from, t.to);
      // Never sent to this storage: that is the only question (with where it usually goes); no amount
      // is compared, as there is no usual for this storage (Pomegranate to Minibar).
      if (h && h.n >= 3 && t.from && t.to && h.r && !(rs && rs.n > 0)) {
        if (!routeAsked.has(l.item)) {
          routeAsked.add(l.item);
          const usualTo = Object.entries(h.r).filter(([k, v]) => k.indexOf(t.from + '>') === 0 && routeCount(v) > 0 && !BREAKFAST.test(k)).sort((a, b) => routeCount(b[1]) - routeCount(a[1])).slice(0, 3).map(([k]) => k.slice(t.from.length + 1));
          warnings.push({ code: 'newRoute', line: n, from: t.from, to: t.to, usualTo });
        }
      } else {
        // Each storage has its own demand: compared with what this storage usually gets. Only when
        // nothing is known per storage is the item's overall usual used (and from these transfers).
        const ref = rs && rs.n >= 3 && rs.q > 0 ? rs : !rs && h && h.n >= 3 && !(h.r && Object.keys(h.r).length) ? h : null;
        const u = ref ? ref.q : !h ? usual && usual[l.item] : 0;
        const zone = ref && ref === rs ? t.to : null;
        if (u > 0 && base > u * 3 && (!ref || base > (ref.hi || u) * 1.2)) warnings.push({ code: 'unusual', line: n, times: Math.round((base / u) * 10) / 10, usual: inCounting(item, u), zone });
        else if (ref === rs && rs && rs.n >= 5 && base * 10 < rs.q) warnings.push({ code: 'unusualLow', line: n, usual: inCounting(item, rs.q), zone: t.to });
      }
    });
    // Never more than the storage has (all lines of the same item together): Ricotta Restaurant would
    // move the rest and leave this one behind.
    for (const [name, sum] of totalByItem) {
      const base = round3(sum), item = items.get(name), have = available(item, t.from), line = lines.findIndex((l) => l.item === name) + 1;
      if (t.from && base > have + 1e-9) errors.push({ code: 'notEnough', line, have: inCounting(item, have, true), need: inCounting(item, base) });
      else if (t.from && have > 0 && base >= have - 1e-9) warnings.push({ code: 'allStock', line, have: inCounting(item, have, true) });
    }
    if (t.yesterday) warnings.push({ code: 'yesterday' });
    return { errors, warnings, count: lines.filter((l) => l && l.item).length };
  }
  globalThis.RicottaTransfers = Object.freeze({ unitOptions, available, inCounting, zonesOf, itemsIn, check, usualFor, MAX_LINES });
})();
