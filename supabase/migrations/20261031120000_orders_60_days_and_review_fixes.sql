-- 2026-10-31: orders are kept 60 days, and fixes from the read-only review.
-- Orders: a finished month still gets its summary, and the orders stay 60 days, in History and for Rico.
--   The Record of changes is still cleared monthly.
-- New-device alerts: signing in with the other account on a phone no longer counts as a new device after
--   the first time (app_device_accounts remembers each phone and account pair).
-- Item and supplier edits: an edit of a few fields never brings back something deleted on another phone.

create or replace function public.app_internal_monthly_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare cutoff timestamptz := date_trunc('month', p_now at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad'; m record;
begin
 for m in select date_trunc('month', coalesce(sent_at, created_at) at time zone 'Asia/Baghdad') as ms
   from public.app_orders where status = 'sent' and coalesce(sent_at, created_at) < cutoff group by 1
 loop
  if not exists (select 1 from public.app_month_summaries where month = to_char(m.ms, 'YYYY-MM')) then
   insert into public.app_month_summaries(month, data)
   values (to_char(m.ms, 'YYYY-MM'), public.app_internal_month_summary(m.ms at time zone 'Asia/Baghdad', (m.ms + interval '1 month') at time zone 'Asia/Baghdad'))
   on conflict (month) do nothing;
  end if;
 end loop;
 delete from public.app_orders where coalesce(sent_at, created_at) < p_now - interval '60 days';
 delete from public.app_audit_events where occurred_at < cutoff;
end $$;
revoke all on function public.app_internal_monthly_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_monthly_cleanup(timestamptz) to service_role;

create table if not exists public.app_device_accounts (
  device_id text not null check (char_length(device_id) between 1 and 200),
  account text not null check (account in ('rozha','yunis')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (device_id, account)
);
alter table public.app_device_accounts enable row level security;
revoke all on public.app_device_accounts from public, anon, authenticated;
grant all on public.app_device_accounts to service_role;
insert into public.app_device_accounts(device_id, account)
  select distinct device_id, account from public.app_security_events
  where device_id is not null and account in ('rozha','yunis') and kind in ('signin','new_device')
  on conflict do nothing;
insert into public.app_device_accounts(device_id, account)
  select id, account from public.app_devices where account in ('rozha','yunis')
  on conflict do nothing;

create or replace function public.app_internal_start_session(p_code text, p_token_hash text, p_device text, p_label text, p_version text, p_attempt_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare matched text; account_name text; expiry timestamptz; completed integer; known boolean := true;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or (p_device is not null and length(p_device) not between 1 and 120)
    or length(p_label) > 80 or length(p_version) > 40
    or coalesce(cardinality(p_attempt_ids),0) <> 2 or p_attempt_ids[1] is null or p_attempt_ids[2] is null
    or p_attempt_ids[1] = p_attempt_ids[2] then raise exception 'Invalid session request'; end if;
  perform id from public.app_accounts order by id for update;
  matched := public.app_internal_match_code(p_code);
  if matched is null then return jsonb_build_object('error','invalid_credentials'); end if;
  update public.app_login_attempts set succeeded = true where id = any(p_attempt_ids) and not succeeded;
  get diagnostics completed = row_count;
  if completed <> 2 then raise exception 'Invalid login reservation'; end if;
  -- Client-provided device ids remain identifiers, not credentials. Serialized account locks
  -- prevent two different accounts from both claiming an unused id at the same time.
  if p_device is not null and exists(select 1 from public.app_sessions
    where device_id = p_device and account <> matched and revoked_at is null and expires_at > now()) then
    return jsonb_build_object('error','device_in_use');
  end if;
  expiry := now() + interval '18 hours';
  insert into public.app_sessions(token_hash,account,device_id,expires_at)
    values(p_token_hash,matched,p_device,expiry);
  if p_device is not null then
    -- A phone counts as known once this account has signed in on it, even if the other account used it since.
    known := exists(select 1 from public.app_device_accounts where device_id = p_device and account = matched)
      or exists(select 1 from public.app_devices where id = p_device and account is not distinct from matched);
    insert into public.app_device_accounts(device_id, account) values (p_device, matched)
      on conflict (device_id, account) do update set last_at = now();
    insert into public.app_devices as d(id,account,label,app_version,logged_in,last_login,last_seen,updated_at,first_login)
      values(p_device,matched,p_label,p_version,true,now(),now(),now(),now())
      on conflict(id) do update set account=excluded.account,label=excluded.label,
        app_version=coalesce(excluded.app_version,d.app_version),logged_in=true,
        last_login=excluded.last_login,last_seen=excluded.last_seen,updated_at=excluded.updated_at,
        first_login=case when d.account is distinct from excluded.account then now() else coalesce(d.first_login, now()) end,
        handled_command=coalesce(d.command->>'id',d.handled_command);
  end if;
  insert into public.app_security_events(kind, account, device_id, device_label)
    values ('signin', matched, p_device, left(p_label, 80));
  if not known then
    insert into public.app_security_events(kind, account, device_id, device_label)
      values ('new_device', matched, p_device, left(p_label, 80));
  end if;
  select name into account_name from public.app_accounts where id = matched;
  return jsonb_build_object('account',matched,'name',account_name,'expiresAt',expiry,'newDevice',not known);
end $$;
revoke all on function public.app_internal_start_session(text,text,text,text,text,bigint[]) from public,anon,authenticated;
grant execute on function public.app_internal_start_session(text,text,text,text,text,bigint[]) to service_role;

create or replace function public.app_internal_catalog_change(p_table text, p_id text, p_row jsonb, p_actor text, p_device text)
returns void language plpgsql set search_path = '' as $$
declare oldrow jsonb; newrow jsonb; prev jsonb; nextrow jsonb; fields jsonb; act text; typ text;
begin
 if p_table not in ('items','suppliers','units') or p_actor not in ('rozha','yunis') or p_id is null then raise exception 'Invalid catalog change'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_table||':'||p_id,0));
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update','app_'||p_table) into oldrow using p_id;
 -- An edit of a few fields ("partial") never creates a record: it was deleted on another phone.
 if oldrow is null and p_row is not null and p_row ? 'partial' then raise exception 'catalog_gone'; end if;
 prev:=public.app_internal_record_fields(p_table,oldrow);
 if p_row is null then
  execute format('delete from public.%I where id=$1','app_'||p_table) using p_id;
 elsif p_table='suppliers' then
  insert into public.app_suppliers(id,name,phone,reminder,cutoff) values(p_id,p_row->>'name',p_row->>'phone',p_row->'reminder',nullif(p_row->>'cutoff',''))
   on conflict(id) do update set name=case when p_row ? 'name' then excluded.name else public.app_suppliers.name end,
    phone=case when p_row ? 'phone' then excluded.phone else public.app_suppliers.phone end,
    reminder=case when p_row ? 'reminder' then excluded.reminder else public.app_suppliers.reminder end,
    cutoff=case when p_row ? 'cutoff' then excluded.cutoff else public.app_suppliers.cutoff end,updated_at=now()
   returning to_jsonb(app_suppliers.*) into newrow;
 elsif p_table='items' then
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order,note,aliases,available) values(p_id,p_row->>'name',p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer,nullif(p_row->>'note',''),array(select jsonb_array_elements_text(coalesce(p_row->'aliases','[]'::jsonb))),coalesce((p_row->>'available')::boolean,true))
   on conflict(id) do update set name=case when p_row ? 'name' then excluded.name else public.app_items.name end,
    unit_id=case when p_row ? 'unit_id' then excluded.unit_id else public.app_items.unit_id end,
    supplier_id=case when p_row ? 'supplier_id' then excluded.supplier_id else public.app_items.supplier_id end,
    sort_order=case when p_row ? 'sort_order' then excluded.sort_order else public.app_items.sort_order end,
    aliases=case when p_row ? 'aliases' then excluded.aliases else public.app_items.aliases end,available=case when p_row ? 'available' then excluded.available else public.app_items.available end,
    note=case when p_row ? 'note' then excluded.note else public.app_items.note end,updated_at=now() returning to_jsonb(app_items.*) into newrow;
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
 (act='add' and (k='name' or (p_table='items' and (k<>'note' or v<>'')) or (v<>'' and v<>'off'))) or
 (act='delete' and k<>'reminder' and (k='name' or (p_table='items' and (k<>'note' or v<>'')) or v<>''));
 if fields='[]'::jsonb then return; end if;
 insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
 values(gen_random_uuid()::text,p_actor,p_device,act,typ,coalesce(nextrow->>'name',prev->>'name'),
 jsonb_build_object('by',initcap(p_actor),'fields',fields,'source','server'));
