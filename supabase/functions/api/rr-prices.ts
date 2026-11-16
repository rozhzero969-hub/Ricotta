// "Check all last prices": the last price paid for every item, from Ricotta Restaurant's invoices.
//
// Cloud Rico (rr-reader.ts) reads the invoices on the server once Rozh's PIN is set up. Until then Rico
// on the Mac does it with his own sign-in: this month's invoices every 15 minutes, last month's once a
// day, and both at once when someone presses the button in Recipes. He reads the list, asks which
// receipts are new or changed, reads only their lines and sends them here; they are kept in
// app_rr_invoices, exactly as Cloud Rico keeps them, so recipe costs and Rico's price lookups use them.
// Nothing is written in Ricotta Restaurant.
//
// Rico on the Mac (helper/ door, his own secret):
//   POST helper/invoices/plan {month, rows, auto}   the month's list; answers the receipts whose lines to read
//   POST helper/invoices/save {invoices:[{row, lines}]}   up to 10 receipts with their lines
//   POST helper/invoices/done {ok, error, receipts, read, auto}   how the read went
// The app (session, whoever sees Recipes, Receipts or Transfers), in rr-reader-route.ts:
//   GET  rico-prices    when the prices were last read and whether a read is asked or running
//   POST rico-prices    read them now (Cloud Rico when set up, otherwise Rico on the Mac)
import { planInvoiceMonth, saveInvoices, baseOfFrom, readerConfig } from "./rr-reader.ts";
import { checkRecipeAlerts } from "./recipe-alerts.ts";

const helper = (db: any) => db.from("app_rr_helper");
const now = () => new Date().toISOString();
// A request nobody took in 10 minutes, or a read that never finished in 10, counts as not answered.
const ASK_STALE = 10 * 60_000, RUN_STALE = 10 * 60_000, SAVE_AT_ONCE = 10;
// The first Rico on the Mac that reads invoices (older ones never take the request).
export const PRICES_VERSION = "2026-11-16";

async function helperState(db: any) {
  const { data, error } = await helper(db).select("last_seen,version,prices_state,prices_asked_at,prices_started_at,prices_done_at,prices_result").eq("id", true).maybeSingle();
  if (error) throw error;
  return data ?? {};
}
function pending(h: any) {
  if (h.prices_state === "asked") return !!h.prices_asked_at && Date.now() - Date.parse(h.prices_asked_at) < ASK_STALE;
  if (h.prices_state === "running") return !!h.prices_started_at && Date.now() - Date.parse(h.prices_started_at) < RUN_STALE;
  return false;
}
/* What the app shows: who reads the prices, when they were last read, and a read in progress. */
export async function pricesView(db: any) {
  const [h, reader, last] = await Promise.all([
    helperState(db),
    db.from("app_rr_reader").select("invoices_ok_at").eq("id", true).maybeSingle().then((x: any) => x.data ?? null, () => null),
    db.from("app_rr_invoices").select("read_at").order("read_at", { ascending: false }).limit(1).then((x: any) => x.data?.[0]?.read_at ?? null, () => null),
  ]);
  const seen = h.last_seen ? Date.parse(h.last_seen) : 0;
  const cloud = readerConfig().ready;
  const at = [reader?.invoices_ok_at, h.prices_result?.ok ? h.prices_done_at : null, last].filter(Boolean).sort().pop() ?? null;
  return {
    by: cloud ? "cloud" : "mac", at, ricoOn: !!seen && Date.now() - seen < 90_000,
    ricoOld: !cloud && String(h.version ?? "") < PRICES_VERSION,
    state: pending(h) ? h.prices_state : null, timedOut: !!h.prices_state && !pending(h),
    askedAt: h.prices_asked_at ?? null, doneAt: h.prices_done_at ?? null, result: h.prices_result ?? null,
  };
}
/* Someone pressed Check all last prices and Cloud Rico isn't set up: the request waits for Rico on the Mac. */
export async function askPrices(db: any) {
  const v = await pricesView(db);
  if (!v.ricoOn) return { error: "rico_off", prices: v };
  if (v.ricoOld) return { error: "rico_old", prices: v };
  if (v.state) return { prices: v };   // already asked or reading: the same read answers both
  const h = await helperState(db);
  // Asked once: of two presses at the same moment, only one asks.
  let q = helper(db).update({ prices_state: "asked", prices_asked_at: now(), prices_started_at: null }).eq("id", true);
  q = h.prices_state ? q.eq("prices_state", h.prices_state) : q.is("prices_state", null);
  const { error } = await q;
  if (error) throw error;
  return { prices: await pricesView(db) };
}
/* Rico takes the request (once), between jobs. */
export async function takePrices(db: any) {
  const { data } = await helper(db).select("prices_state,prices_asked_at").eq("id", true).maybeSingle();
  if (data?.prices_state !== "asked" || !data.prices_asked_at || Date.now() - Date.parse(data.prices_asked_at) >= ASK_STALE) return false;
  const { data: took } = await helper(db).update({ prices_state: "running", prices_started_at: now() })
    .eq("id", true).eq("prices_state", "asked").eq("prices_asked_at", data.prices_asked_at).select("id");
  return !!took?.length;
}
async function baseOf(db: any) {
  const { data } = await db.from("app_rr_catalog").select("data").eq("id", true).maybeSingle();
  return baseOfFrom(data?.data ?? {});
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };

export async function pricesHelperRoute(db: any, M: string, path: string, b: any, json: (v: unknown, s?: number) => Response, fail: (e: string, s?: number) => Response) {
  if (M !== "POST") return null;
  if (path === "helper/invoices/plan") {
    // Cloud Rico reads them on the server: Rico on the Mac doesn't read them too (the button still does).
    if (b.auto === true && readerConfig().ready) return json({ skip: true, need: [] });
    if (!Array.isArray(b.rows) || b.rows.length > 2000) return fail("invalid_rows", 400);
    try {
      const plan = await planInvoiceMonth(db, String(b.month ?? ""), b.rows);
      return json({ receipts: plan.rows.length, removed: plan.removed, need: plan.todo.map((p: any) => p.row.id) });
    } catch (e) { return fail((e as Error).message.slice(0, 200), 400); }
  }
  if (path === "helper/invoices/save") {
    const list = Array.isArray(b.invoices) ? b.invoices : null;
    if (!list || list.length > SAVE_AT_ONCE || list.some((x: any) => !x || typeof x.row !== "object" || !x.row?.id || !Array.isArray(x.lines))) return fail("invalid_invoices", 400);
    try { return json({ saved: await saveInvoices(db, list, await baseOf(db)) }); }
    catch (e) { return fail((e as Error).message.slice(0, 200), 503); }
  }
  if (path === "helper/invoices/done") {
    const ok = b.ok === true;
    const result = { ok, error: ok ? null : String(b.error ?? "Rico could not read the invoices").slice(0, 300), receipts: num(b.receipts), read: num(b.read), auto: b.auto === true };
    // An automatic read never ends someone's request (that request's own read does), and a failed one
    // isn't shown as the last read.
    if (b.auto !== true) await helper(db).update({ prices_state: null, prices_done_at: now(), prices_result: result }).eq("id", true);
    else if (ok) await helper(db).update({ prices_done_at: now(), prices_result: result }).eq("id", true);
    // New prices: Ahmad hears about recipes they change (never fails).
    if (ok && result.read) await checkRecipeAlerts(db).catch(() => 0);
    return json({ ok: true });
  }
  return null;
}
