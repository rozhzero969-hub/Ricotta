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
  if(state.view === 'receipts' && !document.activeElement?.closest?.('.rr-edit')) render();
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
  const needs = list.filter(r=>r.status === 'review' || r.status === 'problem');
  const drafts = list.filter(r=>r.status === 'draft');
  const rest = list.filter(r=>!needs.includes(r) && !drafts.includes(r) && r.status !== 'cancelled');
  const row = r=>{
    const tone = r.status === 'saved' ? 'ok' : r.status === 'problem' ? 'bad' : r.status === 'review' ? 'wait' : r.status === 'draft' ? 'draft' : 'busy';
    return `<button type="button" class="rr-row" data-rr-open="${esc(r.id)}"><i class="rr-dot ${tone}" aria-hidden="true"></i>
      <span class="rr-row-main"><b dir="auto">${esc(r.supplier || t('rrNoSupplier'))}</b><small>${esc(rrStatusLine(r))}</small></span>
      <span class="rr-row-amt">${esc(r.total == null ? '' : rrMoney(r.total, r.currency))}</span></button>`;
  };
  return `<div class="rr-page">
    <div class="rr-hero">
      <div class="rr-hero-top"><span>${esc(t('rrToday'))}</span><span class="rr-rico-state ${h.online && !h.stopped ? 'on' : ''}">${rrRico()}${esc(rrHelperLine(h))}</span></div>
      <div class="rr-hero-sum"><b>IQD ${esc(rrNum(sum))}</b><span>${esc(t('rrSavedToday')(saved.length))}</span></div>
      <button type="button" class="rr-new" id="rrNew">${ICON_PLUS}<span>${esc(t('rrNew'))}</span></button>
    </div>
    ${needs.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="rr-list rr-needs">${needs.map(row).join('')}</div>` : ''}
    ${drafts.length ? `<div class="section-title">${esc(t('rrDrafts'))}</div><div class="rr-list">${drafts.map(row).join('')}</div>` : ''}
    <div class="section-title">${esc(t('rrRecent'))}</div>
    ${rest.length ? `<div class="rr-list">${rest.slice(0, 80).map(row).join('')}</div>` : emptyState(t('rrEmpty'))}
    ${rr.data.catalog?.at ? `<p class="rr-foot">${esc(t('rrCatalogAt')(rr.data.catalog.items.length, formatIraqDateTime(new Date(rr.data.catalog.at), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})))}</p>` : `<p class="rr-foot">${esc(t('rrNoCatalog'))}</p>`}
  </div>`;
}
function rrHelperLine(h){
  if(h.stopped) return t('rrRicoStopped');
  if(!h.online) return t('rrRicoOff');
  return h.busyWith ? t('rrRicoBusy') : t('rrRicoOn');
}
function rrStatusLine(r){
  const inv = r.invoice ? '#' + r.invoice + ' · ' : '';
  if(r.status === 'saved') return inv + (r.finance?.no ? t('rrFinanceNo')(r.finance.tab, r.finance.no) : t('rrStatus_saved'));
  if(r.status === 'problem') return r.problem || t('rrStatus_problem');
  return inv + t('rrStatus_' + r.status);
}
function attachReceiptsEvents(){
  if(rr.page === 'edit') return attachReceiptEdit();
  if(rr.page === 'view') return attachReceiptView();
  document.getElementById('rrNew')?.addEventListener('click', ()=>rrNewDraft());
  document.querySelectorAll('[data-rr-open]').forEach(b=>b.onclick = ()=>rrOpen(b.dataset.rrOpen));
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
function rrBackBar(title){
  return `<header class="rr-head"><button type="button" class="rr-back" id="rrBack" aria-label="${esc(t('rrBack'))}"><svg width="10" height="16" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M10 2 2 10l8 8"/></svg></button><h1>${esc(title)}</h1></header>`;
}
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
      <div class="rr-line-top"><span class="rr-num">${i + 1}</span>
        <div class="rr-field rr-grow"><label for="rrItem${i}">${esc(t('rrItem'))}</label><select id="rrItem${i}" data-l-item="${i}">${opt('', t('rrSearchItem'), !l.item)}${cat.items.map(it=>opt(it.name, it.name, it.name === l.item)).join('')}</select></div>
        <button type="button" class="rr-del" data-l-del="${i}" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button></div>
      <div class="rr-line-grid">
        <div class="rr-field"><label for="rrUnit${i}">${esc(t('rrUnit'))}</label><select id="rrUnit${i}" data-l-unit="${i}" ${item ? '' : 'disabled'}>${opt('', t('rrBaseUnit'), !l.unit)}${units.map(u=>opt(u.label, u.label, u.label === l.unit)).join('')}</select></div>
        <div class="rr-field"><label for="rrQty${i}">${esc(t('rrQty'))}</label><input id="rrQty${i}" class="rr-input" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${l.qty ?? ''}" placeholder="0"></div>
        <div class="rr-field"><label for="rrCost${i}">${esc(t('rrUnitCost'))}${usd ? ' ($)' : ''}</label><input id="rrCost${i}" class="rr-input" inputmode="numeric" autocomplete="off" data-l-cost="${i}" value="${l.cost ?? ''}" placeholder="0"></div>
        <div class="rr-field rr-total"><span>${esc(t('rrTotal'))}</span><b>${lineTotal ? esc(rrMoney(lineTotal, r.currency)) : '0'}</b></div>
      </div>${warn ? `<p class="rr-line-warn">${esc(warn)}</p>` : ''}</div>`;
  }).join('');
  return `<div class="rr-page rr-edit">${rrBackBar(t('rrNewTitle'))}
    <section class="rr-card"><div class="rr-card-title">${esc(t('rrDetails'))}</div>
      <div class="rr-grid">
        <div class="rr-field"><label for="rrSupplier">${esc(t('rrSupplier'))}</label><select id="rrSupplier">${opt('', t('rrSelect'), !r.supplier)}${cat.suppliers.map(s=>opt(s, s, s === r.supplier)).join('')}</select></div>
        <div class="rr-field"><label for="rrZone">${esc(t('rrZone'))}</label><select id="rrZone">${cat.zones.map(z=>opt(z, z, z === r.zone)).join('')}</select></div>
        <div class="rr-field"><label for="rrInvoice">${esc(t('rrInvoice'))}</label><input id="rrInvoice" class="rr-input" inputmode="numeric" autocomplete="off" maxlength="30" value="${esc(r.invoice || '')}" placeholder="${esc(t('rrInvoiceHint'))}"></div>
        <div class="rr-field"><span class="rr-label">${esc(t('rrCurrency'))}</span><div class="pill-seg rr-cur" role="radiogroup" aria-label="${esc(t('rrCurrency'))}">
          <button type="button" class="pill-seg-btn" role="radio" aria-checked="${!usd}" data-cur="IQD">IQD</button><button type="button" class="pill-seg-btn" role="radio" aria-checked="${usd}" data-cur="USD">USD $</button></div></div>
        ${usd ? `<div class="rr-field"><label for="rrRate">${esc(t('rrRate'))}</label><input id="rrRate" class="rr-input" inputmode="decimal" autocomplete="off" value="${r.rate ?? ''}" placeholder="1500"></div>`
          : `<div class="rr-field"><label for="rrDelivery">${esc(t('rrDelivery'))}</label><input id="rrDelivery" class="rr-input" inputmode="numeric" autocomplete="off" value="${r.delivery ?? ''}" placeholder="${esc(t('rrNoDelivery'))}"></div>`}
      </div></section>
    <section class="rr-card"><div class="rr-card-title"><span>${esc(t('rrItems'))}</span><span class="rr-count">${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</span></div>
      <div class="rr-lines">${lines}</div>
      <button type="button" class="rr-add" id="rrAdd">${ICON_PLUS}<span>${esc(t('rrAddItem'))}</span></button></section>
    <div class="rr-sum">
      <div class="rr-sum-line"><span>${esc(t('rrTotal'))}</span><b>${esc(rrMoney(c.total, r.currency))}</b></div>
      <small>${esc(usd ? (c.iqd ? '= IQD ' + rrNum(c.iqd) : '') : (c.delivery ? t('rrPlusDelivery')(rrNum(c.items), rrNum(c.delivery)) : ''))}</small>
      <div class="rr-sum-actions"><button type="button" class="btn btn-ghost" id="rrDiscard">${esc(t('cancel'))}</button><button type="button" class="btn btn-primary" id="rrSend">${esc(t('rrSend'))}</button></div>
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
  const repaint = ()=>{ const top = scrollBox().scrollTop; render(); scrollBox().scrollTop = top; };
  const changed = (redraw = false)=>{ rrSaveSoon(r); if(redraw) repaint(); else rrPaintTotals(r); };
  document.getElementById('rrBack').onclick = async ()=>{ await rrSaveDraft(r); rrBack(); };
  const sel = (id, fn)=>{ const el = document.getElementById(id); if(el) el.onchange = ()=>fn(el.value); };
  sel('rrSupplier', v=>{ r.supplier = v; changed(true); });
  sel('rrZone', v=>{ r.zone = v; changed(); });
  const inv = document.getElementById('rrInvoice');
  inv.oninput = ()=>{ const v = String(inv.value).replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6f0).replace(/\D/g, ''); if(v !== inv.value) inv.value = v; r.invoice = v; changed(); };
  document.querySelectorAll('[data-cur]').forEach(b=>b.onclick = ()=>{ if(r.currency === b.dataset.cur) return; r.currency = b.dataset.cur; if(r.currency === 'USD') r.delivery = null; else r.rate = null; changed(true); });
  const num = (id, key, dec)=>{ const el = document.getElementById(id); if(el) el.oninput = ()=>{ r[key] = rrParse(el.value, dec); el.classList.toggle('bad', Number.isNaN(r[key])); changed(); }; };
  num('rrRate', 'rate', true); num('rrDelivery', 'delivery', false);
  document.querySelectorAll('[data-l-item]').forEach(s=>s.onchange = ()=>{
    const l = r.lines[+s.dataset.lItem]; l.item = s.value;
    const units = rrItem(l.item) ? globalThis.RicottaReceipts.unitOptions(rrItem(l.item)) : [];
    // The unit it was bought in last time comes first, else the biggest one; it can be changed.
    const lastKey = Object.keys(rr.data.last || {}).find(k=>k.startsWith(l.item + '|') && units.some(u=>k === `${l.item}|${u.label}|${r.currency}`));
    l.unit = lastKey ? lastKey.slice(l.item.length + 1, lastKey.lastIndexOf('|')) : units.length ? units.reduce((a, b)=>b.factor > a.factor ? b : a).label : '';
    changed(true);
  });
  document.querySelectorAll('[data-l-unit]').forEach(s=>s.onchange = ()=>{ r.lines[+s.dataset.lUnit].unit = s.value; changed(true); });
  document.querySelectorAll('[data-l-qty]').forEach(el=>el.oninput = ()=>{ const v = rrParse(el.value, true); r.lines[+el.dataset.lQty].qty = v; el.classList.toggle('bad', Number.isNaN(v)); changed(); });
  document.querySelectorAll('[data-l-cost]').forEach(el=>el.oninput = ()=>{ const v = rrParse(el.value, false); r.lines[+el.dataset.lCost].cost = v; el.classList.toggle('bad', Number.isNaN(v)); changed(); });
  document.querySelectorAll('[data-l-del]').forEach(b=>b.onclick = ()=>{ r.lines.splice(+b.dataset.lDel, 1); if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null}); changed(true); });
  document.getElementById('rrAdd').onclick = ()=>{
    r.lines.push({item:'', unit:'', qty:null, cost:null}); repaint();
    const sel = document.getElementById('rrItem' + (r.lines.length - 1));
    sel?.scrollIntoView({block:'center', behavior:'smooth'});
    if(sel) openSelSheet(sel);
  };
  document.getElementById('rrDiscard').onclick = async ()=>{
    if(!await showConfirm(esc(t('rrDiscardAsk')), {okLabel:t('rrDiscard')})) return;
    clearTimeout(rr.saveTimer);
    if(r.version) await api('receipts/' + r.id, {method:'DELETE'});
    rr.data.receipts = rr.data.receipts.filter(x=>x.id !== r.id);
    rrBack();
  };
  document.getElementById('rrSend').onclick = ()=>rrSend(r);
}
/* Only the totals change while typing a number: the boxes keep their focus and the keyboard stays up. */
function rrPaintTotals(r){
  const c = globalThis.RicottaReceipts.totals(r);
  r.lines.forEach((l, i)=>{ const b = document.querySelector(`[data-line="${i}"] .rr-total b`); if(b){ const v = (Number(l.qty) || 0) * (Number(l.cost) || 0); b.textContent = v ? rrMoney(v, r.currency) : '0'; } });
  const sum = document.querySelector('.rr-sum-line b'); if(sum) sum.textContent = rrMoney(c.total, r.currency);
  const small = document.querySelector('.rr-sum small'); if(small) small.textContent = r.currency === 'USD' ? (c.iqd ? '= IQD ' + rrNum(c.iqd) : '') : (c.delivery ? t('rrPlusDelivery')(rrNum(c.items), rrNum(c.delivery)) : '');
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
    : `<div class="rr-state ${r.status}">${rrRico()}<div><b>${esc(t('rrStatus_' + r.status))}</b><small>${esc(r.status === 'problem' ? r.problem || '' : t('rrStatusHint_' + r.status))}</small></div></div>`;
  const lines = r.lines.map((l, i)=>`<li><span class="rr-num">${i + 1}</span><span><b dir="auto">${esc(l.item)}</b><small>${esc(rrNum(l.qty, 3))} × <bdi>${esc(l.unit)}</bdi> · ${esc(rrMoney(l.cost, r.currency))}</small></span><b>${esc(rrMoney(l.qty * l.cost, r.currency))}</b></li>`).join('');
  const pics = (photos?.list || []).map(p=>`<a class="rr-photo" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(t('rrPhoto_' + p.kind))}" loading="lazy"><span>${esc(t('rrPhoto_' + p.kind))}</span></a>`).join('');
  const t2 = globalThis.RicottaReceipts.totals(r);
  return `<div class="rr-page">${rrBackBar(r.supplier || '')}
    ${head}
    ${r.photos.length ? `<div class="section-title">${esc(t('rrPhotos'))}</div><div class="rr-photos">${pics || loadingLines(1)}</div>` : ''}
    ${(r.warnings || []).length && r.status === 'review' ? `<div class="rr-card rr-warns">${r.warnings.map(w=>`<p>${esc((w.line ? t('rrLineN')(w.line) + ': ' : '') + rrWarnText(w))}</p>`).join('')}</div>` : ''}
    <div class="section-title">${esc(t('rrItemCount')(r.lines.length))}</div>
    <div class="rr-card"><dl class="rr-facts"><dt>${esc(t('rrInvoice'))}</dt><dd>${esc(r.invoice || '')}</dd><dt>${esc(t('rrZone'))}</dt><dd>${esc(r.zone)}</dd>
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
  return `<div class="section-title">${esc(t('rrSettingsTitle'))}</div>
    <div class="form-card rr-settings">
      <div class="rr-set-status">${rrRico()}<span><b>${esc(t('rrRicoMac'))}</b><small>${esc(rrHelperLine(h))}${h.online ? ' · ' + esc(h.signedIn ? t('rrSignedIn') : t('rrSignedOut')) : ''}</small></span></div>
      <label class="check-row preference-row"><input type="checkbox" id="rrAuto" ${h.autoApprove ? 'checked' : ''}><span>${esc(t('rrAutoApprove'))}<small>${esc(t('rrAutoApproveHint'))}</small></span></label>
      <label class="check-row preference-row"><input type="checkbox" id="rrStop" ${h.stopped ? 'checked' : ''}><span>${esc(t('rrStop'))}<small>${esc(t('rrStopHint'))}</small></span></label>
      <p class="field-hint">${esc(t('rrLimitsLine')(rrNum(h.limits.bigTotal), h.limits.priceJump, h.limits.rateMin, h.limits.rateMax))}</p>
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
}
