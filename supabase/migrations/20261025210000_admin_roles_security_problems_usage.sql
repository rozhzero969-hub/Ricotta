-- ROZH-22: Yunis's roles (checked by the api on every request), the sign-in and security log,
-- problem reports from every phone, time spent in the app (never reset), when each item was last
-- ordered, Rico's usage by kind, and a Health Check that reads the database itself.

-- ---------- Roles ----------
-- Rozha always has everything. For Yunis, null means the standard set (everything except
-- Transfers); Admin saves an explicit list once Rozha changes it.
alter table public.app_accounts add column if not exists roles text[];
alter table public.app_accounts add constraint app_accounts_roles_known check (roles is null or (cardinality(roles) <= 12 and
  roles <@ array['history','manage','catalog','record','transfers','assistant','send','exports','notify','reminders']::text[]));

-- ---------- The sign-in and security log ----------
create table public.app_security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('signin','new_device','wrong_pin','locked','unlocked','pin_changed','roles_changed')),
  account text check (account is null or account in ('rozha','yunis')),
  device_id text check (device_id is null or char_length(device_id) <= 200),
  device_label text check (device_label is null or char_length(device_label) <= 80),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 2000)
);
create index app_security_events_time_idx on public.app_security_events (occurred_at desc);
create index app_security_events_kind_idx on public.app_security_events (kind, occurred_at desc);
alter table public.app_security_events enable row level security;
revoke all on public.app_security_events from public, anon, authenticated;
grant all on public.app_security_events to service_role;
revoke all on sequence public.app_security_events_id_seq from public, anon, authenticated;

alter table public.app_devices add column if not exists first_login timestamptz;
update public.app_devices set first_login = coalesce(last_login, updated_at) where first_login is null;
alter table public.app_devices alter column first_login set default now();

/* One event, unless the same kind from the same device was already written within p_dedupe_seconds
   (a locked sign-in is written once per lock, not once per refused try). */
create function public.app_internal_security_event(p_kind text, p_account text, p_device text, p_label text,
  p_detail jsonb default '{}'::jsonb, p_dedupe_seconds integer default 0)
