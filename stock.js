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
const stockState = {tabs: null, loaded: false, failed: false, storages: [], settings: new Map(), balances: new Map(), requests: [], counts: [], control: null, sig: '', shots: {}, lastLight: 0};
const trState = {from: '', to: '', itemId: '', qty: '', unit: 'counting', yesterday: false, search: '', reviewKey: null};
const stView = {storage: 'all', filter: 'all', search: ''};
const histView = {filter: 'all'};
const itemsView = {filter: 'all', search: ''};

/* ============ API + data ============ */
async function stockApi(path, {method = 'GET', body, timeout = 20000} = {}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  const s = apiSession();
  const headers = {'Content-Type': 'application/json'};
  if(s) headers['x-session-token'] = s.token;
  try{
    const res = await fetch(`${STOCK_API_URL}/${path}`, {method, headers, signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await res.json().catch(()=>null);
    if(res.status === 401 && s){ clearApiSession(); onSessionExpired(); }
    return {ok: res.ok, status: res.status, data};
  }catch(e){ return {ok: false, status: 0, data: null}; }
  finally{ clearTimeout(timer); }
}
function stApplyLive(d){
  stockState.requests = d.requests || [];
  stockState.control = d.control || null;
  const b = new Map();
  for(const x of d.balances || []) b.set(x.itemId + '|' + x.storage, x.quantity);
  stockState.balances = b;
  stockState.sig = JSON.stringify([stockState.requests, [...b], stockState.control && [stockState.control.workerOnline, stockState.control.launcherOnline]]);
}
async function loadStock(){
  const r = await stockApi('bootstrap');
  if(!r.ok || !r.data){ stockState.failed = true; return false; }
  const d = r.data;
  stockState.storages = d.storages || [];
  stockState.settings = new Map((d.settings || []).map(s => [s.itemId, s]));
  stockState.counts = d.counts || [];
  stockState.tabs = Array.isArray(d.tabs) ? d.tabs : null;
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
const stCountUnitEn = id => stUnitObj(stSetting(id)?.countingUnit)?.en || '';
/* An amount can be entered in the item's counting format, or in its buying format when the two differ (1 box = 12 piece). */
const stHasBoth = id => { const s = stSetting(id), item = stItem(id); return !!(s && item && item.unit && item.unit !== s.countingUnit && s.perBuying > 0); };
const stMode = id => (trState.unit === 'buying' && stHasBoth(id)) ? 'buying' : 'counting';
const stFactor = id => stMode(id) === 'buying' ? stSetting(id).perBuying : 1;          // counting units in one entered unit
const stEnteredUnit = id => stMode(id) === 'buying' ? stUnitObj(stItem(id).unit) : stUnitObj(stSetting(id)?.countingUnit);
const stEnteredName = id => { const u = stEnteredUnit(id); return u ? unitName(u) : ''; };
const stEnteredId = id => stEnteredUnit(id)?.id;
const stEnteredEn = id => stEnteredUnit(id)?.en || '';
/* How a request's amount reads: what was typed, plus the counting-unit amount when they differ. */
function reqAmountHtml(r){
  const q = r.enteredQuantity ?? r.quantity, u = r.enteredUnitLabel ?? r.unitLabel;
  const extra = u !== r.unitLabel ? ` <span class="tr-eq">= ${esc(fmtQty(r.quantity))} ${esc(r.unitLabel)}</span>` : '';
  return `${esc(fmtQty(q))} ${esc(u)}${extra}`;
}
const stIsLow = item => { const s = stSetting(item.id); return !!s && s.lowStock != null && stTotal(item.id) <= s.lowStock; };
const stLowCount = () => state.items.filter(i => stReady(i) && stIsLow(i)).length;
const stReadyItems = () => state.items.filter(stReady);
const stTokens = q => String(q || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
/* The name inside the workplace system (what the PC searches for); the same as the app name unless one was set. */
const stWorkName = id => stSetting(id)?.workplaceName || stItem(id)?.name || '';
const stMatches = (item, tokens) => { const n = (item.name + ' ' + (stSetting(item.id)?.workplaceName || '')).toLocaleLowerCase(); return tokens.every(x => n.includes(x)); };
const stNeedsChecking = () => stockState.requests.filter(r => r.status === 'needs_checking').length;
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
function workerBarHtml(){
  const c = stockState.control; if(!c) return '';
  const on = c.workerOnline;
  const waiting = !on && c.startRequestedAt && Date.now() - Date.parse(c.startRequestedAt) < 3 * 60 * 1000 && (!c.startHandledAt || c.startHandledAt < c.startRequestedAt || Date.now() - Date.parse(c.startHandledAt) < 3 * 60 * 1000);
  const label = on ? t('wkOn') : waiting ? t('wkStarting') : t('wkOff');
  const hint = on || c.launcherOnline ? '' : t('wkHintNoHelper');
  return `<div class="tr-worker glass ${on ? 'on' : 'off'}"><div class="tr-worker-txt"><span class="tr-worker-dot" aria-hidden="true"></span><div><b>${esc(t('wkTitle'))}: ${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</div></div>${on ? '' : `<button type="button" class="btn btn-primary" id="wkStart" ${(!c.launcherOnline || waiting) ? 'disabled' : ''}>${esc(t('wkTurnOn'))}</button>`}</div>`;
}
function wkPaint(){
  const box = document.getElementById('wkBar'); if(!box) return;
  const html = workerBarHtml(); if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  const b = document.getElementById('wkStart');
  if(b) b.onclick = async () => {
    b.disabled = true;
    const r = await stockApi('start-worker', {method: 'POST'});
    if(!r.ok) toast(r.data?.error || t('saveFailed'), 'error'); else toast(t('wkAsked'));
    await refreshStockLight(); wkPaint();
  };
}
function stRepaint(){
  if(state.view === 'transfers'){ wkPaint(); trPaintActive(); trPaintResults(); trPaintChosen(); }
  else if(state.view === 'stock') stPaintList();
  else if(state.view === 'history') render();
}

/* ============ Transfer screen ============ */
function renderTransfers(){
  if(!stockState.loaded) return stLoadingHtml();
  return `${stAttentionHtml()}
  <div id="wkBar"></div>
  <section class="tr-card">
    <div class="tr-crumbs" id="trCrumbs"></div>
    <div class="tr-step" id="trStFrom"><div class="tr-step-h"><span class="tr-num">1</span>${esc(t('trStepFrom'))}</div><div id="trFromList" class="tr-results"></div></div>
    <div class="tr-step" id="trStTo" hidden><div class="tr-step-h"><span class="tr-num">2</span>${esc(t('trStepTo'))}</div><div id="trToList" class="tr-results"></div></div>
    <div class="tr-step" id="trStItem" hidden><div class="tr-step-h"><span class="tr-num">3</span>${esc(t('trStepItem'))}</div>
      <div id="trPicker"><div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="trSearch" autocomplete="off" aria-label="${esc(t('searchPlaceholder'))}" value="${esc(trState.search)}"></div><div id="trResults" class="tr-results" aria-live="polite"></div></div>
    </div>
    <div id="trChosen" class="tr-chosen" hidden></div>
    <div class="tr-step" id="trAmount" hidden><div class="tr-step-h"><span class="tr-num">4</span>${esc(t('trStepAmount'))}</div>
      <div class="tr-units" id="trUnits" role="group" hidden></div>
      <div class="tr-qty"><button type="button" class="step-btn tr-step-btn" id="trLess" aria-label="${esc(t('trLess'))}">−</button><input id="trQty" type="number" inputmode="decimal" min="0" step="any" placeholder="0" aria-label="${esc(t('trQty'))}" value="${esc(trState.qty)}"><span class="tr-unit" id="trUnit"></span><button type="button" class="step-btn tr-step-btn" data-inc id="trMore" aria-label="${esc(t('trMore'))}">+</button></div>
      <button type="button" class="tr-link" id="trAll">${esc(t('trUseAll'))}</button>
    </div>
    <div id="trFinish" hidden>
      <label class="check-row tr-yesterday"><span>${esc(t('trYesterday'))}<small>${esc(t('trYesterdayHint'))}</small></span><input type="checkbox" id="trYesterday" ${trState.yesterday ? 'checked' : ''}></label>
      <p class="tr-hint" id="trHint"></p>
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
  const item = stItem(trState.itemId), picker = document.getElementById('trPicker'), chosen = document.getElementById('trChosen'), amount = document.getElementById('trAmount');
  if(!picker) return;
  const on = trStage() === 'amount';
  if(on){
    const from = trState.from, f = stFactor(item.id), free = stFree(item.id, from) / f, res = stReserved(item.id, from) / f, unit = stEnteredName(item.id);
    chosen.innerHTML = `<div><div class="name" dir="auto">${esc(item.name)}</div><div class="meta">${esc(t('trAvailable')(fmtQty(free), iso(unit), iso(from)))}${res > 1e-8 ? '<br>' + esc(t('trReserved')(fmtQty(res), iso(unit))) : ''}</div></div><button type="button" class="btn btn-ghost" id="trChange">${esc(t('trChangeItem'))}</button>`;
    document.getElementById('trUnit').textContent = unit;
    const chips = document.getElementById('trUnits');
    chips.hidden = !stHasBoth(item.id);
    if(!chips.hidden){
      chips.innerHTML = [['counting', stCountUnitName(item.id)], ['buying', unitName(stUnitObj(item.unit))]].map(([m, label]) =>
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
function trInvalidate(){ trState.reviewKey = null; const c = document.getElementById('trReviewCard'); if(c) c.hidden = true; }
function trReset(){ Object.assign(trState, {from: '', to: '', itemId: '', qty: '', unit: 'counting', yesterday: false, search: '', reviewKey: null}); }
function trReview(){
  const problem = trValid();
  if(problem){ toast(t(problem), 'error'); return; }
  const item = stItem(trState.itemId), qty = Number(trState.qty), f = stFactor(item.id), free = stFree(item.id, trState.from) / f;
  if(qty > free + 1e-8){ toast(t('trAvailable')(fmtQty(free), iso(stEnteredName(item.id)), iso(trState.from)), 'error'); return; }
  trState.reviewKey = trState.reviewKey || crypto.randomUUID();
  const card = document.getElementById('trReviewCard');
  card.innerHTML = `<div class="hero-eyebrow">${esc(t('trReviewTitle'))}</div>
    <div class="tr-rv-route">${esc(trState.from)} <span aria-hidden="true">→</span> ${esc(trState.to)}</div>
    <div class="tr-rv-item" dir="auto">${esc(item.name)}</div>${stWorkName(item.id) !== item.name ? `<div class="tr-rv-work" dir="auto">${esc(t('trWorkAs'))}: ${esc(stWorkName(item.id))}</div>` : ''}
    <div class="tr-rv-qty"><b>${esc(fmtQty(qty))}</b> ${esc(stEnteredName(item.id))}${f !== 1 ? ` <span class="tr-rv-eq">= ${esc(fmtQty(Math.round(qty * f * 1e8) / 1e8))} ${esc(stCountUnitName(item.id))}</span>` : ''}</div>
    <div class="hero-sub">${esc(trState.yesterday ? t('trWhenYesterday') : t('trWhenToday'))}</div>
    <div class="tr-rv-actions"><button type="button" class="btn btn-primary" id="trApprove">${esc(t('trApprove'))}</button><button type="button" class="btn tr-rv-edit" id="trEdit">${esc(t('trEditRequest'))}</button></div>`;
  card.hidden = false;
  card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  document.getElementById('trEdit').onclick = trInvalidate;
  document.getElementById('trApprove').onclick = trApprove;
}
async function trApprove(){
  const btn = document.getElementById('trApprove'); btn.disabled = true;
  const item = stItem(trState.itemId);
  try{
    const r = await stockApi('requests', {method: 'POST', body: {clientKey: trState.reviewKey, from: trState.from, to: trState.to, yesterday: trState.yesterday,
      itemId: item.id, quantity: trState.qty, unitId: stEnteredId(item.id), expectedName: stWorkName(item.id), expectedUnit: stEnteredEn(item.id)}});
    if(!r.ok){
      const msg = r.data?.error || t('saveFailed');
      if(/Catalog changed/i.test(msg)){ trInvalidate(); await loadData().catch(()=>{}); await loadStock(); render(); }
      toast(msg, 'error'); return;
    }
    trReset(); toast(t('trQueued'));
    await loadStock(); render();
    document.getElementById('trActive')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }finally{ if(btn.isConnected) btn.disabled = false; }
}
/* People and requests that are still on the PC, plus anything finished in the last half hour. */
function trShownRequests(){
  const cutoff = Date.now() - 30 * 60 * 1000;
  return stockState.requests.filter(r => ST_ACTIVE.includes(r.status) || (r.finishedAt && new Date(r.finishedAt).getTime() > cutoff))
    .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
}
/* A plain list of exactly what will move, shown on the card and again in the final confirmation. */
function trSummaryHtml(r){
  const row = (k, v) => `<div class="tr-sum-row"><span>${esc(t(k))}</span><b dir="auto">${v}</b></div>`;
  return `<div class="tr-sum">${row('trSumItem', esc(r.itemName))}${r.workplaceName && r.workplaceName !== r.itemName ? row('trSumWork', esc(r.workplaceName)) : ''}${row('trSumAmount', reqAmountHtml(r))}${row('trSumFrom', esc(r.from))}${row('trSumTo', esc(r.to))}${row('trSumDay', esc(r.yesterday ? t('trYesterday') : t('trSumToday')))}</div>`;
}
function trRequestCard(r){
  const st = reqState(r), shot = stockState.shots[r.id];
  const shotHtml = (img, label) => `<figure class="tr-shot"><img src="${esc(img)}" alt="${esc(label)}" data-trzoom="${esc(r.id)}"><figcaption>${esc(label)} · ${esc(t('trShotZoom'))}</figcaption></figure>`;
  let pc = '';
  if(r.status === 'waiting' || r.status === 'running' || r.status === 'needs_checking'){
    pc = `<div class="tr-pc"><span class="tr-pc-label">${esc(t('trPcCheck'))}</span>${r.previewMessage ? esc(r.previewMessage) : esc(t('trNoCheckYet'))}</div>`;
    if(shot && shot.check) pc += shotHtml(shot.check, t('trShotLabel'));
    else if(r.hasCheckShot) pc += `<div class="tr-shot-loading">${esc(t('trShotLoading'))}</div>`;
  }else if(r.resultMessage){
    pc = `<div class="tr-pc">${esc(r.resultMessage)}</div>`;
    if(shot && shot.result) pc += shotHtml(shot.result, t('trShotResult'));
  }
  let buttons = '';
  if(r.status === 'waiting'){
    buttons = (r.finalApprovedAt ? '' : `<button type="button" class="btn btn-primary tr-wide" data-trfinal="${esc(r.id)}" ${st.canApprove ? '' : 'disabled'}>${esc(t('trFinalApprove'))}</button>`)
      + `<div class="tr-btn-row"><button type="button" class="btn btn-ghost" data-trchange="${esc(r.id)}">${esc(t('trChangeReq'))}</button><button type="button" class="btn btn-danger" data-trcancel="${esc(r.id)}">${esc(t('trCancelReq'))}</button></div>`;
  }else if(r.status === 'needs_checking'){
    buttons = `<button type="button" class="btn btn-primary tr-wide" data-trresolve="${esc(r.id)}">${esc(t('trCheckResult'))}</button>`;
  }
  return `<article class="tr-req glass s-${esc(r.status)}" data-trreq="${esc(r.id)}">
    <div class="tr-req-top"><div><div class="tr-req-name" dir="auto">${esc(r.itemName)}</div>${r.workplaceName && r.workplaceName !== r.itemName ? `<div class="tr-req-work" dir="auto">${esc(t('trWorkAs'))}: ${esc(r.workplaceName)}</div>` : ''}<div class="tr-req-amt">${reqAmountHtml(r)}</div></div><span class="tr-chip ${esc(st.cls)}">${esc(st.label)}</span></div>
    <div class="tr-req-route">${esc(r.from)} <span aria-hidden="true">→</span> ${esc(r.to)}${r.yesterday ? ' · ' + esc(t('trYesterday')) : ''}</div>
    ${r.status === 'waiting' && !r.finalApprovedAt ? `<div class="tr-sum-title">${esc(t('trSumTitle'))}</div>${trSummaryHtml(r)}` : ''}
    ${pc}${buttons}</article>`;
}
function trPaintActive(){
  const box = document.getElementById('trActive'); if(!box) return;
  const list = trShownRequests();
  const html = list.length ? `<div class="section-title">${esc(t('trOnPc'))} (${list.length})</div>${list.map(trRequestCard).join('')}` : '';
  if(box.dataset.sig === html) return;
  box.dataset.sig = html; box.innerHTML = html;
  bindRequestButtons(box);
  list.forEach(stEnsureShots);
}
/* The PC's screenshots are loaded on demand and kept until the request changes. */
async function stEnsureShots(r){
  const need = r.hasCheckShot || r.status === 'completed' || r.status === 'needs_checking' || r.status === 'failed';
  if(!need) return;
  const key = r.id + '|' + (r.previewedAt || '') + '|' + r.status;
  const have = stockState.shots[r.id];
  if(have && have.key === key) return;
  stockState.shots[r.id] = {key, check: have?.check, result: have?.result, loading: true};
  const res = await stockApi('shots?id=' + encodeURIComponent(r.id));
  const entry = {key};
  for(const s of res.data?.shots || []) if(!entry[s.kind]) entry[s.kind] = s.image;
  stockState.shots[r.id] = entry;
  if(state.view === 'transfers') trPaintActive();
}
function bindRequestButtons(root){
  root.querySelectorAll('[data-trfinal]').forEach(b => b.onclick = async () => {
    const req = stockState.requests.find(x => x.id === b.dataset.trfinal);
    if(!(await showConfirm((req ? trSummaryHtml(req) : '') + '<p>' + esc(t('trFinalConfirm')) + '</p>', {okLabel: t('trFinalApprove'), okClass: 'btn-primary'}))) return;
    b.disabled = true;
    const r = await stockApi('final-approve', {method: 'POST', body: {id: b.dataset.trfinal}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); await refreshStockLight(); return; }
    toast(t('trFinalDone')); await refreshStockLight(); trPaintActive();
  });
  root.querySelectorAll('[data-trcancel]').forEach(b => b.onclick = async () => {
    if(!(await showConfirm(esc(t('trCancelConfirm')), {okLabel: t('trCancelReq')}))) return;
    const r = await stockApi('cancel', {method: 'POST', body: {id: b.dataset.trcancel}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    toast(t('trCancelled')); await loadStock(); render();
  });
  // Change = cancel this waiting request and reopen the form with its details filled in.
  root.querySelectorAll('[data-trchange]').forEach(b => b.onclick = async () => {
    const req = stockState.requests.find(x => x.id === b.dataset.trchange); if(!req) return;
    if(!(await showConfirm(esc(t('trChangeConfirm')), {okLabel: t('trChangeReq')}))) return;
    const r = await stockApi('cancel', {method: 'POST', body: {id: req.id}});
    if(!r.ok){ toast(r.data?.error || t('saveFailed'), 'error'); return; }
    Object.assign(trState, {from: req.from, to: req.to, itemId: req.itemId || '', qty: String(req.enteredQuantity ?? req.quantity), unit: (req.enteredUnitLabel && req.enteredUnitLabel !== req.unitLabel) ? 'buying' : 'counting', yesterday: !!req.yesterday, search: '', reviewKey: null});
    await loadStock(); render(); toast(t('trChangeDone'));
  });
  root.querySelectorAll('[data-trresolve]').forEach(b => b.onclick = () => openResolve(b.dataset.trresolve));
  root.querySelectorAll('[data-trzoom]').forEach(img => img.onclick = () => showAlert(`<img class="tr-shot-big" src="${esc(img.getAttribute('src'))}" alt="">`));
}
function attachTransfersEvents(){
  attachStockCommon();
  if(!document.getElementById('trFromList')) return;
  wkPaint();
  const qty = document.getElementById('trQty');
  const goBack = key => {           // change an earlier answer: it and everything after it are cleared
    if(key === 'from'){ trState.from = ''; trState.to = ''; }
    if(key === 'to') trState.to = '';
    trState.itemId = ''; trState.qty = ''; trState.unit = 'counting'; trState.search = '';
    const box = document.getElementById('trSearch'); if(box) box.value = '';
    trInvalidate(); trPaintAll(); trPaintHint();
  };
  document.getElementById('trCrumbs').onclick = e => { const b = e.target.closest('[data-crumb]'); if(b) goBack(b.dataset.crumb); };
  document.getElementById('trFromList').onclick = e => {
    const b = e.target.closest('[data-trsto]'); if(!b) return;
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
        if(stFree(item.id, trState.from) <= 1e-8){ toast(t('trNoneHere')(iso(trState.from)), 'error'); return; }
    trState.itemId = item.id; trState.qty = ''; trState.unit = 'counting'; trState.search = ''; trInvalidate(); qty.value = ''; trPaintAll(); qty.focus();
  };
  const setQty = v => { trState.qty = v > 0 ? String(v) : ''; qty.value = trState.qty; trInvalidate(); trPaintHint(); };
  qty.oninput = () => { trState.qty = qty.value; trInvalidate(); trPaintHint(); };
  document.getElementById('trMore').onclick = () => setQty(Math.round(((Number(qty.value) || 0) + 1) * 1e6) / 1e6);
  document.getElementById('trLess').onclick = () => setQty(Math.round(((Number(qty.value) || 0) - 1) * 1e6) / 1e6);
  document.getElementById('trAll').onclick = () => { if(trState.itemId) setQty(Math.floor(stFree(trState.itemId, trState.from) / stFactor(trState.itemId) * 1e6) / 1e6); };
  document.getElementById('trYesterday').onchange = e => { trState.yesterday = e.target.checked; trInvalidate(); };
  document.getElementById('trReview').onclick = trReview;
  trPaintAll(); trPaintActive();
  stRefreshIfStale();
}

/* ============ Check a "Needs checking" request by hand ============ */
function openResolve(id){
  const r = stockState.requests.find(x => x.id === id); if(!r) return;
  showFormModal({
    title: esc(t('trResolveTitle')),
    banner: editingBanner(r.itemName, `${fmtQty(r.enteredQuantity ?? r.quantity)} ${r.enteredUnitLabel ?? r.unitLabel} · ${r.from} → ${r.to}`),
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
  return state.items.filter(i => stMatches(i, tokens)).map(i => {
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
    <div class="st-actions"><button type="button" class="btn btn-primary" id="stCountAll">${esc(t('bcButton'))}</button></div>
    <div class="record-filters glass" role="group">${filters.map(f => `<button class="tab-pill ${stView.filter === f.id ? 'active' : ''}" aria-pressed="${stView.filter === f.id}" data-stfilter="${f.id}">${esc(f.label)}</button>`).join('')}</div>
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
    pills[Math.max(0, Math.min(pills.length - 1, index + step))].scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'center'});
  };
  document.getElementById('stTabsPrev').onclick = () => go(-1);
  document.getElementById('stTabsNext').onclick = () => go(1);
  tabs.addEventListener('wheel', e => { if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; e.preventDefault(); tabs.scrollBy({left: e.deltaY, behavior: 'auto'}); }, {passive: false});
  document.getElementById('stCountAll').onclick = () => openBulkCount();
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
    <div class="field"><label>${esc(t('itWarn'))}</label><div class="st-warn"><input id="mfLow" data-clear="1" type="number" inputmode="decimal" min="0" step="any" value="${s?.lowStock != null ? esc(s.lowStock) : ''}"><span class="st-unit-chip" id="mfLowUnit"></span></div><div class="field-hint">${esc(t('itWarnHint'))}</div></div>`;
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
  buy.addEventListener('change', paint); count.addEventListener('change', paint); per.addEventListener('input', paint); paint();
}
/* Checks the counting fields before anything is saved. Returns {} or {error}. */
function itemStockValidate(box, buyingId){
  const counting = box.querySelector('#mfCounting').value, per = box.querySelector('#mfPer').value, low = box.querySelector('#mfLow').value, work = box.querySelector('#mfWork').value.trim();
  if(!counting){ return (low !== '' || work !== '') ? {error: t('itChooseFormat')} : {}; }
  if(!buyingId) return {error: t('itNeedFormats')};
  if(counting !== buyingId && !(Number(per) > 0)) return {error: t('itNeedPer')};
  if(low !== '' && !(Number(low) >= 0)) return {error: t('itWarn')};
  return {};
}
/* Saves the counting setup for an item that has already been saved. Returns {} or {error}. */
async function itemStockSave(itemId, box, buyingId){
  const counting = box.querySelector('#mfCounting').value;
  if(!counting) return {};
  const per = box.querySelector('#mfPer').value, low = box.querySelector('#mfLow').value, work = box.querySelector('#mfWork').value.trim();
  const r = await stockApi('settings/' + encodeURIComponent(itemId), {method: 'PUT', body: {countingUnit: counting, perBuying: counting === buyingId ? null : per, lowStock: low === '' ? null : low, workplaceName: work}});
  if(!r.ok) return {error: r.data?.error || t('saveFailed')};
  stockState.settings.set(itemId, {itemId, countingUnit: counting, perBuying: counting === buyingId ? null : Number(per), lowStock: low === '' ? null : Number(low), workplaceName: work || null});
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
