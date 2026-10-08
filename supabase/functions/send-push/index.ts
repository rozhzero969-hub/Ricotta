// Ricotta Orders: sends Web Push notifications.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// Only two callers exist, and both send the x-cron-secret header:
//   - pg_cron, every minute:  {type:"reminder-tick"}
//   - the api function, for a signed-in person:
//       {type:"update", bodyEn, bodyKu, bodyAr}   "new update" push, written by Rozha
//       {type:"reminder-now"}                     test of the daily reminder
//       {type:"supplier-test", supplierId}        test of one supplier's reminder
//       {type:"assistant", title, bodyEn, bodyKu, bodyAr}  a message sent through Rico
//       {type:"note", account, body}              Rozha left a kitchen note (only that account's phones)
//
// Every tick also runs Rico's own messages: a cheer at 09:00 Erbil time (with
// the day's weather), an hour after a supplier's reminder time (or the daily
// reminder) with nothing sent, a telling-off, at 20:00 a warning when the
// kitchen streak would end at midnight, on the last day of the month a
// reminder to save the month's report card, and a nudge for Yunis when
// Rozha's note has waited two hours unread -- each once, in the app (Rico's
// inbox) and as a notification. Erbil's weather is refreshed every hour.
//
// Every push is sent in the recipient phone's own language (English, Kurdish
// or Arabic), and addresses the person signed in there by name when known.
// Reminders only go to phones that are signed in.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody } from "../_shared/security.ts";

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
const CHEER_AT_MIN = 9 * 60;            // Rico's morning message, 09:00 Erbil
const CHEER_WINDOW_MIN = 2 * 60;        // still sent if the tick was missed, until 11:00
const ACCOUNTS = ["rozha", "yunis"];
/* Each name in the script of each language. */
const NAMES: Record<string, Record<"en" | "ku" | "ar", string>> = {
  rozha: { en: "Rozha", ku: "ڕۆژا", ar: "روژا" },
  yunis: { en: "Yunis", ku: "یونس", ar: "يونس" },
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string; device_id: string | null; lang: string | null; account: string | null };
type Lang = "en" | "ku" | "ar";
/* A payload for one phone: its language and the name of whoever is signed in there. */
type Payload = (lang: Lang, name: string | null) => Record<string, unknown>;
const asLang = (l: string | null | undefined): Lang => (l === "ku" || l === "ar" ? l : "en");
const L = (lang: Lang, en: string, ku: string, ar: string) => (lang === "ku" ? ku : lang === "ar" ? ar : en);
const RICO: Record<Lang, string> = { en: "Rico", ku: "ریکۆ", ar: "ريكو" };
/* Rico's feelings. His notifications carry the mood so the phone shows his face for it (rico-<mood>.png). */
const RICO_MOODS = ["happy", "excited", "grateful", "calm", "thinking", "worried", "sad", "angry"];
const moodOf = (m: unknown) => (RICO_MOODS.includes(String(m)) ? String(m) : "happy");

