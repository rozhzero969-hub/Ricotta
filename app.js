/* Ricotta Orders -- app state, rendering and event handlers.
   Depends on: DEFAULT_UNITS, SUPABASE_URL, SUPABASE_ANON_KEY, PIN consts
   (config.js), T (i18n.js), icon strings (icons.js), sget/sset/appVerifyPin/
   appGetPins/appSetPins/appGetCloudConfig/appSetCloudConfig (storage.js),
   showConfirm and showAlert (modals.js). Load this file last. */
/* ============ State ============ */
let state = {
  lang: 'en',
  role: null,           // 'admin' | 'user' | null
  view: 'order',
  pinBuffer: '',
  pinError: false,
  pinExpanded: false,
  justExpanded: false,
  suppliers: [],
  items: [],
  units: [],
  // supabaseUrl/supabaseKey are public connection info, not secrets --
  // see the comment in config.js. adminPin/userPin/cloudPassword are
  // NEVER stored here except transiently, right after a correct RPC
  // check, for as long as the relevant screen needs to display them.
  settings: { supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY },
  adminPinEntered: null,     // this session's admin PIN, kept in memory only,
                             // used to authorize PIN/cloud-config changes
  cloudPasswordEntered: null,
  history: [],
  cart: {},              // itemId -> qty
  search: '',
  orderTab: 'all',        // 'all' | supplierId | '__none'
  cloudUnlocked: false,   // whether the Cloud Setup section is currently revealed
  itemFormSupplierId: null, // supplier "locked in" for the add-item form
  queue: null            // array of {supplierId, sent} while sending
};

function t(key){ return T[state.lang][key]; }

/* Escapes text before it's inserted into innerHTML, so an item/supplier/
   unit name typed by staff can never break out of its tag and inject HTML. */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============ Boot ============ */
async function boot(){
  const [suppliers, items, units, history, lang] = await Promise.all([
    sget('suppliers', true), sget('items', true), sget('units', true),
    sget('orderHistory', true), sget('lang', false)
  ]);
  state.suppliers = suppliers || [];
  state.items = items || [];
  state.units = units || DEFAULT_UNITS;
  if(!units) await sset('units', DEFAULT_UNITS, true);
  state.history = history || [];
  state.lang = lang || 'en';
  const savedRole = lget('session');
  if(savedRole === 'admin' || savedRole === 'user') state.role = savedRole;
  render();
}

function applyLangClasses(){
  document.body.className = state.lang === 'ku' ? 'lang-ku' : '';
  document.documentElement.className = state.lang === 'ku' ? 'rtl' : '';
}

/* ============ Render dispatch ============ */
function render(){
  applyLangClasses();
  const app = document.getElementById('app');
  if(!state.role){ app.innerHTML = renderLogin(); attachLoginEvents(); return; }
  let body = '';
  if(state.view === 'order') body = renderOrder();
  else if(state.view === 'queue') body = renderQueue();
  else if(state.view === 'history') body = renderHistory();
  else if(state.view === 'suppliers') body = renderSuppliers();
  else if(state.view === 'itemsAdmin') body = renderItemsAdmin();
  else if(state.view === 'units') body = renderUnits();
  else if(state.view === 'settings') body = renderSettings();

  app.innerHTML = `
    ${renderTopbar()}
    <div class="content">${body}</div>
    ${state.view === 'order' ? renderOrderBottomBar() : ''}
    ${renderBottomNav()}
  `;
  attachCommonEvents();
  if(state.view === 'order') attachOrderEvents();
  if(state.view === 'queue') attachQueueEvents();
  if(state.view === 'history') attachHistoryEvents();
  if(state.view === 'suppliers') attachSupplierEvents();
  if(state.view === 'itemsAdmin') attachItemEvents();
  if(state.view === 'units') attachUnitEvents();
  if(state.view === 'settings') attachSettingsEvents();
}

