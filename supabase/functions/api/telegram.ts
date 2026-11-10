// Ricotta Helper on Telegram: Rico's own bot, for Rozh only.
//
// It answers only the chat linked from Settings > Connect Telegram (a one-time code in the link);
// everyone else gets one line saying the bot is private. It sends:
//   - Rico's photo of a filled-in receipt, with Approve and Cancel buttons
//   - the saved receipt with its finance number and photos, or the reason Rico stopped
//   - "the Mac is off" when a receipt waits for Rico
// and makes receipts step by step: supplier, invoice, currency (and rate), delivery, then items
// (search, unit, quantity, unit cost), then send. The same rules as the app (receipts.ts) apply.
//
// The bot token is the TELEGRAM_BOT_TOKEN secret. Telegram's calls to us carry a secret header made
// from it, so nobody else can pretend to be Telegram.
import "../_shared/search.js";
import "../_shared/receipts.js";
import { approveTransfer, cancelTransfer, erbilDay, onTransferEvent, sendTransfer, transferPhotoLinks } from "./transfers.ts";
import { approveReceipt, cancelReceipt, catalogOf, helperRow, helperView, onLaunchEvent, onReceiptEvent, onShot, photoLinks, requestShot, ricoCommand, ricoEvents, sendReceipt } from "./receipts.ts";

const R = (globalThis as any).RicottaReceipts;
/* A unit as Ricotta Restaurant shows it: the size written "(×1000)" (the value stays "(1000×)"). */
const unitShow = (label: unknown) => String(label ?? "").replace(/\(\s*([\d.,]+)\s*×\s*\)/, "(×$1)");
const S = (globalThis as any).RicottaSearch;
const TOKEN = () => Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const db = (d: any, table: string) => d.from(`app_tg_${table}`);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n: number, d = 0) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: d });
const money = (n: number, cur: string) => (cur === "USD" ? "$" + num(n, 3) : "IQD " + num(n, 3));

async function sha(v: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const webhookSecret = async () => (await sha("ricotta-telegram:" + TOKEN())).slice(0, 48);
export const telegramReady = () => TOKEN().length > 20;

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) console.error("telegram", method, res.status, data?.description);
  return data?.result ?? null;
}
async function chatOf(d: any, account = "rozha") {
  const { data } = await db(d, "links").select("chat_id").eq("account", account).maybeSingle();
  return data?.chat_id ?? null;
}
async function stateOf(d: any, chat: number) {
  const { data } = await db(d, "state").select("data").eq("chat_id", chat).maybeSingle();
  return data?.data ?? {};
}
const saveState = (d: any, chat: number, data: any) => db(d, "state").upsert({ chat_id: chat, data, updated_at: new Date().toISOString() });
const say = (chat: number, text: string, buttons?: { text: string; data: string }[][]) =>
  tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}) });
const MENU = [[{ text: "New receipt", data: "n" }, { text: "New transfer", data: "nt" }], [{ text: "Rico on the Mac", data: "rico" }, { text: "What is Rico doing?", data: "rw" }]];

