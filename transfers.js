/* ============ Transfers ============
   Moving stock from one storage to another in Ricotta Restaurant, done by Rico from Rozh's Mac (like
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
/* "Available: 9 سیت in Main Storage", the amount in bold in a small box (red when there isn't enough). */
function tfAvailHtml(item, zone, short, unit){
  const have = TF().available(item, zone), o = TF().unitOptions(item).find(u=>u.name === unit);
  const c = o ? {qty:Math.floor((have / o.factor) * 1000 + 1e-6) / 1000, unit:o.name} : TF().inCounting(item, have, true);
  return `<span class="tf-have${short ? ' short' : ''}">${esc(short ? t('tfOnlyHave') : t('tfAvailLabel'))} <b dir="ltr">${esc(tfQty(c.qty))} <bdi>${esc(c.unit)}</bdi></b> ${esc(t('tfInZone')(zone))}</span>`;
}
/* The day a transfer counts on: today, or yesterday with Record for yesterday on. */
const tfDayLabel = day=> day ? formatIraqDateTime(new Date(day + 'T12:00:00+03:00'), {weekday:'short', day:'numeric', month:'short'}) : '';
const tfToday = ()=> erbilDate(new Date());   // Erbil's day now (a copy kept offline may be from an earlier day)
const tfDayBefore = day=>{ const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const tfYesterday = ()=> tfDayBefore(tfToday());

async function tfLoad(quiet = false){
  // Asked again while one is on its way: read once more after it (see rrLoad).
  if(tf.loading){ tf.loadAgain = true; return; }
  tf.loading = true;
  const r = await api('transfers', {quiet});
  tf.loading = false;
  if(tf.loadAgain){ tf.loadAgain = false; setTimeout(()=>tfLoad(true), 0); }
  if(r.ok && r.data && Array.isArray(r.data.transfers)){
    // A draft being typed keeps what is on the screen until it is saved.
    const editing = tfFind(tf.formId)?.status === 'draft' ? tfFind(tf.formId) : null;
    const mine = tf.data?.transfers || [];
    tf.data = r.data;
    tf.data.transfers = rrNewest(mine, tf.data.transfers);
    if(editing && !tfFind(editing.id)) tf.data.transfers.unshift(editing);
    // Sent or cancelled elsewhere: the server's copy shows (saving over it would only fail).
    else if(editing) tf.data.transfers = tf.data.transfers.map(x=>x.id === editing.id && x.status === 'draft' ? editing : x);
    tf.failed = false; tf.copyAt = null;
    rrKeepCopy('tf', tf.data);
    rrMergeDrafts('tf', tf.data.transfers).forEach(d=>tfSaveDraft(d));
  }
  else if(!tf.data){
    // No connection: the copy kept on this device (stock as Rico last read it), with this device's drafts.
    const c = rrCopyOf('tf');
    if(c){ tf.data = c.data; tf.copyAt = c.at; rrMergeDrafts('tf', tf.data.transfers); } else tf.failed = true;
  }
  if((state.view === 'transfers' && !document.activeElement?.closest?.('.tf-edit')) || (state.view === 'history' && ['transfers', 'days'].includes(state.histMode) && !document.activeElement?.closest?.('.search-wrap'))) render();
}
addEventListener('online', async ()=>{ if(!tf.data) return; await tfLoad(true); if(state.view === 'transfers' && tf.page === 'edit') rrRepaintKeepFocus(); });
addEventListener('offline', ()=>{ if(state.view === 'transfers' && tf.page === 'edit') rrRepaintKeepFocus(); });
const tfKeep = ()=> tf.data && rrKeepDrafts('tf', tf.data.transfers, tfIsEmpty);
const tfIsPractice = r=> r.status === 'problem' && (r.mode === 'practice' || /^Practice run/.test(r.problem || ''));
const tfStatusText = r=> tfIsPractice(r) ? t('tfPracticeRun') : r.pendingSend && r.status === 'draft' ? t('rrWaitingToSend') : t('tfStatus_' + r.status);
function tfLine(r){
  const n = (r.lines || []).filter(l=>l.item).length;
  return [t('rrItemCount')(n), rrWhen(r.sentAt || r.createdAt), accountLabel(r.by), rrSourceName(r), r.yesterday ? t('tfForYesterday') : '', r.auto ? t('tfNoSecond') : '',
    r.status === 'problem' ? r.problem || '' : ''].filter(Boolean).join(' · ');
}
const tfFiltered = list=> list.filter(r=>tf.filter.src === 'all' || (r.source === 'telegram' ? 'telegram' : 'app') === tf.filter.src);
/* Under each line: what the To storage usually gets of this item, or that it never gets it. */
function tfUsualNote(item, r){
  if(!item || !r.from || !r.to || !TF().usualFor) return '';
  const u = TF().usualFor(tf.data?.catalog, item.name, r.from, r.to);
  if(u.never) return ` <span class="tf-never">· ${esc(t('tfNeverTo')(r.to))}</span>`;
  if(!u.stat) return '';
  const c = TF().inCounting(item, u.stat.q);
  return ` <span class="tf-usual">· ${esc(t('tfUsuallyGets')(r.to, tfQty(c.qty) + ' ' + c.unit))}</span>`;
}
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
const tfRow = r=>`<button type="button" class="rr-row${r.status === 'cancelled' ? ' is-off' : ''}" data-tf-open="${esc(r.id)}">
  <span class="rr-row-main"><b dir="auto">${esc(tfRoute(r))}</b><small>${esc(tfLine(r))}</small></span>${r.status === 'draft' && !r.pendingSend ? '' : stChip(r, tfStatusText(r))}</button>`;
function tfBelow(){
  const list = tf.data.transfers.filter(r=>!tfIsPractice(r)), shown = tfFiltered(list), today = tfToday();
  const isToday = r=> erbilDate(new Date(r.sentAt || r.createdAt)) === today;
  const needs = shown.filter(r=>r.status === 'review' || r.status === 'problem');
  const waiting = list.filter(r=>r.status === 'draft' && r.pendingSend && r.id !== tf.id);
  const drafts = shown.filter(r=>r.status === 'draft' && !r.pendingSend && r.id !== tf.id && !tfIsEmpty(r));
  const done = shown.filter(r=>!needs.includes(r) && r.status !== 'draft' && isToday(r));
  const moved = done.filter(r=>r.status === 'moved');
  return `<div class="rr-below">${rrWaitingHtml(waiting, tfRow, 'tf')}${tfFilterBar(list)}
    ${needs.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="rr-list rr-needs">${needs.map(tfRow).join('')}</div>` : ''}
    ${drafts.length ? `<div class="section-title rr-today-title"><span>${esc(t('rrDrafts'))}</span>${drafts.length > 1 && !rrOffline() ? `<button type="button" class="rr-send-all" data-tf-senddrafts>${esc(t('tfSendAllDrafts')(drafts.length))}</button>` : ''}</div><div class="rr-list">${drafts.map(tfRow).join('')}</div>` : ''}
    <div class="section-title rr-today-title"><span>${esc(t('rrToday'))}</span>${moved.length ? `<small>${esc(t('tfMovedToday')(moved.length))} · ${esc(t('tfItemsMoved')(moved.reduce((n, r)=>n + r.lines.length, 0)))}</small>` : ''}</div>
    ${done.length ? `<div class="rr-list">${done.map(tfRow).join('')}</div>` : `<p class="rr-none">${esc(t('tfNoneToday'))}</p>`}
    <button type="button" class="rr-to-history" data-to-history="transfers">${esc(t('rrSeeHistory'))}</button>
    ${rrStockNote(tf.data.catalog?.at, tf.data.catalog?.history?.at)}
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
  document.querySelector('[data-tf-senddrafts]')?.addEventListener('click', e=>withBusy(e.currentTarget, tfSendAllDrafts));
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
    // Picking an item gives its counting unit (see the item box below). A unit it no longer has (changed
    // in Ricotta Restaurant) is cleared to be picked again, never swapped: swapping would keep the amount
    // in another unit (2 cartons becoming 2 kilos).
    if(item && units.length && l.unit && !units.some(u=>u.name === l.unit)){ l.unit = ''; tfSaveSoon(r); }
    const have = item ? TF().available(item, r.from) : 0, short = item && need.get(l.item) > have + 1e-9;
    return `<div class="rr-line tf-line${short ? ' warn' : ''}" data-line="${i}">
      <div class="rr-field rr-f-item"><label for="tfItem${i}">${esc(t('rrItem'))} ${i + 1}</label>${rrCombo('tfItem' + i, l.item, t('rrSearchItem'), `data-l-item="${i}"`)}</div>
      <div class="rr-field"><label for="tfQty${i}">${esc(t('tfAmount'))}</label><input id="tfQty${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${esc(rrBoxText(l, 'qty', true))}" placeholder="${esc(t('tfAmountHint'))}"></div>
      <div class="rr-field rr-f-unit"><label for="tfUnit${i}">${esc(t('rrUnit'))}</label><select id="tfUnit${i}" data-l-unit="${i}" data-inline ${item ? '' : 'disabled'}>${units.length ? (l.unit ? '' : `<option value="" selected hidden>${esc(t('rrErrUnit'))}</option>`) + units.map(u=>opt(u.name, u.name + (u.unclear ? ' (?)' : ''), u.name === l.unit)).join('') : opt('', t('rrUnit'), true)}</select></div>
      <button type="button" class="rr-del" data-l-del="${i}" tabindex="-1" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button>
      ${item ? `<p class="tf-avail${short ? ' short' : ''}">${tfAvailHtml(item, r.from, short, l.unit)}${tfUsualNote(item, r)}</p>` : ''}
    </div>`;
  }).join('');
  return `<div class="rr-page rr-edit tf-edit">${rrRicoBar(tf.data.helper, tf.copyAt)}
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
      <div class="rr-sum-total"><b>${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</b><small>${esc(ready ? `${r.from} → ${r.to}` : '')}</small></div>
      <div class="rr-sum-acts"><button type="button" class="rr-cancel" id="tfDiscard">${esc(t('cancel'))}</button><button type="button" class="rr-keep" id="tfKeepDraft" title="${esc(t('rrKeepDraftHint'))}">${esc(t('rrKeepDraft'))}</button>
        <button type="button" class="btn btn-primary" id="tfSend" ${ready ? '' : 'disabled'}>${ICON_CHECK}<span>${esc(featureOn('tfAuto') ? t('tfSendMove') : t('tfSend'))}</span></button></div>
    </div>
    ${tfBelow()}
  </div>`;
}
const tfIsEmpty = r=> !r.to && !r.yesterday && !r.lines.some(l=>l.item || l.qty);
function tfSaveSoon(r){ r.dirty = true; r.edits = (r.edits || 0) + 1; tfKeep(); clearTimeout(tf.saveTimer); tf.saveTimer = setTimeout(()=>tfSaveDraft(r), 600); }
function tfSaveDraft(r){
  clearTimeout(tf.saveTimer);
  // One save at a time; typing during a save keeps the draft unsaved on this device (see rrSaveDraft).
  return rrOneAtATime(r.id, async()=>{
  const edits = r.edits || 0;
  const body = {from:r.from || null, to:r.to || null, yesterday:!!r.yesterday,
    lines:r.lines.filter(l=>l.item).map(l=>({item:l.item, unit:l.unit, qty:Number.isFinite(l.qty) ? l.qty : null}))};
  const res = await api('transfers/' + r.id, {method:'PUT', body, quiet:true});
  if(res.ok && res.data?.id){ r.version = res.data.version; if((r.edits || 0) === edits) r.dirty = false; tfKeep(); }
  tf.netDown = res.status === 0;
  return res.ok;
  });
}
function attachTransferEdit(){
  const r = tfFind(tf.id); if(!r) return;
  const cat = tf.data.catalog, zones = TF().zonesOf(cat);
  const repaint = ()=>{ const top = scrollBox().scrollTop; render(); scrollBox().scrollTop = top; };
  const changed = (redraw = false)=>{ tfSaveSoon(r); if(redraw) repaint(); };
  const go = id=>{ const el = document.getElementById(id); if(!el) return; el.focus({preventScroll:true}); if(!el.matches('[role=combobox]')) el.select?.(); rrReveal(el); };
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
  const stockOf = n=>{ const it = tfItem(n); if(!it) return ''; const c = TF().inCounting(it, TF().available(it, r.from), true); return tfQty(c.qty) + ' ' + c.unit; };
  document.querySelectorAll('[data-l-item]').forEach(inp=>{
    const i = +inp.dataset.lItem;
    rrComboBind(inp, names, (v, again)=>{
      const l = r.lines[i]; if(!l) return;   // the line went away while the list was open
      if(!again && v !== l.item){
        l.item = v;
        // The unit Ricotta Restaurant counts it in (what "available" is shown in); a click changes it.
        const units = TF().unitOptions(tfItem(v)); l.unit = units.length ? units[0].name : '';
        changed(true);
      }
      go('tfQty' + i);
    }, stockOf);
  });
  document.querySelectorAll('[data-l-unit]').forEach(s=>s.onchange = ()=>{ const i = +s.dataset.lUnit; if(!r.lines[i]) return; r.lines[i].unit = s.value; changed(true); go('tfQty' + i); });
  const addLine = (n = 1)=>{ for(let k = 0; k < n; k++) r.lines.push({item:'', unit:'', qty:null}); repaint(); go('tfItem' + (r.lines.length - n)); };
  // Item and amount filled on the last line: the next empty line appears by itself.
  const autoLine = el=>{
    const last = r.lines[r.lines.length - 1];
    if(!(last && last.item && last.qty > 0)) return;
    const id = el.id, at = el.selectionStart;
    r.lines.push({item:'', unit:'', qty:null}); repaint();
    const again = document.getElementById(id); if(again){ again.focus({preventScroll:true}); try{ again.setSelectionRange(at, at); }catch(_){} }
  };
  document.querySelectorAll('[data-l-qty]').forEach(el=>{
    const i = +el.dataset.lQty;
    // A box from a form that was just redrawn (a line removed, another one opened) does nothing.
    el.oninput = ()=>{ if(!r.lines[i] || tfFind(tf.id) !== r) return; r.lines[i].qty = rrOnlyNum(el, true, true); rrKeepTyped(r.lines[i], 'qty', el); tfSaveSoon(r); tfPaintStock(r); autoLine(el); };
    el.addEventListener('blur', ()=>rrTidyTyped(r.lines[i], 'qty', el));
    // On an amount (keys can be changed under ?): Enter goes to the next item; Tab opens the line's unit
    // menu, Tab again moves through the units and Enter picks one.
    el.addEventListener('keydown', e=>{
      if(e.isComposing) return;
      const combo = rrCombo_(e);
      if(combo === rrKeyOf('next')){ e.preventDefault(); tfSaveSoon(r); if(i < r.lines.length - 1) go('tfItem' + (i + 1)); else addLine(); return; }
      rrUnitMenuKey(e, document.getElementById('tfUnit' + i), ()=>tfSaveSoon(r));
    });
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
    tf.data.transfers = tf.data.transfers.filter(x=>x.id !== r.id); tfKeep();
    tfNewDraft({from:r.from});
  };
  document.getElementById('tfSend').onclick = ()=>tfSend(r);
  // Keep as draft: this one stays in Drafts (on the server, or on this device with no connection) and the form is free.
  document.getElementById('tfKeepDraft').onclick = ()=>{ if(tfIsEmpty(r)) return; r.dirty = true; tfKeep(); tfSaveDraft(r); tf.lastFrom = r.from; toast(t('rrDraftKept')); tfNewDraft(); };
  document.onkeydown = e=>{
    if(state.view !== 'transfers' || tf.page !== 'edit'){ document.onkeydown = null; return; }
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); document.activeElement?.blur?.(); tfSend(r); return; }
    rrLineKeys(e, {add:()=>addLine(), yesterday:()=>document.getElementById('tfYest')?.click(),
      dup:i=>{ const l = r.lines[i]; if(!l) return; r.lines.splice(i + 1, 0, {item:l.item, unit:l.unit, qty:null}); changed(true); go('tfQty' + (i + 1)); }});
  };
  if(tf.fresh){ tf.fresh = false; if(!matchMedia('(pointer: coarse)').matches) requestAnimationFrame(()=>go(r.from ? 'tfTo' : 'tfFrom')); }
}
/* While an amount is typed, only the "available" lines change (the box keeps its focus). */
function tfPaintStock(r){
  const need = tfNeedByItem(r);
  r.lines.forEach((l, i)=>{
    const p = document.querySelector(`[data-line="${i}"] .tf-avail`), item = tfItem(l.item); if(!p || !item) return;
    const have = TF().available(item, r.from), short = need.get(l.item) > have + 1e-9, c = TF().inCounting(item, have, true);
    p.classList.toggle('short', short); p.closest('.tf-line')?.classList.toggle('warn', short);
    const first = r.lines.findIndex(x=>x.item === l.item), again = first > -1 && first < i ? ' · ' + t('rrWarnDuplicate')(first + 1) : '';
    p.innerHTML = tfAvailHtml(item, r.from, short, l.unit) + (again ? `<span class="tf-usual">${esc(again)}</span>` : '') + tfUsualNote(item, r);
  });
}
const TF_ERR = {from:'tfErrFrom', fromUnknown:'tfErrFrom', to:'tfErrTo', toUnknown:'tfErrTo', sameZone:'tfErrSame', noLines:'rrErrNoLines', tooManyLines:'rrErrNoLines',
  itemUnknown:'tfErrItem', unitUnknown:'rrErrUnit', unitUnclear:'tfErrUnitUnclear', qty:'tfErrQty', qtyTooBig:'rrErrQtyBig'};
