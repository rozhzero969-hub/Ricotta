// Ricotta Orders: sends Web Push notifications.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// Only two callers exist, and both send the x-cron-secret header:
//   - pg_cron, every minute:  {type:"reminder-tick"}
//   - the api function, for an admin who is signed in:
//       {type:"update", title, bodyEn, bodyKu}   "new update" push to every device
//       {type:"reminder-now"}                    test of the daily reminder
//       {type:"supplier-test", supplierId}       test of one supplier's reminder
//
// Every push is split by the recipient device's own language, so Kurdish
// devices get Kurdish only and English devices get English only.
// Reminders only go to devices that are signed in.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidReady = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (vapidReady) {
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", VAPID_PUBLIC!, VAPID_PRIVATE!);
}
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TZ = "Asia/Baghdad";              // Erbil, UTC+3 all year
const ERBIL_OFFSET = "+03:00";
const WINDOW_MS = 3 * 60 * 60 * 1000;   // a missed reminder is still sent up to 3h late, never later
const EDIT_GRACE_MS = 60 * 1000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string; device_id: string | null; lang: string | null };
type Lang = "en" | "ku";
type Payload = (lang: Lang) => Record<string, unknown>;
const asLang = (l: string | null | undefined): Lang => (l === "ku" ? "ku" : "en");

const dailyPayload: Payload = (lang) => ({
  title: "Ricotta Orders",
  body: lang === "ku" ? "کاتی ناردنی داواکارییەکانی ئەمڕۆیە." : "Time to place today's orders.",
  kind: "reminder",
  tag: "ricotta-reminder",
});
function supplierPayload(s: any, test = false): Payload {
  const name = String(s?.name ?? "").slice(0, 60);
  return (lang) => ({
    title: test ? "Ricotta Orders (test)" : "Ricotta Orders",
    body: lang === "ku" ? `کاتی داواکردنە لە ${name}.` : `Time to order from ${name}.`,
    kind: "supplier",
    supplierId: String(s?.id ?? ""),
    tag: `ricotta-supplier-${s?.id}`,
  });
}

function erbilNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

/* Signed-in devices only. Subscriptions without a device id (very old app
   versions) are kept until that phone updates. */
async function loadSubs(onlyLoggedIn: boolean): Promise<{ subs: Sub[]; skipped: number }> {
  const { data } = await sb.from("app_push_subscriptions").select("endpoint,p256dh,auth,device_id,lang");
  const all = (data ?? []) as Sub[];
  if (!onlyLoggedIn) return { subs: all, skipped: 0 };
  const { data: devices } = await sb.from("app_devices").select("id,logged_in,command,handled_command");
  const byId = new Map((devices ?? []).map((d: any) => [d.id, d]));
  const subs = all.filter((s) => {
    if (!s.device_id) return true;
    const d = byId.get(s.device_id);
    if (!d || d.logged_in === false) return false;
    return !(d.command?.type === "logout" && d.command.id !== d.handled_command);
  });
  return { subs, skipped: all.length - subs.length };
}

async function sendTo(subs: Sub[], payload: Record<string, unknown>, ttl: number, urgency: "high" | "normal") {
  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: ttl, urgency });
      sent++;
    } catch (e: any) {
      failed++;
      // 404/410 = the device unsubscribed or the app was removed; forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
      else console.error("push failed", e?.statusCode, e?.body);
    }
  }));
  if (dead.length) await sb.from("app_push_subscriptions").delete().in("endpoint", dead);
  return { sent, failed, removed: dead.length };
}

/* Sends each language group its own payload. */
async function sendGrouped(subs: Sub[], payloadFor: Payload, ttl: number, urgency: "high" | "normal") {
  const groups = new Map<Lang, Sub[]>();
  for (const s of subs) {
    const l = asLang(s.lang);
    groups.set(l, [...(groups.get(l) ?? []), s]);
  }
  const total = { sent: 0, failed: 0, removed: 0 };
  for (const [lang, group] of groups) {
    const r = await sendTo(group, payloadFor(lang), ttl, urgency);
    total.sent += r.sent; total.failed += r.failed; total.removed += r.removed;
  }
  return total;
}

