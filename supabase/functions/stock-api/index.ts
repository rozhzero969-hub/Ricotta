// Ricotta stock and transfers API. Stock counts, storage-to-storage transfers and the
// office PC worker's queue. Separate from the `api` function so a problem here can
// never affect ordering. It uses the same PIN sessions as `api` (app_sessions) and,
// for the PC, a separate worker token (stock_workers).
//
// Routes (JSON):
//   --- signed-in person (Rozha or Yunis) ---
//   GET    bootstrap                     storages, item settings, balances, requests, counts, groups
//   POST   groups/save | groups/delete   {id?, name, itemIds} | {id}   (Stock screen item groups)
//   GET    requests                      the light refresh: requests + balances
//   GET    shots?id=                     the PC's screenshots for one request (kept 3 days)
//   PUT    tabs                          {tabs:[3 screens]}  this person's tab bar (may include Transfer and Stock)
//   PUT    settings/:itemId              {countingUnit, perBuying, lowStock, workplaceName}
//   POST   requests                      {clientKey, from, to, yesterday, itemId, quantity, unitId, expectedName, expectedUnit}
//                                        (unitId: the item's buying, counting or recipe unit; quantity is in that unit)
//   POST   cancel                        {id}
//   POST   final-approve                 {id}
//   POST   zones/add|rename|delete       {name} | {from, to} | {name}   manage storages (zones)
//   GET    receipts                      recent purchase receipts (no screenshots)
//   GET    receipts/shot?id=             the PC's screenshot of a prepared receipt (kept 3 days)
//   POST   receipts                      {clientKey, supplierId, invoice, currency, rate, delivery, lines:[{itemId, unitId, qty, cost}]}
//   POST   receipts/cancel               {id}   (before the final approval)
//   POST   receipts/final-approve        {id}   the PC may now press "Receive & send to finance" once
//   POST   receipts/resolve              {id, saved, note}   after checking the workplace, for a receipt that needs checking
//   GET    itemjobs                      recent create/edit-in-workplace tasks (no screenshots)
//   GET    itemjobs/shot?id=             the PC's screenshot of a task
//   POST   itemjobs                      {clientKey, itemId, kind: create|edit}   (the details are taken from the item's saved setup)
//   POST   itemjobs/cancel|final-approve|resolve   same rules as receipts
//   POST   start-worker                  ask the office PC helper to start the worker (kept until the PC is back: {queued})
//   POST   signin-check                  ask the PC to check the workplace sign-in (it signs in with its own PIN if needed)
//   GET    signin-shot                   the screenshot from the last sign-in check
//   POST   counts-bulk                   {storage, countedAt, note, pin, lines:[{itemId, quantity}]}   (one PIN for many items)
//   POST   counts                        {itemId, storage, quantity, countedAt, note, pin}   (asks for the PIN again)
//   POST   resolve                       {id, status, note, recordedDate}
//   --- office PC (x-worker-token) ---
//   GET    worker/wait?for=worker|launcher&live=0|1   held open until there is work (or ~25 s): {work} (+ control status for the launcher)
//   GET    worker/preview                oldest waiting request that needs a PC check
//   POST   worker/preview-report         {id, ok, message, image}
//   POST   worker/claim                  the next final-approved request
//   POST   worker/heartbeat              {live, pageReady, note}   every ~30 s -> {checkSignin}
//   POST   worker/problem                {message}   the worker could not start; shown in the app while it is off
//   POST   worker/signin-report          {ok, auto, message, image}   a sign-in check, or the PC signing in by itself
//   POST   worker/receipt-claim          the next receipt to prepare (the PC never submits it)
//   POST   worker/receipt-report         {id, claimToken, status: prepared|failed|closed, message, image}
//   POST   worker/receipt-held           {id}   status of the receipt the PC is holding open
//   POST   worker/receipt-submit-claim   {id}   take a final-approved receipt to press the button once
//   POST   worker/receipt-finish         {id, status: completed|needs_checking|failed, message, image}
//   POST   worker/itemjob-claim|itemjob-report|itemjob-held|itemjob-submit-claim|itemjob-finish   same as the receipt routes
//   POST   worker/report                 {id, status, message, image}
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { BodyTooLarge, InvalidBody, readJsonBody } from "../_shared/security.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://rozhzero969-hub.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-device-label, x-session-token, x-worker-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const fail = (error: string, status = 400) => json({ error }, status);
const str = (v: unknown, max = 240) => String(v ?? "").trim().slice(0, max);
const sha256 = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))]
  .map((x) => x.toString(16).padStart(2, "0")).join("");
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v));
const decimal = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0) ||
  (typeof v === "string" && /^\d+(?:\.\d{1,6})?$/.test(v) && Number.isFinite(Number(v)));
// Every screen an account may put in its tab bar (Rozha also has Devices and Settings).
const SCREENS = ["order", "assistant", "history", "transfers", "stock", "receipts", "suppliers", "itemsAdmin", "units", "record", "devices", "settings"];
const MAX_BODY = 64 * 1024;
const MAX_WORKER_BODY = 900 * 1024;   // a PC report carries a screenshot
const IMAGE_MAX_CHARS = 600_000;
const WAIT_MS = 25_000, WAIT_STEP_MS = 1_000;   // worker/wait: how long one question is held open, and how often it looks

