/* The Rico tab's parts: the next step (for the morning briefing, his mood and his sheet on the Order
   screen), his messages, answers as receipts, and What Rico remembers. */

/* The one thing that needs the person now: late, closing soon, due today, or nothing. */
function ricoNextStep(){
  const late = ricoLateOrders();
  if(late.length){ const l = late[0]; return {supplierId:l.supplierId, title:t('nextLate')(l.name), sub:t('ricoLateSub')(l.time, Math.floor(l.mins / 60), l.mins % 60), others:late.length - 1, urgent:true}; }
  if(!canOpen('order')) return null;
  const now = erbilNow();
  const unsent = state.suppliers.filter(s=>!sentTodayTo(s.id, now.date) && state.items.some(i=>i.supplierId === s.id));
  const due = unsent.filter(s=>s.reminder?.enabled && (!s.reminder.days?.length || s.reminder.days.map(Number).includes(now.weekday))).sort((a, b)=>String(a.reminder.time).localeCompare(String(b.reminder.time)))[0];
  if(due) return {supplierId:due.id, title:t('nextDue')(due.name), sub:t('nextUsualAt')(reminderTimeLabel(due.reminder.time))};
  return {done:true, title:t('nextDone'), sub:t('nextDoneSub')};
}

/* ---------- Answers worked out on this phone: no AI needed ---------- */
function ricoLocalAnswer(question, answer){
  if(rico.viewing){ rico.viewing = null; rico.messages = []; rico.chatId = null; }
  rico.messages.push({role:'user', text:question, ts:Date.now()});
  rico.messages.push({role:'assistant', ts:Date.now(), steps:[], proposals:[], ...answer});
  ricoSaveSoon();
  render();
  ricoScroll(true);
}
function ricoAnswerLastOrder(question){
  const last = [...state.history].sort((a, b)=>Date.parse(b.date) - Date.parse(a.date))[0];
  if(!last) return ricoLocalAnswer(question, {text:t('receiptNone'), mood:'calm'});
  ricoLocalAnswer(question, {text:t('receiptIntro'), mood:'happy', receipt:{at:last.date, by:last.by, entries:(last.entries || []).map(e=>({supplierId:e.supplierId, supplierName:e.supplierName, items:(e.items || []).map(it=>({itemId:it.itemId, name:it.name, qty:it.qty, unit:it.unit}))}))}});
}
function renderRicoReceipt(m, i){
  const r = m.receipt;
  if(!r) return '';
  return `<div class="rico-receipts">${r.entries.map(e=>`<div class="rico-receipt"><div class="p-eyebrow" dir="auto">${esc(e.supplierId ? supplierName(e.supplierId) : (e.supplierName || t('noSupplier')))}</div><b>${esc(formatIraqDateTime(r.at, {weekday:'long', day:'numeric', month:'long'}))}</b>${e.items.map(it=>`<div class="rico-receipt-line"><span dir="auto">${esc(it.name)}</span><b>${esc(String(it.qty))} ${esc(unitLabel(it.unit))}</b></div>`).join('')}</div>`).join('')}<div class="rico-card-actions"><button type="button" class="btn btn-primary" data-receipt-same="${i}">${esc(t('receiptSame'))}</button></div></div>`;
}
function ricoReceiptToCart(m){
  const before = {...state.cart};
  m.receipt.entries.forEach(e=>e.items.forEach(it=>{ if(state.items.some(x=>x.id === it.itemId && x.available !== false)) state.cart[it.itemId] = Number(it.qty); }));
  persistCartDraft();
  goView('order');
  toast(t('reorderReady')(cartCount()), 'ok', {undo:()=>{ state.cart = before; persistCartDraft(); if(state.view === 'order') refreshOrderView(); }});
}
/* ---------- What Rico remembers ----------
   Two short lists. Memories: what you taught Rico and what he learned while you chatted (each can be
   deleted; you can add one here too). Routines: reminders and orders he prepares by himself at a time,
   made by asking him in the chat; each can be switched off or deleted here. */
