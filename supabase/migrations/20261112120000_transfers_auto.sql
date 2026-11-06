-- "Move without asking again" (a setting per account, off unless turned on): a transfer sent with it
-- counts as approved by the person who sent it, so Rico moves it right after filling it in and
-- checking it, without a second approval. It is marked, so the app shows which transfers had one.
alter table public.app_rr_transfers add column if not exists auto boolean not null default false;
