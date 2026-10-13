-- Order cut-offs, repeat orders, replies to Rozha's notes, Face ID sign-in (passkeys)
-- and a small archive of every finished month.

-- ---------- Order cut-off: the time a supplier stops taking orders (Erbil time) ----------
alter table public.app_suppliers add column if not exists cutoff text;
alter table public.app_suppliers drop constraint if exists app_suppliers_cutoff_check;
alter table public.app_suppliers add constraint app_suppliers_cutoff_check
  check (cutoff is null or cutoff ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- The Record shows the cut-off like the other supplier fields.
create or replace function public.app_internal_record_fields(p_table text, p_row jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare u text; s text; r text := 'off';
begin
 if p_row is null then return '{}'::jsonb; end if;
 if p_table='items' then
  select en into u from public.app_units where id=p_row->>'unit_id';
  select name into s from public.app_suppliers where id=p_row->>'supplier_id';
  return jsonb_build_object('name',p_row->>'name','unit',coalesce(u,''),'supplier',coalesce(s,''),'note',coalesce(p_row->>'note',''));
 elsif p_table='suppliers' then
  if p_row->'reminder'->>'enabled'='true' then
   select coalesce(p_row->'reminder'->>'time','')||'|'||coalesce(string_agg(d::text,',' order by ord),'') into r
    from unnest(array[6,0,1,2,3,4,5]) with ordinality v(d,ord)
    where (p_row->'reminder'->'days') @> to_jsonb(array[d]);
  end if;
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r,'cutoff',coalesce(p_row->>'cutoff',''));
 elsif p_table='units' then
  return jsonb_build_object('name',p_row->>'en','nameKu',coalesce(p_row->>'ku',''),'nameAr',coalesce(p_row->>'ar',''));
 end if;
 raise exception 'Invalid catalog';
end $$;

-- Suppliers keep their cut-off when an older app saves them without one.
create or replace function public.app_internal_catalog_change(p_table text, p_id text, p_row jsonb, p_actor text, p_device text)
returns void language plpgsql set search_path = '' as $$
declare oldrow jsonb; newrow jsonb; prev jsonb; nextrow jsonb; fields jsonb; act text; typ text;
begin
 if p_table not in ('items','suppliers','units') or p_actor not in ('rozha','yunis') or p_id is null then raise exception 'Invalid catalog change'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_table||':'||p_id,0));
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update','app_'||p_table) into oldrow using p_id;
 prev:=public.app_internal_record_fields(p_table,oldrow);
 if p_row is null then
  execute format('delete from public.%I where id=$1','app_'||p_table) using p_id;
 elsif p_table='suppliers' then
  insert into public.app_suppliers(id,name,phone,reminder,cutoff) values(p_id,p_row->>'name',p_row->>'phone',p_row->'reminder',nullif(p_row->>'cutoff',''))
   on conflict(id) do update set name=excluded.name,phone=excluded.phone,reminder=excluded.reminder,
    cutoff=case when p_row ? 'cutoff' then excluded.cutoff else public.app_suppliers.cutoff end,updated_at=now()
   returning to_jsonb(app_suppliers.*) into newrow;
 elsif p_table='items' then
  insert into public.app_items(id,name,unit_id,supplier_id,sort_order,note) values(p_id,p_row->>'name',p_row->>'unit_id',p_row->>'supplier_id',(p_row->>'sort_order')::integer,nullif(p_row->>'note',''))
   on conflict(id) do update set name=excluded.name,unit_id=excluded.unit_id,supplier_id=excluded.supplier_id,
    sort_order=case when p_row ? 'sort_order' then excluded.sort_order else public.app_items.sort_order end,
    note=case when p_row ? 'note' then excluded.note else public.app_items.note end,updated_at=now() returning to_jsonb(app_items.*) into newrow;
 else
  insert into public.app_units(id,en,ku,ar) values(p_id,p_row->>'en',p_row->>'ku',p_row->>'ar')
   on conflict(id) do update set en=excluded.en,ku=excluded.ku,ar=excluded.ar returning to_jsonb(app_units.*) into newrow;
 end if;
 if oldrow is null and newrow is null then return; end if;
 nextrow:=public.app_internal_record_fields(p_table,newrow);
 act:=case when oldrow is null then 'add' when newrow is null then 'delete' else 'edit' end;
 typ:=case p_table when 'suppliers' then 'supplier' when 'items' then 'item' else 'unit' end;
 select coalesce(jsonb_agg(case act when 'add' then jsonb_build_object('k',k,'to',v) when 'delete' then jsonb_build_object('k',k,'from',v)
  else jsonb_build_object('k',k,'from',prev->>k,'to',v) end),'[]'::jsonb) into fields
 from jsonb_each_text(case when act='delete' then prev else nextrow end) f(k,v)
 where (act='edit' and coalesce(prev->>k,'')<>v) or
 (act='add' and (k='name' or (p_table='items' and (k<>'note' or v<>'')) or (v<>'' and v<>'off'))) or
 (act='delete' and k<>'reminder' and (k='name' or (p_table='items' and (k<>'note' or v<>'')) or v<>''));
 if fields='[]'::jsonb then return; end if;
 insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
 values(gen_random_uuid()::text,p_actor,p_device,act,typ,coalesce(nextrow->>'name',prev->>'name'),
 jsonb_build_object('by',initcap(p_actor),'fields',fields,'source','server'));
