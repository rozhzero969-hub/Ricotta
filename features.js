/* Settings belong to the account: changing them on Yunis's account changes them for Yunis on every
   phone. They are saved on the server (app_accounts.settings) and come back with the start-up data.
   Notifications stay with each phone, since each phone signs up for them itself.
   A setting with no saved choice uses its default here. */
const SETTINGS = [
  {id:'swipe', group:'order', on:true},
  {id:'showLastQty', group:'order', on:false},
  {id:'compactRows', group:'order', on:false},
  {id:'soundQty', group:'sound', on:true},
  {id:'soundSent', group:'sound', on:true},
  {id:'soundRico', group:'sound', on:true, role:'assistant'},
  {id:'soundError', group:'sound', on:true},
  {id:'soundMilestone', group:'sound', on:true},
  {id:'soundUndo', group:'sound', on:true},
  {id:'ricoSheet', group:'ricoTab', on:true, role:'assistant'},             // in Rico's own settings
  {id:'ricoAutoStart', group:'helper', on:false, role:'receipts', rozha:true}, // in Rico the helper
  {id:'tfAuto', group:'none', on:false},
  {id:'recipeAlerts', group:'none', on:true},                              // Ahmad's Settings, Recipes
  {id:'simpleView', group:'look', on:false},
  {id:'tables', group:'look', on:false},
  {id:'kitchenMode', group:'look', on:false},
  {id:'milestones', group:'look', on:true},
];
const CHOICES = {darkMode:['auto', 'on', 'off'], ricoStyle:['normal', 'short', 'warm']};
const SETTING_GROUPS = ['order', 'sound', 'look'];

/* Settings icons, like the iPhone's Settings: a white symbol on a coloured rounded square. Drawn on a
   24 grid, filled where Apple fills them, 2px lines otherwise, centred by eye. Each group has its
   colour family (sounds pink, Rico green and purple, Look blue). */
