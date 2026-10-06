-- One transfer can move several items. A transfer is a "batch": one stock_requests row per item, all
-- sharing batch_id. The single-item logic stays per row (reservation, balances, history); what changes is that
-- a batch is submitted, checked by the PC, approved, run, finished, cancelled and reconciled as ONE unit.
-- batch_pos 0 is the "lead" row: the one the PC is handed and the one that carries the screenshots.
-- Rows that already exist become batches of one.
alter table public.stock_requests
  add column batch_id uuid not null default gen_random_uuid(),
  add column batch_size smallint not null default 1 check (batch_size between 1 and 30),
  add column batch_pos smallint not null default 0 check (batch_pos >= 0 and batch_pos < 30);
create index stock_requests_batch on public.stock_requests(batch_id, batch_pos);

create function public.stock_batch_of(p_id uuid)
returns uuid language sql stable security invoker set search_path = public as $$
  select batch_id from public.stock_requests where id = p_id
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Submitting. stock_submit gains the batch columns (everything else is unchanged); stock_submit_batch adds all
-- the lines in one transaction, so a transfer is either fully queued or not at all. Each line keeps its own
-- client key, so a retried request returns the same rows instead of queueing the transfer twice.
drop function public.stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text);
create function public.stock_submit(p_key uuid, p_from text, p_to text, p_yesterday boolean, p_actor text,
  p_item text, p_qty numeric, p_expected_name text, p_expected_unit text, p_unit text default null,
  p_batch uuid default null, p_batch_size smallint default 1, p_batch_pos smallint default 0)
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
  if entered_id <> s.counting_unit and entered_id is distinct from it.unit_id and entered_id is distinct from s.usage_unit then
    raise exception 'Choose the item''s buying, counting or recipe unit'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 or scale(p_qty) > 6 then raise exception 'Invalid quantity'; end if;
  if entered_id = s.counting_unit then
    ledger := p_qty;
  elsif entered_id = it.unit_id then
    if s.per_buying is null then raise exception 'Set how many counting units are in one buying unit first'; end if;
    ledger := p_qty * s.per_buying;
  else
    -- The recipe unit: 2500 gram is 2.5 kilo when one kilo is 1000 gram.
    if s.per_counting_usage is null or s.per_counting_usage <= 0 then raise exception 'Set how many recipe units are in one counting unit first'; end if;
    ledger := round(p_qty / s.per_counting_usage, 6);
  end if;
  ledger := trim_scale(ledger);   -- 0.5 x 12.00000000 is 6, not a 9-decimal number
  if ledger <= 0 or ledger > 100000000 or scale(ledger) > 8 then raise exception 'Invalid quantity'; end if;
  entered_label := public.stock_unit_label(entered_id);
  if p_expected_name is distinct from wname or p_expected_unit is distinct from entered_label then
    raise exception 'Catalog changed; review the request again'; end if;
  select coalesce(quantity,0) into available from public.stock_balances where item_id = p_item and storage_name = p_from;
  available := coalesce(available,0);
  if ledger + public.stock_reserved(p_item,p_from) > available then
    raise exception 'Insufficient unreserved app stock for %', it.name; end if;
  insert into public.stock_requests(client_key,item_id,item_name,app_name,unit_label,quantity,entered_quantity,entered_unit_label,
      from_storage,to_storage,record_yesterday,approved_by,batch_id,batch_size,batch_pos)
    values(p_key,p_item,wname,it.name,count_label,ledger,p_qty,entered_label,p_from,p_to,coalesce(p_yesterday,false),p_actor,
      coalesce(p_batch,gen_random_uuid()),coalesce(p_batch_size,1),coalesce(p_batch_pos,0))
    returning id into r_id;
  insert into public.stock_events(request_id,actor,action) values(r_id,p_actor,'approved');
  return r_id;
end $$;

