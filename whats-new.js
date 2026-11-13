/* What's new: a short list of each update, in plain words, read from the account menu (never on the
   Order screen). A small dot on the account button and on the row says there is something not read
   yet; opening the list marks it read on this device. Newest first. Depends on: t, esc, state, lget,
   lset, openKitchenSheet, formatIraqDateTime. */
const WHATS_NEW = [
  {id:'2026-11-13', date:'2026-11-13', notes:{
    en:['Transfers show what is really left: amounts already being moved, and the same item on lines above, are taken off.',
      'New Stock screen: what is left in Main Storage, read only, with Excel, PDF and Numbers.',
      'The Order screen stays still when you press + or -.',
      'Receipts: "Fix these first" names the item and outlines the box to fix. A tap on Add item or Send is never lost.',
      'Transfers: Send all drafts sends them one by one, the oldest first. Receipts still go one at a time.',
      'Rico is a calm, simple helper now, with your chats listed on the left on a computer.',
      'Settings: Simple view hides small extras. The sidebar can be hidden with its button or Cmd/Ctrl + \\.',
      'Admin has a new, calmer dashboard, with a page for each person.'],
    ku:['گواستنەوە ئەوە پیشان دەدات کە بەڕاستی ماوە: ئەو بڕانەی خەریکی گواستنەوەن و هەمان کاڵا لە دێڕەکانی سەرەوە لێی دەردەکرێن.',
      'شاشەی نوێی کۆگا: ئەوەی لە کۆگای سەرەکی ماوە، تەنها بۆ بینین، لەگەڵ Excel و PDF و Numbers.',
      'شاشەی داواکاری کاتێک + یان - دادەگریت ناجووڵێت.',
      'پسوولە: «سەرەتا ئەمانە چاک بکە» ناوی کاڵاکە دەڵێت و ئەو خانەیەی پێویستی بە چاککردنە دیاری دەکات. دەستلێدان لەسەر زیادکردن یان ناردن هەرگیز ون نابێت.',
      'گواستنەوە: ناردنی هەموو ڕەشنووسەکان یەک بە یەک دەیاننێرێت، کۆنترینیان یەکەم. پسوولەکان هێشتا یەک بە یەک دەچن.',
      'ریکۆ ئێستا یارمەتیدەرێکی ئارام و سادەیە، گفتوگۆکانت لەسەر کۆمپیوتەر لە لای چەپ ڕیز کراون.',
      'ڕێکخستنەکان: دیمەنی سادە زیادە بچووکەکان دەشارێتەوە. لیستی لاتەنیشت بە دوگمەکەی یان Cmd/Ctrl + \\ دەشاردرێتەوە.',
      'بەڕێوەبەر داشبۆردێکی نوێ و ئارامتری هەیە، لەگەڵ پەڕەیەک بۆ هەر کەسێک.'],
    ar:['التحويلات تُظهر ما تبقى فعلًا: تُطرح الكميات التي يجري نقلها ونفس المادة في الأسطر السابقة.',
      'شاشة المخزون الجديدة: ما تبقى في المخزن الرئيسي، للاطلاع فقط، مع Excel وPDF وNumbers.',
      'شاشة الطلب لا تتحرك عند الضغط على + أو -.',
      'الإيصالات: «صحّح هذه أولًا» تذكر اسم المادة وتحدد الخانة التي تحتاج تصحيحًا. لا تضيع أي نقرة على إضافة مادة أو إرسال.',
      'التحويلات: «إرسال كل المسودات» يرسلها واحدة تلو الأخرى، الأقدم أولًا. الإيصالات ما زالت تُرسل واحدًا تلو الآخر.',
      'ريكو الآن مساعد هادئ وبسيط، ومحادثاتك مرتبة على اليسار في الكمبيوتر.',
      'الإعدادات: «عرض مبسّط» يخفي الإضافات الصغيرة. يمكن إخفاء الشريط الجانبي بزره أو بـ Cmd/Ctrl + \\.',
      'لوحة الإدارة أصبحت أهدأ، مع صفحة لكل شخص.']}},
];
const newsUnread = ()=> WHATS_NEW.length > 0 && lget('newsSeen') !== WHATS_NEW[0].id;
function openWhatsNew(){
  const lang = WHATS_NEW[0]?.notes[state.lang] ? state.lang : 'en';
  const list = WHATS_NEW.map(n=>`<section class="news-entry"><h3>${esc(formatIraqDateTime(n.date + 'T12:00:00Z', {day:'numeric', month:'long', year:'numeric'}))}</h3>
      <ul>${(n.notes[lang] || n.notes.en).map(x=>`<li dir="auto">${esc(x)}</li>`).join('')}</ul></section>`).join('');
  openKitchenSheet('news-sheet', `<div class="sel-title">${esc(t('whatsNew'))}</div><div class="news-list">${list}</div>`, t('whatsNew'));
  if(WHATS_NEW[0]) lset('newsSeen', WHATS_NEW[0].id);
  document.getElementById('accountBtn')?.classList.remove('has-news');
}
