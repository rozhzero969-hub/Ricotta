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
//   PUT    receipts-settings   {autoApprove, stopped, limits} (rozha)
// Routes for Rico on the Mac (header x-helper-token, the RICO_HELPER_TOKEN secret):
//   POST   helper/heartbeat    {version, signedIn}   still here; answers the switches
//   POST   helper/recover                            Rico started: what he left half way is sorted out
//   PUT    helper/catalog      {suppliers, zones, items}
//   POST   helper/claim                              the next receipt to work on, or none
//   GET    helper/receipts/:id                       one receipt (Rico waits on it for the approval)
//   POST   helper/receipts/:id/report {status, log, problem, finance, totals}
//   POST   helper/receipts/:id/photo  {kind, image (base64 JPEG)}
import "../_shared/receipts.js";
const R = (globalThis as any).RicottaReceipts;

type Ctx = {
  db: any; json: (b: unknown, s?: number) => Response; fail: (e: string, s?: number) => Response;
  account: "rozha" | "yunis" | null; rozha: boolean;
};
const BUCKET = "receipt-photos";
const PHOTO_KINDS = ["before", "after", "invoices", "problem"];
const t = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const now = () => new Date().toISOString();
const rr = (db: any, table: string) => db.from(`app_rr_${table}`);

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
    id: r.id, by: r.created_by, source: r.source, status: r.status, supplier: r.supplier, invoice: r.invoice, zone: r.zone,
    currency: r.currency, rate: r.rate == null ? null : Number(r.rate), delivery: r.delivery == null ? null : Number(r.delivery),
    lines: r.lines ?? [], total: r.total == null ? null : Number(r.total), warnings: r.warnings ?? [], problem: r.problem,
    finance: r.finance, photos: (r.photos ?? []).map((p: any) => ({ kind: p.kind, at: p.at })), log: withLog ? r.log ?? [] : undefined,
    approvedBy: r.approved_by, approvedAt: r.approved_at, sentAt: r.sent_at, savedAt: r.saved_at, version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export function helperView(h: any) {
  const seen = h.last_seen ? Date.parse(h.last_seen) : 0;
  return { online: !!seen && Date.now() - seen < 90_000, lastSeen: h.last_seen ?? null, signedIn: !!h.signed_in, busyWith: h.busy_with ?? null,
    autoApprove: !!h.auto_approve, stopped: !!h.stopped, limits: limitsOf(h), version: h.version ?? null };
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
const logEntry = (text: string, who = "rico") => ({ at: now(), who, text: t(text, 300) });


/* ---------- What a person does to a receipt (the app and Telegram share these) ---------- */
type Done = { row?: any; error?: string; status?: number; extra?: Record<string, unknown> };
const nameOf = (who: string) => who === "rozha" ? "Rozha" : who === "yunis" ? "Yunis" : who;
/* Anything about a receipt that someone should hear about on Telegram (see telegram.ts). */
let notify: (db: any, r: any, event: string) => Promise<void> = async () => {};
export function onReceiptEvent(fn: typeof notify) { notify = fn; }
async function tell(db: any, r: any, event: string) { try { await notify(db, r, event); } catch (e) { console.error("telegram notify", event, e); } }

export async function sendReceipt(db: any, r: any, who: string, confirm: unknown, source?: string): Promise<Done> {
  if (!["draft", "problem"].includes(r.status)) return { error: "already_sent" };
  if (r.status === "draft" && r.created_by !== who) return { error: "forbidden", status: 403 };
  const [h, catalog, last] = await Promise.all([helperRow(db), catalogOf(db), lastPrices(db)]);
  const c = R.check(view(r), catalog, limitsOf(h), last);
  if (c.errors.length) return { error: "invalid_receipt", status: 422, extra: { errors: c.errors } };
  // Every warning must have been seen and confirmed before Rico gets the receipt.
  const confirmed = new Set(Array.isArray(confirm) ? confirm.map((x: unknown) => t(x, 40)) : []);
  if (c.warnings.some((w: any) => !confirmed.has(w.code))) return { error: "needs_confirmation", extra: { warnings: c.warnings } };
  const { data: sent, error } = await rr(db, "receipts").update({
    status: "queued", total: c.total, warnings: c.warnings, problem: null, sent_at: now(), version: r.version + 1, updated_at: now(),
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
  if (M === "PUT" && path === "receipts-settings") {
    if (!ctx.rozha) return fail("forbidden", 403);
    const patch: Record<string, unknown> = {};
    if (typeof b.autoApprove === "boolean") patch.auto_approve = b.autoApprove;
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
const HELPER_NEXT: Record<string, string[]> = { filling: ["review", "problem"], approved: ["saved", "problem"], saving: ["saved", "problem"], cancelled: ["cancelled"], review: ["problem"] };

export async function helperRoute(ctx: Ctx, M: string, path: string, b: any): Promise<Response> {
  const { db, json, fail } = ctx;
  let m: RegExpMatchArray | null;
  if (M === "POST" && path === "helper/heartbeat") {
    const h = await helperRow(db);
    const patch: Record<string, unknown> = { last_seen: now(), signed_in: b.signedIn === true, version: t(b.version, 40) || null };
    if (b.idle === true) patch.busy_with = null;
    await rr(db, "helper").update(patch).eq("id", true);
    await cleanOldPhotos(db, h);
    return json(helperView({ ...h, ...patch }));
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
    await rr(db, "helper").update({ busy_with: null }).eq("id", true);
    return json({ ok: true, recovered: (stuck ?? []).length });
  }
  if (M === "PUT" && path === "helper/catalog") {
    const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length && x.length <= 200).slice(0, n) : []);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 2000).map((i: any) => ({
      name: t(i?.name, 200), base: t(i?.base, 40),
      units: (Array.isArray(i?.units) ? i.units : []).slice(0, 20).map((u: any) => ({ name: t(u?.name, 40), factor: Number(u?.factor) })).filter((u: any) => u.name && Number.isFinite(u.factor) && u.factor > 0),
    })).filter((i: any) => i.name && i.base);
    const data = { suppliers: strings(b.suppliers, 500), zones: strings(b.zones, 50), items };
    if (!data.suppliers.length || !data.zones.length || !items.length) return fail("invalid_catalog");
    const { error } = await rr(db, "catalog").upsert({ id: true, data, updated_at: now() });
    return error ? fail("save_failed", 503) : json({ ok: true, items: items.length });
  }
  if (M === "POST" && path === "helper/claim") {
    const { data, error } = await db.rpc("app_internal_rr_claim");
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    return json({ receipt: r ? view(r) : null, helper: helperView(await helperRow(db)) });
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
      if (to && to !== r.status) {
        if (!(HELPER_NEXT[r.status] ?? []).includes(to)) return fail("bad_status", 409);
        patch.status = to;
        if (to === "problem") patch.problem = t(b.problem || "Rico stopped. See his notes.", 500);
        if (to === "saved") { patch.saved_at = now(); patch.finance = b.finance && typeof b.finance === "object" ? { tab: t(b.finance.tab, 80), month: t(b.finance.month, 7), no: Number.isSafeInteger(b.finance.no) ? b.finance.no : null } : null; }
        // "Rico saves by himself": a receipt filled in with nothing unusual is approved at once.
        // One Rico drafted from a chat message (source "rico") always waits for a person.
        if (to === "review") {
          const h = await helperRow(db);
          if (h.auto_approve && r.source !== "rico" && !(r.warnings ?? []).length) {
            Object.assign(patch, { status: "approved", approved_by: "auto", approved_at: now() });
            patch.log = [...log, logEntry("Approved by himself (Rico saves by himself is on)")];
          }
        }
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
  const keep = new Set(((await rr(db, "receipts").select("id")).data ?? []).map((r: any) => r.id));
  const gone = (folders ?? []).map((f: any) => f.name).filter((n: string) => /^[0-9a-f-]{36}$/.test(n) && !keep.has(n));
  for (const folder of gone.slice(0, 50)) {
    const { data: files } = await db.storage.from(BUCKET).list(folder, { limit: 100 });
    const paths = (files ?? []).map((f: any) => `${folder}/${f.name}`);
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
  }
}
