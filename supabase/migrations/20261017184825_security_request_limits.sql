-- Shared, atomic limits: restarting an Edge isolate or changing device IDs cannot reset them.
create table public.app_request_limits (
  bucket text primary key check (length(bucket) between 1 and 180),
  hits integer not null check (hits > 0),
  reset_at timestamptz not null
);
alter table public.app_request_limits enable row level security;
revoke all on public.app_request_limits from public, anon, authenticated;
grant all on public.app_request_limits to service_role;

create function public.app_internal_reserve_requests(p_keys text[], p_limits integer[], p_seconds integer default 60)
returns boolean language plpgsql set search_path = '' as $$
declare n integer; used integer;
begin
  if coalesce(array_length(p_keys,1),0) not between 1 and 3 or array_length(p_keys,1) <> array_length(p_limits,1)
    or p_seconds not between 1 and 3600 then raise exception 'Invalid request limit'; end if;
  -- All callers use this lock, so limits remain accurate under concurrent requests.
  perform pg_advisory_xact_lock(729294);
  delete from public.app_request_limits where reset_at < now() - interval '1 hour';
  for n in 1..array_length(p_keys,1) loop
    if p_keys[n] is null or length(p_keys[n]) not between 1 and 180 or p_limits[n] is null or p_limits[n] < 1 then
      raise exception 'Invalid request limit'; end if;
    insert into public.app_request_limits as r(bucket,hits,reset_at)
      values(p_keys[n],1,now()+make_interval(secs=>p_seconds))
      on conflict(bucket) do update set
        hits=case when r.reset_at <= now() then 1 else r.hits+1 end,
        reset_at=case when r.reset_at <= now() then excluded.reset_at else r.reset_at end
      where r.reset_at <= now() or r.hits < p_limits[n]
      returning hits into used;
    if not found then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.app_internal_reserve_requests(text[],integer[],integer) from public,anon,authenticated;
grant execute on function public.app_internal_reserve_requests(text[],integer[],integer) to service_role;
