// Rico finds a saved receipt in Invoices: in the supplier's own tab when it has one (the tab bar is drawn
// a moment after the data), otherwise in Purchases, and an invoice he can't find is reported (never thrown),
// so a saved receipt is never marked "stopped" for it. Runs Rico's real findInInvoices against a small
// page that behaves like Ricotta Restaurant's Invoices page, with the tabs drawn late.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright";

const src = await readFile(new URL("../helper/rico-helper.mjs", import.meta.url), "utf8");
const from = src.indexOf("async function findInInvoices(r) {"), to = src.indexOf("/* ---------- One transfer between storages ---------- */");
assert.ok(from > 0 && to > from, "findInInvoices is in the helper");
const code = src.slice(from, to);

// A page like Invoices: "Purchases" appears at once, a supplier's own tab appears after `late` ms; each tab
// lists its receipts after a click; the three suppliers' receipts are only in their own tab. The page is
// built from this test's own settings (never from the request), as JSON with "<" escaped.
let setup = { own: null, late: 0 };
const pageHtml = () => {
  const cfg = JSON.stringify({ own: setup.own && { name: setup.own, rows: [`#98875 ${setup.own}`, `#98698 ${setup.own}`] }, late: setup.late }).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset=utf-8><main><div id=bar></div><div id=list></div></main><script>
const cfg = ${cfg};
const tabs = { Purchases: ['#3673 Bread House Bakery', '#013 Gomrg'] }; if (cfg.own) tabs[cfg.own.name] = cfg.own.rows;
const bar = document.getElementById('bar'), list = document.getElementById('list');
function show(name){ list.textContent = ''; for (const t of tabs[name]) { const d = document.createElement('div'); d.setAttribute('role', 'row'); d.textContent = t; list.appendChild(d); } }
function add(name){ const b = document.createElement('button'); b.textContent = name; b.onclick = () => show(name); bar.appendChild(b); }
setTimeout(() => { add('Purchases'); show('Purchases'); }, 150);
if (cfg.own) setTimeout(() => add(cfg.own.name), cfg.late);
</script>`;
};

const server = http.createServer((_req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(pageHtml()); });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(), page = await browser.newPage();

async function run(receipt, opts) {
  setup = { own: opts?.own ?? null, late: opts?.late ?? 0 };
  const stub = { page, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), capture: async (_paths, load) => { await load(); return {}; }, photo: async () => {},
    go: async () => { await page.goto(base); }, exact: (s) => new RegExp(`^\\s*${String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), stop: (m) => { throw new Error(m); } };
  const fn = new Function(...Object.keys(stub), `${code}; return findInInvoices;`)(...Object.values(stub));
  return fn(receipt);
}
const base_ = { id: "r1", supplier: "کۆگای مختار", invoice: "98875" };
try {
  // 1. The supplier's own tab is drawn 2 seconds after the page (the bug: Rico looked in Purchases only).
  let f = await run(base_, { own: "کۆگای مختار", late: 2000 });
  assert.equal(f.tab, "کۆگای مختار", "found in the own tab even though it was drawn late");
  assert.equal(f.missing, undefined);
  // 2. A supplier without an own tab: found in Purchases.
  f = await run({ id: "r2", supplier: "Bread House Bakery", invoice: "3673" });
  assert.equal(f.tab, "Purchases", "no own tab: Purchases");
  // 3. Invoice #3673 is present, but #367 must still be reported missing.
  f = await run({ id: "r3", supplier: "Bread House Bakery", invoice: "367" });
  assert.ok(Array.isArray(f.missing) && f.missing.includes("Purchases") && f.tab === "", "an invoice number prefix is not a match");
  // The receipt worker can only clear its own form, and invoice lookup is evidence after Save.
  const workSource = src.slice(src.indexOf("async function work(r) {"), src.indexOf("/* Waits (keeping the filled-in form open)"));
  class Stop extends Error {}
  async function runWorker(status, { ownsForm = false } = {}) {
    const events = [];
    const dependencies = {
      page: {}, log: () => {}, Stop, catalogNow: { at: Date.now() }, R: { check: () => ({ errors: [] }) },
      fill: async (_r, takeForm) => { if (ownsForm) takeForm(); throw new Stop("Rico could not fill this receipt."); },
      save: async () => "Receipt sent", findInInvoices: async () => { throw new Error("Invoices did not load"); },
      erbilDay: () => "2026-11-27", photo: async () => { events.push("photo"); },
      discard: async () => { events.push("discard"); }, report: async (_id, result) => { events.push(result); },
    };
    const work = new Function(...Object.keys(dependencies),
      `let pressedSave = false, lastSaveChecked = true; ${workSource}; return work;`)(...Object.values(dependencies));
    await work({ ...base_, status });
    return events;
  }
  let events = await runWorker("filling");
  assert.deepEqual(events.map((e) => e.status), ["problem"], "a receipt opened by someone else is neither photographed nor discarded");
  events = await runWorker("filling", { ownsForm: true });
  assert.deepEqual(events.slice(0, 2), ["photo", "discard"], "Rico still cleans up the form he filled");
  events = await runWorker("approved");
  assert.equal(events[0].status, "saved", "a confirmed save stays saved if invoice lookup throws");
  assert.equal(events[0].finance.checked, false);
  console.log("Rico invoices PASS: late supplier tab, missing invoice, owned form cleanup, and saved receipt status when lookup fails");
} finally { await browser.close(); server.close(); }
