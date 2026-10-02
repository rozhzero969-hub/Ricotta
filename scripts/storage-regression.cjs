/* Storage/session regression checks. Node only, with a mocked browser and
   fetch: no live Supabase requests or credentials are used.
   Run: node --test scripts/storage-regression.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function deferred(){
  let resolve, reject;
  const promise = new Promise((yes, no)=>{ resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function response(status = 200, data = {ok:true}){
  return {status, ok:status >= 200 && status < 300, json:async()=>data};
}
function browser(saved = new Map()){
  const calls = [], health = [];
  let expired = 0;
  const context = vm.createContext({
    SUPABASE_URL:'https://mock.example',
    localStorage:{
      getItem:key=>saved.get(key) ?? null,
      setItem:(key, value)=>saved.set(key, String(value)),
      removeItem:key=>saved.delete(key),
    },
    navigator:{userAgent:'Mock browser', maxTouchPoints:0},
    screen:{width:390, height:844},
    window:{devicePixelRatio:1, matchMedia:()=>({matches:false})},
    crypto:{randomUUID}, AbortController, TextDecoder,
    setTimeout, clearTimeout,
    setApiHealth:value=>health.push(value),
    onSessionExpired:()=>expired++,
    fetch:async(url, options)=>{ calls.push({url, options}); return response(); },
  });
  vm.runInContext(source, context, {filename:'storage.js'});
  const session = (token='first')=>context.lset('apiSession', {token, expiresAt:'2099-01-01T00:00:00Z', account:token});
  return {context, saved, calls, health, session, expired:()=>expired};
}
const job = id=>({path:'orders', method:'POST', body:{id}});

test('flushing removes only completed jobs and preserves writes queued during fetch', async()=>{
  const {context:c, session} = browser(); session();
  c.lset('outbox', [job('old')]);
  const first = deferred();
  const sent = [];
  c.fetch = async(url, options)=>{
    const id = JSON.parse(options.body).id; sent.push(id);
    return id === 'old' ? first.promise : response(503);
  };
  const flushing = c.flushOutbox();
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'new'}), 'queued');
  first.resolve(response());
  await flushing;
  assert.deepEqual(plain(c.outbox()).map(x=>x.body.id), ['new']);
  assert.deepEqual(sent, ['old', 'new'], 'new jobs wait until the next flush');
  c.fetch = async()=>response();
  await c.flushOutbox();
  assert.deepEqual(plain(c.outbox()), []);
});

test('completed jobs stay removed if a later request fails and new jobs are added', async()=>{
  const {context:c, session} = browser(); session();
  c.lset('outbox', [job('one'), job('two'), job('three')]);
  const second = deferred();
  c.fetch = async(url, options)=>JSON.parse(options.body).id === 'one' ? response() : second.promise;
  const flushing = c.flushOutbox();
  // Wait for the first successful removal and the second in-flight request.
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(plain(c.outbox()).map(x=>x.body.id), ['two', 'three']);
  c.queueOutboxJob('orders', 'POST', {id:'four'});
  second.resolve(response(503));
  await flushing;
  assert.deepEqual(plain(c.outbox()).map(x=>x.body.id), ['two', 'three', 'four']);
});

test('overlapping flushes send the pending order once', async()=>{
  const {context:c, calls, session} = browser(); session();
  c.lset('outbox', [job('order')]);
  const pending = deferred();
  c.fetch = async(...args)=>{ calls.push(args); return pending.promise; };
  const first = c.flushOutbox();
  await c.flushOutbox();
  assert.equal(calls.length, 1);
  pending.resolve(response()); await first;
  assert.deepEqual(plain(c.outbox()), []);
});

test('transient failures retain the current and all later writes without extra requests', async()=>{
  for(const status of [0, 401, 408, 425, 429, 500, 503]){
    const {context:c, calls, session} = browser(); session();
    c.lset('outbox', [job('first'), job('second')]);
    c.fetch = async(...args)=>{ calls.push(args); if(!status) throw Error('offline'); return response(status); };
    await c.flushOutbox();
    assert.deepEqual(plain(c.outbox()).map(x=>x.body.id), ['first', 'second'], `status ${status}`);
    assert.equal(calls.length, 1, `status ${status}`);
    session(); c.fetch = async()=>response();
    await c.flushOutbox();
    assert.deepEqual(plain(c.outbox()), [], 'failed attempts release the flush guard');
  }
});

test('permanent validation failures drop only the invalid job and continue', async()=>{
  const {context:c, session} = browser(); session();
  c.lset('outbox', [job('invalid'), job('valid')]);
  const sent = [];
  c.fetch = async(url, options)=>{
    const id = JSON.parse(options.body).id; sent.push(id);
    return response(id === 'invalid' ? 400 : 200);
  };
  await c.flushOutbox();
  assert.deepEqual(sent, ['invalid', 'valid']);
  assert.deepEqual(plain(c.outbox()), []);
});

test('an order has one retry job even after repeated failures', async()=>{
  const {context:c, session} = browser(); session();
  c.fetch = async()=>response(429);
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'same', value:1}), 'queued');
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'same', value:2}), 'queued');
  assert.deepEqual(plain(c.outbox()).map(x=>x.body), [{id:'same', value:1}]);
  assert.ok(c.outbox()[0].id, 'retry job receives a persistent local identity');
});

test('an order is persisted before fetch and can be recovered after reloading during a send', async()=>{
  const first = browser(); first.session('rozha');
  const pending = deferred(); first.context.fetch = async()=>pending.promise;
  const sending = first.context.sendOrQueue('orders', 'POST', {id:'unsure', by:'rozha'});
  const queued = plain(first.context.outbox());
  assert.equal(queued.length, 1, 'write exists on disk while the request is in flight');
  assert.equal(queued[0].account, 'rozha');
  // A new VM represents a new page loading the same device storage.
  const reloaded = browser(first.saved);
  await reloaded.context.flushOutbox();
  assert.equal(reloaded.calls.length, 1);
  assert.equal(JSON.parse(reloaded.calls[0].options.body).id, 'unsure');
  assert.deepEqual(plain(reloaded.context.outbox()), []);
  pending.resolve(response());
  assert.equal(await sending, 'saved');
});

test('a repeated active send and a heartbeat share one stable order request', async()=>{
  const {context:c, calls, session} = browser(); session('rozha');
  const pending = deferred();
  c.fetch = async(...args)=>{ calls.push(args); return pending.promise; };
  const first = c.sendOrQueue('orders', 'POST', {id:'same', by:'rozha', value:1});
  const repeated = c.sendOrQueue('orders', 'POST', {id:'same', by:'rozha', value:2});
  const heartbeat = c.flushOutbox();
  assert.equal(calls.length, 1);
  assert.equal(c.outbox().length, 1);
  assert.equal(JSON.parse(calls[0][1].body).value, 1, 'the original intent is kept');
  pending.resolve(response());
  assert.equal(await first, 'saved'); assert.equal(await repeated, 'saved');
  await heartbeat;
  assert.deepEqual(plain(c.outbox()), []);
});

test('a permanent send failure removes its write-ahead job', async()=>{
  const {context:c, session} = browser(); session();
  c.fetch = async()=>response(400);
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'invalid'}), 'failed');
  assert.deepEqual(plain(c.outbox()), []);
});

test('storage-full sends never claim an undurable order was queued', async()=>{
  for(const status of [0, 401, 429, 503, 200]){
    const {context:c, session} = browser(); session('rozha');
    c.localStorage.setItem = ()=>{ throw Error('storage full'); };
    assert.equal(c.lset('probe', 'value'), false);
    c.fetch = async()=>{ if(!status) throw Error('offline'); return response(status); };
    assert.equal(await c.sendOrQueue('orders', 'POST', {id:'unsaved', by:'rozha'}), status === 200 ? 'saved' : 'failed', `status ${status}`);
    assert.deepEqual(plain(c.outbox()), []);
  }
});

test('an already durable retry remains queued if a later storage write fails', async()=>{
  const {context:c, session} = browser(); session('rozha');
  c.fetch = async()=>response(503);
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'durable', by:'rozha'}), 'queued');
  c.localStorage.setItem = ()=>{ throw Error('storage full'); };
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'durable', by:'rozha'}), 'queued');
  assert.equal(c.outbox().length, 1);
});

test('queued and legacy orders retain their original account across sign-ins', async()=>{
  const {context:c, session} = browser(); session('yunis');
  c.lset('outbox', [job('unknown'), {...job('rozha-order'), body:{id:'rozha-order', by:'rozha'}}, {...job('yunis-order'), body:{id:'yunis-order', by:'yunis'}}]);
  const sent = [];
  c.fetch = async(url, options)=>{ sent.push({id:JSON.parse(options.body).id, token:options.headers['x-session-token']}); return response(); };
  await c.flushOutbox();
  assert.deepEqual(sent, [{id:'unknown', token:'yunis'}, {id:'yunis-order', token:'yunis'}]);
  assert.deepEqual(plain(c.outbox()).map(x=>({id:x.body.id, account:x.account})), [{id:'rozha-order', account:'rozha'}]);
  session('rozha'); await c.flushOutbox();
  assert.deepEqual(sent.at(-1), {id:'rozha-order', token:'rozha'});
  assert.deepEqual(plain(c.outbox()), []);
});

test('logging out during a new send preserves the write for its original account', async()=>{
  const {context:c, session, calls} = browser(); session('rozha');
  const pending = deferred(); c.fetch = async()=>pending.promise;
  const sending = c.sendOrQueue('orders', 'POST', {id:'original', by:'rozha'});
  c.clearApiSession(); session('yunis');
  pending.resolve(response(401));
  assert.equal(await sending, 'queued');
  c.fetch = async(...args)=>{ calls.push(args); return response(); };
  await c.flushOutbox();
  assert.equal(calls.length, 0, 'the next account cannot send the original user\'s order');
  assert.equal(c.outbox()[0].account, 'rozha');
  session('rozha'); await c.flushOutbox();
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(c.outbox()), []);
});

test('legacy and repeated local ids are upgraded without discarding writes', async()=>{
  const {context:c, session} = browser(); session();
  c.lset('outbox', [{...job('one'), id:'repeated'}, {...job('two'), id:'repeated'}, job('three')]);
  c.fetch = async()=>response(503);
  await c.flushOutbox();
  const jobs = plain(c.outbox());
  assert.equal(jobs.length, 3);
  assert.equal(new Set(jobs.map(x=>x.id)).size, 3);
});

test('old successful and unauthorized responses cannot update or expire a new session', async()=>{
  for(const status of [200, 401]){
    const {context:c, session, health, expired} = browser(); session('old');
    const pending = deferred(); c.fetch = async()=>pending.promise;
    const request = c.api('bootstrap');
    session('new'); pending.resolve(response(status, {account:'old'}));
    assert.deepEqual(plain(await request), {ok:false, status:0, data:null, stale:true});
    assert.equal(c.apiSession().token, 'new');
    assert.equal(expired(), 0); assert.deepEqual(health, []);
  }
});

test('session change while reading JSON discards the old payload', async()=>{
  const {context:c, session, health} = browser(); session('old');
  const data = deferred(), headersRead = deferred();
  c.fetch = async()=>({status:200, ok:true, json:()=>{ headersRead.resolve(); return data.promise; }});
  const request = c.api('bootstrap');
  await headersRead.promise; session('new'); data.resolve({account:'old'});
  assert.equal((await request).stale, true);
  assert.deepEqual(health, []);
});

test('old network failures and signed-out requests do not affect the next session', async()=>{
  const {context:c, session, health} = browser(); session('old');
  const pending = deferred(); c.fetch = async()=>pending.promise;
  const request = c.api('bootstrap');
  c.clearApiSession(); pending.reject(Error('offline'));
  assert.equal((await request).stale, true); assert.deepEqual(health, []);
});

test('current unauthorized replies expire the session once', async()=>{
  const {context:c, session, expired} = browser(); session();
  c.fetch = async()=>response(401);
  assert.equal((await c.api('bootstrap')).status, 401);
  assert.equal(c.apiSession(), null); assert.equal(expired(), 1);
});

test('login, recovery and public health replies retain their public semantics', async()=>{
  for(const path of ['login', 'recovery/verify', 'health']){
    const {context:c, session, expired} = browser(); session('old');
    const pending = deferred(); c.fetch = async()=>pending.promise;
    const request = c.api(path, {method:'POST', body:{}});
    session('new'); pending.resolve(response(401));
    assert.equal((await request).status, 401);
    assert.equal(c.apiSession().token, 'new'); assert.equal(expired(), 0);
  }
});

test('a stale flush reply preserves jobs for the next sign-in', async()=>{
  const {context:c, session, expired} = browser(); session('old');
  c.lset('outbox', [job('first'), job('second')]);
  const pending = deferred(); c.fetch = async()=>pending.promise;
  const flushing = c.flushOutbox();
  session('new'); pending.resolve(response(401)); await flushing;
  assert.deepEqual(plain(c.outbox()).map(x=>x.body.id), ['first', 'second']);
  assert.equal(c.apiSession().token, 'new'); assert.equal(expired(), 0);
});

test('a stream from the previous session delivers no events and cannot expire a new session', async()=>{
  for(const status of [200, 401]){
    const {context:c, session, health, expired} = browser(); session('old');
    const pending = deferred(), events = []; c.fetch = async()=>pending.promise;
    const streaming = c.apiStream('assistant/chat', {}, event=>events.push(event));
    session('new'); pending.resolve({...response(status), text:async()=>'{"type":"text","text":"old"}\n'});
    await streaming;
    assert.deepEqual(events, []); assert.deepEqual(health, []);
    assert.equal(c.apiSession().token, 'new'); assert.equal(expired(), 0);
  }
});

test('stream events stop when session changes within a received chunk', async()=>{
  const {context:c, session} = browser(); session('old');
  const events = [], bytes = new TextEncoder().encode('{"type":"text","text":"first"}\n{"type":"text","text":"old"}\n');
  let signal, reads = 0;
  c.fetch = async(url, options)=>{
    signal = options.signal;
    return {...response(), body:{getReader:()=>({read:async()=>++reads === 1 ? {value:bytes, done:false} : {done:true}})}};
  };
  await c.apiStream('assistant/chat', {}, event=>{ events.push(plain(event)); session('new'); });
  assert.deepEqual(events, [{type:'text', text:'first'}]);
  assert.equal(signal.aborted, true, 'the stale stream stops receiving network data');
});

test('session changes while awaiting the next stream chunk discard it', async()=>{
  const {context:c, session} = browser(); session('old');
  const chunk = deferred(), waiting = deferred(), events = [];
  c.fetch = async()=>({...response(), body:{getReader:()=>({read:()=>{waiting.resolve(); return chunk.promise;}})}});
  const streaming = c.apiStream('assistant/chat', {}, event=>events.push(event));
  await waiting.promise; session('new');
  chunk.resolve({value:new TextEncoder().encode('{"type":"text","text":"old"}\n'), done:false});
  await streaming;
  assert.deepEqual(events, []);
});

test('stream 429 reports busy and a current 401 expires the session', async()=>{
  const {context:c, session, expired} = browser(); session();
  const events = []; c.fetch = async()=>response(429);
  await c.apiStream('assistant/chat', {}, event=>events.push(plain(event)));
  assert.deepEqual(events, [{type:'error', code:'busy'}]);
  c.fetch = async()=>response(401);
  await c.apiStream('assistant/chat', {}, event=>events.push(plain(event)));
  assert.equal(c.apiSession(), null); assert.equal(expired(), 1);
});

test('another tab\'s account cannot send requests or chat from the previous account\'s UI', async()=>{
  const {context:c, calls, health, session, expired} = browser(); session('yunis');
  c.state = {account:'rozha'};
  assert.equal(c.apiAccountMatchesUi(c.apiSession()), false);
  const expected = {ok:false, status:0, data:null, stale:true};
  assert.deepEqual(plain(await c.api('items/i1', {method:'PUT', body:{name:'old UI'}})), expected);
  const events = [];
  assert.deepEqual(plain(await c.apiStream('assistant/chat', {}, event=>events.push(event))), expected);
  assert.equal(calls.length, 0, 'the mismatched session is rejected before fetch');
  assert.deepEqual(events, []); assert.deepEqual(health, []); assert.equal(expired(), 0);
  assert.equal(c.apiSession().account, 'yunis', 'the other tab\'s shared session is preserved');
});

test('account guards allow the active account and public login, recovery and health', async()=>{
  const {context:c, calls, session} = browser(); session('yunis');
  c.state = {account:'rozha'};
  for(const path of ['login', 'recovery/verify', 'health']) assert.equal((await c.api(path)).ok, true);
  assert.equal(calls.length, 3);
  c.state.account = 'yunis';
  assert.equal(c.apiAccountMatchesUi(c.apiSession()), true);
  assert.equal((await c.api('bootstrap')).ok, true);
  c.state.account = null;
  assert.equal((await c.api('bootstrap')).ok, true, 'boot without an account can read its signed session');
  assert.equal(calls.length, 5);
});

test('old UI writes retain their original owner before the cross-tab event arrives', async()=>{
  const {context:c, calls, session} = browser(); session('yunis');
  c.state = {account:'rozha'};
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'old-order', by:'rozha'}), 'queued');
  assert.equal(calls.length, 0);
  assert.equal(c.outbox()[0].account, 'rozha');
  c.state.account = 'yunis';
  await c.flushOutbox(); assert.equal(calls.length, 0, 'the new account cannot replay the previous UI\'s order');
  session('rozha'); c.state.account = 'rozha';
  await c.flushOutbox();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['x-session-token'], 'rozha');
  assert.deepEqual(plain(c.outbox()), []);
});

test('explicit original actor survives even after the old UI has been reset', async()=>{
  const {context:c, calls, session} = browser(); session('yunis');
  c.state = {account:null};
  assert.equal(await c.sendOrQueue('orders', 'POST', {id:'original', by:'rozha'}), 'queued');
  assert.equal(c.outbox()[0].account, 'rozha');
  assert.equal(calls.length, 0);
});

test('generic queued writes use the active UI account instead of another tab\'s new token', async()=>{
  const {context:c, calls, session} = browser(); session('yunis');
  c.state = {account:'rozha'};
  assert.equal(await c.sendOrQueue('items/i1', 'PUT', {name:'old UI'}), 'queued');
  assert.equal(c.outbox()[0].account, 'rozha');
  assert.equal(calls.length, 0);
});

test('changing the active UI account discards a response even when the stored token stays the same', async()=>{
  const {context:c, health, session} = browser(); session('rozha');
  c.state = {account:'rozha'};
  const pending = deferred(); c.fetch = async()=>pending.promise;
  const request = c.api('bootstrap');
  c.state.account = 'yunis'; pending.resolve(response());
  assert.equal((await request).stale, true);
  assert.deepEqual(health, []);
});
