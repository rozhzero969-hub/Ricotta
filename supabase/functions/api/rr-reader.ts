// The server's own reader of Ricotta Restaurant (always on, no Mac needed).
//
// Signs in to Ricotta Restaurant's API with Rozh's PIN (secrets RR_PIN, RR_BRANCH, RR_DEVICE_ID; she adds
// them in Supabase herself) and only READS: the sign-in is the one request that is not a GET.
//   - every 5 minutes: items, units, storages, suppliers and stock, saved as app_rr_catalog exactly the
//     way Rico on the Mac saves them (receipts.ts saveCatalog), once a day also what usually moves
//   - every 15 minutes: this month's invoices, and once a night last month's (app_rr_invoices)
//   - any month on demand (Rico's invoice_report / price_lookup)
// What it did and every problem with its cause go to app_rr_reader (Admin, Cloud Rico). After 15
// minutes of failing, Rozh gets one alert per kind of problem, and one when it works again.
// Called every minute by send-push's tick (POST rr-reader/tick with the cron secret); it decides here
// what is due. Never logs or returns the PIN or the sign-in token.

type Fetch = typeof fetch;
const RR = "https://pos.shaydattendance.com/api/v1";
const CATALOG_EVERY = 5 * 60_000, INVOICES_EVERY = 15 * 60_000, HISTORY_EVERY = 20 * 3600_000;
const HISTORY_DAYS = 28, ALERT_AFTER = 15 * 60_000, LOG_KEEP = 50, LINES_AT_ONCE = 4, PIN_RETRY = 10 * 60_000;
const env = (k: string) => (globalThis as any).Deno?.env?.get?.(k) ?? "";
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TZ_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" });
export const erbilDay = (d = new Date()) => TZ_DAY.format(d);

/* A problem with a plain cause, for Admin and the alert. */
export class ReaderError extends Error {
  kind: string;
  constructor(kind: string, message: string) { super(message); this.kind = kind; }
}
export const PROBLEM_KINDS = ["secrets", "pin", "branch", "down", "timeout", "changed", "write"] as const;

/* What the reader needs to sign in. Missing ones are named (never their values). */
export function readerConfig(get = env) {
  const pin = String(get("RR_PIN") || "").trim(), branch = String(get("RR_BRANCH") || "").trim();
  const device = String(get("RR_DEVICE_ID") || "").trim() || "ricotta-orders-server-reader";
  const missing = [...(!pin ? ["RR_PIN"] : []), ...(!branch ? ["RR_BRANCH"] : [])];
  return { pin, branch, device, missing, ready: !missing.length };
}

/* Signs in (PIN) and reads with the token, signing in again once when Ricotta Restaurant says the
   token is no longer good (401/403). Only GETs after the sign-in. */
