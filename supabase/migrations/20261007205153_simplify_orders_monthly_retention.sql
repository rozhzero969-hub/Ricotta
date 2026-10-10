-- The Edge APIs use the service role. These helpers are deliberately unavailable
-- to browser roles, and each call completes its related writes in one transaction.
create or replace function public.app_internal_save_order(p_id text, p_date timestamptz, p_account text, p_lines jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare saved_id text;
begin
  if p_id is null or length(p_id) not between 1 and 160 or
     p_date is null or p_account is null or p_account not in ('rozha','yunis') or
     p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Invalid order';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 800 then raise exception 'Invalid order lines'; end if;
  -- ON CONFLICT waits for an in-flight save with this id to commit or roll back.
  insert into public.app_orders(id,status,created_at,sent_at,created_by,sent_by)
    values(p_id,'sent',p_date,p_date,p_account,p_account)
    on conflict(id) do nothing returning id into saved_id;
  if saved_id is null then return false; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as l(item_name text, qty numeric)
      where l.item_name is null or length(l.item_name) not between 1 and 160 or
        l.qty is null or l.qty <= 0 or l.qty > 99999) then
    raise exception 'Invalid order line';
  end if;
  insert into public.app_order_lines(order_id,supplier_id,supplier_name,item_id,item_name,unit_id,qty)
    select p_id,l.supplier_id,l.supplier_name,l.item_id,l.item_name,l.unit_id,l.qty
    from jsonb_to_recordset(p_lines) as l(supplier_id text,supplier_name text,item_id text,item_name text,unit_id text,qty numeric);
  return true;
end $$;


-- Catalog changes and their Records commit or roll back together.
create or replace function public.app_internal_record_fields(p_table text,p_row jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare u text; s text; r text := 'off';
begin
 if p_row is null then return '{}'::jsonb; end if;
 if p_table='items' then
  select en into u from public.app_units where id=p_row->>'unit_id';
  select name into s from public.app_suppliers where id=p_row->>'supplier_id';
  return jsonb_build_object('name',p_row->>'name','unit',coalesce(u,''),'supplier',coalesce(s,''));
 elsif p_table='suppliers' then
  if p_row->'reminder'->>'on'='true' then
   select coalesce(p_row->'reminder'->>'time','')||'|'||coalesce(string_agg(d::text,',' order by ord),'') into r
    from unnest(array[6,0,1,2,3,4,5]) with ordinality v(d,ord)
    where (p_row->'reminder'->'days') @> to_jsonb(array[d]);
  end if;
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r);
 elsif p_table='units' then
  return jsonb_build_object('name',p_row->>'en','nameKu',coalesce(p_row->>'ku',''),'nameAr',coalesce(p_row->>'ar',''));
 end if;
 raise exception 'Invalid catalog';
end $$;
create or replace function public.app_internal_catalog_change(p_table text,p_id text,p_row jsonb,p_actor text,p_device text)
returns void language plpgsql set search_path='' as $$
declare oldrow jsonb; newrow jsonb; prev jsonb; nextrow jsonb; fields jsonb; act text; typ text;
begin
 if p_table not in ('items','suppliers','units') or p_actor not in ('rozha','yunis') or p_id is null then raise exception 'Invalid catalog change'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_table||':'||p_id,0));
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update','app_'||p_table) into oldrow using p_id;
 prev:=public.app_internal_record_fields(p_table,oldrow);
 if p_row is null then
  execute format('delete from public.%I where id=$1','app_'||p_table) using p_id;
 elsif p_table='suppliers' then
  insert into public.app_suppliers(id,name,phone,reminder) values(p_id,p_row->>'name',p_row->>'phone',p_row->'reminder')
   on conflict(id) do update set name=excluded.name,phone=excluded.phone,reminder=excluded.reminder,updated_at=now() returning to_jsonb(app_suppliers.*) into newrow;
 elsif p_table='items' then
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order) values(p_id,p_row->>'name',p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer)
   on conflict(id) do update set name=excluded.name,unit_id=excluded.unit_id,supplier_id=excluded.supplier_id,
    sort_order=case when p_row ? 'sort_order' then excluded.sort_order else public.app_items.sort_order end,updated_at=now() returning to_jsonb(app_items.*) into newrow;
 else
  insert into public.app_units(id,en,ku,ar) values(p_id,p_row->>'en',p_row->>'ku',p_row->>'ar')
   on conflict(id) do update set en=excluded.en,ku=excluded.ku,ar=excluded.ar returning to_jsonb(app_units.*) into newrow;
 end if;
 if oldrow is null and newrow is null then return; end if;
 nextrow:=public.app_internal_record_fields(p_table,newrow);
 act:=case when oldrow is null then 'add' when newrow is null then 'delete' else 'edit' end;
 typ:=case p_table when 'suppliers' then 'supplier' when 'items' then 'item' else 'unit' end;
 select coalesce(jsonb_agg(case act when 'add' then jsonb_build_object('k',k,'to',v) when 'delete' then jsonb_build_object('k',k,'from',v)
  else jsonb_build_object('k',k,'from',prev->>k,'to',v) end),'[]'::jsonb) into fields
 from jsonb_each_text(case when act='delete' then prev else nextrow end) f(k,v)
 where (act='edit' and coalesce(prev->>k,'')<>v) or
 (act='add' and (k='name' or p_table='items' or (v<>'' and v<>'off'))) or
 (act='delete' and k<>'reminder' and (k='name' or p_table='items' or v<>''));
 if fields='[]'::jsonb then return; end if;
 insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
 values(gen_random_uuid()::text,p_actor,p_device,act,typ,coalesce(nextrow->>'name',prev->>'name'),
 jsonb_build_object('by',initcap(p_actor),'fields',fields,'source','server'));
