import { monthStart, monthKey } from "../_shared/month.ts";
// Ricotta Orders API -- the only door between the browser and the database.
//
// The browser never talks to Postgres directly: every request carries an
// opaque session token (issued by POST /login after a bcrypt PIN check) and
// this function uses the service-role key server-side.
//
// There are two accounts, each with its own PIN:
//   rozha  full access
//   yunis  Order, Rico, History (cannot delete), Suppliers, Items, Record, Units
//
// Routes (all JSON):
//   POST   login                      {pin}                     -> {token, account, name, tabs, expiresAt}
//                                                                  or {recovery:true, ticket} for the secret code
//   POST   recovery/name              {ticket, name}            step 2 of the secret code: the saved answer, exactly
//   POST   recovery/verify            {ticket, pin}             step 3: Rozha's current PIN
//   POST   recovery/save              {ticket, rozhaPin?, yunisPin?, secretCode?, answer?}
//   GET    health
//   --- session required ---
//   GET    bootstrap                                            -> everything the app needs to start
//   POST   logout
//   PUT    me/tabs                    {tabs:[3 views]}          this account's tab bar
//   PUT    me/theme                   {theme?, auto?}           this account's theme, and whether holiday themes switch on by themselves
//   PUT    me/pins                    {itemIds}                 items pinned to the top of this account's Order screen
//   PUT    suppliers/:id | items/:id | units/:id                upsert one record (+ its Record entry)
//   DELETE suppliers/:id | items/:id | units/:id                delete one record (+ its Record entry)
//   PUT    supplier-order/:supplierId {itemIds}                 item order for one supplier
//   POST   orders                     {id, date, entries}       save a sent order
//   DELETE orders/:id                 rozha: any; the sender: undo within 15 minutes
//   GET    streak                                               the kitchen streak
//   POST   streak/recover                                       Rico brings a broken kitchen streak back
//   GET    notes                                                kitchen notes (Rozha writes, Yunis reads)
//   POST   notes                      {body} (rozha)            leave a note for Yunis (he gets a notification)
//   DELETE notes/:id                  (rozha)                   remove a note
//   POST   notes/:id/read | notes/:id/done (yunis)              seen / done
//   GET    rico-chats[?account=]                                both accounts' Rico chats (each can read and delete the other's)
//   GET    activity                                             the Record
//   GET    devices                    rozha: all, yunis: own row
//   POST   devices/me                                           heartbeat ("still here")
//   POST   devices/me/ack             {commandId}               a remote command was carried out
//   POST   devices/command            {ids, type} (rozha)       remote log out / refresh
//   PUT    push/subscription          {endpoint,p256dh,auth,lang}
//   DELETE push/subscription          {endpoint}
//   PUT    push/lang                  {endpoint, lang}
//   PUT    reminder                   {enabled, time}           daily reminder settings
//   POST   push/send                  {type, ...}               forwarded to send-push
//   POST   assistant/chat             {messages, lang, ...}     Rico's reply, streamed (see assistant.ts)
//   POST   assistant/transcribe       {audio, mime, lang}       a voice message to Rico, as text
//   GET    assistant/suggestion                                 today's "Rico suggests" card (no AI call)
//   GET    assistant/inbox                                      messages Rico sent first
//   POST   assistant/inbox/read                                 mark them read
//   GET    assistant/status                                     is Rico connected?
//   GET    assistant/setup-status     (rozha)                   Groq one-time setup state
//   PUT    assistant/groq-key         {key} (rozha)             add-only
//   POST   notes/:id/reply            {body} (yunis)            answer one of Rozha's notes (she gets a notification)
//   POST   notes/replies-seen         (rozha)                   Rozha has read Yunis's answers
//   GET    repeat-orders                                        orders that come back on chosen weekdays
//   POST   repeat-orders              {name, days, entries}     save one (both accounts)
//   PUT    repeat-orders/:id          {name?, days?}            change its name or days
//   DELETE repeat-orders/:id
//   GET    months                                               the archive: one summary per finished month
//   POST   passkey/register-options                             Face ID: a challenge to create this phone's passkey
//   POST   passkey/register           {id, clientDataJSON, authenticatorData, publicKey, alg}
//   DELETE passkey                    {id}                      turn Face ID off on this phone
//   POST   passkey/login-options      (public)                  Face ID: a challenge to sign in
//   POST   passkey/login              (public) {id, clientDataJSON, authenticatorData, signature}
//                                                                -> the same reply as login
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { assistantSetupStatus, assistantStatus, handleChat, handleTranscribe, orderSuggestion, saveGroqKey } from "./assistant.ts";
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody } from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const SESSION_HOURS = 18;
const LOGIN_WINDOW_MS = 10 * 60_000;
const MAX_FAILED_LOGINS = 8;              // per network address, per window (spoofable -- see MAX_GLOBAL_FAILED_LOGINS)
const MAX_GLOBAL_FAILED_LOGINS = 40;      // per window, across ALL claimed IPs -- not spoofable via headers
const RECOVERY_TICKET_MS = 5 * 60_000;    // each secret-code step must be finished within this time
const SEEN_WRITE_EVERY_MS = 5 * 60_000;   // throttle session last_seen_at writes
const PAGE = 1000;                        // PostgREST returns at most 1000 rows per request
const RECORD_TYPES = ["supplier", "item", "unit"];
const RECORD_ACTIONS = ["add", "edit", "delete"];
const LANGS = ["en", "ku", "ar"];
// Every screen of the app, and the ones each account may open.
const THEMES = ["ricotta", "graphite", "ocean", "saffron", "berry",
  "halloween", "winter", "newroz", "ramadan", "summer", "eid", "christmas", "flagday", "spring", "autumn", "match"];
const cleanTheme = (v: unknown) => THEMES.includes(String(v)) ? String(v) : "ricotta";
const VIEWS = ["order", "assistant", "history", "suppliers", "itemsAdmin", "units", "record", "devices", "settings"];
const ACCOUNT_VIEWS: Record<string, string[]> = {
  rozha: VIEWS,
  yunis: ["order", "assistant", "history", "suppliers", "itemsAdmin", "units", "record"],
};
// Allowed browser origin for this app. Set ALLOWED_ORIGIN if the production
// site ever moves to another origin.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://rozhzero969-hub.github.io";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-device-label, x-app-version, x-session-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  // Let browsers reuse the pre-flight answer for a day instead of sending an
  // extra OPTIONS request before every single call.
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const ok = () => json({ ok: true });
const fail = (error: string, status = 400) => json({ error }, status);

const app = (table: string) => db.from(`app_${table}`);
const text = (v: unknown, max = 160) => String(v ?? "").trim().slice(0, max);
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
/* A Baghdad calendar day as YYYY-MM-DD, and whole days between two of them. */
const baghdadDay = (d: Date | string = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400_000);
/* What the device says it is ("iPhone 16/17 Pro Max|App"), for the Devices screen. */
const deviceLabel = (req: Request) => text(req.headers.get("x-device-label"), 80).replace(/[^\x20-\x7E]/g, "") || null;
/* Which version of the app the device runs (APP_VERSION in config.js), for the Devices screen. */
const appVersion = (req: Request) => { const v = text(req.headers.get("x-app-version"), 40); return /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : null; };
const nowIso = () => new Date().toISOString();
const langOf = (v: unknown) => (LANGS.includes(String(v)) ? String(v) : "en");
const randomToken = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const hash = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
};
/* Request bodies are small JSON everywhere except a voice clip for Rico.
   Anything larger than the route allows is refused before it is parsed, so a
   huge upload can't tie up the function. */
const MAX_BODY_BYTES = 256 * 1024;
const MAX_AUDIO_BODY_BYTES = 3 * 1024 * 1024;
const readBody = (req: Request, max = MAX_BODY_BYTES) => readJsonBody(req, max);
/* A supplier reminder is stored as JSON; only these fields in these shapes
   are kept, so a client can't park arbitrary data in the database. */
function cleanReminder(r: any) {
  if (!r || typeof r !== "object") return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time ?? "")) ? String(r.time) : null;
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const updatedAt = r.updatedAt && !isNaN(Date.parse(r.updatedAt)) ? new Date(r.updatedAt).toISOString() : null;
  if (!time) return r.enabled ? null : (updatedAt ? { enabled: false, updatedAt } : null);
  return { enabled: !!r.enabled, time, days, ...(updatedAt ? { updatedAt } : {}) };
}
/* Rejects the most obviously guessable 6-digit PINs: all one digit
   (111111...) or a straight run (123456, 654321, ...). Only for the two
   account PINs; the secret code is Rozha's own choice. */
