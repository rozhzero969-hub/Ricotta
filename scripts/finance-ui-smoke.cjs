/* Expense UI regression checks use mocked Edge APIs; no live money/data writes. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const screenshotsDir=process.env.FINANCE_SCREENSHOTS_DIR || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(),'ricotta-ui-finance-'));
fs.mkdirSync(screenshotsDir,{recursive:true});
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const entry=(n,extra={})=>({id:id(n),date:today(),category:'food',description:'Tomatoes',supplierId:null,supplierName:'Market',amountMinor:25000,currency:'IQD',paymentMethod:'cash',notes:'',status:'active',revision:1,createdBy:'rozha',updatedBy:'rozha',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),voidReason:null,...extra});
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)] || 'application/octet-stream');res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH || undefined});
  const errors=[];
  const fulfilled=(route,status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
  async function open({account='rozha',lang='en',width=390,rows=[entry(1),entry(2,{description:'Cleaning supplies',currency:'USD',amountMinor:4567,category:'supplies',paymentMethod:'card'})]}={}){
    const fx={account,rows,calls:[],operations:new Map(),events:new Map(),nextMutation:null,deferRead:false,deferred:[],version:1,changeExport:false};
    const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:width<700,isMobile:width<700,serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true});
    await ctx.route('**/functions/v1/**',async route=>{
      const req=route.request(),u=new URL(req.url()),fn=u.pathname.split('/functions/v1/')[1].split('/')[0],ep=u.pathname.split('/functions/v1/'+fn+'/')[1] || '',method=req.method(),body=req.postDataJSON?.() || null;
      let data={ok:true},status=200;
      if(fn==='api' && ep.startsWith('finance')){
        fx.calls.push({ep:u.pathname.split('/functions/v1/api/')[1],query:u.search,method,body});
        if(method!=='GET'){
          const stored=await ctx.pages()[0].evaluate(({account,op})=>JSON.parse(localStorage.getItem('ricottaOrders:financePending:'+account+':'+op)),{account:fx.account,op:body.operationId});
          assert.ok(stored,'the financial operation is durable before the POST/PUT leaves the browser');
          assert.deepEqual(stored.body,body,'write-ahead payload exactly matches the mutation');
          const failure=fx.nextMutation;fx.nextMutation=null;
          if(failure==='abort') return route.abort('failed');
          if(failure===429) return fulfilled(route,429,{error:'Rate limited'});
          if(failure===409){const row=fx.rows.find(r=>ep.includes(r.id));if(row){row.amountMinor=33300;row.revision++;}return fulfilled(route,409,{error:'Conflict'});}
          if(fx.operations.has(body.operationId)) return fulfilled(route,200,{ok:true,expense:fx.operations.get(body.operationId)});
          let row,before=null,action;
          if(ep==='finance' && method==='POST'){
            row=entry(100+fx.rows.length,{...body,createdBy:fx.account,updatedBy:fx.account});fx.rows.unshift(row);action='create';
          }else{
            row=fx.rows.find(r=>r.id===ep.split('/')[1]);
            if(!row) return fulfilled(route,404,{error:'Not found'});
            if(row.revision!==body.expectedRevision) return fulfilled(route,409,{error:'Conflict'});
            before={...row};
            if(ep.endsWith('/void')){row.status='void';row.voidReason=body.reason;action='void';}
            else {Object.assign(row,body);action='edit';}
            row.revision++;row.updatedBy=fx.account;
          }
          const after={...row};fx.operations.set(body.operationId,after);fx.version++;
          const history=fx.events.get(row.id) || [];history.unshift({id:body.operationId,expenseId:row.id,action,actor:fx.account,at:new Date().toISOString(),before,after});fx.events.set(row.id,history);
          if(failure==='commitAbort') return route.abort('failed');
          return fulfilled(route,201,{ok:true,expense:after});
        }
        if(ep.endsWith('/events')){
          const row=fx.rows.find(r=>r.id===ep.split('/')[1]);
          const events=fx.events.get(row.id) || [{id:id(90),expenseId:row.id,action:'create',actor:row.createdBy,at:row.createdAt,before:null,after:{...row}}];
          data={events,total:events.length,limit:20,offset:0,hasMore:false};
        }else if(ep==='finance'){
          const q=u.searchParams,offset=Number(q.get('offset') || 0),limit=Number(q.get('limit') || 50);
          const filtered=fx.rows.filter(r=>(!q.get('from') || r.date>=q.get('from')) && (!q.get('to') || r.date<=q.get('to')) && (!q.get('currency') || r.currency===q.get('currency')) && (!q.get('category') || r.category===q.get('category')) && (q.get('status')==='all' || r.status===(q.get('status') || 'active')));
          const totals={IQD:{amountMinor:'0',count:0},USD:{amountMinor:'0',count:0}};
          for(const row of filtered.filter(r=>r.status==='active')){totals[row.currency].amountMinor=(BigInt(totals[row.currency].amountMinor)+BigInt(row.amountMinor)).toString();totals[row.currency].count++;}
          data={expenses:filtered.slice(offset,offset+limit).map(r=>({...r})),totals,total:filtered.length,limit,offset,hasMore:filtered.length>offset+limit,ledgerVersion:String(fx.version+(fx.changeExport && offset>0?1:0))};
          if(fx.deferRead){fx.deferRead=false;return new Promise(resolve=>fx.deferred.push(async()=>{await fulfilled(route,status,data);resolve();}));}
        }
      }else if(fn==='stock-api'){
        if(ep==='bootstrap') data={groups:[],storages:[],settings:[],counts:[],requests:[],balances:[],control:{}};
        if(ep==='requests') data={requests:[],balances:[],control:{}};
      }else if(fn==='api'){
        if(ep==='bootstrap') data={account:fx.account,name:fx.account==='rozha'?'Rozha':'Yunis',tabs:['order','assistant','history'],views:['order','assistant','history','expenses','suppliers','itemsAdmin','units','record','transfers','stock'],suppliers:[{id:'s1',name:'Market'}],items:[],units:[],history:[],devices:[],activity:[],reminder:{enabled:false,time:'09:00'},pars:[],inbox:[]};
        else if(ep==='devices' || ep==='assistant/inbox') data=[];
        else if(ep==='assistant/status') data={configured:false};
      }
      await fulfilled(route,status,data);
    });
    await ctx.addInitScript(({account,lang})=>{
      if(!localStorage.getItem('ricottaOrders:apiSession')) localStorage.setItem('ricottaOrders:apiSession',JSON.stringify({token:'t-'+account,account,name:account==='rozha'?'Rozha':'Yunis',expiresAt:'2099-01-01T00:00:00Z',tabs:['order','assistant','history']}));
      localStorage.setItem('ricottaOrders:lang',JSON.stringify(lang));localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
    },{account,lang});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(url);await page.waitForSelector('#mainContent');await page.waitForSelector('#splash',{state:'detached'});
    await page.evaluate(()=>goView('expenses'));await page.waitForFunction(()=>financeState.loaded);
    return {ctx,page,fx};
  }
  async function save(page,{description='Rice',amount='15000',currency='IQD'}={}){
    await page.locator('#finAdd').click();await page.locator('#finDescription').fill(description);await page.locator('#finCurrency').selectOption(currency);await page.locator('#finAmount').fill(amount);await page.locator('#modalFormOk').click();
  }
  const mutations=fx=>fx.calls.filter(c=>c.method!=='GET');
  try{
    let {ctx,page,fx}=await open();
    assert.equal(await page.locator('h1').count(),1,'expenses have one page heading');
    assert.match(await page.locator('#finSummary').innerText(),/25,000 IQD/);assert.match(await page.locator('#finSummary').innerText(),/45\.67 USD/);
    assert.equal(await page.evaluate(()=>financeAmount('9007199254740993','IQD')),'9,007,199,254,740,993 IQD','large totals retain exact minor units');
    for(const amount of ['1.5','-1','0','1e3','NaN','1000000000001']) assert.equal(await page.evaluate(a=>financeParseAmount(a,'IQD'),amount),null,'invalid dinar amount rejected');
    assert.equal(await page.evaluate(()=>financeParseAmount('0.01','USD')),1);assert.equal(await page.evaluate(()=>financeParseAmount('12.345','USD')),null);
    await save(page,{amount:'15.5'});await page.waitForFunction(()=>document.querySelector('#modalFormStatus')?.classList.contains('error'));
    assert.equal(mutations(fx).length,0,'fractional IQD never sends a write');
    await page.locator('#finAmount').fill('15000');await page.locator('#modalFormOk').click();await page.waitForSelector('#finDescription',{state:'detached'});await page.waitForFunction(()=>financeState.total===3);
    const first=mutations(fx)[0];assert.equal(first.body.amountMinor,15000);assert.equal(first.body.currency,'IQD');assert.ok(first.body.id && first.body.operationId);
    assert.equal(await page.evaluate(()=>financeHasPending()),false,'confirmed write clears recovery journal');
    await save(page,{description:'Gas',currency:'USD',amount:'12.34'});await page.waitForSelector('#finDescription',{state:'detached'});assert.equal(mutations(fx).at(-1).body.amountMinor,1234,'dollars become exact cents');
    await page.locator('#finCurrencyFilter').selectOption('USD');await page.waitForFunction(()=>financeState.loaded && financeState.total===2);
    assert.equal(await page.locator('.fin-entry').count(),2);assert.match(await page.locator('#finSummary').innerText(),/58\.01 USD/);assert.match(await page.locator('#finSummary').innerText(),/0 IQD/);
    await page.locator('#finCurrencyFilter').selectOption('');await page.waitForFunction(()=>financeState.loaded && financeState.total===4);
    await page.locator('[data-finedit="'+id(1)+'"]').click();await page.locator('#finAmount').fill('26000');await page.locator('#modalFormOk').click();await page.waitForSelector('#finDescription',{state:'detached'});
    const edit=mutations(fx).at(-1);assert.equal(edit.method,'PUT');assert.equal(edit.body.expectedRevision,1);
    await page.locator('[data-finchanges="'+id(1)+'"]').click();await page.waitForSelector('#finChangesList');assert.match(await page.locator('#finChangesList').innerText(),/25,000 IQD/);assert.match(await page.locator('#finChangesList').innerText(),/26,000 IQD/);assert.match(await page.locator('#finChangesList').innerText(),/Rozha/);await page.locator('#modalFormOk').click();await page.waitForSelector('#finChangesList',{state:'detached'});
    await page.locator('[data-finvoid="'+id(1)+'"]').click();await page.locator('#modalFormOk').click();await page.waitForFunction(()=>document.querySelector('#modalFormStatus')?.classList.contains('error'));
    const beforeVoid=mutations(fx).length;await page.locator('#finVoidReason').fill('Recorded twice');await page.locator('#modalFormOk').click();await page.waitForSelector('#modalOkBtn');assert.equal(mutations(fx).length,beforeVoid,'void waits for explicit confirmation');await page.locator('#modalCancelBtn').click();await page.waitForSelector('#modalOkBtn',{state:'detached'});assert.equal(mutations(fx).length,beforeVoid,'cancel confirmation keeps entry paid');
    await page.locator('#modalFormOk').click();await page.locator('#modalOkBtn').click();await page.waitForSelector('#finVoidReason',{state:'detached'});await page.waitForFunction(()=>!financeState.rows.some(r=>r.id==='00000000-0000-4000-8000-000000000001'));
    const voided=mutations(fx).at(-1);assert.equal(voided.body.expectedRevision,2);assert.equal(voided.body.reason,'Recorded twice');
    await page.locator('#finStatusFilter').selectOption('all');await page.waitForFunction(()=>financeState.loaded && financeState.rows.some(r=>r.status==='void'));
    assert.equal(await page.locator('.fin-void [data-finedit]').count(),0,'voided entry cannot be edited');assert.equal(await page.locator('.fin-void [data-finchanges]').count(),1,'voided entry retains audit history');assert.match(await page.locator('#finSummary').innerText(),/15,000 IQD/,'voided amount excluded even under all entries');
    await ctx.close();

    // An acknowledged-by-server, lost response recovers after reload without double recording.
    ({ctx,page,fx}=await open());fx.nextMutation='commitAbort';await save(page,{description:'Chicken',amount:'50000'});await page.waitForFunction(()=>document.querySelector('#modalFormStatus')?.classList.contains('error'));
    assert.equal(await page.locator('#finAmount').isDisabled(),true,'uncertain payload fields lock');const uncertain=mutations(fx)[0].body;
    await page.locator('#modalFormCancel').click();await page.waitForSelector('#finDescription',{state:'detached'});
    await page.locator('#finAdd').click();await page.waitForSelector('#modalAlertOkBtn');assert.equal(await page.locator('#finDescription').count(),0,'unconfirmed create blocks re-entering the same payment');await page.locator('#modalAlertOkBtn').click();await page.waitForSelector('#modalAlertOkBtn',{state:'detached'});
    await page.reload();await page.waitForSelector('#mainContent');await page.waitForSelector('#splash',{state:'detached'});await page.evaluate(()=>goView('expenses'));await page.waitForFunction(()=>financeState.loaded);assert.equal(await page.locator('[data-finrecover]').count(),1,'reload exposes durable recovery');
    await page.locator('[data-finrecover]').click();await page.waitForFunction(()=>!financeHasPending());assert.deepEqual(mutations(fx).at(-1).body,uncertain,'recovery repeats the exact original UUID and fields');assert.equal(fx.rows.filter(r=>r.description==='Chicken').length,1,'ambiguous commit retry cannot create a duplicate');
    await ctx.close();

    // Quota response stays durable; a different account cannot see or replay it.
    ({ctx,page,fx}=await open());fx.nextMutation=429;await save(page,{description:'Electricity',amount:'40000'});await page.waitForFunction(()=>document.querySelector('#modalFormStatus')?.classList.contains('error'));assert.equal(await page.evaluate(()=>financeHasPending()),true,'429 keeps pending operation');
    await page.evaluate(()=>signOut());fx.account='yunis';await page.evaluate(async()=>{lset('apiSession',{token:'t-yunis',account:'yunis',name:'Yunis',expiresAt:'2099-01-01T00:00:00Z'});applyAccount(apiSession());await loadData();state.view='expenses';render();});await page.waitForFunction(()=>financeState.loaded);
    assert.equal(await page.locator('[data-finrecover]').count(),0,'Yunis cannot recover Rozha operation');assert.equal(await page.evaluate(()=>financeHasPending()),false);const beforeOther=mutations(fx).length;await page.evaluate(()=>financeRecover('missing'));assert.equal(mutations(fx).length,beforeOther);
    const storedOwner=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ricottaOrders:financePending:rozha:')).length);assert.equal(storedOwner,1,'account reset retains original account recovery');await ctx.close();

    ({ctx,page,fx}=await open());await page.evaluate(()=>{window.finOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('ricottaOrders:financePending:')) throw new DOMException('Full','QuotaExceededError');return window.finOriginalSet.call(this,key,value);};});
    await save(page);await page.waitForFunction(()=>document.querySelector('#modalFormStatus')?.classList.contains('error'));assert.equal(mutations(fx).length,0,'storage full sends no financial write');assert.match(await page.locator('#modalFormStatus').innerText(),/Nothing was sent/);await ctx.close();

    ({ctx,page,fx}=await open());fx.nextMutation=409;await page.locator('[data-finedit="'+id(1)+'"]').click();await page.locator('#finAmount').fill('30000');await page.locator('#modalFormOk').click();await page.waitForFunction(()=>document.querySelector('#modalFormStatus')?.classList.contains('error'));assert.match(await page.locator('#modalFormStatus').innerText(),/another device/);assert.equal(await page.evaluate(()=>financeHasPending()),false,'definitive conflict clears pending');await page.locator('#modalFormCancel').click();await page.waitForSelector('#finDescription',{state:'detached'});await page.locator('#finRefresh').click();await page.waitForFunction(()=>financeState.rows.some(r=>r.amountMinor===33300));assert.match(await page.locator('[data-finid="'+id(1)+'"]').innerText(),/33,300 IQD/);await ctx.close();

    // An older successful response cannot repopulate a bad filter or signed-out account.
    ({ctx,page,fx}=await open());fx.deferRead=true;await page.evaluate(()=>{financeLoad();});await page.waitForTimeout(50);assert.equal(fx.deferred.length,1);
    await page.locator('#finFrom').fill('2099-12-31');await page.locator('#finFrom').dispatchEvent('change');await fx.deferred.shift()();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>financeState.loaded),false);assert.equal(await page.locator('.fin-entry').count(),0,'invalid range cannot show stale entries');assert.match(await page.locator('#finResults').innerText(),/start date/);
    await page.locator('#finFrom').fill(today().slice(0,8)+'01');await page.locator('#finFrom').dispatchEvent('change');await page.waitForFunction(()=>financeState.loaded);fx.deferRead=true;await page.evaluate(()=>{financeLoad();});await page.waitForTimeout(50);await page.evaluate(()=>signOut());await fx.deferred.shift()();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>financeState.rows.length),0,'stale reply cannot rehydrate after sign-out');assert.equal(await page.locator('#financeScreen').count(),0);await ctx.close();

    // CSV uses all filtered pages, exact amounts and formula-escaped free text.
    const many=Array.from({length:61},(_,i)=>entry(i+1,{description:i===0?'=SUM(A1:A2)':'Expense '+i,notes:i===0?' \t@evil':'',currency:i%2?'USD':'IQD',amountMinor:i%2?101:1000}));
    ({ctx,page,fx}=await open({rows:many,width:1200}));assert.equal(await page.locator('.fin-entry').count(),50);await page.locator('[data-finmore]').click();await page.waitForFunction(()=>financeState.rows.length===61);assert.equal(await page.locator('.fin-entry').count(),61);
    const downloaded=page.waitForEvent('download');await page.locator('#finExport').click();const download=await downloaded,csv=fs.readFileSync(await download.path(),'utf8');assert.equal(csv.split('\r\n').length,62,'CSV includes all 61 rows plus header');assert.match(csv,/"'=SUM\(A1:A2\)"/);assert.match(csv,/"' \t@evil"/);assert.match(csv,/"1\.01"/,'CSV dollars preserve cents');
    fx.changeExport=true;let downloads=0;page.on('download',()=>downloads++);await page.locator('#finExport').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('changed during export'));assert.equal(downloads,0,'changed ledger version cannot produce mixed-revision export');await ctx.close();

    // Both accounts can create, edit and void; all languages fit mobile and desktop.
    for(const account of ['rozha','yunis']) for(const lang of ['en','ku','ar']){
      ({ctx,page,fx}=await open({account,lang,width:lang==='ar'?1200:390}));assert.equal(await page.locator('#finAdd').isEnabled(),true);assert.equal(await page.locator('[data-finedit]').count(),2);assert.equal(await page.locator('[data-finvoid]').count(),2);
      assert.equal(await page.evaluate(()=>Object.keys(T.en).filter(key=>!(key in T.ku) || !(key in T.ar)).length),0,'all finance labels exist in every language');
      await page.locator('#finAdd').click();assert.equal(await page.locator('[role="dialog"]').getAttribute('aria-modal'),'true');await page.locator('#finDescription').fill('Staff meal');await page.locator('#finAmount').fill('10.01');await page.locator('#finCurrency').selectOption('USD');await page.locator('#modalFormOk').click();await page.waitForSelector('#finDescription',{state:'detached'});assert.equal(mutations(fx).at(-1).body.amountMinor,1001);assert.equal(fx.rows[0].createdBy,account);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'expense screen has no horizontal overflow');assert.equal(await page.locator('.fin-entry').first().evaluate(el=>getComputedStyle(el).animationName),'none','reduced motion disables expense animations');await ctx.close();
    }
    for(const {lang,width,name} of [{lang:'en',width:1440,name:'desktop-en.png'},{lang:'ar',width:390,name:'phone-ar.png'}]){
      ({ctx,page,fx}=await open({account:'rozha',lang,width}));
      await page.screenshot({path:path.join(screenshotsDir,name),fullPage:true});
      await ctx.close();
    }
    assert.deepEqual(errors,[],'no uncaught browser errors');
    console.log(JSON.stringify({result:'PASS',screenshotsDir,checks:'exact IQD/USD, filters, create/edit/void/audit, durable idempotent recovery, account isolation, 429/storage failure/conflict, stale responses, full snapshot-consistent escaped CSV, both-account access, EN/KU/AR layouts and reduced motion'}));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
