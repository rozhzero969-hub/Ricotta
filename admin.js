/* Ricotta Orders -- Admin (Rozh only).
   The dashboard: a headline (what needs a look, or All good), today's orders, receipts and transfers,
   a status row for each part of the app, real orders over time, then the pages to manage. A row opens its page, which slides in like a page on iPhone and has
   Admin's back button at the top:
     Problems          errors any phone ran into, and what people reported from Settings
     Security          wrong PINs, the sign-in lock (with Unlock), new phones and the sign-in log
     Health Check      the server, the database and the scheduled jobs, in plain words
     Yunis's Access    which screens Yunis can open and what he can do (the server checks it too)
     PINs              a new PIN for Rozh or Yunis
     Devices           signed-in phones: Refresh or Log Out
     Time in the App   per person and phone, adding up every day and never reset
     Rico              what Rico did this month and the tokens it used
     Catalog Check-up  items that need a look
   Each page's data is loaded when Admin or the page opens (at most once a minute) and with its
   refresh button. Depends on (runtime only): state, t, esc, api, render, toast, showConfirm,
   showAlert, showFormModal, accountLabel, whoBadge, timeAgo, fmtDateTime, formatIraqDateTime,
   scrollBox, pageGhost, endGlide, reducedMotion, isRtl, spinRefresh, withBusy, openItemModal,
   unitLabel, supplierName, viewLabel, ricoFace, ricoLateOrders, sharedDraft, draftChanges,
   draftProgressLabel, flushOutbox, syncSharedDraft, maybeFinishQueue, currentOutbox, sendDeviceCommand,
   refreshDevices, deviceParts, deviceTitle, otherDevices, commandIsPending, versionCmp. Load before app.js. */

const ADMIN_PAGES = ['problems','security','health','access','devices','time','rico','catalog','restore','person'];
const ADMIN_SOURCES = {overview:'admin/overview', backups:'admin/backups', health:'admin/diagnostics', security:'admin/security', problems:'admin/problems', usage:'admin/usage', rico:'admin/rico', ai:'admin/ai', roles:'admin/roles'};
/* What each page needs (the list itself shows a value from most of them). */
const ADMIN_NEEDS = {restore:['backups'], home:['overview','health','security','problems','usage','rico','roles'], problems:['problems'], security:['security'], health:['health','problems','security'],
  access:['roles'], devices:[], time:['usage'], rico:['rico','ai'], catalog:[], person:['usage','roles']};
let adminData = {account:null, busy:{}, failed:{}};
let adminFilter = {problems:'open', security:'all', time:'day', person:'rozha'};
let adminListTop = 0;
function resetAdmin(){ adminData = {account:null, busy:{}, failed:{}}; adminFilter = {problems:'open', security:'all', time:'day', person:'rozha'}; adminListTop = 0; }
function adminLoad(page, force = false){
  if(!isRozha()) return;
  if(adminData.account !== state.account){ resetAdmin(); adminData.account = state.account; }
  (ADMIN_NEEDS[page || 'home'] || []).forEach(key=>adminFetch(key, force));
}
async function adminFetch(key, force){
  if(adminData.busy[key] || (!force && adminData[key] && Date.now() - adminData[key].at < 60000)) return;
  const account = state.account;
  adminData.busy[key] = true;
  const r = await api(ADMIN_SOURCES[key]);
  if(account !== state.account || adminData.account !== account) return;
  adminData.busy[key] = false;
  // An answer of the wrong shape (an older server during a release) counts as not loaded. The screen is
  // redrawn only when something on it changed, so the regular refresh below never makes it flicker.
  const good = r.ok && ADMIN_SHAPES[key](r.data);
  const changed = good ? JSON.stringify(r.data) !== JSON.stringify(adminData[key]?.data) : !adminData.failed[key];
  if(good) adminData[key] = {at:Date.now(), data:r.data};
  adminData.failed[key] = !good;
  if(changed) paintAdmin();
}
/* While Admin is on screen its numbers are fetched again every 30 seconds (the Health Check only when
   asked, it runs real checks), so what it shows is current. Sign-ins, the security log and problems
   also come at once through Live changes (app.js). */
setInterval(()=>{
  if(state.view !== 'admin' || !isRozha() || document.visibilityState !== 'visible') return;
  (ADMIN_NEEDS[state.adminPage || 'home'] || []).filter(k=>k !== 'health').forEach(k=>adminFetch(k, true));
  if(!state.adminPage || state.adminPage === 'devices') checkCommands();
}, 30000);
const isAdminObject = v=>!!v && typeof v === 'object' && !Array.isArray(v);
const ADMIN_SHAPES = {overview:d=>isAdminObject(d) && isAdminObject(d.orders) && Array.isArray(d.orders.perDay) && Array.isArray(d.orders.suppliers) && isAdminObject(d.receipts) && Array.isArray(d.receipts.problems) && isAdminObject(d.transfers) && Array.isArray(d.transfers.problems),
  backups:Array.isArray, problems:Array.isArray, health:isAdminObject, rico:isAdminObject, ai:d=>isAdminObject(d) && Array.isArray(d.brains),
  security:d=>isAdminObject(d) && Array.isArray(d.events), usage:d=>isAdminObject(d) && Array.isArray(d.people),
  roles:d=>isAdminObject(d) && Array.isArray(d.yunis) && Array.isArray(d.roles)};
const adminValue = key=>adminData.account === state.account ? adminData[key]?.data : null;

/* ---------- The Admin screen ---------- */
function renderAdmin(){
  if(!isRozha()) return '';
  return `<div class="admin-page"><div id="adminSlot">${renderAdminBody()}</div></div>`;
}
function renderAdminBody(){
  const page = ADMIN_PAGES.includes(state.adminPage) ? state.adminPage : null;
  if(!page) return renderAdminHome();
  return ({problems:renderAdminProblems, security:renderAdminSecurity, health:renderAdminHealth, access:renderAdminAccess,
    devices:renderAdminDevices, time:renderAdminTime, rico:renderAdminRico, catalog:renderAdminCatalog, restore:renderAdminRestore, person:renderAdminPerson})[page]();
}
/* Redraws only Admin's own part (the heading stays), when new data arrives. */
function paintAdmin(){
  if(state.view !== 'admin') return;
  const slot = document.getElementById('adminSlot');
  if(!slot || refreshBlocked()) return;
  slot.innerHTML = renderAdminBody();
  attachAdminBodyEvents();
}
function attachAdminEvents(){
  adminLoad(state.adminPage);
  attachAdminBodyEvents();
}
function attachAdminBodyEvents(){
  const slot = document.getElementById('adminSlot');
  if(!slot) return;
  slot.querySelectorAll('[data-admin-open]').forEach(b=>b.onclick = ()=>openAdminPage(b.dataset.adminOpen));
  slot.querySelectorAll('[data-admin-jump]').forEach(b=>b.onclick = ()=>openAdminPage(b.dataset.adminJump));
  slot.querySelectorAll('[data-admin-go]').forEach(b=>b.onclick = ()=>openAdminGo(b.dataset.adminGo, b.dataset.adminId || ''));
  slot.querySelectorAll('[data-admin-person]').forEach(b=>b.onclick = ()=>{ adminFilter.person = b.dataset.adminPerson; openAdminPage('person'); });
  slot.querySelectorAll('[data-adh-refresh]').forEach(b=>b.onclick = async()=>{
    const d = state.devices.find(x=>x.id === b.dataset.adhRefresh);
    if(!d || !(await showConfirm(`<b>${esc(deviceTitle(d))}</b><br>${t('confirmRefreshDevice')}`, {okLabel:t('refreshDevice'), okClass:'btn-primary'}))) return;
    await sendDeviceCommand('refresh', [d.id]);
  });
  slot.querySelectorAll('[data-admin-refresh]').forEach(b=>b.onclick = ()=>spinRefresh(b, async()=>{
    const keys = ADMIN_NEEDS[state.adminPage || 'home'];
    if(state.adminPage === 'devices') await refreshDevices();
    await Promise.all(keys.map(k=>adminFetch(k, true)));
  }));
  ({restore:attachAdminRestore, problems:attachAdminProblems, security:attachAdminSecurity, health:attachAdminHealth, access:attachAdminAccess,
    devices:attachAdminDevices, catalog:attachAdminCatalog, time:attachAdminTime, rico:attachAdminAiSwitches, person:attachAdminPerson})[state.adminPage]?.(slot);
}
/* Opens a page (or goes back to the list) with the iPhone's push: the new page slides in from the side
   while the list moves a little the other way and dims; Back reverses it. */
function openAdminPage(page){
  const next = ADMIN_PAGES.includes(page) ? page : null;
  if(next === state.adminPage || state.view !== 'admin') return;
  const old = document.querySelector('.content');
  if(!state.adminPage) adminListTop = scrollBox().scrollTop;
  endGlide();
  const motion = old && old.animate && !reducedMotion();
  const ghost = motion ? pageGhost(old) : null;
  state.adminPage = next;
  render();
  scrollBox().scrollTo({top:next ? 0 : adminListTop});
  quietBar();
  adminLoad(next);
  const content = document.querySelector('.content');
  if(!motion || !content){ ghost?.layer.remove(); return; }
  const w = content.getBoundingClientRect().width, side = (next ? 1 : -1) * (isRtl() ? -1 : 1);
  const opts = {duration:420, easing:'cubic-bezier(.32,.72,0,1)'};
  // Like an iPhone push: the page in front covers the one behind. The page behind (the list going
  // forward, the list coming back) is trimmed to just the part not yet covered, in step with the
  // slide, so the two never show through each other.
  const trimEdge = (to)=> (next ? side : -side) > 0 ? `inset(0 ${to}% 0 0)` : `inset(0 0 0 ${to}%)`;
  const inn = next ? [{transform:`translate3d(${side*w}px,0,0)`}, {transform:'none'}]
    : [{transform:`translate3d(${side*w*.3}px,0,0)`, opacity:.6, clipPath:trimEdge(70)}, {transform:'none', opacity:1, clipPath:trimEdge(0)}];
  const out = next ? [{transform:'none', opacity:1, clipPath:trimEdge(0)}, {transform:`translate3d(${-side*w*.3}px,0,0)`, opacity:.6, clipPath:trimEdge(70)}]
    : [{transform:'none'}, {transform:`translate3d(${-side*w}px,0,0)`}];
  content.classList.add('gliding');
  const anims = [content.animate(inn, opts), ghost.copy.animate(out, opts)];
  glide = {anims, ghost:ghost.layer, content};
  const mine = glide;
  anims[0].finished.then(()=>{ if(glide === mine) endGlide(); }, ()=>{});
}
/* The heading of an Admin page: Admin's back button, then the page's name. */
function adminHeading(){
  const refresh = ['catalog','health'].includes(state.adminPage) ? '' : adminRefresh();
  return `<header class="page-heading admin-heading"><button type="button" class="page-back" data-admin-open="">${ICON_BACK}<span>${esc(t('adminTitle'))}</span></button><div class="page-title-row"><h1>${esc(t('adminPage_' + state.adminPage))}</h1>${refresh}</div></header>`;
}
const adminRefresh = ()=>`<button type="button" class="icon-btn admin-refresh" data-admin-refresh id="adminRefresh" aria-label="${esc(t('refresh'))}">${ICON_REFRESH}</button>`;
const adminTile = (icon, tone)=>`<span class="ad-tile ${tone}" aria-hidden="true">${icon}</span>`;