/* ============ Topbar & nav ============ */
function renderTopbar(){
  return `
  <div class="topbar">
    <div class="brand"><span class="dot"></span>${t('appName')}</div>
    <div class="topbar-actions">
      <button class="pill-btn ${state.lang==='en'?'active':''}" data-lang="en">EN</button>
      <button class="pill-btn ${state.lang==='ku'?'active':''}" data-lang="ku">KU</button>
      <button class="pill-btn" id="logoutBtn">${t('logout')}</button>
    </div>
  </div>`;
}
function renderBottomNav(){
  const tabs = [
    {id:'order', label:t('order')},
    {id:'history', label:t('history')}
  ];
  if(state.role === 'admin'){
    tabs.push({id:'suppliers', label:t('suppliers')});
    tabs.push({id:'itemsAdmin', label:t('items')});
    tabs.push({id:'units', label:t('units')});
    tabs.push({id:'settings', label:t('settings')});
  }
  return `<div class="bottomnav">
    ${tabs.map(tb=>`
      <button class="navbtn ${state.view===tb.id?'active':''}" data-view="${tb.id}">
        ${NAV_ICONS[tb.id]}<span>${tb.label}</span>
      </button>`).join('')}
  </div>`;
}
function attachCommonEvents(){
  document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=async()=>{
    state.lang = b.dataset.lang; await sset('lang', state.lang, false); render();
  });
  const lo = document.getElementById('logoutBtn');
  if(lo) lo.onclick = ()=>{
    state.role=null; state.pinBuffer=''; state.view='order'; state.cloudUnlocked=false;
    state.adminPinEntered=null; state.cloudPasswordEntered=null;
    lset('session', null); render();
  };
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
    state.view=b.dataset.view; render();
  });
}

/* ============ Login (PIN pad) ============ */
function renderLogin(){
  const dotCount = state.pinExpanded ? ADMIN_PIN_LEN : USER_PIN_LEN;
  const dots = Array.from({length:dotCount}).map((_,i)=>{
    const filled = i < state.pinBuffer.length;
    const isNew = state.justExpanded && i >= USER_PIN_LEN;
    return `<span class="pin-dot ${filled?'filled':''} ${state.pinError?'err':''} ${isNew?'pop':''}"><span class="core"></span></span>`;
  }).join('');
  const keys = ['1','2','3','4','5','6','7','8','9'];
  return `
  <div class="login-wrap">
    <div class="login-logo">R<span class="dot-i">i</span>cotta</div>
    <div class="login-heading">
      <div class="login-title">${t('signIn')}</div>
      <div class="login-sub">${t('signInSub')}</div>
    </div>
    <div class="pin-label">${t('enterPin')}</div>
    <div class="pin-dots">${dots}</div>
    ${state.pinExpanded && !state.pinError ? `<div class="admin-hint">${t('adminHint')}</div>` : ''}
    <div class="login-error" style="visibility:${state.pinError?'visible':'hidden'};">${t('wrongPin')}</div>
    <div class="keypad">
      ${keys.map(k=>`<button class="key" data-key="${k}">${k}</button>`).join('')}
      <button class="key clear" data-key="clear">${t('clear')}</button>
      <button class="key" data-key="0">0</button>
      <button class="key backspace" data-key="back">${ICON_BACKSPACE}</button>
    </div>
    <button class="lang-pill" id="loginLangToggle">${ICON_GLOBE} ${state.lang==='en'?'English':'کوردی'} ${ICON_CHEVRON}</button>
  </div>`;
}
function attachLoginEvents(){
  state.justExpanded = false;
  const toggle = document.getElementById('loginLangToggle');
  if(toggle) toggle.onclick = async ()=>{
    state.lang = state.lang==='en' ? 'ku' : 'en';
    await sset('lang', state.lang, false); render();
  };
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick=async ()=>{
    const k = b.dataset.key;
    if(k==='clear'){ state.pinBuffer=''; state.pinError=false; state.pinExpanded=false; render(); return; }
    if(k==='back'){
      state.pinBuffer = state.pinBuffer.slice(0,-1); state.pinError=false;
      if(state.pinBuffer.length < USER_PIN_LEN) state.pinExpanded = false;
      render(); return;
    }
    if(state.pinBuffer.length>=MAX_PIN_LEN) return;
    state.pinBuffer += k;

    if(state.pinBuffer.length===USER_PIN_LEN && !state.pinExpanded){
      const role = await appVerifyPin(state.pinBuffer);
      if(role === 'user'){ state.role='user'; state.pinBuffer=''; lset('session', 'user'); render(); return; }
      // Wrong, or possibly just the start of a longer admin PIN -- expand
      // the pad rather than failing outright, same as before.
      state.pinExpanded = true;
      state.justExpanded = true;
      render();
      return;
    }
    if(state.pinBuffer.length===ADMIN_PIN_LEN){
      const role = await appVerifyPin(state.pinBuffer);
      if(role === 'admin'){
        state.role='admin'; state.adminPinEntered = state.pinBuffer;
        state.pinBuffer=''; state.pinExpanded=false; lset('session', 'admin'); render(); return;
      }
      state.pinError = true; render();
      setTimeout(()=>{ state.pinBuffer=''; state.pinError=false; state.pinExpanded=false; render(); }, 700);
      return;
    }
    render();
  });
}

