/* Ricotta Orders -- app state, rendering and event handlers.
   Depends on: DEFAULT_UNITS, DEFAULT_SETTINGS, PIN consts (config.js),
   T (i18n.js), icon strings (icons.js), sget and sset (storage.js),
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
  settings: DEFAULT_SETTINGS,
  history: [],
  cart: {},             // itemId -> qty
  search: '',
  orderTab: 'all',       // 'all' | supplierId | '__none'
  cloudUnlocked: false,  // whether the Cloud Setup section is currently revealed
  queue: null,          // array of {supplierId, sent} while sending
  editingSupplier: null,
  editingItem: null
};

function t(key){ return T[state.lang][key]; }

/* ============ Boot ============ */
async function boot(){
  const [suppliers, items, units, settings, history, lang] = await Promise.all([
    sget('suppliers', true), sget('items', true), sget('units', true),
    sget('settings', true), sget('orderHistory', true), sget('lang', false)
  ]);
  state.suppliers = suppliers || [];
  state.items = items || [];
  state.units = units || DEFAULT_UNITS;
  if(!units) await sset('units', DEFAULT_UNITS, true);
  state.settings = {...DEFAULT_SETTINGS, ...(settings||{})};
  if(!settings) await sset('settings', DEFAULT_SETTINGS, true);
  state.history = history || [];
  state.lang = lang || 'en';
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
  if(lo) lo.onclick = ()=>{ state.role=null; state.pinBuffer=''; state.view='order'; state.cloudUnlocked=false; render(); };
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{ state.view=b.dataset.view; state.editingSupplier=null; state.editingItem=null; render(); });
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
  document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>{
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
      if(state.pinBuffer===state.settings.userPin){
        state.role='user'; state.pinBuffer=''; render(); return;
      }
      state.pinExpanded = true;
      state.justExpanded = true;
      render();
      return;
    }
    if(state.pinBuffer.length===ADMIN_PIN_LEN){
      if(state.pinBuffer===state.settings.adminPin){ state.role='admin'; state.pinBuffer=''; state.pinExpanded=false; render(); return; }
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
          <div class="item-name">${i.name}</div>
          <div class="item-unit">${unitLabel(i.unit)}</div>
        </div>
        <div class="stepper">
          <button class="step-btn" data-dec="${i.id}">−</button>
          <input class="qty-input" type="number" inputmode="numeric" min="0" value="${qty}" data-qty="${i.id}">
          <button class="step-btn" data-inc="${i.id}">+</button>
        </div>
      </div>`;
    }).join('');
    return state.orderTab==='all' ? `<div class="supplier-group">
      <div class="supplier-head"><span>${label}</span></div>
      ${rows}
    </div>` : rows;
  }).join('');

  const tabsHtml = `<div class="order-tabs">${tabs.map(tb=>`
    <button class="tab-pill ${state.orderTab===tb.id?'active':''}" data-ordertab="${tb.id}">${tb.label}</button>
  `).join('')}</div>`;

  const lastMap = lastOrderMap();
  return `
    ${renderOrderHero()}
    ${tabsHtml}
    <div class="search-row">
      <div class="search-wrap">${ICON_SEARCH}<input class="search-input" id="itemSearch" placeholder="${t('searchPlaceholder')}" value="${state.search}"></div>
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
    const itemsLine = e.items.map(i=>`${i.name} — ${i.qty} ${unitLabel(i.unit)}`).join(' · ');
    return `<div class="queue-card ${e.sent?'sent':''}">
      <div class="queue-top"><span class="queue-name">${name}</span>${e.sent?`<span class="queue-badge">✓ ${t('sent')}</span>`:''}</div>
      <div class="queue-items">${itemsLine}</div>
      ${sup && sup.phone ? `<button class="wa-btn ${e.sent?'done':''}" data-send="${idx}">${e.sent?t('sent'):t('sendVia')}</button>` : `<div class="queue-items">${t('noSupplier')}</div>`}
    </div>`;
  }).join('');
  return `<div class="section-title">${t('sendQueueTitle')}</div>${cards}`;
}
function attachQueueEvents(){
  document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>{
    const idx = parseInt(b.dataset.send);
    const entry = state.queue[idx];
    const sup = state.suppliers.find(s=>s.id===entry.supplierId);
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
    return rec.entries.map(e=>{
      const name = supplierName(e.supplierId);
      const itemsLine = e.items.map(i=>`${i.name} (${i.qty} ${unitLabel(i.unit)})`).join(', ');
      return `<div class="hist-card">
        <div class="hist-date">${dt}</div>
        <div class="hist-supplier">${name}</div>
        <div class="hist-items">${itemsLine}</div>
      </div>`;
    }).join('');
  }).join('');
  return rows;
}

