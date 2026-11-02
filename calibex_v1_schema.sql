-- ============================================================================
-- CALIBEX v1 SCHEMA
-- Three-tier behavioural instrument: items -> facets -> pillars
-- Joins to existing biometric spine on wake_date
-- PostgreSQL / Supabase
-- ============================================================================
--
-- DESIGN PRINCIPLES (baked into structure, do not violate downstream):
--   1. Everything stored ITEM-LEVEL (long format). One row per answer.
--      Scores are COMPUTED (views), never stored raw -- so the scoring model
--      can change without migrating data.
--   2. No 1-10 scales anywhere. Every item is behaviourally anchored:
--      boolean, or a small ordinal bucket mapped to a 0..1 severity.
--   3. Hierarchy: item -> facet -> pillar. Scores computed at each tier.
--   4. Weights exist in the schema (facet_weight) but are ALL EQUAL in v1.
--      The accumulating data teaches the weights later; structure doesn't block it.
--   5. "sampled but skipped" is distinct from "never sampled". Missing data
--      is explicit, never silently a zero.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- DIMENSION TABLES (the instrument definition: pillars, facets, items)
-- These are configuration, not user data. Seeded once, edited as the
-- instrument evolves (e.g. V2 promotion of voice themes into new items).
-- ----------------------------------------------------------------------------

CREATE TABLE pillars (
    pillar_id     text PRIMARY KEY,          -- 'nutrition','activity','sleep','stress','substances','social'
    display_name  text NOT NULL,
    sort_order    int  NOT NULL
);

CREATE TABLE facets (
    facet_id      text PRIMARY KEY,          -- e.g. 'sleep_onset','stress_somatic'
    pillar_id     text NOT NULL REFERENCES pillars(pillar_id),
    display_name  text NOT NULL,
    facet_weight  numeric NOT NULL DEFAULT 1.0,  -- v1: all equal. Tune later from data.
    sort_order    int  NOT NULL
);

