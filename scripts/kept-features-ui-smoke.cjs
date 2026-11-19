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
 await ctx.addInitScript(()=>{localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:xtSeen:rozha','true');localStorage.setItem('ricottaOrders:ricoBriefing:rozha',JSON.stringify(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())));localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'kept-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang','"en"');localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));});
 await ctx.route('**/functions/v1/api/**',async route=>{const req=route.request(),endpoint=new URL(req.url()).pathname.split('/api/')[1],method=req.method(),body=method==='GET'?null:req.postDataJSON();calls.push({endpoint,method,body});let data={ok:true};
  if(endpoint==='bootstrap')data={...fixture,draft:{cart,revision}};
  else if(endpoint==='draft'){if(method==='PUT'){for(const c of body.changes){if(c.after)cart[c.itemId]=c.after;else delete cart[c.itemId];}revision++;}data={cart:{...cart},revision,conflicts:[]};}
  else if(endpoint==='auth/security')data={required:false};
  else if(endpoint==='rico-chats')data={chats:fixture.chats||[]};
  else if(endpoint.startsWith('rico-chats/')&&method==='DELETE'){fixture.chats=(fixture.chats||[]).filter(c=>c.id!==endpoint.split('/')[1]);}
  else if(endpoint==='devices'||endpoint==='activity'||endpoint==='assistant/inbox')data=[];
  else if(endpoint==='items/restore'){const item=receipts.get(body.undoId);assert.ok(item);fixture.items.push(item);receipts.delete(body.undoId);}
  else if(endpoint.startsWith('items/')&&method==='DELETE'){const id=endpoint.split('/')[1],item=fixture.items.find(i=>i.id===id);assert.ok(item);const token='12345678-1234-1234-1234-123456789abc';receipts.set(token,item);fixture.items=fixture.items.filter(i=>i.id!==id);data={ok:true,undoId:token};}
  else if(endpoint==='admin/diagnostics')data={database:true,checkedAt:now,latencyMs:140,items:42,suppliers:2,ordersThisMonth:1,pushPhones:2,problems24h:0,wrongPins24h:0,jobs:['ricotta-reminder-tick','ricotta-monthly-history','ricotta-daily-cleanup','ricotta-cron-history'].map(name=>({name,active:true,lastRun:now,lastStatus:'succeeded',failures24h:0}))};
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
 // A long page that slides away keeps only what is near the screen laid out (the rest keeps its size), so
 // leaving it does not hold up the tap; what is on screen is drawn in full.
 await tab('all');await page.evaluate(()=>{scrollBox().scrollTop=0;});
 const ghost=await page.evaluate(()=>{const rows=document.querySelectorAll('.content .item-row').length;goView('history');const g=document.querySelector('.page-ghost');
  const far=[...g.querySelectorAll('.ghost-far')],near=[...g.querySelectorAll('.item-row:not(.ghost-far)')];
  return {rows,far:far.length,farHidden:far.every(el=>getComputedStyle(el).contentVisibility==='hidden'&&parseFloat(el.style.height)>0),
   nearOnScreen:near.some(el=>{const b=el.getBoundingClientRect();return b.top<innerHeight&&b.bottom>0;}),firstNear:!!g.querySelector('.item-row')&&!g.querySelector('.item-row').classList.contains('ghost-far')};});
 assert.ok(ghost.rows>=30&&ghost.far>0&&ghost.farHidden,'rows far off screen skip their insides: '+JSON.stringify(ghost));
 assert.ok(ghost.nearOnScreen&&ghost.firstNear,'rows on screen are drawn: '+JSON.stringify(ghost));
 await page.waitForFunction(()=>!document.querySelector('.page-ghost'));
 await view('order');await tab('b');
 await view('manage');await page.locator('#catalogSearch').fill('Bread 3');await view('history');await view('manage');
 assert.equal(await page.locator('#catalogSearch').inputValue(),'Bread 3','a screen keeps its search');
 await page.locator('#catalogSearch').fill('');await page.locator('#catalogSearch').dispatchEvent('input');

 // Sending goes straight to the suppliers, even for a big amount.
 await view('order');await page.evaluate(()=>{state.cart={tom:20};refreshOrderView();});
 await page.locator('#sendOrdersBtn').click();await page.locator('.queue-card').waitFor();
 assert.equal(await page.locator('.modal-overlay').count(),0,'no warning popup before sending');
 await page.evaluate(()=>{state.queue=null;state.cart={};persistQueue();persistCartDraft();});

 // Deleting an item (from its details) asks first, then offers Undo, which brings it back.
 await view('manage');await page.locator('.plain-list [data-edititem="dup"]').click();
 await page.locator('[data-detail="delete"]').click();await page.locator('#modalOkBtn').click();
 await page.waitForSelector('[data-edititem="dup"]',{state:'detached'});
 assert.match(await page.locator('#toast').textContent(),/Tomato deleted/);
 await page.locator('#toast .toast-undo').click();await page.locator('.plain-list [data-edititem="dup"]').waitFor();
 assert.equal(receipts.size,0,'Undo uses the server copy');

 // The Health Check runs by itself when Admin opens, and its page says in plain words what works.
 await page.waitForFunction(()=>!sharedDraft.enabled || (!sharedDraft.busy && !draftChanges(sharedDraft.base,state.cart).length));
 await view('admin');await page.waitForFunction(()=>!!adminValue('health') && !!document.querySelector('.adh-list [data-admin-open="health"]') && !document.querySelector('.adh-list [data-admin-open="health"] .adh-val'));
 await page.locator('.adh-list [data-admin-open="health"]').click();await page.waitForFunction(()=>document.querySelectorAll('.ad-health').length>=10);
 assert.match(await page.locator('.ad-status').textContent(),/Everything is working/);
 assert.equal(await page.locator('.ad-health.bad, .ad-health.warn').count(),0,'every row is green');
 assert.deepEqual(await page.locator('.ad-stats b').allTextContents(),['42','2','1'],'counts come from the database');
 assert.equal(await page.locator('[data-health-retry]').count(),0,'Retry Saving shows only when something is waiting');

 // Rico in the top bar: his spark (no face); his order cards show before and after.
 assert.equal(await page.locator('#ricoTopBtn .rico-bot').count(),1);assert.equal(await page.locator('#ricoTopBtn svg').count(),1);
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

 // F24: a 160-letter item name with no spaces wraps inside its column in the PDF (it used to paint across the page).
 const pdfCheck=await page.evaluate(async()=>{
   const proto=CanvasRenderingContext2D.prototype,orig=proto.fillText,drawn=[];
   proto.fillText=function(t,x,y){const w=this.measureText(String(t)).width;drawn.push({t:String(t),w});return orig.apply(this,arguments);};
   try{
     const long='Tomatoesextralongnamewithoutanyspaces'.repeat(5).slice(0,160);
     const blob=await brandedPdf({title:'Test',stamp:'now',info:[],sections:[{heading:'Items',columns:[{label:'Item',w:3},{label:'Qty',w:1,align:'end'}],rows:[[long,'5 kg'],['تەماتە'.repeat(30),'2']]}]});
     return {size:blob.size,widest:Math.max(...drawn.filter(d=>/Tomatoes|تەماتە/.test(d.t)).map(d=>d.w)),pieces:drawn.filter(d=>/Tomatoes/.test(d.t)).length};
   }finally{proto.fillText=orig;}
 });
 assert.ok(pdfCheck.size>1000,'a PDF is made');
 assert.ok(pdfCheck.pieces>=2,'the long name is split into lines');
 assert.ok(pdfCheck.widest<=(595.28-80)*3/4,'no line is wider than its column');
 // Deleting a chat from Rico's side menu on a phone: no question, it is gone at once and the menu closes
 // first (a stray tap can't land on something under it). Undo brings it back; the server is only told
 // once the Undo time is over.
 fixture.chats=[{id:'c1',title:'Bread for Friday',account:'rozha',updatedAt:now},{id:'c2',title:'Cheese stock',account:'rozha',updatedAt:before}];
 await view('assistant');await page.evaluate(()=>ricoLoadChats());await page.waitForFunction(()=>rico.chats?.length===2);
 const deleteFromDrawer=async id=>{await page.evaluate(()=>ricoOpenDrawer());await page.locator(`#ricoDrawer [data-side-open="${id}"]`).waitFor();
  await page.locator(`#ricoDrawer [data-side-open="${id}"]`).dispatchEvent('contextmenu');await page.locator('#ctxLayer [data-ctx="delete"]').click();};
 await deleteFromDrawer('c1');
 assert.equal(await page.locator('.modal-overlay').count(),0,'no question before deleting');
 assert.deepEqual(await page.evaluate(()=>rico.chats.map(c=>c.id)),['c2'],'the chat is gone at once');
 await page.waitForSelector('#ricoDrawer',{state:'detached'});
 await page.locator('#toast.show .toast-undo').waitFor();
 await page.locator('#toast.show .toast-undo').click();
 assert.deepEqual(await page.evaluate(()=>rico.chats.map(c=>c.id)),['c1','c2'],'Undo puts it back in its place');
 await page.waitForTimeout(5300);
 assert.equal(calls.filter(c=>c.endpoint==='rico-chats/c1'&&c.method==='DELETE').length,0,'after Undo nothing is deleted');
 await deleteFromDrawer('c1');
 assert.equal(calls.filter(c=>c.endpoint==='rico-chats/c1'&&c.method==='DELETE').length,0,'the server waits while Undo shows');
 await page.waitForTimeout(5300);
 assert.equal(calls.filter(c=>c.endpoint==='rico-chats/c1'&&c.method==='DELETE').length,1,'then it is deleted for good');
 await page.evaluate(()=>ricoLoadChats());await page.waitForFunction(()=>rico.chats?.length===1);
 assert.deepEqual(await page.evaluate(()=>rico.chats.map(c=>c.id)),['c2']);
 // A short switch to another app keeps the Undo: nothing is sent while away, and coming back in time shows
 // Undo again, which still works. Letting the time run out deletes it on the server exactly once.
 const seen=async state=>page.evaluate(v=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>v});Object.defineProperty(document,'hidden',{configurable:true,get:()=>v==='hidden'});document.dispatchEvent(new Event('visibilitychange'));},state);
 const dels=id=>calls.filter(c=>c.endpoint==='rico-chats/'+id&&c.method==='DELETE').length;
 fixture.chats=[{id:'c3',title:'Milk',account:'rozha',updatedAt:now},{id:'c2',title:'Cheese stock',account:'rozha',updatedAt:before}];
 await page.evaluate(()=>ricoLoadChats());await page.waitForFunction(()=>rico.chats?.length===2);
 await deleteFromDrawer('c3');await page.waitForSelector('#ricoDrawer',{state:'detached'});
 await seen('hidden');await page.waitForTimeout(1200);
 assert.equal(dels('c3'),0,'going to the background does not delete it');
 await seen('visible');await page.locator('#toast.show .toast-undo').waitFor();
 await page.locator('#toast.show .toast-undo').click();
 assert.deepEqual(await page.evaluate(()=>rico.chats.map(c=>c.id)),['c3','c2'],'Undo still works after coming back in time');
 await page.waitForTimeout(5300);assert.equal(dels('c3'),0,'and nothing is deleted');
 await deleteFromDrawer('c3');await page.waitForSelector('#ricoDrawer',{state:'detached'});
 await seen('hidden');
 // The phone holds timers back in the background: the time is counted by the clock, and coming back after it sends the delete.
 await page.evaluate(()=>{clearTimeout(ricoPendingDelete.timer);ricoPendingDelete.until=Date.now()-1;});
 await seen('visible');await page.waitForFunction(()=>!ricoPendingDelete);await page.waitForTimeout(300);
 assert.equal(dels('c3'),1,'after its time the chat is deleted once');
 await seen('hidden');await seen('visible');await page.waitForTimeout(5300);
 assert.equal(dels('c3'),1,'and only once');
 // A pending delete never goes out with another session: a new sign-in (same account) drops it.
 fixture.chats=[{id:'c4',title:'Eggs',account:'rozha',updatedAt:now},{id:'c2',title:'Cheese stock',account:'rozha',updatedAt:before}];
 await page.evaluate(()=>ricoLoadChats());await page.waitForFunction(()=>rico.chats?.length===2);
 await deleteFromDrawer('c4');await page.waitForSelector('#ricoDrawer',{state:'detached'});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ricottaOrders:ricoDeleteLeft')||'null')?.id),'c4','remembered in case the app is closed');
 await page.evaluate(()=>localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'kept-fixture-2',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'})));
 await page.evaluate(()=>ricoFlushDelete());
 assert.equal(dels('c4'),0,'never deleted with a different session');
 await page.evaluate(()=>localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'kept-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'})));
 // An app closed during the Undo time: the delete is sent at the next start, with that same session.
 await page.evaluate(()=>localStorage.setItem('ricottaOrders:ricoDeleteLeft',JSON.stringify({id:'c4',account:'rozha',token:'kept-fixture'})));
 await page.evaluate(()=>ricoLoadChats());await page.waitForFunction(()=>rico.chats?.length===1);
 assert.equal(dels('c4'),1,'the left-over delete goes once at the next start');
 await page.evaluate(()=>localStorage.setItem('ricottaOrders:ricoDeleteLeft',JSON.stringify({id:'c2',account:'rozha',token:'another-session'})));
 await page.evaluate(()=>ricoLoadChats());
 assert.equal(dels('c2'),0,'a left-over from another session is dropped');
 // Rico's newer cards: two periods compared (with Excel and PDF) and a supplier's Call and WhatsApp.
 await page.evaluate(()=>{rico.messages=[{role:'assistant',text:'Compared.',ts:Date.now(),proposals:[
  {id:'cmp1',kind:'compare',preset:'this_month_vs_last_month',a:{from:'2026-11-01',to:'2026-11-18'},b:{from:'2026-10-01',to:'2026-10-18'},main:'orders',by:'item',totals:[{key:'orders',a:3,b:2,pct:50}],rows:[{name:'Tomatoes',a:5,b:2,pct:150,unit:'kg'},{name:'Basil',a:2,b:0,pct:null,unit:'bunch'}],more:0},
  {id:'k1',kind:'contact',name:'Vegetables',phone:'07501234567',message:'Early please'}]}];render();});
 const cmp=await page.locator('.rico-data[data-card="cmp1"]').innerText();
 assert.match(cmp,/This month vs last month/);assert.match(cmp,/\+150%/);assert.match(cmp,/New/);assert.match(cmp,/same days of last month/);
 assert.equal(await page.locator('.rico-data[data-card="cmp1"] [data-inv-file]').count(),2,'Excel and PDF');
 assert.equal(await page.locator('.rico-card[data-card="k1"] a[href="tel:+9647501234567"]').count(),1,'Call uses the full number');
 assert.match(await page.locator('.rico-card[data-card="k1"] a').first().getAttribute('href'),/9647501234567.*text=Early%20please/,'WhatsApp opens with the message typed in');
 // A photo goes with one message only: it shows in the box, goes in that request, and is not kept in the chat.
 await page.evaluate(()=>{rico.messages=[];render();rico.photo={data:'/9j/'+'A'.repeat(300),thumb:'data:image/jpeg;base64,/9j/AAAA'};ricoRepaintPhoto();});
 assert.equal(await page.locator('#ricoComposer .rico-photo-chip img').count(),1,'the photo waits in the message box');
 assert.equal(await page.locator('#ricoAttachBtn').count(),1);
 await page.locator('#ricoSendBtn').click();
 await page.waitForFunction(()=>!rico.streaming&&rico.messages.length===2);
 const sent=calls.filter(c=>c.endpoint==='assistant/chat').at(-1).body;
 assert.equal(sent.image,'/9j/'+'A'.repeat(300));assert.match(sent.messages.at(-1).content,/^\[photo\] What is in this photo\?/);
 assert.equal(await page.evaluate(()=>rico.photo),null,'the box is empty again');
 assert.equal(await page.locator('.rico-msg.me .rico-photo img').count(),1,'the photo shows with the message');
 assert.deepEqual(await page.evaluate(()=>Object.keys(ricoSerialize()[0]).sort()),['photo','role','text','ts'],'only that there was a photo is saved');
 // Rico's place button opens Settings at that row and lights it.
 await page.evaluate(()=>{rico.messages=[{role:'assistant',text:'It is in Settings.',ts:Date.now(),proposals:[{id:'p1',kind:'open',screen:'settings',place:'setDark'}]}];render();});
 assert.match(await page.locator('.rico-place').innerText(),/Settings, Light or Dark/);
 await page.locator('.rico-place').click();await page.waitForSelector('.dark-row.spot-flash');
 assert.equal(await page.evaluate(()=>state.view),'settings');
 await page.screenshot({path:path.join(out,'kept-features.png')});assert.deepEqual(errors,[]);await ctx.close();
 console.log(JSON.stringify({result:'PASS',checks:'long names wrap inside their PDF column, saved design, favourites per supplier, remembered places per tab and screen, no send warnings, item delete Undo, Health Check, Rico spark button, reviewed Rico cards, deleting a chat is instant with Undo, the menu closes first, compare and contact cards, a photo goes with one message, Rico\'s place button opens the setting',artifacts:out}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