export function rrClient(cfg: { pin: string; branch: string; device: string }, opts: { fetch?: Fetch; token?: string | null; onToken?: (t: string) => void } = {}) {
  const f = opts.fetch ?? fetch;
  let token = opts.token ?? null;
  const call = async (path: string, init: RequestInit = {}, ms = 20_000) => {
    try { return await f(RR + path, { ...init, signal: AbortSignal.timeout(ms) }); }
    catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new ReaderError("timeout", "Ricotta Restaurant took too long to answer.");
      throw new ReaderError("down", "Could not reach Ricotta Restaurant (no connection or the site is down).");
    }
  };
  const branchId = async () => {
    const r = await call("/branches", { headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!r.ok) throw new ReaderError(r.status >= 500 ? "down" : "changed", `Ricotta Restaurant's branch list answered ${r.status}.`);
    const j = await r.json().catch(() => null);
    const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.branches) ? j.branches : Array.isArray(j?.items) ? j.items : [];
    const want = cfg.branch.toLowerCase();
    const hit = list.find((b) => String(b?.id ?? "").toLowerCase() === want) ?? list.find((b) => String(b?.name ?? "").trim().toLowerCase() === want)
      ?? (list.length === 1 ? list[0] : null);
    if (!hit?.id) throw new ReaderError("branch", `The branch in RR_BRANCH was not found in Ricotta Restaurant (${list.length} branches there).`);
    return hit.id;
  };
  const signIn = async () => {
    const branch_id = await branchId();
    const r = await call("/auth/pin-login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ pin: cfg.pin, branch_id, device_id: cfg.device }) });
    if (r.status === 401 || r.status === 403 || r.status === 400 || r.status === 422) throw new ReaderError("pin", "Ricotta Restaurant did not accept the PIN in RR_PIN.");
    if (r.status === 429) throw new ReaderError("down", "Ricotta Restaurant asked to wait (too many sign-ins).");
    if (!r.ok) throw new ReaderError(r.status >= 500 ? "down" : "changed", `Ricotta Restaurant's sign-in answered ${r.status}.`);
    const j = await r.json().catch(() => null);
    if (!j?.access_token) throw new ReaderError("changed", "Ricotta Restaurant's sign-in answered without a token (its API may have changed).");
    token = String(j.access_token);
    opts.onToken?.(token);
    return token;
  };
  const get = async (path: string, ms?: number) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!token) await signIn();
      const r = await call(path, { headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "XMLHttpRequest" } }, ms);
      if (r.status === 401 || r.status === 403) { token = null; continue; }
      if (!r.ok) throw new ReaderError(r.status >= 500 ? "down" : "changed", `Ricotta Restaurant answered ${r.status} for ${path.split("?")[0]}.`);
      const j = await r.json().catch(() => undefined);
      if (j === undefined) throw new ReaderError("changed", `Ricotta Restaurant's answer for ${path.split("?")[0]} could not be read.`);
      return j;
    }
    throw new ReaderError("pin", "Ricotta Restaurant kept refusing the sign-in.");
  };
  return { get, signIn, get token() { return token; } };
}

/* Ricotta Restaurant's raw lists turned into what Rico on the Mac sends (helper/rico-helper.mjs
   readCatalog): only active items that were ever bought and not named "-", the item's own counting and
   buying formats, stock per storage in base units, Breakfast storages left out. */
export function catalogBody(raw: { units: any; items: any; suppliers: any; zones: any }) {
  const unitList: any[] = Array.isArray(raw.units?.units) ? raw.units.units : Array.isArray(raw.units) ? raw.units : [];
  const units: Record<string, string> = Object.fromEntries(unitList.map((x) => [x.id, x.name]));
  const zonesRaw = raw.zones;
  const zoneList: any[] = Array.isArray(zonesRaw) ? zonesRaw : zonesRaw?.zones ?? [];
  const supRaw = raw.suppliers;
  const suppliers = (Array.isArray(supRaw) ? supRaw : supRaw?.suppliers ?? []).filter((s: any) => s.is_active !== false).map((s: any) => s.name).filter(Boolean);
  const itemList: any[] = Array.isArray(raw.items?.items) ? raw.items.items : Array.isArray(raw.items) ? raw.items : [];
  const live = itemList.filter((i) => i && i.is_active && i.has_purchase_history && String(i.name ?? "").trim() !== "-");
  const items = live.map((i) => {
    const base = units[i.usage_unit_id] || i.base_unit;
    const list: { name: string; factor: number }[] = [];
    const add = (name: string, factor: unknown) => { const f = Number(factor); if (name && f > 0 && !(name === base && f === 1) && !list.some((u) => u.name === name && u.factor === f)) list.push({ name, factor: f }); };
    add(i.inventory_unit_name, i.inventory_factor_to_base);
    add(i.purchase_unit_name, i.purchase_factor);
    return { name: i.name, base, units: list };
  });
  const titems = live.map((i) => ({
    name: i.name, base: units[i.usage_unit_id] || i.base_unit,
    count: i.inventory_unit_name ? { name: i.inventory_unit_name, factor: Number(i.inventory_factor_to_base) || 1 } : null,
    buy: i.purchase_unit_name ? { name: i.purchase_unit_name, factor: Number(i.purchase_factor) || 1 } : null,
    stock: Object.fromEntries((i.stocks || []).filter((z: any) => z.zone_name && !/breakfast/i.test(z.zone_name)).map((z: any) => [z.zone_name, Number(z.quantity) || 0])),
  }));
  const zones = zoneList.map((z) => z.name).filter((n: string) => n && !/breakfast|بەیانی/i.test(n));
  return { suppliers, zones, items, titems };
}

