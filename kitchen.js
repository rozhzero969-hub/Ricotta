/* Ricotta Orders -- the kitchen's shared things.
   - The kitchen streak: one fire for the whole kitchen. Every Baghdad day
     with at least one sent order adds a day; it stays grey until today's
     first order, then lights up. A whole day with no order puts it out, and
     Rico can bring it back (free, for 7 days). The fire changes colour as it
     grows, and milestones (7, 14, 30, 60, 100, 200...) get a celebration.
   - Kitchen notes: Rozha leaves notes for Yunis. Yunis gets a notification,
     a sticky note at the top of the Order screen and a banner when one
     arrives while the app is open; he marks them done, Rozha sees it.
   - Rico's monthly report card in History, with "Save this month" (an Excel
     file and a printable report) before History is cleared.
   - Rico's fun facts from this month's orders.
   - Undo: whoever sent an order can take it back for 15 minutes.
   The server keeps all of it (streak, notes); this file only shows it.
   Depends on (runtime only): state, t, esc, api, render, goView, toast,
   showConfirm, showAlert, ricoFace, ricoAsk, formatIraqDateTime, timeAgo,
   accountLabel, unitLabel, supplierName, isRozha, seasonSparkle, playSeasonTones. */

/* ---------- The streak ---------- */
const STREAK_GOALS = [7,14,30,60,100,150,200,300,365,500,1000];
/* The fire's colour by length: ember, flame, blaze, violet, blue, gold. */
function streakTier(n){ return n >= 200 ? 'gold' : n >= 100 ? 'blue' : n >= 60 ? 'violet' : n >= 30 ? 'blaze' : n >= 7 ? 'flame' : 'ember'; }
const FLAME_SVG = `<svg class="flame" viewBox="0 0 24 30" aria-hidden="true"><defs><linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="var(--f1)"/><stop offset="1" stop-color="var(--f2)"/></linearGradient></defs><path class="flame-out" d="M12 1C13 7 19 10 20.5 16.5C22.2 24 17.5 29 12 29S1.8 24 3.5 17.5C4.5 13.6 7.2 12 7.6 8.4C9.8 10 10.6 12 10.4 14.2C12.8 11.6 13.4 6.2 12 1Z" fill="url(#flameGrad)"/><path class="flame-in" d="M12 14C12.8 17 16 18.6 16 22.4C16 25.4 14.2 27.4 12 27.4S8 25.4 8 22.8C8 20.2 10.2 19.4 10.6 17.2C11.4 18 11.9 18.8 11.9 20C13 18.5 12.8 16 12 14Z" fill="var(--f3)"/></svg>`;
function streakNow(){ return state.streak || {count:0, best:0, lit:false, alive:false, recoverable:0}; }
function renderStreakChip(){
  const s = streakNow();
  const n = s.count;
  return `<button type="button" class="chip streak-chip tier-${streakTier(n)}${s.lit ? ' lit' : ''}${!n && s.recoverable ? ' broken' : ''}" id="streakChip" aria-label="${esc(t('streakChip')(n))}">${FLAME_SVG}<b>${n}</b></button>`;
}
function paintStreakChip(pop){
  const old = document.getElementById('streakChip');
  if(!old) return;
  old.outerHTML = renderStreakChip();
  const chip = document.getElementById('streakChip');
  chip.onclick = openStreakSheet;
  if(pop && !matchMedia('(prefers-reduced-motion: reduce)').matches){ chip.classList.add('ignite'); setTimeout(()=>chip.classList.remove('ignite'), 1200); }
}
function nextGoal(n){ return STREAK_GOALS.find(g=>g > n) || (Math.floor(n / 100) + 1) * 100; }
/* A bottom sheet in the app's own style. Returns {el, close}. */
function openKitchenSheet(cls, html, label){
  closeSelSheet();
  document.activeElement?.blur?.();
  const wrap = document.createElement('div');
  wrap.className = 'sel-sheet kitchen-sheet ' + cls;
  wrap.innerHTML = `<div class="sel-scrim"></div><div class="sel-panel" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="sel-grab"></div>${html}</div>`;
  document.body.appendChild(wrap);
  let closed = false;
  const close = ()=>{
    if(closed) return; closed = true;
    if(activeSelSheet === close) activeSelSheet = null;
    wrap.classList.add('out'); wrap.inert = true;
    document.removeEventListener('keydown', onKey, true);
    setTimeout(()=>wrap.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
  };
  activeSelSheet = close;
  const onKey = e=>{ if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.sel-scrim').onclick = close;
  return {el:wrap, close};
}
function openStreakSheet(){
  const s = streakNow(), n = s.count, goal = nextGoal(n);
  const status = n ? (s.lit ? t('streakLit') : t('streakNotYet')) : s.recoverable ? t('streakBroken')(s.recoverable) : t('streakNone');
  const prev = [0, ...STREAK_GOALS].filter(g=>g <= n).pop() || 0;
  const pct = Math.max(4, Math.min(100, Math.round((n - prev) / (goal - prev) * 100)));
  const fact = funFact();
  const {el, close} = openKitchenSheet('streak-sheet', `
    <div class="streak-hero tier-${streakTier(n)}${s.lit ? ' lit' : ''}">
      <div class="streak-big">${FLAME_SVG}</div>
      <div class="streak-num">${n}</div><div class="streak-unit">${esc(t('streakDays')(n).replace(/^\d+\s*/, ''))}</div>
      <div class="streak-status">${esc(status)}</div>
    </div>
    <div class="streak-goal"><div class="streak-goal-row"><span>${esc(t('streakNext')(goal))}</span><span>${esc(t('streakBest')(Math.max(s.best, n)))}</span></div><div class="streak-bar"><i style="width:${pct}%"></i></div></div>
    ${!n && s.recoverable ? `<button type="button" class="btn btn-primary streak-rico" data-streak-rico>${ricoFace('worried', 'rico-xs')}<span>${esc(t('streakAskRico'))}</span></button>` : ''}
    <p class="streak-how">${esc(t('streakHow'))}</p>
    ${fact ? `<div class="fun-fact">${ricoFace('excited', 'rico-sm')}<div><b>${esc(t('funFactTitle'))}</b><span dir="auto">${esc(fact)}</span></div></div>` : ''}`, t('streakTitle'));
  el.querySelector('[data-streak-rico]')?.addEventListener('click', ()=>{ close(); ricoAsk(t('streakAskRico')); });
}
/* After an order is saved (or undone): take the server's streak, and celebrate a new day or a milestone. */
async function refreshStreak({celebrate = false} = {}){
  const r = await api('streak');
  if(!r.ok || !r.data) return;
  const before = streakNow();
  state.streak = r.data;
  paintStreakChip(celebrate && r.data.lit && !before.lit);
  if(celebrate && r.data.count > before.count && STREAK_GOALS.includes(r.data.count)) streakMilestone(r.data.count);
}
function streakMilestone(n){
  document.getElementById('streakBoom')?.remove();
  const el = document.createElement('div');
  el.id = 'streakBoom'; el.className = 'streak-boom tier-' + streakTier(n); el.setAttribute('role', 'status');
  el.innerHTML = `<div class="streak-boom-card"><div class="streak-big">${FLAME_SVG}</div><div class="streak-boom-title">${esc(t('streakMilestone')(n))}</div><div class="streak-boom-sub">${ricoFace('excited', 'rico-sm')}<span>${esc(t('streakMilestoneSub'))}</span></div></div>`;
  document.body.appendChild(el);
  try{ if(soundOn('sent')) playSeasonTones([[523,0,.25],[659,.12,.25],[784,.24,.25],[1046,.36,.35],[1318,.5,.7]], .13); }catch(_){}
  if(typeof seasonSparkle === 'function') for(let i = 0; i < 5; i++) setTimeout(()=>seasonSparkle(currentThemeForFx(), innerWidth/2 + (Math.random()-.5)*160, innerHeight*.42, 10, 150), i*140);
  const close = ()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 400); };
  el.onclick = close;
  setTimeout(close, 4200);
}
/* Sparkles need a theme that has them; outside a holiday the gold stars of Eid look right. */
function currentThemeForFx(){ const th = currentTheme(); return typeof SEASON_BITS !== 'undefined' && SEASON_BITS[th] ? th : 'eid'; }

