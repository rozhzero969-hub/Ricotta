/* ============ Receipts ============
   Receipts for Ricotta Restaurant, which Rico enters there from Rozha's Mac (helper/ and the API's
   receipts.ts). Three pages in one tab: the list, a receipt being written (laid out like Ricotta
   Restaurant's own New receipt page: Receipt details, then Items received, then the total) and one
   that was sent (Rico's photo to approve, or the saved receipt with its finance number). Names are the
   exact ones Rico read from Ricotta Restaurant; the rules are shared with the API (RicottaReceipts). */
const rr = {data:null, loading:false, page:'edit', id:null, formId:null, saveTimer:0, photos:{}, sending:false, filter:{src:'all'}, fresh:false};
const RR_ACTIVE = ['queued','filling','review','approved','saving'];
const rrSubpage = ()=> state.view === 'receipts' && rr.page === 'view';
const rrNum = (n, d = 0)=> Number(n || 0).toLocaleString('en-US', {maximumFractionDigits:d});
const rrMoney = (n, cur)=> cur === 'USD' ? '$' + rrNum(n, 3) : 'IQD ' + rrNum(n, 3);
/* A unit as Ricotta Restaurant shows it: the size written "(×1000)" (the value stays "(1000×)"). */
const rrUnitShow = label=> String(label || '').replace(/\(\s*([\d.,]+)\s*×\s*\)/, '(×$1)');
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
    const editing = rrFind(rr.formId)?.status === 'draft' ? rrFind(rr.formId) : null;
    rr.data = r.data;
    if(editing && !rrFind(editing.id)) rr.data.receipts.unshift(editing);
    else if(editing) rr.data.receipts = rr.data.receipts.map(x=>x.id === editing.id ? editing : x);
  }
  else if(!rr.data) rr.failed = true;
  if((state.view === 'receipts' && !document.activeElement?.closest?.('.rr-edit')) || (state.view === 'settings' && !document.activeElement?.closest?.('.rr-limits'))
    || (state.view === 'history' && state.histMode === 'receipts' && !document.activeElement?.closest?.('.search-wrap'))) render();
}

/* ---------- The tab: a new receipt straight away (like Ricotta Restaurant's New receipt page), with
   Rico's switch above it and what needs you, drafts and today's receipts below it. ---------- */
