// Admin > Restore with Ahmad's recipe book (20261119120000_backup_recipes.sql): the daily copy holds the
// recipe tables and the minibar picks; restoring brings back what was deleted and changes nothing that exists.
const fs=require('node:fs'),assert=require('node:assert/strict');const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
(async()=>{const db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));const q=async s=>(await db.query(s)).rows;
const R1='00000000-0000-4000-8000-0000000000a1',R2='00000000-0000-4000-8000-0000000000a2',R3='00000000-0000-4000-8000-0000000000a3',R4='00000000-0000-4000-8000-0000000000a4';
const I1='00000000-0000-4000-8000-0000000000b1',I2='00000000-0000-4000-8000-0000000000b2';
const C1='00000000-0000-4000-8000-0000000000c1',C2='00000000-0000-4000-8000-0000000000c2';
const P1='00000000-0000-4000-8000-0000000000d1',P2='00000000-0000-4000-8000-0000000000d2';
await db.exec(`insert into app_accounts(id,name,pin_hash) values('rozha','Rozh',extensions.crypt('482916',extensions.gen_salt('bf',4))) on conflict do nothing;
 insert into app_units(id,en) values('bu','kg') on conflict do nothing;
 insert into app_suppliers(id,name) values('bs','Supplier');
 insert into app_items(id,name,unit_id,supplier_id) values('mi-1','Milk','bu','bs'),('mi-2','Cream','bu','bs'),('mi-3','Ice','bu','bs');
 update app_accounts set settings=coalesce(settings,'{}'::jsonb)||'{"minibarItems":["mi-1","mi-2"],"lang":"ku"}' where id='ahmad';
 insert into app_recipe_categories(id,name,color,sort,created_by) values('${C1}','Cakes','mint',1,'ahmad'),('${C2}','Smoothies','butter',2,'ahmad');
 insert into app_recipe_ingredients(id,name,stock_item,unit,category) values('${I1}','Eggs','Eggs','pcs','Dairy'),('${I2}','Flour','Flour','g','Dry');
 insert into app_recipes(id,name,data,updated_by,category_id,version) values
  ('${R1}','Brownie','{"lines":[{"ingredient":"${I1}","qty":2,"unit":"pcs"}],"steps":"Bake"}','ahmad','${C1}',3),
  ('${R2}','Banana shake','{"lines":[]}','ahmad','${C2}',1),
  ('${R3}','Cheesecake','{"lines":[]}','ahmad','${C1}',1);
 insert into app_recipe_photos(id,recipe_id,path,caption,sort_order) values('${P1}','${R1}','${R1}/${P1}.jpg','Top',0),('${P2}','${R1}','${R1}/${P2}.jpg','Cut',1);
 select app_internal_make_backup();`);
const day=(await q("select to_char(max(day),'YYYY-MM-DD') as d from app_backups"))[0].d;
const copy=(await q(`select data from app_backups where day='${day}'`))[0].data;
assert.equal(copy.recipes.length,3,'the copy holds the recipes');assert.equal(copy.recipe_ingredients.length,2);assert.equal(copy.recipe_categories.length,2);assert.equal(copy.recipe_photos.length,2);
assert.deepEqual(copy.minibar,['mi-1','mi-2'],'and Ahmad\'s minibar picks');
assert.equal((await q("select app_internal_list_backups() as r"))[0].r[0].recipes,3,'the list counts the recipes');
// A copy made before recipes were kept still lists (0 recipes) and restores without them.
await db.exec(`insert into app_backups(day,data) values(current_date-3,'{"suppliers":[],"units":[],"items":[],"orders":[],"lines":[]}');`);
assert.equal((await q("select app_internal_list_backups() as r"))[0].r.at(-1).recipes,0);
const old=(await q("select app_internal_restore_backup(current_date-3,'rozha','d') as r"))[0].r;
assert.equal(old.recipes,0);assert.equal(old.minibar,0);

// Since that day: Brownie deleted (its photos go with it), an ingredient and a category deleted (a new
// category with the same name made), a recipe renamed, a new recipe added, a minibar pick swapped.
await db.exec(`delete from app_recipes where id='${R1}';
 delete from app_recipe_ingredients where id='${I2}';
 delete from app_recipe_categories where id='${C2}';
 insert into app_recipe_categories(id,name,color,sort) values(gen_random_uuid(),'Smoothies','sky',5);
 update app_recipes set name='Cheesecake (new)', version=2 where id='${R3}';
 insert into app_recipes(id,name,data,updated_by) values('${R4}','Latte','{}','ahmad');
 update app_accounts set settings=settings||'{"minibarItems":["mi-1","mi-3"]}' where id='ahmad';`);
