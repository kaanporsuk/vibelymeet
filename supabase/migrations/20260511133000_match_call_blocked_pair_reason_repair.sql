-- Preserve server-owned block and archive/unmatch terminal reasons after the
-- match-call end-reason expansion. This is safe to run even when the previous
-- migration was already corrected locally before being pushed.

ALTER TABLE public.match_calls
  DROP CONSTRAINT IF EXISTS match_calls_ended_reason_check;

ALTER TABLE public.match_calls
  ADD CONSTRAINT match_calls_ended_reason_check
  CHECK (
    ended_reason IS NULL
    OR ended_reason IN (
      'declined',
      'hangup',
      'caller_cancelled',
      'missed',
      'timeout',
      'join_failed',
      'stale_active',
      'provider_error',
      'blocked_pair',
      'unmatched_pair',
      'busy',
      'connection_lost',
      'media_failure'
    )
  );
