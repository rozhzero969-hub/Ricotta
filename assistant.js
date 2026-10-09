/* Rico -- the in-app AI assistant (the "Rico" tab).
   Talks to POST api/assistant/chat, which streams the reply (see
   supabase/functions/api/assistant.ts). Rico can only PROPOSE changes: each
   proposal is a card here, and nothing happens until the person taps it; the
   change is then made through the normal API with this person's session.
   Every reply carries a mood, which Rico's face and colour show. Rico also
   writes first sometimes (a morning cheer, a thank-you after an order, a
   telling-off when an order is late): those messages come from the server's
   inbox and sit at the top of the chat.
   Each chat is saved to this account on the server (kept 90 days, newest 60), so it can be opened
   again from Chat history, also on the person's other phone. Opening the app starts a new chat.
   Depends on (runtime only): state, t, esc, render, toast, api, apiStream,
   lget, lset, saveRecord, logActivity, unitEn, unitLabel, supplierName,
   persistCartDraft, callSendPush, reportSendResult, showConfirm, goView,
   canOpen, NAV_ICONS. Load before app.js. */

const RICO_HISTORY_SENT = 24;           // messages sent to the server with each question
const RICO_LATE_AFTER_MIN = 60;
const RICO_LATE_WINDOW_MIN = 4*60;

