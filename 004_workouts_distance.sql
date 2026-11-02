-- 004_workouts_distance.sql
-- Add distance_meters column to workouts (present in schema.sql source but missing
-- from the live database — likely applied an earlier schema version).

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS distance_meters NUMERIC(10,2);
