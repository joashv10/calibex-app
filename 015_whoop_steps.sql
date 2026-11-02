-- WHOOP added step_count to cycles (2026-09-23). Steps cover the cycle (wake to wake),
-- null when the strap wasn't worn. recovery_calibrating = WHOOP's own "still learning
-- your baseline" flag on a recovery; analysis should drop those days.
alter table public.cycles
  add column if not exists step_count integer,
  add column if not exists recovery_calibrating boolean;
alter table public.cycles
  add constraint cycles_step_count_chk check (step_count is null or step_count >= 0);