NAV_ICONS.assistant = ricoSparkSvg('currentColor');
const ICON_SEND_UP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;
const ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/></svg>`;
const ICON_NEW_CHAT = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

const rico = {
  messages: [],
  streaming: false,
  abort: null,
  inbox: [],           // messages Rico wrote first: {id, kind, mood, en, ku, ar, at, read}
  chatId: null,        // the saved chat these messages belong to (made on the first save)
  chats: null,         // both accounts' saved chats {id, account, title, updatedAt}, newest first (null until loaded)
  chatsBusy: false,
  viewing: null,       // the other person's account while one of their chats is open (read only)
};

/* Rico: a little kitchen robot. A soft cloud-shaped head (like a chef's
   hat) in the Ricotta greens, a dark glass screen for a face with glowing
   eyes, and a small body with Rico's spark on its chest. The mood class on
   the root picks which eyes and mouth show, the eye colour, and how the
   arms and body move (see .rb-* in style.css). Each mood also has its own
   pastel colour. The gradient needs an id, so each drawing gets its own. */
const RICO_MOODS = ['happy','excited','grateful','calm','thinking','worried','sad','angry'];
let ricoBotSeq = 0;
/* Rico as drawn, plus whatever he wears today (a holiday costume or an umbrella, see seasons.js). */
function ricoFace(mood = 'happy', cls = ''){
  const svg = ricoFaceBase(mood, cls);
  return typeof dressRico === 'function' ? dressRico(svg, ricoOutfit()) : svg;
}
function ricoFaceBase(mood = 'happy', cls = ''){
  const m = RICO_MOODS.includes(mood) ? mood : 'happy';
  const g = 'rbg' + (++ricoBotSeq);
  let spark = '';
  for(let k=0;k<8;k++){
    const a=k*Math.PI/4, L=k%2?3.2:5.2, w=.8, c=Math.cos(a), s=Math.sin(a);
    spark+=`M${(50+w*c).toFixed(2)} ${(83+w*s).toFixed(2)}L${(50+L*s).toFixed(2)} ${(83-L*c).toFixed(2)}L${(50-w*c).toFixed(2)} ${(83-w*s).toFixed(2)}Z`;
  }
  const eye = (x, flip) => `
      <rect class="rb-e e-pill" x="${x-3.6}" y="47" width="7.2" height="12" rx="3.6"/>
      <path class="rb-e e-arc" d="M${x-5} 56 Q${x} 47 ${x+5} 56"/>
      <path class="rb-e e-chev" d="${flip ? `M${x+4} 48 L${x-3} 53 L${x+4} 58` : `M${x-4} 48 L${x+3} 53 L${x-4} 58`}"/>
      <path class="rb-e e-heart" d="M${x} 58 C${x-7} 53 ${x-5} 46 ${x} 50 C${x+5} 46 ${x+7} 53 ${x} 58 Z"/>
      <path class="rb-e e-bar" d="${flip ? `M${x+5} 48 L${x-4} 53` : `M${x-5} 48 L${x+4} 53`}"/>
      <path class="rb-e e-line" d="M${x-4.5} 53 L${x+4.5} 53"/>`;
  return `<span class="rico-bot mood-${m} ${cls}" aria-hidden="true"><svg viewBox="0 0 100 106">
    <defs><radialGradient id="${g}" gradientUnits="userSpaceOnUse" cx="36" cy="16" r="92">
      <stop offset="0" stop-color="var(--rb-c1)"/><stop offset=".45" stop-color="var(--rb-c2)"/><stop offset="1" stop-color="var(--rb-c3)"/></radialGradient></defs>
    <g class="rb-all">
      <ellipse class="rb-shadow" cx="50" cy="103" rx="20" ry="2.6"/>
      <g class="rb-feet" fill="url(#${g})"><rect x="36" y="93" width="11" height="8" rx="4"/><rect x="53" y="93" width="11" height="8" rx="4"/></g>
      <rect class="rb-arm l" x="24.5" y="72" width="9" height="18" rx="4.5" fill="url(#${g})"/>
      <rect class="rb-arm r" x="66.5" y="72" width="9" height="18" rx="4.5" fill="url(#${g})"/>
      <rect class="rb-body" x="32" y="68" width="36" height="29" rx="12" fill="url(#${g})"/>
      <rect class="rb-chest" x="40.5" y="76" width="19" height="14" rx="5"/>
      <path class="rb-spark" d="${spark}"/>
      <g class="rb-head">
        <g fill="url(#${g})"><circle cx="50" cy="24" r="19"/><circle cx="32" cy="32" r="14"/><circle cx="68" cy="32" r="14"/><circle cx="38" cy="18" r="12"/><circle cx="62" cy="18" r="12"/><rect x="15" y="30" width="70" height="42" rx="20"/></g>
        <ellipse class="rb-shine" cx="37" cy="15" rx="11" ry="5" transform="rotate(-22 37 15)"/>
        <rect class="rb-visor" x="21" y="37" width="58" height="30" rx="12"/>
        <path class="rb-visor-glass" d="M26 42 Q50 36 74 42"/>
        <g class="rb-eyes"><g class="rb-eye l">${eye(39,false)}</g><g class="rb-eye r">${eye(61,true)}</g></g>
        <g class="rb-brows"><path class="rb-brow l" d="M34 44 L44 42.5"/><path class="rb-brow r" d="M66 44 L56 42.5"/></g>
        <g class="rb-mouths"><path class="rb-mo mo-smile" d="M45 61.5 Q50 65 55 61.5"/><path class="rb-mo mo-open" d="M44.5 60.5 Q50 67 55.5 60.5 Z"/><path class="rb-mo mo-flat" d="M46 62.5 L54 62.5"/><path class="rb-mo mo-frown" d="M45 64 Q50 60 55 64"/><path class="rb-mo mo-grr" d="M44 63.5 L47 61.5 L50 63.5 L53 61.5 L56 63.5"/></g>
        <g class="rb-dots"><circle cx="72" cy="12" r="2.2"/><circle cx="79" cy="7" r="2.8"/><circle cx="87" cy="2" r="3.4"/></g>
        <path class="rb-tear" d="M36 62 c0 0 -3 4 -3 6 a3 3 0 0 0 6 0 c0 -2 -3 -6 -3 -6z"/>
        <path class="rb-drop" d="M82 36 c0 0 -4 5 -4 8 a4 4 0 0 0 8 0 c0 -3 -4 -8 -4 -8z"/>
        <g class="rb-steam"><path d="M14 20 c-3 -3 3 -5 0 -9"/><path d="M86 20 c3 -3 -3 -5 0 -9"/></g>
        <path class="rb-heart" d="M84 20 c-2 -4 -9 -3 -9 2 c0 4 9 9 9 9 s9 -5 9 -9 c0 -5 -7 -6 -9 -2z"/>
      </g>
    </g></svg></span>`;
}

function ricoAutoOrder(){ return !!lget('ricoAutoOrder'); }
/* Signing out forgets the chat and the inbox on this phone. */
function ricoReset(){
  ricoStop(); ricoResetVoice(); clearTimeout(ricoSaveTimer);
  rico.messages = []; rico.streaming = false; rico.inbox = []; rico.chatId = null; rico.chats = null; rico.viewing = null;
}

/* ---------- Rico's inbox ---------- */
function ricoSetInbox(list){ rico.inbox = Array.isArray(list) ? list : []; }
function ricoUnread(){ return rico.inbox.filter(m=>!m.read).length; }
/* The mood of his newest unread message (his tab shows it as his face). */
function ricoUnreadMood(){
  const unread = rico.inbox.filter(m=>!m.read);
  const m = unread.length ? unread[unread.length - 1].mood : '';
  return RICO_MOODS.includes(m) ? m : 'happy';
}
function ricoInboxText(m){ return (state.lang === 'ku' ? m.ku : state.lang === 'ar' ? m.ar : m.en) || m.en; }
/* Opening Rico reads his messages. */
function ricoMarkInboxRead(){
  if(!ricoUnread()) return;
  rico.inbox.forEach(m=>{ m.read = true; });
  api('assistant/inbox/read', {method:'POST'});
  updateRicoBadge();
}
/* Picks up new messages from Rico while the app is open (every few minutes,
   and when the app comes back to the front). */
async function ricoRefreshInbox(){
  if(!state.account) return;
  const r = await api('assistant/inbox');
  if(!r.ok || !Array.isArray(r.data)) return;
  const before = rico.inbox.map(m=>m.id+':'+m.read).join();
  ricoSetInbox(r.data);
  if(rico.inbox.map(m=>m.id+':'+m.read).join() === before) return;
  if(state.view === 'assistant'){ render(); ricoMarkInboxRead(); } else updateRicoBadge();
}
setInterval(()=>{ if(document.visibilityState === 'visible') ricoRefreshInbox(); }, 3*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') ricoRefreshInbox(); });
/* How Rico feels right now: the mood of his latest reply (thinking while he works). */
function ricoCurrentMood(){
  for(let i = rico.messages.length - 1; i >= 0; i--){
    const m = rico.messages[i];
    if(m.role !== 'assistant') continue;
    if(m.streaming && !m.mood) return 'thinking';
    if(m.error) return 'sad';
    if(m.mood) return m.mood;
  }
  const last = rico.inbox[rico.inbox.length - 1];
  return last && !last.read ? last.mood : 'happy';
}

/* ---------- Late orders (same rule as the server's push alert) ---------- */
function erbilNow(){
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const g = k=>p.find(x=>x.type===k).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  return {date, minutes:+g('hour')*60 + +g('minute'), weekday:new Date(date+'T12:00:00Z').getUTCDay()};
}
function erbilDate(iso){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
}
function ricoLateOrders(){
  if(!state.account) return [];
  const now = erbilNow();
  /* Yesterday too, so a late-evening reminder (e.g. 23:00) still shows after midnight,
     for the same 4 hours the server's late-order push covers. */
  const y = new Date(now.date+'T12:00:00Z'); y.setUTCDate(y.getUTCDate()-1);
  const yest = {date:y.toISOString().slice(0,10), weekday:y.getUTCDay()};
  const sentOn = {[now.date]:new Set(), [yest.date]:new Set()};
  state.history.forEach(o=>{ const d = erbilDate(o.date); if(sentOn[d]) o.entries.forEach(e=>sentOn[d].add(e.supplierId)); });
  const late = [];
  state.suppliers.forEach(s=>{
    const r = s.reminder;
    if(!r || !r.enabled || !/^\d\d:\d\d$/.test(r.time||'')) return;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : [0,1,2,3,4,5,6];
    const [h,m] = r.time.split(':').map(Number);
    const at = h*60+m;
    let mins = -1, day = null;
    if(days.includes(now.weekday) && now.minutes >= at){ mins = now.minutes - at; day = now.date; }
    else if(days.includes(yest.weekday) && now.minutes + 1440 - at < RICO_LATE_WINDOW_MIN){ mins = now.minutes + 1440 - at; day = yest.date; }
    if(mins < RICO_LATE_AFTER_MIN) return;
    /* A reminder set up after its time had passed starts next time (same rule as the server). */
    if(r.updatedAt && Date.parse(`${day}T${r.time}:00+03:00`) + 60000 < Date.parse(r.updatedAt)) return;
    const sent = sentOn[day].has(s.id) || (day === yest.date && sentOn[now.date].has(s.id));
    if(!sent) late.push({supplierId:s.id, name:s.name, time:r.time, mins});
  });
  return late;
}

/* ---------- Rendering ---------- */
function ricoGreeting(){
  const h = +new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Baghdad',hour:'2-digit',hourCycle:'h23'}).format(new Date());
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return t('ricoGreeting')(part, accountLabel(state.account));
}
function renderAssistant(){
  const late = ricoLateOrders();
  const head = `<header class="rico-head">
      ${ricoFace(ricoCurrentMood(), 'rico-md')}
      <div class="rico-head-text">
        <div class="rico-name">${esc(t('ricoName'))}<span class="rico-online" aria-hidden="true"></span></div>
        <div class="rico-who">${esc(t('ricoTalkingWith')(accountLabel(state.account)))}</div>
      </div>
      <div class="rico-head-actions">
        <button class="icon-btn rico-auto ${ricoAutoOrder()?'on':''}" id="ricoAutoBtn" aria-pressed="${ricoAutoOrder()}" title="${esc(t('ricoAutoOrderLabel'))}" aria-label="${esc(t('ricoAutoOrderLabel'))}">${NAV_ICONS.order}</button>
        <button class="icon-btn" id="ricoHistBtn" title="${esc(t('ricoHistory'))}" aria-label="${esc(t('ricoHistory'))}">${NAV_ICONS.history}</button>
        <button class="icon-btn" id="ricoNewBtn" title="${esc(t('ricoNewChat'))}" aria-label="${esc(t('ricoNewChat'))}" ${rico.messages.length?'':'disabled'}>${ICON_NEW_CHAT}</button>
      </div>
    </header>`;
  const alerts = late.length ? `<div class="rico-alerts">${late.map(l=>`
      <div class="rico-alert">
        <span class="rico-alert-dot" aria-hidden="true"></span>
        <div class="rico-alert-text"><b>${esc(t('ricoLateTitle')('\u2068'+l.name+'\u2069'))}</b><span>${esc(t('ricoLateSub')(l.time, Math.floor(l.mins/60), l.mins%60))}</span></div>
        <button class="btn btn-primary" data-rico-late="${esc(l.supplierId)}">${esc(t('ricoPrepareIt'))}</button>
      </div>`).join('')}</div>` : '';
  const thread = rico.messages.length
    ? rico.messages.map((m,i)=>ricoTimeDivider(rico.messages[i-1], m) + renderRicoMessage(m,i)).join('')
    : renderRicoIntro();
  const viewing = rico.viewing ? `<div class="rico-viewing" role="status"><span>${esc(t('ricoReadOnly')(accountLabel(rico.viewing)))}</span></div>` : '';
  return `${head}${viewing}${rico.viewing ? '' : alerts + renderRicoInbox()}<div class="rico-thread${rico.viewing ? ' read-only' : ''}" id="ricoThread" aria-live="polite">${thread}</div>`;
}
/* A small date and time line where a chat starts, a new day begins, or after a half-hour pause. */
function ricoTimeDivider(prev, m){
  if(!m.ts) return '';
  const day = x=>new Intl.DateTimeFormat('en-CA',{timeZone:IRAQ_TIME_ZONE}).format(new Date(x));
  if(prev && prev.ts && day(prev.ts) === day(m.ts) && m.ts - prev.ts < 30*60000) return '';
  return `<div class="rico-time"><span>${esc(dayLabel(m.ts))} · ${esc(formatIraqDateTime(m.ts,{hour:'numeric',minute:'2-digit'}))}</span></div>`;
}
/* The newest few messages Rico wrote first, above the chat. */
function renderRicoInbox(){
  const list = rico.inbox.slice(-3);
  if(!list.length) return '';
  return `<div class="rico-inbox">${list.map(m=>`
    <div class="rico-note mood-tint-${esc(m.mood)} ${m.read?'':'unread'}">
      ${ricoFace(m.mood, 'rico-sm')}
      <div class="rico-note-body"><div class="rico-note-meta">${esc(t('ricoWroteFirst'))} · ${esc(timeAgo(m.at))}</div><div class="rico-note-text" dir="auto">${esc(ricoInboxText(m))}</div></div>
    </div>`).join('')}</div>`;
}
function renderRicoIntro(){
  const chips = t('ricoSuggestions');
  const actions = ['prepare_order','check_order','week_insights','last_order','add_item','late_orders'];
  return `<div class="rico-intro">
    ${ricoFace('happy', 'rico-xl')}
    <h2 class="rico-hello">${esc(ricoGreeting())}</h2>
    <p class="rico-intro-text">${esc(t('ricoIntro'))}</p>
    <div class="rico-chips">${chips.map((c,i)=>`<button class="rico-chip" data-rico-ask="${esc(c)}" data-rico-action="${actions[i]}">${esc(c)}</button>`).join('')}</div>
    ${myChats().length ? `<section class="rico-recent">
      <div class="rico-recent-h"><span>${esc(t('ricoRecentChats'))}</span><button class="rico-link" data-rico-history>${esc(t('ricoSeeAll'))}</button></div>
      ${myChats().slice(0,3).map(c=>`<button class="rico-recent-row" data-rico-chat="${esc(c.id)}">${NAV_ICONS.assistant}<span dir="auto">${esc(c.title || t('ricoUntitled'))}</span><small>${esc(timeAgo(c.updatedAt))}</small></button>`).join('')}
    </section>` : ''}
  </div>`;
}
function renderRicoMessage(m, i){
  if(m.role === 'user'){
    return `<div class="rico-msg me" id="rico-m-${i}"><div class="rico-bubble" dir="auto">${esc(m.text)}</div></div>`;
  }
  const body = m.text ? ricoFormat(m.text) : '';
  const steps = m.steps || [];
  const typing = m.streaming && !m.text && !steps.length ? `<div class="rico-typing"><i></i><i></i><i></i><span>${esc(ricoStatusLabel(m.statusKey))}</span></div>` : '';
  const tick = '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const stepRow = (k, running)=>`<div class="rico-step"><span class="rico-step-ic ${running?'spin':'ok'}">${running?'':tick}</span>${esc(ricoStatusLabel(k))}</div>`;
  // What Rico is doing, as a short checklist; it folds into one line once the answer starts.
  const stepsHtml = !steps.length ? '' : (m.streaming && !m.stepsDone)
    ? `<div class="rico-steps">${steps.map((k,n)=>stepRow(k, n===steps.length-1)).join('')}</div>`
    : `<details class="rico-steps done" data-rico-steps="${i}" ${m.stepsOpen?'open':''}><summary><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>${esc(t('ricoWorkedSteps')(steps.length))}</summary><div class="rico-steps-list">${steps.map(k=>stepRow(k,false)).join('')}</div></details>`;
  const err = m.error ? `<div class="rico-error">${esc(ricoErrorText(m.error))}${m.error==='not_configured' && isRozha() ? ` <button class="rico-link" data-rico-settings>${esc(t('ricoOpenSettings'))}</button>` : ''}${m.retry ? ` <button class="rico-link" data-rico-retry="${i}">${esc(t('retry'))}</button>` : ''}</div>` : '';
  const status = m.streaming && m.text && m.statusKey && m.stepsDone ? `<div class="rico-status-line"><i></i>${esc(ricoStatusLabel(m.statusKey))}</div>` : '';
  const cards = (m.proposals||[]).map(p=>renderRicoProposal(p, i)).join('');
  const picker = m.picker ? renderRicoSupplierPicker(m.picker, i) : '';
  const mood = m.error ? 'sad' : m.mood || (m.streaming ? 'thinking' : 'happy');
  return `<div class="rico-msg bot${m.streaming?' streaming':''}" id="rico-m-${i}">
    ${ricoFace(mood, 'rico-sm')}
    <div class="rico-col">
      ${stepsHtml}${typing}${body ? `<div class="rico-bubble mood-tint-${mood}" dir="auto"><div class="rico-text">${body}</div></div>` : ''}${status}${picker}${cards}${err}
    </div>
  </div>`;
}
function renderRicoSupplierPicker(picker, i){
  if(picker.chosen) return '';
  const selected = new Set(picker.selectedIds || []);
  return `<div class="rico-supplier-picker" data-rico-picker="${i}">
    <button class="btn btn-primary rico-scope-all" data-rico-scope-all="${i}">${t('ricoAllSuppliers')}</button>
    <div class="rico-picker-list">${state.suppliers.map(s=>`<label class="rico-picker-row"><input type="checkbox" data-rico-scope-check="${i}" value="${esc(s.id)}" ${selected.has(s.id)?'checked':''}><span>${esc(s.name)}</span></label>`).join('')}</div>
    <button class="btn btn-ghost rico-scope-selected" data-rico-scope-selected="${i}" ${selected.size?'':'disabled'}>${t('ricoPrepareSelected')(selected.size)}</button>
  </div>`;
}
function ricoStatusLabel(key){
  const map = t('ricoStatus');
  return map[key] || map.thinking;
}
function ricoErrorText(code){
  const map = t('ricoErrors');
  return map[code] || map.failed;
}
/* The server wraps kitchen data in <<DATA>> markers for the AI; now and then
   the AI copies them, or invents [[data:...]] around a name. Only the name is kept.
   A mood the AI wrote in the wrong shape ([happy], [[happy]]) is dropped: the
   face already shows it. */
const RICO_MOOD_TAG = new RegExp(`\\[\\[?\\s*(?:mood\\s*:\\s*)?(?:${RICO_MOODS.join('|')})\\s*\\]\\]?[ \\t]*`, 'gi');
function ricoClean(s){
  return String(s || '').replace(/\[\[\s*data\s*:\s*([^\]]*?)\s*\]\]/gi, '$1').replace(/<<\/?DATA>>/gi, '').replace(RICO_MOOD_TAG, '');
}
/* A small, safe Markdown subset: **bold**, `code`, bullet and numbered lists, paragraphs. */
function ricoFormat(src){
  const inline = s=>s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g,'$1<i>$2</i>');
  const out = []; let list = null, para = [];
  const flush = ()=>{ if(para.length){ out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  esc(ricoClean(src)).split('\n').forEach(line=>{
    const li = line.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/);
    const h = line.match(/^\s*#{1,4}\s+(.*)$/);
    if(li){
      flush();
      const tag = li[1] ? 'ol' : 'ul';
      if(list !== tag){ if(list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline(li[2])}</li>`);
      return;
    }
    if(list){ out.push(`</${list}>`); list = null; }
    if(h){ flush(); out.push(`<p><b>${inline(h[1])}</b></p>`); return; }
    if(!line.trim()){ flush(); return; }
    para.push(line);
  });
  flush(); if(list) out.push(`</${list}>`);
  return out.join('');
}

