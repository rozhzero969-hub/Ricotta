// Rico's tools for Ricotta Restaurant's receipts, transfers and stock (used by assistant.ts).
//
// Every answer is worked out here from real rows (app_rr_receipts, app_rr_transfers, app_rr_catalog);
// nothing is guessed. Days are Erbil days (Asia/Baghdad, UTC+3). Each tool follows the person's roles
// exactly like find_rico_records: without Receipts or Transfers it answers no_access and reads nothing.
// All of them only read, except propose_transfer_draft, which saves a transfer DRAFT for the person
// (as PUT transfers/<id> does) and never sends, approves or moves anything. Receipts are never made here.
import "../_shared/search.js";
import "../_shared/receipts.js";
import "../_shared/transfers.js";
import { catalogOf, logEntry } from "./receipts.ts";
import { cleanDraft, erbilDay, usualAmounts } from "./transfers.ts";
const search = (globalThis as any).RicottaSearch;
const R = (globalThis as any).RicottaReceipts;
const T = (globalThis as any).RicottaTransfers;

type Emit = (event: Record<string, unknown>) => void;
const noEmit: Emit = () => {};
const DB_TIMEOUT_MS = 12_000;
const MAX_DAYS = 60;
const STUCK_MINUTES = 15;
const DRAFTS_PER_REPLY = 2;
const LOW_DAYS = 3, USE_DAYS = 14;
/* A card id, like the other proposals' ids. */
const cardId = (k: string) => `${k}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CARD_NOTE = "The app already shows these as a card under your reply. Say it in one or two short lines; never list every row again.";
export const NO_RECEIPTS = { error: "no_access", note: "This person can't open Receipts. Say so briefly." };
export const NO_TRANSFERS = { error: "no_access", note: "This person can't open Transfers. Say so briefly." };

function withTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), DB_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const money = (n: number, currency: string) => currency === "USD" ? Math.round(n * 100) / 100 : Math.round(n);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayStart = (day: string) => `${day}T00:00:00+03:00`;
const dayOf = (iso: string | null | undefined) => iso ? erbilDay(new Date(iso)) : null;
const erbilTime = (iso: string | null | undefined) => {
  if (!iso) return null;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
};
const minutesSince = (iso: string | null | undefined) => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : null;
const has = (v: unknown, q: unknown) => !q || search.normalize(v).includes(search.normalize(q));

/* The period a person asked for: today, yesterday, week (the last 7 days), month (this calendar month)
   or custom (from..to). Never more than the last 60 days, which is all that is kept. */
export function periodOf(a: any, today = erbilDay()) {
  const p = String(a?.period ?? "week").toLowerCase();
  const oldest = addDays(today, -(MAX_DAYS - 1));
  let from: string, to = today;
  if (p === "today") from = today;
  else if (p === "yesterday") from = to = addDays(today, -1);
  else if (p === "week") from = addDays(today, -6);
  else if (p === "month") from = today.slice(0, 8) + "01";
  else if (p === "custom") {
    if (!isDay(a?.from)) return { error: "For a custom period give from (and optionally to) as YYYY-MM-DD, Erbil days." };
    from = a.from; to = isDay(a?.to) ? a.to : today;
    if (to > today) to = today;
    if (from > to) return { error: "from is after to." };
    if (from < oldest) return { error: `Only the last ${MAX_DAYS} days are kept (from ${oldest}). Ask for a shorter period.` };
  } else return { error: "period is one of today, yesterday, week, month or custom." };
  return { from, to, label: from === to ? from : `${from} to ${to}` };
}

/* Aliases the kitchen gave items in the Orders catalog (often English), found by the item's name, so
   "tomato" finds تەماتە in Ricotta Restaurant's lists too. */
function aliasMap(w: any) {
  const m = new Map<string, string[]>();
  for (const i of w?.items ?? []) if (i?.name && Array.isArray(i.aliases) && i.aliases.length) m.set(search.normalize(i.name), i.aliases);
  return m;
}
/* One name for what was written (Kurdish, Arabic or English, typos allowed), or the close candidates
   when it isn't clear which one is meant. */
export function pickName(names: string[], q: unknown, aliases = new Map<string, string[]>()) {
  const query = str(q);
  if (!query) return { none: true as const, candidates: [] as string[] };
  const scored = [...new Set(names.filter(Boolean))]
    .map((n) => ({ n, s: search.score(query, [n, ...(aliases.get(search.normalize(n)) ?? [])]) }))
    .filter((x) => Number.isFinite(x.s)).sort((a, b) => a.s - b.s);
  if (!scored.length) return { none: true as const, candidates: [] as string[] };
  const exact = scored.filter((x) => search.normalize(x.n) === search.normalize(query));
  if (exact.length === 1) return { name: exact[0].n };
  if (scored.length === 1 || scored[0].s < scored[1].s) return { name: scored[0].n };
  return { ambiguous: true as const, candidates: scored.slice(0, 6).map((x) => x.n) };
}
const notFound = (what: string, q: unknown, p: any) => p.ambiguous
  ? { error: "unclear", note: `"${str(q, 80)}" matches more than one ${what}. Ask which one.`, candidates: p.candidates }
  : { error: "not_found", note: `No ${what} matches "${str(q, 80)}". Say so, and ask them to check the name.` };

async function savedReceipts(db: any, since: string) {
  const { data, error } = await withTimeout<any>(db.from("app_rr_receipts").select("id,supplier,invoice,zone,currency,rate,delivery,lines,total,saved_at,mode")
    .eq("status", "saved").gte("saved_at", since).order("saved_at", { ascending: false }).limit(1000), "receipts");
  if (error) throw new Error("receipts_unavailable");
  // Practice runs never reached Ricotta Restaurant's books.
  return ((data ?? []) as any[]).filter((r) => r.mode !== "practice" && r.saved_at);
}

/* ---------- stock_levels ---------- */
export async function stockLevels(db: any, w: any, a: any) {
  if (!w.can.transfers) return NO_TRANSFERS;
  const cat: any = await withTimeout(catalogOf(db), "catalog");
  const titems: any[] = cat.titems ?? [];
  if (!titems.length) return { error: "no_stock", note: "Rico has not read the stock from Ricotta Restaurant yet. Say so." };
  const p: any = pickName(titems.map((i) => i.name), a.item, aliasMap(w));
  if (!p.name) return notFound("item", a.item, p);
  const item = titems.find((i) => i.name === p.name);
  const zones: string[] = T.zonesOf(cat);
  let shown = zones;
  if (a.storage) {
    const z: any = pickName(zones, a.storage);
    if (!z.name) return { ...notFound("storage", a.storage, z), storages: zones };
    shown = [z.name];
  }
  const storages = shown.map((zone) => ({ zone, base: T.available(item, zone) }))
    .filter((x) => a.storage || x.base > 0)
    .map((x) => { const c = T.inCounting(item, x.base, true); return { storage: x.zone, qty: c.qty, unit: c.unit }; });
  const at = cat.stockAt ?? cat.at ?? null;
  return {
    item: item.name, unit: T.inCounting(item, 0).unit,
    storages: storages.slice(0, 20),
    note: storages.length ? undefined : "None in any storage.",
    stock_read_at: erbilTime(at), read_minutes_ago: minutesSince(at),
  };
}

/* ---------- low_stock ---------- */
/* What is running low in one storage (Main Storage unless named): items that are empty, or have less
   than LOW_DAYS days left at the pace they left that storage in moved transfers over the last USE_DAYS
   days. Items never kept there, and empty ones nobody used lately, are left out. Shown as a card. */
export async function lowStock(db: any, w: any, a: any, emit: Emit = noEmit) {
  if (!w.can.transfers) return NO_TRANSFERS;
  const cat: any = await withTimeout(catalogOf(db), "catalog");
  const titems: any[] = cat.titems ?? [];
  if (!titems.length) return { error: "no_stock", note: "Rico has not read the stock from Ricotta Restaurant yet. Say so." };
  const zones: string[] = T.zonesOf(cat);
  let zone = zones.includes("Main Storage") ? "Main Storage" : zones[0];
  if (a?.storage) {
    const z: any = pickName(zones, a.storage);
    if (!z.name) return { ...notFound("storage", a.storage, z), storages: zones };
    zone = z.name;
  }
  const since = new Date(Date.now() - USE_DAYS * 86400_000).toISOString();
  const { data, error } = await withTimeout<any>(db.from("app_rr_transfers").select("from_zone,lines,moved_at,mode")
    .eq("status", "moved").eq("from_zone", zone).gte("moved_at", since).limit(1500), "transfers");
  if (error) throw new Error("records_unavailable");
  const byName = new Map(titems.map((i) => [i.name, i]));
  const used = new Map<string, { base: number; n: number }>();
  for (const r of (data ?? []) as any[]) {
    if (r.mode === "practice") continue;
    for (const l of r.lines ?? []) {
      const it = byName.get(l?.item);
      if (!it) continue;
      const f = T.unitOptions(it).find((u: any) => u.name === l.unit)?.factor ?? (l.unit === it.base ? 1 : 0);
      const q = Number(l.qty) * f;
      if (!(q > 0)) continue;
      const u = used.get(it.name) ?? { base: 0, n: 0 };
      u.base += q; u.n++; used.set(it.name, u);
    }
  }
  const rows: any[] = [];
  for (const it of titems) {
    if (!it.stock || !(zone in it.stock)) continue;
    const have = T.available(it, zone), u = used.get(it.name);
    const perDay = u && u.n >= 2 ? u.base / USE_DAYS : 0;
    const days = perDay > 0 ? have / perDay : null;
    const empty = have <= 0;
    if (empty ? !u : !(days !== null && days < LOW_DAYS)) continue;
    const c = T.inCounting(it, have, true);
    rows.push({ item: it.name, qty: c.qty, unit: c.unit, days_left: days === null ? null : Math.round(days * 10) / 10, empty });
  }
  rows.sort((x, y) => Number(y.empty) - Number(x.empty) || (x.days_left ?? 0) - (y.days_left ?? 0));
  const shown = rows.slice(0, 15), at = cat.stockAt ?? cat.at ?? null;
  if (shown.length) emit({ type: "proposal", proposal: { id: cardId("s"), kind: "stock_list", storage: zone, at,
    rows: shown.map((r) => ({ item: r.item, qty: r.qty, unit: r.unit, days: r.days_left, empty: r.empty })), more: Math.max(0, rows.length - 15) } });
  return {
    storage: zone, low: shown, more: rows.length > 15 ? rows.length - 15 : undefined,
    stock_read_at: erbilTime(at), read_minutes_ago: minutesSince(at),
    how: `Low means empty, or less than ${LOW_DAYS} days left at the pace it left ${zone} over the last ${USE_DAYS} days.`,
    note: shown.length ? CARD_NOTE + " You may offer a transfer draft for one of them." : `Nothing is low in ${zone}.`,
  };
}

/* ---------- price_history ---------- */
export async function priceHistory(db: any, w: any, a: any) {
  if (!w.can.receipts) return NO_RECEIPTS;
  const days = Math.max(1, Math.min(Math.floor(Number(a.days) || MAX_DAYS), MAX_DAYS));
  const limit = Math.max(1, Math.min(Math.floor(Number(a.limit) || 8), 20));
  const today = erbilDay(), from = addDays(today, -(days - 1));
  const [rows, cat] = await Promise.all([savedReceipts(db, dayStart(from)), withTimeout<any>(catalogOf(db), "catalog")]);
  const names = [...((cat.items ?? []) as any[]).map((i) => i.name), ...rows.flatMap((r) => (r.lines ?? []).map((l: any) => l.item))];
  const p: any = pickName(names, a.item, aliasMap(w));
  if (!p.name) return notFound("item", a.item, p);
  const entries: any[] = [];
  for (const r of rows) {
    if (a.supplier && !has(r.supplier, a.supplier)) continue;
    for (const l of r.lines ?? []) {
      if (l?.item !== p.name || !(Number(l.cost) > 0)) continue;
      entries.push({ day: dayOf(r.saved_at), at: r.saved_at, supplier: r.supplier, invoice: r.invoice, unit: l.unit, qty: Number(l.qty), cost: Number(l.cost), currency: r.currency });
    }
  }
  if (!entries.length) return { item: p.name, period: `${from} to ${today}`, note: `No saved receipt has ${p.name}${a.supplier ? ` from "${str(a.supplier, 60)}"` : ""} in the last ${days} days.` };
  // Newest first; one line per supplier, unit and currency (prices in different units are never compared).
  const groups = new Map<string, any[]>();
  for (const e of entries) { const k = `${e.supplier}|${e.unit}|${e.currency}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  const bySupplier = [...groups.values()].map((g) => {
    const last = g[0], prev = g[1] ?? null, costs = g.map((e) => e.cost);
    return {
      supplier: last.supplier, unit: last.unit, currency: last.currency, receipts: g.length,
      last_price: last.cost, last_day: last.day, previous_price: prev?.cost ?? null,
      change_pct: prev ? Math.round((last.cost - prev.cost) / prev.cost * 1000) / 10 : null,
      min: Math.min(...costs), max: Math.max(...costs),
    };
  }).sort((x, y) => String(y.last_day).localeCompare(String(x.last_day))).slice(0, 10);
  return {
    item: p.name, period: `${from} to ${today}`, by_supplier: bySupplier,
    latest_receipts: entries.slice(0, limit).map((e) => ({ day: e.day, supplier: e.supplier, invoice: e.invoice, qty: e.qty, unit: e.unit, cost: e.cost, currency: e.currency })),
  };
}