/* ============ Admin: Suppliers ============ */
function renderSuppliers(){
  const form = `
    <div class="form-card">
      <div class="field"><label>${t('name')}</label><input id="supName" value="${state.editingSupplier?.name||''}"></div>
      <div class="field"><label>${t('phone')}</label><input id="supPhone" placeholder="07xxxxxxxxx" value="${state.editingSupplier?.phone||''}"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="supSaveBtn">${t('save')}</button>
        ${state.editingSupplier ? `<button class="btn btn-ghost" id="supCancelBtn">${t('cancel')}</button>` : ''}
      </div>
    </div>`;
  const list = state.suppliers.length ? state.suppliers.map(s=>`
    <div class="list-row">
      <div><div class="name">${s.name}</div><div class="meta">${s.phone||''}</div></div>
      <div class="row-actions">
        <button class="icon-btn" data-editsup="${s.id}">${ICON_EDIT}</button>
        <button class="icon-btn danger" data-delsup="${s.id}">${ICON_DELETE}</button>
      </div>
    </div>`).join('') : `<div class="empty">${t('noSuppliersYet')}</div>`;
  return `<div class="section-title">${state.editingSupplier?t('editSupplier'):t('addSupplier')}</div>${form}
          <div class="section-title">${t('suppliers')}</div>${list}`;
}
function attachSupplierEvents(){
  document.getElementById('supSaveBtn').onclick = async ()=>{
    const name = document.getElementById('supName').value.trim();
    const phone = document.getElementById('supPhone').value.trim();
    if(!name) return;
    if(state.editingSupplier){
      const s = state.suppliers.find(x=>x.id===state.editingSupplier);
      s.name = name; s.phone = phone;
    } else {
      state.suppliers.push({id:'s'+Date.now(), name, phone});
    }
    await sset('suppliers', state.suppliers, true);
    state.editingSupplier = null; render();
  };
  const cancel = document.getElementById('supCancelBtn');
  if(cancel) cancel.onclick = ()=>{ state.editingSupplier=null; render(); };
  document.querySelectorAll('[data-editsup]').forEach(b=>b.onclick=()=>{ state.editingSupplier=b.dataset.editsup; render(); });
  document.querySelectorAll('[data-delsup]').forEach(b=>b.onclick=async()=>{
    if(!(await showConfirm(t('confirmDeleteSupplier')))) return;
    const id = b.dataset.delsup;
    state.suppliers = state.suppliers.filter(s=>s.id!==id);
    state.items.forEach(i=>{ if(i.supplierId===id) i.supplierId=null; });
    await sset('suppliers', state.suppliers, true);
    await sset('items', state.items, true);
    render();
  });
}