function renderReceipts(){
  if(rr.page === 'view') return renderReceiptView();
  if(!rr.data){ if(!rr.loading && !rr.failed) rrLoad(); return rr.failed ? emptyState(t('loadFailed')) : loadingLines(4); }
  if(!rr.data.catalog?.items?.length) return `<div class="rr-page">${rrRicoBar(rr.data.helper)}${emptyState(t('rrNoCatalog'))}${rrBelow()}</div>`;
  const cur = rrFind(rr.formId);
  if(cur && cur.status === 'draft'){ rr.id = cur.id; rr.page = 'edit'; } else rrNewDraft(null, false);
  return renderReceiptEdit();
}
const rrRow = r=>{
  const tone = r.status === 'saved' ? 'ok' : r.status === 'problem' ? 'bad' : r.status === 'review' ? 'wait' : ['draft','cancelled'].includes(r.status) ? 'draft' : 'busy';
  return `<button type="button" class="rr-row" data-rr-open="${esc(r.id)}"><i class="rr-dot ${tone}" aria-hidden="true"></i>
    <span class="rr-row-main"><b dir="auto">${esc(r.supplier || t('rrNoSupplier'))}</b><small>${esc(rrStatusLine(r))}</small></span>
    <span class="rr-row-amt">${esc(r.total == null ? '' : rrMoney(r.total, r.currency))}</span></button>`;
};
/* Under the form: what needs you (to approve, or that Rico couldn't do), other drafts, and today's. */
function rrBelow(){
  const list = rr.data.receipts.filter(r=>!rrIsPractice(r)), shown = rrFiltered(list);
  const today = erbilDate(new Date()), isToday = r=> erbilDate(new Date(r.sentAt || r.createdAt)) === today;
  const needs = shown.filter(r=>r.status === 'review' || r.status === 'problem');
  const drafts = shown.filter(r=>r.status === 'draft' && r.id !== rr.id && !rrIsEmpty(r));
  const done = shown.filter(r=>!needs.includes(r) && r.status !== 'draft' && isToday(r));
  const saved = done.filter(r=>r.status === 'saved');
  const sum = saved.reduce((s, r)=> s + (r.currency === 'USD' ? Math.round(r.total * (r.rate || 0)) : r.total), 0);
  return `<div class="rr-below">${rrFilterBar(list)}
    ${needs.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="rr-list rr-needs">${needs.map(rrRow).join('')}</div>` : ''}
    ${drafts.length ? `<div class="section-title">${esc(t('rrDrafts'))}</div><div class="rr-list">${drafts.map(rrRow).join('')}</div>` : ''}
    <div class="section-title rr-today-title"><span>${esc(t('rrToday'))}</span>${saved.length ? `<small>${esc(t('rrSavedToday')(saved.length))} · IQD ${esc(rrNum(sum))}</small>` : ''}</div>
    ${done.length ? `<div class="rr-list">${done.map(rrRow).join('')}</div>` : `<p class="rr-none">${esc(t('rrNoneToday'))}</p>`}
    <button type="button" class="rr-to-history" data-to-history="receipts">${esc(t('rrSeeHistory'))}</button>
    ${rr.data.catalog?.at ? `<p class="rr-foot">${esc(t('rrCatalogAt')(rr.data.catalog.items.length, formatIraqDateTime(new Date(rr.data.catalog.at), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})))}</p>` : `<p class="rr-foot">${esc(t('rrNoCatalog'))}</p>`}
  </div>`;
}
/* Rico's line with Start / Practice / Stop, at the top of both the Receipts and the Transfers tab. */
function rrRicoBar(h){
  if(!h) return '';
  const on = h.online && !h.stopped;
  return `<section class="rr-card rr-ricobar"><div class="rr-ov-rico"><i class="rr-dot ${on ? 'ok' : ''}" aria-hidden="true"></i><span>${esc(rrHelperLine(h))}</span>${isRozha() ? rrRicoControls(h) : ''}</div>${isRozha() ? rrRicoNote(h) : ''}</section>`;
}
function attachRicoBar(){
  document.querySelectorAll('[data-rico]').forEach(b=>b.onclick = async ()=>{
    b.disabled = true;
    const res = await api('receipts-settings/rico', {method:'POST', body:{action:b.dataset.rico}});
    const h = res.data?.helper || (res.ok ? res.data : null);
    if(h){ if(rr.data) rr.data.helper = h; if(typeof tf !== 'undefined' && tf.data) tf.data.helper = h; }
    if(!res.ok) toast(res.data?.error === 'launcher_off' ? t('rrLauncherOff') : t('saveFailed'), 'error');
    rrRepaintKeep();
  });
  document.querySelectorAll('[data-to-history]').forEach(b=>b.onclick = ()=>{ state.histMode = b.dataset.toHistory; goView('history'); });
}
/* Redraws without losing the place on the page (a form being typed keeps its scroll). */
function rrRepaintKeep(){ const top = scrollBox().scrollTop; render(); scrollBox().scrollTop = top; }
/* The filter (made in the app or on Telegram), shared by the Receipts tab and History > Receipts. */
function rrFiltered(list){
  const f = rr.filter;
  return list.filter(r=>f.src === 'all' || (r.source === 'telegram' ? 'telegram' : 'app') === f.src);
}
function rrFilterBar(list){
  if(!list.length) return '';
  const f = rr.filter;
  const fsel = (key, opts)=>`<select class="rr-filter" data-rr-filter="${key}" aria-label="${esc(t('rrFilter_' + key))}">${opts.map(([v, label])=>`<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  return `<div class="rr-filters">
    ${fsel('src', [['all', t('rrAllPlaces')], ['app', t('rrSource_app')], ['telegram', t('rrSource_telegram')]])}
    ${f.src !== 'all' ? `<button type="button" class="rr-filter-clear" id="rrFilterClear">${esc(t('rrClearFilters'))}</button>` : ''}
  </div>`;
}
function attachRrFilters(){
  document.querySelectorAll('[data-rr-filter]').forEach(s=>s.onchange = ()=>{ rr.filter[s.dataset.rrFilter] = s.value; rrRepaintKeep(); });
  const clear = document.getElementById('rrFilterClear'); if(clear) clear.onclick = ()=>{ rr.filter = {src:'all'}; rrRepaintKeep(); };
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
const rrIsPractice = r=> r.status === 'problem' && (r.mode === 'practice' || /^Practice run/.test(r.problem || ''));
/* Real or practice: set when Rico takes the receipt (older ones are read from his message). */
const rrModeOf = r=> r.mode || (/^Practice run/.test(r.problem || '') ? 'practice' : ['saving','saved'].includes(r.status) ? 'real' : null);
function rrHelperLine(h){
  if(h.stopped) return t('rrRicoStopped');
  if(!h.online) return t('rrRicoOff');
  const on = h.busyWith ? t('rrRicoBusy') : t('rrRicoOn');
  return h.mode === 'practice' ? on + ' · ' + t('rrPracticeShort') : on;
}
const rrWhen = d=> d ? formatIraqDateTime(new Date(d), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'}) : '';
const rrSourceName = r=> t('rrSource_' + (['telegram','rico'].includes(r.source) ? r.source : 'app'));
function rrStatusLine(r){
  const inv = [r.invoice ? '#' + r.invoice : '', rrWhen(r.sentAt || r.createdAt), accountLabel(r.by), rrSourceName(r)].filter(Boolean).join(' · ') + ' · ';
  if(r.status === 'saved') return inv + (r.finance?.tab ? t('rrInInvoices')(r.finance.tab) : t('rrStatus_saved'));
  if(rrIsPractice(r)) return inv + t('rrPracticeRun');
  if(r.status === 'problem') return inv + (r.problem || t('rrStatus_problem'));
  return inv + t('rrStatus_' + r.status);
}
function attachReceiptsEvents(){
  if(rr.page === 'view') return attachReceiptView();
  document.querySelectorAll('[data-rr-open]').forEach(b=>b.onclick = ()=>rrOpen(b.dataset.rrOpen));
  attachRrFilters();
  attachRicoBar();
  if(rr.page === 'edit' && rrFind(rr.id)) attachReceiptEdit();
}
function rrOpen(id){
  const r = rrFind(id); if(!r) return;
  if(r.status === 'draft'){ rrDropBlankForm(r.id); rr.formId = id; }
  rr.id = id; rr.page = r.status === 'draft' ? 'edit' : 'view';
  render(); scrollBox().scrollTo({top:0});
}
/* Back from a sent receipt: to the form, with whatever was being typed in it. */
function rrBack(){ rr.page = 'edit'; rr.id = null; render(); scrollBox().scrollTo({top:0}); }
/* A form nobody typed in is never kept. */
function rrDropBlankForm(keep){
  const f = rrFind(rr.formId);
  if(f && f.id !== keep && f.status === 'draft' && !f.version && rrIsEmpty(f)) rr.data.receipts = rr.data.receipts.filter(x=>x.id !== f.id);
}
function rrNewDraft(copyOf, draw = true){
  if(!rr.data?.catalog?.items?.length){ if(draw) toast(t('rrNoCatalog'), 'error'); return; }
  rrDropBlankForm();
  const src = copyOf || {};
  const r = {id:crypto.randomUUID(), by:state.account, source:'app', status:'draft', supplier:src.supplier || '', invoice:copyOf ? '' : '',
    zone:src.zone || 'Main Storage', currency:src.currency || 'IQD', rate:src.rate ?? null, delivery:src.delivery ?? null,
    lines:(src.lines || []).map(l=>({...l})), total:null, warnings:[], log:[], photos:[], version:0, createdAt:new Date().toISOString()};
  if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null});
  rr.data.receipts.unshift(r);
  rr.id = rr.formId = r.id; rr.page = 'edit'; rr.fresh = true;
  if(draw){ render(); scrollBox().scrollTo({top:0}); }
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
function rrComboBind(input, names, onPick, extra){
  const pop = input.nextElementSibling;
  let shown = [], hi = -1, picked = input.value;
  const paint = ()=>{
    pop.innerHTML = shown.length ? shown.map((n, i)=>`<div class="rr-opt${i === hi ? ' hi' : ''}${n === picked ? ' on' : ''}" role="option" id="${input.id}O${i}" aria-selected="${i === hi}" data-i="${i}">${extra ? `<span dir="auto">${esc(n)}</span><small>${esc(extra(n))}</small>` : `<span dir="auto">${esc(n)}</span>`}</div>`).join('')
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
  // A click on a box with a name selects the whole name, so one Delete (or typing) replaces it.
  let focusing = false;
  input.addEventListener('focus', ()=>{ focusing = true; input.select(); if(!picked) open(''); });
  input.addEventListener('mouseup', e=>{ if(focusing){ e.preventDefault(); input.select(); } focusing = false; });
  input.addEventListener('blur', ()=>{ focusing = false; });
  input.addEventListener('input', ()=>open(input.value.trim()));
  input.addEventListener('keydown', e=>{
    if((e.key === 'Backspace' || e.key === 'Delete') && picked && input.value === picked){ e.preventDefault(); input.value = ''; open(''); return; }
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
/* Number boxes take digits only (Arabic and Kurdish digits become 0-9), plus one dot where decimals are
   allowed. Money boxes (unit cost, delivery) show commas while typing, 38,578.5, and the cursor stays
   where it was. */
function rrOnlyNum(el, dec, commas = false){
  const raw = String(el.value), at = el.selectionStart ?? raw.length;
  const clean = x=> x.replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6f0).replace(/٫/g, '.').replace(dec ? /[^\d.]/g : /\D/g, '');
  let v = clean(raw);
  if(dec){ const i = v.indexOf('.'); if(i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 3); }
  const shown = commas ? rrCommas(v) : v;
  if(shown !== raw){
    // Keep the cursor after the same number of digits as before.
    const keep = clean(raw.slice(0, at)).length;
    el.value = shown;
    let pos = 0, n = 0;
    while(pos < shown.length && n < keep){ if(/[\d.]/.test(shown[pos])) n++; pos++; }
    try{ if(document.activeElement === el) el.setSelectionRange(pos, pos); }catch(_){}
  }
  return v === '' ? null : Number(v);
}
const rrCommas = v=>{ const [a, b] = String(v).split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b !== undefined ? '.' + b : ''); };
const rrShowNum = v=> v == null || v === '' ? '' : rrCommas(String(v));
const RR_MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
function renderReceiptEdit(){
  const r = rrFind(rr.id); if(!r){ rr.page = 'edit'; rr.formId = null; return renderReceipts(); }
  const cat = rr.data.catalog;
  const opt = (v, label, on)=>`<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const c = globalThis.RicottaReceipts.check(r, cat, rrLimits(), rr.data.last);
  const usd = r.currency === 'USD';
  const lines = r.lines.map((l, i)=>{
    const item = rrItem(l.item), units = item ? globalThis.RicottaReceipts.unitOptions(item) : [];
    const lineTotal = globalThis.RicottaReceipts.lineTotal(l, r.currency);
    const warn = c.warnings.filter(w=>w.line === i + 1).map(w=>rrWarnText(w)).join(' ');
    return `<div class="rr-line${warn ? ' warn' : ''}" data-line="${i}">
      <div class="rr-field rr-f-item"><label for="rrItem${i}">${esc(t('rrItem'))} ${i + 1}</label>${rrCombo('rrItem' + i, l.item, t('rrSearchItem'), `data-l-item="${i}"`)}</div>
      <div class="rr-field rr-f-unit"><label for="rrUnit${i}">${esc(t('rrUnit'))}</label><select id="rrUnit${i}" data-l-unit="${i}" ${item ? '' : 'disabled'}>${opt('', t('rrBaseUnit'), !l.unit)}${units.map(u=>opt(u.label, rrUnitShow(u.label), u.label === l.unit)).join('')}</select></div>
      <div class="rr-field"><label for="rrQty${i}">${esc(t('rrQty'))}</label><input id="rrQty${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${l.qty ?? ''}" placeholder="0"></div>
      <div class="rr-field"><label for="rrCost${i}">${esc(t('rrUnitCost'))}${usd ? ' ($)' : ''}</label><input id="rrCost${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-cost="${i}" value="${rrShowNum(l.cost)}" placeholder="0"></div>
      <div class="rr-field rr-total"><span>${esc(t('rrTotal'))}</span><b>${lineTotal ? esc(rrMoney(lineTotal, r.currency)) : '—'}</b></div>
      <button type="button" class="rr-del" data-l-del="${i}" tabindex="-1" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button>
      ${warn ? `<p class="rr-line-warn">${esc(warn)}</p>` : ''}</div>`;
  }).join('');
  return `<div class="rr-page rr-edit">${rrRicoBar(rr.data.helper)}
    <section class="rr-card"><h2 class="rr-card-title">${esc(t('rrDetails'))}</h2>
      <div class="rr-grid">
        <div class="rr-field"><label for="rrSupplier">${esc(t('rrSupplier'))}</label>${rrCombo('rrSupplier', r.supplier, t('rrSearchSupplier'))}</div>
        <div class="rr-field"><label for="rrZone">${esc(t('rrZone'))}</label><select id="rrZone">${cat.zones.map(z=>opt(z, z, z === r.zone)).join('')}</select></div>
        <div class="rr-field"><label for="rrInvoice">${esc(t('rrInvoice'))}</label><input id="rrInvoice" class="rr-input rr-n" inputmode="numeric" autocomplete="off" maxlength="30" value="${esc(r.invoice || '')}" placeholder="${esc(t('rrInvoiceHint'))}"></div>
        <div class="rr-field"><span class="rr-label">${esc(t('rrCurrency'))}</span><div class="pill-seg rr-cur" role="radiogroup" aria-label="${esc(t('rrCurrency'))}">
          <button type="button" class="pill-seg-btn" role="radio" aria-checked="${!usd}" data-cur="IQD">IQD</button><button type="button" class="pill-seg-btn" role="radio" aria-checked="${usd}" data-cur="USD">USD $</button></div></div>
        ${usd ? `<div class="rr-field"><label for="rrRate">${esc(t('rrRate'))}</label><input id="rrRate" class="rr-input rr-n" inputmode="decimal" autocomplete="off" value="${r.rate ?? ''}" placeholder="1500"></div>`
          : `<div class="rr-field"><label for="rrDelivery">${esc(t('rrDelivery'))}</label><input id="rrDelivery" class="rr-input rr-n" inputmode="numeric" autocomplete="off" value="${rrShowNum(r.delivery)}" placeholder="${esc(t('rrNoDelivery'))}"></div>`}
      </div></section>
    <section class="rr-card"><h2 class="rr-card-title"><span>${esc(t('rrItems'))}</span><span class="rr-count">${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</span></h2>
      <div class="rr-lines">${lines}</div>
      <button type="button" class="rr-add" id="rrAdd">${ICON_PLUS}<span>${esc(t('rrAddItem'))}</span></button>
      <p class="rr-keys">${esc(t('rrKeysHint')(RR_MOD))}</p></section>
    <div class="rr-sum">
      <div class="rr-sum-total"><span>${esc(t('rrTotal'))}:</span> <b>${esc(rrMoney(c.total, r.currency))}</b><small>${esc(usd ? (c.iqd ? '= IQD ' + rrNum(c.iqd) : '') : (c.delivery ? t('rrPlusDelivery')(rrNum(c.items), rrNum(c.delivery)) : ''))}</small></div>
      <div class="rr-sum-acts"><button type="button" class="rr-cancel" id="rrDiscard">${esc(t('cancel'))}</button>
        <button type="button" class="btn btn-primary" id="rrSend">${ICON_CHECK}<span>${esc(t('rrSend'))}</span></button></div>
    </div>
    ${rrBelow()}
  </div>`;
}
function rrWarnText(w){
  if(w.code === 'priceJump') return t('rrWarnPrice')(w.pct, rrNum(w.before));
  if(w.code === 'duplicate') return t('rrWarnDuplicate')(w.first);
  if(w.code === 'tinyUnit') return t('rrWarnTinyUnit');
  if(w.code === 'rateOdd') return t('rrWarnRate')(w.min, w.max);
  if(w.code === 'bigTotal') return t('rrWarnBig')(rrNum(w.iqd));
  if(w.code === 'unitNameOdd') return t('rrWarnUnitName')(w.unit, rrNum(w.factor), w.base);
  if(w.code === 'gramPrice') return t('rrWarnGramPrice')(rrMoney(w.cost, w.currency), w.unit);
  if(w.code === 'unitPriceOdd') return t('rrWarnUnitPrice')(rrNum(w.times, 1), w.more, w.base);
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
const rrIsEmpty = r=> !r.supplier && !r.invoice && r.delivery == null && r.rate == null && !r.lines.some(l=>l.item || l.qty || l.cost);
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
  const num = (id, key, dec)=>{ const el = document.getElementById(id); if(!el) return; el.oninput = ()=>{ r[key] = rrOnlyNum(el, dec, key === 'delivery'); el.classList.toggle('bad', Number.isNaN(r[key])); changed(); }; enter(el, ()=>go(firstItem())); };
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
        // The unit bought last time, else the biggest one whose name agrees with its size (never a
        // "gram" that counts 1000 grams); a click changes it.
        const lastLabels = Object.keys(rr.data.last || {}).filter(k=>k.startsWith(v + '|') && k.endsWith('|' + r.currency)).map(k=>k.slice(v.length + 1, k.lastIndexOf('|')));
        l.unit = rrItem(v) ? globalThis.RicottaReceipts.defaultUnit(rrItem(v), lastLabels) : '';
        changed(true);
      }
      go('rrQty' + i);
    });
  });
  document.querySelectorAll('[data-l-unit]').forEach(s=>s.onchange = ()=>{ const i = +s.dataset.lUnit; r.lines[i].unit = s.value; changed(true); go('rrQty' + i); });
  document.querySelectorAll('[data-l-qty]').forEach(el=>{
    const i = +el.dataset.lQty;
    el.oninput = ()=>{ const v = rrOnlyNum(el, true); r.lines[i].qty = v; el.classList.toggle('bad', Number.isNaN(v)); changed(); autoLine(el); };
    enter(el, ()=>go('rrCost' + i));
  });
  // Enter in the unit cost opens the next item (a new one after the last), already on its search box.
  const addLine = ()=>{ r.lines.push({item:'', unit:'', qty:null, cost:null}); repaint(); go('rrItem' + (r.lines.length - 1)); };
  // Item, Qty and price all filled on the last line: the next empty line appears by itself, and the box
  // being typed in keeps its place.
  const autoLine = el=>{
    const last = r.lines[r.lines.length - 1];
    if(!(last.item && last.qty > 0 && last.cost > 0)) return;
    const id = el.id, at = el.selectionStart;
    r.lines.push({item:'', unit:'', qty:null, cost:null}); repaint();
    const again = document.getElementById(id); if(again){ again.focus({preventScroll:true}); try{ again.setSelectionRange(at, at); }catch(_){} }
  };
  document.querySelectorAll('[data-l-cost]').forEach(el=>{
    const i = +el.dataset.lCost;
    el.oninput = ()=>{ const v = rrOnlyNum(el, true, true); r.lines[i].cost = v; el.classList.toggle('bad', Number.isNaN(v)); changed(); autoLine(el); };
    enter(el, ()=>{ rrSaveSoon(r); if(i < r.lines.length - 1) go('rrItem' + (i + 1)); else addLine(); });
  });
  document.querySelectorAll('[data-l-del]').forEach(b=>b.onclick = ()=>{ r.lines.splice(+b.dataset.lDel, 1); if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null}); changed(true); });
  document.getElementById('rrAdd').onclick = addLine;
  document.getElementById('rrDiscard').onclick = async ()=>{
    if(!await showConfirm(esc(t('rrDiscardAsk')), {okLabel:t('rrDiscard')})) return;
    clearTimeout(rr.saveTimer);
    if(r.version) await api('receipts/' + r.id, {method:'DELETE'});
    rr.data.receipts = rr.data.receipts.filter(x=>x.id !== r.id);
    rrNewDraft(r.zone ? {zone:r.zone} : null);
  };
  document.getElementById('rrSend').onclick = ()=>rrSend(r);
  // Cmd/Ctrl + Enter sends from anywhere on the page.
  document.onkeydown = e=>{
    if(state.view !== 'receipts' || rr.page !== 'edit'){ document.onkeydown = null; return; }
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); document.activeElement?.blur?.(); rrSend(r); }
  };
  // A new receipt starts on the supplier box (on a computer; a phone waits for a tap).
  if(rr.fresh){ rr.fresh = false; if(!r.supplier && !matchMedia('(pointer: coarse)').matches) requestAnimationFrame(()=>go('rrSupplier')); }
}
/* Only the totals change while typing a number: the boxes keep their focus and the keyboard stays up. */
function rrPaintTotals(r){
  const c = globalThis.RicottaReceipts.totals(r);
  r.lines.forEach((l, i)=>{ const b = document.querySelector(`[data-line="${i}"] .rr-total b`); if(b){ const v = globalThis.RicottaReceipts.lineTotal(l, r.currency); b.textContent = v ? rrMoney(v, r.currency) : '—'; } });
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
    rrNewDraft({zone:r.zone});
  } finally { rr.sending = false; }
}

