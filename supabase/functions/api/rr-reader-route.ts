// The routes for the server's reader of Ricotta Restaurant (rr-reader.ts):
//   POST rr-reader/tick          send-push's tick, every minute (cron secret)       does what is due
//   GET  admin/rr-reader         Rozh: Cloud Rico's state for Admin
//   POST admin/rr-reader/run     Rozh: read the lists and this month's invoices now
//   GET  rico-prices             Recipes, Receipts or Transfers: when the last prices were read (rr-prices.ts)
//   POST rico-prices             the same: read them now (Cloud Rico when set up, otherwise Rico on the Mac)
//   GET  rr-invoices?month=YYYY-MM[&supplier=]   whoever makes receipts or transfers: that month's invoices
import { saveCatalog, catalogOf } from "./receipts.ts";
import { readerTick, readerView, readMonthNow, erbilDay, readerConfig } from "./rr-reader.ts";
import { checkRecipeAlerts } from "./recipe-alerts.ts";
import { pricesView, askPrices } from "./rr-prices.ts";

type Ctx = { db: any; json: (b: unknown, s?: number) => Response; fail: (e: string, s?: number) => Response };
type Who = { account: string; rozha: boolean; can: (role: string) => boolean } | null;
const env = (k: string) => (globalThis as any).Deno?.env?.get?.(k) ?? "";

async function sameSecret(a: string, b: string) {
  const h = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
/* Rozh hears about a problem (Rico's inbox and a notification on her phones), and when it is fixed. */
async function alertRozh(db: any, kind: string, w: { en: string; ku: string; ar: string }) {
  await db.from("app_rico_inbox").insert({ account: "rozha", kind: "rr_reader", mood: "calm", body_en: w.en, body_ku: w.ku, body_ar: w.ar });
  const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), secret = env("CRON_SECRET");
  if (!url || !secret) return;
  await fetch(`${url}/functions/v1/send-push`, {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon, "x-cron-secret": secret },
    body: JSON.stringify({ type: "rr-reader", kind, bodyEn: w.en, bodyKu: w.ku, bodyAr: w.ar }),
  }).catch(() => console.error("rr_reader_push_failed"));
}
const tickDeps = (db: any, force: "all" | "invoices" | null = null) => ({ db, saveCatalog, catalogOf, force, alert: (kind: string, w: any) => alertRozh(db, kind, w) });

export async function rrReaderRoute(ctx: Ctx, req: Request, M: string, path: string, who: Who): Promise<Response | null> {
  const { db, json, fail } = ctx;
  if (M === "POST" && path === "rr-reader/tick") {
    const secret = env("CRON_SECRET");
    if (!secret || !(await sameSecret(req.headers.get("x-cron-secret") ?? "", secret))) return fail("forbidden", 403);
    const r = await readerTick(tickDeps(db));
    // New prices: Ahmad hears about recipes they change (recipe-alerts.ts, never fails). New stock is
    // checked where the lists are saved (receipts.ts saveCatalog).
    if ((r.did as string[]).includes("invoices")) await checkRecipeAlerts(db);
    return json(r);
  }
  if (!who) return null;
  if (path === "admin/rr-reader" || path === "admin/rr-reader/run") {
    if (!who.rozha) return fail("forbidden", 403);
    if (M === "GET") return json(await readerView(db));
    if (M === "POST") {
      const r = await readerTick(tickDeps(db, "all"));
      if ((r.did as string[]).includes("invoices")) await checkRecipeAlerts(db);
      return json(await readerView(db));
    }
  }
  if (path === "rico-prices") {
    if (!who.can("recipes") && !who.can("receipts") && !who.can("transfers")) return fail("forbidden", 403);
    if (M === "GET") return json(await pricesView(db));
    if (M === "POST") {
      // Cloud Rico is set up: the server reads this month's and last month's invoices now.
      if (readerConfig().ready) {
        const r = await readerTick(tickDeps(db, "invoices"));
        if ((r.did as string[]).includes("invoices")) await checkRecipeAlerts(db);
        return json({ prices: await pricesView(db), ...(r.problem ? { error: "cloud_failed", cause: r.problem.cause } : {}) });
      }
      const r = await askPrices(db);
      return json(r);
    }
  }
  if (M === "GET" && path === "rr-invoices") {
    if (!who.can("receipts") && !who.can("transfers")) return fail("forbidden", 403);
    const q = new URL(req.url).searchParams;
    const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : erbilDay().slice(0, 7);
    const rows = await monthInvoices(db, month);
    if (!rows.length && month <= erbilDay().slice(0, 7)) {
      const read = await readMonthNow(db, month, { catalogOf });
      if ((read as any).error === "not_set_up") return json({ month, invoices: [], notSetUp: true });
    }
    const all = rows.length ? rows : await monthInvoices(db, month);
    const supplier = String(q.get("supplier") ?? "").trim().toLowerCase();
    return json({ month, invoices: supplier ? all.filter((r: any) => String(r.supplier_name).toLowerCase().includes(supplier)) : all });
  }
  return null;
}
export async function monthInvoices(db: any, month: string) {
  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const { data, error } = await db.from("app_rr_invoices").select("id,entry_date,invoice_number,supplier_name,status,currency,total,delivery_fee,paid,lines")
    .gte("entry_date", `${month}-01`).lte("entry_date", to).order("entry_date").order("invoice_number").limit(3000);
  if (error) throw error;
  return data ?? [];
}
