/* Local UI regression checks. Requires Playwright (no production API calls).
   Run: node scripts/ui-smoke.cjs
   EDGE_PATH can select a locally installed Chromium/Edge executable. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'ricotta-ui-'));
const supplierNames=['Corner Cake','Golden Bread Bakery','Fresh produce','Daily essentials','Kitchen supplies','Beverages','Dairy','Meat supplier','دابینکەری سەوزە','دابینکەری بەرهەمەکان'];
const suppliers=supplierNames.map((name,i)=>({id:'s'+i,name,phone:''}));
const items=Array.from({length:181},(_,i)=>({id:'i'+i,name:i%3===0?'تەماتە '+i:'Kitchen item '+String(i).padStart(3,'0'),unit:'box',supplierId:'s'+(i%10)}));
const fixture={role:'admin',suppliers,items,units:[{id:'box',en:'box',ku:'سندوق'}],history:[{id:'h1',date:'2026-09-23T08:00:00Z',entries:[{supplierId:'s1',items:[{itemId:'i1',name:items[1].name,qty:2,unit:'box'}]}]}],devices:[],activity:[],reminder:{enabled:false,time:'09:00'}};
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
  async function context(loggedIn=true,reducedMotion='no-preference'){
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion,serviceWorkers:'block'});
    await ctx.route('**/functions/v1/api/**',async route=>{
      const endpoint=new URL(route.request().url()).pathname.split('/api/')[1];
      const data=endpoint==='bootstrap'?fixture:endpoint==='devices'?[]:endpoint==='login'?{token:'fixture-session',expiresAt:'2099-01-01T00:00:00Z',role:'admin'}:{};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await ctx.addInitScript(({loggedIn})=>{
      localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
      localStorage.setItem('ricottaOrders:deviceNickname',JSON.stringify('Local UI fixture'));
      if(loggedIn) localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'fixture-session',expiresAt:'2099-01-01T00:00:00Z',role:'admin'}));
    },{loggedIn});
    const page=await ctx.newPage();page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(url);await page.waitForSelector(loggedIn?'#orderResults':'.keypad');await page.waitForSelector('#splash',{state:'detached'});
    return {ctx,page};
  }
  async function noOverflow(page,label){
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok(sizes.document<=sizes.viewport+1,label+' horizontal overflow '+JSON.stringify(sizes));
  }
  async function snapshot(page,name){
    await page.screenshot({path:path.join(artifacts,name),animations:'disabled'});
  }
  try{
    const {ctx,page}=await context();
    await page.evaluate(()=>{window.originalRow=document.querySelector('[data-item-id="i1"]');window.originalInput=document.querySelector('#itemSearch');window.originalNav=document.querySelector('.bottomnav');window.originalTop=document.querySelector('.topbar');});
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
    await page.locator('[data-lang="ku"]').click();await page.locator('[data-inc="i1"]').click();
    assert.equal(await page.locator('[data-qty="i1"]').inputValue(),'3','increment works after language switch');
    for(const lang of ['en','ku']){
      await page.evaluate(lang=>setLang(lang),lang);
      for(const width of [360,390,768,1024,1440,1920]){
        await page.setViewportSize({width,height:900});
        for(const view of ['order','itemsAdmin','units','settings','suppliers','history','devices','record']){
          await page.locator('[data-view="'+view+'"]').click();
          await noOverflow(page,lang+'/'+width+'/'+view);
        }
      }
    }
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>setLang('en'));await page.locator('[data-view="order"]').click();await page.locator('[data-ordertab="all"]').click();await snapshot(page,'desktop-order.png');
    await page.locator('[data-view="itemsAdmin"]').click();await snapshot(page,'desktop-catalog.png');
    await page.locator('#itemAddBtn').click();await snapshot(page,'desktop-dialog.png');await page.locator('#modalFormCancel').click();
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>setLang('ku'));await page.locator('[data-view="order"]').click();await snapshot(page,'phone-order-ku.png');
    await ctx.close();
    const login=await context(false);
    await login.page.evaluate(()=>window.originalKey=document.querySelector('[data-key="1"]'));
    await login.page.locator('[data-key="1"]').click();
    assert.equal(await login.page.evaluate(()=>originalKey===document.querySelector('[data-key="1"]')),true,'PIN keypad remains mounted');
    await login.page.locator('[data-key="clear"]').click();
    for(const lang of ['en','ku']){
      await login.page.evaluate(lang=>setLang(lang),lang);
      for(const width of [360,390,768,1024,1440,1920]){
        await login.page.setViewportSize({width,height:width>=960?900:740});await noOverflow(login.page,'login/'+lang+'/'+width);
        assert.ok(await login.page.locator('#loginLangToggle').isVisible());
      }
    }
    await login.page.setViewportSize({width:1440,height:1000});await login.page.evaluate(()=>setLang('en'));await snapshot(login.page,'desktop-login.png');
    await login.page.setViewportSize({width:390,height:844});await snapshot(login.page,'phone-login.png');
    await login.page.locator('#loginLangToggle').click();
    assert.equal(await login.page.locator('[data-login-lang]').count(),2,'login language popover has two concise choices');
    assert.equal(await login.page.locator('#loginLangToggle').getAttribute('aria-expanded'),'true','language popover reports its open state');
    await login.page.locator('[data-login-lang="ku"]').click();
    assert.equal(await login.page.locator('#loginLangToggle .lang-short').textContent(),'KU','language changes only after choosing an option');
    await login.page.evaluate(()=>setLang('en'));
    await login.page.keyboard.type('123456');
    await login.page.waitForSelector('#orderResults');await login.page.waitForSelector('#splash',{state:'detached'});
    assert.equal(await login.page.locator('[data-view]').count(),8,'six-digit login opens the admin workspace');
    await login.page.evaluate(()=>{state.role='user';render();});
    assert.equal(await login.page.locator('[data-view]').count(),2,'staff navigation keeps its permitted screens');
    await login.page.locator('#logoutBtn').click();await login.page.waitForSelector('.keypad');
    assert.equal(await login.page.locator('.pin-dot.filled').count(),0,'logout resets the PIN feedback');
    await login.ctx.close();
    const reduced=await context(true,'reduce');await reduced.page.locator('[data-inc="i1"]').click();
    assert.equal(await reduced.page.locator('[data-qty="i1"]').evaluate(el=>el.getAnimations().length),0,'reduced motion skips JS feedback');
    await reduced.ctx.close();
    assert.deepEqual(errors,[],'no browser errors');
    console.log(JSON.stringify({result:'PASS',checks:'96 workspace layouts, 12 login layouts, stable quantity/PIN/search DOM, supplier counts, draft restore/clear, language switch, reduced motion',artifacts},null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
