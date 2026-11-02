-- Fixed dinner question for alcohol, asked before the dinner composition question (FD1).
-- Dimension 'substances' (Avoidance of Risky Substances) already exists; items has no facets
-- table, so facet is free text and 'alcohol' is new. Drinks themselves are logged in Food
-- (substance_log); this is the quick daily bucket that gets the check-in to offer that link.
-- Rolled out at deploy. Guarded, so a rerun is a no-op.
insert into public.items (item_id, dimension_id, facet, prompt, response_type, options, severity_map,
  is_protective, touchpoint, cadence, per_occurrence, fixed, event_timed, active, why)
values ('AL1', 'substances', 'alcohol', 'Any alcohol today?', 'ordinal',
  '["None","1–2","3–4","5+"]', '{"None":0,"1–2":0.33,"3–4":0.67,"5+":1}',
  false, 'dinner', 'daily', false, true, false, true,
  'Catches a drinking day in four buckets. Checked against HRV and the next few days of recovery. Asked every day.')
on conflict (item_id) do nothing;
