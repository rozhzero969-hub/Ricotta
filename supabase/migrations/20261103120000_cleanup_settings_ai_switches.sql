-- 2026-11-03 clean-up release.
-- Gone: Transfers (its saved workplace list and its role), the daily reminder (and its role), supplier
-- order cut-offs, and item places and pictures. New: settings saved per account, and each AI can be
-- switched off in Admin.

-- Transfers
drop function if exists public.app_internal_replace_stock_items(jsonb);
drop function if exists public.app_internal_stock_alias(text, text);
drop table if exists public.app_stock_items;

-- Roles: transfers and reminders no longer exist.
alter table public.app_accounts drop constraint if exists app_accounts_roles_known;
update public.app_accounts set roles = array_remove(array_remove(roles, 'transfers'), 'reminders') where roles is not null;
alter table public.app_accounts add constraint app_accounts_roles_known check (roles is null or (cardinality(roles) <= 12 and
  roles <@ array['history','manage','catalog','record','assistant','send','exports','notify']::text[]));

-- The daily reminder: notifications are now Rico's and the suppliers' only.
drop table if exists public.app_reminder_settings;

-- Supplier cut-offs: the Record and catalog changes no longer know the field, then it goes.
-- Also: an edit of a few fields (only the note, or only "available") keeps the name it has. The insert
-- part of the upsert needs a name before Postgres finds the existing row, and that edit has none.
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
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r);
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
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order,note,aliases,available) values(p_id,coalesce(p_row->>'name',oldrow->>'name'),p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer,nullif(p_row->>'note',''),array(select jsonb_array_elements_text(coalesce(p_row->'aliases','[]'::jsonb))),coalesce((p_row->>'available')::boolean,true))
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

alter table public.app_suppliers drop column if exists cutoff;
alter table public.app_items drop column if exists place;
alter table public.app_items drop column if exists photo_url;

-- Settings belong to the account (both phones of one account share them).
alter table public.app_accounts add column if not exists settings jsonb not null default '{}'::jsonb
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 8192);

-- Each AI can be switched off in Admin > Rico; a switched-off AI is skipped.
create table if not exists public.app_ai_switches (
  provider text primary key check (provider in ('anthropic', 'gemini', 'groq')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.app_ai_switches enable row level security;
revoke all on public.app_ai_switches from public, anon, authenticated;
grant all on public.app_ai_switches to service_role;
