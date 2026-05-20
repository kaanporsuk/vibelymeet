-- Read-only Phase 5 cloud validation.
-- Run against a linked Supabase project after migrations are applied:
--   supabase db query --linked -f supabase/validation/media_phase5_bulletproof_closure.sql

DO $$
DECLARE
  v_missing_retention text[];
  v_missing_columns text[];
  v_missing_functions text[];
BEGIN
  SELECT array_agg(family ORDER BY family)
  INTO v_missing_retention
  FROM unnest(ARRAY[
    'chat_image',
    'voice_message',
    'chat_video',
    'chat_video_thumbnail',
    'profile_photo',
    'event_cover'
  ]) AS required(family)
  LEFT JOIN public.media_retention_settings s
    ON s.media_family = required.family
  WHERE COALESCE(s.worker_enabled, false) IS DISTINCT FROM true;

  IF COALESCE(array_length(v_missing_retention, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 5 worker_enabled invariant failed for families: %', v_missing_retention;
  END IF;

  SELECT array_agg(column_name ORDER BY column_name)
  INTO v_missing_columns
  FROM unnest(ARRAY['attempt_count', 'last_failed_at', 'next_retry_at']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'media_upload_receipts'
      AND c.column_name = required.column_name
  );

  IF COALESCE(array_length(v_missing_columns, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 5 media_upload_receipts columns missing: %', v_missing_columns;
  END IF;

  SELECT array_agg(function_name ORDER BY function_name)
  INTO v_missing_functions
  FROM unnest(ARRAY[
    'get_media_upload_receipt_status',
    'complete_storage_media_upload',
    'complete_profile_photo_media_upload',
    'mark_media_upload_receipt_failed',
    'enqueue_uploaded_media_orphan_delete_rows',
    'enqueue_uploaded_media_orphan_deletes',
    'preview_media_delete_worker_run'
  ]) AS required(function_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = required.function_name
  );

  IF COALESCE(array_length(v_missing_functions, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 5 required functions missing: %', v_missing_functions;
  END IF;
END $$;

SELECT 'media_phase5_bulletproof_closure_ok' AS status;