async function readBody(req: Request, max = MAX_BODY): Promise<any> {
  return readJsonBody(req, max);
}
type Account = "rozha" | "yunis";
async function person(req: Request): Promise<Account | null> {
  const token = req.headers.get("x-session-token"); if (!token) return null;
  const { data, error } = await db.from("app_sessions").select("account,expires_at,revoked_at").eq("token_hash", await sha256(token)).maybeSingle();
  const expires = Date.parse(data?.expires_at ?? "");
  if (error || !data || data.revoked_at || !Number.isFinite(expires) || expires <= Date.now()) return null;
  return data.account === "rozha" || data.account === "yunis" ? data.account : null;
}
async function worker(req: Request): Promise<string | null> {
  const token = req.headers.get("x-worker-token"); if (!token || token.length < 32) return null;
  const { data, error } = await db.from("stock_workers").select("id").eq("token_hash", await sha256(token)).eq("enabled", true).maybeSingle();
  return error ? null : data?.id ?? null;
}
/* Re-asking for the PIN shares the sign-in's wrong-guess limits, so this route can't be used to guess a PIN. */
const PIN_WINDOW_SECONDS = 600, MAX_FAILED = 8, MAX_GLOBAL_FAILED = 40;
async function pinPrints(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return [await sha256(`ip|${ip}`), await sha256("global-login-lock")];
}
async function reservePinAttempt(req: Request): Promise<number[] | null> {
  const { data, error } = await db.rpc("app_internal_reserve_login", {
    p_fingerprints: await pinPrints(req), p_window_seconds: PIN_WINDOW_SECONDS,
    p_ip_limit: MAX_FAILED, p_global_limit: MAX_GLOBAL_FAILED,
  });
  if (error) throw error;
  if (data !== null && (!Array.isArray(data) || data.length !== 2 || !data.every((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0))) {
    throw new Error("Invalid PIN attempt reservation");
  }
  return data;
}
async function completePinAttempt(ids: number[]) {
  const { error } = await db.from("app_login_attempts").update({ succeeded: true }).in("id", ids);
  if (error) throw error;
}

/* ---------- shapes the app uses ---------- */
const toRequest = (r: any, shots: Set<string>) => ({
  id: r.id, itemId: r.item_id, itemName: r.app_name ?? r.item_name, workplaceName: r.item_name, unitLabel: r.unit_label, quantity: Number(r.quantity),
  enteredQuantity: r.entered_quantity === null ? null : Number(r.entered_quantity), enteredUnitLabel: r.entered_unit_label ?? null,
  from: r.from_storage, to: r.to_storage, yesterday: r.record_yesterday, status: r.status,
  approvedBy: r.approved_by, approvedAt: r.approved_at,
  previewStatus: r.preview_status, previewMessage: r.preview_message, previewedAt: r.previewed_at,
  finalApprovedBy: r.final_approved_by, finalApprovedAt: r.final_approved_at,
  finishedAt: r.finished_at, resultMessage: r.result_message, recordedDate: r.recorded_date,
  batchId: r.batch_id, batchSize: Number(r.batch_size ?? 1), batchPos: Number(r.batch_pos ?? 0),
  hasCheckShot: shots.has(r.id),
});
const toCount = (c: any) => ({
  id: c.id, itemId: c.item_id, itemName: c.item_name, storage: c.storage_name, unitLabel: c.unit_label,
  quantity: Number(c.quantity), prior: Number(c.prior_quantity), by: c.entered_by, countedAt: c.counted_at, enteredAt: c.entered_at, note: c.note,
});
async function readAll(build: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
// Is the PC worker running, and is the launcher (which can start it from the phone) alive?
const seenLast: Record<string, number> = {};
async function touchControl(col: "worker_seen_at" | "launcher_seen_at") {
  if (Date.now() - (seenLast[col] ?? 0) < 20_000) return;   // one small write per 20 seconds at most
  const { error } = await db.from("stock_worker_control").upsert({ id: 1, [col]: new Date().toISOString() });
  if (error) throw error;
  seenLast[col] = Date.now();
}
async function controlStatus() {
  const { data, error } = await db.from("stock_worker_control").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  const fresh = (v: string | null | undefined) => !!v && Date.now() - Date.parse(v) < 120_000;
  return { workerOnline: fresh(data?.worker_seen_at), launcherOnline: fresh(data?.launcher_seen_at),
    workerSeenAt: data?.worker_seen_at ?? null, workerLive: data?.worker_live ?? null, workerReceiptsLive: data?.worker_receipts_live ?? null, workerItemsLive: data?.worker_items_live ?? null, workerPageReady: data?.worker_page_ready ?? null,
    workerNote: data?.worker_note ?? null,
    // A start-up problem counts only if it came after the worker was last seen running.
    workerProblem: data?.worker_problem_at && (!data?.worker_seen_at || Date.parse(data.worker_problem_at) > Date.parse(data.worker_seen_at)) ? data.worker_problem ?? null : null,
    workerProblemAt: data?.worker_problem_at ?? null,
    startRequestedAt: data?.start_requested_at ?? null, startHandledAt: data?.start_handled_at ?? null,
    // A start was asked for and the office PC helper has not picked it up yet (it will once the PC is back).
    startPending: !!data?.start_requested_at && (!data?.start_handled_at || Date.parse(data.start_handled_at) < Date.parse(data.start_requested_at)),
    signinRequestedAt: data?.signin_requested_at ?? null, signinCheckedAt: data?.signin_checked_at ?? null, signinOk: data?.signin_ok ?? null,
    signinAuto: data?.signin_auto ?? null, signinMessage: data?.signin_message ?? null, signinHasShot: !!data?.signin_shot };
}
/* A short push to every phone when the PC signs in to the workplace by itself, or cannot. */
async function pushSignin(ok: boolean) {
  const secret = Deno.env.get("CRON_SECRET") ?? "", anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!secret) return;
  const msg = ok
    ? { bodyEn: "The office PC signed in to the workplace system. Open Transfers to see the screenshot.", bodyKu: "کۆمپیوتەری ئۆفیس چووە ناو سیستەمی شوێنی کار. بۆ بینینی وێنەکە گواستنەوە بکەرەوە.", bodyAr: "سجّل حاسوب المكتب الدخول إلى نظام العمل. افتح النقل لرؤية اللقطة." }
    : { bodyEn: "The office PC could not sign in to the workplace system. Check the PC.", bodyKu: "کۆمپیوتەری ئۆفیس نەیتوانی بچێتە ناو سیستەمی شوێنی کار. کۆمپیوتەرەکە بپشکنە.", bodyAr: "لم يتمكن حاسوب المكتب من تسجيل الدخول إلى نظام العمل. تحقق من الحاسوب." };
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon, "x-cron-secret": secret },
    body: JSON.stringify({ type: "assistant", title: "Ricotta PC", ...msg }),
  }).catch((e) => console.error("signin push", errorText(e)));
}
async function requestsAndBalances() {
  const [reqs, balances] = await Promise.all([
    db.from("stock_requests").select("*").order("approved_at", { ascending: false }).limit(150),
    readAll(() => db.from("stock_balances").select("item_id,storage_name,quantity").gt("quantity", 0).order("item_id")),
  ]);
  if (reqs.error) throw reqs.error;
  const ids = (reqs.data ?? []).map((r: any) => r.id);
  const shots = new Set<string>();
  if (ids.length) {
    const { data, error } = await db.from("stock_shots").select("request_id").eq("kind", "check").in("request_id", ids);
    if (error) throw error;
    for (const s of data ?? []) shots.add(s.request_id);
  }
  return {
    requests: (reqs.data ?? []).map((r: any) => toRequest(r, shots)),
    control: await controlStatus(),
    balances: balances.map((b: any) => ({ itemId: b.item_id, storage: b.storage_name, quantity: Number(b.quantity) })),
  };
}
/* What the PC needs: the transfer as approved (every item of the batch, in order), plus the app's own stock of each
   item in the source storage. The top-level item fields repeat the first line for an older PC. */
