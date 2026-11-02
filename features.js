/* Features people can turn off in Settings. Each person's choice is kept on their own device, per account;
   a feature with no choice yet uses its default here. Small touches have no switch. */
const FEATURES = [
  {id:'tables', on:true},
  {id:'swipe', on:true},
  {id:'forgot', on:true},
  {id:'oddOrder', on:true},
  {id:'itemPhotos', on:true},
  {id:'holdSend', on:false},
  {id:'sendCancel', on:true},
  {id:'tapSound', on:false},
  {id:'kitchenMode', on:false},
  {id:'ricoBriefing', on:true, role:'assistant'},
  {id:'ricoSheet', on:true, role:'assistant'},
  {id:'ricoSpeak', on:false, role:'assistant'},
  {id:'ricoMood', on:true, role:'assistant'},
  {id:'milestones', on:true},
];
const featureKey = id=>`feature:${state.account || ''}:${id}`;
function featureOn(id){
  const saved = lget(featureKey(id));
  return typeof saved === 'boolean' ? saved : !!FEATURES.find(f=>f.id === id)?.on;
}
function setFeature(id, on){ lset(featureKey(id), on); applyFeatures(); }
/* Features that change the whole page are classes on <html>. */
function applyFeatures(){
  document.documentElement.classList.toggle('kitchen-mode', featureOn('kitchenMode'));
}
function renderFeatureSettings(){
  const shown = FEATURES.filter(f=>!f.role || canOpen(f.role));
  return `<div class="section-title">${esc(t('featuresTitle'))}</div><p class="settings-hint">${esc(t('featuresHint'))}</p><div class="form-card">${shown.map(f=>`<label class="check-row preference-row"><input type="checkbox" data-feature="${f.id}" ${featureOn(f.id) ? 'checked' : ''}><span>${esc(t('feat_' + f.id))}<small>${esc(t('feat_' + f.id + '_hint'))}</small></span></label>`).join('')}</div>`;
}
function attachFeatureSettings(){
  document.querySelectorAll('[data-feature]').forEach(box=>box.onchange = ()=>setFeature(box.dataset.feature, box.checked));
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
