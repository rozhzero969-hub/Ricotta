const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'lab/dist');
cp.execFileSync('sh',['lab/build.sh'],{cwd:repo});
const siteRoot=process.env.UI_SITE_DIR?path.resolve(process.env.UI_SITE_DIR):root;
const server=http.createServer((req,res)=>{
 if(req.url==='/__frame-parent.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><body></body></html>');}
 if(process.env.UI_SITE_DIR && req.url==='/__fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(repo,'lab/lab-mock.js')));}
 const file=path.resolve(siteRoot,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(siteRoot+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}if(process.env.UI_SITE_DIR && file.endsWith('/index.html'))data=Buffer.from(data.toString().replace('<head>','<head><script src="/__fixture.js"></script>'));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('ricottaOrders:lang','"en"'));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#itemSearch').waitFor();
  await page.waitForFunction(()=>state.items.length>10);
  assert.deepEqual(await page.locator('.bottomnav > [data-view]').evaluateAll(els=>els.map(el=>el.dataset.view)),['order','history','transfers','manage'],'Rozha has Transfers from the start');
  assert.equal(await page.locator('.hero-card,.streak-chip').count(),2,'summary board and kitchen streak remain');
  assert.equal(await page.locator('.order-options').count(),0,'the Order screen has no fold');
  assert.equal(await page.locator('#clearOrderBtn').isVisible(),true,'Clear order is shown directly');
  assert.equal(await page.locator('#clearOrderBtn').isDisabled(),true,'and waits for something to clear');
  await page.locator('.bottomnav [data-view="manage"]').click();
  await page.waitForFunction(()=>!document.querySelector('.content.gliding'));
  await page.locator('[data-manage-view="suppliers"]').click();
  await page.locator('#supAddBtn').waitFor();
  assert.equal(await page.locator('.bottomnav [data-view="manage"]').getAttribute('aria-current'),'page');
  await page.locator('[data-manage-view="units"]').click();
  await page.locator('.unit-chip').first().waitFor();
  assert.equal(await page.locator('[data-manage-view="settings"]').count(),0,'Settings is not inside Manage');
  await page.locator('#accountBtn').click();
  await page.locator('[data-account-go="settings"]').click();
  await page.waitForSelector('.account-sheet',{state:'detached'});
  await page.locator('[data-dark="on"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),true);
  assert.equal(await page.locator('.theme-btn,.faceid-btn,#faceIdToggle,#pref-weatherFx').count(),0,'retired features have no UI');
  await page.locator('[data-dark="off"]').click();
  await page.locator('.bottomnav [data-view="order"]').click();
  await page.waitForFunction(()=>!document.querySelector('.content.gliding'));
  const nav=async view=>{await page.evaluate(v=>goView(v),view);await page.waitForFunction(v=>document.getElementById('app').dataset.screen===v,view);};
  await page.evaluate(()=>{state.items.find(i=>i.id==='it-tom').aliases=['Fresh tomato'];render();});
  assert.equal(await page.locator('.item-alias').count(),0,'aliases do not crowd order rows');
  await page.locator('#itemSearch').fill('tomtao fresh');
  assert.equal(await page.locator('#orderResults [data-item-id="it-tom"]').count(),1);
  await page.locator('#itemSearchClear').click();
  await page.waitForFunction(()=>document.querySelectorAll('#orderResults .item-row').length>10);
  assert.ok(await page.locator('#orderResults .item-row').count()>10);
  await nav('itemsAdmin');
  assert.equal(await page.locator('.page-heading h1').textContent(),'Items','Items has its own title');
  assert.equal(await page.locator('.catalog-search > svg').evaluate(el=>getComputedStyle(el).position),'absolute','search icon cannot overlap the input');
  assert.equal(await page.locator('.list-row').first().evaluate(el=>getComputedStyle(el).backdropFilter),'none','static list rows avoid expensive blur');
  await page.locator('#catalogSearch').fill('tomtao');
  assert.equal(await page.locator('.table-list [data-edititem="it-tom"]').isVisible(),true,'a typo still finds the item (phones show the list)');
  assert.equal(await page.locator('.data-table [data-edititem="it-tom"]').isVisible(),false,'the wide table stays hidden on phones');
  assert.ok(await page.locator('.list-row:visible').count()<5);
  await page.locator('#catalogSearch').fill('zzzxxxx');
  assert.equal(await page.locator('.list-row:visible').count(),0);
  assert.equal(await page.locator('#catalogSearchEmpty').isVisible(),true);
  await page.locator('#catalogSearchClear').click();
  assert.ok(await page.locator('.list-row:visible').count()>10);
  // The search sheet (Ctrl/Cmd+K): "tomato 5" sets the quantity, the clear mark is the app's own, Escape closes.
  await page.keyboard.press('Control+KeyK');
  await page.locator('#spotInput').waitFor();
  assert.equal(await page.locator('.spot-clear').isVisible(),false,'no clear mark while the field is empty');
  await page.locator('#spotInput').fill('tomato 5');
  assert.equal(await page.locator('.spot-clear').isVisible(),true);
  assert.match(await page.locator('.spot-row.active').textContent(),/Tomatoes.*5/,'"tomato 5" offers to set Tomatoes to 5 first');
  await page.keyboard.press('Enter');
  await page.locator('.spot-layer').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>state.cart['it-tom']),5,'Enter sets the quantity');
  await page.keyboard.press('Control+KeyK');await page.locator('#spotInput').fill('zzqqxx');
  assert.match(await page.locator('.spot-empty').textContent(),/No results/,'nothing found says so plainly');
  await page.locator('.spot-clear').click();
  assert.deepEqual([await page.locator('#spotInput').inputValue(),await page.locator('.spot-clear').isVisible(),await page.evaluate(()=>document.activeElement.id)],['',false,'spotInput'],'clearing keeps the field ready to type');
  // The best matches first: "tom" finds Tomatoes, never "Automatic", and what was typed is marked.
  await page.locator('#spotInput').fill('tom');
  assert.match(await page.locator('.spot-row.active').textContent(),/Tomatoes/,'the item comes first');
  assert.doesNotMatch(await page.locator('.spot-list').textContent(),/Automatic/,'actions only match where a word starts');
  assert.equal(await page.locator('.spot-row.active mark').first().textContent(),'Tom','what was typed is marked');
  // − and + right in the results; only that row changes and the highlight stays on it.
  await page.evaluate(()=>{state.cart={};persistCartDraft();});
  await page.locator('#spotInput').fill('tomatoes');
  await page.locator('[data-spot-item="it-tom"] [data-spot-add]').click();
  await page.locator('[data-spot-item="it-tom"] [data-spot-add]').click();
  assert.equal(await page.evaluate(()=>state.cart['it-tom']),2,'+ adds right in the results');
  assert.equal(await page.locator('[data-spot-item="it-tom"] .spot-qty').textContent(),'2','and shows the amount');
  await page.locator('[data-spot-item="it-tom"] [data-spot-dec]').click();
  assert.equal(await page.evaluate(()=>state.cart['it-tom']),1,'− takes one back');
  assert.match(await page.locator('.spot-row.active').textContent(),/Tomatoes/,'the highlight stays on the row');
  // Scopes narrow it down.
  await page.locator('#spotInput').fill('a');
  await page.locator('[data-spot-scope="suppliers"]').click();
  assert.ok(await page.locator('.spot-row').count()>0 && await page.locator('[data-spot-item]').count()===0,'Suppliers shows only suppliers');
  await page.locator('[data-spot-scope="all"]').click();
  // A switch flips in place and the search stays open.
  await page.locator('#spotInput').fill('compact');
  const compact=await page.evaluate(()=>prefOn('compactRows'));
  await page.locator('.spot-toggle').first().click();
  assert.equal(await page.evaluate(()=>prefOn('compactRows')),!compact,'a switch flips in place');
  assert.equal(await page.locator('.spot-toggle').first().getAttribute('aria-checked'),String(!compact),'and shows it');
  await page.locator('.spot-toggle').first().click();
  // Nothing found still offers Rico, who can answer what search cannot.
  await page.locator('#spotInput').fill('zzqqxx');
  assert.match(await page.locator('.spot-ask').textContent(),/Ask Rico/,'Ask Rico under "No results"');
  // A day written the Iraqi way finds that day's orders.
  const day=await page.evaluate(()=>{const o=state.history[0];const d=erbilDate(o.date);return Number(d.slice(8))+'/'+Number(d.slice(5,7));});
  await page.locator('#spotInput').fill(day);
  assert.ok(await page.locator('.spot-row .spot-ic').count()>0 && /Orders/i.test(await page.locator('.spot-group-title').first().textContent()),'"'+day+'" finds that day');
  // What was opened lately comes back first, and can be cleared.
  await page.locator('#spotInput').fill('basil');await page.keyboard.press('Enter');
  await page.locator('.spot-layer').waitFor({state:'detached'});
  await page.keyboard.press('Control+KeyK');await page.locator('#spotInput').waitFor();
  assert.match(await page.locator('.spot-group').first().textContent(),/Recent.*Basil/s,'Recent shows what was opened');
  await page.locator('[data-spot-forget]').click();
  assert.doesNotMatch(await page.locator('.spot-list').textContent(),/Recent/,'and Clear forgets it');
  await page.keyboard.press('Escape');await page.locator('.spot-layer').waitFor({state:'detached'});
  // Closing animates (it used to vanish at once): the panel lifts away, then the layer goes.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.keyboard.press('Control+KeyK');await page.locator('#spotInput').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'spotInput','the field is ready at once (iPhone keyboards need that)');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>{ const p=document.querySelector('.spot-layer.out .spot-panel'); return p ? getComputedStyle(p).animationName : 'gone'; }),'spotOut','the panel lifts away');
  await page.locator('.spot-layer').waitFor({state:'detached',timeout:1500});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.keyboard.press('Escape');await page.locator('.spot-layer').waitFor({state:'detached'});
  await page.evaluate(()=>{state.cart={};persistCartDraft();});
  await nav('history');
  await page.locator('#catalogSearch').fill('tomato');
  assert.ok(await page.locator('.hist-card:visible').count()>0,'history matches current aliases');
  await page.evaluate(()=>{state.activity=Array.from({length:50},(_,n)=>({name:n===49?'Special item':'Ordinary '+n,action:'edit',type:'item',ts:new Date().toISOString(),fields:[],actor:'rozha'}));goView('record');});
  await page.waitForFunction(()=>document.getElementById('app').dataset.screen==='record');
  await page.locator('#catalogSearch').fill('Special');
  assert.equal(await page.locator('.rec-card:visible').count(),1,'records beyond first page can be found');
  await page.locator('#catalogSearch').fill('zzzxxxx');
  assert.equal(await page.locator('#catalogSearchEmpty').isVisible(),false,'Record uses one empty state');
  assert.match(await page.locator('#recordResults').textContent(),/No matches/i);
  await page.locator('#catalogSearchClear').click();
  assert.ok(await page.locator('.rec-card:visible').count()>1);
  assert.equal(await page.evaluate(()=>{
    const seg=document.querySelector('.record-filters.seg'),buttons=seg.querySelectorAll('.tab-pill');
    const start=buttons[0].getBoundingClientRect(),end=buttons[1].getBoundingClientRect();
    const x=start.left+start.width/2,y=start.top+start.height/2,to=end.left+end.width/2;
    buttons[0].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:21,pointerType:'touch',clientX:x,clientY:y}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:21,pointerType:'touch',clientX:to,clientY:y}));
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:21,pointerType:'touch',clientX:to,clientY:y}));
    document.querySelector('.bottomnav [data-view="manage"]').click();
    return state.view;
  }),'manage','a filter drag does not swallow the next navigation tap');
  await nav('units');
  await page.locator('#catalogSearch').fill('kilogram');
  await page.locator('#catalogSearchClear').click();
  assert.ok(await page.locator('.unit-chip:visible').count()>5);
  await page.evaluate(()=>{
    const item=state.items.find(i=>i.id==='it-mozz');
    rico.messages.push({role:'assistant',text:'Review these aliases.',ts:Date.now(),proposals:[{id:'alias-test',kind:'item_aliases',status:'pending',entries:[{itemId:item.id,name:item.name,before:[],aliases:['Mozzarella cheese']}]}]});
    goView('assistant');
  });
  await page.waitForFunction(()=>document.getElementById('app').dataset.screen==='assistant');
  assert.match(await page.locator('[data-rico-apply$="alias-test"]').locator('..').locator('..').textContent(),/Mozzarella cheese/);
  await page.locator('[data-rico-apply$="alias-test"]').click();
  await page.waitForFunction(()=>state.items.find(i=>i.id==='it-mozz').aliases?.includes('Mozzarella cheese'));
  assert.deepEqual(await page.evaluate(()=>labDb().items.find(i=>i.id==='it-mozz').aliases),['Mozzarella cheese']);
  // Stored chat data is another user's input, including its HTML attributes.
  const hostile=await page.evaluate(()=>{
    const payload='"><img src=x onerror="window.injected=true">';
    const holder=document.createElement('div');
    holder.innerHTML=renderRicoMessage({role:'assistant',text:payload,mood:payload,proposals:[{id:'test',kind:'notify',status:payload,title:payload,en:payload,ku:payload}]},0);
    state.items.push({id:'hostile-item',name:payload,supplierId:'hostile-supplier',unit:'kg'});
    state.suppliers.push({id:'hostile-supplier',name:'__proto__'});
    const order=renderRicoProposal({kind:'order',id:'proto',mode:'add',draftBefore:{},lines:[{itemId:'hostile-item',supplier:'__proto__',name:payload,qty:1,unitId:'kg'}]},0);
    const applied=document.createElement('div');applied.innerHTML=renderRicoProposal({kind:'order',id:'injected-amount',mode:'add',status:'applied',appliedBefore:{'hostile-item':payload},appliedAfter:{'hostile-item':payload+'x'},lines:[{itemId:'hostile-item',qty:1,unitId:'kg'}]},0);
    const appliedInjection=applied.querySelectorAll('img,[onerror]').length;
    state.items.pop();state.suppliers.pop();
    return {injected:holder.querySelectorAll('img,[onerror]').length,text:holder.textContent,orderSafe:order.includes('&lt;img'),appliedInjection,malformed:renderRicoProposal({kind:'order',lines:null},0)};
  });
  assert.equal(hostile.injected,0,'saved moods/card status/text cannot inject HTML');
  assert.ok(hostile.text.includes('<img'),'untrusted markup is displayed as text');
  assert.equal(hostile.appliedInjection,0,'stored before/after quantities cannot inject HTML');
  assert.equal(hostile.orderSafe,true,'a supplier named __proto__ cannot crash grouping');
  assert.equal(hostile.malformed,'','malformed saved cards cannot break the chat screen');
  // Exercise the real verification dialog using a local provider stub. It checks and continues by
  // itself: no Continue and no Cancel; Try Again appears only when the check fails.
  await page.evaluate(()=>{
    authSecurityConfig=async()=>({ok:true,data:{required:true,siteKey:'local-test'}});
    window.turnstile={render:(el,opts)=>{window.proofOptions=opts;el.innerHTML='<div style="width:150px;height:140px">Local verification</div>';return 'local-widget';},remove:()=>{window.proofRemoved=true;}};
    window.proofResult=authBotProof();
  });
  await page.locator('#authChallenge').waitFor({state:'attached'});
  assert.equal(await page.locator('.modal-challenge button:visible').count(),0,'no buttons while it checks');
  assert.equal(await page.locator('#modalFormCancel, #modalFormOk').count(),0,'no Cancel and no Continue');
  const alignment=await page.locator('#authChallenge').evaluate(el=>{const frame=el.firstElementChild.getBoundingClientRect(),body=el.getBoundingClientRect();return Math.abs((frame.left+frame.right)-(body.left+body.right));});
  assert.ok(alignment<2,'verification widget is centred');
  await page.evaluate(()=>proofOptions['expired-callback']());
  assert.equal(await page.locator('#challengeRetry').isVisible(),true,'an expired check offers Try Again');
  await page.locator('#challengeRetry').click();
  assert.equal(await page.locator('#challengeRetry').isVisible(),false,'Try Again starts a fresh check');
  await page.evaluate(()=>{proofOptions.callback('fresh-token');proofOptions.callback('duplicate-token');});
  assert.deepEqual(await page.evaluate(()=>proofResult),{token:'fresh-token'},'success continues automatically exactly once');
  assert.equal(await page.evaluate(()=>proofRemoved),true,'widget is cleaned up');
  await page.evaluate(()=>{window.proofResult=authBotProof();});
  await page.locator('#authChallenge').waitFor({state:'attached'});
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(()=>proofResult),{error:'cancelled'},'a keyboard can still leave with Escape');
  await page.evaluate(()=>proofOptions.callback('late-token'));
  assert.deepEqual(await page.evaluate(()=>proofResult),{error:'cancelled'},'late success cannot undo cancellation');
  await page.evaluate(()=>{window.turnstile.render=()=>{throw Error('provider failed');};window.proofResult=authBotProof();});
  await page.locator('#authChallenge').waitFor({state:'attached'});
  assert.match(await page.locator('.modal-challenge .modal-status').textContent(),/could not finish/);
  assert.equal(await page.locator('#challengeRetry').isVisible(),true,'a provider failure offers Try Again');
  await page.evaluate(()=>dismissAllModals());
  assert.deepEqual(await page.evaluate(()=>proofResult),{error:'cancelled'},'closing every popup (sign-out) ends the check');
  // F26: search is a real modal. Tab and Shift+Tab stay inside it, and the page behind is inert.
  await page.evaluate(()=>{ dismissAllModals(); goView('order'); });
  await page.keyboard.press('Control+KeyK');await page.locator('#spotInput').waitFor();
  await page.locator('#spotInput').fill('tom');
  for(let i=0;i<8;i++){ await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.spot-layer')),true,'Shift+Tab stays inside search'); }
  for(let i=0;i<8;i++){ await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.spot-layer')),true,'Tab stays inside search'); }
  assert.equal(await page.evaluate(()=>document.getElementById('app').inert),true,'the page behind is inert');
  await page.keyboard.press('Escape');await page.locator('.spot-layer').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.getElementById('app').inert),false,'and comes back when search closes');
  // F03 + F04: the session ran out while search was open. The next request signs out (no stuck screen), and the
  // old account's search results go with it at once.
  await page.keyboard.press('Control+KeyK');await page.locator('#spotInput').waitFor();
  await page.locator('#spotInput').fill('tomato');
  await page.evaluate(()=>{ const k='ricottaOrders:apiSession'; const s=JSON.parse(localStorage.getItem(k)); s.expiresAt=new Date(Date.now()-1000).toISOString(); localStorage.setItem(k,JSON.stringify(s)); });
  const expired=await page.evaluate(()=>api('draft'));
  assert.equal(expired.status,401,'an expired session is not treated as a stale reply');
  assert.equal(await page.evaluate(()=>state.account),null,'the workspace is cleared');
  assert.equal(await page.locator('.spot-layer').count(),0,'search closes with the old account');
  assert.equal(await page.evaluate(()=>lget('apiSession')),null,'the old session is removed');
  await page.locator('.keypad,.signin-map,#app').first().waitFor();
  const framed=await browser.newPage();
  await framed.goto('http://127.0.0.1:'+server.address().port+'/__frame-parent.html');
  await framed.setContent('<iframe src="http://127.0.0.1:'+server.address().port+'/"></iframe>');
  const embedded=framed.frameLocator('iframe');
  await embedded.locator('#app').getByText('Open Ricotta directly to sign in.').waitFor();
  assert.equal(await embedded.locator('.keypad,.content').count(),0,'embedded app exposes neither sign-in nor authenticated workspace');
  await framed.close();
  assert.deepEqual(errors,[]);
  console.log('Search UI PASS: search is a modal (focus kept inside, page inert), an expired session signs out and closes search, typo/alias order, clear buttons, the search sheet (tomato 5, best matches first, − and + in place, scopes, switches, Ask Rico, dates, Recent, closing animation, clear, nothing found, Escape), list matches/empty/reset, history aliases, records beyond first page, units and Rico bulk alias preview/save');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