function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const down = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return up || down;
}

type Account = "rozha" | "yunis";
type Session = { id: string; account: Account; deviceId: string | null };
const isRozha = (s: Session) => s.account === "rozha";

async function authenticate(req: Request): Promise<Session | null> {
  const raw = req.headers.get("x-session-token") || req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw) return null;
  const { data } = await app("sessions")
    .select("id,account,device_id,expires_at,revoked_at,last_seen_at")
    .eq("token_hash", await hash(raw)).maybeSingle();
  if (!data || data.revoked_at || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null;
  if (data.account !== "rozha" && data.account !== "yunis") return null;
  if (Date.now() - new Date(data.last_seen_at).getTime() > SEEN_WRITE_EVERY_MS) {
    await app("sessions").update({ last_seen_at: nowIso() }).eq("id", data.id);
  }
  return { id: data.id, account: data.account, deviceId: data.device_id };
}
const accountName = (a: string) => (a === "rozha" ? "Rozha" : a === "yunis" ? "Yunis" : a);
/* Each name in the script of each language, for Rico's messages. */
const LOCAL_NAMES: Record<string, { en: string; ku: string; ar: string }> = {
  rozha: { en: "Rozha", ku: "ڕۆژا", ar: "روژا" },
  yunis: { en: "Yunis", ku: "یونس", ar: "يونس" },
};

/* ---------- Shapes the browser uses ---------- */
const toSupplier = (s: any) => ({ id: s.id, name: s.name, phone: s.phone, reminder: s.reminder, cutoff: s.cutoff ?? null });
const toItem = (i: any) => ({ id: i.id, name: i.name, unit: i.unit_id, supplierId: i.supplier_id, sortOrder: i.sort_order, note: i.note ?? "", aliases: i.aliases ?? [], available: i.available !== false });
const toNote = (n: any) => ({ id: n.id, body: n.body, at: n.created_at, readAt: n.read_at, doneAt: n.done_at,
  reply: n.reply ?? null, repliedAt: n.replied_at ?? null, replySeenAt: n.reply_seen_at ?? null });
const toRepeat = (r: any) => ({ id: r.id, name: r.name, days: r.days, entries: r.entries, by: r.created_by, createdAt: r.created_at });
const NOTE_COLUMNS = "id,body,created_at,read_at,done_at,reply,replied_at,reply_seen_at";
/* The kitchen streak as the app shows it. lit: today already has an order; alive: yesterday or today
   had one; recoverable: how many days Rico can bring back after it broke. */
function streakView(r: any) {
  const today = baghdadDay();
  const count = Number(r?.count ?? 0), last = r?.last_day ? String(r.last_day) : null;
  const gap = last ? dayDiff(today, last) : 99;
  const alive = count > 0 && gap <= 1;
  const lostDay = r?.lost_day ? String(r.lost_day) : null;
  const recoverable = !alive && count > 0 && gap <= 8 ? count
    : Number(r?.lost_count ?? 0) > 0 && lostDay && dayDiff(today, lostDay) <= 7 ? Number(r.lost_count) : 0;
  return { count: alive ? count : 0, best: Number(r?.best ?? 0), lit: alive && gap === 0, alive, recoverable, lastDay: last };
}
async function readStreak() {
  const { data, error } = await app("streak").select("count,best,last_day,lost_count,lost_day").eq("id", true).maybeSingle();
  if (error) throw error;
  return streakView(data);
}
async function listNotes() {
  const { data, error } = await app("notes").select(NOTE_COLUMNS).order("created_at", { ascending: false }).limit(40);
  if (error) throw error;
  return (data ?? []).map(toNote);
}
async function readWeather() {
  const { data } = await app("weather").select("data,updated_at").eq("id", true).maybeSingle();
  return data?.updated_at ? { ...(data.data ?? {}), updatedAt: data.updated_at } : null;
}
const toDevice = (d: any) => ({
  id: d.id, account: d.account ?? null, label: d.label ?? null, loggedIn: d.logged_in,
  lastLogin: d.last_login, lastSeen: d.last_seen, command: d.command, handledCommand: d.handled_command,
  appVersion: d.app_version ?? null,
});
const toActivity = (a: any) => ({
  ...(a.payload ?? {}), id: a.id, ts: a.occurred_at, actor: a.actor, deviceId: a.device_id,
  action: a.action, type: a.entity_type, name: a.entity_name,
});
const toInbox = (m: any) => ({ id: m.id, kind: m.kind, mood: m.mood, en: m.body_en, ku: m.body_ku, ar: m.body_ar, at: m.created_at, read: !!m.read_at });
/* Reads every row of a query, 1000 at a time (a single request silently stops
   at 1000 rows, which used to cut long order histories short). */
async function readAll(build: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
function groupHistory(orders: any[], lines: any[]) {
  const byOrder = new Map<string, any[]>();
  for (const l of lines) (byOrder.get(l.order_id) ?? byOrder.set(l.order_id, []).get(l.order_id)!).push(l);
  return orders.map((o) => {
    const entries: any[] = [];
    for (const l of byOrder.get(o.id) ?? []) {
      const supplierId = l.supplier_id ?? null, supplierName = l.supplier_name ?? null;
      // Deleted suppliers all have a null id. Their saved names still keep
      // separate supplier sections in History instead of merging their lines.
      let e = entries.find((x) => x.supplierId === supplierId && (supplierId !== null || x.supplierName === supplierName));
      if (!e) { e = { supplierId, supplierName, items: [] }; entries.push(e); }
      e.items.push({ itemId: l.item_id, name: l.item_name, unit: l.unit_id, qty: Number(l.qty) });
    }
    return { id: o.id, date: o.sent_at ?? o.created_at, by: o.sent_by ?? null, note: o.note ?? "", entries };
  });
}

async function listDevices(s: Session) {
  let q = app("devices").select("id,account,label,logged_in,last_login,last_seen,command,handled_command,app_version");
  if (!isRozha(s)) q = q.eq("id", s.deviceId ?? "");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toDevice);
}
async function listActivity() {
  const rows = await readAll(() => app("audit_events")
    .select("id,occurred_at,actor,device_id,action,entity_type,entity_name,payload")
    .gte("occurred_at",monthStart()).in("action",RECORD_ACTIONS).in("entity_type",RECORD_TYPES)
    .order("occurred_at",{ascending:false}).order("id"));
  return rows.map(toActivity);
}
async function listInbox(s: Session) {
  const { data, error } = await app("rico_inbox").select("id,kind,mood,body_en,body_ku,body_ar,created_at,read_at")
    .eq("account", s.account).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).reverse().map(toInbox);
}
async function readReminder() {
  const { data, error } = await app("reminder_settings").select("enabled,remind_time").eq("id", true).maybeSingle();
  if (error) throw error;
  return data ? { enabled: data.enabled, time: String(data.remind_time).slice(0, 5) } : null;
}
async function readAccount(id: string) {
  const { data, error } = await app("accounts").select("id,name,tabs,theme,auto_theme,pins,message_format").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { account: data.id, name: data.name, tabs: cleanTabs(data.id, data.tabs), theme: cleanTheme(data.theme), autoTheme: data.auto_theme !== false, pins: Array.isArray(data.pins) ? data.pins : [], messageFormat: data.message_format ?? {} } : null;
}
/* Both accounts' themes, so a person is shown in their own colours on every phone. */
async function readThemes(): Promise<{ themes: Record<string, string>; autoThemes: Record<string, boolean> }> {
  const { data, error } = await app("accounts").select("id,theme,auto_theme");
  if (error) throw error;
  return {
    themes: Object.fromEntries((data ?? []).map((a: any) => [a.id, cleanTheme(a.theme)])),
    autoThemes: Object.fromEntries((data ?? []).map((a: any) => [a.id, a.auto_theme !== false])),
  };
}
/* Three different screens this account may open, in the order chosen. */
function cleanTabs(account: string, tabs: unknown): string[] {
  const allowed = ACCOUNT_VIEWS[account] ?? [];
  const list = Array.isArray(tabs) ? [...new Set(tabs.map((t) => String(t)))].filter((t) => allowed.includes(t)) : [];
  return list.length === 3 ? list : ["order", "assistant", "history"];
}