const SF = (d, fill)=>`<svg viewBox="0 0 24 24" ${fill ? 'fill="#fff" stroke="none"' : 'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${d}</svg>`;
const SETTING_ICONS = {
  notif:['#FF3B30', SF('<path d="M12 3.2a6 6 0 0 0-6 6v3.3l-1.6 2.6A1 1 0 0 0 5.3 16.6h13.4a1 1 0 0 0 .9-1.5L18 12.5V9.2a6 6 0 0 0-6-6Z"/><path d="M9.6 18.2h4.8a2.4 2.4 0 0 1-4.8 0Z"/>', true)],
  swipe:['#34C759', SF('<path d="M6 6.5 11.5 12 6 17.5M12.5 6.5 18 12l-5.5 5.5" stroke-width="2.2"/>')],
  showLastQty:['#FF9500', SF('<path d="M4.6 12.4A7.4 7.4 0 1 0 6.8 6.8"/><path d="M4.4 4.6v3.6H8"/><path d="M12 8.2v4l2.6 1.6"/>')],
  compactRows:['#5856D6', SF('<path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5"/><circle cx="4.9" cy="6.5" r="1.25" fill="#fff" stroke="none"/><circle cx="4.9" cy="12" r="1.25" fill="#fff" stroke="none"/><circle cx="4.9" cy="17.5" r="1.25" fill="#fff" stroke="none"/>')],
  soundQty:['#FF2D55', SF('<path d="M4 9.3h3l4.3-3.6a.5.5 0 0 1 .8.4v11.8a.5.5 0 0 1-.8.4L7 14.7H4a.8.8 0 0 1-.8-.8V10.1a.8.8 0 0 1 .8-.8Z" fill="#fff" stroke="none"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a7.6 7.6 0 0 1 0 10.8"/>')],
  soundSent:['#FF2D55', SF('<path d="M20.6 3.6 3.9 10.2c-.7.3-.6 1.3.1 1.5l6.3 1.9 1.9 6.3c.2.7 1.2.8 1.5.1L20.4 3.4Z"/>', true)],
  soundRico:['#FF2D55', SF('<path d="M12 3.6c-4.8 0-8.6 3.2-8.6 7.2 0 2.2 1.1 4.2 3 5.5l-.7 3.3c-.1.5.4.8.8.6l3.6-2.1c.6.1 1.3.2 1.9.2 4.8 0 8.6-3.2 8.6-7.3S16.8 3.6 12 3.6Z"/>', true)],
  soundError:['#FF2D55', SF('<path d="M10.3 4.2 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.6" stroke="#FF2D55" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.25" fill="#FF2D55"/>', true)],
  soundMilestone:['#FF2D55', SF('<path d="m12 3.3 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.6l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>', true)],
  soundUndo:['#FF2D55', SF('<path d="M8.6 5.4 4.4 9.6l4.2 4.2"/><path d="M4.6 9.6H15a4.6 4.6 0 0 1 0 9.2h-3"/>')],
  ricoSheet:['#1F7A4D', SF('<path d="M12 3.4c.7 4.9 3.7 7.9 8.6 8.6-4.9.7-7.9 3.7-8.6 8.6-.7-4.9-3.7-7.9-8.6-8.6 4.9-.7 7.9-3.7 8.6-8.6Z"/>', true)],
  ricoAutoStart:['#34C759', SF('<path d="M12 3.4v7.4"/><path d="M7.1 6.6a7.2 7.2 0 1 0 9.8 0"/>')],
  ricoMac:['#1F7A4D', SF('<rect x="4" y="5" width="16" height="10.6" rx="1.8"/><path d="M2.6 18.6h18.8"/>')],
  ricoWatch:['#386DD8', SF('<rect x="3.5" y="4.75" width="17" height="11.5" rx="2"/><path d="M8 19.25h8M12 16.25v3M12 13V7.5m-2.5 2.5L12 7.5l2.5 2.5"/>')],
  ricoReceipts:['#FF9500', SF('<path d="M6.4 3.4h11.2v17.2l-2.8-1.8-2.8 1.8-2.8-1.8-2.8 1.8Z"/><path d="M9.2 8.4h5.6M9.2 12h5.6" stroke="#FF9500" stroke-width="1.9"/>', true)],
  tfAuto:['#30B0C7', SF('<path d="M4.4 8.6h13.2l-3.2-3.2M19.6 15.4H6.4l3.2 3.2"/>')],
  ricoStop:['#FF3B30', SF('<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.2"/>', true)],
  limBig:['#34C759', SF('<rect x="3" y="6.4" width="18" height="11.2" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6.2 9.6v4.8M17.8 9.6v4.8"/>')],
  limJump:['#FF9500', SF('<path d="M3.8 16.6 9.4 11l3.4 3.4 7.4-7.4"/><path d="M15 7h5.2v5.2"/>')],
  limRate:['#34C759', SF('<path d="M12 3.6v16.8M16.2 7.4c-.6-1.4-2.2-2.2-4.2-2.2-2.5 0-4.2 1.2-4.2 3.1 0 4.3 8.6 2.4 8.6 6.8 0 1.9-1.8 3.2-4.4 3.2-2.2 0-3.9-.9-4.5-2.5"/>')],
  // Telegram's own app icon: the white paper plane on its blue gradient.
  telegram:['linear-gradient(180deg,#37AEE2,#1E96C8)', '<svg viewBox="4.2 4.2 15.6 15.6" aria-hidden="true"><path fill="#fff" d="M5.2 11.6c3.8-1.66 6.33-2.75 7.6-3.28 3.62-1.5 4.37-1.77 4.86-1.78.11 0 .35.03.5.15.13.1.17.25.18.35.02.1.04.33.02.51-.2 2.06-1.04 7.06-1.47 9.37-.18.98-.54 1.3-.88 1.34-.75.07-1.32-.5-2.05-.97-1.13-.74-1.77-1.2-2.87-1.93-1.27-.84-.45-1.3.28-2.05.19-.2 3.48-3.19 3.55-3.46 0-.04.02-.16-.06-.23-.07-.06-.18-.04-.26-.02-.11.03-1.89 1.2-5.33 3.53-.5.35-.96.52-1.37.51-.45-.01-1.32-.26-1.97-.47-.79-.26-1.42-.4-1.37-.84.03-.23.34-.47.94-.71Z"/></svg>'],
  simpleView:['#8E8E93', SF('<rect x="4" y="5" width="16" height="14" rx="2.6"/><path d="M8 10h8M8 14h5"/>')],
  macTheme:['#FF9500', SF('<circle cx="12" cy="12" r="8.4"/><circle cx="8.6" cy="10" r="1.3" fill="#fff"/><circle cx="12" cy="7.8" r="1.3" fill="#fff"/><circle cx="15.4" cy="10" r="1.3" fill="#fff"/>')],
  macIcon:['#5856D6', SF('<rect x="4.4" y="4.4" width="15.2" height="15.2" rx="4.4"/><circle cx="15.6" cy="8.4" r="1.4" fill="#fff"/>')],
  seeThrough:['#30B0C7', SF('<rect x="3.4" y="4.4" width="12.6" height="10.6" rx="2.2"/><rect x="8" y="9" width="12.6" height="10.6" rx="2.2" stroke-dasharray="2.2 2"/>')],
  darkMode:['#007AFF', SF('<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" fill="#fff" stroke="none"/>')],
  tables:['#32ADE6', SF('<rect x="3.6" y="4.8" width="16.8" height="14.4" rx="2.4"/><path d="M3.6 9.8h16.8M3.6 14.6h16.8M9.4 9.8v9.4M14.6 9.8v9.4"/>')],
  kitchenMode:['#5E5CE6', SF('<path d="M3.4 18.6 8.3 5.6h1.4l4.9 13M5.3 14h7.4"/><path d="M15.6 18.6l2.5-6.5h.8l2.5 6.5M16.6 16.2h3.8" stroke-width="1.7"/>')],
  milestones:['#FFB800', SF('<circle cx="12" cy="9.2" r="5.6"/><path d="M8.6 13.6 7.4 21l4.6-2.4 4.6 2.4-1.2-7.4"/>', true)],
  report:['#FF3B30', SF('<path d="M5.4 21V4.4"/><path d="M5.4 4.6h11.4l-2.4 4 2.4 4H5.4" fill="#fff"/>')],
  recipeAlerts:['#FF9500', SF('<path d="M12 3.2a6 6 0 0 0-6 6v3.3l-1.6 2.6A1 1 0 0 0 5.3 16.6h13.4a1 1 0 0 0 .9-1.5L18 12.5V9.2a6 6 0 0 0-6-6Z"/><path d="M9.6 18.2h4.8a2.4 2.4 0 0 1-4.8 0Z"/>', true)],
  rcTour:['#FF9500', SF('<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17Z"/><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18M9 8.5h5"/>')],
  xtTour:['#5856D6', SF('<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5M12 13v8"/>')],
  tour:['#34C759', SF('<path d="M12 3.2a6.2 6.2 0 0 0-3.6 11.3c.6.4.9 1 .9 1.7v.6h5.4v-.6c0-.7.3-1.3.9-1.7A6.2 6.2 0 0 0 12 3.2Z"/><path d="M9.5 19h5M10.3 21.2h3.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>', true)],
  shortcuts:['#8E8E93', SF('<rect x="2.8" y="6" width="18.4" height="12" rx="2.4"/><path d="M6.6 9.8h.01M10.2 9.8h.01M13.8 9.8h.01M17.4 9.8h.01M8 14.2h8" stroke-width="2.2"/>')],
  ai:['#5E5CE6', SF('<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4"/><path d="M9.8 3.4v3.2M14.2 3.4v3.2M9.8 17.4v3.2M14.2 17.4v3.2M3.4 9.8h3.2M3.4 14.2h3.2M17.4 9.8h3.2M17.4 14.2h3.2"/>')],
  privacy:['#007AFF', SF('<path d="M12 2.9 5 5.7v5.6c0 4.5 3 8.4 7 9.8 4-1.4 7-5.3 7-9.8V5.7Z"/>', true)],
};
const setIcon = id=>{ const i = SETTING_ICONS[id]; return i ? `<i class="set-ico" style="background:${i[0]}">${i[1]}</i>` : ''; };

