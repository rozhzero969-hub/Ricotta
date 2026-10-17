/* Ordering conveniences. These helpers are loaded before app.js; they only
   access the signed-in account and workspace when a screen is opened. */
const ORDERING_TEXT = {
  en: {
    deviceInUse: "This browser is still signed in to another account. Sign out there first.",
    orderSounds: "Order sounds",
    quantitySound: "Quantity + / − taps",
    sentSound: "Order sent chime",
    manage: "Manage",
    catalog: "Catalog",
    workspaceTools: "History & settings",
    orderOptions: "Order options",
    moreTools: "More tools",
    guideManage: "Your items, suppliers and units in one place.",
    catalogNoResults: "No matches found",
    securityCheck: "Quick security check",
    securityCheckHint: "Verify this sign-in to continue.",
    securityCheckFailed: "The security check could not finish. Please try again.",
    securityContinue: "Continue",
    aliasChanges: "Update search names",
    aliasConflict: "These names changed on another device. Ask Rico for a fresh preview.",
    searchHint: "Search names, English aliases or details. Small typos are okay.",
    clearSearch: "Clear search",
    searchMatches: "Matches",
    quantityLimit:
      "Use quantities between 0.001 and 99999, with up to 3 decimal places.",
    adjustQuantities: "Adjust quantities",
    orderNote: "Order note",
    orderNoteHint:
      "This message is included with every supplier in this order.",
    doubleQty: "Double quantities",
    halfQty: "Halve quantities",
    availableToOrder: "Available to order",
    unavailable: "Unavailable",
    searchAliases: "Other names for search",
    aliasesHint:
      "Separate names or spellings with commas. These names are not sent to suppliers.",
    importItems: "Import Excel / CSV",
    importHint:
      "Columns: Name, Unit, Supplier. Optional: ID, Aliases, Available, Note. Maximum 500 rows, 2 MB. Review before saving.",
    chooseFile: "Choose a spreadsheet",
    importPreview: "Review items",
    importInvalid: "Check the highlighted rows before importing.",
    importSaved: "Items imported",
    messageFormat: "WhatsApp message",
    restaurantName: "Restaurant name",
    greeting: "Opening message",
    closing: "Closing message",
    messageHint:
      "Optional text included with each supplier order. Leave blank to use the usual Ricotta message.",
    callSupplier: "Call",
    contactSupplier: "WhatsApp",
    catalogSearch: "Search this list…",
    quantityChanged: "Quantities updated",
    importRow: "Row",
    importError: "Name, unit or supplier is missing or unknown.",
    importDuplicate: "Duplicate item; use an ID or a unique name and supplier.",
    importFailure: "Import paused. Saved rows are kept. Retry to continue.",
    guideOrder:
      "Choose your items and quantities, then send the order through WhatsApp.",
    guideAssistant: "Ask Rico for help with your order or your kitchen.",
    guideHistory:
      "Find this month’s orders, repeat an order, or save a report.",
    guideQueue: "Open each supplier’s WhatsApp message to send your order.",
    guideSuppliers: "Manage supplier details, contact them, and set reminders.",
    guideItems: "Manage the items you order, their units and availability.",
    guideUnits: "Set the units used for quantities, such as kg, box or litre.",
    guideRecord: "See who added, changed or removed items and suppliers.",
    guideDevices: "See signed-in devices and control their access.",
    guideSettings: "Adjust the WhatsApp message, appearance, sounds and notifications.",
  },
  ku: {
    deviceInUse: "ئەم وێبگەڕە هێشتا بە هەژمارێکی تر چووەتە ژوورەوە. سەرەتا لەوێ بچۆ دەرەوە.",
    orderSounds: "دەنگەکانی داواکاری",
    quantitySound: "دەنگی زیاد و کەمکردنی بڕ",
    sentSound: "دەنگی ناردنی داواکاری",
    manage: "بەڕێوەبردن",
    catalog: "کاڵاکان",
    workspaceTools: "مێژوو و ڕێکخستنەکان",
    orderOptions: "هەڵبژاردەکانی داواکاری",
    moreTools: "ئامرازی زیاتر",
    guideManage: "کاڵا، دابینکەر و یەکەکانت لە یەک شوێن.",
    catalogNoResults: "هیچ ئەنجامێک نەدۆزرایەوە",
    securityCheck: "پشکنینی خێرای ئاسایش",
    securityCheckHint: "بۆ بەردەوامبوون، ئەم چوونەژوورەوەیە پشتڕاست بکەرەوە.",
    securityCheckFailed: "پشکنینی ئاسایش تەواو نەبوو. تکایە دووبارە هەوڵ بدەرەوە.",
    securityContinue: "بەردەوامبوون",
    aliasChanges: "نوێکردنەوەی ناوەکانی گەڕان",
    aliasConflict: "ئەم ناوانە لە ئامێرێکی تر گۆڕاون. لە ریکۆ داوای پێشبینینێکی نوێ بکە.",
    searchHint: "بە ناو، ناوی ئینگلیزی یان وردەکاری بگەڕێ. هەڵەی بچووک لە نووسین ئاساییە.",
    clearSearch: "پاککردنەوەی گەڕان",
    searchMatches: "ئەنجامەکان",
    quantityLimit:
      "بڕەکان لە نێوان 0.001 و 99999 بن، بە زۆرترین 3 ژمارە دوای خاڵ.",
    adjustQuantities: "ڕێکخستنی بڕەکان",
    orderNote: "تێبینی داواکاری",
    orderNoteHint: "ئەم پەیامە لەگەڵ داواکاریی هەموو دابینکەرەکان دەنێردرێت.",
    doubleQty: "دوو هێندەکردنی بڕەکان",
    halfQty: "نیوەکردنی بڕەکان",
    availableToOrder: "بەردەستە بۆ داواکردن",
    unavailable: "بەردەست نییە",
    searchAliases: "ناوی تر بۆ گەڕان",
    aliasesHint:
      "ناوەکان بە کۆما جیا بکەرەوە. ئەم ناوانە بۆ دابینکەر نانێردرێن.",
    importItems: "هاوردەی Excel / CSV",
    importHint:
      "ستوونەکان: Name, Unit, Supplier. ئارەزوومەندانە: ID, Aliases, Available, Note. زۆرترین 500 ڕیز و 2 MB. پێش پاشەکەوتکردن بپشکنە.",
    chooseFile: "فایلێکی خشتە هەڵبژێرە",
    importPreview: "پشکنینی کاڵاکان",
    importInvalid: "پێش هاوردەکردن ڕیزە دیاریکراوەکان بپشکنە.",
    importSaved: "کاڵاکان هاوردە کران",
    messageFormat: "پەیامی واتساپ",
    restaurantName: "ناوی چێشتخانە",
    greeting: "پەیامی سەرەتا",
    closing: "پەیامی کۆتایی",
    messageHint:
      "دەقی ئارەزوومەندانە بۆ هەر داواکارییەک. بۆ پەیامی ئاسایی ریکۆتا بە بەتاڵی بهێڵەوە.",
    callSupplier: "پەیوەندی",
    contactSupplier: "واتساپ",
    catalogSearch: "لە لیستەکە بگەڕێ…",
    quantityChanged: "بڕەکان نوێ کرانەوە",
    importRow: "ڕیز",
    importError: "ناو، یەکە یان دابینکەر نەنووسراوە یان نەناسراوە.",
    importDuplicate:
      "کاڵای دووبارە؛ ID یان ناو و دابینکەرێکی تایبەت بەکاربهێنە.",
    importFailure:
      "هاوردە ڕاگیرا. ڕیزە پاشەکەوتکراوەکان دەمێننەوە. دووبارە هەوڵبدەرەوە.",
    guideOrder: "کاڵا و بڕەکان هەڵبژێرە، پاشان بە واتساپ داواکاری بنێرە.",
    guideAssistant: "بۆ داواکاری یان چێشتخانەکەت داوای یارمەتی لە ڕیکۆ بکە.",
    guideHistory:
      "داواکارییەکانی ئەم مانگە ببینە، دووبارەیان بکەرەوە یان ڕاپۆرت پاشەکەوت بکە.",
    guideQueue: "پەیامی واتساپی هەر دابینکەرێک بکەرەوە بۆ ناردنی داواکاری.",
    guideSuppliers:
      "زانیاریی دابینکەرەکان و بیرخەرەوەکان بەڕێوەببە و پەیوەندییان پێوە بکە.",
    guideItems: "کاڵاکان، یەکەکان و بەردەستییان بەڕێوەببە.",
    guideUnits: "یەکەی بڕەکان دیاری بکە، وەک کیلۆ، سندوق یان لیتر.",
    guideRecord: "ببینە کێ کاڵا و دابینکەری زیاد، گۆڕیو یان سڕیوەتەوە.",
    guideDevices: "ئامێرە چووەژوورەوەکان ببینە و دەستگەیشتنیان بەڕێوەببە.",
    guideSettings: "پەیامی واتساپ، ڕووکار، دەنگ و ئاگادارکردنەوەکان ڕێکبخە.",
  },
  ar: {
    deviceInUse: "هذا المتصفح مسجل الدخول بحساب آخر. سجّل الخروج منه أولاً.",
    orderSounds: "أصوات الطلب",
    quantitySound: "نقرات زيادة وتقليل الكمية",
    sentSound: "نغمة إرسال الطلب",
    manage: "إدارة",
    catalog: "الكتالوج",
    workspaceTools: "السجل والإعدادات",
    orderOptions: "خيارات الطلب",
    moreTools: "أدوات إضافية",
    guideManage: "الأصناف والموردون والوحدات في مكان واحد.",
    catalogNoResults: "لم يتم العثور على نتائج",
    securityCheck: "تحقق أمني سريع",
    securityCheckHint: "تحقق من تسجيل الدخول للمتابعة.",
    securityCheckFailed: "تعذّر إكمال التحقق الأمني. حاول مرة أخرى.",
    securityContinue: "متابعة",
    aliasChanges: "تحديث أسماء البحث",
    aliasConflict: "تغيّرت هذه الأسماء على جهاز آخر. اطلب معاينة جديدة من ريكو.",
    searchHint: "ابحث بالاسم أو الأسماء الإنجليزية أو التفاصيل. الأخطاء البسيطة مقبولة.",
    clearSearch: "مسح البحث",
    searchMatches: "النتائج",
    quantityLimit: "استخدم كميات بين 0.001 و99999، حتى 3 منازل عشرية.",
    adjustQuantities: "تعديل الكميات",
    orderNote: "ملاحظة الطلب",
    orderNoteHint: "تُضاف هذه الرسالة إلى طلب كل مورد.",
    doubleQty: "مضاعفة الكميات",
    halfQty: "تنصيف الكميات",
    availableToOrder: "متاح للطلب",
    unavailable: "غير متاح",
    searchAliases: "أسماء أخرى للبحث",
    aliasesHint: "افصل الأسماء بفواصل. لا تُرسل هذه الأسماء إلى الموردين.",
    importItems: "استيراد Excel / CSV",
    importHint:
      "الأعمدة: Name, Unit, Supplier. اختياري: ID, Aliases, Available, Note. حتى 500 صف و2 MB. راجع قبل الحفظ.",
    chooseFile: "اختيار جدول",
    importPreview: "مراجعة الأصناف",
    importInvalid: "راجع الصفوف المحددة قبل الاستيراد.",
    importSaved: "تم استيراد الأصناف",
    messageFormat: "رسالة واتساب",
    restaurantName: "اسم المطعم",
    greeting: "رسالة البداية",
    closing: "رسالة الختام",
    messageHint:
      "نص اختياري لكل طلب مورد. اتركه فارغاً لاستخدام رسالة ريكوتا المعتادة.",
    callSupplier: "اتصال",
    contactSupplier: "واتساب",
    catalogSearch: "ابحث في هذه القائمة…",
    quantityChanged: "تم تحديث الكميات",
    importRow: "صف",
    importError: "الاسم أو الوحدة أو المورد مفقود أو غير معروف.",
    importDuplicate: "صنف مكرر؛ استخدم ID أو اسماً ومورداً فريدين.",
    importFailure:
      "توقف الاستيراد. الصفوف المحفوظة باقية. أعد المحاولة للمتابعة.",
    guideOrder: "اختر الأصناف والكميات، ثم أرسل الطلب عبر واتساب.",
    guideAssistant: "اطلب مساعدة ريكو في طلبك أو مطبخك.",
    guideHistory: "راجع طلبات هذا الشهر أو كرر طلباً أو احفظ تقريراً.",
    guideQueue: "افتح رسالة واتساب لكل مورد لإرسال طلبك.",
    guideSuppliers: "أدر بيانات الموردين وتواصل معهم واضبط التذكيرات.",
    guideItems: "أدر الأصناف ووحداتها ومدى توفرها للطلب.",
    guideUnits: "حدد وحدات الكميات مثل كغ أو صندوق أو لتر.",
    guideRecord: "اعرف من أضاف أو عدل أو حذف الأصناف والموردين.",
    guideDevices: "راجع الأجهزة المسجلة وتحكم في وصولها.",
    guideSettings: "اضبط رسالة واتساب والمظهر والأصوات والإشعارات.",
  },
};
for (const lang of ["en", "ku", "ar"]) {
  Object.assign(T[lang], ORDERING_TEXT[lang]);
  if(T[lang].ricoStatus)T[lang].ricoStatus.propose_item_aliases=ORDERING_TEXT[lang].aliasChanges;
}
function roundQuantity(q) {
  return Math.round(Math.min(99999, Math.max(0, Number(q) || 0)) * 1000) / 1000;
}
function readQuantity(value) {
  return roundQuantity(foldText(String(value)).replace(/[٫,]/g, "."));
}
function validOrderQuantity(q) {
  return (
    Number.isFinite(q) &&
    q >= 0 &&
    q <= 99999 &&
    Math.abs(q * 1000 - Math.round(q * 1000)) < 0.00001
  );
}
function parseAliases(text) {
  return [
    ...new Set(
      String(text || "")
        .split(/[,،\n]/)
        .map((x) => x.trim().slice(0, 120))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}
function viewGuide(view) {
  return t(
    "guide" +
      ({
        order: "Order",
        manage: "Manage",
        assistant: "Assistant",
        history: "History",
        queue: "Queue",
        suppliers: "Suppliers",
        itemsAdmin: "Items",
        units: "Units",
        record: "Record",
        devices: "Devices",
        settings: "Settings",
      }[view] || "Order"),
  );
}
function renderOrderTools() {
  return `<div class="order-tools"><button type="button" class="btn btn-ghost" id="orderNoteBtn">${esc(t("orderNote"))}${state.orderNote ? " •" : ""}</button><details><summary>${esc(t("adjustQuantities"))}</summary><div class="form-actions"><button type="button" class="btn btn-ghost" data-scale-order="2">${esc(t("doubleQty"))}</button><button type="button" class="btn btn-ghost" data-scale-order="0.5">${esc(t("halfQty"))}</button></div></details></div><p id="orderNotePreview" class="order-note-preview" dir="auto" ${state.orderNote ? "" : "hidden"}>${esc(state.orderNote || "")}</p>`;
}
function attachOrderTools() {
  const note = document.getElementById("orderNoteBtn");
  if (note)
    note.onclick = () =>
      showFormModal({
        title: t("orderNote"),
        bodyHtml: `<div class="field"><label for="wholeOrderNote">${esc(t("orderNoteHint"))}</label><textarea id="wholeOrderNote" maxlength="300" rows="3" dir="auto">${esc(state.orderNote || "")}</textarea></div>`,
        onSubmit: async () => {
          state.orderNote = document
            .getElementById("wholeOrderNote")
            .value.trim();
          lset("orderNote:" + state.account, state.orderNote);
          persistCartDraft();
          render();
          return {};
        },
      });
  document.querySelectorAll("[data-scale-order]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!cartCount()) return;
        const factor = Number(b.dataset.scaleOrder);
        if (
          Object.values(state.cart).some(
            (q) => q > 0 && !validOrderQuantity(q * factor),
          )
        ) {
          await showAlert(t("quantityLimit"));
          return;
        }
        if (
          !(await showConfirm(t(factor === 2 ? "doubleQty" : "halfQty") + "?"))
        )
          return;
        const before = { ...state.cart };
        state.cart = Object.fromEntries(
          Object.entries(state.cart)
            .map(([id, q]) => [id, roundQuantity(q * factor)])
            .filter(([, q]) => q > 0),
        );
        refreshOrderView();
        toast(t("quantityChanged"), "ok", {
          undo: () => {
            state.cart = before;
            refreshOrderView();
          },
        });
      }),
  );
}
function renderMessageSettings() {
  const f = state.messageFormat || {};
  return `<details class="settings-group"><summary>${esc(t("messageFormat"))}</summary><p class="field-hint">${esc(t("messageHint"))}</p><div class="field"><label for="messageRestaurant">${esc(t("restaurantName"))}</label><input id="messageRestaurant" maxlength="80" dir="auto" value="${esc(f.restaurant || "")}"></div><div class="field"><label for="messageGreeting">${esc(t("greeting"))}</label><textarea id="messageGreeting" rows="2" maxlength="200" dir="auto">${esc(f.greeting || "")}</textarea></div><div class="field"><label for="messageClosing">${esc(t("closing"))}</label><textarea id="messageClosing" rows="2" maxlength="200" dir="auto">${esc(f.closing || "")}</textarea></div><button type="button" class="btn btn-primary" id="messageFormatSave">${esc(t("save"))}</button></details>`;
}
function attachMessageSettings() {
  const b = document.getElementById("messageFormatSave");
  if (b)
    b.onclick = () =>
      withBusy(b, async () => {
        const body = {
          restaurant: document.getElementById("messageRestaurant").value.trim(),
          greeting: document.getElementById("messageGreeting").value.trim(),
          closing: document.getElementById("messageClosing").value.trim(),
        };
        const r = await api("me/message-format", { method: "PUT", body });
        if (!r.ok) {
          await showAlert(t("saveFailed"));
          return;
        }
        state.messageFormat = body;
        toast(t("savedMsg")(t("messageFormat")));
      });
}
function supplierContactLinks(s) {
  if (!foldText(String(s.phone || "")).replace(/\D/g, "")) return "";
  const chat = waLink(s.phone, ""),
    phone = chat.match(/(?:phone=|wa\.me\/)(\d+)/)?.[1];
  if (!phone || phone.length < 7) return "";
  return `<a class="btn btn-ghost supplier-contact" data-contact href="${esc(chat)}"${waOpensApp() ? "" : ' target="_blank" rel="noopener noreferrer"'} aria-label="${esc(t("contactSupplier") + " · " + s.name)}">${ICON_CHAT}<span>${esc(t("contactSupplier"))}</span></a><a class="btn btn-ghost supplier-contact" data-contact href="tel:+${phone}" aria-label="${esc(t("callSupplier") + " · " + s.name)}">${ICON_PHONE}<span>${esc(t("callSupplier"))}</span></a>`;
}
function catalogMatches(text) {
  return Number.isFinite(globalThis.RicottaSearch.score(state.catalogQuery,text));
}
function itemSearchFields(item) {
  return [item.name,...(item.aliases||[]),supplierName(item.supplierId),unitLabel(item.unit),item.note||''];
}
function recordSearchFields(a) {
  return [a.name,a.by,a.actor,a.action,a.type,({add:t('actionAdded'),edit:t('actionEdited'),delete:t('actionDeleted')})[a.action],({supplier:t('typeSupplier'),item:t('typeItem'),unit:t('typeUnit')})[a.type],formatIraqDateTime(a.ts,{year:'numeric',month:'short',day:'numeric'}),...(a.fields||[]).flatMap(f=>[recordFieldLabel(f.k),f.from,f.to]),...state.items.filter(i=>i.name===a.name).flatMap(i=>i.aliases||[])].join(' ');
}
function renderCatalogSearch() {
  return `<div class="list-search"><div class="search-wrap catalog-search">${ICON_SEARCH}<input id="catalogSearch" type="search" aria-label="${esc(t('catalogSearch'))}" placeholder="${esc(t('catalogSearch'))}" value="${esc(state.catalogQuery||'')}"><button type="button" class="search-clear" id="catalogSearchClear" aria-label="${esc(t('clearSearch'))}">&times;</button></div><div id="catalogSearchCount" class="search-count" role="status" aria-live="polite"></div></div>`;
}
function attachCatalogSearch() {
  const search=document.getElementById('catalogSearch');
  if(search){
    const apply=()=>{
      state.catalogQuery=search.value;
      const rows=[...document.querySelectorAll('.list-row,.unit-chip,[data-search-row]')];
      let shown=0;
      const scored=rows.map((row,index)=>{
        const item=state.items.find(i=>i.id===row.dataset.edititem);
        const fields=item?itemSearchFields(item):row.dataset.searchText||row.textContent;
        const score=globalThis.RicottaSearch.score(search.value,fields);
        row.hidden=!Number.isFinite(score);if(!row.hidden)shown++;
        if(!row.dataset.searchOrder)row.dataset.searchOrder=String(index+1);
        return {row,index:Number(row.dataset.searchOrder),score};
      });
      if(['manage','suppliers','itemsAdmin'].includes(state.view))scored.sort((a,b)=>a.score-b.score||a.index-b.index).forEach(x=>x.row.parentNode.appendChild(x.row));
      document.getElementById('catalogSearchCount').textContent=search.value.trim()?`${t('searchMatches')}: ${shown} / ${rows.length}`:'';
      let empty=document.getElementById('catalogSearchEmpty');
      if(!empty){empty=document.createElement('div');empty.id='catalogSearchEmpty';search.closest('.list-search').after(empty);}
      empty.innerHTML=emptyState(t('catalogNoResults'));empty.hidden=state.view==='record' || shown>0 || !search.value.trim();
      document.getElementById('catalogSearchClear').hidden=!search.value;
      if(state.view==='history')document.querySelectorAll('.hist-day').forEach(h=>h.hidden=!!search.value.trim());
    };
    search.oninput=apply;apply();
    document.getElementById('catalogSearchClear').onclick=()=>{search.value='';if(state.view==='record'){state.catalogQuery='';state.recordLimit=RECORD_PAGE_SIZE;refreshRecordResults();search.focus();}else{apply();search.focus();}};
  }
  const button=document.getElementById('itemImportBtn');if(button)button.onclick=openItemImport;
}
let spreadsheetLoad;
function loadSpreadsheetReader() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!spreadsheetLoad)
    spreadsheetLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/xlsx-0.20.3.min.js";
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => {
        spreadsheetLoad = null;
        reject(new Error("Spreadsheet reader unavailable"));
      };
      document.head.appendChild(script);
    });
  return spreadsheetLoad;
}
function previewImportRows(rows) {
  const seen = new Set();
  return rows.map((row, index) => {
    const values = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          String(k).trim().toLowerCase(),
          String(v ?? "").trim(),
        ]),
      ),
      name = values.name || "",
      units = state.units.filter((u) =>
        [u.id, u.en, u.ku, u.ar].some(
          (v) => v && foldText(v) === foldText(values.unit),
        ),
      ),
      suppliers = state.suppliers.filter((s) =>
        [s.id, s.name].some((v) => foldText(v) === foldText(values.supplier)),
      ),
      unit = units.length === 1 ? units[0] : null,
      supplier = suppliers.length === 1 ? suppliers[0] : null,
      matches = state.items.filter(
        (i) =>
          foldText(i.name) === foldText(name) && i.supplierId === supplier?.id,
      ),
      existing = values.id
        ? state.items.find((i) => i.id === values.id)
        : matches.length === 1
          ? matches[0]
          : null,
      key = values.id || foldText(name) + "|" + supplier?.id;
    let error =
      !name || name.length > 160 || !unit || !supplier
        ? t("importError")
        : seen.has(key) ||
            (matches.length > 1 && !values.id) ||
            (values.id && !existing)
          ? t("importDuplicate")
          : "";
    seen.add(key);
    const rawAvailable = (values.available || "").toLowerCase();
    if (
      rawAvailable &&
      !["true", "false", "yes", "no", "1", "0"].includes(rawAvailable)
    )
      error = t("importError");
    return {
      row: index + 2,
      error,
      item: {
        ...(existing || {}),
        id: existing?.id || "i" + outboxJobId(),
        name,
        unit: unit?.id,
        supplierId: supplier?.id,
        aliases: Object.hasOwn(values, "aliases")
          ? parseAliases(values.aliases)
          : existing?.aliases || [],
        available: rawAvailable
          ? !["false", "no", "0"].includes(rawAvailable)
          : existing?.available !== false,
        note: Object.hasOwn(values, "note")
          ? values.note.slice(0, 120)
          : existing?.note || "",
      },
    };
  });
}
function openItemImport() {
  let preview = [],
    saved = new Set(),
    selection = 0;
  const session = apiSession(),
    account = state.account;
  showFormModal({
    title: t("importItems"),
    bodyHtml: `<p class="field-hint">${esc(t("importHint"))}</p><div class="field"><label for="itemImportFile">${esc(t("chooseFile"))}</label><input id="itemImportFile" type="file" accept=".xlsx,.csv"></div><div id="importPreview" class="import-preview" aria-live="polite"></div>`,
    okLabel: t("importItems"),
    onOpen: (box) => {
      box.querySelector("#modalFormOk").disabled = true;
      box.querySelector("#itemImportFile").onchange = async (e) => {
        const generation = ++selection;
        preview = [];
        saved = new Set();
        const output = box.querySelector("#importPreview"),
          ok = box.querySelector("#modalFormOk");
        ok.disabled = true;
        const file = e.target.files[0];
        if (!file) return;
        try {
          if (file.size > 2 * 1024 * 1024) throw new Error(t("importHint"));
          const reader = await loadSpreadsheetReader(),
            book = reader.read(await file.arrayBuffer(), {
              type: "array",
              sheetRows: 502,
              cellFormula: false,
            }),
            rows = reader.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
              defval: "",
            });
          if (!rows.length || rows.length > 500)
            throw new Error(t("importHint"));
          if (generation !== selection || !box.isConnected) return;
          preview = previewImportRows(rows);
          output.innerHTML =
            `<h3>${esc(t("importPreview"))} (${preview.length})</h3>` +
            preview
              .map(
                (p) =>
                  `<div class="import-row${p.error ? " invalid" : ""}"><span>${esc(t("importRow"))} ${p.row}</span><b dir="auto">${esc(p.item.name)}</b><small>${esc(p.error || supplierName(p.item.supplierId) + " · " + unitLabel(p.item.unit))}</small></div>`,
              )
              .join("");
          ok.disabled = preview.some((p) => p.error);
        } catch (error) {
          if (generation !== selection || !box.isConnected) return;
          output.textContent = error.message || t("importInvalid");
        }
      };
    },
    onSubmit: async () => {
      if (!preview.length || preview.some((p) => p.error))
        return { error: t("importInvalid") };
      for (const p of preview) {
        if (state.account !== account || !apiSessionMatches(session))
          return { error: t("sessionEnded") };
        if (saved.has(p.item.id)) continue;
        if (!(await saveRecord("items", p.item)))
          return { error: t("importFailure") };
        if (state.account !== account || !apiSessionMatches(session))
          return { error: t("sessionEnded") };
        saved.add(p.item.id);
        const old = state.items.find((i) => i.id === p.item.id);
        if (old) Object.assign(old, p.item);
        else state.items.push(p.item);
      }
      render();
      toast(t("importSaved"));
      return {};
    },
  });
}

