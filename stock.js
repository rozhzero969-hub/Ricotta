/* Ricotta Orders -- stock, transfers and item setup.
   Talks to the `stock-api` Edge Function (same PIN session as the rest of the
   app). Stock is counted in each item's COUNTING format; orders keep using its
   BUYING format (item.unit). An item can be counted and transferred only after
   its counting format is set up. Nothing here changes orders.
   Depends (at call time only) on app.js: state, t, esc, toast, render, goView,
   unitName, unitLabel, nameCollator, emptyState, showFormModal, showConfirm,
   showAlert, formatIraqDateTime, dayLabel, accountLabel, editingBanner,
   supplierName, ICON_* and NAV_ICONS. Loaded before app.js. */

const STOCK_API_URL = `${SUPABASE_URL}/functions/v1/stock-api`;
const ST_ACTIVE = ['waiting', 'running', 'needs_checking'];
const stockState = {groups: [], tabs: null, loaded: false, failed: false, storages: [], settings: new Map(), balances: new Map(), requests: [], counts: [], control: null, sig: '', shots: {}, lastLight: 0};
const trState = {from: '', to: '', itemId: '', qty: '', unit: 'counting', yesterday: false, search: '', reviewKey: null, lines: [], lineKeys: {}};
const stView = {storage: 'all', filter: 'all', search: '', group: ''};
const histView = {filter: 'all'};
const itemsView = {filter: 'all', search: ''};
const supView = {tab: 'suppliers'};
/* Account data and unfinished workplace actions never carry into another sign-in. */
function resetStockUi(){
  stockReadGeneration++; stockReads.clear();
  Object.assign(stockState, {groups: [], tabs: null, loaded: false, failed: false, storages: [], settings: new Map(), balances: new Map(), requests: [], counts: [], control: null, sig: '', shots: {}, lastLight: 0});
  trReset();
  Object.assign(stView, {storage: 'all', filter: 'all', search: '', group: ''});
  histView.filter = 'all'; Object.assign(itemsView, {filter: 'all', search: ''}); supView.tab = 'suppliers';
  Object.assign(rcState, {supplierId: '', invoice: '', currency: 'IQD', rate: '', delivery: false, deliveryAmt: '', lines: [rcNewLine()], key: null, keyBody: null});
  Object.assign(rcData, {list: [], loaded: false, at: 0, shots: {}, loadingShot: {}});
  Object.assign(ijData, {list: [], loaded: false, at: 0, shots: {}, loadingShot: {}});
  wpSendKeys.clear();
}

/* ============ API + data ============ */
const stockReads = new Map();
let stockReadGeneration = 0;
function stockApi(path, options = {}){
  const session = apiSession();
  if(!apiAccountMatchesUi(session)) return Promise.resolve(staleApiReply());
  const key = `${session?.token || ''}|${path}`;
  if((options.method || 'GET') !== 'GET'){
    // A refresh after a write must make a new request, even if an earlier
    // read is still waiting on the network.
    stockReads.clear();
    stockReadGeneration++;
    return stockApiRequest(path, options).finally(()=>{ stockReadGeneration++; stockReads.clear(); });
  }
  if(stockReads.has(key)) return stockReads.get(key);
  const generation = stockReadGeneration;
  const pending = stockApiRequest(path, options).then(r=>generation === stockReadGeneration ? r : staleApiReply()).finally(()=>{
    if(stockReads.get(key) === pending) stockReads.delete(key);
  });
  stockReads.set(key, pending);
  return pending;
}
async function stockApiRequest(path, {method = 'GET', body, timeout = 20000} = {}){
  const s = apiSession();
  if(!apiAccountMatchesUi(s)) return staleApiReply();
  const sessionCurrent = ()=>apiSessionMatches(s) && apiAccountMatchesUi(s);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  const headers = {'Content-Type': 'application/json'};
  if(s) headers['x-session-token'] = s.token;
  try{
    const res = await fetch(`${STOCK_API_URL}/${path}`, {method, headers, signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body)});
    if(!sessionCurrent()) return staleApiReply();
    const data = await res.json().catch(()=>null);
    if(!sessionCurrent()) return staleApiReply();
    if(res.status === 401 && s){ clearApiSession(); onSessionExpired(); }
    return {ok: res.ok, status: res.status, data};
  }catch(e){ return !sessionCurrent() ? staleApiReply() : {ok: false, status: 0, data: null}; }
  finally{ clearTimeout(timer); }
}
function stApplyLive(d){
  stockState.requests = d.requests || [];
  stockState.control = d.control || null;
  const b = new Map();
  for(const x of d.balances || []) b.set(x.itemId + '|' + x.storage, x.quantity);
  stockState.balances = b;
  stockState.sig = JSON.stringify([stockState.requests, [...b], stockState.control && [stockState.control.workerOnline, stockState.control.launcherOnline, stockState.control.signinCheckedAt, stockState.control.signinRequestedAt, stockState.control.workerProblem, stockState.control.startPending]]);
}
async function loadStock(){
  const r = await stockApi('bootstrap');
  if(r.stale) return false;
  if(!r.ok || !r.data){ stockState.failed = true; return false; }
  const d = r.data;
  stockState.storages = d.storages || [];
  stockState.settings = new Map((d.settings || []).map(s => [s.itemId, s]));
  stockState.counts = d.counts || [];
  stockState.tabs = Array.isArray(d.tabs) ? d.tabs : null;
  stockState.groups = Array.isArray(d.groups) ? d.groups : [];
  if(stView.group && !stockState.groups.some(g => g.id === stView.group)) stView.group = '';
  stApplyLive(d);
  stockState.loaded = true; stockState.failed = false;
  stockState.lastLight = Date.now();
  return true;
}
/* The small refresh: only requests and balances. Repaints only when something changed. */
async function refreshStockLight(){
  stockState.lastLight = Date.now();
  const before = stockState.sig;
  const r = await stockApi('requests');
  if(!r.ok || !r.data) return false;
  stApplyLive(r.data);
  if(stockState.sig !== before) stRepaint();
  else if(state.view === 'transfers') trPaintActive();
  updateStockBadges();
  return true;
}
/* Screens call this when they open: refresh, but not more than once every few seconds. */
function stRefreshIfStale(){ if(Date.now() - stockState.lastLight > 6000) refreshStockLight(); }
setInterval(()=>{
  if(!state.account || document.hidden || !stockState.loaded) return;
  const active = stockState.requests.some(r => ST_ACTIVE.includes(r.status));
  const onStockView = ['transfers', 'stock', 'history'].includes(state.view);
  if((active || onStockView) && Date.now() - stockState.lastLight > (active ? 10000 : 40000)) refreshStockLight();
}, 5000);

/* ============ Helpers ============ */
/* A list glides in the first time it appears, not on every keystroke while searching. */
function fxOnce(box){
  if(box.dataset.fx) return;
  box.dataset.fx = '1'; box.classList.add('fx-rise');
  setTimeout(() => box.classList.remove('fx-rise'), 700);
}
const stItem = id => state.items.find(i => i.id === id);
const stSetting = id => stockState.settings.get(id);
const stReady = item => !!(item && item.unit && stSetting(item.id));
const stQty = (id, storage) => stockState.balances.get(id + '|' + storage) || 0;
function stTotal(id){ let n = 0; for(const [k, v] of stockState.balances) if(k.startsWith(id + '|')) n += v; return n; }
const stReserved = (id, storage) => stockState.requests.filter(r => r.itemId === id && r.from === storage && ST_ACTIVE.includes(r.status)).reduce((n, r) => n + r.quantity, 0);
const stFree = (id, storage) => Math.max(0, stQty(id, storage) - stReserved(id, storage));
/* Wraps a name so Kurdish or Arabic words inside an English sentence (or the reverse) don't reorder the numbers around them. */
const iso = x => '\u2068' + x + '\u2069';
const fmtQty = n => Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 6});
const stScrollBehavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
/* A row of tappable choices that stands in for a dropdown. The chosen value lives in a hidden input with the given id. */
function chipPickHtml(id, options, selected){
  return `<div class="picks" data-chipfor="${esc(id)}" role="radiogroup">${options.map(x => `<button type="button" role="radio" class="pick${x === selected ? ' on' : ''}" aria-checked="${x === selected}" data-val="${esc(x)}">${esc(x)}</button>`).join('')}</div><input type="hidden" id="${esc(id)}" value="${esc(selected)}">`;
}
function chipPickWire(box, id, onChange){
  const input = box.querySelector('#' + id), row = box.querySelector(`[data-chipfor="${id}"]`);
  row.onclick = e => {
    const b = e.target.closest('[data-val]'); if(!b) return;
    input.value = b.dataset.val;
    row.querySelectorAll(".pick").forEach(c => { const on = c === b; c.classList.toggle("on", on); c.setAttribute('aria-checked', on); });
    if(onChange) onChange(input.value);
  };
}
const stUnitObj = id => state.units.find(u => u.id === id);
const stCountUnitName = id => { const u = stUnitObj(stSetting(id)?.countingUnit); return u ? unitName(u) : ''; };
/* The units an amount can be entered in: the counting format, the buying format (1 box = 12 piece) and the
   recipe unit (1 kilo = 1000 gram), each once. `factor` is how many counting units one entered unit is. */
function stUnitChoices(id){
  const s = stSetting(id), item = stItem(id); if(!s || !item) return [];
  const out = [], seen = new Set();
  const add = (mode, unitId, factor) => { const u = stUnitObj(unitId); if(u && !seen.has(unitId) && factor > 0 && Number.isFinite(factor)){ seen.add(unitId); out.push({mode, unitId, factor, label: unitName(u), en: u.en || ''}); } };
  add('counting', s.countingUnit, 1);
  if(item.unit) add('buying', item.unit, Number(s.perBuying));
  if(s.usageUnit) add('usage', s.usageUnit, 1 / Number(s.perCountingUsage));
  return out;
}
const stHasBoth = id => stUnitChoices(id).length > 1;
const stChoice = (id, mode = trState.unit) => { const c = stUnitChoices(id); return c.find(x => x.mode === mode) || c[0]; };
const stMode = (id, mode) => stChoice(id, mode)?.mode || 'counting';
const stFactor = (id, mode) => stChoice(id, mode)?.factor || 1;          // counting units in one entered unit
const stEnteredUnit = (id, mode) => stUnitObj(stChoice(id, mode)?.unitId);
const stEnteredName = (id, mode) => { const u = stEnteredUnit(id, mode); return u ? unitName(u) : ''; };
const stEnteredId = (id, mode) => stEnteredUnit(id, mode)?.id;
const stEnteredEn = (id, mode) => stEnteredUnit(id, mode)?.en || '';
/* How a request's amount reads: what was typed, plus the counting-unit amount when they differ. */
function reqAmountHtml(r){
  const q = r.enteredQuantity ?? r.quantity, u = r.enteredUnitLabel ?? r.unitLabel;
  const extra = u !== r.unitLabel ? ` <span class="tr-eq">= ${esc(fmtQty(r.quantity))} ${esc(r.unitLabel)}</span>` : '';
  return `${esc(fmtQty(q))} ${esc(u)}${extra}`;
}
const stIsLow = item => { const s = stSetting(item.id); return !!s && s.lowStock != null && stTotal(item.id) <= s.lowStock; };
const stLowCount = () => state.items.filter(i => stReady(i) && stIsLow(i)).length;
const stReadyItems = () => state.items.filter(stReady);
const stTokens = q => foldText(String(q || '').trim()).split(/\s+/).filter(Boolean);
/* The name inside the workplace system (what the PC searches for); the same as the app name unless one was set. */
const stWorkName = id => stSetting(id)?.workplaceName || stItem(id)?.name || '';
const stMatches = (item, tokens) => { const n = foldText(item.name + ' ' + (stSetting(item.id)?.workplaceName || '')); return tokens.every(x => n.includes(x)); };
const stNeedsChecking = () => new Set(stockState.requests.filter(r => r.status === 'needs_checking').map(r => r.batchId || r.id)).size;
/* The state of a request as shown to people. */
function reqState(r){
  const fresh = r.previewedAt && Date.now() - new Date(r.previewedAt).getTime() < 20 * 60 * 1000;
  const shot = stockState.shots[r.id];
  if(r.status === 'waiting'){
    if(r.finalApprovedAt) return {label: t('trStApproved'), cls: 'ready'};
    if(r.previewStatus === 'ok' && fresh) return {label: t('trStReady'), cls: 'ready', canApprove: !!(shot && shot.check)};
    if(r.previewStatus === 'failed') return {label: t('trStFailedCheck'), cls: 'bad'};
    return {label: t('trStWaiting'), cls: 'wait'};
  }
  return ({running: {label: t('trStRunning'), cls: 'run'}, completed: {label: t('trStDone'), cls: 'ok'},
    failed: {label: t('trStFailed'), cls: 'off'}, needs_checking: {label: t('trStNeeds'), cls: 'bad'}})[r.status] || {label: r.status, cls: 'off'};
}
function stAttentionHtml(){
  const n = stNeedsChecking();
  if(!n) return '';
  return `<div class="st-alert" role="alert"><span>${esc(t('trAttention')(n))}</span>${state.view === 'history' ? '' : `<button class="btn btn-ghost" data-stgohistory>${esc(t('trOpenHistory'))}</button>`}</div>`;
}
function stLoadingHtml(){
  if(stockState.failed) return `${emptyState(esc(t('stLoadFailed')))}<div class="action-row"><button class="btn btn-primary add-btn" data-stretry>${ICON_REFRESH} ${esc(t('retry'))}</button></div>`;
  return `<div class="st-loading">${esc(t('splashLoading'))}</div>`;
}
function attachStockCommon(){
  document.querySelectorAll('[data-stgohistory]').forEach(b => b.onclick = () => goView('history'));
  document.querySelectorAll('[data-stretry]').forEach(b => b.onclick = async () => { stockState.failed = false; render(); await loadStock(); render(); });
}
function updateStockBadges(){
  const dotFor = (view, on) => { const dot = document.querySelector(`.navbtn[data-view="${view}"] .nav-badge`); if(dot) dot.hidden = !on; };
  const readyToApprove = stockState.requests.some(r => r.status === 'waiting' && !r.finalApprovedAt && r.previewStatus === 'ok');
  const transfersOn = stockState.loaded && (stNeedsChecking() > 0 || readyToApprove);
  const stockOn = stockState.loaded && stLowCount() > 0;
  dotFor('transfers', transfersOn); dotFor('stock', stockOn);
  const more = document.getElementById('navMoreBtn');
  if(more){
    const ricoOn = !state.tabs.includes('assistant') && !!(ricoLateOrders().length || ricoUnread());
    const otherOn = (!state.tabs.includes('transfers') && transfersOn) || (!state.tabs.includes('stock') && stockOn);
    more.classList.toggle('has-badge', ricoOn || otherOn);
  }
}
/* Repaint after a background refresh without disturbing what someone is typing. */
/* The PC worker: on/off, and a button that asks the office PC to start it. */
/* The PC worker's health: off, starting, running and ready, running in test mode, or needing attention. */
function workerState(){
  const c = stockState.control; if(!c) return null;
  const on = c.workerOnline;
  const waiting = !on && c.startRequestedAt && Date.now() - Date.parse(c.startRequestedAt) < 3 * 60 * 1000;
  // The button always works: with the office PC away, the start is kept and happens as soon as the PC is back.
  if(!on && !c.launcherOnline) return c.startPending
    ? {cls: 'off', label: t('wkWaitingPc'), hint: t('wkHintWillStart'), button: true, canStart: false}
    : {cls: 'off', label: t('wkOff'), hint: t('wkHintPcAway'), button: true, canStart: true};
  // The PC explains a failed start; that beats "Starting…" or silence.
  const problem = !waiting && c.workerProblem ? t('wkHintProblem') + c.workerProblem : '';
  if(!on) return {cls: problem ? 'warn' : 'off', label: waiting ? t('wkStarting') : t('wkOff'), hint: problem, button: true, canStart: !waiting};
  if(c.workerPageReady === false) return {cls: 'warn', label: t('wkAttention'), hint: t('wkHintSignIn')};
  if(c.workerLive === false) return {cls: 'test', label: t('wkTest'), hint: t('wkHintTest')};
  return {cls: 'on', label: c.workerLive ? t('wkReady') : t('wkOn'), hint: c.workerLive ? t('wkHintReady') : ''};
}
function workerBarHtml(){
  const w = workerState(); if(!w) return '';
  return `<div class="tr-worker glass ${w.cls}"><div class="tr-worker-txt"><span class="tr-worker-dot" aria-hidden="true"></span><div><b>${esc(t('wkTitle'))}: ${esc(w.label)}</b>${w.hint ? `<small>${esc(w.hint)}</small>` : ''}</div></div>${w.button ? `<button type="button" class="btn btn-primary" id="wkStart" ${w.canStart ? '' : 'disabled'}>${esc(t('wkTurnOn'))}</button>` : ''}</div>${signinRowHtml()}`;
}
/* The workplace sign-in, as last checked by the PC (it signs in by itself with its own PIN when the site signs out). */
function signinRowHtml(){
  const c = stockState.control; if(!c) return '';
  // While the worker is off the PC cannot check, but the row stays so the feature is never hidden.
  if(!c.workerOnline) return `<div class="tr-signin"><span class="tr-signin-txt">${esc(t('wkSigninNeedsWorker'))}</span></div>`;
  const asked = c.signinRequestedAt && (!c.signinCheckedAt || Date.parse(c.signinCheckedAt) < Date.parse(c.signinRequestedAt));
  const fresh = asked && Date.now() - Date.parse(c.signinRequestedAt) < 3 * 60 * 1000;
  let label, cls;
  if(fresh){ label = t('wkSigninChecking'); cls = 'wait'; }
  else if(!c.signinCheckedAt){ label = t('wkSigninUnknown'); cls = ''; }
  else if(c.signinOk){ label = (c.signinAuto ? t('wkSigninAuto') : t('wkSigninOk')) + ' · ' + fmtDateTime(c.signinCheckedAt); cls = 'ok'; }
  else { label = t('wkSigninBad') + ' · ' + fmtDateTime(c.signinCheckedAt); cls = 'bad'; }
  return `<div class="tr-signin ${cls}"><span class="tr-signin-txt">${esc(label)}</span>
    ${c.signinHasShot && !fresh ? `<button type="button" class="tr-textbtn" id="wkSigninShot">${esc(t('wkSigninShot'))}</button>` : ''}
    <button type="button" class="tr-textbtn strong" id="wkSignin" ${fresh ? 'disabled' : ''}>${esc(t('wkSigninCheck'))}</button></div>`;
}
function wkPaint(){
  const box = document.getElementById('wkBar'); if(!box) return;
  const html = workerBarHtml(); if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  const b = document.getElementById('wkStart');
  if(b) b.onclick = async () => {
    b.disabled = true;
    const r = await stockApi('start-worker', {method: 'POST'});
    if(!r.ok) toast(r.data?.error || t('saveFailed'), 'error'); else toast(r.data?.queued ? t('wkAskedLater') : t('wkAsked'));
    await refreshStockLight(); wkPaint();
  };
  const sc = document.getElementById('wkSignin');
  if(sc) sc.onclick = async () => {
    sc.disabled = true;
    const r = await stockApi('signin-check', {method: 'POST'});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); sc.disabled = false; return; }
    toast(t('wkSigninAsked')); await refreshStockLight(); wkPaint();
  };
  const ss = document.getElementById('wkSigninShot');
  if(ss) ss.onclick = async () => {
    ss.disabled = true;
    const r = await stockApi('signin-shot');
    ss.disabled = false;
    if(r.ok && r.data?.image) showAlert(`<img class="tr-shot-big" src="${esc(r.data.image)}" alt="">`); else toast(t('trShotGone'), 'error');
  };
}
function stRepaint(){
  if(state.view === 'transfers'){ wkPaint(); trPaintActive(); trPaintResults(); trPaintChosen(); }
  else if(state.view === 'stock') stPaintList();
  else if(state.view === 'receipts') wkPaint();
  else if(state.view === 'itemsAdmin') ijPaintList();
  else if(state.view === 'history') render();
}