/* ---------- Rico's fun facts (this month's orders) ---------- */
function monthLines(){
  const lines = [];
  state.history.forEach(h=>(h.entries||[]).forEach(e=>(e.items||[]).forEach(it=>lines.push({...it, supplierId:e.supplierId, supplierName:e.supplierName, date:h.date, by:h.by}))));
  return lines;
}
function itemTally(){
  const by = new Map();
  monthLines().forEach(l=>{
    const k = l.itemId || l.name;
    const x = by.get(k) || {name:l.name, unit:l.unit, times:0, qty:0};
    x.times++; x.qty += Number(l.qty) || 0;
    by.set(k, x);
  });
  return [...by.values()].sort((a, b)=>b.times - a.times || b.qty - a.qty);
}
function weekdayName(d){ return formatIraqDateTime(new Date(Date.UTC(2026, 0, 4 + d, 9)), {weekday:'long'}); }
function busiestWeekday(){
  const n = [0,0,0,0,0,0,0];
  state.history.forEach(h=>{ n[new Date(new Date(h.date).getTime() + 3*3600_000).getUTCDay()]++; });
  const max = Math.max(...n);
  return max ? n.indexOf(max) : -1;
}
function funFact(){
  const tally = itemTally();
  if(!tally.length) return '';
  const facts = [];
  if(tally[0].times >= 2) facts.push(t('factTop')(tally[0].name, tally[0].times));
  const once = tally.filter(x=>x.times === 1);
  if(once.length) facts.push(t('factLeast')(once[Math.floor(Math.random()*once.length)].name));
  const heavy = tally.filter(x=>x.qty >= 5);
  if(heavy.length){ const x = heavy[Math.floor(Math.random()*heavy.length)]; facts.push(t('factQty')(Math.round(x.qty*10)/10, unitLabel(x.unit), x.name)); }
  const day = busiestWeekday();
  if(day >= 0 && state.history.length >= 4) facts.push(t('factBusiest')(weekdayName(day)));
  if(state.history.length >= 3) facts.push(t('factOrders')(state.history.length));
  return facts[Math.floor(Math.random() * facts.length)] || '';
}

