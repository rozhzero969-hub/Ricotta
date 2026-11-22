/* ============ Transfers ============
   Moving stock from one storage to another in Ricotta Restaurant, done by Rico from Rozh's Mac (like
   receipts, receipts.js). Three pages in one tab: the list, a transfer being written (laid out like
   Ricotta Restaurant's "Move stock between storages") and one that was sent (Rico's photo to approve,
   then moved). Storages, items and units are named exactly as there; the rules are shared with the API
   and Rico (RicottaTransfers). Stock is Ricotta Restaurant's, as Rico last read it, and Rico checks the
   live stock again on their page right before moving. */
const tf = {data:null, loading:false, page:'edit', id:null, formId:null, filter:{src:'all'}, saveTimer:0, sending:false, fresh:false, failed:false};
/* Signing out keeps nothing of that account on the screen (see rrReset). */
function tfReset(){
  clearTimeout(tf.saveTimer);
  Object.assign(tf, {data:null, loading:false, loadAgain:false, page:'edit', id:null, formId:null, filter:{src:'all'}, saveTimer:0, sending:false, fresh:false,
    failed:false, copyAt:null, netDown:false, asking:false, smartMode:false});
}
const TF = ()=> globalThis.RicottaTransfers;
const tfFind = id=> tf.data?.transfers.find(r=>r.id === id) || null;
const tfItem = name=> (tf.data?.catalog?.titems || []).find(i=>i.name === name) || null;
const tfQty = q=> rrNum(q, 3);
/* How much of an item is really left to move from a storage, in its base unit: the stock Rico last read,
   less what other transfers from there are already taking (sent and waiting for Rico, being moved, or
   moved after the stock was read, and ones waiting to send on this device), and less this person's
   other drafts from there (see tfDrafted). The form being written is
   left out: its own lines are counted where they are typed. */
const TF_TAKING = ['queued', 'filling', 'review', 'approved', 'moving'];
function tfTakenElsewhere(item, zone, formId){
  const readAt = (v=>typeof v === 'number' ? v : Date.parse(v || 0) || 0)(tf.data?.catalog?.at);
  let sum = 0;
  for(const x of tf.data?.transfers || []){
    if(x.id === formId || x.from !== zone || tfIsPractice(x)) continue;
    const taking = TF_TAKING.includes(x.status) || (x.status === 'draft' && x.pendingSend) || (x.status === 'moved' && Date.parse(x.movedAt || 0) > readAt);
    if(!taking) continue;
    for(const l of x.lines || []){
      if(l.item !== item.name || !(l.qty > 0)) continue;
      const o = TF().unitOptions(item).find(u=>u.name === l.unit);
      if(o) sum += l.qty * o.factor;
    }
  }
  return sum;
}
/* This person's other drafts from the same storage hold their amounts too (Rozh, 2026-11-14): 10 kg of
   carrots with 5 kg in a draft to Appetizers leaves 5 kg here. Per destination, in base units. */
function tfDrafted(item, zone, formId){
  const to = new Map();
  for(const x of tf.data?.transfers || []){
    if(x.id === formId || x.from !== zone || x.status !== 'draft' || x.pendingSend || tfIsPractice(x)) continue;
    for(const l of x.lines || []){
      if(l.item !== item.name || !(l.qty > 0)) continue;
      const o = TF().unitOptions(item).find(u=>u.name === l.unit);
      if(o) to.set(x.to || '', (to.get(x.to || '') || 0) + l.qty * o.factor);
    }
  }
  return [...to].map(([zone, base])=>({zone, base}));
}
const tfDraftedSum = (item, zone, formId)=> tfDrafted(item, zone, formId).reduce((a, d)=>a + d.base, 0);
function tfLeft(item, zone, formId){ return Math.max(0, TF().available(item, zone) - tfTakenElsewhere(item, zone, formId) - tfDraftedSum(item, zone, formId)); }
/* "5 کیلۆ in a draft to Appetizers" for each draft holding this item; when the line wants more than is
   left because of them, it says to cancel that draft first. */
function tfDraftWords(item, r, unit){
  const list = tfDrafted(item, r.from, r.id);
  if(!list.length) return '';
  const o = TF().unitOptions(item).find(u=>u.name === unit);
  const amt = base=>{ const c = o ? {qty:Math.floor((base / o.factor) * 1000 + 1e-6) / 1000, unit:o.name} : TF().inCounting(item, base, true); return `\u2066${tfQty(c.qty)} ${c.unit}\u2069`; };   // "1 کیلۆ" in this order, in one piece, in any language
  return list.map(d=>t('tfInDraftTo')(amt(d.base), '\u2068' + (d.zone || t('tfNoStorage')) + '\u2069')).join(' · ');
}
function tfDraftNote(item, r, unit, short){
  const words = tfDraftWords(item, r, unit);
  return words ? `<span class="tf-drafted-note">${esc(words)}${short ? ' · ' + esc(t('tfCancelDraftFirst')) : ''}</span>` : '';
}
/* What a line shows as available: what is left, less the same item on the lines above it in this form
   (10 kg carrots, 3 kg on item 1: item 2 shows 7 kg). */
