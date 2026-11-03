/* Settings belong to the account: changing them on Yunis's account changes them for Yunis on every
   phone. They are saved on the server (app_accounts.settings) and come back with the start-up data.
   Notifications stay with each phone, since each phone signs up for them itself.
   A setting with no saved choice uses its default here. */
const SETTINGS = [
  {id:'swipe', group:'order', on:true},
  {id:'showLastQty', group:'order', on:false},
  {id:'compactRows', group:'order', on:false},
  {id:'soundQty', group:'order', on:true},
  {id:'soundSent', group:'order', on:true},
  {id:'ricoSheet', group:'rico', on:true, role:'assistant'},
  {id:'ricoBriefing', group:'rico', on:true, role:'assistant'},
  {id:'ricoMood', group:'rico', on:true, role:'assistant'},
  {id:'tables', group:'look', on:false},
  {id:'kitchenMode', group:'look', on:false},
  {id:'milestones', group:'look', on:true},
];
const CHOICES = {darkMode:['auto', 'on', 'off'], ricoStyle:['normal', 'short', 'warm']};
const SETTING_GROUPS = ['order', 'rico', 'look'];

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
  const row = f=>`<label class="check-row preference-row"><input type="checkbox" data-feature="${f.id}" ${featureOn(f.id) ? 'checked' : ''}><span>${esc(t('feat_' + f.id))}<small>${esc(t('feat_' + f.id + '_hint'))}</small></span></label>`;
  return SETTING_GROUPS.map(group=>{
    const rows = SETTINGS.filter(f=>f.group === group && (!f.role || canOpen(f.role))).map(row).join('');
    const extra = group === 'rico' && canOpen('assistant') ? `<div class="field feature-select"><label for="ricoStyleSel">${esc(t('styleLabel'))}</label><select id="ricoStyleSel">${CHOICES.ricoStyle.map(v=>`<option value="${v}" ${ricoStyle() === v ? 'selected' : ''}>${esc(t('style_' + v))}</option>`).join('')}</select></div>` : '';
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
