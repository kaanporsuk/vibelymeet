-- Validation for 20260501120000_vibe_video_backend_owned_field_guardrails.sql.
-- Safe to run after the migration on a linked project; it creates and removes one
-- validation user/profile and records assertion rows in temp tables.

BEGIN;

CREATE TEMP TABLE vibe_video_final_hardening_context (
  user_id uuid PRIMARY KEY,
  existing_uid text NOT NULL,
  new_uid text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE vibe_video_final_hardening_results (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
) ON COMMIT DROP;

GRANT SELECT ON vibe_video_final_hardening_context TO authenticated;
GRANT SELECT, INSERT, UPDATE ON vibe_video_final_hardening_results TO authenticated;

INSERT INTO vibe_video_final_hardening_context(user_id, existing_uid, new_uid)
VALUES (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

DO $$
DECLARE
  v_user_id uuid;
  v_existing_uid text;
BEGIN
  SELECT user_id, existing_uid
  INTO v_user_id, v_existing_uid
  FROM vibe_video_final_hardening_context
  LIMIT 1;

  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user_id,
    'vibe-video-final-hardening-' || v_user_id || '@example.test',
    crypt('validation-only', gen_salt('bf')),
    now(),
    now(),
    now()
  );

  PERFORM set_config('vibely.vibe_video_server_update', '1', true);
  INSERT INTO public.profiles (
    id,
    name,
    age,
    gender,
    bunny_video_uid,
    bunny_video_status,
    vibe_video_status,
    vibe_caption
  )
  VALUES (
    v_user_id,
    'Vibe Video Guardrail',
    30,
    'nonbinary',
    v_existing_uid,
    'processing',
    'processing',
    'original caption'
  );

  INSERT INTO public.draft_media_sessions (
    user_id,
    media_type,
    status,
    provider,
    provider_id,
    context
  )
  VALUES
    (v_user_id, 'vibe_video', 'abandoned', 'bunny', v_existing_uid, 'profile_studio'),
    (
      v_user_id,
      'vibe_video',
      'processing',
      'bunny',
      (SELECT new_uid FROM vibe_video_final_hardening_context LIMIT 1),
      'profile_studio'
    );
  PERFORM set_config('vibely.vibe_video_server_update', '', true);
END $$;

SELECT set_config('request.jwt.claim.sub', (SELECT user_id::text FROM vibe_video_final_hardening_context), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_user_id uuid;
  v_new_uid text;
  v_rejected boolean := false;
BEGIN
  SELECT user_id, new_uid
  INTO v_user_id, v_new_uid
  FROM vibe_video_final_hardening_context
  LIMIT 1;

  BEGIN
    UPDATE public.profiles
    SET bunny_video_uid = v_new_uid
    WHERE id = v_user_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_rejected := true;
  END;

  INSERT INTO vibe_video_final_hardening_results(check_name, passed, detail)
  VALUES ('authenticated_user_cannot_write_bunny_video_uid', v_rejected, NULL);
END $$;

UPDATE public.profiles
SET vibe_caption = 'caption still user editable'
WHERE id = (SELECT user_id FROM vibe_video_final_hardening_context);

RESET ROLE;

DO $$
DECLARE
  v_user_id uuid;
  v_existing_uid text;
  v_new_uid text;
  v_caption text;
BEGIN
  SELECT user_id, existing_uid, new_uid
  INTO v_user_id, v_existing_uid, v_new_uid
  FROM vibe_video_final_hardening_context
  LIMIT 1;

  SELECT vibe_caption INTO v_caption FROM public.profiles WHERE id = v_user_id;
  INSERT INTO vibe_video_final_hardening_results(check_name, passed, detail)
  VALUES (
    'authenticated_user_can_update_vibe_caption',
    v_caption = 'caption still user editable',
    v_caption
  );

  PERFORM set_config('vibely.vibe_video_server_update', '1', true);
  UPDATE public.profiles
  SET bunny_video_uid = v_new_uid,
      bunny_video_status = 'ready',
      vibe_video_status = 'ready'
  WHERE id = v_user_id;
  PERFORM set_config('vibely.vibe_video_server_update', '', true);

  INSERT INTO vibe_video_final_hardening_results(check_name, passed, detail)
  SELECT
    'trusted_server_guc_can_write_backend_owned_video_fields',
    bunny_video_uid = v_new_uid
      AND bunny_video_status = 'ready'
      AND vibe_video_status = 'ready',
    bunny_video_uid || ':' || bunny_video_status || ':' || COALESCE(vibe_video_status, '')
  FROM public.profiles
  WHERE id = v_user_id;

  PERFORM public.update_media_session_status(
    v_existing_uid,
    'ready',
    NULL
  );

  INSERT INTO vibe_video_final_hardening_results(check_name, passed, detail)
  SELECT
    'old_webhook_status_cannot_mutate_replaced_profile_uid',
    bunny_video_uid = v_new_uid AND bunny_video_status = 'ready',
    bunny_video_uid || ':' || bunny_video_status
  FROM public.profiles
  WHERE id = v_user_id;

  PERFORM set_config('vibely.vibe_video_server_update', '1', true);
  UPDATE public.profiles
  SET bunny_video_uid = NULL,
      bunny_video_status = 'none',
      vibe_video_status = NULL
  WHERE id = v_user_id;
  PERFORM set_config('vibely.vibe_video_server_update', '', true);

  PERFORM public.update_media_session_status(
    v_new_uid,
    'ready',
    NULL
  );

  INSERT INTO vibe_video_final_hardening_results(check_name, passed, detail)
  SELECT
    'cleared_video_webhook_cannot_resurrect_profile_uid',
    bunny_video_uid IS NULL AND bunny_video_status = 'none',
    COALESCE(bunny_video_uid, 'null') || ':' || COALESCE(bunny_video_status, 'null')
  FROM public.profiles
  WHERE id = v_user_id;

  DELETE FROM public.profiles WHERE id = v_user_id;
  DELETE FROM auth.users WHERE id = v_user_id;
END $$;

SELECT * FROM vibe_video_final_hardening_results ORDER BY check_name;

DO $$
DECLARE
  v_failed text;
BEGIN
  SELECT string_agg(check_name || COALESCE(': ' || detail, ''), E'\n')
  INTO v_failed
  FROM vibe_video_final_hardening_results
  WHERE NOT passed;

  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Vibe Video final hardening validation failed:%', E'\n' || v_failed;
  END IF;
END $$;

ROLLBACK;