async function orderLinesFor(orderRows: any[]): Promise<any[]> {
  // Lines are read in small batches of orders: a long id list in one request
  // can exceed the URL length limit, and each batch is paged past 1000 rows.
  const lines: any[] = [];
  for (let i = 0; i < orderRows.length; i += 60) {
    const ids = orderRows.slice(i, i + 60).map((o) => o.id);
    lines.push(...await readAll(() => app("order_lines")
      .select("order_id,supplier_id,supplier_name,item_id,item_name,unit_id,qty").in("order_id", ids).order("id")));
  }
  return lines;
}

async function bootstrap(s: Session) {
  const since = monthStart();
  const [me, looks, suppliers, items, units, orders, reminder, devices, activity, inbox, streak, notes, weather, repeats, months, draft] = await Promise.all([
    readAccount(s.account),
    readThemes(),
    app("suppliers").select("id,name,phone,reminder,cutoff").order("name"),
    app("items").select("id,name,unit_id,supplier_id,sort_order,note,aliases,available").order("name"),
    app("units").select("id,en,ku,ar"),
    readAll(() => app("orders").select("id,created_at,sent_at,sent_by,note").eq("status", "sent").gte("sent_at", since).order("sent_at").order("id")),
    readReminder(),
    listDevices(s),
    listActivity(),
    listInbox(s),
    readStreak(),
    listNotes(),
    readWeather().catch(() => null),
    listRepeats(),
    listMonths(12),
    readDraft(s.account),
  ]);
  for (const result of [suppliers, items, units]) if (result.error) throw result.error;
  const orderRows = orders;
  const lines = await orderLinesFor(orderRows);
  return {
    account: s.account, name: me?.name ?? accountName(s.account), tabs: me?.tabs ?? cleanTabs(s.account, null),
    views: ACCOUNT_VIEWS[s.account], theme: me?.theme ?? "ricotta", themes: looks.themes, autoThemes: looks.autoThemes,
    autoTheme: me?.autoTheme ?? true, pins: me?.pins ?? [], messageFormat: me?.messageFormat ?? {}, streak, notes, weather,
    suppliers: (suppliers.data ?? []).map(toSupplier),
    items: (items.data ?? []).map(toItem),
    units: units.data ?? [],
    history: groupHistory(orderRows, lines),
    historyMonth: monthKey(),
    reminder, devices, activity, inbox, repeats, months, draft,
  };
}
async function readDraft(account: Account) {
  const { data, error } = await app("order_drafts").select("cart,revision,note").eq("account", account).maybeSingle();
  if (error) throw error;
  return { cart: data?.cart ?? {}, revision: data?.revision ?? 0, note: data?.note ?? "", conflicts: [] };
}
async function listRepeats() {
  const { data, error } = await app("repeat_orders").select("id,name,days,entries,created_by,created_at").order("created_at");
  if (error) throw error;
  return (data ?? []).map(toRepeat);
}
/* The archive: one summary per finished month, newest first. */
async function listMonths(limit = 24) {
  const { data, error } = await app("month_summaries").select("month,data").order("month", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((m: any) => ({ month: m.month, ...m.data }));
}

/* ---------- Repeat orders ----------
   A saved order (one or more suppliers) that comes back on chosen weekdays: the Order screen
   offers it on those days with one tap. Both accounts can make, change and remove them. */
const MAX_REPEATS = 30;
function cleanRepeatDays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const days = [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return days.length ? days : null;
}
function cleanRepeatEntries(v: unknown): any[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 40) return null;
  const out: any[] = [];
  for (const e of v as any[]) {
    const items = Array.isArray(e?.items) ? e.items.slice(0, 200).map((i: any) => ({ itemId: text(i?.itemId, 120), qty: Number(i?.qty) }))
      .filter((i: any) => i.itemId && Number.isFinite(i.qty) && i.qty > 0 && i.qty <= 99999) : [];
    if (!items.length) continue;
    out.push({ supplierId: text(e?.supplierId, 120) || null, items });
  }
  return out.length ? out : null;
}

/* ---------- Sign-in, and wrong-guess limits ----------
   Two independent locks. The per-IP one is cheap and useful, but every one of
   those headers is client-suppliable when there is no trusted proxy in front
   of this function, so a spoofed value could claim a fresh IP on every
   request and never trip it. The second lock does not depend on any claimed
   identity at all -- it counts every failed attempt in the window, from
   anywhere -- so brute force is capped no matter what headers are sent. The
   secret-code steps count toward the same limits. */
async function loginFingerprints(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return [await hash(`ip|${ip}`), await hash("global-login-lock")];
}
async function reserveLogin(prints: string[]): Promise<number[] | null> {
  // The database locks, checks, and reserves the attempt before bcrypt runs.
  // Parallel guesses count as failed until they are proven successful.
  const { data, error } = await db.rpc("app_internal_reserve_login", {
    p_fingerprints: prints, p_window_seconds: LOGIN_WINDOW_MS / 1000,
    p_ip_limit: MAX_FAILED_LOGINS, p_global_limit: MAX_GLOBAL_FAILED_LOGINS,
  });
  if (error) throw new Error("login_limit_unavailable");
  if (data === null) return null;
  if (!Array.isArray(data) || data.length !== 2) throw new Error("login_limit_unavailable");
  return data;
}
async function completeAttempt(ids: number[]) {
  const { error } = await app("login_attempts").update({ succeeded: true }).in("id", ids);
  if (error) throw new Error("login_attempt_unavailable");
}

async function login(req: Request) {
  const { pin } = await readBody(req);
  // Do not truncate an untrusted value before verifying it: otherwise a
  // valid PIN followed by extra characters could be accepted.
  if (!/^\d{6}$/.test(String(pin ?? ""))) return fail("invalid_credentials", 401);
  const prints = await loginFingerprints(req);
  const attempt = await reserveLogin(prints);
  if (!attempt) return fail("too_many_attempts", 429);

  const { data: match, error: matchError } = await db.rpc("app_internal_match_code", { p_code: String(pin) });
  if (matchError) throw new Error("credential_check_unavailable");
  if (match === "recovery") {
    // The secret code: the next step asks who is there. Not a sign-in yet.
    await completeAttempt(attempt);
    const ticket = randomToken();
    const { error } = await app("recovery_tickets").insert({ token_hash: await hash(ticket), stage: "code", expires_at: new Date(Date.now() + RECOVERY_TICKET_MS).toISOString() });
    if (error) return fail("login_failed", 503);
    return json({ recovery: true, ticket });
  }
  const success = match === "rozha" || match === "yunis";
  if (!success) return fail("invalid_credentials", 401);
  await completeAttempt(attempt);
  return await startSession(req, match as Account);
}

/* A new session for this device: the PIN and Face ID sign-ins both end here. */
async function startSession(req: Request, account: Account) {
  const token = randomToken();
  const deviceId = text(req.headers.get("x-device-id"), 120) || null;
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  const { error: sessionError } = await app("sessions").insert({ token_hash: await hash(token), account, device_id: deviceId, expires_at: expiresAt });
  if (sessionError) return fail("login_failed", 503);
  if (deviceId) {
    // A command sent before this sign-in is old news: mark it handled so an
    // old "log out" can't kick the person out right after signing in.
    const { data: prev, error: deviceReadError } = await app("devices").select("command").eq("id", deviceId).maybeSingle();
    const {error:deviceWriteError}=await app("devices").upsert({
      id: deviceId, account, label: deviceLabel(req), logged_in: true, last_login: nowIso(), last_seen: nowIso(), updated_at: nowIso(),
      ...(appVersion(req) ? { app_version: appVersion(req) } : {}),
      ...(prev?.command?.id ? { handled_command: String(prev.command.id) } : {}),
    });
    if(deviceReadError || deviceWriteError){
      await app("sessions").delete().eq("token_hash",await hash(token));
      return fail("login_failed",503);
    }
  }
  const me = await readAccount(account);
  return json({ token, account, name: me?.name ?? accountName(account), tabs: me?.tabs ?? cleanTabs(account, null), theme: me?.theme ?? "ricotta", autoTheme: me?.autoTheme ?? true, expiresAt });
}

