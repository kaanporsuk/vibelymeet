-- Harden publish_photo_set validation; batch-mark ephemeral draft photo sessions deleted.

-- ─── RPC: publish_photo_set (replace with validation) ───────────────────────

CREATE OR REPLACE FUNCTION public.publish_photo_set(
  p_user_id  uuid,
  p_photos   text[],
  p_context  text DEFAULT 'profile_studio'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_photos       text[] := COALESCE(p_photos, ARRAY[]::text[]);
  v_avatar       text;
  v_published    int := 0;
  v_orphaned     int := 0;
  v_len          int;
  v_owner_prefix text;
  v_photo        text;
BEGIN
  IF auth.role() != 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_context NOT IN ('onboarding', 'profile_studio') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_context');
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

  UPDATE public.profiles
  SET photos     = v_photos,
      avatar_url = v_avatar
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  UPDATE public.draft_media_sessions
  SET status       = 'published',
      published_at = now()
  WHERE user_id    = p_user_id
    AND media_type = 'photo'
    AND status IN ('created', 'ready')
    AND storage_path = ANY(v_photos);
  GET DIAGNOSTICS v_published = ROW_COUNT;

  UPDATE public.draft_media_sessions
  SET status = 'abandoned'
  WHERE user_id    = p_user_id
    AND media_type = 'photo'
    AND status IN ('published', 'ready')
    AND (storage_path IS NULL OR NOT (storage_path = ANY(v_photos)));
  GET DIAGNOSTICS v_orphaned = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'photos_count', v_len,
    'avatar_url', v_avatar,
    'sessions_published', v_published,
    'sessions_orphaned', v_orphaned,
    'context', p_context
  );
END;
$$;

-- ─── RPC: mark_photo_drafts_deleted ────────────────────────────────────────────
-- Marks unpublished photo draft sessions as deleted for paths in the caller's
-- namespace (ephemeral uploads discarded before publish).

CREATE OR REPLACE FUNCTION public.mark_photo_drafts_deleted(
  p_paths text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_prefix text;
  v_p      text;
  v_count  int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  v_prefix := 'photos/' || v_uid::text || '/';

  IF p_paths IS NULL OR COALESCE(array_length(p_paths, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', true, 'sessions_marked', 0);
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

  UPDATE public.draft_media_sessions
  SET status = 'deleted'
  WHERE user_id = v_uid
    AND media_type = 'photo'
    AND storage_path = ANY(p_paths)
    AND status NOT IN ('published', 'deleted', 'abandoned');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'sessions_marked', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_photo_drafts_deleted FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_photo_drafts_deleted TO authenticated;
