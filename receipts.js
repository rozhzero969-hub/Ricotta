/* ============ Receipts ============
   Receipts for Ricotta Restaurant, which Rico enters there from Rozha's Mac (helper/ and the API's
   receipts.ts). Three pages in one tab: the list, a receipt being written (laid out like Ricotta
   Restaurant's own New receipt page: Receipt details, then Items received, then the total) and one
   that was sent (Rico's photo to approve, or the saved receipt with its finance number). Names are the
   exact ones Rico read from Ricotta Restaurant; the rules are shared with the API (RicottaReceipts). */
const rr = {data:null, loading:false, page:'edit', id:null, formId:null, saveTimer:0, photos:{}, sending:false, filter:{src:'all'}, fresh:false};
const RR_ACTIVE = ['queued','filling','review','approved','saving'];
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
    rr.copyAt = null; rr.failed = false;
    rrKeepCopy('rr', rr.data);
    rrMergeDrafts('rr', rr.data.receipts).forEach(d=>rrSaveDraft(d));
  }
  else if(!rr.data){
    // No connection: the copy kept on this device, with this device's drafts.
    const c = rrCopyOf('rr');
    if(c){ rr.data = c.data; rr.copyAt = c.at; rrMergeDrafts('rr', rr.data.receipts); } else rr.failed = true;
  }
  if((state.view === 'receipts' && !document.activeElement?.closest?.('.rr-edit')) || (state.view === 'settings' && !document.activeElement?.closest?.('.rr-limits'))
    || (state.view === 'history' && ['receipts', 'days'].includes(state.histMode) && !document.activeElement?.closest?.('.search-wrap'))) render();
}
/* Redraws even while a box is being typed in, keeping that box, its cursor and the scroll place. */
function rrRepaintKeepFocus(){
  const a = document.activeElement, id = a?.id, s = a?.selectionStart, e = a?.selectionEnd, top = scrollBox().scrollTop;
  render(); scrollBox().scrollTop = top;
  const b = id && document.getElementById(id);
  if(b){ b.focus({preventScroll:true}); try{ if(s != null) b.setSelectionRange(s, e); }catch(_){} }
}
// Back online: what waits to send gets its Send buttons at once (and drafts are saved on the server).
addEventListener('online', async ()=>{ if(!rr.data) return; await rrLoad(true); if(state.view === 'receipts' && rr.page === 'edit') rrRepaintKeepFocus(); });
addEventListener('offline', ()=>{ if(state.view === 'receipts' && rr.page === 'edit') rrRepaintKeepFocus(); });
const rrKeep = ()=> rr.data && rrKeepDrafts('rr', rr.data.receipts, rrIsEmpty);

/* ---------- Working offline (Receipts and Transfers) ----------
   The last lists, stock, receipts and transfers are kept on this device, and so is every draft, even
   one written with no connection. One sent with no connection waits here ("Waiting to send") and goes
   with Send once there is a connection. Nothing reaches Rico until it is sent, and Rico never acts
   before a person approves. */
const rrOffline = ()=> !navigator.onLine || state.apiOnline === false;
function rrKeepCopy(kind, data){
  const key = kind + 'Copy:' + state.account, listKey = kind === 'rr' ? 'receipts' : 'transfers';
  const slim = {...data, [listKey]:(data[listKey] || []).filter(x=>x.status !== 'draft').slice(0, 200).map(x=>({...x, log:[]}))};
  if(!lset(key, {at:Date.now(), data:slim})) lset(key, {at:Date.now(), data:{...slim, [listKey]:[]}});
}
function rrCopyOf(kind){ const c = lget(kind + 'Copy:' + state.account); return c && c.data && Date.now() - c.at < 14 * 86400000 ? c : null; }
/* Every draft of this account on this device (changed ones are saved on the server when it can be reached). */
function rrKeepDrafts(kind, list, isEmpty){
  lset(kind + 'Drafts:' + state.account, (list || []).filter(x=>x.status === 'draft' && x.by === state.account && (x.pendingSend || x.dirty || !isEmpty(x))).map(x=>({...x, log:[]})));
}
/* The device's drafts merged into the server's list: one changed here (or waiting to send) wins and is
   saved there; one the server no longer has and that wasn't changed here was removed elsewhere. */
