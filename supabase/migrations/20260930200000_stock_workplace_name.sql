-- Two names per item: the name inside this app (app_items.name, used everywhere in the app) and the name
-- inside the workplace system (stock_item_settings.workplace_name, what the PC searches for).
-- Blank workplace name = the same as the app name. A request keeps both: item_name is the workplace name
-- (the PC's search text), app_name is what people see in the app.
alter table public.stock_item_settings add column workplace_name text check (workplace_name is null or length(workplace_name) <= 240);
alter table public.stock_requests add column app_name text;

drop function public.stock_save_settings(text,text,text,numeric,numeric);
create function public.stock_save_settings(p_item text, p_actor text, p_counting text, p_per numeric, p_low numeric, p_workplace text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare it public.app_items%rowtype; old public.stock_item_settings%rowtype; had boolean;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  select * into it from public.app_items where id = p_item;
  if not found then raise exception 'Item not found'; end if;
  if it.unit_id is null then raise exception 'Choose the buying format first'; end if;
  if p_counting is null or not exists(select 1 from public.app_units where id = p_counting) then
    raise exception 'Choose the counting format'; end if;
  if p_counting <> it.unit_id and (p_per is null or p_per <= 0 or p_per > 100000000 or scale(p_per) > 8) then
    raise exception 'Enter how many counting units are in one buying unit'; end if;
  if p_low is not null and (p_low < 0 or scale(p_low) > 6) then raise exception 'Invalid low stock level'; end if;
  select * into old from public.stock_item_settings where item_id = p_item;
  had := found;
  if had and old.counting_unit <> p_counting and (
      exists(select 1 from public.stock_balances where item_id = p_item and quantity > 0) or
      exists(select 1 from public.stock_requests where item_id = p_item and status in ('waiting','running','needs_checking'))) then
    raise exception 'The counting format cannot change while stock is recorded. Recount every storage to 0 first.'; end if;
  if p_workplace is not null and length(p_workplace) > 240 then raise exception 'The workplace name is too long'; end if;
  insert into public.stock_item_settings(item_id,counting_unit,per_buying,low_stock,workplace_name,updated_by,updated_at)
    values(p_item,p_counting,case when p_counting = it.unit_id then null else p_per end,p_low,nullif(trim(coalesce(p_workplace,'')),''),p_actor,now())
    on conflict (item_id) do update set counting_unit = excluded.counting_unit, per_buying = excluded.per_buying,
      low_stock = excluded.low_stock, workplace_name = excluded.workplace_name, updated_by = excluded.updated_by, updated_at = now();
  insert into public.stock_events(actor,action,details)
    values(p_actor, case when had then 'settings_edited' else 'settings_created' end,
      jsonb_build_object('item_id',p_item,'item_name',it.name));
end $$;
drop function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text);
create function public.stock_submit(p_key uuid, p_from text, p_to text, p_yesterday boolean, p_actor text,
  p_item text, p_qty numeric, p_expected_name text, p_expected_unit text, p_unit text default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid; it public.app_items%rowtype; s public.stock_item_settings%rowtype;
  wname text; count_label text; entered_id text; entered_label text; ledger numeric; available numeric;
begin
  perform pg_advisory_xact_lock(729291);
  select id into r_id from public.stock_requests where client_key = p_key;
  if found then return r_id; end if;
  if p_actor not in ('rozha','yunis') or p_from is null or p_to is null or p_from = p_to or
    not exists(select 1 from public.stock_storages where name = p_from) or
    not exists(select 1 from public.stock_storages where name = p_to) then
    raise exception 'Invalid actor or storages'; end if;
  select * into it from public.app_items where id = p_item;
  select * into s from public.stock_item_settings where item_id = p_item;
  if it.id is null or s.item_id is null then raise exception 'Item is unavailable: set up its counting format first'; end if;
  wname := coalesce(nullif(trim(s.workplace_name),''), it.name);   -- the name the PC searches for in the workplace system
  count_label := public.stock_unit_label(s.counting_unit);
  if count_label is null or length(trim(it.name)) = 0 then raise exception 'Item is unavailable'; end if;
  entered_id := coalesce(p_unit, s.counting_unit);
  if entered_id <> s.counting_unit and entered_id is distinct from it.unit_id then
    raise exception 'Choose the item''s buying or counting format'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 or scale(p_qty) > 6 then raise exception 'Invalid quantity'; end if;
  if entered_id = s.counting_unit then
    ledger := p_qty;
  else
    if s.per_buying is null then raise exception 'Set how many counting units are in one buying unit first'; end if;
    ledger := p_qty * s.per_buying;
  end if;
  ledger := trim_scale(ledger);   -- 0.5 x 12.00000000 is 6, not a 9-decimal number
  if ledger > 100000000 or scale(ledger) > 8 then raise exception 'Invalid quantity'; end if;
  entered_label := public.stock_unit_label(entered_id);
  if p_expected_name is distinct from wname or p_expected_unit is distinct from entered_label then
    raise exception 'Catalog changed; review the request again'; end if;
  select coalesce(quantity,0) into available from public.stock_balances where item_id = p_item and storage_name = p_from;
  available := coalesce(available,0);
  if ledger + public.stock_reserved(p_item,p_from) > available then
    raise exception 'Insufficient unreserved app stock for %', it.name; end if;
  insert into public.stock_requests(client_key,item_id,item_name,app_name,unit_label,quantity,entered_quantity,entered_unit_label,
      from_storage,to_storage,record_yesterday,approved_by)
    values(p_key,p_item,wname,it.name,count_label,ledger,p_qty,entered_label,p_from,p_to,coalesce(p_yesterday,false),p_actor)
    returning id into r_id;
  insert into public.stock_events(request_id,actor,action) values(r_id,p_actor,'approved');
  return r_id;
end $$;
revoke all on function public.stock_save_settings(text,text,text,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.stock_save_settings(text,text,text,numeric,numeric,text) to service_role;
revoke all on function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text) to service_role;
