-- Catalog edits share the transfer advisory lock, so approved requests keep
-- the exact name and conversion they were reviewed with.
create function public.transfer_save_item(p_id uuid,p_actor text,p_doc jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare item public.transfer_items%rowtype; item_id uuid; exact text; counting text;
  low numeric; u jsonb; unit_name text; factor numeric; verified boolean;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  exact:=trim(p_doc->>'exact_name'); counting:=trim(p_doc->>'counting_unit');
  if exact is null or length(exact) not between 1 and 240 or
    counting is null or length(counting) not between 1 and 80 then
    raise exception 'Exact name and counting unit are required'; end if;
  low:=nullif(p_doc->>'low_stock','')::numeric;
  if low<0 then raise exception 'Invalid low stock'; end if;
  if jsonb_typeof(p_doc->'units')<>'array' or jsonb_array_length(p_doc->'units')>10 then
    raise exception 'Invalid units'; end if;
  if p_id is null then
    insert into public.transfer_items(exact_name,counting_unit,usage_unit,buying_unit,low_stock,
      match_verified,needs_review)
      values(exact,counting,nullif(trim(p_doc->>'usage_unit'),''),nullif(trim(p_doc->>'buying_unit'),''),low,
        (p_doc->>'match_verified')::boolean,not (p_doc->>'match_verified')::boolean)
      returning id into item_id;
  else
    select * into item from public.transfer_items where id=p_id for update;
    if not found then raise exception 'Item not found'; end if;
    if counting<>item.counting_unit then raise exception 'Counting unit cannot change'; end if;
    if exists(select 1 from public.transfer_lines l join public.transfer_requests r on r.id=l.request_id
      where l.item_id=p_id and r.status in ('waiting','running','needs_checking')) then
      raise exception 'Resolve pending transfers for this item first'; end if;
    update public.transfer_items set exact_name=exact,usage_unit=nullif(trim(p_doc->>'usage_unit'),''),
      buying_unit=nullif(trim(p_doc->>'buying_unit'),''),low_stock=low,
      match_verified=(p_doc->>'match_verified')::boolean,
      needs_review=not (p_doc->>'match_verified')::boolean,updated_at=now()
      where id=p_id;
    item_id:=p_id;
    delete from public.transfer_units where item_id=p_id;
  end if;
  insert into public.transfer_units(item_id,unit,count_per_unit,verified)
    values(item_id,counting,1,true);
  for u in select value from jsonb_array_elements(p_doc->'units') loop
    unit_name:=trim(u->>'unit');factor:=nullif(u->>'count_per_unit','')::numeric;
    verified:=coalesce((u->>'verified')::boolean,false);
    if unit_name is null or length(unit_name) not between 1 and 80 or unit_name=counting or
      (factor is not null and (factor<=0 or factor>100000000)) or
      (verified and factor is null) then raise exception 'Invalid additional unit'; end if;
    insert into public.transfer_units(item_id,unit,count_per_unit,verified)
      values(item_id,unit_name,factor,verified);
  end loop;
  insert into public.transfer_events(actor,action,details)
    values(p_actor,case when p_id is null then 'item_created' else 'item_edited' end,
      jsonb_build_object('item_id',item_id,'exact_name',exact));
  return item_id;
end $$;

create function public.transfer_set_archive(p_id uuid,p_actor text,p_archived boolean)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  if exists(select 1 from public.transfer_lines l join public.transfer_requests r on r.id=l.request_id
    where l.item_id=p_id and r.status in ('waiting','running','needs_checking')) then
    raise exception 'Resolve pending transfers for this item first'; end if;
  update public.transfer_items set archived_at=case when p_archived then now() else null end,updated_at=now()
    where id=p_id;
  if not found then raise exception 'Item not found'; end if;
  insert into public.transfer_events(actor,action,details)
    values(p_actor,case when p_archived then 'item_archived' else 'item_restored' end,
      jsonb_build_object('item_id',p_id));
end $$;
revoke all on function public.transfer_save_item(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.transfer_set_archive(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.transfer_save_item(uuid,text,jsonb) to service_role;
grant execute on function public.transfer_set_archive(uuid,text,boolean) to service_role;
