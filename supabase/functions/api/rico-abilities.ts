// More of Rico's abilities (2026-11-18), used by assistant.ts. Every number is worked out here from real
// rows; the AI only says it in words.
//   calculate         exact sums (prices, margins, splits, how much per day), so no number is guessed
//   compare_periods   two periods side by side: orders (from History) and spending (every invoice in
//                     Ricotta Restaurant), in total and per supplier or item, shown as a card with Excel
//                     and PDF downloads
//   item_overview     one item's whole picture: how often and how much it is ordered, the last order,
//                     the stock in Main Storage, the last price paid, and how much would last N days
//   contact_supplier  a card with Call and WhatsApp for a supplier (an optional message is only typed
//                     in for the person; they press send in WhatsApp themselves)
//   dataState         how fresh the data read from Ricotta Restaurant is (Cloud Rico, Mac Rico), for
//                     Rico's CONTEXT, so he says plainly when something is old or missing
// Nothing here writes anything. Access follows the same roles as the rest of Rico.
import "../_shared/search.js";
import { invoicesFor } from "./rico-invoices.ts";
import { readMonthNow } from "./rr-reader.ts";

type Emit = (event: Record<string, unknown>) => void;
const search = (globalThis as any).RicottaSearch;
const DAY = 86400_000;
const KEPT_DAYS = 60;
const cardId = (k: string) => `${k}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const money = (n: number, cur: string) => cur === "USD" ? Math.round(n * 100) / 100 : Math.round(n);
const pct = (a: number, b: number) => b ? Math.round((a - b) / b * 1000) / 10 : null;
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const erbilToday = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const monthLength = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const prevMonthOf = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

/* ================= calculate ================= */
/* A small, safe calculator: numbers, + - * / ^, brackets and % (50% is 0.5; 200 + 10% is 220, as on a
   phone calculator). Kurdish and Arabic digits, × and ÷, and thousands commas (1,250) are read too.
   Nothing is ever run as code. */
const DIGITS = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0));
export function evaluate(input: unknown): { value: number } | { error: string } {
  let s = DIGITS(String(input ?? "")).replace(/[×xX]/g, "*").replace(/[÷]/g, "/").replace(/[−–]/g, "-").replace(/٫/g, ".").replace(/(\d),(?=\d{3}(?!\d))/g, "$1").replace(/\s+/g, "");
  if (!s) return { error: "empty" };
  if (s.length > 300) return { error: "too_long" };
  if (!/^[0-9.+\-*/^()%]+$/.test(s)) return { error: "only numbers and + - * / ^ ( ) %" };
  let i = 0, depth = 0;
  const peek = () => s[i];
  const fail = (m: string) => { throw new Error(m); };
  const number = (): number => {
    const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
    if (!m) fail("a number is missing");
    i += m![0].length;
    return Number(m![0]);
  };
  const primary = (): number => {
    if (peek() === "(") {
      if (++depth > 30) fail("too many brackets");
      i++; const v = expr();
      if (peek() !== ")") fail("a bracket is not closed");
      i++; depth--; return v;
    }
    return number();
  };
  const unary = (): number => {
    if (peek() === "-") { i++; return -unary(); }
    if (peek() === "+") { i++; return unary(); }
    let v = primary();
    while (peek() === "%") { i++; v = v / 100; }
    return v;
  };
  const power = (): number => {
    const b = unary();
    if (peek() === "^") { i++; return Math.pow(b, power()); }
    return b;
  };
  const term = (): number => {
    let v = power();
    for (;;) {
      if (peek() === "*") { i++; v *= power(); }
      else if (peek() === "/") { i++; const d = power(); if (d === 0) fail("division by zero"); v /= d; }
      else return v;
    }
  };
  // a + b% is a plus b percent of a (as a phone calculator does); a - b% likewise.
  const expr = (): number => {
    let v = term();
    for (;;) {
      const op = peek();
      if (op !== "+" && op !== "-") return v;
      i++;
      const start = i, t = term();
      const percentOnly = /^\(?[0-9.]+%\)?$/.test(s.slice(start, i));
      const add = percentOnly ? v * t : t;
      v = op === "+" ? v + add : v - add;
    }
  };
  try {
    const v = expr();
    if (i !== s.length) return { error: `cannot read "${s.slice(i, i + 12)}"` };
    if (!Number.isFinite(v)) return { error: "the answer is too big" };
    return { value: v };
  } catch (e) { return { error: (e as Error).message }; }
}
const tidy = (v: number) => Number(v.toPrecision(12));
export function calculate(a: any) {
  const list = (Array.isArray(a?.expressions) ? a.expressions : [a?.expression]).filter((x: unknown) => str(x)).slice(0, 12);
  if (!list.length) return { error: "Give expression (or expressions), e.g. \"13500 * 2.5\" or \"(5000 - 1750) / 5000 * 100\"." };
  const results = list.map((x: unknown) => {
    const r = evaluate(x);
    return "error" in r ? { expression: str(x, 300), error: r.error } : { expression: str(x, 300), result: tidy(r.value), rounded: Math.round(r.value * 100) / 100 };
  });
  return { results, note: "Use these exact results. Round money to whole IQD (or to 250 IQD for recipe prices, as the app does) and say what you rounded." };
}

/* ================= compare_periods ================= */
export type Period = { from: string; to: string };
/* The two periods: this month so far vs the same days of last month (fair), the last 7 or 30 days vs the
   ones before, or two custom ranges. Only the last 60 days are kept, for orders and invoices alike. */
export function periodsOf(a: any, today = erbilToday()): { a: Period; b: Period; label: string; whole_b?: Period } | { error: string } {
  const preset = str(a?.preset, 40) || "this_month_vs_last_month";
  const oldest = addDays(today, -(KEPT_DAYS - 1));
  if (preset === "this_month_vs_last_month") {
    const month = today.slice(0, 7), prev = prevMonthOf(month), day = Number(today.slice(8, 10));
    const last = Math.min(day, monthLength(prev));
    return { a: { from: `${month}-01`, to: today }, b: { from: `${prev}-01`, to: `${prev}-${String(last).padStart(2, "0")}` },
      whole_b: { from: `${prev}-01`, to: `${prev}-${String(monthLength(prev)).padStart(2, "0")}` }, label: "this month so far vs the same days of last month" };
  }
  if (preset === "last_month_vs_month_before") {
    const prev = prevMonthOf(today.slice(0, 7)), before = prevMonthOf(prev);
    return { a: { from: `${prev}-01`, to: `${prev}-${String(monthLength(prev)).padStart(2, "0")}` }, b: { from: `${before}-01`, to: `${before}-${String(monthLength(before)).padStart(2, "0")}` }, label: "last month vs the month before" };
  }
  if (preset === "last_7_days" || preset === "last_14_days" || preset === "last_30_days") {
    const n = preset === "last_7_days" ? 7 : preset === "last_14_days" ? 14 : 30;
    return { a: { from: addDays(today, -(n - 1)), to: today }, b: { from: addDays(today, -(2 * n - 1)), to: addDays(today, -n) }, label: `the last ${n} days vs the ${n} days before` };
  }
  if (preset === "custom") {
    const ok = [a?.a_from, a?.a_to, a?.b_from, a?.b_to].every(isDay);
    if (!ok) return { error: "For custom give a_from, a_to, b_from and b_to as YYYY-MM-DD (Erbil days)." };
    const A = { from: a.a_from, to: a.a_to > today ? today : a.a_to }, B = { from: a.b_from, to: a.b_to > today ? today : a.b_to };
    if (A.from > A.to || B.from > B.to) return { error: "A period starts after it ends." };
    if (daysBetween(A.from, A.to) > 92 || daysBetween(B.from, B.to) > 92) return { error: "Each period is at most 92 days." };
    return { a: A, b: B, label: `${A.from} to ${A.to} vs ${B.from} to ${B.to}` };
  }
  return { error: "preset is one of this_month_vs_last_month, last_month_vs_month_before, last_7_days, last_14_days, last_30_days or custom." };
}
const inside = (d: string, p: Period) => d >= p.from && d <= p.to;
const label = (p: Period) => p.from === p.to ? p.from : `${p.from} to ${p.to}`;

/* Orders in two periods (w.history: the sent orders kept, oldest first, each line with its supplier, item,
   unit and amount). Per supplier: orders and item lines; per item: the amount, per unit (never mixed). */
export function compareOrders(w: any, A: Period, B: Period, a: any) {
  const unitName = (id: string | null) => w.units?.find((u: any) => u.id === id)?.en ?? id ?? "";
  const wantSup = str(a?.supplier, 120), wantItem = str(a?.item, 120);
  const supOk = (name: string | null) => !wantSup || Number.isFinite(search.score(wantSup, [name ?? "No supplier"], true));
  const itemOk = (l: any) => !wantItem || Number.isFinite(search.score(wantItem, [l.name, ...((w.items ?? []).find((i: any) => i.id === l.itemId)?.aliases ?? [])], true));
  const by = a?.by === "item" ? "item" : "supplier";
  const side = (p: Period) => {
    const orders = (w.history ?? []).filter((o: any) => inside(o.date, p))
      .map((o: any) => ({ ...o, lines: o.lines.filter((l: any) => supOk(l.supplierName) && itemOk(l)) })).filter((o: any) => o.lines.length);
    const groups = new Map<string, { name: string; unit: string; orders: number; lines: number; qty: number }>();
    for (const o of orders) {
      const seen = new Set<string>();
      for (const l of o.lines) {
        const key = by === "item" ? `${l.itemId}|${l.unitId ?? ""}` : (l.supplierName ?? "No supplier");
        const g = groups.get(key) ?? { name: by === "item" ? l.name : (l.supplierName ?? "No supplier"), unit: by === "item" ? unitName(l.unitId) : "", orders: 0, lines: 0, qty: 0 };
        if (!seen.has(key)) { g.orders++; seen.add(key); }
        g.lines++; g.qty = r3(g.qty + (Number(l.qty) || 0));
        groups.set(key, g);
      }
    }
    return { orders: orders.length, lines: orders.reduce((n: number, o: any) => n + o.lines.length, 0), days: new Set(orders.map((o: any) => o.date)).size, groups };
  };
  const x = side(A), y = side(B);
  const keys = new Set([...x.groups.keys(), ...y.groups.keys()]);
  const value = (g: any) => g ? (by === "item" ? g.qty : g.orders) : 0;
  const rows = [...keys].map((k) => {
    const ga = x.groups.get(k), gb = y.groups.get(k), g = ga ?? gb!;
    return { name: g.name, unit: g.unit || undefined, a: value(ga), b: value(gb), change_pct: pct(value(ga), value(gb)) };
  }).sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b) || q.a - p.a);
  const first = (w.history ?? [])[0]?.date ?? null;
  return {
    by, totals: { orders: { a: x.orders, b: y.orders, change_pct: pct(x.orders, y.orders) }, item_lines: { a: x.lines, b: y.lines, change_pct: pct(x.lines, y.lines) }, days_with_orders: { a: x.days, b: y.days } },
    rows, unit_note: by === "item" ? "Amounts are per unit; an item ordered in another unit is its own row." : "Per supplier: how many orders included it.",
    ...(first && B.from < first ? { partial: `Orders are kept from ${first}; the earlier period starts before that, so it may be missing some orders.` } : {}),
  };
}

/* Spending in two periods, from every invoice in Ricotta Restaurant (IQD and USD apart, never added). */
export async function compareSpending(db: any, A: Period, B: Period, a: any, read = readMonthNow) {
  const months = new Set<string>();
  for (const p of [A, B]) for (let m = p.from.slice(0, 7); m <= p.to.slice(0, 7); m = m.slice(5) === "12" ? `${Number(m.slice(0, 4)) + 1}-01` : `${m.slice(0, 5)}${String(Number(m.slice(5)) + 1).padStart(2, "0")}`) months.add(m);
  const { rows, notSetUp } = await invoicesFor(db, [...months].sort(), read);
  if (notSetUp) return { error: "not_set_up", note: "The server can't read Ricotta Restaurant's invoices yet (RR_PIN and RR_BRANCH in Supabase secrets). Say so in one line; the orders part still counts." };
  const wantSup = str(a?.supplier, 120), wantItem = str(a?.item, 120);
  const supOk = (n: string) => !wantSup || search.normalize(n).includes(search.normalize(wantSup)) || Number.isFinite(search.score(wantSup, [n], true));
  const itemOk = (n: string) => !wantItem || search.normalize(n).includes(search.normalize(wantItem)) || Number.isFinite(search.score(wantItem, [n], true));
  const by = a?.by === "item" ? "item" : "supplier";
  const side = (p: Period) => {
    const list = rows.filter((r: any) => inside(String(r.entry_date).slice(0, 10), p) && supOk(r.supplier_name || ""));
    const tot = { IQD: 0, USD: 0, invoices: 0 };
    const groups = new Map<string, { name: string; IQD: number; USD: number; qty: Record<string, number> }>();
    for (const r of list) {
      const cur = r.currency === "USD" ? "USD" : "IQD";
      if (by === "supplier") {
        if (wantItem && !(r.lines ?? []).some((l: any) => itemOk(l?.item ?? ""))) continue;
        tot.invoices++;
        const t = wantItem ? (r.lines ?? []).filter((l: any) => itemOk(l?.item ?? "")).reduce((n: number, l: any) => n + (Number(l.line_total) || (Number(l.qty) || 0) * (Number(l.unit_cost) || 0)), 0) : Number(r.total) || 0;
        tot[cur] += t;
        const g = groups.get(r.supplier_name) ?? { name: r.supplier_name || "No supplier", IQD: 0, USD: 0, qty: {} as Record<string, number> };
        g[cur] += t; groups.set(r.supplier_name, g);
      } else {
        let any = false;
        for (const l of r.lines ?? []) {
          if (!l?.item || !itemOk(l.item)) continue;
          const t = Number(l.line_total) || (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
          any = true; tot[cur] += t;
          const g = groups.get(l.item) ?? { name: l.item, IQD: 0, USD: 0, qty: {} as Record<string, number> };
          g[cur] += t;
          if (Number(l.qty) > 0 && l.unit) g.qty[l.unit] = r3((g.qty[l.unit] ?? 0) + Number(l.qty));
          groups.set(l.item, g);
        }
        if (any) tot.invoices++;
      }
    }
    return { tot, groups };
  };
  const x = side(A), y = side(B);
  const keys = new Set([...x.groups.keys(), ...y.groups.keys()]);
  const rowsOut = [...keys].map((k) => {
    const ga = x.groups.get(k), gb = y.groups.get(k), g = ga ?? gb!;
    const cur = (ga?.IQD || gb?.IQD) ? "IQD" : "USD";
    const va = money(ga?.[cur] ?? 0, cur), vb = money(gb?.[cur] ?? 0, cur);
    return { name: g.name, currency: cur, a: va, b: vb, change_pct: pct(va, vb), ...(by === "item" ? { qty_a: ga?.qty ?? {}, qty_b: gb?.qty ?? {} } : {}) };
  }).sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b) || q.a - p.a);
  return {
    by,
    totals: { IQD: { a: money(x.tot.IQD, "IQD"), b: money(y.tot.IQD, "IQD"), change_pct: pct(x.tot.IQD, y.tot.IQD) }, USD: { a: money(x.tot.USD, "USD"), b: money(y.tot.USD, "USD"), change_pct: pct(x.tot.USD, y.tot.USD) }, invoices: { a: x.tot.invoices, b: y.tot.invoices } },
    rows: rowsOut,
  };
}

export async function comparePeriods(db: any, w: any, a: any, emit: Emit, read = readMonthNow) {
  const can = w.can ?? {};
  const wanted = a?.what === "orders" || a?.what === "spending" ? a.what : "both";
  const doOrders = wanted !== "spending" && can.history, doSpend = wanted !== "orders" && can.receipts;
  if (!doOrders && !doSpend) return { error: "no_access", note: wanted === "spending" ? "This person can't open Receipts, so spending can't be compared. Say so briefly." : "This person has no History access, so orders can't be compared. Say so briefly." };
  const per: any = periodsOf(a, w.now?.date ?? erbilToday());
  if (per.error) return { error: per.error };
  const out: any = { compared: per.label, a: label(per.a), b: label(per.b) };
  if (doOrders) out.orders = compareOrders(w, per.a, per.b, a);
  else if (wanted !== "spending") out.orders_note = "No History access: orders are not compared.";
  if (doSpend) {
    try { out.spending = await compareSpending(db, per.a, per.b, a, read); }
    catch { out.spending = { error: "load_failed", note: "The invoices could not be read just now. Say so briefly." }; }
  } else if (wanted !== "orders") out.spending_note = "No Receipts access: spending is not compared.";
  if (per.whole_b && out.spending?.totals && !out.spending.error) {
    const whole = await compareSpending(db, per.whole_b, per.whole_b, { ...a, by: "supplier" }, read).catch(() => null) as any;
    if (whole?.totals) out.spending.last_month_whole = { IQD: whole.totals.IQD.a, USD: whole.totals.USD.a };
  }
  if (per.whole_b && out.orders) out.orders.last_month_whole = compareOrders(w, per.whole_b, per.whole_b, { ...a, by: "supplier" }).totals.orders.a;
  // The card: the totals, then the rows that changed most (spending first when both are there).
  const main = out.spending?.rows && !out.spending.error ? "spending" : out.orders ? "orders" : null;
  if (main) {
    const totals: any[] = [];
    if (out.spending?.totals && !out.spending.error) {
      const t = out.spending.totals;
      if (t.IQD.a || t.IQD.b) totals.push({ key: "iqd", a: t.IQD.a, b: t.IQD.b, pct: t.IQD.change_pct });
      if (t.USD.a || t.USD.b) totals.push({ key: "usd", a: t.USD.a, b: t.USD.b, pct: t.USD.change_pct });
      totals.push({ key: "invoices", a: t.invoices.a, b: t.invoices.b, pct: pct(t.invoices.a, t.invoices.b) });
    }
    if (out.orders) {
      const t = out.orders.totals;
      totals.push({ key: "orders", a: t.orders.a, b: t.orders.b, pct: t.orders.change_pct }, { key: "lines", a: t.item_lines.a, b: t.item_lines.b, pct: t.item_lines.change_pct });
    }
    const src = out[main];
    const rows = src.rows.slice(0, 40).map((r: any) => ({ name: r.name, a: r.a, b: r.b, pct: r.change_pct, unit: main === "spending" ? r.currency : r.unit ?? "" }));
    emit({ type: "proposal", proposal: { id: cardId("c"), kind: "compare", preset: str(a?.preset, 40) || "this_month_vs_last_month", a: per.a, b: per.b, main, by: src.by,
      supplier: str(a?.supplier, 80) || null, item: str(a?.item, 80) || null, totals, rows, more: Math.max(0, src.rows.length - 40) } });
  }
  if (out.orders) out.orders.rows = out.orders.rows.slice(0, 20);
  if (out.spending?.rows) out.spending.rows = out.spending.rows.slice(0, 20);
  out.note = (main ? "A card shows both periods with Excel and PDF downloads. Lead with the one or two changes that matter, in two or three lines; never list every row. " : "")
    + "IQD and USD are never added together. 'a' is the newer period, 'b' the earlier one; change_pct is a compared with b.";
  return out;
}

/* ================= item_overview ================= */
/* One ordering item: how often and how much is ordered (in the unit it has now), when it was last ordered,
   what is in Main Storage, the last price paid, and, with days, how much would last that long. */
export async function itemOverview(db: any, w: any, a: any, read = readMonthNow) {
  if (!w.can?.history) return { error: "no_access", note: "This person has no History access, so past orders can't be used. Say so briefly." };
  const q = str(a?.item, 160);
  if (!q) return { error: "Ask which item." };
  const items = (w.items ?? []) as any[];
  const exact = items.filter((i) => search.normalize(i.name) === search.normalize(q));
  const ranked = exact.length ? exact : search.rank(items, q, (i: any) => [i.name, ...(i.aliases || [])]);
  if (!ranked.length) return { error: "not_found", note: `No item matches "${q}". Say so and ask them to check the name (find_items can list close ones).` };
  const top = search.score(q, [ranked[0].name, ...(ranked[0].aliases || [])]);
  const close = ranked.filter((i: any) => search.score(q, [i.name, ...(i.aliases || [])]) === top);
  if (!exact.length && close.length > 1) return { error: "unclear", candidates: close.slice(0, 6).map((i: any) => i.name), note: "More than one item matches. Ask which one." };
  const it = exact.length === 1 ? exact[0] : ranked[0];
  const unitName = (id: string | null) => w.units?.find((u: any) => u.id === id)?.en ?? id ?? "";
  const supplierName = (id: string | null) => (id ? w.suppliers?.find((s: any) => s.id === id)?.name : null) ?? "No supplier";
  const today = w.now?.date ?? erbilToday();
  const weeks = Math.max(1, Math.min(8, Math.floor(Number(a?.weeks) || 8)));
  const from = addDays(today, -(weeks * 7 - 1));
  const history = (w.history ?? []) as any[];
  const firstKept = history[0]?.date ?? today;
  const start = from < firstKept ? firstKept : from;
  const span = Math.max(1, daysBetween(start, today) + 1);
  // Only amounts in the unit (and from the supplier) the item has now: 10 kg never turns into 10 boxes.
  const same = (l: any) => (l.unitId ?? null) === (it.unit_id ?? null) && (l.supplierId ?? null) === (it.supplier_id ?? null);
  const orders = history.filter((o) => o.date >= start && o.lines.some((l: any) => l.itemId === it.id));
  const amounts: { date: string; qty: number }[] = [];
  for (const o of orders) for (const l of o.lines) if (l.itemId === it.id && same(l)) amounts.push({ date: o.date, qty: Number(l.qty) || 0 });
  const total = r3(amounts.reduce((n, x) => n + x.qty, 0));
  const dates = [...new Set(orders.map((o) => o.date))];
  const gaps = dates.slice(1).map((d, k) => daysBetween(dates[k], d));
  const lastOrder = [...history].reverse().find((o) => o.lines.some((l: any) => l.itemId === it.id));
  const lastLine = lastOrder?.lines.find((l: any) => l.itemId === it.id);
  const perDay = total / span;
  const unit = unitName(it.unit_id);
  const out: any = {
    item: it.name, unit, supplier: supplierName(it.supplier_id), available: it.available !== false,
    ordering: {
      looked_at: `${start} to ${today} (${span} days${start !== from ? `, orders are kept from ${firstKept}` : ""})`,
      times_ordered: orders.length, total_ordered: total, usual_qty: amounts.length ? r3(median(amounts.map((x) => x.qty))) : null,
      average_days_between_orders: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length * 10) / 10 : null,
      per_day: r3(perDay), per_week: r3(perDay * 7),
      last_order: lastOrder ? { day: lastOrder.date, qty: Number(lastLine?.qty) || null, unit: unitName(lastLine?.unitId ?? null), days_ago: daysBetween(lastOrder.date, today) } : null,
    },
  };
  // Main Storage, from the stock read from Ricotta Restaurant (items linked to a stock item in Manage).
  const stock = w.stockOf?.get?.(it.id) ?? null;
  if (stock) out.in_main_storage = stock;
  else out.in_main_storage = "not linked to a stock item (Manage, the item, Stock item), so the stock is unknown";
  // The last price paid, from every invoice, for its linked stock item(s) or its name.
  if (w.can?.receipts) {
    try {
      const names: string[] = [it.stock_item, ...(Array.isArray(it.stock_items) ? it.stock_items : [])].filter(Boolean).map(String);
      const month = today.slice(0, 7);
      const { rows, notSetUp } = await invoicesFor(db, [month, prevMonthOf(month)], read);
      if (!notSetUp) {
        let best: any = null;
        for (const r of [...rows].sort((p: any, q2: any) => String(q2.entry_date).localeCompare(String(p.entry_date)))) {
          for (const l of r.lines ?? []) {
            if (!l?.item || !(Number(l.unit_cost) > 0)) continue;
            const hit = names.length ? names.includes(l.item) : Number.isFinite(search.score(it.name, [l.item], false));
            if (hit) { best = { price: money(Number(l.unit_cost), r.currency), currency: r.currency === "USD" ? "USD" : "IQD", per: l.unit || "", day: String(r.entry_date).slice(0, 10), supplier: r.supplier_name, stock_item: l.item }; break; }
          }
          if (best) break;
        }
        out.last_price = best ?? "no invoice in this month or last has it";
      } else out.last_price = "invoices can't be read yet (not set up)";
    } catch { out.last_price = "the invoices could not be read just now"; }
  }
  // How much would last N days: the daily pace from the orders, minus what is in Main Storage when it is
  // counted in the same unit as the item is ordered in.
  const days = Math.floor(Number(a?.days));
  if (days >= 1 && days <= 60) {
    const need = perDay * days;
    let have: number | null = null, note = "";
    if (stock && !stock.missing && stock.qty != null && stock.unit) {
      if (search.unit([String(stock.unit)], unit) || search.normalize(stock.unit) === search.normalize(unit)) have = Number(stock.qty) || 0;
      else note = `The stock is counted in ${stock.unit}, not ${unit}, so it was not taken off.`;
    } else if (stock?.kinds) note = "The stock is in several units, so it was not taken off.";
    else note = "The stock is unknown, so it was not taken off.";
    const order = Math.max(0, need - (have ?? 0));
    out.to_last = { days, needed: r3(need), in_stock_same_unit: have, to_order: r3(order), to_order_whole: Math.max(0, Math.ceil(order - 1e-9)), unit,
      how: `${r3(perDay)} ${unit} a day (ordered in the last ${span} days) x ${days} days${have != null ? ` - ${have} in Main Storage` : ""}.`, ...(note ? { note } : {}) };
    if (!amounts.length) out.to_last.note = "It was not ordered in this time, so there is no pace to go by. Say so and ask how much they want.";
  }
  out.next = "Say it in a few short lines. If they want to order it, offer propose_order_draft (mode add) with the amount, and say why in one line.";
  return out;
}

/* ================= contact_supplier ================= */
export function contactSupplier(w: any, a: any, emit: Emit) {
  const roles: string[] = w.roles ?? [];
  if (!(w.full || roles.includes("manage") || roles.includes("send"))) return { error: "no_access", note: "This person can't see suppliers' numbers. Say so briefly; Rozh can give access in Admin." };
  const q = str(a?.supplier, 160);
  if (!q) return { error: "Ask which supplier." };
  const list = (w.suppliers ?? []) as any[];
  const exact = list.filter((s) => search.normalize(s.name) === search.normalize(q));
  const found = exact.length ? exact : search.rank(list, q, (s: any) => [s.name]);
  if (!found.length) return { error: "not_found", suppliers: list.map((s) => s.name).slice(0, 40), note: "No supplier has that name. Offer the closest." };
  if (!exact.length && found.length > 1 && search.score(q, [found[0].name]) === search.score(q, [found[1].name])) return { error: "unclear", candidates: found.slice(0, 5).map((s: any) => s.name), note: "Ask which one." };
  const s = exact[0] ?? found[0];
  if (!s.phone) return { error: "no_number", supplier: s.name, note: "No phone number is saved for this supplier. Say so, and offer open_screen with screen suppliers to add one." };
  const message = str(a?.message, 600);
  emit({ type: "proposal", proposal: { id: cardId("k"), kind: "contact", supplierId: s.id, name: s.name, phone: String(s.phone).slice(0, 40), message } });
  return { shown: true, supplier: s.name, note: message ? "A card with Call and WhatsApp is under your reply; WhatsApp opens with the message typed in, and the person presses send there. Say that in one line." : "A card with Call and WhatsApp is under your reply. Say one short line." };
}

/* ================= how fresh the data is ================= */
const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
export async function dataState(db: any, wantHelper: boolean) {
  const one = async (table: string, cols: string) => {
    try { const r: any = await db.from(table).select(cols).eq("id", true).maybeSingle(); return r?.error ? null : r?.data ?? null; } catch { return null; }
  };
  const [reader, helper] = await Promise.all([one("app_rr_reader", "last_run_at,catalog_ok_at,invoices_ok_at,problem"), wantHelper ? one("app_rr_helper", "last_seen") : Promise.resolve(null)]);
  return { reader, helper };
}
/* One line for CONTEXT, or "" when nothing is known (tests, or before the first read). */
export function dataStateLine(s: any, now = Date.now()) {
  if (!s?.reader && !s?.helper) return "";
  const parts: string[] = [];
  const r = s.reader;
  if (r) {
    parts.push(`stock and lists read ${ago(r.catalog_ok_at, now) ?? "never"}`);
    parts.push(`invoices read ${ago(r.invoices_ok_at, now) ?? "never"}`);
    const stale = !r.catalog_ok_at || now - Date.parse(r.catalog_ok_at) > 30 * 60_000;
    if (r.problem) parts.push(`PROBLEM since ${ago(r.problem.since ?? r.problem.at, now) ?? "now"}: ${String(r.problem.cause ?? r.problem.kind ?? "Cloud Rico can't read Ricotta Restaurant").slice(0, 160)}`);
    if (stale) parts.push("the stock may be OLD: say so when you use it");
  }
  if (s.helper) parts.push(`Rico on the Mac last seen ${ago(s.helper.last_seen, now) ?? "never"}`);
  return parts.join("; ");
}

export const ABILITY_TOOLS = [
  { name: "calculate", description: "Exact arithmetic. Use it for EVERY sum you give that is not already in a tool result: totals, price x amount, cost per portion, margins, percentages, splits, how much per day. Numbers, + - * / ^, brackets and % (\"200 + 10%\" is 220). Several at once with expressions.",
    input_schema: { type: "object", properties: { expression: { type: "string" }, expressions: { type: "array", items: { type: "string" }, description: "Up to 12" } } } },
  { name: "compare_periods", description: "Compares two periods side by side: orders (from History: orders, item lines, per supplier or per item amounts) and spending (every invoice in Ricotta Restaurant: IQD and USD apart, per supplier or item). preset: this_month_vs_last_month (default; this month so far vs the same days of last month, plus last month's whole total), last_month_vs_month_before, last_7_days, last_14_days, last_30_days (each vs the same length before), or custom with a_from, a_to, b_from, b_to. Optional supplier or item filter. Shows a card with Excel and PDF downloads. Use for 'this month vs last month', 'are we spending more', 'did we order more bread than last week'.",
    input_schema: { type: "object", properties: { preset: { type: "string", enum: ["this_month_vs_last_month", "last_month_vs_month_before", "last_7_days", "last_14_days", "last_30_days", "custom"] }, what: { type: "string", enum: ["both", "orders", "spending"] }, by: { type: "string", enum: ["supplier", "item"] }, supplier: { type: "string" }, item: { type: "string" }, a_from: { type: "string" }, a_to: { type: "string" }, b_from: { type: "string" }, b_to: { type: "string" } } } },
  { name: "item_overview", description: "One ordering item's whole picture: how many times and how much it was ordered (last 8 weeks, in the unit it has now), the usual amount, days between orders, the last order, what is in Main Storage, the last price paid, and with days: how much would last that many days (the daily pace x days, minus the stock when it is in the same unit). Use for 'how often do we order X', 'when did we last order X', 'how much X should I order for 5 days'.",
    input_schema: { type: "object", properties: { item: { type: "string", description: "Item name or alias, any language" }, days: { type: "integer", description: "1-60: how many days it should last" }, weeks: { type: "integer", description: "1-8 weeks of orders to look at, default 8" } }, required: ["item"] } },
  { name: "contact_supplier", description: "Shows a card with Call and WhatsApp buttons for one supplier, from the number saved in Suppliers. With message (in the person's language, only what they asked to say), WhatsApp opens with it typed in; the person presses send in WhatsApp themselves. Use for 'call the bakery', 'message the dairy that we need milk early'. For orders use Send to suppliers instead.",
    input_schema: { type: "object", properties: { supplier: { type: "string" }, message: { type: "string" } }, required: ["supplier"] } },
];
export const ABILITY_TOOL_NAMES = new Set(ABILITY_TOOLS.map((t) => t.name));
export const ABILITY_MANUAL = `- Sums: for any number you work out yourself (a total, price x amount, cost per portion, a margin, a split, a percentage), use calculate first and give its result. Never do arithmetic in your head.
- Comparing: "this month vs last month", "are we spending more", "did we order more X than last week" -> compare_periods (a card with Excel and PDF). This month is compared with the same days of last month, so it is fair; say that once. Lead with the one or two changes that matter.
- One item: "how often do we order X", "when did we last order X", "how much X for 5 days" -> item_overview (with days for how long it should last). Then offer the amount with propose_order_draft (mode add), and say how it was worked out in one line.
- Calling or messaging a supplier: contact_supplier (a card with Call and WhatsApp). A message is only typed in for them; they press send in WhatsApp.
- Old or missing data: CONTEXT says when the stock, lists and invoices were last read from Ricotta Restaurant. When you use data that is old (more than 30 minutes for stock) or there is a PROBLEM, say so plainly in one line ("The stock was read 2 hours ago, so it may be out of date."). When a tool says not_set_up, no_stock, load_failed or no_access, say exactly what is missing and who can fix it. Never fill a gap with a guess.
- Follow-up questions: "and last week?", "what about the bakery?", "make it 5" refer to what you just talked about; use the same tool again with the change.
- Several steps in one message ("compare this month, then prepare what is low"): do them in order, one tool after another, then answer once.`;

export async function runAbilityTool(db: any, w: any, name: string, a: any, emit: Emit): Promise<unknown> {
  switch (name) {
    case "calculate": return calculate(a);
    case "compare_periods": return await comparePeriods(db, w, a, emit);
    case "item_overview": return await itemOverview(db, w, a);
    case "contact_supplier": return contactSupplier(w, a, emit);
  }
  return undefined;
}
