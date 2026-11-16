/* Low stock alerts. Each ordering item linked to a Ricotta Restaurant stock item can have a level
   (app_items.low_alert), counted in that stock item's counting format (_shared/stock-link.js counted()).
   Whenever Rico writes new lists (every 10 minutes, and Check now), and when a level or a link is saved,
   the items with a level are checked: one that has dropped to its level or below gets one alert for Rozh
   and Yunis (Rico's inbox, and a notification on their signed-in phones), and low_alerted_at keeps it
   from repeating until the stock is back above the level. Never fails the work that called it: before
   the low stock migration, or with the database busy, it does nothing. Needs RicottaStockLink
   (_shared/stock-link.js) loaded first. */

const env = (k: string) => (globalThis as any).Deno?.env?.get?.(k) ?? "";
const ACCOUNTS = ["rozha", "yunis"];
const MAX_NAMED = 4;

const num = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
/* An item name kept as one piece inside a sentence of another script. */
const iso = (s: string) => `⁨${s}⁩`;

/* The words, in English, Kurdish and Arabic: one item, or a few named and how many more. */
export function lowStockWords(list: { name: string; low_alert: number; count: { qty: number; unit: string } }[]) {
  const line = (r: any, lang: "en" | "ku" | "ar") => {
    const have = `${num(r.count.qty)} ${r.count.unit}`.trim(), low = `${num(Number(r.low_alert))} ${r.count.unit}`.trim();
    if (lang === "ku") return r.count.qty <= 0 ? `${iso(r.name)}: هیچی نەماوە (ئاگادارکردنەوە لە ${iso(low)})` : `${iso(r.name)}: ${iso(have)} ماوە (ئاگادارکردنەوە لە ${iso(low)})`;
    if (lang === "ar") return r.count.qty <= 0 ? `${iso(r.name)}: لم يبق شيء (التنبيه عند ${iso(low)})` : `${iso(r.name)}: بقي ${iso(have)} (التنبيه عند ${iso(low)})`;
    return r.count.qty <= 0 ? `${iso(r.name)}: none left (alert at ${iso(low)})` : `${iso(r.name)}: ${iso(have)} left (alert at ${iso(low)})`;
  };
  const shown = list.slice(0, MAX_NAMED), more = list.length - shown.length;
  const join = (lang: "en" | "ku" | "ar", sep: string, tail: string) => shown.map((r) => line(r, lang)).join(sep) + (more > 0 ? tail : "");
  return {
    en: `Low in Main Storage. ${join("en", "; ", `; and ${more} more`)}.`,
    ku: `لە کۆگای سەرەکی کەمە. ${join("ku", "؛ ", `؛ و ${more} ی تر`)}.`,
    ar: `منخفض في المخزن الرئيسي. ${join("ar", "؛ ", `؛ و${more} أخرى`)}.`,
  };
}

/* opts.ids: only these items (a level or a link just saved). Returns how many items were alerted. */
export async function checkLowStock(db: any, opts: { ids?: string[] } = {}): Promise<number> {
  try {
    const L = (globalThis as any).RicottaStockLink;
    if (!L?.lowChanges) return 0;
    let q = db.from("app_items").select("id,name,stock_item,stock_items,low_alert,low_alerted_at").not("low_alert", "is", null).not("stock_item", "is", null);
    if (opts.ids) {
      if (!opts.ids.length) return 0;
      q = q.in("id", opts.ids);
    }
    const { data: rows, error } = await q.limit(5000);
    if (error || !rows?.length) return 0;
    const { data: cat, error: catError } = await db.from("app_rr_catalog").select("data").eq("id", true).maybeSingle();
    const titems = cat?.data?.titems;
    if (catError || !Array.isArray(titems) || !titems.length) return 0;
    const { alert, clear } = L.lowChanges(rows, titems);
    // Every write to app_items wakes every open app, so nothing is written when nothing changed.
    if (clear.length) await db.from("app_items").update({ low_alerted_at: null }).in("id", clear);
    if (!alert.length) return 0;
    // Only rows still not alerted are taken: two reads at the same time never alert twice.
    const { data: taken, error: takeError } = await db.from("app_items").update({ low_alerted_at: new Date().toISOString() })
      .in("id", alert.map((r: any) => r.id)).is("low_alerted_at", null).select("id");
    if (takeError) return 0;
    const ok = new Set((taken ?? []).map((r: any) => r.id));
    const list = alert.filter((r: any) => ok.has(r.id))
      // The emptiest for its level first: units differ (cartons, kilos), so the share of the level left.
      .sort((a: any, b: any) => a.count.qty / (Number(a.low_alert) || 1) - b.count.qty / (Number(b.low_alert) || 1) || String(a.name).localeCompare(String(b.name)));
    if (!list.length) return 0;
    const w = lowStockWords(list);
    const { error: inboxError } = await db.from("app_rico_inbox").insert(ACCOUNTS.map((account) => ({ account, kind: "low_stock", mood: "calm", body_en: w.en, body_ku: w.ku, body_ar: w.ar })));
    if (inboxError) console.error("low_stock_inbox_failed");
    const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), secret = env("CRON_SECRET");
    if (url && secret) {
      await fetch(`${url}/functions/v1/send-push`, {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon, "x-cron-secret": secret },
        body: JSON.stringify({ type: "low-stock", bodyEn: w.en, bodyKu: w.ku, bodyAr: w.ar }),
      }).catch(() => console.error("low_stock_push_failed"));
    }
    return list.length;
  } catch {
    console.error("low_stock_check_failed");
    return 0;
  }
}

/* An item linked to another stock item (or unlinked): its alert starts over, and it alerts now when the
   new stock item is already at or below its level. Only for an item that has a level. */
export async function relinkedLowStock(db: any, id: string): Promise<number> {
  try {
    const { error } = await db.from("app_items").update({ low_alerted_at: null }).eq("id", id).not("low_alert", "is", null).not("low_alerted_at", "is", null);
    if (error) return 0;
    return await checkLowStock(db, { ids: [id] });
  } catch { return 0; }
}