returns void language plpgsql set search_path = '' as $$
begin
  if p_dedupe_seconds > 0 and exists(select 1 from public.app_security_events where kind = p_kind
     and device_id is not distinct from left(p_device, 200) and occurred_at > now() - make_interval(secs => p_dedupe_seconds)) then return; end if;
  insert into public.app_security_events(kind, account, device_id, device_label, detail)
    values (p_kind, p_account, left(p_device, 200), left(p_label, 80), coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.app_internal_security_event(text,text,text,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.app_internal_security_event(text,text,text,text,jsonb,integer) to service_role;

/* Sign-in, as before, now also writing the log and saying whether this phone was never seen. */
create or replace function public.app_internal_start_session(p_code text, p_token_hash text, p_device text, p_label text, p_version text, p_attempt_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare matched text; account_name text; expiry timestamptz; completed integer; known boolean := true;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or (p_device is not null and length(p_device) not between 1 and 120)
    or length(p_label) > 80 or length(p_version) > 40
    or coalesce(cardinality(p_attempt_ids),0) <> 2 or p_attempt_ids[1] is null or p_attempt_ids[2] is null
    or p_attempt_ids[1] = p_attempt_ids[2] then raise exception 'Invalid session request'; end if;
  perform id from public.app_accounts order by id for update;
  matched := public.app_internal_match_code(p_code);
  if matched is null then return jsonb_build_object('error','invalid_credentials'); end if;
  update public.app_login_attempts set succeeded = true where id = any(p_attempt_ids) and not succeeded;
  get diagnostics completed = row_count;
  if completed <> 2 then raise exception 'Invalid login reservation'; end if;
  -- Client-provided device ids remain identifiers, not credentials. Serialized account locks
  -- prevent two different accounts from both claiming an unused id at the same time.
  if p_device is not null and exists(select 1 from public.app_sessions
    where device_id = p_device and account <> matched and revoked_at is null and expires_at > now()) then
    return jsonb_build_object('error','device_in_use');
  end if;
  expiry := now() + interval '18 hours';
  insert into public.app_sessions(token_hash,account,device_id,expires_at)
    values(p_token_hash,matched,p_device,expiry);
  if p_device is not null then
    known := exists(select 1 from public.app_devices where id = p_device and account is not distinct from matched);
    insert into public.app_devices as d(id,account,label,app_version,logged_in,last_login,last_seen,updated_at,first_login)
      values(p_device,matched,p_label,p_version,true,now(),now(),now(),now())
      on conflict(id) do update set account=excluded.account,label=excluded.label,
        app_version=coalesce(excluded.app_version,d.app_version),logged_in=true,
        last_login=excluded.last_login,last_seen=excluded.last_seen,updated_at=excluded.updated_at,
        first_login=case when d.account is distinct from excluded.account then now() else coalesce(d.first_login, now()) end,
        handled_command=coalesce(d.command->>'id',d.handled_command);
  end if;
  insert into public.app_security_events(kind, account, device_id, device_label)
    values ('signin', matched, p_device, left(p_label, 80));
  if not known then
    insert into public.app_security_events(kind, account, device_id, device_label)
      values ('new_device', matched, p_device, left(p_label, 80));
  end if;
  select name into account_name from public.app_accounts where id = matched;
  return jsonb_build_object('account',matched,'name',account_name,'expiresAt',expiry,'newDevice',not known);
end $$;
revoke all on function public.app_internal_start_session(text,text,text,text,text,bigint[]) from public,anon,authenticated;
grant execute on function public.app_internal_start_session(text,text,text,text,text,bigint[]) to service_role;

/* A new PIN is also written to the security log. */
create or replace function public.app_internal_set_pin(p_account text, p_pin text, p_keep_session uuid)
returns text language plpgsql security definer set search_path = 'public', 'extensions', 'pg_temp' as $$
declare keep_device text;
begin
  if p_account is null or p_account not in ('rozha', 'yunis') or p_pin is null or p_pin !~ '^[0-9]{6}$' then return 'invalid'; end if;
  perform id from public.app_accounts order by id for update;
  select device_id into keep_device from public.app_sessions
    where id = p_keep_session and account = 'rozha' and revoked_at is null and expires_at > now() for update;
  if not found then return 'forbidden'; end if;
  if exists (select 1 from public.app_accounts where id <> p_account and extensions.crypt(p_pin, pin_hash) = pin_hash) then return 'duplicate'; end if;
  update public.app_accounts set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), updated_at = now() where id = p_account;
  if not found then return 'invalid'; end if;
  update public.app_sessions set revoked_at = now() where account = p_account and revoked_at is null and id is distinct from p_keep_session;
  update public.app_devices set logged_in = false, updated_at = now() where account = p_account and logged_in and id is distinct from keep_device;
  insert into public.app_audit_events(id,actor,device_id,action,payload)
    values('audit_' || extensions.gen_random_uuid()::text,'rozha',keep_device,'change_pin',jsonb_build_object('account',p_account));
  insert into public.app_security_events(kind, account, device_id, detail)
    values ('pin_changed', 'rozha', keep_device, jsonb_build_object('for', p_account));
  return 'ok';
end $$;
revoke all on function public.app_internal_set_pin(text,text,uuid) from public,anon,authenticated;
grant execute on function public.app_internal_set_pin(text,text,uuid) to service_role;

/* Admin -> Yunis's access. Returns the saved list. */
create function public.app_internal_set_roles(p_actor text, p_account text, p_roles text[], p_device text)
returns text[] language plpgsql set search_path = '' as $$
declare before text[]; saved text[];
begin
  if p_actor is distinct from 'rozha' or p_account is distinct from 'yunis' then raise exception 'Forbidden'; end if;
  select roles into before from public.app_accounts where id = p_account for update;
  if not found then raise exception 'Unknown account'; end if;
  update public.app_accounts set roles = (select coalesce(array_agg(distinct r order by r), '{}') from unnest(p_roles) r), updated_at = now()
    where id = p_account returning roles into saved;
  insert into public.app_security_events(kind, account, device_id, detail)
    values ('roles_changed', 'rozha', p_device, jsonb_build_object('for', p_account, 'roles', to_jsonb(saved), 'before', to_jsonb(before)));
  return saved;
end $$;
revoke all on function public.app_internal_set_roles(text,text,text[],text) from public, anon, authenticated;
grant execute on function public.app_internal_set_roles(text,text,text[],text) to service_role;

/* Admin -> Security: wrong PINs in the last 24 hours, whether sign-in is locked right now and until
   when, new phones in the last 7 days and the newest 60 events. p_global is the api's fingerprint for
   the lock that counts every failed try. */
create function public.app_internal_security_summary(p_actor text, p_global text, p_window_seconds integer, p_global_limit integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare failures integer; until timestamptz;
begin
  if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
  select count(*) into failures from public.app_login_attempts
    where fingerprint_hash = p_global and not succeeded and attempted_at >= now() - make_interval(secs => p_window_seconds);
  if failures >= p_global_limit then
    select attempted_at + make_interval(secs => p_window_seconds) into until from public.app_login_attempts
      where fingerprint_hash = p_global and not succeeded and attempted_at >= now() - make_interval(secs => p_window_seconds)
      order by attempted_at desc offset p_global_limit - 1 limit 1;
  end if;
  return jsonb_build_object(
    'checkedAt', now(),
    'wrongPins24h', (select count(*) from public.app_security_events where kind = 'wrong_pin' and occurred_at > now() - interval '24 hours'),
    'signins24h', (select count(*) from public.app_security_events where kind = 'signin' and occurred_at > now() - interval '24 hours'),
    'newDevices7d', (select count(*) from public.app_security_events where kind = 'new_device' and occurred_at > now() - interval '7 days'),
    'failuresInWindow', failures, 'lockLimit', p_global_limit, 'lockedUntil', until,
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'at', e.occurred_at, 'kind', e.kind, 'account', e.account,
        'deviceId', e.device_id, 'label', e.device_label, 'detail', e.detail) order by e.occurred_at desc)
      from (select * from public.app_security_events order by occurred_at desc limit 60) e), '[]'::jsonb));