function rrMergeDrafts(kind, list){
  const push = [];
  for(const d of lget(kind + 'Drafts:' + state.account) || []){
    const s = list.find(x=>x.id === d.id);
    if(!s){ if(d.dirty || d.pendingSend || !d.version){ list.unshift(d); if(d.dirty || !d.version) push.push(d); } }
    else if(s.status === 'draft'){ if(d.dirty){ Object.assign(s, d); push.push(s); } else if(d.pendingSend) s.pendingSend = true; }
  }
  return push;
}
function rrOfflineNote(copyAt){
  if(!rrOffline() && !copyAt) return '';
  return `<p class="rr-offline">${esc(t('rrOfflineNote'))}${copyAt ? ' ' + esc(t('rrCopyFrom')(formatIraqDateTime(new Date(copyAt), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'}))) : ''}</p>`;
}
/* "Waiting to send": rows with Send, and Send all when there are several. */
function rrWaitingHtml(list, row, kind){
  if(!list.length) return '';
  return `<div class="section-title rr-today-title"><span>${esc(t('rrWaitingToSend'))}</span>${list.length > 1 && !rrOffline() ? `<button type="button" class="rr-send-all" data-${kind}-sendall>${esc(t('rrSendAll'))}</button>` : ''}</div>
    <div class="rr-list rr-waiting">${list.map(r=>`<div class="rr-row-wrap">${row(r)}${rrOffline() ? '' : `<button type="button" class="rr-row-send" data-${kind}-send="${esc(r.id)}">${esc(t('rrSendNow'))}</button>`}</div>`).join('')}</div>`;
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
/* The status of a receipt or transfer as one small label, the same everywhere: waiting (orange), on its
   way (blue), done (green), check this (orange), stopped (red), cancelled (grey, the row faded). */
function stKind(r){
  if(r.status === 'cancelled' || r.status === 'draft') return 'off';
  if(r.status === 'saved') return r.finance?.checked === false ? 'check' : 'ok';
  if(r.status === 'moved') return r.result?.checked === false ? 'check' : 'ok';
  if(r.status === 'problem') return r.mode === 'practice' || /^Practice run/.test(r.problem || '') ? 'off' : 'bad';
  if(r.status === 'review') return 'wait';
  return 'busy';
}
const stChip = (r, label)=>`<span class="st st-${stKind(r)}">${esc(stKind(r) === 'check' ? t('stCheckThis') : label)}</span>`;
const rrRow = r=>`<button type="button" class="rr-row${r.status === 'cancelled' ? ' is-off' : ''}" data-rr-open="${esc(r.id)}">
    <span class="rr-row-main"><b dir="auto">${esc(r.supplier || t('rrNoSupplier'))}</b><small>${esc(rrStatusLine(r))}</small></span>
    ${r.status === 'draft' && !r.pendingSend ? '' : stChip(r, r.pendingSend && r.status === 'draft' ? t('rrWaitingToSend') : rrIsPractice(r) ? t('rrPracticeRun') : t('rrStatus_' + r.status))}
    <span class="rr-row-amt">${esc(r.total == null ? '' : rrMoney(r.total, r.currency))}</span></button>`;
/* Under the form: what needs you (to approve, or that Rico couldn't do), other drafts, and today's. */
function rrBelow(){
  const list = rr.data.receipts.filter(r=>!rrIsPractice(r)), shown = rrFiltered(list);
  const today = erbilDate(new Date()), isToday = r=> erbilDate(new Date(r.sentAt || r.createdAt)) === today;
  const needs = shown.filter(r=>r.status === 'review' || r.status === 'problem');
  const waiting = list.filter(r=>r.status === 'draft' && r.pendingSend && r.id !== rr.id);
  const drafts = shown.filter(r=>r.status === 'draft' && !r.pendingSend && r.id !== rr.id && !rrIsEmpty(r));
  const done = shown.filter(r=>!needs.includes(r) && r.status !== 'draft' && isToday(r));
  const saved = done.filter(r=>r.status === 'saved');
  const sum = saved.reduce((s, r)=> s + (r.currency === 'USD' ? Math.round(r.total * (r.rate || 0)) : r.total), 0);
  return `<div class="rr-below">${rrWaitingHtml(waiting, rrRow, 'rr')}${rrFilterBar(list)}
    ${needs.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="rr-list rr-needs">${needs.map(rrRow).join('')}</div>` : ''}
    ${drafts.length ? `<div class="section-title">${esc(t('rrDrafts'))}</div><div class="rr-list">${drafts.map(rrRow).join('')}</div>` : ''}
    <div class="section-title rr-today-title"><span>${esc(t('rrToday'))}</span>${saved.length ? `<small>${esc(t('rrSavedToday')(saved.length))} · IQD ${esc(rrNum(sum))}</small>` : ''}</div>
    ${done.length ? `<div class="rr-list">${done.map(rrRow).join('')}</div>` : `<p class="rr-none">${esc(t('rrNoneToday'))}</p>`}
    <button type="button" class="rr-to-history" data-to-history="receipts">${esc(t('rrSeeHistory'))}</button>
    ${rrStockNote(rr.data.catalog?.at, rr.data.catalog?.history?.at)}
  </div>`;
}
/* The line under the lists: when Ricotta Restaurant's lists and stock were last read, said plainly, and
   in orange when that is long ago (Rico off) or when Rico hasn't learnt the usual amounts for a day. */
function rrStockNote(at, learntAt){
  if(!at) return `<p class="rr-foot warn">${esc(t('rrNoCatalog'))}</p>`;
  const old = Date.now() - Date.parse(at) > 3 * 3600000, unlearnt = learntAt && Date.now() - Date.parse(learntAt) > 36 * 3600000;
  const when = formatIraqDateTime(new Date(at), {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'});
  return `<p class="rr-foot${old || unlearnt ? ' warn' : ''}">${esc(old ? t('rrStockOld')(when) : t('tfStockAt')(when))}${unlearnt ? ' ' + esc(t('rrNotLearnt')) : ''}</p>`;
}
/* Rico's line with Start / Practice / Stop, at the top of both the Receipts and the Transfers tab. */
function rrRicoBar(h, copyAt){
  if(!h) return '';
  const on = h.online && !h.stopped && !rrOffline();
  return `<section class="rr-card rr-ricobar"><div class="rr-ov-rico"><i class="rr-dot ${on ? 'ok' : ''}" aria-hidden="true"></i><span>${esc(rrOffline() ? t('rrOfflineShort') : rrHelperLine(h))}</span>${isRozha() && !rrOffline() ? rrRicoControls(h) : ''}</div>${isRozha() && !rrOffline() ? rrRicoNote(h) : ''}${h.online && h.signedIn === false ? `<p class="rr-offline">${esc(t('rrNotSignedIn'))}</p>` : ''}${rrOfflineNote(copyAt)}</section>`;
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
  // Waiting to send: one, or all of them one after another (each still asks what it needs to).
  document.querySelectorAll('[data-rr-send]').forEach(b=>b.onclick = ()=>{ const r = rrFind(b.dataset.rrSend); if(r) withBusy(b, ()=>rrSend(r, true)); });
  document.querySelectorAll('[data-tf-send]').forEach(b=>b.onclick = ()=>{ const r = tfFind(b.dataset.tfSend); if(r) withBusy(b, ()=>tfSend(r, true)); });
  document.querySelector('[data-rr-sendall]')?.addEventListener('click', e=>withBusy(e.currentTarget, async ()=>{ for(const r of rr.data.receipts.filter(x=>x.status === 'draft' && x.pendingSend && x.id !== rr.id)){ if(await rrSend(r, true) === false) break; } }));
  document.querySelector('[data-tf-sendall]')?.addEventListener('click', e=>withBusy(e.currentTarget, async ()=>{ for(const r of tf.data.transfers.filter(x=>x.status === 'draft' && x.pendingSend && x.id !== tf.id)){ if(await tfSend(r, true) === false) break; } }));
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
  // The status is the label beside it; this line says what else matters.
  const base = [r.invoice ? '#' + r.invoice : '', rrWhen(r.sentAt || r.createdAt), accountLabel(r.by), rrSourceName(r)];
  if(r.status === 'saved' && r.finance?.tab) base.push(t('rrInInvoices')(r.finance.tab));
  if(r.status === 'problem' && !rrIsPractice(r)) base.push(r.problem || '');
  return base.filter(Boolean).join(' · ');
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
/* Keeps the whole line in sight while typing: a line's search box goes near the top (room for its list
   below it), any other box shows its whole line (item, amount, unit). */
function rrReveal(el){
  const show = ()=>{
    if(!el.isConnected) return;
    const line = el.closest('.rr-line');
    if(line && el.matches('[data-l-item]')) line.scrollIntoView({block:'start'});
    else (line || el).scrollIntoView({block:'nearest'});
  };
  // After the page has settled (a redraw puts the old scroll place back first).
  show(); requestAnimationFrame(()=>requestAnimationFrame(show));
}
/* Line shortcuts on the Receipts and Transfers forms. Each can be changed (press ? › Change); the
   standard ones: ⌥N new line, ⌥D the same item again, ⌥X remove the line, ⌥U its unit, ⌥↑ ⌥↓ the
   same box on the line above or below, ⌥Y Record for yesterday (Transfers). Keys are matched by
   position, so a Mac's ⌥ letters don't matter. */
// unit: on an amount, opens the unit menu and then moves through the units; next: from an amount to the next item.
const RR_KEYS = {unit_menu:'Tab', next:'Enter', add:'Alt+KeyN', dup:'Alt+KeyD', del:'Alt+KeyX', unit:'Alt+KeyU', up:'Alt+ArrowUp', down:'Alt+ArrowDown', yest:'Alt+KeyY'};
const rrKeyOf = act=> (state.settings?.keys && state.settings.keys[act]) || RR_KEYS[act];
/* An event as "Mod+Alt+Shift+KeyN" (Mod is ⌘ on a Mac, Ctrl elsewhere). */
const rrCombo_ = e=> [(e.metaKey || e.ctrlKey) ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.code].filter(Boolean).join('+');
/* On an amount box (Receipts and Transfers): the unit-menu key (Tab unless changed under ?) opens that
   line's unit menu; the key again moves through the units and Enter picks one, then the amount has the
   focus again. Shift+Tab still goes back a box. True when the menu opened. */
function rrUnitMenuKey(e, sel, before){
  if(e.isComposing || rrCombo_(e) !== rrKeyOf('unit_menu') || !sel || sel.disabled || sel.options.length < 2) return false;
  e.preventDefault(); before?.(); openSelPop(sel); return true;
}
function rrLineKeys(e, a){
  if(document.querySelector('.modal-overlay') || !(e.altKey || e.metaKey || e.ctrlKey)) return false;
  const combo = rrCombo_(e), act = Object.keys(RR_KEYS).find(k=>k !== 'unit_menu' && k !== 'next' && rrKeyOf(k) === combo);
  if(!act) return false;
  const line = document.activeElement?.closest?.('.rr-line'), i = line ? +line.dataset.line : -1;
  const kind = el=> el?.matches?.('[data-l-item]') ? 'item' : el?.matches?.('[data-l-qty]') ? 'qty' : el?.matches?.('[data-l-cost]') ? 'cost' : el?.classList?.contains('sel-btn') ? 'unit' : 'item';
  const run = fn=>{ e.preventDefault(); e.stopPropagation(); fn(); return true; };
  if(act === 'add') return run(()=>a.add());
  if(act === 'yest') return a.yesterday ? run(a.yesterday) : false;
  if(i < 0) return false;
  if(act === 'dup') return run(()=>a.dup(i));
  if(act === 'del') return run(()=>line.querySelector('[data-l-del]')?.click());
  if(act === 'unit') return run(()=>line.querySelector('.sel-btn')?.click());
  const other = document.querySelector(`.rr-line[data-line="${i + (act === 'down' ? 1 : -1)}"]`); if(!other) return false;
  const want = kind(document.activeElement);
  const el = want === 'qty' ? other.querySelector('[data-l-qty]') : want === 'cost' ? other.querySelector('[data-l-cost]') : want === 'unit' ? other.querySelector('.sel-btn') : other.querySelector('[data-l-item]');
  return run(()=>{ el.focus({preventScroll:true}); rrReveal(el); });
}
/* N on the Receipts or Transfers form: the first empty line's search (or a new line). */
function rrFocusFree(){
  const free = [...document.querySelectorAll('.rr-edit [data-l-item]')].find(el=>!el.value);
  if(free){ free.focus({preventScroll:true}); rrReveal(free); }
  else document.querySelector('#rrAdd, #tfAdd')?.click();
}
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
  // A click (or Tab) on a box shows the whole list, the chosen one marked; nothing is selected. The first
  // letter typed starts a new search in place of the chosen name; Delete clears it.
  input.addEventListener('focus', ()=>{ open(''); });
  input.addEventListener('mousedown', ()=>{ if(document.activeElement === input && pop.hidden) open(''); });
  input.addEventListener('input', ()=>open(input.value.trim()));
  input.addEventListener('keydown', e=>{
    if(picked && input.value === picked && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey){ input.value = ''; }
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
/* What a number box shows. While a box is being typed in, the form keeps the text as it was typed
   (key + 'Text', never sent): any redraw of the form (a new line appearing, the line's question, Rico's
   status, coming back online) used to rebuild the box from the number alone, so "12." came back as "12"
   and the dot vanished, and "1.50" lost its 0. The text is used only while it still reads as the number
   kept, so a number changed some other way (a photo read by Rico, another device) always shows. */
const rrTextNum = s=> s === '' ? null : Number(String(s).replace(/,/g, ''));
function rrBoxText(o, key, commas = false){
  const v = o?.[key] ?? null, typed = o?.[key + 'Text'];
  if(typeof typed === 'string' && Object.is(rrTextNum(typed), v)) return typed;
  if(Number.isNaN(v)) return '';
  return commas ? rrShowNum(v) : v == null ? '' : String(v);
}
/* Typing keeps the text; leaving the box tidies it ("12." shows as 12), unless it can't be read (that
   box stays as typed, in red). A box taken away by a redraw has not been left: its new copy keeps it. */
function rrKeepTyped(o, key, el){ o[key + 'Text'] = el.value; }
function rrTidyTyped(o, key, el){ if(!o || el?.isConnected === false || Number.isNaN(o[key])) return; delete o[key + 'Text']; }
const RR_MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
function renderReceiptEdit(){
  const r = rrFind(rr.id); if(!r){ rr.page = 'edit'; rr.formId = null; return renderReceipts(); }
  const cat = rr.data.catalog;
  const opt = (v, label, on)=>`<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const c = globalThis.RicottaReceipts.check(r, cat, rrLimits(), rr.data.last);
  const usd = r.currency === 'USD';
  const lines = r.lines.map((l, i)=>{
    const item = rrItem(l.item), units = item ? globalThis.RicottaReceipts.unitOptions(item) : [];
    // A unit the item no longer has (changed in Ricotta Restaurant) is replaced by its usual one.
    if(item && l.unit && !units.some(u=>u.label === l.unit)){ l.unit = globalThis.RicottaReceipts.defaultUnit(item, []) || ''; rrSaveSoon(r); }
    const lineTotal = globalThis.RicottaReceipts.lineTotal(l, r.currency);
    // The line being typed in isn't judged until its box is left (8 on the way to 800 is not "price down").
    const warn = rr.typingLine === i ? '' : c.warnings.filter(w=>w.line === i + 1).map(w=>rrWarnText(w)).join(' ');
    return `<div class="rr-line${warn ? ' warn' : ''}" data-line="${i}">
      <div class="rr-field rr-f-item"><label for="rrItem${i}">${esc(t('rrItem'))} ${i + 1}</label>${rrCombo('rrItem' + i, l.item, t('rrSearchItem'), `data-l-item="${i}"`)}</div>
      <div class="rr-field rr-f-unit"><label for="rrUnit${i}">${esc(t('rrUnit'))}</label><select id="rrUnit${i}" data-l-unit="${i}" data-inline ${item ? '' : 'disabled'}>${opt('', t('rrBaseUnit'), !l.unit)}${units.map(u=>opt(u.label, rrUnitShow(u.label), u.label === l.unit)).join('')}</select></div>
      <div class="rr-field"><label for="rrQty${i}">${esc(t('rrQty'))}</label><input id="rrQty${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-qty="${i}" value="${esc(rrBoxText(l, 'qty'))}" placeholder="0"></div>
      <div class="rr-field"><label for="rrCost${i}">${esc(t('rrUnitCost'))}${usd ? ' ($)' : ''}</label><input id="rrCost${i}" class="rr-input rr-n" inputmode="decimal" autocomplete="off" data-l-cost="${i}" value="${esc(rrBoxText(l, 'cost', true))}" placeholder="0"></div>
      <div class="rr-field rr-total"><span>${esc(t('rrTotal'))}</span><b>${lineTotal ? esc(rrMoney(lineTotal, r.currency)) : '—'}</b></div>
      <button type="button" class="rr-del" data-l-del="${i}" tabindex="-1" aria-label="${esc(t('rrRemoveItem')(i + 1))}">${ICON_DELETE}</button>
      ${warn ? `<p class="rr-line-warn">${esc(warn)}</p>` : ''}</div>`;
  }).join('');
  return `<div class="rr-page rr-edit">${rrRicoBar(rr.data.helper, rr.copyAt)}
    <section class="rr-card"><h2 class="rr-card-title"><span>${esc(t('rrDetails'))}</span><button type="button" class="rr-scan" id="rrScan">${ICON_CAMERA || ''}<span>${esc(t('rrScan'))}</span></button></h2>
      <div class="rr-grid">
        <div class="rr-field"><label for="rrSupplier">${esc(t('rrSupplier'))}</label>${rrCombo('rrSupplier', r.supplier, t('rrSearchSupplier'))}</div>
        <div class="rr-field"><label for="rrZone">${esc(t('rrZone'))}</label><select id="rrZone">${cat.zones.map(z=>opt(z, z, z === r.zone)).join('')}</select></div>
        <div class="rr-field"><label for="rrInvoice">${esc(t('rrInvoice'))}</label><input id="rrInvoice" class="rr-input rr-n" inputmode="numeric" autocomplete="off" maxlength="30" value="${esc(r.invoice || '')}" placeholder="${esc(t('rrInvoiceHint'))}"></div>
        <div class="rr-field"><span class="rr-label">${esc(t('rrCurrency'))}</span><div class="pill-seg rr-cur" role="radiogroup" aria-label="${esc(t('rrCurrency'))}">
          <button type="button" class="pill-seg-btn" role="radio" aria-checked="${!usd}" data-cur="IQD">IQD</button><button type="button" class="pill-seg-btn" role="radio" aria-checked="${usd}" data-cur="USD">USD $</button></div></div>
        ${usd ? `<div class="rr-field"><label for="rrRate">${esc(t('rrRate'))}</label><input id="rrRate" class="rr-input rr-n" inputmode="decimal" autocomplete="off" value="${esc(rrBoxText(r, 'rate'))}" placeholder="1500"></div>`
          : `<div class="rr-field"><label for="rrDelivery">${esc(t('rrDelivery'))}</label><input id="rrDelivery" class="rr-input rr-n" inputmode="numeric" autocomplete="off" value="${esc(rrBoxText(r, 'delivery', true))}" placeholder="${esc(t('rrNoDelivery'))}"></div>`}
      </div></section>
    <section class="rr-card"><h2 class="rr-card-title"><span>${esc(t('rrItems'))}</span><span class="rr-count">${esc(t('rrItemCount')(r.lines.filter(l=>l.item).length))}</span></h2>
      <div class="rr-lines">${lines}</div>
      <button type="button" class="rr-add" id="rrAdd">${ICON_PLUS}<span>${esc(t('rrAddItem'))}</span></button>
      <p class="rr-keys">${esc(t('rrKeysHint')(RR_MOD))}</p></section>
    <div class="rr-sum">
      <div class="rr-sum-total"><span>${esc(t('rrTotal'))}:</span> <b>${esc(rrMoney(c.total, r.currency))}</b><small>${esc(usd ? (c.iqd ? '= IQD ' + rrNum(c.iqd) : '') : (c.delivery ? t('rrPlusDelivery')(rrNum(c.items), rrNum(c.delivery)) : ''))}</small></div>
      <div class="rr-sum-acts"><button type="button" class="rr-cancel" id="rrDiscard">${esc(t('cancel'))}</button><button type="button" class="rr-keep" id="rrKeepDraft" title="${esc(t('rrKeepDraftHint'))}">${esc(t('rrKeepDraft'))}</button>
        <button type="button" class="btn btn-primary" id="rrSend">${ICON_CHECK}<span>${esc(t('rrSend'))}</span></button></div>
    </div>
    ${rrBelow()}
  </div>`;
}
/* "Item 3 · Lettuce: ...": a question names the item it is about. */
function rrWarnLine(w, r){
  const l = r && r.lines && w.line ? r.lines[w.line - 1] : null, name = l && l.item ? String(l.item).split(' - ')[0].trim() : '';
  return (w.line ? t('rrLineN')(w.line) + (name ? ' · ' + name : '') + ': ' : '') + rrWarnText(w);
}
function rrSummary(r, ws){
  const tt = globalThis.RicottaReceipts.totals(r);
  return `<div class="cf-sum"><div class="cf-route"><b dir="auto">${esc(r.supplier || '')}</b></div>
    <div class="cf-meta">${esc([r.invoice ? '#' + r.invoice : '', t('rrItemCount')(r.lines.filter(l=>l.item).length), r.zone, rrMoney(tt.total, r.currency)].filter(Boolean).join(' · '))}</div></div>
    ${ws.length ? `<ul class="cf-list">${ws.map(w=>`<li dir="auto">${esc(w)}</li>`).join('')}</ul>` : ''}`;
}
function rrWarnText(w){
  if(w.code === 'pressed') return t('rrWarnPressed');
  if(w.code === 'priceJump') return t('rrWarnPrice')(w.pct, rrNum(w.before));
  if(w.code === 'duplicate') return t('rrWarnDuplicate')(w.first);
  if(w.code === 'tinyUnit') return t('rrWarnTinyUnit');
  if(w.code === 'qtyHigh') return t('rrWarnQtyHigh')(rrNum(w.times, 1), '\u2066' + rrNum(w.usual, 3) + ' ' + w.unit + '\u2069');
  if(w.code === 'qtyLow') return t('rrWarnQtyLow')('\u2066' + rrNum(w.usual, 3) + ' ' + w.unit + '\u2069');
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
  r.dirty = true; rrKeep();
  clearTimeout(rr.saveTimer);
  rr.saveTimer = setTimeout(()=>rrSaveDraft(r), 600);
}
async function rrSaveDraft(r){
  clearTimeout(rr.saveTimer);
  const body = {supplier:r.supplier || null, invoice:r.invoice || null, zone:r.zone, currency:r.currency, rate:Number.isFinite(r.rate) ? r.rate : null,
    delivery:Number.isFinite(r.delivery) ? r.delivery : null, lines:r.lines.filter(l=>l.item).map(l=>({item:l.item, unit:l.unit, qty:Number.isFinite(l.qty) ? l.qty : null, cost:Number.isFinite(l.cost) ? l.cost : null}))};
  const res = await api('receipts/' + r.id, {method:'PUT', body, quiet:true});
  if(res.ok && res.data?.id){ r.version = res.data.version; r.dirty = false; rrKeep(); }
  rr.netDown = res.status === 0;
  return res.ok;
}
function attachReceiptEdit(){
  const r = rrFind(rr.id); if(!r) return;
  const cat = rr.data.catalog;
  const repaint = ()=>{ const top = scrollBox().scrollTop; render(); scrollBox().scrollTop = top; };
  const changed = (redraw = false)=>{ rrSaveSoon(r); if(redraw) repaint(); else rrPaintTotals(r); };
  const go = id=>{ const el = document.getElementById(id); if(!el) return; el.focus({preventScroll:true}); if(!el.matches('[role=combobox]')) el.select?.(); rrReveal(el); };
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
  const num = (id, key, dec)=>{ const el = document.getElementById(id); if(!el) return; el.oninput = ()=>{ r[key] = rrOnlyNum(el, dec, key === 'delivery'); rrKeepTyped(r, key, el); el.classList.toggle('bad', Number.isNaN(r[key])); changed(); }; el.addEventListener('blur', ()=>rrTidyTyped(r, key, el)); enter(el, ()=>go(firstItem())); };
  num('rrRate', 'rate', true); num('rrDelivery', 'delivery', false);
  const names = cat.items.map(i=>i.name);
  document.querySelectorAll('[data-l-item]').forEach(inp=>{
    const i = +inp.dataset.lItem;
    rrComboBind(inp, names, (v, again)=>{
      const l = r.lines[i]; if(!l) return;   // the line went away while the list was open
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
  document.querySelectorAll('[data-l-unit]').forEach(s=>s.onchange = ()=>{ const i = +s.dataset.lUnit; if(!r.lines[i]) return; r.lines[i].unit = s.value; changed(true); go('rrQty' + i); });
  // Typing an amount or a price: that line's question waits; leaving the box shows it at once (or clears it).
  const judgeOnLeave = (el, i)=>{
    el.addEventListener('focus', ()=>{ rr.typingLine = i; });
    el.addEventListener('blur', ()=>{ if(rr.typingLine !== i) return; rr.typingLine = null; setTimeout(()=>{ if(state.view === 'receipts' && rr.page === 'edit' && rrFind(rr.id) === r) rrRepaintKeepFocus(); }, 0); });
  };
  document.querySelectorAll('[data-l-qty]').forEach(el=>{
    const i = +el.dataset.lQty;
    judgeOnLeave(el, i);
    el.oninput = ()=>{ if(!r.lines[i] || rrFind(rr.id) !== r) return; const v = rrOnlyNum(el, true); r.lines[i].qty = v; rrKeepTyped(r.lines[i], 'qty', el); el.classList.toggle('bad', Number.isNaN(v)); changed(); autoLine(el); };
    el.addEventListener('blur', ()=>rrTidyTyped(r.lines[i], 'qty', el));
    enter(el, ()=>go('rrCost' + i));
    // Tab opens the line's unit menu, as on Transfers; Enter still goes on to the unit cost.
    el.addEventListener('keydown', e=>rrUnitMenuKey(e, document.getElementById('rrUnit' + i)));
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
    judgeOnLeave(el, i);
    el.oninput = ()=>{ if(!r.lines[i] || rrFind(rr.id) !== r) return; const v = rrOnlyNum(el, true, true); r.lines[i].cost = v; rrKeepTyped(r.lines[i], 'cost', el); el.classList.toggle('bad', Number.isNaN(v)); changed(); autoLine(el); };
    el.addEventListener('blur', ()=>rrTidyTyped(r.lines[i], 'cost', el));
    enter(el, ()=>{ rrSaveSoon(r); if(i < r.lines.length - 1) go('rrItem' + (i + 1)); else addLine(); });
  });
  document.querySelectorAll('[data-l-del]').forEach(b=>b.onclick = ()=>{ r.lines.splice(+b.dataset.lDel, 1); if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null}); changed(true); });
  document.getElementById('rrAdd').onclick = addLine;
  document.getElementById('rrDiscard').onclick = async ()=>{
    if(!await showConfirm(esc(t('rrDiscardAsk')), {okLabel:t('rrDiscard')})) return;
    clearTimeout(rr.saveTimer);
    if(r.version) await api('receipts/' + r.id, {method:'DELETE'});
    rr.data.receipts = rr.data.receipts.filter(x=>x.id !== r.id); rrKeep();
    rrNewDraft(r.zone ? {zone:r.zone} : null);
  };
  document.getElementById('rrSend').onclick = ()=>rrSend(r);
  document.getElementById('rrScan')?.addEventListener('click', e=>rrScanPhoto(r, e.currentTarget));
  // Keep as draft: this one stays in Drafts (on the server, or on this device with no connection) and the form is free.
  document.getElementById('rrKeepDraft').onclick = ()=>{ if(rrIsEmpty(r)) return; r.dirty = true; rrKeep(); rrSaveDraft(r); toast(t('rrDraftKept')); rrNewDraft({zone:r.zone}); };
  // Cmd/Ctrl + Enter sends from anywhere on the page.
  document.onkeydown = e=>{
    if(state.view !== 'receipts' || rr.page !== 'edit'){ document.onkeydown = null; return; }
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); document.activeElement?.blur?.(); rrSend(r); return; }
    rrLineKeys(e, {add:()=>addLine(), dup:i=>{ const l = r.lines[i]; if(!l) return; r.lines.splice(i + 1, 0, {item:l.item, unit:l.unit, qty:null, cost:l.cost}); changed(true); go('rrQty' + (i + 1)); }});
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
async function rrSend(r, keepForm = false){
  if(rr.sending) return false;
  r.lines = r.lines.filter(l=>l.item || l.qty || l.cost);
  const c = globalThis.RicottaReceipts.check(r, rr.data.catalog, rrLimits(), rr.data.last);
  if(c.errors.length){
    if(!r.lines.length) r.lines.push({item:'', unit:'', qty:null, cost:null});
    render();
    await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(rrErrText(e))}</li>`).join('')}</ul>`, {title:t('rrFixFirst')});
    return;
  }
  // Every warning is read and confirmed before Rico gets the receipt.
  if(c.warnings.length && !await showConfirm(rrSummary(r, c.warnings.map(w=>rrWarnLine(w, r))), {title:t('rrCheckThese'), okLabel:t('rrSendAnyway'), okClass:'btn-primary', enter:true, wide:true})) return;
  if(c.warnings.some(w=>w.code === 'bigTotal') && !await showConfirm(esc(t('rrBigAgain')(rrNum(c.iqd))), {title:t('rrSureTitle'), okLabel:t('rrSend'), okClass:'btn-primary'})) return;
  // No connection: kept here, waiting to send; the form is free for the next one.
  const parkIt = ()=>{ r.pendingSend = true; r.dirty = true; rrKeep(); toast(t('rrSavedOffline'), 'warn'); if(!keepForm) rrNewDraft({zone:r.zone}); else render(); };
  if(rrOffline()) return parkIt();
  rr.sending = true;
  try{
    if(!await rrSaveDraft(r)){ if(rr.netDown) return parkIt(); toast(t('saveFailed'), 'error'); return; }
    const res = await rrPost(r, c.warnings.map(w=>w.code));
    if(!res) return;
    if(!res.ok){
      const msg = res.data?.error === 'invoice_already_sent' ? t('rrErrAlreadySent') : res.data?.errors ? res.data.errors.map(rrErrText).join(' · ') : t('saveFailed');
      toast(msg, 'error'); return;
    }
    Object.assign(r, res.data); delete r.pendingSend; delete r.dirty; rrKeep();
    toast(t('rrSent'));
    if(keepForm) render(); else rrNewDraft({zone:r.zone});
    return true;
  } finally { rr.sending = false; }
}