function tfErrText(e, lines){
  const head = e.line ? t('rrLineN')(e.line) + (lines?.[e.line - 1]?.item ? ' · ' + lines[e.line - 1].item : '') + ': ' : '';
  if(e.code === 'notEnough') return head + t('tfErrNotEnough')(tfQty(e.need.qty) + ' ' + e.need.unit, tfQty(e.have.qty) + ' ' + e.have.unit);
  return head + t(TF_ERR[e.code] || 'tfErrItem');
}
/* "Item 3 · Lettuce": the line number with the item's short name, so a question says what it is about. */
function tfLineLabel(w, r){
  const l = r && r.lines && r.lines[w.line - 1], name = l && l.item ? String(l.item).split(' - ')[0].trim() : '';
  return t('rrLineN')(w.line) + (name ? ' · ' + name : '');
}
/* An amount with its unit kept in reading order inside any sentence ("1 دانە", never "دانە 1"). */
const qtyU = (q, u)=>'\u2066' + q + ' ' + u + '\u2069';
function tfWarnText(w, r){
  if(w.code === 'pressed') return t('tfWarnPressed');
  if(w.code === 'repeat') return t('tfWarnRepeat')(rrWhen(w.at));
  if(w.code === 'duplicate') return tfLineLabel(w, r) + ': ' + t('rrWarnDuplicate')(w.first);
  if(w.code === 'allStock') return tfLineLabel(w, r) + ': ' + t('tfWarnAll')(qtyU(tfQty(w.have.qty), w.have.unit), r && r.from);
  if(w.code === 'unusual') return tfLineLabel(w, r) + ': ' + t('tfWarnUnusual')(rrNum(w.times, 1)) + (w.usual ? ' ' + (w.zone ? t('tfUsuallyZone')(w.zone, qtyU(tfQty(w.usual.qty), w.usual.unit)) : t('tfUsually')(qtyU(tfQty(w.usual.qty), w.usual.unit))) : '');
  if(w.code === 'unusualLow') return tfLineLabel(w, r) + ': ' + (w.zone ? t('tfWarnLowZone')(w.zone, qtyU(tfQty(w.usual.qty), w.usual.unit)) : t('tfWarnLow')(qtyU(tfQty(w.usual.qty), w.usual.unit)));
  if(w.code === 'newRoute') return tfLineLabel(w, r) + ': ' + t('tfWarnRoute')(w.from, w.to) + (w.usualTo?.length ? ' ' + t('tfUsuallyTo')(w.usualTo.join(', ')) : '');
  if(w.code === 'yesterday') return t('tfYesterdayOn')(tfDayLabel(tfYesterday()));
  return '';
}
/* Send all drafts: every draft in the list goes to Rico one after another, the one written first going
   first. Each is opened on the form and gets exactly the checks a single Send gives (Fix these first,
   anything unusual, the day it counts on); if one needs fixing or is not confirmed, it stays open there
   and the rest wait. Receipts never do this: each receipt is filled and approved on its own. */
