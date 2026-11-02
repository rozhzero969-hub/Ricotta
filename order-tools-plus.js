/* The big update: helpers for the Order screen, all worked out from the orders kept on this phone.
   Nothing here sends anything; it only fills in or checks the draft. */

/* An item's amounts in past orders, oldest first. */
function itemAmounts(id){
  const out = [];
  [...state.history].sort((a, b)=>Date.parse(a.date) - Date.parse(b.date)).forEach(o=>(o.entries || []).forEach(e=>(e.items || []).forEach(it=>{ if(it.itemId === id && Number(it.qty) > 0) out.push(Number(it.qty)); })));
  return out;
}
function median(list){
  if(!list.length) return 0;
  const s = [...list].sort((a, b)=>a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const usualAmount = id=>roundQuantity(median(itemAmounts(id)));
/* Far from the usual: at least 3 past orders and 3 times more or less. Small amounts are left alone. */
function oddAmounts(){
  const out = [];
  Object.entries(state.cart).forEach(([id, qty])=>{
    if(!(qty > 0)) return;
    const item = state.items.find(i=>i.id === id), past = itemAmounts(id);
    if(!item || past.length < 3) return;
    const usual = usualAmount(id);
    if(usual > 0 && (qty >= usual * 3 || qty <= usual / 3) && Math.abs(qty - usual) >= 2) out.push({item, qty, usual});
  });
  return out;
}
/* Items usually sent with what's in the draft: for each supplier in the draft, an item in at least
   70% of its last 8 orders (at least 4 orders) that isn't in the draft. */
function forgottenItems(){
  const suppliers = new Set(Object.keys(state.cart).filter(id=>state.cart[id] > 0).map(id=>state.items.find(i=>i.id === id)?.supplierId).filter(Boolean));
  const out = [];
  suppliers.forEach(sid=>{
    const past = [...state.history].sort((a, b)=>Date.parse(b.date) - Date.parse(a.date)).flatMap(o=>(o.entries || []).filter(e=>e.supplierId === sid)).slice(0, 8);
    if(past.length < 4) return;
    const counts = new Map();
    past.forEach(e=>new Set((e.items || []).map(it=>it.itemId)).forEach(id=>counts.set(id, (counts.get(id) || 0) + 1)));
    counts.forEach((n, id)=>{
      if(n / past.length < .7 || state.cart[id] > 0) return;
      const item = state.items.find(i=>i.id === id && i.available !== false && i.supplierId === sid);
      if(item) out.push({item, usual:usualAmount(id) || 1});
    });
  });
  return out.slice(0, 6);
}
/* The usual order for a weekday: items in at least half of that weekday's orders, at their usual amount there. */
function weekdayOrder(day = new Date().getDay()){
  const weekdayOf = iso=>new Date(new Date(iso).getTime() + 3 * 3600000).getUTCDay();
  const orders = state.history.filter(o=>weekdayOf(o.date) === day);
  if(orders.length < 2) return [];
  const amounts = new Map();
  orders.forEach(o=>{
    const seen = new Map();
    (o.entries || []).forEach(e=>(e.items || []).forEach(it=>seen.set(it.itemId, (seen.get(it.itemId) || 0) + Number(it.qty))));
    seen.forEach((q, id)=>amounts.set(id, [...(amounts.get(id) || []), q]));
  });
  return [...amounts].filter(([id, list])=>list.length / orders.length >= .5 && state.items.some(i=>i.id === id && i.available !== false))
    .map(([id, list])=>({id, qty:roundQuantity(median(list))}));
}
function loadWeekdayOrder(){
  const lines = weekdayOrder();
  if(!lines.length) return;
  const before = {...state.cart};
  lines.forEach(l=>{ state.cart[l.id] = l.qty; });
  persistCartDraft(); refreshOrderView();
  toast(t('dayOrderLoaded')(lines.length), 'ok', {undo:()=>{ state.cart = before; persistCartDraft(); refreshOrderView(); }});
}
/* Which weekdays run bigger than average, for Rico's briefing. */
function busyToday(){
  const weekdayOf = iso=>new Date(new Date(iso).getTime() + 3 * 3600000).getUTCDay();
  if(state.history.length < 10) return 0;
  const lines = o=>(o.entries || []).reduce((n, e)=>n + (e.items || []).length, 0);
  const all = state.history.reduce((n, o)=>n + lines(o), 0) / state.history.length;
  const today = state.history.filter(o=>weekdayOf(o.date) === new Date().getDay());
  if(today.length < 2 || !all) return 0;
  return Math.round((today.reduce((n, o)=>n + lines(o), 0) / today.length / all - 1) * 100);
}

/* ---------- Before sending: the odd amounts and forgotten items, together ---------- */
function orderIssuesHtml(odd, forgot){
  const oddRows = odd.map(x=>`<div class="check-issue" data-issue="${esc(x.item.id)}"><div><b dir="auto">${esc(x.item.name)}: ${x.qty} ${esc(unitLabel(x.item.unit))}?</b><small>${esc(t('checkUsual')(x.usual, unitLabel(x.item.unit)))}</small></div><div class="check-actions"><button type="button" class="btn btn-primary" data-fix-qty="${esc(x.item.id)}" data-qty-to="${x.usual}">${esc(t('checkMakeIt')(x.usual))}</button><button type="button" class="btn btn-ghost" data-keep>${esc(t('checkKeep'))}</button></div></div>`).join('');
  const forgotRows = forgot.map(x=>`<div class="check-issue" data-issue="${esc(x.item.id)}"><div><b dir="auto">${esc(x.item.name)}</b><small>${esc(t('checkForgot'))}</small></div><div class="check-actions"><button type="button" class="btn btn-primary" data-fix-qty="${esc(x.item.id)}" data-qty-to="${x.usual}">${esc(t('checkAdd')(x.usual, unitLabel(x.item.unit)))}</button><button type="button" class="btn btn-ghost" data-keep>${esc(t('checkNotToday'))}</button></div></div>`).join('');
  return oddRows + forgotRows;
}
function attachOrderIssues(root, onEmpty){
  const done = row=>{ row.remove(); if(!root.querySelector('[data-issue]')) onEmpty?.(); };
  root.querySelectorAll('[data-fix-qty]').forEach(b=>b.onclick = ()=>{
    state.cart[b.dataset.fixQty] = Number(b.dataset.qtyTo);
    persistCartDraft(); if(state.view === 'order') refreshOrderView();
    done(b.closest('[data-issue]'));
  });
  root.querySelectorAll('[data-keep]').forEach(b=>b.onclick = ()=>done(b.closest('[data-issue]')));
}
/* Resolves true to go on sending, false to stay on the order. */
function reviewBeforeSend(){
  const odd = featureOn('oddOrder') ? oddAmounts() : [], forgot = featureOn('forgot') ? forgottenItems() : [];
  if(!odd.length && !forgot.length) return Promise.resolve(true);
  return new Promise(resolve=>{
    const {el, close} = openKitchenSheet('check-sheet', `<div class="check-head">${ricoFace('thinking', 'rico-md')}<div><div class="sel-title">${esc(t('checkTitle'))}</div><div class="notif-sub">${esc(t('checkSub'))}</div></div></div><div class="check-list">${orderIssuesHtml(odd, forgot)}</div><button type="button" class="btn btn-primary check-go">${esc(t('checkSendAnyway'))}</button>`, t('checkTitle'));
    let settled = false;
    const finish = go=>{ if(settled) return; settled = true; close(); resolve(go); };
    attachOrderIssues(el, ()=>{ el.querySelector('.check-go').textContent = t('checkLooksGood'); });
    el.querySelector('.check-go').onclick = ()=>finish(true);
    // Closing the sheet any other way stays on the order.
    new MutationObserver((_, ob)=>{ if(!el.isConnected){ ob.disconnect(); if(!settled){ settled = true; resolve(false); } } }).observe(document.body, {childList:true, subtree:true});
  });
}
/* 10 seconds to change your mind, between Send and the send screen. Once WhatsApp has sent a message it can't be recalled. */
function sendCountdown(){
  if(!featureOn('sendCancel')) return Promise.resolve(true);
  return new Promise(resolve=>{
    let left = 10, settled = false, timer = 0;
    const {el, close} = openKitchenSheet('countdown-sheet', `<div class="countdown"><div class="countdown-num" aria-live="off">10</div><div class="sel-title">${esc(t('sendingIn'))}</div><div class="notif-sub">${esc(t('sendingHint'))}</div><div class="countdown-actions"><button type="button" class="btn btn-ghost" data-cd="cancel">${esc(t('cancel'))}</button><button type="button" class="btn btn-primary" data-cd="now">${esc(t('sendNow'))}</button></div></div>`, t('sendingIn'));
    const finish = go=>{ if(settled) return; settled = true; clearInterval(timer); close(); resolve(go); };
    timer = setInterval(()=>{ left--; const n = el.querySelector('.countdown-num'); if(n) n.textContent = String(left); if(left <= 0) finish(true); }, 1000);
    el.querySelector('[data-cd=cancel]').onclick = ()=>finish(false);
    el.querySelector('[data-cd=now]').onclick = ()=>finish(true);
    new MutationObserver((_, ob)=>{ if(!el.isConnected){ ob.disconnect(); if(!settled){ settled = true; clearInterval(timer); resolve(false); } } }).observe(document.body, {childList:true, subtree:true});
  });
}
/* Press and hold the Send button (Settings > Features). */
function attachHoldToSend(button, go){
  if(!button) return;
  button.classList.add('hold-send');
  button.querySelector('.send-hold-fill')?.remove();
  button.insertAdjacentHTML('afterbegin', '<i class="send-hold-fill" aria-hidden="true"></i>');
  let timer = 0;
  const stop = ()=>{ clearTimeout(timer); button.classList.remove('holding'); };
  button.onclick = e=>{ if(e.detail === 0) go(); else toast(t('holdToSend')); };   // the keyboard still works
  button.onpointerdown = ()=>{ if(button.disabled) return; button.classList.add('holding'); timer = setTimeout(()=>{ stop(); go(); }, 800); };
  ['pointerup','pointerleave','pointercancel'].forEach(type=>button.addEventListener(type, stop));
}

/* ---------- Swipe an item for its usual amount ---------- */
function attachSwipeUsual(root){
  if(!featureOn('swipe') || !root) return;
  root.querySelectorAll('.item-row').forEach(row=>{
    let start = null;
    row.addEventListener('pointerdown', e=>{ if(e.pointerType !== 'mouse' && !e.target.closest('.stepper')) start = {x:e.clientX, y:e.clientY}; }, {passive:true});
    row.addEventListener('pointermove', e=>{
      if(!start) return;
      const dx = (e.clientX - start.x) * (isRtl() ? -1 : 1), dy = Math.abs(e.clientY - start.y);
      if(dy > 24){ start = null; row.style.transform = ''; return; }
      if(dx > 0 && dx > dy) row.style.transform = `translateX(${(isRtl() ? -1 : 1) * Math.min(dx, 80)}px)`;
    }, {passive:true});
    const end = e=>{
      if(!start) return;
      const dx = (e.clientX - start.x) * (isRtl() ? -1 : 1);
      start = null; row.style.transform = '';
      if(dx < 70) return;
      const id = row.dataset.itemId, usual = usualAmount(id);
      if(!usual){ toast(t('swipeNoUsual')); return; }
      if(state.cart[id] === usual) return;
      const before = state.cart[id] || 0;
      state.cart[id] = usual;
      persistCartDraft(); refreshOrderView(id);
      toast(t('swipeAdded')(usual, unitLabel(state.items.find(i=>i.id === id)?.unit)), 'ok', {undo:()=>{ if(before) state.cart[id] = before; else delete state.cart[id]; persistCartDraft(); refreshOrderView(id); }});
    };
    row.addEventListener('pointerup', end, {passive:true});
    row.addEventListener('pointercancel', ()=>{ start = null; row.style.transform = ''; }, {passive:true});
  });
}

/* ---------- A pasted message or a photo of a paper list becomes an order to check ---------- */
function shrinkImage(file, largest = 1600, quality = .82){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, largest / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
function openReadList(){
  const {el, close} = openKitchenSheet('list-sheet', `<div class="sel-title">${esc(t('listTitle'))}</div><div class="notif-sub">${esc(t('listHint'))}</div>
    <label class="sr-only" for="listText">${esc(t('listTitle'))}</label><textarea id="listText" rows="5" dir="auto" placeholder="${esc(t('listPlaceholder'))}"></textarea>
    <div class="list-actions"><label class="btn btn-ghost list-photo">${ICON_CAMERA}<span>${esc(t('listPhoto'))}</span><input type="file" id="listPhoto" accept="image/*" capture="environment" hidden></label><button type="button" class="btn btn-primary" id="listRead">${esc(t('listRead'))}</button></div>
    <div class="status-line" id="listStatus" role="status"></div><div id="listRows"></div>`, t('listTitle'));
  const status = el.querySelector('#listStatus'), rowsBox = el.querySelector('#listRows');
  const read = async body=>{
    if(!(await aiConsent())) return;
    status.textContent = t('listReading'); rowsBox.innerHTML = '';
    const r = await api('orders/read-list', {method:'POST', body});
    if(!r.ok){ status.textContent = t('listFailed'); return; }
    status.textContent = '';
    showRows(r.data?.rows || []);
  };
  const showRows = rows=>{
    if(!rows.length){ status.textContent = t('listNothing'); return; }
    rowsBox.innerHTML = `<div class="list-rows">${rows.map((row, i)=>{
      const item = state.items.find(x=>x.id === row.itemId);
      return `<div class="list-row-read${item ? '' : ' unsure'}" data-read="${i}"><div><b dir="auto">${esc(item ? item.name : row.said)}</b><small dir="auto">${esc(item ? (row.said || unitLabel(item.unit)) : t('listNoMatch'))}</small></div>${item ? `<label class="sr-only" for="readQty${i}">${esc(t('quantityFor')(item.name))}</label><input id="readQty${i}" type="number" inputmode="decimal" min="0" step="0.001" value="${Number(row.qty) || usualAmount(item.id) || 1}" data-read-qty="${esc(item.id)}">` : ''}</div>`;
    }).join('')}</div><button type="button" class="btn btn-primary" id="listAdd">${esc(t('listAdd'))}</button>`;
    rowsBox.querySelector('#listAdd').onclick = ()=>{
      const before = {...state.cart};
      let n = 0;
      rowsBox.querySelectorAll('[data-read-qty]').forEach(box=>{ const q = readQuantity(box.value); if(validOrderQuantity(q) && q > 0){ state.cart[box.dataset.readQty] = q; n++; } });
      close();
      if(!n) return;
      persistCartDraft(); if(state.view === 'order') refreshOrderView();
      toast(t('listAdded')(n), 'ok', {undo:()=>{ state.cart = before; persistCartDraft(); refreshOrderView(); }});
    };
  };
  el.querySelector('#listRead').onclick = ()=>{ const text = el.querySelector('#listText').value.trim(); if(text) read({text}); };
  el.querySelector('#listPhoto').onchange = async e=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{ read({image:await shrinkImage(file), mime:'image/jpeg'}); }catch(_){ status.textContent = t('listFailed'); }
  };
}

/* ---------- Where things are kept, and a sheet to print ---------- */
const orderByPlace = ()=>lget('orderByPlace') === true;
function itemsByPlace(items){
  const groups = new Map();
  [...items].sort((a, b)=>nameCollator().compare(a.name || '', b.name || '')).forEach(i=>{
    const k = i.place || '';
    groups.set(k, [...(groups.get(k) || []), i]);
  });
  return [...groups].sort(([a], [b])=>(a ? 0 : 1) - (b ? 0 : 1) || nameCollator().compare(a, b));
}
const knownPlaces = ()=>[...new Set(state.items.map(i=>i.place).filter(Boolean))].sort((a, b)=>nameCollator().compare(a, b));
/* A clean paper list: printed from the browser's own print window. */
function printOrderSheet(){
  const selected = state.items.filter(i=>state.cart[i.id] > 0);
  const rows = selected.length ? selected : state.items.filter(i=>i.available !== false);
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.innerHTML = `<h1>ricotta. ${esc(t('printTitle'))}</h1><p>${esc(formatIraqDateTime(new Date(), {weekday:'long', day:'numeric', month:'long'}))}</p>${itemsByPlace(rows).map(([place, list])=>`<h2>${esc(place || t('placeNone'))}</h2><table><tbody>${list.map(i=>`<tr><td class="box"></td><td dir="auto">${esc(i.name)}</td><td class="qty">${state.cart[i.id] > 0 ? state.cart[i.id] : ''}</td><td>${esc(unitLabel(i.unit))}</td></tr>`).join('')}</tbody></table>`).join('')}`;
  document.body.appendChild(sheet);
  const done = ()=>{ sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

/* ---------- An item's place and picture, in its form ---------- */
function itemExtraFields(existing){
  if(!existing) return '';
  const places = knownPlaces();
  return `<div class="field"><label for="mfPlace">${esc(t('placeLabel'))}</label><input id="mfPlace" list="mfPlaces" maxlength="40" dir="auto" value="${esc(existing.place || '')}" placeholder="${esc(t('placeHint'))}"><datalist id="mfPlaces">${places.map(p=>`<option value="${esc(p)}"></option>`).join('')}</datalist></div>
    <div class="field"><label>${esc(t('photoLabel'))}</label><div class="photo-field">${existing.photoUrl ? `<img class="photo-thumb" src="${esc(existing.photoUrl)}" alt="">` : ''}<label class="btn btn-ghost">${ICON_CAMERA}<span>${esc(t(existing.photoUrl ? 'photoChange' : 'photoAdd'))}</span><input type="file" id="mfPhoto" accept="image/*" hidden></label>${existing.photoUrl ? `<button type="button" class="btn btn-ghost danger-text" id="mfPhotoRemove">${esc(t('photoRemove'))}</button>` : ''}</div><small class="field-hint" id="mfPhotoStatus" role="status"></small></div>`;
}
function attachItemExtras(box, existing){
  if(!existing) return;
  const status = box.querySelector('#mfPhotoStatus');
  box.querySelector('#mfPhoto')?.addEventListener('change', async e=>{
    const file = e.target.files?.[0];
    if(!file) return;
    status.textContent = t('photoSaving');
    try{
      const image = await shrinkImage(file, 240, .78);
      const r = await api(`items/${encodeURIComponent(existing.id)}/photo`, {method:'POST', body:{image}});
      if(!r.ok) throw new Error('photo');
      existing.photoUrl = r.data.photoUrl;
      const live = state.items.find(i=>i.id === existing.id);
      if(live) live.photoUrl = r.data.photoUrl;
      status.textContent = t('photoSaved');
      const field = box.querySelector('.photo-field');
      field.querySelector('.photo-thumb')?.remove();
      field.insertAdjacentHTML('afterbegin', `<img class="photo-thumb" src="${esc(r.data.photoUrl)}" alt="">`);
    }catch(_){ status.textContent = t('saveFailed'); }
  });
  box.querySelector('#mfPhotoRemove')?.addEventListener('click', async ()=>{
    const r = await api(`items/${encodeURIComponent(existing.id)}/photo`, {method:'DELETE'});
    if(!r.ok){ status.textContent = t('saveFailed'); return; }
    existing.photoUrl = null;
    const live = state.items.find(i=>i.id === existing.id);
    if(live) live.photoUrl = null;
    box.querySelector('.photo-thumb')?.remove();
    box.querySelector('#mfPhotoRemove')?.remove();
    status.textContent = t('photoSaved');
  });
}
async function saveItemPlace(i, place){
  const next = place.trim().slice(0, 40) || null;
  if(next === (i.place || null)) return true;
  const r = await api(`items/${encodeURIComponent(i.id)}/extra`, {method:'PUT', body:{place:next}});
  if(r.ok) i.place = next;
  return r.ok;
}
