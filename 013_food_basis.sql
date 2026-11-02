-- 013: each logged dish keeps where its numbers came from and what you typed.
-- basis: "2 roti · 70 g · food table", "estimate", "label: per 100 g × 260 g serving".
-- input_text: the words (or "photo") the meal reader read, so a bad reading can be traced.
alter table public.food_log
  add column if not exists basis      text,
  add column if not exists input_text text;
