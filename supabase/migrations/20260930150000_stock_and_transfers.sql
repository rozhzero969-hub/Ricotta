-- Stock ledger and storage-to-storage transfers, built on Ricotta's own items.
--
-- Additive only: nothing here changes app_items, app_units or any order table.
-- An item's BUYING format is the unit it already has (app_items.unit_id, what
-- orders use). Its COUNTING format is what stock is counted and transferred in.
-- When the two differ, per_buying says how many counting units one buying unit
-- holds (1 box = 12 piece). Stock quantities are always in counting units.
--
-- All access goes through the stock-api Edge Function (service role); browser
-- roles have no table or function access.
create table public.stock_storages (
  name text primary key,
  sort_order integer not null unique
);
insert into public.stock_storages(name,sort_order) values
('Main Storage',1),('Breakfast',2),('Appetizers',3),('Minibar',4),
('Kentucky',5),('Al Gharbiyah',6),('Al Sharqiyah',7),('Kebab',8),
('Grilled Foods',9),('Pizza',10),('Cleaner',11),('Bakery',12),
('Teahouse',13),('نانی بەیانی (Breakfast)',14);

create table public.stock_workers (
  id text primary key,
  token_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
-- The office PC's existing credential (a hash only) carries over so it needs no new token.
do $$ begin
  if to_regclass('public.transfer_workers') is not null then
    insert into public.stock_workers(id,token_hash,enabled)
      select id,token_hash,enabled from public.transfer_workers on conflict do nothing;
  end if;
end $$;

-- One row per item that has been set up for stock. An item without a row cannot be counted or transferred.
create table public.stock_item_settings (
  item_id text primary key references public.app_items(id) on delete cascade,
  counting_unit text not null references public.app_units(id),
  per_buying numeric(20,8) check (per_buying is null or (per_buying > 0 and per_buying <= 100000000)),
  low_stock numeric(20,6) check (low_stock is null or low_stock >= 0),
  updated_by text check (updated_by in ('rozha','yunis')),
  updated_at timestamptz not null default now()
);

create table public.stock_balances (
  item_id text not null references public.app_items(id) on delete cascade,
  storage_name text not null references public.stock_storages(name),
  quantity numeric(20,8) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, storage_name)
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  item_id text references public.app_items(id) on delete set null,
  item_name text not null,
  storage_name text not null references public.stock_storages(name),
  unit_label text not null,
  quantity numeric(20,8) not null check (quantity >= 0),
  prior_quantity numeric(20,8) not null,
  entered_by text not null check (entered_by in ('rozha','yunis')),
  counted_at timestamptz not null,
  entered_at timestamptz not null default now(),
  note text
);
create index stock_counts_recent on public.stock_counts(entered_at desc);

-- A transfer request always carries exactly one item, so the workplace form can
-- never succeed partway. item_name and unit_label are what the PC must find
-- on the workplace page, frozen at approval.
create table public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  item_id text references public.app_items(id) on delete set null,
  item_name text not null,
  unit_label text not null,
  quantity numeric(20,8) not null check (quantity > 0),
  from_storage text not null references public.stock_storages(name),
  to_storage text not null references public.stock_storages(name),
  record_yesterday boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting','running','completed','failed','needs_checking')),
  approved_by text not null check (approved_by in ('rozha','yunis')),
  approved_at timestamptz not null default now(),
  preview_status text check (preview_status in ('ok','failed')),
  preview_message text,
  previewed_at timestamptz,
  final_approved_by text check (final_approved_by in ('rozha','yunis')),
  final_approved_at timestamptz,
  claimed_by text references public.stock_workers(id),
  claimed_at timestamptz,
  finished_at timestamptz,
  result_message text,
  recorded_date date,
  check (from_storage <> to_storage)
);
create index stock_requests_queue on public.stock_requests(status, approved_at);

-- Screenshots of the workplace form, kept for 3 days only.
create table public.stock_shots (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.stock_requests(id) on delete cascade,
  kind text not null check (kind in ('check','result')),
  image text not null check (length(image) <= 700000),
  taken_at timestamptz not null default now()
);
create index stock_shots_request on public.stock_shots(request_id, kind, taken_at desc);

