/* What's new: a short list of each update, in plain words, read from the account menu (never on the
   Order screen). A small dot on the account button and on the row says there is something not read
   yet; opening the list marks it read on this device. Newest first. Depends on: t, esc, state, lget,
   lset, openKitchenSheet, formatIraqDateTime. */
const WHATS_NEW = [
  {id:'2026-11-14b', date:'2026-11-14', notes:{
    en:['Stock is easier to read: each item on one line with its amount, like 12 kg (12,000 g), and an eye button for details.',
      'Hold the pointer on an item for a second to see a bigger card with last bought and last moved.',
      'Choices in Settings open as a small menu right under the box on a computer.',
      'Hide or show the sidebar with Cmd/Ctrl + \\. You can change this key in Shortcuts.'],
    ku:['کۆگا ئاسانتر دەخوێندرێتەوە: هەر کاڵایەک لە یەک دێڕدا لەگەڵ بڕەکەی، وەک 12 کیلۆ (12,000 غرام)، و دوگمەی چاو بۆ وردەکاری.',
      'ماوەی یەک چرکە نیشاندەر لەسەر کاڵایەک ڕابگرە بۆ بینینی کارتێکی گەورەتر لەگەڵ دوایین کڕین و دوایین گواستنەوە.',
      'هەڵبژاردنەکانی ڕێکخستنەکان لە کۆمپیوتەر وەک لیستێکی بچووک ڕاست لە ژێر خانەکە دەکرێنەوە.',
      'لیستی لاتەنیشت بە Cmd/Ctrl + \\ بشارەوە یان پیشانی بدە. دەتوانیت ئەم دوگمەیە لە کورتەڕێگاکان بگۆڕیت.'],
    ar:['المخزون أسهل قراءة: كل مادة في سطر واحد مع كميتها، مثل 12 كغ (12,000 غرام)، وزر عين للتفاصيل.',
      'أبقِ المؤشر على مادة ثانية واحدة لترى بطاقة أكبر فيها آخر شراء وآخر نقل.',
      'الخيارات في الإعدادات تفتح كقائمة صغيرة تحت الخانة مباشرة على الكمبيوتر.',
      'أخفِ الشريط الجانبي أو أظهره بـ Cmd/Ctrl + \\. يمكنك تغيير هذا المفتاح في الاختصارات.']}},
  {id:'2026-11-14', date:'2026-11-14', notes:{
    en:['Rico can now tell you what is in stock, what you paid for an item and how its price changed, what you spent by supplier or item, and what went to each storage.',
      'Ask Rico what needs you: stopped, waiting or stuck receipts and transfers, most important first.',
      'Rico can prepare a transfer for you as a draft. You open it in Transfers, check it and send it yourself. He never makes receipts.',
      'Rico is calm now: plain reminders, no moods.'],
    ku:['ریکۆ ئێستا دەتوانێت پێت بڵێت چی لە کۆگا هەیە، نرخی کاڵایەک چەند بووە و چۆن گۆڕاوە، چەندت خەرج کردووە بە پێی دابینکەر یان کاڵا، و چی چووە بۆ هەر کۆگایەک.',
      'لە ریکۆ بپرسە چی چاوەڕێی تۆیە: پسوولە و گواستنەوەی وەستاو، چاوەڕوان یان گیراو، گرنگترینیان یەکەم.',
      'ریکۆ دەتوانێت گواستنەوەیەک وەک ڕەشنووس ئامادە بکات. خۆت لە گواستنەوەدا دەیکەیتەوە، دەیپشکنیت و دەینێریت. هەرگیز پسوولە دروست ناکات.',
      'ریکۆ ئێستا ئارامە: بیرخستنەوەی سادە، بێ هەست و سۆز.'],
    ar:['يستطيع ريكو الآن أن يخبرك بما في المخزون، وبكم اشتريت مادة وكيف تغيّر سعرها، وبما أنفقت حسب المورد أو المادة، وبما ذهب إلى كل مخزن.',
      'اسأل ريكو عمّا يحتاجك: الإيصالات والتحويلات المتوقفة أو المنتظرة أو العالقة، الأهم أولًا.',
      'يستطيع ريكو تجهيز تحويل لك كمسودة. تفتحها أنت في التحويلات وتراجعها وترسلها بنفسك. لا ينشئ إيصالات أبدًا.',
      'ريكو هادئ الآن: تذكيرات بسيطة، بلا مزاج.']}},
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