/* What usually moves and is delivered, from Ricotta Restaurant's stock record (the same as the Mac
   helper's readHistory): per item the number of moves or deliveries, the usual (median) and largest
   amount, and for moves each route ("Main Storage>Pizza"). */
export function historyFrom(rows: [string, string, number, string, string | null, string][], days = HISTORY_DAYS, at = nowIso()) {
  const one = new Map<string, { k: string; item: string; q: number; route: string }>();
  for (const [k, item, q, zone, other, when] of rows) {
    const key = [k, item, zone, other ?? "", when].join("|");
    const x = one.get(key) ?? { k, item, q: 0, route: `${zone}>${other ?? ""}` };
    x.q += q; one.set(key, x);
  }
  const lists: any = { t: {}, p: {} };
  for (const x of one.values()) {
    const e = (lists[x.k][x.item] ??= { qs: [], r: {} });
    e.qs.push(x.q);
    if (x.k === "t") (e.r[x.route] ??= { qs: [] }).qs.push(x.q);
  }
  const stat = (e: any) => { const s = [...e.qs].sort((a: number, b: number) => a - b); return { n: s.length, q: Math.round(s[Math.floor(s.length / 2)] * 1000) / 1000, hi: Math.round(s[s.length - 1] * 1000) / 1000 }; };
  return {
    at, days,
    t: Object.fromEntries(Object.entries(lists.t).map(([n, e]: [string, any]) => [n, { ...stat(e), r: Object.fromEntries(Object.entries(e.r).map(([k, v]) => [k, stat(v)])) }])),
    p: Object.fromEntries(Object.entries(lists.p).map(([n, e]) => [n, stat(e)])),
  };
}
async function readHistory(get: (p: string, ms?: number) => Promise<any>) {
  const since = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString();
  const rows: [string, string, number, string, string | null, string][] = [];
  for (let p = 1; p <= 150; p++) {
    const j = await get(`/inventory/movements?page=${p}&size=200`), ms: any[] = j?.movements || [];
    for (const m of ms) if ((m.movement_type === "transfer_out" || m.movement_type === "purchase_in") && m.created_at >= since)
      rows.push([m.movement_type === "transfer_out" ? "t" : "p", m.item_name, Math.abs(Number(m.quantity)), m.zone_name, m.source, m.created_at]);
    if (!ms.length || !j.has_more || ms[ms.length - 1].created_at < since) break;
    await sleep(150);
  }
  return historyFrom(rows);
}

/* ---------- Invoices ---------- */
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/* One receipt from the summary list, as kept in app_rr_invoices (without its lines). */
export function invoiceRow(r: any) {
  return {
    id: String(r.id), entry_date: String(r.entry_date ?? "").slice(0, 10), invoice_number: String(r.invoice_number ?? "").slice(0, 80),
    supplier_id: r.supplier_id ? String(r.supplier_id) : null, supplier_name: String(r.supplier_name ?? "").slice(0, 200),
    status: String(r.status ?? "").slice(0, 30), currency: r.currency_code === "USD" ? "USD" : "IQD",
    total: money(r.total_amount), delivery_fee: money(r.delivery_fee), paid: r.paid === true, line_count: Math.max(0, Math.floor(money(r.line_count))),
    returned_value: money(r.returned_value), wasted_value: money(r.wasted_value),
  };
}
/* A receipt's lines: the unit it was bought in (Ricotta Restaurant's label, or the item's base unit when
   it has none), how many, the price per unit and the line's total. */
export function invoiceLines(lines: any[], baseOf: (item: string) => string | undefined) {
  return (Array.isArray(lines) ? lines : []).slice(0, 400).map((l) => {
    const item = String(l?.item_name ?? "").slice(0, 200);
    return {
      item_id: l?.inventory_item_id ? String(l.inventory_item_id) : null, item,
      unit: String(l?.unit_label || baseOf(item) || "").slice(0, 40),
      qty: money(l?.quantity), unit_cost: money(l?.unit_cost), line_total: money(l?.line_total),
      returned: money(l?.returned_qty), wasted: money(l?.wasted_qty),
    };
  }).filter((l) => l.item);
}
/* Whether a kept receipt must be read again (new, or changed in Ricotta Restaurant). */
export const invoiceChanged = (kept: any, row: any) => !kept || Number(kept.total) !== row.total || Number(kept.line_count) !== row.line_count
  || kept.status !== row.status || kept.paid !== row.paid || Number(kept.delivery_fee) !== row.delivery_fee;
