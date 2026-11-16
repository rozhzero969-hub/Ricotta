/* Browser checks for Recipes (Ahmad): he sees Recipes and Settings only, gets the Recipes tour once and
   never the Order tour, writes a recipe from a linked ingredient, sees its cost from the last price paid,
   scales it, edits with autosave (Done waits for a save on its way), and his Settings are locked. Rozh
   opens Ahmad's access in Admin. EN/KU/AR at phone and desktop widths. API calls are fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out='/tmp/ricotta-ui-recipes';fs.mkdirSync(out,{recursive:true});
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{}),headless:true});
try{for(const width of [390,1440])for(const lang of ['en','ku','ar']){
 if(process.env.RECIPE_UI_FAST&&(width!==1440||lang!=='en'))continue;
 const first=width===1440&&lang==='en',shot=n=>page.screenshot({path:path.join(out,`${n}-${lang}-${width}.png`),animations:'disabled'});
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const egg='00000000-0000-4000-8000-000000000001',day=new Date().toISOString().slice(0,10);
 const book={recipes:[],ingredients:[{id:egg,name:'Eggs',stock_item:'Eggs',unit:'pcs',version:1}],units:[{id:'pcs',en:'pcs'}],
  stock:[{name:'Eggs',base:'pcs',count:null,buy:null,state:'ok'}],
  prices:{Eggs:{perBase:250,base:'pcs',currency:'IQD',day,supplier:'Farm',unit:'pcs',cost:250}},pricesReady:true,stockAt:new Date().toISOString(),marginMin:60,covers:{},alerts:[]};
 const access={roles:['order','recipes','history','manage'],yunis:['history'],ahmad:[]},settingsPuts=[];
 await context.route('**/functions/v1/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.split('/api/')[1];let data={ok:true};
  if(p==='signals'){await new Promise(r=>setTimeout(r,1000));data={n:1,kinds:{}};}
  else if(p==='bootstrap')data={account:'ahmad',name:'Ahmad',roles:[],views:['recipes','settings'],settings:{darkMode:'on'},suppliers:[],items:[],units:[],history:[],devices:[],activity:[],inbox:[],months:[],pins:[],draft:null,streak:null,expenses:true};
  else if(p==='settings'&&req.method()==='PUT')settingsPuts.push(req.postDataJSON());
  else if(p==='admin/roles'){if(req.method()==='PUT'){const b=req.postDataJSON();access[b.account]=b.roles;data={roles:b.roles};}else data=access;}
  else if(p==='recipes')data=book;
  else if(/^recipes\/[^/]+\/photos$/.test(p))data=[];
  else if(p.startsWith('recipes/')&&req.method()==='PUT'){const b=req.postDataJSON();await new Promise(r=>setTimeout(r,900));data={...b,version:b.version+1,updated_by:'ahmad',updated_at:new Date().toISOString()};const i=book.recipes.findIndex(x=>x.id===data.id);if(i<0)book.recipes.push(data);else book.recipes[i]=data;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});});
 await context.addInitScript(({lang,first})=>{const prefix='ricottaOrders:';localStorage.setItem(prefix+'apiSession',JSON.stringify({token:'fixture',account:'ahmad',name:'Ahmad',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem(prefix+'lang',JSON.stringify(lang));localStorage.setItem(prefix+'pushBannerSnoozedAt',String(Date.now()));if(!first)localStorage.setItem(prefix+'rcSeen:ahmad','true');},{lang,first});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#rcNew').waitFor();
 assert.equal(await page.locator('.navbtn[data-view="order"]').count(),0,'no Order for Ahmad');
 if(first){
  // The Recipes tour, once; never the Order or Expenses tour.
  const tour=page.locator('.xt-sheet [data-rc-tour-next]');await tour.waitFor({timeout:8000});
  await page.locator('.xt-sheet [data-rc-tour-skip]').click();
  await page.waitForFunction(()=>!document.querySelector('.xt-sheet'));
  assert.deepEqual(settingsPuts.at(-1),{key:'tourRecipes',value:true},'seen is saved on his account');
  await page.waitForTimeout(800);assert.equal(await page.locator('.xt-sheet, .tour-overlay').count(),0,'no other tour');
 }
 // A new recipe from a linked ingredient.
 await page.locator('#rcNew').click();await page.locator('#rcName').fill('Vanilla cake');
 await page.locator('#rcAddLine').selectOption(egg);await page.locator('[data-rc-qty="0"]').waitFor();
 await page.locator('[data-rc-qty="0"]').fill('2');
 assert.match(await page.locator('[data-rc-linecost="0"]').innerText(),/500/,'2 eggs at the last price of 250 IQD');
 await page.locator('[data-rc-step="0"]').fill('Beat the eggs.');await shot('editor');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.equal(book.recipes.length,1);assert.equal(book.recipes[0].data.lines[0].ingredient,egg);assert.equal(book.recipes[0].data.lines[0].qty,2);
 assert.equal(book.recipes[0].data.price,null,'no menu price until he gives one');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
 assert.match(await page.locator('.rc-stats').innerText(),/500/,'the recipe costs 500 IQD');await shot('detail');
 // Scaling the detail view.
 await page.locator('#rcScale').selectOption('2');
 assert.match(await page.locator('.rc-line').first().innerText(),/4/,'twice the recipe: 4 eggs');
 // Editing: autosave on its way, then Done waits for it.
 await page.locator('#rcEdit').click();await page.locator('[data-rc-qty="0"]').fill('3');
 await page.waitForTimeout(1200);await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.equal(book.recipes[0].data.lines[0].qty,3,'Done waits for the save on its way');
 // Back to the list: the recipe with its letter tile (no photo).
 await page.locator('#rcBack').click();await page.locator('.rc-row[data-rc-open]').first().waitFor();
 assert.equal(await page.locator('.rc-row[data-rc-open] .rc-letter').first().innerText(),'V');await shot('list');if(first){await page.evaluate(()=>{state.settings.darkMode='off';applyFeatures();});await shot('list-light');await page.locator('.rc-row[data-rc-open]').first().click();await page.locator('#rcEdit').waitFor();await shot('detail-light');await page.locator('#rcBack').click();await page.locator('.rc-row[data-rc-open]').first().waitFor();}
 await page.evaluate(()=>goView('settings'));await page.locator('.settings-page').waitFor();
 assert.ok(await page.locator('[data-feature="soundSent"]').isDisabled());
 assert.equal(await page.locator('#tourBtn').count(),0,'no Order tour in Help');
 assert.equal(await page.locator('#rcTourBtn').count(),1,'the Recipes tour in Help');
 if(first){await page.evaluate(()=>{lset('apiSession',{...apiSession(),account:'rozha'});state.account='rozha';state.name='Rozh';state.views=['order','recipes','admin','settings'];state.tabs=['order','recipes','admin'];state.view='admin';state.adminPage='access';resetAdmin();render();});await page.locator('[data-access-person="ahmad"]').waitFor({timeout:10000});await page.locator('[data-access-person="ahmad"]').click();assert.equal(await page.locator('[data-access-person="ahmad"]').getAttribute('aria-pressed'),'true');await page.locator('[data-role="manage"]').check();await page.waitForFunction(()=>adminData.roles?.data?.ahmad?.includes('manage'));assert.deepEqual(access.ahmad,['manage']);assert.deepEqual(access.yunis,['history']);await page.evaluate(()=>{adminFilter.person='ahmad';state.adminPage='person';render();});assert.equal(await page.locator('[data-pin-change="ahmad"]').count(),1);}
 assert.deepEqual(errors,[]);await context.close();}
 console.log('Recipes UI PASS: Ahmad sees Recipes only, gets the Recipes tour once, writes a recipe with its cost from the last price, scales it, autosave before Done, letter tile, locked settings, EN/KU/AR at phone and desktop widths');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exit(1);});
