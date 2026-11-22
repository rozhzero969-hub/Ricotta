/* Uses the actual forms and a local fixture. No real receipts or transfers are sent. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..', process.env.UI_SITE_DIR || '.');
const server = http.createServer(async (request, response)=>{
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  try {
    if(!file.startsWith(root + path.sep)) throw new Error('outside root');
    const body = await fs.readFile(file);
    const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.png':'image/png', '.svg':'image/svg+xml'};
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
const views = ['order','history','receipts','transfers','settings'];
const zones = ['Main Storage','Kitchen','Minibar'];
const titems = [
  {name:'Donuts', base:'piece', stock:{'Main Storage':10}},
  {name:'Potatoes', base:'gram', count:{name:'kg', factor:1000}, stock:{'Main Storage':20000}},
  {name:'Oranges', base:'gram', count:{name:'kg', factor:1000}, stock:{'Main Storage':5000}},
];
const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
const date = '2026-11-22T12:00:00.000Z';
const transfers = ids.map((id,i)=>({id, by:'rozha', status:'draft', source:'app', version:1,
  from:zones[0], to:zones[i+1], yesterday:i===1, createdAt:date, lines:[i===0
    ? {item:'Donuts', qty:10, unit:'piece'} : {item:'Potatoes', qty:5, unit:'kg'}]}));
const queue = [], receiptSaves = [];
let flagNewWarning = false;
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({viewport:{width:1320,height:900}, serviceWorkers:'block', reducedMotion:'reduce'});
    await context.addInitScript(()=>{
      const prefix = 'ricottaOrders:';
      localStorage.setItem(prefix+'lang','"en"');
      localStorage.setItem(prefix+'apiSession',JSON.stringify({token:'test-token', account:'rozha', name:'Rozh', expiresAt:'2099-01-01T00:00:00Z'}));
      for(const k of ['xtSeen','toured','aiConsent2']) localStorage.setItem(prefix+k+':rozha','true');
      localStorage.setItem(prefix+'pushBannerSnoozedAt',String(Date.now()));
    });
    await context.route('**/functions/v1/api/**', async route=>{
      const req = route.request(), key = new URL(req.url()).pathname.split('/api/')[1], method = req.method();
      let data = {ok:true}, status = 200;
      if(key === 'bootstrap') data = {account:'rozha',name:'Rozh',views,suppliers:[{id:'produce',name:'Produce'}],items:[{id:'p',supplierId:'produce',name:'Potatoes'}],units:[],pins:[],history:[],draft:{cart:{},revision:0}};
      else if(key === 'auth/security') data = {required:false};
      else if(key === 'draft') data = {cart:{},revision:0};
      else if(key === 'transfers') data = {transfers, catalog:{zones,titems,at:date}, helper:{online:true}};
      else if(key === 'receipts') data = {receipts:[], helper:{online:true}, catalog:{zones,suppliers:['Produce'],items:[{name:'Lettuce',base:'kg'}]}};
      else if(key.startsWith('receipts/') && method === 'PUT'){
        receiptSaves.push(req.postDataJSON());
        data = {id:key.split('/')[1],version:1};
      } else if(key.startsWith('transfers/') && method === 'PUT'){
        const id = key.split('/')[1], row = transfers.find(r=>r.id===id);
        data = {...row, ...req.postDataJSON(), id, version:(row?.version || 0)+1};
        if(row) Object.assign(row,data);
        else transfers.push({...data, status:'draft', by:'rozha', source:'app', createdAt:date});
      } else if(key.endsWith('/send')){
        const row = transfers.find(r=>r.id===key.split('/')[1]), {confirm} = req.postDataJSON(), warnings = [];
        if(row.id === ids[0]) warnings.push({code:'allStock',line:1,have:{qty:10,unit:'piece'}});
        if(row.yesterday) warnings.push({code:'yesterday'});
        if(flagNewWarning && row.id === ids[1]) warnings.push({code:'repeat',at:date});
        if(warnings.some(w=>!confirm.includes(w.code))){ status=409; data={error:'needs_confirmation',warnings}; }
        else { Object.assign(row,{status:'queued',sentAt:date,version:row.version+1}); queue.push({id:row.id,yesterday:row.yesterday}); data=row; }
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    const page = await context.newPage(), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date(date));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.locator('#orderResults').waitFor();
    await page.locator('#splash').waitFor({state:'detached'});
    await page.evaluate(()=>goView('transfers'));
    await page.locator('#tfTo').fill('Kitchen');
    await page.locator('#tfTo').press('Enter');
    await page.locator('#tfItem0').fill('Donuts');
    const reserved = page.locator('#tfItem0List [role=option]');
    assert.equal(await reserved.getAttribute('aria-disabled'),'true');
    assert.match(await reserved.innerText(),/10 piece.*Kitchen/);
    await page.locator('#tfItem0').press('Enter');
    await page.locator('[data-tf-mode=smart]').click();
    assert.equal(await page.locator('#tfSmartEntry').isDisabled(),true);
    await page.locator('#tfSmartDay').selectOption('today');
    const entry = page.locator('#tfSmartEntry');
    await entry.fill('potato 5 pieces');
    await entry.press('Enter');
    assert.equal(await entry.getAttribute('aria-invalid'),'true');
    assert.match(await page.locator('#tfSmartStatus').innerText(),/unit/);
    await entry.fill('potato 5 kilo');
    await entry.press('Enter');
    assert.match(await page.locator('#tfSmartStatus').innerText(),/Potatoes.*5 kg/);
    assert.equal(await page.locator('#tfQty0').inputValue(),'5');
    await entry.fill('Oranges 5 kilos');
    await entry.press('Enter');
    await page.locator('[data-tf-mode=manual]').click();
    await page.locator('#tfAdd').click();
    await page.locator('#tfItem2').fill('Oranges');
    assert.equal(await page.locator('#tfItem2List [role=option]').count(),0,'fully assigned on this transfer');
    await page.locator('[data-tf-senddrafts]').click();
    const modal = page.locator('.modal-form');
    assert.equal(await modal.locator('[data-tf-batch-day]').count(),2);
    assert.match(await modal.innerText(),/Donuts.*10 piece/s);
    await modal.locator('[data-tf-batch-day="0"]').selectOption('yesterday');
    await modal.locator('[data-tf-batch-day="1"]').selectOption('today');
    flagNewWarning = true;
    await modal.locator('#modalFormOk').click();
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('another warning'));
    assert.deepEqual(queue,[{id:ids[0],yesterday:true}],'a new server warning stops the batch without sending that draft');
    assert.equal(transfers[1].status,'draft');
    // Review two remaining drafts again. A whole batch with mixed days completes from one dialog.
    flagNewWarning = false;
    await page.locator('#tfKeepDraft').click();
    await page.locator('[data-tf-senddrafts]').click();
    await modal.locator('[data-tf-all-day=yesterday]').click();
    await modal.locator('[data-tf-batch-day="0"]').selectOption('today');
    await modal.locator('#modalFormOk').click();
    await page.waitForFunction(()=>!document.querySelector('[data-tf-senddrafts]'));
    assert.equal(queue.length,3);
    assert.equal(queue[1].yesterday,false);
    assert.equal(queue[2].yesterday,true);
    await page.evaluate(()=>goView('receipts'));
    const delivery = page.locator('#rrDelivery'), rate = page.locator('#rrRate');
    assert.equal(await delivery.count(),0);
    assert.equal(await rate.count(),0);
    await page.locator('#rrDeliveryOn').click();
    await delivery.waitFor();
    await page.locator('#rrDeliveryOn').click();
    await delivery.waitFor({state:'detached'});
    await page.locator('[data-cur=USD]').click();
    await rate.waitFor();
    assert.equal(await delivery.count(),0);
    await page.locator('[data-cur=IQD]').click();
    await rate.waitFor({state:'detached'});
    assert.equal(await delivery.count(),0);
    await page.locator('#rrMath').click();
    await page.locator('#rrItem0').fill('Lettuce');
    await page.locator('#rrItem0').press('Enter');
    await page.locator('#rrQty0').fill('19.2');
    await page.locator('#rrCost0').fill('13,250');
    await page.locator('#rrSend').click();
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('unfinished line price'));
    const saved = page.waitForResponse(r=>r.request().method()==='PUT' && /\/receipts\//.test(r.url()) && r.request().postDataJSON().lines[0]?.cost === 690.104);
    await page.locator('#rrCost0').press('Enter');
    assert.equal(await page.locator('#rrCost0').inputValue(),'690.104');
    assert.match(await page.locator('.rr-line').first().locator('.rr-total').innerText(),/13,250/);
    await page.waitForFunction(()=>document.querySelector('#rrItem1') === document.activeElement);
    await saved;
    assert.deepEqual(receiptSaves.at(-1).lines,[{item:'Lettuce',unit:'kg',qty:19.2,cost:690.104}]);
    const math = await page.evaluate(()=>[
      rrCostFromTotal('13,25',19.2,'IQD').error,
      rrCostFromTotal('50',99999,'IQD').error,
      rrCostFromTotal('١٣٬٢٥٠',19.2,'IQD').cost,
      rrCostFromTotal('10.500',3,'USD').cost,
      rrCostFromTotal('10.0001',3,'USD').error,
    ]);
    assert.deepEqual(math,['rrMathAmount','rrMathMismatch',690.104,3.5,'rrMathAmount']);
    assert.deepEqual(errors,[]);
    console.log('Transfer and receipt entry UI PASS');
  } finally {
    await browser.close();
    server.close();
  }
}
run().catch(error=>{console.error(error); process.exitCode=1;});