/* ---------- Durations and small helpers ---------- */
function fmtDuration(sec){
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if(!s) return t('durMin')(0);   // none at all is 0, not "under a minute"
  if(s < 60) return t('durLessMin');
  const m = Math.round(s / 60);
  if(m < 60) return t('durMin')(m);
  const h = Math.floor(m / 60), rest = m % 60;
  return h >= 24 && !rest ? t('durHour')(h) : rest ? t('durHourMin')(h, rest) : t('durHour')(h);
}
function adminDeviceLine(label){
  const p = deviceParts({label});
  return p.how ? `${p.kind} · ${p.how}` : p.kind;
}
const viewName = v=>VIEW_LABEL_KEYS[v] ? viewLabel(v) : v;

/* ---------- The list ---------- */
/* Everything that needs Rozh's attention right now, for the summary at the top. */
function adminIssues(){
  const out = [];
  // Only problems seen in the last 24 hours need a look; older ones wait quietly in Problems.
  const problems = (adminValue('problems') || []).filter(p=>!p.resolvedAt && Date.now() - Date.parse(p.lastAt) < 86400000);
  if(problems.length) out.push({page:'problems', text:t('adIssueProblems')(new Set(problems.map(p=>p.fingerprint)).size)});
  const sec = adminValue('security');
  if(sec?.lockedUntil && Date.parse(sec.lockedUntil) > Date.now()) out.push({page:'security', text:t('adIssueLocked')});
  const bad = healthRows().filter(r=>r.tone === 'bad').length;
  if(bad) out.push({page:'health', text:t('adIssueHealth')(bad)});
  return out;
}
/* The dashboard (the design Rozh approved on 2026-11-12), calm and in this order:
     1. One line under the title: All good, or how many things need a look, and when it was read.
     2. Today: orders, receipts and transfers, each with small bars for the last days and a plain
        comparison with the same weekday last week.
     3. Needs you: only real things, each with one button (Open, Refresh).
     4. Rico: is he running, and what he did today.
     5. People: Rozh and Yunis, one row each; a row opens that person's page (time, phones, PIN, access).
     6. Tools: Problems, Security, Health, Catalog, Restore, Rico's AI.
     7. Server: how full the database and the photos are.
   Only real rows are counted: a number that could not be read says so and is never shown as 0. */
const adNum = n=>Number(n || 0).toLocaleString('en-US');
/* "Today 16:33 · Yunis": when something last happened and who did it. */
function adWhen(at, by){
  if(!at) return t('adNeverYet');
  const time = formatIraqDateTime(at, {hour:'numeric', minute:'2-digit'});
  return [t('adLastAt')(`${dayLabel(at)} ${time}`), accountLabel(by)].filter(Boolean).join(' · ');
}
/* Phones signed in on an older version than the newest one any phone runs. */
function adOldPhones(){
  const latest = latestVersion();
  return state.devices.filter(d=>isLoggedIn(d) && d.id !== state.deviceId && d.appVersion && versionCmp(d.appVersion, latest) < 0);
}
/* The small bars under a number: the last 14 days (7 on a phone), today darkest. */
function adSpark(days){
  if(!Array.isArray(days) || !days.length) return '';
  const max = Math.max(1, ...days.map(d=>Number(d.n) || 0));
  return `<span class="adh-spark" aria-hidden="true">${days.map((d, i)=>`<i class="${i === days.length - 1 ? 'today' : ''}" style="height:${Math.max(3, Math.round((Number(d.n) || 0) / max * 100))}%"></i>`).join('')}</span>`;
}
/* "+2 vs last Thursday", "Same as last Thursday": today against the same weekday a week ago. */
function adVsLastWeek(days){
  if(!Array.isArray(days) || days.length < 8) return '';
  const now = Number(days[days.length - 1].n) || 0, then = Number(days[days.length - 8].n) || 0;
  const day = formatIraqDateTime(days[days.length - 8].day + 'T12:00:00Z', {weekday:'short'});
  return now === then ? t('adSameAsLast')(day) : t('adVsLast')((now > then ? '+' : '−') + Math.abs(now - then), day);
}
function renderAdminHome(){
  const ov = adminValue('overview'), ovFailed = adminData.failed.overview && !ov;
  const loading = ['health','problems','security','overview'].some(k=>!adminValue(k) && !adminData.failed[k]);
  const failedKeys = ['health','problems','security','overview'].filter(k=>adminData.failed[k] && !adminValue(k));
  const views = state.views || [];
  const issues = adminIssues().map(i=>({...i, action:t('adOpenIt')}));
  if(ov){
    if(views.includes('receipts')) ov.receipts.problems.forEach(p=>issues.push({go:'receipts', id:p.id, text:t('adIssueReceipt')(p.supplier), sub:p.problem || adWhen(p.at, p.by), action:t('adOpenIt')}));
    if(views.includes('transfers')) ov.transfers.problems.forEach(p=>issues.push({go:'transfers', id:p.id, text:t('adIssueTransfer')(p.to), sub:p.problem || adWhen(p.at, p.by), action:t('adOpenIt')}));
  }
  const latest = latestVersion();
  adOldPhones().forEach(d=>issues.push({device:d.id, text:t('adOldPhone')(accountLabel(d.account) || t('unnamedDevice'), deviceParts(d).kind), sub:t('adOldPhoneSub')('\u2066' + d.appVersion + '\u2069', '\u2066' + latest + '\u2069'), action:t('refreshDevice'), tone:'gray'}));
  const health = adminValue('health');
  const readAt = ov?.readAt || health?.checkedAt;

  // 1. The status line.
  const tone = issues.length ? 'warn' : loading ? '' : failedKeys.length ? 'bad' : 'ok';
  const line = issues.length ? t('adNeedsYou')(issues.length) : loading ? t('checking') : failedKeys.length ? t('adCouldntCheckSub')(failedKeys.map(k=>t('adSrc_' + k)).join(', ')) : t('adAllGoodShort');
  const status = `<section class="adh-status" aria-live="polite"><p><i class="ad-dot ${tone}" aria-hidden="true"></i><span>${esc([line, readAt ? t('adReadAt')(formatIraqDateTime(readAt, {hour:'numeric', minute:'2-digit'})) : ''].filter(Boolean).join(' · '))}</span></p>${adminRefresh()}</section>`;

  // 2. Today.
  const cell = (go, label, part)=>{
    const n = ov ? part.today : null;
    return `<button type="button" class="adh-today-cell" data-admin-go="${go}"><span class="adh-label">${esc(label)}</span>
      <b class="${ov && !n ? 'zero' : ''}">${ov ? adNum(n) : ovFailed ? '–' : '·'}</b>${ov ? adSpark(part.perDay) : ''}<small>${esc(ov ? adVsLastWeek(part.perDay) : ovFailed ? t('adCouldntLoad') : '')}</small></button>`;
  };
  const today = `<div class="section-title">${esc(t('today'))}</div><div class="adh-today">${cell('history', t('adRow_history'), ov?.orders)}${views.includes('receipts') ? cell('receipts', t('rrTitle'), ov?.receipts) : ''}${views.includes('transfers') ? cell('transfers', t('tfTitle'), ov?.transfers) : ''}</div>`;

  // 3. Needs you.
  const needs = issues.length ? `<div class="section-title">${esc(t('rrNeedsYou'))}</div><div class="adh-list adh-needs">${issues.map(i=>`<div class="adh-row">
      <span class="adh-ico ${i.tone || 'warn'}" aria-hidden="true">${i.device ? ADMIN_ICONS.devices : ADMIN_ICONS.problems}</span>
      <span class="adh-main"><b dir="auto">${esc(i.text)}</b>${i.sub ? `<small dir="auto">${esc(i.sub)}</small>` : ''}</span>
      <button type="button" class="adh-act" ${i.device ? `data-adh-refresh="${esc(i.device)}"` : i.page ? `data-admin-jump="${i.page}"` : `data-admin-go="${i.go}" data-admin-id="${esc(i.id || '')}"`}>${esc(i.action)}</button></div>`).join('')}</div>` : '';

  // 4. Rico.
  const helper = typeof rr !== 'undefined' ? rr.data?.helper : null;
  if(!helper && views.includes('receipts') && typeof rrLoad === 'function' && !rr.loading && !rr.data) rrLoad(true);
  const rico = adminValue('rico'), chats = rico ? Object.values(rico.kinds || {}).reduce((n, k)=>n + Number(k || 0), 0) : null;
  const stopped = ov ? (ov.receipts.problems.length + ov.transfers.problems.length) : null;
  const on = helper && helper.online && !helper.stopped;
  const stat = (n, label)=>`<div><b>${n === null || n === undefined ? '·' : adNum(n)}</b><span>${esc(label)}</span></div>`;
  const ricoCard = `<div class="section-title">${esc(t('adminPage_rico'))}</div><button type="button" class="adh-card adh-rico" data-admin-open="rico">
      <span class="adh-rico-top"><span class="adh-rico-face" aria-hidden="true">${ICON_SPARKLE}</span><span class="adh-main"><b>${esc(helper ? rrHelperLine(helper) : t('loading'))}</b><small>${esc(helper ? [on ? t('statusActive') : '', helper.lastSeen ? t('lastSeenLabel') + ' ' + timeAgo(helper.lastSeen) : ''].filter(Boolean).join(' · ') : '')}</small></span><i class="ad-dot ${helper ? (on ? 'ok' : 'warn') : ''}" aria-hidden="true"></i></span>
      <span class="adh-stats">${views.includes('receipts') ? stat(ov?.receipts.today, t('adRicoSaved')) : ''}${views.includes('transfers') ? stat(ov?.transfers.today, t('adRicoMoved')) : ''}${stat(stopped, t('adRicoStopped'))}${stat(chats, t('adRicoChatsMonth'))}</span></button>`;

  // 5. People.
  const usage = adminValue('usage'), roles = adminValue('roles');
  const person = a=>{
    const p = (usage?.people || []).find(x=>x.account === a) || {today:0};
    const mine = state.devices.filter(d=>d.account === a && isLoggedIn(d));
    const activeNow = mine.find(d=>deviceStatus(d) === 'active');
    const lastSeen = mine.map(d=>d.lastSeen).filter(Boolean).sort().pop();
    const where = activeNow ? `${t('statusActive')} · ${deviceParts(activeNow).kind}` : lastSeen ? timeAgo(lastSeen) : t('statusLoggedOut');
    const extra = a === 'yunis' && roles ? t('adScreens')(roles.yunis.length, roles.roles.length) : '';
    return `<button type="button" class="adh-row adh-person" data-admin-person="${a}">${whoBadge(a)}<span class="adh-main"><small>${esc([where, extra].filter(Boolean).join(' · '))}</small></span>
      <span class="adh-val"><b>${usage ? esc(fmtDuration(p.today)) : '·'}</b><small>${esc(t('today'))}</small></span><span class="ad-row-go" aria-hidden="true">›</span></button>`;
  };
  const signedIn = state.devices.filter(isLoggedIn).length;
  const people = `<div class="section-title">${esc(t('adPeople'))}</div><div class="adh-list">${person('rozha')}${person('yunis')}
    <button type="button" class="adh-row" data-admin-open="devices"><span class="adh-ico gray" aria-hidden="true">${ADMIN_ICONS.devices}</span><span class="adh-main"><b>${esc(t('adAllDevices'))}</b><small>${esc(t('adDevicesSub')(state.devices.filter(d=>deviceStatus(d) === 'active').length))}</small></span><span class="adh-val"><b>${signedIn}</b></span><span class="ad-row-go" aria-hidden="true">›</span></button></div>`;

  // 6. Tools.
  const pr = adminValue('problems'), open = new Set((pr || []).filter(p=>!p.resolvedAt).map(p=>p.fingerprint)).size;
  const sec = adminValue('security'), locked = !!(sec?.lockedUntil && Date.parse(sec.lockedUntil) > Date.now());
  const rows = healthRows(), bad = rows.filter(r=>r.tone === 'bad').length;
  const toReview = catalogCheckup().reduce((n, g)=>n + g.items.length, 0);
  const tool = (page, icon, value, sub, alert = false)=>`<button type="button" class="adh-tool" data-admin-open="${page}"><span class="adh-tool-top"><span class="adh-tool-ico" aria-hidden="true">${icon}</span><span class="adh-tool-val${alert ? ' alert' : ''}">${esc(value)}</span></span><span class="adh-tool-name">${esc(t('adminPage_' + page))}</span><small>${esc(sub)}</small></button>`;
  const tools = `<div class="section-title">${esc(t('adTools'))}</div><div class="adh-tools">
      ${tool('problems', ADMIN_ICONS.problems, pr ? (open ? String(open) : t('adOk')) : '·', pr ? (open ? t('adProblemsOpen')(open) : t('adProblemsClear')) : '', open > 0)}
      ${tool('security', ADMIN_ICONS.security, sec ? (locked ? t('adLocked') : t('adOk')) : '·', sec ? t('adWrongPins')(Number(sec.wrongPins24h) || 0) : '', locked)}
      ${tool('health', ADMIN_ICONS.health, health ? (bad ? t('adNeedsLook') : t('adOk')) : '·', health ? t('checkedAt')(timeAgo(health.checkedAt)) : '', bad > 0)}
      ${tool('catalog', ADMIN_ICONS.catalog, toReview ? String(toReview) : t('adOk'), toReview ? t('adCatalogSub') : t('adCatalogClear'))}
      ${tool('restore', ADMIN_ICONS.restore, '', t('adRestoreSub'))}
      ${tool('rico', ICON_SPARKLE, '', t('adAiSub'))}
    </div>`;

  return status + today + needs + ricoCard + people + tools + adServerCard()
    + `<details class="ad-sources"><summary>${esc(t('adSourcesTitle'))}</summary><p>${esc(t('adSourcesBody'))}</p></details>`;
}
/* A person's page: their time today and on average, their phones (Refresh or Log out), their PIN, and
   for Yunis what he can open. */
