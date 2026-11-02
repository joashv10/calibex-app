-- 026: morning WHOOP catch-up, clocked in Postgres.
-- On 26 Oct 2026 the webhook sync never started (its GitHub token had expired) and GitHub's "every 2 hours"
-- schedule had been running every 4-5 hours, so the morning's recovery showed up
-- hours late. Every 20 minutes from the usual wake time (30-day median) until 6 hours
-- after it, while today's cycle has no recovery, this asks /api/nudge to start the
-- WHOOP sync (touchpoint "sync"). It stops as soon as the recovery lands, so a normal
-- morning costs one to three runs (the webhook usually gets there first); a day
-- without the strap on costs at most 18.
create or replace function private.run_sync_catchup()
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  tz text;
  lnow timestamp;
  m int;
  wake_m int;
begin
  select coalesce(us.tz, 'Asia/Kolkata') into tz from public.user_settings us where us.id = 1;
  tz := coalesce(tz, 'Asia/Kolkata');
  lnow := now() at time zone tz;
  m := private.daymin(lnow::time);
  if exists (select 1 from public.cycles where wake_date = (lnow - interval '4 hours')::date and recovery_score is not null) then
    return 'recovery in';
  end if;
  select private.daymin(percentile_disc(0.5) within group (order by (c.sleep_end at time zone tz)::time))
    into wake_m from public.cycles c where c.sleep_end > now() - interval '30 days';
  wake_m := coalesce(wake_m, private.daymin(time '09:00'));
  if m < wake_m or m >= wake_m + 360 then
    return 'outside window';
  end if;
  perform private.send_reminder('sync');
  return 'sync requested @ ' || to_char(lnow, 'HH24:MI');
end;
$$;
revoke all on function private.run_sync_catchup() from public, anon, authenticated;

-- Applied after the /api/nudge "sync" kind is live:
-- select cron.schedule('whoop_sync_catchup', '*/20 * * * *', 'select private.run_sync_catchup()');