/* Sends to Rico. The server may ask about more than the app knows (Rico already pressed Save for this
   receipt or one with the same invoice): that is shown and confirmed before it goes. */
async function rrPost(r, codes){
  codes = [...new Set(codes)];
  let res = await api(`receipts/${r.id}/send`, {method:'POST', body:{confirm:codes}});
  if(!res.ok && res.data?.error === 'needs_confirmation'){
    const more = (res.data.warnings || []).filter(w=>!codes.includes(w.code));
    if(!more.length) return res;
    if(!await showConfirm(rrSummary(r, more.map(w=>rrWarnLine(w, r))), {title:t('rrSureTitle'), okLabel:t('rrSendAnyway'), okClass:'btn-danger', wide:true})) return null;
    res = await api(`receipts/${r.id}/send`, {method:'POST', body:{confirm:[...codes, ...more.map(w=>w.code)]}});
  }
  return res;
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
    ${(r.warnings || []).length && r.status === 'review' ? `<div class="rr-card rr-warns">${r.warnings.map(w=>`<p>${esc(rrWarnLine(w, r))}</p>`).join('')}</div>` : ''}
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
  const act = async (action)=>{
    // Approving shows the receipt once more (and anything to check), and Enter approves; cancelling asks plainly.
    const ws = (r.warnings || []).map(w=>rrWarnLine(w, r)).filter(Boolean);
    const big = r.total >= (rrLimits().bigTotal || Infinity);
    const ok = action === 'approve'
      ? await showConfirm(rrSummary(r, ws) + (big ? `<p class="cf-alert">${esc(t('rrBigAgain')(rrNum(r.total)))}</p>` : ''), {title:t('rrApproveTitle'), okLabel:t('rrApprove'), okClass:'btn-primary', enter:true, wide:true})
      : await showConfirm(esc(t('rrCancelAsk')), {okLabel:t('rrCancelReceipt'), okClass:'btn-danger'});
    if(!ok) return;
    const res = await api(`receipts/${r.id}/${action}`, {method:'POST', body:{}});
    if(!res.ok){ toast(res.data?.error === 'too_late' ? t('rrTooLate') : t('saveFailed'), 'error'); rrLoad(true); return; }
    Object.assign(r, res.data); render();
  };
  const ap = document.getElementById('rrApprove'); if(ap) ap.onclick = ()=>act('approve');
  // Enter on the page approves too (when nothing is being typed and no box is open).
  document.onkeydown = e=>{
    if(state.view !== 'receipts' || rr.page !== 'view'){ document.onkeydown = null; return; }
    if(document.querySelector('.modal-overlay') || e.target.closest?.('input,textarea,select')) return;
    if(e.key === 'Enter' && ap && !e.target.closest?.('button')){ e.preventDefault(); ap.click(); }
    else if(e.key === 'Escape'){ e.preventDefault(); rrBack(); }
  };
  const cn = document.getElementById('rrCancel'); if(cn) cn.onclick = ()=>act('cancel');
  const cp = document.getElementById('rrCopy'); if(cp) cp.onclick = ()=>rrNewDraft(r);
  const rt = document.getElementById('rrRetry'); if(rt) rt.onclick = ()=>rrRetry(r);
  attachLightbox();
}

