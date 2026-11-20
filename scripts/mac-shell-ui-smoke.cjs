/* Browser checks for the Mac app's marks (macos/): html.mac-shell, html.see-through and html.theme-<name> apply
   only when the Mac app's flag is present, never in a browser, on a phone or in the iPhone app; the Settings
   rows for see-through, theme and app icon show only inside the Mac app and send only fixed words; the
   app's own words switch them. API calls are fixtures. */
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
const fixture={account:'rozha',name:'Rozha',views:['order','history','manage','assistant','suppliers','itemsAdmin','units','record','admin','settings'],
 suppliers:[{id:'d',name:'Dairy',phone:''}],units:[{id:'kg',en:'kg'}],items:[{id:'milk',name:'Milk',unit:'kg',supplierId:'d'}],pins:[],history:[],devices:[],activity:[],inbox:[]};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const url='http://127.0.0.1:'+server.address().port;try{
 async function open(flags, options = {}){
  const ctx=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',...options});
  await ctx.addInitScript(flags=>{Object.assign(window,flags);window.__posted=[];window.webkit={messageHandlers:{ricotta:{postMessage:w=>window.__posted.push(w)}}};
   localStorage.setItem('ricottaOrders:toured:rozha','true');localStorage.setItem('ricottaOrders:xtSeen:rozha','true');localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'mac-fixture',account:'rozha',name:'Rozha',expiresAt:'2099-01-01T00:00:00Z'}));localStorage.setItem('ricottaOrders:lang',JSON.stringify(flags.demoLang || 'en'));localStorage.setItem('ricottaOrders:aiConsent2:rozha','true');localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',String(Date.now()));},flags);
  await ctx.route('**/functions/v1/api/**',async route=>{const endpoint=new URL(route.request().url()).pathname.split('/api/')[1];let data={ok:true};
   if(endpoint==='bootstrap')data={...fixture,streak:{count:12,lit:true},draft:{cart:{},revision:0}};else if(endpoint==='draft')data={cart:{},revision:0,conflicts:[]};else if(endpoint==='auth/security')data={required:false};
   else if(['devices','activity','assistant/inbox'].includes(endpoint))data=[];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#orderResults').waitFor();await page.waitForSelector('#splash',{state:'detached'});
  return {ctx,page,errors,cls:()=>page.evaluate(()=>[...document.documentElement.classList].filter(c=>/^(mac-|see-through|theme-)/.test(c)).sort())};
 }
 const settingsRows=page=>page.evaluate(()=>{goView('settings');return ['seeThroughSwitch'].map(id=>!!document.getElementById(id)).concat(document.querySelectorAll('[data-mac-theme],[data-mac-icon]').length);});

 // A browser, a phone, the iPhone app, or someone setting only the other flags: nothing changes.
 for(const flags of [{}, {RICOTTA_NATIVE_SHELL:true}, {RICOTTA_SEE_THROUGH:true, RICOTTA_THEME:'pink', RICOTTA_APP_ICON:'dark'}, {RICOTTA_MAC_SHELL:'yes', RICOTTA_SEE_THROUGH:true}]){
  const {ctx,page,errors,cls}=await open(flags);
  assert.deepEqual(await cls(),[],'no Mac classes with '+JSON.stringify(flags));
  assert.deepEqual(await settingsRows(page),[false,0],'no Mac rows in Settings with '+JSON.stringify(flags));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'see-through-on'})));
  assert.deepEqual(await cls(),[],'the app\'s words do nothing outside the Mac app');
  assert.deepEqual(errors,[]);await ctx.close();
 }
 // Inside the Mac app with see-through off: only mac-shell; an unknown theme is ignored.
 {const {ctx,page,errors,cls}=await open({RICOTTA_NATIVE_SHELL:true,RICOTTA_MAC_SHELL:true,RICOTTA_SEE_THROUGH:false,RICOTTA_THEME:'evil'});
  assert.deepEqual(await cls(),['mac-shell']);
  // Removed themes are unknown now, so an old saved choice shows Ricotta's own colours.
  for(const old of ['graphite','ocean','rose','sand','midnight','discord']){await page.evaluate(w=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:w})),'theme:'+old);assert.deepEqual(await cls(),['mac-shell'],old);}assert.deepEqual(errors,[]);await ctx.close();}
 // Inside the Mac app, see-through on, Halloween: all three, and Settings has the rows (6 themes and 12 icons).
 {const {ctx,page,errors,cls}=await open({RICOTTA_NATIVE_SHELL:true,RICOTTA_MAC_SHELL:true,RICOTTA_SEE_THROUGH:true,RICOTTA_THEME:'halloween',RICOTTA_APP_ICON:'wedge'});
  assert.deepEqual(await cls(),['mac-shell','see-through','theme-halloween']);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)','the page is see-through');
  assert.deepEqual(await settingsRows(page),[true,18]);
  assert.deepEqual(await page.locator('[data-mac-icon]').evaluateAll(options=>options.map(b=>b.dataset.macIcon)),
    ['ricotta','pumpkin','holly','moonlit','gemini','cupid','monogram','ticket','aurora','frost','copper','stamp'],'theme icons first, then the others');
  assert.equal(await page.locator('[data-mac-icon="ricotta"]').getAttribute('aria-checked'),'true','a removed icon falls back to the default');
  // Halloween's drawings sit behind the page and never take a click.
  assert.equal(await page.locator('#macDecor').evaluate(el=>getComputedStyle(el).pointerEvents+' '+getComputedStyle(el).zIndex),'none -1');
  assert.equal(await page.locator('#macIconMatch').isHidden(),true,'no icon offer until the theme changes');
  assert.ok(await page.locator('[data-mac-icon] img').evaluateAll(imgs=>imgs.every(i=>/^mac-icons\/[a-z]+\.png$/.test(i.getAttribute('src')))),'icon pictures come from the site');
  await page.evaluate(()=>document.getElementById('seeThroughSwitch').click());
  await page.locator('[data-mac-theme="pink"]').click();
  await page.waitForFunction(()=>document.documentElement.classList.contains('theme-pink'));   // after a short cross-fade
  assert.deepEqual(await cls(),['mac-shell','theme-pink']);
  assert.equal(await page.locator('#macIconMatch').isVisible(),true,'a new theme offers its own icon');
  assert.equal(await page.locator('[data-mac-icon="ricotta"]').getAttribute('aria-checked'),'true','and never switches the icon by itself');
  await page.locator('[data-mac-icon-match]').click();
  assert.equal(await page.locator('[data-mac-icon="cupid"]').getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('#macIconMatch').isHidden(),true);
  await page.locator('[data-mac-icon="monogram"]').click();
  assert.deepEqual(await page.evaluate(()=>window.__posted.filter(w=>/^(see-through|theme|icon)/.test(w))),['see-through-off','theme:pink','icon:cupid','icon:monogram'],'only fixed words are sent');
  assert.equal(await page.locator('[data-mac-theme="pink"]').innerText(),'Cupid’s Blush');
  assert.equal(await page.locator('[data-mac-icon="gemini"]').innerText(),'Gemini');
  await page.evaluate(()=>goView('order'));
  assert.equal(await page.locator('.order-hero').evaluate(el=>getComputedStyle(el,'::after').pointerEvents),'none');
  const art = await page.locator('.order-hero').evaluate(el=>getComputedStyle(el,'::after').backgroundImage);
  assert.match(art,/fx-pk-card\.svg/);
  const artworkUrl = await page.evaluate(asset=>new URL(asset,document.querySelector('link[href*="style"]').href).href, art.match(/url\("([^"]+)"\)/)[1]);
  assert.equal((await page.request.get(artworkUrl)).status(),200,'hero artwork exists at the deployed CSS path');
  assert.equal(await page.locator('#streakChip .flame-default').isVisible(),true,'the streak keeps its flame');
  // Google shows Rico as Gemini (on screen only), and Ricotta's own name never changes.
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'theme:google'})));
  await page.waitForFunction(()=>document.documentElement.classList.contains('theme-google'));
  assert.equal(await page.locator('#ricoTopBtn').getAttribute('aria-label'),'Gemini');
  assert.equal(await page.evaluate(()=>[t('ricoName'),t('macIconHint')].join('|')),'Gemini|The icon in the Dock while Ricotta is open.');
  assert.equal(await page.locator('#macDecor').count(),0,'Google has no background drawings');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:'theme:pink'})));
  await page.waitForFunction(()=>document.documentElement.classList.contains('theme-pink'));
  assert.equal(await page.locator('#ricoTopBtn').getAttribute('aria-label'),'Rico');
  if(process.env.RICOTTA_THEME_PREVIEW_DIR) await page.screenshot({path:path.join(process.env.RICOTTA_THEME_PREVIEW_DIR,'cupid-order.png'),animations:'disabled'});
  await page.evaluate(()=>goView('settings'));
  // The app's own words (View menu) switch them back; unknown words are ignored.
  await page.evaluate(()=>['see-through-on','theme:ricotta','icon:ricotta','icon:green','theme:discord','theme:evil','icon:<b>','icon:pink'].forEach(w=>window.dispatchEvent(new CustomEvent('ricotta-mac',{detail:w}))));
  await page.waitForFunction(()=>!document.documentElement.classList.contains('theme-pink'));
  assert.deepEqual(await cls(),['mac-shell','see-through']);
  assert.equal(await page.locator('#seeThroughSwitch').isChecked(),true);
  assert.equal(await page.locator('[data-mac-icon="ricotta"]').getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('#macDecor').count(),0,'Ricotta has no drawings');
  assert.deepEqual(errors,[]);await ctx.close();}
 // A native boot keeps the same preferences while each of the six themes changes the visible palette.
 {const {ctx,page,errors}=await open({RICOTTA_NATIVE_SHELL:true,RICOTTA_MAC_SHELL:true},{reducedMotion:'reduce'});
  const checks = await page.evaluate(()=>{
   const html = document.documentElement;
   const channel = c=>c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
   const lightness = hex=>[1,3,5].reduce((v,n,i)=>v + [.2126,.7152,.0722][i] * channel(parseInt(hex.slice(n,n+2),16) / 255),0);
   return [false,true].map(dark=>{
    html.classList.toggle('dark',dark);
    return MAC_THEMES.map(name=>{
     applyMacTheme(name);
     const hero = document.querySelector('.order-hero');   // Google draws the screen again (Gemini's name)
     const styles=getComputedStyle(html), varColor=k=>styles.getPropertyValue(k).trim();
     const readable = (ink,paper)=>{
      const values=[lightness(varColor(ink)),lightness(varColor(paper))].sort((a,b)=>b-a);
      return (values[0]+.05)/(values[1]+.05);
     };
     return {name, art:getComputedStyle(hero,'::after').backgroundImage, heroBg:getComputedStyle(hero).backgroundImage,
      primary:(1.05)/(lightness(varColor('--accent-strong'))+.05), text:readable('--ink','--surface'), tint:readable('--tint','--surface')};
    });
   });
  });
  for(const palette of checks) for(const check of palette){
   // Ricotta is the app's own look: no artwork and the plain green card.
   if(check.name==='ricotta'){assert.equal(check.art,'none');assert.equal(check.heroBg,'none');continue;}
   assert.match(check.art,new RegExp('fx-'+{halloween:'hw',christmas:'xm',moonlit:'mo',google:'gg',pink:'pk'}[check.name]+'-card'));
   for(const key of ['primary','text','tint']) assert.ok(check[key]>=4.5,check.name+' contrast for '+key+': '+check[key]);
  }
  assert.deepEqual(errors,[]);await ctx.close();
 }
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
 console.log('Mac shell and Settings UI PASS: six palettes, twelve icons, Ricotta restored, Gemini name, theme drawings, contrast, desktop and touch tutorials, reduced motion, native messages');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
