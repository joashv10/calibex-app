-- 017 moved NR3 ("skip or delay a planned meal today?") to lunch, which would have narrowed
-- it from a whole-day answer to a morning-only one under the same item_id: two meanings
-- the correlation engine would pool. NR3 goes back to dinner with its original wording
-- (no lunch answers were recorded in between), and lunch gets its own item, NR4, for the
-- morning. Guarded, so a rerun is a no-op.
update public.items set touchpoint = 'dinner', prompt = 'Skip or significantly delay a planned meal today?'
  where item_id = 'NR3' and touchpoint = 'lunch';
insert into public.items (item_id, dimension_id, facet, prompt, response_type, options, severity_map,
  is_protective, touchpoint, cadence, per_occurrence, fixed, event_timed, active, why)
values ('NR4', 'fueling', 'regulation', 'Skip or significantly delay breakfast today?', 'boolean',
  '["No","Yes"]', '{"No":0,"Yes":1}', false, 'lunch', 'daily', false, false, false, true,
  'Catches a skipped or late first meal, the morning side of under-fuelling. Back every few days.')
on conflict (item_id) do nothing;
