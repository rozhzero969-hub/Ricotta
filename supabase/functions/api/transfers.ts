// Transfers between storages, moved in Ricotta Restaurant by Rico on Rozha's Mac (helper/), the same
// way as receipts (receipts.ts): made in the app or on Telegram, checked against the stock Rico last
// read, filled in and photographed by Rico, moved only after a person approves, then checked in
// Ricotta Restaurant's "Recent transfers".
//
// Routes, with a session (Transfers is Rozha's, and Yunis's only when given in Admin > Access):
//   GET    transfers                              transfers of the last 60 days, storages, stock, Rico's state
//   PUT    transfers/:id     {from,to,yesterday,lines}   create or change a draft
//   DELETE transfers/:id                          delete a draft
//   POST   transfers/:id/send {confirm:[codes]}   check it and give it to Rico
//   POST   transfers/:id/approve | cancel
//   GET    transfers/:id/photos
// Routes for Rico (helper token), called from receipts.ts:
//   GET    helper/transfers/:id
//   POST   helper/transfers/:id/wait {wait}       answers as soon as it is no longer waiting for approval
//   POST   helper/transfers/:id/report {status, log, problem, result}
//   POST   helper/transfers/:id/photo  {kind, image}
import "../_shared/transfers.js";
import { BUCKET, catalogOf, helperRow, helperView, logEntry, nameOf, poll, waitFor } from "./receipts.ts";
const T = (globalThis as any).RicottaTransfers;

type Ctx = { db: any; json: (b: unknown, s?: number) => Response; fail: (e: string, s?: number) => Response; account: "rozha" | "yunis" | null; rozha: boolean };
type Done = { row?: any; error?: string; status?: number; extra?: Record<string, unknown> };
const tx = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const now = () => new Date().toISOString();
const tt = (db: any) => db.from("app_rr_transfers");
const PHOTO_KINDS = ["before", "after", "problem"];
/* Today in Erbil, and the day before, as yyyy-mm-dd. */
export const erbilDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dayBefore = (day: string) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

export function tview(r: any, withLog = true) {
  return {
    id: r.id, by: r.created_by, source: r.source, mode: r.mode ?? null, status: r.status, from: r.from_zone, to: r.to_zone,
    yesterday: !!r.yesterday, forDay: r.for_day, lines: r.lines ?? [], warnings: r.warnings ?? [], problem: r.problem, result: r.result,
    photos: (r.photos ?? []).map((p: any) => ({ kind: p.kind, at: p.at })), log: withLog ? r.log ?? [] : undefined,
    approvedBy: r.approved_by, approvedAt: r.approved_at, sentAt: r.sent_at, movedAt: r.moved_at, pressedAt: r.pressed_at ?? null, version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
/* The usual amount moved per item (base units), from the moved transfers of the last 60 days. */
export async function usualAmounts(db: any) {
  const { data } = await tt(db).select("lines").eq("status", "moved").order("moved_at", { ascending: false }).limit(300);
  const cat = await catalogOf(db), items = new Map(((cat as any).titems ?? []).map((i: any) => [i.name, i]));
  const sum: Record<string, number[]> = {};
  for (const r of data ?? []) for (const l of r.lines ?? []) {
    const opt = T.unitOptions(items.get(l.item)).find((o: any) => o.name === l.unit);
    if (opt) (sum[l.item] ??= []).push(l.qty * opt.factor);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sum)) { const s = [...v].sort((a, b) => a - b); out[k] = s[Math.floor(s.length / 2)]; }
  return out;
}
const asCheck = (r: any) => ({ from: r.from_zone, to: r.to_zone, yesterday: !!r.yesterday, lines: r.lines ?? [] });
function cleanDraft(b: any) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, T.MAX_LINES).map((l: any) => ({
    item: tx(l?.item, 200), unit: tx(l?.unit, 80), qty: typeof l?.qty === "number" && Number.isFinite(l.qty) ? l.qty : null,
  }));
  const zone = (v: unknown) => { const z = tx(v, 80); return z && !/breakfast|بەیانی/i.test(z) ? z : null; };
  const from = zone(b.from), to = zone(b.to);
  return { from_zone: from, to_zone: to && to !== from ? to : null, yesterday: b.yesterday === true, lines };
}

