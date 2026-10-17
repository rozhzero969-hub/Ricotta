-- Transfers: the workplace stock system's item list, so the Transfers tab can find each item's exact
-- name and allowed units and make the "Move between storages" upload file. It is separate from the
-- ordering catalog. Names come from an uploaded list; aliases are the spellings people taught it.
create table public.app_stock_items (
  id text primary key default gen_random_uuid()::text,
  name text not null check (length(name) between 1 and 200),
  units text[] not null default '{}' check (cardinality(units) <= 20),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 30),
  position integer not null default 0,
  updated_at timestamptz not null default now()
);
create unique index app_stock_items_name_key on public.app_stock_items (lower(name));
alter table public.app_stock_items enable row level security;
revoke all on public.app_stock_items from public, anon, authenticated;

-- Replaces the whole list in one go. Items that stay keep their id and aliases.
create or replace function public.app_internal_replace_stock_items(p_items jsonb)
returns integer language plpgsql set search_path = '' as $$
declare names text[]; n integer;
begin
 if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then raise exception 'Invalid stock list'; end if;
 if exists (select 1 from jsonb_array_elements(p_items) x
   where jsonb_typeof(x->'name') is distinct from 'string' or length(trim(x->>'name')) not between 1 and 200
     or (x ? 'units' and (jsonb_typeof(x->'units') <> 'array' or jsonb_array_length(x->'units') > 20))) then
  raise exception 'Invalid stock item';
 end if;
 select coalesce(array_agg(lower(trim(x->>'name'))), '{}') into names from jsonb_array_elements(p_items) x;
 delete from public.app_stock_items s where not (lower(s.name) = any(names));
 insert into public.app_stock_items (name, units, position)
  select distinct on (lower(trim(x->>'name'))) trim(x->>'name'),
   array(select v from (select trim(u) as v, min(k) as k from jsonb_array_elements_text(coalesce(x->'units','[]'::jsonb)) with ordinality e(u, k)
     where length(trim(u)) between 1 and 40 group by trim(u)) z order by k),
   (o - 1)::integer
  from jsonb_array_elements(p_items) with ordinality t(x, o)
  order by lower(trim(x->>'name')), o
  on conflict (lower(name)) do update set name = excluded.name, units = excluded.units, position = excluded.position, updated_at = now();
 select count(*) into n from public.app_stock_items;
 return n;
end $$;
revoke all on function public.app_internal_replace_stock_items(jsonb) from public, anon, authenticated;
grant execute on function public.app_internal_replace_stock_items(jsonb) to service_role;

-- "Remember": a spelling someone used is saved on the item, so it is found by itself next time.
-- The newest 30 spellings are kept; the item's own name is never stored as an alias.
create or replace function public.app_internal_stock_alias(p_id text, p_alias text)
returns boolean language plpgsql set search_path = '' as $$
declare a text := trim(coalesce(p_alias, ''));
begin
 if length(a) not between 1 and 120 then raise exception 'Invalid alias'; end if;
 update public.app_stock_items s set
  aliases = coalesce((select array_agg(v order by k) from (
    select v, k from (
      select distinct on (lower(v)) v, k from unnest(s.aliases || array[a]) with ordinality t(v, k)
      where lower(v) <> lower(s.name) order by lower(v), k desc) d
    order by k desc limit 30) y), '{}'),
  updated_at = now()
 where s.id = p_id;
 return found;
end $$;
revoke all on function public.app_internal_stock_alias(text, text) from public, anon, authenticated;
grant execute on function public.app_internal_stock_alias(text, text) to service_role;

-- The item fields added for a stock export on each order are not used: the transfer list is separate.
drop index if exists public.app_items_stock_unit_idx;
alter table public.app_items drop column if exists stock_name, drop column if exists stock_unit, drop column if exists stock_factor;

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
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r,'cutoff',coalesce(p_row->>'cutoff',''));
 elsif p_table='units' then
  return jsonb_build_object('name',p_row->>'en','nameKu',coalesce(p_row->>'ku',''),'nameAr',coalesce(p_row->>'ar',''));
 end if;
 raise exception 'Invalid catalog';
end $$;
revoke all on function public.app_internal_record_fields(text,jsonb) from public,anon,authenticated;
grant execute on function public.app_internal_record_fields(text,jsonb) to service_role;

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
