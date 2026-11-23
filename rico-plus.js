/* The Rico tab's parts: the next step (for the morning briefing, his mood and his sheet on the Order
   screen), his messages, answers as receipts, and What Rico remembers. */

/* The one thing that needs the person now: late, closing soon, due today, or nothing. */
function ricoNextStep(){
  const late = ricoLateOrders();
  if(late.length){ const l = late[0]; return {supplierId:l.supplierId, title:t('nextLate')(l.name), sub:t('ricoLateSub')(formatStoredIraqTime(l.time), Math.floor(l.mins / 60), l.mins % 60), others:late.length - 1, urgent:true}; }
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
    box.innerHTML = rows.length ? rows.map(r=>`<div class="mem-rule"><span dir="auto">${esc(r.rule)}<small>${esc(r.source === 'learned' ? t('memLearned') : t('memTaught'))}${r.account && r.account !== state.account ? ' · ' + esc(accountLabel(r.account)) : ''}</small></span>${!r.account || r.account === state.account || isRozha() ? `<button type="button" class="icon-btn danger" data-mem-del="${esc(r.id)}" aria-label="${esc(t('delete'))}">${ICON_DELETE}</button>` : ''}</div>`).join('') : `<div class="empty-mini">${esc(t('memoryNone'))}</div>`;
    box.querySelectorAll('[data-mem-del]').forEach(b=>b.onclick = async ()=>{ const r = await api('rico-rules/' + b.dataset.memDel, {method:'DELETE'}); if(r.ok) load(); else toast(t('saveFailed'), 'warn'); });
  };
  const paintRoutines = rows=>{
    rbox.className = '';
    rbox.innerHTML = rows.length ? rows.map(r=>`<div class="mem-rule mem-routine${r.enabled ? '' : ' off'}"><span dir="auto">${esc(r.text)}<small>${esc(routineLabel(r))}${r.account && r.account !== state.account ? ' · ' + esc(accountLabel(r.account)) : ''}</small></span>
      ${r.runAt ? '' : `<input type="checkbox" role="switch" class="mem-switch" data-routine-on="${esc(r.id)}" ${r.enabled ? 'checked' : ''} aria-label="${esc(r.text)}">`}
      <button type="button" class="icon-btn danger" data-routine-del="${esc(r.id)}" aria-label="${esc(t('routineDelete'))}">${ICON_DELETE}</button></div>`).join('') : `<div class="empty-mini">${esc(t('routinesNone'))}</div>`;
    rbox.querySelectorAll('[data-routine-on]').forEach(b=>b.onchange = async ()=>{
      const on = b.checked; b.disabled = true;
      const r = await api('rico-routines/' + b.dataset.routineOn, {method:'PUT', body:{enabled:on}});
      b.disabled = false;
      if(!r.ok){ b.checked = !on; toast(t('saveFailed'), 'warn'); return; }
      b.closest('.mem-routine')?.classList.toggle('off', !on);
    });
    rbox.querySelectorAll('[data-routine-del]').forEach(b=>b.onclick = async ()=>{ const r = await api('rico-routines/' + b.dataset.routineDel, {method:'DELETE'}); if(r.ok) loadRoutines(); else toast(t('saveFailed'), 'warn'); });
  };
  const load = async ()=>{ const r = await apiCached('rico-rules'); if(el.isConnected){ if(r.ok) paint(r.data || []); else box.textContent = t('saveFailed'); } };
  const loadRoutines = async ()=>{ const r = await apiCached('rico-routines'); if(el.isConnected){ if(r.ok) paintRoutines(r.data || []); else rbox.textContent = t('saveFailed'); } };
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
  if(r.runAt) return `${r.kind === 'ask' ? t('schedKindAsk') : t('routineRemind')} · ${t('routineOnce')}, ${formatIraqDateTime(r.runAt, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}`;
  const days = r.days?.length === 7 ? t('routineEvery') : (r.days || []).map(d=>t('routineDays')[d]).join(state.lang === 'en' ? ', ' : '، ');
  const what = r.kind === 'ask' ? t('schedKindAsk') : r.kind === 'prepare_order' ? t('routinePrepareFor')((r.supplierIds || []).map(id=>supplierName(id) || '').filter(Boolean).join(', ') || r.suppliers?.join(', ') || '') : t('routineRemind');
  return `${what} · ${days} ${formatStoredIraqTime(r.time)}`;
}
/* Creating a schedule starts in chat. This sheet manages the saved tasks. */
function openRicoScheduled(){
  const days = t('routineDays');
  const opener = document.activeElement;
  const {el, close} = openKitchenSheet('sched-sheet', `<div class="sched-head"><div class="sel-title">${esc(t('schedTitle'))}</div><button type="button" class="btn btn-primary sched-new" data-sched-new>${esc(t('schedNew'))}</button></div>
    <div class="notif-sub">${esc(t('schedChatHint'))}</div>
    <div class="sched-list status-line" id="schedList">${esc(t('memoryLoading'))}</div>
    <form class="sched-form" hidden novalidate>
      <h3 class="sched-form-title">${esc(t('schedEdit'))}</h3>
      <div class="field"><label for="schedText">${esc(t('schedWhat'))}</label><textarea id="schedText" rows="2" maxlength="200" dir="auto"></textarea></div>
      <div id="schedDateRow" class="field" hidden><label for="schedDate">${esc(t('schedWhen'))} (YYYY-MM-DD)</label><input id="schedDate" type="text" maxlength="10" dir="ltr"></div>
      <div id="schedRepeatRow" class="field"><span>${esc(t('schedRepeat'))}</span><div class="sched-days">${days.map((d,i)=>`<label><input type="checkbox" name="schedDay" value="${i}"><span>${esc(d)}</span></label>`).join('')}</div></div>
      <div class="field"><label for="schedClock">${esc(t('schedTime'))} · ${esc(t('schedBaghdad'))}</label><input id="schedClock" dir="ltr" placeholder="10:00 PM" autocomplete="off" maxlength="14"></div>
      <div class="sched-error" role="alert"></div>
      <div class="form-actions sched-actions"><button type="button" class="btn btn-ghost" data-sched-cancel>${esc(t('schedCancel'))}</button><button type="submit" class="btn btn-primary">${esc(t('schedSave'))}</button></div>
    </form>`, t('schedTitle'), {returnFocus:opener});
  const list = el.querySelector('#schedList'), form = el.querySelector('form'), newBtn = el.querySelector('[data-sched-new]');
  const err = form.querySelector('.sched-error'), clock = form.querySelector('#schedClock'), date = form.querySelector('#schedDate'), title = form.querySelector('#schedText');
  let editing = null, loaded = [];
  const showEdit = row=>{
    editing = row;
    form.hidden = !row; list.hidden = !!row; newBtn.hidden = !!row; err.textContent = '';
    if(!row) return;
    title.value = row.text;
    date.value = row.runAt ? erbilDate(row.runAt) : '';
    const {h12, min, pm} = splitClock(row.time);
    clock.value = h12 + ':' + String(min).padStart(2,'0') + (pm ? ' PM' : ' AM');
    form.querySelector('#schedDateRow').hidden = !row.runAt;
    form.querySelector('#schedRepeatRow').hidden = !!row.runAt;
    form.querySelectorAll('[name=schedDay]').forEach(x=>{ x.checked = row.days.includes(Number(x.value)); });
    title.focus({preventScroll:true});
  };
  const paint = rows=>{
    loaded = rows;
    list.className = 'sched-list';
    list.innerHTML = rows.length ? rows.map(r=>`<div class="mem-rule mem-routine${r.enabled ? '' : ' off'}"><span><b dir="auto">${esc(r.text)}</b><small>${esc(routineLabel(r))}${r.account && r.account !== state.account ? ' · ' + esc(accountLabel(r.account)) : ''}</small></span>
      ${r.runAt ? '' : `<input type="checkbox" role="switch" class="mem-switch" data-sched-on="${esc(r.id)}" ${r.enabled ? 'checked' : ''} aria-label="${esc(r.text)}">`}
      <button type="button" class="icon-btn" data-sched-edit="${esc(r.id)}" aria-label="${esc(t('schedEdit'))}">${ICON_EDIT_ITEM}</button>
      <button type="button" class="icon-btn danger" data-sched-del="${esc(r.id)}" aria-label="${esc(t('routineDelete'))}">${ICON_DELETE}</button></div>`).join('') : `<div class="empty-mini">${esc(t('schedNone'))}</div>`;
    list.querySelectorAll('[data-sched-on]').forEach(b=>b.onchange = async ()=>{
      const on = b.checked; b.disabled = true;
      const r = await api('rico-routines/' + b.dataset.schedOn, {method:'PUT', body:{enabled:on}});
      b.disabled = false;
      if(!r.ok){ b.checked = !on; toast(t('saveFailed'), 'warn'); return; }
      b.closest('.mem-routine')?.classList.toggle('off', !on);
      haptic('selection');
    });
    list.querySelectorAll('[data-sched-edit]').forEach(b=>b.onclick = ()=>showEdit(loaded.find(x=>x.id === b.dataset.schedEdit)));
    list.querySelectorAll('[data-sched-del]').forEach(b=>b.onclick = async ()=>withBusy(b, async ()=>{
      if(!await showConfirm(esc(t('schedDeleteAsk')), {okLabel:t('delete'), okClass:'btn-danger'})) return;
      const r = await api('rico-routines/' + b.dataset.schedDel, {method:'DELETE'});
      if(r.ok) load(); else toast(t('saveFailed'), 'warn');
    }));
  };
  const load = async ()=>{ const r = await apiCached('rico-routines'); if(el.isConnected){ if(r.ok) paint(r.data || []); else list.textContent = t('saveFailed'); } };
  newBtn.onclick = ()=>{
    close();
    if(state.view !== 'assistant') goView('assistant');
    const input = document.getElementById('ricoInput');
    if(input){ input.focus({preventScroll:true}); toast(t('schedChatExample'), 'ok'); }
  };
  el.querySelector('[data-sched-cancel]').onclick = ()=>{
    const id = editing?.id; showEdit(null);
    [...list.querySelectorAll('[data-sched-edit]')].find(b=>b.dataset.schedEdit === id)?.focus();
  };
  form.onsubmit = async e=>{
    e.preventDefault();
    const row = editing, text = title.value.trim(), time = scheduleClock(clock.value);
    if(!row || !text || !time){ err.textContent = t(!text ? 'schedNeedText' : 'schedClockError'); return; }
    const body = {text};
    if(row.runAt){
      const day = date.value.trim(), at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + 'T' + time + ':00+03:00') : NaN;
      if(!Number.isFinite(at) || erbilDate(new Date(at)) !== day || at <= Date.now() || at > Date.now() + 30 * 86400_000){ err.textContent = t('schedBadWhen'); return; }
      body.runAt = new Date(at).toISOString();
    } else {
      body.time = time;
      body.days = [...form.querySelectorAll('[name=schedDay]:checked')].map(x=>Number(x.value));
      if(!body.days.length){ err.textContent = t('schedNeedDay'); return; }
    }
    await withBusy(form.querySelector('[type=submit]'), async ()=>{
      const r = await api('rico-routines/' + row.id, {method:'PUT', body});
      if(!el.isConnected || editing !== row) return;
      if(!r.ok){ err.textContent = t(r.status === 409 ? 'schedChanged' : 'saveFailed'); return; }
      toast(t('schedSaved'), 'ok'); showEdit(null); load();
    });
  };
  load();
  return close;
}
/* A typed Baghdad clock; no nested picker or guessed AM/PM. */
function scheduleClock(raw){
  const s = String(raw ?? '').trim().replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x6f0)).replace(/پ\.ن|ص$/g,'AM').replace(/د\.ن|م$/g,'PM');
  const m = s.match(/^(1[0-2]|0?[1-9])(?:\s*:\s*([0-5][0-9]))?\s*(AM|PM)$/i);
  if(!m) return null;
  return String(Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0)).padStart(2,'0') + ':' + (m[2] || '00');
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
  if(!state.account || !ricoAutoOrder() || !canOpen('order')) return;
  const today = erbilNow().date, done = new Set(ricoRoutineFilledIds());
  rico.inbox.filter(m=>m.kind === 'routine_order' && m.order?.day === today && !done.has(m.id)).forEach(m=>{
    const mine = state.items.filter(i=>i.supplierId === m.order.supplierId).some(i=>(state.cart[i.id] || 0) > 0);
    // Already sent today (perhaps from the other phone): never put it back in the draft.
    const sent = state.history.some(o=>erbilDate(o.date) === today && o.entries.some(e=>e.supplierId === m.order.supplierId));
    if(mine || sent){ ricoRoutineFilled(m.id); return; }
    ricoFillRoutineOrder(m, true);
  });
}

