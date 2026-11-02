-- 006_cycles_extended.sql
-- Extend cycles with day-level strain/HR/energy and additional sleep metrics.

ALTER TABLE cycles
  ADD COLUMN IF NOT EXISTS day_strain              NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS day_average_heart_rate  INTEGER,
  ADD COLUMN IF NOT EXISTS day_max_heart_rate      INTEGER,
  ADD COLUMN IF NOT EXISTS day_calories            NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS time_in_bed_minutes     NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS sleep_disturbance_count INTEGER;
