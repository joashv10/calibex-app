-- The afternoon check-in no longer exists in the app (TOUCHPOINTS has no 'afternoon'),
-- so these 8 items were never asked. Move them to dinner and reword the ones that
-- said "right now" / "afternoon" so they read as an evening recall of today.
-- Each update is guarded by touchpoint = 'afternoon', so a rerun is a no-op.
update public.items set touchpoint = 'dinner', prompt = 'Did your body feel heavy or sluggish today?'
  where item_id = 'AF1' and touchpoint = 'afternoon';
update public.items set touchpoint = 'dinner', prompt = 'Did you feel physically fresh today?'
  where item_id = 'AF3' and touchpoint = 'afternoon';
update public.items set touchpoint = 'dinner', prompt = 'Eat something you hadn''t planned to today?'
  where item_id = 'NC1' and touchpoint = 'afternoon';
update public.items set touchpoint = 'dinner', prompt = 'Muscles sore or fatigued even at rest today?'
  where item_id = 'PR2' and touchpoint = 'afternoon';
update public.items set touchpoint = 'dinner', prompt = 'Need caffeine or a walk to get through an afternoon slump today?'
  where item_id = 'SD2' and touchpoint = 'afternoon';
-- wording unchanged
update public.items set touchpoint = 'dinner' where item_id = 'PR1' and touchpoint = 'afternoon';
update public.items set touchpoint = 'dinner' where item_id = 'SD1' and touchpoint = 'afternoon';
update public.items set touchpoint = 'dinner' where item_id = 'SD3' and touchpoint = 'afternoon';
