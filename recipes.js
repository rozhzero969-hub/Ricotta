/* Recipes: the shared recipe book (Ahmad's tab).
   Ahmad adds every recipe himself. Each ingredient is linked once to a stock item in Ricotta
   Restaurant, and each recipe line says how much of it the recipe uses (grams, millilitres, pieces or
   any unit from Manage, Units). The cost then works itself out from the last price paid for that stock
   item (_shared/recipe-cost.js, the same rules the API uses for the alerts). A line without an amount
   or a price is shown as missing, never as 0. Everything is in IQD.
   Saves carry a version, so one cook can't overwrite another cook's edits. Nothing here changes stock. */
const recipeBook = {account:null, data:null, ctx:null, stockBy:null, loading:false, error:false, page:'list', id:null,
  editing:null, dirty:false, saving:false, saveJob:null, timer:null, query:'', ingQuery:'', filter:'all', scale:1,
  cooking:false, wake:null, photos:null};
const rt = k=>t('recipe_' + k);
const RC = ()=>globalThis.RicottaRecipeCost;

function recipeReset(){
  clearTimeout(recipeBook.timer);
  recipeBook.wake?.release().catch(()=>{});
  Object.assign(recipeBook, {account:state.account, data:null, ctx:null, stockBy:null, loading:false, error:false, page:'list', id:null,
    editing:null, dirty:false, saving:false, saveJob:null, query:'', ingQuery:'', filter:'all', scale:1, cooking:false, wake:null, photos:null});
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
  // While a recipe is being written the page is not drawn again (that would take the cursor away):
  // the new costs show as soon as it is saved or left.
  if(state.view === 'recipes' && !recipeBook.editing) render();
}

