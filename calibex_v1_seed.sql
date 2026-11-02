-- ============================================================================
-- CALIBEX v1 SEED DATA
-- The instrument itself: 6 pillars -> facets -> 28 items.
-- Run AFTER calibex_v1_schema.sql.
-- ============================================================================

-- ---- PILLARS --------------------------------------------------------------
INSERT INTO pillars (pillar_id, display_name, sort_order) VALUES
    ('nutrition',  'Nutrition',                   1),
    ('activity',   'Physical Activity',           2),
    ('sleep',      'Restorative Sleep',           3),
    ('stress',     'Stress',                      4),
    ('substances', 'Risky Substances',            5),
    ('social',     'Social Connection',           6);

-- ---- FACETS ---------------------------------------------------------------
-- Each pillar split into the aspects we actually want scored separately.
-- facet_weight all 1.0 in v1 (equal). Tune from data later.
INSERT INTO facets (facet_id, pillar_id, display_name, facet_weight, sort_order) VALUES
    -- Nutrition: photos carry macros; facets catch behavioural/regulation signals
    ('nutr_regulation', 'nutrition', 'Eating regulation',     1.0, 1),
    ('nutr_cravings',   'nutrition', 'Cravings / drive',      1.0, 2),
    -- Activity: WHOOP carries load; facets catch subjective capacity
    ('act_adherence',   'activity',  'Session adherence',     1.0, 1),
    ('act_capacity',    'activity',  'Physical capacity',     1.0, 2),
    -- Sleep: WHOOP carries duration/stages; facets catch onset/maintenance/daytime
    ('sleep_quality',   'sleep',     'Perceived quality',     1.0, 1),
    ('sleep_maint',     'sleep',     'Night maintenance',     1.0, 2),
    ('sleep_daytime',   'sleep',     'Daytime consequence',   1.0, 3),
    -- Stress: the core soft-signal pillar, three distinct facets
    ('stress_somatic',  'stress',    'Somatic tension',       1.0, 1),
    ('stress_emotional','stress',    'Emotional load',        1.0, 2),
    ('stress_cognitive','stress',    'Cognitive slips',       1.0, 3),
    -- Substances: dose + timing
    ('subs_alcohol',    'substances','Alcohol',               1.0, 1),
    ('subs_caffeine',   'substances','Caffeine',              1.0, 2),
    -- Social: connection vs. friction vs. withdrawal
    ('soc_connection',  'social',    'Positive connection',   1.0, 1),
    ('soc_friction',    'social',    'Interpersonal friction',1.0, 2);

-- ---- ITEMS ----------------------------------------------------------------
-- severity: 0 = no strain, 1 = max strain. Protective items invert (Yes = good = 0).
-- response_type 'boolean' uses options ["No","Yes"]; 'ordinal' uses listed buckets.

INSERT INTO items (item_id, facet_id, prompt, response_type, options, severity_map, is_protective, touchpoint) VALUES

-- NUTRITION
('N1','nutr_regulation','Skip or avoid a planned meal today?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('N2','nutr_cravings','Crave sugar/salt/fat more than usual?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('N3','nutr_regulation','Eat past comfortable fullness?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('N4','nutr_regulation','Eat mainly for reasons other than hunger (stress, boredom)?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),

-- ACTIVITY
('P1','act_adherence','Skip or shorten a planned session?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('P2','act_capacity','Legs feel heavy on stairs or walking?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('P3','act_capacity','How hard was it to start training?','ordinal',
   '["Easy start","Normal","Hard push"]','{"Easy start":0,"Normal":0.5,"Hard push":1}', false,'lunch'),
('P4','act_capacity','First-session effort vs normal?','ordinal',
   '["Easier","Same","Harder"]','{"Easier":0,"Same":0.5,"Harder":1}', false,'afternoon'),

-- SLEEP
('R1','sleep_quality','How hard was it to get out of bed?','ordinal',
   '["Easy","Normal","Had to push"]','{"Easy":0,"Normal":0.5,"Had to push":1}', false,'breakfast'),
('R2','sleep_quality','Wake feeling rested?','boolean',
   '["No","Yes"]','{"No":1,"Yes":0}', true,'breakfast'),
('R3','sleep_daytime','Nod off unintentionally during the day?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('R4','sleep_daytime','Fight off afternoon sleepiness?','ordinal',
   '["No","Yes - used caffeine","Yes - pushed through"]','{"No":0,"Yes - used caffeine":0.5,"Yes - pushed through":1}', false,'afternoon'),
('R5','sleep_maint','Wake during the night and struggle to resettle?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'breakfast'),

-- STRESS
('S1','stress_emotional','Snap at or feel short with someone?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('S2','stress_somatic','Jaw or shoulders tense when you noticed?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('S3','stress_somatic','Breathing feel shallow or stuck in your chest?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('S4','stress_emotional','Unable to relax or switch off in downtime?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('S5','stress_cognitive','Mind wander to something worrying while reading/working?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('S6','stress_emotional','Feel like things were getting on top of you?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('S7','stress_cognitive','Made a silly mistake you normally would not?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('S8','stress_cognitive','Re-read a sentence because your mind drifted?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),
('S9','stress_cognitive','Forget something you had just decided to do?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'afternoon'),

-- SUBSTANCES
('A1','subs_alcohol','Alcohol today?','ordinal',
   '["None","1-2","3-4","5+"]','{"None":0,"1-2":0.33,"3-4":0.66,"5+":1}', false,'dinner'),
('A2','subs_caffeine','Caffeine after 2pm?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('A3','subs_caffeine','Caffeine total vs normal?','ordinal',
   '["Less","Normal","More"]','{"Less":0,"Normal":0.5,"More":1}', false,'dinner'),

-- SOCIAL
('C1','soc_connection','Any meaningful or enjoyable interaction?','boolean',
   '["No","Yes"]','{"No":1,"Yes":0}', true,'dinner'),
('C2','soc_friction','Any draining conflict or tension with someone?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner'),
('C3','soc_connection','Avoid a social interaction you would normally take?','boolean',
   '["No","Yes"]','{"No":0,"Yes":1}', false,'dinner');
-- C3: avoiding a normal interaction = withdrawal = strain -> Yes=1, No=0. Not protective.

-- ---- ITEM -> FACET MAP ----------------------------------------------------
-- Primary home for every item, plus the cross-pillar shared mappings.
INSERT INTO item_facet_map (item_id, facet_id, is_primary)
SELECT item_id, facet_id, true FROM items;

-- Shared / secondary mappings (item informs a second facet):
-- S1 "snapped at someone" is emotional stress (primary) AND interpersonal friction (social)
INSERT INTO item_facet_map (item_id, facet_id, is_primary) VALUES
    ('S1','soc_friction', false),
-- C3 "avoided social interaction" is social withdrawal (primary) AND an emotional/mood signal
    ('C3','stress_emotional', false);
