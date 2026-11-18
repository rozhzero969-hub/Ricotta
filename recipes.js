/* Recipes: the minibar's recipe book (Ahmad's tabs).
   Two bottom tabs: Recipes, and Items (the app's views 'recipes' and 'recipeItems'). Ahmad adds each item
   once, linked to a stock item in Ricotta Restaurant; Items shows its last price paid in plain sizes
   (2,250 IQD / kg), A to Z. A recipe is its name, a category from a prepared list (Cakes, Smoothies...:
   made, renamed and coloured by asking Rico, never typed here), its menu price, its items with amounts,
   steps and notes. Recipes are listed by category, A to Z, each on its category's soft colour.
   They look like the rest of the app: grouped white cards, hairline rows, the app's own buttons.
   Its cost works itself out from the last price paid for each stock item (_shared/recipe-cost.js, the
   same rules the API uses for the alerts), rounded to the nearest 250 IQD. A recipe with an item that has
   no price yet shows no cost at all, and says which one.
   Hold a recipe or an item (right-click on a computer) for its menu: edit or delete. Photos: tap or hold
   one to view or delete it, hold and drag to change their order (the first is the cover).
   Saves carry a version, so one phone can't overwrite another one's edits. Nothing here changes stock. */
const recipeBook = {account:null, data:null, raw:null, loadedAt:0, ctx:null, stockBy:null, loading:false, error:false, page:'list', id:null,
  editing:null, dirty:false, saving:false, saveJob:null, prices:null, pricesBusy:false, pricesPoll:null, timer:null, query:'', ingQuery:'',
  group:'', photos:null, fresh:new Set()};
const rt = k=>t('recipe_' + k);
const RC = ()=>globalThis.RicottaRecipeCost;

