-- Add 8 toggle groups for notification preferences (design spec: 44 notification types).
-- Native app and send-notification Edge Function use these; legacy notify_* columns remain for web.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS pref_messages boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_matches boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_events boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_daily_drop boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_video_dates boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_vibes_social boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS pref_marketing boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pref_account_safety boolean DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.pref_messages IS 'Messages, voice/video, reactions, date proposal responses';
COMMENT ON COLUMN public.notification_preferences.pref_matches IS 'New match, mutual vibe, who liked you';
COMMENT ON COLUMN public.notification_preferences.pref_events IS 'Registration, reminders, live, ended, new in city, almost full';
COMMENT ON COLUMN public.notification_preferences.pref_daily_drop IS 'Drop available, opener, reply, expiring';
COMMENT ON COLUMN public.notification_preferences.pref_video_dates IS 'Partner ready, date starting, reconnection';
COMMENT ON COLUMN public.notification_preferences.pref_vibes_social IS 'Someone vibed you, super vibe';
COMMENT ON COLUMN public.notification_preferences.pref_marketing IS 'Premium teaser, re-engagement, weekly summary';
COMMENT ON COLUMN public.notification_preferences.pref_account_safety IS 'Welcome, verification, subscription, credits, deletion, pause (locked on in UI)';
