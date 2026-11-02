-- ============================================================================
-- CALIBEX v2 SCHEMA — the 7-dimension athlete instrument (CAPTURE layer)
-- ============================================================================
-- Supersedes calibex_v1_schema.sql (the retired 6-pillar model — it never carried
-- real data; the capture app was never built). Joins the live biometric spine
-- (schema.sql) on wake_date. PostgreSQL / Supabase. Single user.
--
-- Folds in every pre-build readiness fix:
--   * 7 scored dimensions (not 6 pillars); each tagged axis A (next-day recovery)
--     or B (sustainability); Social starts DOWN-WEIGHTED (0.5).
--   * item_responses supports: a 3rd `na` status, PER-OCCURRENCE rows (per-session /
--     per-meal items no longer overwrite each other), multi-select + composite
--     answers (raw_json), a real `event_at` (e.g. FD1 eaten-at — load-bearing for
--     the M3 intraday-HR engine), and `edited` / `backfilled` flags.
--   * day_context flag (normal/travel/sick/rest) for life-irregularity integrity.
--   * body_measurements (weight/waist) and substance_log (alcohol/caffeine quick-log).
--   * RLS enabled WITH a single-user authenticated policy (v1 had RLS on, no policy
--     => all writes were silently denied).
--
-- SCORING VIEWS ARE DEFERRED TO M3. This layer is raw capture only.
-- Run this, THEN calibex_v2_seed.sql (the 21 Axis-A + 12 Axis-B items).
-- ============================================================================

-- Retire the v1 instrument objects (no real data — capture app was never built).
DROP VIEW  IF EXISTS v_daily_pillar_wide CASCADE;
DROP VIEW  IF EXISTS v_pillar_scores     CASCADE;
DROP VIEW  IF EXISTS v_facet_scores      CASCADE;
DROP TABLE IF EXISTS item_responses      CASCADE;
DROP TABLE IF EXISTS item_facet_map      CASCADE;
DROP TABLE IF EXISTS items               CASCADE;
DROP TABLE IF EXISTS facets              CASCADE;
DROP TABLE IF EXISTS pillars             CASCADE;

-- ----------------------------------------------------------------------------
-- DIMENSION TABLES (instrument definition — config; seeded in calibex_v2_seed.sql)
-- ----------------------------------------------------------------------------

