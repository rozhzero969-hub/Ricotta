// Ricotta Orders API -- the only door between the browser and the database.
//
// The browser never talks to Postgres directly: every request carries an
// opaque session token (issued by POST /login after a bcrypt PIN check) and
// this function uses the service-role key server-side.
//
// Routes (all JSON):
//   POST   login                      {pin}                     -> {token, role, expiresAt}
//   GET    health
//   --- session required ---
//   GET    bootstrap                                            -> everything the app needs to start
//   POST   logout
//   PUT    suppliers/:id | items/:id | units/:id   (admin)      upsert one record (+ its Record entry)
//   DELETE suppliers/:id | items/:id | units/:id   (admin)      delete one record (+ its Record entry)
//   POST   orders                     {id, date, entries}       save a sent order
//   DELETE orders/:id                                           delete one order from history
//   GET    activity                   (admin)                   the Record
//   POST   activity                   {entry}   (admin)         older app versions only (skipped if the server already recorded it)
//   GET    devices                    admin: all, staff: own row
//   POST   devices/me                 {nickname?}               heartbeat ("still here")
//   POST   devices/me/ack             {commandId}               a remote command was carried out
//   PUT    devices/:id/nickname       {nickname} (admin or self)
//   POST   devices/command            {ids, type} (admin)       remote log out / refresh
//   PUT    push/subscription          {endpoint,p256dh,auth,lang}
//   DELETE push/subscription          {endpoint}
//   PUT    push/lang                  {endpoint, lang}
//   PUT    reminder                   {enabled, time} (admin)   daily reminder settings
//   POST   push/send                  {type, ...}     (admin)   forwarded to send-push
//   POST   admin/pins                 {adminPin, staffPin} (admin)
//   PUT    devices/me/name            {name}                    who is using this device (for Rico)
//   POST   assistant/chat             {messages, lang, ...}     Rico's reply, streamed (see assistant.ts)
//   POST   assistant/transcribe       {audio, mime, lang}       a voice message to Rico, as text
//   GET    assistant/suggestion                                 today's "Rico suggests" card (no AI call)
//   GET    assistant/status                                     is Rico connected?
//   GET    assistant/setup-status                               admin-only Groq one-time setup state
//   PUT    assistant/groq-key          {key}                    admin-only, add-only
import { createClient } from "npm:@supabase/supabase-js@2";
import { assistantSetupStatus, assistantStatus, handleChat, handleTranscribe, orderSuggestion, saveGroqKey } from "./assistant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const SESSION_HOURS = 18;
const LOGIN_WINDOW_MS = 10 * 60_000;
const MAX_FAILED_LOGINS = 8;              // per network address, per window (spoofable -- see MAX_GLOBAL_FAILED_LOGINS)
const MAX_GLOBAL_FAILED_LOGINS = 40;      // per window, across ALL claimed IPs -- not spoofable via headers
const SEEN_WRITE_EVERY_MS = 5 * 60_000;   // throttle session last_seen_at writes
const ACTIVITY_LIMIT = 500;
const HISTORY_LIMIT = 300;                // newest sent orders the app loads at start
const HISTORY_DEFAULT_DAYS = 120;         // bootstrap only sends recent history by default (see "history/more")
const HISTORY_PAGE_DAYS = 120;            // "load more" fetches this many additional days per request
const PAGE = 1000;                        // PostgREST returns at most 1000 rows per request
const RECORD_TYPES = ["supplier", "item", "unit"];
const RECORD_ACTIONS = ["add", "edit", "delete"];
// Allowed browser origin for this app. Set ALLOWED_ORIGIN if the production
// site ever moves to another origin.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://rozhzero969-hub.github.io";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-session-token",
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
const nowIso = () => new Date().toISOString();
const hash = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
};
/* Request bodies are small JSON everywhere except a voice clip for Rico.
   Anything larger than the route allows is refused before it is parsed, so a
   huge upload can't tie up the function. */
const MAX_BODY_BYTES = 256 * 1024;
const MAX_AUDIO_BODY_BYTES = 3 * 1024 * 1024;
class BodyTooLarge extends Error {}
const readBody = async (req: Request, max = MAX_BODY_BYTES): Promise<any> => {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) throw new BodyTooLarge();
  let raw = "";
  try { raw = await req.text(); } catch { return {}; }
  if (raw.length > max) throw new BodyTooLarge();
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};
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
   (000000, 111111...) or a straight run (123456, 654321, ...). Not a full
   strength check -- just closes the easiest guesses first. */
function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const down = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return up || down;
}

type Session = { id: string; role: "admin" | "staff"; deviceId: string | null };

