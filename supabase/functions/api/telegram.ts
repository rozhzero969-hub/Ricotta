// Ricotta Helper on Telegram: Rico's own bot, for Rozha only.
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
import { approveReceipt, cancelReceipt, catalogOf, helperRow, helperView, onReceiptEvent, photoLinks, sendReceipt } from "./receipts.ts";

const R = (globalThis as any).RicottaReceipts;
const S = (globalThis as any).RicottaSearch;
const TOKEN = () => Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const db = (d: any, table: string) => d.from(`app_tg_${table}`);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n: number, d = 0) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: d });
const money = (n: number, cur: string) => (cur === "USD" ? "$" + num(n, 2) : "IQD " + num(n));

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
const MENU = [[{ text: "New receipt", data: "n" }]];

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
export async function telegramStatus(d: any, account = "rozha") {
  return { ready: telegramReady(), connected: !!(await chatOf(d, account)) };
}

/* ---------- Telegram calls us ---------- */
export async function telegramWebhook(d: any, req: Request, update: any) {
  if (!telegramReady() || req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) return false;
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
  if (/^\/(new|start)$/.test(text)) return (await startDraft(d, chat), true);
  if (/^\/cancel$/.test(text)) { const st = await stateOf(d, chat); delete st.draft; await saveState(d, chat, st); await say(chat, "Stopped. Nothing was sent.", MENU); return true; }
  if (text) await onText(d, chat, who, text);
  return true;
}

/* ---------- Making a receipt, step by step ---------- */
async function startDraft(d: any, chat: number) {
  const st = await stateOf(d, chat);
  st.draft = { step: "supplier", supplier: null, invoice: null, zone: "Main Storage", currency: "IQD", rate: null, delivery: null, lines: [], cur: null };
  await saveState(d, chat, st);
  await say(chat, "New receipt. Which supplier? Type a few letters of its name.\n\nSend /cancel to stop at any time.");
}
const digitsOf = (s: string) => s.replace(/[٠-٩]/g, (x) => String(x.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (x) => String(x.charCodeAt(0) - 0x6f0)).replace(/[,\s]/g, "");
async function onText(d: any, chat: number, who: string, text: string) {
  const st = await stateOf(d, chat), dr = st.draft;
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
    await saveState(d, chat, st);
    await say(chat, `$1 = ${esc(v)} IQD. Now the first item: type a few letters of its name.`);
    return;
  }
  if (dr.step === "delivery") {
    if (!/^\d+$/.test(v)) { await say(chat, "Type the delivery fee as a whole number, or 0 for none."); return; }
    dr.delivery = Number(v) || null; dr.step = "item";
    await saveState(d, chat, st);
    await say(chat, `${dr.delivery ? "Delivery " + num(dr.delivery) + "." : "No delivery."} Now the first item: type a few letters of its name.`);
    return;
  }
  if (dr.step === "qty") {
    if (!/^\d+(\.\d{1,3})?$/.test(v) || Number(v) <= 0) { await say(chat, "Type the quantity as a number, for example 4 or 2.5."); return; }
    dr.cur.qty = Number(v); dr.step = "cost";
    await saveState(d, chat, st);
    await say(chat, `Unit cost for one ${esc(dr.cur.unit)}, in ${dr.currency === "USD" ? "whole dollars" : "IQD"}?`);
    return;
  }
  if (dr.step === "cost") {
    if (!/^\d+$/.test(v) || Number(v) <= 0) { await say(chat, `Type the unit cost as a whole number${dr.currency === "USD" ? " of dollars" : ""}.`); return; }
    dr.cur.cost = Number(v); dr.lines.push(dr.cur); dr.cur = null; dr.step = "more";
    await saveState(d, chat, st);
    await showDraft(chat, dr);
    return;
  }
  await say(chat, "Use the buttons above, or send /cancel to stop.");
}
function draftText(dr: any) {
  const t = R.totals(dr);
  const lines = dr.lines.map((l: any, i: number) => `${i + 1}. ${esc(l.item)}\n    ${num(l.qty, 3)} × ${esc(l.unit)} · ${money(l.cost, dr.currency)} = <b>${money(l.qty * l.cost, dr.currency)}</b>`).join("\n");
  return `<b>${esc(dr.supplier)}</b> · invoice ${esc(dr.invoice)} · ${esc(dr.zone)}\n${dr.currency === "USD" ? `USD, $1 = ${num(dr.rate, 3)} IQD` : dr.delivery ? `Delivery ${num(dr.delivery)}` : "No delivery"}\n\n${lines}\n\nTotal <b>${money(t.total, dr.currency)}</b>${dr.currency === "USD" ? ` = IQD ${num(t.iqd)}` : ""}`;
}
const showDraft = (chat: number, dr: any) => say(chat, draftText(dr), [[{ text: "Add item", data: "a" }, { text: "Send to Rico", data: "send" }], [{ text: "Remove last item", data: "undo" }, { text: "Cancel", data: "x" }]]);

