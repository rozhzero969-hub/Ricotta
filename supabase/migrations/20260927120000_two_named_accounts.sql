-- Final version: two named accounts instead of shared admin / staff PINs.
--
--   rozha  (Rozha)  full access
--   yunis  (Yunis)  Order, Rico, History (cannot delete), Suppliers, Items,
--                   Record, Units
--
-- PINs are not editable in the app any more. The only way to change them is
-- the secret code on the sign-in keypad, then the name "rozha", then Rozha's
-- current PIN (see api/index.ts, recovery/*). Every PIN and the secret code
-- are stored only as bcrypt hashes. No real value appears in this file:
-- Yunis keeps the hash the old admin role already had, and Rozha's PIN and
-- the secret code start as unusable random hashes that are set privately.

create table public.app_accounts (
  id text primary key check (id in ('rozha', 'yunis')),
  name text not null,
  pin_hash text not null,
  -- The three tabs this account keeps in the tab bar (the rest are in More).
  tabs text[] not null default array['order', 'assistant', 'history'],
  updated_at timestamptz not null default now()
);
alter table public.app_accounts enable row level security;
revoke all on public.app_accounts from anon, authenticated;
grant all on public.app_accounts to service_role;

insert into public.app_accounts (id, name, pin_hash) values
  ('yunis', 'Yunis', coalesce(
    (select pin_hash from public.app_roles where role = 'admin'),
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 12)))),
  ('rozha', 'Rozha', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 12)))
on conflict (id) do nothing;

insert into public.app_secrets (key, value)
  values ('recovery_code_hash', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 12)))
  on conflict (key) do nothing;

-- Sessions belong to an account now. Every existing sign-in ends here: both
-- people sign in once more with their own PIN.
delete from public.app_sessions;
alter table public.app_sessions drop constraint if exists sessions_role_fkey;
alter table public.app_sessions drop column role;
alter table public.app_sessions add column account text not null references public.app_accounts(id) on delete cascade;

-- Devices: which account signed in there. The name Rico uses comes from the
-- account, so the per-device "person name" is gone.
delete from public.app_devices where id like 'verification-%';
alter table public.app_devices drop constraint if exists devices_role_check;
alter table public.app_devices drop column role;
alter table public.app_devices drop column person_name;
alter table public.app_devices add column account text references public.app_accounts(id) on delete set null;
update public.app_devices set logged_in = false;

-- Who sent an order / made a change. Older rows keep 'admin' or 'staff'.
alter table public.app_orders rename column created_by_role to created_by;
alter table public.app_orders rename column sent_by_role to sent_by;
alter table public.app_orders drop constraint if exists orders_created_by_role_check;
alter table public.app_orders drop constraint if exists orders_sent_by_role_check;
alter table public.app_orders add constraint app_orders_created_by_check check (created_by in ('admin', 'staff', 'rozha', 'yunis'));
alter table public.app_orders add constraint app_orders_sent_by_check check (sent_by in ('admin', 'staff', 'rozha', 'yunis'));

alter table public.app_audit_events rename column actor_role to actor;
alter table public.app_audit_events drop constraint if exists audit_events_actor_role_check;
alter table public.app_audit_events add constraint app_audit_events_actor_check check (actor in ('admin', 'staff', 'rozha', 'yunis'));

alter table public.app_assistant_usage rename column role to account;

-- Arabic: unit names and notifications.
alter table public.app_units add column ar text check (ar is null or char_length(ar) <= 80);
update public.app_units u set ar = v.ar from (values
  ('u1789810535051', 'بالة'), ('u1789543354902', 'باكيت'), ('u1789634397957', 'تنكة'),
  ('u1789894988198', 'جام'), ('u1789541930051', 'حلاكة'), ('u1789543048062', 'قطعة'),
  ('u1789543339034', 'حزمة'), ('u1789634405852', 'سطل'), ('u1789541822795', 'صندوق'),
  ('u1789542147849', 'صندوق صغير'), ('u1789894995484', 'صينية'), ('u1789633850493', 'سيت'),
  ('u1789542165937', 'فلينة'), ('u1789810377740', 'فردة'), ('u1789542015405', 'كارتون'),
  ('u1789542061407', 'كيلو'), ('u1790320616768', 'متر')
) as v(id, ar) where u.id = v.id and u.ar is null;

alter table public.app_push_subscriptions drop constraint if exists app_push_subscriptions_lang_check;
alter table public.app_push_subscriptions add constraint app_push_subscriptions_lang_check check (lang in ('en', 'ku', 'ar'));

-- The secret-code steps (code -> name -> Rozha's PIN -> new values). Each
-- ticket lives a few minutes and is deleted on any wrong answer.
create table public.app_recovery_tickets (
  token_hash text primary key,
  stage text not null check (stage in ('code', 'name', 'verified')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.app_recovery_tickets enable row level security;
revoke all on public.app_recovery_tickets from anon, authenticated;
grant all on public.app_recovery_tickets to service_role;

-- Messages Rico sends first (cheering on, or telling off about a forgotten
-- supplier), one inbox per account, in all three languages.
create table public.app_rico_inbox (
  id bigint generated always as identity primary key,
  account text not null references public.app_accounts(id) on delete cascade,
  kind text not null,
  mood text not null,
  body_en text not null,
  body_ku text not null,
  body_ar text not null,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index app_rico_inbox_account_created on public.app_rico_inbox (account, created_at desc);
alter table public.app_rico_inbox enable row level security;
revoke all on public.app_rico_inbox from anon, authenticated;
grant all on public.app_rico_inbox to service_role;
grant usage, select on all sequences in schema public to service_role;

drop function if exists public.app_internal_verify_pin(text);
drop function if exists public.app_internal_set_pins(text, text);
drop table public.app_roles;

/* What a 6-digit code typed on the keypad is: an account id, 'recovery'
   for the secret code, or null. */
create function public.app_internal_match_code(p_code text)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare matched text;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then return null; end if;
  select id into matched from public.app_accounts where extensions.crypt(p_code, pin_hash) = pin_hash limit 1;
  if matched is not null then return matched; end if;
  if exists (select 1 from public.app_secrets where key = 'recovery_code_hash' and extensions.crypt(p_code, value) = value) then
    return 'recovery';
  end if;
  return null;
end;
$$;

create function public.app_internal_check_account_pin(p_account text, p_pin text)
returns boolean language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then return false; end if;
  return exists (select 1 from public.app_accounts where id = p_account and extensions.crypt(p_pin, pin_hash) = pin_hash);
end;
$$;

/* Sets any of Rozha's PIN, Yunis's PIN and the secret code (null keeps the
   current one). All three must stay different from each other, because they
   are all typed on the same keypad. Signs every device out. Returns 'ok',
   'invalid' or 'duplicate'. */
create function public.app_internal_set_credentials(p_rozha text, p_yunis text, p_code text)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_vals text[] := array[p_rozha, p_yunis, p_code];
  old_hashes text[];
  i int; j int;
begin
  if p_rozha is null and p_yunis is null and p_code is null then return 'invalid'; end if;
  for i in 1..3 loop
    if new_vals[i] is not null and new_vals[i] !~ '^[0-9]{6}$' then return 'invalid'; end if;
  end loop;
  old_hashes := array[
    (select pin_hash from public.app_accounts where id = 'rozha'),
    (select pin_hash from public.app_accounts where id = 'yunis'),
    (select value from public.app_secrets where key = 'recovery_code_hash')];
  for i in 1..3 loop
    for j in 1..3 loop
      continue when i = j;
      if new_vals[i] is not null and new_vals[j] is not null and new_vals[i] = new_vals[j] then return 'duplicate'; end if;
      if new_vals[i] is not null and new_vals[j] is null and extensions.crypt(new_vals[i], old_hashes[j]) = old_hashes[j] then return 'duplicate'; end if;
    end loop;
  end loop;
  if p_rozha is not null then
    update public.app_accounts set pin_hash = extensions.crypt(p_rozha, extensions.gen_salt('bf', 12)), updated_at = now() where id = 'rozha';
  end if;
  if p_yunis is not null then
    update public.app_accounts set pin_hash = extensions.crypt(p_yunis, extensions.gen_salt('bf', 12)), updated_at = now() where id = 'yunis';
  end if;
  if p_code is not null then
    update public.app_secrets set value = extensions.crypt(p_code, extensions.gen_salt('bf', 12)), updated_at = now() where key = 'recovery_code_hash';
  end if;
  update public.app_sessions set revoked_at = now() where revoked_at is null;
  delete from public.app_recovery_tickets;
  return 'ok';
end;
$$;

revoke execute on function public.app_internal_match_code(text), public.app_internal_check_account_pin(text, text),
  public.app_internal_set_credentials(text, text, text) from public, anon, authenticated;
grant execute on function public.app_internal_match_code(text), public.app_internal_check_account_pin(text, text),
  public.app_internal_set_credentials(text, text, text) to service_role;

create or replace function public.app_internal_cleanup()
returns void language sql security definer
set search_path = public, pg_temp
as $$
  delete from public.app_login_attempts where attempted_at < now() - interval '2 days';
  delete from public.app_sessions where coalesce(revoked_at, expires_at) < now() - interval '2 days';
  delete from public.app_devices where logged_in = false and coalesce(last_seen, updated_at) < now() - interval '30 days';
  delete from public.app_audit_events where occurred_at < now() - interval '400 days';
  delete from public.app_assistant_alerts where sent_at < now() - interval '30 days';
  delete from public.app_assistant_usage where created_at < now() - interval '90 days';
  delete from public.app_recovery_tickets where expires_at < now();
  delete from public.app_rico_inbox where created_at < now() - interval '30 days';
$$;
