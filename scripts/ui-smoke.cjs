/* Local UI regression checks. Requires Playwright (no production API calls).
   Run: node scripts/ui-smoke.cjs
   EDGE_PATH can select a locally installed Chromium/Edge executable.
   The server is mocked: two accounts (Rozha with every screen, Yunis with
   the standard set the server gives him: Order, Rico, History, Manage,
   Record) and a 181-item catalog. It checks English, Kurdish and Arabic at six widths, Admin's PIN
   change, page transitions, Rico's moods and inbox, and that every language
   has every text. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const siteRoot=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):root;
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'ricotta-ui-'));
const fast=process.env.UI_SMOKE_FAST==='1';
const viewportWidths=fast?[390,1440]:[360,390,768,1024,1440,1920];
const LANGS=['en','ku','ar'];

/* Every language has exactly the same texts. */
const T=vm.runInNewContext(fs.readFileSync(path.join(root,'i18n.js'),'utf8')+';T');
for(const lang of ['ku','ar']){
  assert.deepEqual(Object.keys(T[lang]).sort(),Object.keys(T.en).sort(),lang+' has every text');
  assert.deepEqual(Object.keys(T[lang].ricoStatus).sort(),Object.keys(T.en.ricoStatus).sort(),lang+' Rico status texts');
  assert.deepEqual(Object.keys(T[lang].ricoErrors).sort(),Object.keys(T.en.ricoErrors).sort(),lang+' Rico error texts');
  assert.ok(!/[\u0660-\u0669\u06F0-\u06F9]/.test(fs.readFileSync(path.join(root,'i18n.js'),'utf8')),'numbers are written 1 2 3');
}

