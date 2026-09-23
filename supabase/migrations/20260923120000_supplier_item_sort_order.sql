-- Optional per-supplier item ordering. NULL keeps locale-aware A-Z order.
alter table public.app_items
  add column if not exists sort_order integer
  check (sort_order is null or sort_order >= 0);

create or replace function public.app_internal_set_item_order(p_supplier_id text, p_item_ids text[])
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expected_count integer;
begin
  if p_supplier_id is null or p_item_ids is null or cardinality(p_item_ids) > 500 then
    return false;
  end if;

  select count(*) into expected_count
    from public.app_items where supplier_id = p_supplier_id;
  if cardinality(p_item_ids) <> expected_count
     or cardinality(array(select distinct unnest(p_item_ids))) <> cardinality(p_item_ids)
     or exists (
       select 1 from unnest(p_item_ids) as requested(id)
       left join public.app_items i on i.id = requested.id and i.supplier_id = p_supplier_id
       where i.id is null
     ) then
    return false;
  end if;

  update public.app_items i
    set sort_order = requested.position::integer - 1, updated_at = now()
    from unnest(p_item_ids) with ordinality as requested(id, position)
    where i.id = requested.id and i.supplier_id = p_supplier_id;

  return true;
end;
$$;

revoke execute on function public.app_internal_set_item_order(text,text[]) from public, anon, authenticated;
grant execute on function public.app_internal_set_item_order(text,text[]) to service_role;
