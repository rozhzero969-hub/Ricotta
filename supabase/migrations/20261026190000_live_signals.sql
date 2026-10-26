-- ROZH-23: live changes. Each kind of change bumps one counter; an open app waits on the api for any
-- counter to move (GET signals) and then loads only what changed. Only the kinds and counters are ever
-- sent, never the data itself.
--   data      orders, items, suppliers, units, Yunis's access, the daily reminder, the kitchen streak
--   draft     an unsent order shared between an account's devices
--   devices   a phone signs in or out, gets a Refresh or Sign Out, or carries one out
--   admin     the security log and problem reports
--   inbox     a message Rico sends first
-- Routine "still here" updates (last seen, time in the app) bump nothing.
create table if not exists public.app_signals (
  kind text primary key check (kind in ('data','draft','devices','admin','inbox')),
  n bigint not null,
  at timestamptz not null default now()
);
alter table public.app_signals enable row level security;
revoke all on public.app_signals from public, anon, authenticated;
grant select on public.app_signals to service_role;
create sequence if not exists public.app_signal_seq;
revoke all on sequence public.app_signal_seq from public, anon, authenticated;

-- A counter that cannot move must never stop the change itself from being saved.
create or replace function public.app_signal_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.app_signals as s(kind, n, at) values (tg_argv[0], nextval('public.app_signal_seq'), now())
      on conflict (kind) do update set n = excluded.n, at = excluded.at;
  exception when others then
    raise warning 'app_signal_bump(%): %', tg_argv[0], sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.app_signal_bump() from public, anon, authenticated;

do $$
declare t text;
begin
  -- Once per statement: a big change (a whole order, the month's clean-up) is still one signal.
  foreach t in array array['app_orders','app_order_lines','app_items','app_suppliers','app_units','app_reminder_settings','app_streak'] loop
    execute format('drop trigger if exists app_signal_data on public.%I', t);
    execute format('create trigger app_signal_data after insert or update or delete or truncate on public.%I for each statement execute function public.app_signal_bump(%L)', t, 'data');
  end loop;
  drop trigger if exists app_signal_draft on public.app_order_drafts;
  create trigger app_signal_draft after insert or update or delete on public.app_order_drafts for each statement execute function public.app_signal_bump('draft');
  foreach t in array array['app_security_events','app_problem_reports'] loop
    execute format('drop trigger if exists app_signal_admin on public.%I', t);
    execute format('create trigger app_signal_admin after insert or update or delete on public.%I for each statement execute function public.app_signal_bump(%L)', t, 'admin');
  end loop;
  drop trigger if exists app_signal_inbox on public.app_rico_inbox;
  create trigger app_signal_inbox after insert on public.app_rico_inbox for each statement execute function public.app_signal_bump('inbox');
end $$;

-- Yunis's access and the names change the screens; a new PIN or a sign-in alone does not.
drop trigger if exists app_signal_access on public.app_accounts;
create trigger app_signal_access after update on public.app_accounts for each row
  when (old.roles is distinct from new.roles or old.name is distinct from new.name)
  execute function public.app_signal_bump('data');

-- A device: signed in or out, a command sent or carried out, a new name or app version. Not "last seen".
drop trigger if exists app_signal_devices_rows on public.app_devices;
create trigger app_signal_devices_rows after insert or delete on public.app_devices for each statement execute function public.app_signal_bump('devices');
drop trigger if exists app_signal_devices on public.app_devices;
create trigger app_signal_devices after update on public.app_devices for each row
  when (old.logged_in is distinct from new.logged_in or old.command is distinct from new.command
     or old.handled_command is distinct from new.handled_command or old.account is distinct from new.account
     or old.label is distinct from new.label or old.app_version is distinct from new.app_version)
  execute function public.app_signal_bump('devices');

insert into public.app_signals(kind, n)
  select k, nextval('public.app_signal_seq') from unnest(array['data','draft','devices','admin','inbox']) k
  on conflict (kind) do nothing;
