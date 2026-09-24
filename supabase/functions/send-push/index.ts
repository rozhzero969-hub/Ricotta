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
//       {type:"assistant", title, bodyEn, bodyKu} a message an admin sent through Rico
//
// Every tick also runs Rico's late-order check: an hour after a supplier's
// reminder time (or the daily reminder), if nothing was sent to that supplier
// today, every signed-in device gets one alert (once per supplier per day).
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

/* ---- Rico: late-order alerts ----
   An hour after the reminder time, up to LATE_WINDOW_MS later, if nothing
   was sent today (to that supplier, or at all for the daily reminder).
   app_assistant_alerts makes each alert fire only once. */
const LATE_AFTER_MIN = 60;
const LATE_WINDOW_MIN = 4 * 60;
async function claimAlert(id: string, kind: string, supplierId: string | null) {
  const { error } = await sb.from("app_assistant_alerts").insert({ id, kind, supplier_id: supplierId });
  return !error;   // a duplicate key means this alert was already sent
}
type Day = { date: string; weekday: number };
/* Today and yesterday (Erbil), so a late reminder near midnight (e.g. 23:00)
   still gets its alert after the date changes. */
function recentDays(): Day[] {
  const today = erbilNow();
  const y = new Date(`${today.date}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return [{ date: today.date, weekday: today.weekday }, { date: y.toISOString().slice(0, 10), weekday: y.getUTCDay() }];
}
/* Minutes late for the most recent occurrence of `time` on one of `days`,
   or null when it is not inside the alert window. */
function lateFor(time: string, days: number[], updatedAt?: string): { late: number; date: string } | null {
  const now = Date.now();
  for (const d of recentDays()) {
    if (!days.includes(d.weekday)) continue;
    const scheduled = Date.parse(`${d.date}T${time}:00${ERBIL_OFFSET}`);
    if (isNaN(scheduled) || scheduled > now) continue;
    const edited = updatedAt ? Date.parse(updatedAt) : 0;
    if (edited && scheduled + EDIT_GRACE_MS < edited) return null;   // set up after that time: starts next time
    const late = Math.floor((now - scheduled) / 60000);
    return late >= LATE_AFTER_MIN && late < LATE_WINDOW_MIN ? { late, date: d.date } : null;
  }
  return null;
}
async function overdueTick() {
  const due: any[] = [];
  const { data: sups } = await sb.from("app_suppliers").select("id,name,reminder").not("reminder", "is", null);
  for (const s of sups ?? []) {
    const r = s.reminder;
    if (!r?.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time))) continue;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : ALL_DAYS;
    const hit = lateFor(r.time, days, r.updatedAt);
    if (hit) due.push({ ...s, ...hit });
  }
  const { data: daily } = await sb.from("app_reminder_settings").select("enabled,remind_time").eq("id", true).maybeSingle();
  const dailyHit = daily?.enabled ? lateFor(String(daily.remind_time).slice(0, 5), ALL_DAYS) : null;
  if (!due.length && !dailyHit) return { skipped: "nothing late" };

  // Orders sent since the start of yesterday, so each check can use its own day.
  const since = recentDays()[1].date;
  const { data: orders } = await sb.from("app_orders").select("id,sent_at").eq("status", "sent").gte("sent_at", `${since}T00:00:00${ERBIL_OFFSET}`);
  const sentAt = new Map((orders ?? []).map((o: any) => [o.id, Date.parse(o.sent_at)]));
  const ids = [...sentAt.keys()];
  const { data: lines } = ids.length ? await sb.from("app_order_lines").select("order_id,supplier_id").in("order_id", ids) : { data: [] as any[] };
  const dayStart = (date: string) => Date.parse(`${date}T00:00:00${ERBIL_OFFSET}`);
  const sentSince = (date: string, supplierId?: string) =>
    (lines ?? []).some((l: any) => (!supplierId || l.supplier_id === supplierId) && (sentAt.get(l.order_id) ?? 0) >= dayStart(date))
    || (!supplierId && [...sentAt.values()].some((t) => t >= dayStart(date)));
  const out: unknown[] = [];
  for (const s of due) {
    if (sentSince(s.date, s.id)) continue;
    if (!(await claimAlert(`overdue|${s.id}|${s.date}`, "overdue", s.id))) continue;
    const name = String(s.name).slice(0, 60), time = s.reminder.time;
    out.push({ supplier: name, ...(await sendReminder((lang) => ({
      title: lang === "ku" ? "ریکۆ · داواکاری دواکەوت" : "Rico · Order is late",
      body: lang === "ku" ? `داواکاریی ${name} لە کاتژمێر ${time} بوو و هێشتا نەنێردراوە. با ئێستا ئامادەی بکەین؟` : `The ${name} order was due at ${time} and hasn't been sent yet. Want me to prepare it?`,
      kind: "overdue", supplierId: String(s.id), tag: `ricotta-overdue-${s.id}`,
    }))) });
  }
  if (dailyHit && !sentSince(dailyHit.date) && await claimAlert(`overdue|daily|${dailyHit.date}`, "overdue-daily", null)) {
    const time = String(daily!.remind_time).slice(0, 5);
    out.push({ daily: true, ...(await sendReminder((lang) => ({
      title: lang === "ku" ? "ریکۆ · هیچ داواکارییەک نەنێردراوە" : "Rico · No orders sent yet",
      body: lang === "ku" ? `کاتژمێر ${time} تێپەڕی و ئەمڕۆ هیچ داواکارییەک نەنێردراوە.` : `It's past ${time} and no orders have been sent today.`,
      kind: "overdue", tag: "ricotta-overdue-daily",
    }))) });
  }
  return out;
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
        try { result.late = await overdueTick(); } catch (e) { console.error("late-order tick failed", e); result.late = { error: true }; }
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
      case "assistant": {
        const bodyEn = String(body.bodyEn ?? "").slice(0, 300);
        const bodyKu = String(body.bodyKu ?? "").slice(0, 300);
        if (!bodyEn && !bodyKu) return json({ error: "empty message" }, 400);
        const title = String(body.title || "Rico").slice(0, 80);
        return json(await sendReminder((lang) => ({
          title, body: lang === "ku" ? (bodyKu || bodyEn) : (bodyEn || bodyKu), kind: "assistant", tag: `ricotta-assistant-${Date.now()}`,
        })));
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
