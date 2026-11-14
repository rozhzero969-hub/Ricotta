/* Rico -- the in-app AI assistant (the "Rico" tab).
   Talks to POST api/assistant/chat, which streams the reply (see
   supabase/functions/api/assistant.ts). Rico PROPOSES changes: each proposal is
   a card here, and nothing happens until the person taps it; the change is then
   made through the normal API with this person's session. The one exception is
   the WhatsApp TEST: when Rozh asks, Rico sends an order to her own WhatsApp
   himself (History › Rico's orders).
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
const ICON_RICO_SETTINGS = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`;
const ICON_RR_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>`;
const ICON_NEW_CHAT = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

const rico = {
  epoch: 0,             // invalidates work from a closed chat or previous sign-in
  chatRequest: 0,
  messages: [],
  streaming: false,
  abort: null,
  inbox: [],           // messages Rico wrote first: {id, kind, mood, en, ku, ar, at, read}
  chatId: null,        // the saved chat these messages belong to (made on the first save)
  chats: null,         // one shared list of both accounts' saved chats {id, account, title, updatedAt}, newest first (null until loaded)
  chatsBusy: false,
  viewing: null,       // the other person's account while one of their chats is open (read only)
};

/* Rico is a plain green sparkle everywhere (Rozh's choice, 2026-11-13): no face, no moods, no
   animations. The mood words below are only taken out of older replies that still carry them. */
const RICO_MOODS = ['happy','excited','grateful','calm','thinking','worried','sad','angry'];
function ricoFace(_mood, cls = ''){ return `<span class="rico-bot rico-plain ${cls}" aria-hidden="true">${ICON_SPARKLE}</span>`; }

function ricoAutoOrder(){ return !!lget('ricoAutoOrder'); }
/* Apple's rule (App Review 5.1.2): before anything goes to an AI service, the person is told where it
   goes and says yes. Asked the first time Rico (or reading a list) is used, kept per person on this
   device, and taken back with the switch in Settings. Not Now simply asks again next time. */
// v2 (ROZH-25): Anthropic (Claude) was added to the services Rico uses, so everyone is asked once more.
const aiConsentKey = ()=>'aiConsent2:' + state.account;
function aiConsented(){ return lget(aiConsentKey()) === true; }
function setAiConsent(on){ lset(aiConsentKey(), on ? true : null); }
async function aiConsent(){
  if(!state.account) return false;
  const context = ricoContext();
  if(aiConsented()) return true;
  const yes = await showConfirm(esc(t('aiBody')), {title:t('aiTitle'), okLabel:t('aiAllow'), cancelLabel:t('aiNotNow'), okClass:'btn-primary'});
  if(!ricoContextCurrent(context)) return false;
  if(yes) setAiConsent(true);
  return yes;
}
/* Signing out forgets the chat and the inbox on this phone. */
function ricoReset(){
  rico.epoch++; rico.chatRequest++;
  ricoStop(); clearTimeout(ricoSaveTimer);
  rico.messages = []; rico.streaming = false; rico.inbox = []; rico.chatId = null; rico.chats = null; rico.chatsBusy = false; rico.viewing = null; rico.viewedId = null;
}

