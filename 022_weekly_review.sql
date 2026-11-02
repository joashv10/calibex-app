-- Sunday weekly-review reminder: one new branch in private.run_reminders, gated on remind_weekly.
-- Fires on the Sunday wake day between 18:00 and 22:00 local, unless already nudged or answered.
-- The rest of the function is the deployed body, unchanged.
alter table public.user_settings add column if not exists remind_weekly boolean not null default true;

CREATE OR REPLACE FUNCTION private.run_reminders(dry_run boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.user_settings%rowtype;
  tz text;
  lnow timestamp;
  wd date;
  m int;
  wake_m int;
  t int;
  w record;
  fired text := '';
begin
  select * into s from public.user_settings where id = 1;
  if not found or s.setup_done_at is null then return 'no setup'; end if;
  tz := coalesce(s.tz, 'Asia/Kolkata');
  lnow := now() at time zone tz;
  wd := (lnow - interval '4 hours')::date;
  m := private.daymin(lnow::time);

  -- Morning check-in
  if s.remind_morning
     and not exists (select 1 from public.nudge_log where wake_date = wd and kind = 'morning')
     and not exists (select 1 from public.item_responses where wake_date = wd and touchpoint = 'breakfast') then
    select private.daymin(percentile_disc(0.5) within group (order by (c.sleep_end at time zone tz)::time))
      into wake_m from public.cycles c where c.sleep_end > now() - interval '30 days';
    wake_m := coalesce(wake_m, private.daymin(time '10:00'));
    if m < wake_m + 360 and (
         exists (select 1 from public.cycles where wake_date = wd and recovery_score is not null)
         or m >= wake_m + 120) then
      if not dry_run then
        insert into public.nudge_log (wake_date, kind) values (wd, 'morning');
        perform private.send_reminder('morning');
      end if;
      fired := fired || 'morning ';
    end if;
  end if;

  -- Lunch
  if s.remind_lunch and s.lunch is not null
     and not exists (select 1 from public.nudge_log where wake_date = wd and kind = 'lunch')
     and not exists (select 1 from public.food_log where wake_date = wd and slot = 'lunch')
     and not exists (select 1 from public.meal_skips where wake_date = wd and slot = 'lunch') then
    t := private.daymin(s.lunch) + 30;
    if m >= t and m < t + 120 then
      if not dry_run then
        insert into public.nudge_log (wake_date, kind) values (wd, 'lunch');
        perform private.send_reminder('lunch');
      end if;
      fired := fired || 'lunch ';
    end if;
  end if;

  -- Session: once per day; a second session gets rated in the evening instead.
  if s.remind_session
     and not exists (select 1 from public.nudge_log where wake_date = wd and kind = 'session') then
    select wo.id into w from public.workouts wo
     where wo.workout_end between now() - interval '3 hours' and now()
       and wo.strain_score is not null
       and coalesce(wo.duration_minutes, 0) >= 10
       and lower(replace(wo.sport_name, '-', ' ')) not in
           ('walking', 'race walking', 'activity', 'other', 'driving', 'increase_relaxation', 'meditation', 'sauna', 'ice bath')
       and not exists (select 1 from public.item_responses r
                        where r.wake_date = wd and r.touchpoint = 'post_workout' and r.answered_at >= wo.workout_start)
     order by wo.workout_end desc limit 1;
    if found then
      if not dry_run then
        insert into public.nudge_log (wake_date, kind, ref) values (wd, 'session', w.id::text);
        perform private.send_reminder('session', w.id::text);
      end if;
      fired := fired || 'session ';
    end if;
  end if;

  -- Dinner
  if s.remind_dinner and s.dinner is not null
     and not exists (select 1 from public.nudge_log where wake_date = wd and kind = 'dinner')
     and not exists (select 1 from public.item_responses where wake_date = wd and touchpoint = 'dinner') then
    t := private.daymin(s.dinner) + 30;
    if m >= t and m < t + 180 then
      if not dry_run then
        insert into public.nudge_log (wake_date, kind) values (wd, 'dinner');
        perform private.send_reminder('dinner');
      end if;
      fired := fired || 'dinner ';
    end if;
  end if;

  -- Weekly review: Sunday evening (wake day), once, unless already answered or skipped.
  if s.remind_weekly
     and extract(dow from wd) = 0
     and not exists (select 1 from public.nudge_log where wake_date = wd and kind = 'weekly_review')
     and not exists (select 1 from public.item_responses where wake_date = wd and touchpoint = 'weekly_review') then
    if m >= private.daymin(time '18:00') and m < private.daymin(time '22:00') then
      if not dry_run then
        insert into public.nudge_log (wake_date, kind) values (wd, 'weekly_review');
        perform private.send_reminder('weekly_review');
      end if;
      fired := fired || 'weekly_review ';
    end if;
  end if;

  return coalesce(nullif(trim(fired), ''), 'nothing due') || ' @ ' || to_char(lnow, 'HH24:MI') || ' wd=' || wd;
end;
$function$;