/* ============ Order screen ============ */
function unitLabel(unitId){
  const u = state.units.find(x=>x.id===unitId);
  if(!u) return '';
  return state.lang==='ku' ? (u.ku||u.en) : u.en;
}
function supplierName(id){
  const s = state.suppliers.find(x=>x.id===id);
  return s ? s.name : t('noSupplier');
}
function lastOrderMap(){
  if(!state.history.length) return null;
  const last = state.history[state.history.length-1];
  const map = {};
  last.entries.forEach(e=>e.items.forEach(it=>{ map[it.itemId] = it.qty; }));
  return map;
}
function renderOrderHero(){
  const selCount = cartCount();
  const supCount = new Set(state.items.map(i=>i.supplierId).filter(Boolean)).size;
  return `<div class="hero-card">
    <div class="hero-eyebrow">${t('heroEyebrow')}</div>
    <div class="hero-stat">${t('heroStat')(selCount)}</div>
    <div class="hero-sub">${t('heroSub')(state.items.length, supCount)}</div>
  </div>`;
}
function orderTabs(){
  const tabs = [{id:'all', label:t('allSuppliers')}];
  state.suppliers.forEach(s=>{
    if(state.items.some(i=>i.supplierId===s.id)) tabs.push({id:s.id, label:s.name});
  });
  if(state.items.some(i=>!i.supplierId)) tabs.push({id:'__none', label:t('noSupplier')});
  return tabs;
}
function renderOrder(){
  if(!state.items.length){
    return `<div class="empty">${state.role==='admin'?t('noItemsYet'):t('noItemsUser')}</div>`;
  }
  const tabs = orderTabs();
  if(!tabs.some(tb=>tb.id===state.orderTab)) state.orderTab = 'all';

  const q = state.search.trim().toLowerCase();
  const tabFiltered = state.orderTab==='all'
    ? state.items
    : state.items.filter(i=>(i.supplierId||'__none')===state.orderTab);
  const visibleItems = tabFiltered.filter(i => !q || i.name.toLowerCase().includes(q));

  const groups = {};
  visibleItems.forEach(i=>{
    const key = i.supplierId || '__none';
    (groups[key] = groups[key]||[]).push(i);
  });
  const groupHtml = Object.keys(groups).map(key=>{
    const label = key==='__none' ? t('noSupplier') : supplierName(key);
    const rows = groups[key].map(i=>{
      const qty = state.cart[i.id] || 0;
      return `
      <div class="item-row ${qty>0?'has-qty':''}">
        <div class="item-info">
          <div class="item-name">${esc(i.name)}</div>
          <div class="item-unit">${esc(unitLabel(i.unit))}</div>
        </div>
        <div class="stepper">
          <button class="step-btn" data-dec="${i.id}">−</button>
          <input class="qty-input" type="number" inputmode="numeric" min="0" value="${qty}" data-qty="${i.id}">
          <button class="step-btn" data-inc="${i.id}">+</button>
        </div>
      </div>`;
    }).join('');
    return state.orderTab==='all' ? `<div class="supplier-group">
      <div class="supplier-head"><span>${esc(label)}</span></div>
      ${rows}
    </div>` : rows;
  }).join('');

  const tabsHtml = `<div class="order-tabs">${tabs.map(tb=>`
    <button class="tab-pill ${state.orderTab===tb.id?'active':''}" data-ordertab="${esc(tb.id)}">${esc(tb.label)}</button>
  `).join('')}</div>`;

  const lastMap = lastOrderMap();
  return `
    ${renderOrderHero()}
    ${tabsHtml}
    <div class="search-row">
      <div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itemSearch" placeholder="${t('searchPlaceholder')}" value="${esc(state.search)}"></div>
      ${lastMap ? `<button class="quick-btn" id="sameAsLast">${t('sameAsLastTime')}</button>` : ''}
    </div>
    ${groupHtml || `<div class="empty">${t('noSearchResults')}</div>`}
  `;
}
function cartCount(){ return Object.values(state.cart).filter(q=>q>0).length; }
function renderOrderBottomBar(){
  const c = cartCount();
  return `<div class="bottom-bar">
    <button class="send-btn" id="sendOrdersBtn" ${c===0?'disabled':''}>
      ${c>0 ? t('itemsSelected')(c)+' · '+t('sendOrders') : t('sendOrders')}
    </button>
  </div>`;
}
function attachOrderEvents(){
  document.querySelectorAll('[data-ordertab]').forEach(b=>b.onclick=()=>{
    state.orderTab = b.dataset.ordertab; render();
  });
  const search = document.getElementById('itemSearch');
  if(search) search.oninput = (e)=>{
    const pos = e.target.selectionStart;
    state.search = e.target.value;
    render();
    const el = document.getElementById('itemSearch');
    if(el){ el.focus(); el.setSelectionRange(pos, pos); }
  };
  document.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.inc; state.cart[id]=(state.cart[id]||0)+1; render();
  });
  document.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.dec; state.cart[id]=Math.max(0,(state.cart[id]||0)-1); render();
  });
  document.querySelectorAll('[data-qty]').forEach(inp=>inp.onchange=()=>{
    const id=inp.dataset.qty; const v=Math.max(0, parseInt(inp.value)||0); state.cart[id]=v; render();
  });
  const same = document.getElementById('sameAsLast');
  if(same) same.onclick = ()=>{ const m = lastOrderMap(); if(m) state.cart = {...m}; render(); };
  const send = document.getElementById('sendOrdersBtn');
  if(send) send.onclick = ()=>{
    const bySupplier = {};
    Object.keys(state.cart).forEach(id=>{
      const qty = state.cart[id]; if(!qty) return;
      const item = state.items.find(i=>i.id===id); if(!item) return;
      const sid = item.supplierId || '__none';
      (bySupplier[sid] = bySupplier[sid]||[]).push({itemId:id, name:item.name, qty, unit:item.unit});
    });
    state.queue = Object.keys(bySupplier).map(sid=>({
      supplierId: sid, items: bySupplier[sid], sent:false
    }));
    state.view='queue'; render();
  };
}

