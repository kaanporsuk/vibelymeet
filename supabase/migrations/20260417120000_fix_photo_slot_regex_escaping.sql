-- Fix: sync_profile_photo_media regex double-escaping bug
--
-- Root cause: 'photos\\[(\\d+)\\]' in a standard_conforming_strings=on
-- context produces the regex photos\\[( \\d+)\\] which expects a literal
-- backslash before '[' — never matching 'photos[0]'.  This caused
-- v_slot_index to be NULL → v_expected_path NULL → every profile_photo_slot
-- ref released immediately after creation.
--
-- Fix: single-escape  'photos\[(\d+)\]'  which produces the correct regex.
--
-- This migration also repairs incorrectly released slot refs from the
-- Sprint 2 backfill by re-running sync for affected users.

CREATE OR REPLACE FUNCTION public.sync_profile_photo_media(
  p_user_id uuid,
  p_photos text[],
  p_avatar_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_photos text[] := COALESCE(p_photos, ARRAY[]::text[]);
  v_avatar text := COALESCE(
    NULLIF(trim(COALESCE(p_avatar_path, '')), ''),
    CASE
      WHEN COALESCE(array_length(v_photos, 1), 0) > 0 THEN v_photos[1]
      ELSE NULL
    END
  );
  v_path text;
  v_asset_id uuid;
  v_index integer;
  v_ref record;
  v_slot_index integer;
  v_expected_path text;
  v_refs_created integer := 0;
  v_refs_released integer := 0;
  v_assets_soft_deleted integer := 0;
  v_soft_delete_result jsonb;
BEGIN
  PERFORM 1
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  -- Step 1: Ensure asset + active slot ref for each currently published photo
  FOR v_index IN 1..COALESCE(array_length(v_photos, 1), 0) LOOP
    v_path := NULLIF(trim(COALESCE(v_photos[v_index], '')), '');
    IF v_path IS NULL THEN
      CONTINUE;
    END IF;

    v_asset_id := public.ensure_profile_photo_asset(
      p_user_id,
      v_path,
      'profiles',
      format('%s:photos[%s]', p_user_id::text, v_index - 1),
      'active'
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.media_references
      WHERE asset_id = v_asset_id
        AND ref_type = 'profile_photo_slot'
        AND ref_table = 'profiles'
        AND ref_id = p_user_id::text
        AND ref_key = format('photos[%s]', v_index - 1)
        AND is_active = true
    ) THEN
      INSERT INTO public.media_references (
        asset_id, ref_type, ref_table, ref_id, ref_key, is_active
      ) VALUES (
        v_asset_id, 'profile_photo_slot', 'profiles', p_user_id::text, format('photos[%s]', v_index - 1), true
      );
      v_refs_created := v_refs_created + 1;
    END IF;
  END LOOP;

  -- Step 2: Ensure active avatar ref
  IF v_avatar IS NOT NULL THEN
    v_asset_id := public.ensure_profile_photo_asset(
      p_user_id,
      v_avatar,
      'profiles',
      format('%s:avatar_url', p_user_id::text),
      'active'
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.media_references
      WHERE asset_id = v_asset_id
        AND ref_type = 'profile_avatar'
        AND ref_table = 'profiles'
        AND ref_id = p_user_id::text
        AND ref_key = 'avatar_url'
        AND is_active = true
    ) THEN
      INSERT INTO public.media_references (
        asset_id, ref_type, ref_table, ref_id, ref_key, is_active
      ) VALUES (
        v_asset_id, 'profile_avatar', 'profiles', p_user_id::text, 'avatar_url', true
      );
      v_refs_created := v_refs_created + 1;
    END IF;
  END IF;

  -- Step 3: Release stale refs that no longer match current photo array
  FOR v_ref IN
    SELECT r.id, r.ref_type, r.ref_key, a.provider_path
    FROM public.media_references r
    JOIN public.media_assets a ON a.id = r.asset_id
    WHERE r.ref_table = 'profiles'
      AND r.ref_id = p_user_id::text
      AND r.is_active = true
      AND r.ref_type IN ('profile_photo_slot', 'profile_avatar')
  LOOP
    IF v_ref.ref_type = 'profile_avatar' THEN
      IF v_avatar IS DISTINCT FROM v_ref.provider_path THEN
        PERFORM public.release_media_reference(v_ref.id, 'replace');
        v_refs_released := v_refs_released + 1;
      END IF;
    ELSE
      -- FIX: single-escaped regex so \[ matches literal bracket
      BEGIN
        v_slot_index := NULLIF(substring(v_ref.ref_key FROM 'photos\[(\d+)\]'), '')::integer;
      EXCEPTION WHEN OTHERS THEN
        v_slot_index := NULL;
      END;

      v_expected_path := CASE
        WHEN v_slot_index IS NOT NULL
         AND v_slot_index >= 0
         AND v_slot_index + 1 <= COALESCE(array_length(v_photos, 1), 0)
          THEN v_photos[v_slot_index + 1]
        ELSE NULL
      END;

      IF v_expected_path IS DISTINCT FROM v_ref.provider_path THEN
        PERFORM public.release_media_reference(v_ref.id, 'replace');
        v_refs_released := v_refs_released + 1;
      END IF;
    END IF;
  END LOOP;

  -- Step 4: Soft-delete unreferenced photo assets no longer in published set
  FOR v_ref IN
    SELECT a.id
    FROM public.media_assets a
    WHERE a.owner_user_id = p_user_id
      AND a.provider = 'bunny_storage'
      AND a.media_family = 'profile_photo'
      AND a.status NOT IN ('purged', 'purging')
      AND (a.provider_path IS NULL OR NOT (a.provider_path = ANY(v_photos)))
      AND NOT EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
  LOOP
    v_soft_delete_result := public.mark_media_asset_soft_deleted_if_unreferenced(v_ref.id);
    IF COALESCE((v_soft_delete_result->>'asset_transitioned')::boolean, false) THEN
      v_assets_soft_deleted := v_assets_soft_deleted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'refs_created', v_refs_created,
    'refs_released', v_refs_released,
    'assets_soft_deleted', v_assets_soft_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_photo_media(uuid, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_profile_photo_media(uuid, text[], text) TO service_role;


-- Repair: re-run sync for all users who have published photos.
-- This fixes incorrectly released slot refs from the original buggy backfill.
-- sync_profile_photo_media is idempotent: it will re-create missing active
-- slot refs and leave already-correct state unchanged.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, COALESCE(photos, ARRAY[]::text[]) AS photos, avatar_url
    FROM public.profiles
    WHERE (photos IS NOT NULL AND COALESCE(array_length(photos, 1), 0) > 0)
       OR (avatar_url IS NOT NULL AND length(trim(avatar_url)) > 0)
  LOOP
    PERFORM public.sync_profile_photo_media(r.id, r.photos, r.avatar_url);
  END LOOP;
END;
$$;