/* ---------- spending_summary ---------- */
export async function spendingSummary(db: any, w: any, a: any, emit: Emit = noEmit) {
  if (!w.can.receipts) return NO_RECEIPTS;
  const per: any = periodOf(a);
  if (per.error) return { error: per.error };
  const by = a.by === "item" ? "item" : a.by === "none" ? "none" : "supplier";
  const rows = (await savedReceipts(db, dayStart(per.from))).filter((r) => {
    const d = dayOf(r.saved_at)!;
    return d >= per.from && d <= per.to && (!a.supplier || has(r.supplier, a.supplier));
  });
  const total = { IQD: 0, USD: 0 }, delivery = { IQD: 0 };
  const groups = new Map<string, { name: string; receipts: Set<string>; IQD: number; USD: number; qty: Record<string, number> }>();
  const group = (k: string) => groups.get(k) ?? groups.set(k, { name: k, receipts: new Set(), IQD: 0, USD: 0, qty: {} }).get(k)!;
  for (const r of rows) {
    const cur = r.currency === "USD" ? "USD" : "IQD";
    const t = R.totals({ ...r, currency: cur, rate: Number(r.rate) || 0, delivery: Number(r.delivery) || 0 });
    total[cur] += t.total;
    if (cur === "IQD") delivery.IQD += t.delivery;
    if (by === "supplier") { const g = group(r.supplier || "No supplier"); g.receipts.add(r.id); g[cur] += t.total; }
    if (by === "item") for (const l of r.lines ?? []) {
      if (!l?.item) continue;
      const g = group(l.item);
      g.receipts.add(r.id); g[cur] += R.lineTotal(l, cur);
      if (Number(l.qty) > 0 && l.unit) g.qty[l.unit] = round3((g.qty[l.unit] ?? 0) + Number(l.qty));
    }
  }
  const list = [...groups.values()].sort((x, y) => y.IQD - x.IQD || y.USD - x.USD);
  const shown = list.slice(0, 15).map((g) => ({
    [by]: g.name, receipts: g.receipts.size,
    ...(g.IQD ? { IQD: money(g.IQD, "IQD") } : {}), ...(g.USD ? { USD: money(g.USD, "USD") } : {}),
    ...(by === "item" ? { qty: g.qty } : {}),
  }));
  if (rows.length) emit({ type: "proposal", proposal: { id: cardId("m"), kind: "spend", period: per.label, by, receipts: rows.length,
    IQD: money(total.IQD, "IQD"), USD: money(total.USD, "USD"),
    rows: by === "none" ? [] : list.slice(0, 6).map((g) => ({ name: g.name, receipts: g.receipts.size, IQD: money(g.IQD, "IQD"), USD: money(g.USD, "USD") })) } });
  return {
    period: per.label, receipts: rows.length,
    total_IQD: money(total.IQD, "IQD"), total_USD: money(total.USD, "USD"),
    ...(delivery.IQD ? { of_which_delivery_IQD: money(delivery.IQD, "IQD") } : {}),
    ...(by === "none" ? {} : { [`by_${by}`]: shown, more: list.length > 15 ? list.length - 15 : undefined }),
    note: rows.length ? "IQD and USD are separate; never add them together. " + CARD_NOTE : "No saved receipts in that period.",
  };
}

