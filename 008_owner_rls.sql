-- 008_owner_rls.sql
-- Accounts increment 1: only the owner's signed-in session can touch data.
-- Before this, all 22 policies were `true` and the app signed visitors in
-- anonymously, so anyone with the URL could read and write everything.
--
-- Apply ONLY after the owner has signed in once through the new /signin flow
-- (is_owner() matches the owner's auth.users row by email). Then, in Supabase Auth, turn
-- off anonymous sign-ins and new sign-ups, and delete the anonymous users.
-- Server paths (GitHub sync, send-nudge, pg_cron) use the service key or run as
-- postgres, so they bypass RLS and are unaffected.

-- ── Owner check ─────────────────────────────────────────────────────────────
-- PLACEHOLDER: replace 'you@example.com' with the email address you sign in with before
-- applying this migration. It is the single account allowed to read or write any data.
-- Security definer so it can read auth.users; callers only get a boolean.
-- Policies call it as (select private.is_owner()) so it runs once per query.
create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and email = 'you@example.com'
      and email_confirmed_at is not null
      and not is_anonymous
  );
$$;
revoke all on function private.is_owner() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_owner() to authenticated;

-- ── The view ran as its owner (postgres), which bypasses RLS ────────────────
alter view public.v_readout set (security_invoker = on);

-- ── Rewrite every policy: `true` → owner only, and never anon ───────────────
drop policy bm_authd on public.body_measurements;
create policy bm_owner on public.body_measurements for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy cycles_read_authd on public.cycles;
create policy cycles_owner_read on public.cycles for select to authenticated
  using ((select private.is_owner()));

drop policy dc_authd on public.day_context;
create policy dc_owner on public.day_context for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy dimensions_read on public.dimensions;
create policy dimensions_owner_read on public.dimensions for select to authenticated
  using ((select private.is_owner()));

drop policy exercise_favorites_all on public.exercise_favorites;
create policy exercise_favorites_owner on public.exercise_favorites for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy food_log_all on public.food_log;
create policy food_log_owner on public.food_log for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy foods_all on public.foods;
create policy foods_owner on public.foods for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy ir_authd on public.item_responses;
create policy ir_owner on public.item_responses for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy iss_authd on public.item_sampler_state;
create policy iss_owner on public.item_sampler_state for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy items_read on public.items;
create policy items_owner_read on public.items for select to authenticated
  using ((select private.is_owner()));

drop policy lift_log_all on public.lift_log;
create policy lift_log_owner on public.lift_log for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy lift_templates_all on public.lift_templates;
create policy lift_templates_owner on public.lift_templates for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy meal_skips_all on public.meal_skips;
create policy meal_skips_owner on public.meal_skips for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy meals_all on public.meals;
create policy meals_owner on public.meals for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

-- push_subscriptions keeps no SELECT policy: the client only inserts/updates,
-- and reads its own status through push_status().
drop policy push_sub_insert on public.push_subscriptions;
create policy push_sub_owner_insert on public.push_subscriptions for insert to authenticated
  with check ((select private.is_owner()));
drop policy push_sub_update on public.push_subscriptions;
create policy push_sub_owner_update on public.push_subscriptions for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy saved_meals_all on public.saved_meals;
create policy saved_meals_owner on public.saved_meals for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy session_log_all on public.session_log;
create policy session_log_owner on public.session_log for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy sl_authd on public.substance_log;
create policy sl_owner on public.substance_log for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy supplements_all on public.supplements;
create policy supplements_owner on public.supplements for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy user_settings_all on public.user_settings;
create policy user_settings_owner on public.user_settings for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

drop policy workouts_read_authd on public.workouts;
create policy workouts_owner_read on public.workouts for select to authenticated
  using ((select private.is_owner()));