/* ============ Send queue ============ */
function buildMessage(entry){
  const lines = entry.items.map(i=>`• ${i.name} — ${i.qty} ${unitLabel(i.unit)}`);
  const header = state.lang==='ku' ? 'داواکارییەکی نوێ لە چێشتخانەی ریکۆتا:' : 'New order from Ricotta:';
  return header + '\n' + lines.join('\n');
}
function waLink(phone, text){
  let p = (phone||'').replace(/[^0-9]/g,'');
  if(p.startsWith('0')) p = '964' + p.slice(1);
  else if(!p.startsWith('964')) p = '964' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function renderQueue(){
  if(!state.queue) return `<div class="empty">${t('noHistory')}</div>`;
  const cards = state.queue.map((e,idx)=>{
    const sup = state.suppliers.find(s=>s.id===e.supplierId);
    const name = sup ? sup.name : t('noSupplier');
    const itemsLine = e.items.map(i=>`${esc(i.name)} — ${i.qty} ${esc(unitLabel(i.unit))}`).join(' · ');
    const noSendReason = !sup ? t('noSupplier') : t('noPhoneOnFile');
    return `<div class="queue-card ${e.sent?'sent':''}">
      <div class="queue-top"><span class="queue-name">${esc(name)}</span>${e.sent?`<span class="queue-badge">✓ ${t('sent')}</span>`:''}</div>
      <div class="queue-items">${itemsLine}</div>
      ${sup && sup.phone ? `<button class="wa-btn ${e.sent?'done':''}" data-send="${idx}">${e.sent?t('sent'):t('sendVia')}</button>` : `<div class="queue-items">${esc(noSendReason)}</div>`}
    </div>`;
  }).join('');
  return `<div class="section-title">${t('sendQueueTitle')}</div>${cards}`;
}
function attachQueueEvents(){
  document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>{
    const idx = parseInt(b.dataset.send);
    const entry = state.queue[idx];
    const sup = state.suppliers.find(s=>s.id===entry.supplierId);
    if(!sup || !sup.phone) return; // button only renders when this is safe, but guard anyway
    window.open(waLink(sup.phone, buildMessage(entry)), '_blank');
    entry.sent = true;
    render();
    maybeFinishQueue();
  });
}
async function maybeFinishQueue(){
  if(!state.queue.every(e=>e.sent)) return;
  const record = {
    id: 'o'+Date.now(), date: new Date().toISOString(),
    entries: state.queue.map(e=>({
      supplierId: e.supplierId,
      items: e.items.map(i=>({itemId:i.itemId, name:i.name, qty:i.qty, unit:i.unit}))
    }))
  };
  state.history.push(record);
  await sset('orderHistory', state.history, true);
  state.cart = {};
  state.queue = null;
  state.view = 'order';
  render();
}