/* ---------- transfers_summary ---------- */
export async function transfersSummary(db: any, w: any, a: any) {
  if (!w.can.transfers) return NO_TRANSFERS;
  const per: any = periodOf(a);
  if (per.error) return { error: per.error };
  const by = a.by === "item" ? "item" : a.by === "both" ? "both" : "storage";
  const { data, error } = await withTimeout<any>(db.from("app_rr_transfers").select("id,from_zone,to_zone,lines,for_day,moved_at,mode")
    .eq("status", "moved").gte("moved_at", dayStart(per.from)).order("moved_at", { ascending: false }).limit(1000), "transfers");
  if (error) throw new Error("transfers_unavailable");
  let rows = ((data ?? []) as any[]).filter((r) => {
    const d = r.for_day || dayOf(r.moved_at);
    return r.mode !== "practice" && d && d >= per.from && d <= per.to && (!a.storage || has(r.to_zone, a.storage) || has(r.from_zone, a.storage));
  });
  let item: string | null = null;
  if (a.item) {
    const p: any = pickName(rows.flatMap((r) => (r.lines ?? []).map((l: any) => l.item)), a.item, aliasMap(w));
    if (!p.name) return p.ambiguous ? notFound("item", a.item, p) : { period: per.label, note: `No moved transfer has "${str(a.item, 60)}" in that period.` };
    item = p.name;
    rows = rows.filter((r) => (r.lines ?? []).some((l: any) => l.item === item));
  }
  const add = (m: Record<string, number>, l: any) => { if (Number(l.qty) > 0 && l.unit) m[l.unit] = round3((m[l.unit] ?? 0) + Number(l.qty)); };
  const toStorage = new Map<string, { transfers: number; items: Map<string, Record<string, number>> }>();
  const perItem = new Map<string, { total: Record<string, number>; to: Map<string, Record<string, number>> }>();
  for (const r of rows) {
    const s = toStorage.get(r.to_zone) ?? toStorage.set(r.to_zone, { transfers: 0, items: new Map() }).get(r.to_zone)!;
    s.transfers++;
    for (const l of r.lines ?? []) {
      if (!l?.item || (item && l.item !== item)) continue;
      add(s.items.get(l.item) ?? s.items.set(l.item, {}).get(l.item)!, l);
      const e = perItem.get(l.item) ?? perItem.set(l.item, { total: {}, to: new Map() }).get(l.item)!;
      add(e.total, l); add(e.to.get(r.to_zone) ?? e.to.set(r.to_zone, {}).get(r.to_zone)!, l);
    }
  }
  const out: any = { period: per.label, transfers: rows.length, ...(item ? { item } : {}) };
  if (by !== "item") out.by_storage = [...toStorage.entries()].sort((x, y) => y[1].transfers - x[1].transfers).slice(0, 12)
    .map(([to, s]) => ({ to, transfers: s.transfers, items: [...s.items.entries()].slice(0, 15).map(([name, qty]) => ({ item: name, qty })), more_items: s.items.size > 15 ? s.items.size - 15 : undefined }));
  if (by !== "storage") out.by_item = [...perItem.entries()].sort((x, y) => y[1].to.size - x[1].to.size).slice(0, 20)
    .map(([name, e]) => ({ item: name, total: e.total, to: Object.fromEntries([...e.to.entries()].slice(0, 8)) }));
  if (!rows.length) out.note = "No moved transfers in that period.";
  else out.note = "Amounts are per unit as moved; different units are never added together.";
  return out;
}

