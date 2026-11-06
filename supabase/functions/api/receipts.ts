// Receipts for Ricotta Restaurant, entered there by Rico on Rozha's Mac (helper/).
//
// The app writes a receipt here (a draft, then "send"); Rico on the Mac takes it, fills in Ricotta
// Restaurant's New receipt page, photographs it and stops before saving. Someone approves the photo
// (or, with "Rico saves by himself" on, it is approved at once when nothing about it is unusual), Rico
// presses "Receive & send to finance", finds it in Invoices and reports the finance number back.
//
// Routes, with a session (Receipts is Rozha's, and Yunis's when given in Admin > Access):
//   GET    receipts                                  receipts of the last 60 days, the lists, Rico's state
//   PUT    receipts/:id        {draft fields}        create or change a draft
//   DELETE receipts/:id                              delete a draft
//   POST   receipts/:id/send   {confirm:[codes]}     check it and give it to Rico
//   POST   receipts/:id/approve                      the photo is right: Rico may save it
//   POST   receipts/:id/cancel                       stop it (Rico discards what he filled in)
//   GET    receipts/:id/photos                       short-lived links to its photos
//   PUT    receipts-settings   {stopped, limits} (rozha)
// Routes for Rico on the Mac (header x-helper-token, the RICO_HELPER_TOKEN secret):
//   POST   helper/heartbeat    {version, signedIn}   still here; answers the switches
//   POST   helper/recover                            Rico started: what he left half way is sorted out
//   POST   helper/launcher     {running, result}     the launcher on the Mac; answers {command}
//   POST   receipts-settings/rico {action}           (session, rozha) start Rico (real | practice) or stop him
//   PUT    helper/catalog      {suppliers, zones, items}
//   POST   helper/claim       {wait, mode}          the next receipt to work on; waits up to {wait} s for one
// Waiting on the server (instead of asking every few seconds) is what makes Rico start, stop and take
// a new receipt within a second or two.
//   GET    helper/receipts/:id                       one receipt
//   POST   helper/receipts/:id/wait {wait}           answers as soon as the receipt is no longer waiting for approval
//   POST   helper/shot/wait   {wait}                answers as soon as someone asks for a live screenshot
//   POST   helper/shot        {chat, image}         the screenshot, sent to whoever asked
//   GET    receipts-activity                         (session) what Rico did, newest first (the Record tab)
//   POST   helper/receipts/:id/report {status, log, problem, finance, totals}
//   POST   helper/receipts/:id/photo  {kind, image (base64 JPEG)}
import "../_shared/receipts.js";
import { claimTransfer, transferHelperRoute, tview } from "./transfers.ts";
const R = (globalThis as any).RicottaReceipts;

type Ctx = {
  db: any; json: (b: unknown, s?: number) => Response; fail: (e: string, s?: number) => Response;
  account: "rozha" | "yunis" | null; rozha: boolean;
};
export const BUCKET = "receipt-photos";
const PHOTO_KINDS = ["before", "after", "invoices", "problem"];
const t = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const now = () => new Date().toISOString();
const rr = (db: any, table: string) => db.from(`app_rr_${table}`);
const LAUNCHER_FRESH = 45_000;   // the launcher waits up to 20 s on the server, then asks again
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const waitFor = (v: unknown) => Math.max(0, Math.min(20, Number(v) || 0)) * 1000;
/* Asks again every ~0.7 s until there is an answer or the time is up. */
export async function poll<T>(ms: number, fn: () => Promise<T | null>): Promise<T | null> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() >= until) return v;
    await pause(700);
  }
}