/* ---------- The secret code ----------
   code on the keypad -> "Who are you?" (the saved answer, exactly as saved,
   capitals included) -> Rozha's current PIN -> new PINs, a new secret code
   and/or a new answer. A wrong answer at any step ends it and counts as a
   failed sign-in. */
async function takeTicket(raw: unknown, stage: string) {
  const token = text(raw, 100);
  if (!token) return null;
  const key = await hash(token);
  const { data, error } = await app("recovery_tickets").select("token_hash,stage,expires_at").eq("token_hash", key).maybeSingle();
  if (error) throw new Error("recovery_ticket_unavailable");
  if (!data) return null;
  if (!Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) {
    await app("recovery_tickets").delete().eq("token_hash", key);
    return null;
  }
  if (data.stage !== stage) return null;
  return { key, expiresAt: data.expires_at };
}
async function recovery(req: Request, step: string) {
  const b = await readBody(req);
  const prints = await loginFingerprints(req);
  const attempt = await reserveLogin(prints);
  if (!attempt) return fail("too_many_attempts", 429);
  const stage = step === "name" ? "code" : step === "verify" ? "name" : "verified";
  const ticket = await takeTicket(b.ticket, stage);
  if (!ticket) return fail("invalid_credentials", 401);
  const { key } = ticket;
  const refuse = async () => {
    await app("recovery_tickets").delete().eq("token_hash", key);
    return fail("invalid_credentials", 401);
  };
  const advance = async (next: string) => {
    const { data, error } = await app("recovery_tickets")
      .update({ stage: next, expires_at: new Date(Date.now() + RECOVERY_TICKET_MS).toISOString() })
      .eq("token_hash", key).eq("stage", stage).gt("expires_at", nowIso()).select("token_hash");
    if (error) throw new Error("recovery_ticket_unavailable");
    return !!data?.length;
  };

  if (step === "name") {
    // Case-sensitive; only a stray space before or after is ignored.
    const name = String(b.name ?? "").trim();
    if (!name || name.length > 40) return await refuse();
    const { data: right, error } = await db.rpc("app_internal_check_recovery_name", { p_name: name });
    if (error) throw new Error("credential_check_unavailable");
    if (right !== true) return await refuse();
    if (!await advance("name")) return fail("invalid_credentials", 401);
    await completeAttempt(attempt);
    return ok();
  }
  if (step === "verify") {
    const { data: good, error } = await db.rpc("app_internal_check_account_pin", { p_account: "rozha", p_pin: String(b.pin ?? "") });
    if (error) throw new Error("credential_check_unavailable");
    if (good !== true) return await refuse();
    if (!await advance("verified")) return fail("invalid_credentials", 401);
    await completeAttempt(attempt);
    return ok();
  }
  // save
  const val = (v: unknown) => { const x = String(v ?? "").trim(); return x ? x : null; };
  const rozhaPin = val(b.rozhaPin), yunisPin = val(b.yunisPin), secretCode = val(b.secretCode), answer = val(b.answer);
  if (!rozhaPin && !yunisPin && !secretCode && !answer) return fail("nothing_to_change");
  for (const v of [rozhaPin, yunisPin, secretCode]) if (v && !/^\d{6}$/.test(v)) return fail("invalid_pin");
  if ((rozhaPin && isWeakPin(rozhaPin)) || (yunisPin && isWeakPin(yunisPin))) return fail("weak_pin");
  if (answer && answer.length > 40) return fail("invalid_answer");
  // Atomically consume the verified capability before changing credentials.
  // Two simultaneous saves with the same ticket must never both succeed.
  const { data: consumed, error: consumeError } = await app("recovery_tickets").delete()
    .eq("token_hash", key).eq("stage", "verified").gt("expires_at", nowIso()).select("token_hash");
  if (consumeError) throw new Error("recovery_ticket_unavailable");
  if (!consumed?.length) return fail("invalid_credentials", 401);
  if (rozhaPin || yunisPin || secretCode) {
    const { data: result, error } = await db.rpc("app_internal_set_credentials", { p_rozha: rozhaPin, p_yunis: yunisPin, p_code: secretCode });
    if (error) return fail("save_failed", 500);
    if (result === "duplicate" || result === "invalid") {
      // Validation did not change anything. Keep the original expiry and let
      // the person correct the form without repeating the recovery steps.
      const { error: restoreError } = await app("recovery_tickets").insert({ token_hash: key, stage: "verified", expires_at: ticket.expiresAt });
      if (restoreError) return fail("save_failed", 500);
      return fail(result === "duplicate" ? "duplicate_pin" : "invalid_pin");
    }
    if (result !== "ok") return fail("save_failed", 500);
    // New codes end every session; Face ID sign-ins go too, so each phone must sign in with the new PIN.
    await app("passkeys").delete().neq("id", "");
  }
  if (answer) {
    const { data: result, error } = await db.rpc("app_internal_set_recovery_name", { p_name: answer });
    if (error || result !== "ok") return fail("save_failed", 500);
  }
  await app("audit_events").insert({ id: newId("audit"), actor: "rozha", device_id: text(req.headers.get("x-device-id"), 120) || null, action: "change_codes",
    payload: { rozhaPin: !!rozhaPin, yunisPin: !!yunisPin, secretCode: !!secretCode, answer: !!answer } });
  await completeAttempt(attempt);
  return ok();
}

function validQuantity(q: number,zero=false){return Number.isFinite(q) && q>=(zero?0:0.001) && q<=99999 && Math.abs(q*1000-Math.round(q*1000))<0.00001;}

/* ---------- Catalog (one record at a time) ---------- */
const CATALOG: Record<string, (id: string, b: any) => Record<string, unknown> | null> = {
  suppliers: (id, b) => text(b.name) ? {
    id, name: text(b.name), phone: text(b.phone, 40) || null,
    reminder: cleanReminder(b.reminder), updated_at: nowIso(),
    ...(Object.hasOwn(b, "cutoff") ? { cutoff: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.cutoff ?? "")) ? String(b.cutoff) : null } : {}),
  } : null,
  items: (id, b) => text(b.name) ? {
    id, name: text(b.name), unit_id: text(b.unit, 120) || null,
    supplier_id: text(b.supplierId, 120) || null,
    ...(Object.hasOwn(b,"aliases") ? {aliases:Array.isArray(b.aliases) ? [...new Set(b.aliases.map((a: unknown)=>text(a,120)).filter(Boolean))].slice(0,12) : []} : {}),
    ...(Object.hasOwn(b,"available") ? {available:b.available!==false} : {}),
    ...(Object.hasOwn(b, "note") ? { note: text(b.note, 120) } : {}),
    ...(Object.hasOwn(b, "sortOrder") ? { sort_order: Number.isInteger(b.sortOrder) && b.sortOrder >= 0 ? b.sortOrder : null } : {}),
    updated_at: nowIso(),
  } : null,
  units: (id, b) => text(b.en, 80) ? { id, en: text(b.en, 80), ku: text(b.ku, 80) || null, ar: text(b.ar, 80) || null } : null,
};

/* Rico's short note after an order goes out (first one each day per
   account). The words live here so every language matches. */
