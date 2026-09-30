-- A phone approval must match the exact catalog name and verified factor shown
-- during review. A concurrent catalog edit forces the user to review again.
create or replace function public.transfer_submit(p_key uuid,p_from text,p_to text,p_yesterday boolean,p_actor text,p_lines jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid; x jsonb; item public.transfer_items%rowtype; u public.transfer_units%rowtype;
  q numeric; wanted numeric; available numeric; reserved numeric; line_count int:=0;
begin
  perform pg_advisory_xact_lock(729291);
  select id into r_id from public.transfer_requests where client_key=p_key;
  if found then return r_id; end if;
  if p_actor not in ('rozha','yunis') or p_from=p_to or
    not exists(select 1 from public.transfer_storages where name=p_from) or
    not exists(select 1 from public.transfer_storages where name=p_to) then
    raise exception 'Invalid actor or storages';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception 'Transfer requires 1 to 20 lines';
  end if;
  insert into public.transfer_requests(client_key,from_storage,to_storage,record_yesterday,approved_by)
    values(p_key,p_from,p_to,coalesce(p_yesterday,false),p_actor) returning id into r_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    select * into item from public.transfer_items where id=(x->>'item_id')::uuid;
    if not found or item.archived_at is not null or item.needs_review or not item.match_verified then
      raise exception 'Item is unavailable or not matched to workplace page';
    end if;
    select * into u from public.transfer_units where item_id=item.id and unit=x->>'unit';
    if not found or not u.verified or u.count_per_unit is null then raise exception 'Unit conversion is unverified'; end if;
    if x->>'expected_name' is distinct from item.exact_name or
      nullif(x->>'expected_factor','')::numeric is distinct from u.count_per_unit then
      raise exception 'Catalog changed; review the request again'; end if;
    q:=(x->>'quantity')::numeric;
    if q<=0 or q>1000000 or scale(q)>6 then raise exception 'Invalid quantity'; end if;
    wanted:=q*u.count_per_unit;
    select coalesce(quantity,0) into available from public.transfer_balances
      where item_id=item.id and storage_name=p_from;
    available:=coalesce(available,0);
    select coalesce(sum(l.quantity*l.count_per_unit),0) into reserved
      from public.transfer_lines l join public.transfer_requests r on r.id=l.request_id
      where l.item_id=item.id and r.from_storage=p_from and r.status in ('waiting','running','needs_checking');
    if wanted+reserved>available then raise exception 'Insufficient unreserved app stock for %',item.exact_name; end if;
    insert into public.transfer_lines(request_id,item_id,exact_name,unit,quantity,count_per_unit)
      values(r_id,item.id,item.exact_name,u.unit,q,u.count_per_unit);
    line_count:=line_count+1;
  end loop;
  if line_count=0 then raise exception 'Empty transfer'; end if;
  insert into public.transfer_events(request_id,actor,action)
    values(r_id,p_actor,'approved');
  return r_id;
end $$;
