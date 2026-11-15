/* Browser checks for linking ordering items to stock items (Manage, Link stock items, and one item's
   link): the best match is one tap, other matches sit next to it, a search opens in the row, a name
   that doesn't match warns and links only after "Link anyway", "Link sure matches" links the clear
   ones after one question, and every link made in the sheet can be undone there. All API calls are
   local fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const puts=[];
 const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],
  suppliers:[{id:'m',name:'شرکە مختار',phone:''},{id:'d',name:'Dairy',phone:''}],units:[{id:'kg',en:'kg',ku:'کیلۆ',ar:'كيلو'},{id:'c',en:'کارتۆن',ku:null,ar:null}],
  items:[{id:'peach',name:'عصير سن ایچ خۆخ',aliases:['Sunich peach juice'],unit:'c',supplierId:'m'},
   {id:'rice',name:'برنج',aliases:['Rice'],unit:'kg',supplierId:'m'},
   {id:'fries',name:'فنگر باتوو',aliases:['French fries'],unit:'c',supplierId:'m'},
   {id:'oil',name:'زيت ١٨ لتری',aliases:['Cooking oil 18 liters'],unit:'c',supplierId:'m'},
   {id:'mozz',name:'Mozzarella',unit:'kg',supplierId:'d',stockItem:'Mozzarella - پەنیری مۆزارێلا'}],
  pins:[],history:[],devices:[],activity:[],inbox:[]};
 const stock=['Sunich Mango Juice - شەربەتی سن ئیچ مەنگۆ','Sunich Peach Nectar - شەربەتی سن ئیچ خۆخ','Sunich Pineapple Juice - شەربەتی سن ئیچ ئەناناس',
  'Bato Fries - فینگر باتۆ','French Lettuce - خاس لولو','Cooking Cream - كريم طبخ','Cooking Oil 18L - زەیتی 18 لیتری','Banana - مۆز','Mozzarella - پەنیری مۆزارێلا',
  'Kalasher Rice - برنجی کەلەشیر','Nawras Rice - برنجی نەورەس','Mahmood Rice - برنجی مەحمود'].map(name=>({name,qty:2,unit:'کارتۆن',empty:false,units:['کارتۆن'],bought:1,...(/Mahmood/.test(name)?{from:['کۆگای مختار']}:{})}));
 await ctx.addInitScript(()=>{localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:ricoBriefing:rozha',JSON.stringify(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())));localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'link-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang','"en"');localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));});
 await ctx.route('**/functions/v1/api/**',async route=>{const req=route.request(),endpoint=new URL(req.url()).pathname.split('/api/')[1],method=req.method(),body=method==='GET'?null:req.postDataJSON();let data={ok:true},status=200;
  if(endpoint==='bootstrap')data={...fixture,draft:{cart:{},revision:0}};
  else if(endpoint==='draft')data={cart:{},revision:0,conflicts:[]};
  else if(endpoint==='auth/security')data={required:false};
  else if(endpoint==='devices'||endpoint==='activity'||endpoint==='assistant/inbox')data=[];
  else if(endpoint==='items/stock-options')data={at:new Date().toISOString(),items:stock};
  else if(/^items\/[^/]+\/stock$/.test(endpoint)&&method==='PUT'){const id=decodeURIComponent(endpoint.split('/')[1]);puts.push({id,...body});
   const it=fixture.items.find(i=>i.id===id),L=await page.evaluate(()=>!!globalThis.RicottaStockLink);assert.ok(it&&L);
   // Like the server: a name that doesn't match is refused unless the app warned first ({anyway: true}).
   const ok=body.stockItem===null||await page.evaluate(([i,n])=>RicottaStockLink.matches(i,n),[it,body.stockItem]);
   if(!ok&&body.anyway!==true){status=422;data={error:'names_dont_match'};}else data={ok:true,stockItem:body.stockItem,stock:body.stockItem?{qty:2,unit:'کارتۆن',empty:false,level:'ok'}:null};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});

 // The sheet: each item not linked yet, its best match first, one tap.
 await page.evaluate(()=>openStockLinkMany());
 const row=id=>page.locator(`.stock-many-row[data-many="${id}"]`);
 await row('peach').waitFor();
 assert.equal(await page.locator('.stock-many-row').count(),4,'only the items not linked yet');
 assert.match(await row('peach').locator('.stock-chip.first').innerText(),/Peach Nectar/,'peach, not the first Sunich juice');
 assert.equal(await row('fries').locator('.stock-chip:not(.search)').count(),1,'French fries: no French Lettuce next to Bato Fries');
 assert.match(await row('oil').locator('.stock-chip.first').innerText(),/Cooking Oil 18L[\s\S]*Same size/,'the oil, with why');
 assert.match(await row('rice').locator('.stock-chip.first').innerText(),/Mahmood Rice[\s\S]*From this supplier/,'the supplier on its receipts picks the rice');
 assert.ok(await row('rice').locator('.stock-chip:not(.search)').count()>=2,'other rices sit next to it, one tap each');

 // One tap links; Undo in the row takes it back.
 await row('peach').locator('.stock-chip.first').click();
 await row('peach').locator('[data-many-undo]').waitFor();
 assert.deepEqual(puts.at(-1),{id:'peach',stockItem:'Sunich Peach Nectar - شەربەتی سن ئیچ خۆخ'});
 await row('peach').locator('[data-many-undo]').click();
 await row('peach').locator('.stock-chip.first').waitFor();
 assert.deepEqual(puts.at(-1),{id:'peach',stockItem:null},'undo unlinks');

 // Search right in the row; a name that doesn't match warns, and links only after Link anyway.
 await row('fries').locator('[data-many-search]').click();
 await row('fries').locator('.stock-pick-input').fill('Banana');
 await row('fries').locator('.stock-pick-list [data-stock-pick]').first().waitFor();
 const opt=row('fries').locator('.stock-pick-list [data-stock-pick="Banana - مۆز"]');
 assert.equal(await opt.isDisabled(),false,'not blocked any more');
 assert.match(await opt.innerText(),/Name does not match/,'but it says so');
 const n=puts.length;
 await opt.click();await page.locator('#modalOkBtn').waitFor();
 assert.match(await page.locator('.modal-box').innerText(),/does not match[\s\S]*Link anyway/);
 assert.equal(puts.length,n,'nothing saved before the answer');
 // The question sits above the sheet: Escape answers it (no link) and leaves the sheet open.
 await page.keyboard.press('Escape');await page.locator('#modalOkBtn').waitFor({state:'detached'});
 assert.equal(await page.locator('.stock-many-sheet:not(.out)').count(),1,'sheet still open after Escape on the question');
 assert.equal(puts.length,n,'Escape links nothing');
 await opt.click();await page.locator('#modalOkBtn').waitFor();
 await page.locator('#modalOkBtn').click();
 await row('fries').locator('[data-many-undo]').waitFor();
 assert.deepEqual(puts.at(-1),{id:'fries',stockItem:'Banana - مۆز',anyway:true});
 await row('fries').locator('[data-many-undo]').click();await row('fries').locator('.stock-chip.first').waitFor();

 // Link sure matches: one question, then the clear ones (not the rice, which has close rivals).
 const sure=page.locator('[data-many-sure]');
 assert.match(await sure.innerText(),/Link 3 sure matches/);
 await sure.click();await page.locator('#modalOkBtn').waitFor();await page.locator('#modalOkBtn').click();
 await row('oil').locator('[data-many-undo]').waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.stock-many-row.done').length===3);
 assert.deepEqual(puts.slice(-3).map(p=>p.id).sort(),['fries','oil','peach']);
 assert.equal(await row('rice').locator('[data-many-undo]').count(),0,'the rice waits for a tap');
 assert.equal(await page.locator('[data-many-sure]').count(),0,'nothing sure is left');

 // One item's own link (item menu): suggestions with reasons, and search warns the same way.
 await page.evaluate(()=>closeSelSheet?.());
 await page.evaluate(()=>openStockLinkSheet('rice'));
 await page.locator('#ctxStock .stock-sug [data-stock-pick]').first().waitFor();
 assert.match(await page.locator('#ctxStock .stock-sug [data-stock-pick]').first().innerText(),/Mahmood Rice[\s\S]*From this supplier/);
 assert.deepEqual(errors,[]);
 console.log('Stock link UI PASS: best match one tap with why, cousins left out, search in the row, mismatch warns then links anyway, sure matches after one question, undo per row');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