/* ---------- Kitchen notes ---------- */
const notesNow = () => Array.isArray(state.notes) ? state.notes : [];
const unreadNotes = () => isRozha() ? [] : notesNow().filter(n=>!n.readAt);
function renderNotesBell(){
  const unread = unreadNotes().length;
  return `<button type="button" class="chip notes-bell${unread ? ' has-new' : ''}" id="notesBell" aria-label="${esc(t('notesTitle'))}${unread ? ' · ' + esc(t('notesUnread')(unread)) : ''}">${ICON_NOTE}${unread ? `<b>${unread}</b>` : ''}</button>`;
}
function paintNotesBell(){
  const old = document.getElementById('notesBell');
  if(!old) return;
  old.outerHTML = renderNotesBell();
  document.getElementById('notesBell').onclick = openNotesSheet;
}
/* Yunis: a sticky note at the top of the Order screen while a note is unread. */
function renderNoteSticky(){
  if(isRozha()) return '';
  const unread = unreadNotes();
  if(!unread.length) return '';
  const n = unread[0];
  return `<div class="note-sticky" id="noteSticky" role="status">
    <i class="note-tape" aria-hidden="true"></i>
    <div class="note-sticky-top"><span class="note-from">${esc(t('notesFromRozha'))}</span><span class="note-when">${esc(timeAgo(n.at))}</span>${unread.length > 1 ? `<span class="note-more">+${unread.length - 1}</span>` : ''}</div>
    <div class="note-text" dir="auto">${esc(n.body)}</div>
    <div class="note-actions"><button type="button" class="btn btn-primary" data-note-done="${n.id}">${ICON_CHECK_SM} ${esc(t('notesMarkDone'))}</button><button type="button" class="btn btn-ghost" data-note-open>${esc(t('notesOpen'))}</button></div>
  </div>`;
}
function attachNoteSticky(){
  document.querySelectorAll('#noteSticky [data-note-done]').forEach(b=>b.onclick=()=>withBusy(b, ()=>setNoteDone(Number(b.dataset.noteDone), true)));
  document.querySelector('#noteSticky [data-note-open]')?.addEventListener('click', openNotesSheet);
}
async function markNotesRead(){
  const unread = unreadNotes();
  if(!unread.length) return;
  const now = new Date().toISOString();
  unread.forEach(n=>{ n.readAt = now; });
  paintNotesBell();
  await Promise.all(unread.map(n=>api(`notes/${n.id}/read`, {method:'POST'})));
}
async function setNoteDone(id, done){
  const n = notesNow().find(x=>x.id === id);
  if(!n) return;
  const r = await api(`notes/${id}/done`, {method:'POST', body:{done}});
  if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
  n.doneAt = done ? new Date().toISOString() : null;
  n.readAt = n.readAt || new Date().toISOString();
  paintNotesBell();
  if(state.view === 'order'){ const st = document.getElementById('noteSticky'); if(st){ st.classList.add('out'); setTimeout(()=>render(), 260); } }
  if(document.querySelector('.notes-sheet')) paintNotesList();
}
function noteRow(n){
  const rozha = isRozha();
  const seen = n.doneAt ? `<span class="note-state done">${ICON_CHECK_SM} ${esc(t('notesDone'))} · ${esc(timeAgo(n.doneAt))}</span>`
    : n.readAt ? `<span class="note-state seen">${esc(t('notesSeen')(timeAgo(n.readAt)))}</span>` : `<span class="note-state">${esc(t('notesNotSeen'))}</span>`;
  return `<div class="note-row${n.doneAt ? ' is-done' : ''}">
    <div class="note-row-body"><div class="note-text" dir="auto">${esc(n.body)}</div><div class="note-meta"><span>${esc(timeAgo(n.at))}</span>${seen}</div></div>
    ${rozha ? `<button type="button" class="icon-btn danger" data-note-del="${n.id}" aria-label="${esc(t('notesDelete'))}">${ICON_DELETE}</button>`
      : `<button type="button" class="btn ${n.doneAt ? 'btn-ghost' : 'btn-primary'} note-done-btn" data-note-toggle="${n.id}">${n.doneAt ? esc(t('notesNotDone')) : esc(t('notesMarkDone'))}</button>`}
  </div>`;
}
function paintNotesList(){
  const list = document.querySelector('.notes-sheet .notes-list');
  if(!list) return;
  const notes = notesNow();
  list.innerHTML = notes.length ? notes.map(noteRow).join('') : `<div class="field-hint notes-empty">${esc(isRozha() ? t('notesEmptyRozha') : t('notesEmptyYunis'))}</div>`;
  list.querySelectorAll('[data-note-toggle]').forEach(b=>b.onclick=()=>{ const n = notesNow().find(x=>x.id === Number(b.dataset.noteToggle)); withBusy(b, ()=>setNoteDone(n.id, !n.doneAt)); });
  list.querySelectorAll('[data-note-del]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('notesDelete') + '?'))) return;
    const id = Number(b.dataset.noteDel);
    const r = await api(`notes/${id}`, {method:'DELETE'});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    state.notes = notesNow().filter(x=>x.id !== id);
    paintNotesList();
  });
}
function openNotesSheet(){
  const rozha = isRozha();
  const {el} = openKitchenSheet('notes-sheet', `
    <div class="notes-head">${ricoFace('thinking', 'rico-sm')}<div><div class="sel-title">${esc(t('notesTitle'))}</div><div class="notes-sub">${esc(rozha ? t('notesForYunis') : t('notesFromRozha'))}</div></div></div>
    ${rozha ? `<form class="notes-compose" id="notesCompose"><textarea id="noteInput" rows="2" maxlength="500" placeholder="${esc(t('notesPlaceholder'))}" dir="auto"></textarea><button type="submit" class="btn btn-primary" id="noteSend">${ICON_SEND} ${esc(t('notesSend'))}</button></form>` : ''}
    <div class="sel-list notes-list"></div>`, t('notesTitle'));
  paintNotesList();
  if(!rozha) markNotesRead();
  const form = el.querySelector('#notesCompose');
  if(form) form.onsubmit = e=>{
    e.preventDefault();
    const input = el.querySelector('#noteInput'), body = input.value.trim();
    if(!body) return;
    withBusy(el.querySelector('#noteSend'), async ()=>{
      const r = await api('notes', {method:'POST', body:{body}});
      if(!r.ok || !r.data){ toast(t('saveFailed'), 'error'); return; }
      state.notes = [r.data, ...notesNow()];
      input.value = '';
      paintNotesList();
      toast(t('notesSent'));
    });
  };
}
/* A note arrived while the app is open: a banner slides down (Yunis only). */
function noteArrived(n){
  document.getElementById('noteBanner')?.remove();
  const el = document.createElement('button');
  el.type = 'button'; el.id = 'noteBanner'; el.className = 'note-banner';
  el.innerHTML = `<span class="note-banner-icon">${ICON_NOTE}</span><span class="note-banner-text"><b>${esc(t('notesNew'))}</b><span dir="auto">${esc(n.body)}</span></span>`;
  document.body.appendChild(el);
  try{ if(soundOn('sent')) playSeasonTones([[880,0,.18],[1175,.12,.3]], .1); }catch(_){}
  const close = ()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 300); };
  el.onclick = ()=>{ close(); openNotesSheet(); };
  setTimeout(close, 7000);
}
/* Called after every load of the server's data: new notes for Yunis get the banner. */
let notesLoadedFor = null;   // the account whose notes are already on screen (no banner for the first load)
function syncNotes(list){
  if(!Array.isArray(list)) return;
  const known = new Set(notesNow().map(n=>n.id));
  const fresh = state.account === 'yunis' && notesLoadedFor === state.account ? list.filter(n=>!known.has(n.id) && !n.readAt) : [];
  notesLoadedFor = state.account;
  state.notes = list;
  if(fresh.length) noteArrived(fresh[0]);
  paintNotesBell();
}
/* Notes come quicker than the full refresh: check every 45 seconds while Yunis has the app open. */
setInterval(async ()=>{
  if(state.account !== 'yunis' || document.visibilityState !== 'visible') return;
  const r = await api('notes');
  if(r.ok && Array.isArray(r.data)){
    const before = notesNow().map(n=>n.id + ':' + !!n.readAt + ':' + !!n.doneAt).join();
    syncNotes(r.data);
    if(state.view === 'order' && before !== notesNow().map(n=>n.id + ':' + !!n.readAt + ':' + !!n.doneAt).join() && !refreshBlocked()) render();
  }
}, 45000);

