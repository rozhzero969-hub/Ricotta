/* Recipes: the shared recipe book (Ahmad's tab).
   Two parts, one switch at the top: Recipes, and Items and ingredients. Ahmad adds each ingredient once,
   linked to a stock item in Ricotta Restaurant, with its category; the tab shows its last price paid in
   plain sizes (1 kg = 4,000 IQD). A recipe is its name, category, menu price, ingredients with amounts,
   steps and notes. Its cost works itself out from the last price paid for each stock item
   (_shared/recipe-cost.js, the same rules the API uses for the alerts), rounded to the nearest 250 IQD.
   A recipe with an ingredient that has no price yet shows no cost at all, and says which one.
   Hold a recipe or an ingredient (right-click on a computer) for its menu: edit or delete.
   Saves carry a version, so one cook can't overwrite another cook's edits. Nothing here changes stock. */
const recipeBook = {account:null, data:null, ctx:null, stockBy:null, loading:false, error:false, tab:'recipes', page:'list', id:null,
  editing:null, dirty:false, saving:false, saveJob:null, prices:null, pricesBusy:false, pricesPoll:null, timer:null, query:'', ingQuery:'',
  cooking:false, wake:null, photos:null};
const rt = k=>t('recipe_' + k);
const RC = ()=>globalThis.RicottaRecipeCost;

