/* Check now shows the new lists at once: when Rico writes Ricotta Restaurant's lists and something in
   them changed, the open apps hear it ('data' for the items and their stock lines, 'receipts' for
   Receipts, Transfers and Stock). A read that found nothing new (only stockAt moved) wakes nobody.
   Runs every migration in PGlite. Run: node scripts/catalog-signal-smoke.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));
 for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const sig=async()=>Object.fromEntries((await db.query("select kind,n from app_signals where kind in ('data','receipts')")).rows.map(r=>[r.kind,Number(r.n)]));
 const cat=(stockAt, qty)=>JSON.stringify({suppliers:['A'], zones:['Main Storage'], items:[{name:'Carrot', base:'g', units:[]}], titems:[{name:'Carrot', base:'g', stock:{'Main Storage':qty}}], stockAt});
 await db.query("delete from app_rr_catalog");
 const s0=await sig();
 await db.query("insert into app_rr_catalog(id,data) values(true,$1::jsonb)",[cat('2026-11-14T10:00:00Z',1000)]);
 const s1=await sig();
 assert.ok(s1.data>(s0.data||0)&&s1.receipts>(s0.receipts||0),'new lists wake the apps');
 await db.query("update app_rr_catalog set data=$1::jsonb, updated_at=now()",[cat('2026-11-14T10:10:00Z',1000)]);
 const s2=await sig();
 assert.deepEqual(s2,s1,'a read that only moved the read time wakes nobody');
 await db.query("update app_rr_catalog set data=$1::jsonb, updated_at=now()",[cat('2026-11-14T10:20:00Z',4000)]);
 const s3=await sig();
 assert.ok(s3.data>s2.data&&s3.receipts>s2.receipts,'changed stock wakes the apps');
 console.log('Catalog signals PASS: new or changed lists wake every open app at once; an unchanged read wakes nobody');
})().catch(e=>{console.error(e);process.exit(1);});