async function sendReminder(payloadFor: Payload) {
  const { subs, skipped } = await loadSubs(true);
  return { ...(await sendGrouped(subs, payloadFor, 2 * 3600, "high")), skipped };
}

/* ---- Daily reminder (one for the whole restaurant) ---- */
async function dailyTick() {
  const { data: r } = await sb.from("app_reminder_settings").select("*").eq("id", true).maybeSingle();
  if (!r?.enabled) return { skipped: "disabled" };
  const now = erbilNow();
  const [h, m] = String(r.remind_time).split(":").map(Number);
  const target = h * 60 + m;
  if (now.minutes < target || now.minutes >= target + WINDOW_MS / 60000) return { skipped: "outside window" };
  // Claim today's send first so two overlapping ticks can never both send.
  const { data: claimed } = await sb.from("app_reminder_settings")
    .update({ last_sent_date: now.date }).eq("id", true)
    .or(`last_sent_date.is.null,last_sent_date.neq.${now.date}`).select();
  if (!claimed?.length) return { skipped: "already sent today" };
  return await sendReminder(dailyPayload);
}

/* ---- Per-supplier reminders ----
   reminder = { enabled, time: "HH:MM" (Erbil), days: [0..6] (0 = Sunday), updatedAt } */
async function supplierTick() {
  const { data } = await sb.from("app_suppliers").select("id,name,reminder").not("reminder", "is", null);
  const now = Date.now();
  const today = erbilNow();
  const out: unknown[] = [];
  for (const s of data ?? []) {
    const r = s.reminder;
    if (!r?.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time))) continue;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : ALL_DAYS;
    if (!days.includes(today.weekday)) continue;
    const scheduled = Date.parse(`${today.date}T${r.time}:00${ERBIL_OFFSET}`);
    if (isNaN(scheduled) || now < scheduled || now >= scheduled + WINDOW_MS) continue;
    // Changed after today's time had already passed? Then it starts tomorrow.
    const edited = r.updatedAt ? Date.parse(r.updatedAt) : 0;
    if (edited && scheduled + EDIT_GRACE_MS < edited) continue;
    const { data: claimed, error } = await sb.rpc("app_internal_claim_supplier", { p_supplier_id: String(s.id), p_key: `${today.date}|${r.time}` });
    if (error) { console.error("claim failed", s.id, error.message); continue; }
    if (claimed !== true) continue;
    out.push({ supplier: s.name, ...(await sendReminder(supplierPayload(s))) });
  }
  return out;
}

Deno.serve(async (req) => {
  if (!vapidReady) return json({ error: "VAPID keys are not set on this function" }, 500);
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.type) {
      case "reminder-tick": {
        const result: Record<string, unknown> = {};
        try { result.daily = await dailyTick(); } catch (e) { console.error("daily tick failed", e); result.daily = { error: true }; }
        try { result.suppliers = await supplierTick(); } catch (e) { console.error("supplier tick failed", e); result.suppliers = { error: true }; }
        return json(result);
      }
      case "update": {
        const { subs } = await loadSubs(false);
        const title = String(body.title || "Ricotta Orders").slice(0, 80);
        const bodyEn = String(body.bodyEn ?? "").slice(0, 300);
        const bodyKu = String(body.bodyKu ?? "").slice(0, 300);
        if (!bodyEn && !bodyKu) return json({ error: "empty message" }, 400);
        return json(await sendGrouped(subs, (lang) => ({
          title, body: lang === "ku" ? (bodyKu || bodyEn) : (bodyEn || bodyKu), kind: "update", tag: "ricotta-update",
        }), 86400, "normal"));
      }
      case "reminder-now":
        return json(await sendReminder((lang) => ({ ...dailyPayload(lang), title: "Ricotta Orders (test)" })));
      case "supplier-test": {
        const { data: s } = await sb.from("app_suppliers").select("id,name").eq("id", String(body.supplierId ?? "")).maybeSingle();
        if (!s) return json({ error: "supplier not found" }, 404);
        return json(await sendReminder(supplierPayload(s, true)));
      }
      default:
        return json({ error: "unknown type" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