/* ---------- Rico's monthly report card ---------- */
function monthName(){ return formatIraqDateTime(new Date(), {month:'long'}); }
function daysLeftInMonth(){
  const p = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baghdad', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date()).split('-').map(Number);
  const last = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  return {day:p[2], last, left:last - p[2]};
}
function reportData(){
  const days = new Set(state.history.map(h=>erbilDate(h.date)));
  const {day} = daysLeftInMonth();
  const tally = itemTally();
  const sup = new Map();
  monthLines().forEach(l=>{ const k = l.supplierId || l.supplierName || '—'; const x = sup.get(k) || {name:l.supplierId ? supplierName(l.supplierId) : (l.supplierName || t('noSupplier')), n:0}; x.n++; sup.set(k, x); });
  const who = {rozha:0, yunis:0};
  state.history.forEach(h=>{ if(h.by in who) who[h.by]++; });
  const ratio = day ? days.size / day : 0;
  const grade = !state.history.length ? '—' : ratio >= .95 ? 'A+' : ratio >= .85 ? 'A' : ratio >= .7 ? 'B' : ratio >= .5 ? 'C' : 'D';
  return {orders:state.history.length, days:days.size, elapsed:day, lines:monthLines().length, top:tally.slice(0, 5),
    suppliers:[...sup.values()].sort((a, b)=>b.n - a.n).slice(0, 4), who, grade, busiest:busiestWeekday()};
}
function renderReportCard(){
  if(!state.history.length) return '';
  const d = reportData(), {left} = daysLeftInMonth();
  const warn = left <= 3;
  return `<button type="button" class="report-card${warn ? ' warn' : ''}" id="reportOpen">
    <span class="report-grade grade-${esc(d.grade.replace('+','p'))}">${esc(d.grade)}</span>
    <span class="report-card-text"><b>${esc(t('reportTitle')(monthName()))}</b><span>${esc(t('reportGradeHint')(d.days, d.elapsed))} · ${d.orders} ${esc(t('reportOrders').toLowerCase())}</span>${warn ? `<em>${esc(t('reportClearsIn')(left))}</em>` : ''}</span>
    ${ricoFace(warn ? 'worried' : 'happy', 'rico-sm')}
  </button>`;
}
function openReportSheet(){
  const d = reportData(), s = streakNow(), {left} = daysLeftInMonth();
  const maxTop = d.top[0]?.times || 1, total = Math.max(1, d.who.rozha + d.who.yunis);
  const fact = funFact();
  const {el} = openKitchenSheet('report-sheet', `
    <div class="report-head"><div><div class="sel-title">${esc(t('reportTitle')(monthName()))}</div><div class="notes-sub">${esc(t('reportGradeHint')(d.days, d.elapsed))}</div></div><span class="report-grade big grade-${esc(d.grade.replace('+','p'))}" aria-label="${esc(t('reportGrade'))} ${esc(d.grade)}">${esc(d.grade)}</span></div>
    <div class="report-stats">
      <div><b>${d.orders}</b><span>${esc(t('reportOrders'))}</span></div>
      <div><b>${d.days}</b><span>${esc(t('reportDays'))}</span></div>
      <div><b>${d.lines}</b><span>${esc(t('reportLines'))}</span></div>
      <div class="tier-${streakTier(s.count)}"><b>${FLAME_SVG}${s.count}</b><span>${esc(t('reportStreak'))}</span></div>
    </div>
    ${d.top.length ? `<div class="report-sec"><div class="report-sec-title">${esc(t('reportTop'))}</div>${d.top.map(x=>`<div class="report-bar"><span dir="auto">${esc(x.name)}</span><i style="--w:${Math.round(x.times/maxTop*100)}%"></i><b>${esc(t('reportTimes')(x.times))}</b></div>`).join('')}</div>` : ''}
    ${d.suppliers.length ? `<div class="report-sec"><div class="report-sec-title">${esc(t('reportSuppliers'))}</div><div class="report-chips">${d.suppliers.map(x=>`<span>${supplierMono(x.name)}${esc(x.name)} <b>${x.n}</b></span>`).join('')}</div></div>` : ''}
    <div class="report-sec report-two">
      ${d.busiest >= 0 ? `<div><div class="report-sec-title">${esc(t('reportBusiest'))}</div><b class="report-day">${esc(weekdayName(d.busiest))}</b></div>` : ''}
      <div><div class="report-sec-title">${esc(t('reportWho'))}</div><div class="report-who"><i class="r" style="--w:${Math.round(d.who.rozha/total*100)}%"></i><i class="y" style="--w:${Math.round(d.who.yunis/total*100)}%"></i></div><div class="report-who-names"><span>${esc(accountLabel('rozha'))} ${d.who.rozha}</span><span>${esc(accountLabel('yunis'))} ${d.who.yunis}</span></div></div>
    </div>
    ${fact ? `<div class="fun-fact">${ricoFace('excited', 'rico-sm')}<div><b>${esc(t('funFactTitle'))}</b><span dir="auto">${esc(fact)}</span></div></div>` : ''}
    <div class="report-save${left <= 3 ? ' warn' : ''}"><b>${esc(t('reportSave'))}</b><p>${esc(left <= 3 ? t('reportClearsIn')(left) + ' ' : '')}${esc(t('reportSaveHint'))}</p>
      <div class="form-actions"><button type="button" class="btn btn-primary" data-report-excel>${ICON_DOWNLOAD} ${esc(t('reportExcel'))}</button><button type="button" class="btn btn-ghost" data-report-print>${NAV_ICONS.record} ${esc(t('reportPrint'))}</button></div></div>`, t('reportOpen'));
  el.querySelector('[data-report-excel]').onclick = exportMonthCsv;
  el.querySelector('[data-report-print]').onclick = printMonthReport;
}
/* Every line of every order this month, as a file Excel opens (UTF-8, so Kurdish and Arabic stay readable). */
function exportMonthCsv(){
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date','Time','Sent by','Supplier','Item','Quantity','Unit']];
  [...state.history].sort((a, b)=>Date.parse(a.date) - Date.parse(b.date)).forEach(h=>(h.entries||[]).forEach(e=>(e.items||[]).forEach(it=>rows.push([
    erbilDate(h.date), formatIraqDateTime(h.date, {hour:'2-digit', minute:'2-digit', hour12:false}), accountLabel(h.by) || '',
    e.supplierId ? supplierName(e.supplierId) : (e.supplierName || ''), it.name, it.qty, unitLabel(it.unit)]))));
  const csv = '﻿' + rows.map(r=>r.map(q).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url; a.download = `ricotta-orders-${erbilDate(new Date().toISOString()).slice(0, 7)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}
function printMonthReport(){
  const d = reportData();
  const w = window.open('', '_blank'); if(!w) return;
  w.opener = null;
  const days = [...state.history].sort((a, b)=>Date.parse(a.date) - Date.parse(b.date)).map(h=>`<tr><td>${esc(formatIraqDateTime(h.date, {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'}))}</td><td>${esc(accountLabel(h.by) || '')}</td><td>${(h.entries||[]).map(e=>`<b>${esc(e.supplierId ? supplierName(e.supplierId) : (e.supplierName || t('noSupplier')))}</b>: ${(e.items||[]).map(i=>`${esc(i.name)} × ${i.qty} ${esc(unitLabel(i.unit))}`).join(', ')}`).join('<br>')}</td></tr>`).join('');
  w.document.write(`<!doctype html><html dir="${isRtl() ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(t('reportTitle')(monthName()))} — Ricotta</title><link rel="stylesheet" href="${SHEET_FONTS}"><style>body{font-family:'Sora','Noto Kufi Arabic',Arial,sans-serif;color:#172a21;margin:0;padding:34px}h1{margin:0 0 4px;font-size:26px}.sub{color:#5c6c63;margin-bottom:20px}.stats{display:flex;gap:12px;margin:16px 0 22px}.stats div{flex:1;background:#ecf6ee;border-radius:10px;padding:12px 14px}.stats b{display:block;font-size:24px;color:#1f5c3f}table{width:100%;border-collapse:collapse}th{background:#1f5c3f;color:#fff;text-align:start;padding:10px;font-size:12px}td{padding:10px;border-bottom:1px solid #dce8df;font-size:12.5px;vertical-align:top}tr:nth-child(even){background:#f5f9f6}</style></head><body><h1>${esc(t('reportTitle')(monthName()))}</h1><div class="sub">Ricotta · ${esc(t('reportGrade'))} ${esc(d.grade)} · ${esc(t('reportGradeHint')(d.days, d.elapsed))}</div><div class="stats"><div><b>${d.orders}</b>${esc(t('reportOrders'))}</div><div><b>${d.days}</b>${esc(t('reportDays'))}</div><div><b>${d.lines}</b>${esc(t('reportLines'))}</div></div><table><thead><tr><th>${esc(t('reportDate'))}</th><th>${esc(t('reportWho'))}</th><th>${esc(t('reportOrders'))}</th></tr></thead><tbody>${days}</tbody></table></body></html>`);
  w.document.close(); w.focus();
  const link = w.document.querySelector('link');
  const fontsIn = new Promise(r=>{ link.onload = link.onerror = r; }).then(()=>w.document.fonts.ready);
  Promise.race([fontsIn, new Promise(r=>setTimeout(r, 2000))]).then(()=>w.print());
}

/* ---------- Undo a just-sent order (15 minutes, the person who sent it) ---------- */
const UNDO_MS = 15 * 60 * 1000;
const canUndoOrder = rec => rec && rec.by === state.account && Date.now() - Date.parse(rec.date) < UNDO_MS;
async function undoOrder(id){
  const rec = state.history.find(h=>h.id === id);
  if(!rec) return;
  const r = await api(`orders/${encodeURIComponent(id)}`, {method:'DELETE'});
  if(!r.ok){ await showAlert(r.status === 403 ? t('undoFailed') : t('saveFailed')); return; }
  state.history = state.history.filter(h=>h.id !== id);
  (rec.entries||[]).forEach(e=>(e.items||[]).forEach(it=>{ if(state.items.some(i=>i.id === it.itemId)) state.cart[it.itemId] = Math.max(state.cart[it.itemId] || 0, it.qty); }));
  persistCartDraft();
  if(r.data && r.data.streak){ state.streak = r.data.streak; paintStreakChip(false); }
  toast(t('orderUndone'));
  if(state.view === 'history' || state.view === 'order') render();
}