function recipeReset(){
  clearTimeout(recipeBook.timer);
  clearTimeout(recipeBook.pricesPoll);
  recipeBook.wake?.release().catch(()=>{});
  Object.assign(recipeBook, {account:state.account, data:null, ctx:null, stockBy:null, loading:false, error:false, tab:'recipes', page:'list', id:null,
    editing:null, dirty:false, saving:false, saveJob:null, query:'', ingQuery:'', cooking:false, wake:null, photos:null});
}
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
  if(state.view === 'recipes' && !recipeBook.editing) render();
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
/* An exact amount for the breakdown: small prices keep their decimals (0.45 IQD a gram). */
function recipeExact(n){
  if(n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  const v = Number(n), a = Math.abs(v);
  return recipeLtr(v.toLocaleString('en-US', {maximumFractionDigits:a < 10 ? 2 : a < 100 ? 1 : 0}) + ' IQD');
}
// 14 Nov (the year only when it is not this year).
const recipeDay = day=>day ? formatIraqDateTime(day + 'T12:00:00Z', {day:'numeric', month:'short', ...(day.slice(0, 4) === new Date().toISOString().slice(0, 4) ? {} : {year:'numeric'})}) : '';
/* An ingredient's last price in plain sizes: [{text}] like "1 kg = 4,000 IQD", "1 g = 4 IQD". */
function recipeSizes(p){
  return RC().unitPrices(p).map(u=>rt('eq')(u.unit === 'other' ? u.name : rt('size')(u.unit), u.unit === 'kg' || u.unit === 'l' ? recipeMoney(u.amount) : recipeExact(u.amount)));
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
/* The plain note for a recipe without a cost: which ingredient has no price yet, or needs its amount. */
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
/* One short line on how a recipe stands, with the colour of its dot. */
function recipeState(c){
  if(!c.lines.length) return {tone:'gray', text:rt('stEmpty')};
  if(!c.complete){
    const p = c.problems.find(recipeNoPrice) || c.problems[0];
    return {tone:'amber', text:recipeNoPrice(p) ? rt('stNoPrice')(recipeLtr(p.name || rt('missing')), c.problems.length - 1) : rt('stAmount')(recipeLtr(p.name || rt('missing')))};
  }
  if(c.state === 'loss') return {tone:'red', text:rt('stLoss')};
  if(c.state === 'low') return {tone:'amber', text:rt('stLow')(recipeLtr(c.margin + '%'))};
  if(c.state === 'ok') return {tone:'green', text:rt('stProfit')(recipeMoney(c.profit), recipeLtr(c.margin + '%'))};
  return {tone:'gray', text:rt('stNoMenuPrice')};
}
function recipeLetter(name){ return ([...String(name || '').trim()][0] || '?').toLocaleUpperCase(); }
/* The recipe's first photo, or a plain tile with its first letter (never a made-up picture). */
function recipeThumb(r, cls){
  const url = recipeBook.data.covers?.[r.id], letter = recipeLetter(r.name);
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-letter="${esc(letter)}">`
    : `<span class="${cls} rc-letter" aria-hidden="true">${esc(letter)}</span>`;
}
const recipeStockBadge = st=>st === 'empty' ? `<span class="rc-badge red">${esc(rt('out'))}</span>` : st === 'low' ? `<span class="rc-badge amber">${esc(rt('low'))}</span>` : '';

/* ---------- Saving ---------- */
function recipeNew(){
  recipeBook.editing = {id:crypto.randomUUID(), name:'', version:0, data:{category:'', price:null, currency:'IQD', lines:[], steps:[''], notes:''}};
  recipeBook.dirty = false;
  render();
  window.scrollTo({top:0});
}
function recipeEdit(r){
  const copy = structuredClone(r);
  const d = copy.data || {};
  copy.data = {category:d.category || '', price:d.price ?? null, currency:'IQD', lines:Array.isArray(d.lines) ? d.lines : [], steps:Array.isArray(d.steps) && d.steps.length ? d.steps : [''], notes:d.notes || ''};
  recipeBook.editing = copy;
  recipeBook.dirty = false;
  render();
  window.scrollTo({top:0});
}
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
  recipeSaveLabel(rt('saving'));
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
  recipeSaveLabel(recipeBook.dirty ? rt('unsaved') : rt('saved'));
  if(recipeBook.dirty) recipeSchedule();
  return true;
}
function recipeSaveLabel(s){ const el = document.getElementById('rcSaveState'); if(el) el.textContent = s; }
function recipeSchedule(){ clearTimeout(recipeBook.timer); recipeSaveLabel(rt('unsaved')); recipeBook.timer = setTimeout(recipeSave, 1100); }
function recipeChange(){ recipeBook.dirty = true; recipeSchedule(); }

let recipeFieldCounter = 0;
function recipeField(label, html, hint = ''){
  const existing = html.match(/\bid="([^"]+)"/), id = existing ? existing[1] : 'rcField' + (++recipeFieldCounter);
  if(!existing) html = html.replace(/^<(input|textarea|select)\b/, '<$1 id="' + id + '"');
  return `<div class="field"><label for="${id}">${esc(label)}</label>${html}${hint ? `<p class="field-hint">${esc(hint)}</p>` : ''}</div>`;
}
/* Categories: tap one in use (or one of a few to start with), or type a new one. One spelling per
   group: "cakes" and "Cakes " are the same. Used for recipes and for ingredients. */
const recipeCatKey = c=>foldText(String(c || '').trim());
function recipeCatsIn(values, starters){
  const by = new Map();
  for(const v of values){ const k = recipeCatKey(v); if(k && !by.has(k)) by.set(k, String(v).trim()); }
  const list = [...by.values()].sort((a, b)=>a.localeCompare(b, state.lang));
  return list.length ? list : starters.split(',');
}
function recipeCatPicker(attr, inputAttr, cats, value, labelId){
  if(value.trim() && !cats.some(x=>recipeCatKey(x) === recipeCatKey(value))) cats = [...cats, value.trim()];
  return `<div class="field rc-cat-field"><span class="rc-label" id="${labelId}">${esc(rt('category'))}</span>
    <div class="rc-chips" role="group" aria-labelledby="${labelId}">${cats.map(x=>`<button type="button" class="rc-chip" ${attr}="${esc(x)}" aria-pressed="${!!value.trim() && recipeCatKey(x) === recipeCatKey(value)}" dir="auto">${esc(x)}</button>`).join('')}</div>
    <input ${inputAttr} maxlength="60" value="" dir="auto" autocomplete="off" aria-label="${esc(rt('newCategory'))}" placeholder="${esc(rt('newCategory'))}"></div>`;
}
/* Wires a category picker: tap a chip (again to clear it), or type a new one in the box. */
function recipeBindCats(root, attr, input, onChange){
  const sync = v=>root.querySelectorAll(`[${attr}]`).forEach(x=>x.setAttribute('aria-pressed', String(!!v.trim() && recipeCatKey(x.getAttribute(attr)) === recipeCatKey(v))));
  // The box is only for a new one: a chip that is picked empties it.
  root.querySelectorAll(`[${attr}]`).forEach(b=>b.onclick = ()=>{
    const v = b.getAttribute('aria-pressed') === 'true' ? '' : b.getAttribute(attr);
    input.value = ''; sync(v); onChange(v);
  });
  input.addEventListener('input', ()=>{ sync(input.value); onChange(input.value); });
}
/* Rows in groups by their category, A to Z, with the ones that have none last. */
function recipeGroups(rows, catOf){
  const by = new Map();
  for(const row of rows){
    const k = recipeCatKey(catOf(row));
    if(!by.has(k)) by.set(k, {name:String(catOf(row) || '').trim(), rows:[]});
    by.get(k).rows.push(row);
  }
  return [...by.entries()].sort(([a, x], [b, y])=>!a - !b || x.name.localeCompare(y.name, state.lang)).map(([, g])=>g);
}
function recipeGroupedHtml(rows, catOf, rowHtml){
  const groups = recipeGroups(rows, catOf);
  if(groups.length === 1 && !groups[0].name) return `<div class="rc-list">${rows.map(rowHtml).join('')}</div>`;
  return groups.map(g=>`<div class="section-title rc-group"><span dir="auto">${esc(g.name || rt('noCategory'))}</span><span class="rc-group-n">${g.rows.length}</span></div><div class="rc-list">${g.rows.map(rowHtml).join('')}</div>`).join('');
}

/* ---------- Pages ---------- */
function renderRecipes(){
  if(recipeBook.account !== state.account) recipeReset();
  if(!recipeBook.data){
    if(!recipeBook.loading && !recipeBook.error) recipeLoad();
    return recipeBook.error ? `<div class="rc-page">${emptyState(esc(t('loadFailed')))}<div class="rc-center"><button type="button" class="btn btn-primary" id="rcRetry">${esc(t('retry'))}</button></div></div>` : loadingLines(5);
  }
  if(recipeBook.editing) return recipeEditorPage();
  const r = recipeBook.page === 'detail' && recipeCurrent();
  if(r) return recipeDetailPage(r);
  recipeBook.page = 'list';
  return `<div class="rc-page">${recipeTabs()}${recipeBook.tab === 'ingredients' ? recipeIngredientsPage() : recipeListPage()}</div>`;
}
/* The switch at the top: Recipes | Items and ingredients. */
function recipeTabs(){
  const tab = (id, label)=>`<button type="button" class="pill-seg-btn" role="tab" id="rcTab-${id}" aria-selected="${recipeBook.tab === id}" data-rc-tab="${id}">${esc(label)}</button>`;
  return `<div class="pill-seg rc-tabs" role="tablist" aria-label="${esc(t('recipesTitle'))}">${tab('recipes', rt('tabRecipes'))}${tab('ingredients', rt('tabIngredients'))}</div>`;
}
function recipeSearchBox(id, value, label){
  return `<div class="list-search rc-search"><div class="search-wrap">${ICON_SEARCH}<input id="${id}" class="search-input" type="search" aria-label="${esc(label)}" placeholder="${esc(label)}" value="${esc(value)}" autocomplete="off"></div></div>`;
}
/* A friendly first step: what to do first, and one button for it. */
function recipeStart(title, text, id, label){
  return `<section class="rc-card rc-start"><b dir="auto">${esc(title)}</b><p dir="auto">${esc(text)}</p><button type="button" class="btn btn-primary rc-big" id="${id}">${ICON_PLUS}<span>${esc(label)}</span></button></section>`;
}
function recipeAlerts(){
  const list = (recipeBook.data.alerts || []).filter(a=>!a.read);
  if(!list.length) return '';
  return `<section class="rc-card rc-alerts" aria-label="${esc(rt('alerts'))}"><div class="rc-card-head"><b>${esc(rt('alerts'))}</b><button type="button" class="btn btn-ghost rc-small" id="rcAlertsRead">${esc(rt('markRead'))}</button></div>
    ${list.slice(0, 6).map(a=>`<div class="rc-alert"><p dir="auto">${esc(a[state.lang] || a.en || '')}</p><small>${esc(timeAgo(a.at))}</small></div>`).join('')}</section>`;
}
function recipeRowsFor(){
  const q = foldText(recipeBook.query.trim());
  return recipeBook.data.recipes.filter(r=>!q || foldText(r.name + ' ' + (r.data.category || '')).includes(q)).map(r=>({r, c:recipeCostOf(r)}));
}
function recipeRow({r, c}){
  const st = recipeState(c), stock = recipeStockIssues(r), sub = [`<span class="rc-state"><i class="rc-dot ${st.tone}" aria-hidden="true"></i><span dir="auto">${esc(st.text)}</span></span>`];
  if(stock.length) sub.push(`<span class="rc-warn">${esc(rt('stockIssues')(stock.length))}</span>`);
  return `<button type="button" class="rc-row" data-rc-open="${esc(r.id)}" aria-haspopup="menu">
    ${recipeThumb(r, 'rc-thumb')}
    <span class="rc-row-main"><span class="rc-row-name" dir="auto">${esc(r.name)}</span><span class="rc-row-sub">${sub.join('<span class="rc-sep" aria-hidden="true">·</span>')}</span></span>
    ${c.complete ? `<span class="rc-row-end"><b>${esc(recipeMoney(c.cost))}</b><small>${esc(rt('toMake'))}</small></span>` : ''}
    <i class="sheet-chevron" aria-hidden="true"></i></button>`;
}
function recipeListHtml(){
  const rows = recipeRowsFor();
  if(rows.length) return recipeGroupedHtml(rows, row=>row.r.data.category, recipeRow);
  return recipeBook.query.trim() ? emptyState(esc(rt('noMatch'))) : '';
}
function recipeListPage(){
  const d = recipeBook.data;
  if(!d.recipes.length){
    return recipeAlerts() + (d.ingredients.length ? recipeStart(rt('firstRecipeT'), rt('firstRecipe'), 'rcNew', rt('addFirstRecipe'))
      : recipeStart(rt('firstIngredientT'), rt('firstIngredientFirst'), 'rcStartIngredient', rt('addFirstIngredient')));
  }
  return `${recipeAlerts()}
    <div class="rc-tools">${recipeSearchBox('rcSearch', recipeBook.query, rt('search'))}
      <button type="button" class="btn btn-primary rc-add-btn" id="rcNew">${ICON_PLUS}<span>${esc(rt('new'))}</span></button></div>
    ${!d.pricesReady ? `<p class="rr-foot warn">${esc(rt('pricesOff'))}</p>` : ''}
    <div id="rcList">${recipeListHtml()}</div>
    <p class="rc-note">${esc(rt('holdHint')(recipeTouch()))}</p>`;
}
const recipeTouch = ()=>!matchMedia('(hover: hover) and (pointer: fine)').matches;

function recipeCostCard(c, live){
  const head = `<div class="rc-card-head"><b>${esc(rt('costTitle'))}</b><button type="button" class="btn btn-ghost rc-small rc-why-btn" data-rc-why>${esc(rt('whyNumbers'))}</button></div>`;
  if(!c.complete){
    return `<section class="rc-card rc-cost is-missing"${live ? ' id="rcLive" aria-live="polite"' : ''}>${head}
      <p class="rc-missing-note" dir="auto"><i class="rc-dot amber" aria-hidden="true"></i><span>${esc(recipeMissingNote(c))}</span></p>
      ${c.price ? `<div class="rc-stats rc-stats-one"><div class="rc-stat"><span>${esc(rt('menuPrice'))}</span><b>${esc(recipeMoney(c.price))}</b></div></div>` : ''}</section>`;
  }
  const tone = c.state === 'loss' ? 'red' : c.state === 'low' ? 'amber' : c.state === 'ok' ? 'green' : '';
  const cell = (label, html, cls = '')=>`<div class="rc-stat${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><b>${html || `<em>${esc(rt('noPriceShort'))}</em>`}</b></div>`;
  const notes = [];
  if(!c.price) notes.push(rt('addPriceNote'));
  if(c.losing) notes.push(rt('lossNote'));
  if(c.low) notes.push(rt('lowNote')(recipeLtr((recipeBook.data.marginMin ?? RC().MARGIN_MIN) + '%')));
  if(c.suggested) notes.push(rt('suggested')(recipeMoney(c.suggested), RC().SUGGEST_TIMES));
  return `<section class="rc-card rc-cost${tone ? ' ' + tone : ''}"${live ? ' id="rcLive" aria-live="polite"' : ''}>${head}
    <div class="rc-stats">${cell(rt('costToMake'), esc(recipeMoney(c.cost)))}${cell(rt('menuPrice'), c.price ? esc(recipeMoney(c.price)) : '')}${cell(rt('profit'), c.profit !== null ? esc(recipeMoney(c.profit)) : '', c.profit !== null && c.profit < 0 ? 'neg' : '')}${cell(rt('margin'), c.margin !== null ? esc(recipeLtr(c.margin + '%')) : '', tone)}</div>
    ${notes.length ? `<ul class="rc-cost-notes">${notes.map(n=>`<li dir="auto">${esc(n)}</li>`).join('')}</ul>` : ''}</section>`;
}
function recipeLineHtml(l, i){
  const s = l.stockItem ? recipeStock(l.stockItem) : null;
  const qty = Number(l.qty) > 0 ? `${recipeQty(l.qty)} ${l.unit}` : '';
  const cost = l.status === 'ok' ? `<b>${esc(recipeExact(l.cost))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
  return `<div class="rc-line"><span class="rc-line-main"><span dir="auto">${esc(l.name || rt('missing'))}</span>
      <small dir="auto">${l.stockItem ? esc(l.stockItem) : ''}${recipeStockBadge(s?.state)}</small></span>
    <span class="rc-line-qty" dir="auto">${esc(qty)}</span><span class="rc-line-cost" data-rc-linecost="${i}">${cost}</span></div>`;
}
function recipeDetailPage(r){
  const d = r.data, c = recipeCostOf(r), cook = recipeBook.cooking;
  const photos = recipeBook.photos?.id === r.id ? recipeBook.photos : null;
  const steps = (d.steps || []).filter(s=>s.trim());
  return `<div class="rc-page rc-detail${cook ? ' is-cooking' : ''}">
    <div class="rc-bar"><button type="button" class="rc-back" id="rcBack">${ICON_BACK}<span>${esc(t('recipesTitle'))}</span></button>
      <span class="rc-bar-end"><button type="button" class="btn btn-ghost" id="rcCook">${esc(cook ? rt('closeCooking') : rt('cooking'))}</button><button type="button" class="btn btn-primary" id="rcEdit">${esc(rt('edit'))}</button></span></div>
    <header class="rc-head">${recipeThumb(r, 'rc-hero')}<div class="rc-head-text">
      ${d.category ? `<span class="rc-eyebrow" dir="auto">${esc(d.category)}</span>` : ''}<h2 dir="auto">${esc(r.name)}</h2>
      ${d.price ? `<p>${esc(rt('onMenuFor')(recipeMoney(d.price)))}</p>` : ''}</div></header>
    ${cook ? '' : recipeCostCard(c)}
    <section class="rc-card"><div class="rc-card-head"><b>${esc(rt('ingredients'))}</b></div>
      ${c.lines.map((l, i)=>recipeLineHtml(l, i)).join('') || `<p class="rc-empty-line">${esc(rt('noLines'))}</p>`}</section>
    <section class="rc-card"><div class="rc-card-head"><b>${esc(rt('steps'))}</b></div>
      ${steps.map((s, i)=>`<div class="rc-step"><span>${i + 1}</span><p dir="auto">${esc(s)}</p></div>`).join('') || `<p class="rc-empty-line">${esc(rt('noSteps'))}</p>`}
      ${d.notes ? `<div class="rc-notes"><b>${esc(rt('notes'))}</b><p dir="auto">${esc(d.notes)}</p></div>` : ''}</section>
    <section class="rc-card"><div class="rc-card-head"><b>${esc(rt('photos'))}</b><button type="button" class="btn btn-ghost rc-small" id="rcPhotoButton">${ICON_CAMERA}<span>${esc(rt('addPhoto'))}</span></button></div>
      <input type="file" id="rcPhoto" accept="image/*" hidden>
      <div class="rc-photos" id="rcPhotos">${photos?.list ? (photos.list.map(p=>`<figure><a href="${esc(p.url || '')}" target="_blank" rel="noopener"><img src="${esc(p.url || '')}" loading="lazy" alt="${esc(p.caption || r.name)}"></a><button type="button" class="rc-photo-del" data-rc-delphoto="${esc(p.id)}" aria-label="${esc(rt('deletePhoto'))}">${ICON_DELETE}</button></figure>`).join('') || `<p class="rc-empty-line">${esc(rt('noPhotos'))}</p>`) : photos?.failed ? `<p class="rc-empty-line">${esc(t('loadFailed'))}</p>` : `<p class="rc-empty-line">${esc(t('loading'))}</p>`}</div>
      <p class="rc-note">${esc(rt('photoHint'))}</p></section>
    <p class="rc-note">${esc(rt('edited'))} ${esc(accountLabel(r.updated_by) || '')} · ${esc(formatIraqDateTime(r.updated_at))}</p></div>`;
}

/* ---------- Where do these numbers come from? ----------
   Each ingredient's working: the stock item, the last price paid and the unit it was bought in, the
   price per gram, millilitre or piece, the amount used and what it costs. Then the total, the rounding
   to the nearest 250 IQD, the menu price and the profit. */
function recipeWhySheet(r){
  const c = recipeCostOf(r), ctx = recipeCtx();
  const row = (k, v)=>`<div class="rc-why-row"><span>${esc(k)}</span><b dir="auto">${v}</b></div>`;
  const lines = c.lines.map(l=>{
    const p = l.stockItem ? ctx.price(l.stockItem) : null, ok = p && !p.error && p.currency === 'IQD';
    const paid = ok ? esc(rt('paidPer')(recipeExact(p.cost), p.unit || p.base)) + (p.day || p.supplier ? `<small dir="auto">${esc([recipeDay(p.day), p.supplier].filter(Boolean).join(' · '))}</small>` : '') : '';
    return `<div class="rc-why-line"><div class="rc-why-name"><b dir="auto">${esc(l.name || rt('missing'))}</b>${l.stockItem ? `<small dir="auto">${esc(l.stockItem)}</small>` : ''}</div>
      ${ok ? row(rt('lastPaid'), paid) + row(rt('pricePer'), recipeSizes(p).map(esc).join('<br>')) : ''}
      ${row(rt('used'), Number(l.qty) > 0 ? esc(recipeLtr(recipeQty(l.qty) + ' ' + l.unit)) : '<em>' + esc(rt('whyAmount')) + '</em>')}
      ${row(rt('lineCost'), l.status === 'ok' ? esc(recipeExact(l.cost)) : `<em>${esc(recipeWhy(l))}</em>`)}</div>`;
  }).join('') || `<p class="rc-empty-line">${esc(rt('noLines'))}</p>`;
  const sum = c.complete ? `<div class="rc-why-sum">${row(rt('total'), esc(recipeExact(c.total)))}${row(rt('rounded'), esc(recipeMoney(c.cost)))}
      ${c.price ? row(rt('menuPrice'), esc(recipeMoney(c.price))) + row(rt('profit'), esc(rt('minus')(recipeMoney(c.price), recipeMoney(c.cost), recipeMoney(c.profit)))) + row(rt('margin'), esc(rt('divide')(recipeMoney(c.profit), recipeMoney(c.price), recipeLtr(c.margin + '%')))) : ''}</div>
      <p class="rc-note">${esc(rt('roundNote'))}</p>`
    : `<p class="rc-missing-note" dir="auto"><i class="rc-dot amber" aria-hidden="true"></i><span>${esc(recipeMissingNote(c))}</span></p>`;
  openKitchenSheet('rc-why-sheet', `<div class="rc-work"><div class="sel-title">${esc(rt('whyNumbers'))}</div><p class="rc-why-intro" dir="auto">${esc(rt('whyIntro'))}</p>${lines}${sum}</div>`, rt('whyNumbers'));
}

/* ---------- Writing a recipe ---------- */
function recipeUnitOptions(selected){
  const units = recipeBook.data.units, has = units.some(u=>u.id === selected);
  return (has || !selected ? '' : `<option value="${esc(selected)}" selected>${esc(recipeUnit(selected))}</option>`)
    + (selected ? '' : `<option value="" selected disabled>${esc(rt('chooseUnit'))}</option>`)
    + units.map(u=>`<option value="${esc(u.id)}" ${u.id === selected ? 'selected' : ''}>${esc(u.en)}</option>`).join('');
}
const recipeLineCost = l=>l.status === 'ok' ? `<b>${esc(recipeExact(l.cost))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
function recipeEditLine(l, i, cost){
  const ing = recipeIngredient(l.ingredient), s = ing ? recipeStock(ing.stock_item) : null;
  return `<div class="rc-eline" data-rc-line="${i}">
    <span class="rc-eline-name"><span dir="auto">${esc(ing?.name || rt('missing'))}</span><small dir="auto">${esc(ing?.stock_item || '')}${recipeStockBadge(s?.state)}</small></span>
    <span class="rc-eline-amt"><input type="number" inputmode="decimal" min="0.001" max="999999" step="any" data-rc-qty="${i}" aria-label="${esc(rt('amountOf')(ing?.name || ''))}" placeholder="${esc(rt('amount'))}" value="${l.qty ?? ''}">
      <select data-rc-unit="${i}" data-inline aria-label="${esc(rt('unit'))}">${recipeUnitOptions(l.unit)}</select></span>
    <span class="rc-eline-cost" data-rc-linecost="${i}">${cost}</span>
    <button type="button" class="icon-btn rc-remove" data-rc-remove="${i}" aria-label="${esc(rt('removeLine'))}">${ICON_CLOSE_SM}</button></div>`;
}
function recipeEditorPage(){
  const r = recipeBook.editing, d = r.data, c = recipeCostOf(r), used = new Set(d.lines.map(l=>l.ingredient));
  const cats = recipeCatsIn(recipeBook.data.recipes.map(x=>x.data?.category), rt('starterCats'));
  const left = [...recipeBook.data.ingredients].filter(i=>!used.has(i.id)).sort((a, b)=>a.name.localeCompare(b.name, state.lang));
  return `<div class="rc-page rc-editor">
    <div class="rc-bar"><button type="button" class="rc-back" id="rcEditBack">${ICON_BACK}<span>${esc(r.version ? r.name || rt('edit') : rt('new'))}</span></button>
      <span class="rc-bar-end"><span class="rc-save-state" id="rcSaveState" role="status">${esc(recipeBook.dirty ? rt('unsaved') : r.version ? rt('saved') : '')}</span><button type="button" class="btn btn-primary" id="rcDone">${esc(t('done'))}</button></span></div>
    <section class="rc-card rc-form">
      ${recipeField(rt('menuName'), `<input id="rcName" maxlength="120" value="${esc(r.name)}" dir="auto" autocomplete="off" placeholder="${esc(rt('menuNameHint'))}">`)}
      ${recipeCatPicker('data-rc-cat', 'data-rc-field="category"', cats, d.category, 'rcCatLabel')}
      ${recipeField(rt('menuPriceIqd'), `<input id="rcPrice" type="number" inputmode="numeric" min="0" step="250" value="${d.price ?? ''}" placeholder="${esc(rt('pricePlaceholder'))}">`)}
    </section>
    <div class="section-title">${esc(rt('ingredients'))}</div>
    <section class="rc-card rc-elines">${c.lines.map((l, i)=>recipeEditLine(d.lines[i], i, recipeLineCost(l))).join('') || `<p class="rc-empty-line">${esc(recipeBook.data.ingredients.length ? rt('pickFirst') : rt('noIngredientsYet'))}</p>`}
      <div class="rc-add">${left.length ? `<select id="rcAddLine" aria-label="${esc(rt('addIngredient'))}"><option value="" selected disabled>${esc(rt('addIngredient'))}</option>${left.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select>` : ''}
        <button type="button" class="btn btn-ghost" id="rcNewIngredient">${ICON_PLUS}<span>${esc(rt('newIngredient'))}</span></button></div></section>
    ${recipeCostCard(c, true)}
    <div class="section-title">${esc(rt('steps'))}</div>
    <section class="rc-card rc-form">${d.steps.map((s, i)=>`<div class="rc-estep"><span class="rc-estep-n" aria-hidden="true">${i + 1}</span><textarea id="rcStep${i}" data-rc-step="${i}" maxlength="3000" rows="2" dir="auto" aria-label="${esc(rt('stepN')(i + 1))}" placeholder="${esc(rt('stepHint'))}">${esc(s)}</textarea>
        <button type="button" class="icon-btn rc-remove" data-rc-delstep="${i}" aria-label="${esc(rt('removeStep'))}">${ICON_CLOSE_SM}</button></div>`).join('')}
      <button type="button" class="btn btn-ghost rc-add-step" id="rcAddStep">${ICON_PLUS}<span>${esc(rt('addStep'))}</span></button></section>
    <div class="section-title">${esc(rt('notes'))}</div>
    <section class="rc-card rc-form"><textarea class="rc-notes-box" data-rc-field="notes" maxlength="8000" rows="3" dir="auto" aria-label="${esc(rt('notes'))}" placeholder="${esc(rt('notesHint'))}">${esc(d.notes)}</textarea></section>
    ${r.version ? `<div class="rc-center"><button type="button" class="btn btn-ghost rc-danger" id="rcDeleteRecipe">${ICON_DELETE}<span>${esc(rt('deleteRecipe'))}</span></button></div>` : ''}</div>`;
}
/* While typing: the line costs and the cost card change in place (the page isn't drawn again). */
function recipeRefreshLive(){
  const r = recipeBook.editing;
  if(!r) return;
  const c = recipeCostOf(r);
  c.lines.forEach((l, i)=>{ const el = document.querySelector(`.rc-elines [data-rc-linecost="${i}"]`); if(el) el.innerHTML = recipeLineCost(l); });
  const card = document.getElementById('rcLive');
  if(card){ card.outerHTML = recipeCostCard(c, true); recipeBindWhy(); }
}

/* ---------- Items and ingredients ---------- */
const recipeUses = id=>recipeBook.data.recipes.filter(r=>(r.data.lines || []).some(l=>l.ingredient === id)).length;
function recipeIngredientPrice(i){
  const d = recipeBook.data, s = recipeStock(i.stock_item), p = recipeCtx().price(i.stock_item);
  if(!s && d.stock.length) return {ok:false, html:`<em class="rc-why warn">${esc(rt('whyGone'))}</em>`};
  if(p && !p.error && p.currency === 'IQD' && p.perBase > 0){
    const sizes = recipeSizes(p);
    return {ok:true, p, html:`<b>${esc(sizes[0])}</b>${sizes[1] ? `<small>${esc(sizes[1])}</small>` : ''}`};
  }
  return {ok:false, html:`<em class="rc-why warn">${esc(p && p.currency !== 'IQD' ? rt('whyUsd') : p?.error ? rt('whyBuyUnit')(p.unit, p.base) : rt('noPriceYet'))}</em>`};
}
function recipeIngredientRow(i){
  const s = recipeStock(i.stock_item), price = recipeIngredientPrice(i), n = recipeUses(i.id);
  const bought = price.ok && (price.p.day || price.p.supplier) ? `<span class="rc-row-sub rc-bought" dir="auto">${esc(rt('bought')(recipeDay(price.p.day), price.p.supplier))}</span>` : '';
  return `<button type="button" class="rc-row rc-ing-row" data-rc-ingredient="${esc(i.id)}" aria-haspopup="menu"><span class="rc-row-main"><span class="rc-row-name" dir="auto">${esc(i.name)}</span>
      <span class="rc-row-sub"><span dir="auto">${esc(i.stock_item)}</span>${recipeStockBadge(s?.state)}<span class="rc-sep" aria-hidden="true">·</span><span>${esc(rt('usedIn')(n))}</span></span>${bought}</span>
    <span class="rc-row-end">${price.html}</span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
}
function recipeIngredientsPage(){
  const d = recipeBook.data, q = foldText(recipeBook.ingQuery.trim());
  const foot = `${!d.pricesReady ? `<p class="rr-foot warn">${esc(rt('pricesOff'))}</p>` : ''}${!d.stockAt ? `<p class="rr-foot warn">${esc(t('rrNoCatalog'))}</p>` : ''}`;
  if(!d.ingredients.length) return recipeStart(rt('firstIngredientT'), rt('firstIngredient'), 'rcIngredientNew', rt('addFirstIngredient')) + recipePricesBar() + foot;
  const rows = [...d.ingredients].sort((a, b)=>a.name.localeCompare(b.name, state.lang)).filter(i=>!q || foldText(i.name + ' ' + i.stock_item + ' ' + (i.category || '')).includes(q));
  return `${recipePricesBar()}
    <div class="rc-tools">${recipeSearchBox('rcIngSearch', recipeBook.ingQuery, rt('searchIngredients'))}
      <button type="button" class="btn btn-primary rc-add-btn" id="rcIngredientNew">${ICON_PLUS}<span>${esc(rt('newIngredient'))}</span></button></div>
    <div id="rcIngList">${rows.length ? recipeGroupedHtml(rows, i=>i.category, recipeIngredientRow) : emptyState(esc(rt('noMatch')))}</div>
    <p class="rc-note">${esc(rt('ingredientsNote'))} ${esc(rt('holdHintIng')(recipeTouch()))}</p>${foot}`;
}
/* Add or change an ingredient: its name, the stock item it is (suggested from the name, with a warning
   when the names don't look alike: a warning only, Ahmad decides), its category and the unit new lines
   start with. The stock item's last price shows as soon as it is chosen. */
function recipeIngredientForm(id, onSaved){
  const d = recipeBook.data, old = recipeIngredient(id), stock = [...d.stock].sort((a, b)=>a.name.localeCompare(b.name));
  const used = old && recipeUses(old.id) > 0;
  const cats = recipeCatsIn(d.ingredients.map(i=>i.category), rt('starterIngCats'));
  let category = old?.category || '';
  showFormModal({title:esc(old ? rt('editIngredient') : rt('newIngredient')),
    bodyHtml:recipeField(rt('ingredientName'), `<input id="rcIngName" maxlength="120" value="${esc(old?.name || '')}" dir="auto" autocomplete="off" placeholder="${esc(rt('ingredientNameHint'))}">`)
      + recipeField(rt('stockItem'), `<select id="rcIngStock"><option value="" ${old ? '' : 'selected'} disabled>${esc(rt('chooseStock'))}</option>${stock.map(s=>`<option value="${esc(s.name)}" ${s.name === old?.stock_item ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}${old && !stock.some(s=>s.name === old.stock_item) ? `<option value="${esc(old.stock_item)}" selected>${esc(old.stock_item)}</option>` : ''}</select>`)
      + `<div class="rc-sug" id="rcIngSug" aria-live="polite"></div><p class="field-hint rc-warn-hint" id="rcIngWarn"></p><div class="rc-ing-price" id="rcIngPrice" aria-live="polite"></div>`
      + recipeCatPicker('data-rc-icat', 'id="rcIngCat"', cats, category, 'rcIngCatLabel')
      + recipeField(rt('usualUnit'), `<select id="rcIngUnit">${recipeUnitOptions(old?.unit || '')}</select>`, rt('unitsHint')),
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
      const r = await api('recipe-ingredients/' + (old?.id || crypto.randomUUID()), {method:'PUT', body:{name, stock_item:stockItem, unit, category:category.trim(), version:old?.version || 0}});
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
    const nameEl = document.getElementById('rcIngName'), sel = document.getElementById('rcIngStock'), unitEl = document.getElementById('rcIngUnit'), sug = document.getElementById('rcIngSug'), warn = document.getElementById('rcIngWarn'), priceEl = document.getElementById('rcIngPrice'), catEl = document.getElementById('rcIngCat');
    if(!nameEl || !sel) return;
    const L = globalThis.RicottaStockLink, S = globalThis.RicottaSearch;
    let unitTouched = !!old, auto = false;
    if(catEl) recipeBindCats(catEl.closest('.rc-cat-field'), 'data-rc-icat', catEl, v=>{ category = v; });
    const pick = v=>{ sel.value = v; sel.dispatchEvent(new Event('change', {bubbles:true})); };
    const check = ()=>{
      const name = nameEl.value.trim(), chosen = sel.value;
      warn.textContent = name && chosen && L && !L.matches({name}, chosen) ? rt('nameWarn') : '';
      // Its last price, so Ahmad sees straight away what it costs.
      const p = chosen ? recipeIngredientPrice({stock_item:chosen}) : null;
      if(priceEl) priceEl.innerHTML = p ? `<span>${esc(rt('lastPrice'))}</span><span class="rc-ing-price-v">${p.html}</span>` : '';
      // The unit new lines start with: the stock item's own base unit when Manage has it.
      const s = stock.find(x=>x.name === chosen);
      if(!unitTouched && s && S && unitEl){ const m = S.unit(d.units.map(u=>u.en), s.base); const u = m && d.units.find(x=>x.en === m); if(u && unitEl.value !== u.id){ auto = true; unitEl.value = u.id; unitEl.dispatchEvent(new Event('change', {bubbles:true})); auto = false; } }
    };
    const suggest = ()=>{
      const name = nameEl.value.trim();
      const list = name && L ? L.suggest({name}, stock, 4) : [];
      sug.innerHTML = list.length ? `<span>${esc(rt('suggestedStock'))}</span>${list.map(s=>`<button type="button" class="rc-chip${s.name === sel.value ? ' on' : ''}" data-rc-sug="${esc(s.name)}" dir="auto">${esc(s.name)}</button>`).join('')}` : '';
      sug.querySelectorAll('[data-rc-sug]').forEach(b=>b.onclick = ()=>{ pick(b.dataset.rcSug); suggest(); });
      check();
    };
    nameEl.addEventListener('input', suggest);
    sel.addEventListener('change', ()=>{ suggest(); });
    unitEl?.addEventListener('change', ()=>{ if(!auto) unitTouched = true; });
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
  if(recipeBook.id === r.id){ recipeBook.id = null; recipeBook.page = 'list'; recipeBook.cooking = false; }
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
  recipeBindThumbs(root);
}
function recipeBindWhy(){
  document.querySelectorAll('[data-rc-why]').forEach(b=>b.onclick = ()=>{ const r = recipeBook.editing || recipeCurrent(); if(r) recipeWhySheet(r); });
}

/* ---------- Photos (on a recipe's page: the camera or a file, made smaller before it is sent) ---------- */
async function recipePhotos(){
  const account = state.account, id = recipeBook.id;
  recipeBook.photos = {id, list:null, failed:false, loading:true};
  const r = await api('recipes/' + id + '/photos');
  if(account !== state.account || recipeBook.id !== id) return;
  recipeBook.photos = {id, list:r.ok ? r.data : null, failed:!r.ok, loading:false};
  if(state.view === 'recipes' && recipeBook.page === 'detail' && !recipeBook.editing) render();
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
    // The list's tile and the photos both come again (the first photo becomes the tile).
    recipeBook.photos = null;
    await recipeLoad();
    return true;
  }catch{ toast(rt('photoFailed'), 'error'); return false; }
}
async function recipeCooking(){
  recipeBook.cooking = !recipeBook.cooking;
  if(recipeBook.cooking){ try{ recipeBook.wake = await navigator.wakeLock?.request('screen'); }catch{ /* not every device keeps the screen on */ } }
  else { await recipeBook.wake?.release().catch(()=>{}); recipeBook.wake = null; }
  render();
}
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ recipeBook.wake?.release().catch(()=>{}); recipeBook.wake = null; }
  else if(recipeBook.cooking && state.view === 'recipes') navigator.wakeLock?.request('screen').then(w=>recipeBook.wake = w).catch(()=>{});
});
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
  recipeBook.id = id; recipeBook.page = 'detail'; recipeBook.cooking = false;
  recipeBook.wake?.release().catch(()=>{}); recipeBook.wake = null;
  render();
  document.getElementById('mainContent')?.scrollTo?.({top:0});
  window.scrollTo({top:0});
}
/* A tile whose photo link ran out (after 15 minutes) shows its letter instead. */
function recipeBindThumbs(root){
  root.querySelectorAll('img.rc-thumb, img.rc-hero').forEach(img=>{ img.onerror = ()=>{ const s = document.createElement('span'); s.className = img.className + ' rc-letter'; s.setAttribute('aria-hidden', 'true'); s.textContent = img.dataset.letter || '?'; img.replaceWith(s); }; });
}
/* ---------- Check all last prices (on Items and ingredients) ----------
   The last price paid for every ingredient comes from Ricotta Restaurant's invoices: Rico on the Mac
   reads them every 15 minutes (Cloud Rico on the server, once it is set up). The button reads them now;
   while Rico reads, the page asks every few seconds how it is going, then shows the new prices. */
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
    <button type="button" class="btn btn-ghost rc-small" id="rcPrices" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '<i class="rr-spin" aria-hidden="true"></i>' : ICON_REFRESH}<span>${esc(rt('pricesCheck'))}</span></button></div>`;
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
  on('rcNew', recipeNew);
  on('rcStartIngredient', ()=>{ recipeBook.tab = 'ingredients'; render(); recipeIngredientForm(); });
  all('[data-rc-tab]', b=>b.onclick = ()=>{ if(recipeBook.tab === b.dataset.rcTab) return; recipeBook.tab = b.dataset.rcTab; render(); });
  on('rcPrices', recipePricesCheck);
  on('rcBack', ()=>{ recipeBook.page = 'list'; recipeBook.cooking = false; recipeBook.wake?.release().catch(()=>{}); recipeBook.wake = null; render(); });
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
    const list = document.getElementById('rcIngList'), q = foldText(ingSearch.value.trim());
    if(!list) return;
    const rows = [...recipeBook.data.ingredients].sort((a, b)=>a.name.localeCompare(b.name, state.lang)).filter(i=>!q || foldText(i.name + ' ' + i.stock_item + ' ' + (i.category || '')).includes(q));
    list.innerHTML = rows.length ? recipeGroupedHtml(rows, i=>i.category, recipeIngredientRow) : emptyState(esc(rt('noMatch')));
    recipeBindRows(list);
  };
  on('rcIngredientNew', ()=>recipeIngredientForm());

  // A recipe's page
  const current = recipeBook.page === 'detail' && !recipeBook.editing ? recipeCurrent() : null;
  if(current && recipeBook.photos?.id !== current.id) recipePhotos();
  on('rcEdit', ()=>{ const r = recipeCurrent(); if(r) recipeEdit(r); });
  on('rcCook', recipeCooking);
  on('rcPhotoButton', ()=>document.getElementById('rcPhoto')?.click());
  const photo = document.getElementById('rcPhoto');
  if(photo) photo.onchange = ()=>recipeUpload(photo.files[0]);
  all('[data-rc-delphoto]', b=>b.onclick = async ()=>{
    if(!(await showConfirm(rt('deletePhoto')))) return;
    const r = await api('recipes/' + recipeBook.id + '/photos/' + b.dataset.rcDelphoto, {method:'DELETE'});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    recipeBook.photos = null;
    recipeLoad();
  });

  // Writing a recipe
  if(!recipeBook.editing) return;
  const r = recipeBook.editing, d = r.data;
  const redraw = ()=>{ recipeChange(); render(); };
  on('rcDone', async ()=>{
    if(!r.name.trim()){ toast(rt('required'), 'error'); document.getElementById('rcName')?.focus(); return; }
    if(await recipeSave(true)){ recipeBook.editing = null; recipeBook.id = r.id; recipeBook.page = 'detail'; recipeBook.photos = null; render(); window.scrollTo({top:0}); }
  });
  on('rcEditBack', async ()=>{
    if(!(await recipeLeave())) return;
    recipeBook.page = r.version && recipeBook.data.recipes.some(x=>x.id === r.id) ? 'detail' : 'list';
    render();
  });
  on('rcDeleteRecipe', ()=>recipeDelete(r));
  const name = document.getElementById('rcName');
  if(name){ name.oninput = ()=>{ r.name = name.value; recipeChange(); }; if(!r.version && !r.name) setTimeout(()=>name.focus({preventScroll:true}), 0); }
  const catBox = document.querySelector('[data-rc-field="category"]');
  if(catBox) recipeBindCats(catBox.closest('.rc-cat-field'), 'data-rc-cat', catBox, v=>{ d.category = v; recipeChange(); });
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
  all('[data-rc-remove]', b=>b.onclick = ()=>{ d.lines.splice(Number(b.dataset.rcRemove), 1); redraw(); });
  all('[data-rc-delstep]', b=>b.onclick = ()=>{ d.steps.splice(Number(b.dataset.rcDelstep), 1); if(!d.steps.length) d.steps.push(''); redraw(); });
  on('rcAddStep', ()=>{ if(d.steps.length < 60){ d.steps.push(''); redraw(); setTimeout(()=>document.getElementById('rcStep' + (d.steps.length - 1))?.focus(), 0); } });
  const addLine = ing=>{
    if(!ing || d.lines.length >= 100) return;
    d.lines.push({ingredient:ing.id, qty:null, unit:ing.unit});
    redraw();
    setTimeout(()=>document.querySelector(`[data-rc-qty="${d.lines.length - 1}"]`)?.focus(), 0);
  };
  const add = document.getElementById('rcAddLine');
  if(add) add.onchange = ()=>addLine(recipeIngredient(add.value));
  on('rcNewIngredient', ()=>recipeIngredientForm(null, ing=>addLine(ing)));
}

/* ---------- How Recipes work: a short one-time tour for Ahmad ----------
   Shown once after this update on whichever device he opens first: Done, Skip or closing it saves
   "seen" on his account (settings.tourRecipes). Settings, Help shows it again. */
const RC_TOUR = ['items', 'recipes', 'cost', 'hold'];
function recipeTourPic(step){
  if(step === 'items') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-col"><div class="rc-tp-seg"><span>${esc(rt('tabRecipes'))}</span><span class="on">${esc(rt('tabIngredients'))}</span></div>
    <div class="rc-tp-rows"><span><b>${esc(rt('tourMilk'))}</b><em>${esc(rt('eq')(rt('size')('l'), recipeMoney(2000)))}</em></span><span><b>${esc(rt('tourBanana'))}</b><em>${esc(rt('eq')(rt('size')('kg'), recipeMoney(4000)))}</em></span></div></div></div>`;
  if(step === 'recipes') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span class="head"><b>${esc(rt('tourShake'))}</b><em>${esc(recipeMoney(3000))}</em></span><span><b>${esc(rt('tourMilk'))}</b><em>${esc(recipeLtr('250 ml'))}</em></span><span><b>${esc(rt('tourBanana'))}</b><em>${esc(recipeLtr('150 g'))}</em></span></div></div>`;
  if(step === 'cost') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span><b>${esc(rt('tourMilk'))}</b><em>${esc(recipeMoney(500))}</em></span><span><b>${esc(rt('tourBanana'))}</b><em>${esc(recipeMoney(600))}</em></span><span class="sum"><b>${esc(rt('costToMake'))}</b><em>${esc(recipeMoney(1000))}</em></span></div></div>`;
  return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-menu"><span>${esc(rt('edit'))}</span><span class="danger">${esc(t('delete'))}</span></div></div>`;
}
function openRecipesTour(){
  let i = 0;
  const touch = recipeTouch();
  const {el, close} = openKitchenSheet('xt-sheet', '<div id="rcTourStep"></div>', rt('tourTitle'));
  const seen = ()=>{ if(state.settings?.tourRecipes !== true) setSetting('tourRecipes', true); lset('rcSeen:' + state.account, true); };
  const paint = ()=>{
    const s = RC_TOUR[i], last = i === RC_TOUR.length - 1;
    el.querySelector('#rcTourStep').innerHTML = `<div class="xt-step">${recipeTourPic(s)}
      <div class="xt-dots" aria-hidden="true">${RC_TOUR.map((_, n)=>`<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="sel-title">${esc(rt('tour_' + s + 'T'))}</div>
      <p class="xt-text">${esc(s === 'hold' ? rt('tour_hold')(touch) : rt('tour_' + s))}</p>
      <div class="xt-btns">${last ? '' : `<button type="button" class="btn btn-ghost" data-rc-tour-skip>${esc(t('xtSkip'))}</button>`}<button type="button" class="btn btn-primary" data-rc-tour-next>${esc(t(last ? 'xtDone' : 'xtNext'))}</button></div>
      <span class="sr-only" aria-live="polite">${esc(t('xtStepOf')(i + 1, RC_TOUR.length))}</span></div>`;
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
  if(state.settings?.tourRecipes === true || lget('rcSeen:' + state.account)) return;
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