/* ============ Transfer screen ============ */
function renderTransfers(){
  if(!stockState.loaded) return stLoadingHtml();
  return `${stAttentionHtml()}
  <div id="wkBar"></div>
  <section class="tr-card">
    <div class="tr-crumbs" id="trCrumbs"></div>
    <div class="tr-cart" id="trCart" hidden></div>
    <div class="tr-step" id="trStFrom"><div class="tr-step-h"><span class="tr-num">1</span>${esc(t('trStepFrom'))}</div><div id="trFromList" class="tr-results"></div></div>
    <div class="tr-step" id="trStTo" hidden><div class="tr-step-h"><span class="tr-num">2</span>${esc(t('trStepTo'))}</div><div id="trToList" class="tr-results"></div></div>
    <div class="tr-step" id="trStItem" hidden><div class="tr-step-h"><span class="tr-num">3</span>${esc(t('trStepItem'))}</div>
      <div id="trPicker"><div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="trSearch" autocomplete="off" aria-label="${esc(t('searchPlaceholder'))}" value="${esc(trState.search)}"></div><div id="trResults" class="tr-results" aria-live="polite"></div></div>
      <button type="button" class="btn btn-primary tr-wide" id="trReviewCart" hidden></button>
    </div>
    <div id="trChosen" class="tr-chosen" hidden></div>
    <div class="tr-step" id="trAmount" hidden><div class="tr-step-h"><span class="tr-num">4</span>${esc(t('trStepAmount'))}</div>
      <div class="tr-units" id="trUnits" role="group" hidden></div>
      <div class="tr-qty"><button type="button" class="step-btn tr-step-btn" id="trLess" aria-label="${esc(t('trLess'))}">−</button><input id="trQty" type="text" inputmode="decimal" data-pad="dec" autocomplete="off" placeholder="0" aria-label="${esc(t('trQty'))}" value="${esc(trState.qty)}"><span class="tr-unit" id="trUnit"></span><button type="button" class="step-btn tr-step-btn" data-inc id="trMore" aria-label="${esc(t('trMore'))}">+</button></div>
      <button type="button" class="tr-link" id="trAll">${esc(t('trUseAll'))}</button>
    </div>
    <div id="trFinish" hidden>
      <label class="check-row tr-yesterday"><span>${esc(t('trYesterday'))}<small>${esc(t('trYesterdayHint'))}</small></span><input type="checkbox" id="trYesterday" ${trState.yesterday ? 'checked' : ''}></label>
      <p class="tr-hint" id="trHint"></p>
      <button type="button" class="btn tr-wide tr-add-more" id="trAddMore">${ICON_PLUS} ${esc(t('trAddMore'))}</button>
      <button type="button" class="btn btn-primary tr-wide" id="trReview">${esc(t('trReview'))}</button>
      <div class="field-hint tr-note">${esc(t('trOneItemHint'))}</div>
    </div>
  </section>
  <section class="tr-review hero-card" id="trReviewCard" hidden></section>
  <div id="trActive"></div>`;
}
/* One question at a time: from, to, item, then the amount. */
const trStage = () => !trState.from ? 'from' : !trState.to ? 'to' : !(stItem(trState.itemId) && stReady(stItem(trState.itemId))) ? 'item' : 'amount';
function trStorageRow(x, meta){
  return `<button type="button" class="list-row tappable tr-result" data-trsto="${esc(x)}"><div><div class="name" dir="auto">${esc(x)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div><span class="tr-go" aria-hidden="true">›</span></button>`;
}
function trPaintStorages(){
  const stage = trStage();
  const show = (id, on) => { const el = document.getElementById(id); if(el) el.hidden = !on; };
  show('trStFrom', stage === 'from'); show('trStTo', stage === 'to'); show('trStItem', stage === 'item');
  show('trChosen', stage === 'amount'); show('trAmount', stage === 'amount'); show('trFinish', stage === 'amount');
  show('trReviewCart', stage === 'item' && trState.lines.length > 0);
  trPaintCart();
  const fromBox = document.getElementById('trFromList'), toBox = document.getElementById('trToList');
  if(fromBox && stage === 'from'){
    fromBox.innerHTML = stockState.storages.map(x => trStorageRow(x, t('trStorageCount')(stReadyItems().filter(i => stQty(i.id, x) > 0).length))).join('');
    fxOnce(fromBox);
  }
  if(toBox && stage === 'to'){
    toBox.innerHTML = stockState.storages.filter(x => x !== trState.from).map(x => trStorageRow(x, '')).join('');
    fxOnce(toBox);
  }
  const crumbs = document.getElementById('trCrumbs'); if(!crumbs) return;
  const item = stItem(trState.itemId), parts = [];
  if(trState.from) parts.push(['from', t('trFrom'), trState.from]);
  if(trState.to) parts.push(['to', t('trTo'), trState.to]);
  if(stage === 'amount' && item) parts.push(['item', t('trStepItemShort'), item.name]);
  crumbs.innerHTML = parts.map(([k, label, v]) => `<button type="button" class="crumb" data-crumb="${k}"><small>${esc(label)}</small><b dir="auto">${esc(v)}</b><span aria-hidden="true">✎</span></button>`).join('');
  crumbs.hidden = !parts.length;
}
/* The items already added to this transfer. */
function trPaintCart(){
  const box = document.getElementById('trCart'); if(!box) return;
  const lines = trState.lines;
  box.hidden = !lines.length;
  const review = document.getElementById('trReviewCart');
  if(review) review.textContent = t('trReviewMany')(lines.length);
  if(!lines.length){ box.innerHTML = ''; return; }
  box.innerHTML = `<div class="tr-cart-h">${esc(t('trCartTitle'))} · ${esc(t('trItemsN')(lines.length))}</div>` + lines.map((l, i) => {
    const item = stItem(l.itemId);
    return `<div class="tr-cart-row"><div><div class="name" dir="auto">${esc(item ? item.name : '')}</div><div class="meta">${esc(fmtQty(Number(l.qty)))} ${esc(stEnteredName(l.itemId, l.mode))}</div></div><button type="button" class="tr-textbtn danger" data-trrm="${i}">${esc(t('trRemoveLine'))}</button></div>`;
  }).join('');
}
/* Puts the item being typed into the transfer and goes back to the list for the next one. */
function trAddLine(){
  const problem = trValid();
  if(problem){ toast(t(problem), 'error'); return; }
  const item = stItem(trState.itemId);
  trState.lines.push({itemId: item.id, qty: trState.qty, mode: stMode(item.id)});
  Object.assign(trState, {itemId: '', qty: '', unit: 'counting', search: ''});
  const search = document.getElementById('trSearch'); if(search) search.value = '';
  const qty = document.getElementById('trQty'); if(qty) qty.value = '';
  trInvalidate(); trPaintAll();
  if(!PAD_TOUCH.matches) search?.focus();
}
/* Everything this transfer will move: the items added so far, plus the one being typed if it is complete. */
function trCollect(){
  if(!trState.from) return {problem: 'trHintFrom'};
  if(!trState.to) return {problem: 'trHintTo'};
  if(trState.from === trState.to) return {problem: 'trHintDiff'};
  const lines = trState.lines.map(l => ({...l}));
  if(trStage() === 'amount'){
    const problem = trValid(); if(problem) return {problem};
    const item = stItem(trState.itemId);
    lines.push({itemId: item.id, qty: trState.qty, mode: stMode(item.id)});
  }
  return lines.length ? {lines} : {problem: 'trHintItem'};
}
function trPaintResults(){
  const box = document.getElementById('trResults'); if(!box) return;
  const search = document.getElementById('trSearch');
  if(search) search.placeholder = t('searchPlaceholder');
  const tokens = stTokens(trState.search), from = trState.from;
  // Every item can be found. Ones with stock here come first, then set-up ones with none, then ones still needing setup.
  const rank = i => !stReady(i) ? 2 : (from && stFree(i.id, from) > 1e-8) ? 0 : 1;
  const hits = state.items.filter(i => stMatches(i, tokens))
    .sort((a, b) => (rank(a) - rank(b)) || nameCollator().compare(a.name, b.name));
  const shown = hits.slice(0, 30);
  const html = shown.map(i => {
    if(!stReady(i)) return `<button type="button" class="list-row tappable tr-result todo" data-trpick="${esc(i.id)}"><div><div class="name" dir="auto">${esc(i.name)}</div><div class="meta">${esc(t('trTapToSetUp'))}</div></div><span class="it-chip todo">${esc(t('itBadgeTodo'))}</span></button>`;
    const free = from ? stFree(i.id, from) : 0, has = free > 1e-8;
    return `<button type="button" class="list-row tappable tr-result${has ? '' : ' none'}" data-trpick="${esc(i.id)}"><div><div class="name" dir="auto">${esc(i.name)}</div><div class="meta">${has ? esc(stCountUnitName(i.id)) : esc(from ? t('trNoneHere')(iso(from)) : t('trHintFrom'))}</div></div><div class="tr-have"><b>${fmtQty(free)}</b><small>${esc(stCountUnitName(i.id))}</small></div></button>`;
  }).join('') + (hits.length > shown.length ? `<div class="field-hint">${esc(t('trShowing')(shown.length, hits.length))}</div>` : '') || `<div class="field-hint">${esc(t('trNoMatch'))}</div>`;
  if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  fxOnce(box);
}
function trPaintChosen(){
  const item = stItem(trState.itemId), picker = document.getElementById('trPicker'), chosen = document.getElementById('trChosen');
  if(!picker) return;
  const on = trStage() === 'amount';
  if(on){
    const from = trState.from, f = stFactor(item.id), free = stFree(item.id, from) / f, res = stReserved(item.id, from) / f, unit = stEnteredName(item.id);
    chosen.innerHTML = `<div><div class="name" dir="auto">${esc(item.name)}</div><div class="meta">${esc(t('trAvailable')(fmtQty(free), iso(unit), iso(from)))}${res > 1e-8 ? '<br>' + esc(t('trReserved')(fmtQty(res), iso(unit))) : ''}</div></div><button type="button" class="btn btn-ghost" id="trChange">${esc(t('trChangeItem'))}</button>`;
    document.getElementById('trUnit').textContent = unit;
    const chips = document.getElementById('trUnits');
    chips.hidden = !stHasBoth(item.id);
    if(!chips.hidden){
      chips.innerHTML = stUnitChoices(item.id).map(({mode: m, label}) =>
        `<button type="button" class="tab-pill${stMode(item.id) === m ? ' active' : ''}" aria-pressed="${stMode(item.id) === m}" data-trunit="${m}">${esc(label)}</button>`).join('');
      chips.querySelectorAll('[data-trunit]').forEach(b => b.onclick = () => {
        if(trState.unit === b.dataset.trunit) return;
        trState.unit = b.dataset.trunit; trState.qty = ''; document.getElementById('trQty').value = ''; trInvalidate(); trPaintChosen();
      });
    }
    document.getElementById('trChange').onclick = () => { trState.itemId = ''; trState.qty = ''; trState.unit = 'counting'; trState.search = ''; trState.reviewKey = null; trPaintAll(); document.getElementById('trSearch')?.focus(); };
  }
  trPaintHint();
}
function trValid(){
  const item = stItem(trState.itemId), qty = Number(trState.qty);
  if(!trState.from) return 'trHintFrom';
  if(!trState.to) return 'trHintTo';
  if(trState.from === trState.to) return 'trHintDiff';
  if(!item || !stReady(item)) return 'trHintItem';
  if(!(qty > 0)) return 'trHintQty';
  if(qty * stFactor(item.id) > stFree(item.id, trState.from) + 1e-8) return 'trHintOver';
  return '';
}
function trPaintHint(){
  const hint = document.getElementById('trHint'); if(!hint) return;
  const problem = trValid();
  hint.textContent = t(problem || 'trHintReady');
  hint.classList.toggle('ready', !problem);
}
function trPaintAll(){ trPaintStorages(); trPaintResults(); trPaintChosen(); const c = document.getElementById('trReviewCard'); if(c && !trState.reviewKey) c.hidden = true; }
function trInvalidate(){ trState.reviewKey = null; trState.lineKeys = {}; const c = document.getElementById('trReviewCard'); if(c) c.hidden = true; }
function trReset(){ Object.assign(trState, {from: '', to: '', itemId: '', qty: '', unit: 'counting', yesterday: false, search: '', reviewKey: null, lines: [], lineKeys: {}}); }
function trReview(){
  const got = trCollect();
  if(got.problem){ toast(t(got.problem), 'error'); return; }
  const lines = got.lines;
  for(const l of lines){
    const item = stItem(l.itemId), f = stFactor(l.itemId, l.mode), free = stFree(item.id, trState.from) / f;
    if(Number(l.qty) > free + 1e-8){ toast(t('trAvailable')(fmtQty(free), iso(stEnteredName(item.id, l.mode)), iso(trState.from)), 'error'); return; }
  }
  trState.reviewKey = trState.reviewKey || crypto.randomUUID();
  for(const l of lines) trState.lineKeys[l.itemId] = trState.lineKeys[l.itemId] || crypto.randomUUID();
  const card = document.getElementById('trReviewCard');
  const lineHtml = l => {
    const item = stItem(l.itemId), qty = Number(l.qty), f = stFactor(l.itemId, l.mode);
    return `<div class="tr-rv-line"><div class="tr-rv-item" dir="auto">${esc(item.name)}</div>${stWorkName(item.id) !== item.name ? `<div class="tr-rv-work" dir="auto">${esc(t('trWorkAs'))}: ${esc(stWorkName(item.id))}</div>` : ''}
    <div class="tr-rv-qty"><b>${esc(fmtQty(qty))}</b> ${esc(stEnteredName(item.id, l.mode))}${f !== 1 ? ` <span class="tr-rv-eq">= ${esc(fmtQty(Math.round(qty * f * 1e6) / 1e6))} ${esc(stCountUnitName(item.id))}</span>` : ''}</div></div>`;
  };
  card.innerHTML = `<div class="hero-eyebrow">${esc(t('trReviewTitle'))}${lines.length > 1 ? ' · ' + esc(t('trItemsN')(lines.length)) : ''}</div>
    <div class="tr-rv-route">${esc(trState.from)} <span aria-hidden="true">→</span> ${esc(trState.to)}</div>
    ${lines.map(lineHtml).join('')}
    <div class="hero-sub">${esc(trState.yesterday ? t('trWhenYesterday') : t('trWhenToday'))}</div>
    ${(()=>{ const w = workerState(); return w && w.cls !== 'on' ? `<div class="tr-rv-warn">${esc(t('wkReviewWarn')(w.label))}</div>` : ''; })()}
    <div class="tr-rv-actions"><button type="button" class="btn btn-primary" id="trApprove">${esc(t('trApprove'))}</button><button type="button" class="btn tr-rv-edit" id="trEdit">${esc(t('trEditRequest'))}</button></div>`;
  card.hidden = false;
  animateUi(card, [{opacity: 0, transform: 'translateY(8px)'}, {opacity: 1, transform: 'none'}]);
  card.scrollIntoView({behavior: stScrollBehavior(), block: 'nearest'});
  document.getElementById('trEdit').onclick = trInvalidate;
  document.getElementById('trApprove').onclick = trApprove;
}
async function trApprove(){
  const btn = document.getElementById('trApprove');
  return withBusy(btn, async () => {
  const got = trCollect();
  if(got.problem || !trState.reviewKey) return;
    const lines = got.lines.map(l => ({clientKey: trState.lineKeys[l.itemId], itemId: l.itemId, quantity: l.qty, unitId: stEnteredId(l.itemId, l.mode),
      expectedName: stWorkName(l.itemId), expectedUnit: stEnteredEn(l.itemId, l.mode)}));
    // One item is also sent in the older one-item shape, so it works on a server that doesn't know `lines` yet
    // (several items are refused there with an error, never half-sent).
    const r = await stockApi('requests', {method: 'POST', body: {...(lines.length === 1 ? lines[0] : {}), from: trState.from, to: trState.to, yesterday: trState.yesterday, lines}});
    if(!r.ok){
      const msg = r.data?.error || t('saveFailed');
      if(/Catalog changed/i.test(msg)){ trInvalidate(); await loadData().catch(()=>{}); await loadStock(); render(); }
      toast(msg, 'error'); return;
    }
    trReset(); toast(t('trQueued'));
    await loadStock(); render();
    document.getElementById('trActive')?.scrollIntoView({behavior: stScrollBehavior(), block: 'start'});
  });
}
/* People and requests that are still on the PC, plus anything finished in the last half hour. */
function trShownRequests(){
  const cutoff = Date.now() - 30 * 60 * 1000;
  const rows = stockState.requests.filter(r => ST_ACTIVE.includes(r.status) || (r.finishedAt && new Date(r.finishedAt).getTime() > cutoff));
  // The rows of one transfer share a batch; the card is the lead row, with the whole list under `group`.
  const batches = new Map();
  for(const r of rows){ const k = r.batchId || r.id; if(!batches.has(k)) batches.set(k, []); batches.get(k).push(r); }
  return [...batches.values()].map(g => { g.sort((a, b) => (a.batchPos || 0) - (b.batchPos || 0)); return {...g[0], group: g}; })
    .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
}
/* The whole transfer a row belongs to, whichever of its rows is given. */
function trFindGroup(id){
  const row = stockState.requests.find(x => x.id === id); if(!row) return null;
  const group = stockState.requests.filter(x => (x.batchId || x.id) === (row.batchId || row.id)).sort((a, b) => (a.batchPos || 0) - (b.batchPos || 0));
  return {...group[0], group};
}
/* A plain list of exactly what will move, shown on the card and again in the final confirmation. */
function trSummaryHtml(r){
  const row = (k, v) => `<div class="tr-sum-row"><span>${esc(t(k))}</span><b dir="auto">${v}</b></div>`;
  const many = r.group && r.group.length > 1;
  const what = many
    ? row('trSumItems', r.group.map(x => `<div>${esc(x.itemName)} · ${reqAmountHtml(x)}</div>`).join(''))
    : row('trSumItem', esc(r.itemName)) + (r.workplaceName && r.workplaceName !== r.itemName ? row('trSumWork', esc(r.workplaceName)) : '') + row('trSumAmount', reqAmountHtml(r));
  return `<div class="tr-sum">${what}${row('trSumFrom', esc(r.from))}${row('trSumTo', esc(r.to))}${row('trSumDay', esc(r.yesterday ? t('trYesterday') : t('trSumToday')))}</div>`;
}
function trRequestCard(r){
  const st = reqState(r), shot = stockState.shots[r.id];
  const shotHtml = (img, label) => `<figure class="tr-shot"><img src="${esc(img)}" alt="${esc(label)}" data-trzoom="${esc(r.id)}"><figcaption>${esc(label)} · ${esc(t('trShotZoom'))}</figcaption></figure>`;
  let pc = '';
  if(r.status === 'waiting' || r.status === 'running' || r.status === 'needs_checking'){
    pc = `<div class="tr-pc"><span class="tr-pc-label">${esc(t('trPcCheck'))}</span>${r.previewMessage ? esc(r.previewMessage) : esc(t('trNoCheckYet'))}</div>`;
    if(shot && shot.check) pc += shotHtml(shot.check, t('trShotLabel'));
    else if(r.hasCheckShot) pc += `<div class="tr-shot-loading">${esc(t(shot?.missing ? 'trShotGone' : 'trShotLoading'))}</div>`;
  }else if(r.resultMessage){
    pc = `<div class="tr-pc">${esc(r.resultMessage)}</div>`;
    if(shot && shot.result) pc += shotHtml(shot.result, t('trShotResult'));
  }
  let buttons = '';
  if(r.status === 'waiting'){
    buttons = (r.finalApprovedAt ? '' : `<button type="button" class="btn btn-primary tr-wide" data-trfinal="${esc(r.id)}" ${st.canApprove ? '' : 'disabled'}>${esc(t('trFinalApprove'))}</button>`)
      + `<div class="tr-links"><button type="button" class="tr-textbtn" data-trchange="${esc(r.id)}">${esc(t('trChangeReq'))}</button><button type="button" class="tr-textbtn danger" data-trcancel="${esc(r.id)}">${esc(t('trCancelReq'))}</button></div>`;
  }else if(r.status === 'needs_checking'){
    buttons = `<button type="button" class="btn btn-primary tr-wide" data-trresolve="${esc(r.id)}">${esc(t('trCheckResult'))}</button>`;
  }
  return `<article class="tr-req glass s-${esc(r.status)}" data-trreq="${esc(r.id)}">
    <div class="tr-req-top"><div>${r.group && r.group.length > 1
      ? `<div class="tr-req-name">${esc(t('trItemsN')(r.group.length))}</div><ul class="tr-req-items">${r.group.map(x => `<li><span dir="auto">${esc(x.itemName)}</span> <b>${reqAmountHtml(x)}</b></li>`).join('')}</ul>`
      : `<div class="tr-req-name" dir="auto">${esc(r.itemName)}</div>${r.workplaceName && r.workplaceName !== r.itemName ? `<div class="tr-req-work" dir="auto">${esc(t('trWorkAs'))}: ${esc(r.workplaceName)}</div>` : ''}<div class="tr-req-amt">${reqAmountHtml(r)}</div>`}</div><span class="tr-chip ${esc(st.cls)}">${esc(st.label)}</span></div>
    <div class="tr-req-route">${esc(r.from)} <span aria-hidden="true">→</span> ${esc(r.to)}${r.yesterday ? ' · ' + esc(t('trYesterday')) : ''}</div>
    ${pc}${buttons}</article>`;
}
function trPaintActive(){
  const box = document.getElementById('trActive'); if(!box) return;
  const list = trShownRequests();
  // Invalidate an older preview before drawing its approval button.
  list.forEach(stEnsureShots);
  const html = list.length ? `<div class="section-title">${esc(t('trOnPc'))} (${list.length})</div>${list.map(trRequestCard).join('')}` : '';
  if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  bindRequestButtons(box);
}
/* The PC's screenshots are loaded on demand and kept until the request changes. */
async function stEnsureShots(r){
  const need = r.hasCheckShot || r.status === 'completed' || r.status === 'needs_checking' || r.status === 'failed';
  if(!need) return;
  const key = r.id + '|' + (r.previewedAt || '') + '|' + r.status;
  const have = stockState.shots[r.id];
  if(have && have.key === key && (!have.retryAt || Date.now() < have.retryAt)) return;
  stockState.shots[r.id] = {key, loading: true};
  const res = await stockApi('shots?id=' + encodeURIComponent(r.id));
  if(res.stale || stockState.shots[r.id]?.key !== key) return;
  const entry = {key, missing: res.ok && !(res.data?.shots || []).length, ...(!res.ok ? {retryAt: Date.now() + 15000} : {})};
  for(const s of res.data?.shots || []) if(!entry[s.kind]) entry[s.kind] = s.image;
  stockState.shots[r.id] = entry;
  if(state.view === 'transfers') trPaintActive();
}
function bindRequestButtons(root){
  root.querySelectorAll('[data-trfinal]').forEach(b => b.onclick = () => withBusy(b, async () => {
    const req = trFindGroup(b.dataset.trfinal);
    if(!(await showConfirm((req ? trSummaryHtml(req) : '') + '<p>' + esc(t('trFinalConfirm')) + '</p>', {okLabel: t('trFinalApprove'), okClass: 'btn-primary'}))) return;
    const r = await stockApi('final-approve', {method: 'POST', body: {id: b.dataset.trfinal}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); await refreshStockLight(); return; }
    toast(t('trFinalDone')); await refreshStockLight(); trPaintActive();
  }));
  root.querySelectorAll('[data-trcancel]').forEach(b => b.onclick = () => withBusy(b, async () => {
    if(!(await showConfirm(esc(t('trCancelConfirm')), {okLabel: t('trCancelReq')}))) return;
    const r = await stockApi('cancel', {method: 'POST', body: {id: b.dataset.trcancel}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    toast(t('trCancelled')); await loadStock(); render();
  }));
  // Change = cancel this waiting request and reopen the form with its details filled in.
  root.querySelectorAll('[data-trchange]').forEach(b => b.onclick = () => withBusy(b, async () => {
    const req = trFindGroup(b.dataset.trchange); if(!req) return;
    if(!(await showConfirm(esc(t('trChangeConfirm')), {okLabel: t('trChangeReq')}))) return;
    const r = await stockApi('cancel', {method: 'POST', body: {id: req.id}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    // Every item goes back into the transfer, in the unit it was entered in.
    const lines = req.group.filter(x => x.itemId && stReady(stItem(x.itemId))).map(x => ({itemId: x.itemId, qty: String(x.enteredQuantity ?? x.quantity),
      mode: stUnitChoices(x.itemId).find(c => c.en === x.enteredUnitLabel)?.mode || 'counting'}));
    Object.assign(trState, {from: req.from, to: req.to, itemId: '', qty: '', unit: 'counting', yesterday: !!req.yesterday, search: '', reviewKey: null, lineKeys: {}, lines});
    await loadStock(); render(); toast(t('trChangeDone'));
  }));
  root.querySelectorAll('[data-trresolve]').forEach(b => b.onclick = () => openResolve(b.dataset.trresolve));
  root.querySelectorAll('[data-trzoom]').forEach(img => img.onclick = () => showAlert(`<img class="tr-shot-big" src="${esc(img.getAttribute('src'))}" alt="">`));
}
function attachTransfersEvents(){
  attachStockCommon();
  if(!document.getElementById('trFromList')) return;
  wkPaint();
  const qty = document.getElementById('trQty');
  const goBack = key => {           // change an earlier answer: it and everything after it are cleared
    if(key === 'from'){ trState.from = ''; trState.to = ''; trState.lines = []; }
    if(key === 'to') trState.to = '';
    trState.itemId = ''; trState.qty = ''; trState.unit = 'counting'; trState.search = '';
    const box = document.getElementById('trSearch'); if(box) box.value = '';
    trInvalidate(); trPaintAll(); trPaintHint();
  };
  document.getElementById('trCrumbs').onclick = e => { const b = e.target.closest('[data-crumb]'); if(b) goBack(b.dataset.crumb); };
  document.getElementById('trFromList').onclick = e => {
    const b = e.target.closest('[data-trsto]'); if(!b) return;
    if(trState.from !== b.dataset.trsto) trState.lines = [];          // another source storage: the items added so far no longer apply
    trState.from = b.dataset.trsto; if(trState.to === trState.from) trState.to = '';
    trState.itemId = ''; trState.qty = ''; trState.search = ''; document.getElementById('trSearch').value = '';
    trInvalidate(); trPaintAll(); trPaintHint();
  };
  document.getElementById('trToList').onclick = e => {
    const b = e.target.closest('[data-trsto]'); if(!b) return;
    trState.to = b.dataset.trsto; trInvalidate(); trPaintAll(); trPaintHint();
  };
  document.getElementById('trSearch').oninput = e => { trState.search = e.target.value; trPaintResults(); };
  document.getElementById('trResults').onclick = e => {
    const b = e.target.closest('[data-trpick]'); if(!b) return;
    const item = stItem(b.dataset.trpick); if(!item) return;
    if(!stReady(item)){ openItemModal(item.id); return; }     // not set up yet: set it up here, then come back
    if(trState.lines.some(l => l.itemId === item.id)){ toast(t('trAlreadyAdded'), 'error'); return; }
        if(stFree(item.id, trState.from) <= 1e-8){ toast(t('trNoneHere')(iso(trState.from)), 'error'); return; }
    trState.itemId = item.id; trState.qty = ''; trState.unit = 'counting'; trState.search = ''; trInvalidate(); qty.value = ''; trPaintAll();
    if(!PAD_TOUCH.matches) qty.focus();   // computers type straight away; phones tap the box for the number pad
  };
  const setQty = v => { trState.qty = v > 0 ? String(v) : ''; qty.value = trState.qty; trInvalidate(); trPaintHint(); };
  qty.oninput = () => { trState.qty = qty.value; trInvalidate(); trPaintHint(); };
  document.getElementById('trMore').onclick = () => setQty(Math.round(((Number(qty.value) || 0) + 1) * 1e6) / 1e6);
  document.getElementById('trLess').onclick = () => setQty(Math.round(((Number(qty.value) || 0) - 1) * 1e6) / 1e6);
  document.getElementById('trAll').onclick = () => { if(trState.itemId) setQty(Math.floor(stFree(trState.itemId, trState.from) / stFactor(trState.itemId) * 1e6) / 1e6); };
  document.getElementById('trYesterday').onchange = e => { trState.yesterday = e.target.checked; trInvalidate(); };
  document.getElementById('trReview').onclick = trReview;
  document.getElementById('trAddMore').onclick = trAddLine;
  document.getElementById('trReviewCart').onclick = trReview;
  document.getElementById('trCart').onclick = e => {
    const b = e.target.closest('[data-trrm]'); if(!b) return;
    trState.lines.splice(Number(b.dataset.trrm), 1); trInvalidate(); trPaintAll(); trPaintHint();
  };
  trPaintAll(); trPaintActive();
  stRefreshIfStale();
}

/* ============ Check a "Needs checking" request by hand ============ */
function openResolve(id){
  const r = trFindGroup(id); if(!r) return;
  const many = r.group.length > 1;
  showFormModal({
    title: esc(t('trResolveTitle')),
    banner: editingBanner(many ? t('trItemsN')(r.group.length) : r.itemName, `${many ? r.group.map(x => x.itemName).join(', ') : `${fmtQty(r.enteredQuantity ?? r.quantity)} ${r.enteredUnitLabel ?? r.unitLabel}`} · ${r.from} → ${r.to}`),
    bodyHtml: `<div class="notif-sub">${esc(t('trResolveIntro'))}</div>
      <div class="field"><select id="rsStatus"><option value="">${esc(t('trResolveChoose'))}</option><option value="completed">${esc(t('trResolveOk'))}</option><option value="failed">${esc(t('trResolveNo'))}</option></select></div>
      <div class="field" id="rsDateBox" hidden><label>${esc(t('trResolveDate'))}</label><input id="rsDate" type="date"></div>
      <div class="field"><label>${esc(t('trResolveNote'))}</label><textarea id="rsNote" maxlength="900" placeholder="${esc(t('trResolveNoteHint'))}"></textarea></div>
      <label class="check-row"><span>${esc(t('trResolveConfirm'))}</span><input type="checkbox" id="rsConfirm"></label>`,
    okLabel: t('save'),
    onOpen: box => { box.querySelector('#rsStatus').onchange = e => { box.querySelector('#rsDateBox').hidden = e.target.value !== 'completed'; }; },
    onSubmit: async () => {
      const status = document.getElementById('rsStatus').value, note = document.getElementById('rsNote').value.trim(), date = document.getElementById('rsDate').value;
      if(!status || note.length < 10 || !document.getElementById('rsConfirm').checked || (status === 'completed' && !date)) return {error: t('trResolveNeed')};
      const res = await stockApi('resolve', {method: 'POST', body: {id, status, note, recordedDate: status === 'completed' ? date : null}});
      if(!res.ok) return {error: res.data?.error || t('saveFailed')};
      await loadStock(); render(); toast(t('trResolved')); return {};
    }
  });
}

/* ============ Stock screen ============ */
function stStoragePills(){
  const opts = [{id: 'all', label: t('stAllStorages')}, ...stockState.storages.map(s => ({id: s, label: s}))];
  return opts.map(o => {
    const n = o.id === 'all' ? stReadyItems().filter(i => stTotal(i.id) > 0).length : stReadyItems().filter(i => stQty(i.id, o.id) > 0).length;
    return `<button class="tab-pill ${stView.storage === o.id ? 'active' : ''}" aria-pressed="${stView.storage === o.id}" data-ststorage="${esc(o.id)}">${esc(o.label)}<span class="tab-count">${n}</span></button>`;
  }).join('');
}
function stRowsData(){
  const tokens = stTokens(stView.search), sto = stView.storage;
  const grp = stView.group ? new Set(stockState.groups.find(g => g.id === stView.group)?.itemIds || []) : null;
  return state.items.filter(i => stMatches(i, tokens) && (!grp || grp.has(i.id))).map(i => {
    const ready = stReady(i);
    return {item: i, ready, qty: ready ? (sto === 'all' ? stTotal(i.id) : stQty(i.id, sto)) : 0, low: ready && stIsLow(i)};
  }).filter(r => stView.filter === 'all' ? true : stView.filter === 'setup' ? !r.ready : stView.filter === 'in' ? r.ready && r.qty > 0 : r.low)
    .sort((a, b) => (a.ready === b.ready ? 0 : a.ready ? -1 : 1) || nameCollator().compare(a.item.name, b.item.name));
}
function stRowHtml(r){
  if(!r.ready){
    return `<div class="list-row tappable st-row" data-stsetup="${esc(r.item.id)}"><div><div class="name" dir="auto">${esc(r.item.name)}</div><div class="meta">${esc(unitLabel(r.item.unit))} · ${esc(t('trTapToSetUp'))}</div></div><span class="it-chip todo">${esc(t('itBadgeTodo'))}</span></div>`;
  }
  const s = stSetting(r.item.id), unit = stCountUnitName(r.item.id);
  const conv = s.perBuying ? ` · ${t('itPerSummary')(iso(unitLabel(r.item.unit)), fmtQty(s.perBuying), iso(unit))}` : '';
  return `<div class="list-row tappable st-row" data-stcount="${esc(r.item.id)}"><div><div class="name" dir="auto">${esc(r.item.name)}</div><div class="meta">${esc(unit)}${esc(conv)}</div></div>
    <div class="st-qty${r.low ? ' low' : ''}"><b>${esc(fmtQty(r.qty))}</b><small>${esc(unit)}</small>${r.low ? `<span class="st-low">${esc(t('stLowBadge'))}</span>` : ''}</div></div>`;
}
/* Set an item up (its counting format) from the Stock screen, then go straight to counting it. */
const stPending = {id: null, storage: '', at: 0};
function stSetupThenCount(id){
  Object.assign(stPending, {id, storage: stView.storage === 'all' ? '' : stView.storage, at: Date.now()});
  openItemModal(id);
}
/* Called by the item form after an item is saved. */
function stAfterItemSaved(itemId){
  const pending = stPending.id === itemId && Date.now() - stPending.at < 10 * 60 * 1000 ? {...stPending} : null;
  stPending.id = null;
  if(pending && stReady(stItem(itemId)) && state.view === 'stock') setTimeout(() => openRecount(itemId, pending.storage), 450);
}
function renderStock(){
  if(!stockState.loaded) return stLoadingHtml();
  const filters = [{id: 'all', label: t('stAll')}, {id: 'in', label: t('stInStock')}, {id: 'low', label: t('stLow')}, {id: 'setup', label: t('itFilterTodo')}];
  return `${stAttentionHtml()}
    <div class="hero-card st-hero"><div class="hero-eyebrow" id="stHeroName"></div><div class="hero-stat"><span class="hero-count" id="stHeroCount">0</span><span class="hero-word" id="stHeroWord"></span></div><div class="hero-sub" id="stHeroSub"></div></div>
    <div class="order-tabs-shell"><button type="button" class="tab-scroll tab-scroll-prev" id="stTabsPrev" aria-label="${esc(t('previousZones'))}">‹</button><div class="order-tabs" id="stTabs">${stStoragePills()}</div><button type="button" class="tab-scroll tab-scroll-next" id="stTabsNext" aria-label="${esc(t('nextZones'))}">›</button></div>
    <div class="st-actions"><button type="button" class="btn btn-primary" id="stCountAll">${esc(t('bcButton'))}</button>${canOpen('assistant') ? `<button type="button" class="btn btn-ghost st-ask" id="stAskRico">${esc(t('stAskRico'))}</button>` : ''}</div>
    <div class="record-filters glass" role="group">${filters.map(f => `<button class="tab-pill ${stView.filter === f.id ? 'active' : ''}" aria-pressed="${stView.filter === f.id}" data-stfilter="${f.id}">${esc(f.label)}</button>`).join('')}</div>
    <div class="st-groups" id="stGroups">${stGroupPills()}</div>
    <div class="search-row"><div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="stSearch" aria-label="${esc(t('searchPlaceholder'))}" placeholder="${esc(t('searchPlaceholder'))}" value="${esc(stView.search)}"></div></div>
    <div id="stList"></div>`;
}
function stPaintList(){
  const box = document.getElementById('stList'); if(!box) return;
  const rows = stRowsData();
  box.innerHTML = rows.length ? rows.map(stRowHtml).join('') : emptyState(esc(t('stEmpty')));
  fxOnce(box);
  const inStorage = stView.storage === 'all' ? stReadyItems().filter(i => stTotal(i.id) > 0).length : stReadyItems().filter(i => stQty(i.id, stView.storage) > 0).length;
  document.getElementById('stHeroName').textContent = stView.storage === 'all' ? t('stAllStorages') : stView.storage;
  document.getElementById('stHeroCount').textContent = inStorage;
  document.getElementById('stHeroWord').textContent = t('stInStock');
  document.getElementById('stHeroSub').textContent = t('itSetupProgress')(stReadyItems().length, state.items.length) + (stLowCount() ? ' · ' + t('stLowBadge') + ': ' + stLowCount() : '');
  box.querySelectorAll('[data-stcount]').forEach(row => row.onclick = () => openRecount(row.dataset.stcount, stView.storage === 'all' ? '' : stView.storage));
  box.querySelectorAll('[data-stsetup]').forEach(row => row.onclick = () => stSetupThenCount(row.dataset.stsetup));
  document.getElementById('stTabs').innerHTML = stStoragePills();
  bindStorageTabs();
}
/* Item groups ("Veggies", "Desserts"...): a second filter row. Made here or by Rico. */
function stGroupPills(){
  const g = stockState.groups;
  const pill = (id, label, n) => `<button type="button" class="st-group-pill ${stView.group === id ? 'active' : ''}" aria-pressed="${stView.group === id}" data-stgroup="${esc(id)}"><span dir="auto">${esc(label)}</span>${n === null ? '' : `<small>${n}</small>`}</button>`;
  const live = new Set(state.items.map(i => i.id));
  return (g.length ? pill('', t('stAllGroups'), null) + g.map(x => pill(x.id, x.name, x.itemIds.filter(id => live.has(id)).length)).join('') : '')
    + `<button type="button" class="st-group-pill st-group-manage" id="stGroupsManage">${esc(g.length ? t('stGroupsManage') : t('stGroupsNew'))}</button>`;
}
function bindGroupPills(){
  document.querySelectorAll('[data-stgroup]').forEach(b => b.onclick = () => { stView.group = b.dataset.stgroup; document.getElementById('stGroups').innerHTML = stGroupPills(); bindGroupPills(); stPaintList(); });
  const m = document.getElementById('stGroupsManage'); if(m) m.onclick = () => openGroupsManager();
}
async function stGroupSave(id, name, itemIds){
  const r = await stockApi('groups/save', {method: 'POST', body: {id: id || null, name, itemIds}});
  if(!r.ok) return {error: r.data?.error || t('saveFailed')};
  await loadStock();
  return {id: r.data?.id};
}
async function stGroupDelete(id){
  const r = await stockApi('groups/delete', {method: 'POST', body: {id}});
  if(!r.ok) return {error: r.data?.error || t('saveFailed')};
  if(stView.group === id) stView.group = '';
  await loadStock();
  return {};
}
function openGroupsManager(){
  const rows = stockState.groups.map(g => `<button type="button" class="list-row tappable st-gm-row" data-gmedit="${esc(g.id)}"><div><div class="name" dir="auto">${esc(g.name)}</div><div class="meta">${esc(t('stGroupCount')(g.itemIds.length))}</div></div><span aria-hidden="true">›</span></button>`).join('');
  showFormModal({
    title: esc(t('stGroupsTitle')),
    bodyHtml: `<p class="field-hint">${esc(t('stGroupsHint'))}</p>${rows || `<p class="field-hint">${esc(t('stGroupsNone'))}</p>`}`,
    okLabel: esc(t('stGroupsNew')),
    onSubmit: async () => { setTimeout(() => openGroupEditor(null), 260); return {}; }
  });
  setTimeout(() => document.querySelectorAll('[data-gmedit]').forEach(b => b.onclick = () => { const id = b.dataset.gmedit; document.getElementById('modalFormCancel')?.click(); setTimeout(() => openGroupEditor(id), 260); }), 0);
}
function openGroupEditor(id){
  const g = id ? stockState.groups.find(x => x.id === id) : null;
  const picked = new Set(g ? g.itemIds : []);
  const items = [...state.items].sort((a, b) => nameCollator().compare(a.name, b.name));
  const list = () => {
    const tokens = stTokens(document.getElementById('gmSearch')?.value || '');
    const onlyPicked = document.getElementById('gmOnly')?.checked;
    return items.filter(i => stMatches(i, tokens) && (!onlyPicked || picked.has(i.id))).slice(0, 300).map(i => `<label class="st-gm-item"><input type="checkbox" value="${esc(i.id)}" ${picked.has(i.id) ? 'checked' : ''}><span dir="auto">${esc(i.name)}</span></label>`).join('') || `<p class="field-hint">${esc(t('stEmpty'))}</p>`;
  };
  showFormModal({
    title: esc(g ? t('stGroupEdit') : t('stGroupsNew')),
    bodyHtml: `<div class="field"><label for="gmName">${esc(t('stGroupName'))}</label><input id="gmName" maxlength="40" dir="auto" value="${esc(g ? g.name : '')}" placeholder="${esc(t('stGroupNameHint'))}"></div>
      <div class="search-wrap st-gm-search">${ICON_SEARCH}<input class="search-input" id="gmSearch" placeholder="${esc(t('searchPlaceholder'))}"></div>
      <label class="st-gm-only"><input type="checkbox" id="gmOnly"> <span id="gmCount">${esc(t('stGroupPicked')(picked.size))}</span></label>
      <div class="st-gm-list" id="gmList"></div>
      ${g ? `<button type="button" class="btn btn-ghost st-gm-delete" id="gmDelete">${esc(t('stGroupDelete'))}</button>` : ''}`,
    onSubmit: async () => {
      const name = document.getElementById('gmName').value.trim();
      if(!name) return {error: t('stGroupNeedName')};
      if(!picked.size) return {error: t('stGroupNeedItems')};
      const res = await stGroupSave(g?.id, name, [...picked]);
      if(res.error) return res;
      if(res.id) stView.group = res.id;
      render(); toast(t('stGroupSaved')(name));
      return {};
    }
  });
  setTimeout(() => {
    const box = document.getElementById('gmList'); if(!box) return;
    const paint = () => { box.innerHTML = list(); document.getElementById('gmCount').textContent = t('stGroupPicked')(picked.size); };
    box.onchange = e => { const c = e.target; if(c.type !== 'checkbox') return; c.checked ? picked.add(c.value) : picked.delete(c.value); document.getElementById('gmCount').textContent = t('stGroupPicked')(picked.size); };
    document.getElementById('gmSearch').oninput = paint;
    document.getElementById('gmOnly').onchange = paint;
    const del = document.getElementById('gmDelete');
    if(del) del.onclick = () => withBusy(del, async () => {
      const editor = box.closest('.modal-overlay');
      if(!(await showConfirm(t('stGroupDeleteConfirm')(esc(g.name))))) return;
      const res = await stGroupDelete(g.id);
      if(res.error){ await showAlert(esc(res.error)); return; }
      await closeModal(editor);
      render(); toast(t('stGroupDeleted'));
    });
    paint();
  }, 0);
}
/* Rico's "open the Stock screen filtered" button. */
function stOpenFiltered({search = '', storage = null, groupId = null, only = null} = {}){
  stView.search = search || '';
  stView.storage = storage && stockState.storages.includes(storage) ? storage : (storage ? stView.storage : 'all');
  stView.group = groupId || '';
  stView.filter = only === 'in_stock' ? 'in' : only === 'low' ? 'low' : only === 'not_set_up' ? 'setup' : 'all';
  goView('stock');
}
/* Rico's confirmed change of an item's low-stock level or workplace name (app only). */
async function stApplySettings(itemId, change){
  const cur = stockState.loaded ? stockState.settings.get(itemId) : null;
  if(!cur){ await loadStock(); }
  const s = stockState.settings.get(itemId);
  if(!s) return {error: t('saveFailed')};
  const item = stItem(itemId); if(!item) return {error: t('saveFailed')};
  const lowStock = 'lowStock' in change ? change.lowStock : s.lowStock;
  const workplaceName = 'workplaceName' in change ? change.workplaceName : s.workplaceName;
  const r = await stockApi('settings/' + encodeURIComponent(itemId), {method: 'PUT', body: {countingUnit: s.countingUnit, perBuying: s.countingUnit === item.unit ? null : s.perBuying, lowStock, workplaceName: workplaceName || ''}});
  if(!r.ok) return {error: r.data?.error || t('saveFailed')};
  stockState.settings.set(itemId, {...s, lowStock: lowStock === null ? null : Number(lowStock), workplaceName: workplaceName || null});
  return {};
}
function bindStorageTabs(){ document.querySelectorAll('[data-ststorage]').forEach(b => b.onclick = () => { stView.storage = b.dataset.ststorage; stPaintList(); }); }
function attachStockEvents(){
  attachStockCommon();
  if(!document.getElementById('stList')) return;
  document.querySelectorAll('[data-stfilter]').forEach(b => b.onclick = () => { stView.filter = b.dataset.stfilter; document.querySelectorAll('[data-stfilter]').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); }); stPaintList(); });
  document.getElementById('stSearch').oninput = e => { stView.search = e.target.value; stPaintList(); };
  const tabs = document.getElementById('stTabs');
  const go = step => {
    const pills = [...tabs.querySelectorAll('.tab-pill')]; if(!pills.length) return;
    const center = tabs.getBoundingClientRect().left + tabs.clientWidth / 2;
    let index = 0, dist = Infinity;
    pills.forEach((pill, i) => { const r = pill.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - center); if(d < dist){ dist = d; index = i; } });
    pills[Math.max(0, Math.min(pills.length - 1, index + step))].scrollIntoView({behavior: stScrollBehavior(), block: 'nearest', inline: 'center'});
  };
  document.getElementById('stTabsPrev').onclick = () => go(-1);
  document.getElementById('stTabsNext').onclick = () => go(1);
  tabs.addEventListener('wheel', e => { if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; e.preventDefault(); tabs.scrollBy({left: e.deltaY, behavior: 'auto'}); }, {passive: false});
  document.getElementById('stCountAll').onclick = () => openBulkCount();
  const ask = document.getElementById('stAskRico'); if(ask) ask.onclick = () => goView('assistant');
  bindGroupPills();
  stPaintList();
  stRefreshIfStale();
}

