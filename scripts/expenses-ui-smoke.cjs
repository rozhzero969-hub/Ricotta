/* Browser checks for the Expenses tab (2026-11-15): Order opens on Food; the switch (or a pull down in the
   Home Screen app) goes to Expenses and back, refreshing the app each time; each tab shows only its items and
   the suppliers that have them; Expenses has the white summary card; the other tab counts what is picked
   there; a supplier's form saves what we buy from them; an item's form offers only the suppliers for its
   kind. All API calls are local fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'ricotta-expenses-'));
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{})});try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const calls=[];let cart={},revision=0,boots=0;
 const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],expenses:true,
  suppliers:[{id:'s',name:'Vegetables',phone:'07501234567',buys:'food'},{id:'c',name:'Paper Co',phone:'',buys:'expenses'},{id:'w',name:'Wholesale',phone:'',buys:'both'}],
  units:[{id:'kg',en:'kg'},{id:'pc',en:'piece'},{id:'ct',en:'carton'}],
  items:[{id:'tom',name:'Tomatoes',unit:'kg',supplierId:'s',kind:'food'},{id:'rice',name:'Rice',unit:'kg',supplierId:'w'},
   {id:'tea',name:'Tea',unit:'ct',supplierId:'c',kind:'expense'},{id:'tis',name:'Tissues',unit:'pc',supplierId:'w',kind:'expense'}],
  pins:[],history:[],devices:[],activity:[],inbox:[]};
 await ctx.addInitScript(()=>{localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:ricoBriefing:rozha',JSON.stringify(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())));localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'exp-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang','"en"');localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));});
 await ctx.route('**/functions/v1/api/**',async route=>{const req=route.request(),endpoint=new URL(req.url()).pathname.split('/api/')[1],method=req.method(),body=method==='GET'?null:req.postDataJSON();calls.push({endpoint,method,body});let data={ok:true};
  if(endpoint==='bootstrap'){boots++;data={...fixture,draft:{cart,revision}};}
  else if(endpoint==='draft'){if(method==='PUT'){for(const c of body.changes){if(c.after)cart[c.itemId]=c.after;else delete cart[c.itemId];}revision++;}data={cart:{...cart},revision,conflicts:[]};}
  else if(endpoint==='auth/security')data={required:false};
  else if(endpoint==='devices'||endpoint==='activity'||endpoint==='assistant/inbox')data=[];
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});
 const shown=()=>page.evaluate(()=>[...document.querySelectorAll('#orderResults [data-item-id]')].map(r=>r.dataset.itemId).sort());
 const tabs=()=>page.evaluate(()=>[...document.querySelectorAll('[data-ordertab]')].map(b=>b.dataset.ordertab));
 const heroBg=()=>page.evaluate(()=>getComputedStyle(document.querySelector('.order-hero')).backgroundColor);

 // Food first: only food items, only suppliers with food, the green card.
 assert.equal(await page.locator('.kind-switch .kind-pill.on').getAttribute('data-kind'),'food','Order opens on Food');
 assert.deepEqual(await shown(),['rice','tom'],'Food shows only food (an item without a kind is food)');
 assert.ok(!(await tabs()).includes('c'),'a supplier of expenses only is not in Food');
 assert.notEqual(await heroBg(),'rgb(255, 255, 255)','Food keeps the green card');
 assert.match(await page.locator('.hero-eyebrow').textContent(),/Today's order/);

 // Pick a food item, then tap Expenses: the other side counts it, and the card turns white.
 await page.evaluate(()=>{state.cart={tom:2};refreshOrderView();});
 await page.locator('.kind-switch [data-kind="expense"]').click();
 await page.waitForFunction(()=>orderKind()==='expense');
 assert.deepEqual(await shown(),['tea','tis'],'Expenses shows only expense items');
 const expTabs=await tabs();assert.ok(expTabs.includes('c')&&expTabs.includes('w')&&!expTabs.includes('s'),'only suppliers with expenses: '+expTabs);
 assert.equal(await page.locator('.order-hero.hero-expenses').count(),1);
 await page.waitForTimeout(600);assert.equal(await heroBg(),'rgb(255, 255, 255)','Expenses has the white card');
 assert.match(await page.locator('.hero-eyebrow').textContent(),/Today's expenses/);
 assert.equal(await page.locator('.kind-switch [data-kind="food"] .kind-badge').textContent(),'1','Food counts what is picked there');
 await page.evaluate(()=>{state.cart.tea=3;refreshOrderView();});
 assert.equal(await page.locator('.kind-switch [data-kind="food"] .kind-badge').textContent(),'1');
 assert.match(await page.locator('.send-meta').textContent(),/2 items/,'one Send sends both tabs');

 // In the Home Screen app, pulling down goes back to Food and refreshes the app.
 await page.evaluate(()=>{document.documentElement.classList.add('app-shell');render();});
 const before=boots;
 await page.evaluate(async()=>{
   const el=document.querySelector('.order-hero'),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+10;
   const touch=dy=>new Touch({identifier:1,target:el,clientX:x,clientY:y+dy});
   const fire=(type,dy)=>el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[touch(dy)],changedTouches:[touch(dy)]}));
   fire('touchstart',0);for(let dy=10;dy<=320;dy+=20){fire('touchmove',dy);await new Promise(r=>requestAnimationFrame(r));}
   if(!/Release for Food/.test(document.getElementById('pullLabel')?.textContent||''))throw new Error('the pull says where it goes: '+document.getElementById('pullLabel')?.textContent);
   fire('touchend',320);
 });
 await page.waitForFunction(()=>orderKind()==='food');
 await page.waitForFunction(()=>!document.getElementById('pullSpark'),null,{timeout:5000});
 for(let n=0;n<50&&boots<=before;n++)await page.waitForTimeout(100);
 assert.ok(boots>before,'the pull also refreshed the app');
 assert.deepEqual(await shown(),['rice','tom'],'back on Food');
 assert.equal(await page.locator('.kind-switch [data-kind="expense"] .kind-badge').textContent(),'1','Expenses counts the tea');
 await page.evaluate(()=>{document.documentElement.classList.remove('app-shell');state.cart={};persistCartDraft();render();});

 // A supplier's form saves what we buy from them.
 await page.evaluate(()=>openSupplierModal(null));await page.locator('#mfBuys').waitFor();
 assert.equal(await page.locator('#mfBuys [aria-checked="true"]').getAttribute('data-buys'),'food','a new supplier starts as Food');
 await page.locator('#mfName').fill('Cleaning Supplies');await page.locator('#mfBuys [data-buys="expenses"]').click();
 await page.locator('#modalOkBtn').click();await page.waitForSelector('.modal-overlay',{state:'detached'});
 const put=calls.find(c=>c.method==='PUT'&&c.endpoint.startsWith('suppliers/'));
 assert.equal(put?.body?.buys,'expenses','the supplier is saved as Expenses');
 // An edit sends only the change.
 await page.evaluate(()=>openSupplierModal('w'));await page.locator('#mfBuys').waitFor();
 await page.locator('#mfBuys [data-buys="food"]').click();
 assert.match(await page.locator('#mfBuysHint').textContent(),/1 item stays in Expenses/,'narrowing says the items stay');
 await page.locator('#modalOkBtn').click();await page.waitForSelector('.modal-overlay',{state:'detached'});
 const edit=calls.filter(c=>c.method==='PUT'&&c.endpoint==='suppliers/w').pop();
 assert.deepEqual(edit.body,{buys:'food',only:['buys']});
 await page.evaluate(()=>{state.suppliers.find(s=>s.id==='w').buys='both';});

 // An item's form offers only the suppliers for its kind, and switching the kind changes them.
 const options=()=>page.evaluate(()=>[...document.querySelectorAll('#mfSupplier option')].map(o=>o.value).filter(Boolean).sort());
 await page.evaluate(()=>openItemModal(null,{kind:'expense'}));await page.locator('#mfKind').waitFor();
 assert.match(await page.locator('.modal-title').textContent(),/Add expense/);
 const expOpts=await options();assert.ok(expOpts.includes('c')&&expOpts.includes('w')&&!expOpts.includes('s'),'expense suppliers only: '+expOpts);
 await page.locator('#mfKind [data-itemkind="food"]').click();
 const foodOpts=await options();assert.ok(foodOpts.includes('s')&&foodOpts.includes('w')&&!foodOpts.includes('c'),'food suppliers only: '+foodOpts);
 await page.locator('#mfKind [data-itemkind="expense"]').click();
 await page.locator('#mfName').fill('Paper cups');await page.locator('#mfUnit').selectOption('ct');await page.locator('#mfSupplier').selectOption('c');
 await page.locator('#modalOkBtn').click();await page.waitForSelector('.modal-overlay',{state:'detached'});
 const item=calls.find(c=>c.method==='PUT'&&c.endpoint.startsWith('items/')&&c.body?.name==='Paper cups');
 assert.equal(item?.body?.kind,'expense','the item is saved as an expense');
 assert.equal(item.body.unit,'ct','with a unit from Units');

 // Manage has its own Add expense button.
 await page.evaluate(()=>goView('itemsAdmin'));await page.locator('#itemAddExpenseBtn').waitFor();
 await page.screenshot({path:path.join(out,'expenses.png')});
 assert.deepEqual(errors,[]);await ctx.close();
 console.log(JSON.stringify({result:'PASS',checks:'Food first, switch and pull-down to Expenses and back with a refresh, items and suppliers per tab, white Expenses card, counts on the other tab, supplier buys saved, item form suppliers per kind, Add expense in Manage',artifacts:out}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
