/* The Expenses tab (2026-11-15): suppliers say what is bought from them (food, expenses or both) and every
   item is food or an expense. Everything already in the database stays food; a new record without the
   fields is food; an edit that doesn't mention them keeps them; an item's Undo brings its kind back; the
   Record names them only when they say something other than food. Also the api's catalog rules. Runs every
   migration in PGlite. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));
 const files=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
 const at=files.indexOf('20261115130000_expenses_tab.sql');assert.ok(at>=0,'the migration is there');
 for(const f of files.slice(0,at))await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const change=(table,id,row)=>db.query("select app_internal_catalog_change($1,$2,$3::jsonb,'rozha','device')",[table,id,row===null?null:JSON.stringify(row)]);
 await db.exec("insert into app_accounts(id,name,pin_hash,pins) values('rozha','Rozha','test','{}'),('yunis','Yunis','test','{}');insert into app_units(id,en) values('kg','kg'),('pc','piece');insert into app_suppliers(id,name) values('old','Market');insert into app_items(id,name,unit_id,supplier_id) values('olditem','Tomatoes','kg','old');");
 for(const f of files.slice(at))await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 assert.deepEqual((await q("select buys from app_suppliers where id='old'"))[0],{buys:'food'},'an existing supplier is food');
 assert.deepEqual((await q("select kind from app_items where id='olditem'"))[0],{kind:'food'},'an existing item is food');

 // New records: food unless they say otherwise; nothing else is accepted.
 await change('suppliers','cups',{name:'Paper Co',phone:'',reminder:null,buys:'expenses'});
 await change('suppliers','both',{name:'Wholesale',phone:'',reminder:null,buys:'both'});
 await change('suppliers','plain',{name:'Butcher',phone:'',reminder:null});
 assert.deepEqual(await q("select id,buys from app_suppliers where id in ('cups','both','plain') order by id"),[{id:'both',buys:'both'},{id:'cups',buys:'expenses'},{id:'plain',buys:'food'}]);
 await assert.rejects(change('suppliers','bad',{name:'Bad',buys:'drinks'}),/check/i,'only food, expenses or both');
 await change('items','tea',{name:'Tea',unit_id:'pc',supplier_id:'cups',sort_order:null,aliases:[],available:true,kind:'expense'});
 await change('items','bread',{name:'Bread',unit_id:'pc',supplier_id:'both',sort_order:null,aliases:[],available:true});
 assert.deepEqual(await q("select id,kind from app_items where id in ('tea','bread') order by id"),[{id:'bread',kind:'food'},{id:'tea',kind:'expense'}]);
 await assert.rejects(change('items','x',{name:'X',kind:'drink'}),/check/i,'an item is food or an expense');

 // An edit of other fields keeps them; an edit of them changes only them.
 await change('suppliers','cups',{name:'Paper Company',partial:true});
 await change('items','tea',{name:'Black tea',partial:true});
 assert.equal((await q("select buys from app_suppliers where id='cups'"))[0].buys,'expenses','a rename keeps what a supplier sells');
 assert.equal((await q("select kind from app_items where id='tea'"))[0].kind,'expense','a rename keeps the kind');
 await change('suppliers','plain',{buys:'both',partial:true});
 assert.deepEqual((await q("select name,buys from app_suppliers where id='plain'"))[0],{name:'Butcher',buys:'both'});

 // The Record: new food records say nothing about it; expenses and changes are named.
 const lastAudit=async name=>(await q("select action,payload from app_audit_events where entity_name=$1 order by occurred_at desc, id desc limit 1",[name]))[0];
 assert.ok(!(await lastAudit('Bread')).payload.fields.some(f=>f.k==='kind'),'a new food item does not mention it');
 assert.ok(!(await lastAudit('Wholesale')).payload.fields.some(f=>f.k==='buys'&&f.to==='food'));
 const teaAdd=(await q("select payload from app_audit_events where entity_name='Tea' and action='add'"))[0];
 assert.deepEqual(teaAdd.payload.fields.find(f=>f.k==='kind'),{k:'kind',to:'expense'},'a new expense item says so');
 const butcher=await lastAudit('Butcher');
 assert.deepEqual(butcher.payload.fields,[{k:'buys',from:'food',to:'both'}],'a change of what a supplier sells is recorded');

 // Delete and Undo bring an expense item back as an expense.
 const receipt=(await q("select app_internal_item_undo('tea','rozha','device',false) as d"))[0].d;
 assert.equal((await q("select count(*)::int n from app_items where id='tea'"))[0].n,0);
 assert.equal((await q("select app_internal_item_undo($1,'rozha','device',true) as d",[receipt.undoId]))[0].d.ok,true);
 assert.equal((await q("select kind from app_items where id='tea'"))[0].kind,'expense','Undo keeps the kind');
 const teaDelete=(await q("select payload from app_audit_events where entity_name='Black tea' and action='delete'"))[0];
 assert.ok(teaDelete.payload.fields.some(f=>f.k==='kind'&&f.from==='expense'),'deleting an expense item says what it was');

 // The browser still reaches none of it.
 for(const role of ['anon','authenticated'])for(const sig of ['app_internal_catalog_change(text,text,jsonb,text,text)','app_internal_record_fields(text,jsonb)'])
  assert.equal((await q("select has_function_privilege($1,$2,'execute') as allowed",[role,sig]))[0].allowed,false,role+' cannot run '+sig);
 await db.close();

 // The api: what it reads, keeps and saves.
 const api=fs.readFileSync('supabase/functions/api/index.ts','utf8');
 assert.match(api,/select\("id,name,phone,reminder,buys"\)/,'bootstrap reads what each supplier sells');
 assert.match(api,/stock_item,(stock_items,)?kind"\)/,'bootstrap reads each item\'s kind');
 assert.match(api,/buys: SUPPLIER_BUYS\.includes\(b\.buys\) \? b\.buys : "food"/,'an unknown value saves as food');
 assert.match(api,/kind: b\.kind === "expense" \? "expense" : "food"/);
 assert.match(api,/buys: \["buys"\]/);assert.match(api,/kind: \["kind"\]/);
 assert.match(api,/expenses: true,/,'bootstrap tells the app the server saves them');
 console.log('Expenses PASS: existing data is food, new records default to food, only food/expenses/both and food/expense, edits keep them, Record names them only when not food, Undo keeps the kind, browser locked out, api reads and saves them');
})().catch(e=>{console.error(e);process.exitCode=1;});