/* ---------- price_changes ---------- */
export async function priceChanges(db: any, w: any, a: any, emit: Emit = noEmit) {
  if (!w.can.receipts) return NO_RECEIPTS;
  const days = Math.max(1, Math.min(Math.floor(Number(a.days) || 30), MAX_DAYS));
  const pct = Number(a.threshold_pct);
  const threshold = Number.isFinite(pct) && pct >= 0 && pct <= 1000 ? pct : 10;
  const today = erbilDay(), from = addDays(today, -(days - 1));
  // The previous price may be older than the window, so all 60 kept days are read.
  const rows = await savedReceipts(db, dayStart(addDays(today, -(MAX_DAYS - 1))));
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    if (a.supplier && !has(r.supplier, a.supplier)) continue;
    for (const l of r.lines ?? []) {
      if (!l?.item || !(Number(l.cost) > 0)) continue;
      const k = `${r.supplier}|${l.item}|${l.unit}|${r.currency}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push({ day: dayOf(r.saved_at), supplier: r.supplier, item: l.item, unit: l.unit, currency: r.currency, cost: Number(l.cost) });
    }
  }
  const changes: any[] = [];
  for (const g of groups.values()) {
    const [last, prev] = g;   // newest first
    if (!prev || last.day < from) continue;
    const change = (last.cost - prev.cost) / prev.cost * 100;
    if (Math.abs(change) <= threshold) continue;
    changes.push({ item: last.item, supplier: last.supplier, unit: last.unit, currency: last.currency, previous_price: prev.cost, previous_day: prev.day, latest_price: last.cost, latest_day: last.day, change_pct: Math.round(change * 10) / 10 });
  }
  changes.sort((x, y) => Math.abs(y.change_pct) - Math.abs(x.change_pct));
  if (changes.length) emit({ type: "proposal", proposal: { id: cardId("p"), kind: "price_list",
    rows: changes.slice(0, 10).map((c) => ({ item: c.item, supplier: c.supplier, unit: c.unit, currency: c.currency, from: c.previous_price, to: c.latest_price, pct: c.change_pct })), more: Math.max(0, changes.length - 10) } });
  return {
    period: `${from} to ${today}`, threshold_pct: threshold, found: changes.length, changes: changes.slice(0, 20),
    note: changes.length ? CARD_NOTE + (changes.length > 20 ? "Only the 20 biggest changes are listed." : undefined) : `No price changed by more than ${threshold}% in that time.`,
  };
}

/* ---------- needs_attention ---------- */
const RUNNING_R = ["queued", "filling", "approved", "saving"], RUNNING_T = ["queued", "filling", "approved", "moving"];
function attentionReason(r: any, running: string[], who: string) {
  const mins = minutesSince(r.updated_at) ?? 0, practice = r.mode === "practice" ? " (practice run)" : "";
  if (r.status === "problem") return `Stopped${practice}: ${str(r.problem, 160) || "Rico stopped. See his notes."}`;
  if (r.status === "review") return `Waiting for a person to check Rico's photo and approve it${practice} (${mins} min).`;
  if (running.includes(r.status) && mins > STUCK_MINUTES) return `${r.status === "queued" ? "Waiting for Rico to start it" : `Rico is on it (${r.status})`} for ${mins} min${practice}, longer than usual. Check that Rico is running on the Mac.`;
  if (r.status === "draft" && r.created_by === who && Date.now() - Date.parse(r.created_at) > 86400_000 && (r.lines ?? []).some((l: any) => l?.item))
    return `A draft not sent since ${dayOf(r.created_at)}.`;
  return null;
}
export async function needsAttention(db: any, w: any, emit: Emit = noEmit) {
  if (!w.can.receipts && !w.can.transfers) return { error: "no_access", note: "This person can't open Receipts or Transfers. Say so briefly." };
  const since = new Date(Date.now() - MAX_DAYS * 86400_000).toISOString();
  const open = ["draft", "queued", "filling", "review", "approved", "saving", "moving", "problem"];
  const [rec, tra] = await Promise.all([
    w.can.receipts ? withTimeout<any>(db.from("app_rr_receipts").select("id,status,supplier,invoice,lines,problem,created_by,created_at,updated_at,mode")
      .in("status", open).gte("created_at", since).order("updated_at", { ascending: false }).limit(300), "receipts") : null,
    w.can.transfers ? withTimeout<any>(db.from("app_rr_transfers").select("id,status,from_zone,to_zone,lines,problem,created_by,created_at,updated_at,mode")
      .in("status", open).gte("created_at", since).order("updated_at", { ascending: false }).limit(300), "transfers") : null,
  ]);
  if (rec?.error || tra?.error) throw new Error("records_unavailable");
  const out: any = {};
  if (rec) {
    const list = ((rec.data ?? []) as any[]).map((r) => ({ r, why: attentionReason(r, RUNNING_R, w.account) })).filter((x) => x.why);
    out.receipts = list.slice(0, 15).map(({ r, why }) => ({ receipt_id: r.id, supplier: r.supplier, invoice: r.invoice, status: r.status, day: dayOf(r.created_at), why }));
    if (list.length > 15) out.more_receipts = list.length - 15;
  }
  if (tra) {
    const list = ((tra.data ?? []) as any[]).map((r) => ({ r, why: attentionReason(r, RUNNING_T, w.account) })).filter((x) => x.why);
    out.transfers = list.slice(0, 15).map(({ r, why }) => ({ transfer_id: r.id, from: r.from_zone, to: r.to_zone, status: r.status, day: dayOf(r.created_at), why }));
    if (list.length > 15) out.more_transfers = list.length - 15;
  }
  const n = (out.receipts?.length ?? 0) + (out.transfers?.length ?? 0);
  const level = (why: string) => why.startsWith("Stopped") ? "stop" : why.startsWith("Waiting for a person") ? "wait" : why.startsWith("A draft") ? "old" : "stuck";
  const rank: Record<string, number> = { stop: 0, wait: 1, stuck: 2, old: 3 };
  const rows = [
    ...(out.receipts ?? []).map((r: any) => ({ type: "receipt", id: r.receipt_id, title: [r.supplier, r.invoice ? `#${r.invoice}` : ""].filter(Boolean).join(" "), why: r.why, level: level(r.why) })),
    ...(out.transfers ?? []).map((r: any) => ({ type: "transfer", id: r.transfer_id, title: `${r.from ?? ""} > ${r.to ?? ""}`, why: r.why, level: level(r.why) })),
  ].sort((x, y) => rank[x.level] - rank[y.level]).slice(0, 12);
  if (n) emit({ type: "proposal", proposal: { id: cardId("n"), kind: "needs_list", rows } });
  out.note = n ? CARD_NOTE + " Say what needs doing, most important first (stopped, then waiting for approval, then stuck, then old drafts)." : "Nothing needs attention right now.";
  return out;
}

/* ---------- propose_transfer_draft ---------- */
/* What a transfer check code means, in plain words. */
function checkWords(c: any, lines: any[], from: string) {
  const l = c.line ? lines[c.line - 1] : null, it = l ? `${l.item}` : "";
  switch (c.code) {
    case "from": return "Which storage should it come from?";
    case "fromUnknown": return `"${from}" is not one of the storages.`;
    case "to": return "Which storage should it go to?";
    case "toUnknown": return "The storage it goes to is not one of the storages.";
    case "sameZone": return "From and to are the same storage.";
    case "noLines": return "No items.";
    case "tooManyLines": return `At most ${T.MAX_LINES} items.`;
    case "itemUnknown": return `Line ${c.line}: the item is not in Ricotta Restaurant's list.`;
    case "unitUnknown": return `${it}: "${l?.unit}" is not one of its units.`;
    case "unitUnclear": return `${it}: the unit "${c.unit}" has two sizes in Ricotta Restaurant and can't be used. Choose another unit.`;
    case "qty": return `${it}: the amount must be more than 0, with at most 3 decimals.`;
    case "qtyTooBig": return `${it}: the amount is too big.`;
    case "notEnough": return `${it}: only ${c.have.qty} ${c.have.unit} in ${from}, but ${c.need.qty} ${c.need.unit} was asked.`;
    case "allStock": return `${it}: this is all of it in ${from} (${c.have.qty} ${c.have.unit}).`;
    case "unusual": return `${it}: about ${c.times} times the usual amount${c.zone ? ` for ${c.zone}` : ""} (usually ${c.usual.qty} ${c.usual.unit}).`;
    case "unusualLow": return `${it}: much less than ${c.zone} usually gets (usually ${c.usual.qty} ${c.usual.unit}).`;
    case "newRoute": return `${it}: never sent to ${c.to} before${c.usualTo?.length ? ` (usually to ${c.usualTo.join(", ")})` : ""}.`;
    case "yesterday": return "It will be recorded for yesterday.";
    default: return String(c.code);
  }
}
export async function proposeTransferDraft(db: any, w: any, a: any, emit: Emit) {
  if (!w.can.transfers) return NO_TRANSFERS;
  if ((w.transferDrafts ?? 0) >= DRAFTS_PER_REPLY) return { error: "limit", note: `At most ${DRAFTS_PER_REPLY} transfer drafts in one reply. Ask them to check the ones already prepared.` };
  const asked = Array.isArray(a.lines) ? a.lines : [];
  if (!asked.length) return { error: "Which items and how much? Ask first." };
  if (asked.length > T.MAX_LINES) return { error: `At most ${T.MAX_LINES} items in one transfer.` };
  const cat: any = await withTimeout(catalogOf(db), "catalog");
  const zones: string[] = T.zonesOf(cat), titems: any[] = cat.titems ?? [];
  if (!zones.length || !titems.length) return { error: "no_stock", note: "Rico has not read the storages and stock from Ricotta Restaurant yet. Nothing was prepared." };
  const fromP: any = pickName(zones, a.from), toP: any = pickName(zones, a.to);
  if (!fromP.name) return { ...notFound("storage", a.from, fromP), storages: zones, prepared: false };
  if (!toP.name) return { ...notFound("storage", a.to, toP), storages: zones, prepared: false };
  const aliases = aliasMap(w), problems: string[] = [], lines: any[] = [];
  for (const l of asked) {
    const p: any = pickName(titems.map((i) => i.name), l?.item, aliases);
    if (!p.name) { problems.push(p.ambiguous ? `"${str(l?.item, 60)}" could be: ${p.candidates.join(", ")}` : `"${str(l?.item, 60)}" is not in Ricotta Restaurant's items`); continue; }
    const item = titems.find((i) => i.name === p.name);
    const opts: string[] = T.unitOptions(item).map((o: any) => o.name);
    // The unit written is used, or its other spelling (kg = کیلۆ); never a different unit. None written: the counting unit.
    const unit = l?.unit ? search.unit(opts, str(l.unit, 80)) : opts[0];
    if (!unit) { problems.push(`${item.name}: "${str(l?.unit, 40)}" is not one of its units (${opts.join(", ") || "none"})`); continue; }
    const qty = typeof l?.qty === "number" ? l.qty : Number(String(l?.qty ?? "").replace(",", "."));
    lines.push({ item: item.name, unit, qty: Number.isFinite(qty) ? qty : null });
  }
  if (problems.length) return { error: "invalid_lines", problems, prepared: false, note: "Nothing was prepared. Tell them what is wrong and ask." };
  const draft = cleanDraft({ from: fromP.name, to: toP.name, yesterday: a.yesterday === true, lines });
  const c = T.check({ from: draft.from_zone, to: draft.to_zone, yesterday: draft.yesterday, lines: draft.lines }, cat, await withTimeout(usualAmounts(db), "usual"));
  if (c.errors.length) return { error: "cannot_prepare", problems: c.errors.map((e: any) => checkWords(e, draft.lines, fromP.name)), prepared: false, note: "Nothing was prepared. Tell them why in one or two lines." };
  const warnings = c.warnings.map((e: any) => checkWords(e, draft.lines, fromP.name));
  // Saved exactly as the app's own PUT transfers/<id> saves a new draft: this person's, status draft.
  const { data: row, error } = await withTimeout<any>(db.from("app_rr_transfers").insert({
    id: crypto.randomUUID(), created_by: w.account, source: "app", status: "draft", ...draft,
    log: [logEntry("Prepared by Rico in the chat", w.account)],
  }).select("id,status,from_zone,to_zone,yesterday,lines").maybeSingle(), "transfer_draft");
  if (error || !row || row.status !== "draft") return { error: "not_saved", prepared: false, note: "The draft could not be saved. Say so; nothing was sent." };
  w.acted = true;   // a row now exists: the reply is never started again with another AI (no second draft)
  w.transferDrafts = (w.transferDrafts ?? 0) + 1;
  emit({ type: "proposal", proposal: {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: "transfer_draft", transferId: row.id,
    from: row.from_zone, to: row.to_zone, yesterday: !!row.yesterday, lines: draft.lines, warnings: warnings.slice(0, 8),
  } });
  return {
    prepared: true, transfer_id: row.id, status: "draft", from: row.from_zone, to: row.to_zone, lines: draft.lines.map((l: any) => `${l.item}: ${l.qty} ${l.unit}`),
    warnings, stock_read_at: erbilTime(cat.stockAt ?? cat.at),
    what_happens: "A draft is saved in Transfers, for this person only. Nothing moves until they open it, check it, send it to Rico and approve his photo. The card has an Open in Transfers button. Mention any warnings in one line.",
  };
}

export const RICO_RR_TOOLS = [
  { name: "low_stock", description: "What is running low in one storage (Main Storage unless named): empty items and items with less than 3 days left at their usual pace. Shows a card with the list.",
    input_schema: { type: "object", properties: { storage: { type: "string", description: "Optional: one storage" } } } },
  { name: "stock_levels", description: "How much of an item is in each storage (or one storage) in Ricotta Restaurant, from the stock Rico last read, and when it was read. Item name in any language; typos are fine.",
    input_schema: { type: "object", properties: { item: { type: "string" }, storage: { type: "string", description: "Optional: one storage" } }, required: ["item"] } },
  { name: "price_history", description: "An item's unit cost over time from saved receipts: per supplier and unit the last price, previous price, change, min and max, plus the latest receipts.",
    input_schema: { type: "object", properties: { item: { type: "string" }, supplier: { type: "string" }, days: { type: "integer", description: "1-60, default 60" }, limit: { type: "integer", description: "Latest receipts to list, default 8, at most 20" } }, required: ["item"] } },
  { name: "spending_summary", description: "Totals of saved receipts for a period, IQD and USD separately, with the number of receipts, by supplier (default), by item or none.",
    input_schema: { type: "object", properties: { period: { type: "string", enum: ["today", "yesterday", "week", "month", "custom"], description: "week = last 7 days, month = this calendar month" }, from: { type: "string", description: "YYYY-MM-DD for custom" }, to: { type: "string", description: "YYYY-MM-DD for custom" }, by: { type: "string", enum: ["supplier", "item", "none"] }, supplier: { type: "string" } }, required: ["period"] } },
  { name: "transfers_summary", description: "Moved transfers for a period: by destination storage (default), by item or both, with amounts per unit. Optional storage or item filter.",
    input_schema: { type: "object", properties: { period: { type: "string", enum: ["today", "yesterday", "week", "month", "custom"] }, from: { type: "string" }, to: { type: "string" }, by: { type: "string", enum: ["storage", "item", "both"] }, storage: { type: "string" }, item: { type: "string" } }, required: ["period"] } },
  { name: "price_changes", description: "Items whose latest price differs from the previous one by more than threshold_pct (default 10) in the last N days (default 30, at most 60), per supplier and unit.",
    input_schema: { type: "object", properties: { days: { type: "integer" }, threshold_pct: { type: "number" }, supplier: { type: "string" } } } },
  { name: "needs_attention", description: "Receipts and transfers that need a person: stopped (problem), waiting for approval, stuck in progress over 15 minutes, or this person's drafts older than a day, each with a plain reason.",
    input_schema: { type: "object", properties: {} } },
  { name: "propose_transfer_draft", description: "PREPARES a transfer between two storages as a draft in Transfers (never sends or moves anything) and shows a card with an Open in Transfers button. Names, units and stock are checked first; if something is wrong nothing is saved. Ask for missing storages, items or amounts first.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { item: { type: "string" }, qty: { type: "number" }, unit: { type: "string", description: "Optional; default is the item's counting unit" } }, required: ["item", "qty"] } }, yesterday: { type: "boolean", description: "Record it for yesterday" } }, required: ["from", "to", "lines"] } },
];

export const RICO_RR_MANUAL = `- "What is low / running out / what should I move" -> low_stock (a card lists the items).
- Stock: "how much X is in Pizza/Main Storage" -> stock_levels. Say when the stock was read.
- Prices: "what did we pay for X", "has X gone up" -> price_history. "which prices went up/changed" -> price_changes.
- Spending: "how much did we spend today/this week/this month, by supplier or item" -> spending_summary. Give IQD and USD separately, never added together.
- Transfers: "what went to Pizza this week", "how much X was moved" -> transfers_summary.
- "What needs me", "anything stuck or waiting" -> needs_attention. Most important first, one line each.
- "Move 5 kg X from Main Storage to Pizza" -> propose_transfer_draft. It only saves a draft; the person opens it in Transfers, sends it and approves. Never say it was moved or sent.
- Receipts are never made by you: they are filled and approved by a person, one at a time, in Receipts.`;

export async function runRrTool(db: any, w: any, name: string, a: any, emit: Emit): Promise<unknown> {
  switch (name) {
    case "low_stock": return await lowStock(db, w, a, emit);
    case "stock_levels": return await stockLevels(db, w, a);
    case "price_history": return await priceHistory(db, w, a);
    case "spending_summary": return await spendingSummary(db, w, a, emit);
    case "transfers_summary": return await transfersSummary(db, w, a);
    case "price_changes": return await priceChanges(db, w, a, emit);
    case "needs_attention": return await needsAttention(db, w, emit);
    case "propose_transfer_draft": return await proposeTransferDraft(db, w, a, emit);
  }
  return undefined;
}
