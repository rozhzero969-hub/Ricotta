/* Ricotta Orders -- search everything, and keyboard shortcuts.
   Search (the magnifier beside each screen's title, or Ctrl/Cmd + K, or /): one field that finds, as you
   type and in any of the three languages (typos, Kurdish typed with Arabic letters and search names
   included):
     - screens and things to do (Send orders, Add item, Dark mode, Language, Report a problem...)
     - items, with a + to put one in the order; "tomato 5" offers to set Tomatoes to 5
     - suppliers (by name or phone number), opening their tab on Order
     - this month's orders, by item, supplier, person or day ("yesterday", "Monday", ئەمڕۆ)
   Arrow keys move through the results, Return opens one, Escape closes.
   Shortcuts (when not typing in a field): see SHORTCUTS below and the sheet that ? opens.
   Opening the app itself with a key is set up on the device, not in the app (the sheet explains how).
   Depends on (runtime only): state, t, esc, goView, canOpen, canDo, viewLabel, navScreens, itemSearchFields,
   supplierName, unitLabel, accountLabel, formatIraqDateTime, erbilDate, dayLabel, cartCount,
   refreshOrderView, startSendQueue, openItemModal, openSupplierModal, openUnitModal, openExportSheet,
   openLangMenu, openReportProblem, doLogout, applyPrefs, syncAppearance, lset, openKitchenSheet,
   openAdminPage, openReportSheet, ricoNewChat, scrollToTop, toast, render, isRozha. Load before app.js. */

