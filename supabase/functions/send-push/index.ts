// Ricotta Orders: sends Web Push notifications.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// Only two callers exist, and both send the x-cron-secret header:
//   - pg_cron, every minute:  {type:"reminder-tick"}
//   - the api function, for a signed-in person:
//       {type:"supplier-test", supplierId}        test of one supplier's reminder
//       {type:"assistant", title, bodyEn, bodyKu, bodyAr}  a message sent through Rico
//   - the api function, after a sign-in from a phone never seen before:
//       {type:"security", account, excludeDevice, bodyEn, bodyKu, bodyAr}  to that account's other phones
//
// Every tick also runs Rico's own messages: a cheer at 09:00 Erbil time (with
// the day's weather), an hour after a supplier's reminder time with nothing
// sent, a plain reminder, at 20:00 a warning when the
// kitchen streak would end at midnight, on the last day of the month a
// reminder to save the month's report card, and a weekly summary on
// Friday evening -- each once, in the app (Rico's inbox) and as a
// notification. Erbil's weather is refreshed every hour.
//
// Every tick also runs the routines people set up with Rico (app_rico_routines): a reminder, or
// an order he prepares by himself and leaves in their inbox to check and send. Never sent to a supplier.
//
// Every push is sent in the recipient phone's own language (English, Kurdish
// or Arabic), and addresses the person signed in there by name when known.
// Reminders only go to phones that are signed in.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody, securityHeaders } from "../_shared/security.ts";
import { type PastOrder, type RoutineKind, runRoutines } from "../_shared/routines.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidReady = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (vapidReady) {
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", VAPID_PUBLIC!, VAPID_PRIVATE!);
}
/* Secrets are compared as SHA-256 digests, so the comparison takes the same time whatever was sent. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const h = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
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
  rozha: { en: "Rozh", ku: "ڕۆژا", ar: "روژا" },
  yunis: { en: "Yunis", ku: "یونس", ar: "يونس" },
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...securityHeaders, "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string; device_id: string | null; lang: string | null; account: string | null };
type Lang = "en" | "ku" | "ar";
/* A payload for one phone: its language and the name of whoever is signed in there. */
type Payload = (lang: Lang, name: string | null) => Record<string, unknown>;
const asLang = (l: string | null | undefined): Lang => (l === "ku" || l === "ar" ? l : "en");
const L = (lang: Lang, en: string, ku: string, ar: string) => (lang === "ku" ? ku : lang === "ar" ? ar : en);
const RICO: Record<Lang, string> = { en: "Rico", ku: "ریکۆ", ar: "ريكو" };
/* Rico is a calm, plain assistant: no moods. The inbox row and older phones still read a mood field,
   so every message carries the one neutral face ("calm"). */
const RICO_MOOD = "calm";

/* A name kept as one piece inside a sentence: an Arabic or Kurdish supplier name in English text (or
   the other way round) no longer flips the line or moves its punctuation. */
