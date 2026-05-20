-- Phase 3 media SDK hardening.
--
-- Forward-only, additive follow-up for persistent SDK queue reconciliation,
-- profile-video SLO slicing, and retry/attempt observability.

ALTER TABLE public.vibe_video_uploads
  ADD COLUMN IF NOT EXISTS duration_ms integer
    CHECK (duration_ms IS NULL OR (duration_ms > 0 AND duration_ms <= 30250)),
  ADD COLUMN IF NOT EXISTS aspect_ratio numeric,
  ADD COLUMN IF NOT EXISTS source_bytes bigint
    CHECK (source_bytes IS NULL OR (source_bytes > 0 AND source_bytes <= 209715200)),
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0);

CREATE INDEX IF NOT EXISTS idx_vibe_video_uploads_retry_attempts
  ON public.vibe_video_uploads (user_id, updated_at DESC)
  WHERE attempt_count > 0;

GRANT SELECT ON TABLE public.chat_vibe_clip_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_vibe_clip_uploads TO service_role;

CREATE OR REPLACE FUNCTION public.increment_vibe_video_upload_attempt_count(p_upload_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt_count integer;
BEGIN
  UPDATE public.vibe_video_uploads
  SET attempt_count = attempt_count + 1
  WHERE id = p_upload_id
  RETURNING attempt_count INTO v_attempt_count;

  RETURN COALESCE(v_attempt_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_vibe_video_upload_attempt_count(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_vibe_video_upload_attempt_count(uuid)
  TO service_role;

UPDATE public.vibe_video_uploads u
SET duration_ms = COALESCE(
      u.duration_ms,
      CASE
        WHEN d.provider_meta ? 'duration_ms'
         AND (d.provider_meta->>'duration_ms') ~ '^[0-9]+$'
        THEN (d.provider_meta->>'duration_ms')::integer
        ELSE NULL
      END
    ),
    aspect_ratio = COALESCE(
      u.aspect_ratio,
      CASE
        WHEN d.provider_meta ? 'aspect_ratio'
         AND (d.provider_meta->>'aspect_ratio') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (d.provider_meta->>'aspect_ratio')::numeric
        ELSE NULL
      END
    ),
    source_bytes = COALESCE(
      u.source_bytes,
      CASE
        WHEN d.provider_meta ? 'source_bytes'
         AND (d.provider_meta->>'source_bytes') ~ '^[0-9]+$'
        THEN (d.provider_meta->>'source_bytes')::bigint
        ELSE NULL
      END
    ),
    mime_type = COALESCE(NULLIF(u.mime_type, ''), NULLIF(d.provider_meta->>'mime_type', ''))
FROM public.draft_media_sessions d
WHERE u.draft_media_session_id = d.id
  AND d.media_type = 'vibe_video';

COMMENT ON COLUMN public.vibe_video_uploads.user_id IS
  'Uploader id. Uses user_id for profile Vibe Video compatibility; chat_vibe_clip_uploads uses sender_id for match/message semantics.';

COMMENT ON COLUMN public.vibe_video_uploads.expires_at IS
  'Bunny Stream TUS credential expiry. Must match create-video-upload EXPECTED_TUS_CREDENTIAL_TTL_MS (currently 1 hour).';

COMMENT ON COLUMN public.vibe_video_uploads.duration_ms IS
  'Optional source duration, mirrored from client/draft metadata for SLO slicing.';

COMMENT ON COLUMN public.vibe_video_uploads.aspect_ratio IS
  'Optional source aspect ratio, mirrored from client/draft metadata.';

COMMENT ON COLUMN public.vibe_video_uploads.source_bytes IS
  'Optional source file size in bytes, mirrored from client/draft metadata.';

COMMENT ON COLUMN public.vibe_video_uploads.mime_type IS
  'Optional source MIME type, mirrored from client/draft metadata.';

COMMENT ON COLUMN public.vibe_video_uploads.attempt_count IS
  'Number of idempotent retry/reuse attempts observed for this upload attempt.';

COMMENT ON FUNCTION public.increment_vibe_video_upload_attempt_count(uuid) IS
  'Service-role-only atomic retry counter increment for idempotent Vibe Video upload attempt reuse.';
