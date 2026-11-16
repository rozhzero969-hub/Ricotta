-- 2026-11-15: Rico on phones. Chats can be pinned (they stay at the top of the list), and a scheduled
-- task can be a question Rico is asked at its time ('ask': the answer is one tap away in his messages).
alter table public.app_rico_chats add column if not exists pinned boolean not null default false;

do $$
declare c text;
begin
  -- The kind check made with the table (its name was chosen by Postgres) is replaced by one that knows 'ask'.
  for c in select conname from pg_constraint
    where conrelid = 'public.app_rico_routines'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%remind%'
  loop
    execute format('alter table public.app_rico_routines drop constraint %I', c);
  end loop;
end $$;
alter table public.app_rico_routines add constraint app_rico_routines_kind_check check (kind in ('remind', 'prepare_order', 'ask'));
