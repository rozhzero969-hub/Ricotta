/* Rico -- the in-app AI assistant (the "Rico" tab).
   Talks to POST api/assistant/chat, which streams the reply (see
   supabase/functions/api/assistant.ts). Rico can only PROPOSE changes: each
   proposal is a card here, and nothing happens until the person taps it; the
   change is then made through the normal API with this person's session.
   The conversation lives only in this open app session. Closing or reloading
   the app starts a fresh chat; switching screens keeps the current chat.
   Depends on (runtime only): state, t, esc, render, toast, api, apiStream,
   lget, lset, saveRecord, logActivity, unitEn, unitLabel, supplierName,
   persistCartDraft, myDevice, callSendPush, reportSendResult, showPrompt,
   showConfirm, NAV_ICONS. Load before app.js. */

const RICO_HISTORY_SENT = 24;           // messages sent to the server with each question
const RICO_LATE_AFTER_MIN = 60;
const RICO_LATE_WINDOW_MIN = 4*60;

NAV_ICONS.assistant = ricoSparkSvg('currentColor');
const ICON_SEND_UP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;
const ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/></svg>`;
const ICON_NEW_CHAT = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

let rico = {
  messages: [],
  streaming: false,
  abort: null,
  status: null,        // {configured, model} once fetched (admins, Settings)
};

/* ---------- Rico's mark: a small spark in the restaurant green ---------- */
function ricoAvatar(cls = ''){
  return `<span class="rico-av ${cls}" aria-hidden="true">${ricoSparkSvg('#214F3D')}</span>`;
}

/* Remove chat copies written by older versions. The current chat stays in
   memory only, so a fresh launch cannot restore previous conversations. */
function ricoClearLegacyChats(){
  for(const key of ['ricoChat','ricoChat:admin','ricoChat:staff','ricoChat:admin:updatedAt','ricoChat:staff:updatedAt']) lset(key, null);
}
function ricoAutoOrder(){ return !!lget('ricoAutoOrder'); }

/* ---------- Who is talking ---------- */
function personName(){ return (myDevice() || {}).personName || lget('personName') || ''; }
async function setPersonName(name){
  name = String(name || '').trim().slice(0, 40);
  lset('personName', name || null);
  const me = myDevice(); if(me) me.personName = name || null;
  await api('devices/me/name', {method:'PUT', body:{name}});
}
/* After sign-in: the server forgets names of devices unused for 30 days, so
   re-send the one this phone remembers. */
function syncPersonName(){
  const local = lget('personName'), me = myDevice();
  if(local && me && !me.personName) setPersonName(local);
  if(!local && me && me.personName) lset('personName', me.personName);
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
  if(!state.role) return [];
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
  return t('ricoGreeting')(part, personName());
}
function renderAssistant(){
  const name = personName();
  const late = ricoLateOrders();
  const head = `<header class="rico-head">
      ${ricoAvatar('rico-av-lg')}
      <div class="rico-head-text">
        <div class="rico-name">${t('ricoName')}<span class="rico-online" aria-hidden="true"></span></div>
        <button class="rico-who" id="ricoWhoBtn">${name ? esc(t('ricoTalkingWith')(name)) : esc(t('ricoTellName'))}${ICON_EDIT}</button>
      </div>
      <div class="rico-head-actions">
        <button class="icon-btn rico-auto ${ricoAutoOrder()?'on':''}" id="ricoAutoBtn" aria-pressed="${ricoAutoOrder()}" title="${esc(t('ricoAutoOrderLabel'))}" aria-label="${esc(t('ricoAutoOrderLabel'))}">${NAV_ICONS.order}</button>
        <button class="icon-btn" id="ricoNewBtn" title="${esc(t('ricoNewChat'))}" aria-label="${esc(t('ricoNewChat'))}" ${rico.messages.length?'':'disabled'}>${ICON_NEW_CHAT}</button>
      </div>
    </header>`;
  const alerts = late.length ? `<div class="rico-alerts">${late.map(l=>`
      <div class="rico-alert">
        <span class="rico-alert-dot" aria-hidden="true"></span>
        <div class="rico-alert-text"><b>${esc(t('ricoLateTitle')('\u2068'+l.name+'\u2069'))}</b><span>${esc(t('ricoLateSub')(l.time, Math.floor(l.mins/60), l.mins%60))}</span></div>
        <button class="btn btn-primary" data-rico-late="${esc(l.supplierId)}">${t('ricoPrepareIt')}</button>
      </div>`).join('')}</div>` : '';
  const thread = rico.messages.length
    ? rico.messages.map((m,i)=>renderRicoMessage(m,i)).join('')
    : renderRicoIntro();
  return `${head}${alerts}<div class="rico-thread" id="ricoThread" aria-live="polite">${thread}</div>`;
}
function renderRicoIntro(){
  const chips = t('ricoSuggestions')(state.role==='admin');
  const actions = state.role==='admin'
    ? ['prepare_order','check_order','week_insights','last_order','add_item','late_orders']
    : ['prepare_order','check_order','last_order','how_to_send'];
  return `<div class="rico-intro">
    ${ricoAvatar('rico-av-xl')}
    <h2 class="rico-hello">${esc(ricoGreeting())}</h2>
    <p class="rico-intro-text">${esc(t('ricoIntro'))}</p>
    ${personName() ? '' : `<form class="rico-name-form" id="ricoNameForm"><label for="ricoNameInput">${esc(t('ricoAskName'))}</label><div><input id="ricoNameInput" maxlength="40" autocomplete="given-name" placeholder="${esc(t('ricoNamePlaceholder'))}"><button class="btn btn-primary" type="submit">${t('save')}</button></div></form>`}
    <div class="rico-chips">${chips.map((c,i)=>`<button class="rico-chip" data-rico-ask="${esc(c)}" data-rico-action="${actions[i]}">${esc(c)}</button>`).join('')}</div>
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
  const err = m.error ? `<div class="rico-error">${esc(ricoErrorText(m.error))}${m.error==='not_configured' && state.role==='admin' ? ` <button class="rico-link" data-rico-settings>${t('ricoOpenSettings')}</button>` : ''}${m.retry ? ` <button class="rico-link" data-rico-retry="${i}">${t('retry')}</button>` : ''}</div>` : '';
  const status = m.streaming && m.text && m.statusKey && m.stepsDone ? `<div class="rico-status-line"><i></i>${esc(ricoStatusLabel(m.statusKey))}</div>` : '';
  const cards = (m.proposals||[]).map(p=>renderRicoProposal(p, i)).join('');
  const picker = m.picker ? renderRicoSupplierPicker(m.picker, i) : '';
  return `<div class="rico-msg bot${m.streaming?' streaming':''}" id="rico-m-${i}">
    ${ricoAvatar('rico-av-sm'+(m.streaming?' live':''))}
    <div class="rico-col">
      ${stepsHtml}${typing}${body ? `<div class="rico-bubble" dir="auto"><div class="rico-text">${body}</div></div>` : ''}${status}${picker}${cards}${err}
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
/* A small, safe Markdown subset: **bold**, `code`, bullet and numbered lists, paragraphs. */
function ricoFormat(src){
  const inline = s=>s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g,'$1<i>$2</i>');
  const out = []; let list = null, para = [];
  const flush = ()=>{ if(para.length){ out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  esc(src).split('\n').forEach(line=>{
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
  const done = p.status === 'applied', gone = p.status === 'dismissed' || p.status === 'undone';
  const actions = (primary, primaryLabel)=> gone
      ? `<div class="rico-card-state">${p.status==='undone'?t('ricoUndone'):t('ricoDismissed')}</div>`
      : done
        ? `<div class="rico-card-state ok">✓ ${esc(p.doneLabel || t('ricoDone'))}${p.kind==='order' ? ` <button class="rico-link" data-rico-open="order">${t('ricoOpenOrder')}</button>${p.undo?` <button class="rico-link" data-rico-undo="${mi}|${esc(p.id)}">${t('ricoUndo')}</button>`:''}` : ''}</div>`
        : `<div class="rico-card-actions"><button class="btn btn-primary" data-rico-apply="${mi}|${esc(p.id)}">${primaryLabel}</button><button class="btn btn-ghost" data-rico-dismiss="${mi}|${esc(p.id)}">${t('ricoNotNow')}</button></div>`;
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
    return ricoCard(icon, title, body, actions('order', p.mode==='set' ? t('ricoApplyChanges') : t('ricoPutInOrder')), p);
  }
  if(p.kind === 'new_item'){
    icon = ICON_PLUS; title = t('ricoCardNewItem');
    body = ricoFields([[t('name'), p.name], [t('unit'), state.lang==='ku' ? (p.unitKu||p.unit) : p.unit], [t('supplier'), p.supplier || t('noSupplier')]]);
    return ricoCard(icon, title, body, actions('new_item', t('addItem')), p);
  }
  if(p.kind === 'edit_item'){
    icon = ICON_EDIT; title = t('ricoCardEditItem');
    const row = (label, a, b)=> a===b ? [label, b] : [label, `<s>${esc(a)}</s> → ${esc(b)}`, true];
    body = ricoFields([row(t('name'), p.before.name, p.name), row(t('unit'), p.before.unit, p.unit), row(t('supplier'), p.before.supplier, p.supplier || t('noSupplier'))]);
    return ricoCard(icon, title, body, actions('edit_item', t('save')), p);
  }
  if(p.kind === 'new_supplier'){
    icon = NAV_ICONS.suppliers; title = t('ricoCardNewSupplier');
    body = ricoFields([[t('name'), p.name], [t('phone'), p.phone || '—']]);
    return ricoCard(icon, title, body, actions('new_supplier', t('addSupplier')), p);
  }
  if(p.kind === 'notify'){
    icon = ICON_BELL; title = t('ricoCardNotify');
    body = `<div class="rico-card-note"><b>${esc(p.title)}</b></div><div class="rico-card-msg" dir="ltr">${esc(p.en)}</div><div class="rico-card-msg" dir="rtl">${esc(p.ku)}</div>`;
    return ricoCard(icon, title, body, actions('notify', t('notifSend')), p);
  }
  if(p.kind === 'open'){
    if(p.screen === 'send') return `<button class="rico-open" data-rico-open="send">${ICON_CHAT}<span>${esc(p.label || t('ricoOpenSend'))}</span></button>`;
    const key = {order:'order',history:'history',suppliers:'suppliers',itemsAdmin:'items',units:'units',record:'record',devices:'devicesTitle',settings:'settings'}[p.screen] || 'order';
    return `<button class="rico-open" data-rico-open="${esc(p.screen)}" data-rico-sup="${esc(p.supplierId||'')}">${NAV_ICONS[p.screen]||NAV_ICONS.order}<span>${esc(p.label || t('ricoOpenScreen')(t(key)))}</span></button>`;
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
let ricoRecorder = {active:false, busy:false, rec:null, stream:null, chunks:[], timer:0};
function ricoVoiceSupported(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
function blobToBase64(blob){
  return new Promise((resolve, reject)=>{ const r = new FileReader(); r.onload = ()=>resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
}
async function ricoToggleVoice(){
  if(ricoRecorder.busy) return;
  if(ricoRecorder.active){ try{ ricoRecorder.rec.stop(); }catch(e){ ricoResetVoice(); } return; }
  if(rico.streaming) return;
  if(!ricoVoiceSupported()){ toast(t('ricoMicUnsupported'), 'warn'); return; }
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}}); }
  catch(e){ toast(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? t('ricoMicDenied') : t('ricoMicFailed'), 'warn'); return; }
  const mime = ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(m=>window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  let rec;
  try{ rec = new MediaRecorder(stream, mime ? {mimeType:mime, audioBitsPerSecond:32000} : undefined); }
  catch(e){ stream.getTracks().forEach(tr=>tr.stop()); toast(t('ricoMicFailed'), 'warn'); return; }
  Object.assign(ricoRecorder, {active:true, rec, stream, chunks:[]});
  rec.ondataavailable = e=>{ if(e.data && e.data.size) ricoRecorder.chunks.push(e.data); };
  rec.onstop = ()=>ricoFinishVoice(rec.mimeType || mime || 'audio/webm');
  rec.start(250);
  ricoRecorder.timer = setTimeout(()=>{ if(ricoRecorder.active) try{ rec.stop(); }catch(e){} }, 60000);
  haptic(10);
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
  try{
    if(blob.size < 1200) return;   // just a tap
    const audio = await blobToBase64(blob);
    const r = await api('assistant/transcribe', {method:'POST', body:{audio, mime:mime.split(';')[0], lang:state.lang}, timeout:45000});
    const text = r.ok && r.data && typeof r.data.text === 'string' ? r.data.text.trim() : '';
    if(!text){
      const code = r.data && r.data.error;
      toast(code === 'rate_limited' ? t('ricoErrors').rate_limited : code === 'not_configured' ? t('ricoErrors').not_configured : r.status === 0 ? t('ricoErrors').offline : t('ricoMicFailed'), 'warn');
      return;
    }
    ricoRecorder.busy = false;
    ricoAsk(text);
  }catch(e){ toast(t('ricoMicFailed'), 'warn'); }
  finally{ ricoRecorder.busy = false; ricoRefreshComposer(); }
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
    input.addEventListener('focus', ()=>document.body.classList.add('rico-typing'));
    input.addEventListener('blur', ()=>setTimeout(()=>document.body.classList.remove('rico-typing'), 120));
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
  document.getElementById('ricoNewBtn')?.addEventListener('click', async ()=>{
    if(!rico.messages.length) return;
    if(!(await showConfirm(t('ricoConfirmNewChat'), {okLabel:t('ricoNewChat'), okClass:'btn-primary'}))) return;
    ricoStop(); rico.messages = []; render();
  });
  document.getElementById('ricoAutoBtn')?.addEventListener('click', async ()=>{
    const on = !ricoAutoOrder();
    if(on && !(await showConfirm(t('ricoAutoOrderConfirm'), {okLabel:t('ricoAllow'), okClass:'btn-primary'}))) return;
    lset('ricoAutoOrder', on || null);
    toast(on ? t('ricoAutoOn') : t('ricoAutoOff'));
    render();
  });
  document.getElementById('ricoWhoBtn')?.addEventListener('click', async ()=>{
    const name = await showPrompt(t('ricoAskName'), {placeholder:t('ricoNamePlaceholder'), value:personName(), okLabel:t('save'), cancelLabel:t('cancel')});
    if(name === null) return;
    await setPersonName(name); render();
    if(name) toast(t('ricoNiceToMeet')(name));
  });
  const nameForm = document.getElementById('ricoNameForm');
  if(nameForm) nameForm.onsubmit = async e=>{
    e.preventDefault();
    const v = document.getElementById('ricoNameInput').value.trim();
    if(!v) return;
    await setPersonName(v); render(); toast(t('ricoNiceToMeet')(v));
  };
  attachRicoThreadEvents(document.getElementById('mainContent') || document);
  if(rico.messages.length) ricoScroll(false);
}
function attachRicoThreadEvents(root){
  root.querySelectorAll('[data-rico-ask]').forEach(b=>b.onclick=()=>ricoAsk(b.dataset.ricoAsk, {quickAction:b.dataset.ricoAction}));
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
    if(screen !== 'order' && screen !== 'history' && state.role !== 'admin') return;
    if(screen === 'order' && sup && state.suppliers.some(s=>s.id===sup)) state.orderTab = sup;
    goView(screen);
  });
  root.querySelectorAll('[data-rico-settings]').forEach(b=>b.onclick=()=>{ state.view='settings'; render(); requestAnimationFrame(()=>document.querySelector('.rico-status-card')?.scrollIntoView({block:'center'})); });
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
    || /(?:داواکاری|داواکردن).*ئەمڕۆ|ئەمڕۆ.*(?:داواکاری|داواکردن)/.test(text);
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
    let content = m.text || '';
    (m.proposals||[]).forEach(p=>{
      const what = {order:`order draft (${(p.lines||[]).length} items)`, new_item:`add item "${p.name}"`, edit_item:`edit item "${p.name}"`, new_supplier:`add supplier "${p.name}"`, notify:'notification', open:`open ${p.screen}`}[p.kind] || p.kind;
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
  if((options.quickAction==='prepare_order' || ricoOrderIntent(text)) && !scopeIds.length && !named.length){
    rico.messages.push({role:'user', text, ts:Date.now()});
    rico.messages.push({role:'assistant', text:t('ricoChooseSuppliers'), picker:{selectedIds:[], chosen:false}, ts:Date.now()});
    if(state.view !== 'assistant') state.view = 'assistant';
    render(); ricoScroll(true);
    return;
  }
  if(named.length && (options.quickAction==='prepare_order' || ricoOrderIntent(text)) && !scopeIds.length){
    options = {quickAction:'prepare_order', supplierIds:named};
  }
  const previousView = state.view;
  const requestRole = state.role;
  rico.messages.push({role:'user', text, ts:Date.now()});
  const bot = {role:'assistant', text:'', proposals:[], steps:[], streaming:true, statusKey:'thinking', ts:Date.now()};
  rico.messages.push(bot);
  rico.streaming = true;
  if(state.view !== 'assistant'){ state.view = 'assistant'; }
  render();
  ricoScroll(true);
  const idx = rico.messages.length - 1;
  const controller = new AbortController();
  rico.abort = controller;
  let frame = 0;
  const paint = ()=>{ if(frame) return; frame = requestAnimationFrame(()=>{ frame = 0; ricoPaintMessage(idx); }); };
  const body = {
    messages: ricoHistoryForServer(), lang: state.lang, screen: previousView, personName: personName(),
    autoOrder: ricoAutoOrder(), cart: Object.fromEntries(Object.entries(state.cart).filter(([,q])=>q>0)),
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
      if(p.kind === 'order' && ricoAutoOrder()){ ricoApplyOrder(p, true); }
      paint();
    }
    else if(ev.type === 'name'){ const me = myDevice(); if(me) me.personName = ev.name; lset('personName', ev.name); }
    else if(ev.type === 'error'){ bot.error = ev.code; bot.retry = ['offline','busy','failed'].includes(ev.code); paint(); }
  }, controller.signal);
  if(state.role !== requestRole) return;
  cancelAnimationFrame(frame);
  bot.streaming = false; bot.statusKey = null;
  if(controller.signal.aborted && !bot.text && !bot.proposals.length) bot.error = 'stopped';
  if(!controller.signal.aborted && !bot.text && !bot.proposals.length && !bot.error){ bot.error = 'failed'; bot.retry = true; }
  rico.streaming = false; rico.abort = null;
  if(state.view === 'assistant'){
    ricoPaintMessage(idx);
    ricoRefreshComposer();
    document.getElementById('ricoNewBtn')?.removeAttribute('disabled');
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
function ricoNearBottom(){ return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 220; }
function ricoScroll(smooth){
  requestAnimationFrame(()=>window.scrollTo({top:document.documentElement.scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'}));
}

/* ---------- Carrying out a confirmed proposal ---------- */
function ricoFind(mi, id){ const m = rico.messages[mi]; return m && (m.proposals||[]).find(p=>p.id===id); }
function ricoSetStatus(mi, id, status, extra = {}){
  const p = ricoFind(mi, id); if(!p) return;
  Object.assign(p, {status}, extra);
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
  const admin = state.role === 'admin';
  const run = async ()=>{
    if(p.kind === 'order'){ ricoApplyOrder(p, false); return true; }
    if(!admin){ await showAlert(t('ricoAdminOnly')); return false; }
    if(p.kind === 'new_item'){
      const supplierId = p.supplierId && state.suppliers.some(s=>s.id===p.supplierId) ? p.supplierId : null;
      const maxSort = state.items.filter(i=>i.supplierId===supplierId).reduce((mx,i)=>Number.isInteger(i.sortOrder)?Math.max(mx,i.sortOrder):mx,-1);
      const next = {id:'i'+Date.now(), name:p.name, unit:p.unitId, supplierId, sortOrder:maxSort>=0?maxSort+1:null};
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
      const next = {id:'s'+Date.now(), name:p.name, phone:p.phone||'', reminder:null};
      if(!(await saveRecord('suppliers', next))){ await showAlert(t('saveFailed')); return false; }
      state.suppliers.push(next);
      logActivity({action:'add', type:'supplier', name:p.name, fields:[{k:'name',to:p.name}].concat(p.phone?[{k:'phone',to:p.phone}]:[])});
      p.doneLabel = t('savedMsg')(p.name).replace(/^\u2713\s*/, '');
      return true;
    }
    if(p.kind === 'notify'){
      const res = await callSendPush('assistant', {title:p.title, bodyEn:p.en, bodyKu:p.ku});
      await reportSendResult(res);
      if(!res.ok) return false;
      p.doneLabel = t('ricoNotificationSent');
      return true;
    }
    return false;
  };
  if(btn){ btn.disabled = true; btn.classList.add('is-busy'); }
  const ok = await run().catch(()=>false);
  if(ok){ p.status = 'applied'; }
  if(state.view === 'assistant') ricoPaintMessage(mi);
}
function ricoUndo(mi, id){
  const p = ricoFind(mi, id);
  if(!p || !p.undo) return;
  state.cart = p.undo; persistCartDraft();
  ricoSetStatus(mi, id, 'undone', {undo:null});
  toast(t('ricoUndoneToast'));
}