async function authenticate(req: Request): Promise<Session | null> {
  const raw = req.headers.get("x-session-token") || req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw) return null;
  const { data } = await app("sessions")
    .select("id,role,device_id,expires_at,revoked_at,last_seen_at")
    .eq("token_hash", await hash(raw)).maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  if (Date.now() - new Date(data.last_seen_at).getTime() > SEEN_WRITE_EVERY_MS) {
    await app("sessions").update({ last_seen_at: nowIso() }).eq("id", data.id);
  }
  return { id: data.id, role: data.role, deviceId: data.device_id };
}

/* Security-relevant events that are not part of the Record screen (PIN
   changes, order deletes). Record entries use writeRecord below. */
async function audit(s: Session, action: string, type?: string, name?: string, payload: Record<string, unknown> = {}) {
  await app("audit_events").insert({
    id: newId("audit"), actor_role: s.role, device_id: s.deviceId, action,
    entity_type: type ?? null, entity_name: name ?? null, payload,
  });
}

/* The friendly "who did this" label for the Record screen. Resolved from the
   signed-in device's own row -- never from anything the client claims in the
   request body, which could be typed to say anything. */
async function actorLabel(s: Session): Promise<string> {
  if (!s.deviceId) return s.role === "admin" ? "Admin" : "Staff";
  const { data } = await app("devices").select("person_name,nickname").eq("id", s.deviceId).maybeSingle();
  return data?.person_name || data?.nickname || (s.role === "admin" ? "Admin" : "Staff");
}

/* ---------- The Record, written by the server ----------
   Every add / edit / delete of a supplier, item or unit is recorded here, in
   the same request as the change itself, with "who" taken from the session.
   The phone no longer has to remember to send it (it used to, via POST
   activity -- which a dropped connection or an edited client could skip).
   Entry shape matches what the app has always written, so the Record screen
   shows server entries exactly like the old phone-written ones. */
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];   // Saturday first, same as the app
const RECORD_WINDOW_MS = 10 * 60_000;       // how close an old-phone entry must be to count as a duplicate
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
function reminderCode(r: any): string {
  if (!r || !r.enabled) return "off";
  const days: number[] = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : [0, 1, 2, 3, 4, 5, 6];
  return `${r.time}|${DAY_ORDER.filter((d) => days.includes(d)).join(",")}`;
}
const RECORD_SELECT: Record<string, string> = { suppliers: "id,name,phone,reminder", items: "id,name,unit_id,supplier_id", units: "id,en,ku" };
const RECORD_TYPE: Record<string, string> = { suppliers: "supplier", items: "item", units: "unit" };
async function unitEnOf(id: unknown) {
  if (!id) return "";
  const { data } = await app("units").select("en").eq("id", String(id)).maybeSingle();
  return str(data?.en);
}
async function supplierNameOf(id: unknown) {
  if (!id) return "";
  const { data } = await app("suppliers").select("name").eq("id", String(id)).maybeSingle();
  return str(data?.name);
}
/* The fields the Record shows for one row, in the same order and format the
   app uses (unit and supplier by name, reminder as "HH:MM|days" or "off"). */
async function recordSnapshot(table: string, row: any): Promise<[string, string][]> {
  if (table === "suppliers") return [["name", str(row.name)], ["phone", str(row.phone)], ["reminder", reminderCode(row.reminder)]];
  if (table === "items") return [["name", str(row.name)], ["unit", await unitEnOf(row.unit_id)], ["supplier", await supplierNameOf(row.supplier_id)]];
  return [["name", str(row.en)], ["nameKu", str(row.ku)]];
}
async function writeRecord(s: Session, table: string, action: string, name: string, fields: unknown[], extra: Record<string, unknown> = {}) {
  const { error } = await app("audit_events").insert({
    id: newId("a"), occurred_at: nowIso(), actor_role: s.role, device_id: s.deviceId,
    action, entity_type: RECORD_TYPE[table], entity_name: name,
    payload: { by: await actorLabel(s), fields, ...extra, source: "server" },
  });
  if (error) console.error("record write failed", table, action, error.message);
}
/* Called after a successful catalog write. `before` is the row as it was
   (null for a new one); `after` is the row as written (null for a delete). */
async function recordCatalogChange(s: Session, table: string, before: any, after: any, extra: Record<string, unknown> = {}) {
  if (!before && !after) return;
  if (!after) {
    // Delete: what it was. (Suppliers leave out the reminder, as the app always did.)
    const snap = (await recordSnapshot(table, before)).filter(([k, v]) => k !== "reminder" && (k === "name" || table === "items" || v));
    return writeRecord(s, table, "delete", snap[0][1], snap.map(([k, v]) => ({ k, from: v })), extra);
  }
  const next = await recordSnapshot(table, after);
  if (!before) {
    // Add: name always; items list unit + supplier even when empty; others only what was filled in.
    const snap = next.filter(([k, v]) => k === "name" || table === "items" || (v && v !== "off"));
    return writeRecord(s, table, "add", next[0][1], snap.map(([k, v]) => ({ k, to: v })), extra);
  }
  // Edit: only the fields that actually changed; nothing changed means nothing to record.
  const prev = new Map(await recordSnapshot(table, before));
  const fields = next.filter(([k, v]) => (prev.get(k) ?? "") !== v).map(([k, v]) => ({ k, from: prev.get(k) ?? "", to: v }));
  if (fields.length) await writeRecord(s, table, "edit", next[0][1], fields, extra);
}

