-- Separate push bucket for incoming chat voice/video calls (match_call category).
-- Seeded from notify_messages so existing behavior is preserved; users can opt out of call pushes without disabling message pushes.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_match_calls boolean;

UPDATE public.notification_preferences
SET notify_match_calls = COALESCE(notify_messages, true)
WHERE notify_match_calls IS NULL;

ALTER TABLE public.notification_preferences
  ALTER COLUMN notify_match_calls SET DEFAULT true;

ALTER TABLE public.notification_preferences
  ALTER COLUMN notify_match_calls SET NOT NULL;

COMMENT ON COLUMN public.notification_preferences.notify_match_calls IS
  'Push notifications for incoming voice/video calls from matches (category match_call). Independent from notify_messages.';