/* ============ History ============ */
function renderHistory(){
  if(!state.history.length) return `<div class="empty">${t('noHistory')}</div>`;
  const rows = [...state.history].reverse().map(rec=>{
    const dt = new Date(rec.date).toLocaleString(state.lang==='ku'?'en-GB':'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const supplierLines = rec.entries.map(e=>{
      const name = supplierName(e.supplierId);
      const itemsLine = e.items.map(i=>`${esc(i.name)} (${i.qty} ${esc(unitLabel(i.unit))})`).join(', ');
      return `<div class="hist-supplier">${esc(name)}</div><div class="hist-items">${itemsLine}</div>`;
    }).join('');
    return `<div class="hist-card">
      <div class="hist-top">
        <div class="hist-date">${dt}</div>
        <div class="row-actions">
          <button class="icon-btn" data-reorderhist="${rec.id}" title="${t('orderAgain')}">${ICON_REPEAT}</button>
          <button class="icon-btn danger" data-delhist="${rec.id}" title="${t('delete')}">${ICON_DELETE}</button>
        </div>
      </div>
      ${supplierLines}
    </div>`;
  }).join('');
  return rows;
}
function attachHistoryEvents(){
  document.querySelectorAll('[data-reorderhist]').forEach(b=>b.onclick=()=>{
    const rec = state.history.find(r=>r.id===b.dataset.reorderhist);
    if(!rec) return;
    const cart = {};
    rec.entries.forEach(e=>e.items.forEach(it=>{
      // Skip items that were since deleted from the catalog -- they no
      // longer have anywhere to show up on the order screen.
      if(state.items.some(i=>i.id===it.itemId)) cart[it.itemId] = it.qty;
    }));
    state.cart = cart;
    state.view = 'order';
    render();
  });
  document.querySelectorAll('[data-delhist]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteHistory')))) return;
    const id = b.dataset.delhist;
    state.history = state.history.filter(r=>r.id!==id);
    // Rewrites the single orderHistory row in Supabase with the shorter
    // array, so the deleted order stops taking up space in the database
    // too, not just on this device.
    await sset('orderHistory', state.history, true);
    render();
  });
}

/* ============ Admin: Suppliers ============ */
function renderSuppliers(){
  const list = state.suppliers.length ? state.suppliers.map(s=>`
    <div class="list-row">
      <div><div class="name">${esc(s.name)}</div><div class="meta">${esc(s.phone||'')}</div></div>
      <div class="row-actions">
        <button class="icon-btn" data-editsup="${s.id}">${ICON_EDIT}</button>
        <button class="icon-btn danger" data-delsup="${s.id}">${ICON_DELETE}</button>
      </div>
    </div>`).join('') : `<div class="empty">${t('noSuppliersYet')}</div>`;
  return `
    <div class="section-title">${t('suppliers')}</div>
    <button class="btn btn-primary add-btn" id="addSupplierBtn">${ICON_PLUS}${t('addSupplier')}</button>
    ${list}`;
}
/* sup is the actual supplier object when editing (looked up by id), or
   null when adding -- never the bare id string, so the fields below
   always prefill correctly from the real current name/phone. */
function supplierModalHtml(sup){
  return `
    <div class="modal-title">${sup?t('editSupplier'):t('addSupplier')}</div>
    <div class="field"><label>${t('name')}</label><input id="modalSupName" value="${esc(sup?sup.name:'')}"></div>
    <div class="field"><label>${t('phone')}</label><input id="modalSupPhone" placeholder="07xxxxxxxxx" value="${esc(sup?(sup.phone||''):'')}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancelBtn">${t('cancel')}</button>
      <button class="btn btn-primary" id="modalSaveBtn">${t('save')}</button>
    </div>`;
}
function openSupplierModal(supplierId){
  const sup = supplierId ? state.suppliers.find(s=>s.id===supplierId) : null;
  openModal(supplierModalHtml(sup));
  document.getElementById('modalCancelBtn').onclick = closeModal;
  document.getElementById('modalSupName').focus();
  document.getElementById('modalSaveBtn').onclick = async ()=>{
    const name = document.getElementById('modalSupName').value.trim();
    const phone = document.getElementById('modalSupPhone').value.trim();
    if(!name) return;
    if(sup){ sup.name = name; sup.phone = phone; }
    else { state.suppliers.push({id:'s'+Date.now(), name, phone}); }
    await sset('suppliers', state.suppliers, true);
    closeModal();
    render();
  };
}
function attachSupplierEvents(){
  const addBtn = document.getElementById('addSupplierBtn');
  if(addBtn) addBtn.onclick = ()=> openSupplierModal(null);
  document.querySelectorAll('[data-editsup]').forEach(b=>b.onclick=()=> openSupplierModal(b.dataset.editsup));
  document.querySelectorAll('[data-delsup]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteSupplier')))) return;
    const id = b.dataset.delsup;
    state.suppliers = state.suppliers.filter(s=>s.id!==id);
    state.items.forEach(i=>{ if(i.supplierId===id) i.supplierId=null; });
    if(state.itemFormSupplierId === id) state.itemFormSupplierId = null;
    await sset('suppliers', state.suppliers, true);
    await sset('items', state.items, true);
    render();
  });
}

