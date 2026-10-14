const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'lab/dist');
cp.execFileSync('sh',['lab/build.sh'],{cwd:repo});
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
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
  const nav=async view=>{await page.evaluate(v=>goView(v),view);await page.waitForFunction(v=>document.getElementById('app').dataset.screen===v,view);};
  await page.evaluate(()=>{state.items.find(i=>i.id==='it-tom').aliases=['Fresh tomato'];render();});
  await page.locator('#itemSearch').fill('tomtao fresh');
  assert.equal(await page.locator('#orderResults [data-item-id="it-tom"]').count(),1);
  await page.locator('#itemSearchClear').click();
  await page.waitForFunction(()=>document.querySelectorAll('#orderResults .item-row').length>10);
  assert.ok(await page.locator('#orderResults .item-row').count()>10);
  await nav('itemsAdmin');
  await page.locator('#catalogSearch').fill('tomtao');
  assert.equal(await page.locator('[data-edititem="it-tom"]').isVisible(),true);
  assert.ok(await page.locator('.list-row:visible').count()<5);
  await page.locator('#catalogSearch').fill('zzzxxxx');
  assert.equal(await page.locator('.list-row:visible').count(),0);
  assert.equal(await page.locator('#catalogSearchEmpty').isVisible(),true);
  await page.locator('#catalogSearchClear').click();
  assert.ok(await page.locator('.list-row:visible').count()>10);
  await nav('history');
  await page.locator('#catalogSearch').fill('tomato');
  assert.ok(await page.locator('.hist-card:visible').count()>0,'history matches current aliases');
  await page.evaluate(()=>{state.activity=Array.from({length:50},(_,n)=>({name:n===49?'Special item':'Ordinary '+n,action:'edit',type:'item',ts:new Date().toISOString(),fields:[],actor:'rozha'}));goView('record');});
  await page.waitForFunction(()=>document.getElementById('app').dataset.screen==='record');
  await page.locator('#catalogSearch').fill('Special');
  assert.equal(await page.locator('.rec-card:visible').count(),1,'records beyond first page can be found');
  await page.locator('#catalogSearchClear').click();
  assert.ok(await page.locator('.rec-card:visible').count()>1);
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
  assert.deepEqual(errors,[]);
  console.log('Search UI PASS: typo/alias order, clear buttons, list matches/empty/reset, history aliases, records beyond first page, units and Rico bulk alias preview/save');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
