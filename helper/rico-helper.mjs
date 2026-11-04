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
import { readSecret } from "./keychain.mjs";
import "../supabase/functions/_shared/receipts.js";

const VERSION = "2026-11-06.1";
const API = "https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/api";
const RR = "https://pos.shaydattendance.com";
const PRACTICE = process.argv.includes("--practice");
const PROFILE = join(homedir(), "Library", "Application Support", "RicoHelper", "browser");
const TOKEN = readSecret("helper-token");
if (!TOKEN) { console.log("Rico is not set up yet. Run: node helper/setup.mjs"); process.exit(1); }
const R = globalThis.RicottaReceipts;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Ricotta Orders ---------- */
async function api(path, { method = "GET", body } = {}) {
  for (let tries = 0; ; tries++) {
    try {
      const res = await fetch(`${API}/${path}`, { method, headers: { "content-type": "application/json", "x-helper-token": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
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
async function joinPhotos(pieces, height, view) {
  joiner ??= await chromium.launch({ headless: true });
  const p = await joiner.newPage();
  try {
    return await p.evaluate(async ({ pieces, height, view }) => {
      const imgs = await Promise.all(pieces.map((x) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = "data:image/png;base64," + x.b64; })));
      // Pixels per page point, made at most 1400 wide so the photo stays small enough to send.
      const fit = Math.min(1, 1400 / imgs[0].width), scale = (imgs[0].height / view) * fit, c = document.createElement("canvas");
      c.width = Math.round(imgs[0].width * fit); c.height = Math.round(height * scale);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      imgs.forEach((img, k) => g.drawImage(img, 0, Math.round(pieces[k].y * scale), c.width, Math.round(img.height * fit)));
      return c.toDataURL("image/jpeg", 0.82).split(",")[1];
    }, { pieces, height, view });
  } finally { await p.close(); }
}
async function photo(page, id, kind) {
  const upload = (b64) => api(`helper/receipts/${id}/photo`, { method: "POST", body: { kind, image: b64 } });
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
    const step = Math.max(200, view - 60), pieces = [];
    for (let y = 0; ; y += step) {
      const at = Math.min(y, height - view);
      await box.evaluate((el, v) => el.scrollTo(0, v), at);
      await sleep(350);
      pieces.push({ y: at, b64: (await box.asElement().screenshot({ type: "png" })).toString("base64") });
      if (at >= height - view || pieces.length >= 12) break;
    }
    await box.evaluate((el) => el.scrollTo(0, 0));
    try { await upload(await joinPhotos(pieces, height, view)); }
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
async function readCatalog() {
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
  const conv = c["/api/v1/purchasing/conversions"] ?? [];
  const zonesRaw = c["/api/v1/inventory/zones"];
  const zones = (Array.isArray(zonesRaw) ? zonesRaw : zonesRaw?.zones ?? []).map((z) => z.name).filter((n) => n && !/breakfast/i.test(n));
  const supRaw = c["/api/v1/purchasing/suppliers"];
  const suppliers = (Array.isArray(supRaw) ? supRaw : supRaw?.suppliers ?? []).filter((s) => s.is_active !== false).map((s) => s.name);
  const items = c["/api/v1/inventory/items"].items.filter((i) => i.is_active && i.has_purchase_history && i.name.trim() !== "-").map((i) => {
    const list = [];
    const add = (name, factor) => { const f = Number(factor); if (name && f > 0 && !list.some((u) => u.name === name && u.factor === f)) list.push({ name, factor: f }); };
    conv.filter((x) => x.inventory_item_id === i.id && x.is_active).forEach((x) => add(x.supplier_unit_name, x.multiplier_to_base));
    return { name: i.name, base: units[i.usage_unit_id] || i.base_unit, units: list };
  });
  await api("helper/catalog", { method: "PUT", body: { suppliers, zones, items } });
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
  steps.push(`${r.lines.length} items filled in and read back`);
  await checkTotals(r);
  steps.push("Totals match");
  return steps;
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
  await checkTotals(r);
  await page.getByRole("button", { name: /Receive & send to finance/ }).click();
  const banner = page.getByText(/Receipt sent/i).first();
  await banner.waitFor({ timeout: 45_000 }).catch(() => stop("Ricotta Restaurant did not say the receipt was sent. Check Invoices before doing anything."));
  const text = (await banner.locator("xpath=..").innerText()).replace(/\s+/g, " ");
  await photo(page, r.id, "after");
  const t = R.totals(r);
  if (!text.replace(/,/g, "").includes(String(t.iqd))) await report(r.id, { log: [`The green message reads "${text}"; checking Invoices.`] });
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

/* ---------- One receipt ---------- */
async function work(r) {
  log(`receipt ${r.id.slice(0, 8)} ${r.status} ${r.supplier} #${r.invoice}`);
  try {
    if (r.status === "filling") {
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
      const finance = await findInInvoices(r);
      await report(r.id, { status: "saved", finance, log: [`Saved: "${text}"`, `Found in Invoices, ${finance.tab} #${finance.no ?? "?"}`] });
      log(`saved ${finance.tab} #${finance.no}`);
    }
  } catch (e) {
    const msg = e instanceof Stop ? e.message : `Rico ran into an error: ${e.message}`;
    log("STOPPED:", msg);
    await photo(page, r.id, "problem").catch(() => {});
    // Nothing was saved yet while filling in, so the half-filled form is cleared away. Once saving has
    // started it is never touched: Ricotta Restaurant may already have it.
    if (r.status === "filling") await discard().catch(() => {});
    await report(r.id, { status: "problem", problem: msg, log: [msg] }).catch((x) => log("report failed:", x.message));
  }
}
/* Waits (keeping the filled-in form open) until the receipt is approved or cancelled in the app. */
async function waitForApproval(r) {
  for (;;) {
    await sleep(3000);
    const now = await api(`helper/receipts/${r.id}`);
    if (now.status === "approved") { await api(`helper/receipts/${r.id}/report`, { method: "POST", body: { log: ["Approval received"] } }); return { ...now, status: "saving" }; }
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
  try { return await api("helper/heartbeat", { method: "POST", body: { version: VERSION, signedIn, idle } }); } catch (e) { log("heartbeat:", e.message); return null; }
}
await openBrowser();
log(`Rico ${VERSION}${PRACTICE ? " (practice: nothing is saved)" : ""}`);
// Anything left half way when Rico last stopped is sorted out first (see the API's helper/recover).
await api("helper/recover", { method: "POST" }).then((x) => { if (x?.recovered) log(`picked up ${x.recovered} receipt(s) left half way`); }, (e) => log("recover:", e.message));
let lastCatalog = 0;
await readCatalog().then(() => { lastCatalog = Date.now(); }, (e) => log("Could not read the lists yet:", e.message));
for (;;) {
  const h = await heartbeat(true);
  if (h && !h.stopped) {
    const { receipt } = await api("helper/claim", { method: "POST" }).catch((e) => { log("claim:", e.message); return {}; });
    if (receipt) { await work(receipt); continue; }
  }
  // Every 30 minutes; after a failed read, again a minute later.
  if (Date.now() - lastCatalog > (lastCatalog ? 30 * 60_000 : 60_000)) await readCatalog().then(() => { lastCatalog = Date.now(); }, (e) => { log("Could not read the lists yet:", e.message); lastCatalog = Date.now() - 29 * 60_000; });
  await sleep(5000);
}
