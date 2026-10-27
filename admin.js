/* Ricotta Orders -- Admin (Rozha only).
   A dashboard that fits on one screen (phone and computer): a status line, then a tile for each page
   with the number that matters. A tile opens its page, which slides in like a page on iPhone and has
   Admin's back button at the top:
     Problems          errors any phone ran into, and what people reported from Settings
     Security          wrong PINs, the sign-in lock (with Unlock), new phones and the sign-in log
     Health Check      the server, the database and the scheduled jobs, in plain words
     Yunis's Access    which screens Yunis can open and what he can do (the server checks it too)
     PINs              a new PIN for Rozha or Yunis
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

const ADMIN_PAGES = ['problems','security','health','access','pins','devices','time','rico','catalog'];
const ADMIN_SOURCES = {health:'admin/diagnostics', security:'admin/security', problems:'admin/problems', usage:'admin/usage', rico:'admin/rico', ai:'admin/ai', roles:'admin/roles'};
/* What each page needs (the list itself shows a value from most of them). */
const ADMIN_NEEDS = {home:['health','security','problems','usage','rico','roles'], problems:['problems'], security:['security'], health:['health','problems','security'],
  access:['roles'], pins:[], devices:[], time:['usage'], rico:['rico','ai'], catalog:[]};
let adminData = {account:null, busy:{}, failed:{}};
let adminFilter = {problems:'open', security:'all', time:'day'};
let adminListTop = 0;
function resetAdmin(){ adminData = {account:null, busy:{}, failed:{}}; adminFilter = {problems:'open', security:'all', time:'day'}; adminListTop = 0; }
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
const ADMIN_SHAPES = {problems:Array.isArray, health:isAdminObject, rico:isAdminObject, ai:d=>isAdminObject(d) && Array.isArray(d.brains),
  security:d=>isAdminObject(d) && Array.isArray(d.events), usage:d=>isAdminObject(d) && Array.isArray(d.people),
  roles:d=>isAdminObject(d) && Array.isArray(d.yunis) && Array.isArray(d.roles)};
const adminValue = key=>adminData.account === state.account ? adminData[key]?.data : null;