function renderAdminPerson(){
  const a = adminFilter.person === 'yunis' ? 'yunis' : 'rozha';
  const usage = adminValue('usage'), p = (usage?.people || []).find(x=>x.account === a);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(usage?.today)) ? usage.today : new Date().toISOString().slice(0,10);
  const latest = latestVersion();
  const phones = state.devices.filter(d=>d.account === a && isLoggedIn(d)).map(d=>{
    const parts = deviceParts(d), isThis = d.id === state.deviceId, old = d.appVersion && versionCmp(d.appVersion, latest) < 0;
    return `<div class="adh-row adh-dev"><span class="adh-ico gray" aria-hidden="true">${/PC|Mac|Chromebook/.test(parts.kind) ? ICON_COMPUTER : ICON_MOBILE}</span>
      <span class="adh-main"><b>${esc(parts.kind)}${parts.how ? ` · ${esc(parts.how)}` : ''}${isThis ? ` · ${esc(t('thisDevice'))}` : ''}</b><small>${esc([deviceStatus(d) === 'active' ? t('statusActive') : d.lastSeen ? timeAgo(d.lastSeen) : '', d.appVersion ? (old ? t('versionOld') : '\u2066' + d.appVersion + '\u2069') : ''].filter(Boolean).join(' · '))}</small></span>
      ${isThis ? '' : `<button type="button" class="adh-act" data-devrefresh="${esc(d.id)}">${esc(t('refreshDevice'))}</button><button type="button" class="adh-act danger" data-devlogout="${esc(d.id)}">${esc(t('logoutDevice'))}</button>`}</div>`;
  }).join('');
  const roles = adminValue('roles');
  return `<header class="page-heading admin-heading"><button type="button" class="page-back" data-admin-open="">${ICON_BACK}<span>${esc(t('adminTitle'))}</span></button><div class="page-title-row"><h1>${esc(accountLabel(a))}</h1>${adminRefresh()}</div></header>
    <div class="adh-stats adh-card">
      <div><b>${p ? esc(fmtDuration(p.today)) : '·'}</b><span>${esc(t('today'))}</span></div>
      <div><b>${p ? esc(fmtDuration(timeAverage(p, 'day', today))) : '·'}</b><span>${esc(t('adTimeAvg_day'))}</span></div>
      <div><b>${p ? esc(fmtDuration(p.total)) : '·'}</b><span>${esc(t('adAllTime'))}</span></div>
    </div>
    <div class="section-title">${esc(t('adminPage_devices'))}</div>
    <div class="adh-list">${phones || `<div class="adh-row"><span class="adh-main"><small>${esc(t('noDevicesYet'))}</small></span></div>`}</div>
    <div class="adh-list adh-links">
      <div class="adh-row"><span class="adh-ico gray" aria-hidden="true">${ADMIN_ICONS.pins}</span><span class="adh-main"><b>PIN</b><small aria-hidden="true">••••••</small></span><button type="button" class="adh-act" data-pin-change="${a}">${esc(t('adminPinChange'))}</button></div>
      ${a === 'yunis' ? `<button type="button" class="adh-row" data-admin-open="access"><span class="adh-ico gray" aria-hidden="true">${ADMIN_ICONS.access}</span><span class="adh-main"><b>${esc(t('adminPage_access'))}</b><small>${esc(roles ? t('adScreens')(roles.yunis.length, roles.roles.length) : '')}</small></span><span class="ad-row-go" aria-hidden="true">›</span></button>` : ''}
      <button type="button" class="adh-row" data-admin-open="time"><span class="adh-ico gray" aria-hidden="true">${ADMIN_ICONS.time}</span><span class="adh-main"><b>${esc(t('adminPage_time'))}</b><small>${esc(t('adTimeBoth'))}</small></span><span class="ad-row-go" aria-hidden="true">›</span></button>
    </div>`;
}
function attachAdminPerson(slot){
  attachAdminDevices(slot);
  attachAdminPins(slot);
}
/* A business row or a receipt/transfer that needs a look opens its own screen (and that receipt or
   transfer once the list has loaded). */
function openAdminGo(view, id){
  goView(view);
  if(!id) return;
  let tries = 20;
  const find = view === 'receipts' ? ()=>typeof rrFind === 'function' && rrFind(id) : ()=>typeof tfFind === 'function' && tfFind(id);
  const open = view === 'receipts' ? rrOpen : tfOpen;
  const tick = ()=>{ if(state.view !== view) return; if(find()) open(id); else if(--tries > 0) setTimeout(tick, 300); };
  tick();
}
/* Admin > Server, always on the home page (no tapping): how full the free server plan is, as two bars,
   each with one plain sentence. Read again when the page is drawn and more than a minute old. */
