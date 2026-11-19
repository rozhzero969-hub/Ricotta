/* Offline mode, in a browser, on Ricotta Lab (lab/lab-mock.js answers the API; it answers nothing while
   the browser is offline, like the real server). The page and its files are served through the test's
   own route, so the app can also be reloaded with the connection off.
   - Every tab opens offline with the data saved last time and "Offline, showing data from ..." (Rozh,
     Yunis and Ahmad), also after a reload with no connection.
   - What needs the internet is grayed out and a tap says why (Check now, Rico, Admin, sign-in).
   - A recipe edit and a settings change made offline survive a reload, show "Will be sent when online",
     and are each sent once when the connection comes back; everything refreshes by itself.
   - A recipe changed on another phone meanwhile comes back as a conflict: the copy is kept, with "Send
     mine anyway" and "Discard mine".
   - Another account opened on the phone while offline never sees the first account's saved data, and
     signing out removes that account's saved copies. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'lab/dist');
cp.execFileSync('sh',['lab/build.sh'],{cwd:repo});
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json','.txt':'text/plain'};
const SITE='http://localhost:47123/';   // localhost: a secure context (crypto.randomUUID), never really listened on
const wait=async(fn,what,ms=8000)=>{const end=Date.now()+ms;for(;;){if(await fn())return;if(Date.now()>end)throw new Error('timed out: '+what);await new Promise(r=>setTimeout(r,50));}};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  // The site through a route: it still loads when the browser is offline (a reload with no connection).
  await context.route(SITE+'**',route=>{
   let p=decodeURIComponent(new URL(route.request().url()).pathname);if(p==='/')p='/index.html';
   const file=path.resolve(root,'.'+p);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:TYPES[path.extname(file)]||'application/octet-stream'});
  });
  await context.addInitScript(()=>{
   window.__ricottaStillForTests=true;
   const x='ricottaOrders:',day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(!localStorage.getItem(x+'lang'))localStorage.setItem(x+'lang','"en"');
   localStorage.setItem(x+'pushBannerSnoozedAt',String(Date.now()));localStorage.setItem(x+'newsSeen','"2099"');
   for(const a of ['rozha','yunis','ahmad']){for(const k of ['toured:','xtSeen:','rcSeen2:','rcSeen:'])localStorage.setItem(x+k+a,'true');localStorage.setItem(x+'ricoBriefing:'+a,JSON.stringify(day));}
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Every write the app sends to the API (the Lab's own fetch, wrapped once per page load).
  const logWrites=()=>page.evaluate(()=>{if(window.__writes)return;window.__writes=[];const f=window.fetch;window.fetch=(input,init={})=>{const url=typeof input==='string'?input:input.url;const m=(init.method||'GET').toUpperCase();if(url.includes('/functions/v1/api/')&&m!=='GET'&&navigator.onLine)window.__writes.push(m+' '+url.split('/functions/v1/api/')[1].split('?')[0]);return f(input,init);};});
  const writes=()=>page.evaluate(()=>window.__writes||[]);
  const ready=async account=>{await page.waitForFunction(a=>typeof state!=='undefined'&&state.account===a&&document.querySelector('.content'),account);await page.waitForTimeout(150);};
  const go=async view=>{await page.evaluate(v=>{state.adminPage=null;goView(v);},view);await page.waitForFunction(v=>state.view===v,view);await page.waitForTimeout(250);};
  const setOffline=async on=>{await context.setOffline(on);await page.waitForFunction(o=>document.documentElement.classList.contains('offline')===o,on);};
  const views=()=>page.evaluate(()=>navOrder().filter(v=>!['queue','suppliers','itemsAdmin','units'].includes(v)));
  const signInAs=async account=>{await page.evaluate(a=>{localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'lab-'+a,account:a,name:a,expiresAt:new Date(Date.now()+86400000).toISOString()}));},account);await page.reload();await ready(account);};
  const loadFailed='Couldn’t reach the server';
  // Each tab online, so this phone keeps a copy of each.
  const visitAll=async()=>{for(const v of await views()){await go(v);await page.waitForTimeout(400);}};
  // Each tab offline: the note at the top, the screen's data, and never "Couldn't reach the server".
  const checkAllOffline=async(account,expect)=>{
   for(const v of await views()){
    await go(v);
    await page.waitForTimeout(300);
    const main=await page.locator('#mainContent').innerText();
    assert.ok(!main.includes(loadFailed),`${account} ${v}: opens from the saved copy`);
    if(v==='assistant'){assert.equal(await page.locator('#ricoInput').getAttribute('placeholder'),'Rico needs the internet',`${account}: Rico says he needs the internet`);continue;}
    if(v==='receipts'||v==='transfers'){assert.ok(await page.locator('.rr-offline').count()>0,`${account} ${v}: its own offline line`);continue;}
    assert.match(await page.locator('#offlineSlot .offline-note').innerText(),/^Offline, showing data from \d{1,2}:\d{2}\s?[AP]M\./,`${account} ${v}: the offline line with the time`);
    if(expect[v])assert.ok(await expect[v](),`${account} ${v}: shows its saved data`);
   }
  };

  // 1. Rozh: every tab online, then offline (in place and after a reload with no connection).
  await page.goto(SITE);await ready('rozha');
  const rozhaItems=await page.evaluate(()=>state.items.length);assert.ok(rozhaItems>10);
  await visitAll();
  const rozhaExpect={
   order:async()=>(await page.evaluate(()=>state.items.length))===rozhaItems,
   history:async()=>(await page.evaluate(()=>state.history.length))>0,
   recipes:async()=>(await page.locator('[data-rc-open]').count())>0,
   recipeItems:async()=>(await page.locator('[data-rc-ingredient]').count())>0,
   stock:async()=>(await page.locator('.stk-row').count())>0,
   admin:async()=>(await page.locator('#adminSlot .adh-row').count())>0,
  };
  await setOffline(true);
  await checkAllOffline('rozha (in place)',rozhaExpect);
  await page.reload();await ready('rozha');
  assert.equal(await page.evaluate(()=>state.apiOnline),false);
  await checkAllOffline('rozha (reloaded offline)',rozhaExpect);

  // 2. Grayed out with the reason: Check now (Stock), Rico, an Admin action.
  await go('stock');
  const check=page.locator('.stk-meta-row [data-rr-check]');
  assert.equal(await check.count(),1,'Check now is on Stock');
  assert.ok(Number(await check.evaluate(el=>getComputedStyle(el).opacity))<.5,'Check now is grayed out');
  await page.evaluate(()=>{window.__checks=0;const f=window.fetch;window.fetch=(i,o={})=>{if(String(typeof i==='string'?i:i.url).includes('rico/check-now'))window.__checks++;return f(i,o);};});
  await check.click();
  await wait(async()=>/needs the internet/.test(await page.locator('#toast').innerText().catch(()=>'')),'Check now says why');
  assert.equal(await page.evaluate(()=>window.__checks),0,'and asks nothing of the server');
  await go('assistant');
  await page.locator('#ricoInput').fill('How much milk?');
  await page.locator('#ricoSendBtn').click();
  await wait(async()=>/Rico needs the internet/.test(await page.locator('#toast').innerText().catch(()=>'')),'Rico says why');
  assert.equal(await page.locator('#ricoInput').inputValue(),'How much milk?','the message stays in the box');
  await page.locator('#ricoInput').fill('');
  await go('admin');
  await page.evaluate(()=>{state.adminPage='health';render();});
  await page.locator('#healthCheck').waitFor();
  assert.ok(Number(await page.locator('#healthCheck').evaluate(el=>getComputedStyle(el).opacity))<.5,'Admin actions are grayed out');
  await page.locator('#healthCheck').click();
  await wait(async()=>/needs the internet/.test(await page.locator('#toast').innerText().catch(()=>'')),'Admin says why');
  await page.evaluate(()=>{state.adminPage=null;});

  // 3. A recipe edit and a settings change offline: kept, shown as waiting, kept through a reload.
  await go('recipes');
  const recipe=await page.evaluate(()=>{const r=recipeBook.data.recipes[0];return {id:r.id,name:r.name,version:r.version};});
  await page.locator(`[data-rc-open="${recipe.id}"]`).click();
  await page.locator('#rcEdit').click();
  await page.locator('#rcName').fill(recipe.name+' offline');
  await page.locator('#rcDone').click();
  await page.locator('#rcEdit').waitFor();
  await page.locator('#rcBack').click();
  await page.locator(`[data-rc-open="${recipe.id}"] .rc-pending`).waitFor();
  assert.match(await page.locator(`[data-rc-open="${recipe.id}"]`).innerText(),/offline[\s\S]*Will be sent when online/,'the list shows the edit, waiting');
  assert.match(await page.locator('#offlineSlot .offline-note').innerText(),/1 change will be sent when online\./);
  await go('settings');
  const compact=page.locator('[data-feature="compactRows"]');
  const was=await compact.isChecked();
  await compact.click({force:true});
  await wait(async()=>/Will be sent when online/.test(await page.locator('#toast').innerText().catch(()=>'')),'the setting says it waits');
  assert.equal(await page.evaluate(()=>queuedChanges().length),2,'two changes wait on this phone');
  // The queue survives a reload with no connection.
  await page.reload();await ready('rozha');
  assert.equal(await page.evaluate(()=>queuedChanges().length),2,'still waiting after the reload');
  await go('settings');
  assert.equal(await page.locator('[data-feature="compactRows"]').isChecked(),!was,'the setting shows as changed');
  await go('recipes');
  assert.match(await page.locator(`[data-rc-open="${recipe.id}"]`).innerText(),/offline[\s\S]*Will be sent when online/,'the recipe shows as changed');
  // Back online: each sent once, and everything reads again by itself.
  await logWrites();
  await setOffline(false);
  await wait(async()=>(await page.evaluate(()=>queuedChanges().length))===0,'the waiting changes are sent',12000);
  await page.waitForTimeout(600);
  const sent=await writes();
  assert.equal(sent.filter(w=>w==='PUT recipes/'+recipe.id).length,1,'the recipe edit is sent once: '+sent.join(', '));
  assert.equal(sent.filter(w=>w==='PUT settings').length,1,'the setting is sent once');
  const lab=await page.evaluate(id=>{const d=labDb();const R=d.recipeBook||d.recipes||d.rc;return {settings:d.settings?.rozha||{},recipe:JSON.stringify(d).includes('offline')};},recipe.id);
  assert.equal(lab.settings.compactRows,!was,'the setting is saved on the server');
  assert.ok(lab.recipe,'the recipe edit is saved on the server');
  await wait(async()=>(await page.locator(`[data-rc-open="${recipe.id}"] .rc-pending`).count())===0,'the waiting label goes once sent');
  assert.equal(await page.locator('#offlineSlot .offline-note').count(),0,'the offline line goes');

  // 4. Changed on another phone meanwhile: the conflict keeps this copy, and "Send mine anyway" sends it.
  await setOffline(true);
  await page.locator(`[data-rc-open="${recipe.id}"]`).click();
  await page.locator('#rcEdit').click();
  await page.locator('#rcName').fill('Mine offline');
  await page.locator('#rcDone').click();
  await page.locator('#rcEdit').waitFor();
  await page.locator('#rcBack').click();
  await page.evaluate(id=>{const s=JSON.stringify(labDb());const d=labDb();const find=o=>{if(!o||typeof o!=='object')return null;if(Array.isArray(o)){for(const x of o){const f=find(x);if(f)return f;}return null;}if(o.id===id&&'version' in o&&o.data)return o;for(const k of Object.keys(o)){const f=find(o[k]);if(f)return f;}return null;};const r=find(d);r.version+=1;r.name='Theirs';localStorage.setItem('ricottaLab:db',JSON.stringify(d));return s.length;},recipe.id);
  await setOffline(false);
  await page.locator('.offline-failed').waitFor({timeout:12000});
  assert.match(await page.locator('.offline-failed').innerText(),/Not sent: Mine offline[\s\S]*another phone/);
  assert.equal(await page.evaluate(()=>queuedChanges().length),1,'the copy stays on this phone');
  assert.match(await page.locator(`[data-rc-open="${recipe.id}"]`).innerText(),/Mine offline/,'and still shows');
  await page.locator('[data-chg-retry]').click();
  await wait(async()=>(await page.evaluate(()=>queuedChanges().length))===0,'sent over the newer copy');
  await wait(async()=>/Mine offline/.test(await page.locator(`[data-rc-open="${recipe.id}"]`).innerText()),'shows the sent copy');
  assert.equal(await page.locator('.offline-failed').count(),0);

  // 5. Yunis and Ahmad: each tab offline from their own copies.
  await signInAs('yunis');
  const yunisItems=await page.evaluate(()=>state.items.length);
  await visitAll();
  await setOffline(true);
  await page.reload();await ready('yunis');
  await checkAllOffline('yunis',{order:async()=>(await page.evaluate(()=>state.items.length))===yunisItems});
  await setOffline(false);
  await signInAs('ahmad');
  await visitAll();
  await setOffline(true);
  await page.reload();await ready('ahmad');
  await checkAllOffline('ahmad',{recipes:async()=>(await page.locator('[data-rc-open]').count())>0,minibar:async()=>(await page.locator('.mb-row').count())>0});

  // 6. Another account on this phone while offline: nothing of the first account's shows.
  await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('ricottaOrders:')&&k.includes('yunis')&&!k.includes('apiSession'))localStorage.removeItem(k);});
  await page.evaluate(()=>new Promise(r=>{const q=indexedDB.open('ricotta-offline',1);q.onsuccess=()=>{const tx=q.result.transaction('copies','readwrite');tx.objectStore('copies').delete(IDBKeyRange.bound('yunis|','yunis|￿'));tx.oncomplete=()=>{q.result.close();r();};};}));
  const ahmadRecipe=await page.evaluate(()=>recipeBook.data.recipes[0].name);
  await signInAs('yunis');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>state.items.length+state.history.length),0,'no catalog or orders from another account');
  for(const v of await views()){
   await go(v);
   const text=await page.locator('#app').innerText();
   assert.ok(!text.includes(ahmadRecipe),`Yunis ${v}: no recipe of Ahmad's`);
   if(!['receipts','transfers','assistant'].includes(v))assert.match(await page.locator('#offlineSlot').innerText(),/This phone has not saved this page yet/,`Yunis ${v}: says nothing is saved`);
  }
  // Signing in needs the internet: the sign-in keys are grayed out and say why.
  await page.evaluate(()=>signOut());
  await page.locator('.keypad').waitFor();
  assert.match(await page.locator('#pinLabel').innerText(),/Signing in needs the internet/);
  assert.ok(await page.locator('[data-key="1"]').isDisabled(),'the keys wait for the connection');
  await setOffline(false);
  await wait(async()=>!(await page.locator('[data-key="1"]').isDisabled()),'the keys come back online');

  // 7. Signing out removes that account's saved copies (another account's stay until it signs out).
  await signInAs('ahmad');
  const keys=()=>page.evaluate(()=>new Promise(r=>{const q=indexedDB.open('ricotta-offline',1);q.onsuccess=()=>{const g=q.result.transaction('copies').objectStore('copies').getAllKeys();g.onsuccess=()=>{q.result.close();r(g.result);};};}));
  await wait(async()=>(await keys()).some(k=>k.startsWith('ahmad|')),'Ahmad has saved copies');
  await page.evaluate(()=>doLogout());
  await page.locator('.keypad').waitFor();
  await wait(async()=>!(await keys()).some(k=>k.startsWith('ahmad|')),'signing out removes them');
  assert.ok((await keys()).some(k=>k.startsWith('rozha|')),'Rozh\'s copies stay until Rozh signs out');

  assert.deepEqual(errors,[],'no page errors');
  console.log('Offline UI smoke PASS: every tab offline from its own account\'s copy (Rozh, Yunis, Ahmad, also after an offline reload), grayed actions say why, a recipe edit and a setting wait through a reload and are sent once, a conflict keeps the copy, no data across accounts, sign-out clears the copies');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
