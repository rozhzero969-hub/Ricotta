/* ============ Receipts ============
   Receipts for Ricotta Restaurant, which Rico enters there from Rozha's Mac (helper/ and the API's
   receipts.ts). Three pages in one tab: the list, a receipt being written (laid out like Ricotta
   Restaurant's own New receipt page: Receipt details, then Items received, then the total) and one
   that was sent (Rico's photo to approve, or the saved receipt with its finance number). Names are the
   exact ones Rico read from Ricotta Restaurant; the rules are shared with the API (RicottaReceipts). */
const rr = {data:null, loading:false, page:'list', id:null, saveTimer:0, photos:{}, sending:false};
const RR_ACTIVE = ['queued','filling','review','approved','saving'];
const rrSubpage = ()=> state.view === 'receipts' && rr.page !== 'list';
const rrNum = (n, d = 0)=> Number(n || 0).toLocaleString('en-US', {maximumFractionDigits:d});
const rrMoney = (n, cur)=> cur === 'USD' ? '$' + rrNum(n, 2) : 'IQD ' + rrNum(n);
const rrRico = ()=> `<span class="rr-rico" aria-hidden="true">${ICON_SPARKLE}</span>`;
function rrFind(id){ return rr.data?.receipts.find(r=>r.id === id) || null; }
function rrLimits(){ return rr.data?.helper?.limits || {}; }

async function rrLoad(quiet = false){
  if(rr.loading) return;
  rr.loading = true;
  const r = await api('receipts', {quiet});
  rr.loading = false;
  if(r.ok && r.data && Array.isArray(r.data.receipts)){
    // A draft being typed keeps what is on the screen until it is saved.
    const editing = rr.page === 'edit' ? rrFind(rr.id) : null;
    rr.data = r.data;
    if(editing && !rrFind(editing.id)) rr.data.receipts.unshift(editing);
    else if(editing) rr.data.receipts = rr.data.receipts.map(x=>x.id === editing.id ? editing : x);
  }
  else if(!rr.data) rr.failed = true;
  if((state.view === 'receipts' && !document.activeElement?.closest?.('.rr-edit')) || (state.view === 'settings' && !document.activeElement?.closest?.('.rr-limits'))) render();
}

