-- 2026-11-16: recipe costs and Ahmad's recipe alerts.
--
-- Each recipe line now carries its own amount and unit (a unit from Manage, Units), and its cost comes
-- from the last price paid for the ingredient's stock item (api recipes.ts, _shared/recipe-cost.js).
-- An ingredient's unit is only the unit new lines start with, so changing it no longer needs to be
-- blocked while recipes use the ingredient.
drop trigger if exists app_recipe_ingredient_unit_lock on public.app_recipe_ingredients;
drop function if exists public.app_recipe_ingredient_unit_lock();

-- What each recipe alert last said, so each one goes once per change (api recipe-alerts.ts): a stock
-- item's last price, a recipe's margin state, a stock item's state in Main Storage, a link that is gone,
-- a recipe still missing amounts or prices. Only the service role reads or writes it.
create table if not exists public.app_recipe_alert_state (
  key text primary key check (length(key) between 1 and 300),
  value text not null check (length(value) <= 300),
  at timestamptz not null default now()
);
alter table public.app_recipe_alert_state enable row level security;
revoke all on public.app_recipe_alert_state from public, anon, authenticated;
grant all on public.app_recipe_alert_state to service_role;

-- Saves the new values and returns only the ones that changed, with what they were before. Rows are
-- locked one by one, so two checks at the same moment never both see the same change.
create or replace function public.app_internal_recipe_alert_take(p_items jsonb)
returns table(alert_key text, was text, is_now text)
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  old_value text;
  old_at timestamptz;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then
    raise exception 'invalid alert state';
  end if;
  for r in select x.k, x.v from jsonb_to_recordset(p_items) as x(k text, v text) order by x.k loop
    if r.k is null or r.v is null or length(r.k) > 300 or length(r.v) > 300 then continue; end if;
    select s.value, s.at into old_value, old_at from public.app_recipe_alert_state s where s.key = r.k for update;
    if not found then
      insert into public.app_recipe_alert_state as s (key, value) values (r.k, r.v) on conflict (key) do nothing;
      if found then alert_key := r.k; was := null; is_now := r.v; return next; end if;
    elsif old_value is distinct from r.v then
      update public.app_recipe_alert_state s set value = r.v, at = now() where s.key = r.k;
      alert_key := r.k; was := old_value; is_now := r.v; return next;
    elsif old_at < now() - interval '1 day' then
      update public.app_recipe_alert_state s set at = now() where s.key = r.k;   -- still in use
    end if;
  end loop;
  -- Keys nobody has looked at for 90 days belong to deleted recipes or stock items.
  delete from public.app_recipe_alert_state s where s.at < now() - interval '90 days';
end $$;
revoke all on function public.app_internal_recipe_alert_take(jsonb) from public, anon, authenticated;
grant execute on function public.app_internal_recipe_alert_take(jsonb) to service_role;
