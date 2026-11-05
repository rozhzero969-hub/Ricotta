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
 assert.equal((await q("select has_function_privilege('authenticated','app_internal_rr_claim(text)','execute') as a"))[0].a,false);
 // Yunis may be given Receipts.
 await db.exec("update app_accounts set roles=array['history','receipts'] where id='yunis'");
 const ins=(inv,status,ago='0')=>db.exec(`insert into app_rr_receipts(created_by,status,supplier,invoice,lines,sent_at,created_at,approved_by,approved_at) values('rozha','${status}','Jabal Amman','${inv}','[]',now()-interval '${ago} minutes',now()-interval '${ago} minutes',${status === 'approved' ? "'rozha',now()" : 'null,null'})`);
 await ins('1','queued','10'); await ins('2','queued','5'); await ins('3','approved','1'); await ins('4','draft');
 // A person always approves: never Rico himself, never without a name; the switch can't be turned on.
 await assert.rejects(db.exec("insert into app_rr_receipts(created_by,status,supplier,invoice,lines) values('rozha','approved','Jabal Amman','70','[]')"),/person_approves/);
 await assert.rejects(db.exec("insert into app_rr_receipts(created_by,status,supplier,invoice,lines,approved_by,approved_at) values('rozha','saved','Jabal Amman','71','[]','auto',now())"),/person_approves/);
 await assert.rejects(db.exec("update app_rr_helper set auto_approve=true"),/never_auto/);
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
 await db.exec('update app_rr_helper set stopped=false');
 // Rico takes it in the mode he runs in; every step is in his activity record.
 assert.deepEqual((await q("select invoice,mode from app_internal_rr_claim('practice')"))[0],{invoice:'9',mode:'practice'});
 assert.deepEqual((await q("select kind,status,mode from app_rr_events where invoice='9' order by id")).map(e=>e.status+':'+(e.mode||'')),['queued:','filling:practice']);
 assert.equal((await q("select count(*)::int n from app_rr_events where status='draft'"))[0].n,0);
 await db.exec("update app_rr_helper set command='real',command_by='rozha'"); await db.exec("update app_rr_helper set launch_result='Rico is on',launch_at=now()");
 assert.deepEqual((await q("select kind,status,actor,text from app_rr_events where kind<>'status' order by id")),[{kind:'command',status:'real',actor:'rozha',text:null},{kind:'launch',status:null,actor:null,text:'Rico is on'}]);
 assert.equal((await q("select has_table_privilege('authenticated','app_rr_events','select') as a"))[0].a,false);
 // A receipt left half way for a day becomes a problem (never retried); 60 days old ones go.
 await db.exec("update app_rr_receipts set updated_at=now()-interval '2 days' where invoice='9'");
 await db.exec("update app_rr_receipts set created_at=now()-interval '61 days' where invoice='2'");
 await db.exec('select app_internal_rr_cleanup()');
 assert.equal((await q("select status from app_rr_receipts where invoice='9'"))[0].status,'problem');
 assert.equal((await q("select count(*)::int n from app_rr_receipts where invoice='2'"))[0].n,0);
 // A receipt moving along wakes the open apps.
 assert.ok((await q("select n from app_signals where kind='receipts'")).length);
 // Transfers: a person approves before anything moves; never Breakfast, never the same storage; Rico
 // takes approved ones first, each once; every step is in his activity record as a transfer; Yunis may be
 // given Transfers.
 await db.exec("update app_accounts set roles=array['history','transfers'] where id='yunis'");
 const tins=(st,ago='0',extra='')=>db.query(`insert into app_rr_transfers(created_by,status,from_zone,to_zone,lines,sent_at${extra?',approved_by,approved_at':''}) values('rozha','${st}','Main Storage','Minibar','[{"item":"Lemon","unit":"کیلۆ","qty":2}]',now()-interval '${ago} minutes'${extra?",'rozha',now()":''}) returning id`);
 await assert.rejects(db.exec("insert into app_rr_transfers(created_by,status,from_zone,to_zone) values('rozha','approved','Main Storage','Minibar')"),/person_approves/);
 await assert.rejects(db.exec("insert into app_rr_transfers(created_by,status,from_zone,to_zone) values('rozha','draft','Main Storage','Main Storage')"),/two_zones/);
 await assert.rejects(db.exec("insert into app_rr_transfers(created_by,status,from_zone,to_zone) values('rozha','draft','Main Storage','نانی بەیانی (Breakfast)')"),/no_breakfast/);
 await tins('queued','10'); await tins('approved','1','yes');
 const ttake=async()=> (await q("select status,mode from app_internal_rr_claim_transfer('real')"))[0];
 assert.deepEqual(await ttake(),{status:'moving',mode:null});
 assert.deepEqual(await ttake(),{status:'filling',mode:'real'});
 assert.equal(await ttake(),undefined);
 assert.ok((await q("select count(*)::int n from app_rr_events where what='transfer' and status='filling'"))[0].n>=1);
 assert.equal((await q("select has_table_privilege('authenticated','app_rr_transfers','select') as a"))[0].a,false);
 console.log('Receipts DB PASS: a person always approves, private tables, practice/real mode, activity record, Yunis role, claim order and once only, one invoice at a time, stop switch, stuck and 60-day clean-up, live signal');
})().catch(e=>{console.error(e);process.exit(1);});