async function tfSendAllDrafts(){
  const drafts = tf.data.transfers.filter(r=>r.status === 'draft' && !r.pendingSend && r.id !== tf.id && !tfIsEmpty(r) && !tfIsPractice(r))
    .sort((a, b)=>Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  if(drafts.length < 2) return;
  const list = `<ol class="cf-list">${drafts.map(r=>`<li dir="auto">${esc(tfRoute(r))} · ${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</li>`).join('')}</ol>`;
  if(!await showConfirm(`<p>${esc(t('tfSendAllAsk'))}</p>${list}`, {title:t('tfSendAllDrafts')(drafts.length), okLabel:t('tfSendAllGo'), okClass:'btn-primary', enter:true, wide:true})) return;
  let sent = 0;
  for(const r of drafts){
    if(!tfFind(r.id) || r.status !== 'draft') continue;
    tfOpen(r.id);
    if(await tfSend(r, true) !== true){ toast(t('tfSendAllStopped')(sent, drafts.length), 'warn'); return; }
    sent++;
  }
  toast(t('tfSendAllDone')(sent));
  tfNewDraft();
}
/* One Send at a time, from the first press (see rrSend). */
async function tfSend(r, keepForm = false){
  if(tf.sending || tf.asking) return false;
  tf.asking = true;
  try{ return await tfSendNow(r, keepForm); } finally { tf.asking = false; }
}
async function tfSendNow(r, keepForm){
  const before = r.lines.length;
  r.lines = r.lines.filter(l=>l.item || l.qty);
  // Empty rows taken out: the screen is redrawn now, so each row on it is the line it edits and line numbers match.
  if(r.lines.length !== before && r.lines.length) render();
  const c = TF().check({from:r.from, to:r.to, yesterday:r.yesterday, lines:r.lines}, tf.data.catalog, tf.data.usual);
  if(c.errors.length){
    if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null});
    // Sent from the list (Waiting to send, Send all): it opens on the form, so the boxes marked are its own.
    if(tf.id !== r.id || tf.page !== 'edit') tfOpen(r.id); else render();
    await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li dir="auto">${esc(tfErrText(e, r.lines))}</li>`).join('')}</ul>`, {title:t('rrFixFirst')});
    rrMarkErrors(c.errors, true);
    return false;
  }
  // Written on an earlier day (with no connection, or a draft kept overnight): which day it counts on is
  // asked, because Ricotta Restaurant can record only today or yesterday.
  const written = erbilDate(new Date(r.createdAt || Date.now())), meant = r.yesterday ? tfDayBefore(written) : written;
  if(meant !== tfToday()){
    if(meant === tfYesterday()){
      const forYesterday = await showConfirm(esc(t('tfWrittenEarlier')(tfDayLabel(meant))), {title:t('tfWhichDay'), okLabel:t('tfForYesterdayBtn'), cancelLabel:t('tfForTodayBtn'), okClass:'btn-primary', enter:true});
      if(r.yesterday !== forYesterday){ r.yesterday = forYesterday; tfSaveSoon(r); }
      if(forYesterday) c.warnings.some(w=>w.code === 'yesterday') || c.warnings.push({code:'yesterday'});
      else c.warnings = c.warnings.filter(w=>w.code !== 'yesterday');
    } else if(!await showConfirm(esc(t('tfTooOld')(tfDayLabel(meant))), {title:t('tfWhichDay'), okLabel:t('tfForTodayBtn'), okClass:'btn-primary'})) return false;
    else { if(r.yesterday){ r.yesterday = false; tfSaveSoon(r); } c.warnings = c.warnings.filter(w=>w.code !== 'yesterday'); }
  }
  // Record for yesterday was confirmed when it was turned on; everything else is read and confirmed here.
  const ask = c.warnings.filter(w=>w.code !== 'yesterday');
  // Moving without a second approval: this is the approval, so what will move is always shown first.
  if(featureOn('tfAuto') && !ask.length && !await showConfirm(tfSummary(r, []), {title:t('tfApproveTitle')(r.lines.filter(l=>l.item).length), okLabel:t('tfSendMove'), okClass:'btn-primary', enter:true, wide:true})) return false;
  if(ask.length && !await showConfirm(tfSummary(r, ask.map(w=>tfWarnText(w, r))), {title:t('rrCheckThese'), okLabel:t('rrSendAnyway'), okClass:'btn-primary', enter:true, wide:true})) return false;
  // No connection: kept here, waiting to send; the form is free for the next one (From stays).
  const parkIt = ()=>{ r.pendingSend = true; r.dirty = true; tfKeep(); tf.lastFrom = r.from; toast(t('rrSavedOffline'), 'warn'); if(!keepForm) tfNewDraft(); else render(); };
  if(rrOffline()) return parkIt();
  tf.sending = true;
  try{
    if(!await tfSaveDraft(r)){ if(tf.netDown) return parkIt(); toast(t('saveFailed'), 'error'); return false; }
    const res = await tfPost(r, c.warnings.map(w=>w.code));
    if(!res) return false;
    if(!res.ok){ toast(res.data?.errors ? res.data.errors.map(e=>tfErrText(e, r.lines)).join(' · ') : t('saveFailed'), 'error'); return false; }
    Object.assign(r, res.data); delete r.pendingSend; delete r.dirty; tfKeep();
    tf.lastFrom = r.from;
    toast(t('rrSent'));
    if(keepForm) render(); else tfNewDraft();   // like Ricotta Restaurant: the form clears, From stays
    return true;
  } finally { tf.sending = false; }
}

