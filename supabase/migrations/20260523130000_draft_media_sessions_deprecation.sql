-- Sprint 4: deprecate draft_media_sessions as an active media source of truth.
--
-- The table and legacy RPCs stay available for one release so old in-flight
-- uploads can still complete, but new Vibe Video and profile-photo paths are
-- authoritative through vibe_video_uploads, media_upload_receipts, media_assets,
-- media_references, and profile_vibe_videos.

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
COMMENT ON FUNCTION public.update_vibe_video_upload_status(text, text, text) IS
  'Modern provider-object keyed Vibe Video status transition RPC. Replaces draft_media_sessions status writes for new uploads.';

CREATE OR REPLACE FUNCTION public.complete_profile_photo_media_upload(
  p_receipt_id uuid,
  p_owner_user_id uuid,
  p_context text,
  p_provider text,
  p_provider_path text,
  p_mime_type text DEFAULT NULL,
  p_bytes bigint DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_receipt public.media_upload_receipts%ROWTYPE;
  v_from text;
  v_asset_result jsonb;
  v_asset_id uuid;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_receipt_id IS NULL OR p_owner_user_id IS NULL OR btrim(COALESCE(p_provider_path, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'receipt_owner_and_path_required');
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.media_upload_receipts
  WHERE id = p_receipt_id
    AND owner_user_id = p_owner_user_id
    AND media_family = 'profile_photo'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'receipt_not_found');
  END IF;

  IF p_content_sha256 IS NOT NULL
    AND lower(btrim(p_content_sha256)) IS DISTINCT FROM v_receipt.content_sha256
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'content_sha256_mismatch');
  END IF;

  IF v_receipt.provider IS NOT NULL
    AND p_provider IS NOT NULL
    AND p_provider IS DISTINCT FROM v_receipt.provider
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_mismatch');
  END IF;

  IF v_receipt.provider_path IS NOT NULL
    AND p_provider_path IS NOT NULL
    AND p_provider_path IS DISTINCT FROM v_receipt.provider_path
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'provider_path_mismatch');
  END IF;

  v_from := v_receipt.status;

  v_asset_result := public.upsert_media_asset(
    p_provider,
    'profile_photo',
    p_owner_user_id,
    NULL,
    p_provider_path,
    p_mime_type,
    p_bytes,
    p_content_sha256,
    'uploaded',
    'media_upload_receipts',
    p_receipt_id::text
  );

  IF COALESCE((v_asset_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_asset_result->>'error', 'asset_upsert_failed'),
      'code', v_asset_result->>'code'
    );
  END IF;

  v_asset_id := (v_asset_result->>'asset_id')::uuid;

  UPDATE public.media_assets
  SET legacy_table = 'media_upload_receipts',
      legacy_id = p_receipt_id::text
  WHERE id = v_asset_id;

  UPDATE public.media_upload_receipts
  SET status = 'uploaded',
      asset_id = v_asset_id,
      provider_path = COALESCE(provider_path, p_provider_path),
      metadata = metadata || v_metadata,
      last_error = NULL,
      next_retry_at = NULL
  WHERE id = v_receipt.id
  RETURNING * INTO v_receipt;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'asset_id', v_asset_id,
    'session_id', NULL,
    'status_from', v_from,
    'status_to', v_receipt.status,
    'provider_path', v_receipt.provider_path,
    'content_sha256', v_receipt.content_sha256,
    'metadata', v_receipt.metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_profile_photo_media_upload(uuid, uuid, text, text, text, text, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_profile_photo_media_upload(uuid, uuid, text, text, text, text, bigint, text, jsonb)
  TO service_role;
COMMENT ON FUNCTION public.complete_profile_photo_media_upload(uuid, uuid, text, text, text, text, bigint, text, jsonb) IS
  'Completes profile-photo upload receipts through media_assets without creating draft_media_sessions rows.';

CREATE OR REPLACE FUNCTION public.publish_photo_set(
  p_user_id uuid,
  p_photos text[],
  p_context text DEFAULT 'profile_studio'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_photos text[] := COALESCE(p_photos, ARRAY[]::text[]);
  v_avatar text;
  v_len int;
  v_owner_prefix text;
  v_photo text;
  v_sync_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_context NOT IN ('onboarding', 'profile_studio') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_context');
  END IF;

  PERFORM 1
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  v_owner_prefix := 'photos/' || p_user_id::text || '/';
  v_len := COALESCE(array_length(v_photos, 1), 0);

  IF v_len > 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many_photos');
  END IF;

  FOREACH v_photo IN ARRAY v_photos LOOP
    IF v_photo IS NULL OR length(trim(v_photo)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_path');
    END IF;
    IF strpos(v_photo, '..') > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_path');
    END IF;
    IF NOT v_photo LIKE v_owner_prefix || '%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_path');
    END IF;
  END LOOP;

  IF v_len > 0 AND (
    SELECT COUNT(DISTINCT u) FROM unnest(v_photos) AS u
  ) <> v_len THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_paths');
  END IF;

  v_avatar := CASE WHEN v_len > 0 THEN v_photos[1] ELSE NULL END;

  v_sync_result := public.sync_profile_photo_media(p_user_id, v_photos, v_avatar);
  IF COALESCE((v_sync_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN COALESCE(v_sync_result, jsonb_build_object('success', false, 'error', 'photo_media_sync_failed'));
  END IF;

  UPDATE public.profiles
  SET photos = v_photos,
      avatar_url = v_avatar
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'photos_count', v_len,
    'avatar_url', v_avatar,
    'sessions_published', 0,
    'sessions_orphaned', 0,
    'media_sync', v_sync_result,
    'context', p_context
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_photo_set(uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_photo_set(uuid, text[], text) TO authenticated, service_role;
COMMENT ON FUNCTION public.publish_photo_set(uuid, text[], text) IS
  'Publishes profile photos through media_assets/media_references. draft_media_sessions counters are deprecated compatibility fields.';

CREATE OR REPLACE FUNCTION public.mark_photo_deleted(
  p_user_id uuid,
  p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset_id uuid;
  v_soft_delete_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_storage_path IS NULL
    OR length(trim(p_storage_path)) = 0
    OR strpos(p_storage_path, '..') > 0
    OR NOT (p_storage_path LIKE ('photos/' || p_user_id::text || '/%'))
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_path');
  END IF;

  v_asset_id := public.ensure_profile_photo_asset(
    p_user_id,
    p_storage_path,
    'profiles',
    format('%s:deleted:%s', p_user_id::text, p_storage_path),
    'uploading'
  );
  v_soft_delete_result := public.mark_media_asset_soft_deleted_if_unreferenced(v_asset_id);

  RETURN jsonb_build_object(
    'success', true,
    'sessions_marked', 0,
    'asset_soft_delete', v_soft_delete_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_photo_deleted(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_photo_deleted(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mark_photo_deleted(uuid, text) IS
  'Soft-deletes unreferenced profile-photo media assets. draft_media_sessions mutation is deprecated.';

CREATE OR REPLACE FUNCTION public.mark_photo_drafts_deleted(
  p_paths text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prefix text;
  v_p text;
  v_asset_id uuid;
  v_soft_deleted int := 0;
  v_soft_delete_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  v_prefix := 'photos/' || v_uid::text || '/';

  IF p_paths IS NULL OR COALESCE(array_length(p_paths, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', true, 'sessions_marked', 0, 'assets_soft_deleted', 0);
  END IF;

  FOREACH v_p IN ARRAY p_paths LOOP
    IF v_p IS NULL OR length(trim(v_p)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_path');
    END IF;
    IF strpos(v_p, '..') > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_path');
    END IF;
    IF NOT v_p LIKE v_prefix || '%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden_path');
    END IF;
  END LOOP;

  FOREACH v_p IN ARRAY p_paths LOOP
    v_asset_id := public.ensure_profile_photo_asset(
      v_uid,
      v_p,
      'profiles',
      format('%s:draft:%s', v_uid::text, v_p),
      'uploading'
    );
    v_soft_delete_result := public.mark_media_asset_soft_deleted_if_unreferenced(v_asset_id);
    IF COALESCE((v_soft_delete_result->>'asset_transitioned')::boolean, false) THEN
      v_soft_deleted := v_soft_deleted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sessions_marked', 0,
    'assets_soft_deleted', v_soft_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_photo_drafts_deleted(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_photo_drafts_deleted(text[]) TO authenticated;
COMMENT ON FUNCTION public.mark_photo_drafts_deleted(text[]) IS
  'Marks discarded profile-photo paths through media_assets. draft_media_sessions mutation is deprecated.';

COMMENT ON TABLE public.draft_media_sessions IS
  'LEGACY COMPATIBILITY ONLY after Sprint 4. New media uploads use media_upload_receipts, media_assets, media_references, vibe_video_uploads, and profile_vibe_videos.';
COMMENT ON FUNCTION public.create_media_session(uuid, text, text, jsonb, text, text, text) IS
  'LEGACY COMPATIBILITY ONLY. New Vibe Video uploads must not call this RPC.';
COMMENT ON FUNCTION public.update_media_session_status(text, text, text) IS
  'LEGACY COMPATIBILITY ONLY. New Vibe Video status updates use update_vibe_video_upload_status.';
COMMENT ON FUNCTION public.publish_media_session(uuid, text) IS
  'LEGACY COMPATIBILITY ONLY. New Vibe Video uploads are published through profile_vibe_videos/media_assets.';
COMMENT ON FUNCTION public.get_active_media_session(uuid, text) IS
  'LEGACY COMPATIBILITY ONLY. New media state is read from media_assets/profile_vibe_videos.';

NOTIFY pgrst, 'reload schema';

COMMIT;