async function sha(v: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/* Rico's door: the token is compared as a hash, so its length or first letters never leak. */
export async function helperAllowed(req: Request) {
  const want = Deno.env.get("RICO_HELPER_TOKEN") ?? "";
  const got = req.headers.get("x-helper-token") ?? "";
  if (want.length < 32 || !got || got.length > 200) return false;
  return (await sha(got)) === (await sha(want));
}

export async function helperRow(db: any) {
  const { data, error } = await rr(db, "helper").select("*").eq("id", true).maybeSingle();
  if (error) throw error;
  return data ?? {};
}
export const limitsOf = (h: any) => ({ bigTotal: Number(h.big_total) || 1000000, priceJump: Number(h.price_jump) || 30, rateMin: Number(h.rate_min) || 1500, rateMax: Number(h.rate_max) || 1800 });
export async function catalogOf(db: any) {
  const { data, error } = await rr(db, "catalog").select("data,updated_at").eq("id", true).maybeSingle();
  if (error) throw error;
  return data ? { ...data.data, at: data.updated_at } : { suppliers: [], zones: [], items: [], at: null };
}
/* The last price paid per item, unit and currency, from saved receipts (newest first). */
export async function lastPrices(db: any) {
  const { data, error } = await rr(db, "receipts").select("currency,lines,saved_at").eq("status", "saved").order("saved_at", { ascending: false }).limit(400);
  if (error) throw error;
  const last: Record<string, number> = {};
  for (const r of data ?? []) for (const l of r.lines ?? []) { const k = `${l.item}|${l.unit}|${r.currency}`; if (!(k in last)) last[k] = l.cost; }
  return last;
}
export function view(r: any, withLog = true) {
  return {
    id: r.id, by: r.created_by, source: r.source, mode: r.mode ?? null, status: r.status, supplier: r.supplier, invoice: r.invoice, zone: r.zone,
    currency: r.currency, rate: r.rate == null ? null : Number(r.rate), delivery: r.delivery == null ? null : Number(r.delivery),
    lines: r.lines ?? [], total: r.total == null ? null : Number(r.total), warnings: r.warnings ?? [], problem: r.problem,
    finance: r.finance, photos: (r.photos ?? []).map((p: any) => ({ kind: p.kind, at: p.at })), log: withLog ? r.log ?? [] : undefined,
    approvedBy: r.approved_by, approvedAt: r.approved_at, sentAt: r.sent_at, savedAt: r.saved_at, pressedAt: r.pressed_at ?? null, version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export function helperView(h: any) {
  const seen = h.last_seen ? Date.parse(h.last_seen) : 0;
  const ls = h.launcher_seen ? Date.parse(h.launcher_seen) : 0;
  return { online: !!seen && Date.now() - seen < 90_000, lastSeen: h.last_seen ?? null, signedIn: !!h.signed_in, busyWith: h.busy_with ?? null,
    stopped: !!h.stopped, limits: limitsOf(h), version: h.version ?? null, mode: h.mode ?? null,
    launcher: { online: !!ls && Date.now() - ls < LAUNCHER_FRESH, command: h.command ?? null, result: h.launch_result ?? null, at: h.launch_at ?? null } };
}
/* Only these draft fields, in these shapes, are kept. */
function cleanDraft(b: any) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, R.MAX_LINES).map((l: any) => ({
    item: t(l?.item, 200), unit: t(l?.unit, 80),
    qty: typeof l?.qty === "number" && Number.isFinite(l.qty) ? l.qty : null,
    cost: typeof l?.cost === "number" && Number.isFinite(l.cost) ? l.cost : null,
  }));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    supplier: b.supplier ? t(b.supplier, 200) : null,
    invoice: /^[0-9]{1,30}$/.test(String(b.invoice ?? "")) ? String(b.invoice) : null,
    zone: t(b.zone || "Main Storage", 80) || "Main Storage",
    currency: b.currency === "USD" ? "USD" : "IQD",
    rate: b.currency === "USD" ? num(b.rate) : null,
    delivery: b.currency === "USD" ? null : Number.isSafeInteger(b.delivery) && b.delivery >= 0 ? b.delivery : null,
    lines,
  };
}
export const logEntry = (text: string, who = "rico") => ({ at: now(), who, text: t(text, 300) });


