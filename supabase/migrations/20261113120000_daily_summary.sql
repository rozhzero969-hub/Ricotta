-- Rico's evening check on Telegram is sent once a day: the Erbil day it was last sent for.
alter table public.app_rr_helper add column if not exists summary_day text;