/* ---------- Shapes the browser uses ---------- */
const toSupplier = (s: any) => ({ id: s.id, name: s.name, phone: s.phone, reminder: s.reminder });
const toItem = (i: any) => ({ id: i.id, name: i.name, unit: i.unit_id, supplierId: i.supplier_id, sortOrder: i.sort_order });
const toDevice = (d: any) => ({
  id: d.id, nickname: d.nickname, personName: d.person_name ?? null, role: d.role, loggedIn: d.logged_in,
  lastLogin: d.last_login, lastSeen: d.last_seen, command: d.command, handledCommand: d.handled_command,
});
const toActivity = (a: any) => ({
  ...(a.payload ?? {}), id: a.id, ts: a.occurred_at, role: a.actor_role, deviceId: a.device_id,
  action: a.action, type: a.entity_type, name: a.entity_name,
});
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
      let e = entries.find((x) => x.supplierId === l.supplier_id);
      if (!e) { e = { supplierId: l.supplier_id, supplierName: l.supplier_name ?? null, items: [] }; entries.push(e); }
      e.items.push({ itemId: l.item_id, name: l.item_name, unit: l.unit_id, qty: Number(l.qty) });
    }
    return { id: o.id, date: o.sent_at ?? o.created_at, entries };
  });
}

async function listDevices(s: Session) {
  let q = app("devices").select("id,nickname,person_name,role,logged_in,last_login,last_seen,command,handled_command");
  if (s.role !== "admin") q = q.eq("id", s.deviceId ?? "");
  const { data } = await q;
  return (data ?? []).map(toDevice);
}
async function listActivity() {
  const { data } = await app("audit_events")
    .select("id,occurred_at,actor_role,device_id,action,entity_type,entity_name,payload")
    .in("action", RECORD_ACTIONS).in("entity_type", RECORD_TYPES)
    .order("occurred_at", { ascending: false }).limit(ACTIVITY_LIMIT);
  return (data ?? []).map(toActivity);
}
async function readReminder() {
  const { data } = await app("reminder_settings").select("enabled,remind_time").eq("id", true).maybeSingle();
  return data ? { enabled: data.enabled, time: String(data.remind_time).slice(0, 5) } : null;
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
  const admin = s.role === "admin";
  const since = new Date(Date.now() - HISTORY_DEFAULT_DAYS * 86400_000).toISOString();
  const [suppliers, items, units, orders, reminder, devices, activity, pars] = await Promise.all([
    app("suppliers").select("id,name,phone,reminder").order("name"),
    app("items").select("id,name,unit_id,supplier_id,sort_order").order("name"),
    app("units").select("id,en,ku"),
    // Newest orders first, capped to the last HISTORY_DEFAULT_DAYS days by
    // default; older history is loaded on demand from GET history/more.
    app("orders").select("id,created_at,sent_at").eq("status", "sent").gte("sent_at", since)
      .order("sent_at", { ascending: false }).limit(HISTORY_LIMIT),
    readReminder(),
    listDevices(s),
    admin ? listActivity() : Promise.resolve([]),
    admin ? app("item_pars").select("item_id,par_qty,busy_boost_pct,est_qty,est_updated_at") : Promise.resolve({ data: [] as any[] }),
  ]);
  const orderRows = (orders.data ?? []).reverse();
  const lines = await orderLinesFor(orderRows);
  const oldestLoaded = orderRows[0]?.sent_at ?? orderRows[0]?.created_at ?? null;
  // Use the oldest row we actually returned as the cursor. If the 300-row
  // cap was hit inside the 120-day window, this still exposes the remaining
  // rows. If the window is empty, advance by the window boundary so sparse
  // older history can still be reached on the next click.
  const historyCursor = oldestLoaded ?? since;
  const { count: olderCount } = await app("orders").select("id", { count: "exact", head: true })
    .eq("status", "sent").lt("sent_at", historyCursor);
  return {
    role: s.role,
    suppliers: (suppliers.data ?? []).map(toSupplier),
    items: (items.data ?? []).map(toItem),
    units: units.data ?? [],
    history: groupHistory(orderRows, lines),
    historyHasMore: (olderCount ?? 0) > 0,
    historyOldestLoaded: (olderCount ?? 0) > 0 ? historyCursor : oldestLoaded,
    reminder, devices, activity,
    pars: admin ? (pars.data ?? []).map((p: any) => ({
      itemId: p.item_id, parQty: Number(p.par_qty), busyBoostPct: Number(p.busy_boost_pct),
      estQty: Number(p.est_qty), estUpdatedAt: p.est_updated_at,
    })) : [],
  };
}

