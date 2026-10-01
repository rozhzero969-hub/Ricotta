-- Receipts get the same two-step safety as transfers:
--   waiting -> preparing -> prepared (form filled on the PC, screenshot sent)
--   -> final approval on the phone (within 20 minutes of the screenshot)
--   -> submitting (the PC re-checks every field, then presses "Receive & send to finance")
--   -> completed (the workplace showed its exact success message; stock is added to Main Storage here)
--   |  needs_checking (anything unclear after the press, or the receipt was finished on the PC by hand;
--      a person confirms on the phone whether it was saved, and only "saved" adds stock)
--   |  failed (nothing was pressed) | cancelled
alter table public.stock_receipts drop constraint stock_receipts_status_check;
alter table public.stock_receipts add constraint stock_receipts_status_check
  check (status in ('waiting','preparing','prepared','submitting','completed','needs_checking','failed','cancelled','closed'));
alter table public.stock_receipts
  add column final_approved_at timestamptz,
  add column final_approved_by text check (final_approved_by is null or final_approved_by in ('rozha','yunis')),
  add column resolved_by text check (resolved_by is null or resolved_by in ('rozha','yunis')),
  add column resolved_note text check (resolved_note is null or length(resolved_note) <= 900),
  add column stock_added_at timestamptz;

-- Adds every line to Main Storage in counting units (each line carries ledgerQty, worked out when the
-- receipt was entered). Runs once per receipt.
create function public.stock_receipt_add_stock(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.stock_receipts%rowtype; l jsonb; q numeric;
begin
  select * into r from public.stock_receipts where id = p_id for update;
  if r.id is null or r.stock_added_at is not null then return; end if;
  if not exists(select 1 from public.stock_storages where name = 'Main Storage') then raise exception 'Main Storage zone is missing'; end if;
  for l in select * from jsonb_array_elements(r.lines) loop
    q := (l->>'ledgerQty')::numeric;
    if q is null or q <= 0 then raise exception 'A receipt line has no stock amount'; end if;
    if not exists(select 1 from public.app_items where id = l->>'itemId') then continue; end if;   -- item deleted since
    insert into public.stock_balances(item_id, storage_name, quantity) values(l->>'itemId', 'Main Storage', q)
      on conflict (item_id, storage_name) do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();
  end loop;
  update public.stock_receipts set stock_added_at = now() where id = p_id;
  insert into public.stock_events(actor, action, details)
    values(p_actor, 'receipt_stock_added', jsonb_build_object('receipt_id', p_id, 'invoice', r.invoice, 'supplier', r.supplier_name));
end $$;

create function public.stock_receipt_final_approve(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.stock_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  select * into r from public.stock_receipts where id = p_id for update;
  if r.id is null or r.status <> 'prepared' then raise exception 'This receipt is not waiting for a final approval'; end if;
  if r.shot is null then raise exception 'Wait for the PC screenshot first'; end if;
  if r.prepared_at < now() - interval '20 minutes' then raise exception 'The PC check is older than 20 minutes. Cancel it and send the receipt again'; end if;
  if r.final_approved_at is not null then return; end if;
  update public.stock_receipts set final_approved_at = now(), final_approved_by = p_actor where id = p_id;
end $$;

-- The PC takes a final-approved receipt that it is holding open, to press the button once.
create function public.stock_receipt_claim_submit(p_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  update public.stock_receipts set status = 'submitting'
    where id = p_id and status = 'prepared' and final_approved_at is not null and final_approved_at > now() - interval '30 minutes';
  return found;
end $$;

create function public.stock_receipt_finish(p_id uuid, p_status text, p_message text, p_image text)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_status not in ('completed','needs_checking','failed') then raise exception 'Invalid status'; end if;
  update public.stock_receipts set status = p_status, message = left(p_message, 1000), finished_at = now(),
      shot = coalesce(p_image, shot)
    where id = p_id and status = 'submitting';
  if not found then raise exception 'Receipt is not being saved'; end if;
  if p_status = 'completed' then perform public.stock_receipt_add_stock(p_id, 'office-pc'); end if;
end $$;

-- A person checks the workplace and says whether a "needs checking" receipt was saved there.
create function public.stock_receipt_resolve(p_id uuid, p_actor text, p_saved boolean, p_note text)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') or p_saved is null or length(trim(coalesce(p_note,''))) < 10 then
    raise exception 'Check the workplace receipts and write a note of at least 10 characters'; end if;
  update public.stock_receipts set status = case when p_saved then 'completed' else 'failed' end,
      resolved_by = p_actor, resolved_note = left(p_note, 900), finished_at = coalesce(finished_at, now())
    where id = p_id and status in ('needs_checking','closed');
  if not found then raise exception 'This receipt does not need checking'; end if;
  if p_saved then perform public.stock_receipt_add_stock(p_id, p_actor); end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['stock_receipt_add_stock(uuid,text)','stock_receipt_final_approve(uuid,text)','stock_receipt_claim_submit(uuid)',
    'stock_receipt_finish(uuid,text,text,text)','stock_receipt_resolve(uuid,text,boolean,text)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',f);
    execute format('grant execute on function public.%s to service_role',f);
  end loop;
end $$;