let notifyT: (db: any, r: any, event: string) => Promise<void> = async () => {};
export function onTransferEvent(fn: typeof notifyT) { notifyT = fn; }
async function tellT(db: any, r: any, event: string) { try { await notifyT(db, r, event); } catch (e) { console.error("telegram transfer notify", event, e); } }

/* ---------- What a person does to a transfer (the app and Telegram share these) ---------- */
export async function sendTransfer(db: any, r: any, who: string, confirm: unknown, source?: string): Promise<Done> {
  if (!["draft", "problem"].includes(r.status)) return { error: "already_sent" };
  if (r.status === "draft" && r.created_by !== who) return { error: "forbidden", status: 403 };
  const [cat, usual] = await Promise.all([catalogOf(db), usualAmounts(db)]);
  const c = T.check(asCheck(r), cat, usual);
  if (c.errors.length) return { error: "invalid_transfer", status: 422, extra: { errors: c.errors } };
  const confirmed = new Set(Array.isArray(confirm) ? confirm.map((x: unknown) => tx(x, 40)) : []);
  // Never the same move twice: one Rico already pressed Move it for, or the very same transfer (same
  // storages, day and items) already on its way or moved, is sent only after the person confirms.
  const today = erbilDay(), forDay = r.yesterday ? dayBefore(today) : today;
  const warnings = [...c.warnings];
  if (r.pressed_at) warnings.push({ code: "pressed", at: r.pressed_at });
  const twin = await sameTransfer(db, r, forDay);
  if (twin) warnings.push({ code: "repeat", at: twin.moved_at ?? twin.sent_at, status: twin.status });
  if (warnings.some((w: any) => !confirmed.has(w.code))) return { error: "needs_confirmation", extra: { warnings } };
  const { data: sent, error } = await tt(db).update({
    status: "queued", warnings, problem: null, pressed_at: null, sent_at: now(), for_day: forDay,
    version: r.version + 1, updated_at: now(), ...(source ? { source } : {}),
    log: [...(r.log ?? []), logEntry(`Sent to Rico by ${nameOf(who)}${source === "telegram" ? " on Telegram" : ""}${r.yesterday ? " (record for yesterday)" : ""}`, who)],
  }).eq("id", r.id).eq("version", r.version).select("*").maybeSingle();
  if (error || !sent) return { error: error ? "send_failed" : "changed_elsewhere", status: error ? 503 : 409 };
  await tellT(db, sent, "queued");
  return { row: sent };
}
/* The same transfer sent before: same storages, same day and the same items and amounts, that is on its
   way, moved, or stopped after Rico pressed Move it. */