/* From a photo: a picture of the paper receipt is made smaller here, read on the server, and what was
   read fills this form (only names from Ricotta Restaurant's lists). The person checks it and sends it. */
function rrScanPhoto(r, btn){
  const pick = document.createElement('input');
  pick.type = 'file'; pick.accept = 'image/*'; pick.setAttribute('capture', 'environment');
  pick.onchange = ()=>withBusy(btn, async ()=>{
    const f = pick.files?.[0]; if(!f) return;
    const img = await globalThis.createImageBitmap(f).catch(()=>null); if(!img){ toast(t('saveFailed'), 'error'); return; }
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const image = c.toDataURL('image/jpeg', .82).split(',')[1];
    const res = await api('receipts/scan', {method:'POST', body:{image}, timeout:90000});
    if(!res.ok){ toast(t('rrScanFailed'), 'error'); return; }
    const d = res.data;
    if(d.supplier) r.supplier = d.supplier;
    if(d.invoice) r.invoice = d.invoice;
    r.currency = d.currency || r.currency;
    if(d.delivery != null && r.currency === 'IQD') r.delivery = d.delivery;
    if(d.lines?.length) r.lines = [...d.lines.map(l=>({item:l.item, unit:l.unit, qty:l.qty, cost:l.cost})), {item:'', unit:'', qty:null, cost:null}];
    rrSaveSoon(r); render();
    toast(t('rrScanned')(d.lines?.length || 0), 'warn', {ms:5000});
  });
  pick.click();
}
/* Retry: the same receipt to Rico again, after it is checked against the lists as they are now. If it
   had been approved, Rico may already have pressed Save, so Ricotta Restaurant is to be checked first. */
