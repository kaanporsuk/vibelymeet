-- Sprint 3: Support mobile push alongside web. Additive, backward-compatible.
-- Web keeps using onesignal_player_id; mobile app will set mobile_onesignal_player_id.
-- send-notification will target both when present.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS mobile_onesignal_player_id TEXT,
  ADD COLUMN IF NOT EXISTS mobile_onesignal_subscribed BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.notification_preferences.mobile_onesignal_player_id IS 'OneSignal subscription/player ID for native iOS/Android app; used with onesignal_player_id for multi-device delivery';
