-- 003_workouts_dedup.sql
-- Dedupe workouts and add a unique constraint on workout_start so re-imports
-- are idempotent going forward.

-- 1) Delete duplicates, keeping the earliest-created row per workout_start.
DELETE FROM workouts a
USING workouts b
WHERE a.workout_start = b.workout_start
  AND a.workout_start IS NOT NULL
  AND a.created_at > b.created_at;

-- 2) Safety: if any remain with identical workout_start (same created_at edge case), keep smallest id.
DELETE FROM workouts a
USING workouts b
WHERE a.workout_start = b.workout_start
  AND a.workout_start IS NOT NULL
  AND a.id > b.id;

-- 3) Add a unique constraint for future upserts.
ALTER TABLE workouts
  ADD CONSTRAINT workouts_workout_start_key UNIQUE (workout_start);