end $$;
revoke all on function public.app_internal_security_summary(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.app_internal_security_summary(text,text,integer,integer) to service_role;

/* Admin -> Security -> Unlock sign-in: the wrong tries in the window stop counting. */
create function public.app_internal_unlock_signin(p_actor text, p_window_seconds integer, p_device text)
returns integer language plpgsql set search_path = '' as $$
declare cleared integer;
begin
  if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
  update public.app_login_attempts set succeeded = true
    where not succeeded and attempted_at >= now() - make_interval(secs => p_window_seconds);
  get diagnostics cleared = row_count;
  insert into public.app_security_events(kind, account, device_id, detail) values ('unlocked', 'rozha', p_device, jsonb_build_object('cleared', cleared));
  return cleared;
end $$;
revoke all on function public.app_internal_unlock_signin(text,integer,text) from public, anon, authenticated;
grant execute on function public.app_internal_unlock_signin(text,integer,text) to service_role;

-- ---------- Problem reports from every phone ----------
-- One open row per problem (fingerprint), phone and person; a repeat only adds to its count.
create table public.app_problem_reports (
  id bigint generated always as identity primary key,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  kind text not null check (kind in ('error','rejection','console','server','manual')),
  message text not null check (char_length(message) between 1 and 500),
  source text check (source is null or char_length(source) <= 200),
  stack text check (stack is null or char_length(stack) <= 2000),
  screen text check (screen is null or char_length(screen) <= 40),
  account text not null check (account in ('rozha','yunis')),
  device_id text not null default '' check (char_length(device_id) <= 200),
  device_label text check (device_label is null or char_length(device_label) <= 80),
  app_version text check (app_version is null or app_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  count integer not null default 1 check (count between 1 and 1000000),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index app_problem_reports_open_idx on public.app_problem_reports (fingerprint, device_id, account) where resolved_at is null;
create index app_problem_reports_time_idx on public.app_problem_reports (last_at desc);
alter table public.app_problem_reports enable row level security;
revoke all on public.app_problem_reports from public, anon, authenticated;
grant all on public.app_problem_reports to service_role;
revoke all on sequence public.app_problem_reports_id_seq from public, anon, authenticated;

/* Up to 10 reports from one phone in one call. Returns how many were kept. The api has already
   checked the shapes and sizes; the table checks them again. At most 2000 problems stay open. */
create function public.app_internal_report_problems(p_reports jsonb, p_account text, p_device text, p_label text, p_version text)
returns integer language plpgsql set search_path = '' as $$
declare r record; kept integer := 0; open_count integer;
begin
  if p_account not in ('rozha','yunis') or jsonb_typeof(p_reports) <> 'array' or jsonb_array_length(p_reports) > 10 then raise exception 'Invalid report'; end if;
  select count(*) into open_count from public.app_problem_reports where resolved_at is null;
  for r in select * from jsonb_to_recordset(p_reports) as x(fingerprint text, kind text, message text, source text, stack text, screen text, count integer) loop
    insert into public.app_problem_reports as p(fingerprint, kind, message, source, stack, screen, account, device_id, device_label, app_version, count)
      select r.fingerprint, r.kind, r.message, r.source, r.stack, r.screen, p_account, coalesce(left(p_device, 200), ''), left(p_label, 80), p_version, greatest(1, least(coalesce(r.count, 1), 1000))
      where open_count < 2000 or exists(select 1 from public.app_problem_reports where fingerprint = r.fingerprint and device_id = coalesce(left(p_device, 200), '') and account = p_account and resolved_at is null)
    on conflict (fingerprint, device_id, account) where resolved_at is null do update
      set count = least(1000000, p.count + excluded.count), last_at = now(), message = excluded.message,
        source = coalesce(excluded.source, p.source), stack = coalesce(excluded.stack, p.stack), screen = coalesce(excluded.screen, p.screen),
        app_version = coalesce(excluded.app_version, p.app_version), device_label = coalesce(excluded.device_label, p.device_label);
    if found then kept := kept + 1; open_count := open_count + 1; end if;
  end loop;
  return kept;
end $$;
revoke all on function public.app_internal_report_problems(jsonb,text,text,text,text) from public, anon, authenticated;
grant execute on function public.app_internal_report_problems(jsonb,text,text,text,text) to service_role;

-- ---------- Time spent in the app ----------
-- Seconds per person, phone and Baghdad day. Nothing ever deletes these rows (not signing out,
-- not the monthly clean-up), so the totals keep adding up.
create table public.app_usage_time (
  account text not null check (account in ('rozha','yunis')),
  device_id text not null check (char_length(device_id) between 1 and 200),
  day date not null,
  seconds integer not null default 0 check (seconds between 0 and 86400),
  device_label text check (device_label is null or char_length(device_label) <= 80),
  updated_at timestamptz not null default now(),
  primary key (account, device_id, day)
);
create index app_usage_time_day_idx on public.app_usage_time (day);
alter table public.app_usage_time enable row level security;
revoke all on public.app_usage_time from public, anon, authenticated;
grant all on public.app_usage_time to service_role;

/* Adds the seconds a phone reports, but never more than the time that has really passed since that
   phone last reported (plus a little slack), so the totals can't be inflated. Returns the seconds kept. */
create function public.app_internal_add_usage(p_account text, p_device text, p_label text, p_seconds integer)
returns integer language plpgsql set search_path = '' as $$
declare credited integer := least(greatest(coalesce(p_seconds, 0), 0), 1800); last timestamptz; today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if p_account not in ('rozha','yunis') or p_device is null or length(p_device) not between 1 and 200 then raise exception 'Invalid usage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_account || ':' || p_device, 0));
  select max(updated_at) into last from public.app_usage_time where account = p_account and device_id = p_device;
  if last is not null then credited := least(credited, greatest(0, floor(extract(epoch from now() - last))::integer + 15)); end if;
  if credited <= 0 then return 0; end if;
  insert into public.app_usage_time as u(account, device_id, day, seconds, device_label, updated_at)
    values (p_account, p_device, today, least(86400, credited), left(p_label, 80), now())
    on conflict (account, device_id, day) do update set seconds = least(86400, u.seconds + excluded.seconds),
      device_label = coalesce(excluded.device_label, u.device_label), updated_at = now();
  return credited;
end $$;
revoke all on function public.app_internal_add_usage(text,text,text,integer) from public, anon, authenticated;
grant execute on function public.app_internal_add_usage(text,text,text,integer) to service_role;

/* Admin -> Time in the app: per person (today, last 7 days, this month, all time) and per phone. */
create function public.app_internal_usage_summary(p_actor text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
  return jsonb_build_object('today', today,
    'people', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'today', t, 'week', w, 'month', m, 'total', a, 'since', s) order by account)
      from (select account, sum(seconds) filter (where day = today) t, sum(seconds) filter (where day > today - 7) w,
              sum(seconds) filter (where day >= date_trunc('month', today)::date) m, sum(seconds) a, min(day) s
            from public.app_usage_time group by account) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'deviceId', device_id, 'label', label, 'today', t, 'total', a, 'lastAt', l) order by l desc)
      from (select account, device_id, (array_agg(device_label order by updated_at desc) filter (where device_label is not null))[1] label,
              sum(seconds) filter (where day = today) t, sum(seconds) a, max(updated_at) l
            from public.app_usage_time group by account, device_id order by max(updated_at) desc limit 40) d), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'rozha', r, 'yunis', y) order by day)
      from (select day, sum(seconds) filter (where account = 'rozha') r, sum(seconds) filter (where account = 'yunis') y
            from public.app_usage_time where day > today - 14 group by day) g), '[]'::jsonb));