async function openRicoMemory(){
  const {el, close} = openKitchenSheet('memory-sheet', `<div class="sel-title">${esc(t('memoryTitle'))}</div><div class="notif-sub">${esc(t('memoryHint'))}</div>
    <div class="report-sec"><div class="report-sec-title">${esc(t('memoryRules'))}</div><div id="memRules" class="status-line">${esc(t('memoryLoading'))}</div>
    <form id="memAdd" class="mem-add"><label class="sr-only" for="memRule">${esc(t('memoryAddLabel'))}</label><input id="memRule" maxlength="300" dir="auto" placeholder="${esc(t('memoryAddHint'))}"><button class="btn btn-primary" type="submit">${esc(t('memoryAdd'))}</button></form></div>
    <div class="report-sec"><div class="report-sec-title">${esc(t('routinesTitle'))}</div><div id="memRoutines" class="status-line">${esc(t('memoryLoading'))}</div><div class="mem-hint">${esc(t('routinesHint'))}</div></div>`, t('memoryTitle'));
  const box = el.querySelector('#memRules'), rbox = el.querySelector('#memRoutines');
  const paint = rows=>{
    box.className = '';
    box.innerHTML = rows.length ? rows.map(r=>`<div class="mem-rule"><span dir="auto">${esc(r.rule)}<small>${esc(r.source === 'learned' ? t('memLearned') : t('memTaught'))}${r.account && r.account !== state.account ? ' · ' + esc(accountLabel(r.account)) : ''}</small></span><button type="button" class="icon-btn" data-mem-del="${esc(r.id)}" aria-label="${esc(t('delete'))}">${ICON_DELETE}</button></div>`).join('') : `<div class="empty-mini">${esc(t('memoryNone'))}</div>`;
    box.querySelectorAll('[data-mem-del]').forEach(b=>b.onclick = async ()=>{ const r = await api('rico-rules/' + b.dataset.memDel, {method:'DELETE'}); if(r.ok) load(); else toast(t('saveFailed'), 'warn'); });
  };
  const paintRoutines = rows=>{
    rbox.className = '';
    rbox.innerHTML = rows.length ? rows.map(r=>`<div class="mem-rule mem-routine${r.enabled ? '' : ' off'}"><span dir="auto">${esc(r.text)}<small>${esc(routineLabel(r))}</small></span>
      ${r.runAt ? '' : `<input type="checkbox" role="switch" class="mem-switch" data-routine-on="${esc(r.id)}" ${r.enabled ? 'checked' : ''} aria-label="${esc(r.text)}">`}
      <button type="button" class="icon-btn" data-routine-del="${esc(r.id)}" aria-label="${esc(t('routineDelete'))}">${ICON_DELETE}</button></div>`).join('') : `<div class="empty-mini">${esc(t('routinesNone'))}</div>`;
    rbox.querySelectorAll('[data-routine-on]').forEach(b=>b.onchange = async ()=>{
      const on = b.checked; b.disabled = true;
      const r = await api('rico-routines/' + b.dataset.routineOn, {method:'PUT', body:{enabled:on}});
      b.disabled = false;
      if(!r.ok){ b.checked = !on; toast(t('saveFailed'), 'warn'); return; }
      b.closest('.mem-routine')?.classList.toggle('off', !on);
    });
    rbox.querySelectorAll('[data-routine-del]').forEach(b=>b.onclick = async ()=>{ const r = await api('rico-routines/' + b.dataset.routineDel, {method:'DELETE'}); if(r.ok) loadRoutines(); else toast(t('saveFailed'), 'warn'); });
  };
  const load = async ()=>{ const r = await api('rico-rules'); if(el.isConnected){ if(r.ok) paint(r.data || []); else box.textContent = t('saveFailed'); } };
  const loadRoutines = async ()=>{ const r = await api('rico-routines'); if(el.isConnected){ if(r.ok) paintRoutines(r.data || []); else rbox.textContent = t('saveFailed'); } };
  el.querySelector('#memAdd').onsubmit = async e=>{
    e.preventDefault();
    const input = el.querySelector('#memRule'), rule = input.value.trim();
    if(!rule) return;
    const r = await api('rico-rules', {method:'POST', body:{rule}});
    if(!r.ok){ toast(t(r.data?.error === 'secret' ? 'memSecret' : r.status === 409 ? 'memTooMany' : 'saveFailed'), 'warn'); return; }
    input.value = ''; load();
  };
  load(); loadRoutines();
  return close;
}
/* "Reminder · Every day 09:00", "Prepares the order for Dairy Co · Sun, Mon 07:00", "Reminder · Once, Nov 14, 2:05 PM". */
function routineLabel(r){
  if(r.runAt) return `${t('routineRemind')} · ${t('routineOnce')}, ${formatIraqDateTime(r.runAt, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}`;
  const days = r.days?.length === 7 ? t('routineEvery') : (r.days || []).map(d=>t('routineDays')[d]).join(', ');
  const what = r.kind === 'prepare_order' ? t('routinePrepareFor')((r.supplierIds || []).map(id=>supplierName(id) || '').filter(Boolean).join(', ') || r.suppliers?.join(', ') || '') : t('routineRemind');
  return `${what} · ${days} ${r.time}`;
}
/* A prepared order from a routine (in Rico's messages): its lines go into today's order on a tap, for
   that supplier only; nothing else in the order changes. Undo puts it back. Never sent by itself. */
