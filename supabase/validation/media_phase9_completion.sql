-- Read-only Phase 9 cloud validation.
--
-- Run against a linked Supabase project after migrations are applied:
--   supabase db query --linked -f supabase/validation/media_phase9_completion.sql

DO $$
DECLARE
  v_missing_columns text[];
  v_missing_constraints text[];
  v_missing_functions text[];
  v_missing_tables text[];
  v_has_cron boolean;
  v_has_vault_secrets boolean;
  v_cron_missing boolean;
BEGIN
  SELECT array_agg(required.table_name || '.' || required.column_name ORDER BY required.table_name, required.column_name)
  INTO v_missing_columns
  FROM (
    VALUES
      ('chat_vibe_clip_uploads', 'encrypted_media'),
      ('vibe_video_uploads', 'captions'),
      ('profile_vibe_videos', 'captions'),
      ('profiles', 'vibe_video_captions'),
      ('profiles', 'encryption_pub_key'),
      ('matches', 'encrypted_conversation_keys'),
      ('media_assets', 'storage_zone'),
      ('media_assets', 'last_accessed_at'),
      ('media_assets', 'archived_at'),
      ('media_assets', 'archive_error'),
      ('media_assets', 'encryption_metadata')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );

  IF COALESCE(array_length(v_missing_columns, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 9 required columns missing: %', v_missing_columns;
  END IF;

  SELECT array_agg(required.constraint_name ORDER BY required.constraint_name)
  INTO v_missing_constraints
  FROM (
    VALUES
      ('chat_vibe_clip_uploads_captions_valid'),
      ('vibe_video_uploads_captions_valid'),
      ('profile_vibe_videos_captions_valid'),
      ('profiles_vibe_video_captions_valid'),
      ('profiles_encryption_pub_key_format'),
      ('media_assets_storage_zone_check')
  ) AS required(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = required.constraint_name
  );

  IF COALESCE(array_length(v_missing_constraints, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 9 required constraints missing: %', v_missing_constraints;
  END IF;

  SELECT array_agg(required.function_name ORDER BY required.function_name)
  INTO v_missing_functions
  FROM (
    VALUES
      ('media_captions_jsonb_valid'),
      ('mark_media_asset_accessed'),
      ('get_profile_for_viewer'),
      ('get_my_profile_settings')
  ) AS required(function_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = required.function_name
  );

  IF COALESCE(array_length(v_missing_functions, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 9 required functions missing: %', v_missing_functions;
  END IF;

  IF public.media_captions_jsonb_valid('"hello"'::jsonb) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Phase 9 caption validator rejected valid string captions';
  END IF;

  IF public.media_captions_jsonb_valid('{"text":"hello","language":"en-US"}'::jsonb) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Phase 9 caption validator rejected valid object captions';
  END IF;

  IF public.media_captions_jsonb_valid('{"cues":[{"startMs":0,"endMs":900,"text":"hi"}]}'::jsonb) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Phase 9 caption validator rejected valid cue captions';
  END IF;

  IF public.media_captions_jsonb_valid('{"text":"","language":"en-US"}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Phase 9 caption validator accepted empty text captions';
  END IF;

  IF public.media_captions_jsonb_valid('{"text":"hello","language":"not a language tag"}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Phase 9 caption validator accepted invalid language captions';
  END IF;

  IF public.media_captions_jsonb_valid('{"cues":[{"startMs":1000,"endMs":900,"text":"bad"}]}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Phase 9 caption validator accepted invalid cue timing';
  END IF;

  IF has_function_privilege('anon', 'public.get_profile_for_viewer(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 9 get_profile_for_viewer must not be executable by anon';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_profile_for_viewer(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 9 get_profile_for_viewer must be executable by authenticated';
  END IF;

  IF has_function_privilege('anon', 'public.mark_media_asset_accessed(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_media_asset_accessed(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 9 mark_media_asset_accessed must stay service-role only';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.mark_media_asset_accessed(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 9 mark_media_asset_accessed must be executable by service_role';
  END IF;

  SELECT array_agg(required.table_name ORDER BY required.table_name)
  INTO v_missing_tables
  FROM (VALUES ('bunny_cdn_health_state')) AS required(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_name = required.table_name
  );

  IF COALESCE(array_length(v_missing_tables, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Phase 9 required tables missing: %', v_missing_tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'bunny_cdn_health_state'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Phase 9 bunny_cdn_health_state must have RLS enabled';
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
  INTO v_has_cron;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    v_has_vault_secrets := false;
  ELSE
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url'
      )
      AND EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret'
      )
    $sql$
    INTO v_has_vault_secrets;
  END IF;

  IF v_has_cron AND v_has_vault_secrets THEN
    IF to_regclass('cron.job') IS NULL THEN
      RAISE EXCEPTION 'Phase 9 pg_cron extension is present but cron.job is unavailable';
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'bunny-cdn-health-minutely'
    )
    INTO v_cron_missing;

    IF v_cron_missing THEN
      RAISE EXCEPTION 'Phase 9 Bunny CDN health cron is missing despite pg_cron and Vault secrets being present';
    END IF;
  END IF;
END $$;

SELECT 'media_phase9_completion_ok' AS status;
