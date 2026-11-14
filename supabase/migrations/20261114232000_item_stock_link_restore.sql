-- Undo of a deleted item puts its stock link back too (app_items.stock_item, 20261114230000). Same function
-- as 20261103120000, with stock_item kept on restore and on edits that don't mention it.
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
  insert into public.app_suppliers(id,name,phone,reminder) values(p_id,coalesce(p_row->>'name',oldrow->>'name'),p_row->>'phone',p_row->'reminder')
   on conflict(id) do update set name=case when p_row ? 'name' then excluded.name else public.app_suppliers.name end,
    phone=case when p_row ? 'phone' then excluded.phone else public.app_suppliers.phone end,
    reminder=case when p_row ? 'reminder' then excluded.reminder else public.app_suppliers.reminder end,updated_at=now()
   returning to_jsonb(app_suppliers.*) into newrow;
 elsif p_table='items' then
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order,note,aliases,available,stock_item) values(p_id,coalesce(p_row->>'name',oldrow->>'name'),p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer,nullif(p_row->>'note',''),array(select jsonb_array_elements_text(coalesce(p_row->'aliases','[]'::jsonb))),coalesce((p_row->>'available')::boolean,true),nullif(p_row->>'stock_item',''))
   on conflict(id) do update set name=case when p_row ? 'name' then excluded.name else public.app_items.name end,
    stock_item=case when p_row ? 'stock_item' then excluded.stock_item else public.app_items.stock_item end,
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
