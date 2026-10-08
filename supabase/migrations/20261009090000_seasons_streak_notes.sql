-- Seasons, the kitchen streak, kitchen notes, the weather cache, pinned items,
-- item notes and undoing a just-sent order. Every helper stays server-only.

-- Themes: the five colour themes plus the holiday themes. A holiday theme
-- turns on by itself on its dates (in the app) unless auto_theme is off.
alter table public.app_accounts drop constraint if exists app_accounts_theme_check;
alter table public.app_accounts add constraint app_accounts_theme_check check (theme = any (array[
  'ricotta','graphite','ocean','saffron','berry',
  'halloween','winter','newroz','ramadan','summer','eid','christmas','flagday','spring','autumn','match']));
alter table public.app_accounts add column if not exists auto_theme boolean not null default true;
-- Items each person pinned to the top of the Order screen.
alter table public.app_accounts add column if not exists pins text[] not null default '{}';
alter table public.app_accounts drop constraint if exists app_accounts_pins_check;
alter table public.app_accounts add constraint app_accounts_pins_check check (cardinality(pins) <= 60);

-- A short note on an item, sent with it in the WhatsApp message ("ripe, not soft").
alter table public.app_items add column if not exists note text;
alter table public.app_items drop constraint if exists app_items_note_check;
alter table public.app_items add constraint app_items_note_check check (note is null or char_length(note) <= 120);

-- ---------- The kitchen streak ----------
-- One streak for the whole kitchen: any order sent on a Baghdad calendar day
-- keeps it going. History is deleted every month, so the streak keeps its own row.
create table if not exists public.app_streak(
  id boolean primary key default true check (id),
  count integer not null default 0 check (count >= 0),
  best integer not null default 0 check (best >= 0),
  last_day date,
  lost_count integer not null default 0 check (lost_count >= 0),
  lost_day date,
  prev jsonb,           -- the state before the latest day was added, so undoing that day's only order can go back
  updated_at timestamptz not null default now()
);
alter table public.app_streak enable row level security;
revoke all on table public.app_streak from anon, authenticated;

-- Start from the orders this month already has: the run of days ending today or yesterday.
insert into public.app_streak(id, count, best, last_day)
select true, coalesce(cur.n, 0), coalesce(top.n, 0), cur.last_day
from (select 1) one
left join lateral (
  with days as (select distinct (coalesce(sent_at, created_at) at time zone 'Asia/Baghdad')::date d from public.app_orders where status = 'sent'),
  runs as (select d, d - (row_number() over (order by d))::int grp from days)
  select count(*)::int n, max(d) last_day from runs group by grp
  having max(d) >= (now() at time zone 'Asia/Baghdad')::date - 1
  order by max(d) desc limit 1
) cur on true
left join lateral (
  with days as (select distinct (coalesce(sent_at, created_at) at time zone 'Asia/Baghdad')::date d from public.app_orders where status = 'sent'),
  runs as (select d, d - (row_number() over (order by d))::int grp from days)
  select max(c)::int n from (select count(*) c from runs group by grp) x
) top on true
on conflict (id) do nothing;

