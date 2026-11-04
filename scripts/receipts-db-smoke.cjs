// Receipts in the database: who may read them, Rico taking one at a time, one invoice at a time, clean-up.
const fs=require('fs'),assert=require('assert/strict');
const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const migrations=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>fs.readFileSync('supabase/migrations/'+f,'utf8'));
(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon; create role authenticated; create role service_role;');
 await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));
 for(const sql of migrations) await db.exec(sql);
 const q=async(sql)=> (await db.query(sql)).rows;
 // Browsers can't reach the tables or the claim function; only the API (service role) can.
 for(const t of ['app_rr_receipts','app_rr_catalog','app_rr_helper']) assert.equal((await q(`select has_table_privilege('anon','${t}','select') as a`))[0].a,false,t);
 assert.equal((await q("select has_function_privilege('authenticated','app_internal_rr_claim()','execute') as a"))[0].a,false);
 // Yunis may be given Receipts.
 await db.exec("update app_accounts set roles=array['history','receipts'] where id='yunis'");
 const ins=(inv,status,ago='0')=>db.exec(`insert into app_rr_receipts(created_by,status,supplier,invoice,lines,sent_at,created_at) values('rozha','${status}','Jabal Amman','${inv}','[]',now()-interval '${ago} minutes',now()-interval '${ago} minutes')`);
 await ins('1','queued','10'); await ins('2','queued','5'); await ins('3','approved','1'); await ins('4','draft');
 // Approved ones first (they only need saving), then the oldest queued one; each is taken once.
 const take=async()=> (await q('select invoice,status from app_internal_rr_claim()'))[0];
 assert.deepEqual(await take(),{invoice:'3',status:'saving'});
 assert.deepEqual(await take(),{invoice:'1',status:'filling'});
 assert.deepEqual(await take(),{invoice:'2',status:'filling'});
 assert.equal(await take(),undefined);
 // The same invoice from the same supplier can't be on its way twice; a draft or a cancelled one can.
 await assert.rejects(ins('1','queued'),/duplicate key/);
 await ins('1','cancelled'); await ins('1','draft');
 // Stopped: Rico takes nothing.
 await ins('9','queued'); await db.exec('update app_rr_helper set stopped=true'); assert.equal(await take(),undefined);
 await db.exec('update app_rr_helper set stopped=false'); assert.equal((await take()).invoice,'9');
 // A receipt left half way for a day becomes a problem (never retried); 60 days old ones go.
 await db.exec("update app_rr_receipts set updated_at=now()-interval '2 days' where invoice='9'");
 await db.exec("update app_rr_receipts set created_at=now()-interval '61 days' where invoice='2'");
 await db.exec('select app_internal_rr_cleanup()');
 assert.equal((await q("select status from app_rr_receipts where invoice='9'"))[0].status,'problem');
 assert.equal((await q("select count(*)::int n from app_rr_receipts where invoice='2'"))[0].n,0);
 // A receipt moving along wakes the open apps.
 assert.ok((await q("select n from app_signals where kind='receipts'")).length);
 console.log('Receipts DB PASS: private tables, Yunis role, claim order and once only, one invoice at a time, stop switch, stuck and 60-day clean-up, live signal');
})().catch(e=>{console.error(e);process.exit(1);});