let adServer = null, adServerAt = 0;
const adSize = b=> b >= 1073741824 ? (b / 1073741824).toFixed(2).replace(/\.?0+$/, '') + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB';
function adMeter(label, used, limit, hint){
  const pct = Math.min(100, (used / limit) * 100), tone = pct >= 90 ? 'full' : pct >= 70 ? 'warn' : 'ok';
  return `<div class="ad-srv"><span class="ad-srv-label">${esc(label)}</span><b dir="ltr">${esc(t('adSrvOf')(adSize(used), adSize(limit)))}</b>
    <div class="ad-srv-bar ${tone}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${Math.max(pct, used ? 1.5 : 0).toFixed(1)}%"></i></div>
    <small>${esc(hint)}</small></div>`;
}
function adServerCard(){
  if(Date.now() - adServerAt > 60000){ adServerAt = Date.now(); api('admin/server', {quiet:true}).then(r=>{ if(r.ok){ adServer = r.data; paintAdmin(); } }); }
  return `<div class="section-title">${esc(t('adServer'))}</div>
    <div class="adh-card ad-srv-card">${adServer ? adMeter(t('adSrvDb'), adServer.dbBytes, adServer.dbLimit, t('adSrvDbHint')) + adMeter(t('adSrvFiles'), adServer.filesBytes, adServer.filesLimit, t('adSrvFilesHint')) : loadingLines(2)}</div>`;
}
const ADMIN_ICONS = {
  restore:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v3.7h3.7"/><path d="M12 8v4l2.6 1.6"/></svg>`,
  problems:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19Z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>`,
  security:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Z"/></svg>`,
  health:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>`,
  access:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>`,
  pins:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3"/><path d="m16 7 3 3"/><path d="m14 9 2 2"/></svg>`,
  devices:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>`,
  time:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  catalog:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5"/><path d="m3.5 12 1.2 1.2L7 11"/><path d="m3.5 18 1.2 1.2L7 17"/></svg>`,
  person:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>`,
  lock:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>`,
  unlock:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/></svg>`,
  wrong:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>`,
  plus:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  enter:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="m10 8 4 4-4 4"/><path d="M14 12H4"/></svg>`,
  bubble:`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.5A7.5 7.5 0 1 1 20 11.5Z"/></svg>`,
};

/* ---------- Problems ---------- */
/* Grouped by problem: how often, on how many phones, when it was last seen, and the details. */
function problemGroups(list){
  const groups = new Map();
  for(const p of list){
    const g = groups.get(p.fingerprint) || {fingerprint:p.fingerprint, kind:p.kind, message:p.message, source:p.source, stack:p.stack, screen:p.screen, rows:[], count:0, lastAt:p.lastAt, firstAt:p.firstAt};
    g.rows.push(p); g.count += Number(p.count) || 1;
    if(p.lastAt > g.lastAt){ g.lastAt = p.lastAt; g.message = p.message; g.stack = p.stack || g.stack; g.source = p.source || g.source; g.screen = p.screen || g.screen; }
    if(p.firstAt < g.firstAt) g.firstAt = p.firstAt;
    groups.set(p.fingerprint, g);
  }
  return [...groups.values()].sort((a, b)=>String(b.lastAt).localeCompare(String(a.lastAt)));
}
function renderAdminProblems(){
  const all = adminValue('problems') || [];
  const open = all.filter(p=>!p.resolvedAt), fixed = all.filter(p=>p.resolvedAt);
  const showing = adminFilter.problems === 'fixed' ? fixed : open;
  const groups = problemGroups(showing);
  const latest = latestVersion();
  const kindIcon = k=>k === 'manual' ? ADMIN_ICONS.bubble : ADMIN_ICONS.problems;
  const cards = groups.map(g=>{
    const phones = new Set(g.rows.map(r=>r.deviceId + r.account)).size;
    const rows = g.rows.map(r=>`<li>${whoBadge(r.account)}<span class="ad-dev">${esc(adminDeviceLine(r.label))}</span>${r.version ? `<span class="dev-ver ${versionCmp(r.version, latest) >= 0 ? 'ok' : 'old'}"><bdi dir="ltr">${esc(r.version)}</bdi></span>` : ''}<b>${esc(t('adTimes')(r.count))}</b></li>`).join('');
    const details = [g.source, g.stack].filter(Boolean).join('\n');
    return `<article class="ad-card problem${g.kind === 'manual' ? ' manual' : ''}">
      <div class="ad-card-head">${adminTile(kindIcon(g.kind), g.kind === 'manual' ? 'green' : adminFilter.problems === 'fixed' ? 'gray' : 'red')}<div class="ad-card-title"><b dir="auto">${esc(g.message)}</b>
        <span>${esc(g.kind === 'manual' ? t('adReported') : t('adProblemKind_' + g.kind))}${g.screen ? ` · ${esc(t('adOnScreen')(viewName(g.screen)))}` : ''}</span></div></div>
      <div class="ad-meta">${esc(t('adProblemMeta')(g.count, phones))} · ${esc(t('adLastSeen')(timeAgo(g.lastAt)))}</div>
      <ul class="ad-devlist">${rows}</ul>
      ${details ? `<details class="ad-details"><summary>${esc(t('adTechnical'))}</summary><pre dir="ltr">${esc(details)}</pre></details>` : ''}
      <div class="ad-card-actions">${g.rows.some(r=>!r.resolvedAt) ? `<button type="button" class="btn btn-ghost" data-problem-fix="${esc(g.fingerprint)}">${ICON_CHECK}<span>${esc(t('adMarkFixed'))}</span></button>` : `<span class="ad-fixed">${esc(t('adFixedAgo')(timeAgo(g.rows.map(r=>r.resolvedAt).sort().pop())))}</span>`}</div>
    </article>`;
  }).join('');
  const empty = adminValue('problems') ? `<div class="ad-empty">${adminTile(ICON_CHECK, 'green')}<b>${esc(t(adminFilter.problems === 'fixed' ? 'adNoFixed' : 'adNoProblems'))}</b><p>${esc(t('adProblemsHint'))}</p></div>` : (adminData.failed.problems ? `<div class="ad-empty"><p>${esc(t('loadFailed'))}</p></div>` : loadingLines());
  return `${adminHeading()}
    <div class="ad-toolbar"><div class="pill-seg" role="tablist" aria-label="${esc(t('adminPage_problems'))}">${[['open', t('adOpenN')(new Set(open.map(p=>p.fingerprint)).size)], ['fixed', t('adFixed')]].map(([v, l])=>`<button type="button" role="tab" class="pill-seg-btn" data-problem-filter="${v}" aria-selected="${adminFilter.problems === v}">${esc(l)}</button>`).join('')}</div></div>
    ${cards || empty}
    ${fixed.length && adminFilter.problems === 'fixed' ? `<button type="button" class="btn btn-ghost ad-wide" id="problemsClear">${esc(t('adRemoveFixed'))}</button>` : ''}
    <p class="ad-foot">${esc(t('adProblemsFoot'))}</p>`;
}
function attachAdminProblems(slot){
  slot.querySelectorAll('[data-problem-filter]').forEach(b=>b.onclick = ()=>{ adminFilter.problems = b.dataset.problemFilter; paintAdmin(); });
  slot.querySelectorAll('[data-problem-fix]').forEach(b=>b.onclick = ()=>withBusy(b, async()=>{
    const ids = (adminValue('problems') || []).filter(p=>p.fingerprint === b.dataset.problemFix && !p.resolvedAt).map(p=>p.id);
    const r = await api('admin/problems/resolve', {method:'POST', body:{ids}});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    const now = new Date().toISOString();
    adminData.problems.data.forEach(p=>{ if(ids.includes(p.id)) p.resolvedAt = now; });
    toast(t('adMarkedFixed'));
    paintAdmin();
  }));
  const clear = slot.querySelector('#problemsClear');
  if(clear) clear.onclick = async()=>{
    if(!(await showConfirm(esc(t('adRemoveFixedAsk')), {okLabel:t('adRemoveFixed')}))) return;
    const r = await api('admin/problems', {method:'DELETE'});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    adminData.problems.data = adminData.problems.data.filter(p=>!p.resolvedAt);
    adminFilter.problems = 'open';
    paintAdmin();
  };
}

