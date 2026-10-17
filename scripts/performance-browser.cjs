/* Real browser/CPU/network measurements with fake app data; never signs into production.
   Usage: node scripts/performance-browser.cjs SITE_DIRECTORY REPORT_PREFIX
   Slow 4G: 150ms latency, 1.6 Mbps down/750 Kbps up; 4x CPU slowdown.
   gzip emulates GitHub Pages compression for a like-for-like local comparison. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'dist'),prefix=path.resolve(process.argv[3]||'/tmp/ricotta-performance');
const suppliers=Array.from({length:9},(_,i)=>({id:'s'+i,name:'Supplier '+i,phone:'07701234567'}));
const items=Array.from({length:179},(_,i)=>({id:'i'+i,name:'تەماتە '+i,aliases:['Tomato '+i],unit:'box',supplierId:'s'+(i%9)}));
const session={token:'performance-fixture',expiresAt:'2099-01-01T00:00:00Z',account:'rozha',name:'Rozha',tabs:['order','assistant','manage']};
const views=['order','assistant','manage','history','suppliers','itemsAdmin','units','record','devices','settings'];
const fixture={...session,views,suppliers,items,units:[{id:'box',en:'box',ku:'سندوق',ar:'صندوق'}],history:[],devices:[],activity:[],inbox:[],notes:[],reminder:{enabled:false,time:'09:00'}};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(err,data)=>{
  if(err){res.writeHead(404);return res.end();}
  const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[ext]||'application/octet-stream');
  res.setHeader('Cache-Control','public, max-age=600');
  if(/\.(html|js|css|json)$/.test(file) && /gzip/.test(req.headers['accept-encoding']||'')){res.setHeader('Content-Encoding','gzip');data=zlib.gzipSync(data);}
  res.end(data);
 });
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 const reports=[];
 try{
  for(const loggedIn of [false,true]){
   const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),errors=[];
   await ctx.route('**/functions/v1/api/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname.split('/api/')[1];
    let data=endpoint==='bootstrap'?fixture:endpoint==='auth/security'?{required:false,siteKey:null}:endpoint==='devices'||endpoint==='notes'||endpoint==='assistant/inbox'?[]:endpoint==='assistant/status'?{configured:true,provider:'gemini'}:{ok:true};
    await new Promise(r=>setTimeout(r,300));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   });
   await ctx.addInitScript(({loggedIn,session})=>{
    if(loggedIn)localStorage.setItem('ricottaOrders:apiSession',JSON.stringify(session));
    localStorage.setItem('ricottaOrders:pushBannerSnoozedAt',JSON.stringify(Date.now()));
    window.measure={cls:0,lcp:0,tasks:[],events:[]};
    new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)window.measure.cls+=e.value;})).observe({type:'layout-shift',buffered:true});
    new PerformanceObserver(list=>list.getEntries().forEach(e=>window.measure.lcp=e.startTime)).observe({type:'largest-contentful-paint',buffered:true});
    new PerformanceObserver(list=>list.getEntries().forEach(e=>window.measure.tasks.push(e.duration))).observe({type:'longtask',buffered:true});
    new PerformanceObserver(list=>list.getEntries().forEach(e=>window.measure.events.push({name:e.name,duration:e.duration,interactionId:e.interactionId}))).observe({type:'event',buffered:true,durationThreshold:16});
   },{loggedIn,session});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
   const cdp=await ctx.newCDPSession(page);
   await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8});
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   const started=Date.now();await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForSelector(loggedIn?'#orderResults':'.keypad');
   await page.waitForSelector('#splash',{state:'detached'});
   const readyMs=Date.now()-started;
   await page.waitForTimeout(1800);
   const mode=loggedIn?'order':'login';await page.screenshot({path:prefix+'-'+mode+'.png'});
   if(loggedIn){
    await page.locator('[data-inc="i0"]').first().click();
    assert.equal(await page.locator('[data-qty="i0"]').first().inputValue(),'1');
    await page.locator('#itemSearch').fill('tomato 15');
    await page.waitForTimeout(150);assert.ok(await page.locator('#orderResults .item-row').count());
   }else{await page.locator('.key[data-key="1"]').click();}
   await page.waitForTimeout(250);
   const metrics=await page.evaluate(()=>({...window.measure,bytes:performance.getEntriesByType('resource').reduce((s,x)=>s+x.transferSize,0),requests:performance.getEntriesByType('resource').length,resources:performance.getEntriesByType('resource').map(x=>({name:x.name,bytes:x.transferSize})),fonts:document.fonts.status}));
   assert.deepEqual(errors,[],'No browser errors');
   reports.push({mode,readyMs,...metrics});await ctx.close();
  }
  fs.writeFileSync(prefix+'.json',JSON.stringify({conditions:'Slow 4G 1.6Mbps/150ms latency, 4x CPU; 179 items; mocked API 300ms; cold cache',reports},null,2));
  console.log(JSON.stringify(reports.map(({resources,events,tasks,...r})=>({...r,maxEventMs:Math.max(0,...events.map(e=>e.duration)),blockingMs:tasks.reduce((s,d)=>s+Math.max(0,d-50),0)})),null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