function tfLeftForLine(item, r, i){
  let before = 0;
  r.lines.slice(0, i).forEach(l=>{ if(l.item !== item.name || !(l.qty > 0)) return; const o = TF().unitOptions(item).find(u=>u.name === l.unit); if(o) before += l.qty * o.factor; });
  return Math.max(0, tfLeft(item, r.from, r.id) - before);
}
function tfItemChoices(names, r, i){
  return names.filter(name=>{
    const item = tfItem(name);
    return !item || tfLeft(item, r.from, r.id) <= 1e-9 ||
      tfLeftForOtherLines(item, r, i) > 1e-9 || r.lines[i]?.item === name;
  });
}
function tfLeftForOtherLines(item, r, current){
  const options = TF().unitOptions(item);
  const assigned = r.lines.reduce((sum, l, i)=>sum + (i !== current && l.item === item.name && l.qty > 0
    ? l.qty * (options.find(u=>u.name === l.unit)?.factor || 0) : 0), 0);
  return Math.max(0, tfLeft(item, r.from, r.id) - assigned);
}
/* The catalog as the Send check should see it: From's stock less what other transfers are taking. */
function tfCatalogLeft(r){
  const cat = tf.data.catalog;
  return {...cat, titems:(cat.titems || []).map(i=>i.stock && r.from in i.stock ? {...i, stock:{...i.stock, [r.from]:tfLeft(i, r.from, r.id)}} : i)};
}
/* "Available: 9 سیت in Main Storage", the amount in bold in a small box (red when there isn't enough). */
function tfAvailHtml(item, zone, short, unit, left){
  const have = left ?? TF().available(item, zone), o = TF().unitOptions(item).find(u=>u.name === unit);
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
  if(u.never){
    const cat = tf.data.catalog;
    const zones = TF().zonesOf(cat).filter(z=>z !== r.from && TF().usualFor(cat, item.name, r.from, z).stat).slice(0, 3);
    const note = zones.length ? ' · ' + t('tfUsuallyTo')(zones.join(', ')) : '';
    return ` <span class="tf-never">· ${esc(t('tfNeverTo')(r.to) + note)}</span>`;
  }
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
  const drafts = tfBatchDrafts();
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
function tfNextDraft(r){
  const zones = TF().zonesOf(tf.data.catalog).filter(z=>z !== 'Main Storage');
  const index = zones.indexOf(r.to);
  tfNewDraft(null, true, tf.smartMode ? {to:index >= 0 ? zones[index + 1] : '', yesterday:r.yesterday} : null);
}
function tfNewDraft(copyOf, draw = true, next = null){
  if(!tf.data?.catalog?.titems?.length){ if(draw) toast(t('tfNoStock'), 'error'); return; }
  tfDropBlankForm();
  const zones = TF().zonesOf(tf.data.catalog), src = copyOf || {};
  const from = src.from || (zones.includes('Main Storage') ? 'Main Storage' : '');
  const r = {id:crypto.randomUUID(), by:state.account, source:'app', status:'draft', from, to:src.to || next?.to || '', yesterday:!!next?.yesterday,
    dayPickedOn:next?.yesterday ? tfToday() : null, nextDefaults:!!next,
    lines:(src.lines || []).map(l=>({...l})), warnings:[], log:[], photos:[], version:0, createdAt:new Date().toISOString()};
  if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null});
  tf.data.transfers.unshift(r);
  tf.id = tf.formId = r.id; tf.page = 'edit'; tf.fresh = true;
  if(draw){ render(); scrollBox().scrollTo({top:0}); if(next?.to) document.getElementById('tfSmartEntry')?.focus({preventScroll:true}); }
}

/* ---------- Writing a transfer (like Ricotta Restaurant's page) ---------- */
function tfNeedByItem(r){
  const m = new Map();
  for(const l of r.lines){ const it = tfItem(l.item), o = it && TF().unitOptions(it).find(u=>u.name === l.unit); if(o && l.qty > 0) m.set(l.item, (m.get(l.item) || 0) + l.qty * o.factor); }
  return m;
}
/* Exact names win. A unique whole-word abbreviation can be added directly;
   fuzzy or ambiguous matches always require an explicit choice. */
