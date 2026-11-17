/* Ahmad's Stock tab (the minibar): how much of each item Rozh picked for him is in Main Storage, A to Z,
   with a search box and when the stock was last read. Nothing else, nothing to change. It looks like the
   app's Stock tab: one hairline row per item with a dot, its name and the amount.
   Rozh picks the items on the Order screen: hold an item, "Show in Ahmad's stock", or "Ahmad's stock
   list" for the whole list: a search by name or the names an item goes by (like the Order screen's),
   with suggestions first (what usually goes to the Minibar, what Ahmad's recipes use, then names that
   look like minibar things). Only Rozh can change it (the API checks). GET/PUT minibar
   (supabase/functions/api/minibar.ts). */
const minibar = {account:null, data:null, loading:false, error:false, query:''};

function minibarReset(){ Object.assign(minibar, {account:state.account, data:null, loading:false, error:false, query:''}); }
async function minibarLoad(){
  if(minibar.account !== state.account) minibarReset();
  if(minibar.loading) return;
  minibar.loading = true;
  const account = state.account, r = await api('minibar');
  if(account !== state.account) return;
  minibar.loading = false;
  minibar.error = !r.ok && !minibar.data;
  if(r.ok) minibar.data = minibarClean(r.data);
  if(state.view === 'minibar') render();
}
const minibarClean = d=>({items:Array.isArray(d?.items) ? d.items : [], at:d?.at || null, picked:d?.picked || 0, hints:d?.hints || null});
const minibarPicked = ()=>new Set((minibar.data?.items || []).map(i=>i.id));

/* How much is in Main Storage, in its own unit (12 cartons, 3.5 kilos; several links added up). */
function minibarAmount(st){
  if(!st || st.missing) return {text:t('mb_noLink'), tone:'gray'};
  if(st.empty || (!st.multi && !(Number(st.qty) > 0))) return {text:t('mb_none'), tone:'red'};
  const kinds = st.multi && Array.isArray(st.kinds) && st.kinds.length ? st.kinds : [{qty:st.qty, unit:st.unit}];
  return {text:kinds.map(k=>'⁦' + stockQty(k.qty) + ' ' + (k.unit || '') + '⁩').join(' + '), tone:st.level === 'low' ? 'amber' : 'green'};
}
function minibarRow(i){
  const a = minibarAmount(i.stock);
  return `<div class="mb-row"><i class="mb-dot ${a.tone}" aria-hidden="true"></i><span class="mb-name" dir="auto">${esc(i.name)}</span>
    <span class="mb-amount ${a.tone}" dir="auto">${esc(a.text)}${a.tone === 'amber' ? `<small>${esc(t('mb_low'))}</small>` : ''}</span></div>`;
}
function minibarRows(){
  const q = minibar.query.trim(), S = globalThis.RicottaSearch;
  const all = [...minibar.data.items].sort((a, b)=>String(a.name).localeCompare(String(b.name), state.lang));
  return q && S ? S.rank(all, q, i=>[i.name]) : all;
}
function minibarListHtml(){
  const rows = minibarRows();
  return rows.length ? `<div class="rc-list mb-list">${rows.map(minibarRow).join('')}</div>` : recipeEmpty(t('mb_noMatch'), t('mb_noMatchHint'));
}
function renderMinibar(){
  if(minibar.account !== state.account) minibarReset();
  if(!minibar.data){
    if(!minibar.loading && !minibar.error) minibarLoad();
    return `<div class="rc-page mb-page">${minibar.error ? recipeEmpty(t('loadFailed'), '', 'mbRetry', t('retry')) : loadingLines(6)}</div>`;
  }
  const d = minibar.data;
  if(!d.items.length) return `<div class="rc-page mb-page">${recipeEmpty(t('mb_emptyT'), t('mb_empty'))}</div>`;
  const old = d.at && typeof stockIsOld === 'function' && stockIsOld(d.at);
  return `<div class="rc-page mb-page">
    <div class="rc-tools">${recipeSearchBox('mbSearch', minibar.query, t('mb_search'))}
      <button type="button" class="queue-back mb-refresh" id="mbRefresh" aria-label="${esc(t('mb_refresh'))}" title="${esc(t('mb_refresh'))}">${ICON_REFRESH}</button></div>
    <p class="mb-when${old ? ' old' : ''}">${esc(d.at ? t('mb_readAt')(timeAgo(d.at), formatIraqDateTime(d.at, {hour:'numeric', minute:'2-digit'})) : t('mb_readNever'))}</p>
    <div id="mbList">${minibarListHtml()}</div>
    <p class="rc-hint">${esc(t('mb_note'))}</p></div>`;
}
function attachMinibarEvents(){
  const s = document.getElementById('mbSearch');
  if(s) s.oninput = ()=>{ minibar.query = s.value; const l = document.getElementById('mbList'); if(l) l.innerHTML = minibarListHtml(); };
  const r = document.getElementById('mbRefresh');
  if(r) r.onclick = async ()=>{ r.classList.add('spinning'); r.disabled = true; await minibarLoad(); haptic('light'); };
  const retry = document.getElementById('mbRetry');
  if(retry) retry.onclick = ()=>{ minibar.error = false; minibarLoad(); render(); };
}

