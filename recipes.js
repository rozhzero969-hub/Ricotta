/* Recipes: the minibar's recipe book (Ahmad's tabs).
   Two bottom tabs: Recipes, and Items (the app's views 'recipes' and 'recipeItems'). Ahmad adds each item
   once, linked to a stock item in Ricotta Restaurant; Items shows its last price paid in plain sizes
   (2,250 IQD / kg), A to Z. A recipe is its name, a group Ahmad makes himself (Cakes, Smoothies...),
   its menu price, its items with amounts, steps and notes. Recipes are listed by group, A to Z.
   Its cost works itself out from the last price paid for each stock item (_shared/recipe-cost.js, the
   same rules the API uses for the alerts), rounded to the nearest 250 IQD. A recipe with an item that has
   no price yet shows no cost at all, and says which one.
   Hold a recipe or an item (right-click on a computer) for its menu: edit or delete. Photos: tap or hold
   one to view or delete it, hold and drag to change their order (the first is the cover).
   Saves carry a version, so one phone can't overwrite another one's edits. Nothing here changes stock. */
const recipeBook = {account:null, data:null, ctx:null, stockBy:null, loading:false, error:false, page:'list', id:null,
  editing:null, dirty:false, saving:false, saveJob:null, prices:null, pricesBusy:false, pricesPoll:null, timer:null, query:'', ingQuery:'',
  group:'', photos:null, fresh:new Set()};
const rt = k=>t('recipe_' + k);
const RC = ()=>globalThis.RicottaRecipeCost;

function recipeReset(){
  clearTimeout(recipeBook.timer);
  clearTimeout(recipeBook.pricesPoll);
  Object.assign(recipeBook, {account:state.account, data:null, ctx:null, stockBy:null, loading:false, error:false, page:'list', id:null,
    editing:null, dirty:false, saving:false, saveJob:null, query:'', ingQuery:'', group:'', photos:null, fresh:new Set()});
}
const recipeOnScreen = ()=>state.view === 'recipes' || state.view === 'recipeItems';
async function recipeLoad(){
  if(recipeBook.account !== state.account) recipeReset();
  if(recipeBook.loading) return;
  recipeBook.loading = true;
  const account = state.account, r = await api('recipes');
  if(account !== state.account) return;
  recipeBook.loading = false;
  recipeBook.error = !r.ok && !recipeBook.data;
  if(r.ok){ recipeBook.data = r.data; recipeBook.ctx = null; recipeBook.stockBy = null; }
  if(r.ok && !recipeBook.prices) recipePricesLoad();
  // While a recipe is being written the page is not drawn again (that would take the cursor away):
  // the new costs show as soon as it is saved or left.
  if(recipeOnScreen() && !recipeBook.editing) render();
}

/* ---------- Costs, from the same rules as the API ---------- */
function recipeCtx(){
  const d = recipeBook.data;
  return recipeBook.ctx ||= RC().context({ingredients:d.ingredients, titems:d.stock, units:d.units, prices:d.prices, catalog:d.stock.length > 0});
}
/* A saved recipe's cost is worked out once per load (the list and its search reuse it); the recipe
   being written changes as it is typed, so it is always worked out again. */