const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};
export const prevMonth = (day: string) => { const [y, m] = day.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };

/* One month's invoice list compared with what is kept: the receipts whose lines must be read (new or
   changed) and the ones no longer there (cancelled), which are removed. Used by Cloud Rico here and by
   Rico on the Mac (helper/invoices/plan), who reads the list and the lines with his own sign-in. */
export async function planInvoiceMonth(db: any, month: string, list: any) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ReaderError("changed", "That is not a month.");
  if (!Array.isArray(list)) throw new ReaderError("changed", "Ricotta Restaurant's invoice list came back in a shape Rico does not know (its API may have changed).");
  const { from, to } = monthRange(month);
  const pairs = list.slice(0, 2000).map((raw: any) => ({ raw, row: invoiceRow(raw) })).filter(({ row: r }) => r.id && r.entry_date >= from && r.entry_date <= to);
  const rows = pairs.map((p) => p.row);
  const { data: kept, error } = await db.from("app_rr_invoices").select("id,total,line_count,status,paid,delivery_fee").gte("entry_date", from).lte("entry_date", to);
  if (error) throw new ReaderError("write", "Could not read the kept invoices from the app's database.");
  const keptBy = new Map((kept ?? []).map((k: any) => [k.id, k]));
  const todo = pairs.filter((p) => invoiceChanged(keptBy.get(p.row.id), p.row));
  const ids = new Set(rows.map((r) => r.id));
  const gone = (kept ?? []).map((k: any) => k.id).filter((id: string) => !ids.has(id));
  if (gone.length) await db.from("app_rr_invoices").delete().in("id", gone);
  return { month, rows, todo, removed: gone.length };
}
/* Saves receipts with their lines (each: the summary row from Ricotta Restaurant and its lines). */
export async function saveInvoices(db: any, got: { row: any; lines: any }[], baseOf: (item: string) => string | undefined) {
  const rows = got.map(({ row, lines }) => ({ ...invoiceRow(row), lines: invoiceLines(lines, baseOf), read_at: nowIso() })).filter((r) => r.id && r.entry_date);
  if (!rows.length) return 0;
  const { error } = await db.from("app_rr_invoices").upsert(rows);
  if (error) throw new ReaderError("write", "Could not save the invoices in the app's database.");
  return rows.length;
}

/* Reads one month of invoices: the list, then the lines of receipts that are new or changed; receipts
   no longer in the list (cancelled) are removed. Returns counts. */
export async function readInvoiceMonth(db: any, get: (p: string, ms?: number) => Promise<any>, month: string, baseOf: (item: string) => string | undefined) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ReaderError("changed", "That is not a month.");
  const { from, to } = monthRange(month);
  const j = await get(`/purchasing/receipts/summary?status=open&date_from=${from}&date_to=${to}&limit=2000`, 30_000);
  const plan = await planInvoiceMonth(db, month, Array.isArray(j?.rows) ? j.rows : null);
  let read = 0;
  for (let i = 0; i < plan.todo.length; i += LINES_AT_ONCE) {
    const batch = plan.todo.slice(i, i + LINES_AT_ONCE);
    const got = await Promise.all(batch.map(async (p) => ({ row: p.raw, lines: await get(`/purchasing/receipts/${encodeURIComponent(p.row.id)}/lines`) })));
    read += await saveInvoices(db, got, baseOf);
  }
  return { month, receipts: plan.rows.length, read, removed: plan.removed };
}

/* ---------- The tick ---------- */
type Status = { id?: boolean; token?: string | null; last_run_at?: string | null; catalog_ok_at?: string | null; invoices_ok_at?: string | null;
  prev_month_day?: string | null; history_at?: string | null; problem?: any; alerted?: string | null; log?: any[]; counts?: any };

async function status(db: any): Promise<Status> {
  const { data, error } = await db.from("app_rr_reader").select("*").eq("id", true).maybeSingle();
  if (error) throw new ReaderError("write", "Could not read Cloud Rico's state from the app's database.");
  return data ?? { id: true, log: [] };
}
async function setStatus(db: any, patch: Partial<Status>) {
  await db.from("app_rr_reader").upsert({ id: true, ...patch, updated_at: nowIso() });
}
export const baseOfFrom = (cat: any) => { const m = new Map((cat?.titems ?? []).map((i: any) => [i.name, i.base])); return (item: string) => m.get(item) as string | undefined; };

