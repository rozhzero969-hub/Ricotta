/* Ricotta Orders -- search everything, and keyboard shortcuts.
   Search (the magnifier beside each screen's title, or Ctrl/Cmd + K, or /): one field that finds, as you
   type and in any of the three languages (typos, Kurdish typed with Arabic letters and search names
   included):
     - items, with − and + right there; "tomato 5" (or "5 kg tomato") offers to set Tomatoes to 5
     - suppliers (by name or phone number), opening their tab on Order, with Call and WhatsApp
     - this month's orders, by item, supplier, person or day ("yesterday", "Monday", ئەمڕۆ, "24/10",
       "Oct 24"), each saying which line matched
     - units, Rico's chats, screens and things to do (Send orders, Add item, Dark mode, Language...), and
       switches (order sounds, compact rows) that flip in place
   With nothing typed it shows what was opened lately, the order being put together and suggestions.
   The best matches come first, whatever kind they are; actions only match from the start of a word, so
   "tom" finds Tomatoes, not "Automatic". All, Items, Suppliers, Orders and Actions narrow it down.
   Arrow keys move through the results, Return opens one, Escape closes.
   Shortcuts (when not typing in a field): see SHORTCUTS below and the sheet that ? opens.
   Opening the app itself with a key is set up on the device, not in the app (the sheet explains how).
   Depends on (runtime only): state, t, esc, goView, canOpen, canDo, viewLabel, navScreens, itemSearchFields,
   supplierName, unitLabel, unitName, accountLabel, formatIraqDateTime, erbilDate, dayLabel, timeAgo, cartCount,
   refreshOrderView, startSendQueue, openItemModal, openSupplierModal, openUnitModal, openExportSheet,
   openLangMenu, openReportProblem, doLogout, applyPrefs, syncAppearance, lget, lset, prefOn, soundOn, setSoundOn,
   playQtyTick, haptic, ricoReact, openKitchenSheet, openAdminPage, openReportSheet, ricoNewChat, ricoOpenChat,
   ricoLoadChats, rico, chatOwnerMark, waLink, waOpensApp, privacyHref, scrollToTop, toast, render, isRozha,
   KU_MONTHS. Load before app.js. */

let spotClose = null;
const spotNumber = /(?:^|\s)([\d٠-٩۰-۹]+(?:[.,٫][\d٠-٩۰-۹]+)?)(?=\s|$)/;   // Kurdish and Arabic digits too
const SPOT_SCOPES = ['all','items','suppliers','orders','actions'];
const SPOT_RECENT_MAX = 6;
const spotNorm = v=>globalThis.RicottaSearch.normalize(v);
let spotScope = 'all';

