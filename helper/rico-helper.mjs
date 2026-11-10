// Rico on Rozha's Mac: enters receipts from Ricotta Orders into Ricotta Restaurant.
//   node helper/rico-helper.mjs              work: take receipts, fill them in, wait for approval, save
//   node helper/rico-helper.mjs --practice   fill in each receipt, photograph it, then discard it
//
// Ricotta Restaurant (another team's web app) has no API for us, so Rico uses it the way a person
// does, in a browser window of his own, full screen, that keeps its own sign-in. His rules:
//  - Names, units and numbers are matched exactly as Ricotta Restaurant writes them. Anything not
//    found, or anything that reads back different from what was typed, stops the receipt with the reason.
//  - He reads every box back before saving, and checks Ricotta Restaurant's own totals against ours.
//  - He only presses "Receive & send to finance" after the receipt is approved (by a person, or by
//    "Rico saves by himself" in Settings). He never presses Add expense item, Return, Waste or anything
//    that edits or deletes, and never touches a half-made receipt that was already there.
//  - Photos before and after saving, and of the receipt in Invoices, go to Ricotta Orders.
//  - Signed out? He signs in again (with what helper/setup.mjs saved in the Keychain) and says so.
import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { readSecret } from "./keychain.mjs";
import "../supabase/functions/_shared/receipts.js";
import "../supabase/functions/_shared/transfers.js";

const VERSION = "2026-11-15.1";
const API = "https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/api";
const RR = "https://pos.shaydattendance.com";
const PRACTICE = process.argv.includes("--practice");
const PROFILE = join(homedir(), "Library", "Application Support", "RicoHelper", "browser");
const TOKEN = readSecret("helper-token");
if (!TOKEN) { console.log("Rico is not set up yet. Run: node helper/setup.mjs"); process.exit(1); }
const R = globalThis.RicottaReceipts;
const TR = globalThis.RicottaTransfers;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Ricotta Orders ---------- */
async function api(path, { method = "GET", body } = {}) {
  for (let tries = 0; ; tries++) {
    try {
      const res = await fetch(`${API}/${path}`, { method, headers: { "content-type": "application/json", "x-helper-token": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(70_000) });
      const data = await res.json().catch(() => null);
      if (res.ok) return data;
      if (res.status === 401) throw new Error("Ricotta Orders did not accept Rico's token. Run node helper/setup.mjs --new-token");
      if (res.status < 500 || tries >= 3) throw new Error(`Ricotta Orders answered ${res.status} ${data?.error ?? ""}`);
    } catch (e) {
      if (String(e.message).startsWith("Ricotta Orders") || tries >= 3) throw e;
    }
    await sleep(2000 * (tries + 1));
  }
}
const report = (id, body) => api(`helper/receipts/${id}/report`, { method: "POST", body });
/* One photo of the whole page. Ricotta Restaurant scrolls inside its own box, so one picture shows only
   what is on screen: Rico scrolls that box from the top to the bottom, photographs it at each place,
   and joins the pieces into one tall picture (in a hidden browser of his own), so the whole receipt,
   from Receipt details to the Total, is in a single photo. If joining fails, the pieces are sent. */
let joiner = null;
async function joinPhotos(pieces, height, geo) {
  joiner ??= await chromium.launch({ headless: true });
  const p = await joiner.newPage();
  try {
    return await p.evaluate(async ({ pieces, height, geo }) => {
      const imgs = await Promise.all(pieces.map((x) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = "data:image/png;base64," + x.b64; })));
      // Photo pixels per page point, taken from the photo itself and the box's real size on screen (its
      // border and scrollbar included), made at most 1400 wide so the photo stays small enough to send.
      const ratio = imgs[0].height / geo.rectH, fit = Math.min(1, 1400 / imgs[0].width), c = document.createElement("canvas");
      c.width = Math.round(imgs[0].width * fit); c.height = Math.round(height * ratio * fit);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      // Only the box's visible content is used. Each piece after the first loses its top 12 points (the
      // shadow of the page's header), and is lined up by its content: its top strip is slid up and down
      // until it matches the end of the piece before, pixel for pixel, so nothing shows twice or is cut.
      const tmp = document.createElement("canvas"), t = tmp.getContext("2d");
      let bottom = 0;
      imgs.forEach((img, k) => {
        const skip = k ? 12 : 0, sy = (geo.top + skip) * ratio, sh = (geo.view - skip) * ratio;
        let dy = Math.round((pieces[k].y + skip) * ratio * fit);
        if (k) {
          const strip = Math.round(36 * ratio * fit);
          tmp.width = c.width; tmp.height = strip;
          t.drawImage(img, 0, sy, img.width, strip / fit, 0, 0, c.width, strip);
          const a = t.getImageData(0, 0, c.width, strip).data;
          let best = dy, bestDiff = Infinity;
          for (let off = -Math.round(90 * ratio * fit); off <= Math.round(90 * ratio * fit); off++) {
            const y0 = dy + off;
            if (y0 < 0 || y0 + strip > bottom) continue;
            const b = g.getImageData(0, y0, c.width, strip).data;
            let d = 0;
            for (let i = 0; i < a.length; i += 28) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            if (d < bestDiff) { bestDiff = d; best = y0; }
          }
          dy = best;
        }
        const dh = Math.round(sh * fit);
        g.drawImage(img, 0, sy, img.width, sh, 0, dy, c.width, dh);
        bottom = Math.max(bottom, dy + dh);
      });
      // The page's real end: whatever is below the last piece is cut off.
      if (bottom < c.height) { const out = document.createElement("canvas"); out.width = c.width; out.height = bottom; out.getContext("2d").drawImage(c, 0, 0); return out.toDataURL("image/jpeg", 0.82).split(",")[1]; }
      return c.toDataURL("image/jpeg", 0.82).split(",")[1];
    }, { pieces, height, geo });
  } finally { await p.close(); }
}
async function photo(page, id, kind, what = "receipts") {
  const upload = (b64) => api(`helper/${what}/${id}/photo`, { method: "POST", body: { kind, image: b64 } });
  try {
    const box = await page.evaluateHandle(() => {
      const all = [...document.querySelectorAll("main, div, section")].filter((el) => {
        const st = getComputedStyle(el);
        return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200;
      });
      return all.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] || null;
    });
    if (!(await box.evaluate((el) => !!el))) { await upload((await page.screenshot({ type: "jpeg", quality: 80, fullPage: true })).toString("base64")); return; }
    const height = await box.evaluate((el) => el.scrollHeight), view = await box.evaluate((el) => el.clientHeight);
    const geo = await box.evaluate((el) => ({ rectH: el.getBoundingClientRect().height, top: el.clientTop, view: el.clientHeight }));
    const step = Math.max(200, view - 60), pieces = [];
    for (let y = 0; ; y += step) {
      const want = Math.min(y, height - view);
      // Scrolled at once (the page scrolls smoothly otherwise), and placed by where it really is, so
      // the pieces line up exactly when they are joined.
      await box.evaluate((el, v) => el.scrollTo({ top: v, behavior: "instant" }), want);
      await sleep(350);
      const at = await box.evaluate((el) => el.scrollTop);
      pieces.push({ y: at, b64: (await box.asElement().screenshot({ type: "png" })).toString("base64") });
      if (at >= height - view - 1 || want >= height - view || pieces.length >= 12) break;
    }
    await box.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
    try { await upload(await joinPhotos(pieces, height, geo)); }
    catch (e) { log("joining the photos failed, sending them one by one:", e.message); for (const x of pieces) await upload(x.b64); }
  } catch (e) { log("photo failed:", e.message); }
}