let recipeCostCache = {ctx:null, map:new WeakMap()};
function recipeCostOf(r){
  const ctx = recipeCtx(), min = recipeBook.data.marginMin ?? RC().MARGIN_MIN;
  if(recipeCostCache.ctx !== ctx) recipeCostCache = {ctx, map:new WeakMap()};
  if(r === recipeBook.editing) return RC().recipeCost(r, ctx, min);
  let c = recipeCostCache.map.get(r);
  if(!c){ c = RC().recipeCost(r, ctx, min); recipeCostCache.map.set(r, c); }
  return c;
}
const recipeIngredient = id=>recipeBook.data?.ingredients.find(x=>x.id === id);
const recipeCurrent = ()=>recipeBook.data?.recipes.find(x=>x.id === recipeBook.id);
function recipeStock(name){
  if(!recipeBook.stockBy) recipeBook.stockBy = new Map((recipeBook.data?.stock || []).map(s=>[s.name, s]));
  return recipeBook.stockBy.get(name) || null;
}
const recipeQty = n=>Number(Number(n).toFixed(3)).toLocaleString('en-US', {maximumFractionDigits:3});
const recipeUnit = id=>recipeCtx().unit(id) || '';
// Kept left to right inside Kurdish and Arabic text, so it reads 6,000 IQD and never IQD 6,000.
const recipeLtr = s=>'⁦' + s + '⁩';
/* A rounded amount (costs, prices, profit): 6,000 IQD. */
function recipeMoney(n){
  if(n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  return recipeLtr(Math.round(Number(n)).toLocaleString('en-US') + ' IQD');
}
/* A plain number, no currency (the big numbers on a recipe's card). */
const recipeNum = n=>recipeLtr(Math.round(Number(n) || 0).toLocaleString('en-US'));
/* An exact amount for the breakdown: small prices keep their decimals (0.45 IQD a gram). */
function recipeExact(n){
  if(n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  const v = Number(n), a = Math.abs(v);
  return recipeLtr(v.toLocaleString('en-US', {maximumFractionDigits:a < 10 ? 2 : a < 100 ? 1 : 0}) + ' IQD');
}
// 14 Nov (the year only when it is not this year).
const recipeDay = day=>day ? formatIraqDateTime(day + 'T12:00:00Z', {day:'numeric', month:'short', ...(day.slice(0, 4) === new Date().toISOString().slice(0, 4) ? {} : {year:'numeric'})}) : '';
/* An item's last price in plain sizes: [{text}] like "1 kg = 4,000 IQD", "1 g = 4 IQD". */
function recipeSizes(p){
  return RC().unitPrices(p).map(u=>rt('eq')(u.unit === 'other' ? u.name : rt('size')(u.unit), u.unit === 'kg' || u.unit === 'l' ? recipeMoney(u.amount) : recipeExact(u.amount)));
}
/* The short price for a row: "2,250 / kg". */
function recipePriceShort(p){
  const u = RC().unitPrices(p)[0];
  if(!u) return '';
  const size = u.unit === 'other' ? u.name : rt('size')(u.unit), n = Number(u.amount), a = Math.abs(n);
  return recipeLtr(n.toLocaleString('en-US', {maximumFractionDigits:a < 10 ? 2 : a < 100 ? 1 : 0})) + ' / ' + size;
}
/* A stock item's name the way Ricotta Restaurant writes it ("Almarai Milk - شیری ئەلمەراعی"): only the
   part in the app's language, so the same name never shows twice. */
function recipeStockName(name){
  const parts = String(name || '').split(' - ').map(x=>x.trim()).filter(Boolean);
  if(parts.length < 2) return String(name || '');
  const rtlPart = parts.find(x=>/[؀-ۿ]/.test(x)), latin = parts.find(x=>!/[؀-ۿ]/.test(x));
  return (state.lang === 'en' ? latin : rtlPart) || parts[0];
}
/* The stock items a recipe uses that are out or low in Main Storage. */
function recipeStockIssues(r){
  const out = new Map();
  for(const l of r.data.lines || []){
    const ing = recipeIngredient(l.ingredient), s = ing && recipeStock(ing.stock_item);
    if(s && (s.state === 'empty' || s.state === 'low')) out.set(s.name, s.state);
  }
  return [...out];
}
/* Why a line has no cost, in a few words. */
function recipeWhy(l){
  if(l.status === 'amount') return rt('whyAmount');
  if(l.status === 'link') return rt('whyLink');
  if(l.status === 'gone') return rt('whyGone');
  if(l.status === 'unit') return rt('whyUnit')(l.unit, l.base);
  if(l.status === 'buyUnit') return rt('whyBuyUnit')(l.boughtIn, l.base);
  if(l.status === 'usd') return rt('whyUsd');
  return rt('whyPrice');
}
const recipeNoPrice = p=>!['amount', 'unit'].includes(p.status);
/* The plain note for a recipe without a cost: which item has no price yet, or needs its amount. */
function recipeMissingNote(c){
  if(!c.lines.length) return rt('noLinesNote');
  const names = list=>list.map(p=>recipeLtr(p.name || rt('missing')));
  const join = list=>list.length === 1 ? list[0] : rt('and')(list.slice(0, -1).join(rt('comma')), list.at(-1));
  const price = c.problems.filter(recipeNoPrice), amount = c.problems.filter(p=>p.status === 'amount'), unit = c.problems.filter(p=>p.status === 'unit');
  const out = [];
  if(price.length) out.push(rt('noPriceNote')(join(names(price.slice(0, 3))), price.length));
  if(amount.length) out.push(rt('noAmountNote')(join(names(amount.slice(0, 3)))));
  if(unit.length) out.push(rt('unitNote')(join(names(unit.slice(0, 3)))));
  return out.join(' ');
}
/* One short line on how a recipe stands, with its colour. */
function recipeState(c){
  if(!c.lines.length) return {tone:'gray', text:rt('stEmpty')};
  if(!c.complete){
    const p = c.problems.find(recipeNoPrice) || c.problems[0];
    return {tone:'amber', text:recipeNoPrice(p) ? rt('stNoPrice')(recipeLtr(p.name || rt('missing')), c.problems.length - 1) : rt('stAmount')(recipeLtr(p.name || rt('missing')))};
  }
  if(c.state === 'loss') return {tone:'red', text:rt('stLoss')};
  if(c.state === 'low') return {tone:'amber', text:rt('stLow')(recipeLtr(c.margin + '%'))};
  if(c.state === 'ok') return {tone:'green', text:rt('stProfit')(recipeLtr(c.margin + '%'))};
  return {tone:'gray', text:rt('stNoMenuPrice')};
}
function recipeLetter(name){ return ([...String(name || '').trim()][0] || '?').toLocaleUpperCase(); }
/* Each group keeps one colour (pink, blue, yellow, green, purple), worked out from its name. */
function recipeHue(name){
  const k = recipeCatKey(name);
  if(!k) return 'g5';
  let h = 0;
  for(const ch of k) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return 'g' + (h % 5);
}
/* The recipe's first photo, or a coloured tile with its first letter (never a made-up picture). */
function recipeThumb(r, cls){
  const url = recipeBook.data.covers?.[r.id], letter = recipeLetter(r.name), hue = recipeHue(r.data?.category);
  return url ? `<img class="${cls} ${hue}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-letter="${esc(letter)}">`
    : `<span class="${cls} rc-letter ${hue}" aria-hidden="true">${esc(letter)}</span>`;
}
const recipeStockBadge = st=>st === 'empty' ? `<span class="rc-badge red">${esc(rt('out'))}</span>` : st === 'low' ? `<span class="rc-badge amber">${esc(rt('low'))}</span>` : '';
/* Cards, rows and lines come in one after another (a short stagger), only the first time they show. */
const recipeDelay = i=>`style="--i:${Math.min(i, 14)}"`;

/* ---------- Saving ---------- */
function recipeNew(group = ''){
  recipeBook.editing = {id:crypto.randomUUID(), name:'', version:0, data:{category:group, price:null, currency:'IQD', lines:[], steps:[''], notes:''}};
  recipeBook.dirty = false;
  recipeShow();
}
function recipeEdit(r){
  const copy = structuredClone(r);
  const d = copy.data || {};
  copy.data = {category:d.category || '', price:d.price ?? null, currency:'IQD', lines:Array.isArray(d.lines) ? d.lines : [], steps:Array.isArray(d.steps) && d.steps.length ? d.steps : [''], notes:d.notes || ''};
  recipeBook.editing = copy;
  recipeBook.dirty = false;
  recipeShow();
}
/* Recipes and their pages are on the Recipes tab: a recipe opened from Items goes there. */
function recipeShow(){
  if(state.view !== 'recipes' && canOpen('recipes')){ goView('recipes'); return; }
  render();
  recipeTop();
}
function recipeTop(){ document.getElementById('mainContent')?.scrollTo?.({top:0}); window.scrollTo({top:0}); }
async function recipeSave(loud = false){
  if(recipeBook.saveJob){ const ok = await recipeBook.saveJob; if(!ok) return false; return recipeBook.dirty ? recipeSave(loud) : true; }
  const job = recipePerformSave(loud);
  recipeBook.saveJob = job;
  try{ return await job; } finally { if(recipeBook.saveJob === job) recipeBook.saveJob = null; }
}
const recipeEditable = r=>JSON.stringify({name:r.name, data:r.data});
/* Saving while typing stays quiet; loud (Done, leaving) says what is wrong. */
async function recipePerformSave(loud = false){
  const r = recipeBook.editing;
  if(!r || !recipeBook.dirty) return true;
  if(recipeBook.saving) return false;
  if(!r.name.trim()){ if(loud) toast(rt('required'), 'error'); recipeSaveLabel(rt('unsaved')); return false; }
  recipeBook.saving = true;
  recipeSaveLabel(rt('saving'), 'busy');
  const account = state.account, sent = recipeEditable(r), answer = await api('recipes/' + r.id, {method:'PUT', body:{name:r.name, data:r.data, version:r.version}});
  if(account !== state.account) return false;
  recipeBook.saving = false;
  if(!answer.ok){
    const e = answer.data?.error;
    toast(e === 'recipe_conflict' ? rt('conflict') : e === 'invalid_ingredients' ? rt('badLines') : t('saveFailed'), 'error');
    recipeSaveLabel(rt('unsaved'));
    return false;
  }
  const saved = answer.data, list = recipeBook.data.recipes, i = list.findIndex(x=>x.id === saved.id);
  if(i < 0) list.unshift(saved); else list[i] = saved;
  if(recipeBook.editing?.id === saved.id){
    recipeBook.editing.version = saved.version;
    // Typing while the request was on its way starts the next save.
    recipeBook.dirty = recipeEditable(recipeBook.editing) !== sent;
  }
  recipeBook.id = saved.id;
  recipeSaveLabel(recipeBook.dirty ? rt('unsaved') : rt('saved'), recipeBook.dirty ? '' : 'done');
  if(recipeBook.dirty) recipeSchedule();
  return true;
}
function recipeSaveLabel(s, tone = ''){ const el = document.getElementById('rcSaveState'); if(el){ el.textContent = s; el.dataset.tone = tone; } }
function recipeSchedule(){ clearTimeout(recipeBook.timer); recipeSaveLabel(rt('unsaved')); recipeBook.timer = setTimeout(recipeSave, 1100); }
function recipeChange(){ recipeBook.dirty = true; recipeSchedule(); }

let recipeFieldCounter = 0;
function recipeField(label, html, hint = ''){
  const existing = html.match(/\bid="([^"]+)"/), id = existing ? existing[1] : 'rcField' + (++recipeFieldCounter);
  if(!existing) html = html.replace(/^<(input|textarea|select)\b/, '<$1 id="' + id + '"');
  return `<div class="field rc-field"><label for="${id}">${esc(label)}</label>${html}${hint ? `<p class="field-hint">${esc(hint)}</p>` : ''}</div>`;
}
/* Groups are Ahmad's own: the ones his recipes use, A to Z. One spelling per group: "cakes" and
   "Cakes " are the same. */
const recipeCatKey = c=>foldText(String(c || '').trim());
function recipeGroupNames(){
  const by = new Map();
  for(const r of recipeBook.data.recipes){ const v = String(r.data?.category || '').trim(), k = recipeCatKey(v); if(k && !by.has(k)) by.set(k, v); }
  return [...by.values()].sort((a, b)=>a.localeCompare(b, state.lang));
}
/* Rows in groups, A to Z, each group A to Z inside, with the ones that have none last. */
function recipeGroups(rows, catOf, nameOf){
  const by = new Map();
  for(const row of rows){
    const k = recipeCatKey(catOf(row));
    if(!by.has(k)) by.set(k, {name:String(catOf(row) || '').trim(), rows:[]});
    by.get(k).rows.push(row);
  }
  const groups = [...by.entries()].sort(([a, x], [b, y])=>!a - !b || x.name.localeCompare(y.name, state.lang)).map(([, g])=>g);
  groups.forEach(g=>g.rows.sort((a, b)=>String(nameOf(a)).localeCompare(String(nameOf(b)), state.lang)));
  return groups;
}

/* ---------- Pages ---------- */
function renderRecipes(){
  if(recipeBook.account !== state.account) recipeReset();
  if(!recipeBook.data){
    if(!recipeBook.loading && !recipeBook.error) recipeLoad();
    return recipeBook.error ? `<div class="rc-page">${recipeEmpty('oops', t('loadFailed'), '', 'rcRetry', t('retry'))}</div>` : `<div class="rc-page">${loadingLines(5)}</div>`;
  }
  if(state.view === 'recipeItems') return `<div class="rc-page rc-items-page">${recipeIngredientsPage()}</div>`;
  if(recipeBook.editing) return recipeEditorPage();
  const r = recipeBook.page === 'detail' && recipeCurrent();
  if(r) return recipeDetailPage(r);
  recipeBook.page = 'list';
  return `<div class="rc-page">${recipeListPage()}</div>`;
}
function recipeSearchBox(id, value, label){
  return `<label class="rc-search">${ICON_SEARCH}<input id="${id}" type="search" aria-label="${esc(label)}" placeholder="${esc(label)}" value="${esc(value)}" autocomplete="off" enterkeyhint="search"></label>`;
}
const RC_PLUS = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
/* A friendly empty page: a drawing, a title, one line and the one button that fills it. */
const RC_ART = {
  book:`<svg viewBox="0 0 120 96" aria-hidden="true"><rect class="a1" x="18" y="14" width="64" height="74" rx="12"/><rect class="a2" x="36" y="8" width="64" height="74" rx="12"/><path class="a3" d="M50 30h36M50 42h28M50 54h32"/><circle class="a4" cx="96" cy="74" r="14"/><path class="a5" d="M90 74h12M96 68v12"/></svg>`,
  items:`<svg viewBox="0 0 120 96" aria-hidden="true"><path class="a1" d="M24 36h72l-6 46a8 8 0 0 1-8 7H38a8 8 0 0 1-8-7z"/><path class="a3" d="M46 36a14 14 0 0 1 28 0"/><circle class="a2" cx="46" cy="60" r="8"/><circle class="a4" cx="72" cy="62" r="10"/></svg>`,
  search:`<svg viewBox="0 0 120 96" aria-hidden="true"><circle class="a2" cx="54" cy="44" r="26"/><path class="a3" d="M74 64l18 18"/><path class="a5" d="M44 44h20"/></svg>`,
  oops:`<svg viewBox="0 0 120 96" aria-hidden="true"><circle class="a1" cx="60" cy="48" r="34"/><path class="a3" d="M60 30v22"/><circle class="a5" cx="60" cy="64" r="3"/></svg>`,
  stock:`<svg viewBox="0 0 120 96" aria-hidden="true"><path class="a1" d="M18 40l42-24 42 24v42a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z"/><rect class="a2" x="44" y="56" width="32" height="30" rx="4"/><path class="a3" d="M44 66h32"/></svg>`,
};
function recipeEmpty(art, title, text, id, label, second = ''){
  return `<section class="rc-empty">${RC_ART[art] || RC_ART.book}<h2 dir="auto">${esc(title)}</h2>${text ? `<p dir="auto">${esc(text)}</p>` : ''}
    ${id ? `<button type="button" class="rc-cta" id="${id}">${id === 'rcRetry' ? '' : RC_PLUS}<span>${esc(label)}</span></button>` : ''}${second}</section>`;
}
function recipeAlerts(){
  const list = (recipeBook.data.alerts || []).filter(a=>!a.read);
  if(!list.length) return '';
  return `<section class="rc-card rc-alerts rc-in" aria-label="${esc(rt('alerts'))}"><div class="rc-card-head"><b>${esc(rt('alerts'))}</b><button type="button" class="rc-link" id="rcAlertsRead">${esc(rt('markRead'))}</button></div>
    ${list.slice(0, 6).map(a=>`<div class="rc-alert"><p dir="auto">${esc(a[state.lang] || a.en || '')}</p><small>${esc(timeAgo(a.at))}</small></div>`).join('')}</section>`;
}
function recipeRowsFor(){
  const q = foldText(recipeBook.query.trim()), g = recipeCatKey(recipeBook.group);
  return recipeBook.data.recipes.filter(r=>(!g || recipeCatKey(r.data.category) === g)
    && (!q || foldText(r.name + ' ' + (r.data.category || '')).includes(q))).map(r=>({r, c:recipeCostOf(r)}));
}
function recipeCard({r, c}, i){
  const st = recipeState(c), stock = recipeStockIssues(r).length;
  return `<button type="button" class="rc-tile rc-in" ${recipeDelay(i)} data-rc-open="${esc(r.id)}" aria-haspopup="menu">
    ${recipeThumb(r, 'rc-tile-pic')}
    <span class="rc-tile-text"><span class="rc-tile-name" dir="auto">${esc(r.name)}</span>
      <span class="rc-tile-state ${st.tone}" dir="auto">${esc(st.text)}</span>
      ${stock ? `<span class="rc-tile-warn">${esc(rt('stockIssues')(stock))}</span>` : ''}</span></button>`;
}
function recipeListHtml(){
  const rows = recipeRowsFor();
  if(!rows.length) return recipeEmpty('search', rt('noMatch'), rt('noMatchHint'), '', '');
  let n = 0;
  return recipeGroups(rows, row=>row.r.data.category, row=>row.r.name).map(g=>`<section class="rc-group">
    <div class="rc-group-head"><h2 dir="auto"><i class="rc-group-dot ${recipeHue(g.name)}" aria-hidden="true"></i>${esc(g.name || rt('noGroup'))}</h2><span>${esc(rt('nRecipes')(g.rows.length))}</span></div>
    <div class="rc-grid">${g.rows.map(row=>recipeCard(row, n++)).join('')}</div></section>`).join('');
}
function recipeGroupChips(){
  const names = recipeGroupNames();
  if(names.length < 2) return '';
  const chip = (v, label)=>`<button type="button" class="rc-chip${recipeCatKey(recipeBook.group) === recipeCatKey(v) ? ' on' : ''}" data-rc-group="${esc(v)}" aria-pressed="${recipeCatKey(recipeBook.group) === recipeCatKey(v)}" dir="auto">${v ? `<i class="rc-group-dot ${recipeHue(v)}" aria-hidden="true"></i>` : ''}${esc(label)}</button>`;
  return `<div class="rc-chips rc-filter" role="group" aria-label="${esc(rt('groups'))}">${chip('', rt('all'))}${names.map(v=>chip(v, v)).join('')}</div>`;
}
/* Rico, for recipes: a few questions to tap (only when Rico is on for this account). */
function recipeAskRico(list){
  if(!canOpen('assistant') || typeof ricoAsk !== 'function') return '';
  return `<section class="rc-rico rc-in"><div class="rc-rico-head">${typeof ricoFace === 'function' ? ricoFace('', 'rc-rico-face') : ICON_SPARKLE}<b>${esc(rt('askRico'))}</b></div>
    <div class="rc-chips">${list.map(q=>`<button type="button" class="rc-chip rc-ask" data-rc-ask="${esc(q)}" dir="auto">${esc(q)}</button>`).join('')}</div></section>`;
}
function recipeListPage(){
  const d = recipeBook.data;
  if(!d.recipes.length){
    const items = d.ingredients.length;
    return recipeAlerts() + recipeEmpty('book', rt('emptyRecipesT'), items ? rt('emptyRecipes') : rt('emptyRecipesNoItems'), 'rcNew', rt('addFirstRecipe'),
      items ? '' : `<button type="button" class="rc-link rc-empty-second" id="rcGoItems">${esc(rt('goItems'))}</button>`);
  }
  return `${recipeAlerts()}
    <div class="rc-tools">${recipeSearchBox('rcSearch', recipeBook.query, rt('search'))}
      <button type="button" class="rc-plus" id="rcNew" aria-label="${esc(rt('new'))}" title="${esc(rt('new'))}">${RC_PLUS}</button></div>
    ${recipeGroupChips()}
    ${!d.pricesReady ? `<p class="rc-banner amber">${esc(rt('pricesOff'))}</p>` : ''}
    <div id="rcList">${recipeListHtml()}</div>
    ${recipeAskRico(t('recipe_ricoChips'))}
    <p class="rc-hint">${esc(rt('holdHint')(recipeTouch()))}</p>`;
}
const recipeTouch = ()=>!matchMedia('(hover: hover) and (pointer: fine)').matches;

/* The money card: an animated ring for the margin, and what it costs, sells for and keeps. */
function recipeCostCard(c, live){
  const attrs = live ? ' id="rcLive" aria-live="polite"' : '';
  const why = `<button type="button" class="rc-why-btn" data-rc-why>${esc(rt('whyNumbers'))}</button>`;
  if(!c.complete){
    return `<section class="rc-money is-missing rc-in"${attrs}><div class="rc-money-missing"><i class="rc-warn-ico" aria-hidden="true">!</i><p dir="auto">${esc(recipeMissingNote(c))}</p></div>
      ${c.price ? `<div class="rc-money-rows"><span>${esc(rt('sellsFor'))}<b>${esc(recipeMoney(c.price))}</b></span></div>` : ''}${why}</section>`;
  }
  const tone = c.state === 'loss' ? 'red' : c.state === 'low' ? 'amber' : c.state === 'ok' ? 'green' : 'gray';
  const pct = c.margin !== null ? Math.max(0, Math.min(100, c.margin)) : 0, dash = 264, off = Math.round(dash - dash * pct / 100);
  const notes = [];
  if(!c.price) notes.push(rt('addPriceNote'));
  if(c.losing) notes.push(rt('lossNote'));
  if(c.low) notes.push(rt('lowNote')(recipeLtr((recipeBook.data.marginMin ?? RC().MARGIN_MIN) + '%')));
  if(c.suggested) notes.push(rt('suggested')(recipeMoney(c.suggested), RC().SUGGEST_TIMES));
  return `<section class="rc-money ${tone} rc-in"${attrs}>
    <div class="rc-money-top"><div class="rc-ring" role="img" aria-label="${esc(c.margin !== null ? rt('marginIs')(c.margin + '%') : rt('noMenuPriceYet'))}">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="rc-ring-bg" cx="50" cy="50" r="42"/><circle class="rc-ring-fg" cx="50" cy="50" r="42" style="--off:${off}" transform="rotate(-90 50 50)"/></svg>
        <span>${c.margin !== null ? esc(recipeLtr(c.margin + '%')) : '–'}</span></div>
      <div class="rc-money-rows">
        <span>${esc(rt('costs'))}<b>${esc(recipeMoney(c.cost))}</b></span>
        <span>${esc(rt('sellsFor'))}<b>${c.price ? esc(recipeMoney(c.price)) : `<em>${esc(rt('noPriceShort'))}</em>`}</b></span>
        <span class="keep">${esc(rt('weKeep'))}<b>${c.profit !== null ? esc(recipeMoney(c.profit)) : `<em>${esc(rt('noPriceShort'))}</em>`}</b></span></div></div>
    ${notes.length ? `<ul class="rc-money-notes">${notes.map(n=>`<li dir="auto">${esc(n)}</li>`).join('')}</ul>` : ''}${why}</section>`;
}
function recipeLineHtml(l, i){
  const ing = recipeIngredient(l.ingredient), s = ing ? recipeStock(ing.stock_item) : null;
  const qty = Number(l.qty) > 0 ? recipeLtr(`${recipeQty(l.qty)} ${l.unit}`) : '';
  const cost = l.status === 'ok' ? `<b>${esc(recipeExact(l.cost))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
  return `<div class="rc-line rc-in" ${recipeDelay(i + 2)}><span class="rc-line-name" dir="auto">${esc(l.name || rt('missing'))}${recipeStockBadge(s?.state)}</span>
    ${qty ? `<span class="rc-qty">${esc(qty)}</span>` : ''}<span class="rc-line-cost">${cost}</span></div>`;
}
function recipePhotosHtml(r, photos){
  if(!photos?.list) return `<p class="rc-quiet">${esc(photos?.failed ? t('loadFailed') : t('loading'))}</p>`;
  if(!photos.list.length) return `<button type="button" class="rc-photo-add-big" data-rc-photo-add>${ICON_CAMERA}<span>${esc(rt('addPhotoBig'))}</span></button>`;
  return `<div class="rc-photos" id="rcPhotos">${photos.list.map((p, i)=>`<button type="button" class="rc-photo" data-rc-photo="${esc(p.id)}" aria-haspopup="menu" aria-label="${esc(rt('photoN')(i + 1))}"><img src="${esc(p.url || '')}" loading="lazy" alt="" draggable="false">${i === 0 ? `<span class="rc-cover">${esc(rt('cover'))}</span>` : ''}</button>`).join('')}
    ${photos.list.length < 8 ? `<button type="button" class="rc-photo rc-photo-plus" data-rc-photo-add aria-label="${esc(rt('addPhoto'))}">${RC_PLUS}</button>` : ''}</div>
    ${photos.list.length > 1 ? `<p class="rc-hint">${esc(rt('photoOrderHint'))}</p>` : ''}`;
}
function recipeDetailPage(r){
  const d = r.data, c = recipeCostOf(r), hue = recipeHue(d.category);
  const photos = recipeBook.photos?.id === r.id ? recipeBook.photos : null;
  const steps = (d.steps || []).filter(s=>s.trim());
  return `<div class="rc-page rc-detail">
    <header class="rc-hero ${hue}">
      <div class="rc-hero-bar"><button type="button" class="rc-round" id="rcBack" aria-label="${esc(rt('backToRecipes'))}">${ICON_BACK}</button>
        <button type="button" class="rc-pill-btn" id="rcEdit">${ICON_EDIT}<span>${esc(rt('edit'))}</span></button></div>
      <div class="rc-hero-main">${recipeThumb(r, 'rc-hero-pic rc-pop')}<div class="rc-hero-text">
        ${d.category ? `<span class="rc-tag" dir="auto">${esc(d.category)}</span>` : ''}<h2 dir="auto">${esc(r.name)}</h2>
        ${d.price ? `<p>${esc(rt('onMenuFor')(recipeMoney(d.price)))}</p>` : ''}</div></div></header>
    ${recipeCostCard(c)}
    <section class="rc-block"><h3>${esc(rt('ingredients'))}<span>${c.lines.length || ''}</span></h3>
      ${c.lines.map((l, i)=>recipeLineHtml(l, i)).join('') || `<p class="rc-quiet">${esc(rt('noLines'))}</p>`}</section>
    <section class="rc-block"><h3>${esc(rt('steps'))}</h3>
      ${steps.map((s, i)=>`<div class="rc-step rc-in" ${recipeDelay(i + 3)}><span>${i + 1}</span><p dir="auto">${esc(s)}</p></div>`).join('') || `<p class="rc-quiet">${esc(rt('noSteps'))}</p>`}</section>
    ${d.notes ? `<section class="rc-block rc-notes"><h3>${esc(rt('notes'))}</h3><p dir="auto">${esc(d.notes)}</p></section>` : ''}
    <section class="rc-block"><h3>${esc(rt('photos'))}</h3><input type="file" id="rcPhoto" accept="image/*" hidden>${recipePhotosHtml(r, photos)}</section>
    ${recipeAskRico([rt('askCheaper')(r.name), rt('askPrice')(r.name)])}
    <p class="rc-hint">${esc(rt('edited')(accountLabel(r.updated_by) || '', formatIraqDateTime(r.updated_at, {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})))}</p></div>`;
}

/* ---------- How it adds up (Where do these numbers come from?) ----------
   One small card per item: what was used, the price per gram, millilitre or piece, and what it costs,
   with the last price paid under it. Then the sum, step by step, down to what we keep. */
function recipeWhySheet(r){
  const c = recipeCostOf(r), ctx = recipeCtx();
  const lines = c.lines.map((l, i)=>{
    const p = l.stockItem ? ctx.price(l.stockItem) : null, ok = p && !p.error && p.currency === 'IQD';
    const sizes = ok ? recipeSizes(p) : [];
    const used = Number(l.qty) > 0 ? recipeLtr(recipeQty(l.qty) + ' ' + l.unit) : '';
    return `<div class="rc-why-card rc-in" ${recipeDelay(i)}>
      <div class="rc-why-top"><b dir="auto">${esc(l.name || rt('missing'))}</b>${l.status === 'ok' ? `<span class="rc-why-cost">${esc(recipeExact(l.cost))}</span>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`}</div>
      ${used ? `<div class="rc-why-math"><span>${esc(used)}</span>${ok && sizes.length ? `<i aria-hidden="true">×</i><span>${esc(sizes[sizes.length - 1])}</span>` : ''}</div>` : ''}
      ${ok ? `<p class="rc-why-paid" dir="auto">${esc(rt('paidLine')(recipeExact(p.cost), p.unit || p.base, recipeDay(p.day), p.supplier || ''))}</p>` : ''}</div>`;
  }).join('') || `<p class="rc-quiet">${esc(rt('noLines'))}</p>`;
  const step = (k, v, cls = '')=>`<div class="rc-sum-row ${cls}"><span>${esc(k)}</span><b dir="auto">${v}</b></div>`;
  const sum = c.complete ? `<div class="rc-sum">${step(rt('total'), esc(recipeExact(c.total)))}${step(rt('rounded'), esc(recipeMoney(c.cost)), 'strong')}
      ${c.price ? step(rt('sellsFor'), esc(recipeMoney(c.price))) + step(rt('weKeep'), esc(rt('minus')(recipeMoney(c.price), recipeMoney(c.cost), recipeMoney(c.profit))), 'good') + step(rt('margin'), esc(rt('divide')(recipeMoney(c.profit), recipeMoney(c.price), recipeLtr(c.margin + '%')))) : ''}</div>
      <p class="rc-hint">${esc(rt('roundNote'))}</p>`
    : `<div class="rc-money-missing"><i class="rc-warn-ico" aria-hidden="true">!</i><p dir="auto">${esc(recipeMissingNote(c))}</p></div>`;
  openKitchenSheet('rc-why-sheet', `<div class="rc-work"><div class="sel-title">${esc(rt('whyNumbers'))}</div><p class="rc-why-intro" dir="auto">${esc(rt('whyIntro'))}</p>${lines}${sum}</div>`, rt('whyNumbers'));
}

/* ---------- Writing a recipe ---------- */
/* The units a line or an item can use: only those its stock item can be measured in (its own piece,
   carton, ml...), so a wrong one can't be picked. Without a stock item (or when Manage has none of
   them) every unit is offered. */
function recipeUnitsFor(stockItem){
  const d = recipeBook.data, units = d.units, titem = stockItem ? d.stock.find(x=>x.name === stockItem) || recipeCtx().titem(stockItem) : null;
  if(!titem) return units;
  const fit = units.filter(u=>RC().factor(titem, u.en) > 0);
  return fit.length ? fit : units;
}
function recipeUnitOptions(selected, stockItem){
  const units = recipeUnitsFor(stockItem), has = units.some(u=>u.id === selected);
  return (has || !selected ? '' : `<option value="${esc(selected)}" selected>${esc(recipeUnit(selected))}</option>`)
    + (selected ? '' : `<option value="" selected disabled>${esc(rt('chooseUnit'))}</option>`)
    + units.map(u=>`<option value="${esc(u.id)}" ${u.id === selected ? 'selected' : ''}>${esc(u.en)}</option>`).join('');
}
/* The unit a new line starts with: the item's usual one when it fits, else the first that does. */
function recipeStartUnit(ing){
  const fit = recipeUnitsFor(ing.stock_item);
  return fit.some(u=>u.id === ing.unit) ? ing.unit : fit[0]?.id || ing.unit;
}
const recipeLineCost = l=>l.status === 'ok' ? `<b>${esc(recipeExact(l.cost))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
function recipeEditLine(l, i, cost){
  const ing = recipeIngredient(l.ingredient), s = ing ? recipeStock(ing.stock_item) : null;
  return `<div class="rc-eline${recipeBook.fresh.has(i) ? ' rc-in' : ''}" data-rc-line="${i}">
    <div class="rc-eline-top"><span class="rc-eline-name" dir="auto">${esc(ing?.name || rt('missing'))}${recipeStockBadge(s?.state)}</span>
      <button type="button" class="rc-x" data-rc-remove="${i}" aria-label="${esc(rt('removeLine'))}">${ICON_CLOSE_SM}</button></div>
    <div class="rc-eline-row"><input type="number" inputmode="decimal" min="0.001" max="999999" step="any" data-rc-qty="${i}" aria-label="${esc(rt('amountOf')(ing?.name || ''))}" placeholder="${esc(rt('amount'))}" value="${l.qty ?? ''}">
      <select data-rc-unit="${i}" data-inline aria-label="${esc(rt('unit'))}">${recipeUnitOptions(l.unit, ing?.stock_item)}</select>
      <span class="rc-eline-cost" data-rc-linecost="${i}">${cost}</span></div></div>`;
}
function recipeGroupPicker(value){
  const names = recipeGroupNames();
  if(value.trim() && !names.some(x=>recipeCatKey(x) === recipeCatKey(value))) names.push(value.trim());
  const on = x=>!!value.trim() && recipeCatKey(x) === recipeCatKey(value);
  return `<div class="rc-field rc-group-field"><span class="rc-label" id="rcGroupLabel">${esc(rt('group'))}</span>
    ${names.length ? `<div class="rc-chips" role="group" aria-labelledby="rcGroupLabel">${names.map(x=>`<button type="button" class="rc-chip${on(x) ? ' on' : ''}" data-rc-cat="${esc(x)}" aria-pressed="${on(x)}" dir="auto"><i class="rc-group-dot ${recipeHue(x)}" aria-hidden="true"></i>${esc(x)}</button>`).join('')}</div>` : `<p class="rc-quiet">${esc(rt('noGroupsYet'))}</p>`}
    <input id="rcNewGroup" maxlength="60" value="" dir="auto" autocomplete="off" aria-label="${esc(rt('newGroup'))}" placeholder="${esc(names.length ? rt('newGroup') : rt('newGroupFirst'))}"></div>`;
}
function recipeEditorPage(){
  const r = recipeBook.editing, d = r.data, c = recipeCostOf(r);
  const html = `<div class="rc-page rc-editor">
    <div class="rc-ebar"><button type="button" class="rc-round" id="rcEditBack" aria-label="${esc(rt('back'))}">${ICON_BACK}</button>
      <h2 dir="auto">${esc(r.version ? rt('editRecipe') : rt('new'))}</h2><span class="rc-save-state" id="rcSaveState" role="status" data-tone="${recipeBook.dirty ? '' : r.version ? 'done' : ''}">${esc(recipeBook.dirty ? rt('unsaved') : r.version ? rt('saved') : '')}</span></div>
    <section class="rc-card rc-form">
      ${recipeField(rt('menuName'), `<input id="rcName" class="rc-big-input" maxlength="120" value="${esc(r.name)}" dir="auto" autocomplete="off" enterkeyhint="next" placeholder="${esc(rt('menuNameHint'))}">`)}
      ${recipeGroupPicker(d.category)}
      ${recipeField(rt('menuPriceIqd'), `<input id="rcPrice" type="number" inputmode="numeric" min="0" step="250" value="${d.price ?? ''}" placeholder="${esc(rt('pricePlaceholder'))}">`)}
    </section>
    <h3 class="rc-etitle">${esc(rt('ingredients'))}</h3>
    <section class="rc-card rc-elines">${c.lines.map((l, i)=>recipeEditLine(d.lines[i], i, recipeLineCost(l))).join('') || `<p class="rc-quiet">${esc(recipeBook.data.ingredients.length ? rt('pickFirst') : rt('noIngredientsYet'))}</p>`}
      <button type="button" class="rc-add-line" id="rcAddLine">${ICON_PLUS}<span>${esc(rt('addIngredient'))}</span></button></section>
    ${recipeCostCard(c, true)}
    <h3 class="rc-etitle">${esc(rt('steps'))}</h3>
    <section class="rc-card rc-form">${d.steps.map((s, i)=>`<div class="rc-estep"><span class="rc-estep-n" aria-hidden="true">${i + 1}</span><textarea id="rcStep${i}" data-rc-step="${i}" maxlength="3000" rows="2" dir="auto" aria-label="${esc(rt('stepN')(i + 1))}" placeholder="${esc(rt('stepHint'))}">${esc(s)}</textarea>
        <button type="button" class="rc-x" data-rc-delstep="${i}" aria-label="${esc(rt('removeStep'))}">${ICON_CLOSE_SM}</button></div>`).join('')}
      <button type="button" class="rc-add-line" id="rcAddStep">${ICON_PLUS}<span>${esc(rt('addStep'))}</span></button></section>
    <h3 class="rc-etitle">${esc(rt('notes'))}</h3>
    <section class="rc-card rc-form"><textarea class="rc-notes-box" data-rc-field="notes" maxlength="8000" rows="3" dir="auto" aria-label="${esc(rt('notes'))}" placeholder="${esc(rt('notesHint'))}">${esc(d.notes)}</textarea></section>
    <div class="rc-done-wrap"><button type="button" class="rc-cta rc-done" id="rcDone">${ICON_CHECK}<span>${esc(rt('doneSave'))}</span></button>
      ${r.version ? `<button type="button" class="rc-link rc-danger" id="rcDeleteRecipe">${esc(rt('deleteRecipe'))}</button>` : ''}</div></div>`;
  recipeBook.fresh.clear();
  return html;
}
/* While typing: the line costs and the cost card change in place (the page isn't drawn again). */
function recipeRefreshLive(){
  const r = recipeBook.editing;
  if(!r) return;
  const c = recipeCostOf(r);
  c.lines.forEach((l, i)=>{ const el = document.querySelector(`.rc-elines [data-rc-linecost="${i}"]`); if(el) el.innerHTML = recipeLineCost(l); });
  const card = document.getElementById('rcLive');
  if(card){ card.outerHTML = recipeCostCard(c, true).replace(' rc-in"', '"'); recipeBindWhy(); }
}
/* Adding an item to a recipe: a sheet with every item A to Z and a search box (the ones the recipe
   already uses are left out), and New item at the bottom. */
function recipePickItem(onPick){
  const used = new Set(recipeBook.editing?.data.lines.map(l=>l.ingredient) || []);
  const all = [...recipeBook.data.ingredients].filter(i=>!used.has(i.id)).sort((a, b)=>a.name.localeCompare(b.name, state.lang));
  const rows = q=>{ const f = foldText(q.trim()), list = all.filter(i=>!f || foldText(i.name + ' ' + i.stock_item).includes(f));
    return list.map(i=>`<button type="button" class="rc-pick-row" data-rc-pick="${esc(i.id)}"><span class="rc-letter-sm ${recipeHue(i.name)}" aria-hidden="true">${esc(recipeLetter(i.name))}</span><span dir="auto">${esc(i.name)}</span></button>`).join('')
      || `<p class="rc-quiet">${esc(all.length ? rt('noMatch') : rt('allUsed'))}</p>`; };
  const {el, close} = openKitchenSheet('rc-pick-sheet', `<div class="rc-pick"><div class="sel-title">${esc(rt('addIngredient'))}</div>
    ${recipeSearchBox('rcPickSearch', '', rt('searchIngredients'))}<div class="rc-pick-list" id="rcPickList">${rows('')}</div>
    <button type="button" class="rc-add-line" id="rcPickNew">${ICON_PLUS}<span>${esc(rt('newIngredient'))}</span></button></div>`, rt('addIngredient'));
  const bind = ()=>el.querySelectorAll('[data-rc-pick]').forEach(b=>b.onclick = ()=>{ close(); onPick(recipeIngredient(b.dataset.rcPick)); });
  const search = el.querySelector('#rcPickSearch');
  search.oninput = ()=>{ el.querySelector('#rcPickList').innerHTML = rows(search.value); bind(); };
  el.querySelector('#rcPickNew').onclick = ()=>{ close(); recipeIngredientForm(null, ing=>onPick(ing)); };
  bind();
  if(!recipeTouch()) setTimeout(()=>search.focus({preventScroll:true}), 60);
}

/* ---------- Items (the Items tab) ---------- */
const recipeUses = id=>recipeBook.data.recipes.filter(r=>(r.data.lines || []).some(l=>l.ingredient === id)).length;
function recipeIngredientPrice(i){
  const d = recipeBook.data, s = recipeStock(i.stock_item), p = recipeCtx().price(i.stock_item);
  if(!s && d.stock.length) return {ok:false, text:rt('whyGone')};
  if(p && !p.error && p.currency === 'IQD' && p.perBase > 0) return {ok:true, p, text:recipePriceShort(p)};
  return {ok:false, text:p && p.currency !== 'IQD' ? rt('whyUsd') : p?.error ? rt('whyBuyUnit')(p.unit, p.base) : rt('noPriceYet')};
}
function recipeIngredientRow(i, n){
  const s = recipeStock(i.stock_item), price = recipeIngredientPrice(i), uses = recipeUses(i.id);
  return `<button type="button" class="rc-irow rc-in" ${recipeDelay(n)} data-rc-ingredient="${esc(i.id)}" aria-haspopup="menu">
    <span class="rc-letter-sm ${recipeHue(i.name)}" aria-hidden="true">${esc(recipeLetter(i.name))}</span>
    <span class="rc-irow-main"><span class="rc-irow-name" dir="auto">${esc(i.name)}</span><small>${esc(rt('usedIn')(uses))}${s?.state === 'empty' || s?.state === 'low' ? ' ' : ''}${recipeStockBadge(s?.state)}</small></span>
    <span class="rc-price${price.ok ? '' : ' none'}" dir="auto">${esc(price.text)}</span></button>`;
}
function recipeIngRows(){
  const q = foldText(recipeBook.ingQuery.trim());
  return [...recipeBook.data.ingredients].sort((a, b)=>a.name.localeCompare(b.name, state.lang)).filter(i=>!q || foldText(i.name + ' ' + i.stock_item).includes(q));
}
function recipeIngListHtml(){
  const rows = recipeIngRows();
  return rows.length ? `<div class="rc-ilist">${rows.map(recipeIngredientRow).join('')}</div>` : recipeEmpty('search', rt('noMatch'), rt('noMatchHint'), '', '');
}
function recipeIngredientsPage(){
  const d = recipeBook.data;
  const foot = `${!d.pricesReady ? `<p class="rc-banner amber">${esc(rt('pricesOff'))}</p>` : ''}${!d.stockAt ? `<p class="rc-banner amber">${esc(t('rrNoCatalog'))}</p>` : ''}`;
  if(!d.ingredients.length) return recipeEmpty('items', rt('emptyItemsT'), rt('emptyItems'), 'rcIngredientNew', rt('addFirstIngredient')) + foot;
  return `<div class="rc-tools">${recipeSearchBox('rcIngSearch', recipeBook.ingQuery, rt('searchIngredients'))}
      <button type="button" class="rc-plus" id="rcIngredientNew" aria-label="${esc(rt('newIngredient'))}" title="${esc(rt('newIngredient'))}">${RC_PLUS}</button></div>
    ${recipePricesBar()}
    <div id="rcIngList">${recipeIngListHtml()}</div>
    ${recipeAskRico(t('recipe_ricoItemChips'))}
    <p class="rc-hint">${esc(rt('ingredientsNote'))} ${esc(rt('holdHintIng')(recipeTouch()))}</p>${foot}`;
}
/* Add or change an item: its name, the stock item it is (suggested from the name, with a warning when
   the names don't look alike: a warning only, Ahmad decides) and the unit new lines start with (only the
   stock item's own units). The stock item's last price shows as soon as it is chosen. */
function recipeIngredientForm(id, onSaved){
  const d = recipeBook.data, old = recipeIngredient(id), stock = [...d.stock].sort((a, b)=>a.name.localeCompare(b.name));
  const used = old && recipeUses(old.id) > 0;
  showFormModal({title:esc(old ? rt('editIngredient') : rt('newIngredient')),
    bodyHtml:recipeField(rt('ingredientName'), `<input id="rcIngName" maxlength="120" value="${esc(old?.name || '')}" dir="auto" autocomplete="off" placeholder="${esc(rt('ingredientNameHint'))}">`)
      + recipeField(rt('stockItem'), `<select id="rcIngStock"><option value="" ${old ? '' : 'selected'} disabled>${esc(rt('chooseStock'))}</option>${stock.map(s=>`<option value="${esc(s.name)}" ${s.name === old?.stock_item ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}${old && !stock.some(s=>s.name === old.stock_item) ? `<option value="${esc(old.stock_item)}" selected>${esc(old.stock_item)}</option>` : ''}</select>`)
      + `<div class="rc-sug" id="rcIngSug" aria-live="polite"></div><p class="field-hint rc-warn-hint" id="rcIngWarn"></p><div class="rc-ing-price" id="rcIngPrice" aria-live="polite"></div>`
      + recipeField(rt('usualUnit'), `<select id="rcIngUnit">${recipeUnitOptions(old?.unit || '', old?.stock_item)}</select>`, rt('unitsHint')),
    okLabel:t('save'),
    againLabel:old && !used ? t('delete') : '',
    onSubmit:async again=>{
      if(again){
        if(!(await showConfirm(esc(rt('deleteIngredientAsk')(old.name)), {okLabel:t('delete')}))) return {keepOpen:true};
        const r = await recipeDeleteIngredient(old);
        return r ? undefined : {error:t('saveFailed')};
      }
      const name = document.getElementById('rcIngName').value.trim(), stockItem = document.getElementById('rcIngStock').value, unit = document.getElementById('rcIngUnit').value;
      if(!name) return {error:rt('needName')};
      if(!stockItem) return {error:rt('needStock')};
      if(!unit) return {error:rt('needUnit')};
      const r = await api('recipe-ingredients/' + (old?.id || crypto.randomUUID()), {method:'PUT', body:{name, stock_item:stockItem, unit, category:old?.category || '', version:old?.version || 0}});
      if(!r.ok){ const e = r.data?.error; return {error:e === 'recipe_conflict' ? rt('conflict') : e === 'unknown_unit' ? rt('unknownUnit') : e === 'invalid_stock_link' ? rt('whyGone') : t('saveFailed')}; }
      const i = d.ingredients.findIndex(x=>x.id === r.data.id);
      if(i < 0) d.ingredients.push(r.data); else d.ingredients[i] = r.data;
      d.ingredients.sort((a, b)=>a.name.localeCompare(b.name));
      recipeBook.ctx = null;
      toast(old ? rt('ingredientSaved') : rt('ingredientAdded'));
      // A new stock item has no price in the list yet: the next load brings it.
      if(!d.prices[stockItem]) setTimeout(recipeLoad, 0);
      if(onSaved) onSaved(r.data); else render();
    }});
  setTimeout(()=>{
    const nameEl = document.getElementById('rcIngName'), sel = document.getElementById('rcIngStock'), unitEl = document.getElementById('rcIngUnit'), sug = document.getElementById('rcIngSug'), warn = document.getElementById('rcIngWarn'), priceEl = document.getElementById('rcIngPrice');
    if(!nameEl || !sel) return;
    const L = globalThis.RicottaStockLink, S = globalThis.RicottaSearch;
    let unitTouched = !!old, auto = false;
    const pick = v=>{ sel.value = v; sel.dispatchEvent(new Event('change', {bubbles:true})); };
    // Only the stock item's own units; the usual unit starts as its base unit when Manage has it.
    const fillUnits = chosen=>{
      if(!unitEl) return;
      const keep = unitEl.value, fit = recipeUnitsFor(chosen);
      unitEl.innerHTML = recipeUnitOptions(fit.some(u=>u.id === keep) ? keep : '', chosen);
      const s = stock.find(x=>x.name === chosen);
      if(!unitTouched && s && S){ const m = S.unit(fit.map(u=>u.en), s.base); const u = m && fit.find(x=>x.en === m); if(u){ auto = true; unitEl.value = u.id; auto = false; } }
      if(!unitEl.value && fit.length === 1) unitEl.value = fit[0].id;
      unitEl.dispatchEvent(new Event('change', {bubbles:true}));
    };
    const check = ()=>{
      const name = nameEl.value.trim(), chosen = sel.value;
      warn.textContent = name && chosen && L && !L.matches({name}, chosen) ? rt('nameWarn') : '';
      // Its last price, so Ahmad sees straight away what it costs.
      const p = chosen ? recipeIngredientPrice({stock_item:chosen}) : null;
      if(priceEl) priceEl.innerHTML = p ? `<span>${esc(rt('lastPrice'))}</span><b class="${p.ok ? '' : 'none'}" dir="auto">${esc(p.text)}</b>` : '';
    };
    const suggest = ()=>{
      const name = nameEl.value.trim();
      const list = name && L ? L.suggest({name}, stock, 4) : [];
      sug.innerHTML = list.length ? `<span>${esc(rt('suggestedStock'))}</span>${list.map(s=>`<button type="button" class="rc-chip${s.name === sel.value ? ' on' : ''}" data-rc-sug="${esc(s.name)}" dir="auto">${esc(recipeStockName(s.name))}</button>`).join('')}` : '';
      sug.querySelectorAll('[data-rc-sug]').forEach(b=>b.onclick = ()=>{ pick(b.dataset.rcSug); suggest(); });
      check();
    };
    nameEl.addEventListener('input', suggest);
    sel.addEventListener('change', ()=>{ fillUnits(sel.value); suggest(); });
    unitEl?.addEventListener('change', ()=>{ if(!auto) unitTouched = true; });
    if(old) fillUnits(old.stock_item);
    suggest();
    if(!old) nameEl.focus({preventScroll:true});
  }, 0);
}
async function recipeDeleteIngredient(ing){
  const d = recipeBook.data, r = await api('recipe-ingredients/' + ing.id, {method:'DELETE'});
  if(!r.ok){ toast(r.data?.error === 'ingredient_in_use' ? rt('inUse') : t('saveFailed'), 'error'); return false; }
  d.ingredients = d.ingredients.filter(x=>x.id !== ing.id);
  recipeBook.ctx = null;
  toast(rt('ingredientDeleted'));
  render();
  return true;
}
async function recipeDelete(r){
  if(!(await showConfirm(esc(rt('deleteAsk')(r.name)), {title:rt('deleteRecipe'), okLabel:t('delete')}))) return false;
  const answer = await api('recipes/' + r.id, {method:'DELETE'});
  if(!answer.ok){ toast(t('saveFailed'), 'error'); return false; }
  const d = recipeBook.data;
  d.recipes = d.recipes.filter(x=>x.id !== r.id);
  if(d.covers) delete d.covers[r.id];
  if(recipeBook.editing?.id === r.id){ clearTimeout(recipeBook.timer); recipeBook.editing = null; recipeBook.dirty = false; }
  if(recipeBook.id === r.id){ recipeBook.id = null; recipeBook.page = 'list'; }
  toast(rt('deleted'));
  render();
  return true;
}

/* ---------- Hold or right-click: a small menu (the same look as the Order screen's) ---------- */
function recipeMenu(row, actions){
  if(typeof closeContextMenu === 'function') closeContextMenu();
  const rect = row.getBoundingClientRect(), layer = document.createElement('div');
  layer.id = 'ctxLayer'; layer.className = 'ctx-layer';
  const menuH = actions.length * 44 + 16, below = rect.bottom + 12 + menuH < window.innerHeight - 40;
  const side = isRtl() ? `left:${Math.max(12, rect.left)}px` : `right:${Math.max(12, window.innerWidth - rect.right)}px`;
  layer.innerHTML = `<div class="ctx-scrim"></div>
    <div class="ctx-preview rc-ctx-preview" style="top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px"></div>
    <div class="ctx-menu ${below ? '' : 'up'}" role="menu" style="${below ? `top:${rect.bottom + 12}px` : `top:${Math.max(12, rect.top - 12 - menuH)}px`};${side}">
      ${actions.map(([a, label, icon, danger])=>`<button type="button" role="menuitem" class="${danger ? 'danger' : ''}" data-ctx="${a}"><span>${esc(label)}</span>${icon}</button>`).join('')}</div>`;
  const clone = row.cloneNode(true);
  clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  clone.classList.remove('rc-in', 'pressing');
  clone.tabIndex = -1; clone.setAttribute('aria-hidden', 'true');
  layer.querySelector('.ctx-preview').appendChild(clone);
  document.body.appendChild(layer);
  haptic('medium');
  const close = ()=>{ if(typeof closeContextMenu === 'function') closeContextMenu(); else layer.remove(); };
  layer.querySelector('.ctx-scrim').onclick = close;
  layer.addEventListener('keydown', e=>{ if(e.key === 'Escape') close(); });
  layer.querySelector('[data-ctx]')?.focus({preventScroll:true});
  layer.querySelectorAll('[data-ctx]').forEach(b=>b.onclick = ()=>{ close(); actions.find(x=>x[0] === b.dataset.ctx)?.[4](); });
}
/* Holding a row on a phone (or right-clicking it on a computer) opens its menu; the tap that ends a
   hold does not also open the row. */
function recipeHold(row, open){
  let timer = 0, x = 0, y = 0, held = false;
  const stop = ()=>{ clearTimeout(timer); row.classList.remove('pressing'); document.removeEventListener('pointermove', move); };
  const move = e=>{ if(Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8) stop(); };
  row.addEventListener('pointerdown', e=>{
    if(e.button > 0) return;
    held = false; x = e.clientX; y = e.clientY;
    if(e.pointerType !== 'mouse') row.classList.add('pressing');
    timer = setTimeout(()=>{ held = true; stop(); open(row); }, 480);
    document.addEventListener('pointermove', move, {passive:true});
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type=>row.addEventListener(type, stop));
  row.addEventListener('contextmenu', e=>{ e.preventDefault(); if(!held && !document.getElementById('ctxLayer')) open(row); });
  row.addEventListener('click', e=>{ if(held){ e.preventDefault(); e.stopImmediatePropagation(); held = false; } }, true);
}
function recipeRowMenu(row){
  const r = recipeBook.data.recipes.find(x=>x.id === row.dataset.rcOpen);
  if(!r) return;
  recipeMenu(row, [['edit', rt('edit'), ICON_EDIT, false, ()=>{ recipeBook.id = r.id; recipeEdit(r); }],
    ['delete', t('delete'), ICON_DELETE, true, ()=>recipeDelete(r)]]);
}
function recipeIngredientMenu(row){
  const ing = recipeIngredient(row.dataset.rcIngredient);
  if(!ing) return;
  const actions = [['edit', rt('edit'), ICON_EDIT, false, ()=>recipeIngredientForm(ing.id)]];
  if(!recipeUses(ing.id)) actions.push(['delete', t('delete'), ICON_DELETE, true, async ()=>{ if(await showConfirm(esc(rt('deleteIngredientAsk')(ing.name)), {okLabel:t('delete')})) recipeDeleteIngredient(ing); }]);
  recipeMenu(row, actions);
}
function recipeBindRows(root){
  root.querySelectorAll('[data-rc-open]').forEach(b=>{ b.onclick = ()=>recipeOpen(b.dataset.rcOpen); recipeHold(b, recipeRowMenu); });
  root.querySelectorAll('[data-rc-ingredient]').forEach(b=>{ b.onclick = ()=>recipeIngredientForm(b.dataset.rcIngredient); recipeHold(b, recipeIngredientMenu); });
  root.querySelectorAll('[data-rc-ask]').forEach(b=>b.onclick = ()=>{ goView('assistant'); setTimeout(()=>ricoAsk(b.dataset.rcAsk), 60); });
  recipeBindThumbs(root);
}
function recipeBindWhy(){
  document.querySelectorAll('[data-rc-why]').forEach(b=>b.onclick = ()=>{ const r = recipeBook.editing || recipeCurrent(); if(r) recipeWhySheet(r); });
}

/* ---------- Photos (on a recipe's page: the camera or a file, made smaller before it is sent) ----------
   Tap or hold a photo: View or Delete. Hold it and drag: it moves, and the others make room; the first
   one is the cover in the list. */
async function recipePhotos(){
  const account = state.account, id = recipeBook.id;
  recipeBook.photos = {id, list:null, failed:false, loading:true};
  const r = await api('recipes/' + id + '/photos');
  if(account !== state.account || recipeBook.id !== id) return;
  recipeBook.photos = {id, list:r.ok ? r.data : null, failed:!r.ok, loading:false};
  if(state.view === 'recipes' && recipeBook.page === 'detail' && !recipeBook.editing) recipePhotosRedraw();
}
function recipePhotosRedraw(){
  const r = recipeCurrent(), box = document.querySelector('#rcPhoto')?.parentElement;
  if(!r || !box){ render(); return; }
  box.querySelectorAll('.rc-photos, .rc-photo-add-big, .rc-quiet, .rc-hint').forEach(el=>el.remove());
  box.insertAdjacentHTML('beforeend', recipePhotosHtml(r, recipeBook.photos));
  recipeBindPhotos();
}
async function recipeUpload(file, id = recipeBook.id){
  if(!file) return false;
  if(file.size > 20_000_000){ toast(rt('photoTooBig'), 'error'); return false; }
  const account = state.account;
  try{
    const bmp = await window.createImageBitmap(file), ratio = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * ratio); canvas.height = Math.round(bmp.height * ratio);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const image = canvas.toDataURL('image/jpeg', .82);
    if(account !== state.account) return false;
    const r = await api('recipes/' + id + '/photos', {method:'POST', body:{image}});
    if(!r.ok){ toast(r.data?.error === 'too_many_photos' ? rt('tooManyPhotos') : rt('photoFailed'), 'error'); return false; }
    toast(rt('photoAdded'));
    // The list's tile and the photos both come again (the first photo becomes the tile).
    recipeBook.photos = null;
    await recipeLoad();
    return true;
  }catch{ toast(rt('photoFailed'), 'error'); return false; }
}
function recipePhotoView(start){
  const list = recipeBook.photos?.list || [];
  if(!list.length) return;
  let i = Math.max(0, list.findIndex(p=>p.id === start));
  const layer = document.createElement('div');
  layer.className = 'rc-viewer';
  layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-label', rt('photos'));
  const paint = ()=>{ layer.innerHTML = `<button type="button" class="rc-viewer-close" aria-label="${esc(t('rrClosePhoto'))}">${ICON_CLOSE_SM}</button>
    <img src="${esc(list[i].url || '')}" alt="">${list.length > 1 ? `<button type="button" class="rc-viewer-nav prev" aria-label="${esc(rt('prevPhoto'))}">${ICON_BACK}</button><button type="button" class="rc-viewer-nav next" aria-label="${esc(rt('nextPhoto'))}">${ICON_BACK}</button><span class="rc-viewer-count">${i + 1} / ${list.length}</span>` : ''}`;
    layer.querySelector('.rc-viewer-close').onclick = close;
    layer.querySelector('.prev')?.addEventListener('click', e=>{ e.stopPropagation(); go(-1); });
    layer.querySelector('.next')?.addEventListener('click', e=>{ e.stopPropagation(); go(1); });
  };
  const go = d=>{ i = (i + d + list.length) % list.length; paint(); };
  const key = e=>{ if(e.key === 'Escape') close(); else if(e.key === 'ArrowRight') go(isRtl() ? -1 : 1); else if(e.key === 'ArrowLeft') go(isRtl() ? 1 : -1); };
  function close(){ document.removeEventListener('keydown', key, true); layer.classList.add('out'); setTimeout(()=>layer.remove(), 220); }
  let sx = 0;
  layer.addEventListener('pointerdown', e=>{ sx = e.clientX; });
  layer.addEventListener('pointerup', e=>{ const dx = e.clientX - sx; if(Math.abs(dx) > 50 && list.length > 1) go((dx < 0 ? 1 : -1) * (isRtl() ? -1 : 1)); });
  layer.addEventListener('click', e=>{ if(e.target === layer) close(); });
  document.addEventListener('keydown', key, true);
  paint();
  document.body.appendChild(layer);
}
async function recipePhotoDelete(id){
  if(!(await showConfirm(esc(rt('deletePhoto')), {okLabel:t('delete')}))) return;
  const r = await api('recipes/' + recipeBook.id + '/photos/' + id, {method:'DELETE'});
  if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
  toast(rt('photoDeleted'));
  recipeBook.photos = null;
  recipeLoad();
}
function recipePhotoMenu(el){
  const id = el.dataset.rcPhoto;
  recipeMenu(el, [['view', rt('viewPhoto'), ICON_SEARCH, false, ()=>recipePhotoView(id)], ['delete', t('delete'), ICON_DELETE, true, ()=>recipePhotoDelete(id)]]);
}
async function recipePhotoOrder(ids){
  const p = recipeBook.photos;
  if(!p?.list) return;
  const before = p.list.map(x=>x.id);
  if(before.join() === ids.join()) return;
  p.list = ids.map(id=>p.list.find(x=>x.id === id)).filter(Boolean);
  if(recipeBook.data.covers && p.list[0]?.url) recipeBook.data.covers[recipeBook.id] = p.list[0].url;
  recipePhotosRedraw();
  const r = await api('recipes/' + recipeBook.id + '/photos/order', {method:'PUT', body:{ids}});
  if(!r.ok){ toast(t('saveFailed'), 'error'); p.list = before.map(id=>p.list.find(x=>x.id === id)).filter(Boolean); recipePhotosRedraw(); }
}
/* One gesture for each photo: a tap (or a hold that doesn't move) opens its menu; a hold that moves
   drags it. While dragging the page doesn't scroll. */
function recipeBindPhotos(){
  const box = document.getElementById('rcPhotos');
  document.querySelectorAll('[data-rc-photo-add]').forEach(b=>b.onclick = ()=>document.getElementById('rcPhoto')?.click());
  if(!box) return;
  let drag = null;
  const tiles = ()=>[...box.querySelectorAll('[data-rc-photo]')];
  box.addEventListener('touchmove', e=>{ if(drag?.lifted) e.preventDefault(); }, {passive:false});
  box.addEventListener('contextmenu', e=>{ if(e.target.closest('[data-rc-photo]')) e.preventDefault(); });
  tiles().forEach(el=>{
    el.onclick = e=>{ e.preventDefault(); };
    el.addEventListener('keydown', e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); recipePhotoMenu(el); } });
    el.addEventListener('pointerdown', e=>{
      if(e.button > 0) return;
      drag = {el, x:e.clientX, y:e.clientY, lifted:false, moved:false, id:e.pointerId};
      drag.timer = setTimeout(()=>{ if(!drag || drag.el !== el) return; drag.lifted = true; el.classList.add('lifted'); haptic('light'); try{ el.setPointerCapture(drag.id); }catch{ /* older browsers */ } }, 320);
    });
  });
  const place = e=>{
    const others = tiles().filter(x=>x !== drag.el);
    let target = null;
    for(const o of others){ const r = o.getBoundingClientRect(); if(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom){ target = o; break; } }
    if(!target) return;
    const first = new Map(tiles().map(x=>[x, x.getBoundingClientRect()]));
    const all = tiles(), from = all.indexOf(drag.el), to = all.indexOf(target);
    box.insertBefore(drag.el, from < to ? target.nextSibling : target);
    const home = drag.el.getBoundingClientRect(), was = first.get(drag.el);
    drag.ox += home.left - was.left; drag.oy += home.top - was.top;
    tiles().forEach(x=>{ if(x === drag.el) return; const a = first.get(x), b = x.getBoundingClientRect(); if(!a || (a.left === b.left && a.top === b.top)) return;
      x.animate([{transform:`translate(${a.left - b.left}px,${a.top - b.top}px)`}, {transform:'none'}], {duration:220, easing:'cubic-bezier(.23,1,.32,1)'}); });
  };
  box.addEventListener('pointermove', e=>{
    if(!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if(!drag.lifted){ if(Math.abs(dx) > 8 || Math.abs(dy) > 8){ clearTimeout(drag.timer); drag = null; } return; }
    if(!drag.moved){ drag.moved = true; drag.ox = 0; drag.oy = 0; drag.el.classList.add('dragging'); }
    drag.el.style.transform = `translate(${dx - drag.ox}px,${dy - drag.oy}px) scale(1.06)`;
    place(e);
  });
  const end = e=>{
    if(!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    clearTimeout(d.timer);
    d.el.classList.remove('lifted', 'dragging');
    if(d.moved){ d.el.style.transform = ''; recipePhotoOrder(tiles().map(x=>x.dataset.rcPhoto)); }
    else if(e.type === 'pointerup') recipePhotoMenu(d.el);
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

window.addEventListener('beforeunload', e=>{ if(recipeBook.dirty){ e.preventDefault(); e.returnValue = ''; } });

/* Leaving a recipe being written: it is saved first; when it can't be (no name, offline), Ahmad
   chooses to stay or to leave the changes. True when it may be left. */
async function recipeLeave(){
  const r = recipeBook.editing;
  if(r && recipeBook.dirty && !(r.name.trim() && await recipeSave())){
    if(!(await showConfirm(rt('discard')))) return false;
  }
  clearTimeout(recipeBook.timer);
  recipeBook.editing = null; recipeBook.dirty = false;
  return true;
}
function recipeOpen(id){
  recipeBook.id = id; recipeBook.page = 'detail';
  render();
  recipeTop();
}
/* A tile whose photo link ran out (after 15 minutes) shows its letter instead. */
function recipeBindThumbs(root){
  root.querySelectorAll('img.rc-tile-pic, img.rc-hero-pic').forEach(img=>{ img.onerror = ()=>{ const s = document.createElement('span'); s.className = img.className + ' rc-letter'; s.setAttribute('aria-hidden', 'true'); s.textContent = img.dataset.letter || '?'; img.replaceWith(s); }; });
}
/* ---------- Check all last prices (on Items) ----------
   The last price paid for every item comes from Ricotta Restaurant's invoices: Rico reads them every 15
   minutes. The button reads them now; while Rico reads, the page asks every few seconds how it is going,
   then shows the new prices. */
async function recipePricesLoad(){
  const account = state.account, r = await api('rico-prices');
  if(account !== state.account || !r.ok) return;
  recipeBook.prices = r.data;
  recipePricesFollow();
  recipePricesDraw();
}
function recipePricesDraw(){
  const bar = document.getElementById('rcPricesBar');
  if(bar) bar.outerHTML = recipePricesBar();
  const b = document.getElementById('rcPrices');
  if(b) b.onclick = recipePricesCheck;
}
function recipePricesBar(){
  const p = recipeBook.prices, busy = recipeBook.pricesBusy || !!p?.state;
  const when = p?.at ? rt('pricesAt')(timeAgo(p.at)) : p ? rt('pricesNever') : '';
  return `<div class="rc-prices" id="rcPricesBar"><span class="rc-prices-when" dir="auto">${esc(busy ? rt('pricesReading') : when)}</span>
    <button type="button" class="rc-pill-btn small" id="rcPrices" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '<i class="rr-spin" aria-hidden="true"></i>' : ICON_REFRESH}<span>${esc(rt('pricesCheck'))}</span></button></div>`;
}
async function recipePricesCheck(){
  if(recipeBook.pricesBusy || recipeBook.prices?.state) return;
  recipeBook.pricesBusy = true; recipePricesDraw();
  const account = state.account, r = await api('rico-prices', {method:'POST', body:{}});
  if(account !== state.account) return;
  recipeBook.pricesBusy = false;
  if(!r.ok){ toast(t('loadFailed'), 'error'); recipePricesDraw(); return; }
  if(r.data.prices) recipeBook.prices = r.data.prices;
  const err = r.data.error;
  if(err === 'rico_off') toast(rt('pricesRicoOff'), 'error');
  else if(err === 'rico_old') toast(rt('pricesRicoOld'), 'error');
  else if(err === 'cloud_failed') toast(rt('pricesFailed'), 'error');
  else if(!recipeBook.prices?.state){ toast(rt('pricesDone')); recipeLoad(); }
  recipePricesFollow();
  recipePricesDraw();
}
/* While Rico reads (asked or running), asks again every 3 seconds; when he is done, the prices load again. */
function recipePricesFollow(){
  clearTimeout(recipeBook.pricesPoll);
  if(!recipeBook.prices?.state) return;
  const askedAt = recipeBook.prices.askedAt;
  recipeBook.pricesPoll = setTimeout(async ()=>{
    const account = state.account, r = await api('rico-prices');
    if(account !== state.account) return;
    if(r.ok) recipeBook.prices = r.data;
    if(r.ok && !r.data.state){
      const res = r.data.result;
      if(r.data.timedOut) toast(rt('pricesRicoOff'), 'error');
      else if(res && res.ok === false) toast(rt('pricesFailed'), 'error');
      else if(r.data.doneAt && (!askedAt || r.data.doneAt >= askedAt)){ toast(rt('pricesDone')); recipeLoad(); }
    }
    recipePricesFollow();
    recipePricesDraw();
  }, 3000);
}

function attachRecipeEvents(){
  const on = (id, fn)=>{ const el = document.getElementById(id); if(el) el.onclick = fn; };
  const all = (sel, fn)=>document.querySelectorAll(sel).forEach(fn);
  recipeBindRows(document);
  recipeBindWhy();
  on('rcRetry', ()=>{ recipeBook.error = false; recipeLoad(); render(); });
  on('rcNew', ()=>recipeNew(recipeBook.group));
  on('rcGoItems', ()=>goView('recipeItems'));
  on('rcPrices', recipePricesCheck);
  on('rcBack', ()=>{ recipeBook.page = 'list'; render(); });
  all('[data-rc-group]', b=>b.onclick = ()=>{
    recipeBook.group = recipeCatKey(recipeBook.group) === recipeCatKey(b.dataset.rcGroup) ? '' : b.dataset.rcGroup;
    all('[data-rc-group]', x=>{ const v = recipeCatKey(recipeBook.group) === recipeCatKey(x.dataset.rcGroup); x.classList.toggle('on', v); x.setAttribute('aria-pressed', String(v)); });
    const list = document.getElementById('rcList');
    if(list){ list.innerHTML = recipeListHtml(); recipeBindRows(list); }
  });
  on('rcAlertsRead', async ()=>{
    const r = await api('recipes/alerts/read', {method:'POST', body:{}});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    (recipeBook.data.alerts || []).forEach(a=>{ a.read = true; });
    render();
  });
  const search = document.getElementById('rcSearch');
  if(search) search.oninput = ()=>{
    recipeBook.query = search.value;
    const list = document.getElementById('rcList');
    if(list){ list.innerHTML = recipeListHtml(); recipeBindRows(list); }
  };
  const ingSearch = document.getElementById('rcIngSearch');
  if(ingSearch) ingSearch.oninput = ()=>{
    recipeBook.ingQuery = ingSearch.value;
    const list = document.getElementById('rcIngList');
    if(list){ list.innerHTML = recipeIngListHtml(); recipeBindRows(list); }
  };
  on('rcIngredientNew', ()=>recipeIngredientForm());
  if(state.view === 'recipeItems') return;

  // A recipe's page
  const current = recipeBook.page === 'detail' && !recipeBook.editing ? recipeCurrent() : null;
  if(current && recipeBook.photos?.id !== current.id) recipePhotos();
  on('rcEdit', ()=>{ const r = recipeCurrent(); if(r) recipeEdit(r); });
  const photo = document.getElementById('rcPhoto');
  if(photo) photo.onchange = ()=>{ recipeUpload(photo.files[0]); photo.value = ''; };
  recipeBindPhotos();

  // Writing a recipe
  if(!recipeBook.editing) return;
  const r = recipeBook.editing, d = r.data;
  const redraw = ()=>{ recipeChange(); render(); };
  on('rcDone', async ()=>{
    if(!r.name.trim()){ toast(rt('required'), 'error'); const n = document.getElementById('rcName'); n?.focus(); n?.scrollIntoView({block:'center', behavior:'smooth'}); return; }
    if(!recipeBook.dirty && !r.version){ recipeBook.dirty = true; }
    if(await recipeSave(true)){ recipeBook.editing = null; recipeBook.id = r.id; recipeBook.page = 'detail'; recipeBook.photos = null; haptic('success'); toast(rt('savedToast')); render(); recipeTop(); }
  });
  on('rcEditBack', async ()=>{
    if(!(await recipeLeave())) return;
    recipeBook.page = r.version && recipeBook.data.recipes.some(x=>x.id === r.id) ? 'detail' : 'list';
    render();
  });
  on('rcDeleteRecipe', ()=>recipeDelete(r));
  const name = document.getElementById('rcName');
  if(name){ name.oninput = ()=>{ r.name = name.value; recipeChange(); }; if(!r.version && !r.name) setTimeout(()=>name.focus({preventScroll:true}), 0); }
  const newGroup = document.getElementById('rcNewGroup');
  const syncGroup = ()=>all('[data-rc-cat]', x=>{ const v = !!d.category.trim() && recipeCatKey(x.dataset.rcCat) === recipeCatKey(d.category); x.classList.toggle('on', v); x.setAttribute('aria-pressed', String(v)); });
  all('[data-rc-cat]', b=>b.onclick = ()=>{ d.category = b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.rcCat; if(newGroup) newGroup.value = ''; syncGroup(); recipeChange(); haptic('light'); });
  if(newGroup) newGroup.oninput = ()=>{ d.category = newGroup.value.trim(); syncGroup(); recipeChange(); };
  const notes = document.querySelector('[data-rc-field="notes"]');
  if(notes) notes.oninput = ()=>{ d.notes = notes.value; recipeChange(); };
  const price = document.getElementById('rcPrice');
  if(price) price.oninput = ()=>{ const v = Number(price.value); d.price = price.value.trim() && v > 0 ? Math.round(v) : null; recipeChange(); recipeRefreshLive(); };
  all('[data-rc-qty]', el=>el.oninput = ()=>{
    const v = Number(el.value);
    d.lines[Number(el.dataset.rcQty)].qty = el.value.trim() && v > 0 ? Math.round(v * 1000) / 1000 : null;
    recipeChange(); recipeRefreshLive();
  });
  all('[data-rc-unit]', el=>el.onchange = ()=>{ d.lines[Number(el.dataset.rcUnit)].unit = el.value; recipeChange(); recipeRefreshLive(); });
  all('[data-rc-step]', el=>el.oninput = ()=>{ d.steps[Number(el.dataset.rcStep)] = el.value; recipeChange(); });
  all('[data-rc-remove]', b=>b.onclick = ()=>{
    const line = b.closest('.rc-eline'), go = ()=>{ d.lines.splice(Number(b.dataset.rcRemove), 1); redraw(); };
    if(line?.animate && !reducedMotion()) line.animate([{opacity:1, transform:'none'}, {opacity:0, transform:'scale(.94)'}], {duration:160, easing:'ease-in'}).onfinish = go; else go();
  });
  all('[data-rc-delstep]', b=>b.onclick = ()=>{ d.steps.splice(Number(b.dataset.rcDelstep), 1); if(!d.steps.length) d.steps.push(''); redraw(); });
  on('rcAddStep', ()=>{ if(d.steps.length < 60){ d.steps.push(''); redraw(); setTimeout(()=>document.getElementById('rcStep' + (d.steps.length - 1))?.focus(), 0); } });
  const addLine = ing=>{
    if(!ing || d.lines.length >= 100 || d.lines.some(l=>l.ingredient === ing.id)) return;
    d.lines.push({ingredient:ing.id, qty:null, unit:recipeStartUnit(ing)});
    recipeBook.fresh.add(d.lines.length - 1);
    redraw();
    setTimeout(()=>{ const q = document.querySelector(`[data-rc-qty="${d.lines.length - 1}"]`); q?.focus(); q?.scrollIntoView({block:'center', behavior:'smooth'}); }, 0);
  };
  on('rcAddLine', ()=>recipePickItem(addLine));
}

/* ---------- How Recipes work: a short one-time tour for Ahmad ----------
   Shown once after this update on whichever device he opens first: Done, Skip or closing it saves
   "seen" on his account (settings.tourRecipes2). Settings, Help shows it again. */
const RC_TOUR = ['items', 'recipes', 'cost', 'stock'];
function recipeTourPic(step){
  if(step === 'items') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span><b>${esc(rt('tourMilk'))}</b><em>${esc(recipeLtr('2,000') + ' / ' + rt('size')('l'))}</em></span><span><b>${esc(rt('tourBanana'))}</b><em>${esc(recipeLtr('4,000') + ' / ' + rt('size')('kg'))}</em></span></div></div>`;
  if(step === 'recipes') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span class="head"><b>${esc(rt('tourGroup'))}</b></span><span><b>${esc(rt('tourShake'))}</b><em>${esc(recipeMoney(3000))}</em></span></div></div>`;
  if(step === 'cost') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span><b>${esc(rt('costs'))}</b><em>${esc(recipeMoney(1000))}</em></span><span><b>${esc(rt('sellsFor'))}</b><em>${esc(recipeMoney(3000))}</em></span><span class="sum"><b>${esc(rt('weKeep'))}</b><em>${esc(recipeMoney(2000))}</em></span></div></div>`;
  return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span><b>${esc(rt('tourMilk'))}</b><em>${esc(recipeLtr('12 ' + rt('size')('piece')))}</em></span><span><b>${esc(rt('tourBanana'))}</b><em>${esc(t('mb_none'))}</em></span></div></div>`;
}
function openRecipesTour(){
  let i = 0;
  const steps = RC_TOUR.filter(s=>s !== 'stock' || canOpen('minibar'));
  const {el, close} = openKitchenSheet('xt-sheet', '<div id="rcTourStep"></div>', rt('tourTitle'));
  const seen = ()=>{ if(state.settings?.tourRecipes2 !== true) setSetting('tourRecipes2', true); lset('rcSeen2:' + state.account, true); };
  const paint = ()=>{
    const s = steps[i], last = i === steps.length - 1;
    el.querySelector('#rcTourStep').innerHTML = `<div class="xt-step">${recipeTourPic(s)}
      <div class="xt-dots" aria-hidden="true">${steps.map((_, n)=>`<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="sel-title">${esc(rt('tour_' + s + 'T'))}</div>
      <p class="xt-text">${esc(rt('tour_' + s))}</p>
      <div class="xt-btns">${last ? '' : `<button type="button" class="btn btn-ghost" data-rc-tour-skip>${esc(t('xtSkip'))}</button>`}<button type="button" class="btn btn-primary" data-rc-tour-next>${esc(t(last ? 'xtDone' : 'xtNext'))}</button></div>
      <span class="sr-only" aria-live="polite">${esc(t('xtStepOf')(i + 1, steps.length))}</span></div>`;
    el.querySelector('[data-rc-tour-next]').onclick = ()=>{ if(last){ seen(); close(); } else { i++; paint(); } };
    el.querySelector('[data-rc-tour-skip]')?.addEventListener('click', ()=>{ seen(); close(); });
  };
  paint();
  // Closing it any other way also counts as seen: it never nags.
  const gone = new MutationObserver(()=>{ if(!el.isConnected){ gone.disconnect(); seen(); } });
  gone.observe(document.body, {childList:true});
}
function maybeShowRecipesTour(tries = 0){
  if(state.account !== 'ahmad' || !canOpen('recipes')) return;
  if(state.settings?.tourRecipes2 === true || lget('rcSeen2:' + state.account)) return;
  if(document.querySelector('.sel-sheet, .modal-overlay') || state.view === 'login'){ if(tries < 20) setTimeout(()=>maybeShowRecipesTour(tries + 1), 1500); return; }
  openRecipesTour();
}

/* Ahmad's Settings: only what is his (notifications, recipe alerts, the look, help and privacy), then
   what he can use, with a plain value on the right (Rozh opens more in Admin). Settings for ordering,
   stock, receipts and transfers are not shown to him at all. */
function renderRecipeSettings(){
  const access = [['order', t('order'), rt('accessOrder')], ['assistant', t('ricoName'), rt('accessRico')], ['receipts', t('rrTitle'), rt('accessReceipts')], ['transfers', t('tfTitle'), rt('accessTransfers')]];
  const row = ([role, label, hint])=>{ const on = canOpen(role); return `<div class="settings-row rc-access-row"><span class="rc-access-text"><span>${esc(label)}</span><small>${esc(hint)}</small></span><span class="rc-access-value${on ? ' on' : ''}">${esc(on ? rt('available') : rt('locked'))}</span></div>`; };
  const alerts = `<div class="section-title">${esc(t('recipesTitle'))}</div><div class="form-card"><label class="check-row preference-row has-ico"><input type="checkbox" data-feature="recipeAlerts" ${featureOn('recipeAlerts') ? 'checked' : ''}>${setIcon('recipeAlerts')}<span>${esc(t('feat_recipeAlerts'))}<small>${esc(t('feat_recipeAlerts_hint'))}</small></span></label></div>`;
  return `<div class="settings-page">${canOpen('order') ? renderPendingSync() : ''}${renderNotifSettings()}${alerts}${renderFeatureSettings()}
    <div class="section-title">${esc(rt('access'))}</div><div class="form-card settings-rows">${access.map(row).join('')}</div><p class="rc-settings-foot">${esc(rt('lockedHint'))}</p>
    ${renderHelpSettings()}${renderPrivacySettings()}<div class="app-version">${esc(t('appVersionLine')(APP_VERSION))}</div></div>`;
}
