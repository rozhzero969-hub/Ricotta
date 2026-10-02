/* Uses the disposable SQL database from db-smoke.sh. Real parallel sessions
   prove unique retries, additive stock updates and quota reservations serialize.
   PG* variables select CI Postgres; DB_SMOKE_CONTAINER selects a local test container. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
async function sql(query){
  const args = ['-X','-v','ON_ERROR_STOP=1','-At','-c',query];
  const command = process.env.DB_SMOKE_CONTAINER ? 'docker' : 'psql';
  const commandArgs = process.env.DB_SMOKE_CONTAINER ? ['exec','-e','PGUSER=postgres','-e',`PGDATABASE=${process.env.PGDATABASE || 'postgres'}`,process.env.DB_SMOKE_CONTAINER,'psql',...args] : args;
  return (await exec(command,commandArgs,{maxBuffer:1024*1024})).stdout.trim();
}
const prefix = `concurrency-${process.pid}-${Date.now()}`;
const item = `${prefix}-item`, unit = `${prefix}-unit`, supplier = `${prefix}-supplier`;
const lines = JSON.stringify([{supplier_id:supplier,supplier_name:'Bakery',item_id:item,item_name:'Flour',unit_id:unit,qty:1}]);
// Fixture ids contain only fixed ASCII and digits, so SQL literals are safe.
try{
  await sql(`insert into app_units values('${unit}','box'); insert into app_items values('${item}','Flour','${unit}'); insert into app_suppliers values('${supplier}','Bakery'); insert into app_item_pars(item_id,par_qty,est_qty) values('${item}',20,0);`);
  const retry = await Promise.all(Array.from({length:12},()=>sql(`select app_internal_save_order('${prefix}-retry',now(),'rozha','${lines}'::jsonb)`)));
  assert.equal(retry.filter(x=>x==='t').length,1,'one retry inserts the order');
  assert.equal(await sql(`select count(*) from app_order_lines where order_id='${prefix}-retry'`),'1');
  await Promise.all(Array.from({length:12},(_,i)=>sql(`select app_internal_save_order('${prefix}-order-${i}',now(),'rozha','${lines}'::jsonb)`)));
  assert.equal(await sql(`select est_qty from app_item_pars where item_id='${item}'`),'13.00','concurrent orders do not lose increments');
  await Promise.all([sql(`select app_internal_decay_stock('${item}',2,current_date)`),sql(`select app_internal_decay_stock('${item}',2,current_date)`),sql(`select app_internal_save_order('${prefix}-decay-order',now(),'rozha','${lines}'::jsonb)`)]);
  assert.equal(await sql(`select est_qty from app_item_pars where item_id='${item}'`),'12.00','daily decay and increments compose exactly once');
  const reserved = await Promise.all(Array.from({length:12},()=>sql(`select app_internal_reserve_assistant('${prefix}-device','rozha','pending:chat',3,1000)`)));
  assert.equal(reserved.filter(Boolean).length,3,'parallel assistant requests respect quota before provider work');
  const login = await Promise.all(Array.from({length:12},()=>sql(`select app_internal_reserve_login(array['${prefix}-ip','${prefix}-global'],600,3,1000)`)));
  assert.equal(login.filter(Boolean).length,3,'parallel PIN guesses respect quota before verification');
  console.log('Parallel database regressions passed (12 competing requests per case).');
}finally{
  await sql(`delete from app_orders where id like '${prefix}%'; delete from app_items where id='${item}'; delete from app_suppliers where id='${supplier}'; delete from app_units where id='${unit}'; delete from app_assistant_usage where device_id='${prefix}-device'; delete from app_login_attempts where fingerprint_hash in ('${prefix}-ip','${prefix}-global');`);
}