/* ---------- Rozh's side: picking the items (Order screen) ---------- */
/* Words that make an item a likely minibar one: fruit, sweets, minibar drinks and barista things, in
   English, Kurdish and Arabic. Matched on the item's and its supplier's names. */
const MINIBAR_HINTS = {
  fruit:['banana', 'strawberr', 'apple', 'mango', 'kiwi', 'orange', 'lemon', 'lime', 'pineapple', 'avocado', 'berry', 'blueberr', 'grape', 'watermelon', 'melon', 'peach', 'cherry', 'pomegranate', 'passion', 'fruit', 'date',
    'موز', 'فراول', 'تفاح', 'سێو', 'مانگ', 'مانجو', 'كيوي', 'کیوی', 'پرتەقاڵ', 'برتقال', 'لیمۆ', 'ليمون', 'اناناس', 'ئەناناس', 'أفوكادو', 'ئەڤۆکادۆ', 'عنب', 'تری', 'شمزي', 'شووتی', 'بطيخ', 'خوخ', 'قۆخ', 'کرێز', 'رمان', 'هەنار', 'فاكه', 'میوە', 'خورما', 'تمر'],
  sweets:['chocolate', 'choco', 'nutella', 'cake', 'cheesecake', 'cream', 'biscuit', 'oreo', 'lotus', 'caramel', 'syrup', 'sugar', 'honey', 'cocoa', 'vanilla', 'jam', 'sauce', 'sprinkle', 'cookie', 'wafer', 'kitkat', 'pistachio', 'ice cream',
    'شوكولا', 'شۆکۆلات', 'نوتيلا', 'نۆتێلا', 'كيك', 'کێک', 'قشطة', 'کرێم', 'كريم', 'بسكويت', 'بسکیت', 'لوتس', 'لۆتس', 'كراميل', 'کارامێل', 'شراب', 'شەربەت', 'سكر', 'شەکر', 'عسل', 'هەنگوین', 'كاكاو', 'کاکاو', 'فانيلا', 'ڤانیلا', 'مربى', 'موڕەبا', 'فستق', 'بوظة', 'دۆندرمە', 'ئایسکرێم'],
  drinks:['milk', 'juice', 'water', 'soda', 'cola', 'pepsi', 'sprite', '7up', 'fanta', 'red bull', 'energy', 'ice', 'tonic', 'mojito', 'smoothie', 'yogurt', 'laban', 'almarai', 'drink',
    'حليب', 'شیر', 'عصير', 'شەربەت', 'ماء', 'ئاو', 'صودا', 'كولا', 'کۆلا', 'بيبسي', 'پێپسی', 'سبرايت', 'ريد بول', 'ڕێد بوڵ', 'ثلج', 'سەهۆڵ', 'موهيتو', 'لبن', 'ماست', 'دۆ', 'المراعي', 'مەراعی', 'مشروب', 'خواردنەوە'],
  barista:['coffee', 'espresso', 'bean', 'latte', 'cappuccino', 'mocha', 'americano', 'cup', 'lid', 'straw', 'monin', 'barista', 'matcha', 'tea', 'whipp', 'foam', 'sleeve', 'stirrer', 'napkin',
    'قهوة', 'قاوە', 'قهوە', 'اسبريسو', 'ئێسپرێسۆ', 'لاتيه', 'لاتێ', 'كوب', 'کوپ', 'گڵاس', 'غطاء', 'قەپاغ', 'شفاط', 'قامیش', 'مونين', 'ماتشا', 'شاي', 'چا', 'منديل', 'دەسماڵ'],
};
function minibarWordScore(item){
  const sup = state.suppliers.find(s=>s.id === item.supplierId)?.name || '';
  const name = foldText(item.name), all = foldText(item.name + ' ' + sup);
  let score = 0;
  for(const words of Object.values(MINIBAR_HINTS)){
    if(words.some(w=>name.includes(foldText(w)))) score += 3;
    else if(words.some(w=>all.includes(foldText(w)))) score += 1;
  }
  return score;
}
/* Why an item is suggested, strongest first: it usually goes to the Minibar (from Ricotta Restaurant's
   stock record), Ahmad's recipes use its stock item, or its name looks like a minibar thing. */