/* ---------- Ricotta Restaurant ---------- */
class Stop extends Error {}
const stop = (msg) => { throw new Stop(msg); };
const exact = (s) => new RegExp(`^\\s*${String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
const digits = (s) => String(s ?? "").replace(/[^\d.]/g, "");
const money = (n) => Math.round(Number(n) * 1000) / 1000;

let browser, page, signedIn = false;
async function openBrowser() {
  browser = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: null, args: ["--start-fullscreen", "--start-maximized"] });
  page = browser.pages()[0] ?? await browser.newPage();
}
/* Signed out (the session ran out)? Sign in again with what setup saved, and say so. */
async function ensureSignedIn(id) {
  await page.waitForLoadState("domcontentloaded");
  // Ricotta Restaurant decides in the page itself whether to show the sign-in, a moment after loading:
  // wait until either the sign-in box or the app is there.
  const passBox = page.locator("input[type=password]").first();
  await Promise.race([passBox.waitFor({ timeout: 20_000 }), page.getByText("INVENTORY").first().waitFor({ timeout: 20_000 }), page.getByText("Receipt details").first().waitFor({ timeout: 20_000 })]).catch(() => {});
  if (!/\/login/.test(page.url()) && !(await passBox.isVisible().catch(() => false))) { signedIn = true; return; }
  signedIn = false;
  const user = readSecret("rr-username"), pass = readSecret("rr-password");
  if (!user || !pass) stop("Ricotta Restaurant signed out and Rico has no sign-in saved. Run node helper/setup.mjs");
  // The Password tab (not PIN), then the two boxes, found by their kind rather than their labels.
  await page.getByRole("tab", { name: /^Password$/ }).or(page.getByRole("button", { name: /^Password$/ })).first().click().catch(() => {});
  await passBox.waitFor({ timeout: 10_000 });
  await page.locator("input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio])").first().fill(user);
  await passBox.fill(pass);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 20_000 }).catch(() => stop("Rico could not sign in to Ricotta Restaurant (wrong sign-in or a new check on the page)."));
  signedIn = true;
  log("signed in again");
  if (id) await report(id, { log: ["Ricotta Restaurant had signed out. Signed in again."] });
}
async function go(path, id) {
  await page.goto(RR + path, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(id);
  if (!page.url().startsWith(RR + path)) await page.goto(RR + path, { waitUntil: "domcontentloaded" });
}
/* Waits for the answers to these API calls while a page loads, and returns their JSON. */
function capture(paths) {
  const got = {};
  const done = new Promise((resolve) => {
    const on = async (res) => {
      const u = new URL(res.url());
      const key = paths.find((p) => u.pathname === p);
      if (!key || res.request().method() !== "GET" || !res.ok()) return;
      try { got[key] = await res.json(); } catch {}
      if (paths.every((p) => p in got)) { page.off("response", on); resolve(got); }
    };
    page.on("response", on);
    setTimeout(() => { page.off("response", on); resolve(got); }, 45_000);
  });
  return done;
}

/* What Rico reads from Ricotta Restaurant for the app: suppliers, zones (not the two Breakfast ones)
   and the purchased items (not the ones named "-") with their units. */
/* What usually happens, learnt from Ricotta Restaurant's own stock record of the last 3 weeks (read
   once a day, gently: 200 lines a page with a pause between pages; nothing is changed). Per item: how
   many times it was moved and the usual and largest amount (base units), with how often each route
   ("Main Storage>Appetizers") was used; and how many deliveries came and their usual and largest amount.
   The checks use it to ask about an amount far from the usual one (135 for 13.5) or a storage it has
   never gone to. */
// What was learnt is kept on the Mac too, so starting Rico again the same day doesn't read it all again.
const HISTORY_FILE = join(homedir(), "Library", "Application Support", "RicoHelper", "learnt.json");
let historyNow = (() => { try { const h = JSON.parse(readFileSync(HISTORY_FILE, "utf8")); return h?.at && h.t && h.p ? h : null; } catch { return null; } })();
const HISTORY_DAYS = 21;
let historyBusy = false, lastCatalogBody = null;
/* Rico's sign-in to Ricotta Restaurant's server, read from his signed-in page and kept (read again if it
   stops working). Read calmly: the page may be loading, so it waits and tries again rather than
   giving up (this is what kept Rico from learning from 6 Nov: the page was moving as he read it). */
let rrTok = null;
async function rrToken(fresh = false) {
  if (rrTok && !fresh) return rrTok;
  for (let i = 0; i < 12; i++) {
    const v = await page.evaluate(() => localStorage.getItem("ricotta_token")).catch(() => null);
    if (v) return (rrTok = v);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await sleep(1000);
  }
  throw new Error("could not read Rico's sign-in to Ricotta Restaurant");
}
/* A read from Ricotta Restaurant's server with Rico's sign-in (nothing is changed there). */
async function rrGet(path) {
  for (const fresh of [false, true]) {
    const r = await fetch(RR + path, { headers: { Authorization: "Bearer " + (await rrToken(fresh)) }, signal: AbortSignal.timeout(30_000) });
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error(`Ricotta Restaurant answered ${r.status}`);
    return r.json();
  }
  throw new Error("Ricotta Restaurant didn't accept Rico's sign-in");
}
async function readHistory() {
  const since = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString();
  // Read straight from Ricotta Restaurant's server with Rico's own sign-in (no extra tab), so receipts
  // and transfers carry on meanwhile.
  const got = { rows: [] };
  for (let p = 1; p <= 150; p++) {
    const j = await rrGet(`/api/v1/inventory/movements?page=${p}&size=200`), ms = j.movements || [];
    for (const m of ms) if ((m.movement_type === "transfer_out" || m.movement_type === "purchase_in") && m.created_at >= since)
      got.rows.push([m.movement_type === "transfer_out" ? "t" : "p", m.item_name, Math.abs(Number(m.quantity)), m.zone_name, m.source, m.created_at]);
    if (!ms.length || !j.has_more || ms[ms.length - 1].created_at < since) break;
    await sleep(250);
  }
  if (!got?.rows) throw new Error(`could not read the stock record (${got?.error ?? "no answer"})`);
  // One move or delivery of an item can come from several deliveries in stock (two lines, same moment).
  const one = new Map();
  for (const [k, item, q, zone, other, at] of got.rows) {
    const key = [k, item, zone, other ?? "", at].join("|");
    const x = one.get(key) ?? { k, item, q: 0, route: `${zone}>${other ?? ""}` };
    x.q += q; one.set(key, x);
  }
  const lists = { t: {}, p: {} };
  for (const x of one.values()) {
    const e = (lists[x.k][x.item] ??= { qs: [], r: {} });
    e.qs.push(x.q);
    if (x.k === "t") (e.r[x.route] ??= { qs: [] }).qs.push(x.q);
  }
  const stat = (e) => { const s = [...e.qs].sort((a, b) => a - b); return { n: s.length, q: Math.round(s[Math.floor(s.length / 2)] * 1000) / 1000, hi: Math.round(s[s.length - 1] * 1000) / 1000 }; };
  historyNow = {
    at: new Date().toISOString(), days: HISTORY_DAYS,
    // Each storage has its own demand: per route ("Main Storage>Pizza") its own usual and largest amount.
    t: Object.fromEntries(Object.entries(lists.t).map(([n, e]) => [n, { ...stat(e), r: Object.fromEntries(Object.entries(e.r).map(([k, v]) => [k, stat(v)])) }])),
    p: Object.fromEntries(Object.entries(lists.p).map(([n, e]) => [n, stat(e)])),
  };
  try { writeFileSync(HISTORY_FILE, JSON.stringify(historyNow)); } catch (e) { log("could not keep what was learnt:", e.message); }
  log(`learnt from the stock record: ${Object.keys(historyNow.t).length} items moved, ${Object.keys(historyNow.p).length} delivered (${HISTORY_DAYS} days)`);
}
/* Learns again once a day, in the background; then the lists are sent again with what was learnt. */
function learnSoon() {
  if (historyBusy || (historyNow && Date.now() - Date.parse(historyNow.at) < 20 * 3600_000)) return;
  historyBusy = true;
  readHistory()
    .then(async () => { if (lastCatalogBody) await api("helper/catalog", { method: "PUT", body: { ...lastCatalogBody, history: historyNow } }); if (catalogNow) catalogNow.history = historyNow; })
    .catch((e) => log("Could not learn from the stock record:", e.message))
    .finally(() => { historyBusy = false; });
}
async function readCatalog({ sync = false } = {}) {
  // The unit names (غرام, کیلۆ, ...) load on the Units page; everything else on New receipt.
  const waitUnits = capture(["/api/v1/inventory/units"]);
  await go("/inventory/units");
  const u = await waitUnits;
  const wait = capture(["/api/v1/inventory/items", "/api/v1/purchasing/conversions", "/api/v1/purchasing/suppliers", "/api/v1/inventory/zones"]);
  await go("/inventory/new-receipt");
  const c = await wait;
  if (!c["/api/v1/inventory/items"] || !c["/api/v1/purchasing/suppliers"] || !c["/api/v1/inventory/zones"]) throw new Error("Could not read the lists from Ricotta Restaurant (the page did not load them)");
  if (!u["/api/v1/inventory/units"]?.units?.length) throw new Error("Could not read the unit names from Ricotta Restaurant");
  const units = Object.fromEntries(u["/api/v1/inventory/units"].units.map((x) => [x.id, x.name]));
  const zonesRaw = c["/api/v1/inventory/zones"];
  const zones = (Array.isArray(zonesRaw) ? zonesRaw : zonesRaw?.zones ?? []).map((z) => z.name).filter((n) => n && !/breakfast/i.test(n));
  const supRaw = c["/api/v1/purchasing/suppliers"];
  const suppliers = (Array.isArray(supRaw) ? supRaw : supRaw?.suppliers ?? []).filter((s) => s.is_active !== false).map((s) => s.name);
  const items = c["/api/v1/inventory/items"].items.filter((i) => i.is_active && i.has_purchase_history && i.name.trim() !== "-").map((i) => {
    // Only the item's own formats, as on its page in Ricotta Restaurant: the counting format and the
    // buying format (the usage unit is the base). Old supplier units left in the conversions list
    // (Veal Kebab's "غرام = 1000", Glass Water's "box") never show up.
    const list = [];
    const add = (name, factor) => { const f = Number(factor); if (name && f > 0 && !(name === (units[i.usage_unit_id] || i.base_unit) && f === 1) && !list.some((u) => u.name === name && u.factor === f)) list.push({ name, factor: f }); };
    add(i.inventory_unit_name, i.inventory_factor_to_base);
    add(i.purchase_unit_name, i.purchase_factor);
    return { name: i.name, base: units[i.usage_unit_id] || i.base_unit, units: list };
  });
  // For transfers: every active item with its counting, base and buying units and its stock in each
  // storage (base units), as Ricotta Restaurant's Stock tab and transfer page show it.
  // Only items that were ever bought (as on the Stock tab), never the ones named "-".
  const titems = c["/api/v1/inventory/items"].items.filter((i) => i.is_active && i.has_purchase_history && i.name.trim() !== "-").map((i) => ({
    name: i.name, base: units[i.usage_unit_id] || i.base_unit,
    count: i.inventory_unit_name ? { name: i.inventory_unit_name, factor: Number(i.inventory_factor_to_base) || 1 } : null,
    buy: i.purchase_unit_name ? { name: i.purchase_unit_name, factor: Number(i.purchase_factor) || 1 } : null,
    stock: Object.fromEntries((i.stocks || []).filter((z) => z.zone_name && !/breakfast/i.test(z.zone_name)).map((z) => [z.zone_name, Number(z.quantity) || 0])),
  }));
  const allZones = (Array.isArray(zonesRaw) ? zonesRaw : zonesRaw?.zones ?? []).map((z) => z.name).filter(Boolean);
  // The usual amounts and routes go with the lists (the server keeps the last ones until Rico has
  // learnt them); they are learnt again once a day, in the background.
  lastCatalogBody = { suppliers, zones: allZones.filter((n) => !/breakfast|بەیانی/i.test(n)), items, titems };
  // sync: this read is for "Check now" in the app, so the server keeps what changed for its answer.
  await api("helper/catalog", { method: "PUT", body: { ...lastCatalogBody, history: historyNow, ...(sync ? { sync: true } : {}) } });
  catalogNow = { suppliers, zones, items, titems, history: historyNow, at: Date.now() };
  learnSoon();
  log(`read ${items.length} items, ${suppliers.length} suppliers, ${zones.length} zones`);
}

/* Picks an option in one of Ricotta Restaurant's search dropdowns: by exact text only. */
async function pick(trigger, text, what) {
  await trigger.click();
  const box = page.getByRole("listbox").last();
  await box.waitFor({ state: "visible", timeout: 8000 });
  const search = page.locator("input[type=search], input[placeholder^='Search']").last();
  if (await search.isVisible().catch(() => false)) await search.fill(String(text).split(" - ")[0].slice(0, 30));
  // Names show as "-" for a moment while the list loads.
  await page.waitForFunction(() => { const o = [...document.querySelectorAll("[role=option]")]; return o.length && o.some((x) => x.textContent.trim() !== "-"); }, null, { timeout: 10_000 }).catch(() => {});
  const opt = box.getByRole("option").filter({ hasText: exact(text) });
  const n = await opt.count();
  if (n !== 1) { await page.keyboard.press("Escape"); stop(`${what} "${text}" was ${n ? "found more than once" : "not found"} in Ricotta Restaurant.`); }
  await opt.first().click();
}
async function typeNumber(input, value) {
  await input.click();
  await input.fill(String(value));
  await page.keyboard.press("Tab");
  const back = digits(await input.inputValue());
  if (Number(back) !== Number(value)) stop(`Typed ${value} but Ricotta Restaurant shows ${back}.`);
}
/* The unit option for a receipt line: the same unit name and the same size. Ricotta Restaurant writes
   the size as "(×6)" and the app as "(6×)", and in a right-to-left name the brackets can come first;
   so the name and the number are read out and compared, never the text as a whole. */
function unitParts(label) {
  const t = String(label || "").replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[\u200e\u200f\u2066-\u2069]/g, "").trim();
  const m = t.match(/\(\s*×?\s*([\d.,]+)\s*×?\s*\)/);
  if (!m) return { name: t, factor: 1 };
  return { name: t.replace(m[0], "").trim(), factor: Number(m[1].replace(/,/g, "")) };
}
function unitMatches(label, want) {
  const a = unitParts(label), w = unitParts(want);
  return a.name === w.name && a.factor === w.factor;
}
async function fill(r) {
  await go("/inventory/new-receipt", r.id);
  await page.getByText("Receipt details").first().waitFor({ timeout: 20_000 });
  if (await page.getByText(/We kept your unsaved receipt/i).isVisible().catch(() => false))
    stop("Ricotta Restaurant has a half-made receipt open from before. Rico did not touch it. Finish or cancel it there, then send this again.");
  const supplierBtn = page.getByRole("button", { name: "Supplier" });
  if (!/^\s*Select\s*$/.test(await supplierBtn.innerText())) stop("The New receipt form in Ricotta Restaurant was not empty. Rico did not touch it.");
  const steps = [];
  await pick(supplierBtn, r.supplier, "Supplier");
  const zoneBtn = page.getByRole("button", { name: "Zone" });
  if ((await zoneBtn.innerText()).trim() !== r.zone) await pick(zoneBtn, r.zone, "Zone");
  // The invoice box only takes Ricotta Restaurant's own number pad.
  const inv = page.getByPlaceholder("e.g. 1024");
  await inv.click();
  for (const d of r.invoice) await page.getByRole("button", { name: d, exact: true }).last().click();
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  if ((await inv.inputValue()).trim() !== r.invoice) stop(`The invoice reads "${await inv.inputValue()}" instead of ${r.invoice}.`);
  if (await page.getByText(/already|same invoice/i).isVisible().catch(() => false)) stop("Ricotta Restaurant says this invoice was already entered for this supplier. Rico stopped and left it for you.");
  steps.push(`Supplier, zone and invoice ${r.invoice} filled in and read back`);
  if (r.currency === "USD") {
    await page.getByRole("button", { name: /USD/ }).click();
    await typeNumber(page.locator("xpath=//*[contains(text(),\"Today's rate\")]/following::input[1]"), r.rate);
    steps.push(`Dollar rate ${r.rate}`);
  } else if (r.delivery) {
    await page.getByRole("button", { name: /No delivery/ }).click();
    await typeNumber(page.locator("xpath=//*[contains(text(),'How much was the delivery')]/following::input[1]"), r.delivery);
    steps.push(`Delivery ${r.delivery}`);
  }
  for (let i = 0; i < r.lines.length; i++) {
    const l = r.lines[i];
    if (i > 0) await page.getByRole("button", { name: /^\s*\+?\s*Add item\s*$/ }).click();
    const itemBtn = page.getByRole("button", { name: /Search item/ }).last();
    await pick(itemBtn, l.item, `Item ${i + 1}`);
    const unitBtn = page.getByRole("button", { name: "Unit" }).nth(i);
    await unitBtn.click();
    const opts = page.getByRole("listbox").last().getByRole("option");
    await opts.first().waitFor({ timeout: 8000 });
    const labels = await opts.allInnerTexts();
    const at = labels.findIndex((x) => unitMatches(x, l.unit));
    if (at < 0) { await page.keyboard.press("Escape"); stop(`Item ${i + 1}: the unit "${l.unit}" is not one of ${l.item}'s units in Ricotta Restaurant.`); }
    await opts.nth(at).click();
    await typeNumber(page.getByLabel("Qty").nth(i), l.qty);
    await typeNumber(page.getByLabel("Unit cost").nth(i), l.cost);
  }
  // Nothing stays selected (the last box's Tab lands on its delete button): a stray key can't change the form.
  await page.evaluate(() => document.activeElement?.blur?.());
  steps.push(`${r.lines.length} items filled in and read back`);
  await verifyForm(r, "after filling it in");
  steps.push("Whole form read back: supplier, zone, invoice, every item, unit, quantity and price match; totals match");
  return steps;
}
/* Reads the whole form back and compares it with the receipt: supplier, zone, invoice, the rate or
   delivery, the number of item lines, and each line's item, unit, quantity and unit cost. Any difference
   at all and Rico stops. Done once the form is filled in, and again just before saving. */
