-- Supplier instructions are shared catalog data; older clients preserve them.
alter table public.app_suppliers add column ordering_note text not null default '' check(length(ordering_note)<=300);
create or replace function public.app_internal_record_fields(p_table text, p_row jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare u text; s text; r text := 'off';
begin
 if p_row is null then return '{}'::jsonb; end if;
 if p_table='items' then
  select en into u from public.app_units where id=p_row->>'unit_id';
  select name into s from public.app_suppliers where id=p_row->>'supplier_id';
  return jsonb_build_object('name',p_row->>'name','unit',coalesce(u,''),'supplier',coalesce(s,''),'note',coalesce(p_row->>'note',''),'aliases',coalesce(p_row->'aliases','[]'::jsonb)::text,'available',coalesce(p_row->>'available','true'));
 elsif p_table='suppliers' then
  if p_row->'reminder'->>'enabled'='true' then
   select coalesce(p_row->'reminder'->>'time','')||'|'||coalesce(string_agg(d::text,',' order by ord),'') into r
    from unnest(array[6,0,1,2,3,4,5]) with ordinality v(d,ord)
    where (p_row->'reminder'->'days') @> to_jsonb(array[d]);
  end if;
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r,'cutoff',coalesce(p_row->>'cutoff',''),'orderingNote',coalesce(p_row->>'ordering_note',''));
 elsif p_table='units' then
  return jsonb_build_object('name',p_row->>'en','nameKu',coalesce(p_row->>'ku',''),'nameAr',coalesce(p_row->>'ar',''));
 end if;
 raise exception 'Invalid catalog';
end $$;

create or replace function public.app_internal_catalog_change(p_table text, p_id text, p_row jsonb, p_actor text, p_device text)
returns void language plpgsql set search_path = '' as $$
declare oldrow jsonb; newrow jsonb; prev jsonb; nextrow jsonb; fields jsonb; act text; typ text;
begin
 if p_table not in ('items','suppliers','units') or p_actor not in ('rozha','yunis') or p_id is null then raise exception 'Invalid catalog change'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_table||':'||p_id,0));
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update','app_'||p_table) into oldrow using p_id;
 prev:=public.app_internal_record_fields(p_table,oldrow);
 if p_row is null then
  execute format('delete from public.%I where id=$1','app_'||p_table) using p_id;
 elsif p_table='suppliers' then
  insert into public.app_suppliers(id,name,phone,reminder,cutoff,ordering_note) values(p_id,p_row->>'name',p_row->>'phone',p_row->'reminder',nullif(p_row->>'cutoff',''),coalesce(p_row->>'ordering_note',''))
   on conflict(id) do update set name=excluded.name,phone=excluded.phone,reminder=excluded.reminder,
    cutoff=case when p_row ? 'cutoff' then excluded.cutoff else public.app_suppliers.cutoff end,ordering_note=case when p_row ? 'ordering_note' then excluded.ordering_note else public.app_suppliers.ordering_note end,updated_at=now()
   returning to_jsonb(app_suppliers.*) into newrow;
 elsif p_table='items' then
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order,note,aliases,available) values(p_id,p_row->>'name',p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer,nullif(p_row->>'note',''),array(select jsonb_array_elements_text(coalesce(p_row->'aliases','[]'::jsonb))),coalesce((p_row->>'available')::boolean,true))
   on conflict(id) do update set name=excluded.name,unit_id=excluded.unit_id,supplier_id=excluded.supplier_id,
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