/* ============ Recount (asks for your PIN) ============ */
function openRecount(itemId, storage){
  const item = stItem(itemId); if(!item || !stReady(item)) return;
  const unit = stCountUnitName(itemId);
  const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  let pick = storage || (stockState.storages.includes('Main Storage') ? 'Main Storage' : stockState.storages[0]);
  showFormModal({
    title: esc(t('stRecountTitle')),
    banner: editingBanner(item.name, unit),
    bodyHtml: `<div class="notif-sub">${esc(t('stRecountHint'))}</div>
      <div class="field"><label>${esc(t('stStorage'))}</label>${chipPickHtml('rcStorage', stockState.storages, pick)}<div class="field-hint" id="rcNow"></div></div>
      <div class="field"><label>${esc(t('stCounted'))} (${esc(unit)})</label><input id="rcQty" type="number" inputmode="decimal" min="0" step="any" autocomplete="off"></div>
      <div class="field"><label>${esc(t('stCountedAt'))}</label><input id="rcAt" type="datetime-local" value="${local}"></div>
      <div class="field"><label>${esc(t('stNote'))}</label><input id="rcNote" maxlength="500" autocomplete="off"></div>
      <div class="field"><label>${esc(t('stPin'))}</label><input id="rcPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••"><div class="field-hint">${esc(t('stPinHint'))}</div></div>`,
    okLabel: t('save'),
    onOpen: box => {
      const sel = box.querySelector('#rcStorage'), now = box.querySelector('#rcNow');
      const paint = () => { now.textContent = t('stNow')(fmtQty(stQty(itemId, sel.value)), iso(unit)); };
      chipPickWire(box, 'rcStorage', paint); paint();
      box.querySelector('#rcPin').oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); };
      box.querySelector('#rcQty').focus();
    },
    onSubmit: async () => {
      const qty = document.getElementById('rcQty').value, pin = document.getElementById('rcPin').value, at = document.getElementById('rcAt').value;
      if(qty === '' || !(Number(qty) >= 0) || !/^\d{6}$/.test(pin) || !at) return {error: t('stNeedNumber')};
      const r = await stockApi('counts', {method: 'POST', body: {itemId, storage: document.getElementById('rcStorage').value, quantity: qty, countedAt: new Date(at).toISOString(), note: document.getElementById('rcNote').value.trim(), pin}});
      if(!r.ok){
        if(r.status === 403) return {error: t('stPinWrong')};
        if(r.status === 429) return {error: t('tooManyAttempts')};
        return {error: r.data?.error || t('saveFailed')};
      }
      await loadStock(); render(); toast(t('stCountSaved')(item.name)); return {};
    }
  });
}