export type TickDeps = {
  db: any; fetch?: Fetch; now?: number; get?: (k: string) => string;
  saveCatalog: (db: any, body: any) => Promise<any>; catalogOf: (db: any) => Promise<any>;
  alert: (kind: string, words: { en: string; ku: string; ar: string }) => Promise<unknown>;
  force?: "catalog" | "invoices" | "all" | null;
};

/* One run: does whatever is due, records it, and alerts when reading has failed for 15+ minutes. */
export async function readerTick(d: TickDeps) {
  const t0 = d.now ?? Date.now(), started = Date.now();
  const cfg = readerConfig(d.get ?? env);
  // Not set up yet: nothing to read and nothing to alert (Admin, Cloud Rico names the missing secrets).
  if (!cfg.ready) return { did: [], problem: null, notSetUp: true };
  const st = await status(d.db);
  // A PIN or branch Ricotta Restaurant refused is tried again every 10 minutes, not every minute
  // (repeated wrong sign-ins could lock the PIN there). Read now still tries at once.
  if (!d.force && st.problem && ["pin", "branch"].includes(st.problem.kind) && st.last_run_at && t0 - Date.parse(st.last_run_at) < PIN_RETRY) {
    return { did: [], problem: st.problem, waiting: true };
  }
  const done: string[] = [];
  let problem: { kind: string; cause: string } | null = null;
  const due = (at: string | null | undefined, every: number) => !at || t0 - Date.parse(at) >= every - 20_000;
  const counts: any = { ...(st.counts ?? {}) };
  try {
    const client = rrClient(cfg, { fetch: d.fetch, token: st.token ?? null, onToken: (tok) => { st.token = tok; } });
    const patch: Partial<Status> = {};
    if (d.force === "catalog" || d.force === "all" || due(st.catalog_ok_at, CATALOG_EVERY)) {
      const [units, items, suppliers, zones] = [await client.get("/inventory/units"), await client.get("/inventory/items", 30_000), await client.get("/purchasing/suppliers"), await client.get("/inventory/zones")];
      const body: any = catalogBody({ units, items, suppliers, zones });
      if (!body.items.length || !body.zones.length || !body.suppliers.length) throw new ReaderError("changed", "Ricotta Restaurant sent empty lists (its API may have changed).");
      if (due(st.history_at, HISTORY_EVERY)) {
        try { body.history = await readHistory(client.get); patch.history_at = nowIso(); }
        catch (e) { if (e instanceof ReaderError && e.kind !== "changed") throw e; }   // the usual amounts wait for tomorrow
      }
      const saved = await d.saveCatalog(d.db, body);
      if (saved?.error) throw new ReaderError("write", "Could not save the lists in the app's database.");
      patch.catalog_ok_at = nowIso(); counts.items = body.titems.length; counts.zones = body.zones.length;
      done.push("catalog");
    }
    if (d.force === "invoices" || d.force === "all" || due(st.invoices_ok_at, INVOICES_EVERY)) {
      const baseOf = baseOfFrom(await d.catalogOf(d.db));
      const today = erbilDay(new Date(t0));
      const r = await readInvoiceMonth(d.db, client.get, today.slice(0, 7), baseOf);
      counts.invoices = r.receipts; counts.invoicesRead = r.read;
      // Last month once a night (after 02:00 Erbil), for corrections made there later.
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", hourCycle: "h23" }).format(new Date(t0)));
      if (st.prev_month_day !== today && hour >= 2) { await readInvoiceMonth(d.db, client.get, prevMonth(today), baseOf); patch.prev_month_day = today; }
      patch.invoices_ok_at = nowIso();
      done.push("invoices");
    }
    Object.assign(st, patch);
  } catch (e) {
    problem = e instanceof ReaderError ? { kind: e.kind, cause: e.message } : { kind: "changed", cause: "Something unexpected went wrong while reading Ricotta Restaurant." };
  }
  // The record: the problem and since when (kept while it is the same kind), the last 50 runs.
  const since = problem && st.problem?.kind === problem.kind ? st.problem.since : nowIso();
  const entry = { at: nowIso(), ms: Date.now() - started, did: done, ok: !problem, ...(problem ? { kind: problem.kind, cause: problem.cause } : {}) };
  const log = done.length || problem ? [entry, ...(st.log ?? [])].slice(0, LOG_KEEP) : (st.log ?? []);
  let alerted = st.alerted ?? null;
  const failingFor = problem ? t0 - Date.parse(since) : 0;
  if (problem && failingFor >= ALERT_AFTER && alerted !== problem.kind) {
    await d.alert(problem.kind, problemWords(problem.cause)).catch(() => {});
    alerted = problem.kind;
  } else if (!problem && alerted) {
    await d.alert("fixed", { en: "Cloud Rico is reading Ricotta Restaurant again.", ku: "ریکۆی هەور دیسان ریکۆتا ڕێستۆرانت دەخوێنێتەوە.", ar: "عاد ريكو السحابي إلى قراءة ريكوتا ريستورانت." }).catch(() => {});
    alerted = null;
  }
  await setStatus(d.db, {
    token: st.token ?? null, last_run_at: nowIso(), catalog_ok_at: st.catalog_ok_at ?? null, invoices_ok_at: st.invoices_ok_at ?? null,
    prev_month_day: st.prev_month_day ?? null, history_at: st.history_at ?? null, counts,
    problem: problem ? { ...problem, since } : null, alerted, log,
  });
  return { did: done, problem: problem ? { kind: problem.kind, cause: problem.cause, since } : null };
}
export function problemWords(cause: string) {
  return {
    en: `Cloud Rico cannot read Ricotta Restaurant: ${cause} The stock in the app may be old. See Admin, Cloud Rico.`,
    ku: `ریکۆی هەور ناتوانێت ریکۆتا ڕێستۆرانت بخوێنێتەوە: ${cause} لەوانەیە بڕی کۆگا لە ئەپەکەدا کۆن بێت. سەیری ئەدمین، ریکۆی هەور بکە.`,
    ar: `لا يستطيع ريكو السحابي قراءة ريكوتا ريستورانت: ${cause} قد يكون المخزون في التطبيق قديمًا. راجع الإدارة، ريكو السحابي.`,
  };
}

