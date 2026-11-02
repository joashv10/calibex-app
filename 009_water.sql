-- 009: water intake. Lives in the existing (empty, unused) drinks table:
-- drink_name = 'water', volume_ml per tap, logged_at = the tap (NULL when
-- backfilled, since a guessed time would be fake timing data).
-- drinks had RLS on but no policy, so nobody could read or write it.
alter table public.drinks enable row level security;
create policy drinks_owner on public.drinks for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create index if not exists drinks_wake_date_idx on public.drinks (wake_date);
