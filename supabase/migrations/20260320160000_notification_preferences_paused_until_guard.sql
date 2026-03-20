-- Idempotent guard: paused_until exists on notification_preferences since initial schema;
-- safe to run if someone runs SQL manually without the column.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ DEFAULT NULL;
