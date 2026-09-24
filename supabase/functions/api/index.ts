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
//   PUT    suppliers/:id | items/:id | units/:id   (admin)      upsert one record
//   DELETE suppliers/:id | items/:id | units/:id   (admin)      delete one record
//   POST   orders                     {id, date, entries}       save a sent order
//   DELETE orders/:id                                           delete one order from history
//   GET    activity                   (admin)                   the Record
//   POST   activity                   {entry}   (admin)         add one Record entry
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
//   GET    assistant/status                                     is Rico connected?
import { createClient } from "npm:@supabase/supabase-js@2";
import { assistantStatus, handleChat } from "./assistant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const SESSION_HOURS = 18;
const LOGIN_WINDOW_MS = 10 * 60_000;
const MAX_FAILED_LOGINS = 8;              // per network address, per window
const SEEN_WRITE_EVERY_MS = 5 * 60_000;   // throttle session last_seen_at writes
const ACTIVITY_LIMIT = 500;
const HISTORY_LIMIT = 300;                // newest sent orders the app loads at start
const PAGE = 1000;                        // PostgREST returns at most 1000 rows per request
const RECORD_TYPES = ["supplier", "item", "unit"];
const RECORD_ACTIONS = ["add", "edit", "delete"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-session-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  // Let browsers reuse the pre-flight answer for a day instead of sending an
  // extra OPTIONS request before every single call.
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
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
const readBody = async (req: Request): Promise<any> => { try { return await req.json(); } catch { return {}; } };

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

/* Security-relevant events only (the Record the app shows is written by the
   app itself through POST activity). */
async function audit(s: Session, action: string, type?: string, name?: string, payload: Record<string, unknown> = {}) {
  await app("audit_events").insert({
    id: newId("audit"), actor_role: s.role, device_id: s.deviceId, action,
    entity_type: type ?? null, entity_name: name ?? null, payload,
  });
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

async function bootstrap(s: Session) {
  const admin = s.role === "admin";
  const [suppliers, items, units, orders, reminder, devices, activity] = await Promise.all([
    app("suppliers").select("id,name,phone,reminder").order("name"),
    app("items").select("id,name,unit_id,supplier_id,sort_order").order("name"),
    app("units").select("id,en,ku"),
    // Newest orders first, capped, then put back in date order for the app.
    app("orders").select("id,created_at,sent_at").eq("status", "sent").order("sent_at", { ascending: false }).limit(HISTORY_LIMIT),
    readReminder(),
    listDevices(s),
    admin ? listActivity() : Promise.resolve([]),
  ]);
  const orderRows = (orders.data ?? []).reverse();
  // Lines are read in small batches of orders: a long id list in one request
  // can exceed the URL length limit, and each batch is paged past 1000 rows.
  const lines: any[] = [];
  for (let i = 0; i < orderRows.length; i += 60) {
    const ids = orderRows.slice(i, i + 60).map((o) => o.id);
    lines.push(...await readAll(() => app("order_lines")
      .select("order_id,supplier_id,supplier_name,item_id,item_name,unit_id,qty").in("order_id", ids).order("id")));
  }
  return {
    role: s.role,
    suppliers: (suppliers.data ?? []).map(toSupplier),
    items: (items.data ?? []).map(toItem),
    units: units.data ?? [],
    history: groupHistory(orderRows, lines),
    reminder, devices, activity,
  };
}

/* ---------- Login ---------- */
async function login(req: Request) {
  const { pin } = await readBody(req);
  // Do not truncate an untrusted value before verifying it: otherwise a
  // valid PIN followed by extra characters could be accepted.
  if (!/^\d{6}$/.test(String(pin ?? ""))) return fail("invalid_credentials", 401);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const fingerprint = await hash(`ip|${ip}`);
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const { count } = await app("login_attempts").select("id", { count: "exact", head: true })
    .eq("fingerprint_hash", fingerprint).eq("succeeded", false).gte("attempted_at", since);
  if ((count ?? 0) >= MAX_FAILED_LOGINS) return fail("too_many_attempts", 429);

  const { data: role } = await db.rpc("app_internal_verify_pin", { p_pin: String(pin) });
  const success = role === "admin" || role === "staff";
  await app("login_attempts").insert({ fingerprint_hash: fingerprint, succeeded: success });
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
    reminder: b.reminder && typeof b.reminder === "object" ? b.reminder : null, updated_at: nowIso(),
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
    qty: Math.max(Number(i.qty) || 0, 0.0001),
  })));
  if (lines.length) {
    const { error: e2 } = await app("order_lines").insert(lines);
    if (e2) { await app("orders").delete().eq("id", id); return fail("save_failed", 500); }
  }
  return ok();
}

async function addActivity(s: Session, b: any) {
  const e = b.entry ?? b;
  const action = text(e.action, 20), type = text(e.type, 20);
  if (!RECORD_ACTIONS.includes(action) || !RECORD_TYPES.includes(type)) return fail("invalid_entry");
  const { error } = await app("audit_events").upsert({
    id: text(e.id, 160) || newId("a"), occurred_at: e.ts && !isNaN(Date.parse(e.ts)) ? e.ts : nowIso(),
    actor_role: s.role, device_id: s.deviceId, action, entity_type: type, entity_name: text(e.name),
    payload: { by: text(e.by, 120), fields: Array.isArray(e.fields) ? e.fields.slice(0, 20) : [], ...(e.unassigned ? { unassigned: Number(e.unassigned) } : {}) },
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
    const b = M === "GET" || M === "OPTIONS" ? {} : await readBody(req);
    let m: RegExpMatchArray | null;

    if (M === "GET" && path === "bootstrap") return json(await bootstrap(s));
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
    if ((m = path.match(/^(suppliers|items|units)\/([^/]{1,120})$/))) {
      if (!admin) return fail("forbidden", 403);
      const table = m[1], id = decodeURIComponent(m[2]);
      if (M === "DELETE") {
        const { error } = await app(table).delete().eq("id", id);
        return error ? fail("delete_failed", 500) : ok();
      }
      if (M === "PUT") {
        const row = CATALOG[table](id, b);
        if (!row) return fail("invalid_input");
        const { error } = await app(table).upsert(row);
        return error ? fail("save_failed", 500) : ok();
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
    if (M === "GET" && path === "assistant/status") return json(await assistantStatus(db));

    // Push notifications
    if (path === "push/subscription") {
      const endpoint = text(b.endpoint, 1000);
      if (!/^https:\/\//.test(endpoint)) return fail("invalid_endpoint");
      if (M === "DELETE") { await app("push_subscriptions").delete().eq("endpoint", endpoint); return ok(); }
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
      await app("push_subscriptions").update({ lang: b.lang === "ku" ? "ku" : "en", updated_at: nowIso() }).eq("endpoint", text(b.endpoint, 1000));
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
      const { error } = await db.rpc("app_internal_set_pins", { p_admin_pin: text(b.adminPin, 6), p_staff_pin: text(b.staffPin, 6) });
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
    console.error(path, e);
    return fail("server_error", 500);
  }
});
