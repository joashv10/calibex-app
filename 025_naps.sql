-- 025: WHOOP naps. The sync used to drop every sleep flagged nap; now each one is kept.
-- One row per WHOOP sleep id. wake_date = the wake_date of the cycle the nap fell in;
-- a nap whose cycle is not in the sync batch is skipped, never guessed. Minutes are NULL, never 0,
-- while WHOOP hasn't scored the nap. Written by sync_whoop.py with the secret key;
-- the app reads it as owner only, like cycles.
create table if not exists public.naps (
  whoop_sleep_id   text primary key,
  wake_date        date not null,
  nap_start        timestamptz not null,
  nap_end          timestamptz,
  duration_minutes numeric,  -- end - start
  sleep_minutes    numeric,  -- light + deep + rem (excludes awake), like cycles.total_sleep_minutes
  light_minutes    numeric,
  deep_minutes     numeric,
  rem_minutes      numeric,
  awake_minutes    numeric,
  score_state      text,
  created_at       timestamptz not null default now()
);
create index if not exists naps_wake_date_idx on public.naps (wake_date);
alter table public.naps enable row level security;
drop policy if exists naps_owner_read on public.naps;
create policy naps_owner_read on public.naps for select to authenticated
  using ((select private.is_owner()));
