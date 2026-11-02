-- CALIBEX Health Tracking Database Schema
-- wake_date (DATE) is the universal join key across all tables

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- cycles: WHOOP physiological cycle & recovery data
-- ---------------------------------------------------------------------------
CREATE TABLE cycles (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL,

    -- cycle window
    cycle_start                 TIMESTAMPTZ,
    cycle_end                   TIMESTAMPTZ,

    -- recovery
    recovery_score              NUMERIC(5,2),       -- 0–100
    hrv_rmssd_ms                NUMERIC(8,3),
    resting_heart_rate          NUMERIC(5,1),
    skin_temp_celsius           NUMERIC(5,2),
    blood_oxygen_percent        NUMERIC(5,2),
    respiratory_rate            NUMERIC(5,2),

    -- sleep window
    sleep_start                 TIMESTAMPTZ,
    sleep_end                   TIMESTAMPTZ,

    -- sleep performance
    sleep_performance_percent   NUMERIC(5,2),
    sleep_consistency_percent   NUMERIC(5,2),
    sleep_efficiency_percent    NUMERIC(5,2),

    -- sleep staging (minutes)
    total_sleep_minutes         NUMERIC(7,2),
    rem_sleep_minutes           NUMERIC(7,2),
    light_sleep_minutes         NUMERIC(7,2),
    deep_sleep_minutes          NUMERIC(7,2),
    awake_minutes               NUMERIC(7,2),

    -- sleep need & debt (minutes)
    sleep_need_minutes          NUMERIC(7,2),
    sleep_debt_minutes          NUMERIC(7,2),

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX cycles_wake_date_idx ON cycles (wake_date);

-- ---------------------------------------------------------------------------
-- workouts: WHOOP workout / strain data
-- ---------------------------------------------------------------------------
CREATE TABLE workouts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL,

    sport_name                  TEXT,
    workout_start               TIMESTAMPTZ,
    workout_end                 TIMESTAMPTZ,

    strain_score                NUMERIC(5,2),       -- 0–21
    average_heart_rate          INTEGER,
    max_heart_rate              INTEGER,
    calories_burned             NUMERIC(8,2),
    distance_meters             NUMERIC(10,2),

    duration_minutes            NUMERIC(7,2),

    -- heart rate zone percentages (as exported by WHOOP)
    zone_one_percent            NUMERIC(5,2),
    zone_two_percent            NUMERIC(5,2),
    zone_three_percent          NUMERIC(5,2),
    zone_four_percent           NUMERIC(5,2),
    zone_five_percent           NUMERIC(5,2),

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX workouts_wake_date_idx ON workouts (wake_date);

-- ---------------------------------------------------------------------------
-- meals: food logging
-- ---------------------------------------------------------------------------
CREATE TABLE meals (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL,

    meal_name                   TEXT,
    logged_at                   TIMESTAMPTZ,

    calories                    NUMERIC(8,2),
    protein_g                   NUMERIC(8,2),
    carbs_g                     NUMERIC(8,2),
    fat_g                       NUMERIC(8,2),
    fiber_g                     NUMERIC(8,2),

    notes                       TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX meals_wake_date_idx ON meals (wake_date);

-- ---------------------------------------------------------------------------
-- drinks: beverage logging
-- ---------------------------------------------------------------------------
CREATE TABLE drinks (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL,

    drink_name                  TEXT,
    logged_at                   TIMESTAMPTZ,

    volume_ml                   NUMERIC(8,2),
    calories                    NUMERIC(8,2),
    caffeine_mg                 NUMERIC(8,2),
    alcohol_units               NUMERIC(5,2),

    notes                       TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX drinks_wake_date_idx ON drinks (wake_date);

-- ---------------------------------------------------------------------------
-- supplements: supplement logging
-- ---------------------------------------------------------------------------
CREATE TABLE supplements (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL,

    supplement_name             TEXT NOT NULL,
    logged_at                   TIMESTAMPTZ,
    dose_amount                 NUMERIC(10,3),
    dose_unit                   TEXT,               -- e.g. 'mg', 'mcg', 'g', 'IU'

    notes                       TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX supplements_wake_date_idx ON supplements (wake_date);

-- ---------------------------------------------------------------------------
-- daily_habits: stub
-- ---------------------------------------------------------------------------
CREATE TABLE daily_habits (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL UNIQUE,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- journal: stub
-- ---------------------------------------------------------------------------
CREATE TABLE journal (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wake_date                   DATE NOT NULL,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX journal_wake_date_idx ON journal (wake_date);
