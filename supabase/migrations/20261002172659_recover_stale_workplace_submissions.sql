-- A worker can stop after pressing a workplace button but before reporting its
-- result. Never retry those submissions: make them reconcilable by a person.
alter table public.stock_receipts add column submitted_at timestamptz;
alter table public.stock_item_jobs add column submitted_at timestamptz;

create or replace function public.stock_receipt_claim_submit(p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(729291);
  update public.stock_receipts set status = 'submitting', submitted_at = now()
    where id = p_id and status = 'prepared' and final_approved_at is not null
      and final_approved_at > now() - interval '30 minutes';
  return found;
end $$;

create or replace function public.stock_item_job_claim_submit(p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(729291);
  update public.stock_item_jobs set status = 'submitting', submitted_at = now()
    where id = p_id and status = 'prepared' and final_approved_at is not null
      and final_approved_at > now() - interval '30 minutes';
  return found;
end $$;

create function public.stock_recover_submissions()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(729291);
  with recovered as (
    update public.stock_receipts set status = 'needs_checking', finished_at = now(),
      message = 'The PC did not report a result while saving. Check the workplace before confirming whether it was saved.'
    where (status = 'submitting' and
      coalesce(submitted_at, greatest(final_approved_at, prepared_at, claimed_at, created_at)) < now() - interval '15 minutes')
      or (status = 'prepared' and final_approved_at < now() - interval '30 minutes')
    returning id
  )
  insert into public.stock_events(actor, action, details)
    select 'office-pc', 'receipt_submission_interrupted', jsonb_build_object('receipt_id', id) from recovered;
  with recovered as (
    update public.stock_item_jobs set status = 'needs_checking', finished_at = now(),
      message = 'The PC did not report a result while saving. Check the workplace before confirming whether it was saved.'
    where (status = 'submitting' and
      coalesce(submitted_at, greatest(final_approved_at, prepared_at, claimed_at, created_at)) < now() - interval '15 minutes')
      or (status = 'prepared' and final_approved_at < now() - interval '30 minutes')
    returning id
  )
  insert into public.stock_events(actor, action, details)
    select 'office-pc', 'item_submission_interrupted', jsonb_build_object('job_id', id) from recovered;
end $$;

revoke all on function public.stock_receipt_claim_submit(uuid),
  public.stock_item_job_claim_submit(uuid), public.stock_recover_submissions()
  from public, anon, authenticated;
grant execute on function public.stock_receipt_claim_submit(uuid),
  public.stock_item_job_claim_submit(uuid), public.stock_recover_submissions() to service_role;