/* ============ Admin: Items ============ */
function renderItemsAdmin(){
  const list = state.items.length ? state.items.map(i=>`
    <div class="list-row">
      <div><div class="name">${esc(i.name)}</div><div class="meta">${esc(unitLabel(i.unit))} · ${i.supplierId?esc(supplierName(i.supplierId)):t('noSupplier')}</div></div>
      <div class="row-actions">
        <button class="icon-btn" data-edititem="${i.id}">${ICON_EDIT}</button>
        <button class="icon-btn danger" data-delitem="${i.id}">${ICON_DELETE}</button>
      </div>
    </div>`).join('') : `<div class="empty">${t('noItemsYet')}</div>`;
  // Shown above the list as a reminder of which supplier the next "Add
  // item" will default to (see openItemModal).
  const lockedSupplier = state.itemFormSupplierId ? state.suppliers.find(s=>s.id===state.itemFormSupplierId) : null;
  return `
    <div class="section-title">${t('items')}</div>
    <button class="btn btn-primary add-btn" id="addItemBtn">${ICON_PLUS}${t('addItem')}</button>
    ${lockedSupplier ? `<div class="field-hint" style="margin:-8px 0 12px;">${t('supplierStaysSelected')(esc(lockedSupplier.name))}</div>` : ''}
    ${list}`;
}
/* item is the actual item object when editing (looked up by id), or null
   when adding -- never the bare id string, so unit/supplier always
   preselect from the item's real current values. When adding, the
   supplier defaults to whichever one was last used (state.itemFormSupplierId),
   so bulk-adding items for one supplier doesn't mean reselecting it
   every time. */
