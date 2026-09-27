/* Local UI regression checks. Requires Playwright (no production API calls).
   Run: node scripts/ui-smoke.cjs
   EDGE_PATH can select a locally installed Chromium/Edge executable.
   The server is mocked: two accounts (Rozha with every screen, Yunis with
   Order, Rico, History, Suppliers, Items, Record, Units) and a 181-item
   catalog. It checks English, Kurdish and Arabic at six widths, the secret
   code steps, the tab editor, page transitions, Rico's moods and inbox, and
   that every language has every text. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
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

const ALL_VIEWS=['order','assistant','history','suppliers','itemsAdmin','units','record','devices','settings'];
const YUNIS_VIEWS=['order','assistant','history','suppliers','itemsAdmin','units','record'];
const supplierNames=['Corner Cake','Golden Bread Bakery','Fresh produce','Daily essentials','Kitchen supplies','Beverages','Dairy','Meat supplier','دابینکەری سەوزە','دابینکەری بەرهەمەکان'];
const suppliers=supplierNames.map((name,i)=>({id:'s'+i,name,phone:''}));
const items=Array.from({length:181},(_,i)=>({id:'i'+i,name:i%3===0?'تەماتە '+i:'Kitchen item '+String(i).padStart(3,'0'),unit:'box',supplierId:'s'+(i%10)}));
const fixtureFor=account=>({
  account, name:account==='rozha'?'Rozha':'Yunis', tabs:['order','assistant','history'], views:account==='rozha'?ALL_VIEWS:YUNIS_VIEWS,
  suppliers, items, units:[{id:'box',en:'box',ku:'سندوق',ar:'صندوق'}],
  history:[{id:'h1',date:'2026-09-23T08:00:00Z',by:'yunis',entries:[{supplierId:'s1',items:[{itemId:'i1',name:items[1].name,qty:2,unit:'box'}]}]}],
  devices:[], activity:[{id:'a1',ts:'2026-09-24T08:00:00Z',actor:'yunis',by:'Yunis',action:'add',type:'item',name:'Tomatoes',fields:[{k:'name',to:'Tomatoes'}]}],
  reminder:{enabled:false,time:'09:00'}, pars:[],
  inbox:[{id:1,kind:'cheer',mood:'excited',en:'Good morning, Rozha! 3 suppliers are due today.',ku:'بەیانیت باش ڕۆژا!',ar:'صباح الخير يا روژا!',at:'2026-09-27T06:00:00Z',read:false}],
});
const session=account=>({token:'fixture-'+account,expiresAt:'2099-01-01T00:00:00Z',account,name:account==='rozha'?'Rozha':'Yunis',tabs:['order','assistant','history']});
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const executablePath=process.env.EDGE_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined);
  const browser=await chromium.launch({headless:true,executablePath});
  const errors=[];
  async function context({account='rozha',loggedIn=true,reducedMotion='no-preference'}={}){
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion,serviceWorkers:'block'});
    const calls=[];
    let signedIn=account;
    await ctx.route('**/functions/v1/api/**',async route=>{
      const req=route.request();
      const endpoint=new URL(req.url()).pathname.split('/api/')[1];
      const body=req.postDataJSON?.()||null;
      calls.push({endpoint,method:req.method(),body});
      if(endpoint==='assistant/chat'){
        const reply=body.quickAction==='last_order'?'Last sent order · 2026-09-23':'Fixture Rico reply';
        const events=[{type:'mood',mood:body.quickAction==='late_orders'?'angry':'excited'},{type:'text',text:reply},{type:'done'}];
        await route.fulfill({status:200,contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
        return;
      }
      let status=200, data={};
      if(endpoint==='bootstrap') data=fixtureFor(signedIn);
      else if(endpoint==='devices') data=[];
      else if(endpoint==='assistant/inbox') data=fixtureFor(signedIn).inbox;
      else if(endpoint==='assistant/status') data={configured:true,provider:'gemini',model:'gemini-3.5-flash-lite'};
      else if(endpoint==='login'){
        if(body.pin==='000000') data={recovery:true,ticket:'fixture-ticket'};
        else if(body.pin==='200666'){ signedIn='yunis'; data={...session('yunis')}; }
        else if(body.pin==='069690'){ signedIn='rozha'; data={...session('rozha')}; }
        else { status=401; data={error:'invalid_credentials'}; }
      }
      else if(endpoint==='recovery/name'){ if(body.name!=='rozha'){ status=401; data={error:'invalid_credentials'}; } else data={ok:true}; }
      else if(endpoint==='recovery/verify'){ if(body.pin!=='069690'){ status=401; data={error:'invalid_credentials'}; } else data={ok:true}; }
      else data={ok:true};
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    await ctx.addInitScript(({loggedIn,s})=>{
      localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
      if(loggedIn && !sessionStorage.getItem('seeded')){ localStorage.setItem('ricottaOrders:apiSession',JSON.stringify(s)); sessionStorage.setItem('seeded','1'); }
    },{loggedIn,s:session(account)});
    const page=await ctx.newPage();page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(url);await page.waitForSelector(loggedIn?'#orderResults':'.keypad');await page.waitForSelector('#splash',{state:'detached'});
    return {ctx,page,calls};
  }
  const settle=page=>page.waitForFunction(()=>!document.querySelector('.content.gliding'),null,{timeout:4000});
  async function openView(page,view){
    const tab=page.locator('.bottomnav [data-view="'+view+'"]');
    const inMore=await tab.evaluate(el=>!!el.closest('.nav-more')&&innerWidth<960&&!el.closest('.bottomnav').classList.contains('more-open'));
    if(inMore){ await page.locator('#navMoreBtn').click(); await page.waitForFunction(v=>{const el=document.querySelector('.nav-more [data-view="'+v+'"]');return el&&getComputedStyle(el.closest('.nav-more')).opacity==='1';},view); }
    await tab.click();
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
    /* ---------- Rozha ---------- */
    const {ctx,page,calls}=await context();
    assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'),/user-scalable=no/,'viewport disables pinch/double-tap zoom');
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).userSelect),'none','app chrome cannot be accidentally selected');
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily.includes('Sora')),true,'English uses Sora');
    await page.evaluate(()=>{window.originalRow=document.querySelector('[data-item-id="i1"]');});
    const inc=page.locator('[data-inc="i1"]');
    await inc.focus();for(let i=0;i<12;i++) await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'12');
    assert.equal(await page.evaluate(()=>originalRow===document.querySelector('[data-item-id="i1"]')),true,'quantity preserves the actual row');
    assert.equal(await inc.evaluate(el=>el===document.activeElement),true,'repeated taps retain focus');
    await page.locator('[data-qty="i1"]').fill('24');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ricottaOrders:pendingCart')).i1),24,'draft saves before blur');
    await page.reload();await page.waitForSelector('#splash',{state:'detached'});
    assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'24','draft restores after reload');
    await page.evaluate(()=>{window.originalInput=document.querySelector('#itemSearch');window.originalTop=document.querySelector('.topbar');window.originalNav=document.querySelector('.bottomnav');});
    await page.locator('#itemSearch').fill('Kitchen item');
    assert.equal(await page.evaluate(()=>originalInput===document.activeElement),true);
    await page.locator('[data-ordertab="s1"]').click();
    assert.equal(await page.evaluate(()=>originalInput===document.querySelector('#itemSearch')&&originalTop===document.querySelector('.topbar')&&originalNav===document.querySelector('.bottomnav')),true,'supplier switch preserves shell and search');
    assert.ok((await page.locator('.hero-sub').textContent()).includes('18'),'supplier count follows tab');
    await page.locator('#itemSearch').fill('no such item');assert.equal(await page.locator('#orderResults .item-row').count(),0);
    await page.locator('#itemSearch').fill('');await page.locator('#clearOrderBtn').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('ricottaOrders:pendingCart')),null);
    await page.locator('#sameAsLast').click();assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'2');

    // The language menu: nothing changes until Apply.
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
      }
    }
    // Computer sidebar: every screen gets the green highlight, and every change slides.
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>setLang('en'));
    await openView(page,'order');
    for(const view of ALL_VIEWS.slice(1)){
      await page.locator('.bottomnav [data-view="'+view+'"]').click();
      assert.equal(await page.locator('.content.gliding').count(),1,view+' fades in');
      await settle(page);
      const place=await page.evaluate(v=>{const b=document.querySelector('.bottomnav [data-view="'+v+'"]'),i=document.querySelector('.nav-indicator');return {top:b.offsetTop,h:b.offsetHeight,iy:parseFloat(i.style.getPropertyValue('--iy')),ih:parseFloat(i.style.getPropertyValue('--ih')),color:getComputedStyle(b).color};},view);
      assert.equal(place.iy,place.top,view+' highlight sits on its row');
      assert.equal(place.ih,place.h,view+' highlight has the row height');
      assert.equal(place.color,'rgb(255, 255, 255)',view+' label stays readable on the highlight');
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
    assert.equal(await page.locator('[data-delhist]').count(),1,'Rozha can delete history');
    await openView(page,'settings');
    assert.equal(await page.locator('#adminPinInput').count(),0,'PINs cannot be changed in Settings');
    await page.waitForFunction(()=>document.querySelector('#ricoKeyState')?.textContent!=='Checking…',null,{timeout:5000});
    assert.equal(await page.locator('#ricoKeyState').textContent(),'Connected');
    await page.evaluate(()=>{location.hash='#rico-provider-setup'; maybeOpenRicoProviderSetup();});
    await page.waitForSelector('#modalPromptInput');
    assert.equal(await page.locator('#modalPromptInput').getAttribute('type'),'password','provider key is masked in the one-time setup');
    await page.locator('#modalPromptInput').fill('gsk_'+ 'A'.repeat(30));
    await page.locator('#modalPromptOkBtn').click();
    await page.waitForSelector('#modalPromptInput',{state:'detached'});
    // Notify about update: three languages, only the written words.
    await openView(page,'devices');
    await page.locator('#devNotifyBtn').click();
    await page.locator('#mfUpdateMsgAr').fill('تحديث جديد');
    await page.locator('#mfUpdateMsgEn').fill('New ordering screen');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('.modal-form'));
    const sent=calls.find(c=>c.endpoint==='push/send');
    assert.deepEqual([sent.body.type,sent.body.bodyEn,sent.body.bodyKu,sent.body.bodyAr],['update','New ordering screen','','تحديث جديد'],'update message goes out as written');
    assert.equal(sent.body.title,undefined,'the app adds no title of its own');
    await page.evaluate(()=>{ const root=document.getElementById('modalRoot'); if(root) root.innerHTML=''; });
    await page.evaluate(()=>{ openUpdatePopup('Only these words'); });
    await page.locator('#forceRoot .update-words').waitFor();
    assert.equal(await page.locator('#forceRoot .modal-msg').textContent(),'Only these words','the update popup shows only the written words');
    await page.locator('#updOkBtn').click();
    // Rico: moods, inbox, the robot.
    await openView(page,'assistant');
    assert.equal(await page.locator('.rico-note').count(),1,'Rico\u2019s own message is at the top');
    assert.match(await page.locator('.rico-hello').textContent(),/Rozha/,'Rico greets the account by name');
    assert.equal(await page.locator('#ricoNameForm').count(),0,'Rico never asks for a name');
    assert.ok(calls.some(c=>c.endpoint==='assistant/inbox/read'),'opening Rico reads his messages');
    await page.locator('[data-rico-action="late_orders"]').click();
    await page.waitForFunction(()=>!rico.streaming);
    assert.equal(await page.locator('.rico-msg.bot .rico-bot').last().evaluate(el=>el.classList.contains('mood-angry')),true,'Rico\u2019s face shows his mood');
    assert.equal(await page.locator('.rico-head .rico-bot').evaluate(el=>el.classList.contains('mood-angry')),true,'the header face follows');
    assert.equal(await page.evaluate(()=>ricoFormat('[[data:Mam Fakhir]] has <<DATA>>9<</DATA>> items')),'<p>Mam Fakhir has 9 items</p>','data markers the AI copies are never shown');
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
    await page.locator('#itemAddBtn').click();await snapshot(page,'desktop-dialog.png');await page.locator('#modalFormCancel').click();
    await openView(page,'units');
    await page.locator('#unitAddBtn').click();
    assert.equal(await page.locator('#mfUnitAr').count(),1,'units have an Arabic name');
    await page.locator('#modalFormCancel').click();
    // Phone: three tabs + More, Edit tabs, swipe.
    await page.setViewportSize({width:390,height:844});await openView(page,'order');
    assert.match(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),/script-src 'self'/,'page ships a script security policy');
    assert.equal(await page.locator('.bottomnav > .navbtn').count(),4,'phone tab bar shows three tabs and More');
    await page.locator('#navMoreBtn').click();
    await page.locator('.nav-more [data-view="settings"]').waitFor({state:'visible'});
    await page.locator('.nav-more [data-view="settings"]').click();await settle(page);
    assert.equal(await page.evaluate(()=>state.view),'settings','More opens the other screens');
    assert.equal(await page.locator('#navMoreBtn').evaluate(el=>el.classList.contains('active')),true,'More stays lit on one of its screens');
    await page.locator('#navMoreBtn').click();
    await page.locator('#navEditTabs').waitFor({state:'visible'});
    await page.locator('#navEditTabs').click();
    await page.locator('[data-tab="assistant"]').click();   // take Rico out
    assert.equal(await page.locator('#modalFormOk').isDisabled(),true,'three tabs are needed');
    await page.locator('[data-tab="suppliers"]').click();
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>state.tabs.join()==='order,history,suppliers');
    assert.deepEqual(calls.filter(c=>c.endpoint==='me/tabs').pop().body.tabs,['order','history','suppliers'],'tabs are saved for the account');
    assert.deepEqual(await page.locator('.bottomnav > .navbtn[data-view]').evaluateAll(els=>els.map(el=>el.dataset.view)),['order','history','suppliers'],'the tab bar follows');
    await page.evaluate(async()=>{ state.tabs=['order','assistant','history']; render(); });
    await openView(page,'order');
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
    await page.locator('.toast-undo').click();
    assert.equal(await page.evaluate(()=>state.cart.i8),5,'clearing the order can be undone');
    await page.evaluate(()=>window.scrollTo(0,0));
    // A finger swipe to the left moves from Order to Rico, with the page sliding.
    await page.evaluate(()=>{
      const el=document.querySelector('.content .page-heading'), r=el.getBoundingClientRect(), y=r.top+r.height/2;
      const fire=(type,x)=>document.dispatchEvent(Object.assign(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'touch',clientX:x,clientY:y})));
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,pointerType:'touch',clientX:300,clientY:y}));
      for(const x of [280,240,180,120]) fire('pointermove',x);
      fire('pointerup',120);
    });
    assert.equal(await page.evaluate(()=>state.view),'assistant','swiping the page moves to the next tab');
    assert.equal(await page.locator('.content.gliding').count(),1,'the swipe moves to the next page');
    await settle(page);
    await page.evaluate(()=>setLang('ku'));await openView(page,'order');
    assert.ok(parseFloat(await page.locator('#itemSearch').evaluate(el=>getComputedStyle(el).fontSize))>=16,'mobile search avoids focus zoom');
    await snapshot(page,'phone-order-ku.png');
    await page.evaluate(()=>setLang('ar'));await snapshot(page,'phone-order-ar.png');
    await openView(page,'assistant');await snapshot(page,'phone-rico-ar.png');
    await ctx.close();

    /* ---------- Yunis ---------- */
    const y=await context({account:'yunis'});
    assert.deepEqual(await y.page.evaluate(()=>state.views),YUNIS_VIEWS,'Yunis gets the right screens');
    await y.page.setViewportSize({width:390,height:844});
    assert.equal(await y.page.locator('.bottomnav [data-view="devices"], .bottomnav [data-view="settings"]').count(),0,'no Devices or Settings for Yunis');
    await openView(y.page,'history');
    assert.equal(await y.page.locator('[data-delhist]').count(),0,'Yunis cannot delete history');
    await openView(y.page,'suppliers');
    assert.equal(await y.page.locator('#supAddBtn').count(),1,'Yunis can edit suppliers');
    await openView(y.page,'units');
    assert.equal(await y.page.locator('[data-delunit]').count(),1,'Yunis can delete units');
    await y.page.evaluate(()=>goView('settings'));
    assert.notEqual(await y.page.evaluate(()=>state.view),'settings','Settings cannot be opened by Yunis');
    await snapshot(y.page,'phone-yunis.png');
    await y.ctx.close();

    /* ---------- Sign in ---------- */
    const login=await context({loggedIn:false});
    await login.page.evaluate(()=>window.originalKey=document.querySelector('[data-key="1"]'));
    await login.page.locator('[data-key="1"]').click();
    assert.equal(await login.page.evaluate(()=>originalKey===document.querySelector('[data-key="1"]')),true,'PIN keypad remains mounted');
    await login.page.locator('[data-key="clear"]').click();
    for(const lang of LANGS){
      await login.page.evaluate(lang=>setLang(lang),lang);
      for(const width of viewportWidths){
        await login.page.setViewportSize({width,height:width>=960?900:740});await noOverflow(login.page,'login/'+lang+'/'+width);
        const corner=await login.page.locator('#loginLangBtn').boundingBox();
        assert.ok(corner && corner.y < 80,'the language button sits in the top corner ('+lang+'/'+width+')');
      }
    }
    await login.page.setViewportSize({width:1440,height:1000});await login.page.evaluate(()=>setLang('en'));await snapshot(login.page,'desktop-login.png');
    await login.page.setViewportSize({width:390,height:844});await snapshot(login.page,'phone-login.png');
    // Secret code: a wrong name just closes.
    await login.page.keyboard.type('000000');
    await login.page.locator('#modalPromptInput').waitFor();
    assert.equal(await login.page.locator('#modalPromptInput').getAttribute('autocapitalize'),'none','the name box never capitalises');
    await login.page.locator('#modalPromptInput').fill('Rozha');
    await login.page.locator('#modalPromptOkBtn').click();
    await login.page.waitForFunction(()=>!document.querySelector('#modalRoot .modal-overlay'));
    assert.equal(await login.page.locator('#modalRoot .modal-overlay').count(),0,'a wrong name closes without a word');
    // The right name, Rozha's PIN, then the new codes.
    await login.page.keyboard.type('000000');
    await login.page.locator('#modalPromptInput').waitFor();
    await login.page.locator('#modalPromptInput').fill('rozha');
    await login.page.locator('#modalPromptOkBtn').click();
    await login.page.waitForFunction(()=>document.querySelector('#modalPromptInput')?.type==='password');
    await login.page.locator('#modalPromptInput').fill('069690');
    await login.page.locator('#modalPromptOkBtn').click();
    await login.page.locator('#recYunis').waitFor();
    await login.page.locator('#recYunis').fill('111111');
    await login.page.locator('#recCode').fill('111111');
    await login.page.locator('#modalFormOk').click();
    assert.match(await login.page.locator('#modalFormStatus').textContent(),/different/,'the codes must all be different');
    await login.page.locator('#recCode').fill('');
    await login.page.locator('#modalFormOk').click();
    await login.page.waitForFunction(()=>!document.querySelector('.modal-form'));
    const saved=login.calls.find(c=>c.endpoint==='recovery/save');
    assert.deepEqual([saved.body.ticket,saved.body.yunisPin,saved.body.rozhaPin,saved.body.secretCode],['fixture-ticket','111111','',''],'only the filled-in code is sent');
    await login.page.locator('#modalAlertOkBtn').click();
    await login.page.waitForFunction(()=>!document.querySelector('#modalRoot .modal-overlay'));
    // Yunis signs in: welcome back, by name.
    await login.page.keyboard.type('200666');
    await login.page.waitForSelector('#welcome');
    assert.match(await login.page.locator('.welcome-title').textContent(),/Welcome back, Yunis/,'welcome back says the name');
    await login.page.waitForSelector('#orderResults');
    assert.equal(await login.page.evaluate(()=>state.account),'yunis');
    await login.page.locator('#logoutBtn').click();await login.page.waitForSelector('.keypad');
    assert.equal(await login.page.locator('.pin-dot.filled').count(),0,'logout resets the PIN feedback');
    await login.ctx.close();
    const reduced=await context({reducedMotion:'reduce'});await reduced.page.locator('[data-inc="i1"]').click();
    assert.equal(await reduced.page.locator('[data-qty="i1"]').evaluate(el=>el.getAnimations().length),0,'reduced motion skips JS feedback');
    await reduced.page.evaluate(()=>goView('history'));
    assert.equal(await reduced.page.locator('.content.gliding').count(),0,'reduced motion skips the page transition');
    await reduced.ctx.close();
    assert.deepEqual(errors,[],'no browser errors');
    console.log(JSON.stringify({result:'PASS',checks:`every text in 3 languages, ${3*viewportWidths.length*9} workspace layouts, ${3*viewportWidths.length} sign-in layouts, sidebar highlight and slide on every screen, language menu with Apply, Arabic font and 1 2 3 digits, Rozha vs Yunis screens and history delete, secret code steps, welcome by name, edit tabs, update message in 3 languages with only the written words, Rico moods and inbox, page swipe, tap-to-type and hold-to-repeat quantities, press-and-hold menu, undo, security policy, desktop install, reduced motion`,artifacts},null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