/* "Load more" history: one page of orders older than `before` (an ISO
   timestamp), same shape as bootstrap's history array. */
async function moreHistory(before: string) {
  if (!before || isNaN(Date.parse(before))) return fail("invalid_before");
  const since = new Date(Date.parse(before) - HISTORY_PAGE_DAYS * 86400_000).toISOString();
  const { data } = await app("orders").select("id,created_at,sent_at").eq("status", "sent")
    .lt("sent_at", before).gte("sent_at", since).order("sent_at", { ascending: false }).limit(HISTORY_LIMIT);
  const orderRows = (data ?? []).reverse();
  const lines = await orderLinesFor(orderRows);
  const oldestLoaded = orderRows[0]?.sent_at ?? orderRows[0]?.created_at ?? null;
  const historyCursor = oldestLoaded ?? since;
  const { count: olderCount } = await app("orders").select("id", { count: "exact", head: true })
    .eq("status", "sent").lt("sent_at", historyCursor);
  return json({
    history: groupHistory(orderRows, lines),
    hasMore: (olderCount ?? 0) > 0,
    oldestLoaded: (olderCount ?? 0) > 0 ? historyCursor : oldestLoaded,
  });
}

/* ---------- Login ---------- */
async function login(req: Request) {
  const { pin } = await readBody(req);
  // Do not truncate an untrusted value before verifying it: otherwise a
  // valid PIN followed by extra characters could be accepted.
  if (!/^\d{6}$/.test(String(pin ?? ""))) return fail("invalid_credentials", 401);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Two independent locks. The per-IP one is cheap and useful, but every one
  // of those headers is client-suppliable when there is no trusted proxy in
  // front of this function, so a spoofed value could claim a fresh IP on
  // every request and never trip it. The second lock does not depend on any
  // claimed identity at all -- it just counts every failed attempt against
  // this endpoint in the window, from anywhere -- so brute force is capped
  // no matter what headers the client sends.
  const fingerprint = await hash(`ip|${ip}`);
  const GLOBAL_FINGERPRINT = await hash("global-login-lock");
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const [{ count }, { count: globalCount }] = await Promise.all([
    app("login_attempts").select("id", { count: "exact", head: true })
      .eq("fingerprint_hash", fingerprint).eq("succeeded", false).gte("attempted_at", since),
    app("login_attempts").select("id", { count: "exact", head: true })
      .eq("fingerprint_hash", GLOBAL_FINGERPRINT).eq("succeeded", false).gte("attempted_at", since),
  ]);
  if ((count ?? 0) >= MAX_FAILED_LOGINS || (globalCount ?? 0) >= MAX_GLOBAL_FAILED_LOGINS) return fail("too_many_attempts", 429);

  const { data: role } = await db.rpc("app_internal_verify_pin", { p_pin: String(pin) });
  const success = role === "admin" || role === "staff";
  await app("login_attempts").insert([
    { fingerprint_hash: fingerprint, succeeded: success },
    { fingerprint_hash: GLOBAL_FINGERPRINT, succeeded: success },
  ]);
  if (!success) return fail("invalid_credentials", 401);

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const deviceId = text(req.headers.get("x-device-id"), 120) || null;
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  await app("sessions").insert({ token_hash: await hash(token), role, device_id: deviceId, expires_at: expiresAt });
  if (deviceId) {
    // A command sent before this sign-in is old news: mark it handled so an
    // old "log out" can't kick the person out right after signing in.
    const { data: prev } = await app("devices").select("command").eq("id", deviceId).maybeSingle();
    await app("devices").upsert({
      id: deviceId, role, logged_in: true, last_login: nowIso(), last_seen: nowIso(), updated_at: nowIso(),
      ...(prev?.command?.id ? { handled_command: String(prev.command.id) } : {}),
    });
  }
  return json({ token, role, expiresAt });
}

/* ---------- Catalog (one record at a time) ---------- */
const CATALOG: Record<string, (id: string, b: any) => Record<string, unknown> | null> = {
  suppliers: (id, b) => text(b.name) ? {
    id, name: text(b.name), phone: text(b.phone, 40) || null,
    reminder: cleanReminder(b.reminder), updated_at: nowIso(),
  } : null,
  items: (id, b) => text(b.name) ? {
    id, name: text(b.name), unit_id: text(b.unit, 120) || null,
    supplier_id: text(b.supplierId, 120) || null,
    ...(Object.hasOwn(b, "sortOrder") ? { sort_order: Number.isInteger(b.sortOrder) && b.sortOrder >= 0 ? b.sortOrder : null } : {}),
    updated_at: nowIso(),
  } : null,
  units: (id, b) => text(b.en, 80) ? { id, en: text(b.en, 80), ku: text(b.ku, 80) || null } : null,
};

