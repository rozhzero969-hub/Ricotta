/* Send to suppliers, the way it is used on an iPhone: WhatsApp opens for each supplier, and the
   iPhone may close the app meanwhile. The suppliers already sent must stay sent, pressing Send again
   must not start over, and the order must reach History exactly once.
   Run: node scripts/order-queue-smoke.cjs (Playwright; the server is mocked, no production calls).
   EDGE_PATH can select a locally installed Chromium/Edge executable. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');

const suppliers=[{id:'s0',name:'Golden Bread Bakery',phone:'0750 111 2222'},{id:'s1',name:'Fresh produce',phone:'07701234567'},{id:'s2',name:'Corner Cake',phone:''}];
const items=[{id:'i0',name:'Bread',unit:'box',supplierId:'s0'},{id:'i1',name:'Tomato',unit:'box',supplierId:'s1'},{id:'i2',name:'Cake',unit:'box',supplierId:'s2'}];
const session={token:'fixture-yunis',expiresAt:'2099-01-01T00:00:00Z',account:'yunis',name:'Yunis',tabs:['order','assistant','history']};

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
  async function phone({lang='en'}={}){
    const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce',serviceWorkers:'block'});
    await ctx.addInitScript(()=>Object.defineProperty(Navigator.prototype,'standalone',{get:()=>true}));   // opened from the Home Screen
    const saved=[], history=[];
    const server={orders:'ok'};
    await ctx.route('**/functions/v1/stock-api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable in this test"}',headers:{'access-control-allow-origin':'*'}}));
    await ctx.route('**/functions/v1/api/**',async route=>{
      const req=route.request(), endpoint=new URL(req.url()).pathname.split('/api/')[1], body=req.postDataJSON?.()||null;
      let status=200, data={ok:true};
      if(endpoint==='bootstrap') data={account:'yunis',name:'Yunis',tabs:session.tabs,views:['order','assistant','history','suppliers','itemsAdmin','units','record','sounds'],
        suppliers,items,units:[{id:'box',en:'box',ku:'سندوق',ar:'صندوق'}],history,devices:[],activity:[],reminder:{enabled:false,time:'09:00'},pars:[],inbox:[]};
      else if(endpoint==='devices') data=[];
      else if(endpoint==='assistant/inbox') data=[];
      else if(endpoint==='assistant/status') data={configured:true,provider:'gemini',model:'gemini-3.5-flash-lite'};
      else if(endpoint==='orders' && req.method()==='POST'){
        saved.push(body);
        if(server.orders==='broken'){ status=400; data={error:'Bad order'}; }
        else if(!history.some(h=>h.id===body.id)) history.push(body);
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    await ctx.addInitScript(({s,lang})=>{
      localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
      if(!sessionStorage.getItem('seeded')){ localStorage.setItem('ricottaOrders:apiSession',JSON.stringify(s)); localStorage.setItem('ricottaOrders:lang',JSON.stringify(lang)); sessionStorage.setItem('seeded','1'); }
      // WhatsApp: remember what would have opened.
      window.__opened=[]; window.open=(link)=>{ window.__opened.push(String(link)); return null; };
    },{s:session,lang});
    const page=await ctx.newPage(); page.on('pageerror',error=>errors.push(String(error)));
    const start=async()=>{ await page.waitForSelector('#app[data-screen]'); await page.waitForSelector('#splash',{state:'detached'}); };
    await page.goto(url); await start();
    return {ctx,page,saved,history,server,start};
  }
  const card=(page,name)=>page.locator('.queue-card',{hasText:name});
  // Names of the suppliers whose card shows as sent, in screen order.
  const sentNames=page=>page.$$eval('.queue-card.sent .queue-name',(els,names)=>els.map(e=>names.find(n=>e.textContent.trim().endsWith(n))),suppliers.map(s=>s.name));
  const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('ricottaOrders:sendQueue:yunis')||'null'));
  try{
    for(const lang of ['en','ku']){
      const {ctx,page,saved,history,start}=await phone({lang});
      await page.waitForSelector('#orderResults');
      for(const id of ['i0','i1','i2']) await page.locator(`[data-inc="${id}"]`).click();
      await page.locator('[data-inc="i1"]').click();
      await page.locator('#sendOrdersBtn').click();
      await page.waitForSelector('.queue-card');
      assert.equal(await page.locator('.queue-card').count(),3,lang+': one card per supplier');

      // First supplier: WhatsApp opens, and the card is sent (and kept on the phone) at once.
      await card(page,'Golden Bread Bakery').locator('[data-send]').click();
      assert.match((await page.evaluate(()=>__opened))[0],/^https:\/\/wa\.me\/9647501112222\?text=/,lang+': WhatsApp opens for the supplier');
      assert.deepEqual(await sentNames(page),['Golden Bread Bakery']);
      assert.deepEqual((await stored(page)).entries.map(e=>e.sent),[true,false,false],lang+': progress is saved on the phone');

      // The iPhone closes the app while WhatsApp is open; opening it again comes back to the same progress.
      await page.reload(); await start();
      assert.equal(await page.evaluate(()=>state.view),'queue',lang+': the app reopens on Send to suppliers');
      assert.deepEqual(await sentNames(page),['Golden Bread Bakery'],lang+': the supplier already sent stays sent after a restart');

      // Back to Order and Send again: nothing starts over.
      await page.locator('#queueBackBtn').click();
      await page.waitForSelector('#sendOrdersBtn');
      await page.locator('#sendOrdersBtn').click();
      await page.waitForSelector('.queue-card');
      assert.deepEqual(await sentNames(page),['Golden Bread Bakery'],lang+': pressing Send again keeps what was sent');

      // Changing an amount for a supplier means that supplier has to be sent again; the others stay sent.
      await page.locator('#queueBackBtn').click();
      await page.locator('[data-inc="i0"]').click();
      await page.locator('#sendOrdersBtn').click();
      await page.waitForSelector('.queue-card');
      assert.deepEqual(await sentNames(page),[],lang+': a changed amount is not marked sent');
      await card(page,'Golden Bread Bakery').locator('[data-send]').click();
      await card(page,'Fresh produce').locator('[data-send]').click();
      assert.equal(saved.length,0,'nothing is saved before every supplier is sent');
      await card(page,'Corner Cake').locator('[data-marksent]').click();

      // Every supplier sent: saved once, the screen closes, the draft is cleared, and History has it.
      await page.waitForFunction(()=>state.queue===null && state.view==='order');
      assert.equal(saved.length,1,lang+': the order is saved exactly once');
      assert.deepEqual(saved[0].entries.map(e=>[e.supplierId,e.items.map(i=>i.itemId+'×'+i.qty).join()]),[['s0','i0×2'],['s1','i1×2'],['s2','i2×1']]);
      assert.equal(saved[0].by,'yunis');
      assert.equal(await stored(page),null,lang+': nothing is left to resume');
      assert.equal(await page.evaluate(()=>localStorage.getItem('ricottaOrders:pendingCart:yunis')),null,lang+': the draft is cleared');
      await page.locator('.bottomnav [data-view="history"]').click();
      await page.waitForFunction(()=>state.view==='history');
      assert.ok(await page.locator('.content').filter({hasText:'Tomato'}).count(),lang+': the order shows in History');
      // A restart afterwards shows the order screen, not the finished queue.
      await page.reload(); await start();
      assert.equal(await page.evaluate(()=>state.queue),null);
      assert.equal(history.length,1);
      await ctx.close();
    }

    // The last supplier is sent while the save fails; the app is closed; reopening saves the same order (same id) once.
    {
      const {ctx,page,saved,history,server,start}=await phone();
      await page.waitForSelector('#orderResults');
      await page.locator('[data-inc="i0"]').click();
      server.orders='broken';
      await page.locator('#sendOrdersBtn').click();
      await card(page,'Golden Bread Bakery').locator('[data-send]').click();
      await page.waitForSelector('#queueRetrySave');
      const firstId=saved[0].id;
      assert.equal((await stored(page)).record.id,firstId,'the order id is kept on the phone');
      server.orders='ok';
      await page.reload(); await start();
      await page.waitForFunction(()=>state.queue===null);
      assert.deepEqual(saved.map(o=>o.id),[firstId,firstId],'reopening retries the same order');
      assert.equal(history.length,1,'and it is in History once');
      assert.equal(await stored(page),null);
      await ctx.close();
    }

    // Coming back from WhatsApp saves an order whose last send was interrupted before it saved.
    {
      const {ctx,page,saved}=await phone();
      await page.waitForSelector('#orderResults');
      await page.locator('[data-inc="i0"]').click();
      await page.locator('#sendOrdersBtn').click();
      await page.waitForSelector('.queue-card');
      await page.evaluate(()=>{ state.queue.forEach(e=>{ e.sent=true; }); persistQueue(); });   // sent, but the save never started
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(()=>state.queue===null);
      assert.equal(saved.length,1,'returning to the app saves the order');
      await ctx.close();
    }

    // Clearing the order drops an unfinished queue, so a new order the same day starts unsent.
    {
      const {ctx,page}=await phone();
      await page.waitForSelector('#orderResults');
      await page.locator('[data-inc="i0"]').click();
      await page.locator('[data-inc="i1"]').click();
      await page.locator('#sendOrdersBtn').click();
      await card(page,'Golden Bread Bakery').locator('[data-send]').click();
      await page.locator('#queueBackBtn').click();
      await page.locator('#clearOrderBtn').click();
      assert.equal(await stored(page),null,'a cleared order leaves nothing to resume');
      await page.locator('[data-inc="i0"]').click();
      await page.locator('#sendOrdersBtn').click();
      await page.waitForSelector('.queue-card');
      assert.deepEqual(await sentNames(page),[],'a new order starts unsent');
      await ctx.close();
    }
    assert.deepEqual(errors,[],'no page errors');
    console.log('Order queue smoke: PASS (progress kept across an app restart, Send again keeps sent suppliers, saved once to History, interrupted save resumes with the same id, return from WhatsApp saves, cleared order starts over; EN + KU)');
  }finally{
    await browser.close(); server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