const dailyPayload: Payload = (lang) => ({
  title: "Ricotta Orders",
  body: L(lang, "Time to place today's orders.", "کاتی ناردنی داواکارییەکانی ئەمڕۆیە.", "حان وقت إرسال طلبات اليوم."),
  kind: "reminder",
  tag: "ricotta-reminder",
});
function supplierPayload(s: any, test = false): Payload {
  const name = String(s?.name ?? "").slice(0, 60);
  return (lang) => ({
    title: test ? L(lang, "Ricotta Orders (test)", "Ricotta Orders (تاقیکاری)", "Ricotta Orders (تجربة)") : "Ricotta Orders",
    body: L(lang, `Time to order from ${name}.`, `کاتی داواکردنە لە ${name}.`, `حان وقت الطلب من ${name}.`),
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

async function readAll(build: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/* A reminder requires both a signed-in device and a session that is still
   valid. A stale logged_in flag alone outlives an expired PIN session. */
async function loadSubs(onlyLoggedIn: boolean): Promise<{ subs: Sub[]; skipped: number }> {
  const [data, devices, sessions] = await Promise.all([
    readAll(() => sb.from("app_push_subscriptions").select("endpoint,p256dh,auth,device_id,lang").order("endpoint")),
    readAll(() => sb.from("app_devices").select("id,account,logged_in,command,handled_command").order("id")),
    onlyLoggedIn ? readAll(() => sb.from("app_sessions").select("id,device_id,account")
      .is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("id")) : Promise.resolve([]),
  ]);
  const byId = new Map((devices ?? []).map((d: any) => [d.id, d]));
  const active = new Set(sessions.map((s) => `${s.device_id}|${s.account}`));
  const all = ((data ?? []) as any[]).map((s) => ({ ...s, account: byId.get(s.device_id)?.account ?? null })) as Sub[];
  const subs = all.filter((s) => {
    // Defense in depth for legacy or manually inserted subscriptions too.
    if (!isPushEndpoint(s.endpoint)) return false;
    if (!onlyLoggedIn) return true;
    if (!s.device_id || !active.has(`${s.device_id}|${s.account}`)) return false;
    const d = byId.get(s.device_id);
    if (!d || d.logged_in === false) return false;
    return !(d.command?.type === "logout" && d.command.id !== d.handled_command);
  });
  return { subs, skipped: all.length - subs.length };
}

async function send(subs: Sub[], payloadFor: Payload, ttl: number, urgency: "high" | "normal") {
  if (!vapidReady) return { sent: 0, failed: 0, removed: 0, disabled: true };
  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    const lang = asLang(s.lang);
    const payload = payloadFor(lang, s.account ? NAMES[s.account]?.[lang] ?? null : null);
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: ttl, urgency, timeout: 10_000 });
      sent++;
    } catch (e: any) {
      failed++;
      // 404/410 = the phone unsubscribed or the app was removed; forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
      else console.error("push failed", e?.statusCode, e?.body);
    }
  }));
  if (dead.length) await sb.from("app_push_subscriptions").delete().in("endpoint", dead);
  return { sent, failed, removed: dead.length };
}