async function workerRequest(id: string) {
  const { data: r, error } = await db.from("stock_requests").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: rows, error: rowsError } = await db.from("stock_requests").select("*").eq("batch_id", r.batch_id).order("batch_pos");
  if (rowsError) throw rowsError;
  const ids = (rows ?? []).map((x: any) => x.item_id).filter(Boolean);
  const stock = new Map<string, number>();
  if (ids.length) {
    const { data: bs, error: stockError } = await db.from("stock_balances").select("item_id,quantity").in("item_id", ids).eq("storage_name", r.from_storage);
    if (stockError) throw stockError;
    for (const b of bs ?? []) stock.set(b.item_id, Number(b.quantity));
  }
  // The PC works in the unit that was entered (2 boxes, not 24 pieces). The ledger is in counting units,
  // so the app's stock is converted with the same factor as the request: ledger = entered x factor.
  const lines = (rows ?? []).map((x: any) => {
    const ledgerQty = Number(x.quantity);
    const enteredQty = x.entered_quantity === null ? ledgerQty : Number(x.entered_quantity);
    const ledgerStock = x.item_id ? (stock.get(x.item_id) ?? 0) : 0;
    return { itemId: x.item_id, itemName: x.item_name, unitLabel: x.entered_unit_label ?? x.unit_label, quantity: enteredQty,
      appQuantity: ledgerStock * (enteredQty / ledgerQty) };
  });
  return { id: r.id, batchId: r.batch_id, from: r.from_storage, to: r.to_storage, yesterday: r.record_yesterday, lines, ...lines[0] };
}
function cleanImage(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (s.length > IMAGE_MAX_CHARS || !/^[A-Za-z0-9+/=]+$/.test(s)) throw new Error("Invalid image");
  return "data:image/jpeg;base64," + s;
}
const toReceipt = (r: any) => ({
  id: r.id, supplierName: r.supplier_name, invoice: r.invoice, currency: r.currency, rate: r.rate === null ? null : Number(r.rate),
  delivery: r.delivery === null ? null : Number(r.delivery), lines: r.lines, status: r.status, message: r.message,
  createdBy: r.created_by, createdAt: r.created_at, preparedAt: r.prepared_at, finishedAt: r.finished_at, hasShot: !!r.has_shot,
  finalApprovedAt: r.final_approved_at, finalApprovedBy: r.final_approved_by, stockAddedAt: r.stock_added_at, resolvedNote: r.resolved_note,
});
const RECEIPT_COLS = "id,supplier_name,invoice,currency,rate,delivery,lines,status,message,created_by,created_at,prepared_at,finished_at,final_approved_at,final_approved_by,stock_added_at,resolved_note";
const errorText = (e: any): string => String(e?.message || "Operation failed").slice(0, 400);
const claimToken = (v: unknown) => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
// Concurrent retries can both miss the first SELECT. The unique client key is the authority.
async function insertOnce(table: "stock_receipts" | "stock_item_jobs", row: any): Promise<string> {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (!error) return data.id;
  if (error.code === "23505") {
    const { data: same, error: lookupError } = await db.from(table).select("id").eq("client_key", row.client_key).maybeSingle();
    if (lookupError) throw lookupError;
    if (same) return same.id;
    if (table === "stock_item_jobs") throw { code: "P0001", message: "This item already has a task on the PC. Finish or cancel it first" };
  }
  throw error;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const at = segments.lastIndexOf("stock-api");
  const path = at >= 0 ? segments.slice(at + 1) : segments;
  try {
    // ---------- the office PC ----------
    if (path[0] === "worker") {
      const who = await worker(req); if (!who) return fail("Worker authentication required", 401);
      if (req.method === "GET" && path[1] === "control") {
        // The launcher on the office PC asks this every few seconds.
        await touchControl("launcher_seen_at");
        return json(await controlStatus());
      }
      if (req.method === "GET" && path[1] === "wait") {
        // Instead of the PC asking every minute, the question is held open here and answered the moment
        // there is something to do, so new work starts within about a second and far fewer calls are made.
        const q = new URL(req.url).searchParams, launcher = q.get("for") === "launcher";
        const until = Date.now() + WAIT_MS;
        let work = false;
        for (;;) {
          await touchControl(launcher ? "launcher_seen_at" : "worker_seen_at");
          const { data, error } = launcher ? await db.rpc("stock_launcher_has_work") : await db.rpc("stock_worker_has_work", { p_live: q.get("live") === "1", p_multi: q.get("multi") === "1" });
          if (error) throw error;
          if (data === true) { work = true; break; }
          if (Date.now() >= until || req.signal.aborted) break;
          await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
        }
        return json(launcher ? { work, ...(await controlStatus()) } : { work });
      }
      if (req.method === "POST" && path[1] === "heartbeat") {
        // The worker's health: running, live or checks only, and whether the workplace page is ready.
        const b = await readBody(req);
        seenLast.worker_seen_at = Date.now();
        const { error } = await db.from("stock_worker_control").upsert({ id: 1, worker_seen_at: new Date().toISOString(),
          worker_live: b.live === true, worker_receipts_live: b.receiptsLive === true, worker_items_live: b.itemsLive === true, worker_page_ready: b.pageReady === true, worker_note: str(b.note, 300) || null });
        if (error) throw error;
        // A person asked the PC to check the workplace sign-in and the PC has not answered since.
        const { data: c } = await db.from("stock_worker_control").select("signin_requested_at,signin_checked_at").eq("id", 1).maybeSingle();
        const checkSignin = !!c?.signin_requested_at && (!c.signin_checked_at || Date.parse(c.signin_checked_at) < Date.parse(c.signin_requested_at));
        return json({ ok: true, checkSignin });
      }
      if (req.method === "POST" && path[1] === "problem") {
        // {message}: the worker could not start (or the launcher saw it never report in). Shown in the app.
        const b = await readBody(req);
        const message = str(b.message, 400);
        if (!message) return fail("Invalid report");
        const { error } = await db.from("stock_worker_control").upsert({ id: 1, worker_problem: message, worker_problem_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "signin-report") {
        // {ok, auto, message, image}: the result of a sign-in check, or of the PC signing in by itself.
        const b = await readBody(req, MAX_WORKER_BODY);
        if (typeof b.ok !== "boolean") return fail("Invalid report");
        const { error } = await db.from("stock_worker_control").upsert({ id: 1, signin_checked_at: new Date().toISOString(), signin_ok: b.ok,
          signin_auto: b.auto === true, signin_message: str(b.message, 400) || null, signin_shot: cleanImage(b.image) });
        if (error) throw error;
        if (b.auto === true || b.ok === false) await pushSignin(b.ok);
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "receipt-claim") {
        // Oldest waiting receipt, or one left half-filled by a worker that stopped more than 10 minutes ago.
        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        const eligible = `status.eq.waiting,and(status.eq.preparing,claimed_at.lt.${stale})`;
        const { data: next, error } = await db.from("stock_receipts").select("id").or(eligible)
          .order("created_at").limit(1).maybeSingle();
        if (error) throw error;
        if (!next) return json({ receipt: null });
        const { data: got, error: e2 } = await db.from("stock_receipts").update({ status: "preparing", claimed_at: new Date().toISOString() })
          .eq("id", next.id).or(eligible).select("*").maybeSingle();
        if (e2) throw e2;
        return json({ receipt: got ? { id: got.id, claimToken: got.claimed_at, supplierName: got.supplier_name, invoice: got.invoice, currency: got.currency,
          rate: got.rate === null ? null : Number(got.rate), delivery: got.delivery === null ? null : Number(got.delivery), lines: got.lines } : null });
      }
      if (req.method === "POST" && path[1] === "receipt-report") {
        const b = await readBody(req, MAX_WORKER_BODY);
        if (!uuid(b.id) || !claimToken(b.claimToken) || !["prepared", "failed", "closed"].includes(b.status)) return fail("Invalid report");
        const now = new Date().toISOString();
        const from = b.status === "closed" ? ["prepared"] : ["preparing"];
        // A receipt finished on the PC by hand (or left) is checked by a person before any stock is added.
        const patch: Record<string, unknown> = { status: b.status === "closed" ? "needs_checking" : b.status, message: str(b.message, 1000) || null };
        if (b.status === "prepared") patch.prepared_at = now; else patch.finished_at = now;
        const img = cleanImage(b.image); if (img) patch.shot = img;
        const { data, error } = await db.from("stock_receipts").update(patch).eq("id", b.id).eq("claimed_at", b.claimToken).in("status", from).select("id");
        if (error) throw error;
        if (!data?.length) return fail("This receipt is no longer held by this worker", 409);
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "receipt-held") {
        const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid receipt");
        const { data, error } = await db.from("stock_receipts").select("status,final_approved_at").eq("id", b.id).maybeSingle();
        if (error) throw error;
        return json({ status: data?.status ?? null, finalApproved: !!data?.final_approved_at });
      }
      if (req.method === "POST" && path[1] === "receipt-submit-claim") {
        const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid receipt");
        const { data, error } = await db.rpc("stock_receipt_claim_submit", { p_id: b.id });
        if (error) throw error;
        return json({ ok: data === true });
      }
      if (req.method === "POST" && path[1] === "receipt-finish") {
        const b = await readBody(req, MAX_WORKER_BODY);
        if (!uuid(b.id) || !["completed", "needs_checking", "failed"].includes(b.status)) return fail("Invalid report");
        const { error } = await db.rpc("stock_receipt_finish", { p_id: b.id, p_status: b.status, p_message: str(b.message, 1000), p_image: cleanImage(b.image) });
        if (error) throw error;
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "itemjob-claim") {
        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        const eligible = `status.eq.waiting,and(status.eq.preparing,claimed_at.lt.${stale})`;
        const { data: next, error } = await db.from("stock_item_jobs").select("id").or(eligible)
          .order("created_at").limit(1).maybeSingle();
        if (error) throw error;
        if (!next) return json({ job: null });
        const { data: got, error: e2 } = await db.from("stock_item_jobs").update({ status: "preparing", claimed_at: new Date().toISOString() })
          .eq("id", next.id).or(eligible).select("id,kind,payload,claimed_at").maybeSingle();
        if (e2) throw e2;
        return json({ job: got ? { ...got.payload, id: got.id, kind: got.kind, claimToken: got.claimed_at } : null });
      }
      if (req.method === "POST" && path[1] === "itemjob-report") {
        const b = await readBody(req, MAX_WORKER_BODY);
        if (!uuid(b.id) || !claimToken(b.claimToken) || !["prepared", "failed", "closed"].includes(b.status)) return fail("Invalid report");
        const now = new Date().toISOString();
        const patch: Record<string, unknown> = { status: b.status === "closed" ? "needs_checking" : b.status, message: str(b.message, 1000) || null };
        if (b.status === "prepared") patch.prepared_at = now; else patch.finished_at = now;
        const img = cleanImage(b.image); if (img) patch.shot = img;
        const { data, error } = await db.from("stock_item_jobs").update(patch).eq("id", b.id).eq("claimed_at", b.claimToken)
          .in("status", b.status === "closed" ? ["prepared"] : ["preparing"]).select("id");
        if (error) throw error;
        if (!data?.length) return fail("This task is no longer held by this worker", 409);
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "itemjob-held") {
        const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid task");
        const { data, error } = await db.from("stock_item_jobs").select("status,final_approved_at").eq("id", b.id).maybeSingle();
        if (error) throw error;
        return json({ status: data?.status ?? null, finalApproved: !!data?.final_approved_at });
      }
      if (req.method === "POST" && path[1] === "itemjob-submit-claim") {
        const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid task");
        const { data, error } = await db.rpc("stock_item_job_claim_submit", { p_id: b.id });
        if (error) throw error;
        return json({ ok: data === true });
      }
      if (req.method === "POST" && path[1] === "itemjob-finish") {
        const b = await readBody(req, MAX_WORKER_BODY);
        if (!uuid(b.id) || !["completed", "needs_checking", "failed"].includes(b.status)) return fail("Invalid report");
        const { error } = await db.rpc("stock_item_job_finish", { p_id: b.id, p_status: b.status, p_message: str(b.message, 1000), p_image: cleanImage(b.image) });
        if (error) throw error;
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "control-handled") {
        const b = await readBody(req);
        const { data: c, error: readError } = await db.from("stock_worker_control").select("start_requested_at").eq("id", 1).maybeSingle();
        if (readError) throw readError;
        // Older launchers send no timestamp. New ones acknowledge only the
        // request they actually saw, so a newer start cannot be swallowed.
        const requestedAt = b.requestedAt ?? c?.start_requested_at;
        if (!requestedAt) return json({ ok: true, handled: false });
        if (!claimToken(requestedAt)) return fail("Invalid start request");
        const { data, error } = await db.from("stock_worker_control").update({ start_handled_at: requestedAt })
          .eq("id", 1).eq("start_requested_at", requestedAt).select("id");
        if (error) throw error;
        return json({ ok: true, handled: !!data?.length });
      }
      if (req.method === "GET" && path[1] === "preview") {
        await touchControl("worker_seen_at");
        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        // Only the lead row of a transfer is handed out. A PC that cannot run multi-item transfers (no ?multi=1) never gets one.
        let pending = db.from("stock_requests").select("id").eq("status", "waiting").eq("batch_pos", 0).is("final_approved_at", null)
          .or(`previewed_at.is.null,previewed_at.lt.${stale}`);
        if (new URL(req.url).searchParams.get("multi") !== "1") pending = pending.eq("batch_size", 1);
        const { data, error } = await pending.order("approved_at").order("id").limit(1).maybeSingle();
        if (error) throw error;
        return json({ request: data ? await workerRequest(data.id) : null });
      }
      if (req.method === "POST" && path[1] === "preview-report") {
        const b = await readBody(req, MAX_WORKER_BODY);
        if (!uuid(b.id) || typeof b.ok !== "boolean") return fail("Invalid report");
        const { error } = await db.rpc("stock_preview_report", { p_id: b.id, p_worker: who, p_ok: b.ok, p_message: str(b.message, 500), p_image: cleanImage(b.image) });
        if (error) throw error;
        return json({ ok: true });
      }
      if (req.method === "POST" && path[1] === "claim") {
        const { data, error } = await db.rpc("stock_claim", { p_worker: who, p_multi: new URL(req.url).searchParams.get("multi") === "1" });
        if (error) throw error;
        return json({ request: data ? await workerRequest(data) : null });
      }
      if (req.method === "POST" && path[1] === "report") {
        const b = await readBody(req, MAX_WORKER_BODY);
        if (!uuid(b.id) || !["completed", "failed", "needs_checking"].includes(b.status)) return fail("Invalid report");
        const { error } = await db.rpc("stock_finish", { p_id: b.id, p_worker: who, p_status: b.status, p_message: str(b.message, 1000), p_image: cleanImage(b.image) });
        if (error) throw error;
        return json({ ok: true });
      }
      return fail("Unknown worker route", 404);
    }

    // ---------- Rozha or Yunis ----------
    const actor = await person(req); if (!actor) return fail("Sign in first", 401);

    if (req.method === "GET" && path[0] === "bootstrap") {
      const [storages, settings, counts, live, myTabs, groups] = await Promise.all([
        db.from("stock_storages").select("name").eq("archived", false).order("sort_order"),
        db.from("stock_item_settings").select("item_id,counting_unit,per_buying,low_stock,workplace_name,usage_unit,per_counting_usage,workplace_confirmed_name,workplace_created_at"),
        db.from("stock_counts").select("*").order("entered_at", { ascending: false }).limit(150),
        requestsAndBalances(),
        db.from("stock_tabs").select("tabs").eq("account", actor).maybeSingle(),
        db.from("stock_groups").select("id,name,item_ids").order("name"),
      ]);
      for (const r of [storages, settings, counts, groups]) if (r.error) throw r.error;
      return json({
        storages: (storages.data ?? []).map((s: any) => s.name),
        settings: (settings.data ?? []).map((s: any) => ({ itemId: s.item_id, countingUnit: s.counting_unit, perBuying: s.per_buying === null ? null : Number(s.per_buying), lowStock: s.low_stock === null ? null : Number(s.low_stock), workplaceName: s.workplace_name ?? null,
          usageUnit: s.usage_unit ?? null, perCountingUsage: s.per_counting_usage === null ? null : Number(s.per_counting_usage),
          workplaceConfirmedName: s.workplace_confirmed_name ?? null, workplaceCreatedAt: s.workplace_created_at ?? null })),
        counts: (counts.data ?? []).map(toCount),
        tabs: Array.isArray(myTabs.data?.tabs) ? myTabs.data.tabs : null,
        groups: (groups.data ?? []).map((g: any) => ({ id: g.id, name: g.name, itemIds: g.item_ids ?? [] })),
        ...live,
      });
    }
    if (req.method === "GET" && path[0] === "receipts" && !path[1]) {
      // Screenshots are only kept for 3 days.
      await db.from("stock_receipts").update({ shot: null }).not("shot", "is", null).lt("created_at", new Date(Date.now() - 3 * 86400_000).toISOString());
      const [{ data, error }, shots] = await Promise.all([
        db.from("stock_receipts").select(RECEIPT_COLS).order("created_at", { ascending: false }).limit(60),
        db.from("stock_receipts").select("id").not("shot", "is", null).order("created_at", { ascending: false }).limit(60),
      ]);
      if (error) throw error;
      const withShot = new Set((shots.data ?? []).map((r: any) => r.id));
      return json({ receipts: (data ?? []).map((r: any) => toReceipt({ ...r, has_shot: withShot.has(r.id) })) });
    }
    if (req.method === "GET" && path[0] === "receipts" && path[1] === "shot") {
      const id = new URL(req.url).searchParams.get("id");
      if (!uuid(id)) return fail("Invalid receipt");
      const { data, error } = await db.from("stock_receipts").select("shot").eq("id", id).maybeSingle();
      if (error) throw error;
      return json({ image: data?.shot ?? null });
    }
    if (req.method === "POST" && path[0] === "receipts" && !path[1]) {
      const b = await readBody(req);
      if (!uuid(b.clientKey)) return fail("Invalid receipt");
      const { data: same, error: sameError } = await db.from("stock_receipts").select("id").eq("client_key", b.clientKey).maybeSingle();
      if (sameError) throw sameError;
      if (same) return json({ id: same.id }, 201);                       // the same receipt sent twice
      const { data: sup, error: supplierError } = await db.from("app_suppliers").select("id,name").eq("id", str(b.supplierId, 80)).maybeSingle();
      if (supplierError) throw supplierError;
      if (!sup) return fail("Choose the supplier");
      const invoice = str(b.invoice, 60); if (!invoice) return fail("Enter the invoice number");
      if (!["USD", "IQD"].includes(b.currency)) return fail("Choose the receipt currency");
      const currency = b.currency;
      const num = (v: unknown) => {
        if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
        if (typeof v !== "string" || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(v.trim())) return NaN;
        return Number(v.trim().replace(/,/g, ""));
      };
      const precision = (n: number, places: number) => Number(n.toFixed(places)) === n;
      const rate = currency === "USD" ? num(b.rate) : null;
      if (currency === "USD" && !(rate! > 0 && rate! < 1_000_000 && precision(rate!, 4))) return fail("Enter today's dollar rate (up to four decimals)");
      const delivery = b.delivery === null || b.delivery === undefined || b.delivery === "" ? null : num(b.delivery);
      if (delivery !== null && !(delivery >= 0 && delivery < 1e12 && precision(delivery, 2))) return fail("Invalid delivery amount (up to two decimals)");
      const raw = Array.isArray(b.lines) ? b.lines : [];
      if (raw.length < 1 || raw.length > 40) return fail("Add at least one item");
      const ids = [...new Set(raw.map((l: any) => str(l?.itemId, 80)))];
      const [items, settings, units] = await Promise.all([
        db.from("app_items").select("id,name,unit_id,supplier_id").in("id", ids),
        db.from("stock_item_settings").select("item_id,counting_unit,per_buying,workplace_name,usage_unit,per_counting_usage").in("item_id", ids),
        db.from("app_units").select("id,en"),
      ]);
      for (const r of [items, settings, units]) if (r.error) throw r.error;
      const itemMap = new Map((items.data ?? []).map((i: any) => [i.id, i]));
      const setMap = new Map((settings.data ?? []).map((x: any) => [x.item_id, x]));
      const unitMap = new Map((units.data ?? []).map((u: any) => [u.id, u.en]));
      const lines = [];
      for (const l of raw) {
        const it: any = itemMap.get(str(l?.itemId, 80)); if (!it) return fail("An item on this receipt no longer exists");
        if (it.supplier_id !== sup.id) return fail(`${it.name} is not paired with ${sup.name}`);
        const st: any = setMap.get(it.id);
        // Stock is kept in counting units, so every item on a receipt must have its counting format set up.
        if (!st) return fail(`Set up ${it.name} for stock first (its counting format)`);
        const unitId = str(l?.unitId, 80);
        // The buying format, the counting format or the recipe unit (checked in that order when two are the same unit).
        if (unitId !== it.unit_id && unitId !== st.counting_unit && unitId !== st.usage_unit) return fail(`Choose a unit for ${it.name}`);
        const qty = num(l?.qty), cost = num(l?.cost);
        if (!(qty > 0 && qty < 1e7 && precision(qty, 6)) || !(cost > 0 && cost < 1e12 && precision(cost, 6))) return fail(`Enter the quantity and cost for ${it.name} (up to six decimals)`);
        let ledgerQty = qty;                                              // in counting units
        if (unitId === st.counting_unit) ledgerQty = qty;
        else if (unitId === it.unit_id) {
          if (!(Number(st.per_buying) > 0)) return fail(`Set how many ${unitMap.get(st.counting_unit) ?? ""} are in one ${unitMap.get(unitId) ?? ""} for ${it.name}`);
          ledgerQty = Math.round(qty * Number(st.per_buying) * 1e6) / 1e6;
        } else {
          if (!(Number(st.per_counting_usage) > 0)) return fail(`Set how many ${unitMap.get(unitId) ?? ""} are in one ${unitMap.get(st.counting_unit) ?? ""} for ${it.name}`);
          ledgerQty = Math.round(qty / Number(st.per_counting_usage) * 1e6) / 1e6;
        }
        if (!(ledgerQty > 0 && ledgerQty <= 1e8)) return fail(`The stock amount for ${it.name} is outside the supported range`);
        if (!unitMap.get(unitId) || !unitMap.get(st.counting_unit)) return fail(`A unit for ${it.name} no longer exists`);
        lines.push({ itemId: it.id, appName: it.name, workplaceName: (st.workplace_name || "").trim() || it.name,
          unitId, unitLabel: unitMap.get(unitId) ?? "", qty, cost, ledgerQty, countingLabel: unitMap.get(st.counting_unit) ?? "" });
      }
      const id = await insertOnce("stock_receipts", { client_key: b.clientKey, supplier_id: sup.id, supplier_name: sup.name,
        invoice, currency, rate, delivery, lines, created_by: actor });
      return json({ id }, 201);
    }
    if (req.method === "POST" && path[0] === "receipts" && path[1] === "cancel") {
      const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid receipt");
      const { data, error } = await db.from("stock_receipts").update({ status: "cancelled", finished_at: new Date().toISOString() })
        // A final approval the PC never acted on expires after 30 minutes (it can no longer press), so it can be cancelled then.
        .eq("id", b.id).or(`status.in.(waiting,failed),and(status.eq.prepared,final_approved_at.is.null),and(status.eq.prepared,final_approved_at.lt.${new Date(Date.now() - 30 * 60_000).toISOString()})`).select("id");
      if (error) throw error;
      if (!data?.length) return fail("This receipt can no longer be cancelled");
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "receipts" && path[1] === "final-approve") {
      const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid receipt");
      const c = await controlStatus();
      if (!c.workerOnline || c.workerReceiptsLive !== true || c.workerPageReady !== true) return fail("The PC worker is not set up to save receipts yet (test mode), so it cannot press the button");
      const { error } = await db.rpc("stock_receipt_final_approve", { p_id: b.id, p_actor: actor });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "receipts" && path[1] === "resolve") {
      const b = await readBody(req);
      if (!uuid(b.id) || typeof b.saved !== "boolean") return fail("Invalid receipt");
      const { error } = await db.rpc("stock_receipt_resolve", { p_id: b.id, p_actor: actor, p_saved: b.saved, p_note: str(b.note, 900) });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "GET" && path[0] === "itemjobs" && !path[1]) {
      await db.from("stock_item_jobs").update({ shot: null }).not("shot", "is", null).lt("created_at", new Date(Date.now() - 3 * 86400_000).toISOString());
      const [{ data, error }, shots] = await Promise.all([
        db.from("stock_item_jobs").select("id,item_id,item_name,kind,payload,status,message,created_by,created_at,prepared_at,final_approved_at,finished_at,resolved_note")
          .order("created_at", { ascending: false }).limit(60),
        db.from("stock_item_jobs").select("id").not("shot", "is", null).order("created_at", { ascending: false }).limit(60),
      ]);
      if (error) throw error;
      const withShot = new Set((shots.data ?? []).map((r: any) => r.id));
      return json({ jobs: (data ?? []).map((j: any) => ({ id: j.id, itemId: j.item_id, itemName: j.item_name, kind: j.kind, payload: j.payload, status: j.status,
        message: j.message, createdBy: j.created_by, createdAt: j.created_at, preparedAt: j.prepared_at, finalApprovedAt: j.final_approved_at,
        finishedAt: j.finished_at, resolvedNote: j.resolved_note, hasShot: withShot.has(j.id) })) });
    }
    if (req.method === "GET" && path[0] === "itemjobs" && path[1] === "shot") {
      const id = new URL(req.url).searchParams.get("id");
      if (!uuid(id)) return fail("Invalid task");
      const { data, error } = await db.from("stock_item_jobs").select("shot").eq("id", id).maybeSingle();
      if (error) throw error;
      return json({ image: data?.shot ?? null });
    }
    if (req.method === "POST" && path[0] === "itemjobs" && !path[1]) {
      // The details are built here from the item's saved setup, so the PC fills exactly what the app holds.
      const b = await readBody(req);
      if (!uuid(b.clientKey) || !["create", "edit"].includes(b.kind)) return fail("Invalid task");
      const { data: same, error: sameError } = await db.from("stock_item_jobs").select("id").eq("client_key", b.clientKey).maybeSingle();
      if (sameError) throw sameError;
      if (same) return json({ id: same.id }, 201);
      const itemId = str(b.itemId, 80);
      const [itemResult, settingsResult, units, open] = await Promise.all([
        db.from("app_items").select("id,name,unit_id").eq("id", itemId).maybeSingle(),
        db.from("stock_item_settings").select("*").eq("item_id", itemId).maybeSingle(),
        db.from("app_units").select("id,en"),
        db.from("stock_item_jobs").select("id").eq("item_id", itemId).in("status", ["waiting", "preparing", "prepared", "submitting", "needs_checking"]).limit(1),
      ]);
      for (const r of [itemResult, settingsResult, units, open]) if (r.error) throw r.error;
      const it = itemResult.data, st = settingsResult.data;
      if (!it) return fail("Item not found");
      if (open.data?.length) return fail("This item already has a task on the PC. Finish or cancel it first");
      if (!st || !st.usage_unit) return fail("Set the item's counting format and recipe unit first");
      const unitName = new Map((units.data ?? []).map((u: any) => [u.id, u.en]));
      if (st.counting_unit !== st.usage_unit && !(Number(st.per_counting_usage) > 0)) return fail("Set how many recipe units are in one counting unit");
      if (it.unit_id !== st.counting_unit && !(Number(st.per_buying) > 0)) return fail("Set how many counting units are in one buying unit");
      const name = (st.workplace_name || "").trim() || it.name;
      const payload = {
        name, fromName: b.kind === "edit" ? ((st.workplace_confirmed_name || "").trim() || name) : null,
        usage: unitName.get(st.usage_unit), buying: unitName.get(it.unit_id), counting: unitName.get(st.counting_unit),
        countingInUsage: st.counting_unit === st.usage_unit ? null : Number(st.per_counting_usage),
        buyingInCounting: it.unit_id === st.counting_unit ? null : Number(st.per_buying),
        low: st.low_stock === null ? null : Number(st.low_stock),
      };
      if (!payload.usage || !payload.buying || !payload.counting) return fail("A unit of this item no longer exists");
      const id = await insertOnce("stock_item_jobs", { client_key: b.clientKey, item_id: it.id, item_name: it.name, kind: b.kind,
        payload, created_by: actor });
      return json({ id }, 201);
    }
    if (req.method === "POST" && path[0] === "itemjobs" && path[1] === "cancel") {
      const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid task");
      const { data, error } = await db.from("stock_item_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", b.id).or(`status.in.(waiting,failed),and(status.eq.prepared,final_approved_at.is.null),and(status.eq.prepared,final_approved_at.lt.${new Date(Date.now() - 30 * 60_000).toISOString()})`).select("id");
      if (error) throw error;
      if (!data?.length) return fail("This task can no longer be cancelled");
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "itemjobs" && path[1] === "final-approve") {
      const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid task");
      const c = await controlStatus();
      if (!c.workerOnline || c.workerItemsLive !== true || c.workerPageReady !== true) return fail("The PC worker is not set up to save items yet (test mode), so it cannot press Save");
      const { error } = await db.rpc("stock_item_job_final_approve", { p_id: b.id, p_actor: actor });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "itemjobs" && path[1] === "resolve") {
      const b = await readBody(req);
      if (!uuid(b.id) || typeof b.saved !== "boolean") return fail("Invalid task");
      const { error } = await db.rpc("stock_item_job_resolve", { p_id: b.id, p_actor: actor, p_saved: b.saved, p_note: str(b.note, 900) });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "signin-check") {
      // Ask the PC to check that the workplace site is signed in (it signs in by itself if needed) and send a screenshot.
      const c = await controlStatus();
      if (!c.workerOnline) return fail("The PC worker is not running. Turn it on first.");
      const { error } = await db.from("stock_worker_control").upsert({ id: 1, signin_requested_at: new Date().toISOString(), signin_requested_by: actor });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "GET" && path[0] === "signin-shot") {
      const { data, error } = await db.from("stock_worker_control").select("signin_shot").eq("id", 1).maybeSingle();
      if (error) throw error;
      return json({ image: data?.signin_shot ?? null });
    }
    if (req.method === "POST" && path[0] === "start-worker") {
      const c = await controlStatus();
      if (c.workerOnline) return json({ ok: true, alreadyOn: true });
      // Always kept: if the office PC helper is away (PC off, asleep or signed out), it starts the worker as soon as it is back.
      const { error } = await db.from("stock_worker_control").upsert({ id: 1, start_requested_at: new Date().toISOString(), start_requested_by: actor });
      if (error) throw error;
      return json({ ok: true, queued: !c.launcherOnline });
    }
    if (req.method === "GET" && path[0] === "requests") return json(await requestsAndBalances());
    if (req.method === "GET" && path[0] === "shots") {
      const id = new URL(req.url).searchParams.get("id");
      if (!uuid(id)) return fail("Invalid request");
      const { data, error } = await db.from("stock_shots").select("kind,image,taken_at").eq("request_id", id).order("taken_at", { ascending: false });
      if (error) throw error;
      return json({ shots: (data ?? []).map((s: any) => ({ kind: s.kind, image: s.image, takenAt: s.taken_at })) });
    }
    if (req.method === "PUT" && path[0] === "tabs") {
      const b = await readBody(req);
      const allowed = actor === "rozha" ? SCREENS : SCREENS.filter((v) => v !== "devices" && v !== "settings");
      const tabs: string[] = Array.isArray(b.tabs) ? [...new Set<string>(b.tabs.map((v: unknown) => String(v)))] : [];
      if (tabs.length !== 3 || tabs.some((v) => !allowed.includes(v))) return fail("Choose three screens");
      const { error } = await db.from("stock_tabs").upsert({ account: actor, tabs, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "PUT" && path[0] === "settings" && path[1]) {
      const b = await readBody(req);
      const low = b.lowStock === "" || b.lowStock === null || b.lowStock === undefined ? null : b.lowStock;
      const per = b.perBuying === "" || b.perBuying === null || b.perBuying === undefined ? null : b.perBuying;
      const pu = b.perCountingUsage === "" || b.perCountingUsage === null || b.perCountingUsage === undefined ? null : b.perCountingUsage;
      if ((low !== null && !decimal(low)) || (per !== null && !decimal(per)) || ("usageUnit" in b && pu !== null && !decimal(pu))) return fail("Invalid number");
      const { error } = await db.rpc("stock_save_item_settings", { p_item: str(path[1], 80), p_actor: actor, p_counting: str(b.countingUnit, 80),
        p_per: per === null ? null : Number(per), p_low: low === null ? null : Number(low), p_workplace: str(b.workplaceName, 240) || null,
        p_usage: str(b.usageUnit, 80) || null, p_per_usage: pu === null ? null : Number(pu), p_save_usage: "usageUnit" in b });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "requests") {
      // One transfer holds 1 to 30 items between the same two storages. The older single-item shape still works.
      const b = await readBody(req);
      const raw = Array.isArray(b.lines) ? b.lines : [b];
      if (raw.length < 1 || raw.length > 30) return fail("A transfer can hold 1 to 30 items");
      const lines: any[] = [];
      for (const l of raw) {
        if (!l || typeof l !== "object" || !uuid(l.clientKey) || !str(l.itemId, 80) || !decimal(l.quantity) || Number(l.quantity) <= 0) return fail("Invalid transfer request");
        lines.push({ key: l.clientKey, item: str(l.itemId, 80), qty: Number(l.quantity), name: str(l.expectedName, 240),
          unit: str(l.expectedUnit, 80), unitId: l.unitId ? str(l.unitId, 80) : "" });
      }
      const { data, error } = await db.rpc("stock_submit_batch", { p_batch: crypto.randomUUID(), p_from: str(b.from, 80), p_to: str(b.to, 80),
        p_yesterday: b.yesterday === true, p_actor: actor, p_lines: lines });
      if (error) throw error;
      return json({ id: data[0], ids: data }, 201);
    }
    if (req.method === "POST" && path[0] === "cancel") {
      const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid request");
      const { error } = await db.rpc("stock_cancel", { p_id: b.id, p_actor: actor });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "final-approve") {
      const b = await readBody(req); if (!uuid(b.id)) return fail("Invalid request");
      const { error } = await db.rpc("stock_final_approve", { p_id: b.id, p_actor: actor });
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "counts") {
      const b = await readBody(req);
      if (!str(b.itemId, 80) || !decimal(b.quantity) || !b.countedAt || isNaN(Date.parse(b.countedAt))) return fail("Invalid count");
      const attempts = await reservePinAttempt(req);
      if (attempts === null) return fail("too_many_attempts", 429);
      const { data: good, error: pinError } = await db.rpc("app_internal_check_account_pin", { p_account: actor, p_pin: String(b.pin ?? "") });
      if (pinError) throw pinError;
      if (good !== true) return fail("wrong_pin", 403);   // 403, not 401: a wrong PIN must not look like an expired sign-in
      await completePinAttempt(attempts);
      const { data, error } = await db.rpc("stock_recount", { p_item: str(b.itemId, 80), p_storage: str(b.storage, 80), p_qty: Number(b.quantity),
        p_counted_at: new Date(b.countedAt).toISOString(), p_actor: actor, p_note: str(b.note, 500) });
      if (error) throw error;
      return json({ id: data }, 201);
    }
    if (req.method === "POST" && path[0] === "counts-bulk") {
      // Count many items in one go: one PIN check, then one recount per line. Lines are independent; failures are reported per line.
      const b = await readBody(req);
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!str(b.storage, 80) || !b.countedAt || isNaN(Date.parse(b.countedAt)) || lines.length < 1 || lines.length > 400) return fail("Invalid count");
      const attempts = await reservePinAttempt(req);
      if (attempts === null) return fail("too_many_attempts", 429);
      const { data: good, error: pinError } = await db.rpc("app_internal_check_account_pin", { p_account: actor, p_pin: String(b.pin ?? "") });
      if (pinError) throw pinError;
      if (good !== true) return fail("wrong_pin", 403);
      await completePinAttempt(attempts);
      const saved: string[] = [], failed: { itemId: string; error: string }[] = [];
      for (const l of lines) {
        const itemId = str(l?.itemId, 80);
        if (!itemId || !decimal(l?.quantity)) { failed.push({ itemId, error: "Invalid count" }); continue; }
        const { error } = await db.rpc("stock_recount", { p_item: itemId, p_storage: str(b.storage, 80), p_qty: Number(l.quantity),
          p_counted_at: new Date(b.countedAt).toISOString(), p_actor: actor, p_note: str(b.note, 500) });
        if (error) { console.error("stock-api bulk", errorText(error)); failed.push({ itemId, error: error.code === "P0001" ? errorText(error) : "Not saved" }); }
        else saved.push(itemId);
      }
      return json({ saved, failed }, 201);
    }
    if (req.method === "POST" && path[0] === "zones") {
      // Add, rename or remove a zone. The zone's name must match its name in the workplace system.
      const b = await readBody(req);
      let error;
      if (path[1] === "add") ({ error } = await db.rpc("stock_storage_add", { p_name: str(b.name, 60), p_actor: actor }));
      else if (path[1] === "rename") ({ error } = await db.rpc("stock_storage_rename", { p_old: str(b.from, 60), p_new: str(b.to, 60), p_actor: actor }));
      else if (path[1] === "delete") ({ error } = await db.rpc("stock_storage_delete", { p_name: str(b.name, 60), p_actor: actor }));
      else return fail("Unknown route", 404);
      if (error) throw error;
      return json({ ok: true });
    }
    if (req.method === "POST" && path[0] === "groups") {
      // Item groups (Stock screen filters). save = create (no id) or replace name + items; delete removes the group only.
      const b = await readBody(req);
      const ids = (v: unknown) => Array.isArray(v) ? v.slice(0, 1000).map((x) => str(x, 80)).filter(Boolean) : [];
      if ((b.id || path[1] === "delete") && !uuid(b.id)) return fail("Invalid group");
      if (path[1] === "save") {
        const { data, error } = await db.rpc("stock_group_save", { p_id: b.id ? String(b.id) : null, p_name: str(b.name, 60), p_items: ids(b.itemIds), p_actor: actor });
        if (error) throw error;
        return json({ ok: true, id: data });
      }
      if (path[1] === "delete") {
        // Only the group goes; items and stock are untouched.
        const { data, error } = await db.from("stock_groups").delete().eq("id", String(b.id)).select("id,name");
        if (error) throw error;
        if (!data?.length) return fail("Group not found", 404);
        await db.from("stock_events").insert({ actor, action: "group_deleted", details: { group_id: data[0].id, name: data[0].name } });
        return json({ ok: true });
      }
      return fail("Unknown route", 404);
    }
    if (req.method === "POST" && path[0] === "resolve") {
      const b = await readBody(req);
      if (!uuid(b.id) || !["completed", "failed"].includes(b.status) || str(b.note, 900).length < 10) return fail("Check the workplace history and write a note of at least 10 characters");
      if (b.status === "completed" && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.recordedDate || ""))) return fail("Enter the verified workplace recorded date");
      const { error } = await db.rpc("stock_resolve", { p_id: b.id, p_actor: actor, p_status: b.status, p_note: str(b.note, 900), p_recorded_date: b.status === "completed" ? b.recordedDate : null });
      if (error) throw error;
      return json({ ok: true });
    }
    return fail("Unknown route", 404);
  } catch (e: any) {
    if (e instanceof BodyTooLarge) return fail("Request too large", 413);
    if (e instanceof InvalidBody) return fail("Invalid JSON object", 400);
    // Messages raised on purpose by our own database functions (SQLSTATE P0001) are safe to show; anything else is not.
    console.error("stock-api", errorText(e));
    return fail(e?.code === "P0001" ? errorText(e) : "Operation failed; try again", 400);
  }
});
