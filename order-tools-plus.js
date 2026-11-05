/* Helpers for the Order screen, worked out from the orders kept on this phone: an item's usual amount,
   the usual order for a weekday, and swiping an item for its usual amount. Nothing here sends anything. */

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
/* The usual order for a weekday: items in at least half of that weekday's orders, at their usual amount there. */
function weekdayOrder(day = new Date(Date.now() + 3 * 3600000).getUTCDay()){
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