/* ---------- Security ---------- */
const SECURITY_FILTERS = {all:null, signin:['signin'], wrong:['wrong_pin','locked','unlocked'], new:['new_device'], changes:['pin_changed','roles_changed']};
function securityEventText(e){
  const who = accountLabel(e.account), forWho = accountLabel(e.detail?.for);
  return ({signin:t('adEvSignin')(who), new_device:t('adEvNewDevice')(who), wrong_pin:t('adEvWrongPin'), locked:t('adEvLocked'), unlocked:t('adEvUnlocked'),
    pin_changed:t('adEvPinChanged')(forWho || who), roles_changed:t('adEvRolesChanged')(forWho || accountLabel('yunis'))})[e.kind] || e.kind;
}
function renderAdminSecurity(){
  const sec = adminValue('security');
  if(!sec) return `${adminHeading()}${adminData.failed.security ? `<div class="ad-empty"><p>${esc(t('loadFailed'))}</p></div>` : loadingLines()}`;
  const locked = sec.lockedUntil && Date.parse(sec.lockedUntil) > Date.now();
  const icon = {signin:[ADMIN_ICONS.enter, 'green'], new_device:[ADMIN_ICONS.devices, 'red'], wrong_pin:[ADMIN_ICONS.wrong, 'gray'], locked:[ADMIN_ICONS.lock, 'red'],
    unlocked:[ADMIN_ICONS.unlock, 'green'], pin_changed:[ADMIN_ICONS.pins, 'gray'], roles_changed:[ADMIN_ICONS.person, 'gray']};
  const kinds = SECURITY_FILTERS[adminFilter.security];
  const events = (sec.events || []).filter(e=>!kinds || kinds.includes(e.kind));
  let lastDay = '';
  const list = events.map(e=>{
    const day = dayLabel(e.at), head = day !== lastDay ? `<div class="ad-day">${esc(day)}</div>` : '';
    lastDay = day;
    const [ic, tone] = icon[e.kind] || [ADMIN_ICONS.security, 'gray'];
    return `${head}<div class="ad-event">${adminTile(ic, tone)}<div><b>${esc(securityEventText(e))}</b><span>${esc([e.label ? adminDeviceLine(e.label) : '', formatIraqDateTime(e.at, {hour:'numeric', minute:'2-digit'})].filter(Boolean).join(' · '))}</span></div></div>`;
  }).join('');
  return `${adminHeading()}
    <section class="ad-status ${locked ? 'bad' : 'good'}">${adminTile(locked ? ADMIN_ICONS.lock : ADMIN_ICONS.security, locked ? 'red' : 'green')}
      <div><b>${esc(locked ? t('adSigninLocked')(formatIraqDateTime(sec.lockedUntil, {hour:'numeric', minute:'2-digit'})) : t('adSigninOpen'))}</b>
      <span>${esc(locked ? t('adSigninLockedHint') : t('adSigninOpenHint')(sec.failuresInWindow || 0, sec.lockLimit || 40))}</span></div>
      ${locked || sec.failuresInWindow ? `<button type="button" class="btn ${locked ? 'btn-primary' : 'btn-ghost'}" id="secUnlock">${esc(t('adUnlock'))}</button>` : ''}</section>
    <div class="ad-stats">
      <div><b>${Number(sec.wrongPins24h) || 0}</b><span>${esc(t('adStatWrong'))}</span></div>
      <div><b>${Number(sec.signins24h) || 0}</b><span>${esc(t('adStatSignins'))}</span></div>
      <div><b>${Number(sec.newDevices7d) || 0}</b><span>${esc(t('adStatNew'))}</span></div>
    </div>
    <p class="ad-note">${ADMIN_ICONS.security}<span>${esc(t('adNewPhoneNote'))}</span></p>
    <div class="ad-toolbar"><div class="record-filters glass" role="group">${Object.keys(SECURITY_FILTERS).map(k=>`<button type="button" class="tab-pill${adminFilter.security === k ? ' active' : ''}" aria-pressed="${adminFilter.security === k}" data-sec-filter="${k}">${esc(t('adSecFilter_' + k))}</button>`).join('')}</div></div>
    <div class="ad-group ad-events">${list || `<div class="ad-empty"><p>${esc(t('adNoEvents'))}</p></div>`}</div>
    <p class="ad-foot">${esc(t('adSecurityFoot'))}</p>`;
}
function attachAdminSecurity(slot){
  slot.querySelectorAll('[data-sec-filter]').forEach(b=>b.onclick = ()=>{ adminFilter.security = b.dataset.secFilter; paintAdmin(); });
  const unlock = slot.querySelector('#secUnlock');
  if(unlock) unlock.onclick = async()=>{
    if(!(await showConfirm(esc(t('adUnlockAsk')), {okLabel:t('adUnlock'), okClass:'btn-primary'}))) return;
    const r = await api('admin/security/unlock', {method:'POST'});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    toast(t('adUnlocked'));
    adminFetch('security', true);
  };
}

/* ---------- Health Check ---------- */
/* Rozh's health check in plain words: each row says what it is, how it is, and what to do when it isn't
   right. Read only; it runs when Admin opens (at most once a minute) and with Check Now. */
const HEALTH_JOBS = [['ricotta-reminder-tick','jobReminder', 10], ['ricotta-monthly-history','jobHistory', 45*24*60], ['ricotta-daily-cleanup','jobCleanup', 26*60], ['ricotta-cron-history','jobLogs', 26*60]];
function waitingToSave(){ return currentOutbox().length + (state.queue?.record && state.queue.saveState === 'failed' ? 1 : 0); }
function healthRows(){
  const h = adminValue('health'), rows = [];
  if(!h){
    if(adminData.failed.health) rows.push({title:t('apiDatabase'), hint:t('hcServerHint'), value:t('needsAttention'), tone:'bad', fix:t('hcServerFix')});
    return rows;
  }
  const ms = Number(h.latencyMs) || 0;
  rows.push({title:t('apiDatabase'), hint:t('hcServerHint'), value:t('hcAnswered')(ms), tone:ms > 2500 ? 'warn' : 'good'});
  if(h.databaseBytes){
    const mb = h.databaseBytes / 1048576, pct = mb / 500;
    rows.push({title:t('hcSpace'), hint:t('hcSpaceHint'), value:t('hcSpaceValue')(Math.round(mb)), tone:pct > .9 ? 'bad' : pct > .7 ? 'warn' : 'good', fix:pct > .7 ? t('hcSpaceFix') : ''});
  }
  const jobs = Array.isArray(h.jobs) ? h.jobs : [];
  for(const [name, label, okMinutes] of HEALTH_JOBS){
    const job = jobs.find(j=>j.name === name);
    const late = job?.lastRun && Date.now() - Date.parse(job.lastRun) > okMinutes * 60000;
    if(!job || !job.active) rows.push({title:t(label), hint:t(label + 'Hint'), value:t('jobDisabled'), tone:'bad', fix:t('hcJobFix')});
    else if(job.failures24h > 0 || job.lastStatus === 'failed') rows.push({title:t(label), hint:t(label + 'Hint'), value:t('jobFailed'), tone:'bad', fix:t('hcJobFix')});
    else rows.push({title:t(label), hint:t(label + 'Hint'), value:job.lastRun ? t('jobLastRun')(timeAgo(job.lastRun)) : t('notChecked'), tone:late ? 'warn' : job.lastRun ? 'good' : 'idle'});
  }
  rows.push({title:t('hcPush'), hint:t('hcPushHint'), value:t('hcPushValue')(h.pushPhones || 0), tone:h.pushPhones ? 'good' : 'warn', fix:h.pushPhones ? '' : t('hcPushFix')});
  rows.push({title:t('hcProblems'), hint:t('hcProblemsHint'), value:h.problems24h ? t('hcProblemsValue')(h.problems24h) : t('adNone'), tone:h.problems24h ? 'warn' : 'good', open:h.problems24h ? 'problems' : ''});
  rows.push({title:t('hcWrongPins'), hint:t('hcWrongPinsHint'), value:String(h.wrongPins24h || 0), tone:(h.wrongPins24h || 0) >= 10 ? 'warn' : 'good', open:h.wrongPins24h ? 'security' : ''});
  const waiting = waitingToSave(), unsynced = sharedDraft.enabled && (sharedDraft.conflicts.length || draftChanges(sharedDraft.base, state.cart).length);
  rows.push({title:t('deviceSaves'), hint:t('hcSavesHint'), value:waiting ? t('hcWaiting')(waiting) : t('hcNothingWaiting'), tone:waiting ? 'warn' : 'good', retry:!!waiting});
  rows.push({title:t('draftSaveState'), hint:t('hcDraftHint'), value:draftProgressLabel(), tone:unsynced ? 'warn' : 'good', retry:!!unsynced});
  return rows;
}
function renderAdminHealth(){
  const h = adminValue('health'), rows = healthRows();
  const bad = rows.filter(r=>r.tone === 'bad').length, warn = rows.filter(r=>r.tone === 'warn').length;
  const busy = adminData.busy.health;
  const summary = !h && !adminData.failed.health ? t('checking') : bad ? t('hcBad')(bad) : warn ? t('hcWarn')(warn) : t('hcGood');
  const counts = Number.isFinite(h?.items) ? `<div class="ad-stats"><div><b>${h.items}</b><span>${esc(t('items'))}</span></div><div><b>${Number(h.suppliers) || 0}</b><span>${esc(t('suppliers'))}</span></div><div><b>${Number(h.ordersThisMonth) || 0}</b><span>${esc(t('hcOrdersMonth'))}</span></div></div>` : '';
  return `${adminHeading()}
    <section class="ad-status ${bad ? 'bad' : warn ? 'warn' : 'good'}">${adminTile(bad || warn ? ADMIN_ICONS.problems : ICON_CHECK, bad ? 'red' : warn ? 'gray' : 'green')}
      <div><b>${esc(summary)}</b><span>${esc(h?.checkedAt ? t('checkedAt')(timeAgo(h.checkedAt)) : t('diagnosticsHint'))}</span></div>
      <button type="button" class="btn btn-ghost" data-admin-refresh id="healthCheck" ${busy ? 'disabled' : ''}>${ICON_REFRESH}<span>${esc(t(busy ? 'checking' : 'checkNow'))}</span></button></section>
    ${counts}
    <div class="ad-group">${rows.map(r=>`<div class="ad-health ${r.tone}"><i aria-hidden="true"></i><div class="ad-health-text"><b>${esc(r.title)}</b><span>${esc(r.hint)}</span>${r.fix ? `<em>${esc(r.fix)}</em>` : ''}</div>
      <div class="ad-health-value"><span>${esc(r.value)}</span>${r.retry ? `<button type="button" class="rico-link" data-health-retry>${esc(t('retryDraft'))}</button>` : ''}${r.open ? `<button type="button" class="rico-link" data-admin-open="${r.open}">${esc(t('adShow'))}</button>` : ''}</div></div>`).join('')}</div>
    ${h?.lastOrderAt ? `<p class="ad-foot">${esc(t('hcLastOrder')(fmtDateTime(h.lastOrderAt)))}</p>` : ''}`;
}
function attachAdminHealth(slot){
  slot.querySelectorAll('[data-health-retry]').forEach(b=>b.onclick = async()=>{
    const account = state.account;
    b.disabled = true;
    await flushOutbox(); await syncSharedDraft();
    if(account !== state.account) return;
    if(state.queue?.record) await maybeFinishQueue();
    paintAdmin();
  });
}

