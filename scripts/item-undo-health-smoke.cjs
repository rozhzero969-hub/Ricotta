/* Kept from PR #127: deleting an item can be undone (a server copy bound to the account and device,
   for 10 minutes, cleaned up nightly), Rozha's Health Check, and Rico's all-or-nothing order
   previews. Supplier instructions and item merging stay removed. Runs every migration in PGlite. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));
 for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;

 // Removed features leave nothing behind.
 assert.equal((await q("select count(*)::int n from information_schema.columns where table_name='app_suppliers' and column_name='ordering_note'"))[0].n,0,'supplier instructions column is gone');
 assert.equal((await q("select to_regprocedure('public.app_internal_merge_items(text,text,timestamptz,timestamptz,text,text)') is null as gone"))[0].gone,true,'item merging is gone');

 await db.exec("insert into app_accounts(id,name,pin_hash,pins) values('rozha','Rozha','test','{}'),('yunis','Yunis','test','{}');insert into app_units(id,en) values('kg','kg');insert into app_suppliers(id,name) values('s','Market');");
 await db.query("select app_internal_catalog_change('suppliers','s',$1::jsonb,'rozha','device')",[JSON.stringify({name:'Market renamed',cutoff:'09:30'})]);
 assert.deepEqual((await q("select name,cutoff from app_suppliers where id='s'"))[0],{name:'Market renamed',cutoff:'09:30'},'suppliers still save');
 const audit=(await q("select payload from app_audit_events where entity_type='supplier' order by occurred_at desc limit 1"))[0].payload;
 assert.deepEqual(audit.fields.map(f=>f.k).sort(),['cutoff','name'],'the Record shows only real supplier fields');

 // Undo after deleting an item.
 await db.exec("insert into app_items(id,name,unit_id,supplier_id,aliases,note) values('a','Tomatoes','kg','s',array['tomato'],'ripe');");
 const action=async(id,actor='rozha',device='device',restore=false)=>(await q('select app_internal_item_undo($1,$2,$3,$4) as d',[id,actor,device,restore]))[0].d;
 const receipt=await action('a');
 assert.ok(receipt.undoId);assert.equal((await q("select count(*)::int n from app_items where id='a'"))[0].n,0,'the item is deleted');
 assert.equal((await action(receipt.undoId,'yunis','device',true)).error,'undo_expired','another account cannot bring it back');
 assert.equal((await action(receipt.undoId,'rozha','other-device',true)).error,'undo_expired','another device cannot bring it back');
 assert.equal((await action(receipt.undoId,'rozha','device',true)).ok,true);
 assert.deepEqual((await q("select name,aliases,note from app_items where id='a'"))[0],{name:'Tomatoes',aliases:['tomato'],note:'ripe'},'it comes back as it was');
 assert.equal((await action(receipt.undoId,'rozha','device',true)).error,'undo_expired','an Undo works once');
 const expired=await action('a');await db.exec("update app_item_undo set expires_at=now()-interval '1 minute';");
 assert.equal((await action(expired.undoId,'rozha','device',true)).error,'undo_expired','after 10 minutes it is gone');
 await db.exec('select app_internal_cleanup();');
 assert.equal((await q('select count(*)::int n from app_item_undo'))[0].n,0,'the nightly clean-up removes expired copies');

 // The browser can reach none of it; the Health Check is Rozha's.
 for(const role of ['anon','authenticated']){
  assert.equal((await q(`select has_table_privilege('${role}','app_item_undo','select') as allowed`))[0].allowed,false);
  for(const signature of ['app_internal_item_undo(text,text,text,boolean)','app_internal_diagnostics(text)'])
   assert.equal((await q("select has_function_privilege($1,$2,'execute') as allowed",[role,signature]))[0].allowed,false);
 }
 await assert.rejects(db.exec("select app_internal_diagnostics('yunis')"),/Forbidden/);
 assert.equal((await q("select app_internal_diagnostics('rozha') as d"))[0].d.database,true);
 await db.close();

 // Rico's order cards apply completely or not at all.
 const source=fs.readFileSync('assistant.js','utf8');
 const code=source.slice(source.indexOf('function ricoOrderAfter('),source.indexOf('function ricoApplyOrder('));
 const c={state:{cart:{a:2},items:[{id:'a',unit:'kg'},{id:'b',unit:'kg',available:false}]},roundQuantity:v=>Math.round(v*1000)/1000,validOrderQuantity:v=>Number.isFinite(v)&&v>=0&&v<=99999};
 vm.createContext(c);vm.runInContext(code,c);
 assert.deepEqual({...c.ricoOrderAfter({mode:'add',lines:[{itemId:'a',qty:1.5}]})},{a:3.5});
 assert.deepEqual({...c.ricoOrderAfter({mode:'set',lines:[{itemId:'a',qty:0}]})},{},'setting 0 takes an item out');
 assert.equal(c.ricoOrderAfter({mode:'add',lines:[{itemId:'a',qty:99999}]}),null,'no amount past the limit');
 assert.equal(c.ricoOrderAfter({mode:'replace',lines:[{itemId:'gone',qty:1}]}),null,'a removed item cannot clear the draft');
 assert.equal(c.ricoOrderAfter({mode:'add',lines:[{itemId:'b',qty:1}]}),null,'unavailable items are refused');
 assert.equal(c.ricoOrderAfter({mode:'add',lines:[{itemId:'a',qty:1,unitId:'box'}]}),null,'a changed unit needs a new preview');
 console.log('Item Undo and Health Check PASS: removed features gone, suppliers save, Undo bound to account/device/10 minutes, cleanup, privileges, owner-only Health Check, all-or-nothing Rico previews.');
})().catch(e=>{console.error(e);process.exitCode=1;});