/* ---------- Excel for the workplace stock system ----------
   The stock system's "Upload Excel" (Move stock between storages) reads one
   sheet named "Transfer" with exactly three columns: Item name, Amount, Unit.
   Each item can say how it is written there (Manage → item → Stock system);
   otherwise its own name, unit and amount are used. The stock system matches
   names itself and marks anything it does not know, so nothing moves by guess. */
const STOCK_TEXT = {
  en: {
    stockExcel: "Excel for stock",
    stockExcelReady: "Excel file ready",
    stockExcelFailed: "The Excel file could not be made. Please try again.",
    stockSection: "Stock system (Excel)",
    stockSectionHint: "How this item is written in the workplace stock system. Leave empty to use the item's own name and unit.",
    stockName: "Name in the stock system",
    stockUnit: "Unit in the stock system",
    stockUnitSame: "Same as the order unit",
    stockFactor: "Stock units in one order unit",
    stockFactorHint: "For example 1 box = 20 kg: write 20.",
    stockFactorInvalid: "Write how many stock units are in one order unit (a number above 0).",
  },
  ku: {
    stockExcel: "Excel بۆ کۆگا",
    stockExcelReady: "فایلی Excel ئامادەیە",
    stockExcelFailed: "فایلی Excel دروست نەکرا. تکایە دووبارە هەوڵ بدەرەوە.",
    stockSection: "سیستەمی کۆگا (Excel)",
    stockSectionHint: "ئەم کاڵایە لە سیستەمی کۆگای شوێنی کار چۆن نووسراوە. بە بەتاڵی بهێڵەوە بۆ بەکارهێنانی ناو و یەکەی خۆی.",
    stockName: "ناو لە سیستەمی کۆگا",
    stockUnit: "یەکە لە سیستەمی کۆگا",
    stockUnitSame: "هەمان یەکەی داواکاری",
    stockFactor: "چەند یەکەی کۆگا لە یەک یەکەی داواکاریدا",
    stockFactorHint: "بۆ نموونە 1 سندوق = 20 کیلۆ: 20 بنووسە.",
    stockFactorInvalid: "بنووسە چەند یەکەی کۆگا لە یەک یەکەی داواکاریدا هەیە (ژمارەیەک لە 0 زیاتر).",
  },
  ar: {
    stockExcel: "Excel للمخزن",
    stockExcelReady: "ملف Excel جاهز",
    stockExcelFailed: "تعذّر إنشاء ملف Excel. حاول مرة أخرى.",
    stockSection: "نظام المخزن (Excel)",
    stockSectionHint: "كيف تُكتب هذه المادة في نظام مخزن العمل. اتركه فارغاً لاستخدام اسمها ووحدتها.",
    stockName: "الاسم في نظام المخزن",
    stockUnit: "الوحدة في نظام المخزن",
    stockUnitSame: "نفس وحدة الطلب",
    stockFactor: "وحدات المخزن في وحدة طلب واحدة",
    stockFactorHint: "مثلاً 1 صندوق = 20 كيلو: اكتب 20.",
    stockFactorInvalid: "اكتب عدد وحدات المخزن في وحدة الطلب الواحدة (رقم أكبر من 0).",
  },
};
for (const lang of ["en", "ku", "ar"]) Object.assign(T[lang], STOCK_TEXT[lang]);

