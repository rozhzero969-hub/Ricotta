/* The map of the app: every tab, page, setting and common thing to do, in one list, for the app and
   the API alike. Rico searches it (find_in_app) to tell someone where something is, and the app opens
   an entry with one tap (openAppPlace in assistant.js): the tab, the Admin page, or Settings scrolled
   to that row and briefly lit.
   Each entry:
     id     its name in code (never shown)
     kind   'tab' | 'page' | 'setting' | 'action'
     n      its plain name: [English, Kurdish, Arabic]
     w      extra words to find it by (any language)
     in     the id of the entry it is inside (a setting is in 'settings'), for "Settings, Dark mode"
     need   who can see it: {v: screen(s) the person must have, r: something they must be allowed to
            do, own: Rozh only, acc: that account only, ah: a screen Ahmad must also have}
     go     how to open it: {view} a screen; {admin} an Admin page; {person} a person's page in Admin;
            {sel} the row to scroll to and light up on that screen; {rico} a row in Rico's settings;
            {run} something the app does (the names are in APP_PLACE_RUN, assistant.js)
   Needs RicottaSearch (search.js) loaded first. Adding a screen or a setting: add its entry here. */
(function () {
  const feature = (id) => `[data-feature="${id}"]`;
  const PLACES = [
    // ---- Tabs ----
    { id: 'order', kind: 'tab', n: ['Order', 'داواکاری', 'الطلب'], w: 'today order draft items amounts suppliers food expenses بڕ کاڵا طلب اليوم', need: { v: 'order' }, go: { view: 'order' } },
    { id: 'send', kind: 'action', n: ['Send to suppliers', 'ناردن بۆ دابینکەران', 'الإرسال إلى المورّدين'], w: 'send whatsapp order suppliers ناردن واتساپ إرسال واتساب', in: 'order', need: { v: 'order', r: 'send' }, go: { run: 'send' } },
    { id: 'history', kind: 'tab', n: ['History', 'مێژوو', 'السجل'], w: 'sent orders past orders report card month old orders داواکارییە نێردراوەکان الطلبات السابقة', need: { v: 'history' }, go: { view: 'history' } },
    { id: 'monthReport', kind: 'action', n: ['Report card', 'کارتی ڕاپۆرت', 'بطاقة التقرير'], w: 'month report summary excel pdf save this month ڕاپۆرتی مانگ تقرير الشهر', in: 'history', need: { v: 'history' }, go: { view: 'history', run: 'monthReport' } },
    { id: 'manage', kind: 'tab', n: ['Manage: Items', 'بەڕێوەبردن: کاڵاکان', 'إدارة: المواد'], w: 'manage items catalog list edit item price aliases کاڵاکان لیست المواد قائمة', need: { v: 'manage' }, go: { view: 'manage' } },
    { id: 'suppliers', kind: 'tab', n: ['Manage: Suppliers', 'بەڕێوەبردن: دابینکەران', 'إدارة: المورّدون'], w: 'suppliers phone whatsapp number reminder time دابینکەر ژمارە مورد رقم', need: { v: 'suppliers' }, go: { view: 'suppliers' } },
    { id: 'units', kind: 'tab', n: ['Manage: Units', 'بەڕێوەبردن: یەکەکان', 'إدارة: الوحدات'], w: 'units kg box piece carton یەکە کیلۆ وحدة كيلو', need: { v: 'units' }, go: { view: 'units' } },
    { id: 'addItem', kind: 'action', n: ['Add an item', 'زیادکردنی کاڵا', 'إضافة مادة'], w: 'new item add create کاڵای نوێ مادة جديدة', in: 'manage', need: { v: 'manage', r: 'catalog' }, go: { view: 'manage', run: 'addItem' } },
    { id: 'addSupplier', kind: 'action', n: ['Add a supplier', 'زیادکردنی دابینکەر', 'إضافة مورّد'], w: 'new supplier add create دابینکەری نوێ مورد جديد', in: 'suppliers', need: { v: 'suppliers', r: 'catalog' }, go: { view: 'suppliers', run: 'addSupplier' } },
    { id: 'addUnit', kind: 'action', n: ['Add a unit', 'زیادکردنی یەکە', 'إضافة وحدة'], w: 'new unit add create یەکەی نوێ وحدة جديدة', in: 'units', need: { v: 'units', r: 'catalog' }, go: { view: 'units', run: 'addUnit' } },
    { id: 'importItems', kind: 'action', n: ['Import items from Excel', 'هێنانی کاڵا لە ئێکسڵ', 'استيراد المواد من إكسل'], w: 'import excel csv file upload items هێنان ئێکسڵ استيراد', in: 'manage', need: { v: 'manage', r: 'catalog' }, go: { view: 'manage', run: 'importItems' } },
    { id: 'exportItems', kind: 'action', n: ['Download the items list', 'داگرتنی لیستی کاڵاکان', 'تنزيل قائمة المواد'], w: 'export excel pdf items download print هەناردە داگرتن تصدير تنزيل', in: 'manage', need: { v: 'manage', r: 'exports' }, go: { run: 'exportItems' } },
    { id: 'exportSuppliers', kind: 'action', n: ['Download the suppliers list', 'داگرتنی لیستی دابینکەران', 'تنزيل قائمة المورّدين'], w: 'export excel pdf suppliers download print هەناردە داگرتن تصدير تنزيل', in: 'suppliers', need: { v: 'suppliers', r: 'exports' }, go: { run: 'exportSuppliers' } },
    { id: 'receipts', kind: 'tab', n: ['Receipts', 'وەسڵەکان', 'الإيصالات'], w: 'receipts invoices supplier bill enter receipt وەسڵ پسوولە فاتورة إيصال', need: { v: 'receipts' }, go: { view: 'receipts' } },
    { id: 'transfers', kind: 'tab', n: ['Transfers', 'گواستنەوەکان', 'التحويلات'], w: 'transfers move stock between storages main storage گواستنەوە کۆگا تحويل مخزن', need: { v: 'transfers' }, go: { view: 'transfers' } },
    { id: 'stock', kind: 'tab', n: ['Stock', 'کۆگا', 'المخزون'], w: 'stock storage how much left low empty کۆگا چەند ماوە مخزون كم بقي', need: { v: 'stock' }, go: { view: 'stock' } },
    { id: 'record', kind: 'tab', n: ['Record', 'تۆمار', 'السجلّ'], w: 'record changes who changed log activity گۆڕانکاری کێ گۆڕی تغييرات من غيّر', need: { v: 'record' }, go: { view: 'record' } },
    { id: 'recipes', kind: 'tab', n: ['Recipes', 'ڕێسیپییەکان', 'الوصفات'], w: 'recipes cost menu price profit cakes smoothies ڕێسیپی ڕەچەتە تێچوو قازانج وصفة تكلفة ربح', need: { v: 'recipes' }, go: { view: 'recipes' } },
    { id: 'recipeItems', kind: 'tab', n: ['Recipes: Items', 'ڕێسیپییەکان: کاڵاکان', 'الوصفات: المواد'], w: 'ingredients items last price paid stock item کاڵاکان پێکهاتە دوایین نرخ مكونات آخر سعر', need: { v: 'recipeItems' }, go: { view: 'recipeItems' } },
    { id: 'minibar', kind: 'tab', n: ['Minibar stock', 'کۆگای مینیبار', 'مخزن الميني بار'], w: 'minibar stock main storage what can i take مینیبار کۆگای سەرەکی ميني بار المخزن الرئيسي', need: { v: 'minibar' }, go: { view: 'minibar' } },
    { id: 'rico', kind: 'tab', n: ['Rico', 'ریکۆ', 'ريكو'], w: 'rico chat assistant ask question گفتوگۆ پرسیار محادثة سؤال', need: { v: 'assistant' }, go: { view: 'assistant' } },
    { id: 'ricoNewChat', kind: 'action', n: ['Start a new chat with Rico', 'گفتوگۆیەکی نوێ لەگەڵ ریکۆ', 'محادثة جديدة مع ريكو'], w: 'new chat fresh start گفتوگۆی نوێ محادثة جديدة', in: 'rico', need: { v: 'assistant' }, go: { view: 'assistant', run: 'ricoNewChat' } },
    { id: 'ricoChats', kind: 'page', n: ['Earlier chats with Rico', 'گفتوگۆکانی پێشوو لەگەڵ ریکۆ', 'المحادثات السابقة مع ريكو'], w: 'chat history old chats earlier conversations delete rename pin گفتوگۆ کۆنەکان المحادثات القديمة', in: 'rico', need: { v: 'assistant' }, go: { view: 'assistant', run: 'ricoChats' } },
    { id: 'ricoScheduled', kind: 'page', n: ['Scheduled tasks for Rico', 'کارە خشتەکراوەکانی ریکۆ', 'مهام ريكو المجدولة'], w: 'scheduled reminders routines every day remind me بیرخستنەوە هەموو ڕۆژێک تذكير كل يوم', in: 'rico', need: { v: 'assistant' }, go: { view: 'assistant', run: 'ricoScheduled' } },
    { id: 'ricoMemory', kind: 'page', n: ['What Rico remembers', 'ریکۆ چی لەبیرە', 'ما يتذكره ريكو'], w: 'memory remembers rules forget بیر لەبیرکردن ذاكرة يتذكر', in: 'rico', need: { v: 'assistant' }, go: { view: 'assistant', run: 'ricoMemory' } },
    { id: 'ricoStyle', kind: 'setting', n: ['How Rico talks', 'ریکۆ چۆن قسە دەکات', 'كيف يتحدث ريكو'], w: 'rico style short warm normal answers length کورت گەرم قصير ودود', in: 'rico', need: { v: 'assistant' }, go: { view: 'assistant', rico: '.rico-style' } },
    { id: 'ricoAutoOrder', kind: 'setting', n: ['Let Rico fill my order', 'با ریکۆ داواکارییەکەم پڕ بکاتەوە', 'دع ريكو يملأ طلبي'], w: 'rico automatic order fill by himself خۆکار تلقائي', in: 'rico', need: { v: ['assistant', 'order'] }, go: { view: 'assistant', rico: '[data-set-auto]' } },
    { id: 'ricoSheet', kind: 'setting', n: ['Rico on the Order screen', 'ریکۆ لە شاشەی داواکاری', 'ريكو في شاشة الطلب'], w: 'rico button order screen ask دوگمەی ریکۆ زر ريكو', in: 'rico', need: { v: ['assistant', 'order'] }, go: { view: 'assistant', rico: '[data-set-sheet]' } },
    { id: 'ricoAi', kind: 'setting', n: ['Rico’s AI permission', 'ڕێپێدانی زیرەکی دەستکردی ریکۆ', 'إذن ذكاء ريكو الاصطناعي'], w: 'ai consent permission privacy data sent ڕێپێدان تایبەتمەندی إذن خصوصية', in: 'rico', need: { v: 'assistant' }, go: { view: 'assistant', rico: '[data-set-ai]' } },

    // ---- Settings ----
    { id: 'settings', kind: 'tab', n: ['Settings', 'ڕێکخستن', 'الإعدادات'], w: 'settings preferences options ڕێکخستنەکان إعدادات', need: { v: 'settings' }, go: { view: 'settings' } },
    { id: 'setNotif', kind: 'setting', n: ['Notifications on this phone', 'ئاگادارکردنەوە لەم مۆبایلەدا', 'الإشعارات على هذا الهاتف'], w: 'notifications alerts push reminders bell ئاگاداری زەنگ إشعارات تنبيهات', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: '#pushSwitch' } },
    { id: 'setDark', kind: 'setting', n: ['Light or Dark', 'ڕووناک یان تاریک', 'فاتح أو داكن'], w: 'dark mode light mode night appearance theme colour تاریک ڕووناک شەو داكن فاتح ليل', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: '.dark-row' } },
    { id: 'setLanguage', kind: 'setting', n: ['Language', 'زمان', 'اللغة'], w: 'language kurdish arabic english change language کوردی عەرەبی ئینگلیزی كردي عربي إنجليزي', need: { v: 'settings' }, go: { run: 'language' } },
    { id: 'setSwipe', kind: 'setting', n: ['Swipe for the usual', 'ڕاکێشان بۆ بڕی ئاسایی', 'اسحب للكمية المعتادة'], w: 'swipe usual amount ڕاکێشان اسحب', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('swipe') } },
    { id: 'setLastQty', kind: 'setting', n: ['Show the last amount', 'دوایین بڕ پیشان بدە', 'إظهار آخر كمية'], w: 'last amount previous quantity دوایین بڕ آخر كمية', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('showLastQty') } },
    { id: 'setCompact', kind: 'setting', n: ['Compact rows', 'ڕیزی بچووکتر', 'صفوف مضغوطة'], w: 'compact rows smaller dense more on screen بچووک صغير', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('compactRows') } },
    { id: 'setSoundQty', kind: 'setting', n: ['Sound when you change an amount', 'دەنگ کاتێک بڕێک دەگۆڕیت', 'صوت عند تغيير الكمية'], w: 'sound tap tick click mute quiet دەنگ بێدەنگ صوت كتم', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('soundQty') } },
    { id: 'setSoundSent', kind: 'setting', n: ['Sound when orders are sent', 'دەنگ کاتێک داواکارییەکان دەنێردرێن', 'صوت عند إرسال الطلبات'], w: 'sound sent chime mute دەنگ ناردن صوت إرسال', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('soundSent') } },
    { id: 'setSoundRico', kind: 'setting', n: ['Sound when Rico replies', 'دەنگ کاتێک ریکۆ وەڵام دەداتەوە', 'صوت عندما يرد ريكو'], w: 'sound rico reply mute دەنگی ریکۆ صوت ريكو', in: 'settings', need: { v: ['settings', 'assistant'] }, go: { view: 'settings', sel: feature('soundRico') } },
    { id: 'setSoundError', kind: 'setting', n: ['Sound when something goes wrong', 'دەنگ کاتێک شتێک هەڵە دەبێت', 'صوت عندما يحدث خطأ'], w: 'sound error wrong mute دەنگی هەڵە صوت خطأ', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: feature('soundError') } },
    { id: 'setSoundMilestone', kind: 'setting', n: ['Sound for milestones', 'دەنگی دەستکەوتەکان', 'صوت الإنجازات'], w: 'sound milestone fanfare mute دەستکەوت إنجاز', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('soundMilestone') } },
    { id: 'setSoundUndo', kind: 'setting', n: ['Sound for Undo', 'دەنگی گەڕاندنەوە', 'صوت التراجع'], w: 'sound undo mute گەڕاندنەوە تراجع', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('soundUndo') } },
    { id: 'setSimple', kind: 'setting', n: ['Simple view', 'دیمەنی سادە', 'عرض مبسّط'], w: 'simple view less on screen plain سادە مبسط', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: feature('simpleView') } },
    { id: 'setTables', kind: 'setting', n: ['Interactive tables', 'خشتەی کارلێکەر', 'جداول تفاعلية'], w: 'tables sort columns filter خشتە جدول', in: 'settings', need: { v: 'settings', ah: 'manage' }, go: { view: 'settings', sel: feature('tables') } },
    { id: 'setKitchen', kind: 'setting', n: ['Kitchen mode (bigger text)', 'شێوازی چێشتخانە (نووسینی گەورەتر)', 'وضع المطبخ (خط أكبر)'], w: 'kitchen mode big text larger font size گەورە خط كبير', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: feature('kitchenMode') } },
    { id: 'setMilestones', kind: 'setting', n: ['Kitchen milestones', 'دەستکەوتەکانی چێشتخانە', 'إنجازات المطبخ'], w: 'milestones streak awards celebrate دەستکەوت إنجازات', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: feature('milestones') } },
    { id: 'setRecipeAlerts', kind: 'setting', n: ['Recipe alerts', 'ئاگادارییەکانی ڕێسیپی', 'تنبيهات الوصفات'], w: 'recipe alerts price changed notification ئاگاداری ڕێسیپی ڕەچەتە تنبيه وصفة', in: 'settings', need: { v: 'settings', acc: 'ahmad' }, go: { view: 'settings', sel: feature('recipeAlerts') } },
    { id: 'setRicoMac', kind: 'setting', n: ['Rico on the Mac: start, stop and limits', 'ریکۆ لەسەر ماک: دەستپێکردن، وەستان و سنوورەکان', 'ريكو على الماك: التشغيل والإيقاف والحدود'], w: 'rico helper mac stop start receipts limits telegram automatic transfers وەستاندنی ریکۆ سنوور تێلیگرام إيقاف ريكو حدود تيليغرام', in: 'settings', need: { v: ['settings', 'receipts'], own: true }, go: { view: 'settings', sel: '#rrStop' } },
    { id: 'reportProblem', kind: 'action', n: ['Report a problem', 'ڕاپۆرتکردنی کێشە', 'الإبلاغ عن مشكلة'], w: 'report problem bug something is broken help کێشە هەڵە یارمەتی مشكلة خطأ مساعدة', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: '#reportProblemBtn' } },
    { id: 'tour', kind: 'action', n: ['Show the tour', 'گەشتەکە پیشان بدە', 'اعرض الجولة'], w: 'tour how the app works guide learn فێربوون ڕێنمایی جولة شرح', in: 'settings', need: { v: ['settings', 'order'] }, go: { view: 'settings', sel: '#tourBtn' } },
    { id: 'recipesTour', kind: 'action', n: ['How the minibar app works', 'ئەپی مینیبار چۆن کار دەکات', 'كيف يعمل تطبيق الميني بار'], w: 'tour recipes guide learn minibar ڕێنمایی ڕێسیپی ڕەچەتە جولة وصفات', in: 'settings', need: { v: ['settings', 'recipes'] }, go: { view: 'settings', sel: '#rcTourBtn' } },
    { id: 'shortcuts', kind: 'page', n: ['Keyboard shortcuts', 'کورتەڕێکانی تەختەکلیل', 'اختصارات لوحة المفاتيح'], w: 'keyboard shortcuts keys کلیل اختصارات', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: '#shortcutsBtn' } },
    { id: 'privacy', kind: 'page', n: ['Privacy policy', 'سیاسەتی تایبەتمەندی', 'سياسة الخصوصية'], w: 'privacy policy data تایبەتمەندی خصوصية', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: '.settings-link' } },
    { id: 'signOut', kind: 'action', n: ['Sign out', 'چوونەدەرەوە', 'تسجيل الخروج'], w: 'sign out log out exit leave چوونە دەرەوە خروج', in: 'settings', need: { v: 'settings' }, go: { view: 'settings', sel: '#settingsSignOut' } },
    { id: 'search', kind: 'action', n: ['Search the app', 'گەڕان لە ئەپەکەدا', 'البحث في التطبيق'], w: 'search find look for گەڕان دۆزینەوە بحث', need: { v: 'settings' }, go: { run: 'search' } },

    // ---- Admin (Rozh only) ----
    { id: 'admin', kind: 'tab', n: ['Admin', 'ئەدمین', 'الإدارة'], w: 'admin owner control everything ok ئەدمین خاوەن مدير', need: { v: 'admin', own: true }, go: { view: 'admin' } },
    { id: 'adminProblems', kind: 'page', n: ['Problems', 'کێشەکان', 'المشاكل'], w: 'problems errors bugs reported crash کێشە هەڵە مشاكل أخطاء', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'problems' } },
    { id: 'adminSecurity', kind: 'page', n: ['Sign-in safety', 'پاراستنی چوونەژوورەوە', 'أمان تسجيل الدخول'], w: 'security sign in wrong pin locked unlock new phone log کۆدی هەڵە داخراوە ئاسایش رمز خاطئ مقفل أمان', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'security' } },
    { id: 'adminHealth', kind: 'page', n: ['App check', 'پشکنینی ئەپ', 'فحص التطبيق'], w: 'health check is everything working server storage space full پشکنین کار دەکات فحص يعمل', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'health' } },
    { id: 'adminAccess', kind: 'page', n: ['Who can open what', 'کێ چی دەکاتەوە', 'من يفتح ماذا'], w: 'access roles permissions yunis ahmad allow screens ڕێپێدان دەسەڵات یونس ئەحمەد صلاحيات يونس أحمد', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'access' } },
    { id: 'adminDevices', kind: 'page', n: ['Phones and computers', 'مۆبایل و کۆمپیوتەرەکان', 'الهواتف والحواسيب'], w: 'devices phones signed in log out refresh who is signed in ئامێر مۆبایل دەرکردن أجهزة هواتف تسجيل خروج', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'devices' } },
    { id: 'adminTime', kind: 'page', n: ['Time in the app', 'کات لە ئەپەکەدا', 'الوقت في التطبيق'], w: 'time usage how long hours minutes used کات چەند کاتژمێر وقت استخدام ساعات', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'time' } },
    { id: 'adminPins', kind: 'action', n: ['Change a PIN', 'گۆڕینی کۆدی نهێنی', 'تغيير الرمز السري'], w: 'pin password code change new pin کۆد پاسوۆرد رمز كلمة السر', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', person: 'rozha' } },
    { id: 'adminRico', kind: 'page', n: ['Rico (in Admin)', 'ریکۆ (لە ئەدمین)', 'ريكو (في الإدارة)'], w: 'rico usage ai switches haiku gemini groq on off how much used بەکارهێنانی ریکۆ استخدام ريكو', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'rico' } },
    { id: 'adminCloud', kind: 'page', n: ['Cloud Rico', 'Cloud Rico', 'Cloud Rico'], w: 'cloud rico reads ricotta restaurant stock invoices server reader خوێندنەوە قراءة', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'cloud' } },
    { id: 'adminNames', kind: 'page', n: ['Stock names', 'ناوی کاڵاکانی کۆگا', 'أسماء مواد المخزون'], w: 'stock names mistakes spelling ricotta restaurant fix names ناو هەڵە ڕێنووس أسماء أخطاء إملاء', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'names' } },
    { id: 'adminCatalog', kind: 'page', n: ['Items to review', 'کاڵاکان بۆ پێداچوونەوە', 'مواد للمراجعة'], w: 'catalog check items without supplier unit not ordered unavailable بێ دابینکەر بێ یەکە بدون مورد بدون وحدة', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'catalog' } },
    { id: 'adminRestore', kind: 'page', n: ['Restore', 'گەڕاندنەوە', 'الاستعادة'], w: 'restore bring back deleted backup copy undo delete سڕاوە هێنانەوە کۆپی محذوف استرجاع نسخة', in: 'admin', need: { v: 'admin', own: true }, go: { view: 'admin', admin: 'restore' } },
  ];

  /* Whether someone may do something: the same rule as the app's canDo and the api's can(). */
  function can(who, role) {
    const roles = who.roles || [];
    return who.account === 'rozha' || (role === 'recipes' && who.account === 'ahmad') || (role === 'order' && who.account === 'yunis')
      || (roles.includes(role) && (role !== 'catalog' || roles.includes('manage')));
  }
  /* The screens an account has, from its account and roles: the api's viewsFor plus the ones the app
     adds itself (Recipes' Items, Ahmad's Stock tab). */
  function viewsOf(account, roles) {
    const who = { account, roles: roles || [] }, c = (r) => can(who, r);
    return [...(c('order') ? ['order'] : []), ...(c('recipes') ? ['recipes', 'recipeItems'] : []), ...(c('assistant') ? ['assistant'] : []), ...(c('history') ? ['history'] : []),
      ...(c('manage') ? ['manage', 'suppliers', 'itemsAdmin', 'units'] : []), ...(c('receipts') ? ['receipts'] : []), ...(c('transfers') ? ['transfers'] : []),
      ...(c('transfers') || c('receipts') ? ['stock'] : []), ...(c('record') ? ['record'] : []), ...(account === 'rozha' ? ['admin'] : []), ...(account === 'ahmad' ? ['minibar'] : []), 'settings'];
  }
  /* who: {account, roles, views}. views may be left out (worked out from the account and roles). */
  function allowed(place, who) {
    const need = place.need || {}, views = who.views || viewsOf(who.account, who.roles);
    if (need.own && who.account !== 'rozha') return false;
    if (need.acc && who.account !== need.acc) return false;
    if ([].concat(need.v || []).some((v) => !views.includes(v))) return false;
    if (need.r && !can(who, need.r)) return false;
    if (need.ah && who.account === 'ahmad' && !views.includes(need.ah)) return false;
    return true;
  }
  const LANG = { en: 0, ku: 1, ar: 2 };
  // Small words that say nothing about what is being looked for.
  const SKIP = new Set(['the', 'to', 'do', 'how', 'can', 'where', 'is', 'are', 'my', 'of', 'in', 'on', 'it', 'for', 'and', 'what', 'find', 'open', 'show', 'me', 'app']);
  const byId = (id) => PLACES.find((p) => p.id === id) || null;
  const nameOf = (place, lang) => place.n[LANG[lang] ?? 0] || place.n[0];
  /* "Settings, Light or Dark": the entry with what it is inside. */
  function pathOf(place, lang) {
    const parent = place.in ? byId(place.in) : null;
    return parent ? nameOf(parent, lang) + (lang === 'en' ? ', ' : '، ') + nameOf(place, lang) : nameOf(place, lang);
  }
  /* The entries this person can use that match the words, best first. No words: every entry they can
     use. Whole phrases are tried first, then each word on its own (the more words found, the better). */
  function find(query, who, limit) {
    const mine = PLACES.filter((p) => allowed(p, who)), q = String(query || '').trim().slice(0, 120);
    if (!q) return mine.slice(0, limit || mine.length);
    const S = globalThis.RicottaSearch, fieldsOf = (p) => [...p.n, ...String(p.w || '').split(' ')];
    const words = S.normalize(q).split(' ').filter((x) => x.length >= 2 && !SKIP.has(x));
    // A long question needs at least half of its words found, so one loose word never decides it.
    const need = words.length <= 2 ? 1 : Math.ceil(words.length / 2);
    const ranked = mine.map((p, index) => {
      const fields = fieldsOf(p), whole = S.score(q, fields);
      let hit = 0, sum = 0;
      for (const x of words) { const s = S.score(x, fields); if (Number.isFinite(s)) { hit++; sum += s; } }
      return { p, index, whole, hit, sum };
    }).filter((x) => Number.isFinite(x.whole) || x.hit >= need);
    ranked.sort((a, b) => (Number.isFinite(b.whole) - Number.isFinite(a.whole)) || (Number.isFinite(a.whole) ? a.whole - b.whole : (b.hit - a.hit) || (a.sum - b.sum)) || (a.index - b.index));
    return ranked.slice(0, limit || 6).map((x) => x.p);
  }
  globalThis.RicottaAppMap = Object.freeze({ PLACES, can, viewsOf, allowed, byId, nameOf, pathOf, find });
})();
