import { turnstileConfig, verifyTurnstile } from "../_shared/turnstile.ts";
import { monthStart, monthKey } from "../_shared/month.ts";
// Ricotta Orders API -- the only door between the browser and the database.
//
// The browser never talks to Postgres directly: every request carries an
// opaque session token (issued by POST /login after a bcrypt PIN check) and
// this function uses the service-role key server-side.
//
// There are two accounts, each with its own PIN:
//   rozha  full access
//   yunis  what Rozha gives him in Admin -> Access (ROLES below); every route checks it here
// Rozha's Admin screen changes either PIN (with her current PIN); there is no other way to change one.
//
// Routes (all JSON):
//   POST   login                      {pin}                     -> {token, account, name, expiresAt}
//   GET    health
//   --- session required ---
//   GET    bootstrap                                            -> everything the app needs to start (with views and roles)
//   POST   logout
//   PUT    me/pins                    {itemIds}                 items pinned to the top of this account's Order screen
//   PUT    suppliers/:id | items/:id | units/:id                upsert one record (+ its Record entry)
//   DELETE suppliers/:id | items/:id | units/:id                delete one record (+ its Record entry); items return {undoId}
//   POST   items/restore              {undoId}                  bring back an item deleted on this device in the last 10 minutes
//   PUT    supplier-order/:supplierId {itemIds}                 item order for one supplier
//   POST   orders                     {id, date, entries}       save a sent order
//   DELETE orders/:id                 {pin?} rozha: her own within 15 minutes, any with her PIN
//   GET    streak                                               the kitchen streak
//   POST   streak/recover                                       Rico brings a broken kitchen streak back
//   GET    rico-chats                                           one shared list of both accounts' Rico chats
//   DELETE rico-chats[/:id][?account=all]                       delete one chat, or all of them
//   GET    activity                                             the Record
//   GET    devices                    rozha: all, yunis: own row
//   POST   devices/me                 {seconds?}                heartbeat ("still here") and time spent in the app
//   POST   devices/me/ack             {commandId}               a remote command was carried out
//   POST   devices/command            {ids, type} (rozha)       remote log out / refresh
//   GET    signals?since=n&wait=s                               waits (up to 25 s) until something changes; kinds and counters only
//   PUT    admin/pin                  {account, currentPin, newPin} (rozha)  a new PIN for Rozha or Yunis
//   GET    admin/diagnostics          (rozha)                   Health Check: database, scheduled jobs and counts (summaries only)
//   GET    admin/security             (rozha)                   wrong PINs, the sign-in lock, new phones, the security log
//   POST   admin/security/unlock      (rozha)                   wrong tries in the window stop counting
//   GET    admin/problems             (rozha)                   problem reports from every phone
//   POST   admin/problems/resolve     {ids} (rozha)             mark problems fixed
//   DELETE admin/problems             (rozha)                   remove the fixed ones
//   GET    admin/usage                (rozha)                   time spent in the app per person and phone
//   GET    admin/rico                 (rozha)                   Rico's usage this month and the tokens it used
//   PUT    admin/roles                {account, roles} (rozha)  what Yunis may open and do
//   POST   problems                   {reports}                 errors this phone ran into (and Report a Problem)
//   GET    reports/catalog            (exports)                 this month's orders per item and supplier, for Excel and PDF
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
//   GET    months                                               the archive: one summary per finished month
//   GET    draft | PUT draft          {changes}                 this account's unsent order, shared between its devices
//   PUT    items/aliases              {entries}                 Rico's search-name changes, applied together
//   GET    auth/security              (public)                  whether sign-in needs the bot check, and its site key
//   GET    stock-items                                          Transfers: the workplace stock system's item list
//   PUT    stock-items                {items:[{name, units}]}   replace that list (spellings people taught it are kept)
//   POST   stock-items/:id/alias      {alias}                   remember a spelling for one item
//   POST   stock/read                 {text?, image?, mime?}    Rico reads a transfer list into rows (see stock.ts)
//                                                                  (Transfers is still being made: all four answer 423 until TRANSFERS_OPEN)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { assistantSetupStatus, assistantStatus, handleChat, handleTranscribe, orderSuggestion, saveGroqKey } from "./assistant.ts";
import { BodyTooLarge, InvalidBody, isPushEndpoint, readJsonBody, securityHeaders, acceptsJson } from "../_shared/security.ts";
import { cleanStockList, listStockItems, readTransferList } from "./stock.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const LOGIN_WINDOW_MS = 10 * 60_000;
const MAX_FAILED_LOGINS = 8;              // per network address, per window (spoofable -- see MAX_GLOBAL_FAILED_LOGINS)
const MAX_GLOBAL_FAILED_LOGINS = 40;      // per window, across ALL claimed IPs -- not spoofable via headers
const SEEN_WRITE_EVERY_MS = 5 * 60_000;   // throttle session last_seen_at writes
const PAGE = 1000;                        // PostgREST returns at most 1000 rows per request
const RECORD_TYPES = ["supplier", "item", "unit"];
const RECORD_ACTIONS = ["add", "edit", "delete"];
const LANGS = ["en", "ku", "ar"];
/* What Rozha can give Yunis in Admin -> Access. Screens: history, manage (Items, Suppliers, Units),
   record, transfers, assistant (Rico). Features: catalog (add, change and delete items, suppliers and
   units; needs manage), send (send orders to suppliers), exports (Excel and PDF files), notify (send a
   notification to every phone through Rico), reminders (the daily reminder). Rozha always has all. */