function minibarWhy(item, hints){
  const links = typeof itemLinks === 'function' ? itemLinks(item) : [item.stockItem].filter(Boolean);
  const moved = links.reduce((n, l)=>n + (Number(hints?.moved?.[l]) || 0), 0);
  if(moved > 0) return {score:100 + Math.min(moved, 99), why:t('mb_whyMoved')};
  if(links.some(l=>(hints?.recipes || []).includes(l))) return {score:50, why:t('mb_whyRecipes')};
  const w = minibarWordScore(item);
  return w > 0 ? {score:w, why:t('mb_whyName')} : {score:0, why:''};
}
async function minibarSave(ids){
  const r = await api('minibar', {method:'PUT', body:{itemIds:[...ids]}});
  if(!r.ok){ toast(t('saveFailed'), 'error'); return false; }
  minibar.account = state.account; minibar.data = minibarClean(r.data);
  return true;
}
/* Hold an item on the Order screen: add it to Ahmad's stock or take it off (with Undo). */
async function minibarToggle(id){
  if(!minibar.data || minibar.account !== state.account){ await minibarLoad(); if(!minibar.data){ toast(t('loadFailed'), 'error'); return; } }
  const before = minibarPicked(), next = new Set(before), had = next.has(id);
  if(had) next.delete(id); else next.add(id);
  if(!(await minibarSave(next))) return;
  haptic('light');
  toast(had ? t('mb_removed') : t('mb_added'), 'ok', {undo:async ()=>{ await minibarSave(before); }});
}
const minibarHas = id=>!!minibar.data && minibar.account === state.account && minibarPicked().has(id);
/* The whole list for Rozh. With nothing typed: suggestions not picked yet, then the picked ones. Typing
   searches every food item by its name and the names it goes by, like the Order screen. A tap ticks or
   unticks; Save keeps the list. */
async function openMinibarManager(){
  if(!minibar.data || minibar.account !== state.account) await minibarLoad();
  if(!minibar.data){ toast(t('loadFailed'), 'error'); return; }
  const picked = minibarPicked(), hints = minibar.data.hints, S = globalThis.RicottaSearch;
  const items = state.items.filter(i=>itemKind(i) !== 'expense' || picked.has(i.id)).sort((a, b)=>String(a.name).localeCompare(String(b.name), state.lang));
  const scored = items.map(i=>({i, ...minibarWhy(i, hints)}));
  const tick = x=>`<label class="mb-pick${picked.has(x.i.id) ? ' on' : ''}"><input type="checkbox" data-mb-id="${esc(x.i.id)}" ${picked.has(x.i.id) ? 'checked' : ''}>
    <span class="mb-pick-text"><span dir="auto">${esc(x.i.name)}</span>${x.why ? `<small>${esc(x.why)}</small>` : ''}</span><i class="mb-tick" aria-hidden="true">${ICON_CHECK}</i></label>`;
  const section = (title, list)=>list.length ? `<div class="mb-sec">${esc(title)}</div><div class="rc-list mb-picks">${list.map(tick).join('')}</div>` : '';
  const body = q=>{
    if(q.trim()){
      const found = S ? S.rank(scored, q, x=>[x.i.name, ...(x.i.aliases || [])]) : scored.filter(x=>foldText(x.i.name).includes(foldText(q)));
      return section(t('mb_found'), found.slice(0, 60)) || `<p class="rc-quiet">${esc(t('mb_noMatch'))}</p>`;
    }
    const sug = scored.filter(x=>x.score > 0 && !picked.has(x.i.id)).sort((a, b)=>b.score - a.score || String(a.i.name).localeCompare(String(b.i.name), state.lang)).slice(0, 15);
    return section(t('mb_suggested'), sug) + section(t('mb_pickedNow'), scored.filter(x=>picked.has(x.i.id))) + `<p class="rc-quiet">${esc(t('mb_searchMore'))}</p>`;
  };
  const {el, close} = openKitchenSheet('mb-manage-sheet', `<div class="mb-manage"><div class="sel-title">${esc(t('mb_manageT'))}</div><p class="rc-why-intro">${esc(t('mb_manageHint'))}</p>
    ${recipeSearchBox('mbPickSearch', '', t('mb_searchItems'))}<div class="mb-manage-list" id="mbPickList">${body('')}</div>
    <div class="mb-manage-foot"><span id="mbCount">${esc(t('mb_count')(picked.size))}</span><button type="button" class="btn btn-primary" id="mbSave">${esc(t('save'))}</button></div></div>`, t('mb_manageT'));
  const bind = ()=>el.querySelectorAll('[data-mb-id]').forEach(c=>c.onchange = ()=>{
    if(c.checked) picked.add(c.dataset.mbId); else picked.delete(c.dataset.mbId);
    el.querySelectorAll(`[data-mb-id="${CSS.escape(c.dataset.mbId)}"]`).forEach(x=>{ x.checked = c.checked; x.closest('.mb-pick')?.classList.toggle('on', c.checked); });
    el.querySelector('#mbCount').textContent = t('mb_count')(picked.size);
    haptic('light');
  });
  const search = el.querySelector('#mbPickSearch');
  search.oninput = ()=>{ el.querySelector('#mbPickList').innerHTML = body(search.value); bind(); };
  el.querySelector('#mbSave').onclick = async ()=>{ const b = el.querySelector('#mbSave'); b.disabled = true; if(await minibarSave(picked)){ toast(t('mb_saved')); close(); } else b.disabled = false; };
  bind();
}