create table public.stock_events (
  id bigint generated always as identity primary key,
  request_id uuid references public.stock_requests(id) on delete set null,
  actor text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['storages','workers','item_settings','balances','counts','requests','shots','events'] loop
    execute format('alter table public.stock_%I enable row level security',t);
    execute format('revoke all on public.stock_%I from anon,authenticated',t);
    execute format('grant all on public.stock_%I to service_role',t);
  end loop;
end $$;

-- One advisory lock serializes every stock change, so balance and reservation checks are atomic.
create function public.stock_reserved(p_item text, p_storage text)
returns numeric language sql stable security invoker set search_path=public as $$
  select coalesce(sum(quantity),0) from public.stock_requests
  where item_id = p_item and from_storage = p_storage and status in ('waiting','running','needs_checking')
$$;

create function public.stock_cleanup()
returns void language sql security invoker set search_path=public as $$
  delete from public.stock_shots where taken_at < now() - interval '3 days'
$$;

create function public.stock_unit_label(p_unit text)
returns text language sql stable security invoker set search_path=public as $$
  select en from public.app_units where id = p_unit
$$;

-- Set up (or edit) how an item is counted. Stock is stored in counting units,
-- so the counting format cannot change while stock or open requests exist.
create function public.stock_save_settings(p_item text, p_actor text, p_counting text, p_per numeric, p_low numeric)
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
  insert into public.stock_item_settings(item_id,counting_unit,per_buying,low_stock,updated_by,updated_at)
    values(p_item,p_counting,case when p_counting = it.unit_id then null else p_per end,p_low,p_actor,now())
    on conflict (item_id) do update set counting_unit = excluded.counting_unit, per_buying = excluded.per_buying,
      low_stock = excluded.low_stock, updated_by = excluded.updated_by, updated_at = now();
  insert into public.stock_events(actor,action,details)
    values(p_actor, case when had then 'settings_edited' else 'settings_created' end,
      jsonb_build_object('item_id',p_item,'item_name',it.name));
end $$;

create function public.stock_recount(p_item text, p_storage text, p_qty numeric, p_counted_at timestamptz, p_actor text, p_note text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare it public.app_items%rowtype; s public.stock_item_settings%rowtype; prior numeric; c_id uuid;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_qty is null or p_qty < 0 or p_qty > 100000000 or scale(p_qty) > 6 or
    p_counted_at is null or p_counted_at > now() + interval '5 minutes' or
    not exists(select 1 from public.stock_storages where name = p_storage) then raise exception 'Invalid recount'; end if;
  select * into it from public.app_items where id = p_item;
  select * into s from public.stock_item_settings where item_id = p_item;
  if it.id is null or s.item_id is null then raise exception 'Set up this item''s counting format first'; end if;
  if exists(select 1 from public.stock_requests
    where item_id = p_item and status in ('waiting','running','needs_checking') and (from_storage = p_storage or to_storage = p_storage)) then
    raise exception 'Resolve the pending transfer for this item before recounting'; end if;
  select coalesce(quantity,0) into prior from public.stock_balances where item_id = p_item and storage_name = p_storage;
  prior := coalesce(prior,0);
  insert into public.stock_counts(item_id,item_name,storage_name,unit_label,quantity,prior_quantity,entered_by,counted_at,note)
    values(p_item,it.name,p_storage,coalesce(public.stock_unit_label(s.counting_unit),''),p_qty,prior,p_actor,p_counted_at,left(coalesce(p_note,''),500))
    returning id into c_id;
  insert into public.stock_balances(item_id,storage_name,quantity) values(p_item,p_storage,p_qty)
    on conflict (item_id,storage_name) do update set quantity = excluded.quantity, updated_at = now();
  return c_id;
end $$;

-- Approval: idempotent on the client key, exact name and unit must match what was reviewed.
create function public.stock_submit(p_key uuid, p_from text, p_to text, p_yesterday boolean, p_actor text,
  p_item text, p_qty numeric, p_expected_name text, p_expected_unit text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid; it public.app_items%rowtype; s public.stock_item_settings%rowtype; label text; available numeric;
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
  label := public.stock_unit_label(s.counting_unit);
  if label is null or length(trim(it.name)) = 0 then raise exception 'Item is unavailable'; end if;
  if p_expected_name is distinct from it.name or p_expected_unit is distinct from label then
    raise exception 'Catalog changed; review the request again'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 or scale(p_qty) > 6 then raise exception 'Invalid quantity'; end if;
  select coalesce(quantity,0) into available from public.stock_balances where item_id = p_item and storage_name = p_from;
  available := coalesce(available,0);
  if p_qty + public.stock_reserved(p_item,p_from) > available then
    raise exception 'Insufficient unreserved app stock for %', it.name; end if;
  insert into public.stock_requests(client_key,item_id,item_name,unit_label,quantity,from_storage,to_storage,record_yesterday,approved_by)
    values(p_key,p_item,it.name,label,p_qty,p_from,p_to,coalesce(p_yesterday,false),p_actor) returning id into r_id;
  insert into public.stock_events(request_id,actor,action) values(r_id,p_actor,'approved');
  return r_id;
end $$;

create function public.stock_cancel(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  update public.stock_requests set status = 'failed', finished_at = now(),
    result_message = 'Cancelled by ' || p_actor || ' before the PC started it.'
    where id = p_id and status = 'waiting';
  if not found then raise exception 'Only a waiting request can be cancelled'; end if;
  insert into public.stock_events(request_id,actor,action) values(p_id,p_actor,'cancelled');
end $$;

-- The PC reports its check (and a screenshot of the filled form) for a waiting, not yet finally approved request.
create function public.stock_preview_report(p_id uuid, p_worker text, p_ok boolean, p_message text, p_image text default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  perform public.stock_cleanup();
  update public.stock_requests set preview_status = case when p_ok then 'ok' else 'failed' end,
    preview_message = left(coalesce(p_message,''),500), previewed_at = now()
    where id = p_id and status = 'waiting' and final_approved_at is null;
  if not found then raise exception 'Request is not waiting for a PC check'; end if;
  if p_image is not null and length(p_image) > 0 then
    delete from public.stock_shots where request_id = p_id and kind = 'check';
    insert into public.stock_shots(request_id,kind,image) values(p_id,'check',p_image);
  end if;
  insert into public.stock_events(request_id,actor,action,details)
    values(p_id,p_worker,case when p_ok then 'preview_ok' else 'preview_failed' end,
      jsonb_build_object('message',left(coalesce(p_message,''),500)));
end $$;

-- Final approval needs a fresh passing check that came with a screenshot.
create function public.stock_final_approve(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.stock_requests%rowtype;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  select * into r from public.stock_requests where id = p_id for update;
  if not found or r.status <> 'waiting' then raise exception 'Only a waiting request can be approved to move'; end if;
  if r.final_approved_at is not null then return; end if;
  if r.preview_status is distinct from 'ok' or r.previewed_at is null or r.previewed_at < now() - interval '20 minutes' then
    raise exception 'The PC has not passed a fresh check of this request; wait for the PC check'; end if;
  if not exists(select 1 from public.stock_shots where request_id = p_id and kind = 'check') then
    raise exception 'The PC check has no screenshot to review yet; wait for the PC check'; end if;
  update public.stock_requests set final_approved_by = p_actor, final_approved_at = now() where id = p_id;
  insert into public.stock_events(request_id,actor,action) values(p_id,p_actor,'final_approved');
end $$;

-- Only final-approved requests are claimed. A worker that vanished mid-request leaves it Needs checking.
create function public.stock_claim(p_worker text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid;
begin
  perform pg_advisory_xact_lock(729291);
  update public.stock_requests set status = 'needs_checking', finished_at = now(),
    result_message = 'Worker stopped before reporting a confirmed result. Check workplace history before further action.'
    where status = 'running' and claimed_at < now() - interval '15 minutes';
  if exists(select 1 from public.stock_requests where status = 'running') then return null; end if;
  select id into r_id from public.stock_requests where status = 'waiting' and final_approved_at is not null
    order by final_approved_at, id limit 1 for update skip locked;
  if r_id is null then return null; end if;
  update public.stock_requests set status = 'running', claimed_by = p_worker, claimed_at = now() where id = r_id;
  insert into public.stock_events(request_id,actor,action) values(r_id,p_worker,'claimed');
  return r_id;
end $$;

-- Moves the stock only when the workplace success was confirmed.
create function public.stock_finish(p_id uuid, p_worker text, p_status text, p_message text, p_image text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.stock_requests%rowtype; current_qty numeric;
begin
  perform pg_advisory_xact_lock(729291);
  perform public.stock_cleanup();
  select * into r from public.stock_requests where id = p_id for update;
  if not found or r.status <> 'running' or r.claimed_by <> p_worker or
    p_status not in ('completed','failed','needs_checking') then raise exception 'Invalid completion'; end if;
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
    where id = p_id;
  if p_image is not null and length(p_image) > 0 then
    insert into public.stock_shots(request_id,kind,image) values(p_id,'result',p_image);
  end if;
  insert into public.stock_events(request_id,actor,action,details)
    values(p_id,p_worker,p_status,jsonb_build_object('message',left(coalesce(p_message,''),1000)));
end $$;

-- Manual settlement of a Needs checking request after looking at the workplace history.
create function public.stock_resolve(p_id uuid, p_actor text, p_status text, p_note text, p_recorded_date date)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.stock_requests%rowtype; current_qty numeric; earliest date;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_status not in ('completed','failed') or
    length(trim(coalesce(p_note,''))) < 10 then raise exception 'Resolution requires a checked result and note'; end if;
  select * into r from public.stock_requests where id = p_id for update;
  if not found or r.status <> 'needs_checking' then raise exception 'Request is not awaiting reconciliation'; end if;
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
    where id = p_id;
  insert into public.stock_events(request_id,actor,action,details)
    values(p_id,p_actor,'manual_' || p_status,jsonb_build_object('note',left(trim(p_note),900),'recorded_date',p_recorded_date));
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'stock_reserved(text,text)','stock_cleanup()','stock_unit_label(text)',
    'stock_save_settings(text,text,text,numeric,numeric)','stock_recount(text,text,numeric,timestamptz,text,text)',
    'stock_submit(uuid,text,text,boolean,text,text,numeric,text,text)','stock_cancel(uuid,text)',
    'stock_preview_report(uuid,text,boolean,text,text)','stock_final_approve(uuid,text)','stock_claim(text)',
    'stock_finish(uuid,text,text,text,text)','stock_resolve(uuid,text,text,text,date)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',f);
    execute format('grant execute on function public.%s to service_role',f);
  end loop;
end $$;