/* Reads one month at once for Rico (invoice_report / price_lookup), when it is not kept yet. */
export async function readMonthNow(db: any, month: string, deps: { fetch?: Fetch; get?: (k: string) => string; catalogOf: (db: any) => Promise<any> }) {
  const cfg = readerConfig(deps.get ?? env);
  if (!cfg.ready) return { error: "not_set_up" };
  const st = await status(db);
  const client = rrClient(cfg, { fetch: deps.fetch, token: st.token ?? null, onToken: (tok) => { st.token = tok; } });
  try {
    const r = await readInvoiceMonth(db, client.get, month, baseOfFrom(await deps.catalogOf(db)));
    if (st.token) await setStatus(db, { token: st.token });
    return r;
  } catch (e) {
    return { error: e instanceof ReaderError ? e.kind : "failed", cause: e instanceof ReaderError ? e.message : "" };
  }
}

/* What Admin shows (never the token or the PIN). */
export async function readerView(db: any, get = env) {
  const cfg = readerConfig(get);
  const st = await status(db).catch(() => ({} as Status));
  const { data: cat } = await db.from("app_rr_catalog").select("updated_at").eq("id", true).maybeSingle().then((x: any) => x, () => ({ data: null }));
  const next = (at: string | null | undefined, every: number) => at ? new Date(Math.max(Date.now(), Date.parse(at) + every)).toISOString() : null;
  return {
    ready: cfg.ready, missing: cfg.missing, on: cfg.ready && !!st.last_run_at && Date.now() - Date.parse(st.last_run_at) < 5 * 60_000,
    lastRun: st.last_run_at ?? null, catalogAt: st.catalog_ok_at ?? null, invoicesAt: st.invoices_ok_at ?? null, stockAt: cat?.updated_at ?? null,
    nextCatalog: next(st.catalog_ok_at, CATALOG_EVERY), nextInvoices: next(st.invoices_ok_at, INVOICES_EVERY),
    counts: st.counts ?? {}, problem: st.problem ?? null, log: (st.log ?? []).slice(0, LOG_KEEP),
  };
}
