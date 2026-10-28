-- Audit repairs (F06, F13), 2026-10-28.
-- F06: an item or supplier edit changes only the fields it sends. A form that was open while another phone
--      saved a newer note, number or reminder no longer puts the old value back.
-- F13: Undo keeps "last ordered": restoring a deleted item brings its date back, and undoing an order goes
--      back to the date each item had before it (kept on the order's lines), even after older orders are cleared.

alter table public.app_order_lines add column if not exists prev_last_ordered_at timestamptz;

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


create or replace function public.app_internal_save_order(p_id text, p_date timestamptz, p_account text, p_lines jsonb)
returns boolean language plpgsql set search_path = '' as $$
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
  -- Each line keeps the item's "last ordered" date from before this order, so Undo can put it back
  -- even after the month's older orders are cleared.
  insert into public.app_order_lines(order_id,supplier_id,supplier_name,item_id,item_name,unit_id,qty,prev_last_ordered_at)
    select p_id,l.supplier_id,l.supplier_name,l.item_id,l.item_name,l.unit_id,l.qty,i.last_ordered_at
    from jsonb_to_recordset(p_lines) as l(supplier_id text,supplier_name text,item_id text,item_name text,unit_id text,qty numeric)
    left join public.app_items i on i.id = l.item_id;
  update public.app_items set last_ordered_at = p_date
    where id in (select l.item_id from jsonb_to_recordset(p_lines) as l(item_id text) where l.item_id is not null)
      and (last_ordered_at is null or last_ordered_at < p_date);
  return true;
end $$;
revoke all on function public.app_internal_save_order(text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_internal_save_order(text,timestamptz,text,jsonb) to service_role;

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
  update public.app_items set created_at=(snapshot->>'created_at')::timestamptz,
    last_ordered_at=(snapshot->>'last_ordered_at')::timestamptz where id=snapshot->>'id';
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