/* ---------- What a person does to a receipt (the app and Telegram share these) ---------- */
type Done = { row?: any; error?: string; status?: number; extra?: Record<string, unknown> };
export const nameOf = (who: string) => who === "rozha" ? "Rozha" : who === "yunis" ? "Yunis" : who;
/* Anything about a receipt that someone should hear about on Telegram (see telegram.ts). */
let notify: (db: any, r: any, event: string) => Promise<void> = async () => {};
export function onReceiptEvent(fn: typeof notify) { notify = fn; }
/* Rico started, stopped or could not start (from the launcher on the Mac). */
let launchNotify: (db: any, text: string) => Promise<void> = async () => {};
export function onLaunchEvent(fn: typeof launchNotify) { launchNotify = fn; }
/* A live screenshot Rico took because someone asked for it on Telegram. */
let shotNotify: (db: any, chat: number, url: string, caption: string) => Promise<void> = async () => {};
export function onShot(fn: typeof shotNotify) { shotNotify = fn; }
/* Asks Rico for a live screenshot of what he has on the screen; it goes to this chat. */
export async function requestShot(db: any, chat: number) {
  const h = helperView(await helperRow(db));
  if (!h.online) return { error: "rico_off" };
  await rr(db, "helper").update({ shot_want: now(), shot_chat: chat }).eq("id", true);
  return { ok: true };
}
/* What Rico did lately (newest first): receipt steps, Start / Stop presses and how they went. */
export async function ricoEvents(db: any, limit = 300) {
  const { data, error } = await rr(db, "events").select("*").order("at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((e: any) => ({ id: e.id, at: e.at, what: e.what ?? "receipt", kind: e.kind, status: e.status, receipt: e.receipt_id, supplier: e.supplier, invoice: e.invoice, source: e.source, mode: e.mode, by: e.actor, text: e.text }));
}
/* Start Rico for real, in practice mode, or stop him: the launcher on the Mac picks this up. */
export async function ricoCommand(db: any, action: string, by: string) {
  if (!["real", "practice", "stop"].includes(action)) return { error: "invalid_input" };
  const h = await helperRow(db);
  const ls = h.launcher_seen ? Date.parse(h.launcher_seen) : 0;
  if (!ls || Date.now() - ls > LAUNCHER_FRESH) return { error: "launcher_off", helper: helperView(h) };
  await rr(db, "helper").update({ command: action, command_by: by, command_at: now(), launch_result: null }).eq("id", true);
  return { helper: helperView(await helperRow(db)) };
}
async function tell(db: any, r: any, event: string) { try { await notify(db, r, event); } catch (e) { console.error("telegram notify", event, e); } }

export async function sendReceipt(db: any, r: any, who: string, confirm: unknown, source?: string): Promise<Done> {
  if (!["draft", "problem"].includes(r.status)) return { error: "already_sent" };
  if (r.status === "draft" && r.created_by !== who) return { error: "forbidden", status: 403 };
  const [h, catalog, last] = await Promise.all([helperRow(db), catalogOf(db), lastPrices(db)]);
  const c = R.check(view(r), catalog, limitsOf(h), last);
  if (c.errors.length) return { error: "invalid_receipt", status: 422, extra: { errors: c.errors } };
  // Every warning must have been seen and confirmed before Rico gets the receipt.
  const confirmed = new Set(Array.isArray(confirm) ? confirm.map((x: unknown) => t(x, 40)) : []);
  // Never saved twice: this receipt, or another with the same supplier and invoice, that stopped after
  // Rico pressed Save is sent again only after the person has checked Ricotta Restaurant.
  const warnings = [...c.warnings];
  let pressed = r.pressed_at;
  if (!pressed && r.invoice) {
    const { data: o } = await rr(db, "receipts").select("pressed_at").eq("supplier", r.supplier).eq("invoice", r.invoice).neq("id", r.id).eq("status", "problem").not("pressed_at", "is", null).limit(1);
    pressed = o?.[0]?.pressed_at ?? null;
  }
  if (pressed) warnings.push({ code: "pressed", at: pressed });
  if (warnings.some((w: any) => !confirmed.has(w.code))) return { error: "needs_confirmation", extra: { warnings } };
  const { data: sent, error } = await rr(db, "receipts").update({
    status: "queued", total: c.total, warnings, problem: null, pressed_at: null, sent_at: now(), version: r.version + 1, updated_at: now(),
    ...(source ? { source } : {}),
    log: [...(r.log ?? []), logEntry(`Sent to Rico by ${nameOf(who)}${source === "telegram" ? " on Telegram" : ""}`, who)],
  }).eq("id", r.id).eq("version", r.version).select("*").maybeSingle();
  if (error?.code === "23505") return { error: "invoice_already_sent" };
  if (error || !sent) return { error: error ? "send_failed" : "changed_elsewhere", status: error ? 503 : 409 };
  await tell(db, sent, "queued");
  return { row: sent };
}
export async function approveReceipt(db: any, r: any, who: string): Promise<Done> {
  if (r.status !== "review") return { error: "not_waiting" };
  const { data, error } = await rr(db, "receipts").update({
    status: "approved", approved_by: who, approved_at: now(), version: r.version + 1, updated_at: now(),
    log: [...(r.log ?? []), logEntry(`Approved by ${nameOf(who)}`, who)],
  }).eq("id", r.id).eq("version", r.version).select("*").maybeSingle();
  return error || !data ? { error: "changed_elsewhere" } : { row: data };
}
export async function cancelReceipt(db: any, r: any, who: string): Promise<Done> {
  // Once Rico has pressed save it can't be taken back here: Ricotta Restaurant has it.
  if (!["draft", "queued", "filling", "review", "problem"].includes(r.status)) return { error: "too_late" };
  const { data, error } = await rr(db, "receipts").update({
    status: "cancelled", version: r.version + 1, updated_at: now(),
    log: [...(r.log ?? []), logEntry(`Cancelled by ${nameOf(who)}`, who)],
  }).eq("id", r.id).eq("version", r.version).select("*").maybeSingle();
  return error || !data ? { error: "changed_elsewhere" } : { row: data };
}
export async function photoLinks(db: any, r: any, kinds?: string[]) {
  const out = [];
  for (const p of r.photos ?? []) {
    if (kinds && !kinds.includes(p.kind)) continue;
    const { data: s } = await db.storage.from(BUCKET).createSignedUrl(p.path, 3600);
    if (s?.signedUrl) out.push({ kind: p.kind, at: p.at, url: s.signedUrl });
  }
  return out;
}

export async function receiptsRoute(ctx: Ctx, M: string, path: string, b: any): Promise<Response | null> {
  const { db, json, fail } = ctx;
  let m: RegExpMatchArray | null;
  if (M === "GET" && path === "receipts") {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const [{ data, error }, h, catalog, last] = await Promise.all([
      rr(db, "receipts").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      helperRow(db), catalogOf(db), lastPrices(db),
    ]);
    if (error) throw error;
    return json({ receipts: (data ?? []).filter((r: any) => r.status !== "draft" || r.created_by === ctx.account).map((r: any) => view(r)), catalog, helper: helperView(h), last });
  }
  if (M === "GET" && path === "receipts-activity") return json({ events: await ricoEvents(db) });
  if (M === "POST" && path === "receipts-settings/rico") {
    if (!ctx.rozha) return fail("forbidden", 403);
    const r = await ricoCommand(db, t(b.action, 20), ctx.account ?? "rozha");
    return r.error ? json({ error: r.error, helper: r.helper }, r.error === "launcher_off" ? 409 : 400) : json(r.helper);
  }
  if (M === "PUT" && path === "receipts-settings") {
    if (!ctx.rozha) return fail("forbidden", 403);
    const patch: Record<string, unknown> = {};
    if (typeof b.stopped === "boolean") patch.stopped = b.stopped;
    const l = b.limits ?? {};
    if (Number.isSafeInteger(l.bigTotal) && l.bigTotal > 0) patch.big_total = l.bigTotal;
    if (Number.isSafeInteger(l.priceJump) && l.priceJump >= 1 && l.priceJump <= 500) patch.price_jump = l.priceJump;
    if (Number.isSafeInteger(l.rateMin) && Number.isSafeInteger(l.rateMax) && l.rateMin > 0 && l.rateMax >= l.rateMin) { patch.rate_min = l.rateMin; patch.rate_max = l.rateMax; }
    if (!Object.keys(patch).length) return fail("invalid_input");
    const { error } = await rr(db, "helper").update(patch).eq("id", true);
    return error ? fail("save_failed", 503) : json(helperView(await helperRow(db)));
  }
  if ((m = path.match(/^receipts\/([0-9a-f-]{36})(?:\/(send|approve|cancel|photos))?$/))) {
    const id = m[1], action = m[2] ?? null;
    const { data: r, error } = await rr(db, "receipts").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (M === "PUT" && !action) {
      if (r && (r.status !== "draft" || r.created_by !== ctx.account)) return fail("not_a_draft", 409);
      const row = { id, created_by: ctx.account, ...cleanDraft(b), updated_at: now() };
      const q = r ? rr(db, "receipts").update({ ...row, version: r.version + 1 }).eq("id", id).eq("version", r.version) : rr(db, "receipts").insert({ ...row, status: "draft" });
      const { data: saved, error: e2 } = await q.select("*").maybeSingle();
      if (e2 || !saved) return fail(e2 ? "save_failed" : "changed_elsewhere", e2 ? 503 : 409);
      return json(view(saved));
    }
    if (!r) return fail("not_found", 404);
    if (M === "DELETE" && !action) {
      if (r.status !== "draft" || r.created_by !== ctx.account) return fail("not_a_draft", 409);
      const { error: e2 } = await rr(db, "receipts").delete().eq("id", id).eq("status", "draft");
      return e2 ? fail("delete_failed", 503) : json({ ok: true });
    }
    if (M === "GET" && action === "photos") return json({ photos: await photoLinks(db, r) });
    if (M !== "POST" || !action) return fail("not_found", 404);
    const who = ctx.account ?? "rozha";
    const res = action === "send" ? await sendReceipt(db, r, who, b.confirm)
      : action === "approve" ? await approveReceipt(db, r, who)
      : action === "cancel" ? await cancelReceipt(db, r, who) : null;
    if (!res) return fail("not_found", 404);
    return res.error ? json({ error: res.error, ...(res.extra ?? {}) }, res.status ?? 409) : json(view(res.row));
  }
  return null;
}

/* ---------- Rico on the Mac ---------- */
const HELPER_NEXT: Record<string, string[]> = { filling: ["review", "problem"], approved: ["saving", "saved", "problem"], saving: ["saved", "problem"], cancelled: ["cancelled"], review: ["problem"] };

export async function helperRoute(ctx: Ctx, M: string, path: string, b: any): Promise<Response> {
  const { db, json, fail } = ctx;
  let m: RegExpMatchArray | null;
  if (M === "POST" && path === "helper/heartbeat") {
    const h = await helperRow(db);
    const patch: Record<string, unknown> = { last_seen: now(), signed_in: b.signedIn === true, version: t(b.version, 40) || null, mode: b.mode === "practice" ? "practice" : "real" };
    if (b.idle === true) patch.busy_with = null;
    await rr(db, "helper").update(patch).eq("id", true);
    await cleanOldPhotos(db, h);
    return json(helperView({ ...h, ...patch }));
  }
  // The launcher on the Mac checks in every few seconds: whether Rico is running and in which mode, and
  // how the last start or stop went. It gets the command waiting for it, once.
  if (M === "POST" && path === "helper/launcher") {
    const h = await helperRow(db);
    const patch: Record<string, unknown> = { launcher_seen: now() };
    if (b.running === false && h.mode) { patch.mode = null; patch.last_seen = null; patch.signed_in = false; }
    if (typeof b.result === "string" && b.result) { patch.launch_result = t(b.result, 400); patch.launch_at = now(); }
    await rr(db, "helper").update(patch).eq("id", true);
    if (patch.launch_result) { try { await launchNotify(db, String(patch.launch_result)); } catch (e) { console.error("launch notify", e); } }
    if (b.take === false) return json({ command: null });
    // The command is taken once: only the request that clears it gets it.
    const command = await poll(waitFor(b.wait), async () => {
      const { data } = await rr(db, "helper").select("command").eq("id", true).maybeSingle();
      if (!data?.command) return null;
      const { data: took } = await rr(db, "helper").update({ command: null, command_by: null, launcher_seen: now() }).eq("id", true).eq("command", data.command).select("id");
      return took?.length ? String(data.command) : null;
    });
    if (!command && b.wait) await rr(db, "helper").update({ launcher_seen: now() }).eq("id", true);
    return json({ command });
  }
  if (M === "POST" && path === "helper/shot/wait") {
    const want = await poll(waitFor(b.wait), async () => {
      const { data } = await rr(db, "helper").select("shot_want,shot_chat").eq("id", true).maybeSingle();
      if (!data?.shot_want) return null;
      const { data: took } = await rr(db, "helper").update({ shot_want: null }).eq("id", true).eq("shot_want", data.shot_want).select("id");
      return took?.length ? { chat: data.shot_chat } : null;
    });
    return json(want ? { want: true, chat: want.chat } : { want: false });
  }
  if (M === "POST" && path === "helper/shot") {
    const chat = Number(b.chat);
    const bytes = typeof b.image === "string" && b.image.length < 4_200_000 ? Uint8Array.from(atob(b.image), (c) => c.charCodeAt(0)) : null;
    if (!Number.isSafeInteger(chat) || !bytes || !(bytes[0] === 0xff && bytes[1] === 0xd8)) return fail("invalid_photo");
    const p = `shots/${Date.now()}.jpg`;
    const { error: up } = await db.storage.from(BUCKET).upload(p, bytes, { contentType: "image/jpeg", upsert: false });
    if (up) return fail("upload_failed", 503);
    const { data: s } = await db.storage.from(BUCKET).createSignedUrl(p, 3600);
    try { await shotNotify(db, chat, s?.signedUrl ?? "", t(b.caption, 300)); } catch (e) { console.error("shot notify", e); }
    return json({ ok: true });
  }
  // Rico just started: a receipt he was filling in when he stopped goes back in line (nothing was saved
  // yet); one he was saving is shown as a problem, because Ricotta Restaurant may already have it.
  if (M === "POST" && path === "helper/recover") {
    const { data: stuck, error } = await rr(db, "receipts").select("*").in("status", ["filling", "saving"]);
    if (error) throw error;
    for (const r of stuck ?? []) {
      const filling = r.status === "filling";
      await rr(db, "receipts").update({
        status: filling ? "queued" : "problem", version: r.version + 1, updated_at: now(),
        problem: filling ? null : "Rico was restarted while saving this. Check Invoices in Ricotta Restaurant before sending it again.",
        log: [...(r.log ?? []), logEntry(filling ? "Rico was restarted while filling this in. Trying again." : "Rico was restarted while saving this.")],
      }).eq("id", r.id).eq("version", r.version);
    }
    // Transfers the same way: one being filled in goes back in line; one being moved is a problem,
    // because Ricotta Restaurant may already have moved it.
    const { data: tstuck } = await db.from("app_rr_transfers").select("*").in("status", ["filling", "moving"]);
    for (const r of tstuck ?? []) {
      const filling = r.status === "filling";
      await db.from("app_rr_transfers").update({
        status: filling ? "queued" : "problem", version: r.version + 1, updated_at: now(),
        problem: filling ? null : "Rico was restarted while moving this. Check Recent transfers in Ricotta Restaurant before sending it again.",
        log: [...(r.log ?? []), logEntry(filling ? "Rico was restarted while filling this in. Trying again." : "Rico was restarted while moving this.")],
      }).eq("id", r.id).eq("version", r.version);
    }
    await rr(db, "helper").update({ busy_with: null }).eq("id", true);
    return json({ ok: true, recovered: (stuck ?? []).length + (tstuck ?? []).length });
  }
  if (M === "PUT" && path === "helper/catalog") {
    const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length && x.length <= 200).slice(0, n) : []);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 2000).map((i: any) => ({
      name: t(i?.name, 200), base: t(i?.base, 40),
      units: (Array.isArray(i?.units) ? i.units : []).slice(0, 20).map((u: any) => ({ name: t(u?.name, 40), factor: Number(u?.factor) })).filter((u: any) => u.name && Number.isFinite(u.factor) && u.factor > 0),
    })).filter((i: any) => i.name && i.base);
    // Everything that can be moved between storages: each item's counting, base and buying units and
    // its stock in each storage (base units), exactly as Ricotta Restaurant has it.
    const unit = (u: any) => (u && t(u.name, 40) && Number(u.factor) > 0 ? { name: t(u.name, 40), factor: Number(u.factor) } : null);
    const titems = (Array.isArray(b.titems) ? b.titems : []).slice(0, 3000).map((i: any) => ({
      name: t(i?.name, 200), base: t(i?.base, 40), count: unit(i?.count), buy: unit(i?.buy),
      stock: Object.fromEntries(Object.entries(i?.stock && typeof i.stock === "object" ? i.stock : {}).slice(0, 40)
        .map(([z, q]) => [t(z, 80), Number(q)]).filter(([z, q]) => z && Number.isFinite(q as number))),
    })).filter((i: any) => i.name && i.base);
    // What usually happens (Rico reads Ricotta Restaurant's stock record of the last weeks once a day):
    // per item the number of moves or deliveries, the usual and the largest amount (base units), and
    // for moves how often each route ("Main Storage>Appetizers") was used.
    const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    const stat = (v: any) => ({ n: Math.min(99999, Math.floor(num(v?.n))), q: num(v?.q), hi: num(v?.hi) || num(v?.q) });
    const hb = b.history && typeof b.history === "object" ? b.history : null;
    const history = hb ? {
      at: t(hb.at, 40), days: Math.floor(num(hb.days)),
      t: Object.fromEntries(Object.entries(hb.t && typeof hb.t === "object" ? hb.t : {}).slice(0, 3000).map(([k, v]: [string, any]): [string, any] => [t(k, 200), {
        ...stat(v), r: Object.fromEntries(Object.entries(v?.r && typeof v.r === "object" ? v.r : {}).slice(0, 80).map(([rk, c]: [string, any]) => [t(rk, 170), typeof c === "object" ? stat(c) : { n: Math.floor(num(c)), q: 0, hi: 0 }])),
      }]).filter(([k, v]: [string, any]) => k && v.n && v.q)),
      p: Object.fromEntries(Object.entries(hb.p && typeof hb.p === "object" ? hb.p : {}).slice(0, 3000).map(([k, v]: [string, any]): [string, any] => [t(k, 200), stat(v)]).filter(([k, v]: [string, any]) => k && v.n && v.q)),
    } : ((await catalogOf(db)) as any).history ?? null;
    const data = { suppliers: strings(b.suppliers, 500), zones: strings(b.zones, 50), items, titems, history, stockAt: titems.length ? now() : null };
    if (!data.suppliers.length || !data.zones.length || !items.length) return fail("invalid_catalog");
    const { error } = await rr(db, "catalog").upsert({ id: true, data, updated_at: now() });
    return error ? fail("save_failed", 503) : json({ ok: true, items: items.length });
  }
  if (M === "POST" && path === "helper/claim") {
    const mode = b.mode === "practice" ? "practice" : b.mode === "real" ? "real" : null;
    // Receipts first, then transfers; waits up to {wait} s for either.
    const got = await poll(waitFor(b.wait), async () => {
      const { data, error } = await db.rpc("app_internal_rr_claim", { p_mode: mode });
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) ?? null;
      if (r) return { receipt: view(r) };
      if (b.transfers !== true) return null;
      const tr = await claimTransfer(db, mode);
      return tr ? { transfer: tview(tr) } : null;
    });
    return json({ receipt: null, transfer: null, ...(got ?? {}), helper: helperView(await helperRow(db)) });
  }

  if (path.startsWith("helper/transfers/")) return (await transferHelperRoute(ctx, M, path, b)) ?? fail("not_found", 404);
  if ((m = path.match(/^helper\/receipts\/([0-9a-f-]{36})\/wait$/)) && M === "POST") {
    const id = m[1];
    const r = await poll(waitFor(b.wait), async () => {
      const { data, error } = await rr(db, "receipts").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return !data || data.status !== "review" ? (data ?? { gone: true }) : null;
    });
    if (!r) { const { data } = await rr(db, "receipts").select("*").eq("id", id).maybeSingle(); return data ? json(view(data)) : fail("not_found", 404); }
    return (r as any).gone ? fail("not_found", 404) : json(view(r));
  }
  if ((m = path.match(/^helper\/receipts\/([0-9a-f-]{36})(?:\/(report|photo))?$/))) {
    const id = m[1], action = m[2] ?? null;
    const { data: r, error } = await rr(db, "receipts").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!r) return fail("not_found", 404);
    if (M === "GET" && !action) return json(view(r));
    if (M === "POST" && action === "photo") {
      const kind = PHOTO_KINDS.includes(b.kind) ? b.kind : null;
      const bytes = typeof b.image === "string" && b.image.length < 4_200_000 ? Uint8Array.from(atob(b.image), (c) => c.charCodeAt(0)) : null;
      const png = !!bytes && bytes[0] === 0x89 && bytes[1] === 0x50, jpeg = !!bytes && bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!kind || !bytes || !(png || jpeg)) return fail("invalid_photo");
      const p = `${id}/${kind}-${Date.now()}.${png ? "png" : "jpg"}`;
      const { error: up } = await db.storage.from(BUCKET).upload(p, bytes, { contentType: png ? "image/png" : "image/jpeg", upsert: false });
      if (up) return fail("upload_failed", 503);
      const { error: e2 } = await rr(db, "receipts").update({ photos: [...(r.photos ?? []), { kind, path: p, at: now() }], updated_at: now() }).eq("id", id);
      return e2 ? fail("save_failed", 503) : json({ ok: true });
    }
    if (M === "POST" && action === "report") {
      const log = [...(r.log ?? []), ...(Array.isArray(b.log) ? b.log : []).slice(0, 30).map((x: unknown) => logEntry(String(x)))].slice(-120);
      const to = typeof b.status === "string" ? b.status : null;
      const patch: Record<string, unknown> = { log, updated_at: now(), version: r.version + 1 };
      // Rico says so just before pressing Save; if this isn't saved he doesn't press.
      if (b.pressed === true) { if (!["approved", "saving"].includes(r.status)) return fail("bad_status", 409); patch.pressed_at = now(); }
      if (to && to !== r.status) {
        if (!(HELPER_NEXT[r.status] ?? []).includes(to)) return fail("bad_status", 409);
        patch.status = to;
        if (to === "problem") patch.problem = t(b.problem || "Rico stopped. See his notes.", 500);
        if (to === "saved") { patch.saved_at = now(); patch.finance = b.finance && typeof b.finance === "object" ? { tab: t(b.finance.tab, 80), month: t(b.finance.month, 7), no: Number.isSafeInteger(b.finance.no) ? b.finance.no : null } : null; }
        // A receipt Rico filled in always waits for a person to approve it (the database insists too).
      }
      if (["saved", "problem", "cancelled"].includes(String(patch.status ?? r.status))) await rr(db, "helper").update({ busy_with: null }).eq("id", true);
      const { data: u, error: e2 } = await rr(db, "receipts").update(patch).eq("id", id).eq("version", r.version).select("*").maybeSingle();
      if (e2 || !u) return fail("changed_elsewhere", 409);
      if (u.status !== r.status && ["review", "approved", "saved", "problem"].includes(u.status)) await tell(db, u, u.status);
      return json(view(u));
    }
  }
  return fail("not_found", 404);
}