async function saveOrder(s: Session, b: any) {
  const id = text(b.id, 160);
  if (!id || !Array.isArray(b.entries)) return fail("invalid_order");
  // A real order is at most a few dozen suppliers and a few hundred lines;
  // anything far beyond that is refused instead of written line by line.
  const lineCount = b.entries.reduce((n: number, e: any) => n + (Array.isArray(e?.items) ? e.items.length : 0), 0);
  if (b.entries.length > 80 || lineCount > 800) return fail("invalid_order");
  const { data: existing } = await app("orders").select("id").eq("id", id).maybeSingle();
  if (existing) return ok();   // already saved (a retry) -- never duplicate its lines
  const date = b.date && !isNaN(Date.parse(b.date)) ? b.date : nowIso();
  const { error } = await app("orders").insert({ id, status: "sent", created_at: date, sent_at: date, created_by_role: s.role, sent_by_role: s.role });
  if (error) return fail("save_failed", 500);
  // Keep each supplier's name with the order, so History still shows it after
  // the supplier is renamed or deleted (supplier_id is then set to null).
  const supplierIds = [...new Set(b.entries.map((e: any) => text(e.supplierId, 120)).filter(Boolean))];
  const { data: sups } = supplierIds.length ? await app("suppliers").select("id,name").in("id", supplierIds) : { data: [] as any[] };
  const supplierNames = new Map((sups ?? []).map((x: any) => [x.id, x.name]));
  const lines = b.entries.flatMap((e: any) => (Array.isArray(e.items) ? e.items : []).map((i: any) => ({
    order_id: id, supplier_id: supplierNames.has(text(e.supplierId, 120)) ? text(e.supplierId, 120) : null,
    supplier_name: supplierNames.get(text(e.supplierId, 120)) ?? (text(e.supplierName, 160) || null),
    item_id: text(i.itemId, 120) || "legacy",
    item_name: text(i.name) || text(i.itemId) || "Item", unit_id: text(i.unit, 120) || null,
    qty: Math.min(Math.max(Number(i.qty) || 0, 0.0001), 99999),
  })));
  if (lines.length) {
    const { error: e2 } = await app("order_lines").insert(lines);
    if (e2) { await app("orders").delete().eq("id", id); return fail("save_failed", 500); }
  }
  // Await the best-effort update so the Edge Function cannot be frozen after
  // returning the response before the stock estimate has actually changed.
  await bumpStockOnSend(lines).catch((e) => console.error("stock bump failed", e));
  return ok();
}

/* Par-level stock estimate, "up" side: every item this order sent that has
   tracking turned on gets its estimate increased by the ordered quantity
   (assumes same-day delivery -- there is no receiving step in this app by
   design). The "down" side is a daily decay run by send-push's cron tick. */
async function bumpStockOnSend(lines: { item_id: string; qty: number }[]) {
  const byItem = new Map<string, number>();
  for (const l of lines) byItem.set(l.item_id, (byItem.get(l.item_id) ?? 0) + Number(l.qty));
  if (!byItem.size) return;
  const { data: tracked } = await app("item_pars").select("item_id,est_qty").in("item_id", [...byItem.keys()]);
  for (const row of tracked ?? []) {
    const add = byItem.get(row.item_id) ?? 0;
    if (!add) continue;
    await app("item_pars").update({ est_qty: Math.round((Number(row.est_qty) + add) * 100) / 100, est_updated_at: nowIso() }).eq("item_id", row.item_id);
  }
}

async function addActivity(s: Session, b: any) {
  const e = b.entry ?? b;
  const action = text(e.action, 20), type = text(e.type, 20);
  if (!RECORD_ACTIONS.includes(action) || !RECORD_TYPES.includes(type)) return fail("invalid_entry");
  // The server now writes these itself (recordCatalogChange). Phones still on
  // an older app version keep sending their own copy -- skip it when the
  // server already recorded the same change, so the Record never shows it
  // twice. Anything the server has no copy of (e.g. an entry queued offline
  // before this change went live) is still saved as before.
  const at = e.ts && !isNaN(Date.parse(e.ts)) ? Date.parse(e.ts) : Date.now();
  const { count: already } = await app("audit_events").select("id", { count: "exact", head: true })
    .eq("action", action).eq("entity_type", type).eq("entity_name", text(e.name)).eq("payload->>source", "server")
    .gte("occurred_at", new Date(at - RECORD_WINDOW_MS).toISOString()).lte("occurred_at", new Date(at + RECORD_WINDOW_MS).toISOString());
  if (already) return ok();
  // "by" is never taken from the client: a device could type any name it
  // likes there. The real actor is resolved server-side from the session.
  const by = await actorLabel(s);
  const { error } = await app("audit_events").upsert({
    id: text(e.id, 160) || newId("a"), occurred_at: e.ts && !isNaN(Date.parse(e.ts)) ? e.ts : nowIso(),
    actor_role: s.role, device_id: s.deviceId, action, entity_type: type, entity_name: text(e.name),
    payload: { by, fields: Array.isArray(e.fields) ? e.fields.slice(0, 20) : [], ...(e.unassigned ? { unassigned: Number(e.unassigned) } : {}) },
  }, { ignoreDuplicates: true });
  return error ? fail("save_failed", 500) : ok();
}

