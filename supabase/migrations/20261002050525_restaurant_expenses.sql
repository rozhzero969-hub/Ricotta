-- Paid restaurant expenses are separate from purchasing orders and stock.
-- IQD stores whole dinars; USD stores cents. No implicit exchange conversion.
create table public.app_expenses (
  id uuid primary key,
  paid_date date not null check (paid_date between date '1900-01-01' and date '2199-12-31'),
  category text not null check (category in ('food','supplies','rent','utilities','staff','transport','other')),
  description text not null check (length(btrim(description)) between 1 and 160),
  -- Preserve the supplier reference and name even if the catalog is removed.
  supplier_id text check (supplier_id is null or length(supplier_id) between 1 and 160),
  supplier_name text not null default '' check (length(supplier_name) <= 160),
  currency text not null check (currency in ('IQD','USD')),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000),
  payment_method text not null check (payment_method in ('cash','card','bank','other')),
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'active' check (status in ('active','void')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null check (created_by in ('rozha','yunis')),
  updated_by text not null check (updated_by in ('rozha','yunis')),
  voided_at timestamptz,
  voided_by text check (voided_by is null or voided_by in ('rozha','yunis')),
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 1 and 300),
  check ((status='active' and voided_at is null and voided_by is null and void_reason is null) or
         (status='void' and voided_at is not null and voided_by is not null and void_reason is not null))
);

create table public.app_expense_events (
  id uuid primary key, -- the client's stable operation id, never an actor supplied by the browser
  expense_id uuid not null references public.app_expenses(id) on delete restrict,
  action text not null check (action in ('create','edit','void')),
  actor text not null check (actor in ('rozha','yunis')),
  occurred_at timestamptz not null default now(),
  expected_revision integer,
  request_data jsonb not null,
  before_data jsonb,
  after_data jsonb not null
);

alter table public.app_expenses enable row level security;
alter table public.app_expense_events enable row level security;
revoke all on table public.app_expenses,public.app_expense_events from public,anon,authenticated,service_role;
grant select,insert,update on table public.app_expenses to service_role;
-- No destructive ledger operations, and no rewriting existing audit events.
grant select,insert on table public.app_expense_events to service_role;
create index app_expenses_date_idx on public.app_expenses(paid_date desc,id desc);
create unique index app_expense_events_revision_idx on public.app_expense_events(expense_id,(after_data->>'revision'));
create index app_expense_events_expense_idx on public.app_expense_events(expense_id,occurred_at desc,id desc);