/* ---------- Yunis's access ---------- */
const ACCESS_SCREENS = [['history', NAV_ICONS.history], ['manage', NAV_ICONS.manage], ['receipts', NAV_ICONS.receipts], ['transfers', NAV_ICONS.transfers], ['record', NAV_ICONS.record], ['assistant', ICON_SPARKLE]];
const ACCESS_ACTIONS = ['catalog', 'send', 'exports', 'notify'];
function renderAdminAccess(){
  const r = adminValue('roles');
  if(!r) return `${adminHeading()}${adminData.failed.roles ? `<div class="ad-empty"><p>${esc(t('loadFailed'))}</p></div>` : loadingLines()}`;
  const on = new Set(r.yunis);
  const row = (role, icon)=>{
    const needsManage = role === 'catalog' && !on.has('manage');
    return `<label class="check-row preference-row ad-switch">${icon ? `<span class="ad-switch-icon" aria-hidden="true">${icon}</span>` : ''}<input type="checkbox" data-role="${role}" ${on.has(role) && !needsManage ? 'checked' : ''} ${needsManage ? 'disabled' : ''}><span>${esc(t('role_' + role))}<small>${esc(needsManage ? t('roleNeedsManage') : t('role_' + role + 'Hint'))}</small></span></label>`;
  };
  return `${adminHeading()}
    <section class="ad-person">${whoBadge('yunis')}<p>${esc(t('accessIntro'))}</p></section>
    <div class="section-title">${esc(t('accessScreens'))}</div>
    <div class="form-card ad-switches"><label class="check-row preference-row ad-switch"><span class="ad-switch-icon" aria-hidden="true">${NAV_ICONS.order}</span><input type="checkbox" checked disabled><span>${esc(t('order'))}<small>${esc(t('accessOrderAlways'))}</small></span></label>${ACCESS_SCREENS.map(([role, icon])=>row(role, icon)).join('')}</div>
    <div class="section-title">${esc(t('accessActions'))}</div>
    <div class="form-card ad-switches">${ACCESS_ACTIONS.map(role=>row(role)).join('')}</div>
    ${r.standard ? '' : `<button type="button" class="btn btn-ghost ad-wide" id="accessStandard">${esc(t('accessStandard'))}</button>`}
    <p class="ad-foot">${esc(t('accessFoot'))}</p>`;
}
function attachAdminAccess(slot){
  const save = async roles=>{
    const r = await api('admin/roles', {method:'PUT', body:{account:'yunis', roles}});
    if(!r.ok || !Array.isArray(r.data?.roles)){ toast(t('saveFailed'), 'error'); paintAdmin(); return false; }
    adminData.roles = {at:Date.now(), data:{...adminData.roles.data, yunis:r.data.roles, standard:false}};
    paintAdmin();
    return true;
  };
  slot.querySelectorAll('[data-role]').forEach(box=>box.onchange = async()=>{
    const current = new Set(adminValue('roles').yunis);
    if(box.checked) current.add(box.dataset.role); else current.delete(box.dataset.role);
    if(box.dataset.role === 'manage' && !box.checked) current.delete('catalog');
    slot.querySelectorAll('[data-role]').forEach(b=>{ b.disabled = true; });
    if(await save([...current])) toast(t('accessSaved'));
  });
  const standard = slot.querySelector('#accessStandard');
  if(standard) standard.onclick = ()=>withBusy(standard, async()=>{
    if(await save(ALL_ROLES)) toast(t('accessSaved'));
  });
}

/* ---------- PINs (on each person's page) ---------- */
function attachAdminPins(slot){
  slot.querySelectorAll('[data-pin-change]').forEach(b=>b.onclick = ()=>openPinChange(b.dataset.pinChange));
}
function openPinChange(account){
  const field = (id, label)=>`<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></div>`;
  showFormModal({
    title: esc(t('pinChangeTitle')(accountLabel(account))),
    bodyHtml: field('pinCurrent', t('pinCurrentLabel')) + field('pinNew', t('pinNewLabel')) + field('pinNewAgain', t('pinRepeatLabel')),
    okLabel: t('save'),
    onSubmit: async ()=>{
      const v = id=>document.getElementById(id).value.trim();
      const currentPin = v('pinCurrent'), newPin = v('pinNew');
      if(![currentPin, newPin].every(x=>/^\d{6}$/.test(x))) return {error:t('pinsInvalidLength')};
      if(newPin !== v('pinNewAgain')) return {error:t('pinMismatch')};
      const r = await api('admin/pin', {method:'PUT', body:{account, currentPin, newPin}});
      if(r.ok){
        toast(account === 'rozha' ? t('pinChangedSelf') : t('pinChangedOther')(accountLabel(account)));
        refreshDevices();
        return {};
      }
      const code = r.data && r.data.error;
      return {error: code === 'wrong_pin' ? t('pinCurrentWrong') : code === 'weak_pin' ? t('pinsWeak') : code === 'duplicate_pin' ? t('pinsDuplicate') : r.status === 429 ? t('tooManyAttempts') : t('saveFailed')};
    }
  });
}

/* ---------- Devices ---------- */
/* Which devices are signed in right now, to which account, what they are, when each was last seen,
   which version it runs, when its sign-in ends and where it last signed in from. A sign-in
   lasts 30 days from the last use; the server sends when each one ends (sessionEnds). */
const SESSION_MS = 30*24*60*60*1000;
function isLoggedIn(d){
  if(commandIsPending(d) && d.command.type === 'logout') return false;
  if(d.sessionEnds) return !!d.loggedIn && Date.parse(d.sessionEnds) > Date.now();
  const seen = Date.parse(d.lastSeen || d.lastLogin || 0) || 0;
  return !!d.loggedIn && Date.now() - seen < SESSION_MS;
}
function deviceStatus(d){
  if(!isLoggedIn(d)) return 'out';
  const seen = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
  return (Date.now() - seen <= ACTIVE_WINDOW_MS) ? 'active' : 'idle';
}
/* The newest version any phone runs (this one included). */
function latestVersion(){
  return (state.devices || []).map(d=>d.appVersion).filter(Boolean).reduce((m, v)=>versionCmp(v, m) > 0 ? v : m, APP_VERSION);
}
const devDay = iso=>formatIraqDateTime(iso, {day:'numeric', month:'short'});
/* Where the device was when it last signed in: city and country (or the address when no place is
   known) and when, with a plain red note when it looks like a VPN (see supabase/functions/api/geo.ts). */
function devPlace(c){
  if(!c) return '';
  try{ return new Intl.DisplayNames([state.lang === 'ku' ? 'ckb' : state.lang, 'en'], {type:'region'}).of(c) || c; }catch(_){ return c; }
}
function devSignInLine(d){
  const si = d.signin;
  if(!si || !si.at) return '';
  const country = si.country ? devPlace(si.country) : '';
  const place = [si.city, country].filter(Boolean).join(', ') || si.ip;
  if(!place) return '';
  const when = formatIraqDateTime(si.at, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  const vpn = si.vpn === true ? (si.vpnReason === 'org' && si.org ? t('devVpnOrg')(si.org.replace(/^AS\d+\s+/, '')) : t('devVpnTz')(si.deviceTz || '', country || si.ipTz || '')) : '';
  return `<span dir="auto">${esc(t('devSignedInFrom')(place, when))}</span>${si.ip && place !== si.ip ? `<span class="dev-faint" dir="ltr">${esc(si.ip)}</span>` : ''}${vpn ? `<span class="dev-vpn" dir="auto">${esc(vpn)}</span>` : ''}`;
}
function renderAdminDevices(){
  const visible = state.devices.filter(isLoggedIn);
  const rank = {active:0, idle:1, out:2};
  const sorted = [...visible].sort((a,b)=>rank[deviceStatus(a)] - rank[deviceStatus(b)] || new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0));
  const activeCount = visible.filter(d=>deviceStatus(d)==='active').length;
  const latest = latestVersion();
  const others = otherDevices().filter(isLoggedIn);
  const cards = sorted.map(d=>{
    const st = deviceStatus(d), isThis = d.id === state.deviceId, parts = deviceParts(d);
    const badge = ({active:t('statusActive'), idle:t('statusLoggedIn'), out:t('statusLoggedOut')})[st];
    const current = d.appVersion && versionCmp(d.appVersion, latest) >= 0;
    const facts = [
      d.lastSeen ? esc(t('devSeen')(timeAgo(d.lastSeen))) : '',
      d.appVersion ? `<bdi dir="ltr">${esc(d.appVersion)}</bdi> <span class="dev-ver ${current ? 'ok' : 'old'}">${esc(t(current ? 'versionCurrent' : 'versionOld'))}</span>` : esc(t('versionUnknown')),
      d.sessionEnds ? esc(t(Date.parse(d.sessionEnds) > Date.now() ? 'devSignedInUntil' : 'devSignInEnded')(devDay(d.sessionEnds))) : '',
      esc(t(d.push ? 'devNotifOn' : 'devNotifOff')),
    ].filter(Boolean).map(f=>`<span>${f}</span>`).join('');
    return `<div class="dev-card">
      <div class="dev-head">
        <span class="dev-ic">${/PC|Mac|Chromebook/.test(parts.kind) ? ICON_COMPUTER : ICON_MOBILE}</span>
        <div class="dev-id">
          <div class="dev-title" dir="auto">${esc(parts.kind)}${parts.how ? `<span class="dev-how">${esc(parts.how)}</span>` : ''}</div>
          <div class="dev-who">${accountLabel(d.account) ? esc(accountLabel(d.account)) : esc(t('unnamedDevice'))}${isThis ? ` <span class="dev-this">· ${esc(t('thisDevice'))}</span>` : ''} <span class="dev-faint">· ${esc(t('lastLoginLabel'))} ${esc(timeAgo(d.lastLogin))}</span></div>
        </div>
        <span class="dev-badge dev-${st}">${badge}</span>
      </div>
      <div class="dev-facts">${facts}</div>
      <div class="dev-foot">
        <div class="dev-loc">${devSignInLine(d)}</div>
        ${isThis ? '' : `<div class="dev-actions">
          <button class="btn btn-ghost" data-devrefresh="${esc(d.id)}">${ICON_REFRESH}<span>${t('refreshDevice')}</span></button>
          ${isLoggedIn(d) ? `<button class="btn btn-danger" data-devlogout="${esc(d.id)}">${t('logoutDevice')}</button>` : ''}
        </div>`}
      </div>
      ${commandIsPending(d) ? `<div class="dev-pending">${d.command.type==='logout'?t('cmdLogoutPending'):t('cmdRefreshPending')} · ${timeAgo(d.command.ts)}</div>` : ''}
    </div>`;
  }).join('');
  return `${adminHeading()}
    <div class="ad-stats dev-stats"><div><b>${visible.length}</b><span>${esc(t('devicesLoggedInEyebrow'))}</span></div><div><b>${activeCount}</b><span>${esc(t('adActiveNow'))}</span></div><div><b class="ad-small">${esc(String(latest).replace(/^\d{4}-/, ''))}</b><span>${esc(t('adNewestVersion'))}</span></div></div>
    ${others.length ? `<div class="dev-bulk"><button class="btn btn-ghost" id="devRefreshAllBtn">${ICON_REFRESH}<span>${t('refreshAllDevices')}</span></button><button class="btn btn-danger" id="devLogoutAllBtn">${t('logoutAllOthers')}</button></div>` : ''}
    ${cards || emptyState(t('noDevicesYet'))}<div class="dev-hint">${t('devicesHint')}</div>`;
}
function attachAdminDevices(slot){
  slot.querySelectorAll('[data-devlogout]').forEach(b=>b.onclick=async()=>{
    const d = state.devices.find(x=>x.id===b.dataset.devlogout);
    if(!d) return;
    if(!(await showConfirm(`<b>${esc(deviceTitle(d))}</b><br>${t('confirmLogoutDevice')}`, {okLabel:t('logoutDevice')}))) return;
    await sendDeviceCommand('logout', [d.id]);
  });
  slot.querySelectorAll('[data-devrefresh]').forEach(b=>b.onclick=async()=>{
    const d = state.devices.find(x=>x.id===b.dataset.devrefresh);
    if(!d) return;
    if(!(await showConfirm(`<b>${esc(deviceTitle(d))}</b><br>${t('confirmRefreshDevice')}`, {okLabel:t('refreshDevice'), okClass:'btn-primary'}))) return;
    await sendDeviceCommand('refresh', [d.id]);
  });
  const allRefresh = slot.querySelector('#devRefreshAllBtn');
  if(allRefresh) allRefresh.onclick = async()=>{
    const ids = otherDevices().filter(isLoggedIn).map(d=>d.id);
    if(!ids.length) return;
    if(!(await showConfirm(t('confirmRefreshAll')(ids.length), {okLabel:t('refreshAllDevices'), okClass:'btn-primary'}))) return;
    await sendDeviceCommand('refresh', ids);
  };
  const allLogout = slot.querySelector('#devLogoutAllBtn');
  if(allLogout) allLogout.onclick = async()=>{
    const ids = otherDevices().filter(isLoggedIn).map(d=>d.id);
    if(!ids.length) return;
    if(!(await showConfirm(t('confirmLogoutAll')(ids.length), {okLabel:t('logoutAllOthers')}))) return;
    await sendDeviceCommand('logout', ids);
  };
}