function featureOn(id){
  const saved = state.settings?.[id];
  return typeof saved === 'boolean' ? saved : !!SETTINGS.find(f=>f.id === id)?.on;
}
function choice(id){
  const saved = state.settings?.[id];
  return CHOICES[id].includes(saved) ? saved : CHOICES[id][0];
}
/* Saves one setting for this account. It applies at once; if the server can't take it, it goes back. */
/* Offline (or when the server can't be reached) it is kept on this phone and sent by itself once online:
   a setting is one whole value, so sending it later is safe. A newer change of the same setting replaces
   the one waiting, and while one waits the next one waits behind it (never sent around it). */
async function setSetting(id, value){
  const before = state.settings?.[id];
  state.settings = {...(state.settings || {}), [id]:value};
  applyFeatures();
  if(appOffline() || queuedChange('setting', id)) return keepSettingForLater(id, value);
  const r = await api('settings', {method:'PUT', body:{key:id, value}});
  if(r.ok) return true;
  if(r.status === 0 && !r.stale) return keepSettingForLater(id, value);
  state.settings = {...state.settings, [id]:before};
  applyFeatures();
  toast(t('saveFailed'), 'warn');
  if(state.view === 'settings') render();
  return false;
}
function keepSettingForLater(id, value){
  const label = t('feat_' + id) || t('settings');
  if(!queueChange('setting', id, 'settings', 'PUT', {key:id, value}, {label, offline:true})){ toast(t('saveFailed'), 'warn'); return false; }
  // Said only for the switches a person sets (a tour marked as seen goes quietly).
  if(SETTINGS.some(f=>f.id === id) || CHOICES[id]) toast(t('offlineWillSend'));
  paintOfflineNote();
  if(!appOffline()) flushOutbox();
  return true;
}
OUTBOX_KINDS.setting = {
  settled(done, failed){
    // A refused one goes back to what the server has.
    if(failed.length && state.view === 'settings') render();
  },
  discarded(){ refreshData('live'); },
};
const setFeature = (id, on)=>setSetting(id, !!on);
const ricoStyle = ()=>choice('ricoStyle');
/* Choices made on this phone before settings moved to the account are carried over once. */
async function carryOverLocalSettings(){
  if(!state.account || Object.keys(state.settings || {}).length) return;
  const old = {compactRows:lget('compactRows') === true ? true : undefined, showLastQty:lget('showLastQty') === true ? true : undefined,
    soundQty:lget('sound.qty') === 'off' ? false : undefined, soundSent:lget('sound.sent') === 'off' ? false : undefined,
    darkMode:['on', 'off'].includes(lget('darkMode')) ? lget('darkMode') : undefined};
  for(const [key, value] of Object.entries(old)) if(value !== undefined) await setSetting(key, value);
  ['compactRows', 'showLastQty', 'sound.qty', 'sound.sent', 'darkMode'].forEach(k=>lset(k, null));
}
/* Settings that change the whole page are classes on <html>. */
function applyFeatures(){
  document.documentElement.classList.toggle('kitchen-mode', featureOn('kitchenMode'));
  document.documentElement.classList.toggle('compact-rows', featureOn('compactRows'));
  document.documentElement.classList.toggle('simple-view', featureOn('simpleView'));
}
function renderFeatureSettings(){
  // Ahmad (the recipe book) sees only the settings that apply to him: ordering, stock, Rico and
  // Interactive tables only once Rozh gives him those screens.
  const hidden = f=>state.account === 'ahmad' && ((f.id === 'tables' && !canOpen('manage')) || (!canOpen('order') && ['swipe','showLastQty','compactRows','soundQty','soundSent','milestones','soundMilestone','soundUndo'].includes(f.id)) || (f.role && !canOpen(f.role)));
  const row = f=>`<label class="check-row preference-row has-ico"><input type="checkbox" data-feature="${f.id}" ${featureOn(f.id) ? 'checked' : ''}>${setIcon(f.id)}<span>${esc(t('feat_' + f.id))}<small>${esc(t('feat_' + f.id + '_hint'))}</small></span></label>`;
  return SETTING_GROUPS.map(group=>{
    // The chat Rico's settings are in his own tab (the sliders button); Rico the helper has his own section.
    const rows = SETTINGS.filter(f=>f.group === group && (!f.role || canOpen(f.role) || state.account === 'ahmad') && (!f.rozha || isRozha()) && !hidden(f)).map(row).join('');
    if(!rows && group !== 'look') return '';
    return `<div class="section-title">${esc(t('settingsGroup_' + group))}</div><div class="form-card">${group === 'look' ? renderAppearanceRow() : ''}${rows}</div>`;
  }).join('');
}
function attachFeatureSettings(){
  document.querySelectorAll('[data-feature]').forEach(box=>box.onchange = async ()=>{
    if(!(await setFeature(box.dataset.feature, box.checked))) box.checked = !box.checked;
    if(box.dataset.feature === 'tables' && state.view !== 'settings') render();
  });
}
/* The warning before the wipe day: shown from 2 days before, on History and Record. */
function wipeDaysLeft(){
  if(!state.nextWipe) return null;
  const today = BAGHDAD_DAY.format(new Date());
  return Math.round((Date.parse(state.nextWipe + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}
function wipeBanner(){
  const left = wipeDaysLeft();
  if(left === null || left > 2 || left < 0) return '';
  return `<div class="wipe-banner" role="status">${ICON_BELL}<span>${esc(left === 0 ? t('wipeWarnToday') : t('wipeWarnSoon')(left))}</span></div>`;
}

/* ============ What a setting does ============
   A computer: resting the pointer on a setting for a moment shows a small card with what it does, in a
   sentence or two and a small picture of it. A phone: the round "i" button on the row opens the same in
   a sheet. Only explains: the switch itself is still the only thing that changes a setting. Works on the
   Settings page and in Rico's settings. */
/* Read-only examples built with the same components as Order, Manage and Rico.
   Demo data stays here. Previewing a setting never runs the action being shown. */
const SETTING_PREVIEW_IDS = new Set([
  'notif', 'recipeAlerts', 'swipe', 'showLastQty', 'compactRows', 'soundQty', 'soundSent',
  'soundRico', 'soundError', 'soundMilestone', 'soundUndo', 'darkMode', 'simpleView', 'tables',
  'kitchenMode', 'milestones', 'ricoAutoStart', 'tfAuto', 'rrStop', 'ricoAutoOrder', 'ricoSheet', 'ai'
]);
function settingPreview(id){
  const words = t('settingPreview');
  const items = words.items.map((name, i)=>({id:'preview-' + i, name}));
  const row = (i, qty = 0, last = 0)=>itemRowHtml(items[i], {[items[i].id]:last}, {qty, unit:words.kg, pinned:false});
  const orders = (...rows)=>`<div class="supplier-group demo-order"><div class="supplier-head"><span class="supplier-heading-name">${esc(words.supplier)}</span></div><div class="supplier-items-grid">${rows.join('')}</div></div>`;
  const toastDemo = (msg, kind = 'ok')=>`<div class="toast show ${kind}"><span dir="auto">${esc(msg)}</span></div>`;
  const frame = (label, content, cls = '')=>`<section class="demo-frame ${cls}"><b class="demo-label">${esc(label)}</b><div class="demo-screen">${content}</div></section>`;
  const compare = (label, first, second, cls = '')=>frame(label,
    `<div class="demo-compare"><div><small>${esc(words.before)}</small>${first}</div><div><small>${esc(words.after)}</small>${second}</div></div>`, cls);
  const helper = h=>`<div class="form-card rs-card">${rrHelperStatusRow(h)}</div>`;
  switch(id){
    case 'swipe':
      return compare(viewLabel('order'), `<div class="demo-swipe">${row(0)}<span class="demo-touch" aria-hidden="true"></span></div>`,
        row(0, 3) + toastDemo(t('swipeAdded')(3, words.kg)));
    case 'showLastQty':
      return frame(viewLabel('order'), orders(row(0, 0, 3), row(1, 0, 2)));
    case 'compactRows':
    case 'kitchenMode': {
      const rows = orders(row(0, 2), row(1));
      return compare(viewLabel('order'), rows, rows, id === 'compactRows' ? 'demo-density' : 'demo-kitchen');
    }
    case 'soundQty':
      return frame(viewLabel('order'), orders(row(0, 1)), 'demo-qty');
    case 'soundSent':
      return frame(viewLabel('order'), renderQueueSummary(2, 2, 'saved'));
    case 'soundRico':
      return frame(t('ricoName'), renderRicoMessage({role:'user', text:words.question}, 0) +
        renderRicoMessage({role:'assistant', text:words.reply}, 1), 'demo-chat');
    case 'soundError':
      return frame(viewLabel('order'), orders(row(0, 2)) + toastDemo(t('saveFailed'), 'error'));
    case 'soundUndo':
      return frame(viewLabel('order'), orders(row(0)) + toastDemo(t('orderUndone')));
    case 'soundMilestone':
      return frame(t('streakTitle'), streakMilestoneCard(30), 'demo-milestone');
    case 'milestones':
      return frame(t('streakTitle'), renderStreakChip({count:30, lit:true}) + streakMilestoneCard(30), 'demo-milestone');
    case 'darkMode':
      return frame(t('darkLabel'), `<div class="demo-compare demo-modes">
        <div class="demo-light"><small>${esc(t('darkOff'))}</small>${orders(row(0, 2))}</div>
        <div class="demo-dark"><small>${esc(t('darkOn'))}</small>${orders(row(0, 2))}</div></div>`);
    case 'simpleView': {
      const hero = renderOrderHero(3, 1, {count:0, expense:false});
      return compare(viewLabel('order'), hero, hero, 'demo-simple');
    }
    case 'tables':
      return frame(viewLabel('manage'), renderDataTable('items', {
        rows:items.map(item=>({...item, previewUnit:words.kg})),
        cols:[{...TABLES.items.columns[0]}, {...TABLES.items.columns[2], value:item=>item.previewUnit}]
      }), 'demo-table');
    case 'ricoAutoStart':
      return compare(t('rrRicoMac'), helper({online:false}), helper({online:true}));
    case 'rrStop':
      return frame(t('rrTitle'), helper({online:true, stopped:true}));
    case 'tfAuto':
      return frame(t('tfTitle'), `<div class="rr-done"><span class="rr-done-tag">${ICON_CHECK}${esc(t('tfStatus_moved'))}</span>
        <b dir="auto">${esc(words.transfer)}</b><small>${esc(items[0].name)} · 3 ${esc(words.kg)}</small></div>`);
    case 'ricoAutoOrder':
      return frame(viewLabel('order'), orders(row(0, 3), row(1, 2)) + toastDemo(t('reorderReady')(2)));
    case 'ricoSheet':
      return frame(viewLabel('order'), `<div class="order-quick-actions">${ricoOrderButtonHtml()}</div>
        <div class="sel-panel demo-order-sheet">${ricoOrderSheetHtml(t('sheetAskAbout'))}</div>`);
    case 'ai':
      return frame(t('ricoName'), `<div class="modal-box modal-alert demo-ai"><div class="modal-alert-title">${esc(t('aiTitle'))}</div>
        <p class="modal-msg">${esc(words.ai)}</p><div class="modal-actions">
        <button class="btn btn-ghost">${esc(t('aiNotNow'))}</button><button class="btn btn-primary">${esc(t('aiAllow'))}</button></div></div>`);
    case 'recipeAlerts':
      return frame(t('recipesTitle'), recipeAlerts([{...words.recipeAlert, at:Date.now()}]));
    case 'notif':
      return frame(words.notificationLabel, `<div class="rico-note unread"><img src="icon-192.png" alt="" width="28" height="28"><div class="rico-note-body">
        <div class="rico-note-meta">${esc(words.notification)}</div><div class="rico-note-text">${esc(words.reminder)}</div></div></div>`, 'demo-notification');
  }
}
/* Which setting a row is about (from its switch), or null. */
function helpIdOf(row){
  if(!row) return null;
  if(row.classList.contains('dark-row')) return 'darkMode';
  const box = row.querySelector('input[type=checkbox]');
  if(!box) return null;
  const id = box.dataset.feature || ({pushSwitch:'notif', tfAutoSet:'tfAuto', rrStop:'rrStop'})[box.id]
    || (box.hasAttribute('data-set-auto') ? 'ricoAutoOrder' : box.hasAttribute('data-set-sheet') ? 'ricoSheet' : box.hasAttribute('data-set-ai') ? 'ai' : null);
  return id && SETTING_PREVIEW_IDS.has(id) && (t('settingHelp') || {})[id] ? id : null;
}
// The setting's name (on phones it sits in .set-title with the "i" button, whose text is left out).
const helpTitleOf = row=>{
  const head = row.querySelector('.set-title');
  if(head) return [...head.childNodes].map(n=>n.nodeType === 3 ? n.textContent : n.classList?.contains('set-tail') ? n.firstChild?.textContent || '' : '').join('').trim();
  return row.querySelector('span')?.childNodes[0]?.textContent?.trim() || '';
};
const HELP_ICON = {rrStop:'ricoStop', ricoAutoOrder:'ricoSheet', darkMode:'darkMode'};
function helpBody(id, title){
  // Preview copies must not be matched by app event handlers or duplicate live IDs.
  const demo = document.createElement('template');
  demo.innerHTML = settingPreview(id);
  demo.content.querySelectorAll('*').forEach(el=>{
    for(const attr of el.getAttributeNames()){
      if(attr === 'id' && el.localName === 'linearGradient' && el.id.startsWith('ricotta-streak-')) continue;
      if(['id', 'for', 'name', 'aria-live', 'role'].includes(attr) || attr.startsWith('data-')) el.removeAttribute(attr);
    }
  });
  return `<div class="help-text"><div class="help-name">${setIcon(HELP_ICON[id] || id)}<b dir="auto">${esc(title)}</b></div>
    <p dir="auto">${esc(t('settingHelp')[id])}</p></div><div class="setting-demo" inert aria-hidden="true">${demo.innerHTML}</div>`;
}
const HELP_ROWS = 'label.preference-row, label.rico-set-row, .dark-row';
let helpTimer = 0, helpRow = null, helpAnchor = null;
function hideSettingHelp(){
  clearTimeout(helpTimer);
  helpAnchor?.removeAttribute('aria-describedby');
  helpAnchor = helpRow = null;
  document.getElementById('settingHelp')?.remove();
}
function showSettingHelp(row, anchor){
  const id = helpIdOf(row); if(!id || !row.isConnected) return;
  hideSettingHelp(); helpRow = row;
  const tip = document.createElement('div');
  tip.id = 'settingHelp'; tip.className = 'help-pop'; tip.setAttribute('role', 'tooltip');
  tip.innerHTML = helpBody(id, helpTitleOf(row));
  helpAnchor = anchor;
  helpAnchor?.setAttribute('aria-describedby', tip.id);
  document.body.appendChild(tip);
  // Beside the row (the side with room, the reading side first), else under it; never off screen.
  const r = row.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 12, rtl = isRtl();
  let x = rtl ? r.left - w - gap : r.right + gap;
  if(x < 8 || x + w > innerWidth - 8) x = rtl ? r.right + gap : r.left - w - gap;
  let y = r.top + r.height / 2 - h / 2;
  if(x < 8 || x + w > innerWidth - 8){ x = Math.min(Math.max(8, r.left + 24), innerWidth - w - 8); y = r.bottom + 8; if(y + h > innerHeight - 8) y = r.top - h - 8; }
  tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(Math.min(Math.max(8, y), innerHeight - h - 8)) + 'px';
}
if(matchMedia('(hover: hover) and (pointer: fine)').matches){
  document.addEventListener('mouseover', e=>{
    const row = e.target.closest?.(HELP_ROWS);
    if(row === helpRow || (row && row.contains(e.relatedTarget) && helpTimer)) return;
    if(!row || !helpIdOf(row)){ if(helpRow || document.getElementById('settingHelp')) hideSettingHelp(); return; }
    hideSettingHelp(); helpRow = row;
    helpTimer = setTimeout(()=>{ if(row.matches(':hover')) showSettingHelp(row); }, 600);
  });
  document.addEventListener('mouseout', e=>{ if(helpRow && !helpRow.contains(e.relatedTarget)) hideSettingHelp(); });
  document.addEventListener('focusin', e=>{
    const row = e.target.closest?.(HELP_ROWS);
    if(row && !row.contains(e.relatedTarget) && e.target.matches(':focus-visible')) showSettingHelp(row, e.target);
  });
  document.addEventListener('focusout', e=>{ if(e.target === helpAnchor || helpRow?.contains(e.target)) hideSettingHelp(); });
  ['scroll', 'pointerdown'].forEach(ev=>document.addEventListener(ev, ()=>{ if(helpRow) hideSettingHelp(); }, true));
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && helpRow) hideSettingHelp(); });
}
/* Phones: an "i" button on each row that has an explanation (Settings page only). */
function addSettingHelpButtons(root = document){
  if(matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  root.querySelectorAll(HELP_ROWS).forEach(row=>{
    const id = helpIdOf(row); if(!id || row.querySelector('.help-btn')) return;
    const title = helpTitleOf(row), span = row.querySelector('span'), words = span?.firstChild;
    if(!words || words.nodeType !== 3) return;
    // Right after the setting's name, like a small footnote mark, so it reads as "about this" and not
    // as a second control beside the switch.
    const head = document.createElement('span');
    head.className = 'set-title';
    span.insertBefore(head, words);
    // The last word and the "i" never break apart, so the "i" never sits alone on a line.
    const text = words.textContent.replace(/\s+$/, ''), cut = text.lastIndexOf(' ');
    words.remove();
    head.textContent = cut > 0 ? text.slice(0, cut + 1) : '';
    const tail = document.createElement('span');
    tail.className = 'set-tail';
    tail.textContent = cut > 0 ? text.slice(cut + 1) : text;
    head.appendChild(tail);
    tail.insertAdjacentHTML('beforeend', `<button type="button" class="help-btn" data-help="${esc(id)}" aria-label="${esc(t('settingHelpBtn')(title))}">i</button>`);
  });
}
document.addEventListener('click', e=>{
  const b = e.target.closest?.('[data-help]'); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const row = b.closest(HELP_ROWS), id = b.dataset.help;
  if(!SETTING_PREVIEW_IDS.has(id)) return;
  const title = row ? helpTitleOf(row) : '';
  const {el, close} = openKitchenSheet('help-sheet', `<div class="help-sheet-body">${helpBody(id, title)}
    <button type="button" class="btn btn-ghost help-close">${esc(t('padDone'))}</button></div>`, title,
    {returnFocus:b});
  const done = el.querySelector('.help-close');
  done.onclick = ()=>close();
  el.querySelector('.sel-panel').tabIndex = -1;
  el.querySelector('.sel-panel').focus({preventScroll:true});
}, true);

/* ============ How Expenses work: a short one-time tour (2026-11-15) ============
   Everyone sees it once after the Expenses update, on whichever device they open first: Done or Skip
   saves "seen" on their account (settings.tourExpenses), so it never shows again anywhere. Four short
   steps with small moving pictures in the app's look; Settings, Help can show it again. */
const XT_STEPS = ['tabs', 'switch', 'add', 'suppliers'];
function xtPic(step){
  const touch = !matchMedia('(hover: hover) and (pointer: fine)').matches;
  if(step === 'tabs') return `<div class="xt-pic xt-tabs" aria-hidden="true"><div class="xt-seg"><i></i><b>${esc(kindLabel('food'))}</b><b>${esc(kindLabel('expense'))}</b></div>
    <div class="xt-rows"><span></span><span></span><span></span></div></div>`;
  if(step === 'switch') return `<div class="xt-pic xt-switch${touch ? ' touch' : ''}" aria-hidden="true"><div class="xt-phone"><div class="xt-spark">${typeof ricoFace === 'function' ? ricoFace('', 'rico-xs') : ''}</div>
    <div class="xt-page"><div class="xt-seg small"><i></i><b></b><b></b></div><span></span><span></span></div>${touch ? '<div class="xt-finger"></div>' : ''}</div></div>`;
  if(step === 'add') return `<div class="xt-pic xt-add" aria-hidden="true"><div class="xt-btn">${ICON_PLUS}<span>${esc(t('addExpenseItem'))}</span></div>
    <div class="xt-items"><span>${esc(t('xtTea'))}</span><span>${esc(t('xtCups'))}</span><span>${esc(t('xtTissues'))}</span></div></div>`;
  return `<div class="xt-pic xt-sup" aria-hidden="true"><div class="xt-sup-name">${esc(t('xtSupplier'))}</div>
    <div class="xt-chips"><span>${esc(t('buys_food'))}</span><span>${esc(t('buys_expenses'))}</span><span>${esc(t('buys_both'))}</span></div></div>`;
}
function openExpensesTour(){
  let i = 0;
  const touch = !matchMedia('(hover: hover) and (pointer: fine)').matches;
  const {el, close} = openKitchenSheet('xt-sheet', '<div id="xtStep"></div>', t('xtTitle'));
  const seen = ()=>{ if(state.settings?.tourExpenses !== true) setSetting('tourExpenses', true); lset('xtSeen:' + state.account, true); };
  const paint = ()=>{
    const s = XT_STEPS[i], last = i === XT_STEPS.length - 1;
    el.querySelector('#xtStep').innerHTML = `<div class="xt-step">${xtPic(s)}
      <div class="xt-dots" aria-hidden="true">${XT_STEPS.map((_, n)=>`<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="sel-title">${esc(t('xt_' + s + 'T'))}</div>
      <p class="xt-text">${esc(t('xt_' + s + (s === 'switch' && touch ? 'Touch' : '')))}</p>
      <div class="xt-btns">${last ? '' : `<button type="button" class="btn btn-ghost" data-xt-skip>${esc(t('xtSkip'))}</button>`}<button type="button" class="btn btn-primary" data-xt-next>${esc(t(last ? 'xtDone' : 'xtNext'))}</button></div>
      <span class="sr-only" aria-live="polite">${esc(t('xtStepOf')(i + 1, XT_STEPS.length))}</span></div>`;
    el.querySelector('[data-xt-next]').onclick = ()=>{ if(last){ seen(); close(); } else { i++; paint(); } };
    el.querySelector('[data-xt-skip]')?.addEventListener('click', ()=>{ seen(); close(); });
  };
  paint();
  // Closing it any other way (Escape, the backdrop, dragging it down) also counts as seen: it never nags.
  const gone = new MutationObserver(()=>{ if(!el.isConnected){ gone.disconnect(); seen(); } });
  gone.observe(document.body, {childList:true});
}
/* Shown once, when Expenses are on, after any other first-time sheet has closed. */
function maybeShowExpensesTour(tries = 0){
  if(!state.account || !state.expensesReady || !canOpen('order')) return;
  if(state.settings?.tourExpenses === true || lget('xtSeen:' + state.account)) return;
  if(document.querySelector('.sel-sheet, .modal-overlay') || state.view === 'login'){ if(tries < 20) setTimeout(()=>maybeShowExpensesTour(tries + 1), 1500); return; }
  openExpensesTour();
}
