-- Follow-ups for Codex review comments across PRs 1086-1100.
-- This migration re-applies database fixes in forward-only form so cloud
-- projects that already ran earlier merged migrations still reach the safe
-- final state.

BEGIN;

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

  IF v_subscription_id IS NOT NULL THEN
    DELETE FROM public.push_subscriptions
    WHERE user_id = v_user_id
      AND provider = 'onesignal'
      AND subscription_id = v_subscription_id
      AND (
        v_platform = 'unknown'
        OR platform = v_platform
        OR (v_platform IN ('ios', 'android', 'native') AND platform IN ('ios', 'android', 'native'))
      );
  END IF;

  IF v_platform = 'web' THEN
    UPDATE public.notification_preferences
    SET
      onesignal_player_id = NULL,
      onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND (v_subscription_id IS NULL OR onesignal_player_id = v_subscription_id);
  ELSE
    UPDATE public.notification_preferences
    SET
      mobile_onesignal_player_id = NULL,
      mobile_onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND (v_subscription_id IS NULL OR mobile_onesignal_player_id = v_subscription_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_onesignal_push_subscription(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_profile_from_auth_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inserted integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ensure_profile_from_auth_user requires an authenticated user'
      USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RETURN false;
  END IF;

  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
    INSERT INTO public.profiles (
      id,
      name,
      age,
      gender,
      birth_date
    )
    VALUES (
      v_user_id,
      '',
      18,
      'prefer_not_to_say',
      NULL
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
  RETURN v_inserted > 0;
END;
$$;

COMMENT ON FUNCTION public.ensure_profile_from_auth_user() IS
  'Authenticated fallback for a missing auth.users -> profiles bootstrap row. Inserts only the caller profile id plus safe onboarding defaults through the backend-owned profile insert guard.';

REVOKE ALL ON FUNCTION public.ensure_profile_from_auth_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile_from_auth_user() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
