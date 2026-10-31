/* Ricotta Orders -- interactive tables for Manage's Items and Suppliers.
   - Sort: tap a column's heading on a computer (tap again to reverse), or choose in Sort on a phone.
   - Filter: chips above the list (for example Unavailable, No supplier, Not ordered in 30 days).
   - Search: the search field above the list keeps narrowing the rows as you type.
   - Columns: on a computer, Columns picks which ones show (remembered on this device).
   - Details: tap a row to see everything about it, with Edit, Delete and the actions that fit
     (Add to order; WhatsApp, Call or Test reminder for a supplier).
   Phones show each row as a list row with the sorted value on the right; computers show a table.
   Depends on (runtime only): state, t, esc, lget, lset, canDo, canOpen, isPhoneLayout, unitLabel,
   supplierName, sortedByName, nameCollator, formatIraqDateTime, timeAgo, reminderText, reminderTimeLabel,
   openKitchenSheet, openItemModal, openSupplierModal, deleteItemWithUndo, deleteSupplier, supplierContactLinks,
   testSupplierReminder, refreshOrderView, persistCartDraft, toast, attachCatalogSearch, render. */

const TABLE_KEY = 'tables';
const tablePrefs = kind=>({sort:'name', dir:1, filter:'all', cols:null, ...(lget(TABLE_KEY)?.[kind] || {})});
function saveTablePrefs(kind, prefs){ lset(TABLE_KEY, {...(lget(TABLE_KEY) || {}), [kind]:prefs}); }
/* This month's orders per item and per supplier, from the orders on this phone. */
let tableStatsCache = {key:'', items:{}, suppliers:{}};
function tableStats(){
  const orders = thisMonthOrders(), last = orders[orders.length - 1], key = orders.length + '|' + (last?.id || '');
  if(tableStatsCache.key === key) return tableStatsCache;
  const items = {}, suppliers = {};
  for(const o of orders) for(const e of o.entries || []){
    if(e.supplierId){ const s = suppliers[e.supplierId] ||= {orders:new Set(), last:''}; s.orders.add(o.id); if(o.date > s.last) s.last = o.date; }
    for(const it of e.items || []){ const x = items[it.itemId] ||= {orders:new Set(), qty:0, last:''}; x.orders.add(o.id); x.qty += Number(it.qty) || 0; if(o.date > x.last) x.last = o.date; }
  }
  tableStatsCache = {key, items, suppliers};
  return tableStatsCache;
}
const QUIET_MS = 30 * 86400000;
const itemLast = i=>tableStats().items[i.id]?.last || i.lastOrderedAt || '';
const TABLES = {
  items:{
    rows:()=>state.items,
    columns:[
      {id:'name', label:()=>t('fileItem'), value:i=>i.name, sort:i=>i.name, text:true, fixed:true},
      {id:'supplier', label:()=>t('supplier'), value:i=>i.supplierId ? supplierName(i.supplierId) : t('noSupplier'), sort:i=>i.supplierId ? supplierName(i.supplierId) : '￿', text:true},
      {id:'unit', label:()=>t('unit'), value:i=>unitLabel(i.unit) || '·', sort:i=>unitLabel(i.unit), text:true},
      {id:'month', label:()=>t('fileOrdersMonth'), value:i=>String(tableStats().items[i.id]?.orders.size || 0), sort:i=>tableStats().items[i.id]?.orders.size || 0, end:true, short:n=>t('tableOrders')(n)},
      {id:'last', label:()=>t('fileLastOrdered'), value:i=>itemLast(i) ? timeAgo(itemLast(i)) : t('never'), sort:i=>itemLast(i) || '', short:v=>v},
      {id:'available', label:()=>t('fileAvailable'), value:i=>i.available === false ? t('fileNo') : t('fileYes'), sort:i=>i.available === false ? 1 : 0},
      {id:'note', label:()=>t('itemNoteLabel'), value:i=>i.note || '', sort:i=>i.note || '', text:true, hidden:true},
    ],
    filters:[
      {id:'all', label:()=>t('filterAll'), test:()=>true},
      {id:'unavailable', label:()=>t('fileUnavailable'), test:i=>i.available === false},
      {id:'noSupplier', label:()=>t('noSupplier'), test:i=>!i.supplierId || !state.suppliers.some(s=>s.id === i.supplierId)},
      {id:'quiet', label:()=>t('check_quiet'), test:i=>i.available !== false && (itemLast(i) ? Date.now() - Date.parse(itemLast(i)) > QUIET_MS : !!i.createdAt && Date.now() - Date.parse(i.createdAt) > QUIET_MS)},
      {id:'ordered', label:()=>t('fileOrderedMonth'), test:i=>!!tableStats().items[i.id]},
    ],
  },
  suppliers:{
    rows:()=>state.suppliers,
    columns:[
      {id:'name', label:()=>t('supplier'), value:s=>s.name, sort:s=>s.name, text:true, fixed:true},
      {id:'phone', label:()=>t('phone'), value:s=>s.phone || '·', sort:s=>s.phone || '', text:true},
      {id:'items', label:()=>t('items'), value:s=>String(state.items.filter(i=>i.supplierId === s.id).length), sort:s=>state.items.filter(i=>i.supplierId === s.id).length, end:true, short:n=>t('itemCount')(Number(n))},
      {id:'reminder', label:()=>t('fileReminder'), value:s=>s.reminder?.enabled ? reminderText(s.reminder) : t('reminderOff'), sort:s=>s.reminder?.enabled ? s.reminder.time : '￿', text:true},
      {id:'cutoff', label:()=>t('cutoffShort'), value:s=>s.cutoff ? reminderTimeLabel(s.cutoff) : '·', sort:s=>s.cutoff || '￿'},
      {id:'month', label:()=>t('fileOrdersMonth'), value:s=>String(tableStats().suppliers[s.id]?.orders.size || 0), sort:s=>tableStats().suppliers[s.id]?.orders.size || 0, end:true, short:n=>t('tableOrders')(n)},
      {id:'last', label:()=>t('fileLastOrder'), value:s=>tableStats().suppliers[s.id]?.last ? timeAgo(tableStats().suppliers[s.id].last) : t('never'), sort:s=>tableStats().suppliers[s.id]?.last || '', short:v=>v},
    ],
    filters:[
      {id:'all', label:()=>t('filterAll'), test:()=>true},
      {id:'reminder', label:()=>t('tableWithReminder'), test:s=>!!s.reminder?.enabled},
      {id:'noPhone', label:()=>t('tableNoPhone'), test:s=>!String(s.phone || '').trim()},
      {id:'ordered', label:()=>t('fileOrderedMonth'), test:s=>!!tableStats().suppliers[s.id]},
    ],
  },
};
function tableColumns(kind){
  const prefs = tablePrefs(kind), cols = TABLES[kind].columns;
  const shown = Array.isArray(prefs.cols) ? prefs.cols : cols.filter(c=>!c.hidden).map(c=>c.id);
  return cols.filter(c=>c.fixed || shown.includes(c.id));
}
function tableRows(kind){
  const cfg = TABLES[kind], prefs = tablePrefs(kind);
  const col = cfg.columns.find(c=>c.id === prefs.sort) || cfg.columns[0];
  const filter = cfg.filters.find(f=>f.id === prefs.filter) || cfg.filters[0];
  const rows = cfg.rows().filter(filter.test);
  const cmp = (a, b)=>{
    const x = col.sort(a), y = col.sort(b);
    const d = typeof x === 'number' && typeof y === 'number' ? x - y : nameCollator().compare(String(x), String(y));
    return d * prefs.dir || nameCollator().compare(a.name || '', b.name || '');
  };
  return {rows:[...rows].sort(cmp), col, filter, prefs};
}
function renderDataTable(kind){
  const cfg = TABLES[kind], {rows, col, prefs} = tableRows(kind);
  const counts = Object.fromEntries(cfg.filters.map(f=>[f.id, cfg.rows().filter(f.test).length]));
  const chips = `<div class="table-filters record-filters glass" role="group" aria-label="${esc(t('tableFilter'))}">${cfg.filters.filter(f=>f.id === 'all' || counts[f.id]).map(f=>`<button type="button" class="tab-pill${prefs.filter === f.id ? ' active' : ''}" aria-pressed="${prefs.filter === f.id}" data-table-filter="${f.id}">${esc(f.label())}${f.id === 'all' ? '' : `<span class="tab-count">${counts[f.id]}</span>`}</button>`).join('')}</div>`;
  const tools = `<div class="table-tools">${chips}<div class="table-buttons">
      <button type="button" class="btn btn-ghost table-sort-btn" data-table-sort-menu>${ICON_SORT}<span>${esc(t('tableSortBy')(col.label()))}</span></button>
      <button type="button" class="btn btn-ghost table-cols-btn" data-table-cols>${ICON_COLUMNS}<span>${esc(t('tableColumns'))}</span></button></div></div>`;
  if(!rows.length) return tools + emptyState(t(prefs.filter === 'all' ? (kind === 'items' ? 'noItemsYet' : 'noSuppliersYet') : 'tableNoneHere'));
  const cols = tableColumns(kind);
  const head = cols.map(c=>`<th scope="col" class="${c.end ? 'end' : ''}"${prefs.sort === c.id ? ` aria-sort="${prefs.dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-table-sort="${c.id}">${esc(c.label())}${prefs.sort === c.id ? `<i class="sort-arrow${prefs.dir < 0 ? ' down' : ''}" aria-hidden="true"></i>` : ''}</button></th>`).join('');
  const rowAttr = r=>`data-search-row data-table-row="${esc(r.id)}" ${kind === 'items' ? `data-edititem="${esc(r.id)}"` : `data-search-text="${esc([r.name, r.phone || ''].join(' '))}"`}`;
  const body = rows.map(r=>`<tr ${rowAttr(r)} tabindex="0">${cols.map(c=>`<td class="${c.end ? 'end' : ''}${c.fixed ? ' lead' : ''}" dir="auto">${c.fixed && r.available === false ? `<span class="availability-badge">${esc(t('unavailable'))}</span> ` : ''}${esc(c.value(r))}</td>`).join('')}</tr>`).join('');
  // Phones: one row each, with what the list is sorted by on the right (not the name, which is the row).
  const side = r=>['name', 'supplier', 'phone'].includes(col.id) ? '' : col.short ? col.short(col.value(r)) : col.value(r);
  const list = rows.map(r=>{
    const meta = kind === 'items' ? `${unitLabel(r.unit) || '·'} · ${r.supplierId ? supplierName(r.supplierId) : t('noSupplier')}` : (r.phone || t('noPhoneOnFile'));
    return `<button type="button" class="list-row tappable table-row" ${rowAttr(r)}><div><div class="name" dir="auto">${esc(r.name)}${r.available === false ? ` <span class="availability-badge">${esc(t('unavailable'))}</span>` : ''}</div><div class="meta" dir="auto">${esc(meta)}</div></div><span class="table-side">${esc(side(r))}</span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
  }).join('');
  return `${tools}<div class="data-table-scroll"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><div class="table-list">${list}</div>`;
}
function attachDataTable(kind, root){
  if(!root) return;
  const redraw = ()=>{ root.innerHTML = renderDataTable(kind); attachDataTable(kind, root); attachCatalogSearch(); };
  const set = change=>{ saveTablePrefs(kind, {...tablePrefs(kind), ...change}); redraw(); };
  root.querySelectorAll('[data-table-filter]').forEach(b=>b.onclick = ()=>set({filter:b.dataset.tableFilter}));
  root.querySelectorAll('[data-table-sort]').forEach(b=>b.onclick = ()=>{ const p = tablePrefs(kind); set(p.sort === b.dataset.tableSort ? {dir:-p.dir} : {sort:b.dataset.tableSort, dir:1}); });
  const sortMenu = root.querySelector('[data-table-sort-menu]');
  if(sortMenu) sortMenu.onclick = ()=>{
    const p = tablePrefs(kind);
    const {el, close} = openKitchenSheet('table-sheet', `<div class="sel-title">${esc(t('tableSort'))}</div><div class="sel-list">${TABLES[kind].columns.map(c=>`<button type="button" class="sel-opt${p.sort === c.id ? ' on' : ''}" data-pick-sort="${c.id}"><span>${esc(c.label())}</span>${p.sort === c.id ? `<i class="sort-arrow${p.dir < 0 ? ' down' : ''}" aria-hidden="true"></i>` : ''}</button>`).join('')}</div>`, t('tableSort'));
    el.querySelectorAll('[data-pick-sort]').forEach(b=>b.onclick = ()=>{ close(); set(p.sort === b.dataset.pickSort ? {dir:-p.dir} : {sort:b.dataset.pickSort, dir:1}); });
  };
  const colsBtn = root.querySelector('[data-table-cols]');
  if(colsBtn) colsBtn.onclick = ()=>{
    const shown = new Set(tableColumns(kind).map(c=>c.id));
    const {el, close} = openKitchenSheet('table-sheet', `<div class="sel-title">${esc(t('tableColumns'))}</div><div class="form-card">${TABLES[kind].columns.filter(c=>!c.fixed).map(c=>`<label class="check-row preference-row"><input type="checkbox" data-pick-col="${c.id}" ${shown.has(c.id) ? 'checked' : ''}><span>${esc(c.label())}</span></label>`).join('')}</div><button type="button" class="btn btn-primary table-done">${esc(t('padDone'))}</button>`, t('tableColumns'));
    el.querySelector('.table-done').onclick = ()=>{ set({cols:[...el.querySelectorAll('[data-pick-col]:checked')].map(b=>b.dataset.pickCol)}); close(); };
  };
  root.querySelectorAll('[data-table-row]').forEach(row=>{
    row.onclick = ()=>openRowDetails(kind, row.dataset.tableRow);
    if(row.tagName === 'TR') row.onkeydown = e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openRowDetails(kind, row.dataset.tableRow); } };
  });
}
/* Everything about one row, and what can be done with it. */
function openRowDetails(kind, id){
  const r = TABLES[kind].rows().find(x=>x.id === id);
  if(!r) return;
  const edit = canDo('catalog');
  const fields = TABLES[kind].columns.filter(c=>!c.fixed).map(c=>[c.label(), c.value(r)]);
  if(kind === 'items'){
    const st = tableStats().items[r.id];
    fields.splice(3, 0, [t('fileQtyMonth'), st ? `${Math.round(st.qty * 1000) / 1000} ${unitLabel(r.unit)}` : '0']);
    if((r.aliases || []).length) fields.push([t('searchAliases'), r.aliases.join(', ')]);
  }
  const actions = kind === 'items'
    ? `${canOpen('order') && r.available !== false ? `<button type="button" class="btn btn-primary" data-detail="order">${ICON_PLUS}<span>${esc(t('tableAddToOrder'))}</span></button>` : ''}${edit ? `<button type="button" class="btn btn-ghost" data-detail="edit">${ICON_EDIT}<span>${esc(t('editItem'))}</span></button><button type="button" class="btn btn-ghost danger-text" data-detail="delete">${ICON_DELETE}<span>${esc(t('delete'))}</span></button>` : ''}`
    : `${supplierContactLinks(r)}${edit ? `${r.reminder?.enabled ? `<button type="button" class="btn btn-ghost" data-detail="test">${ICON_BELL}<span>${esc(t('testSupplierReminder'))}</span></button>` : ''}<button type="button" class="btn btn-ghost" data-detail="edit">${ICON_EDIT}<span>${esc(t('editSupplier'))}</span></button><button type="button" class="btn btn-ghost danger-text" data-detail="delete">${ICON_DELETE}<span>${esc(t('delete'))}</span></button>` : ''}`;
  const {el, close} = openKitchenSheet('row-sheet', `<div class="row-detail-head">${supplierMono(r.name)}<div><div class="sel-title" dir="auto">${esc(r.name)}</div><div class="notif-sub">${esc(kind === 'items' ? t('typeItem') : t('typeSupplier'))}${r.note ? ` · ${esc(r.note)}` : ''}</div></div></div>
    <dl class="row-detail">${fields.map(([k, v])=>`<div><dt>${esc(k)}</dt><dd dir="auto">${esc(v || '·')}</dd></div>`).join('')}</dl>
    <div class="row-detail-actions">${actions}</div>`, r.name);
  el.querySelectorAll('[data-contact]').forEach(a=>a.addEventListener('click', ()=>close()));
  el.querySelectorAll('[data-detail]').forEach(b=>b.onclick = ()=>{
    const what = b.dataset.detail;
    close();
    if(what === 'order'){ state.cart[r.id] = Math.min(MAX_QTY, (state.cart[r.id] || 0) + 1); persistCartDraft(); toast(t('tableAdded')(r.name)); return; }
    if(what === 'edit'){ if(kind === 'items') openItemModal(r.id); else openSupplierModal(r.id); return; }
    if(what === 'test'){ testSupplierReminder(r.id); return; }
    if(what === 'delete'){ if(kind === 'items') deleteItemWithUndo(r.id); else deleteSupplier(r.id); }
  });
}