/* ---------- Time in the app ---------- */
/* Counted only while the app is open on the screen. It keeps adding up and is never reset, not even
   when someone signs out. Daily, Weekly or Monthly: each person's time in that period and the average
   per day (over the days counted so far, so a new week or month is not averaged over days that have
   not happened), and a chart of the last 14 days, 8 weeks or 6 months. */
const TIME_PERIODS = ['day','week','month'];
const dayNumber = iso=>Math.floor(Date.parse(String(iso).slice(0,10) + 'T00:00:00Z') / DAY_MS);
function timeAverage(p, period, today){
  if(!p.since) return 0;
  const first = dayNumber(p.since), now = dayNumber(today);
  const start = period === 'day' ? Math.max(first, now - 29) : period === 'week' ? Math.max(first, now - 6) : Math.max(first, dayNumber(today.slice(0,8) + '01'));
  const total = Number(period === 'day' ? p.last30 : p[period]) || 0;
  return total / Math.max(1, now - start + 1);
}
function renderAdminTime(){
  const u = adminValue('usage');
  if(!u) return `${adminHeading()}${adminData.failed.usage ? `<div class="ad-empty"><p>${esc(t('loadFailed'))}</p></div>` : loadingLines()}`;
  const period = TIME_PERIODS.includes(adminFilter.time) ? adminFilter.time : 'day';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(u.today)) ? u.today : new Date().toISOString().slice(0,10);
  const people = ['rozha','yunis'].map(a=>(u.people || []).find(p=>p.account === a) || {account:a, today:0, week:0, month:0, last30:0, total:0});
  const at = iso=>new Date(String(iso).slice(0,10) + 'T09:00:00Z');
  const series = period === 'day' ? (u.days || []).slice(-14).map(d=>({...d, label:formatIraqDateTime(at(d.day), {weekday:'narrow'}), title:formatIraqDateTime(at(d.day), {weekday:'long', day:'numeric', month:'short'})}))
    : period === 'week' ? (u.weeks || []).slice(-8).map(w=>({...w, label:formatIraqDateTime(at(w.start), {day:'numeric', month:'numeric'}), title:`${formatIraqDateTime(at(w.start), {day:'numeric', month:'short'})} – ${formatIraqDateTime(new Date(at(w.start).getTime() + 6 * DAY_MS), {day:'numeric', month:'short'})}`}))
    : (u.months || []).slice(-6).map(m=>({...m, label:formatIraqDateTime(at(m.month + '-15'), {month:'short'}), title:formatIraqDateTime(at(m.month + '-15'), {month:'long', year:'numeric'})}));
  const max = Math.max(1, ...series.map(d=>Math.max(Number(d.rozha) || 0, Number(d.yunis) || 0)));
  const bars = series.map(d=>`<div class="ad-bar" title="${esc(d.title)} · ${esc(accountLabel('rozha'))} ${esc(fmtDuration(d.rozha))} · ${esc(accountLabel('yunis'))} ${esc(fmtDuration(d.yunis))}"><div class="ad-bar-pair"><i class="r" style="--h:${Math.round((Number(d.rozha) || 0) / max * 100)}%"></i><i class="y" style="--h:${Math.round((Number(d.yunis) || 0) / max * 100)}%"></i></div><small>${esc(d.label)}</small></div>`).join('');
  const value = p=>Number(period === 'day' ? p.today : p[period]) || 0;
  const person = p=>`<section class="ad-card ad-time">
    <div class="ad-card-head">${whoBadge(p.account)}</div>
    <div class="ad-stats inner two"><div><b>${esc(fmtDuration(value(p)))}</b><span>${esc(t('adTimeIn_' + period))}</span></div><div><b>${esc(fmtDuration(timeAverage(p, period, today)))}</b><span>${esc(t('adTimeAvg_' + period))}</span></div></div>
    <p class="ad-time-total">${esc(t('adAllTime'))} ${esc(fmtDuration(p.total))}${p.since ? ` · ${esc(t('adSince')(formatIraqDateTime(at(p.since), {day:'numeric', month:'short'})))}` : ''}</p>
  </section>`;
  const devices = (u.devices || []).map(d=>`<div class="ad-event">${adminTile(/PC|Mac|Chromebook/.test(String(d.label)) ? ICON_COMPUTER : ICON_MOBILE, 'gray')}<div><b>${esc(adminDeviceLine(d.label))}</b><span>${esc(accountLabel(d.account))} · ${esc(t('adLastActive')(timeAgo(d.lastAt)))}</span></div><div class="ad-event-value"><b>${esc(fmtDuration(d.total))}</b><span>${esc(t('adToday')(fmtDuration(d.today)))}</span></div></div>`).join('');
  return `${adminHeading()}
    <div class="ad-toolbar"><div class="pill-seg" role="tablist" aria-label="${esc(t('adminPage_time'))}">${TIME_PERIODS.map(v=>`<button type="button" role="tab" class="pill-seg-btn" data-time-period="${v}" aria-selected="${period === v}">${esc(t('adPeriod_' + v))}</button>`).join('')}</div></div>
    ${people.map(person).join('')}
    ${series.length ? `<section class="ad-card"><div class="ad-chart-head"><b>${esc(t('adChart_' + period))}</b><span class="ad-legend"><i class="r"></i>${esc(accountLabel('rozha'))}<i class="y"></i>${esc(accountLabel('yunis'))}</span></div><div class="ad-bars" dir="ltr">${bars}</div></section>` : ''}
    <div class="section-title">${esc(t('adByDevice'))}</div>
    <div class="ad-group ad-events">${devices || `<div class="ad-empty"><p>${esc(t('adNoTimeYet'))}</p></div>`}</div>
    <p class="ad-foot">${esc(t('adTimeFoot'))}</p>`;
}
function attachAdminTime(slot){
  slot.querySelectorAll('[data-time-period]').forEach(b=>b.onclick = ()=>{ adminFilter.time = b.dataset.timePeriod; paintAdmin(); });
}