/* A transfer at a glance for the approve and check boxes: From → To, how many items and the day, then
   anything to check, each named by its item. */
function tfSummary(r, ws){
  const day = r.yesterday ? t('tfForDay')(tfDayLabel(r.forDay || tfYesterday())) : t('tfToday');
  return `<div class="cf-sum"><div class="cf-route"><b dir="auto">${esc(r.from || '')}</b><span aria-hidden="true">→</span><b dir="auto">${esc(r.to || '')}</b></div>
    <div class="cf-meta">${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))} · ${esc(day)}</div></div>
    ${ws.length ? `<ul class="cf-list">${ws.map(w=>`<li dir="auto">${esc(w)}</li>`).join('')}</ul>` : ''}`;
}
/* Sends to Rico. The server may ask about more than the app knows (Rico already pressed Move it for this
   one, or the same transfer was already sent): those are shown and confirmed before it goes. */
async function tfPost(r, codes){
  codes = [...new Set(codes)];
  let res = await api(`transfers/${r.id}/send`, {method:'POST', body:{confirm:codes}});
  if(!res.ok && res.data?.error === 'needs_confirmation'){
    const more = (res.data.warnings || []).filter(w=>!codes.includes(w.code));
    if(!more.length) return res;
    if(!await showConfirm(tfSummary(r, more.map(w=>tfWarnText(w, r))), {title:t('rrSureTitle'), okLabel:t('rrSendAnyway'), okClass:'btn-danger', wide:true})) return null;
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
    ? `<div class="rr-done"><span class="rr-done-tag">${ICON_CHECK}${esc(t('tfStatus_moved'))}</span><b dir="auto">${esc(tfRoute(r))}</b><small>${esc(r.result && r.result.checked === false ? t('tfNotConfirmed') + (r.result.note ? ': ' + r.result.note : '') : t('tfSeenRecent'))}</small></div>`
    : `<div class="rr-state ${tfIsPractice(r) ? 'practice' : r.status}">${rrRico()}<div><b>${esc(tfStatusText(r))}</b><small>${esc(r.status === 'problem' ? r.problem || '' : t('tfStatusHint_' + r.status))}</small></div></div>`;
  const facts = [[t('tfFrom'), r.from], [t('tfTo'), r.to], [t('tfDay'), tfDayLabel(r.forDay) + (r.yesterday ? ' · ' + t('tfForYesterday') : '')],
    [t('rrMadeIn'), rrSourceName(r) + (accountLabel(r.by) ? ' · ' + accountLabel(r.by) : '')], [t('rrMadeAt'), rrWhen(r.createdAt)],
    ...(r.mode ? [[t('rrRicoMode'), t(r.mode === 'practice' ? 'rrModePracticeLong' : 'rrModeReal')]] : []),
    ...(r.sentAt ? [[t('rrSentAt'), rrWhen(r.sentAt)]] : []),
    ...(r.auto ? [[t('tfApproval'), t('tfApprovalAuto')(accountLabel(r.approvedBy) || '')]] : r.approvedAt ? [[t('rrApprovedAt'), rrWhen(r.approvedAt) + (accountLabel(r.approvedBy) ? ' · ' + accountLabel(r.approvedBy) : '')]] : []),
    ...(r.movedAt ? [[t('tfMovedAt'), rrWhen(r.movedAt)]] : [])];
  return `<div class="rr-page">${rrBackBar(t('tfTitleOne'))}
    ${head}
    ${r.photos.length ? `<div class="section-title">${esc(t('rrPhotos'))}</div>${tfPhotos(r)}` : ''}
    ${(r.warnings || []).filter(w=>w.code !== 'yesterday').length && r.status === 'review' ? `<div class="rr-card rr-warns">${r.warnings.filter(w=>w.code !== 'yesterday').map(w=>`<p>${esc(tfWarnText(w, r))}</p>`).join('')}</div>` : ''}
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
  const act = async (action)=>{
    // Approving shows what will move once more (and anything to check), and Enter approves; cancelling asks plainly.
    const ws = (r.warnings || []).filter(w=>w.code !== 'yesterday').map(w=>tfWarnText(w, r)).filter(Boolean);
    const ok = action === 'approve'
      ? await showConfirm(tfSummary(r, ws), {title:t('tfApproveTitle')(r.lines.length), okLabel:t('tfApprove'), okClass:'btn-primary', enter:true, wide:true})
      : await showConfirm(esc(t('tfCancelAsk')), {okLabel:t('tfCancelOne'), okClass:'btn-danger'});
    if(!ok) return;
    const res = await api(`transfers/${r.id}/${action}`, {method:'POST', body:{}});
    if(!res.ok){ toast(res.data?.error === 'too_late' ? t('tfTooLate') : t('saveFailed'), 'error'); tfLoad(true); return; }
    Object.assign(r, res.data); render();
  };
  const ap = document.getElementById('tfApprove'); if(ap) ap.onclick = ()=>act('approve');
  // Enter on the page approves too (when nothing is being typed and no box is open).
  document.onkeydown = e=>{
    if(state.view !== 'transfers' || tf.page !== 'view'){ document.onkeydown = null; return; }
    if(document.querySelector('.modal-overlay') || e.target.closest?.('input,textarea,select')) return;
    if(e.key === 'Enter' && ap && !e.target.closest?.('button')){ e.preventDefault(); ap.click(); }
    else if(e.key === 'Escape'){ e.preventDefault(); tfBack(); }
  };
  const cn = document.getElementById('tfCancel'); if(cn) cn.onclick = ()=>act('cancel');
  const cp = document.getElementById('tfCopy'); if(cp) cp.onclick = ()=>tfNewDraft(r);
  const rt = document.getElementById('tfRetry'); if(rt) rt.onclick = ()=>tfRetry(r);
  attachLightbox();
}
/* Retry: the same transfer to Rico again, checked against the stock as Rico last read it. If it had
   been approved, Rico may already have pressed Move it, so Recent transfers is to be checked first. */
async function tfRetry(r){
  const c = TF().check({from:r.from, to:r.to, yesterday:r.yesterday, lines:r.lines}, tf.data.catalog, tf.data.usual);
  if(c.errors.length){ await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(tfErrText(e))}</li>`).join('')}</ul><p>${esc(t('rrRetryCopy'))}</p>`, {title:t('rrFixFirst')}); return; }
  const ws = c.warnings.map(w=>tfWarnText(w, r)).filter(Boolean);
  const msg = (r.pressedAt || r.approvedAt ? `<p class="cf-alert">${esc(t('tfRetryCheckFirst'))}</p>` : '') + tfSummary(r, ws);
  if(!await showConfirm(msg, {title:t('rrRetry'), okLabel:t('rrRetry'), okClass:'btn-primary', wide:true, enter:!(r.pressedAt || r.approvedAt)})) return;
  const res = await tfPost(r, c.warnings.map(w=>w.code));
  if(!res) return;
  if(!res.ok){ toast(res.data?.errors ? res.data.errors.map(e=>tfErrText(e, r.lines)).join(' · ') : t('saveFailed'), 'error'); tfLoad(true); return; }
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
      + list.map(r=>`<article class="hist-card rr-hist${r.status === 'cancelled' ? ' is-off' : ''}" data-search-row data-search-text="${esc([r.from, r.to, ...r.lines.map(l=>l.item)].join(' '))}">
        <div class="hist-top"><div class="hist-date"><b>${esc(formatIraqDateTime(new Date(r.sentAt || r.createdAt), {hour:'numeric', minute:'2-digit'}))}</b>${stChip(r, tfStatusText(r))}</div>
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
    const rows = list.flatMap(r=>r.lines.map((l, i)=>[day, formatIraqDateTime(new Date(r.movedAt || r.sentAt), {hour:'2-digit', minute:'2-digit', hour12:false}), r.from, r.to, i + 1, l.item, Number(l.qty), l.unit, tfApprovalText(r), r.yesterday ? t('tfForYesterday') : '']));
    return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[{name:t('tfTitle'), columns:[
      {label:t('fileDate'), width:12}, {label:t('fileTime'), width:8}, {label:t('tfFrom'), width:18}, {label:t('tfTo'), width:18}, {label:'#', width:5, type:'number'},
      {label:t('fileItem'), width:34}, {label:t('fileQty'), width:10, type:'number'}, {label:t('unit'), width:10}, {label:t('tfApproval'), width:24}, {label:t('tfDay'), width:14}], rows}]}),
      `${t('tfFileName')} ${day}`);
  }
  return deliverPdf({title, subtitle, stamp:fileStamp(at), signoff:true, info:[[t('tfTitle'), String(list.length)], [t('tfItemsLabel'), String(list.reduce((n, r)=>n + r.lines.length, 0))]],
    sections:tfPdfSections(list)}, `${t('tfFileName')} ${day}`);
}
/* Who approved a transfer, for files: the person, or "when sent" for one moved without a second approval. */
const tfApprovalText = r=> r.auto ? t('tfNoSecond') : accountLabel(r.approvedBy) || '';
/* One section per transfer: From → To, the time, whether it was for yesterday and who approved it. */
const tfPdfSections = list=> list.map(r=>({heading:`${tfRoute(r)} · ${formatIraqDateTime(new Date(r.movedAt || r.sentAt), {hour:'numeric', minute:'2-digit'})}${r.yesterday ? ' · ' + t('tfForYesterday') : ''}${tfApprovalText(r) ? ' · ' + tfApprovalText(r) : ''}`,
  columns:[{label:'#', w:8}, {label:t('fileItem'), w:62, bold:true}, {label:t('fileQty'), w:14, align:'end'}, {label:t('unit'), w:16}],
  rows:r.lines.map((l, i)=>[String(i + 1), l.item, tfQty(l.qty), l.unit])}));
