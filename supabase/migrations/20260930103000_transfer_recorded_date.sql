-- The POS 'Record for yesterday' switch is relative to the day the PC submits,
-- which may differ from the day the phone approved a queued request.
alter table public.transfer_requests add column recorded_date date;

create function public.transfer_set_recorded_date()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='completed' and old.status<>'completed' then
    new.recorded_date:=coalesce(new.recorded_date,
      (now() at time zone 'Asia/Baghdad')::date - case when new.record_yesterday then 1 else 0 end);
  end if;
  return new;
end $$;
create trigger transfer_request_recorded_date before update on public.transfer_requests
for each row execute function public.transfer_set_recorded_date();

drop function public.transfer_resolve(uuid,text,text,text);
create function public.transfer_resolve(p_id uuid,p_actor text,p_status text,p_note text,p_recorded_date date)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.transfer_requests%rowtype; l record; current_qty numeric; earliest date;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_status not in ('completed','failed') or
    length(trim(coalesce(p_note,'')))<10 then raise exception 'Resolution requires a checked result and note'; end if;
  select * into r from public.transfer_requests where id=p_id for update;
  if not found or r.status<>'needs_checking' then raise exception 'Request is not awaiting reconciliation'; end if;
  earliest:=(r.approved_at at time zone 'Asia/Baghdad')::date - case when r.record_yesterday then 1 else 0 end;
  if p_status='completed' and (p_recorded_date is null or p_recorded_date<earliest or
    p_recorded_date>(now() at time zone 'Asia/Baghdad')::date) then
    raise exception 'Enter the verified workplace recorded date'; end if;
  if p_status='completed' then
    for l in select item_id,sum(quantity*count_per_unit) qty from public.transfer_lines
      where request_id=p_id group by item_id loop
      select coalesce(quantity,0) into current_qty from public.transfer_balances
        where item_id=l.item_id and storage_name=r.from_storage;
      if coalesce(current_qty,0)<l.qty then raise exception 'App balance changed; recount is needed'; end if;
      update public.transfer_balances set quantity=quantity-l.qty,updated_at=now()
        where item_id=l.item_id and storage_name=r.from_storage;
      insert into public.transfer_balances(item_id,storage_name,quantity) values(l.item_id,r.to_storage,l.qty)
        on conflict(item_id,storage_name) do update set quantity=transfer_balances.quantity+excluded.quantity,updated_at=now();
    end loop;
  end if;
  update public.transfer_requests set status=p_status,finished_at=now(),
    recorded_date=case when p_status='completed' then p_recorded_date else null end,
    result_message='Manually reconciled by '||p_actor||': '||left(trim(p_note),900) where id=p_id;
  insert into public.transfer_events(request_id,actor,action,details)
    values(p_id,p_actor,'manual_'||p_status,
      jsonb_build_object('note',left(trim(p_note),900),'recorded_date',p_recorded_date));
end $$;
revoke all on function public.transfer_resolve(uuid,text,text,text,date) from public,anon,authenticated;
grant execute on function public.transfer_resolve(uuid,text,text,text,date) to service_role;
