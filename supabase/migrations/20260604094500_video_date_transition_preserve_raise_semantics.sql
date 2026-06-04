-- Video Date — preserve raise/retry semantics for video_date_transition.
--
-- Follow-up to 20260604093000. That migration wrapped video_date_transition,
-- claim_video_date_surface and mark_video_date_daily_joined in a fail-soft
-- EXCEPTION WHEN OTHERS handler that returns 200 + { ok:false, retryable:true }
-- instead of raising. For claim_* (dup-tab guard keys off SURFACE_CLAIM_CONFLICT,
-- not the new SURFACE_CLAIM_FAILED) and mark_* (markDailyJoinedWithBackoff now reads
-- payload.retryable) that is safe and desirable.
--
-- For video_date_transition it is NOT safe: its callers treat an RPC error as the
-- retry signal and a 200 result *without* a `state` field as terminal:
--   * src/pages/VideoDate.tsx schedules a retry only on `error || !result`; a
--     non-null { success:false } payload (no `state`) falls through to the
--     non-mutual branch and ends the call.
--   * apps/mobile/lib/videoDateApi.ts converts a missing `state` to `ended`.
-- So fail-softing this RPC would convert a transient timeout/lock into a spurious
-- call-end on web and native (P1, flagged on PR #1185).
--
-- FIX (bot-recommended option A: "keep throwing for video_date_transition"):
-- redefine the public wrapper to transparently delegate to the fail-soft base body
-- WITHOUT catching, so any uncaught backend error propagates as an RPC error again
-- and every existing caller retries exactly as before. The renamed base
-- (video_date_transition_20260604093000_failsoft_base) is the original
-- post-processing body and is unchanged. claim_* and mark_* remain fail-soft.
--
-- Idempotent (CREATE OR REPLACE). No data changes. No new config/secret/table.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Transparent delegate: errors propagate to the caller (HTTP error) so the
  -- existing web/native retry paths trigger. Do NOT add EXCEPTION WHEN OTHERS here.
  RETURN public.video_date_transition_20260604093000_failsoft_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical Video Date transition RPC. Transparent delegate to the prior stack: backend errors propagate as RPC errors so web/native callers retry (they treat a 200 payload without a state field as terminal). Fail-soft wrapping is intentionally limited to claim_video_date_surface and mark_video_date_daily_joined (20260604093000).';

NOTIFY pgrst, 'reload schema';

COMMIT;