/* Every script and style the page loads is on the updater's refresh list, so a hard refresh never leaves one stale. */
{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const loaded=[...html.matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)].map(m=>m[1]).concat('style.css','sw.js');
  const listed=[...fs.readFileSync(path.join(root,'update-check.js'),'utf8').match(/const APP_FILES = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  for(const file of loaded) assert.ok(listed.includes(file),file+' is in APP_FILES (update-check.js)');
  // The Lab runs the same app scripts, in the same order, as the real page.
  const deferred=page=>[...page.matchAll(/<script defer src="([^"]+\.js)"><\/script>/g)].map(m=>m[1]);
  assert.deepEqual(deferred(fs.readFileSync(path.join(root,'lab','page.html'),'utf8')).filter(f=>!f.startsWith('lab-')),deferred(html),'lab/page.html loads the same app scripts as index.html');
}

const ALL_VIEWS=['order','assistant','transfers','manage','history','suppliers','itemsAdmin','units','record','admin','settings'];
const YUNIS_VIEWS=['order','assistant','history','manage','suppliers','itemsAdmin','units','record'];
const supplierNames=['Corner Cake','Golden Bread Bakery','Fresh produce','Daily essentials','Kitchen supplies','Beverages','Dairy','Meat supplier','دابینکەری سەوزە','دابینکەری بەرهەمەکان'];
const suppliers=supplierNames.map((name,i)=>({id:'s'+i,name,phone:''}));
const items=Array.from({length:181},(_,i)=>({id:'i'+i,name:i%3===0?'تەماتە '+i:'Kitchen item '+String(i).padStart(3,'0'),unit:'box',supplierId:'s'+(i%10)}));
// Record can return up to 500 audit entries, including formatted reminders.
const recordActivity=Array.from({length:500},(_,i)=>({
  id:'audit'+i,ts:new Date(Date.UTC(2026,8,24,8,0,-i)).toISOString(),
  actor:i%2?'yunis':'rozha',action:['add','edit','delete'][i%3],
  type:['item','supplier','unit'][i%3],name:'Audit entry '+i,
  fields:[{k:'name',from:'Before',to:'After'},{k:'reminder',from:'off',to:'09:00|6,0,1'}],
}));
const fixtureFor=account=>({
  account, name:account==='rozha'?'Rozha':'Yunis', views:account==='rozha'?ALL_VIEWS:YUNIS_VIEWS,
  suppliers, items, units:[{id:'box',en:'box',ku:'سندوق',ar:'صندوق'}],
  history:[{id:'h1',date:'2026-09-23T08:00:00Z',by:'yunis',entries:[{supplierId:'s1',items:[{itemId:'i1',name:items[1].name,qty:2,unit:'box'}]}]}],
  devices:[], activity:recordActivity,
  reminder:{enabled:false,time:'09:00'},
  inbox:[{id:1,kind:'cheer',mood:'excited',en:'Good morning, Rozha! 3 suppliers are due today.',ku:'بەیانیت باش ڕۆژا!',ar:'صباح الخير يا روژا!',at:'2026-09-27T06:00:00Z',read:false}],
});
// Time in the app, as the server sends it: per person, every day, weeks of 7 days and months.
const usageFixture={today:'2026-06-10',
  people:[{account:'rozha',today:1800,week:12600,month:25200,last30:54000,total:90000,since:'2026-04-20'},{account:'yunis',today:0,week:3600,month:3600,last30:3600,total:3600,since:'2026-06-08'}],
  devices:[{account:'rozha',deviceId:'d1',label:'Mac|Website',today:1800,total:90000,lastAt:'2026-06-10T08:00:00Z'}],
  days:Array.from({length:31},(_,i)=>({day:new Date(Date.UTC(2026,5,10-30+i)).toISOString().slice(0,10),rozha:i%3?1800:0,yunis:i>27?1200:0})),
  weeks:Array.from({length:8},(_,i)=>({start:new Date(Date.UTC(2026,5,4-7*(7-i))).toISOString().slice(0,10),rozha:9000+i*600,yunis:i===7?3600:0})),
  months:[{month:'2026-04',rozha:21600,yunis:0},{month:'2026-05',rozha:43200,yunis:0},{month:'2026-06',rozha:25200,yunis:3600}]};
const session=account=>({token:'fixture-'+account,expiresAt:'2099-01-01T00:00:00Z',account,name:account==='rozha'?'Rozha':'Yunis'});
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(siteRoot,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(siteRoot+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const executablePath=process.env.EDGE_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined);
  const browser=await chromium.launch({headless:true,executablePath});
  const errors=[];
  async function context({account='rozha',loggedIn=true,reducedMotion='no-preference',touch=false,homeScreen=false}={}){
    const ctx=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:1000},hasTouch:touch,isMobile:touch,reducedMotion,serviceWorkers:'block'});
    // Opened from the Home Screen (as iOS reports it).
    if(homeScreen) await ctx.addInitScript(()=>Object.defineProperty(Navigator.prototype,'standalone',{get:()=>true}));
    const calls=[];
    const over={};   // what the next bootstrap answers differently (Rozha changing Yunis's access)
    let signedIn=account;
    // Live changes: the counters the server would send; bump() is a change made somewhere else.
    const live={n:5,kinds:{data:5,draft:5,devices:5,admin:5,inbox:5}};
    const bump=kind=>{live.n++;live.kinds={...live.kinds,[kind]:live.n};};
    await ctx.route('**/functions/v1/api/**',async route=>{
      const req=route.request();
      const endpoint=new URL(req.url()).pathname.split('/api/')[1];
      const body=req.postDataJSON?.()||null;
      calls.push({endpoint,method:req.method(),body});
      if(endpoint==='signals'){
        const q=new URL(req.url()).searchParams,since=Number(q.get('since')),until=Date.now()+Math.min(2000,Number(q.get('wait'))*1000);
        while(since===live.n && Date.now()<until) await new Promise(r=>setTimeout(r,50));
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(live)}).catch(()=>{});
        return;
      }
      if(endpoint==='assistant/chat'){
        const reply=body.quickAction==='last_order'?'Last sent order · 2026-09-23':'Fixture Rico reply';
        const events=[{type:'mood',mood:body.quickAction==='late_orders'?'angry':'excited'},{type:'text',text:reply},{type:'done'}];
        await route.fulfill({status:200,contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
        return;
      }
      let status=200, data={};
      if(endpoint==='bootstrap') data={...fixtureFor(signedIn),...over};
      else if(endpoint==='auth/security')data={required:false,siteKey:null};
      else if(endpoint==='devices') data=[];
      else if(endpoint==='activity') data=recordActivity;
      else if(endpoint==='admin/usage') data=usageFixture;
      else if(endpoint==='admin/ai' && req.method()==='GET') data={from:'2026-10-01T00:00:00Z',adminKey:false,brains:[
        {id:'anthropic',connected:true,state:'no_funds',at:new Date().toISOString(),calls:12,input:52000,output:4100,bill:{error:'no_admin_key'}},
        {id:'gemini',connected:true,state:'working',at:new Date().toISOString(),calls:30,input:142000,output:25100,bill:{free:true}},
        {id:'groq',connected:false,state:null,at:null,calls:0,input:0,output:0,bill:{free:true}}]};
      else if(endpoint==='admin/ai/key' && req.method()==='PUT' && !/^sk-ant-api\d\d-/.test(body.key)){ status=400; data={ok:false,error:'invalid_key'}; }
      else if(endpoint==='assistant/inbox') data=fixtureFor(signedIn).inbox;
      else if(endpoint==='assistant/status') data={configured:true,provider:'gemini',model:'gemini-3.5-flash-lite'};
      else if(endpoint==='login'){
        if(body.pin==='358214'){ signedIn='yunis'; data={...session('yunis')}; }
        else if(body.pin==='471906'){ signedIn='rozha'; data={...session('rozha')}; }
        else { status=401; data={error:'invalid_credentials'}; }
      }
      else if(endpoint==='admin/pin' && body.currentPin!=='471906'){ status=403; data={error:'wrong_pin'}; }
      else if(endpoint.startsWith('orders/') && req.method()==='DELETE' && body?.pin!==undefined && body.pin!=='471906'){ status=403; data={error:'wrong_pin'}; }
      else data={ok:true};
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    await ctx.addInitScript(({loggedIn,s})=>{
      window.RICOTTA_TODAY='2026-06-10';   // a day without a holiday theme, so the colour themes are tested
      localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
      // Both people already allowed Rico's AI (the permission itself is checked on Rico's screen below).
      for(const a of ['rozha','yunis']) localStorage.setItem('ricottaOrders:aiConsent2:'+a,'true');
      if(!sessionStorage.getItem('transfersTab')){ localStorage.setItem('ricottaOrders:showTransfers','true'); sessionStorage.setItem('transfersTab','1'); }
      if(loggedIn && !sessionStorage.getItem('seeded')){ localStorage.setItem('ricottaOrders:apiSession',JSON.stringify(s)); sessionStorage.setItem('seeded','1'); }
    },{loggedIn,s:session(account)});
    const page=await ctx.newPage();page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(url);await page.waitForSelector(loggedIn?'#orderResults':'.pin-boxes');await page.waitForSelector('#splash',{state:'detached'});
    return {ctx,page,calls,over,bump};
  }
  const settle=page=>page.waitForFunction(()=>!document.querySelector('.content.gliding'),null,{timeout:4000});
  async function openView(page,view){
    const destination=view==='itemsAdmin'?'manage':view;
    if(['suppliers','units'].includes(destination)){
      await page.locator('.bottomnav [data-view="manage"]').click();await settle(page);
      await page.locator(`[data-manage-view="${destination}"]`).click();
    }else if(destination==='assistant'){
      await page.locator('#ricoTopBtn').click();
    }else if(destination==='settings'){
      await page.locator('#accountBtn').click();
      await page.locator('[data-account-go="settings"]').click();
      await page.waitForSelector('.account-sheet',{state:'detached'});
    }else{
      // More exists only with more than four screens, and only holds the ones that are not tabs.
      if(await page.locator(`#navMore [data-view="${destination}"]`).count() && await page.evaluate(()=>innerWidth<960)){
        if(await page.locator('#navMoreBtn').getAttribute('aria-expanded')!=='true')await page.locator('#navMoreBtn').click();
      }
      await page.locator(`.bottomnav [data-view="${destination}"]`).click();
    }
    await settle(page);
  }
  async function noOverflow(page,label){
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(sizes.document<=sizes.viewport+1,label+' horizontal overflow '+JSON.stringify(sizes));
  }
  async function snapshot(page,name){
    await page.screenshot({path:path.join(artifacts,name),animations:'disabled'});
  }
  try{
    /* Record: a full history must stay usable on phones, in every language. */
    for(const lang of LANGS){
      const {ctx,page}=await context({account:lang==='ar'?'yunis':'rozha',touch:true});
      await page.evaluate(lang=>{state.lang=lang;render();},lang);
      await openView(page,'record');
      assert.equal(await page.locator('.rec-card').count(),30,'Record initially paints one batch');
      assert.ok((await page.locator('.action-row .section-title').textContent()).includes('500'),'total includes older records');
      assert.equal(await page.locator('.rec-card').first().locator('.rec-name').textContent(),'Audit entry 0','newest entry first');
      const allocations=await page.evaluate(()=>{
        dateFormatters.clear();
        const original=Intl.DateTimeFormat;let count=0;
        Intl.DateTimeFormat=function(...args){count++;return new original(...args);};
        try{render();return count;}finally{Intl.DateTimeFormat=original;}
      });
      assert.ok(allocations<=5,'date formatters are shared across the whole list: '+allocations);
      assert.equal(await page.locator('.rec-card').first().evaluate(el=>getComputedStyle(el).backdropFilter),'none','audit cards do not each allocate a blur layer');
      await page.locator('#recMoreBtn').click();
      assert.equal(await page.locator('.rec-card').count(),60,'older entries remain accessible');
      await page.locator('[data-recfilter="supplier"]').click();
      assert.equal(await page.locator('.rec-card').count(),30,'changing filters resets the batch');
      assert.equal(await page.locator('.rec-card').first().locator('.rec-name').textContent(),'Audit entry 1','filter uses the entire history');
      await page.locator('[data-recfilter="all"]').click();
      while(await page.locator('#recMoreBtn').count()) await page.locator('#recMoreBtn').click();
      assert.equal(await page.locator('.rec-card').count(),500,'no audit entries are dropped');
      await openView(page,'order');await openView(page,'record');
      assert.equal(await page.locator('.rec-card').count(),30,'reopening Record resets its rendering budget');
      // The older of two overlapping refreshes must not overwrite the newer one.
      const pending=[];
      await ctx.route('**/functions/v1/api/activity',route=>{pending.push(route);});
      await page.evaluate(()=>{void refreshActivity();void refreshActivity();});
      for(let attempt=0;pending.length<2&&attempt<100;attempt++) await page.waitForTimeout(20);
      assert.equal(pending.length,2);
      await pending[1].fulfill({contentType:'application/json',body:JSON.stringify([{...recordActivity[0],name:'Newest response'}])});
      await page.waitForFunction(()=>document.querySelector('.rec-name')?.textContent==='Newest response');
      await pending[0].fulfill({contentType:'application/json',body:JSON.stringify([{...recordActivity[0],name:'Stale response'}])});
      await page.waitForFunction(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('/api/activity')).length>=4);
      assert.equal(await page.locator('.rec-name').textContent(),'Newest response','late refresh cannot replace newer records');
      await ctx.unroute('**/functions/v1/api/activity');
      await ctx.route('**/functions/v1/api/activity',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
      await page.evaluate(()=>refreshActivity());
      assert.equal(await page.locator('.rec-name').textContent(),'Newest response','failed refresh keeps the visible history');
      await ctx.close();
    }

    /* ---------- Rozha ---------- */
    const {ctx,page,calls,bump}=await context();
    assert.doesNotMatch(await page.locator('meta[name="viewport"]').getAttribute('content'),/user-scalable=no|maximum-scale=1(?:,|$)/,'browser zoom remains available for accessibility');
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).userSelect),'none','app chrome cannot be accidentally selected');
    // macOS Chromium may serialize BlinkMacSystemFont as the equivalent system-ui alias.
    assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily),/^-apple-system, (?:BlinkMacSystemFont|"system-ui"), system-ui/,'English uses Apple\u2019s system font');
    assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily),/"?Noto Kufi Arabic"?/,'Kurdish or Arabic names inside English text fall back to Noto Kufi Arabic off Apple devices');
    assert.equal(await page.locator('#langBtn, #logoutBtn').count(),0,'the language and Sign Out live in the account sheet, not on the top bar');
    await page.evaluate(()=>{window.originalRow=document.querySelector('[data-item-id="i1"]');});
    const inc=page.locator('[data-inc="i1"]');
    await inc.focus();for(let i=0;i<12;i++) await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'12');
    assert.equal(await page.evaluate(()=>originalRow===document.querySelector('[data-item-id="i1"]')),true,'quantity preserves the actual row');
    assert.equal(await inc.evaluate(el=>el===document.activeElement),true,'repeated taps retain focus');
    await page.evaluate(()=>{window.__tones=[];window.soundTone=f=>__tones.push(Math.round(f));lastTick=0;});
    await inc.click();await page.waitForTimeout(60);await page.locator('[data-dec="i1"]').click();
    assert.deepEqual(await page.evaluate(()=>__tones),[1150,900],'quantity changes play the familiar two pitches');
    await page.evaluate(()=>{setSoundOn('qty',false);__tones=[];lastTick=0;});await inc.click();
    assert.deepEqual(await page.evaluate(()=>__tones),[],'quantity sounds can be switched off');
    await page.evaluate(()=>{setSoundOn('qty',true);__tones=[];playOrdersSent();});
    assert.deepEqual(await page.evaluate(()=>__tones.filter((f,i)=>i%2===0)),[523,659,784,1047],'sent chime restored without seasonal audio');
    await page.locator('[data-qty="i1"]').fill('24');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ricottaOrders:pendingCart:rozha')).i1),24,'draft saves to the signed-in account before blur');
    await page.reload();await page.waitForSelector('#splash',{state:'detached'});
    assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'24','draft restores after reload');
    await page.evaluate(()=>{window.originalInput=document.querySelector('#itemSearch');window.originalTop=document.querySelector('.topbar');window.originalNav=document.querySelector('.bottomnav');});
    await page.locator('#itemSearch').fill('Kitchen item');
    assert.equal(await page.evaluate(()=>originalInput===document.activeElement),true);
    await page.locator('[data-ordertab="s1"]').click();
    assert.equal(await page.evaluate(()=>originalInput===document.querySelector('#itemSearch')&&originalTop===document.querySelector('.topbar')&&originalNav===document.querySelector('.bottomnav')),true,'supplier switch preserves shell and search');
    assert.ok((await page.locator('.hero-sub').textContent()).includes('18'),'supplier count follows tab');
    await page.locator('#itemSearch').fill('no such item');assert.equal(await page.locator('#orderResults .item-row').count(),0);
    await page.locator('#itemSearch').fill('');
    assert.equal(await page.locator('.order-options, #orderNoteBtn, [data-scale-order], #voiceOrderBtn').count(),0,'no fold, order note, double/halve or Say your order');
    assert.equal(await page.locator('#sameAsLast').isVisible() && await page.locator('#clearOrderBtn').isVisible(),true,'Same as last time and Clear order are shown directly');
    await page.locator('#clearOrderBtn').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('ricottaOrders:pendingCart:rozha')),null);
    await page.locator('#sameAsLast').click();assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'2');
    await page.locator('.toast-undo').click();assert.equal(await page.evaluate(()=>state.cart.i1||0),0,'Same as last time can be undone');
    await page.locator('#sameAsLast').click();assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'2');

    // The account button opens the account sheet; its Language row opens the language menu, where nothing changes until Apply.
    await page.locator('#accountBtn').click();
    await page.locator('.account-sheet #logoutBtn').waitFor();
    assert.equal(await page.locator('#accountBtn').textContent(),'R','the account button shows the initial');
    await page.locator('#langBtn').click();
    await page.locator('.lang-menu').waitFor();
    assert.equal(await page.locator('.lang-row').count(),3,'English, Kurdish and Arabic');
    assert.equal(await page.locator('[data-lang-apply]').isDisabled(),true,'Apply waits for a new choice');
    await page.locator('[data-pick="ar"]').click();
    assert.equal(await page.evaluate(()=>state.lang),'en','picking alone changes nothing');
    await page.locator('[data-lang-apply]').click();
    await page.waitForFunction(()=>state.lang==='ar'&&document.documentElement.dir==='rtl');
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily.includes('Noto Kufi Arabic')),true,'Arabic uses Noto Kufi Arabic');
    await page.locator('[data-inc="i1"]').click();
    assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'3','increment works after language switch');
    assert.ok(!/[\u0660-\u0669]/.test(await page.locator('.page-date').textContent()),'dates use 1 2 3 in Arabic');

    for(const lang of LANGS){
      await page.evaluate(lang=>setLang(lang),lang);
      for(const width of viewportWidths){
        await page.setViewportSize({width,height:900});
        for(const view of ALL_VIEWS){
          await openView(page,view);
          await noOverflow(page,lang+'/'+width+'/'+view);
        }
        const clipped=await page.evaluate(()=>[...document.querySelectorAll('.bottomnav>.navbtn span')].filter(s=>s.offsetHeight&&s.scrollHeight>s.clientHeight+1).map(s=>s.textContent));
        assert.deepEqual(clipped,[],'tab labels are not cut off ('+lang+'/'+width+')');
      }
    }
    // All nested screens highlight Manage; Rico lights up in the top bar, and Settings (from the account sheet) has no tab.
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>setLang('en'));
    for(const view of ALL_VIEWS){
      await openView(page,view);
      if(view==='settings') assert.equal(await page.locator('.bottomnav [aria-current="page"]').count(),0,'Settings is not a tab');
      else if(view==='assistant'){
        assert.equal(await page.locator('#ricoTopBtn').getAttribute('aria-current'),'page','Rico is current in the top bar');
        assert.equal(await page.locator('.bottomnav [aria-current="page"]').count(),0,'Rico is not a tab');
      }
      else assert.equal(await page.locator('.bottomnav [aria-current="page"]').getAttribute('data-view'),['manage','itemsAdmin','suppliers','units'].includes(view)?'manage':view);
    }
    await openView(page,'order');await page.locator('[data-ordertab="all"]').click();await snapshot(page,'desktop-order.png');
    await page.evaluate(()=>{
      const event=new Event('beforeinstallprompt',{cancelable:true});
      event.prompt=async()=>{window.installPromptCalled=true;};
      event.userChoice=Promise.resolve({outcome:'accepted'});
      dispatchEvent(event); syncInstallPrompt();
    });
    await page.waitForSelector('#installPrompt');
    await page.locator('#installAppBtn').click();
    await page.waitForFunction(()=>window.installPromptCalled===true);
    assert.equal(await page.locator('#installPrompt').count(),0,'desktop install uses and closes the real browser prompt');
    await openView(page,'history');
    assert.match(await page.locator('.hist-date').textContent(),/AM|PM/,'history uses the 12-hour Iraq clock');
    assert.match(await page.locator('.hist-date').textContent(),/Yunis/,'history says who sent it');
    assert.equal(await page.locator('.hist-lines li').count(),1,'each item has its own line');
    assert.equal(await page.locator('.hist-actions [data-reorderhist]').count(),1,'Send again sits under the order');
    await page.locator('[data-delhist]').click();
    await page.locator('#delPin').fill('123456');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>document.getElementById('modalFormStatus')?.classList.contains('error'));
    assert.equal(await page.locator('.hist-card').count(),1,'a wrong PIN deletes nothing');
    await page.locator('#delPin').fill('471906');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('.hist-card'));
    assert.ok(calls.some(c=>c.endpoint==='orders/h1' && c.method==='DELETE' && c.body?.pin==='471906'),'Rozha\u2019s PIN goes with the delete');
    await page.evaluate(name=>{ state.history=[{id:'h1',date:'2026-09-23T08:00:00Z',by:'yunis',entries:[{supplierId:'s1',items:[{itemId:'i1',name,qty:2,unit:'box'}]}]}]; render(); },items[1].name);
    await openView(page,'settings');
    assert.equal(await page.locator('#reminderEnabled').count(),1,'notifications live in Settings');
    assert.equal(await page.locator('[data-pin-change], #ricoKeyState, .cloud-state').count(),0,'PINs and connections live in Admin, not Settings');
    // Admin: one screen of tiles, each opening its page. PINs: Rozha's current PIN first, the new one typed twice.
    await openView(page,'admin');
    assert.equal(await page.locator('.ad-board [data-admin-open]').count(),9,'Admin shows every page as a tile');
    await page.locator('[data-admin-open="pins"]').click();await settle(page);
    assert.equal(await page.locator('.admin-heading h1').textContent(),'PINs');
    assert.equal(await page.locator('[data-pin-change]').count(),2,'Admin changes both PINs');
    await page.locator('[data-pin-change="yunis"]').click();
    assert.equal(await page.locator('#pinNew').getAttribute('type'),'password','PINs are hidden while typed');
    await page.locator('#pinCurrent').fill('471906');await page.locator('#pinNew').fill('591837');await page.locator('#pinNewAgain').fill('591838');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>/match/.test(document.querySelector('#modalFormStatus')?.textContent||''));
    assert.equal(calls.filter(c=>c.endpoint==='admin/pin').length,0,'a mistyped new PIN never leaves the device');
    await page.locator('#pinNewAgain').fill('591837');await page.locator('#pinCurrent').fill('000000');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>/right/.test(document.querySelector('#modalFormStatus')?.textContent||''));
    await page.locator('#pinCurrent').fill('471906');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('.modal-form'));
    assert.deepEqual(calls.filter(c=>c.endpoint==='admin/pin').at(-1).body,{account:'yunis',currentPin:'471906',newPin:'591837'},'the change goes out once it is right');
    await page.locator('.admin-heading .page-back').click();await settle(page);
    assert.equal(await page.locator('.ad-board').count(),1,'Back returns to the Admin tiles');
    await page.locator('[data-admin-open="rico"]').click();await settle(page);
    await page.waitForFunction(()=>document.querySelector('#ricoKeyState')?.textContent!=='Checking…',null,{timeout:5000});
    assert.equal(await page.locator('#ricoKeyState').textContent(),'Connected');
    // Rico's AI: each AI with its state, replies, tokens and bill; keys are typed masked and checked first.
    await page.waitForSelector('.ad-ai-list .ad-ai');
    assert.equal(await page.locator('.ad-ai').count(),3,'Haiku, Gemini and Groq');
    assert.match(await page.locator('.ad-ai').first().innerText(),/Claude Haiku[\s\S]*Out of credit[\s\S]*12 replies/);
    assert.equal(await page.locator('.ad-ai-state.bad').count(),1);
    assert.match(await page.locator('.ad-ai').nth(1).innerText(),/Free plan/);
    assert.match(await page.locator('.ad-ai').nth(2).innerText(),/Not connected/);
    await page.locator('[data-ai-key="anthropic"]').click();
    await page.waitForSelector('#modalPromptInput');
    assert.equal(await page.locator('#modalPromptInput').getAttribute('type'),'password','the Haiku key is masked');
    await page.locator('#modalPromptInput').fill('not-a-key');await page.locator('#modalPromptOkBtn').click();
    await page.waitForFunction(()=>/did not accept this key/i.test(document.querySelector('.modal-msg')?.textContent||''));
    assert.deepEqual(calls.filter(c=>c.endpoint==='admin/ai/key').at(-1).body,{kind:'anthropic',key:'not-a-key'});
    await page.locator('#modalAlertOkBtn').click();await page.waitForSelector('#modalAlertOkBtn',{state:'detached'});
    await page.evaluate(()=>{location.hash='#rico-provider-setup'; maybeOpenRicoProviderSetup();});
    await page.waitForSelector('#modalPromptInput');
    assert.equal(await page.locator('#modalPromptInput').getAttribute('type'),'password','provider key is masked in the one-time setup');
    await page.locator('#modalPromptInput').fill('gsk_'+ 'A'.repeat(30));
    await page.locator('#modalPromptOkBtn').click();
    await page.waitForSelector('#modalPromptInput',{state:'detached'});
    // Time in the app: Daily, Weekly and Monthly, each with the time and the average per day, and its chart.
    await page.locator('.admin-heading .page-back').click();await settle(page);
    await page.locator('[data-admin-open="time"]').click();await settle(page);
    await page.waitForSelector('[data-time-period]');
    const timeCard=async()=>page.locator('.ad-time').first().locator('.ad-stats b').allTextContents();
    assert.deepEqual(await timeCard(),['30 min','30 min'],'today, and a day on average over the last 30 days (54000 s / 30)');
    assert.equal(await page.locator('.ad-bars .ad-bar').count(),14,'the last 14 days');
    await page.locator('[data-time-period="week"]').click();
    assert.deepEqual(await timeCard(),['3 h 30 min','30 min'],'the last 7 days, and a day on average (12600 s / 7)');
    assert.equal(await page.locator('.ad-bars .ad-bar').count(),8,'8 weeks');
    await page.locator('[data-time-period="month"]').click();
    assert.deepEqual(await timeCard(),['7 h','42 min'],'this month, and a day on average over the 10 days so far (25200 s / 10)');
    assert.equal(await page.locator('.ad-bars .ad-bar').count(),3,'one bar a month since the first counted one');
    assert.equal(await page.locator('.ad-time').nth(1).locator('.ad-stats b').nth(1).textContent(),'20 min','Yunis’s average counts only the days since he started (3600 s / 3)');
    await page.locator('[data-time-period="day"]').click();
    // Live changes: a change made elsewhere is loaded at once, without waiting for a timer.
    const loads=()=>calls.filter(c=>c.endpoint==='bootstrap').length, deviceLoads=()=>calls.filter(c=>c.endpoint==='devices').length;
    await page.waitForFunction(()=>liveHealthy(),null,{timeout:5000});
    const beforeLoads=loads(),beforeDevices=deviceLoads();
    bump('data');
    for(let i=0;i<40 && loads()===beforeLoads;i++)await page.waitForTimeout(50);
    assert.ok(loads()>beforeLoads,'an order or item saved on the other phone is loaded within moments');
    bump('devices');
    for(let i=0;i<40 && deviceLoads()===beforeDevices;i++)await page.waitForTimeout(50);
    assert.ok(deviceLoads()>beforeDevices,'a sign-in, sign-out or Refresh is picked up within moments');
    const asks=()=>calls.filter(c=>c.endpoint==='signals').length, asked=asks();
    await page.waitForTimeout(3000);
    assert.ok(asks()-asked<=3,'with nothing new the app waits instead of asking in a tight loop ('+(asks()-asked)+' in 3 s)');
    // Devices: "Notify about update" is gone.
    await page.locator('.admin-heading .page-back').click();await settle(page);
    await page.locator('[data-admin-open="devices"]').click();await settle(page);
    assert.equal(await page.locator('#devNotifyBtn').count(),0,'no Notify about update');
    assert.equal(await page.evaluate(()=>typeof openUpdatePopup+typeof showUpdatePopup),'undefinedundefined','the update popup is gone');
    // Rico: moods, inbox, the robot.
    await openView(page,'assistant');
    assert.equal(await page.locator('.rico-note').count(),1,'Rico\u2019s own message is at the top');
    assert.match(await page.locator('.rico-hello').textContent(),/Rozha/,'Rico greets the account by name');
    assert.equal(await page.locator('#ricoNameForm').count(),0,'Rico never asks for a name');
    assert.ok(calls.some(c=>c.endpoint==='assistant/inbox/read'),'opening Rico reads his messages');
    // Clicking into Rico's message box must not resize the page (the body once picked up the typing-bubble style).
    const widthBefore=await page.evaluate(()=>document.body.getBoundingClientRect().width);
    await page.locator('#ricoInput').click();
    assert.equal(await page.evaluate(()=>document.body.getBoundingClientRect().width),widthBefore,'typing to Rico keeps the page full width');
    await page.locator('#ricoInput').blur();
    // Voice message: starting and stopping a recording runs cleanly (with a stand-in microphone).
    assert.equal(await page.evaluate(async()=>{
      const stream={getTracks:()=>[{stop(){}}]};
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>stream},configurable:true});
      window.MediaRecorder=class{ constructor(){ this.mimeType='audio/webm'; } static isTypeSupported(){ return true; } start(){} stop(){ this.onstop?.(); } };
      window.ricoFinishVoice=()=>{};
      await ricoToggleVoice(); const on=ricoRecorder.active; ricoResetVoice(); return on;
    }),true,'a voice message starts recording without errors');
    await settle(page);
    assert.deepEqual(await page.evaluate(()=>{ render(); return [...document.querySelectorAll('.content, .content *')].flatMap(el=>el.getAnimations().filter(x=>x.playState==='running' && x.effect.getComputedTiming().iterations!==Infinity).map(x=>String(el.className.baseVal??el.className)+':'+(x.animationName||'js'))); }),[],'redrawing the same screen never replays an entrance animation');
    // Apple's rule 5.1.2: before anything goes to an AI service, Rico says where it goes and asks.
    await page.evaluate(()=>localStorage.removeItem('ricottaOrders:aiConsent2:rozha'));
    const chatsBefore=calls.filter(c=>c.endpoint==='assistant/chat').length;
    await page.locator('[data-rico-action="late_orders"]').click();
    await page.locator('.modal-alert-title').waitFor();
    assert.match(await page.locator('.modal-alert').textContent(),/Google Gemini or Groq/,'the permission names the AI services');
    await page.locator('#modalCancelBtn').click();
    await page.waitForFunction(()=>!document.querySelector('#modalRoot .modal-overlay'));
    assert.equal(calls.filter(c=>c.endpoint==='assistant/chat').length,chatsBefore,'Not Now sends nothing to the AI');
    await page.locator('[data-rico-action="late_orders"]').click();
    await page.locator('#modalOkBtn').click();
    for(let i=0;i<200 && calls.filter(c=>c.endpoint==='assistant/chat').length<=chatsBefore;i++) await page.waitForTimeout(25);
    assert.ok(calls.filter(c=>c.endpoint==='assistant/chat').length>chatsBefore,'Allow sends the question to Rico');
    await page.waitForFunction(()=>!rico.streaming);
    assert.equal(await page.evaluate(()=>aiConsented()),true,'Allow is remembered');
    assert.equal(await page.locator('.rico-msg.bot .rico-bot').last().evaluate(el=>el.classList.contains('mood-angry')),true,'Rico\u2019s face shows his mood');
    assert.equal(await page.locator('.rico-head .rico-bot').evaluate(el=>el.classList.contains('mood-angry')),true,'the header face follows');
    assert.equal(await page.evaluate(()=>ricoFormat('[[data:Mam Fakhir]] has <<DATA>>9<</DATA>> items')),'<p>Mam Fakhir has 9 items</p>','data markers the AI copies are never shown');
    assert.equal(await page.evaluate(()=>ricoFormat('[happy] Hi [[calm]] there [[mood:sad]], [1] box')),'<p>Hi there , [1] box</p>','a mood written in any shape is never shown as text');
    await page.locator('[data-rico-action]').count();
    await page.evaluate(()=>{ rico.messages=[]; render(); });
    await page.locator('[data-rico-action="prepare_order"]').click();
    assert.equal(await page.locator('[data-rico-scope-check]').count(),suppliers.length,'order shortcut asks which suppliers');
    await page.locator('[data-rico-scope-check][value="s1"]').check();
    await page.locator('[data-rico-scope-selected]').click();
    await page.waitForFunction(()=>!rico.streaming);
    assert.ok((await page.locator('.rico-msg.bot').last().textContent()).includes('Fixture Rico reply'),'selected suppliers reach Rico');
    await openView(page,'order');await openView(page,'assistant');
    assert.ok((await page.locator('.rico-msg.bot').count())>=2,'chat stays when switching app tabs');
    await page.reload();await page.waitForSelector('#splash',{state:'detached'});
    await openView(page,'assistant');
    assert.equal(await page.locator('.rico-msg.bot').count(),0,'chat resets when the app reloads');
    await openView(page,'itemsAdmin');await snapshot(page,'desktop-catalog.png');
    await page.locator('#itemAddBtn').click();
    await snapshot(page,'desktop-dialog.png');await page.locator('#modalFormCancel').click();
    await openView(page,'units');
    await page.locator('#unitAddBtn').click();
    assert.equal(await page.locator('#mfUnitName').count(),1,'a unit has one name field');
    assert.equal(await page.locator('#mfUnitKu,#mfUnitAr').count(),0,'no Kurdish and Arabic copies');
    await page.locator('#modalFormCancel').click();
    // Fixed main destinations: Order, History and Manage (Transfers is on for this device); More has the rest.
    await page.setViewportSize({width:390,height:844});await openView(page,'order');
    assert.deepEqual(await page.locator('.bottomnav > .navbtn[data-view]').evaluateAll(els=>els.map(el=>el.dataset.view)),['order','history','transfers','manage']);
    assert.equal(await page.locator('#navMoreBtn').count(),1);
    assert.deepEqual(await page.locator('#navMore [data-view]').evaluateAll(els=>els.map(el=>el.dataset.view)),['record','admin'],'More has Record and Admin');
    assert.equal(await page.locator('#ricoTopBtn').count(),1,'Rico is always in the top bar');
    assert.equal(await page.locator('#navEditTabs').count(),0);
    await page.evaluate(()=>{state.cart={};persistCartDraft();refreshOrderView();});
    await page.locator('[data-inc]').first().click();
    assert.equal(await page.locator('#ricoTopBtn.reacting').count(),1,'Rico reacts to the first item');
    assert.equal(await page.locator('#ricoTopBtn .rico-bot').count(),0,'the top bar shows his spark, not his face');
    await page.evaluate(()=>{state.cart={};persistCartDraft();refreshOrderView();});
    const q5=page.locator('[data-qty="i5"]');
    await q5.focus();
    assert.equal(await q5.inputValue(),'','tapping the quantity clears its 0');
    await page.keyboard.type('7');await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>state.cart.i5),7,'typed quantity is kept');
    const inc2=page.locator('[data-inc="i2"]');await inc2.scrollIntoViewIfNeeded();
    const box=await inc2.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(1300);await page.mouse.up();
    assert.ok(await page.evaluate(()=>state.cart.i2)>=4,'holding + keeps counting');
    const row=page.locator('[data-item-id="i8"] .item-info');await row.scrollIntoViewIfNeeded();
    const rb=await row.boundingBox();
    await page.mouse.move(rb.x+10,rb.y+rb.height/2);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
    await page.locator('#ctxLayer [data-ctx="5"]').click();
    assert.equal(await page.evaluate(()=>state.cart.i8),5,'press-and-hold menu adds 5');
    await page.locator('#clearOrderBtn').click();
    assert.equal(await page.evaluate(()=>state.cart.i8||0),0,'Clear order empties the order');
    await page.locator('.toast-undo').click();
    assert.equal(await page.evaluate(()=>state.cart.i8),5,'clearing the order can be undone');
    await page.evaluate(()=>window.scrollTo(0,0));
    // A finger swipe to the left moves from Order to History, with the page sliding (silently).
    await page.evaluate(()=>{ window.__tones=[]; });
    await page.evaluate(()=>{
      const el=document.querySelector('.content .page-heading'), r=el.getBoundingClientRect(), y=r.top+r.height/2;
      const fire=(type,x)=>document.dispatchEvent(Object.assign(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'touch',clientX:x,clientY:y})));
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,pointerType:'touch',clientX:300,clientY:y}));
      for(const x of [280,240,180,120]) fire('pointermove',x);
      fire('pointerup',120);
    });
    assert.equal(await page.evaluate(()=>state.view),'history','swiping the page moves to the next tab');
    assert.equal(await page.locator('.content.gliding').count(),1,'the swipe moves to the next page');
    assert.deepEqual(await page.evaluate(()=>__tones),[],'swiping between tabs makes no sound');
    assert.ok(await page.evaluate(()=>{ const ms=document.querySelector('.content.gliding').getAnimations()[0].effect.getTiming().duration; return ms>=SWIPE_MS && ms<=420; }),'a swipe carries on at the finger\u2019s speed, never slower than 420 ms');
    assert.equal(await page.locator('.page-peek').count(),0,'the preview of the next page is replaced by the page itself');
    assert.ok(await page.evaluate(()=>{
      const out=document.querySelector('.page-ghost > .content').getAnimations()[0].effect.getKeyframes();
      return out.every(f=>f.opacity===undefined) && out.at(-1).transform.includes('-');
    }),'after a swipe the old page slides fully off to the other side instead of fading');
    await settle(page);
    await page.evaluate(()=>setLang('ku'));await openView(page,'order');
    assert.ok(parseFloat(await page.locator('#itemSearch').evaluate(el=>getComputedStyle(el).fontSize))>=16,'mobile search avoids focus zoom');
    await snapshot(page,'phone-order-ku.png');
    await page.evaluate(()=>setLang('ar'));await snapshot(page,'phone-order-ar.png');
    await openView(page,'assistant');await snapshot(page,'phone-rico-ar.png');
    await ctx.close();

    /* ---------- A phone with a touch screen ---------- */
    const phone=await context({touch:true});
    await openView(phone.page,'itemsAdmin');
    assert.equal(await phone.page.locator('.data-table').isVisible(),false,'phones get the list, not the wide table');
    await phone.page.locator('.table-list [data-edititem]').first().click();
    await phone.page.locator('[data-detail="edit"]').click();
    await phone.page.locator('.modal-form').waitFor();
    assert.equal(await phone.page.evaluate(()=>!!document.activeElement?.matches('input,select,textarea')),false,'editing on a phone does not open the keyboard by itself');
    await phone.page.waitForFunction(()=>document.querySelector('.modal-form').getAnimations().every(a=>a.playState==='finished'));
    const formBox=await phone.page.locator('.modal-form').boundingBox();
    assert.ok(Math.abs(formBox.y+formBox.height/2-844/2)<40,'the popup sits in the middle of the screen, not at the bottom');
    await phone.page.locator('.modal-form input').first().focus();
    assert.equal(await phone.page.evaluate(()=>document.body.classList.contains('typing')),true,'typing is noticed');
    await phone.page.locator('#modalFormCancel').click();
    await phone.page.waitForFunction(()=>!document.querySelector('.modal-form'));
    await openView(phone.page,'order');
    await phone.page.locator('#itemSearch').focus();
    assert.equal(await phone.page.locator('.bottomnav').isVisible(),false,'the tab bar steps aside while typing');
    assert.equal(await phone.page.locator('.to-top').isVisible(),false,'and so does the back-to-top button');
    await phone.page.locator('#itemSearch').blur();
    await phone.page.locator('.bottomnav').waitFor({state:'visible'});
    await phone.ctx.close();

    /* ---------- The Home Screen app ---------- */
    const home=await context({touch:true,homeScreen:true});
    const hp=home.page;
    assert.equal(await hp.evaluate(()=>document.documentElement.classList.contains('app-shell')),true,'opened from the Home Screen it runs as an app');
    await openView(hp,'order');
    const frame=await hp.evaluate(()=>{
      const c=document.querySelector('.content'), nav=document.querySelector('.bottomnav').getBoundingClientRect(), bar=document.querySelector('.topbar').getBoundingClientRect();
      return {page:document.scrollingElement.scrollHeight<=innerHeight+1, scrolls:c.scrollHeight>c.clientHeight, navBottom:Math.round(nav.bottom), barTop:Math.round(bar.top)};
    });
    assert.equal(frame.page,true,'the page itself never scrolls');
    assert.equal(frame.scrolls,true,'only the screen content scrolls');
    assert.ok(frame.barTop===0 && frame.navBottom<=844 && frame.navBottom>780,'top bar and tab bar are fixed parts of the frame');
    await hp.evaluate(()=>{ const c=document.querySelector('.content'); c.scrollTop=400; c.dispatchEvent(new Event('scroll')); });
    assert.equal(await hp.evaluate(()=>document.querySelector('.topbar').classList.contains('scrolled')),true,'the top bar reacts to the content scrolling');
    await hp.evaluate(()=>goView('history'));
    assert.equal(await hp.evaluate(()=>document.querySelector('.page-ghost > .content')?.scrollTop),400,'the leaving page slides away from where it was');
    await settle(hp);
    assert.equal(await hp.evaluate(()=>document.querySelector('.content').scrollTop),0,'a new screen starts at its top');
    // The keyboard takes 330px: the whole frame fits above it.
    await hp.evaluate(()=>{ const r=document.documentElement.style; r.setProperty('--vv-height','514px'); });
    const shrunk=await hp.evaluate(()=>({app:Math.round(document.getElementById('app').getBoundingClientRect().bottom), nav:Math.round(document.querySelector('.bottom-stack').getBoundingClientRect().bottom)}));
    assert.ok(shrunk.app===514 && shrunk.nav<=514,'with the keyboard up the app fits exactly above it');
    await snapshot(hp,'phone-home-screen-app.png');
    await home.ctx.close();

    /* ---------- Yunis ---------- */
    const y=await context({account:'yunis'});
    assert.deepEqual(await y.page.evaluate(()=>state.views),[...YUNIS_VIEWS,'settings'],'Yunis gets the right screens');
    await y.page.setViewportSize({width:390,height:844});
    assert.equal(await y.page.locator('.bottomnav [data-view="admin"]').count(),0,'no Admin for Yunis');
    // Four screens or fewer: all are tabs, no More.
    const yunisTabs=()=>y.page.locator('.bottomnav > .navbtn[data-view]').evaluateAll(els=>els.map(el=>el.dataset.view));
    assert.deepEqual(await yunisTabs(),['order','history','manage','record'],'Yunis has four tabs');
    assert.equal(await y.page.locator('#navMoreBtn').count(),0,'with four screens there is no More');
    assert.equal(await y.page.evaluate(()=>canOpen('transfers')),false,'Transfers is Rozha\u2019s unless she gives it to him');
    // Rozha gives him Transfers: the next refresh brings the tab (and More, for the fifth screen).
    Object.assign(y.over,{views:['order','assistant','history','transfers','manage','suppliers','itemsAdmin','units','record','settings'],roles:['history','manage','catalog','record','transfers','assistant','send','exports','notify','reminders']});
    await y.page.evaluate(async()=>{ lastLoadAt=0; await refreshData(true); });
    await y.page.waitForFunction(()=>document.querySelector('#navMoreBtn'));
    assert.deepEqual(await yunisTabs(),['order','history','transfers','manage'],'a new role shows up without signing in again');
    assert.deepEqual(await y.page.locator('#navMore [data-view]').evaluateAll(els=>els.map(el=>el.dataset.view)),['record']);
    // And takes Send away: the Order screen says who sends instead of offering the button.
    Object.assign(y.over,{views:YUNIS_VIEWS.concat('settings'),roles:['history','manage','catalog','record','assistant','exports','notify','reminders']});
    await y.page.evaluate(async()=>{ lastLoadAt=0; await refreshData(true); });
    await y.page.waitForFunction(()=>!document.querySelector('#navMoreBtn'));
    assert.equal(await y.page.evaluate(()=>canDo('send')),false);
    for(const key of Object.keys(y.over)) delete y.over[key];
    await y.page.evaluate(async()=>{ lastLoadAt=0; await refreshData(true); });
    await openView(y.page,'history');
    assert.equal(await y.page.locator('[data-delhist], [data-undohist]').count(),0,'only Rozha can delete or undo orders');
    await openView(y.page,'suppliers');
    assert.equal(await y.page.locator('#supAddBtn').count(),1,'Yunis can edit suppliers');
    await openView(y.page,'units');
    assert.equal(await y.page.locator('[data-delunit]').count(),1,'Yunis can delete units');
    // Settings stays available under Manage for Yunis too.
    await y.page.evaluate(()=>goView('settings')); await settle(y.page);
    assert.equal(await y.page.evaluate(()=>state.view),'settings','Yunis can open Settings');
    await snapshot(y.page,'phone-settings.png');
    assert.equal(await y.page.locator('.theme-btn,#faceIdToggle,#pref-surprises,#pref-weatherFx').count(),0,'retired features have no controls');
    await y.page.locator('[data-dark="on"]').click();
    assert.equal(await y.page.evaluate(()=>document.documentElement.classList.contains('dark')),true);
    await y.page.locator('[data-dark="off"]').click();
    assert.equal(await y.page.evaluate(()=>document.documentElement.classList.contains('dark')),false);
    await y.page.locator('label:has(#pref-compactRows)').click();
    assert.equal(await y.page.evaluate(()=>document.documentElement.classList.contains('compact-rows')),true,'Compact rows switch works');
    await y.page.locator('label:has(#pref-compactRows)').click();
    assert.equal(await y.page.evaluate(()=>document.documentElement.classList.contains('compact-rows')),false,'Compact rows switch turns off');
    await y.page.locator('label:has(#pref-showLastQty)').click();
    await y.page.evaluate(()=>goView('order')); await settle(y.page);
    assert.ok(await y.page.locator('.item-last').count()>=1,'Last quantity shows on rows when switched on');
    await y.page.evaluate(()=>goView('settings')); await settle(y.page);
    await y.page.locator('label:has(#pref-showLastQty)').click();
    assert.deepEqual(await y.page.evaluate(()=>[...document.querySelectorAll('.content input[type=checkbox]')].map(i=>i.id+':'+i.checked)),['pref-compactRows:false','pref-showLastQty:false','sound-qty:true','sound-sent:true','reminderEnabled:false','aiConsent:true'],'no per-phone Transfers switch: Admin decides');
    assert.equal(await y.page.locator('#settingsSignOut').count(),1,'Sign Out is at the end of Settings');
    assert.match(await y.page.locator('.settings-link').getAttribute('href'),/^privacy\.html#en$/,'Settings links to the privacy policy');
    // Daily reminder, for Yunis too: the switch opens the time, Save and a test; only Save turns it on.
    assert.equal(await y.page.locator('#reminderTime').count(),0,'the daily reminder starts as just a switch');
    await y.page.locator('label:has(#reminderEnabled)').click();
    assert.equal(await y.page.locator('#reminderTime, #reminderSaveBtn, #reminderTestBtn').count(),3,'turning it on shows the time, Save and a test button');
    await y.page.evaluate(()=>goView('order')); await settle(y.page); await y.page.evaluate(()=>goView('settings')); await settle(y.page);
    assert.deepEqual(await y.page.evaluate(()=>[document.getElementById('reminderEnabled').checked, !!document.getElementById('reminderTime')]),[false,false],'leaving without saving keeps it off');
    assert.equal(y.calls.filter(c=>c.endpoint==='reminder').length,0,'nothing was saved');
    await y.page.locator('label:has(#reminderEnabled)').click();
    await y.page.locator('#reminderTime').fill('21:30');
    await y.page.locator('#reminderTestBtn').click();
    await y.page.waitForFunction(()=>!!document.querySelector('#modalAlertOkBtn'),null,{timeout:5000}).catch(()=>{});
    assert.ok(y.calls.some(c=>c.endpoint==='push/send' && c.body.type==='reminder-now'),'Yunis can send a test reminder');
    await y.page.locator('#modalAlertOkBtn').click(); await y.page.waitForFunction(()=>!document.querySelector('#modalRoot .modal-overlay'));
    await y.page.locator('#reminderSaveBtn').click();
    await y.page.waitForFunction(()=>!document.getElementById('reminderTime'));
    assert.deepEqual(y.calls.filter(c=>c.endpoint==='reminder').map(c=>c.body),[{enabled:true,time:'21:30'}],'Save turns it on at the chosen time');
    assert.match(await y.page.locator('label:has(#reminderEnabled) small').textContent(),/9:30/,'once saved it shows when it rings, and the time and buttons tuck away');
    assert.equal(await y.page.locator('#reminderChangeBtn').count(),1,'the time can still be changed');
    await y.page.locator('label:has(#reminderEnabled)').click();
    await y.page.waitForFunction(()=>!document.getElementById('reminderEnabled').checked);
    assert.deepEqual(y.calls.filter(c=>c.endpoint==='reminder').at(-1).body,{enabled:false,time:'21:30'},'turning it off saves straight away');
    await snapshot(y.page,'phone-yunis.png');
    await y.ctx.close();

    /* ---------- Sign in ---------- */
    // A phone: Ricotta's street in green at the top, then six boxes and number keys low on the screen.
    const touchLogin=await context({loggedIn:false,touch:true});
    const tp=touchLogin.page;
    assert.equal(await tp.locator('.keypad').isVisible(),true,'phones get the number pad');
    assert.equal(await tp.locator('.login-hint').isVisible(),false,'phones are not told to type');
    assert.equal(await tp.locator('#pinInput').isVisible(),false,'phones never open the keyboard');
    await tp.waitForFunction(()=>{ const img=document.querySelector('.login-map img'); return img && img.complete && img.naturalWidth===1792; });
    assert.equal(await tp.locator('.login-map .rmap-pin b').isVisible(),true,'the map shows Ricotta');
    assert.equal(await tp.locator('.login-map .map-directions').getAttribute('href'),'https://maps.apple/p/RvAJw2GV9jAvf_','Directions opens Ricotta in Apple Maps');
    assert.match(await tp.locator('.login-map .map-credit').textContent(),/Esri/,'the picture is credited');
    assert.equal(await tp.evaluate(()=>document.querySelector('meta[name="theme-color"]').content),'#14382C','the status bar is green above the map');
    await tp.evaluate(()=>window.originalKey=document.querySelector('[data-key="1"]'));
    await tp.locator('[data-key="1"]').click();
    assert.equal(await tp.evaluate(()=>originalKey===document.querySelector('[data-key="1"]')),true,'PIN keypad remains mounted');
    assert.equal(await tp.locator('.pin-box.filled').count(),1,'a tapped key fills the first box');
    assert.equal(await tp.locator('.pin-box').nth(1).evaluate(el=>el.classList.contains('on')),true,'the next box waits with a ring');
    await tp.locator('[data-key="back"]').click();
    assert.equal(await tp.locator('.pin-box.filled').count(),0,'Delete takes the digit back');
    await tp.locator('[data-key="2"]').click();await tp.locator('[data-key="3"]').click();await tp.locator('[data-key="clear"]').click();
    assert.equal(await tp.locator('.pin-box.filled').count(),0,'Clear empties the PIN');
    const reach=await tp.evaluate(()=>{ const keys=document.querySelector('.keypad').getBoundingClientRect(), one=document.querySelector('[data-key="1"]').getBoundingClientRect(); return {top:keys.top/innerHeight, bottom:keys.bottom/innerHeight, key:Math.min(one.width,one.height)}; });
    assert.ok(reach.top>0.45 && reach.bottom<0.97,'the number pad sits in the lower half, within the thumb\u2019s reach '+JSON.stringify(reach));
    assert.ok(reach.key>=56,'keys are large enough to hit without looking '+JSON.stringify(reach));
    assert.equal(await tp.evaluate(()=>{ state.pinBuffer='123456'; state.pinBusy=true; updateLoginFeedback(); const sub=document.getElementById('pinLabel'), info=!sub.classList.contains('err') && sub.textContent===t('signingIn'); state.pinBusy=false; state.pinBuffer=''; updateLoginFeedback(); return info; }),true,'"Signing in" is shown as information, not in red');
    assert.equal(await tp.evaluate(()=>{ state.pinError='wrong'; updateLoginFeedback(); const bad=document.getElementById('pinLabel').classList.contains('err') && document.querySelector('.pin-boxes').classList.contains('err'); state.pinError=''; updateLoginFeedback(); return bad; }),true,'a wrong PIN shows in red');
    for(const scheme of ['light','dark']){
      await tp.emulateMedia({colorScheme:scheme});
      await tp.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,scheme==='dark');
      const bg=await tp.evaluate(()=>getComputedStyle(document.querySelector('.login-panel')).backgroundColor);
      assert.equal(bg,scheme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)','the sign-in is pure '+(scheme==='dark'?'black':'white')+' in the '+scheme+' theme');
    }
    await snapshot(tp,'phone-login.png');
    await touchLogin.ctx.close();
    // A computer: the map on one half, only the boxes on the other. The PIN is typed and Esc clears it.
    const login=await context({loggedIn:false});
    assert.equal(await login.page.locator('.login-hint').isVisible(),true,'computers are told they can type the PIN');
    assert.equal(await login.page.locator('.keypad').isVisible(),false,'computers have no number pad');
    assert.equal(await login.page.evaluate(()=>document.activeElement?.id),'pinInput','typing goes straight into the PIN');
    await login.page.keyboard.press('1');
    assert.equal(await login.page.locator('.pin-box.filled').count(),1,'a typed digit fills the first box');
    assert.equal(await login.page.locator('#pinInput').inputValue(),'','the hidden field keeps no digits');
    await login.page.keyboard.press('Escape');
    assert.equal(await login.page.locator('.pin-box.filled').count(),0,'Escape clears the PIN');
    // The map moves a little around Ricotta, no further than its limit, and the arrow brings it back.
    const mapBox=await login.page.locator('#loginMap').boundingBox();
    await login.page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);await login.page.mouse.down();
    await login.page.mouse.move(mapBox.x+mapBox.width/2+400,mapBox.y+mapBox.height/2,{steps:8});await login.page.mouse.up();
    const mapAt=()=>login.page.locator('#loginMap .rmap-world').evaluate(el=>(el.style.translate+' 0').split(' ').slice(0,2).map(parseFloat));
    assert.deepEqual(await mapAt(),[140,0],'the map stops at its limit');
    await login.page.locator('.map-recenter').click();
    assert.deepEqual(await mapAt(),[0,0],'the arrow brings Ricotta back');
    for(const lang of LANGS){
      await login.page.evaluate(lang=>setLang(lang),lang);
      for(const width of viewportWidths){
        const height=width>=960?900:740;
        await login.page.setViewportSize({width,height});await noOverflow(login.page,'login/'+lang+'/'+width);
        const row=await login.page.locator('#loginLangRow').boundingBox();
        assert.ok(row && row.y+row.height<=height,'the language button is on screen without scrolling ('+lang+'/'+width+')');
      }
    }
    await login.page.setViewportSize({width:1440,height:1000});await login.page.evaluate(()=>setLang('en'));await snapshot(login.page,'desktop-login.png');
    await login.page.setViewportSize({width:390,height:844});
    // There is no secret code any more: 000000 is just a wrong PIN.
    await login.page.keyboard.type('000000');
    await login.page.waitForFunction(()=>state.pinError==='wrong');
    assert.equal(await login.page.locator('#modalRoot .modal-overlay').count(),0,'no "Who are you?" step');
    await login.page.waitForFunction(()=>state.pinBuffer==='');
    // Yunis signs in: welcome back, by name.
    await login.page.keyboard.type('358214');
    await login.page.waitForSelector('#welcome');
    assert.match(await login.page.locator('#welcome .sr-only').textContent(),/Welcome back, Yunis/,'welcome back says the name');
    assert.equal(await login.page.locator('.welcome-name').textContent(),'Yunis','the name is large on the map');
    await login.page.waitForSelector('#orderResults');
    assert.equal(await login.page.evaluate(()=>state.account),'yunis');
    // Sign Out signs out straight away, with no "Are you sure?".
    await login.page.locator('#accountBtn').click();await login.page.locator('.account-sheet #logoutBtn').click();
    await login.page.waitForSelector('.pin-boxes');
    assert.equal(await login.page.locator('#modalRoot .modal-overlay').count(),0,'no confirmation popup');
    assert.equal(await login.page.locator('.pin-box.filled').count(),0,'logout resets the PIN feedback');
    await login.ctx.close();
    const reduced=await context({reducedMotion:'reduce'});await reduced.page.locator('[data-inc="i1"]').click();
    assert.equal(await reduced.page.locator('[data-qty="i1"]').evaluate(el=>el.getAnimations().length),0,'reduced motion skips JS feedback');
    await reduced.page.evaluate(()=>goView('history'));
    assert.equal(await reduced.page.locator('.content.gliding').count(),0,'reduced motion skips the page transition');

    /* Dialogs preserve drafts, contain keyboard focus, and cannot be dismissed
       or submitted twice while a save is pending. APIs remain fully mocked. */
    const mp=reduced.page;
    await mp.locator('#accountBtn').focus();
    await mp.evaluate(()=>{window.modalPromptResult='pending';showPrompt('Regression prompt').then(value=>{modalPromptResult=value;});});
    assert.equal(await mp.locator('#modalPromptInput').getAttribute('aria-labelledby')!==null,true,'prompt has an accessible label');
    assert.equal(await mp.locator('#app').evaluate(el=>el.inert),true,'background is inert while a dialog is open');
    await mp.locator('#modalPromptOkBtn').focus();
    await mp.keyboard.press('Tab');
    assert.equal(await mp.evaluate(()=>document.activeElement.id),'modalPromptInput','Tab wraps within the dialog');
    await mp.keyboard.press('Shift+Tab');
    assert.equal(await mp.evaluate(()=>document.activeElement.id),'modalPromptOkBtn','Shift+Tab wraps within the dialog');
    await mp.keyboard.press('Escape');
    await mp.waitForFunction(()=>modalPromptResult===null);
    assert.equal(await mp.evaluate(()=>document.activeElement.id),'accountBtn','closing returns focus to the opener');
    assert.equal(await mp.locator('#app').evaluate(el=>el.inert),false,'closing releases the background');
    assert.equal(await mp.locator('.modal-overlay').count(),0,'reduced-motion dialogs close immediately');

    await mp.evaluate(()=>{
      window.modalSubmits=0;window.modalClosed=false;
      showFormModal({title:'Regression form',bodyHtml:'<div class="field"><label>Draft</label><input id="regressionDraft" data-clear="1" value="Keep this draft"></div>',
        againLabel:'Save another',onSubmit:()=>{modalSubmits++;return new Promise(resolve=>{window.finishModalSave=resolve;});}
      }).then(()=>{modalClosed=true;});
    });
    assert.equal(await mp.locator('label[for="regressionDraft"]').count(),1,'form labels point to their fields');
    await mp.locator('#modalFormOk').click();
    assert.equal(await mp.locator('#modalFormOk').getAttribute('aria-busy'),'true','saving is announced on the action');
    assert.equal(await mp.locator('#modalFormOk').evaluate(el=>getComputedStyle(el,'::before').animationName),'none','reduced motion shows a static loading indicator');
    assert.equal(await mp.locator('#regressionDraft').isDisabled(),true,'saving locks the submitted values');
    await mp.keyboard.press('Escape');
    await mp.evaluate(()=>document.querySelector('#modalFormOk').click());
    assert.equal(await mp.evaluate(()=>modalClosed),false,'Escape preserves a pending save');
    assert.equal(await mp.evaluate(()=>modalSubmits),1,'a pending save cannot be submitted twice');
    await mp.evaluate(()=>{window.nestedAlertClosed=false;showAlert('Delivery result').then(()=>{nestedAlertClosed=true;});});
    assert.equal(await mp.locator('.modal-form').count(),1,'a nested alert keeps the draft form');
    assert.equal(await mp.locator('.modal-form').evaluate(el=>el.closest('.modal-overlay').inert),true,'only the top dialog is interactive');
    await mp.locator('#modalAlertOkBtn').click();
    await mp.waitForFunction(()=>nestedAlertClosed);
    assert.equal(await mp.locator('#regressionDraft').inputValue(),'Keep this draft','a nested alert preserves the entered values');
    await mp.evaluate(()=>finishModalSave({error:'Try again'}));
    await mp.waitForFunction(()=>document.querySelector('#modalFormStatus')?.textContent==='Try again');
    assert.equal(await mp.locator('#regressionDraft').isDisabled(),false,'an unsuccessful save unlocks the fields');
    assert.equal(await mp.locator('#modalFormStatus').getAttribute('aria-live'),'assertive','save errors are announced');
    await mp.locator('#modalFormAgain').click();
    await mp.evaluate(()=>finishModalSave({keepOpen:true,message:'Saved'}));
    await mp.waitForFunction(()=>document.querySelector('#modalFormStatus')?.textContent==='Saved');
    assert.equal(await mp.locator('#regressionDraft').inputValue(),'','Save and add another clears only opted-in fields');
    await mp.locator('#modalFormCancel').click();
    await mp.waitForFunction(()=>modalClosed);

    await mp.evaluate(()=>{
      window.interruptedPrompt='pending';window.interruptedConfirm='pending';
      showPrompt('Interrupted prompt').then(value=>{interruptedPrompt=value;});
      showConfirm('Interrupted question').then(value=>{interruptedConfirm=value;});
      dismissAllModals();
    });
    await mp.waitForFunction(()=>interruptedPrompt===null&&interruptedConfirm===false);
    assert.equal(await mp.locator('.modal-overlay').count(),0,'sign-out cleanup removes every dialog');
    assert.equal(await mp.locator('#app').evaluate(el=>el.inert),false,'sign-out cleanup releases the background');
    await reduced.ctx.close();
    assert.deepEqual(errors,[],'no browser errors');
    console.log(JSON.stringify({result:'PASS',checks:`every text in 3 languages, ${3*viewportWidths.length*ALL_VIEWS.length} workspace layouts, ${3*viewportWidths.length} sign-in layouts, sidebar highlight and slide on every screen, language menu with Apply, Arabic font and 1 2 3 digits, Rozha vs Yunis screens and history delete, Yunis's roles from the server (tabs, More only past four screens), Admin tiles and PIN change, sign-in with Ricotta's map (keys on phones, typing on computers, map limits, theme colours, no Sign Out popup), welcome by name, fixed Manage navigation, Rico moods and inbox, page swipe, tap-to-type and hold-to-repeat quantities, press-and-hold menu, dark mode, undo, security policy, desktop install, phone typing and centred popups, Home Screen app frame, reduced motion`,artifacts},null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
