/* Ricotta Orders -- Transfers.
   Every day the kitchen moves items between the workplace storages (Breakfast, Pizza, Bakery,
   Teahouse...) on the workplace stock system's "Move between storages" page, which has an Upload Excel
   button. This tab makes that file: the person writes, says, photographs or searches the items; Rico
   reads the list and finds each item's exact name in the workplace item list (uploaded here, with each
   item's units); anything unsure is marked for the person to pick; then a styled Excel is made. The
   storages are chosen in the workplace system. Nothing here touches orders or the ordering catalog.
   Depends on (runtime): state, t, esc, api, lget, lset, toast, showAlert, showFormModal, withBusy,
   foldText, openKitchenSheet, loadSpreadsheetReader, ricoToggleVoice, ricoRecorder, ricoVoiceSupported,
   blobToBase64, formatIraqDateTime, erbilDate, ICON_* (icons.js), RicottaSearch (search.js). */
const TRANSFER_TEXT = {
  en: {
    transfers: 'Transfers',
    trSoonPill: 'In development',
    trSoonTitle: 'Transfers is almost ready',
    trSoonText: 'You can try it now. It goes live once the workplace system adds its Upload Excel button.',
    trSoonDone: 'Ricotta makes the Excel',
    trSoonWait: 'Workplace system adds Upload Excel',
    guideTransfers: 'Write the items to move between storages. Rico finds the exact names and makes the Excel for the workplace system.',
    trWriteLabel: 'Items to move',
    trPlaceholder: 'e.g. tomatoes 2 kg, onions 1 sack, flour 3',
    trRead: 'Read with Rico',
    trSpeak: 'Say it',
    trListening: 'Listening… tap to finish',
    trPhoto: 'Photo of a list',
    trSearchAdd: 'Search an item to add',
    trSearchNone: 'No matching item',
    trRowsTitle: 'Check the items',
    trYouWrote: s => 'You wrote: ' + s,
    trNotFound: 'Not in the workplace list. Tap to pick the item.',
    trCheck: 'Is this the right item?',
    trConfirm: 'Yes',
    trChange: 'Change',
    trPickItem: 'Pick the item',
    trAmount: 'Amount',
    trUnit: 'Unit',
    trChooseUnit: 'Choose a unit',
    trAmountMissing: 'Write the amount',
    trUnitMissing: 'Choose the unit',
    trUnitWrong: 'This item does not come in that unit',
    trRemember: s => `Remember “${s}” for this item`,
    trRemove: 'Remove',
    trMake: 'Make Excel',
    trReadyMeta: n => n === 1 ? '1 item, ready' : n + ' items, ready',
    trFixRows: n => n === 1 ? 'Fix 1 row first' : 'Fix ' + n + ' rows first',
    trReady: 'Excel file ready',
    trNewList: 'New list',
    trCleared: 'List cleared',
    trEmpty: 'Write, say, photograph or search the items to move.',
    trNothingFound: 'No items found in that.',
    trAiFailed: 'Rico could not read it, so this phone matched the names. Please check the rows.',
    trPhotoFailed: 'Rico could not read the photo. Try again with a clearer photo.',
    trMakeFailed: 'The Excel file could not be made. Please try again.',
    trListTitle: 'Workplace item list',
    trListCount: n => n + ' items from the workplace system',
    trListEmpty: 'Upload the workplace item list first, so Rico can find the exact names and units.',
    trListUpload: 'Upload Excel',
    trListHint: 'Any Excel or CSV with an item name column. A unit column is optional; separate several units with commas. The new list replaces the old one; remembered spellings are kept.',
    trListPreview: (n, u) => n + ' items and ' + u + ' units found',
    trListNoName: 'No item names were found in this file.',
    trListSave: 'Save list',
    trListSaved: 'Workplace item list saved',
  },
  ku: {
    transfers: 'گواستنەوە',
    trSoonPill: 'لە گەشەپێداندایە',
    trSoonTitle: 'گواستنەوە خەریکە ئامادە دەبێت',
    trSoonText: 'دەتوانیت ئێستا تاقی بکەیتەوە. کاتێک سیستەمی شوێنی کار دوگمەی بارکردنی Excel زیاد دەکات، دەکەوێتە کار.',
    trSoonDone: 'ریکۆتا فایلی Excel دروست دەکات',
    trSoonWait: 'سیستەمی شوێنی کار دوگمەی بارکردنی Excel زیاد دەکات',
    guideTransfers: 'ئەو کاڵایانە بنووسە کە لە نێوان کۆگاکاندا دەگوازرێنەوە. ڕیکۆ ناوە ڕاستەکان دەدۆزێتەوە و فایلی Excel بۆ سیستەمی شوێنی کار دروست دەکات.',
    trWriteLabel: 'کاڵاکانی گواستنەوە',
    trPlaceholder: 'بۆ نموونە: تەماتە 2 کیلۆ، پیاز 1 فەردە، ئارد 3',
    trRead: 'ڕیکۆ بیخوێنێتەوە',
    trSpeak: 'بیڵێ',
    trListening: 'گوێ دەگرم… بۆ تەواوکردن لێی بدە',
    trPhoto: 'وێنەی لیست',
    trSearchAdd: 'بگەڕێ بۆ کاڵایەک بۆ زیادکردن',
    trSearchNone: 'هیچ کاڵایەکی گونجاو نییە',
    trRowsTitle: 'کاڵاکان بپشکنە',
    trYouWrote: s => 'نووسیت: ' + s,
    trNotFound: 'لە لیستی شوێنی کار نییە. لێی بدە و کاڵاکە هەڵبژێرە.',
    trCheck: 'ئەمە کاڵا ڕاستەکەیە؟',
    trConfirm: 'بەڵێ',
    trChange: 'گۆڕین',
    trPickItem: 'کاڵاکە هەڵبژێرە',
    trAmount: 'بڕ',
    trUnit: 'یەکە',
    trChooseUnit: 'یەکە هەڵبژێرە',
    trAmountMissing: 'بڕەکە بنووسە',
    trUnitMissing: 'یەکەکە هەڵبژێرە',
    trUnitWrong: 'ئەم کاڵایە بەم یەکەیە نییە',
    trRemember: s => `«${s}» بۆ ئەم کاڵایە هەڵبگرە`,
    trRemove: 'لابردن',
    trMake: 'دروستکردنی Excel',
    trReadyMeta: n => n + ' کاڵا، ئامادەیە',
    trFixRows: n => 'سەرەتا ' + n + ' ڕیز ڕاست بکەرەوە',
    trReady: 'فایلی Excel ئامادەیە',
    trNewList: 'لیستی نوێ',
    trCleared: 'لیستەکە پاککرایەوە',
    trEmpty: 'کاڵاکان بنووسە، بیڵێ، وێنەیان بگرە یان بەدوایاندا بگەڕێ.',
    trNothingFound: 'هیچ کاڵایەک لەوەدا نەدۆزرایەوە.',
    trAiFailed: 'ڕیکۆ نەیتوانی بیخوێنێتەوە، بۆیە ئەم ئامێرە ناوەکانی بەراورد کرد. تکایە ڕیزەکان بپشکنە.',
    trPhotoFailed: 'ڕیکۆ نەیتوانی وێنەکە بخوێنێتەوە. بە وێنەیەکی ڕوونتر دووبارە هەوڵ بدەرەوە.',
    trMakeFailed: 'فایلی Excel دروست نەکرا. تکایە دووبارە هەوڵ بدەرەوە.',
    trListTitle: 'لیستی کاڵاکانی شوێنی کار',
    trListCount: n => n + ' کاڵا لە سیستەمی شوێنی کار',
    trListEmpty: 'سەرەتا لیستی کاڵاکانی شوێنی کار باربکە، تاکو ڕیکۆ ناو و یەکە ڕاستەکان بدۆزێتەوە.',
    trListUpload: 'بارکردنی Excel',
    trListHint: 'هەر فایلێکی Excel یان CSV کە ستوونێکی ناوی کاڵای تێدابێت. ستوونی یەکە ئارەزوومەندانەیە؛ چەند یەکەیەک بە کۆما جیا بکەرەوە. لیستە نوێیەکە جێگەی کۆنەکە دەگرێتەوە؛ ناوە هەڵگیراوەکان دەمێننەوە.',
    trListPreview: (n, u) => n + ' کاڵا و ' + u + ' یەکە دۆزرانەوە',
    trListNoName: 'هیچ ناوێکی کاڵا لەم فایلەدا نەدۆزرایەوە.',
    trListSave: 'پاشەکەوتکردنی لیست',
    trListSaved: 'لیستی کاڵاکانی شوێنی کار پاشەکەوت کرا',
  },
  ar: {
    transfers: 'النقل',
    trSoonPill: 'قيد التطوير',
    trSoonTitle: 'النقل على وشك الجاهزية',
    trSoonText: 'يمكنك تجربته الآن. سيعمل عندما يضيف نظام العمل زر رفع Excel.',
    trSoonDone: 'ريكوتا يصنع ملف Excel',
    trSoonWait: 'نظام العمل يضيف زر رفع Excel',
    guideTransfers: 'اكتب المواد التي تريد نقلها بين المخازن. يجد ريكو الأسماء الصحيحة ويصنع ملف Excel لنظام العمل.',
    trWriteLabel: 'المواد المراد نقلها',
    trPlaceholder: 'مثلاً: طماطم 2 كيلو، بصل 1 فردة، طحين 3',
    trRead: 'اقرأ مع ريكو',
    trSpeak: 'قلها',
    trListening: 'أستمع… اضغط للإنهاء',
    trPhoto: 'صورة قائمة',
    trSearchAdd: 'ابحث عن مادة لإضافتها',
    trSearchNone: 'لا توجد مادة مطابقة',
    trRowsTitle: 'راجع المواد',
    trYouWrote: s => 'كتبت: ' + s,
    trNotFound: 'غير موجودة في قائمة العمل. اضغط لاختيار المادة.',
    trCheck: 'هل هذه المادة الصحيحة؟',
    trConfirm: 'نعم',
    trChange: 'تغيير',
    trPickItem: 'اختر المادة',
    trAmount: 'الكمية',
    trUnit: 'الوحدة',
    trChooseUnit: 'اختر وحدة',
    trAmountMissing: 'اكتب الكمية',
    trUnitMissing: 'اختر الوحدة',
    trUnitWrong: 'هذه المادة لا تأتي بهذه الوحدة',
    trRemember: s => `تذكّر «${s}» لهذه المادة`,
    trRemove: 'إزالة',
    trMake: 'إنشاء Excel',
    trReadyMeta: n => 'مواد: ' + n + '، جاهز',
    trFixRows: n => 'صحّح الصفوف أولاً: ' + n,
    trReady: 'ملف Excel جاهز',
    trNewList: 'قائمة جديدة',
    trCleared: 'تم مسح القائمة',
    trEmpty: 'اكتب المواد أو قلها أو صوّرها أو ابحث عنها.',
    trNothingFound: 'لم يُعثر على مواد في ذلك.',
    trAiFailed: 'تعذّر على ريكو القراءة، فطابق هذا الجهاز الأسماء. راجع الصفوف.',
    trPhotoFailed: 'تعذّر على ريكو قراءة الصورة. حاول مرة أخرى بصورة أوضح.',
    trMakeFailed: 'تعذّر إنشاء ملف Excel. حاول مرة أخرى.',
    trListTitle: 'قائمة مواد العمل',
    trListCount: n => 'مواد من نظام العمل: ' + n,
    trListEmpty: 'ارفع قائمة مواد العمل أولاً ليجد ريكو الأسماء والوحدات الصحيحة.',
    trListUpload: 'رفع Excel',
    trListHint: 'أي ملف Excel أو CSV فيه عمود لاسم المادة. عمود الوحدة اختياري، وافصل عدة وحدات بفواصل. القائمة الجديدة تحل محل القديمة، وتبقى التهجئات المحفوظة.',
    trListPreview: (n, u) => 'مواد: ' + n + '، وحدات: ' + u,
    trListNoName: 'لم يُعثر على أسماء مواد في هذا الملف.',
    trListSave: 'حفظ القائمة',
    trListSaved: 'تم حفظ قائمة مواد العمل',
  },
};
for (const lang of ['en', 'ku', 'ar']) Object.assign(T[lang], TRANSFER_TEXT[lang]);
/* The workplace system's Upload Excel button is not there yet, so the tab says it is still in development.
   Set this to true once the workplace system can take the file. */
