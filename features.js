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
/* Each picture is a tiny drawing of the thing itself (2026-11-15): the banner that drops in, the item
   being swiped, the row with last time's amount, the rows before and after, each sound's own moment. */
const HP_WAVES = '<path d="M92 30a10 10 0 0 1 0 16" class="hp-wave hp-w1"/><path d="M99 23a19 19 0 0 1 0 30" class="hp-wave hp-w2"/><path d="M106 16a28 28 0 0 1 0 44" class="hp-wave hp-w3"/>';
const HELP_PIC = {
  bell:'<rect x="38" y="3" width="56" height="70" rx="11" class="hp-card"/><text x="66" y="22" text-anchor="middle" class="hp-clock">9:41</text><rect x="56" y="62" width="20" height="3" rx="1.5" class="hp-line"/><g class="hp-slide"><rect x="42" y="31" width="48" height="20" rx="6" class="hp-card hp-lift"/><rect x="45.5" y="35" width="12" height="12" rx="3.5" class="hp-acc"/><path d="M51.5 38c.4 2.4 1.6 3.6 4 4-2.4.4-3.6 1.6-4 4-.4-2.4-1.6-3.6-4-4 2.4-.4 3.6-1.6 4-4Z" class="hp-white" transform="translate(0 -1)"/><rect x="61" y="36" width="24" height="4" rx="2" class="hp-strong"/><rect x="61" y="43" width="17" height="3.5" rx="1.75" class="hp-line"/></g>',
  swipe:'<rect x="10" y="20" width="112" height="30" rx="9" class="hp-card"/><rect x="20" y="28" width="40" height="6" rx="3" class="hp-strong"/><rect x="20" y="38" width="26" height="4" rx="2" class="hp-line"/><rect x="88" y="26" width="24" height="18" rx="6" class="hp-line"/><text x="100" y="39.5" text-anchor="middle" class="hp-num hp-fadein">5</text><circle cx="36" cy="35" r="8" class="hp-acc hp-soft hp-finger"/><path d="M30 62h44m-6-5 6 5-6 5" class="hp-grid hp-arrow"/>',
  last:'<rect x="10" y="18" width="112" height="40" rx="9" class="hp-card"/><rect x="20" y="27" width="46" height="6" rx="3" class="hp-strong"/><g class="hp-pulse"><rect x="20" y="38" width="34" height="12" rx="6" class="hp-acc hp-soft"/><path d="M27.5 44a3.5 3.5 0 1 0 1-2.5" class="hp-mini"/><path d="M27.2 40.6v2h2" class="hp-mini"/><text x="44" y="47.5" text-anchor="middle" class="hp-small">4</text></g><rect x="88" y="28" width="24" height="20" rx="6" class="hp-line"/>',
  compact:'<rect x="10" y="8" width="50" height="60" rx="8" class="hp-card"/><rect x="16" y="14" width="38" height="14" rx="4" class="hp-line"/><rect x="16" y="31" width="38" height="14" rx="4" class="hp-line"/><rect x="16" y="48" width="38" height="14" rx="4" class="hp-line"/><path d="M62 38h8m-4-4 4 4-4 4" class="hp-grid"/><rect x="72" y="8" width="50" height="60" rx="8" class="hp-card"/><rect x="78" y="13" width="38" height="8" rx="3" class="hp-acc hp-soft"/><rect x="78" y="23" width="38" height="8" rx="3" class="hp-acc hp-soft"/><rect x="78" y="33" width="38" height="8" rx="3" class="hp-acc hp-soft"/><rect x="78" y="43" width="38" height="8" rx="3" class="hp-acc hp-soft"/><rect x="78" y="53" width="38" height="8" rx="3" class="hp-acc hp-soft"/>',
  soundTap:'<rect x="14" y="24" width="64" height="28" rx="14" class="hp-card"/><path d="M26 38h10" class="hp-stroke"/><path d="M56 38h10M61 33v10" class="hp-stroke"/><circle cx="61" cy="38" r="12" class="hp-acc hp-soft hp-pulse"/>' + HP_WAVES,
  soundSent:'<path d="M18 38 70 18 58 62 46 46Z" class="hp-acc"/><path d="M46 46 70 18" class="hp-grid hp-onacc"/>' + HP_WAVES,
  soundRico:'<path d="M18 20h52a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H36l-10 8v-8h-8a8 8 0 0 1-8-8V28a8 8 0 0 1 8-8Z" class="hp-card"/><path d="M44 26c.7 4.4 3.1 6.8 7.5 7.5-4.4.7-6.8 3.1-7.5 7.5-.7-4.4-3.1-6.8-7.5-7.5 4.4-.7 6.8-3.1 7.5-7.5Z" class="hp-acc"/>' + HP_WAVES,
  soundError:'<path d="M41 16 16 60h50Z" class="hp-red" stroke-linejoin="round"/><path d="M41 32v12" class="hp-stroke hp-onred"/><circle cx="41" cy="51" r="2.4" class="hp-white"/>' + HP_WAVES,
  soundFanfare:'<path d="m44 14 7.6 15.4 17 2.5-12.3 12 2.9 16.9L44 52.8l-15.2 8 2.9-16.9-12.3-12 17-2.5Z" class="hp-gold hp-pop"/>' + HP_WAVES,
  soundUndo:'<path d="M34 24 20 38l14 14" class="hp-stroke hp-bold"/><path d="M21 38h30a14 14 0 0 1 0 28h-8" class="hp-stroke hp-bold"/>' + HP_WAVES,
  dark:'<rect x="22" y="8" width="88" height="60" rx="10" class="hp-card"/><path d="M66 8h34a10 10 0 0 1 10 10v40a10 10 0 0 1-10 10H66Z" class="hp-darkside"/><circle cx="44" cy="30" r="7" class="hp-gold"/><path d="M44 18v3M44 39v3M32 30h3M53 30h3M35.5 21.5l2 2M50.5 36.5l2 2M35.5 38.5l2-2M50.5 23.5l2-2" class="hp-sunray"/><rect x="32" y="48" width="24" height="5" rx="2.5" class="hp-line"/><path d="M92 23a8 8 0 1 0 6 13 7 7 0 0 1-6-13Z" class="hp-white"/><rect x="76" y="48" width="24" height="5" rx="2.5" class="hp-nightline"/>',
  simple:'<rect x="14" y="10" width="104" height="56" rx="9" class="hp-card"/><rect x="24" y="20" width="56" height="7" rx="3.5" class="hp-strong"/><rect x="24" y="32" width="84" height="5" rx="2.5" class="hp-line hp-fadeout"/><rect x="24" y="41" width="62" height="5" rx="2.5" class="hp-line hp-fadeout"/><rect x="24" y="52" width="40" height="8" rx="4" class="hp-acc hp-soft"/>',
  table:'<rect x="12" y="10" width="108" height="56" rx="8" class="hp-card"/><path d="M12 25h108M12 38h108M12 51h108M48 25v41M84 25v41" class="hp-grid"/><rect x="20" y="15" width="20" height="5" rx="2.5" class="hp-strong"/><rect x="56" y="15" width="20" height="5" rx="2.5" class="hp-strong"/><rect x="92" y="15" width="16" height="5" rx="2.5" class="hp-strong"/><path d="M111 15.5l2.5 3 2.5-3" class="hp-grid hp-accline"/>',
  big:'<text x="40" y="50" text-anchor="middle" class="hp-aa-sm">Aa</text><path d="M60 40h12m-4-4 4 4-4 4" class="hp-grid"/><text x="96" y="52" text-anchor="middle" class="hp-aa">Aa</text>',
  award:'<path d="m56 46-6 20 16-7 16 7-6-20" class="hp-acc hp-soft"/><circle cx="66" cy="32" r="18" class="hp-gold hp-pop"/><text x="66" y="38" text-anchor="middle" class="hp-medal">30</text>',
  mac:'<rect x="28" y="10" width="76" height="48" rx="5" class="hp-card"/><path d="M20 64h92" class="hp-grid"/><path d="M66 22c.9 5.4 3.6 8.1 9 9-5.4.9-8.1 3.6-9 9-.9-5.4-3.6-8.1-9-9 5.4-.9 8.1-3.6 9-9Z" class="hp-acc"/><circle cx="94" cy="18" r="3.5" class="hp-ok hp-pulse"/>',
  move:'<rect x="8" y="16" width="40" height="44" rx="8" class="hp-card"/><rect x="84" y="16" width="40" height="44" rx="8" class="hp-card"/><rect x="16" y="24" width="24" height="5" rx="2.5" class="hp-strong"/><rect x="92" y="24" width="24" height="5" rx="2.5" class="hp-strong"/><path d="M52 52h28" class="hp-grid"/><rect x="21" y="36" width="14" height="14" rx="3" class="hp-acc hp-travel"/><g class="hp-fadein"><circle cx="113" cy="49" r="7" class="hp-ok"/><path d="m109.5 49 2.4 2.4 4.6-4.8" class="hp-mini hp-onacc"/></g>',
  stop:'<rect x="34" y="10" width="34" height="48" rx="4" class="hp-card hp-dimmed"/><rect x="40" y="18" width="22" height="4" rx="2" class="hp-line"/><rect x="40" y="27" width="16" height="4" rx="2" class="hp-line"/><rect x="40" y="36" width="20" height="4" rx="2" class="hp-line"/><circle cx="78" cy="48" r="16" class="hp-red"/><rect x="71.5" y="41" width="4.5" height="14" rx="1.5" class="hp-white"/><rect x="80" y="41" width="4.5" height="14" rx="1.5" class="hp-white"/>',
  rico:'<path d="M26 22c1 6.4 4.4 9.8 10.8 10.8-6.4 1-9.8 4.4-10.8 10.8-1-6.4-4.4-9.8-10.8-10.8 6.4-1 9.8-4.4 10.8-10.8Z" class="hp-acc"/><path d="M42 33h8m-4-4 4 4-4 4" class="hp-grid"/><rect x="56" y="10" width="64" height="56" rx="8" class="hp-card"/><rect x="63" y="18" width="30" height="5" rx="2.5" class="hp-strong"/><rect x="63" y="31" width="28" height="4" rx="2" class="hp-line"/><rect x="100" y="28" width="13" height="10" rx="3" class="hp-acc hp-fill1"/><rect x="63" y="45" width="22" height="4" rx="2" class="hp-line"/><rect x="100" y="42" width="13" height="10" rx="3" class="hp-acc hp-fill2"/>',
  ask:'<rect x="30" y="6" width="72" height="64" rx="10" class="hp-card"/><rect x="38" y="15" width="36" height="5" rx="2.5" class="hp-strong"/><rect x="38" y="26" width="56" height="5" rx="2.5" class="hp-line"/><rect x="38" y="36" width="44" height="5" rx="2.5" class="hp-line"/><g class="hp-pulse"><rect x="46" y="50" width="40" height="13" rx="6.5" class="hp-acc"/><path d="M56 52.5c.4 2.4 1.7 3.7 4.1 4.1-2.4.4-3.7 1.7-4.1 4.1-.4-2.4-1.7-3.7-4.1-4.1 2.4-.4 3.7-1.7 4.1-4.1Z" class="hp-white"/><rect x="63" y="55" width="16" height="3" rx="1.5" class="hp-white"/></g>',
  ai:'<path d="M14 18h40a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H30l-8 7v-7h-8a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8Z" class="hp-card"/><rect x="18" y="27" width="30" height="4" rx="2" class="hp-line"/><rect x="18" y="35" width="20" height="4" rx="2" class="hp-line"/><path d="M68 32h14m-5-5 5 5-5 5" class="hp-grid hp-arrow"/><rect x="92" y="18" width="28" height="28" rx="6" class="hp-acc hp-soft"/><rect x="98" y="24" width="16" height="16" rx="3" class="hp-acc"/><path d="M101 18v-4M106 18v-4M111 18v-4M101 46v4M106 46v4M111 46v4M92 27h-4M92 37h-4M120 27h4M120 37h4" class="hp-grid"/>',
};
const HELP_OF = {notif:'bell', recipeAlerts:'bell', swipe:'swipe', showLastQty:'last', compactRows:'compact', soundQty:'soundTap', soundSent:'soundSent', soundRico:'soundRico', soundError:'soundError',
  soundMilestone:'soundFanfare', soundUndo:'soundUndo', darkMode:'dark', simpleView:'simple', tables:'table', kitchenMode:'big', milestones:'award', ricoAutoStart:'mac',
  tfAuto:'move', rrStop:'stop', ricoAutoOrder:'rico', ricoSheet:'ask', ai:'ai'};