const ROLES = ["history", "manage", "catalog", "record", "transfers", "assistant", "send", "exports", "notify", "reminders"];
const DEFAULT_ROLES = ROLES.filter((r) => r !== "transfers");
const rolesOf = (account: string, saved: unknown) => account === "rozha" ? [...ROLES]
  : Array.isArray(saved) ? ROLES.filter((r) => saved.includes(r)) : [...DEFAULT_ROLES];
// Rozha may undo an order she sent this long without typing her PIN.
const UNDO_MS = 15 * 60_000;
// Transfers is still being made: the tab shows its design, and these routes refuse until it is ready.
const TRANSFERS_OPEN = false;
// Allowed browser origin for this app. Set ALLOWED_ORIGIN if the production
// site ever moves to another origin.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://rozhzero969-hub.github.io";

const botConfig=turnstileConfig(key=>Deno.env.get(key),ALLOWED_ORIGIN);

const cors = {
  ...securityHeaders,
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
/* A Baghdad calendar day as YYYY-MM-DD, and whole days between two of them. */
const baghdadDay = (d: Date | string = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400_000);
/* What the device says it is ("iPhone 16/17 Pro Max|App"), for Admin's device list. */
const deviceLabel = (req: Request) => text(req.headers.get("x-device-label"), 80).replace(/[^\x20-\x7E]/g, "") || null;
/* Which version of the app the device runs (APP_VERSION in config.js), for Admin's device list. */
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
   (111111...) or a straight run (123456, 654321, ...). */
function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const down = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return up || down;
}

type Account = "rozha" | "yunis";
type Session = { id: string; account: Account; deviceId: string | null; roles: string[] };
const isRozha = (s: Session) => s.account === "rozha";
const can = (s: Session, role: string) => isRozha(s) || (s.roles.includes(role) && (role !== "catalog" || s.roles.includes("manage")));
/* The screens an account may open, in the app's order. Settings is on every device. */
function viewsFor(s: Session) {
  return ["order", ...(can(s, "assistant") ? ["assistant"] : []), ...(can(s, "history") ? ["history"] : []),
    ...(can(s, "transfers") ? ["transfers"] : []), ...(can(s, "manage") ? ["manage", "suppliers", "itemsAdmin", "units"] : []),
    ...(can(s, "record") ? ["record"] : []), ...(isRozha(s) ? ["admin"] : []), "settings"];
}

async function authenticate(req: Request): Promise<Session | null> {
  const raw = req.headers.get("x-session-token") || req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw || raw.length > 256) return null;
  const { data } = await app("sessions")
    .select("id,account,device_id,expires_at,revoked_at,last_seen_at,app_accounts(roles)")
    .eq("token_hash", await hash(raw)).maybeSingle();
  if (!data || data.revoked_at || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null;
  if (data.account !== "rozha" && data.account !== "yunis") return null;
  if (Date.now() - new Date(data.last_seen_at).getTime() > SEEN_WRITE_EVERY_MS) {
    await app("sessions").update({ last_seen_at: nowIso() }).eq("id", data.id);
  }
  if(data.device_id){
    const {data:device,error}=await app("devices").select("account").eq("id",data.device_id).maybeSingle();
    if(error || device?.account!==data.account)return null;
  }
  return { id: data.id, account: data.account, deviceId: data.device_id, roles: rolesOf(data.account, (data as any).app_accounts?.roles) };
}
const accountName = (a: string) => (a === "rozha" ? "Rozha" : a === "yunis" ? "Yunis" : a);
/* Each name in the script of each language, for Rico's messages. */
const LOCAL_NAMES: Record<string, { en: string; ku: string; ar: string }> = {
  rozha: { en: "Rozha", ku: "ڕۆژا", ar: "روژا" },
  yunis: { en: "Yunis", ku: "یونس", ar: "يونس" },
};

/* ---------- Shapes the browser uses ---------- */
const toSupplier = (s: any) => ({ id: s.id, name: s.name, phone: s.phone, reminder: s.reminder, cutoff: s.cutoff ?? null });
const toItem = (i: any) => ({ id: i.id, name: i.name, unit: i.unit_id, supplierId: i.supplier_id, sortOrder: i.sort_order, note: i.note ?? "", aliases: i.aliases ?? [], available: i.available !== false,
  createdAt: i.created_at ?? null, lastOrderedAt: i.last_ordered_at ?? null });
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

const toDevice = (d: any) => ({
  id: d.id, account: d.account ?? null, label: d.label ?? null, loggedIn: d.logged_in,
  lastLogin: d.last_login, lastSeen: d.last_seen, command: d.command, handledCommand: d.handled_command,
  appVersion: d.app_version ?? null,
});
const toActivity = (a: any) => ({
  ...(a.payload ?? {}), id: a.id, ts: a.occurred_at, actor: a.actor,
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
    return { id: o.id, date: o.sent_at ?? o.created_at, by: o.sent_by ?? null, entries };
  });
}

