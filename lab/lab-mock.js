/* Ricotta Lab: a pretend server for the real app.
   The app's own files run unchanged. Every request to the `api` Edge Function
   is answered here from sample data kept in this browser, so nothing reaches
   the real Supabase project and no real kitchen data is shown.
   Loads before every other script. */
(function(){
  document.documentElement.classList.add('booting');
  const LS = 'ricottaOrders:';
  const DB_KEY = 'ricottaLab:db';
  const VIEWS = ['order','assistant','history','suppliers','itemsAdmin','units','record','devices','settings'];
  const ACCOUNT_VIEWS = {rozha:VIEWS, yunis:['order','assistant','history','suppliers','itemsAdmin','units','record']};
  const NAMES = {rozha:{en:'Rozha',ku:'ڕۆژا',ar:'روژا'}, yunis:{en:'Yunis',ku:'یونس',ar:'يونس'}};
  const ALL_THEMES = ['ricotta','graphite','ocean','saffron','berry','halloween','winter','newroz','ramadan','summer','eid','christmas','flagday','spring','autumn','match'];

  const lsGet = k => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(_){ return null; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
  /* The Lab can pretend a date, so the holiday themes can be seen any day (seasons.js reads it). */
  { const f = lsGet('ricottaLab:today'); if(typeof f === 'string') window.RICOTTA_TODAY = f; }

  /* ---- Baghdad calendar helpers (the app keeps the current Baghdad month) ---- */
  const bag = d => {
    const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
    const g = t => p.find(x=>x.type===t).value;
    return {y:+g('year'), m:+g('month'), d:+g('day'), h:+g('hour'), mi:+g('minute')};
  };
  const atBaghdad = (y, m, d, h, mi) => new Date(Date.UTC(y, m-1, d, h-3, mi)).toISOString();

  /* ---- Sample data ---- */
  function seed(){
    const now = bag(new Date());
    const units = [
      {id:'kg',en:'kg',ku:'کیلۆگرام',ar:'كيلوغرام'},{id:'g',en:'g',ku:'گرام',ar:'غرام'},{id:'l',en:'liter',ku:'لیتر',ar:'لتر'},
      {id:'piece',en:'piece',ku:'دانە',ar:'قطعة'},{id:'carton',en:'carton',ku:'کارتۆن',ar:'كارتون'},{id:'box',en:'box',ku:'سندوق',ar:'صندوق'},
      {id:'pack',en:'pack',ku:'پاکەت',ar:'باكيت'},{id:'bag',en:'bag',ku:'کیسە',ar:'كيس'},{id:'bottle',en:'bottle',ku:'بوتڵ',ar:'قنينة'},
      {id:'can',en:'can',ku:'قوتی',ar:'علبة'},{id:'tray',en:'tray',ku:'سینی',ar:'صينية'},{id:'bunch',en:'bunch',ku:'دەستە',ar:'حزمة'}
    ];
    const stamp = new Date(Date.now() - 20*86400000).toISOString();
    const suppliers = [
      {id:'sup-dairy', name:'Zakho Dairy', phone:'07501234567', reminder:{enabled:true, time:'10:00', days:[0,1,2,3,4,6], updatedAt:stamp}},
      {id:'sup-veg', name:'Erbil Veg Market', phone:'07701112233', reminder:{enabled:true, time:'09:30', days:[], updatedAt:stamp}},
      {id:'sup-bakery', name:'Ankawa Bakery', phone:'07505556677', reminder:{enabled:true, time:'08:00', days:[], updatedAt:stamp}},
      {id:'sup-meat', name:'Kurdistan Meat Co.', phone:'07509998877', reminder:{enabled:true, time:'11:00', days:[1,4], updatedAt:stamp}},
      {id:'sup-dry', name:'Suli Dry Goods', phone:'07701239876', reminder:null}
    ];
    const I = (id, name, unit, supplierId, sortOrder) => ({id, name, unit, supplierId, sortOrder});
    const items = [
      I('it-mozz','Mozzarella','kg','sup-dairy',0), I('it-ric','Ricotta','kg','sup-dairy',1), I('it-parm','Parmesan','kg','sup-dairy',2),
      I('it-cream','Cooking cream','carton','sup-dairy',3), I('it-butter','Butter','box','sup-dairy',4), I('it-eggs','Eggs','tray','sup-dairy',5),
      I('it-tom','Tomatoes','kg','sup-veg',0), I('it-basil','Basil','bunch','sup-veg',1), I('it-onion','Onions','bag','sup-veg',2),
      I('it-garlic','Garlic','kg','sup-veg',3), I('it-lettuce','Lettuce','piece','sup-veg',4), I('it-lemon','Lemons','kg','sup-veg',5), I('it-mush','Mushrooms','kg','sup-veg',6),
      I('it-ciab','Ciabatta','piece','sup-bakery',0), I('it-dough','Pizza dough','box','sup-bakery',1), I('it-buns','Burger buns','pack','sup-bakery',2),
      I('it-chick','Chicken breast','kg','sup-meat',0), I('it-beef','Minced beef','kg','sup-meat',1),
      I('it-flour','Flour (00)','bag','sup-dry',0), I('it-oil','Olive oil','bottle','sup-dry',1), I('it-penne','Penne','pack','sup-dry',2), I('it-cantom','Canned tomatoes','can','sup-dry',3)
    ];
    const byId = Object.fromEntries(items.map(i=>[i.id,i]));
    const supName = id => suppliers.find(s=>s.id===id).name;
    const order = (day, h, mi, by, lines) => {
      const entries = [];
      for(const [itemId, qty] of lines){
        const it = byId[itemId];
        let e = entries.find(x=>x.supplierId===it.supplierId);
        if(!e){ e = {supplierId:it.supplierId, supplierName:supName(it.supplierId), items:[]}; entries.push(e); }
        e.items.push({itemId, name:it.name, unit:it.unit, qty});
      }
      return {id:'ord-'+day+'-'+h+mi, date:atBaghdad(now.y, now.m, day, h, mi), by, entries};
    };
    const plans = [
      ['rozha', [['it-mozz',4],['it-ric',2],['it-tom',12],['it-basil',6],['it-ciab',30],['it-dough',2]]],
      ['yunis', [['it-tom',15],['it-onion',1],['it-lemon',3],['it-ciab',40],['it-buns',4]]],
      ['rozha', [['it-mozz',5],['it-cream',2],['it-eggs',3],['it-chick',8],['it-beef',6]]],
      ['yunis', [['it-tom',10],['it-basil',8],['it-mush',2],['it-flour',2],['it-oil',4]]],
      ['rozha', [['it-mozz',4],['it-parm',1],['it-tom',12],['it-garlic',1],['it-dough',3]]],
      ['yunis', [['it-ciab',35],['it-buns',3],['it-lettuce',10],['it-lemon',2]]]
    ];
    const history = [];
    let k = 0;
    for(let day = now.d - 1; day >= 1 && k < plans.length; day--, k++){
      history.push(order(day, 9 + (k % 2), 12 + k*7, plans[k][0], plans[k][1]));
    }
    history.reverse();
    // Today: the morning order already went out (09:40), so only Zakho Dairy is late, like a normal day.
    if(now.h*60 + now.mi > 9*60 + 40) history.push(order(now.d, 9, 40, 'yunis', [['it-tom',12],['it-basil',6],['it-onion',1],['it-ciab',30],['it-dough',2],['it-chick',6]]));
    const actTs = n => new Date(Date.now() - n*3600000).toISOString();
    const activity = [
      {id:'aud-1', ts:actTs(30), actor:'rozha', action:'add', type:'item', name:'Mushrooms', fields:[{k:'name',to:'Mushrooms'},{k:'unit',to:'kg'},{k:'supplier',to:'Erbil Veg Market'}]},
      {id:'aud-2', ts:actTs(52), actor:'yunis', action:'edit', type:'supplier', name:'Ankawa Bakery', fields:[{k:'phone',from:'07505550000',to:'07505556677'}]},
      {id:'aud-3', ts:actTs(80), actor:'rozha', action:'add', type:'supplier', name:'Suli Dry Goods', fields:[{k:'name',to:'Suli Dry Goods'}]}
    ];
    const morning = atBaghdad(now.y, now.m, now.d, Math.min(9, now.h), 0);
    const inbox = [
      {id:1, kind:'cheer', mood:'excited', read:false, at:morning,
       en:'Good morning, Rozha! ☀️ 3 suppliers are due today: Zakho Dairy, Erbil Veg Market, Ankawa Bakery. Let’s get the orders out on time!',
       ku:'بەیانیت باش ڕۆژا! ☀️ ئەمڕۆ کاتی داواکاریی ٣ دابینکەرە: Zakho Dairy، Erbil Veg Market، Ankawa Bakery. با بە کاتی خۆی بینێرین!',
       ar:'صباح الخير يا روژا! ☀️ اليوم موعد 3 من المورّدين: Zakho Dairy، Erbil Veg Market، Ankawa Bakery. لنرسل الطلبات في وقتها!'}
    ];
    items.find(i=>i.id==='it-tom').note = 'Ripe, not soft';
    const today = bag(new Date());
    const iso = (y, m, d) => new Date(Date.UTC(y, m-1, d)).toISOString().slice(0,10);
    const lastDay = history.length && history[history.length-1].date.slice(0,10) === new Date().toISOString().slice(0,10) ? iso(today.y, today.m, today.d) : iso(today.y, today.m, today.d - 1);
    const streak = {count:12, best:18, last_day:lastDay, lost_count:0, lost_day:null, prev:null};
    const notes = [
      {id:1, body:'Please check the fridge temperature before closing tonight.', at:new Date(Date.now()-26*3600000).toISOString(), readAt:new Date(Date.now()-25*3600000).toISOString(), doneAt:new Date(Date.now()-24*3600000).toISOString()},
      {id:2, body:'Order extra basil for the weekend, we have a big group on Friday.', at:new Date(Date.now()-50*60000).toISOString(), readAt:null, doneAt:null}
    ];
    const weather = {temp:24, code:3, rain:false, snow:false, max:27, min:14, rainChance:10, dayCode:3, updatedAt:new Date().toISOString()};
    const chats = [{id:'0b7c4a9e-1f2d-4c3b-9a8e-7d6c5b4a3f21', account:'yunis', title:'How much mozzarella last week?', createdAt:new Date(Date.now()-5*3600000).toISOString(), updatedAt:new Date(Date.now()-5*3600000).toISOString(),
      messages:[{role:'user', text:'How much mozzarella did we order last week?', ts:Date.now()-5*3600000}, {role:'assistant', mood:'calm', text:'About **13 kg** over 3 orders, Yunis. Thursday was the biggest at 5 kg.', ts:Date.now()-5*3600000+4000}]}];
    return {v:4, units, suppliers, items, history, activity, inbox, chats, themes:{rozha:'ricotta', yunis:'ocean'}, autoThemes:{rozha:true, yunis:true}, pins:{rozha:['it-tom','it-mozz'], yunis:[]}, streak, notes, weather, reminder:{enabled:true, time:'09:00'}, tabs:{}, seq:100, said:{}};
  }
  let db = lsGet(DB_KEY);
  if(!db || db.v !== 4) db = seed();
  const save = () => lsSet(DB_KEY, db);
  save();
  window.labResetData = () => { db = seed(); save(); };
  window.labDb = () => db;

  /* Signed in as Rozha when the Lab opens, so the real Order screen shows first. */
  /* After a sign-out the Lab shows the real sign-in keypad instead. */
  const sess = lsGet(LS+'apiSession');
  if(!db.signedOut && (!sess || String(sess.token||'').startsWith('lab-'))){
    const account = sess?.account === 'yunis' ? 'yunis' : 'rozha';
    lsSet(LS+'apiSession', {token:'lab-'+account, account, name:NAMES[account].en, tabs:db.tabs[account] || ['order','assistant','history'], theme:db.themes[account], expiresAt:new Date(Date.now()+18*3600000).toISOString()});
  }

  /* ---- Rico's words for the special themes (also used by lab-themes.js) ---- */
  const T3 = (en, ku, ar) => ({en, ku, ar});
  window.LAB_RICO = {
    halloween:{mood:'excited', hello:T3('BOO! 👻 Did I scare you? Happy Halloween! I’m guarding the pumpkins until the order goes out.','بوو! 👻 ترساندمت؟ هالۆوینت پیرۆز بێت! تا داواکارییەکە دەنێردرێت پاسەوانی کولەکەکان دەکەم.','بووو! 👻 هل أخفتك؟ هالوين سعيد! سأحرس اليقطين حتى يُرسل الطلب.'),
      reply:T3('👻 *spooky voice* ','👻 *دەنگی ترسناک* ','👻 *بصوت مخيف* '), peek:T3('BOOO!','بوووو!','بووووو!'), peek2:T3('Haha, got you! It’s only me, Rico. 🎃','هاها، ترساندمت! تەنها منم، ریکۆ. 🎃','هاها، أمسكتك! إنه أنا فقط، ريكو. 🎃')},
    winter:{mood:'worried', hello:T3('Brrr… 🥶 It’s freezing up at the citadel today. Hot soup on the menu? I can add lentils and onions to the order.','بڕڕڕ… 🥶 ئەمڕۆ لای قەڵا زۆر ساردە. شۆربای گەرم؟ دەتوانم نیسک و پیاز بخەمە داواکارییەکە.','بررر… 🥶 الجو متجمد عند القلعة اليوم. شوربة ساخنة؟ أستطيع إضافة العدس والبصل للطلب.'),
      reply:T3('Brrr… 🥶 ','بڕڕڕ… 🥶 ','بررر… 🥶 '), peek:T3('Brrr… so cold! 🥶','بڕڕڕ… زۆر ساردە! 🥶','بررر… الجو بارد جدًا! 🥶'), peek2:T3('My fingers are frozen. Order something warm, please?','پەنجەکانم بەستوون. شتێکی گەرم داوا بکە تکایە؟','أصابعي متجمدة. اطلب شيئًا دافئًا من فضلك؟')},
    newroz:{mood:'excited', hello:T3('Newroz pîroz be! 🔥🌼 Happy Kurdish New Year! The kitchen will be busy, so let’s order a bit extra today.','نەورۆزتان پیرۆز بێت! 🔥🌼 ساڵی نوێی کوردی پیرۆز! چێشتخانە قەرەباڵغ دەبێت، با ئەمڕۆ کەمێک زیاتر داوا بکەین.','نوروز مبارك! 🔥🌼 سنة كردية جديدة سعيدة! سيكون المطبخ مزدحمًا، فلنطلب أكثر قليلًا اليوم.'),
      reply:T3('🌼 ','🌼 ','🌼 '), peek:T3('Newroz pîroz be! 🔥','نەورۆز پیرۆز بێت! 🔥','نوروز مبارك! 🔥'), peek2:T3('I’m dancing the govend! Join me after the orders are out.','گۆڤەند دەگێڕم! دوای ناردنی داواکارییەکان وەرە.','أرقص الدبكة! انضم إليّ بعد إرسال الطلبات.')},
    ramadan:{mood:'calm', hello:T3('Ramadan Kareem 🌙 Iftar is in a few hours. Let’s send the orders early so everything arrives before sunset.','ڕەمەزانتان پیرۆز بێت 🌙 چەند کاتژمێرێکی ماوە بۆ بەربانگ. با زوو بینێرین بۆ ئەوەی هەموو شت پێش ئاوابوونی خۆر بگات.','رمضان كريم 🌙 الإفطار بعد ساعات. لنرسل الطلبات مبكرًا ليصل كل شيء قبل الغروب.'),
      reply:T3('🌙 ','🌙 ','🌙 '), peek:T3('Ramadan Kareem 🌙','ڕەمەزان پیرۆز 🌙','رمضان كريم 🌙'), peek2:T3('I lit a lantern for the kitchen. Dates for iftar are on the list?','چرایەکم بۆ چێشتخانە داگیرساند. خورما بۆ بەربانگ لە لیستەکەدایە؟','أشعلت فانوسًا للمطبخ. هل التمر للإفطار في القائمة؟')},
    summer:{mood:'happy', hello:T3('It’s 46°C in Erbil! 😎 I’m hiding in Shaqlawa. Keep the mozzarella and cream cold, and maybe order extra lemons for lemonade.','پلەی گەرما ٤٦ە لە هەولێر! 😎 من لە شەقڵاوە خۆم شاردۆتەوە. مۆزارێلا و قەیماغ سارد ڕابگرە، و لیمۆی زیاتر بۆ لیمۆناتە داوا بکە.','الحرارة 46 درجة في أربيل! 😎 أنا مختبئ في شقلاوة. أبقِ الموزاريلا والكريمة باردة، واطلب ليمونًا إضافيًا للعصير.'),
      reply:T3('😎 ','😎 ','😎 '), peek:T3('Phew, it’s hot! 😎','ئۆف، گەرمە! 😎','أوف، الجو حار! 😎'), peek2:T3('I’m melting like the mozzarella. Is the fridge order in?','وەک مۆزارێلا دەتوێمەوە. داواکاریی سەلاجەکە نێردرا؟','أذوب مثل الموزاريلا. هل أُرسل طلب الثلاجة؟')}
  };

  /* ---- helpers ---- */
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
  const ok = () => json({ok:true});
  const fail = (error, status = 400) => json({error}, status);
  const monthStartIso = () => { const n = bag(new Date()); return atBaghdad(n.y, n.m, 1, 0, 0); };
  const tokenAccount = h => { const t = h['x-session-token'] || ''; return t === 'lab-rozha' ? 'rozha' : t === 'lab-yunis' ? 'yunis' : null; };
  const deviceId = () => { try{ return JSON.parse(localStorage.getItem(LS+'deviceId')); }catch(_){ return null; } };
  const devices = account => {
    const now = new Date().toISOString(), earlier = new Date(Date.now()-2*3600000).toISOString();
    const list = [
      {id:deviceId() || 'this-device', account, label:'Mac|Website', loggedIn:true, lastLogin:earlier, lastSeen:now, command:null, handledCommand:null},
      {id:'lab-phone-yunis', account:'yunis', label:'iPhone 16 Pro|App', loggedIn:true, lastLogin:earlier, lastSeen:new Date(Date.now()-6*60000).toISOString(), command:null, handledCommand:null},
      {id:'lab-phone-rozha', account:'rozha', label:'iPhone 16/17 Pro Max|App', loggedIn:true, lastLogin:earlier, lastSeen:new Date(Date.now()-40*60000).toISOString(), command:null, handledCommand:null}
    ];
    return account === 'rozha' ? list : list.slice(0,1);
  };
  const history = () => db.history.filter(o => o.date >= monthStartIso());
  const lang = l => ['en','ku','ar'].includes(l) ? l : 'en';
  window.labInboxSay = (kind, mood, words, key) => {
    if(key && db.said[key]) return false;
    if(key) db.said[key] = true;
    db.inbox.push({id:++db.seq, kind, mood, en:words.en, ku:words.ku, ar:words.ar, at:new Date().toISOString(), read:false});
    db.inbox = db.inbox.slice(-20);
    save();
    return true;
  };

  /* Rico's chat, streamed line by line like the real server. */
  function ricoReply(account, body){
    const L = lang(body.lang);
    const last = [...(body.messages||[])].reverse().find(m=>m.role==='user');
    const q = String(last?.text || last?.content || '').toLowerCase();
    const theme = db.themes[account];
    const special = window.LAB_RICO[theme];
    const name = NAMES[account][L];
    const events = [];
    const say = (mood, en, ku, ar) => { events.push({type:'mood', mood}); events.push({type:'text', text:(special ? special.reply[L] : '') + ({en, ku, ar})[L]}); };
    const wantsOrder = /order|prepar|suggest|usual|داواکاری|ئامادە|طلب|جهز|veg|tomato/.test(q) || body.quickAction;
    if(/streak|زنجیرە|سلسلة/.test(q)){
      const st = streakView();
      if(st.recoverable){
        say('excited', `Of course! Tap the card and your ${st.recoverable}-day streak is back. It's free.`, `بێگومان! کارتەکە دابگرە و زنجیرەی ${st.recoverable} ڕۆژەکەت دەگەڕێتەوە. بەخۆڕاییە.`, `بالتأكيد! اضغط البطاقة وتعود سلسلة الـ${st.recoverable} يومًا. مجانًا.`);
        events.push({type:'proposal', proposal:{id:'p'+Date.now().toString(36), kind:'streak', days:st.recoverable}});
      } else say('happy', `Your streak is alive: ${st.count} days. Keep it going!`, `زنجیرەکەت زیندووە: ${st.count} ڕۆژ. بەردەوام بە!`, `سلسلتك حية: ${st.count} يومًا. استمر!`);
    } else if(wantsOrder){
      const lines = ['it-tom','it-basil','it-onion','it-lemon'].map((id, i)=>{ const it = db.items.find(x=>x.id===id); return it && {itemId:it.id, name:it.name, unitId:it.unit, supplierId:it.supplierId, supplier:'Erbil Veg Market', qty:[12,6,1,3][i]}; }).filter(Boolean);
      say('excited',
        `Here is what I’d order from Erbil Veg Market today, ${name}, based on your usual orders. Tap the card to put it in today’s order. Nothing is sent until you press Send.`,
        `${name}، ئەمە ئەوەیە کە ئەمڕۆ لە Erbil Veg Market داوای دەکەم، بەپێی داواکارییە ئاساییەکانت. کارتەکە دابگرە بۆ ئەوەی بچێتە داواکاریی ئەمڕۆ. هیچ شتێک نانێردرێت تا ناردن دانەگریت.`,
        `يا ${name}، هذا ما سأطلبه اليوم من Erbil Veg Market بناءً على طلباتك المعتادة. اضغط البطاقة لإضافته إلى طلب اليوم. لا يُرسل شيء حتى تضغط إرسال.`);
      events.push({type:'proposal', proposal:{id:'p'+Date.now().toString(36), kind:'order', mode:'replace', note:'', lines}});
    } else if(/thank|سوپاس|شكر|merci/.test(q)){
      say('grateful', `Any time, ${name}! That’s what I’m here for.`, `هەر کاتێک ${name}! بۆ ئەوە لێرەم.`, `في أي وقت يا ${name}! هذا ما أنا هنا من أجله.`);
    } else if(/late|due|forgot|دواکەوت|متأخر/.test(q)){
      say('worried', 'Zakho Dairy was due at 10:00 and hasn’t gone out yet. Want me to prepare it?', 'Zakho Dairy کاتژمێر ١٠:٠٠ بوو و هێشتا نەنێردراوە. با ئامادەی بکەم؟', 'طلب Zakho Dairy كان موعده 10:00 ولم يُرسل بعد. هل أجهّزه؟');
    } else if(/angry|mad|تووڕە|غاضب/.test(q)){
      say('angry', 'Grr! Don’t make me angry, I’ll hide the basil. 😤 Just kidding.', 'گڕڕ! تووڕەم مەکە، ڕەیحانەکە دەشارمەوە. 😤 گاڵتە دەکەم.', 'غرر! لا تغضبني، سأخبئ الريحان. 😤 أمزح فقط.');
    } else {
      say(special ? special.mood : 'happy',
        `Hi ${name}! I’m Rico in the Lab, so I’m answering from sample data here. Ask me to prepare an order, what’s late today, or just say thanks and watch my face change.`,
        `سڵاو ${name}! من ریکۆم لە تاقیگەدا، بۆیە لێرە لە زانیاریی نموونەوە وەڵام دەدەمەوە. داوام لێ بکە داواکارییەک ئامادە بکەم، چی دواکەوتووە، یان تەنها سوپاس بکە و سەیری دەموچاوم بکە.`,
        `مرحبًا يا ${name}! أنا ريكو في المختبر، لذلك أجيب هنا من بيانات تجريبية. اطلب مني تجهيز طلب، أو ما المتأخر اليوم، أو قل شكرًا وشاهد وجهي يتغير.`);
    }
    // Split the text into small pieces so it types out like the real stream.
    const out = [];
    for(const ev of events){
      if(ev.type !== 'text'){ out.push(ev); continue; }
      const parts = ev.text.match(/\S+\s*/g) || [ev.text];
      for(let i = 0; i < parts.length; i += 2) out.push({type:'text', text:parts.slice(i, i+2).join('')});
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller){
        await new Promise(r=>setTimeout(r, 700));
        for(const ev of out){ controller.enqueue(enc.encode(JSON.stringify(ev)+'\n')); await new Promise(r=>setTimeout(r, ev.type==='text' ? 45 : 120)); }
        controller.close();
      }
    });
    return new Response(stream, {status:200, headers:{'Content-Type':'application/x-ndjson'}});
  }

  /* ---- The kitchen streak, with the same rules as the database functions ---- */
  const dayOf = d => { const b = bag(new Date(d)); return new Date(Date.UTC(b.y, b.m-1, b.d)).toISOString().slice(0,10); };
  const todayKey = () => window.RICOTTA_TODAY || dayOf(new Date());
  const diff = (a, b) => Math.round((Date.parse(a+'T00:00:00Z') - Date.parse(b+'T00:00:00Z')) / 86400000);
  const addDays = (a, n) => new Date(Date.parse(a+'T00:00:00Z') + n*86400000).toISOString().slice(0,10);
  function streakView(){
    const r = db.streak, today = todayKey(), last = r.last_day, gap = last ? diff(today, last) : 99;
    const alive = r.count > 0 && gap <= 1;
    const recoverable = !alive && r.count > 0 && gap <= 8 ? r.count : r.lost_count > 0 && r.lost_day && diff(today, r.lost_day) <= 7 ? r.lost_count : 0;
    return {count:alive ? r.count : 0, best:r.best, lit:alive && gap === 0, alive, recoverable, lastDay:last};
  }
  function streakHit(day){
    const r = db.streak;
    if(r.last_day && day <= r.last_day) return {changed:false};
    r.prev = {day, count:r.count, best:r.best, last_day:r.last_day, lost_count:r.lost_count, lost_day:r.lost_day};
    if(r.last_day && day === addDays(r.last_day, 1)) r.count++;
    else { if(r.count > 0 && r.last_day){ r.lost_count = r.count; r.lost_day = addDays(r.last_day, 1); } r.count = 1; }
    r.best = Math.max(r.best, r.count); r.last_day = day;
    return {changed:true, milestone:[7,14,30,60,100,150,200,300,365,500,1000].includes(r.count), count:r.count};
  }
  function streakUnhit(day){
    if(db.history.some(o=>dayOf(o.date) === day)) return;
    const r = db.streak;
    if(!r.prev || r.last_day !== day || r.prev.day !== day) return;
    Object.assign(r, {count:r.prev.count, best:r.prev.best, last_day:r.prev.last_day, lost_count:r.prev.lost_count, lost_day:r.prev.lost_day, prev:null});
  }
  function streakRecover(){
    const r = db.streak, today = todayKey();
    if(r.count > 0 && r.last_day && r.last_day < addDays(today, -1)){ if(r.last_day < addDays(today, -8)) return false; r.last_day = addDays(today, -1); }
    else if(r.lost_count > 0 && r.lost_day && r.lost_day >= addDays(today, -7)) r.count = r.lost_count + r.count;
    else return false;
    r.best = Math.max(r.best, r.count); r.lost_count = 0; r.lost_day = null; r.prev = null;
    return true;
  }
  window.labStreakBreak = () => { db.streak.last_day = addDays(todayKey(), -3); save(); };
  window.labStreakSet = (count, lit) => { db.streak.count = count; db.streak.best = Math.max(db.streak.best, count); db.streak.last_day = lit ? todayKey() : addDays(todayKey(), -1); db.streak.prev = null; save(); };

  /* ---- the router ---- */
  let query = new URLSearchParams();
  async function handle(path, method, headers, body){
    await new Promise(r=>setTimeout(r, 120 + Math.random()*180));   // a little network time
    if(method === 'POST' && path === 'login'){
      const pin = String(body.pin || '');
      if(!/^\d{6}$/.test(pin)) return fail('invalid_credentials', 401);
      const account = pin === '222222' ? 'yunis' : 'rozha';
      db.signedOut = false; save();
      return json({token:'lab-'+account, account, name:NAMES[account].en, tabs:db.tabs[account] || ['order','assistant','history'], theme:db.themes[account], expiresAt:new Date(Date.now()+18*3600000).toISOString()});
    }
    if(path.startsWith('recovery/')) return fail('invalid_credentials', 401);
    if(method === 'GET' && path === 'health') return ok();
    const account = tokenAccount(headers);
    if(!account) return fail('unauthorized', 401);
    let m;
    if(method === 'GET' && path === 'bootstrap'){
      const me = account;
      return json({
        account:me, name:NAMES[me].en, tabs:db.tabs[me] || ['order','assistant','history'], views:ACCOUNT_VIEWS[me],
        theme:db.themes[me], themes:{...db.themes}, suppliers:db.suppliers, items:db.items, units:db.units,
        history:history(), historyMonth:monthStartIso().slice(0,7), reminder:db.reminder, devices:devices(me),
        activity:db.activity.filter(a=>a.ts >= monthStartIso()), inbox:db.inbox.slice(-20),
        autoTheme:db.autoThemes[me] !== false, autoThemes:{...db.autoThemes}, pins:db.pins[me] || [], streak:streakView(), notes:db.notes, weather:db.weather
      });
    }
    if(method === 'POST' && path === 'logout'){ db.signedOut = true; save(); return ok(); }
    if(method === 'PUT' && path === 'me/tabs'){ db.tabs[account] = body.tabs; save(); return ok(); }
    if(method === 'PUT' && path === 'me/pins'){ db.pins[account] = (body.itemIds || []).slice(0, 60); save(); return ok(); }
    if(method === 'GET' && path === 'streak') return json(streakView());
    if(method === 'POST' && path === 'streak/recover'){ if(!streakRecover()) return fail('nothing_to_recover', 409); save(); return json({ok:true, streak:streakView()}); }
    if(method === 'GET' && path === 'notes') return json(db.notes);
    if(method === 'POST' && path === 'notes'){
      if(account !== 'rozha') return fail('forbidden', 403);
      const n = {id:++db.seq, body:String(body.body||'').slice(0,500), at:new Date().toISOString(), readAt:null, doneAt:null};
      db.notes.unshift(n); save(); return json(n);
    }
    if((m = path.match(/^notes\/(\d+)(?:\/(read|done))?$/))){
      const n = db.notes.find(x=>x.id === Number(m[1]));
      if(method === 'DELETE'){ if(account !== 'rozha') return fail('forbidden', 403); db.notes = db.notes.filter(x=>x !== n); save(); return ok(); }
      if(!n || account === 'rozha') return fail('forbidden', 403);
      if(m[2] === 'read'){ n.readAt = n.readAt || new Date().toISOString(); }
      else { n.doneAt = body.done === false ? null : new Date().toISOString(); n.readAt = n.readAt || n.doneAt; }
      save(); return ok();
    }
    if(method === 'PUT' && path === 'me/theme'){
      if(typeof body.auto === 'boolean'){ db.autoThemes[account] = body.auto; save(); if(body.theme === undefined) return ok(); }
      if(!ALL_THEMES.includes(body.theme)) return fail('invalid_theme');
      db.themes[account] = body.theme; save();
      const r = window.LAB_RICO[body.theme];
      if(r){
        const day = new Date().toISOString().slice(0,10);
        const n = NAMES[account];
        const named = x => ({en:x.en.replace('Rozha', n.en), ku:x.ku.replace('ڕۆژا', n.ku), ar:x.ar.replace('روژا', n.ar)});
        window.labInboxSay('theme', r.mood, named(r.hello), `theme|${body.theme}|${account}|${day}`);
      }
      return ok();
    }
    if(method === 'PUT' && (m = path.match(/^supplier-order\/(.+)$/))){
      const sid = decodeURIComponent(m[1]);
      (body.itemIds||[]).forEach((id, i)=>{ const it = db.items.find(x=>x.id===id && x.supplierId===sid); if(it) it.sortOrder = i; });
      save(); return ok();
    }
    if((m = path.match(/^(suppliers|items|units)\/(.+)$/)) && (method === 'PUT' || method === 'DELETE')){
      const table = m[1], id = decodeURIComponent(m[2]);
      const list = db[table], idx = list.findIndex(x=>x.id===id), prev = idx >= 0 ? list[idx] : null;
      const type = table === 'suppliers' ? 'supplier' : table === 'items' ? 'item' : 'unit';
      if(method === 'DELETE'){
        if(idx >= 0) list.splice(idx, 1);
        if(table === 'suppliers') db.items.forEach(i=>{ if(i.supplierId === id) i.supplierId = null; });
        db.activity.unshift({id:'aud-'+(++db.seq), ts:new Date().toISOString(), actor:account, action:'delete', type, name:prev ? (prev.name || prev.en) : id, fields:[]});
      } else {
        let row;
        if(table === 'suppliers') row = {id, name:String(body.name||'').slice(0,160), phone:body.phone || null, reminder:body.reminder || null};
        else if(table === 'items') row = {id, name:String(body.name||'').slice(0,160), unit:body.unit || null, supplierId:body.supplierId || null, note:'note' in body ? String(body.note||'').slice(0,120) : (prev ? prev.note || '' : ''), sortOrder:'sortOrder' in body ? body.sortOrder : (prev ? prev.sortOrder : null)};
        else row = {id, en:String(body.en||'').slice(0,80), ku:body.ku || null, ar:body.ar || null};
        if(idx >= 0) list[idx] = row; else list.push(row);
        db.activity.unshift({id:'aud-'+(++db.seq), ts:new Date().toISOString(), actor:account, action:prev ? 'edit' : 'add', type, name:row.name || row.en, fields:prev ? [] : [{k:'name', to:row.name || row.en}]});
      }
      save(); return ok();
    }
    if(method === 'POST' && path === 'orders'){
      if(!Array.isArray(body.entries) || !body.entries.length) return fail('invalid_order');
      if(!db.history.some(o=>o.id===body.id)){
        db.history.push({id:body.id, date:body.date || new Date().toISOString(), by:account,
          entries:body.entries.map(e=>({supplierId:e.supplierId || null, supplierName:e.supplierName || (db.suppliers.find(s=>s.id===e.supplierId)||{}).name || null, items:(e.items||[]).map(i=>({itemId:i.itemId, name:i.name, unit:i.unit, qty:Number(i.qty)}))}))});
        const n = NAMES[account], th = window.LAB_RICO[db.themes[account]];
        const words = th ? {en:th.peek2.en, ku:th.peek2.ku, ar:th.peek2.ar} : {en:`Nice one, ${n.en}! The order is out.`, ku:`دەستت خۆش بێت ${n.ku}! داواکارییەکە نێردرا.`, ar:`أحسنت يا ${n.ar}! تم إرسال الطلب.`};
        window.labInboxSay('cheer', th ? th.mood : 'happy', words, `sent|${account}|${new Date().toISOString().slice(0,10)}`);
        const hit = streakHit(window.RICOTTA_TODAY || dayOf(body.date || new Date()));
        if(hit.milestone) window.labInboxSay('streak', 'excited', {en:`🔥 ${hit.count} days in a row! Keep the fire going!`, ku:`🔥 ${hit.count} ڕۆژ لەسەر یەک! ئاگرەکە بە گڕ ڕابگرە!`, ar:`🔥 ${hit.count} يومًا متتاليًا! حافظ على النار!`}, 'streak|'+hit.count);
        save();
      }
      return json({ok:true, streak:streakView()});
    }
    if(method === 'DELETE' && (m = path.match(/^orders\/(.+)$/))){
      const o = db.history.find(x=>x.id === decodeURIComponent(m[1]));
      if(!o) return json({ok:true, streak:streakView()});
      if(account !== 'rozha' && (o.by !== account || Date.now() - Date.parse(o.date) > 15*60000)) return fail('forbidden', 403);
      db.history = db.history.filter(x=>x !== o);
      streakUnhit(window.RICOTTA_TODAY || dayOf(o.date));
      save(); return json({ok:true, streak:streakView()});
    }
    if(method === 'GET' && path === 'activity') return json(db.activity.filter(a=>a.ts >= monthStartIso()));
    if(method === 'GET' && path === 'devices') return json(devices(account));
    if(path === 'devices/me' || path === 'devices/me/ack' || path === 'devices/command') return ok();
    if((m = path.match(/^rico-chats(?:\/(.+))?$/))){
      const id = m[1] ? decodeURIComponent(m[1]) : null;
      if(method === 'GET' && !id) return json({chats:[...db.chats].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(c=>({id:c.id, account:c.account, title:c.title, createdAt:c.createdAt, updatedAt:c.updatedAt}))});
      if(method === 'GET'){ const c = db.chats.find(x=>x.id===id); return c ? json(c) : fail('Chat not found', 404); }
      if(method === 'PUT'){
        const now = new Date().toISOString();
        const c = db.chats.find(x=>x.id===id);
        if(c && c.account !== account) return fail('Chat not found', 404);
        if(c){ c.title = body.title || c.title; c.messages = body.messages; c.updatedAt = now; }
        else db.chats.push({id, account, title:String(body.title||''), messages:body.messages, createdAt:now, updatedAt:now});
        db.chats = db.chats.slice(-30); save(); return ok();
      }
      if(method === 'DELETE'){ const whose = query.get('account') || account; db.chats = db.chats.filter(c=>id ? c.id !== id : c.account !== whose); save(); return ok(); }
    }
    if(method === 'POST' && path === 'assistant/chat') return ricoReply(account, body);
    if(method === 'POST' && path === 'assistant/transcribe') return fail('transcribe_unavailable', 503);
    if(method === 'GET' && path === 'assistant/suggestion'){
      const pick = ids => ids.map(([id, qty])=>{ const it = db.items.find(x=>x.id===id); return it && {itemId:it.id, name:it.name, unitId:it.unit, qty}; }).filter(Boolean);
      return json({suggestion:{supplierId:'sup-dairy', supplier:'Zakho Dairy', due:false, reminder:'10:00', basis:'recent', weekday:new Date().getDay(),
        lines:pick([['it-mozz',4],['it-ric',2],['it-cream',1],['it-eggs',3]]), others:['Erbil Veg Market','Ankawa Bakery']}});
    }
    if(method === 'GET' && path === 'assistant/inbox') return json(db.inbox.slice(-20));
    if(method === 'POST' && path === 'assistant/inbox/read'){ db.inbox.forEach(x=>x.read = true); save(); return ok(); }
    if(method === 'GET' && path === 'assistant/status') return json({configured:true, model:'gemini-2.5-flash', provider:'gemini', fallback:false});
    if(method === 'GET' && path === 'assistant/setup-status') return json({groqConfigured:true});
    if(method === 'PUT' && path === 'assistant/groq-key') return fail('already_configured', 409);
    if(path === 'push/subscription' || path === 'push/lang') return ok();
    if(method === 'POST' && path === 'push/send') return json({sent:0, failed:0, removed:0, lab:true});
    if(method === 'PUT' && path === 'reminder'){ db.reminder = {enabled:!!body.enabled, time:String(body.time||'09:00')}; save(); return ok(); }
    return fail('not_found', 404);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const at = url.indexOf('/functions/v1/api/');
    if(at < 0) return realFetch(input, init);
    const rest = url.slice(at + '/functions/v1/api/'.length), path = rest.split('?')[0];
    query = new URLSearchParams(rest.split('?')[1] || '');
    const method = (init.method || 'GET').toUpperCase();
    const headers = {};
    const h = init.headers || {};
    if(h instanceof Headers) h.forEach((v, k)=>{ headers[k.toLowerCase()] = v; }); else Object.keys(h).forEach(k=>{ headers[k.toLowerCase()] = h[k]; });
    let body = {};
    try{ body = init.body ? JSON.parse(init.body) : {}; }catch(_){}
    if(init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return handle(path, method, headers, body || {});
  };
})();
