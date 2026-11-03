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
const usualSupplierCount = sid=>{
  const last = [...state.history].sort((a, b)=>Date.parse(b.date) - Date.parse(a.date)).flatMap(o=>o.entries || []).find(e=>e.supplierId === sid);
  return last ? (last.items || []).length : 0;
};
/* What the kitchen's state says about Rico's face. */
function kitchenMood(){
  if(!featureOn('ricoMood') || !canOpen('order') || !state.account) return 'happy';
  if(ricoLateOrders().length) return 'worried';
  const n = ricoNextStep();
  return n?.urgent ? 'worried' : n?.done ? 'happy' : 'calm';
}

/* ---------- Morning briefing ---------- */
function briefingCards(){
  const cards = [], now = erbilNow(), n = ricoNextStep();
  if(n) cards.push({mood:n.urgent ? 'worried' : 'happy', label:t('briefToday'), title:n.title, sub:n.sub, supplierId:n.done ? null : n.supplierId});
  const busy = busyToday();
  if(Math.abs(busy) >= 20) cards.push({mood:busy > 0 ? 'excited' : 'calm', label:t('briefBusy'), title:busy > 0 ? t('briefBusier')(busy) : t('briefQuieter')(-busy), sub:t('briefBusySub')});
  const unread = rico.inbox.filter(m=>!m.read).slice(-1)[0];
  if(unread) cards.push({mood:unread.mood || 'happy', label:t('briefNote'), title:ricoInboxText(unread)});
  const s = state.streak?.count || 0;
  if(s >= 3) cards.push({mood:'excited', label:t('briefStreak'), title:t('briefStreakTitle')(s), sub:t('briefStreakSub')});
  return now ? cards : [];
}
const briefingKey = ()=>'ricoBriefing:' + state.account;
function briefingDue(){
  if(!featureOn('ricoBriefing') || rico.messages.length || rico.viewing) return false;
  const h = +new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Baghdad', hour:'2-digit', hourCycle:'h23'}).format(new Date());
  return h >= 5 && h < 12 && lget(briefingKey()) !== BAGHDAD_DAY.format(new Date()) && briefingCards().length > 0;
}
function renderBriefing(){
  const cards = briefingCards();
  return `<section class="rico-brief" aria-label="${esc(t('briefTitle'))}"><div class="rico-brief-top"><div class="rico-hello">${esc(ricoGreeting())}</div><button type="button" class="rico-link" id="briefSkip">${esc(t('briefSkip'))}</button></div>
    <div class="rico-brief-cards">${cards.map((c, i)=>`<article class="rico-brief-card">${ricoFace(c.mood, 'rico-md')}<div class="p-eyebrow">${i + 1} / ${cards.length} · ${esc(c.label)}</div><div class="rico-brief-title" dir="auto">${esc(c.title)}</div>${c.sub ? `<div class="notif-sub" dir="auto">${esc(c.sub)}</div>` : ''}${c.supplierId ? `<button type="button" class="btn btn-primary" data-rico-late="${esc(c.supplierId)}">${esc(t('ricoPrepareIt'))}</button>` : ''}</article>`).join('')}</div>
    <button type="button" class="btn btn-ghost" id="briefDone">${esc(t('briefDone'))}</button></section>`;
}
function attachBriefing(root){
  const end = ()=>{ lset(briefingKey(), BAGHDAD_DAY.format(new Date())); render(); };
  root.querySelector('#briefSkip')?.addEventListener('click', end);
  root.querySelector('#briefDone')?.addEventListener('click', end);
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
/* ---------- What Rico remembers ---------- */
async function openRicoMemory(){
  const {el, close} = openKitchenSheet('memory-sheet', `<div class="sel-title">${esc(t('memoryTitle'))}</div><div class="notif-sub">${esc(t('memoryHint'))}</div>
    <div class="report-sec"><div class="report-sec-title">${esc(t('memoryRules'))}</div><div id="memRules" class="status-line">${esc(t('memoryLoading'))}</div>
    <form id="memAdd" class="mem-add"><label class="sr-only" for="memRule">${esc(t('memoryAddLabel'))}</label><input id="memRule" maxlength="300" dir="auto" placeholder="${esc(t('memoryAddHint'))}"><button class="btn btn-primary" type="submit">${esc(t('memoryAdd'))}</button></form></div>
    <div class="report-sec"><div class="report-sec-title">${esc(t('memoryUsual'))}</div>${memoryUsualHtml()}</div>`, t('memoryTitle'));
  const box = el.querySelector('#memRules');
  const paint = rows=>{
    box.className = '';
    box.innerHTML = rows.length ? rows.map(r=>`<div class="mem-rule"><span dir="auto">${esc(r.rule)}</span><button type="button" class="icon-btn" data-mem-del="${esc(r.id)}" aria-label="${esc(t('delete'))}">${ICON_DELETE}</button></div>`).join('') : `<div class="empty-mini">${esc(t('memoryNone'))}</div>`;
    box.querySelectorAll('[data-mem-del]').forEach(b=>b.onclick = async ()=>{ const r = await api('rico-rules/' + b.dataset.memDel, {method:'DELETE'}); if(r.ok) load(); else toast(t('saveFailed'), 'warn'); });
  };
  const load = async ()=>{ const r = await api('rico-rules'); if(el.isConnected){ if(r.ok) paint(r.data || []); else box.textContent = t('saveFailed'); } };
  el.querySelector('#memAdd').onsubmit = async e=>{
    e.preventDefault();
    const input = el.querySelector('#memRule'), rule = input.value.trim();
    if(!rule) return;
    const r = await api('rico-rules', {method:'POST', body:{rule}});
    if(!r.ok){ toast(t('saveFailed'), 'warn'); return; }
    input.value = ''; load();
  };
  load();
  return close;
}
function memoryUsualHtml(){
  const counts = new Map();
  state.history.forEach(o=>(o.entries || []).forEach(e=>(e.items || []).forEach(it=>counts.set(it.itemId, (counts.get(it.itemId) || 0) + 1))));
  const rows = [...counts].sort((a, b)=>b[1] - a[1]).slice(0, 8).map(([id])=>state.items.find(i=>i.id === id)).filter(Boolean);
  if(!rows.length) return `<div class="empty-mini">${esc(t('memoryNoOrders'))}</div>`;
  return rows.map(i=>`<div class="trend-row"><span dir="auto">${esc(i.name)}</span><b>${usualAmount(i.id)} ${esc(unitLabel(i.unit))}</b></div>`).join('');
}

/* ---------- Rico on the Order screen ---------- */
function renderRicoOrderButton(){
  if(!featureOn('ricoSheet') || !canOpen('assistant')) return '';
  return `<button class="quick-btn" id="ricoFloat">${ricoFace(kitchenMood())}<span>${esc(t('sheetOpen'))}</span></button>`;
}
function openRicoOrderSheet(){
  const n = ricoNextStep();
  const {el, close} = openKitchenSheet('rico-order-sheet', `<div class="check-head">${ricoFace(kitchenMood(), 'rico-md')}<div><div class="sel-title">${esc(t('ricoName'))}</div><div class="notif-sub" dir="auto">${esc(!cartCount() ? t('sheetEmpty') : n && !n.done ? n.title : t('sheetAskAbout'))}</div></div></div>
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
  openKitchenSheet('inbox-sheet', `<div class="sel-title">${esc(t('inboxTitle'))}</div><div class="rico-inbox-all">${[...rico.inbox].reverse().map(m=>`<div class="rico-note mood-tint-${esc(m.mood)}">${ricoFace(m.mood, 'rico-sm')}<div class="rico-note-body"><div class="rico-note-meta">${esc(timeAgo(m.at))}</div><div class="rico-note-text" dir="auto">${esc(ricoInboxText(m))}</div></div></div>`).join('') || `<div class="empty-mini">${esc(t('inboxNone'))}</div>`}</div>`, t('inboxTitle'));
}