const sig = (lines: any[]) => (lines ?? []).map((l: any) => `${l.item}|${l.unit}|${Number(l.qty)}`).sort().join("\n");
async function sameTransfer(db: any, r: any, forDay: string) {
  const { data } = await tt(db).select("id,status,lines,sent_at,moved_at,pressed_at").eq("from_zone", r.from_zone).eq("to_zone", r.to_zone)
    .eq("for_day", forDay).neq("id", r.id).in("status", ["queued", "filling", "review", "approved", "moving", "moved", "problem"]).limit(50);
  const mine = sig(r.lines);
  return (data ?? []).find((x: any) => (x.status !== "problem" || x.pressed_at) && sig(x.lines) === mine) ?? null;
}
export async function approveTransfer(db: any, r: any, who: string): Promise<Done> {
  if (r.status !== "review") return { error: "not_waiting" };
  const { data, error } = await tt(db).update({
    status: "approved", approved_by: who, approved_at: now(), version: r.version + 1, updated_at: now(),
    log: [...(r.log ?? []), logEntry(`Approved by ${nameOf(who)}`, who)],
  }).eq("id", r.id).eq("version", r.version).select("*").maybeSingle();
  return error || !data ? { error: "changed_elsewhere" } : { row: data };
}
export async function cancelTransfer(db: any, r: any, who: string): Promise<Done> {
  // Once Rico has pressed Move it, it can't be taken back here: Ricotta Restaurant has moved it.
  if (!["draft", "queued", "filling", "review", "problem"].includes(r.status)) return { error: "too_late" };
  const { data, error } = await tt(db).update({
    status: "cancelled", version: r.version + 1, updated_at: now(), log: [...(r.log ?? []), logEntry(`Cancelled by ${nameOf(who)}`, who)],
  }).eq("id", r.id).eq("version", r.version).select("*").maybeSingle();
  return error || !data ? { error: "changed_elsewhere" } : { row: data };
}
export async function transferPhotoLinks(db: any, r: any, kinds?: string[]) {
  const out = [];
  for (const p of r.photos ?? []) {
    if (kinds && !kinds.includes(p.kind)) continue;
    const { data: s } = await db.storage.from(BUCKET).createSignedUrl(p.path, 3600);
    if (s?.signedUrl) out.push({ kind: p.kind, at: p.at, url: s.signedUrl });
  }
  return out;
}

export async function transfersRoute(ctx: Ctx, M: string, path: string, b: any): Promise<Response | null> {
  const { db, json, fail } = ctx;
  let m: RegExpMatchArray | null;
  if (M === "GET" && path === "transfers") {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const [{ data, error }, h, cat, usual] = await Promise.all([
      tt(db).select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(500), helperRow(db), catalogOf(db), usualAmounts(db),
    ]);
    if (error) throw error;
    const c = cat as any;
    return json({ transfers: (data ?? []).filter((r: any) => r.status !== "draft" || r.created_by === ctx.account).map((r: any) => tview(r)),
      catalog: { zones: T.zonesOf(c), titems: c.titems ?? [], history: (c as any).history ?? null, at: c.at }, helper: helperView(h), usual, today: erbilDay() });
  }
  if ((m = path.match(/^transfers\/([0-9a-f-]{36})(?:\/(send|approve|cancel|photos))?$/))) {
    const id = m[1], action = m[2] ?? null;
    const { data: r, error } = await tt(db).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (M === "PUT" && !action) {
      if (r && (r.status !== "draft" || r.created_by !== ctx.account)) return fail(r.status !== "draft" ? "not_a_draft" : "forbidden", r.status !== "draft" ? 409 : 403);
      const d = cleanDraft(b);
      const q = r ? tt(db).update({ ...d, version: r.version + 1, updated_at: now() }).eq("id", id).eq("version", r.version)
        : tt(db).insert({ id, created_by: ctx.account, source: "app", status: "draft", ...d });
      const { data: saved, error: e2 } = await q.select("*").maybeSingle();
      if (e2) return fail("save_failed", 503);
      return saved ? json(tview(saved)) : fail("changed_elsewhere", 409);
    }
    if (!r) return fail("not_found", 404);
    if (M === "DELETE" && !action) {
      if (r.status !== "draft" || r.created_by !== ctx.account) return fail("not_a_draft", 409);
      await tt(db).delete().eq("id", id);
      return json({ ok: true });
    }
    if (M === "GET" && action === "photos") return json({ photos: await transferPhotoLinks(db, r) });
    if (M !== "POST" || !action || action === "photos") return fail("not_found", 404);
    const who = ctx.account ?? "rozha";
    const res = action === "send" ? await sendTransfer(db, r, who, b.confirm) : action === "approve" ? await approveTransfer(db, r, who) : await cancelTransfer(db, r, who);
    return res.error ? json({ error: res.error, ...(res.extra ?? {}) }, res.status ?? 409) : json(tview(res.row));
  }
  return null;
}