/* Things to do, in the person's language, each with English words too so English always finds them. */
function spotCommands(){
  const go = v=>()=>goView(v);
  const list = [
    ...['order','history','transfers','manage','suppliers','units','record','admin','settings','assistant'].filter(v=>canOpen(v))
      .map(v=>({id:'go-' + v, icon:NAV_ICONS[v === 'suppliers' ? 'suppliers' : v === 'units' ? 'units' : v] || ICON_SPARKLE, label:viewLabel(v), sub:t('spotScreen'), words:[v, v === 'assistant' ? 'rico chat ai' : ''], run:go(v)})),
    {id:'send', icon:ICON_CHAT, label:t('sendOrders'), sub:()=>t('itemCount')(cartCount()), words:['send whatsapp suppliers'], when:()=>canDo('send') && cartCount() > 0, run:()=>startSendQueue()},
    {id:'add-item', icon:ICON_PLUS, label:t('addItem'), words:['new item add'], when:()=>canDo('catalog'), run:()=>{ goView('manage'); openItemModal(null); }},
    {id:'add-supplier', icon:ICON_PLUS, label:t('addSupplier'), words:['new supplier add'], when:()=>canDo('catalog'), run:()=>{ goView('suppliers'); openSupplierModal(null); }},
    {id:'add-unit', icon:ICON_PLUS, label:t('addUnit'), words:['new unit add'], when:()=>canDo('catalog'), run:()=>{ goView('units'); openUnitModal(null); }},
    {id:'export-items', icon:ICON_SHEET, label:t('exportItemsTitle'), words:['export excel pdf items download'], when:()=>canDo('exports'), run:()=>openExportSheet('items')},
    {id:'export-suppliers', icon:ICON_SHEET, label:t('exportSuppliersTitle'), words:['export excel pdf suppliers download'], when:()=>canDo('exports'), run:()=>openExportSheet('suppliers')},
    {id:'month', icon:ICON_CALENDAR, label:t('reportOpen'), words:['report card month'], when:()=>canOpen('history') && thisMonthOrders().length, run:()=>{ goView('history'); openReportSheet(); }},
    {id:'same', icon:ICON_REPEAT, label:t('sameAsLastTime'), words:['same as last time repeat'], when:()=>canOpen('history') && state.history.length > 0 && canOpen('order'), run:()=>{ goView('order'); requestAnimationFrame(()=>document.getElementById('sameAsLast')?.click()); }},
    {id:'clear', icon:ICON_DELETE, label:t('clearOrder'), words:['clear order empty'], when:()=>cartCount() > 0, run:()=>{ goView('order'); requestAnimationFrame(()=>document.getElementById('clearOrderBtn')?.click()); }},
    {id:'new-chat', icon:ICON_SPARKLE, label:t('ricoNewChat'), words:['rico new chat'], when:()=>canOpen('assistant'), run:()=>{ goView('assistant'); ricoNewChat(); }},
    ...[['on','darkOn','dark mode night'], ['off','darkOff','light mode day'], ['auto','darkAuto','automatic appearance system']].map(([v, k, w])=>({id:'dark-' + v, icon:NAV_ICONS.settings, label:`${t('darkLabel')}: ${t(k)}`, words:[w], run:()=>{ lset('darkMode', v === 'auto' ? null : v); applyPrefs(); syncAppearance(); render(); }})),
    {id:'language', icon:ICON_GLOBE, label:t('language'), words:['language kurdish arabic english زمان لغة'], run:()=>openLangMenu(document.getElementById('accountBtn') || document.body)},
    {id:'report', icon:ICON_REPORT, label:t('reportProblem'), words:['report problem bug help'], run:()=>openReportProblem()},
    {id:'shortcuts', icon:ICON_KEYBOARD, label:t('keyboardShortcuts'), words:['keyboard shortcuts keys'], run:()=>openShortcuts()},
    {id:'privacy', icon:ICON_SHIELD, label:t('privacyPolicy'), words:['privacy policy data'], run:()=>{ location.href = privacyHref(); }},
    ...(isRozha() ? ADMIN_PAGES.map(p=>({id:'admin-' + p, icon:NAV_ICONS.admin, label:t('adminPage_' + p), sub:t('adminTitle'), words:['admin ' + p], run:()=>{ goView('admin'); openAdminPage(p); }})) : []),
    {id:'signout', icon:ICON_LOGOUT, label:t('logout'), words:['sign out log out exit'], run:()=>doLogout()},
  ];
  return list.filter(c=>!c.when || c.when());
}
/* Switches that flip right in the results (the search stays open), showing whether each is on. */
function spotToggles(){
  return [
    {id:'sound-qty', label:t('quantitySound'), words:['sound quantity tap tick order sounds'], on:()=>soundOn('qty'), set:v=>setSoundOn('qty', v)},
    {id:'sound-sent', label:t('sentSound'), words:['sound sent chime order sounds'], on:()=>soundOn('sent'), set:v=>setSoundOn('sent', v)},
    {id:'compact', label:t('compactRowsLabel'), words:['compact rows dense small'], on:()=>prefOn('compactRows'), set:v=>{ lset('compactRows', v ? true : null); applyPrefs(); }},
    {id:'last-qty', label:t('lastQtyLabel'), words:['show last quantity previous'], on:()=>prefOn('showLastQty'), set:v=>{ lset('showLastQty', v ? true : null); applyPrefs(); if(state.view === 'order') render(); }},
  ];
}
/* An action matches only where a word starts ("tom" never finds "Automatic"), or as a typo of a whole
   word. Lower is better, like RicottaSearch.score. */
function spotCommandScore(c, q){
  const n = spotNorm(q);
  if(!n) return Infinity;
  const fields = [c.label, ...(c.words || [])], words = spotNorm(fields.join(' ')).split(' ');
  if(n.split(' ').every(token=>words.some(w=>w.startsWith(token)))){
    const label = spotNorm(c.label);
    return label === n ? 0 : label.startsWith(n) ? 2 : 6;
  }
  const typo = globalThis.RicottaSearch.score(q, fields);
  return Number.isFinite(typo) && typo >= 12 ? typo + 4 : Infinity;
}
function spotRank(rows, q, scoreOf){
  return rows.map((row, index)=>({row, index, score:scoreOf(row)})).filter(x=>Number.isFinite(x.score)).sort((a, b)=>a.score - b.score || a.index - b.index);
}
/* Orders on the day the words name: today, yesterday, a weekday, "24/10", "24 Oct" or "Oct 24", in any of
   the three languages. */
