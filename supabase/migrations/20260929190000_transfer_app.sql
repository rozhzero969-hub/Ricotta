-- Independent inventory transfer ledger. Browser roles have no table or RPC access.
create table public.transfer_storages (
  name text primary key,
  sort_order integer not null unique
);
insert into public.transfer_storages(name,sort_order) values
('Main Storage',1),('Breakfast',2),('Appetizers',3),('Minibar',4),
('Kentucky',5),('Al Gharbiyah',6),('Al Sharqiyah',7),('Kebab',8),
('Grilled Foods',9),('Pizza',10),('Cleaner',11),('Bakery',12),
('Teahouse',13),('نانی بەیانی (Breakfast)',14);

create table public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  exact_name text not null check (length(trim(exact_name)) between 1 and 240),
  counting_unit text not null check (length(trim(counting_unit)) between 1 and 80),
  usage_unit text,
  buying_unit text,
  pdf_usage_total numeric(20,6),
  low_stock numeric(20,6) check (low_stock >= 0),
  match_verified boolean not null default false,
  needs_review boolean not null default true,
  archived_at timestamptz,
  source_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transfer_items_search on public.transfer_items(lower(exact_name));

-- One counting unit per item has factor 1. Other factors stay null until verified.
create table public.transfer_units (
  item_id uuid not null references public.transfer_items(id),
  unit text not null check (length(trim(unit)) between 1 and 80),
  count_per_unit numeric(20,8) check (count_per_unit > 0),
  verified boolean not null default false,
  primary key(item_id,unit),
  check (not verified or count_per_unit is not null)
);
create table public.transfer_balances (
  item_id uuid not null references public.transfer_items(id),
  storage_name text not null references public.transfer_storages(name),
  quantity numeric(20,8) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key(item_id,storage_name)
);
create table public.transfer_workers (
  id text primary key,
  token_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  from_storage text not null references public.transfer_storages(name),
  to_storage text not null references public.transfer_storages(name),
  record_yesterday boolean not null default false,
  status text not null default 'waiting' check(status in ('waiting','running','completed','failed','needs_checking')),
  approved_by text not null check(approved_by in ('rozha','yunis')),
  approved_at timestamptz not null default now(),
  claimed_by text references public.transfer_workers(id),
  claimed_at timestamptz,
  finished_at timestamptz,
  result_message text,
  check(from_storage <> to_storage)
);
create index transfer_requests_queue on public.transfer_requests(status,approved_at);
create table public.transfer_lines (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.transfer_requests(id),
  item_id uuid not null references public.transfer_items(id),
  exact_name text not null,
  unit text not null,
  quantity numeric(20,8) not null check(quantity > 0),
  count_per_unit numeric(20,8) not null check(count_per_unit > 0),
  result_message text,
  unique(request_id,item_id,unit)
);
create index transfer_lines_item on public.transfer_lines(item_id,request_id);
create table public.transfer_counts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.transfer_items(id),
  storage_name text not null references public.transfer_storages(name),
  unit text not null,
  quantity numeric(20,8) not null check(quantity >= 0),
  count_per_unit numeric(20,8) not null check(count_per_unit > 0),
  prior_quantity numeric(20,8) not null,
  entered_by text not null check(entered_by in ('rozha','yunis')),
  counted_at timestamptz not null,
  entered_at timestamptz not null default now(),
  note text
);
create table public.transfer_events (
  id bigint generated always as identity primary key,
  request_id uuid references public.transfer_requests(id),
  actor text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['storages','items','units','balances','workers','requests','lines','counts','events'] loop
    execute format('alter table public.transfer_%I enable row level security',t);
    execute format('revoke all on public.transfer_%I from anon,authenticated',t);
  end loop;
end $$;

-- Serialize approvals/counts/finalization to make balance and reservation checks atomic.
create function public.transfer_submit(p_key uuid,p_from text,p_to text,p_yesterday boolean,p_actor text,p_lines jsonb)
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

create function public.transfer_claim(p_worker text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r_id uuid;
begin
  perform pg_advisory_xact_lock(729291);
  update public.transfer_requests set status='needs_checking', finished_at=now(),
    result_message='Worker stopped before reporting a confirmed result. Check workplace history before further action.'
    where status='running' and claimed_at<now()-interval '15 minutes';
  if exists(select 1 from public.transfer_requests where status='running') then return null; end if;
  select id into r_id from public.transfer_requests where status='waiting' order by approved_at,id limit 1 for update skip locked;
  if r_id is null then return null; end if;
  update public.transfer_requests set status='running',claimed_by=p_worker,claimed_at=now() where id=r_id;
  insert into public.transfer_events(request_id,actor,action) values(r_id,p_worker,'claimed');
  return r_id;
end $$;

create function public.transfer_finish(p_id uuid,p_worker text,p_status text,p_message text,p_line_results jsonb default '[]'::jsonb)
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

create function public.transfer_recount(p_item uuid,p_storage text,p_unit text,p_quantity numeric,p_counted_at timestamptz,p_actor text,p_note text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare u public.transfer_units%rowtype; prior numeric; c_id uuid;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_quantity<0 or p_quantity>100000000 or scale(p_quantity)>6 or
    p_counted_at is null or p_counted_at>now()+interval '5 minutes' or
    not exists(select 1 from public.transfer_storages where name=p_storage) then raise exception 'Invalid recount'; end if;
  select * into u from public.transfer_units where item_id=p_item and unit=p_unit and verified;
  if not found then raise exception 'Unverified recount unit'; end if;
  if exists(select 1 from public.transfer_lines l join public.transfer_requests r on r.id=l.request_id
    where l.item_id=p_item and r.from_storage=p_storage and r.status in ('waiting','running','needs_checking')) or
    exists(select 1 from public.transfer_lines l join public.transfer_requests r on r.id=l.request_id
    where l.item_id=p_item and r.to_storage=p_storage and r.status in ('waiting','running','needs_checking')) then
    raise exception 'Resolve pending transfer before recount';
  end if;
  select coalesce(quantity,0) into prior from public.transfer_balances where item_id=p_item and storage_name=p_storage;
  prior:=coalesce(prior,0);
  insert into public.transfer_counts(item_id,storage_name,unit,quantity,count_per_unit,prior_quantity,entered_by,counted_at,note)
    values(p_item,p_storage,p_unit,p_quantity,u.count_per_unit,prior,p_actor,p_counted_at,left(coalesce(p_note,''),500)) returning id into c_id;
  insert into public.transfer_balances(item_id,storage_name,quantity) values(p_item,p_storage,p_quantity*u.count_per_unit)
    on conflict(item_id,storage_name) do update set quantity=excluded.quantity,updated_at=now();
  return c_id;
end $$;

revoke all on function public.transfer_submit(uuid,text,text,boolean,text,jsonb) from public,anon,authenticated;
revoke all on function public.transfer_claim(text) from public,anon,authenticated;
revoke all on function public.transfer_finish(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.transfer_recount(uuid,text,text,numeric,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.transfer_submit(uuid,text,text,boolean,text,jsonb) to service_role;
grant execute on function public.transfer_claim(text) to service_role;
grant execute on function public.transfer_finish(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.transfer_recount(uuid,text,text,numeric,timestamptz,text,text) to service_role;

-- One-time private PDF import. The JSON is supplied from an ignored local file;
-- the public repository contains this importer, never the restaurant stock data.
create function public.transfer_seed(p_document jsonb)
returns integer language plpgsql security invoker set search_path=public as $$
declare row jsonb; item_id uuid; n integer:=0; count_unit text; usage text; exact text;
begin
  perform pg_advisory_xact_lock(729291);
  if exists(select 1 from public.transfer_items) then raise exception 'Catalog already seeded'; end if;
  if p_document->>'storage'<>'Main Storage' or jsonb_array_length(p_document->'items')<>342 then
    raise exception 'Unexpected PDF import'; end if;
  for row in select value from jsonb_array_elements(p_document->'items') loop
    exact:=row->>'name'; count_unit:=row->>'counting_unit'; usage:=nullif(row->>'usage_unit','');
    if exact is null or count_unit is null or (row->>'starting_quantity')::numeric<0 then
      raise exception 'Invalid item in PDF import'; end if;
    insert into public.transfer_items(exact_name,counting_unit,usage_unit,pdf_usage_total,low_stock,
      match_verified,needs_review,source_ref)
      values(exact,count_unit,usage,nullif(row->>'usage_total','')::numeric,
      nullif(row->>'warning_quantity','')::numeric,exact<>'-',exact='-',row->>'id')
      returning id into item_id;
    insert into public.transfer_units(item_id,unit,count_per_unit,verified) values(item_id,count_unit,1,true);
    if usage is not null and usage<>count_unit then
      insert into public.transfer_units(item_id,unit,count_per_unit,verified) values(item_id,usage,null,false);
    end if;
    insert into public.transfer_balances(item_id,storage_name,quantity)
      values(item_id,'Main Storage',(row->>'starting_quantity')::numeric);
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.transfer_seed(jsonb) from public,anon,authenticated;
grant execute on function public.transfer_seed(jsonb) to service_role;
