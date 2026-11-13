/* Delayed replies must stay with the account/chat that started them. No network or browser. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('assistant.js', 'utf8');
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const turn = () => new Promise(r => setImmediate(r));
function fixture() {
  const saved = new Map(), notices = [], asked = [];
  const c = vm.createContext({
    rico:{epoch:0,chatRequest:0,messages:[],streaming:false,chats:null,viewing:null},
    state:{account:'rozha',view:'assistant',suppliers:[],cart:{},lang:'en'},
    ricoSaveTimer:null,
    lget:key=>saved.get(key), lset:(key,v)=>v == null?saved.delete(key):saved.set(key,v),
    t:key=>key, toast:msg=>notices.push(msg), render(){}, ricoScroll(){}, ricoSave(){},
    clearTimeout, AbortController, Blob, console, navigator:{mediaDevices:{}}, window:{},
    ricoRefreshComposer(){}, aiConsent:async()=>true,
    ricoAsk:text=>asked.push(text),
    ricoStop(){ c.rico.abort?.abort(); },
    ricoOrderIntent:()=>false, ricoHistoryForServer:()=>[], ricoAutoOrder:()=>false,
    ricoPaintMessage(){}, ricoPaintHeadFace(){}, ricoSaveSoon(){},
    requestAnimationFrame:()=>1, cancelAnimationFrame(){},
  });
  vm.runInContext(part('function ricoContext()', '/* ---------- Events ---------- */') +
    part('function ricoNewChat()', '/* Chat history:'), c);
  return {c,saved,notices,asked};
}
(async()=>{
  const {c,saved}=fixture();
  saved.set('ricoDraft','unowned old text'); saved.set('ricoDraft:rozha','Rozha draft');
  assert.equal(c.ricoReadDraft(),'Rozha draft'); assert.equal(saved.has('ricoDraft'),false);
  c.state.account='yunis'; assert.equal(c.ricoReadDraft(),undefined,'one account never inherits another draft');
  c.state.account='rozha'; assert.equal(c.ricoReadDraft(),'Rozha draft','the owner keeps their draft');

  const pending=deferred(), chat=fixture();
  chat.c.api=()=>pending.promise;
  const opening=chat.c.ricoOpenChat('old');
  chat.c.ricoNewChat();
  pending.resolve({ok:true,data:{account:'rozha',messages:[{role:'user',text:'Old'}]}});
  assert.equal(await opening,false); assert.equal(chat.c.rico.messages.length,0,'a delayed open cannot replace a new chat');

  const first=deferred(), second=deferred(), ordered=fixture();
  ordered.c.api=path=>path.endsWith('/first')?first.promise:second.promise;
  const a=ordered.c.ricoOpenChat('first'), b=ordered.c.ricoOpenChat('second');
  second.resolve({ok:true,data:{account:'rozha',messages:[{role:'user',text:'Second'}]}}); await b;
  first.resolve({ok:true,data:{account:'rozha',messages:[{role:'user',text:'First'}]}}); await a;
  assert.equal(ordered.c.rico.messages[0].text,'Second','the most recently selected chat wins');

  const consent=fixture(), decision=deferred();
  consent.c.esc=s=>s; consent.c.showConfirm=()=>decision.promise;
  vm.runInContext(part('const aiConsentKey', '/* Signing out forgets'),consent.c);
  const agreeing=consent.c.aiConsent();
  consent.c.state.account='yunis'; consent.c.rico.epoch++;
  decision.resolve(true);
  assert.equal(await agreeing,false,'late consent cannot authorize the next account');
  assert.equal(consent.saved.has('aiConsent2:yunis'),false);

  const stream=fixture(), done=deferred(); let event;
  vm.runInContext(part('async function ricoAsk(', '/* Repaints one message in place'),stream.c);
  stream.c.apiStream=(_path,_body,onEvent)=>{event=onEvent; return done.promise;};
  const replying=stream.c.ricoAsk('Hello'); await turn();
  stream.c.ricoNewChat(); stream.c.rico.streaming=true;
  event({type:'proposal',proposal:{kind:'order',lines:[]}}); done.resolve(); await replying;
  assert.equal(stream.c.rico.messages.length,0,'old events cannot populate the new chat');
  assert.equal(stream.c.rico.streaming,true,'old completion cannot stop a newer reply');
  // Sorting a catalog should allocate one native collator per language, not per comparison.
  const app=fs.readFileSync('app.js','utf8'); let collators=0;
  const sorting=vm.createContext({state:{lang:'en'},LANGS:['en','ku','ar'],Intl:{Collator:function(...args){collators++;return new Intl.Collator(...args);}}});
  vm.runInContext(app.slice(app.indexOf('const nameCollators'),app.indexOf('/* Was anything already sent')),sorting);
  sorting.rows=Array.from({length:181},(_,i)=>({name:'Item '+(181-i)}));
  vm.runInContext('sortedByName(rows); sortedSupplierItems(rows);',sorting);
  assert.equal(collators,1,'one reused collator for repeated list sorts');
  sorting.state.lang='ku'; vm.runInContext('sortedByName(rows)',sorting); assert.equal(collators,2);
  console.log('Rico lifecycle PASS: isolated drafts, stale chat opens, latest selection, stale streaming');
})().catch(e=>{console.error(e);process.exitCode=1;});
