-- 007_phase1_reminders.sql
-- Phase 1 of the adherence plan ("getting in"). Parts A and B are applied in
-- Supabase as migrations phase1_settings_items and phase1_reminder_engine.
-- Part C is applied at deploy time, after nudge.yml and send-nudge.mjs are on main.

-- ── A. Settings, reminder ledger, push health, morning items ────────────────
create table public.user_settings (
  id smallint primary key default 1 check (id = 1),
  name text,
  tz text not null default 'Asia/Kolkata',
  first_meal time, lunch time, dinner time,
  remind_morning boolean not null default true,
  remind_lunch boolean not null default true,
  remind_session boolean not null default true,
  remind_dinner boolean not null default true,
  setup_done_at timestamptz,
  finding_revealed text,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy user_settings_all on public.user_settings for all to authenticated using (true) with check (true);

create table public.nudge_log (
  id bigint generated always as identity primary key,
  wake_date date not null,
  kind text not null,
  ref text,
  sent_at timestamptz not null default now(),
  unique (wake_date, kind)
);
alter table public.nudge_log enable row level security; -- server-only, no policies

alter table public.push_subscriptions add column dead_at timestamptz, add column last_ok_at timestamptz;
create or replace function public.push_status(p_endpoint text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when dead_at is null then 'live' else 'dead' end
                     from public.push_subscriptions where endpoint = p_endpoint), 'missing');
$$;
revoke all on function public.push_status(text) from public;
grant execute on function public.push_status(text) to anon, authenticated;

alter table public.items add column why text;
-- response_type gains 'swatch'; touchpoint gains 'late_night' (asked only after a late night).
-- HY1 (1–7 urine scale) and SM2 retired; SQ3 moves to the evening; HY2, SL1, SL2, WK1 added;
-- a "why we ask" line on every item. Full statements: Supabase migration phase1_settings_items.

-- ── B. Reminder engine ──────────────────────────────────────────────────────
-- private.daymin(time), private.send_reminder(kind, ref), private.run_reminders(dry_run).
-- Full definitions: Supabase migration phase1_reminder_engine.

-- ── C. At deploy: swap the fixed-hour jobs for the engine ──────────────────
-- select cron.unschedule(j) from unnest(array['nudge-breakfast','nudge-lunch','nudge-afternoon','nudge-dinner','nudge-weighin']) j;
-- select cron.schedule('reminders', '*/5 * * * *', 'select private.run_reminders()');
-- drop function if exists private.fire_nudge(text);