/* One day's receipts and transfers in one file (History > By day): key figures, then each receipt
   with its lines and total, then each transfer, and lines to sign. */
async function dayExport(day, format){
  const recs = (rr.data?.receipts || []).filter(r=>r.status === 'saved' && erbilDate(new Date(r.savedAt || r.sentAt || r.createdAt)) === day).sort((a, b)=>Date.parse(a.savedAt || a.sentAt) - Date.parse(b.savedAt || b.sentAt));
  const moves = (tf.data?.transfers || []).filter(r=>r.status === 'moved' && (r.forDay || erbilDate(new Date(r.sentAt || r.createdAt))) === day).sort((a, b)=>Date.parse(a.movedAt || a.sentAt) - Date.parse(b.movedAt || b.sentAt));
  const iqd = r=> r.currency === 'USD' ? Math.round((r.total || 0) * (r.rate || 0)) : (r.total || 0);
  const sum = recs.reduce((s, r)=>s + iqd(r), 0), items = moves.reduce((n, r)=>n + r.lines.length, 0);
  const at = new Date(), label = tfDayLabel(day), title = t('dayFileTitle')(label), subtitle = t('dayFileSub')(recs.length, rrNum(sum), moves.length, items);
  const time = d=>formatIraqDateTime(new Date(d), {hour:'2-digit', minute:'2-digit', hour12:false});
  if(format === 'excel'){
    const lineTotal = (l, r)=>globalThis.RicottaReceipts.lineTotal(l, r.currency);
    return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[
      {name:t('rrTitle'), columns:[{label:t('fileTime'), width:8}, {label:t('rrSupplier'), width:30}, {label:t('rrInvoice'), width:14}, {label:'#', width:5, type:'number'}, {label:t('fileItem'), width:34},
        {label:t('fileQty'), width:10, type:'number'}, {label:t('unit'), width:14}, {label:t('rrUnitCost'), width:13, type:'number'}, {label:t('rrTotal'), width:14, type:'number'}, {label:t('rrCurrency'), width:9}, {label:t('rrZone'), width:16}],
        rows:recs.flatMap(r=>r.lines.map((l, i)=>[time(r.savedAt || r.sentAt), r.supplier, r.invoice || '', i + 1, l.item, Number(l.qty), fileUnit(l.unit), Number(l.cost), lineTotal(l, r), r.currency, r.zone])),
        totals:[t('fileTotal'), '', '', '', '', '', '', '', sum, 'IQD', '']},
      {name:t('tfTitle'), columns:[{label:t('fileTime'), width:8}, {label:t('tfFrom'), width:18}, {label:t('tfTo'), width:18}, {label:'#', width:5, type:'number'}, {label:t('fileItem'), width:34},
        {label:t('fileQty'), width:10, type:'number'}, {label:t('unit'), width:10}, {label:t('tfApproval'), width:24}, {label:t('tfDay'), width:14}],
        rows:moves.flatMap(r=>r.lines.map((l, i)=>[time(r.movedAt || r.sentAt), r.from, r.to, i + 1, l.item, Number(l.qty), l.unit, tfApprovalText(r), r.yesterday ? t('tfForYesterday') : '']))},
    ]}), `${t('dayFileName')} ${day}`);
  }
  const recSections = recs.map(r=>{ const tt = globalThis.RicottaReceipts.totals(r);
    return {heading:`${r.supplier} · #${r.invoice || ''} · ${formatIraqDateTime(new Date(r.savedAt || r.sentAt), {hour:'numeric', minute:'2-digit'})}${r.finance?.tab ? ' · ' + t('rrInInvoices')(r.finance.tab) : ''}`,
      columns:[{label:'#', w:6}, {label:t('fileItem'), w:38, bold:true}, {label:t('fileQty'), w:9, align:'end'}, {label:t('unit'), w:14}, {label:t('rrUnitCost'), w:15, align:'end'}, {label:t('rrTotal'), w:18, align:'end'}],
      rows:r.lines.map((l, i)=>[String(i + 1), l.item, rrNum(l.qty, 3), fileUnit(l.unit), rrMoney(l.cost, r.currency), rrMoney(globalThis.RicottaReceipts.lineTotal(l, r.currency), r.currency)]),
      totals:[t('fileTotal'), '', '', '', '', rrMoney(tt.total, r.currency)]}; });
  return deliverPdf({title, subtitle, stamp:fileStamp(at), signoff:true,
    info:[[t('dayFileReceipts'), String(recs.length)], [t('dayFileSpent'), 'IQD ' + rrNum(sum)], [t('dayFileTransfers'), String(moves.length)], [t('tfItemsLabel'), String(items)]],
    sections:[...recSections, ...tfPdfSections(moves)]}, `${t('dayFileName')} ${day}`);
}

