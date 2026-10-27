/* Ricotta Lab: a pretend server for the real app.
   The app's own files run unchanged. Every request to the `api` Edge Function
   is answered here from sample data kept in this browser, so nothing reaches
   the real Supabase project and no real kitchen data is shown.
   Loads before every other script. */
(function(){
  document.documentElement.classList.add('booting');
  const LS = 'ricottaOrders:';
  const DB_KEY = 'ricottaLab:db';
  /* The same roles and screens as the server (supabase/functions/api/index.ts). */
  const ROLES = ['history','manage','catalog','record','transfers','assistant','send','exports','notify','reminders'];
  const DEFAULT_ROLES = ROLES.filter(r=>r !== 'transfers');
  const rolesOf = account => account === 'rozha' ? [...ROLES] : Array.isArray(db.roles?.yunis) ? ROLES.filter(r=>db.roles.yunis.includes(r)) : [...DEFAULT_ROLES];
  const can = (account, role) => account === 'rozha' || (rolesOf(account).includes(role) && (role !== 'catalog' || rolesOf(account).includes('manage')));
  const viewsFor = a => ['order', ...(can(a,'assistant') ? ['assistant'] : []), ...(can(a,'history') ? ['history'] : []), ...(can(a,'transfers') ? ['transfers'] : []),
    ...(can(a,'manage') ? ['manage','suppliers','itemsAdmin','units'] : []), ...(can(a,'record') ? ['record'] : []), ...(a === 'rozha' ? ['admin'] : []), 'settings'];
  const NAMES = {rozha:{en:'Rozha',ku:'ڕۆژا',ar:'روژا'}, yunis:{en:'Yunis',ku:'یونس',ar:'يونس'}};

  const lsGet = k => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(_){ return null; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
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
      {id:'kg', en:'کیلۆگرام'},{id:'g', en:'گرام'},{id:'l', en:'لیتر'},
      {id:'piece', en:'دانە'},{id:'carton', en:'کارتۆن'},{id:'box', en:'سندوق'},
      {id:'pack', en:'پاکەت'},{id:'bag', en:'کیسە'},{id:'bottle', en:'بوتڵ'},
      {id:'can', en:'قوتی'},{id:'tray', en:'سینی'},{id:'bunch', en:'دەستە'}
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
       en:'Good morning, Rozha! 3 suppliers are due today: Zakho Dairy, Erbil Veg Market, Ankawa Bakery. Let’s get the orders out on time.',
       ku:'بەیانیت باش ڕۆژا! ئەمڕۆ کاتی داواکاریی 3 دابینکەرە: Zakho Dairy، Erbil Veg Market، Ankawa Bakery. با بە کاتی خۆی بینێرین.',
       ar:'صباح الخير يا روژا! اليوم موعد 3 من المورّدين: Zakho Dairy، Erbil Veg Market، Ankawa Bakery. لنرسل الطلبات في وقتها.'}
    ];
    items.find(i=>i.id==='it-tom').note = 'Ripe, not soft';
    const today = bag(new Date());
    const iso = (y, m, d) => new Date(Date.UTC(y, m-1, d)).toISOString().slice(0,10);
    const lastDay = history.length && history[history.length-1].date.slice(0,10) === new Date().toISOString().slice(0,10) ? iso(today.y, today.m, today.d) : iso(today.y, today.m, today.d - 1);
    const streak = {count:12, best:18, last_day:lastDay, lost_count:0, lost_day:null, prev:null};
    const weather = {temp:24, code:3, rain:false, snow:false, max:27, min:14, rainChance:10, dayCode:3, updatedAt:new Date().toISOString()};
    const chats = [{id:'0b7c4a9e-1f2d-4c3b-9a8e-7d6c5b4a3f21', account:'yunis', title:'How much mozzarella last week?', createdAt:new Date(Date.now()-5*3600000).toISOString(), updatedAt:new Date(Date.now()-5*3600000).toISOString(),
      messages:[{role:'user', text:'How much mozzarella did we order last week?', ts:Date.now()-5*3600000}, {role:'assistant', mood:'calm', text:'About **13 kg** over 3 orders, Yunis. Thursday was the biggest at 5 kg.', ts:Date.now()-5*3600000+4000}]}];
    // Admin's sample logs: a few sign-ins, a wrong PIN, a new phone, two problems and two weeks of time in the app.
    const ago = mins => new Date(Date.now() - mins*60000).toISOString();
    const security = [
      {id:7, at:ago(12), kind:'signin', account:'rozha', deviceId:'this-device', label:'Mac|Website', detail:{}},
      {id:6, at:ago(95), kind:'wrong_pin', account:null, deviceId:'lab-phone-yunis', label:'iPhone 16 Pro|App', detail:{}},
      {id:5, at:ago(96), kind:'signin', account:'yunis', deviceId:'lab-phone-yunis', label:'iPhone 16 Pro|App', detail:{}},
      {id:4, at:ago(60*26), kind:'new_device', account:'yunis', deviceId:'lab-phone-yunis', label:'iPhone 16 Pro|App', detail:{}},
      {id:3, at:ago(60*26), kind:'signin', account:'yunis', deviceId:'lab-phone-yunis', label:'iPhone 16 Pro|App', detail:{}},
      {id:2, at:ago(60*50), kind:'pin_changed', account:'rozha', deviceId:'this-device', label:null, detail:{for:'yunis'}}
    ];
    const problems = [
      {id:2, fingerprint:'a1b2c3d4e5f60718', kind:'error', message:"TypeError: Cannot read properties of undefined (reading 'name')", source:'app.js:2400', stack:'at renderQueue (app.js:2400:41)\nat render (app.js:737:22)', screen:'queue', account:'yunis', deviceId:'lab-phone-yunis', label:'iPhone 16 Pro|App', version:'2026-10-24.3', count:3, firstAt:ago(300), lastAt:ago(40), resolvedAt:null},
      {id:1, fingerprint:'0f1e2d3c4b5a6978', kind:'manual', message:'The PDF button on the send screen opened a page with no way back.', source:null, stack:null, screen:'queue', account:'rozha', deviceId:'lab-phone-rozha', label:'iPhone 16/17 Pro Max|App', version:'2026-10-24.3', count:1, firstAt:ago(60*20), lastAt:ago(60*20), resolvedAt:null}
    ];
    const usage = [];
    for(let d = 69; d >= 0; d--){
      const day = new Date(Date.now() - d*86400000).toISOString().slice(0,10);
      usage.push({account:'rozha', deviceId:'this-device', label:'Mac|Website', day, seconds:1200 + ((d*733) % 2400)});
      usage.push({account:'yunis', deviceId:'lab-phone-yunis', label:'iPhone 16 Pro|App', day, seconds:2400 + ((d*911) % 3600)});
      if(d % 3 === 0) usage.push({account:'rozha', deviceId:'lab-phone-rozha', label:'iPhone 16/17 Pro Max|App', day, seconds:600 + d*40});
    }
    return {v:7, units, suppliers, items, history, activity, inbox, chats, pins:{rozha:['it-tom','it-mozz'], yunis:[]}, streak, weather, reminder:{enabled:true, time:'09:00'}, seq:100, said:{},
      roles:{yunis:null}, security, problems, usage};
  }
  /* Two finished months for the archive (History itself only keeps this month). */
  const LAB_MONTHS = [
    {month:'2026-09', orders:41, activeDays:22, lines:388, byPerson:{rozha:12, yunis:29}, byWeekday:[5,7,6,5,8,6,4],
      suppliers:[{name:'Zakho Dairy', orders:18, lines:96}, {name:'Erbil Veg Market', orders:15, lines:120}, {name:'Ankawa Bakery', orders:12, lines:40}],
      topItems:[{name:'Tomatoes', unit:'kg', times:15, qty:96}, {name:'Mozzarella', unit:'kg', times:14, qty:61}, {name:'Bread', unit:'pc', times:12, qty:540}]},
    {month:'2026-08', orders:36, activeDays:20, lines:330, byPerson:{rozha:16, yunis:20}, byWeekday:[4,6,5,6,7,5,3],
      suppliers:[{name:'Zakho Dairy', orders:16, lines:84}, {name:'Erbil Veg Market', orders:13, lines:101}],
      topItems:[{name:'Tomatoes', unit:'kg', times:13, qty:80}, {name:'Mozzarella', unit:'kg', times:12, qty:52}]}
  ];
  /* The workplace stock system's item list (Transfers), in its "English - کوردی" naming. */
  const STOCK_SEED = [
    ['Al Hadbaa Flour - ئاردی حەدبا', ['فەردە','کیلۆ']], ['Almonds - بادەم', ['کیلۆ']], ['Al Mudhish Milk - شیری مودهش', ['دانە','کارتۆن']],
    ['Bato Fries - پەتاتەی باتۆ', ['کارتۆن']], ['Aleppo Pepper - بیبەری حەلەب', ['کیلۆ']], ['Apple Cider Vinegar - سرکەی سێو', ['دانە']],
    ['Banoleya Bread - نانی بانۆلیا', ['سێت','دانە']], ['Barbecue Sauce - سۆسی باربیکیو', ['دانە','کارتۆن']], ['Beans - فاسۆلیا', ['فەردە','کیلۆ']],
    ['Tomatoes - تەماتە', ['کیلۆ','سندوق']], ['Onions - پیاز', ['فەردە','کیلۆ']], ['Mozzarella - مۆزارێلا', ['کیلۆ']],
    ['Eggs - هێلکە', ['کارتۆن','دانە']], ['Cucumber - خەیار', ['کیلۆ']], ['Lemons - لیمۆ', ['کیلۆ']], ['Sunflower Oil - ڕۆنی گوڵەبەڕۆژە', ['تەنەکە','دانە']],
    ['Black Tea - چای ڕەش', ['پاکەت','کارتۆن']], ['Sugar - شەکر', ['فەردە','کیلۆ']], ['Kebab Meat - گۆشتی کەباب', ['کیلۆ']], ['Chicken Breast - سنگی مریشک', ['کیلۆ','کارتۆن']],
    ['Pizza Cheese - پەنیری پیتزا', ['کیلۆ','کارتۆن']], ['Dish Soap - سابوونی قاپ', ['دانە','کارتۆن']], ['Mini Water - ئاوی بچووک', ['کارتۆن']], ['Pepsi Can - پیپسی قوتوو', ['کارتۆن','دانە']]
  ].map(([name, units], i)=>({id:'st-'+(i+1), name, units, aliases:[]}));
  let db = lsGet(DB_KEY);
  if(!db || db.v !== 7) db = seed();
  if(!Array.isArray(db.stock)) db.stock = STOCK_SEED.map(i=>({...i, units:[...i.units]}));
  const save = () => lsSet(DB_KEY, db);
  save();
  window.labResetData = () => { db = seed(); db.stock = STOCK_SEED.map(i=>({...i, units:[...i.units]})); save(); };
  window.labDb = () => db;

  /* Signed in as Rozha when the Lab opens, so the real Order screen shows first. */
  /* After a sign-out the Lab shows the real sign-in keypad instead. */
  const sess = lsGet(LS+'apiSession');
  if(!db.signedOut && (!sess || String(sess.token||'').startsWith('lab-'))){
    const account = sess?.account === 'yunis' ? 'yunis' : 'rozha';
    lsSet(LS+'apiSession', {token:'lab-'+account, account, name:NAMES[account].en, expiresAt:new Date(Date.now()+18*3600000).toISOString()});
  }

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
      {id:deviceId() || 'this-device', account, label:'Mac|Website', loggedIn:true, lastLogin:earlier, lastSeen:now, command:null, handledCommand:null, appVersion:APP_VERSION},
      {id:'lab-phone-yunis', account:'yunis', label:'iPhone 16 Pro|App', loggedIn:true, lastLogin:earlier, lastSeen:new Date(Date.now()-6*60000).toISOString(), command:null, handledCommand:null, appVersion:'2026-10-09.1'},
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
    const name = NAMES[account][L];
    const events = [];
    const say = (mood, en, ku, ar) => { events.push({type:'mood', mood}); events.push({type:'text', text:({en, ku, ar})[L]}); };
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
      say('angry', 'Grr! Don’t make me angry, I’ll hide the basil. Just kidding.', 'گڕڕ! تووڕەم مەکە، ڕەیحانەکە دەشارمەوە. گاڵتە دەکەم.', 'غرر! لا تغضبني، سأخبئ الريحان. أمزح فقط.');
    } else {
      say('happy',
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
  const labUndo = new Map();
  async function handle(path, method, headers, body){
    await new Promise(r=>setTimeout(r, 120 + Math.random()*180));   // a little network time
    if(method === 'POST' && path === 'login'){
      const pin = String(body.pin || '');
      if(!/^\d{6}$/.test(pin)) return fail('invalid_credentials', 401);
      const account = pin === '222222' ? 'yunis' : 'rozha';
      db.signedOut = false; save();
      return json({token:'lab-'+account, account, name:NAMES[account].en, expiresAt:new Date(Date.now()+18*3600000).toISOString()});
    }
    if(method === 'GET' && path === 'health') return ok();
    // Asked before signing in, so it is answered without a session (no bot check in the Lab).
    if(method === 'GET' && path === 'auth/security') return json({required:false, siteKey:null});
    const account = tokenAccount(headers);
    if(!account) return fail('unauthorized', 401);
    let m;
    if(method === 'GET' && path === 'bootstrap'){
      const me = account;
      return json({
        account:me, name:NAMES[me].en, views:viewsFor(me), roles:rolesOf(me),
        suppliers:db.suppliers, items:db.items.map(i=>({...i, createdAt:i.createdAt || '2026-08-01T09:00:00.000Z', lastOrderedAt:history().filter(o=>o.entries.some(e=>e.items.some(x=>x.itemId === i.id))).map(o=>o.date).sort().pop() || null})), units:db.units,
        history:history(), historyMonth:monthStartIso().slice(0,7), reminder:db.reminder, devices:devices(me),
        activity:can(me,'record') ? db.activity.filter(a=>a.ts >= monthStartIso()) : [], inbox:can(me,'assistant') ? db.inbox.slice(-20) : [],
        pins:db.pins[me] || [], streak:streakView(), weather:db.weather,
        months:LAB_MONTHS, draft:db.drafts?.[account] || {cart:{},revision:0}
      });
    }
    if(path === 'draft' && (method === 'GET' || method === 'PUT')){
      db.drafts ||= {};
      const draft=db.drafts[account] ||= {cart:{},revision:0};
      if(method === 'PUT'){
        const conflicts=(body.changes || []).filter(c=>(draft.cart[c.itemId]||0)!==c.before && (draft.cart[c.itemId]||0)!==c.after).map(c=>c.itemId);
        if(conflicts.length) return json({...draft,conflicts},409);
        for(const c of body.changes || []){if(c.after) draft.cart[c.itemId]=c.after; else delete draft.cart[c.itemId];}
        draft.revision++; save();
      }
      return json({...draft,conflicts:[]});
    }
    if(method === 'POST' && path === 'logout'){ db.signedOut = true; save(); return ok(); }
    // Yunis's roles, checked like the server does.
    const catalogWrite = ((method === 'PUT' || method === 'DELETE') && /^(?:suppliers|items|units)\/[^/]+$/.test(path)) || (method === 'PUT' && (path.startsWith('supplier-order/') || path === 'items/aliases')) || (method === 'POST' && path === 'items/restore');
    if((catalogWrite && !can(account,'catalog')) || (method === 'POST' && path === 'orders' && !can(account,'send')) || (path === 'months' && !can(account,'history'))
      || (path === 'activity' && !can(account,'record')) || (path.startsWith('stock') && !can(account,'transfers'))
      || ((path.startsWith('assistant/') || path.startsWith('rico-chats') || path === 'streak/recover') && !can(account,'assistant'))
      || (path === 'reminder' && !can(account,'reminders')) || (path === 'reports/catalog' && !can(account,'exports'))
      || (path.startsWith('admin/') && account !== 'rozha')) return fail('forbidden', 403);
    if(method === 'POST' && path === 'problems'){
      const reports = Array.isArray(body.reports) ? body.reports.slice(0, 10) : [];
      db.problems ||= [];
      for(const r of reports){
        const open = db.problems.find(p=>p.fingerprint === r.fingerprint && p.account === account && p.deviceId === (deviceId() || '') && !p.resolvedAt);
        if(open){ open.count += r.count || 1; open.lastAt = new Date().toISOString(); open.message = String(r.message).slice(0, 500); }
        else db.problems.unshift({id:++db.seq, fingerprint:r.fingerprint, kind:r.kind, message:String(r.message||'').slice(0,500), source:r.source || null, stack:r.stack || null, screen:r.screen || null,
          account, deviceId:deviceId() || '', label:'Mac|Website', version:APP_VERSION, count:r.count || 1, firstAt:new Date().toISOString(), lastAt:new Date().toISOString(), resolvedAt:null});
      }
      save(); return json({ok:true, kept:reports.length});
    }
    if(method === 'GET' && path === 'reports/catalog'){
      const items = {}, suppliers = {}, lastOrdered = {};
      for(const o of history()) for(const e of o.entries){
        if(e.supplierId){ const s = suppliers[e.supplierId] ||= {orders:0, lines:0, last:null, _o:new Set()}; s._o.add(o.id); s.lines += e.items.length; if(!s.last || o.date > s.last) s.last = o.date; }
        for(const it of e.items){ const x = items[it.itemId] ||= {orders:0, qty:0, last:null, _o:new Set()}; x._o.add(o.id); x.qty += Number(it.qty); if(!x.last || o.date > x.last) x.last = o.date; lastOrdered[it.itemId] = x.last; }
      }
      for(const m of [items, suppliers]) for(const k in m){ m[k].orders = m[k]._o.size; delete m[k]._o; }
      return json({from:monthStartIso(), items, suppliers, lastOrdered});
    }
    if(method === 'GET' && path === 'admin/security'){
      const day = Date.now() - 86400000, week = Date.now() - 7*86400000, ev = db.security || [];
      return json({checkedAt:new Date().toISOString(), wrongPins24h:ev.filter(e=>e.kind==='wrong_pin' && Date.parse(e.at) > day).length, signins24h:ev.filter(e=>e.kind==='signin' && Date.parse(e.at) > day).length,
        newDevices7d:ev.filter(e=>e.kind==='new_device' && Date.parse(e.at) > week).length, failuresInWindow:db.lockFailures || 0, lockLimit:40, lockedUntil:db.lockedUntil || null, events:ev.slice(0, 60)});
    }
    if(method === 'POST' && path === 'admin/security/unlock'){ db.lockFailures = 0; db.lockedUntil = null; (db.security ||= []).unshift({id:++db.seq, at:new Date().toISOString(), kind:'unlocked', account:'rozha', deviceId:deviceId(), label:null, detail:{}}); save(); return json({ok:true, cleared:0}); }
    if(method === 'GET' && path === 'admin/problems') return json((db.problems || []).filter(p=>!p.resolvedAt || Date.parse(p.resolvedAt) > Date.now() - 7*86400000));
    if(method === 'POST' && path === 'admin/problems/resolve'){ const ids = new Set(body.ids || []); (db.problems || []).forEach(p=>{ if(ids.has(p.id) && !p.resolvedAt) p.resolvedAt = new Date().toISOString(); }); save(); return ok(); }
    if(method === 'DELETE' && path === 'admin/problems'){ db.problems = (db.problems || []).filter(p=>!p.resolvedAt); save(); return ok(); }
    if(method === 'GET' && path === 'admin/usage'){
      // The same shape as the server: today, 7 days, this month, 30 days and all time per person; every one
      // of the last 31 days; 8 weeks of 7 days ending today; 6 months; nothing before the first counted day.
      const iso = ms=>new Date(ms).toISOString().slice(0,10), DAY = 86400000, now = Date.parse(iso(Date.now()) + 'T00:00:00Z');
      const today = iso(now), month = today.slice(0,8) + '01';
      const rows = db.usage || [], sum = list=>list.reduce((n, r)=>n + r.seconds, 0), first = rows.map(r=>r.day).sort()[0] || today;
      const between = (a, b, who)=>sum(rows.filter(r=>r.day >= a && r.day <= b && (!who || r.account === who)));
      const people = ['rozha','yunis'].filter(a=>rows.some(r=>r.account === a)).map(a=>{ const mine = rows.filter(r=>r.account === a); return {account:a, today:between(today, today, a), week:between(iso(now - 6*DAY), today, a), month:between(month, today, a), last30:between(iso(now - 29*DAY), today, a), total:sum(mine), since:mine.map(r=>r.day).sort()[0]}; });
      const keys = [...new Set(rows.map(r=>r.account + '|' + r.deviceId))];
      const devicesList = keys.map(k=>{ const mine = rows.filter(r=>r.account + '|' + r.deviceId === k); return {account:mine[0].account, deviceId:mine[0].deviceId, label:mine[mine.length-1].label, today:sum(mine.filter(r=>r.day === today)), total:sum(mine), lastAt:mine[mine.length-1].day + 'T12:00:00Z'}; });
      const days = [];
      for(let d = 30; d >= 0; d--){ const day = iso(now - d*DAY); if(day >= first) days.push({day, rozha:between(day, day, 'rozha'), yunis:between(day, day, 'yunis')}); }
      const weeks = [];
      for(let w = 7; w >= 0; w--){ const end = iso(now - 7*w*DAY), start = iso(now - (7*w + 6)*DAY); if(end >= first) weeks.push({start, rozha:between(start, end, 'rozha'), yunis:between(start, end, 'yunis')}); }
      const months = [];
      for(let m = 5; m >= 0; m--){ const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - m); const key = iso(d.getTime()).slice(0,7), next = new Date(d); next.setUTCMonth(next.getUTCMonth() + 1);
        if(key >= first.slice(0,7)) months.push({month:key, rozha:between(key + '-01', iso(next.getTime() - DAY), 'rozha'), yunis:between(key + '-01', iso(next.getTime() - DAY), 'yunis')}); }
      return json({today, people, devices:devicesList, days, weeks, months});
    }
    if(method === 'GET' && path === 'admin/rico'){
      const days = [...Array(14)].map((_, i)=>({day:new Date(Date.now() - (13 - i)*86400000).toISOString().slice(0,10), calls:[3,5,2,8,6,4,9,7,3,6,11,5,4,6][i]}));
      return json({from:monthStartIso(), thisHour:3, kinds:{chat:74, voice:12}, people:{rozha:31, yunis:55}, days, tokens:{input:412000, output:51000}, hourLimit:400, perPhoneHourLimit:60});
    }
    // Rico's AI: Lab keys are never checked with Anthropic; a key of the right shape is "connected".
    if(method === 'GET' && path === 'admin/ai'){
      const ai = db.ai ||= {anthropic:false, admin:false};
      return json({from:monthStartIso(), adminKey:ai.admin, brains:[
        {id:'anthropic', connected:ai.anthropic, state:ai.anthropic ? 'working' : null, at:ai.anthropic ? new Date(Date.now() - 4*60000).toISOString() : null, calls:ai.anthropic ? 41 : 0, input:ai.anthropic ? 236000 : 0, output:ai.anthropic ? 18400 : 0, bill:ai.admin ? {usd:0.03} : {error:'no_admin_key'}},
        {id:'gemini', connected:true, state:'working', at:new Date(Date.now() - 3600000).toISOString(), calls:30, input:142000, output:25100, bill:{free:true}},
        {id:'groq', connected:true, state:'busy', at:new Date(Date.now() - 86400000).toISOString(), calls:15, input:34000, output:7500, bill:{free:true}}]});
    }
    if(method === 'PUT' && path === 'admin/ai/key'){
      const shape = {anthropic:/^sk-ant-(?!admin)[A-Za-z0-9_-]{20,300}$/, anthropic_admin:/^sk-ant-admin[A-Za-z0-9_-]{20,300}$/}[body.kind];
      if(!shape) return fail('invalid_input');
      if(!shape.test(String(body.key || '').trim())) return fail('invalid_key');
      (db.ai ||= {})[body.kind === 'anthropic' ? 'anthropic' : 'admin'] = true; save(); return ok();
    }
    if(method === 'DELETE' && path === 'admin/ai/key'){
      if(!['anthropic','anthropic_admin'].includes(body.kind)) return fail('invalid_input');
      (db.ai ||= {})[body.kind === 'anthropic' ? 'anthropic' : 'admin'] = false; save(); return ok();
    }
    if(method === 'GET' && path === 'admin/roles') return json({roles:ROLES, yunis:rolesOf('yunis'), standard:!Array.isArray(db.roles?.yunis)});
    if(method === 'PUT' && path === 'admin/roles'){
      const roles = Array.isArray(body.roles) ? body.roles.filter(r=>ROLES.includes(r)) : null;
      if(body.account !== 'yunis' || !roles) return fail('invalid_input');
      (db.roles ||= {}).yunis = [...new Set(roles)].sort();
      (db.security ||= []).unshift({id:++db.seq, at:new Date().toISOString(), kind:'roles_changed', account:'rozha', deviceId:deviceId(), label:null, detail:{for:'yunis', roles:db.roles.yunis}});
      save(); return json({roles:rolesOf('yunis')});
    }
    if(method === 'PUT' && path === 'me/pins'){ db.pins[account] = (body.itemIds || []).slice(0, 60); save(); return ok(); }
    if(method === 'GET' && path === 'streak') return json(streakView());
    if(method === 'POST' && path === 'streak/recover'){ if(!streakRecover()) return fail('nothing_to_recover', 409); save(); return json({ok:true, streak:streakView()}); }
    // The month archive
    if(method === 'GET' && path === 'months') return json(LAB_MONTHS);
    // Transfers is still being made: like the server (TRANSFERS_OPEN), its routes refuse until it is ready
    // (TRANSFERS_READY in transfers.js, which loads after this file).
    if(!(typeof TRANSFERS_READY !== 'undefined' && TRANSFERS_READY) && (path === 'stock-items' || path === 'stock/read' || path.startsWith('stock-items/'))) return fail('transfers_not_ready', 423);
    if(method === 'GET' && path === 'stock-items') return json(db.stock);
    if(method === 'PUT' && path === 'stock-items'){
      const items = Array.isArray(body.items) ? body.items : null;
      if(!items || items.length > 5000 || items.some(i=>!String(i?.name||'').trim())) return fail('invalid_input');
      const old = new Map(db.stock.map(i=>[i.name.toLowerCase(), i])), seen = new Set();
      db.stock = items.filter(i=>{ const k = String(i.name).trim().toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; })
        .map((i, n)=>{ const name = String(i.name).trim().slice(0,200), prev = old.get(name.toLowerCase()); return {id:prev ? prev.id : 'st-'+(++db.seq), name, units:[...new Set((i.units||[]).map(u=>String(u).trim()).filter(Boolean))].slice(0,20), aliases:prev ? prev.aliases : []}; });
      save(); return json({ok:true, count:db.stock.length});
    }
    if(method === 'POST' && (m = path.match(/^stock-items\/([^/]{1,80})\/alias$/))){
      const item = db.stock.find(i=>i.id === decodeURIComponent(m[1])), alias = String(body.alias||'').trim();
      if(!alias || alias.length > 120) return fail('invalid_input');
      if(!item) return fail('not_found', 404);
      if(alias.toLowerCase() !== item.name.toLowerCase()) item.aliases = [...item.aliases.filter(a=>a.toLowerCase() !== alias.toLowerCase()), alias].slice(-30);
      save(); return ok();
    }
    /* No Gemini in the Lab: the list is read with the app's own matching, the way the server checks Rico's answer.
       A photo always reads as the same handwritten sample list. */
    if(method === 'POST' && path === 'stock/read'){
      const text = body.image ? 'ئاردی حەدبا 2 فەردە\nbadam 1.5 kilo\nmudhish 6 دانە\nbbq sauce 3\nsomething else 1' : String(body.text||'').slice(0,4000);
      if(!text.trim()) return fail('empty');
      await new Promise(r=>setTimeout(r, 700));
      const rows = window.parseTransferText(text).map(p=>{
        const found = window.matchStockLocally(p.said), item = db.stock.find(i=>i.id === found.itemId);
        const fitted = item ? window.RicottaSearch.fit(item.units, p.unit || '', p.amount) : null;
        const unit = item ? (fitted ? fitted.unit : item.units.length ? null : p.unit) : p.unit;
        const changed = !!item && !!p.unit && (fitted ? fitted.amount !== p.amount : item.units.length > 0);
        const sure = !!item && found.sure && (!item.units.length || !!unit);
        return {said:p.said, amount:fitted ? fitted.amount : p.amount, unit:unit || null, wrote:changed ? {amount:p.amount, unit:p.unit} : null, itemId:item ? item.id : null, sure, suggestions:sure ? [] : found.suggestions};
      });
      return json({rows});
    }
    if(method === 'PUT' && (m = path.match(/^supplier-order\/(.+)$/))){
      const sid = decodeURIComponent(m[1]);
      (body.itemIds||[]).forEach((id, i)=>{ const it = db.items.find(x=>x.id===id && x.supplierId===sid); if(it) it.sortOrder = i; });
      save(); return ok();
    }
    if(path==='items/aliases' && method==='PUT'){
      const entries=body.entries||[], conflicts=entries.filter(e=>{const i=db.items.find(i=>i.id===e.itemId);return !i || (JSON.stringify(i.aliases||[])!==JSON.stringify(e.before) && JSON.stringify(i.aliases||[])!==JSON.stringify(e.aliases));}).map(e=>e.itemId);
      if(conflicts.length)return json({conflicts},409);
      entries.forEach(e=>{db.items.find(i=>i.id===e.itemId).aliases=e.aliases;});save();return json({conflicts:[],changed:entries.length});
    }
    // As on the server: a deleted item can come back for 10 minutes on this device.
    if(method === 'POST' && path === 'items/restore'){
      const r = labUndo.get(body.undoId);
      labUndo.delete(body.undoId);
      if(!r || r.until < Date.now() || db.items.some(i=>i.id === r.item.id)) return json({error:'undo_expired'}, 409);
      db.items.push(r.item);
      db.activity.unshift({id:'aud-'+(++db.seq), ts:new Date().toISOString(), actor:account, action:'add', type:'item', name:r.item.name, fields:[{k:'name', to:r.item.name}]});
      save(); return json({ok:true, itemId:r.item.id});
    }
    if(method === 'GET' && path === 'admin/diagnostics'){
      if(account !== 'rozha') return fail('forbidden', 403);
      const ran = name => new Date(Date.now() - ({'ricotta-reminder-tick':1, 'ricotta-monthly-history':60*24*25, 'ricotta-daily-cleanup':60*7, 'ricotta-cron-history':60*7})[name]*60000).toISOString();
      const open = (db.problems || []).filter(p=>!p.resolvedAt);
      return json({checkedAt:new Date().toISOString(), database:true, latencyMs:84, databaseBytes:31457280, items:db.items.length, suppliers:db.suppliers.length, units:db.units.length,
        ordersThisMonth:history().length, lastOrderAt:history().map(o=>o.date).sort().pop() || null, pushPhones:2, signedIn:3, openProblems:open.length,
        problems24h:open.filter(p=>Date.parse(p.lastAt) > Date.now() - 86400000).length, wrongPins24h:(db.security || []).filter(e=>e.kind === 'wrong_pin' && Date.parse(e.at) > Date.now() - 86400000).length,
        jobs:['ricotta-reminder-tick','ricotta-monthly-history','ricotta-daily-cleanup','ricotta-cron-history'].map(name=>({name, active:true, lastRun:ran(name), lastStatus:'succeeded', failures24h:0}))});
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
        if(table === 'suppliers') row = {id, name:String(body.name||'').slice(0,160), phone:body.phone || null, reminder:body.reminder || null, cutoff:'cutoff' in body ? body.cutoff || null : (prev ? prev.cutoff || null : null)};
        else if(table === 'items') row = {id, name:String(body.name||'').slice(0,160), unit:body.unit || null, supplierId:body.supplierId || null, note:'note' in body ? String(body.note||'').slice(0,120) : (prev ? prev.note || '' : ''), sortOrder:'sortOrder' in body ? body.sortOrder : (prev ? prev.sortOrder : null), aliases:'aliases' in body ? body.aliases : (prev ? prev.aliases || [] : []), available:'available' in body ? body.available !== false : (prev ? prev.available !== false : true)};
        else row = {id, en:String(body.en||'').slice(0,80), ku:body.ku || null, ar:body.ar || null};
        if(idx >= 0) list[idx] = row; else list.push(row);
        db.activity.unshift({id:'aud-'+(++db.seq), ts:new Date().toISOString(), actor:account, action:prev ? 'edit' : 'add', type, name:row.name || row.en, fields:prev ? [] : [{k:'name', to:row.name || row.en}]});
      }
      if(method === 'DELETE' && table === 'items' && prev){
        const undoId = crypto.randomUUID();
        labUndo.set(undoId, {item:prev, until:Date.now() + 10*60000});
        save(); return json({ok:true, undoId});
      }
      save(); return ok();
    }
    if(method === 'POST' && path === 'orders'){
      if(!Array.isArray(body.entries) || !body.entries.length) return fail('invalid_order');
      if(!db.history.some(o=>o.id===body.id)){
        db.history.push({id:body.id, date:body.date || new Date().toISOString(), by:account,
          entries:body.entries.map(e=>({supplierId:e.supplierId || null, supplierName:e.supplierName || (db.suppliers.find(s=>s.id===e.supplierId)||{}).name || null, items:(e.items||[]).map(i=>({itemId:i.itemId, name:i.name, unit:i.unit, qty:Number(i.qty)}))}))});
        const n = NAMES[account];
        const words = {en:`Nice one, ${n.en}! The order is out.`, ku:`دەستت خۆش بێت ${n.ku}! داواکارییەکە نێردرا.`, ar:`أحسنت يا ${n.ar}! تم إرسال الطلب.`};
        window.labInboxSay('cheer', 'happy', words, `sent|${account}|${new Date().toISOString().slice(0,10)}`);
        const hit = streakHit(window.RICOTTA_TODAY || dayOf(body.date || new Date()));
        if(hit.milestone) window.labInboxSay('streak', 'excited', {en:`${hit.count} days in a row! Keep it going.`, ku:`${hit.count} ڕۆژ لەسەر یەک! بەردەوام بە.`, ar:`${hit.count} يومًا متتاليًا! استمر.`}, 'streak|'+hit.count);
        save();
      }
      return json({ok:true, streak:streakView()});
    }
    if(method === 'DELETE' && (m = path.match(/^orders\/(.+)$/))){
      const o = db.history.find(x=>x.id === decodeURIComponent(m[1]));
      if(!o) return json({ok:true, streak:streakView()});
      // As on the server: only Rozha removes orders; her own for 15 minutes, any other with her PIN (any 6 digits in the Lab).
      if(account !== 'rozha') return fail('forbidden', 403);
      if(body.pin !== undefined){ if(!/^\d{6}$/.test(String(body.pin))) return fail('wrong_pin', 403); }
      else if(o.by !== account || Date.now() - Date.parse(o.date) > 15*60000) return fail('pin_required', 403);
      db.history = db.history.filter(x=>x !== o);
      streakUnhit(window.RICOTTA_TODAY || dayOf(o.date));
      save(); return json({ok:true, streak:streakView()});
    }
    if(method === 'GET' && path === 'activity') return json(db.activity.filter(a=>a.ts >= monthStartIso()));
    if(method === 'GET' && path === 'devices') return json(devices(account));
    if(method === 'POST' && path === 'devices/me' && Number(body.seconds) > 0){
      const day = new Date().toISOString().slice(0,10), id = deviceId() || 'this-device';
      db.usage ||= [];
      const row = db.usage.find(r=>r.account === account && r.deviceId === id && r.day === day);
      if(row) row.seconds = Math.min(86400, row.seconds + Math.min(1800, Math.floor(body.seconds))); else db.usage.push({account, deviceId:id, label:'Mac|Website', day, seconds:Math.min(1800, Math.floor(body.seconds))});
      save();
    }
    if(path === 'devices/me' || path === 'devices/me/ack' || path === 'devices/command') return ok();
    /* Admin -> PINs. The Lab keeps no PINs: 000000 stands for a wrong current PIN, and Yunis's Lab PIN (222222)
       can't be given to Rozha. */
    if(method === 'PUT' && path === 'admin/pin'){
      if(account !== 'rozha') return fail('forbidden', 403);
      const pin = String(body.newPin || ''), digits = [...pin].map(Number);
      if(!['rozha','yunis'].includes(body.account) || !/^\d{6}$/.test(pin)) return fail('invalid_pin');
      if(new Set(pin).size === 1 || digits.every((d, i)=>!i || d === digits[i-1] + 1) || digits.every((d, i)=>!i || d === digits[i-1] - 1)) return fail('weak_pin');
      if(!/^\d{6}$/.test(String(body.currentPin || '')) || body.currentPin === '000000') return fail('wrong_pin', 403);
      if(body.account === 'rozha' && pin === '222222') return fail('duplicate_pin');
      return ok();
    }
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
      if(method === 'DELETE'){ const whose = query.get('account') || account; db.chats = db.chats.filter(c=>id ? c.id !== id : whose !== 'all' && c.account !== whose); save(); return ok(); }
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
    // Live changes: the Lab is one browser, so nothing changes anywhere else and the wait simply ends.
    if(method === 'GET' && path === 'signals'){
      const wait = Math.min(25, Math.max(0, Number(query.get('wait')) || 0)) * 1000;
      await new Promise(done=>{ const timer = setTimeout(done, wait); init.signal?.addEventListener('abort', ()=>{ clearTimeout(timer); done(); }, {once:true}); });
      if(init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response(JSON.stringify({n:1, kinds:{data:1, draft:1, devices:1, admin:1, inbox:1}}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    return handle(path, method, headers, body || {});
  };
})();