end $$;
revoke all on function public.app_internal_catalog_change(text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_catalog_change(text,text,jsonb,text,text) to service_role;

create or replace function public.app_internal_delete_order(p_id text, p_actor text, p_device text)
returns void language plpgsql set search_path = '' as $$
declare removed text; sent timestamptz; by_whom text; made timestamptz; ids text[]; prev jsonb;
begin
 if p_actor not in ('rozha','yunis') then raise exception 'Forbidden'; end if;
 select coalesce(sent_at,created_at), created_by, created_at into sent, by_whom, made from public.app_orders where id=p_id for update;
 if not found then return; end if;
 if p_actor <> 'rozha' and (by_whom is distinct from p_actor or made < now() - interval '15 minutes') then raise exception 'Forbidden'; end if;
 select array_agg(distinct item_id) into ids from public.app_order_lines where order_id = p_id and item_id is not null;
 select jsonb_object_agg(item_id, at) into prev from (select item_id, min(prev_last_ordered_at) at from public.app_order_lines
   where order_id = p_id and item_id is not null group by item_id) x;
 delete from public.app_orders where id=p_id returning id into removed;
 if removed is not null then
  insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
  values(gen_random_uuid()::text,p_actor,p_device,'delete','order',p_id,jsonb_build_object('source','server'));
  perform public.app_internal_streak_unhit((sent at time zone 'Asia/Baghdad')::date);
  -- Deleting an order from a finished month corrects its summary, while all of that month's orders are still here.
  update public.app_month_summaries set data = public.app_internal_month_summary(
      date_trunc('month', sent at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad',
      (date_trunc('month', sent at time zone 'Asia/Baghdad') + interval '1 month') at time zone 'Asia/Baghdad')
    where month = to_char(sent at time zone 'Asia/Baghdad', 'YYYY-MM')
      and date_trunc('month', sent at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad' >= now() - interval '60 days';
  -- Back to the latest order that still has the item, or to the date it had before this order (kept on
  -- the order's lines), so an earlier month's order still counts after its raw history is cleared.
  update public.app_items i set last_ordered_at = nullif(greatest(
      coalesce((select max(coalesce(o.sent_at, o.created_at)) from public.app_order_lines l
        join public.app_orders o on o.id = l.order_id where l.item_id = i.id), '-infinity'::timestamptz),
      coalesce((prev->>i.id)::timestamptz, '-infinity'::timestamptz)), '-infinity'::timestamptz)
    where i.id = any(coalesce(ids, '{}')) and i.last_ordered_at >= sent;
 end if;
end $$;
revoke all on function public.app_internal_delete_order(text,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_delete_order(text,text,text) to service_role;
