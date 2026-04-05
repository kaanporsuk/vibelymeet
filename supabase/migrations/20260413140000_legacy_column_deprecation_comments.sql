-- Clarify remaining compatibility-only profile columns after the onboarding and
-- video hardening campaign. This is a comment-only deprecation pass; no data or
-- runtime behavior changes are performed here.

COMMENT ON COLUMN public.profiles.relationship_intent IS
  'Canonical relationship-intent field for active web/native/backend flows. New reads and writes should use this column.';

COMMENT ON COLUMN public.profiles.looking_for IS
  'DEPRECATED legacy mirror of public.profiles.relationship_intent. Retained temporarily for backwards-compatible reads and historical SQL surfaces. Active app/runtime code should prefer relationship_intent and use looking_for only as a compatibility fallback.';

COMMENT ON COLUMN public.profiles.bunny_video_status IS
  'Canonical profile-level snapshot of the backend-owned vibe-video pipeline state: none | uploading | processing | ready | failed.';

COMMENT ON COLUMN public.profiles.vibe_video_status IS
  'DEPRECATED legacy vibe-video status column. Active web/native/backend runtime uses public.profiles.bunny_video_status instead. Retained temporarily for compatibility and historical schema stability.';