/* ---------- A sent receipt ---------- */
function renderReceiptView(){
  const r = rrFind(rr.id); if(!r){ rr.page = 'edit'; return renderReceipts(); }
  const photos = rr.photos[r.id];
  if(r.photos.length && (!photos || photos.count !== r.photos.length)) rrLoadPhotos(r);
  const head = r.status === 'saved'
    ? `<div class="rr-done"><span class="rr-done-tag">${ICON_CHECK}${esc(t('rrStatus_saved'))}</span><b>${esc(r.finance?.tab ? t('rrInInvoices')(r.finance.tab) : t('rrStatus_saved'))}</b><small>${esc(t('rrFindIt')(r.invoice, rrWhen(r.savedAt)))}</small></div>`
    : `<div class="rr-state ${rrIsPractice(r) ? 'practice' : r.status}">${rrRico()}<div><b>${esc(rrIsPractice(r) ? t('rrPracticeRun') : t('rrStatus_' + r.status))}</b><small>${esc(r.status === 'problem' ? r.problem || '' : t('rrStatusHint_' + r.status))}</small></div></div>`;
  const lines = r.lines.map((l, i)=>`<li><span class="rr-num">${i + 1}</span><span><b dir="auto">${esc(l.item)}</b><small>${esc(rrNum(l.qty, 3))} × <bdi>${esc(rrUnitShow(l.unit))}</bdi> · ${esc(rrMoney(l.cost, r.currency))}</small></span><b>${esc(rrMoney(globalThis.RicottaReceipts.lineTotal(l, r.currency), r.currency))}</b></li>`).join('');
  // A long page comes in several photos, top to bottom: each says which part it is ("2 of 3").
  const list = photos?.list || [], of = k=>list.filter(p=>p.kind === k).length, seen = {};
  const pics = list.map(p=>{ seen[p.kind] = (seen[p.kind] || 0) + 1; const label = t('rrPhoto_' + p.kind) + (of(p.kind) > 1 ? ' ' + t('rrPartOf')(seen[p.kind], of(p.kind)) : '');
    return `<button type="button" class="rr-photo" data-lb="${esc(r.id)}" data-lb-i="${list.indexOf(p)}"><img src="${esc(p.url)}" alt="${esc(label)}" loading="lazy"><span>${esc(label)}</span></button>`; }).join('');
  const t2 = globalThis.RicottaReceipts.totals(r);
  return `<div class="rr-page">${rrBackBar(r.supplier || '')}
    ${head}
    ${r.photos.length ? `<div class="section-title">${esc(t('rrPhotos'))}</div><div class="rr-photos">${pics || loadingLines(1)}</div>` : ''}
    ${(r.warnings || []).length && r.status === 'review' ? `<div class="rr-card rr-warns">${r.warnings.map(w=>`<p>${esc((w.line ? t('rrLineN')(w.line) + ': ' : '') + rrWarnText(w))}</p>`).join('')}</div>` : ''}
    <div class="section-title">${esc(t('rrItemCount')(r.lines.length))}</div>
    <div class="rr-card"><dl class="rr-facts"><dt>${esc(t('rrInvoice'))}</dt><dd>${esc(r.invoice ? '#' + r.invoice : '')}</dd>
      <dt>${esc(t('rrMadeIn'))}</dt><dd>${esc(rrSourceName(r) + (accountLabel(r.by) ? ' · ' + accountLabel(r.by) : ''))}</dd>
      <dt>${esc(t('rrMadeAt'))}</dt><dd>${esc(rrWhen(r.createdAt))}</dd>
      ${rrModeOf(r) ? `<dt>${esc(t('rrRicoMode'))}</dt><dd>${esc(t(rrModeOf(r) === 'practice' ? 'rrModePracticeLong' : 'rrModeReal'))}</dd>` : ''}
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
      ${r.status === 'problem' && !rrIsPractice(r) ? `<button type="button" class="btn btn-primary" id="rrRetry">${esc(t('rrRetry'))}</button>` : ''}
    </div>
  </div>`;
}
async function rrLoadPhotos(r){
  rr.photos[r.id] = {count:r.photos.length, list:rr.photos[r.id]?.list || []};
  const res = await api(`receipts/${r.id}/photos`, {quiet:true});
  if(res.ok && Array.isArray(res.data?.photos)){ rr.photos[r.id].list = res.data.photos; rrPaintPhotos(r); }
}
function attachReceiptView(){
  const r = rrFind(rr.id); if(!r) return;
  document.getElementById('rrBack').onclick = rrBack;
  const act = async (action, ask)=>{
    if(ask && !await showConfirm(esc(ask).replace(/\n/g, '<br>'), {okLabel:action === 'approve' ? t('rrApprove') : t('rrCancelReceipt'), okClass:action === 'approve' ? 'btn-primary' : 'btn-danger'})) return;
    const res = await api(`receipts/${r.id}/${action}`, {method:'POST', body:{}});
    if(!res.ok){ toast(res.data?.error === 'too_late' ? t('rrTooLate') : t('saveFailed'), 'error'); rrLoad(true); return; }
    Object.assign(r, res.data); render();
  };
  // Anything unusual (or a big total) is asked about once more before Rico saves it.
  const ws = (r.warnings || []).map(w=>(w.line ? t('rrLineN')(w.line) + ': ' : '') + rrWarnText(w)).filter(Boolean);
  const ask = ws.length ? t('rrApproveAsk') + '\n• ' + ws.join('\n• ') : r.total >= (rrLimits().bigTotal || Infinity) ? t('rrBigAgain')(rrNum(r.total)) : null;
  const ap = document.getElementById('rrApprove'); if(ap) ap.onclick = ()=>act('approve', ask);
  const cn = document.getElementById('rrCancel'); if(cn) cn.onclick = ()=>act('cancel', t('rrCancelAsk'));
  const cp = document.getElementById('rrCopy'); if(cp) cp.onclick = ()=>rrNewDraft(r);
  const rt = document.getElementById('rrRetry'); if(rt) rt.onclick = ()=>rrRetry(r);
  attachLightbox();
}

