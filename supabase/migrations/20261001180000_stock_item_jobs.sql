-- Creating and editing ingredients in the workplace system from the app, with the same two-step safety
-- as receipts: approve -> the PC fills the form and sends a screenshot -> final approval -> the PC
-- re-checks every field and presses Save once -> only the exact success message counts as done.
-- The workplace also needs each item's recipe (usage) unit and how many recipe units are in one counting unit.
alter table public.stock_item_settings
  add column usage_unit text references public.app_units(id),
  add column per_counting_usage numeric(20,8) check (per_counting_usage is null or (per_counting_usage > 0 and per_counting_usage <= 100000000)),
  -- the item's name as last confirmed in the workplace (by a create or edit job); null = assumed same as workplace_name
  add column workplace_confirmed_name text check (workplace_confirmed_name is null or length(workplace_confirmed_name) <= 240),
  add column workplace_created_at timestamptz;
create index if not exists stock_item_settings_usage_idx on public.stock_item_settings(usage_unit);

create function public.stock_save_workplace_units(p_item text, p_actor text, p_usage text, p_per_usage numeric)
returns void language plpgsql security invoker set search_path=public as $$
declare s public.stock_item_settings%rowtype;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  select * into s from public.stock_item_settings where item_id = p_item;
  if s.item_id is null then raise exception 'Set up the counting format first'; end if;
  if p_usage is not null and not exists(select 1 from public.app_units where id = p_usage) then raise exception 'Unknown recipe unit'; end if;
  if p_usage is not null and p_usage <> s.counting_unit and not (coalesce(p_per_usage, 0) > 0) then
    raise exception 'Enter how many recipe units are in one counting unit'; end if;
  update public.stock_item_settings set usage_unit = p_usage,
      per_counting_usage = case when p_usage is null or p_usage = s.counting_unit then null else p_per_usage end
    where item_id = p_item;
end $$;

create table public.stock_item_jobs (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  item_id text references public.app_items(id) on delete set null,
  item_name text not null,
  kind text not null check (kind in ('create','edit')),
  payload jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','preparing','prepared','submitting','completed','needs_checking','failed','cancelled')),
  message text check (message is null or length(message) <= 1000),
  shot text check (shot is null or length(shot) <= 700000),
  created_by text not null check (created_by in ('rozha','yunis')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz, prepared_at timestamptz,
  final_approved_at timestamptz, final_approved_by text check (final_approved_by is null or final_approved_by in ('rozha','yunis')),
  finished_at timestamptz,
  resolved_by text check (resolved_by is null or resolved_by in ('rozha','yunis')),
  resolved_note text check (resolved_note is null or length(resolved_note) <= 900)
);
create index stock_item_jobs_status on public.stock_item_jobs(status, created_at);
create index stock_item_jobs_item on public.stock_item_jobs(item_id);
alter table public.stock_item_jobs enable row level security;

-- What a confirmed job means for the app: the item now exists in the workplace under payload->>'name'.
create function public.stock_item_job_apply(p_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare j public.stock_item_jobs%rowtype;
begin
  select * into j from public.stock_item_jobs where id = p_id;
  if j.item_id is null then return; end if;
  update public.stock_item_settings set workplace_confirmed_name = j.payload->>'name',
      workplace_created_at = case when j.kind = 'create' then coalesce(workplace_created_at, now()) else workplace_created_at end
    where item_id = j.item_id;
  insert into public.stock_events(actor, action, details)
    values('office-pc', 'item_' || j.kind || 'd_in_workplace', jsonb_build_object('job_id', p_id, 'item_id', j.item_id, 'name', j.payload->>'name'));
end $$;

create function public.stock_item_job_final_approve(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare j public.stock_item_jobs%rowtype;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  select * into j from public.stock_item_jobs where id = p_id for update;
  if j.id is null or j.status <> 'prepared' then raise exception 'This task is not waiting for a final approval'; end if;
  if j.shot is null then raise exception 'Wait for the PC screenshot first'; end if;
  if j.prepared_at < now() - interval '20 minutes' then raise exception 'The PC check is older than 20 minutes. Cancel it and send it again'; end if;
  if j.final_approved_at is not null then return; end if;
  update public.stock_item_jobs set final_approved_at = now(), final_approved_by = p_actor where id = p_id;
end $$;

create function public.stock_item_job_claim_submit(p_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  update public.stock_item_jobs set status = 'submitting'
    where id = p_id and status = 'prepared' and final_approved_at is not null and final_approved_at > now() - interval '30 minutes';
  return found;
end $$;

create function public.stock_item_job_finish(p_id uuid, p_status text, p_message text, p_image text)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_status not in ('completed','needs_checking','failed') then raise exception 'Invalid status'; end if;
  update public.stock_item_jobs set status = p_status, message = left(p_message, 1000), finished_at = now(), shot = coalesce(p_image, shot)
    where id = p_id and status = 'submitting';
  if not found then raise exception 'Task is not being saved'; end if;
  if p_status = 'completed' then perform public.stock_item_job_apply(p_id); end if;
end $$;

create function public.stock_item_job_resolve(p_id uuid, p_actor text, p_saved boolean, p_note text)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_saved is null or length(trim(coalesce(p_note,''))) < 10 then
    raise exception 'Check the workplace and write a note of at least 10 characters'; end if;
  update public.stock_item_jobs set status = case when p_saved then 'completed' else 'failed' end,
      resolved_by = p_actor, resolved_note = left(p_note, 900), finished_at = coalesce(finished_at, now())
    where id = p_id and status = 'needs_checking';
  if not found then raise exception 'This task does not need checking'; end if;
  if p_saved then perform public.stock_item_job_apply(p_id); end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['stock_save_workplace_units(text,text,text,numeric)','stock_item_job_apply(uuid)','stock_item_job_final_approve(uuid,text)',
    'stock_item_job_claim_submit(uuid)','stock_item_job_finish(uuid,text,text,text)','stock_item_job_resolve(uuid,text,boolean,text)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',f);
    execute format('grant execute on function public.%s to service_role',f);
  end loop;
end $$;