let spotClose = null;
const spotNumber = /(?:^|\s)(\d+(?:[.,]\d+)?)(?=\s|$)/;
/* Things to do, in the person's language, each with English words too so English always finds them. */
function spotCommands(){
  const go = v=>()=>goView(v);
  const list = [
    ...['order','history','transfers','manage','suppliers','units','record','admin','settings','assistant'].filter(v=>canOpen(v))
      .map(v=>({id:'go-' + v, icon:NAV_ICONS[v === 'suppliers' ? 'suppliers' : v === 'units' ? 'units' : v] || ICON_SPARKLE, label:viewLabel(v), sub:t('spotScreen'), words:[v, v === 'assistant' ? 'rico chat ai' : '', v === 'itemsAdmin' ? 'items' : ''], run:go(v)})),
    {id:'send', icon:ICON_CHAT, label:t('sendOrders'), words:['send whatsapp suppliers'], when:()=>canDo('send') && cartCount() > 0, run:()=>startSendQueue()},
    {id:'add-item', icon:ICON_PLUS, label:t('addItem'), words:['new item add'], when:()=>canDo('catalog'), run:()=>{ goView('manage'); openItemModal(null); }},
    {id:'add-supplier', icon:ICON_PLUS, label:t('addSupplier'), words:['new supplier add'], when:()=>canDo('catalog'), run:()=>{ goView('suppliers'); openSupplierModal(null); }},
    {id:'add-unit', icon:ICON_PLUS, label:t('addUnit'), words:['new unit add'], when:()=>canDo('catalog'), run:()=>{ goView('units'); openUnitModal(null); }},
    {id:'export-items', icon:ICON_SHEET, label:t('exportItemsTitle'), words:['export excel pdf items download'], when:()=>canDo('exports'), run:()=>openExportSheet('items')},
    {id:'export-suppliers', icon:ICON_SHEET, label:t('exportSuppliersTitle'), words:['export excel pdf suppliers download'], when:()=>canDo('exports'), run:()=>openExportSheet('suppliers')},
    {id:'month', icon:ICON_CALENDAR, label:t('reportOpen'), words:['report card month'], when:()=>canOpen('history') && state.history.length, run:()=>{ goView('history'); openReportSheet(); }},
    {id:'same', icon:ICON_REPEAT, label:t('sameAsLastTime'), words:['same as last time repeat'], when:()=>state.history.length > 0, run:()=>{ goView('order'); requestAnimationFrame(()=>document.getElementById('sameAsLast')?.click()); }},
    {id:'clear', icon:ICON_DELETE, label:t('clearOrder'), words:['clear order empty'], when:()=>cartCount() > 0, run:()=>{ goView('order'); requestAnimationFrame(()=>document.getElementById('clearOrderBtn')?.click()); }},
    {id:'new-chat', icon:ICON_SPARKLE, label:t('ricoNewChat'), words:['rico new chat'], when:()=>canOpen('assistant'), run:()=>{ goView('assistant'); ricoNewChat(); }},
    ...[['on','darkOn','dark mode night'], ['off','darkOff','light mode day'], ['auto','darkAuto','automatic appearance system']].map(([v, k, w])=>({id:'dark-' + v, icon:NAV_ICONS.settings, label:`${t('darkLabel')}: ${t(k)}`, words:[w], run:()=>{ lset('darkMode', v === 'auto' ? null : v); applyPrefs(); syncAppearance(); render(); }})),
    {id:'language', icon:ICON_GLOBE, label:t('language'), words:['language kurdish arabic english زمان لغة'], run:()=>openLangMenu(document.getElementById('accountBtn') || document.body)},
    {id:'report', icon:ICON_REPORT, label:t('reportProblem'), words:['report problem bug help'], run:()=>openReportProblem()},
    {id:'shortcuts', icon:ICON_KEYBOARD, label:t('keyboardShortcuts'), words:['keyboard shortcuts keys'], run:()=>openShortcuts()},
    ...(isRozha() ? ADMIN_PAGES.map(p=>({id:'admin-' + p, icon:NAV_ICONS.admin, label:t('adminPage_' + p), sub:t('adminTitle'), words:['admin ' + p], run:()=>{ goView('admin'); openAdminPage(p); }})) : []),
    {id:'signout', icon:ICON_LOGOUT, label:t('logout'), words:['sign out log out exit'], run:()=>doLogout()},
  ];
  return list.filter(c=>!c.when || c.when());
}
/* Orders on the day the words name: today, yesterday or a weekday, in any of the three languages. */
function spotDay(q){
  const n = globalThis.RicottaSearch.normalize(q);
  if(!n) return null;
  const any = key=>LANGS.map(l=>T[l][key]).filter(x=>typeof x === 'string').map(x=>globalThis.RicottaSearch.normalize(x));
  const today = erbilDate(new Date().toISOString());
  if(any('today').includes(n)) return {day:today};
  if(any('yesterday').includes(n)) return {day:erbilDate(new Date(Date.now() - 86400000).toISOString())};
  const names = d=>[...LANGS.map(l=>T[l].weekdays?.[d]), formatIraqDateTime(new Date(Date.UTC(2026, 0, 4 + d, 9)), {weekday:'long'}), new Intl.DateTimeFormat('en-US', {weekday:'long', timeZone:'UTC'}).format(new Date(Date.UTC(2026, 0, 4 + d, 9)))];
  for(let d = 0; d < 7; d++) if(names(d).filter(Boolean).some(w=>globalThis.RicottaSearch.normalize(w) === n)) return {weekday:d};
  return null;
}
function spotResults(raw){
  const q = raw.trim(), rank = globalThis.RicottaSearch.rank;
  const commands = spotCommands();
  if(!q) return [{title:t('spotSuggestions'), rows:commands.filter(c=>['send','add-item','same','month','new-chat','go-history'].includes(c.id)).slice(0, 6).map(c=>({kind:'command', c}))}];
  const groups = [];
  // "tomato 5": the item and the amount.
  const num = q.match(spotNumber), words = num ? q.replace(spotNumber, ' ').trim() : q;
  const items = state.items.filter(i=>i.available !== false);
  const foundItems = words ? rank(items, words, itemSearchFields).slice(0, 8) : [];
  const rows = [];
  if(num && foundItems[0] && canOpen('order')){
    const qty = Number(num[1].replace(',', '.'));
    if(qty > 0 && qty <= 99999) rows.push({kind:'set', item:foundItems[0], qty});
  }
  const cmd = rank(commands, q, c=>[c.label, ...(c.words || [])]).slice(0, 5).map(c=>({kind:'command', c}));
  if(cmd.length) groups.push({title:t('spotActions'), rows:cmd});
  if(rows.length || foundItems.length) groups.push({title:t('items'), rows:[...rows, ...foundItems.map(item=>({kind:'item', item}))]});
  const sups = rank(state.suppliers, q, s=>[s.name, String(s.phone || '').replace(/\D/g, '')]).slice(0, 5);
  if(sups.length) groups.push({title:t('suppliers'), rows:sups.map(s=>({kind:'supplier', s}))});
  if(canOpen('history')){
    const day = spotDay(q);
    const sorted = [...state.history].sort((a, b)=>Date.parse(b.date) - Date.parse(a.date));
    const orders = day ? sorted.filter(o=>day.day ? erbilDate(o.date) === day.day : new Date(Date.parse(o.date) + 3 * 3600000).getUTCDay() === day.weekday)
      : rank(sorted, q, o=>[accountLabel(o.by), ...(o.entries || []).flatMap(e=>[e.supplierId ? supplierName(e.supplierId) : e.supplierName || '', ...(e.items || []).map(i=>i.name)])]);
    if(orders.length) groups.push({title:t('spotOrders'), rows:orders.slice(0, 5).map(o=>({kind:'order', o}))});
  }
  return groups;
}
function spotRowHtml(r, i){
  const at = `data-spot="${i}" role="option" id="spotOpt${i}"`;
  if(r.kind === 'command') return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${r.c.icon || ''}</span><span class="spot-text"><b dir="auto">${esc(r.c.label)}</b>${r.c.sub ? `<small>${esc(r.c.sub)}</small>` : ''}</span></button>`;
  if(r.kind === 'set') return `<button type="button" class="spot-row spot-set" ${at}><span class="spot-ic">${ICON_PLUS}</span><span class="spot-text"><b dir="auto">${esc(t('spotSet')(r.item.name, r.qty, unitLabel(r.item.unit)))}</b><small>${esc(r.item.supplierId ? supplierName(r.item.supplierId) : t('noSupplier'))}</small></span></button>`;
  if(r.kind === 'item'){
    const qty = state.cart[r.item.id] || 0;
    return `<div class="spot-row-wrap"><button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.order}</span><span class="spot-text"><b dir="auto">${esc(r.item.name)}</b><small>${esc([r.item.supplierId ? supplierName(r.item.supplierId) : t('noSupplier'), unitLabel(r.item.unit), qty ? t('spotInOrder')(qty) : ''].filter(Boolean).join(' · '))}</small></span></button>${canOpen('order') ? `<button type="button" class="spot-add" data-spot-add="${esc(r.item.id)}" aria-label="${esc(t('increaseQty')(r.item.name))}">${ICON_PLUS}</button>` : ''}</div>`;
  }
  if(r.kind === 'supplier') return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.suppliers}</span><span class="spot-text"><b dir="auto">${esc(r.s.name)}</b><small>${esc([r.s.phone || '', t('itemCount')(state.items.filter(i=>i.supplierId === r.s.id).length)].filter(Boolean).join(' · '))}</small></span></button>`;
  const lines = (r.o.entries || []).reduce((n, e)=>n + (e.items || []).length, 0);
  return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.history}</span><span class="spot-text"><b>${esc(dayLabel(r.o.date))} · ${esc(formatIraqDateTime(r.o.date, {hour:'numeric', minute:'2-digit'}))}</b><small dir="auto">${esc([accountLabel(r.o.by), t('itemCount')(lines), (r.o.entries || []).map(e=>e.supplierId ? supplierName(e.supplierId) : e.supplierName || '').filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small></span></button>`;
}
function spotRun(r){
  if(r.kind === 'command'){ r.c.run(); return; }
  if(r.kind === 'set'){ state.cart[r.item.id] = r.qty; goView('order'); if(state.view === 'order') refreshOrderView(r.item.id); toast(t('spotSetDone')(r.item.name, r.qty)); return; }
  if(r.kind === 'item'){ spotShowItem(r.item); return; }
  if(r.kind === 'supplier'){ if(!canOpen('order')) return; state.orderTab = r.s.id; state.search = ''; if(state.view === 'order') render(); else goView('order'); return; }
  goView('history');
  requestAnimationFrame(()=>spotFlash(document.querySelector(`[data-order-id="${CSS.escape(r.o.id)}"]`)));
}
/* An item found by search: its supplier's tab on Order, scrolled to it and briefly lit. */
function spotShowItem(item){
  if(!canOpen('order')) return;
  state.orderTab = item.supplierId || '__none'; state.search = '';
  if(state.view === 'order') render(); else goView('order');
  requestAnimationFrame(()=>spotFlash(document.querySelector(`#orderResults .item-row[data-item-id="${CSS.escape(item.id)}"]`)));
}
function spotFlash(el){
  if(!el) return;
  el.scrollIntoView({block:'center', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  el.classList.remove('spot-flash'); void el.offsetWidth; el.classList.add('spot-flash');
  setTimeout(()=>el.classList.remove('spot-flash'), 1600);
}
function openSpotlight(initial = ''){
  if(!state.account) return;
  spotClose?.();
  document.activeElement?.blur?.();
  const layer = document.createElement('div');
  layer.className = 'spot-layer';
  layer.innerHTML = `<div class="spot-scrim"></div><div class="spot-panel" role="dialog" aria-modal="true" aria-label="${esc(t('spotTitle'))}">
    <div class="spot-field">${ICON_SEARCH}<input type="search" id="spotInput" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="spotList" aria-autocomplete="list" placeholder="${esc(t('spotPlaceholder'))}" value="${esc(initial)}"><button type="button" class="spot-clear" aria-label="${esc(t('clearSearch'))}"${initial ? '' : ' hidden'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8l8 8M16 8l-8 8"/></svg></button><button type="button" class="spot-cancel">${esc(t('cancel'))}</button></div>
    <div class="spot-list" id="spotList" role="listbox" aria-label="${esc(t('spotTitle'))}"></div></div>`;
  document.body.appendChild(layer);
  const input = layer.querySelector('input'), list = layer.querySelector('.spot-list');
  let flat = [], active = 0;
  const mark = ()=>{
    list.querySelectorAll('[data-spot]').forEach(b=>b.classList.toggle('active', Number(b.dataset.spot) === active));
    input.setAttribute('aria-activedescendant', flat.length ? 'spotOpt' + active : '');
    list.querySelector('.spot-row.active')?.scrollIntoView({block:'nearest'});
  };
  const paint = ()=>{
    const groups = spotResults(input.value);
    flat = [];
    list.innerHTML = groups.length ? groups.map(g=>`<div class="spot-group"><div class="spot-group-title">${esc(g.title)}</div>${g.rows.map(r=>{ flat.push(r); return spotRowHtml(r, flat.length - 1); }).join('')}</div>`).join('')
      : `<div class="spot-empty">${esc(t('spotNone'))}</div>`;
    active = 0; mark();
  };
  let closed = false;
  const close = ()=>{
    if(closed) return; closed = true;
    if(spotClose === close) spotClose = null;
    document.removeEventListener('keydown', onKey, true);
    layer.classList.add('out'); layer.inert = true;
    setTimeout(()=>layer.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  };
  spotClose = close;
  const run = i=>{ const r = flat[i]; if(!r) return; close(); spotRun(r); };
  const onKey = e=>{
    if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); if(flat.length){ active = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length; mark(); } }
    else if(e.key === 'Enter' && document.activeElement === input && !e.isComposing){ e.preventDefault(); run(active); }
  };
  document.addEventListener('keydown', onKey, true);
  const clear = layer.querySelector('.spot-clear');
  input.addEventListener('input', ()=>{ clear.hidden = !input.value; paint(); });
  clear.onclick = ()=>{ input.value = ''; clear.hidden = true; paint(); input.focus({preventScroll:true}); };
  layer.querySelector('.spot-scrim').onclick = close;
  layer.querySelector('.spot-cancel').onclick = close;
  list.addEventListener('click', e=>{
    const add = e.target.closest('[data-spot-add]');
    if(add){
      const id = add.dataset.spotAdd;
      state.cart[id] = Math.min(MAX_QTY, (state.cart[id] || 0) + 1);
      persistCartDraft(); if(state.view === 'order') refreshOrderView(id);
      haptic('selection'); paint(); return;
    }
    const b = e.target.closest('[data-spot]');
    if(b) run(Number(b.dataset.spot));
  });
  paint();
  requestAnimationFrame(()=>input.focus({preventScroll:true}));
}

/* ---------- Keyboard shortcuts ---------- */
const SHORTCUTS = [
  ['K', 'shortSearch', true], ['/', 'shortSearch'], ['1 – 6', 'shortTabs'], ['R', 'shortRico'], [',', 'shortSettings'],
  ['N', 'shortNew'], ['S', 'shortSend'], ['[  ]', 'shortSupplierTabs'], ['T', 'shortTop'], ['?', 'shortHelp'], ['Esc', 'shortClose'],
];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
function openShortcuts(){
  const key = (k, mod)=>`${mod ? `<kbd>${isMac ? '⌘' : 'Ctrl'}</kbd>` : ''}${k.split(/\s+–\s+|\s{2,}/).map(x=>`<kbd>${esc(x)}</kbd>`).join(k.includes('–') ? '<span>–</span>' : '')}`;
  openKitchenSheet('shortcuts-sheet', `<div class="sel-title">${esc(t('keyboardShortcuts'))}</div>
    <p class="notif-sub">${esc(t('shortIntro'))}</p>
    <div class="short-list">${SHORTCUTS.map(([k, label, mod])=>`<div class="short-row"><span>${esc(t(label))}</span><span class="short-keys" dir="ltr">${key(k, mod)}</span></div>`).join('')}</div>
    <div class="short-device"><b>${esc(t('shortOpenTitle'))}</b><p>${esc(t('shortOpenMac'))}</p><p>${esc(t('shortOpenIphone'))}</p></div>`, t('keyboardShortcuts'));
}
document.addEventListener('keydown', e=>{
  if(!state.account || e.defaultPrevented || e.isComposing) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  // Ctrl/Cmd + K opens search from anywhere, even while typing.
  if((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k'){ e.preventDefault(); if(!spotClose) openSpotlight(); return; }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(document.querySelector('#modalRoot .modal-overlay, .sel-sheet, .spot-layer, .ctx-layer, #langLayer, .pad-sheet')) return;
  const k = e.key;
  const act = fn=>{ e.preventDefault(); fn(); };
  if(k === '/') return act(()=>openSpotlight());
  if(k === '?') return act(openShortcuts);
  if(/^[1-6]$/.test(k)){ const v = navScreens()[Number(k) - 1]; if(v) act(()=>goView(v)); return; }
  if(k === 'r' && canOpen('assistant')) return act(()=>goView('assistant'));
  if(k === ',') return act(()=>goView('settings'));
  if(k === 't') return act(scrollToTop);
  if(k === 's' && state.view === 'order' && canDo('send') && cartCount()) return act(()=>startSendQueue());
  if(k === 'n'){
    const fn = {manage:()=>canDo('catalog') && openItemModal(null), itemsAdmin:()=>canDo('catalog') && openItemModal(null), suppliers:()=>canDo('catalog') && openSupplierModal(null),
      units:()=>canDo('catalog') && openUnitModal(null), assistant:()=>ricoNewChat()}[state.view];
    if(fn) act(fn);
    return;
  }
  if((k === '[' || k === ']') && state.view === 'order'){
    const tabs = [...document.querySelectorAll('[data-ordertab]')], i = tabs.findIndex(b=>b.classList.contains('active'));
    const next = tabs[i + (k === ']' ? 1 : -1) * (isRtl() ? -1 : 1)];
    if(next) act(()=>next.click());
  }
});