/* ---------- Settings > Connect Telegram ---------- */
export async function telegramLink(d: any, account: string, apiUrl: string) {
  if (!telegramReady()) return { error: "telegram_not_set_up" };
  const me = await tg("getMe", {});
  if (!me?.username) return { error: "telegram_unreachable" };
  await tg("setWebhook", { url: `${apiUrl}/telegram/webhook`, secret_token: await webhookSecret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  const code = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  await db(d, "codes").insert({ code, account, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
  return { link: `https://t.me/${me.username}?start=${code}`, bot: me.username };
}
/* Rico's evening check (asked for by Rico on the Mac after 22:00 Erbil, once a day): today's receipts
   and transfers, whether each was confirmed in Ricotta Restaurant's own record, and anything that
   stopped or still waits, so nothing wrong goes unnoticed. */
export async function dailySummary(d: any) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data: h } = await d.from("app_rr_helper").select("summary_day").eq("id", true).maybeSingle();
  if (h?.summary_day === day) return { sent: false, already: true };
  if (!telegramReady()) return { sent: false };
  const chat = await chatOf(d);
  if (!chat) return { sent: false };
  const since = new Date(`${day}T00:00:00+03:00`).toISOString();
  const [{ data: recs }, { data: moves }] = await Promise.all([
    d.from("app_rr_receipts").select("status,supplier,invoice,total,currency,rate,finance,mode,problem").gte("updated_at", since).in("status", ["saved", "problem", "review", "queued", "filling", "approved", "saving"]),
    d.from("app_rr_transfers").select("status,from_zone,to_zone,lines,result,mode,problem").gte("updated_at", since).in("status", ["moved", "problem", "review", "queued", "filling", "approved", "moving"]),
  ]);
  const real = (x: any) => x.mode !== "practice" && !/^Practice run/.test(x.problem ?? "");
  const r = (recs ?? []).filter(real), t = (moves ?? []).filter(real);
  const saved = r.filter((x: any) => x.status === "saved"), moved = t.filter((x: any) => x.status === "moved");
  const iqd = saved.reduce((s: number, x: any) => s + (x.currency === "USD" ? Math.round(Number(x.total) * Number(x.rate || 0)) : Number(x.total || 0)), 0);
  const check = [
    ...saved.filter((x: any) => x.finance?.checked === false).map((x: any) => `Receipt ${esc(x.supplier)} #${esc(x.invoice ?? "")}: not found in the stock record`),
    ...moved.filter((x: any) => x.result?.checked === false).map((x: any) => `Transfer ${esc(x.from_zone)} → ${esc(x.to_zone)}: ${esc(x.result?.note ?? "not confirmed")}`),
    ...r.filter((x: any) => x.status === "problem").map((x: any) => `Receipt ${esc(x.supplier)} #${esc(x.invoice ?? "")} stopped`),
    ...t.filter((x: any) => x.status === "problem").map((x: any) => `Transfer ${esc(x.from_zone)} → ${esc(x.to_zone)} stopped`),
    ...[...r, ...t].filter((x: any) => !["saved", "moved", "problem"].includes(x.status)).map((x: any) => `${x.supplier ? "Receipt " + esc(x.supplier) : "Transfer " + esc(x.from_zone) + " → " + esc(x.to_zone)}: still ${x.status === "review" ? "waiting for approval" : "on its way"}`),
  ];
  const head = `<b>Today with Rico</b>\n${saved.length} receipt(s) saved, IQD ${num(iqd)}\n${moved.length} transfer(s) moved, ${moved.reduce((n: number, x: any) => n + (x.lines ?? []).length, 0)} item(s)`;
  await say(chat, head + "\n\n" + (check.length ? "Check these:\n" + check.slice(0, 20).map((c) => "• " + c).join("\n") : "Everything was confirmed in Ricotta Restaurant's record."));
  await d.from("app_rr_helper").update({ summary_day: day }).eq("id", true);
  return { sent: true };
}
export async function telegramStatus(d: any, account = "rozha") {
  return { ready: telegramReady(), connected: !!(await chatOf(d, account)) };
}

/* ---------- Telegram calls us ---------- */
export async function telegramWebhook(d: any, req: Request, update: any) {
  // Compared as hashes, so the secret's length or first letters never leak through timing.
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!telegramReady() || !given || given.length > 256 || (await sha(given)) !== (await sha(await webhookSecret()))) return false;
  const msg = update.message, cb = update.callback_query;
  const chat = Number(msg?.chat?.id ?? cb?.message?.chat?.id);
  if (!Number.isSafeInteger(chat)) return true;
  const { data: link } = await db(d, "links").select("account").eq("chat_id", chat).maybeSingle();
  const text = String(msg?.text ?? "").trim();
  // Linking: /start <one-time code from Settings>.
  const start = text.match(/^\/start(?:\s+([A-Za-z0-9]{16,40}))?$/);
  if (start?.[1]) {
    const { data: c } = await db(d, "codes").select("account,expires_at").eq("code", start[1]).maybeSingle();
    if (!c || Date.parse(c.expires_at) < Date.now()) { await say(chat, "This link has expired. Open Settings in Ricotta Orders and tap Connect Telegram again."); return true; }
    await db(d, "codes").delete().eq("code", start[1]);
    await db(d, "links").delete().eq("chat_id", chat);
    await db(d, "links").upsert({ account: c.account, chat_id: chat, linked_at: new Date().toISOString() });
    await say(chat, "Hi, I'm Rico. This chat is now linked to Ricotta Orders.\n\nI'll send you each receipt to approve, and tell you when it's saved. You can also make a receipt here.", MENU);
    return true;
  }
  if (!link) { if (msg) await say(chat, "This bot is private."); return true; }
  const who = link.account;
  if (cb) { await onButton(d, chat, who, cb); return true; }
  if (/^\/new$/.test(text)) return (await startDraft(d, chat), true);
  if (/^\/start$/.test(text)) return (await help(chat), true);
  if (/^\/(rico_on|on)$/.test(text)) return (await typed(d, chat, who, "rico on"), true);
  if (/^\/rico$/.test(text)) return (await ricoPanel(d, chat), true);
  if (/^\/(doing|status)$/.test(text)) return (await ricoDoing(d, chat), true);
  if (/^\/(shot|screenshot)$/.test(text)) return (await ricoShot(d, chat), true);
  if (/^\/(transfer|newtransfer)$/.test(text)) return (await tStart(d, chat, who), true);
  if (/^\/cancel$/.test(text)) { const st = await stateOf(d, chat); delete st.draft; delete st.tdraft; await saveState(d, chat, st); await say(chat, "Stopped. Nothing was sent.", MENU); return true; }
  if (/^\/(receipts|today)$/.test(text)) return (await receiptsNow(d, chat), true);
  if (/^\/help$/.test(text)) return (await help(chat), true);
  if (text && await typed(d, chat, who, text)) return true;
  if (text) await onText(d, chat, who, text);
  return true;
}

/* ---------- Typing instead of tapping ----------
   Short plain words do what the buttons do: "rico on", "practice", "rico off", "status", "screenshot",
   "receipts", "new receipt bread house" (starts one and searches the supplier). While a receipt is being
   made, only "cancel" is read this way, so names typed as answers are never taken for commands. */
let commandsSet = false;
function intentOf(text: string) {
  const s = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").replace(/\b(please|pls|plz|now)\b/g, "").trim();
  const w = new Set(s.split(" "));
  const rico = w.has("rico") || w.has("ریکۆ") || w.has("helper");
  if (/^(new transfer|transfer|transfers|move stock|make (a )?transfer|گواستنەوە|گواستنەوەی نوێ)$/.test(s)) return { do: "transfer" };
  const m = s.match(/^(?:new receipt|new|receipt|make (?:a )?receipt|وەسڵی نوێ|وەسڵ)(?: (.+))?$/);
  if (m) return { do: "new", rest: m[1] ?? "" };
  if (/^(help|menu|hi|hello|hey|commands|what can you do|سڵاو)$/.test(s)) return { do: "help" };
  if (/screen ?shot|^(shot|ss|screen|show me|show screen|see screen|photo|picture)$/.test(s)) return { do: "shot" };
  if (/^(receipts|waiting|pending|today|list|approve|to approve|what s waiting)$/.test(s)) return { do: "receipts" };
  if ((rico || w.has("start") || w.has("on") || w.has("mode")) && (w.has("practice") || w.has("test") || w.has("تاقیکردنەوە"))) return { do: "practice" };
  if (/^(practice|practice mode|test mode|test)$/.test(s)) return { do: "practice" };
  if ((rico && (w.has("off") || w.has("stop") || w.has("close"))) || /^(stop|stop rico|rico off|off|turn off|shut down)$/.test(s)) return { do: "stop" };
  if ((rico || w.has("start")) && (w.has("real") || w.has("for real"))) return { do: "real" };
  if ((rico && (w.has("on") || w.has("start") || w.has("open"))) || /^(start|on|turn on|start rico|rico on)$/.test(s)) return { do: "ask" };
  if (/^(status|doing|what s rico doing|whats rico doing|what is rico doing|where is rico|rico|is rico on|rico status|busy)$/.test(s) || (rico && (w.has("doing") || w.has("status")))) return { do: "doing" };
  return null;
}
async function typed(d: any, chat: number, who: string, text: string) {
  if (!commandsSet) {
    commandsSet = true;
    await tg("setMyCommands", { commands: [
      { command: "new", description: "New receipt" }, { command: "transfer", description: "New transfer between storages" }, { command: "rico", description: "Start or stop Rico on the Mac" },
      { command: "status", description: "What Rico is doing" }, { command: "shot", description: "Live screenshot of Rico's screen" },
      { command: "receipts", description: "Receipts waiting and saved today" }, { command: "cancel", description: "Stop the receipt being made" },
      { command: "help", description: "What you can type" }] });
  }
  const st = await stateOf(d, chat);
  if (st.draft || st.tdraft) {
    if (/^(cancel|stop|never ?mind|quit|exit)$/i.test(text.trim())) { delete st.draft; delete st.tdraft; await saveState(d, chat, st); await say(chat, "Stopped. Nothing was sent.", MENU); return true; }
    return false;
  }
  const i = intentOf(text);
  if (!i) {
    // A supplier's name on its own starts a receipt from that supplier.
    if (text.trim().length >= 3 && S.rank((await catalogOf(d)).suppliers, text, (x: string) => x).length) { await startDraft(d, chat); await onText(d, chat, who, text); return true; }
    await say(chat, "I didn't get that. " + HELP_SHORT, MENU); return true;
  }
  if (i.do === "transfer") { await tStart(d, chat, who); return true; }
  if (i.do === "new") { await startDraft(d, chat); if (i.rest) await onText(d, chat, who, i.rest); return true; }
  if (i.do === "help") { await help(chat); return true; }
  if (i.do === "shot") { await ricoShot(d, chat); return true; }
  if (i.do === "doing") { await ricoDoing(d, chat); return true; }
  if (i.do === "receipts") { await receiptsNow(d, chat); return true; }
  if (i.do === "ask") {
    const h = helperView(await helperRow(d));
    if (h.online) await say(chat, `Rico is already on${h.mode === "practice" ? " in practice mode" : ""}.`, [[{ text: "Stop Rico", data: "rc:stop" }, { text: "What is he doing?", data: "rw" }]]);
    else await say(chat, "Which mode?", [[{ text: "Real (saves receipts)", data: "rc:real" }], [{ text: "Practice (nothing is saved)", data: "rc:practice" }]]);
    return true;
  }
  await ricoCmd(d, chat, who, i.do);
  return true;
}
const HELP_SHORT = "You can type: new receipt, rico on, practice, rico off, status, screenshot, receipts.";
async function help(chat: number) {
  await say(chat, [
    "<b>Type any of these</b> (or tap the buttons):",
    "• <b>new receipt</b>: start one. Add the supplier to skip a step: <i>new receipt bread house</i>",
    "• <b>rico on</b>: start Rico (I ask which mode)",
    "• <b>practice</b>: start Rico in practice mode, nothing is saved",
    "• <b>rico off</b>: stop Rico",
    "• <b>status</b>: what Rico is doing right now",
    "• <b>screenshot</b>: a live picture of Rico's screen",
    "• <b>receipts</b>: what is waiting for you and what was saved today",
    "• <b>cancel</b>: stop the receipt you are making",
  ].join("\n"), MENU);
}
/* What is waiting for approval (with the buttons), what is in line, and what was saved today. */
async function receiptsNow(d: any, chat: number) {
  const since = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data } = await d.from("app_rr_receipts").select("id,status,supplier,invoice,total,currency,mode,problem,saved_at,finance").gte("created_at", since).neq("status", "draft").order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
  const today = day(new Date().toISOString());
  const review = rows.filter((r: any) => r.status === "review");
  const queued = rows.filter((r: any) => ["queued", "filling", "approved", "saving"].includes(r.status));
  const saved = rows.filter((r: any) => r.status === "saved" && r.saved_at && day(r.saved_at) === today);
  const stopped = rows.filter((r: any) => r.status === "problem" && r.mode !== "practice" && !/^Practice run/.test(r.problem ?? ""));
  const line = (r: any) => `<b>${esc(r.supplier)}</b> #${esc(r.invoice)} · ${money(Number(r.total), r.currency)}`;
  if (!review.length && !queued.length && !saved.length && !stopped.length) { await say(chat, "Nothing waiting, and nothing saved today yet.", MENU); return; }
  if (review.length) for (const r of review.slice(0, 5)) await say(chat, `Waiting for you: ${line(r)}`, [[{ text: "Approve and save", data: "ap:" + r.id }, { text: "Cancel", data: "cx:" + r.id }]]);
  const parts = [];
  if (queued.length) parts.push(`<b>With Rico (${queued.length})</b>\n` + queued.map(line).join("\n"));
  if (stopped.length) parts.push(`<b>Stopped (${stopped.length})</b>, see the app\n` + stopped.map(line).join("\n"));
  if (saved.length) parts.push(`<b>Saved today (${saved.length})</b>\n` + saved.map((r: any) => line(r) + (r.finance?.tab ? ` · ${esc(r.finance.tab)}` : "")).join("\n"));
  if (parts.length) await say(chat, parts.join("\n\n"), MENU);
}

