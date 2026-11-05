-- 2026-11-09: a person always approves. "Rico saves by himself" is gone: no receipt can be approved,
-- be saving or be saved in Ricotta Restaurant unless Rozha or Yunis approved it (in the app or on
-- Telegram). The database itself refuses anything else, whatever the API or Rico would do.
update public.app_rr_helper set auto_approve = false;
alter table public.app_rr_helper drop constraint if exists app_rr_helper_never_auto;
alter table public.app_rr_helper add constraint app_rr_helper_never_auto check (auto_approve = false);
alter table public.app_rr_receipts drop constraint if exists app_rr_receipts_person_approves;
alter table public.app_rr_receipts add constraint app_rr_receipts_person_approves check (
  status not in ('approved','saving','saved') or (approved_by in ('rozha','yunis') and approved_at is not null));
