-- ============================================================================
-- CALIBEX v2 SEED — the instrument itself: 9 dimensions + 40 items.
-- Run AFTER calibex_v2_schema.sql.
-- ============================================================================
-- ALL questions kept for v1 (no cuts — founder's call; prune later from real
-- M2 data, not on paper). 28 Axis-A (daily) + 12 Axis-B (event=daily, reflective=weekly).
-- Substances (alcohol/caffeine) are NOT items here — they are quick-loggers that
-- write to `substance_log`. Axis-C (weight/waist) writes to `body_measurements`.
--
-- Conventions:
--   * severity 0..1, higher = more strain. PROTECTIVE items store the inverted
--     map (good answer -> 0); the asymmetric aggregation (a "No" = neutral, not
--     max) is applied by the M3 scorer via is_protective — at MVP severity is
--     stored but unused.
--   * RPE1 severity encodes session INTENSITY (feeds Foster load = RPE × WHOOP
--     duration), not strain.
--   * fixed = always asked (bypasses sampler). per_occurrence = may repeat in a
--     day (per session / per meal). event_timed = carries a real event_at.
-- ============================================================================

-- ---- DIMENSIONS -----------------------------------------------------------
INSERT INTO dimensions (dimension_id, display_name, axis, weight, sort_order) VALUES
    ('load',           'Load & Progression',            'A', 1.0, 1),
    ('recovery_state', 'Recovery State',                'A', 1.0, 2),
    ('sleep',          'Restorative Sleep',             'A', 1.0, 3),
    ('readiness',      'Physical Readiness',            'A', 1.0, 4),
    ('fueling',        'Fueling & Energy Availability', 'A', 1.0, 5),
    ('substances',     'Avoidance of Risky Substances', 'A', 1.0, 6),  -- fed by substance_log, no items
    ('life_demand',    'Life-Demand Load',              'B', 1.0, 7),
    ('social',         'Social Connection',             'B', 0.5, 8),  -- DOWN-WEIGHTED (founder's call)
    ('sustainability', 'Sustainability & Meaning',      'B', 1.0, 9);

-- ---- ITEMS ----------------------------------------------------------------
INSERT INTO items
  (item_id, dimension_id, facet, prompt, response_type, options, severity_map,
   is_protective, touchpoint, cadence, per_occurrence, fixed, event_timed) VALUES

-- === AXIS A · LOAD & PROGRESSION ===
('AA1','load','adherence','Do the training you planned today?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'dinner','daily',false,false,false),
('AA2','load','adherence','Skip or cut a planned session short?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('AS1','load','session','Hit your planned weights / pace this session?','ordinal',
  '["Yes","Partly","No"]','{"Yes":0,"Partly":0.5,"No":1}', false,'post_workout','per_session',true,false,true),
('AS2','load','session','Felt strong and powered through this session?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'post_workout','per_session',true,false,true),
('RPE1','load','session','How hard was this session?','ordinal',
  '["Easy","Moderate","Hard","Max"]','{"Easy":0.25,"Moderate":0.5,"Hard":0.75,"Max":1.0}', false,'post_workout','per_session',true,true,true),

-- === AXIS A · RECOVERY STATE ===
('AF1','recovery_state','fatigue','Did your body feel heavy or sluggish today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('AF3','recovery_state','fatigue','Did you feel physically fresh today?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'dinner','daily',false,false,false),
('RS1','recovery_state','somatic','Tension headache, or catch yourself clenching your jaw, today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('RS2','recovery_state','somatic','Did it take a while to wind down and settle after the day?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('RS3','recovery_state','cognitive','Did a slip — forgetting something or a careless mistake — cause a problem or rework today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('RS4','recovery_state','cognitive','Felt mentally sharp and on top of things today?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'dinner','daily',false,false,false),

-- === AXIS A · RESTORATIVE SLEEP ===
('SQ1','sleep','quality','How hard was it to get out of bed?','ordinal',
  '["Easy","Normal","Had to push"]','{"Easy":0,"Normal":0.5,"Had to push":1}', false,'breakfast','daily',false,true,false),
('SQ2','sleep','quality','Wake feeling rested?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'breakfast','daily',false,false,false),
('SQ3','sleep','quality','Still groggy or foggy an hour after waking?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'breakfast','daily',false,false,false),
('SM1','sleep','maintenance','Was it a restless or broken night?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'breakfast','daily',false,false,false),
('SM2','sleep','maintenance','Wake earlier than you wanted and couldn''t get back to sleep?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'breakfast','daily',false,false,false),
('SD1','sleep','daytime','Nod off or fight to stay awake during the day?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('SD2','sleep','daytime','Need caffeine or a walk to get through an afternoon slump today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('SD3','sleep','daytime','Felt alert and clear-headed through the afternoon?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'dinner','daily',false,false,false),

-- === AXIS A · PHYSICAL READINESS ===
('PR1','readiness','soreness','Where are you sore today? (tap all that apply)','bodymap',
  '["None","Neck","Shoulders","Chest","Upper back","Lower back","Arms","Core","Glutes","Quads","Hamstrings","Calves"]',
  '{}', false,'dinner','daily',false,false,false),
('PR2','readiness','soreness','Muscles sore or fatigued even at rest today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),

-- === AXIS A · FUELING & ENERGY AVAILABILITY ===
('NR1','fueling','regulation','Eat past comfortable fullness?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'any_meal','per_meal',true,false,false),
('NR2','fueling','regulation','Eat when you weren''t actually hungry?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'any_meal','per_meal',true,false,false),
('NR3','fueling','regulation','Skip or significantly delay a planned meal today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('NC1','fueling','cravings','Eat something you hadn''t planned to today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('NC2','fueling','cravings','Give in to a strong craving today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('HY1','fueling','hydration','Urine colour this morning (1 clear … 7 dark)','chip',
  '["1","2","3","4","5","6","7"]','{"1":0,"2":0,"3":0.2,"4":0.4,"5":0.6,"6":0.8,"7":1.0}', false,'breakfast','daily',false,true,false),
('FD1','fueling','composition','Tonight''s dinner','composite',
  '["Usual","Lighter","Heavier","Carb-lean","Carb-heavy"]','{}', false,'dinner','daily',false,true,true),

-- === AXIS B · LIFE-DEMAND LOAD  (event-types daily, reflective weekly) ===
('LD1','life_demand','load','Snap at or feel short with someone?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('LD2','life_demand','load','Couldn''t switch off or relax in your downtime?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('LD3','life_demand','load','Things felt like they were piling up on you?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'weekly_review','weekly',false,false,false),
('LD4','life_demand','load','Couldn''t stop thinking about work after hours?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'weekly_review','weekly',false,false,false),
('LD5','life_demand','autonomy','Had unscheduled time that was genuinely yours?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'weekly_review','weekly',false,false,false),

-- === AXIS B · SOCIAL CONNECTION (down-weighted) ===
('CN1','social','connection','Have a meaningful or enjoyable interaction today?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'dinner','daily',false,false,false),
('CN2','social','connection','Turn down or avoid a social plan today?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('FR1','social','friction','Draining conflict or tense exchange with someone?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),
('FR2','social','friction','Felt let down or frustrated by someone?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner','daily',false,false,false),

-- === AXIS B · SUSTAINABILITY & MEANING (weekly) ===
('SU1','sustainability','devaluation','Did training feel like a chore rather than something you wanted?','boolean',
  '["No","Yes"]','{"No":0,"Yes":1}', false,'weekly_review','weekly',false,false,false),
('SU2','sustainability','affect','Felt genuinely calm or content at some point this week?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'weekly_review','weekly',false,false,false),
('SU3','sustainability','mastery','Made progress you felt good about this week?','boolean',
  '["No","Yes"]','{"Yes":0,"No":1}', true,'weekly_review','weekly',false,false,false);

-- ---- SANITY CHECKS (run after load) ---------------------------------------
-- SELECT dimension_id, count(*) FROM items GROUP BY 1 ORDER BY 1;   -- expect 40 items across 8 item-bearing dims
-- SELECT count(*) FROM items WHERE is_protective;                    -- expect 10
-- SELECT item_id FROM items WHERE fixed;                            -- expect SQ1, HY1, RPE1, FD1