const WARN: Record<string, (w: any) => string> = {
  priceJump: (w) => `Item ${w.line}: price ${w.pct > 0 ? "up" : "down"} ${Math.abs(w.pct)}% (last time ${num(w.before)})`,
  duplicate: (w) => `Item ${w.line} is the same item as item ${w.first}`,
  tinyUnit: (w) => `Item ${w.line}: this unit counts as only 1 gram or piece`,
  rateOdd: (w) => `The dollar rate is outside ${w.min} to ${w.max}`,
  bigTotal: (w) => `A big receipt: IQD ${num(w.iqd)}`,
};
async function onButton(d: any, chat: number, who: string, cb: any) {
  const data = String(cb.data ?? "");
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  // Approve or cancel a receipt Rico filled in.
  const act = data.match(/^(ap|cx):([0-9a-f-]{36})$/);
  if (act) {
    const { data: r } = await d.from("app_rr_receipts").select("*").eq("id", act[2]).maybeSingle();
    if (!r) { await say(chat, "That receipt is no longer here."); return; }
    const res = act[1] === "ap" ? await approveReceipt(d, r, who) : await cancelReceipt(d, r, who);
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await say(chat, res.error ? (res.error === "too_late" ? "Too late: Rico already saved it." : res.error === "not_waiting" ? "This receipt isn't waiting for approval any more." : "That didn't work. Try in the app.")
      : act[1] === "ap" ? `Approved. Rico is saving <b>${esc(r.supplier)}</b> #${esc(r.invoice)} now.` : `Cancelled. Rico discards it; nothing was saved.`);
    return;
  }
  if (data === "n") return startDraft(d, chat);
  const st = await stateOf(d, chat), dr = st.draft;
  if (!dr) { await say(chat, "That receipt was finished or stopped. Tap New receipt to make one.", MENU); return; }
  const cat = await catalogOf(d);
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
    await saveState(d, chat, st);
    await say(chat, "No delivery. Now the first item: type a few letters of its name.");
    return;
  }
  if (pick?.[1] === "i" && dr.step === "item") {
    const name = st.opts?.[Number(pick[2])], item = cat.items.find((i: any) => i.name === name);
    if (!item) return;
    const units = R.unitOptions(item);
    dr.cur = { item: name, unit: null, qty: null, cost: null }; dr.step = "unit"; st.opts = units.map((u: any) => u.label);
    await saveState(d, chat, st);
    await say(chat, `<b>${esc(name)}</b>. Which unit?`, units.map((u: any, k: number) => [{ text: u.label, data: "u:" + k }]));
    return;
  }
  if (pick?.[1] === "u" && dr.step === "unit") {
    dr.cur.unit = st.opts?.[Number(pick[2])]; if (!dr.cur.unit) return;
    dr.step = "qty";
    await saveState(d, chat, st);
    await say(chat, `How many ${esc(dr.cur.unit)}?`);
    return;
  }
  if (data === "a" && dr.step === "more") { dr.step = "item"; await saveState(d, chat, st); await say(chat, `Item ${dr.lines.length + 1}: type a few letters of its name.`); return; }
  if (data === "undo" && dr.step === "more") { dr.lines.pop(); if (!dr.lines.length) dr.step = "item"; await saveState(d, chat, st); if (dr.lines.length) await showDraft(chat, dr); else await say(chat, "Removed. Type a few letters of the first item."); return; }
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

/* ---------- Telling Rozha what happened ---------- */
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
    await say(chat, `Rico filled this in Ricotta Restaurant. Nothing is saved yet.\n\n${head}\n${(r.lines ?? []).map((l: any, i: number) => `${i + 1}. ${esc(l.item)} · ${num(l.qty, 3)} × ${esc(l.unit)} · ${money(l.cost, r.currency)}`).join("\n")}${warn ? "\n\n" + warn : ""}`,
      [[{ text: "Approve and save", data: "ap:" + r.id }, { text: "Cancel", data: "cx:" + r.id }]]);
    return;
  }
  if (event === "saved") {
    const f = r.finance ?? {};
    const photos = await photoLinks(d, r, ["after", "invoices"]);
    await say(chat, `Saved. <b>${esc(f.tab ?? "Purchases")} #${esc(f.no ?? "?")}</b>\n${head}\nReceived · sent to finance`);
    if (photos.length) await sendPhotos(chat, photos.map((p) => p.url));
    return;
  }
  if (event === "problem") {
    const photos = await photoLinks(d, r, ["problem"]);
    await say(chat, `Rico stopped.\n${head}\n\n${esc(r.problem ?? "")}`);
    if (photos.length) await sendPhotos(chat, photos.map((p) => p.url).slice(0, 4));
  }
}
onReceiptEvent(receiptEvent);