const CHEERS = [
  { mood: "happy", en: (n: string) => `Nice one, ${n}! The order is out.`, ku: (n: string) => `دەستت خۆش بێت ${n}! داواکارییەکە نێردرا.`, ar: (n: string) => `أحسنت يا ${n}! تم إرسال الطلب.` },
  { mood: "excited", en: (n: string) => `Order sent, ${n}! The kitchen is in good hands today.`, ku: (n: string) => `داواکارییەکە نێردرا ${n}! ئەمڕۆ چێشتخانەکە لە دەستی باشدایە.`, ar: (n: string) => `تم إرسال الطلب يا ${n}! المطبخ بأيدٍ أمينة اليوم.` },
  { mood: "grateful", en: (n: string) => `Thanks, ${n}. Today's order is done. One less thing to worry about.`, ku: (n: string) => `سوپاس ${n}. داواکاریی ئەمڕۆ تەواو بوو. شتێکی کەمتر بۆ خەمخواردن.`, ar: (n: string) => `شكرًا يا ${n}. طلب اليوم جاهز، هم أقل.` },
];
async function cheerAfterOrder(s: Session) {
  const date = baghdadDay();
  const c = CHEERS[Math.floor(Math.random() * CHEERS.length)];
  const n = LOCAL_NAMES[s.account];
  // dedupe_key is unique: the second order of the day adds nothing.
  const { error } = await app("rico_inbox").upsert({ account: s.account, kind: "cheer", mood: c.mood, body_en: c.en(n.en), body_ku: c.ku(n.ku), body_ar: c.ar(n.ar), dedupe_key: `sent|${s.account}|${date}` }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
}

/* Rico's congratulations when the kitchen streak reaches 7, 14, 30, 60, 100... days (both accounts). */
async function streakMilestone(count: number) {
  const day = baghdadDay();
  const rows = (["rozha", "yunis"] as const).map((a) => {
    const n = LOCAL_NAMES[a];
    return {
      account: a, kind: "streak", mood: "excited", dedupe_key: `streak|${count}|${day}|${a}`,
      body_en: `🔥 ${count} days in a row! The kitchen hasn't missed a single day. Keep the fire going, ${n.en}!`,
      body_ku: `🔥 ${count} ڕۆژ لەسەر یەک! چێشتخانەکە تەنانەت یەک ڕۆژیشی لەدەست نەداوە. ئاگرەکە بە گڕ ڕابگرە، ${n.ku}!`,
      body_ar: `🔥 ${count} يومًا متتاليًا! لم يفوّت المطبخ يومًا واحدًا. حافظ على اشتعال النار يا ${n.ar}!`,
    };
  });
  const { error } = await app("rico_inbox").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
}
/* A notification for one account's signed-in phones, sent by send-push. */
async function pushTo(account: Account, payload: Record<string, unknown>) {
  if (!CRON_SECRET) return;
  await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, "x-cron-secret": CRON_SECRET },
    body: JSON.stringify({ ...payload, account }),
  }).then((r) => r.body?.cancel()).catch(() => {});
}

async function saveOrder(s: Session, b: any) {
  const id = text(b.id, 160);
  if (!id || !Array.isArray(b.entries) || !b.entries.length) return fail("invalid_order");
  // A real order is at most a few dozen suppliers and a few hundred lines;
  // anything far beyond that is refused instead of written line by line.
  const lineCount = b.entries.reduce((n: number, e: any) => n + (Array.isArray(e?.items) ? e.items.length : 0), 0);
  if (b.entries.length > 80 || !lineCount || lineCount > 800 || b.entries.some((e: any) => !e || !Array.isArray(e.items)
    || e.items.some((i: any) => !i || !validQuantity(Number(i.qty))))) return fail("invalid_order");
  if (b.date && !Number.isFinite(Date.parse(b.date))) return fail("invalid_order");
  // A phone whose clock runs fast still saves: a time in the future is taken as now. (Refusing it made
  // every order from that phone fail, and the failed order could not be retried or cleared.)
  const date = b.date && Date.parse(b.date) <= Date.now() ? new Date(b.date).toISOString() : nowIso();
  if (date < monthStart()) return fail("order_outside_current_month", 409);
  // Keep each supplier's name with the order, so History still shows it after
  // the supplier is renamed or deleted (supplier_id is then set to null).
  const supplierIds = [...new Set(b.entries.map((e: any) => text(e.supplierId, 120)).filter(Boolean))];
  const { data: sups, error: supplierError } = supplierIds.length ? await app("suppliers").select("id,name").in("id", supplierIds) : { data: [] as any[], error: null };
  if (supplierError) return fail("save_failed", 500);
  const supplierNames = new Map((sups ?? []).map((x: any) => [x.id, x.name]));
  const lines = b.entries.flatMap((e: any) => (Array.isArray(e.items) ? e.items : []).map((i: any) => ({
    supplier_id: supplierNames.has(text(e.supplierId, 120)) ? text(e.supplierId, 120) : null,
    supplier_name: supplierNames.get(text(e.supplierId, 120)) ?? (text(e.supplierName, 160) || null),
    item_id: text(i.itemId, 120) || null,
    item_name: text(i.name) || text(i.itemId) || "Item", unit_id: text(i.unit, 120) || null,
    qty: Number(i.qty),
  })));
  // Header and lines commit together. Retrying an existing
  // order never observes half an order.
  const { data: saved, error } = await db.rpc("app_internal_save_order_note", {
    p_id: id, p_date: date, p_account: s.account, p_lines: lines, p_note: text(b.note,300),
  });
  if (error || (saved !== true && saved !== false)) return fail("save_failed", 500);
  if (saved) {
    await cheerAfterOrder(s).catch(() => {});
    const { data: hit, error: hitError } = await db.rpc("app_internal_streak_hit", { p_day: baghdadDay(date) });
    if (!hitError && hit?.milestone) await streakMilestone(Number(hit.count)).catch(() => {});
  }
  return json({ ok: true, streak: await readStreak().catch(() => null) });
}

/* ---------- Devices ---------- */
async function heartbeat(s: Session, label: string | null, version: string | null) {
  if (!s.deviceId) return ok();
  const { data: d, error: readError } = await app("devices").select("command,handled_command").eq("id", s.deviceId).maybeSingle();
  if (readError) throw readError;
  const pendingLogout = d?.command?.type === "logout" && d.command.id !== d.handled_command;
  if (pendingLogout) return json({ ok: true, device: null });   // don't flip it back to "logged in"
  const { error } = await app("devices").upsert({ id: s.deviceId, account: s.account, ...(label ? { label } : {}), ...(version ? { app_version: version } : {}), logged_in: true, last_seen: nowIso(), updated_at: nowIso() });
  if (error) throw error;
  return ok();
}

async function sendCommand(b: any) {
  const type = b.type === "logout" ? "logout" : b.type === "refresh" ? "refresh" : "";
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map((x: unknown) => text(x, 120)).filter(Boolean).slice(0, 50) : [];
  if (!type || !ids.length) return fail("invalid_command");
  const { error } = await db.rpc("app_internal_device_command", { p_ids: ids, p_type: type });
  return error ? fail("command_failed", 503) : ok();
}

/* ---------- Push ----------
   Rozha may send anything. Yunis may test the daily reminder (Sounds &
   notifications) or a supplier's reminder (Suppliers), and send what Rico
   wrote (Rico has no limits). */
async function forwardPush(s: Session, b: any) {
  if (!CRON_SECRET) return fail("push_not_configured", 500);
  const type = text(b.type, 30);
  const allowed = isRozha(s) ? ["update", "reminder-now", "supplier-test", "assistant"] : ["reminder-now", "supplier-test", "assistant"];
  if (!allowed.includes(type)) return fail(isRozha(s) ? "invalid_type" : "forbidden", isRozha(s) ? 400 : 403);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, "x-cron-secret": CRON_SECRET },
    body: JSON.stringify({
      type, title: text(b.title, 80), bodyEn: text(b.bodyEn, 300), bodyKu: text(b.bodyKu, 300), bodyAr: text(b.bodyAr, 300),
      supplierId: text(b.supplierId, 120),
    }),
  });
  const data = await res.json().catch(() => ({}));
  return json(data, res.status);
}

/* Rico's chat history. Rozha and Yunis can read and delete each other's chats too (the app shows
   whose each one is); each person only ever writes their own. */