/* ---------- Costs, from the same rules as the API ---------- */
function recipeCtx(){
  const d = recipeBook.data;
  return recipeBook.ctx ||= RC().context({ingredients:d.ingredients, titems:d.stock, units:d.units, prices:d.prices, catalog:d.stock.length > 0});
}
const recipeCostOf = r=>RC().recipeCost(r, recipeCtx(), recipeBook.data.marginMin ?? RC().MARGIN_MIN);
const recipeIngredient = id=>recipeBook.data?.ingredients.find(x=>x.id === id);
const recipeCurrent = ()=>recipeBook.data?.recipes.find(x=>x.id === recipeBook.id);
function recipeStock(name){
  if(!recipeBook.stockBy) recipeBook.stockBy = new Map((recipeBook.data?.stock || []).map(s=>[s.name, s]));
  return recipeBook.stockBy.get(name) || null;
}
const recipeQty = n=>Number(Number(n).toFixed(3)).toLocaleString('en-US', {maximumFractionDigits:3});
const recipeUnit = id=>recipeCtx().unit(id) || '';
/* 6,000 IQD. A cost under 10 IQD keeps one decimal, so a pinch of salt isn't shown as 0. */
function recipeMoney(n){
  if(n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  // Kept left to right inside Kurdish and Arabic text, so it reads 6,000 IQD and never IQD 6,000.
  return '\u2066' + v.toLocaleString('en-US', {maximumFractionDigits:Math.abs(v) < 10 && v % 1 ? 1 : 0}) + ' IQD\u2069';
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
/* One short line on how a recipe stands, with the colour of its dot. */
function recipeState(c){
  if(!c.lines.length) return {tone:'gray', text:rt('stEmpty')};
  if(c.state === 'loss') return {tone:'red', text:rt('stLoss')};
  if(c.state === 'low') return {tone:'amber', text:rt('stLow')(c.margin)};
  if(c.missing) return {tone:'gray', text:rt('stMissing')(c.missing)};
  if(c.state === 'ok') return {tone:'green', text:rt('stMargin')(c.margin)};
  return {tone:'gray', text:rt('stNoPrice')};
}
const recipeNeedsLook = (r, c)=>c.state === 'loss' || c.state === 'low' || c.missing > 0 || recipeStockIssues(r).length > 0;
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
  recipeBook.editing = {id:crypto.randomUUID(), name:'', version:0, archived:false,
    data:{status:'draft', category:'', yield:1, yieldUnit:'', prep:0, cook:0, price:null, currency:'IQD', lines:[], steps:[''], notes:''}};
  recipeBook.dirty = false;
  render();
}
function recipeEdit(r){
  const copy = structuredClone(r);
  copy.data = {price:null, currency:'IQD', ...copy.data};
  recipeBook.editing = copy;
  recipeBook.dirty = false;
  render();
}
async function recipeSave(loud = false){
  if(recipeBook.saveJob){ const ok = await recipeBook.saveJob; if(!ok) return false; return recipeBook.dirty ? recipeSave(loud) : true; }
  const job = recipePerformSave(loud);
  recipeBook.saveJob = job;
  try{ return await job; } finally { if(recipeBook.saveJob === job) recipeBook.saveJob = null; }
}
const recipeEditable = r=>JSON.stringify({name:r.name, data:r.data, archived:r.archived});
/* Ready means a cook can follow it: every line has its amount, and there is at least one step. */
const recipeIncomplete = r=>r.data.status === 'ready' && (!r.data.lines.length || r.data.lines.some(l=>!(Number(l.qty) > 0)) || !r.data.steps.some(s=>s.trim()));
/* Saving while typing stays quiet; loud (Done, leaving) says what is wrong. */
async function recipePerformSave(loud = false){
  const r = recipeBook.editing;
  if(!r || !recipeBook.dirty) return true;
  if(recipeBook.saving) return false;
  if(!r.name.trim()){ if(loud) toast(rt('required'), 'error'); recipeSaveLabel(rt('unsaved')); return false; }
  if(recipeIncomplete(r)){ if(loud) toast(rt('incomplete'), 'error'); recipeSaveLabel(rt('incompleteShort')); return false; }
  recipeBook.saving = true;
  recipeSaveLabel(rt('saving'));
  const account = state.account, sent = recipeEditable(r), answer = await api('recipes/' + r.id, {method:'PUT', body:r});
  if(account !== state.account) return false;
  recipeBook.saving = false;
  if(!answer.ok){
    const e = answer.data?.error;
    toast(e === 'recipe_conflict' ? rt('conflict') : e === 'incomplete_recipe' ? rt('incomplete') : e === 'invalid_ingredients' ? rt('badLines') : t('saveFailed'), 'error');
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

/* ---------- Pages ---------- */
function renderRecipes(){
  if(recipeBook.account !== state.account) recipeReset();
  if(!recipeBook.data){
    if(!recipeBook.loading && !recipeBook.error) recipeLoad();
    return recipeBook.error ? `<div class="rc-page">${emptyState(esc(t('loadFailed')))}<div class="rc-center"><button type="button" class="btn btn-primary" id="rcRetry">${esc(t('retry'))}</button></div></div>` : loadingLines(5);
  }
  if(recipeBook.editing) return recipeEditorPage();
  if(recipeBook.page === 'ingredients') return recipeIngredientsPage();
  const r = recipeBook.page === 'detail' && recipeCurrent();
  if(r) return recipeDetailPage(r);
  recipeBook.page = 'list';
  return recipeListPage();
}
function recipeSearchBox(id, value, label){
  return `<div class="list-search rc-search"><div class="search-wrap">${ICON_SEARCH}<input id="${id}" class="search-input" type="search" aria-label="${esc(label)}" placeholder="${esc(label)}" value="${esc(value)}" autocomplete="off"></div></div>`;
}
function recipeAlerts(){
  const list = (recipeBook.data.alerts || []).filter(a=>!a.read);
  if(!list.length) return '';
  return `<section class="rc-card rc-alerts" aria-label="${esc(rt('alerts'))}"><div class="rc-card-head"><b>${esc(rt('alerts'))}</b><button type="button" class="btn btn-ghost rc-small" id="rcAlertsRead">${esc(rt('markRead'))}</button></div>
    ${list.slice(0, 6).map(a=>`<div class="rc-alert"><p dir="auto">${esc(a[state.lang] || a.en || '')}</p><small>${esc(timeAgo(a.at))}</small></div>`).join('')}</section>`;
}
function recipeRowsFor(){
  const q = foldText(recipeBook.query.trim()), all = recipeBook.data.recipes;
  const rows = all.filter(r=>recipeBook.filter === 'archived' ? r.archived : !r.archived).map(r=>({r, c:recipeCostOf(r)}));
  return rows.filter(({r, c})=>(recipeBook.filter !== 'look' || recipeNeedsLook(r, c)) && (!q || foldText(r.name + ' ' + (r.data.category || '')).includes(q)));
}
function recipeRow({r, c}){
  const st = recipeState(c), stock = recipeStockIssues(r), sub = [];
  if(st.text) sub.push(`<span class="rc-state"><i class="rc-dot ${st.tone}" aria-hidden="true"></i>${esc(st.text)}</span>`);
  if(stock.length) sub.push(`<span class="rc-warn">${esc(rt('stockIssues')(stock.length))}</span>`);
  if(r.data.status === 'draft' && !r.archived) sub.push(esc(rt('draft')));
  const per = c.perServing !== null ? recipeMoney(c.perServing) : '';
  return `<button type="button" class="rc-row" data-rc-open="${esc(r.id)}">
    ${recipeThumb(r, 'rc-thumb')}
    <span class="rc-row-main"><span class="rc-row-name" dir="auto">${esc(r.name)}</span><span class="rc-row-sub">${sub.join('<span class="rc-sep" aria-hidden="true">·</span>')}</span></span>
    ${per ? `<span class="rc-row-end"><b>${esc(per)}</b><small>${esc(c.missing ? rt('soFar') : rt('perServing'))}</small></span>` : ''}
    <i class="sheet-chevron" aria-hidden="true"></i></button>`;
}
/* Recipes in groups by category (Cakes, Drinks...), A to Z, with recipes that have none last. One
   spelling per group: "cakes" and "Cakes " are the same group. */
const recipeCatKey = c=>foldText(String(c || '').trim());
function recipeGroups(rows){
  const by = new Map();
  for(const row of rows){
    const k = recipeCatKey(row.r.data.category);
    if(!by.has(k)) by.set(k, {name:String(row.r.data.category || '').trim(), rows:[]});
    by.get(k).rows.push(row);
  }
  return [...by.entries()].sort(([a, x], [b, y])=>!a - !b || x.name.localeCompare(y.name, state.lang)).map(([, g])=>g);
}
function recipeCategories(){
  return recipeGroups(recipeBook.data.recipes.filter(r=>!r.archived).map(r=>({r}))).map(g=>g.name).filter(Boolean);
}
function recipeListHtml(){
  const rows = recipeRowsFor();
  if(rows.length){
    const groups = recipeGroups(rows);
    if(groups.length === 1 && !groups[0].name) return `<div class="rc-list">${rows.map(recipeRow).join('')}</div>`;
    return groups.map(g=>`<div class="section-title rc-group"><span dir="auto">${esc(g.name || rt('noCategory'))}</span><span class="rc-group-n">${g.rows.length}</span></div><div class="rc-list">${g.rows.map(recipeRow).join('')}</div>`).join('');
  }
  if(recipeBook.query.trim()) return emptyState(esc(rt('noMatch')));
  return emptyState(esc(recipeBook.filter === 'archived' ? rt('noArchived') : recipeBook.filter === 'look' ? rt('allGood') : rt('empty')));
}
function recipeListPage(){
  const d = recipeBook.data, live = d.recipes.filter(r=>!r.archived), look = live.filter(r=>recipeNeedsLook(r, recipeCostOf(r))).length;
  const seg = (id, label)=>`<button type="button" class="pill-seg-btn" role="radio" aria-checked="${recipeBook.filter === id}" data-rc-filter="${id}">${esc(label)}</button>`;
  return `<div class="rc-page">
    ${recipeAlerts()}
    <div class="rc-tools">${recipeSearchBox('rcSearch', recipeBook.query, rt('search'))}
      <div class="rc-tool-btns"><button type="button" class="btn btn-ghost" id="rcIngredients">${esc(rt('ingredients'))}</button><button type="button" class="btn btn-primary" id="rcNew">${ICON_PLUS}<span>${esc(rt('new'))}</span></button></div></div>
    <div class="pill-seg rc-filter" role="radiogroup" aria-label="${esc(rt('show'))}">${seg('all', rt('all'))}${seg('look', look ? rt('needsLook') + ' (' + look + ')' : rt('needsLook'))}${seg('archived', rt('archived'))}</div>
    ${!d.pricesReady ? `<p class="rr-foot warn">${esc(rt('pricesOff'))}</p>` : ''}
    <div id="rcList">${recipeListHtml()}</div>
    <p class="rc-note">${esc(rt('stockNote'))}</p></div>`;
}

function recipeCostCard(c, live){
  const tone = c.state === 'loss' ? 'red' : c.state === 'low' ? 'amber' : c.state === 'ok' ? 'green' : '';
  const miss = `<em>${esc(rt('missingShort'))}</em>`;
  const cell = (label, html, cls = '')=>`<div class="rc-stat${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><b>${html || miss}</b></div>`;
  const per = c.perServing !== null ? esc(recipeMoney(c.perServing)) : '';
  const notes = [];
  if(!c.lines.length) notes.push(rt('noLines'));
  if(c.missing) notes.push(rt('missingNote')(c.missing));
  if(c.losing) notes.push(rt('lossNote'));
  if(c.low) notes.push(rt('lowNote')(recipeBook.data.marginMin ?? RC().MARGIN_MIN));
  if(c.servings > 1 && c.total) notes.push(rt('wholeRecipe')(recipeMoney(c.total), c.servings));
  if(c.suggested) notes.push(rt('suggested')(recipeMoney(c.suggested), RC().SUGGEST_TIMES));
  return `<section class="rc-card rc-cost${tone ? ' ' + tone : ''}"${live ? ' id="rcLive" aria-live="polite"' : ''}>
    <div class="rc-stats">${cell(c.missing && per ? rt('costSoFar') : rt('costServing'), per)}${cell(rt('menuPrice'), c.price ? esc(recipeMoney(c.price)) : '')}${cell(rt('profit'), c.profit !== null ? esc(recipeMoney(c.profit)) : '', c.profit !== null && c.profit < 0 ? 'neg' : '')}${cell(rt('margin'), c.margin !== null ? esc(c.margin + '%') : '', tone)}</div>
    ${notes.length ? `<ul class="rc-cost-notes">${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>` : ''}</section>`;
}
function recipeLineHtml(l, i, scale){
  const s = l.stockItem ? recipeStock(l.stockItem) : null;
  const qty = Number(l.qty) > 0 ? `${recipeQty(l.qty * scale)} ${l.unit}` : '';
  const cost = l.status === 'ok' ? `<b>${esc(recipeMoney(l.cost * scale))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
  return `<div class="rc-line"><span class="rc-line-main"><span dir="auto">${esc(l.name || rt('missing'))}</span>
      <small dir="auto">${l.stockItem ? esc(l.stockItem) : ''}${recipeStockBadge(s?.state)}</small></span>
    <span class="rc-line-qty" dir="auto">${esc(qty)}</span><span class="rc-line-cost" data-rc-linecost="${i}">${cost}</span></div>`;
}
function recipeDetailPage(r){
  const d = r.data, c = recipeCostOf(r), scale = recipeBook.scale, cook = recipeBook.cooking;
  const meta = [d.yield ? `${recipeQty(d.yield * scale)} ${d.yieldUnit || rt('servings')(d.yield * scale)}` : '', d.prep ? rt('prepMin')(d.prep) : '', d.cook ? rt('cookMin')(d.cook) : ''].filter(Boolean);
  const photos = recipeBook.photos?.id === r.id ? recipeBook.photos : null;
  const steps = d.steps.filter(s=>s.trim());
  return `<div class="rc-page rc-detail${cook ? ' is-cooking' : ''}">
    <div class="rc-bar"><button type="button" class="rc-back" id="rcBack">${ICON_BACK}<span>${esc(t('recipesTitle'))}</span></button>
      <span class="rc-bar-end">${r.archived ? `<button type="button" class="btn btn-primary" id="rcRestore">${esc(rt('restore'))}</button>` : `<button type="button" class="btn btn-ghost" id="rcCook">${esc(cook ? rt('closeCooking') : rt('cooking'))}</button><button type="button" class="btn btn-primary" id="rcEdit">${esc(rt('edit'))}</button>`}</span></div>
    <header class="rc-head">${recipeThumb(r, 'rc-hero')}<div class="rc-head-text">
      ${d.category ? `<span class="rc-eyebrow" dir="auto">${esc(d.category)}</span>` : ''}<h2 dir="auto">${esc(r.name)}</h2>
      <p>${[d.status === 'draft' ? rt('draft') : rt('ready'), ...meta].map(esc).join(' · ')}</p></div></header>
    ${cook ? '' : recipeCostCard(c)}
    <section class="rc-card">
      <div class="rc-card-head"><b>${esc(rt('ingredients'))}</b>${c.lines.length ? `<select id="rcScale" aria-label="${esc(rt('scale'))}" data-inline>${[0.5, 1, 2, 3, 4].map(n=>`<option value="${n}" ${n === scale ? 'selected' : ''}>${n}×</option>`).join('')}</select>` : ''}</div>
      ${c.lines.map((l, i)=>recipeLineHtml(l, i, scale)).join('') || `<p class="rc-empty-line">${esc(rt('noLines'))}</p>`}</section>
    <section class="rc-card"><div class="rc-card-head"><b>${esc(rt('method'))}</b></div>
      ${steps.map((s, i)=>`<div class="rc-step"><span>${i + 1}</span><p dir="auto">${esc(s)}</p></div>`).join('') || `<p class="rc-empty-line">${esc(rt('noSteps'))}</p>`}
      ${d.notes ? `<div class="rc-notes"><b>${esc(rt('notes'))}</b><p dir="auto">${esc(d.notes)}</p></div>` : ''}</section>
    <section class="rc-card"><div class="rc-card-head"><b>${esc(rt('photos'))}</b>${r.archived ? '' : `<button type="button" class="btn btn-ghost rc-small" id="rcPhotoButton">${ICON_CAMERA}<span>${esc(rt('addPhoto'))}</span></button>`}</div>
      <input type="file" id="rcPhoto" accept="image/*" hidden>
      <div class="rc-photos" id="rcPhotos">${photos?.list ? (photos.list.map(p=>`<figure><a href="${esc(p.url || '')}" target="_blank" rel="noopener"><img src="${esc(p.url || '')}" loading="lazy" alt="${esc(p.caption || r.name)}"></a>${r.archived ? '' : `<button type="button" class="rc-photo-del" data-rc-delphoto="${esc(p.id)}" aria-label="${esc(rt('deletePhoto'))}">${ICON_DELETE}</button>`}</figure>`).join('') || `<p class="rc-empty-line">${esc(rt('noPhotos'))}</p>`) : photos?.failed ? `<p class="rc-empty-line">${esc(t('loadFailed'))}</p>` : `<p class="rc-empty-line">${esc(t('loading'))}</p>`}</div>
      <p class="rc-note">${esc(rt('photoHint'))}</p></section>
    <p class="rc-note">${esc(rt('edited'))} ${esc(accountLabel(r.updated_by) || '')} · ${esc(formatIraqDateTime(r.updated_at))}</p></div>`;
}

function recipeUnitOptions(selected){
  const units = recipeBook.data.units, has = units.some(u=>u.id === selected);
  return (has || !selected ? '' : `<option value="${esc(selected)}" selected>${esc(recipeUnit(selected))}</option>`)
    + (selected ? '' : `<option value="" selected disabled>${esc(rt('chooseUnit'))}</option>`)
    + units.map(u=>`<option value="${esc(u.id)}" ${u.id === selected ? 'selected' : ''}>${esc(u.en)}</option>`).join('');
}
function recipeEditLine(l, i, cost){
  const ing = recipeIngredient(l.ingredient), s = ing ? recipeStock(ing.stock_item) : null;
  return `<div class="rc-eline" data-rc-line="${i}">
    <span class="rc-eline-name"><span dir="auto">${esc(ing?.name || rt('missing'))}</span><small dir="auto">${esc(ing?.stock_item || '')}${recipeStockBadge(s?.state)}</small></span>
    <span class="rc-eline-amt"><input type="number" inputmode="decimal" min="0.001" max="999999" step="any" data-rc-qty="${i}" aria-label="${esc(rt('quantity'))}" placeholder="${esc(rt('amount'))}" value="${l.qty ?? ''}">
      <select data-rc-unit="${i}" data-inline aria-label="${esc(rt('unit'))}">${recipeUnitOptions(l.unit)}</select></span>
    <span class="rc-eline-cost" data-rc-linecost="${i}">${cost}</span>
    <span class="rc-eline-btns"><button type="button" class="icon-btn" data-rc-up="${i}" aria-label="${esc(rt('moveUp'))}" ${i ? '' : 'disabled'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button><button type="button" class="icon-btn danger" data-rc-remove="${i}" aria-label="${esc(rt('removeLine'))}">${ICON_DELETE}</button></span></div>`;
}
const recipeLineCost = l=>l.status === 'ok' ? `<b>${esc(recipeMoney(l.cost))}</b>` : `<em class="rc-why">${esc(recipeWhy(l))}</em>`;
function recipeSyncCats(cat){ document.querySelectorAll('[data-rc-cat]').forEach(x=>x.setAttribute('aria-pressed', String(!!cat.trim() && recipeCatKey(x.dataset.rcCat) === recipeCatKey(cat)))); }
function recipeEditorPage(){
  const r = recipeBook.editing, d = r.data, c = recipeCostOf(r), used = new Set(d.lines.map(l=>l.ingredient));
  const known = recipeCategories(), cats = known.length ? known : rt('starterCats').split(',');
  if(d.category.trim() && !cats.some(x=>recipeCatKey(x) === recipeCatKey(d.category))) cats.push(d.category.trim());
  const seg = (attr, value, on, label)=>`<button type="button" class="pill-seg-btn" role="radio" aria-checked="${on}" ${attr}="${value}">${esc(label)}</button>`;
  return `<div class="rc-page rc-editor">
    <div class="rc-bar"><button type="button" class="rc-back" id="rcEditBack">${ICON_BACK}<span>${esc(r.version ? r.name || rt('edit') : rt('new'))}</span></button>
      <span class="rc-bar-end"><span class="rc-save-state" id="rcSaveState" role="status">${esc(recipeBook.dirty ? rt('unsaved') : r.version ? rt('saved') : '')}</span><button type="button" class="btn btn-primary" id="rcDone">${esc(t('done'))}</button></span></div>
    <section class="rc-card rc-form">
      <div class="rc-photo-pick">${recipeThumb(r, 'rc-thumb rc-pick-thumb')}<span class="rc-pick-text"><b>${esc(rt('photos'))}</b><small>${esc(rt('photoHint'))}</small></span>
        <button type="button" class="btn btn-ghost rc-small" id="rcEditPhoto">${ICON_CAMERA}<span>${esc(rt('addPhoto'))}</span></button><input type="file" id="rcEditPhotoFile" accept="image/*" hidden></div>
      ${recipeField(rt('menuName'), `<input id="rcName" maxlength="120" value="${esc(r.name)}" dir="auto" autocomplete="off">`)}
      <div class="field"><span class="rc-label" id="rcCatLabel">${esc(rt('category'))}</span>
        <div class="rc-chips" role="group" aria-labelledby="rcCatLabel">${cats.map(x=>`<button type="button" class="rc-chip" data-rc-cat="${esc(x)}" aria-pressed="${recipeCatKey(x) === recipeCatKey(d.category)}" dir="auto">${esc(x)}</button>`).join('')}</div>
        <input data-rc-field="category" maxlength="60" value="${esc(d.category)}" dir="auto" autocomplete="off" aria-labelledby="rcCatLabel" placeholder="${esc(rt('newCategory'))}"></div>
      <div class="rc-two">${recipeField(rt('servingsCount'), `<input data-rc-field="yield" type="number" inputmode="decimal" min="0.001" step="any" value="${d.yield}">`)}${recipeField(rt('yieldUnit'), `<input data-rc-field="yieldUnit" maxlength="60" value="${esc(d.yieldUnit)}" dir="auto">`)}</div>
      <div class="rc-two">${recipeField(rt('prep'), `<input data-rc-field="prep" type="number" inputmode="numeric" min="0" max="100000" value="${d.prep}">`)}${recipeField(rt('cook'), `<input data-rc-field="cook" type="number" inputmode="numeric" min="0" max="100000" value="${d.cook}">`)}</div>
      ${recipeField(rt('menuPriceIqd'), `<input id="rcPrice" type="number" inputmode="numeric" min="0" step="250" value="${d.price ?? ''}" placeholder="${esc(rt('noPrice'))}">`)}
      <div class="field"><span class="rc-label">${esc(rt('status'))}</span><div class="pill-seg" role="radiogroup" aria-label="${esc(rt('status'))}">${seg('data-rc-status', 'draft', d.status === 'draft', rt('draft'))}${seg('data-rc-status', 'ready', d.status === 'ready', rt('ready'))}</div><p class="field-hint">${esc(rt('readyHint'))}</p></div>
    </section>
    <div class="section-title">${esc(rt('ingredients'))}</div>
    <section class="rc-card rc-elines">${c.lines.map((l, i)=>recipeEditLine(d.lines[i], i, recipeLineCost(l))).join('') || `<p class="rc-empty-line">${esc(rt('noLines'))}</p>`}
      <div class="rc-add"><select id="rcAddLine" aria-label="${esc(rt('addIngredient'))}"><option value="" selected disabled>${esc(rt('addIngredient'))}</option>${recipeBook.data.ingredients.filter(i=>!used.has(i.id)).map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost" id="rcNewIngredient">${ICON_PLUS}<span>${esc(rt('newIngredient'))}</span></button></div></section>
    ${recipeCostCard(c, true)}
    <div class="section-title">${esc(rt('method'))}</div>
    <section class="rc-card rc-form">${d.steps.map((s, i)=>`<div class="rc-estep"><label for="rcStep${i}">${esc(rt('step'))} ${i + 1}</label><textarea id="rcStep${i}" data-rc-step="${i}" maxlength="3000" rows="2" dir="auto">${esc(s)}</textarea>
        <span class="rc-eline-btns"><button type="button" class="icon-btn" data-rc-stepup="${i}" aria-label="${esc(rt('moveUp'))}" ${i ? '' : 'disabled'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button><button type="button" class="icon-btn danger" data-rc-delstep="${i}" aria-label="${esc(rt('removeStep'))}">${ICON_DELETE}</button></span></div>`).join('')}
      <button type="button" class="btn btn-ghost" id="rcAddStep">${ICON_PLUS}<span>${esc(rt('addStep'))}</span></button>
      ${recipeField(rt('notes'), `<textarea data-rc-field="notes" maxlength="8000" rows="3" dir="auto">${esc(d.notes)}</textarea>`)}</section>
    ${r.version && !r.archived ? `<div class="rc-center"><button type="button" class="btn btn-ghost rc-danger" id="rcArchive">${esc(rt('archive'))}</button></div>` : ''}</div>`;
}
/* While typing: the line costs and the cost card change in place (the page isn't drawn again). */
function recipeRefreshLive(){
  const r = recipeBook.editing;
  if(!r) return;
  const c = recipeCostOf(r);
  c.lines.forEach((l, i)=>{ const el = document.querySelector(`.rc-elines [data-rc-linecost="${i}"]`); if(el) el.innerHTML = recipeLineCost(l); });
  const card = document.getElementById('rcLive');
  if(card) card.outerHTML = recipeCostCard(c, true);
}

function recipeIngredientsPage(){
  const d = recipeBook.data, q = foldText(recipeBook.ingQuery.trim()), ctx = recipeCtx();
  const uses = id=>d.recipes.filter(r=>!r.archived && (r.data.lines || []).some(l=>l.ingredient === id)).length;
  const rows = d.ingredients.filter(i=>!q || foldText(i.name + ' ' + i.stock_item).includes(q)).map(i=>{
    const s = recipeStock(i.stock_item), p = ctx.price(i.stock_item), n = uses(i.id);
    const price = !s && d.stock.length ? `<em class="rc-why">${esc(rt('whyGone'))}</em>` : p && !p.error && p.currency === 'IQD' ? `<b>${esc(recipeMoney(p.cost))}</b><small dir="auto">${esc(rt('per')(p.unit || p.base))}</small>` : `<em class="rc-why">${esc(p && p.currency !== 'IQD' ? rt('whyUsd') : p?.error ? rt('whyBuyUnit')(p.unit, p.base) : rt('whyPrice'))}</em>`;
    return `<button type="button" class="rc-row" data-rc-ingredient="${esc(i.id)}"><span class="rc-row-main"><span class="rc-row-name" dir="auto">${esc(i.name)}</span>
      <span class="rc-row-sub"><span dir="auto">${esc(i.stock_item)}</span>${recipeStockBadge(s?.state)}<span class="rc-sep" aria-hidden="true">·</span>${esc(rt('usedIn')(n))}</span></span>
      <span class="rc-row-end">${price}</span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
  }).join('');
  return `<div class="rc-page">
    <div class="rc-bar"><button type="button" class="rc-back" id="rcBack">${ICON_BACK}<span>${esc(t('recipesTitle'))}</span></button>
      <span class="rc-bar-end"><button type="button" class="btn btn-primary" id="rcIngredientNew">${ICON_PLUS}<span>${esc(rt('newIngredient'))}</span></button></span></div>
    <h2 class="rc-title">${esc(rt('ingredients'))}</h2>
    ${d.ingredients.length ? recipeSearchBox('rcIngSearch', recipeBook.ingQuery, rt('searchIngredients')) : ''}
    ${rows ? `<div class="rc-list">${rows}</div>` : emptyState(esc(d.ingredients.length ? rt('noMatch') : rt('noIngredients')))}
    <p class="rc-note">${esc(rt('ingredientsNote'))}</p>
    ${!d.stockAt ? `<p class="rr-foot warn">${esc(t('rrNoCatalog'))}</p>` : ''}</div>`;
}
/* Add or change an ingredient: its name, the stock item it is (suggested from the name, with a warning
   when the names don't look alike: a warning only, Ahmad decides) and the unit new lines start with. */
function recipeIngredientForm(id, onSaved){
  const d = recipeBook.data, old = recipeIngredient(id), stock = [...d.stock].sort((a, b)=>a.name.localeCompare(b.name));
  const used = old && d.recipes.some(r=>(r.data.lines || []).some(l=>l.ingredient === old.id));
  showFormModal({title:esc(old ? rt('editIngredient') : rt('newIngredient')),
    bodyHtml:recipeField(rt('ingredientName'), `<input id="rcIngName" maxlength="120" value="${esc(old?.name || '')}" dir="auto" autocomplete="off">`)
      + `<div class="rc-sug" id="rcIngSug" aria-live="polite"></div>`
      + recipeField(rt('stockItem'), `<select id="rcIngStock"><option value="" ${old ? '' : 'selected'} disabled>${esc(rt('chooseStock'))}</option>${stock.map(s=>`<option value="${esc(s.name)}" ${s.name === old?.stock_item ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}${old && !stock.some(s=>s.name === old.stock_item) ? `<option value="${esc(old.stock_item)}" selected>${esc(old.stock_item)}</option>` : ''}</select>`)
      + `<p class="field-hint rc-warn-hint" id="rcIngWarn"></p>`
      + recipeField(rt('usualUnit'), `<select id="rcIngUnit">${recipeUnitOptions(old?.unit || '')}</select>`, rt('unitsHint')),
    okLabel:t('save'),
    againLabel:old && !used ? t('delete') : '',
    onSubmit:async again=>{
      if(again){
        const r = await api('recipe-ingredients/' + old.id, {method:'DELETE'});
        if(!r.ok) return {error:r.data?.error === 'ingredient_in_use' ? rt('inUse') : t('saveFailed')};
        d.ingredients = d.ingredients.filter(x=>x.id !== old.id);
        recipeBook.ctx = null;
        render();
        return;
      }
      const name = document.getElementById('rcIngName').value.trim(), stockItem = document.getElementById('rcIngStock').value, unit = document.getElementById('rcIngUnit').value;
      if(!name) return {error:rt('needName')};
      if(!stockItem) return {error:rt('needStock')};
      if(!unit) return {error:rt('needUnit')};
      const r = await api('recipe-ingredients/' + (old?.id || crypto.randomUUID()), {method:'PUT', body:{name, stock_item:stockItem, unit, version:old?.version || 0}});
      if(!r.ok){ const e = r.data?.error; return {error:e === 'recipe_conflict' ? rt('conflict') : e === 'unknown_unit' ? rt('unknownUnit') : e === 'invalid_stock_link' ? rt('whyGone') : t('saveFailed')}; }
      const i = d.ingredients.findIndex(x=>x.id === r.data.id);
      if(i < 0) d.ingredients.push(r.data); else d.ingredients[i] = r.data;
      d.ingredients.sort((a, b)=>a.name.localeCompare(b.name));
      recipeBook.ctx = null;
      // A new stock item has no price in the list yet: the next load brings it.
      if(!d.prices[stockItem]) setTimeout(recipeLoad, 0);
      if(onSaved) onSaved(r.data); else render();
    }});
  setTimeout(()=>{
    const nameEl = document.getElementById('rcIngName'), sel = document.getElementById('rcIngStock'), unitEl = document.getElementById('rcIngUnit'), sug = document.getElementById('rcIngSug'), warn = document.getElementById('rcIngWarn');
    if(!nameEl || !sel) return;
    const L = globalThis.RicottaStockLink, S = globalThis.RicottaSearch;
    let unitTouched = !!old, auto = false;
    const pick = v=>{ sel.value = v; sel.dispatchEvent(new Event('change', {bubbles:true})); };
    const check = ()=>{
      const name = nameEl.value.trim(), chosen = sel.value;
      warn.textContent = name && chosen && L && !L.matches({name}, chosen) ? rt('nameWarn') : '';
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
  }, 0);
}

/* ---------- Photos (the camera or a file, made smaller before it is sent) ---------- */
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

/* Leaving a recipe being written: it is saved first; when it can't be (no name, Ready but not
   finished, offline), Ahmad chooses to stay or to leave the changes. True when it may be left. */
async function recipeLeave(){
  const r = recipeBook.editing;
  if(r && recipeBook.dirty && !(r.name.trim() && !recipeIncomplete(r) && await recipeSave())){
    if(!(await showConfirm(rt('discard')))) return false;
  }
  clearTimeout(recipeBook.timer);
  recipeBook.editing = null; recipeBook.dirty = false;
  return true;
}
function recipeOpen(id){
  recipeBook.id = id; recipeBook.page = 'detail'; recipeBook.scale = 1; recipeBook.cooking = false;
  recipeBook.wake?.release().catch(()=>{}); recipeBook.wake = null;
  render();
  document.getElementById('mainContent')?.scrollTo?.({top:0});
  window.scrollTo({top:0});
}
function attachRecipeEvents(){
  const on = (id, fn)=>{ const el = document.getElementById(id); if(el) el.onclick = fn; };
  const all = (sel, fn)=>document.querySelectorAll(sel).forEach(fn);
  // A tile whose photo link ran out (after 15 minutes) shows its letter instead.
  all('img.rc-thumb, img.rc-hero', img=>{ img.onerror = ()=>{ const s = document.createElement('span'); s.className = img.className + ' rc-letter'; s.setAttribute('aria-hidden', 'true'); s.textContent = img.dataset.letter || '?'; img.replaceWith(s); }; });
  on('rcRetry', ()=>{ recipeBook.error = false; recipeLoad(); render(); });
  on('rcNew', recipeNew);
  on('rcIngredients', ()=>{ recipeBook.page = 'ingredients'; render(); });
  on('rcBack', ()=>{ recipeBook.page = 'list'; recipeBook.cooking = false; recipeBook.wake?.release().catch(()=>{}); recipeBook.wake = null; render(); });
  on('rcAlertsRead', async ()=>{
    const r = await api('recipes/alerts/read', {method:'POST', body:{}});
    if(!r.ok){ toast(t('saveFailed'), 'error'); return; }
    (recipeBook.data.alerts || []).forEach(a=>{ a.read = true; });
    render();
  });
  all('[data-rc-filter]', b=>b.onclick = ()=>{ recipeBook.filter = b.dataset.rcFilter; render(); });
  all('[data-rc-open]', b=>b.onclick = ()=>recipeOpen(b.dataset.rcOpen));
  const search = document.getElementById('rcSearch');
  if(search) search.oninput = ()=>{
    recipeBook.query = search.value;
    const list = document.getElementById('rcList');
    if(list){ list.innerHTML = recipeListHtml(); list.querySelectorAll('[data-rc-open]').forEach(b=>b.onclick = ()=>recipeOpen(b.dataset.rcOpen)); }
  };
  const ingSearch = document.getElementById('rcIngSearch');
  if(ingSearch) ingSearch.oninput = ()=>{ recipeBook.ingQuery = ingSearch.value; render(); const el = document.getElementById('rcIngSearch'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
  on('rcIngredientNew', ()=>recipeIngredientForm());
  all('[data-rc-ingredient]', b=>b.onclick = ()=>recipeIngredientForm(b.dataset.rcIngredient));

  // A recipe's page
  const current = recipeBook.page === 'detail' && !recipeBook.editing ? recipeCurrent() : null;
  if(current && recipeBook.photos?.id !== current.id) recipePhotos();
  on('rcEdit', ()=>{ const r = recipeCurrent(); if(r) recipeEdit(r); });
  on('rcCook', recipeCooking);
  on('rcRestore', async ()=>{
    const r = recipeCurrent(); if(!r) return;
    recipeBook.editing = structuredClone(r); recipeBook.editing.archived = false; recipeBook.dirty = true;
    const ok = await recipeSave();
    recipeBook.editing = null; recipeBook.dirty = false;
    if(ok){ recipeBook.filter = 'all'; toast(rt('restored')); }
    render();
  });
  const scale = document.getElementById('rcScale');
  if(scale) scale.onchange = ()=>{ recipeBook.scale = Number(scale.value); render(); };
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
    if(await recipeSave(true)){ recipeBook.editing = null; recipeBook.id = r.id; recipeBook.page = 'detail'; recipeBook.photos = null; render(); }
  });
  on('rcEditBack', async ()=>{
    if(!(await recipeLeave())) return;
    recipeBook.page = r.version && recipeBook.data.recipes.some(x=>x.id === r.id) ? 'detail' : 'list';
    render();
  });
  // A photo while writing: a new recipe is saved first, so the photo has a recipe to belong to.
  on('rcEditPhoto', ()=>document.getElementById('rcEditPhotoFile')?.click());
  const editPhoto = document.getElementById('rcEditPhotoFile'), photoBtn = document.getElementById('rcEditPhoto');
  if(editPhoto) editPhoto.onchange = async ()=>{
    const file = editPhoto.files[0];
    editPhoto.value = '';
    if(!file) return;
    if(!r.name.trim()){ toast(rt('required'), 'error'); document.getElementById('rcName')?.focus(); return; }
    if(!r.version) recipeBook.dirty = true;
    if(photoBtn){ photoBtn.disabled = true; photoBtn.querySelector('span').textContent = rt('saving'); }
    const ok = (recipeBook.dirty || !r.version ? await recipeSave(true) : true) && await recipeUpload(file, r.id);
    if(recipeBook.editing === r){ if(ok) render(); else if(photoBtn){ photoBtn.disabled = false; photoBtn.querySelector('span').textContent = rt('addPhoto'); } }
  };
  const name = document.getElementById('rcName');
  if(name){ name.oninput = ()=>{ r.name = name.value; recipeChange(); }; if(!r.version && !r.name) setTimeout(()=>name.focus({preventScroll:true}), 0); }
  all('[data-rc-field]', el=>el.oninput = ()=>{
    const k = el.dataset.rcField;
    if(k === 'yield'){ const v = Number(el.value); d.yield = v > 0 ? v : 1; }
    else if(k === 'prep' || k === 'cook'){ const v = Math.round(Number(el.value)); d[k] = v >= 0 && v <= 100000 ? v : 0; }
    else d[k] = el.value;
    if(k === 'category') recipeSyncCats(d.category);
    recipeChange();
    if(k === 'yield') recipeRefreshLive();
  });
  const price = document.getElementById('rcPrice');
  if(price) price.oninput = ()=>{ const v = Number(price.value); d.price = price.value.trim() && v > 0 ? Math.round(v) : null; recipeChange(); recipeRefreshLive(); };
  const seg = (attr, key)=>all(`[${attr}]`, b=>b.onclick = ()=>{
    d[key] = b.getAttribute(attr);
    all(`[${attr}]`, x=>x.setAttribute('aria-checked', String(x === b)));
    recipeChange(); recipeRefreshLive();
  });
  seg('data-rc-status', 'status');
  all('[data-rc-cat]', b=>b.onclick = ()=>{
    d.category = b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.rcCat;
    const box = document.querySelector('[data-rc-field="category"]');
    if(box) box.value = d.category;
    recipeSyncCats(d.category); recipeChange();
  });
  all('[data-rc-qty]', el=>el.oninput = ()=>{
    const v = Number(el.value);
    d.lines[Number(el.dataset.rcQty)].qty = el.value.trim() && v > 0 ? Math.round(v * 1000) / 1000 : null;
    recipeChange(); recipeRefreshLive();
  });
  all('[data-rc-unit]', el=>el.onchange = ()=>{ d.lines[Number(el.dataset.rcUnit)].unit = el.value; recipeChange(); recipeRefreshLive(); });
  all('[data-rc-step]', el=>el.oninput = ()=>{ d.steps[Number(el.dataset.rcStep)] = el.value; recipeChange(); });
  all('[data-rc-up]', b=>b.onclick = ()=>{ const i = Number(b.dataset.rcUp); [d.lines[i - 1], d.lines[i]] = [d.lines[i], d.lines[i - 1]]; redraw(); });
  all('[data-rc-remove]', b=>b.onclick = ()=>{ d.lines.splice(Number(b.dataset.rcRemove), 1); redraw(); });
  all('[data-rc-stepup]', b=>b.onclick = ()=>{ const i = Number(b.dataset.rcStepup); [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; redraw(); });
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
  on('rcArchive', async ()=>{
    if(!(await showConfirm(rt('archiveConfirm')))) return;
    r.archived = true; recipeBook.dirty = true;
    if(await recipeSave()){ recipeBook.editing = null; recipeBook.page = 'list'; recipeBook.id = null; render(); }
    else r.archived = false;
  });
}

/* ---------- How Recipes work: a short one-time tour for Ahmad ----------
   Shown once after this update on whichever device he opens first: Done, Skip or closing it saves
   "seen" on his account (settings.tourRecipes). Settings, Help shows it again. */
const RC_TOUR = ['link', 'amounts', 'cost', 'alerts'];
function recipeTourPic(step){
  if(step === 'link') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-link"><span>${esc(rt('tourMilk'))}</span><i></i><span class="on">${esc(rt('tourMilkStock'))}</span></div></div>`;
  if(step === 'amounts') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span><b>${esc(rt('tourMilk'))}</b><em>500 ml</em></span><span><b>${esc(rt('tourBanana'))}</b><em>250 g</em></span></div></div>`;
  if(step === 'cost') return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-rows"><span><b>${esc(rt('tourMilk'))}</b><em>5,000 IQD</em></span><span><b>${esc(rt('tourBanana'))}</b><em>1,000 IQD</em></span><span class="sum"><b>${esc(rt('tourCost'))}</b><em>6,000 IQD</em></span></div></div>`;
  return `<div class="xt-pic rc-tp" aria-hidden="true"><div class="rc-tp-note"><b>${esc(t('recipesTitle'))}</b><span>${esc(rt('tourNote'))}</span></div></div>`;
}
function openRecipesTour(){
  let i = 0;
  const {el, close} = openKitchenSheet('xt-sheet', '<div id="rcTourStep"></div>', rt('tourTitle'));
  const seen = ()=>{ if(state.settings?.tourRecipes !== true) setSetting('tourRecipes', true); lset('rcSeen:' + state.account, true); };
  const paint = ()=>{
    const s = RC_TOUR[i], last = i === RC_TOUR.length - 1;
    el.querySelector('#rcTourStep').innerHTML = `<div class="xt-step">${recipeTourPic(s)}
      <div class="xt-dots" aria-hidden="true">${RC_TOUR.map((_, n)=>`<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="sel-title">${esc(rt('tour_' + s + 'T'))}</div>
      <p class="xt-text">${esc(rt('tour_' + s))}</p>
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

/* Ahmad's Settings: what he can use, and what is locked (Rozh opens more in Admin). */
function renderRecipeSettings(){
  const locked = (label, allowed)=>`<div class="settings-row"><span>${esc(label)}<small>${esc(allowed ? rt('available') : rt('lockedHint'))}</small></span><span>${esc(allowed ? rt('available') : rt('locked'))}</span></div>`;
  return `<div class="settings-page">${canOpen('order') ? renderPendingSync() : ''}${canOpen('assistant') || canOpen('order') ? renderNotifSettings() : ''}${renderFeatureSettings()}<div class="section-title">${esc(rt('access'))}</div><div class="form-card settings-rows">${locked(t('order'), canOpen('order'))}${locked(t('ricoName'), canOpen('assistant'))}${locked(t('rrTitle'), canOpen('receipts'))}${locked(t('tfTitle'), canOpen('transfers'))}</div>${renderHelpSettings()}${renderPrivacySettings()}<div class="app-version">${esc(t('appVersionLine')(APP_VERSION))}</div></div>`;
}