end $$;
revoke all on function public.app_internal_usage_summary(text) from public, anon, authenticated;
grant execute on function public.app_internal_usage_summary(text) to service_role;

-- ---------- When each item was last ordered ----------
-- History only keeps the current month, so "not ordered in 30 days" needs its own date.
alter table public.app_items add column if not exists last_ordered_at timestamptz;
update public.app_items i set last_ordered_at = x.at
  from (select l.item_id, max(coalesce(o.sent_at, o.created_at)) at from public.app_order_lines l join public.app_orders o on o.id = l.order_id
        where l.item_id is not null group by l.item_id) x
  where x.item_id = i.id and (i.last_ordered_at is null or i.last_ordered_at < x.at);

create or replace function public.app_internal_save_order(p_id text, p_date timestamptz, p_account text, p_lines jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare saved_id text;
begin
  if p_id is null or length(p_id) not between 1 and 160 or
     p_date is null or p_account is null or p_account not in ('rozha','yunis') or
     p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Invalid order';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 800 then raise exception 'Invalid order lines'; end if;
  -- ON CONFLICT waits for an in-flight save with this id to commit or roll back.
  insert into public.app_orders(id,status,created_at,sent_at,created_by,sent_by)
    values(p_id,'sent',p_date,p_date,p_account,p_account)
    on conflict(id) do nothing returning id into saved_id;
  if saved_id is null then return false; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as l(item_name text, qty numeric)
      where l.item_name is null or length(l.item_name) not between 1 and 160 or
        l.qty is null or l.qty <= 0 or l.qty > 99999) then
    raise exception 'Invalid order line';
  end if;
  insert into public.app_order_lines(order_id,supplier_id,supplier_name,item_id,item_name,unit_id,qty)
    select p_id,l.supplier_id,l.supplier_name,l.item_id,l.item_name,l.unit_id,l.qty
    from jsonb_to_recordset(p_lines) as l(supplier_id text,supplier_name text,item_id text,item_name text,unit_id text,qty numeric);
  update public.app_items set last_ordered_at = p_date
    where id in (select l.item_id from jsonb_to_recordset(p_lines) as l(item_id text) where l.item_id is not null)
      and (last_ordered_at is null or last_ordered_at < p_date);
  return true;