CREATE TABLE dimensions (
    dimension_id  text PRIMARY KEY,          -- 'load','recovery_state','sleep','readiness','fueling','substances','life_demand','social','sustainability'
    display_name  text NOT NULL,
    axis          char(1) NOT NULL,          -- 'A' = next-day recovery | 'B' = weeks-long sustainability
    weight        numeric NOT NULL DEFAULT 1.0,  -- M3 scoring knob; Social seeds at 0.5 (founder's down-weight). Self-weighting tunes later.
    sort_order    int NOT NULL,
    CONSTRAINT dimensions_axis_chk CHECK (axis IN ('A','B'))
);

CREATE TABLE items (
    item_id        text PRIMARY KEY,          -- 'SQ1','RPE1','FD1',...
    dimension_id   text NOT NULL REFERENCES dimensions(dimension_id),
    facet          text,                      -- optional sub-group (sampler stratification + M3 scoring); e.g. 'sleep_quality'
    prompt         text NOT NULL,             -- the question shown
    response_type  text NOT NULL,             -- 'boolean'|'ordinal'|'chip'|'bodymap'|'composite'
    options        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ordered option labels
    severity_map   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- option -> 0..1 (higher = more strain); empty for informational items
    is_protective  boolean NOT NULL DEFAULT false,       -- asymmetric scoring: the good answer reduces strain, absence is neutral
    touchpoint     text NOT NULL,             -- 'breakfast'|'lunch'|'afternoon'|'dinner'|'post_workout'|'weekly_review'|'any_meal'
    cadence        text NOT NULL DEFAULT 'daily',   -- 'daily'|'per_meal'|'per_session'|'weekly'
    per_occurrence boolean NOT NULL DEFAULT false,  -- TRUE => may have multiple rows in a day (per session / per meal)
    fixed          boolean NOT NULL DEFAULT false,  -- always-shown anchor (bypasses the sampler)
    event_timed    boolean NOT NULL DEFAULT false,  -- carries a real event_at (e.g. FD1 eaten-at, session end)
    active         boolean NOT NULL DEFAULT true,   -- soft-retire; never delete (preserves history)
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT items_response_type_chk CHECK (response_type IN ('boolean','ordinal','chip','bodymap','composite')),
    CONSTRAINT items_touchpoint_chk    CHECK (touchpoint IN ('breakfast','lunch','afternoon','dinner','post_workout','weekly_review','any_meal')),
    CONSTRAINT items_cadence_chk       CHECK (cadence IN ('daily','per_meal','per_session','weekly'))
);
CREATE INDEX items_dimension_idx  ON items (dimension_id) WHERE active;
CREATE INDEX items_touchpoint_idx ON items (touchpoint)   WHERE active;

-- NOTE: cross-dimension item mapping (a few items inform two dimensions) is DEFERRED
-- to M3 with the scoring engine. At MVP every item has exactly one home dimension.

-- ----------------------------------------------------------------------------
-- item_sampler_state — per-item rotation state for the least-recently-served
-- sampler (see SAMPLER_SPEC.md). Updated when an item is PRESENTED (shown),
-- which is DISTINCT from whether it was answered/skipped — so "shown" stays a
-- clean signal and the skip-rate isn't polluted. Single user.
-- ----------------------------------------------------------------------------
CREATE TABLE item_sampler_state (
    item_id       text PRIMARY KEY REFERENCES items(item_id),
    last_shown_at timestamptz,                 -- NULL = never shown (cold start) = maximally stale
    times_shown   integer NOT NULL DEFAULT 0,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- FACT TABLE — item_responses (the only high-volume table)
-- One row per item answered / skipped / N-A per day, PER OCCURRENCE.
-- ----------------------------------------------------------------------------

CREATE TABLE item_responses (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wake_date    date NOT NULL,              -- THE JOIN KEY. App computes it via the ~4am-IST cutoff (post-midnight taps roll back).
    item_id      text NOT NULL REFERENCES items(item_id),
    occurrence   smallint NOT NULL DEFAULT 1,  -- 1 for daily items; 1,2,3… for per-session / per-meal items
    raw_value    text,                       -- single-value answers (boolean/ordinal/chip); NULL when skipped/na
    raw_json     jsonb,                      -- multi-select (bodymap regions) or composite (FD1 composition + time)
    severity     numeric,                    -- derived at write (frozen); NULL when skipped/na/informational
    status       text NOT NULL DEFAULT 'answered',  -- 'answered' | 'skipped' | 'na'
    touchpoint   text,                       -- which touchpoint fired this response
    event_at     timestamptz,               -- real event time (eaten-at, session end) — DISTINCT from answered_at
    answered_at  timestamptz NOT NULL DEFAULT now(),  -- when the user actually logged it
    edited       boolean NOT NULL DEFAULT false,      -- value changed after first write
    backfilled   boolean NOT NULL DEFAULT false,      -- logged for a PAST day (exclude from timing-sensitive correlations)
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ir_status_chk   CHECK (status IN ('answered','skipped','na')),
    CONSTRAINT ir_severity_chk CHECK (severity IS NULL OR (severity >= 0 AND severity <= 1))
);
-- One answer per item per day PER OCCURRENCE (fixes the per-session/per-meal overwrite bug).
CREATE UNIQUE INDEX uq_item_responses_day_item_occ ON item_responses (wake_date, item_id, occurrence);
CREATE INDEX ir_wake_date_idx ON item_responses (wake_date);
CREATE INDEX ir_item_idx      ON item_responses (item_id);
CREATE INDEX ir_event_at_idx  ON item_responses (event_at) WHERE event_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- day_context — one row per day; flags life-irregularity so the app can suppress
-- irrelevant items and M3 correlations can stratify/exclude. Default 'normal'.
-- ----------------------------------------------------------------------------
CREATE TABLE day_context (
    wake_date   date PRIMARY KEY,
    context     text NOT NULL DEFAULT 'normal',  -- 'normal' | 'travel' | 'sick' | 'rest'
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT day_context_chk CHECK (context IN ('normal','travel','sick','rest'))
);

-- ----------------------------------------------------------------------------
-- body_measurements — Axis-C raw numbers (weekly weight, monthly waist).
-- ----------------------------------------------------------------------------
CREATE TABLE body_measurements (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wake_date    date NOT NULL,
    metric       text NOT NULL,              -- 'weight' | 'waist'
    value        numeric NOT NULL,
    unit         text NOT NULL,              -- 'kg' | 'cm' | 'lb' | 'in'
    protocol     text,                       -- e.g. 'morning fasted'
    measured_at  timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT body_metric_chk CHECK (metric IN ('weight','waist')),
    CONSTRAINT body_unit_chk   CHECK (unit IN ('kg','cm','lb','in'))
);
CREATE UNIQUE INDEX uq_body_measure_day_metric ON body_measurements (wake_date, metric);

-- ----------------------------------------------------------------------------
-- substance_log — alcohol + caffeine quick-loggers (dose buckets + event time).
-- One row per consumption event (preserves consumed_at for the M3 intraday engine).
-- A dedicated table beats overloading the spine's `drinks` table — cleaner dose
-- buckets and a first-class event time. Default = nothing logged = none.
-- ----------------------------------------------------------------------------
CREATE TABLE substance_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wake_date    date NOT NULL,
    substance    text NOT NULL,              -- 'alcohol' | 'caffeine'
    dose_bucket  text,                       -- alcohol: '1-2'|'3-4'|'5+'  ·  caffeine: cups or 'less'|'usual'|'more'
    amount       numeric,                    -- optional numeric (units / cups / mg) — err LOW per principle #3
    consumed_at  timestamptz NOT NULL DEFAULT now(),  -- event time
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT substance_chk CHECK (substance IN ('alcohol','caffeine'))
);
CREATE INDEX substance_log_wake_date_idx ON substance_log (wake_date);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY — single user. Enable + an authenticated-user policy on
-- every capture table. (v1 enabled RLS with NO policy => default-deny on all
-- writes. This is the fix.) Assumes Supabase Auth with one account; the client
-- uses the publishable/anon key, never the secret key.
-- ----------------------------------------------------------------------------
ALTER TABLE item_responses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_context        ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_measurements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE substance_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_sampler_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY ir_authd  ON item_responses     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY dc_authd  ON day_context        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY bm_authd  ON body_measurements  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sl_authd  ON substance_log      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY iss_authd ON item_sampler_state FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- dimensions + items are shared read-only config; leave RLS off (or enable with a
-- read-only authenticated SELECT policy). Tighten any of the above to auth.uid()
-- if the spine ever gains a user_id column.

-- ----------------------------------------------------------------------------
-- v_readout — DISPLAY reshaping for the readout screen (NOT a scoring view).
-- Pairs each behaviour-day D with its next-morning recovery (wake_date D+1),
-- per the N-1 offset. LEFT JOIN so TODAY's behaviour shows recovery = NULL
-- ("syncs tomorrow"). The app pulls per-item detail + substance events separately.
-- See READOUT_SPEC.md.
-- ----------------------------------------------------------------------------
CREATE VIEW v_readout AS
SELECT
    ir.wake_date                                              AS behaviour_date,
    rec.wake_date                                            AS recovery_date,   -- D+1; NULL if not synced yet
    rec.recovery_score,
    rec.hrv_rmssd_ms,
    rec.resting_heart_rate,
    COUNT(*) FILTER (WHERE ir.status = 'answered')           AS items_answered,
    COUNT(*) FILTER (WHERE ir.status = 'skipped')            AS items_skipped
FROM item_responses ir
LEFT JOIN cycles rec ON rec.wake_date = ir.wake_date + 1     -- next-morning recovery (N-1 offset)
GROUP BY ir.wake_date, rec.wake_date, rec.recovery_score, rec.hrv_rmssd_ms, rec.resting_heart_rate;