/* ---------- The list ---------- */
function renderReceipts(){
  if(rr.page === 'edit') return renderReceiptEdit();
  if(rr.page === 'view') return renderReceiptView();
  if(!rr.data){ if(!rr.loading && !rr.failed) rrLoad(); return rr.failed ? emptyState(t('loadFailed')) : loadingLines(4); }
  const h = rr.data.helper, list = rr.data.receipts;
  const today = erbilDate(new Date());
  const isToday = r=> erbilDate(new Date(r.sentAt || r.createdAt)) === today;
  const saved = list.filter(r=>r.status === 'saved' && isToday(r));
  const sum = saved.reduce((s, r)=> s + (r.currency === 'USD' ? Math.round(r.total * (r.rate || 0)) : r.total), 0);
  const needs = list.filter(r=>r.status === 'review' || (r.status === 'problem' && !rrIsPractice(r)));
  const drafts = list.filter(r=>r.status === 'draft');
  const rest = list.filter(r=>!needs.includes(r) && !drafts.includes(r));
  const ricoOn = h.online && !h.stopped;
  const row = r=>{
    const tone = rrIsPractice(r) ? 'draft' : r.status === 'saved' ? 'ok' : r.status === 'problem' ? 'bad' : r.status === 'review' ? 'wait' : r.status === 'draft' ? 'draft' : 'busy';
    return `<button type="button" class="rr-row" data-rr-open="${esc(r.id)}"><i class="rr-dot ${tone}" aria-hidden="true"></i>
      <span class="rr-row-main"><b dir="auto">${esc(r.supplier || t('rrNoSupplier'))}</b><small>${esc(rrStatusLine(r))}</small></span>
      <span class="rr-row-amt">${esc(r.total == null ? '' : rrMoney(r.total, r.currency))}</span></button>`;
  };
  return `<div class="rr-page">
    <section class="rr-card rr-overview">
      <div class="rr-ov-top">
        <div class="rr-ov-sum"><span>${esc(t('rrToday'))}</span><b>IQD ${esc(rrNum(sum))}</b><small>${esc(t('rrSavedToday')(saved.length))}</small></div>
        <button type="button" class="btn btn-primary rr-new" id="rrNew">${ICON_PLUS}<span>${esc(t('rrNew'))}</span></button>
      </div>
      <div class="rr-ov-rico"><i class="rr-dot ${ricoOn ? 'ok' : ''}" aria-hidden="true"></i><span>${esc(rrHelperLine(h))}</span>${isRozha() ? rrRicoControls(h) : ''}</div>
      ${isRozha() ? rrRicoNote(h) : ''}
    </section>
    ${needs.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="rr-list rr-needs">${needs.map(row).join('')}</div>` : ''}
    ${drafts.length ? `<div class="section-title">${esc(t('rrDrafts'))}</div><div class="rr-list">${drafts.map(row).join('')}</div>` : ''}
    <div class="section-title">${esc(t('rrRecent'))}</div>
    ${rest.length ? `<div class="rr-list">${rest.slice(0, 80).map(row).join('')}</div>` : emptyState(t('rrEmpty'))}
    ${rr.data.catalog?.at ? `<p class="rr-foot">${esc(t('rrCatalogAt')(rr.data.catalog.items.length, formatIraqDateTime(new Date(rr.data.catalog.at), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})))}</p>` : `<p class="rr-foot">${esc(t('rrNoCatalog'))}</p>`}
  </div>`;
}
/* Start Rico (real or practice) or stop him, through the launcher on the Mac. */
function rrRicoControls(h){
  const l = h.launcher || {};
  const busy = !!l.command;
  const btn = (action, label, cls = '')=>`<button type="button" class="rr-ctl ${cls}" data-rico="${action}" ${busy || !l.online ? 'disabled' : ''}>${esc(label)}</button>`;
  const buttons = h.online ? btn('stop', t('rrStopRicoNow'), 'stop') : `${btn('real', t('rrStartRico'), 'go')}${btn('practice', t('rrPractice'))}`;
  return `<div class="rr-ctls">${buttons}</div>`;
}
function rrRicoNote(h){
  const l = h.launcher || {};
  const line = !l.online ? t('rrLauncherOff') : l.command ? t('rrLauncherWorking') : l.result || '';
  return line ? `<p class="rr-ctl-note">${esc(line)}</p>` : '';
}
/* Practice runs end as "problem" on purpose: they are not something to fix. */
const rrIsPractice = r=> r.status === 'problem' && /^Practice run/.test(r.problem || '');
function rrHelperLine(h){
  if(h.stopped) return t('rrRicoStopped');
  if(!h.online) return t('rrRicoOff');
  const on = h.busyWith ? t('rrRicoBusy') : t('rrRicoOn');
  return h.mode === 'practice' ? on + ' · ' + t('rrPracticeShort') : on;
}
const rrWhen = d=> d ? formatIraqDateTime(new Date(d), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'}) : '';
const rrSourceName = r=> t('rrSource_' + (['telegram','rico'].includes(r.source) ? r.source : 'app'));
function rrStatusLine(r){
  const inv = (r.invoice ? '#' + r.invoice + ' · ' : '') + rrWhen(r.createdAt) + (r.source === 'telegram' ? ' · Telegram' : '') + ' · ';
  if(r.status === 'saved') return inv + (r.finance?.no ? t('rrFinanceNo')(r.finance.tab, r.finance.no) : t('rrStatus_saved'));
  if(rrIsPractice(r)) return t('rrPracticeRun');
  if(r.status === 'problem') return r.problem || t('rrStatus_problem');
  return inv + t('rrStatus_' + r.status);
}
function attachReceiptsEvents(){
  if(rr.page === 'edit') return attachReceiptEdit();
  if(rr.page === 'view') return attachReceiptView();
  document.getElementById('rrNew')?.addEventListener('click', ()=>rrNewDraft());
  document.querySelectorAll('[data-rr-open]').forEach(b=>b.onclick = ()=>rrOpen(b.dataset.rrOpen));
  document.querySelectorAll('[data-rico]').forEach(b=>b.onclick = async ()=>{
    b.disabled = true;
    const res = await api('receipts-settings/rico', {method:'POST', body:{action:b.dataset.rico}});
    if(res.data?.helper || (res.ok && res.data)) rr.data.helper = res.data.helper || res.data;
    if(!res.ok) toast(res.data?.error === 'launcher_off' ? t('rrLauncherOff') : t('saveFailed'), 'error');
    render();
  });
}
function rrOpen(id){
  const r = rrFind(id); if(!r) return;
  rr.id = id; rr.page = r.status === 'draft' ? 'edit' : 'view';
  render(); scrollBox().scrollTo({top:0});
}
function rrBack(){ rr.page = 'list'; rr.id = null; render(); scrollBox().scrollTo({top:0}); }
function rrNewDraft(copyOf){
  if(!rr.data?.catalog?.items?.length){ toast(t('rrNoCatalog'), 'error'); return; }
  const src = copyOf || {};
  const r = {id:crypto.randomUUID(), by:state.account, source:'app', status:'draft', supplier:src.supplier || '', invoice:copyOf ? '' : '',
    zone:src.zone || 'Main Storage', currency:src.currency || 'IQD', rate:src.rate ?? null, delivery:src.delivery ?? null,
    lines:(src.lines || []).map(l=>({...l})), total:null, warnings:[], log:[], photos:[], version:0, createdAt:new Date().toISOString()};
  if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null});
  rr.data.receipts.unshift(r);
  rr.id = r.id; rr.page = 'edit';
  render(); scrollBox().scrollTo({top:0});
}

/* ---------- Writing a receipt ---------- */
function rrItem(name){ return rr.data.catalog.items.find(i=>i.name === name) || null; }
function rrBackBar(title, extra = ''){
  return `<header class="rr-head"><button type="button" class="rr-back" id="rrBack" aria-label="${esc(t('rrBack'))}"><svg width="10" height="16" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M10 2 2 10l8 8"/></svg></button><h1>${esc(title)}</h1>${extra}</header>`;
}
/* A search box with its own list: typing narrows it, Tab (Shift+Tab) and the arrows go through the
   matches, Enter picks one and moves on. The list opens by itself only while nothing is picked yet, so
   Tab still leaves a box that already has its answer. */