/* ---------- Lists to tap (typing a few letters still searches) ---------- */
const PAGE = 10;
/* One page of names as buttons (two a row), with Back / Next. The names on the screen are kept in the
   chat's state, so a tap picks exactly the name it showed. */
async function showList(d: any, chat: number, st: any, kind: "s" | "i" | "u", page: number, names: string[], title: string) {
  const pages = Math.max(1, Math.ceil(names.length / PAGE)), p = Math.min(Math.max(0, page), pages - 1);
  const shown = names.slice(p * PAGE, p * PAGE + PAGE);
  st.opts = shown;
  await saveState(d, chat, st);
  const pick = kind === "s" ? "s:" : "i:";
  const rows: { text: string; data: string }[][] = [];
  shown.forEach((n, k) => { const b = { text: n.length > 30 ? n.slice(0, 29) + "…" : n, data: pick + k }; if (k % 2 === 0) rows.push([b]); else rows[rows.length - 1].push(b); });
  const nav = [];
  if (p > 0) nav.push({ text: "‹ Back", data: `pg:${kind}:${p - 1}` });
  if (p < pages - 1) nav.push({ text: `Next › (${p + 2}/${pages})`, data: `pg:${kind}:${p + 1}` });
  if (nav.length) rows.push(nav);
  if (kind === "u") rows.push([{ text: "All items", data: "pg:i:0" }]);
  await say(chat, title, rows);
}
const supplierNames = (cat: any) => [...cat.suppliers].sort((a: string, b: string) => a.localeCompare(b));
const itemNames = (cat: any) => cat.items.map((i: any) => i.name).sort((a: string, b: string) => a.localeCompare(b));
/* What was bought from this supplier before, most often first. */
async function usualItems(d: any, supplier: string, cat: any) {
  const { data } = await d.from("app_rr_receipts").select("lines").eq("supplier", supplier).not("status", "in", "(draft,cancelled)").order("created_at", { ascending: false }).limit(40);
  const count = new Map<string, number>(), known = new Set(cat.items.map((i: any) => i.name));
  for (const r of data ?? []) for (const l of r.lines ?? []) if (known.has(l.item)) count.set(l.item, (count.get(l.item) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}
async function askItem(d: any, chat: number, st: any, cat: any, first: boolean) {
  const dr = st.draft, usual = await usualItems(d, dr.supplier, cat), n = dr.lines.length + 1;
  const lead = first ? "Now the items." : `Item ${n}.`;
  if (usual.length) await showList(d, chat, st, "u", 0, usual, `${lead} Usually from ${esc(dr.supplier)}, or tap All items. You can also type a few letters.`);
  else await showList(d, chat, st, "i", 0, itemNames(cat), `${lead} Pick one, or type a few letters to search.`);
}

/* ---------- Making a receipt, step by step ---------- */
async function startDraft(d: any, chat: number) {
  const st = await stateOf(d, chat);
  delete st.tdraft;
  st.draft = { step: "supplier", supplier: null, invoice: null, zone: "Main Storage", currency: "IQD", rate: null, delivery: null, lines: [], cur: null };
  await showList(d, chat, st, "s", 0, supplierNames(await catalogOf(d)), "New receipt. Which supplier? Pick one, or type a few letters to search.\n\nSend /cancel to stop at any time.");
}
const digitsOf = (s: string) => s.replace(/[٠-٩]/g, (x) => String(x.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (x) => String(x.charCodeAt(0) - 0x6f0)).replace(/[,\s]/g, "");
async function onText(d: any, chat: number, who: string, text: string) {
  const st = await stateOf(d, chat), dr = st.draft;
  if (st.tdraft) return tText(d, chat, who, text, st);
  if (!dr) { await say(chat, "Tap New receipt to make one.", MENU); return; }
  const cat = await catalogOf(d);
  if (dr.step === "supplier" || dr.step === "item") {
    const pool = dr.step === "supplier" ? cat.suppliers : cat.items.map((i: any) => i.name);
    const found = S.rank(pool, text, (x: string) => x).slice(0, 8);
    if (!found.length) { await say(chat, `Nothing matches "${esc(text)}". Try other letters.`); return; }
    st.opts = found;
    await saveState(d, chat, st);
    await say(chat, dr.step === "supplier" ? "Which one?" : "Which item?", found.map((n: string, k: number) => [{ text: n.slice(0, 60), data: (dr.step === "supplier" ? "s:" : "i:") + k }]));
    return;
  }
  const v = digitsOf(text);
  if (dr.step === "invoice") {
    if (!/^\d{1,30}$/.test(v)) { await say(chat, "Numbers only, please. What is the invoice number?"); return; }
    dr.invoice = v; dr.step = "currency";
    await saveState(d, chat, st);
    await say(chat, `Invoice <b>${esc(v)}</b>. Which currency?`, [[{ text: "IQD", data: "c:IQD" }, { text: "USD $", data: "c:USD" }]]);
    return;
  }
  if (dr.step === "rate") {
    if (!/^\d+(\.\d{1,3})?$/.test(v)) { await say(chat, "Type the rate as a number, for example 1500 or 1678.571."); return; }
    dr.rate = Number(v); dr.step = "item";
    await say(chat, `$1 = ${esc(v)} IQD.`);
    await askItem(d, chat, st, cat, true);
    return;
  }
  if (dr.step === "delivery") {
    if (!/^\d+$/.test(v)) { await say(chat, "Type the delivery fee as a whole number, or 0 for none."); return; }
    dr.delivery = Number(v) || null; dr.step = "item";
    await say(chat, dr.delivery ? "Delivery " + num(dr.delivery) + "." : "No delivery.");
    await askItem(d, chat, st, cat, true);
    return;
  }
  if (dr.step === "qty") {
    if (!/^\d+(\.\d{1,3})?$/.test(v) || Number(v) <= 0) { await say(chat, "Type the quantity as a number, for example 4 or 2.5."); return; }
    dr.cur.qty = Number(v); dr.step = "cost";
    await saveState(d, chat, st);
    await say(chat, `Unit cost for one ${esc(unitShow(dr.cur.unit))}, in ${dr.currency === "USD" ? "dollars" : "IQD"}? (Commas are fine, and a dot for decimals: 1,250.5)`);
    return;
  }
  if (dr.step === "cost") {
    if (!/^\d+(\.\d{1,3})?$/.test(v) || Number(v) <= 0) { await say(chat, `Type the unit cost as a number${dr.currency === "USD" ? " of dollars" : ""}, for example 12,500 or 1,250.5.`); return; }
    dr.cur.cost = Number(v); dr.lines.push(dr.cur); dr.cur = null; dr.step = "more";
    await saveState(d, chat, st);
    await showDraft(chat, dr);
    return;
  }
  await say(chat, "Use the buttons above, or send /cancel to stop.");
}
function draftText(dr: any) {
  const t = R.totals(dr);
  const lines = dr.lines.map((l: any, i: number) => `${i + 1}. ${esc(l.item)}\n    ${num(l.qty, 3)} × ${esc(unitShow(l.unit))} · ${money(l.cost, dr.currency)} = <b>${money(R.lineTotal(l, dr.currency), dr.currency)}</b>`).join("\n");
  return `<b>${esc(dr.supplier)}</b> · invoice ${esc(dr.invoice)} · ${esc(dr.zone)}\n${dr.currency === "USD" ? `USD, $1 = ${num(dr.rate, 3)} IQD` : dr.delivery ? `Delivery ${num(dr.delivery)}` : "No delivery"}\n\n${lines}\n\nTotal <b>${money(t.total, dr.currency)}</b>${dr.currency === "USD" ? ` = IQD ${num(t.iqd)}` : ""}`;
}
const showDraft = (chat: number, dr: any) => say(chat, draftText(dr), [[{ text: "Add item", data: "a" }, { text: "Send to Rico", data: "send" }], [{ text: "Remove last item", data: "undo" }, { text: "Cancel", data: "x" }]]);

const WARN: Record<string, (w: any) => string> = {
  priceJump: (w) => `Item ${w.line}: price ${w.pct > 0 ? "up" : "down"} ${Math.abs(w.pct)}% (last time ${num(w.before)})`,
  duplicate: (w) => `Item ${w.line} is the same item as item ${w.first}`,
  pressed: () => "Rico already pressed Save for this receipt (or one with the same invoice). Check Invoices in Ricotta Restaurant first: send it only if it is not there.",
  tinyUnit: (w) => `Item ${w.line}: this unit counts as only 1 gram or piece`,
  qtyHigh: (w) => `Item ${w.line}: ${num(w.times, 1)} times the usual delivery (usually about ${num(w.usual, 3)} ${esc(w.unit)}). A typo?`,
  qtyLow: (w) => `Item ${w.line}: far less than usual (usually about ${num(w.usual, 3)} ${esc(w.unit)}). A typo?`,
  rateOdd: (w) => `The dollar rate is outside ${w.min} to ${w.max}`,
  bigTotal: (w) => `A big receipt: IQD ${num(w.iqd)}`,
  unitNameOdd: (w) => `Item ${w.line}: the unit "${esc(w.unit)}" counts as ${num(w.factor)} ${esc(w.base)}. Its name doesn't match its size; check it's the unit you meant`,
  gramPrice: (w) => `Item ${w.line}: ${money(w.cost, w.currency)} per ${esc(w.unit)} is far too expensive or odd. Are you sure?`,
  unitPriceOdd: (w) => `Item ${w.line}: ${num(w.times, 1)} times ${w.more ? "more" : "less"} per ${esc(w.base)} than last time. Check the unit`,
};
async function onButton(d: any, chat: number, who: string, cb: any) {
  const data = String(cb.data ?? "");
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  const tact = data.match(/^(tap|tapy|tcx):([0-9a-f-]{36})$/);
  if (tact) return tApprove(d, chat, who, tact[1], tact[2], cb);
  if (/^(nt|tx|ta|tundo|ty|tyy|tyn|tsend|tsendok|tp:\d+|tz:\d+|ti:\d+|tu:\d+)$/.test(data)) return tButton(d, chat, who, data, cb);
  // Approve or cancel a receipt Rico filled in.
  const act = data.match(/^(ap|apy|cx):([0-9a-f-]{36})$/);
  if (act) {
    const { data: r } = await d.from("app_rr_receipts").select("*").eq("id", act[2]).maybeSingle();
    if (!r) { await say(chat, "That receipt is no longer here."); return; }
    // A receipt with anything unusual (or a big one) is asked about once more before Rico saves it.
    if (act[1] === "ap" && ((r.warnings ?? []).length || Number(r.total) >= (await helperView(await helperRow(d))).limits.bigTotal)) {
      const ws = (r.warnings ?? []).map((w: any) => "• " + (WARN[w.code]?.(w) ?? w.code)).join("\n");
      await say(chat, `Are you sure? <b>${esc(r.supplier)}</b> #${esc(r.invoice)}, ${money(Number(r.total), r.currency)}${ws ? "\n\n" + ws : ""}`,
        [[{ text: "Yes, approve and save", data: "apy:" + r.id }, { text: "Cancel receipt", data: "cx:" + r.id }]]);
      return;
    }
    if (act[1] === "apy") act[1] = "ap";
    const res = act[1] === "ap" ? await approveReceipt(d, r, who) : await cancelReceipt(d, r, who);
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await say(chat, res.error ? (res.error === "too_late" ? "Too late: Rico already saved it." : res.error === "not_waiting" ? "This receipt isn't waiting for approval any more." : "That didn't work. Try in the app.")
      : act[1] === "ap" ? `Approved. Rico is saving <b>${esc(r.supplier)}</b> #${esc(r.invoice)} now.` : `Cancelled. Rico discards it; nothing was saved.`);
    return;
  }
  if (data === "n") return startDraft(d, chat);
  if (data === "rico") return ricoPanel(d, chat);
  if (data === "rw") return ricoDoing(d, chat);
  if (data === "rs") return ricoShot(d, chat);
  const rc = data.match(/^rc:(real|practice|stop)$/);
  if (rc) return ricoCmd(d, chat, who, rc[1]);
  const st = await stateOf(d, chat), dr = st.draft;
  if (!dr) { await say(chat, "That receipt was finished or stopped. Tap New receipt to make one.", MENU); return; }
  const cat = await catalogOf(d);
  const pg = data.match(/^pg:([siu]):(\d+)$/);
  if (pg) {
    const page = Number(pg[2]);
    if (pg[1] === "s" && dr.step === "supplier") await showList(d, chat, st, "s", page, supplierNames(cat), "Which supplier?");
    if (pg[1] === "i" && dr.step === "item") await showList(d, chat, st, "i", page, itemNames(cat), "All items, A to Z:");
    if (pg[1] === "u" && dr.step === "item") await showList(d, chat, st, "u", page, await usualItems(d, dr.supplier, cat), "Usually from this supplier:");
    return;
  }
  const pick = data.match(/^([siuc]):(.+)$/);
  if (pick?.[1] === "s" && dr.step === "supplier") {
    dr.supplier = st.opts?.[Number(pick[2])]; if (!dr.supplier) return;
    dr.step = "invoice";
    await saveState(d, chat, st);
    await say(chat, `<b>${esc(dr.supplier)}</b>. What is the invoice number?`);
    return;
  }
  if (pick?.[1] === "c" && dr.step === "currency") {
    dr.currency = pick[2] === "USD" ? "USD" : "IQD";
    dr.step = dr.currency === "USD" ? "rate" : "delivery";
    await saveState(d, chat, st);
    await say(chat, dr.currency === "USD" ? "USD. $1 = how many IQD?" : "IQD. Delivery fee? Type it, or tap No delivery.", dr.currency === "USD" ? undefined : [[{ text: "No delivery", data: "d0" }]]);
    return;
  }
  if (data === "d0" && dr.step === "delivery") {
    dr.delivery = null; dr.step = "item";
    await say(chat, "No delivery.");
    await askItem(d, chat, st, cat, true);
    return;
  }
  if (pick?.[1] === "i" && dr.step === "item") {
    const name = st.opts?.[Number(pick[2])], item = cat.items.find((i: any) => i.name === name);
    if (!item) return;
    const units = R.unitOptions(item);
    dr.cur = { item: name, unit: null, qty: null, cost: null }; dr.step = "unit"; st.opts = units.map((u: any) => u.label);
    await saveState(d, chat, st);
    await say(chat, `<b>${esc(name)}</b>. Which unit?`, units.map((u: any, k: number) => [{ text: unitShow(u.label), data: "u:" + k }]));
    return;
  }
  if (pick?.[1] === "u" && dr.step === "unit") {
    dr.cur.unit = st.opts?.[Number(pick[2])]; if (!dr.cur.unit) return;
    dr.step = "qty";
    await saveState(d, chat, st);
    await say(chat, `How many ${esc(unitShow(dr.cur.unit))}?`);
    return;
  }
  if (data === "a" && dr.step === "more") { dr.step = "item"; await askItem(d, chat, st, cat, false); return; }
  if (data === "undo" && dr.step === "more") { dr.lines.pop(); if (!dr.lines.length) dr.step = "item"; await saveState(d, chat, st); if (dr.lines.length) await showDraft(chat, dr); else await askItem(d, chat, st, cat, true); return; }
  if (data === "x") { delete st.draft; await saveState(d, chat, st); await say(chat, "Stopped. Nothing was sent.", MENU); return; }
  if ((data === "send" || data === "sendok") && dr.step === "more") {
    const row = { id: dr.id || crypto.randomUUID(), created_by: who, source: "telegram", status: "draft", supplier: dr.supplier, invoice: dr.invoice, zone: dr.zone,
      currency: dr.currency, rate: dr.currency === "USD" ? dr.rate : null, delivery: dr.currency === "USD" ? null : dr.delivery, lines: dr.lines };
    dr.id = row.id;
    const { data: saved, error } = await d.from("app_rr_receipts").upsert(row).select("*").maybeSingle();
    if (error || !saved) { await say(chat, "That didn't save. Try again in a moment."); return; }
    const res = await sendReceipt(d, saved, who, data === "sendok" ? (dr.confirm ?? []) : [], "telegram");
    if (res.error === "needs_confirmation") {
      const ws = (res.extra?.warnings as any[]) ?? [];
      dr.confirm = [...new Set(ws.map((w) => w.code))];
      await saveState(d, chat, st);
      await say(chat, "Check these first:\n\n" + ws.map((w) => "• " + (WARN[w.code]?.(w) ?? w.code)).join("\n"), [[{ text: "They're right, send", data: "sendok" }, { text: "Cancel", data: "x" }]]);
      return;
    }
    if (res.error) {
      const errs = ((res.extra?.errors as any[]) ?? []).map((e) => (e.line ? `Item ${e.line}: ` : "") + e.code).join(", ");
      await say(chat, res.error === "invoice_already_sent" ? "This invoice from this supplier was already sent." : `That can't be sent yet${errs ? ": " + esc(errs) : ""}.`);
      return;
    }
    delete st.draft; await saveState(d, chat, st);
    await say(chat, `Sent to Rico: <b>${esc(dr.supplier)}</b> #${esc(dr.invoice)}, ${money(R.totals(dr).total, dr.currency)}. I'll send you the photo to check.`, MENU);
  }
}

/* ---------- Rico on the Mac: start (real or practice) and stop ---------- */
async function ricoPanel(d: any, chat: number) {
  const h = helperView(await helperRow(d));
  const state = h.online ? `Rico is on${h.mode === "practice" ? " in practice mode (nothing is saved)" : ""}${h.signedIn ? ", signed in to Ricotta Restaurant" : ""}.`
    : h.launcher.online ? "Rico is off. The Mac is on, so you can start him." : "The Mac is off, or Rico's launcher isn't set up on it.";
  await say(chat, state, [[{ text: "Start Rico", data: "rc:real" }, { text: "Practice mode", data: "rc:practice" }], [{ text: "Stop Rico", data: "rc:stop" }],
    [{ text: "What is Rico doing?", data: "rw" }, { text: "Live screenshot", data: "rs" }]]);
}
const STEP: Record<string, string> = { queued: "sent to Rico", filling: "filling in", review: "photo ready to check", approved: "approved", saving: "saving",
  saved: "saved", problem: "stopped", cancelled: "cancelled" };
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "Asia/Baghdad", hour: "numeric", minute: "2-digit" });
function eventLine(e: any) {
  const who = e.by === "rozha" ? "Rozh" : e.by === "yunis" ? "Yunis" : e.by === "telegram" ? "Telegram" : e.by === "auto" ? "himself" : null;
  if (e.kind === "command") return `${timeOf(e.at)} ${e.status === "stop" ? "Stop" : e.status === "practice" ? "Practice mode" : "Start"} pressed${who ? " on " + who : ""}`;
  if (e.kind === "launch") return `${timeOf(e.at)} ${esc(e.text)}`;
  const practice = e.mode === "practice" || /^Practice run/.test(e.text ?? "");
  return `${timeOf(e.at)} <b>${esc(e.supplier ?? "")}</b>${e.invoice ? " #" + esc(e.invoice) : ""}: ${practice && e.status === "problem" ? "practice run done, nothing saved" : STEP[e.status] ?? e.status}${practice && e.status !== "problem" ? " (practice)" : ""}${e.status === "approved" && who ? " by " + who : ""}`;
}
/* What Rico is doing right now, and what he did last. */
async function ricoDoing(d: any, chat: number) {
  const h = helperView(await helperRow(d));
  let now = !h.online ? (h.launcher.online ? "Rico is off. The Mac is on." : "Rico is off, and the Mac looks off too.")
    : h.stopped ? "Rico is on but stopped in Settings, so he takes no receipts."
    : `Rico is on${h.mode === "practice" ? " in practice mode" : ""}${h.signedIn ? ", signed in to Ricotta Restaurant" : ", not signed in yet"}.`;
  if (h.online && h.busyWith) {
    const { data: r } = await d.from("app_rr_receipts").select("supplier,invoice,status,log").eq("id", h.busyWith).maybeSingle();
    if (r) now += `\n\nWorking on <b>${esc(r.supplier)}</b> #${esc(r.invoice)} (${STEP[r.status] ?? r.status}):\n` + (r.log ?? []).slice(-4).map((x: any) => `• ${esc(x.text)}`).join("\n");
  } else if (h.online) now += " Nothing to do right now.";
  const { count } = await d.from("app_rr_receipts").select("id", { count: "exact", head: true }).eq("status", "queued");
  if (count) now += `\n${count} receipt(s) waiting for him.`;
  const last = await ricoEvents(d, 8);
  if (last.length) now += "\n\n<b>Lately</b>\n" + last.map(eventLine).join("\n");
  await say(chat, now, h.online ? [[{ text: "Live screenshot", data: "rs" }, { text: "Refresh", data: "rw" }]] : [[{ text: "Rico on the Mac", data: "rico" }]]);
}
async function ricoCmd(d: any, chat: number, who: string, action: string) {
  if (who !== "rozha") { await say(chat, "Only Rozh can start or stop Rico."); return; }
  const res = await ricoCommand(d, action, "telegram");
  await say(chat, res.error === "launcher_off" ? "The Mac is off, or Rico's launcher isn't set up on it, so Rico can't be started from here."
    : action === "stop" ? "Stopping Rico on the Mac..." : `Starting Rico${action === "practice" ? " in practice mode (nothing is saved)" : ""} on the Mac... I'll tell you when he's ready.`);
}
async function ricoShot(d: any, chat: number) {
  const res = await requestShot(d, chat);
  await say(chat, res.error ? "Rico is off, so there is nothing to see. Start him first." : "Taking a screenshot of Rico's screen...");
}
onShot(async (_d, chat, url, caption) => { if (telegramReady() && url) await tg("sendPhoto", { chat_id: chat, photo: url, caption: caption || "Rico's screen right now" }); });
onLaunchEvent(async (d, text) => { if (!telegramReady()) return; const chat = await chatOf(d); if (chat) await say(chat, esc(text)); });

/* ---------- Telling Rozh what happened ---------- */
async function sendPhotos(chat: number, urls: string[], caption?: string) {
  for (let i = 0; i < urls.length; i += 10) {
    const group = urls.slice(i, i + 10).map((u, k) => ({ type: "photo", media: u, ...(i + k === 0 && caption ? { caption, parse_mode: "HTML" } : {}) }));
    if (group.length === 1) await tg("sendPhoto", { chat_id: chat, photo: group[0].media, ...(caption && i === 0 ? { caption, parse_mode: "HTML" } : {}) });
    else await tg("sendMediaGroup", { chat_id: chat, media: group });
  }
}
async function receiptEvent(d: any, r: any, event: string) {
  if (!telegramReady()) return;
  const chat = await chatOf(d);
  if (!chat) return;
  const head = `<b>${esc(r.supplier)}</b> · invoice ${esc(r.invoice)} · ${money(Number(r.total), r.currency)}`;
  if (event === "queued") {
    const h = helperView(await helperRow(d));
    if (h.online && !h.stopped) return;
    const st = await stateOf(d, chat);
    if (st.macOffAt && Date.now() - Date.parse(st.macOffAt) < 30 * 60_000) return;
    st.macOffAt = new Date().toISOString(); await saveState(d, chat, st);
    const { count } = await d.from("app_rr_receipts").select("id", { count: "exact", head: true }).eq("status", "queued");
    await say(chat, h.stopped ? `Rico is stopped (Settings). ${count ?? 1} receipt(s) waiting.` : `Your Mac is off, so Rico can't work. ${count ?? 1} receipt(s) waiting; he'll do them as soon as the Mac and Rico are on.`);
    return;
  }
  if (event === "review") {
    const photos = await photoLinks(d, r, ["before"]);
    if (photos.length) await sendPhotos(chat, photos.map((p) => p.url));
    const warn = (r.warnings ?? []).map((w: any) => "• " + (WARN[w.code]?.(w) ?? w.code)).join("\n");
    await say(chat, `Rico filled this in Ricotta Restaurant. Nothing is saved yet.\n\n${head}\n${(r.lines ?? []).map((l: any, i: number) => `${i + 1}. ${esc(l.item)} · ${num(l.qty, 3)} × ${esc(unitShow(l.unit))} · ${money(l.cost, r.currency)}`).join("\n")}${warn ? "\n\n" + warn : ""}`,
      [[{ text: "Approve and save", data: "ap:" + r.id }, { text: "Cancel", data: "cx:" + r.id }]]);
    return;
  }
  if (event === "saved") {
    const f = r.finance ?? {};
    const photos = await photoLinks(d, r, ["after", "invoices"]);
    await say(chat, f.tab
      ? `Saved in Invoices, <b>${esc(f.tab)}</b> tab (look for invoice #${esc(r.invoice)}).\n${head}\nReceived · sent to finance`
      : `Saved, and confirmed in Ricotta Restaurant's stock record, but Rico couldn't find invoice #${esc(r.invoice)} in Invoices. Please look for it there (Purchases, or the supplier's own tab).\n${head}`);
    if (photos.length) await sendPhotos(chat, photos.map((p) => p.url));
    return;
  }
  if (event === "problem") {
    // The photo of where Rico stopped; a practice run has none, so the photo of what he filled in.
    let photos = await photoLinks(d, r, ["problem"]);
    if (!photos.length) photos = await photoLinks(d, r, ["before"]);
    const practice = /^Practice run/.test(r.problem ?? "");
    await say(chat, practice ? `Practice run: this is what Rico filled in. Nothing was saved.\n${head}` : `Rico stopped.\n${head}\n\n${esc(r.problem ?? "")}`);
    if (photos.length) await sendPhotos(chat, photos.map((p) => p.url).slice(0, 4));
  }
}
onReceiptEvent(receiptEvent);

/* ---------- Transfers between storages, step by step ----------
   From (Main Storage first), To (never the same), then items from what the From storage has, each
   with its unit and amount (never more than is there), Record for yesterday (asked before it is
   turned on), and Send. Rico's photo comes back with Approve and move / Cancel. */
const TT = (globalThis as any).RicottaTransfers;
async function canTransfer(d: any, who: string) {
  if (who === "rozha") return true;
  const { data } = await d.from("app_accounts").select("roles").eq("id", who).maybeSingle();
  return Array.isArray(data?.roles) && data.roles.includes("transfers");
}
const tItemOf = (cat: any, name: string) => (cat.titems ?? []).find((i: any) => i.name === name) ?? null;
const tStock = (item: any, zone: string) => { const c = TT.inCounting(item, TT.available(item, zone)); return `${num(c.qty, 3)} ${c.unit}`; };
async function tList(d: any, chat: number, st: any, kind: "z" | "i", page: number, names: string[], title: string) {
  const pages = Math.max(1, Math.ceil(names.length / PAGE)), p = Math.min(Math.max(0, page), pages - 1);
  const shown = names.slice(p * PAGE, p * PAGE + PAGE);
  st.topts = shown; st.tlist = { kind, names, title };
  await saveState(d, chat, st);
  const rows: { text: string; data: string }[][] = [];
  shown.forEach((n, k) => { const b = { text: n.length > 30 ? n.slice(0, 29) + "…" : n, data: (kind === "z" ? "tz:" : "ti:") + k }; if (k % 2 === 0) rows.push([b]); else rows[rows.length - 1].push(b); });
  const nav = [];
  if (p > 0) nav.push({ text: "‹ Back", data: `tp:${p - 1}` });
  if (p < pages - 1) nav.push({ text: `Next › (${p + 2}/${pages})`, data: `tp:${p + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "Cancel transfer", data: "tx" }]);
  await say(chat, title, rows);
}
async function tStart(d: any, chat: number, who: string) {
  if (!(await canTransfer(d, who))) { await say(chat, "Transfers aren't turned on for this account."); return; }
  const cat = await catalogOf(d), zones = TT.zonesOf(cat);
  if (!(cat as any).titems?.length) { await say(chat, "Rico hasn't read the stock from Ricotta Restaurant yet. Start Rico on the Mac first.", MENU); return; }
  const st = await stateOf(d, chat);
  delete st.draft;
  st.tdraft = { step: "from", from: null, to: null, yesterday: false, lines: [], cur: null };
  const order = [...zones].sort((a: string, b: string) => (a === "Main Storage" ? -1 : b === "Main Storage" ? 1 : a.localeCompare(b)));
  await tList(d, chat, st, "z", 0, order, "New transfer. From which storage?");
}
async function tAskItem(d: any, chat: number, st: any, cat: any) {
  const dr = st.tdraft, names = TT.itemsIn(cat, dr.from).map((i: any) => i.name).sort((a: string, b: string) => a.localeCompare(b));
  await tList(d, chat, st, "i", 0, names, `Item ${dr.lines.length + 1} from <b>${esc(dr.from)}</b>. Pick one, or type a few letters to search.`);
}
async function tShow(chat: number, dr: any) {
  const lines = dr.lines.map((l: any, i: number) => `${i + 1}. ${esc(l.item)} · <b>${num(l.qty, 3)} ${esc(l.unit)}</b>`).join("\n");
  await say(chat, `<b>${esc(dr.from)} → ${esc(dr.to)}</b>${dr.yesterday ? "\n<b>Recorded for yesterday</b>" : ""}\n${lines || "No items yet."}\n\n${dr.lines.length} item(s).`, [
    [{ text: "Add item", data: "ta" }, { text: "Undo last", data: "tundo" }],
    [{ text: dr.yesterday ? "Record for yesterday: ON (turn off)" : "Record for yesterday: off", data: "ty" }],
    [{ text: "Send to Rico", data: "tsend" }, { text: "Cancel", data: "tx" }]]);
}
/* Typed text while a transfer is being made: a search, or an amount. */
async function tText(d: any, chat: number, who: string, text: string, st: any) {
  const dr = st.tdraft, cat = await catalogOf(d);
  if (dr.step === "from" || dr.step === "to" || dr.step === "item") {
    const pool = dr.step === "item" ? TT.itemsIn(cat, dr.from).map((i: any) => i.name) : TT.zonesOf(cat).filter((z: string) => z !== dr.from);
    const found = S.rank(pool, text, (x: string) => x).slice(0, 8);
    if (!found.length) { await say(chat, "Nothing found. Try other letters."); return; }
    await tList(d, chat, st, dr.step === "item" ? "i" : "z", 0, found, "Which one?");
    return;
  }
  if (dr.step === "qty") {
    const v = digitsOf(text);
    if (!/^\d+(\.\d{1,3})?$/.test(v) || Number(v) <= 0) { await say(chat, "Type the amount as a number, for example 3 or 2.5."); return; }
    const item = tItemOf(cat, dr.cur.item), opt = TT.unitOptions(item).find((o: any) => o.name === dr.cur.unit);
    const already = dr.lines.filter((l: any) => l.item === dr.cur.item).reduce((s: number, l: any) => s + l.qty * (TT.unitOptions(item).find((o: any) => o.name === l.unit)?.factor ?? 1), 0);
    if (already + Number(v) * opt.factor > TT.available(item, dr.from) + 1e-9) { await say(chat, `Only ${tStock(item, dr.from)} is in ${esc(dr.from)}. Type a smaller amount.`); return; }
    dr.cur.qty = Number(v); dr.lines.push(dr.cur); dr.cur = null; dr.step = "more";
    await saveState(d, chat, st);
    await tShow(chat, dr);
    return;
  }
  await say(chat, "Use the buttons above, or type cancel.");
}
async function tButton(d: any, chat: number, who: string, data: string, cb: any) {
  const st = await stateOf(d, chat), dr = st.tdraft, cat = await catalogOf(d);
  if (data === "nt") return tStart(d, chat, who);
  if (!dr) { await say(chat, "That transfer was finished or stopped. Tap New transfer to make one.", MENU); return; }
  if (data === "tx") { delete st.tdraft; await saveState(d, chat, st); await say(chat, "Stopped. Nothing was sent.", MENU); return; }
  const pg = data.match(/^tp:(\d+)$/);
  if (pg && st.tlist) return tList(d, chat, st, st.tlist.kind, Number(pg[1]), st.tlist.names, st.tlist.title);
  const z = data.match(/^tz:(\d+)$/);
  if (z && (dr.step === "from" || dr.step === "to")) {
    const name = st.topts?.[Number(z[1])]; if (!name) return;
    if (dr.step === "from") { dr.from = name; dr.step = "to"; return tList(d, chat, st, "z", 0, TT.zonesOf(cat).filter((x: string) => x !== name), `From <b>${esc(name)}</b>. To which storage?`); }
    dr.to = name; dr.step = "item"; return tAskItem(d, chat, st, cat);
  }
  const it = data.match(/^ti:(\d+)$/);
  if (it && dr.step === "item") {
    const name = st.topts?.[Number(it[1])], item = name && tItemOf(cat, name); if (!item) return;
    const units = TT.unitOptions(item).filter((o: any) => !o.unclear);
    dr.cur = { item: name, unit: null, qty: null }; dr.step = "unit"; st.tunits = units.map((u: any) => u.name);
    await saveState(d, chat, st);
    await say(chat, `<b>${esc(name)}</b>: ${tStock(item, dr.from)} in ${esc(dr.from)}. Which unit?`, [units.map((u: any, k: number) => ({ text: u.name, data: "tu:" + k }))]);
    return;
  }
  const u = data.match(/^tu:(\d+)$/);
  if (u && dr.step === "unit") {
    dr.cur.unit = st.tunits?.[Number(u[1])]; if (!dr.cur.unit) return;
    dr.step = "qty"; await saveState(d, chat, st);
    await say(chat, `How many ${esc(dr.cur.unit)}?`);
    return;
  }
  if (data === "ta" && dr.step === "more") { dr.step = "item"; return tAskItem(d, chat, st, cat); }
  if (data === "tundo" && dr.step === "more") { dr.lines.pop(); await saveState(d, chat, st); if (dr.lines.length) return tShow(chat, dr); dr.step = "item"; return tAskItem(d, chat, st, cat); }
  if (data === "ty" && dr.step === "more") {
    if (dr.yesterday) { dr.yesterday = false; await saveState(d, chat, st); return tShow(chat, dr); }
    const y = new Date(erbilDay() + "T12:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
    await say(chat, `Record this transfer for yesterday (${y.toISOString().slice(0, 10)})? It will count on that day in reports.`, [[{ text: "Yes, for yesterday", data: "tyy" }, { text: "No", data: "tyn" }]]);
    return;
  }
  if ((data === "tyy" || data === "tyn") && dr.step === "more") { dr.yesterday = data === "tyy"; await saveState(d, chat, st); return tShow(chat, dr); }
  if ((data === "tsend" || data === "tsendok") && dr.step === "more") {
    const row = { id: dr.id || crypto.randomUUID(), created_by: who, source: "telegram", status: "draft", from_zone: dr.from, to_zone: dr.to, yesterday: !!dr.yesterday, lines: dr.lines };
    dr.id = row.id;
    const { data: saved, error } = await d.from("app_rr_transfers").upsert(row).select("*").maybeSingle();
    if (error || !saved) { await say(chat, "That didn't save. Try again in a moment."); return; }
    // Record for yesterday was confirmed when it was turned on; anything else is confirmed here.
    const confirm = data === "tsendok" ? (dr.confirm ?? []) : dr.yesterday ? ["yesterday"] : [];
    const res = await sendTransfer(d, saved, who, confirm, "telegram");
    if (res.error === "needs_confirmation") {
      const ws = ((res.extra?.warnings as any[]) ?? []);
      dr.confirm = [...new Set(ws.map((w) => w.code))];
      await saveState(d, chat, st);
      await say(chat, "Check these first:\n\n" + ws.filter((w) => w.code !== "yesterday").map((w) => "• " + tWarn(w)).join("\n"), [[{ text: "They're right, send", data: "tsendok" }, { text: "Cancel", data: "tx" }]]);
      return;
    }
    if (res.error) {
      const errs = ((res.extra?.errors as any[]) ?? []).map((e) => (e.line ? `Item ${e.line}: ` : "") + (e.code === "notEnough" ? `only ${num(e.have.qty, 3)} ${e.have.unit} there` : e.code)).join(", ");
      await say(chat, `That can't be sent yet${errs ? ": " + esc(errs) : ""}.`);
      return;
    }
    delete st.tdraft; await saveState(d, chat, st);
    await say(chat, `Sent to Rico: <b>${esc(dr.from)} → ${esc(dr.to)}</b>, ${dr.lines.length} item(s)${dr.yesterday ? ", for yesterday" : ""}. I'll send you the photo to check.`, MENU);
  }
}
const tWarn = (w: any) => w.code === "pressed" ? "Rico already pressed Move it for this transfer. Check Recent transfers in Ricotta Restaurant first: send it only if it did not move."
  : w.code === "repeat" ? "The same transfer (same storages, day, items and amounts) was already sent. Send it again only if it really happened twice."
  : w.code === "duplicate" ? `Item ${w.line} is the same item as item ${w.first}`
  : w.code === "allStock" ? `Item ${w.line}: moves all of it (${num(w.have.qty, 3)} ${esc(w.have.unit)})`
  : w.code === "unusual" ? `Item ${w.line}: ${num(w.times, 1)} times more than usual${w.usual ? ` (${w.zone ? esc(w.zone) + " usually gets" : "usually"} about ${num(w.usual.qty, 3)} ${esc(w.usual.unit)})` : ""}`
  : w.code === "unusualLow" ? `Item ${w.line}: far less than ${w.zone ? esc(w.zone) + " usually gets" : "usual"} (about ${num(w.usual.qty, 3)} ${esc(w.usual.unit)}). A typo?`
  : w.code === "newRoute" ? `Item ${w.line}: never went from ${esc(w.from)} to ${esc(w.to)} in the last 3 weeks${w.usualTo?.length ? `; it usually goes to ${esc(w.usualTo.join(", "))}` : ""}. The right storage?` : w.code === "yesterday" ? "Recorded for yesterday" : w.code;
/* Approve (asked once more) or cancel a transfer Rico filled in. */
async function tApprove(d: any, chat: number, who: string, kind: string, id: string, cb: any) {
  const { data: r } = await d.from("app_rr_transfers").select("*").eq("id", id).maybeSingle();
  if (!r) { await say(chat, "That transfer is no longer here."); return; }
  if (!(await canTransfer(d, who))) { await say(chat, "Transfers aren't turned on for this account."); return; }
  if (kind === "tap") {
    const ws = (r.warnings ?? []).filter((w: any) => w.code !== "yesterday").map((w: any) => "• " + tWarn(w)).join("\n");
    await say(chat, `Are you sure? Move ${(r.lines ?? []).length} item(s) <b>${esc(r.from_zone)} → ${esc(r.to_zone)}</b>${r.yesterday ? ", recorded for yesterday" : ""}?${ws ? "\n\n" + ws : ""}`,
      [[{ text: "Yes, approve and move", data: "tapy:" + r.id }, { text: "Cancel transfer", data: "tcx:" + r.id }]]);
    return;
  }
  const res = kind === "tapy" ? await approveTransfer(d, r, who) : await cancelTransfer(d, r, who);
  await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
  await say(chat, res.error ? (res.error === "too_late" ? "Too late: Rico already moved it." : res.error === "not_waiting" ? "This transfer isn't waiting for approval any more." : "That didn't work. Try in the app.")
    : kind === "tapy" ? `Approved. Rico checks the stock again and moves <b>${esc(r.from_zone)} → ${esc(r.to_zone)}</b> now.` : "Cancelled. Rico clears it; nothing was moved.");
}
async function transferEvent(d: any, r: any, event: string) {
  if (!telegramReady()) return;
  const chat = await chatOf(d);
  if (!chat) return;
  const head = `<b>${esc(r.from_zone)} → ${esc(r.to_zone)}</b> · ${(r.lines ?? []).length} item(s)${r.yesterday ? " · for yesterday" : ""}`;
  const lines = (r.lines ?? []).map((l: any, i: number) => `${i + 1}. ${esc(l.item)} · ${num(l.qty, 3)} ${esc(l.unit)}`).join("\n");
  if (event === "review") {
    const photos = await transferPhotoLinks(d, r, ["before"]);
    if (photos.length) await sendPhotos(chat, photos.map((p: any) => p.url));
    const ws = (r.warnings ?? []).filter((w: any) => w.code !== "yesterday").map((w: any) => "• " + tWarn(w)).join("\n");
    await say(chat, `Rico filled in this transfer in Ricotta Restaurant. Nothing has moved yet.\n\n${head}\n${lines}${ws ? "\n\n" + ws : ""}`,
      [[{ text: "Approve and move", data: "tap:" + r.id }, { text: "Cancel", data: "tcx:" + r.id }]]);
    return;
  }
  if (event === "moved") {
    // Moved without a second approval: the photo of the filled-in form comes too.
    const photos = await transferPhotoLinks(d, r, r.auto ? ["before", "after"] : ["after"]);
    const sure = r.result?.checked !== false;
    await say(chat, `Moved${r.auto ? " (without a second approval)" : ""}. ${head}\n${sure ? "Checked in Ricotta Restaurant's stock record: every item moved once, in exactly these amounts." : "Rico couldn't confirm it in the stock record: please check Recent transfers."}${r.auto ? "\n" + lines : ""}`);
    if (photos.length) await sendPhotos(chat, photos.map((p: any) => p.url));
    return;
  }
  if (event === "problem") {
    let photos = await transferPhotoLinks(d, r, ["problem"]);
    if (!photos.length) photos = await transferPhotoLinks(d, r, ["before"]);
    const practice = /^Practice run/.test(r.problem ?? "");
    await say(chat, practice ? `Practice run: this is the transfer Rico filled in. Nothing was moved.\n${head}` : `Rico stopped the transfer.\n${head}\n\n${esc(r.problem ?? "")}`);
    if (photos.length) await sendPhotos(chat, photos.map((p: any) => p.url).slice(0, 4));
  }
}
onTransferEvent(transferEvent);
