alter table public.app_items add column aliases text[] not null default '{}', add column available boolean not null default true;
alter table public.app_items add constraint app_items_aliases_count check(cardinality(aliases)<=12);
alter table public.app_accounts add column message_format jsonb not null default '{}' check(jsonb_typeof(message_format)='object');
alter table public.app_orders add column note text not null default '' check(length(note)<=300);
alter table public.app_order_drafts add column note text not null default '' check(length(note)<=300);
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

-- Suppliers keep their cut-off when an older app saves them without one.
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
 for c in select value from jsonb_array_elements(p_changes) loop
  item := c->>'itemId';
  if item is null or length(item) < 1 or length(item) > 200 or jsonb_typeof(c->'before') is distinct from 'number' or jsonb_typeof(c->'after') is distinct from 'number' then raise exception 'Invalid change'; end if;
  old_qty := (c->>'before')::numeric; new_qty := (c->>'after')::numeric;
  if old_qty < 0 or old_qty > 99999 or old_qty <> round(old_qty,3) or new_qty < 0 or new_qty > 99999 or new_qty <> round(new_qty,3) then raise exception 'Invalid quantity'; end if;
  if new_qty > 0 and not exists(select 1 from public.app_items where id=item) then raise exception 'Unknown item'; end if;
 end loop;
 insert into public.app_order_drafts(account) values(p_account) on conflict(account) do nothing;
 select * into d from public.app_order_drafts where account=p_account for update;
 for c in select value from jsonb_array_elements(p_changes) loop
  item := c->>'itemId'; old_qty := coalesce((d.cart->>item)::numeric,0);
  if old_qty <> (c->>'before')::numeric and old_qty <> (c->>'after')::numeric then conflicts := conflicts || jsonb_build_array(item); end if;
 end loop;
 if jsonb_array_length(conflicts) > 0 then
  return jsonb_build_object('cart',d.cart,'revision',d.revision,'conflicts',conflicts);
 end if;
 next_cart := d.cart;
 for c in select value from jsonb_array_elements(p_changes) loop
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


create or replace function public.app_internal_patch_draft_note(p_account text,p_changes jsonb,p_before text,p_after text)
returns jsonb language plpgsql set search_path='' as $$
declare d public.app_order_drafts%rowtype; result jsonb;
begin
 if p_account not in ('rozha','yunis') or p_account is null then raise exception 'Invalid account'; end if;
 if length(coalesce(p_after,''))>300 then raise exception 'Invalid note'; end if;
 insert into public.app_order_drafts(account) values(p_account) on conflict(account) do nothing;
 select * into d from public.app_order_drafts where account=p_account for update;
 if p_after is not null and d.note<>coalesce(p_before,'') and d.note<>p_after then return jsonb_build_object('cart',d.cart,'note',d.note,'revision',d.revision,'conflicts',jsonb_build_array('__note')); end if;
 result:=public.app_internal_patch_draft(p_account,p_changes);
 if jsonb_array_length(result->'conflicts')>0 then return result||jsonb_build_object('note',d.note); end if;
 if p_after is not null and d.note<>p_after then update public.app_order_drafts set note=p_after,revision=revision+1,updated_at=now() where account=p_account; end if;
 select * into d from public.app_order_drafts where account=p_account;
 return jsonb_build_object('cart',d.cart,'note',d.note,'revision',d.revision,'conflicts','[]'::jsonb);
end $$;
revoke all on function public.app_internal_patch_draft_note(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_patch_draft_note(text,jsonb,text,text) to service_role;
create or replace function public.app_internal_save_order_note(p_id text,p_date timestamptz,p_account text,p_lines jsonb,p_note text)
returns boolean language plpgsql set search_path='' as $$
declare saved boolean;
begin
 if length(coalesce(p_note,''))>300 then raise exception 'Invalid note'; end if;
 saved:=public.app_internal_save_order(p_id,p_date,p_account,p_lines);
 if saved then update public.app_orders set note=coalesce(p_note,'') where id=p_id; end if;
 return saved;
end $$;
revoke all on function public.app_internal_save_order_note(text,timestamptz,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.app_internal_save_order_note(text,timestamptz,text,jsonb,text) to service_role;