create function public.app_internal_write_expense(
  p_id uuid,p_operation_id uuid,p_actor text,p_action text,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prior public.app_expenses%rowtype;
  saved public.app_expenses%rowtype;
  operation public.app_expense_events%rowtype;
  expense_date date;
  amount bigint;
  before_snapshot jsonb;
  supplier_snapshot text;
begin
  if p_id is null or p_operation_id is null or p_actor is null or p_actor not in ('rozha','yunis') or
     p_action is null or p_action not in ('create','edit','void') or
     p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023',message='Invalid expense request';
  end if;
  if p_action <> 'create' and (p_expected_revision is null or p_expected_revision < 1) then
    raise exception using errcode='22023',message='An expense revision is required';
  end if;
  if p_action = 'create' and p_expected_revision is not null then
    raise exception using errcode='22023',message='New expenses cannot have an expected revision';
  end if;
  -- Serialize all mutations of an expense, including create retries before a
  -- row exists. Different expense ids do not contend except rare hash collisions.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,894455));
  select * into operation from public.app_expense_events where id=p_operation_id;
  if found then
    if operation.expense_id <> p_id or operation.actor <> p_actor or operation.action <> p_action or
       operation.expected_revision is distinct from p_expected_revision or operation.request_data <> p_payload then
      raise exception using errcode='23505',message='This operation id was already used for another expense request';
    end if;
    return operation.after_data;
  end if;
  select * into prior from public.app_expenses where id=p_id for update;
  if p_action='create' and found then
    raise exception using errcode='23505',message='This expense id already exists';
  end if;
  if p_action <> 'create' then
    if not found then raise exception using errcode='P0002',message='Expense not found'; end if;
    if prior.revision <> p_expected_revision then
      raise exception using errcode='40001',message='This expense changed. Refresh before saving again';
    end if;
    if prior.status='void' then raise exception using errcode='40001',message='A voided expense cannot be changed'; end if;
    before_snapshot := to_jsonb(prior);
  end if;
  if p_action in ('create','edit') then
    if jsonb_typeof(p_payload->'date') is distinct from 'string' or
       (p_payload->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
       jsonb_typeof(p_payload->'category') is distinct from 'string' or
       (p_payload->>'category') not in ('food','supplies','rent','utilities','staff','transport','other') or
       jsonb_typeof(p_payload->'description') is distinct from 'string' or
       length(btrim(p_payload->>'description')) not between 1 and 160 or
       jsonb_typeof(p_payload->'currency') is distinct from 'string' or
       (p_payload->>'currency') not in ('IQD','USD') or
       jsonb_typeof(p_payload->'amountMinor') is distinct from 'number' or
       (p_payload->>'amountMinor') !~ '^[0-9]{1,13}$' or
       jsonb_typeof(p_payload->'paymentMethod') is distinct from 'string' or
       (p_payload->>'paymentMethod') not in ('cash','card','bank','other') or
       jsonb_typeof(p_payload->'supplierName') is distinct from 'string' or length(p_payload->>'supplierName') > 160 or
       jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes') > 1000 or
       ((p_payload->'supplierId') is distinct from 'null'::jsonb and
          (jsonb_typeof(p_payload->'supplierId') is distinct from 'string' or length(p_payload->>'supplierId') not between 1 and 160)) then
      raise exception using errcode='22023',message='Invalid expense fields';
    end if;
    begin
      expense_date := (p_payload->>'date')::date;
      amount := (p_payload->>'amountMinor')::bigint;
    exception when others then
      raise exception using errcode='22023',message='Invalid expense date or amount';
    end;
    if expense_date < date '1900-01-01' or expense_date > date '2199-12-31' or
       amount not between 1 and 1000000000000 then
      raise exception using errcode='22023',message='Invalid expense date or amount';
    end if;
    supplier_snapshot := p_payload->>'supplierName';
    if (p_payload->>'supplierId') is not null then
      select name into supplier_snapshot from public.app_suppliers where id=p_payload->>'supplierId';
      if not found then
        -- An unchanged historical supplier can outlive its catalog entry.
        -- New selections must still identify a real supplier. Retry detection
        -- above runs first, so catalog deletion cannot break a saved retry.
        if p_action='edit' and prior.supplier_id = p_payload->>'supplierId' then
          supplier_snapshot := prior.supplier_name;
        else
          raise exception using errcode='22023',message='Selected supplier no longer exists';
        end if;
      end if;
    end if;
    if p_action='create' then
      insert into public.app_expenses(id,paid_date,category,description,supplier_id,supplier_name,currency,amount_minor,
          payment_method,notes,created_by,updated_by)
        values(p_id,expense_date,p_payload->>'category',p_payload->>'description',p_payload->>'supplierId',
          supplier_snapshot,p_payload->>'currency',amount,p_payload->>'paymentMethod',p_payload->>'notes',p_actor,p_actor)
        returning * into saved;
    else
      update public.app_expenses set paid_date=expense_date,category=p_payload->>'category',description=p_payload->>'description',
          supplier_id=p_payload->>'supplierId',supplier_name=supplier_snapshot,currency=p_payload->>'currency',amount_minor=amount,
          payment_method=p_payload->>'paymentMethod',notes=p_payload->>'notes',revision=revision+1,updated_at=now(),updated_by=p_actor
        where id=p_id returning * into saved;
    end if;
  else
    if jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 1 and 300 then
      raise exception using errcode='22023',message='A void reason is required';
    end if;
    update public.app_expenses set status='void',revision=revision+1,updated_at=now(),updated_by=p_actor,
        voided_at=now(),voided_by=p_actor,void_reason=p_payload->>'reason'
      where id=p_id returning * into saved;
  end if;
  insert into public.app_expense_events(id,expense_id,action,actor,expected_revision,request_data,before_data,after_data)
    values(p_operation_id,p_id,p_action,p_actor,p_expected_revision,p_payload,before_snapshot,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

-- One database statement reads the filtered page and exact currency totals from
-- the same snapshot. Totals cover all matches, not just the visible page.
create function public.app_internal_list_expenses(
  p_from date default null,p_to date default null,p_category text default null,p_currency text default null,
  p_status text default 'active',p_limit integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 or
     p_status is null or p_status not in ('active','void','all') or
     (p_category is not null and p_category not in ('food','supplies','rent','utilities','staff','transport','other')) or
     (p_currency is not null and p_currency not in ('IQD','USD')) or
     (p_from is not null and p_to is not null and p_from > p_to) then
    raise exception using errcode='22023',message='Invalid expense filters';
  end if;
  with filtered as materialized (
    select * from public.app_expenses e where (p_from is null or e.paid_date>=p_from) and
      (p_to is null or e.paid_date<=p_to) and (p_category is null or e.category=p_category) and
      (p_currency is null or e.currency=p_currency) and (p_status='all' or e.status=p_status)
  ), page as (
    select * from filtered order by paid_date desc,created_at desc,id desc limit p_limit offset p_offset
  ) select jsonb_build_object(
    'expenses',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_date desc,p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    'total',(select count(*) from filtered),'limit',p_limit,'offset',p_offset,
    'ledgerVersion',(select count(*) from public.app_expense_events)::text,
    'hasMore',(select count(*) from filtered)>p_offset+p_limit,
    -- Voided rows remain visible when requested, but never count as spending.
    'totals',jsonb_build_object(
      'IQD',jsonb_build_object('amountMinor',coalesce((select sum(amount_minor) from filtered where currency='IQD' and status='active'),0)::text,
        'count',(select count(*) from filtered where currency='IQD' and status='active')),
      'USD',jsonb_build_object('amountMinor',coalesce((select sum(amount_minor) from filtered where currency='USD' and status='active'),0)::text,
        'count',(select count(*) from filtered where currency='USD' and status='active'))
    )
  ) into result;
  return result;
end $$;

revoke all on function public.app_internal_write_expense(uuid,uuid,text,text,integer,jsonb),
  public.app_internal_list_expenses(date,date,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.app_internal_write_expense(uuid,uuid,text,text,integer,jsonb),
  public.app_internal_list_expenses(date,date,text,text,text,integer,integer) to service_role;
