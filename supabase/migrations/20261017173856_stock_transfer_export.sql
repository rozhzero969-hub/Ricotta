-- How each item is written in the workplace stock system, for the "Excel for stock" file.
-- All three are optional: without them the file uses the item's own name, unit and amount.
alter table public.app_items
  add column stock_name text check (stock_name is null or length(stock_name) between 1 and 160),
  add column stock_unit text references public.app_units(id) on delete set null,
  add column stock_factor numeric check (stock_factor is null or (stock_factor > 0 and stock_factor <= 100000 and stock_factor = round(stock_factor, 4)));
create index if not exists app_items_stock_unit_idx on public.app_items(stock_unit);

create or replace function public.app_internal_record_fields(p_table text, p_row jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare u text; s text; su text; r text := 'off';
begin
 if p_row is null then return '{}'::jsonb; end if;
 if p_table='items' then
  select en into u from public.app_units where id=p_row->>'unit_id';
  select name into s from public.app_suppliers where id=p_row->>'supplier_id';
  select en into su from public.app_units where id=p_row->>'stock_unit';
  return jsonb_build_object('name',p_row->>'name','unit',coalesce(u,''),'supplier',coalesce(s,''),'note',coalesce(p_row->>'note',''),'aliases',coalesce(p_row->'aliases','[]'::jsonb)::text,'available',coalesce(p_row->>'available','true'),
   'stockName',coalesce(p_row->>'stock_name',''),'stockUnit',coalesce(su,''),'stockFactor',coalesce(p_row->>'stock_factor',''));
 elsif p_table='suppliers' then
  if p_row->'reminder'->>'enabled'='true' then
   select coalesce(p_row->'reminder'->>'time','')||'|'||coalesce(string_agg(d::text,',' order by ord),'') into r
    from unnest(array[6,0,1,2,3,4,5]) with ordinality v(d,ord)
    where (p_row->'reminder'->'days') @> to_jsonb(array[d]);
  end if;
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r,'cutoff',coalesce(p_row->>'cutoff',''));
 elsif p_table='units' then
  return jsonb_build_object('name',p_row->>'en','nameKu',coalesce(p_row->>'ku',''),'nameAr',coalesce(p_row->>'ar',''));
 end if;
 raise exception 'Invalid catalog';
end $$;
revoke all on function public.app_internal_record_fields(text,jsonb) from public,anon,authenticated;
grant execute on function public.app_internal_record_fields(text,jsonb) to service_role;

-- Items keep their stock-system fields when an older app saves them without those keys.
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
   on conflict(id) do update set name=excluded.name,phone=excluded.phone,reminder=excluded.reminder,
    cutoff=case when p_row ? 'cutoff' then excluded.cutoff else public.app_suppliers.cutoff end,updated_at=now()
   returning to_jsonb(app_suppliers.*) into newrow;
 elsif p_table='items' then
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order,note,aliases,available,stock_name,stock_unit,stock_factor)
   values(p_id,p_row->>'name',p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer,nullif(p_row->>'note',''),
    array(select jsonb_array_elements_text(coalesce(p_row->'aliases','[]'::jsonb))),coalesce((p_row->>'available')::boolean,true),
    nullif(p_row->>'stock_name',''),nullif(p_row->>'stock_unit',''),(p_row->>'stock_factor')::numeric)
   on conflict(id) do update set name=excluded.name,unit_id=excluded.unit_id,supplier_id=excluded.supplier_id,
    sort_order=case when p_row ? 'sort_order' then excluded.sort_order else public.app_items.sort_order end,
    aliases=case when p_row ? 'aliases' then excluded.aliases else public.app_items.aliases end,
    available=case when p_row ? 'available' then excluded.available else public.app_items.available end,
    note=case when p_row ? 'note' then excluded.note else public.app_items.note end,
    stock_name=case when p_row ? 'stock_name' then excluded.stock_name else public.app_items.stock_name end,
    stock_unit=case when p_row ? 'stock_unit' then excluded.stock_unit else public.app_items.stock_unit end,
    stock_factor=case when p_row ? 'stock_factor' then excluded.stock_factor else public.app_items.stock_factor end,
    updated_at=now() returning to_jsonb(app_items.*) into newrow;
 else
  insert into public.app_units(id,en,ku,ar) values(p_id,p_row->>'en',p_row->>'ku',p_row->>'ar')
   on conflict(id) do update set en=excluded.en,ku=excluded.ku,ar=excluded.ar returning to_jsonb(app_units.*) into newrow;
 end if;
 if oldrow is null and newrow is null then return; end if;
 nextrow:=public.app_internal_record_fields(p_table,newrow);
 act:=case when oldrow is null then 'add' when newrow is null then 'delete' else 'edit' end;
 typ:=case p_table when 'suppliers' then 'supplier' when 'items' then 'item' else 'unit' end;
 -- Empty optional item fields (note, stock-system name, unit and amount) are left out of the Record.
 select coalesce(jsonb_agg(case act when 'add' then jsonb_build_object('k',k,'to',v) when 'delete' then jsonb_build_object('k',k,'from',v)
  else jsonb_build_object('k',k,'from',prev->>k,'to',v) end),'[]'::jsonb) into fields
 from jsonb_each_text(case when act='delete' then prev else nextrow end) f(k,v)
 where (act='edit' and coalesce(prev->>k,'')<>v) or
 (act='add' and (k='name' or (p_table='items' and (k not in ('note','stockName','stockUnit','stockFactor') or v<>'')) or (v<>'' and v<>'off'))) or
 (act='delete' and k<>'reminder' and (k='name' or (p_table='items' and (k not in ('note','stockName','stockUnit','stockFactor') or v<>'')) or v<>''));
 if fields='[]'::jsonb then return; end if;
 insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
 values(gen_random_uuid()::text,p_actor,p_device,act,typ,coalesce(nextrow->>'name',prev->>'name'),
 jsonb_build_object('by',initcap(p_actor),'fields',fields,'source','server'));
end $$;
revoke all on function public.app_internal_catalog_change(text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_catalog_change(text,text,jsonb,text,text) to service_role;