/* ---------- Rico ---------- */
/* A token count, exact with its digits grouped, or short (463K) where there is little room. */
function fmtTokens(n, short = false){
  return new Intl.NumberFormat('en-US', short ? {notation:'compact', maximumFractionDigits:1} : {}).format(Math.max(0, Math.round(Number(n) || 0)));
}
function renderAdminRico(){
  const r = adminValue('rico');
  const kinds = r?.kinds || {}, chats = Number(kinds.chat || 0);
  const total = chats;
  const people = r?.people || {}, ro = Number(people.rozha || 0), yu = Number(people.yunis || 0), both = Math.max(1, ro + yu);
  const days = (r?.days || []).slice(-14), max = Math.max(1, ...days.map(d=>Number(d.calls) || 0));
  const hourPct = r ? Math.min(100, Math.round((r.thisHour || 0) / (r.hourLimit || 400) * 100)) : 0;
  const tokens = {input:Number(r?.tokens?.input) || 0, output:Number(r?.tokens?.output) || 0};
  return `${adminHeading()}
    <section class="ad-card ad-rico-about">
      <div class="ad-card-head">${adminTile(ICON_SPARKLE, 'green')}<div class="ad-card-title"><b>${esc(t('ricoName'))}</b></div></div>
      <p>${esc(t('ricoAbout'))}</p>
      <p class="ad-small-print">${esc(t('ricoAboutPrivacy'))}</p>
    </section>
    ${renderAdminAi()}
    <div class="section-title">${esc(t('adThisMonthLabel'))}</div>
    ${r ? `<div class="ad-stats"><div><b>${chats}</b><span>${esc(t('adRicoChats'))}</span></div><div><b>${esc(fmtTokens(tokens.input + tokens.output, true))}</b><span>${esc(t('adRicoTokens'))}</span></div></div>
    <section class="ad-card">
      <div class="ad-chart-head"><b>${esc(t('adRicoWho'))}</b></div>
      <div class="report-who"><i class="r" style="--w:${Math.round(ro / both * 100)}%"></i><i class="y" style="--w:${Math.round(yu / both * 100)}%"></i></div>
      <div class="report-who-names"><span>${esc(accountLabel('rozha'))} ${ro}</span><span>${esc(accountLabel('yunis'))} ${yu}</span></div>
      <div class="ad-chart-head ad-gap"><b>${esc(t('adRicoTokens'))}</b><span>${esc(t('adTokensInOut')(fmtTokens(tokens.input), fmtTokens(tokens.output)))}</span></div>
      <div class="ad-chart-head ad-gap"><b>${esc(t('adRicoHour'))}</b><span>${esc(t('adRicoHourValue')(r.thisHour || 0, r.hourLimit || 400))}</span></div>
      <div class="ad-meter"><i style="--w:${hourPct}%"></i></div>
      ${days.length ? `<div class="ad-chart-head ad-gap"><b>${esc(t('adLast14'))}</b><span>${esc(t('adRicoTotal')(total))}</span></div><div class="ad-bars single" dir="ltr">${days.map(d=>`<div class="ad-bar" title="${esc(formatIraqDateTime(new Date(d.day + 'T09:00:00Z'), {weekday:'long', day:'numeric', month:'short'}))} · ${Number(d.calls) || 0}"><div class="ad-bar-pair"><i class="r" style="--h:${Math.round((Number(d.calls) || 0) / max * 100)}%"></i></div><small>${esc(formatIraqDateTime(new Date(d.day + 'T09:00:00Z'), {weekday:'narrow'}))}</small></div>`).join('')}</div>` : ''}
    </section>
    <p class="ad-foot">${esc(t('adRicoFoot'))}</p>` : (adminData.failed.rico ? `<div class="ad-empty"><p>${esc(t('loadFailed'))}</p></div>` : loadingLines())}`;
}
/* Rico's AIs: Claude Haiku answers first, Google Gemini and Groq take over when it can't. For each: a switch
   (one that is off is skipped), whether it is connected, how it answered last, this month's replies and
   tokens, and that the backups are on free plans. The keys never reach the app: they are on the server only. */
const AI_BRAINS = {anthropic:{name:'Claude Haiku 5.5', role:'aiRoleMain'}, gemini:{name:'Google Gemini', role:'aiRoleBackup1'}, groq:{name:'Groq', role:'aiRoleBackup2'}};
function renderAdminAi(){
  const a = adminValue('ai');
  if(!a) return `<div class="section-title">${esc(t('aiBrainsTitle'))}</div>${adminData.failed.ai ? `<div class="ad-empty"><p>${esc(t('loadFailed'))}</p></div>` : loadingLines(3)}`;
  const tone = st=>st === 'working' ? 'good' : st === 'busy' ? 'warn' : st ? 'bad' : 'idle';
  const row = b=>{
    const info = AI_BRAINS[b.id] || {name:b.id, role:''};
    const status = !b.connected ? t('aiNotConnected') : b.state ? t('aiState_' + b.state) : t('aiNotUsedYet');
    return `<div class="ad-ai">
      <div class="ad-ai-head"><div class="ad-card-title"><b>${esc(info.name)}</b><span>${esc(t(info.role))}</span></div>
        <label class="check-row ad-ai-switch"><span class="sr-only">${esc(t('aiUse')(info.name))}</span><input type="checkbox" data-ai-switch="${esc(b.id)}" ${b.enabled !== false ? 'checked' : ''}></label></div>
      <span class="ad-ai-state ${b.enabled === false ? 'idle' : b.connected ? tone(b.state) : 'idle'}"><i aria-hidden="true"></i>${esc(b.enabled === false ? t('aiSwitchedOff') : status)}${b.enabled !== false && b.connected && b.at ? ` · ${esc(timeAgo(b.at))}` : ''}</span>
      <div class="ad-ai-numbers"><span>${esc(t('aiReplies')(b.calls))}</span><span>${esc(t('adTokensInOut')(fmtTokens(b.input), fmtTokens(b.output)))}</span>${b.id !== 'anthropic' ? `<span class="ad-ai-bill">${esc(t('aiFreePlan'))}</span>` : ''}</div></div>`;
  };
  return `<div class="section-title">${esc(t('aiBrainsTitle'))}</div>
    <section class="ad-card ad-ai-list">${a.brains.map(row).join('')}</section>
    <p class="ad-foot">${esc(t('aiBrainsFoot'))}</p>`;
}

/* ---------- Catalog check-up ---------- */
const DAY_MS = 86400000;
function catalogCheckup(){
  const unitIds = new Set(state.units.map(u=>u.id)), supplierIds = new Set(state.suppliers.map(s=>s.id));
  const old = Date.now() - 30 * DAY_MS;
  const quiet = i=>i.available !== false && (i.lastOrderedAt ? Date.parse(i.lastOrderedAt) < old : (i.createdAt ? Date.parse(i.createdAt) < old : false));
  return [
    {key:'noSupplier', items:state.items.filter(i=>!i.supplierId || !supplierIds.has(i.supplierId))},
    {key:'noUnit', items:state.items.filter(i=>!i.unit || !unitIds.has(i.unit))},
    {key:'unavailable', items:state.items.filter(i=>i.available === false)},
    {key:'quiet', items:state.items.filter(quiet)},
  ];
}
function renderAdminCatalog(){
  const groups = catalogCheckup();
  const body = groups.map(g=>`<details class="ad-card ad-check"${g.items.length && g.items.length <= 12 ? ' open' : ''}>
      <summary><span class="ad-check-count${g.items.length ? '' : ' none'}">${g.items.length}</span><span class="ad-card-title"><b>${esc(t('check_' + g.key))}</b><span>${esc(t('check_' + g.key + 'Hint'))}</span></span><i class="sheet-chevron" aria-hidden="true"></i></summary>
      ${g.items.length ? `<div class="ad-check-list">${sortedByName(g.items).map(i=>`<button type="button" class="ad-check-row" data-check-item="${esc(i.id)}"><span dir="auto">${esc(i.name)}</span><small>${esc([unitLabel(i.unit) || t('noUnit'), i.supplierId ? supplierName(i.supplierId) : t('noSupplier'), g.key === 'quiet' ? (i.lastOrderedAt ? t('adLastOrdered')(timeAgo(i.lastOrderedAt)) : t('adNeverOrdered')) : ''].filter(Boolean).join(' · '))}</small></button>`).join('')}</div>` : `<p class="ad-check-none">${esc(t('adNothingHere'))}</p>`}
    </details>`).join('');
  return `${adminHeading()}${body}<p class="ad-foot">${esc(t('checkFoot'))}</p>`;
}
function attachAdminCatalog(slot){
  slot.querySelectorAll('[data-check-item]').forEach(b=>b.onclick = ()=>openItemModal(b.dataset.checkItem));
}

/* Admin, Restore: the server keeps a copy of the kitchen's data for 7 days. Restoring brings back what was
   deleted since that day; it never changes what exists now. Her PIN is asked first. */
function renderAdminRestore(){
  const rows = adminValue('backups');
  return `${adminHeading()}<p class="notif-sub">${esc(t('restoreHint'))}</p>
    ${Array.isArray(rows) ? (rows.length ? `<div class="form-card restore-list">${rows.map(r=>`<div class="restore-row"><div><b>${esc(formatIraqDateTime(r.day + 'T12:00:00Z', {weekday:'long', day:'numeric', month:'long'}))}</b><small>${esc(t('restoreCounts')(r.orders, r.items, r.suppliers))}</small></div><button type="button" class="btn btn-ghost" data-restore-day="${esc(r.day)}">${esc(t('restoreBtn'))}</button></div>`).join('')}</div>` : `<div class="empty-mini">${esc(t('restoreNone'))}</div>`) : `<div class="empty-mini">${esc(t('checking'))}</div>`}`;
}
function attachAdminRestore(){
  document.querySelectorAll('[data-restore-day]').forEach(b=>b.onclick = ()=>{
    const day = b.dataset.restoreDay;
    showFormModal({
      title:esc(t('restoreBtn')),
      bodyHtml:`<p class="modal-msg">${esc(t('restoreConfirm'))}</p><div class="field"><label for="restorePin">${esc(t('restorePin'))}</label><input id="restorePin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div>`,
      okLabel:t('restoreBtn'),
      onSubmit:async ()=>{
        const r = await api('admin/backups/restore', {method:'POST', body:{day, pin:document.getElementById('restorePin').value}});
        if(!r.ok) return {error:t(r.data?.error === 'wrong_pin' ? 'wrongPin' : 'saveFailed')};
        await loadData(); render();
        toast(t('restoreDone')(r.data.orders, r.data.items, r.data.suppliers), 'ok');
        return {};
      },
    });
  });
}

/* Admin > Rico: switching an AI off or on. Rico skips one that is off from his next reply. */
function attachAdminAiSwitches(root){
  root.querySelectorAll('[data-ai-switch]').forEach(box=>box.onchange = async ()=>{
    box.disabled = true;
    const r = await api('admin/ai/' + box.dataset.aiSwitch, {method:'PUT', body:{enabled:box.checked}});
    box.disabled = false;
    if(!r.ok){ box.checked = !box.checked; toast(t('saveFailed'), 'warn'); return; }
    const a = adminValue('ai'), brain = a?.brains?.find(x=>x.id === box.dataset.aiSwitch);
    if(brain) brain.enabled = box.checked;
    toast(t(box.checked ? 'aiTurnedOn' : 'aiTurnedOff'));
    paintAdmin();
  });
}
