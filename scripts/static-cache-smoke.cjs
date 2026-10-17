/* Cache boundaries are security boundaries: only exact public build assets may be stored. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const listeners={},stored=new Map(),deleted=[],network=[];
const asset='https://example.test/Ricotta/assets/app.123456789abc.js';
const cache={match:async req=>stored.get(req.url),put:async(req,res)=>stored.set(req.url,res)};
let failStore=false;
const context=vm.createContext({URL,Set,Promise,console,
 self:{registration:{scope:'https://example.test/Ricotta/'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(type,fn)=>{listeners[type]=fn;}},
 caches:{keys:async()=>['ricotta-static-old','ricotta-static-dev','ricotta-badge','another-app'],delete:async key=>deleted.push(key),open:async()=>({...cache,put:async(req,res)=>{if(failStore)throw Error('quota');return cache.put(req,res);}})},
 fetch:async req=>{network.push(req.url);return {ok:true,type:'basic',clone(){return this}};}});
vm.runInContext(fs.readFileSync('sw.js','utf8').replace('const STATIC_FILES = [];',"const STATIC_FILES = ['assets/app.123456789abc.js'];"),context);
async function runFetch(url,method='GET'){
 let response;const pending=[];
 listeners.fetch({request:{url,method},respondWith:p=>{response=p;},waitUntil:p=>pending.push(p)});
 const result=response?await response:null;await Promise.all(pending);return result;
}
(async()=>{
 let activation;listeners.activate({waitUntil:p=>{activation=p;}});await activation;
 assert.deepEqual(deleted,['ricotta-static-old'],'badge and unrelated caches remain');
 for(const url of ['https://example.test/Ricotta/','https://example.test/Ricotta/config.js','https://project.supabase.co/functions/v1/api/bootstrap',asset+'?query=private','https://example.test/other/assets/app.123456789abc.js']) assert.equal(await runFetch(url),null,'never intercept '+url);
 assert.equal(await runFetch(asset,'POST'),null);
 assert.ok(await runFetch(asset));assert.ok(await runFetch(asset));assert.equal(network.length,1,'immutable asset hits cache');
 stored.clear();failStore=true;assert.ok(await runFetch(asset),'storage quota never breaks loading');
 console.log('Static cache smoke PASS: immutable-only GET cache, no HTML/config/API/user data, safe quota failure and old-version cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
