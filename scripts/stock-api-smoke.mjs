// Offline regression checks: all database calls are mocked; no live requests or credentials.
// Node 24+: node scripts/stock-api-smoke.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {BodyTooLarge,InvalidBody,readJsonBody} from '../supabase/functions/_shared/security.ts';

const workerToken='offline-worker-token-'.repeat(3), sessionToken='offline-session';
const hash=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
const workerHash=await hash(workerToken), sessionHash=await hash(sessionToken);
let tables, rpcCalls, failRead, failInsert, failUpdate, failRpc, pinLocked, rejectSettings;
function reset(){
  tables={stock_workers:[{id:'offline-pc',token_hash:workerHash,enabled:true}],
    app_sessions:[{account:'rozha',token_hash:sessionHash,expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null}],
    app_login_attempts:[],stock_receipts:[],stock_item_jobs:[],
    app_suppliers:[{id:'supplier',name:'Fresh Foods'}],app_items:[{id:'item',name:'Tomato',unit_id:'box'}],
    app_units:[{id:'box',en:'box'},{id:'kg',en:'kg'}],
    stock_item_settings:[{item_id:'item',counting_unit:'kg',per_buying:12,workplace_name:null}]};
  rpcCalls=[];failRead=null;failInsert=null;failUpdate=null;failRpc=null;pinLocked=false;rejectSettings=false;
}
reset();
const clone=value=>value===undefined?undefined:structuredClone(value);
function eligibility(expression,row){
  const stale=expression.match(/claimed_at\.lt\.([^)]*)/)?.[1];
  if(!stale)throw new Error(`Unexpected OR filter: ${expression}`);
  return row.status==='waiting'||(row.status==='preparing'&&Date.parse(row.claimed_at)<Date.parse(stale));
}
const db={
  from(table){
    let action='read',value,limit=Infinity;const filters=[];
    const query={
      select(){return query},order(){return query},range(){return query},limit(n){limit=n;return query},
      eq(k,v){filters.push(row=>row[k]===v);return query},
      in(k,values){filters.push(row=>values.includes(row[k]));return query},
      is(k,v){filters.push(row=>row[k]===v);return query},
      gt(k,v){filters.push(row=>row[k]>v);return query},
      gte(k,v){filters.push(row=>row[k]>=v);return query},
      lt(k,v){filters.push(row=>row[k]<v);return query},
      not(k,operator,v){assert.equal(operator,'is');filters.push(row=>row[k]!==v);return query},
      or(expression){filters.push(row=>eligibility(expression,row));return query},
      insert(v){action='insert';value=v;return query},
      update(v){action='update';value=v;return query},
      upsert(v){action='upsert';value=v;return query},
      delete(){action='delete';return query},
      maybeSingle(){return run(true)},single(){return run(true)},
      then(resolve,reject){return run(false).then(resolve,reject)},
    };
    async function run(single){
      if(action==='read'&&failRead===table)return {data:null,error:{message:'offline read error'},count:null};
      if(action==='insert'&&failInsert===table)return {data:null,error:{message:'offline insert error'}};
      if(action==='update'&&failUpdate===table)return {data:null,error:{message:'offline update error'}};
      const rows=tables[table]??(tables[table]=[]);
      let result=rows.filter(row=>filters.every(match=>match(row))).slice(0,limit);
      if(action==='insert'){
        if(value.client_key&&rows.some(row=>row.client_key===value.client_key))return {data:null,error:{code:'23505',message:'duplicate key'}};
        if(table==='stock_item_jobs'&&rows.some(row=>row.item_id===value.item_id&&['waiting','preparing','prepared','submitting','needs_checking'].includes(row.status)))return {data:null,error:{code:'23505',message:'duplicate open item'}};
        result=(Array.isArray(value)?value:[value]).map(row=>({id:crypto.randomUUID(),status:'waiting',...clone(row)}));rows.push(...result);
      }else if(action==='update'){
        for(const row of result)Object.assign(row,clone(value));
      }else if(action==='upsert'){
        const old=rows.find(row=>row.id===value.id);if(old)Object.assign(old,clone(value));else rows.push(clone(value));result=[value];
      }else if(action==='delete'){
        for(const row of result)rows.splice(rows.indexOf(row),1);
      }
      return {data:clone(single?result[0]??null:result),error:null,count:result.length};
    }
    return query;
  },
  async rpc(name,parameters){
    rpcCalls.push({name,parameters});
    if(name===failRpc)return {data:null,error:{message:'offline RPC error'}};
    if(name==='app_internal_reserve_login')return {data:pinLocked?null:[1,2],error:null};
    if(name==='app_internal_check_account_pin')return {data:true,error:null};
    if(name==='stock_save_item_settings'&&rejectSettings)return {data:null,error:{code:'P0001',message:'Unknown recipe unit'}};
    return {data:crypto.randomUUID(),error:null};
  },
};

