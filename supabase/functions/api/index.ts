import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-session-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SESSION_HOURS = 18;
const app = (table: string) => db.from(`app_${table}`);
const LOGIN_WINDOW_MS = 10 * 60_000;
const MAX_LOGIN_ATTEMPTS = 5;

type Session = { id: string; role: "admin" | "staff"; deviceId: string | null };
const hash = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
};
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };
const cleanText = (value: unknown, max = 160) => String(value ?? "").trim().slice(0, max);
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

async function authenticate(req: Request): Promise<Session | null> {
  const raw = req.headers.get("x-session-token") || req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw) return null;
  const { data } = await app("sessions")
    .select("id,role,device_id,expires_at,revoked_at").eq("token_hash", await hash(raw)).maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  await app("sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return { id: data.id, role: data.role, deviceId: data.device_id };
}
const requireAdmin = (session: Session) => session.role === "admin";
async function audit(session: Session, req: Request, action: string, type?: string, name?: string, payload: Record<string, unknown> = {}) {
  await app("audit_events").insert({
    id: id("audit"), actor_role: session.role, device_id: session.deviceId, action,
    entity_type: type ?? null, entity_name: name ?? null, payload,
  });
}

async function bootstrap() {
  const [suppliers, items, units, orders, devices, activity, reminder] = await Promise.all([
    app("suppliers").select("id,name,phone,reminder").order("name"),
    app("items").select("id,name,unit_id,supplier_id").order("name"),
    app("units").select("id,en,ku"),
    app("orders").select("id,status,created_at,sent_at").eq("status", "sent").order("sent_at"),
    app("devices").select("id,nickname,role,logged_in,last_login,last_seen,command,handled_command"),
    app("audit_events").select("id,occurred_at,actor_role,device_id,action,entity_type,entity_name,payload").order("occurred_at", { ascending: false }).limit(1000),
    app("reminder_settings").select("enabled,remind_time").eq("id", true).maybeSingle(),
  ]);
  const orderIds = (orders.data ?? []).map(o => o.id);
  const { data: lines } = orderIds.length ? await app("order_lines")
    .select("order_id,supplier_id,item_id,item_name,unit_id,qty").in("order_id", orderIds) : { data: [] as any[] };
  return {
    suppliers: (suppliers.data ?? []).map(s => ({ id:s.id, name:s.name, phone:s.phone, reminder:s.reminder })),
    items: (items.data ?? []).map(i => ({ id:i.id, name:i.name, unit:i.unit_id, supplierId:i.supplier_id })),
    units: units.data ?? [],
    history: (orders.data ?? []).map(o => ({ id:o.id, date:o.sent_at ?? o.created_at, entries: (lines ?? []).filter(l => l.order_id === o.id)
      .reduce((all: any[], l: any) => { let e=all.find(x=>x.supplierId===l.supplier_id); if(!e){e={supplierId:l.supplier_id,items:[]};all.push(e);} e.items.push({itemId:l.item_id,name:l.item_name,unit:l.unit_id,qty:Number(l.qty)});return all; }, []) })),
    devices: (devices.data ?? []).map(d => ({ id:d.id,nickname:d.nickname,role:d.role,loggedIn:d.logged_in,lastLogin:d.last_login,lastSeen:d.last_seen,command:d.command,handledCommand:d.handled_command })),
    activity: (activity.data ?? []).map(a => ({ id:a.id,ts:a.occurred_at,role:a.actor_role,deviceId:a.device_id,action:a.action,type:a.entity_type,name:a.entity_name,...(a.payload ?? {}) })),
    reminder: reminder.data ? { enabled:reminder.data.enabled, time:String(reminder.data.remind_time).slice(0,5) } : null,
  };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const apiIndex = segments.lastIndexOf("api");
  const path = (apiIndex >= 0 ? segments.slice(apiIndex + 1) : segments).join("/");

  if (req.method === "POST" && path === "login") {
    const payload = await body(req); const pin = cleanText(payload.pin, 6);
    const source = `${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown"}|${req.headers.get("user-agent") ?? ""}`;
    const fingerprint = await hash(source); const cutoff = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
    const { count } = await app("login_attempts").select("id", { count:"exact", head:true })
      .eq("fingerprint_hash", fingerprint).eq("succeeded", false).gte("attempted_at", cutoff);
    if ((count ?? 0) >= MAX_LOGIN_ATTEMPTS) return json({ error:"too_many_attempts" }, 429);
    const { data: role } = await db.rpc("app_internal_verify_pin", { p_pin: pin });
    const success = role === "admin" || role === "staff";
    await app("login_attempts").insert({ fingerprint_hash:fingerprint, succeeded:success });
    if (!success) return json({ error:"invalid_credentials" }, 401);
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const deviceId = cleanText(req.headers.get("x-device-id"), 120) || null;
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
    await app("sessions").insert({ token_hash:await hash(token), role, device_id:deviceId, expires_at:expiresAt });
    if (deviceId) await app("devices").upsert({ id:deviceId, role, logged_in:true, last_login:new Date().toISOString(), last_seen:new Date().toISOString() });
    return json({ token, role, expiresAt });
  }
  if (req.method === "GET" && path === "health") {
    const { error } = await app("roles").select("role", { head:true }).limit(1);
    return error ? json({ ok:false }, 503) : json({ ok:true });
  }

  const session = await authenticate(req);
  if (!session) return json({ error:"unauthorized" }, 401);
  if (req.method === "GET" && path === "bootstrap") return json(await bootstrap());
  if (req.method === "POST" && path === "logout") {
    await app("sessions").update({ revoked_at:new Date().toISOString() }).eq("id", session.id);
    if (session.deviceId) await app("devices").update({ logged_in:false }).eq("id", session.deviceId);
    return json({ ok:true });
  }
  const historyDelete = path.match(/^history\/([^/]+)$/);
  if (req.method === "DELETE" && historyDelete) {
    const orderId = cleanText(historyDelete[1], 160);
    if (!orderId) return json({ error:"invalid_order" }, 400);
    const { error } = await app("orders").delete().eq("id", orderId);
    if (error) return json({ error:"delete_failed" }, 500);
    await audit(session, req, "delete", "order", orderId);
    return json({ ok:true });
  }

  const payload = await body(req);
  const stateMatch = path.match(/^state\/(suppliers|items|units|orderHistory|devices|activityLog)$/);
  if (stateMatch) {
    const key = stateMatch[1];
    const editableByStaff = new Set(["orderHistory", "devices", "activityLog"]);
    if (!requireAdmin(session) && !editableByStaff.has(key)) return json({ error:"forbidden" }, 403);
    if (req.method === "GET") {
      const data = await bootstrap();
      const map: Record<string, unknown> = { suppliers:data.suppliers, items:data.items, units:data.units, orderHistory:data.history, devices:data.devices, activityLog:data.activity };
      return json(map[key]);
    }
    if (req.method === "PUT" && Array.isArray(payload.value)) {
      const value = payload.value;
      if (key === "suppliers") {
        await app("suppliers").delete().not("id", "in", `(${value.map((x:any)=>`\"${cleanText(x.id,120).replaceAll('"','')}\"`).join(",") || "\"__none__\""})`);
        const rows=value.filter((x:any)=>cleanText(x.id,120)&&cleanText(x.name)).map((x:any)=>({id:cleanText(x.id,120),name:cleanText(x.name),phone:cleanText(x.phone,40)||null,reminder:x.reminder??null,updated_at:new Date().toISOString()}));
        if(rows.length) await app("suppliers").upsert(rows);
      } else if (key === "units") {
        const rows=value.filter((x:any)=>cleanText(x.id,120)&&cleanText(x.en,80)).map((x:any)=>({id:cleanText(x.id,120),en:cleanText(x.en,80),ku:cleanText(x.ku,80)||null}));
        if(rows.length) await app("units").upsert(rows);
      } else if (key === "items") {
        const rows=value.filter((x:any)=>cleanText(x.id,120)&&cleanText(x.name)).map((x:any)=>({id:cleanText(x.id,120),name:cleanText(x.name),unit_id:cleanText(x.unit,120)||null,supplier_id:cleanText(x.supplierId,120)||null,updated_at:new Date().toISOString()}));
        if(rows.length) await app("items").upsert(rows);
      } else if (key === "devices") {
        const rows=value.filter((x:any)=>cleanText(x.id,120)).map((x:any)=>({id:cleanText(x.id,120),nickname:cleanText(x.nickname,120)||null,role:x.role==="admin"?"admin":"staff",logged_in:!!x.loggedIn,last_login:x.lastLogin??null,last_seen:x.lastSeen??null,command:x.command??null,handled_command:cleanText(x.handledCommand,120)||null,updated_at:new Date().toISOString()}));
        if(rows.length) await app("devices").upsert(rows);
      } else if (key === "activityLog") {
        const rows=value.slice(-1000).filter((x:any)=>cleanText(x.id,160)).map((x:any)=>({id:cleanText(x.id,160),occurred_at:x.ts??new Date().toISOString(),actor_role:x.role==="admin"?"admin":"staff",device_id:cleanText(x.deviceId,120)||null,action:cleanText(x.action,80)||"activity",entity_type:cleanText(x.type,80)||null,entity_name:cleanText(x.name,160)||null,payload:x}));
        if(rows.length) await app("audit_events").upsert(rows);
      } else if (key === "orderHistory") {
        const rows=value.filter((x:any)=>cleanText(x.id,160)).map((x:any)=>({id:cleanText(x.id,160),status:"sent",created_at:x.date??new Date().toISOString(),sent_at:x.date??new Date().toISOString(),sent_by_role:session.role}));
        if(rows.length) await app("orders").upsert(rows);
        const lines=value.flatMap((x:any)=>Array.isArray(x.entries)?x.entries.flatMap((e:any)=>Array.isArray(e.items)?e.items.map((i:any)=>({order_id:cleanText(x.id,160),supplier_id:cleanText(e.supplierId,120)||null,item_id:cleanText(i.itemId,120)||"legacy",item_name:cleanText(i.name)||cleanText(i.itemId),unit_id:cleanText(i.unit,120)||null,qty:Math.max(Number(i.qty)||0,0.0001)})):[]):[]);
        if(lines.length) await app("order_lines").upsert(lines,{onConflict:"order_id,supplier_id,item_id"});
      }
      await audit(session,req,"replace_state",key,undefined,{count:value.length}); return json({ok:true});
    }
  }
  if (path === "admin/pins" && req.method === "POST") {
    if (!requireAdmin(session)) return json({ error:"forbidden" }, 403);
    const { error } = await db.rpc("app_internal_set_pins", { p_admin_pin:cleanText(payload.adminPin,6), p_staff_pin:cleanText(payload.staffPin,6) });
    if (error) return json({ error:"invalid_pin" }, 400); await audit(session,req,"change_pins"); return json({ ok:true });
  }

  const match = path.match(/^catalog\/(suppliers|items|units)(?:\/([^/]+))?$/);
  if (match) {
    if (!requireAdmin(session)) return json({ error:"forbidden" }, 403);
    const [, entity, entityId] = match; const table = entity;
    if (req.method === "DELETE" && entityId) { await app(table).delete().eq("id", entityId); await audit(session,req,"delete",entity,entityId); return json({ok:true}); }
    if (req.method === "POST") {
      const record = entity === "suppliers" ? { id:cleanText(payload.id,120)||id("supplier"),name:cleanText(payload.name),phone:cleanText(payload.phone,40)||null,reminder:payload.reminder ?? null }
        : entity === "items" ? { id:cleanText(payload.id,120)||id("item"),name:cleanText(payload.name),unit_id:cleanText(payload.unit,120)||null,supplier_id:cleanText(payload.supplierId,120)||null,updated_at:new Date().toISOString() }
        : { id:cleanText(payload.id,120)||id("unit"),en:cleanText(payload.en,80),ku:cleanText(payload.ku,80)||null };
      if (!record.name && !record.en) return json({error:"invalid_input"},400);
      const { error } = await app(table).upsert(record); if(error) return json({error:"invalid_input"},400);
      await audit(session,req,"upsert",entity,(record as any).name ?? (record as any).en); return json({ok:true,id:record.id});
    }
  }
  return json({ error:"not_found" }, 404);
});