async function listDevices(s: Session) {
  let q = app("devices").select("id,account,label,logged_in,last_login,last_seen,command,handled_command,app_version");
  if (!isRozha(s)) q = q.eq("id", s.deviceId ?? "").eq("account",s.account);
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
  const { data, error } = await app("accounts").select("id,name,pins").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { account: data.id, name: data.name, pins: Array.isArray(data.pins) ? data.pins : [] } : null;
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
  const [me, suppliers, items, units, orders, reminder, devices, activity, inbox, streak, months, draft] = await Promise.all([
    readAccount(s.account),
    readAll(() => app("suppliers").select("id,name,phone,reminder,cutoff").order("name").order("id")),
    readAll(() => app("items").select("id,name,unit_id,supplier_id,sort_order,note,aliases,available,created_at,last_ordered_at").order("name").order("id")),
    readAll(() => app("units").select("id,en,ku,ar").order("id")),
    readAll(() => app("orders").select("id,created_at,sent_at,sent_by").eq("status", "sent").gte("sent_at", since).order("sent_at").order("id")),
    readReminder(),
    listDevices(s),
    can(s, "record") ? listActivity() : Promise.resolve([]),
    can(s, "assistant") ? listInbox(s) : Promise.resolve([]),
    readStreak(),
    listMonths(12),
    readDraft(s.account),
  ]);
  const orderRows = orders;
  const lines = await orderLinesFor(orderRows);
  return {
    account: s.account, name: me?.name ?? accountName(s.account),
    views: viewsFor(s), roles: s.roles,
    pins: me?.pins ?? [], streak,
    suppliers: suppliers.map(toSupplier),
    items: items.map(toItem),
    units,
    history: groupHistory(orderRows, lines),
    historyMonth: monthKey(),
    reminder, devices, activity, inbox, months, draft,
  };
}
async function readDraft(account: Account) {
  const { data, error } = await app("order_drafts").select("cart,revision").eq("account", account).maybeSingle();
  if (error) throw error;
  return { cart: data?.cart ?? {}, revision: data?.revision ?? 0, conflicts: [] };
}
/* The archive: one summary per finished month, newest first. */
async function listMonths(limit = 24) {
  const { data, error } = await app("month_summaries").select("month,data").order("month", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((m: any) => ({ month: m.month, ...m.data }));
}

/* ---------- Sign-in, and wrong-guess limits ----------
   Two independent locks. The per-IP one is cheap and useful, but every one of
   those headers is client-suppliable when there is no trusted proxy in front
   of this function, so a spoofed value could claim a fresh IP on every
   request and never trip it. The second lock does not depend on any claimed
   identity at all -- it counts every failed attempt in the window, from
   anywhere -- so brute force is capped no matter what headers are sent. A
   wrong current PIN on Admin's PIN change counts toward the same limits. */
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

async function requestLimit(keys: string[], limits: number[]): Promise<Response | null> {
  const {data,error}=await db.rpc("app_internal_reserve_requests",{p_keys:keys,p_limits:limits,p_seconds:60});
  if(error || typeof data!=="boolean")return fail("rate_limit_unavailable",503);
  return data ? null : new Response(JSON.stringify({error:"too_many_requests"}),{
    status:429,headers:{...cors,"Content-Type":"application/json","Retry-After":"60"},
  });
}

async function login(req: Request) {
  const { pin, turnstileToken } = await readBody(req);
  const prints = await loginFingerprints(req);
  const limited=await requestLimit(["public:login",`login:${prints[0]}`],[300,60]);
  if(limited)return limited;
  if(!(await verifyTurnstile(botConfig,turnstileToken)))return fail("verification_failed",403);
  // Do not truncate an untrusted value before verifying it: otherwise a
  // valid PIN followed by extra characters could be accepted.
  if (!/^\d{6}$/.test(String(pin ?? ""))) return fail("invalid_credentials", 401);
  const attempt = await reserveLogin(prints);
  // A lock is written to the security log once per phone per lock, not once per refused try.
  if (!attempt) { await securityEvent(req, "locked", null, {}, LOGIN_WINDOW_MS / 1000); return fail("too_many_attempts", 429); }

  return await startSession(req, String(pin), attempt);
}

/* ---------- The security log ---------- */
async function securityEvent(req: Request, kind: string, account: Account | null, detail: Record<string, unknown> = {}, dedupeSeconds = 0) {
  // The log must never stop a sign-in answer: a failed write is only noted.
  try {
    const { error } = await db.rpc("app_internal_security_event", {
      p_kind: kind, p_account: account, p_device: text(req.headers.get("x-device-id"), 120) || null,
      p_label: deviceLabel(req), p_detail: detail, p_dedupe_seconds: dedupeSeconds,
    });
    if (error) console.error("security_event_failed", kind);
  } catch { console.error("security_event_failed", kind); }
}
/* Work that may finish after the reply (the runtime keeps it alive); a failure is only logged. */
function later(work: Promise<unknown>) {
  const done = work.catch(() => console.error("background_work_failed"));
  (globalThis as any).EdgeRuntime?.waitUntil?.(done);
}
/* A phone that has never signed in to this account: Rozha hears about it at once (Rico's inbox and a
   notification on her other signed-in phones), whoever it was. */
async function alertNewDevice(req: Request, account: Account, deviceId: string | null) {
  const [kind, how] = (deviceLabel(req) ?? "").split("|");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const n = LOCAL_NAMES[account];
  const device = { en: kind || "a new device", ku: kind || "ئامێرێکی نوێ", ar: kind || "جهاز جديد" };
  const via = how === "App" ? { en: " (app)", ku: " (ئەپ)", ar: " (التطبيق)" } : { en: "", ku: "", ar: "" };
  const words = {
    en: `New sign-in: ${n.en} on ${device.en}${via.en} at ${time}. If you didn't expect it, change that PIN in Admin, PINs.`,
    ku: `چوونەژوورەوەی نوێ: ${n.ku} لەسەر ${device.ku}${via.ku} کاتژمێر ${time}. ئەگەر چاوەڕێی نەبوویت، ئەو کۆدە لە ئەدمین، کۆدەکان بگۆڕە.`,
    ar: `تسجيل دخول جديد: ${n.ar} على ${device.ar}${via.ar} الساعة ${time}. إذا لم تكن تتوقعه، غيّر ذلك الرمز من المشرف، الرموز.`,
  };
  const { error } = await app("rico_inbox").insert({ account: "rozha", kind: "security", mood: "worried", body_en: words.en, body_ku: words.ku, body_ar: words.ar });
  if (error) console.error("security_inbox_failed");
  if (!CRON_SECRET) return;
  await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, "x-cron-secret": CRON_SECRET },
    body: JSON.stringify({ type: "security", account: "rozha", excludeDevice: deviceId, bodyEn: words.en, bodyKu: words.ku, bodyAr: words.ar }),
  }).catch(() => console.error("security_push_failed"));
}

