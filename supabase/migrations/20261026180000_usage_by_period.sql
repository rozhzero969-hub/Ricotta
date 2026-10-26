-- ROZH-23: Admin, Time in the App by day, week and month, with the average per day. Days, weeks and
-- months are counted in Erbil time. A day nobody used the app counts as zero, so the charts have no
-- gaps, and nothing before the first counted day is shown.
--   people  today, last 7 days, this month, last 30 days, all time, and the first day counted
--   days    each of the last 31 days
--   weeks   the last 8 weeks of 7 days, the newest ending today
--   months  the last 6 calendar months, this one included
create or replace function public.app_internal_usage_summary(p_actor text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Baghdad')::date;
  this_month date := date_trunc('month', (now() at time zone 'Asia/Baghdad'))::date;
  first_day date;
begin
  if p_actor is distinct from 'rozha' then raise exception 'Forbidden'; end if;
  select least(coalesce(min(day), today), today) into first_day from public.app_usage_time;
  return jsonb_build_object('today', today,
    'people', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'today', t, 'week', w, 'month', m, 'last30', d30, 'total', a, 'since', s) order by account)
      from (select account, coalesce(sum(seconds) filter (where day = today), 0) t, coalesce(sum(seconds) filter (where day > today - 7), 0) w,
              coalesce(sum(seconds) filter (where day >= this_month), 0) m, coalesce(sum(seconds) filter (where day > today - 30), 0) d30,
              sum(seconds) a, min(day) s
            from public.app_usage_time group by account) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'deviceId', device_id, 'label', label, 'today', t, 'total', a, 'lastAt', l) order by l desc)
      from (select account, device_id, (array_agg(device_label order by updated_at desc) filter (where device_label is not null))[1] label,
              coalesce(sum(seconds) filter (where day = today), 0) t, sum(seconds) a, max(updated_at) l
            from public.app_usage_time group by account, device_id order by max(updated_at) desc limit 40) d), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'rozha', coalesce(u.r, 0), 'yunis', coalesce(u.y, 0)) order by g.day)
      from (select gs::date as day from generate_series(greatest(first_day, today - 30)::timestamp, today::timestamp, interval '1 day') gs) g
      left join (select day, sum(seconds) filter (where account = 'rozha') r, sum(seconds) filter (where account = 'yunis') y
                 from public.app_usage_time where day > today - 31 group by day) u on u.day = g.day), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('start', today - 6 - 7 * w.n, 'rozha', w.r, 'yunis', w.y) order by w.n desc)
      from (select n.n, coalesce(sum(u.seconds) filter (where u.account = 'rozha'), 0) r, coalesce(sum(u.seconds) filter (where u.account = 'yunis'), 0) y
            from generate_series(0, 7) n(n)
            left join public.app_usage_time u on u.day between today - 6 - 7 * n.n and today - 7 * n.n
            where today - 7 * n.n >= first_day group by n.n) w), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(mm.m, 'YYYY-MM'), 'rozha', mm.r, 'yunis', mm.y) order by mm.m)
      from (select g.m, coalesce(sum(u.seconds) filter (where u.account = 'rozha'), 0) r, coalesce(sum(u.seconds) filter (where u.account = 'yunis'), 0) y
            from (select gs::date as m from generate_series(greatest(date_trunc('month', first_day::timestamp), (this_month - interval '5 months')::timestamp), this_month::timestamp, interval '1 month') gs) g
            left join public.app_usage_time u on u.day >= g.m and u.day < (g.m + interval '1 month')::date
            group by g.m) mm), '[]'::jsonb));
end $$;
revoke all on function public.app_internal_usage_summary(text) from public, anon, authenticated;
grant execute on function public.app_internal_usage_summary(text) to service_role;