function spotDay(q){
  const n = spotNorm(q);
  if(!n) return null;
  const any = key=>LANGS.map(l=>T[l][key]).filter(x=>typeof x === 'string').map(spotNorm);
  const today = erbilDate(new Date().toISOString());
  if(any('today').includes(n)) return {day:today};
  if(any('yesterday').includes(n)) return {day:erbilDate(new Date(Date.now() - 86400000).toISOString())};
  const names = d=>[...LANGS.map(l=>T[l].weekdays?.[d]), formatIraqDateTime(new Date(Date.UTC(2026, 0, 4 + d, 9)), {weekday:'long'}), new Intl.DateTimeFormat('en-US', {weekday:'long', timeZone:'UTC'}).format(new Date(Date.UTC(2026, 0, 4 + d, 9)))];
  for(let d = 0; d < 7; d++) if(names(d).filter(Boolean).some(w=>spotNorm(w) === n)) return {weekday:d};
  // A date of this month or an earlier one: day first, as written in Iraq.
  const year = Number(today.slice(0, 4)), pick = (dd, mm)=>{
    if(!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return null;
    const y = `${year}-${String(mm).padStart(2, '0')}` > today.slice(0, 7) ? year - 1 : year;
    return {day:`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`};
  };
  const digits = q.trim().replace(/[٠-٩]/g, x=>x.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, x=>x.charCodeAt(0) - 0x6F0);
  const dm = digits.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})$/);
  if(dm) return pick(Number(dm[1]), Number(dm[2]));
  const month = word=>{
    const w = spotNorm(word);
    if(!w || w.length < 3) return 0;
    for(let m = 0; m < 12; m++){
      const at = new Date(Date.UTC(2026, m, 15));
      const all = [new Intl.DateTimeFormat('en-GB', {month:'long', timeZone:'UTC'}).format(at), new Intl.DateTimeFormat('ar-IQ', {month:'long', timeZone:'UTC'}).format(at),
        new Intl.DateTimeFormat('ar-EG', {month:'long', timeZone:'UTC'}).format(at), KU_MONTHS[m]].map(spotNorm);
      if(all.some(x=>x === w || (x.startsWith(w) && /^[a-z]+$/.test(w)))) return m + 1;
    }
    return 0;
  };
  const parts = digits.trim().split(/\s+/).map(x=>x.replace(/^(\d{1,2})ی$/, '$1'));   // "24ی تشرینی یەکەم"
  if(parts.length >= 2){
    const num = parts.findIndex(x=>/^\d{1,2}$/.test(x)), rest = parts.filter((_, i)=>i !== num).join(' ').replace(/ی$/, '');
    if(num >= 0 && month(rest)) return pick(Number(parts[num]), month(rest));
  }
  return null;
}
/* What was opened from search lately, on this phone and for this account only. */
const spotRecentKey = ()=>'spotRecent:' + state.account;
function spotKey(r){
  const id = r.kind === 'command' || r.kind === 'toggle' ? r.c.id : r.kind === 'item' ? r.item.id : r.kind === 'supplier' ? r.s.id
    : r.kind === 'order' ? r.o.id : r.kind === 'unit' ? r.u.id : r.kind === 'chat' ? r.chat.id : null;
  return id ? {kind:r.kind, id:String(id)} : null;
}
function spotRecentRows(){
  const saved = lget(spotRecentKey());
  if(!Array.isArray(saved)) return [];
  const commands = spotCommands(), toggles = spotToggles();
  return saved.slice(0, SPOT_RECENT_MAX).map(x=>{
    if(!x || typeof x.id !== 'string') return null;
    if(x.kind === 'item'){ const item = state.items.find(i=>i.id === x.id && i.available !== false); return item && canOpen('order') ? {kind:'item', item} : null; }
    if(x.kind === 'supplier'){ const s = state.suppliers.find(v=>v.id === x.id); return s ? {kind:'supplier', s} : null; }
    if(x.kind === 'order'){ const o = state.history.find(v=>v.id === x.id); return o && canOpen('history') ? {kind:'order', o} : null; }
    if(x.kind === 'unit'){ const u = state.units.find(v=>v.id === x.id); return u && canOpen('units') ? {kind:'unit', u} : null; }
    if(x.kind === 'chat'){ const chat = (rico.chats || []).find(v=>v.id === x.id); return chat && canOpen('assistant') ? {kind:'chat', chat} : null; }
    if(x.kind === 'command'){ const c = commands.find(v=>v.id === x.id); return c ? {kind:'command', c} : null; }
    if(x.kind === 'toggle'){ const c = toggles.find(v=>v.id === x.id); return c ? {kind:'toggle', c} : null; }
    return null;
  }).filter(Boolean);
}
function spotRemember(r){
  const key = spotKey(r);
  if(!key || !state.account) return;
  const saved = Array.isArray(lget(spotRecentKey())) ? lget(spotRecentKey()) : [];
  lset(spotRecentKey(), [key, ...saved.filter(x=>!(x && x.kind === key.kind && x.id === key.id))].slice(0, SPOT_RECENT_MAX));
}
/* The groups of results for what was typed, best match first. Each group has a key, a title, its rows and
   its best score; "more" says how many were left out. */
