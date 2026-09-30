-- A transfer can be entered in the item's counting format OR its buying format
-- (2 boxes instead of 24 pieces). Stock is always kept in counting units:
--   quantity / unit_label            what the ledger moves (counting units)
--   entered_quantity / entered_unit_label   what the person typed, and what the PC must
--                                            select on the workplace page
-- Older rows have no entered_* values and read as counting-unit transfers.
alter table public.stock_requests
  add column entered_quantity numeric(20,8) check (entered_quantity is null or entered_quantity > 0),
  add column entered_unit_label text;

drop function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text);
create function public.stock_submit(p_key uuid, p_from text, p_to text, p_yesterday boolean, p_actor text,
  p_item text, p_qty numeric, p_expected_name text, p_expected_unit text, p_unit text default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid; it public.app_items%rowtype; s public.stock_item_settings%rowtype;
  count_label text; entered_id text; entered_label text; ledger numeric; available numeric;
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
  if p_expected_name is distinct from it.name or p_expected_unit is distinct from entered_label then
    raise exception 'Catalog changed; review the request again'; end if;
  select coalesce(quantity,0) into available from public.stock_balances where item_id = p_item and storage_name = p_from;
  available := coalesce(available,0);
  if ledger + public.stock_reserved(p_item,p_from) > available then
    raise exception 'Insufficient unreserved app stock for %', it.name; end if;
  insert into public.stock_requests(client_key,item_id,item_name,unit_label,quantity,entered_quantity,entered_unit_label,
      from_storage,to_storage,record_yesterday,approved_by)
    values(p_key,p_item,it.name,count_label,ledger,p_qty,entered_label,p_from,p_to,coalesce(p_yesterday,false),p_actor)
    returning id into r_id;
  insert into public.stock_events(request_id,actor,action) values(r_id,p_actor,'approved');
  return r_id;
end $$;
revoke all on function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text) to service_role;
