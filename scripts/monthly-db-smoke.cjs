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
 // Request quotas persist across sessions and cannot be called through browser database roles.
 assert.equal((await q("select has_table_privilege('anon','app_request_limits','select') as allowed"))[0].allowed,false);
 assert.equal((await q("select has_function_privilege('authenticated','app_internal_reserve_requests(text[],integer[],integer)','execute') as allowed"))[0].allowed,false);
 for(let i=0;i<3;i++)assert.equal((await q("select app_internal_reserve_requests(array['account:yunis:write'],array[3],60) as allowed"))[0].allowed,true);
 assert.equal((await q("select app_internal_reserve_requests(array['account:yunis:write'],array[3],60) as allowed"))[0].allowed,false);
 await db.exec("update app_request_limits set reset_at=now()-interval '1 second';");
 assert.equal((await q("select app_internal_reserve_requests(array['account:yunis:write'],array[3],60) as allowed"))[0].allowed,true);
 assert.equal((await q("select app_internal_reserve_requests(array['account:rozha:write'],array[3],60) as allowed"))[0].allowed,true,'accounts have independent quotas');
 await db.exec("delete from app_request_limits;");
 assert.equal((await q("select to_regclass('stock_receipts') as t"))[0].t,null);
 assert.equal((await q("select count(*)::int as n from pg_namespace where nspname='app_private'"))[0].n,0,'the empty leftover schema is gone');
 assert.deepEqual((await q('select key from app_secrets order by key')).map(r=>r.key),['gemini_api_key'],'unused secrets are removed, the rest stay');
 assert.equal((await q("select has_sequence_privilege('anon','app_rico_inbox_id_seq','USAGE') as allowed"))[0].allowed,false,'sequences are closed to the browser roles');
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
 const archived=await q("select month, data from app_month_summaries");
 assert.deepEqual(archived.map(r=>[r.month,r.data.orders,r.data.lines,r.data.topItems[0].name]),[['2026-09',1,1,'Old']],'a month is summarised into the archive before it is cleared');
 await db.exec("select app_internal_monthly_cleanup('2026-10-08T12:00:00Z');");
 assert.equal((await q('select count(*)::int as n from app_month_summaries'))[0].n,1,'the archive keeps one summary per month');
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
 // Transfers: the workplace item list is replaced in one go. Names are unique whatever their capitals,
 // units keep their first order without repeats, and items that stay keep their id and remembered spellings.
 await db.exec(`select app_internal_replace_stock_items('[{"name":"Tomatoes - تەماتە","units":["کیلۆ","سندوق","کیلۆ"]},{"name":"Onions - پیاز"},{"name":" tomatoes - تەماتە ","units":["کیلۆ"]}]');`);
 const stock=await q("select id,name,units,position from app_stock_items order by position");
 assert.deepEqual(stock.map(r=>[r.name,r.units,r.position]),[['Tomatoes - تەماتە',['کیلۆ','سندوق'],0],['Onions - پیاز',[],1]],'one row per name, units without repeats');
 const tom=stock[0].id,aliases=async()=>(await q(`select aliases from app_stock_items where id='${tom}'`))[0].aliases;
 assert.equal((await q(`select app_internal_stock_alias('${tom}','tomatos') as ok`))[0].ok,true);
 await db.exec(`select app_internal_stock_alias('${tom}','TOMATOS'); select app_internal_stock_alias('${tom}','tomatoes - تەماتە');`);
 assert.deepEqual(await aliases(),['TOMATOS'],'a spelling is kept once (the newest way it was written), never the item name itself');
 assert.equal((await q("select app_internal_stock_alias('missing','x') as ok"))[0].ok,false);
 await assert.rejects(db.exec(`select app_internal_stock_alias('${tom}','  ');`),/Invalid alias/);
 for(let n=0;n<35;n++) await db.exec(`select app_internal_stock_alias('${tom}','spelling ${n}');`);
 assert.equal((await aliases()).length,30,'the newest 30 spellings are kept');
 assert.equal((await aliases()).at(-1),'spelling 34');
 assert.equal((await q(`select app_internal_replace_stock_items('[{"name":"TOMATOES - تەماتە","units":["کیلۆ"]},{"name":"Cucumber - خەیار","units":["کیلۆ"]}]') as n`))[0].n,2);
 const renamed=await q("select id,name,units,cardinality(aliases) as kept from app_stock_items order by position");
 assert.deepEqual(renamed.map(r=>[r.id===tom,r.name,r.units,r.kept]),[[true,'TOMATOES - تەماتە',['کیلۆ'],30],[false,'Cucumber - خەیار',['کیلۆ'],0]],'a new list keeps ids and spellings, removes items no longer in it');
 for(const bad of ['{}','[{"name":""}]','[{"name":"x","units":"kg"}]',JSON.stringify([{name:'x',units:Array.from({length:21},(_,i)=>'u'+i)}])])
  await assert.rejects(db.exec(`select app_internal_replace_stock_items('${bad}');`),/Invalid stock/,'rejects '+bad);
 assert.equal((await q("select count(*)::int as n from app_stock_items"))[0].n,2,'a rejected list changes nothing');
 assert.deepEqual((await q("select has_table_privilege('anon','app_stock_items','SELECT') as a, has_function_privilege('authenticated','app_internal_replace_stock_items(jsonb)','EXECUTE') as b, has_function_privilege('anon','app_internal_stock_alias(text,text)','EXECUTE') as c"))[0],{a:false,b:false,c:false},'the browser roles cannot reach the list');
 // The per-item stock fields from the earlier Excel attempt are gone; items still save and record as before.
 assert.equal((await q("select count(*)::int as n from information_schema.columns where table_name='app_items' and column_name like 'stock%'"))[0].n,0);
 await db.exec(`select app_internal_catalog_change('units','kg','{"en":"kg","ku":"کیلۆ"}','rozha','device');
  select app_internal_catalog_change('items','basil','{"name":"Basil","unit_id":"kg","note":"fresh"}','rozha','device');`);
 assert.deepEqual((await q("select payload from app_audit_events where entity_name='Basil'"))[0].payload.fields.map(f=>f.k).sort(),['aliases','available','name','note','supplier','unit'],'an item records the same fields as before');
 await db.exec("delete from app_items where id='basil'; delete from app_units where id='kg';");
 // ROZH-23: a unit has one name. The Kurdish name becomes that name; a unit without one is removed,
 // but only when no item or order line uses it. Running the change twice changes nothing more.
 await db.exec(`insert into app_units(id,en,ku,ar) values('u-kg','kg','کیلۆ','كيلو'),('u-m','metre',null,'متر'),('u-box','box','',null),('u-pcs','pcs',' pcs ',null);
  insert into app_items(id,name,unit_id) values('u-rice','Rice','u-box');`);
 for(let i=0;i<2;i++) await db.exec(fs.readFileSync('supabase/migrations/20261026170000_one_name_units.sql','utf8'));
 assert.deepEqual(await q("select id,en,ku,ar from app_units where id like 'u-%' order by id"),
  [{id:'u-box',en:'box',ku:null,ar:null},{id:'u-kg',en:'کیلۆ',ku:null,ar:null},{id:'u-pcs',en:'pcs',ku:null,ar:null}],'units keep one name');
 await db.exec("delete from app_items where id='u-rice'; delete from app_units where id like 'u-%';");
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
 // Admin -> PINs: a new PIN for one account, never the other account's PIN; that account is signed out
 // everywhere except the session making the change. A six-digit code is a PIN or nothing (no secret code).
 await db.exec(`update app_accounts set pin_hash=extensions.crypt('482916',extensions.gen_salt('bf',4)) where id='rozha';
  update app_accounts set pin_hash=extensions.crypt('730154',extensions.gen_salt('bf',4)) where id='yunis';
  delete from app_sessions; delete from app_devices;
  insert into app_devices(id,account,logged_in) values('r-phone','rozha',true),('r-laptop','rozha',true),('y-phone','yunis',true);
  insert into app_sessions(id,token_hash,device_id,expires_at,account) values
   ('00000000-0000-4000-8000-0000000000a1','a','r-phone',now()+interval '1 day','rozha'),
   ('00000000-0000-4000-8000-0000000000a2','b','r-laptop',now()+interval '1 day','rozha'),
   ('00000000-0000-4000-8000-0000000000a3','c','y-phone',now()+interval '1 day','yunis');`);
 const setPin=async(account,pin)=>(await q(`select app_internal_set_pin('${account}','${pin}','00000000-0000-4000-8000-0000000000a1') as r`))[0].r;
 const deniedPin=async(session)=>(await q(`select app_internal_set_pin('rozha','591837','${session}') as r`))[0].r;
 assert.equal(await deniedPin('00000000-0000-4000-8000-000000000099'),'forbidden','a missing session cannot change a PIN');
 assert.equal(await deniedPin('00000000-0000-4000-8000-0000000000a3'),'forbidden','a staff session cannot change PINs through the internal function');
 assert.equal(await setPin('rozha','730154'),'duplicate','the two PINs stay different');
 assert.equal(await setPin('rozha','12a456'),'invalid');
 assert.equal(await setPin('staff','591837'),'invalid');
 assert.equal((await q('select count(*)::int as n from app_sessions where revoked_at is not null'))[0].n,0,'a refused PIN changes nothing');
 await db.exec("create trigger fail_pin_record before insert on app_audit_events for each row execute function fail_record();");
 await assert.rejects(setPin('yunis','591837'),/forced audit failure/,'a failed security record rolls the PIN change back');
 assert.equal((await q("select app_internal_match_code('730154') as a"))[0].a,'yunis','a rolled-back change keeps the old PIN');
 await db.exec('drop trigger fail_pin_record on app_audit_events;');
 assert.equal(await setPin('yunis','591837'),'ok');
 assert.equal((await q("select count(*)::int as n from app_audit_events where action='change_pin'"))[0].n,1,'a successful PIN change records once');
 assert.equal((await q("select app_internal_match_code('591837') as a"))[0].a,'yunis');
 assert.equal((await q("select app_internal_match_code('730154') as a"))[0].a,null,'the old PIN no longer signs in');
 assert.deepEqual((await q('select account, revoked_at is not null as out from app_sessions order by token_hash')).map(r=>[r.account,r.out]),[['rozha',false],['rozha',false],['yunis',true]],'only Yunis is signed out');
 assert.equal(await setPin('rozha','264809'),'ok');
 assert.deepEqual((await q("select token_hash, revoked_at is not null as out from app_sessions where account='rozha' order by token_hash")).map(r=>[r.token_hash,r.out]),[['a',false],['b',true]],'her own new PIN keeps this session and signs out her other devices');
 assert.deepEqual((await q('select id, logged_in from app_devices order by id')).map(r=>[r.id,r.logged_in]),[['r-laptop',false],['r-phone',true],['y-phone',false]]);
 assert.equal((await q("select has_function_privilege('authenticated','app_internal_set_pin(text,text,uuid)','EXECUTE') as allowed"))[0].allowed,false);
 // Sign-in is one transaction, serialized with PIN changes; invalidated PINs cannot create sessions.
 let loginNumber=0;
 const login=async(pin,device,hash)=>{
  const label='login-test-'+(++loginNumber);
  const attempts=await q(`insert into app_login_attempts(fingerprint_hash) values('${label}-ip'),('${label}-global') returning id`);
  const ids=attempts.map(r=>r.id);
  return (await q(`select app_internal_start_session('${pin}','${hash}','${device}','iPhone|App','test',array[${ids.join(',')}]::bigint[]) as r`))[0].r;
 };
 assert.equal((await login('482916','fresh-device','0'.repeat(64))).error,'invalid_credentials','the old PIN cannot issue a session after the PIN change');
 const signedIn=await login('264809','fresh-device','1'.repeat(64));
 assert.equal(signedIn.account,'rozha');
 assert.equal((await q("select account from app_devices where id='fresh-device'"))[0].account,'rozha');
 assert.equal((await login('591837','fresh-device','2'.repeat(64))).error,'device_in_use','another account cannot claim the active device');
 assert.equal((await q("select count(*)::int as n from app_sessions where token_hash=repeat('2',64)"))[0].n,0,'a rejected device claim issues no session');
 await db.exec("create function fail_device() returns trigger language plpgsql as $$ begin raise exception 'forced device failure'; end $$; create trigger fail_device before insert on app_devices for each row execute function fail_device();");
 await assert.rejects(login('264809','broken-device','3'.repeat(64)),/forced device failure/);
 assert.equal((await q("select count(*)::int as n from app_sessions where token_hash=repeat('3',64)"))[0].n,0,'device failure rolls session issuance back');
 assert.equal((await q("select count(*)::int as n from app_login_attempts where fingerprint_hash like 'login-test-4-%' and succeeded"))[0].n,0,'failed transaction does not complete its reservations');
 await db.exec('drop trigger fail_device on app_devices;');
 assert.equal((await q("select has_function_privilege('anon','app_internal_start_session(text,text,text,text,text,bigint[])','execute') as a"))[0].a,false);
 assert.equal((await q("select has_function_privilege('authenticated','app_internal_start_session(text,text,text,text,text,bigint[])','execute') as a"))[0].a,false);
 // ROZH-22: sign-in writes the security log and says when a phone was never seen before.
 assert.equal(signedIn.newDevice,true,'a phone that never signed in is new');
 assert.equal((await login('264809','fresh-device','5'.repeat(64))).newDevice,false,'the same phone again is known');
 assert.deepEqual((await q("select kind from app_security_events where device_id='fresh-device' order by id")).map(r=>r.kind),['signin','new_device','signin']);
 assert.equal((await q("select count(*)::int as n from app_security_events where device_id='broken-device'"))[0].n,0,'a rolled-back sign-in leaves no log entry');
 assert.equal((await q("select count(*)::int as n from app_security_events where kind='pin_changed'"))[0].n,2,'both PIN changes are in the log, the rolled-back one is not');
 const event=(kind,device,dedupe)=>db.exec(`select app_internal_security_event('${kind}',null,'${device}','Mac|Browser','{}',${dedupe});`);
 await event('locked','x-phone',600);await event('locked','x-phone',600);await event('locked','z-phone',600);
 assert.equal((await q("select count(*)::int as n from app_security_events where kind='locked'"))[0].n,2,'a lock is written once per phone, not once per refused try');
 await event('wrong_pin','x-phone',0);await event('wrong_pin','x-phone',0);
 await assert.rejects(event('made_up','x-phone',0),/kind_check/);
 await assert.rejects(q("select app_internal_security_summary('yunis','global-test',900,10)"),/Forbidden/);
 await db.exec("insert into app_login_attempts(fingerprint_hash,attempted_at) select 'global-test', now()-make_interval(secs=>n) from generate_series(1,10) n;");
 const security=async()=>(await q("select app_internal_security_summary('rozha','global-test',900,10) as r"))[0].r;
 let summary=await security();
 assert.deepEqual([summary.failuresInWindow,summary.wrongPins24h,summary.signins24h,summary.newDevices7d],[10,2,2,1]);
 assert.ok(new Date(summary.lockedUntil)>new Date(),'ten wrong tries lock sign-in, with the time it opens again');
 await assert.rejects(q("select app_internal_unlock_signin('yunis',900,'y-phone')"),/Forbidden/);
 assert.ok((await q("select app_internal_unlock_signin('rozha',900,'r-phone') as n"))[0].n>=10);
 summary=await security();
 assert.deepEqual([summary.failuresInWindow,summary.lockedUntil,summary.events[0].kind],[0,null,'unlocked'],'Unlock sign-in opens it and is logged');
 // Yunis's access: only Rozha changes it, only known roles, each once, and every change is logged.
 await assert.rejects(db.exec("update app_accounts set roles=array['history','root'] where id='yunis'"),/roles_known/);
 await assert.rejects(q("select app_internal_set_roles('yunis','yunis',array['transfers'],'y-phone')"),/Forbidden/,'only Rozha changes access');
 await assert.rejects(q("select app_internal_set_roles('rozha','rozha',array['history'],'r-phone')"),/Forbidden/,'Rozha always keeps everything');
 assert.deepEqual((await q("select app_internal_set_roles('rozha','yunis',array['send','history','send','transfers'],'r-phone') as r"))[0].r,['history','send','transfers']);
 await assert.rejects(q("select app_internal_set_roles('rozha','yunis',array['history','admin'],'r-phone')"),/roles_known/,'an unknown role is refused');
 assert.deepEqual((await q("select roles from app_accounts where id='yunis'"))[0].roles,['history','send','transfers'],'a refused change keeps the saved roles');
 assert.deepEqual((await q("select app_internal_set_roles('rozha','yunis',array[]::text[],'r-phone') as r"))[0].r,[],'every role can be taken away');
 const changes=await q("select detail from app_security_events where kind='roles_changed' order by id");
 assert.deepEqual(changes.map(r=>[r.detail.before,r.detail.roles]),[[null,['history','send','transfers']],[['history','send','transfers'],[]]]);
 await db.exec("update app_accounts set roles=null where id='yunis';");
 // Problem reports: one open row per problem, phone and person; repeats add up; sizes and shapes are checked.
 const report=async(list,account='yunis',device='y-phone')=>(await q(`select app_internal_report_problems('${JSON.stringify(list)}','${account}','${device}','iPhone|App','2026-10-26.1') as n`))[0].n;
 const fp='ab'.repeat(8),problem={fingerprint:fp,kind:'error',message:'x is not defined'};
 assert.equal(await report([{...problem,count:2}]),1);
 assert.equal(await report([{...problem,screen:'order'}]),1);
 assert.deepEqual((await q(`select count, screen, app_version from app_problem_reports where fingerprint='${fp}'`)),[{count:3,screen:'order',app_version:'2026-10-26.1'}],'a repeat only adds to the count');
 await report([problem],'rozha','r-phone');
 assert.equal((await q(`select count(*)::int as n from app_problem_reports where fingerprint='${fp}'`))[0].n,2,'another person or phone is its own row');
 await assert.rejects(report([{...problem,fingerprint:'not-hex'}]),/fingerprint_check/);
 await assert.rejects(report([{...problem,message:''}]),/message_check/);
 await assert.rejects(report([{...problem,kind:'virus'}]),/kind_check/);
 await assert.rejects(report([{...problem,stack:'s'.repeat(2001)}]),/stack_check/);
 await assert.rejects(report(Array.from({length:11},()=>problem)),/Invalid report/,'at most 10 in one call');
 await assert.rejects(report([problem],'staff'),/Invalid report/);
 await db.exec(`update app_problem_reports set resolved_at=now() where fingerprint='${fp}' and account='yunis';`);
 await report([problem]);
 assert.equal((await q(`select count(*)::int as n from app_problem_reports where fingerprint='${fp}' and account='yunis' and resolved_at is null`))[0].n,1,'a fixed problem that comes back opens again');
 await db.exec("insert into app_problem_reports(fingerprint,kind,message,account) select md5(n::text),'error','m','rozha' from generate_series(1,2000) n;");
 assert.equal(await report([{...problem,fingerprint:'cd'.repeat(8)}]),0,'no more than 2000 open problems are kept');
 assert.equal(await report([problem]),1,'but a problem already open still counts');
 await db.exec("delete from app_problem_reports where message='m';");
 // Time in the app: never more than the time that really passed, kept forever.
 const use=async(seconds,device='y-phone',account='yunis')=>(await q(`select app_internal_add_usage('${account}','${device}','iPhone|App',${seconds}) as n`))[0].n;
 assert.equal(await use(600),600,'the first report counts in full');
 assert.ok(await use(900)<=16,'a phone cannot claim more time than has passed');
 assert.equal(await use(-50),0);
 assert.equal(await use(5000,'y-laptop'),1800,'one report is never more than 30 minutes');
 await assert.rejects(use(10,''),/Invalid usage/);
 await assert.rejects(use(10,'x-phone','staff'),/Invalid usage/);
 await db.exec("update app_usage_time set updated_at=now()-interval '10 minutes';");
 assert.equal(await use(300),300,'after ten minutes, five minutes count');
 await assert.rejects(q("select app_internal_usage_summary('yunis')"),/Forbidden/);
 const usage=(await q("select app_internal_usage_summary('rozha') as r"))[0].r,stored=(await q("select sum(seconds)::int as s from app_usage_time"))[0].s;
 assert.deepEqual([usage.people.length,usage.people[0].account,usage.people[0].total,usage.people[0].today,usage.devices.length],[1,'yunis',stored,stored,2],'per person and per phone');
 // By day, week and month: a day nobody used the app is a zero, and nothing before the first counted day shows.
 await db.exec(`insert into app_usage_time(account,device_id,day,seconds) values
   ('rozha','r-mac',(now() at time zone 'Asia/Baghdad')::date - 40,600),('rozha','r-mac',(now() at time zone 'Asia/Baghdad')::date - 3,1200),('yunis','y-old',(now() at time zone 'Asia/Baghdad')::date - 9,300);`);
 const periods=(await q("select app_internal_usage_summary('rozha') as r"))[0].r,sum=(rows,k)=>rows.reduce((n,r)=>n+Number(r[k]),0);
 assert.equal(periods.days.length,31,'the last 31 days, every one of them');
 assert.deepEqual([periods.days.at(-1).day,periods.days.at(-4).rozha,periods.days.at(-2).rozha],[periods.today,1200,0],'days without use are zeros');
 assert.equal(periods.weeks.length,6,'weeks start with the one holding the first counted day (40 days ago)');
 assert.equal(periods.weeks.at(-1).start,new Date(Date.parse(periods.today+'T00:00:00Z')-6*86400000).toISOString().slice(0,10),'the newest week ends today');
 assert.deepEqual([sum(periods.weeks,'rozha'),sum(periods.weeks,'yunis')],[1800,stored+300],'every counted second is in a week');
 assert.ok(periods.months.length>=2 && periods.months.length<=6 && periods.months.at(-1).month===periods.today.slice(0,7),'months up to this one');
 assert.deepEqual([sum(periods.months,'rozha'),sum(periods.months,'yunis')],[1800,stored+300],'and in a month');
 const ro=periods.people.find(p=>p.account==='rozha');
 assert.deepEqual([ro.today,ro.week,ro.last30,ro.total],[0,1200,1200,1800],'per person: today, 7 days, 30 days, all time');
 await db.exec("delete from app_usage_time where device_id in ('r-mac','y-old');");
 // When each item was last ordered: later orders move it forward, undo takes it back, exports count this month.
 await db.exec("insert into app_suppliers(id,name) values('sup-1','Market'); insert into app_items(id,name,supplier_id) values('it-a','Apples','sup-1'),('it-b','Beans','sup-1');");
 const lineA={item_id:'it-a',item_name:'Apples',qty:1,supplier_id:'sup-1',supplier_name:'Market'},lineB={item_id:'it-b',item_name:'Beans',qty:2,supplier_id:'sup-1',supplier_name:'Market'};
 const send=(id,at,lines)=>db.exec(`select app_internal_save_order('${id}','${at}','rozha','${JSON.stringify(lines)}');`);
 const lastOrdered=async()=>Object.fromEntries((await q("select id, last_ordered_at from app_items where id like 'it-%' order by id")).map(r=>[r.id,r.last_ordered_at&&new Date(r.last_ordered_at).toISOString()]));
 await send('lo-1','2026-10-20T08:00:00Z',[lineA,lineB]);await send('lo-2','2026-10-25T08:00:00Z',[lineA]);await send('lo-0','2026-10-10T08:00:00Z',[lineA]);
 assert.deepEqual(await lastOrdered(),{'it-a':'2026-10-25T08:00:00.000Z','it-b':'2026-10-20T08:00:00.000Z'},'an older order saved later does not move the date back');
 await db.exec("select app_internal_delete_order('lo-2','rozha','r-phone');");
 assert.deepEqual(await lastOrdered(),{'it-a':'2026-10-20T08:00:00.000Z','it-b':'2026-10-20T08:00:00.000Z'},'undoing the newest order goes back to the one before');
 const catalog=(await q("select app_internal_catalog_report('2026-10-01T00:00:00Z') as r"))[0].r;
 assert.deepEqual([catalog.items['it-a'].orders,Number(catalog.items['it-a'].qty),catalog.items['it-b'].orders,catalog.suppliers['sup-1'].orders,catalog.suppliers['sup-1'].lines],[2,2,1,2,3]);
 // F13: undoing an order after older orders were cleared goes back to the date the item had before it.
 await db.exec("delete from app_orders where id in ('lo-0','lo-1');");   // the monthly clean-up removed them
 await send('lo-3','2026-10-26T08:00:00Z',[lineB]);
 await db.exec("select app_internal_delete_order('lo-3','rozha','r-phone');");
 assert.equal((await lastOrdered())['it-b'],'2026-10-20T08:00:00.000Z','the earlier date survives even though its order is gone');
 // F13: deleting an item and restoring it with Undo keeps its "last ordered" date.
 const del=(await q("select app_internal_item_undo('it-b','rozha','r-phone',false) as r"))[0].r;
 await q(`select app_internal_item_undo('${del.undoId}','rozha','r-phone',true)`);
 assert.equal((await lastOrdered())['it-b'],'2026-10-20T08:00:00.000Z','Undo brings back the date too');
 // F06: an edit that sends only some fields leaves the others as they are (another phone's newer note stays).
 await db.exec("update app_items set note='newer note from the other phone' where id='it-b';");
 await db.exec(`select app_internal_catalog_change('items','it-b','{"id":"it-b","name":"Green beans"}'::jsonb,'rozha','r-phone');`);
 assert.deepEqual((await q("select name,note,supplier_id from app_items where id='it-b'"))[0],{name:'Green beans',note:'newer note from the other phone',supplier_id:'sup-1'});
 await db.exec("update app_suppliers set phone='0750 111 2222' where id='sup-1';");
 await db.exec(`select app_internal_catalog_change('suppliers','sup-1','{"id":"sup-1","name":"Main market"}'::jsonb,'rozha','r-phone');`);
 assert.deepEqual((await q("select name,phone from app_suppliers where id='sup-1'"))[0],{name:'Main market',phone:'0750 111 2222'});
 // Rico's usage by kind, for Rozha only.
 for(const model of ['pending:chat','pending:transcribe','pending:transfer']) await db.exec(`select app_internal_reserve_assistant('y-phone','yunis','${model}',50,100);`);
 await assert.rejects(db.exec("insert into app_assistant_usage(device_id,account,model,kind) values('y-phone','yunis','m','image');"),/kind_check/);
 await assert.rejects(q("select app_internal_rico_usage('yunis',now()-interval '1 day')"),/Forbidden/);
 const rico=(await q("select app_internal_rico_usage('rozha',now()-interval '1 day') as r"))[0].r;
 assert.deepEqual([rico.kinds,rico.people,rico.thisHour],[{chat:1,voice:1,transfer:1},{yunis:3},3]);
 // How each of Rico's AIs answered last: one row per AI, server only.
 await db.exec("insert into app_ai_status(provider,state) values('anthropic','no_funds') on conflict (provider) do update set state=excluded.state;");
 await db.exec("insert into app_ai_status(provider,state) values('anthropic','working') on conflict (provider) do update set state=excluded.state;");
 assert.deepEqual(await q("select provider,state from app_ai_status"),[{provider:'anthropic',state:'working'}]);
 await assert.rejects(db.exec("insert into app_ai_status(provider,state) values('openai','working');"),/provider_check/);
 await assert.rejects(db.exec("insert into app_ai_status(provider,state) values('groq','sleepy');"),/state_check/);
 assert.equal((await q("select has_table_privilege('anon','app_ai_status','select') as a, has_table_privilege('authenticated','app_ai_status','select') as b"))[0].a,false,'the browser cannot read AI states');
 // Rico's own orders (TEST): kept apart from the kitchen's orders, server only.
 await db.exec(`insert into app_rico_orders(account,supplier_id,supplier_name,lines,reason,status,message_id) values('rozha','sup-1','Bakery','[{"name":"Bread","qty":24,"unit":"piece"}]','usual amounts','sent','wamid.1');`);
 assert.deepEqual((await q("select status,test from app_rico_orders"))[0],{status:'sent',test:true},'Rico orders are test orders by default');
 await assert.rejects(db.exec("insert into app_rico_orders(account,supplier_name,lines,status) values('rozha','Bakery','[]','sent');"),/lines_check/,'an order needs lines');
 await assert.rejects(db.exec(`insert into app_rico_orders(account,supplier_name,lines,status) values('rozha','Bakery','[{"qty":1}]','queued');`),/status_check/);
 assert.equal((await q("select has_table_privilege('authenticated','app_rico_orders','select') as a"))[0].a,false,'the browser cannot read them');
 // Health Check reads the database itself.
 await assert.rejects(q("select app_internal_diagnostics('yunis')"),/Forbidden/);
 const health=(await q("select app_internal_diagnostics('rozha') as r"))[0].r;
 assert.deepEqual([health.items,health.suppliers,health.openProblems,health.wrongPins24h,health.database],[2,1,2,2,true]);
 assert.ok('databaseBytes' in health&&'lastOrderAt' in health&&'signedIn' in health);
 // The nightly clean-up shortens the logs but never the time in the app.
 await db.exec("update app_security_events set occurred_at=now()-interval '91 days' where kind='locked'; update app_problem_reports set resolved_at=now()-interval '31 days' where resolved_at is not null; update app_usage_time set day=day-400, updated_at=now()-interval '400 days';");
 await db.exec('select app_internal_cleanup();');
 assert.equal((await q("select count(*)::int as n from app_security_events where kind='locked'"))[0].n,0);
 assert.ok((await q("select count(*)::int as n from app_security_events"))[0].n>0,'newer log entries stay');
 assert.deepEqual((await q("select count(*)::int as n, count(*) filter (where resolved_at is null)::int as open from app_problem_reports"))[0],{n:2,open:2},'fixed problems go after 30 days');
 assert.equal((await q("select sum(seconds)::int as s from app_usage_time"))[0].s,stored,'time in the app is never deleted');
 // None of it is reachable from the browser roles.
 for(const role of ['anon','authenticated']){
  for(const t of ['app_security_events','app_problem_reports','app_usage_time']) assert.equal((await q(`select has_table_privilege('${role}','${t}','select') or has_table_privilege('${role}','${t}','insert') as a`))[0].a,false,role+' '+t);
  for(const s of ['app_security_events_id_seq','app_problem_reports_id_seq']) assert.equal((await q(`select has_sequence_privilege('${role}','${s}','usage') as a`))[0].a,false,role+' '+s);
  for(const f of ['app_internal_security_event(text,text,text,text,jsonb,integer)','app_internal_set_roles(text,text,text[],text)','app_internal_security_summary(text,text,integer,integer)','app_internal_unlock_signin(text,integer,text)','app_internal_report_problems(jsonb,text,text,text,text)','app_internal_add_usage(text,text,text,integer)','app_internal_usage_summary(text)','app_internal_catalog_report(timestamptz)','app_internal_rico_usage(text,timestamptz)','app_internal_diagnostics(text)'])
   assert.equal((await q(`select has_function_privilege('${role}','${f}','execute') as a`))[0].a,false,role+' '+f);
 }
 // Live changes: each kind of change moves its own counter, "still here" moves none, and a counter that
 // cannot move never stops the change. The browser roles cannot read them.
 const sig=async()=>Object.fromEntries((await q('select kind,n from app_signals')).map(r=>[r.kind,Number(r.n)]));
 let was=await sig();
 assert.deepEqual(Object.keys(was).sort(),['admin','data','devices','draft','inbox']);
 await db.exec("insert into app_suppliers(id,name) values('sig-s','Signals');");
 let now=await sig();assert.ok(now.data>was.data && now.devices===was.devices && now.admin===was.admin,'a new supplier is a data change, and only that');
 await db.exec("insert into app_devices(id,account,logged_in,last_seen) values('sig-d','rozha',true,now());");was=await sig();
 await db.exec("update app_devices set last_seen=now()+interval '1 minute', logged_in=true, updated_at=now() where id='sig-d';");
 assert.deepEqual(await sig(),was,'a "still here" from a device changes nothing');
 await db.exec("update app_devices set logged_in=false where id='sig-d';");
 now=await sig();assert.ok(now.devices>was.devices && now.data===was.data,'signing out is a device change');
 await db.exec("update app_accounts set updated_at=now() where id='rozha';");assert.equal((await sig()).data,now.data,'touching an account alone is no change');
 await db.exec("insert into app_security_events(kind,account) values('signin','rozha');");assert.ok((await sig()).admin>now.admin,'the security log is an Admin change');
 await db.exec("alter sequence app_signal_seq rename to app_signal_seq_away;");
 await db.exec("delete from app_suppliers where id='sig-s';");
 await db.exec("alter sequence app_signal_seq_away rename to app_signal_seq;");
 assert.equal((await q("select count(*)::int as n from app_suppliers where id='sig-s'"))[0].n,0,'the change is saved even when its counter cannot move');
 await db.exec("delete from app_devices where id='sig-d'; delete from app_security_events where kind='signin' and device_id is null;");
 for(const role of ['anon','authenticated']){
  assert.equal((await q(`select has_table_privilege('${role}','app_signals','select') as a`))[0].a,false,role+' app_signals');
  assert.equal((await q(`select has_sequence_privilege('${role}','app_signal_seq','usage') as a`))[0].a,false,role+' app_signal_seq');
 }
 // Kitchen notes, repeat orders, the order note, the secret code and the message format left nothing behind.
 for(const t of ['app_notes','app_repeat_orders','app_recovery_tickets']) assert.equal((await q(`select to_regclass('${t}') as t`))[0].t,null,t+' is gone');
 assert.equal((await q("select count(*)::int as n from information_schema.columns where (table_name,column_name) in (('app_accounts','message_format'),('app_orders','note'),('app_order_drafts','note'))"))[0].n,0);
 assert.equal((await q("select count(*)::int as n from pg_proc where proname in ('app_internal_set_credentials','app_internal_check_recovery_name','app_internal_set_recovery_name','app_internal_patch_draft_note','app_internal_save_order_note')"))[0].n,0);
 await db.exec('select app_internal_cleanup();');
 // Exercise schema-only restore to another empty database, without business data.
 const restored=new PGlite({extensions:{pgcrypto}});await restored.exec('create role anon;create role authenticated;create role service_role;');await restored.exec(fs.readFileSync('supabase/baseline.sql','utf8'));for(const sql of migrations) await restored.exec(sql);await restored.close();
 await db.close();console.log('Database smoke: PASS (every migration, PIN change, month boundary, retained October data, cascades, audit rollback, logout, chat ownership, idempotent orders, streak, undo window, permissions, leftovers removed, workplace item list, security log, roles, problem reports, time in the app by day, week and month, live change signals, one-name units, last ordered (and Undo keeps it), edits that change only the fields sent, Rico usage, Health Check, schema restore)');
})().catch(e=>{console.error(e);process.exitCode=1});
