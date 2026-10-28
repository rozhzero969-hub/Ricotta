-- Audit repairs (F09, F10, F11, F20), 2026-10-28: Rico's WhatsApp test sending and AI usage.
-- F09: every send is written down (status 'pending') with a key made from the account, supplier and exact
--      message BEFORE it goes out. The same order again within 15 minutes (a retry, or a backup AI repeating
--      the request) gets the earlier result instead of a second message. Unclear outcomes stay 'uncertain'
--      and are never sent again automatically.
-- F10: the hourly limit is reserved inside this one locked step, so two requests at once cannot both take
--      the last slot, and a database problem means nothing is sent.
-- F11: a long order goes as several numbered messages; the row keeps exactly what was sent and how many parts.
-- F20: each AI attempt of a reply (provider, model, tokens, outcome) is kept with its usage row, and Admin's
--      per-AI totals are added up here, in the database, instead of reading rows in the api.

alter table public.app_rico_orders drop constraint if exists app_rico_orders_status_check;
alter table public.app_rico_orders add constraint app_rico_orders_status_check
  check (status in ('pending', 'sent', 'partial', 'uncertain', 'failed'));
alter table public.app_rico_orders add column if not exists idem_key text check (idem_key is null or length(idem_key) = 64);
alter table public.app_rico_orders add column if not exists content text check (content is null or length(content) <= 80000);
alter table public.app_rico_orders add column if not exists parts integer not null default 1 check (parts between 1 and 20);
alter table public.app_rico_orders add column if not exists sent_parts integer not null default 0 check (sent_parts between 0 and 20);
alter table public.app_rico_orders add column if not exists message_ids text[] not null default '{}';
create index if not exists app_rico_orders_key_idx on public.app_rico_orders (idem_key, created_at desc);

create or replace function public.app_internal_rico_send_reserve(p_account text, p_key text, p_supplier_id text, p_supplier_name text,
  p_lines jsonb, p_reason text, p_content text, p_parts integer, p_limit integer)
returns jsonb language plpgsql set search_path = '' as $$
declare dup record; used integer; new_id bigint;
begin
  if p_account is null or p_account not in ('rozha','yunis') or p_key is null or length(p_key) <> 64
     or p_parts is null or p_parts not between 1 and 20 or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Invalid send';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rico_send', 0));
  select id, status, created_at into dup from public.app_rico_orders
    where idem_key = p_key and created_at > now() - interval '15 minutes' and status <> 'failed'
    order by created_at desc limit 1;
  if found then return jsonb_build_object('duplicate', true, 'id', dup.id, 'status', dup.status, 'at', dup.created_at); end if;
  select coalesce(sum(case when status = 'pending' then parts when status in ('sent','partial','uncertain') then greatest(sent_parts, 1) else 0 end), 0)
    into used from public.app_rico_orders where created_at > now() - interval '1 hour';
  if used + p_parts > p_limit then return jsonb_build_object('limited', true, 'used', used); end if;
  insert into public.app_rico_orders(account, supplier_id, supplier_name, lines, reason, status, idem_key, content, parts)
    values (p_account, p_supplier_id, p_supplier_name, p_lines, coalesce(p_reason, ''), 'pending', p_key, p_content, p_parts)
    returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;
revoke all on function public.app_internal_rico_send_reserve(text,text,text,text,jsonb,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.app_internal_rico_send_reserve(text,text,text,text,jsonb,text,text,integer,integer) to service_role;

alter table public.app_assistant_usage add column if not exists attempts jsonb
  check (attempts is null or (jsonb_typeof(attempts) = 'array' and jsonb_array_length(attempts) <= 10));

create or replace function public.app_internal_ai_usage(p_from timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  with tries as (
    select a->>'provider' as provider, coalesce((a->>'input')::bigint, 0) as input, coalesce((a->>'output')::bigint, 0) as output,
           coalesce((a->>'answered')::boolean, false) as answered
      from public.app_assistant_usage u cross join lateral jsonb_array_elements(u.attempts) a
      where u.created_at >= p_from and u.attempts is not null
    union all
    select case
             when model ~* '^(transcribe:|transfer:)?claude' then 'anthropic'
             when model ~* '^(transcribe:|transfer:)?gemini' then 'gemini'
             when model like 'pending:%' or model ~ ':none$' then null
             else 'groq' end,
           coalesce(input_tokens, 0), coalesce(output_tokens, 0), true
      from public.app_assistant_usage where created_at >= p_from and attempts is null
  )
  select coalesce(jsonb_object_agg(provider, jsonb_build_object('calls', calls, 'input', input, 'output', output)), '{}'::jsonb)
  from (select provider, count(*) filter (where answered) as calls, sum(input) as input, sum(output) as output
        from tries where provider in ('anthropic','gemini','groq') group by provider) x;
$$;
revoke all on function public.app_internal_ai_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_ai_usage(timestamptz) to service_role;
