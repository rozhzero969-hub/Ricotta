/* Ahmad's Stock tab (the minibar): how much of each item Rozh picked for him is in Main Storage, A to Z,
   with a search box and when the stock was last read. Nothing else, nothing to change.
   Rozh picks the items on the Order screen: hold an item, "Show in Ahmad's stock", or "Ahmad's stock
   list" for the whole list with suggestions (fruit, sweets, minibar drinks and barista items first).
   Only Rozh can change it (the API checks). GET/PUT minibar (supabase/functions/api/minibar.ts). */
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
const minibarClean = d=>({items:Array.isArray(d?.items) ? d.items : [], at:d?.at || null, picked:d?.picked || 0});
const minibarPicked = ()=>new Set((minibar.data?.items || []).map(i=>i.id));

/* How much is in Main Storage, in its own unit (12 cartons, 3.5 kilos; several links added up). */
function minibarAmount(st){
  if(!st || st.missing) return {text:t('mb_noLink'), tone:'gray'};
  if(st.empty || (!st.multi && !(Number(st.qty) > 0))) return {text:t('mb_none'), tone:'red'};
  const kinds = st.multi && Array.isArray(st.kinds) && st.kinds.length ? st.kinds : [{qty:st.qty, unit:st.unit}];
  return {text:kinds.map(k=>'⁦' + stockQty(k.qty) + ' ' + (k.unit || '') + '⁩').join(' + '), tone:st.level === 'low' ? 'amber' : 'green'};
}
function minibarRow(i, n){
  const a = minibarAmount(i.stock);
  return `<div class="mb-row rc-in" style="--i:${Math.min(n, 14)}"><span class="rc-letter-sm ${recipeHue(i.name)}" aria-hidden="true">${esc(recipeLetter(i.name))}</span>
    <span class="mb-name" dir="auto">${esc(i.name)}</span>
    <span class="mb-amount ${a.tone}" dir="auto">${a.tone === 'amber' ? `<i>${esc(t('mb_low'))}</i>` : ''}${esc(a.text)}</span></div>`;
}
function minibarRows(){
  const q = foldText(minibar.query.trim());
  return [...minibar.data.items].sort((a, b)=>String(a.name).localeCompare(String(b.name), state.lang)).filter(i=>!q || foldText(i.name).includes(q));
}
function minibarListHtml(){
  const rows = minibarRows();
  return rows.length ? `<div class="mb-list">${rows.map(minibarRow).join('')}</div>` : recipeEmpty('search', t('mb_noMatch'), t('mb_noMatchHint'), '', '');
}
function renderMinibar(){
  if(minibar.account !== state.account) minibarReset();
  if(!minibar.data){
    if(!minibar.loading && !minibar.error) minibarLoad();
    return `<div class="rc-page mb-page">${minibar.error ? recipeEmpty('oops', t('loadFailed'), '', 'mbRetry', t('retry')) : loadingLines(6)}</div>`;
  }
  const d = minibar.data;
  if(!d.items.length) return `<div class="rc-page mb-page">${recipeEmpty('stock', t('mb_emptyT'), t('mb_empty'), '', '')}</div>`;
  const old = d.at && typeof stockIsOld === 'function' && stockIsOld(d.at);
  return `<div class="rc-page mb-page">
    <div class="rc-tools">${recipeSearchBox('mbSearch', minibar.query, t('mb_search'))}
      <button type="button" class="rc-round" id="mbRefresh" aria-label="${esc(t('mb_refresh'))}" title="${esc(t('mb_refresh'))}">${ICON_REFRESH}</button></div>
    <p class="mb-when${old ? ' old' : ''}" dir="auto"><i aria-hidden="true"></i>${esc(d.at ? t('mb_readAt')(timeAgo(d.at), formatIraqDateTime(d.at, {hour:'numeric', minute:'2-digit'})) : t('mb_readNever'))}</p>
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
    'شوكولا', 'شۆکۆلات', 'نوتيلا', 'نۆتێلا', 'كيك', 'کێک', 'قشطة', 'کرێم', 'كريم', 'بسكويت', 'بسکیت', 'لوتس', 'لۆتس', 'كراميل', 'کارامێل', 'شراب', 'شەربەت', 'سكر', 'شەکر', 'عسل', 'هەنگوین', 'كاكاو', 'کاکاو', 'فانيلا', 'ڤانیلا', 'مربى', 'موڕەبا', 'فستق', 'فستق', 'بوظة', 'دۆندرمە', 'ئایسکرێم'],
  drinks:['milk', 'juice', 'water', 'soda', 'cola', 'pepsi', 'sprite', '7up', 'fanta', 'red bull', 'energy', 'ice', 'tonic', 'mojito', 'smoothie', 'yogurt', 'laban', 'almarai', 'drink',
    'حليب', 'شیر', 'عصير', 'شەربەت', 'ماء', 'ئاو', 'صودا', 'كولا', 'کۆلا', 'بيبسي', 'پێپسی', 'سبرايت', 'ريد بول', 'ڕێد بوڵ', 'ثلج', 'سەهۆڵ', 'موهيتو', 'لبن', 'ماست', 'دۆ', 'المراعي', 'مەراعی', 'مشروب', 'خواردنەوە'],
  barista:['coffee', 'espresso', 'bean', 'latte', 'cappuccino', 'mocha', 'americano', 'cup', 'lid', 'straw', 'monin', 'barista', 'matcha', 'tea', 'whipp', 'foam', 'sleeve', 'stirrer', 'napkin',
    'قهوة', 'قاوە', 'قهوە', 'اسبريسو', 'ئێسپرێسۆ', 'لاتيه', 'لاتێ', 'كوب', 'کوپ', 'گڵاس', 'غطاء', 'قەپاغ', 'شفاط', 'قامیش', 'مونين', 'ماتشا', 'شاي', 'چا', 'منديل', 'دەسماڵ'],
};
function minibarScore(item){
  const sup = state.suppliers.find(s=>s.id === item.supplierId)?.name || '';
  const name = foldText(item.name), all = foldText(item.name + ' ' + sup);
  let score = 0;
  for(const words of Object.values(MINIBAR_HINTS)){
    if(words.some(w=>name.includes(foldText(w)))) score += 3;
    else if(words.some(w=>all.includes(foldText(w)))) score += 1;
  }
  return score;
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
/* The whole list for Rozh: suggestions first (likely minibar items not picked yet), then every food item
   A to Z with a tick. Saved with one button. */
async function openMinibarManager(){
  if(!minibar.data || minibar.account !== state.account) await minibarLoad();
  if(!minibar.data){ toast(t('loadFailed'), 'error'); return; }
  const picked = minibarPicked();
  const items = state.items.filter(i=>itemKind(i) !== 'expense' || picked.has(i.id)).sort((a, b)=>String(a.name).localeCompare(String(b.name), state.lang));
  const scored = items.map(i=>({i, s:minibarScore(i)}));
  const tick = i=>`<label class="mb-pick${picked.has(i.id) ? ' on' : ''}"><input type="checkbox" data-mb-id="${esc(i.id)}" ${picked.has(i.id) ? 'checked' : ''}><span class="rc-letter-sm ${recipeHue(i.name)}" aria-hidden="true">${esc(recipeLetter(i.name))}</span><span dir="auto">${esc(i.name)}</span><i class="mb-tick" aria-hidden="true">${ICON_CHECK}</i></label>`;
  const body = q=>{
    const f = foldText(q.trim()), match = x=>!f || foldText(x.i.name).includes(f);
    const sug = scored.filter(x=>x.s > 0 && !picked.has(x.i.id) && match(x)).sort((a, b)=>b.s - a.s || String(a.i.name).localeCompare(String(b.i.name), state.lang)).slice(0, 12);
    const rest = scored.filter(match);
    return `${sug.length ? `<div class="mb-sec">${esc(t('mb_suggested'))}</div><div class="mb-picks">${sug.map(x=>tick(x.i)).join('')}</div>` : ''}
      <div class="mb-sec">${esc(t('mb_allItems'))}</div><div class="mb-picks">${rest.map(x=>tick(x.i)).join('') || `<p class="rc-quiet">${esc(t('mb_noMatch'))}</p>`}</div>`;
  };
  const {el, close} = openKitchenSheet('mb-manage-sheet', `<div class="mb-manage"><div class="sel-title">${esc(t('mb_manageT'))}</div><p class="rc-why-intro">${esc(t('mb_manageHint'))}</p>
    ${recipeSearchBox('mbPickSearch', '', t('mb_searchItems'))}<div class="mb-manage-list" id="mbPickList">${body('')}</div>
    <div class="mb-manage-foot"><span id="mbCount">${esc(t('mb_count')(picked.size))}</span><button type="button" class="rc-cta" id="mbSave">${ICON_CHECK}<span>${esc(t('save'))}</span></button></div></div>`, t('mb_manageT'));
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