/* ============ Count many items at once (one PIN) ============ */
function openBulkCount(){
  const ready = stReadyItems().slice().sort((a, b) => nameCollator().compare(a.name, b.name));
  if(!ready.length){ toast(t('bcNone'), 'error'); return; }
  const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  let pick = stView.storage !== 'all' ? stView.storage : (stockState.storages.includes('Main Storage') ? 'Main Storage' : stockState.storages[0]);
  const values = new Map();   // itemId -> typed text; survives searching
  showFormModal({
    title: esc(t('bcTitle')),
    bodyHtml: `<div class="notif-sub">${esc(t('bcHint'))}</div>
      <div class="field"><label>${esc(t('stStorage'))}</label>${chipPickHtml('bcStorage', stockState.storages, pick)}</div>
      <div class="search-wrap bc-search">${ICON_SEARCH}<input class="search-input" id="bcSearch" placeholder="${esc(t('searchPlaceholder'))}" autocomplete="off"></div>
      <div class="bc-count" id="bcCount"></div>
      <div class="bc-list" id="bcList"></div>
      <div class="field"><label>${esc(t('stCountedAt'))}</label><input id="bcAt" type="datetime-local" value="${local}"></div>
      <div class="field"><label>${esc(t('stNote'))}</label><input id="bcNote" maxlength="500" autocomplete="off"></div>
      <div class="field"><label>${esc(t('stPin'))}</label><input id="bcPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••"><div class="field-hint">${esc(t('stPinHint'))}</div></div>`,
    okLabel: t('save'),
    onOpen: box => {
      const list = box.querySelector('#bcList'), sel = box.querySelector('#bcStorage'), search = box.querySelector('#bcSearch'), count = box.querySelector('#bcCount');
      const paintCount = () => { count.textContent = t('bcEntered')(values.size, ready.length); };
      const paint = () => {
        const tokens = stTokens(search.value);
        const rows = ready.filter(i => stMatches(i, tokens));
        list.innerHTML = rows.length ? rows.map(i => `<label class="bc-row"><span class="bc-name" dir="auto">${esc(i.name)}<small>${esc(t('stNow')(fmtQty(stQty(i.id, sel.value)), iso(stCountUnitName(i.id))))}</small></span><span class="bc-in"><input type="number" inputmode="decimal" min="0" step="any" data-bcitem="${esc(i.id)}" value="${esc(values.get(i.id) ?? '')}" autocomplete="off"><span class="st-unit-chip">${esc(stCountUnitName(i.id))}</span></span></label>`).join('') : `<div class="empty">${esc(t('trNoMatch'))}</div>`;
        list.querySelectorAll('[data-bcitem]').forEach(inp => inp.oninput = () => { if(inp.value === '') values.delete(inp.dataset.bcitem); else values.set(inp.dataset.bcitem, inp.value); paintCount(); });
        paintCount();
      };
      chipPickWire(box, 'bcStorage', paint); search.oninput = paint; paint();
      box.querySelector('#bcPin').oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); };
    },
    onSubmit: async () => {
      const pin = document.getElementById('bcPin').value, at = document.getElementById('bcAt').value;
      const lines = [...values].filter(([, v]) => v !== '').map(([itemId, quantity]) => ({itemId, quantity}));
      if(!lines.length) return {error: t('bcNothing')};
      if(lines.some(l => !(Number(l.quantity) >= 0)) || !/^\d{6}$/.test(pin) || !at) return {error: t('stNeedNumber')};
      const r = await stockApi('counts-bulk', {method: 'POST', timeout: 60000, body: {storage: document.getElementById('bcStorage').value, countedAt: new Date(at).toISOString(), note: document.getElementById('bcNote').value.trim(), pin, lines}});
      if(!r.ok){
        if(r.status === 403) return {error: t('stPinWrong')};
        if(r.status === 429) return {error: t('tooManyAttempts')};
        return {error: r.data?.error || t('saveFailed')};
      }
      await loadStock(); render();
      const bad = r.data?.failed?.length || 0;
      toast(bad ? t('bcPartial')(r.data.saved.length, bad) : t('bcSaved')(r.data.saved.length), bad ? 'error' : 'ok');
      return {};
    }
  });
}

