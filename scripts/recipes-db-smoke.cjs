const fs=require('node:fs'),assert=require('node:assert/strict');const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
(async()=>{const db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));const q=async s=>(await db.query(s)).rows;
assert.deepEqual((await q("select roles from app_accounts where id='ahmad'"))[0].roles,[]);
for(const table of ['app_recipes','app_recipe_ingredients','app_recipe_photos']){assert.equal((await q(`select has_table_privilege('anon','${table}','select') as allowed`))[0].allowed,false);assert.equal((await q(`select relrowsecurity from pg_class where oid='${table}'::regclass`))[0].relrowsecurity,true);}
assert.equal((await q("select app_internal_check_account_pin('ahmad','123456') as ok"))[0].ok,false);
await db.exec("insert into app_accounts(id,name,pin_hash) values('rozha','Rozh',extensions.crypt('482916',extensions.gen_salt('bf',4))); insert into app_sessions(id,token_hash,account,expires_at) values('00000000-0000-4000-8000-000000000001',repeat('a',64),'rozha',now()+interval '1 day');");
assert.equal((await q("select app_internal_set_pin('ahmad','638295','00000000-0000-4000-8000-000000000001') as result"))[0].result,'ok');
assert.equal((await q("select app_internal_check_account_pin('ahmad','638295') as ok"))[0].ok,true);
assert.equal((await q("select app_internal_match_code('638295') as who"))[0].who,'ahmad');
assert.deepEqual((await q("select app_internal_set_roles('rozha','ahmad',array['history'],'test') as roles"))[0].roles,['history']);
await assert.rejects(()=>db.exec("select app_internal_set_roles('ahmad','ahmad',array['manage'],'test');"));
await db.exec("insert into app_recipes(id,name,data,updated_by) values('00000000-0000-4000-8000-000000000002','Cake','{}','ahmad');");
assert.equal((await q("update app_recipes set version=2 where id='00000000-0000-4000-8000-000000000002' and version=1 returning id")).length,1);assert.equal((await q("update app_recipes set version=2 where id='00000000-0000-4000-8000-000000000002' and version=1 returning id")).length,0);

await db.exec("insert into app_recipe_ingredients(id,name,stock_item,unit) values('00000000-0000-4000-8000-000000000003','Eggs','Eggs','pcs'); update app_recipes set data='{\"lines\":[{\"ingredient\":\"00000000-0000-4000-8000-000000000003\",\"qty\":1,\"unit\":\"pcs\"}]}' where id='00000000-0000-4000-8000-000000000002';");
// Ingredients have a category (2026-11-16), empty unless Ahmad picks one, at most 60 letters.
assert.equal((await q("select category from app_recipe_ingredients where id='00000000-0000-4000-8000-000000000003'"))[0].category,'');
await assert.rejects(()=>db.exec("update app_recipe_ingredients set category=repeat('x',61) where id='00000000-0000-4000-8000-000000000003';"));
// The clean-up migration runs again without harm (it only deletes the recipe book's own rows).
await db.exec(fs.readFileSync('supabase/migrations/20261116220000_recipes_simple.sql','utf8'));
assert.equal((await q("select count(*)::int as n from app_recipes"))[0].n,0);assert.equal((await q("select count(*)::int as n from app_recipe_ingredients"))[0].n,0);
await db.exec("insert into app_recipes(id,name,data,updated_by) values('00000000-0000-4000-8000-000000000002','Cake','{}','ahmad'); insert into app_recipe_ingredients(id,name,stock_item,unit,category) values('00000000-0000-4000-8000-000000000003','Eggs','Eggs','pcs','Dairy');");
// An ingredient's unit is only where new lines start (recipe costs): changing it is allowed now.
assert.equal((await q("update app_recipe_ingredients set unit='g' where id='00000000-0000-4000-8000-000000000003' returning id")).length,1);
// Recipe alerts go once per change: the first take notes everything, the same value again says nothing.
const take=async items=>(await q(`select * from app_internal_recipe_alert_take('${JSON.stringify(items)}'::jsonb)`));
assert.equal((await take([{k:'margin:a',v:'ok'},{k:'stock:Eggs',v:'ok'}])).length,2);
assert.equal((await take([{k:'margin:a',v:'ok'},{k:'stock:Eggs',v:'ok'}])).length,0,'nothing changed');
assert.deepEqual((await take([{k:'margin:a',v:'loss'}])).map(r=>[r.alert_key,r.was,r.is_now]),[['margin:a','ok','loss']]);
assert.equal((await q("select has_table_privilege('anon','app_recipe_alert_state','select') as allowed"))[0].allowed,false);
assert.equal((await q("select has_function_privilege('anon','app_internal_recipe_alert_take(jsonb)','execute') as allowed"))[0].allowed,false);
// Categories from a prepared list (2026-11-17): the typed groups in use become rows (one per spelling), each
// recipe points at its row and the typed word leaves its data; running the migration again changes nothing.
await db.exec("insert into app_recipes(id,name,data,updated_by) values('00000000-0000-4000-8000-000000000010','Banana shake','{\"category\":\"Smoothies\"}','ahmad'),('00000000-0000-4000-8000-000000000011','Mango shake','{\"category\":\" smoothies \"}','ahmad'),('00000000-0000-4000-8000-000000000012','Brownie','{\"category\":\"Cakes\"}','ahmad');");
const catMig=fs.readFileSync('supabase/migrations/20261117100000_recipe_categories.sql','utf8');
await db.exec(catMig);await db.exec(catMig);
const cats=await q("select name,color from app_recipe_categories order by sort");
assert.deepEqual(cats.map(c=>c.name),['Cakes','Smoothies'],'one row per spelling, A to Z');
assert.deepEqual(cats.map(c=>c.color),['mint','butter'],'the next colour each');
assert.equal((await q("select count(distinct category_id)::int as n from app_recipes where id in ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011')"))[0].n,1,'both shakes in Smoothies');
assert.equal((await q("select count(*)::int as n from app_recipes where data ? 'category'"))[0].n,0,'the typed word is gone');
await assert.rejects(()=>db.exec("insert into app_recipe_categories(name,color) values('CAKES','sky');"),'one spelling per category');
await assert.rejects(()=>db.exec("insert into app_recipe_categories(name,color) values('Juices','neon');"),'only the ten colours');
assert.equal((await q("select has_table_privilege('anon','app_recipe_categories','select') as allowed"))[0].allowed,false);
await db.exec("delete from app_recipe_categories where name='Cakes';");
assert.equal((await q("select category_id from app_recipes where id='00000000-0000-4000-8000-000000000012'"))[0].category_id,null,'deleting a category keeps its recipes');
for(let i=0;i<8;i++)await db.exec(`insert into app_recipe_photos(id,recipe_id,path) values(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','photo-${i}');`);
await assert.rejects(()=>db.exec("insert into app_recipe_photos(id,recipe_id,path) values(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','photo-9');"));
await db.close();console.log('Recipes DB PASS: disabled initial PIN, Admin PIN setup, roles, table privacy, RLS, stale version refusal, recipe alerts once per change, ingredient categories, the clean-up migration, recipe categories with colours');})().catch(e=>{console.error(e);process.exit(1);});