/* ---------- The Admin screen ---------- */
function renderAdmin(){
  if(!isRozha()) return '';
  // Ricotta's map card sits under the list, outside the part redrawn when new numbers arrive, so its
  // picture and pin never restart.
  return `<div class="admin-page"><div id="adminSlot">${renderAdminBody()}</div>${state.adminPage ? '' : adminPlaceCard()}</div>`;
}
function renderAdminBody(){
  const page = ADMIN_PAGES.includes(state.adminPage) ? state.adminPage : null;
  if(!page) return renderAdminHome();
  return ({problems:renderAdminProblems, security:renderAdminSecurity, health:renderAdminHealth, access:renderAdminAccess, pins:renderAdminPins,
    devices:renderAdminDevices, time:renderAdminTime, rico:renderAdminRico, catalog:renderAdminCatalog})[page]();
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
  slot.querySelectorAll('[data-admin-refresh]').forEach(b=>b.onclick = ()=>spinRefresh(b, async()=>{
    const keys = ADMIN_NEEDS[state.adminPage || 'home'];
    if(state.adminPage === 'devices') await refreshDevices();
    await Promise.all(keys.map(k=>adminFetch(k, true)));
  }));
  ({problems:attachAdminProblems, security:attachAdminSecurity, health:attachAdminHealth, access:attachAdminAccess, pins:attachAdminPins,
    devices:attachAdminDevices, catalog:attachAdminCatalog, time:attachAdminTime, rico:slot=>{ loadRicoStatus(); attachAdminAi(slot); }})[state.adminPage]?.(slot);
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
  const refresh = ['pins','catalog','health'].includes(state.adminPage) ? '' : adminRefresh();
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
/* Everything that needs Rozha's attention right now, for the summary at the top. */
function adminIssues(){
  const out = [];
  const problems = (adminValue('problems') || []).filter(p=>!p.resolvedAt);
  if(problems.length) out.push({page:'problems', text:t('adIssueProblems')(new Set(problems.map(p=>p.fingerprint)).size)});
  const sec = adminValue('security');
  if(sec?.lockedUntil && Date.parse(sec.lockedUntil) > Date.now()) out.push({page:'security', text:t('adIssueLocked')});
  const bad = healthRows().filter(r=>r.tone === 'bad').length;
  if(bad) out.push({page:'health', text:t('adIssueHealth')(bad)});
  return out;
}
/* The dashboard: a short status line, then one tile per page with its number that matters, sized so
   the whole board fits on one screen (two columns on a phone, three on a computer). A tile that needs
   attention is tinted red. */
function renderAdminHome(){
  const loading = ['health','problems','security'].some(k=>adminData.busy[k] && !adminValue(k));
  const issues = adminIssues();
  const health = adminValue('health');
  const problems = (adminValue('problems') || []).filter(p=>!p.resolvedAt);
  const openProblems = new Set(problems.map(p=>p.fingerprint)).size;
  const recent = problems.filter(p=>Date.now() - Date.parse(p.lastAt) < 86400000).length;
  const sec = adminValue('security'), locked = !!(sec?.lockedUntil && Date.parse(sec.lockedUntil) > Date.now());
  const rows = healthRows(), bad = rows.filter(r=>r.tone === 'bad').length, warn = rows.filter(r=>r.tone === 'warn').length;
  const roles = adminValue('roles');
  const usage = adminValue('usage'), people = ['rozha','yunis'].map(a=>(usage?.people || []).find(p=>p.account === a) || {account:a, today:0});
  const today = people.reduce((n, p)=>n + Number(p.today || 0), 0);
  const rico = adminValue('rico'), ricoMonth = rico ? Object.values(rico.kinds || {}).reduce((n, k)=>n + Number(k || 0), 0) : null;
  const signedIn = state.devices.filter(isLoggedIn), active = signedIn.filter(d=>deviceStatus(d) === 'active').length;
  const toReview = catalogCheckup().reduce((n, g)=>n + g.items.length, 0);
  const wait = '·';
  const tile = (page, icon, tone, value, sub, alert)=>`<button type="button" class="ad-tile-card${alert ? ' alert' : ''}${page === 'pins' ? ' slim' : ''}" data-admin-open="${page}">
      <span class="ad-tile-top">${adminTile(icon, alert ? 'red' : tone)}<span class="ad-tile-name">${esc(t('adminPage_' + page))}</span></span>
      <b class="ad-tile-value" dir="auto">${esc(value)}</b><span class="ad-tile-sub" dir="auto">${esc(sub)}</span></button>`;
  const status = `<section class="ad-strip ${issues.length ? 'attention' : loading ? 'checking' : 'ok'}" aria-live="polite">
      <span class="ad-strip-mark" aria-hidden="true">${issues.length ? '!' : ICON_CHECK}</span>
      <span class="ad-strip-text"><b>${esc(loading && !issues.length ? t('checking') : issues.length ? t('adAttention')(issues.length) : t('adAllGood'))}</b>
        <span>${esc(issues.length ? issues.map(i=>i.text).join(' · ') : health?.checkedAt ? t('checkedAt')(timeAgo(health.checkedAt)) : t('adSummaryHint'))}</span></span>
      ${adminRefresh()}</section>`;
  return status + `<div class="ad-board">
    ${tile('problems', ADMIN_ICONS.problems, 'gray', adminValue('problems') ? (openProblems ? String(openProblems) : t('adNone')) : wait, adminValue('problems') ? (openProblems ? t('adProblemsSub')(recent) : t('adProblemsClear')) : t('loading'), openProblems > 0)}
    ${tile('security', ADMIN_ICONS.security, 'green', sec ? (locked ? t('adLocked') : t('adSigninOpenShort')) : wait, sec ? t('adWrongPins')(Number(sec.wrongPins24h) || 0) : t('loading'), locked)}
    ${tile('health', ADMIN_ICONS.health, 'green', health ? (bad ? t('adNeedsLook') : t('adWorking')) : adminData.failed.health ? t('adNeedsLook') : wait, health ? (bad || warn ? t('hcWarnShort')(bad + warn) : t('checkedAt')(timeAgo(health.checkedAt))) : t('loading'), bad > 0 || (!health && adminData.failed.health))}
    ${tile('time', ADMIN_ICONS.time, 'green', usage ? fmtDuration(today) : wait, usage ? people.map(p=>`${accountLabel(p.account)} ${fmtDuration(p.today)}`).join(' · ') : t('loading'))}
    ${tile('rico', ICON_SPARKLE, 'green', ricoMonth === null ? wait : String(ricoMonth), rico ? t('adRicoSub')(t('adTokens')(fmtTokens(ricoTokenTotal(rico), true))) : t('loading'))}
    ${tile('devices', ADMIN_ICONS.devices, 'gray', String(signedIn.length), t('adDevicesSub')(active))}
    ${tile('access', ADMIN_ICONS.access, 'green', roles ? t('adOfTotal')(roles.yunis.length, roles.roles.length) : wait, t('adAccessSub'))}
    ${tile('catalog', ADMIN_ICONS.catalog, 'gray', toReview ? String(toReview) : t('adNone'), toReview ? t('adCatalogSub') : t('adCatalogClear'))}
    ${tile('pins', ADMIN_ICONS.pins, 'gray', t('adminPinChange'), `${accountLabel('rozha')} · ${accountLabel('yunis')}`)}
  </div>`;
}
/* Ricotta on the map in the picture's own colours, with Directions to the kitchen in Apple Maps. */
function adminPlaceCard(){
  return `<section class="ad-place" aria-label="${esc(t('ricottaName'))}">
    <div class="ad-place-map rmap" role="img" aria-label="${esc(t('mapStill'))}">${ricottaMapWorld({green:false})}<div class="ad-place-shade"></div>${mapCredit()}</div>
    <div class="ad-place-foot"><div class="ad-place-name"><b>${esc(t('ricottaName'))}</b><span>${esc(t('ricottaCity'))}</span></div>${mapDirections('ad-place-go')}</div>
  </section>`;
}
const ADMIN_ICONS = {
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
    const rows = g.rows.map(r=>`<li>${whoBadge(r.account)}<span class="ad-dev">${esc(adminDeviceLine(r.label))}</span>${r.version ? `<span class="dev-ver ${versionCmp(r.version, latest) >= 0 ? 'ok' : 'old'}">${esc(r.version)}</span>` : ''}<b>${esc(t('adTimes')(r.count))}</b></li>`).join('');
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
  const empty = adminValue('problems') ? `<div class="ad-empty">${adminTile(ICON_CHECK, 'green')}<b>${esc(t(adminFilter.problems === 'fixed' ? 'adNoFixed' : 'adNoProblems'))}</b><p>${esc(t('adProblemsHint'))}</p></div>` : `<div class="ad-empty"><p>${esc(adminData.failed.problems ? t('loadFailed') : t('loading'))}</p></div>`;
  return `${adminHeading()}
    <div class="ad-toolbar"><div class="pill-seg" role="tablist" aria-label="${esc(t('adminPage_problems'))}">${[['open', t('adOpen')(new Set(open.map(p=>p.fingerprint)).size)], ['fixed', t('adFixed')]].map(([v, l])=>`<button type="button" role="tab" class="pill-seg-btn" data-problem-filter="${v}" aria-selected="${adminFilter.problems === v}">${esc(l)}</button>`).join('')}</div></div>
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
  if(!sec) return `${adminHeading()}<div class="ad-empty"><p>${esc(adminData.failed.security ? t('loadFailed') : t('loading'))}</p></div>`;
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
/* Rozha's health check in plain words: each row says what it is, how it is, and what to do when it isn't
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
    <section class="ad-status ${bad ? 'bad' : warn ? 'warn' : 'good'}">${adminTile(bad || warn ? '!' : ICON_CHECK, bad ? 'red' : warn ? 'gray' : 'green')}
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
const ACCESS_SCREENS = [['history', NAV_ICONS.history], ['manage', NAV_ICONS.manage], ['record', NAV_ICONS.record], ['transfers', NAV_ICONS.transfers], ['assistant', ICON_SPARKLE]];
const ACCESS_ACTIONS = ['catalog', 'send', 'exports', 'notify', 'reminders'];
function renderAdminAccess(){
  const r = adminValue('roles');
  if(!r) return `${adminHeading()}<div class="ad-empty"><p>${esc(adminData.failed.roles ? t('loadFailed') : t('loading'))}</p></div>`;
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
    if(await save(ALL_ROLES.filter(r=>r !== 'transfers'))) toast(t('accessSaved'));
  });
}

/* ---------- PINs ---------- */
function renderAdminPins(){
  const row = a=>`<div class="admin-pin-row">${whoBadge(a)}<span class="admin-pin-dots" aria-hidden="true">••••••</span><button type="button" class="btn btn-ghost" data-pin-change="${a}" aria-label="${esc(t('pinChangeTitle')(accountLabel(a)))}">${ICON_KEY} ${esc(t('adminPinChange'))}</button></div>`;
  return `${adminHeading()}<div class="form-card admin-pins">${row('rozha')}${row('yunis')}<div class="notif-sub">${esc(t('adminPinsHint'))}</div></div>`;
}
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
/* Which phones are signed in right now, to which account, when each one last signed in and was last
   seen, and which version it runs. Logged in = signed in, no log-out waiting for it, and seen within
   one session length (a sign-in expires after 18 hours even if nobody logs out). */
const SESSION_MS = 18*60*60*1000;
function isLoggedIn(d){
  const seen = Date.parse(d.lastSeen || d.lastLogin || 0) || 0;
  return !!d.loggedIn && Date.now() - seen < SESSION_MS && !(commandIsPending(d) && d.command.type === 'logout');
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
    return `<div class="dev-card">
      <div class="dev-top"><div class="dev-name">${accountLabel(d.account) ? whoBadge(d.account) : esc(t('unnamedDevice'))}${isThis ? ` <span class="dev-this">· ${esc(t('thisDevice'))}</span>` : ''}</div><span class="dev-badge dev-${st}">${badge}</span></div>
      <div class="dev-kind">${/PC|Mac|Chromebook/.test(parts.kind) ? ICON_COMPUTER : ICON_MOBILE} <span>${esc(parts.kind)}</span>${parts.how ? `<span class="dev-how">${esc(parts.how)}</span>` : ''}</div>
      <div class="rec-line"><span class="rec-k">${t('lastLoginLabel')}</span> ${fmtDateTime(d.lastLogin)}${d.lastLogin ? ` <span class="dev-ago">(${timeAgo(d.lastLogin)})</span>` : ''}</div>
      ${d.lastSeen ? `<div class="rec-line"><span class="rec-k">${t('lastSeenLabel')}</span> ${timeAgo(d.lastSeen)}</div>` : ''}
      <div class="rec-line"><span class="rec-k">${t('versionLabel')}</span> ${d.appVersion ? `${esc(d.appVersion)} <span class="dev-ver ${versionCmp(d.appVersion, latest) >= 0 ? 'ok' : 'old'}">${esc(t(versionCmp(d.appVersion, latest) >= 0 ? 'versionCurrent' : 'versionOld'))}</span>` : esc(t('versionUnknown'))}</div>
      ${commandIsPending(d) ? `<div class="dev-pending">${d.command.type==='logout'?t('cmdLogoutPending'):t('cmdRefreshPending')} · ${timeAgo(d.command.ts)}</div>` : ''}
      ${isThis ? '' : `<div class="dev-actions">
        <button class="btn btn-ghost" data-devrefresh="${esc(d.id)}">${ICON_REFRESH} ${t('refreshDevice')}</button>
        ${isLoggedIn(d) ? `<button class="btn btn-danger" data-devlogout="${esc(d.id)}">${t('logoutDevice')}</button>` : ''}
      </div>`}
    </div>`;
  }).join('');
  return `${adminHeading()}
    <div class="ad-stats"><div><b>${visible.length}</b><span>${esc(t('devicesLoggedInEyebrow'))}</span></div><div><b>${activeCount}</b><span>${esc(t('adActiveNow'))}</span></div><div><b class="ad-small">${esc(latest)}</b><span>${esc(t('adNewestVersion'))}</span></div></div>
    ${others.length ? `<div class="dev-bulk"><button class="btn btn-ghost" id="devRefreshAllBtn">${ICON_REFRESH} ${t('refreshAllDevices')}</button><button class="btn btn-danger" id="devLogoutAllBtn">${t('logoutAllOthers')}</button></div>` : ''}
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
  if(!u) return `${adminHeading()}<div class="ad-empty"><p>${esc(adminData.failed.usage ? t('loadFailed') : t('loading'))}</p></div>`;
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
const ricoTokenTotal = r=>(Number(r?.tokens?.input) || 0) + (Number(r?.tokens?.output) || 0);
/* A token count, exact with its digits grouped, or short (463K) where there is little room. */
function fmtTokens(n, short = false){
  return new Intl.NumberFormat('en-US', short ? {notation:'compact', maximumFractionDigits:1} : {}).format(Math.max(0, Math.round(Number(n) || 0)));
}
function renderAdminRico(){
  const r = adminValue('rico');
  const kinds = r?.kinds || {}, chats = Number(kinds.chat || 0), voice = Number(kinds.voice || 0), lists = Number(kinds.transfer || 0);
  const total = chats + voice + lists;
  const people = r?.people || {}, ro = Number(people.rozha || 0), yu = Number(people.yunis || 0), both = Math.max(1, ro + yu);
  const days = (r?.days || []).slice(-14), max = Math.max(1, ...days.map(d=>Number(d.calls) || 0));
  const hourPct = r ? Math.min(100, Math.round((r.thisHour || 0) / (r.hourLimit || 400) * 100)) : 0;
  const tokens = {input:Number(r?.tokens?.input) || 0, output:Number(r?.tokens?.output) || 0};
  return `${adminHeading()}
    <section class="ad-card ad-rico-about">
      <div class="ad-card-head">${adminTile(ICON_SPARKLE, 'green')}<div class="ad-card-title"><b>${esc(t('ricoName'))}</b><span id="ricoKeyState" class="rico-connection">${esc(t('ricoChecking'))}</span></div></div>
      <p>${esc(t('ricoAbout'))}</p>
      <p class="ad-small-print">${esc(t('ricoAboutPrivacy'))}</p>
    </section>
    ${renderAdminAi()}
    <div class="section-title">${esc(t('adThisMonthLabel'))}</div>
    ${r ? `<div class="ad-stats"><div><b>${chats}</b><span>${esc(t('adRicoChats'))}</span></div><div><b>${voice}</b><span>${esc(t('adRicoVoice'))}</span></div><div><b>${esc(fmtTokens(tokens.input + tokens.output, true))}</b><span>${esc(t('adRicoTokens'))}</span></div></div>
    <section class="ad-card">
      <div class="ad-chart-head"><b>${esc(t('adRicoWho'))}</b></div>
      <div class="report-who"><i class="r" style="--w:${Math.round(ro / both * 100)}%"></i><i class="y" style="--w:${Math.round(yu / both * 100)}%"></i></div>
      <div class="report-who-names"><span>${esc(accountLabel('rozha'))} ${ro}</span><span>${esc(accountLabel('yunis'))} ${yu}</span></div>
      <div class="ad-chart-head ad-gap"><b>${esc(t('adRicoTokens'))}</b><span>${esc(t('adTokensInOut')(fmtTokens(tokens.input), fmtTokens(tokens.output)))}</span></div>
      <div class="ad-chart-head ad-gap"><b>${esc(t('adRicoHour'))}</b><span>${esc(t('adRicoHourValue')(r.thisHour || 0, r.hourLimit || 400))}</span></div>
      <div class="ad-meter"><i style="--w:${hourPct}%"></i></div>
      ${days.length ? `<div class="ad-chart-head ad-gap"><b>${esc(t('adLast14'))}</b><span>${esc(t('adRicoTotal')(total))}</span></div><div class="ad-bars single" dir="ltr">${days.map(d=>`<div class="ad-bar" title="${esc(formatIraqDateTime(new Date(d.day + 'T09:00:00Z'), {weekday:'long', day:'numeric', month:'short'}))} · ${Number(d.calls) || 0}"><div class="ad-bar-pair"><i class="r" style="--h:${Math.round((Number(d.calls) || 0) / max * 100)}%"></i></div><small>${esc(formatIraqDateTime(new Date(d.day + 'T09:00:00Z'), {weekday:'narrow'}))}</small></div>`).join('')}</div>` : ''}
    </section>
    <p class="ad-foot">${esc(t('adRicoFoot'))}</p>` : `<div class="ad-empty"><p>${esc(adminData.failed.rico ? t('loadFailed') : t('loading'))}</p></div>`}`;
}
/* Rico's AIs: Claude Haiku answers first, Google Gemini and Groq take over when it can't. For each: whether
   it is connected, how it answered last, this month's replies and tokens (as each AI reported them), and
   the bill (Haiku's comes from Anthropic's own cost report once its read-only admin key is connected; the
   backups are on free plans). Keys are typed here, checked with Anthropic, and never shown again. */
const AI_BRAINS = {anthropic:{name:'Claude Haiku 5.5', role:'aiRoleMain'}, gemini:{name:'Google Gemini', role:'aiRoleBackup1'}, groq:{name:'Groq', role:'aiRoleBackup2'}};
function renderAdminAi(){
  const a = adminValue('ai');
  if(!a) return `<div class="section-title">${esc(t('aiBrainsTitle'))}</div><div class="ad-empty"><p>${esc(adminData.failed.ai ? t('loadFailed') : t('loading'))}</p></div>`;
  const tone = st=>st === 'working' ? 'good' : st === 'busy' ? 'warn' : st ? 'bad' : 'idle';
  const row = b=>{
    const info = AI_BRAINS[b.id] || {name:b.id, role:''};
    const status = !b.connected ? t('aiNotConnected') : b.state ? t('aiState_' + b.state) : t('aiNotUsedYet');
    const bill = b.bill?.free ? t('aiFreePlan') : b.bill && typeof b.bill.usd === 'number' ? t('aiSpent')(b.bill.usd > 0 && b.bill.usd < 0.01 ? '<$0.01' : '$' + b.bill.usd.toFixed(2))
      : b.bill?.error === 'no_admin_key' ? t('aiBillNeedsKey') : b.bill?.error === 'admin_key_rejected' ? t('aiBillKeyRejected') : t('aiBillUnavailable');
    const actions = b.id === 'anthropic' ? `<div class="ad-ai-actions">
        <button type="button" class="btn btn-ghost" data-ai-key="anthropic">${esc(b.connected ? t('aiReplaceKey') : t('aiConnect'))}</button>
        ${b.connected ? `<button type="button" class="btn btn-ghost" data-ai-key="anthropic_admin">${esc(a.adminKey ? t('aiReplaceBillKey') : t('aiConnectBill'))}</button>` : ''}
        ${b.connected ? `<button type="button" class="btn btn-ghost danger-text" data-ai-remove="anthropic">${esc(t('aiDisconnect'))}</button>` : ''}
      </div>` : '';
    return `<div class="ad-ai">
      <div class="ad-ai-head"><div class="ad-card-title"><b>${esc(info.name)}</b><span>${esc(t(info.role))}</span></div>
        <span class="ad-ai-state ${b.connected ? tone(b.state) : 'idle'}"><i aria-hidden="true"></i>${esc(status)}${b.connected && b.at ? ` · ${esc(timeAgo(b.at))}` : ''}</span></div>
      <div class="ad-ai-numbers"><span>${esc(t('aiReplies')(b.calls))}</span><span>${esc(t('adTokensInOut')(fmtTokens(b.input), fmtTokens(b.output)))}</span>${b.connected || b.bill?.free ? `<span class="ad-ai-bill">${esc(bill)}</span>` : ''}</div>
      ${actions}</div>`;
  };
  return `<div class="section-title">${esc(t('aiBrainsTitle'))}</div>
    <section class="ad-card ad-ai-list">${a.brains.map(row).join('')}</section>
    <p class="ad-foot">${esc(t('aiBrainsFoot'))}</p>`;
}
function attachAdminAi(slot){
  slot.querySelectorAll('[data-ai-key]').forEach(b=>b.onclick = ()=>withBusy(b, async()=>{
    const kind = b.dataset.aiKey;
    const key = await showPrompt(esc(t(kind === 'anthropic' ? 'aiKeyPrompt' : 'aiBillKeyPrompt')), {placeholder:kind === 'anthropic' ? 'sk-ant-api…' : 'sk-ant-admin…', secret:true, okLabel:t('save'), maxLength:300});
    if(key === null || !key.trim()) return;
    const r = await api('admin/ai/key', {method:'PUT', body:{kind, key:key.trim()}, timeout:20000});
    if(r.ok){ toast(t(kind === 'anthropic' ? 'aiKeySaved' : 'aiBillKeySaved')); adminFetch('ai', true); return; }
    await showAlert(esc(t('aiKeyError_' + (['invalid_key','not_admin','not_organization','check_failed'].includes(r.data?.error) ? r.data.error : 'other'))));
  }));
  slot.querySelectorAll('[data-ai-remove]').forEach(b=>b.onclick = ()=>withBusy(b, async()=>{
    if(!(await showConfirm(esc(t('aiDisconnectConfirm')), {okLabel:t('aiDisconnect'), okClass:'btn-danger'}))) return;
    const r = await api('admin/ai/key', {method:'DELETE', body:{kind:b.dataset.aiRemove}});
    if(r.ok){ adminFetch('ai', true); return; }
    await showAlert(esc(t('saveFailed')));
  }));
}
async function loadRicoStatus(){
  const el = document.getElementById('ricoKeyState');
  if(!el) return;
  const r = await api('assistant/status');
  const now = document.getElementById('ricoKeyState');
  if(!now) return;
  const connected = !!(r.ok && r.data?.configured);
  now.textContent = !r.ok ? t('loadFailed') : connected ? t('ricoConnected') : t('ricoDisconnected');
  now.classList.toggle('connected', connected);
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