const CHAT_MAX_MESSAGES = 200, CHAT_MAX_CHARS = 200_000;
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function cleanChatMessages(v: unknown): any[] | null {
  if (!Array.isArray(v) || v.length > CHAT_MAX_MESSAGES) return null;
  const out = [];
  for (const x of v as any[]) {
    if (!x || typeof x !== "object" || !["user", "assistant"].includes(x.role)) return null;
    out.push({
      role: x.role, text: String(x.text ?? "").slice(0, 8000),
      ...(typeof x.ts === "number" && Number.isFinite(x.ts) ? { ts: x.ts } : {}),
      ...(typeof x.mood === "string" ? { mood: x.mood.slice(0, 20) } : {}),
      ...(typeof x.error === "string" ? { error: x.error.slice(0, 40) } : {}),
      ...(Array.isArray(x.steps) ? { steps: x.steps.slice(0, 20).map((k: unknown) => String(k).slice(0, 40)) } : {}),
      ...(Array.isArray(x.proposals) ? { proposals: x.proposals.slice(0, 20).filter((p: unknown) => p && typeof p === "object") } : {}),
    });
  }
  return JSON.stringify(out).length <= CHAT_MAX_CHARS ? out : null;
}
async function ricoChats(req: Request, actor: Account, id: string | null, body: any = {}): Promise<Response> {
  if (id !== null && !uuid(id)) return fail("Chat not found", 404);
  const whose = new URL(req.url).searchParams.get("account");
  if (req.method === "GET" && id === null) {
    const { data, error } = await db.from("app_rico_chats").select("id,account,title,created_at,updated_at")
      .gte("updated_at", new Date(Date.now() - 90 * 86400_000).toISOString()).order("updated_at", { ascending: false }).limit(120);
    if (error) throw error;
    return json({ chats: (data ?? []).map((c: any) => ({ id: c.id, account: c.account, title: c.title, createdAt: c.created_at, updatedAt: c.updated_at })) });
  }
  if (req.method === "GET") {
    const { data, error } = await db.from("app_rico_chats").select("id,account,title,messages,created_at,updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? json({ id: data.id, account: data.account, title: data.title, messages: data.messages, createdAt: data.created_at, updatedAt: data.updated_at }) : fail("Chat not found", 404);
  }
  if (req.method === "PUT" && id !== null) {
    const b = body;
    const messages = cleanChatMessages(b.messages);
    if (!messages || !messages.length) return fail("Invalid chat");
    const {data:saved,error}=await db.rpc("app_internal_save_chat",{p_id:id,p_account:actor,p_title:text(b.title,120),p_messages:messages});
    if(error) return fail("Save failed",500);
    if(!saved) return fail("Chat not found",404);
    const { error: pruneError } = await db.rpc("app_rico_chats_prune", { p_account: actor });
    if (pruneError) console.error("rico chats prune", String(pruneError?.message ?? "Operation failed"));
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    let q = db.from("app_rico_chats").delete();
    if (id !== null) q = q.eq("id", id);
    else q = q.eq("account", whose === "rozha" || whose === "yunis" ? whose : actor);
    const { error } = await q;
    if (error) throw error;
    return json({ ok: true });
  }
  return fail("Unknown route", 404);
}

/* ---------- Face ID / fingerprint sign-in (WebAuthn passkeys) ----------
   The phone makes a key pair that only unlocks with the person's face or finger; the private key
   never leaves it. Here we keep the public key, and every sign-in proves the phone signed a fresh,
   single-use challenge for this site. The PIN keeps working; changing the codes removes all passkeys. */
const RP_ID = new URL(ALLOWED_ORIGIN).hostname;
const PASSKEY_CHALLENGE_MS = 5 * 60_000;
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
type Bytes = Uint8Array<ArrayBuffer>;
function fromB64u(v: unknown, max = 4096): Bytes | null {
  const str = typeof v === "string" ? v : "";
  if (!str || str.length > max || !/^[A-Za-z0-9_-]+={0,2}$/.test(str)) return null;
  try {
    const bin = atob(str.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/") + "===".slice((str.replace(/=+$/, "").length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}
const sha256 = async (bytes: Bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
async function newPasskeyChallenge(purpose: "register" | "login", account: Account | null) {
  // Anyone can ask for a sign-in challenge, so only a limited number may wait at once.
  const { count } = await app("passkey_challenges").select("token_hash", { count: "exact", head: true }).gt("expires_at", nowIso());
  if ((count ?? 0) >= 200) throw new Error("passkey_busy");
  const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await app("passkey_challenges").insert({ token_hash: await hash(challenge), challenge, purpose, account,
    expires_at: new Date(Date.now() + PASSKEY_CHALLENGE_MS).toISOString() });
  if (error) throw new Error("passkey_challenge_unavailable");
  return challenge;
}
/* Checks clientDataJSON (type, this site, a challenge we issued, used once) and the authenticator
   data (this site, the person was present and verified with face/finger). Returns the parts, or null. */
async function checkCeremony(type: "webauthn.create" | "webauthn.get", purpose: "register" | "login", b: any, account: Account | null) {
  const clientData = fromB64u(b.clientDataJSON, 8192), authData = fromB64u(b.authenticatorData, 4096);
  if (!clientData || !authData || authData.length < 37) return null;
  let c: any;
  try { c = JSON.parse(new TextDecoder().decode(clientData)); } catch { return null; }
  if (c?.type !== type || c?.origin !== ALLOWED_ORIGIN || typeof c?.challenge !== "string") return null;
  // Single use: the challenge row is taken out as it is checked.
  const { data: rows, error } = await app("passkey_challenges").delete().eq("token_hash", await hash(c.challenge))
    .eq("purpose", purpose).gt("expires_at", nowIso()).select("challenge,account");
  if (error || !rows?.length || rows[0].challenge !== c.challenge) return null;
  if (account && rows[0].account !== account) return null;
  if (!sameBytes(authData.slice(0, 32), await sha256(new TextEncoder().encode(RP_ID)))) return null;
  const flags = authData[32];
  if (!(flags & 0x01) || !(flags & 0x04)) return null;   // user present + user verified (Face ID / fingerprint / passcode)
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
  return { clientData, authData, signCount };
}
const keyParams = (alg: number) => alg === -7 ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
/* WebAuthn ECDSA signatures are DER; WebCrypto wants the raw 64-byte r||s. */
function derToRaw(der: Bytes): Bytes | null {
  if (der[0] !== 0x30) return null;
  let i = 2;
  const part = () => {
    if (der[i++] !== 0x02) return null;
    const len = der[i++]; let v = der.slice(i, i + len); i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) return null;
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = part(), sg = part();
  if (!r || !sg) return null;
  const raw = new Uint8Array(64); raw.set(r); raw.set(sg, 32); return raw;
}
async function passkeyRegister(s: Session, b: any) {
  const id = text(b.id, 1024), alg = Number(b.alg), spki = fromB64u(b.publicKey, 2048);
  if (!fromB64u(id, 1024) || id.length < 16 || ![-7, -257].includes(alg) || !spki) return fail("invalid_passkey");
  try { await crypto.subtle.importKey("spki", spki, keyParams(alg), false, ["verify"]); } catch { return fail("invalid_passkey"); }
  if (!(await checkCeremony("webauthn.create", "register", b, s.account))) return fail("invalid_passkey", 401);
  const { data, error } = await db.rpc("app_internal_register_passkey", { p_id: id, p_account: s.account, p_public_key: b64u(spki), p_alg: alg, p_device: s.deviceId });
  return error ? fail("save_failed", 500) : data ? ok() : fail("passkey_conflict", 409);
}
async function passkeyLogin(req: Request) {
  const b = await readBody(req);
  const attempt = await reserveLogin(await loginFingerprints(req));
  if (!attempt) return fail("too_many_attempts", 429);
  const id = text(b.id, 1024), signature = fromB64u(b.signature, 1024);
  if (!id || !signature) return fail("invalid_credentials", 401);
  const { data: key, error } = await app("passkeys").select("id,account,public_key,alg,sign_count").eq("id", id).maybeSingle();
  if (error) throw new Error("passkey_unavailable");
  if (!key) return fail("invalid_credentials", 401);
  const done = await checkCeremony("webauthn.get", "login", b, null);
  if (!done) return fail("invalid_credentials", 401);
  const signed = new Uint8Array(done.authData.length + 32);
  signed.set(done.authData); signed.set(await sha256(done.clientData), done.authData.length);
  const sig = key.alg === -7 ? derToRaw(signature) : signature;
  let valid = false;
  try {
    const pub = await crypto.subtle.importKey("spki", fromB64u(key.public_key, 2048)!, keyParams(key.alg), false, ["verify"]);
    valid = !!sig && await crypto.subtle.verify(key.alg === -7 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, pub, sig, signed);
  } catch { valid = false; }
  if (!valid) return fail("invalid_credentials", 401);
  // A counter that goes backwards means a copied key: refuse it (phones that keep 0 are fine).
  if (done.signCount && Number(key.sign_count) && done.signCount <= Number(key.sign_count)) return fail("invalid_credentials", 401);
  const { data: updated, error: updateError } = await app("passkeys").update({ sign_count: done.signCount, last_used_at: nowIso() }).eq("id", id).eq("sign_count", key.sign_count).select("id");
  if (updateError || !updated?.length) return fail("passkey_update_failed", 503);
  await completeAttempt(attempt);
  return await startSession(req, key.account as Account);
}

/* ---------- Router ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const at = segments.lastIndexOf("api");
  const path = (at >= 0 ? segments.slice(at + 1) : segments).join("/");
  const M = req.method;

  try {
    if (M === "POST" && path === "login") return await login(req);
    if (M === "POST" && path === "passkey/login-options") return json({ challenge: await newPasskeyChallenge("login", null), rpId: RP_ID });
    if (M === "POST" && path === "passkey/login") return await passkeyLogin(req);
    if (M === "POST" && ["recovery/name", "recovery/verify", "recovery/save"].includes(path)) return await recovery(req, path.slice(9));
    if (M === "GET" && path === "health") {
      const { error } = await app("accounts").select("id", { head: true }).limit(1);
      return error ? json({ ok: false }, 503) : json({ ok: true });
    }

    const s = await authenticate(req);
    if (!s) return fail("unauthorized", 401);
    const rozha = isRozha(s);
    const b = M === "GET" ? {} : await readBody(req, path === "assistant/transcribe" ? MAX_AUDIO_BODY_BYTES : MAX_BODY_BYTES);
    let m: RegExpMatchArray | null;

    if (M === "GET" && path === "bootstrap") return json(await bootstrap(s));
    if (M === "GET" && path === "draft") return json(await readDraft(s.account));
    if (M === "PUT" && path === "draft") {
      const changes = b.changes;
      if (!Array.isArray(changes) || changes.length > 2000 || new Set(changes.map((c: any) => c?.itemId)).size !== changes.length || changes.some((c: any) =>
        !c || typeof c.itemId !== "string" || !c.itemId.length || c.itemId.length > 200 || !validQuantity(c.before,true) || !validQuantity(c.after,true) || c.before < 0 || c.after < 0 || c.before > 99999 || c.after > 99999)) return fail("invalid_draft");
      if ((b.noteAfter != null && (typeof b.noteAfter!=="string" || b.noteAfter.length>300)) || (b.noteBefore != null && typeof b.noteBefore!=="string")) return fail("invalid_draft");
      const { data, error } = await db.rpc("app_internal_patch_draft_note", { p_account: s.account, p_changes: changes, p_before: b.noteBefore ?? null, p_after: b.noteAfter ?? null });
      return error ? fail("draft_save_failed", 503) : json(data, data?.conflicts?.length ? 409 : 200);
    }
    if (M === "POST" && path === "logout") {
      const { error } = await db.rpc("app_internal_logout", { p_session: s.id, p_device: s.deviceId });
      return error ? fail("logout_failed", 503) : ok();
    }
    if (M === "PUT" && path === "me/message-format") {
      const message_format={restaurant:text(b.restaurant,80),greeting:text(b.greeting,200),closing:text(b.closing,200)};
      const {error}=await app("accounts").update({message_format,updated_at:nowIso()}).eq("id",s.account);
      return error ? fail("save_failed",503) : json(message_format);
    }
    if (M === "PUT" && path === "me/tabs") {
      const allowed = ACCOUNT_VIEWS[s.account];
      const tabs = Array.isArray(b.tabs) ? b.tabs.map((t: unknown) => text(t, 20)) : [];
      if (tabs.length !== 3 || new Set(tabs).size !== 3 || tabs.some((t: string) => !allowed.includes(t))) return fail("invalid_tabs");
      const { error } = await app("accounts").update({ tabs, updated_at: nowIso() }).eq("id", s.account);
      return error ? fail("save_failed", 500) : ok();
    }

    if (M === "PUT" && path === "me/theme") {
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      if (b.theme !== undefined) {
        const theme = text(b.theme, 20);
        if (!THEMES.includes(theme)) return fail("invalid_theme");
        patch.theme = theme;
      }
      if (typeof b.auto === "boolean") patch.auto_theme = b.auto;
      if (Object.keys(patch).length < 2) return fail("invalid_theme");
      const { error } = await app("accounts").update(patch).eq("id", s.account);
      return error ? fail("save_failed", 500) : ok();
    }
    if (M === "PUT" && path === "me/pins") {
      const ids = Array.isArray(b.itemIds) ? [...new Set(b.itemIds.map((id: unknown) => text(id, 120)).filter(Boolean))] : null;
      if (!ids || ids.length > 60) return fail("invalid_pins");
      const { error } = await app("accounts").update({ pins: ids, updated_at: nowIso() }).eq("id", s.account);
      return error ? fail("save_failed", 500) : ok();
    }

    // Catalog (both accounts)
    if (M === "PUT" && (m = path.match(/^supplier-order\/([^/]{1,120})$/))) {
      const supplierId = decodeURIComponent(m[1]);
      const itemIds = Array.isArray(b.itemIds) ? b.itemIds.map((id: unknown) => text(id, 120)) : null;
      if (!itemIds || itemIds.length > 500 || itemIds.some((id: string) => !id) || new Set(itemIds).size !== itemIds.length) return fail("invalid_order");
      const { data, error } = await db.rpc("app_internal_set_item_order", { p_supplier_id: supplierId, p_item_ids: itemIds });
      if (error || data !== true) return fail("invalid_order");
      return ok();
    }
    if ((m = path.match(/^(suppliers|items|units)\/([^/]{1,120})$/))) {
      const table = m[1], id = decodeURIComponent(m[2]);
      if (M === "PUT" || M === "DELETE") {
        const row = M === "PUT" ? CATALOG[table](id, b) : null;
        if (M === "PUT" && !row) return fail("invalid_input");
        const { error } = await db.rpc("app_internal_catalog_change", { p_table: table, p_id: id, p_row: row, p_actor: s.account, p_device: s.deviceId });
        return error ? fail(M === "DELETE" ? "delete_failed" : "save_failed", 500) : ok();
      }
    }

    // Orders
    if (M === "POST" && path === "orders") return await saveOrder(s, b);
    if (M === "DELETE" && (m = path.match(/^orders\/([^/]{1,160})$/))) {
      // Sent orders are the kitchen's paper trail: Rozha may remove any; whoever sent one
      // may undo it within 15 minutes (the database checks both).
      const id = decodeURIComponent(m[1]);
      const { error } = await db.rpc("app_internal_delete_order", { p_id: id, p_actor: s.account, p_device: s.deviceId });
      if (error) return /forbidden/i.test(String(error.message)) ? fail("forbidden", 403) : fail("delete_failed", 500);
      return json({ ok: true, streak: await readStreak().catch(() => null) });
    }

    // The kitchen streak
    if (M === "GET" && path === "streak") return json(await readStreak());
    if (M === "POST" && path === "streak/recover") {
      const { data, error } = await db.rpc("app_internal_streak_recover", { p_today: baghdadDay() });
      if (error) return fail("save_failed", 500);
      if (!data?.ok) return fail(String(data?.reason || "nothing_to_recover"), 409);
      return json({ ok: true, streak: await readStreak() });
    }

    // Kitchen notes: Rozha leaves them, Yunis reads them
    if (M === "GET" && path === "notes") return json(await listNotes());
    if (M === "POST" && path === "notes/replies-seen") {
      if (!rozha) return fail("forbidden", 403);
      const { error } = await app("notes").update({ reply_seen_at: nowIso() }).not("reply", "is", null).is("reply_seen_at", null);
      return error ? fail("save_failed", 500) : ok();
    }
    if (M === "POST" && (m = path.match(/^notes\/(\d{1,15})\/reply$/))) {
      // Yunis answers one of Rozha's notes; she gets a notification with the answer.
      if (rozha) return fail("forbidden", 403);
      const reply = text(b.body, 300);
      if (!reply) return fail("empty_note");
      const now = nowIso();
      const { data, error } = await app("notes").update({ reply, replied_at: now, reply_seen_at: null, read_at: now })
        .eq("id", Number(m[1])).select(NOTE_COLUMNS).maybeSingle();
      if (error) return fail("save_failed", 500);
      if (!data) return fail("not_found", 404);
      await pushTo("rozha", { type: "reply", body: reply });
      return json(toNote(data));
    }
    if (M === "POST" && path === "notes") {
      if (!rozha) return fail("forbidden", 403);
      const body = text(b.body, 500);
      if (!body) return fail("empty_note");
      const { data, error } = await app("notes").insert({ body, created_by: "rozha" }).select("id,body,created_at,read_at,done_at").single();
      if (error) return fail("save_failed", 500);
      await pushTo("yunis", { type: "note", body });
      return json(toNote(data));
    }
    if ((m = path.match(/^notes\/(\d{1,15})(?:\/(read|done))?$/))) {
      const id = Number(m[1]), act = m[2];
      if (M === "DELETE" && !act) {
        if (!rozha) return fail("forbidden", 403);
        const { error } = await app("notes").delete().eq("id", id);
        return error ? fail("delete_failed", 500) : ok();
      }
      if (M === "POST" && act) {
        if (rozha) return fail("forbidden", 403);
        const now = nowIso();
        const patch = act === "read" ? { read_at: now } : { done_at: b.done === false ? null : now, read_at: now };
        let q = app("notes").update(patch).eq("id", id);
        if (act === "read") q = q.is("read_at", null);
        const { error } = await q;
        return error ? fail("save_failed", 500) : ok();
      }
    }

    // Repeat orders
    if (M === "GET" && path === "repeat-orders") return json(await listRepeats());
    if (M === "POST" && path === "repeat-orders") {
      const days = cleanRepeatDays(b.days), entries = cleanRepeatEntries(b.entries), name = text(b.name, 120);
      if (!days || !entries || !name) return fail("invalid_repeat");
      const { count } = await app("repeat_orders").select("id", { count: "exact", head: true });
      if ((count ?? 0) >= MAX_REPEATS) return fail("too_many_repeats", 409);
      const { data, error } = await app("repeat_orders").insert({ name, days, entries, created_by: s.account })
        .select("id,name,days,entries,created_by,created_at").single();
      return error ? fail("save_failed", 500) : json(toRepeat(data));
    }
    if ((m = path.match(/^repeat-orders\/([0-9a-f-]{36})$/i))) {
      if (M === "DELETE") {
        const { error } = await app("repeat_orders").delete().eq("id", m[1]);
        return error ? fail("delete_failed", 500) : ok();
      }
      if (M === "PUT") {
        const patch: Record<string, unknown> = { updated_at: nowIso() };
        if (b.days !== undefined) { const days = cleanRepeatDays(b.days); if (!days) return fail("invalid_repeat"); patch.days = days; }
        if (b.name !== undefined) { const name = text(b.name, 120); if (!name) return fail("invalid_repeat"); patch.name = name; }
        const { data, error } = await app("repeat_orders").update(patch).eq("id", m[1]).select("id,name,days,entries,created_by,created_at").maybeSingle();
        if (error) return fail("save_failed", 500);
        return data ? json(toRepeat(data)) : fail("not_found", 404);
      }
    }

    // The month archive
    if (M === "GET" && path === "months") return json(await listMonths());

    // Face ID on this phone
    if (M === "POST" && path === "passkey/register-options") {
      const { data: mine } = await app("passkeys").select("id").eq("account", s.account);
      return json({ challenge: await newPasskeyChallenge("register", s.account), rpId: RP_ID, userId: b64u(new TextEncoder().encode(s.account)),
        userName: accountName(s.account), exclude: (mine ?? []).map((k: any) => k.id) });
    }
    if (M === "POST" && path === "passkey/register") return await passkeyRegister(s, b);
    if (M === "DELETE" && path === "passkey") {
      const id = text(b.id, 1024);
      if (!id) return fail("invalid_passkey");
      const { error } = await app("passkeys").delete().eq("id", id).eq("account", s.account);
      return error ? fail("delete_failed", 500) : ok();
    }

    // Record
    if (M === "GET" && path === "activity") return json(await listActivity());

    // Devices
    if (M === "GET" && path === "devices") return json(await listDevices(s));
    if (M === "POST" && path === "devices/me") return await heartbeat(s, deviceLabel(req), appVersion(req));
    if (M === "POST" && path === "devices/me/ack") {
      if (s.deviceId) {
        const { error } = await app("devices").update({ handled_command: text(b.commandId, 120) || null }).eq("id", s.deviceId);
        if (error) return fail("ack_failed", 503);
      }
      return ok();
    }
    if (M === "POST" && path === "devices/command") return rozha ? await sendCommand(b) : fail("forbidden", 403);

    if (/^rico-chats(?:\/[^/]+)?$/.test(path)) return await ricoChats(req, s.account, path.split("/")[1] ?? null, b);

    // Rico, the assistant
    if (M === "POST" && path === "assistant/chat") return await handleChat(db, s, b, cors, req.signal);
    if (M === "POST" && path === "assistant/transcribe") return await handleTranscribe(db, s, b, cors);
    if (M === "GET" && path === "assistant/suggestion") return json(await orderSuggestion(db, s));
    if (M === "GET" && path === "assistant/inbox") return json(await listInbox(s));
    if (M === "POST" && path === "assistant/inbox/read") {
      await app("rico_inbox").update({ read_at: nowIso() }).eq("account", s.account).is("read_at", null);
      return ok();
    }
    if (M === "GET" && path === "assistant/status") return json(await assistantStatus(db));
    if (M === "GET" && path === "assistant/setup-status") return rozha ? json(await assistantSetupStatus(db)) : fail("forbidden", 403);
    if (M === "PUT" && path === "assistant/groq-key") {
      if (!rozha) return fail("forbidden", 403);
      const result = await saveGroqKey(db, b.key);
      return result.ok ? ok() : fail(result.error ?? "save_failed", result.error === "already_configured" ? 409 : 400);
    }

    // Push notifications
    if (path === "push/subscription") {
      const endpoint = b.endpoint;
      if (!isPushEndpoint(endpoint)) return fail("invalid_endpoint");
      // A device may only remove its own subscription (Rozha may remove any).
      if (M === "DELETE") {
        let q = app("push_subscriptions").delete().eq("endpoint", endpoint);
        if (!rozha) q = s.deviceId ? q.eq("device_id", s.deviceId) : q.is("device_id", null);
        const { error } = await q;
        return error ? fail("delete_failed", 500) : ok();
      }
      if (M === "PUT") {
        if (!s.deviceId) return fail("device_required");
        const { data: existing, error: readError } = await app("push_subscriptions").select("device_id").eq("endpoint", endpoint).maybeSingle();
        if (readError) return fail("save_failed", 500);
        if (existing?.device_id && existing.device_id !== s.deviceId) return fail("forbidden", 403);
        const p256dh = text(b.p256dh, 200), auth = text(b.auth, 100);
        if (!/^[A-Za-z0-9_-]{87}=?$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}(?:==)?$/.test(auth)) return fail("invalid_keys");
        const { error } = await app("push_subscriptions").upsert({
          endpoint, p256dh, auth, device_id: s.deviceId, lang: langOf(b.lang), updated_at: nowIso(),
        });
        return error ? fail("save_failed", 500) : ok();
      }
    }
    if (M === "PUT" && path === "push/lang") {
      if (!isPushEndpoint(b.endpoint)) return fail("invalid_endpoint");
      let q = app("push_subscriptions").update({ lang: langOf(b.lang), updated_at: nowIso() }).eq("endpoint", text(b.endpoint, 1000));
      if (!rozha) q = s.deviceId ? q.eq("device_id", s.deviceId) : q.is("device_id", null);
      const { error } = await q;
      return error ? fail("save_failed", 500) : ok();
    }
    if (M === "POST" && path === "push/send") return await forwardPush(s, b);
    if (M === "PUT" && path === "reminder") {
      const time = String(b.time ?? "").trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail("invalid_time");
      // A time still ahead today can fire today; one that already passed waits for tomorrow.
      const erbil = new Date(Date.now() + 3 * 3600_000);
      const nowMin = erbil.getUTCHours() * 60 + erbil.getUTCMinutes();
      const [h, mi] = time.split(":").map(Number);
      const { error } = await app("reminder_settings").upsert({
        id: true, enabled: !!b.enabled, remind_time: time,
        last_sent_date: h * 60 + mi > nowMin ? null : erbil.toISOString().slice(0, 10),
      });
      return error ? fail("save_failed", 500) : ok();
    }

    return fail("not_found", 404);
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail("too_large", 413);
    if (e instanceof InvalidBody) return fail("invalid_input", 400);
    if (e instanceof Error && e.message === "passkey_busy") return fail("too_many_attempts", 429);
    console.error(path, e);
    return fail("server_error", 500);
  }
});