/* Which setting a row is about (from its switch), or null. */
function helpIdOf(row){
  if(!row) return null;
  if(row.classList.contains('dark-row')) return 'darkMode';
  const box = row.querySelector('input[type=checkbox]');
  if(!box) return null;
  const id = box.dataset.feature || ({pushSwitch:'notif', tfAutoSet:'tfAuto', rrStop:'rrStop'})[box.id]
    || (box.hasAttribute('data-set-auto') ? 'ricoAutoOrder' : box.hasAttribute('data-set-sheet') ? 'ricoSheet' : box.hasAttribute('data-set-ai') ? 'ai' : null);
  return id && HELP_OF[id] && (t('settingHelp') || {})[id] ? id : null;
}
// The setting's name (on phones it sits in .set-title with the "i" button, whose text is left out).
const helpTitleOf = row=>{
  const head = row.querySelector('.set-title');
  if(head) return [...head.childNodes].map(n=>n.nodeType === 3 ? n.textContent : n.classList?.contains('set-tail') ? n.firstChild?.textContent || '' : '').join('').trim();
  return row.querySelector('span')?.childNodes[0]?.textContent?.trim() || '';
};
/* The card or sheet: the picture on a soft panel in the setting's own colour, then the setting's icon and
   name, then what it does. */
const HELP_ICON = {rrStop:'ricoStop', ricoAutoOrder:'ricoSheet', darkMode:'darkMode'};
function helpBody(id, title){
  const icon = HELP_ICON[id] || id, colour = SETTING_ICONS[icon]?.[0];
  const tint = /^#[0-9a-f]{6}$/i.test(colour || '') ? ` style="--hc:${colour}"` : '';
  return `<div class="help-hero"${tint}><svg class="help-pic" viewBox="0 0 132 76" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${HELP_PIC[HELP_OF[id]]}</svg></div><div class="help-text"><div class="help-name">${setIcon(icon)}<b dir="auto">${esc(title)}</b></div><p dir="auto">${esc(t('settingHelp')[id])}</p></div>`;
}
const HELP_ROWS = 'label.preference-row, label.rico-set-row, .dark-row';
let helpTimer = 0, helpRow = null;
function hideSettingHelp(){ clearTimeout(helpTimer); helpRow = null; document.getElementById('settingHelp')?.remove(); }
function showSettingHelp(row){
  const id = helpIdOf(row); if(!id || !row.isConnected) return;
  hideSettingHelp(); helpRow = row;
  const tip = document.createElement('div');
  tip.id = 'settingHelp'; tip.className = 'help-pop'; tip.setAttribute('role', 'tooltip');
  tip.innerHTML = helpBody(id, helpTitleOf(row));
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
  ['scroll', 'pointerdown', 'keydown'].forEach(ev=>document.addEventListener(ev, ()=>{ if(helpRow) hideSettingHelp(); }, true));
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
  if(!HELP_OF[id]) return;
  openKitchenSheet('help-sheet', `<div class="help-sheet-body">${helpBody(id, row ? helpTitleOf(row) : '')}</div>`, row ? helpTitleOf(row) : '');
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