function spotResults(raw, scope = 'all'){
  const q = raw.trim(), score = globalThis.RicottaSearch.score;
  const commands = spotCommands();
  if(!q){
    const groups = [], recent = spotRecentRows();
    if(recent.length) groups.push({key:'recent', title:t('spotRecent'), rows:recent, clear:true});
    const inOrder = canOpen('order') ? state.items.filter(i=>(state.cart[i.id] || 0) > 0 && i.available !== false) : [];
    if(inOrder.length) groups.push({key:'cart', title:t('spotInThisOrder')(inOrder.length), rows:inOrder.slice(0, 6).map(item=>({kind:'item', item}))});
    const picks = commands.filter(c=>['send','add-item','same','month','new-chat'].includes(c.id) && !recent.some(r=>r.kind === 'command' && r.c.id === c.id));
    if(picks.length) groups.push({key:'suggest', title:t('spotSuggestions'), rows:picks.slice(0, 5).map(c=>({kind:'command', c}))});
    return groups;
  }
  const wide = scope !== 'all', want = k=>scope === 'all' || scope === k;
  const groups = [];
  // "tomato 5" or "5 kg tomato": the item and the amount (unit words are left out of the search).
  const num = q.match(spotNumber), unitWords = state.units.map(unitName);
  const words = num ? q.replace(spotNumber, ' ').trim().split(/\s+/).filter(w=>!globalThis.RicottaSearch.isUnit(w, unitWords)).join(' ') : q;
  if(want('items') && canOpen('order')){
    const found = words ? spotRank(state.items.filter(i=>i.available !== false), words, i=>score(words, itemSearchFields(i))) : [];
    const rows = [];
    if(num && found[0]){
      // The same rule as saving an order: up to 99999, at most 3 decimals. Anything else says so.
      const qty = Number(foldText(num[1]).replace(/[٫,]/g, '.'));
      if(qty > 0 && validOrderQuantity(qty)) rows.push({kind:'set', item:found[0].row, qty});
      else if(qty > 0) rows.push({kind:'badqty'});
    }
    const limit = wide ? 40 : 6;
    rows.push(...found.slice(0, limit).map(x=>({kind:'item', item:x.row})));
    if(rows.length) groups.push({key:'items', title:t('items'), rows, best:num && found[0] ? -1 : found[0]?.score ?? 99, more:found.length - limit});
  }
  if(want('suppliers')){
    const found = spotRank(state.suppliers, q, s=>score(q, [s.name, String(s.phone || '').replace(/\D/g, '')]));
    const limit = wide ? 30 : 4;
    if(found.length) groups.push({key:'suppliers', title:t('suppliers'), rows:found.slice(0, limit).map(x=>({kind:'supplier', s:x.row})), best:found[0].score, more:found.length - limit});
  }
  if(want('actions')){
    const found = spotRank(commands, q, c=>spotCommandScore(c, q)).map(x=>({...x, row:{kind:'command', c:x.row}}))
      .concat(spotRank(spotToggles(), q, c=>spotCommandScore(c, q)).map(x=>({...x, row:{kind:'toggle', c:x.row}})))
      .sort((a, b)=>a.score - b.score);
    const limit = wide ? 40 : 4;
    if(found.length) groups.push({key:'actions', title:t('spotActions'), rows:found.slice(0, limit).map(x=>x.row), best:found[0].score + 1, more:found.length - limit});
  }
  if(want('items') && canOpen('units')){
    const found = spotRank(state.units, q, u=>score(q, [unitName(u)]));
    if(found.length) groups.push({key:'units', title:t('units'), rows:found.slice(0, wide ? 10 : 2).map(x=>({kind:'unit', u:x.row})), best:found[0].score + 2});
  }
  if(want('actions') && canOpen('assistant') && Array.isArray(rico.chats)){
    const found = spotRank(rico.chats, q, c=>score(q, [c.title || '']));
    if(found.length) groups.push({key:'chats', title:t('spotChats'), rows:found.slice(0, wide ? 20 : 3).map(x=>({kind:'chat', chat:x.row})), best:found[0].score + 3});
  }
  if(want('orders') && canOpen('history')){
    const day = spotDay(q);
    const sorted = [...state.history].sort((a, b)=>Date.parse(b.date) - Date.parse(a.date));
    const lineFields = (o, e)=>[e.supplierId ? supplierName(e.supplierId) : e.supplierName || ''];
    const found = day ? sorted.filter(o=>day.day ? erbilDate(o.date) === day.day : new Date(Date.parse(o.date) + 3 * 3600000).getUTCDay() === day.weekday).map(o=>({row:o, score:1}))
      : spotRank(sorted, q, o=>score(q, [accountLabel(o.by), ...(o.entries || []).flatMap(e=>[...lineFields(o, e), ...(e.items || []).map(i=>i.name)])]));
    const limit = wide ? 30 : 4;
    if(found.length) groups.push({key:'orders', title:t('spotOrders'), rows:found.slice(0, limit).map(x=>({kind:'order', o:x.row, q:day ? '' : q})), best:found[0].score + 4, more:found.length - limit});
  }
  groups.sort((a, b)=>a.best - b.best);
  // Rico can answer what search cannot (a question, a total, a check).
  if(scope === 'all' && canOpen('assistant') && q.length >= 3) groups.push({key:'ask', title:'', rows:[{kind:'ask', q}]});
  return groups;
}
/* What was typed, marked where it shows in the text as written (spellings found only after folding, or
   typos, are found but not marked). */
