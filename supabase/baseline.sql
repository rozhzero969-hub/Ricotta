-- Verified schema-only baseline of the retained application, 7 October 2026.
-- For a new EMPTY Supabase project only. No restaurant data or credentials.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.app_push_supplier_sent (
  "supplier_id" text not null,
  "sent_key" text not null,
  "sent_at" timestamp with time zone default now() not null
);

create table public.app_rico_chats (
  "id" uuid not null,
  "account" text not null,
  "title" text default ''::text not null,
  "messages" jsonb default '[]'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public.app_assistant_alerts (
  "id" text not null,
  "kind" text not null,
  "supplier_id" text,
  "sent_at" timestamp with time zone default now() not null
);

create table public.app_assistant_usage (
  "id" bigint generated always as identity not null,
  "device_id" text,
  "account" text,
  "model" text,
  "input_tokens" integer default 0 not null,
  "output_tokens" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table public.app_order_lines (
  "id" bigint generated always as identity not null,
  "order_id" text not null,
  "supplier_id" text,
  "item_id" text,
  "item_name" text not null,
  "unit_id" text,
  "qty" numeric not null,
  "supplier_name" text
);

create table public.app_orders (
  "id" text not null,
  "status" text not null,
  "created_at" timestamp with time zone default now() not null,
  "sent_at" timestamp with time zone,
  "created_by" text,
  "sent_by" text
);

create table public.app_audit_events (
  "id" text not null,
  "occurred_at" timestamp with time zone default now() not null,
  "actor" text,
  "device_id" text,
  "action" text not null,
  "entity_type" text,
  "entity_name" text,
  "payload" jsonb default '{}'::jsonb not null
);

create table public.app_secrets (
  "key" text not null,
  "value" text not null
);

create table public.app_units (
  "id" text not null,
  "en" text not null,
  "ku" text,
  "ar" text
);

create table public.app_push_subscriptions (
  "endpoint" text not null,
  "p256dh" text not null,
  "auth" text not null,
  "device_id" text,
  "lang" text default 'en'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public.app_suppliers (
  "id" text not null,
  "name" text not null,
  "phone" text,
  "reminder" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public.app_devices (
  "id" text not null,
  "logged_in" boolean default false not null,
  "last_login" timestamp with time zone,
  "last_seen" timestamp with time zone,
  "command" jsonb,
  "handled_command" text,
  "updated_at" timestamp with time zone default now() not null,
  "account" text,
  "label" text
);

create table public.app_reminder_settings (
  "id" boolean default true not null,
  "enabled" boolean default false not null,
  "remind_time" time without time zone default '09:00:00'::time without time zone not null,
  "last_sent_date" date
);

create table public.app_items (
  "id" text not null,
  "name" text not null,
  "unit_id" text,
  "supplier_id" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "sort_order" integer
);

create table public.app_accounts (
  "id" text not null,
  "name" text not null,
  "pin_hash" text not null,
  "tabs" text[] default ARRAY['order'::text, 'assistant'::text, 'history'::text] not null,
  "updated_at" timestamp with time zone default now() not null,
  "theme" text default 'ricotta'::text not null
);

create table public.app_login_attempts (
  "id" bigint generated always as identity not null,
  "fingerprint_hash" text not null,
  "attempted_at" timestamp with time zone default now() not null,
  "succeeded" boolean default false not null
);

create table public.app_recovery_tickets (
  "token_hash" text not null,
  "stage" text not null,
  "expires_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default now() not null
);

create table public.app_sessions (
  "id" uuid default gen_random_uuid() not null,
  "token_hash" text not null,
  "device_id" text,
  "expires_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "account" text not null
);

create table public.app_rico_inbox (
  "id" bigint generated always as identity not null,
  "account" text not null,
  "kind" text not null,
  "mood" text not null,
  "body_en" text not null,
  "body_ku" text not null,
  "body_ar" text not null,
  "dedupe_key" text,
  "created_at" timestamp with time zone default now() not null,
  "read_at" timestamp with time zone
);
alter table public.app_push_supplier_sent add constraint "app_push_supplier_sent_pkey" PRIMARY KEY (supplier_id);
alter table public.app_rico_chats add constraint "app_rico_chats_messages_check" CHECK ((jsonb_typeof(messages) = 'array'::text));
alter table public.app_rico_chats add constraint "app_rico_chats_pkey" PRIMARY KEY (id);
alter table public.app_assistant_alerts add constraint "app_assistant_alerts_pkey" PRIMARY KEY (id);
alter table public.app_assistant_usage add constraint "app_assistant_usage_pkey" PRIMARY KEY (id);
alter table public.app_order_lines add constraint "order_lines_order_id_supplier_id_item_id_key" UNIQUE (order_id, supplier_id, item_id);
alter table public.app_order_lines add constraint "order_lines_pkey" PRIMARY KEY (id);
alter table public.app_order_lines add constraint "order_lines_qty_check" CHECK ((qty > (0)::numeric));
alter table public.app_orders add constraint "app_orders_created_by_check" CHECK ((created_by = ANY (ARRAY['admin'::text, 'staff'::text, 'rozha'::text, 'yunis'::text])));
alter table public.app_orders add constraint "app_orders_sent_by_check" CHECK ((sent_by = ANY (ARRAY['admin'::text, 'staff'::text, 'rozha'::text, 'yunis'::text])));
alter table public.app_orders add constraint "orders_pkey" PRIMARY KEY (id);
alter table public.app_orders add constraint "orders_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'deleted'::text])));
alter table public.app_audit_events add constraint "app_audit_events_actor_check" CHECK ((actor = ANY (ARRAY['admin'::text, 'staff'::text, 'rozha'::text, 'yunis'::text])));
alter table public.app_audit_events add constraint "audit_events_pkey" PRIMARY KEY (id);
alter table public.app_secrets add constraint "app_secrets_pkey" PRIMARY KEY (key);
alter table public.app_units add constraint "app_units_ar_check" CHECK (((ar IS NULL) OR (char_length(ar) <= 80)));
alter table public.app_units add constraint "units_en_check" CHECK (((char_length(en) >= 1) AND (char_length(en) <= 80)));
alter table public.app_units add constraint "units_pkey" PRIMARY KEY (id);
alter table public.app_push_subscriptions add constraint "app_push_subscriptions_lang_check" CHECK ((lang = ANY (ARRAY['en'::text, 'ku'::text, 'ar'::text])));
alter table public.app_push_subscriptions add constraint "app_push_subscriptions_pkey" PRIMARY KEY (endpoint);
alter table public.app_suppliers add constraint "suppliers_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 160)));
alter table public.app_suppliers add constraint "suppliers_pkey" PRIMARY KEY (id);
alter table public.app_devices add constraint "app_devices_label_check" CHECK (((label IS NULL) OR (char_length(label) <= 80)));
alter table public.app_devices add constraint "devices_pkey" PRIMARY KEY (id);
alter table public.app_reminder_settings add constraint "reminder_settings_id_check" CHECK (id);
alter table public.app_reminder_settings add constraint "reminder_settings_pkey" PRIMARY KEY (id);
alter table public.app_items add constraint "app_items_sort_order_check" CHECK (((sort_order IS NULL) OR (sort_order >= 0)));
alter table public.app_items add constraint "items_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 160)));
alter table public.app_items add constraint "items_pkey" PRIMARY KEY (id);
alter table public.app_accounts add constraint "app_accounts_id_check" CHECK ((id = ANY (ARRAY['rozha'::text, 'yunis'::text])));
alter table public.app_accounts add constraint "app_accounts_pkey" PRIMARY KEY (id);
alter table public.app_accounts add constraint "app_accounts_theme_check" CHECK ((theme = ANY (ARRAY['ricotta'::text, 'graphite'::text, 'ocean'::text, 'saffron'::text, 'berry'::text])));
alter table public.app_login_attempts add constraint "login_attempts_pkey" PRIMARY KEY (id);
alter table public.app_recovery_tickets add constraint "app_recovery_tickets_pkey" PRIMARY KEY (token_hash);
alter table public.app_recovery_tickets add constraint "app_recovery_tickets_stage_check" CHECK ((stage = ANY (ARRAY['code'::text, 'name'::text, 'verified'::text])));
alter table public.app_sessions add constraint "sessions_pkey" PRIMARY KEY (id);
alter table public.app_sessions add constraint "sessions_token_hash_key" UNIQUE (token_hash);
alter table public.app_rico_inbox add constraint "app_rico_inbox_dedupe_key_key" UNIQUE (dedupe_key);
alter table public.app_rico_inbox add constraint "app_rico_inbox_pkey" PRIMARY KEY (id);
alter table public.app_push_supplier_sent enable row level security;
revoke all on public.app_push_supplier_sent from public, anon, authenticated;
grant all on public.app_push_supplier_sent to service_role;
alter table public.app_rico_chats add constraint "app_rico_chats_account_fkey" FOREIGN KEY (account) REFERENCES app_accounts(id) ON DELETE CASCADE;
CREATE INDEX app_rico_chats_account_updated ON public.app_rico_chats USING btree (account, updated_at DESC);
alter table public.app_rico_chats enable row level security;
revoke all on public.app_rico_chats from public, anon, authenticated;
grant all on public.app_rico_chats to service_role;
alter table public.app_assistant_alerts enable row level security;
revoke all on public.app_assistant_alerts from public, anon, authenticated;
grant all on public.app_assistant_alerts to service_role;
CREATE INDEX app_assistant_usage_device_time_idx ON public.app_assistant_usage USING btree (device_id, created_at DESC);
CREATE INDEX app_assistant_usage_time_idx ON public.app_assistant_usage USING btree (created_at);
alter table public.app_assistant_usage enable row level security;
revoke all on public.app_assistant_usage from public, anon, authenticated;
grant all on public.app_assistant_usage to service_role;
alter table public.app_order_lines add constraint "order_lines_order_id_fkey" FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE CASCADE;
alter table public.app_order_lines add constraint "order_lines_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES app_suppliers(id) ON DELETE SET NULL;
CREATE INDEX order_lines_order_idx ON public.app_order_lines USING btree (order_id);
CREATE INDEX app_order_lines_supplier_idx ON public.app_order_lines USING btree (supplier_id);
alter table public.app_order_lines enable row level security;
revoke all on public.app_order_lines from public, anon, authenticated;
grant all on public.app_order_lines to service_role;
CREATE INDEX app_orders_sent_at_idx ON public.app_orders USING btree (sent_at DESC) WHERE (status = 'sent'::text);
alter table public.app_orders enable row level security;
revoke all on public.app_orders from public, anon, authenticated;
grant all on public.app_orders to service_role;
CREATE INDEX audit_events_time_idx ON public.app_audit_events USING btree (occurred_at DESC);
alter table public.app_audit_events enable row level security;
revoke all on public.app_audit_events from public, anon, authenticated;
grant all on public.app_audit_events to service_role;
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;
grant all on public.app_secrets to service_role;
alter table public.app_units enable row level security;
revoke all on public.app_units from public, anon, authenticated;
grant all on public.app_units to service_role;
alter table public.app_push_subscriptions enable row level security;
revoke all on public.app_push_subscriptions from public, anon, authenticated;
grant all on public.app_push_subscriptions to service_role;
alter table public.app_suppliers enable row level security;
revoke all on public.app_suppliers from public, anon, authenticated;
grant all on public.app_suppliers to service_role;
alter table public.app_devices add constraint "app_devices_account_fkey" FOREIGN KEY (account) REFERENCES app_accounts(id) ON DELETE SET NULL;
CREATE INDEX app_devices_account_idx ON public.app_devices USING btree (account);
alter table public.app_devices enable row level security;
revoke all on public.app_devices from public, anon, authenticated;
grant all on public.app_devices to service_role;
alter table public.app_reminder_settings enable row level security;
revoke all on public.app_reminder_settings from public, anon, authenticated;
grant all on public.app_reminder_settings to service_role;
alter table public.app_items add constraint "items_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES app_suppliers(id) ON DELETE SET NULL;
alter table public.app_items add constraint "items_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES app_units(id) ON DELETE SET NULL;
CREATE INDEX items_supplier_idx ON public.app_items USING btree (supplier_id);
CREATE INDEX app_items_unit_idx ON public.app_items USING btree (unit_id);
alter table public.app_items enable row level security;
revoke all on public.app_items from public, anon, authenticated;
grant all on public.app_items to service_role;
alter table public.app_accounts enable row level security;
revoke all on public.app_accounts from public, anon, authenticated;
grant all on public.app_accounts to service_role;
CREATE INDEX login_attempts_fingerprint_time_idx ON public.app_login_attempts USING btree (fingerprint_hash, attempted_at DESC);
alter table public.app_login_attempts enable row level security;
revoke all on public.app_login_attempts from public, anon, authenticated;
grant all on public.app_login_attempts to service_role;
alter table public.app_recovery_tickets enable row level security;
revoke all on public.app_recovery_tickets from public, anon, authenticated;
grant all on public.app_recovery_tickets to service_role;
alter table public.app_sessions add constraint "app_sessions_account_fkey" FOREIGN KEY (account) REFERENCES app_accounts(id) ON DELETE CASCADE;
CREATE INDEX app_sessions_account_idx ON public.app_sessions USING btree (account);
alter table public.app_sessions enable row level security;
revoke all on public.app_sessions from public, anon, authenticated;
grant all on public.app_sessions to service_role;
alter table public.app_rico_inbox add constraint "app_rico_inbox_account_fkey" FOREIGN KEY (account) REFERENCES app_accounts(id) ON DELETE CASCADE;
CREATE INDEX app_rico_inbox_account_created ON public.app_rico_inbox USING btree (account, created_at DESC);
alter table public.app_rico_inbox enable row level security;
revoke all on public.app_rico_inbox from public, anon, authenticated;
grant all on public.app_rico_inbox to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_set_item_order(p_supplier_id text, p_item_ids text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  expected_count integer;
begin
  if p_supplier_id is null or p_item_ids is null or cardinality(p_item_ids) > 500 then
    return false;
  end if;

  select count(*) into expected_count
    from public.app_items where supplier_id = p_supplier_id;
  if cardinality(p_item_ids) <> expected_count
     or cardinality(array(select distinct unnest(p_item_ids))) <> cardinality(p_item_ids)
     or exists (
       select 1 from unnest(p_item_ids) as requested(id)
       left join public.app_items i on i.id = requested.id and i.supplier_id = p_supplier_id
       where i.id is null
     ) then
    return false;
  end if;

  update public.app_items i
    set sort_order = requested.position::integer - 1, updated_at = now()
    from unnest(p_item_ids) with ordinality as requested(id, position)
    where i.id = requested.id and i.supplier_id = p_supplier_id;

  return true;
end;
$function$
;
revoke all on function app_internal_set_item_order(text,text[]) from public, anon, authenticated;
grant execute on function app_internal_set_item_order(text,text[]) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_claim_supplier(p_supplier_id text, p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int;
begin
  insert into public.app_push_supplier_sent (supplier_id, sent_key) values (p_supplier_id, p_key)
  on conflict (supplier_id) do update set sent_key = excluded.sent_key, sent_at = now()
    where public.app_push_supplier_sent.sent_key is distinct from excluded.sent_key;
  get diagnostics n = row_count;
  return n > 0;
end $function$
;
revoke all on function app_internal_claim_supplier(text,text) from public, anon, authenticated;
grant execute on function app_internal_claim_supplier(text,text) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_match_code(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
;
revoke all on function app_internal_match_code(text) from public, anon, authenticated;
grant execute on function app_internal_match_code(text) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_check_account_pin(p_account text, p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then return false; end if;
  return exists (select 1 from public.app_accounts where id = p_account and extensions.crypt(p_pin, pin_hash) = pin_hash);
end;
$function$
;
revoke all on function app_internal_check_account_pin(text,text) from public, anon, authenticated;
grant execute on function app_internal_check_account_pin(text,text) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_set_credentials(p_rozha text, p_yunis text, p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
    update public.app_secrets set value = extensions.crypt(p_code, extensions.gen_salt('bf', 12)) where key = 'recovery_code_hash';
  end if;
  update public.app_sessions set revoked_at = now() where revoked_at is null;
  delete from public.app_recovery_tickets;
  return 'ok';
end;
$function$
;
revoke all on function app_internal_set_credentials(text,text,text) from public, anon, authenticated;
grant execute on function app_internal_set_credentials(text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_check_recovery_name(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select exists (select 1 from public.app_secrets
    where key = 'recovery_name_hash' and extensions.crypt(coalesce(p_name, ''), value) = value);
$function$
;
revoke all on function app_internal_check_recovery_name(text) from public, anon, authenticated;
grant execute on function app_internal_check_recovery_name(text) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_set_recovery_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if p_name is null or length(p_name) < 1 or length(p_name) > 40 or p_name <> btrim(p_name) then return 'invalid'; end if;
  update public.app_secrets set value = extensions.crypt(p_name, extensions.gen_salt('bf', 12)) where key = 'recovery_name_hash';
  delete from public.app_recovery_tickets;
  return 'ok';
end;
$function$
;
revoke all on function app_internal_set_recovery_name(text) from public, anon, authenticated;
grant execute on function app_internal_set_recovery_name(text) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_reserve_assistant(p_device_id text, p_account text, p_model text, p_device_limit integer, p_total_limit integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  insert into public.app_assistant_usage(device_id,account,model)
    values(p_device_id,p_account,p_model) returning id into reservation;
  return reservation;
end $function$
;
revoke all on function app_internal_reserve_assistant(text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function app_internal_reserve_assistant(text,text,text,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.app_internal_reserve_login(p_fingerprints text[], p_window_seconds integer, p_ip_limit integer, p_global_limit integer)
 RETURNS bigint[]
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare reservations bigint[];
begin
  if coalesce(array_length(p_fingerprints,1),0) <> 2 or
     p_fingerprints[1] is null or p_fingerprints[2] is null or p_fingerprints[1]=p_fingerprints[2] or
     p_window_seconds is null or p_window_seconds < 1 or p_ip_limit is null or p_ip_limit < 1 or
     p_global_limit is null or p_global_limit < 1 then raise exception 'Invalid login reservation'; end if;
  perform pg_advisory_xact_lock(729293);
  if (select count(*) from public.app_login_attempts where fingerprint_hash=p_fingerprints[1] and not succeeded
       and attempted_at >= now()-make_interval(secs=>p_window_seconds)) >= p_ip_limit or
     (select count(*) from public.app_login_attempts where fingerprint_hash=p_fingerprints[2] and not succeeded
       and attempted_at >= now()-make_interval(secs=>p_window_seconds)) >= p_global_limit then return null; end if;
  with inserted as (insert into public.app_login_attempts(fingerprint_hash,succeeded)
    select fingerprint,false from unnest(p_fingerprints) fingerprint returning id)
    select array_agg(id) into reservations from inserted;
  return reservations;
end $function$
;
revoke all on function app_internal_reserve_login(text[],integer,integer,integer) from public, anon, authenticated;
grant execute on function app_internal_reserve_login(text[],integer,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.app_rico_chats_prune(p_account text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  delete from public.app_rico_chats where account = p_account and (updated_at < now() - interval '90 days'
    or id in (select id from public.app_rico_chats where account = p_account order by updated_at desc offset 60));
$function$
;
revoke all on function app_rico_chats_prune(text) from public, anon, authenticated;
grant execute on function app_rico_chats_prune(text) to service_role;
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

