-- The Edge APIs use the service role. These helpers are deliberately unavailable
-- to browser roles, and each call completes its related writes in one transaction.
create function public.app_internal_save_order(p_id text, p_date timestamptz, p_account text, p_lines jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare saved_id text;
begin
  if p_id is null or length(p_id) not between 1 and 160 or
     p_date is null or p_account is null or p_account not in ('rozha','yunis') or
     p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Invalid order';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 800 then raise exception 'Invalid order lines'; end if;
  -- ON CONFLICT waits for an in-flight save with this id to commit or roll back.
  insert into public.app_orders(id,status,created_at,sent_at,created_by,sent_by)
    values(p_id,'sent',p_date,p_date,p_account,p_account)
    on conflict(id) do nothing returning id into saved_id;
  if saved_id is null then return false; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as l(item_name text, qty numeric)
      where l.item_name is null or length(l.item_name) not between 1 and 160 or
        l.qty is null or l.qty <= 0 or l.qty > 99999) then
    raise exception 'Invalid order line';
  end if;
  insert into public.app_order_lines(order_id,supplier_id,supplier_name,item_id,item_name,unit_id,qty)
    select p_id,l.supplier_id,l.supplier_name,l.item_id,l.item_name,l.unit_id,l.qty
    from jsonb_to_recordset(p_lines) as l(supplier_id text,supplier_name text,item_id text,item_name text,unit_id text,qty numeric);
  -- Always lock tracked rows in the same order so concurrent multi-item orders
  -- cannot deadlock, then add to the current value rather than a stale snapshot.
  perform p.item_id from public.app_item_pars p where p.item_id in (
    select l.item_id from jsonb_to_recordset(p_lines) as l(item_id text))
    order by p.item_id for update;
  update public.app_item_pars p set est_qty = round(p.est_qty + q.qty, 2), est_updated_at = now()
    from (select l.item_id,sum(l.qty) as qty from jsonb_to_recordset(p_lines) as l(item_id text,qty numeric)
      group by l.item_id) q where p.item_id = q.item_id;
  return true;
end $$;

create function public.app_internal_decay_stock(p_item text,p_decay numeric,p_date date)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed text;
begin
  if p_item is null or p_date is null or p_decay is null or p_decay < 0 or
     p_decay::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid stock decay'; end if;
  update public.app_item_pars set est_qty=round(greatest(0,est_qty-p_decay),2),last_decay_date=p_date
    where item_id=p_item and (last_decay_date is null or last_decay_date < p_date)
    returning item_id into changed;
  return changed is not null;
end $$;

create function public.app_internal_reserve_assistant(p_device_id text,p_account text,p_model text,p_device_limit integer,p_total_limit integer)
returns bigint language plpgsql security invoker set search_path = '' as $$
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
end $$;

create function public.app_internal_reserve_login(p_fingerprints text[],p_window_seconds integer,p_ip_limit integer,p_global_limit integer)
returns bigint[] language plpgsql security invoker set search_path = '' as $$
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
end $$;

create function public.stock_save_item_settings(p_item text,p_actor text,p_counting text,p_per numeric,p_low numeric,p_workplace text,p_usage text,p_per_usage numeric,p_save_usage boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_actor is null or p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  perform public.stock_save_settings(p_item,p_actor,p_counting,p_per,p_low,p_workplace);
  if p_save_usage then perform public.stock_save_workplace_units(p_item,p_actor,p_usage,p_per_usage); end if;
end $$;

revoke all on function public.app_internal_save_order(text,timestamptz,text,jsonb),
  public.app_internal_decay_stock(text,numeric,date),
  public.app_internal_reserve_assistant(text,text,text,integer,integer),
  public.app_internal_reserve_login(text[],integer,integer,integer),
  public.stock_save_item_settings(text,text,text,numeric,numeric,text,text,numeric,boolean)
  from public,anon,authenticated;
grant execute on function public.app_internal_save_order(text,timestamptz,text,jsonb),
  public.app_internal_decay_stock(text,numeric,date),
  public.app_internal_reserve_assistant(text,text,text,integer,integer),
  public.app_internal_reserve_login(text[],integer,integer,integer),
  public.stock_save_item_settings(text,text,text,numeric,numeric,text,text,numeric,boolean)
  to service_role;

create index if not exists app_assistant_usage_time_idx on public.app_assistant_usage(created_at);

-- A SELECT-before-INSERT check cannot prevent two workers' ingredient jobs.
create unique index stock_item_jobs_one_active_item on public.stock_item_jobs(item_id)
  where item_id is not null and status in ('waiting','preparing','prepared','submitting','needs_checking');

-- The old transfer tables were dropped, but their cleanup used a six-argument
-- signature. This seven-argument function still references those missing tables.
drop function if exists public.transfer_recount(uuid,text,text,numeric,timestamptz,text,text);