const flat = (x) => String(x ?? "").replace(/[\u200e\u200f\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
async function verifyForm(r, when) {
  const bad = (m) => stop(`Rico checked the form ${when} and stopped: ${m}. Nothing was saved.`);
  const sup = flat(await page.getByRole("button", { name: "Supplier" }).innerText());
  if (sup !== flat(r.supplier)) bad(`the supplier reads "${sup}"`);
  const zone = flat(await page.getByRole("button", { name: "Zone" }).innerText());
  if (zone !== flat(r.zone)) bad(`the zone reads "${zone}"`);
  const inv = flat(await page.getByPlaceholder("e.g. 1024").inputValue());
  if (inv !== r.invoice) bad(`the invoice reads "${inv}"`);
  if (r.currency === "USD") {
    const v = digits(await page.locator("xpath=//*[contains(text(),\"Today's rate\")]/following::input[1]").inputValue());
    if (Number(v) !== Number(r.rate)) bad(`the dollar rate reads ${v}`);
  } else if (r.delivery) {
    const v = digits(await page.locator("xpath=//*[contains(text(),'How much was the delivery')]/following::input[1]").inputValue());
    if (Number(v) !== Number(r.delivery)) bad(`the delivery reads ${v}`);
  }
  const qty = page.getByLabel("Qty"), cost = page.getByLabel("Unit cost"), units = page.getByRole("button", { name: "Unit" });
  const lines = await qty.count();
  if (lines !== r.lines.length) bad(`the form has ${lines} item lines, the receipt has ${r.lines.length}`);
  for (let i = 0; i < r.lines.length; i++) {
    const l = r.lines[i], n = i + 1;
    if (!(await page.getByRole("button", { name: exact(l.item) }).count()) && !(await page.getByText(exact(l.item)).count())) bad(`item ${n} (${l.item}) is not on the form`);
    const u = flat(await units.nth(i).innerText());
    if (!unitMatches(u, l.unit)) bad(`item ${n}'s unit reads "${u}", not "${l.unit}"`);
    const q = digits(await qty.nth(i).inputValue()), c = digits(await cost.nth(i).inputValue());
    if (Number(q) !== Number(l.qty)) bad(`item ${n}'s quantity reads ${q}, not ${l.qty}`);
    if (Number(c) !== Number(l.cost)) bad(`item ${n}'s unit cost reads ${c}, not ${l.cost}`);
  }
  await checkTotals(r);
}
/* Ricotta Restaurant's own total must match ours to the dinar (and to the cent on a USD receipt). */
async function checkTotals(r) {
  const t = R.totals(r);
  const foot = (await page.getByText(/^Total:/).last().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  const nums = [...foot.matchAll(/[\d,]+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
  const ok = r.currency === "USD" ? nums.includes(money(t.total)) && nums.includes(t.iqd) : nums[0] === t.total;
  if (!ok) stop(`Ricotta Restaurant's total reads "${foot}", ours is ${r.currency === "USD" ? `$${t.total} = IQD ${t.iqd}` : `IQD ${t.total}`}.`);
}
async function discard() {
  await page.getByRole("button", { name: /^Cancel$/ }).last().click();
  await page.getByRole("button", { name: /^Discard$/ }).click({ timeout: 8000 });
}

async function save(r) {
  // Still the same receipt on the screen? (After a sign-out Ricotta Restaurant brings the draft back.)
  if (!/\/inventory\/new-receipt/.test(page.url()) || !(await page.getByRole("button", { name: "Supplier" }).innerText()).includes(r.supplier.trim().slice(0, 12))) {
    await go("/inventory/new-receipt", r.id);
    if (!(await page.getByText(/We kept your unsaved receipt/i).isVisible().catch(() => false))) stop("The filled-in receipt was gone from Ricotta Restaurant before saving. Nothing was saved; send it again.");
  }
  // The last look before anything is saved: the whole form again, line by line.
  await verifyForm(r, "just before saving");
  // Recorded before pressing (if it can't be recorded, Rico doesn't press): the app then knows Save may
  // have happened, whatever comes after.
  await report(r.id, { pressed: true, log: ["Whole form checked again just before saving: everything matches. Pressing Save."] });
  pressedSave = true;
  const pressedAt = Date.now();
  await page.getByRole("button", { name: /Receive & send to finance/ }).click();
  const banner = page.getByText(/Receipt sent/i).first();
  await banner.waitFor({ timeout: 45_000 }).catch(() => stop("Ricotta Restaurant did not say the receipt was sent. Check Invoices before doing anything."));
  const text = (await banner.locator("xpath=..").innerText()).replace(/\s+/g, " ");
  await photo(page, r.id, "after");
  const t = R.totals(r);
  // Saved, but with a different amount than ours: never called "saved"; it is shown as a problem to check.
  if (!text.replace(/,/g, "").includes(String(t.iqd))) stop(`Ricotta Restaurant saved it, but its message reads "${text}" and our total is IQD ${t.iqd}. Check this receipt in Invoices.`);
  // Its stock record: the same items and amounts, into the right storage.
  const rec = await checkReceiptRecord(r, pressedAt);
  if (rec.ok === false) stop(`Ricotta Restaurant saved it, but its stock record doesn't match: ${rec.note}. Check this receipt in Invoices.`);
  await report(r.id, { log: [rec.ok ? "Checked in Ricotta Restaurant's stock record: every item and amount arrived in " + r.zone : rec.note + " (the total matched)."] }).catch(() => {});
  lastSaveChecked = rec.ok === true;   // not found in the record: shown as "Check this" in the app
  return text;
}
/* Finds the saved receipt in Invoices (its supplier's own tab, or Purchases) and reads its number. */
async function findInInvoices(r) {
  const wait = capture(["/api/v1/purchasing/receipts/summary"]);
  await go("/inventory/invoices", r.id);
  await wait;
  const own = page.getByRole("button", { name: exact(r.supplier) });
  const tab = (await own.count()) ? r.supplier : "Purchases";
  if (tab !== "Purchases") await own.first().click();
  await page.getByText(`#${r.invoice}`).first().waitFor({ timeout: 20_000 }).catch(() => stop(`Saved, but invoice ${r.invoice} was not found in Invoices (${tab}). Check it there.`));
  const row = page.locator("tr, [role=row], li, div").filter({ hasText: `#${r.invoice}` }).filter({ hasText: r.supplier.slice(0, 10) }).last();
  const first = (await row.innerText()).trim().match(/^(\d+)/);
  await row.click().catch(() => {});
  await sleep(800);
  await photo(page, r.id, "invoices");
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit" }).format(new Date());
  return { tab, month, no: first ? Number(first[1]) : null };
}

/* ---------- One transfer between storages ---------- */
/* Ricotta Restaurant's own stock record since a moment: what really happened there, line by line.
   Read in Rico's own signed-in page with its own sign-in; nothing is changed. Newest first, 100 a page. */
async function movementsSince(sinceMs, types) {
  const since = new Date(sinceMs).toISOString();
  let out = [];
  for (let p = 1; p <= 10; p++) {
    const j = await rrGet(`/api/v1/inventory/movements?page=${p}&size=100`), ms = j.movements || [];
    out = out.concat(ms.filter((m) => types.includes(m.movement_type) && m.created_at >= since));
    if (!ms.length || !j.has_more || ms[ms.length - 1].created_at < since) break;
  }
  return out.map((m) => ({ item: m.item_name, qty: Math.abs(Number(m.quantity)), zone: m.zone_name, other: m.source, day: m.effective_date, at: m.created_at }));
}
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
/* After Move it: Ricotta Restaurant's record must show every item moving out of From into To once, in
   exactly the amount sent (all lines of an item together), on the right day, and nothing else. */
async function checkMoveRecord(t, pressedAt) {
  const items = new Map((catalogNow?.titems ?? []).map((i) => [i.name, i]));
  const need = new Map();
  for (const l of t.lines) {
    const opt = TR.unitOptions(items.get(l.item)).find((o) => o.name === l.unit);
    if (!opt) return { found: false, note: `${l.item}'s unit couldn't be checked` };
    need.set(l.item, (need.get(l.item) ?? 0) + l.qty * opt.factor);
  }
  const day = t.rrYesterday ? t.forDay : null;   // backdated: its record shows the day; otherwise its own today
  let note = "";
  for (let tries = 0; tries < 5; tries++) {
    if (tries) await sleep(2500);
    const rows = await movementsSince(pressedAt - 120_000, ["transfer_out"]).catch(() => null);
    if (!rows) { note = "Rico couldn't read Ricotta Restaurant's stock record"; continue; }
    const mine = rows.filter((m) => flat(m.zone) === flat(t.from) && flat(m.other) === flat(t.to));
    const got = new Map();
    for (const m of mine) got.set(m.item, (got.get(m.item) ?? 0) + m.qty);
    const off = [...need].filter(([n, q]) => !near(got.get(n) ?? 0, q)).map(([n, q]) => `${n}: ${got.get(n) ?? 0} instead of ${q}`);
    const extra = [...got.keys()].filter((n) => !need.has(n));
    const wrongDay = day ? mine.filter((m) => need.has(m.item) && m.day !== day).map((m) => m.item) : [];
    if (!off.length && !extra.length && !wrongDay.length) return { found: true, note: "" };
    note = [off.length ? `amounts in its record differ (${off.join("; ")})` : "", extra.length ? `it also shows ${extra.join(", ")} moved` : "", wrongDay.length ? `not dated ${day}: ${[...new Set(wrongDay)].join(", ")}` : ""].filter(Boolean).join("; ");
  }
  return { found: false, note };
}
/* After Save: one receipt's lines arrive in the stock record together (one moment). That group must
   have exactly our items, amounts (in base units) and storage. */
async function checkReceiptRecord(r, pressedAt) {
  const items = new Map((catalogNow?.items ?? []).map((i) => [i.name, i]));
  const need = new Map();
  for (const l of r.lines) {
    const item = items.get(l.item), opt = !l.unit ? { factor: 1 } : R.unitOptions(item).find((o) => o.label === l.unit);
    if (!item || !opt) return { ok: null, note: `${l.item}'s unit couldn't be checked` };
    need.set(l.item, (need.get(l.item) ?? 0) + l.qty * opt.factor);
  }
  for (let tries = 0; tries < 5; tries++) {
    if (tries) await sleep(2500);
    const rows = await movementsSince(pressedAt - 120_000, ["purchase_in"]).catch(() => null);
    if (!rows) continue;
    const groups = new Map();
    for (const m of rows) groups.set(m.at, [...(groups.get(m.at) ?? []), m]);
    for (const g of groups.values()) {
      const names = new Set(g.map((m) => m.item));
      if (names.size !== need.size || [...need.keys()].some((n) => !names.has(n))) continue;
      const got = new Map();
      for (const m of g) got.set(m.item, (got.get(m.item) ?? 0) + m.qty);
      const off = [...need].filter(([n, q]) => !near(got.get(n), q)).map(([n, q]) => `${n}: ${got.get(n)} instead of ${q}`);
      const zones = [...new Set(g.map((m) => m.zone))].filter((z) => flat(z) !== flat(r.zone));
      return off.length || zones.length ? { ok: false, note: [off.join("; "), zones.length ? `received into ${zones.join(", ")}, not ${r.zone}` : ""].filter(Boolean).join("; ") } : { ok: true, note: "" };
    }
  }
  return { ok: null, note: "Rico couldn't find this receipt in Ricotta Restaurant's stock record" };
}
const treport = (id, body) => api(`helper/transfers/${id}/report`, { method: "POST", body });
const erbilDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dayBefore = (day) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
/* Picks an option in one of the page's search lists by its name exactly (an item's option also shows
   its stock, which is left out of the comparison). */
async function pickByName(trigger, name, what) {
  await trigger.click();
  const box = page.getByRole("listbox").last();
  await box.waitFor({ state: "visible", timeout: 8000 });
  const search = page.locator("input[placeholder^='Search']").last();
  if (await search.isVisible().catch(() => false)) await search.fill(String(name).split(" - ")[0].split(" · ")[0].slice(0, 30));
  await page.waitForFunction(() => { const o = [...document.querySelectorAll("[role=listbox] [role=option]")]; return o.length && o.some((x) => x.textContent.trim() !== "-"); }, null, { timeout: 10_000 }).catch(() => {});
  const hits = await box.getByRole("option").evaluateAll((os, want) => os.map((o, i) => [i, (o.querySelector("span")?.textContent ?? "").replace(/\s+/g, " ").trim()]).filter(([, n]) => n === want).map(([i]) => i), flat(name));
  if (hits.length !== 1) { await page.keyboard.press("Escape"); stop(`${what} "${name}" was ${hits.length ? "found more than once" : "not found"} in Ricotta Restaurant.`); }
  await box.getByRole("option").nth(hits[0]).locator("button").click();
}
/* "3.2 کیلۆ available in Main Storage" read as an amount in base units, using the item's units. */
function availableBase(text, item) {
  const m = flat(text).match(/([\d.,]+)\s*(.*?)\s+available in/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")), opt = TR.unitOptions(item).find((o) => o.name === m[2].trim());
  return opt ? n * opt.factor : null;
}
const transferRows = () => page.locator('main button[aria-haspopup="listbox"]:not([aria-label])');
const rowOf = (i) => page.locator('input[placeholder="amount"]').nth(i).locator('xpath=ancestor::div[.//button[@aria-label="Remove"]][1]');
/* An item with one unit (Parsley: دانە only) has no Unit menu, just the unit as plain text beside
   the amount. Returns the unit shown and the menu button when there is one. */
async function rowUnit(row) {
  const b = row.locator('button[aria-label="Unit"]');
  if (await b.count()) return { button: b, unit: flat(await b.innerText()) };
  const plain = row.locator("div.grid > span").first();
  return { button: null, unit: (await plain.count()) ? flat(await plain.innerText()) : "" };
}
/* The day: "Record for yesterday" puts a transfer on the day before, so it is only done on the day
   after the one it is for; a normal one only on its own day. Anything else would land on a wrong date. */
/* The day: Ricotta Restaurant keeps its own day, which changes at 3:00 in the morning in Erbil (it runs
   on UTC), and its "Record for yesterday" means the day before its own day. So Rico decides from
   Ricotta Restaurant's day: the transfer's day is its today (switch off) or its yesterday (switch on);
   any other day can't be recorded there, and he stops before filling anything in. (On 7 Nov at 2:30
   in the morning its "yesterday" was 5 Nov, which is how 6 Nov's transfers got dated 5 Nov.) */
const rrDay = () => new Date().toISOString().slice(0, 10);
function checkDay(t) {
  const R = rrDay();
  if (!t.forDay) return { yesterday: !!t.yesterday };
  if (t.forDay === R) return { yesterday: false };
  if (t.forDay === dayBefore(R)) return { yesterday: true };
  stop(`This transfer is for ${t.forDay}, but Ricotta Restaurant is on ${R} now (its day changes at 3:00 in the morning, Erbil time), so it can't be recorded on ${t.forDay} there. Nothing was moved. Send it again after 3:00, or with Record for yesterday set for the day it belongs to.`);
}
let tfFillingAt = null;   // the line being filled in, for a readable message if Rico gets stuck
async function fillTransfer(t) {
  tfFillingAt = null;
  t.rrYesterday = checkDay(t).yesterday;
  // Against the lists as they are now (re-read if older than 10 minutes): stock and names.
  if (!catalogNow || Date.now() - catalogNow.at > 2 * 60_000) await readCatalog().catch((e) => log("Could not re-read the lists:", e.message));
  if (catalogNow) {
    const c = TR.check({ from: t.from, to: t.to, yesterday: false, lines: t.lines }, catalogNow, {});
    if (c.errors.length) stop(`This transfer doesn't match Ricotta Restaurant now (${c.errors.map((e) => (e.line ? "item " + e.line + ": " : "") + e.code).join(", ")}). Nothing was moved.`);
  }
  await go("/inventory/transfer", t.id);
  await page.getByText("Move stock between storages").first().waitFor({ timeout: 20_000 });
  const fromB = page.locator('button[aria-label="From storage"]'), toB = page.locator('button[aria-label="To storage"]');
  if (!/Choose/.test(await fromB.innerText())) stop("The Move between storages form in Ricotta Restaurant was not empty. Rico did not touch it.");
  await pickByName(fromB, t.from, "Storage");
  await pickByName(toB, t.to, "Storage");
  const yb = page.getByRole("button", { name: /^Record for yesterday/ });
  if (((await yb.getAttribute("aria-pressed")) === "true") !== !!t.rrYesterday) await yb.click();
  const items = new Map((catalogNow?.titems ?? []).map((i) => [i.name, i]));
  for (let i = 0; i < t.lines.length; i++) {
    const l = t.lines[i];
    tfFillingAt = { n: i + 1, item: l.item };
    if (i > 0) await page.getByRole("button", { name: /Add another item/ }).click();
    await pickByName(transferRows().nth(i), l.item, `Item ${i + 1}`);
    const u = await rowUnit(rowOf(i));
    if (u.unit !== flat(l.unit)) {
      if (!u.button) stop(`Item ${i + 1} (${l.item}) can only be moved in ${u.unit || "one unit"} in Ricotta Restaurant, not ${l.unit}. Nothing was moved.`);
      await pickByName(u.button, l.unit, `Item ${i + 1}'s unit`);
    }
    await typeNumber(page.locator('input[placeholder="amount"]').nth(i), l.qty);
  }
  tfFillingAt = null;
  await page.evaluate(() => document.activeElement?.blur?.());
  await verifyTransfer(t, items, "after filling it in");
  return [`From ${t.from} to ${t.to}${t.yesterday ? ", recorded for yesterday" : ""}`, `${t.lines.length} items filled in, read back and checked against the stock available`];
}
/* Reads the whole form back: storages, Record for yesterday, the number of lines, and each line's
   item, unit and amount, and that each amount is there in the From storage right now. */
async function verifyTransfer(t, items, when) {
  const bad = (m) => stop(`Rico checked the transfer ${when} and stopped: ${m}. Nothing was moved.`);
  const from = flat(await page.locator('button[aria-label="From storage"]').innerText()), to = flat(await page.locator('button[aria-label="To storage"]').innerText());
  if (from !== flat(t.from)) bad(`From reads "${from}"`);
  if (to !== flat(t.to)) bad(`To reads "${to}"`);
  const y = (await page.getByRole("button", { name: /^Record for yesterday/ }).getAttribute("aria-pressed")) === "true";
  if (y !== !!t.rrYesterday) bad(`Record for yesterday is ${y ? "on" : "off"}`);
  const n = await transferRows().count();
  if (n !== t.lines.length) bad(`the form has ${n} items, the transfer has ${t.lines.length}`);
  const need = new Map();
  for (let i = 0; i < t.lines.length; i++) {
    const l = t.lines[i], row = rowOf(i), item = items.get(l.item);
    const name = flat(await transferRows().nth(i).getAttribute("title") ?? await transferRows().nth(i).innerText());
    if (name !== flat(l.item)) bad(`item ${i + 1} reads "${name}", not "${l.item}"`);
    const { unit } = await rowUnit(row);
    if (unit !== flat(l.unit)) bad(`item ${i + 1}'s unit reads "${unit}", not "${l.unit}"`);
    const q = digits(await page.locator('input[placeholder="amount"]').nth(i).inputValue());
    if (Number(q) !== Number(l.qty)) bad(`item ${i + 1}'s amount reads ${q}, not ${l.qty}`);
    const opt = TR.unitOptions(item).find((o) => o.name === l.unit);
    if (!item || !opt) bad(`item ${i + 1}'s unit can't be checked`);
    need.set(l.item, (need.get(l.item) ?? 0) + l.qty * opt.factor);
    const have = availableBase(await row.locator("p", { hasText: "available in" }).innerText().catch(() => ""), item);
    if (have == null) bad(`item ${i + 1}: the stock available couldn't be read`);
    if (need.get(l.item) > have + 1e-9) bad(`item ${i + 1} (${l.item}): only ${TR.inCounting(item, have).qty} ${TR.inCounting(item, have).unit} is in ${t.from} now`);
  }
}
/* After Move it: Ricotta Restaurant either refuses a line in red (and may have moved the others) or
   clears the form. Then the transfer is looked for in Recent transfers. */
async function pressMove(t) {
  // Recorded before pressing (if it can't be recorded, Rico doesn't press): the app then knows Move it
  // may have happened, whatever comes after.
  await treport(t.id, { pressed: true, log: ["Pressing Move it"] });
  pressedMove = true;
  const pressedAt = Date.now();
  await page.getByRole("button", { name: /^Move it$/ }).click();
  // Ricotta Restaurant then shows "Moved! Moved 24 items from Main Storage to Appetizers." with a
  // "Move something else" button, or refuses a line in red ("Insufficient stock ...").
  const outcome = await page.waitForFunction(() => {
    const txt = document.querySelector("main")?.innerText ?? "";
    if (/Insufficient stock|cannot|failed|error/i.test(txt)) return "refused";
    const m = txt.match(/Moved\s+(\d+)\s+items?\s+from\s+(.+?)\s+to\s+(.+?)\.(\s|$)/);
    if (m) return JSON.stringify({ n: +m[1], from: m[2].trim(), to: m[3].trim() });
    const to = document.querySelector('button[aria-label="To storage"]');
    return to && /Choose/.test(to.textContent) ? "cleared" : false;
  }, null, { timeout: 90_000 }).then((h) => h.jsonValue()).catch(() => "unknown");
  if (outcome === "refused") {
    await photo(page, t.id, "after", "transfers").catch(() => {});
    const msg = flat(await page.locator("main").innerText()).match(/(Insufficient stock[^.]*\.|[^.]*(cannot|failed|error)[^.]*\.)/i)?.[0] ?? "a line was refused";
    stop(`Ricotta Restaurant refused part of this transfer: "${msg}". Other lines may have moved. Check Recent transfers there before doing anything.`);
  }
  if (outcome === "unknown") stop("Ricotta Restaurant didn't say the transfer moved, so Rico can't tell whether it did. Check Recent transfers there before doing anything.");
  // The "after" photo is the proof: taken on Ricotta Restaurant's own "Moved!" message.
  await photo(page, t.id, "after", "transfers");
  if (outcome === "cleared") return { found: false, note: "Ricotta Restaurant cleared the form without a Moved message; please check Recent transfers" };
  const said = JSON.parse(outcome);
  const off = [said.n !== t.lines.length ? `${said.n} items, not ${t.lines.length}` : "", flat(said.from) !== flat(t.from) ? `from ${said.from}` : "", flat(said.to) !== flat(t.to) ? `to ${said.to}` : ""].filter(Boolean);
  if (off.length) return { found: false, note: `Ricotta Restaurant said it moved ${off.join(", ")}. Please check Recent transfers` };
  // The proof: Ricotta Restaurant's own stock record, line by line.
  return checkMoveRecord(t, pressedAt);
}
let pressedMove = false;
async function workTransfer(t) {
  pressedMove = false;
  log(`transfer ${t.id.slice(0, 8)} ${t.status} ${t.from} -> ${t.to}`);
  try {
    if (t.status === "filling") {
      const steps = await fillTransfer(t);
      await photo(page, t.id, "before", "transfers");
      if (PRACTICE) {
        await go("/inventory/transfer", t.id);   // a reload clears the form there: nothing moves
        await treport(t.id, { status: "problem", problem: "Practice run: filled in, checked, photographed and cleared. Nothing was moved.", log: [...steps, "Practice: cleared"] });
        return;
      }
      if ((await api(`helper/transfers/${t.id}`)).status === "cancelled") { await go("/inventory/transfer", t.id); await treport(t.id, { log: [...steps, "Cancelled in the app. Cleared in Ricotta Restaurant; nothing was moved."] }); return; }
      // Sent to move without asking again: no second approval; moved now (checked once more first).
      if (t.auto && t.approvedBy) {
        await treport(t.id, { status: "moving", log: [...steps, "Photo taken. Sent to move without asking again: moving now."] });
        t = { ...t, status: "moving", filled: true };
      } else {
      await treport(t.id, { status: "review", log: [...steps, "Photo taken. Waiting for approval."] });
      for (;;) {
        await heartbeat(false);   // still here while waiting for approval (the app shows him on)
        const now = await api(`helper/transfers/${t.id}/wait`, { method: "POST", body: { wait: 50 } });
        if (now.status === "review") continue;
        if (now.status === "cancelled") { await go("/inventory/transfer", t.id); await treport(t.id, { status: "cancelled", log: ["Cleared in Ricotta Restaurant. Nothing was moved."] }); return; }
        if (now.status !== "approved") return;
        await treport(t.id, { status: "moving", log: ["Approval received"] });
        t = { ...now, status: "moving" };
        break;
      }
      }
    }
    if (t.status === "moving" || t.status === "approved") {
      // Filled in again from the start (Ricotta Restaurant keeps no unfinished transfer), checked again
      // against the live stock, then moved.
      const items = new Map((catalogNow?.titems ?? []).map((i) => [i.name, i]));
      if (!t.filled) await fillTransfer(t);   // still filled in when moved without a second approval
      await verifyTransfer(t, items, "just before moving");
      await treport(t.id, { log: [t.filled ? "Checked against the live stock again just before moving: everything matches" : "Filled in again and checked against the live stock just before moving: everything matches"] });
      const r = await pressMove(t);
      await treport(t.id, { status: "moved", result: { checked: r.found, note: r.note || null }, log: [r.found ? `Moved. Checked in Ricotta Restaurant's stock record: all ${t.lines.length} items moved once, in exactly these amounts, ${t.from} to ${t.to}${t.yesterday ? ", dated yesterday" : ""}.` : `Moved, but ${r.note}. Check Recent transfers in Ricotta Restaurant.`] });
      log(`moved ${t.from} -> ${t.to}`);
      await readCatalog().catch(() => {});   // the stock changed: the app shows it at once
    }
  } catch (e) {
    const where = tfFillingAt ? ` on item ${tfFillingAt.n} (${tfFillingAt.item})` : "";
    const msg = e instanceof Stop ? e.message
      : `Rico got stuck${where} and stopped. ${pressedMove ? "Move it was already pressed: check Recent transfers in Ricotta Restaurant before doing anything." : "Nothing was moved; use Copy to send it again."}`;
    log("STOPPED:", msg, e instanceof Stop ? "" : `(${String(e.message).split("\n")[0]})`);
    await photo(page, t.id, "problem", "transfers").catch(() => {});
    if (!pressedMove) await go("/inventory/transfer", t.id).catch(() => {});   // nothing moved: the form is cleared
    await treport(t.id, { status: "problem", problem: msg, log: [msg] }).catch((x) => log("report failed:", x.message));
  }
}

/* ---------- One receipt ---------- */
let pressedSave = false, lastSaveChecked = true;
let catalogNow = null;   // the lists as Rico last read them from Ricotta Restaurant
async function work(r) {
  pressedSave = false;
  log(`receipt ${r.id.slice(0, 8)} ${r.status} ${r.supplier} #${r.invoice}`);
  try {
    if (r.status === "filling") {
      // First a check against Ricotta Restaurant's lists as they are now (re-read if older than 10
      // minutes): an item, unit, supplier or zone renamed or removed since the receipt was sent, and
      // Rico stops before touching anything instead of guessing.
      if (!catalogNow || Date.now() - catalogNow.at > 2 * 60_000) await readCatalog().catch((e) => log("Could not re-read the lists:", e.message));
      if (catalogNow) {
        const c = R.check(r, catalogNow, {}, {});
        if (c.errors.length) stop(`This receipt no longer matches Ricotta Restaurant's lists (${c.errors.map((e) => (e.line ? "item " + e.line + ": " : "") + e.code).join(", ")}). Something was renamed or removed there. Nothing was filled in; fix the receipt and send it again.`);
      }
      const steps = await fill(r);
      await photo(page, r.id, "before");
      if (PRACTICE) {
        await discard();
        await report(r.id, { status: "problem", problem: "Practice run: filled in, photographed and discarded. Nothing was saved.", log: [...steps, "Practice: discarded"] });
        return;
      }
      // Cancelled in the app while Rico was typing: nothing is saved, the form is cleared.
      if ((await api(`helper/receipts/${r.id}`)).status === "cancelled") {
        await discard().catch(() => {});
        await report(r.id, { log: [...steps, "Cancelled in the app. Discarded in Ricotta Restaurant; nothing was saved."] });
        return;
      }
      const now = await report(r.id, { status: "review", log: [...steps, "Photo taken. Waiting for approval."] });
      r = now.status === "approved" ? now : await waitForApproval(r);
      if (!r) return;
    }
    if (r.status === "saving" || r.status === "approved") {
      const text = await save(r);
      const finance = { ...(await findInInvoices(r)), checked: lastSaveChecked };
      // The row number in Invoices is only its place in the list (it moves when Ricotta Restaurant changes its
      // tabs), so the receipt is known by its tab, its invoice number and the day.
      await report(r.id, { status: "saved", finance, log: [`Saved: "${text}"`, `Found in Invoices, ${finance.tab} tab, invoice #${r.invoice} (row ${finance.no ?? "?"} today)`] });
      log(`saved ${finance.tab} invoice #${r.invoice}`);
    }
  } catch (e) {
    const msg = e instanceof Stop ? e.message : `Rico ran into an error: ${e.message}`;
    log("STOPPED:", msg);
    await photo(page, r.id, "problem").catch(() => {});
    // Nothing was saved yet while filling in, so the half-filled form is cleared away. Once saving has
    // started it is never touched: Ricotta Restaurant may already have it.
    if (r.status === "filling" || ((r.status === "saving" || r.status === "approved") && !pressedSave)) await discard().catch(() => {});
    await report(r.id, { status: "problem", problem: msg, log: [msg] }).catch((x) => log("report failed:", x.message));
  }
}
/* Waits (keeping the filled-in form open) until the receipt is approved or cancelled in the app. */
async function waitForApproval(r) {
  for (;;) {
    // The server answers the moment it is approved or cancelled (or after 20 s, then Rico asks again).
    await heartbeat(false);   // still here while waiting for approval (the app shows him on)
    const now = await api(`helper/receipts/${r.id}/wait`, { method: "POST", body: { wait: 50 } });
    // Marked "saving" before anything is pressed: if the Mac stops now, it is never saved a second time.
    if (now.status === "approved") { await report(r.id, { status: "saving", log: ["Approval received"] }); return { ...now, status: "saving" }; }
    if (now.status === "cancelled") {
      await discard().catch(() => {});
      await report(r.id, { status: "cancelled", log: ["Discarded in Ricotta Restaurant. Nothing was saved."] });
      return null;
    }
    if (now.status !== "review") return null;
  }
}

/* ---------- Main loop ---------- */
async function heartbeat(idle) {
  try { return await api("helper/heartbeat", { method: "POST", body: { version: VERSION, signedIn, idle, mode: PRACTICE ? "practice" : "real", sync: true } }); } catch (e) { log("heartbeat:", e.message); return null; }
}
await openBrowser();
// Stopped (Stop Rico, Ctrl+C or closing Terminal): his browser windows close with him.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { try { await browser?.close(); await joiner?.close(); } finally { process.exit(0); } });
log(`Rico ${VERSION}${PRACTICE ? " (practice: nothing is saved)" : ""}`);
// Anything left half way when Rico last stopped is sorted out first (see the API's helper/recover).
await api("helper/recover", { method: "POST" }).then((x) => { if (x?.recovered) log(`picked up ${x.recovered} receipt(s) left half way`); }, (e) => log("recover:", e.message));
let lastCatalog = 0, summaryDay = null;
/* "Check now" in the app: the same read as every 10 minutes, straight away, and how it went. */
async function checkNow() {
  log("Check now: reading the lists from Ricotta Restaurant");
  try {
    await readCatalog({ sync: true });
    lastCatalog = Date.now();
    await api("helper/sync/done", { method: "POST", body: { ok: true } });
  } catch (e) {
    log("Check now failed:", e.message);
    await api("helper/sync/done", { method: "POST", body: { ok: false, error: String(e.message).split("\n")[0] } }).catch((x) => log("check now report:", x.message));
  }
  await restHome();
}
/* Between jobs Rico rests on Ricotta Restaurant's Inventory home page (as Rozha prefers). */
async function restHome() {
  if (new URL(page.url()).pathname === "/inventory") return;
  await go("/inventory").catch((e) => log("home:", e.message));
}
await readCatalog().then(() => { lastCatalog = Date.now(); }, (e) => log("Could not read the lists yet:", e.message));
await restHome();
/* A live screenshot when someone asks for one on Telegram: waits on the server, so it comes in a second
   or two, even while Rico is in the middle of a receipt. */
(async function shots() {
  for (;;) {
    try {
      const w = await api("helper/shot/wait", { method: "POST", body: { wait: 50 } });
      if (!w?.want) continue;
      const img = (await page.screenshot({ type: "jpeg", quality: 70, scale: "css" })).toString("base64");
      const what = await page.title().catch(() => "");
      await api("helper/shot", { method: "POST", body: { chat: w.chat, image: img, caption: `Rico's screen at ${new Date().toLocaleTimeString()}${PRACTICE ? " (practice mode)" : ""}${what ? ": " + what : ""}` } });
      log("sent a live screenshot");
    } catch (e) { log("screenshot:", e.message); await sleep(5000); }
  }
})();
for (;;) {
  const h = await heartbeat(true);
  let waited = false;
  if (h?.checkNow) { await checkNow(); continue; }
  if (h && !h.stopped) {
    // Waits up to 20 s on the server for a receipt (or a Check now), so it starts within a second or two.
    const { receipt, transfer, checkNow: check } = await api("helper/claim", { method: "POST", body: { wait: 50, mode: PRACTICE ? "practice" : "real", transfers: true, sync: true } }).catch((e) => { log("claim:", e.message); return {}; });
    if (check) { await checkNow(); continue; }
    if (receipt) { await work(receipt); await restHome(); continue; }
    if (transfer) { await workTransfer(transfer); await restHome(); continue; }
    waited = true;
  }
  // Every 10 minutes (new items, suppliers and unit changes show up soon); after a failed read, again a minute later.
  if (Date.now() - lastCatalog > (lastCatalog ? 10 * 60_000 : 60_000)) { await readCatalog().then(() => { lastCatalog = Date.now(); }, (e) => { log("Could not read the lists yet:", e.message); lastCatalog = Date.now() - 9 * 60_000; }); await restHome(); }
  // After 22:00 Erbil, once a day: the evening check on Telegram (the server sends it only once).
  if (!PRACTICE && summaryDay !== erbilDay() && +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", hourCycle: "h23" }).format(new Date()) >= 22) {
    summaryDay = erbilDay();
    await api("helper/daily-summary", { method: "POST", body: {} }).catch((e) => log("evening check:", e.message));
  }
  if (!waited) await sleep(3000);
}
