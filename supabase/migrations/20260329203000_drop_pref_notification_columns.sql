-- Remove duplicate pref_* notification columns. Only notify_* columns
-- are used by send-notification and exposed in settings UI.
ALTER TABLE public.notification_preferences
  DROP COLUMN IF EXISTS pref_messages,
  DROP COLUMN IF EXISTS pref_matches,
  DROP COLUMN IF EXISTS pref_events,
  DROP COLUMN IF EXISTS pref_daily_drop,
  DROP COLUMN IF EXISTS pref_video_dates,
  DROP COLUMN IF EXISTS pref_vibes_social,
  DROP COLUMN IF EXISTS pref_marketing,
  DROP COLUMN IF EXISTS pref_account_safety;