/* Retry: the same receipt to Rico again, after it is checked against the lists as they are now. If it
   had been approved, Rico may already have pressed Save, so Ricotta Restaurant is to be checked first. */
async function rrRetry(r){
  const c = globalThis.RicottaReceipts.check(r, rr.data.catalog, rrLimits(), rr.data.last);
  if(c.errors.length){ await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(rrErrText(e))}</li>`).join('')}</ul><p>${esc(t('rrRetryCopy'))}</p>`, {title:t('rrFixFirst')}); return; }
  const ws = c.warnings.map(w=>(w.line ? t('rrLineN')(w.line) + ': ' : '') + rrWarnText(w)).filter(Boolean);
  const msg = (r.approvedAt ? `<p><b>${esc(t('rrRetryCheckFirst'))}</b></p>` : '') + `<p>${esc(t('rrRetryAsk')(r.supplier || '', r.lines.length))}</p>` + (ws.length ? `<ul class="rr-errs">${ws.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>` : '');
  if(!await showConfirm(msg, {title:t('rrRetry'), okLabel:t('rrRetry'), okClass:'btn-primary'})) return;
  const res = await api(`receipts/${r.id}/send`, {method:'POST', body:{confirm:[...new Set(c.warnings.map(w=>w.code))]}});
  if(!res.ok){ toast(res.data?.error === 'invoice_already_sent' ? t('rrErrAlreadySent') : res.data?.errors ? res.data.errors.map(rrErrText).join(' · ') : t('saveFailed'), 'error'); rrLoad(true); return; }
  Object.assign(r, res.data); toast(t('rrSent')); render();
}

