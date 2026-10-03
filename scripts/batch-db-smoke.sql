-- Database smoke test for multi-item transfers (batches). Run after the migrations; everything rolls back.
begin;
do $$
declare
  b1 uuid := gen_random_uuid(); k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();
  ids uuid[]; ids2 uuid[]; lead uuid; other uuid; v numeric; rejected boolean; claimed uuid; n int;
  lines jsonb;
begin
  insert into app_units(id,en) values ('pc','piece'),('kg','kg');
  insert into app_items(id,name,unit_id) values ('i1','Flour','pc'),('i2','Sugar','pc'),('i3','Salt','pc');
  insert into stock_workers(id,token_hash) values ('office-pc','smoke') on conflict do nothing;
  perform stock_save_settings('i1','rozha','pc',null,null);
  perform stock_save_settings('i2','rozha','pc',null,null);
  perform stock_save_settings('i3','rozha','pc',null,null);
  perform stock_recount('i1','Main Storage',10,now(),'rozha','t');
  perform stock_recount('i2','Main Storage',10,now(),'rozha','t');
  perform stock_recount('i3','Main Storage',2,now(),'rozha','t');

  -- A batch is queued whole, in order, with one lead.
  lines := jsonb_build_array(
    jsonb_build_object('key',k1,'item','i1','qty',3,'name','Flour','unit','piece'),
    jsonb_build_object('key',k2,'item','i2','qty',4,'name','Sugar','unit','piece'));
  ids := stock_submit_batch(b1,'Main Storage','Pizza',false,'rozha',lines);
  if array_length(ids,1) <> 2 then raise exception 'Batch did not return both ids'; end if;
  if (select count(*) from stock_requests where batch_id = b1) <> 2 then raise exception 'Batch rows missing'; end if;
  if exists(select 1 from stock_requests where batch_id = b1 and batch_size <> 2) then raise exception 'Batch size not stored'; end if;
  if (select batch_pos from stock_requests where id = ids[1]) <> 0 or (select batch_pos from stock_requests where id = ids[2]) <> 1 then
    raise exception 'Batch order not kept'; end if;
  lead := ids[1]; other := ids[2];
  if stock_reserved('i1','Main Storage') <> 3 or stock_reserved('i2','Main Storage') <> 4 then raise exception 'Batch lines not reserved'; end if;

  -- Retrying the same request queues nothing new.
  ids2 := stock_submit_batch(b1,'Main Storage','Pizza',false,'rozha',lines);
  if ids2 <> ids then raise exception 'Retry returned different ids'; end if;
  if (select count(*) from stock_requests where batch_id = b1) <> 2 then raise exception 'Retry queued the transfer twice'; end if;

  -- Bad batches queue nothing at all.
  rejected := false;
  begin perform stock_submit_batch(gen_random_uuid(),'Main Storage','Pizza',false,'rozha',jsonb_build_array(
      jsonb_build_object('key',gen_random_uuid(),'item','i3','qty',1,'name','Salt','unit','piece'),
      jsonb_build_object('key',gen_random_uuid(),'item','i3','qty',1,'name','Salt','unit','piece')));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'The same item twice in one transfer was accepted'; end if;
  rejected := false;
  begin perform stock_submit_batch(gen_random_uuid(),'Main Storage','Pizza',false,'rozha',jsonb_build_array(
      jsonb_build_object('key',gen_random_uuid(),'item','i3','qty',1,'name','Salt','unit','piece'),
      jsonb_build_object('key',gen_random_uuid(),'item','i1','qty',9,'name','Flour','unit','piece')));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'A batch with one over-committed line was accepted'; end if;
  if exists(select 1 from stock_requests where item_id = 'i3') then raise exception 'A rejected batch left rows behind'; end if;
  rejected := false; begin perform stock_submit_batch(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','[]'::jsonb); exception when others then rejected := true; end;
  if not rejected then raise exception 'An empty transfer was accepted'; end if;
  rejected := false;
  begin perform stock_submit_batch(gen_random_uuid(),'Main Storage','Pizza',false,'rozha',
      (select jsonb_agg(jsonb_build_object('key',gen_random_uuid(),'item','i3','qty',1,'name','Salt','unit','piece')) from generate_series(1,31)));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'A transfer of 31 items was accepted'; end if;

  -- The PC check covers the whole batch; the screenshot is on the lead.
  rejected := false; begin perform stock_final_approve(other,'rozha'); exception when others then rejected := true; end;
  if not rejected then raise exception 'Approved before a PC check'; end if;
  perform stock_preview_report(lead,'office-pc',true,'All match','shot-check');
  if (select count(*) from stock_requests where batch_id = b1 and preview_status = 'ok') <> 2 then raise exception 'Check not applied to every line'; end if;
  if (select count(*) from stock_shots where request_id = lead and kind = 'check') <> 1 or exists(select 1 from stock_shots where request_id = other) then
    raise exception 'Screenshot is not on the lead only'; end if;

  -- An older PC never claims or is woken for a multi-item batch.
  perform stock_final_approve(other,'rozha');   -- any row of the batch approves the whole batch
  if (select count(*) from stock_requests where batch_id = b1 and final_approved_at is not null) <> 2 then raise exception 'Approval not applied to every line'; end if;
  if stock_claim('office-pc') is not null then raise exception 'An older PC claimed a multi-item batch'; end if;
  if stock_worker_has_work(true) then raise exception 'An older PC was woken for a multi-item batch'; end if;
  if not stock_worker_has_work(true,true) then raise exception 'A batch-aware PC was not woken'; end if;
  claimed := stock_claim('office-pc',true);
  if claimed is distinct from lead then raise exception 'Claim did not return the lead'; end if;
  if (select count(*) from stock_requests where batch_id = b1 and status = 'running') <> 2 then raise exception 'Claim did not start every line'; end if;

  -- Finishing moves every line, once.
  perform stock_finish(lead,'office-pc','completed','Moved!','shot-result');
  if (select count(*) from stock_requests where batch_id = b1 and status = 'completed') <> 2 then raise exception 'Finish did not complete every line'; end if;
  select quantity into v from stock_balances where item_id = 'i1' and storage_name = 'Main Storage'; if v <> 7 then raise exception 'i1 not taken from the source'; end if;
  select quantity into v from stock_balances where item_id = 'i2' and storage_name = 'Pizza'; if v <> 4 then raise exception 'i2 not added to the destination'; end if;
  if (select count(*) from stock_shots where request_id = lead and kind = 'result') <> 1 then raise exception 'Result screenshot missing'; end if;
  if (select count(*) from stock_events where action = 'completed' and request_id in (lead, other)) <> 2 then raise exception 'History not written per line'; end if;
  rejected := false; begin perform stock_finish(lead,'office-pc','completed','again',null); exception when others then rejected := true; end;
  if not rejected then raise exception 'A finished batch finished twice'; end if;

  -- Cancelling from any row cancels the whole batch.
  ids := stock_submit_batch(gen_random_uuid(),'Main Storage','Pizza',false,'yunis',jsonb_build_array(
    jsonb_build_object('key',gen_random_uuid(),'item','i1','qty',1,'name','Flour','unit','piece'),
    jsonb_build_object('key',gen_random_uuid(),'item','i2','qty',1,'name','Sugar','unit','piece')));
  perform stock_cancel(ids[2],'yunis');
  if (select count(*) from stock_requests where id = any(ids) and status = 'failed') <> 2 then raise exception 'Cancel did not reach every line'; end if;
  if stock_reserved('i1','Main Storage') <> 0 then raise exception 'Cancelled lines still reserved'; end if;

  -- A batch the PC could not confirm is settled as one, then moves every line.
  ids := stock_submit_batch(gen_random_uuid(),'Main Storage','Pizza',false,'rozha',jsonb_build_array(
    jsonb_build_object('key',gen_random_uuid(),'item','i1','qty',2,'name','Flour','unit','piece'),
    jsonb_build_object('key',gen_random_uuid(),'item','i2','qty',1,'name','Sugar','unit','piece')));
  perform stock_preview_report(ids[1],'office-pc',true,'ok','shot');
  perform stock_final_approve(ids[1],'rozha');
  claimed := stock_claim('office-pc',true);
  perform stock_finish(claimed,'office-pc','needs_checking','No success message',null);
  if (select count(*) from stock_requests where id = any(ids) and status = 'needs_checking') <> 2 then raise exception 'Needs-checking not applied to every line'; end if;
  perform stock_resolve(ids[2],'rozha','completed','Checked in the workplace history',(now() at time zone 'Asia/Baghdad')::date);
  if (select count(*) from stock_requests where id = any(ids) and status = 'completed') <> 2 then raise exception 'Resolve did not settle every line'; end if;
  select quantity into v from stock_balances where item_id = 'i1' and storage_name = 'Main Storage'; if v <> 5 then raise exception 'Resolve did not move i1'; end if;

  -- A single item still works exactly as before, for an older PC too.
  other := stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i3',1,'Salt','piece');
  if not exists(select 1 from stock_requests where id = other and batch_size = 1 and batch_pos = 0) then raise exception 'Single item is not a batch of one'; end if;
  perform stock_preview_report(other,'office-pc',true,'ok','shot');
  perform stock_final_approve(other,'rozha');
  if stock_claim('office-pc') is distinct from other then raise exception 'An older PC could not claim a single item'; end if;
end $$;
rollback;
