-- Phase 5 bulletproof closure:
-- - owner-scoped receipt reconciliation RPC for storage SDK queues
-- - coordinated receipt/session/asset completion RPCs
-- - receipt failure counters/backoff
-- - read-only lifecycle worker preview + row-returning uploaded-orphan enqueue helper

BEGIN;

ALTER TABLE public.media_upload_receipts
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mur_retry_visibility
  ON public.media_upload_receipts (owner_user_id, media_family, status, next_retry_at)
  WHERE status = 'failed';

CREATE OR REPLACE FUNCTION public.get_media_upload_receipt_status(
  p_media_family text,
  p_scope_key text,
  p_client_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_receipt public.media_upload_receipts%ROWTYPE;
  v_asset public.media_assets%ROWTYPE;
  v_alt_scope_key text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF btrim(COALESCE(p_media_family, '')) = ''
    OR btrim(COALESCE(p_client_request_id, '')) = ''
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.media_upload_receipts
  WHERE owner_user_id = v_uid
    AND media_family = p_media_family
    AND scope_key = COALESCE(p_scope_key, '')
    AND client_request_id = btrim(p_client_request_id)
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Compatibility for Phase 5 pre-closure profile SDK queue rows that used
    -- profile:{context} or profile:self while receipts were already scoped as
    -- profile:{user_id}:{context}. Auth-owned lookup keeps this safe.
    IF p_media_family = 'profile_photo' THEN
      v_alt_scope_key := CASE
        WHEN p_scope_key = 'profile:onboarding'
          THEN format('profile:%s:onboarding', v_uid)
        WHEN p_scope_key = 'profile:profile_studio' OR p_scope_key = 'profile:self'
          THEN format('profile:%s:profile_studio', v_uid)
        WHEN p_scope_key LIKE 'profile:%'
          AND array_length(string_to_array(p_scope_key, ':'), 1) = 2
          THEN format('profile:%s:%s', v_uid, split_part(p_scope_key, ':', 2))
        ELSE NULL
      END;

      IF v_alt_scope_key IS NOT NULL THEN
        SELECT *
        INTO v_receipt
        FROM public.media_upload_receipts
        WHERE owner_user_id = v_uid
          AND media_family = p_media_family
          AND scope_key = v_alt_scope_key
          AND client_request_id = btrim(p_client_request_id)
        ORDER BY updated_at DESC, id DESC
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'status', 'missing');
  END IF;

  IF v_receipt.asset_id IS NOT NULL THEN
    SELECT *
    INTO v_asset
    FROM public.media_assets
    WHERE id = v_receipt.asset_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'status', v_receipt.status,
    'asset_id', v_receipt.asset_id,
    'asset_status', CASE WHEN v_receipt.asset_id IS NULL THEN NULL ELSE v_asset.status END,
    'provider', v_receipt.provider,
    'provider_path', v_receipt.provider_path,
    'provider_object_id', v_receipt.provider_object_id,
    'content_sha256', v_receipt.content_sha256,
    'metadata', v_receipt.metadata,
    'last_error', v_receipt.last_error,
    'attempt_count', v_receipt.attempt_count,
    'last_failed_at', v_receipt.last_failed_at,
    'next_retry_at', v_receipt.next_retry_at,
    'created_at', v_receipt.created_at,
    'updated_at', v_receipt.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_media_upload_receipt_status(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_media_upload_receipt_status(text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_media_upload_receipt_status(text, text, text) IS
  'Owner-scoped storage media upload receipt lookup for Phase 5 SDK reconciliation. Direct receipt table access remains service-role only.';

CREATE OR REPLACE FUNCTION public.mark_media_upload_receipt_failed(
  p_receipt_id uuid,
  p_owner_user_id uuid,
  p_last_error text,
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
  v_error text := left(COALESCE(NULLIF(btrim(p_last_error), ''), 'upload_failed'), 1000);
  v_next timestamptz;
BEGIN
  IF p_receipt_id IS NULL OR p_owner_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'receipt_and_owner_required');
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.media_upload_receipts
  WHERE id = p_receipt_id
    AND owner_user_id = p_owner_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'receipt_not_found');
  END IF;

  v_from := v_receipt.status;
  v_next := now() + (power(5, LEAST(v_receipt.attempt_count, 4)) || ' minutes')::interval;

  UPDATE public.media_upload_receipts
  SET status = 'failed',
      last_error = v_error,
      attempt_count = attempt_count + 1,
      last_failed_at = now(),
      next_retry_at = v_next,
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
  WHERE id = v_receipt.id
  RETURNING * INTO v_receipt;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'status_from', v_from,
    'status_to', v_receipt.status,
    'attempt_count', v_receipt.attempt_count,
    'next_retry_at', v_receipt.next_retry_at,
    'last_error', v_receipt.last_error
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_media_upload_receipt_failed(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_media_upload_receipt_failed(uuid, uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_storage_media_upload(
  p_receipt_id uuid,
  p_owner_user_id uuid,
  p_media_family text,
  p_provider text,
  p_provider_path text DEFAULT NULL,
  p_provider_object_id text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_bytes bigint DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_legacy_table text DEFAULT NULL,
  p_legacy_id text DEFAULT NULL,
  p_receipt_status text DEFAULT 'uploaded',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reference_id uuid DEFAULT NULL,
  p_last_error text DEFAULT NULL
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
  v_status text := COALESCE(NULLIF(btrim(p_receipt_status), ''), 'uploaded');
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_receipt_id IS NULL OR p_owner_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'receipt_and_owner_required');
  END IF;

  IF v_status NOT IN ('uploaded', 'attached') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_receipt_status');
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.media_upload_receipts
  WHERE id = p_receipt_id
    AND owner_user_id = p_owner_user_id
    AND media_family = p_media_family
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
    p_media_family,
    p_owner_user_id,
    p_provider_object_id,
    p_provider_path,
    p_mime_type,
    p_bytes,
    p_content_sha256,
    CASE WHEN v_status = 'attached' THEN 'active' ELSE 'uploaded' END,
    p_legacy_table,
    p_legacy_id
  );

  IF COALESCE((v_asset_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_asset_result->>'error', 'asset_upsert_failed'),
      'code', v_asset_result->>'code'
    );
  END IF;

  v_asset_id := (v_asset_result->>'asset_id')::uuid;
  IF p_reference_id IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reference_id', p_reference_id);
  END IF;

  UPDATE public.media_upload_receipts
  SET status = v_status,
      asset_id = v_asset_id,
      provider_path = COALESCE(provider_path, p_provider_path),
      provider_object_id = COALESCE(provider_object_id, p_provider_object_id),
      metadata = metadata || v_metadata,
      last_error = p_last_error,
      next_retry_at = NULL
  WHERE id = v_receipt.id
  RETURNING * INTO v_receipt;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'asset_id', v_asset_id,
    'status_from', v_from,
    'status_to', v_receipt.status,
    'provider_path', v_receipt.provider_path,
    'provider_object_id', v_receipt.provider_object_id,
    'content_sha256', v_receipt.content_sha256,
    'metadata', v_receipt.metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_storage_media_upload(uuid, uuid, text, text, text, text, text, bigint, text, text, text, text, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_storage_media_upload(uuid, uuid, text, text, text, text, text, bigint, text, text, text, text, jsonb, uuid, text)
  TO service_role;

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
  v_context text := CASE WHEN p_context = 'onboarding' THEN 'onboarding' ELSE 'profile_studio' END;
  v_session_id uuid;
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
    NULL,
    NULL
  );

  IF COALESCE((v_asset_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_asset_result->>'error', 'asset_upsert_failed'),
      'code', v_asset_result->>'code'
    );
  END IF;

  v_asset_id := (v_asset_result->>'asset_id')::uuid;

  SELECT id
  INTO v_session_id
  FROM public.draft_media_sessions
  WHERE user_id = p_owner_user_id
    AND media_type = 'photo'
    AND provider_id = p_provider_path
    AND storage_path = p_provider_path
    AND context = v_context
    AND status IN ('created', 'ready')
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.draft_media_sessions
    SET status = 'ready',
        provider_meta = provider_meta || v_metadata,
        storage_path = p_provider_path,
        error_detail = NULL
    WHERE id = v_session_id;
  ELSE
    INSERT INTO public.draft_media_sessions (
      user_id,
      media_type,
      status,
      provider_id,
      provider_meta,
      context,
      storage_path
    )
    VALUES (
      p_owner_user_id,
      'photo',
      'ready',
      p_provider_path,
      v_metadata,
      v_context,
      p_provider_path
    )
    RETURNING id INTO v_session_id;
  END IF;

  UPDATE public.media_assets
  SET legacy_table = 'draft_media_sessions',
      legacy_id = v_session_id::text
  WHERE id = v_asset_id;

  v_metadata := v_metadata || jsonb_build_object('session_id', v_session_id);

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
    'session_id', v_session_id,
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

CREATE OR REPLACE FUNCTION public.enqueue_uploaded_media_orphan_delete_rows(
  p_limit integer DEFAULT 100,
  p_family_filter text DEFAULT NULL
)
RETURNS TABLE (
  asset_id uuid,
  media_family text,
  provider text,
  provider_path text,
  provider_object_id text,
  job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit integer := COALESCE(p_limit, 100);
  v_asset record;
  v_enqueue jsonb;
BEGIN
  IF v_limit < 1 OR v_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  FOR v_asset IN
    SELECT a.id, a.media_family, a.provider, a.provider_path, a.provider_object_id
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'uploaded'
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
      AND a.media_family IN ('chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail', 'profile_photo', 'event_cover')
      AND NOT EXISTS (
        SELECT 1 FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.media_delete_jobs j
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
    UPDATE public.media_assets
    SET status = 'purge_ready',
        deleted_at = COALESCE(deleted_at, now()),
        purge_after = now(),
        last_error = NULL,
        legacy_table = COALESCE(legacy_table, 'media_upload_receipts'),
        legacy_id = COALESCE(legacy_id, format('uploaded_orphan:%s', v_asset.media_family))
    WHERE id = v_asset.id
      AND status = 'uploaded';

    IF FOUND THEN
      v_enqueue := public.enqueue_media_delete(v_asset.id, 'orphan_sweep');
      asset_id := v_asset.id;
      media_family := v_asset.media_family;
      provider := v_asset.provider;
      provider_path := v_asset.provider_path;
      provider_object_id := v_asset.provider_object_id;
      job_id := NULLIF(v_enqueue->>'job_id', '')::uuid;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_uploaded_media_orphan_delete_rows(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_uploaded_media_orphan_delete_rows(integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_uploaded_media_orphan_deletes(
  p_limit integer DEFAULT 100,
  p_family_filter text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::integer
  FROM public.enqueue_uploaded_media_orphan_delete_rows(p_limit, p_family_filter);
$$;

REVOKE ALL ON FUNCTION public.enqueue_uploaded_media_orphan_deletes(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_uploaded_media_orphan_deletes(integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.preview_media_delete_worker_run(
  p_limit integer DEFAULT 20,
  p_family_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_queue jsonb;
  v_promotable jsonb;
  v_uploaded_orphans jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  INTO v_queue
  FROM (
    SELECT
      j.id,
      j.asset_id,
      a.media_family,
      j.provider,
      j.job_type,
      j.provider_path,
      j.provider_object_id,
      j.status,
      j.attempts,
      j.max_attempts,
      j.next_attempt_at
    FROM public.media_delete_jobs j
    JOIN public.media_assets a ON a.id = j.asset_id
    WHERE j.status IN ('pending', 'failed')
      AND j.next_attempt_at <= now()
      AND j.attempts < j.max_attempts
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
    ORDER BY j.next_attempt_at ASC, j.created_at ASC
    LIMIT v_limit
  ) row_data;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  INTO v_promotable
  FROM (
    SELECT
      a.id AS asset_id,
      a.media_family,
      a.provider,
      a.provider_path,
      a.provider_object_id,
      a.purge_after
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'soft_deleted'
      AND a.purge_after IS NOT NULL
      AND a.purge_after <= now()
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
      AND NOT EXISTS (
        SELECT 1 FROM public.media_references r
        WHERE r.asset_id = a.id AND r.is_active = true
      )
    ORDER BY a.purge_after ASC, a.created_at ASC
    LIMIT v_limit * 2
  ) row_data;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  INTO v_uploaded_orphans
  FROM (
    SELECT
      a.id AS asset_id,
      a.media_family,
      a.provider,
      a.provider_path,
      a.provider_object_id,
      a.created_at
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'uploaded'
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
      AND a.media_family IN ('chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail', 'profile_photo', 'event_cover')
      AND NOT EXISTS (
        SELECT 1 FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.media_delete_jobs j
        WHERE j.asset_id = a.id
          AND j.status IN ('pending', 'claimed', 'failed')
      )
      AND a.created_at <= now() - CASE
        WHEN a.media_family IN ('chat_image', 'voice_message', 'chat_video', 'chat_video_thumbnail') THEN interval '24 hours'
        ELSE interval '7 days'
      END
    ORDER BY a.created_at ASC
    LIMIT v_limit * 2
  ) row_data;

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', true,
    'limit', v_limit,
    'family_filter', p_family_filter,
    'queued_jobs', v_queue,
    'promotable_assets', v_promotable,
    'uploaded_orphan_candidates', v_uploaded_orphans,
    'preview_count',
      jsonb_array_length(v_queue)
      + jsonb_array_length(v_promotable)
      + jsonb_array_length(v_uploaded_orphans),
    'message', 'Read-only preview; zero mutations performed.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_media_delete_worker_run(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_media_delete_worker_run(integer, text)
  TO service_role;

-- Baseline invariant for Phase 5 storage families. This preserves
-- verification_selfie as the intentionally disabled family.
INSERT INTO public.media_retention_settings (media_family, retention_mode, retention_days, eligible_days, worker_enabled)
VALUES
  ('chat_image', 'retain_until_eligible', NULL, 1, true),
  ('voice_message', 'retain_until_eligible', NULL, 1, true),
  ('chat_video', 'retain_until_eligible', NULL, 1, true),
  ('chat_video_thumbnail', 'retain_until_eligible', NULL, 1, true),
  ('profile_photo', 'soft_delete', 30, NULL, true),
  ('event_cover', 'soft_delete', 90, NULL, true)
ON CONFLICT (media_family) DO UPDATE
SET worker_enabled = true
WHERE public.media_retention_settings.media_family IN (
  'chat_image',
  'voice_message',
  'chat_video',
  'chat_video_thumbnail',
  'profile_photo',
  'event_cover'
);

COMMIT;