/* ---------- History > By day ----------
   Each day's receipts and transfers together, newest day first, with that day's totals: receipts saved
   and what they came to, transfers moved and how many items. A transfer belongs to the day it counts on
   (Record for yesterday puts it on the day before); a receipt to the day it was saved (or sent). */
function renderDaysHistory(){
  const withR = state.views.includes('receipts'), withT = state.views.includes('transfers');
  if(withR && !rr.data && !rr.loading && !rr.failed) rrLoad(true);
  if(withT && !tf.data && !tf.loading && !tf.failed) tfLoad(true);
  if((withR && !rr.data) || (withT && !tf.data)) return (withR && rr.failed) || (withT && tf.failed) ? emptyState(t('loadFailed')) : loadingLines(3);
  const days = new Map(), at = day=>{ if(!days.has(day)) days.set(day, {r:[], t:[]}); return days.get(day); };
  if(withR) rr.data.receipts.filter(r=>!['draft', 'cancelled'].includes(r.status) && !rrIsPractice(r)).forEach(r=>at(erbilDate(new Date(r.savedAt || r.sentAt || r.createdAt))).r.push(r));
  if(withT) tf.data.transfers.filter(r=>!['draft', 'cancelled'].includes(r.status) && !tfIsPractice(r)).forEach(r=>at(r.forDay || erbilDate(new Date(r.sentAt || r.createdAt))).t.push(r));
  if(!days.size) return emptyState(t('daysEmpty'));
  const newest = (a, b)=>Date.parse(b.sentAt || b.createdAt) - Date.parse(a.sentAt || a.createdAt);
  return `<div class="day-list">${[...days.keys()].sort().reverse().map(day=>{
    const d = days.get(day), saved = d.r.filter(r=>r.status === 'saved'), moved = d.t.filter(r=>r.status === 'moved');
    const iqd = saved.reduce((s, r)=>s + (r.currency === 'USD' ? Math.round(r.total * (r.rate || 0)) : (r.total || 0)), 0);
    // Every one sent that day, then how many are done and what the done ones came to.
    const stats = [withR && d.r.length ? `<span class="day-stat"><b>${d.r.length}</b> ${esc(t('dayReceipts')(d.r.length))} · ${esc(t('daySaved')(saved.length))}${saved.length ? ` · IQD ${esc(rrNum(iqd))}` : ''}</span>` : '',
      withT && d.t.length ? `<span class="day-stat"><b>${d.t.length}</b> ${esc(t('dayTransfers')(d.t.length))} · ${esc(t('dayMoved')(moved.length))}${moved.length ? ` · ${esc(t('tfItemsMoved')(moved.reduce((n, r)=>n + r.lines.length, 0)))}` : ''}</span>` : ''].join('');
    return `<section class="day-card"><header class="day-head"><div class="day-top"><b>${esc(dayLabel(day + 'T12:00:00+03:00'))}</b>${saved.length || moved.length ? `<span class="day-files"><button type="button" class="day-file" data-day-export="${day}" data-format="pdf">PDF</button><button type="button" class="day-file" data-day-export="${day}" data-format="excel">Excel</button></span>` : ''}</div><div class="day-stats">${stats}</div></header>
      ${d.r.length ? `<div class="day-sub">${esc(t('rrTitle'))}</div><div class="rr-list">${d.r.sort(newest).map(rrRow).join('')}</div>` : ''}
      ${d.t.length ? `<div class="day-sub">${esc(t('tfTitle'))}</div><div class="rr-list">${d.t.sort(newest).map(tfRow).join('')}</div>` : ''}
    </section>`;
  }).join('')}</div>`;
}
function attachDaysHistory(){
  document.querySelectorAll('[data-day-export]').forEach(b=>b.onclick = ()=>withBusy(b, ()=>dayExport(b.dataset.dayExport, b.dataset.format)));
  document.querySelectorAll('.day-list [data-rr-open]').forEach(b=>b.onclick = ()=>{ const id = b.dataset.rrOpen; goView('receipts'); rrOpen(id); });
  document.querySelectorAll('.day-list [data-tf-open]').forEach(b=>b.onclick = ()=>{ const id = b.dataset.tfOpen; goView('transfers'); tfOpen(id); });
}

