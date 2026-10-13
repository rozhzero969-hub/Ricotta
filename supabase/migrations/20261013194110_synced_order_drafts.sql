-- One unfinished order per account. Only the authenticated API accesses it.
create table public.app_order_drafts (
 account text primary key references public.app_accounts(id) on delete cascade,
 cart jsonb not null default '{}'::jsonb check (jsonb_typeof(cart) = 'object'),
 revision bigint not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.app_order_drafts enable row level security;
revoke all on public.app_order_drafts from public, anon, authenticated;
grant all on public.app_order_drafts to service_role;

-- Compare individual quantities under a row lock. Independent item edits merge;
-- conflicting edits return the current draft instead of silently replacing it.
create or replace function public.app_internal_patch_draft(p_account text, p_changes jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
 d public.app_order_drafts%rowtype; c jsonb; item text; old_qty numeric; new_qty numeric;
 conflicts jsonb := '[]'::jsonb; next_cart jsonb;
begin
 if p_account not in ('rozha','yunis') or p_account is null then raise exception 'Invalid account'; end if;
 if p_changes is null or jsonb_typeof(p_changes) <> 'array' then raise exception 'Invalid changes'; end if;
 if jsonb_array_length(p_changes) > 2000 then raise exception 'Too many changes'; end if;
 if (select count(*) from jsonb_array_elements(p_changes)) <> (select count(distinct x->>'itemId') from jsonb_array_elements(p_changes) x) then raise exception 'Duplicate item'; end if;
 for c in select value from jsonb_array_elements(p_changes) loop
  item := c->>'itemId';
  if item is null or length(item) < 1 or length(item) > 200 or jsonb_typeof(c->'before') is distinct from 'number' or jsonb_typeof(c->'after') is distinct from 'number' then raise exception 'Invalid change'; end if;
  old_qty := (c->>'before')::numeric; new_qty := (c->>'after')::numeric;
  if old_qty < 0 or old_qty > 99999 or old_qty <> trunc(old_qty) or new_qty < 0 or new_qty > 99999 or new_qty <> trunc(new_qty) then raise exception 'Invalid quantity'; end if;
  if new_qty > 0 and not exists(select 1 from public.app_items where id=item) then raise exception 'Unknown item'; end if;
 end loop;
 insert into public.app_order_drafts(account) values(p_account) on conflict(account) do nothing;
 select * into d from public.app_order_drafts where account=p_account for update;
 for c in select value from jsonb_array_elements(p_changes) loop
  item := c->>'itemId'; old_qty := coalesce((d.cart->>item)::numeric,0);
  if old_qty <> (c->>'before')::numeric and old_qty <> (c->>'after')::numeric then conflicts := conflicts || jsonb_build_array(item); end if;
 end loop;
 if jsonb_array_length(conflicts) > 0 then
  return jsonb_build_object('cart',d.cart,'revision',d.revision,'conflicts',conflicts);
 end if;
 next_cart := d.cart;
 for c in select value from jsonb_array_elements(p_changes) loop
  item := c->>'itemId'; new_qty := (c->>'after')::numeric;
  if new_qty=0 then next_cart := next_cart-item;
  else next_cart := jsonb_set(next_cart,array[item],to_jsonb(new_qty::integer)); end if;
 end loop;
 if next_cart <> d.cart then
  update public.app_order_drafts set cart=next_cart,revision=revision+1,updated_at=now() where account=p_account returning * into d;
 end if;
 return jsonb_build_object('cart',d.cart,'revision',d.revision,'conflicts','[]'::jsonb);
end $$;
revoke all on function public.app_internal_patch_draft(text,jsonb) from public,anon,authenticated;
grant execute on function public.app_internal_patch_draft(text,jsonb) to service_role;

-- Registration must not transfer another account's credential or reset its
-- signature counter. A retry for the same owner and key is harmless.
create or replace function public.app_internal_register_passkey(p_id text,p_account text,p_public_key text,p_alg integer,p_device text)
returns boolean language plpgsql set search_path='' as $$
declare saved text;
begin
 if p_account not in ('rozha','yunis') or p_account is null or p_alg not in (-7,-257) or p_alg is null or p_id is null or p_public_key is null then raise exception 'Invalid passkey'; end if;
 insert into public.app_passkeys(id,account,public_key,alg,sign_count,device_id,created_at)
 values(p_id,p_account,p_public_key,p_alg,0,p_device,now())
 on conflict(id) do update set device_id=excluded.device_id
 where public.app_passkeys.account=excluded.account and public.app_passkeys.public_key=excluded.public_key and public.app_passkeys.alg=excluded.alg
 returning id into saved;
 return saved is not null;
end $$;
revoke all on function public.app_internal_register_passkey(text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.app_internal_register_passkey(text,text,text,integer,text) to service_role;
