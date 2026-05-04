-- Track trusted Daily room freshness proof for room-only Ready Gate warmup.
-- This does not make a video date routeable and does not issue tokens.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS daily_room_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_room_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_room_provider_verify_reason text;

COMMENT ON COLUMN public.video_sessions.daily_room_verified_at IS
  'Most recent trusted Daily provider room verification/creation timestamp for deterministic video-date room warmup.';

COMMENT ON COLUMN public.video_sessions.daily_room_expires_at IS
  'Provider room expiry observed or assigned during the most recent trusted Daily room verification.';

COMMENT ON COLUMN public.video_sessions.daily_room_provider_verify_reason IS
  'Reason/source for the latest Daily room verification proof, e.g. provider_room_exists, provider_missing, or fresh_provider_room_proof.';