function ricoFillRoutineOrder(m, auto = false){
  const o = m && m.order;
  if(!o || !Array.isArray(o.lines)) return false;
  const before = {...state.cart};
  let n = 0;
  o.lines.forEach(l=>{ if(state.items.some(i=>i.id === l.itemId && i.available !== false) && validOrderQuantity(Number(l.qty))){ state.cart[l.itemId] = roundQuantity(Number(l.qty)); n++; } });
  if(!n) return false;
  persistCartDraft();
  ricoRoutineFilled(m.id);
  if(!auto){ if(state.suppliers.some(s=>s.id === o.supplierId)) state.orderTab = o.supplierId; goView('order'); }
  else if(state.view === 'order') refreshOrderView();
  toast(auto ? t('routineAutoFilled')(o.supplier || supplierName(o.supplierId) || '') : t('routineFilled')(n, o.supplier || supplierName(o.supplierId) || ''), 'ok',
    {undo:()=>{ state.cart = before; persistCartDraft(); if(state.view === 'order') refreshOrderView(); }});
  return true;
}
const ricoRoutineFilledIds = ()=>{ const v = lget('ricoRoutineFilled:' + state.account); return Array.isArray(v) ? v : []; };
function ricoRoutineFilled(id){ lset('ricoRoutineFilled:' + state.account, [...new Set([...ricoRoutineFilledIds(), id])].slice(-40)); }
/* With "Let Rico fill my order" on, today's prepared orders go into the order by themselves (once each,
   and never over amounts already in the order for that supplier). Otherwise they wait for a tap. */
function ricoAutoFillRoutines(){
  if(!state.account || !ricoAutoOrder()) return;
  const today = erbilNow().date, done = new Set(ricoRoutineFilledIds());
  rico.inbox.filter(m=>m.kind === 'routine_order' && m.order?.day === today && !done.has(m.id)).forEach(m=>{
    const mine = state.items.filter(i=>i.supplierId === m.order.supplierId).some(i=>(state.cart[i.id] || 0) > 0);
    if(mine){ ricoRoutineFilled(m.id); return; }
    ricoFillRoutineOrder(m, true);
  });
}

/* ---------- Rico on the Order screen ---------- */
function renderRicoOrderButton(){
  if(!featureOn('ricoSheet') || !canOpen('assistant')) return '';
  return `<button class="quick-btn" id="ricoFloat">${ricoFace('')}<span>${esc(t('sheetOpen'))}</span></button>`;
}
function openRicoOrderSheet(){
  const n = ricoNextStep();
  const {el, close} = openKitchenSheet('rico-order-sheet', `<div class="check-head">${ricoFace('', 'rico-md')}<div><div class="sel-title">${esc(t('ricoName'))}</div><div class="notif-sub" dir="auto">${esc(!cartCount() ? t('sheetEmpty') : n && !n.done ? n.title : t('sheetAskAbout'))}</div></div></div>
    <form id="sheetAsk" class="mem-add"><label class="sr-only" for="sheetInput">${esc(t('sheetAsk'))}</label><input id="sheetInput" maxlength="2000" dir="auto" placeholder="${esc(t('sheetAsk'))}"><button type="submit" class="btn btn-primary">${esc(t('ricoSend'))}</button></form>`, t('ricoName'));
  el.querySelector('#sheetAsk').onsubmit = e=>{
    e.preventDefault();
    const text = el.querySelector('#sheetInput').value.trim();
    if(!text) return;
    close(); goView('assistant'); ricoAsk(text);
  };
}
/* All of Rico's messages, from the "See all" link. */
function openRicoInboxSheet(){
  const {el, close} = openKitchenSheet('inbox-sheet', `<div class="sel-title">${esc(t('inboxTitle'))}</div><div class="rico-inbox-all">${[...rico.inbox].reverse().map(m=>`<div class="rico-note mood-tint-${esc(m.mood)}">${ricoFace(m.mood, 'rico-sm')}<div class="rico-note-body"><div class="rico-note-meta">${esc(timeAgo(m.at))}</div><div class="rico-note-text" dir="auto">${esc(ricoInboxText(m))}</div>${ricoNoteAction(m)}</div></div>`).join('') || `<div class="empty-mini">${esc(t('inboxNone'))}</div>`}</div>`, t('inboxTitle'));
  el.querySelectorAll('[data-routine-fill]').forEach(b=>b.onclick=()=>{ const m = rico.inbox.find(x=>String(x.id) === b.dataset.routineFill); close(); if(!ricoFillRoutineOrder(m)) toast(t('saveFailed'), 'warn'); });
}