/* ---------- Proposal cards ---------- */
function renderRicoProposal(p, mi){
  const done = p.status === 'applied', gone = ['dismissed','undone','expired'].includes(p.status), saving = p.status === 'saving';
  const actions = primaryLabel=> gone
      ? `<div class="rico-card-state">${p.status==='undone'?t('ricoUndone'):p.status==='expired'?t('ricoCardOld'):t('ricoDismissed')}</div>`
      : done
        ? `<div class="rico-card-state ok">✓ ${esc(p.doneLabel || t('ricoDone'))}${p.kind==='order' ? ` <button class="rico-link" data-rico-open="order">${t('ricoOpenOrder')}</button>${p.undo?` <button class="rico-link" data-rico-undo="${mi}|${esc(p.id)}">${t('ricoUndo')}</button>`:''}` : ''}</div>`
        : `<div class="rico-card-actions"><button class="btn btn-primary${saving?' is-busy':''}" data-rico-apply="${mi}|${esc(p.id)}" ${saving?'disabled aria-busy="true"':''}>${primaryLabel}</button><button class="btn btn-ghost" data-rico-dismiss="${mi}|${esc(p.id)}" ${saving?'disabled':''}>${t('ricoNotNow')}</button></div>`;
  let body = '', title = '', icon = '';
  if(p.kind === 'order'){
    const groups = {};
    p.lines.forEach(l=>{ (groups[l.supplier||t('noSupplier')] ||= []).push(l); });
    icon = NAV_ICONS.order;
    title = p.mode==='set' ? t('ricoCardSet')(p.lines.length) : t('ricoCardOrder')(p.lines.length);
    const amount = l=> p.mode==='set' && !(Number(l.qty)>0) ? `<s>${esc(t('ricoRemoveLine'))}</s>` : `${esc(String(l.qty))} ${esc(unitLabel(l.unitId))}`;
    body = Object.entries(groups).map(([sup, ls])=>`<div class="rico-card-group"><div class="rico-card-sup">${supplierMono(sup)}${esc(sup)}</div>${ls.map(l=>`<div class="rico-card-line"><span dir="auto">${esc(l.name)}</span><b>${amount(l)}</b></div>`).join('')}</div>`).join('')
      + (p.note ? `<div class="rico-card-note">${esc(p.note)}</div>` : '')
      + (p.mode==='add' ? `<div class="rico-card-note">${t('ricoAddsToDraft')}</div>` : '')
      + (p.mode==='set' ? `<div class="rico-card-note">${t('ricoSetsDraft')}</div>` : '');
    return ricoCard(icon, title, body, actions(p.mode==='set' ? t('ricoApplyChanges') : t('ricoPutInOrder')), p);
  }
  if(p.kind === 'new_item'){
    icon = ICON_PLUS; title = t('ricoCardNewItem');
    body = ricoFields([[t('name'), p.name], [t('unit'), unitLabel(p.unitId) || p.unit], [t('supplier'), p.supplier || t('noSupplier')]]);
    return ricoCard(icon, title, body, actions(t('addItem')), p);
  }
  if(p.kind === 'edit_item'){
    icon = ICON_EDIT; title = t('ricoCardEditItem');
    const row = (label, a, b)=> a===b ? [label, b] : [label, `<s>${esc(a)}</s> → ${esc(b)}`, true];
    body = ricoFields([row(t('name'), p.before.name, p.name), row(t('unit'), p.before.unit, p.unit), row(t('supplier'), p.before.supplier, p.supplier || t('noSupplier'))]);
    return ricoCard(icon, title, body, actions(t('save')), p);
  }
  if(p.kind === 'new_supplier'){
    icon = NAV_ICONS.suppliers; title = t('ricoCardNewSupplier');
    body = ricoFields([[t('name'), p.name], [t('phone'), p.phone || '—']]);
    return ricoCard(icon, title, body, actions(t('addSupplier')), p);
  }
  if(p.kind === 'notify'){
    icon = ICON_BELL; title = t('ricoCardNotify');
    body = `<div class="rico-card-note"><b>${esc(p.title)}</b></div><div class="rico-card-msg" dir="ltr">${esc(p.en)}</div><div class="rico-card-msg" dir="rtl" lang="ckb">${esc(p.ku)}</div><div class="rico-card-msg" dir="rtl" lang="ar">${esc(p.ar || '')}</div>`;
    return ricoCard(icon, title, body, actions(t('notifSend')), p);
  }
  if(p.kind === 'streak'){
    icon = FLAME_SVG; title = t('ricoCardStreak')(p.days);
    body = `<div class="rico-card-note">${esc(t('streakHow'))}</div>`;
    return ricoCard(icon, title, body, actions(t('ricoStreakBtn')), p);
  }
  if(p.kind === 'open'){
    if(p.screen !== 'send' && !canOpen(p.screen)) return '';
    if(p.screen === 'send') return `<button class="rico-open" data-rico-open="send">${ICON_CHAT}<span>${esc(p.label || t('ricoOpenSend'))}</span></button>`;
    return `<button class="rico-open" data-rico-open="${esc(p.screen)}" data-rico-sup="${esc(p.supplierId||'')}">${NAV_ICONS[p.screen]||NAV_ICONS.order}<span>${esc(p.label || t('ricoOpenScreen')(viewLabel(p.screen)))}</span></button>`;
  }
  return '';
}
function ricoFields(rows){
  return `<dl class="rico-fields">${rows.map(([k,v,raw])=>`<div><dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('')}</dl>`;
}
function ricoCard(icon, title, body, actions, p){
  return `<div class="rico-card ${p.status||'pending'}" data-card="${esc(p.id)}"><div class="rico-card-head"><span class="rico-card-icon">${icon}</span><span>${esc(title)}</span>${p.auto?`<span class="rico-card-tag">${t('ricoAutoTag')}</span>`:''}</div>${body}${actions}</div>`;
}

/* ---------- Composer (lives in the bottom stack above the tab bar) ---------- */
function renderRicoComposer(){
  if(rico.viewing) return `<div class="rico-composer rico-composer-viewing"><button type="button" class="btn btn-primary" data-rico-mine>${esc(t('ricoBackToMine'))}</button></div>`;
  const voice = ricoVoiceSupported();
  return `<form class="rico-composer ${ricoRecorder.active?'recording':''} ${ricoRecorder.busy?'transcribing':''}" id="ricoComposer" autocomplete="off">
    <label class="sr-only" for="ricoInput">${esc(t('ricoPlaceholder'))}</label>
    <textarea id="ricoInput" rows="1" maxlength="2000" enterkeyhint="send" placeholder="${esc(ricoComposerHint())}" dir="auto"></textarea>
    ${voice ? `<button type="button" class="rico-mic" id="ricoMicBtn" aria-label="${esc(t('ricoMic'))}" aria-pressed="${ricoRecorder.active}">${ICON_MIC}<span class="rico-mic-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>` : ''}
    <button type="submit" class="rico-send ${rico.streaming?'stop':''}" id="ricoSendBtn" aria-label="${esc(rico.streaming?t('ricoStop'):t('ricoSend'))}">${rico.streaming?ICON_STOP:ICON_SEND_UP}</button>
  </form>`;
}
function ricoComposerHint(){
  return ricoRecorder.active ? t('ricoListening') : ricoRecorder.busy ? t('ricoTranscribing') : t('ricoPlaceholder');
}

/* ---------- Voice messages ----------
   Tap the microphone, speak (Kurdish or English), tap again: the clip goes
   to the server, comes back as text, and is sent to Rico like a typed
   message. Recording stops by itself after a minute. Nothing is stored. */
const ricoRecorder = {active:false, busy:false, rec:null, stream:null, chunks:[], timer:0};
function ricoVoiceSupported(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
function blobToBase64(blob){
  return new Promise((resolve, reject)=>{ const r = new FileReader(); r.onload = ()=>resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
}
async function ricoToggleVoice(){
  if(ricoRecorder.busy) return;
  if(ricoRecorder.active){ try{ ricoRecorder.rec.stop(); }catch(e){ ricoResetVoice(); } return; }
  if(rico.streaming) return;
  if(!ricoVoiceSupported()){ toast(t('ricoMicUnsupported'), 'warn'); return; }
  const denied = e=>e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
  const failed = e=>toast(denied(e) ? t('ricoMicDenied') : t('ricoMicNoStart') + (e && e.name ? ` (${e.name})` : ''), 'warn');
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}}); }
  catch(e){
    // Some phones refuse the extra settings: ask again for a plain microphone.
    if(denied(e)){ failed(e); return; }
    try{ stream = await navigator.mediaDevices.getUserMedia({audio:true}); }
    catch(e2){ failed(e2); return; }
  }
  // iPhones record most reliably in their own format (mp4), in one piece; others prefer webm/opus.
  const supports = m=>window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m);
  const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && supports('audio/mp4');
  const mime = (apple ? ['audio/mp4'] : ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus']).find(supports) || '';
  let rec;
  try{ rec = new MediaRecorder(stream, mime ? {mimeType:mime, audioBitsPerSecond:32000} : undefined); }
  catch(e){
    try{ rec = new MediaRecorder(stream); }
    catch(e2){ stream.getTracks().forEach(tr=>tr.stop()); failed(e2); return; }
  }
  Object.assign(ricoRecorder, {active:true, rec, stream, chunks:[]});
  rec.ondataavailable = e=>{ if(e.data && e.data.size) ricoRecorder.chunks.push(e.data); };
  rec.onstop = ()=>ricoFinishVoice(rec.mimeType || mime || 'audio/webm');
  rec.onerror = e=>{ ricoResetVoice(); ricoRecorder.voiceOrder = false; ricoRefreshComposer(); failed(e && e.error); };
  if(apple) rec.start(); else rec.start(250);
  ricoRecorder.timer = setTimeout(()=>{ if(ricoRecorder.active) try{ rec.stop(); }catch(e){} }, 60000);
  ricoRefreshComposer();
}
function ricoResetVoice(){
  clearTimeout(ricoRecorder.timer);
  const rec = ricoRecorder.rec;
  if(rec && rec.state !== 'inactive'){ rec.onstop = null; try{ rec.stop(); }catch(e){} }   // dropped, not sent
  ricoRecorder.stream && ricoRecorder.stream.getTracks().forEach(tr=>tr.stop());
  Object.assign(ricoRecorder, {active:false, rec:null, stream:null, chunks:[]});
}
async function ricoFinishVoice(mime){
  const blob = new Blob(ricoRecorder.chunks, {type:mime});
  ricoResetVoice();
  ricoRecorder.busy = true;
  ricoRefreshComposer();
  paintVoiceOrderBtn();
  try{
    if(blob.size < 1200){ toast(t('ricoMicTooShort'), 'warn'); return; }   // just a tap
    const audio = await blobToBase64(blob);
    const r = await api('assistant/transcribe', {method:'POST', body:{audio, mime:mime.split(';')[0], lang:state.lang}, timeout:45000});
    const text = r.ok && r.data && typeof r.data.text === 'string' ? r.data.text.trim() : '';
    if(!text){
      const code = r.data && r.data.error;
      toast(code === 'rate_limited' ? t('ricoErrors').rate_limited : code === 'not_configured' ? t('ricoErrors').not_configured : r.status === 0 ? t('ricoErrors').offline : t('ricoMicFailed'), 'warn');
      return;
    }
    ricoRecorder.busy = false;
    // From the Order screen's "Say your order": Rico fills the order straight away.
    if(ricoRecorder.voiceOrder){ ricoRecorder.voiceOrder = false; ricoAsk(text + '\n\n' + t('voiceOrderPrompt'), {voiceOrder:true}); }
    else ricoAsk(text);
  }catch(e){ console.error('Voice message failed', e); toast(t('ricoMicFailed') + (e && e.name ? ` (${e.name})` : ''), 'warn'); }
  finally{ ricoRecorder.busy = false; ricoRecorder.voiceOrder = false; ricoRefreshComposer(); paintVoiceOrderBtn(); }
}

/* ---------- Events ---------- */
function attachAssistantEvents(){
  const input = document.getElementById('ricoInput');
  const form = document.getElementById('ricoComposer');
  if(input){
    const grow = ()=>{ input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', e=>{
      if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); form.requestSubmit(); }
    });
    input.addEventListener('focus', ()=>document.body.classList.add('rico-composing'));
    // Leaving the box gives the page more room at the bottom: stay at the newest message if we were there.
    input.addEventListener('blur', ()=>setTimeout(()=>{ const near = ricoNearBottom(); document.body.classList.remove('rico-composing'); if(near && rico.messages.length) ricoScroll(false); }, 120));
    const draft = lget('ricoDraft'); if(draft && !input.value){ input.value = draft; grow(); }
    input.addEventListener('input', ()=>lset('ricoDraft', input.value || null));
  }
  document.getElementById('ricoMicBtn')?.addEventListener('click', ()=>ricoToggleVoice());
  if(form) form.onsubmit = e=>{
    e.preventDefault();
    if(ricoRecorder.active){ ricoToggleVoice(); return; }
    if(rico.streaming){ ricoStop(); return; }
    const text = input.value.trim();
    if(!text) return;
    input.value = ''; input.style.height = 'auto'; lset('ricoDraft', null);
    ricoAsk(text);
  };
  document.getElementById('ricoNewBtn')?.addEventListener('click', ()=>ricoNewChat());
  document.querySelectorAll('[data-rico-mine]').forEach(b=>b.onclick=()=>ricoNewChat());
  document.getElementById('ricoHistBtn')?.addEventListener('click', ()=>ricoOpenHistory());
  if(rico.chats === null) ricoLoadChats().then(()=>{ if(state.view === 'assistant' && !rico.messages.length && rico.chats?.length && !refreshBlocked()) render(); });
  document.getElementById('ricoAutoBtn')?.addEventListener('click', async ()=>{
    const on = !ricoAutoOrder();
    if(on && !(await showConfirm(t('ricoAutoOrderConfirm'), {okLabel:t('ricoAllow'), okClass:'btn-primary'}))) return;
    lset('ricoAutoOrder', on || null);
    toast(on ? t('ricoAutoOn') : t('ricoAutoOff'));
    render();
  });
  attachRicoThreadEvents(document.getElementById('mainContent') || document);
  if(rico.messages.length) ricoScroll(false);
  ricoMarkInboxRead();
}
function attachRicoThreadEvents(root){
  root.querySelectorAll('[data-rico-ask]').forEach(b=>b.onclick=()=>ricoAsk(b.dataset.ricoAsk, {quickAction:b.dataset.ricoAction}));
  root.querySelectorAll('[data-rico-chat]').forEach(b=>b.onclick=()=>ricoOpenChat(b.dataset.ricoChat));
  root.querySelectorAll('[data-rico-history]').forEach(b=>b.onclick=()=>ricoOpenHistory());
  root.querySelectorAll('[data-rico-steps]').forEach(d=>d.ontoggle=()=>{ const m=rico.messages[+d.dataset.ricoSteps]; if(m) m.stepsOpen=d.open; });
  root.querySelectorAll('[data-rico-scope-check]').forEach(b=>b.onchange=()=>{
    const i = Number(b.dataset.ricoScopeCheck), picker = rico.messages[i]?.picker;
    if(!picker || picker.chosen) return;
    picker.selectedIds = [...root.querySelectorAll(`[data-rico-scope-check="${i}"]:checked`)].map(input=>input.value);
    const apply = root.querySelector(`[data-rico-scope-selected="${i}"]`);
    if(apply){ apply.disabled = !picker.selectedIds.length; apply.textContent = t('ricoPrepareSelected')(picker.selectedIds.length); }
  });
  root.querySelectorAll('[data-rico-scope-all]').forEach(b=>b.onclick=()=>ricoChooseScope(Number(b.dataset.ricoScopeAll), state.suppliers.map(s=>s.id)));
  root.querySelectorAll('[data-rico-scope-selected]').forEach(b=>b.onclick=()=>ricoChooseScope(Number(b.dataset.ricoScopeSelected), rico.messages[Number(b.dataset.ricoScopeSelected)]?.picker?.selectedIds || []));
  root.querySelectorAll('[data-rico-late]').forEach(b=>b.onclick=()=>{
    const s = state.suppliers.find(x=>x.id===b.dataset.ricoLate);
    if(s) ricoAsk(t('ricoPreparePrompt')(s.name));
  });
  root.querySelectorAll('[data-rico-apply]').forEach(b=>b.onclick=()=>{ const [mi,id]=b.dataset.ricoApply.split('|'); ricoApply(+mi, id, b); });
  root.querySelectorAll('[data-rico-dismiss]').forEach(b=>b.onclick=()=>{ const [mi,id]=b.dataset.ricoDismiss.split('|'); ricoSetStatus(+mi, id, 'dismissed'); });
  root.querySelectorAll('[data-rico-undo]').forEach(b=>b.onclick=()=>{ const [mi,id]=b.dataset.ricoUndo.split('|'); ricoUndo(+mi, id); });
  root.querySelectorAll('[data-rico-open]').forEach(b=>b.onclick=()=>{
    const screen = b.dataset.ricoOpen, sup = b.dataset.ricoSup;
    if(screen === 'send'){ startSendQueue().then(ok=>{ if(!ok) goView('order'); }); return; }
    if(!canOpen(screen)) return;
    if(screen === 'order' && sup && state.suppliers.some(s=>s.id===sup)) state.orderTab = sup;
    goView(screen);
  });
  root.querySelectorAll('[data-rico-settings]').forEach(b=>b.onclick=()=>{ goView('settings'); requestAnimationFrame(()=>document.querySelector('.rico-status-card')?.scrollIntoView({block:'center'})); });
  root.querySelectorAll('[data-rico-retry]').forEach(b=>b.onclick=()=>{
    const i = +b.dataset.ricoRetry;
    const lastUser = [...rico.messages.slice(0, i)].reverse().find(m=>m.role==='user');
    rico.messages.splice(i, 1);
    if(lastUser){ rico.messages.splice(rico.messages.lastIndexOf(lastUser), 1); ricoAsk(lastUser.text); }
    else render();
  });
}

function ricoOrderIntent(text){
  return /(?:prepare|make|do|build).*(?:today|today’s|todays).*(?:order)|(?:today|today’s|todays).*(?:order)/i.test(text)
    || /(?:داواکاری|داواکردن).*ئەمڕۆ|ئەمڕۆ.*(?:داواکاری|داواکردن)/.test(text)
    || /(?:طلب|طلبية|طلبات).*اليوم|اليوم.*(?:طلب|طلبية|طلبات)/.test(text);
}
function ricoChooseScope(i, ids){
  const picker = rico.messages[i]?.picker;
  const chosen = [...new Set(ids)].filter(id=>state.suppliers.some(s=>s.id===id));
  if(!picker || picker.chosen || !chosen.length || rico.streaming) return;
  picker.chosen = true;
  ricoPaintMessage(i);
  const names = chosen.map(id=>state.suppliers.find(s=>s.id===id).name);
  ricoAsk(t('ricoScopedPrompt')(names), {quickAction:'prepare_order', supplierIds:chosen});
}

/* ---------- Talking to the server ---------- */
function ricoHistoryForServer(){
  return rico.messages.filter(m=>!m.streaming && !(m.role==='assistant' && !m.text && !(m.proposals||[]).length)).slice(-RICO_HISTORY_SENT).map(m=>{
    let content = ricoClean(m.text);
    (m.proposals||[]).forEach(p=>{
      const what = {order:`order draft (${(p.lines||[]).length} items)`, new_item:`add item "${p.name}"`, edit_item:`edit item "${p.name}"`, new_supplier:`add supplier "${p.name}"`, notify:'notification', open:`open ${p.screen}`, streak:`bring back the ${p.days}-day streak`}[p.kind] || p.kind;
      content += `\n[card ${what}: ${p.status || 'waiting for the person'}]`;
    });
    return {role:m.role, content: content.trim() || '…'};
  });
}
function ricoStop(){
  if(rico.abort){ rico.abort.abort(); rico.abort = null; }
}
async function ricoAsk(text, options = {}){
  if(rico.streaming) return;
  const scopeIds = options.supplierIds || [];
  const named = state.suppliers.filter(s=>String(text).toLocaleLowerCase().includes(s.name.toLocaleLowerCase())).map(s=>s.id);
  if(rico.viewing){ rico.viewing = null; rico.messages = []; rico.chatId = null; }
  if(!options.voiceOrder && (options.quickAction==='prepare_order' || ricoOrderIntent(text)) && !scopeIds.length && !named.length){
    rico.messages.push({role:'user', text, ts:Date.now()});
    rico.messages.push({role:'assistant', text:t('ricoChooseSuppliers'), picker:{selectedIds:[], chosen:false}, ts:Date.now()});
    if(state.view !== 'assistant') goView('assistant'); else render();
    ricoScroll(true);
    return;
  }
  if(named.length && (options.quickAction==='prepare_order' || ricoOrderIntent(text)) && !scopeIds.length){
    options = {quickAction:'prepare_order', supplierIds:named};
  }
  const previousView = state.view;
  const requestAccount = state.account;
  rico.messages.push({role:'user', text, ts:Date.now()});
  const bot = {role:'assistant', text:'', proposals:[], steps:[], streaming:true, statusKey:'thinking', ts:Date.now()};
  rico.messages.push(bot);
  rico.streaming = true;
  if(state.view !== 'assistant') goView('assistant'); else render();
  ricoScroll(true);
  const idx = rico.messages.length - 1;
  const controller = new AbortController();
  rico.abort = controller;
  let frame = 0;
  const paint = ()=>{ if(frame) return; frame = requestAnimationFrame(()=>{ frame = 0; ricoPaintMessage(idx); }); };
  const body = {
    messages: ricoHistoryForServer(), lang: state.lang, screen: previousView,
    autoOrder: ricoAutoOrder() || !!options.voiceOrder, cart: Object.fromEntries(Object.entries(state.cart).filter(([,q])=>q>0)),
    quickAction: options.quickAction || undefined, supplierIds: options.supplierIds || undefined,
  };
  await apiStream('assistant/chat', body, ev=>{
    if(ev.type === 'text'){ bot.text += ev.text; bot.statusKey = null; bot.stepsDone = true; paint(); }
    else if(ev.type === 'status'){
      bot.statusKey = ev.tool;
      if(bot.steps[bot.steps.length-1] !== ev.tool) bot.steps.push(ev.tool);
      bot.stepsDone = false;
      paint();
    }
    else if(ev.type === 'proposal'){
      const p = {...ev.proposal, status:'pending'};
      bot.proposals.push(p);
      if(p.kind === 'order' && (ricoAutoOrder() || options.voiceOrder)){ ricoApplyOrder(p, true); }
      paint();
    }
    else if(ev.type === 'mood'){ bot.mood = ev.mood; paint(); ricoPaintHeadFace(); }
    else if(ev.type === 'error'){ bot.error = ev.code; bot.retry = ['offline','busy','failed'].includes(ev.code); paint(); }
  }, controller.signal);
  if(state.account !== requestAccount) return;
  cancelAnimationFrame(frame);
  bot.streaming = false; bot.statusKey = null;
  if(controller.signal.aborted && !bot.text && !bot.proposals.length) bot.error = 'stopped';
  if(!controller.signal.aborted && !bot.text && !bot.proposals.length && !bot.error){ bot.error = 'failed'; bot.retry = true; }
  rico.streaming = false; rico.abort = null;
  ricoSaveSoon();
  if(state.view === 'assistant'){
    ricoPaintMessage(idx);
    ricoRefreshComposer();
    ricoPaintHeadFace();
    document.getElementById('ricoNewBtn')?.removeAttribute('disabled');
  }
}
/* Rico's face in the header follows his latest mood (without re-drawing the page). */
function ricoPaintHeadFace(){
  const face = document.querySelector('.rico-head .rico-bot');
  if(!face) return;
  const mood = ricoCurrentMood();
  RICO_MOODS.forEach(m=>face.classList.toggle('mood-'+m, m === mood));
}
/* Repaints one message in place (no full re-render while text streams in). */
function ricoPaintMessage(i){
  const el = document.getElementById('rico-m-'+i);
  const m = rico.messages[i];
  if(!el || !m) return;
  const wasNear = ricoNearBottom();
  const tmp = document.createElement('div');
  tmp.innerHTML = renderRicoMessage(m, i);
  const fresh = tmp.firstElementChild;
  fresh.classList.add('painted');
  el.replaceWith(fresh);
  if(m.streaming && m.text){
    const last = fresh.querySelector('.rico-text > :last-child');
    if(last) last.insertAdjacentHTML('beforeend', '<span class="rico-caret" aria-hidden="true"></span>');
  }
  attachRicoThreadEvents(fresh);
  if(wasNear) ricoScroll(false);
}
function ricoRefreshComposer(){
  const form = document.getElementById('ricoComposer');
  if(form){
    form.classList.toggle('recording', ricoRecorder.active);
    form.classList.toggle('transcribing', ricoRecorder.busy);
    const input = document.getElementById('ricoInput');
    if(input) input.placeholder = ricoComposerHint();
    const mic = document.getElementById('ricoMicBtn');
    if(mic){ mic.setAttribute('aria-pressed', String(ricoRecorder.active)); mic.disabled = ricoRecorder.busy || rico.streaming; }
  }
  const btn = document.getElementById('ricoSendBtn');
  if(!btn) return;
  btn.classList.toggle('stop', rico.streaming);
  btn.innerHTML = rico.streaming ? ICON_STOP : ICON_SEND_UP;
  btn.setAttribute('aria-label', rico.streaming ? t('ricoStop') : t('ricoSend'));
}
function ricoNearBottom(){ const box = scrollBox(); return box.scrollTop + box.clientHeight >= box.scrollHeight - 220; }
function ricoScroll(smooth){
  requestAnimationFrame(()=>scrollBox().scrollTo({top:scrollBox().scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'}));
}

/* ---------- Carrying out a confirmed proposal ---------- */
function ricoFind(mi, id){ const m = rico.messages[mi]; return m && (m.proposals||[]).find(p=>p.id===id); }
function ricoSetStatus(mi, id, status, extra = {}){
  const p = ricoFind(mi, id); if(!p) return;
  Object.assign(p, {status}, extra);
  if(status !== 'saving') ricoSaveSoon();
  if(state.view === 'assistant') ricoPaintMessage(mi);
}
function ricoApplyOrder(p, auto){
  const before = {...state.cart};
  if(p.mode !== 'add' && p.mode !== 'set') state.cart = {};
  let n = 0;
  p.lines.forEach(l=>{
    if(!state.items.some(i=>i.id===l.itemId)) return;
    // 'set' may take an item out (qty 0); every other line is at least one.
    if(p.mode === 'set' && !(Number(l.qty) > 0)){ delete state.cart[l.itemId]; n++; return; }
    const q = Math.max(1, Math.round(Number(l.qty) || 1));
    state.cart[l.itemId] = p.mode === 'add' ? (state.cart[l.itemId]||0) + q : q;
    n++;
  });
  persistCartDraft();
  Object.assign(p, {status:'applied', undo:before, auto:!!auto, doneLabel:t('ricoOrderApplied')(n)});
  if(!auto) toast(t('ricoOrderApplied')(n));
}
async function ricoApply(mi, id, btn){
  const p = ricoFind(mi, id);
  if(!p || p.status !== 'pending') return;
  const run = async ()=>{
    if(p.kind === 'order'){ ricoApplyOrder(p, false); return true; }
    if(p.kind === 'new_item'){
      const supplierId = p.supplierId && state.suppliers.some(s=>s.id===p.supplierId) ? p.supplierId : null;
      const maxSort = state.items.filter(i=>i.supplierId===supplierId).reduce((mx,i)=>Number.isInteger(i.sortOrder)?Math.max(mx,i.sortOrder):mx,-1);
      const next = {id:'i'+outboxJobId(), name:p.name, unit:p.unitId, supplierId, sortOrder:maxSort>=0?maxSort+1:null};
      if(!(await saveRecord('items', next))){ await showAlert(t('saveFailed')); return false; }
      state.items.push(next);
      logActivity({action:'add', type:'item', name:p.name, fields:[{k:'name',to:p.name},{k:'unit',to:unitEn(p.unitId)},{k:'supplier',to:supplierId?supplierName(supplierId):''}]});
      p.doneLabel = t('savedMsg')(p.name).replace(/^\u2713\s*/, '');
      return true;
    }
    if(p.kind === 'edit_item'){
      const i = state.items.find(x=>x.id===p.itemId);
      if(!i){ await showAlert(t('saveFailed')); return false; }
      const supplierId = p.supplierId && state.suppliers.some(s=>s.id===p.supplierId) ? p.supplierId : null;
      const fields = diffFields([['name', i.name, p.name], ['unit', unitEn(i.unit), unitEn(p.unitId)], ['supplier', i.supplierId?supplierName(i.supplierId):'', supplierId?supplierName(supplierId):'']]);
      const next = {...i, name:p.name, unit:p.unitId, supplierId, sortOrder: supplierId===i.supplierId ? i.sortOrder : null};
      if(!(await saveRecord('items', next))){ await showAlert(t('saveFailed')); return false; }
      Object.assign(i, next);
      if(fields.length) logActivity({action:'edit', type:'item', name:p.name, fields});
      p.doneLabel = t('savedMsg')(p.name).replace(/^\u2713\s*/, '');
      return true;
    }
    if(p.kind === 'new_supplier'){
      const next = {id:'s'+outboxJobId(), name:p.name, phone:p.phone||'', reminder:null};
      if(!(await saveRecord('suppliers', next))){ await showAlert(t('saveFailed')); return false; }
      state.suppliers.push(next);
      logActivity({action:'add', type:'supplier', name:p.name, fields:[{k:'name',to:p.name}].concat(p.phone?[{k:'phone',to:p.phone}]:[])});
      p.doneLabel = t('savedMsg')(p.name).replace(/^\u2713\s*/, '');
      return true;
    }
    if(p.kind === 'streak'){
      const r = await api('streak/recover', {method:'POST'});
      if(!r.ok || !r.data?.streak){ await showAlert(t('streakRecoverFailed')); return false; }
      state.streak = r.data.streak;
      paintStreakChip(true);
      p.doneLabel = t('streakRecovered')(r.data.streak.count);
      return true;
    }
    if(p.kind === 'notify'){
      const res = await callSendPush('assistant', {title:p.title, bodyEn:p.en, bodyKu:p.ku, bodyAr:p.ar});
      await reportSendResult(res);
      if(!res.ok) return false;
      p.doneLabel = t('ricoNotificationSent');
      return true;
    }
    return false;
  };
  p.status = 'saving';
  if(btn){ btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy','true'); }
  if(state.view === 'assistant') ricoPaintMessage(mi);
  const ok = await run().catch(()=>false);
  p.status = ok ? 'applied' : 'pending';
  if(state.view === 'assistant') ricoPaintMessage(mi);
}
function ricoUndo(mi, id){
  const p = ricoFind(mi, id);
  if(!p || !p.undo) return;
  state.cart = p.undo; persistCartDraft();
  ricoSetStatus(mi, id, 'undone', {undo:null});
  toast(t('ricoUndoneToast'));
}

/* ---------- Chat history ----------
   A chat is saved to this account on the server after each reply and whenever a card changes, so it
   can be opened again later, also on the person's other phone (kept 90 days, newest 60). Cards in a
   reopened chat can no longer be pressed: the data may have changed since. */
let ricoSaveTimer = 0;
function ricoChatTitle(){
  const first = rico.messages.find(m=>m.role === 'user');
  return first ? ricoClean(first.text).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}
function ricoSerialize(){
  return rico.messages.filter(m=>!m.streaming && (m.role === 'user' || m.text || (m.proposals||[]).length || m.error)).slice(-200).map(m=>{
    const out = {role:m.role, text:m.text || '', ts:m.ts || Date.now()};
    if(m.mood) out.mood = m.mood;
    if(m.error) out.error = m.error;
    if(m.steps && m.steps.length) out.steps = m.steps;
    if(m.proposals && m.proposals.length) out.proposals = m.proposals.map(({undo, ...p})=>({...p, status: p.status === 'saving' ? 'pending' : p.status}));
    return out;
  });
}
function ricoSaveSoon(){
  clearTimeout(ricoSaveTimer);
  if(rico.viewing) return;
  if(rico.messages.some(m=>m.role === 'user')) ricoSaveTimer = setTimeout(ricoSave, 600);
}
async function ricoSave(){
  clearTimeout(ricoSaveTimer);
  if(rico.viewing) return;
  const messages = ricoSerialize();
  if(!messages.some(m=>m.role === 'user')) return;
  if(!rico.chatId) rico.chatId = crypto.randomUUID();
  const id = rico.chatId, account = state.account, title = ricoChatTitle();
  const r = await api('rico-chats/' + id, {method:'PUT', body:{title, messages}});
  if(!r.ok || state.account !== account || !rico.chats) return;
  rico.chats = [{id, account, title, updatedAt:new Date().toISOString()}, ...rico.chats.filter(c=>c.id !== id)].slice(0, 120);
}
async function ricoLoadChats(){
  if(rico.chatsBusy) return;
  rico.chatsBusy = true;
  const account = state.account;
  try{
    let r = await api('rico-chats');
    if(r.stale && state.account === account) r = await api('rico-chats');   // a save happened at the same moment
    if(r.ok && Array.isArray(r.data?.chats) && state.account === account) rico.chats = r.data.chats;
  }finally{ rico.chatsBusy = false; }
}
/* This person's own chats (the list also holds the other person's). */
const myChats = () => (rico.chats || []).filter(c=>(c.account || state.account) === state.account);
/* A new chat: the current one stays in Chat history. */
function ricoNewChat(){
  if(rico.streaming) ricoStop();
  if(rico.messages.length) ricoSave();
  rico.messages = []; rico.chatId = null; rico.viewing = null;
  render();
}
async function ricoOpenChat(id){
  if(rico.streaming) return false;
  let r = await api('rico-chats/' + encodeURIComponent(id));
  if(r.stale) r = await api('rico-chats/' + encodeURIComponent(id));   // a save happened at the same moment
  if(!r.ok || !Array.isArray(r.data?.messages)){ toast(t('ricoChatLoadFailed'), 'error'); return false; }
  if(rico.chatId !== id && rico.messages.length) ricoSave();
  clearTimeout(ricoSaveTimer);
  // The other person's chat opens read only: it can be read and deleted, never continued.
  rico.viewing = r.data.account && r.data.account !== state.account ? r.data.account : null;
  rico.chatId = rico.viewing ? null : id;
  rico.viewedId = rico.viewing ? id : null;
  rico.messages = r.data.messages.map(m=>({...m, proposals:(m.proposals||[]).map(p=>({...p, undo:undefined, status: !p.status || p.status === 'pending' || p.status === 'saving' ? 'expired' : p.status}))}));
  if(state.view !== 'assistant') goView('assistant'); else render();
  ricoScroll(false);
  return true;
}
/* Chat history: a sheet from the bottom with two lists, this person's chats and the other person's
   (Rozha and Yunis can read and delete each other's), newest first, by day. */
function ricoOpenHistory(){
  closeSelSheet();
  document.activeElement?.blur?.();
  const other = state.account === 'rozha' ? 'yunis' : 'rozha';
  let whose = rico.viewing || state.account;
  const wrap = document.createElement('div');
  wrap.id = 'ricoHistSheet'; wrap.className = 'sel-sheet rico-hist-sheet';
  wrap.innerHTML = `<div class="sel-scrim"></div><div class="sel-panel" role="dialog" aria-modal="true" aria-label="${esc(t('ricoHistory'))}">
    <div class="sel-grab"></div>
    <div class="rico-hist-top"><div class="sel-title">${esc(t('ricoHistory'))}</div><button type="button" class="btn btn-primary" data-hist-new>${ICON_NEW_CHAT}<span>${esc(t('ricoNewChat'))}</span></button></div>
    <div class="pill-seg rico-hist-tabs" role="tablist"><button type="button" role="tab" class="pill-seg-btn" data-hist-tab="${state.account}">${esc(t('ricoHistoryMine'))}</button><button type="button" role="tab" class="pill-seg-btn" data-hist-tab="${other}">${esc(t('ricoHistoryOf')(accountLabel(other)))}</button></div>
    <div class="sel-list rico-hist-list"></div></div>`;
  document.body.appendChild(wrap);
  const list = wrap.querySelector('.rico-hist-list');
  let confirming = null;   // the chat id (or 'all') waiting for a second tap on Delete
  const paint = ()=>{
    wrap.querySelectorAll('[data-hist-tab]').forEach(b=>b.setAttribute('aria-selected', b.dataset.histTab === whose));
    if(!rico.chats){ list.innerHTML = `<div class="field-hint rico-hist-empty">${esc(t('loading'))}</div>`; return; }
    const chats = rico.chats.filter(c=>(c.account || state.account) === whose);
    if(!chats.length){ list.innerHTML = `<div class="field-hint rico-hist-empty">${esc(whose === state.account ? t('ricoHistoryEmpty') : t('ricoHistoryEmptyOf')(accountLabel(whose)))}</div>`; return; }
    let lastDay = '';
    list.innerHTML = chats.map(c=>{
      const day = dayLabel(c.updatedAt), head = day !== lastDay ? `<div class="rico-hist-day">${esc(day)}</div>` : '';
      lastDay = day;
      const asking = confirming === c.id;
      return `${head}<div class="rico-hist-row${c.id === rico.chatId ? ' on' : ''}${asking ? ' asking' : ''}">
        <button type="button" class="rico-hist-open" data-hist-open="${esc(c.id)}"><span dir="auto">${esc(c.title || t('ricoUntitled'))}</span><small>${esc(formatIraqDateTime(c.updatedAt,{hour:'numeric',minute:'2-digit'}))}</small></button>
        ${asking ? `<button type="button" class="btn btn-danger rico-hist-yes" data-hist-yes="${esc(c.id)}">${esc(t('delete'))}</button>`
          : `<button type="button" class="icon-btn danger" data-hist-del="${esc(c.id)}" aria-label="${esc(t('ricoDeleteChat'))}">${ICON_DELETE}</button>`}
      </div>`;
    }).join('') + `<button type="button" class="rico-hist-all${confirming === 'all' ? ' asking' : ''}" data-hist-all>${esc(confirming === 'all' ? t('ricoDeleteAllConfirm') : whose === state.account ? t('ricoDeleteAll') : t('ricoDeleteAllOf')(accountLabel(whose)))}</button>`;
  };
  paint();
  if(!rico.chats) ricoLoadChats().then(paint);
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
  wrap.querySelector('[data-hist-new]').onclick = ()=>{ close(); ricoNewChat(); };
  wrap.querySelectorAll('[data-hist-tab]').forEach(b=>b.onclick = ()=>{ whose = b.dataset.histTab; confirming = null; paint(); });
  list.onclick = async e=>{
    const open = e.target.closest('[data-hist-open]'), del = e.target.closest('[data-hist-del]'), yes = e.target.closest('[data-hist-yes]'), all = e.target.closest('[data-hist-all]');
    if(open){ if(await ricoOpenChat(open.dataset.histOpen)) close(); return; }
    if(del){ confirming = del.dataset.histDel; paint(); return; }
    if(all && confirming !== 'all'){ confirming = 'all'; paint(); return; }
    if(!yes && !all) return;
    const id = yes ? yes.dataset.histYes : null;
    clearTimeout(ricoSaveTimer);
    const r = await api(id ? 'rico-chats/' + id : 'rico-chats?account=' + whose, {method:'DELETE'});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    rico.chats = id ? rico.chats.filter(c=>c.id !== id) : rico.chats.filter(c=>(c.account || state.account) !== whose);
    const gone = id ? rico.chatId === id : whose === state.account;
    if(gone){ rico.chatId = null; if(rico.messages.length && !rico.streaming && !rico.viewing){ rico.messages = []; } }
    if(rico.viewing && (id ? id === rico.viewedId : whose === rico.viewing)){ rico.viewing = null; rico.messages = []; }
    confirming = null; paint();
    if(state.view === 'assistant') render();
  };
  requestAnimationFrame(()=>{ if(!closed) list.querySelector('button')?.focus({preventScroll:true}); });
}