function tfSmartMatch(text, items, linked, selectedUnit, picked){
  const search = globalThis.RicottaSearch, norm = search.normalize;
  const parts = text.trim().match(/^(.+)\s+([0-9٠-٩۰-۹][0-9٠-٩۰-۹.,٫٬]*)(?:\s*([^0-9٠-٩۰-۹].*))?$/u);
  const [, name = text.trim(), amount, unit = ''] = parts || [];
  const qty = amount ? rrStrictAmount(amount, 3) : null;
  const simplify = value=>norm(value).split(' ').map(word=>word.replace(/^([a-z]{3,})ies$/, '$1y').replace(/^([a-z]{3,}(?:t|s|h|x|z|o))es$/, '$1').replace(/^([a-z]{3,}[^s])s$/, '$1')).join(' ');
  const aliases = item=>[item.name, ...item.name.split(' - ').map(n=>n.trim()), ...(linked.get(item.name) || [])];
  const query = simplify(name), words = query.split(' ');
  let hits = picked ? items.filter(item=>item.name === picked) : items.filter(item=>item.name === name);
  if(!hits.length) hits = items.filter(item=>norm(item.name) === norm(name));
  if(!hits.length) hits = items.filter(item=>aliases(item).some(alias=>norm(alias) === norm(name)));
  if(!hits.length && query.length >= 3) hits = items.filter(item=>aliases(item).some(alias=>words.every(word=>simplify(alias).split(' ').includes(word))));
  const choices = (hits.length ? hits : query.length >= 3 ? search.rank(items, name, aliases) : []).slice(0, 5).map(item=>({item}));
  if(!parts) return {error:'tfSmartFormat', choices};
  if(!(qty > 0 && qty <= 999999)) return {error:'tfSmartAmount'};
  if(hits.length !== 1) return {error:hits.length ? 'tfSmartAmbiguous' : 'tfSmartMissing', choices};
  const item = hits[0], units = TF().unitOptions(item);
  const exact = units.filter(u=>selectedUnit ? u.name === selectedUnit : norm(u.name) === norm(unit));
  const options = exact.length || selectedUnit || !unit.trim() ? exact : units.filter(u=>search.unit([u.name], unit));
  if(options.length !== 1 || options[0].unclear) return {error:'tfSmartUnit', item, units:units.filter(u=>!u.unclear).map(u=>u.name)};
  return {item, line:{item:item.name, qty, unit:options[0].name}, factor:options[0].factor};
}
function tfSmartAliases(){
  const linked = new Map();
  for(const row of state.items){
    for(const name of [row.stockItem, ...(Array.isArray(row.stockItems) ? row.stockItems : [])]){
      if(typeof name !== 'string') continue;
      if(!linked.has(name)) linked.set(name, []);
      linked.get(name).push(row.name, ...(row.aliases || []));
    }
  }
  return linked;
}
function tfSmartPanel(r, ready){
  const cat = tf.data.catalog;
  const suggested = ready ? TF().itemsIn(cat, r.from).flatMap(item=>{
    const usual = TF().usualFor(cat, item.name, r.from, r.to).stat;
    if(!usual || TF().available(item, r.to) >= usual.q || r.lines.some(l=>l.item === item.name)) return [];
    const amount = TF().inCounting(item, Math.min(usual.q, tfLeft(item, r.from, r.id)), true);
    return amount.qty > 0 ? [{item, amount}] : [];
  }).slice(0, 4) : [];
  const added = r.lines.map((line,i)=>({line,i})).filter(({line})=>line.item).reverse();
  return `<section class="rr-card tf-smart">
    <h2 class="rr-card-title">${esc(t('tfSmart'))}</h2><div class="tf-smart-body"><div class="tf-smart-form">
    <label for="tfSmartEntry">${esc(t('tfSmartEntry'))}</label>
    <input type="text" id="tfSmartEntry" class="rr-input" maxlength="250" value="${esc(r.smartText || '')}" placeholder="${esc(t('tfSmartExample'))}"
      autocomplete="off" enterkeyhint="next" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tfSmartMatches"
      dir="auto" aria-describedby="tfSmartHelp tfSmartStatus" ${ready ? '' : 'disabled'}>
    <small id="tfSmartHelp">${esc(t('tfSmartHint'))}</small>
    <div id="tfSmartStatus" class="tf-smart-status" role="status">${esc(r.smartAdded ? t('tfSmartMatched') + ' · ' + r.smartAdded : '')}</div>
    <div id="tfSmartMatches" role="listbox" aria-label="${esc(t('rrSearchItem'))}"></div>
    <div id="tfSmartChoices"></div>
    ${suggested.length ? `<div class="tf-smart-suggestions"><b>${esc(t('tfSmartSuggestions'))}</b><small>${esc(t('tfSmartSuggestionsHint')(r.to))}</small>
      <div>${suggested.map(({item, amount})=>`<button type="button" class="btn btn-ghost" data-tf-suggestion="${esc(`${item.name} ${amount.qty} ${amount.unit}`)}">
        <bdi>${esc(item.name)} · ${esc(tfQty(amount.qty) + ' ' + amount.unit)}</bdi></button>`).join('')}</div></div>` : ''}</div>
    <aside class="tf-smart-review" aria-label="${esc(t('tfSmartAdded'))}">
      <div><b>${esc(t('tfSmartAdded'))}</b><span class="rr-count">${esc(t('rrItemCount')(added.length))}</span></div>
      ${added.length ? `<ul>${added.map(({line,i})=>{
        const item = tfItem(line.item);
        const routeNote = item && TF().usualFor(cat, item.name, r.from, r.to).never ? tfUsualNote(item,r) : '';
        return `<li><button type="button" class="tf-smart-review-line" data-tf-review-line="${i}">
          <bdi>${esc(line.item)}</bdi><bdi>${line.qty > 0 && line.unit ? esc(tfQty(line.qty) + ' ' + line.unit) : '—'}</bdi></button>${routeNote}</li>`;
      }).join('')}</ul>` : ''}
    </aside></div></section>`;
}
function tfUnfinishedSmart(r){
  if(!r.smartText?.trim()) return false;
  toast(t('tfSmartUnfinished'), 'warn');
  return true;
}
function tfBindSmart(r, changed, go){
  const entry = document.getElementById('tfSmartEntry'), matches = document.getElementById('tfSmartMatches');
  const status = document.getElementById('tfSmartStatus'), choices = document.getElementById('tfSmartChoices');
  const linked = tfSmartAliases(), items = tf.data.catalog.titems;
  let options = [], active = -1;
  const setActive = index=>{
    active = index;
    matches.querySelectorAll('[role=option]').forEach((el,i)=>el.setAttribute('aria-selected', String(i === active)));
    if(active < 0) entry.removeAttribute('aria-activedescendant');
    else entry.setAttribute('aria-activedescendant', 'tfSmartMatch' + active);
  };
  const preview = ()=>{
    const result = tfSmartMatch(entry.value, items, linked);
    options = entry.value.trim() && !entry.disabled ? (result.choices || (result.item ? [{item:result.item}] : [])) : [];
    matches.innerHTML = options.map(({item},i)=>`<div id="tfSmartMatch${i}" role="option" aria-selected="false" data-tf-match="${i}"><bdi>${esc(item.name)}</bdi></div>`).join('');
    setActive(result.line || (result.item && result.error === 'tfSmartUnit') ? 0 : -1);
    entry.setAttribute('aria-expanded', String(!!options.length));
  };
  const add = (selectedUnit, picked)=>{
    if(entry.disabled || !entry.value.trim()) return;
    const result = tfSmartMatch(entry.value, items, linked, selectedUnit, picked);
    if(picked && result.error === 'tfSmartFormat'){
      entry.value = picked + ' ';
      entry.oninput();
      return;
    }
    const {item, line, factor} = result;
    const current = r.lines.findIndex(l=>!l.item && !l.qty);
    let error = result.error;
    if(!error && line.qty * factor > tfLeftForOtherLines(item, r, current) + 1e-9) error = 'tfSmartUnavailable';
    if(!error && r.lines.filter(l=>l.item).length >= TF().MAX_LINES) error = 'rrErrNoLines';
    if(error){
      matches.replaceChildren(); options = []; setActive(-1); entry.setAttribute('aria-expanded','false');
      status.className = 'tf-smart-status bad';
      status.textContent = t(error === 'tfSmartUnit' && result.units.length ? 'tfSmartPickUnit' : error);
      entry.setAttribute('aria-invalid','true');
      const note = item && error === 'tfSmartUnavailable' ? tfDraftWords(item, r, line.unit) : '';
      if(note) status.textContent += ' · ' + note;
      choices.replaceChildren();
      if(result.units?.length){
        // Enhance it exactly like the Unit field on a manual transfer line.
        choices.innerHTML = `<div class="rr-field rr-f-unit"><label for="tfSmartUnitPick">${esc(t('rrUnit'))}</label>
          <select id="tfSmartUnitPick" data-inline><option value="" selected hidden>${esc(t('tfSmartPickUnit'))}</option>
          ${result.units.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></div>`;
        const select = choices.querySelector('select'), text = entry.value;
        select.onchange = ()=>{ if(entry.value === text && select.value) add(select.value, item.name); };
        enhanceSelects(choices);
        select._selBtn.focus({preventScroll:true});
        openSelPop(select);
        return;
      }
      const manual = document.createElement('button');
      manual.type = 'button'; manual.className = 'btn btn-ghost'; manual.textContent = t('tfManual');
      manual.onclick = ()=>{ r.smartText = ''; tf.smartMode = false; tfKeep(); render(); go('tfItem' + (current < 0 ? 0 : current)); };
      choices.append(manual);
      return;
    }
    if(current < 0) r.lines.push(line); else r.lines[current] = line;
    r.smartText = '';
    r.smartAdded = line.item + ' · ' + tfQty(line.qty) + ' ' + line.unit;
    changed(true);
    go('tfSmartEntry');
  };
  entry.oninput = ()=>{
    r.smartText = entry.value;
    r.smartAdded = ''; tfKeep();
    status.textContent = ''; status.className = 'tf-smart-status'; choices.replaceChildren();
    entry.removeAttribute('aria-invalid');
    preview();
  };
  const selectMatch = index=>{
    const item = options[index]?.item;
    if(item){ entry.focus({preventScroll:true}); add(null, item.name); }
  };
  matches.onpointerdown = e=>{ if(e.target.closest('[data-tf-match]')) e.preventDefault(); };
  matches.onclick = e=>{ const el = e.target.closest('[data-tf-match]'); if(el) selectMatch(+el.dataset.tfMatch); };
  entry.onkeydown = e=>{
    if(e.isComposing || e.metaKey || e.ctrlKey) return;
    if(e.key === 'Escape' && options.length){
      e.preventDefault(); matches.replaceChildren(); options = []; setActive(-1); entry.setAttribute('aria-expanded','false');
    } else if(options.length && ['Tab','ArrowDown','ArrowUp'].includes(e.key)){
      // Allow Tab to exit at either end, and when the single exact result is already selected.
      const step = e.shiftKey || e.key === 'ArrowUp' ? -1 : 1;
      const next = active < 0 ? (step > 0 ? 0 : options.length - 1) : active + step;
      if(e.key === 'Tab' && (next < 0 || next >= options.length)) return;
      e.preventDefault();
      setActive((next + options.length) % options.length);
    } else if(e.key === 'Enter'){
      e.preventDefault();
      if(active >= 0) selectMatch(active);
      else if(options.length) setActive(0);
      else add();
    }
  };
  if(entry.value) preview();
  document.querySelectorAll('[data-tf-review-line]').forEach(button=>button.onclick = ()=>go('tfQty' + button.dataset.tfReviewLine));
  document.querySelectorAll('[data-tf-suggestion]').forEach(button=>button.onclick = ()=>{
    if(entry.value.trim()) return;
    entry.value = button.dataset.tfSuggestion;
    entry.oninput();
    go('tfSmartEntry');
  });
}