/* The database checks the PIN under the same account locks as PIN changes.
   It commits attempts, session and device together; no orphan token or device takeover on a race. */
async function startSession(req: Request, pin: string, attempt: number[]) {
  const token = randomToken();
  const { data, error } = await db.rpc("app_internal_start_session", {
    p_code: pin, p_token_hash: await hash(token),
    p_device: text(req.headers.get("x-device-id"), 120) || null,
    p_label: deviceLabel(req), p_version: appVersion(req), p_attempt_ids: attempt,
  });
  if (error) return fail("login_failed", 503);
  if (data?.error === "invalid_credentials") { await securityEvent(req, "wrong_pin", null); return fail("invalid_credentials", 401); }
  if (data?.error === "device_in_use") return fail("device_in_use", 409);
  if (!["rozha", "yunis"].includes(data?.account) || !Number.isFinite(Date.parse(data?.expiresAt))) return fail("login_failed", 503);
  if (data.newDevice) later(alertNewDevice(req, data.account, text(req.headers.get("x-device-id"), 120) || null));
  return json({ token, account: data.account, name: data.name ?? accountName(data.account), expiresAt: data.expiresAt });
}

/* ---------- PINs (Admin, Rozha only) ----------
   Rozha gives herself or Yunis a new PIN after typing her current one. A wrong
   current PIN counts as a failed sign-in (the same limits), so a phone left
   signed in can't be used to guess it. The new PIN signs that account out
   everywhere except the device making the change. */
