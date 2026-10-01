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
    control:{workerOnline:false,launcherOnline:true,startRequestedAt:null,startHandledAt:null},
    storages:['Main Storage','Minibar','Pizza'],
    settings:[{itemId:'i1',countingUnit:'ctn',perBuying:null,lowStock:2,workplaceName:'Coca-Cola 330'},{itemId:'i2',countingUnit:'pc',perBuying:12,lowStock:100,usageUnit:'pc'},{itemId:'i3',countingUnit:'ctn',perBuying:null,lowStock:null}],
    groups:[{id:'g1',name:'Drinks',itemIds:['i1','i3']}],
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
        if(ep==='bootstrap') data={groups:fx.stock.groups,storages:fx.stock.storages,settings:fx.stock.settings,counts:fx.stock.counts,requests:fx.stock.requests,balances:fx.stock.balances,control:fx.stock.control};
        else if(ep==='requests'&&rq.method()==='GET') data={requests:fx.stock.requests,balances:fx.stock.balances,control:fx.stock.control};
        else if(ep.startsWith('shots')) data={shots:[{kind:'check',image:PIXEL,takenAt:iso(1)}]};
        else if((ep==='counts'||ep==='counts-bulk')&&body.pin!=='123456'){status=403;data={error:'wrong_pin'};}
        else if(ep==='counts-bulk'){status=201;data={saved:body.lines.map(l=>l.itemId),failed:[]};}
        else if(ep==='receipts'&&rq.method()==='GET') data={receipts:[
          {id:'r1',supplierName:'Supplier',invoice:'777',currency:'IQD',rate:null,delivery:null,lines:[{appName:'Coca Cola',unitLabel:'carton',qty:2,cost:5000}],status:'prepared',message:null,createdBy:'rozha',createdAt:iso(5),preparedAt:iso(2),hasShot:true},
          {id:'r2',supplierName:'Supplier',invoice:'778',currency:'USD',rate:1500,delivery:5,lines:[{appName:'Milk',unitLabel:'carton',qty:1,cost:3}],status:'waiting',message:null,createdBy:'yunis',createdAt:iso(2),hasShot:false},
          {id:'r4',supplierName:'Supplier',invoice:'779',currency:'IQD',rate:null,delivery:null,lines:[{appName:'Flour',unitLabel:'box',qty:1,cost:9000}],status:'needs_checking',message:'Pressed, but the success message did not appear',createdBy:'rozha',createdAt:iso(9),hasShot:false}]};
        else if(ep.startsWith('receipts/shot')) data={image:PIXEL};
        else if(ep==='receipts'&&rq.method()==='POST'){status=201;data={id:'r3'};}
        else if(ep==='receipts/final-approve'||ep==='receipts/resolve') data={ok:true};
        else if(ep==='itemjobs'&&rq.method()==='GET') data={jobs:[{id:'j1',itemId:'i2',itemName:'Flour',kind:'edit',payload:{name:'Flour WP',fromName:'Flour',usage:'piece',buying:'box',counting:'piece'},status:'prepared',createdBy:'rozha',createdAt:iso(3),preparedAt:iso(2),hasShot:true}]};
        else if(ep.startsWith('itemjobs/shot')) data={image:PIXEL};
        else if(ep==='itemjobs'&&rq.method()==='POST'){status=201;data={id:'j2'};}
        else if(ep==='groups/save'){
          const g=body.id?fx.stock.groups.find(x=>x.id===body.id):null;
          if(g) Object.assign(g,{name:body.name,itemIds:body.itemIds}); else fx.stock.groups.push({id:'g'+(fx.stock.groups.length+1),name:body.name,itemIds:body.itemIds});
          data={ok:true,id:g?g.id:'g'+fx.stock.groups.length};
        }
        else if(ep==='groups/delete'){fx.stock.groups=fx.stock.groups.filter(x=>x.id!==body.id);}
        else if(ep.startsWith('settings/')){const st=fx.stock.settings.find(x=>x.itemId===ep.split('/')[1]);if(st) Object.assign(st,{lowStock:body.lowStock===null?null:Number(body.lowStock),workplaceName:body.workplaceName||null});}
        else if(ep==='zones/add'){fx.stock.storages.push(body.name);}
        else if(ep==='zones/rename'){fx.stock.storages=fx.stock.storages.map(x=>x===body.from?body.to:x);}
        else if(ep==='zones/delete'){fx.stock.storages=fx.stock.storages.filter(x=>x!==body.name);}
        else if(ep==='requests') {status=201;data={id:'new'};}
      }else{
        apiCalls.push({ep,method:rq.method(),body});
        if(ep==='assistant/chat'){
          const events=[{type:'mood',mood:'happy'},{type:'text',text:'Here are the veggies.'},
            {type:'proposal',proposal:{id:'p1',kind:'stock_group',action:'create',groupId:null,name:'Veggies',oldName:null,itemIds:['i0'],added:[{itemId:'i0',name:'Tomato'}],removed:[],total:1}},
            {type:'proposal',proposal:{id:'p2',kind:'stock_settings',itemId:'i1',name:'Coca Cola',unit:'carton',before:{lowStock:2,workplaceName:'Coca-Cola 330'},lowStock:4}},
            {type:'proposal',proposal:{id:'p3',kind:'open_stock',search:'cola',storage:'Main Storage',groupId:null,group:null,only:null,label:''}},
            {type:'done'}];
          return route.fulfill({status:200,contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n',headers:{'access-control-allow-origin':'*'}});
        }
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
    if(process.env.SHOT){await page.screenshot({path:process.env.SHOT+'/tr1.png',fullPage:false});}
    assert.equal(await page.locator('#trFromList .list-row').count(),3,'step 1 lists the storages');
    assert.equal(await page.locator('#trStItem').isVisible(),false,'items come after both storages are chosen');
    // Every item is searchable; the one that is not set up says so, and ones with no stock in the source cannot be picked.
    await page.locator('#trFromList [data-trsto="Main Storage"]').click();
    assert.equal(await page.locator('#trToList [data-trsto="Main Storage"]').count(),0,'the source is not offered as the destination');
    await page.locator('#trToList [data-trsto="Minibar"]').click();
    const names=await page.locator('#trResults .name').allTextContents();
    assert.deepEqual(names.sort(),['Coca Cola','Flour','Milk','Tomato'],'all items are searchable');
    assert.equal(await page.locator('#trResults .tr-result.todo').count(),1,'the item that is not set up is marked');
    await page.fill('#trSearch','tom');assert.deepEqual(await page.locator('#trResults .name').allTextContents(),['Tomato'],'search finds items');
    await page.fill('#trSearch','');
    await page.locator('[data-trpick="i3"]').click();
    assert.equal(await page.locator('#trChosen').isVisible(),false,'an item with no stock in the source is not selectable');
    await page.locator('[data-trpick="i1"]').click();
    assert.match(await page.locator('#trChosen').innerText(),/Coca Cola/);
    // 5 in stock, 1 reserved by the waiting request and 1 by the needs-checking one => 3 free.
    await page.locator('#trAll').click();assert.equal(await page.locator('#trQty').inputValue(),'3','use-all respects reserved stock');
    await page.fill('#trQty','9');assert.match(await page.locator('#trHint').innerText(),/more than is available/i);
    await page.fill('#trQty','2');assert.match(await page.locator('#trHint').innerText(),/Ready/);
    await page.locator('[data-crumb="from"]').click();assert.equal(await page.locator('#trFromList').isVisible(),true,'the source can be changed');assert.equal(await page.locator('#trChosen').isVisible(),false,'changing the source clears the item');
    await page.locator('#trFromList [data-trsto="Main Storage"]').click();await page.locator('#trToList [data-trsto="Minibar"]').click();
    await page.locator('[data-trpick="i1"]').click();await page.fill('#trQty','2');await page.locator('#trYesterday').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#trYesterday').check();
    await page.locator('#trReview').click();
    if(process.env.SHOT){await page.waitForTimeout(500);await page.screenshot({path:process.env.SHOT+'/tr2.png',fullPage:true});}
    assert.match(await page.locator('#trReviewCard').innerText(),/Main Storage[\s\S]*Minibar[\s\S]*Coca Cola[\s\S]*2[\s\S]*yesterday/i);
    await page.locator('#trApprove').click();
    await page.waitForFunction(()=>true);await page.waitForTimeout(400);
    const post=calls.find(c=>c.ep==='requests'&&c.method==='POST');
    assert.ok(post,'approve posts to stock-api');
    assert.deepEqual({from:post.body.from,to:post.body.to,y:post.body.yesterday,item:post.body.itemId,q:post.body.quantity,n:post.body.expectedName,u:post.body.expectedUnit,unit:post.body.unitId},
      {from:'Main Storage',to:'Minibar',y:true,item:'i1',q:'2',n:'Coca-Cola 330',u:'carton',unit:'ctn'});
    assert.equal(await page.locator('#trUnits').isVisible().catch(()=>false),false,'no unit choice when buying and counting formats are the same');
    // Requests on the PC: final approve only for the checked request that has a screenshot.
    await page.waitForSelector('[data-trreq]');
    await page.waitForFunction(()=>document.querySelector('[data-trreq] img.tr-shot img, [data-trreq] .tr-shot img'));
    const finals=page.locator('[data-trfinal]');
    assert.equal(await finals.count(),2);
    assert.equal(await page.locator(`[data-trfinal="${ID.ok}"]`).isEnabled(),true,'checked request can be approved');
    assert.equal(await page.locator(`[data-trfinal="${ID.un}"]`).isEnabled(),false,'unchecked request cannot be approved');
    await page.locator(`[data-trfinal="${ID.ok}"]`).click();
    assert.match(await page.locator('.modal-box').innerText(),/Coca Cola[\s\S]*Main Storage[\s\S]*Minibar/,'final confirmation lists what will move');
    await page.locator('#modalOkBtn').click();await page.waitForTimeout(300);
    assert.equal(calls.find(c=>c.ep==='final-approve')?.body.id,ID.ok);
    await page.locator(`[data-trcancel="${ID.un}"]`).click();await page.locator('#modalOkBtn').click();await page.waitForTimeout(300);
    assert.equal(calls.find(c=>c.ep==='cancel')?.body.id,ID.un);
    assert.ok(await page.locator('.st-alert').isVisible(),'needs-checking alert is shown');

    /* ---------- Start the PC worker from the app ---------- */
    assert.match(await page.locator('#wkBar').innerText(),/Off/i,'worker status shows off');
    await page.locator('#wkStart').click();await page.waitForTimeout(400);
    assert.ok(calls.some(c=>c.ep==='start-worker'&&c.method==='POST'),'Turn on asks the server to start the worker');
    // Health: running but the workplace page is not signed in, then test mode, then ready.
    const health=async(c)=>{await page.evaluate(c=>{stockState.control={...stockState.control,workerOnline:true,...c};wkPaint();},c);return page.locator('#wkBar').innerText();};
    assert.match(await health({workerPageReady:false,workerLive:true}),/Needs attention[\s\S]*Sign in/,'shows when the workplace page needs a sign-in');
    assert.match(await health({workerPageReady:true,workerLive:false}),/Test mode/,'shows test mode');
    assert.match(await health({workerPageReady:true,workerLive:true}),/Running and ready/,'shows ready');
    assert.equal(await page.locator('#wkStart').count(),0,'no Turn on button while it runs');
    await page.evaluate(()=>{stockState.control={...stockState.control,workerOnline:false};wkPaint();});

    /* ---------- Transfer in the buying format: 1 box = 12 piece, 20 piece in Main Storage ---------- */
    await page.locator('#trFromList [data-trsto="Main Storage"]').click();await page.locator('#trToList [data-trsto="Minibar"]').click();await page.locator('[data-trpick="i2"]').click();
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
    if(process.env.SHOT){await page.waitForTimeout(500);await page.screenshot({path:process.env.SHOT+'/st1.png'});}
    assert.deepEqual((await page.locator('#stList .name').allTextContents()).sort(),['Coca Cola','Flour','Milk','Tomato']);
    await page.locator('[data-stfilter="setup"]').click();
    assert.deepEqual(await page.locator('#stList .name').allTextContents(),['Tomato'],'not-set-up filter');
    await page.locator('[data-stfilter="all"]').click();
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

    /* ---------- Suppliers: the add form opens and saves; Zones live inside the same screen ---------- */
    await go(page,'suppliers');
    assert.match(await page.locator('.page-heading h1').innerText(),/Suppliers/,'the Suppliers tab keeps its name');
    await page.locator('#supAddBtn').click();
    await page.waitForSelector('#mfName');
    await page.fill('#mfName','New Supplier');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('#mfName'));
    assert.equal(await page.evaluate(()=>state.suppliers.some(s=>s.name==='New Supplier')),true,'supplier saved');
    await page.locator('[data-supview="zones"]').click();
    assert.equal(await page.locator('[data-zedit]').count(),3,'zones are listed');
    await page.locator('#zoneAddBtn').click();await page.fill('#zName','Bakery');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-zedit]').length===4);
    assert.equal(calls.filter(c=>c.ep==='zones/add').pop().body.name,'Bakery');
    await page.locator('[data-zedit="Pizza"]').click();await page.fill('#zName','Pizza Oven');await page.locator('#modalFormOk').click();
    await page.waitForSelector('[data-zedit="Pizza Oven"]');
    assert.deepEqual(calls.filter(c=>c.ep==='zones/rename').pop().body,{from:'Pizza',to:'Pizza Oven'});
    await page.locator('[data-zdel="Minibar"]').click();await page.locator('#modalOkBtn').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-zedit]').length===3);
    assert.equal(calls.filter(c=>c.ep==='zones/delete').pop().body.name,'Minibar');
    await page.locator('[data-supview="suppliers"]').click();
    assert.ok(await page.locator('#supAddBtn').isVisible(),'back to suppliers');

    /* ---------- Every Add button opens its form (a broken one would throw) ---------- */
    for(const v of ['suppliers','units','itemsAdmin']){
      await go(page,v);
      if(v==='suppliers'&&await page.locator('[data-supview="suppliers"].active').count()===0) await page.locator('[data-supview="suppliers"]').click();
      await page.locator('.add-btn').first().click();
      await page.waitForSelector('#modalFormCancel',{timeout:4000});
      await page.locator('#modalFormCancel').click();
      await page.waitForFunction(()=>!document.querySelector('#modalFormCancel'));
    }

    /* ---------- Receipts: entered on the phone, filled in by the PC, accepted at the PC ---------- */
    await go(page,'receipts');
    await page.waitForSelector('.rc-card');
    assert.equal(await page.locator('.rc-card').count(),3,'recent receipts are listed');
    assert.match(await page.locator('.rc-card').first().innerText(),/Ready on the PC[\s\S]*final approval/,'a filled-in receipt waits for the final approval');
    assert.equal(await page.locator('[data-rccancel="r2"]').count(),1,'a waiting receipt can be cancelled');
    assert.equal(await page.locator('[data-rccancel="r1"]').count(),1,'a filled-in receipt can be cancelled before the final approval');
    await page.waitForSelector('.rc-card .tr-shot img');   // its screenshot loads by itself
    assert.equal(await page.locator('[data-rcfinal="r1"]').isDisabled(),true,'no final approval while the PC is in test mode for receipts');
    assert.match(await page.locator('.rc-card').first().innerText(),/test mode/i);
    await page.evaluate(()=>{stockState.control={...stockState.control,workerOnline:true,workerLive:true,workerReceiptsLive:true,workerPageReady:true};document.getElementById('rcList').dataset.sig='';rcPaintList();});
    assert.equal(await page.locator('[data-rcfinal="r1"]').isEnabled(),true,'final approval once the PC can save receipts');
    await page.locator('[data-rcfinal="r1"]').click();
    assert.match(await page.locator('.modal-box').innerText(),/777[\s\S]*Coca Cola[\s\S]*IQD 10,000[\s\S]*presses Receive & send to finance once/,'the final confirmation lists the receipt');
    await page.locator('#modalOkBtn').click();await page.waitForTimeout(300);
    assert.equal(calls.filter(c=>c.ep==='receipts/final-approve').pop()?.body.id,'r1');
    // A receipt that needs checking: a person says whether it was saved, with a note.
    await page.locator('[data-rcresolve="r4"]').click();
    await page.selectOption('#rcsSaved','no');await page.fill('#rcsNote','short');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>document.querySelector('#modalFormStatus').textContent.trim().length>0);
    await page.fill('#rcsNote','Checked the workplace list: invoice 779 is not there');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('#rcsNote'));
    assert.deepEqual(calls.filter(c=>c.ep==='receipts/resolve').pop()?.body,{id:'r4',saved:false,note:'Checked the workplace list: invoice 779 is not there'});
    await page.locator('#rcSend').click();
    assert.equal(await page.locator('.modal-box').count(),0,'an incomplete receipt is not sent');
    assert.equal(await page.getAttribute('#rcInv','inputmode'),'numeric','the invoice opens the number pad');
    await page.locator('#rcInvKb').click();
    assert.equal(await page.getAttribute('#rcInv','inputmode'),'text','ABC switches the invoice to letters');
    await page.selectOption('#rcSup','s0');await page.fill('#rcInv','INV-55');
    await page.locator('[data-chipfor="rcCur"] [data-val="USD $"]').click();await page.fill('#rcRate','1,500');
    assert.equal(await page.getAttribute('#rcRate','inputmode'),'decimal','the dollar rate opens the number pad');
    await page.locator('[data-chipfor="rcDelPick"] [data-val="Delivery"]').click();await page.fill('#rcDelAmt','٥');
    assert.equal(await page.getAttribute('#rcDelAmt','inputmode'),'decimal','delivery opens the number pad');
    if(process.env.SHOT){await page.waitForTimeout(700);await page.locator('.rc-sec').first().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.SHOT+'/rc-top.png'});}
    await page.locator('[data-rcsearch="0"]').click();
    assert.equal(await page.locator('[data-rcresults="0"] [data-rcpick],[data-rcresults="0"] [data-rcsetup]').count(),4,'tapping the item box lists every item');
    assert.equal(await page.locator('[data-rcresults="0"] .name').first().innerText().then(x=>x.length>0),true);
    if(process.env.SHOT){await page.locator('[data-rcresults="0"]').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.SHOT+'/rc-list.png'});}
    await page.fill('[data-rcsearch="0"]','coca');await page.locator('[data-rcpick="0"][data-id="i1"]').click();
    await page.fill('[data-rcqty="0"]','10');await page.fill('[data-rccost="0"]','10');
    await page.locator('#rcAddLine').click();
    await page.fill('[data-rcsearch="1"]','flour');await page.locator('[data-rcpick="1"][data-id="i2"]').click();
    await page.selectOption('[data-rcunitsel="1"]','counting');
    assert.equal(await page.getAttribute('[data-rcqty="1"]','inputmode'),'decimal','quantities open the number pad');
    await page.fill('[data-rcqty="1"]','24');await page.fill('[data-rccost="1"]','0.5');
    assert.equal(await page.locator('#rcTotal').innerText(),'$ 112','the total adds up the lines');
    if(process.env.SHOT){await page.locator('.rc-total').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.SHOT+'/rc0.png'});}
    await page.locator('#rcSend').click();
    assert.match(await page.locator('.modal-box').innerText(),/INV-55[\s\S]*Coca Cola[\s\S]*Flour[\s\S]*\$ 112/,'the confirmation lists the whole receipt');
    await page.locator('#modalOkBtn').click();await page.waitForTimeout(400);
    const rec=calls.filter(c=>c.ep==='receipts'&&c.method==='POST').pop();
    assert.deepEqual({s:rec.body.supplierId,i:rec.body.invoice,c:rec.body.currency,r:rec.body.rate,d:rec.body.delivery,l:rec.body.lines.map(l=>[l.itemId,l.unitId,l.qty,l.cost])},
      {s:'s0',i:'INV-55',c:'USD',r:1500,d:5,l:[['i1','ctn',10,10],['i2','pc',24,0.5]]});
    if(process.env.SHOT){await page.screenshot({path:process.env.SHOT+'/rc.png'});}
    assert.equal(await page.inputValue('#rcInv'),'','the form clears after sending');

    /* ---------- Count many items with one PIN ---------- */
    await go(page,'stock');
    await page.locator('#stCountAll').click();
    await page.waitForSelector('[data-bcitem]');
    assert.equal(await page.locator('[data-bcitem]').count(),3,'every set-up item is listed');
    await page.fill('[data-bcitem="i1"]','4');await page.fill('[data-bcitem="i2"]','30');
    await page.fill('#bcSearch','milk');await page.fill('[data-bcitem="i3"]','9');await page.fill('#bcSearch','');
    assert.equal(await page.locator('[data-bcitem="i1"]').inputValue(),'4','typed amounts survive searching');
    await page.fill('#bcPin','000000');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>/PIN/i.test(document.querySelector('#modalFormStatus').textContent));
    await page.fill('#bcPin','123456');await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('#bcList'));
    const bulk=calls.filter(c=>c.ep==='counts-bulk').pop();
    assert.equal(bulk.body.pin,'123456');assert.deepEqual(bulk.body.lines.map(l=>l.itemId+':'+l.quantity).sort(),['i1:4','i2:30','i3:9']);

    /* ---------- Item form: a supplier is required for a new item ---------- */
    await go(page,'itemsAdmin');
    await page.locator('#itemAddBtn').click();
    await page.fill('#mfName','Test item');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>document.querySelector('#modalFormStatus').textContent.trim().length>0);
    assert.equal(await page.evaluate(()=>state.items.some(i=>i.name==='Test item')),false,'not saved without a supplier');
    await page.locator('#modalFormCancel').click();
    await page.waitForFunction(()=>!document.querySelector('#mfName'));

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
    await page.fill('#mfPer','6');await page.fill('#mfLow','3');await page.fill('#mfWork','Tomato WP');
    await page.selectOption('#mfUsage','box');assert.equal(await page.locator('#mfPerUsageBox').isVisible(),true,'recipe unit different from counting asks how many');await page.fill('#mfPerUsage','0.5');
    assert.match(await page.locator('#mfPerSummary').innerText(),/1 .* = 6 /);
    await page.selectOption('#mfCounting','box');
    assert.equal(await page.locator('#mfPerBox').isVisible(),false,'same unit hides the conversion again');
    await page.selectOption('#mfCounting','pc');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('#mfName'));
    const settings=calls.filter(c=>c.ep.startsWith('settings/')).pop();
    assert.deepEqual({ep:settings.ep,c:settings.body.countingUnit,p:settings.body.perBuying,l:settings.body.lowStock,w:settings.body.workplaceName,u:settings.body.usageUnit,pu:settings.body.perCountingUsage},{ep:'settings/i0',c:'pc',p:'6',l:'3',w:'Tomato WP',u:'box',pu:'0.5'});
    // Items screen: the PC's task list, and creating an item in the workplace from its saved setup.
    await page.waitForSelector('#ijList .rc-card');
    assert.match(await page.locator('#ijList').innerText(),/Tasks on the PC[\s\S]*Flour WP[\s\S]*Update in the workplace/,'item tasks are listed');
    await page.waitForSelector('#ijList .tr-shot img');
    assert.equal(await page.locator('[data-ijfinal="j1"]').isDisabled(),true,'no final approval while the PC is in test mode for items');
    await page.locator('[data-itfilter="all"]').click();await page.locator('[data-edititem="i2"]').click();
    await page.locator('[data-wpjob="create"]').click();
    assert.match(await page.locator('.modal-box').last().innerText(),/Flour[\s\S]*piece[\s\S]*box/,'the confirmation shows what the PC will fill in');
    await page.locator('#modalOkBtn').click();await page.waitForTimeout(300);
    assert.deepEqual((({itemId,kind})=>({itemId,kind}))(calls.filter(c=>c.ep==='itemjobs'&&c.method==='POST').pop().body),{itemId:'i2',kind:'create'});
    await page.locator('#modalFormCancel').click().catch(()=>{});await page.waitForFunction(()=>!document.querySelector('#mfName'));

    /* ---------- History filters ---------- */
    await go(page,'history');
    assert.equal(await page.locator('.hist-card').count()>=4,true,'orders, transfers and counts are listed together');
    // Filter rows have the glass lens: hold and slide, and the pill under the finger opens on release.
    await page.waitForSelector('.seg-lens');
    const bx=await page.locator('[data-histfilter="all"]').boundingBox(), tx=await page.locator('[data-histfilter="transfers"]').boundingBox();
    await page.mouse.move(bx.x+bx.width/2,bx.y+bx.height/2);await page.mouse.down();await page.mouse.move(tx.x+tx.width/2,tx.y+tx.height/2,{steps:8});
    assert.equal(await page.locator('.record-filters.held').count(),1,'holding and sliding lifts the lens');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-histfilter="transfers"].active').count(),1,'pages open while the lens slides, before the finger lifts');
    if(process.env.SHOT)await page.screenshot({path:process.env.SHOT+'/lens.png'});
    await page.mouse.up();await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-histfilter="transfers"].active').count(),1,'the pill under the finger opens');
    assert.equal(await page.locator('.record-filters.held').count(),0);
    await page.locator('[data-histfilter="all"]').click();
    // A quick flick that lifts before the screen has changed still lands on the pill it ended over.
    assert.equal(await page.locator('.record-filters').evaluate(el=>getComputedStyle(el).touchAction),'none','the finger owns the gesture from the first touch');
    const fx=await page.locator('[data-histfilter="all"]').boundingBox(), fy=await page.locator('[data-histfilter="counts"]').boundingBox();
    await page.mouse.move(fx.x+fx.width/2,fx.y+fx.height/2);await page.mouse.down();await page.mouse.move(fy.x+fy.width/2,fy.y+fy.height/2);await page.mouse.up();await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-histfilter="counts"].active').count(),1,'a quick flick opens the pill it ends on');
    await page.locator('[data-histfilter="all"]').click();
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

    /* ---------- PC width: every storage is visible and the arrows scroll them ---------- */
    ({ctx,page}=await open({width:1400}));
    await go(page,'stock');
    const pills=await page.locator('#stTabs .tab-pill').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().width)));
    assert.equal(pills.length,4);assert.ok(pills.every(w=>w>60),'storage tabs are readable on a PC '+pills);
    assert.equal(await page.locator('#stTabsNext').isVisible(),true,'scroll arrows exist on a PC');
    await ctx.close();

    /* ---------- Item groups on the Stock screen ---------- */
    ({ctx,page,calls}=await open());
    await go(page,'stock');
    await page.locator('[data-stgroup="g1"]').click();
    assert.deepEqual(await page.locator('#stList .name').allTextContents(),['Coca Cola','Milk'],'a group filters the list');
    await page.locator('[data-stgroup=""]').click();
    assert.equal(await page.locator('#stList .name').count(),4,'All items shows everything again');
    await page.locator('#stGroupsManage').click();
    await page.locator('#modalFormOk').click();
    await page.waitForSelector('#gmName');
    await page.locator('#gmName').fill('Baking');
    await page.locator('#gmList input[value="i2"]').check();
    await page.locator('#gmSearch').fill('mil');
    await page.locator('#gmList input[value="i3"]').check();
    await page.locator('#gmSearch').fill('');
    assert.equal(await page.locator('#gmList input[value="i2"]').isChecked(),true,'choices survive a search');
    await page.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.getElementById('gmName'));
    assert.deepEqual(calls.filter(c=>c.ep==='groups/save').pop().body,{id:null,name:'Baking',itemIds:['i2','i3']});
    assert.deepEqual(await page.locator('#stList .name').allTextContents(),['Flour','Milk'],'the new group is selected');
    // Delete it again from the editor
    await page.locator('#stGroupsManage').click();
    await page.locator('[data-gmedit="g2"]').click();
    await page.waitForSelector('#gmDelete');
    await page.locator('#gmDelete').click();
    await page.locator('#modalOkBtn').click();
    await page.waitForFunction(()=>!document.querySelector('[data-stgroup="g2"]'));
    assert.equal(calls.filter(c=>c.ep==='groups/delete').pop().body.id,'g2');
    /* Rico's stock cards: a group, a low-stock change and an "open filtered" button */
    await page.locator('#stAskRico').click();
    await page.waitForSelector('#ricoInput');
    await page.locator('#ricoInput').fill('make a veggies filter');
    await page.locator('#ricoSendBtn').click();
    await page.waitForSelector('[data-rico-apply="1|p1"]');
    if(process.env.SHOT){await page.screenshot({path:process.env.SHOT+'/rico-stock.png'});}
    await page.locator('[data-rico-apply="1|p1"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-card="p1"]')?.classList.contains('applied'));
    assert.deepEqual(calls.filter(c=>c.ep==='groups/save').pop().body,{id:null,name:'Veggies',itemIds:['i0']});
    await page.locator('[data-rico-apply="1|p2"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-card="p2"]')?.classList.contains('applied'));
    assert.deepEqual(calls.filter(c=>c.ep==='settings/i1').pop().body,{countingUnit:'ctn',perBuying:null,lowStock:4,workplaceName:'Coca-Cola 330'},'only the low stock level changes');
    await page.locator('[data-rico-stock="1|p3"]').click();
    await page.waitForSelector('#stList');
    assert.equal(await page.locator('#stSearch').inputValue(),'cola');
    assert.deepEqual(await page.locator('#stList .name').allTextContents(),['Coca Cola'],'Rico opens the Stock screen filtered');
    assert.equal(await page.locator('#stTabs .tab-pill.active').textContent().then(x=>x.startsWith('Main Storage')),true);
    await ctx.close();

    /* ---------- Yunis has the same screens ---------- */
    ({ctx,page}=await open({account:'yunis'}));
    for(const v of ['transfers','stock']) assert.ok(await page.locator('.bottomnav [data-view="'+v+'"]').count(),'Yunis has '+v);
    await ctx.close();

    /* ---------- 3 languages, 3 widths: every new screen renders, nothing overflows ---------- */
    for(const lang of ['en','ku','ar']) for(const width of [360,390,1024]){
      ({ctx,page}=await open({lang,width}));
      for(const view of ['transfers','stock','receipts','itemsAdmin','history']){
        await go(page,view);
        const sizes=await page.evaluate(()=>({v:innerWidth,d:document.documentElement.scrollWidth}));
        assert.ok(sizes.d<=sizes.v+1,`${lang} ${width} ${view} overflows ${JSON.stringify(sizes)}`);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.dir),lang==='en'?'ltr':'rtl');
      await ctx.close();
    }
    assert.deepEqual(errors.filter(e=>!/pushManager/.test(e)),[],'no page errors');
    console.log(JSON.stringify({result:'PASS',checks:'transfer flow and approval, final-approve gating, cancel, needs-checking alert, stock filters, item groups, Rico stock cards, recount PIN, item formats and conversion, history filters, both accounts, 3 languages at 3 widths'}));
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
