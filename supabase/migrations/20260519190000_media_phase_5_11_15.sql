-- Phase 5.11-5.15 closure: voice capture/caller cutover support plus
-- uploaded-orphan cleanup. Client flag rows intentionally stay disabled here;
-- production ramp remains an operator action after manual QA/SLO review.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_ma_uploaded_orphan_candidates
  ON public.media_assets (media_family, created_at)
  WHERE status = 'uploaded';

CREATE OR REPLACE FUNCTION public.enqueue_uploaded_media_orphan_deletes(
  p_limit integer DEFAULT 100,
  p_family_filter text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit integer := COALESCE(p_limit, 100);
  v_asset record;
  v_count integer := 0;
  v_threshold interval;
BEGIN
  IF v_limit < 1 OR v_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  FOR v_asset IN
    SELECT a.id, a.media_family
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'uploaded'
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
      AND a.media_family IN ('chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail', 'profile_photo', 'event_cover')
      AND NOT EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.media_delete_jobs j
        WHERE j.asset_id = a.id
          AND j.status IN ('pending', 'claimed', 'failed')
      )
      AND a.created_at <= now() - CASE
        WHEN a.media_family IN ('chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail') THEN interval '24 hours'
        ELSE interval '7 days'
      END
    ORDER BY a.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_threshold := CASE
      WHEN v_asset.media_family IN ('chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail') THEN interval '24 hours'
      ELSE interval '7 days'
    END;

    UPDATE public.media_assets
    SET status = 'purge_ready',
        deleted_at = COALESCE(deleted_at, now()),
        purge_after = now(),
        last_error = NULL,
        legacy_table = COALESCE(legacy_table, 'media_upload_receipts'),
        legacy_id = COALESCE(legacy_id, format('uploaded_orphan:%s:%s', v_asset.media_family, v_threshold::text))
    WHERE id = v_asset.id
      AND status = 'uploaded';

    IF FOUND THEN
      PERFORM public.enqueue_media_delete(v_asset.id, 'orphan_sweep');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_uploaded_media_orphan_deletes(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_uploaded_media_orphan_deletes(integer, text)
  TO service_role;

COMMENT ON FUNCTION public.enqueue_uploaded_media_orphan_deletes(integer, text) IS
  'Service-role lifecycle worker helper for Phase 5 uploaded-but-unattached assets. Chat media is orphan-swept after 24h; profile/event draft storage assets after 7d.';

CREATE OR REPLACE FUNCTION public.attach_media_reference(
  p_asset_id uuid,
  p_ref_type text,
  p_ref_table text,
  p_ref_id text,
  p_ref_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset public.media_assets%ROWTYPE;
  v_reference_id uuid;
  v_created boolean;
BEGIN
  IF p_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_id_required');
  END IF;

  IF btrim(COALESCE(p_ref_type, '')) = ''
    OR btrim(COALESCE(p_ref_table, '')) = ''
    OR btrim(COALESCE(p_ref_id, '')) = ''
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'reference_required');
  END IF;

  SELECT *
  INTO v_asset
  FROM public.media_assets
  WHERE id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_not_found');
  END IF;

  IF v_asset.status IN ('purging', 'purged') THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_not_attachable');
  END IF;

  INSERT INTO public.media_references (
    asset_id,
    ref_type,
    ref_table,
    ref_id,
    ref_key,
    is_active,
    released_at,
    released_by
  )
  VALUES (
    p_asset_id,
    p_ref_type,
    p_ref_table,
    p_ref_id,
    NULLIF(p_ref_key, ''),
    true,
    NULL,
    NULL
  )
  ON CONFLICT (asset_id, ref_type, ref_table, ref_id, (COALESCE(ref_key, '')))
  WHERE is_active = true
  DO UPDATE
    SET is_active = true,
        released_at = NULL,
        released_by = NULL
  RETURNING id, (xmax = 0) INTO v_reference_id, v_created;

  UPDATE public.media_assets
  SET status = 'active',
      deleted_at = NULL,
      purge_after = NULL,
      purged_at = NULL,
      last_error = NULL
  WHERE id = p_asset_id
    AND status IS DISTINCT FROM 'active';

  DELETE FROM public.media_delete_jobs
  WHERE asset_id = p_asset_id
    AND job_type = 'orphan_sweep'
    AND status IN ('pending', 'failed');

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'reference_id', v_reference_id,
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_media_reference(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_media_reference(uuid, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.attach_chat_media_asset_to_match(
  p_match_id uuid,
  p_asset_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state record;
  v_attach_result jsonb;
  v_refs_created integer := 0;
  v_refs_reactivated integer := 0;
BEGIN
  IF p_match_id IS NULL OR p_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_id_and_asset_id_required');
  END IF;

  PERFORM public.ensure_chat_media_retention_states_for_match(p_match_id);

  FOR v_state IN
    SELECT id, participant_user_key, retention_state
    FROM public.chat_media_retention_states
    WHERE match_id = p_match_id
    ORDER BY participant_user_key ASC
  LOOP
    IF v_state.retention_state <> 'retain' THEN
      CONTINUE;
    END IF;

    v_attach_result := public.attach_media_reference(
      p_asset_id,
      'chat_participant_retention',
      'chat_media_retention_states',
      v_state.id::text,
      v_state.participant_user_key
    );

    IF COALESCE((v_attach_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'chat_media_reference_attach_failed:%',
        COALESCE(v_attach_result->>'error', 'unknown');
    END IF;

    IF COALESCE((v_attach_result->>'created')::boolean, false) THEN
      v_refs_created := v_refs_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'refs_created', v_refs_created,
    'refs_reactivated', v_refs_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_chat_media_asset_to_match(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_chat_media_asset_to_match(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.attach_chat_media_asset_to_match(uuid, uuid) IS
  'Attaches chat media retention refs through attach_media_reference and raises on attach failure so send-message rollback cannot be bypassed.';

CREATE OR REPLACE FUNCTION public.claim_media_delete_jobs(
  p_worker_id text,
  p_batch_size integer DEFAULT 10,
  p_family_filter text DEFAULT NULL
)
RETURNS SETOF public.media_delete_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT j.id, j.asset_id
    FROM public.media_delete_jobs j
    JOIN public.media_assets a ON a.id = j.asset_id
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE j.status IN ('pending', 'failed')
      AND j.next_attempt_at <= now()
      AND j.attempts < j.max_attempts
      AND a.status <> 'purged'
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
      AND (
        j.job_type IN ('admin_purge', 'account_delete')
        OR NOT EXISTS (
          SELECT 1
          FROM public.media_references r
          WHERE r.asset_id = a.id
            AND r.is_active = true
        )
      )
    ORDER BY j.next_attempt_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF j, a SKIP LOCKED
  ),
  marked_assets AS (
    UPDATE public.media_assets a
    SET status = 'purging',
        last_error = NULL
    FROM claimable
    WHERE a.id = claimable.asset_id
      AND a.status <> 'purged'
    RETURNING a.id
  ),
  claimed_jobs AS (
    UPDATE public.media_delete_jobs
    SET status = 'claimed',
        started_at = now(),
        worker_id = p_worker_id
    FROM claimable
    JOIN marked_assets ON marked_assets.id = claimable.asset_id
    WHERE media_delete_jobs.id = claimable.id
    RETURNING media_delete_jobs.*
  )
  SELECT *
  FROM claimed_jobs;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_delete_jobs(text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_delete_jobs(text, integer, text)
  TO service_role;

COMMENT ON FUNCTION public.claim_media_delete_jobs(text, integer, text) IS
  'Claims due media delete jobs and atomically marks their assets purging, closing the late-reference race before provider deletion.';

CREATE OR REPLACE FUNCTION public.complete_media_delete_job(
  p_job_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job public.media_delete_jobs%ROWTYPE;
  v_status text;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_job
  FROM public.media_delete_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'job_not_found');
  END IF;

  IF p_success THEN
    v_status := 'completed';
  ELSE
    v_next := now() + (power(5, LEAST(v_job.attempts, 4)) || ' minutes')::interval;
    IF v_job.attempts + 1 >= v_job.max_attempts THEN
      v_status := 'abandoned';
    ELSE
      v_status := 'failed';
    END IF;
  END IF;

  UPDATE public.media_delete_jobs
  SET status = v_status,
      attempts = attempts + 1,
      completed_at = CASE WHEN v_status IN ('completed', 'abandoned') THEN now() ELSE NULL END,
      next_attempt_at = COALESCE(v_next, next_attempt_at),
      last_error = COALESCE(p_error, last_error)
  WHERE id = p_job_id;

  IF v_status = 'completed' THEN
    UPDATE public.media_assets
    SET status = 'purged',
        purged_at = now()
    WHERE id = v_job.asset_id;
  ELSIF v_status = 'abandoned' THEN
    UPDATE public.media_assets
    SET status = 'failed',
        last_error = p_error
    WHERE id = v_job.asset_id;
  ELSE
    UPDATE public.media_assets
    SET status = 'purge_ready',
        last_error = p_error
    WHERE id = v_job.asset_id
      AND status = 'purging';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'job_status', v_status,
    'attempts', v_job.attempts + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_media_delete_job(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_delete_job(uuid, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public.complete_media_delete_job(uuid, boolean, text) IS
  'Completes a claimed provider-delete job and restores purge_ready on retryable provider failures.';

UPDATE public.client_feature_flags
SET description = CASE flag_key
  WHEN 'media_v2_photo' THEN 'Routes photo uploads through the media SDK when enabled. Phase 5 rollout order: 10% -> 50% -> 100% after manual QA and SLO review.'
  WHEN 'media_v2_voice' THEN 'Routes voice uploads through the media SDK when enabled. Phase 5 rollout order: 10% -> 50% -> 100% after manual QA and SLO review.'
  ELSE description
END,
updated_at = now()
WHERE flag_key IN ('media_v2_photo', 'media_v2_voice');

COMMIT;
