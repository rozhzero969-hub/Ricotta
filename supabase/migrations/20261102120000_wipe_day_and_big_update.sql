-- 2026-11-02 big update, part 1: one wipe day every 60 days for everything that is history.
-- On the wipe day, orders, the Record of changes, Rico's test orders and saved Rico chats older than 60 days
-- are deleted, so 60 to 120 days are kept. The app warns 2 days before. A finished month still gets its summary.

create table if not exists public.app_wipe (
  id boolean primary key default true check (id),
  next_wipe date not null,
  last_wipe date
);
alter table public.app_wipe enable row level security;
revoke all on public.app_wipe from public, anon, authenticated;
grant all on public.app_wipe to service_role;
insert into public.app_wipe(id, next_wipe)
  values (true, (now() at time zone 'Asia/Baghdad')::date + 60)
  on conflict (id) do nothing;

create or replace function public.app_internal_monthly_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare
  cutoff timestamptz := date_trunc('month', p_now at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad';
  today date := (p_now at time zone 'Asia/Baghdad')::date;
  older timestamptz := p_now - interval '60 days';
  due date; m record;
begin
 for m in select date_trunc('month', coalesce(sent_at, created_at) at time zone 'Asia/Baghdad') as ms
   from public.app_orders where status = 'sent' and coalesce(sent_at, created_at) < cutoff group by 1
 loop
  if not exists (select 1 from public.app_month_summaries where month = to_char(m.ms, 'YYYY-MM')) then
   insert into public.app_month_summaries(month, data)
   values (to_char(m.ms, 'YYYY-MM'), public.app_internal_month_summary(m.ms at time zone 'Asia/Baghdad', (m.ms + interval '1 month') at time zone 'Asia/Baghdad'))
   on conflict (month) do nothing;
  end if;
 end loop;
 select next_wipe into due from public.app_wipe where id;
 if due is null or today < due then return; end if;
 delete from public.app_orders where coalesce(sent_at, created_at) < older;
 delete from public.app_audit_events where occurred_at < older;
 delete from public.app_rico_orders where created_at < older;
 delete from public.app_rico_chats where updated_at < older;
 -- The next wipe is 60 days after the one that was due; a long outage still lands in the future.
 while due <= today loop due := due + 60; end loop;
 update public.app_wipe set next_wipe = due, last_wipe = today where id;
end $$;
revoke all on function public.app_internal_monthly_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_monthly_cleanup(timestamptz) to service_role;

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
 delete from public.app_usage_batches where created_at<now()-interval '7 days';
end $$;
revoke all on function public.app_internal_cleanup() from public,anon,authenticated;
grant execute on function public.app_internal_cleanup() to service_role;

-- Where an item is kept (the walking order) and its picture.
alter table public.app_items add column if not exists place text check (place is null or char_length(place) between 1 and 40);
alter table public.app_items add column if not exists photo_url text check (photo_url is null or char_length(photo_url) <= 500);

-- Rules people teach Rico. Read into every chat as data.
create table if not exists public.app_rico_rules (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('rozha','yunis')),
  rule text not null check (char_length(rule) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.app_rico_rules enable row level security;
revoke all on public.app_rico_rules from public, anon, authenticated;
grant all on public.app_rico_rules to service_role;

-- A daily copy of the kitchen's data on the server, kept 7 days, for Admin > Restore.
create table if not exists public.app_backups (
  day date primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.app_backups enable row level security;
revoke all on public.app_backups from public, anon, authenticated;
grant all on public.app_backups to service_role;

create or replace function public.app_internal_make_backup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare today date := (p_now at time zone 'Asia/Baghdad')::date;
begin
 insert into public.app_backups(day, data) values (today, jsonb_build_object(
   'suppliers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_suppliers t),
   'units', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_units t),
   'items', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_items t),
   'orders', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_orders t),
   'lines', (select coalesce(jsonb_agg(to_jsonb(t) - 'id'), '[]') from public.app_order_lines t)
 )) on conflict (day) do update set data = excluded.data, created_at = now();
 delete from public.app_backups where day < today - 7;
end $$;
revoke all on function public.app_internal_make_backup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_make_backup(timestamptz) to service_role;

/* What each kept copy holds, without sending the copies themselves. */
create or replace function public.app_internal_list_backups()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'suppliers', jsonb_array_length(data->'suppliers'), 'items', jsonb_array_length(data->'items'), 'orders', jsonb_array_length(data->'orders'), 'at', created_at) order by day desc), '[]')
  from public.app_backups;
$$;
revoke all on function public.app_internal_list_backups() from public, anon, authenticated;
grant execute on function public.app_internal_list_backups() to service_role;

/* Brings back what was deleted since that day. Nothing that exists now is changed. */
create or replace function public.app_internal_restore_backup(p_day date, p_actor text, p_device text)
returns jsonb language plpgsql set search_path = '' as $$
declare b jsonb; n_sup int; n_unit int; n_item int; n_order int;
begin
 if p_actor <> 'rozha' then raise exception 'Forbidden'; end if;
 select data into b from public.app_backups where day = p_day;
 if b is null then return jsonb_build_object('error', 'not_found'); end if;
 insert into public.app_suppliers select * from jsonb_populate_recordset(null::public.app_suppliers, b->'suppliers') on conflict do nothing;
 get diagnostics n_sup = row_count;
 insert into public.app_units select * from jsonb_populate_recordset(null::public.app_units, b->'units') on conflict do nothing;
 get diagnostics n_unit = row_count;
 insert into public.app_items select * from jsonb_populate_recordset(null::public.app_items, b->'items') on conflict do nothing;
 get diagnostics n_item = row_count;
 with added as (
   insert into public.app_orders select * from jsonb_populate_recordset(null::public.app_orders, b->'orders') on conflict do nothing returning id
 ), lines as (
   insert into public.app_order_lines(order_id, supplier_id, item_id, item_name, unit_id, qty, supplier_name, prev_last_ordered_at)
   select l.order_id, s.id, i.id, l.item_name, u.id, l.qty, l.supplier_name, l.prev_last_ordered_at
   from jsonb_populate_recordset(null::public.app_order_lines, b->'lines') l
   join added a on a.id = l.order_id
   left join public.app_suppliers s on s.id = l.supplier_id
   left join public.app_items i on i.id = l.item_id
   left join public.app_units u on u.id = l.unit_id
   returning 1
 ) select count(*) into n_order from added;
 insert into public.app_audit_events(id, actor, device_id, action, entity_type, entity_name, payload)
 values (gen_random_uuid()::text, p_actor, p_device, 'restore', 'backup', p_day::text, jsonb_build_object('suppliers', n_sup, 'units', n_unit, 'items', n_item, 'orders', n_order));
 return jsonb_build_object('suppliers', n_sup, 'units', n_unit, 'items', n_item, 'orders', n_order);
end $$;
revoke all on function public.app_internal_restore_backup(date, text, text) from public, anon, authenticated;
grant execute on function public.app_internal_restore_backup(date, text, text) to service_role;

create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 perform public.app_internal_make_backup();
 delete from public.app_item_undo where expires_at<=now();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
 delete from public.app_security_events where occurred_at<now()-interval '90 days';
 delete from public.app_problem_reports where (resolved_at is not null and resolved_at<now()-interval '30 days') or last_at<now()-interval '120 days';
 delete from public.app_usage_batches where created_at<now()-interval '7 days';
end $$;
revoke all on function public.app_internal_cleanup() from public,anon,authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