async function sendReminder(payloadFor: Payload, account?: string) {
  const { subs, skipped } = await loadSubs(true);
  const mine = account ? subs.filter((s) => s.account === account) : subs;
  return { ...(await send(mine, payloadFor, 2 * 3600, "high")), skipped: skipped + subs.length - mine.length };
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

/* ---- Rico's own messages ----
   app_assistant_alerts makes each one happen only once. The same words go
   to both accounts' inboxes (with their own name) and to signed-in phones. */
const LATE_AFTER_MIN = 60;
const LATE_WINDOW_MIN = 4 * 60;
async function claimAlert(id: string, kind: string, supplierId: string | null) {
  const { data, error } = await sb.from("app_assistant_alerts")
    .upsert({ id, kind, supplier_id: supplierId }, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return !!data?.length;
}
type Words = { mood: string; en: (n: string) => string; ku: (n: string) => string; ar: (n: string) => string };
async function ricoSays(kind: string, key: string, words: Words, extra: Record<string, unknown> = {}, only?: string) {
  const to = only ? ACCOUNTS.filter((a) => a === only) : ACCOUNTS;
  const { error } = await sb.from("app_rico_inbox").upsert(to.map((a) => ({
    account: a, kind, mood: words.mood, body_en: words.en(NAMES[a].en), body_ku: words.ku(NAMES[a].ku), body_ar: words.ar(NAMES[a].ar),
    dedupe_key: `${key}|${a}`,
  })), { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
  return await sendReminder((lang, name) => ({
    title: RICO[lang],
    body: lang === "ku" ? words.ku(name ?? "") : lang === "ar" ? words.ar(name ?? "") : words.en(name ?? ""),
    kind: "assistant", mood: moodOf(words.mood), tag: `ricotta-rico-${key}`, ...extra,
  }), only);
}
/* "Hey Rozha!" when the name is known, "Hey!" when it isn't. */
const hi = (word: string, n: string, sep = " ") => (n ? `${word}${sep}${n}` : word);
/* Arabic "يا" needs a name after it; without one, a plain "Hey" (مرحبًا). */
const ya = (n: string) => (n ? `يا ${n}` : "مرحبًا");

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
    out.push({ supplier: name, ...(await ricoSays("overdue", `overdue|${s.id}|${s.date}`, {
      mood: "angry",
      en: (n) => `${hi("Hey", n)}! 😠 ${name} was due at ${time} and still isn't sent. Tomatoes don't order themselves! Want me to prepare it?`,
      ku: (n) => `${hi("هەی", n)}! 😠 داواکاریی ${name} کاتژمێر ${time} بوو و هێشتا نەنێردراوە. تەماتە خۆی داوا ناکات! با ئێستا ئامادەی بکەم؟`,
      ar: (n) => `${ya(n)}! 😠 طلب ${name} كان موعده ${time} ولم يُرسل بعد. الطماطم لا تطلب نفسها! هل أجهّزه لك الآن؟`,
    }, { supplierId: String(s.id) })) });
  }
  if (dailyHit && !sentSince(dailyHit.date) && await claimAlert(`overdue|daily|${dailyHit.date}`, "overdue-daily", null)) {
    const time = String(daily!.remind_time).slice(0, 5);
    out.push({ daily: true, ...(await ricoSays("overdue", `overdue|daily|${dailyHit.date}`, {
      mood: "angry",
      en: (n) => `${hi("Hey", n)}! 😠 It's past ${time} and not a single order has gone out today. Let's go!`,
      ku: (n) => `${hi("هەی", n)}! 😠 کاتژمێر ${time} تێپەڕی و ئەمڕۆ هیچ داواکارییەک نەنێردراوە. با دەست پێ بکەین!`,
      ar: (n) => `${ya(n)}! 😠 تجاوزت الساعة ${time} ولم يُرسل أي طلب اليوم. هيا بنا!`,
    })) });
  }
  return out;
}

/* ---- Erbil weather (Open-Meteo, no key), kept in app_weather for the app and Rico ---- */
const RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
const SNOW_CODES = [71, 73, 75, 77, 85, 86];
async function weatherTick() {
  const { data: row } = await sb.from("app_weather").select("updated_at").eq("id", true).maybeSingle();
  if (row?.updated_at && Date.now() - Date.parse(row.updated_at) < 50 * 60_000) return { skipped: "fresh" };
  const url = "https://api.open-meteo.com/v1/forecast?latitude=36.19&longitude=44.01&current=temperature_2m,weather_code,precipitation"
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia%2FBaghdad&forecast_days=1";
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { error: res.status };
  const w = await res.json();
  const code = Number(w?.current?.weather_code ?? -1), dayCode = Number(w?.daily?.weather_code?.[0] ?? -1);
  const data = {
    temp: Math.round(Number(w?.current?.temperature_2m ?? 0)), code,
    rain: RAIN_CODES.includes(code) || Number(w?.current?.precipitation ?? 0) > 0.1,
    snow: SNOW_CODES.includes(code),
    max: Math.round(Number(w?.daily?.temperature_2m_max?.[0] ?? 0)), min: Math.round(Number(w?.daily?.temperature_2m_min?.[0] ?? 0)),
    rainChance: Number(w?.daily?.precipitation_probability_max?.[0] ?? 0), dayCode,
  };
  await sb.from("app_weather").upsert({ id: true, data, updated_at: new Date().toISOString() });
  return data;
}
/* One sentence about today's weather for the morning message, in each language. */
async function weatherWords() {
  const { data: row } = await sb.from("app_weather").select("data,updated_at").eq("id", true).maybeSingle();
  const w: any = row?.data;
  if (!w || !row?.updated_at || Date.now() - Date.parse(row.updated_at) > 6 * 3600_000) return { en: "", ku: "", ar: "" };
  const wet = RAIN_CODES.includes(Number(w.dayCode)) || Number(w.rainChance) >= 60;
  const tip = wet ? { en: " Rain is likely, so send orders early in case deliveries are slow.", ku: " ئەگەری باران هەیە، بۆیە داواکارییەکان زوو بنێرە نەوەک گەیاندن دوابکەوێت.", ar: " المطر محتمل، فأرسل الطلبات مبكرًا تحسبًا لتأخر التوصيل." }
    : w.max >= 38 ? { en: " A hot one: think extra lemons and keep the cheese cold.", ku: " ڕۆژێکی گەرمە: لیمۆی زیاتر و پەنیرەکە سارد ڕابگرە.", ar: " يوم حار: فكّر بليمون إضافي وأبقِ الجبن باردًا." }
    : w.max <= 10 ? { en: " A cold day, good for soup.", ku: " ڕۆژێکی ساردە، باشە بۆ شۆربا.", ar: " يوم بارد، مناسب للشوربة." } : { en: "", ku: "", ar: "" };
  return {
    en: ` Erbil today: ${w.max}°, low ${w.min}°.${tip.en}`,
    ku: ` هەولێر ئەمڕۆ: ${w.max}°، کەمترین ${w.min}°.${tip.ku}`,
    ar: ` أربيل اليوم: ${w.max}°، الصغرى ${w.min}°.${tip.ar}`,
  };
}

/* ---- The kitchen streak: a warning at 20:00 when today has no order yet ---- */
const STREAK_WARN_MIN = 20 * 60, STREAK_WARN_WINDOW_MIN = 2 * 60;
async function streakTick() {
  const now = erbilNow();
  if (now.minutes < STREAK_WARN_MIN || now.minutes >= STREAK_WARN_MIN + STREAK_WARN_WINDOW_MIN) return { skipped: "outside window" };
  const { data: st } = await sb.from("app_streak").select("count,last_day").eq("id", true).maybeSingle();
  const y = new Date(`${now.date}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  if (!st || Number(st.count) < 2 || String(st.last_day) !== y.toISOString().slice(0, 10)) return { skipped: "nothing at risk" };
  if (!(await claimAlert(`streak-risk|${now.date}`, "streak-risk", null))) return { skipped: "already sent today" };
  const k = Number(st.count);
  return await ricoSays("streak", `streak-risk|${now.date}`, {
    mood: "worried",
    en: (n) => `${hi("Hey", n)}! 🔥 Our ${k}-day streak goes out at midnight. One order today keeps the fire burning!`,
    ku: (n) => `${hi("هەی", n)}! 🔥 زنجیرەی ${k} ڕۆژەمان نیوەشەو دەکوژێتەوە. تەنها یەک داواکاری ئەمڕۆ ئاگرەکە هەڵدەگیرسێنێتەوە!`,
    ar: (n) => `${ya(n)}! 🔥 سلسلة الـ${k} يومًا ستنطفئ عند منتصف الليل. طلب واحد اليوم يبقي النار مشتعلة!`,
  });
}

/* ---- Last day of the month: save the report card before History is cleared ---- */
async function reportTick() {
  const now = erbilNow();
  const t = new Date(`${now.date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  if (t.getUTCDate() !== 1 || now.minutes < 17 * 60 || now.minutes >= 21 * 60) return { skipped: "not the time" };
  const month = now.date.slice(0, 7);
  if (!(await claimAlert(`report|${month}`, "report", null))) return { skipped: "already sent" };
  return await ricoSays("report", `report|${month}`, {
    mood: "excited",
    en: (n) => `${hi("Hey", n)}! 📊 This month's report card is ready in History. Save the month there before it's cleared at midnight.`,
    ku: (n) => `${hi("هەی", n)}! 📊 کارتی ڕاپۆرتی ئەم مانگە لە مێژوودا ئامادەیە. پێش ئەوەی نیوەشەو بسڕدرێتەوە مانگەکە پاشەکەوت بکە.`,
    ar: (n) => `${ya(n)}! 📊 بطاقة تقرير هذا الشهر جاهزة في السجل. احفظ الشهر هناك قبل أن يُمسح عند منتصف الليل.`,
  }, { view: "history" });
}

/* ---- Rozha's notes: if one waits two hours unread, Rico reminds Yunis (once per note) ---- */
async function notesTick() {
  const now = erbilNow();
  if (now.minutes < 8 * 60 || now.minutes >= 22 * 60) return { skipped: "night" };
  const { data: waiting } = await sb.from("app_notes").select("id,body")
    .is("read_at", null).is("reminded_at", null).lt("created_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("created_at").limit(5);
  if (!waiting?.length) return { skipped: "nothing unread" };
  const { data: claimed } = await sb.from("app_notes").update({ reminded_at: new Date().toISOString() })
    .in("id", waiting.map((n: any) => n.id)).is("reminded_at", null).select("id");
  if (!claimed?.length) return { skipped: "claimed elsewhere" };
  const k = claimed.length;
  return await ricoSays("note", `note-remind|${claimed.map((n: any) => n.id).join(",")}`, {
    mood: "thinking",
    en: (n) => `${hi("Psst", n, ", ")}! 📝 Rozha left you ${k === 1 ? "a note" : `${k} notes`} and ${k === 1 ? "it's" : "they're"} still unread. Tap the bell at the top to read ${k === 1 ? "it" : "them"}.`,
    ku: (n) => `${hi("هێی", n)}! 📝 ڕۆژا ${k === 1 ? "تێبینییەکی" : `${k} تێبینی`} بۆ بەجێهێشتوویت و هێشتا نەتخوێندۆتەوە. زەنگەکەی سەرەوە دابگرە بۆ خوێندنەوە.`,
    ar: (n) => `${ya(n)}! 📝 تركت لك روژا ${k === 1 ? "ملاحظة" : `${k} ملاحظات`} لم تُقرأ بعد. اضغط الجرس في الأعلى لقراءتها.`,
  }, { view: "notes" }, "yunis");
}

/* Rico's good-morning message: which suppliers are due today. */
async function cheerTick() {
  const now = erbilNow();
  if (now.minutes < CHEER_AT_MIN || now.minutes >= CHEER_AT_MIN + CHEER_WINDOW_MIN) return { skipped: "outside window" };
  if (!(await claimAlert(`cheer|${now.date}`, "cheer", null))) return { skipped: "already sent today" };
  const { data: sups } = await sb.from("app_suppliers").select("name,reminder").not("reminder", "is", null);
  const dueToday = (sups ?? []).filter((s: any) => {
    const r = s.reminder;
    if (!r?.enabled) return false;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : ALL_DAYS;
    return days.includes(now.weekday);
  }).map((s: any) => String(s.name).slice(0, 40));
  const list = dueToday.slice(0, 6).join("، ");
  const listEn = dueToday.slice(0, 6).join(", ");
  const k = dueToday.length;
  const wx = await weatherWords().catch(() => ({ en: "", ku: "", ar: "" }));
  return await ricoSays("cheer", `cheer|${now.date}`, k ? {
    mood: "excited",
    en: (n) => `${hi("Good morning", n, ", ")}! ☀️ ${k} supplier${k === 1 ? " is" : "s are"} due today: ${listEn}.${wx.en} Let's get the orders out on time!`,
    ku: (n) => `${hi("بەیانیت باش", n)}! ☀️ ئەمڕۆ کاتی داواکاریی ${k} دابینکەرە: ${list}.${wx.ku} با بە کاتی خۆی بینێرین!`,
    ar: (n) => `${hi("صباح الخير", n, " يا ")}! ☀️ اليوم موعد ${k} من المورّدين: ${list}.${wx.ar} لنرسل الطلبات في وقتها!`,
  } : {
    mood: "happy",
    en: (n) => `${hi("Good morning", n, ", ")}! ☀️ No supplier is scheduled today.${wx.en} Have a great shift!`,
    ku: (n) => `${hi("بەیانیت باش", n)}! ☀️ ئەمڕۆ هیچ دابینکەرێک کاتی داواکاریی نییە.${wx.ku} ڕۆژێکی خۆش!`,
    ar: (n) => `${hi("صباح الخير", n, " يا ")}! ☀️ لا يوجد مورّد مجدول اليوم.${wx.ar} يومًا موفقًا!`,
  });
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



/* The three language versions of a message written by a person: a phone
   gets its own language, or the first one that was written. */
function written(body: any) {
  const en = String(body.bodyEn ?? "").slice(0, 300), ku = String(body.bodyKu ?? "").slice(0, 300), ar = String(body.bodyAr ?? "").slice(0, 300);
  const any = en || ku || ar;
  return { any, pick: (lang: Lang) => (lang === "ku" ? ku : lang === "ar" ? ar : en) || any };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await readJsonBody(req, 16 * 1024);
    // Rico's in-app inbox and the weather still work without Web Push.
    if (!vapidReady && body.type !== "reminder-tick") return json({ error: "VAPID keys are not set on this function" }, 500);
    switch (body.type) {
      case "reminder-tick": {
        const result: Record<string, unknown> = {};
        try { result.daily = await dailyTick(); } catch (e) { console.error("daily tick failed", e); result.daily = { error: true }; }
        try { result.suppliers = await supplierTick(); } catch (e) { console.error("supplier tick failed", e); result.suppliers = { error: true }; }
        try { result.late = await overdueTick(); } catch (e) { console.error("late-order tick failed", e); result.late = { error: true }; }
        try { result.weather = await weatherTick(); } catch (e) { console.error("weather tick failed", e); result.weather = { error: true }; }
        try { result.cheer = await cheerTick(); } catch (e) { console.error("cheer tick failed", e); result.cheer = { error: true }; }
        try { result.streak = await streakTick(); } catch (e) { console.error("streak tick failed", e); result.streak = { error: true }; }
        try { result.report = await reportTick(); } catch (e) { console.error("report tick failed", e); result.report = { error: true }; }
        try { result.notes = await notesTick(); } catch (e) { console.error("notes tick failed", e); result.notes = { error: true }; }
        return json(result);
      }
      case "update": {
        // Only the words Rozha wrote: each phone gets its own language.
        const w = written(body);
        if (!w.any) return json({ error: "empty message" }, 400);
        const { subs } = await loadSubs(false);
        return json(await send(subs, (lang) => ({ title: "Ricotta", body: w.pick(lang), kind: "update", tag: "ricotta-update" }), 86400, "normal"));
      }
      case "assistant": {
        const w = written(body);
        if (!w.any) return json({ error: "empty message" }, 400);
        const title = String(body.title || "").slice(0, 80);
        return json(await sendReminder((lang) => ({
          title: title || RICO[lang], body: w.pick(lang), kind: "assistant", mood: moodOf(body.mood), tag: `ricotta-assistant-${Date.now()}`,
        })));
      }
      case "note": {
        // A kitchen note: only the phones of the account it is for, in each phone's language.
        const account = String(body.account ?? "");
        const note = String(body.body ?? "").slice(0, 300);
        if (!ACCOUNTS.includes(account) || !note) return json({ error: "invalid note" }, 400);
        return json(await sendReminder((lang) => ({
          title: L(lang, "📝 Note from Rozha", "📝 تێبینی لە ڕۆژاوە", "📝 ملاحظة من روژا"),
          body: note, kind: "note", view: "notes", tag: `ricotta-note-${Date.now()}`,
        }), account));
      }
      case "reminder-now":
        return json(await sendReminder((lang, name) => ({ ...dailyPayload(lang, name), title: L(lang, "Ricotta Orders (test)", "Ricotta Orders (تاقیکاری)", "Ricotta Orders (تجربة)") })));
      case "supplier-test": {
        const { data: s } = await sb.from("app_suppliers").select("id,name").eq("id", String(body.supplierId ?? "")).maybeSingle();
        if (!s) return json({ error: "supplier not found" }, 404);
        return json(await sendReminder(supplierPayload(s, true)));
      }
      default:
        return json({ error: "unknown type" }, 400);
    }
  } catch (e) {
    if (e instanceof BodyTooLarge) return json({ error: "too large" }, 413);
    if (e instanceof InvalidBody) return json({ error: "invalid body" }, 400);
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