function rrCombo(id, value, placeholder, attrs = ''){
  return `<div class="rr-combo"><input id="${id}" class="rr-input" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}List" autocomplete="off" spellcheck="false" dir="auto" value="${esc(value || '')}" placeholder="${esc(placeholder)}" ${attrs}><div class="rr-pop" id="${id}List" role="listbox" hidden></div></div>`;
}
function rrComboBind(input, names, onPick){
  const pop = input.nextElementSibling;
  let shown = [], hi = -1, picked = input.value;
  const paint = ()=>{
    pop.innerHTML = shown.length ? shown.map((n, i)=>`<div class="rr-opt${i === hi ? ' hi' : ''}${n === picked ? ' on' : ''}" role="option" id="${input.id}O${i}" aria-selected="${i === hi}" data-i="${i}" dir="auto">${esc(n)}</div>`).join('')
      : `<div class="rr-opt none">${esc(t('rrNoMatch'))}</div>`;
    if(hi >= 0) input.setAttribute('aria-activedescendant', `${input.id}O${hi}`); else input.removeAttribute('aria-activedescendant');
    pop.querySelector('.hi')?.scrollIntoView({block:'nearest'});
  };
  const open = q=>{
    shown = (q ? globalThis.RicottaSearch.rank(names, q, n=>n) : names).slice(0, 80);
    hi = shown.length ? (q ? 0 : Math.max(0, shown.indexOf(picked))) : -1;
    pop.hidden = false; input.setAttribute('aria-expanded', 'true'); paint();
  };
  const close = ()=>{ pop.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const pick = n=>{ picked = n; input.value = n; close(); onPick(n, false); };
  input.addEventListener('focus', ()=>{ input.select(); if(!picked) open(''); });
  input.addEventListener('input', ()=>open(input.value.trim()));
  input.addEventListener('keydown', e=>{
    if(pop.hidden){
      if(e.key === 'ArrowDown'){ e.preventDefault(); open(''); }
      else if(e.key === 'Enter' && !e.metaKey && !e.ctrlKey && picked && input.value === picked){ e.preventDefault(); onPick(picked, true); }
      return;
    }
    if((e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length){
      e.preventDefault();
      const back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
      hi = (hi + (back ? -1 : 1) + shown.length) % shown.length; paint(); return;
    }
    if(e.key === 'Enter' && !e.metaKey && !e.ctrlKey){ e.preventDefault(); if(hi >= 0) pick(shown[hi]); return; }
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); input.value = picked; close(); }
  });
  input.addEventListener('blur', ()=>{ close(); if(input.value !== picked) input.value = picked; });
  pop.addEventListener('mousedown', e=>e.preventDefault());
  pop.addEventListener('click', e=>{ const o = e.target.closest('[data-i]'); if(o) pick(shown[+o.dataset.i]); });
}
/* Number boxes take digits only (Arabic and Kurdish digits become 0-9); a rate or quantity may have one point. */
function rrOnlyNum(el, dec){
  let v = String(el.value).replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6f0).replace(/[٫،,]/g, dec ? '.' : '');
  v = v.replace(dec ? /[^\d.]/g : /\D/g, '');
  if(dec){ const i = v.indexOf('.'); if(i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 3); }
  if(v !== el.value) el.value = v;
  return v === '' ? null : Number(v);
}
const RR_MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
function renderReceiptEdit(){
  const r = rrFind(rr.id); if(!r){ rr.page = 'list'; return renderReceipts(); }
  const cat = rr.data.catalog;
  const opt = (v, label, on)=>`<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const c = globalThis.RicottaReceipts.check(r, cat, rrLimits(), rr.data.last);
  const usd = r.currency === 'USD';
  const lines = r.lines.map((l, i)=>{
    const item = rrItem(l.item), units = item ? globalThis.RicottaReceipts.unitOptions(item) : [];
    const lineTotal = (Number(l.qty) || 0) * (Number(l.cost) || 0);
    const warn = c.warnings.filter(w=>w.line === i + 1).map(w=>rrWarnText(w)).join(' ');
    return `<div class="rr-line${warn ? ' warn' : ''}" data-line="${i}">
      <span class="rr-num">${i + 1}</span>
      <div class="rr-field rr-f-item"><label for="rrItem${i}">${esc(t('rrItem'))}</label>${rrCombo('rrItem' + i, l.item, t('rrSearchItem'), `data-l-item="${i}"`)}</div>
      <div class="rr-field rr-f-unit"><label for="rrUnit${i}">${esc(t('rrUnit'))}</label><select id="rrUnit${i}" data-l-unit="${i}" ${item ? '' : 'disabled'}>${opt('', t('rrBaseUnit'), !l.unit)}${units.map(u=>opt(u.label, u.label, u.label === l.unit)).join('')}</select></div>
      <div class="rr-field"><label for="rrQty${i}">${esc(t('rrQty'))}</label><input id="rrQty${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${l.qty ?? ''}" placeholder="0"></div>
      <div class="rr-field"><label for="rrCost${i}">${esc(t('rrUnitCost'))}${usd ? ' ($)' : ''}</label><input id="rrCost${i}" class="rr-input rr-n" inputmode="${usd ? 'decimal' : 'numeric'}" autocomplete="off" data-l-cost="${i}" value="${l.cost ?? ''}" placeholder="0"></div>
      <div class="rr-field rr-total"><span>${esc(t('rrTotal'))}</span><b>${lineTotal ? esc(rrMoney(lineTotal, r.currency)) : '0'}</b></div>
      <button type="button" class="rr-del" data-l-del="${i}" tabindex="-1" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button>
      ${warn ? `<p class="rr-line-warn">${esc(warn)}</p>` : ''}</div>`;
  }).join('');
  const head = `<div class="rr-lhead" aria-hidden="true"><span>#</span><span>${esc(t('rrItem'))}</span><span>${esc(t('rrUnit'))}</span><span>${esc(t('rrQty'))}</span><span>${esc(t('rrUnitCost'))}${usd ? ' ($)' : ''}</span><span>${esc(t('rrTotal'))}</span><span></span></div>`;
  return `<div class="rr-page rr-edit">${rrBackBar(t('rrNewTitle'), `<button type="button" class="rr-head-act" id="rrDiscard">${esc(t('rrDiscardReceipt'))}</button>`)}
    <section class="rr-card"><h2 class="rr-card-title">${esc(t('rrDetails'))}</h2>
      <div class="rr-grid">
        <div class="rr-field"><label for="rrSupplier">${esc(t('rrSupplier'))}</label>${rrCombo('rrSupplier', r.supplier, t('rrSearchSupplier'))}</div>
        <div class="rr-field"><label for="rrZone">${esc(t('rrZone'))}</label><select id="rrZone">${cat.zones.map(z=>opt(z, z, z === r.zone)).join('')}</select></div>
        <div class="rr-field"><label for="rrInvoice">${esc(t('rrInvoice'))}</label><input id="rrInvoice" class="rr-input rr-n" inputmode="numeric" autocomplete="off" maxlength="30" value="${esc(r.invoice || '')}" placeholder="${esc(t('rrInvoiceHint'))}"></div>
        <div class="rr-field"><span class="rr-label">${esc(t('rrCurrency'))}</span><div class="pill-seg rr-cur" role="radiogroup" aria-label="${esc(t('rrCurrency'))}">
          <button type="button" class="pill-seg-btn" role="radio" aria-checked="${!usd}" data-cur="IQD">IQD</button><button type="button" class="pill-seg-btn" role="radio" aria-checked="${usd}" data-cur="USD">USD $</button></div></div>
        ${usd ? `<div class="rr-field"><label for="rrRate">${esc(t('rrRate'))}</label><input id="rrRate" class="rr-input rr-n" inputmode="decimal" autocomplete="off" value="${r.rate ?? ''}" placeholder="1500"></div>`
          : `<div class="rr-field"><label for="rrDelivery">${esc(t('rrDelivery'))}</label><input id="rrDelivery" class="rr-input rr-n" inputmode="numeric" autocomplete="off" value="${r.delivery ?? ''}" placeholder="${esc(t('rrNoDelivery'))}"></div>`}
      </div></section>
    <section class="rr-card"><h2 class="rr-card-title"><span>${esc(t('rrItems'))}</span><span class="rr-count">${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</span></h2>
      <div class="rr-lines">${head}${lines}</div>
      <button type="button" class="rr-add" id="rrAdd">${ICON_PLUS}<span>${esc(t('rrAddItem'))}</span></button>
      <p class="rr-keys">${esc(t('rrKeysHint')(RR_MOD))}</p></section>
    <div class="rr-sum">
      <div class="rr-sum-total"><span>${esc(t('rrTotal'))}</span><b>${esc(rrMoney(c.total, r.currency))}</b><small>${esc(usd ? (c.iqd ? '= IQD ' + rrNum(c.iqd) : '') : (c.delivery ? t('rrPlusDelivery')(rrNum(c.items), rrNum(c.delivery)) : ''))}</small></div>
      <button type="button" class="btn btn-primary" id="rrSend">${esc(t('rrSend'))}</button>
    </div>
  </div>`;
}
function rrWarnText(w){
  if(w.code === 'priceJump') return t('rrWarnPrice')(w.pct, rrNum(w.before));
  if(w.code === 'duplicate') return t('rrWarnDuplicate')(w.first);
  if(w.code === 'tinyUnit') return t('rrWarnTinyUnit');
  if(w.code === 'rateOdd') return t('rrWarnRate')(w.min, w.max);
  if(w.code === 'bigTotal') return t('rrWarnBig')(rrNum(w.iqd));
  return '';
}
const RR_ERR_KEYS = {supplier:'rrErrSupplier', supplierUnknown:'rrErrSupplier', invoice:'rrErrInvoice', zone:'rrErrZone', currency:'rrErrRate', rate:'rrErrRate', deliveryUsd:'rrErrDelivery', delivery:'rrErrDelivery', noLines:'rrErrNoLines', tooManyLines:'rrErrNoLines', itemUnknown:'rrErrItem', unitUnknown:'rrErrUnit', qty:'rrErrQty', cost:'rrErrCost'};
function rrErrText(e){ const s = t(RR_ERR_KEYS[e.code] || 'rrErrItem'); return e.line ? t('rrLineN')(e.line) + ': ' + s : s; }
/* A number typed with Arabic or Kurdish digits, or a comma, still reads right. */
function rrParse(v, decimals){
  const s = String(v).replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6f0).replace(/[,\s]/g, '').replace('٫', '.');
  if(s === '') return null;
  if(!(decimals ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(s)) return NaN;
  return Number(s);
}
function rrSaveSoon(r){
  clearTimeout(rr.saveTimer);
  rr.saveTimer = setTimeout(()=>rrSaveDraft(r), 600);
}
async function rrSaveDraft(r){
  clearTimeout(rr.saveTimer);
  const body = {supplier:r.supplier || null, invoice:r.invoice || null, zone:r.zone, currency:r.currency, rate:Number.isFinite(r.rate) ? r.rate : null,
    delivery:Number.isFinite(r.delivery) ? r.delivery : null, lines:r.lines.filter(l=>l.item).map(l=>({item:l.item, unit:l.unit, qty:Number.isFinite(l.qty) ? l.qty : null, cost:Number.isFinite(l.cost) ? l.cost : null}))};
  const res = await api('receipts/' + r.id, {method:'PUT', body});
  if(res.ok && res.data?.id) r.version = res.data.version;
  return res.ok;
}
function attachReceiptEdit(){
  const r = rrFind(rr.id); if(!r) return;
  const cat = rr.data.catalog;
  const repaint = ()=>{ const top = scrollBox().scrollTop; render(); scrollBox().scrollTop = top; };
  const changed = (redraw = false)=>{ rrSaveSoon(r); if(redraw) repaint(); else rrPaintTotals(r); };
  const go = id=>{ const el = document.getElementById(id); if(!el) return; el.focus({preventScroll:true}); el.scrollIntoView({block:'nearest'}); el.select?.(); };
  const enter = (el, fn)=>{ if(el) el.addEventListener('keydown', e=>{ if(e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.isComposing){ e.preventDefault(); fn(); } }); };
  const firstItem = ()=>{ const i = r.lines.findIndex(l=>!l.item); return 'rrItem' + (i < 0 ? 0 : i); };
  const moneyBox = ()=> r.currency === 'USD' ? 'rrRate' : 'rrDelivery';
  document.getElementById('rrBack').onclick = async ()=>{ await rrSaveDraft(r); rrBack(); };
  // Supplier: pick, then the invoice number.
  rrComboBind(document.getElementById('rrSupplier'), cat.suppliers, (v, again)=>{
    if(!again && v !== r.supplier){ r.supplier = v; changed(true); }
    go('rrInvoice');
  });
  const zone = document.getElementById('rrZone'); if(zone) zone.onchange = ()=>{ r.zone = zone.value; changed(); };
  const inv = document.getElementById('rrInvoice');
  inv.oninput = ()=>{ const v = String(inv.value).replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6f0).replace(/\D/g, ''); if(v !== inv.value) inv.value = v; r.invoice = v; changed(); };
  enter(inv, ()=>go(moneyBox()));
  document.querySelectorAll('[data-cur]').forEach(b=>b.onclick = ()=>{ if(r.currency === b.dataset.cur) return; r.currency = b.dataset.cur; if(r.currency === 'USD') r.delivery = null; else r.rate = null; changed(true); });
  const num = (id, key, dec)=>{ const el = document.getElementById(id); if(!el) return; el.oninput = ()=>{ r[key] = rrOnlyNum(el, dec); el.classList.toggle('bad', Number.isNaN(r[key])); changed(); }; enter(el, ()=>go(firstItem())); };
  num('rrRate', 'rate', true); num('rrDelivery', 'delivery', false);
  const names = cat.items.map(i=>i.name);
  document.querySelectorAll('[data-l-item]').forEach(inp=>{
    const i = +inp.dataset.lItem;
    rrComboBind(inp, names, (v, again)=>{
      const l = r.lines[i];
      if(!again && v !== l.item){
        l.item = v;
        const units = rrItem(v) ? globalThis.RicottaReceipts.unitOptions(rrItem(v)) : [];
        // The unit it was bought in last time comes first, else the biggest one; a click changes it.
        const lastKey = Object.keys(rr.data.last || {}).find(k=>k.startsWith(v + '|') && units.some(u=>k === `${v}|${u.label}|${r.currency}`));
        l.unit = lastKey ? lastKey.slice(v.length + 1, lastKey.lastIndexOf('|')) : units.length ? units.reduce((a, b)=>b.factor > a.factor ? b : a).label : '';
        changed(true);
      }
      go('rrQty' + i);
    });
  });
  document.querySelectorAll('[data-l-unit]').forEach(s=>s.onchange = ()=>{ const i = +s.dataset.lUnit; r.lines[i].unit = s.value; changed(true); go('rrQty' + i); });
  document.querySelectorAll('[data-l-qty]').forEach(el=>{
    const i = +el.dataset.lQty;
    el.oninput = ()=>{ const v = rrOnlyNum(el, true); r.lines[i].qty = v; el.classList.toggle('bad', Number.isNaN(v)); changed(); };
    enter(el, ()=>go('rrCost' + i));
  });
  // Enter in the unit cost opens the next item (a new one after the last), already on its search box.
  const addLine = ()=>{ r.lines.push({item:'', unit:'', qty:null, cost:null}); repaint(); go('rrItem' + (r.lines.length - 1)); };
  document.querySelectorAll('[data-l-cost]').forEach(el=>{
    const i = +el.dataset.lCost;
    el.oninput = ()=>{ const v = rrOnlyNum(el, r.currency === 'USD'); r.lines[i].cost = v; el.classList.toggle('bad', Number.isNaN(v)); changed(); };
    enter(el, ()=>{ rrSaveSoon(r); if(i < r.lines.length - 1) go('rrItem' + (i + 1)); else addLine(); });
  });
  document.querySelectorAll('[data-l-del]').forEach(b=>b.onclick = ()=>{ r.lines.splice(+b.dataset.lDel, 1); if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null}); changed(true); });
  document.getElementById('rrAdd').onclick = addLine;
  document.getElementById('rrDiscard').onclick = async ()=>{
    if(!await showConfirm(esc(t('rrDiscardAsk')), {okLabel:t('rrDiscard')})) return;
    clearTimeout(rr.saveTimer);
    if(r.version) await api('receipts/' + r.id, {method:'DELETE'});
    rr.data.receipts = rr.data.receipts.filter(x=>x.id !== r.id);
    rrBack();
  };
  document.getElementById('rrSend').onclick = ()=>rrSend(r);
  // Cmd/Ctrl + Enter sends from anywhere on the page.
  document.onkeydown = e=>{
    if(state.view !== 'receipts' || rr.page !== 'edit'){ document.onkeydown = null; return; }
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); document.activeElement?.blur?.(); rrSend(r); }
  };
  // A new receipt starts on the supplier box (on a computer; a phone waits for a tap).
  if(!r.supplier && !matchMedia('(pointer: coarse)').matches && !document.activeElement?.closest?.('.rr-edit')) requestAnimationFrame(()=>go('rrSupplier'));
}
/* Only the totals change while typing a number: the boxes keep their focus and the keyboard stays up. */
function rrPaintTotals(r){
  const c = globalThis.RicottaReceipts.totals(r);
  r.lines.forEach((l, i)=>{ const b = document.querySelector(`[data-line="${i}"] .rr-total b`); if(b){ const v = (Number(l.qty) || 0) * (Number(l.cost) || 0); b.textContent = v ? rrMoney(v, r.currency) : '0'; } });
  const sum = document.querySelector('.rr-sum-total b'); if(sum) sum.textContent = rrMoney(c.total, r.currency);
  const small = document.querySelector('.rr-sum-total small'); if(small) small.textContent = r.currency === 'USD' ? (c.iqd ? '= IQD ' + rrNum(c.iqd) : '') : (c.delivery ? t('rrPlusDelivery')(rrNum(c.items), rrNum(c.delivery)) : '');
}
async function rrSend(r){
  if(rr.sending) return;
  r.lines = r.lines.filter(l=>l.item || l.qty || l.cost);
  const c = globalThis.RicottaReceipts.check(r, rr.data.catalog, rrLimits(), rr.data.last);
  if(c.errors.length){
    if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null});
    render();
    await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(rrErrText(e))}</li>`).join('')}</ul>`, {title:t('rrFixFirst')});
    return;
  }
  // Every warning is read and confirmed before Rico gets the receipt.
  if(c.warnings.length && !await showConfirm(`<ul class="rr-errs">${c.warnings.map(w=>`<li>${esc((w.line ? t('rrLineN')(w.line) + ': ' : '') + rrWarnText(w))}</li>`).join('')}</ul>`, {title:t('rrCheckThese'), okLabel:t('rrSendAnyway'), okClass:'btn-primary'})) return;
  if(c.warnings.some(w=>w.code === 'bigTotal') && !await showConfirm(esc(t('rrBigAgain')(rrNum(c.iqd))), {title:t('rrSureTitle'), okLabel:t('rrSend'), okClass:'btn-primary'})) return;
  rr.sending = true;
  try{
    if(!await rrSaveDraft(r)){ toast(t('saveFailed'), 'error'); return; }
    const res = await api(`receipts/${r.id}/send`, {method:'POST', body:{confirm:[...new Set(c.warnings.map(w=>w.code))]}});
    if(!res.ok){
      const msg = res.data?.error === 'invoice_already_sent' ? t('rrErrAlreadySent') : res.data?.errors ? res.data.errors.map(rrErrText).join(' · ') : t('saveFailed');
      toast(msg, 'error'); return;
    }
    Object.assign(r, res.data);
    toast(t('rrSent'));
    rr.page = 'view'; render(); scrollBox().scrollTo({top:0});
  } finally { rr.sending = false; }
}

