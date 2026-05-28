-- Follow-ups for Codex review comments across PRs 1099-1106.

BEGIN;

-- Null subscription ids are ambiguous on multi-device accounts. Treat them as
-- a no-op so one SDK-not-ready logout cannot unregister another device or clear
-- the legacy per-user OneSignal mirrors for the wrong device.
CREATE OR REPLACE FUNCTION public.unregister_onesignal_push_subscription(
  p_subscription_id text DEFAULT NULL,
  p_platform text DEFAULT 'native'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_subscription_id text := NULLIF(btrim(COALESCE(p_subscription_id, '')), '');
  v_platform text := public.normalize_onesignal_push_platform(p_platform);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unregister_onesignal_push_subscription requires an authenticated user'
      USING ERRCODE = '28000';
  END IF;

  IF v_subscription_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_id = v_user_id
    AND provider = 'onesignal'
    AND subscription_id = v_subscription_id
    AND (
      v_platform = 'unknown'
      OR platform = v_platform
      OR (v_platform IN ('ios', 'android', 'native') AND platform IN ('ios', 'android', 'native'))
    );

  IF v_platform = 'web' THEN
    UPDATE public.notification_preferences
    SET
      onesignal_player_id = NULL,
      onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND onesignal_player_id = v_subscription_id;
  ELSE
    UPDATE public.notification_preferences
    SET
      mobile_onesignal_player_id = NULL,
      mobile_onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND mobile_onesignal_player_id = v_subscription_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_onesignal_push_subscription(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
