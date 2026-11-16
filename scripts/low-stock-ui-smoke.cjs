/* Browser checks for low stock alerts: an item at or below its level shows yellow on the Order screen,
   with its level in its counting unit; the setting (an item's stock sheet and its form) switches on,
   saves a level, and switches off; an item with no stock link can't have one. API calls are fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const puts=[],at=new Date().toISOString();
 const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],
  suppliers:[{id:'d',name:'Dairy',phone:''}],units:[{id:'kg',en:'kg',ku:'کیلۆ',ar:'كيلو'},{id:'c',en:'carton',ku:'کارتۆن',ar:'كرتون'}],
  items:[
   // 3 kilos left, alert at 4 kilos: yellow.
   {id:'mozz',name:'Mozzarella',unit:'kg',supplierId:'d',stockItem:'Mozzarella - پەنیری مۆزارێلا',lowAlert:4,stock:{qty:3,unit:'کیلۆ',empty:false,level:'ok',count:{qty:3,unit:'کیلۆ'},at}},
   // 10 cartons left, no alert yet.
   {id:'cups',name:'Paper cups',unit:'c',supplierId:'d',stockItem:'Paper Cups - کوپی کاغەز',stock:{qty:10,unit:'کارتۆن',empty:false,level:'ok',count:{qty:10,unit:'کارتۆن'},at}},
   {id:'milk',name:'Milk',unit:'c',supplierId:'d'}],
  pins:[],history:[],devices:[],activity:[],inbox:[]};
 await ctx.addInitScript(()=>{localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:xtSeen:rozha','true');localStorage.setItem('ricottaOrders:ricoBriefing:rozha',JSON.stringify(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())));localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'low-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang','"en"');localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));});
 await ctx.route('**/functions/v1/api/**',async route=>{const req=route.request(),endpoint=new URL(req.url()).pathname.split('/api/')[1],method=req.method(),body=method==='GET'?null:req.postDataJSON();let data={ok:true},status=200;
  if(endpoint==='bootstrap')data={...fixture,draft:{cart:{},revision:0}};
  else if(endpoint==='draft')data={cart:{},revision:0,conflicts:[]};
  else if(endpoint==='auth/security')data={required:false};
  else if(endpoint==='devices'||endpoint==='activity'||endpoint==='assistant/inbox')data=[];
  else if(endpoint==='items/stock-options')data={at,items:[]};
  else if(/^items\/[^/]+\/low-alert$/.test(endpoint)&&method==='PUT'){const id=decodeURIComponent(endpoint.split('/')[1]);puts.push({id,...body});
   if(id==='milk'){status=422;data={error:'not_linked'};}else data={ok:true,lowAlert:body.level};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});
 const row=id=>page.locator(`#orderResults .item-row[data-item-id="${id}"]`);

 // At or below its level: yellow, and the line says the level in its counting unit.
 assert.equal(await row('mozz').evaluate(e=>e.classList.contains('low-alert')),true,'Mozzarella at 3 of 4 kilos is yellow');
 assert.match(await row('mozz').locator('.item-stock').innerText(),/3 کیلۆ[\s\S]*Low \(alert at 4 کیلۆ\)/);
 const bg=await row('mozz').evaluate(e=>getComputedStyle(e).backgroundColor);
 assert.match(bg,/rgba\(250, 204, 21/,'a yellow background');
 assert.equal(await row('cups').evaluate(e=>e.classList.contains('low-alert')),false,'no level: not yellow');

 // The setting in the item's stock sheet: on, a level, Save.
 await page.evaluate(()=>openStockLinkSheet('cups'));
 const box=page.locator('#ctxLow');
 await box.locator('[data-low-on]').waitFor();
 assert.equal(await box.locator('[data-low-level]').count(),0,'off: no level yet');
 await box.locator('[data-low-on]').check();
 await box.locator('[data-low-level]').waitFor();
 assert.match(await box.innerText(),/At or below[\s\S]*کارتۆن[\s\S]*Counted in کارتۆن[\s\S]*Now: 10 کارتۆن/,'counted in its counting format');
 await box.locator('[data-low-level]').fill('-2');await box.locator('[data-low-save]').click();
 assert.equal(puts.length,0,'a level below 0 is not sent');
 await box.locator('[data-low-level]').fill('12');await box.locator('[data-low-save]').click();
 await page.waitForFunction(()=>state.items.find(i=>i.id==='cups').lowAlert===12);
 assert.deepEqual(puts.at(-1),{id:'cups',level:12});
 assert.equal(await row('cups').evaluate(e=>e.classList.contains('low-alert')),true,'10 cartons with an alert at 12: yellow at once');
 assert.match(await row('cups').locator('.item-stock').innerText(),/alert at 12 کارتۆن/);
 // Off again.
 await box.locator('[data-low-on]').uncheck();
 await page.waitForFunction(()=>state.items.find(i=>i.id==='cups').lowAlert===undefined);
 assert.deepEqual(puts.at(-1),{id:'cups',level:null});
 assert.equal(await row('cups').evaluate(e=>e.classList.contains('low-alert')),false);
 await page.evaluate(()=>closeSelSheet?.());await page.waitForFunction(()=>!document.querySelector('.stock-link-sheet'));

 // The item's form: the same setting under its stock link; an item with no stock link can't have one.
 await page.evaluate(()=>openItemModal('mozz'));
 await page.locator('#mfLow [data-low-level]').waitFor();
 assert.equal(await page.locator('#mfLow [data-low-level]').inputValue(),'4');
 await page.evaluate(()=>closeModal(document.querySelector('#mfLow').closest('.modal-overlay')));
 await page.waitForFunction(()=>!document.querySelector('#mfLow'));
 await page.evaluate(()=>openItemModal('milk'));
 await page.locator('#mfLow').waitFor();
 assert.match(await page.locator('#mfLow').innerText(),/Link it to a stock item first/);
 assert.equal(await page.locator('#mfLow [data-low-on]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('Low stock UI PASS: yellow at or below the level with the level in its counting unit, set and saved in the stock sheet and the item form, off again, no level without a stock link');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
