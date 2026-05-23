-- Follow-ups for Codex review comments on PRs 1021 and 1026.
-- Re-applies function definitions for already-created cloud databases.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_vibe_video_upload_status(
  p_provider_object_id text,
  p_new_status text,
  p_error_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_provider_object_id text := NULLIF(btrim(COALESCE(p_provider_object_id, '')), '');
  v_upload public.vibe_video_uploads%ROWTYPE;
  v_old_status text;
  v_allowed boolean := false;
  v_media_asset_id uuid;
BEGIN
  IF v_provider_object_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_object_id_required');
  END IF;

  IF p_new_status NOT IN ('uploading', 'processing', 'ready', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_transition');
  END IF;

  SELECT *
  INTO v_upload
  FROM public.vibe_video_uploads
  WHERE provider_object_id = v_provider_object_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'upload_not_found');
  END IF;

  v_old_status := v_upload.status;
  v_media_asset_id := v_upload.media_asset_id;

  IF v_media_asset_id IS NULL THEN
    SELECT id
    INTO v_media_asset_id
    FROM public.media_assets
    WHERE provider = 'bunny_stream'
      AND provider_object_id = v_provider_object_id
      AND media_family = 'vibe_video'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  END IF;

  IF v_media_asset_id IS NOT NULL AND v_upload.media_asset_id IS NULL THEN
    UPDATE public.vibe_video_uploads
    SET media_asset_id = v_media_asset_id
    WHERE id = v_upload.id
      AND media_asset_id IS NULL
    RETURNING * INTO v_upload;
  END IF;

  IF v_old_status = p_new_status THEN
    UPDATE public.profile_vibe_videos pvv
    SET video_status = p_new_status
    FROM public.media_assets ma
    WHERE pvv.asset_id = ma.id
      AND ma.provider = 'bunny_stream'
      AND ma.provider_object_id = v_provider_object_id;

    UPDATE public.profiles
    SET bunny_video_status = p_new_status
    WHERE id = v_upload.user_id
      AND bunny_video_uid = v_provider_object_id;

    RETURN jsonb_build_object(
      'success', true,
      'upload_attempt_id', v_upload.id,
      'media_asset_id', v_media_asset_id,
      'session_id', NULL,
      'previous_status', v_old_status,
      'new_status', p_new_status,
      'idempotent', true
    );
  END IF;

  IF v_old_status IN ('failed', 'superseded') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_transition',
      'previous_status', v_old_status,
      'new_status', p_new_status
    );
  END IF;

  IF p_new_status = 'failed' AND v_old_status IN ('uploading', 'processing', 'ready') THEN
    v_allowed := true;
  ELSIF p_new_status = 'processing' AND v_old_status = 'uploading' THEN
    v_allowed := true;
  ELSIF p_new_status = 'ready' AND v_old_status IN ('uploading', 'processing') THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_transition',
      'previous_status', v_old_status,
      'new_status', p_new_status
    );
  END IF;

  UPDATE public.vibe_video_uploads
  SET status = p_new_status,
      media_asset_id = COALESCE(media_asset_id, v_media_asset_id),
      error_detail = CASE
        WHEN p_new_status = 'failed' THEN COALESCE(p_error_detail, error_detail)
        ELSE NULL
      END
  WHERE id = v_upload.id
  RETURNING * INTO v_upload;

  v_media_asset_id := COALESCE(v_upload.media_asset_id, v_media_asset_id);

  UPDATE public.profile_vibe_videos pvv
  SET video_status = p_new_status
  FROM public.media_assets ma
  WHERE pvv.asset_id = ma.id
    AND ma.provider = 'bunny_stream'
    AND ma.provider_object_id = v_provider_object_id;

  UPDATE public.profiles
  SET bunny_video_status = p_new_status
  WHERE id = v_upload.user_id
    AND bunny_video_uid = v_provider_object_id;

  RETURN jsonb_build_object(
    'success', true,
    'upload_attempt_id', v_upload.id,
    'media_asset_id', v_media_asset_id,
    'session_id', NULL,
    'previous_status', v_old_status,
    'new_status', p_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_vibe_video_upload_status(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_vibe_video_upload_status(text, text, text)
  TO service_role;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
