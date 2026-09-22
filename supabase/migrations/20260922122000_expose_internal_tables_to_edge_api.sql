-- Edge Functions access Postgres through PostgREST.  Private schemas are not
-- available to that interface even for the service role, so keep these
-- server-only tables in public with explicit grant revocation and RLS.

alter table app_private.roles set schema public;
alter table public.roles rename to app_roles;
alter table app_private.sessions set schema public;
alter table public.sessions rename to app_sessions;
alter table app_private.login_attempts set schema public;
alter table public.login_attempts rename to app_login_attempts;
alter table app_private.suppliers set schema public;
alter table public.suppliers rename to app_suppliers;
alter table app_private.units set schema public;
alter table public.units rename to app_units;
alter table app_private.items set schema public;
alter table public.items rename to app_items;
alter table app_private.orders set schema public;
alter table public.orders rename to app_orders;
alter table app_private.order_lines set schema public;
alter table public.order_lines rename to app_order_lines;
alter table app_private.devices set schema public;
alter table public.devices rename to app_devices;
alter table app_private.audit_events set schema public;
alter table public.audit_events rename to app_audit_events;
alter table app_private.push_subscriptions rename to app_push_subscriptions;
alter table app_private.app_push_subscriptions rename constraint push_subscriptions_pkey to app_push_subscriptions_pkey;
alter table app_private.app_push_subscriptions rename constraint push_subscriptions_lang_check to app_push_subscriptions_lang_check;
alter table app_private.app_push_subscriptions set schema public;
alter table app_private.reminder_settings set schema public;
alter table public.reminder_settings rename to app_reminder_settings;

drop function public.app_internal_verify_pin(text);
drop function public.app_internal_set_pins(text,text);
create function public.app_internal_verify_pin(p_pin text)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare matched_role text;
begin
  if p_pin !~ '^[0-9]{4,6}$' then return null; end if;
  select role into matched_role from public.app_roles
    where extensions.crypt(p_pin, pin_hash) = pin_hash
    order by case role when 'admin' then 0 else 1 end limit 1;
  return matched_role;
end;
$$;
create function public.app_internal_set_pins(p_admin_pin text, p_staff_pin text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_admin_pin !~ '^[0-9]{6}$' or p_staff_pin !~ '^[0-9]{4}$' or p_admin_pin like p_staff_pin || '%' then raise exception 'invalid PIN format'; end if;
  update public.app_roles set pin_hash = extensions.crypt(case role when 'admin' then p_admin_pin else p_staff_pin end, extensions.gen_salt('bf',12)), updated_at=now();
  update public.app_sessions set revoked_at=now() where revoked_at is null;
end;
$$;
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke execute on function public.app_internal_verify_pin(text), public.app_internal_set_pins(text,text) from public, anon, authenticated;
grant execute on function public.app_internal_verify_pin(text), public.app_internal_set_pins(text,text) to service_role;
