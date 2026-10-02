const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const storage = fs.readFileSync(path.join(root,'storage.js'),'utf8');
const stock = fs.readFileSync(path.join(root,'stock.js'),'utf8');
const sessionHelpers = storage.slice(0,storage.indexOf('/* What this device says'));
const reads = stock.slice(stock.indexOf('const stockReads ='),stock.indexOf('function stApplyLive'));
assert.ok(sessionHelpers.includes('function staleApiReply') && reads.includes('stockApiRequest'));
const deferred = ()=>{ let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}; };
const reply = (data,status=200)=>({status,ok:status===200,json:async()=>data});
function browser(){
  const saved=new Map([['ricottaOrders:apiSession',JSON.stringify({token:'fixture',account:'rozha',expiresAt:'2099-01-01T00:00:00Z'})]]);
  let expired=0;const calls=[];
  const ctx=vm.createContext({SUPABASE_URL:'https://fixture.invalid',STOCK_API_URL:'https://fixture.invalid/stock',
    state:{account:'rozha'},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    AbortController,setTimeout,clearTimeout,onSessionExpired:()=>expired++,
    fetch:async(url,options)=>{calls.push({url,options});return reply({});}});
  vm.runInContext(sessionHelpers+reads,ctx);
  return {ctx,calls,expired:()=>expired,get:()=>vm.runInContext("stockApi('requests')",ctx),
    write:()=>vm.runInContext("stockApi('counts',{method:'POST',body:{}})",ctx)};
}
test('stock reads are coalesced until they complete',async()=>{
  const b=browser(),slow=deferred();b.ctx.fetch=()=>{b.calls.push({});return slow.promise;};
  const a=b.get(),c=b.get();assert.equal(a,c);assert.equal(b.calls.length,1);
  slow.resolve(reply({quantity:2}));assert.equal((await a).data.quantity,2);
});
test('a read started before a stock write cannot replace the post-write snapshot',async()=>{
  const b=browser(),slow=deferred();let request=0;
  b.ctx.fetch=()=>++request===1?slow.promise:Promise.resolve(reply({quantity:3}));
  const old=b.get();assert.equal((await b.write()).ok,true);
  assert.equal((await b.get()).data.quantity,3);
  slow.resolve(reply({quantity:1}));assert.equal((await old).stale,true);
});
test('a read started during a write is invalidated when the write completes',async()=>{
  const b=browser(),mutation=deferred(),slow=deferred();let request=0;
  b.ctx.fetch=()=>++request===1?mutation.promise:slow.promise;
  const write=b.write(),read=b.get();mutation.resolve(reply({}));await write;
  slow.resolve(reply({quantity:1}));assert.equal((await read).stale,true);
});
test('an account change during JSON decoding discards even a 401 without logging out the current UI',async()=>{
  const b=browser(),body=deferred(),reading=deferred();
  b.ctx.fetch=async()=>({status:401,ok:false,json:()=>{reading.resolve();return body.promise;}});
  const read=b.get();await reading.promise;b.ctx.state.account='yunis';body.resolve({privateData:'old account'});
  const result=await read;assert.equal(result.stale,true);assert.equal(result.data,null);assert.equal(b.expired(),0);
});
test('a mismatched UI account cannot send a stock request',async()=>{
  const b=browser();b.ctx.state.account='yunis';assert.equal((await b.get()).stale,true);assert.equal(b.calls.length,0);
});
