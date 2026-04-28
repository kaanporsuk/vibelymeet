-- Durable cleanup for Bunny Stream videos created by create-video-upload
-- before the upload session/profile attachment is fully committed.

CREATE OR REPLACE FUNCTION public.enqueue_vibe_video_orphan_delete(
  p_user_id uuid,
  p_video_id text,
  p_reason text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_video_id text := lower(btrim(COALESCE(p_video_id, '')));
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'vibe_video_orphan_cleanup'), 200);
  v_context jsonb := COALESCE(p_context, '{}'::jsonb);
  v_asset_id uuid;
  v_active_reference_count integer := 0;
  v_enqueue_result jsonb;
  v_enqueue_success boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_id_required');
  END IF;

  IF NOT public.is_valid_bunny_video_uid(v_video_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_video_id');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('vibe_video_orphan_delete'), hashtext(v_video_id));

  v_asset_id := public.ensure_vibe_video_asset(
    p_user_id,
    v_video_id,
    'create-video-upload',
    COALESCE(NULLIF(v_context->>'failure_path', ''), v_reason),
    'uploading'
  );

  SELECT count(*) INTO v_active_reference_count
  FROM public.media_references
  WHERE asset_id = v_asset_id
    AND is_active = true;

  IF v_active_reference_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'active_reference_exists',
      'asset_id', v_asset_id,
      'video_id', v_video_id
    );
  END IF;

  UPDATE public.media_assets
  SET status = 'purge_ready',
      deleted_at = COALESCE(deleted_at, now()),
      purge_after = now(),
      last_error = v_reason,
      legacy_table = COALESCE(legacy_table, 'create-video-upload'),
      legacy_id = COALESCE(legacy_id, COALESCE(NULLIF(v_context->>'failure_path', ''), v_reason))
  WHERE id = v_asset_id;

  v_enqueue_result := public.enqueue_media_delete(v_asset_id, 'orphan_sweep');
  v_enqueue_success := COALESCE((v_enqueue_result->>'success')::boolean, false);

  RETURN jsonb_build_object(
    'success', v_enqueue_success,
    'skipped', false,
    'asset_id', v_asset_id,
    'video_id', v_video_id,
    'enqueue', v_enqueue_result
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_vibe_video_orphan_delete(uuid, text, text, jsonb) IS
  'Service-role helper for Bunny Stream Vibe Video GUIDs created by create-video-upload but not successfully attached to a profile/session. It marks unreferenced assets purge-ready and enqueues media_delete_jobs orphan_sweep work.';

REVOKE ALL ON FUNCTION public.enqueue_vibe_video_orphan_delete(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_vibe_video_orphan_delete(uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_vibe_video_orphan_delete(uuid, text, text, jsonb) TO service_role;
