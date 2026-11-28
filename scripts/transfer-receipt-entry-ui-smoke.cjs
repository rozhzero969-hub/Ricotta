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
const views = ['order','history','receipts','transfers','stock','settings'];
const zones = ['Main Storage','Kitchen','Minibar'];
const titems = [
  {name:'Donuts', base:'piece', stock:{'Main Storage':10}},
  {name:'Potatoes', base:'گرام', count:{name:'کیلۆ', factor:1000}, stock:{'Main Storage':20000}},
  {name:'Oranges', base:'گرام', count:{name:'کیلۆ', factor:1000}, stock:{'Main Storage':5000}},
  {name:'Yellow Apple - سێوی زەرد', base:'گرام', count:{name:'کیلۆ',factor:1000}, stock:{'Main Storage':20000}},
  {name:'Yamama Pomegranate Molasses', base:'piece', stock:{'Main Storage':20}},
  {name:'Paper Cups', base:'piece', buy:{name:'کارتۆن',factor:20}, stock:{'Main Storage':200}},
  {name:'Dark Soy Sauce', base:'piece', stock:{'Main Storage':10}},
  {name:'Light Soy Sauce', base:'piece', stock:{'Main Storage':10}},

];
const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
const date = '2026-11-22T12:00:00.000Z';
const transfers = ids.map((id,i)=>({id, by:'rozha', status:'draft', source:'app', version:1,
  from:zones[0], to:zones[i+1], yesterday:i===1, createdAt:date, lines:[i===0
    ? {item:'Donuts', qty:10, unit:'piece'} : {item:'Potatoes', qty:5, unit:'کیلۆ'}]}));
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
      else if(key === 'receipts-settings/rico') data = {online:true,launcher:{online:true}};
      else if(key === 'rico/watch') data = {ticket:'watch-fixture',expires:Date.now() + 60_000};
      else if(key === 'draft') data = {cart:{},revision:0};
      else if(key === 'transfers/suppliers') data = {suppliers:[
        {name:'Fruit supplier',items:['Oranges','Donuts']},{name:'Packaging supplier',items:['Paper Cups']},
      ]};
      else if(key === 'transfers') data = {transfers, catalog:{zones,titems,at:date}, helper:{online:true}};
      else if(key === 'stock') data = {at:date, zone:'Main Storage', items:[
        {name:'Paper Cups',base:'piece',count:{name:'piece',factor:1},buy:{name:'کارتۆن',factor:20},main:30,
          price:{perBase:1000,unit:'کارتۆن',cost:20000,day:'2026-11-21',supplier:'Produce'}},
        {name:'Oranges',base:'گرام',count:{name:'کیلۆ',factor:1000},main:4000},
      ]};
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
    const sampleFrame = await fs.readFile(path.resolve(__dirname,'../ricotta-map.jpg'));
    await context.route('http://127.0.0.1:17692/**', route=>{
      const headers = {
        'Access-Control-Allow-Origin':'http://127.0.0.1:' + server.address().port,
        'Access-Control-Expose-Headers':'X-Rico-Pointer',
      };
      if(route.request().method() === 'OPTIONS'){
        return route.fulfill({status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'Authorization'}});
      }
      if(route.request().url().endsWith('/ready')) return route.fulfill({status:204,headers});
      assert.equal(route.request().headers().authorization,'Bearer watch-fixture','the local viewer receives a screen ticket, never the Orders session');
      return route.fulfill({status:200,body:sampleFrame,headers:{...headers,'Content-Type':'image/jpeg','X-Rico-Pointer':'0.25,0.4,type'}});
    });
    const page = await context.newPage(), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date(date));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.locator('#orderResults').waitFor();
    await page.locator('#splash').waitFor({state:'detached'});
    await page.evaluate(()=>goView('stock'));
    await page.locator('.stk-value-total').waitFor();
    assert.match(await page.locator('.stk-value-card').innerText(),/30,000/);
    assert.match(await page.locator('.stk-value-card').innerText(),/1 without a usable price/);
    await page.locator('[data-stk="Paper Cups"]').click();
    assert.match(await page.locator('.stk-sheet').innerText(),/20,000/);
    assert.match(await page.locator('.stk-sheet').innerText(),/1,000/);
    assert.match(await page.locator('.stk-sheet').innerText(),/21 Nov|Nov 21/);
    await page.keyboard.press('Escape');
    await page.locator('.stk-sheet').waitFor({state:'detached'});
    await page.evaluate(()=>goView('transfers'));
    await page.locator('#tfTo').fill('Kitchen');
    await page.locator('#tfTo').press('Enter');
    await page.locator('#tfItem0').fill('Donuts');
    const reserved = page.locator('#tfItem0List [role=option]');
    assert.equal(await reserved.getAttribute('aria-disabled'),'true');
    assert.match(await reserved.innerText(),/10 piece.*Kitchen/);
    await page.locator('#tfItem0').press('Enter');
    assert.equal(await page.evaluate(()=>tfFind(tf.id).lines.some(line=>line.item)),false,'reserved stock cannot enter this draft');
    await page.locator('[data-tf-mode=smart]').click();
    await page.locator('[data-rr-activity]').click();
    await page.getByRole('button',{name:/Floating view/}).click();
    await page.locator('.rr-watch-screen img').waitFor();
    await page.locator('.rr-watch-screen i[data-mode=type]').waitFor();
    const [watchButton, watchPopup] = await Promise.all([
      page.locator('#mainContent [data-rr-activity]').boundingBox(),
      page.locator('.rr-watch-popover').boundingBox(),
    ]);
    assert.ok(watchPopup.width <= 380 && watchPopup.y >= watchButton.y + watchButton.height,
      'Watch Rico opens as a compact popup underneath its button');
    assert.equal(await page.locator('.rr-watch-screen i').evaluate(e=>e.style.left),'25%');
    await page.setViewportSize({width:390,height:720});
    await page.waitForFunction(()=>{
      const popup = document.getElementById('rrWatchFloating');
      if(!popup) return false;
      const box = popup.getBoundingClientRect();
      return box.x >= 11 && box.right <= innerWidth - 11 && box.y >= 11 && box.bottom <= innerHeight - 11;
    });
    await page.setViewportSize({width:1320,height:900});
    await page.keyboard.press('Escape');
    await page.locator('.rr-watch-popover').waitFor({state:'detached'});
    assert.equal(await page.locator('#mainContent [data-rr-activity]').getAttribute('aria-expanded'),'false');
    const entry = page.locator('#tfSmartEntry');
    assert.equal(await entry.isDisabled(),false);
    assert.equal(await entry.getAttribute('placeholder'),'Oranges 5 kilos');
    assert.equal(await page.locator('#tfSmartDay, #tfSmartAdd').count(),0);
    await entry.fill('/supplier');
    await entry.press('Enter');
    const suppliers = page.locator('.tf-supplier-sheet');
    await suppliers.getByRole('button',{name:'Fruit supplier'}).waitFor();
    assert.equal(await suppliers.getByRole('button',{name:'Packaging supplier'}).count(),1);
    await suppliers.locator('input').fill('Fruit');
    await suppliers.locator('input').press('Enter');
    const supplierItems = page.locator('.tf-command-search:not(.tf-supplier-sheet):not(.out)');
    await supplierItems.getByRole('button',{name:/Oranges/}).waitFor();
    assert.equal(await supplierItems.getByRole('button',{name:/Paper Cups|Donuts/}).count(),0,'excludes other suppliers and reserved stock');
    await supplierItems.getByRole('button',{name:/Oranges/}).click();
    assert.equal(await entry.inputValue(),'Oranges ');
    for(const [input, pattern, selected] of [
      ['apple 5 kilos', /Yellow Apple/, true],
      ['yellow appple 5 kilo', /Yellow Apple/, true],
      ['oran 1.5', /Oranges.*Add 1.5/s, true],
      ['oranges 2 ki', /Oranges.*Add 2 کیلۆ/s, true],
      ['paper cups 2 car', /Paper Cups.*Add 2 کارتۆن/s, true],
      ['Yellow Apple - سێوی زەرد 2 ki', /Yellow Apple.*Add 2 کیلۆ/s, true],
      ['yamama pomegranate 2 pieces', /Yamama Pomegranate Molasses/, true],
    ]){
      await entry.fill(input);
      const match = page.locator('#tfSmartMatches [role=option]');
      assert.match(await match.innerText(),pattern);
      assert.equal(await match.getAttribute('aria-selected'),String(selected));
    }
    for(const [typed, expected] of [['orange 1.5', /Add 1.5 کیلۆ/], ['orange 1500', /Add 1,500 گرام/], ['orange all', /Add 5 کیلۆ/]]){
      await entry.fill(typed);
      assert.match(await page.locator('#tfSmartMatches [aria-selected=true]').innerText(),/Available/);
      assert.match(await page.locator('#tfSmartMatches [aria-selected=true]').innerText(),expected);
    }
    const zero = await page.evaluate(()=>tfSmartMatch('Donuts all', tf.data.catalog.titems, tfSmartAliases(), null, null,
      item=>tfLeftForOtherLines(item, tfFind(tf.id), -1)));
    assert.equal(zero.error,'tfSmartUnavailable','all respects reserved stock');
    await entry.fill('soy sauce 2 pieces');
    assert.equal(await page.locator('#tfSmartMatches [role=option]').count(),2);
    assert.equal(await page.locator('#tfSmartMatches [aria-selected=true]').count(),0);
    await entry.press('Tab');
    await entry.press('Tab');
    assert.match(await page.locator('#tfSmartMatches [aria-selected=true]').innerText(),/Light Soy Sauce/);

    await entry.fill('potato 5 pieces');
    await entry.press('Enter');
    assert.equal(await entry.getAttribute('aria-invalid'),'true');
    assert.match(await page.locator('#tfSmartStatus').innerText(),/unit/);
    await page.keyboard.press('Escape');
    await page.locator('.sel-pop').waitFor({state:'detached'});
    await entry.fill('potato 5 kilo');
    await entry.press('Enter');
    assert.match(await page.locator('#tfSmartStatus').innerText(),/Potatoes.*5 کیلۆ/);
    const potatoLines = await page.evaluate(()=>tfFind(tf.id).lines.filter(line=>line.item));
    assert.deepEqual(potatoLines.map(({item,unit,qty})=>({item,unit,qty})),[{item:'Potatoes',unit:'کیلۆ',qty:5}]);
    await page.waitForFunction(()=>document.querySelector('#tfUnit0')?.value === 'کیلۆ' && document.querySelector('#tfQty0')?.value === '5');
    await entry.fill('Oranges 5 unknown-unit');
    await entry.press('Enter');
    const pickUnit = page.locator('.sel-pop [role=option]');
    assert.deepEqual(await pickUnit.allTextContents(),['کیلۆ','گرام']);
    assert.equal(await page.locator('#tfQty1').count(),0,'an unknown unit does not add a line');
    await pickUnit.getByText('کیلۆ',{exact:true}).click();
    assert.equal(await page.locator('#tfQty1').inputValue(),'5');
    assert.equal(await page.locator('#tfUnit1').inputValue(),'کیلۆ');
    const review = page.locator('.tf-smart-review');
    assert.match(await review.innerText(),/Oranges.*5 کیلۆ.*Potatoes.*5 کیلۆ/s);
    assert.equal(await entry.evaluate(el=>el === document.activeElement),true);

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
    await page.locator('[data-tf-mode=smart]').click();
    await page.locator('#tfTo').fill('Kitchen');
    await page.locator('#tfTo').press('Enter');
    await page.locator('#tfYestLabel').click();
    await page.keyboard.press('Alt+y');
    assert.equal(await page.locator('#tfYest').getAttribute('aria-checked'),'false','the label and the former shortcut cannot turn it on');
    await page.locator('#tfYest').click();
    assert.equal(await page.locator('.modal-overlay').count(),0,'the explicit switch needs no confirmation');
    await page.locator('#tfYest[aria-checked=true]').waitFor();
    assert.equal(await page.locator('#tfYest').getAttribute('aria-checked'),'true');
    await entry.fill('apple 2 kilos');
    await entry.press('Enter');
    await page.locator('#tfKeepDraft').click();
    assert.equal(await page.locator('#tfFrom').inputValue(),'Main Storage');
    assert.equal(await page.locator('.tf-route-locked bdi').innerText(),'Minibar');
    assert.equal(await entry.evaluate(el=>el === document.activeElement),true);
    assert.equal(await page.locator('#tfYest').getAttribute('aria-checked'),'false','a fresh draft starts with today');
    await page.locator('[data-tf-mode=manual]').click();
    assert.equal(await page.locator('#tfTo').inputValue(),'');
    assert.equal(await page.locator('#tfYest').getAttribute('aria-checked'),'false');
    await page.locator('[data-tf-mode=smart]').click();
    await page.locator('#tfTo').fill('Kitchen');
    await page.locator('#tfTo').press('Enter');
    await entry.fill('/he');
    await entry.press('Tab');
    assert.equal(await entry.inputValue(),'/help');
    await entry.press('Enter');
    await page.locator('.tf-command-help').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.tf-command-help').waitFor({state:'detached'});
    await entry.fill('Yamama Pomegranate Molasses ha');
    await page.locator('[data-tf-command-guide]').click();
    await page.locator('.tf-command-help').getByText('/draft', {exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.tf-command-help').waitFor({state:'detached'});
    assert.equal(await entry.inputValue(), 'Yamama Pomegranate Molasses ha', 'opening command help preserves the current entry');
    await entry.press('Tab');
    assert.equal(await entry.inputValue(),'Yamama Pomegranate Molasses half');
    await entry.press('Enter');
    assert.equal(await page.locator('#tfQty0').inputValue(),'10');
    await entry.fill('Yamama Pomegranate Molasses + 2 pieces');
    await entry.press('Enter');
    assert.equal(await page.locator('#tfQty0').inputValue(),'12');
    await entry.fill('undo');
    await entry.press('Enter');
    assert.equal(await page.locator('#tfQty0').inputValue(),'10');
    await entry.fill('/undo');
    // Only one edit is undoable. Leave the first line in this draft and split the rest.
    await entry.press('Enter');
    await entry.fill('Yamama Pomegranate Molasses split');
    await page.getByRole('option').filter({hasText:'Kitchen'}).click();
    assert.match(await entry.inputValue(),/split Kitchen & $/);
    await page.getByRole('option').filter({hasText:'Minibar'}).click();
    await entry.press('Enter');
    assert.equal(await page.locator('#tfQty1').inputValue(),'5');
    await entry.fill('/draft');
    await entry.press('Enter');
    assert.equal(await page.locator('.tf-route-locked bdi').innerText(),'Minibar');
    assert.equal(await page.locator('#tfQty0').inputValue(),'5');
    assert.equal(await entry.evaluate(el=>el === document.activeElement),true);
    await page.locator('#tfChangeTo').click();
    await page.locator('input#tfTo').waitFor();
    await page.evaluate(()=>goView('receipts'));
    const receipts = page.locator('#mainContent');
    const slowNotice = receipts.locator('[data-rr-slow]');
    await slowNotice.waitFor({state:'attached'});
    await page.evaluate(()=>{
      Object.defineProperty(navigator,'connection',{configurable:true,value:{effectiveType:'2g'}});
      rrPaintNetwork();
    });
    await slowNotice.waitFor({state:'visible'});
    await page.evaluate(image=>{
      window.webkit = {messageHandlers:{ricoWatch:{async postMessage({path,ticket}){
        if(path === '/ready' && !ticket) return {status:204};
        if(path === '/frame' && ticket === 'watch-fixture') return {status:200,image,pointer:'0.6,0.5,type'};
        throw new Error('Unexpected Watch Rico message');
      }}}};
    }, sampleFrame.toString('base64'));
    await receipts.locator('[data-rr-activity]').click();
    await page.getByRole('button',{name:/Large view/}).click();
    await page.locator('.rr-watch-large[role="dialog"], .rr-watch-large [role="dialog"]').waitFor();
    await page.locator('.rr-watch-screen img').waitFor();
    assert.equal(await page.locator('.rr-watch-screen i').evaluate(e=>e.style.left),'60%','Mac viewer uses the native bridge');
    await page.keyboard.press('Escape');
    await page.locator('.rr-watch-large').waitFor({state:'detached'});
    const prepareStart = inline=>page.evaluate(inline=>{
      state.settings.ricoInlineWindow = inline;
      rr.data.helper = {online:false,launcher:{online:true}};
      render();
    }, inline);
    await prepareStart(undefined);
    await page.locator('[data-rico=real]').click();
    await page.getByRole('button',{name:/Floating view/}).click();
    await page.locator('.rr-watch-screen img').waitFor();
    await page.evaluate(()=>goView('stock'));
    await page.locator('.stk-value-total').waitFor();
    await page.locator('.rr-watch-floating img').waitFor();
    await page.evaluate(()=>goView('receipts'));
    await page.locator('#rrItem0').focus();
    assert.equal(await page.locator('.rr-watch-floating img').isVisible(),true,'typing and switching screens keeps the floating viewer open');
    await page.locator('.rr-watch-floating [data-close-activity]').click();
    await page.locator('.rr-watch-popover').waitFor({state:'detached'});
    await prepareStart(false);
    await page.locator('[data-rico=real]').click();
    await page.locator('[data-rico=stop]').waitFor();
    assert.equal(await page.locator('.rr-watch-popover, [data-rr-activity]').count(),0);
    const delivery = page.locator('#rrDelivery'), rate = page.locator('#rrRate');
    assert.equal(await delivery.count(),0);
    assert.equal(await rate.count(),0);
    await page.locator('[data-delivery=on]').click();
    await delivery.waitFor();
    await page.locator('[data-delivery=off]').click();
    await delivery.waitFor({state:'detached'});
    await page.locator('[data-cur=USD]').click();
    await rate.waitFor();
    assert.equal(await delivery.count(),0);
    await page.locator('[data-cur=IQD]').click();
    await rate.waitFor({state:'detached'});
    assert.equal(await delivery.count(),0);
    const mathOn = page.locator('.rr-options [data-rr-math=on]');
    const mathOff = page.locator('.rr-options [data-rr-math=off]');
    assert.equal(await mathOff.getAttribute('aria-pressed'),'true');
    await mathOn.click();
    assert.equal(await mathOn.getAttribute('aria-pressed'),'true');

    await page.locator('#rrItem0').fill('Lettuce');
    await page.locator('#rrItem0').press('Enter');
    await page.locator('#rrQty0').fill('19.2');
    await page.locator('#rrCost0').fill('13,250');
    await page.locator('#rrSend').click();
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('unfinished line price'));
    const saved = page.waitForResponse(r=>r.request().method()==='PUT' && /\/receipts\//.test(r.url()) && r.request().postDataJSON().lines[0]?.cost === 690.104);
    await page.locator('#rrCost0').press('Enter');
    assert.equal(await page.locator('#rrCost0').inputValue(),'690.104');
    const [qtyBox,costBox] = await Promise.all([page.locator('#rrQty0').boundingBox(),page.locator('#rrCost0').boundingBox()]);
    assert.ok(Math.abs(qtyBox.y - costBox.y) < 1, 'calculation leaves fields aligned');

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
    const queued = await page.evaluate(async ()=>{
      const receipt = rrFind(rr.formId), transfer = tfFind(tf.formId);
      let release;
      const gate = new Promise(resolve=>{ release = resolve; });
      rrOneAtATime(receipt.id, ()=>gate);
      rrOneAtATime(transfer.id, ()=>gate);
      const saves = [rrSaveDraft(receipt), tfSaveDraft(transfer)];
      rrReset();
      tfReset();
      release();
      return Promise.all(saves);
    });
    assert.deepEqual(queued,[false,false],'draft saves waiting behind older work stop when the session resets');
    assert.deepEqual(errors,[]);
    console.log('Transfer and receipt entry UI PASS');
  } finally {
    await browser.close();
    server.close();
  }
}
run().catch(error=>{console.error(error); process.exitCode=1;});