/* ---------- A sent receipt ---------- */
function renderReceiptView(){
  const r = rrFind(rr.id); if(!r){ rr.page = 'list'; return renderReceipts(); }
  const photos = rr.photos[r.id];
  if(r.photos.length && (!photos || photos.count !== r.photos.length)) rrLoadPhotos(r);
  const head = r.status === 'saved'
    ? `<div class="rr-done"><span class="rr-done-tag">${ICON_CHECK}${esc(t('rrStatus_saved'))}</span><b>${esc(r.finance?.no ? t('rrFinanceNo')(r.finance.tab, r.finance.no) : t('rrStatus_saved'))}</b><small>${esc(r.finance?.month || '')}</small></div>`
    : `<div class="rr-state ${rrIsPractice(r) ? 'practice' : r.status}">${rrRico()}<div><b>${esc(rrIsPractice(r) ? t('rrPracticeRun') : t('rrStatus_' + r.status))}</b><small>${esc(r.status === 'problem' ? r.problem || '' : t('rrStatusHint_' + r.status))}</small></div></div>`;
  const lines = r.lines.map((l, i)=>`<li><span class="rr-num">${i + 1}</span><span><b dir="auto">${esc(l.item)}</b><small>${esc(rrNum(l.qty, 3))} × <bdi>${esc(l.unit)}</bdi> · ${esc(rrMoney(l.cost, r.currency))}</small></span><b>${esc(rrMoney(l.qty * l.cost, r.currency))}</b></li>`).join('');
  // A long page comes in several photos, top to bottom: each says which part it is ("2 of 3").
  const list = photos?.list || [], of = k=>list.filter(p=>p.kind === k).length, seen = {};
  const pics = list.map(p=>{ seen[p.kind] = (seen[p.kind] || 0) + 1; const label = t('rrPhoto_' + p.kind) + (of(p.kind) > 1 ? ' ' + t('rrPartOf')(seen[p.kind], of(p.kind)) : '');
    return `<a class="rr-photo" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(label)}" loading="lazy"><span>${esc(label)}</span></a>`; }).join('');
  const t2 = globalThis.RicottaReceipts.totals(r);
  return `<div class="rr-page">${rrBackBar(r.supplier || '')}
    ${head}
    ${r.photos.length ? `<div class="section-title">${esc(t('rrPhotos'))}</div><div class="rr-photos">${pics || loadingLines(1)}</div>` : ''}
    ${(r.warnings || []).length && r.status === 'review' ? `<div class="rr-card rr-warns">${r.warnings.map(w=>`<p>${esc((w.line ? t('rrLineN')(w.line) + ': ' : '') + rrWarnText(w))}</p>`).join('')}</div>` : ''}
    <div class="section-title">${esc(t('rrItemCount')(r.lines.length))}</div>
    <div class="rr-card"><dl class="rr-facts"><dt>${esc(t('rrInvoice'))}</dt><dd>${esc(r.invoice ? '#' + r.invoice : '')}</dd>
      <dt>${esc(t('rrMadeIn'))}</dt><dd>${esc(rrSourceName(r) + (accountLabel(r.by) ? ' · ' + accountLabel(r.by) : ''))}</dd>
      <dt>${esc(t('rrMadeAt'))}</dt><dd>${esc(rrWhen(r.createdAt))}</dd>
      ${r.sentAt ? `<dt>${esc(t('rrSentAt'))}</dt><dd>${esc(rrWhen(r.sentAt))}</dd>` : ''}
      ${r.approvedAt ? `<dt>${esc(t('rrApprovedAt'))}</dt><dd>${esc(rrWhen(r.approvedAt) + (accountLabel(r.approvedBy) ? ' · ' + accountLabel(r.approvedBy) : ''))}</dd>` : ''}
      ${r.savedAt ? `<dt>${esc(t('rrSavedAt'))}</dt><dd>${esc(rrWhen(r.savedAt))}</dd>` : ''}
      <dt>${esc(t('rrZone'))}</dt><dd>${esc(r.zone)}</dd>
      ${r.currency === 'USD' ? `<dt>${esc(t('rrRate'))}</dt><dd>${esc(rrNum(r.rate, 3))}</dd>` : r.delivery ? `<dt>${esc(t('rrDelivery'))}</dt><dd>${esc(rrNum(r.delivery))}</dd>` : ''}</dl>
      <ol class="rr-view-lines">${lines}</ol>
      <div class="rr-sum-line"><span>${esc(t('rrTotal'))}</span><b>${esc(rrMoney(t2.total, r.currency))}${r.currency === 'USD' ? ` <small>= IQD ${esc(rrNum(t2.iqd))}</small>` : ''}</b></div></div>
    ${r.log?.length ? `<div class="section-title">${esc(t('rrWhatRicoDid'))}</div><div class="rr-card rr-log">${r.log.slice(-20).map(e=>`<p><time>${esc(formatIraqDateTime(new Date(e.at), {hour:'numeric', minute:'2-digit'}))}</time><span>${esc(e.text)}</span></p>`).join('')}</div>` : ''}
    <div class="rr-view-actions">
      ${r.status === 'review' ? `<button type="button" class="btn btn-ghost" id="rrCancel">${esc(t('rrCancelReceipt'))}</button><button type="button" class="btn btn-primary" id="rrApprove">${esc(t('rrApprove'))}</button>` : ''}
      ${['queued','problem'].includes(r.status) ? `<button type="button" class="btn btn-ghost" id="rrCancel">${esc(t('rrCancelReceipt'))}</button>` : ''}
      ${['problem','cancelled','saved'].includes(r.status) ? `<button type="button" class="btn btn-ghost" id="rrCopy">${esc(t('rrCopy'))}</button>` : ''}
    </div>
  </div>`;
}
async function rrLoadPhotos(r){
  rr.photos[r.id] = {count:r.photos.length, list:rr.photos[r.id]?.list || []};
  const res = await api(`receipts/${r.id}/photos`, {quiet:true});
  if(res.ok && Array.isArray(res.data?.photos)){ rr.photos[r.id].list = res.data.photos; if(rr.page === 'view' && rr.id === r.id) render(); }
}
function attachReceiptView(){
  const r = rrFind(rr.id); if(!r) return;
  document.getElementById('rrBack').onclick = rrBack;
  const act = async (action, ask)=>{
    if(ask && !await showConfirm(esc(ask), {okLabel:action === 'approve' ? t('rrApprove') : t('rrCancelReceipt'), okClass:action === 'approve' ? 'btn-primary' : 'btn-danger'})) return;
    const res = await api(`receipts/${r.id}/${action}`, {method:'POST', body:{}});
    if(!res.ok){ toast(res.data?.error === 'too_late' ? t('rrTooLate') : t('saveFailed'), 'error'); rrLoad(true); return; }
    Object.assign(r, res.data); render();
  };
  const ap = document.getElementById('rrApprove'); if(ap) ap.onclick = ()=>act('approve', r.total >= (rrLimits().bigTotal || Infinity) ? t('rrBigAgain')(rrNum(r.total)) : null);
  const cn = document.getElementById('rrCancel'); if(cn) cn.onclick = ()=>act('cancel', t('rrCancelAsk'));
  const cp = document.getElementById('rrCopy'); if(cp) cp.onclick = ()=>rrNewDraft(r);
}