/* ============ Item form: counting format, conversion, warning level ============ */
const itemHasStock = id => stTotal(id) > 0 || stockState.requests.some(r => r.itemId === id && ST_ACTIVE.includes(r.status));
function itemStockFieldsHtml(existing){
  const s = existing ? stSetting(existing.id) : null;
  const locked = !!(s && itemHasStock(existing.id));
  const unitOptions = `<option value="">${esc(t('itChooseFormat'))}</option>` + state.units.map(u => `<option value="${esc(u.id)}" ${s?.countingUnit === u.id ? 'selected' : ''}>${esc(unitName(u))}</option>`).join('');
  return `<div class="field"><label>${esc(t('itWorkName'))}</label><input id="mfWork" data-clear="1" autocomplete="off" maxlength="240" value="${esc(s?.workplaceName || '')}" placeholder="${esc(existing?.name || '')}"><div class="field-hint">${esc(t('itWorkNameHint'))}</div></div>
    <div class="field"><label>${esc(t('itCounting'))}</label><select id="mfCounting" ${locked ? 'disabled' : ''}>${unitOptions}</select><div class="field-hint">${esc(locked ? t('itLocked') : t('itCountingHint'))}</div></div>
    <div class="field" id="mfPerBox" hidden><label id="mfPerLabel"></label><input id="mfPer" data-clear="1" type="number" inputmode="decimal" min="0" step="any" value="${s?.perBuying != null ? esc(s.perBuying) : ''}"><div class="field-hint" id="mfPerSummary"></div></div>
    <div class="field"><label>${esc(t('itWarn'))}</label><div class="st-warn"><input id="mfLow" data-clear="1" type="number" inputmode="decimal" min="0" step="any" value="${s?.lowStock != null ? esc(s.lowStock) : ''}"><span class="st-unit-chip" id="mfLowUnit"></span></div><div class="field-hint">${esc(t('itWarnHint'))}</div></div>
    <div class="field"><label>${esc(t('itUsage'))}</label><select id="mfUsage"><option value="">${esc(t('itUsageNone'))}</option>${state.units.map(u => `<option value="${esc(u.id)}" ${s?.usageUnit === u.id ? 'selected' : ''}>${esc(unitName(u))}</option>`).join('')}</select><div class="field-hint">${esc(t('itUsageHint'))}</div></div>
    <div class="field" id="mfPerUsageBox" hidden><label id="mfPerUsageLabel"></label><input id="mfPerUsage" data-clear="1" type="number" inputmode="decimal" min="0" step="any" value="${s?.perCountingUsage != null ? esc(s.perCountingUsage) : ''}"></div>
    ${existing && s ? `<div class="field wp-box" data-wpitem="${esc(existing.id)}"><label>${esc(t('wpTitle'))}</label><div class="field-hint">${esc(s.workplaceCreatedAt ? t('wpCreated') : t('wpHint'))}</div>
      <div class="tr-btn-row"><button type="button" class="btn btn-ghost" data-wpjob="create">${esc(t('wpCreate'))}</button><button type="button" class="btn btn-ghost" data-wpjob="edit">${esc(t('wpEdit'))}</button></div></div>` : ''}`;
}
function itemStockOnOpen(box){
  const buy = box.querySelector('#mfUnit'), count = box.querySelector('#mfCounting'), per = box.querySelector('#mfPer');
  const paint = () => {
    const b = state.units.find(u => u.id === buy.value), c = state.units.find(u => u.id === count.value);
    const diff = !!(b && c && b.id !== c.id);
    box.querySelector('#mfPerBox').hidden = !diff;
    box.querySelector('#mfLowUnit').textContent = c ? unitName(c) : '';
    if(diff){
      box.querySelector('#mfPerLabel').textContent = t('itPer')(iso(unitName(b)), iso(unitName(c)));
      box.querySelector('#mfPerSummary').textContent = Number(per.value) > 0 ? t('itPerSummary')(iso(unitName(b)), fmtQty(Number(per.value)), iso(unitName(c))) : '';
    }
  };
  const usage = box.querySelector('#mfUsage');
  const paintUsage = () => {
    const c = state.units.find(u => u.id === count.value), us = state.units.find(u => u.id === usage.value);
    const need = !!(c && us && c.id !== us.id);
    box.querySelector('#mfPerUsageBox').hidden = !need;
    if(need) box.querySelector('#mfPerUsageLabel').textContent = t('itPer')(iso(unitName(c)), iso(unitName(us)));
  };
  buy.addEventListener('change', paint); count.addEventListener('change', paint); per.addEventListener('input', paint); paint();
  count.addEventListener('change', paintUsage); usage.addEventListener('change', paintUsage); paintUsage();
  box.querySelectorAll('[data-wpjob]').forEach(b => b.onclick = () => wpSend(b.closest('[data-wpitem]').dataset.wpitem, b.dataset.wpjob, b));
}
/* Checks the counting fields before anything is saved. Returns {} or {error}. */
function itemStockValidate(box, buyingId){
  const counting = box.querySelector('#mfCounting').value, per = box.querySelector('#mfPer').value, low = box.querySelector('#mfLow').value, work = box.querySelector('#mfWork').value.trim();
  if(!counting){ return (low !== '' || work !== '') ? {error: t('itChooseFormat')} : {}; }
  if(!buyingId) return {error: t('itNeedFormats')};
  if(counting !== buyingId && !(Number(per) > 0)) return {error: t('itNeedPer')};
  if(low !== '' && !(Number(low) >= 0)) return {error: t('itWarn')};
  const usage = box.querySelector('#mfUsage').value, perUsage = box.querySelector('#mfPerUsage').value;
  if(usage && usage !== counting && !(Number(perUsage) > 0)) return {error: t('itNeedPerUsage')};
  return {};
}
/* Saves the counting setup for an item that has already been saved. Returns {} or {error}. */
async function itemStockSave(itemId, box, buyingId){
  const counting = box.querySelector('#mfCounting').value;
  if(!counting) return {};
  const per = box.querySelector('#mfPer').value, low = box.querySelector('#mfLow').value, work = box.querySelector('#mfWork').value.trim();
  const usage = box.querySelector('#mfUsage').value, perUsage = box.querySelector('#mfPerUsage').value;
  const perU = usage && usage !== counting ? perUsage : null;
  const r = await stockApi('settings/' + encodeURIComponent(itemId), {method: 'PUT', body: {countingUnit: counting, perBuying: counting === buyingId ? null : per, lowStock: low === '' ? null : low, workplaceName: work,
    usageUnit: usage, perCountingUsage: perU}});
  if(!r.ok) return {error: r.data?.error || t('saveFailed')};
  const before = stockState.settings.get(itemId) || {};
  stockState.settings.set(itemId, {...before, itemId, countingUnit: counting, perBuying: counting === buyingId ? null : Number(per), lowStock: low === '' ? null : Number(low), workplaceName: work || null,
    usageUnit: usage || null, perCountingUsage: perU === null ? null : Number(perU)});
  return {};
}