end $$;

-- ---------- Repeat orders: a saved order that comes back on chosen weekdays ----------
create table if not exists public.app_repeat_orders(
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  days smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]::smallint[]),
  entries jsonb not null check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) between 1 and 40 and pg_column_size(entries) <= 65536),
  created_by text not null check (created_by in ('rozha', 'yunis')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_repeat_orders enable row level security;
revoke all on table public.app_repeat_orders from anon, authenticated;

-- ---------- Yunis can answer Rozha's notes ----------
alter table public.app_notes add column if not exists reply text;
alter table public.app_notes add column if not exists replied_at timestamptz;
alter table public.app_notes add column if not exists reply_seen_at timestamptz;
alter table public.app_notes drop constraint if exists app_notes_reply_check;
alter table public.app_notes add constraint app_notes_reply_check check (reply is null or char_length(reply) between 1 and 300);

-- ---------- Face ID / fingerprint sign-in (WebAuthn passkeys) ----------
-- Only the public key is kept; the private key never leaves the phone.
create table if not exists public.app_passkeys(
  id text primary key check (char_length(id) between 16 and 1024),
  account text not null check (account in ('rozha', 'yunis')),
  public_key text not null check (char_length(public_key) between 60 and 2048),
  alg integer not null check (alg in (-7, -257)),
  sign_count bigint not null default 0,
  device_id text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists app_passkeys_account_idx on public.app_passkeys(account);
alter table public.app_passkeys enable row level security;
revoke all on table public.app_passkeys from anon, authenticated;

-- One-time challenges for registering and signing in (valid for a few minutes).
create table if not exists public.app_passkey_challenges(
  token_hash text primary key,
  challenge text not null,
  purpose text not null check (purpose in ('register', 'login')),
  account text check (account in ('rozha', 'yunis')),
  expires_at timestamptz not null
);
alter table public.app_passkey_challenges enable row level security;
revoke all on table public.app_passkey_challenges from anon, authenticated;

-- ---------- Month archive: a summary of every finished month, kept after History is cleared ----------
create table if not exists public.app_month_summaries(
  month text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.app_month_summaries enable row level security;
revoke all on table public.app_month_summaries from anon, authenticated;

create or replace function public.app_internal_month_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = '' as $$
 with o as (
  select id, (coalesce(sent_at, created_at) at time zone 'Asia/Baghdad') as t, sent_by
  from public.app_orders where status = 'sent' and coalesce(sent_at, created_at) >= p_from and coalesce(sent_at, created_at) < p_to
 ), l as (
  select l.* from public.app_order_lines l join o on o.id = l.order_id
 )
 select jsonb_build_object(
  'orders', (select count(*) from o),
  'activeDays', (select count(distinct t::date) from o),
  'lines', (select count(*) from l),
  'byPerson', (select coalesce(jsonb_object_agg(who, n), '{}'::jsonb) from (select coalesce(sent_by, 'unknown') who, count(*) n from o group by 1) x),
  'byWeekday', (select jsonb_agg(coalesce(x.n, 0) order by d) from generate_series(0, 6) d left join (select extract(dow from t)::int dw, count(*) n from o group by 1) x on x.dw = d),
  'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'orders', orders, 'lines', lines) order by orders desc, name), '[]'::jsonb)
    from (select coalesce(nullif(l.supplier_name, ''), '-') name, count(distinct l.order_id) orders, count(*) lines from l group by 1) x),
  'topItems', (select coalesce(jsonb_agg(jsonb_build_object('name', item_name, 'unit', unit_id, 'times', times, 'qty', qty) order by times desc, qty desc), '[]'::jsonb)
    from (select item_name, unit_id, count(*) times, sum(qty) qty from l group by 1, 2 order by 3 desc, 4 desc limit 10) x)
 );
$$;

-- Before a month is cleared from History, its summary goes into the archive (once).
create or replace function public.app_internal_monthly_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare cutoff timestamptz := date_trunc('month', p_now at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad'; m record;
begin
 for m in select date_trunc('month', coalesce(sent_at, created_at) at time zone 'Asia/Baghdad') as ms
   from public.app_orders where status = 'sent' and coalesce(sent_at, created_at) < cutoff group by 1
 loop
  insert into public.app_month_summaries(month, data)
  values (to_char(m.ms, 'YYYY-MM'), public.app_internal_month_summary(m.ms at time zone 'Asia/Baghdad', (m.ms + interval '1 month') at time zone 'Asia/Baghdad'))
  on conflict (month) do nothing;
 end loop;
 delete from public.app_orders where coalesce(sent_at, created_at) < cutoff;
 delete from public.app_audit_events where occurred_at < cutoff;
end $$;

-- Expired Face ID challenges go with the daily cleanup.
create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_recovery_tickets where expires_at<now();
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
 delete from public.app_notes where created_at<now()-interval '60 days';
 delete from public.app_passkey_challenges where expires_at<now();
end $$;

-- Restrict every helper to the trusted server role.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'app_internal_%'
 loop execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role'; end loop;
end $$;