/* ---------- Devices ---------- */
async function heartbeat(s: Session, b: any) {
  if (!s.deviceId) return ok();
  const { data: d } = await app("devices").select("command,handled_command").eq("id", s.deviceId).maybeSingle();
  const pendingLogout = d?.command?.type === "logout" && d.command.id !== d.handled_command;
  if (pendingLogout) return json({ ok: true, device: null });   // don't flip it back to "logged in"
  const nickname = text(b.nickname, 120);
  await app("devices").upsert({
    id: s.deviceId, role: s.role, logged_in: true, last_seen: nowIso(), updated_at: nowIso(),
    ...(nickname ? { nickname } : {}),
  });
  return ok();
}

async function sendCommand(b: any) {
  const type = b.type === "logout" ? "logout" : b.type === "refresh" ? "refresh" : "";
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map((x: unknown) => text(x, 120)).filter(Boolean).slice(0, 50) : [];
  if (!type || !ids.length) return fail("invalid_command");
  const ts = nowIso();
  await Promise.all(ids.map((id) => app("devices").update({
    command: { id: "c" + crypto.randomUUID().slice(0, 12), type, ts },
    ...(type === "logout" ? { logged_in: false } : {}), updated_at: ts,
  }).eq("id", id)));
  if (type === "logout") {
    await app("sessions").update({ revoked_at: ts }).in("device_id", ids).is("revoked_at", null);
  }
  return ok();
}

/* ---------- Push ---------- */
async function forwardPush(b: any) {
  if (!CRON_SECRET) return fail("push_not_configured", 500);
  const type = text(b.type, 30);
  if (!["update", "reminder-now", "supplier-test", "assistant"].includes(type)) return fail("invalid_type");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, "x-cron-secret": CRON_SECRET },
    body: JSON.stringify({
      type, title: text(b.title, 80), bodyEn: text(b.bodyEn, 300), bodyKu: text(b.bodyKu, 300), supplierId: text(b.supplierId, 120),
    }),
  });
  const data = await res.json().catch(() => ({}));
  return json(data, res.status);
}

/* ---------- Legacy compatibility ----------
   Serves app builds older than APP_VERSION 2026-09-23.1 (they replaced whole
   lists at once). Delete this block once every device has updated. */