let handler;
const source=readFileSync(new URL('../supabase/functions/stock-api/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
new Function('createClient','Deno','BodyTooLarge','InvalidBody','readJsonBody',stripTypeScriptTypes(source))(
  ()=>db,{env:{get:()=>''},serve:fn=>{handler=fn}},BodyTooLarge,InvalidBody,readJsonBody);
const request=async(route,body,who='person',method='POST')=>handler(new Request(`https://offline.test/stock-api/${route}`,{
  method,headers:{'content-type':'application/json',...(who==='worker'?{'x-worker-token':workerToken}:who==='person'?{'x-session-token':sessionToken}:{})},
  body:method==='GET'?undefined:JSON.stringify(body),
}));
const id=crypto.randomUUID();

assert.equal((await request('requests',{},'none')).status,401,'unauthenticated mutations are denied');
tables.app_sessions[0].expires_at='not a date';
assert.equal((await request('requests',{})).status,401,'invalid session expiry fails closed');
reset();
assert.equal((await request('settings/item',null,'person','PUT')).status,400,'JSON null cannot reach field access');
assert.equal((await request('settings/item',{workplaceName:'ڤ'.repeat(40000)},'person','PUT')).status,413,'UTF-8 bytes bound body size');

// Both workers read the same waiting candidate. Only one compare-and-set must win.
for(const [table,route,key,report] of [
  ['stock_receipts','receipt-claim','receipt','receipt-report'],['stock_item_jobs','itemjob-claim','job','itemjob-report'],
]){
  reset();
  tables[table]=[{id,status:'waiting',claimed_at:null,created_at:new Date().toISOString(),payload:{name:'Tomato'},kind:'create'}];
  const answers=await Promise.all([request(`worker/${route}`,{},'worker'),request(`worker/${route}`,{},'worker')]);
  const claimed=(await Promise.all(answers.map(response=>response.json()))).map(body=>body[key]).filter(Boolean);
  assert.equal(claimed.length,1,`${route}: a waiting task is claimed once`);
  assert.equal(typeof claimed[0].claimToken,'string');
  const oldToken=claimed[0].claimToken;
  tables[table][0].claimed_at=new Date(Date.now()-11*60000).toISOString();
  const reclaimed=(await (await request(`worker/${route}`,{},'worker')).json())[key];
  assert.ok(reclaimed,`${route}: stale preparation is reclaimable`);
  // Ensure a distinct lease timestamp even if both requests finish in one millisecond.
  tables[table][0].claimed_at=new Date(Date.now()+1).toISOString();
  reclaimed.claimToken=tables[table][0].claimed_at;
  assert.equal((await request(`worker/${report}`,{id,status:'failed',claimToken:oldToken},'worker')).status,409,'an old attempt cannot overwrite a reclaimed task');
  assert.equal(tables[table][0].status,'preparing');
  assert.equal((await request(`worker/${report}`,{id,status:'prepared',claimToken:reclaimed.claimToken},'worker')).status,200);
  assert.equal(tables[table][0].status,'prepared');
}

reset();
const settings={countingUnit:'kg',perBuying:12,lowStock:2,usageUnit:'box',perCountingUsage:'wrong'};
assert.equal((await request('settings/item',settings,'person','PUT')).status,400);
assert.equal(rpcCalls.length,0,'validate every setting before a write');
assert.equal((await request('settings/item',{countingUnit:'kg',perBuying:12,lowStock:'9'.repeat(400)},'person','PUT')).status,400);
assert.equal(rpcCalls.length,0,'a decimal string that overflows cannot turn into SQL null');
settings.perCountingUsage=2;
assert.equal((await request('settings/item',settings,'person','PUT')).status,200);
assert.deepEqual(rpcCalls.map(call=>call.name),['stock_save_item_settings'],'all settings use one transactional RPC');
assert.equal(rpcCalls[0].parameters.p_save_usage,true);
await request('settings/item',{countingUnit:'kg',perBuying:12},'person','PUT');
assert.equal(rpcCalls.at(-1).parameters.p_save_usage,false,'omitted recipe setup is preserved');
rejectSettings=true;
assert.equal((await request('settings/item',settings,'person','PUT')).status,400);
assert.equal(rpcCalls.at(-1).name,'stock_save_item_settings');

// A DB outage in rate-limit checks or attempt recording cannot authorize a recount.
const count={itemId:'item',storage:'Main Storage',quantity:1,countedAt:new Date().toISOString(),pin:'offline'};
reset();failRpc='app_internal_reserve_login';
assert.equal((await request('counts',count)).status,400);
assert.deepEqual(rpcCalls.map(call=>call.name),['app_internal_reserve_login']);
reset();pinLocked=true;
assert.equal((await request('counts',count)).status,429);
assert.deepEqual(rpcCalls.map(call=>call.name),['app_internal_reserve_login']);
reset();failUpdate='app_login_attempts';
assert.equal((await request('counts',count)).status,400);
assert.deepEqual(rpcCalls.map(call=>call.name),['app_internal_reserve_login','app_internal_check_account_pin']);

const receipt={clientKey:crypto.randomUUID(),supplierId:'supplier',invoice:'INV-1',currency:'IQD',delivery:null,
  lines:[{itemId:'item',unitId:'box',qty:1,cost:10}]};
reset();
const retries=await Promise.all([request('receipts',receipt),request('receipts',receipt)]);
assert.deepEqual(retries.map(response=>response.status),[201,201]);
const ids=await Promise.all(retries.map(async response=>(await response.json()).id));
assert.equal(ids[0],ids[1],'concurrent retries return one receipt ID');
assert.equal(tables.stock_receipts.length,1);
reset();
for(const changed of [{currency:'other'},{currency:'USD',rate:1500.00005},{delivery:0.001},{lines:[{itemId:'item',unitId:'kg',qty:0.0000001,cost:10}]}]){
  assert.equal((await request('receipts',{...receipt,...changed,clientKey:crypto.randomUUID()})).status,400,'invalid amounts are rejected before insert');
}
tables.stock_item_settings[0].per_buying=0.00000001;
assert.equal((await request('receipts',{...receipt,clientKey:crypto.randomUUID(),lines:[{itemId:'item',unitId:'box',qty:0.000001,cost:10}]})).status,400,'a conversion rounded to zero cannot reach workplace submission');
assert.equal(tables.stock_receipts.length,0);
reset();
tables.stock_item_settings[0].usage_unit='kg';tables.stock_item_settings[0].low_stock=null;
const job={clientKey:crypto.randomUUID(),itemId:'item',kind:'create'};
const jobRetries=await Promise.all([request('itemjobs',job),request('itemjobs',job)]);
assert.deepEqual(jobRetries.map(response=>response.status),[201,201]);
const jobIds=await Promise.all(jobRetries.map(async response=>(await response.json()).id));
assert.equal(jobIds[0],jobIds[1]);assert.equal(tables.stock_item_jobs.length,1);
reset();tables.stock_item_settings[0].usage_unit='kg';tables.stock_item_settings[0].low_stock=null;
const collisions=await Promise.all([request('itemjobs',{...job,clientKey:crypto.randomUUID()}),request('itemjobs',{...job,clientKey:crypto.randomUUID()})]);
assert.deepEqual(collisions.map(response=>response.status).sort(),[201,400],'the pending-item constraint permits only one task');
assert.match((await collisions.find(response=>response.status===400).json()).error,/already has a task/);
assert.equal(tables.stock_item_jobs.length,1);
console.log('Stock API smoke: PASS (authentication, bounded JSON, claim races and stale reports, transactional settings, PIN failure handling, receipt retry and precision)');
