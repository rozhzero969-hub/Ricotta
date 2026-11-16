/* The one-time "How Expenses work" tour (features.js): shown once per account when Expenses are on, saved on
   the account (settings.tourExpenses) on Done or Skip so it never shows again on any device, and it can be
   opened again from Settings, Help. Also: a tap on a setting's words or icon never gives its switch the
   pressed look (only a press on the switch does). Run: node scripts/expenses-tour-smoke.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync('features.js', 'utf8');
const code = src.slice(src.indexOf('const XT_STEPS'));
const opened = [], saved = [], local = {};
let sheetOpen = false;
const ctx = {
  state:{account:'yunis', expensesReady:true, settings:{}, view:'order'},
  canOpen:v=>v === 'order', lget:k=>local[k], lset:(k, v)=>{ local[k] = v; },
  setSetting:(id, v)=>{ saved.push([id, v]); ctx.state.settings[id] = v; },
  document:{ querySelector:sel=>sheetOpen && /sel-sheet/.test(sel) ? {} : null, body:{} },
  setTimeout:()=>0, matchMedia:()=>({matches:false}), esc:s=>String(s), t:k=>k === 'xtStepOf' ? (a, b)=>a + '/' + b : k, kindLabel:k=>k, ICON_PLUS:'',
  MutationObserver:class{ observe(){} disconnect(){} },
};
ctx.openKitchenSheet = ()=>{ opened.push(1); return {el:{isConnected:true, querySelector:()=>({set innerHTML(v){}, onclick:null, addEventListener(){}, focus(){}})}, close(){}}; };
vm.createContext(ctx);
vm.runInContext(code + ';globalThis.maybe=maybeShowExpensesTour;globalThis.open=openExpensesTour;', ctx);
ctx.maybe();
assert.equal(opened.length, 1, 'shown once Expenses are on');
ctx.state.settings.tourExpenses = true; ctx.maybe();
assert.equal(opened.length, 1, 'never again once seen on the account');
ctx.state.settings = {}; local['xtSeen:yunis'] = true; ctx.maybe();
assert.equal(opened.length, 1, 'never again on this device either');
delete local['xtSeen:yunis']; ctx.state.expensesReady = false; ctx.maybe();
assert.equal(opened.length, 1, 'not before the server has Expenses');
ctx.state.expensesReady = true; sheetOpen = true; ctx.maybe();
assert.equal(opened.length, 1, 'waits while another sheet is open');
sheetOpen = false; ctx.open();
assert.equal(opened.length, 2, 'Settings, Help opens it again any time');
// The server keeps the "seen" mark on the account.
const api = fs.readFileSync('supabase/functions/api/index.ts', 'utf8');
assert.match(api, /SETTING_KEYS = new Set\(\[[^\]]*"tourExpenses"/, 'the server saves tourExpenses on the account');
// The switch's pressed look comes only from a press on the switch itself.
const css = fs.readFileSync('style.css', 'utf8'), app = fs.readFileSync('app.js', 'utf8');
assert.ok(!/check-row input\[type=checkbox\]:active::after/.test(css), 'no :active stretch (a tap on the row gave the switch :active)');
assert.match(css, /check-row input\[type=checkbox\]\.pressing::after/, 'the stretch follows .pressing');
assert.match(app, /closest\?\.\('\.check-row input\[type=checkbox\]'\)/, 'pressing is set only by a press on the switch');
console.log('Expenses tour PASS: once per account and device, saved on the server, waits for other sheets, replay from Help; switches only react to a press on the switch');