/* ============ Items screen: setup progress, filters ============ */
function itemsSetupCounts(){ const done = state.items.filter(stReady).length; return {done, total: state.items.length}; }
function itemsAdminHeaderHtml(){
  const {done, total} = itemsSetupCounts();
  const pct = total ? Math.round(done / total * 100) : 0;
  const filters = [{id: 'all', label: t('itFilterAll')}, {id: 'todo', label: t('itFilterTodo')}, {id: 'ready', label: t('itFilterReady')}];
  return `<div class="it-progress glass"><div class="it-progress-top"><b>${esc(t('itSetupTitle'))}</b><span>${esc(t('itSetupProgress')(done, total))}</span></div><div class="it-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>
    <div class="record-filters glass" role="group">${filters.map(f => `<button class="tab-pill ${itemsView.filter === f.id ? 'active' : ''}" aria-pressed="${itemsView.filter === f.id}" data-itfilter="${f.id}">${esc(f.label)}</button>`).join('')}</div>
    <div class="search-row"><div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itSearch" aria-label="${esc(t('itSearch'))}" placeholder="${esc(t('itSearch'))}" value="${esc(itemsView.search)}"></div></div>`;
}
function itemRowBadge(i){
  if(!stockState.loaded) return '';
  return stReady(i) ? `<span class="it-chip ok">${esc(stCountUnitName(i.id))}</span>` : `<span class="it-chip todo">${esc(t('itBadgeTodo'))}</span>`;
}
function itemsAdminListHtml(){
  const tokens = stTokens(itemsView.search);
  const items = state.items.filter(i => stMatches(i, tokens) && (itemsView.filter === 'all' || !stockState.loaded || (itemsView.filter === 'ready') === stReady(i)));
  if(!items.length) return emptyState(esc(state.items.length ? t('noSearchResults') : t('noItemsYet')));
  const groups = {};
  items.forEach(i => { const key = i.supplierId || '__none'; (groups[key] ||= []).push(i); });
  return Object.keys(groups).sort((a, b) => nameCollator().compare(a === '__none' ? t('noSupplier') : supplierName(a), b === '__none' ? t('noSupplier') : supplierName(b))).map(key => {
    const label = key === '__none' ? t('noSupplier') : supplierName(key), groupItems = sortedByName(groups[key]);
    const rows = groupItems.map(i => `
    <div class="list-row tappable" data-edititem="${esc(i.id)}">
      <div><div class="name" dir="auto">${esc(i.name)}</div><div class="meta">${esc(unitLabel(i.unit))} · ${i.supplierId ? esc(supplierName(i.supplierId)) : esc(t('noSupplier'))}</div>${itemRowBadge(i)}</div>
      <div class="row-actions"><span class="icon-btn">${ICON_EDIT}</span><button class="icon-btn danger" data-delitem="${esc(i.id)}">${ICON_DELETE}</button></div>
    </div>`).join('');
    return `<section class="supplier-group admin-item-group"><div class="supplier-head"><span class="supplier-heading-name">${supplierMono(label)}${esc(label)}</span><span class="supplier-item-count">${groupItems.length}</span></div><div class="admin-item-grid">${rows}</div></section>`;
  }).join('');
}

/* ============ History: orders, transfers and counts together ============ */
function stHistoryFilters(){
  const f = [{id: 'all', label: t('hfAll')}, {id: 'orders', label: t('hfOrders')}, {id: 'transfers', label: t('hfTransfers')}, {id: 'counts', label: t('hfCounts')}];
  return `<div class="record-filters glass" role="group">${f.map(x => `<button class="tab-pill ${histView.filter === x.id ? 'active' : ''}" aria-pressed="${histView.filter === x.id}" data-histfilter="${x.id}">${esc(x.label)}</button>`).join('')}</div>`;
}
function stTransferHistoryCard(r){
  const st = reqState(r);
  const when = r.finishedAt || r.approvedAt;
  const time = formatIraqDateTime(when, {hour: 'numeric', minute: '2-digit'});
  const shotBtn = (r.hasCheckShot || r.status === 'completed') ? `<button class="btn btn-ghost st-shot-btn" data-histshots="${esc(r.id)}">${esc(t('trShotLabel'))}</button>` : '';
  return `<div class="hist-card st-hist"><div class="hist-top"><div class="hist-date">${esc(time)} · ${esc(t('hcApprovedBy')(accountLabel(r.approvedBy)))}</div><span class="tr-chip ${esc(st.cls)}">${esc(st.label)}</span></div>
    <div class="hist-entry"><div class="hist-supplier"><span class="supplier-mono st-mono" aria-hidden="true">⇄</span>${esc(t('hcTransfer'))} · ${esc(r.from)} → ${esc(r.to)}</div>
    <div class="hist-items st-hist-name" dir="auto">${esc(r.itemName)}</div><div class="hist-items"><b>${reqAmountHtml(r)}</b></div>
    ${r.recordedDate ? `<div class="hist-items">${esc(t('hcRecordedFor')(r.recordedDate))}</div>` : (r.yesterday ? `<div class="hist-items">${esc(t('trYesterday'))}</div>` : '')}
    ${r.resultMessage ? `<div class="hist-items">${esc(r.resultMessage)}</div>` : ''}
    ${r.status === 'needs_checking' ? `<button class="btn btn-primary tr-wide" data-trresolve="${esc(r.id)}">${esc(t('trCheckResult'))}</button>` : ''}${shotBtn}</div></div>`;
}
function stCountHistoryCard(c){
  const time = formatIraqDateTime(c.enteredAt, {hour: 'numeric', minute: '2-digit'});
  return `<div class="hist-card st-hist"><div class="hist-top"><div class="hist-date">${esc(time)} · ${esc(t('hcCountedBy')(accountLabel(c.by)))}</div></div>
    <div class="hist-entry"><div class="hist-supplier"><span class="supplier-mono st-mono" aria-hidden="true">#</span>${esc(t('hcCount'))} · ${esc(c.storage)}</div>
    <div class="hist-items st-hist-name" dir="auto">${esc(c.itemName)}</div><div class="hist-items"><b>${esc(fmtQty(c.quantity))}</b> ${esc(c.unitLabel)} (${esc(t('hcWasStock')(fmtQty(c.prior), iso(c.unitLabel)))})</div>${c.note ? `<div class="hist-items">${esc(c.note)}</div>` : ''}</div></div>`;
}
/* Called by History for transfer and count entries. Returns [{ts, html}] . */
function stHistoryEntries(){
  if(!stockState.loaded) return [];
  const out = [];
  if(histView.filter === 'all' || histView.filter === 'transfers') stockState.requests.forEach(r => out.push({ts: new Date(r.finishedAt || r.approvedAt).getTime(), html: stTransferHistoryCard(r), day: r.finishedAt || r.approvedAt}));
  if(histView.filter === 'all' || histView.filter === 'counts') stockState.counts.forEach(c => out.push({ts: new Date(c.enteredAt).getTime(), html: stCountHistoryCard(c), day: c.enteredAt}));
  return out;
}
function attachHistoryStockEvents(){
  document.querySelectorAll('[data-histfilter]').forEach(b => b.onclick = () => { histView.filter = b.dataset.histfilter; render(); });
  document.querySelectorAll('[data-trresolve]').forEach(b => b.onclick = () => openResolve(b.dataset.trresolve));
  document.querySelectorAll('[data-histshots]').forEach(b => b.onclick = async () => {
    const id = b.dataset.histshots; b.disabled = true;
    const res = await stockApi('shots?id=' + encodeURIComponent(id)); b.disabled = false;
    const shots = res.data?.shots || [];
    const html = shots.length ? shots.map(s => `<div class="tr-shot-title">${esc(s.kind === 'result' ? t('trShotResult') : t('trShotLabel'))}</div><img class="tr-shot-big" src="${esc(s.image)}" alt="">`).join('') : esc(t('trShotGone'));
    showAlert(html);
  });
  attachStockCommon();
}

/* ============ Zones (inside the Suppliers screen) ============ */
function zonesSwitchHtml(){
  return `<div class="record-filters glass" role="group">${[['suppliers', t('suppliers')], ['zones', t('zones')]].map(([id, label]) =>
    `<button type="button" class="tab-pill ${supView.tab === id ? 'active' : ''}" aria-pressed="${supView.tab === id}" data-supview="${id}">${esc(label)}</button>`).join('')}</div>`;
}
function renderZonesPanel(){
  if(!stockState.loaded) return stLoadingHtml();
  const rows = stockState.storages.map(x => {
    const n = stReadyItems().filter(i => stQty(i.id, x) > 0).length;
    return `<div class="list-row tappable" data-zedit="${esc(x)}"><div><div class="name" dir="auto">${esc(x)}</div><div class="meta">${esc(t('trStorageCount')(n))}</div></div>
      <div class="row-actions"><span class="icon-btn">${ICON_EDIT}</span><button type="button" class="icon-btn danger" data-zdel="${esc(x)}" aria-label="${esc(t('zDelete'))}">${ICON_DELETE}</button></div></div>`;
  }).join('');
  return `<div class="action-row"><button type="button" class="btn btn-primary add-btn" id="zoneAddBtn">${ICON_PLUS} ${esc(t('zAdd'))}</button></div>
    <div class="field-hint z-hint">${esc(t('zHint'))}</div>
    <div class="section-title">${esc(t('zones'))} (${stockState.storages.length})</div>${rows}`;
}
/* After a zone is renamed or removed, anything that still points at the old name is cleared. */
function zoneForget(name){
  if(trState.from === name || trState.to === name) trReset();
  if(stView.storage === name) stView.storage = 'all';
}
function openZoneModal(name){
  showFormModal({
    title: esc(name ? t('zEdit') : t('zAdd')),
    banner: name ? editingBanner(name, '') : '',
    bodyHtml: `<div class="field"><label>${esc(t('zName'))}</label><input id="zName" data-clear="1" maxlength="60" autocomplete="off" value="${esc(name || '')}"><div class="field-hint">${esc(t('zHint'))}</div></div>`,
    okLabel: t('save'),
    againLabel: name ? null : t('saveAndAddAnother'),
    onOpen: box => box.querySelector('#zName').focus(),
    onSubmit: async again => {
      const v = document.getElementById('zName').value.trim();
      if(!v) return {error: t('nameRequired')};
      const r = name ? await stockApi('zones/rename', {method: 'POST', body: {from: name, to: v}}) : await stockApi('zones/add', {method: 'POST', body: {name: v}});
      if(!r.ok) return {error: r.data?.error || t('saveFailed')};
      if(name && name !== v) zoneForget(name);
      await loadStock(); render();
      if(again) return {keepOpen: true, message: t('zSaved')(v)};
      toast(t('zSaved')(v)); return {};
    }
  });
}
function attachZonesEvents(){
  document.getElementById('zoneAddBtn')?.addEventListener('click', () => openZoneModal(null));
  document.querySelectorAll('[data-zedit]').forEach(row => row.onclick = () => openZoneModal(row.dataset.zedit));
  document.querySelectorAll('[data-zdel]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const name = b.dataset.zdel;
    if(!(await showConfirm(`<b>${esc(name)}</b><br>${esc(t('zDeleteConfirm'))}`))) return;
    const r = await stockApi('zones/delete', {method: 'POST', body: {name}});
    if(!r.ok){ await showAlert(esc(r.data?.error || t('saveFailed'))); return; }
    zoneForget(name); await loadStock(); render(); toast(t('zDeleted')(name));
  });
}

/* ============ Receipts: entered here, prepared by the PC, accepted by a person at the PC ============ */
const rcNewLine = () => ({itemId: '', unit: 'buying', qty: '', cost: '', search: ''});
const rcState = {supplierId: '', invoice: '', currency: 'IQD', rate: '', delivery: false, deliveryAmt: '', lines: [rcNewLine()], key: null, keyBody: null};
const rcData = {list: [], loaded: false, at: 0, shots: {}};
const RC_ACTIVE = ['waiting', 'preparing', 'prepared'];
function stPruneShots(data, list){
  const versions = new Map(list.map(x => [x.id, x.preparedAt]));
  for(const old of data.list){
    if(!versions.has(old.id) || versions.get(old.id) !== old.preparedAt){
      delete data.shots[old.id];
      if(data.loadingShot) delete data.loadingShot[old.id];
    }
  }
}
async function stLoadShot(data, x, endpoint, paint){
  data.loadingShot = data.loadingShot || {};
  if(data.loadingShot[x.id]) return;
  const marker = {}, shots = data.shots;
  data.loadingShot[x.id] = marker;
  try{
    const r = await stockApi(endpoint + '/shot?id=' + encodeURIComponent(x.id));
    const current = data.list.find(y => y.id === x.id);
    if(r.stale || shots !== data.shots || !current || current.preparedAt !== x.preparedAt) return;
    if(r.ok && r.data?.image){ data.shots[x.id] = r.data.image; paint(); }
    else toast(t('saveFailed'), 'error');
  }finally{
    if(data.loadingShot[x.id] === marker) delete data.loadingShot[x.id];
  }
}
// Phones in Kurdish or Arabic may type ٠-٩ / ۰-۹ digits and ٫ as the decimal point.
const rcNum = v => Number(String(v ?? '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0).replace(/٫/g, '.').replace(/[,٬\s]/g, ''));
/* A number box that opens the phone's number pad (no spin arrows, commas allowed). */
const rcNumInput = (attrs, value, placeholder = '0') => `<input type="text" inputmode="decimal" data-pad="dec" autocomplete="off" enterkeyhint="next" ${attrs} placeholder="${esc(placeholder)}" value="${esc(value)}">`;
const rcMoney = (n, cur) => (cur === 'USD' ? '$ ' : 'IQD ') + Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 2});
/* The units a receipt line can use: the buying format first, then the counting format and the recipe unit. */
function rcUnits(item){
  const c = stUnitChoices(item.id), buy = c.find(x => x.mode === 'buying');
  return (buy ? [buy, ...c.filter(x => x !== buy)] : c).map(x => ({id: x.unitId, mode: x.mode, label: x.label}));
}
const rcLineUnit = (l, item) => rcUnits(item).find(u => u.mode === l.unit) || rcUnits(item)[0];
async function rcLoad(){
  const r = await stockApi('receipts');
  if(!r.ok || !r.data) return;
  const list = r.data.receipts || [];
  stPruneShots(rcData, list);
  rcData.list = list; rcData.loaded = true; rcData.at = Date.now();
  if(state.view === 'receipts') rcPaintList();
}
setInterval(() => {
  if(!state.account || document.hidden || state.view !== 'receipts') return;
  const busy = rcData.list.some(x => RC_ACTIVE.includes(x.status));
  if(Date.now() - rcData.at > (busy ? 8000 : 30000)) rcLoad();
}, 4000);