assert.equal((await q(`select count(*)::int as n from app_recipe_photos where recipe_id='${R1}'`))[0].n,0);
await assert.rejects(q(`select app_internal_restore_backup('${day}','ahmad','d')`),/Forbidden/,'only Rozha restores');
const r=(await q(`select app_internal_restore_backup('${day}','rozha','r-phone') as r`))[0].r;
assert.equal(r.recipes,1,'only the deleted recipe comes back');assert.equal(r.recipe_ingredients,1);assert.equal(r.recipe_photos,2);
assert.equal(r.recipe_categories,0,'a category whose name is taken now is not added twice');assert.equal(r.minibar,1);
const brownie=(await q(`select name,version,data,category_id from app_recipes where id='${R1}'`))[0];
assert.equal(brownie.name,'Brownie','the recipe is back');assert.equal(brownie.version,3);assert.equal(brownie.data.steps,'Bake');assert.equal(brownie.category_id,C1,'in its category');
assert.deepEqual((await q(`select caption from app_recipe_photos where recipe_id='${R1}' order by sort_order`)).map(x=>x.caption),['Top','Cut'],'with its photo rows');
assert.equal((await q(`select name from app_recipe_ingredients where id='${I2}'`))[0].name,'Flour','the deleted ingredient is back');
const cheese=(await q(`select name,version from app_recipes where id='${R3}'`))[0];
assert.deepEqual([cheese.name,cheese.version],['Cheesecake (new)',2],'a recipe that exists now is not changed');
assert.equal((await q(`select count(*)::int as n from app_recipes where id='${R4}'`))[0].n,1,'a recipe added since stays');
assert.equal((await q(`select category_id from app_recipes where id='${R2}'`))[0].category_id,null,'its category was deleted and not brought back, so it points at none');
assert.equal((await q("select count(*)::int as n from app_recipe_categories where lower(name)='smoothies'"))[0].n,1);
const ahmad=(await q("select settings from app_accounts where id='ahmad'"))[0].settings;
assert.deepEqual(ahmad.minibarItems,['mi-1','mi-3','mi-2'],'the removed pick comes back, the new one stays');assert.equal(ahmad.lang,'ku','other settings untouched');
assert.equal((await q("select payload from app_audit_events where entity_type='backup' order by occurred_at desc limit 1"))[0].payload.recipes,1,'the Record notes it');
// Restoring again brings back nothing more.
const again=(await q(`select app_internal_restore_backup('${day}','rozha','r-phone') as r`))[0].r;
assert.deepEqual([again.recipes,again.recipe_ingredients,again.recipe_photos,again.minibar],[0,0,0,0]);
// A deleted item comes back with the restore, and so does its pick; a pick for an item that does not
// exist anywhere is not added.
await db.exec(`update app_accounts set settings=settings||'{"minibarItems":[]}' where id='ahmad'; delete from app_items where id='mi-2';
 update app_backups set data=jsonb_set(data,'{minibar}','["mi-1","mi-2","gone-x"]') where day='${day}';`);
assert.equal((await q(`select app_internal_restore_backup('${day}','rozha','d') as r`))[0].r.minibar,2);
assert.deepEqual((await q("select settings->'minibarItems' as m from app_accounts where id='ahmad'"))[0].m,['mi-1','mi-2']);
// On Supabase the photo files are in storage: a photo row comes back only when its file is still there.
await db.exec(`create schema storage; create table storage.objects(bucket_id text, name text);
 insert into storage.objects values('recipe-photos','${R1}/${P2}.jpg'),('other','${R1}/${P1}.jpg');
 delete from app_recipes where id='${R1}';`);
const withFiles=(await q(`select app_internal_restore_backup('${day}','rozha','d') as r`))[0].r;
assert.deepEqual([withFiles.recipes,withFiles.recipe_photos],[1,1]);
assert.deepEqual((await q(`select caption from app_recipe_photos where recipe_id='${R1}'`)).map(x=>x.caption),['Cut'],'only the photo whose file is kept');
for(const f of ['app_internal_make_backup(timestamptz)','app_internal_list_backups()','app_internal_restore_backup(date,text,text)'])assert.equal((await q(`select has_function_privilege('anon','${f}','execute') as a`))[0].a,false,f+' is closed to the browser roles');
await db.close();console.log('Backup recipes DB PASS: the daily copy holds recipes, ingredients, categories, photos and minibar picks; restore brings back a deleted recipe with its photos and leaves what exists alone');})().catch(e=>{console.error(e);process.exit(1);});