/* ---------- Files Rico offers in the chat ---------- */
async function ricoMakeFile(d){
  const needR = canOpen('receipts') && d.what !== 'transfers_day', needT = canOpen('transfers') && ['day', 'transfers_day', 'photos', 'zip'].includes(d.what);
  if(needR && !rr.data) await rrLoad(true);
  if(needT && !tf.data) await tfLoad(true);
  if((needR && !rr.data) || (needT && !tf.data)){ toast(t('loadFailed'), 'error'); return; }
  if(d.what === 'photos') return ricoPhotosZip(d);
  if(d.what === 'zip') return ricoDaysZip(d.day, d.to || d.day);
  if(d.what === 'day') return dayExport(d.day, d.format);
  if(d.what === 'transfers_day') return tfExportDay(d.day, d.format);
  const list = d.what === 'receipt' ? rr.data.receipts.filter(r=>r.id === d.receipt)
    : rr.data.receipts.filter(r=>r.status === 'saved' && erbilDate(new Date(r.savedAt || r.sentAt || r.createdAt)) === d.day);
  if(!list.length){ toast(t('ricoFileNone'), 'warn'); return; }
  return rrExportList(list, d.format, d.what === 'receipt' ? null : d.day);
}
/* Receipts as a file: one receipt (with its supplier and invoice) or one day's, each with its lines and total. */
async function rrExportList(list, format, day){
  const at = new Date(), one = list.length === 1 && !day ? list[0] : null;
  const iqd = r=> r.currency === 'USD' ? Math.round((r.total || 0) * (r.rate || 0)) : (r.total || 0), sum = list.reduce((s, r)=>s + iqd(r), 0);
  const title = one ? t('rrFileOne')(one.supplier, one.invoice || '') : t('rrFileDay')(tfDayLabel(day));
  const subtitle = one ? [formatIraqDateTime(new Date(one.savedAt || one.sentAt || one.createdAt), {day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit'}), one.zone, one.finance?.tab ? t('rrInInvoices')(one.finance.tab) : ''].filter(Boolean).join(' · ') : t('rrFileDaySub')(list.length, rrNum(sum));
  const name = one ? `${one.supplier} ${one.invoice || ''}` : `${t('rrTitle')} ${day}`;
  if(format === 'excel'){
    return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[{name:t('rrTitle'), columns:[{label:t('rrSupplier'), width:30}, {label:t('rrInvoice'), width:14}, {label:'#', width:5, type:'number'}, {label:t('fileItem'), width:34},
      {label:t('fileQty'), width:10, type:'number'}, {label:t('unit'), width:14}, {label:t('rrUnitCost'), width:13, type:'number'}, {label:t('rrTotal'), width:14, type:'number'}, {label:t('rrCurrency'), width:9}],
      rows:list.flatMap(r=>r.lines.map((l, i)=>[r.supplier, r.invoice || '', i + 1, l.item, Number(l.qty), fileUnit(l.unit), Number(l.cost), globalThis.RicottaReceipts.lineTotal(l, r.currency), r.currency])),
      totals:[t('fileTotal'), '', '', '', '', '', '', sum, 'IQD']}]}), name);
  }
  return deliverPdf({title, subtitle, stamp:fileStamp(at), signoff:true,
    info:one ? [[t('rrSupplier'), one.supplier], [t('rrInvoice'), '#' + (one.invoice || '')], [t('rrItemsLabel'), String(one.lines.length)], [t('rrTotal'), rrMoney(globalThis.RicottaReceipts.totals(one).total, one.currency)]]
      : [[t('dayFileReceipts'), String(list.length)], [t('dayFileSpent'), 'IQD ' + rrNum(sum)]],
    sections:list.map(r=>({heading:one ? '' : `${r.supplier} · #${r.invoice || ''}`,
      columns:[{label:'#', w:6}, {label:t('fileItem'), w:38, bold:true}, {label:t('fileQty'), w:9, align:'end'}, {label:t('unit'), w:14}, {label:t('rrUnitCost'), w:15, align:'end'}, {label:t('rrTotal'), w:18, align:'end'}],
      rows:r.lines.map((l, i)=>[String(i + 1), l.item, rrNum(l.qty, 3), fileUnit(l.unit), rrMoney(l.cost, r.currency), rrMoney(globalThis.RicottaReceipts.lineTotal(l, r.currency), r.currency)]),
      totals:[t('fileTotal'), '', '', '', '', rrMoney(globalThis.RicottaReceipts.totals(r).total, r.currency)]}))}, name);
}

