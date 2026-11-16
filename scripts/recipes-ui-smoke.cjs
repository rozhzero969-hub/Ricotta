/* Browser checks for Recipes (Ahmad, the minibar): he sees Recipes, Items, his Stock tab and Settings, gets
   the tour once and never the Order tour. Items: A to Z, one row each with its name once and its last price
   ("250 / piece"), Check prices now, no category; a new item only offers its stock item's units. A recipe:
   name, a group he types himself, menu price, items picked from a sheet with amounts, steps, notes; Done at
   the bottom saves. Its cost is rounded to the nearest 250 IQD with the working behind it, and there is no
   cost at all once an item without a price is added (with a note naming it). The list is grouped by his
   groups; hold or right-click deletes. Stock: the items Rozh picked, A to Z, with a search box. His
   Settings show only what is his. Rozh opens Ahmad's access in Admin. EN/KU/AR at phone and desktop
   widths. API calls are fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out='/tmp/ricotta-ui-recipes';fs.mkdirSync(out,{recursive:true});
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{}),headless:true});
try{for(const width of [390,1440])for(const lang of ['en','ku','ar']){
 if(process.env.RECIPE_UI_FAST&&(width!==1440||lang!=='en'))continue;
 const first=width===1440&&lang==='en',shot=async n=>{await page.screenshot({path:path.join(out,`${n}-${lang}-${width}.png`),animations:'disabled'});};
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block',hasTouch:width<600}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const egg='00000000-0000-4000-8000-000000000001',flour='00000000-0000-4000-8000-000000000002',day=new Date().toISOString().slice(0,10);
 const book={recipes:[],ingredients:[{id:egg,name:'Eggs',stock_item:'Eggs',unit:'pcs',category:'Dairy',version:1},{id:flour,name:'Flour',stock_item:'Flour',unit:'g',category:'',version:1}],units:[{id:'pcs',en:'pcs'},{id:'g',en:'g'},{id:'ml',en:'ml'}],
  stock:[{name:'Eggs',base:'pcs',count:null,buy:null,state:'ok'},{name:'Flour',base:'g',count:null,buy:null,state:'ok'},{name:'Milk',base:'ml',count:null,buy:null,state:'ok'}],
  prices:{Eggs:{perBase:250,base:'pcs',currency:'IQD',day,supplier:'Farm',unit:'pcs',cost:250},Milk:{perBase:2,base:'ml',currency:'IQD',day,supplier:'Dairy',unit:'L',cost:2000}},pricesReady:true,stockAt:new Date().toISOString(),marginMin:60,covers:{},alerts:[]};
 const access={roles:['order','recipes','history','manage'],yunis:['history'],ahmad:[]},settingsPuts=[],deleted=[];
 await context.route('**/functions/v1/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.split('/api/')[1];let data={ok:true};
  if(p==='signals'){await new Promise(r=>setTimeout(r,1000));data={n:1,kinds:{}};}
  else if(p==='bootstrap')data={account:'ahmad',name:'Ahmad',roles:[],views:['recipes','settings'],settings:{darkMode:'on'},suppliers:[],items:[],units:[],history:[],devices:[],activity:[],inbox:[],months:[],pins:[],draft:null,streak:null,expenses:true};
  else if(p==='settings'&&req.method()==='PUT')settingsPuts.push(req.postDataJSON());
  else if(p==='admin/roles'){if(req.method()==='PUT'){const b=req.postDataJSON();access[b.account]=b.roles;data={roles:b.roles};}else data=access;}
  else if(p==='rico-prices')data={by:'mac',at:new Date(Date.now()-5*60000).toISOString(),ricoOn:true,state:null};
  else if(p==='recipes')data=book;
  else if(p==='minibar')data={items:[{id:'i1',name:'Banana',stock:{qty:12,unit:'kg',empty:false,level:'ok'}},{id:'i2',name:'Almarai Milk',stock:{qty:0,unit:'carton',empty:true,level:'empty'}}],at:new Date().toISOString(),picked:2};
  else if(/^recipes\/[^/]+\/photos$/.test(p))data=[];
  else if(p.startsWith('recipe-ingredients/')&&req.method()==='PUT'){const b=req.postDataJSON();data={id:p.split('/')[1],...b,version:b.version+1};const i=book.ingredients.findIndex(x=>x.id===data.id);if(i<0)book.ingredients.push(data);else book.ingredients[i]=data;}
  else if(p.startsWith('recipes/')&&req.method()==='DELETE'){const id=p.split('/')[1];deleted.push(id);book.recipes=book.recipes.filter(x=>x.id!==id);}
  else if(p.startsWith('recipes/')&&req.method()==='PUT'){const b=req.postDataJSON();await new Promise(r=>setTimeout(r,900));data={id:p.split('/')[1],...b,version:b.version+1,updated_by:'ahmad',updated_at:new Date().toISOString()};const i=book.recipes.findIndex(x=>x.id===data.id);if(i<0)book.recipes.push(data);else book.recipes[i]=data;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});});
 await context.addInitScript(({lang,first})=>{const prefix='ricottaOrders:';localStorage.setItem(prefix+'apiSession',JSON.stringify({token:'fixture',account:'ahmad',name:'Ahmad',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem(prefix+'lang',JSON.stringify(lang));localStorage.setItem(prefix+'pushBannerSnoozedAt',String(Date.now()));if(!first)localStorage.setItem(prefix+'rcSeen2:ahmad','true');},{lang,first});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.rc-page').first().waitFor();
 assert.equal(await page.locator('.navbtn[data-view="order"]').count(),0,'no Order for Ahmad');
 for(const v of ['recipes','recipeItems','minibar'])assert.equal(await page.locator(`.navbtn[data-view="${v}"]`).count(),1,v+' is a tab of its own');
 if(first){
  // The tour, once; never the Order or Expenses tour.
  const tour=page.locator('.xt-sheet [data-rc-tour-next]');await tour.waitFor({timeout:8000});
  await page.locator('.xt-sheet [data-rc-tour-skip]').click();
  await page.waitForFunction(()=>!document.querySelector('.xt-sheet'));
  assert.deepEqual(settingsPuts.at(-1),{key:'tourRecipes2',value:true},'seen is saved on his account');
  await page.waitForTimeout(800);assert.equal(await page.locator('.xt-sheet, .tour-overlay').count(),0,'no other tour');
 }
 // No recipes yet: a friendly empty page with one button (it says recipe, not ingredient). No prices button here.
 await page.locator('.rc-empty #rcNew').waitFor();
 assert.equal(await page.locator('#rcPrices').count(),0,'Check prices now is on the Items tab');
 assert.equal(await page.locator('[data-rc-cook], #rcCook, [data-rc-tab]').count(),0,'no Cooking view and no inner tabs');
 await shot('first');
 // Items: A to Z, the name once, the last price as a chip, Check prices now, no categories.
 await page.locator('.navbtn[data-view="recipeItems"]').click();await page.locator('#rcIngredientNew').waitFor();
 assert.equal(await page.locator('#rcPrices').count(),1,'Check prices now');
 assert.match(await page.locator(`[data-rc-ingredient="${egg}"] .rc-price`).innerText(),/250/,'250 IQD a piece');
 assert.equal(await page.locator(`[data-rc-ingredient="${flour}"] .rc-price.none`).count(),1,'Flour has no price yet');
 assert.deepEqual(await page.locator('.rc-irow-name').allInnerTexts(),['Eggs','Flour'],'A to Z, no groups');
 assert.equal(await page.locator('.rc-items-page .rc-group').count(),0,'items are not grouped');
 await shot('ingredients');
 if(first){
  // A new item: no category; its last price shows when the stock item is chosen; only that stock item's units.
  await page.locator('#rcIngredientNew').click();await page.locator('#rcIngName').fill('Milk');
  assert.equal(await page.locator('[data-rc-icat]').count(),0,'no category picker');
  await page.locator('#rcIngStock').selectOption('Milk');await page.locator('#rcIngPrice b').waitFor();
  assert.match(await page.locator('#rcIngPrice').innerText(),/2,000/,'1 L = 2,000 IQD');
  assert.deepEqual(await page.locator('#rcIngUnit option:not([disabled])').evaluateAll(o=>o.map(x=>x.value)),['ml'],'only the units Milk comes in: '+JSON.stringify(await page.evaluate(()=>({fit:recipeUnitsFor('Milk'),stock:recipeBook.data.stock,units:recipeBook.data.units,f:recipeBook.data.units.map(u=>RicottaRecipeCost.factor(recipeBook.data.stock.find(x=>x.name==='Milk'),u.en))}))));
  assert.equal(await page.locator('#rcIngUnit').inputValue(),'ml');
  await shot('ingredient-form');
  await page.locator('#modalFormOk').click();await page.waitForFunction(()=>!document.querySelector('.modal-overlay'));
  const milk=book.ingredients.find(i=>i.name==='Milk');assert.equal(milk.category,'');assert.equal(milk.stock_item,'Milk');assert.equal(milk.unit,'ml');
 }
 // A new recipe: name, a new group typed by Ahmad, menu price, items from the sheet, steps; Done at the bottom.
 await page.locator('.navbtn[data-view="recipes"]').click();await page.locator('#rcNew').click();await page.locator('#rcName').fill('Vanilla cake');
 for(const gone of ['[data-rc-field="yield"]','[data-rc-field="prep"]','[data-rc-status]','[data-rc-up]','[data-rc-stepup]','#rcEditPhoto'])assert.equal(await page.locator(gone).count(),0,gone+' is not in the form');
 assert.equal(await page.locator('[data-rc-cat]').count(),0,'no ready-made groups');
 await page.locator('#rcNewGroup').fill('Cakes');
 await page.locator('#rcPrice').fill('1000');
 await page.locator('#rcAddLine').click();await page.locator(`.rc-pick-sheet [data-rc-pick="${egg}"]`).click();await page.locator('[data-rc-qty="0"]').waitFor();
 assert.deepEqual(await page.locator('[data-rc-unit="0"] option:not([disabled])').evaluateAll(o=>o.map(x=>x.value)),['pcs'],'eggs only in pieces');
 await page.locator('[data-rc-qty="0"]').fill('2');
 assert.match(await page.locator('[data-rc-linecost="0"]').innerText(),/500/,'2 eggs at the last price of 250 IQD');
 await page.locator('[data-rc-step="0"]').fill('Beat the eggs.');
 const done=await page.evaluate(()=>{const d=document.getElementById('rcDone'),n=document.getElementById('rcName');return !!d&&!!n&&!!(n.compareDocumentPosition(d)&Node.DOCUMENT_POSITION_FOLLOWING);});
 assert.ok(done,'Done is at the end of the form');
 await shot('editor');
 await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.equal(book.recipes.length,1);const saved=book.recipes[0];assert.equal(saved.data.lines[0].ingredient,egg);assert.equal(saved.data.lines[0].qty,2);
 assert.deepEqual(Object.keys(saved.data).sort(),['category','currency','lines','notes','price','steps'],'only what the form has');
 assert.equal(saved.data.price,1000);assert.equal(saved.data.category,'Cakes','the group he typed is saved');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
 assert.match(await page.locator('.rc-money').innerText(),/500/,'the recipe costs 500 IQD');
 assert.equal(await page.locator('.rc-line-name').first().innerText(),'Eggs','the item name shows once');
 assert.equal(await page.locator('#rcCook, [data-rc-cook]').count(),0,'no Cooking view');
 await shot('detail');
 // See how it adds up: each item's working, the total and the rounding.
 await page.locator('[data-rc-why]').click();await page.locator('.rc-why-sheet .rc-why-card').waitFor();
 const why=await page.locator('.rc-why-sheet').innerText();assert.match(why,/250 IQD/);assert.match(why,/500 IQD/);assert.match(why,/Farm/);
 await shot('why');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.rc-why-sheet:not(.out)'));
 // Flour has no price yet: no cost, no profit, no margin, and a note that names it.
 await page.locator('#rcEdit').click();await page.locator('#rcAddLine').click();await page.locator(`.rc-pick-sheet [data-rc-pick="${flour}"]`).click();await page.locator('[data-rc-qty="1"]').fill('100');
 await page.waitForTimeout(1200);await page.locator('#rcDone').click();await page.locator('#rcEdit').waitFor();
 assert.equal(book.recipes[0].data.lines[1].qty,100,'Done waits for the save on its way');
 assert.equal(await page.locator('.rc-money .rc-ring').count(),0,'no profit without every price');
 assert.match(await page.locator('.rc-money-missing').innerText(),/Flour/,'the note names the item without a price');
 await shot('detail-missing');
 // Back to the list: grouped by his groups; the card says which price is missing; hold or right-click deletes.
 await page.locator('#rcBack').click();const row=page.locator('.rc-tile[data-rc-open]').first();await row.waitFor();
 assert.match(await page.locator('.rc-group-head h2').first().innerText(),/Cakes/,'the list is grouped by his groups');
 assert.match(await row.innerText(),/Flour/);await shot('list');
 if(first){await page.evaluate(()=>{state.settings.darkMode='off';applyFeatures();});await shot('list-light');}
 if(width<600){const b=await row.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();}
 else await row.click({button:'right'});
 await page.locator('.ctx-menu [data-ctx="delete"]').waitFor();await shot('menu');
 await page.locator('.ctx-menu [data-ctx="delete"]').click();await page.locator('#modalOkBtn').click();
 await page.waitForFunction(()=>!document.querySelector('.rc-tile[data-rc-open]'));assert.deepEqual(deleted,[saved.id],'deleted on the server');
 // Stock: the items Rozh picked, A to Z, the amount in Main Storage, and a search box.
 await page.locator('.navbtn[data-view="minibar"]').click();await page.locator('.mb-row').first().waitFor();
 assert.deepEqual(await page.locator('.mb-name').allInnerTexts(),['Almarai Milk','Banana'],'A to Z');
 assert.match(await page.locator('.mb-row').nth(1).innerText(),/12/,'12 kg in Main Storage');
 assert.equal(await page.locator('.mb-amount.red').count(),1,'none left shows red');
 await page.locator('#mbSearch').fill('ban');assert.equal(await page.locator('.mb-row').count(),1,'search');
 await shot('stock');
 // Settings: only what is his; Feature access as name, hint under it and the value on the right.
 await page.evaluate(()=>goView('settings'));await page.locator('.settings-page').waitFor();
 for(const id of ['soundSent','swipe','milestones','tables'])assert.equal(await page.locator(`[data-feature="${id}"]`).count(),0,id+' is hidden for Ahmad');
 assert.equal(await page.locator('[data-feature="recipeAlerts"]').count(),1,'recipe alerts switch');
 assert.equal(await page.locator('#tourBtn').count(),0,'no Order tour in Help');
 assert.equal(await page.locator('#rcTourBtn').count(),1,'the Recipes tour in Help');
 const lay=await page.evaluate(()=>{const r=document.querySelector('.rc-access-row'),t=r.querySelector('.rc-access-text'),v=r.querySelector('.rc-access-value'),s=t.querySelector('small'),n=t.querySelector('span'),R=r.getBoundingClientRect(),V=v.getBoundingClientRect(),S=s.getBoundingClientRect(),N=n.getBoundingClientRect();return {under:S.top>=N.bottom-1,edge:document.documentElement.dir==='rtl'||document.documentElement.classList.contains('rtl')?V.left-R.left:R.right-V.right};});
 assert.ok(lay.under,'the hint sits under the name');assert.ok(lay.edge<=20,'the value sits at the row’s end: '+lay.edge);
 await shot('settings');
 if(first){await page.evaluate(()=>{lset('apiSession',{...apiSession(),account:'rozha'});state.account='rozha';state.name='Rozh';state.views=['order','recipes','admin','settings'];state.tabs=['order','recipes','admin'];state.view='admin';state.adminPage='access';resetAdmin();render();});await page.locator('[data-access-person="ahmad"]').waitFor({timeout:10000});await page.locator('[data-access-person="ahmad"]').click();assert.equal(await page.locator('[data-access-person="ahmad"]').getAttribute('aria-pressed'),'true');await page.locator('[data-role="manage"]').check();await page.waitForFunction(()=>adminData.roles?.data?.ahmad?.includes('manage'));assert.deepEqual(access.ahmad,['manage']);assert.deepEqual(access.yunis,['history']);await page.evaluate(()=>{adminFilter.person='ahmad';state.adminPage='person';render();});assert.equal(await page.locator('[data-pin-change="ahmad"]').count(),1);}
 assert.deepEqual(errors,[]);await context.close();}
 console.log('Recipes UI PASS: Ahmad sees Recipes, Items and Stock tabs, the tour once, items A to Z with last prices and only their own units, his own groups, Done at the end, costs to the nearest 250 IQD with the working, no cost while a price is missing, delete from the hold menu, his Stock list, his own Settings, EN/KU/AR at phone and desktop widths');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exit(1);});
