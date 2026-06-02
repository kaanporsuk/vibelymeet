-- Require push subscription RPC callers to agree with the authenticated user
-- they are mutating. This closes auth/session drift races between client-side
-- permission prompts and the final Supabase RPC execution.

BEGIN;

DROP FUNCTION IF EXISTS public.register_onesignal_push_subscription(text, text, boolean);
DROP FUNCTION IF EXISTS public.unregister_onesignal_push_subscription(text, text);

-- These RPCs intentionally remain in the exposed public schema for Supabase
-- client RPC compatibility, but client roles must never be able to create
-- public-schema objects that could shadow SECURITY DEFINER references.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_onesignal_push_subscription(
  p_subscription_id text,
  p_platform text DEFAULT 'native',
  p_subscribed boolean DEFAULT true,
  p_expected_user_id uuid DEFAULT NULL
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
    RAISE EXCEPTION 'register_onesignal_push_subscription requires an authenticated user'
      USING ERRCODE = '28000';
  END IF;

  IF p_expected_user_id IS NOT NULL AND p_expected_user_id <> v_user_id THEN
    RAISE EXCEPTION 'register_onesignal_push_subscription user mismatch'
      USING ERRCODE = '28000';
  END IF;

  IF v_subscription_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id,
    provider,
    subscription_id,
    platform,
    subscribed,
    last_seen_at,
    updated_at
  )
  VALUES (
    v_user_id,
    'onesignal',
    v_subscription_id,
    v_platform,
    COALESCE(p_subscribed, false),
    now(),
    now()
  )
  ON CONFLICT (provider, subscription_id) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    subscribed = EXCLUDED.subscribed,
    last_seen_at = now(),
    updated_at = now();

  PERFORM set_config('vibely.onesignal_rpc_write', 'on', true);

  INSERT INTO public.notification_preferences (
    user_id,
    onesignal_player_id,
    onesignal_subscribed,
    mobile_onesignal_player_id,
    mobile_onesignal_subscribed
  )
  VALUES (
    v_user_id,
    CASE WHEN v_platform = 'web' THEN v_subscription_id ELSE NULL END,
    CASE WHEN v_platform = 'web' THEN COALESCE(p_subscribed, false) ELSE false END,
    CASE WHEN v_platform <> 'web' THEN v_subscription_id ELSE NULL END,
    CASE WHEN v_platform <> 'web' THEN COALESCE(p_subscribed, false) ELSE false END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    onesignal_player_id = CASE
      WHEN v_platform = 'web' THEN v_subscription_id
      ELSE public.notification_preferences.onesignal_player_id
    END,
    onesignal_subscribed = CASE
      WHEN v_platform = 'web' THEN COALESCE(p_subscribed, false)
      ELSE public.notification_preferences.onesignal_subscribed
    END,
    mobile_onesignal_player_id = CASE
      WHEN v_platform <> 'web' THEN v_subscription_id
      ELSE public.notification_preferences.mobile_onesignal_player_id
    END,
    mobile_onesignal_subscribed = CASE
      WHEN v_platform <> 'web' THEN COALESCE(p_subscribed, false)
      ELSE public.notification_preferences.mobile_onesignal_subscribed
    END,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_onesignal_push_subscription(
  p_subscription_id text DEFAULT NULL,
  p_platform text DEFAULT 'native',
  p_expected_user_id uuid DEFAULT NULL
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

  IF p_expected_user_id IS NOT NULL AND p_expected_user_id <> v_user_id THEN
    RAISE EXCEPTION 'unregister_onesignal_push_subscription user mismatch'
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

  PERFORM set_config('vibely.onesignal_rpc_write', 'on', true);

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

REVOKE ALL ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.unregister_onesignal_push_subscription(text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
