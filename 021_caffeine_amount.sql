-- Caffeine in mg, plus what the drink was. Additive and nullable: a "1 cup" tap from
-- Drinks has no amount, and older rows only knew cups. Logged drinks fill both from the
-- meal reader's mg per 100 g (or a typical figure by name) × the grams logged.
alter table public.substance_log
  add column if not exists caffeine_mg numeric,
  add column if not exists drink_name  text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sl_caffeine_mg_chk') then
    alter table public.substance_log add constraint sl_caffeine_mg_chk
      check (caffeine_mg is null or (caffeine_mg >= 0 and caffeine_mg <= 2000));
  end if;
end $$;
