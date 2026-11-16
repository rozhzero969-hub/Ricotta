/* What a recipe costs: one set of rules for the API (which works the costs out for the Recipes tab and
   the alerts) and the app (which shows them, and works out a recipe being typed the same way).
   Ahmad writes how much of each ingredient a recipe uses (grams, millilitres, pieces, or any unit from
   Manage, Units). Each ingredient is linked to a stock item in Ricotta Restaurant; its price is the LAST
   price paid for that stock item on an invoice there (the newest receipt wins), turned into the stock
   item's base unit: bought per carton of 24 at 48 is 2 per piece, 10 per 1000 ml is 0.01 per ml. Then
   500 ml of it costs 5. Recipes are in IQD only: a price paid in USD is never used (the last IQD price
   is, and an item bought only in USD has no cost). A line without an amount, a price, or a unit that
   can be turned into the stock item's unit has no cost: it is "missing", never 0.
   Needs RicottaSearch (search.js) and RicottaTransfers (transfers.js) loaded first. */
(function () {
  const S = () => globalThis.RicottaSearch;
  const T = () => globalThis.RicottaTransfers;
  const MAIN = 'Main Storage';
  /* Under this margin (profit as a share of the menu price) a recipe is "low margin". */
  const MARGIN_MIN = 60;
  /* The suggested price is this many times the cost of making it (a suggestion only). */
  const SUGGEST_TIMES = 3;
  const CURRENCIES = ['IQD'];

  /* The sizes recipes are measured in: grams, millilitres and pieces, each with its bigger size
     (1 kg is 1000 g, 1 L is 1000 ml). {kind, f}: f is how many of the kind one of it is. */
  const MEASURES = [['g', 'g', 1], ['kg', 'g', 1000], ['ml', 'ml', 1], ['l', 'ml', 1000], ['piece', 'piece', 1]];
  function measure(name) {
    const n = String(name ?? '').trim();
    if (!n) return null;
    for (const [w, kind, f] of MEASURES) if (S().unit([w], n)) return { kind, f };
    return null;
  }
  /* The stock item's own units with how many base units each is (the base unit itself is 1). */
  function options(titem) {
    if (!titem) return [];
    const out = T().unitOptions(titem).map((o) => ({ ...o }));
    if (titem.base && !out.some((o) => o.name === titem.base)) out.push({ name: titem.base, factor: 1 });
    return out;
  }
  /* How many of the stock item's base unit one of this unit is, or null when it can't be told: the
     stock item's own unit of that name first (its carton, its piece), then a size of the same kind
     (grams for kilos, millilitres for litres). */
  function factor(titem, unitName) {
    const opts = options(titem), name = String(unitName ?? '').trim();
    if (!opts.length || !name) return null;
    const mine = S().unit(opts.map((o) => o.name), name);
    const exact = opts.find((o) => o.name === name) || (mine && opts.find((o) => o.name === mine));
    if (exact && !exact.unclear) return exact.factor;
    const m = measure(name);
    if (!m) return null;
    for (const o of opts) { const k = measure(o.name); if (k && k.kind === m.kind && !o.unclear) return (m.f / k.f) * o.factor; }
    return null;
  }

  /* The newest invoice line of each stock item, from invoices {entry_date, read_at, invoice_number,
     supplier_name, currency, lines:[{item, unit, unit_cost}]}: the latest receipt date wins (then the
     one read last, then the higher invoice number). Lines without a price are skipped. The newest IQD
     price wins over a newer USD one; an item bought only in USD keeps its USD line (shown as missing). */
  function lastPrices(invoices, want) {
    const keep = want ? new Set(want) : null;
    const sorted = [...(invoices || [])].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date))
      || String(b.read_at ?? '').localeCompare(String(a.read_at ?? ''))
      || String(b.invoice_number ?? '').localeCompare(String(a.invoice_number ?? ''), undefined, { numeric: true }));
    const by = new Map(), usd = new Map();
    for (const r of sorted) for (const l of (r && r.lines) || []) {
      if (!l || !l.item || by.has(l.item) || (keep && !keep.has(l.item)) || !(Number(l.unit_cost) > 0)) continue;
      const currency = r.currency === 'USD' ? 'USD' : 'IQD', at = currency === 'USD' ? usd : by;
      if (!at.has(l.item)) at.set(l.item, { item: l.item, unit: String(l.unit || ''), cost: Number(l.unit_cost), currency, day: String(r.entry_date || '').slice(0, 10), supplier: r.supplier_name || '' });
    }
    for (const [item, p] of usd) if (!by.has(item)) by.set(item, p);
    return by;
  }
  /* A stock item's last price in its base unit: {perBase, base, currency, day, supplier, unit, cost},
     or {error:'unit'} when the unit it was bought in can't be turned into its base unit, or null when
     it was not bought (in the invoices kept, the last 60 days). */
  function priceOf(titem, last) {
    if (!last) return null;
    const f = titem ? factor(titem, last.unit || titem.base) : null;
    const out = { base: titem ? titem.base : '', currency: last.currency, day: last.day, supplier: last.supplier, unit: last.unit, cost: last.cost };
    if (!(f > 0)) return { ...out, error: 'unit' };
    return { ...out, perBase: last.cost / f };
  }

  const round = (n) => Math.round(n * 100) / 100;
  /* Costs, profit and the suggested price are shown to the nearest 250 IQD (Rozh's choice, 2026-11-16).
     A cost above 0 is never shown as 0: it is at least 250. The breakdown keeps the exact prices. */
  const ROUND_TO = 250;
  const roundMoney = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    const r = Math.round(Math.abs(v) / ROUND_TO) * ROUND_TO;
    return v < 0 ? -r : r;
  };
  const roundCost = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return v > 0 ? Math.max(ROUND_TO, roundMoney(v)) : 0;
  };

  /* A price per base unit in plain sizes: grams also per kilo, millilitres also per litre, pieces per
     piece, any other base unit per one of it. [{size, unit, amount}]: size 1000 g is shown as 1 kg. */
  function unitPrices(p) {
    if (!p || !(p.perBase > 0)) return [];
    const m = measure(p.base);
    if (m && m.kind === 'g') return [{ unit: 'kg', amount: p.perBase * 1000 / m.f }, { unit: 'g', amount: p.perBase / m.f }];
    if (m && m.kind === 'ml') return [{ unit: 'l', amount: p.perBase * 1000 / m.f }, { unit: 'ml', amount: p.perBase / m.f }];
    if (m && m.kind === 'piece') return [{ unit: 'piece', amount: p.perBase }];
    return [{ unit: 'other', name: p.base || '', amount: p.perBase }];
  }

  /* One line's cost. ctx: {ingredient(id), titem(name), price(name) -> priceOf result, unit(id) -> unit
     name, catalog: true when Ricotta Restaurant's list is known}. status: ok, amount (no amount), link
     (no ingredient or stock item), gone (stock item no longer in Ricotta Restaurant), price (never
     bought), usd (bought only in USD), unit (the recipe's unit can't be turned into the stock
     item's), buyUnit (the unit it was bought in can't be). */
  function lineCost(line, ctx) {
    const ing = line && ctx.ingredient(line.ingredient);
    const unitName = line ? ctx.unit(line.unit) || '' : '';
    const out = { ingredient: line ? line.ingredient : null, name: ing ? ing.name : '', stockItem: ing ? ing.stock_item : '', qty: line ? line.qty : null, unit: unitName };
    if (!ing || !ing.stock_item) return { ...out, status: 'link' };
    const titem = ctx.titem(ing.stock_item);
    if (!titem) return { ...out, status: ctx.catalog ? 'gone' : 'price' };
    if (!(Number(line.qty) > 0)) return { ...out, status: 'amount', base: titem.base };
    const f = factor(titem, unitName);
    if (!(f > 0)) return { ...out, status: 'unit', base: titem.base };
    const baseQty = Number(line.qty) * f;
    const p = ctx.price(ing.stock_item);
    if (!p) return { ...out, status: 'price', base: titem.base, baseQty };
    if (p.currency !== 'IQD') return { ...out, status: 'usd', base: titem.base, baseQty, day: p.day };
    if (p.error) return { ...out, status: 'buyUnit', base: titem.base, baseQty, boughtIn: p.unit };
    return { ...out, status: 'ok', base: titem.base, baseQty, cost: round(baseQty * p.perBase), currency: 'IQD', perBase: p.perBase, day: p.day };
  }

  /* A recipe's cost in IQD. One recipe is one dish: its menu price (data.price) is compared with the cost
     of making it. total: the exact cost, only when every line has a cost (an ingredient with no price
     yet means the recipe has no cost at all, never a cost that is too low). cost, profit and suggested
     are rounded to the nearest 250 IQD, and the margin comes from those rounded numbers. problems: the
     lines without a cost, {name, status}, so the app can say which one. state: loss (the cost reaches
     the menu price), low (margin under MARGIN_MIN), ok, or none (no price, or no cost yet). */
  function recipeCost(recipe, ctx, marginMin = MARGIN_MIN) {
    const d = (recipe && recipe.data) || {};
    const lines = (Array.isArray(d.lines) ? d.lines : []).map((l) => lineCost(l, ctx));
    let sum = 0;
    for (const l of lines) if (l.status === 'ok') sum += l.cost;
    const problems = lines.filter((l) => l.status !== 'ok').map((l) => ({ name: l.name, status: l.status }));
    const missing = problems.length;
    const complete = lines.length > 0 && missing === 0;
    const price = Number(d.price) > 0 ? Number(d.price) : null;
    const total = complete ? round(sum) : null;
    const cost = complete ? roundCost(total) : null;
    const profit = complete && price !== null ? roundMoney(price - cost) : null;
    const margin = profit !== null ? Math.round((profit / price) * 1000) / 10 : null;
    const losing = profit !== null && profit <= 0;
    const low = !losing && margin !== null && margin < marginMin;
    const suggested = complete && total > 0 ? roundCost(total * SUGGEST_TIMES) : null;
    return { lines, missing, problems, complete, currency: 'IQD', total, cost, price, profit, margin, losing, low, suggested,
      state: losing ? 'loss' : low ? 'low' : profit !== null ? 'ok' : 'none' };
  }

  /* The context recipeCost() needs, from the lists the API keeps: ingredients, Ricotta Restaurant's
     items (titems), the app's units and the invoices (or prices already worked out: {name: priceOf}). */
  function context({ ingredients, titems, units, invoices, prices, catalog }) {
    const ing = new Map((ingredients || []).map((i) => [i.id, i]));
    const items = new Map((titems || []).map((x) => [x.name, x]));
    const unitBy = new Map((units || []).map((u) => [u.id, u.en]));
    let byName = prices ? new Map(Object.entries(prices)) : null;
    if (!byName) {
      const want = [...new Set((ingredients || []).map((i) => i.stock_item).filter(Boolean))];
      const last = lastPrices(invoices, want);
      byName = new Map(want.map((n) => [n, priceOf(items.get(n), last.get(n))]).filter(([, p]) => p));
    }
    // A unit saved before units came from Manage, Units is its name itself (کیلۆ).
    return { ingredient: (id) => ing.get(id), titem: (n) => items.get(n), price: (n) => byName.get(n) || null,
      unit: (id) => unitBy.get(id) || (typeof id === 'string' ? id : ''), catalog: catalog ?? (titems || []).length > 0, prices: byName };
  }

  /* How a stock item stands in Main Storage for its recipes: empty, low (an ordering item linked to it
     is at or below its low stock level), or ok. lowNames: stock item names at or below a level. */
  function stockState(titem, lowNames) {
    if (!titem) return null;
    if (!(T().available(titem, MAIN) > 0)) return 'empty';
    return lowNames && lowNames.has(titem.name) ? 'low' : 'ok';
  }

  globalThis.RicottaRecipeCost = Object.freeze({ MARGIN_MIN, SUGGEST_TIMES, ROUND_TO, CURRENCIES, MAIN, measure, factor, lastPrices, priceOf, lineCost, recipeCost, context, stockState, roundMoney, roundCost, unitPrices });
})();
