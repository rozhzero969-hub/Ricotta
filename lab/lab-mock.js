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
  const ROLES = ['history','manage','catalog','record','assistant','send','exports','notify','receipts','transfers'];
  const DEFAULT_ROLES = ROLES.filter(r=>r !== 'receipts' && r !== 'transfers');
  const rolesOf = account => account === 'rozha' ? [...ROLES] : account === 'ahmad' ? ROLES.filter(r=>(db.roles?.ahmad || []).includes(r)) : Array.isArray(db.roles?.yunis) ? ROLES.filter(r=>db.roles.yunis.includes(r)) : [...DEFAULT_ROLES];
  const can = (account, role) => account === 'rozha' || (rolesOf(account).includes(role) && (role !== 'catalog' || rolesOf(account).includes('manage')));
  const viewsFor = a => [...(a === 'ahmad' ? [] : ['order']), ...(a !== 'yunis' ? ['recipes'] : []), ...(can(a,'assistant') ? ['assistant'] : []), ...(can(a,'history') ? ['history'] : []),
    ...(can(a,'manage') ? ['manage','suppliers','itemsAdmin','units'] : []), ...(can(a,'receipts') ? ['receipts'] : []), ...(can(a,'transfers') ? ['transfers'] : []), ...(can(a,'transfers') || can(a,'receipts') ? ['stock'] : []), ...(can(a,'record') ? ['record'] : []), ...(a === 'rozha' ? ['admin'] : []), 'settings'];
  const NAMES = {rozha:{en:'Rozh',ku:'ڕۆژا',ar:'روژا'}, yunis:{en:'Yunis',ku:'یونس',ar:'يونس'}, ahmad:{en:'Ahmad',ku:'ئەحمەد',ar:'أحمد'}};

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
      I('it-flour','Flour (00)','bag','sup-dry',0), I('it-oil','Olive oil','bottle','sup-dry',1), I('it-penne','Penne','pack','sup-dry',2), I('it-cantom','Canned tomatoes','can','sup-dry',3), I('it-soy','Soy sauce','bottle','sup-dry',4)
    ];
    // Sample links (Manage, edit an item, Stock item); in the real app Rozh links each one herself.
    Object.assign(items.find(i=>i.id==='it-mozz'), {stockItem:'Mozzarella - پەنیری مۆزارێلا'});
    Object.assign(items.find(i=>i.id==='it-parm'), {stockItem:'Parmesan - پەنیری پارمیزان'});
    Object.assign(items.find(i=>i.id==='it-ric'), {stockItem:'Ricotta Cheese - پەنیری ریکۆتا'});
    Object.assign(items.find(i=>i.id==='it-tom'), {stockItem:'Tomato - تەماتە'});
    Object.assign(items.find(i=>i.id==='it-lemon'), {stockItem:'Lemon - لیمۆ'});
    // Several links: one Soy sauce to three soy sauce stock items (two counted in pieces, one in kilos).
    Object.assign(items.find(i=>i.id==='it-soy'), {stockItem:'Soy Sauce Kikkoman - سۆیای کیکۆمان', stockItems:['Soy Sauce Kikkoman - سۆیای کیکۆمان', 'Soy Sauce Lee Kum Kee - سۆیای لی کوم کی', 'Soy Sauce Bulk - سۆیای کیلۆ']});
    // A low stock alert at 6 kilos (Manage): Mozzarella has 5, so it shows yellow on the Order screen.
    Object.assign(items.find(i=>i.id==='it-mozz'), {lowAlert:6});
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
       en:'Due today: Zakho Dairy, Erbil Veg Market, Ankawa Bakery.',
       ku:'کاتی داواکاریی ئەمڕۆ: Zakho Dairy، Erbil Veg Market، Ankawa Bakery.',
       ar:'موعد الطلب اليوم: Zakho Dairy، Erbil Veg Market، Ankawa Bakery.'},
      // A routine Rico ran this morning: today's usual order for Erbil Veg Market, waiting for a tap.
      {id:2, kind:'routine_order', mood:'calm', read:false, at:new Date(Date.now() - 20*60000).toISOString(),
       en:'I prepared today’s order for Erbil Veg Market (3 items). Open it, check it and send it.',
       ku:'داواکاریی ئەمڕۆی Erbil Veg Marketم ئامادە کرد (3 کاڵا). بیکەرەوە، بیپشکنە و بینێرە.',
       ar:'جهّزت طلب اليوم من Erbil Veg Market (3 مواد). افتحه وراجعه وأرسله.',
       order:{supplierId:'sup-veg', supplier:'Erbil Veg Market', day:new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baghdad'}).format(new Date()),
         lines:[{itemId:'it-tom', qty:12}, {itemId:'it-basil', qty:6}, {itemId:'it-onion', qty:1}]}},
      // A scheduled question (kind ask): Rico shows it with an "Ask now" button.
      {id:3, kind:'routine_ask', mood:'calm', read:false, at:new Date(Date.now() - 5*60000).toISOString(),
       en:'Scheduled: Which items are running low?', ku:'خشتەکراو: Which items are running low?', ar:'مجدول: Which items are running low?',
       question:'Which items are running low?'}
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
    return {v:10, units, suppliers, items, history, activity, inbox, chats, pins:{rozha:['it-tom','it-mozz'], yunis:[]}, streak, weather, seq:100, said:{},
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
  let db = lsGet(DB_KEY);
  if(!db || db.v !== 10) db = seed();
  const save = () => lsSet(DB_KEY, db);
  save();
  window.labResetData = () => { db = seed(); save(); };
  window.labDb = () => db;

  /* Signed in as Rozh when the Lab opens, so the real Order screen shows first. */
  /* After a sign-out the Lab shows the real sign-in keypad instead. */
  const sess = lsGet(LS+'apiSession');
  if(!db.signedOut && (!sess || String(sess.token||'').startsWith('lab-'))){
    const account = ['yunis', 'ahmad'].includes(sess?.account) ? sess.account : 'rozha';
    lsSet(LS+'apiSession', {token:'lab-'+account, account, name:NAMES[account].en, expiresAt:new Date(Date.now()+18*3600000).toISOString()});
  }

  /* Recipes practice data: Manage's units, five ingredients linked to stock in three categories (Tomato
     has never been bought, so it has no price), three recipes (Margherita uses Tomato, so it has no
     cost yet) and an alert. */
  const LAB_UNITS = [{id:'g', en:'گرام'}, {id:'kg', en:'کیلۆگرام'}, {id:'ml', en:'مل'}, {id:'l', en:'لیتر'}, {id:'piece', en:'دانە'}];
  const LAB_PRICES = [['Mozzarella - پەنیری مۆزارێلا', 9000, 'کیلۆ', 'Zakho Dairy'], ['Ricotta Cheese - پەنیری ریکۆتا', 45000, 'کارتۆن', 'Zakho Dairy'], ['Banana - مۆز', 1500, 'کیلۆ', 'Erbil Fruit'], ['Olive Oil - زەیتی زەیتوون', 60000, 'کارتۆن', 'Golden Oils'], ['Lemon - لیمۆ', 2000, 'کیلۆ', 'Erbil Fruit']];
  function labRecipes(){
    if(db.recipeBook2){
      // Categories from a prepared list (2026-11-17): a Lab saved before then gets them now.
      if(!db.recipeBook2.categories){ db.recipeBook2 = null; return labRecipes(); }
      return db.recipeBook2;
    }
    const ing = [['00000000-0000-4000-8000-00000000a001', 'Mozzarella', 'Mozzarella - پەنیری مۆزارێلا', 'g', 'Dairy'], ['00000000-0000-4000-8000-00000000a002', 'Ricotta', 'Ricotta Cheese - پەنیری ریکۆتا', 'piece', 'Dairy'],
      ['00000000-0000-4000-8000-00000000a003', 'Olive oil', 'Olive Oil - زەیتی زەیتوون', 'ml', 'Dry goods'], ['00000000-0000-4000-8000-00000000a004', 'Tomato', 'Tomato - تەماتە', 'g', 'Vegetables'],
      ['00000000-0000-4000-8000-00000000a005', 'Banana', 'Banana - مۆز', 'g', 'Fruit'], ['00000000-0000-4000-8000-00000000a006', 'Lemon', 'Lemon - لیمۆ', 'g', 'Fruit']].map(([id, name, stock_item, unit, category])=>({id, name, stock_item, unit, category, version:1}));
    const at = new Date(Date.now() - 86400000).toISOString();
    // Categories with their soft colours (the palette in _shared/recipe-colors.js); Rico adds more.
    const categories = [['00000000-0000-4000-8000-00000000d001', 'Pizza', 'peach'], ['00000000-0000-4000-8000-00000000d002', 'Drinks', 'sky'], ['00000000-0000-4000-8000-00000000d003', 'Breakfast', 'butter']]
      .map(([id, name, color], i)=>({id, name, color, sort:i + 1}));
    const catId = n=>categories.find(c=>c.name === n)?.id || '';
    const recipe = (id, name, category, price, lines, steps, notes = '')=>({id, name, version:1, archived:false, updated_by:'ahmad', updated_at:at,
      data:{category:catId(category), price, currency:'IQD', notes, lines:lines.map(([i, qty, unit])=>({ingredient:ing[i].id, qty, unit})), steps}});
    db.recipeBook2 = {categories, ingredients:ing, photos:{}, alerts:[{id:'00000000-0000-4000-8000-00000000b001', at, read:false, en:'Tomato is out in Main Storage. Margherita uses it.', ku:'تەماتە لە کۆگای سەرەکی نەماوە. مارگەریتا بەکاری دەهێنێت.', ar:'نفدت الطماطم في المخزن الرئيسي. مارغريتا تستخدمها.'}],
      recipes:[
        recipe('00000000-0000-4000-8000-00000000c001', 'Margherita', 'Pizza', 9000, [[0, 200, 'g'], [2, 20, 'ml'], [3, 150, 'g']], ['Spread the tomato on the dough.', 'Add the mozzarella and a little olive oil.', 'Bake for 8 minutes.']),
        recipe('00000000-0000-4000-8000-00000000c002', 'Banana smoothie', 'Drinks', 3000, [[4, 250, 'g'], [5, 20, 'g']], ['Peel the banana.', 'Blend with ice and a squeeze of lemon.'], 'Serve cold in a tall glass.'),
        recipe('00000000-0000-4000-8000-00000000c003', 'Ricotta toast', 'Breakfast', 4500, [[1, 1, 'piece'], [2, 10, 'ml']], ['Toast the bread.', 'Spread the ricotta and add a little olive oil.'])]};
    save();
    return db.recipeBook2;
  }

  /* ---- helpers ---- */
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
  const ok = () => json({ok:true});
  const fail = (error, status = 400) => json({error}, status);
  const monthStartIso = () => { const n = bag(new Date()); return atBaghdad(n.y, n.m, 1, 0, 0); };
  const tokenAccount = h => { const t = h['x-session-token'] || ''; return t === 'lab-rozha' ? 'rozha' : t === 'lab-yunis' ? 'yunis' : t === 'lab-ahmad' ? 'ahmad' : null; };
  const deviceId = () => { try{ return JSON.parse(localStorage.getItem(LS+'deviceId')); }catch(_){ return null; } };
  const devices = account => {
    const now = new Date().toISOString(), earlier = new Date(Date.now()-2*3600000).toISOString();
    const ends = ms => new Date(Date.now() + ms).toISOString();
    const list = [
      {id:deviceId() || 'this-device', account, label:'Mac|Website', loggedIn:true, lastLogin:earlier, lastSeen:now, command:null, handledCommand:null, appVersion:APP_VERSION, push:true,
        sessionEnds:ends(30*86400000), signin:{ip:'185.12.40.7', city:'Erbil', region:'Erbil', country:'IQ', org:'AS206206 Korek Telecom', ipTz:'Asia/Baghdad', deviceTz:'Asia/Baghdad', vpn:false, vpnReason:null, at:earlier}},
      {id:'lab-phone-yunis', account:'yunis', label:'iPhone 16 Pro|App', loggedIn:true, lastLogin:earlier, lastSeen:new Date(Date.now()-6*60000).toISOString(), command:null, handledCommand:null, appVersion:'2026-10-09.1',
        sessionEnds:ends(30*86400000 - 6*60000), signin:{ip:'185.12.41.22', city:'Erbil', region:'Erbil', country:'IQ', org:'AS59588 Fastlink', ipTz:'Asia/Baghdad', deviceTz:'Asia/Baghdad', vpn:false, vpnReason:null, at:earlier}},
      {id:'lab-phone-rozha', account:'rozha', label:'iPhone 16/17 Pro Max|App', loggedIn:true, lastLogin:earlier, lastSeen:new Date(Date.now()-40*60000).toISOString(), command:null, handledCommand:null,
        sessionEnds:ends(29*86400000), signin:{ip:'185.213.155.10', city:'Frankfurt am Main', region:'Hesse', country:'DE', org:'AS3320 Deutsche Telekom AG', ipTz:'Europe/Berlin', deviceTz:'Asia/Baghdad', vpn:true, vpnReason:'tz', at:earlier}}
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
  /* A sample of Ricotta Restaurant's stock for linked items (Manage, edit an item, Stock item). Parmesan is
     bought by the carton (30 pieces): 31 pieces shows as pieces, 60 as 2 cartons. */
  const LAB_STOCK = [
    {name:'Mozzarella - پەنیری مۆزارێلا', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:{name:'کیلۆ', factor:1000}, stock:{'Main Storage':5000}},
    {name:'Parmesan - پەنیری پارمیزان', base:'دانە', count:{name:'دانە', factor:1}, buy:{name:'کارتۆن', factor:30}, stock:{'Main Storage':31}},
    {name:'Ricotta Cheese - پەنیری ریکۆتا', base:'دانە', count:{name:'دانە', factor:1}, buy:{name:'کارتۆن', factor:30}, stock:{'Main Storage':60}},
    {name:'Tomato - تەماتە', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:{name:'کیلۆ', factor:1000}, stock:{'Main Storage':0}},
    {name:'Lemon - لیمۆ', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:null, stock:{'Main Storage':12500}},
    {name:'Banana - مۆز', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:{name:'کیلۆ', factor:1000}, stock:{'Main Storage':5000}},
    {name:'Akkawi Cheese - پەنیری عەکاوی', base:'دانە', count:{name:'دانە', factor:1}, buy:{name:'کارتۆن', factor:24}, stock:{'Main Storage':0}},
    {name:'Mozzarella Block - پەنیری مۆزارێلای پارچە', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:{name:'کارتۆن', factor:10000}, stock:{'Main Storage':20000}},
    {name:'Olive Oil - زەیتی زەیتوون', base:'مل', count:{name:'دانە', factor:1000}, buy:{name:'کارتۆن', factor:12000}, stock:{'Main Storage':24000}},
    {name:'Soy Sauce Kikkoman - سۆیای کیکۆمان', base:'دانە', count:{name:'دانە', factor:1}, buy:{name:'کارتۆن', factor:12}, stock:{'Main Storage':15}},
    {name:'Soy Sauce Lee Kum Kee - سۆیای لی کوم کی', base:'دانە', count:{name:'دانە', factor:1}, buy:{name:'کارتۆن', factor:24}, stock:{'Main Storage':5}},
    {name:'Soy Sauce Bulk - سۆیای کیلۆ', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:null, stock:{'Main Storage':3000}},
  ];
  // Open the Lab with ?stale to see stock read long ago (Cloud Rico stuck for 42 minutes) until Read now.
  const LAB_STALE = ()=>/[?&]stale\b/.test(location.search) && !(db.cloud && db.cloud.fixedAt);
  const labStockAt = ()=>new Date(Date.now() - (LAB_STALE() ? 42 : 6) * 60000).toISOString();
  // Sample use over the last 14 days, so the Order screen shows each colour: Parmesan is low.
  const LAB_USE = new Map([['Parmesan - پەنیری پارمیزان', {base:280, n:6}], ['Lemon - لیمۆ', {base:14000, n:4}]]);
  const labLevel = t=>globalThis.RicottaStockLink.level(t, LAB_USE).level;
  // Same as the server: one link as before, several added together (stock-link.js combine()).
  const labStockFor = names=>{
    const L = globalThis.RicottaStockLink, found = names.map(n=>LAB_STOCK.find(x=>x.name === n)).filter(Boolean);
    if(!found.length) return {missing:true};
    if(names.length === 1) return labStockOf(found[0]);
    return {...L.combine(found, LAB_USE), at:labStockAt()};
  };
  const withLabStock = i=>{
    const links = globalThis.RicottaStockLink.linksOf(i);
    if(!links.length) return i;
    return {...i, stockItem:links[0], stockItems:links, stock:labStockFor(links)};
  };
  const labStockOf = t=>({...globalThis.RicottaStockLink.amount(t), level:labLevel(t), count:globalThis.RicottaStockLink.counted(t), at:labStockAt()});
  function ricoReply(account, body){
    const L = lang(body.lang);
    const last = [...(body.messages||[])].reverse().find(m=>m.role==='user');
    const q = String(last?.text || last?.content || '').toLowerCase();
    const name = NAMES[account][L];
    const events = [];
    const say = (mood, en, ku, ar) => { events.push({type:'mood', mood}); events.push({type:'text', text:({en, ku, ar})[L]}); };
    const wantsOrder = /order|prepar|suggest|usual|داواکاری|ئامادە|طلب|جهز|veg|tomato/.test(q) || body.quickAction;
    const pid = k=>k+Date.now().toString(36);
    const inMatch = q.match(/in (\d+) ?(second|sec|minute|min)/);
    // Recipe categories (recipe-categories.ts): "Add a recipe category called Cakes", "colours for Drinks".
    const catAsk = account !== 'yunis' && /categor|colou?r|جۆر|ڕەنگ|فئة|لون/.test(q);
    // "Where is dark mode?", "How do I change my PIN?": the same app map Rico's find_in_app searches,
    // filtered by what this account can use, and a button that takes them there.
    const findsPlace = /\bwhere\b|how do i|how can i|turn (on|off)|\bsetting|dark mode|کوێ|چۆن|ڕێکخستن|أين|كيف|إعداد/.test(q);
    if(catAsk){
      const R = labRecipes(), C = globalThis.RicottaRecipeColors, raw = String(last?.text || last?.content || '');
      const named = raw.match(/(?:called|named|بە ناوی|اسمها)\s+(.+?)[.?!؟]*\s*$/i)?.[1]?.trim();
      if(named && /add|زیاد|أضف/.test(q)){
        const had = R.categories.find(c=>c.name.toLowerCase() === named.toLowerCase());
        if(!had){ R.categories.push({id:crypto.randomUUID(), name:named.slice(0, 60), color:C.next(R.categories.map(c=>c.color)), sort:R.categories.length + 1}); save(); }
        say('calm', had ? `"${named}" is already a category.` : `Done. "${named}" is in the category list now.`, had ? `«${named}» پێشتر هەیە.` : `تەواو. «${named}» ئێستا لە لیستی جۆرەکاندایە.`, had ? `«${named}» موجودة مسبقًا.` : `تم. «${named}» الآن في قائمة الفئات.`);
      } else {
        const c = R.categories.find(x=>q.includes(x.name.toLowerCase())) || R.categories[0];
        if(c){
          say('calm', `Here are the colours for ${c.name}. Tap one to use it.`, `ئەمە ڕەنگەکانی ${c.name}ن. دەست لە یەکێکیان بدە.`, `هذه ألوان ${c.name}. اضغط على لون لاستخدامه.`);
          events.push({type:'proposal', proposal:{id:pid('rc'), kind:'recipe_colors', categoryId:c.id, category:c.name, color:c.color}});
        } else say('calm', 'There are no categories yet. Tell me the name of one to add.', 'هێشتا هیچ جۆرێک نییە. ناوی یەکێکم پێ بڵێ بۆ زیادکردن.', 'لا توجد فئات بعد. أخبرني باسم فئة لإضافتها.');
      }
    } else if(findsPlace){
      const M = globalThis.RicottaAppMap, found = M ? M.find(q, {account, roles:rolesOf(account)}, 3) : [];
      if(found.length){
        const p = found[0];
        say('calm', `It is in ${M.pathOf(p, 'en')}. Tap the button to go there.`, `ئەمە لە «${M.pathOf(p, 'ku')}» دایە. دوگمەکە دابگرە بۆ ئەوەی بچیتە ئەوێ.`, `إنه في «${M.pathOf(p, 'ar')}». اضغط الزر للذهاب إليه.`);
        events.push({type:'proposal', proposal:{id:pid('o'), kind:'open', screen:p.go.view || 'settings', place:p.id}});
      } else say('calm', 'I couldn’t find that in the app for you.', 'ئەوەم لە ئەپەکەدا بۆت نەدۆزییەوە.', 'لم أجد ذلك في التطبيق لك.');
    } else if(inMatch){
      const secs = Number(inMatch[1]) * (/^min/.test(inMatch[2]) ? 60 : 1), at = new Date(Date.now() + secs * 1000);
      db.routines ||= [];
      db.routines.push({id:crypto.randomUUID(), account, kind:'remind', text:'Do the transfers', supplierIds:[], time:at.toTimeString().slice(0,5), days:[0,1,2,3,4,5,6], enabled:true, lastRunDay:null, runAt:at.toISOString()});
      save();
      const when = secs < 120 ? 'in about a minute' : 'at ' + at.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Baghdad'});
      say('calm', `I’ll remind you ${when} to do your transfers.`, `${when === 'in about a minute' ? 'نزیکەی یەک خولەکی تر' : when} بیرت دەخەمەوە گواستنەوەکان بکەیت.`, `سأذكّرك ${when} بالتحويلات.`);
    } else if(/remind me|بیرم بخەرەوە|ذكّرني|ذكرني/.test(q)){
      say('calm', 'I can remind you every day at 9:00. Tap Save to keep it.', 'دەتوانم هەموو ڕۆژێک کاتژمێر 9:00 بیرت بخەمەوە. پاشەکەوتکردن دابگرە.', 'أستطيع تذكيرك كل يوم الساعة 9:00. اضغط حفظ.');
      events.push({type:'proposal', proposal:{id:pid('r'), kind:'routine', routine:{kind:'remind', text:'Do the transfers', time:'09:00', days:[0,1,2,3,4,5,6], supplierIds:[], suppliers:[]}}});
    } else if(/every morning|by yourself|هەموو بەیانییەک|كل صباح/.test(q)){
      say('calm', 'Every morning at 7:00 I will prepare the usual order for Erbil Veg Market and leave it for you to check and send. Nothing goes to the supplier until you send it.', 'هەموو بەیانییەک کاتژمێر 7:00 داواکارییە ئاساییەکەی Erbil Veg Market ئامادە دەکەم.', 'كل صباح الساعة 7:00 سأجهّز طلب Erbil Veg Market المعتاد.');
      events.push({type:'proposal', proposal:{id:pid('r'), kind:'routine', routine:{kind:'prepare_order', text:'Veg order', time:'07:00', days:[0,1,2,3,4,5,6], supplierIds:['sup-veg'], suppliers:['Erbil Veg Market']}}});
    } else if(/stock of|cheese|پەنیر|جبن/.test(q)){
      say('calm', 'Here is the cheese in Main Storage.', 'ئەمە پەنیرەکانی کۆگای سەرەکییە.', 'هذه الأجبان في المخزن الرئيسي.');
      events.push({type:'proposal', proposal:{id:pid('s'), kind:'stock_list', mode:'search', query:'cheese', storage:'Main Storage', at:new Date(Date.now()-6*60000).toISOString(), more:0,
        rows:[{item:'Mozzarella - پەنیری مۆزارێلا', qty:5, unit:'کیلۆ', empty:false, days:null, other:'Pizza 2 کیلۆ'},
          {item:'Parmesan - پەنیری پارمیزان', qty:31, unit:'دانە', empty:false, days:null, other:''},
          {item:'Akkawi Cheese - پەنیری عەکاوی', qty:0, unit:'دانە', empty:true, days:null, other:'Appetizers 4 دانە'}]}});
    } else if(/is low|low in|کەمە|ينقص/.test(q)){
      say('calm', 'Two items are low in Main Storage. Faheta Bread is empty and Mozzarella has about a day left.', 'دوو کاڵا لە کۆگای سەرەکی کەمن.', 'مادتان ناقصتان في المخزن الرئيسي.');
      events.push({type:'proposal', proposal:{id:pid('s'), kind:'stock_list', storage:'Main Storage', at:new Date(Date.now()-6*60000).toISOString(), more:0,
        rows:[{item:'Faheta Bread - صمونى فاهيتا', qty:0, unit:'دانە', days:null, empty:true},{item:'Mozzarella - پەنیری مۆزارێلا', qty:2, unit:'کیلۆ', days:0.8, empty:false},{item:'Lemon - لیمۆ', qty:1.5, unit:'کیلۆ', days:2.4, empty:false}]}});
    } else if(/needs me|پێویستی بە|يحتاج/.test(q)){
      say('calm', 'Three things need you. The stopped receipt first.', 'سێ شت پێویستیان بە تۆیە.', 'ثلاثة أشياء تحتاجك.');
      events.push({type:'proposal', proposal:{id:pid('n'), kind:'needs_list', rows:[
        {type:'receipt', id:'00000000-0000-4000-8000-000000000001', title:'Veg Market #4', why:'Stopped: Rico could not find the supplier', level:'stop'},
        {type:'transfer', id:'00000000-0000-4000-8000-000000000002', title:'Main Storage > Pizza', why:'Waiting for a person to check Rico\'s photo and approve it (12 min).', level:'wait'},
        {type:'transfer', id:'00000000-0000-4000-8000-000000000003', title:'Main Storage > Minibar', why:'A draft not sent since 2026-11-12.', level:'old'}]}});
    } else if(/invoice|پسوول|فاتور/.test(q)){
      const month = new Date().toISOString().slice(0, 7);
      say('calm', 'Here are this month\'s invoices. Download the PDF or Excel for every receipt with its lines.', 'ئەمە پسوولەکانی ئەم مانگەن.', 'هذه فواتير هذا الشهر.');
      events.push({type:'proposal', proposal:{id:pid('i'), kind:'invoice_report', month, supplier:null, receipts:14, IQD:1386500, USD:0, deliveryIQD:25000, unpaid:3, more:0,
        suppliers:[{name:'Dairy Co', receipts:4, IQD:512000, USD:0}, {name:'Coffee Supply', receipts:3, IQD:448000, USD:0}, {name:'Erbil Veg Market', receipts:4, IQD:262500, USD:0}, {name:'Bread House Bakery', receipts:3, IQD:164000, USD:0}]}});
    } else if(/last price|آخر سعر|دوایین نرخ/.test(q)){
      const m0 = new Date().toISOString().slice(0, 7), d = n=>new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
      say('calm', 'These are the last prices paid, from the invoices in Ricotta Restaurant. Items moved to Pizza come first.', 'ئەمانە دوایین نرخەکانن.', 'هذه آخر الأسعار المدفوعة.');
      events.push({type:'proposal', proposal:{id:pid('l'), kind:'price_lookup', query:'', storage:'Pizza', months:[m0], more:0, rows:[
        {item:'Mozzarella - پەنیری مۆزارێلا', price:13200, unit:'کیلۆ', currency:'IQD', day:d(2), supplier:'Dairy Co', times:4, source:'moved'},
        {item:'Tomato - تەماتە', price:1375, unit:'کیلۆ', currency:'IQD', day:d(3), supplier:'Erbil Veg Market', times:4, source:'moved'},
        {item:'Faheta Bread - صمونى فاهيتا', price:250, unit:'دانە', currency:'IQD', day:d(1), supplier:'Bread House Bakery', times:3, source:'moved'},
        {item:'Pizza Box - قوتووی پیتزا', price:42, unit:'دانە', currency:'USD', day:d(9), supplier:'Coffee Supply', times:1, source:'name'}]}});
    } else if(/price|نرخ|سعار/.test(q)){
      say('calm', 'Two prices changed by more than 10 percent this month.', 'دوو نرخ گۆڕاون.', 'تغيّر سعران.');
      events.push({type:'proposal', proposal:{id:pid('p'), kind:'price_list', more:0, rows:[
        {item:'Mozzarella - پەنیری مۆزارێلا', supplier:'Dairy Co', unit:'کیلۆ', currency:'IQD', from:10000, to:12000, pct:20},
        {item:'Tomato - تەماتە', supplier:'Erbil Veg Market', unit:'کیلۆ', currency:'IQD', from:1500, to:1250, pct:-16.7}]}});
    } else if(/spend|خەرج|أنفق/.test(q)){
      say('calm', 'You spent 1,240,000 IQD this week, most of it at Dairy Co.', 'ئەم هەفتەیە 1,240,000 دینارت خەرج کرد.', 'أنفقت 1,240,000 دينار هذا الأسبوع.');
      events.push({type:'proposal', proposal:{id:pid('m'), kind:'spend', period:'2026-11-08 to 2026-11-14', by:'supplier', receipts:9, IQD:1240000, USD:0,
        rows:[{name:'Dairy Co', receipts:4, IQD:720000, USD:0},{name:'Erbil Veg Market', receipts:5, IQD:520000, USD:0}]}});
    } else if(/streak|زنجیرە|سلسلة/.test(q)){
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
      say('calm', 'Zakho Dairy: not sent yet, due at 10:00. Want me to prepare it?', 'Zakho Dairy: هێشتا نەنێردراوە، کاتەکەی 10:00 بوو. ئامادەی بکەم؟', 'Zakho Dairy: لم يُرسل بعد، موعده 10:00. هل أجهّزه؟');
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
  // Live signals in the Lab: a counter per kind that moves like the server's (Check now moves 'receipts'
  // while Rico reads, and 'data' and 'receipts' when the new lists arrive), waking the open wait at once.
  const labSig = {n:1, kinds:{data:1, draft:1, devices:1, admin:1, inbox:1, receipts:1}}, labSigWait = new Set();
  const labBump = (...ks)=>{ labSig.n++; ks.forEach(k=>{ labSig.kinds[k] = labSig.n; }); labSigWait.forEach(f=>f()); labSigWait.clear(); };
  const labHelper = ()=>{ db.rr ||= {receipts:[], helper:{online:true, lastSeen:new Date().toISOString(), signedIn:true, busyWith:null, stopped:false, limits:{bigTotal:1000000, priceJump:30, rateMin:1500, rateMax:1800}, version:'lab', mode:'real', launcher:{online:true, command:null, result:null, at:null}}, next:28}; return Object.assign(db.rr.helper, {online:true, canSync:true}); };
  async function handle(path, method, headers, body){
    await new Promise(r=>setTimeout(r, 120 + Math.random()*180));   // a little network time
    if(method === 'POST' && path === 'login'){
      const pin = String(body.pin || '');
      if(!/^\d{6}$/.test(pin)) return fail('invalid_credentials', 401);
      const account = pin === '222222' ? 'yunis' : pin === '333333' ? 'ahmad' : 'rozha';
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
        suppliers:db.suppliers, items:db.items.map(i=>withLabStock({...i, createdAt:i.createdAt || '2026-08-01T09:00:00.000Z', lastOrderedAt:history().filter(o=>o.entries.some(e=>e.items.some(x=>x.itemId === i.id))).map(o=>o.date).sort().pop() || null})), units:db.units,
        history:db.history, historyMonth:monthStartIso().slice(0,7), settings:(db.settings ||= {})[me] || {}, devices:devices(me),
        activity:can(me,'record') ? db.activity : [], inbox:can(me,'assistant') ? db.inbox.slice(-20) : [],
        pins:db.pins[me] || [], streak:streakView(), weather:db.weather,
        expenses:true, months:LAB_MONTHS, nextWipe:new Date(Date.now() + 86400000).toISOString().slice(0, 10), draft:db.drafts?.[account] || {cart:{},revision:0}
      });
    }
    // Check all last prices: Rico "reads" the invoices in about 4 seconds.
    if(path === 'rico-prices'){
      const P = db.labPrices ||= {at:new Date(Date.now() - 12 * 60000).toISOString(), askedAt:null, doneAt:null};
      const view = ()=>{ const busy = P.askedAt && Date.now() - Date.parse(P.askedAt) < 4000;
        if(P.askedAt && !busy && (!P.doneAt || P.doneAt < P.askedAt)){ P.doneAt = P.at = new Date().toISOString(); save(); }
        return {by:'mac', at:P.at, ricoOn:true, ricoOld:false, state:busy ? 'running' : null, timedOut:false, askedAt:P.askedAt, doneAt:P.doneAt, result:{ok:true, receipts:48, read:3}}; };
      if(method === 'POST'){ P.askedAt = new Date().toISOString(); save(); }
      return json(method === 'POST' ? {prices:view()} : view());
    }
    // Recipes (Ahmad and Rozh): the book with Manage's units, the stock items and practice last prices,
    // so costs work out the same way as on the server (supabase/functions/api/recipes.ts).
    // A colour tapped on Rico's colour card (recipe-categories.ts).
    if(path.startsWith('recipe-categories/')){
      if(account === 'yunis') return fail('forbidden', 403);
      const R = labRecipes(), c = R.categories.find(x=>x.id === path.split('/')[1]);
      if(method !== 'PUT' || !c) return fail('not_found', 404);
      if(!globalThis.RicottaRecipeColors.KEYS.includes(body.color)) return fail('invalid_input');
      c.color = body.color; save(); return json(c);
    }
    if(path === 'recipes' || path.startsWith('recipes/') || path.startsWith('recipe-ingredients/')){
      if(account === 'yunis') return fail('forbidden', 403);
      const R = labRecipes(), RC = globalThis.RicottaRecipeCost;
      if(method === 'GET' && path === 'recipes'){
        const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
        const prices = {}; for(const [name, cost, unit, supplier] of LAB_PRICES){ const t = LAB_STOCK.find(x=>x.name === name); const p = RC.priceOf(t, {item:name, unit, cost, currency:'IQD', day, supplier}); if(p) prices[name] = p; }
        // The other names a stock item goes by: the ordering items linked to it and their search names.
        const aka = t=>[...new Set((db.items || []).filter(i=>i.stockItem === t.name || (i.stockItems || []).includes(t.name)).flatMap(i=>[i.name, ...(i.aliases || [])]))];
        return json({recipes:R.recipes, categories:R.categories, ingredients:R.ingredients, units:LAB_UNITS, stock:LAB_STOCK.map(t=>({name:t.name, base:t.base, count:t.count, buy:t.buy, state:RC.stockState(t, new Set()), ...(aka(t).length ? {aka:aka(t)} : {})})),
          prices, pricesReady:true, stockAt:labStockAt(), marginMin:RC.MARGIN_MIN, covers:Object.fromEntries(Object.entries(R.photos).filter(([, l])=>l.length).map(([id, l])=>[id, l[0].url])), alerts:account === 'ahmad' ? R.alerts : []});
      }
      if(method === 'POST' && path === 'recipes/alerts/read'){ R.alerts.forEach(a=>{ a.read = true; }); save(); return ok(); }
      let m = path.match(/^recipes\/([^/]+)\/photos\/order$/);
      if(m && method === 'PUT'){
        const list = R.photos[m[1]] || [], ids = Array.isArray(body.ids) ? body.ids : [];
        R.photos[m[1]] = [...ids.map(id=>list.find(x=>x.id === id)).filter(Boolean), ...list.filter(x=>!ids.includes(x.id))]; save(); return ok();
      }
      m = path.match(/^recipes\/([^/]+)\/photos(?:\/([^/]+))?$/);
      if(m){
        R.photos[m[1]] ||= [];
        if(method === 'GET') return json(R.photos[m[1]]);
        if(method === 'POST'){ if(R.photos[m[1]].length >= 8) return fail('too_many_photos', 422); R.photos[m[1]].push({id:crypto.randomUUID(), caption:null, url:body.image, created_at:new Date().toISOString()}); save(); return ok(); }
        if(method === 'DELETE'){ R.photos[m[1]] = R.photos[m[1]].filter(x=>x.id !== m[2]); save(); return ok(); }
      }
      m = path.match(/^recipes\/([^/]+)$/);
      if(m && method === 'PUT'){
        const i = R.recipes.findIndex(x=>x.id === m[1]), old = R.recipes[i];
        if((old?.version || 0) !== (body.version || 0)) return fail('recipe_conflict', 409);
        const d = body.data || {};
        // The category is one from the list, by its id (a name from an older app finds its row); a name
        // not on the list is refused, as on the server: categories are made by asking Rico.
        const want = String(d.category || '').trim(), cat = !want ? null : R.categories.find(c=>c.id === want) ?? (/^[0-9a-f-]{36}$/i.test(want) ? null : R.categories.find(c=>c.name.toLowerCase() === want.toLowerCase()));
        if(cat === undefined) return fail('unknown_category', 422);
        const saved = {id:m[1], name:String(body.name || '').slice(0, 120), data:{category:cat?.id || '', price:d.price ?? null, currency:'IQD', lines:d.lines || [], steps:d.steps || [], notes:d.notes || ''}, archived:false, version:(old?.version || 0) + 1, updated_by:account, updated_at:new Date().toISOString()};
        if(i < 0) R.recipes.unshift(saved); else R.recipes[i] = saved; save();
        return json(saved);
      }
      // A recipe and its photos, for good (the same as the server).
      if(m && method === 'DELETE'){
        if(!R.recipes.some(x=>x.id === m[1])) return fail('not_found', 404);
        R.recipes = R.recipes.filter(x=>x.id !== m[1]); delete R.photos[m[1]]; save();
        return ok();
      }
      m = path.match(/^recipe-ingredients\/([^/]+)$/);
      if(m && method === 'PUT'){
        const i = R.ingredients.findIndex(x=>x.id === m[1]), old = R.ingredients[i];
        if(!LAB_STOCK.some(x=>x.name === body.stock_item)) return fail('stock_item_unknown', 422);
        const saved = {id:m[1], name:String(body.name || '').slice(0, 120), stock_item:body.stock_item, unit:body.unit, category:String(body.category || '').trim().slice(0, 60), version:(old?.version || 0) + 1};
        if(i < 0) R.ingredients.push(saved); else R.ingredients[i] = saved; save();
        return json(saved);
      }
      if(m && method === 'DELETE'){
        const users = R.recipes.filter(r=>r.data?.lines?.some(l=>l.ingredient === m[1])).map(r=>r.name);
        if(users.length) return json({error:'ingredient_in_use', recipes:users, count:users.length}, 409);
        R.ingredients = R.ingredients.filter(x=>x.id !== m[1]); save(); return ok();
      }
      return fail('not_found', 404);
    }
    // Ahmad's Stock tab: the items Rozh picked for him with how much is in Main Storage (minibar.ts).
    if(path === 'minibar'){
      if(account !== 'ahmad' && account !== 'rozha') return fail('forbidden', 403);
      if(method === 'PUT'){
        if(account !== 'rozha') return fail('forbidden', 403);
        db.minibar = (Array.isArray(body.itemIds) ? body.itemIds : []).filter(x=>typeof x === 'string').slice(0, 300); save(); return ok();
      }
      const ids = db.minibar ?? ['it-lemon', 'it-mozz', 'it-ric'];   // a few to start, until Rozh picks her own
      const items = (db.items || []).filter(i=>ids.includes(i.id)).map(i=>{
        const w = withLabStock(i);
        return {id:i.id, name:i.name, stock:w.stockItem && w.stock ? w.stock : {missing:true}};
      }).sort((a, b)=>a.name.localeCompare(b.name));
      // Rozh's list gets hints: what usually goes to the Minibar, and what Ahmad's recipes use.
      const hints = account === 'rozha' ? {moved:{'Lemon - لیمۆ':14, 'Banana - مۆز':9, 'Ricotta Cheese - پەنیری ریکۆتا':3}, recipes:[...new Set(labRecipes().ingredients.map(i=>i.stock_item))]} : undefined;
      return json({items, at:labStockAt(), picked:ids.length, ...(hints ? {hints} : {})});
    }
    // Linking ordering items to stock items: the choices, and one link (a name that doesn't match only
    // with {anyway: true}, after the app warned).
    if(method === 'GET' && path === 'items/stock-options'){
      if(!can(account, 'catalog')) return fail('forbidden', 403);
      const amounts = can(account, 'transfers') || can(account, 'receipts');
      // The same hints as the server: units, deliveries and who delivered it (Mozzarella from Zakho Dairy).
      const hints = t=>({units:[t.buy?.name, t.count?.name].filter(Boolean), bought:/Mozzarella|Parmesan|Tomato/.test(t.name) ? 3 : 0, ...(/Mozzarella/.test(t.name) ? {from:['Zakho Dairy · Kak Ahmad']} : {})});
      return json({at:labStockAt(), items:LAB_STOCK.map(t=>amounts ? {name:t.name, ...globalThis.RicottaStockLink.amount(t), ...hints(t)} : {name:t.name, ...hints(t)})});
    }
    {
      const m = path.match(/^items\/([^/]+)\/stock$/);
      if(method === 'PUT' && m){
        if(!can(account, 'catalog')) return fail('forbidden', 403);
        const it = db.items.find(x=>x.id === decodeURIComponent(m[1]));
        if(!it) return fail('gone', 409);
        const L = globalThis.RicottaStockLink, before = L.linksOf(it);
        const want = [...new Set(Array.isArray(body.stockItems) ? body.stockItems : body.stockItem ? [body.stockItem] : [])];
        if(want.some(n=>!LAB_STOCK.some(x=>x.name === n))) return fail('stock_item_unknown', 422);
        const odd = want.filter(n=>!before.includes(n) && !L.matches(it, n));
        if(odd.length && !(body.anyway === true || (Array.isArray(body.anyway) && odd.every(n=>body.anyway.includes(n))))) return fail('names_dont_match', 422);
        it.stockItem = want[0] || null; it.stockItems = want; save();
        return json({ok:true, stockItem:want[0] || null, stockItems:want, stock:want.length ? labStockFor(want) : null});
      }
    }
    // Low stock alert of one item: a level in its stock item's counting format, or null for none.
    {
      const m = path.match(/^items\/([^/]+)\/low-alert$/);
      if(method === 'PUT' && m){
        if(!can(account, 'catalog')) return fail('forbidden', 403);
        const it = db.items.find(x=>x.id === decodeURIComponent(m[1]));
        if(!it) return fail('gone', 409);
        const level = body.level === null ? null : globalThis.RicottaStockLink.lowLevel(body.level);
        if(level === null && body.level !== null) return fail('invalid_input');
        if(level !== null && !it.stockItem) return fail('not_linked', 422);
        if(level === null) delete it.lowAlert; else it.lowAlert = level;
        save();
        return json({ok:true, lowAlert:level});
      }
    }
    // Check now: Rico "reads" Ricotta Restaurant in about two seconds and finds one new item.
    if(method === 'POST' && path === 'rico/check-now'){
      if(!can(account, 'transfers') && !can(account, 'receipts')) return fail('forbidden', 403);
      const h = labHelper();
      if(h.sync?.state) return json({error:'already_checking', helper:h}, 409);
      const askedAt = new Date().toISOString();
      h.sync = {state:'asked', askedAt}; save(); labBump('receipts');
      setTimeout(()=>{ h.sync = {state:'running', askedAt, startedAt:new Date().toISOString()}; save(); labBump('receipts'); }, 900);
      setTimeout(()=>{ db.labCheckItem = true; h.sync = {state:null, askedAt, doneAt:new Date().toISOString(), result:{ok:true, changes:{items:{added:1, addedNames:['Lab Check Item - کاڵای تاقیکردنەوە']}}}}; save(); labBump('receipts', 'data'); }, 2600);
      return json(h);
    }
    // Stock (read only): Main Storage, with practice last-bought and last-moved notes.
    if(method === 'GET' && path === 'stock'){
      if(!can(account, 'transfers') && !can(account, 'receipts')) return fail('forbidden', 403);
      const day = d=>new Date(Date.now() - d * 86400000).toISOString();
      const items = [['Aleppo Pepper - پول بیبەر', 'غرام', {name:'کیلۆ', factor:1000}, {name:'فەردە', factor:25000}, 3200], ['White Toast - توست أبيض', 'دانە', {name:'سیت', factor:25}, {name:'کارتۆن', factor:250}, 250],
        ['Lemon - لیمۆ', 'غرام', {name:'کیلۆ', factor:1000}, null, 12500], ['Oil 1L - زەیتی 1 لیتری', 'مل', {name:'دانە', factor:1000}, {name:'کارتۆن', factor:12000}, 40000], ['Faheta Bread - صمونی فاهیتا', 'دانە', {name:'دانە', factor:1}, null, 0]]
        .map(([name, base, count, buy, main], k)=>({name, base, count, buy, main, inMain:true, lastBought:k % 2 ? null : {at:day(k + 1), supplier:'Bread House Bakery', qty:2, unit:buy?.name || base, cost:8500, currency:'IQD'}, lastMoved:{at:day(k), from:'Main Storage', to:['Pizza','Minibar','Kebab'][k % 3], qty:1, unit:count.name}}));
      if(db.labCheckItem) items.push({name:'Lab Check Item - کاڵای تاقیکردنەوە', base:'دانە', count:null, buy:null, main:6, inMain:true, lastBought:null, lastMoved:null});
      return json({at:Date.now() - (LAB_STALE() ? 42 : 0) * 60000, zone:'Main Storage', items, helper:labHelper()});
    }
    // Transfers: the stock Rico reads, and a Rico who fills a transfer in two seconds and moves it once approved.
    if(path === 'transfers' || path.startsWith('transfers/')){
      if(!can(account, 'transfers')) return fail('forbidden', 403);
      db.tf ||= {transfers:[]};
      const T = globalThis.RicottaTransfers, list = db.tf.transfers, now = ()=>new Date().toISOString(), today = new Date().toISOString().slice(0, 10);
      const cat = {at:now(), zones:['Main Storage','Breakfast','Appetizers','Minibar','Kentucky','Kebab','Pizza','Bakery','Teahouse','نانی بەیانی (Breakfast)'],
        titems:[{name:'Aleppo Pepper - پول بیبەر', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:{name:'فەردە', factor:25000}, stock:{'Main Storage':3200, Minibar:0}},
          {name:'White Toast - توست أبيض', base:'دانە', count:{name:'سیت', factor:25}, buy:{name:'کارتۆن', factor:250}, stock:{'Main Storage':250, Appetizers:50}},
          {name:'Lemon - لیمۆ', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:null, stock:{'Main Storage':12500, Minibar:2000}},
          {name:'Oil 1L - زەیتی 1 لیتری', base:'مل', count:{name:'دانە', factor:1000}, buy:{name:'کارتۆن', factor:12000}, stock:{'Main Storage':40000}},
          {name:'Faheta Bread - صمونی فاهیتا', base:'دانە', count:{name:'دانە', factor:1}, buy:null, stock:{'Main Storage':40}}]};
      if(method === 'GET' && path === 'transfers') return json({transfers:list.filter(r=>r.status !== 'draft' || r.by === account), catalog:{zones:T.zonesOf(cat), titems:cat.titems, at:cat.at}, helper:(db.rr && db.rr.helper) || {online:true, mode:'real', launcher:{online:true}}, usual:{}, today});
      const m = path.match(/^transfers\/([0-9a-f-]{36})(?:\/(send|approve|cancel|photos))?$/); if(!m) return fail('not_found', 404);
      let r = list.find(x=>x.id === m[1]);
      if(method === 'PUT' && !m[2]){
        if(r && r.status !== 'draft') return fail('not_a_draft', 409);
        if(!r){ r = {id:m[1], by:account, source:'app', status:'draft', warnings:[], log:[], photos:[], version:0, createdAt:now()}; list.unshift(r); }
        Object.assign(r, {from:body.from, to:body.to, yesterday:!!body.yesterday, lines:body.lines || [], version:r.version + 1, updatedAt:now()});
        save(); return json(r);
      }
      if(!r) return fail('not_found', 404);
      if(method === 'DELETE'){ db.tf.transfers = list.filter(x=>x !== r); save(); return ok(); }
      if(method === 'GET' && m[2] === 'photos'){
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100"><rect width="900" height="1100" fill="#fff"/><text x="40" y="80" font-size="40" font-family="sans-serif">Move stock between storages</text><text x="40" y="150" font-size="32" font-family="sans-serif">${(r.from||'')} → ${(r.to||'')}</text>${(r.lines||[]).map((l,i)=>`<text x="40" y="${240+i*70}" font-size="30" font-family="sans-serif">${i+1}. ${String(l.item).replace(/[<&]/g,'')} · ${l.qty} ${l.unit}</text>`).join('')}</svg>`;
        return json({photos:(r.photos||[]).map(p=>({kind:p.kind, at:p.at, url:'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)}))});
      }
      if(m[2] === 'send'){
        const c = T.check({from:r.from, to:r.to, yesterday:r.yesterday, lines:r.lines}, cat, {});
        if(c.errors.length) return json({error:'invalid_transfer', errors:c.errors}, 422);
        const conf = new Set(body.confirm || []); if(c.warnings.some(w=>!conf.has(w.code))) return json({error:'needs_confirmation', warnings:c.warnings}, 409);
        // "Move without asking again" (the sender's setting): approved when sent, moved right after filling in.
        const auto = !!(db.settings && db.settings[account] && db.settings[account].tfAuto);
        Object.assign(r, {status:'queued', auto, approvedBy:auto ? account : null, approvedAt:auto ? now() : null, warnings:c.warnings, sentAt:now(), forDay:r.yesterday ? new Date(Date.now() - 86400e3).toISOString().slice(0, 10) : today, log:[...r.log, {at:now(), who:account, text:'Sent to Rico'}]});
        setTimeout(()=>{ if(r.status !== 'queued') return;
          if(auto){ Object.assign(r, {status:'moved', mode:'real', movedAt:now(), result:{checked:true}, photos:[{kind:'before', at:now()}, {kind:'after', at:now()}], log:[...r.log, {at:now(), who:'rico', text:'Moved without a second approval. Checked in the stock record.'}]}); save(); return; }
          Object.assign(r, {status:'review', mode:'real', photos:[{kind:'before', at:now()}], log:[...r.log, {at:now(), who:'rico', text:'Filled in and checked against the stock. Waiting for approval.'}]}); save(); }, 2000);
        save(); return json(r);
      }
      if(m[2] === 'approve'){
        if(r.status !== 'review') return fail('not_waiting', 409);
        Object.assign(r, {status:'approved', approvedBy:account, approvedAt:now(), log:[...r.log, {at:now(), who:account, text:'Approved'}]});
        setTimeout(()=>{ Object.assign(r, {status:'moved', movedAt:now(), result:{checked:true}, photos:[...r.photos, {kind:'after', at:now()}], log:[...r.log, {at:now(), who:'rico', text:'Moved. Seen in Recent transfers'}]}); save(); }, 2000);
        save(); return json(r);
      }
      if(m[2] === 'cancel'){ Object.assign(r, {status:'cancelled', log:[...r.log, {at:now(), who:account, text:'Cancelled'}]}); save(); return json(r); }
      return fail('not_found', 404);
    }
    // Receipts: a small copy of what Rico reads from Ricotta Restaurant, and a Rico who fills a receipt
    // in two seconds and saves it right after it is approved (there is no Mac in the Lab).
    if(path === 'receipts-settings/telegram') return method === 'GET' ? json({ready:true, connected:!!db.tgLinked}) : json({link:'https://t.me/RicottaHelperBot?start=lab', bot:'RicottaHelperBot'});
    if(path === 'receipts' || path === 'receipts-settings' || path === 'receipts-settings/rico' || path === 'receipts-activity' || path.startsWith('receipts/')){
      if(!can(account, 'receipts')) return fail('forbidden', 403);
      db.rr ||= {receipts:[], helper:{online:true, lastSeen:new Date().toISOString(), signedIn:true, busyWith:null, stopped:false, limits:{bigTotal:1000000, priceJump:30, rateMin:1500, rateMax:1800}, version:'lab', mode:'real', launcher:{online:true, command:null, result:null, at:null}}, next:28};
      const cat = {at:new Date().toISOString(), suppliers:['Bread House Bakery','Coffee Supply','Corner Cake','Jabal Amman','ITALY COFFEE QAHOWA','شوینی لقمان بۆ کەلەشیر و قاز و قەل','کۆگای مختار','ابو ابراهيم قصاب'],
        zones:['Main Storage','Kebab','Pizza','Bakery','Teahouse','Kentucky'],
        items:[{name:'Frozen Peas - بزالیا سادە', base:'غرام', units:[{name:'دانە', factor:400},{name:'کارتۆن', factor:8000}]},
          {name:'هیل (Natural Green Indian Cardamoms)', base:'غرام', units:[{name:'دانە', factor:1000}]},
          {name:'Kalabeb', base:'غرام', units:[{name:'کیلۆ', factor:1000}]},
          {name:'Roasted Coffee', base:'غرام', units:[{name:'کیلۆ', factor:1000}]},
          {name:'Yogurt - ماستی ماستاو', base:'غرام', units:[{name:'جام', factor:2000},{name:'ستل', factor:1}]},
          {name:'Los Amigos Cheddar Cheese  - جبن شیدار سائل', base:'غرام', units:[{name:'دانە', factor:3000},{name:'کارتۆن', factor:18000}]},
          {name:'Mushroom - کوارگ', base:'دانە', units:[{name:'کارتۆن', factor:8}]}]};
      const R = globalThis.RicottaReceipts, list = db.rr.receipts, now = ()=>new Date().toISOString();
      if(method === 'GET' && path === 'receipts') return json({receipts:list.filter(r=>r.status !== 'draft' || r.by === account), catalog:cat, helper:db.rr.helper, last:{'Frozen Peas - بزالیا سادە|دانە (400×)|IQD':2000}});
      if(method === 'GET' && path === 'receipts-activity'){ const t0 = Date.now(); return json({events:[
        {id:3, at:new Date(t0 - 60e3).toISOString(), kind:'status', status:'problem', supplier:'Bread House Bakery', invoice:'2627', source:'telegram', mode:'practice', by:'rico', text:'Practice run: filled in, photographed and discarded. Nothing was saved.'},
        {id:2, at:new Date(t0 - 120e3).toISOString(), kind:'launch', mode:'practice', text:'Rico (practice mode, nothing is saved) is on: signed in to Ricotta Restaurant and read 317 items, 57 suppliers and 12 zones.'},
        {id:1, at:new Date(t0 - 130e3).toISOString(), kind:'command', status:'practice', by:'rozha'}]}); }
      if(method === 'POST' && path === 'receipts-settings/rico'){ const h = db.rr.helper; if(body.action === 'stop'){ h.online = false; h.mode = null; h.launcher.result = 'Rico is off.'; } else { h.online = true; h.mode = body.action; h.launcher.result = (body.action === 'practice' ? 'Rico (practice mode, nothing is saved)' : 'Rico') + ' is on: signed in to Ricotta Restaurant and read 7 items, 8 suppliers and 6 zones.'; } save(); return json(h); }
      if(method === 'PUT' && path === 'receipts-settings'){ if(account !== 'rozha') return fail('forbidden', 403); if(typeof body.stopped === 'boolean') db.rr.helper.stopped = body.stopped; if(body.limits) Object.assign(db.rr.helper.limits, body.limits); save(); return json(db.rr.helper); }
      const m = path.match(/^receipts\/([0-9a-f-]{36})(?:\/(send|approve|cancel|photos))?$/); if(!m) return fail('not_found', 404);
      let r = list.find(x=>x.id === m[1]);
      if(method === 'PUT' && !m[2]){
        if(r && r.status !== 'draft') return fail('not_a_draft', 409);
        if(!r){ r = {id:m[1], by:account, source:'app', status:'draft', warnings:[], log:[], photos:[], finance:null, total:null, version:0, createdAt:now()}; list.unshift(r); }
        Object.assign(r, {supplier:body.supplier, invoice:body.invoice, zone:body.zone || 'Main Storage', currency:body.currency === 'USD' ? 'USD' : 'IQD', rate:body.rate ?? null, delivery:body.delivery ?? null, lines:body.lines || [], version:r.version + 1, updatedAt:now()});
        save(); return json(r);
      }
      if(!r) return fail('not_found', 404);
      if(method === 'DELETE'){ db.rr.receipts = list.filter(x=>x !== r); save(); return ok(); }
      // A sample photo (a tall receipt drawing) so the Lab shows how photos look.
      if(method === 'GET' && m[2] === 'photos'){
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1500"><rect width="900" height="1500" fill="#fff"/><rect x="40" y="40" width="820" height="90" rx="12" fill="#1E6B4F"/><text x="70" y="98" font-size="40" fill="#fff" font-family="sans-serif">New purchase receipt</text>${(r.lines||[]).map((l,i)=>`<rect x="40" y="${180+i*170}" width="820" height="140" rx="14" fill="none" stroke="#d0d5dd" stroke-width="3"/><text x="70" y="${240+i*170}" font-size="34" font-family="sans-serif">${(l.item||'').replace(/[<&]/g,'')}</text><text x="70" y="${290+i*170}" font-size="30" fill="#555" font-family="sans-serif">${l.qty} x ${l.cost}</text>`).join('')}<text x="40" y="1440" font-size="44" font-family="sans-serif">Total: IQD ${r.total||0}</text></svg>`;
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        return json({photos:(r.photos||[]).map(p=>({kind:p.kind, at:p.at, url}))});
      }
      if(m[2] === 'send'){
        const c = R.check(r, cat, db.rr.helper.limits, {});
        if(c.errors.length) return json({error:'invalid_receipt', errors:c.errors}, 422);
        Object.assign(r, {status:'queued', total:c.total, warnings:c.warnings, sentAt:now(), log:[...r.log, {at:now(), who:account, text:'Sent to Rico'}]});
        setTimeout(()=>{ if(r.status !== 'queued') return; Object.assign(r, {status:'review', photos:[{kind:'before', at:now()}], log:[...r.log, {at:now(), who:'rico', text:'Filled in Ricotta Restaurant and read every box back. Waiting for approval.'}]}); save(); }, 2000);
        save(); return json(r);
      }
      if(m[2] === 'approve'){
        if(r.status !== 'review') return fail('not_waiting', 409);
        Object.assign(r, {status:'saved', approvedBy:account, savedAt:now(), finance:{tab:'Purchases', month:new Date().toISOString().slice(0, 7), no:db.rr.next++}, log:[...r.log, {at:now(), who:account, text:'Approved'}, {at:now(), who:'rico', text:'Saved and found in Invoices. Every line matches.'}]});
        save(); return json(r);
      }
      if(m[2] === 'cancel'){ if(!['draft','queued','filling','review','problem'].includes(r.status)) return fail('too_late', 409); Object.assign(r, {status:'cancelled', log:[...r.log, {at:now(), who:account, text:'Cancelled'}]}); save(); return json(r); }
      return fail('not_found', 404);
    }
    if(path === 'rico-rules'){
      db.rules ||= [{id:'11111111-1111-4111-8111-111111111111', account:'rozha', rule:'Never order fish on Friday', source:'taught', created_at:new Date().toISOString()},
        {id:'11111111-1111-4111-8111-111111111112', account:'rozha', rule:'Likes short answers', source:'learned', created_at:new Date().toISOString()}];
      if(method === 'POST'){
        if(/\b(pin|password|code)\b/i.test(String(body.rule))) return json({error:'secret'}, 422);
        db.rules.push({id:crypto.randomUUID(), account, rule:String(body.rule).slice(0, 300), source:'taught', created_at:new Date().toISOString()}); return json({ok:true});
      }
      return json(db.rules);
    }
    if(path === 'rico-routines'){
      db.routines ||= [{id:'22222222-2222-4222-8222-222222222221', account:'rozha', kind:'remind', text:'Do the transfers', supplierIds:[], time:'09:00', days:[0,1,2,3,4,5,6], enabled:true, lastRunDay:null}];
      if(method === 'POST'){
        const at = body.runAt ? Date.parse(body.runAt) : NaN;
        if(!['remind','prepare_order','ask'].includes(body.kind) || !String(body.text || '').trim()) return json({error:'invalid_input'}, 400);
        if(body.runAt ? body.kind === 'prepare_order' || !Number.isFinite(at) : !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '')) return json({error:'invalid_input'}, 400);
        if(body.kind === 'prepare_order' && !(body.supplierIds || []).length) return json({error:'invalid_input'}, 400);
        if(db.routines.filter(x=>x.account === account).length >= 20) return json({error:'too_many'}, 409);
        const time = body.runAt ? new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Baghdad', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(at) : body.time;
        const same = !body.runAt && db.routines.find(x=>x.account === account && x.kind === body.kind && x.time === body.time && x.text === body.text);
        if(same) return json({routine:same});
        const r = {id:crypto.randomUUID(), account, kind:body.kind, text:String(body.text || '').slice(0, 200), supplierIds:body.kind === 'prepare_order' ? body.supplierIds : [], time, days:body.runAt ? [0,1,2,3,4,5,6] : body.days || [0,1,2,3,4,5,6], enabled:true, lastRunDay:null, runAt:body.runAt ? new Date(at).toISOString() : null};
        db.routines.push(r); save(); return json({routine:r});
      }
      return json(db.routines.filter(r=>account === 'rozha' || r.account === account));
    }
    if(path.startsWith('rico-routines/')){
      const id = path.split('/')[1], r = (db.routines || []).find(x=>x.id === id);
      if(!r) return json({error:'not_found'}, 404);
      if(method === 'PUT'){ r.enabled = !!body.enabled; save(); return json({ok:true}); }
      if(method === 'DELETE'){ db.routines = db.routines.filter(x=>x.id !== id); save(); return json({ok:true}); }
    }
    if(path.startsWith('rico-rules/') && method === 'DELETE'){ db.rules = (db.rules || []).filter(r=>r.id !== path.split('/')[1]); return json({ok:true}); }
    if(path === 'admin/backups' && method === 'GET') return json(Array.from({length:7}, (_, i)=>({day:new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), suppliers:db.suppliers.length, items:db.items.length, orders:db.history.length, at:new Date().toISOString()})));
    if(path === 'admin/backups/restore' && method === 'POST') return /^\d{6}$/.test(String(body.pin || '')) && body.pin !== '000000' ? json({suppliers:0, units:0, items:1, orders:2}) : fail('wrong_pin', 403);
    if(path === 'orders/read-list' && method === 'POST') return json({rows:db.items.slice(0, 4).map((i, n)=>({said:i.name, qty:n + 2, itemId:i.id, sure:true})).concat({said:'Something unclear', qty:1, itemId:null, sure:false})});
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
      || (path === 'activity' && !can(account,'record'))
      || ((path.startsWith('assistant/') || path.startsWith('rico-chats') || path === 'streak/recover') && !can(account,'assistant'))
      || (path === 'reports/catalog' && !can(account,'exports'))
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
    // Admin > Cloud Rico: the server's reader of Ricotta Restaurant, in the same shape as the server.
    if(path === 'admin/rr-reader' || path === 'admin/rr-reader/run'){
      if(account !== 'rozha') return fail('forbidden', 403);
      db.cloud ||= {};
      if(method === 'POST'){ db.cloud.fixedAt = new Date().toISOString(); save(); }   // Read now: works again, then the same view as GET
      const ago = m=>new Date(Date.now() - m * 60000).toISOString(), stuck = LAB_STALE();
      const log = [];
      if(db.cloud.fixedAt) log.push({at:db.cloud.fixedAt, ms:3400, ok:true, did:['catalog', 'invoices']});
      for(let k = 0; k < 8; k++) log.push(stuck && k < 5 ? {at:ago(k * 5 + 2), ms:20000, ok:false, kind:'down', cause:'Ricotta Restaurant did not answer (HTTP 502).'} : {at:ago(k * 5 + 2), ms:2100 + k * 90, ok:true, did:k % 3 ? ['catalog'] : ['catalog', 'invoices']});
      return json({ready:true, missing:[], on:true, lastRun:ago(2), catalogAt:labStockAt(), invoicesAt:stuck ? ago(44) : ago(9), stockAt:labStockAt(), nextCatalog:ago(-3), nextInvoices:ago(-6),
        counts:{items:317, zones:12, suppliers:57, invoices:64}, problem:stuck ? {kind:'down', cause:'Ricotta Restaurant did not answer (HTTP 502).', since:ago(42)} : null, log});
    }
    if(method === 'GET' && path === 'rr-invoices'){
      if(!can(account, 'receipts') && !can(account, 'transfers')) return fail('forbidden', 403);
      const month = query.get('month') || new Date().toISOString().slice(0, 7), sup = query.get('supplier') || '';
      const sups = ['Dairy Co', 'Erbil Veg Market', 'Bread House Bakery', 'Coffee Supply'];
      const items = [['Mozzarella - پەنیری مۆزارێلا', 'کیلۆ', 12000], ['Tomato - تەماتە', 'کیلۆ', 1250], ['Faheta Bread - صمونى فاهيتا', 'دانە', 250], ['Espresso Beans - قاوە', 'کیلۆ', 28000], ['Lemon - لیمۆ', 'کیلۆ', 2000]];
      const rows = Array.from({length:14}, (_, k)=>{
        const s = sups[k % 4], day = String(1 + k * 2).padStart(2, '0'), lines = items.filter((_, j)=>(j + k) % 2 === 0).map(([item, unit, price], j)=>({item, unit, qty:2 + (j + k) % 5, unit_cost:price + (k > 7 ? Math.round(price * .1) : 0)}));
        lines.forEach(l=>{ l.line_total = l.qty * l.unit_cost; });
        return {id:'lab-inv-' + k, entry_date:month + '-' + day, invoice_number:String(2600 + k), supplier_name:s, status:'open', currency:'IQD', total:lines.reduce((a, l)=>a + l.line_total, 0), delivery_fee:k % 3 ? 0 : 5000, paid:k % 4 !== 1, line_count:lines.length, lines};
      }).filter(r=>!sup || r.supplier_name.toLowerCase().includes(sup.toLowerCase()));
      return json({month, supplier:sup || null, at:new Date().toISOString(), invoices:rows});
    }
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
    // Rico's AI: which AIs answer, how each answered last, and this month's replies and tokens.
    if(method === 'PUT' && /^admin\/ai\/(anthropic|gemini|groq)$/.test(path)){ db.aiOff ||= {}; db.aiOff[path.split('/')[2]] = !body.enabled; save(); return ok(); }
    if(method === 'GET' && path === 'admin/ai') return json({from:monthStartIso(), brains:[
      {id:'anthropic', connected:true, state:'working', at:new Date(Date.now() - 4*60000).toISOString(), calls:41, input:236000, output:18400, enabled:!db.aiOff?.anthropic},
      {id:'gemini', connected:true, state:'working', at:new Date(Date.now() - 3600000).toISOString(), calls:30, input:142000, output:25100, enabled:!db.aiOff?.gemini},
      {id:'groq', connected:true, state:'busy', at:new Date(Date.now() - 86400000).toISOString(), calls:15, input:34000, output:7500, enabled:!db.aiOff?.groq}]});
    // Rico's orders (TEST): what Rico sent by himself over WhatsApp, Rozh only (like the server).
    if(method === 'GET' && path === 'rico/orders'){
      if(account !== 'rozha') return fail('forbidden', 403);
      const at = m=>new Date(Date.now() - m*60000).toISOString();
      return json({ready:true, orders:[
        {id:2, created_at:at(12), supplier_name:'Bakery', status:'sent', error:null, test:true, reason:'usual amounts: ordered on 3 of the last 4 Tuesdays', lines:[{name:'Burger bread', qty:24, unit:'piece'},{name:'Toast bread', qty:6, unit:'pack'}]},
        {id:1, created_at:at(60*26), supplier_name:'Vegetables', status:'failed', error:'window_closed', test:true, reason:'the amounts Rozh named', lines:[{name:'Tomato', qty:5, unit:'kg'}]}]});
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
    // Admin > Server: how full the free plan is (the real numbers: 32 MB of 500 MB, 27 MB of 1 GB).
    // Admin's overview: practice numbers in the same shape as the server's (14 Baghdad days each).
    if(method === 'GET' && path === 'admin/overview'){
      const days = Array.from({length:14}, (_, i)=>new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10));
      const per = ns=>days.map((day, i)=>({day, n:ns[i]}));
      const orders = per([5,7,4,8,6,3,5,7,4,9,6,3,5,7]), receipts = per([3,5,4,2,6,3,4,4,3,6,5,3,2,3]), transfers = per([6,8,7,5,9,6,8,7,9,6,8,10,5,12]);
      const at = new Date(Date.now() - 3600000).toISOString();
      return json({readAt:new Date().toISOString(), today:days[13],
        orders:{today:7, todayItems:22, last7:41, last30:160, items30:620, perDay:orders, suppliers:[{name:'Erbil Veg Market', n:80}], last:{at, by:'yunis'}},
        receipts:{today:3, todayTotals:{IQD:1204000}, last7:26, last7Totals:{IQD:9800000}, perDay:receipts, active:0, problems:[], last:{at, by:'rozha', supplier:'Bread House Bakery'}},
        transfers:{today:12, last7:55, perDay:transfers, active:0, problems:[], last:{at, by:'rozha', to:'Pizza'}}});
    }
    // Admin, Stock names: sample names with each kind of problem (Lab only; the real list comes from
    // Ricotta Restaurant's stock and the rules in supabase/functions/api/stock-names.ts).
    if(path === 'admin/stock-names' || path === 'admin/stock-names/check'){
      const checked = method === 'POST' || db.namesChecked;
      if(method === 'POST') db.namesChecked = true;
      const rows = [
        {name:'Akkawi  Cheese - پەنیری عەکاوی', problems:[{kind:'spacing', code:'double'}], fixed:'Akkawi Cheese - پەنیری عەکاوی', why:''},
        {name:'Lemon -لیمۆ', problems:[{kind:'spacing', code:'separator'}], fixed:'Lemon - لیمۆ', why:''},
        {name:'Almonds - باوي', problems:[{kind:'letters', code:'mixedLetters'}], fixed:'Almonds - باوی', why:''},
        {name:'Pepsi 330ml - پێپسی ٣٣٠', problems:[{kind:'letters', code:'digits'}], fixed:'Pepsi 330ml - پێپسی 330', why:''},
        {name:'Parsleyجەعفەری', problems:[{kind:'letters', code:'glued'}, {kind:'spacing', code:'separator'}], fixed:'Parsley - جەعفەری', why:''},
        {name:'تەماتە', problems:[{kind:'missing', code:'noEnglish'}], fixed:checked ? 'Tomato - تەماتە' : null, why:checked ? 'Added the English name' : ''},
        {name:'Basil', problems:[{kind:'missing', code:'noLocal'}], fixed:null, why:''},
        ...(checked ? [{name:'Mozarella - پەنیری مۆزارێلا', problems:[{kind:'spelling', code:'spelling'}], fixed:'Mozzarella - پەنیری مۆزارێلا', why:'Misspelled: Mozarella'}] : []),
      ];
      return json({readAt:new Date(Date.now() - 6*60000).toISOString(), total:321, checkedAt:checked ? new Date().toISOString() : null, provider:checked ? 'anthropic' : null, stale:false, aiReady:true, rows, fixed:4});
    }
    if(method === 'GET' && path === 'admin/server') return json({dbBytes:32077491, filesBytes:27532729, dbLimit:500 * 1048576, filesLimit:1073741824});
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
      } else if(Array.isArray(body.only) && !prev && table !== 'units'){
        return fail('gone', 409);
      } else if(Array.isArray(body.only) && prev && table !== 'units'){
        // Like the server: an edit that names its fields changes only those.
        const allowed = table === 'suppliers' ? ['name','phone','reminder','buys'] : ['name','kind','unit','supplierId','note','aliases','available','sortOrder'];
        if(body.only.some(k=>!allowed.includes(k)) || (body.only.includes('name') && !String(body.name||'').trim())) return fail('invalid_input');
        for(const k of body.only) prev[k] = body[k] ?? (k === 'note' ? '' : null);
        if(body.only.includes('supplierId') && !body.only.includes('sortOrder')) prev.sortOrder = 'sortOrder' in body ? body.sortOrder : null;
        db.activity.unshift({id:'aud-'+(++db.seq), ts:new Date().toISOString(), actor:account, action:'edit', type, name:prev.name, fields:[]});
      } else {
        let row;
        if(table === 'suppliers') row = {id, name:String(body.name||'').slice(0,160), phone:body.phone || null, reminder:body.reminder || null, buys:['expenses','both'].includes(body.buys) ? body.buys : 'food'};
        else if(table === 'items') row = {id, name:String(body.name||'').slice(0,160), kind:body.kind === 'expense' ? 'expense' : 'food', unit:body.unit || null, supplierId:body.supplierId || null, note:'note' in body ? String(body.note||'').slice(0,120) : (prev ? prev.note || '' : ''), sortOrder:'sortOrder' in body ? body.sortOrder : (prev ? prev.sortOrder : null), aliases:'aliases' in body ? body.aliases : (prev ? prev.aliases || [] : []), available:'available' in body ? body.available !== false : (prev ? prev.available !== false : true)};
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
      // As on the server: only Rozh removes orders; her own for 15 minutes, any other with her PIN (any 6 digits in the Lab).
      if(account !== 'rozha') return fail('forbidden', 403);
      if(body.pin !== undefined){ if(!/^\d{6}$/.test(String(body.pin))) return fail('wrong_pin', 403); }
      else if(o.by !== account || Date.now() - Date.parse(o.date) > 15*60000) return fail('pin_required', 403);
      db.history = db.history.filter(x=>x !== o);
      streakUnhit(window.RICOTTA_TODAY || dayOf(o.date));
      save(); return json({ok:true, streak:streakView()});
    }
    if(method === 'GET' && path === 'activity') return json(db.activity);
    if(method === 'GET' && path === 'devices') return json(devices(account));
    if(method === 'POST' && path === 'devices/me' && Number(body.seconds) > 0){
      const day = new Date().toISOString().slice(0,10), id = deviceId() || 'this-device';
      db.usage ||= [];
      const row = db.usage.find(r=>r.account === account && r.deviceId === id && r.day === day);
      if(row) row.seconds = Math.min(86400, row.seconds + Math.min(1800, Math.floor(body.seconds))); else db.usage.push({account, deviceId:id, label:'Mac|Website', day, seconds:Math.min(1800, Math.floor(body.seconds))});
      save();
    }
    if(path === 'devices/me') return json({ok:true, sessionEnds:new Date(Date.now() + 30*86400000).toISOString()});
    if(path === 'devices/me/ack' || path === 'devices/command') return ok();
    /* Admin -> PINs. The Lab keeps no PINs: 000000 stands for a wrong current PIN, and Yunis's Lab PIN (222222)
       can't be given to Rozh. */
    if(method === 'PUT' && path === 'admin/pin'){
      if(account !== 'rozha') return fail('forbidden', 403);
      const pin = String(body.newPin || ''), digits = [...pin].map(Number);
      if(!['rozha','yunis'].includes(body.account) || !/^\d{6}$/.test(pin)) return fail('invalid_pin');
      if(new Set(pin).size === 1 || digits.every((d, i)=>!i || d === digits[i-1] + 1) || digits.every((d, i)=>!i || d === digits[i-1] - 1)) return fail('weak_pin');
      if(!/^\d{6}$/.test(String(body.currentPin || '')) || body.currentPin === '000000') return fail('wrong_pin', 403);
      if(body.account === 'rozha' && pin === '222222') return fail('duplicate_pin');
      return ok();
    }
    if(method === 'PUT' && (m = path.match(/^rico-chats\/([^/]+)\/pin$/))){
      const c = db.chats.find(x=>x.id === decodeURIComponent(m[1]));
      if(typeof body.pinned !== 'boolean') return fail('invalid_input');
      if(!c || (c.account !== account && account !== 'rozha')) return fail('not_found', 404);
      c.pinned = body.pinned; save(); return ok();
    }
    if(method === 'PUT' && (m = path.match(/^rico-chats\/([^/]+)\/title$/))){
      const c = db.chats.find(x=>x.id === decodeURIComponent(m[1]));
      if(!c || (c.account !== account && account !== 'rozha')) return fail('not_found', 404);
      c.title = String(body.title || '').slice(0, 80); save(); return ok();
    }
    if(method === 'POST' && path === 'assistant/title'){
      // The Lab names a chat from its question (the real app asks the AI for 2 to 5 words).
      const q = String(body.question || '').toLowerCase();
      const title = /cheese|پەنیر|جبن/.test(q) ? 'Cheese stock' : /low|کەم|ينقص/.test(q) ? 'Low stock today' : /needs|پێویستی|يحتاج/.test(q) ? 'What needs attention' : /price|نرخ|سعر/.test(q) ? 'Price changes' : /late|دوا|تأخر/.test(q) ? 'Late orders today' : 'Kitchen questions';
      return json({title});
    }
    if((m = path.match(/^rico-chats(?:\/(.+))?$/))){
      const id = m[1] ? decodeURIComponent(m[1]) : null;
      if(method === 'GET' && !id) return json({chats:[...db.chats].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(c=>({id:c.id, account:c.account, title:c.title, pinned:!!c.pinned, createdAt:c.createdAt, updatedAt:c.updatedAt}))});
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
    if(path === 'push/subscription' || path === 'push/lang') return ok();
    if(method === 'POST' && path === 'push/send') return json({sent:0, failed:0, removed:0, lab:true});
    if(method === 'PUT' && path === 'settings'){ db.settings ||= {}; db.settings[account] = {...(db.settings[account] || {}), [body.key]:body.value}; save(); return ok(); }
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
      const wait = Math.min(25, Math.max(0, Number(query.get('wait')) || 0)) * 1000, since = Number(query.get('since'));
      await new Promise(done=>{
        if(since !== labSig.n){ done(); return; }
        const fin = ()=>{ clearTimeout(timer); labSigWait.delete(fin); done(); };
        const timer = setTimeout(fin, wait); labSigWait.add(fin);
        init.signal?.addEventListener('abort', fin, {once:true});
      });
      if(init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response(JSON.stringify({n:labSig.n, kinds:{...labSig.kinds}}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    return handle(path, method, headers, body || {});
  };
})();