function itemModalHtml(item){
  const unitOptions = state.units.map(u=>`<option value="${esc(u.id)}" ${item&&item.unit===u.id?'selected':''}>${esc(state.lang==='ku'?(u.ku||u.en):u.en)}</option>`).join('');
  const currentSupplierId = item ? item.supplierId : state.itemFormSupplierId;
  const supOptions = `<option value="">${t('noSupplier')}</option>` + state.suppliers.map(s=>`<option value="${esc(s.id)}" ${currentSupplierId===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  return `
    <div class="modal-title">${item?t('editItem'):t('addItem')}</div>
    <div class="field"><label>${t('name')}</label><input id="modalItemName" value="${esc(item?item.name:'')}"></div>
    <div class="field"><label>${t('unit')}</label><select id="modalItemUnit">${unitOptions}</select></div>
    <div class="field"><label>${t('supplier')}</label><select id="modalItemSupplier">${supOptions}</select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancelBtn">${t('cancel')}</button>
      <button class="btn btn-primary" id="modalSaveBtn">${t('save')}</button>
    </div>`;
}
function openItemModal(itemId){
  const item = itemId ? state.items.find(i=>i.id===itemId) : null;
  openModal(itemModalHtml(item));
  document.getElementById('modalCancelBtn').onclick = closeModal;
  document.getElementById('modalItemName').focus();
  document.getElementById('modalSaveBtn').onclick = async ()=>{
    const name = document.getElementById('modalItemName').value.trim();
    const unit = document.getElementById('modalItemUnit').value;
    const supplierId = document.getElementById('modalItemSupplier').value || null;
    if(!name) return;
    if(item){ item.name = name; item.unit = unit; item.supplierId = supplierId; }
    else {
      state.items.push({id:'i'+Date.now(), name, unit, supplierId});
      state.itemFormSupplierId = supplierId; // keep it locked in for the next item
    }
    await sset('items', state.items, true);
    closeModal();
    render();
  };
}
function attachItemEvents(){
  const addBtn = document.getElementById('addItemBtn');
  if(addBtn) addBtn.onclick = ()=> openItemModal(null);
  document.querySelectorAll('[data-edititem]').forEach(b=>b.onclick=()=> openItemModal(b.dataset.edititem));
  document.querySelectorAll('[data-delitem]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteItem')))) return;
    const id = b.dataset.delitem;
    state.items = state.items.filter(i=>i.id!==id);
    delete state.cart[id];
    await sset('items', state.items, true);
    render();
  });
}

/* ============ Admin: Units ============ */
function renderUnits(){
  const chips = state.units.map(u=>`
    <span class="unit-chip">${esc(state.lang==='ku'?(u.ku||u.en):u.en)}
      <button data-delunit="${u.id}">✕</button>
    </span>`).join('');
  return `
    <div class="section-title">${t('units')}</div>
    <div>${chips || `<div class="empty">${t('noUnitsYet')}</div>`}</div>
    <div class="section-title">${t('addUnit')}</div>
    <div class="form-card">
      <div class="field"><label>English</label><input id="unitEn" placeholder="${t('unitNamePlaceholder')}"></div>
      <div class="field"><label>Kurdish</label><input id="unitKu" placeholder="${t('unitNameKuPlaceholder')}"></div>
      <div class="form-actions"><button class="btn btn-primary" id="unitAddBtn">${t('add')}</button></div>
    </div>`;
}
function attachUnitEvents(){
  document.getElementById('unitAddBtn').onclick = async ()=>{
    const en = document.getElementById('unitEn').value.trim();
    const ku = document.getElementById('unitKu').value.trim();
    if(!en) return;
    state.units.push({id:'u'+Date.now(), en, ku});
    await sset('units', state.units, true);
    render();
  };
  document.querySelectorAll('[data-delunit]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteUnit')))) return;
    const id = b.dataset.delunit;
    state.units = state.units.filter(u=>u.id!==id);
    await sset('units', state.units, true);
    render();
  });
}

/* ============ Admin: Settings ============ */
function renderSettings(){
  // PINs/cloud config live only in the database, gated by functions that
  // require proof the caller already knows the current value -- so an
  // admin who reloaded the page (and lost the in-memory PIN they typed
  // at login) has to re-enter it once before this screen will do anything.
  if(!state.adminPinEntered){
    return `
      <div class="section-title">${t('settings')}</div>
      <div class="form-card">
        <div class="field-hint" style="margin-bottom:10px;">${t('reenterAdminPinMsg')}</div>
        <div class="field"><label>${t('adminPin')}</label><input id="reenterAdminPin" type="password" maxlength="6" inputmode="numeric"></div>
        <div class="form-actions"><button class="btn btn-primary" id="reenterAdminPinBtn">${t('unlock')}</button></div>
      </div>`;
  }

  const pinsCard = `
    <div class="section-title">${t('changePins')}</div>
    <div class="form-card">
      <div class="field"><label>${t('adminPin')}</label><input id="adminPinInput" maxlength="6" inputmode="numeric" value="${esc(state.settings.adminPin||'')}"></div>
      <div class="field"><label>${t('userPin')}</label><input id="userPinInput" maxlength="4" inputmode="numeric" value="${esc(state.settings.userPin||'')}"></div>
      <div class="form-actions"><button class="btn btn-primary" id="pinsSaveBtn">${t('savePins')}</button></div>
    </div>`;

  let cloudCard;
  if(!state.cloudUnlocked){
    cloudCard = `
      <div class="form-card">
        <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px;line-height:1.5;">${t('cloudSetupSub')}</div>
        <div class="field"><label>${t('cloudPasswordLabel')}</label><input id="cloudUnlockInput" type="password"></div>
        <div class="form-actions"><button class="btn btn-primary" id="cloudUnlockBtn">${t('unlock')}</button></div>
      </div>`;
  } else {
    cloudCard = `
      <div class="form-card">
        <div class="field"><label>${t('supabaseUrlLabel')}</label><input id="supabaseUrlInput" placeholder="https://xxxx.supabase.co" value="${esc(state.settings.supabaseUrl||'')}"></div>
        <div class="field"><label>${t('supabaseKeyLabel')}</label><input id="supabaseKeyInput" placeholder="eyJhbGciOi..." value="${esc(state.settings.supabaseKey||'')}"></div>
        <div class="field"><label>${t('cloudPasswordEditLabel')}</label><input id="cloudPasswordInput" value="${esc(state.settings.cloudPassword||'')}"></div>
        <div style="font-size:12px;color:${cloudConfigured()?'var(--basil)':'var(--ink-soft)'};margin:-2px 0 10px;line-height:1.5;font-weight:${cloudConfigured()?'700':'400'};">${cloudConfigured()?t('cloudConnectedNote'):t('cloudNotConnectedNote')}</div>
        <div class="form-actions">
          <button class="btn btn-primary" id="cloudSaveBtn">${t('saveCloudSetup')}</button>
          <button class="btn btn-ghost" id="cloudLockBtn">${t('lock')}</button>
        </div>
      </div>`;
  }

  return `${pinsCard}<div class="section-title">${t('cloudSetup')}</div>${cloudCard}`;
}
function attachSettingsEvents(){
  const reenterBtn = document.getElementById('reenterAdminPinBtn');
  if(reenterBtn){
    reenterBtn.onclick = async ()=>{
      const pin = document.getElementById('reenterAdminPin').value.trim();
      const role = await appVerifyPin(pin);
      if(role !== 'admin'){ await showAlert(t('wrongPin')); return; }
      state.adminPinEntered = pin;
      const pins = await appGetPins(pin);
      if(pins) state.settings = {...state.settings, adminPin: pins.adminPin, userPin: pins.userPin};
      render();
    };
    return; // nothing else is on the page in this state
  }

  // Lazily fetch the current PINs once per unlocked session, so re-renders
  // (e.g. after switching language) don't refetch on every keystroke.
  if(state.settings.adminPin === undefined){
    appGetPins(state.adminPinEntered).then(pins=>{
      if(pins){ state.settings = {...state.settings, adminPin: pins.adminPin, userPin: pins.userPin}; render(); }
    });
  }

  document.getElementById('pinsSaveBtn').onclick = async ()=>{
    const ap = document.getElementById('adminPinInput').value.trim();
    const up = document.getElementById('userPinInput').value.trim();
    if(ap.length!==ADMIN_PIN_LEN || up.length!==USER_PIN_LEN){ await showAlert(t('pinsInvalidLength')); return; }
    if(ap.startsWith(up)){ await showAlert(t('pinsPrefixConflict')); return; }
    const ok = await appSetPins(state.adminPinEntered, ap, up);
    if(!ok){ await showAlert(t('pinsSaveFailed')); return; }
    state.adminPinEntered = ap;
    state.settings = {...state.settings, adminPin: ap, userPin: up};
    await showAlert(t('pinsSaved'));
    render();
  };
  const unlockBtn = document.getElementById('cloudUnlockBtn');
  if(unlockBtn) unlockBtn.onclick = async ()=>{
    const pw = document.getElementById('cloudUnlockInput').value;
    const cfg = await appGetCloudConfig(pw);
    if(cfg){
      state.cloudUnlocked = true;
      state.cloudPasswordEntered = pw;
      state.settings = {...state.settings, supabaseUrl: cfg.supabaseUrl, supabaseKey: cfg.supabaseKey, cloudPassword: cfg.cloudPassword};
      render();
    } else {
      await showAlert(t('wrongCloudPassword'));
    }
  };
  const lockBtn = document.getElementById('cloudLockBtn');
  if(lockBtn) lockBtn.onclick = ()=>{
    state.cloudUnlocked = false;
    state.cloudPasswordEntered = null;
    delete state.settings.cloudPassword;
    render();
  };
  const cloudSaveBtn = document.getElementById('cloudSaveBtn');
  if(cloudSaveBtn) cloudSaveBtn.onclick = async ()=>{
    const url = document.getElementById('supabaseUrlInput').value.trim();
    const key = document.getElementById('supabaseKeyInput').value.trim();
    const pw = document.getElementById('cloudPasswordInput').value.trim();
    if(!pw){ await showAlert(t('cloudPasswordRequired')); return; }
    const ok = await appSetCloudConfig(state.cloudPasswordEntered, url, key, pw);
    if(!ok){ await showAlert(t('cloudSaveFailed')); return; }
    state.settings = {...state.settings, supabaseUrl:url, supabaseKey:key, cloudPassword:pw};
    state.cloudPasswordEntered = pw;
    await showAlert(t('cloudSaved'));
    render();
  };
}

boot();
