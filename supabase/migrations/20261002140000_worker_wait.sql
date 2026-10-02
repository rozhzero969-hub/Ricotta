-- Instant pickup: the office PC asks "is there anything for me?" and the server holds that question
-- open until the answer is yes (or ~25 seconds pass). These two checks are what it asks the database.
-- Each mirrors exactly what the PC would claim, so a "yes" always has something to pick up.
-- p_live: the PC may press "Move it" (ALLOW_SUBMIT=1). In test mode final-approved transfers are not its work.
create or replace function public.stock_worker_has_work(p_live boolean default true)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from public.stock_requests where status = 'waiting'
           and ((p_live and final_approved_at is not null)
                or (final_approved_at is null and (previewed_at is null or previewed_at < now() - interval '10 minutes'))))
    or (p_live and exists(select 1 from public.stock_requests where status = 'running' and claimed_at < now() - interval '15 minutes'))
    or exists(select 1 from public.stock_receipts where status = 'waiting'
              or (status = 'preparing' and claimed_at < now() - interval '10 minutes'))
    or exists(select 1 from public.stock_item_jobs where status = 'waiting'
              or (status = 'preparing' and claimed_at < now() - interval '10 minutes'))
    or exists(select 1 from public.stock_worker_control where id = 1 and signin_requested_at is not null
              and (signin_checked_at is null or signin_checked_at < signin_requested_at));
$$;

create or replace function public.stock_launcher_has_work()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.stock_worker_control where id = 1 and start_requested_at is not null
                and (start_handled_at is null or start_handled_at < start_requested_at));
$$;

revoke all on function public.stock_worker_has_work(boolean) from public, anon, authenticated;
revoke all on function public.stock_launcher_has_work() from public, anon, authenticated;
grant execute on function public.stock_worker_has_work(boolean) to service_role;
grant execute on function public.stock_launcher_has_work() to service_role;