async function changePin(req: Request, s: Session, b: any) {
  const account = b.account === "rozha" || b.account === "yunis" ? b.account as Account : null;
  const newPin = String(b.newPin ?? "");
  if (!account || !/^\d{6}$/.test(newPin)) return fail("invalid_pin");
  if (isWeakPin(newPin)) return fail("weak_pin");
  const attempt = await reserveLogin(await loginFingerprints(req));
  if (!attempt) return fail("too_many_attempts", 429);
  const { data: good, error } = await db.rpc("app_internal_check_account_pin", { p_account: "rozha", p_pin: String(b.currentPin ?? "") });
  if (error) throw new Error("credential_check_unavailable");
  if (good !== true) return fail("wrong_pin", 403);
  await completeAttempt(attempt);
  const { data: result, error: setError } = await db.rpc("app_internal_set_pin", { p_account: account, p_pin: newPin, p_keep_session: s.id });
  if (setError) return fail("save_failed", 500);
  if (result === "duplicate") return fail("duplicate_pin");
  if (result === "forbidden") return fail("forbidden", 403);
  if (result !== "ok") return fail("save_failed", 500);
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
  // A unit has one name, in any language (the Kurdish and Arabic copies are gone).
  units: (id, b) => text(b.en, 80) ? { id, en: text(b.en, 80), ku: null, ar: null } : null,
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
      body_en: `${count} days in a row! The kitchen hasn't missed a single day. Keep it going, ${n.en}.`,
      body_ku: `${count} ڕۆژ لەسەر یەک! چێشتخانەکە تەنانەت یەک ڕۆژیشی لەدەست نەداوە. بەردەوام بە، ${n.ku}.`,
      body_ar: `${count} يومًا متتاليًا! لم يفوّت المطبخ يومًا واحدًا. استمر يا ${n.ar}.`,
    };
  });
  const { error } = await app("rico_inbox").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
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
  const { data: saved, error } = await db.rpc("app_internal_save_order", {
    p_id: id, p_date: date, p_account: s.account, p_lines: lines,
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
async function heartbeat(s: Session, label: string | null, version: string | null, seconds: unknown) {
  // Time in the app: the database adds at most the time that really passed since this phone last said.
  const spent = Math.floor(Number(seconds));
  if (Number.isFinite(spent) && spent > 0 && spent <= 1800) {
    const { error } = await db.rpc("app_internal_add_usage", { p_account: s.account, p_device: s.deviceId || `__session:${s.id}`, p_label: label, p_seconds: spent });
    if (error) console.error("usage_failed");
  }
  if (!s.deviceId) return ok();
  const { data: d, error: readError } = await app("devices").select("command,handled_command").eq("id", s.deviceId).eq("account",s.account).maybeSingle();
  if (readError) throw readError;
  const pendingLogout = d?.command?.type === "logout" && d.command.id !== d.handled_command;
  if (pendingLogout) return json({ ok: true, device: null });   // don't flip it back to "logged in"
  const { error } = await app("devices").update({ ...(label ? { label } : {}), ...(version ? { app_version: version } : {}), logged_in: true, last_seen: nowIso(), updated_at: nowIso() }).eq("id",s.deviceId).eq("account",s.account);
  if (error) throw error;
  return ok();
}

/* ---------- Live changes ----------
   An open app asks "anything new since n?". The answer comes as soon as a counter in app_signals moves
   (looked at every second), or after `wait` seconds (at most 25) with nothing new, and the app asks
   again. Only the kinds of change and their counters are sent, never the data itself. */
const SIGNAL_KINDS = ["data", "draft", "devices", "admin", "inbox"];
async function readSignals() {
  const { data, error } = await app("signals").select("kind,n");
  if (error) throw error;
  const kinds: Record<string, number> = {};
  for (const r of data ?? []) if (SIGNAL_KINDS.includes(r.kind)) kinds[r.kind] = Number(r.n) || 0;
  return { n: Math.max(0, ...Object.values(kinds)), kinds };
}
async function waitForSignals(since: number, waitSeconds: number, stop: AbortSignal) {
  const until = Date.now() + waitSeconds * 1000;
  for (;;) {
    const now = await readSignals();
    if (now.n !== since || Date.now() >= until || stop.aborted) return now;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function sendCommand(b: any) {
  const type = b.type === "logout" ? "logout" : b.type === "refresh" ? "refresh" : "";
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map((x: unknown) => text(x, 120)).filter(Boolean).slice(0, 50) : [];
  if (!type || !ids.length) return fail("invalid_command");
  const { error } = await db.rpc("app_internal_device_command", { p_ids: ids, p_type: type });
  return error ? fail("command_failed", 503) : ok();
}

/* ---------- Push ----------
   A test of the daily reminder needs the reminders role, a test of a supplier's reminder the catalog
   role, and a notification written through Rico the notify role (Rozha has all three). */
const PUSH_ROLES: Record<string, string> = { "reminder-now": "reminders", "supplier-test": "catalog", "assistant": "notify" };
async function forwardPush(s: Session, b: any) {
  const type = text(b.type, 30);
  if (!PUSH_ROLES[type]) return fail("invalid_type");
  if (!can(s, PUSH_ROLES[type])) return fail("forbidden", 403);
  if (!CRON_SECRET) return fail("push_not_configured", 500);
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

/* Rico's chat history: one shared list. Rozha and Yunis can read and delete every chat (the app shows
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
      ...(["happy","excited","grateful","calm","thinking","worried","sad","angry"].includes(x.mood) ? { mood: x.mood } : {}),
      ...(typeof x.error === "string" ? { error: x.error.slice(0, 40) } : {}),
      ...(Array.isArray(x.steps) ? { steps: x.steps.slice(0, 20).map((k: unknown) => String(k).slice(0, 40)) } : {}),
      ...(Array.isArray(x.proposals) ? { proposals: x.proposals.slice(0, 20).filter((p: any) => p && typeof p === "object" && !Array.isArray(p)).map((p: any)=>({...p,status:["pending","saving","applied","dismissed","undone","expired"].includes(p.status)?p.status:"expired"})) } : {}),
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
    else if (whose === "all") q = q.not("id", "is", null);
    else q = q.eq("account", whose === "rozha" || whose === "yunis" ? whose : actor);
    const { error } = await q;
    if (error) throw error;
    return json({ ok: true });
  }
  return fail("Unknown route", 404);
}

/* ---------- Admin (Rozha only) ---------- */
/* Rico's tokens this month, as Google and Groq counted them in their own replies. No cost is worked out:
   the real bill depends on the account's plan, which the app cannot see. */
function ricoTokens(models: any[]) {
  let input = 0, output = 0;
  for (const m of models ?? []) { input += Number(m.input) || 0; output += Number(m.output) || 0; }
  return { input, output };
}
async function adminRico() {
  const { data, error } = await db.rpc("app_internal_rico_usage", { p_actor: "rozha", p_from: monthStart() });
  if (error) throw error;
  const { models, ...rest } = data ?? {};
  // Model names stay on the server: Admin shows what Rico did and the tokens it used.
  return { ...rest, tokens: ricoTokens(models), hourLimit: 400, perPhoneHourLimit: 60 };
}
const PROBLEM_KINDS = ["error", "rejection", "console", "server", "manual"];
// Cut by characters, not UTF-16 halves, so an emoji at the limit is never split (the database refuses half of one).
const plain = (v: unknown, max: number) => Array.from(String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()).slice(0, max).join("");
/* Problem reports from a phone: shapes and sizes are checked here, and again by the table. */
function cleanProblems(v: unknown) {
  if (!Array.isArray(v) || !v.length || v.length > 10) return null;
  const out = [];
  for (const r of v as any[]) {
    if (!r || typeof r !== "object" || !/^[0-9a-f]{16,64}$/.test(String(r.fingerprint ?? "")) || !PROBLEM_KINDS.includes(r.kind)) return null;
    const message = plain(r.message, 500);
    if (!message) return null;
    out.push({
      fingerprint: String(r.fingerprint), kind: r.kind, message,
      source: plain(r.source, 200) || null, stack: plain(String(r.stack ?? "").replace(/\r/g, ""), 2000) || null,
      screen: /^[A-Za-z]{1,40}$/.test(String(r.screen ?? "")) ? String(r.screen) : null,
      count: Number.isInteger(r.count) && r.count >= 1 && r.count <= 1000 ? r.count : 1,
    });
  }
  return out;
}
async function adminProblems() {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data, error } = await app("problem_reports")
    .select("id,fingerprint,kind,message,source,stack,screen,account,device_id,device_label,app_version,count,first_at,last_at,resolved_at")
    .or(`resolved_at.is.null,resolved_at.gte.${since}`).order("last_at", { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []).map((p: any) => ({ id: p.id, fingerprint: p.fingerprint, kind: p.kind, message: p.message, source: p.source, stack: p.stack,
    screen: p.screen, account: p.account, deviceId: p.device_id, label: p.device_label, version: p.app_version, count: p.count,
    firstAt: p.first_at, lastAt: p.last_at, resolvedAt: p.resolved_at }));
}

/* ---------- Router ---------- */
Deno.serve(async (req) => {
  // CORS is not authentication. Reject a supplied foreign Origin before any database access.
  const origin=req.headers.get("Origin");
  if(origin && origin!==ALLOWED_ORIGIN)return fail("forbidden_origin",403);
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers: cors });
  if(!["GET","POST","PUT","DELETE"].includes(req.method))return fail("method_not_allowed",405);
  if(req.method!=="GET" && !acceptsJson(req))return fail("unsupported_media_type",415);
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const at = segments.lastIndexOf("api");
  const path = (at >= 0 ? segments.slice(at + 1) : segments).join("/");
  const M = req.method;

  try {
    if (M === "POST" && path === "login") return await login(req);
    if (M === "GET" && path === "auth/security")return json({required:botConfig.required,siteKey:botConfig.required&&botConfig.ready?botConfig.siteKey:null});
    if (M === "GET" && path === "health") {
      const { error } = await app("accounts").select("id", { head: true }).limit(1);
      return error ? json({ ok: false }, 503) : json({ ok: true });
    }

    const s = await authenticate(req);
    if (!s) return fail("unauthorized", 401);
    const rozha = isRozha(s);
    const keys=[`account:${s.account}:${M==="GET"?"read":"write"}`],limits=[M==="GET"?240:600];
    if(path==="push/send"){keys.push(`account:${s.account}:push`);limits.push(6);}
    if(path==="problems"){keys.push(`account:${s.account}:problems`);limits.push(20);}
    if(path.startsWith("rico-chats") && M!=="GET"){keys.push(`account:${s.account}:chats`);limits.push(40);}
    if(path==="stock/read" || (path==="stock-items" && M==="PUT")){keys.push(`account:${s.account}:stock`);limits.push(20);}
    const limited=path==="logout"?null:await requestLimit(keys,limits);if(limited)return limited;
    const b = M === "GET" ? {} : await readBody(req, ["assistant/transcribe", "stock/read", "stock-items"].includes(path) ? MAX_AUDIO_BODY_BYTES : MAX_BODY_BYTES);
    let m: RegExpMatchArray | null;

    if (M === "GET" && path === "bootstrap") return json(await bootstrap(s));
    if (M === "GET" && path === "draft") return json(await readDraft(s.account));
    if (M === "PUT" && path === "draft") {
      const changes = b.changes;
      if (!Array.isArray(changes) || changes.length > 2000 || new Set(changes.map((c: any) => c?.itemId)).size !== changes.length || changes.some((c: any) =>
        !c || typeof c.itemId !== "string" || !c.itemId.length || c.itemId.length > 200 || !validQuantity(c.before,true) || !validQuantity(c.after,true) || c.before < 0 || c.after < 0 || c.before > 99999 || c.after > 99999)) return fail("invalid_draft");
      const { data, error } = await db.rpc("app_internal_patch_draft", { p_account: s.account, p_changes: changes });
      return error ? fail("draft_save_failed", 503) : json(data, data?.conflicts?.length ? 409 : 200);
    }
    if (M === "POST" && path === "logout") {
      const { error } = await db.rpc("app_internal_logout", { p_session: s.id, p_device: s.deviceId });
      return error ? fail("logout_failed", 503) : ok();
    }
    if (M === "PUT" && path === "me/pins") {
      const ids = Array.isArray(b.itemIds) ? [...new Set(b.itemIds.map((id: unknown) => text(id, 120)).filter(Boolean))] : null;
      if (!ids || ids.length > 60) return fail("invalid_pins");
      const { error } = await app("accounts").update({ pins: ids, updated_at: nowIso() }).eq("id", s.account);
      return error ? fail("save_failed", 500) : ok();
    }

    if (M === "GET" && path === "admin/diagnostics") {
      if (!rozha) return fail("forbidden",403);
      const started=performance.now();
      const {data,error}=await db.rpc("app_internal_diagnostics",{p_actor:s.account});
      return error ? fail("diagnostics_unavailable",503) : json({...data,latencyMs:Math.round(performance.now()-started)});
    }
    if (path.startsWith("admin/") && !rozha) return fail("forbidden", 403);
    if (M === "GET" && path === "admin/security") {
      const prints = await loginFingerprints(req);
      const { data, error } = await db.rpc("app_internal_security_summary", { p_actor: s.account, p_global: prints[1], p_window_seconds: LOGIN_WINDOW_MS / 1000, p_global_limit: MAX_GLOBAL_FAILED_LOGINS });
      return error ? fail("security_unavailable", 503) : json(data);
    }
    if (M === "POST" && path === "admin/security/unlock") {
      const { data, error } = await db.rpc("app_internal_unlock_signin", { p_actor: s.account, p_window_seconds: LOGIN_WINDOW_MS / 1000, p_device: s.deviceId });
      return error ? fail("save_failed", 500) : json({ ok: true, cleared: data });
    }
    if (M === "GET" && path === "admin/problems") return json(await adminProblems());
    if (M === "POST" && path === "admin/problems/resolve") {
      const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x: unknown) => Number.isSafeInteger(x) && Number(x) > 0))] : [];
      if (!ids.length || ids.length > 300) return fail("invalid_input");
      const { error } = await app("problem_reports").update({ resolved_at: nowIso() }).in("id", ids).is("resolved_at", null);
      return error ? fail("save_failed", 500) : ok();
    }
    if (M === "DELETE" && path === "admin/problems") {
      const { error } = await app("problem_reports").delete().not("resolved_at", "is", null);
      return error ? fail("delete_failed", 500) : ok();
    }
    if (M === "GET" && path === "admin/usage") {
      const { data, error } = await db.rpc("app_internal_usage_summary", { p_actor: s.account });
      return error ? fail("usage_unavailable", 503) : json(data);
    }
    if (M === "GET" && path === "admin/rico") return json(await adminRico());
    if (M === "GET" && path === "admin/roles") {
      const { data, error } = await app("accounts").select("roles").eq("id", "yunis").maybeSingle();
      return error ? fail("roles_unavailable", 503) : json({ roles: ROLES, yunis: rolesOf("yunis", data?.roles), standard: data?.roles == null });
    }
    if (M === "PUT" && path === "admin/roles") {
      const roles = Array.isArray(b.roles) ? b.roles : null;
      if (b.account !== "yunis" || !roles || roles.length > ROLES.length || roles.some((r: unknown) => typeof r !== "string" || !ROLES.includes(r)) || new Set(roles).size !== roles.length) return fail("invalid_input");
      const { data, error } = await db.rpc("app_internal_set_roles", { p_actor: s.account, p_account: "yunis", p_roles: roles, p_device: s.deviceId });
      return error ? fail("save_failed", 500) : json({ roles: rolesOf("yunis", data) });
    }
    if (M === "POST" && path === "problems") {
      const reports = cleanProblems(b.reports);
      if (!reports) return fail("invalid_input");
      const { data, error } = await db.rpc("app_internal_report_problems", { p_reports: reports, p_account: s.account, p_device: s.deviceId || `__session:${s.id}`, p_label: deviceLabel(req), p_version: appVersion(req) });
      return error ? fail("save_failed", 500) : json({ ok: true, kept: data });
    }
    if (M === "GET" && path === "reports/catalog") {
      if (!can(s, "exports")) return fail("forbidden", 403);
      const { data, error } = await db.rpc("app_internal_catalog_report", { p_from: monthStart() });
      return error ? fail("report_unavailable", 503) : json(data);
    }
    // Yunis's roles: every route that reads or changes something he may be without is checked here.
    const catalogWrite = (M === "PUT" || M === "DELETE") && /^(?:suppliers|items|units)\/[^/]+$/.test(path)
      || (M === "PUT" && (path.startsWith("supplier-order/") || path === "items/aliases")) || (M === "POST" && path === "items/restore");
    if (catalogWrite && !can(s, "catalog")) return fail("forbidden", 403);
    if ((M === "POST" && path === "orders" && !can(s, "send")) || (path === "months" && !can(s, "history"))
      || (path === "activity" && !can(s, "record")) || ((path.startsWith("stock") ) && !can(s, "transfers"))
      || ((path.startsWith("assistant/") || path.startsWith("rico-chats") || path === "streak/recover") && !can(s, "assistant"))
      || (path === "reminder" && !can(s, "reminders"))) return fail("forbidden", 403);
    if (M === "POST" && path === "items/restore") {
      if (typeof b.undoId!=="string" || !/^[a-f0-9-]{36}$/.test(b.undoId)) return fail("invalid_input");
      const {data,error}=await db.rpc("app_internal_item_undo",{p_id:b.undoId,p_actor:s.account,p_device:s.deviceId,p_restore:true});
      return error ? fail("save_failed",503) : json(data,data?.error?409:200);
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
    if (M === "PUT" && path === "items/aliases") {
      const entries=b.entries;
      if(!Array.isArray(entries) || !entries.length || entries.length>200 || new Set(entries.map((r:any)=>r?.itemId)).size!==entries.length || entries.some((r:any)=>!r || typeof r.itemId!=="string" || !r.itemId || r.itemId.length>120 || [r.before,r.aliases].some(v=>!Array.isArray(v) || v.length>12 || v.some((a:unknown)=>typeof a!=="string" || !a.trim() || a.length>120)))) return fail("invalid_input");
      const {data,error}=await db.rpc("app_internal_set_aliases",{p_entries:entries,p_actor:s.account,p_device:s.deviceId});
      if(error)return fail("save_failed",500);
      return data?.conflicts?.length ? json(data,409) : json(data);
    }
    if ((m = path.match(/^(suppliers|items|units)\/([^/]{1,120})$/))) {
      const table = m[1], id = decodeURIComponent(m[2]);
      if (M === "PUT" || M === "DELETE") {
        if (M === "DELETE" && table === "items") {
          const {data,error}=await db.rpc("app_internal_item_undo",{p_id:id,p_actor:s.account,p_device:s.deviceId,p_restore:false});
          return error ? fail("delete_failed",503) : json(data,data?.error?409:200);
        }
        const row = M === "PUT" ? CATALOG[table](id, b) : null;
        if (M === "PUT" && !row) return fail("invalid_input");
        const { error } = await db.rpc("app_internal_catalog_change", { p_table: table, p_id: id, p_row: row, p_actor: s.account, p_device: s.deviceId });
        return error ? fail(M === "DELETE" ? "delete_failed" : "save_failed", 500) : ok();
      }
    }

    // Orders
    if (M === "POST" && path === "orders") return await saveOrder(s, b);
    if (M === "DELETE" && (m = path.match(/^orders\/([^/]{1,160})$/))) {
      // Sent orders are the kitchen's paper trail, and only Rozha removes them (Yunis asks her). She
      // may undo her own for 15 minutes; any other takes her PIN. A wrong PIN counts as a failed
      // sign-in (the same limits), and the database checks the rules again.
      if (!rozha) return fail("forbidden", 403);
      const id = decodeURIComponent(m[1]);
      if (b.pin !== undefined) {
        if (!/^\d{6}$/.test(String(b.pin))) return fail("wrong_pin", 403);
        const attempt = await reserveLogin(await loginFingerprints(req));
        if (!attempt) return fail("too_many_attempts", 429);
        const { data: good, error } = await db.rpc("app_internal_check_account_pin", { p_account: "rozha", p_pin: String(b.pin) });
        if (error) throw new Error("credential_check_unavailable");
        if (good !== true) return fail("wrong_pin", 403);
        await completeAttempt(attempt);
      } else {
        const { data: order, error } = await app("orders").select("created_by,created_at").eq("id", id).maybeSingle();
        if (error) return fail("delete_failed", 500);
        if (order && (order.created_by !== s.account || Date.parse(order.created_at) < Date.now() - UNDO_MS)) return fail("pin_required", 403);
      }
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

    // The month archive
    if (M === "GET" && path === "months") return json(await listMonths());

    // Transfers: the workplace item list, and reading a list to move between storages
    if (!TRANSFERS_OPEN && (path === "stock-items" || path === "stock/read" || path.startsWith("stock-items/"))) return fail("transfers_not_ready", 423);
    if (M === "GET" && path === "stock-items") return json(await listStockItems(db));
    if (M === "PUT" && path === "stock-items") {
      const items = cleanStockList(b.items);
      if (!items) return fail("invalid_input");
      const { data, error } = await db.rpc("app_internal_replace_stock_items", { p_items: items });
      return error ? fail("save_failed", 500) : json({ ok: true, count: data });
    }
    if (M === "POST" && (m = path.match(/^stock-items\/([^/]{1,80})\/alias$/))) {
      const alias = text(b.alias, 120);
      if (!alias) return fail("invalid_input");
      const { data, error } = await db.rpc("app_internal_stock_alias", { p_id: decodeURIComponent(m[1]), p_alias: alias });
      if (error) return fail("save_failed", 500);
      return data ? ok() : fail("not_found", 404);
    }
    if (M === "POST" && path === "stock/read") { const r = await readTransferList(db, s, b); return json(r.body, r.status); }

    // Record
    if (M === "GET" && path === "activity") return json(await listActivity());

    // Devices
    if (M === "GET" && path === "devices") return json(await listDevices(s));
    if (M === "POST" && path === "devices/me") return await heartbeat(s, deviceLabel(req), appVersion(req), b.seconds);
    if (M === "POST" && path === "devices/me/ack") {
      if (s.deviceId) {
        const { error } = await app("devices").update({ handled_command: text(b.commandId, 120) || null }).eq("id", s.deviceId).eq("account",s.account);
        if (error) return fail("ack_failed", 503);
      }
      return ok();
    }
    if (M === "POST" && path === "devices/command") return rozha ? await sendCommand(b) : fail("forbidden", 403);
    if (M === "GET" && path === "signals") {
      const q = new URL(req.url).searchParams, since = Number(q.get("since") ?? -1), wait = Number(q.get("wait") ?? 0);
      if (!Number.isSafeInteger(since) || since < -1 || !Number.isFinite(wait) || wait < 0) return fail("invalid_input");
      return json(await waitForSignals(since, Math.min(25, wait), req.signal));
    }

    // Admin
    if (M === "PUT" && path === "admin/pin") return rozha ? await changePin(req, s, b) : fail("forbidden", 403);

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
        if(!rozha && !s.deviceId)return fail("device_required",403);
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
      if(!rozha && !s.deviceId)return fail("device_required",403);
      if (!isPushEndpoint(b.endpoint)) return fail("invalid_endpoint");
      let q = app("push_subscriptions").update({ lang: langOf(b.lang), updated_at: nowIso() }).eq("endpoint", text(b.endpoint, 1000));
      if (!rozha) q = s.deviceId ? q.eq("device_id", s.deviceId) : q.is("device_id", null);
      const { error } = await q;
      return error ? fail("save_failed", 500) : ok();
    }
    if (M === "POST" && path === "push/send") return await forwardPush(s, b);
    // Both accounts can set the kitchen's daily reminder (it is on both Settings screens).
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
    console.error("api_request_failed", M, path.slice(0,160));
    return fail("server_error", 500);
  }
});