/* A unit for files with its size first ("(×6) سیت"), so it reads the same in a PDF and in Excel. */
function fileUnit(label){ const m = rrUnitShow(label).match(/^(.*?)\s*(\([^)]*\))\s*$/); return m ? `${m[2]} ${m[1]}` : rrUnitShow(label); }

/* Files made into one ZIP: the day files are made as for a download, but kept instead of handed over. */
async function collectFiles(run){
  const out = [], de = deliverExcel, dp = deliverPdf;
  deliverExcel = async (bytes, name)=>{ out.push([safeFileName(name) + '.xlsx', bytes]); };
  deliverPdf = async (doc, name)=>{ out.push([safeFileName(name) + '.pdf', new Uint8Array(await (await brandedPdf(doc)).arrayBuffer())]); };
  try{ await run(); } finally{ deliverExcel = de; deliverPdf = dp; }
  return out;
}
/* Rico's photos (before, after, problem) of receipts and transfers, as files for a ZIP. */
async function photoFiles(list, kind){
  const out = [];
  for(const r of list){
    if(!r.photos?.length) continue;
    const res = await api(`${kind}/${r.id}/photos`, {quiet:true});
    const folder = safeFileName(kind === 'receipts' ? `${r.supplier} #${r.invoice || ''}` : `${r.from} to ${r.to} ${(r.sentAt || '').slice(11, 16).replace(':', '')}`);
    let n = 0;
    for(const p of res.data?.photos || []){
      try{ const b = await (await fetch(p.url)).arrayBuffer(); out.push([`${folder}/${p.kind}-${++n}.jpg`, new Uint8Array(b)]); }catch(_){}
    }
  }
  return out;
}
const dayOfR = r=> erbilDate(new Date(r.savedAt || r.sentAt || r.createdAt)), dayOfT = r=> r.forDay || erbilDate(new Date(r.sentAt || r.createdAt));
async function ricoPhotosZip(d){
  const recs = d.receipt ? (rr.data?.receipts || []).filter(r=>r.id === d.receipt) : d.transfer ? [] : (rr.data?.receipts || []).filter(r=>r.status !== 'draft' && dayOfR(r) === d.day);
  const moves = d.transfer ? (tf.data?.transfers || []).filter(r=>r.id === d.transfer) : d.receipt ? [] : (tf.data?.transfers || []).filter(r=>r.status !== 'draft' && dayOfT(r) === d.day);
  const files = [...await photoFiles(recs, 'receipts'), ...await photoFiles(moves, 'transfers')];
  if(!files.length){ toast(t('ricoFileNone'), 'warn'); return; }
  return deliverFile(new Blob([zipStore(files)], {type:'application/zip'}), `${t('ricoFilePhotos')} ${d.day || ''}.zip`.replace(/\s+\.zip$/, '.zip'));
}
/* Everything for a day or several: each day's PDF and Excel (receipts and transfers) and all the photos. */
async function ricoDaysZip(from, to){
  const files = [];
  for(let day = from; day <= to; day = (()=>{ const x = new Date(day + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })()){
    const recs = (rr.data?.receipts || []).filter(r=>r.status !== 'draft' && dayOfR(r) === day), moves = (tf.data?.transfers || []).filter(r=>r.status !== 'draft' && dayOfT(r) === day);
    if(!recs.length && !moves.length) continue;
    const docs = await collectFiles(async ()=>{ await dayExport(day, 'pdf'); await dayExport(day, 'excel'); });
    files.push(...docs.map(([n, b])=>[`${day}/${n}`, b]), ...(await photoFiles(recs, 'receipts')).map(([n, b])=>[`${day}/photos/${n}`, b]), ...(await photoFiles(moves, 'transfers')).map(([n, b])=>[`${day}/photos/${n}`, b]));
  }
  if(!files.length){ toast(t('ricoFileNone'), 'warn'); return; }
  return deliverFile(new Blob([zipStore(files)], {type:'application/zip'}), `Ricotta ${from}${to !== from ? ' to ' + to : ''}.zip`);
}
