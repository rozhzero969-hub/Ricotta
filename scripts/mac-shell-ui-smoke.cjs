/* Browser checks for the Mac app's marks (macos/): html.mac-shell, html.see-through and html.theme-<name> apply
   only when the Mac app's flag is present, never in a browser, on a phone or in the iPhone app; the Settings
   rows for see-through, theme and app icon show only inside the Mac app and send only fixed words; the
   app's own words switch them. API calls are fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],
 suppliers:[{id:'d',name:'Dairy',phone:''}],units:[{id:'kg',en:'kg'}],items:[{id:'milk',name:'Milk',unit:'kg',supplierId:'d'}],pins:[],history:[],devices:[],activity:[],inbox:[]};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const url='http://127.0.0.1:'+server.address().port;try{
 async function open(flags){
  const ctx=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  await ctx.addInitScript(flags=>{Object.assign(window,flags);window.__posted=[];window.webkit={messageHandlers:{ricotta:{postMessage:w=>window.__posted.push(w)}}};
   localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:xtSeen:rozha','true');localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'mac-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang','"en"');localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));},flags);
  await ctx.route('**/functions/v1/api/**',async route=>{const endpoint=new URL(route.request().url()).pathname.split('/api/')[1];let data={ok:true};
   if(endpoint==='bootstrap')data={...fixture,draft:{cart:{},revision:0}};else if(endpoint==='draft')data={cart:{},revision:0,conflicts:[]};else if(endpoint==='auth/security')data={required:false};
   else if(['devices','activity','assistant/inbox'].includes(endpoint))data=[];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});
  return {ctx,page,errors,cls:()=>page.evaluate(()=>[...document.documentElement.classList].filter(c=>/^(mac-|see-through|theme-)/.test(c)).sort())};
 }
 const settingsRows=page=>page.evaluate(()=>{goView('settings');return ['seeThroughSwitch'].map(id=>!!document.getElementById(id)).concat(document.querySelectorAll('[data-mac-theme],[data-mac-icon]').length);});

 // A browser, a phone, the iPhone app, or someone setting only the other flags: nothing changes.
 for(const flags of [{}, {RICOTTA_NATIVE_SHELL:true}, {RICOTTA_SEE_THROUGH:true, RICOTTA_THEME:'ocean', RICOTTA_APP_ICON:'dark'}, {RICOTTA_MAC_SHELL:'yes', RICOTTA_SEE_THROUGH:true}]){
  const {ctx,page,errors,cls}=await open(flags);
  assert.deepEqual(await cls(),[],'no Mac classes with '+JSON.stringify(flags));
  assert.deepEqual(await settingsRows(page),[false,0],'no Mac rows in Settings with '+JSON.stringify(flags));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'see-through-on'})));
  assert.deepEqual(await cls(),[],'the app\'s words do nothing outside the Mac app');
  assert.deepEqual(errors,[]);await ctx.close();
 }
 // Inside the Mac app with see-through off: only mac-shell; an unknown theme is ignored.
 {const {ctx,page,errors,cls}=await open({RICOTTA_NATIVE_SHELL:true,RICOTTA_MAC_SHELL:true,RICOTTA_SEE_THROUGH:false,RICOTTA_THEME:'evil'});
  assert.deepEqual(await cls(),['mac-shell']);assert.deepEqual(errors,[]);await ctx.close();}
 // Inside the Mac app, see-through on, Ocean: all three, and Settings has the rows.
 {const {ctx,page,errors,cls}=await open({RICOTTA_NATIVE_SHELL:true,RICOTTA_MAC_SHELL:true,RICOTTA_SEE_THROUGH:true,RICOTTA_THEME:'ocean',RICOTTA_APP_ICON:'sky'});
  assert.deepEqual(await cls(),['mac-shell','see-through','theme-ocean']);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)','the page is see-through');
  assert.deepEqual(await settingsRows(page),[true,12]);
  assert.equal(await page.locator('[data-mac-icon="sky"]').getAttribute('aria-checked'),'true');
  await page.evaluate(()=>document.getElementById('seeThroughSwitch').click());
  await page.locator('[data-mac-theme="rose"]').click();await page.locator('[data-mac-icon="dark"]').click();
  assert.deepEqual(await page.evaluate(()=>window.__posted.filter(w=>/^(see-through|theme|icon)/.test(w))),['see-through-off','theme:rose','icon:dark'],'only fixed words are sent');
  assert.deepEqual(await cls(),['mac-shell','theme-rose']);
  // The app's own words (View menu) switch them back; unknown words are ignored.
  await page.evaluate(()=>['see-through-on','theme:ricotta','icon:mint','theme:evil','icon:<b>'].forEach(w=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:w}))));
  assert.deepEqual(await cls(),['mac-shell','see-through']);
  assert.equal(await page.locator('#seeThroughSwitch').isChecked(),true);
  assert.equal(await page.locator('[data-mac-icon="mint"]').getAttribute('aria-checked'),'true');
  assert.deepEqual(errors,[]);await ctx.close();}
 console.log('Mac shell UI PASS: mac-shell, see-through and theme classes only with the Mac app\'s flag; Settings rows only in the Mac app; fixed words both ways');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