async function rrRetry(r){
  const c = globalThis.RicottaReceipts.check(r, rr.data.catalog, rrLimits(), rr.data.last);
  if(c.errors.length){ await showAlert(`<ul class="rr-errs">${c.errors.slice(0, 8).map(e=>`<li>${esc(rrErrText(e))}</li>`).join('')}</ul><p>${esc(t('rrRetryCopy'))}</p>`, {title:t('rrFixFirst')}); return; }
  const ws = c.warnings.map(w=>rrWarnLine(w, r)).filter(Boolean);
  const msg = (r.pressedAt || r.approvedAt ? `<p class="cf-alert">${esc(t('rrRetryCheckFirst'))}</p>` : '') + rrSummary(r, ws);
  if(!await showConfirm(msg, {title:t('rrRetry'), okLabel:t('rrRetry'), okClass:'btn-primary', wide:true, enter:!(r.pressedAt || r.approvedAt)})) return;
  const res = await rrPost(r, c.warnings.map(w=>w.code));
  if(!res) return;
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
/* Settings > Rico, as a plain settings list: his status, the approval rules, the receipt limits as
   values (Edit opens a small box to change them), Stop, and Telegram. */
function renderRicoReceiptSettings(){
  if(!isRozha() || !canOpen('receipts')) return '';
  const h = rr.data?.helper;
  if(!h){ if(!rr.loading) rrLoad(true); return ''; }
  if(!rr.tg && !rr.tgLoading){ rr.tgLoading = true; api('receipts-settings/telegram', {quiet:true}).then(r=>{ rr.tgLoading = false; if(r.ok){ rr.tg = r.data; if(state.view === 'settings') render(); } }); }
  const L = h.limits, on = h.online && !h.stopped;
  const row = (label, value)=>`<div class="rs-row"><span>${esc(label)}</span><b dir="ltr">${esc(value)}</b></div>`;
  return `<div class="section-title">${esc(t('rrSettingsTitle'))}</div>
    <div class="form-card rs-card">
      <div class="rs-row rs-status"><span><i class="rr-dot ${on ? 'ok' : ''}" aria-hidden="true"></i>${esc(t('rrRicoMac'))}</span><b>${esc(rrHelperLine(h))}</b></div>
      <div class="rs-row"><span>${esc(t('rrTitle'))}</span><b>${esc(t('rsAlwaysYou'))}</b></div>
      <label class="check-row preference-row rs-switch"><input type="checkbox" id="tfAutoSet" ${featureOn('tfAuto') ? 'checked' : ''}><span>${esc(t('tfTitle'))}: ${esc(t('rsTfAuto'))}<small>${esc(t('rsTfAutoShort'))}</small></span></label>
      <label class="check-row preference-row rs-switch"><input type="checkbox" id="rrStop" ${h.stopped ? 'checked' : ''}><span>${esc(t('rrStop'))}<small>${esc(t('rrStopHint'))}</small></span></label>
    </div>
    <div class="section-title rs-sub"><span>${esc(t('rsLimits'))}</span><button type="button" class="rs-edit" id="rrLimEdit">${esc(t('rsEdit'))}</button></div>
    <div class="form-card rs-card">
      ${row(t('rrLimBig'), 'IQD ' + rrNum(L.bigTotal))}${row(t('rrLimJump'), L.priceJump + '%')}${row(t('rsRate'), rrNum(L.rateMin) + ' – ' + rrNum(L.rateMax))}
    </div>
    <div class="form-card rs-card">
      <div class="rs-row"><span>${esc(t('rrTelegram'))}<small>${esc(!rr.tg ? '' : !rr.tg.ready ? t('rrTgNotSetUp') : rr.tg.connected ? t('rrTgConnected') : t('rrTgNotConnected'))}</small></span>
        ${rr.tg?.ready ? `<button type="button" class="rs-edit" id="rrTgConnect">${esc(rr.tg.connected ? t('rrTgReconnect') : t('rrTgConnect'))}</button>` : ''}</div>
    </div>`;
}
function attachRicoReceiptSettings(){
  const put = async body=>{
    const res = await api('receipts-settings', {method:'PUT', body});
    if(res.ok && rr.data){ rr.data.helper = res.data; toast(t('rrSettingsSaved')); } else toast(t('saveFailed'), 'error');
    render(); return res.ok;
  };
  const s = document.getElementById('rrStop'); if(s) s.onchange = ()=>put({stopped:s.checked});
  // Transfers without a second approval: asked once more when it is turned on.
  const au = document.getElementById('tfAutoSet'); if(au) au.onchange = async ()=>{
    if(au.checked && !await showConfirm(esc(t('rsTfAutoAsk')), {title:t('rsTfAuto'), okLabel:t('rsTurnOn'), okClass:'btn-primary'})){ au.checked = false; return; }
    if(!(await setFeature('tfAuto', au.checked))) au.checked = !au.checked;
  };
  // Edit: a small box with the limits; Standard puts the usual ones in it, Save keeps them.
  const ed = document.getElementById('rrLimEdit'); if(ed) ed.onclick = ()=>rrEditLimits(put);
  const tgb = document.getElementById('rrTgConnect'); if(tgb) tgb.onclick = async ()=>{
    const win = window.open('', '_blank');
    const r = await api('receipts-settings/telegram', {method:'POST', body:{}});
    if(!r.ok || !r.data?.link){ win?.close(); toast(t('saveFailed'), 'error'); return; }
    if(win) win.location.href = r.data.link; else location.href = r.data.link;
    rr.tg = null;   // read again when Settings is drawn next
  };
}
async function rrEditLimits(put){
  const L = rr.data.helper.limits, STD = {bigTotal:1000000, priceJump:30, rateMin:1500, rateMax:1800};
  const field = (id, label, v)=>`<label class="rs-field"><span>${esc(label)}</span><input class="rr-input" id="${id}" inputmode="numeric" value="${v}"></label>`;
  const html = `<div class="rs-form">${field('rrLimBig', t('rrLimBig'), L.bigTotal)}${field('rrLimJump', t('rrLimJump'), L.priceJump)}${field('rrLimMin', t('rrLimRateMin'), L.rateMin)}${field('rrLimMax', t('rrLimRateMax'), L.rateMax)}
    <button type="button" class="rs-std" id="rrLimStd">${esc(t('rsStandard'))}</button></div>`;
  const shown = showConfirm(html, {title:t('rsLimits'), okLabel:t('rrLimSave'), okClass:'btn-primary', cancelLabel:t('cancel'), wide:true});
  // The boxes are kept, so their values can be read after Save closes the box.
  let els = {};
  requestAnimationFrame(()=>{
    els = Object.fromEntries(['rrLimBig', 'rrLimJump', 'rrLimMin', 'rrLimMax'].map(id=>[id, document.getElementById(id)]));
    document.getElementById('rrLimStd')?.addEventListener('click', ()=>{ els.rrLimBig.value = STD.bigTotal; els.rrLimJump.value = STD.priceJump; els.rrLimMin.value = STD.rateMin; els.rrLimMax.value = STD.rateMax; });
    els.rrLimBig?.focus();
  });
  if(!await shown) return;
  const num = id=>rrParse(els[id]?.value ?? '', false);
  const v = {bigTotal:num('rrLimBig'), priceJump:num('rrLimJump'), rateMin:num('rrLimMin'), rateMax:num('rrLimMax')};
  if(!(v.bigTotal > 0) || !(v.priceJump >= 1 && v.priceJump <= 500) || !(v.rateMin > 0) || !(v.rateMax >= v.rateMin)){ toast(t('rrLimBad'), 'error'); return; }
  put({limits:v});
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
  return `<article class="hist-card rr-hist${r.status === 'cancelled' ? ' is-off' : ''}" data-search-row data-search-text="${esc([r.supplier, r.invoice, ...r.lines.map(l=>l.item)].join(' '))}">
    <div class="hist-top"><div class="hist-date"><b>${esc(when)}</b>${stChip(r, rrIsPractice(r) ? t('rrPracticeRun') : t('rrStatus_' + r.status))}</div>
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