function renderReceipts(){
  if(!stockState.loaded) return stLoadingHtml();
  const sups = sortedByName(state.suppliers);
  const usd = rcState.currency === 'USD';
  return `<div id="wkBar"></div>
  <section class="rc-form">
    <div class="rc-sec"><div class="rc-sec-h">${esc(t('rcDetails'))}</div><div class="rc-sec-b">
      <div class="field"><label for="rcSup">${esc(t('supplier'))}</label><select id="rcSup"><option value="">${esc(t('chooseSupplier'))}</option>${sups.map(s => `<option value="${esc(s.id)}" ${rcState.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="rcInv">${esc(t('rcInvoice'))}</label><input id="rcInv" class="rc-inv" type="text" inputmode="numeric" data-pad="int" autocomplete="off" maxlength="30" enterkeyhint="next" placeholder="1024" value="${esc(rcState.invoice)}"></div>
      <div class="rc-two">
        <div class="field"><label>${esc(t('rcCurrency'))}</label>${chipPickHtml('rcCur', ['IQD', 'USD $'], usd ? 'USD $' : 'IQD')}</div>
        <div class="field"><label>${esc(t('rcDelivery'))}</label>${chipPickHtml('rcDelPick', [t('rcNoDelivery'), t('rcHasDelivery')], rcState.delivery ? t('rcHasDelivery') : t('rcNoDelivery'))}</div>
      </div>
      <div class="field" id="rcRateBox" ${usd ? '' : 'hidden'}><label for="rcRate">${esc(t('rcRate'))}</label><div class="rc-affix"><span>1 $ =</span>${rcNumInput('id="rcRate"', rcState.rate, '1500')}<span>IQD</span></div></div>
      <div class="field" id="rcDelBox" ${rcState.delivery ? '' : 'hidden'}><label for="rcDelAmt">${esc(t('rcDeliveryAmt'))}</label><div class="rc-affix">${rcNumInput('id="rcDelAmt"', rcState.deliveryAmt, '10000')}<span id="rcDelCur">${usd ? '$' : 'IQD'}</span></div></div>
    </div></div>
    <div class="rc-sec"><div class="rc-sec-h">${esc(t('rcItems'))}</div><div class="rc-sec-b">
      <div id="rcLines"></div>
      <button type="button" class="rc-add" id="rcAddLine">${ICON_PLUS} ${esc(t('rcAddItem'))}</button>
    </div></div>
    <div class="rc-foot">
      <div class="rc-total"><span>${esc(t('rcTotal'))}:</span><b id="rcTotal"></b></div>
      <button type="button" class="btn btn-primary tr-wide" id="rcSend">${esc(t('rcSend'))}</button>
      <div class="field-hint tr-note">${esc(t('rcSendHint'))}</div>
    </div>
  </section>
  <div id="rcList"></div>`;
}
function rcLineHtml(l, i){
  const item = stItem(l.itemId);
  const remove = rcState.lines.length > 1 ? `<button type="button" class="icon-btn danger rc-remove" data-rcremove="${i}" aria-label="${esc(t('delete'))}">${ICON_DELETE}</button>` : '';
  if(!item){
    return `<div class="rc-line" data-rcline="${i}"><div class="rc-lbl">${esc(t('rcItemN')(i + 1))}</div>
      <div class="rc-line-top rc-line-search"><div class="search-wrap">${ICON_SEARCH}<input class="search-input rc-search" data-rcsearch="${i}" autocomplete="off" enterkeyhint="search" placeholder="${esc(t('rcSearchItem'))}" value="${esc(l.search)}"></div>${remove}</div>
      <div class="tr-results rc-results" data-rcresults="${i}"></div></div>`;
  }
  const units = rcUnits(item), u = rcLineUnit(l, item), wn = stWorkName(item.id);
  const total = rcNum(l.qty) * rcNum(l.cost);
  const unitBox = units.length > 1
    ? `<select data-rcunitsel="${i}" aria-label="${esc(t('unit'))}">${units.map(x => `<option value="${x.mode}" ${x.mode === u.mode ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`
    : `<div class="rc-static">${esc(u ? u.label : '')}</div>`;
  return `<div class="rc-line" data-rcline="${i}"><div class="rc-lbl">${esc(t('rcItemN')(i + 1))}</div>
    <button type="button" class="rc-item" data-rcchange="${i}"><span><span class="name" dir="auto">${esc(item.name)}</span>${wn !== item.name ? `<span class="meta" dir="auto">${esc(t('trWorkAs'))}: ${esc(wn)}</span>` : ''}</span><small>${esc(t('trChangeItem'))}</small></button>
    <div class="rc-grid">
      <div class="field"><label>${esc(t('unit'))}</label>${unitBox}</div>
      <div class="field"><label>${esc(t('rcQty'))}</label>${rcNumInput(`data-rcqty="${i}"`, l.qty)}</div>
      <div class="field"><label>${esc(t('rcCost'))}</label>${rcNumInput(`data-rccost="${i}"`, l.cost)}</div>
      <div class="field rc-tot-cell"><label>${esc(t('rcLineTotal'))}</label><div class="rc-line-total" data-rctotal="${i}">${total > 0 ? esc(rcMoney(total, rcState.currency)) : '—'}</div>${remove}</div>
    </div></div>`;
}
function rcPaintResults(i){
  const box = document.querySelector(`[data-rcresults="${i}"]`); if(!box) return;
  const l = rcState.lines[i], tokens = stTokens(l.search);
  // Like the workplace: tapping the box opens the whole list straight away; typing narrows it.
  // The chosen supplier's items come first.
  if(!tokens.length && !l.open){ box.innerHTML = ''; box.classList.remove('open'); return; }
  // Once a supplier is chosen, only that supplier's items are listed.
  const sup = rcState.supplierId;
  const hits = state.items.filter(it => (!sup || it.supplierId === sup) && (!tokens.length || stMatches(it, tokens)))
    .sort((a, b) => nameCollator().compare(a.name, b.name)).slice(0, 150);
  box.classList.add('open');
  box.innerHTML = hits.length ? hits.map(it => stReady(it)
    ? `<button type="button" class="list-row tappable tr-result" data-rcpick="${i}" data-id="${esc(it.id)}"><div><div class="name" dir="auto">${esc(it.name)}</div><div class="meta" dir="auto">${esc([unitLabel(it.unit), state.suppliers.find(x => x.id === it.supplierId)?.name].filter(Boolean).join(' · '))}</div></div></button>`
    : `<button type="button" class="list-row tappable tr-result todo" data-rcsetup="${esc(it.id)}"><div><div class="name" dir="auto">${esc(it.name)}</div><div class="meta">${esc(t('trTapToSetUp'))}</div></div><span class="it-chip todo">${esc(t('itBadgeTodo'))}</span></button>`).join('') : `<div class="field-hint">${esc(sup && !tokens.length ? t('rcNoSupItems') : t('trNoMatch'))}</div>`;
}
function rcPaintLines(){
  const box = document.getElementById('rcLines'); if(!box) return;
  box.innerHTML = rcState.lines.map(rcLineHtml).join('');
  rcState.lines.forEach((l, i) => { if(!l.itemId) rcPaintResults(i); });
  rcPaintTotal();
}
function rcTotal(){ return rcState.lines.reduce((n, l) => n + (l.itemId ? rcNum(l.qty) * rcNum(l.cost) : 0), 0); }
function rcPaintTotal(){
  const el = document.getElementById('rcTotal'); if(el) el.textContent = rcMoney(rcTotal(), rcState.currency);
  rcState.lines.forEach((l, i) => { const c = document.querySelector(`[data-rctotal="${i}"]`); if(c){ const v = rcNum(l.qty) * rcNum(l.cost); c.textContent = v > 0 ? rcMoney(v, rcState.currency) : '—'; } });
}
function rcProblem(){
  if(!rcState.supplierId) return t('rcNeedSupplier');
  if(!rcState.invoice.trim()) return t('rcNeedInvoice');
  const positive = v => Number.isFinite(rcNum(v)) && rcNum(v) > 0;
  if(rcState.currency === 'USD' && !positive(rcState.rate)) return t('rcNeedRate');
  if(rcState.delivery && !positive(rcState.deliveryAmt)) return t('rcNeedDelivery');
  const lines = rcState.lines.filter(l => l.itemId);
  if(!lines.length) return t('rcNeedItem');
  if(rcState.lines.some(l => !l.itemId)) return t('rcEmptyLine');
  if(lines.some(l => stItem(l.itemId)?.supplierId !== rcState.supplierId)) return t('rcOtherSupplier');
  if(lines.some(l => !stReady(stItem(l.itemId)) || !positive(l.qty) || !positive(l.cost) || !Number.isFinite(rcNum(l.qty) * rcNum(l.cost))) || !Number.isFinite(rcTotal())) return t('rcNeedNumbers');
  return '';
}
function rcSummaryHtml(){
  const sup = state.suppliers.find(s => s.id === rcState.supplierId);
  const row = (k, v) => `<div class="tr-sum-row"><span>${esc(k)}</span><b dir="auto">${esc(v)}</b></div>`;
  return `<div class="tr-sum">${row(t('supplier'), sup?.name || '')}${row(t('rcInvoice'), rcState.invoice.trim())}
    ${rcState.currency === 'USD' ? row(t('rcRate'), rcState.rate) : ''}${rcState.delivery ? row(t('rcDelivery'), rcMoney(rcNum(rcState.deliveryAmt), rcState.currency)) : ''}
    ${rcState.lines.map(l => { const it = stItem(l.itemId), u = rcLineUnit(l, it); return row(it.name, `${fmtQty(rcNum(l.qty))} ${u.label} × ${rcMoney(rcNum(l.cost), rcState.currency)}`); }).join('')}
    ${row(t('rcTotal'), rcMoney(rcTotal(), rcState.currency))}</div>`;
}
async function rcSend(){
  return withBusy(document.getElementById('rcSend'), async () => {
  const problem = rcProblem(); if(problem){ toast(problem, 'error'); return; }
  if(!(await showConfirm(rcSummaryHtml() + `<p>${esc(t('rcConfirm'))}</p>`, {okLabel: t('rcSend'), okClass: 'btn-primary'}))) return;
  const body = {supplierId: rcState.supplierId, invoice: rcState.invoice.trim().replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0), currency: rcState.currency,
    rate: rcState.currency === 'USD' ? rcNum(rcState.rate) : null, delivery: rcState.delivery ? rcNum(rcState.deliveryAmt) : null,
    lines: rcState.lines.map(l => { const it = stItem(l.itemId); return {itemId: it.id, unitId: rcLineUnit(l, it).id, qty: rcNum(l.qty), cost: rcNum(l.cost)}; })};
  const keyBody = JSON.stringify(body);
  if(!rcState.key || rcState.keyBody !== keyBody){ rcState.key = crypto.randomUUID(); rcState.keyBody = keyBody; }
  body.clientKey = rcState.key;
  const r = await stockApi('receipts', {method: 'POST', body});
  if(r.stale) return;
  if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
  Object.assign(rcState, {supplierId: '', invoice: '', currency: 'IQD', rate: '', delivery: false, deliveryAmt: '', lines: [rcNewLine()], key: null, keyBody: null});
  toast(t('rcSent')); render(); rcLoad();
  });
}
function rcStatus(x){
  if(x.status === 'prepared' && x.finalApprovedAt) return [t('rcStApproved'), 'ready'];
  return {waiting: [t('rcStWaiting'), 'wait'], preparing: [t('rcStPreparing'), 'run'], prepared: [t('rcStPrepared'), 'wait'], submitting: [t('rcStSubmitting'), 'run'],
    completed: [t('rcStCompleted'), 'ok'], needs_checking: [t('rcStNeeds'), 'bad'], closed: [t('rcStNeeds'), 'bad'],
    failed: [t('rcStFailed'), 'off'], cancelled: [t('rcStCancelled'), 'off']}[x.status] || [x.status, 'off'];
}
/* Final approval: only for a filled-in receipt whose screenshot you have seen, within 20 minutes, with the PC set up to save receipts. */
function rcFinalButtonHtml(x, shot){
  if(x.status !== 'prepared' || x.finalApprovedAt) return '';
  const c = stockState.control || {};
  const live = c.workerOnline && c.workerReceiptsLive === true && c.workerPageReady !== false;
  const fresh = x.preparedAt && Date.now() - Date.parse(x.preparedAt) < 20 * 60 * 1000;
  const why = !shot ? t('rcFinalNeedShot') : !fresh ? t('rcFinalStale') : !live ? t('rcFinalNotLive') : '';
  return `<button type="button" class="btn btn-primary tr-wide" data-rcfinal="${esc(x.id)}" ${why ? 'disabled' : ''}>${esc(t('rcFinal'))}</button>${why ? `<div class="field-hint">${esc(why)}</div>` : ''}`;
}
function rcCardHtml(x){
  const [label, cls] = rcStatus(x);
  const total = (x.lines || []).reduce((n, l) => n + l.qty * l.cost, 0);
  const shot = rcData.shots[x.id];
  return `<article class="tr-req glass rc-card s-${esc(x.status)}"><div class="tr-req-top"><div><div class="tr-req-name" dir="auto">${esc(x.supplierName)}</div><div class="meta">${esc(t('rcInvoice'))}: ${esc(x.invoice)} · ${esc(fmtDateTime(x.createdAt))}</div></div><span class="tr-chip ${cls}">${esc(label)}</span></div>
    <div class="rc-card-lines">${(x.lines || []).map(l => `<div dir="auto">${esc(l.appName)} — ${esc(fmtQty(l.qty))} ${esc(l.unitLabel)} × ${esc(rcMoney(l.cost, x.currency))}</div>`).join('')}</div>
    <div class="rc-card-total">${esc(t('rcTotal'))}: <b>${esc(rcMoney(total, x.currency))}</b>${x.delivery ? ` · ${esc(t('rcDelivery'))} ${esc(rcMoney(x.delivery, x.currency))}` : ''}${x.currency === 'USD' ? ` · 1 USD = ${esc(fmtQty(x.rate))} IQD` : ''}</div>
    ${x.status === 'prepared' && !x.finalApprovedAt ? `<div class="tr-pc"><b>${esc(t('rcPcNow'))}</b></div>` : ''}
    ${x.status === 'completed' ? `<div class="tr-pc"><b>${esc(x.stockAddedAt ? t('rcStockAdded') : t('rcStCompleted'))}</b></div>` : ''}
    ${x.message && !['prepared', 'completed'].includes(x.status) ? `<div class="tr-pc">${esc(x.message)}</div>` : ''}
    ${x.resolvedNote ? `<div class="tr-pc">${esc(x.resolvedNote)}</div>` : ''}
    ${shot ? `<figure class="tr-shot"><img src="${esc(shot)}" alt="${esc(t('trShotLabel'))}"></figure>` : x.hasShot ? `<button type="button" class="btn btn-ghost" data-rcshot="${esc(x.id)}">${esc(t('rcShowShot'))}</button>` : ''}
    ${rcFinalButtonHtml(x, shot)}
    ${['needs_checking', 'closed'].includes(x.status) ? `<button type="button" class="btn btn-primary tr-wide" data-rcresolve="${esc(x.id)}">${esc(t('trCheckResult'))}</button>` : ''}
    ${['waiting', 'failed'].includes(x.status) || (x.status === 'prepared' && (!x.finalApprovedAt || Date.now() - Date.parse(x.finalApprovedAt) > 30 * 60 * 1000)) ? `<div class="tr-links"><button type="button" class="tr-textbtn danger" data-rccancel="${esc(x.id)}">${esc(t('rcCancel'))}</button></div>` : ''}</article>`;
}
function rcPaintList(){
  const box = document.getElementById('rcList'); if(!box) return;
  const list = rcData.list.slice(0, 30);
  const html = list.length ? `<div class="section-title">${esc(t('rcRecent'))} (${list.length})</div>${list.map(rcCardHtml).join('')}` : (rcData.loaded ? '' : stLoadingHtml());
  if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  box.querySelectorAll('[data-rcshot]').forEach(b => b.onclick = () => withBusy(b, async () => {
    const x = rcData.list.find(y => y.id === b.dataset.rcshot);
    if(x) await stLoadShot(rcData, x, 'receipts', rcPaintList);
  }));
  // A filled-in receipt shows its screenshot straight away, so it can be checked before the final approval.
  list.filter(x => x.status === 'prepared' && x.hasShot && !rcData.shots[x.id]).forEach(x => stLoadShot(rcData, x, 'receipts', rcPaintList));
  box.querySelectorAll('[data-rcfinal]').forEach(b => b.onclick = () => withBusy(b, async () => {
    const x = rcData.list.find(y => y.id === b.dataset.rcfinal); if(!x) return;
    const total = (x.lines || []).reduce((n, l) => n + l.qty * l.cost, 0);
    const row = (k, v) => `<div class="tr-sum-row"><span>${esc(k)}</span><b dir="auto">${esc(v)}</b></div>`;
    const html = `<div class="tr-sum">${row(t('supplier'), x.supplierName)}${row(t('rcInvoice'), x.invoice)}${(x.lines || []).map(l => row(l.appName, `${fmtQty(l.qty)} ${l.unitLabel} × ${rcMoney(l.cost, x.currency)}`)).join('')}${row(t('rcTotal'), rcMoney(total, x.currency))}</div><p>${esc(t('rcFinalConfirm'))}</p>`;
    if(!(await showConfirm(html, {okLabel: t('rcFinal'), okClass: 'btn-primary'}))) return;
    const r = await stockApi('receipts/final-approve', {method: 'POST', body: {id: x.id}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    toast(t('rcFinalDone')); rcLoad();
  }));
  box.querySelectorAll('[data-rcresolve]').forEach(b => b.onclick = () => rcResolve(b.dataset.rcresolve));
  box.querySelectorAll('[data-rccancel]').forEach(b => b.onclick = () => withBusy(b, async () => {
    if(!(await showConfirm(esc(t('rcCancelConfirm')), {okLabel: t('rcCancel')}))) return;
    const r = await stockApi('receipts/cancel', {method: 'POST', body: {id: b.dataset.rccancel}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    rcLoad();
  }));
}
function attachReceiptsEvents(){
  attachStockCommon();
  if(!document.getElementById('rcLines')) return;
  wkPaint();
  // A new supplier: lines with another supplier's item are taken off (their search box stays).
  document.getElementById('rcSup').onchange = e => {
    rcState.supplierId = e.target.value;
    let removed = 0;
    rcState.lines.forEach((l, i) => { if(l.itemId && rcState.supplierId && stItem(l.itemId)?.supplierId !== rcState.supplierId){ rcState.lines[i] = rcNewLine(); removed++; } });
    rcState.lines = rcState.lines.filter((l, i, all) => l.itemId || all.findIndex(x => !x.itemId) === i);
    rcPaintLines();
    if(removed) toast(t('rcOtherSupRemoved')(removed));
  };
  // Receipts in the workplace use invoice numbers only.
  document.getElementById('rcInv').oninput = e => { const v = e.target.value.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0).replace(/\D/g, ''); if(v !== e.target.value) e.target.value = v; rcState.invoice = v; };
  const form = document.querySelector('.rc-form');
  chipPickWire(form, 'rcCur', v => { rcState.currency = v === 'USD $' ? 'USD' : 'IQD'; document.getElementById('rcRateBox').hidden = rcState.currency !== 'USD'; document.getElementById('rcDelCur').textContent = rcState.currency === 'USD' ? '$' : 'IQD'; rcPaintTotal(); });
  document.getElementById('rcRate').oninput = e => { rcState.rate = e.target.value; };
  chipPickWire(form, 'rcDelPick', v => { rcState.delivery = v === t('rcHasDelivery'); document.getElementById('rcDelBox').hidden = !rcState.delivery; });
  document.getElementById('rcDelAmt').oninput = e => { rcState.deliveryAmt = e.target.value; };
  const lines = document.getElementById('rcLines');
  lines.addEventListener('input', e => {
    const s = e.target.dataset;
    if(s.rcsearch !== undefined){ rcState.lines[+s.rcsearch].search = e.target.value; rcState.lines[+s.rcsearch].open = true; rcPaintResults(+s.rcsearch); }
    else if(s.rcqty !== undefined){ rcState.lines[+s.rcqty].qty = e.target.value; rcPaintTotal(); }
    else if(s.rccost !== undefined){ rcState.lines[+s.rccost].cost = e.target.value; rcPaintTotal(); }
  });
  // Picking a search result must not blur the search box first (that moves the page under the finger).
  lines.addEventListener('pointerdown', e => { if(e.target.closest('[data-rcpick],[data-rcsetup]')) e.preventDefault(); });
  lines.addEventListener('focusin', e => { const i = e.target.dataset?.rcsearch; if(i !== undefined && rcState.lines[+i]){ rcState.lines[+i].open = true; rcPaintResults(+i); } });
  lines.addEventListener('focusout', e => {
    const i = e.target.dataset?.rcsearch; if(i === undefined) return;
    setTimeout(() => { const l = rcState.lines[+i]; if(l && !l.itemId && document.activeElement !== e.target){ l.open = false; rcPaintResults(+i); } }, 200);
  });
  lines.addEventListener('change', e => { const s = e.target.dataset; if(s.rcunitsel !== undefined){ rcState.lines[+s.rcunitsel].unit = e.target.value; rcPaintLines(); } });
  lines.addEventListener('click', e => {
    const pick = e.target.closest('[data-rcpick]'), change = e.target.closest('[data-rcchange]'), rm = e.target.closest('[data-rcremove]');
    const setup = e.target.closest('[data-rcsetup]');
    if(setup){ openItemModal(setup.dataset.rcsetup); return; }
    if(pick){ const l = rcState.lines[+pick.dataset.rcpick]; Object.assign(l, {itemId: pick.dataset.id, unit: 'buying', search: '', open: false}); rcPaintLines(); if(!PAD_TOUCH.matches) document.querySelector(`[data-rcqty="${pick.dataset.rcpick}"]`)?.focus(); }
    else if(change){ Object.assign(rcState.lines[+change.dataset.rcchange], rcNewLine()); rcPaintLines(); }
    else if(rm){ rcState.lines.splice(+rm.dataset.rcremove, 1); rcPaintLines(); }
  });
  document.getElementById('rcAddLine').onclick = () => {
    rcState.lines.push(rcNewLine()); rcPaintLines();
    const row = document.querySelector(`[data-rcline="${rcState.lines.length - 1}"]`);
    animateUi(row, [{opacity: 0, transform: 'translateY(10px)'}, {opacity: 1, transform: 'none'}]);
  };
  document.getElementById('rcSend').onclick = rcSend;
  // Tapping these while typing in a box must not first close the keyboard and move the button away.
  ['rcSend', 'rcAddLine'].forEach(id => document.getElementById(id).addEventListener('pointerdown', e => e.preventDefault()));
  rcPaintLines(); rcPaintList();
  if(Date.now() - rcData.at > 3000) rcLoad();
  stRefreshIfStale();
}

/* A receipt that needs checking: look in the workplace receipts, then say whether it was saved. Only "saved" adds stock. */
function rcResolve(id){
  const x = rcData.list.find(y => y.id === id); if(!x) return;
  showFormModal({
    title: esc(t('rcResolveTitle')),
    banner: editingBanner(x.supplierName, `${t('rcInvoice')}: ${x.invoice}`),
    bodyHtml: `<div class="notif-sub">${esc(t('rcResolveIntro'))}</div>
      <div class="field"><select id="rcsSaved"><option value="">${esc(t('trResolveChoose'))}</option><option value="yes">${esc(t('rcResolveYes'))}</option><option value="no">${esc(t('rcResolveNo'))}</option></select></div>
      <div class="field"><label>${esc(t('stNote'))}</label><input id="rcsNote" maxlength="900" autocomplete="off" placeholder="${esc(t('rcResolveNoteHint'))}"></div>`,
    okLabel: t('save'),
    onSubmit: async () => {
      const v = document.getElementById('rcsSaved').value, note = document.getElementById('rcsNote').value.trim();
      if(!v || note.length < 10) return {error: t('trResolveNeed')};
      const r = await stockApi('receipts/resolve', {method: 'POST', body: {id, saved: v === 'yes', note}});
      if(!r.ok) return {error: r.data?.error || t('saveFailed')};
      await loadStock(); rcLoad(); render(); return {};
    }
  });
}

/* ============ Create or update an ingredient in the workplace (a task for the PC) ============ */
const ijData = {list: [], loaded: false, at: 0, shots: {}, loadingShot: {}};
const wpSendKeys = new Map();
const IJ_ACTIVE = ['waiting', 'preparing', 'prepared', 'submitting'];
async function ijLoad(){
  const r = await stockApi('itemjobs');
  if(!r.ok || !r.data) return;
  const list = r.data.jobs || [];
  stPruneShots(ijData, list);
  ijData.list = list; ijData.loaded = true; ijData.at = Date.now();
  if(state.view === 'itemsAdmin') ijPaintList();
}
setInterval(() => {
  if(!state.account || document.hidden || state.view !== 'itemsAdmin' || !state.views.includes('stock')) return;
  const busy = ijData.list.some(x => IJ_ACTIVE.includes(x.status));
  if(Date.now() - ijData.at > (busy ? 8000 : 45000)) ijLoad();
}, 4000);
/* What the PC will put in the workplace form, from the item's saved setup. */
function wpPreviewRows(itemId, kind){
  const item = stItem(itemId), s = stSetting(itemId); if(!item || !s) return '';
  const u = id => unitName(stUnitObj(id)) || '';
  const name = (s.workplaceName || '').trim() || item.name;
  const row = (k, v) => `<div class="tr-sum-row"><span>${esc(k)}</span><b dir="auto">${esc(v)}</b></div>`;
  return `<div class="tr-sum">${kind === 'edit' && s.workplaceConfirmedName && s.workplaceConfirmedName !== name ? row(t('wpFrom'), s.workplaceConfirmedName) : ''}${row(t('itWorkName'), name)}
    ${row(t('itUsage'), u(s.usageUnit) || '—')}${row(t('itBuying'), u(item.unit))}${row(t('itCounting'), u(s.countingUnit))}
    ${s.usageUnit && s.countingUnit !== s.usageUnit ? row(`1 ${u(s.countingUnit)} =`, `${fmtQty(s.perCountingUsage)} ${u(s.usageUnit)}`) : ''}
    ${item.unit !== s.countingUnit ? row(`1 ${u(item.unit)} =`, `${fmtQty(s.perBuying)} ${u(s.countingUnit)}`) : ''}
    ${row(t('itWarn'), s.lowStock != null ? `${fmtQty(s.lowStock)} ${u(s.countingUnit)}` : '—')}</div>`;
}
async function wpSend(itemId, kind, btn){
  return withBusy(btn, async () => {
  const s = stSetting(itemId);
  if(!s || !s.usageUnit){ toast(t('wpNeedUsage'), 'error'); return; }
  if(!(await showConfirm(wpPreviewRows(itemId, kind) + `<p>${esc(t(kind === 'create' ? 'wpConfirmCreate' : 'wpConfirmEdit'))}</p>`, {okLabel: t(kind === 'create' ? 'wpCreate' : 'wpEdit'), okClass: 'btn-primary'}))) return;
  const fingerprint = JSON.stringify([itemId, kind, stItem(itemId)?.unit, s]);
  if(!wpSendKeys.has(fingerprint)) wpSendKeys.set(fingerprint, crypto.randomUUID());
  const r = await stockApi('itemjobs', {method: 'POST', body: {clientKey: wpSendKeys.get(fingerprint), itemId, kind}});
  if(r.stale) return;
  if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
  toast(t('wpSent')); ijLoad();
  wpSendKeys.delete(fingerprint);
  });
}
function ijStatus(x){
  if(x.status === 'prepared' && x.finalApprovedAt) return [t('rcStApproved'), 'ready'];
  return {waiting: [t('rcStWaiting'), 'wait'], preparing: [t('rcStPreparing'), 'run'], prepared: [t('rcStPrepared'), 'wait'], submitting: [t('rcStSubmitting'), 'run'],
    completed: [t('rcStCompleted'), 'ok'], needs_checking: [t('rcStNeeds'), 'bad'], failed: [t('rcStFailed'), 'off'], cancelled: [t('rcStCancelled'), 'off']}[x.status] || [x.status, 'off'];
}
function ijCardHtml(x){
  const [label, cls] = ijStatus(x), shot = ijData.shots[x.id], p = x.payload || {};
  const c = stockState.control || {};
  const live = c.workerOnline && c.workerItemsLive === true && c.workerPageReady !== false;
  const fresh = x.preparedAt && Date.now() - Date.parse(x.preparedAt) < 20 * 60 * 1000;
  const why = !shot ? t('rcFinalNeedShot') : !fresh ? t('rcFinalStale') : !live ? t('wpNotLive') : '';
  const canCancel = ['waiting', 'failed'].includes(x.status) || (x.status === 'prepared' && (!x.finalApprovedAt || Date.now() - Date.parse(x.finalApprovedAt) > 30 * 60 * 1000));
  return `<article class="tr-req glass rc-card s-${esc(x.status)}"><div class="tr-req-top"><div><div class="tr-req-name" dir="auto">${esc(p.name || x.itemName)}</div><div class="meta">${esc(t(x.kind === 'create' ? 'wpKindCreate' : 'wpKindEdit'))} · ${esc(fmtDateTime(x.createdAt))}</div></div><span class="tr-chip ${cls}">${esc(label)}</span></div>
    <div class="rc-card-lines" dir="auto">${esc([p.fromName && p.fromName !== p.name ? `${t('wpFrom')}: ${p.fromName}` : '', `${t('itUsage')}: ${p.usage}`, `${t('itBuying')}: ${p.buying}`, `${t('itCounting')}: ${p.counting}`].filter(Boolean).join(' · '))}</div>
    ${x.status === 'prepared' && !x.finalApprovedAt ? `<div class="tr-pc"><b>${esc(t('rcPcNow'))}</b></div>` : ''}
    ${x.message && !['prepared', 'completed'].includes(x.status) ? `<div class="tr-pc">${esc(x.message)}</div>` : ''}
    ${x.resolvedNote ? `<div class="tr-pc">${esc(x.resolvedNote)}</div>` : ''}
    ${shot ? `<figure class="tr-shot"><img src="${esc(shot)}" alt="${esc(t('trShotLabel'))}"></figure>` : x.hasShot ? `<button type="button" class="btn btn-ghost" data-ijshot="${esc(x.id)}">${esc(t('rcShowShot'))}</button>` : ''}
    ${x.status === 'prepared' && !x.finalApprovedAt ? `<button type="button" class="btn btn-primary tr-wide" data-ijfinal="${esc(x.id)}" ${why ? 'disabled' : ''}>${esc(t('wpFinal'))}</button>${why ? `<div class="field-hint">${esc(why)}</div>` : ''}` : ''}
    ${x.status === 'needs_checking' ? `<button type="button" class="btn btn-primary tr-wide" data-ijresolve="${esc(x.id)}">${esc(t('trCheckResult'))}</button>` : ''}
    ${canCancel ? `<div class="tr-links"><button type="button" class="tr-textbtn danger" data-ijcancel="${esc(x.id)}">${esc(t('wpCancel'))}</button></div>` : ''}</article>`;
}
function ijPaintList(){
  const box = document.getElementById('ijList'); if(!box) return;
  // Only tasks that still need someone, plus anything from the last day.
  const list = ijData.list.filter(x => !['completed', 'failed', 'cancelled'].includes(x.status) || Date.now() - Date.parse(x.createdAt) < 86400000).slice(0, 20);
  const html = list.length ? `<div class="section-title">${esc(t('wpTasks'))} (${list.length})</div>${list.map(ijCardHtml).join('')}` : '';
  if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  list.filter(x => x.status === 'prepared' && x.hasShot && !ijData.shots[x.id]).forEach(x => stLoadShot(ijData, x, 'itemjobs', ijPaintList));
  box.querySelectorAll('[data-ijshot]').forEach(b => b.onclick = () => withBusy(b, async () => {
    const x = ijData.list.find(y => y.id === b.dataset.ijshot);
    if(x) await stLoadShot(ijData, x, 'itemjobs', ijPaintList);
  }));
  box.querySelectorAll('[data-ijfinal]').forEach(b => b.onclick = () => withBusy(b, async () => {
    const x = ijData.list.find(y => y.id === b.dataset.ijfinal); if(!x) return;
    if(!(await showConfirm(`<p dir="auto"><b>${esc(x.payload?.name || x.itemName)}</b></p><p>${esc(t('wpFinalConfirm'))}</p>`, {okLabel: t('wpFinal'), okClass: 'btn-primary'}))) return;
    const r = await stockApi('itemjobs/final-approve', {method: 'POST', body: {id: x.id}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    toast(t('rcFinalDone')); ijLoad();
  }));
  box.querySelectorAll('[data-ijresolve]').forEach(b => b.onclick = () => ijResolve(b.dataset.ijresolve));
  box.querySelectorAll('[data-ijcancel]').forEach(b => b.onclick = () => withBusy(b, async () => {
    if(!(await showConfirm(esc(t('wpCancelConfirm')), {okLabel: t('wpCancel')}))) return;
    const r = await stockApi('itemjobs/cancel', {method: 'POST', body: {id: b.dataset.ijcancel}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    ijLoad();
  }));
}
function ijResolve(id){
  const x = ijData.list.find(y => y.id === id); if(!x) return;
  showFormModal({
    title: esc(t('wpResolveTitle')),
    banner: editingBanner(x.payload?.name || x.itemName, t(x.kind === 'create' ? 'wpKindCreate' : 'wpKindEdit')),
    bodyHtml: `<div class="notif-sub">${esc(t('wpResolveIntro'))}</div>
      <div class="field"><select id="ijsSaved"><option value="">${esc(t('trResolveChoose'))}</option><option value="yes">${esc(t('wpResolveYes'))}</option><option value="no">${esc(t('wpResolveNo'))}</option></select></div>
      <div class="field"><label>${esc(t('stNote'))}</label><input id="ijsNote" maxlength="900" autocomplete="off"></div>`,
    okLabel: t('save'),
    onSubmit: async () => {
      const v = document.getElementById('ijsSaved').value, note = document.getElementById('ijsNote').value.trim();
      if(!v || note.length < 10) return {error: t('trResolveNeed')};
      const r = await stockApi('itemjobs/resolve', {method: 'POST', body: {id, saved: v === 'yes', note}});
      if(!r.ok) return {error: r.data?.error || t('saveFailed')};
      await loadStock(); ijLoad(); render(); return {};
    }
  });
}
/* Called when the Items screen opens. */
function ijMount(){ ijPaintList(); if(Date.now() - ijData.at > 3000) ijLoad(); }
/* Receipt and item-task screenshots are shown small; tapping one opens it full size. */
document.addEventListener('click', e => {
  const img = e.target.closest?.('.rc-card .tr-shot img'); if(!img) return;
  showAlert(`<img class="tr-shot-big" src="${esc(img.getAttribute('src'))}" alt="">`);
});