const TRANSFERS_READY = false;
const ICON_WRENCH = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/></svg>`;
/* The wrench on the Transfers tab, and the card at the top of the tab, while it is in development. */
const transferNavBadge = () => TRANSFERS_READY ? '' : `<i class="nav-soon" title="${esc(t('trSoonPill'))}">${ICON_WRENCH}</i>`;
function renderTransferSoon(){
  if(TRANSFERS_READY) return '';
  const check = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  return `<section class="tr-soon" role="note" aria-label="${esc(t('trSoonPill'))}">
    <span class="tr-soon-pill"><i aria-hidden="true"></i>${esc(t('trSoonPill'))}</span>
    <b class="tr-soon-title">${esc(t('trSoonTitle'))}</b>
    <p>${esc(t('trSoonText'))}</p>
    ${ricoFace('thinking', 'tr-soon-rico')}
    <ol class="tr-soon-steps">
      <li class="done"><span class="mark">${check}</span><span>${esc(t('trSoonDone'))}</span></li>
      <li class="wait"><span class="mark">${ICON_WRENCH}</span><span>${esc(t('trSoonWait'))}</span></li>
    </ol>
  </section>`;
}

/* ---------- The workplace item list ---------- */
const stockList = {items: null, byId: new Map(), busy: null};
function setStockItems(items){
  stockList.items = Array.isArray(items) ? items.filter(i=>i && typeof i.id === 'string' && typeof i.name === 'string') : [];
  stockList.byId = new Map(stockList.items.map(i=>[i.id, i]));
}
function loadStockItems(force = false){
  if(stockList.items && !force) return Promise.resolve(stockList.items);
  if(!stockList.busy) stockList.busy = api('stock-items').then(r=>{
    if(r.ok && Array.isArray(r.data)) setStockItems(r.data);
    else if(!stockList.items) setStockItems([]);
    return stockList.items;
  }).finally(()=>{ stockList.busy = null; });
  return stockList.busy;
}
const stockItem = id => stockList.byId.get(id) || null;
/* What the stock system may call an item: its full name, each half of "English - کوردی", and remembered spellings. */
const stockFields = i => [i.name, ...i.name.split(/\s+[-–]\s+/).filter(p=>p !== i.name), ...(i.aliases || [])];
/* Every unit the list uses (the unit choices for an item that has none of its own). */
function stockUnits(){
  const units = [...new Set((stockList.items || []).flatMap(i=>i.units || []))];
  return units.length ? units : [...new Set(state.units.map(u=>u.ku || u.en).filter(Boolean))];
}
const unitsFor = item => item && item.units && item.units.length ? item.units : stockUnits();

/* Items for a search, best first. When no item has every word, items with any one of the words. */
function findStock(q){
  const items = stockList.items || [];
  if(!q.trim()) return items;
  const found = globalThis.RicottaSearch.rank(items, q, stockFields);
  if(found.length) return found;
  return [...new Set(q.split(/\s+/).filter(w=>w.length > 1).flatMap(w=>globalThis.RicottaSearch.rank(items, w, stockFields)))];
}
/* Finds the item on this phone (when Rico can't help, and for the search box). Sure only when one
   item's name or remembered spelling is exactly what was written. */
function matchStockLocally(said){
  const items = stockList.items || [];
  if(!said || !items.length) return {itemId:null, sure:false, suggestions:[]};
  const scored = items.map(i=>({i, s:globalThis.RicottaSearch.score(said, stockFields(i))})).filter(x=>Number.isFinite(x.s)).sort((a, b)=>a.s - b.s);
  const best = scored[0], next = scored[1];
  const sure = !!best && best.s <= 2 && (!next || next.s > 2);
  return {itemId: best ? best.i.id : null, sure, suggestions: (scored.length ? scored.map(x=>x.i) : findStock(said)).slice(0, 4).map(i=>i.id)};
}
/* "tomatoes 2 kg, onions 1 sack" -> [{said, amount, unit}], one per line or comma (a comma before a digit is a decimal). */
function parseTransferText(text){
  const known = stockUnits();
  return String(text || '').split(/\n|[،;؛]+|,(?!\d)/).map(s=>s.trim()).filter(Boolean).map(line=>{
    const num = foldText(line).replace(/(\d)[٫,.](\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/);
    // Each word without its digits ("2kg" -> "kg"); the unit is kept as written.
    const words = line.split(/\s+/).filter(Boolean).map(w=>({w, bare:w.replace(/[0-9٠-٩۰-۹.,٫]+/g, '')}));
    const unitWord = words.find(x=>x.bare && globalThis.RicottaSearch.isUnit(x.bare, known));
    const said = words.filter(x=>x !== unitWord && !/\d/.test(foldText(x.w))).map(x=>x.w).join(' ').replace(/^[-–:×*·•.]+|[-–:×*·•.]+$/g, '').trim();
    return {said: said || line, amount: num ? Number(num[0]) : null, unit: unitWord ? unitWord.bare : null};
  });
}

/* ---------- The list being made (kept on this phone until it is cleared) ---------- */
let transfer = {text:'', rows:[]};
let transferAccount = null;
function transferState(){
  if(transferAccount !== state.account){
    transferAccount = state.account;
    const saved = lget('transfer:' + state.account);
    transfer = {text: typeof saved?.text === 'string' ? saved.text : '', rows: Array.isArray(saved?.rows) ? saved.rows.filter(r=>r && typeof r.id === 'string') : []};
  }
  return transfer;
}
function saveTransfer(){ if(state.account) lset('transfer:' + state.account, transfer.rows.length || transfer.text ? transfer : null); }
const newRowId = () => 'r' + Math.random().toString(36).slice(2, 10);
const validAmount = a => Number.isFinite(a) && a > 0 && a <= 99999 && Math.abs(a * 1000 - Math.round(a * 1000)) < 1e-6;
/* What is wrong with a row, or '' when it can go into the file. Without a workplace list any written name is accepted. */
function rowIssue(row){
  const listed = (stockList.items || []).length > 0, item = stockItem(row.itemId);
  if(listed && !item) return 'item';
  if(listed && !row.sure) return 'check';
  if(!validAmount(row.amount)) return 'amount';
  if(!row.unit || (item && item.units.length && !item.units.includes(row.unit))) return 'unit';
  return '';
}
const issueText = (row, issue) => issue === 'unit' ? t(row.unit ? 'trUnitWrong' : 'trUnitMissing') : ({item:t('trNotFound'), amount:t('trAmountMissing')})[issue] || '';
/* New rows join the list; the same item and unit twice become one row. */
function addTransferRows(rows){
  for(const r of rows){
    const item = stockItem(r.itemId);
    const unit = item ? (globalThis.RicottaSearch.unit(unitsFor(item), r.unit || '') || (r.unit && !item.units.length ? r.unit : null)) : (r.unit || null);
    const row = {id:newRowId(), said:String(r.said || item?.name || '').slice(0, 160), itemId:item ? item.id : null, sure:!!(item && r.sure), amount:validAmount(r.amount) ? Math.round(r.amount * 1000) / 1000 : null, unit, suggestions:(r.suggestions || []).filter(id=>stockItem(id)).slice(0, 4)};
    const same = row.itemId && transfer.rows.find(x=>x.itemId === row.itemId && x.unit === row.unit && x.sure && row.sure);
    if(same && validAmount(same.amount) && row.amount) same.amount = Math.round((same.amount + row.amount) * 1000) / 1000;
    else transfer.rows.push(row);
  }
  saveTransfer();
}

/* ---------- Screen ---------- */
function renderTransfers(){
  transferState();
  const listed = stockList.items ? stockList.items.length : null;
  const voice = ricoVoiceSupported();
  const intro = listed === 0 ? `<div class="form-card tr-empty-list"><p>${esc(t('trListEmpty'))}</p><button type="button" class="btn btn-primary" data-stock-upload>${ICON_DOWNLOAD} ${esc(t('trListUpload'))}</button></div>` : '';
  const rows = transfer.rows.map(renderTransferRow).join('');
  // A computer shows the input and the item list beside the rows; a phone shows them one under another.
  return `${renderTransferSoon()}<div class="tr-page"><div class="tr-side">${intro}
    <div class="form-card tr-input">
      <div class="field"><label for="trText">${esc(t('trWriteLabel'))}</label>
      <textarea id="trText" rows="3" dir="auto" maxlength="4000" placeholder="${esc(t('trPlaceholder'))}">${esc(transfer.text)}</textarea></div>
      <div class="tr-actions">
        <button type="button" class="btn btn-primary" id="trReadBtn">${ricoSparkSvg('currentColor')}<span>${esc(t('trRead'))}</span></button>
        ${voice ? `<button type="button" class="btn btn-ghost tr-mic" id="trMicBtn" aria-pressed="false">${ICON_MIC}<span>${esc(t('trSpeak'))}</span></button>` : ''}
        <button type="button" class="btn btn-ghost" id="trPhotoBtn">${ICON_CAMERA}<span>${esc(t('trPhoto'))}</span></button>
        <input type="file" id="trPhotoFile" accept="image/*" capture="environment" hidden>
      </div>
      <div class="search-wrap tr-search">${ICON_SEARCH}<input class="search-input" id="trSearch" type="search" autocomplete="off" placeholder="${esc(t('trSearchAdd'))}" aria-label="${esc(t('trSearchAdd'))}"></div>
      <div class="tr-results" id="trResults" role="listbox" hidden></div>
    </div></div>
    <div class="tr-col"><div class="action-row tr-rows-head">
      <div class="section-title grow">${esc(t('trRowsTitle'))} (${transfer.rows.length})</div>
      ${transfer.rows.length ? `<button type="button" class="btn btn-ghost" id="trClearBtn">${esc(t('trNewList'))}</button>` : ''}
    </div>
    <div id="trRows">${rows || emptyState(esc(t('trEmpty')))}</div></div>
    <details class="settings-group tr-list"${listed === 0 ? ' hidden' : ''}><summary>${esc(t('trListTitle'))}${listed ? ` · ${listed}` : ''}</summary>
      <p class="field-hint">${esc(listed ? t('trListCount')(listed) : t('trListEmpty'))}</p><p class="field-hint">${esc(t('trListHint'))}</p>
      <button type="button" class="btn btn-ghost" data-stock-upload>${ICON_DOWNLOAD} ${esc(t('trListUpload'))}</button>
    </details></div>
    <input type="file" id="trListFile" accept=".xlsx,.xls,.csv" hidden>`;
}
function renderTransferRow(row){
  const item = stockItem(row.itemId), issue = rowIssue(row);
  const units = item ? unitsFor(item) : stockUnits();
  const unitOptions = `<option value="" disabled ${row.unit ? '' : 'selected'}>${esc(t('trChooseUnit'))}</option>` + [...new Set([...units, ...(row.unit && !units.includes(row.unit) && !(item && item.units.length) ? [row.unit] : [])])]
    .map(u=>`<option value="${esc(u)}" ${u === row.unit ? 'selected' : ''}>${esc(u)}</option>`).join('');
  // "You wrote" only when the spelling was not one of the item's own names (its full name, either half, a remembered spelling).
  const differs = item && row.said && globalThis.RicottaSearch.score(row.said, stockFields(item), false) > 2;
  const message = issueText(row, issue);
  const suggestions = issue === 'item' || issue === 'check' ? row.suggestions.filter(id=>id !== row.itemId).map(stockItem).filter(Boolean).slice(0, 3) : [];
  return `<div class="tr-row glass${issue ? ' bad' : ''}${issue === 'check' ? ' check' : ''}" data-row="${esc(row.id)}">
    <div class="tr-main">
      <button type="button" class="tr-item" data-pick="${esc(row.id)}"><b dir="auto">${esc(item ? item.name : row.said)}</b>${differs ? `<small dir="auto">${esc(t('trYouWrote')(row.said))}</small>` : ''}</button>
      <button type="button" class="icon-btn danger" data-remove="${esc(row.id)}" aria-label="${esc(t('trRemove'))}">${ICON_DELETE}</button>
    </div>
    ${issue === 'check' ? `<div class="tr-check"><span>${esc(t('trCheck'))}</span><button type="button" class="btn btn-primary" data-confirm="${esc(row.id)}">${esc(t('trConfirm'))}</button><button type="button" class="btn btn-ghost" data-pick="${esc(row.id)}">${esc(t('trChange'))}</button></div>` : ''}
    ${suggestions.length ? `<div class="tr-suggest">${suggestions.map(s=>`<button type="button" class="chip" data-suggest="${esc(row.id)}" data-item="${esc(s.id)}" dir="auto">${esc(s.name)}</button>`).join('')}</div>` : ''}
    <div class="tr-fields">
      <div class="field"><label for="trAmount-${esc(row.id)}">${esc(t('trAmount'))}</label><input id="trAmount-${esc(row.id)}" data-amount="${esc(row.id)}" inputmode="decimal" data-pad="dec" maxlength="9" autocomplete="off" value="${row.amount ?? ''}"></div>
      <div class="field"><label for="trUnit-${esc(row.id)}">${esc(t('trUnit'))}</label><select id="trUnit-${esc(row.id)}" data-unit="${esc(row.id)}">${unitOptions}</select></div>
    </div>
    <div class="tr-msg" role="status">${esc(message)}</div>
  </div>`;
}
function renderTransferBar(){
  transferState();
  const bad = transfer.rows.filter(rowIssue).length, n = transfer.rows.length;
  return `<div class="bottom-bar transfer-bar ${n ? 'show' : ''}">
    <button class="send-btn" id="trMakeBtn" ${!n || bad ? 'disabled' : ''}>
      <span class="send-text"><span class="send-label">${esc(t('trMake'))}</span><span class="send-meta">${esc(bad ? t('trFixRows')(bad) : t('trReadyMeta')(n))}</span></span>
      <span class="send-go" aria-hidden="true">${ICON_SHEET}</span>
    </button>
  </div>`;
}
/* Redraws the rows and the bottom bar without rebuilding the page (the text box keeps its place). */
function paintTransfers(){
  const box = document.getElementById('trRows');
  if(!box) return;
  box.innerHTML = transfer.rows.map(renderTransferRow).join('') || emptyState(esc(t('trEmpty')));
  const head = document.querySelector('.tr-rows-head .section-title');
  if(head) head.textContent = `${t('trRowsTitle')} (${transfer.rows.length})`;
  const clear = document.getElementById('trClearBtn');
  if(!clear && transfer.rows.length){ render(); return; }
  if(clear && !transfer.rows.length) clear.remove();
  paintTransferBar();
  attachTransferRowEvents(box);
}
function paintTransferBar(){
  const old = document.querySelector('.transfer-bar');
  if(!old) return;
  old.outerHTML = renderTransferBar();
  const make = document.getElementById('trMakeBtn');
  if(make) make.onclick = ()=>withBusy(make, makeTransferExcel);
}
function paintTransferMic(){
  const b = document.getElementById('trMicBtn');
  if(!b) return;
  const on = ricoRecorder.active && ricoRecorder.voiceTransfer, busy = ricoRecorder.busy && ricoRecorder.voiceTransfer;
  b.classList.toggle('listening', on); b.classList.toggle('working', busy);
  b.disabled = busy || (ricoRecorder.active && !ricoRecorder.voiceTransfer); b.setAttribute('aria-pressed', String(on));
  b.querySelector('span').textContent = on ? t('trListening') : busy ? t('ricoTranscribing') : t('trSpeak');
}

function attachTransferEvents(){
  transferState();
  const text = document.getElementById('trText');
  text.oninput = ()=>{ transfer.text = text.value; saveTransfer(); };
  const read = document.getElementById('trReadBtn');
  read.onclick = ()=>withBusy(read, ()=>readTransfer({text:text.value}));
  const mic = document.getElementById('trMicBtn');
  if(mic) mic.onclick = async ()=>{
    if(ricoRecorder.active){ await ricoToggleVoice(); paintTransferMic(); return; }
    ricoRecorder.voiceTransfer = true;
    await ricoToggleVoice();
    if(!ricoRecorder.active) ricoRecorder.voiceTransfer = false;
    paintTransferMic();
  };
  paintTransferMic();
  const photo = document.getElementById('trPhotoFile');
  document.getElementById('trPhotoBtn').onclick = ()=>photo.click();
  photo.onchange = ()=>{ const file = photo.files[0]; photo.value = ''; if(file) withBusy(document.getElementById('trPhotoBtn'), ()=>readTransferPhoto(file)); };
  const search = document.getElementById('trSearch'), results = document.getElementById('trResults');
  search.oninput = ()=>{
    const q = search.value.trim();
    const found = q ? findStock(q).slice(0, 8) : [];
    results.hidden = !q;
    results.innerHTML = found.length ? found.map(i=>`<button type="button" class="sel-opt" role="option" data-add="${esc(i.id)}"><span dir="auto">${esc(i.name)}</span><small>${esc((i.units || []).join(' · '))}</small></button>`).join('') : `<div class="field-hint">${esc(t('trSearchNone'))}</div>`;
    results.querySelectorAll('[data-add]').forEach(b=>b.onclick = ()=>{
      const item = stockItem(b.dataset.add);
      if(!item) return;
      addTransferRows([{said:item.name, itemId:item.id, sure:true, amount:null, unit:null}]);
      search.value = ''; results.hidden = true; results.innerHTML = '';
      paintTransfers();
      const row = transfer.rows[transfer.rows.length - 1];
      requestAnimationFrame(()=>{ const amount = document.querySelector(`[data-amount="${CSS.escape(row.id)}"]`); amount?.scrollIntoView({block:'center'}); amount?.click(); amount?.focus(); });
    });
  };
  document.getElementById('trClearBtn')?.addEventListener('click', ()=>{
    const before = {text:transfer.text, rows:transfer.rows.slice()};
    transfer.rows = []; transfer.text = ''; saveTransfer(); render();
    toast(t('trCleared'), 'ok', {undo:()=>{ transfer.text = before.text; transfer.rows = before.rows; saveTransfer(); render(); }});
  });
  document.querySelectorAll('[data-stock-upload]').forEach(b=>b.onclick = ()=>document.getElementById('trListFile').click());
  const listFile = document.getElementById('trListFile');
  listFile.onchange = ()=>{ const file = listFile.files[0]; listFile.value = ''; if(file) openStockListImport(file); };
  attachTransferRowEvents(document.getElementById('trRows'));
  paintTransferBar();
  if(!stockList.items) loadStockItems().then(()=>{ if(state.view === 'transfers') render(); });
}
function attachTransferRowEvents(root){
  const rowOf = id => transfer.rows.find(r=>r.id === id);
  root.querySelectorAll('[data-remove]').forEach(b=>b.onclick = ()=>{ transfer.rows = transfer.rows.filter(r=>r.id !== b.dataset.remove); saveTransfer(); paintTransfers(); });
  root.querySelectorAll('[data-confirm]').forEach(b=>b.onclick = ()=>{ const r = rowOf(b.dataset.confirm); if(r){ r.sure = true; saveTransfer(); paintTransfers(); } });
  root.querySelectorAll('[data-pick]').forEach(b=>b.onclick = ()=>{ const r = rowOf(b.dataset.pick); if(r && (stockList.items || []).length) openStockPicker(r); });
  // A suggestion is taken as it is; spellings are remembered only from the picker, where "Remember" is shown.
  root.querySelectorAll('[data-suggest]').forEach(b=>b.onclick = ()=>{ const r = rowOf(b.dataset.suggest); if(r) chooseStockItem(r, b.dataset.item, false); });
  root.querySelectorAll('[data-amount]').forEach(input=>input.oninput = ()=>{
    const r = rowOf(input.dataset.amount); if(!r) return;
    const v = readQuantity(input.value);
    r.amount = input.value.trim() && validAmount(v) ? v : null;
    saveTransfer(); paintTransferRowState(r);
  });
  root.querySelectorAll('[data-unit]').forEach(sel=>sel.onchange = ()=>{ const r = rowOf(sel.dataset.unit); if(!r) return; r.unit = sel.value || null; saveTransfer(); paintTransferRowState(r); });
}
/* Just the row's colour and message, so typing an amount never rebuilds the row under the finger. */
function paintTransferRowState(row){
  const el = document.querySelector(`.tr-row[data-row="${CSS.escape(row.id)}"]`);
  if(!el) return;
  const issue = rowIssue(row);
  el.classList.toggle('bad', !!issue); el.classList.toggle('check', issue === 'check');
  const msg = el.querySelector('.tr-msg');
  if(msg) msg.textContent = issueText(row, issue);
  paintTransferBar();
}
/* A row gets its item: the unit is kept when the item has it, and the spelling can be remembered. */
async function chooseStockItem(row, itemId, remember){
  const item = stockItem(itemId);
  if(!item) return;
  const said = row.said;
  row.itemId = item.id; row.sure = true;
  row.unit = globalThis.RicottaSearch.unit(unitsFor(item), row.unit || '') || (item.units.length === 1 ? item.units[0] : null);
  saveTransfer(); paintTransfers();
  if(remember && said && globalThis.RicottaSearch.score(said, stockFields(item), false) > 2){
    const r = await api(`stock-items/${encodeURIComponent(item.id)}/alias`, {method:'POST', body:{alias:said}});
    if(r.ok) item.aliases = [...(item.aliases || []), said].slice(-30);
  }
}
function openStockPicker(row){
  const {el, close} = openKitchenSheet('tr-picker', `<div class="sel-title">${esc(t('trPickItem'))}</div>
    <div class="search-wrap sel-search">${ICON_SEARCH}<input class="search-input" type="search" autocomplete="off" value="${esc(row.said)}" aria-label="${esc(t('trPickItem'))}"></div>
    ${row.said ? `<label class="check-row tr-remember"><input type="checkbox" checked><span>${esc(t('trRemember')(row.said))}</span></label>` : ''}
    <div class="sel-list" role="listbox"></div>`, t('trPickItem'));
  const input = el.querySelector('input[type=search]'), list = el.querySelector('.sel-list'), remember = el.querySelector('.tr-remember input');
  const paint = ()=>{
    // Nothing found for what was written: say so, and show the list to scroll through instead.
    const q = input.value.trim(), found = findStock(q), shown = (found.length ? found : stockList.items || []).slice(0, 80);
    list.innerHTML = (found.length ? '' : `<div class="field-hint">${esc(t('trSearchNone'))}</div>`) +
      shown.map(i=>`<button type="button" class="sel-opt${i.id === row.itemId ? ' on' : ''}" role="option" data-v="${esc(i.id)}"><span dir="auto">${esc(i.name)}</span><small>${esc((i.units || []).join(' · '))}</small></button>`).join('');
  };
  input.oninput = paint; paint();
  list.onclick = e=>{ const b = e.target.closest('[data-v]'); if(!b) return; close(); chooseStockItem(row, b.dataset.v, !!remember?.checked); };
  if(!matchMedia('(pointer: coarse)').matches) input.focus();
}

/* ---------- Reading a list: Rico first, this phone when Rico can't ---------- */
async function readTransfer({text, image, mime}){
  if(!text?.trim() && !image) return;
  if(!stockList.items) await loadStockItems();
  const r = await api('stock/read', {method:'POST', body:{text:text || '', image, mime, lang:state.lang}, timeout:60000});
  let rows = r.ok && Array.isArray(r.data?.rows) ? r.data.rows : null;
  if(!rows){
    if(image){ await showAlert(esc(t('trPhotoFailed'))); return; }
    rows = parseTransferText(text).map(p=>({...p, ...matchStockLocally(p.said)}));
    if(rows.length) toast(t('trAiFailed'), 'warn');
  }
  if(!rows.length){ toast(t('trNothingFound'), 'warn'); return; }
  addTransferRows(rows);
  if(text && !image){ transfer.text = ''; const box = document.getElementById('trText'); if(box) box.value = ''; saveTransfer(); }
  paintTransfers();
  document.getElementById('trRows')?.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}
/* A spoken list arrives as text (see ricoFinishVoice in assistant.js). */
function transferVoiceText(text){
  const box = document.getElementById('trText');
  if(box) box.value = text;
  transfer.text = text; saveTransfer();
  const read = document.getElementById('trReadBtn');
  if(read) withBusy(read, ()=>readTransfer({text}));
  else readTransfer({text});
}
/* A photo is made smaller on the phone first (a list stays readable at 1600 pixels). */
async function readTransferPhoto(file){
  let data;
  try{
    const url = URL.createObjectURL(file);
    try{
      const img = await new Promise((resolve, reject)=>{ const i = new Image(); i.onload = ()=>resolve(i); i.onerror = reject; i.src = url; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      data = await blobToBase64(await new Promise(resolve=>canvas.toBlob(resolve, 'image/jpeg', 0.82)));
    }finally{ URL.revokeObjectURL(url); }
  }catch(e){ await showAlert(esc(t('trPhotoFailed'))); return; }
  await readTransfer({image:data, mime:'image/jpeg'});
}

/* ---------- Uploading the workplace item list ---------- */
const NAME_HEADING = /item|name|product|ناو|کاڵا|اسم|مادة|المادة|صنف/i;
const UNIT_HEADING = /unit|uom|یەکە|وحدة|الوحدة/i;
/* {items:[{name, units}], units:[...]} from any Excel or CSV: the "Item list" sheet when there is one,
   the column headed like "Item name" (or the first column), and a unit column when there is one. */
async function readStockListFile(file){
  if(file.size > 5 * 1024 * 1024) throw new Error(t('trListNoName'));
  const reader = await loadSpreadsheetReader(), bytes = await file.arrayBuffer(), options = {cellFormula:false, sheetRows:6000};
  // A CSV is read as UTF-8 text, so Kurdish and Arabic names arrive as written.
  const book = /\.csv$/i.test(file.name || '') || /csv/.test(file.type || '')
    ? reader.read(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''), {...options, type:'string'})
    : reader.read(bytes, {...options, type:'array'});
  const sheetName = book.SheetNames.find(n=>/item\s*list|items|کاڵاکان|المواد/i.test(n)) || book.SheetNames[0];
  const grid = reader.utils.sheet_to_json(book.Sheets[sheetName], {header:1, defval:'', raw:false}).map(r=>r.map(c=>String(c ?? '').trim()));
  // The heading row is one of the first ten. A row or column called "name" wins over a title like
  // "Workplace items" or a column like "Item code".
  const heading = (c, re) => c.length < 40 && re.test(c);
  const firstRow = re => grid.slice(0, 10).findIndex(r=>r.some(c=>heading(c, re)));
  const head = firstRow(/name|ناو|اسم/i) >= 0 ? firstRow(/name|ناو|اسم/i) : firstRow(NAME_HEADING);
  const named = head >= 0 ? grid[head].findIndex(c=>heading(c, /name|ناو|اسم/i)) : -1;
  const nameCol = named >= 0 ? named : head >= 0 ? grid[head].findIndex(c=>heading(c, NAME_HEADING)) : 0;
  const unitCol = head >= 0 ? grid[head].findIndex(c=>heading(c, UNIT_HEADING)) : -1;
  const split = v=>String(v || '').split(/[,،|/;؛]+/).map(s=>s.trim()).filter(s=>s && s.length <= 40);
  const seen = new Set(), items = [];
  for(const r of grid.slice(head + 1)){
    const name = (r[nameCol] || '').slice(0, 200);
    if(!name || seen.has(name.toLocaleLowerCase())) continue;
    seen.add(name.toLocaleLowerCase());
    items.push({name, units: unitCol >= 0 ? [...new Set(split(r[unitCol]))].slice(0, 20) : []});
  }
  const unitSheet = book.SheetNames.find(n=>/^units?$|یەکەکان|الوحدات/i.test(n.trim()));
  const sheetUnits = unitSheet && unitSheet !== sheetName ? reader.utils.sheet_to_json(book.Sheets[unitSheet], {header:1, defval:'', raw:false}).slice(1).map(r=>String(r[0] || '').trim()).filter(Boolean) : [];
  return {items: items.slice(0, 5000), units:[...new Set([...items.flatMap(i=>i.units), ...sheetUnits])]};
}
async function openStockListImport(file){
  let parsed;
  try{ parsed = await readStockListFile(file); }
  catch(e){ await showAlert(esc(e?.message || t('trListNoName'))); return; }
  if(!parsed.items.length){ await showAlert(esc(t('trListNoName'))); return; }
  // An item list without its own units may still name the units on a "Units" sheet: every item may use them.
  const items = parsed.items.map(i=>({name:i.name, units:i.units.length ? i.units : (parsed.items.every(x=>!x.units.length) ? parsed.units.slice(0, 20) : [])}));
  await showFormModal({
    title: esc(t('trListTitle')),
    bodyHtml: `<p class="notif-sub">${esc(t('trListPreview')(items.length, parsed.units.length))}</p><div class="import-preview tr-import">${items.slice(0, 8).map(i=>`<div class="import-row"><b dir="auto">${esc(i.name)}</b><small>${esc(i.units.join(' · '))}</small></div>`).join('')}${items.length > 8 ? `<div class="import-row"><small>+${items.length - 8}</small></div>` : ''}</div>`,
    okLabel: t('trListSave'),
    onSubmit: async ()=>{
      const r = await api('stock-items', {method:'PUT', body:{items}, timeout:30000});
      if(!r.ok) return {error:t('saveFailed')};
      await loadStockItems(true);
      // Rows already on the list are matched again against the new names.
      transfer.rows.forEach(row=>{ if(!stockItem(row.itemId)){ const m = matchStockLocally(row.said); row.itemId = m.itemId; row.sure = m.sure; row.suggestions = m.suggestions; } });
      saveTransfer(); render(); toast(t('trListSaved'));
      return {};
    },
  });
}

/* ---------- The Excel file ----------
   Made here, styled: a dark green header row, banded rows with thin borders, a frozen header and
   dropdowns of the workplace items and units. The sheets are those of the stock system's own template
   (Transfer, Item list, Units, How to fill); the first row stays exactly "Item name, Amount, Unit". */
function makeTransferExcel(){
  const bad = transfer.rows.filter(rowIssue);
  if(!transfer.rows.length || bad.length) return;
  try{
    const at = new Date(), rows = transfer.rows.map(r=>({name:stockItem(r.itemId)?.name || r.said, amount:r.amount, unit:r.unit}));
    const data = transferWorkbook(rows, {items:(stockList.items || []).map(i=>i.name), units:stockUnits(), at});
    const day = erbilDate(at.toISOString()), time = FILE_TIME.format(at).replace(/\D/g, '');
    return deliverFile(new Blob([data], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `transfer-${day}-${time}.xlsx`).then(done=>{ if(done) toast(t('trReady')); });
  }catch(e){ console.error('Transfer Excel', e); return showAlert(esc(t('trMakeFailed'))); }
}
const FILE_TIME = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Baghdad', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
/* Hands a file to the person: the share sheet on a phone (Save to Files, WhatsApp...), a download on a computer. */
async function deliverFile(blob, name){
  const file = typeof File === 'function' ? new File([blob], name, {type:blob.type}) : null;
  if(file && matchMedia('(pointer: coarse)').matches && navigator.canShare?.({files:[file]})){
    try{ await navigator.share({files:[file], title:name}); return true; }
    catch(e){ if(e?.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
  return true;
}
const xmlText = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function sheetXml(header, body, {widths, tab, frozen, validations = [], headerText = ''}){
  const cols = 'ABC';
  const cell = (c, r, v, s) => typeof v === 'number' ? `<c r="${cols[c]}${r}" s="${s}"><v>${v}</v></c>` : `<c r="${cols[c]}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
  const rows = [`<row r="1" ht="26" customHeight="1">${header.map((h, c)=>cell(c, 1, h, 1)).join('')}</row>`]
    .concat(body.map((line, i)=>{ const band = i % 2 === 1; return `<row r="${i + 2}" ht="22" customHeight="1">${line.map((v, c)=>cell(c, i + 2, v, c === 0 ? (band ? 3 : 2) : (band ? 5 : 4))).join('')}</row>`; }));
  const last = cols[header.length - 1] + (body.length + 1);
  return XML_HEAD + `<worksheet ${SHEET_NS}>` +
    (tab ? `<sheetPr><tabColor rgb="${tab}"/></sheetPr>` : '') +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${frozen ? ' tabSelected="1"' : ''}>${frozen ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ''}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="20"/>' +
    `<cols>${widths.map((w, i)=>`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (validations.length ? `<dataValidations count="${validations.length}">${validations.map(v=>`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" sqref="${v.ref}"><formula1>${xmlText(v.list)}</formula1></dataValidation>`).join('')}</dataValidations>` : '') +
    '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    (headerText ? `<headerFooter><oddHeader>${xmlText('&L&"-,Bold"Ricotta&R' + headerText)}</oddHeader><oddFooter>${xmlText('&C&P / &N')}</oddFooter></headerFooter>` : '') +
    '</worksheet>';
}
const TRANSFER_STYLES = XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><sz val="12"/><color rgb="FF14382C"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  // Plain rows are filled white too, so the dark text stays readable in a viewer's dark mode.
  '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F5C3F"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF6F0"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFC9DCCF"/></left><right style="thin"><color rgb="FFC9DCCF"/></right><top style="thin"><color rgb="FFC9DCCF"/></top><bottom style="thin"><color rgb="FFC9DCCF"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>';