/* ---------- Rico on the Order screen ---------- */
function renderRicoOrderButton(){
  if(!featureOn('ricoSheet') || !canOpen('assistant')) return '';
  return ricoOrderButtonHtml();
}
function ricoOrderButtonHtml(){
  return `<button class="quick-btn" id="ricoFloat">${ricoFace('')}<span>${esc(t('sheetOpen'))}</span></button>`;
}
function ricoOrderSheetHtml(subtitle){
  return `<div class="check-head">${ricoFace('', 'rico-md')}<div><div class="sel-title">${esc(t('ricoName'))}</div><div class="notif-sub" dir="auto">${esc(subtitle)}</div></div></div>
    <form id="sheetAsk" class="mem-add"><label class="sr-only" for="sheetInput">${esc(t('sheetAsk'))}</label><input id="sheetInput" maxlength="2000" dir="auto" placeholder="${esc(t('sheetAsk'))}"><button type="submit" class="btn btn-primary">${esc(t('ricoSend'))}</button></form>`;
}
function openRicoOrderSheet(){
  const n = ricoNextStep();
  const subtitle = !cartCount() ? t('sheetEmpty') : n && !n.done ? n.title : t('sheetAskAbout');
  const {el, close} = openKitchenSheet('rico-order-sheet', ricoOrderSheetHtml(subtitle), t('ricoName'));
  el.querySelector('#sheetAsk').onsubmit = e=>{
    e.preventDefault();
    const text = el.querySelector('#sheetInput').value.trim();
    if(!text) return;
    close(); goView('assistant'); ricoAsk(text);
  };
}
/* All of Rico's messages, from the "See all" link. */
function openRicoInboxSheet(){
  const {el, close} = openKitchenSheet('inbox-sheet', `<div class="sel-title">${esc(t('inboxTitle'))}</div><div class="rico-inbox-all">${[...rico.inbox].reverse().map(m=>`<div class="rico-note">${ricoFace(m.mood, 'rico-sm')}<div class="rico-note-body"><div class="rico-note-meta">${esc(timeAgo(m.at))}</div><div class="rico-note-text">${ricoInboxHtml(m)}</div>${ricoNoteAction(m)}</div></div>`).join('') || `<div class="empty-mini">${esc(t('inboxNone'))}</div>`}</div>`, t('inboxTitle'));
  el.querySelectorAll('[data-routine-fill]').forEach(b=>b.onclick=()=>{ const m = rico.inbox.find(x=>String(x.id) === b.dataset.routineFill); close(); if(!ricoFillRoutineOrder(m)) toast(t('saveFailed'), 'warn'); });
  el.querySelectorAll('[data-routine-ask]').forEach(b=>b.onclick=()=>{ close(); goView('assistant'); ricoAskScheduled(b.dataset.routineAsk); });
}
