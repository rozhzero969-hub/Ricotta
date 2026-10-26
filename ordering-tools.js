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
    catalogNoResults: "No matches found",
    securityCheck: "Quick security check",
    securityCheckHint: "Verify this sign-in to continue.",
    securityCheckFailed: "The security check could not finish. Please try again.",
    securityContinue: "Continue",
    aliasChanges: "Update search names",
    aliasConflict: "These names changed on another device. Ask Rico for a fresh preview.",
    clearSearch: "Clear search",
    searchMatches: "Matches",
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
    callSupplier: "Call",
    contactSupplier: "WhatsApp",
    catalogSearch: "Search this list…",
    importRow: "Row",
    importError: "Name, unit or supplier is missing or unknown.",
    importDuplicate: "Duplicate item; use an ID or a unique name and supplier.",
    importFailure: "Import paused. Saved rows are kept. Retry to continue.",
  },
  ku: {
    deviceInUse: "ئەم وێبگەڕە هێشتا بە هەژمارێکی تر چووەتە ژوورەوە. سەرەتا لەوێ بچۆ دەرەوە.",
    orderSounds: "دەنگەکانی داواکاری",
    quantitySound: "دەنگی زیاد و کەمکردنی بڕ",
    sentSound: "دەنگی ناردنی داواکاری",
    manage: "بەڕێوەبردن",
    catalog: "کاڵاکان",
    catalogNoResults: "هیچ ئەنجامێک نەدۆزرایەوە",
    securityCheck: "پشکنینی خێرای ئاسایش",
    securityCheckHint: "بۆ بەردەوامبوون، ئەم چوونەژوورەوەیە پشتڕاست بکەرەوە.",
    securityCheckFailed: "پشکنینی ئاسایش تەواو نەبوو. تکایە دووبارە هەوڵ بدەرەوە.",
    securityContinue: "بەردەوامبوون",
    aliasChanges: "نوێکردنەوەی ناوەکانی گەڕان",
    aliasConflict: "ئەم ناوانە لە ئامێرێکی تر گۆڕاون. لە ریکۆ داوای پێشبینینێکی نوێ بکە.",
    clearSearch: "پاککردنەوەی گەڕان",
    searchMatches: "ئەنجامەکان",
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
    callSupplier: "پەیوەندی",
    contactSupplier: "واتساپ",
    catalogSearch: "لە لیستەکە بگەڕێ…",
    importRow: "ڕیز",
    importError: "ناو، یەکە یان دابینکەر نەنووسراوە یان نەناسراوە.",
    importDuplicate:
      "کاڵای دووبارە؛ ID یان ناو و دابینکەرێکی تایبەت بەکاربهێنە.",
    importFailure:
      "هاوردە ڕاگیرا. ڕیزە پاشەکەوتکراوەکان دەمێننەوە. دووبارە هەوڵبدەرەوە.",
  },
  ar: {
    deviceInUse: "هذا المتصفح مسجل الدخول بحساب آخر. سجّل الخروج منه أولاً.",
    orderSounds: "أصوات الطلب",
    quantitySound: "نقرات زيادة وتقليل الكمية",
    sentSound: "نغمة إرسال الطلب",
    manage: "إدارة",
    catalog: "الكتالوج",
    catalogNoResults: "لم يتم العثور على نتائج",
    securityCheck: "تحقق أمني سريع",
    securityCheckHint: "تحقق من تسجيل الدخول للمتابعة.",
    securityCheckFailed: "تعذّر إكمال التحقق الأمني. حاول مرة أخرى.",
    securityContinue: "متابعة",
    aliasChanges: "تحديث أسماء البحث",
    aliasConflict: "تغيّرت هذه الأسماء على جهاز آخر. اطلب معاينة جديدة من ريكو.",
    clearSearch: "مسح البحث",
    searchMatches: "النتائج",
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
    callSupplier: "اتصال",
    contactSupplier: "واتساب",
    catalogSearch: "ابحث في هذه القائمة…",
    importRow: "صف",
    importError: "الاسم أو الوحدة أو المورد مفقود أو غير معروف.",
    importDuplicate: "صنف مكرر؛ استخدم ID أو اسماً ومورداً فريدين.",
    importFailure:
      "توقف الاستيراد. الصفوف المحفوظة باقية. أعد المحاولة للمتابعة.",
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
      // A table in Manage is drawn twice (a table for computers, a list for phones): both are filtered, one is counted.
      const counted=row=>!row.closest(isPhoneLayout()?'.data-table':'.table-list');
      const total=rows.filter(counted).length;
      let shown=0;
      const scored=rows.map((row,index)=>{
        const item=state.items.find(i=>i.id===row.dataset.edititem);
        const fields=item?itemSearchFields(item):row.dataset.searchText||row.textContent;
        const score=globalThis.RicottaSearch.score(search.value,fields);
        row.hidden=!Number.isFinite(score);if(!row.hidden && counted(row))shown++;
        if(!row.dataset.searchOrder)row.dataset.searchOrder=String(index+1);
        return {row,index:Number(row.dataset.searchOrder),score};
      });
      if(['manage','suppliers','itemsAdmin'].includes(state.view))scored.sort((a,b)=>a.score-b.score||a.index-b.index).forEach(x=>x.row.parentNode.appendChild(x.row));
      document.getElementById('catalogSearchCount').textContent=search.value.trim()?`${t('searchMatches')}: ${shown} / ${total}`:'';
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