-- p_lines: [{"key":uuid,"item":text,"qty":number,"name":text,"unit":text,"unitId":text|null}, ...]
-- Returns the request ids in the order of the lines; the first one is the lead.
create function public.stock_submit_batch(p_batch uuid, p_from text, p_to text, p_yesterday boolean, p_actor text, p_lines jsonb)
returns uuid[] language plpgsql security invoker set search_path=public as $$
declare n int; i int; line jsonb; ids uuid[] := '{}'; items text[] := '{}'; existing uuid;
begin
  perform pg_advisory_xact_lock(729291);
  if p_batch is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Invalid transfer'; end if;
  n := jsonb_array_length(p_lines);
  if n < 1 or n > 30 then raise exception 'A transfer can hold 1 to 30 items'; end if;
  for i in 0..n-1 loop
    line := p_lines -> i;
    if jsonb_typeof(line) <> 'object' or coalesce(line->>'item','') = '' or (line->>'key') is null then raise exception 'Invalid transfer line'; end if;
    if line->>'item' = any(items) then raise exception 'Each item can be added to a transfer only once'; end if;
    items := items || (line->>'item');
  end loop;
  -- A retry of a transfer that was already queued returns its rows (the first line's key identifies it).
  select id into existing from public.stock_requests where client_key = (p_lines->0->>'key')::uuid;
  if existing is not null then
    select coalesce(array_agg(id order by batch_pos), '{}') into ids
      from public.stock_requests where batch_id = (select batch_id from public.stock_requests where id = existing);
    return ids;
  end if;
  for i in 0..n-1 loop
    line := p_lines -> i;
    ids := ids || public.stock_submit((line->>'key')::uuid, p_from, p_to, p_yesterday, p_actor, line->>'item',
      (line->>'qty')::numeric, line->>'name', line->>'unit', nullif(line->>'unitId',''), p_batch, n::smallint, i::smallint);
  end loop;
  return ids;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Cancelling, the PC check, final approval, running, finishing and reconciling all act on the whole batch.
-- p_id may be any row of it.
create or replace function public.stock_cancel(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare b uuid; n int;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  b := public.stock_batch_of(p_id);
  with c as (
    update public.stock_requests set status = 'failed', finished_at = now(),
      result_message = 'Cancelled by ' || p_actor || ' before the PC started it.'
      where batch_id = b and status = 'waiting' returning id),
  e as (insert into public.stock_events(request_id,actor,action) select id,p_actor,'cancelled' from c returning 1)
  select count(*) into n from c;
  if n = 0 then raise exception 'Only a waiting request can be cancelled'; end if;
end $$;

create or replace function public.stock_preview_report(p_id uuid, p_worker text, p_ok boolean, p_message text, p_image text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare b uuid; lead uuid; n int;
begin
  perform pg_advisory_xact_lock(729291);
  perform public.stock_cleanup();
  b := public.stock_batch_of(p_id);
  select id into lead from public.stock_requests where batch_id = b order by batch_pos limit 1;
  with u as (
    update public.stock_requests set preview_status = case when p_ok then 'ok' else 'failed' end,
      preview_message = left(coalesce(p_message,''),500), previewed_at = now()
      where batch_id = b and status = 'waiting' and final_approved_at is null returning id),
  e as (insert into public.stock_events(request_id,actor,action,details)
    select id,p_worker,case when p_ok then 'preview_ok' else 'preview_failed' end,
      jsonb_build_object('message',left(coalesce(p_message,''),500)) from u returning 1)
  select count(*) into n from u;
  if n = 0 then raise exception 'Request is not waiting for a PC check'; end if;
  if p_image is not null and length(p_image) > 0 then
    delete from public.stock_shots where request_id = lead and kind = 'check';
    insert into public.stock_shots(request_id,kind,image) values(lead,'check',p_image);
  end if;
end $$;

create or replace function public.stock_final_approve(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare b uuid; lead uuid; r public.stock_requests%rowtype;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  b := public.stock_batch_of(p_id);
  if b is null then raise exception 'Only a waiting request can be approved to move'; end if;
  select id into lead from public.stock_requests where batch_id = b order by batch_pos limit 1;
  perform 1 from public.stock_requests where batch_id = b for update;
  for r in select * from public.stock_requests where batch_id = b order by batch_pos loop
    if r.status <> 'waiting' then raise exception 'Only a waiting request can be approved to move'; end if;
  end loop;
  if (select bool_and(final_approved_at is not null) from public.stock_requests where batch_id = b) then return; end if;
  if exists(select 1 from public.stock_requests where batch_id = b
      and (preview_status is distinct from 'ok' or previewed_at is null or previewed_at < now() - interval '20 minutes')) then
    raise exception 'The PC has not passed a fresh check of this request; wait for the PC check'; end if;
  if not exists(select 1 from public.stock_shots where request_id = lead and kind = 'check') then
    raise exception 'The PC check has no screenshot to review yet; wait for the PC check'; end if;
  update public.stock_requests set final_approved_by = p_actor, final_approved_at = now() where batch_id = b;
  insert into public.stock_events(request_id,actor,action) select id,p_actor,'final_approved' from public.stock_requests where batch_id = b;
end $$;

-- Only final-approved batches are claimed, and a batch of more than one item only by a PC that says it can run
-- them (p_multi). An older PC never claims one, so it can never press "Move it" for half a transfer.
drop function public.stock_claim(text);
create function public.stock_claim(p_worker text, p_multi boolean default false)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid; b uuid;
begin
  perform pg_advisory_xact_lock(729291);
  update public.stock_requests set status = 'needs_checking', finished_at = now(),
    result_message = 'Worker stopped before reporting a confirmed result. Check workplace history before further action.'
    where status = 'running' and claimed_at < now() - interval '15 minutes';
  if exists(select 1 from public.stock_requests where status = 'running') then return null; end if;
  select id, batch_id into r_id, b from public.stock_requests
    where status = 'waiting' and final_approved_at is not null and batch_pos = 0 and (p_multi or batch_size = 1)
    order by final_approved_at, id limit 1 for update skip locked;
  if r_id is null then return null; end if;
  update public.stock_requests set status = 'running', claimed_by = p_worker, claimed_at = now() where batch_id = b;
  insert into public.stock_events(request_id,actor,action) select id,p_worker,'claimed' from public.stock_requests where batch_id = b;
  return r_id;
end $$;

-- Moves the stock of every line only when the workplace success was confirmed.
create or replace function public.stock_finish(p_id uuid, p_worker text, p_status text, p_message text, p_image text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare b uuid; lead uuid; r public.stock_requests%rowtype; current_qty numeric; n int := 0;
begin
  perform pg_advisory_xact_lock(729291);
  perform public.stock_cleanup();
  if p_status not in ('completed','failed','needs_checking') then raise exception 'Invalid completion'; end if;
  b := public.stock_batch_of(p_id);
  select id into lead from public.stock_requests where batch_id = b order by batch_pos limit 1;
  for r in select * from public.stock_requests where batch_id = b order by batch_pos for update loop
    if r.status <> 'running' or r.claimed_by <> p_worker then raise exception 'Invalid completion'; end if;
    n := n + 1;
    if p_status = 'completed' then
      if r.item_id is null then raise exception 'Item was deleted; needs manual review'; end if;
      select coalesce(quantity,0) into current_qty from public.stock_balances where item_id = r.item_id and storage_name = r.from_storage;
      if coalesce(current_qty,0) < r.quantity then raise exception 'App balance changed; needs manual review'; end if;
      update public.stock_balances set quantity = quantity - r.quantity, updated_at = now()
        where item_id = r.item_id and storage_name = r.from_storage;
      insert into public.stock_balances(item_id,storage_name,quantity) values(r.item_id,r.to_storage,r.quantity)
        on conflict (item_id,storage_name) do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();
    end if;
    update public.stock_requests set status = p_status, finished_at = now(),
      result_message = left(coalesce(p_message,''),1000),
      recorded_date = case when p_status = 'completed'
        then (now() at time zone 'Asia/Baghdad')::date - case when r.record_yesterday then 1 else 0 end else null end
      where id = r.id;
    insert into public.stock_events(request_id,actor,action,details)
      values(r.id,p_worker,p_status,jsonb_build_object('message',left(coalesce(p_message,''),1000)));
  end loop;
  if n = 0 then raise exception 'Invalid completion'; end if;
  if p_image is not null and length(p_image) > 0 then
    insert into public.stock_shots(request_id,kind,image) values(lead,'result',p_image);
  end if;
end $$;

-- Manual settlement of a Needs checking batch after looking at the workplace history.
create or replace function public.stock_resolve(p_id uuid, p_actor text, p_status text, p_note text, p_recorded_date date)
returns void language plpgsql security invoker set search_path=public as $$
declare b uuid; r public.stock_requests%rowtype; current_qty numeric; earliest date; n int := 0;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_status not in ('completed','failed') or
    length(trim(coalesce(p_note,''))) < 10 then raise exception 'Resolution requires a checked result and note'; end if;
  b := public.stock_batch_of(p_id);
  for r in select * from public.stock_requests where batch_id = b order by batch_pos for update loop
    if r.status <> 'needs_checking' then raise exception 'Request is not awaiting reconciliation'; end if;
    n := n + 1;
    earliest := (r.approved_at at time zone 'Asia/Baghdad')::date - case when r.record_yesterday then 1 else 0 end;
    if p_status = 'completed' and (p_recorded_date is null or p_recorded_date < earliest or
      p_recorded_date > (now() at time zone 'Asia/Baghdad')::date) then
      raise exception 'Enter the verified workplace recorded date'; end if;
    if p_status = 'completed' then
      if r.item_id is null then raise exception 'Item was deleted; recount is needed'; end if;
      select coalesce(quantity,0) into current_qty from public.stock_balances where item_id = r.item_id and storage_name = r.from_storage;
      if coalesce(current_qty,0) < r.quantity then raise exception 'App balance changed; recount is needed'; end if;
      update public.stock_balances set quantity = quantity - r.quantity, updated_at = now()
        where item_id = r.item_id and storage_name = r.from_storage;
      insert into public.stock_balances(item_id,storage_name,quantity) values(r.item_id,r.to_storage,r.quantity)
        on conflict (item_id,storage_name) do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();
    end if;
    update public.stock_requests set status = p_status, finished_at = now(),
      recorded_date = case when p_status = 'completed' then p_recorded_date else null end,
      result_message = 'Manually reconciled by ' || p_actor || ': ' || left(trim(p_note),900)
      where id = r.id;
    insert into public.stock_events(request_id,actor,action,details)
      values(r.id,p_actor,'manual_' || p_status,jsonb_build_object('note',left(trim(p_note),900),'recorded_date',p_recorded_date));
  end loop;
  if n = 0 then raise exception 'Request is not awaiting reconciliation'; end if;
end $$;

-- The PC's "is there anything for me?" question. A PC that cannot run multi-item batches (p_multi false) is never
-- told about one, so it cannot spin on work it will not claim.
drop function public.stock_worker_has_work(boolean);
create function public.stock_worker_has_work(p_live boolean default true, p_multi boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from public.stock_requests where status = 'waiting' and batch_pos = 0 and (p_multi or batch_size = 1)
           and ((p_live and final_approved_at is not null)
                or (final_approved_at is null and (previewed_at is null or previewed_at < now() - interval '10 minutes'))))
    or (p_live and exists(select 1 from public.stock_requests where status = 'running' and claimed_at < now() - interval '15 minutes'))
    or exists(select 1 from public.stock_receipts where status = 'waiting'
              or (status = 'preparing' and claimed_at < now() - interval '10 minutes'))
    or exists(select 1 from public.stock_item_jobs where status = 'waiting'
              or (status = 'preparing' and claimed_at < now() - interval '10 minutes'))
    or exists(select 1 from public.stock_worker_control where id = 1 and signin_requested_at is not null
              and (signin_checked_at is null or signin_checked_at < signin_requested_at));
$$;

do $$ declare f text; begin
  foreach f in array array[
    'stock_batch_of(uuid)',
    'stock_submit(uuid,text,text,boolean,text,text,numeric,text,text,text,uuid,smallint,smallint)',
    'stock_submit_batch(uuid,text,text,boolean,text,jsonb)',
    'stock_cancel(uuid,text)','stock_preview_report(uuid,text,boolean,text,text)','stock_final_approve(uuid,text)',
    'stock_claim(text,boolean)','stock_finish(uuid,text,text,text,text)','stock_resolve(uuid,text,text,text,date)',
    'stock_worker_has_work(boolean,boolean)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',f);
    execute format('grant execute on function public.%s to service_role',f);
  end loop;
end $$;