end $$;

create or replace function public.app_internal_logout(p_session uuid,p_device text)
returns void language plpgsql set search_path='' as $$
begin
 update public.app_sessions set revoked_at=now() where id=p_session;
 if p_device is not null then
  update public.app_devices set logged_in=false,updated_at=now() where id=p_device;
  delete from public.app_push_subscriptions where device_id=p_device;
 end if;
end $$;
create or replace function public.app_internal_device_command(p_ids text[],p_type text)
returns void language plpgsql set search_path='' as $$
begin
 if p_type not in ('logout','refresh') then raise exception 'Invalid command'; end if;
 update public.app_devices set command=jsonb_build_object('id',gen_random_uuid()::text,'type',p_type,'ts',now()),
  logged_in=case when p_type='logout' then false else logged_in end,updated_at=now() where id=any(p_ids);
 if p_type='logout' then
  update public.app_sessions set revoked_at=now() where device_id=any(p_ids) and revoked_at is null;
  delete from public.app_push_subscriptions where device_id=any(p_ids);
 end if;
end $$;
create or replace function public.app_internal_delete_order(p_id text,p_actor text,p_device text)
returns void language plpgsql set search_path='' as $$
declare removed text;
begin
 if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
 delete from public.app_orders where id=p_id returning id into removed;
 if removed is not null then
  insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
  values(gen_random_uuid()::text,p_actor,p_device,'delete','order',p_id,jsonb_build_object('source','server'));
 end if;
end $$;
create or replace function public.app_internal_save_chat(p_id uuid,p_account text,p_title text,p_messages jsonb)
returns boolean language plpgsql set search_path='' as $$
declare saved uuid;
begin
 insert into public.app_rico_chats(id,account,title,messages) values(p_id,p_account,p_title,p_messages)
 on conflict(id) do update set title=excluded.title,messages=excluded.messages,updated_at=now()
 where public.app_rico_chats.account=p_account returning id into saved;
 return saved is not null;
end $$;

-- Baghdad midnight: September ends at 21:00 UTC on September 30.
create or replace function public.app_internal_monthly_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path='' as $$
declare cutoff timestamptz:=date_trunc('month',p_now at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad';
begin
 delete from public.app_orders where coalesce(sent_at,created_at)<cutoff;
 delete from public.app_audit_events where occurred_at<cutoff;
end $$;
create or replace function public.app_internal_cleanup()
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_recovery_tickets where expires_at<now();
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
end $$;

-- Remove retired feature functions, including legacy transfer/receipt signatures.
do $$ declare f record; t record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'stock\_%' escape '\' or p.proname like 'transfer\_%' escape '\' or p.proname like 'receipt\_%' escape '\' or p.proname='app_internal_decay_stock')
 loop execute 'drop function if exists '||f.signature||' cascade'; end loop;
 for t in select tablename from pg_tables where schemaname='public' and (tablename like 'stock\_%' escape '\' or tablename like 'transfer\_%' escape '\' or tablename like 'receipt\_%' escape '\' or tablename='app_item_pars')
 loop execute format('drop table if exists public.%I cascade',t.tablename); end loop;
end $$;
delete from public.app_audit_events where entity_type in ('stock','stock_group','receipt','transfer','item_par','stock_item','stock_count') or action like 'stock%' or action like 'receipt%' or action like 'transfer%';
update public.app_accounts set tabs=array['order','assistant','history'],updated_at=now() where tabs && array['stock','receipts','receipt','transfers'];
-- One-time reset. Tokens and saved devices are removed; accounts/PINs stay.
delete from public.app_sessions;
delete from public.app_devices;
delete from public.app_push_subscriptions;
delete from public.app_recovery_tickets;
select public.app_internal_monthly_cleanup();

-- Restrict every newly added helper to the trusted server role.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'app_internal_%'
 loop execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role'; end loop;
end $$;
-- Daily midnight run also catches up after a pause. Existing daily cleanup is a second catch-up.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('ricotta-monthly-history','0 21 * * *','select public.app_internal_monthly_cleanup()');
 end if;
end $$;