const HOW_TO_FILL = [
  'One row per item. Do not change the column names in row 1.',
  'Item name: pick from the dropdown. The list comes from the stock system, so the spelling is always exact.',
  'Amount: numbers only. Use a dot for decimals, e.g. 1.5',
  'Unit: pick from the dropdown.',
  'From storage and To storage are chosen on the page, not in this file.',
  'Made with Ricotta Orders.',
];
/* The .xlsx file (a zip of XML parts) for these rows. items/units fill the dropdown sheets. */
function transferWorkbook(rows, {items = [], units = [], at = new Date()} = {}){
  const stamp = formatIraqDateTime(at, {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  const list = [...new Set(items)], unitList = [...new Set(units)];
  const reach = Math.max(rows.length + 1, 200);
  const validations = [
    ...(list.length ? [{ref:`A2:A${reach}`, list:`'Item list'!$A$2:$A$${list.length + 1}`}] : []),
    ...(unitList.length ? [{ref:`C2:C${reach}`, list:`Units!$A$2:$A$${unitList.length + 1}`}] : []),
  ];
  const sheets = [
    ['Transfer', sheetXml(['Item name', 'Amount', 'Unit'], rows.map(r=>[r.name, Number(r.amount), r.unit]), {widths:[48, 12, 14], tab:'FF1F5C3F', frozen:true, validations, headerText:'Transfer · ' + stamp})],
    ['Item list', sheetXml(['Item name'], list.map(n=>[n]), {widths:[56], frozen:false})],
    ['Units', sheetXml(['Unit'], unitList.map(u=>[u]), {widths:[18], frozen:false})],
    ['How to fill', sheetXml(['How to fill'], HOW_TO_FILL.map(l=>[l]), {widths:[96], frozen:false})],
  ];
  const created = at.toISOString().replace(/\.\d+Z$/, 'Z');
  const parts = [
    ['[Content_Types].xml', XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i)=>`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ['_rels/.rels', XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
    ['docProps/core.xml', XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Ricotta transfer</dc:title><dc:creator>Ricotta Orders</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`],
    ['xl/workbook.xml', XML_HEAD + `<workbook ${SHEET_NS}><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map(([name], i)=>`<sheet name="${xmlText(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i)=>`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', TRANSFER_STYLES],
    ...sheets.map(([, xml], i)=>[`xl/worksheets/sheet${i + 1}.xml`, xml]),
  ];
  return zipStore(parts);
}
/* A zip with stored (uncompressed) files: all an .xlsx needs, with no library. */
const CRC_TABLE = (()=>{ const table = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(bytes){ let c = 0xFFFFFFFF; for(let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files){
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF], u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  const DATE = 0x21; // 1980-01-01, a fixed stamp keeps the bytes the same for the same rows
  for(const [name, content] of files){
    const nameBytes = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content, crc = crc32(data);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(DATE), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)];
    chunks.push(Uint8Array.from(local), nameBytes, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(DATE), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, c)=>n + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end], out = new Uint8Array(all.reduce((n, c)=>n + c.length, 0));
  let at = 0;
  for(const c of all){ out.set(c, at); at += c.length; }
  return out;
}