/* A unit as the stock system writes it: the Kurdish name (کیلۆ, کارتۆن, دانە…). */
function stockUnitName(unitId) {
  const u = state.units.find((x) => x.id === unitId);
  return u ? u.ku || u.en : "";
}
/* One order line as a stock-system row. Lines from older orders keep the
   name and unit saved with the order when the item no longer exists. */
function stockRow(line) {
  const item = state.items.find((i) => i.id === line.itemId);
  const qty = Number(line.qty) || 0;
  if (item?.stockUnit && item.stockUnit !== line.unit)
    return {
      name: item.stockName || item.name,
      amount: Math.round(qty * (Number(item.stockFactor) || 1) * 1000) / 1000,
      unit: stockUnitName(item.stockUnit),
    };
  return {
    name: item?.stockName || item?.name || line.name,
    amount: Math.round(qty * 1000) / 1000,
    unit: stockUnitName(line.unit),
  };
}
/* Every line of an order as stock rows; the same item twice becomes one row. */
function stockTransferRows(entries) {
  const rows = new Map();
  for (const entry of entries || [])
    for (const line of entry.items || []) {
      const row = stockRow(line);
      if (!row.name || !(row.amount > 0)) continue;
      const key = foldText(row.name) + "|" + row.unit;
      const same = rows.get(key);
      if (same) same.amount = Math.round((same.amount + row.amount) * 1000) / 1000;
      else rows.set(key, row);
    }
  return [...rows.values()];
}
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/* Hands a file to the person: the share sheet on a phone (Save to Files,
   WhatsApp…), a normal download on a computer. */
