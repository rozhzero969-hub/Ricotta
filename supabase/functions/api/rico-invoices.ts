// Rico's Invoices skill: every invoice in Ricotta Restaurant (app_rr_invoices, read by the server's own
// reader, rr-reader.ts), not only the ones Rico entered.
//   invoice_report: a month (all suppliers or one): totals and a card with Download PDF / Excel (the app
//     makes the files from GET rr-invoices).
//   price_lookup: the last price paid for items found by name (any language, typos) or for a storage's
//     items (moved there in the last 60 days, plus name matches), with the unit it was bought in.
// Only reads. Never invents a price: what is not in the invoices is said so.
import "../_shared/search.js";
import "../_shared/recipe-cost.js";
import { catalogOf } from "./receipts.ts";
import { readMonthNow, erbilDay, prevMonth } from "./rr-reader.ts";

type Emit = (event: Record<string, unknown>) => void;
const search = (globalThis as any).RicottaSearch;
const T = (globalThis as any).RicottaTransfers;
const RC = (globalThis as any).RicottaRecipeCost;
const NO_ACCESS = { error: "no_access", note: "This person can't open Receipts or Transfers. Say so briefly." };
const cardId = (k: string) => `${k}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, cur: string) => (cur === "USD" ? r2(n) : Math.round(n));

export const monthOf = (v: unknown, today = erbilDay()) => {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return today.slice(0, 7);
};
const monthEnd = (month: string) => { const [y, m] = month.split("-").map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

/* The month's invoices, read from Ricotta Restaurant first when none are kept yet. */
export async function invoicesFor(db: any, months: string[], read = readMonthNow) {
  const out: any[] = [];
  let notSetUp = false;
  for (const month of months) {
    const q = () => db.from("app_rr_invoices").select("id,entry_date,invoice_number,supplier_name,currency,rate,total,delivery_fee,paid,lines,read_at")
      .gte("entry_date", `${month}-01`).lte("entry_date", monthEnd(month)).limit(3000);
    let { data, error } = await q();
    if (error) throw error;
    if (!(data ?? []).length && month <= erbilDay().slice(0, 7)) {
      const r: any = await read(db, month, { catalogOf });
      if (r?.error === "not_set_up") notSetUp = true;
      else ({ data, error } = await q());
      if (error) throw error;
    }
    out.push(...(data ?? []));
  }
  // Every amount in IQD (a USD receipt is kept in IQD by Ricotta Restaurant; marked paid_in USD).
  return { rows: RC ? RC.invoicesInIqd(out) : out, notSetUp };
}

/* ---------- invoice_report ---------- */
export function reportTotals(rows: any[]) {
  const sup = new Map<string, { name: string; receipts: number; IQD: number; USD: number }>();
  const tot = { receipts: rows.length, IQD: 0, USD: 0, deliveryIQD: 0, deliveryUSD: 0, unpaid: 0 };
  for (const r of rows) {
    const cur = r.currency === "USD" ? "USD" : "IQD", total = Number(r.total) || 0;
    tot[cur] += total;
    if (cur === "USD") tot.deliveryUSD += Number(r.delivery_fee) || 0; else tot.deliveryIQD += Number(r.delivery_fee) || 0;
    if (!r.paid) tot.unpaid++;
    const s = sup.get(r.supplier_name) ?? { name: r.supplier_name || "No supplier", receipts: 0, IQD: 0, USD: 0 };
    s.receipts++; s[cur] += total; sup.set(r.supplier_name, s);
  }
  const suppliers = [...sup.values()].sort((a, b) => b.IQD - a.IQD || b.USD - a.USD).map((s) => ({ ...s, IQD: money(s.IQD, "IQD"), USD: money(s.USD, "USD") }));
  return { ...tot, IQD: money(tot.IQD, "IQD"), USD: money(tot.USD, "USD"), deliveryIQD: money(tot.deliveryIQD, "IQD"), deliveryUSD: money(tot.deliveryUSD, "USD"), suppliers };
}
export async function invoiceReport(db: any, w: any, a: any, emit: Emit, read = readMonthNow) {
  if (!w.can.receipts && !w.can.transfers) return NO_ACCESS;
  const month = monthOf(a?.month);
  const { rows: all, notSetUp } = await invoicesFor(db, [month], read);
  if (notSetUp) return { error: "not_set_up", note: "The server can't read Ricotta Restaurant yet: Rozh needs to add the Ricotta Restaurant PIN in Supabase secrets (RR_PIN, RR_BRANCH). Say so in one line." };
  const want = String(a?.supplier ?? "").trim();
  const rows = want ? all.filter((r: any) => search.normalize(r.supplier_name).includes(search.normalize(want)) || Number.isFinite(search.score(want, [r.supplier_name], true))) : all;
  if (!rows.length) return { month, receipts: 0, note: want ? `No invoices from "${want}" in ${month}. Say so.` : `No invoices in ${month}. Say so.` };
  const tot = reportTotals(rows);
  emit({ type: "proposal", proposal: { id: cardId("v"), kind: "invoice_report", month, supplier: want || null, receipts: tot.receipts, IQD: tot.IQD, USD: tot.USD,
    deliveryIQD: tot.deliveryIQD, unpaid: tot.unpaid, suppliers: tot.suppliers.slice(0, 6), more: Math.max(0, tot.suppliers.length - 6) } });
  return { month, receipts: tot.receipts, total_IQD: tot.IQD, total_USD: tot.USD, suppliers: tot.suppliers.slice(0, 12),
    note: "A card shows the totals with Download PDF and Download Excel (every receipt with its lines, supplier totals, item prices and charts). Say it in one or two lines; never list every receipt." };
}

/* ---------- price_lookup ---------- */
/* The last price per item from invoice lines (newest invoice first), with the unit it was bought in and
   how many times it was bought; also the last price in each other unit it came in. Every price is in IQD:
   a USD receipt's lines are turned into IQD at its rate (_shared/recipe-cost.js iqdFactor, the same rule
   the Recipes and Items prices use), and marked paid_in USD. */
export function lastPrices(rows: any[], keep: (item: string) => boolean) {
  const sorted = [...rows].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || String(b.read_at ?? "").localeCompare(String(a.read_at ?? "")) || String(b.invoice_number).localeCompare(String(a.invoice_number), undefined, { numeric: true }));
  const known = sorted.find((r) => r?.currency === "USD" && Number(r.rate) > 0);
  const fallback = known ? Number(known.rate) : RC?.DEFAULT_RATE;
  const by = new Map<string, any>();
  for (const r of sorted) {
    const f = RC ? RC.iqdFactor(r, fallback) : 1, usd = r.currency === "USD" || r.paid_in === "USD";
    for (const l of r.lines ?? []) {
      if (!l?.item || !keep(l.item) || !(Number(l.unit_cost) > 0)) continue;
      const price = money(Number(l.unit_cost) * f, "IQD"), x = by.get(l.item);
      if (!x) by.set(l.item, { item: l.item, unit: l.unit || "", price, currency: "IQD", ...(usd ? { paid_in: "USD" } : {}), day: r.entry_date, supplier: r.supplier_name, times: 1, units: { [l.unit || ""]: price } });
      else { x.times++; if (!((l.unit || "") in x.units)) x.units[l.unit || ""] = price; }
    }
  }
  return [...by.values()].map((x) => ({ ...x, otherUnits: Object.entries(x.units).filter(([u]) => u !== x.unit).map(([unit, price]) => ({ unit, price })) }))
    .map(({ units, ...x }) => x);
}
export async function priceLookup(db: any, w: any, a: any, emit: Emit, read = readMonthNow) {
  if (!w.can.receipts && !w.can.transfers) return NO_ACCESS;
  const query = String(a?.query ?? "").trim().slice(0, 120), storageAsked = String(a?.storage ?? "").trim().slice(0, 80);
  if (!query && !storageAsked) return { error: "Ask which items (a name or a kind) or which storage's items." };
  const today = erbilDay(), n = Math.max(1, Math.min(3, Math.floor(Number(a?.months) || 2)));
  const months: string[] = [today.slice(0, 7)];
  while (months.length < n) months.push(prevMonth(`${months[months.length - 1]}-15`));
  const { rows, notSetUp } = await invoicesFor(db, months, read);
  if (notSetUp) return { error: "not_set_up", note: "The server can't read Ricotta Restaurant yet: Rozh needs to add the Ricotta Restaurant PIN in Supabase secrets (RR_PIN, RR_BRANCH). Say so in one line." };
  // A storage's items: the ones moved there in the last 60 days.
  let storage: string | null = null;
  const moved = new Set<string>();
  if (storageAsked) {
    const cat: any = await catalogOf(db);
    const zones: string[] = T?.zonesOf ? T.zonesOf(cat) : cat.zones ?? [];
    const scored = zones.map((z) => ({ z, s: search.score(storageAsked, [z], true) })).filter((x) => Number.isFinite(x.s)).sort((x, y) => x.s - y.s);
    storage = scored[0]?.z ?? null;
    if (!storage) return { error: "not_found", note: `No storage matches "${storageAsked}". Storages: ${zones.join(", ")}. Ask which one.` };
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const { data, error } = await db.from("app_rr_transfers").select("to_zone,lines,mode").eq("status", "moved").eq("to_zone", storage).gte("moved_at", since).limit(1500);
    if (error) throw error;
    for (const t of data ?? []) if (t.mode !== "practice") for (const l of t.lines ?? []) if (l?.item) moved.add(l.item);
  }
  const words = query ? query.split(/[,،]+/).map((x) => x.trim()).filter(Boolean) : [];
  const byName = (item: string) => words.some((q) => search.normalize(item).includes(search.normalize(q)) || Number.isFinite(search.score(q, [item], true)));
  const found = lastPrices(rows, (item) => moved.has(item) || byName(item))
    .map((r) => ({ ...r, source: moved.has(r.item) ? "moved" : "name" }))
    .sort((x, y) => (x.source === y.source ? 0 : x.source === "moved" ? -1 : 1) || x.item.localeCompare(y.item));
  const neverBought = storage ? [...moved].filter((i) => !found.some((f) => f.item === i)).slice(0, 20) : [];
  if (!found.length) return { found: 0, months, note: `No invoice in ${months.join(" and ")} has ${query ? `"${query}"` : `items moved to ${storage}`}. Say so; never guess a price.` };
  const shown = found.slice(0, 60);
  emit({ type: "proposal", proposal: { id: cardId("q"), kind: "price_lookup", query: query || null, storage, months, rows: shown, more: Math.max(0, found.length - 60) } });
  return { found: found.length, months, storage, items: shown.slice(0, 25).map((r) => ({ item: r.item, last_price: r.price, currency: r.currency, ...(r.paid_in ? { paid_in: r.paid_in } : {}), per: r.unit, day: r.day, supplier: r.supplier, times_bought: r.times, found_by: r.source })),
    ...(neverBought.length ? { moved_but_not_bought_in_period: neverBought } : {}),
    note: "A card lists every item with its last price and unit, with Download PDF and Excel. Say it in one or two lines (mention items found by name vs moved to the storage when both are there)." };
}

export const INVOICE_TOOLS = [
  { name: "invoice_report", description: "Every invoice in Ricotta Restaurant for a month (all suppliers, or one supplier): totals per supplier, IQD and USD separately. Shows a card with Download PDF and Download Excel (every receipt with its lines, item prices, charts). Use for 'make me a report/PDF/Excel of this month's (or October's) receipts/invoices'.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM, default this month" }, supplier: { type: "string", description: "Optional: one supplier" } } } },
  { name: "price_lookup", description: "The LAST price paid for items, from every invoice in Ricotta Restaurant (this month and last by default): per item the price, the unit it was bought in (per carton, per piece, per kilo...), when, from which supplier and how many times it was bought. Find items by name or kind in any language (query, several separated by commas, e.g. 'sweet coffee ice cream') and/or by storage ('items that usually go to the Minibar' = storage Minibar: items moved there in the last 60 days, plus name matches). Shows a card with Download PDF and Excel.",
    input_schema: { type: "object", properties: { query: { type: "string" }, storage: { type: "string" }, months: { type: "integer", description: "1-3 months back including this one, default 2" } } } },
];
export const INVOICE_MANUAL = `- Invoices (every receipt in Ricotta Restaurant, all suppliers): "report / PDF / Excel of this month's (or October's) invoices" -> invoice_report. "What did we last pay for X", "prices of all sweet coffee ice cream items", "prices of what goes to the Minibar" -> price_lookup (query and/or storage). The last price counts when an item was bought many times. Never invent a price; if it is not in the invoices, say so.`;