CREATE TABLE items (
    item_id       text PRIMARY KEY,          -- e.g. 'S2','R1'
    facet_id      text NOT NULL REFERENCES facets(facet_id),
    prompt        text NOT NULL,             -- the question shown to the user
    response_type text NOT NULL,             -- 'boolean' | 'ordinal'
    -- For ordinal items: ordered option labels, and the 0..1 severity each maps to.
    -- For boolean: options ['No','Yes'], severity {No:0, Yes:1} (or inverted -- see is_inverted).
    options       jsonb NOT NULL,            -- e.g. ["Easy","Normal","Had to push"]
    severity_map  jsonb NOT NULL,            -- e.g. {"Easy":0,"Normal":0.5,"Had to push":1}
    -- Some items are protective (a "Yes" is GOOD, e.g. "woke rested").
    -- severity_map already encodes direction, but we flag it for clarity/UX.
    is_protective boolean NOT NULL DEFAULT false,
    -- An item can inform more than one facet (e.g. "snapped at someone" -> stress AND social).
    -- Secondary mappings live in item_facet_map below; facet_id above is the PRIMARY home.
    touchpoint    text NOT NULL,             -- 'breakfast'|'lunch'|'afternoon'|'dinner'|'any'
    active        boolean NOT NULL DEFAULT true,  -- soft-retire items without deleting history
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Many-to-many: an item can contribute to multiple facets (shared items).
-- Primary facet is also listed here with is_primary=true for uniform querying.
CREATE TABLE item_facet_map (
    item_id     text NOT NULL REFERENCES items(item_id),
    facet_id    text NOT NULL REFERENCES facets(facet_id),
    is_primary  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (item_id, facet_id)
);


-- ----------------------------------------------------------------------------
-- FACT TABLE (the actual logged answers -- the only high-volume table)
-- One row per item answered (or shown-and-skipped) per day.
-- ----------------------------------------------------------------------------

CREATE TABLE item_responses (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wake_date     date NOT NULL,             -- THE JOIN KEY. Same spine as cycles/workouts/meals.
    item_id       text NOT NULL REFERENCES items(item_id),
    -- The raw answer as chosen (one of items.options), or NULL if skipped.
    raw_value     text,
    -- Severity 0..1 derived from severity_map at write time, for fast scoring.
    -- NULL when skipped. Stored (not just computed) so a later change to
    -- severity_map doesn't silently rewrite history -- it reflects what the
    -- item meant on the day it was answered.
    severity      numeric,
    -- Explicit status so "skipped" != "never shown" != "answered".
    status        text NOT NULL DEFAULT 'answered',  -- 'answered'|'skipped'
    answered_at   timestamptz NOT NULL DEFAULT now(), -- real timestamp (matters for drowsiness etc.)
    touchpoint    text,                      -- which touchpoint this fired at
    CONSTRAINT severity_range CHECK (severity IS NULL OR (severity >= 0 AND severity <= 1)),
    CONSTRAINT status_valid    CHECK (status IN ('answered','skipped'))
);

-- One answer per item per day (re-answering updates the row).
CREATE UNIQUE INDEX uq_item_responses_day_item
    ON item_responses (wake_date, item_id);

CREATE INDEX ix_item_responses_wake_date ON item_responses (wake_date);
CREATE INDEX ix_item_responses_item      ON item_responses (item_id);


-- ----------------------------------------------------------------------------
-- SCORING VIEWS (computed, never stored -- change the model anytime)
--
-- TIER 1: facet score  = mean(severity) over ANSWERED items in that facet that day
--                        (proportion-of-flagged generalised to ordinal severity)
-- TIER 2: pillar score = facet_weight-weighted mean of that pillar's facet scores
-- TIER 3 (later): readiness = weighted blend of pillar scores + biometrics
--
-- All scores are 0..1 where HIGHER = MORE STRAIN (worse), so they correlate
-- naturally with next-day recovery in the expected (negative) direction.
-- A facet/pillar with no answered items that day is NULL (not 0) -- absence of
-- data is not absence of strain.
-- ----------------------------------------------------------------------------

CREATE VIEW v_facet_scores AS
SELECT
    r.wake_date,
    f.facet_id,
    f.pillar_id,
    COUNT(*) FILTER (WHERE r.status = 'answered')              AS items_answered,
    AVG(r.severity) FILTER (WHERE r.status = 'answered')       AS facet_score  -- NULL if none answered
FROM item_responses r
JOIN items  i ON i.item_id  = r.item_id
JOIN facets f ON f.facet_id = i.facet_id
GROUP BY r.wake_date, f.facet_id, f.pillar_id;

CREATE VIEW v_pillar_scores AS
SELECT
    fs.wake_date,
    fs.pillar_id,
    -- weighted mean of facet scores, ignoring facets with no data that day
    SUM(fs.facet_score * f.facet_weight)
        / NULLIF(SUM(f.facet_weight) FILTER (WHERE fs.facet_score IS NOT NULL), 0) AS pillar_score,
    COUNT(*) FILTER (WHERE fs.facet_score IS NOT NULL)         AS facets_with_data
FROM v_facet_scores fs
JOIN facets f ON f.facet_id = fs.facet_id
GROUP BY fs.wake_date, fs.pillar_id;

-- Wide daily summary: one row per wake_date, one column per pillar. Convenience
-- for correlation work and for joining to the biometric tables.
CREATE VIEW v_daily_pillar_wide AS
SELECT
    wake_date,
    MAX(pillar_score) FILTER (WHERE pillar_id = 'nutrition')   AS nutrition_strain,
    MAX(pillar_score) FILTER (WHERE pillar_id = 'activity')    AS activity_strain,
    MAX(pillar_score) FILTER (WHERE pillar_id = 'sleep')       AS sleep_strain,
    MAX(pillar_score) FILTER (WHERE pillar_id = 'stress')      AS stress_strain,
    MAX(pillar_score) FILTER (WHERE pillar_id = 'substances')  AS substance_strain,
    MAX(pillar_score) FILTER (WHERE pillar_id = 'social')      AS social_strain
FROM v_pillar_scores
GROUP BY wake_date;


-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (match the rest of the CALIBEX schema -- single user)
-- ----------------------------------------------------------------------------
ALTER TABLE item_responses ENABLE ROW LEVEL SECURITY;
-- Dimension tables are shared config; RLS optional. Enable if you prefer:
-- ALTER TABLE pillars        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE facets         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE items          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE item_facet_map ENABLE ROW LEVEL SECURITY;
-- (Add policies consistent with your existing tables' auth.uid() pattern.)
