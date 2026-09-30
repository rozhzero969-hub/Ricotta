-- Avoid a PL/pgSQL record variable shadowing the transfer_lines table alias.
create or replace function public.transfer_finish(p_id uuid,p_worker text,p_status text,p_message text,p_line_results jsonb default '[]'::jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.transfer_requests%rowtype; l record; current_qty numeric;
begin
  perform pg_advisory_xact_lock(729291);
  select * into r from public.transfer_requests where id=p_id for update;
  if not found or r.status<>'running' or r.claimed_by<>p_worker or
    p_status not in ('completed','failed','needs_checking') then raise exception 'Invalid completion'; end if;
  if p_status='completed' then
    for l in select item_id,sum(quantity*count_per_unit) qty from public.transfer_lines
      where request_id=p_id group by item_id loop
      select coalesce(quantity,0) into current_qty from public.transfer_balances
        where item_id=l.item_id and storage_name=r.from_storage;
      if coalesce(current_qty,0)<l.qty then raise exception 'App balance changed; needs manual review'; end if;
      insert into public.transfer_balances(item_id,storage_name,quantity) values(l.item_id,r.from_storage,0)
        on conflict do nothing;
      update public.transfer_balances set quantity=quantity-l.qty,updated_at=now()
        where item_id=l.item_id and storage_name=r.from_storage;
      insert into public.transfer_balances(item_id,storage_name,quantity) values(l.item_id,r.to_storage,l.qty)
        on conflict(item_id,storage_name) do update set quantity=transfer_balances.quantity+excluded.quantity,updated_at=now();
    end loop;
  end if;
  update public.transfer_requests set status=p_status,finished_at=now(),result_message=left(coalesce(p_message,''),1000)
    where id=p_id;
  if jsonb_typeof(p_line_results)='array' then
    update public.transfer_lines tl set result_message=left(coalesce(x.value->>'message',''),500)
      from jsonb_array_elements(p_line_results) with ordinality as x(value,n)
      where tl.request_id=p_id and tl.id=(x.value->>'line_id')::bigint;
  end if;
  insert into public.transfer_events(request_id,actor,action,details)
    values(p_id,p_worker,p_status,jsonb_build_object('message',left(coalesce(p_message,''),1000)));
end $$;