/* ---------- Rico's inbox ---------- */
function ricoSetInbox(list){ rico.inbox = Array.isArray(list) ? list : []; if(typeof ricoAutoFillRoutines === 'function') ricoAutoFillRoutines(); }
function ricoUnread(){ return rico.inbox.filter(m=>!m.read).length; }
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
  if(!state.account || !canOpen('assistant')) return;   // Rico is off for this person
  const r = await api('assistant/inbox');
  if(!r.ok || !Array.isArray(r.data)) return;
  const before = rico.inbox.map(m=>m.id+':'+m.read).join();
  ricoSetInbox(r.data);
  if(rico.inbox.map(m=>m.id+':'+m.read).join() === before) return;
  if(state.view === 'assistant'){ render(); ricoMarkInboxRead(); } else updateRicoBadge();
}
setInterval(()=>{ if(document.visibilityState === 'visible') ricoRefreshInbox(); }, 3*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') ricoRefreshInbox(); });

/* ---------- Late orders (same rule as the server's push alert) ---------- */
function erbilNow(){
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const g = k=>p.find(x=>x.type===k).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  return {date, minutes:+g('hour')*60 + +g('minute'), weekday:new Date(date+'T12:00:00Z').getUTCDay()};
}
/* The Baghdad calendar day of a time, as YYYY-MM-DD. It runs for every order on several screens, so it
   uses the one shared formatter (BAGHDAD_DAY): creating formatters is slow on phones. */
const BAGHDAD_DAY = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'});
function erbilDate(iso){ return BAGHDAD_DAY.format(new Date(iso)); }
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
/* Rico's screen (2026-11-13), like a chat app: on a computer the chats are listed on the left (New chat
   on top, then the chats by day, then two plain settings rows: letting Rico fill the order, and what he
   remembers); the chat is on the right. On a phone the header has two named buttons, Chats and New
   chat, and the same list opens as a sheet. */
function renderAssistant(){
  const head = `<header class="rico-head">
      ${ricoFace('', 'rico-md')}
      <div class="rico-head-text">
        <div class="rico-name">${esc(t('ricoName'))}</div>
        <div class="rico-who">${esc(t('ricoTalkingWith')(accountLabel(state.account)))}</div>
      </div>
      <div class="rico-head-title" dir="auto">${esc(ricoHeadTitle())}</div>
      <div class="rico-head-actions">
        <button type="button" class="rico-head-btn" id="ricoHistBtn">${NAV_ICONS.history}<span>${esc(t('ricoChats'))}</span></button>
        <button type="button" class="rico-head-btn" id="ricoNewBtn" ${rico.messages.length?'':'disabled'}>${ICON_NEW_CHAT}<span>${esc(t('ricoNewChat'))}</span></button>
        <button type="button" class="rico-head-btn icon" data-rico-settings-open aria-label="${esc(t('ricoSettings'))}">${ICON_RICO_SETTINGS}</button>
      </div>
    </header>`;
  const thread = rico.messages.length
    ? rico.messages.map((m,i)=>ricoTimeDivider(rico.messages[i-1], m) + renderRicoMessage(m,i)).join('')
    : renderRicoIntro();
  const viewing = rico.viewing ? `<div class="rico-viewing" role="status"><span>${esc(t('ricoReadOnly')(accountLabel(rico.viewing)))}</span></div>` : '';
  const empty = !rico.messages.length;
  return `<div class="rico-page${empty ? ' empty' : ''}">${renderRicoSide()}<div class="rico-main">${head}${viewing}${rico.viewing || empty ? '' : renderRicoInbox()}<div class="rico-thread${rico.viewing ? ' read-only' : ''}" id="ricoThread" aria-live="polite">${thread}</div></div></div>`;
}
/* The open chat's name, shown above it on a computer (like a chat app). */
function ricoHeadTitle(){
  const id = rico.viewedId || rico.chatId, c = id && rico.chats?.find(x=>x.id === id);
  return (c && c.title) || ricoChatTitle() || t('ricoNewChat');
}
/* Leaving Rico on a computer: back to the screen it was opened from. */
function ricoLeave(){
  const back = state.ricoBack && state.ricoBack !== 'assistant' && canOpen(state.ricoBack) ? state.ricoBack : (state.tabs.find(v=>v !== 'assistant') || 'order');
  goView(back);
}
/* The chats on the left (computers only; CSS hides it on phones). */
function renderRicoSide(){
  let lastDay = '';
  const rows = !rico.chats ? loadingLines(4) : !rico.chats.length ? `<p class="rico-side-empty">${esc(t('ricoNoChatsYet'))}</p>`
    : rico.chats.slice(0, 40).map(c=>{
      const day = dayLabel(c.updatedAt), head = day !== lastDay ? `<div class="rico-side-day">${esc(day)}</div>` : '';
      lastDay = day;
      const on = c.id === rico.chatId || c.id === rico.viewedId;
      const other = c.account && c.account !== state.account;
      return `${head}<button type="button" class="rico-side-chat${on ? ' on' : ''}" data-side-open="${esc(c.id)}"${on ? ' aria-current="true"' : ''}><span dir="auto">${esc(c.title || t('ricoUntitled'))}</span>${other ? `<small>${esc(accountLabel(c.account))}</small>` : ''}</button>`;
    }).join('');
  return `<aside class="rico-side" aria-label="${esc(t('ricoChats'))}">
      <div class="rico-side-top">
        <button type="button" class="rico-back" data-rico-leave aria-label="${esc(t('ricoBack'))}" title="${esc(t('ricoBack'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span class="brand-mark">ricotta</span><span class="dot"></span></button>
        <button type="button" class="side-toggle" data-side-toggle aria-label="${esc(t('sideHide'))}" title="${esc(t('sideHide'))}">${ICON_SIDEBAR}</button>
      </div>
      <button type="button" class="rico-side-new" data-side-new ${rico.messages.length ? '' : 'disabled'}>${ICON_NEW_CHAT}<span>${esc(t('ricoNewChat'))}</span></button>
      ${rico.chats?.length > 6 ? `<label class="rico-side-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input type="search" data-side-search placeholder="${esc(t('ricoSearchChats'))}" aria-label="${esc(t('ricoSearchChats'))}" autocomplete="off"></label>` : ''}
      <div class="rico-side-list">${rows}</div>
      ${rico.chats?.length ? `<button type="button" class="rico-side-link" data-side-all>${esc(t('ricoManageChats'))}</button>` : ''}
      <button type="button" class="rico-side-set" data-rico-settings-open>${ICON_RICO_SETTINGS}<span>${esc(t('ricoSettings'))}</span></button>
    </aside>`;
}
/* Letting Rico fill the order on this device: asked once when turned on. */
async function ricoSetAuto(on){
  if(on && !(await showConfirm(t('ricoAutoOrderConfirm'), {okLabel:t('ricoAllow'), okClass:'btn-primary'}))){ render(); return; }
  lset('ricoAutoOrder', on || null);
  toast(on ? t('ricoAutoOn') : t('ricoAutoOff'));
  render();
}
/* Rico's own settings, from the sliders button in his sidebar (or his header on a phone): everything
   about the chat Rico lives here; Rico the helper on the Mac stays in Settings. */
function openRicoSettings(){
  const sw = (attr, on, label, hint)=>`<label class="rico-side-row rico-set-row"><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span><input type="checkbox" role="switch" ${attr} ${on ? 'checked' : ''}></label>`;
  const styles = CHOICES.ricoStyle.map(v=>`<label class="rico-style-opt"><input type="radio" name="ricoStyle" value="${v}" ${ricoStyle() === v ? 'checked' : ''}><span>${esc(t('style_' + v))}</span></label>`).join('');
  const {el, close} = openKitchenSheet('rico-set-sheet', `<div class="sel-title">${esc(t('ricoSettings'))}</div>
    <div class="rico-set-group">
      ${sw('data-set-auto', ricoAutoOrder(), t('ricoAutoOrderLabel'), t('ricoAutoOrderHint'))}
      <button type="button" class="rico-side-row rico-set-row" data-set-memory><span>${esc(t('memoryTitle'))}</span><i class="sheet-chevron" aria-hidden="true"></i></button>
    </div>
    <div class="rico-set-label">${esc(t('styleLabel'))}</div>
    <div class="rico-set-group rico-style">${styles}</div>
    <div class="rico-set-group">
      ${sw('data-set-sheet', featureOn('ricoSheet'), t('feat_ricoSheet'), t('feat_ricoSheet_hint'))}
      ${sw('data-set-ai', aiConsented(), t('aiSettingLabel'), t('aiSettingHint'))}
    </div>`, t('ricoSettings'));
  el.querySelector('[data-set-auto]').onchange = e=>{ const on = e.currentTarget.checked; close(); ricoSetAuto(on); };
  el.querySelector('[data-set-memory]').onclick = ()=>{ close(); openRicoMemory(); };
  el.querySelectorAll('input[name=ricoStyle]').forEach(r=>r.onchange = ()=>setSetting('ricoStyle', r.value));
  el.querySelector('[data-set-sheet]').onchange = async e=>{ const box = e.currentTarget; if(!(await setFeature('ricoSheet', box.checked))) box.checked = !box.checked; };
  el.querySelector('[data-set-ai]').onchange = async e=>{ const box = e.currentTarget; if(!box.checked){ setAiConsent(false); return; } box.checked = await aiConsent(); };
}
/* A small date and time line where a chat starts, a new day begins, or after a half-hour pause. */
function ricoTimeDivider(prev, m){
  if(!m.ts) return '';
  if(prev && prev.ts && erbilDate(prev.ts) === erbilDate(m.ts) && m.ts - prev.ts < 30*60000) return '';
  return `<div class="rico-time"><span>${esc(dayLabel(m.ts))} · ${esc(formatIraqDateTime(m.ts,{hour:'numeric',minute:'2-digit'}))}</span></div>`;
}
/* The newest few messages Rico wrote first, above the chat. */
function renderRicoInbox(){
  const list = rico.inbox.slice(-1);
  if(!list.length) return '';
  return `<div class="rico-inbox">${list.map(m=>`
    <div class="rico-note ${m.read?'':'unread'}">
      ${ricoFace('', 'rico-sm')}
      <div class="rico-note-body"><div class="rico-note-meta">${esc(t('ricoWroteFirst'))} · ${esc(timeAgo(m.at))}</div><div class="rico-note-text" dir="auto">${esc(ricoInboxText(m))}</div>${ricoNoteAction(m)}</div>
    </div>`).join('')}${rico.inbox.length > 1 ? `<button type="button" class="rico-link rico-inbox-more" id="ricoInboxAll">${esc(t('inboxSeeAll')(rico.inbox.length))}</button>` : ''}</div>`;
}
/* A prepared order (from a routine) carries its own button that fills the Order screen. */
function ricoNoteAction(m){
  return m.kind === 'routine_order' && Array.isArray(m.order?.lines) && canOpen('order')
    ? `<button type="button" class="btn btn-primary rico-note-btn" data-routine-fill="${esc(m.id)}">${esc(t('inboxOpenOrder'))}</button>` : '';
}
function renderRicoIntro(){
  // A calm first screen, like a chat app's: a greeting, Rico's latest note, and a few things to ask.
  // Stock, what needs you and prices come first for people who use Receipts or Transfers.
  const chips = t('ricoSuggestions'), rr = t('ricoTilesRR');
  const base = [['prepare_order',chips[0],'order'],['week_insights',chips[2],'reports'],['late_orders',chips[5],'late'],['check_order',chips[1],'check'],['last_order',chips[3],'history'],['add_item',chips[4],'add']];
  const extra = [
    ...(canOpen('transfers') ? [['', rr[0], 'stock']] : []),
    ...(canOpen('transfers') || canOpen('receipts') ? [['', rr[1], 'needs']] : []),
    ...(canOpen('receipts') ? [['', rr[2], 'price']] : []),
  ];
  const tiles = [...extra, ...base].slice(0, 6);
  return `<div class="rico-intro">
    <div class="rico-hello">${ricoFace('', 'rico-lg')}<h2>${esc(ricoGreeting())}</h2><p>${esc(t('ricoIntroSub'))}</p></div>
    ${renderRicoInbox()}
    <div class="rico-tiles">${tiles.map(([action, text, icon])=>`<button type="button" class="rico-tile" data-rico-ask="${esc(text)}"${action ? ` data-rico-action="${action}"` : ''}>${RICO_TILE_ICONS[icon] || ''}<span>${esc(text)}</span></button>`).join('')}</div>
  </div>`;
}
const RICO_TILE_ICON = d=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const RICO_TILE_ICONS = {
  stock: RICO_TILE_ICON('<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>'),
  needs: RICO_TILE_ICON('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/>'),
  price: RICO_TILE_ICON('<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>'),
  order: RICO_TILE_ICON('<path d="M6 6h15l-2 8H8z"/><path d="M6 6L5 3H3"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>'),
  reports: RICO_TILE_ICON('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
  late: RICO_TILE_ICON('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  check: RICO_TILE_ICON('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  history: RICO_TILE_ICON('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>'),
  add: RICO_TILE_ICON('<path d="M12 5v14M5 12h14"/>'),
};
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
  return `<div class="rico-msg bot${m.streaming?' streaming':''}" id="rico-m-${i}">
    ${ricoFace('', 'rico-sm')}
    <div class="rico-col">
      ${stepsHtml}${typing}${body ? `<div class="rico-bubble" dir="auto"><div class="rico-text">${body}</div></div>` : ''}${status}${picker}${cards}${renderRicoReceipt(m, i)}${err}
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
/* Rico never shows emojis or picture symbols, even when the AI writes one anyway. ©, ® and ™ stay. */
const RICO_PICTURES = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u2713\u2717]\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*|[\uFE0F\u20E3]/gu;
function ricoNoPictures(s){
  return String(s || '').replace(RICO_PICTURES, m=>/^[\u00A9\u00AE\u2122]/.test(m) ? m : '').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
}
function ricoClean(s){
  // Older replies may still carry an em dash (or a spaced en dash) as a pause: a comma reads cleaner.
  return ricoNoPictures(String(s || '').replace(/\[\[\s*data\s*:\s*([^\]]*?)\s*\]\]/gi, '$1').replace(/<<\/?DATA>>/gi, '').replace(RICO_MOOD_TAG, '')
    .replace(/\s*\u2014\s*|\s+\u2013\s+/g, ', '));
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
  if(!p || typeof p!=='object' || Array.isArray(p) || (p.kind==='order' && !Array.isArray(p.lines)))return '';
  try{return renderRicoProposalCard(p,mi);}catch(_){return '';}
}
function renderRicoProposalCard(p, mi){
  const done = p.status === 'applied', gone = ['dismissed','undone','expired'].includes(p.status), saving = p.status === 'saving';
  // A card for something this person may not do (Admin, Access) says so instead of offering a button.
  const need = {new_item:'catalog', edit_item:'catalog', item_aliases:'catalog', new_supplier:'catalog', notify:'notify', streak:'assistant'}[p.kind];
  const blocked = !!need && !canDo(need) && !done && !gone;
  const actions = primaryLabel=> blocked ? `<div class="rico-card-state">${esc(t('ricoNoAccess'))}</div>` : gone
      ? `<div class="rico-card-state">${p.status==='undone'?t('ricoUndone'):p.status==='expired'?t('ricoCardOld'):t('ricoDismissed')}</div>`
      : done
        ? `<div class="rico-card-state ok">${ICON_CHECK}<span>${esc(p.doneLabel || t('ricoDone'))}</span>${p.kind==='order' ? ` <button class="rico-link" data-rico-open="order">${t('ricoOpenOrder')}</button>${p.undo?` <button class="rico-link" data-rico-undo="${mi}|${esc(p.id)}">${t('ricoUndo')}</button>`:''}` : ''}</div>`
        : `<div class="rico-card-actions"><button class="btn btn-primary${saving?' is-busy':''}" data-rico-apply="${mi}|${esc(p.id)}" ${saving?'disabled aria-busy="true"':''}>${primaryLabel}</button><button class="btn btn-ghost" data-rico-dismiss="${mi}|${esc(p.id)}" ${saving?'disabled':''}>${t('ricoNotNow')}</button></div>`;
  let body = '', title = '', icon = '';
  if(p.kind === 'order'){
    const before=p.appliedBefore||p.draftBefore||state.cart,after=p.appliedAfter||ricoOrderAfter(p,before);
    if(!after)return ricoCard(NAV_ICONS.order,t('ricoReviewChanges'),`<p class="rico-card-note">${esc(t('ricoQuantityLimit'))}</p>`,`<button class="btn btn-ghost" data-rico-dismiss="${mi}|${esc(p.id)}">${esc(t('ricoNotNow'))}</button>`,p);
    const ids=[...new Set([...(p.lines||[]).map(l=>l.itemId),...Object.keys(before)])].filter(id=>(before[id]||0)!==(after?.[id]||0));
    const groups=new Map();
    for(const id of ids){const item=state.items.find(i=>i.id===id);if(!item)continue;const supplier=supplierName(item.supplierId)||t('noSupplier');if(!groups.has(supplier))groups.set(supplier,[]);groups.get(supplier).push(item);}
    icon=NAV_ICONS.order;title=t('ricoReviewChanges');
    body=[...groups].map(([supplier,items])=>`<div class="rico-card-group"><div class="rico-card-sup">${esc(supplier)}</div>${items.map(item=>`<div class="rico-card-line"><span dir="auto">${esc(item.name)}<small>${esc(unitLabel(item.unit))}</small></span><b class="rico-quantity-change"><span aria-label="${esc(t('currentQuantity'))}">${esc(before[item.id]||0)}</span><i aria-hidden="true">→</i><span aria-label="${esc(t('newQuantity'))}">${esc(after?.[item.id]||0)}</span></b></div>`).join('')}</div>`).join('')
      +(p.note?`<div class="rico-card-note">${esc(p.note)}</div>`:'')
      +(p.why?`<details class="rico-why"><summary>${esc(t('whyLabel'))}</summary><span dir="auto">${esc(p.why)}</span></details>`:'')
      +`<div class="rico-card-note">${esc(t(p.mode==='add'?'ricoAddsToDraft':'ricoSetsDraft'))}</div>`;
    return ricoCard(icon,title,body,actions(t('ricoApplyChanges')),p);
  }
  if(p.kind === 'new_item'){
    icon = ICON_PLUS; title = t('ricoCardNewItem');
    body = ricoFields([[t('name'), p.name], [t('unit'), unitLabel(p.unitId) || p.unit], [t('supplier'), p.supplier || t('noSupplier')],...(p.aliases?.length?[[t('searchAliases'),p.aliases.join(', ')]]:[]),...(p.note?[[t('itemNoteLabel'),p.note]]:[])]);
    return ricoCard(icon, title, body, actions(t('addItem')), p);
  }
  if(p.kind === 'edit_item'){
    icon = ICON_EDIT; title = t('ricoCardEditItem');
    const row = (label, a, b)=> a===b ? [label, b] : [label, `<s>${esc(a)}</s> → ${esc(b)}`, true];
    body = ricoFields([row(t('name'), p.before.name, p.name), row(t('unit'), p.before.unit, p.unit), row(t('supplier'), p.before.supplier, p.supplier || t('noSupplier')), ...(p.aliases!==undefined?[row(t('searchAliases'),(p.before.aliases||[]).join(', '),p.aliases.join(', '))]:[]),...(p.available!==undefined?[row(t('availableToOrder'),String(p.before.available),String(p.available))]:[]),...(p.note!==undefined?[row(t('itemNoteLabel'),p.before.note||'',p.note)]:[])]);
    return ricoCard(icon, title, body, actions(t('save')), p);
  }
  if(p.kind === 'item_aliases'){
    body=(p.entries||[]).map(e=>`<div class="rico-card-line"><span dir="auto">${esc(e.name)}</span><span dir="auto">${esc(e.aliases.join(', ')||t('noValue'))}</span></div>`).join('');
    return ricoCard(ICON_EDIT,`${esc(t('aliasChanges'))} (${p.entries.length})`,body,actions(t('save')),p);
  }
  if(p.kind === 'new_supplier'){
    icon = NAV_ICONS.suppliers; title = t('ricoCardNewSupplier');
    body = ricoFields([[t('name'), p.name], [t('phone'), p.phone || t('noValue')]]);
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
  if(p.kind === 'file'){
    const what = {day:t('ricoFileDay'), transfers_day:t('ricoFileTransfers'), receipts_day:t('ricoFileReceipts'), receipt:t('ricoFileReceipt'), photos:t('ricoFilePhotos'), zip:t('ricoFileDay')}[p.what] || '';
    const when = p.day ? formatIraqDateTime(new Date(p.day + 'T12:00:00+03:00'), {weekday:'short', day:'numeric', month:'short'}) : '';
    return `<button class="rico-open rico-file" data-rico-file="${esc(p.id)}" data-what="${esc(p.what)}" data-format="${esc(p.format)}" data-day="${esc(p.day || '')}" data-to="${esc(p.to || '')}" data-receipt="${esc(p.receiptId || '')}" data-transfer="${esc(p.transferId || '')}">${ICON_DOWNLOAD}<span>${esc(p.label || (({excel:'Excel', pdf:'PDF', photos:t('ricoFilePhotos'), zip:'ZIP'})[p.format] + ' · ' + what + (when ? ' · ' + when : '') + (p.to ? ' – ' + formatIraqDateTime(new Date(p.to + 'T12:00:00+03:00'), {day:'numeric', month:'short'}) : '')))}</span></button>`;
  }
  // A transfer draft Rico prepared (saved on the server as this person's draft): it only opens it in Transfers.
  if(p.kind === 'transfer_draft'){
    if(!canOpen('transfers')) return '';
    body = `<div class="rico-card-note" dir="auto">${esc(p.from)} → ${esc(p.to)}</div>${(p.lines||[]).map(l=>`<div class="rico-card-line"><span dir="auto">${esc(l.item)}</span><b dir="auto">${esc(l.qty)} ${esc(l.unit)}</b></div>`).join('')}${(p.warnings||[]).map(x=>`<div class="rico-card-note" dir="auto">${esc(x)}</div>`).join('')}`;
    return ricoCard(NAV_ICONS.transfers, viewLabel('transfers'), body, `<div class="rico-card-actions"><button class="btn btn-primary" data-rico-transfer="${esc(p.transferId)}">${esc(t('ricoOpenScreen')(viewLabel('transfers')))}</button></div>`, p);
  }
  if(['stock_list','needs_list','price_list','spend'].includes(p.kind)) return renderRicoData(p);
  // A page of Ricotta Restaurant Rico was asked to open: a plain link (only to that site).
  if(p.kind === 'rr_link'){
    if(typeof p.url !== 'string' || !p.url.startsWith('https://pos.shaydattendance.com/')) return '';
    const name = (t('rrPages') || {})[p.page] || t('rrPages').home;
    return `<a class="rico-open" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${ICON_RR_OPEN}<span>${esc(t('rrOpenPage')(name))}</span></a>`;
  }
  // A routine Rico offers to keep: saved only when the person taps Save.
  if(p.kind === 'routine' && p.routine){
    const r = p.routine;
    body = `<div class="rico-card-note" dir="auto"><b>${esc(r.text)}</b></div><div class="rico-card-note">${esc(routineLabel({...r, supplierIds:r.supplierIds || []}))}</div>`;
    return ricoCard(ICON_BELL, t('routineCard'), body, actions(t('routineSave')), p);
  }
  if(p.kind === 'open'){
    if(p.screen !== 'send' && !canOpen(p.screen)) return '';
    if(p.screen === 'send' && !canDo('send')) return '';
    if(p.screen === 'send') return `<button class="rico-open" data-rico-open="send">${ICON_CHAT}<span>${esc(p.label || t('ricoOpenSend'))}</span></button>`;
    return `<button class="rico-open" data-rico-open="${esc(p.screen)}" data-rico-sup="${esc(p.supplierId||'')}">${NAV_ICONS[p.screen]||NAV_ICONS.order}<span>${esc(p.label || t('ricoOpenScreen')(viewLabel(p.screen)))}</span></button>`;
  }
  return '';
}
/* Cards with numbers Rico read (low stock, what needs you, price changes, spending): a short list
   with one or two buttons, so nothing has to be copied out of his text. Only shown, never applied. */
const ricoNum = n=>Number(n || 0).toLocaleString('en-US', {maximumFractionDigits:3});
function renderRicoData(p){
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const more = p.more > 0 ? `<div class="rico-data-more">${esc(t('ricoMoreRows')(p.more))}</div>` : '';
  const card = (icon, title, meta, body, foot='')=>`<div class="rico-data" data-card="${esc(p.id)}"><div class="rico-data-head"><span class="rico-card-icon">${icon}</span><span class="rico-data-title" dir="auto">${esc(title)}</span>${meta ? `<small dir="auto">${esc(meta)}</small>` : ''}</div><div class="rico-data-rows">${body}</div>${more}${foot ? `<div class="rico-data-foot">${foot}</div>` : ''}</div>`;
  if(p.kind === 'stock_list'){
    if(!canOpen('transfers') && !canOpen('stock')) return '';
    const body = rows.map(r=>`<div class="rico-data-row"><i class="rico-dot ${r.empty ? 'red' : 'amber'}"></i><span class="rico-data-name" dir="auto">${esc(r.item)}<small>${esc(r.empty ? t('ricoEmptyNow') : r.days != null ? t('ricoDaysLeft')(r.days) : '')}</small></span><b dir="auto">${esc(ricoNum(r.qty))} ${esc(r.unit)}</b></div>`).join('');
    const foot = `${canOpen('stock') ? `<button type="button" class="btn btn-ghost" data-rico-open="stock">${esc(t('ricoOpenScreen')(viewLabel('stock')))}</button>` : ''}${canOpen('transfers') ? `<button type="button" class="btn btn-primary" data-rico-ask="${esc(t('ricoMoveLowAsk')(p.storage || ''))}">${esc(t('ricoMoveLow'))}</button>` : ''}`;
    return card(RICO_TILE_ICONS.stock, t('ricoCardLow')(p.storage || ''), p.at ? timeAgo(p.at) : '', body, foot);
  }
  if(p.kind === 'needs_list'){
    const body = rows.filter(r=>canOpen(r.type === 'receipt' ? 'receipts' : 'transfers')).map(r=>`<button type="button" class="rico-data-row link" data-rico-need="${esc(r.type)}|${esc(r.id)}"><i class="rico-dot ${r.level === 'stop' ? 'red' : r.level === 'old' ? 'gray' : 'amber'}"></i><span class="rico-data-name" dir="auto">${esc(viewLabel(r.type === 'receipt' ? 'receipts' : 'transfers'))}: ${esc(r.title)}<small dir="auto">${esc(r.why)}</small></span><i class="sheet-chevron" aria-hidden="true"></i></button>`).join('');
    return body ? card(RICO_TILE_ICONS.needs, t('ricoCardNeeds'), '', body) : '';
  }
  if(p.kind === 'price_list'){
    if(!canOpen('receipts')) return '';
    const body = rows.map(r=>`<div class="rico-data-row"><span class="rico-data-name" dir="auto">${esc(r.item)}<small dir="auto">${esc(r.supplier)} · ${esc(r.unit)}</small></span><span class="rico-data-price" dir="ltr">${esc(ricoNum(r.from))} → <b>${esc(ricoNum(r.to))}</b> ${esc(r.currency)}</span><span class="rico-pct ${r.pct > 0 ? 'up' : 'down'}" dir="ltr">${r.pct > 0 ? '+' : ''}${esc(r.pct)}%</span></div>`).join('');
    return card(RICO_TILE_ICONS.price, t('ricoCardPrices'), '', body);
  }
  if(p.kind === 'spend'){
    if(!canOpen('receipts')) return '';
    const money = r=>[r.IQD ? `${ricoNum(r.IQD)} IQD` : '', r.USD ? `${ricoNum(r.USD)} USD` : ''].filter(Boolean).join(' · ') || '0 IQD';
    const total = `<div class="rico-data-total"><b dir="ltr">${esc(money(p))}</b><small>${esc(t('ricoReceiptsN')(p.receipts || 0))}</small></div>`;
    const body = total + rows.map(r=>`<div class="rico-data-row"><span class="rico-data-name" dir="auto">${esc(r.name)}<small>${esc(t('ricoReceiptsN')(r.receipts || 0))}</small></span><b dir="ltr">${esc(money(r))}</b></div>`).join('');
    return card(RICO_TILE_ICONS.reports, t('ricoCardSpend'), p.period || '', body);
  }
  return '';
}
function ricoFields(rows){
  return `<dl class="rico-fields">${rows.map(([k,v,raw])=>`<div><dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('')}</dl>`;
}
function ricoCard(icon, title, body, actions, p){
  return `<div class="rico-card ${esc(['pending','saving','applied','dismissed','undone','expired'].includes(p.status)?p.status:'expired')}" data-card="${esc(p.id)}"><div class="rico-card-head"><span class="rico-card-icon">${icon}</span><span>${esc(title)}</span>${p.auto?`<span class="rico-card-tag">${t('ricoAutoTag')}</span>`:''}</div>${body}${actions}</div>`;
}

/* ---------- Composer (lives in the bottom stack above the tab bar) ---------- */
function renderRicoComposer(){
  if(rico.viewing) return `<div class="rico-composer rico-composer-viewing"><button type="button" class="btn btn-primary" data-rico-mine>${esc(t('ricoBackToMine'))}</button></div>`;
  return `<form class="rico-composer" id="ricoComposer" autocomplete="off">
    <label class="sr-only" for="ricoInput">${esc(t('ricoPlaceholder'))}</label>
    <textarea id="ricoInput" rows="1" maxlength="2000" enterkeyhint="send" placeholder="${esc(t('ricoPlaceholder'))}" dir="auto"></textarea>
    <button type="submit" class="rico-send ${rico.streaming?'stop':''}" id="ricoSendBtn" aria-label="${esc(rico.streaming?t('ricoStop'):t('ricoSend'))}">${rico.streaming?ICON_STOP:ICON_SEND_UP}</button>
  </form>`;
}
/* Async consent and chat replies belong to the chat that started them. */
function ricoContext(){ return {epoch:rico.epoch, account:state.account}; }
function ricoContextCurrent(context){ return context.epoch === rico.epoch && context.account === state.account; }
function ricoDraftKey(account = state.account){ return 'ricoDraft:' + account; }
function ricoReadDraft(){
  // The legacy key had no owner. Never assign its contents to the next person signing in.
  lset('ricoDraft', null);
  return state.account ? lget(ricoDraftKey()) : null;
}

/* ---------- Events ---------- */
function attachAssistantEvents(){
  document.getElementById('ricoInboxAll')?.addEventListener('click', openRicoInboxSheet);
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
    const draft = ricoReadDraft(); if(draft && !input.value){ input.value = draft; grow(); }
    const draftAccount = state.account;
    input.addEventListener('input', ()=>{ if(state.account === draftAccount) lset(ricoDraftKey(draftAccount), input.value || null); });
  }
  if(form) form.onsubmit = async e=>{
    e.preventDefault();
    if(rico.streaming){ ricoStop(); return; }
    const text = input.value.trim();
    if(!text) return;
    const context = ricoContext();
    if(!(await aiConsent()) || !ricoContextCurrent(context)) return;   // the message stays in the box
    input.value = ''; input.style.height = 'auto'; lset(ricoDraftKey(), null);
    ricoAsk(text);
  };
  document.getElementById('ricoNewBtn')?.addEventListener('click', ()=>ricoNewChat());
  document.querySelectorAll('[data-rico-mine]').forEach(b=>b.onclick=()=>ricoNewChat());
  document.getElementById('ricoHistBtn')?.addEventListener('click', ()=>ricoOpenHistory());
  document.querySelectorAll('[data-rico-settings-open]').forEach(b=>b.onclick = openRicoSettings);
  if(rico.chats === null) ricoLoadChats().then(()=>{ if(state.view === 'assistant' && !rico.messages.length && rico.chats?.length && !refreshBlocked()) render(); });
  document.querySelector('[data-side-new]')?.addEventListener('click', ()=>ricoNewChat());
  document.querySelector('[data-side-all]')?.addEventListener('click', ()=>ricoOpenHistory());
  document.querySelectorAll('[data-side-open]').forEach(b=>b.onclick = ()=>ricoOpenChat(b.dataset.sideOpen));
  document.querySelector('[data-rico-leave]')?.addEventListener('click', ricoLeave);
  // Search: hides the chats (and day lines) that don't match, without drawing the list again.
  document.querySelector('[data-side-search]')?.addEventListener('input', e=>{
    const q = e.currentTarget.value.trim().toLocaleLowerCase();
    let day = null, any = false;
    const flush = ()=>{ if(day) day.hidden = !any; };
    document.querySelectorAll('.rico-side-list > *').forEach(el=>{
      if(el.classList.contains('rico-side-day')){ flush(); day = el; any = false; return; }
      const hit = !q || el.textContent.toLocaleLowerCase().includes(q);
      el.hidden = !hit; if(hit) any = true;
    });
    flush();
  });
  attachRicoThreadEvents(document.getElementById('mainContent') || document);
  if(rico.messages.length) ricoScroll(false);
  ricoMarkInboxRead();
}
function attachRicoThreadEvents(root){
  root.querySelectorAll('[data-rico-ask]').forEach(b=>b.onclick=()=>{
    // These two are answered on this phone, as a receipt and a checklist.
    if(b.dataset.ricoAction === 'last_order' && canOpen('history')) return ricoAnswerLastOrder(b.dataset.ricoAsk);
    ricoAsk(b.dataset.ricoAsk, {quickAction:b.dataset.ricoAction});
  });
  root.querySelectorAll('[data-receipt-same]').forEach(b=>b.onclick=()=>ricoReceiptToCart(rico.messages[+b.dataset.receiptSame]));

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
  // A file Rico offered: made here and handed over (share sheet on a phone, a download on a computer).
  root.querySelectorAll('[data-rico-file]').forEach(b=>b.onclick=()=>withBusy(b, ()=>ricoMakeFile({...b.dataset})));
  root.querySelectorAll('[data-rico-open]').forEach(b=>b.onclick=()=>{
    const screen = b.dataset.ricoOpen, sup = b.dataset.ricoSup;
    if(screen === 'send'){ startSendQueue().then(ok=>{ if(!ok) goView('order'); }); return; }
    if(!canOpen(screen)) return;
    if(screen === 'order' && sup && state.suppliers.some(s=>s.id===sup)) state.orderTab = sup;
    goView(screen);
  });
  root.querySelectorAll('[data-rico-transfer]').forEach(b=>b.onclick=async()=>{
    const id = b.dataset.ricoTransfer;
    if(!canOpen('transfers')) return;
    goView('transfers');
    // Transfers reads its list again when it opens; the draft opens once it is there.
    for(let i=0; i<40 && !tfFind(id); i++) await new Promise(r=>setTimeout(r, 250));
    if(state.view === 'transfers' && tfFind(id)) tfOpen(id);
  });
  // A row of "Needs you": opens that receipt or transfer (each screen reads its list as it opens).
  root.querySelectorAll('[data-rico-need]').forEach(b=>b.onclick=async()=>{
    const [type, id] = b.dataset.ricoNeed.split('|'), view = type === 'receipt' ? 'receipts' : 'transfers';
    if(!canOpen(view)) return;
    goView(view);
    const find = type === 'receipt' ? rrFind : tfFind, open = type === 'receipt' ? rrOpen : tfOpen;
    for(let i=0; i<40 && !find(id); i++) await new Promise(r=>setTimeout(r, 250));
    if(state.view === view && find(id)) open(id);
  });
  root.querySelectorAll('[data-routine-fill]').forEach(b=>b.onclick=()=>{ const m = rico.inbox.find(x=>String(x.id) === b.dataset.routineFill); if(!ricoFillRoutineOrder(m)) toast(t('saveFailed'), 'warn'); });
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
      const what = {order:`order draft (${(p.lines||[]).length} items)`, new_item:`add item "${p.name}"`, edit_item:`edit item "${p.name}"`, item_aliases:`update aliases for ${(p.entries||[]).length} items`, new_supplier:`add supplier "${p.name}"`, notify:'notification', open:`open ${p.screen}`, transfer_draft:`transfer draft ${p.from} to ${p.to} (saved as a draft)`, routine:`save routine "${p.routine?.text}" (${p.routine?.kind}) at ${p.routine?.time}`, stock_list:`list of what is low in ${p.storage}`, rr_link:`button to open Ricotta Restaurant ${p.page}`, needs_list:'list of what needs the person', price_list:'list of price changes', spend:`spending for ${p.period}`, streak:`bring back the ${p.days}-day streak`}[p.kind] || p.kind;
      content += ['stock_list','needs_list','price_list','spend','rr_link'].includes(p.kind) ? `\n[card ${what}: shown]` : `\n[card ${what}: ${p.status || 'waiting for the person'}]`;
    });
    return {role:m.role, content: content.trim() || '…'};
  });
}
function ricoStop(){
  if(rico.abort){ rico.abort.abort(); rico.abort = null; }
}
async function ricoAsk(text, options = {}){
  if(rico.streaming || !state.account) return;
  const context = ricoContext();
  if(!(await aiConsent()) || !ricoContextCurrent(context) || rico.streaming) return;
  const scopeIds = options.supplierIds || [];
  const named = state.suppliers.filter(s=>String(text).toLocaleLowerCase().includes(s.name.toLocaleLowerCase())).map(s=>s.id);
  if(rico.viewing){ rico.viewing = null; rico.messages = []; rico.chatId = null; }
  if((options.quickAction==='prepare_order' || ricoOrderIntent(text)) && !scopeIds.length && !named.length){
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
  const paint = ()=>{ if(frame) return; frame = requestAnimationFrame(()=>{ frame = 0; if(ricoContextCurrent(context)) ricoPaintMessage(idx); }); };
  const body = {
    messages: ricoHistoryForServer(), lang: state.lang, screen: previousView,
    autoOrder: ricoAutoOrder(), cart: Object.fromEntries(Object.entries(state.cart).filter(([,q])=>q>0)),
    quickAction: options.quickAction || undefined, supplierIds: options.supplierIds || undefined, style: typeof ricoStyle === 'function' ? ricoStyle() : undefined,
  };
  await apiStream('assistant/chat', body, ev=>{
    if(!ricoContextCurrent(context)) return;
    if(ev.type === 'text'){ bot.text += ev.text; bot.statusKey = null; bot.stepsDone = true; paint(); }
    else if(ev.type === 'status'){
      bot.statusKey = ev.tool;
      if(bot.steps[bot.steps.length-1] !== ev.tool) bot.steps.push(ev.tool);
      bot.stepsDone = false;
      paint();
    }
    else if(ev.type === 'proposal'){
      const p = {...ev.proposal, status:'pending'};
      if(p.kind==='order')p.draftBefore={...state.cart};
      bot.proposals.push(p);
      if(p.kind === 'order' && ricoAutoOrder()){ ricoApplyOrder(p, true); }
      paint();
    }
    else if(ev.type === 'mood'){ /* older servers: moods are no longer shown */ }
    else if(ev.type === 'error'){ bot.error = ev.code; bot.retry = ['offline','busy','failed'].includes(ev.code); paint(); }
  }, controller.signal);
  cancelAnimationFrame(frame);
  if(!ricoContextCurrent(context)) return;
  bot.streaming = false; bot.statusKey = null;
  if(controller.signal.aborted && !bot.text && !bot.proposals.length) bot.error = 'stopped';
  if(!controller.signal.aborted && !bot.text && !bot.proposals.length && !bot.error){ bot.error = 'failed'; bot.retry = true; }
  rico.streaming = false; rico.abort = null;
  if(bot.text && !bot.error) playRicoReply();
  ricoSaveSoon();
  if(state.view === 'assistant'){
    ricoPaintMessage(idx);
    ricoRefreshComposer();
    document.getElementById('ricoNewBtn')?.removeAttribute('disabled'); document.querySelector('[data-side-new]')?.removeAttribute('disabled');
  }
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
  // Rico's answer grows out of Spark the first time it appears, then stays still while text streams in.
  const hadBubble = !!el.querySelector('.rico-bubble'), bubble = fresh.querySelector('.rico-bubble');
  el.replaceWith(fresh);
  if(bubble && !hadBubble && !reducedMotion()) bubble.animate?.([{transform:'scale(.6)', opacity:0}, {transform:'none', opacity:1}], {duration:420, easing:'cubic-bezier(.32,.72,0,1)'});
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
  }
  const btn = document.getElementById('ricoSendBtn');
  if(!btn) return;
  btn.classList.toggle('stop', rico.streaming);
  btn.innerHTML = rico.streaming ? ICON_STOP : ICON_SEND_UP;
  btn.setAttribute('aria-label', rico.streaming ? t('ricoStop') : t('ricoSend'));
}
function ricoNearBottom(){ const box = scrollBox(); return box.scrollTop + box.clientHeight >= box.scrollHeight - 220; }
function ricoScroll(smooth){
  requestAnimationFrame(()=>scrollBox().scrollTo({top:scrollBox().scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto'}));
}

/* ---------- Carrying out a confirmed proposal ---------- */
function ricoFind(mi, id){ const m = rico.messages[mi]; return m && (m.proposals||[]).find(p=>p.id===id); }
function ricoSetStatus(mi, id, status, extra = {}){
  const p = ricoFind(mi, id); if(!p) return;
  Object.assign(p, {status}, extra);
  if(status !== 'saving') ricoSaveSoon();
  if(state.view === 'assistant') ricoPaintMessage(mi);
}
/* The draft an order card would leave: null when it can't apply cleanly (an item is gone or no longer
   available, its unit changed, or an amount would go past the limit), so nothing is half-applied. */
function ricoOrderAfter(p, cart = state.cart){
  if(!['add','set','replace'].includes(p.mode) || !Array.isArray(p.lines) || !p.lines.length) return null;
  const next = p.mode === 'add' || p.mode === 'set' ? {...cart} : {};
  for(const line of p.lines){
    const item = state.items.find(i=>i.id===line.itemId && i.available!==false);
    if(!item || !validOrderQuantity(Number(line.qty)) || (line.unitId !== undefined && line.unitId !== item.unit)) return null;
    const q = p.mode === 'add' ? (next[line.itemId] || 0) + Number(line.qty) : Number(line.qty);
    if(!validOrderQuantity(q)) return null;
    if(q > 0) next[line.itemId] = roundQuantity(q); else delete next[line.itemId];
  }
  return next;
}
function ricoApplyOrder(p, auto){
  const before={...state.cart},next=ricoOrderAfter(p);
  if(!next)return false;
  const n=draftChanges(before,next).length;
  state.cart=next;persistCartDraft();
  const ids=draftChanges(before,next).map(c=>c.itemId);
  Object.assign(p,{status:'applied',undo:before,appliedBefore:Object.fromEntries(ids.map(id=>[id,before[id]||0])),appliedAfter:Object.fromEntries(ids.map(id=>[id,next[id]||0])),auto:!!auto,doneLabel:t('ricoOrderApplied')(n)});
  if(!auto)toast(t('ricoOrderApplied')(n));
  return true;
}

async function ricoApply(mi, id, btn){
  const p = ricoFind(mi, id);
  if(!p || p.status !== 'pending') return;
  const context=ricoContext();
  if(p.kind==='order' && p.draftBefore && draftChanges(p.draftBefore,state.cart).length){
    p.draftBefore={...state.cart};ricoPaintMessage(mi);toast(t('ricoDraftChanged'));return;
  }
  const run = async ()=>{
    if(!ricoContextCurrent(context))return false;
    if(p.kind === 'order')return ricoApplyOrder(p,false);
    if(p.kind === 'item_aliases'){
      const r=await api('items/aliases',{method:'PUT',body:{entries:p.entries.map(e=>({itemId:e.itemId,name:e.name,before:e.before,aliases:e.aliases}))}});
      if(!r.ok){await showAlert(t(r.status===409?'aliasConflict':'saveFailed'));return false;}
      for(const e of p.entries){const item=state.items.find(i=>i.id===e.itemId);if(item)item.aliases=e.aliases;}
      p.doneLabel=t('savedMsg')(t('aliasChanges'));return true;
    }
    if(p.kind === 'new_item'){
      const supplierId = p.supplierId && state.suppliers.some(s=>s.id===p.supplierId) ? p.supplierId : null;
      const maxSort = state.items.filter(i=>i.supplierId===supplierId).reduce((mx,i)=>Number.isInteger(i.sortOrder)?Math.max(mx,i.sortOrder):mx,-1);
      const next = {id:'i'+outboxJobId(), name:p.name, unit:p.unitId, supplierId, aliases:p.aliases||[],available:p.available!==false,note:p.note||'',sortOrder:maxSort>=0?maxSort+1:null};
      if(!(await saveRecord('items', next))){ await showAlert(t('saveFailed')); return false; }
      state.items.push(next);
      logActivity({action:'add', type:'item', name:p.name, fields:[{k:'name',to:p.name},{k:'unit',to:unitEn(p.unitId)},{k:'supplier',to:supplierId?supplierName(supplierId):''}]});
      p.doneLabel = t('savedMsg')(p.name);
      return true;
    }
    if(p.kind === 'edit_item'){
      const i = state.items.find(x=>x.id===p.itemId);
      if(!i){ await showAlert(t('saveFailed')); return false; }
      const supplierId = p.supplierId && state.suppliers.some(s=>s.id===p.supplierId) ? p.supplierId : null;
      const fields = diffFields([['name', i.name, p.name], ['unit', unitEn(i.unit), unitEn(p.unitId)], ['supplier', i.supplierId?supplierName(i.supplierId):'', supplierId?supplierName(supplierId):'']]);
      const next = {...i, name:p.name, unit:p.unitId, supplierId, ...(p.aliases!==undefined?{aliases:p.aliases}:{}),...(p.available!==undefined?{available:p.available}:{}),...(p.note!==undefined?{note:p.note}:{}), sortOrder: supplierId===i.supplierId ? i.sortOrder : null};
      if(p.changes){Object.assign(next,i,p.changes);if(next.supplierId!==i.supplierId)next.sortOrder=null;}
      if(!(await saveRecord('items', next))){ await showAlert(t('saveFailed')); return false; }
      Object.assign(i, next);if(i.available===false){delete state.cart[i.id];persistCartDraft();}
      if(fields.length) logActivity({action:'edit', type:'item', name:p.name, fields});
      p.doneLabel = t('savedMsg')(p.name);
      return true;
    }
    if(p.kind === 'new_supplier'){
      const next = {id:'s'+outboxJobId(), name:p.name, phone:p.phone||'', reminder:null};
      if(!(await saveRecord('suppliers', next))){ await showAlert(t('saveFailed')); return false; }
      state.suppliers.push(next);
      logActivity({action:'add', type:'supplier', name:p.name, fields:[{k:'name',to:p.name}].concat(p.phone?[{k:'phone',to:p.phone}]:[])});
      p.doneLabel = t('savedMsg')(p.name);
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
    if(p.kind === 'routine' && p.routine){
      const r = p.routine;
      const res = await api('rico-routines', {method:'POST', body:{kind:r.kind, text:r.text, time:r.time, days:r.days, supplierIds:r.supplierIds || []}});
      if(!res.ok){ await showAlert(t(res.status === 409 ? 'routineTooMany' : 'saveFailed')); return false; }
      p.doneLabel = t('routineSaved');
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
  if(!ricoContextCurrent(context))return;
  p.status = ok ? 'applied' : 'pending';
  if(state.view === 'assistant') ricoPaintMessage(mi);
}
function ricoUndo(mi, id){
  const p = ricoFind(mi, id);
  if(!p || !p.undo) return;
  if(p.appliedAfter){
    if(Object.entries(p.appliedAfter).some(([id,qty])=>(state.cart[id]||0)!==qty)){toast(t('ricoDraftChanged'));return;}
    for(const [id,qty]of Object.entries(p.appliedBefore||{})){if(qty)state.cart[id]=qty;else delete state.cart[id];}
  }else state.cart=p.undo;
  persistCartDraft();
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
  return rico.messages.filter(m=>!m.streaming && (m.role === 'user' || m.text || (m.proposals||[]).length || m.error || m.receipt)).slice(-200).map(m=>{
    const out = {role:m.role, text:m.text || '', ts:m.ts || Date.now()};
    if(m.mood) out.mood = m.mood;
    if(m.error) out.error = m.error;
    if(m.steps && m.steps.length) out.steps = m.steps;
    if(m.receipt) out.receipt = m.receipt;
    if(m.proposals && m.proposals.length) out.proposals = m.proposals.map(({undo, draftBefore, ...p})=>({...p, status: p.status === 'saving' ? 'pending' : p.status}));
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
/* Whose chat it is: the person's initial in a small circle (green for Rozh, gray for Yunis). */
function chatOwnerMark(c){
  const who = c.account || state.account;
  return `<span class="chat-owner ${who === 'rozha' ? 'r' : 'y'}" title="${esc(accountLabel(who))}" aria-label="${esc(accountLabel(who))}">${esc(accountLabel(who).trim().charAt(0).toUpperCase())}</span>`;
}
/* A new chat: the current one stays in Chat history. */
function ricoNewChat(){
  if(rico.streaming) ricoStop();
  if(rico.messages.length) ricoSave();
  rico.epoch++; rico.chatRequest++;
  rico.streaming = false;
  rico.messages = []; rico.chatId = null; rico.viewing = null; rico.viewedId = null;
  render();
}
async function ricoOpenChat(id){
  if(rico.streaming) return false;
  const context = ricoContext(), request = ++rico.chatRequest;
  const r = await api('rico-chats/' + encodeURIComponent(id));
  if(!ricoContextCurrent(context) || request !== rico.chatRequest || r.stale) return false;
  if(!r.ok || !Array.isArray(r.data?.messages)){ toast(t('ricoChatLoadFailed'), 'error'); return false; }
  if(rico.chatId !== id && rico.messages.length) ricoSave();
  clearTimeout(ricoSaveTimer);
  rico.epoch++;
  // The other person's chat opens read only: it can be read and deleted, never continued.
  rico.viewing = r.data.account && r.data.account !== state.account ? r.data.account : null;
  rico.chatId = rico.viewing ? null : id;
  rico.viewedId = rico.viewing ? id : null;
  rico.messages = r.data.messages.map(m=>({...m, proposals:(m.proposals||[]).map(p=>({...p, undo:undefined, status: !p.status || p.status === 'pending' || p.status === 'saving' ? 'expired' : p.status}))}));
  if(state.view !== 'assistant') goView('assistant'); else render();
  ricoScroll(false);
  return true;
}
/* Chat history: a sheet from the bottom with one list of every chat, Rozh's and Yunis's, newest first
   and grouped by day; each shows whose it is. Both can open any chat (the other person's opens read only)
   and delete it; Delete All asks once more before it removes every chat. */
function ricoOpenHistory(){
  closeSelSheet();
  document.activeElement?.blur?.();
  const wrap = document.createElement('div');
  wrap.id = 'ricoHistSheet'; wrap.className = 'sel-sheet rico-hist-sheet';
  wrap.innerHTML = `<div class="sel-scrim"></div><div class="sel-panel" role="dialog" aria-modal="true" aria-label="${esc(t('ricoHistory'))}">
    <div class="sel-grab"></div>
    <div class="rico-hist-top"><div class="sel-title">${esc(t('ricoHistory'))}</div><button type="button" class="btn btn-primary" data-hist-new>${ICON_NEW_CHAT}<span>${esc(t('ricoNewChat'))}</span></button></div>
    <div class="sel-list rico-hist-list"></div></div>`;
  document.body.appendChild(wrap);
  const list = wrap.querySelector('.rico-hist-list');
  let confirming = null;   // the chat id (or 'all') waiting for a second tap on Delete
  const paint = ()=>{
    if(!rico.chats){ list.innerHTML = loadingLines(4); return; }
    if(!rico.chats.length){ list.innerHTML = `<div class="field-hint rico-hist-empty">${esc(t('ricoHistoryEmpty'))}</div>`; return; }
    let lastDay = '';
    list.innerHTML = rico.chats.map(c=>{
      const day = dayLabel(c.updatedAt), head = day !== lastDay ? `<div class="rico-hist-day">${esc(day)}</div>` : '';
      lastDay = day;
      const asking = confirming === c.id;
      return `${head}<div class="rico-hist-row${c.id === rico.chatId || c.id === rico.viewedId ? ' on' : ''}${asking ? ' asking' : ''}">
        <button type="button" class="rico-hist-open" data-hist-open="${esc(c.id)}">${chatOwnerMark(c)}<span class="rico-hist-title" dir="auto">${esc(c.title || t('ricoUntitled'))}</span><small>${esc(accountLabel(c.account || state.account))} · ${esc(formatIraqDateTime(c.updatedAt,{hour:'numeric',minute:'2-digit'}))}</small></button>
        ${asking ? `<button type="button" class="btn btn-danger rico-hist-yes" data-hist-yes="${esc(c.id)}">${esc(t('delete'))}</button>`
          : `<button type="button" class="icon-btn danger" data-hist-del="${esc(c.id)}" aria-label="${esc(t('ricoDeleteChat'))}">${ICON_DELETE}</button>`}
      </div>`;
    }).join('') + `<button type="button" class="rico-hist-all${confirming === 'all' ? ' asking' : ''}" data-hist-all>${esc(confirming === 'all' ? t('ricoDeleteAllConfirm') : t('ricoDeleteAll'))}</button>`;
  };
  paint();
  if(!rico.chats) ricoLoadChats().then(paint);
  let closed = false;
  const close = (velocity = 0)=>{
    if(closed) return; closed = true;
    if(activeSelSheet === close) activeSelSheet = null;
    document.removeEventListener('keydown', onKey, true);
    sheetLeave(wrap, velocity);
  };
  activeSelSheet = close;
  const onKey = e=>{ if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.sel-scrim').onclick = ()=>close();
  attachSheetDrag(wrap, close);
  wrap.querySelector('[data-hist-new]').onclick = ()=>{ close(); ricoNewChat(); };
  list.onclick = async e=>{
    const open = e.target.closest('[data-hist-open]'), del = e.target.closest('[data-hist-del]'), yes = e.target.closest('[data-hist-yes]'), all = e.target.closest('[data-hist-all]');
    if(open){ if(await ricoOpenChat(open.dataset.histOpen)) close(); return; }
    if(del){ confirming = del.dataset.histDel; paint(); return; }
    if(all && confirming !== 'all'){ confirming = 'all'; paint(); return; }
    if(!yes && !all) return;
    const id = yes ? yes.dataset.histYes : null;
    clearTimeout(ricoSaveTimer);
    const r = await api(id ? 'rico-chats/' + id : 'rico-chats?account=all', {method:'DELETE'});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    rico.chats = id ? rico.chats.filter(c=>c.id !== id) : [];
    if(!id || rico.chatId === id){ rico.chatId = null; if(rico.messages.length && !rico.streaming && !rico.viewing) rico.messages = []; }
    if(rico.viewing && (!id || id === rico.viewedId)){ rico.viewing = null; rico.viewedId = null; rico.messages = []; }
    confirming = null; paint();
    toast(id ? t('ricoChatDeleted') : t('ricoChatsDeleted'));
    if(state.view === 'assistant') render();
  };
  requestAnimationFrame(()=>{ if(!closed) list.querySelector('button')?.focus({preventScroll:true}); });
}
