/* Browser regression checks for Recipes fixes (2026-11-19), with fixture API calls:
   - Save keeps the editor open until the newest edit is on the server (a change typed while a slow save
     is on its way is saved too), and the version check still refuses an old copy.
   - Remove takes away its own line once: a double tap, and two lines removed quickly.
   - Amounts keep their fraction (0,125 / 0.125 / ٠٫١٢٥ are 0.125 after reopening); prices still group
     thousands (4,500 / ٤٬٥٠٠ are 4500).
   - A photo order the server refuses puts back both the gallery and the list's cover. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
const wait=async(fn,what,ms=8000)=>{const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw new Error('timed out: '+what);await new Promise(r=>setTimeout(r,25));}};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const egg='00000000-0000-4000-8000-000000000001',flour='00000000-0000-4000-8000-000000000002',milk='00000000-0000-4000-8000-000000000003',day=new Date().toISOString().slice(0,10);
 const cake={id:'00000000-0000-4000-8000-0000000000a1',name:'Cake',version:1,data:{category:'',price:1000,currency:'IQD',notes:'',steps:[''],lines:[{ingredient:egg,qty:2,unit:'pcs'},{ingredient:flour,qty:100,unit:'g'},{ingredient:milk,qty:50,unit:'ml'}]}};
 const book={recipes:[cake],categories:[],ingredients:[{id:egg,name:'Eggs',stock_item:'Eggs',unit:'pcs',category:'',version:1},{id:flour,name:'Flour',stock_item:'Flour',unit:'g',category:'',version:1},{id:milk,name:'Milk',stock_item:'Milk',unit:'ml',category:'',version:1}],
  units:[{id:'pcs',en:'pcs'},{id:'g',en:'g'},{id:'ml',en:'ml'},{id:'kg',en:'kg'}],
  stock:[{name:'Eggs',base:'pcs',state:'ok'},{name:'Flour',base:'g',state:'ok'},{name:'Milk',base:'ml',state:'ok'}],
  prices:{Eggs:{perBase:250,base:'pcs',currency:'IQD',day,supplier:'Farm',unit:'pcs',cost:250}},pricesReady:true,stockAt:new Date().toISOString(),marginMin:60,covers:{[cake.id]:'/icon-192.png'},alerts:[]};
 const photos=[{id:'p1',url:'/icon-192.png'},{id:'p2',url:'/icon-512.png'}];
 const puts=[];let putDelay=0,orderFails=true,orderCalls=0;
 await context.route('**/functions/v1/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.split('/api/')[1],m=req.method();let data={ok:true},status=200;
  if(p==='signals'){await new Promise(r=>setTimeout(r,1000));data={n:1,kinds:{}};}
  else if(p==='bootstrap')data={account:'ahmad',name:'Ahmad',roles:[],views:['recipes','settings'],settings:{tourRecipes2:true},suppliers:[],items:[],units:[],history:[],devices:[],activity:[],inbox:[],months:[],pins:[],draft:null,streak:null};
  else if(p==='rico-prices')data={by:'mac',at:new Date().toISOString(),ricoOn:true,state:null};
  else if(p==='recipes')data=book;
  else if(p==='minibar')data={items:[],at:new Date().toISOString(),picked:0};
  else if(/^recipes\/[^/]+\/photos$/.test(p))data=photos;
  else if(/^recipes\/[^/]+\/photos\/order$/.test(p)){orderCalls++;await new Promise(r=>setTimeout(r,300));if(orderFails){status=500;data={error:'failed'};}}
  else if(p.startsWith('recipes/')&&m==='PUT'){
   const b=req.postDataJSON(),id=p.split('/')[1],stored=book.recipes.find(x=>x.id===id);puts.push(b);
   if(putDelay)await new Promise(r=>setTimeout(r,putDelay));
   if((stored?.version||0)!==b.version){status=409;data={error:'recipe_conflict'};}
   else{data={id,...b,version:b.version+1,updated_by:'ahmad',updated_at:new Date().toISOString()};const i=book.recipes.indexOf(stored);if(i<0)book.recipes.push(data);else book.recipes[i]=data;}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});});
 await context.addInitScript(()=>{const x='ricottaOrders:';localStorage.setItem(x+'apiSession',JSON.stringify({token:'fixture',account:'ahmad',name:'Ahmad',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem(x+'lang','"en"');localStorage.setItem(x+'pushBannerSnoozedAt',String(Date.now()));localStorage.setItem(x+'rcSeen2:ahmad','true');});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator(`[data-rc-open="${cake.id}"]`).waitFor();
 const stored=()=>book.recipes.find(x=>x.id===cake.id);
 const openEditor=async()=>{if(await page.locator('#rcEdit').count()===0){await page.locator(`[data-rc-open="${cake.id}"]`).click();}await page.locator('#rcEdit').click();await page.locator('#rcName').waitFor();};

 // The parsers on their own.
 const parsed=await page.evaluate(()=>({
  qty:['0,125','0.125','٠٫١٢٥','۰٫۱۲۵','0٫125','2','2,5','1,000','١٬٠٠٠','12.5 ','0','','abc','1,2,3'].map(v=>recipeAmount(v)),
  money:['4,500','٤٬٥٠٠','۴٬۵۰۰','4500','1,000,000','2,5','٤٥٠٠','0','x'].map(v=>recipeNumber(v))}));
 assert.deepEqual(parsed.qty,[0.125,0.125,0.125,0.125,0.125,2,2.5,1,1000,12.5,null,null,null,null],'amounts: the comma is the decimal point, ٬ groups');
 assert.deepEqual(parsed.money,[4500,4500,4500,4500,1000000,2.5,4500,null,null],'prices: thousands still group');

 // 1. Save, then another edit while the save is slow: the editor stays open until that edit is saved too.
 await openEditor();
 putDelay=1500;
 await page.locator('#rcName').fill('Cake A');
 await page.locator('#rcDone').click();
 await wait(()=>puts.length===1,'the first save is sent');
 await page.locator('#rcName').fill('Cake AB');
 await wait(()=>stored().version===2,'the first save is answered');
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#rcName').count(),1,'the editor is still open after the first answer');
 assert.notEqual(await page.locator('#rcSaveState').innerText(),'Saved','not "Saved" while an edit is still on its way');
 await page.locator('#rcEdit').waitFor({timeout:10000});
 assert.equal(puts.length,2,'the newer edit is sent once more');
 assert.equal(puts[1].version,2,'with the version the first save returned');
 assert.equal(stored().name,'Cake AB','the newest edit is on the server');
 assert.equal(stored().version,3);
 putDelay=0;
 // The version check still holds: another phone saved meanwhile, so this copy is refused and stays open.
 await openEditor();
 stored().version=9;
 await page.locator('#rcName').fill('Cake old copy');
 await page.locator('#rcDone').click();
 await page.locator('#toast.show').waitFor();
 assert.match(await page.locator('#toast').innerText(),/./);
 assert.equal(await page.locator('#rcName').count(),1,'a refused save leaves the editor open');
 assert.equal(stored().name,'Cake AB','and changes nothing on the server');
 stored().version=3;
 await page.evaluate(()=>{recipeBook.editing.version=3;});
 await page.locator('#rcName').fill('Cake');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.equal(stored().name,'Cake');

 // 3. Amounts keep their fraction; the price still groups thousands.
 await openEditor();
 await page.locator('[data-rc-qty="0"]').fill('0,125');
 await page.locator('[data-rc-qty="1"]').fill('0.125');
 await page.locator('[data-rc-qty="2"]').fill('٠٫١٢٥');
 await page.locator('#rcPrice').fill('٤٬٥٠٠');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.deepEqual(stored().data.lines.map(l=>l.qty),[0.125,0.125,0.125],'0,125 / 0.125 / ٠٫١٢٥ are all 0.125');
 assert.equal(stored().data.price,4500,'٤٬٥٠٠ is 4500');
 await openEditor();
 assert.deepEqual(await page.locator('[data-rc-qty]').evaluateAll(x=>x.map(i=>i.value)),['0.125','0.125','0.125'],'and so after reopening');
 assert.equal(await page.locator('#rcPrice').inputValue(),'4500');
 await page.locator('#rcPrice').fill('4,500');
 await page.locator('[data-rc-qty="0"]').fill('2');await page.locator('[data-rc-qty="1"]').fill('100');await page.locator('[data-rc-qty="2"]').fill('50');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.equal(stored().data.price,4500,'4,500 is 4500');

 // 2. Remove: a double tap takes away one line; two lines removed quickly are those two (the fade runs here).
 await openEditor();
 await page.evaluate(()=>{const b=document.querySelector('[data-rc-remove="0"]');b.click();b.click();});
 await page.waitForTimeout(400);
 assert.deepEqual(await page.evaluate(()=>recipeBook.editing.data.lines.map(l=>l.ingredient)),[flour,milk],'a double tap removes only its own line');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.deepEqual(stored().data.lines.map(l=>l.ingredient),[flour,milk],'and so on the server');
 stored().data.lines=[{ingredient:egg,qty:2,unit:'pcs'},{ingredient:flour,qty:100,unit:'g'},{ingredient:milk,qty:50,unit:'ml'}];stored().version++;
 await page.evaluate(()=>{recipeBook.raw=null;return recipeLoad();});
 await openEditor();
 assert.equal(await page.locator('[data-rc-remove]').count(),3);
 await page.evaluate(()=>{document.querySelector('[data-rc-remove="0"]').click();document.querySelector('[data-rc-remove="1"]').click();});
 await page.waitForTimeout(400);
 assert.deepEqual(await page.evaluate(()=>recipeBook.editing.data.lines.map(l=>l.ingredient)),[milk],'Eggs and Flour go, Milk stays');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.deepEqual(stored().data.lines.map(l=>l.ingredient),[milk]);

 // 5. A photo order the server refuses: the gallery and the list's cover both go back.
 await page.locator('[data-rc-photo="p1"]').waitFor();
 const order=()=>page.locator('[data-rc-photo]').evaluateAll(x=>x.map(b=>b.dataset.rcPhoto));
 assert.deepEqual(await order(),['p1','p2']);
 const moving=page.evaluate(()=>recipePhotoOrder(['p2','p1']));
 await page.waitForTimeout(100);
 assert.deepEqual(await order(),['p2','p1'],'the new order shows at once');
 assert.equal(await page.evaluate(id=>recipeBook.data.covers[id],cake.id),'/icon-512.png','and the new cover');
 await moving;
 assert.equal(orderCalls,1);
 assert.deepEqual(await order(),['p1','p2'],'refused: the gallery goes back');
 assert.equal(await page.evaluate(id=>recipeBook.data.covers[id],cake.id),'/icon-192.png','and the cover');
 await page.locator('#rcBack').click();await page.locator(`[data-rc-open="${cake.id}"]`).waitFor();
 assert.match(await page.locator(`[data-rc-open="${cake.id}"] .rc-pic img`).getAttribute('src'),/icon-192\.png$/,'the list shows the first cover again');
 // Accepted: the new cover stays.
 orderFails=false;
 await page.locator(`[data-rc-open="${cake.id}"]`).click();await page.locator('[data-rc-photo="p1"]').waitFor();
 await page.evaluate(()=>recipePhotoOrder(['p2','p1']));
 assert.deepEqual(await order(),['p2','p1']);
 await page.locator('#rcBack').click();await page.locator(`[data-rc-open="${cake.id}"]`).waitFor();
 assert.match(await page.locator(`[data-rc-open="${cake.id}"] .rc-pic img`).getAttribute('src'),/icon-512\.png$/,'an accepted order changes the cover');

 assert.deepEqual(errors,[]);await context.close();
 console.log('Recipes fixes UI PASS: Save waits for the newest edit and keeps the version check, Remove takes its own line once, fractional amounts in Latin/Arabic/Kurdish digits, grouped prices, a refused photo order restores the gallery and the cover');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exit(1);});
