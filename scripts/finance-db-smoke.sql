-- Run only against the disposable regression database; all fixtures roll back.
begin;
do $$
declare
  first_id uuid := '10000000-0000-4000-8000-000000000001';
  second_id uuid := '10000000-0000-4000-8000-000000000002';
  third_id uuid := '10000000-0000-4000-8000-000000000003';
  edit_op uuid := '20000000-0000-4000-8000-000000000001';
  void_op uuid := '30000000-0000-4000-8000-000000000001';
  payload jsonb := '{"date":"2026-10-02","category":"food","description":"Vegetables","supplierId":"finance-smoke-supplier","supplierName":"Untrusted browser name","currency":"IQD","amountMinor":35000,"paymentMethod":"cash","notes":"Market run"}'::jsonb;
  initial jsonb;
  edited jsonb;
  result jsonb;
begin
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.app_expenses'::regclass,'public.app_expense_events'::regclass)), 'finance RLS enabled';
  assert not has_table_privilege('anon','public.app_expenses','SELECT,INSERT,UPDATE,DELETE'), 'anon has no ledger access';
  assert not has_table_privilege('authenticated','public.app_expense_events','SELECT,INSERT,UPDATE,DELETE'), 'browser has no audit access';
  assert has_table_privilege('service_role','public.app_expenses','SELECT,INSERT,UPDATE'), 'service can maintain ledger';
  assert not has_table_privilege('service_role','public.app_expenses','DELETE,TRUNCATE'), 'service cannot destroy ledger';
  assert not has_table_privilege('service_role','public.app_expense_events','UPDATE,DELETE,TRUNCATE'), 'service cannot rewrite audit';
  assert not has_function_privilege('anon','public.app_internal_write_expense(uuid,uuid,text,text,integer,jsonb)','EXECUTE'), 'anon cannot write expenses';
  assert not has_function_privilege('authenticated','public.app_internal_list_expenses(date,date,text,text,text,integer,integer)','EXECUTE'), 'browser cannot read expense helpers';
  assert has_function_privilege('service_role','public.app_internal_write_expense(uuid,uuid,text,text,integer,jsonb)','EXECUTE'), 'service can write atomically';
  assert (select bool_and(not prosecdef and proconfig @> array['search_path=""']) from pg_proc
    where oid in ('public.app_internal_write_expense(uuid,uuid,text,text,integer,jsonb)'::regprocedure,
      'public.app_internal_list_expenses(date,date,text,text,text,integer,integer)'::regprocedure)), 'helpers are invoker with fixed search path';

  insert into public.app_suppliers(id,name) values ('finance-smoke-supplier','Real supplier');
  initial := public.app_internal_write_expense(first_id,first_id,'yunis','create',null,payload);
  assert initial->>'supplier_name' = 'Real supplier', 'saved supplier name comes from the selected catalog row';
  assert initial->>'created_by' = 'yunis' and initial->>'revision' = '1';
  assert (select count(*)=1 from public.app_expense_events where expense_id=first_id), 'creation has one audit event';
  assert (select before_data is null and after_data=initial from public.app_expense_events where id=first_id), 'creation records full after snapshot';
  -- Deleting or renaming a supplier must not change the saved ledger or break retry.
  delete from public.app_suppliers where id='finance-smoke-supplier';
  result := public.app_internal_write_expense(first_id,first_id,'yunis','create',null,payload);
  assert result=initial, 'same operation returns the original result after supplier deletion';
  assert (select count(*)=1 from public.app_expense_events where expense_id=first_id), 'retry does not add audit or duplicate spending';
  begin
    perform public.app_internal_write_expense(first_id,first_id,'yunis','create',null,payload||'{"amountMinor":35001}');
    assert false, 'reused operation id with changed amount must fail';
  exception when unique_violation then null; end;
  begin
    perform public.app_internal_write_expense(first_id,first_id,'rozha','create',null,payload);
    assert false, 'retry cannot change actor';
  exception when unique_violation then null; end;
  begin
    perform public.app_internal_write_expense(first_id,'20000000-0000-4000-8000-000000000099','yunis','create',null,payload);
    assert false, 'a second operation cannot reuse an expense id';
  exception when unique_violation then null; end;
  begin
    perform public.app_internal_write_expense(second_id,second_id,'rozha','create',null,payload);
    assert false, 'new supplier selections must still exist';
  exception when invalid_parameter_value then null; end;
  assert not exists(select 1 from public.app_expenses where id=second_id), 'invalid creation leaves no ledger row';

  payload := payload||'{"amountMinor":34000,"description":"Vegetables and herbs"}'::jsonb;
  edited := public.app_internal_write_expense(first_id,edit_op,'rozha','edit',1,payload);
  assert edited->>'revision'='2' and edited->>'updated_by'='rozha' and edited->>'created_by'='yunis';
  assert edited->>'supplier_name'='Real supplier', 'editing keeps a removed historical supplier snapshot';
  assert (select before_data=initial and after_data=edited and actor='rozha' from public.app_expense_events where id=edit_op), 'edit audit has complete before/after and session actor';
  result := public.app_internal_write_expense(first_id,edit_op,'rozha','edit',1,payload);
  assert result=edited, 'edit retry is idempotent even after revision advanced';
  assert (select count(*)=2 from public.app_expense_events where expense_id=first_id);
  begin
    perform public.app_internal_write_expense(first_id,'20000000-0000-4000-8000-000000000098','yunis','edit',1,payload);
    assert false, 'stale edit must fail instead of overwrite';
  exception when serialization_failure then null; end;
  begin
    perform public.app_internal_write_expense(first_id,'20000000-0000-4000-8000-000000000097','yunis','edit',null,payload);
    assert false, 'missing revision must fail';
  exception when invalid_parameter_value then null; end;

  perform public.app_internal_write_expense(second_id,second_id,'rozha','create',null,
    payload||'{"supplierId":null,"supplierName":"Local market","currency":"USD","amountMinor":1250}');
  perform public.app_internal_write_expense(third_id,third_id,'yunis','create',null,
    payload||'{"supplierId":null,"supplierName":"","amountMinor":1000}');
  result := public.app_internal_list_expenses('2026-10-01','2026-10-31',null,null,'active',1,0);
  assert result->>'ledgerVersion'='4', 'version counts immutable mutations within the list snapshot';
  assert result->>'total'='3' and result->>'hasMore'='true' and jsonb_array_length(result->'expenses')=1;
  assert result#>>'{totals,IQD,amountMinor}'='35000' and result#>>'{totals,USD,amountMinor}'='1250', 'totals cover all matches despite a one-row page';
  result := public.app_internal_list_expenses('2026-10-01','2026-10-31','food','USD','active',50,0);
  assert result->>'total'='1' and result#>>'{totals,IQD,amountMinor}'='0' and result#>>'{totals,USD,amountMinor}'='1250';

  result := public.app_internal_write_expense(third_id,void_op,'rozha','void',1,'{"reason":"Entered twice"}');
  assert result->>'status'='void' and result->>'revision'='2' and result->>'voided_by'='rozha';
  assert result->>'void_reason'='Entered twice' and result->>'amount_minor'='1000', 'void preserves original financial record';
  assert public.app_internal_write_expense(third_id,void_op,'rozha','void',1,'{"reason":"Entered twice"}')=result, 'void retry is idempotent';
  assert (select count(*)=2 from public.app_expense_events where expense_id=third_id);
  begin
    perform public.app_internal_write_expense(third_id,'30000000-0000-4000-8000-000000000099','yunis','edit',2,payload);
    assert false, 'voided expense cannot be edited';
  exception when serialization_failure then null; end;
  begin
    perform public.app_internal_write_expense(first_id,'30000000-0000-4000-8000-000000000098','yunis','void',2,'{"reason":" "}');
    assert false, 'void reason is required';
  exception when invalid_parameter_value then null; end;
  result := public.app_internal_list_expenses('2026-10-01','2026-10-31',null,null,'all',50,0);
  assert result->>'ledgerVersion'='5', 'void advances export consistency version even when count is unchanged';
  assert result->>'total'='3' and result#>>'{totals,IQD,amountMinor}'='34000' and result#>>'{totals,IQD,count}'='1', 'void never counts as spending even in all-record view';
  result := public.app_internal_list_expenses(null,null,null,null,'void',50,0);
  assert result->>'total'='1' and result#>>'{totals,IQD,amountMinor}'='0';

  begin
    perform public.app_internal_write_expense('10000000-0000-4000-8000-000000000009',first_id,'yunis','create',null,payload);
    assert false, 'operation id cannot be reused for another expense';
  exception when unique_violation then null; end;
  assert not exists(select 1 from public.app_expenses where id='10000000-0000-4000-8000-000000000009');
  begin
    perform public.app_internal_write_expense('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010','intruder','create',null,payload);
    assert false, 'database helper rejects unknown actor';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.app_internal_write_expense(second_id,'20000000-0000-4000-8000-000000000094','yunis','edit',1,
      payload||'{"amountMinor":1.25,"supplierId":null}');
    assert false, 'fractional minor units must fail';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.app_internal_write_expense(second_id,'20000000-0000-4000-8000-000000000093','yunis','edit',1,
      payload||'{"date":"2026-02-29","supplierId":null}');
    assert false, 'nonexistent date must fail';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.app_internal_list_expenses(null,null,null,null,'active',101,0);
    assert false, 'unbounded page must fail';
  exception when invalid_parameter_value then null; end;
