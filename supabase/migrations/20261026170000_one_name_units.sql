-- ROZH-23: a unit has one name, written in any language. Units used to have English, Kurdish and
-- Arabic names; Rozha keeps the Kurdish one. A unit without a Kurdish name goes, but only when no
-- item or order line uses it (on 2026-10-26 that was one unused unit). Once no unit has a Kurdish
-- name left the change is done, so running it again removes nothing.
delete from public.app_units u
  where coalesce(btrim(u.ku), '') = ''
    and exists (select 1 from public.app_units k where coalesce(btrim(k.ku), '') <> '')
    and not exists (select 1 from public.app_items i where i.unit_id = u.id)
    and not exists (select 1 from public.app_order_lines l where l.unit_id = u.id);
update public.app_units set en = left(btrim(ku), 80) where coalesce(btrim(ku), '') <> '' and en is distinct from left(btrim(ku), 80);
update public.app_units set ku = null, ar = null where ku is not null or ar is not null;