end $$;
revoke all on function public.app_internal_save_order(text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_internal_save_order(text,timestamptz,text,jsonb) to service_role;

/* Undoing an order also takes back its "last ordered" date (to the latest order that still has the item). */
create or replace function public.app_internal_delete_order(p_id text, p_actor text, p_device text)
returns void language plpgsql set search_path = '' as $$
declare removed text; sent timestamptz; by_whom text; made timestamptz; ids text[];
begin
 if p_actor not in ('rozha','yunis') then raise exception 'Forbidden'; end if;
 select coalesce(sent_at,created_at), created_by, created_at into sent, by_whom, made from public.app_orders where id=p_id for update;
 if not found then return; end if;
 if p_actor <> 'rozha' and (by_whom is distinct from p_actor or made < now() - interval '15 minutes') then raise exception 'Forbidden'; end if;
 select array_agg(distinct item_id) into ids from public.app_order_lines where order_id = p_id and item_id is not null;
 delete from public.app_orders where id=p_id returning id into removed;
 if removed is not null then
  insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
  values(gen_random_uuid()::text,p_actor,p_device,'delete','order',p_id,jsonb_build_object('source','server'));
  perform public.app_internal_streak_unhit((sent at time zone 'Asia/Baghdad')::date);
  update public.app_items i set last_ordered_at = (select max(coalesce(o.sent_at, o.created_at)) from public.app_order_lines l
      join public.app_orders o on o.id = l.order_id where l.item_id = i.id)
    where i.id = any(coalesce(ids, '{}')) and i.last_ordered_at >= sent;
 end if;
end $$;
revoke all on function public.app_internal_delete_order(text,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_delete_order(text,text,text) to service_role;

/* Exports: this month's orders per item and per supplier (what the Excel and PDF files show). */
create function public.app_internal_catalog_report(p_from timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'from', p_from,
    'items', coalesce((select jsonb_object_agg(item_id, jsonb_build_object('orders', n, 'qty', q, 'last', l))
      from (select l.item_id, count(distinct l.order_id) n, sum(l.qty) q, max(coalesce(o.sent_at, o.created_at)) l
            from public.app_order_lines l join public.app_orders o on o.id = l.order_id
            where coalesce(o.sent_at, o.created_at) >= p_from and l.item_id is not null group by l.item_id) x), '{}'::jsonb),
    'suppliers', coalesce((select jsonb_object_agg(supplier_id, jsonb_build_object('orders', n, 'lines', k, 'last', l))
      from (select l.supplier_id, count(distinct l.order_id) n, count(*) k, max(coalesce(o.sent_at, o.created_at)) l
            from public.app_order_lines l join public.app_orders o on o.id = l.order_id
            where coalesce(o.sent_at, o.created_at) >= p_from and l.supplier_id is not null group by l.supplier_id) y), '{}'::jsonb),
    'lastOrdered', coalesce((select jsonb_object_agg(id, last_ordered_at) from public.app_items where last_ordered_at is not null), '{}'::jsonb));
$$;
revoke all on function public.app_internal_catalog_report(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_catalog_report(timestamptz) to service_role;

-- ---------- Rico's usage by kind ----------
alter table public.app_assistant_usage add column if not exists kind text not null default 'chat';
alter table public.app_assistant_usage add constraint app_assistant_usage_kind_check check (kind in ('chat','voice','transfer'));
update public.app_assistant_usage set kind = case when model like 'transcribe:%' or model = 'pending:transcribe' then 'voice'
  when model like 'transfer:%' or model = 'pending:transfer' then 'transfer' else 'chat' end;

create or replace function public.app_internal_reserve_assistant(p_device_id text, p_account text, p_model text, p_device_limit integer, p_total_limit integer)
returns bigint language plpgsql set search_path = '' as $$
declare reservation bigint;
begin
  if p_device_id is null or length(p_device_id) not between 1 and 200 or
     p_account is null or p_account not in ('rozha','yunis') or
     p_device_limit is null or p_device_limit < 1 or p_total_limit is null or p_total_limit < 1 then
    raise exception 'Invalid assistant reservation';
  end if;
  -- Serialize quota checks and reserve BEFORE provider work starts.
  perform pg_advisory_xact_lock(729292);
  if (select count(*) from public.app_assistant_usage where created_at > now()-interval '1 hour') >= p_total_limit or
     (select count(*) from public.app_assistant_usage where device_id=p_device_id and created_at > now()-interval '1 hour') >= p_device_limit then
    return null;
  end if;
  insert into public.app_assistant_usage(device_id,account,model,kind)
    values(p_device_id,p_account,p_model,case p_model when 'pending:transcribe' then 'voice' when 'pending:transfer' then 'transfer' else 'chat' end)
    returning id into reservation;
  return reservation;
end $$;
revoke all on function public.app_internal_reserve_assistant(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.app_internal_reserve_assistant(text,text,text,integer,integer) to service_role;

/* Admin -> Rico: this month by kind and person, tokens per model (the api prices them), this hour
   against the hourly limit, and the last 14 days. */
create function public.app_internal_rico_usage(p_actor text, p_from timestamptz)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
  return jsonb_build_object(
    'from', p_from,
    'thisHour', (select count(*) from public.app_assistant_usage where created_at > now() - interval '1 hour'),
    'kinds', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.app_assistant_usage where created_at >= p_from group by kind) k), '{}'::jsonb),
    'people', coalesce((select jsonb_object_agg(coalesce(account, 'unknown'), n) from (select account, count(*) n from public.app_assistant_usage where created_at >= p_from group by account) p), '{}'::jsonb),
    'models', coalesce((select jsonb_agg(jsonb_build_object('model', model, 'calls', n, 'input', i, 'output', o))
      from (select model, count(*) n, sum(input_tokens) i, sum(output_tokens) o from public.app_assistant_usage where created_at >= p_from group by model) m), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'calls', n) order by d)
      from (select (created_at at time zone 'Asia/Baghdad')::date d, count(*) n from public.app_assistant_usage
            where created_at > now() - interval '14 days' group by 1) x), '[]'::jsonb));
