/* Browser checks for what Rozha kept from PR #127 (2026-10-24): favourites inside each supplier,
   Undo after deleting an item, remembered places per screen and per supplier tab, the Health Check,
   and Rico's reviewed order cards. Also checks that the removed parts stay gone (supplier
   instructions, warnings before sending, the desktop summary). All API calls are local fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'ricotta-kept-'));
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const now=new Date().toISOString(),before=new Date(Date.now()-2*86400000).toISOString(),calls=[],receipts=new Map();let cart={},revision=0;
 const filler=Array.from({length:40},(_,n)=>({id:'f'+n,name:'Bread '+String(n).padStart(2,'0'),unit:'kg',supplierId:'b'}));
 const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],
  suppliers:[{id:'s',name:'Vegetables',phone:'07501234567'},{id:'b',name:'Bakery',phone:''}],units:[{id:'kg',en:'kg',ku:'کیلۆ',ar:'كيلو'}],
  items:[{id:'tom',name:'Tomatoes',unit:'kg',supplierId:'s',aliases:['tomato']},{id:'dup',name:'Tomato',unit:'kg',supplierId:'s'},...filler],
  pins:['tom'],history:[{id:'h1',date:before,by:'rozha',entries:[{supplierId:'s',items:[{itemId:'tom',name:'Tomatoes',unit:'kg',qty:2}]}]}],devices:[],activity:[],inbox:[]};
 await ctx.addInitScript(()=>{localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'kept-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang','"en"');localStorage.setItem('ricottaOrders:aiConsent:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));});
 await ctx.route('**/functions/v1/api/**',async route=>{const req=route.request(),endpoint=new URL(req.url()).pathname.split('/api/')[1],method=req.method(),body=method==='GET'?null:req.postDataJSON();calls.push({endpoint,method,body});let data={ok:true};
  if(endpoint==='bootstrap')data={...fixture,draft:{cart,revision}};
  else if(endpoint==='draft'){if(method==='PUT'){for(const c of body.changes){if(c.after)cart[c.itemId]=c.after;else delete cart[c.itemId];}revision++;}data={cart:{...cart},revision,conflicts:[]};}
  else if(endpoint==='auth/security')data={required:false};
  else if(endpoint==='devices'||endpoint==='activity'||endpoint==='assistant/inbox')data=[];
  else if(endpoint==='assistant/status')data={configured:true,provider:'gemini'};
  else if(endpoint==='items/restore'){const item=receipts.get(body.undoId);assert.ok(item);fixture.items.push(item);receipts.delete(body.undoId);}
  else if(endpoint.startsWith('items/')&&method==='DELETE'){const id=endpoint.split('/')[1],item=fixture.items.find(i=>i.id===id);assert.ok(item);const token='12345678-1234-1234-1234-123456789abc';receipts.set(token,item);fixture.items=fixture.items.filter(i=>i.id!==id);data={ok:true,undoId:token};}
  else if(endpoint==='admin/diagnostics')data={database:true,checkedAt:now,jobs:['ricotta-reminder-tick','ricotta-monthly-history','ricotta-daily-cleanup','ricotta-cron-history'].map(name=>({name,active:true,lastRun:now,lastStatus:'succeeded',failures24h:0}))};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});
 const view=async name=>{await page.evaluate(v=>goView(v),name);await page.waitForFunction(v=>document.getElementById('app').dataset.screen===v && !document.querySelector('.content.gliding'),name);};
 const top=()=>page.evaluate(()=>scrollBox().scrollTop);
 // Tapped in the page itself: Playwright would first scroll the tab into view and move the place being remembered.
 const tab=id=>page.evaluate(id=>document.querySelector(`[data-ordertab="${id}"]`).click(),id);

 // The saved design: supplier tabs above the search, no desktop summary, no warnings or instructions.
 assert.equal(await page.evaluate(()=>!!(document.querySelector('.order-tabs-shell').compareDocumentPosition(document.querySelector('.search-row'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'supplier tabs sit above the search');
 assert.equal(await page.locator('.order-workspace,.desktop-order-summary,.supplier-instructions,#duplicateReviewBtn').count(),0,'removed parts stay gone');

 // Favourites lead each supplier's tab, without a second quantity control.
 await page.locator('[data-ordertab="s"]').click();
 assert.equal(await page.locator('.pinned-group [data-item-id="tom"]').count(),1,'the favourite appears inside its supplier');
 assert.equal(await page.locator('#orderResults [data-item-id="tom"]').count(),1,'and only once');
 await page.locator('[data-ordertab="all"]').click();
 assert.equal(await page.locator('#orderResults [data-item-id="tom"]').count(),1,'only once in All too');

 // Each supplier tab and each screen keeps its place.
 await page.evaluate(()=>{scrollBox().scrollTop=900;});const allTop=await top();assert.ok(allTop>500);
 await tab('b');await page.evaluate(()=>{scrollBox().scrollTop=300;});const bakeryTop=await top();
 await tab('all');assert.ok(Math.abs(await top()-allTop)<2,'All comes back to where it was');
 await tab('b');assert.ok(Math.abs(await top()-bakeryTop)<2,'Bakery comes back to where it was');
 await view('history');await view('order');assert.ok(Math.abs(await top()-bakeryTop)<2,'the Order screen keeps its place across screens');
 await view('manage');await page.locator('#catalogSearch').fill('Bread 3');await view('history');await view('manage');
 assert.equal(await page.locator('#catalogSearch').inputValue(),'Bread 3','a screen keeps its search');
 await page.locator('#catalogSearch').fill('');await page.locator('#catalogSearch').dispatchEvent('input');

 // Sending goes straight to the suppliers, even for a big amount.
 await view('order');await page.evaluate(()=>{state.cart={tom:20};refreshOrderView();});
 await page.locator('#sendOrdersBtn').click();await page.locator('.queue-card').waitFor();
 assert.equal(await page.locator('.modal-overlay').count(),0,'no warning popup before sending');
 await page.evaluate(()=>{state.queue=null;state.cart={};persistQueue();persistCartDraft();});

 // Deleting an item asks first, then offers Undo, which brings it back.
 await view('manage');await page.locator('[data-delitem="dup"]').click();await page.locator('#modalOkBtn').click();
 await page.waitForSelector('[data-edititem="dup"]',{state:'detached'});
 assert.match(await page.locator('#toast').textContent(),/Tomato deleted/);
 await page.locator('#toast .toast-undo').click();await page.locator('[data-edititem="dup"]').waitFor();
 assert.equal(receipts.size,0,'Undo uses the server copy');

 // The Health Check runs by itself when Admin opens.
 await page.waitForFunction(()=>!sharedDraft.enabled || (!sharedDraft.busy && !draftChanges(sharedDraft.base,state.cart).length));
 await view('admin');await page.waitForFunction(()=>document.querySelectorAll('.diagnostic-row').length>=7);
 assert.match(await page.locator('#diagnosticsSlot').textContent(),/Working/);
 assert.equal(await page.locator('.diagnostic-row .good').count()>=6,true,'healthy rows show a green dot');
 assert.equal(await page.locator('#diagnosticsRetry').count(),0,'Retry Saving shows only when something is waiting');

 // Rico in the top bar: his spark (no face); his order cards show before and after.
 assert.equal(await page.locator('#ricoTopBtn .rico-bot').count(),0);assert.equal(await page.locator('#ricoTopBtn svg').count(),1);
 await page.evaluate(()=>{state.cart={};rico.messages=[{role:'assistant',text:'Review these quantities.',proposals:[{id:'proposal',kind:'order',mode:'add',status:'pending',draftBefore:{},lines:[{itemId:'tom',qty:3}]}]}];});
 await page.locator('#ricoTopBtn').click();await page.waitForFunction(()=>document.getElementById('app').dataset.screen==='assistant');
 assert.equal(await page.locator('#ricoTopBtn.active').count(),1,'Rico lights up while his screen is open');
 await page.evaluate(()=>{state.cart={tom:2};});await page.locator('[data-rico-apply]').click();
 assert.equal(await page.evaluate(()=>state.cart.tom),2,'a changed order needs a fresh look first');
 assert.match(await page.locator('.rico-quantity-change').textContent(),/2→5/);
 await page.locator('[data-rico-apply]').click();assert.equal(await page.evaluate(()=>state.cart.tom),5);
 await page.evaluate(()=>{state.cart.f1=4;});await page.locator('[data-rico-undo]').click();
 assert.equal(await page.evaluate(()=>state.cart.tom),2);assert.equal(await page.evaluate(()=>state.cart.f1),4,'Undo keeps edits made afterwards');
 await page.evaluate(()=>{state.cart={tom:99999};rico.messages=[{role:'assistant',text:'Check.',proposals:[{id:'limit',kind:'order',mode:'add',status:'pending',draftBefore:{tom:99999},lines:[{itemId:'tom',qty:1}]}]}];render();});
 assert.equal(await page.locator('[data-rico-apply]').count(),0);assert.match(await page.locator('.rico-card').textContent(),/99,999/);

 await page.screenshot({path:path.join(out,'kept-features.png')});assert.deepEqual(errors,[]);await ctx.close();
 console.log(JSON.stringify({result:'PASS',checks:'saved design, favourites per supplier, remembered places per tab and screen, no send warnings, item delete Undo, Health Check, Rico spark button, reviewed Rico cards',artifacts:out}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
