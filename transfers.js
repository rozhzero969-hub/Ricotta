/* ============ Transfers ============
   Moving stock from one storage to another in Ricotta Restaurant, done by Rico from Rozha's Mac (like
   receipts, receipts.js). Three pages in one tab: the list, a transfer being written (laid out like
   Ricotta Restaurant's "Move stock between storages") and one that was sent (Rico's photo to approve,
   then moved). Storages, items and units are named exactly as there; the rules are shared with the API
   and Rico (RicottaTransfers). Stock is Ricotta Restaurant's, as Rico last read it, and Rico checks the
   live stock again on their page right before moving. */
const tf = {data:null, loading:false, page:'edit', id:null, formId:null, filter:{src:'all'}, saveTimer:0, sending:false, fresh:false, lastFrom:null, failed:false};
const TF = ()=> globalThis.RicottaTransfers;
const tfFind = id=> tf.data?.transfers.find(r=>r.id === id) || null;
const tfItem = name=> (tf.data?.catalog?.titems || []).find(i=>i.name === name) || null;
const tfQty = q=> rrNum(q, 3);
const tfAvailText = (item, zone)=>{ const c = TF().inCounting(item, TF().available(item, zone)); return t('tfAvailable')(tfQty(c.qty) + ' ' + c.unit, zone); };
/* The day a transfer counts on: today, or yesterday with Record for yesterday on. */
const tfDayLabel = day=> day ? formatIraqDateTime(new Date(day + 'T12:00:00+03:00'), {weekday:'short', day:'numeric', month:'short'}) : '';
const tfToday = ()=> tf.data?.today || erbilDate(new Date());
const tfYesterday = ()=>{ const d = new Date(tfToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

async function tfLoad(quiet = false){
  if(tf.loading) return;
  tf.loading = true;
  const r = await api('transfers', {quiet});
  tf.loading = false;
  if(r.ok && r.data && Array.isArray(r.data.transfers)){
    // A draft being typed keeps what is on the screen until it is saved.
    const editing = tfFind(tf.formId)?.status === 'draft' ? tfFind(tf.formId) : null;
    tf.data = r.data;
    if(editing && !tfFind(editing.id)) tf.data.transfers.unshift(editing);
    else if(editing) tf.data.transfers = tf.data.transfers.map(x=>x.id === editing.id ? editing : x);
    tf.failed = false;
  }
  else if(!tf.data) tf.failed = true;
  if((state.view === 'transfers' && !document.activeElement?.closest?.('.tf-edit')) || (state.view === 'history' && state.histMode === 'transfers' && !document.activeElement?.closest?.('.search-wrap'))) render();
}
const tfIsPractice = r=> r.status === 'problem' && (r.mode === 'practice' || /^Practice run/.test(r.problem || ''));
const tfTone = r=> tfIsPractice(r) || r.status === 'cancelled' || r.status === 'draft' ? 'draft' : r.status === 'moved' ? 'ok' : r.status === 'problem' ? 'bad' : r.status === 'review' ? 'wait' : 'busy';
const tfStatusText = r=> tfIsPractice(r) ? t('tfPracticeRun') : t('tfStatus_' + r.status);
function tfLine(r){
  const n = (r.lines || []).filter(l=>l.item).length;
  return [t('rrItemCount')(n), rrWhen(r.sentAt || r.createdAt), accountLabel(r.by), rrSourceName(r), r.yesterday ? t('tfForYesterday') : '',
    r.status === 'problem' ? r.problem || tfStatusText(r) : tfStatusText(r)].filter(Boolean).join(' · ');
}
const tfFiltered = list=> list.filter(r=>tf.filter.src === 'all' || (r.source === 'telegram' ? 'telegram' : 'app') === tf.filter.src);
const tfRoute = r=> `${r.from || t('tfNoFrom')} → ${r.to || t('tfNoTo')}`;

/* ---------- The tab: a new transfer straight away (like Ricotta Restaurant's Move between storages),
   Rico's switch above it, and what needs you, drafts and today's transfers below it. ---------- */
function renderTransfers(){
  if(tf.page === 'view') return renderTransferView();
  if(!tf.data){ if(!tf.loading && !tf.failed) tfLoad(); return tf.failed ? emptyState(t('loadFailed')) : loadingLines(4); }
  if(!tf.data.catalog?.titems?.length) return `<div class="rr-page">${rrRicoBar(tf.data.helper)}${emptyState(t('tfNoStock'))}${tfBelow()}</div>`;
  const cur = tfFind(tf.formId);
  if(cur && cur.status === 'draft'){ tf.id = cur.id; tf.page = 'edit'; } else tfNewDraft(null, false);
  return renderTransferEdit();
}
const tfRow = r=>`<button type="button" class="rr-row" data-tf-open="${esc(r.id)}"><i class="rr-dot ${tfTone(r)}" aria-hidden="true"></i>
  <span class="rr-row-main"><b dir="auto">${esc(tfRoute(r))}</b><small>${esc(tfLine(r))}</small></span></button>`;
function tfBelow(){
  const list = tf.data.transfers.filter(r=>!tfIsPractice(r)), shown = tfFiltered(list), today = tfToday();
  const isToday = r=> erbilDate(new Date(r.sentAt || r.createdAt)) === today;
  const needs = shown.filter(r=>r.status === 'review' || r.status === 'problem');
  const drafts = shown.filter(r=>r.status === 'draft' && r.id !== tf.id && !tfIsEmpty(r));
  const done = shown.filter(r=>!needs.includes(r) && r.status !== 'draft' && isToday(r));
  const moved = done.filter(r=>r.status === 'moved');
  return `<div class="rr-below">${tfFilterBar(list)}
    ${needs.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="rr-list rr-needs">${needs.map(tfRow).join('')}</div>` : ''}
    ${drafts.length ? `<div class="section-title">${esc(t('rrDrafts'))}</div><div class="rr-list">${drafts.map(tfRow).join('')}</div>` : ''}
    <div class="section-title rr-today-title"><span>${esc(t('rrToday'))}</span>${moved.length ? `<small>${esc(t('tfMovedToday')(moved.length))} · ${esc(t('tfItemsMoved')(moved.reduce((n, r)=>n + r.lines.length, 0)))}</small>` : ''}</div>
    ${done.length ? `<div class="rr-list">${done.map(tfRow).join('')}</div>` : `<p class="rr-none">${esc(t('tfNoneToday'))}</p>`}
    <button type="button" class="rr-to-history" data-to-history="transfers">${esc(t('rrSeeHistory'))}</button>
    ${tf.data.catalog?.at ? `<p class="rr-foot">${esc(t('tfStockAt')(formatIraqDateTime(new Date(tf.data.catalog.at), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})))}</p>` : `<p class="rr-foot">${esc(t('rrNoCatalog'))}</p>`}
  </div>`;
}
/* The filter (made in the app or on Telegram), for the tab and History > Transfers. */
function tfFilterBar(list){
  if(!list.length) return '';
  const fsel = `<select class="rr-filter" data-tf-filter="src" aria-label="${esc(t('rrFilter_src'))}">${[['all', t('rrAllPlaces')], ['app', t('rrSource_app')], ['telegram', t('rrSource_telegram')]].map(([v, l])=>`<option value="${v}"${tf.filter.src === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="rr-filters">${fsel}${tf.filter.src !== 'all' ? `<button type="button" class="rr-filter-clear" id="tfFilterClear">${esc(t('rrClearFilters'))}</button>` : ''}</div>`;
}
function attachTfFilters(){
  document.querySelectorAll('[data-tf-filter]').forEach(s=>s.onchange = ()=>{ tf.filter[s.dataset.tfFilter] = s.value; rrRepaintKeep(); });
  const fc = document.getElementById('tfFilterClear'); if(fc) fc.onclick = ()=>{ tf.filter = {src:'all'}; rrRepaintKeep(); };
}
function attachTransfersEvents(){
  if(tf.page === 'view') return attachTransferView();
  document.querySelectorAll('[data-tf-open]').forEach(b=>b.onclick = ()=>tfOpen(b.dataset.tfOpen));
  attachTfFilters();
  attachRicoBar();
  if(tf.page === 'edit' && tfFind(tf.id)) attachTransferEdit();
}
function tfOpen(id){
  const r = tfFind(id); if(!r) return;
  if(r.status === 'draft'){ tfDropBlankForm(r.id); tf.formId = id; }
  tf.id = id; tf.page = r.status === 'draft' ? 'edit' : 'view';
  render(); scrollBox().scrollTo({top:0});
}
/* Back from a sent transfer: to the form, with whatever was being typed in it. */
function tfBack(){ tf.page = 'edit'; tf.id = null; render(); scrollBox().scrollTo({top:0}); }
function tfDropBlankForm(keep){
  const f = tfFind(tf.formId);
  if(f && f.id !== keep && f.status === 'draft' && !f.version && tfIsEmpty(f)) tf.data.transfers = tf.data.transfers.filter(x=>x.id !== f.id);
}
function tfNewDraft(copyOf, draw = true){
  if(!tf.data?.catalog?.titems?.length){ if(draw) toast(t('tfNoStock'), 'error'); return; }
  tfDropBlankForm();
  const zones = TF().zonesOf(tf.data.catalog), src = copyOf || {};
  // From starts on Main Storage (or the storage of the last transfer sent); To is chosen each time.
  const from = src.from || (zones.includes(tf.lastFrom) ? tf.lastFrom : zones.includes('Main Storage') ? 'Main Storage' : '');
  const r = {id:crypto.randomUUID(), by:state.account, source:'app', status:'draft', from, to:src.to || '', yesterday:false,
    lines:(src.lines || []).map(l=>({...l})), warnings:[], log:[], photos:[], version:0, createdAt:new Date().toISOString()};
  if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null});
  tf.data.transfers.unshift(r);
  tf.id = tf.formId = r.id; tf.page = 'edit'; tf.fresh = true;
  if(draw){ render(); scrollBox().scrollTo({top:0}); }
}

/* ---------- Writing a transfer (like Ricotta Restaurant's page) ---------- */
function tfNeedByItem(r){
  const m = new Map();
  for(const l of r.lines){ const it = tfItem(l.item), o = it && TF().unitOptions(it).find(u=>u.name === l.unit); if(o && l.qty > 0) m.set(l.item, (m.get(l.item) || 0) + l.qty * o.factor); }
  return m;
}
function renderTransferEdit(){
  const r = tfFind(tf.id); if(!r){ tf.page = 'edit'; tf.formId = null; return renderTransfers(); }
  const cat = tf.data.catalog, need = tfNeedByItem(r);
  const opt = (v, label, on)=>`<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const ready = r.from && r.to;
  const lines = r.lines.map((l, i)=>{
    const item = tfItem(l.item), units = item ? TF().unitOptions(item) : [];
    const have = item ? TF().available(item, r.from) : 0, short = item && need.get(l.item) > have + 1e-9;
    return `<div class="rr-line tf-line${short ? ' warn' : ''}" data-line="${i}">
      <div class="rr-field rr-f-item"><label for="tfItem${i}">${esc(t('rrItem'))} ${i + 1}</label>${rrCombo('tfItem' + i, l.item, t('rrSearchItem'), `data-l-item="${i}"`)}</div>
      <div class="rr-field"><label for="tfQty${i}">${esc(t('tfAmount'))}</label><input id="tfQty${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${rrShowNum(l.qty)}" placeholder="${esc(t('tfAmountHint'))}"></div>
      <div class="rr-field rr-f-unit"><label for="tfUnit${i}">${esc(t('rrUnit'))}</label><select id="tfUnit${i}" data-l-unit="${i}" ${item ? '' : 'disabled'}>${units.length ? units.map(u=>opt(u.name, u.name + (u.unclear ? ' (?)' : ''), u.name === l.unit)).join('') : opt('', t('rrUnit'), true)}</select></div>
      <button type="button" class="rr-del" data-l-del="${i}" tabindex="-1" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button>
      ${item ? `<p class="tf-avail${short ? ' short' : ''}">${esc(short ? t('tfNotEnough')(tfQty(TF().inCounting(item, have).qty) + ' ' + TF().inCounting(item, have).unit, r.from) : tfAvailText(item, r.from))}</p>` : ''}
    </div>`;
  }).join('');
  return `<div class="rr-page rr-edit tf-edit">${rrRicoBar(tf.data.helper)}
    <section class="rr-card"><h2 class="rr-card-title">${esc(t('tfStorages'))}</h2>
      <div class="tf-zones">
        <div class="rr-field"><label for="tfFrom">${esc(t('tfFrom'))}</label>${rrCombo('tfFrom', r.from, t('tfChoose'))}</div>
        <span class="tf-arrow" aria-hidden="true">→</span>
        <div class="rr-field"><label for="tfTo">${esc(t('tfTo'))}</label>${rrCombo('tfTo', r.to, t('tfChoose'))}</div>
      </div></section>
    <section class="rr-card"><h2 class="rr-card-title"><span>${esc(t('tfWhat'))}</span><span class="rr-count">${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</span></h2>
      ${!r.from ? `<p class="tf-empty">${esc(t('tfPickFrom'))}</p>` : !r.to ? `<p class="tf-empty">${esc(t('tfPickTo'))}</p>` : `<div class="rr-lines">${lines}</div>
      <div class="tf-adds"><button type="button" class="rr-add" id="tfAdd">${ICON_PLUS}<span>${esc(t('rrAddItem'))}</span></button><button type="button" class="tf-addn" data-add="5">+5</button><button type="button" class="tf-addn" data-add="10">+10</button></div>
      <p class="rr-keys">${esc(t('rrKeysHint')(RR_MOD))}</p>`}
    </section>
    <button type="button" class="tf-yest${r.yesterday ? ' on' : ''}" id="tfYest" role="switch" aria-checked="${r.yesterday}">
      <span><b>${esc(t('tfYesterday'))}</b><small>${esc(r.yesterday ? t('tfYesterdayOn')(tfDayLabel(tfYesterday())) : t('tfYesterdayHint'))}</small></span><i aria-hidden="true"></i></button>
    <div class="rr-sum">
      <div class="rr-sum-total"><span>${esc(t('tfItemsLabel'))}:</span> <b>${r.lines.filter(l=>l.item).length}</b><small>${esc(ready ? `${r.from} → ${r.to}` : '')}</small></div>
      <div class="rr-sum-acts"><button type="button" class="rr-cancel" id="tfDiscard">${esc(t('cancel'))}</button>
        <button type="button" class="btn btn-primary" id="tfSend" ${ready ? '' : 'disabled'}>${ICON_CHECK}<span>${esc(t('tfSend'))}</span></button></div>
    </div>
    ${tfBelow()}
  </div>`;
}
const tfIsEmpty = r=> !r.to && !r.yesterday && !r.lines.some(l=>l.item || l.qty);
function tfSaveSoon(r){ clearTimeout(tf.saveTimer); tf.saveTimer = setTimeout(()=>tfSaveDraft(r), 600); }
async function tfSaveDraft(r){
  clearTimeout(tf.saveTimer);
  const body = {from:r.from || null, to:r.to || null, yesterday:!!r.yesterday,
    lines:r.lines.filter(l=>l.item).map(l=>({item:l.item, unit:l.unit, qty:Number.isFinite(l.qty) ? l.qty : null}))};
  const res = await api('transfers/' + r.id, {method:'PUT', body});
  if(res.ok && res.data?.id) r.version = res.data.version;
  return res.ok;
}
function attachTransferEdit(){
  const r = tfFind(tf.id); if(!r) return;
  const cat = tf.data.catalog, zones = TF().zonesOf(cat);
  const repaint = ()=>{ const top = scrollBox().scrollTop; render(); scrollBox().scrollTop = top; };
  const changed = (redraw = false)=>{ tfSaveSoon(r); if(redraw) repaint(); };
  const go = id=>{ const el = document.getElementById(id); if(!el) return; el.focus({preventScroll:true}); el.scrollIntoView({block:'nearest'}); el.select?.(); };
  const enter = (el, fn)=>{ if(el) el.addEventListener('keydown', e=>{ if(e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.isComposing){ e.preventDefault(); fn(); } }); };
  // From, then To (never the same storage), then the first item.
  rrComboBind(document.getElementById('tfFrom'), zones, (v, again)=>{
    if(!again && v !== r.from){ r.from = v; if(r.to === v) r.to = ''; changed(true); }
    go(r.to ? 'tfItem0' : 'tfTo');
  });
  const toInput = document.getElementById('tfTo');
  if(toInput) rrComboBind(toInput, zones.filter(z=>z !== r.from), (v, again)=>{
    if(!again && v !== r.to){ r.to = v; changed(true); }
    go('tfItem' + Math.max(0, r.lines.findIndex(l=>!l.item)));
  });
  // Items: only what the From storage has, with how much it has.
  const names = r.from ? TF().itemsIn(cat, r.from).map(i=>i.name).sort((a, b)=>a.localeCompare(b)) : [];
  const stockOf = n=>{ const it = tfItem(n); if(!it) return ''; const c = TF().inCounting(it, TF().available(it, r.from)); return tfQty(c.qty) + ' ' + c.unit; };
  document.querySelectorAll('[data-l-item]').forEach(inp=>{
    const i = +inp.dataset.lItem;
    rrComboBind(inp, names, (v, again)=>{
      const l = r.lines[i];
      if(!again && v !== l.item){
        l.item = v;
        // The unit Ricotta Restaurant counts it in (what "available" is shown in); a click changes it.
        const units = TF().unitOptions(tfItem(v)); l.unit = units.length ? units[0].name : '';
        changed(true);
      }
      go('tfQty' + i);
    }, stockOf);
  });
  document.querySelectorAll('[data-l-unit]').forEach(s=>s.onchange = ()=>{ const i = +s.dataset.lUnit; r.lines[i].unit = s.value; changed(true); go('tfQty' + i); });
  const addLine = (n = 1)=>{ for(let k = 0; k < n; k++) r.lines.push({item:'', unit:'', qty:null}); repaint(); go('tfItem' + (r.lines.length - n)); };
  // Item and amount filled on the last line: the next empty line appears by itself.
  const autoLine = el=>{
    const last = r.lines[r.lines.length - 1];
    if(!(last.item && last.qty > 0)) return;
    const id = el.id, at = el.selectionStart;
    r.lines.push({item:'', unit:'', qty:null}); repaint();
    const again = document.getElementById(id); if(again){ again.focus({preventScroll:true}); try{ again.setSelectionRange(at, at); }catch(_){} }
  };
  document.querySelectorAll('[data-l-qty]').forEach(el=>{
    const i = +el.dataset.lQty;
    el.oninput = ()=>{ r.lines[i].qty = rrOnlyNum(el, true, true); tfSaveSoon(r); tfPaintStock(r); autoLine(el); };
    enter(el, ()=>{ tfSaveSoon(r); if(i < r.lines.length - 1) go('tfItem' + (i + 1)); else addLine(); });
  });
  document.querySelectorAll('[data-l-del]').forEach(b=>b.onclick = ()=>{ r.lines.splice(+b.dataset.lDel, 1); if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null}); changed(true); });
  document.getElementById('tfAdd')?.addEventListener('click', ()=>addLine());
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick = ()=>addLine(+b.dataset.add));
  // Record for yesterday asks first, every time it is turned on.
  document.getElementById('tfYest').onclick = async ()=>{
    if(!r.yesterday && !await showConfirm(esc(t('tfYesterdayAsk')(tfDayLabel(tfYesterday()))), {title:t('tfYesterday'), okLabel:t('tfYesterdayYes'), okClass:'btn-primary'})) return;
    r.yesterday = !r.yesterday; changed(true);
  };
  document.getElementById('tfDiscard').onclick = async ()=>{
    if(!tfIsEmpty(r) && !await showConfirm(esc(t('tfDiscardAsk')), {okLabel:t('rrDiscard')})) return;
    clearTimeout(tf.saveTimer);
    if(r.version) await api('transfers/' + r.id, {method:'DELETE'});
    tf.data.transfers = tf.data.transfers.filter(x=>x.id !== r.id);
    tfNewDraft({from:r.from});
  };
  document.getElementById('tfSend').onclick = ()=>tfSend(r);
  document.onkeydown = e=>{
    if(state.view !== 'transfers' || tf.page !== 'edit'){ document.onkeydown = null; return; }
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); document.activeElement?.blur?.(); tfSend(r); }
  };
  if(tf.fresh){ tf.fresh = false; if(!matchMedia('(pointer: coarse)').matches) requestAnimationFrame(()=>go(r.from ? 'tfTo' : 'tfFrom')); }
}
/* While an amount is typed, only the "available" lines change (the box keeps its focus). */
function tfPaintStock(r){
  const need = tfNeedByItem(r);
  r.lines.forEach((l, i)=>{
    const p = document.querySelector(`[data-line="${i}"] .tf-avail`), item = tfItem(l.item); if(!p || !item) return;
    const have = TF().available(item, r.from), short = need.get(l.item) > have + 1e-9, c = TF().inCounting(item, have);
    p.classList.toggle('short', short); p.closest('.tf-line')?.classList.toggle('warn', short);
    const first = r.lines.findIndex(x=>x.item === l.item), again = first > -1 && first < i ? ' · ' + t('rrWarnDuplicate')(first + 1) : '';
    p.textContent = (short ? t('tfNotEnough')(tfQty(c.qty) + ' ' + c.unit, r.from) : tfAvailText(item, r.from)) + again;
  });
}
const TF_ERR = {from:'tfErrFrom', fromUnknown:'tfErrFrom', to:'tfErrTo', toUnknown:'tfErrTo', sameZone:'tfErrSame', noLines:'rrErrNoLines', tooManyLines:'rrErrNoLines',
  itemUnknown:'tfErrItem', unitUnknown:'rrErrUnit', unitUnclear:'tfErrUnitUnclear', qty:'tfErrQty'};
function tfErrText(e){
  if(e.code === 'notEnough') return t('rrLineN')(e.line) + ': ' + t('tfErrNotEnough')(tfQty(e.need.qty) + ' ' + e.need.unit, tfQty(e.have.qty) + ' ' + e.have.unit);
  const s = t(TF_ERR[e.code] || 'tfErrItem'); return e.line ? t('rrLineN')(e.line) + ': ' + s : s;
}
function tfWarnText(w){
  if(w.code === 'pressed') return t('tfWarnPressed');
  if(w.code === 'repeat') return t('tfWarnRepeat')(rrWhen(w.at));
  if(w.code === 'duplicate') return t('rrLineN')(w.line) + ': ' + t('rrWarnDuplicate')(w.first);
  if(w.code === 'allStock') return t('rrLineN')(w.line) + ': ' + t('tfWarnAll')(tfQty(w.have.qty) + ' ' + w.have.unit);
  if(w.code === 'unusual') return t('rrLineN')(w.line) + ': ' + t('tfWarnUnusual')(rrNum(w.times, 1));
  if(w.code === 'yesterday') return t('tfYesterdayOn')(tfDayLabel(tfYesterday()));
  return '';
}
async function tfSend(r){
  if(tf.sending) return;
  r.lines = r.lines.filter(l=>l.item || l.qty);
  const c = TF().check({from:r.from, to:r.to, yesterday:r.yesterday, lines:r.lines}, tf.data.catalog, tf.data.usual);
  if(c.errors.length){
    if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null});
    render();
    await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(tfErrText(e))}</li>`).join('')}</ul>`, {title:t('rrFixFirst')});
    return;
  }
  // Record for yesterday was confirmed when it was turned on; everything else is read and confirmed here.
  const ask = c.warnings.filter(w=>w.code !== 'yesterday');
  if(ask.length && !await showConfirm(`<ul class="rr-errs">${ask.map(w=>`<li>${esc(tfWarnText(w))}</li>`).join('')}</ul>`, {title:t('rrCheckThese'), okLabel:t('rrSendAnyway'), okClass:'btn-primary'})) return;
  tf.sending = true;
  try{
    if(!await tfSaveDraft(r)){ toast(t('saveFailed'), 'error'); return; }
    const res = await tfPost(r, c.warnings.map(w=>w.code));
    if(!res) return;
    if(!res.ok){ toast(res.data?.errors ? res.data.errors.map(tfErrText).join(' · ') : t('saveFailed'), 'error'); return; }
    Object.assign(r, res.data);
    tf.lastFrom = r.from;
    toast(t('rrSent'));
    tfNewDraft();   // like Ricotta Restaurant: the form clears, From stays
  } finally { tf.sending = false; }
}

/* Sends to Rico. The server may ask about more than the app knows (Rico already pressed Move it for this
   one, or the same transfer was already sent): those are shown and confirmed before it goes. */
async function tfPost(r, codes){
  codes = [...new Set(codes)];
  let res = await api(`transfers/${r.id}/send`, {method:'POST', body:{confirm:codes}});
  if(!res.ok && res.data?.error === 'needs_confirmation'){
    const more = (res.data.warnings || []).filter(w=>!codes.includes(w.code));
    if(!more.length) return res;
    if(!await showConfirm(`<ul class="rr-errs">${more.map(w=>`<li>${esc(tfWarnText(w))}</li>`).join('')}</ul>`, {title:t('rrSureTitle'), okLabel:t('rrSendAnyway'), okClass:'btn-danger'})) return null;
    res = await api(`transfers/${r.id}/send`, {method:'POST', body:{confirm:[...codes, ...more.map(w=>w.code)]}});
  }
  return res;
}

/* ---------- A sent transfer ---------- */
async function tfLoadPhotos(r){
  rr.photos[r.id] = {count:r.photos.length, list:rr.photos[r.id]?.list || []};
  const res = await api(`transfers/${r.id}/photos`, {quiet:true});
  if(res.ok && Array.isArray(res.data?.photos)){ rr.photos[r.id].list = res.data.photos; if(state.view === 'transfers' && tf.page === 'view' && tf.id === r.id) render(); else tfPaintPhotos(r); }
}
function tfPhotos(r){
  if(!r.photos.length) return '';
  const got = rr.photos[r.id];
  if(!got || got.count !== r.photos.length) tfLoadPhotos(r);
  const list = rr.photos[r.id]?.list || [];
  if(!list.length) return `<div class="rr-hist-photos" data-tf-photos="${esc(r.id)}">${loadingLines(1)}</div>`;
  return `<div class="rr-hist-photos" data-tf-photos="${esc(r.id)}">${list.map((p, i)=>`<figure><button type="button" class="rr-hist-photo" data-lb="${esc(r.id)}" data-lb-i="${i}" aria-label="${esc(t('tfPhoto_' + p.kind))}"><img src="${esc(p.url)}" alt="${esc(t('tfPhoto_' + p.kind))}" loading="lazy"></button><figcaption>${esc(t('tfPhoto_' + p.kind))}</figcaption></figure>`).join('')}</div>`;
}
function tfPaintPhotos(r){
  const box = document.querySelector(`[data-tf-photos="${CSS.escape(r.id)}"]`);
  if(box){ const w = document.createElement('div'); w.innerHTML = tfPhotos(r); if(w.firstElementChild) box.replaceWith(w.firstElementChild); attachLightbox(); }
}
function tfLinesList(r){
  return `<ol class="rr-view-lines">${r.lines.map((l, i)=>`<li><span class="rr-num">${i + 1}</span><span><b dir="auto">${esc(l.item)}</b></span><b>${esc(tfQty(l.qty))} <bdi>${esc(l.unit)}</bdi></b></li>`).join('')}</ol>`;
}
function renderTransferView(){
  const r = tfFind(tf.id); if(!r){ tf.page = 'edit'; return renderTransfers(); }
  const head = r.status === 'moved'
    ? `<div class="rr-done"><span class="rr-done-tag">${ICON_CHECK}${esc(t('tfStatus_moved'))}</span><b dir="auto">${esc(tfRoute(r))}</b><small>${esc(r.result && r.result.checked === false ? t('tfNotConfirmed') : t('tfSeenRecent'))}</small></div>`
    : `<div class="rr-state ${tfIsPractice(r) ? 'practice' : r.status}">${rrRico()}<div><b>${esc(tfStatusText(r))}</b><small>${esc(r.status === 'problem' ? r.problem || '' : t('tfStatusHint_' + r.status))}</small></div></div>`;
  const facts = [[t('tfFrom'), r.from], [t('tfTo'), r.to], [t('tfDay'), tfDayLabel(r.forDay) + (r.yesterday ? ' · ' + t('tfForYesterday') : '')],
    [t('rrMadeIn'), rrSourceName(r) + (accountLabel(r.by) ? ' · ' + accountLabel(r.by) : '')], [t('rrMadeAt'), rrWhen(r.createdAt)],
    ...(r.mode ? [[t('rrRicoMode'), t(r.mode === 'practice' ? 'rrModePracticeLong' : 'rrModeReal')]] : []),
    ...(r.sentAt ? [[t('rrSentAt'), rrWhen(r.sentAt)]] : []), ...(r.approvedAt ? [[t('rrApprovedAt'), rrWhen(r.approvedAt) + (accountLabel(r.approvedBy) ? ' · ' + accountLabel(r.approvedBy) : '')]] : []),
    ...(r.movedAt ? [[t('tfMovedAt'), rrWhen(r.movedAt)]] : [])];
  return `<div class="rr-page">${rrBackBar(t('tfTitleOne'))}
    ${head}
    ${r.photos.length ? `<div class="section-title">${esc(t('rrPhotos'))}</div>${tfPhotos(r)}` : ''}
    ${(r.warnings || []).filter(w=>w.code !== 'yesterday').length && r.status === 'review' ? `<div class="rr-card rr-warns">${r.warnings.filter(w=>w.code !== 'yesterday').map(w=>`<p>${esc(tfWarnText(w))}</p>`).join('')}</div>` : ''}
    <div class="section-title">${esc(t('rrItemCount')(r.lines.length))}</div>
    <div class="rr-card"><dl class="rr-facts">${facts.map(([a, b])=>`<dt>${esc(a)}</dt><dd dir="auto">${esc(b || '')}</dd>`).join('')}</dl>${tfLinesList(r)}</div>
    ${r.log?.length ? `<div class="section-title">${esc(t('rrWhatRicoDid'))}</div><div class="rr-card rr-log">${r.log.slice(-20).map(e=>`<p><time>${esc(formatIraqDateTime(new Date(e.at), {hour:'numeric', minute:'2-digit'}))}</time><span>${esc(e.text)}</span></p>`).join('')}</div>` : ''}
    <div class="rr-view-actions">
      ${r.status === 'review' ? `<button type="button" class="btn btn-ghost" id="tfCancel">${esc(t('tfCancelOne'))}</button><button type="button" class="btn btn-primary" id="tfApprove">${esc(t('tfApprove'))}</button>` : ''}
      ${['queued','problem'].includes(r.status) ? `<button type="button" class="btn btn-ghost" id="tfCancel">${esc(t('tfCancelOne'))}</button>` : ''}
      ${['problem','cancelled','moved'].includes(r.status) ? `<button type="button" class="btn btn-ghost" id="tfCopy">${esc(t('rrCopy'))}</button>` : ''}
      ${r.status === 'problem' && !tfIsPractice(r) ? `<button type="button" class="btn btn-primary" id="tfRetry">${esc(t('rrRetry'))}</button>` : ''}
    </div>
  </div>`;
}
function attachTransferView(){
  const r = tfFind(tf.id); if(!r) return;
  document.getElementById('rrBack').onclick = tfBack;
  const act = async (action, ask)=>{
    if(ask && !await showConfirm(esc(ask).replace(/\n/g, '<br>'), {okLabel:action === 'approve' ? t('tfApprove') : t('tfCancelOne'), okClass:action === 'approve' ? 'btn-primary' : 'btn-danger'})) return;
    const res = await api(`transfers/${r.id}/${action}`, {method:'POST', body:{}});
    if(!res.ok){ toast(res.data?.error === 'too_late' ? t('tfTooLate') : t('saveFailed'), 'error'); tfLoad(true); return; }
    Object.assign(r, res.data); render();
  };
  // Approving always shows what will move (and anything unusual) once more.
  const ws = (r.warnings || []).filter(w=>w.code !== 'yesterday').map(tfWarnText).filter(Boolean);
  const ask = t('tfApproveAsk')(tfRoute(r), r.lines.length) + (r.yesterday ? '\n' + t('tfYesterdayOn')(tfDayLabel(r.forDay)) : '') + (ws.length ? '\n• ' + ws.join('\n• ') : '');
  const ap = document.getElementById('tfApprove'); if(ap) ap.onclick = ()=>act('approve', ask);
  const cn = document.getElementById('tfCancel'); if(cn) cn.onclick = ()=>act('cancel', t('tfCancelAsk'));
  const cp = document.getElementById('tfCopy'); if(cp) cp.onclick = ()=>tfNewDraft(r);
  const rt = document.getElementById('tfRetry'); if(rt) rt.onclick = ()=>tfRetry(r);
  attachLightbox();
}
/* Retry: the same transfer to Rico again, checked against the stock as Rico last read it. If it had
   been approved, Rico may already have pressed Move it, so Recent transfers is to be checked first. */
async function tfRetry(r){
  const c = TF().check({from:r.from, to:r.to, yesterday:r.yesterday, lines:r.lines}, tf.data.catalog, tf.data.usual);
  if(c.errors.length){ await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(tfErrText(e))}</li>`).join('')}</ul><p>${esc(t('rrRetryCopy'))}</p>`, {title:t('rrFixFirst')}); return; }
  const ws = c.warnings.map(tfWarnText).filter(Boolean);
  const msg = (r.pressedAt || r.approvedAt ? `<p><b>${esc(t('tfRetryCheckFirst'))}</b></p>` : '') + `<p>${esc(t('tfApproveAsk')(tfRoute(r), r.lines.length))}</p>` + (ws.length ? `<ul class="rr-errs">${ws.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>` : '');
  if(!await showConfirm(msg, {title:t('rrRetry'), okLabel:t('rrRetry'), okClass:'btn-primary'})) return;
  const res = await tfPost(r, c.warnings.map(w=>w.code));
  if(!res) return;
  if(!res.ok){ toast(res.data?.errors ? res.data.errors.map(tfErrText).join(' · ') : t('saveFailed'), 'error'); tfLoad(true); return; }
  Object.assign(r, res.data); toast(t('rrSent')); render();
}

/* ---------- History > Transfers ----------
   Every transfer (not drafts), newest first by the day it counts on, each with its items and photos;
   each day can be saved as a PDF or an Excel file. */
function renderTransferHistory(){
  if(!tf.data){ if(!tf.loading && !tf.failed) tfLoad(); return tf.failed ? emptyState(t('loadFailed')) : loadingLines(3); }
  // Practice runs are not part of the record.
  const every = tf.data.transfers.filter(r=>r.status !== 'draft' && !tfIsPractice(r));
  if(!every.length) return emptyState(t('tfHistEmpty'));
  const all = tfFiltered(every);
  if(!all.length) return tfFilterBar(every) + emptyState(t('rrNoMatchFilter'));
  const dayOf = r=> r.forDay || erbilDate(new Date(r.sentAt || r.createdAt));
  const days = [...new Set(all.map(dayOf))].sort().reverse();
  return tfFilterBar(every) + renderCatalogSearch() + days.map(day=>{
    const list = all.filter(r=>dayOf(r) === day).sort((a, b)=>Date.parse(b.sentAt || b.createdAt) - Date.parse(a.sentAt || a.createdAt));
    const moved = list.filter(r=>r.status === 'moved');
    return `<div class="hist-day tf-day"><span>${esc(dayLabel(day + 'T12:00:00+03:00'))}</span>${moved.length ? `<span class="tf-export"><button type="button" data-tf-export="${day}" data-format="pdf">PDF</button><button type="button" data-tf-export="${day}" data-format="excel">Excel</button></span>` : ''}</div>`
      + list.map(r=>`<article class="hist-card rr-hist" data-search-row data-search-text="${esc([r.from, r.to, ...r.lines.map(l=>l.item)].join(' '))}">
        <div class="hist-top"><div class="hist-date"><b>${esc(formatIraqDateTime(new Date(r.sentAt || r.createdAt), {hour:'numeric', minute:'2-digit'}))}</b><span class="rr-hist-state"><i class="rr-dot ${tfTone(r)}" aria-hidden="true"></i>${esc(tfStatusText(r))}</span></div>
          <span class="rr-hist-total">${esc(t('rrItemCount')(r.lines.length))}</span></div>
        <div class="rr-hist-name"><b dir="auto">${esc(tfRoute(r))}</b><small>${esc([rrSourceName(r), accountLabel(r.by), r.yesterday ? t('tfForYesterday') : ''].filter(Boolean).join(' · '))}</small></div>
        <ol class="rr-hist-lines tf-num">${r.lines.map((l, i)=>`<li><span dir="auto"><i>${i + 1}</i> ${esc(l.item)}</span><b>${esc(tfQty(l.qty))} <bdi>${esc(l.unit)}</bdi></b></li>`).join('')}</ol>
        ${tfPhotos(r)}
        <div class="hist-actions"><button type="button" class="btn btn-ghost" data-tf-hist-open="${esc(r.id)}">${esc(t('tfOpenOne'))}</button></div>
      </article>`).join('');
  }).join('');
}
function attachTransferHistory(){
  attachTfFilters(); attachLightbox();
  document.querySelectorAll('[data-tf-hist-open]').forEach(b=>b.onclick = ()=>{ const id = b.dataset.tfHistOpen; goView('transfers'); tfOpen(id); });
  document.querySelectorAll('[data-tf-export]').forEach(b=>b.onclick = ()=>withBusy(b, ()=>tfExportDay(b.dataset.tfExport, b.dataset.format)));
}
/* One day's moved transfers as a file: every transfer with its numbered items. */
async function tfExportDay(day, format){
  const list = tf.data.transfers.filter(r=>r.status === 'moved' && (r.forDay || erbilDate(new Date(r.sentAt || r.createdAt))) === day)
    .sort((a, b)=>Date.parse(a.movedAt || a.sentAt) - Date.parse(b.movedAt || b.sentAt));
  const at = new Date(), title = t('tfFileTitle')(tfDayLabel(day)), subtitle = t('tfFileSub')(list.length, list.reduce((n, r)=>n + r.lines.length, 0), fileStamp(at));
  if(format === 'excel'){
    const rows = list.flatMap(r=>r.lines.map((l, i)=>[day, formatIraqDateTime(new Date(r.movedAt || r.sentAt), {hour:'2-digit', minute:'2-digit', hour12:false}), r.from, r.to, i + 1, l.item, Number(l.qty), l.unit, accountLabel(r.approvedBy) || '', r.yesterday ? t('tfForYesterday') : '']));
    return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[{name:t('tfTitle'), columns:[
      {label:t('fileDate'), width:12}, {label:t('fileTime'), width:8}, {label:t('tfFrom'), width:18}, {label:t('tfTo'), width:18}, {label:'#', width:5, type:'number'},
      {label:t('fileItem'), width:34}, {label:t('fileQty'), width:10, type:'number'}, {label:t('unit'), width:10}, {label:t('rrApprovedAt'), width:12}, {label:t('tfDay'), width:14}], rows}]}),
      `${t('tfFileName')} ${day}`);
  }
  return deliverPdf({title, subtitle, stamp:fileStamp(at), info:[[t('tfTitle'), String(list.length)], [t('tfItemsLabel'), String(list.reduce((n, r)=>n + r.lines.length, 0))]],
    sections:list.map(r=>({heading:`${tfRoute(r)} · ${formatIraqDateTime(new Date(r.movedAt || r.sentAt), {hour:'numeric', minute:'2-digit'})}${r.yesterday ? ' · ' + t('tfForYesterday') : ''}`,
      columns:[{label:'#', w:8}, {label:t('fileItem'), w:62, bold:true}, {label:t('fileQty'), w:14, align:'end'}, {label:t('unit'), w:16}],
      rows:r.lines.map((l, i)=>[String(i + 1), l.item, tfQty(l.qty), l.unit])}))}, `${t('tfFileName')} ${day}`);
}
