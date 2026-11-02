-- 014: a drink's sugar, and where its % alc came from.
-- carb_g is grams of carbohydrate for the whole entry (spirits 0, beer ~3.5 g/100 ml,
-- liqueurs like Fireball ~11 g/100 ml). Calories are NOT stored: they are computed
-- (7 kcal per g alcohol + 4 per g carb), so older rows still count their alcohol.
-- abv_source: 'default' (the drink type's %), 'lookup' (brand looked up), 'user' (typed).
-- Null on older rows. Only 'lookup'/'user' rows are reused for a brand's % next time.
alter table public.substance_log
  add column if not exists carb_g     numeric,
  add column if not exists abv_source text;

alter table public.substance_log
  add constraint sl_carb_chk check (carb_g is null or carb_g >= 0),
  add constraint sl_abv_source_chk check (abv_source is null or abv_source in ('default','lookup','user'));
