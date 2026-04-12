-- Sprint 2: Media lifecycle wiring for profile media
--
-- Scope:
--   1. Vibe videos — dual-write current profile video into media_assets /
--      media_references with a future-proof profile_vibe_videos table.
--   2. Profile photos — wire publish/remove/discard flows into media lifecycle.
-- Non-goals:
--   - chat media purge logic
--   - account-deletion media rewrite
--   - cron enablement
--   - legal/copy-wide retention rewrite

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profile_vibe_videos
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profile_vibe_videos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id      uuid        NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  video_status  text        NOT NULL DEFAULT 'uploading'
    CHECK (video_status IN ('uploading', 'processing', 'ready', 'failed')),
  display_order integer     NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  is_primary    boolean     NOT NULL DEFAULT false,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz
);

COMMENT ON TABLE public.profile_vibe_videos IS
  'Future-proof mapping of a user profile to one or more vibe-video assets. '
  'Current clients still read profiles.bunny_video_uid / bunny_video_status, but '
  'this table is the canonical per-video history and primary marker.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_vibe_videos_asset
  ON public.profile_vibe_videos (asset_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_vibe_videos_primary
  ON public.profile_vibe_videos (user_id)
  WHERE is_active = true AND is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_vibe_videos_active_order
  ON public.profile_vibe_videos (user_id, display_order)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_profile_vibe_videos_user
  ON public.profile_vibe_videos (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.profile_vibe_videos_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_vibe_videos_updated_at ON public.profile_vibe_videos;
CREATE TRIGGER trg_profile_vibe_videos_updated_at
  BEFORE UPDATE ON public.profile_vibe_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.profile_vibe_videos_set_updated_at();

ALTER TABLE public.profile_vibe_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile vibe videos"
  ON public.profile_vibe_videos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to profile vibe videos"
  ON public.profile_vibe_videos FOR ALL
  USING (auth.role() = 'service_role');


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper functions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.media_compute_purge_after(
  p_media_family text,
  p_deleted_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_policy public.media_retention_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_policy
  FROM public.media_retention_settings
  WHERE media_family = p_media_family;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_policy.retention_mode = 'immediate' THEN
    RETURN p_deleted_at;
  END IF;

  IF v_policy.retention_mode = 'soft_delete' AND v_policy.retention_days IS NOT NULL THEN
    RETURN p_deleted_at + make_interval(days => v_policy.retention_days);
  END IF;

  IF v_policy.retention_mode = 'retain_until_eligible' AND v_policy.eligible_days IS NOT NULL THEN
    RETURN p_deleted_at + make_interval(days => v_policy.eligible_days);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.media_compute_purge_after(text, timestamptz) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.mark_media_asset_soft_deleted_if_unreferenced(
  p_asset_id uuid,
  p_deleted_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset public.media_assets%ROWTYPE;
  v_active_refs integer;
  v_purge_after timestamptz;
BEGIN
  SELECT * INTO v_asset
  FROM public.media_assets
  WHERE id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'asset_not_found');
  END IF;

  SELECT count(*) INTO v_active_refs
  FROM public.media_references
  WHERE asset_id = p_asset_id
    AND is_active = true;

  IF v_active_refs > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'asset_id', p_asset_id,
      'remaining_active_refs', v_active_refs,
      'asset_transitioned', false
    );
  END IF;

  IF v_asset.status IN ('purged', 'purging') THEN
    RETURN jsonb_build_object(
      'success', true,
      'asset_id', p_asset_id,
      'remaining_active_refs', 0,
      'asset_transitioned', false,
      'already_terminal', true
    );
  END IF;

  v_purge_after := public.media_compute_purge_after(v_asset.media_family, p_deleted_at);

  UPDATE public.media_assets
  SET status      = 'soft_deleted',
      deleted_at  = COALESCE(deleted_at, p_deleted_at),
      purge_after = v_purge_after,
      last_error  = NULL
  WHERE id = p_asset_id;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'remaining_active_refs', 0,
    'asset_transitioned', true,
    'purge_after', v_purge_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_media_asset_soft_deleted_if_unreferenced(uuid, timestamptz) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.ensure_profile_photo_asset(
  p_user_id uuid,
  p_storage_path text,
  p_legacy_table text DEFAULT 'profiles',
  p_legacy_id text DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset_id uuid;
  v_status text := CASE
    WHEN p_status IN ('uploading', 'active') THEN p_status
    ELSE 'active'
  END;
BEGIN
  IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
    RAISE EXCEPTION 'storage path is required';
  END IF;

  SELECT id INTO v_asset_id
  FROM public.media_assets
  WHERE provider = 'bunny_storage'
    AND provider_path = p_storage_path
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.media_assets
    SET media_family = 'profile_photo',
        owner_user_id = COALESCE(owner_user_id, p_user_id),
        legacy_table = COALESCE(p_legacy_table, legacy_table),
        legacy_id = COALESCE(p_legacy_id, legacy_id),
        status = CASE
          WHEN v_status = 'active' THEN 'active'
          WHEN public.media_assets.status IN ('soft_deleted', 'purge_ready', 'failed') THEN v_status
          ELSE public.media_assets.status
        END,
        deleted_at = CASE WHEN v_status = 'active' THEN NULL ELSE deleted_at END,
        purge_after = CASE WHEN v_status = 'active' THEN NULL ELSE purge_after END,
        purged_at = CASE WHEN v_status = 'active' THEN NULL ELSE purged_at END,
        last_error = CASE WHEN v_status = 'active' THEN NULL ELSE last_error END
    WHERE id = v_asset_id;
  ELSE
    INSERT INTO public.media_assets (
      provider,
      media_family,
      owner_user_id,
      provider_path,
      status,
      legacy_table,
      legacy_id
    ) VALUES (
      'bunny_storage',
      'profile_photo',
      p_user_id,
      p_storage_path,
      v_status,
      p_legacy_table,
      p_legacy_id
    )
    RETURNING id INTO v_asset_id;
  END IF;

  RETURN v_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_profile_photo_asset(uuid, text, text, text, text) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.ensure_vibe_video_asset(
  p_user_id uuid,
  p_video_id text,
  p_legacy_table text DEFAULT 'profiles',
  p_legacy_id text DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset_id uuid;
  v_status text := CASE
    WHEN p_status IN ('uploading', 'active') THEN p_status
    ELSE 'active'
  END;
BEGIN
  IF p_video_id IS NULL OR length(trim(p_video_id)) = 0 THEN
    RAISE EXCEPTION 'video id is required';
  END IF;

  SELECT id INTO v_asset_id
  FROM public.media_assets
  WHERE provider = 'bunny_stream'
    AND provider_object_id = p_video_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.media_assets
    SET media_family = 'vibe_video',
        owner_user_id = COALESCE(owner_user_id, p_user_id),
        legacy_table = COALESCE(p_legacy_table, legacy_table),
        legacy_id = COALESCE(p_legacy_id, legacy_id),
        status = CASE
          WHEN v_status = 'active' THEN 'active'
          WHEN public.media_assets.status IN ('soft_deleted', 'purge_ready', 'failed') THEN v_status
          ELSE public.media_assets.status
        END,
        deleted_at = CASE WHEN v_status = 'active' THEN NULL ELSE deleted_at END,
        purge_after = CASE WHEN v_status = 'active' THEN NULL ELSE purge_after END,
        purged_at = CASE WHEN v_status = 'active' THEN NULL ELSE purged_at END,
        last_error = CASE WHEN v_status = 'active' THEN NULL ELSE last_error END
    WHERE id = v_asset_id;
  ELSE
    INSERT INTO public.media_assets (
      provider,
      media_family,
      owner_user_id,
      provider_object_id,
      status,
      legacy_table,
      legacy_id
    ) VALUES (
      'bunny_stream',
      'vibe_video',
      p_user_id,
      p_video_id,
      v_status,
      p_legacy_table,
      p_legacy_id
    )
    RETURNING id INTO v_asset_id;
  END IF;

  RETURN v_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_vibe_video_asset(uuid, text, text, text, text) FROM PUBLIC;


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


CREATE OR REPLACE FUNCTION public.activate_profile_vibe_video(
  p_user_id uuid,
  p_video_id text,
  p_video_status text DEFAULT 'uploading'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_video_id text := NULLIF(trim(COALESCE(p_video_id, '')), '');
  v_status text := COALESCE(NULLIF(trim(COALESCE(p_video_status, '')), ''), 'uploading');
  v_asset_id uuid;
  v_ref record;
  v_released integer := 0;
BEGIN
  IF v_video_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'video_id_required');
  END IF;

  PERFORM 1
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  v_asset_id := public.ensure_vibe_video_asset(
    p_user_id,
    v_video_id,
    'profiles',
    format('%s:bunny_video_uid', p_user_id::text),
    'active'
  );

  FOR v_ref IN
    SELECT id
    FROM public.media_references
    WHERE ref_table = 'profiles'
      AND ref_id = p_user_id::text
      AND ref_type = 'profile_vibe_video'
      AND is_active = true
      AND asset_id <> v_asset_id
  LOOP
    PERFORM public.release_media_reference(v_ref.id, 'replace');
    v_released := v_released + 1;
  END LOOP;

  UPDATE public.profile_vibe_videos
  SET is_active = false,
      is_primary = false,
      removed_at = COALESCE(removed_at, now())
  WHERE user_id = p_user_id
    AND is_active = true
    AND asset_id <> v_asset_id;

  INSERT INTO public.profile_vibe_videos (
    user_id,
    asset_id,
    video_status,
    display_order,
    is_primary,
    is_active,
    removed_at
  ) VALUES (
    p_user_id,
    v_asset_id,
    v_status,
    0,
    true,
    true,
    NULL
  )
  ON CONFLICT (asset_id) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      video_status = EXCLUDED.video_status,
      display_order = 0,
      is_primary = true,
      is_active = true,
      removed_at = NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM public.media_references
    WHERE asset_id = v_asset_id
      AND ref_type = 'profile_vibe_video'
      AND ref_table = 'profiles'
      AND ref_id = p_user_id::text
      AND ref_key = 'primary'
      AND is_active = true
  ) THEN
    INSERT INTO public.media_references (
      asset_id, ref_type, ref_table, ref_id, ref_key, is_active
    ) VALUES (
      v_asset_id, 'profile_vibe_video', 'profiles', p_user_id::text, 'primary', true
    );
  END IF;

  UPDATE public.profiles
  SET bunny_video_uid = v_video_id,
      bunny_video_status = v_status
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', v_asset_id,
    'references_released', v_released,
    'bunny_video_uid', v_video_id,
    'bunny_video_status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_profile_vibe_video(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_profile_vibe_video(uuid, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.clear_profile_vibe_video(
  p_user_id uuid,
  p_clear_caption boolean DEFAULT true,
  p_released_by text DEFAULT 'user_action'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_ref record;
  v_asset_id uuid;
  v_released integer := 0;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  IF v_profile.bunny_video_uid IS NULL OR length(trim(v_profile.bunny_video_uid)) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'had_video', false,
      'references_released', 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.media_references
    WHERE ref_table = 'profiles'
      AND ref_id = p_user_id::text
      AND ref_type = 'profile_vibe_video'
      AND is_active = true
  ) THEN
    v_asset_id := public.ensure_vibe_video_asset(
      p_user_id,
      v_profile.bunny_video_uid,
      'profiles',
      format('%s:bunny_video_uid', p_user_id::text),
      'active'
    );

    INSERT INTO public.profile_vibe_videos (
      user_id,
      asset_id,
      video_status,
      display_order,
      is_primary,
      is_active,
      removed_at
    ) VALUES (
      p_user_id,
      v_asset_id,
      COALESCE(NULLIF(trim(COALESCE(v_profile.bunny_video_status, '')), ''), 'uploading'),
      0,
      true,
      true,
      NULL
    )
    ON CONFLICT (asset_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        video_status = EXCLUDED.video_status,
        display_order = 0,
        is_primary = true,
        is_active = true,
        removed_at = NULL;

    INSERT INTO public.media_references (
      asset_id, ref_type, ref_table, ref_id, ref_key, is_active
    )
    SELECT
      v_asset_id, 'profile_vibe_video', 'profiles', p_user_id::text, 'primary', true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.media_references
      WHERE asset_id = v_asset_id
        AND ref_type = 'profile_vibe_video'
        AND ref_table = 'profiles'
        AND ref_id = p_user_id::text
        AND ref_key = 'primary'
        AND is_active = true
    );
  END IF;

  FOR v_ref IN
    SELECT id
    FROM public.media_references
    WHERE ref_table = 'profiles'
      AND ref_id = p_user_id::text
      AND ref_type = 'profile_vibe_video'
      AND is_active = true
  LOOP
    PERFORM public.release_media_reference(v_ref.id, p_released_by);
    v_released := v_released + 1;
  END LOOP;

  UPDATE public.profile_vibe_videos
  SET is_active = false,
      is_primary = false,
      removed_at = COALESCE(removed_at, now())
  WHERE user_id = p_user_id
    AND is_active = true;

  UPDATE public.profiles
  SET bunny_video_uid = NULL,
      bunny_video_status = 'none',
      vibe_caption = CASE WHEN p_clear_caption THEN NULL ELSE vibe_caption END
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'had_video', true,
    'references_released', v_released
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clear_profile_vibe_video(uuid, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_profile_vibe_video(uuid, boolean, text) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Sprint 2 redefinitions
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_sync_result  jsonb;
BEGIN
  IF auth.role() != 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
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

  UPDATE public.profiles
  SET photos     = v_photos,
      avatar_url = v_avatar
  WHERE id = p_user_id;

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

  v_sync_result := public.sync_profile_photo_media(p_user_id, v_photos, v_avatar);
  IF COALESCE((v_sync_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN COALESCE(v_sync_result, jsonb_build_object('success', false, 'error', 'photo_media_sync_failed'));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'photos_count', v_len,
    'avatar_url', v_avatar,
    'sessions_published', v_published,
    'sessions_orphaned', v_orphaned,
    'media_sync', v_sync_result,
    'context', p_context
  );
END;
$$;


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
  v_asset_id uuid;
  v_soft_delete_result jsonb;
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

  IF p_storage_path IS NOT NULL AND length(trim(p_storage_path)) > 0 THEN
    v_asset_id := public.ensure_profile_photo_asset(
      p_user_id,
      p_storage_path,
      'profiles',
      format('%s:deleted:%s', p_user_id::text, p_storage_path),
      'uploading'
    );
    v_soft_delete_result := public.mark_media_asset_soft_deleted_if_unreferenced(v_asset_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sessions_marked', v_count,
    'asset_soft_delete', v_soft_delete_result
  );
END;
$$;


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

  UPDATE public.draft_media_sessions
  SET status = 'deleted'
  WHERE user_id = v_uid
    AND media_type = 'photo'
    AND storage_path = ANY(p_paths)
    AND status NOT IN ('published', 'deleted', 'abandoned');

  GET DIAGNOSTICS v_count = ROW_COUNT;

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
    'sessions_marked', v_count,
    'assets_soft_deleted', v_soft_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_photo_drafts_deleted(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_photo_drafts_deleted(text[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.update_media_session_status(
  p_provider_id  text,
  p_new_status   text,
  p_error_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session    public.draft_media_sessions%ROWTYPE;
  v_allowed    boolean;
  v_old_status text;
BEGIN
  IF p_new_status NOT IN ('uploading', 'processing', 'ready', 'failed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_transition',
      'detail', format('Status %L is not settable via webhook', p_new_status)
    );
  END IF;

  SELECT * INTO v_session
  FROM public.draft_media_sessions
  WHERE provider_id = p_provider_id
    AND status NOT IN ('published', 'deleted', 'abandoned', 'failed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  v_old_status := v_session.status;

  IF v_old_status = p_new_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'session_id', v_session.id,
      'user_id', v_session.user_id,
      'previous_status', v_old_status,
      'new_status', p_new_status,
      'idempotent', true
    );
  END IF;

  v_allowed := false;
  IF p_new_status = 'failed' THEN
    v_allowed := true;
  ELSIF p_new_status = 'uploading' AND v_old_status = 'created' THEN
    v_allowed := true;
  ELSIF p_new_status = 'processing' AND v_old_status IN ('created', 'uploading') THEN
    v_allowed := true;
  ELSIF p_new_status = 'ready' AND v_old_status IN ('created', 'uploading', 'processing') THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_transition',
      'detail', format('Cannot transition from %L to %L', v_old_status, p_new_status)
    );
  END IF;

  UPDATE public.draft_media_sessions
  SET status       = p_new_status,
      error_detail = COALESCE(p_error_detail, error_detail)
  WHERE id = v_session.id;

  IF v_session.media_type = 'vibe_video' THEN
    UPDATE public.profile_vibe_videos pvv
    SET video_status = p_new_status
    FROM public.media_assets ma
    WHERE pvv.asset_id = ma.id
      AND ma.provider = 'bunny_stream'
      AND ma.provider_object_id = p_provider_id;

    UPDATE public.profiles
    SET bunny_video_status = p_new_status
    WHERE id = v_session.user_id
      AND bunny_video_uid = p_provider_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'user_id', v_session.user_id,
    'previous_status', v_old_status,
    'new_status', p_new_status
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.publish_media_session(
  p_session_id uuid,
  p_caption    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session public.draft_media_sessions%ROWTYPE;
  v_status text;
  v_activate_result jsonb;
BEGIN
  SELECT * INTO v_session
  FROM public.draft_media_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF v_session.status = 'published' THEN
    RETURN jsonb_build_object('success', true, 'already_published', true);
  END IF;

  IF v_session.status NOT IN ('ready', 'uploading', 'processing') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_status',
      'current_status', v_session.status
    );
  END IF;

  IF v_session.media_type = 'vibe_video' THEN
    UPDATE public.draft_media_sessions
    SET status = 'deleted'
    WHERE user_id = v_session.user_id
      AND media_type = 'vibe_video'
      AND status = 'published'
      AND id != v_session.id;

    v_status := CASE
      WHEN v_session.status = 'ready' THEN 'ready'
      ELSE v_session.status
    END;

    v_activate_result := public.activate_profile_vibe_video(
      v_session.user_id,
      v_session.provider_id,
      v_status
    );

    IF COALESCE((v_activate_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'video_sync_failed',
        'detail', COALESCE(v_activate_result->>'error', 'Video sync failed')
      );
    END IF;

    UPDATE public.profiles
    SET vibe_caption = COALESCE(p_caption, v_session.caption)
    WHERE id = v_session.user_id;
  END IF;

  UPDATE public.draft_media_sessions
  SET status       = 'published',
      published_at = now(),
      caption      = COALESCE(p_caption, caption)
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'published', true
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.finalize_onboarding(
  p_user_id uuid,
  p_final_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_draft public.onboarding_drafts%ROWTYPE;
  v_data jsonb;
  v_errors text[] := ARRAY[]::text[];

  v_name text;
  v_birth_date text;
  v_birth_date_norm text;
  v_age int;
  v_gender text;
  v_gender_custom text;
  v_interested_in text;
  v_rel_intent text;
  v_height_cm int;
  v_job text;
  v_photos text[];
  v_about_me text;
  v_location text;
  v_location_data jsonb;
  v_country text;
  v_bunny_video_uid text;
  v_community_agreed boolean;

  v_photo_count int;
  v_normalized_intent text;
  v_normalized_gender text;
  v_location_lat double precision;
  v_location_lng double precision;
  v_has_confirmed_location boolean := false;

  v_complete_result jsonb;
  v_photo_publish_result jsonb;
  v_video_sync_result jsonb;

  v_vibe_score int;
  v_vibe_score_label text;
  v_has_final_data boolean := false;
  v_auth_email text;
  v_completion_step smallint;
  v_video_status text;
  v_owner_prefix text;
  v_photo text;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'forbidden',
      'errors', jsonb_build_array('Forbidden')
    );
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'profile_not_found',
      'errors', jsonb_build_array('User profile row does not exist')
    );
  END IF;

  IF v_profile.onboarding_complete = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'error', NULL,
      'errors', '[]'::jsonb,
      'already_completed', true,
      'vibe_score', COALESCE(v_profile.vibe_score, 0),
      'vibe_score_label', COALESCE(v_profile.vibe_score_label, 'New')
    );
  END IF;

  v_has_final_data := p_final_data IS NOT NULL
    AND p_final_data != 'null'::jsonb
    AND p_final_data != '{}'::jsonb;

  SELECT NULLIF(trim(COALESCE(au.email, '')), '')
  INTO v_auth_email
  FROM auth.users au
  WHERE au.id = p_user_id;

  v_completion_step := CASE
    WHEN v_auth_email IS NULL THEN 14
    ELSE 13
  END;

  SELECT *
  INTO v_draft
  FROM public.onboarding_drafts
  WHERE user_id = p_user_id
    AND completed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    IF NOT v_has_final_data THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'no_draft',
        'errors', jsonb_build_array('No onboarding draft found and no final payload was provided')
      );
    END IF;

    INSERT INTO public.onboarding_drafts (
      user_id,
      schema_version,
      current_step,
      current_stage,
      onboarding_data,
      last_client_platform,
      completed_at,
      updated_at,
      expires_at
    )
    VALUES (
      p_user_id,
      2,
      v_completion_step,
      'media',
      p_final_data,
      NULL,
      NULL,
      now(),
      now() + interval '30 days'
    )
    ON CONFLICT (user_id) DO UPDATE
    SET schema_version = EXCLUDED.schema_version,
        current_step = EXCLUDED.current_step,
        current_stage = EXCLUDED.current_stage,
        onboarding_data = EXCLUDED.onboarding_data,
        last_client_platform = COALESCE(public.onboarding_drafts.last_client_platform, EXCLUDED.last_client_platform),
        completed_at = NULL,
        updated_at = now(),
        expires_at = now() + interval '30 days';

    SELECT *
    INTO v_draft
    FROM public.onboarding_drafts
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'draft_materialization_failed',
        'errors', jsonb_build_array('Could not materialize onboarding draft for finalization')
      );
    END IF;
  END IF;

  IF v_has_final_data THEN
    v_data := p_final_data;

    UPDATE public.onboarding_drafts
    SET onboarding_data = p_final_data,
        updated_at = now(),
        expires_at = GREATEST(expires_at, now() + interval '30 days')
    WHERE user_id = p_user_id;
  ELSE
    v_data := v_draft.onboarding_data;
  END IF;

  v_name := trim(COALESCE(v_data->>'name', ''));
  v_birth_date := COALESCE(v_data->>'birthDate', '');
  v_gender := COALESCE(v_data->>'gender', '');
  v_gender_custom := trim(COALESCE(v_data->>'genderCustom', ''));
  v_interested_in := COALESCE(v_data->>'interestedIn', '');
  v_rel_intent := COALESCE(v_data->>'relationshipIntent', '');
  v_job := trim(COALESCE(v_data->>'job', ''));
  v_about_me := trim(COALESCE(v_data->>'aboutMe', ''));
  v_location := trim(COALESCE(v_data->>'location', ''));
  v_location_data := v_data->'locationData';
  v_country := trim(COALESCE(v_data->>'country', ''));
  v_bunny_video_uid := v_data->>'bunnyVideoUid';
  v_community_agreed := COALESCE((v_data->>'communityAgreed')::boolean, false);

  BEGIN
    v_height_cm := (v_data->>'heightCm')::int;
  EXCEPTION WHEN OTHERS THEN
    v_height_cm := NULL;
  END;

  SELECT COALESCE(array_agg(elem::text), ARRAY[]::text[])
  INTO v_photos
  FROM jsonb_array_elements_text(COALESCE(v_data->'photos', '[]'::jsonb)) AS elem;

  BEGIN
    IF v_location_data IS NOT NULL AND v_location_data != 'null'::jsonb THEN
      v_location_lat := NULLIF(trim(COALESCE(v_location_data->>'lat', '')), '')::double precision;
      v_location_lng := NULLIF(trim(COALESCE(v_location_data->>'lng', '')), '')::double precision;
      v_has_confirmed_location :=
        v_location_lat IS NOT NULL
        AND v_location_lng IS NOT NULL
        AND v_location_lat BETWEEN -90 AND 90
        AND v_location_lng BETWEEN -180 AND 180;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_location_lat := NULL;
    v_location_lng := NULL;
    v_has_confirmed_location := false;
  END;

  IF v_birth_date != '' THEN
    BEGIN
      v_birth_date_norm := to_char(v_birth_date::date, 'YYYY-MM-DD');
      v_age := EXTRACT(YEAR FROM age(v_birth_date_norm::date));
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Invalid birth date format');
    END;
  END IF;

  IF v_gender = 'other' AND v_gender_custom != '' THEN
    v_normalized_gender := v_gender_custom;
  ELSE
    v_normalized_gender := v_gender;
  END IF;

  IF v_rel_intent IS NULL OR trim(v_rel_intent) = '' THEN
    v_normalized_intent := NULL;
  ELSE
    v_normalized_intent := public.normalize_relationship_intent(v_rel_intent);
    IF v_normalized_intent IS NULL THEN
      v_normalized_intent := 'figuring-out';
    END IF;
  END IF;

  IF v_name = '' THEN
    v_errors := array_append(v_errors, 'Name is required');
  END IF;

  IF v_birth_date = '' THEN
    v_errors := array_append(v_errors, 'Birthday is required');
  END IF;

  IF v_age IS NOT NULL AND v_age < 18 THEN
    v_errors := array_append(v_errors, 'Must be 18 or older');
  END IF;

  IF v_normalized_gender = '' OR v_normalized_gender = 'prefer_not_to_say' THEN
    v_errors := array_append(v_errors, 'Gender is required');
  END IF;

  v_photo_count := COALESCE(array_length(v_photos, 1), 0);
  IF v_photo_count < 2 THEN
    v_errors := array_append(v_errors, 'At least 2 photos required');
  END IF;

  v_owner_prefix := 'photos/' || p_user_id::text || '/';
  FOREACH v_photo IN ARRAY v_photos LOOP
    IF v_photo IS NULL OR length(trim(v_photo)) = 0 THEN
      v_errors := array_append(v_errors, 'Photo path is invalid');
      CONTINUE;
    END IF;
    IF strpos(v_photo, '..') > 0 THEN
      v_errors := array_append(v_errors, 'Photo path is invalid');
      CONTINUE;
    END IF;
    IF NOT v_photo LIKE v_owner_prefix || '%' THEN
      v_errors := array_append(v_errors, 'Photo path is forbidden');
    END IF;
  END LOOP;

  IF v_photo_count > 0 AND (
    SELECT COUNT(DISTINCT u) FROM unnest(v_photos) AS u
  ) <> v_photo_count THEN
    v_errors := array_append(v_errors, 'Duplicate photos are not allowed');
  END IF;

  IF v_about_me != '' AND length(v_about_me) < 10 THEN
    v_errors := array_append(v_errors, 'About me must be at least 10 characters');
  END IF;

  IF v_interested_in = '' THEN
    v_errors := array_append(v_errors, 'Interested in is required');
  END IF;

  IF v_rel_intent IS NULL OR trim(v_rel_intent) = '' THEN
    v_errors := array_append(v_errors, 'Relationship intent is required');
  END IF;

  IF v_location = '' OR v_country = '' OR NOT v_has_confirmed_location THEN
    v_errors := array_append(v_errors, 'Confirmed location is required');
  END IF;

  IF NOT v_community_agreed THEN
    v_errors := array_append(v_errors, 'Community standards agreement is required');
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL AND array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', to_jsonb(v_errors)
    );
  END IF;

  PERFORM set_config('vibely.onboarding_server_update', '1', true);

  BEGIN
    UPDATE public.profiles
    SET name = v_name,
        birth_date = NULLIF(v_birth_date_norm, '')::date,
        age = v_age,
        gender = v_normalized_gender,
        interested_in = ARRAY[v_interested_in],
        relationship_intent = v_normalized_intent,
        looking_for = v_normalized_intent,
        height_cm = v_height_cm,
        job = NULLIF(v_job, ''),
        photos = v_photos,
        avatar_url = NULLIF(v_photos[1], ''),
        about_me = NULLIF(v_about_me, ''),
        location = NULLIF(v_location, ''),
        location_data = CASE
          WHEN v_has_confirmed_location THEN jsonb_build_object('lat', v_location_lat, 'lng', v_location_lng)
          ELSE NULL
        END,
        country = NULLIF(v_country, ''),
        bunny_video_uid = NULLIF(v_bunny_video_uid, ''),
        community_agreed_at = CASE WHEN v_community_agreed THEN now() ELSE NULL END,
        updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      PERFORM set_config('vibely.onboarding_server_update', NULL, true);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'profile_not_found',
        'errors', jsonb_build_array('User profile row does not exist')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.onboarding_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.onboarding_server_update', NULL, true);

  v_photo_publish_result := public.publish_photo_set(
    p_user_id,
    v_photos,
    'onboarding'
  );
  IF COALESCE((v_photo_publish_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'photo_publish_failed',
      'errors', jsonb_build_array(COALESCE(v_photo_publish_result->>'error', 'Photo publish failed'))
    );
  END IF;

  IF NULLIF(trim(COALESCE(v_bunny_video_uid, '')), '') IS NOT NULL THEN
    SELECT COALESCE(
      (
        SELECT CASE
          WHEN dms.status = 'published' THEN 'ready'
          ELSE dms.status
        END
        FROM public.draft_media_sessions dms
        WHERE dms.user_id = p_user_id
          AND dms.media_type = 'vibe_video'
          AND dms.provider_id = NULLIF(trim(COALESCE(v_bunny_video_uid, '')), '')
        ORDER BY dms.created_at DESC
        LIMIT 1
      ),
      COALESCE(NULLIF(trim(COALESCE(v_profile.bunny_video_status, '')), ''), 'uploading')
    )
    INTO v_video_status;

    v_video_sync_result := public.activate_profile_vibe_video(
      p_user_id,
      NULLIF(trim(COALESCE(v_bunny_video_uid, '')), ''),
      v_video_status
    );

    IF COALESCE((v_video_sync_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'video_sync_failed',
        'errors', jsonb_build_array(COALESCE(v_video_sync_result->>'error', 'Video sync failed'))
      );
    END IF;
  END IF;

  SELECT public.complete_onboarding(p_user_id) INTO v_complete_result;

  IF COALESCE((v_complete_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', COALESCE(v_complete_result->'errors', '[]'::jsonb),
      'already_completed', false
    );
  END IF;

  INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.onboarding_drafts
  SET completed_at = now(),
      current_step = GREATEST(COALESCE(current_step, 0), v_completion_step)::smallint,
      current_stage = 'complete',
      onboarding_data = v_data,
      updated_at = now(),
      expires_at = GREATEST(expires_at, now() + interval '30 days')
  WHERE user_id = p_user_id;

  SELECT vibe_score, vibe_score_label
  INTO v_vibe_score, v_vibe_score_label
  FROM public.profiles
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'error', NULL,
    'errors', '[]'::jsonb,
    'already_completed', false,
    'vibe_score', v_vibe_score,
    'vibe_score_label', v_vibe_score_label
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_onboarding(uuid, jsonb) IS
  'Atomic server-owned onboarding finalization. Idempotent. Materializes photo/vibe-video media lifecycle rows while preserving profiles.photos and profiles.bunny_video_uid as compatibility mirrors.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Conservative backfill for current published profile media
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, bunny_video_uid, COALESCE(NULLIF(trim(COALESCE(bunny_video_status, '')), ''), 'ready') AS bunny_video_status
    FROM public.profiles
    WHERE bunny_video_uid IS NOT NULL
      AND length(trim(bunny_video_uid)) > 0
  LOOP
    PERFORM public.activate_profile_vibe_video(r.id, r.bunny_video_uid, r.bunny_video_status);
  END LOOP;
END;
$$;

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