const iso = (s: string) => `\u2068${s}\u2069`;
/* Supplier notifications: the supplier is the title (its own line), the body is one short sentence. */
function supplierPayload(s: any, test = false): Payload {
  const name = String(s?.name ?? "").slice(0, 60);
  return (lang) => ({
    title: test ? `${name} ${L(lang, "(test)", "(تاقیکاری)", "(تجربة)")}` : name,
    body: L(lang, "Time to order.", "کاتی داواکردنە.", "حان وقت الطلب."),
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

async function sendReminder(payloadFor: Payload, only?: Set<string>) {
  const loaded = await loadSubs(true);
  const subs = only ? loaded.subs.filter((s) => s.account && only.has(s.account)) : loaded.subs;
  return { ...(await send(subs, payloadFor, 2 * 3600, "high")), skipped: loaded.skipped + loaded.subs.length - subs.length };
}

/* A read that failed is never taken as "no orders": the tick stops (and runs again next time) instead of
   telling anyone an order is late or missing. */
function must<T>(res: { data: T; error: unknown }, what: string): T {
  if (res.error) throw new Error(`${what}_unavailable`);
  return res.data;
}
/* Order lines for many orders: small id batches (URL length) and every page past the 1000-row limit. */
async function linesFor(ids: string[], columns: string) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 60) {
    for (let from = 0; ; from += 1000) {
      const page = must(await sb.from("app_order_lines").select(columns).in("order_id", ids.slice(i, i + 60)).order("id").range(from, from + 999), "order_lines") as any[];
      out.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
  }
  return out;
}
/* A message that reached no phone at all (every delivery failed) gives its once-only claim back, so the
   next tick inside the same window tries again. One that reached some phones keeps it: they never get it twice. */
const reachedNobody = (r: any) => !!r && !r.disabled && Number(r.failed) > 0 && Number(r.sent) === 0;
async function releaseAlert(id: string) {
  const { error } = await sb.from("app_assistant_alerts").delete().eq("id", id);
  if (error) console.error("alert release failed");
}
async function saysOnce(id: string, kind: string, supplierId: string | null, say: () => Promise<any>) {
  if (!(await claimAlert(id, kind, supplierId))) return null;
  let result: any;
  try { result = await say(); } catch (e) { await releaseAlert(id); throw e; }
  if (reachedNobody(result)) { await releaseAlert(id); console.error("alert not delivered, will retry", kind); }
  return result;
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
type Words = { en: (n: string) => string; ku: (n: string) => string; ar: (n: string) => string };
/* Who has Rico: Rozh always, Yunis while his access includes Rico (no saved list = the standard set, which does).
   A read that fails sends nothing. Turning his access on again brings the messages back. */
async function ricoAccounts() {
  const rows = must(await sb.from("app_accounts").select("id,roles"), "accounts") as any[];
  return new Set(ACCOUNTS.filter((a) => {
    const roles = (rows ?? []).find((r: any) => r.id === a)?.roles;
    return a === "rozha" || !Array.isArray(roles) || roles.includes("assistant");
  }));
}
async function ricoSays(kind: string, key: string, words: Words, extra: Record<string, unknown> = {}) {
  const allowed = await ricoAccounts();
  const { error } = await sb.from("app_rico_inbox").upsert(ACCOUNTS.filter((a) => allowed.has(a)).map((a) => ({
    account: a, kind, mood: RICO_MOOD, body_en: words.en(NAMES[a].en), body_ku: words.ku(NAMES[a].ku), body_ar: words.ar(NAMES[a].ar),
    dedupe_key: `${key}|${a}`,
  })), { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
  // extra.title / extra.push: a notification shorter than the inbox message (the supplier as the title).
  const { title, push, ...rest } = extra as { title?: string; push?: Record<Lang, string> } & Record<string, unknown>;
  return await sendReminder((lang, name) => ({
    title: title || RICO[lang],
    body: push ? push[lang] : lang === "ku" ? words.ku(name ?? "") : lang === "ar" ? words.ar(name ?? "") : words.en(name ?? ""),
    kind: "assistant", mood: RICO_MOOD, tag: `ricotta-rico-${key}`,
    ...(rest.supplierId ? { actionTitle: lang === "ku" ? "ئامادەی بکە" : lang === "ar" ? "جهّزه" : "Prepare it" } : {}), ...rest,
  }), allowed);
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
  const sups = must(await sb.from("app_suppliers").select("id,name,reminder").not("reminder", "is", null), "suppliers") as any[];
  for (const s of sups ?? []) {
    const r = s.reminder;
    if (!r?.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time))) continue;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : ALL_DAYS;
    const hit = lateFor(r.time, days, r.updatedAt);
    if (hit) due.push({ ...s, ...hit });
  }
  if (!due.length) return { skipped: "nothing late" };

  // Orders sent since the start of yesterday, so each check can use its own day.
  const since = recentDays()[1].date;
  const orders = must(await sb.from("app_orders").select("id,sent_at").eq("status", "sent").gte("sent_at", `${since}T00:00:00${ERBIL_OFFSET}`), "orders") as any[];
  const sentAt = new Map((orders ?? []).map((o: any) => [o.id, Date.parse(o.sent_at)]));
  const ids = [...sentAt.keys()];
  const lines = await linesFor(ids, "order_id,supplier_id");
  const dayStart = (date: string) => Date.parse(`${date}T00:00:00${ERBIL_OFFSET}`);
  const sentSince = (date: string, supplierId?: string) =>
    (lines ?? []).some((l: any) => (!supplierId || l.supplier_id === supplierId) && (sentAt.get(l.order_id) ?? 0) >= dayStart(date))
    || (!supplierId && [...sentAt.values()].some((t) => t >= dayStart(date)));
  const out: unknown[] = [];
  for (const s of due) {
    if (sentSince(s.date, s.id)) continue;
    const name = String(s.name).slice(0, 60), time = s.reminder.time;
    const said = await saysOnce(`overdue|${s.id}|${s.date}`, "overdue", s.id, () => ricoSays("overdue", `overdue|${s.id}|${s.date}`, {
      en: () => `${iso(name)}: not sent yet, due at ${time}.`,
      ku: () => `${iso(name)}: هێشتا نەنێردراوە، کاتەکەی ${time} بوو.`,
      ar: () => `${iso(name)}: لم يُرسل بعد، موعده ${time}.`,
    }, { supplierId: String(s.id), title: name, push: {
      en: `Not sent yet, due at ${time}.`, ku: `هێشتا نەنێردراوە، کاتەکەی ${time} بوو.`, ar: `لم يُرسل بعد، موعده ${time}.`,
    } }));
    if (said) out.push({ supplier: name, ...said });
  }
  return out;
}

/* ---- Rico's routines (see ../_shared/routines.ts) ----
   Who may still use one: Rico on for that account (as ricoAccounts), and History too for a prepared
   order (it is worked out from past orders). A saved list without the role stops the routine quietly. */
const STANDARD_ROLES = ["history", "assistant"];
async function routineTick() {
  const rows = must(await sb.from("app_accounts").select("id,roles"), "accounts") as any[];
  const has = (account: string, role: string) => {
    if (account === "rozha") return true;
    const roles = (rows ?? []).find((r: any) => r.id === account)?.roles;
    return Array.isArray(roles) ? roles.includes(role) : STANDARD_ROLES.includes(role);
  };
  return await runRoutines(sb, {
    now: erbilNow(),
    canUse: (account: string, kind: RoutineKind) => ACCOUNTS.includes(account) && has(account, "assistant") && (kind !== "prepare_order" || has(account, "history")),
    history: async () => {
      const since = new Date(Date.now() - 60 * 86400_000).toISOString();
      const orders = must(await sb.from("app_orders").select("id,sent_at").eq("status", "sent").gte("sent_at", since)
        .order("sent_at", { ascending: false }).limit(600), "orders") as any[];
      const lines = await linesFor((orders ?? []).map((o: any) => o.id), "order_id,item_id,supplier_id,qty");
      const byOrder = new Map<string, any[]>();
      for (const l of lines) (byOrder.get(l.order_id) ?? byOrder.set(l.order_id, []).get(l.order_id)!).push(l);
      const weekdayOf = (iso: string) => new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso))}T12:00:00Z`).getUTCDay();
      const past: PastOrder[] = (orders ?? []).map((o: any) => ({ weekday: weekdayOf(o.sent_at), lines: byOrder.get(o.id) ?? [] }));
      const items = await readAll(() => sb.from("app_items").select("id,available").order("id"));
      const sups = await readAll(() => sb.from("app_suppliers").select("id,name").order("id"));
      return { orders: past, available: new Set(items.filter((i: any) => i.available !== false).map((i: any) => String(i.id))),
        suppliers: new Map(sups.map((x: any) => [String(x.id), String(x.name ?? "")])) };
    },
    notify: (account, words, tag) => sendReminder((lang) => ({
      title: RICO[lang], body: lang === "ku" ? words.ku : lang === "ar" ? words.ar : words.en,
      kind: "assistant", mood: RICO_MOOD, tag,
    }), new Set([account])),
  });
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
    en: () => `Send one order today to keep the ${k}-day streak.`,
    ku: () => `ئەمڕۆ یەک داواکاری بنێرە بۆ ئەوەی زنجیرەی ${k} ڕۆژە بمێنێت.`,
    ar: () => `أرسل طلبًا واحدًا اليوم لتبقى سلسلة الـ${k} يومًا.`,
  });
}

/* ---- Last day of the month: save the report card before History is cleared ---- */
async function reportTick() {
  const now = erbilNow();
  const t = new Date(`${now.date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  if (t.getUTCDate() !== 1 || now.minutes < 17 * 60 || now.minutes >= 21 * 60) return { skipped: "not the time" };
  const month = now.date.slice(0, 7);
  return await saysOnce(`report|${month}`, "report", null, () => ricoSays("report", `report|${month}`, {
    en: () => `This month's report is ready in History.`,
    ku: () => `ڕاپۆرتی ئەم مانگە لە مێژوودا ئامادەیە.`,
    ar: () => `تقرير هذا الشهر جاهز في السجل.`,
  }, { view: "history" })) ?? { skipped: "already sent" };
}


/* ---- The 1st of the month: Rico's letter about the month that ended, from its summary ---- */
async function letterTick() {
  const now = erbilNow();
  if (now.date.slice(8) !== "01" || now.minutes < 9 * 60) return { skipped: "not the time" };
  const rows = must(await sb.from("app_month_summaries").select("month,data").lt("month", now.date.slice(0, 7)).order("month", { ascending: false }).limit(2), "months") as any[];
  const last = rows?.[0];
  if (!last) return { skipped: "no finished month" };
  const n = Number(last.data?.orders) || 0, top = String(last.data?.topItems?.[0]?.name ?? "").slice(0, 60);
  const before = rows?.[1] ? Number(rows[1].data?.orders) || 0 : null;
  const change = (more: string, fewer: string, same: string) => before === null ? "" : n > before ? more.replace("#", String(n - before)) : n < before ? fewer.replace("#", String(before - n)) : same;
  const key = `letter|${last.month}`;
  return await saysOnce(key, "report", null, () => ricoSays("report", key, {
    en: () => `${last.month}: ${n} orders${change(", # more than the month before", ", # fewer than the month before", ", the same as the month before")}${top ? `. Most ordered: ${top}` : ""}. The full report is in History, Past months.`,
    ku: () => `${last.month}: ${n} داواکاری${before === null ? "" : n > before ? `، ${n - before} زیاتر لە مانگی پێشوو` : n < before ? `، ${before - n} کەمتر لە مانگی پێشوو` : `، وەک مانگی پێشوو`}${top ? `. زۆرترین داواکراو: ${top}` : ""}. ڕاپۆرتی تەواو لە مێژوو، مانگەکانی ڕابردوو.`,
    ar: () => `${last.month}: ${n} طلبًا${before === null ? "" : n > before ? `، بزيادة ${n - before} عن الشهر السابق` : n < before ? `، بنقص ${before - n} عن الشهر السابق` : `، مثل الشهر السابق`}${top ? `. الأكثر طلبًا: ${top}` : ""}. التقرير الكامل في السجل، الأشهر الماضية.`,
  }, { view: "history" })) ?? { skipped: "already sent" };
}

/* ---- Each morning: one quiet line for Rozh in Rico's messages, no notification ---- */
async function healthTick() {
  const now = erbilNow();
  if (now.minutes < 8 * 60) return { skipped: "before 8:00" };
  const copy = must(await sb.from("app_backups").select("day").order("day", { ascending: false }).limit(1), "backups") as any[];
  const ai = must(await sb.from("app_ai_status").select("provider,state"), "ai") as any[];
  const subs = must(await sb.from("app_push_subscriptions").select("endpoint").limit(1), "subs") as any[];
  const yesterday = new Date(Date.parse(`${now.date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const backupOk = !!copy?.[0] && String(copy[0].day) >= yesterday;
  const aiOk = (ai ?? []).some((a: any) => a.state === "working");
  const pushOk = (subs ?? []).length > 0;
  const allOk = backupOk && aiOk && pushOk;
  const say = (ok: boolean, good: string, bad: string) => ok ? good : bad;
  const { error } = await sb.from("app_rico_inbox").upsert([{
    account: "rozha", kind: "health", mood: RICO_MOOD, dedupe_key: `health|${now.date}|rozha`,
    body_en: `Daily check: backup ${say(backupOk, "OK", "missing")}, Rico ${say(aiOk, "OK", "having trouble")}, notifications ${say(pushOk, "OK", "no phones signed up")}.`,
    body_ku: `پشکنینی ڕۆژانە: پاشەکەوت ${say(backupOk, "باشە", "نییە")}، ریکۆ ${say(aiOk, "باشە", "کێشەی هەیە")}، ئاگادارکردنەوەکان ${say(pushOk, "باشە", "هیچ ئامێرێک تۆمار نەکراوە")}.`,
    body_ar: `الفحص اليومي: النسخة الاحتياطية ${say(backupOk, "سليمة", "غير موجودة")}، ريكو ${say(aiOk, "سليم", "به مشكلة")}، الإشعارات ${say(pushOk, "سليمة", "لا أجهزة مسجلة")}.`,
  }], { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
  return { ok: allOk };
}

/* ---- 2 days before the wipe day: Rico says so once, in the morning ---- */
async function wipeTick() {
  const now = erbilNow();
  if (now.minutes < 9 * 60) return { skipped: "before 9:00" };
  const row = must(await sb.from("app_wipe").select("next_wipe").eq("id", true).maybeSingle(), "wipe") as any;
  if (!row?.next_wipe) return { skipped: "no wipe day" };
  const left = Math.round((Date.parse(`${row.next_wipe}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 86400000);
  if (left !== 2) return { skipped: "not yet" };
  const key = `wipe|${row.next_wipe}`;
  return await saysOnce(key, "wipe", null, () => ricoSays("wipe", key, {
    en: () => `In 2 days, orders, Records and chats older than 60 days are deleted, so save what you need.`,
    ku: () => `دوای 2 ڕۆژ داواکاری، تۆمار و گفتوگۆی کۆنتر لە 60 ڕۆژ دەسڕدرێنەوە، ئەوەی پێویستتە پاشەکەوتی بکە.`,
    ar: () => `بعد يومين تُحذف الطلبات والسجلات والمحادثات الأقدم من 60 يومًا، فاحفظ ما تحتاجه.`,
  }));
}

/* ---- Friday evening: the week in a few lines (orders vs last week, the streak, the top item) ---- */
async function weeklyTick() {
  const now = erbilNow();
  if (now.weekday !== 5 || now.minutes < 17 * 60 || now.minutes >= 21 * 60) return { skipped: "not the time" };
  const dayMs = 86400_000, end = Date.now(), start = end - 7 * dayMs;
  const orders = must(await sb.from("app_orders").select("id,sent_at").eq("status", "sent").gte("sent_at", new Date(start - 7 * dayMs).toISOString()), "orders") as any[];
  const thisWeek = (orders ?? []).filter((o: any) => Date.parse(o.sent_at) >= start), lastWeek = (orders ?? []).filter((o: any) => Date.parse(o.sent_at) < start);
  const ids = thisWeek.map((o: any) => o.id);
  const lines = await linesFor(ids, "item_name");
  const tally = new Map<string, number>();
  for (const l of lines ?? []) tally.set(l.item_name, (tally.get(l.item_name) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const st = must(await sb.from("app_streak").select("count,last_day").eq("id", true).maybeSingle(), "streak") as any;
  const y = new Date(`${now.date}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  const streak = st && (String(st.last_day) === now.date || String(st.last_day) === y.toISOString().slice(0, 10)) ? Number(st.count) : 0;
  const k = thisWeek.length, p = lastWeek.length;
  const trend = { en: k > p ? `up from ${p} last week` : k < p ? `down from ${p} last week` : "the same as last week",
    ku: k > p ? `زیاتر لە ${p}ی هەفتەی پێشوو` : k < p ? `کەمتر لە ${p}ی هەفتەی پێشوو` : "وەک هەفتەی پێشوو",
    ar: k > p ? `أكثر من ${p} في الأسبوع الماضي` : k < p ? `أقل من ${p} في الأسبوع الماضي` : "مثل الأسبوع الماضي" };
  return await saysOnce(`weekly|${now.date}`, "weekly", null, () => ricoSays("weekly", `weekly|${now.date}`, {
    en: () => `This week: ${k} order${k === 1 ? "" : "s"}, ${trend.en}.${top ? ` Most ordered: ${iso(top)}.` : ""}${streak ? ` Streak: ${streak} days.` : ""}`,
    ku: () => `ئەم هەفتەیە: ${k} داواکاری، ${trend.ku}.${top ? ` زۆرترین داواکراو: ${iso(top)}.` : ""}${streak ? ` زنجیرە: ${streak} ڕۆژ.` : ""}`,
    ar: () => `هذا الأسبوع: ${k} طلب، ${trend.ar}.${top ? ` الأكثر طلبًا: ${iso(top)}.` : ""}${streak ? ` السلسلة: ${streak} يومًا.` : ""}`,
  }, { view: "history", push: {
    en: `This week: ${k} order${k === 1 ? "" : "s"}, ${trend.en}.`, ku: `ئەم هەفتەیە: ${k} داواکاری، ${trend.ku}.`, ar: `هذا الأسبوع: ${k} طلب، ${trend.ar}.`,
  } }));
}

/* Rico's good-morning message: which suppliers are due today. */
async function cheerTick() {
  const now = erbilNow();
  if (now.minutes < CHEER_AT_MIN || now.minutes >= CHEER_AT_MIN + CHEER_WINDOW_MIN) return { skipped: "outside window" };
  const sups = must(await sb.from("app_suppliers").select("name,reminder").not("reminder", "is", null), "suppliers") as any[];
  const dueToday = (sups ?? []).filter((s: any) => {
    const r = s.reminder;
    if (!r?.enabled) return false;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : ALL_DAYS;
    return days.includes(now.weekday);
  }).map((s: any) => String(s.name).slice(0, 40));
  const list = dueToday.slice(0, 6).map(iso).join("، ");
  const listEn = dueToday.slice(0, 6).map(iso).join(", ");
  const k = dueToday.length;
  const wx = await weatherWords().catch(() => ({ en: "", ku: "", ar: "" }));
  return await saysOnce(`cheer|${now.date}`, "cheer", null, () => ricoSays("cheer", `cheer|${now.date}`, k ? {
    en: () => `Due today: ${listEn}.${wx.en}`,
    ku: () => `کاتی داواکاریی ئەمڕۆ: ${list}.${wx.ku}`,
    ar: () => `موعد الطلب اليوم: ${list}.${wx.ar}`,
  } : {
    en: () => `No suppliers due today.${wx.en}`,
    ku: () => `ئەمڕۆ هیچ دابینکەرێک کاتی داواکاریی نییە.${wx.ku}`,
    ar: () => `لا يوجد مورّد موعده اليوم.${wx.ar}`,
  })) ?? { skipped: "already sent today" };
}

/* ---- Per-supplier reminders ----
   reminder = { enabled, time: "HH:MM" (Erbil), days: [0..6] (0 = Sunday), updatedAt } */
async function supplierTick() {
  const data = must(await sb.from("app_suppliers").select("id,name,reminder").not("reminder", "is", null), "suppliers") as any[];
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
  if (!CRON_SECRET || !(await sameSecret(req.headers.get("x-cron-secret") ?? "", CRON_SECRET))) return json({ error: "forbidden" }, 403);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await readJsonBody(req, 16 * 1024);
    // Rico's in-app inbox and the weather still work without Web Push.
    if (!vapidReady && body.type !== "reminder-tick") return json({ error: "VAPID keys are not set on this function" }, 500);
    switch (body.type) {
      case "reminder-tick": {
        const result: Record<string, unknown> = {};
        try { result.suppliers = await supplierTick(); } catch (e) { console.error("supplier tick failed", e); result.suppliers = { error: true }; }
        try { result.late = await overdueTick(); } catch (e) { console.error("late-order tick failed", e); result.late = { error: true }; }
        try { result.weather = await weatherTick(); } catch (e) { console.error("weather tick failed", e); result.weather = { error: true }; }
        try { result.cheer = await cheerTick(); } catch (e) { console.error("cheer tick failed", e); result.cheer = { error: true }; }
        try { result.streak = await streakTick(); } catch (e) { console.error("streak tick failed", e); result.streak = { error: true }; }
        try { result.report = await reportTick(); } catch (e) { console.error("report tick failed", e); result.report = { error: true }; }
        try { result.letter = await letterTick(); } catch (e) { console.error("letter tick failed", e); result.letter = { error: "failed" }; }
        try { result.health = await healthTick(); } catch (e) { console.error("health tick failed", e); result.health = { error: "failed" }; }
        try { result.wipe = await wipeTick(); } catch (e) { console.error("wipe tick failed", e); result.wipe = { error: "failed" }; }
        try { result.weekly = await weeklyTick(); } catch (e) { console.error("weekly tick failed", e); result.weekly = { error: true }; }
        try { result.routines = await routineTick(); } catch (e) { console.error("routine tick failed", e); result.routines = { error: true }; }
        return json(result);
      }
      case "security": {
        // A sign-in from a phone never seen before: the account's other signed-in phones, never that one.
        const w = written(body);
        const account = ACCOUNTS.includes(body.account) ? body.account : null;
        if (!w.any || !account) return json({ error: "invalid security alert" }, 400);
        const { subs } = await loadSubs(true);
        const mine = subs.filter((s) => s.account === account && s.device_id !== String(body.excludeDevice ?? ""));
        return json(await send(mine, (lang) => ({ title: L(lang, "New sign-in", "چوونەژوورەوەی نوێ", "تسجيل دخول جديد"), body: w.pick(lang), kind: "security", view: "admin", tag: `ricotta-security-${Date.now()}` }), 6 * 3600, "high"));
      }
      case "assistant": {
        const w = written(body);
        if (!w.any) return json({ error: "empty message" }, 400);
        const title = String(body.title || "").slice(0, 80);
        // Without its own title this message comes from Rico, so it follows who has Rico.
        return json(await sendReminder((lang) => ({
          title: title || RICO[lang], body: w.pick(lang), kind: "assistant", mood: RICO_MOOD, tag: `ricotta-assistant-${Date.now()}`,
        }), title ? undefined : await ricoAccounts()));
      }
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