end $$;

-- Force an audit-insert failure after the ledger UPDATE, verifying rollback.
create function pg_temp.finance_reject_audit() returns trigger language plpgsql as $$
begin raise exception 'Deliberate audit failure'; end $$;
create trigger finance_smoke_audit_failure before insert on public.app_expense_events
  for each row when (new.expense_id='10000000-0000-4000-8000-000000000001'::uuid)
  execute function pg_temp.finance_reject_audit();
do $$ begin
  begin
    perform public.app_internal_write_expense('10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000092','yunis','edit',2,
      '{"date":"2026-10-02","category":"food","description":"Should roll back","supplierId":null,"supplierName":"", "currency":"IQD","amountMinor":999,"paymentMethod":"cash","notes":""}');
    assert false, 'write with failed audit must not succeed';
  exception when raise_exception then
    assert sqlerrm='Deliberate audit failure';
  end;
  assert (select revision=2 and amount_minor=34000 and description='Vegetables and herbs'
    from public.app_expenses where id='10000000-0000-4000-8000-000000000001'), 'ledger rolls back when audit fails';
  assert not exists(select 1 from public.app_expense_events where id='20000000-0000-4000-8000-000000000092');
end $$;
drop trigger finance_smoke_audit_failure on public.app_expense_events;

-- Ensure exact totals above JavaScript's safe integer range. Direct inserts here
-- are fixtures only; the application uses the audited write helper.
insert into public.app_expenses(id,paid_date,category,description,currency,amount_minor,payment_method,created_by,updated_by)
  select ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'2199-12-31','other','Large-total fixture','IQD',
    1000000000000,'cash','rozha','rozha' from generate_series(1,10000) g;
do $$ declare result jsonb; begin
  result := public.app_internal_list_expenses('2199-12-31','2199-12-31',null,null,'active',1,9999);
  assert result#>>'{totals,IQD,amountMinor}'='10000000000000000', 'large aggregate total stays an exact string';
  assert result->>'total'='10000' and result->>'hasMore'='false' and jsonb_array_length(result->'expenses')=1;
end $$;
rollback;
