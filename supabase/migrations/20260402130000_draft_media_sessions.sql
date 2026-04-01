-- Phase 2A: Backend-owned draft media sessions
-- Tracks the lifecycle of media uploads (vibe video, photos) independently of
-- profiles columns.  The session row is the source of truth for upload state;
-- profiles columns become the *published* snapshot.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_media_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type    text        NOT NULL CHECK (media_type IN ('vibe_video', 'photo')),
  status        text        NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created',      -- session row exists, upload not yet started
      'uploading',    -- client is pushing bytes (TUS / PUT)
      'processing',   -- provider is transcoding / optimising
      'ready',        -- provider finished successfully
      'failed',       -- provider reported failure
      'published',    -- attached to profile
      'abandoned',    -- cleanup marked stale
      'deleted'       -- user explicitly deleted
    )),
  provider      text        NOT NULL DEFAULT 'bunny'
    CHECK (provider IN ('bunny')),
  provider_id   text,       -- Bunny Stream videoId  OR  Bunny Storage path
  provider_meta jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context       text        NOT NULL DEFAULT 'profile_studio'
    CHECK (context IN ('onboarding', 'profile_studio')),
  storage_path  text,       -- photos: "photos/{userId}/{ts}.ext"
  caption       text,       -- vibe_video caption
  error_detail  text,       -- machine-readable failure reason from provider
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

COMMENT ON TABLE public.draft_media_sessions IS
  'Tracks the full lifecycle of media uploads for onboarding and profile editing. '
  'Rows transition through created → uploading → processing → ready → published. '
  'Abandoned/expired rows are cleaned up by a periodic job.';

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dms_user_id
  ON public.draft_media_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_dms_provider_id
  ON public.draft_media_sessions (provider_id)
  WHERE provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dms_status_expires
  ON public.draft_media_sessions (status, expires_at)
  WHERE status NOT IN ('published', 'deleted', 'abandoned');

CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_active_vibe_video
  ON public.draft_media_sessions (user_id)
  WHERE media_type = 'vibe_video'
    AND status NOT IN ('published', 'deleted', 'abandoned', 'failed');

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.draft_media_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own media sessions"
  ON public.draft_media_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON public.draft_media_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Auto-update updated_at ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dms_updated_at
  BEFORE UPDATE ON public.draft_media_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─── RPC: create_media_session ───────────────────────────────────────────────
-- Called by create-video-upload (and later upload-image) to atomically create
-- a session row.  Returns the session id + any previous active session for the
-- same media_type so the caller can clean it up.

CREATE OR REPLACE FUNCTION public.create_media_session(
  p_user_id     uuid,
  p_media_type  text,
  p_provider_id text,
  p_provider_meta jsonb DEFAULT '{}'::jsonb,
  p_context     text DEFAULT 'profile_studio',
  p_storage_path text DEFAULT NULL,
  p_caption     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prev_id       uuid;
  v_prev_provider text;
  v_new_id        uuid;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- For vibe_video, find and abandon any active session (only one at a time)
  IF p_media_type = 'vibe_video' THEN
    SELECT id, provider_id INTO v_prev_id, v_prev_provider
    FROM public.draft_media_sessions
    WHERE user_id = p_user_id
      AND media_type = 'vibe_video'
      AND status NOT IN ('published', 'deleted', 'abandoned', 'failed')
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.draft_media_sessions
      SET status = 'abandoned'
      WHERE id = v_prev_id;
    END IF;
  END IF;

  INSERT INTO public.draft_media_sessions (
    user_id, media_type, status, provider_id, provider_meta,
    context, storage_path, caption
  ) VALUES (
    p_user_id, p_media_type, 'created', p_provider_id, p_provider_meta,
    p_context, p_storage_path, p_caption
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_new_id,
    'replaced_session_id', v_prev_id,
    'replaced_provider_id', v_prev_provider
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_media_session FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_media_session TO authenticated;

-- ─── RPC: update_media_session_status ────────────────────────────────────────
-- Called by video-webhook and clients to advance session state.
-- For webhook use, the function also accepts provider_id lookup.

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
  v_session  public.draft_media_sessions%ROWTYPE;
BEGIN
  -- Find session by provider_id (webhook path — no auth.uid() check needed,
  -- webhook auth is handled at the Edge Function level)
  SELECT * INTO v_session
  FROM public.draft_media_sessions
  WHERE provider_id = p_provider_id
    AND status NOT IN ('published', 'deleted', 'abandoned')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  UPDATE public.draft_media_sessions
  SET status       = p_new_status,
      error_detail = COALESCE(p_error_detail, error_detail)
  WHERE id = v_session.id;

  -- When video becomes ready, also update profiles for backward compatibility
  IF v_session.media_type = 'vibe_video' AND p_new_status = 'ready' THEN
    UPDATE public.profiles
    SET bunny_video_status = 'ready'
    WHERE id = v_session.user_id
      AND bunny_video_uid = p_provider_id;
  END IF;

  IF v_session.media_type = 'vibe_video' AND p_new_status = 'failed' THEN
    UPDATE public.profiles
    SET bunny_video_status = 'failed'
    WHERE id = v_session.user_id
      AND bunny_video_uid = p_provider_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'user_id', v_session.user_id,
    'previous_status', v_session.status,
    'new_status', p_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_media_session_status FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_media_session_status TO service_role;

-- ─── RPC: publish_media_session ──────────────────────────────────────────────
-- Atomically publishes a ready session to the user's profile.

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
    -- Mark any previously published vibe_video session as replaced
    UPDATE public.draft_media_sessions
    SET status = 'deleted'
    WHERE user_id = v_session.user_id
      AND media_type = 'vibe_video'
      AND status = 'published'
      AND id != v_session.id;

    UPDATE public.profiles
    SET bunny_video_uid    = v_session.provider_id,
        bunny_video_status = CASE
          WHEN v_session.status = 'ready' THEN 'ready'
          ELSE v_session.status
        END,
        vibe_caption       = COALESCE(p_caption, v_session.caption)
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

REVOKE ALL ON FUNCTION public.publish_media_session FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_media_session TO authenticated;

-- ─── RPC: get_active_media_session ───────────────────────────────────────────
-- Returns the user's current active session for a given media type, if any.

CREATE OR REPLACE FUNCTION public.get_active_media_session(
  p_user_id    uuid,
  p_media_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session public.draft_media_sessions%ROWTYPE;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_session
  FROM public.draft_media_sessions
  WHERE user_id = p_user_id
    AND media_type = p_media_type
    AND status NOT IN ('published', 'deleted', 'abandoned')
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'session', NULL);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'provider_id', v_session.provider_id,
      'provider_meta', v_session.provider_meta,
      'context', v_session.context,
      'storage_path', v_session.storage_path,
      'caption', v_session.caption,
      'created_at', v_session.created_at,
      'expires_at', v_session.expires_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_media_session FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_media_session TO authenticated;
