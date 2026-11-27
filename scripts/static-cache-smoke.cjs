/* Cache boundaries are security boundaries: only exact public build assets may be stored. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const listeners={},stored=new Map(),deleted=[],network=[],notifications=[],windowsOpened=[],windowsMessaged=[];
let windows=[];
const asset='https://example.test/Ricotta/assets/app.123456789abc.js';
const cache={match:async req=>stored.get(req.url||req),put:async(req,res)=>stored.set(req.url||req,res)};
let failStore=false,failOpen=false,failMatch=false,failKeys=false,claims=0,offline=false,moved=false;const pageFetches=[];
const context=vm.createContext({URL,Set,Promise,console,TypeError,
 self:{registration:{scope:'https://example.test/Ricotta/',showNotification:async(title,options)=>notifications.push({title,options})},clients:{claim:async()=>{claims++;},matchAll:async()=>windows,openWindow:async url=>windowsOpened.push(url)},skipWaiting:async()=>{},addEventListener:(type,fn)=>{listeners[type]=fn;}},
 caches:{keys:async()=>{if(failKeys)throw Error('unavailable');return ['ricotta-static-old','ricotta-static-dev','ricotta-badge','another-app'];},delete:async key=>deleted.push(key),open:async()=>{if(failOpen)throw Error('unavailable');return {...cache,match:async req=>{if(failMatch)throw Error('unavailable');return cache.match(req);},put:async(req,res)=>{if(failStore)throw Error('quota');return cache.put(req,res);}};}},
 Response:{redirect:(url,status)=>({redirectTo:url,status})},
 fetch:async(req,init)=>{
  if(typeof req==='string'){pageFetches.push([req,init.cache]);if(offline && init.cache==='no-cache')throw TypeError('offline');return {ok:true,redirected:moved,url:moved?req+'moved/':req};}
  network.push(req.url);return {ok:true,type:'basic',clone(){return this}};}});
vm.runInContext(fs.readFileSync('sw.js','utf8').replace('const STATIC_FILES = [];',"const STATIC_FILES = ['assets/app.123456789abc.js'];"),context);
async function runFetch(url,method='GET',mode){
 let response;const pending=[];
 listeners.fetch({request:{url,method,mode},respondWith:p=>{response=p;},waitUntil:p=>pending.push(p)});
 const result=response?await response:null;await Promise.all(pending);return result;
}
(async()=>{
 let activation;listeners.activate({waitUntil:p=>{activation=p;}});await activation;
 assert.deepEqual(deleted,['ricotta-static-old'],'badge and unrelated caches remain');
 for(const url of ['https://example.test/Ricotta/','https://example.test/Ricotta/config.js','https://project.supabase.co/functions/v1/api/bootstrap',asset+'?query=private','https://example.test/other/assets/app.123456789abc.js']) assert.equal(await runFetch(url),null,'never intercept '+url);
 assert.equal(await runFetch(asset,'POST'),null);
 assert.ok(await runFetch(asset));assert.ok(await runFetch(asset));assert.equal(network.length,1,'immutable asset hits cache');
 stored.clear();failStore=true;assert.ok(await runFetch(asset),'storage quota never breaks loading');
 failStore=false;failOpen=true;assert.ok(await runFetch(asset),'unavailable storage falls back to network');
 failOpen=false;failMatch=true;assert.ok(await runFetch(asset),'failed cache lookup falls back to network');
 // Opening the app: always the newest page (checked with the server), the kept copy when offline, never stored.
 const page='https://example.test/Ricotta/?n=update';
 assert.equal((await runFetch(page,'GET','navigate')).url,page);
 offline=true;assert.equal((await runFetch(page,'GET','navigate')).url,page,'offline: the copy the browser kept');offline=false;
 assert.deepEqual(pageFetches,[[page,'no-cache'],[page,'no-cache'],[page,'force-cache']],'the page is revalidated every time');
 moved=true;assert.deepEqual(await runFetch(page,'GET','navigate'),{redirectTo:page+'moved/',status:302},'a moved page opens at its new address');moved=false;
 assert.equal(await runFetch('https://example.test/other/','GET','navigate'),null,'pages outside the app are left alone');
 assert.equal(stored.size,0,'pages are never stored');
 // The app's own page is kept for offline only when every assets/ file it names is this build's, and
 // opens when neither the network nor the browser's copy can.
 const pageWith=html=>({ok:true,type:'basic',redirected:false,url:'https://example.test/Ricotta/',clone(){return this;},text:async()=>html});
 failMatch=false;
 let nextPage=pageWith('<script src="assets/app.000000000000.js"></script>'),pageDown=false;
 context.fetch=async(req,init)=>{if(typeof req==='string'){if(pageDown)throw TypeError('offline');return nextPage;}network.push(req.url);return {ok:true,type:'basic',clone(){return this}};};
 await runFetch('https://example.test/Ricotta/','GET','navigate');
 assert.equal(stored.size,0,'a page naming files of another build is not kept');
 nextPage=pageWith('<link href="assets/app.123456789abc.js"><script src="assets/app.123456789abc.js"></script>');
 await runFetch('https://example.test/Ricotta/?n=update','GET','navigate');
 assert.equal(stored.get('https://example.test/Ricotta/'),nextPage,'this build\'s page is kept under the app\'s address');
 await runFetch('https://example.test/Ricotta/privacy.html','GET','navigate');
 assert.equal(stored.size,1,'other pages are never kept');
 pageDown=true;
 assert.equal(await runFetch('https://example.test/Ricotta/','GET','navigate'),nextPage,'offline with no browser copy: the kept page');
 await assert.rejects(runFetch('https://example.test/Ricotta/privacy.html','GET','navigate'),'other pages are not answered from it');
 pageDown=false;stored.clear();
 failKeys=true;listeners.activate({waitUntil:p=>{activation=p;}});await activation;assert.equal(claims,2,'cache cleanup failure cannot block activation');
 const dispatch = (kind, data)=>{
  let done;listeners[kind]({...data,waitUntil:p=>{done=p;}});return done;
 };
 await dispatch('push',{data:{json:()=>null}});
 assert.equal(notifications[0].title,'Ricotta Orders','even a null payload shows a notification');
 await dispatch('push',{data:{json:()=>({kind:'assistant',body:'Reminder text',view:'history'})}});
 assert.equal(notifications[1].options.body,'Reminder text');
 assert.equal(Object.hasOwn(notifications[1].options.data,'body'),false,'the tap payload only contains routing data');
 const outside={url:'https://example.test/other/',visibilityState:'visible',focus:async()=>assert.fail('other apps must not be focused'),postMessage:()=>assert.fail('other apps must not receive tap details')};
 const inside={url:'https://example.test/Ricotta/index.html',visibilityState:'hidden',focus:async()=>{},postMessage:data=>windowsMessaged.push(JSON.parse(JSON.stringify(data)))};
 const tap={notification:{data:{kind:'assistant',supplierId:'',view:'history'},close(){}}};
 windows=[outside,inside];await dispatch('notificationclick',tap);
 assert.deepEqual(windowsMessaged,[{kind:'assistant',supplierId:'',view:'history'}]);
 windows=[outside];await dispatch('notificationclick',tap);
 assert.deepEqual(windowsOpened,['https://example.test/Ricotta/?n=assistant&v=history']);
 console.log('Static cache smoke PASS: immutable-only GET cache, the page always fresh (offline: the browser copy, else this build\'s own page), no config/API/user data, safe quota failure and old-version cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