async function legacyState(s: Session, req: Request, key: string, payload: any) {
  const staffKeys = new Set(["orderHistory", "devices", "activityLog"]);
  if (s.role !== "admin" && !staffKeys.has(key)) return fail("forbidden", 403);
  if (req.method === "GET") {
    const data = await bootstrap(s);
    const map: Record<string, unknown> = { suppliers: data.suppliers, items: data.items, units: data.units, orderHistory: data.history, devices: data.devices, activityLog: data.activity };
    return json(map[key]);
  }
  if (req.method !== "PUT" || !Array.isArray(payload.value)) return fail("not_found", 404);
  const value: any[] = payload.value;
  if (key === "suppliers" || key === "items" || key === "units") {
    const rows = value.map((x) => CATALOG[key](text(x.id, 120), x)).filter((r) => r && r.id);
    if (rows.length) await app(key).upsert(rows as any[]);
  } else if (key === "orderHistory") {
    for (const o of value.slice(-5)) await saveOrder(s, o);   // only the newest can be new
  } else if (key === "activityLog") {
    for (const e of value.slice(-5)) await addActivity(s, e);
  } else if (key === "devices" && s.deviceId) {
    const me = value.find((x) => x?.id === s.deviceId);
    if (me?.loggedIn === false) await app("devices").update({ logged_in: false, last_seen: nowIso() }).eq("id", s.deviceId);
    else if (me) await heartbeat(s, { nickname: me.nickname });
  }
  return ok();
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
    if (M === "GET" && path === "health") {
      const { error } = await app("roles").select("role", { head: true }).limit(1);
      return error ? json({ ok: false }, 503) : json({ ok: true });
    }

    const s = await authenticate(req);
    if (!s) return fail("unauthorized", 401);
    const admin = s.role === "admin";
    const b = M === "GET" || M === "OPTIONS" ? {} : await readBody(req, path === "assistant/transcribe" ? MAX_AUDIO_BODY_BYTES : MAX_BODY_BYTES);
    let m: RegExpMatchArray | null;

    if (M === "GET" && path === "bootstrap") return json(await bootstrap(s));
    if (M === "GET" && path === "history/more") {
      const before = new URL(req.url).searchParams.get("before") || "";
      return await moreHistory(before);
    }
    if (M === "POST" && path === "logout") {
      await app("sessions").update({ revoked_at: nowIso() }).eq("id", s.id);
      if (s.deviceId) await app("devices").update({ logged_in: false, last_seen: nowIso() }).eq("id", s.deviceId);
      return ok();
    }

    // Catalog
    if (M === "PUT" && (m = path.match(/^supplier-order\/([^/]{1,120})$/))) {
      if (!admin) return fail("forbidden", 403);
      const supplierId = decodeURIComponent(m[1]);
      const itemIds = Array.isArray(b.itemIds) ? b.itemIds.map((id: unknown) => text(id, 120)) : null;
      if (!itemIds || itemIds.length > 500 || itemIds.some((id: string) => !id) || new Set(itemIds).size !== itemIds.length) return fail("invalid_order");
      const { data, error } = await db.rpc("app_internal_set_item_order", { p_supplier_id: supplierId, p_item_ids: itemIds });
      if (error || data !== true) return fail("invalid_order");
      return ok();
    }
    // Admin-only: a "Track stock" par level for one item (see app_item_pars).
    if (M === "PUT" && (m = path.match(/^items\/([^/]{1,120})\/stock$/))) {
      if (!admin) return fail("forbidden", 403);
      const itemId = decodeURIComponent(m[1]);
      const { data: item } = await app("items").select("id").eq("id", itemId).maybeSingle();
      if (!item) return fail("not_found", 404);
      if (b.track === false) {
        const { error } = await app("item_pars").delete().eq("item_id", itemId);
        return error ? fail("save_failed", 500) : ok();
      }
      const parQty = Number(b.parQty);
      if (!(parQty > 0) || parQty > 99999) return fail("invalid_par");
      const boost = Number(b.busyBoostPct);
      const { data: existing } = await app("item_pars").select("est_qty").eq("item_id", itemId).maybeSingle();
      const estQty = b.estQty !== undefined && b.estQty !== null && b.estQty !== ""
        ? Math.max(0, Number(b.estQty) || 0) : (existing ? Number(existing.est_qty) : parQty);
      const { error } = await app("item_pars").upsert({
        item_id: itemId, par_qty: parQty, busy_boost_pct: Number.isFinite(boost) && boost >= 0 ? Math.min(boost, 500) : 50,
        est_qty: estQty, est_updated_at: nowIso(),
      });
      return error ? fail("save_failed", 500) : ok();
    }
    if ((m = path.match(/^(suppliers|items|units)\/([^/]{1,120})$/))) {
      if (!admin) return fail("forbidden", 403);
      const table = m[1], id = decodeURIComponent(m[2]);
      // The row as it was, so the Record can say what changed.
      const { data: before } = await app(table).select(RECORD_SELECT[table]).eq("id", id).maybeSingle();
      if (M === "DELETE") {
        // Deleting a supplier unassigns its items (done by the database); count them first.
        let extra: Record<string, unknown> = {};
        if (table === "suppliers" && before) {
          const { count } = await app("items").select("id", { count: "exact", head: true }).eq("supplier_id", id);
          if (count) extra = { unassigned: count };
        }
        const { error } = await app(table).delete().eq("id", id);
        if (error) return fail("delete_failed", 500);
        await recordCatalogChange(s, table, before, null, extra).catch((e) => console.error("record", e));
        return ok();
      }
      if (M === "PUT") {
        const row = CATALOG[table](id, b);
        if (!row) return fail("invalid_input");
        const { error } = await app(table).upsert(row);
        if (error) return fail("save_failed", 500);
        await recordCatalogChange(s, table, before, row).catch((e) => console.error("record", e));
        return ok();
      }
    }

    // Orders
    if (M === "POST" && path === "orders") return await saveOrder(s, b);
    if (M === "DELETE" && (m = path.match(/^(?:orders|history)\/([^/]{1,160})$/))) {
      // Sent orders are the kitchen's paper trail: only an admin may remove one.
      if (!admin) return fail("forbidden", 403);
      const id = decodeURIComponent(m[1]);
      const { error } = await app("orders").delete().eq("id", id);
      if (error) return fail("delete_failed", 500);
      await audit(s, "delete", "order", id);
      return ok();
    }

    // Record
    if (path === "activity") {
      if (!admin) return fail("forbidden", 403);
      if (M === "GET") return json(await listActivity());
      if (M === "POST") return await addActivity(s, b);
    }

    // Devices
    if (M === "GET" && path === "devices") return json(await listDevices(s));
    if (M === "POST" && path === "devices/me") return await heartbeat(s, b);
    if (M === "POST" && path === "devices/me/ack") {
      if (s.deviceId) await app("devices").update({ handled_command: text(b.commandId, 120) || null }).eq("id", s.deviceId);
      return ok();
    }
    if (M === "POST" && path === "devices/command") return admin ? await sendCommand(b) : fail("forbidden", 403);
    if (M === "PUT" && (m = path.match(/^devices\/([^/]{1,120})\/nickname$/))) {
      const id = decodeURIComponent(m[1]);
      if (!admin && id !== s.deviceId) return fail("forbidden", 403);
      await app("devices").update({ nickname: text(b.nickname, 120) || null, updated_at: nowIso() }).eq("id", id);
      return ok();
    }

    // Who is using this device (Rico greets people by name)
    if (M === "PUT" && path === "devices/me/name") {
      if (!s.deviceId) return fail("no_device");
      const name = text(b.name, 40).replace(/[<>"]/g, "");
      await app("devices").update({ person_name: name || null, updated_at: nowIso() }).eq("id", s.deviceId);
      return ok();
    }

    // Rico, the assistant
    if (M === "POST" && path === "assistant/chat") return await handleChat(db, s, b, cors, req.signal);
    if (M === "POST" && path === "assistant/transcribe") return await handleTranscribe(db, s, b, cors);
    if (M === "GET" && path === "assistant/suggestion") return json(await orderSuggestion(db, s));
    if (M === "GET" && path === "assistant/status") return json(await assistantStatus(db));
    if (M === "GET" && path === "assistant/setup-status") return admin ? json(await assistantSetupStatus(db)) : fail("forbidden", 403);
    if (M === "PUT" && path === "assistant/groq-key") {
      if (!admin) return fail("forbidden", 403);
      const result = await saveGroqKey(db, b.key);
      return result.ok ? ok() : fail(result.error ?? "save_failed", result.error === "already_configured" ? 409 : 400);
    }

    // Push notifications
    if (path === "push/subscription") {
      const endpoint = text(b.endpoint, 1000);
      if (!/^https:\/\//.test(endpoint)) return fail("invalid_endpoint");
      // A device may only remove its own subscription (admins may remove any).
      if (M === "DELETE") {
        let q = app("push_subscriptions").delete().eq("endpoint", endpoint);
        if (!admin) q = s.deviceId ? q.eq("device_id", s.deviceId) : q.is("device_id", null);
        await q;
        return ok();
      }
      if (M === "PUT") {
        const p256dh = text(b.p256dh, 200), auth = text(b.auth, 100);
        if (!p256dh || !auth) return fail("invalid_keys");
        const { error } = await app("push_subscriptions").upsert({
          endpoint, p256dh, auth, device_id: s.deviceId, lang: b.lang === "ku" ? "ku" : "en", updated_at: nowIso(),
        });
        return error ? fail("save_failed", 500) : ok();
      }
    }
    if (M === "PUT" && path === "push/lang") {
      let q = app("push_subscriptions").update({ lang: b.lang === "ku" ? "ku" : "en", updated_at: nowIso() }).eq("endpoint", text(b.endpoint, 1000));
      if (!admin) q = s.deviceId ? q.eq("device_id", s.deviceId) : q.is("device_id", null);
      await q;
      return ok();
    }
    if (M === "POST" && path === "push/send") return admin ? await forwardPush(b) : fail("forbidden", 403);
    if (M === "PUT" && path === "reminder") {
      if (!admin) return fail("forbidden", 403);
      const time = text(b.time, 5);
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

    // PINs
    if (M === "POST" && path === "admin/pins") {
      if (!admin) return fail("forbidden", 403);
      // Validate the raw values before passing them on. Truncating first would
      // accidentally accept a longer value whose first six digits were valid.
      const adminPin = String(b.adminPin ?? "").trim();
      const staffPin = String(b.staffPin ?? "").trim();
      if (!/^\d{6}$/.test(adminPin) || !/^\d{6}$/.test(staffPin)) return fail("invalid_pin");
      if (isWeakPin(adminPin) || isWeakPin(staffPin)) return fail("weak_pin");
      const { error } = await db.rpc("app_internal_set_pins", { p_admin_pin: adminPin, p_staff_pin: staffPin });
      if (error) return fail("invalid_pin");
      await audit(s, "change_pins");
      return ok();
    }

    // Older app builds
    if ((m = path.match(/^state\/(suppliers|items|units|orderHistory|devices|activityLog)$/))) return await legacyState(s, req, m[1], b);
    if ((m = path.match(/^catalog\/(suppliers|items|units)(?:\/([^/]+))?$/))) {
      if (!admin) return fail("forbidden", 403);
      if (M === "DELETE" && m[2]) { await app(m[1]).delete().eq("id", m[2]); return ok(); }
      if (M === "POST") {
        const id = text(b.id, 120) || newId(m[1].slice(0, -1));
        const row = CATALOG[m[1]](id, b);
        if (!row) return fail("invalid_input");
        const { error } = await app(m[1]).upsert(row);
        return error ? fail("invalid_input") : json({ ok: true, id });
      }
    }

    return fail("not_found", 404);
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail("too_large", 413);
    console.error(path, e);
    return fail("server_error", 500);
  }
});
