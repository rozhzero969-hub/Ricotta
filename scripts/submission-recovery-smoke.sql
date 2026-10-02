-- Disposable fixtures only. Both recovery and subsequent reconciliation roll back.
begin;
do $$
declare tbl text; fresh uuid; expired uuid; legacy uuid; approval uuid; unapproved uuid; before_events bigint; recovered bigint;
begin
  foreach tbl in array array['stock_receipts', 'stock_item_jobs'] loop
    fresh := gen_random_uuid(); expired := gen_random_uuid(); legacy := gen_random_uuid();
    approval := gen_random_uuid(); unapproved := gen_random_uuid();
    if tbl = 'stock_receipts' then
      insert into public.stock_receipts(id,client_key,supplier_name,invoice,currency,lines,status,created_by,created_at,prepared_at,final_approved_at)
      select id,gen_random_uuid(),'Recovery fixture','Recovery fixture','IQD','[{"itemId":"missing-fixture-item"}]',
        'prepared','rozha',now()-interval '2 hours',now()-interval '2 hours',now()
      from unnest(array[fresh,expired,legacy,approval,unapproved]) as id;
      if not public.stock_receipt_claim_submit(fresh) or not public.stock_receipt_claim_submit(expired) then
        raise exception 'Receipt submission was not claimed'; end if;
      if public.stock_receipt_claim_submit(fresh) then raise exception 'Receipt claimed twice'; end if;
    else
      insert into public.stock_item_jobs(id,client_key,item_name,kind,payload,status,created_by,created_at,prepared_at,final_approved_at)
      select id,gen_random_uuid(),'Recovery fixture','create','{}','prepared','rozha',
        now()-interval '2 hours',now()-interval '2 hours',now()
      from unnest(array[fresh,expired,legacy,approval,unapproved]) as id;
      if not public.stock_item_job_claim_submit(fresh) or not public.stock_item_job_claim_submit(expired) then
        raise exception 'Ingredient submission was not claimed'; end if;
      if public.stock_item_job_claim_submit(fresh) then raise exception 'Ingredient claimed twice'; end if;
    end if;
    execute format('update public.%I set submitted_at=now()-interval ''16 minutes'' where id=$1',tbl) using expired;
    execute format('update public.%I set status=''submitting'',submitted_at=null,final_approved_at=now()-interval ''2 hours'' where id=$1',tbl) using legacy;
    execute format('update public.%I set final_approved_at=now()-interval ''31 minutes'' where id=$1',tbl) using approval;
    execute format('update public.%I set final_approved_at=null where id=$1',tbl) using unapproved;
    select count(*) into before_events from public.stock_events;
    perform public.stock_recover_submissions();
    execute format('select count(*) from public.%I where id=any($1) and status=''needs_checking'' and finished_at is not null',tbl)
      into recovered using array[expired,legacy,approval];
    if recovered <> 3 then raise exception 'Expired or legacy tasks were not recovered'; end if;
    execute format('select count(*) from public.%I where (id=$1 and status=''submitting'' and submitted_at is not null) or (id=$2 and status=''prepared'')',tbl)
      into recovered using fresh,unapproved;
    if recovered <> 2 then raise exception 'Live or unapproved task was changed'; end if;
    if (select count(*) from public.stock_events) <> before_events + 3 then raise exception 'Recovery audit missing'; end if;
    perform public.stock_recover_submissions();
    if (select count(*) from public.stock_events) <> before_events + 3 then raise exception 'Recovery is not idempotent'; end if;
    if exists(select 1 from public.stock_balances) then raise exception 'Recovery changed stock without confirmation'; end if;
    if tbl = 'stock_receipts' then
      perform public.stock_receipt_resolve(expired,'rozha',false,'Checked the workplace: this was not saved');
      if public.stock_receipt_claim_submit(expired) then raise exception 'Recovered receipt was resubmitted'; end if;
    else
      perform public.stock_item_job_resolve(expired,'yunis',false,'Checked the workplace: this was not saved');
      if public.stock_item_job_claim_submit(expired) then raise exception 'Recovered ingredient was resubmitted'; end if;
    end if;
  end loop;
  if has_function_privilege('anon','public.stock_recover_submissions()','EXECUTE') or
     has_function_privilege('authenticated','public.stock_recover_submissions()','EXECUTE') or
     not has_function_privilege('service_role','public.stock_recover_submissions()','EXECUTE') then
    raise exception 'Recovery permissions are incorrect'; end if;
end $$;
rollback;
