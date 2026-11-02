-- 012: alcohol entries carry what you drank and over what window.
-- One row per drink type per evening (a beer row + a whisky row), like one row per coffee.
-- consumed_at stays the START of the window; ended_at is null when you didn't say.
-- alcohol_g is computed at write time (ml × abv × 0.789) and stored, so a later change to
-- the default ABVs never rewrites history. dose_bucket is still written (derived from
-- alcohol_g, 10 g = one standard drink) so older readers keep working.
alter table public.substance_log
  add column if not exists ended_at   timestamptz,
  add column if not exists drink_type text,
  add column if not exists brand      text,
  add column if not exists volume_ml  numeric,
  add column if not exists abv        numeric,
  add column if not exists alcohol_g  numeric;

alter table public.substance_log
  add constraint sl_window_chk check (ended_at is null or ended_at >= consumed_at),
  add constraint sl_abv_chk check (abv is null or (abv > 0 and abv <= 100));
