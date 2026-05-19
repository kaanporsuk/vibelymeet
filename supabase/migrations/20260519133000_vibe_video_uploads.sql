-- Vibe Video upload attempts for the media-v2 rollout.
--
-- This table is additive. It records new Bunny Stream Vibe Video attempts
-- alongside the existing draft_media_sessions/profile compatibility path.

CREATE TABLE IF NOT EXISTS public.vibe_video_uploads (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_request_id      uuid        NOT NULL,
  media_asset_id         uuid        REFERENCES public.media_assets(id) ON DELETE SET NULL,
  draft_media_session_id uuid        REFERENCES public.draft_media_sessions(id) ON DELETE SET NULL,
  provider_object_id     text        NOT NULL,
  upload_context         text        NOT NULL DEFAULT 'profile_studio'
    CHECK (upload_context IN ('onboarding', 'profile_studio')),
  status                 text        NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'superseded')),
  error_detail           text,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_vibe_video_uploads_user_client
    UNIQUE (user_id, client_request_id),
  CONSTRAINT uq_vibe_video_uploads_provider_object
    UNIQUE (provider_object_id)
);

CREATE INDEX IF NOT EXISTS idx_vibe_video_uploads_user
  ON public.vibe_video_uploads (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vibe_video_uploads_session
  ON public.vibe_video_uploads (draft_media_session_id)
  WHERE draft_media_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vibe_video_uploads_status
  ON public.vibe_video_uploads (status, updated_at DESC)
  WHERE status IN ('uploading', 'processing');

CREATE OR REPLACE FUNCTION public.vibe_video_uploads_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vibe_video_uploads_updated_at
  ON public.vibe_video_uploads;
CREATE TRIGGER trg_vibe_video_uploads_updated_at
  BEFORE UPDATE ON public.vibe_video_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.vibe_video_uploads_set_updated_at();

ALTER TABLE public.vibe_video_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_vibe_video_uploads
  ON public.vibe_video_uploads;
CREATE POLICY users_select_own_vibe_video_uploads
  ON public.vibe_video_uploads FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS service_role_full_access_vibe_video_uploads
  ON public.vibe_video_uploads;
CREATE POLICY service_role_full_access_vibe_video_uploads
  ON public.vibe_video_uploads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON TABLE public.vibe_video_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vibe_video_uploads TO service_role;

CREATE OR REPLACE FUNCTION public.vibe_video_upload_status_from_session(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_status
    WHEN 'ready' THEN 'ready'
    WHEN 'published' THEN 'ready'
    WHEN 'failed' THEN 'failed'
    WHEN 'deleted' THEN 'superseded'
    WHEN 'abandoned' THEN 'superseded'
    WHEN 'processing' THEN 'processing'
    ELSE 'uploading'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vibe_video_upload_from_draft_media_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempt_status text;
BEGIN
  IF NEW.media_type <> 'vibe_video' OR NEW.provider_id IS NULL OR btrim(NEW.provider_id) = '' THEN
    RETURN NEW;
  END IF;

  v_attempt_status := public.vibe_video_upload_status_from_session(NEW.status);

  UPDATE public.vibe_video_uploads
  SET draft_media_session_id = NEW.id,
      status = v_attempt_status,
      error_detail = CASE
        WHEN v_attempt_status = 'failed' THEN COALESCE(NEW.error_detail, error_detail)
        WHEN v_attempt_status = 'superseded' THEN COALESCE(NEW.error_detail, error_detail, NEW.status)
        ELSE error_detail
      END
  WHERE provider_object_id = NEW.provider_id
     OR draft_media_session_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vibe_video_upload_from_dms
  ON public.draft_media_sessions;
CREATE TRIGGER trg_sync_vibe_video_upload_from_dms
  AFTER INSERT OR UPDATE OF status, provider_id, error_detail
  ON public.draft_media_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_vibe_video_upload_from_draft_media_session();

REVOKE ALL ON FUNCTION public.vibe_video_upload_status_from_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vibe_video_upload_status_from_session(text) TO service_role;

REVOKE ALL ON FUNCTION public.sync_vibe_video_upload_from_draft_media_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_vibe_video_upload_from_draft_media_session() TO service_role;

COMMENT ON TABLE public.vibe_video_uploads IS
  'Server-owned upload attempt records for profile Vibe Videos uploaded directly to Bunny Stream.';
COMMENT ON FUNCTION public.sync_vibe_video_upload_from_draft_media_session() IS
  'Keeps vibe_video_uploads aligned with draft_media_sessions provider status transitions.';