function spotMark(text, q){
  const s = String(text ?? ''), words = [...new Set(String(q || '').trim().split(/\s+/).filter(w=>w && !/^\d+([.,]\d+)?$/.test(w)))].sort((a, b)=>b.length - a.length);
  if(!words.length) return esc(s);
  const re = new RegExp(words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let out = '', last = 0;
  for(const m of s.matchAll(re)){ out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
  return out + esc(s.slice(last));
}
const spotWhen = iso=>iso ? formatIraqDateTime(iso, {day:'numeric', month:'short'}) : '';
function spotRowHtml(r, i, q){
  const at = `data-spot="${i}" role="${r.kind === 'toggle' ? 'switch' : 'option'}" id="spotOpt${i}"`;
  const text = (title, sub, dirTitle = 'auto')=>`<span class="spot-text"><b dir="${dirTitle}">${title}</b>${sub ? `<small dir="auto">${sub}</small>` : ''}</span>`;
  if(r.kind === 'command'){
    const sub = typeof r.c.sub === 'function' ? r.c.sub() : r.c.sub;
    return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${r.c.icon || ''}</span>${text(spotMark(r.c.label, q), sub ? esc(sub) : '')}</button>`;
  }
  if(r.kind === 'toggle'){
    const on = r.c.on();
    return `<button type="button" class="spot-row spot-toggle" ${at} aria-checked="${on}"><span class="spot-ic">${NAV_ICONS.settings}</span>${text(spotMark(r.c.label, q), esc(viewLabel('settings')))}<span class="spot-switch${on ? ' on' : ''}" aria-hidden="true"><i></i></span></button>`;
  }
  if(r.kind === 'badqty') return `<div class="spot-row spot-note" ${at} aria-disabled="true"><span class="spot-ic">${ICON_PLUS}</span>${text(esc(t('spotQtyInvalid')), '')}</div>`;
  if(r.kind === 'set') return `<button type="button" class="spot-row spot-set" ${at}><span class="spot-ic">${ICON_PLUS}</span>${text(esc(t('spotSet')(r.item.name, r.qty, unitLabel(r.item.unit))), esc(r.item.supplierId ? supplierName(r.item.supplierId) : t('noSupplier')))}</button>`;
  if(r.kind === 'item'){
    const sub = [spotMark(r.item.supplierId ? supplierName(r.item.supplierId) : t('noSupplier'), q), esc(unitLabel(r.item.unit)), r.item.lastOrderedAt ? esc(t('spotLastOrdered')(spotWhen(r.item.lastOrderedAt))) : ''].filter(Boolean).join(' · ');
    return `<div class="spot-row-wrap" data-spot-item="${esc(r.item.id)}"><button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.order}</span>${text(spotMark(r.item.name, q), sub)}</button>${canOpen('order') ? spotStepHtml(r.item) : ''}</div>`;
  }
  if(r.kind === 'supplier'){
    const count = state.items.filter(i=>i.supplierId === r.s.id).length, inOrder = state.items.filter(i=>i.supplierId === r.s.id && (state.cart[i.id] || 0) > 0).length;
    const sub = [t('itemCount')(count), inOrder ? t('spotInOrder')(inOrder) : '', r.s.phone || ''].filter(Boolean).join(' · ');
    const chat = r.s.phone ? waLink(r.s.phone, '') : '', number = chat.match(/(?:phone=|wa\.me\/)(\d+)/)?.[1];
    const contact = number && number.length >= 7 ? `<a class="spot-mini" href="${esc(chat)}"${waOpensApp() ? '' : ' target="_blank" rel="noopener noreferrer"'} aria-label="${esc(t('contactSupplier') + ' · ' + r.s.name)}" data-spot-out>${ICON_CHAT}</a><a class="spot-mini" href="tel:+${number}" aria-label="${esc(t('callSupplier') + ' · ' + r.s.name)}" data-spot-out>${ICON_PHONE}</a>` : '';
    return `<div class="spot-row-wrap"><button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.suppliers}</span>${text(spotMark(r.s.name, q), esc(sub))}</button>${contact}</div>`;
  }
  if(r.kind === 'unit'){
    const count = state.items.filter(i=>i.unit === r.u.id).length;
    return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.units || ICON_SHEET}</span>${text(spotMark(unitName(r.u), q), esc(t('itemCount')(count)))}</button>`;
  }
  if(r.kind === 'chat') return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${ICON_SPARKLE}</span>${text(spotMark(r.chat.title || t('ricoUntitled'), q), esc([accountLabel(r.chat.account || state.account), r.chat.updatedAt ? timeAgo(r.chat.updatedAt) : ''].filter(Boolean).join(' · ')))}</button>`;
  if(r.kind === 'ask') return `<button type="button" class="spot-row spot-ask" ${at}><span class="spot-ic">${ICON_SPARKLE}</span>${text(esc(t('spotAskRico')(r.q)), esc(t('spotAskRicoSub')))}</button>`;
  if(r.kind === 'more') return `<button type="button" class="spot-row spot-more" ${at}>${text(esc(t('spotShowAll')(r.n)), '')}</button>`;
  // An order: when, who and how much, or the line that matched what was typed.
  const lines = (r.o.entries || []).flatMap(e=>(e.items || []).map(i=>({...i, supplier:e.supplierId ? supplierName(e.supplierId) : e.supplierName || ''})));
  const hit = r.q ? lines.find(l=>Number.isFinite(globalThis.RicottaSearch.score(r.q, [l.name, l.supplier]))) : null;
  const sub = hit ? `${spotMark(hit.name, r.q)} ${esc(String(hit.qty))}${hit.unit ? ' ' + esc(unitLabel(hit.unit)) : ''} · ${esc(hit.supplier)}`
    : esc([accountLabel(r.o.by), t('itemCount')(lines.length), [...new Set(lines.map(l=>l.supplier).filter(Boolean))].join(', ')].filter(Boolean).join(' · '));
  return `<button type="button" class="spot-row" ${at}><span class="spot-ic">${NAV_ICONS.history}</span><span class="spot-text"><b>${esc(dayLabel(r.o.date))} · ${esc(formatIraqDateTime(r.o.date, {hour:'numeric', minute:'2-digit'}))}${hit ? ` · ${esc(accountLabel(r.o.by))}` : ''}</b><small dir="auto">${sub}</small></span></button>`;
}
/* − and + for an item, right in the results; − shows once it is in the order, with the amount between. */
function spotStepHtml(item){
  const qty = state.cart[item.id] || 0;
  return `<div class="spot-step${qty ? ' has-qty' : ''}" role="group" aria-label="${esc(item.name)}">${qty ? `<button type="button" class="spot-mini" data-spot-dec="${esc(item.id)}" aria-label="${esc(t('decreaseQty')(item.name))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button><b class="spot-qty" aria-live="polite">${esc(String(qty))}</b>` : ''}<button type="button" class="spot-mini spot-plus" data-spot-add="${esc(item.id)}" aria-label="${esc(t('increaseQty')(item.name))}">${ICON_PLUS}</button></div>`;
}
/* Like a tap on − or + on the Order screen: the tick, the haptic, Rico's nod for the first item. */
function spotStep(id, delta){
  const before = state.cart[id] || 0, next = Math.max(0, Math.min(MAX_QTY, before + delta));
  if(next === before) return;
  playQtyTick(delta > 0);
  haptic('selection');
  const first = next > 0 && !cartCount();
  state.cart[id] = next;
  refreshOrderView(id);
  if(first) ricoReact();
}
function spotRun(r){
  if(r.kind === 'command'){ r.c.run(); return; }
  if(r.kind === 'set'){ state.cart[r.item.id] = r.qty; goView('order'); if(state.view === 'order') refreshOrderView(r.item.id); else persistCartDraft(); toast(t('spotSetDone')(r.item.name, r.qty)); return; }
  if(r.kind === 'item'){ spotShowItem(r.item); return; }
  if(r.kind === 'supplier'){ if(!canOpen('order')) return; state.orderTab = r.s.id; state.search = ''; if(state.view === 'order') render(); else goView('order'); return; }
  if(r.kind === 'unit'){ goView('units'); requestAnimationFrame(()=>spotFlash(document.querySelector(`.unit-chip[data-unit-id="${CSS.escape(r.u.id)}"]`))); return; }
  if(r.kind === 'chat'){ goView('assistant'); ricoOpenChat(r.chat.id); return; }
  if(r.kind === 'ask'){
    goView('assistant');
    requestAnimationFrame(()=>{ const box = document.getElementById('ricoInput'); if(!box) return; box.value = r.q; box.dispatchEvent(new Event('input', {bubbles:true})); box.focus({preventScroll:true}); });
    return;
  }
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
  el.scrollIntoView({block:'center', behavior:reducedMotion() ? 'auto' : 'smooth'});
  el.classList.remove('spot-flash'); void el.offsetWidth; el.classList.add('spot-flash');
  setTimeout(()=>el.classList.remove('spot-flash'), 1600);
}
function openSpotlight(initial = ''){
  if(!state.account) return;
  spotClose?.();
  // Search belongs to the account that opened it: signing out or switching account closes it (spotClose(true)),
  // and anything still captured from before does nothing.
  const owner = state.account, opener = document.activeElement;
  document.activeElement?.blur?.();
  spotScope = 'all';
  const layer = document.createElement('div');
  layer.className = 'spot-layer';
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  layer.innerHTML = `<div class="spot-scrim"></div><div class="spot-panel" role="dialog" aria-modal="true" aria-label="${esc(t('spotTitle'))}">
    <div class="spot-field">${ICON_SEARCH}<input type="search" id="spotInput" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="spotList" aria-autocomplete="list" placeholder="${esc(t('spotPlaceholder'))}" value="${esc(initial)}"><button type="button" class="spot-clear" aria-label="${esc(t('clearSearch'))}"${initial ? '' : ' hidden'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8l8 8M16 8l-8 8"/></svg></button><button type="button" class="spot-cancel">${esc(t('cancel'))}</button></div>
    <div class="spot-scopes" role="tablist" aria-label="${esc(t('spotTitle'))}"${initial ? '' : ' hidden'}>${SPOT_SCOPES.map(k=>`<button type="button" role="tab" class="spot-scope" data-spot-scope="${k}" aria-selected="${k === 'all'}">${esc(t('spotScope_' + k))}</button>`).join('')}</div>
    <div class="spot-list" id="spotList" role="listbox" aria-label="${esc(t('spotTitle'))}"></div>
    ${fine ? `<div class="spot-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>${esc(t('spotFootMove'))}</span><span><kbd>↵</kbd>${esc(t('spotFootOpen'))}</span><span><kbd>esc</kbd>${esc(t('spotFootClose'))}</span></div>` : ''}</div>`;
  document.body.appendChild(layer);
  const input = layer.querySelector('input'), list = layer.querySelector('.spot-list'), scopes = layer.querySelector('.spot-scopes');
  // Focused at once, inside the tap that opened it: an iPhone only brings up its keyboard then.
  input.focus({preventScroll:true});
  let flat = [], active = 0;
  const mark = (scroll = false)=>{
    list.querySelectorAll('[data-spot]').forEach(b=>b.classList.toggle('active', Number(b.dataset.spot) === active));
    input.setAttribute('aria-activedescendant', flat.length ? 'spotOpt' + active : '');
    if(scroll) list.querySelector('.spot-row.active')?.scrollIntoView({block:'nearest'});
  };
  /* keep: redraw in place (after − or +, or a switch), staying on the same row and scroll position. */
  const paint = (keep = false)=>{
    const was = keep && flat[active] ? JSON.stringify(spotKey(flat[active]) || flat[active].kind) : null, top = list.scrollTop;
    const q = input.value.trim(), groups = spotResults(input.value, spotScope);
    scopes.hidden = !q;
    scopes.querySelectorAll('[data-spot-scope]').forEach(b=>b.setAttribute('aria-selected', String(b.dataset.spotScope === spotScope)));
    flat = [];
    const rowsOf = g=>g.rows.concat(g.more > 0 && spotScope === 'all' && ['items','suppliers','orders','actions'].includes(g.key) ? [{kind:'more', n:g.more + g.rows.filter(r=>r.kind !== 'set').length, scope:g.key}] : []);
    // Nothing found still says so plainly, above "Ask Rico".
    const found = groups.some(g=>g.key !== 'ask');
    list.innerHTML = (found ? '' : `<div class="spot-empty">${esc(q ? t('spotNone') : t('spotStart'))}</div>`)
      + groups.map(g=>`<div class="spot-group" role="group"${g.title ? ` aria-label="${esc(g.title)}"` : ''}>${g.title ? `<div class="spot-group-title"><span>${esc(g.title)}</span>${g.clear ? `<button type="button" class="spot-group-clear" data-spot-forget>${esc(t('clear'))}</button>` : ''}</div>` : ''}${rowsOf(g).map(r=>{ flat.push(r); return spotRowHtml(r, flat.length - 1, q); }).join('')}</div>`).join('');
    active = 0;
    if(was){ const i = flat.findIndex(r=>JSON.stringify(spotKey(r) || r.kind) === was); if(i >= 0) active = i; }
    if(keep) list.scrollTop = top; else list.scrollTop = 0;
    mark();
  };
  // A modal: the page behind it is inert while it is open, and focus goes back to what opened it.
  const behind = [...document.body.children].filter(el=>el !== layer && !el.inert);
  behind.forEach(el=>{ el.inert = true; });
  let closed = false;
  const close = (now = false)=>{
    if(closed) return; closed = true;
    if(spotClose === close) spotClose = null;
    document.removeEventListener('keydown', onKey, true);
    behind.forEach(el=>{ el.inert = false; });
    layer.classList.add('out'); layer.inert = true;
    const gone = ()=>layer.remove();
    if(now || reducedMotion()) gone();
    else{ layer.querySelector('.spot-panel').addEventListener('animationend', gone, {once:true}); setTimeout(gone, 400); }
    // Back to what opened search, except a text box: on a phone that would bring the keyboard back up.
    if(!now && state.account === owner && opener?.isConnected && !opener.matches?.('input,textarea,[contenteditable]')) opener.focus?.({preventScroll:true});
  };
  spotClose = close;
  const mine = ()=>{ if(state.account === owner) return true; close(true); return false; };
  const run = i=>{
    const r = flat[i];
    if(!r || r.kind === 'badqty' || !mine()) return;
    if(r.kind === 'more'){ spotScope = r.scope; paint(); input.focus({preventScroll:true}); return; }
    if(r.kind === 'toggle'){ r.c.set(!r.c.on()); haptic('selection'); spotRemember(r); paint(true); return; }
    spotRemember(r); close(); spotRun(r);
  };
  const onKey = e=>{
    if(!mine()) return;
    if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if(e.key === 'Tab'){
      const stops = [...layer.querySelectorAll('input,button:not([hidden]),[tabindex]:not([tabindex="-1"])')].filter(el=>!el.closest('[hidden]') && el.offsetParent !== null);
      if(!stops.length) return;
      const i = stops.indexOf(document.activeElement);
      if(e.shiftKey && i <= 0){ e.preventDefault(); stops[stops.length - 1].focus(); }
      else if(!e.shiftKey && (i === -1 || i === stops.length - 1)){ e.preventDefault(); stops[0].focus(); }
    }
    else if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); if(flat.length){ active = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length; mark(true); } }
    else if(e.key === 'Enter' && document.activeElement === input && !e.isComposing){ e.preventDefault(); run(active); }
  };
  document.addEventListener('keydown', onKey, true);
  const clear = layer.querySelector('.spot-clear');
  input.addEventListener('input', ()=>{ clear.hidden = !input.value; if(!input.value) spotScope = 'all'; paint(); });
  clear.onclick = ()=>{ input.value = ''; clear.hidden = true; spotScope = 'all'; paint(); input.focus({preventScroll:true}); };
  scopes.onclick = e=>{ const b = e.target.closest('[data-spot-scope]'); if(!b) return; spotScope = b.dataset.spotScope; paint(); input.focus({preventScroll:true}); };
  layer.querySelector('.spot-scrim').onclick = close;
  layer.querySelector('.spot-cancel').onclick = close;
  list.addEventListener('click', e=>{
    if(!mine()) return;
    const step = e.target.closest('[data-spot-add],[data-spot-dec]');
    if(step){
      const id = step.dataset.spotAdd || step.dataset.spotDec;
      spotStep(id, step.dataset.spotAdd ? 1 : -1);
      // Only this item's − and + are redrawn: no flicker, and the list stays where it is.
      const item = state.items.find(i=>i.id === id), wrap = step.closest('[data-spot-item]');
      if(item && wrap){
        const focusAdd = !!step.dataset.spotAdd || !(state.cart[id] > 0);
        wrap.querySelector('.spot-step').outerHTML = spotStepHtml(item);
        wrap.querySelector(focusAdd ? '[data-spot-add]' : '[data-spot-dec]')?.focus({preventScroll:true});
      }
      return;
    }
    if(e.target.closest('[data-spot-forget]')){ lset(spotRecentKey(), null); paint(); input.focus({preventScroll:true}); return; }
    if(e.target.closest('[data-spot-out]')) return;   // Call and WhatsApp open by themselves
    const b = e.target.closest('[data-spot]');
    if(b) run(Number(b.dataset.spot));
  });
  // Rico's chats are searchable too: their titles load once, quietly, then the results include them.
  if(canOpen('assistant') && rico.chats === null && !rico.chatsBusy) ricoLoadChats().then(()=>{ if(!closed && input.value.trim()) paint(true); });
  paint();
  if(document.activeElement !== input) requestAnimationFrame(()=>input.focus({preventScroll:true}));
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