/* Setting "Start Rico when the app opens" (Rozha, off unless she turns it on): each time the app opens
   or comes back to the front, Rico is started if he is off, the Mac's launcher is on and he isn't
   stopped in Settings. At most every 2 minutes. */
let rrAutoAt = 0;
async function ricoAutoStart(){
  if(!isRozha() || !featureOn('ricoAutoStart') || !canOpen('receipts') || Date.now() - rrAutoAt < 120_000) return;
  rrAutoAt = Date.now();
  await rrLoad(true);
  const h = rr.data?.helper, l = h?.launcher || {};
  if(!h || h.online || h.stopped || !l.online || l.command) return;
  const res = await api('receipts-settings/rico', {method:'POST', body:{action:'real'}, quiet:true});
  if(!res.ok) return;
  rr.data.helper = res.data?.helper || res.data;
  if(typeof tf !== 'undefined' && tf.data) tf.data.helper = rr.data.helper;
  toast(t('rrAutoStarting'));
  if(['receipts', 'transfers'].includes(state.view) && !document.activeElement?.closest?.('.rr-edit')) rrRepaintKeep();
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
      <p class="field-hint rr-approve-note">${esc(t('rrPersonApproves'))}</p>
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

/* ---------- Rico's activity (Record tab, "Rico") ----------
   Every step of every receipt, each Start / Practice / Stop pressed, and how each start went. */
const rrAct = {list:null, loading:false};
async function rrLoadActivity(){
  if(rrAct.loading) return;
  rrAct.loading = true;
  const r = await api('receipts-activity', {quiet:true});
  rrAct.loading = false;
  if(r.ok && Array.isArray(r.data?.events)) rrAct.list = r.data.events;
  else if(!rrAct.list) rrAct.list = [];
  if(state.view === 'record' && state.recordFilter === 'rico') render();
}
function renderRicoActivity(){
  if(!rrAct.list){ rrLoadActivity(); return loadingLines(4); }
  if(!rrAct.list.length) return emptyState(t('rrNoActivity'));
  const who = by => by === 'auto' ? t('rrByHimself') : by === 'telegram' ? 'Telegram' : by === 'rico' ? 'Rico' : accountLabel(by) || by || '';
  return rrAct.list.map(e=>{
    const when = formatIraqDateTime(new Date(e.at), {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    const practice = e.mode === 'practice' || /^Practice run/.test(e.text || '');
    let badge, tone, name, line = '';
    if(e.kind === 'command'){ badge = t('rrEvPressed'); tone = 'edit'; name = t(e.status === 'stop' ? 'rrStopRicoNow' : e.status === 'practice' ? 'rrPractice' : 'rrStartRico'); }
    else if(e.kind === 'launch'){ badge = 'Rico'; tone = 'add'; name = e.text || ''; }
    else {
      const tfr = e.what === 'transfer';
      badge = practice && e.status === 'problem' ? t(tfr ? 'tfPracticeRun' : 'rrPracticeRun') : t((tfr ? 'tfStatus_' : 'rrStatus_') + e.status);
      tone = e.status === 'saved' || e.status === 'moved' ? 'add' : e.status === 'problem' && !practice ? 'delete' : 'edit';
      name = (e.supplier || '') + (e.invoice ? ' #' + e.invoice : '');
      if(e.status === 'problem' && !practice && e.text) line = e.text;
    }
    const meta = [when, who(e.by), e.kind === 'status' && e.mode ? t(practice ? 'rrModePractice' : 'rrModeReal') : '', e.source === 'telegram' ? 'Telegram' : ''].filter(Boolean).join(' · ');
    const isT = e.what === 'transfer';
    const open = e.receipt && (isT ? tf.data?.transfers?.some(r=>r.id === e.receipt) : rr.data?.receipts?.some(r=>r.id === e.receipt));
    return `<div class="rec-card rr-ev"${open ? ` role="button" tabindex="0" ${isT ? 'data-tf-open-from-record' : 'data-rr-open-from-record'}="${esc(e.receipt)}"` : ''}>
      <div class="rec-top"><span class="rec-badge rec-${tone}">${esc(badge)}</span><span class="rec-type">${esc(e.kind === 'status' ? t(isT ? 'rrEvTransfer' : 'rrEvReceipt') : 'Rico')}</span></div>
      <div class="rec-name" dir="auto">${esc(name)}</div>${line ? `<div class="rec-line">${esc(line)}</div>` : ''}
      <div class="rec-meta">${esc(meta)}</div></div>`;
  }).join('');
}


/* ---------- History > Receipts ----------
   Every receipt (not drafts), newest first by day, each with its details and its photos shown large
   in the middle of the card; a tap on a photo opens it full size. Orders stay in History > Orders. */
const rrPhotoLabel = k=> t('rrPhoto_' + k);
function rrHistPhotos(r){
  if(!r.photos.length) return '';
  const got = rr.photos[r.id];
  if(!got || got.count !== r.photos.length) rrLoadPhotos(r);
  const list = rr.photos[r.id]?.list || [];
  if(!list.length) return `<div class="rr-hist-photos" data-rr-photos="${esc(r.id)}">${loadingLines(1)}</div>`;
  return `<div class="rr-hist-photos" data-rr-photos="${esc(r.id)}">${list.map((p, i)=>`<figure><button type="button" class="rr-hist-photo" data-lb="${esc(r.id)}" data-lb-i="${i}" aria-label="${esc(rrPhotoLabel(p.kind))}"><img src="${esc(p.url)}" alt="${esc(rrPhotoLabel(p.kind))}" loading="lazy"></button><figcaption>${esc(rrPhotoLabel(p.kind))}</figcaption></figure>`).join('')}</div>`;
}
/* New photo links: History redraws just that receipt's photos; the receipt page redraws itself. */
function rrPaintPhotos(r){
  const box = document.querySelector(`[data-rr-photos="${CSS.escape(r.id)}"]`);
  if(box && state.view === 'history'){ const w = document.createElement('div'); w.innerHTML = rrHistPhotos(r); if(w.firstElementChild) box.replaceWith(w.firstElementChild); attachLightbox(); return; }
  if(state.view === 'receipts' && rr.page === 'view' && rr.id === r.id) render();
}
function rrHistCard(r){
  const when = formatIraqDateTime(new Date(r.sentAt || r.createdAt), {hour:'numeric', minute:'2-digit'});
  const tone = rrIsPractice(r) || r.status === 'cancelled' ? 'draft' : r.status === 'saved' ? 'ok' : r.status === 'problem' ? 'bad' : r.status === 'review' ? 'wait' : 'busy';
  const meta = [r.invoice ? '#' + r.invoice : '', rrSourceName(r), accountLabel(r.by), r.finance?.tab ? t('rrInInvoices')(r.finance.tab) : ''].filter(Boolean).join(' · ');
  const lines = r.lines.map(l=>`<li><span dir="auto">${esc(l.item)}</span><b>${esc(rrNum(l.qty, 3))} × <bdi>${esc(rrUnitShow(l.unit))}</bdi> · ${esc(rrMoney(l.cost, r.currency))}</b></li>`).join('');
  return `<article class="hist-card rr-hist" data-search-row data-search-text="${esc([r.supplier, r.invoice, ...r.lines.map(l=>l.item)].join(' '))}">
    <div class="hist-top"><div class="hist-date"><b>${esc(when)}</b><span class="rr-hist-state"><i class="rr-dot ${tone}" aria-hidden="true"></i>${esc(rrIsPractice(r) ? t('rrPracticeRun') : t('rrStatus_' + r.status))}</span></div>
      <span class="rr-hist-total">${esc(r.total == null ? '' : rrMoney(r.total, r.currency))}</span></div>
    <div class="rr-hist-name"><b dir="auto">${esc(r.supplier || '')}</b><small>${esc(meta)}</small></div>
    <ul class="rr-hist-lines">${lines}</ul>
    ${rrHistPhotos(r)}
    <div class="hist-actions"><button type="button" class="btn btn-ghost" data-rr-hist-open="${esc(r.id)}">${esc(t('rrOpenReceipt'))}</button></div>
  </article>`;
}
function renderReceiptHistory(){
  if(!rr.data){ if(!rr.loading && !rr.failed) rrLoad(); return rr.failed ? emptyState(t('loadFailed')) : loadingLines(3); }
  // Practice runs are not part of the record.
  const all = rr.data.receipts.filter(r=>r.status !== 'draft' && !rrIsPractice(r));
  if(!all.length) return emptyState(t('rrHistEmpty'));
  const list = rrFiltered(all).map(r=>({r, at:r.sentAt || r.createdAt})).sort((a, b)=>Date.parse(b.at) - Date.parse(a.at));
  let lastDay = '';
  const cards = list.map(({r, at})=>{ const day = dayLabel(at); const head = day !== lastDay ? `<div class="hist-day">${esc(day)}</div>` : ''; lastDay = day; return head + rrHistCard(r); }).join('');
  return rrFilterBar(all) + renderCatalogSearch() + (cards || emptyState(t('rrNoMatchFilter')));
}
function attachReceiptHistory(){
  attachRrFilters(); attachLightbox();
  document.querySelectorAll('[data-rr-hist-open]').forEach(b=>b.onclick = ()=>{ const id = b.dataset.rrHistOpen; goView('receipts'); rrOpen(id); });
}

/* A photo full size: dark backdrop, the photo in the middle at its full readable width (a long receipt
   scrolls), the receipt's other photos with the arrows; Escape, ✕ or a tap outside closes it. */
function attachLightbox(){
  document.querySelectorAll('[data-lb]').forEach(b=>b.onclick = ()=>openLightbox(b.dataset.lb, Number(b.dataset.lbI) || 0));
}
function openLightbox(id, at){
  const list = rr.photos[id]?.list || []; if(!list.length) return;
  document.getElementById('rrLightbox')?.remove();
  const box = document.createElement('div');
  box.id = 'rrLightbox'; box.className = 'rr-lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  const paint = ()=>{
    const p = list[at];
    box.innerHTML = `<div class="rr-lb-bar"><span>${esc(rrPhotoLabel(p.kind))}${list.length > 1 ? ' · ' + (at + 1) + ' / ' + list.length : ''}</span>
      <span class="rr-lb-acts">${list.length > 1 ? `<button type="button" data-lb-go="-1" aria-label="${esc(t('rrPrevPhoto'))}">‹</button><button type="button" data-lb-go="1" aria-label="${esc(t('rrNextPhoto'))}">›</button>` : ''}<button type="button" data-lb-close aria-label="${esc(t('rrClosePhoto'))}">✕</button></span></div>
      <div class="rr-lb-stage"><img src="${esc(p.url)}" alt="${esc(rrPhotoLabel(p.kind))}"></div>`;
    box.scrollTop = 0;
  };
  const close = ()=>{ box.remove(); document.removeEventListener('keydown', key, true); };
  const go = d=>{ at = (at + d + list.length) % list.length; paint(); };
  const key = e=>{ if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); } else if(e.key === 'ArrowRight') go(1); else if(e.key === 'ArrowLeft') go(-1); };
  box.addEventListener('click', e=>{
    if(e.target.closest('[data-lb-close]') || e.target === box || e.target.classList.contains('rr-lb-stage')) return close();
    const g = e.target.closest('[data-lb-go]'); if(g) go(Number(g.dataset.lbGo));
  });
  document.addEventListener('keydown', key, true);
  paint(); document.body.appendChild(box);
}
