-- Expenses are not used by Ricotta. Removes what 20261002050525_restaurant_expenses created
-- (both tables were empty and nothing else referenced them).
drop function if exists public.app_internal_list_expenses(date,date,text,text,text,integer,integer);
drop function if exists public.app_internal_write_expense(uuid,uuid,text,text,integer,jsonb);
drop table if exists public.app_expense_events;
drop table if exists public.app_expenses;
