-- Phase 2B: Photo draft asset/session tracking RPCs
-- Builds on draft_media_sessions from Phase 2A to track individual photo
-- uploads and provide publish/orphan-reconciliation semantics.

-- ─── RPC: publish_photo_set ──────────────────────────────────────────────────
-- Called by Profile Studio save and finalize_onboarding to atomically:
-- 1. Update profiles.photos and profiles.avatar_url
-- 2. Mark matching photo sessions as published
-- 3. Mark photo sessions whose storage_path is no longer in the set as abandoned
--
-- This is the single canonical path for committing a photo set to a profile.

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
BEGIN
  -- Auth: callable by authenticated user for own profile, or service_role
  IF auth.role() != 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_context NOT IN ('onboarding', 'profile_studio') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_context');
  END IF;

  -- Derive avatar from first photo
  v_avatar := CASE WHEN array_length(v_photos, 1) > 0 THEN v_photos[1] ELSE NULL END;

  -- Update profile
  UPDATE public.profiles
  SET photos     = v_photos,
      avatar_url = v_avatar
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  -- Mark sessions whose storage_path is in the published set
  UPDATE public.draft_media_sessions
  SET status       = 'published',
      published_at = now()
  WHERE user_id    = p_user_id
    AND media_type = 'photo'
    AND status IN ('created', 'ready')
    AND storage_path = ANY(v_photos);
  GET DIAGNOSTICS v_published = ROW_COUNT;

  -- Mark photo sessions whose path is NOT in the new set as abandoned
  -- (only sessions that were previously published or ready)
  UPDATE public.draft_media_sessions
  SET status = 'abandoned'
  WHERE user_id    = p_user_id
    AND media_type = 'photo'
    AND status IN ('published', 'ready')
    AND (storage_path IS NULL OR NOT (storage_path = ANY(v_photos)));
  GET DIAGNOSTICS v_orphaned = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'photos_count', array_length(v_photos, 1),
    'avatar_url', v_avatar,
    'sessions_published', v_published,
    'sessions_orphaned', v_orphaned,
    'context', p_context
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_photo_set FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_photo_set TO authenticated, service_role;

-- ─── RPC: get_photo_sessions ─────────────────────────────────────────────────
-- Returns all photo sessions for a user that are not deleted or abandoned,
-- for client-side reconciliation and UI state.

CREATE OR REPLACE FUNCTION public.get_photo_sessions(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_sessions jsonb;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'status', status,
    'storage_path', storage_path,
    'context', context,
    'created_at', created_at,
    'published_at', published_at,
    'expires_at', expires_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_sessions
  FROM public.draft_media_sessions
  WHERE user_id    = p_user_id
    AND media_type = 'photo'
    AND status NOT IN ('deleted', 'abandoned')
    AND expires_at > now();

  RETURN jsonb_build_object('success', true, 'sessions', v_sessions);
END;
$$;

REVOKE ALL ON FUNCTION public.get_photo_sessions FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_photo_sessions TO authenticated;

-- ─── RPC: mark_photo_deleted ─────────────────────────────────────────────────
-- Marks a specific photo session as deleted (user explicitly removed the photo).
-- Does NOT delete from Bunny — that's for the cleanup job.

CREATE OR REPLACE FUNCTION public.mark_photo_deleted(
  p_user_id      uuid,
  p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.role() != 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  UPDATE public.draft_media_sessions
  SET status = 'deleted'
  WHERE user_id      = p_user_id
    AND media_type   = 'photo'
    AND storage_path = p_storage_path
    AND status NOT IN ('deleted', 'abandoned');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'sessions_marked', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_photo_deleted FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_photo_deleted TO authenticated, service_role;
