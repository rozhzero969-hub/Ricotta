/* Browser checks for the Mac app's marks (macos/): html.mac-shell, html.see-through and html.theme-<name> apply
   only when the Mac app's flag is present, never in a browser, on a phone or in the iPhone app; the Settings
   rows for see-through, theme and app icon show only inside the Mac app and send only fixed words; the
   app's own words switch them. API calls are fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],
 suppliers:[{id:'d',name:'Dairy',phone:''}],units:[{id:'kg',en:'kg'}],items:[{id:'milk',name:'Milk',unit:'kg',supplierId:'d'}],pins:[],history:[{id:'report-fixture',date:new Date().toISOString(),entries:[{supplierId:'d',items:[{name:'Milk',qty:3,unit:'kg'},{name:'Yogurt',qty:2,unit:'kg'}]}]}],devices:[],activity:[],inbox:[]};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const url='http://127.0.0.1:'+server.address().port;try{
 async function open(flags, options = {}){
  const ctx=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',...options});
  await ctx.addInitScript(flags=>{Object.assign(window,flags);window.__posted=[];window.webkit={messageHandlers:{ricotta:{postMessage:w=>window.__posted.push(w)}}};
   localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:xtSeen:rozha','true');localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'mac-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang',JSON.stringify(flags.demoLang || 'en'));localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));},flags);
  const task = {id:'10000000-0000-4000-8000-000000000002',kind:'remind',text:'Check stock',time:'22:00',days:[1,4],enabled:true};
  await ctx.route('**/functions/v1/api/**',async route=>{const endpoint=new URL(route.request().url()).pathname.split('/api/')[1];let data={ok:true};
   if(endpoint==='bootstrap')data={...fixture,streak:{count:12,lit:true},draft:{cart:{},revision:0}};else if(endpoint==='draft')data={cart:{},revision:0,conflicts:[]};else if(endpoint==='auth/security')data={required:false};
   else if(['devices','activity','assistant/inbox'].includes(endpoint))data=[];
   else if(endpoint==='rico-routines')data=[task];
   else if(endpoint==='rico-routines/'+task.id && route.request().method()==='PUT') Object.assign(task,route.request().postDataJSON());
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});
  return {ctx,page,errors,cls:()=>page.evaluate(()=>[...document.documentElement.classList].filter(c=>/^(mac-|see-through|theme-)/.test(c)).sort())};
 }
 const settingsRows=page=>page.evaluate(()=>{goView('settings');return ['seeThroughSwitch'].map(id=>!!document.getElementById(id)).concat(document.querySelectorAll('[data-mac-picker]').length);});

 // A browser, a phone, the iPhone app, or someone setting only the other flags: nothing changes.
 for(const flags of [{}, {RICOTTA_NATIVE_SHELL:true}, {RICOTTA_SEE_THROUGH:true, RICOTTA_THEME:'pink', RICOTTA_APP_ICON:'dark'}, {RICOTTA_MAC_SHELL:'yes', RICOTTA_SEE_THROUGH:true}]){
  const {ctx,page,errors,cls}=await open(flags);
  assert.deepEqual(await cls(),[],'no Mac classes with '+JSON.stringify(flags));
  assert.deepEqual(await settingsRows(page),[false,0],'no Mac rows in Settings with '+JSON.stringify(flags));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'see-through-on'})));
  assert.deepEqual(await cls(),[],'the app\'s words do nothing outside the Mac app');
  assert.deepEqual(errors,[]);await ctx.close();
 }
 // Only the native Mac wrapper shows three themes and the default plus nine supplied icons.
 {const {ctx,page,errors,cls}=await open({RICOTTA_NATIVE_SHELL:true,RICOTTA_MAC_SHELL:true,RICOTTA_SEE_THROUGH:true,RICOTTA_THEME:'cosmetic',RICOTTA_APP_ICON:'discord'},{reducedMotion:'reduce'});
  assert.deepEqual(await cls(),['mac-shell','see-through','theme-cosmetic']);
  assert.deepEqual(await settingsRows(page),[true,2]);
  await page.locator('[data-mac-picker=theme]').click();
  assert.deepEqual(await page.locator('[data-mac-theme]').evaluateAll(xs=>xs.map(x=>x.dataset.macTheme)),['ricotta','cosmetic','beauty']);
  await page.locator('[data-mac-theme=beauty]').click();
  assert.deepEqual(await cls(),['mac-shell','see-through','theme-beauty']);
  assert.equal(await page.locator('.mac-theme-preview').getAttribute('data-palette'),'beauty');
  await page.locator('[data-picker-done]').click();
  await page.locator('.mac-picker-sheet').waitFor({state:'detached'});
  await page.locator('[data-mac-picker=icon]').click();
  assert.deepEqual(await page.locator('[data-mac-icon]').evaluateAll(xs=>xs.map(x=>x.dataset.macIcon)),['ricotta','cosmetic-ink','cosmetic-pearl','cosmetic-signature','beauty-feather','beauty-gold','beauty-signature','ricotta-mark','ricotta-cheese','ricotta-word']);
  assert.equal(await page.locator('[data-mac-icon=ricotta]').getAttribute('aria-checked'),'true','removed icon falls back');
  await page.locator('[data-mac-icon-match=beauty-feather]').click();
  await page.locator('[data-reset-icon]').click();
  assert.equal(await page.locator('[data-mac-icon=ricotta]').getAttribute('aria-checked'),'true');
  assert.deepEqual(await page.evaluate(()=>window.__posted.filter(w=>typeof w==='string' && /^(theme|icon):/.test(w))), ['theme:beauty','icon:beauty-feather','icon:ricotta']);
  await page.keyboard.press('Escape');
  await page.locator('.mac-picker-sheet').waitFor({state:'detached'});
  const report = await page.evaluate(()=>window.__posted.find(x=>x?.kind==='monthly-report').report);
  assert.equal(report.orders,1);
  assert.equal(report.lines,2);
  assert.equal(report.days,1);
  assert.equal(report.daily[report.elapsed - 1],1);
  assert.equal(report.streak,12);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'widget:report'})));
  await page.locator('.report-sheet').waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'widget:assistant'})));
  assert.equal(await page.evaluate(()=>state.view),'assistant','widget opens Rico');
  const id = '77918325-8ee5-49e9-b91f-e4fbf4ed7540';
  await page.evaluate(id=>ricoSetInbox([{id,kind:'routine',at:new Date().toISOString(),en:'Do your receipts',read:false}]),id);
  assert.deepEqual(await page.evaluate(()=>window.__posted.find(x=>x?.kind==='rico-reminder')),{kind:'rico-reminder',id,body:'Do your receipts'});
  assert.deepEqual(errors,[]);await ctx.close();}
 // Desktop tooltip uses real Order controls, and all 22 scenes render without duplicate live IDs.
 {const {ctx,page,errors}=await open({});
  await settingsRows(page);
  const swipe = page.locator('label.preference-row').filter({has:page.locator('[data-feature="swipe"]')});
  await swipe.hover();
  const tip = page.locator('#settingHelp');
  await tip.waitFor();
  const demo = tip.locator('.setting-demo');
  assert.deepEqual(await demo.locator('.qty-input').evaluateAll(inputs=>inputs.map(input=>input.value)),['0','3']);
  assert.equal(await demo.evaluate(el=>el.inert),true);
  if(process.env.RICOTTA_THEME_PREVIEW_DIR) await page.screenshot({path:path.join(process.env.RICOTTA_THEME_PREVIEW_DIR,'swipe-desktop.png'),animations:'disabled'});
  await page.keyboard.press('Escape'); await tip.waitFor({state:'detached'});
  const previews = await page.evaluate(()=>[...SETTING_PREVIEW_IDS].map(id=>{
   const template=document.createElement('template');template.innerHTML=helpBody(id,id);
   return {id, empty:!template.content.querySelector('.demo-screen')?.children.length,
    hasId:!!template.content.querySelector('.setting-demo [id]:not(linearGradient)'),text:template.content.textContent};
  }));
  assert.equal(previews.length,22);
  previews.forEach(({id,empty,hasId,text})=>{
   assert.equal(empty,false,id);assert.equal(hasId,false,id);assert.doesNotMatch(text,/undefined|NaN/,id);
  });
  assert.deepEqual(errors,[]);await ctx.close();
 }
 {const {ctx,page,errors}=await open({demoLang:'ku'},{viewport:{width:375,height:812},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await page.evaluate(()=>{goView('assistant');openRicoScheduled();});
  const scheduled = page.locator('.sched-sheet:not(.out)');
  await scheduled.locator('[data-sched-edit]').tap();
  const schedClock = scheduled.locator('#schedClock');
  await schedClock.tap();
  await schedClock.fill('١١:٣٧ د.ن');
  assert.equal(await scheduled.isVisible(),true,'the panel stays open while changing the time');
  await scheduled.locator('button[type=submit]').tap();
  await scheduled.locator('[data-sched-edit]').waitFor();
  assert.equal(await page.evaluate(()=>scheduleClock('12 AM')),'00:00');
  assert.equal(await page.evaluate(()=>scheduleClock('12:43 PM')),'12:43');
  assert.equal(await page.evaluate(()=>scheduleClock('9')) ,null);
  await scheduled.locator('[data-sched-new]').tap();
  await scheduled.waitFor({state:'hidden'});
  assert.ok(await page.locator('#ricoInput').evaluate(el=>el === document.activeElement),'New task starts in chat');
  const initial = await page.evaluate(()=>{goView('settings');return featureOn('swipe');});
  const info = page.locator('[data-help="swipe"]');
  await info.tap();
  const sheet = page.locator('.help-sheet:not(.out)');
  await sheet.waitFor();
  assert.equal(await sheet.locator('.demo-touch').isHidden(),true,'reduce motion keeps the comparison and hides the moving touch marker');
  assert.equal(await sheet.locator('.demo-swipe').evaluate(el=>getComputedStyle(el).getPropertyValue('--swipe-distance').trim()),'-72px');
  assert.equal(await sheet.locator('.demo-screen .qty-input').last().inputValue(),'3');
  if(process.env.RICOTTA_THEME_PREVIEW_DIR) await page.screenshot({path:path.join(process.env.RICOTTA_THEME_PREVIEW_DIR,'swipe-mobile.png'),animations:'disabled'});
  await sheet.locator('.help-close').tap();
  assert.equal(await page.evaluate(()=>featureOn('swipe')),initial,'tutorial does not toggle the setting');
  assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log('Mac shell and Settings UI PASS: three Mac themes, ten Mac icons, native reminder handoff, widget link, scheduled task edit, desktop and touch tutorials, reduced motion, native messages');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