/* Photos are kept 60 days, like the receipts; checked once a day when Rico checks in. */
async function cleanOldPhotos(db: any, h: any) {
  const today = new Date().toISOString().slice(0, 10);
  if (h.photos_cleaned === today) return;
  await rr(db, "helper").update({ photos_cleaned: today }).eq("id", true);
  const { data: folders } = await db.storage.from(BUCKET).list("", { limit: 1000 });
  const keep = new Set([...((await rr(db, "receipts").select("id")).data ?? []), ...((await db.from("app_rr_transfers").select("id")).data ?? [])].map((r: any) => r.id));
  const gone = (folders ?? []).map((f: any) => f.name).filter((n: string) => /^[0-9a-f-]{36}$/.test(n) && !keep.has(n));
  // Live screenshots were for that moment: gone after a day.
  const { data: shots } = await db.storage.from(BUCKET).list("shots", { limit: 1000 });
  const old = (shots ?? []).filter((f: any) => Number(f.name.split(".")[0]) < Date.now() - 86400_000).map((f: any) => `shots/${f.name}`);
  if (old.length) await db.storage.from(BUCKET).remove(old);
  for (const folder of gone.slice(0, 50)) {
    const { data: files } = await db.storage.from(BUCKET).list(folder, { limit: 100 });
    const paths = (files ?? []).map((f: any) => `${folder}/${f.name}`);
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
  }
}