/* ---------- Rico's side ---------- */
const NEXT: Record<string, string[]> = { filling: ["review", "problem"], approved: ["moving", "moved", "problem"], moving: ["moved", "problem"], cancelled: ["cancelled"], review: ["problem"] };
export async function claimTransfer(db: any, mode: string | null) {
  const { data, error } = await db.rpc("app_internal_rr_claim_transfer", { p_mode: mode });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}
export async function transferHelperRoute(ctx: Ctx, M: string, path: string, b: any): Promise<Response | null> {
  const { db, json, fail } = ctx;
  const m = path.match(/^helper\/transfers\/([0-9a-f-]{36})(?:\/(report|photo|wait))?$/);
  if (!m) return null;
  const id = m[1], action = m[2] ?? null;
  if (M === "POST" && action === "wait") {
    const r = await poll(waitFor(b.wait), async () => {
      const { data } = await tt(db).select("*").eq("id", id).maybeSingle();
      return !data || data.status !== "review" ? (data ?? { gone: true }) : null;
    });
    if (!r) { const { data } = await tt(db).select("*").eq("id", id).maybeSingle(); return data ? json(tview(data)) : fail("not_found", 404); }
    return (r as any).gone ? fail("not_found", 404) : json(tview(r));
  }
  const { data: r, error } = await tt(db).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!r) return fail("not_found", 404);
  if (M === "GET" && !action) return json(tview(r));
  if (M === "POST" && action === "photo") {
    const kind = PHOTO_KINDS.includes(b.kind) ? b.kind : null;
    const bytes = typeof b.image === "string" && b.image.length < 4_200_000 ? Uint8Array.from(atob(b.image), (c) => c.charCodeAt(0)) : null;
    const png = !!bytes && bytes[0] === 0x89 && bytes[1] === 0x50, jpeg = !!bytes && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!kind || !bytes || !(png || jpeg)) return fail("invalid_photo");
    const p = `${id}/${kind}-${Date.now()}.${png ? "png" : "jpg"}`;
    const { error: up } = await db.storage.from(BUCKET).upload(p, bytes, { contentType: png ? "image/png" : "image/jpeg", upsert: false });
    if (up) return fail("upload_failed", 503);
    const { error: e2 } = await tt(db).update({ photos: [...(r.photos ?? []), { kind, path: p, at: now() }], updated_at: now() }).eq("id", id);
    return e2 ? fail("save_failed", 503) : json({ ok: true });
  }
  if (M === "POST" && action === "report") {
    const log = [...(r.log ?? []), ...(Array.isArray(b.log) ? b.log : []).slice(0, 30).map((x: unknown) => logEntry(String(x)))].slice(-120);
    const to = typeof b.status === "string" ? b.status : null;
    const patch: Record<string, unknown> = { log, updated_at: now(), version: r.version + 1 };
    // Rico says so just before pressing Move it; if this isn't saved he doesn't press.
    if (b.pressed === true) { if (!["approved", "moving"].includes(r.status)) return fail("bad_status", 409); patch.pressed_at = now(); }
    if (to && to !== r.status) {
      if (!(NEXT[r.status] ?? []).includes(to)) return fail("bad_status", 409);
      patch.status = to;
      if (to === "problem") patch.problem = tx(b.problem || "Rico stopped. See his notes.", 500);
      if (to === "moved") { patch.moved_at = now(); patch.result = b.result && typeof b.result === "object" ? b.result : null; }
    }
    if (["moved", "problem", "cancelled"].includes(String(patch.status ?? r.status))) await db.from("app_rr_helper").update({ busy_with: null }).eq("id", true);
    const { data: u, error: e2 } = await tt(db).update(patch).eq("id", id).eq("version", r.version).select("*").maybeSingle();
    if (e2 || !u) return fail("changed_elsewhere", 409);
    if (u.status !== r.status && ["review", "moved", "problem"].includes(u.status)) await tellT(db, u, u.status);
    return json(tview(u));
  }
  return fail("not_found", 404);
}
