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
  {id:'ricoSheet', group:'rico', on:true, role:'assistant'},
  {id:'ricoBriefing', group:'rico', on:true, role:'assistant'},
  {id:'ricoMood', group:'rico', on:true, role:'assistant'},
  {id:'tables', group:'look', on:false},
  {id:'kitchenMode', group:'look', on:false},
  {id:'milestones', group:'look', on:true},
];
const CHOICES = {darkMode:['auto', 'on', 'off'], ricoStyle:['normal', 'short', 'warm']};
const SETTING_GROUPS = ['order', 'sound', 'rico', 'look'];

/* Settings icons, like the iPhone's Settings: a white symbol on a coloured rounded square. Drawn on a
   24 grid, filled where Apple fills them, 2px lines otherwise, centred by eye. Each group has its
   colour family (sounds pink, Rico green and purple, Look blue). */
const SF = (d, fill)=>`<svg viewBox="0 0 24 24" ${fill ? 'fill="#fff" stroke="none"' : 'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${d}</svg>`;
const SETTING_ICONS = {
  notif:['#FF3B30', SF('<path d="M12 3.2a6 6 0 0 0-6 6v3.3l-1.6 2.6A1 1 0 0 0 5.3 16.6h13.4a1 1 0 0 0 .9-1.5L18 12.5V9.2a6 6 0 0 0-6-6Z"/><path d="M9.6 18.2h4.8a2.4 2.4 0 0 1-4.8 0Z"/>', true)],
  swipe:['#34C759', SF('<path d="M3.5 6.6v10.8a.6.6 0 0 0 .95.5L11.6 12.5a.6.6 0 0 0 0-1L4.45 6.1a.6.6 0 0 0-.95.5Z"/><path d="M12 6.6v10.8a.6.6 0 0 0 .95.5l7.15-5.4a.6.6 0 0 0 0-1L12.95 6.1a.6.6 0 0 0-.95.5Z"/>', true)],
  showLastQty:['#FF9500', SF('<path d="M4.6 12.4A7.4 7.4 0 1 0 6.8 6.8"/><path d="M4.4 4.6v3.6H8"/><path d="M12 8.2v4l2.6 1.6"/>')],
  compactRows:['#5856D6', SF('<path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5"/><circle cx="4.9" cy="6.5" r="1.25" fill="#fff" stroke="none"/><circle cx="4.9" cy="12" r="1.25" fill="#fff" stroke="none"/><circle cx="4.9" cy="17.5" r="1.25" fill="#fff" stroke="none"/>')],
  soundQty:['#FF2D55', SF('<path d="M4 9.3h3l4.3-3.6a.5.5 0 0 1 .8.4v11.8a.5.5 0 0 1-.8.4L7 14.7H4a.8.8 0 0 1-.8-.8V10.1a.8.8 0 0 1 .8-.8Z" fill="#fff" stroke="none"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a7.6 7.6 0 0 1 0 10.8"/>')],
  soundSent:['#FF2D55', SF('<path d="M20.6 3.6 3.9 10.2c-.7.3-.6 1.3.1 1.5l6.3 1.9 1.9 6.3c.2.7 1.2.8 1.5.1L20.4 3.4Z"/>', true)],
  soundRico:['#FF2D55', SF('<path d="M12 3.6c-4.8 0-8.6 3.2-8.6 7.2 0 2.2 1.1 4.2 3 5.5l-.7 3.3c-.1.5.4.8.8.6l3.6-2.1c.6.1 1.3.2 1.9.2 4.8 0 8.6-3.2 8.6-7.3S16.8 3.6 12 3.6Z"/>', true)],
  soundError:['#FF2D55', SF('<path d="M10.3 4.2 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.6" stroke="#FF2D55" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.25" fill="#FF2D55"/>', true)],
  soundMilestone:['#FF2D55', SF('<path d="m12 3.3 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.6l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>', true)],
  soundUndo:['#FF2D55', SF('<path d="M8.6 5.4 4.4 9.6l4.2 4.2"/><path d="M4.6 9.6H15a4.6 4.6 0 0 1 0 9.2h-3"/>')],
  ricoSheet:['#1F7A4D', SF('<path d="M12 3.4c.7 4.9 3.7 7.9 8.6 8.6-4.9.7-7.9 3.7-8.6 8.6-.7-4.9-3.7-7.9-8.6-8.6 4.9-.7 7.9-3.7 8.6-8.6Z"/>', true)],
  ricoBriefing:['#FF9F0A', SF('<circle cx="12" cy="12" r="3.6" fill="#fff" stroke="none"/><path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21M5.6 5.6l1.15 1.15M17.25 17.25l1.15 1.15M5.6 18.4l1.15-1.15M17.25 6.75l1.15-1.15"/>')],
  ricoMood:['#AF52DE', SF('<circle cx="12" cy="12" r="8.4"/><path d="M8.4 13.6a4.4 4.4 0 0 0 7.2 0"/><circle cx="9.2" cy="9.9" r="1.15" fill="#fff" stroke="none"/><circle cx="14.8" cy="9.9" r="1.15" fill="#fff" stroke="none"/>')],
  ricoStyle:['#30B0C7', SF('<path d="M5.4 4.6h13.2a2.2 2.2 0 0 1 2.2 2.2v7.6a2.2 2.2 0 0 1-2.2 2.2H12l-4.4 3.3a.5.5 0 0 1-.8-.4V16.6H5.4a2.2 2.2 0 0 1-2.2-2.2V6.8a2.2 2.2 0 0 1 2.2-2.2Z"/>', true)],
  darkMode:['#007AFF', SF('<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" fill="#fff" stroke="none"/>')],
  tables:['#32ADE6', SF('<rect x="3.6" y="4.8" width="16.8" height="14.4" rx="2.4"/><path d="M3.6 10h16.8M10 10v9.2"/>')],
  kitchenMode:['#5E5CE6', SF('<path d="M3.4 18.6 8.3 5.6h1.4l4.9 13M5.3 14h7.4"/><path d="M15.6 18.6l2.5-6.5h.8l2.5 6.5M16.6 16.2h3.8" stroke-width="1.7"/>')],
  milestones:['#FFB800', SF('<circle cx="12" cy="9.2" r="5.6"/><path d="M8.6 13.6 7.4 21l4.6-2.4 4.6 2.4-1.2-7.4"/>', true)],
  report:['#FF3B30', SF('<path d="M5.4 21V4.4"/><path d="M5.4 4.6h11.4l-2.4 4 2.4 4H5.4" fill="#fff"/>')],
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
async function setSetting(id, value){
  const before = state.settings?.[id];
  state.settings = {...(state.settings || {}), [id]:value};
  applyFeatures();
  const r = await api('settings', {method:'PUT', body:{key:id, value}});
  if(r.ok) return true;
  state.settings = {...state.settings, [id]:before};
  applyFeatures();
  toast(t('saveFailed'), 'warn');
  if(state.view === 'settings') render();
  return false;
}
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
}
function renderFeatureSettings(){
  const row = f=>`<label class="check-row preference-row has-ico"><input type="checkbox" data-feature="${f.id}" ${featureOn(f.id) ? 'checked' : ''}>${setIcon(f.id)}<span>${esc(t('feat_' + f.id))}<small>${esc(t('feat_' + f.id + '_hint'))}</small></span></label>`;
  return SETTING_GROUPS.map(group=>{
    const rows = SETTINGS.filter(f=>f.group === group && (!f.role || canOpen(f.role))).map(row).join('');
    const extra = group === 'rico' && canOpen('assistant') ? `<div class="field feature-select"><div class="set-head">${setIcon('ricoStyle')}<label for="ricoStyleSel">${esc(t('styleLabel'))}</label></div><select id="ricoStyleSel">${CHOICES.ricoStyle.map(v=>`<option value="${v}" ${ricoStyle() === v ? 'selected' : ''}>${esc(t('style_' + v))}</option>`).join('')}</select></div>` : '';
    if(!rows && !extra) return '';
    return `<div class="section-title">${esc(t('settingsGroup_' + group))}</div><div class="form-card">${group === 'look' ? renderAppearanceRow() : ''}${rows}${extra}</div>`;
  }).join('');
}
function attachFeatureSettings(){
  document.querySelectorAll('[data-feature]').forEach(box=>box.onchange = async ()=>{
    if(!(await setFeature(box.dataset.feature, box.checked))) box.checked = !box.checked;
    if(box.dataset.feature === 'tables' && state.view !== 'settings') render();
  });
  const style = document.getElementById('ricoStyleSel');
  if(style) style.onchange = ()=>setSetting('ricoStyle', style.value);
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