-- A short-lived, server-only Undo receipt. It is bound to the deleting account/device,
-- never accepts a client-provided snapshot, and is pruned on every deletion.
create table public.app_item_undo (
 id text primary key default gen_random_uuid()::text,
 actor text not null check(actor in ('rozha','yunis')),
 device_id text,
 item jsonb not null,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
alter table public.app_item_undo enable row level security;
revoke all on public.app_item_undo from public,anon,authenticated;
grant all on public.app_item_undo to service_role;
create or replace function public.app_internal_item_undo(p_id text,p_actor text,p_device text,p_restore boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare snapshot jsonb; receipt public.app_item_undo%rowtype; token text;
begin
 if p_actor is null or p_actor not in ('rozha','yunis') or nullif(p_id,'') is null then raise exception 'Invalid item action'; end if;
 if p_restore then
  select * into receipt from public.app_item_undo where id=p_id and actor=p_actor and device_id is not distinct from p_device and expires_at>now() for update;
  if not found then return jsonb_build_object('error','undo_expired'); end if;
  snapshot:=receipt.item;
  perform pg_advisory_xact_lock(hashtextextended('items:'||(snapshot->>'id'),0));
  if exists(select 1 from public.app_items where id=snapshot->>'id') then return jsonb_build_object('error','conflict'); end if;
  if (snapshot->>'supplier_id' is not null and not exists(select 1 from public.app_suppliers where id=snapshot->>'supplier_id')) or
     (snapshot->>'unit_id' is not null and not exists(select 1 from public.app_units where id=snapshot->>'unit_id')) then return jsonb_build_object('error','conflict'); end if;
  perform public.app_internal_catalog_change('items',snapshot->>'id',snapshot,p_actor,p_device);
  update public.app_items set created_at=(snapshot->>'created_at')::timestamptz where id=snapshot->>'id';
  delete from public.app_item_undo where id=p_id;
  return jsonb_build_object('ok',true,'itemId',snapshot->>'id');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('items:'||p_id,0));
 select to_jsonb(i) into snapshot from public.app_items i where id=p_id for update;
 if snapshot is null then return jsonb_build_object('error','not_found'); end if;
 delete from public.app_item_undo where expires_at<=now();
 insert into public.app_item_undo(actor,device_id,item) values(p_actor,p_device,snapshot) returning id into token;
 perform public.app_internal_catalog_change('items',p_id,null,p_actor,p_device);
 return jsonb_build_object('ok',true,'undoId',token);
end $$;
revoke all on function public.app_internal_item_undo(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.app_internal_item_undo(text,text,text,boolean) to service_role;

-- Explicitly reviewed merges only. Compare versions under the same locks as catalog edits.
-- Historical names/quantities are immutable. Draft quantities and favourites move atomically.
create or replace function public.app_internal_merge_items(p_keep text,p_remove text,p_keep_version timestamptz,p_remove_version timestamptz,p_actor text,p_device text)
returns jsonb language plpgsql set search_path='' as $$
declare k public.app_items%rowtype; r public.app_items%rowtype; merged_aliases text[]; merged_note text; item_id text;
begin
 if p_actor is null or p_actor not in ('rozha','yunis') or p_keep is null or p_remove is null or p_keep=p_remove then raise exception 'Invalid merge'; end if;
 for item_id in select unnest(array[p_keep,p_remove]) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('items:'||item_id,0));
 end loop;
 perform id from public.app_items where id in(p_keep,p_remove) order by id for update;
 select * into k from public.app_items where id=p_keep;
 select * into r from public.app_items where id=p_remove;
 if k.id is null or r.id is null or k.updated_at is distinct from p_keep_version or r.updated_at is distinct from p_remove_version then return jsonb_build_object('error','conflict'); end if;
 if k.supplier_id is distinct from r.supplier_id or k.unit_id is distinct from r.unit_id or k.available<>r.available then return jsonb_build_object('error','incompatible_items'); end if;
 select coalesce(array_agg(a order by first_pos),'{}') into merged_aliases from (
  select a,min(pos) first_pos from unnest(k.aliases||r.aliases||array[r.name]) with ordinality t(a,pos)
  where a<>k.name group by a
 ) x;
 merged_note:=case when coalesce(k.note,'')=coalesce(r.note,'') or coalesce(r.note,'')='' then coalesce(k.note,'') when coalesce(k.note,'')='' then r.note else k.note||'; '||r.note end;
 if cardinality(merged_aliases)>12 or exists(select 1 from unnest(merged_aliases) a where length(a)>120) or length(merged_note)>120 then return jsonb_build_object('error','merge_details'); end if;
 -- Ordered locks avoid concurrent merges changing each other's drafts/accounts.
 perform account from public.app_order_drafts order by account for update;
 perform id from public.app_accounts order by id for update;
 if exists(select 1 from public.app_order_drafts where cart ? p_remove and coalesce((cart->>p_keep)::numeric,0)+coalesce((cart->>p_remove)::numeric,0)>99999) then return jsonb_build_object('error','quantity_limit'); end if;
 update public.app_order_drafts set cart=(cart-p_remove)||jsonb_build_object(p_keep,coalesce((cart->>p_keep)::numeric,0)+coalesce((cart->>p_remove)::numeric,0)),revision=revision+1,updated_at=now() where cart ? p_remove;
 update public.app_accounts a set pins=array(select mapped from (select case when v=p_remove then p_keep else v end as mapped,min(ord) as pos from unnest(a.pins) with ordinality t(v,ord) group by 1) x order by pos),updated_at=now() where p_remove=any(a.pins);
 perform public.app_internal_catalog_change('items',p_keep,to_jsonb(k)||jsonb_build_object('aliases',to_jsonb(merged_aliases),'note',merged_note),p_actor,p_device);
 perform public.app_internal_catalog_change('items',p_remove,null,p_actor,p_device);
 return jsonb_build_object('ok',true,'keptId',p_keep);
end $$;
revoke all on function public.app_internal_merge_items(text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_merge_items(text,text,timestamptz,timestamptz,text,text) to service_role;

-- Cron tables require elevated read privileges. Return only operational summaries,
-- never job SQL, HTTP headers, errors or credentials. The API also requires Rozha.
create or replace function public.app_internal_diagnostics(p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb:='[]'::jsonb;
begin
 if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
 if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('name',j.jobname,'active',j.active,
   'lastRun',r.end_time,'lastStatus',r.status,'failures24h',(select count(*) from cron.job_run_details f where f.jobid=j.jobid and f.start_time>now()-interval '24 hours' and f.status='failed')) order by j.jobname),'[]'::jsonb)
   from cron.job j left join lateral(select end_time,status from cron.job_run_details where jobid=j.jobid order by start_time desc limit 1) r on true
   where j.jobname in ('ricotta-reminder-tick','ricotta-monthly-history','ricotta-daily-cleanup','ricotta-cron-history')$q$ into jobs;
 end if;
 return jsonb_build_object('checkedAt',now(),'database',true,'jobs',jobs);
end $$;
revoke all on function public.app_internal_diagnostics(text) from public,anon,authenticated;
grant execute on function public.app_internal_diagnostics(text) to service_role;

-- Validation and draft writes share item locks with catalog deletes/merges.
create or replace function public.app_internal_patch_draft(p_account text, p_changes jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
 d public.app_order_drafts%rowtype; c jsonb; item text; old_qty numeric; new_qty numeric;
 conflicts jsonb := '[]'::jsonb; next_cart jsonb;
begin
 if p_account not in ('rozha','yunis') or p_account is null then raise exception 'Invalid account'; end if;
 if p_changes is null or jsonb_typeof(p_changes) <> 'array' then raise exception 'Invalid changes'; end if;
 if jsonb_array_length(p_changes) > 2000 then raise exception 'Too many changes'; end if;
 if (select count(*) from jsonb_array_elements(p_changes)) <> (select count(distinct x->>'itemId') from jsonb_array_elements(p_changes) x) then raise exception 'Duplicate item'; end if;
 for c in select value from jsonb_array_elements(p_changes) order by value->>'itemId' loop
  item := c->>'itemId';
  if item is null or length(item) < 1 or length(item) > 200 or jsonb_typeof(c->'before') is distinct from 'number' or jsonb_typeof(c->'after') is distinct from 'number' then raise exception 'Invalid change'; end if;
  old_qty := (c->>'before')::numeric; new_qty := (c->>'after')::numeric;
  if old_qty < 0 or old_qty > 99999 or old_qty <> round(old_qty,3) or new_qty < 0 or new_qty > 99999 or new_qty <> round(new_qty,3) then raise exception 'Invalid quantity'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('items:'||item,0));
  if new_qty > 0 and not exists(select 1 from public.app_items where id=item) then raise exception 'Unknown item'; end if;
 end loop;
 insert into public.app_order_drafts(account) values(p_account) on conflict(account) do nothing;
 select * into d from public.app_order_drafts where account=p_account for update;
 for c in select value from jsonb_array_elements(p_changes) order by value->>'itemId' loop
  item := c->>'itemId'; old_qty := coalesce((d.cart->>item)::numeric,0);
  if old_qty <> (c->>'before')::numeric and old_qty <> (c->>'after')::numeric then conflicts := conflicts || jsonb_build_array(item); end if;
 end loop;
 if jsonb_array_length(conflicts) > 0 then
  return jsonb_build_object('cart',d.cart,'revision',d.revision,'conflicts',conflicts);
 end if;
 next_cart := d.cart;
 for c in select value from jsonb_array_elements(p_changes) order by value->>'itemId' loop
  item := c->>'itemId'; new_qty := (c->>'after')::numeric;
  if new_qty=0 then next_cart := next_cart-item;
  else next_cart := jsonb_set(next_cart,array[item],to_jsonb(new_qty)); end if;
 end loop;
 if next_cart <> d.cart then
  update public.app_order_drafts set cart=next_cart,revision=revision+1,updated_at=now() where account=p_account returning * into d;
 end if;
 return jsonb_build_object('cart',d.cart,'revision',d.revision,'conflicts','[]'::jsonb);
end $$;
revoke all on function public.app_internal_patch_draft(text,jsonb) from public,anon,authenticated;
grant execute on function public.app_internal_patch_draft(text,jsonb) to service_role;



-- Remove expired Undo snapshots even if no further items are deleted.
create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_item_undo where expires_at<=now();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
end $$;
revoke all on function public.app_internal_cleanup() from public, anon, authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