end $$;
revoke all on function public.app_internal_rico_usage(text,timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_rico_usage(text,timestamptz) to service_role;

-- ---------- Health Check, read from the database ----------
create or replace function public.app_internal_diagnostics(p_actor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare jobs jsonb := '[]'::jsonb; size bigint; month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad';
begin
 if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
 if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('name',j.jobname,'active',j.active,
   'lastRun',r.end_time,'lastStatus',r.status,'failures24h',(select count(*) from cron.job_run_details f where f.jobid=j.jobid and f.start_time>now()-interval '24 hours' and f.status='failed')) order by j.jobname),'[]'::jsonb)
   from cron.job j left join lateral(select end_time,status from cron.job_run_details where jobid=j.jobid order by start_time desc limit 1) r on true
   where j.jobname in ('ricotta-reminder-tick','ricotta-monthly-history','ricotta-daily-cleanup','ricotta-cron-history')$q$ into jobs;
 end if;
 begin size := pg_database_size(current_database()); exception when others then size := null; end;
 return jsonb_build_object('checkedAt',now(),'database',true,'jobs',jobs,'databaseBytes',size,
   'items',(select count(*) from public.app_items),'suppliers',(select count(*) from public.app_suppliers),'units',(select count(*) from public.app_units),
   'ordersThisMonth',(select count(*) from public.app_orders where coalesce(sent_at,created_at) >= month_start),
   'lastOrderAt',(select max(coalesce(sent_at,created_at)) from public.app_orders),
   'pushPhones',(select count(*) from public.app_push_subscriptions),
   'signedIn',(select count(distinct device_id) from public.app_sessions where revoked_at is null and expires_at > now()),
   'openProblems',(select count(*) from public.app_problem_reports where resolved_at is null),
   'problems24h',(select count(*) from public.app_problem_reports where resolved_at is null and last_at > now() - interval '24 hours'),
   'wrongPins24h',(select count(*) from public.app_security_events where kind = 'wrong_pin' and occurred_at > now() - interval '24 hours'));
end $$;
revoke all on function public.app_internal_diagnostics(text) from public,anon,authenticated;
grant execute on function public.app_internal_diagnostics(text) to service_role;

-- ---------- The nightly clean-up keeps the new logs short (never the time in the app) ----------
create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_item_undo where expires_at<=now();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
 delete from public.app_security_events where occurred_at<now()-interval '90 days';
 delete from public.app_problem_reports where (resolved_at is not null and resolved_at<now()-interval '30 days') or last_at<now()-interval '120 days';
end $$;
revoke all on function public.app_internal_cleanup() from public,anon,authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
