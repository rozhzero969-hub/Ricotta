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

// A page like Invoices: "Purchases" appears at once, a supplier's own tab appears after `lateMs`; each tab
// lists its receipts after a click; the three suppliers' receipts are only in their own tab.
const pageHtml = (own, lateMs) => `<!doctype html><meta charset=utf-8><main>
<div id=bar></div><div id=list></div></main><script>
const tabs = { Purchases: ['#3673 Bread House Bakery', '#013 Gomrg'], ${own ? `"${own.name}": ['${own.rows.join("', '")}']` : ""} };
const bar = document.getElementById('bar'), list = document.getElementById('list');
function show(name){ list.innerHTML = tabs[name].map(t => '<div role=row>' + t + '</div>').join(''); }
function add(name){ const b = document.createElement('button'); b.textContent = name; b.onclick = () => show(name); bar.appendChild(b); }
setTimeout(() => { add('Purchases'); show('Purchases'); }, 150);
${own ? `setTimeout(() => add("${own.name}"), ${lateMs});` : ""}
</script>`;

const server = http.createServer((req, res) => { const u = new URL(req.url, "http://x"); res.setHeader("content-type", "text/html; charset=utf-8"); res.end(pageHtml(u.searchParams.get("own") ? { name: u.searchParams.get("own"), rows: ["#98875 " + u.searchParams.get("own"), "#98698 " + u.searchParams.get("own")] } : null, +(u.searchParams.get("late") || 0))); });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(), page = await browser.newPage();

async function run(receipt, query) {
  const stub = { page, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), capture: () => Promise.resolve({}), photo: async () => {},
    go: async () => { await page.goto(`${base}/?${query}`); }, exact: (s) => new RegExp(`^\\s*${String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), stop: (m) => { throw new Error(m); } };
  const fn = new Function(...Object.keys(stub), `${code}; return findInInvoices;`)(...Object.values(stub));
  return fn(receipt);
}
const base_ = { id: "r1", supplier: "کۆگای مختار", invoice: "98875" };
try {
  // 1. The supplier's own tab is drawn 2 seconds after the page (the bug: Rico looked in Purchases only).
  let f = await run(base_, `own=${encodeURIComponent("کۆگای مختار")}&late=2000`);
  assert.equal(f.tab, "کۆگای مختار", "found in the own tab even though it was drawn late");
  assert.equal(f.missing, undefined);
  // 2. A supplier without an own tab: found in Purchases.
  f = await run({ id: "r2", supplier: "Bread House Bakery", invoice: "3673" }, "");
  assert.equal(f.tab, "Purchases", "no own tab: Purchases");
  // 3. An invoice that isn't there: reported, not thrown (the receipt stays saved).
  f = await run({ id: "r3", supplier: "Bread House Bakery", invoice: "999999" }, "");
  assert.ok(Array.isArray(f.missing) && f.missing.includes("Purchases") && f.tab === "", "not found: reported with where he looked");
  console.log("Rico invoices PASS: the supplier's own tab drawn late is still used, Purchases otherwise, and a missing invoice is reported instead of stopping the receipt");
} finally { await browser.close(); server.close(); }
