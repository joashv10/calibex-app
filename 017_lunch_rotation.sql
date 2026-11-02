-- Lunch only drew from the two any_meal questions (NR1, NR2) with a quota of 2, so it
-- asked the same pair every day. Two dinner questions that fit midday move to lunch; the
-- sampler (MEAL_SLOTS) now asks one meal question plus one of these. Guarded by
-- touchpoint = 'dinner', so a rerun is a no-op. NR3's move was undone by 018 (it would have
-- changed what NR3 measures); lunch uses the new NR4 instead.
update public.items set touchpoint = 'lunch', prompt = 'Skip or significantly delay a planned meal so far today?'
  where item_id = 'NR3' and touchpoint = 'dinner';
-- wording unchanged
update public.items set touchpoint = 'lunch' where item_id = 'SQ3' and touchpoint = 'dinner';