function recipeReset(){
  clearTimeout(recipeBook.timer);
  clearTimeout(recipeBook.pricesPoll);
  Object.assign(recipeBook, {account:state.account, data:null, raw:null, loadedAt:0, ctx:null, stockBy:null, loading:false, error:false, page:'list', id:null,
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
  recipeBook.loadedAt = Date.now();
  // A quiet reload that brings nothing new leaves the page alone (a hold or a scroll is not interrupted).
  const raw = r.ok ? JSON.stringify(r.data) : null, same = r.ok && !!recipeBook.data && raw === recipeBook.raw;
  if(r.ok && !same){ recipeBook.raw = raw; recipeBook.data = {...r.data, categories:Array.isArray(r.data.categories) ? r.data.categories : []}; recipeBook.ctx = null; recipeBook.stockBy = null; }
  if(same) return;
  if(r.ok && !recipeBook.prices) recipePricesLoad();
  // While a recipe is being written the page is not drawn again (that would take the cursor away):
  // the new costs show as soon as it is saved or left.
  if(recipeOnScreen() && !recipeBook.editing) render();
  else if(r.ok && recipeOnScreen()) recipeRefreshCategories();
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
/* One short line on how a recipe stands: gray when all is well, amber or red when it needs a look. */
function recipeState(c){
  if(!c.lines.length) return {tone:'', text:rt('stEmpty')};
  if(!c.complete){
    const p = c.problems.find(recipeNoPrice) || c.problems[0];
    return {tone:'amber', text:recipeNoPrice(p) ? rt('stNoPrice')(recipeLtr(p.name || rt('missing')), c.problems.length - 1) : rt('stAmount')(recipeLtr(p.name || rt('missing')))};
  }
  if(c.state === 'loss') return {tone:'red', text:rt('stLoss')};
  if(c.state === 'low') return {tone:'amber', text:rt('stLow')(recipeLtr(c.margin + '%'))};
  if(c.state === 'ok') return {tone:'', text:rt('stProfit')(recipeLtr(c.margin + '%'))};
  return {tone:'', text:rt('stNoMenuPrice')};
}
function recipeLetter(name){ return ([...String(name || '').trim()][0] || '?').toLocaleUpperCase(); }
/* ---------- Categories: a prepared list (Rico adds, renames and colours them; nobody types one here) ---------- */
const recipeCats = ()=>[...(recipeBook.data?.categories || [])].sort((a, b)=>a.name.localeCompare(b.name, state.lang));
const recipeCat = id=>id ? (recipeBook.data?.categories || []).find(c=>c.id === id) || null : null;
/* A category's soft colour as CSS variables, light and dark (the palette is in _shared/recipe-colors.js). */
function recipeTint(cat){
  const c = cat && globalThis.RicottaRecipeColors?.get(cat.color);
  return c ? ` style="--rc-bg:${c.bg};--rc-ink:${c.ink};--rc-bgd:${c.bgDark};--rc-inkd:${c.inkDark}"` : '';
}
/* The recipe's first photo on its category's colour, or its first letter (gray without a category). */
function recipePic(r, cls){
  const cat = recipeCat(r.data?.category), url = recipeBook.data.covers?.[r.id], letter = recipeLetter(r.name);
  return `<span class="rc-pic ${cls}${cat ? ' tinted' : ''}"${recipeTint(cat)} aria-hidden="true">${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" draggable="false" data-letter="${esc(letter)}">` : `<b>${esc(letter)}</b>`}</span>`;
}
/* Out or low in Main Storage, as a short coloured word. */
const recipeStockWord = st=>st === 'empty' ? `<span class="rc-tone red">${esc(rt('out'))}</span>` : st === 'low' ? `<span class="rc-tone amber">${esc(rt('low'))}</span>` : '';
/* Numbers as people type them: Kurdish and Arabic digits, and a comma for the decimal point (1,000 with
   three digits after the comma is a thousand). null when it is not a number above 0. */
function recipeNumber(v){
  let s = String(v ?? '').trim().replace(/[٠-٩]/g, d=>d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d=>d.charCodeAt(0) - 0x6f0).replace(/[٫]/g, '.').replace(/\s/g, '');
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); else s = s.replace(',', '.');
  if(!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
    toast(e === 'recipe_conflict' ? rt('conflict') : e === 'invalid_ingredients' ? rt('badLines') : e === 'unknown_category' ? rt('catGone') : t('saveFailed'), 'error');
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
  return `<div class="field rc-field"><label for="${id}">${esc(label)}</label>${html}${hint ? `<p class="field-hint">${hint}</p>` : ''}</div>`;
}
/* Recipes by category (A to Z), A to Z inside each, the ones without a category last. */
function recipeGroups(rows){
  const by = new Map(recipeCats().map(c=>[c.id, {cat:c, rows:[]}])), none = {cat:null, rows:[]};
  for(const row of rows) (by.get(row.r.data.category) || none).rows.push(row);
  const groups = [...by.values(), none].filter(g=>g.rows.length);
  groups.forEach(g=>g.rows.sort((a, b)=>String(a.r.name).localeCompare(String(b.r.name), state.lang)));
  return groups;
}
/* Rico with a question already written (the person sends it): the chat's own draft, so it waits there. */
function recipeAskRicoFor(text){
  if(typeof ricoDraftKey === 'function') lset(ricoDraftKey(), text);
  goView('assistant');
  setTimeout(()=>{ const i = document.getElementById('ricoInput'); if(i){ i.value = text; i.dispatchEvent(new Event('input')); i.focus(); } }, 120);
}

/* ---------- Pages ---------- */
function renderRecipes(){
  if(recipeBook.account !== state.account) recipeReset();
  if(!recipeBook.data){
    if(!recipeBook.loading && !recipeBook.error) recipeLoad();
    return recipeBook.error ? `<div class="rc-page">${recipeEmpty(t('loadFailed'), '', 'rcRetry', t('retry'))}</div>` : `<div class="rc-page">${loadingLines(5)}</div>`;
  }
  // Categories change by asking Rico: coming back after a while reads the book again, quietly.
  if(!recipeBook.loading && Date.now() - recipeBook.loadedAt > 15000) setTimeout(recipeLoad, 0);
  if(state.view === 'recipeItems') return `<div class="rc-page rc-items-page">${recipeIngredientsPage()}</div>`;
  if(recipeBook.editing) return recipeEditorPage();
  const r = recipeBook.page === 'detail' && recipeCurrent();
  if(r) return recipeDetailPage(r);
  recipeBook.page = 'list';
  return `<div class="rc-page">${recipeListPage()}</div>`;
}
function recipeSearchBox(id, value, label){
  return `<div class="search-wrap rc-search">${ICON_SEARCH}<input id="${id}" class="search-input" type="search" aria-label="${esc(label)}" placeholder="${esc(label)}" value="${esc(value)}" autocomplete="off" enterkeyhint="search" dir="auto"></div>`;
}
const recipeAddBtn = (id, label)=>`<button type="button" class="btn btn-primary rc-add" id="${id}">${ICON_PLUS}<span>${esc(label)}</span></button>`;
/* An empty page: a title, one line and the one button that fills it. */
function recipeEmpty(title, text, id, label, second = ''){
  return `<section class="rc-empty"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
    ${id ? `<button type="button" class="btn btn-primary" id="${id}">${/Retry$/.test(id) ? '' : ICON_PLUS}<span>${esc(label)}</span></button>` : ''}${second}</section>`;
}
function recipeAlerts(){
  const list = (recipeBook.data.alerts || []).filter(a=>!a.read);
  if(!list.length) return '';
  return `<section class="rc-alerts" aria-label="${esc(rt('alerts'))}"><div class="rc-alerts-head"><b>${esc(rt('alerts'))}</b><button type="button" class="rc-link" id="rcAlertsRead">${esc(rt('markRead'))}</button></div>
    ${list.slice(0, 6).map(a=>`<div class="rc-alert"><p>${esc(a[state.lang] || a.en || '')}</p><small>${esc(timeAgo(a.at))}</small></div>`).join('')}</section>`;
}
function recipeRowsFor(){
  const q = foldText(recipeBook.query.trim()), g = recipeBook.group;
  return recipeBook.data.recipes.filter(r=>(!g || r.data.category === g)
    && (!q || foldText(r.name + ' ' + (recipeCat(r.data.category)?.name || '')).includes(q))).map(r=>({r, c:recipeCostOf(r)}));
}
/* One recipe in the list: its picture, its name, how it stands in one line, and a chevron. */
function recipeCard({r, c}){
  const st = recipeState(c), stock = recipeStockIssues(r).length;
  return `<button type="button" class="rc-li rc-rrow" data-rc-open="${esc(r.id)}" aria-haspopup="menu">${recipePic(r, 'rc-thumb')}
    <span class="rc-li-main"><span class="rc-rrow-name" dir="auto">${esc(r.name)}</span><small class="rc-tile-state ${st.tone}">${esc(st.text)}</small>
      ${stock ? `<small class="rc-tile-state red">${esc(rt('stockIssues')(stock))}</small>` : ''}</span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
}
function recipeListHtml(){
  const rows = recipeRowsFor();
  if(!rows.length) return recipeEmpty(rt('noMatch'), rt('noMatchHint'));
  return recipeGroups(rows).map(g=>`<section class="rc-group"><h2 class="section-title" dir="auto">${esc(g.cat?.name || rt('noGroup'))}</h2>
    <div class="rc-list">${g.rows.map(recipeCard).join('')}</div></section>`).join('');
}
/* The categories that have recipes, as the app's pills (All first), when there are two or more. */
function recipeCatPills(){
  const recipes = recipeBook.data.recipes, used = recipeCats().filter(c=>recipes.some(r=>r.data.category === c.id));
  if(recipeBook.group && !used.some(c=>c.id === recipeBook.group)) recipeBook.group = '';
  if(used.length < 2) return '';
  const pill = (id, label, n)=>`<button type="button" class="tab-pill${recipeBook.group === id ? ' active' : ''}" data-rc-group="${esc(id)}" aria-pressed="${recipeBook.group === id}"><span dir="auto">${esc(label)}</span><span class="tab-count">${n}</span></button>`;
  return `<div class="rc-pills" role="group" aria-label="${esc(rt('categories'))}">${pill('', rt('all'), recipes.length)}${used.map(c=>pill(c.id, c.name, recipes.filter(r=>r.data.category === c.id).length)).join('')}</div>`;
}
/* Rico, for recipes: a few questions to tap (only when Rico is on for this account). */
function recipeAskRico(list){
  if(!canOpen('assistant') || typeof ricoAsk !== 'function') return '';
  return `<section class="rc-ask"><h2 class="rc-ask-title">${esc(rt('askRico'))}</h2>
    <div class="rc-ask-list">${list.map(q=>`<button type="button" class="rc-ask-q" data-rc-ask="${esc(q)}" dir="auto">${esc(q)}</button>`).join('')}</div></section>`;
}
function recipeListPage(){
  const d = recipeBook.data;
  if(!d.recipes.length){
    const items = d.ingredients.length;
    return recipeAlerts() + recipeEmpty(rt('emptyRecipesT'), items ? rt('emptyRecipes') : rt('emptyRecipesNoItems'), 'rcNew', rt('addFirstRecipe'),
      items ? '' : `<button type="button" class="btn btn-ghost" id="rcGoItems">${esc(rt('goItems'))}</button>`);
  }
  return `${recipeAlerts()}
    <div class="rc-tools">${recipeSearchBox('rcSearch', recipeBook.query, rt('search'))}${recipeAddBtn('rcNew', rt('new'))}</div>
    ${recipeCatPills()}
    ${!d.pricesReady ? `<p class="rc-note">${esc(rt('pricesOff'))}</p>` : ''}
    <div id="rcList">${recipeListHtml()}</div>
    ${recipeAskRico(t('recipe_ricoChips'))}
    <p class="rc-hint">${esc(rt('holdHint')(recipeTouch()))}</p>`;
}
const recipeTouch = ()=>!matchMedia('(hover: hover) and (pointer: fine)').matches;

/* The money card: what it costs, sells for and keeps, one plain row each, then the margin with a slim
   bar (it fits at any width and in any language), the notes, and See how it adds up. */
function recipeCostCard(c, live){
  const attrs = live ? ' id="rcLive" aria-live="polite"' : '';
  const why = !c.lines.length ? '' : `<button type="button" class="rc-why-row" data-rc-why><span>${esc(rt('whyNumbers'))}</span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
  const row = (k, v, cls = '')=>`<div class="rc-mrow${cls ? ' ' + cls : ''}"><span>${esc(k)}</span><b dir="auto">${v}</b></div>`;
  const none = `<em>${esc(rt('noPriceShort'))}</em>`;
  if(!c.complete) return `<section class="rc-money"${attrs}><p class="rc-missing">${esc(recipeMissingNote(c))}</p>${c.price ? row(rt('sellsFor'), esc(recipeMoney(c.price))) : ''}${why}</section>`;
  const tone = c.state === 'loss' ? 'red' : c.state === 'low' ? 'amber' : c.state === 'ok' ? 'green' : '';
  const pct = c.margin !== null ? Math.max(0, Math.min(100, c.margin)) : 0;
  const notes = [];
  if(!c.price) notes.push(rt('addPriceNote'));
  if(c.losing) notes.push(rt('lossNote'));
  if(c.low) notes.push(rt('lowNote')(recipeLtr((recipeBook.data.marginMin ?? RC().MARGIN_MIN) + '%')));
  if(c.suggested) notes.push(rt('suggested')(recipeMoney(c.suggested), RC().SUGGEST_TIMES));
  return `<section class="rc-money"${attrs}>
    ${row(rt('costs'), esc(recipeMoney(c.cost)))}${row(rt('sellsFor'), c.price ? esc(recipeMoney(c.price)) : none)}
    ${row(rt('weKeep'), c.profit !== null ? esc(recipeMoney(c.profit)) : none, 'strong ' + tone)}
    ${c.margin !== null ? `<div class="rc-mrow rc-margin ${tone}"><span>${esc(rt('margin'))}</span><span class="rc-meter" role="img" aria-label="${esc(rt('marginIs')(c.margin + '%'))}"><i style="width:${pct}%"></i></span><b>${esc(recipeLtr(c.margin + '%'))}</b></div>` : ''}
    ${notes.length ? `<div class="rc-mnotes">${notes.map(n=>`<p>${esc(n)}</p>`).join('')}</div>` : ''}${why}</section>`;
}
const recipeLineCost = l=>l.status === 'ok' ? `<b>${esc(recipeExact(l.cost))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
function recipeLineHtml(l){
  const ing = recipeIngredient(l.ingredient), s = ing ? recipeStock(ing.stock_item) : null;
  const qty = Number(l.qty) > 0 ? esc(recipeLtr(`${recipeQty(l.qty)} ${l.unit}`)) : '', word = recipeStockWord(s?.state);
  return `<div class="rc-li"><span class="rc-li-main"><span dir="auto">${esc(l.name || rt('missing'))}</span>${qty || word ? `<small>${[qty, word].filter(Boolean).join(' · ')}</small>` : ''}</span>
    <span class="rc-li-end">${recipeLineCost(l)}</span></div>`;
}
function recipePhotosHtml(r, photos){
  if(!photos?.list) return `<p class="rc-quiet">${esc(photos?.failed ? t('loadFailed') : t('loading'))}</p>`;
  if(!photos.list.length) return `<button type="button" class="rc-photo-add-big" data-rc-photo-add>${ICON_CAMERA}<span>${esc(rt('addPhotoBig'))}</span></button>`;
  return `<div class="rc-photos" id="rcPhotos">${photos.list.map((p, i)=>`<button type="button" class="rc-photo" data-rc-photo="${esc(p.id)}" aria-haspopup="menu" aria-label="${esc(rt('photoN')(i + 1))}"><img src="${esc(p.url || '')}" loading="lazy" alt="" draggable="false">${i === 0 ? `<span class="rc-cover">${esc(rt('cover'))}</span>` : ''}</button>`).join('')}
    ${photos.list.length < 8 ? `<button type="button" class="rc-photo rc-photo-plus" data-rc-photo-add aria-label="${esc(rt('addPhoto'))}">${ICON_PLUS}</button>` : ''}</div>
    ${photos.list.length > 1 ? `<p class="rc-hint">${esc(rt('photoOrderHint'))}</p>` : ''}`;
}
function recipeDetailPage(r){
  const d = r.data, c = recipeCostOf(r), cat = recipeCat(d.category);
  const photos = recipeBook.photos?.id === r.id ? recipeBook.photos : null;
  const steps = (d.steps || []).filter(s=>s.trim());
  return `<div class="rc-page rc-detail">
    <div class="rc-bar"><button type="button" class="queue-back" id="rcBack" aria-label="${esc(rt('backToRecipes'))}">${ICON_BACK}</button>
      <button type="button" class="btn btn-ghost rc-bar-btn" id="rcEdit">${ICON_EDIT}<span>${esc(rt('edit'))}</span></button></div>
    <header class="rc-head">${recipePic(r, 'rc-hero')}<div class="rc-head-text">
      ${cat ? `<span class="rc-cat"${recipeTint(cat)} dir="auto">${esc(cat.name)}</span>` : ''}<h2 dir="auto">${esc(r.name)}</h2>
      ${d.price ? `<p>${esc(rt('onMenuFor')(recipeMoney(d.price)))}</p>` : ''}</div></header>
    ${recipeCostCard(c)}
    <h3 class="section-title">${esc(rt('ingredients'))}</h3>
    <section class="rc-list">${c.lines.map(recipeLineHtml).join('') || `<p class="rc-quiet">${esc(rt('noLines'))}</p>`}</section>
    <h3 class="section-title">${esc(rt('steps'))}</h3>
    <section class="rc-list">${steps.map((s, i)=>`<div class="rc-li rc-step"><span class="rc-step-n">${i + 1}</span><p dir="auto">${esc(s)}</p></div>`).join('') || `<p class="rc-quiet">${esc(rt('noSteps'))}</p>`}</section>
    ${d.notes ? `<h3 class="section-title">${esc(rt('notes'))}</h3><section class="rc-list"><p class="rc-notes-text" dir="auto">${esc(d.notes)}</p></section>` : ''}
    <h3 class="section-title">${esc(rt('photos'))}</h3>
    <section class="rc-photo-box"><input type="file" id="rcPhoto" accept="image/*" hidden>${recipePhotosHtml(r, photos)}</section>
    ${recipeAskRico([rt('askCheaper')(r.name), rt('askPrice')(r.name)])}
    <p class="rc-hint">${esc(rt('edited')(accountLabel(r.updated_by) || '', formatIraqDateTime(r.updated_at, {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})))}</p></div>`;
}

/* ---------- How it adds up (Where do these numbers come from?) ----------
   One small card per item: what was used, the price per gram, millilitre or piece, and what it costs,
   with the last price paid under it. Then the sum, step by step, down to what we keep. */
function recipeWhySheet(r){
  const c = recipeCostOf(r), ctx = recipeCtx();
  const lines = c.lines.map(l=>{
    const p = l.stockItem ? ctx.price(l.stockItem) : null, ok = p && !p.error && p.currency === 'IQD';
    const sizes = ok ? recipeSizes(p) : [];
    const used = Number(l.qty) > 0 ? recipeLtr(recipeQty(l.qty) + ' ' + l.unit) : '';
    return `<div class="rc-why-card">
      <div class="rc-why-top"><b dir="auto">${esc(l.name || rt('missing'))}</b>${l.status === 'ok' ? `<span class="rc-why-cost">${esc(recipeExact(l.cost))}</span>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`}</div>
      ${used ? `<p class="rc-why-math"><bdi dir="ltr">${esc(used)}</bdi>${ok && sizes.length ? ` × <bdi dir="ltr">${esc(sizes[sizes.length - 1])}</bdi>` : ''}</p>` : ''}
      ${ok ? `<p class="rc-why-paid">${esc(rt('paidLine')(recipeExact(p.cost), p.unit || p.base, recipeDay(p.day), p.supplier || ''))}</p>` : ''}</div>`;
  }).join('') || `<p class="rc-quiet">${esc(rt('noLines'))}</p>`;
  const step = (k, v, cls = '')=>`<div class="rc-sum-row ${cls}"><span>${esc(k)}</span><b dir="auto">${v}</b></div>`;
  const sum = c.complete ? `<div class="rc-sum">${step(rt('total'), esc(recipeExact(c.total)))}${step(rt('rounded'), esc(recipeMoney(c.cost)), 'strong')}
      ${c.price ? step(rt('sellsFor'), esc(recipeMoney(c.price))) + step(rt('weKeep'), esc(rt('minus')(recipeMoney(c.price), recipeMoney(c.cost), recipeMoney(c.profit))), 'strong') + step(rt('margin'), esc(rt('divide')(recipeMoney(c.profit), recipeMoney(c.price), recipeLtr(c.margin + '%')))) : ''}</div>
      <p class="rc-hint">${esc(rt('roundNote'))}</p>`
    : `<p class="rc-missing rc-missing-box">${esc(recipeMissingNote(c))}</p>`;
  openKitchenSheet('rc-why-sheet', `<div class="rc-work"><div class="sel-title">${esc(rt('whyNumbers'))}</div><p class="rc-why-intro">${esc(rt('whyIntro'))}</p><div class="rc-why-list">${lines}</div>${sum}</div>`, rt('whyNumbers'));
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
/* One line: the item's name, how much (a plain box wide enough to read, no up and down arrows), its
   unit, what it costs and remove. On a computer all in one row; on a phone the name has its own row. */
function recipeEditLine(l, i, cost){
  const ing = recipeIngredient(l.ingredient), s = ing ? recipeStock(ing.stock_item) : null, name = ing?.name || rt('missing'), word = recipeStockWord(s?.state);
  return `<div class="rc-eline${recipeBook.fresh.has(i) ? ' rc-in' : ''}" data-rc-line="${i}">
    <span class="rc-eline-name" dir="auto">${esc(name)}${word ? ` <small>${word}</small>` : ''}</span>
    <input class="rc-qty" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" dir="ltr" data-rc-qty="${i}" aria-label="${esc(rt('amountOf')(name))}" placeholder="${esc(rt('amount'))}" value="${l.qty ?? ''}">
    <span class="rc-unit"><select data-rc-unit="${i}" data-inline aria-label="${esc(rt('unit'))}">${recipeUnitOptions(l.unit, ing?.stock_item)}</select></span>
    <span class="rc-eline-cost" data-rc-linecost="${i}">${cost}</span>
    <button type="button" class="rc-x" data-rc-remove="${i}" aria-label="${esc(rt('removeLine'))}">${ICON_CLOSE_SM}</button></div>`;
}
/* The category: one of the prepared ones, from a list. A new one is made by asking Rico. */
function recipeCategoryField(value){
  const cats = recipeCats(), rico = canOpen('assistant') && typeof ricoAsk === 'function';
  const ask = rico ? `<button type="button" class="rc-link" data-rc-ask-cat>${esc(rt('askRicoCat'))}</button>` : '';
  if(!cats.length) return `<div class="field rc-field" id="rcCatField"><span class="rc-label">${esc(rt('category'))}</span>
    <div class="rc-cat-empty"><p>${esc(rico ? rt('noCatsRico') : rt('noCatsRozh'))}</p>${rico ? `<button type="button" class="btn btn-ghost" data-rc-ask-cat>${esc(rt('askRicoCat'))}</button>` : ''}</div></div>`;
  const known = !value || cats.some(c=>c.id === value);
  return `<div id="rcCatField">${recipeField(rt('category'), `<select id="rcCategory"><option value="">${esc(rt('noCategory'))}</option>${cats.map(c=>`<option value="${esc(c.id)}" ${c.id === value ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${known ? '' : `<option value="${esc(value)}" selected>${esc(rt('noCategory'))}</option>`}</select>`,
    `${esc(rico ? rt('catHintRico') : rt('catHintRozh'))} ${ask}`)}</div>`;
}
function recipeEditorPage(){
  const r = recipeBook.editing, d = r.data, c = recipeCostOf(r);
  const html = `<div class="rc-page rc-editor">
    <div class="rc-bar"><button type="button" class="queue-back" id="rcEditBack" aria-label="${esc(rt('back'))}">${ICON_BACK}</button>
      <h2 dir="auto">${esc(r.version ? rt('editRecipe') : rt('new'))}</h2><span class="rc-save-state" id="rcSaveState" role="status" data-tone="${recipeBook.dirty ? '' : r.version ? 'done' : ''}">${esc(recipeBook.dirty ? rt('unsaved') : r.version ? rt('saved') : '')}</span><button type="button" class="btn btn-primary rc-bar-btn" id="rcDone">${esc(rt('doneSave'))}</button></div>
    <section class="form-card rc-form">
      ${recipeField(rt('menuName'), `<input id="rcName" class="rc-name" maxlength="120" value="${esc(r.name)}" dir="auto" autocomplete="off" enterkeyhint="next" placeholder="${esc(rt('menuNameHint'))}">`)}
      ${recipeCategoryField(d.category)}
      ${recipeField(rt('menuPriceIqd'), `<input id="rcPrice" type="text" inputmode="numeric" autocomplete="off" dir="ltr" value="${d.price ?? ''}" placeholder="${esc(rt('pricePlaceholder'))}">`)}
    </section>
    <h3 class="section-title">${esc(rt('ingredients'))}</h3>
    <section class="rc-list rc-elines">${c.lines.map((l, i)=>recipeEditLine(d.lines[i], i, recipeLineCost(l))).join('') || `<p class="rc-quiet">${esc(recipeBook.data.ingredients.length ? rt('pickFirst') : rt('noIngredientsYet'))}</p>`}
      <button type="button" class="rc-add-row" id="rcAddLine">${ICON_PLUS}<span>${esc(rt('addIngredient'))}</span></button></section>
    <h3 class="section-title">${esc(rt('cost'))}</h3>
    ${recipeCostCard(c, true)}
    <h3 class="section-title">${esc(rt('steps'))}</h3>
    <section class="rc-list">${d.steps.map((s, i)=>`<div class="rc-estep"><span class="rc-step-n" aria-hidden="true">${i + 1}</span><textarea class="rc-grow" id="rcStep${i}" data-rc-step="${i}" maxlength="3000" rows="1" dir="auto" aria-label="${esc(rt('stepN')(i + 1))}" placeholder="${esc(rt('stepHint'))}">${esc(s)}</textarea>
        <button type="button" class="rc-x" data-rc-delstep="${i}" aria-label="${esc(rt('removeStep'))}">${ICON_CLOSE_SM}</button></div>`).join('')}
      <button type="button" class="rc-add-row" id="rcAddStep">${ICON_PLUS}<span>${esc(rt('addStep'))}</span></button></section>
    <h3 class="section-title">${esc(rt('notes'))}</h3>
    <section class="rc-list rc-notes-card"><textarea class="rc-notes-box rc-grow" data-rc-field="notes" maxlength="8000" rows="2" dir="auto" aria-label="${esc(rt('notes'))}" placeholder="${esc(rt('notesHint'))}">${esc(d.notes)}</textarea></section>
    ${r.version ? `<section class="rc-list rc-delete-card"><button type="button" class="rc-delete-row" id="rcDeleteRecipe">${esc(rt('deleteRecipe'))}</button></section>` : ''}</div>`;
  recipeBook.fresh.clear();
  return html;
}
/* Steps and notes grow with what is written, so the whole text always shows (no scrolling inside the
   box, no dragging its corner). */
function recipeGrow(el){
  if(!el?.isConnected) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
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
/* The category list again after the book was read (a category added by asking Rico shows at once). */
function recipeRefreshCategories(){
  const box = document.getElementById('rcCatField'), r = recipeBook.editing;
  if(!box || !r || document.activeElement?.closest?.('#rcCatField')) return;
  box.outerHTML = recipeCategoryField(r.data.category);
  if(typeof enhanceSelects === 'function') enhanceSelects(document.getElementById('rcCatField') || document);
  recipeBindCategory();
}
/* Adding an item to a recipe: a sheet with every item A to Z and a search box (the ones the recipe
   already uses are left out), and New item at the bottom. */
function recipePickItem(onPick){
  const used = new Set(recipeBook.editing?.data.lines.map(l=>l.ingredient) || []);
  const all = [...recipeBook.data.ingredients].filter(i=>!used.has(i.id)).sort((a, b)=>a.name.localeCompare(b.name, state.lang));
  const S = globalThis.RicottaSearch;
  const rows = q=>{ const list = q.trim() && S ? S.rank(all, q, i=>[i.name, i.stock_item]) : all;
    return list.map(i=>{ const p = recipeIngredientPrice(i);
      return `<button type="button" class="rc-li rc-pick-row" data-rc-pick="${esc(i.id)}"><span class="rc-li-main"><span dir="auto">${esc(i.name)}</span>${foldText(recipeStockName(i.stock_item)) !== foldText(i.name) ? `<small dir="auto">${esc(recipeStockName(i.stock_item))}</small>` : ''}</span><span class="rc-price${p.ok ? '' : ' none'}" dir="auto">${esc(p.text)}</span></button>`; }).join('')
      || `<p class="rc-quiet">${esc(all.length ? rt('noMatch') : rt('allUsed'))}</p>`; };
  const {el, close} = openKitchenSheet('rc-pick-sheet', `<div class="rc-pick"><div class="sel-title">${esc(rt('addIngredient'))}</div>
    ${recipeSearchBox('rcPickSearch', '', rt('searchIngredients'))}<div class="rc-list rc-pick-list" id="rcPickList">${rows('')}</div>
    <button type="button" class="rc-add-row" id="rcPickNew">${ICON_PLUS}<span>${esc(rt('newIngredient'))}</span></button></div>`, rt('addIngredient'));
  const bind = ()=>el.querySelectorAll('[data-rc-pick]').forEach(b=>b.onclick = ()=>{ close(); onPick(recipeIngredient(b.dataset.rcPick)); });
  const search = el.querySelector('#rcPickSearch');
  search.oninput = ()=>{ el.querySelector('#rcPickList').innerHTML = rows(search.value); bind(); };
  el.querySelector('#rcPickNew').onclick = ()=>{ close(); recipeIngredientForm(null, ing=>onPick(ing)); };
  bind();
  if(!recipeTouch()) setTimeout(()=>search.focus({preventScroll:true}), 60);
}

/* ---------- Items (the Items tab) ---------- */
const recipeUsers = id=>recipeBook.data.recipes.filter(r=>(r.data.lines || []).some(l=>l.ingredient === id));
const recipeUses = id=>recipeUsers(id).length;
const recipeNameList = names=>{ const list = names.slice(0, 4).map(n=>recipeLtr(n)); const more = names.length - list.length;
  return (list.length === 1 ? list[0] : rt('and')(list.slice(0, -1).join(rt('comma')), list.at(-1))) + (more > 0 ? rt('andMore')(more) : ''); };
function recipeIngredientPrice(i){
  const d = recipeBook.data, s = recipeStock(i.stock_item), p = recipeCtx().price(i.stock_item);
  if(!s && d.stock.length) return {ok:false, text:rt('whyGone')};
  if(p && !p.error && p.currency === 'IQD' && p.perBase > 0) return {ok:true, p, text:recipePriceShort(p)};
  return {ok:false, text:p && p.currency !== 'IQD' ? rt('whyUsd') : p?.error ? rt('whyBuyUnit')(p.unit, p.base) : rt('noPriceYet')};
}
function recipeIngredientRow(i){
  const s = recipeStock(i.stock_item), price = recipeIngredientPrice(i), word = recipeStockWord(s?.state);
  return `<button type="button" class="rc-li rc-irow" data-rc-ingredient="${esc(i.id)}" aria-haspopup="menu">
    <span class="rc-li-main"><span class="rc-irow-name" dir="auto">${esc(i.name)}</span><small>${esc(rt('usedIn')(recipeUses(i.id)))}${word ? ' · ' + word : ''}</small></span>
    <span class="rc-price${price.ok ? '' : ' none'}" dir="auto">${esc(price.text)}</span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
}
function recipeIngRows(){
  const q = recipeBook.ingQuery.trim(), S = globalThis.RicottaSearch, all = [...recipeBook.data.ingredients].sort((a, b)=>a.name.localeCompare(b.name, state.lang));
  return q && S ? S.rank(all, q, i=>[i.name, i.stock_item]) : all;
}
function recipeIngListHtml(){
  const rows = recipeIngRows();
  return rows.length ? `<div class="rc-list">${rows.map(recipeIngredientRow).join('')}</div>` : recipeEmpty(rt('noMatch'), rt('noMatchHint'));
}
function recipeIngredientsPage(){
  const d = recipeBook.data;
  const foot = `${!d.pricesReady ? `<p class="rc-note">${esc(rt('pricesOff'))}</p>` : ''}${!d.stockAt ? `<p class="rc-note">${esc(t('rrNoCatalog'))}</p>` : ''}`;
  if(!d.ingredients.length) return recipeEmpty(rt('emptyItemsT'), rt('emptyItems'), 'rcIngredientNew', rt('addFirstIngredient')) + foot;
  return `<div class="rc-tools">${recipeSearchBox('rcIngSearch', recipeBook.ingQuery, rt('searchIngredients'))}${recipeAddBtn('rcIngredientNew', rt('newIngredient'))}</div>
    ${recipePricesBar()}
    <div id="rcIngList">${recipeIngListHtml()}</div>
    ${recipeAskRico(t('recipe_ricoItemChips'))}
    <p class="rc-hint">${esc(rt('ingredientsNote'))} ${esc(rt('holdHintIng')(recipeTouch()))}</p>${foot}`;
}
/* Add or change an item: its name, the stock item it is, and the unit new lines start with (only the
   stock item's own units). The stock item is picked from a search: with nothing typed in it, the best
   matches for the item's name come first; typing searches every stock item by its name in any language
   and by the names the ordering items linked to it go by. One tap links it; a name that doesn't look
   like the stock item gets a warning only (Ahmad decides). Its last price shows straight away. */
function recipeIngredientForm(id, onSaved){
  const d = recipeBook.data, old = recipeIngredient(id), stock = [...d.stock].sort((a, b)=>a.name.localeCompare(b.name));
  const users = old ? recipeUsers(old.id).map(r=>r.name) : [];
  let chosen = old?.stock_item || '', picking = !old, query = '';
  showFormModal({title:esc(old ? rt('editIngredient') : rt('newIngredient')),
    bodyHtml:recipeField(rt('ingredientName'), `<input id="rcIngName" maxlength="120" value="${esc(old?.name || '')}" dir="auto" autocomplete="off" placeholder="${esc(rt('ingredientNameHint'))}">`)
      + `<div class="field rc-field rc-stock-field" id="rcIngStockBox"></div>`
      + recipeField(rt('usualUnit'), `<select id="rcIngUnit">${recipeUnitOptions(old?.unit || '', old?.stock_item)}</select>`, esc(rt('unitsHint')))
      + (users.length ? `<p class="field-hint rc-used-note">${esc(rt('usedBy')(recipeNameList(users)))}</p>` : ''),
    okLabel:t('save'),
    againLabel:old && !users.length ? t('delete') : '',
    onSubmit:async again=>{
      if(again){
        if(!(await showConfirm(esc(rt('deleteIngredientAsk')(old.name)), {okLabel:t('delete')}))) return {keepOpen:true};
        const r = await recipeDeleteIngredient(old);
        return r ? undefined : {keepOpen:true};
      }
      const name = document.getElementById('rcIngName').value.trim(), unit = document.getElementById('rcIngUnit').value;
      if(!name) return {error:rt('needName')};
      if(!chosen) return {error:rt('needStock')};
      if(!unit) return {error:rt('needUnit')};
      const r = await api('recipe-ingredients/' + (old?.id || crypto.randomUUID()), {method:'PUT', body:{name, stock_item:chosen, unit, category:old?.category || '', version:old?.version || 0}});
      if(!r.ok){ const e = r.data?.error; return {error:e === 'recipe_conflict' ? rt('conflict') : e === 'unknown_unit' ? rt('unknownUnit') : e === 'invalid_stock_link' ? rt('whyGone') : t('saveFailed')}; }
      const i = d.ingredients.findIndex(x=>x.id === r.data.id);
      if(i < 0) d.ingredients.push(r.data); else d.ingredients[i] = r.data;
      d.ingredients.sort((a, b)=>a.name.localeCompare(b.name));
      recipeBook.ctx = null;
      toast(old ? rt('ingredientSaved') : rt('ingredientAdded'));
      // A new stock item has no price in the list yet: the next load brings it.
      if(!d.prices[chosen]) setTimeout(recipeLoad, 0);
      if(onSaved) onSaved(r.data); else render();
    }});
  setTimeout(()=>{
    const nameEl = document.getElementById('rcIngName'), box = document.getElementById('rcIngStockBox'), unitEl = document.getElementById('rcIngUnit');
    if(!nameEl || !box) return;
    const L = globalThis.RicottaStockLink, S = globalThis.RicottaSearch;
    let unitTouched = !!old, auto = false;
    // Only the stock item's own units; the usual unit starts as its base unit when Manage has it.
    const fillUnits = ()=>{
      if(!unitEl) return;
      const keep = unitEl.value, fit = recipeUnitsFor(chosen);
      unitEl.innerHTML = recipeUnitOptions(fit.some(u=>u.id === keep) ? keep : '', chosen);
      const s = stock.find(x=>x.name === chosen);
      if(!unitTouched && s && S){ const m = S.unit(fit.map(u=>u.en), s.base); const u = m && fit.find(x=>x.en === m); if(u){ auto = true; unitEl.value = u.id; auto = false; } }
      if(!unitEl.value && fit.length === 1) unitEl.value = fit[0].id;
      unitEl.dispatchEvent(new Event('change', {bubbles:true}));
    };
    const warnText = ()=>{ const name = nameEl.value.trim(); return name && chosen && L && !L.matches({name}, chosen) ? rt('nameWarn') : ''; };
    const opt = s=>{ const p = recipeIngredientPrice({stock_item:s.name});
      return `<button type="button" class="stock-opt${s.name === chosen ? ' on' : ''}" role="option" aria-selected="${s.name === chosen}" data-rc-stock="${esc(s.name)}"><span dir="auto">${esc(s.name)}</span><small dir="auto">${esc(p.text)}</small></button>`; };
    const paintList = ()=>{
      const list = box.querySelector('#rcIngStockList'); if(!list) return;
      const q = query.trim(), name = nameEl.value.trim();
      if(!stock.length){ list.innerHTML = `<div class="field-hint">${esc(t('rrNoCatalog'))}</div>`; return; }
      const rows = q && S ? S.rank(stock, q, s=>[s.name, ...(s.aka || [])]).slice(0, 12) : name && L ? L.suggest({name}, stock, 8) : [];
      list.innerHTML = (!q && rows.length ? `<div class="rc-pick-head">${esc(rt('suggestedStock'))}</div>` : '') + (rows.map(opt).join('')
        || `<div class="field-hint">${esc(q ? t('rrNoMatch') : name ? rt('noStockMatch') : rt('typeToFind'))}</div>`);
    };
    const paint = ()=>{
      const p = chosen ? recipeIngredientPrice({stock_item:chosen}) : null, warn = warnText();
      box.innerHTML = `<label for="${picking ? 'rcIngStockSearch' : 'rcIngStockChange'}">${esc(rt('stockItem'))}</label>
        ${chosen ? `<div class="stock-link-now"><span class="stock-link-name" dir="auto">${esc(chosen)}</span><small>${esc(rt('lastPrice'))}: <b class="rc-tone${p.ok ? '' : ' amber'}">${esc(p.text)}</b></small></div>` : ''}
        <p class="field-hint warn" id="rcIngWarn">${esc(warn)}</p>
        ${picking ? `<div class="stock-pick"><input id="rcIngStockSearch" class="stock-pick-input" type="search" autocomplete="off" dir="auto" placeholder="${esc(rt('searchStock'))}" value="${esc(query)}"><div class="stock-pick-list" role="listbox" id="rcIngStockList" aria-label="${esc(rt('stockItem'))}"></div></div>`
          : `<div class="stock-link-actions"><button type="button" class="btn btn-ghost" id="rcIngStockChange">${esc(rt('changeStock'))}</button></div>`}`;
      if(picking){ paintList(); const input = box.querySelector('#rcIngStockSearch'); input.oninput = ()=>{ query = input.value; paintList(); }; input.onkeydown = e=>{ if(e.key === 'Enter') e.preventDefault(); }; }
    };
    box.addEventListener('click', e=>{
      const b = e.target.closest('[data-rc-stock]');
      if(b){ chosen = b.dataset.rcStock; picking = false; query = ''; fillUnits(); paint(); haptic('light'); return; }
      if(e.target.closest('#rcIngStockChange')){ picking = true; paint(); box.querySelector('#rcIngStockSearch')?.focus(); }
    });
    nameEl.addEventListener('input', ()=>{ if(picking && !query.trim()) paintList(); const w = box.querySelector('#rcIngWarn'); if(w) w.textContent = warnText(); });
    unitEl?.addEventListener('change', ()=>{ if(!auto) unitTouched = true; });
    if(chosen) fillUnits();
    paint();
    if(!old) nameEl.focus({preventScroll:true});
  }, 0);
}
/* An item a recipe uses can't be deleted: the message says which recipes, so Ahmad knows where to take
   it out first. The server checks too (it answers with their names). */
async function recipeDeleteIngredient(ing){
  const local = recipeUsers(ing.id).map(r=>r.name);
  if(local.length){ await showAlert(esc(rt('inUseNamed')(recipeNameList(local))), {title:rt('cantDelete')}); return false; }
  const d = recipeBook.data, r = await api('recipe-ingredients/' + ing.id, {method:'DELETE'});
  if(!r.ok){
    if(r.data?.error === 'ingredient_in_use'){ const names = Array.isArray(r.data.recipes) ? r.data.recipes : []; await showAlert(esc(names.length ? rt('inUseNamed')(recipeNameList(names)) : rt('inUse')), {title:rt('cantDelete')}); recipeLoad(); }
    else toast(t('saveFailed'), 'error');
    return false;
  }
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
  recipeMenu(row, [['edit', rt('edit'), ICON_EDIT, false, ()=>recipeIngredientForm(ing.id)],
    ['delete', t('delete'), ICON_DELETE, true, async ()=>{
      // In a recipe: say which ones, nothing to confirm. Not in one: ask, then delete.
      if(recipeUses(ing.id)){ recipeDeleteIngredient(ing); return; }
      if(await showConfirm(esc(rt('deleteIngredientAsk')(ing.name)), {okLabel:t('delete')})) recipeDeleteIngredient(ing);
    }]]);
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
    recipeBook.photos = null; recipeBook.raw = null;
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
  recipeBook.photos = null; recipeBook.raw = null;
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
  root.querySelectorAll('.rc-pic img').forEach(img=>{ img.onerror = ()=>{ const b = document.createElement('b'); b.textContent = img.dataset.letter || '?'; img.replaceWith(b); }; });
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
  return `<div class="rc-prices" id="rcPricesBar"><span class="rc-prices-when">${esc(busy ? rt('pricesReading') : when)}</span>
    <button type="button" class="rr-ctl" id="rcPrices" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '<i class="rr-spin" aria-hidden="true"></i>' : ''}${esc(rt('pricesCheck'))}</button></div>`;
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

/* The category list in the form: picking one saves; Ask Rico opens Rico with the question written. */
function recipeBindCategory(){
  const r = recipeBook.editing;
  const sel = document.getElementById('rcCategory');
  if(sel && r) sel.onchange = ()=>{ r.data.category = sel.value; recipeChange(); haptic('light'); };
  document.querySelectorAll('[data-rc-ask-cat]').forEach(b=>b.onclick = ()=>recipeAskRicoFor(rt('askCatQ')));
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
    recipeBook.group = recipeBook.group === b.dataset.rcGroup ? '' : b.dataset.rcGroup;
    all('[data-rc-group]', x=>{ const v = recipeBook.group === x.dataset.rcGroup; x.classList.toggle('active', v); x.setAttribute('aria-pressed', String(v)); });
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
  recipeBindCategory();
  const notes = document.querySelector('[data-rc-field="notes"]');
  if(notes) notes.oninput = ()=>{ d.notes = notes.value; recipeGrow(notes); recipeChange(); };
  const price = document.getElementById('rcPrice');
  if(price) price.oninput = ()=>{ const v = recipeNumber(price.value); d.price = v ? Math.round(v) : null; recipeChange(); recipeRefreshLive(); };
  all('[data-rc-qty]', el=>el.oninput = ()=>{
    const v = recipeNumber(el.value);
    d.lines[Number(el.dataset.rcQty)].qty = v ? Math.min(999999, Math.round(v * 1000) / 1000) : null;
    recipeChange(); recipeRefreshLive();
  });
  all('[data-rc-unit]', el=>el.onchange = ()=>{ d.lines[Number(el.dataset.rcUnit)].unit = el.value; recipeChange(); recipeRefreshLive(); });
  all('[data-rc-step]', el=>el.oninput = ()=>{ d.steps[Number(el.dataset.rcStep)] = el.value; recipeGrow(el); recipeChange(); });
  all('textarea.rc-grow', recipeGrow);
  all('[data-rc-remove]', b=>b.onclick = ()=>{
    const line = b.closest('.rc-eline'), go = ()=>{ d.lines.splice(Number(b.dataset.rcRemove), 1); redraw(); };
    if(line?.animate && !reducedMotion()) line.animate([{opacity:1}, {opacity:0}], {duration:140, easing:'ease-in'}).onfinish = go; else go();
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

/* ---------- Rico's colour card (assistant.js shows it for a 'recipe_colors' card) ----------
   The ten colours with their names; the one in use is ticked. A tap sets it at once. */
function recipeColorCard(p){
  const C = globalThis.RicottaRecipeColors;
  if(!C || !canOpen('recipes') || !p.categoryId) return '';
  return `<div class="rico-data rc-colors" data-card="${esc(p.id)}"><div class="rico-data-head"><span class="rico-data-title" dir="auto">${esc(rt('colorFor')(p.category || ''))}</span></div>
    <div class="rc-swatches" role="radiogroup" aria-label="${esc(rt('colorFor')(p.category || ''))}">${C.PALETTE.map(c=>`<button type="button" class="rc-swatch${c.key === p.color ? ' on' : ''}" role="radio" aria-checked="${c.key === p.color}" data-rc-color="${c.key}" data-rc-catid="${esc(p.categoryId)}" data-rc-card="${esc(p.id)}">
      <i class="rc-pic tinted" style="--rc-bg:${c.bg};--rc-ink:${c.ink};--rc-bgd:${c.bgDark};--rc-inkd:${c.inkDark}" aria-hidden="true">${c.key === p.color ? ICON_CHECK : ''}</i><span>${esc(rt('colorName')(c.key))}</span></button>`).join('')}</div></div>`;
}
document.addEventListener('click', async e=>{
  const b = e.target.closest?.('[data-rc-color]');
  if(!b || b.disabled) return;
  const key = b.dataset.rcColor, id = b.dataset.rcCatid, card = b.closest('.rc-colors');
  card?.querySelectorAll('[data-rc-color]').forEach(x=>{ x.disabled = true; });
  const r = await api('recipe-categories/' + id, {method:'PUT', body:{color:key}});
  card?.querySelectorAll('[data-rc-color]').forEach(x=>{ x.disabled = false; });
  if(!r.ok){ toast(r.data?.error === 'not_found' ? rt('catGone') : t('saveFailed'), 'error'); return; }
  card?.querySelectorAll('[data-rc-color]').forEach(x=>{ const v = x.dataset.rcColor === key; x.classList.toggle('on', v); x.setAttribute('aria-checked', String(v)); x.querySelector('i').innerHTML = v ? ICON_CHECK : ''; });
  // The card remembers it (it is drawn again from its message), and the recipe book shows it next time.
  for(const m of (typeof rico !== 'undefined' ? rico.messages : [])) for(const p of m.proposals || []) if(p.id === b.dataset.rcCard) p.color = key;
  const cat = recipeBook.data?.categories?.find(c=>c.id === id);
  if(cat) cat.color = key;
  haptic('light');
  toast(rt('colorSaved'));
});

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
