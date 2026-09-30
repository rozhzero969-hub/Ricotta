/* UI checks for the Stock, Transfer and Item setup screens. Requires Playwright.
   Run: node scripts/stock-ui-smoke.cjs   (EDGE_PATH can select a Chromium/Edge executable.)
   Both the `api` and `stock-api` servers are mocked, so nothing here touches the
   live project or the workplace system. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const PIXEL='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const ID={ok:'11111111-1111-4111-8111-111111111111',bad:'22222222-2222-4222-8222-222222222222',un:'33333333-3333-4333-8333-333333333333'};
const iso=m=>new Date(Date.now()-m*60000).toISOString();
const req=(id,extra)=>({id,itemId:'i1',itemName:'Coca Cola',unitLabel:'carton',quantity:1,from:'Main Storage',to:'Minibar',yesterday:false,status:'waiting',approvedBy:'rozha',approvedAt:iso(3),previewStatus:null,previewMessage:null,previewedAt:null,finalApprovedBy:null,finalApprovedAt:null,finishedAt:null,resultMessage:null,recordedDate:null,hasCheckShot:false,...extra});

function fixture(){
  const units=[{id:'box',en:'box',ku:'سندوق',ar:'صندوق'},{id:'pc',en:'piece',ku:'دانە',ar:'قطعة'},{id:'ctn',en:'carton',ku:'کارتۆن',ar:'كرتون'}];
  const items=[{id:'i0',name:'Tomato',unit:'box',supplierId:'s0',sortOrder:0},{id:'i1',name:'Coca Cola',unit:'ctn',supplierId:'s0',sortOrder:1},{id:'i2',name:'Flour',unit:'box',supplierId:'s0',sortOrder:2},{id:'i3',name:'Milk',unit:'ctn',supplierId:'s0',sortOrder:3}];
  const api=account=>({account,name:account==='rozha'?'Rozha':'Yunis',tabs:['order','assistant','history'],
    views:['order','assistant','history','transfers','stock','suppliers','itemsAdmin','units','record'].concat(account==='rozha'?['devices','settings']:[]),
    suppliers:[{id:'s0',name:'Supplier',phone:''}],items,units,history:[{id:'h1',date:iso(60*30),by:'yunis',entries:[{supplierId:'s0',items:[{itemId:'i0',name:'Tomato',qty:2,unit:'box'}]}]}],
    devices:[],activity:[],reminder:{enabled:false,time:'09:00'},pars:[],inbox:[]});
  const stock={
    storages:['Main Storage','Minibar','Pizza'],
    settings:[{itemId:'i1',countingUnit:'ctn',perBuying:null,lowStock:2},{itemId:'i2',countingUnit:'pc',perBuying:12,lowStock:100},{itemId:'i3',countingUnit:'ctn',perBuying:null,lowStock:null}],
    balances:[{itemId:'i1',storage:'Main Storage',quantity:5},{itemId:'i2',storage:'Main Storage',quantity:20}],
    counts:[{id:'c1',itemId:'i1',itemName:'Coca Cola',storage:'Main Storage',unitLabel:'carton',quantity:5,prior:0,by:'rozha',countedAt:iso(600),enteredAt:iso(600),note:null}],
    requests:[
      req(ID.ok,{previewStatus:'ok',previewMessage:'All match',previewedAt:iso(1),hasCheckShot:true}),
      req(ID.un,{itemName:'Milk',itemId:'i3',approvedAt:iso(2)}),
      req(ID.bad,{status:'needs_checking',itemName:'Old',approvedAt:iso(60),finishedAt:iso(50),resultMessage:'Worker stopped'}),
    ],
  };
  return {api,stock};
}
const server=http.createServer((rq,res)=>{
  const p=decodeURIComponent(new URL(rq.url,'http://x').pathname);const f=path.resolve(root,'.'+(p==='/'?'/index.html':p));
  if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(f)]||'application/octet-stream');res.end(d);});
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
  const errors=[];
  async function open({account='rozha',lang='en',width=390}={}){
    const fx=fixture();const calls=[];const apiCalls=[];
    const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:width<700,isMobile:width<700,serviceWorkers:'block'});
    await ctx.route('**/functions/v1/**',async route=>{
      const rq=route.request(),u=new URL(rq.url()),fn=u.pathname.split('/functions/v1/')[1].split('/')[0],ep=u.pathname.split('/functions/v1/'+fn+'/')[1]||'',body=rq.postDataJSON?.()||null;
      let status=200,data={ok:true};
      if(fn==='stock-api'){
        calls.push({ep,method:rq.method(),body});
        if(ep==='bootstrap') data={storages:fx.stock.storages,settings:fx.stock.settings,counts:fx.stock.counts,requests:fx.stock.requests,balances:fx.stock.balances};
        else if(ep==='requests'&&rq.method()==='GET') data={requests:fx.stock.requests,balances:fx.stock.balances};
        else if(ep.startsWith('shots')) data={shots:[{kind:'check',image:PIXEL,takenAt:iso(1)}]};
        else if(ep==='counts'&&body.pin!=='123456'){status=403;data={error:'wrong_pin'};}
        else if(ep==='requests') {status=201;data={id:'new'};}
      }else{
        apiCalls.push({ep,method:rq.method(),body});
        if(ep==='bootstrap') data=fx.api(account);
        else if(ep==='devices') data=[];
        else if(ep==='assistant/inbox') data=[];
        else if(ep==='assistant/status') data={configured:true};
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
    });
    await ctx.addInitScript(({s,lang})=>{
      localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
      localStorage.setItem('ricottaOrders:apiSession',JSON.stringify(s));
      localStorage.setItem('ricottaOrders:lang',JSON.stringify(lang));
    },{s:{token:'t',expiresAt:'2099-01-01T00:00:00Z',account,name:account==='rozha'?'Rozha':'Yunis',tabs:['order','assistant','history']},lang});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(url);await page.waitForSelector('#orderResults');await page.waitForSelector('#splash',{state:'detached'});
    return {ctx,page,calls,apiCalls,fx};
  }
  async function go(page,view){
    const tab=page.locator('.bottomnav [data-view="'+view+'"]');
    if(page.viewportSize().width<960&&await tab.evaluate(el=>!!el.closest('.nav-more'))){
      await page.locator('#navMoreBtn').click();
      await page.waitForFunction(v=>{const el=document.querySelector('.nav-more [data-view="'+v+'"]');return el&&getComputedStyle(el.closest('.nav-more')).opacity==='1';},view);
    }
    await tab.click();
    await page.waitForFunction(()=>!document.querySelector('.content.gliding'),null,{timeout:4000});
  }
  try{
    /* ---------- Rozha, English ---------- */
    let {ctx,page,calls,apiCalls}=await open();
    await go(page,'transfers');
    assert.equal(await page.locator('#trSearch').isDisabled(),true,'item search waits for a source storage');
    // Only items that are set up appear; ones with no stock in the source cannot be picked.
    await page.selectOption('#trFrom','Main Storage');await page.selectOption('#trTo','Minibar');
    const names=await page.locator('#trResults .name').allTextContents();
    assert.deepEqual(names.sort(),['Coca Cola','Flour','Milk'],'only set-up items are offered');
    await page.locator('[data-trpick="i3"]').click();
    assert.equal(await page.locator('#trChosen').isVisible(),false,'an item with no stock in the source is not selectable');
    await page.locator('[data-trpick="i1"]').click();
    assert.match(await page.locator('#trChosen').innerText(),/Coca Cola/);
    // 5 in stock, 1 reserved by the waiting request and 1 by the needs-checking one => 3 free.
    await page.locator('#trAll').click();assert.equal(await page.locator('#trQty').inputValue(),'3','use-all respects reserved stock');
    await page.fill('#trQty','9');assert.match(await page.locator('#trHint').innerText(),/more than is available/i);
    await page.fill('#trQty','2');assert.match(await page.locator('#trHint').innerText(),/Ready/);
    await page.locator('#trSwap').click();assert.equal(await page.inputValue('#trFrom'),'Minibar');assert.equal(await page.locator('#trChosen').isVisible(),false,'changing the source clears the item');
    await page.locator('#trSwap').click();
    await page.locator('[data-trpick="i1"]').click();await page.fill('#trQty','2');await page.locator('#trYesterday').check();
    await page.locator('#trReview').click();
    assert.match(await page.locator('#trReviewCard').innerText(),/Main Storage[\s\S]*Minibar[\s\S]*Coca Cola[\s\S]*2[\s\S]*yesterday/i);
    await page.locator('#trApprove').click();
    await page.waitForFunction(()=>true);await page.waitForTimeout(400);
    const post=calls.find(c=>c.ep==='requests'&&c.method==='POST');
    assert.ok(post,'approve posts to stock-api');
    assert.deepEqual({from:post.body.from,to:post.body.to,y:post.body.yesterday,item:post.body.itemId,q:post.body.quantity,n:post.body.expectedName,u:post.body.expectedUnit,unit:post.body.unitId},
      {from:'Main Storage',to:'Minibar',y:true,item:'i1',q:'2',n:'Coca Cola',u:'carton',unit:'ctn'});
    assert.equal(await page.locator('#trUnits').isVisible().catch(()=>false),false,'no unit choice when buying and counting formats are the same');
    // Requests on the PC: final approve only for the checked request that has a screenshot.
    await page.waitForSelector('[data-trreq]');
    await page.waitForFunction(()=>document.querySelector('[data-trreq] img.tr-shot img, [data-trreq] .tr-shot img'));
    const finals=page.locator('[data-trfinal]');
    assert.equal(await finals.count(),2);
    assert.equal(await page.locator(`[data-trfinal="${ID.ok}"]`).isEnabled(),true,'checked request can be approved');
    assert.equal(await page.locator(`[data-trfinal="${ID.un}"]`).isEnabled(),false,'unchecked request cannot be approved');
    await page.locator(`[data-trfinal="${ID.ok}"]`).click();await page.locator('#modalOkBtn').click();await page.waitForTimeout(300);
    assert.equal(calls.find(c=>c.ep==='final-approve')?.body.id,ID.ok);
    await page.locator(`[data-trcancel="${ID.un}"]`).click();await page.locator('#modalOkBtn').click();await page.waitForTimeout(300);
    assert.equal(calls.find(c=>c.ep==='cancel')?.body.id,ID.un);
    assert.ok(await page.locator('.st-alert').isVisible(),'needs-checking alert is shown');

    /* ---------- Transfer in the buying format: 1 box = 12 piece, 20 piece in Main Storage ---------- */
    await page.locator('[data-trpick="i2"]').click().catch(async()=>{ await page.selectOption('#trFrom','Main Storage'); await page.selectOption('#trTo','Minibar'); await page.locator('[data-trpick="i2"]').click(); });
    assert.equal(await page.locator('#trUnits').isVisible(),true,'unit choice appears when the formats differ');
    assert.equal(await page.locator('#trUnit').innerText(),'piece','counting unit is the default');
    await page.locator('[data-trunit="buying"]').click();
    assert.equal(await page.locator('#trUnit').innerText(),'box');
    assert.match(await page.locator('#trChosen').innerText(),/1\.666667 \u2068box\u2069 available/,'availability is shown in the unit being entered');
    await page.locator('#trAll').click();assert.equal(await page.locator('#trQty').inputValue(),'1.666666');
    await page.fill('#trQty','2');assert.match(await page.locator('#trHint').innerText(),/more than is available/i,'2 boxes (24 piece) exceeds 20 piece');
    await page.fill('#trQty','1.5');
    await page.locator('#trReview').click();
    assert.match(await page.locator('#trReviewCard').innerText(),/1\.5[\s\S]*box[\s\S]*= 18 piece/);
    await page.locator('#trApprove').click();await page.waitForTimeout(400);
    const boxPost=calls.filter(c=>c.ep==='requests'&&c.method==='POST').pop();
    assert.deepEqual({q:boxPost.body.quantity,unit:boxPost.body.unitId,label:boxPost.body.expectedUnit,item:boxPost.body.itemId},{q:'1.5',unit:'box',label:'box',item:'i2'});

    /* ---------- Stock and recount ---------- */
    await go(page,'stock');
    await page.waitForSelector('[data-stcount]');
    assert.deepEqual((await page.locator('#stList .name').allTextContents()).sort(),['Coca Cola','Flour','Milk']);
    await page.locator('[data-stfilter="low"]').click();
    assert.deepEqual(await page.locator('#stList .name').allTextContents(),['Flour','Milk'].slice(0,1),'low stock filter (total 20 <= 100; milk has no warning level)');
    await page.locator('[data-stfilter="all"]').click();
    await page.locator('[data-stcount="i1"]').click();
    await page.fill('#rcQty','7');await page.fill('#rcPin','000000');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>/PIN/i.test(document.querySelector('#modalFormStatus').textContent));
    await page.fill('#rcPin','123456');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('#rcQty'));
    const count=calls.filter(c=>c.ep==='counts').pop();
    assert.equal(count.body.pin,'123456');assert.equal(count.body.quantity,'7');assert.equal(count.body.storage,'Main Storage');

    /* ---------- Item form ---------- */
    await go(page,'itemsAdmin');
    assert.match(await page.locator('.it-progress').innerText(),/3 of 4/);
    await page.locator('[data-itfilter="todo"]').click();
    assert.deepEqual(await page.locator('#itemsAdminList .name').allTextContents(),['Tomato']);
    await page.locator('[data-edititem="i0"]').click();
    assert.equal(await page.locator('#mfPerBox').isVisible(),false,'no conversion until counting differs from buying');
    await page.selectOption('#mfCounting','pc');
    assert.equal(await page.locator('#mfPerBox').isVisible(),true,'conversion appears when the formats differ');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>document.querySelector('#modalFormStatus').textContent.trim().length>0);
    await page.fill('#mfPer','6');await page.fill('#mfLow','3');
    assert.match(await page.locator('#mfPerSummary').innerText(),/1 .* = 6 /);
    await page.selectOption('#mfCounting','box');
    assert.equal(await page.locator('#mfPerBox').isVisible(),false,'same unit hides the conversion again');
    await page.selectOption('#mfCounting','pc');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('#mfName'));
    const settings=calls.filter(c=>c.ep.startsWith('settings/')).pop();
    assert.deepEqual({ep:settings.ep,c:settings.body.countingUnit,p:settings.body.perBuying,l:settings.body.lowStock},{ep:'settings/i0',c:'pc',p:'6',l:'3'});

    /* ---------- History filters ---------- */
    await go(page,'history');
    assert.equal(await page.locator('.hist-card').count()>=4,true,'orders, transfers and counts are listed together');
    await page.locator('[data-histfilter="orders"]').click();
    assert.equal(await page.locator('.st-hist').count(),0,'orders filter hides transfers and counts');
    await page.locator('[data-histfilter="counts"]').click();
    assert.equal(await page.locator('.hist-card').count(),1);
    await page.locator('[data-histfilter="transfers"]').click();
    assert.equal(await page.locator('.st-hist').count(),3);
    /* ---------- Tab bar: Transfer and Stock can be pinned; that choice is kept by the stock server ---------- */
    await page.locator('#navMoreBtn').click();await page.locator('#navEditTabs').click();
    await page.locator('[data-tab="transfers"]').click();await page.locator('[data-tab="stock"]').click();
    await page.locator('#modalFormOk').click();await page.waitForFunction(()=>!document.querySelector('#tabPick'));
    assert.deepEqual(calls.filter(c=>c.ep==='tabs').pop()?.body.tabs,['history','transfers','stock']);
    assert.equal(apiCalls.some(c=>c.ep==='me/tabs'),false,'the older server is not asked to store screens it does not know');
    assert.deepEqual(await page.evaluate(()=>state.tabs),['history','transfers','stock']);
    await ctx.close();

    /* ---------- Yunis has the same screens ---------- */
    ({ctx,page}=await open({account:'yunis'}));
    for(const v of ['transfers','stock']) assert.ok(await page.locator('.bottomnav [data-view="'+v+'"]').count(),'Yunis has '+v);
    await ctx.close();

    /* ---------- 3 languages, 3 widths: every new screen renders, nothing overflows ---------- */
    for(const lang of ['en','ku','ar']) for(const width of [360,390,1024]){
      ({ctx,page}=await open({lang,width}));
      for(const view of ['transfers','stock','itemsAdmin','history']){
        await go(page,view);
        const sizes=await page.evaluate(()=>({v:innerWidth,d:document.documentElement.scrollWidth}));
        assert.ok(sizes.d<=sizes.v+1,`${lang} ${width} ${view} overflows ${JSON.stringify(sizes)}`);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.dir),lang==='en'?'ltr':'rtl');
      await ctx.close();
    }
    assert.deepEqual(errors.filter(e=>!/pushManager/.test(e)),[],'no page errors');
    console.log(JSON.stringify({result:'PASS',checks:'transfer flow and approval, final-approve gating, cancel, needs-checking alert, stock filters, recount PIN, item formats and conversion, history filters, both accounts, 3 languages at 3 widths'}));
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