async function deliverFile(blob, name) {
  const file = typeof File === "function" ? new File([blob], name, { type: blob.type }) : null;
  if (file && matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
/* The "Excel for stock" file for one sent order (History). */
async function downloadStockExcel(rec) {
  const rows = stockTransferRows(rec?.entries);
  if (!rows.length) return;
  try {
    const XLSX = await loadSpreadsheetReader();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Item name", "Amount", "Unit"],
      ...rows.map((r) => [r.name, r.amount, r.unit]),
    ]);
    sheet["!cols"] = [{ wch: 42 }, { wch: 10 }, { wch: 12 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Transfer");
    const data = XLSX.write(book, { bookType: "xlsx", type: "array", compression: true });
    const day = erbilDate(rec.date || new Date().toISOString());
    const time = formatIraqDateTime(rec.date, { hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\D/g, "");
    if (await deliverFile(new Blob([data], { type: XLSX_TYPE }), `ricotta-transfer-${day}-${time}.xlsx`))
      toast(t("stockExcelReady"));
  } catch (error) {
    console.error("Excel for stock", error);
    await showAlert(esc(t("stockExcelFailed")));
  }
}
/* Manage → item: how the item is written in the stock system. */
function renderStockFields(item) {
  const unitOptions = state.units
    .map((u) => `<option value="${esc(u.id)}" ${item?.stockUnit === u.id ? "selected" : ""}>${esc(unitName(u))}</option>`)
    .join("");
  const open = !!(item?.stockName || item?.stockUnit);
  return `<details class="settings-group stock-fields" ${open ? "open" : ""}><summary>${esc(t("stockSection"))}</summary>
    <p class="field-hint">${esc(t("stockSectionHint"))}</p>
    <div class="field"><label for="mfStockName">${esc(t("stockName"))}</label><input id="mfStockName" maxlength="160" autocomplete="off" dir="auto" value="${esc(item?.stockName || "")}"></div>
    <div class="field"><label for="mfStockUnit">${esc(t("stockUnit"))}</label><select id="mfStockUnit"><option value="">${esc(t("stockUnitSame"))}</option>${unitOptions}</select></div>
    <div class="field" id="mfStockFactorField"><label for="mfStockFactor">${esc(t("stockFactor"))}</label><input id="mfStockFactor" inputmode="decimal" data-pad="dec" maxlength="10" autocomplete="off" value="${esc(item?.stockFactor ?? "")}"><small class="field-hint">${esc(t("stockFactorHint"))}</small></div>
  </details>`;
}
/* The factor only matters when the stock unit differs from the order unit. */
function attachStockFields(box) {
  const unit = box.querySelector("#mfUnit"), stock = box.querySelector("#mfStockUnit"), field = box.querySelector("#mfStockFactorField");
  if (!unit || !stock || !field) return;
  const sync = () => { field.hidden = !stock.value || stock.value === unit.value; };
  unit.addEventListener("change", sync);
  stock.addEventListener("change", sync);
  sync();
}
/* {stockName, stockUnit, stockFactor} for saving, or {error}. */
function readStockFields(orderUnit) {
  const name = document.getElementById("mfStockName").value.trim().slice(0, 160);
  let unit = document.getElementById("mfStockUnit").value || null;
  if (unit === orderUnit) unit = null;
  if (!unit) return { stockName: name, stockUnit: null, stockFactor: null };
  const raw = foldText(document.getElementById("mfStockFactor").value.trim()).replace(/[٫,]/g, ".");
  const factor = Number(raw);
  if (!raw || !Number.isFinite(factor) || factor <= 0 || factor > 100000) return { error: t("stockFactorInvalid") };
  return { stockName: name, stockUnit: unit, stockFactor: Math.round(factor * 10000) / 10000 };
}