-- An order went out on p_day (Baghdad). Returns the streak afterwards.
create or replace function public.app_internal_streak_hit(p_day date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.app_streak; before jsonb;
begin
  if p_day is null then raise exception 'Invalid day'; end if;
  insert into public.app_streak(id) values (true) on conflict (id) do nothing;
  select * into s from public.app_streak where id for update;
  if s.last_day is not null and p_day <= s.last_day then
    return jsonb_build_object('count', s.count, 'best', s.best, 'changed', false, 'milestone', false);
  end if;
  before := jsonb_build_object('day', p_day, 'count', s.count, 'best', s.best, 'last_day', s.last_day, 'lost_count', s.lost_count, 'lost_day', s.lost_day);
  if s.last_day is not null and p_day = s.last_day + 1 then
    s.count := s.count + 1;
  else
    if s.count > 0 and s.last_day is not null then s.lost_count := s.count; s.lost_day := s.last_day + 1; end if;
    s.count := 1;
  end if;
  s.best := greatest(s.best, s.count);
  update public.app_streak set count = s.count, best = s.best, last_day = p_day, lost_count = s.lost_count,
    lost_day = s.lost_day, prev = before, updated_at = now() where id;
  return jsonb_build_object('count', s.count, 'best', s.best, 'changed', true,
    'milestone', s.count = any (array[7,14,30,60,100,150,200,300,365,500,1000]));
end $$;

-- The only order of p_day was taken back: the day no longer counts.
create or replace function public.app_internal_streak_unhit(p_day date)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.app_streak;
begin
  if p_day is null then return; end if;
  if exists (select 1 from public.app_orders where status = 'sent'
      and (coalesce(sent_at, created_at) at time zone 'Asia/Baghdad')::date = p_day) then return; end if;
  select * into s from public.app_streak where id for update;
  if not found or s.prev is null or s.last_day is distinct from p_day or (s.prev->>'day')::date is distinct from p_day then return; end if;
  update public.app_streak set count = (s.prev->>'count')::int, best = (s.prev->>'best')::int,
    last_day = (s.prev->>'last_day')::date, lost_count = (s.prev->>'lost_count')::int,
    lost_day = (s.prev->>'lost_day')::date, prev = null, updated_at = now() where id;
end $$;

-- Rico brings a broken streak back (free, it is a game). Works up to 7 days after it broke.
create or replace function public.app_internal_streak_recover(p_today date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.app_streak;
begin
  select * into s from public.app_streak where id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if s.count > 0 and s.last_day is not null and s.last_day < p_today - 1 then
    -- Broken, and nothing has been sent since: it carries on from yesterday.
    if s.last_day < p_today - 8 then return jsonb_build_object('ok', false, 'reason', 'too_old'); end if;
    s.last_day := p_today - 1;
  elsif s.lost_count > 0 and s.lost_day is not null and s.lost_day >= p_today - 7 then
    -- Broken, then started again: the old days are added back.
    s.count := s.lost_count + s.count;
  else
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_recover');
  end if;
  s.best := greatest(s.best, s.count);
  update public.app_streak set count = s.count, best = s.best, last_day = s.last_day, lost_count = 0,
    lost_day = null, prev = null, updated_at = now() where id;
  return jsonb_build_object('ok', true, 'count', s.count, 'best', s.best);
end $$;

-- ---------- Kitchen notes: Rozha writes, Yunis reads ----------
create table if not exists public.app_notes(
  id bigint generated always as identity primary key,
  body text not null check (char_length(body) between 1 and 500),
  created_by text not null default 'rozha' check (created_by = 'rozha'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  done_at timestamptz,
  reminded_at timestamptz
);
create index if not exists app_notes_created_at_idx on public.app_notes(created_at desc);
alter table public.app_notes enable row level security;
revoke all on table public.app_notes from anon, authenticated;

-- ---------- Erbil weather, refreshed by the reminder tick ----------
create table if not exists public.app_weather(
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz
);
insert into public.app_weather(id) values (true) on conflict (id) do nothing;
alter table public.app_weather enable row level security;
revoke all on table public.app_weather from anon, authenticated;

-- ---------- Catalog: item notes, and the reminder field in the Record ----------
-- The reminder is stored as {enabled, time, days}; the Record used to look for "on" and always wrote "off".
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
  return jsonb_build_object('name',p_row->>'name','phone',coalesce(p_row->>'phone',''),'reminder',r);
 elsif p_table='units' then
  return jsonb_build_object('name',p_row->>'en','nameKu',coalesce(p_row->>'ku',''),'nameAr',coalesce(p_row->>'ar',''));
 end if;
 raise exception 'Invalid catalog';
end $$;

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
  insert into public.app_suppliers(id,name,phone,reminder) values(p_id,p_row->>'name',p_row->>'phone',p_row->'reminder')
   on conflict(id) do update set name=excluded.name,phone=excluded.phone,reminder=excluded.reminder,updated_at=now() returning to_jsonb(app_suppliers.*) into newrow;
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

-- ---------- Orders: Rozha deletes any; whoever sent one may undo it for 15 minutes ----------
create or replace function public.app_internal_delete_order(p_id text, p_actor text, p_device text)
returns void language plpgsql set search_path = '' as $$
declare removed text; sent timestamptz; by_whom text; made timestamptz;
begin
 if p_actor not in ('rozha','yunis') then raise exception 'Forbidden'; end if;
 select coalesce(sent_at,created_at), created_by, created_at into sent, by_whom, made from public.app_orders where id=p_id for update;
 if not found then return; end if;
 if p_actor <> 'rozha' and (by_whom is distinct from p_actor or made < now() - interval '15 minutes') then raise exception 'Forbidden'; end if;
 delete from public.app_orders where id=p_id returning id into removed;
 if removed is not null then
  insert into public.app_audit_events(id,actor,device_id,action,entity_type,entity_name,payload)
  values(gen_random_uuid()::text,p_actor,p_device,'delete','order',p_id,jsonb_build_object('source','server'));
  perform public.app_internal_streak_unhit((sent at time zone 'Asia/Baghdad')::date);
 end if;
end $$;

-- Old notes go with the daily cleanup.
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
end $$;

-- Restrict every helper to the trusted server role.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'app_internal_%'
 loop execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role'; end loop;
end $$;
