-- Everything below was replaced by the app_* tables + the api Edge Function.
-- app_data (old key/value store, incl. plaintext PINs) was backed up to
-- backups/app_data-2026-09-23.json (PINs redacted) before removal.
drop function if exists public.app_verify_pin(text);
drop function if exists public.app_get_pins(text);
drop function if exists public.app_set_pins(text, text, text);
drop function if exists public.app_get_cloud_config(text);
drop function if exists public.app_set_cloud_config(text, text, text, text);
drop function if exists public.push_claim_supplier(text, text);
drop function if exists public.push_get_reminder();
drop function if exists public.push_remove_subscription(text);
drop function if exists public.push_save_subscription(text, text, text, text);
drop function if exists public.push_save_subscription(text, text, text, text, text);
drop function if exists public.push_set_lang(text, text);
drop function if exists public.push_set_reminder(text, boolean, text);

drop table if exists public.app_data;
drop table if exists public.push_subscriptions;
drop table if exists public.push_reminder;
drop table if exists public.push_supplier_sent;
