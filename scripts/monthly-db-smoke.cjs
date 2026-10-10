const fs=require('fs'),assert=require('assert/strict');
const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
// Every migration, in filename order, on top of the baseline (as on a new project).
const migrations=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>fs.readFileSync('supabase/migrations/'+f,'utf8'));
(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon; create role authenticated; create role service_role;');
 // Like Supabase: new sequences in public are granted to the browser roles unless a migration says otherwise.
 await db.exec('alter default privileges in schema public grant all on sequences to anon, authenticated;');
 await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));
 // Leftovers from earlier versions that the migrations remove.
 await db.exec("create table stock_receipts(id text); create table stock_groups(id text); insert into stock_receipts values('old'); create schema app_private; insert into app_secrets values('vapid_private','old'),('cron_secret','old'),('gemini_api_key','kept');");
 for(const sql of migrations) await db.exec(sql);
 const q=async(sql)=> (await db.query(sql)).rows;
 assert.equal((await q("select to_regclass('stock_receipts') as t"))[0].t,null);
 assert.equal((await q("select count(*)::int as n from pg_namespace where nspname='app_private'"))[0].n,0,'the empty leftover schema is gone');
 assert.deepEqual((await q('select key from app_secrets order by key')).map(r=>r.key),['gemini_api_key'],'unused secrets are removed, the rest stay');
 assert.equal((await q("select has_sequence_privilege('anon','app_notes_id_seq','USAGE') as allowed"))[0].allowed,false,'sequences are closed to the browser roles');
 await db.exec('create table public.later_table(id bigint generated always as identity primary key);');
 assert.equal((await q("select has_sequence_privilege('authenticated','later_table_id_seq','USAGE') as allowed"))[0].allowed,false,'and so are sequences made later');
 await db.exec('drop table public.later_table;');
 await assert.rejects(db.exec("insert into app_orders(id,status,sent_at) values('draft','draft',now())"),/orders_status_check/,'only sent orders exist');
 await assert.rejects(db.exec("insert into app_orders(id,status,sent_at,sent_by) values('staff','sent',now(),'staff')"),/app_orders_sent_by_check/,'only the two accounts send orders');
 await db.exec(`insert into app_orders(id,status,sent_at) values('september','sent','2026-09-30T20:59:59Z'),('october-start','sent','2026-09-30T21:00:00Z'),('october-7','sent','2026-10-07T10:00:00Z');
 insert into app_order_lines(order_id,item_name,qty) values('september','Old',1),('october-7','Kept',1);
 insert into app_audit_events(id,occurred_at,action) values('old','2026-09-30T20:59:59Z','add'),('kept','2026-09-30T21:00:00Z','add');
 select app_internal_monthly_cleanup('2026-10-07T12:00:00Z');`);
 assert.deepEqual((await q('select id from app_orders order by id')).map(r=>r.id),['october-7','october-start']);
 assert.equal((await q('select count(*)::int as n from app_order_lines'))[0].n,1);
 assert.deepEqual((await q('select id from app_audit_events')).map(r=>r.id),['kept']);
 await db.exec("select app_internal_monthly_cleanup('2026-10-31T20:59:59Z');");
 assert.equal((await q('select count(*)::int as n from app_orders'))[0].n,2);
 await db.exec("select app_internal_monthly_cleanup('2026-10-31T21:00:00Z');");
 assert.equal((await q('select count(*)::int as n from app_orders'))[0].n,0);
 assert.equal((await q('select count(*)::int as n from app_audit_events'))[0].n,0);
 await db.exec(`select app_internal_catalog_change('units','box','{"en":"box"}', 'rozha','device');`);
 assert.equal((await q("select count(*)::int as n from app_audit_events where entity_type='unit'"))[0].n,1);
 await db.exec("create function fail_record() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$; create trigger fail_record before insert on app_audit_events for each row execute function fail_record();");
 await assert.rejects(db.exec(`select app_internal_catalog_change('units','box','{"en":"changed"}', 'rozha','device');`),/forced audit failure/);
 assert.equal((await q("select en from app_units where id='box'"))[0].en,'box');
 await db.exec("insert into app_accounts(id,name,pin_hash) values('rozha','Rozha','test-only'),('yunis','Yunis','test-only');");
 await db.exec("drop trigger fail_record on app_audit_events; insert into app_devices(id,logged_in) values('device',true); insert into app_sessions(token_hash,device_id,expires_at,account) values('hash','device',now()+interval '1 day','rozha');");
 await db.exec("select app_internal_device_command(array['device'],'logout');");
 assert.equal((await q('select revoked_at is not null as revoked from app_sessions'))[0].revoked,true);
 assert.equal((await q('select logged_in from app_devices'))[0].logged_in,false);
 const id='00000000-0000-4000-8000-000000000001';
 assert.equal((await q(`select app_internal_save_chat('${id}','rozha','Private','[]') as ok`))[0].ok,true);
 assert.equal((await q(`select app_internal_save_chat('${id}','yunis','Overwrite','[]') as ok`))[0].ok,false);
 assert.equal((await q(`select title from app_rico_chats where id='${id}'`))[0].title,'Private');
 const line=JSON.stringify([{item_name:'Tomato',qty:2,unit_id:'box'}]);
 assert.equal((await q(`select app_internal_save_order('once',now(),'rozha','${line}') as ok`))[0].ok,true);
 assert.equal((await q(`select app_internal_save_order('once',now(),'rozha','${line}') as ok`))[0].ok,false);
 assert.equal((await q("select count(*)::int as n from app_order_lines where order_id='once'"))[0].n,1);
 assert.equal((await q("select has_function_privilege('anon','app_internal_device_command(text[],text)','EXECUTE') as allowed"))[0].allowed,false);
 // The kitchen streak: a day is counted once, the day's only order can be taken back, a broken streak comes back.
 const streak=async(sql)=>(await q(`select ${sql} as r`))[0].r;
 await db.exec('delete from app_streak;');
 assert.equal((await streak("app_internal_streak_hit('2026-10-08')")).count,1);
 assert.equal((await streak("app_internal_streak_hit('2026-10-09')")).count,2);
 assert.equal((await streak("app_internal_streak_hit('2026-10-09')")).changed,false,'a second order the same day adds nothing');
 await db.exec("select app_internal_streak_unhit('2026-10-09');");
 assert.deepEqual((await q("select count, to_char(last_day,'YYYY-MM-DD') as day from app_streak"))[0],{count:1,day:'2026-10-08'},'undoing the only order of a day takes the day back');
 assert.equal((await streak("app_internal_streak_hit('2026-10-11')")).count,1,'a missed day starts again');
 assert.deepEqual(await streak("app_internal_streak_recover('2026-10-11')"),{ok:true,best:2,count:2},'Rico brings the lost days back');
 // Undo: whoever sent an order can take it back for 15 minutes; Rozha can delete any order.
 await db.exec("insert into app_orders(id,status,created_at,sent_at,created_by,sent_by) values('fresh','sent',now(),now(),'yunis','yunis'),('older','sent',now()-interval '20 minutes',now()-interval '20 minutes','yunis','yunis');");
 await db.exec("select app_internal_delete_order('fresh','yunis','device');");
 await assert.rejects(db.exec("select app_internal_delete_order('older','yunis','device');"),/Forbidden/,'not after 15 minutes');
 await db.exec("select app_internal_delete_order('older','rozha','device');");
 assert.equal((await q("select count(*)::int as n from app_orders where id in ('fresh','older')"))[0].n,0);
 // Exercise schema-only restore to another empty database, without business data.
 const restored=new PGlite({extensions:{pgcrypto}});await restored.exec('create role anon;create role authenticated;create role service_role;');await restored.exec(fs.readFileSync('supabase/baseline.sql','utf8'));for(const sql of migrations) await restored.exec(sql);await restored.close();
 await db.close();console.log('Database smoke: PASS (every migration, month boundary, retained October data, cascades, audit rollback, logout, chat ownership, idempotent orders, streak, undo window, permissions, leftovers removed, schema restore)');
})().catch(e=>{console.error(e);process.exitCode=1});