/* ============ Admin: Items ============ */
function renderItemsAdmin(){
  const unitOptions = state.units.map(u=>`<option value="${u.id}" ${state.editingItem?.unit===u.id?'selected':''}>${state.lang==='ku'?(u.ku||u.en):u.en}</option>`).join('');
  const supOptions = `<option value="">${t('noSupplier')}</option>` + state.suppliers.map(s=>`<option value="${s.id}" ${state.editingItem?.supplierId===s.id?'selected':''}>${s.name}</option>`).join('');
  const form = `
    <div class="form-card">
      <div class="field"><label>${t('name')}</label><input id="itemName" value="${state.editingItem?.name||''}"></div>
      <div class="field"><label>${t('unit')}</label><select id="itemUnit">${unitOptions}</select></div>
      <div class="field"><label>${t('supplier')}</label><select id="itemSupplier">${supOptions}</select></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="itemSaveBtn">${t('save')}</button>
        ${state.editingItem ? `<button class="btn btn-ghost" id="itemCancelBtn">${t('cancel')}</button>` : ''}
      </div>
    </div>`;
  const list = state.items.length ? state.items.map(i=>`
    <div class="list-row">
      <div><div class="name">${i.name}</div><div class="meta">${unitLabel(i.unit)} · ${i.supplierId?supplierName(i.supplierId):t('noSupplier')}</div></div>
      <div class="row-actions">
        <button class="icon-btn" data-edititem="${i.id}">${ICON_EDIT}</button>
        <button class="icon-btn danger" data-delitem="${i.id}">${ICON_DELETE}</button>
      </div>
    </div>`).join('') : `<div class="empty">${t('noItemsYet')}</div>`;
  return `<div class="section-title">${state.editingItem?t('editItem'):t('addItem')}</div>${form}
          <div class="section-title">${t('items')}</div>${list}`;
}
function attachItemEvents(){
  document.getElementById('itemSaveBtn').onclick = async ()=>{
    const name = document.getElementById('itemName').value.trim();
    const unit = document.getElementById('itemUnit').value;
    const supplierId = document.getElementById('itemSupplier').value || null;
    if(!name) return;
    if(state.editingItem){
      const i = state.items.find(x=>x.id===state.editingItem);
      i.name=name; i.unit=unit; i.supplierId=supplierId;
    } else {
      state.items.push({id:'i'+Date.now(), name, unit, supplierId});
    }
    await sset('items', state.items, true);
    state.editingItem = null; render();
  };
  const cancel = document.getElementById('itemCancelBtn');
  if(cancel) cancel.onclick = ()=>{ state.editingItem=null; render(); };
  document.querySelectorAll('[data-edititem]').forEach(b=>b.onclick=()=>{ state.editingItem=b.dataset.edititem; render(); });
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
    <span class="unit-chip">${state.lang==='ku'?(u.ku||u.en):u.en}
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
  const pinsCard = `
    <div class="section-title">${t('changePins')}</div>
    <div class="form-card">
      <div class="field"><label>${t('adminPin')}</label><input id="adminPinInput" maxlength="6" inputmode="numeric" value="${state.settings.adminPin}"></div>
      <div class="field"><label>${t('userPin')}</label><input id="userPinInput" maxlength="4" inputmode="numeric" value="${state.settings.userPin}"></div>
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
        <div class="field"><label>${t('supabaseUrlLabel')}</label><input id="supabaseUrlInput" placeholder="https://xxxx.supabase.co" value="${state.settings.supabaseUrl||''}"></div>
        <div class="field"><label>${t('supabaseKeyLabel')}</label><input id="supabaseKeyInput" placeholder="eyJhbGciOi..." value="${state.settings.supabaseKey||''}"></div>
        <div class="field"><label>${t('cloudPasswordEditLabel')}</label><input id="cloudPasswordInput" value="${state.settings.cloudPassword}"></div>
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
  document.getElementById('pinsSaveBtn').onclick = async ()=>{
    const ap = document.getElementById('adminPinInput').value.trim();
    const up = document.getElementById('userPinInput').value.trim();
    if(ap.length!==ADMIN_PIN_LEN || up.length!==USER_PIN_LEN){ await showAlert(t('pinsInvalidLength')); return; }
    if(ap.startsWith(up)){ await showAlert(t('pinsPrefixConflict')); return; }
    state.settings = {...state.settings, adminPin:ap, userPin:up};
    await sset('settings', state.settings, true);
    await showAlert(t('pinsSaved'));
    render();
  };
  const unlockBtn = document.getElementById('cloudUnlockBtn');
  if(unlockBtn) unlockBtn.onclick = async ()=>{
    const pw = document.getElementById('cloudUnlockInput').value;
    if(pw === state.settings.cloudPassword){ state.cloudUnlocked = true; render(); }
    else { await showAlert(t('wrongCloudPassword')); }
  };
  const lockBtn = document.getElementById('cloudLockBtn');
  if(lockBtn) lockBtn.onclick = ()=>{ state.cloudUnlocked = false; render(); };
  const cloudSaveBtn = document.getElementById('cloudSaveBtn');
  if(cloudSaveBtn) cloudSaveBtn.onclick = async ()=>{
    const url = document.getElementById('supabaseUrlInput').value.trim();
    const key = document.getElementById('supabaseKeyInput').value.trim();
    const pw = document.getElementById('cloudPasswordInput').value.trim();
    if(!pw){ await showAlert(t('pinsInvalidLength')); return; }
    state.settings = {...state.settings, supabaseUrl:url, supabaseKey:key, cloudPassword:pw};
    await sset('settings', state.settings, true);
    await showAlert(t('cloudSaved'));
    render();
  };
}

boot();
