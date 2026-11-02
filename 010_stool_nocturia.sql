-- 010: stool log + night-time pee question.
-- Stool: one tap on Today = one row, form in 3 buckets (hard = Bristol 1–2,
-- normal = 3–4, loose = 5–7; the confusable middle types are folded in).
-- logged_at is the tap (NULL when backfilled). A day with no rows is unknown,
-- not zero: analysis decides whether to infer zero from other logging that day.
create table public.stool_log (
  id uuid primary key default gen_random_uuid(),
  wake_date date not null,
  form text not null check (form in ('hard', 'normal', 'loose')),
  logged_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.stool_log enable row level security;
create policy stool_log_owner on public.stool_log for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create index stool_log_wake_date_idx on public.stool_log (wake_date);

-- Night voids (nocturia): fixed morning anchor, after urine colour. Inserted
-- inactive; activated with the deploy that orders it (sampler FIXED_ORDER).
insert into public.items (item_id, dimension_id, facet, prompt, response_type, options, severity_map,
  is_protective, touchpoint, cadence, per_occurrence, fixed, event_timed, active, why)
values ('SM3', 'sleep', 'maintenance', 'Get up to pee during the night?', 'ordinal',
  '["No","Once","2+"]', '{"No":0,"Once":0.5,"2+":1}',
  false, 'breakfast', 'daily', false, true, false, false,
  'Catches night-time trips to pee, which break sleep and often follow evening water, caffeine or alcohol. Checked against HRV and sleep. Asked every day.');
-- On deploy: update public.items set active = true where item_id = 'SM3';