function renderTransferEdit(){
  const r = tfFind(tf.id); if(!r){ tf.page = 'edit'; tf.formId = null; return renderTransfers(); }
  const cat = tf.data.catalog, need = tfNeedByItem(r);
  const opt = (v, label, on)=>`<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const ready = r.from && r.to && r.from !== r.to;
  const lines = r.lines.map((l, i)=>{
    const item = tfItem(l.item), units = item ? TF().unitOptions(item) : [];
    // Picking an item gives its counting unit (see the item box below). A unit it no longer has (changed
    // in Ricotta Restaurant) is cleared to be picked again, never swapped: swapping would keep the amount
    // in another unit (2 cartons becoming 2 kilos).
    if(item && units.length && l.unit && !units.some(u=>u.name === l.unit)){ l.unit = ''; tfSaveSoon(r); }
    const have = item ? tfLeft(item, r.from, r.id) : 0, short = item && need.get(l.item) > have + 1e-9;
    const drafted = !!item && tfDrafted(item, r.from, r.id).length > 0;
    return `<div class="rr-line tf-line${short ? ' warn' : ''}${drafted ? ' drafted' : ''}" data-line="${i}">
      <div class="rr-field rr-f-item"><label for="tfItem${i}">${esc(t('rrItem'))} ${i + 1}</label>${rrCombo('tfItem' + i, l.item, t('rrSearchItem'), `data-l-item="${i}"`)}</div>
      <div class="rr-field"><label for="tfQty${i}">${esc(t('tfAmount'))}</label><input id="tfQty${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${esc(rrBoxText(l, 'qty', true))}" placeholder="${esc(t('tfAmountHint'))}"></div>
      <div class="rr-field rr-f-unit"><label for="tfUnit${i}">${esc(t('rrUnit'))}</label><select id="tfUnit${i}" data-l-unit="${i}" data-inline ${item ? '' : 'disabled'}>${units.length ? (l.unit ? '' : `<option value="" selected hidden>${esc(t('rrErrUnit'))}</option>`) + units.map(u=>opt(u.name, u.name + (u.unclear ? ' (?)' : ''), u.name === l.unit)).join('') : opt('', t('rrUnit'), true)}</select></div>
      <button type="button" class="rr-del" data-l-del="${i}" tabindex="-1" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button>
      ${item ? `<p class="tf-avail${short ? ' short' : ''}">${tfAvailHtml(item, r.from, short, l.unit, tfLeftForLine(item, r, i))}${tfDraftNote(item, r, l.unit, short)}${tfUsualNote(item, r)}</p>` : ''}
    </div>`;
  }).join('');
  return `<div class="rr-page rr-edit tf-edit">${rrRicoBar(tf.data.helper, tf.copyAt)}
    <div class="pill-seg tf-modes" role="group" aria-label="${esc(viewLabel('transfers'))}">
      <button type="button" class="pill-seg-btn" aria-pressed="${!tf.smartMode}" data-tf-mode="manual">${esc(t('tfManual'))}</button>
      <button type="button" class="pill-seg-btn" aria-pressed="${!!tf.smartMode}" data-tf-mode="smart">${esc(t('tfSmart'))}</button>
    </div>
    <section class="rr-card"><h2 class="rr-card-title">${esc(t('tfStorages'))}</h2>
      <div class="tf-zones">
        <div class="rr-field"><label for="tfFrom">${esc(t('tfFrom'))}</label>${rrCombo('tfFrom', r.from, t('tfChoose'))}</div>
        <span class="tf-arrow" aria-hidden="true">→</span>
        <div class="rr-field"><label for="tfTo">${esc(t('tfTo'))}</label>${rrCombo('tfTo', r.to, t('tfChoose'))}</div>
      </div></section>
    ${tf.smartMode ? tfSmartPanel(r, ready) : ''}
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
const tfIsEmpty = r=> !r.smartText && (r.nextDefaults || (!r.to && !r.yesterday)) && !r.lines.some(l=>l.item || l.qty);
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
  const changed = (redraw = false)=>{ if(!r.nextDefaults || r.lines.some(l=>l.item || l.qty)) tfSaveSoon(r); if(redraw) repaint(); };
  const go = id=>{ const el = document.getElementById(id); if(!el) return; el.focus({preventScroll:true}); if(!el.matches('[role=combobox]')) el.select?.(); rrReveal(el); };
  const enter = (el, fn)=>{ if(el) el.addEventListener('keydown', e=>{ if(e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.isComposing){ e.preventDefault(); fn(); } }); };
  const firstBox = ()=>tf.smartMode ? 'tfSmartEntry' : 'tfItem' + Math.max(0, r.lines.findIndex(l=>!l.item));
  document.querySelectorAll('[data-tf-mode]').forEach(b=>b.onclick = ()=>{ tf.smartMode = b.dataset.tfMode === 'smart';
    if(!tf.smartMode && r.nextDefaults && tfIsEmpty(r)){ r.to = ''; r.yesterday = false; r.dayPickedOn = null; r.nextDefaults = false; }
    repaint(); });
  if(tf.smartMode) tfBindSmart(r, changed, go);
  // From, then To (never the same storage), then the first item.
  rrComboBind(document.getElementById('tfFrom'), zones, (v, again)=>{
    if(!again && v !== r.from){ r.from = v; if(r.to === v) r.to = ''; changed(true); }
    go(r.to ? firstBox() : 'tfTo');
  });
  const toInput = document.getElementById('tfTo');
  if(toInput) rrComboBind(toInput, zones.filter(z=>z !== r.from), (v, again)=>{
    if(!again && v !== r.to){ r.to = v; changed(true); }
    go(firstBox());
  });
  // Items: only what the From storage has, with how much it has.
  const names = r.from ? TF().itemsIn(cat, r.from).map(i=>i.name).sort((a, b)=>a.localeCompare(b)) : [];
  document.querySelectorAll('[data-l-item]').forEach(inp=>{
    const i = +inp.dataset.lItem;
    const stockOf = n=>{
      const it = tfItem(n); if(!it) return '';
      const left = tfLeftForOtherLines(it, r, i), c = TF().inCounting(it, left, true);
      return [tfQty(c.qty) + ' ' + c.unit, tfDraftWords(it, r), ...(left <= 1e-9 ? [t('tfReserved')] : [])].filter(Boolean).join(' · ');
    };
    const blocked = n=>{ const item = tfItem(n); return !item || tfLeftForOtherLines(item, r, i) <= 1e-9; };
    rrComboBind(inp, ()=>tfItemChoices(names, r, i), (v, again)=>{
      const l = r.lines[i]; if(!l || blocked(v)) return;
      if(!again && v !== l.item){
        l.item = v;
        const units = TF().unitOptions(tfItem(v)); l.unit = units.length ? units[0].name : '';
        changed(true);
      }
      go('tfQty' + i);
    }, stockOf, blocked);
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
    r.yesterday = !r.yesterday; r.dayPickedOn = tfToday(); changed(true);
  };
  document.getElementById('tfDiscard').onclick = async ()=>{
    if(!tfIsEmpty(r) && !await showConfirm(esc(t('tfDiscardAsk')), {okLabel:t('rrDiscard')})) return;
    clearTimeout(tf.saveTimer);
    if(r.version) await api('transfers/' + r.id, {method:'DELETE'});
    tf.data.transfers = tf.data.transfers.filter(x=>x.id !== r.id); tfKeep();
    tfNewDraft(null, true, tf.smartMode ? {to:r.to, yesterday:r.yesterday} : null);
  };
  document.getElementById('tfSend').onclick = ()=>tfSend(r);
  // Keep as draft: this one stays in Drafts (on the server, or on this device with no connection) and the form is free.
  document.getElementById('tfKeepDraft').onclick = ()=>{ if(tfIsEmpty(r) || tfUnfinishedSmart(r)) return; r.dirty = true; tfKeep(); tfSaveDraft(r); toast(t('rrDraftKept')); tfNextDraft(r); };
  document.onkeydown = e=>{
    if(state.view !== 'transfers' || tf.page !== 'edit'){ document.onkeydown = null; return; }
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); document.activeElement?.blur?.(); tfSend(r); return; }
    rrLineKeys(e, {add:()=>addLine(), yesterday:()=>document.getElementById('tfYest')?.click(),
      dup:i=>{ const l = r.lines[i]; if(!l) return; r.lines.splice(i + 1, 0, {item:l.item, unit:l.unit, qty:null}); changed(true); go('tfQty' + (i + 1)); }});
  };
  if(tf.fresh){ tf.fresh = false; scrollBox().scrollTo({top:0}); if(!matchMedia('(pointer: coarse)').matches) requestAnimationFrame(()=>go(r.from ? 'tfTo' : 'tfFrom')); }
}
/* While an amount is typed, only the "available" lines change (the box keeps its focus). */
function tfPaintStock(r){
  const need = tfNeedByItem(r);
  r.lines.forEach((l, i)=>{
    const p = document.querySelector(`[data-line="${i}"] .tf-avail`), item = tfItem(l.item); if(!p || !item) return;
    const have = tfLeft(item, r.from, r.id), short = need.get(l.item) > have + 1e-9;
    p.classList.toggle('short', short); p.closest('.tf-line')?.classList.toggle('warn', short);
    p.closest('.tf-line')?.classList.toggle('drafted', tfDrafted(item, r.from, r.id).length > 0);
    const first = r.lines.findIndex(x=>x.item === l.item), again = first > -1 && first < i ? ' · ' + t('rrWarnDuplicate')(first + 1) : '';
    p.innerHTML = tfAvailHtml(item, r.from, short, l.unit, tfLeftForLine(item, r, i)) + tfDraftNote(item, r, l.unit, short) + (again ? `<span class="tf-usual">${esc(again)}</span>` : '') + tfUsualNote(item, r);
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
const tfBatchDrafts = ()=>tfFiltered(tf.data.transfers).filter(r=>r.status === 'draft' && !r.pendingSend && r.id !== tf.id && !tfIsEmpty(r))
  .sort((a, b)=>Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
function tfBatchDay(r, today){
  const written = r.dayPickedOn || erbilDate(new Date(r.createdAt || Date.now()));
  const meant = r.yesterday ? tfDayBefore(written) : written;
  return meant === today ? 'today' : meant === tfDayBefore(today) ? 'yesterday' : '';
}
const tfLinesToSend = r=>r.lines.filter(l=>l.item || l.qty);
const tfReviewKey = r=>JSON.stringify([r.version, r.from, r.to, r.yesterday, r.dayPickedOn, r.createdAt,
  tfLinesToSend(r).map(l=>[l.item, l.qty, l.unit])]);
function tfBatchCheck(r, lines){
  const c = TF().check({...r, lines}, tfCatalogLeft(r), tf.data.usual);
  // Show every warning the normal server check can derive from the same snapshot too.
  const raw = TF().check({...r, lines}, tf.data.catalog, tf.data.usual);
  const warnings = [...c.warnings, ...raw.warnings.filter(w=>!c.warnings.some(a=>a.code === w.code && a.line === w.line))];
  return {...c, warnings:warnings.filter(w=>w.code !== 'yesterday')};
}
async function tfSendAllDrafts(){
  if(tf.asking || tf.sending || rrOffline()) return;
  const drafts = tfBatchDrafts();
  if(drafts.length < 2) return;
  const unfinished = drafts.find(r=>r.smartText?.trim());
  if(unfinished){ tf.smartMode = true; tfOpen(unfinished.id); tfUnfinishedSmart(unfinished); return; }
  const today = tfToday();
  const rows = drafts.map(r=>{
    const lines = tfLinesToSend(r), check = tfBatchCheck(r, lines);
    return {r, lines, check, day:tfBatchDay(r, today), key:tfReviewKey(r)};
  });
  const bad = rows.find(x=>x.check.errors.length);
  if(bad){
    tfOpen(bad.r.id);
    await showAlert(tfSummary({...bad.r, lines:bad.lines}, bad.check.errors.map(e=>tfErrText(e, bad.lines))), {title:t('rrFixFirst')});
    return;
  }
  let outcome;
  tf.asking = true;
  try{
    const approval = showFormModal({title:esc(t('tfSendAllDrafts')(rows.length)), okLabel:t(featureOn('tfAuto') ? 'tfSendMove' : 'tfSendAllGo'),
      bodyHtml:`<p>${esc(t(featureOn('tfAuto') ? 'tfBatchAuto' : 'tfBatchReview'))}</p><div class="tf-batch-actions"><button type="button" class="btn btn-ghost" data-tf-all-day="today">${esc(t('tfBatchAllToday'))}</button><button type="button" class="btn btn-ghost" data-tf-all-day="yesterday">${esc(t('tfBatchAllYesterday'))}</button></div><div class="tf-batch">${rows.map(({r,lines,check,day},i)=>`
        <section><div class="tf-batch-head"><b dir="auto">${esc(tfRoute(r))}</b><select aria-label="${esc(t('tfWhichDay') + ' · ' + tfRoute(r))}" data-tf-batch-day="${i}">
          <option value="" ${day ? '' : 'selected'} disabled>${esc(t('tfWhichDay'))}</option>
          <option value="today" ${day === 'today' ? 'selected' : ''}>${esc(t('tfToday'))} · ${esc(tfDayLabel(today))}</option>
          <option value="yesterday" ${day === 'yesterday' ? 'selected' : ''}>${esc(t('tfForYesterdayBtn'))} · ${esc(tfDayLabel(tfDayBefore(today)))}</option></select></div>
          <div class="tf-batch-lines" dir="auto">${lines.map(l=>`<bdi>${esc(l.item)} · ${esc(tfQty(l.qty) + ' ' + l.unit)}</bdi>`).join('')}</div>
          ${check.warnings.length ? `<ul class="cf-list">${check.warnings.map(w=>`<li dir="auto">${esc(tfWarnText(w, {...r, lines}))}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>`,
      onSubmit:async ()=>{ const days = [...document.querySelectorAll('[data-tf-batch-day]')].map(el=>el.value);
        if(days.length !== rows.length || days.some(d=>!['today','yesterday'].includes(d))) return {error:t('tfBatchDayMissing')};
        outcome = await tfQueueReviewedDrafts(rows, days, today);
      }});
    document.querySelectorAll('[data-tf-all-day]').forEach(b=>b.onclick = ()=>{
      document.querySelectorAll('[data-tf-batch-day]').forEach(el=>{ el.value = b.dataset.tfAllDay; });
    });
    await approval;
    if(!outcome) return;
    const {sent, stopped} = outcome;
    if(sent === rows.length) toast(t('tfSendAllDone')(sent));
    else toast(t('tfSendAllStopped')(sent, rows.length) + (stopped ? ' ' + stopped : ''), 'warn');
    if(state.view === 'transfers') render();
  } finally { tf.asking = false; }
}
async function tfQueueReviewedDrafts(rows, days, today){
  let sent = 0, stopped;

  for(const [i, reviewed] of rows.entries()){
    const r = tfFind(reviewed.r.id), {lines, check, key} = reviewed;
    const unchanged = r?.status === 'draft' && !r.smartText?.trim() && tfReviewKey(r) === key;
    const fresh = unchanged && tfBatchCheck(r, lines);
    if(tfToday() !== today || rrOffline() || !fresh || fresh.errors.length ||
      fresh.warnings.some(w=>!check.warnings.some(a=>JSON.stringify(a) === JSON.stringify(w)))){
      stopped = t('tfBatchChanged'); break;
    }
    r.yesterday = days[i] === 'yesterday';
    r.dayPickedOn = today;
    r.dirty = true;
    tfKeep();
    const edits = r.edits;
    if(!await tfSaveDraft(r) || r.edits !== edits || tfToday() !== today){ stopped = t('tfBatchChanged'); break; }
    // Let the server identify its current warnings before acknowledging any of them.
    // It queues immediately if none are needed. Only the reviewed warning details carry over.
    let res = await tfPost(r, [], false);
    if(!res?.ok && res?.data?.error === 'needs_confirmation'){
      const serverWarnings = res.data.warnings || [];
      const reviewed = serverWarnings.length && serverWarnings.every(w=>w.code === 'yesterday' ? r.yesterday :
        fresh.warnings.some(a=>a.code === w.code && a.line === w.line && tfWarnText(a, r) === tfWarnText(w, r)));
      if(reviewed && r.edits === edits && tfToday() === today) res = await tfPost(r, serverWarnings.map(w=>w.code), false);
    }
    if(!res?.ok){
      stopped = res?.data?.error === 'needs_confirmation' ? t('tfBatchNewWarning') :
        res?.data?.errors?.map(e=>tfErrText(e, lines)).join(' · ') || t('saveFailed');
      break;
    }
    Object.assign(r, res.data); delete r.pendingSend; delete r.dirty; tfKeep();
    sent++;
  }
  return {sent, stopped};
}
/* One Send at a time, from the first press (see rrSend). */
async function tfSend(r, keepForm = false){
  if(tf.sending || tf.asking) return false;
  tf.asking = true;
  try{ return await tfSendNow(r, keepForm); } finally { tf.asking = false; }
}
async function tfSendNow(r, keepForm){
  if(tfUnfinishedSmart(r)) return false;
  const reviewDay = tfToday();
  const before = r.lines.length;
  r.lines = r.lines.filter(l=>l.item || l.qty);
  // Empty rows taken out: the screen is redrawn now, so each row on it is the line it edits and line numbers match.
  if(r.lines.length !== before && r.lines.length) render();
  // Checked against what is really left: other transfers already taking from the same storage count.
  const c = TF().check({from:r.from, to:r.to, yesterday:r.yesterday, lines:r.lines}, tfCatalogLeft(r), tf.data.usual);
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
  const written = r.dayPickedOn || erbilDate(new Date(r.createdAt || Date.now())), meant = r.yesterday ? tfDayBefore(written) : written;
  if(meant !== reviewDay && r.dayPickedOn !== reviewDay){
    if(meant === tfDayBefore(reviewDay)){
      const forYesterday = await showConfirm(esc(t('tfWrittenEarlier')(tfDayLabel(meant))), {title:t('tfWhichDay'), okLabel:t('tfForYesterdayBtn'), cancelLabel:t('tfForTodayBtn'), okClass:'btn-primary', enter:true});
      r.yesterday = forYesterday; r.dayPickedOn = reviewDay; tfSaveSoon(r);
      if(forYesterday) c.warnings.some(w=>w.code === 'yesterday') || c.warnings.push({code:'yesterday'});
      else c.warnings = c.warnings.filter(w=>w.code !== 'yesterday');
    } else if(!await showConfirm(esc(t('tfTooOld')(tfDayLabel(meant))), {title:t('tfWhichDay'), okLabel:t('tfForTodayBtn'), okClass:'btn-primary'})) return false;
    else { r.yesterday = false; r.dayPickedOn = reviewDay; tfSaveSoon(r); c.warnings = c.warnings.filter(w=>w.code !== 'yesterday'); }
  }
  // Record for yesterday was confirmed when it was turned on; everything else is read and confirmed here.
  const ask = c.warnings.filter(w=>w.code !== 'yesterday');
  // Moving without a second approval: this is the approval, so what will move is always shown first.
  if(featureOn('tfAuto') && !ask.length && !await showConfirm(tfSummary(r, []), {title:t('tfApproveTitle')(r.lines.filter(l=>l.item).length), okLabel:t('tfSendMove'), okClass:'btn-primary', enter:true, wide:true})) return false;
  if(ask.length && !await showConfirm(tfSummary(r, ask.map(w=>tfWarnText(w, r))), {title:t('rrCheckThese'), okLabel:t('rrSendAnyway'), okClass:'btn-primary', enter:true, wide:true})) return false;
  // No connection: kept here, waiting to send; the form is free for the next one.
  const parkIt = ()=>{ r.pendingSend = true; r.dirty = true; tfKeep(); toast(t('rrSavedOffline'), 'warn'); if(!keepForm) tfNextDraft(r); else render(); };
  if(tfToday() !== reviewDay){ toast(t('tfBatchChanged'), 'warn'); return false; }
  if(rrOffline()) return parkIt();
  tf.sending = true;
  try{
    if(!await tfSaveDraft(r)){ if(tf.netDown) return parkIt(); toast(t('saveFailed'), 'error'); return false; }
    if(tfToday() !== reviewDay){ toast(t('tfBatchChanged'), 'warn'); return false; }
    const res = await tfPost(r, c.warnings.map(w=>w.code));
    if(!res) return false;
    if(!res.ok){ toast(res.data?.errors ? res.data.errors.map(e=>tfErrText(e, r.lines)).join(' · ') : t('saveFailed'), 'error'); return false; }
    Object.assign(r, res.data); delete r.pendingSend; delete r.dirty; tfKeep();
    toast(t('rrSent'));
    if(keepForm) render(); else tfNextDraft(r);
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
async function tfPost(r, codes, ask = true){
  codes = [...new Set(codes)];
  const sendDay = tfToday();
  let res = await api(`transfers/${r.id}/send`, {method:'POST', body:{confirm:codes}});
  if(ask && !res.ok && res.data?.error === 'needs_confirmation'){
    const more = (res.data.warnings || []).filter(w=>!codes.includes(w.code));
    if(!more.length) return res;
    if(!await showConfirm(tfSummary(r, more.map(w=>tfWarnText(w, r))), {title:t('rrSureTitle'), okLabel:t('rrSendAnyway'), okClass:'btn-danger', wide:true})) return null;
    if(tfToday() !== sendDay){ toast(t('tfBatchChanged'), 'warn'); return null; }
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
    const rows = list.flatMap(r=>r.lines.map((l, i)=>[day, formatIraqDateTime(new Date(r.movedAt || r.sentAt), {hour:'numeric', minute:'2-digit'}), r.from, r.to, i + 1, l.item, Number(l.qty), l.unit, tfApprovalText(r), r.yesterday ? t('tfForYesterday') : '']));
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
  const time = d=>formatIraqDateTime(new Date(d), {hour:'numeric', minute:'2-digit'});
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