/* ---------- Settings: Rico ---------- */
function renderRicoReceiptSettings(){
  if(!isRozha() || !canOpen('receipts')) return '';
  const h = rr.data?.helper;
  if(!h){ if(!rr.loading) rrLoad(true); return ''; }
  if(!rr.tg && !rr.tgLoading){ rr.tgLoading = true; api('receipts-settings/telegram', {quiet:true}).then(r=>{ rr.tgLoading = false; if(r.ok){ rr.tg = r.data; if(state.view === 'settings') render(); } }); }
  return `<div class="section-title">${esc(t('rrSettingsTitle'))}</div>
    <div class="form-card rr-settings">
      <div class="rr-set-status">${rrRico()}<span><b>${esc(t('rrRicoMac'))}</b><small>${esc(rrHelperLine(h))}${h.online ? ' · ' + esc(h.signedIn ? t('rrSignedIn') : t('rrSignedOut')) : ''}</small></span></div>
      <label class="check-row preference-row"><input type="checkbox" id="rrAuto" ${h.autoApprove ? 'checked' : ''}><span>${esc(t('rrAutoApprove'))}<small>${esc(t('rrAutoApproveHint'))}</small></span></label>
      <label class="check-row preference-row"><input type="checkbox" id="rrStop" ${h.stopped ? 'checked' : ''}><span>${esc(t('rrStop'))}<small>${esc(t('rrStopHint'))}</small></span></label>
      <div class="rr-limits">
        <label class="rr-field"><span class="rr-label">${esc(t('rrLimBig'))}</span><input class="rr-input" id="rrLimBig" inputmode="numeric" value="${h.limits.bigTotal}"></label>
        <label class="rr-field"><span class="rr-label">${esc(t('rrLimJump'))}</span><input class="rr-input" id="rrLimJump" inputmode="numeric" value="${h.limits.priceJump}"></label>
        <label class="rr-field"><span class="rr-label">${esc(t('rrLimRateMin'))}</span><input class="rr-input" id="rrLimMin" inputmode="numeric" value="${h.limits.rateMin}"></label>
        <label class="rr-field"><span class="rr-label">${esc(t('rrLimRateMax'))}</span><input class="rr-input" id="rrLimMax" inputmode="numeric" value="${h.limits.rateMax}"></label>
      </div>
      <div class="rr-limits-actions"><button type="button" class="btn btn-ghost" id="rrLimDefault">${esc(t('rrLimDefaults'))}</button><button type="button" class="btn btn-primary" id="rrLimSave">${esc(t('rrLimSave'))}</button></div>
      <p class="field-hint">${esc(t('rrLimHint'))}</p>
      <div class="rr-set-status rr-tg"><span><b>${esc(t('rrTelegram'))}</b><small>${esc(!rr.tg ? '' : !rr.tg.ready ? t('rrTgNotSetUp') : rr.tg.connected ? t('rrTgConnected') : t('rrTgNotConnected'))}</small></span>
        ${rr.tg?.ready ? `<button type="button" class="btn btn-ghost" id="rrTgConnect">${esc(rr.tg.connected ? t('rrTgReconnect') : t('rrTgConnect'))}</button>` : ''}</div>
    </div>`;
}
function attachRicoReceiptSettings(){
  const put = async body=>{
    const res = await api('receipts-settings', {method:'PUT', body});
    if(res.ok && rr.data){ rr.data.helper = res.data; toast(t('rrSettingsSaved')); } else toast(t('saveFailed'), 'error');
    render();
  };
  const a = document.getElementById('rrAuto'); if(a) a.onchange = ()=>put({autoApprove:a.checked});
  const s = document.getElementById('rrStop'); if(s) s.onchange = ()=>put({stopped:s.checked});
  // The limits: asks twice above this total, warns at this price change, the dollar rate range.
  const lim = id=>rrParse(document.getElementById(id)?.value ?? '', false);
  const ls = document.getElementById('rrLimSave'); if(ls) ls.onclick = ()=>{
    const v = {bigTotal:lim('rrLimBig'), priceJump:lim('rrLimJump'), rateMin:lim('rrLimMin'), rateMax:lim('rrLimMax')};
    if(!(v.bigTotal > 0) || !(v.priceJump >= 1 && v.priceJump <= 500) || !(v.rateMin > 0) || !(v.rateMax >= v.rateMin)){ toast(t('rrLimBad'), 'error'); return; }
    put({limits:v});
  };
  const ld = document.getElementById('rrLimDefault'); if(ld) ld.onclick = ()=>put({limits:{bigTotal:1000000, priceJump:30, rateMin:1500, rateMax:1800}});
  // Opens the bot with a one-time code, so it knows this chat is Rozha's (and answers nobody else).
  const tgb = document.getElementById('rrTgConnect'); if(tgb) tgb.onclick = async ()=>{
    const win = window.open('', '_blank');
    const r = await api('receipts-settings/telegram', {method:'POST', body:{}});
    if(!r.ok || !r.data?.link){ win?.close(); toast(t('saveFailed'), 'error'); return; }
    if(win) win.location.href = r.data.link; else location.href = r.data.link;
    rr.tg = null;   // read again when Settings is drawn next
  };
}
