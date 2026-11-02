-- 023: fibre and sugar per dish (grams) and per 100 g in the foods library.
-- carbs stay AVAILABLE carbohydrate (fibre excluded); sugar = total sugars; null = unknown, never 0.
-- Applied via Supabase MCP as migration "food_fibre_sugar". Additive, no backfill in this file.
alter table public.food_log add column if not exists fibre_g numeric, add column if not exists sugar_g numeric;
alter table public.foods add column if not exists fibre_100 numeric, add column if not exists sugar_100 numeric;

-- Backfill (run once in prod, 2026-10-21): 33 food_log rows whose basis says "food table" or
-- "typical" (not "AI estimate") got fibre_g/sugar_g = table fibre_100/sugar_100 × grams / 100,
-- rounded to 0.1, matched by food name (6 names matched by identical kcal/macros: Kerala Fish
-- Curry→fish_curry, Cheera Thoran→thoran, Kerala Style Beef Fry and Kerala Beef Roast→beef_fry,
-- Ghee Dosa and Ghee Roast→dosa, Egg White (Boiled)→egg_white). AI rows, Malai Tikka and
-- Tandoori Chicken left null. No paneer rows were logged, so the paneer correction needs no re-run.
-- Then: update food_log set sugar_g = carb_g where sugar_g > carb_g (3 rows: chai 300 g, coffee ×2).
