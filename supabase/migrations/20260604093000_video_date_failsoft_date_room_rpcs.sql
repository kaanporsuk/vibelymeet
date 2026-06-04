-- Video Date — fail-soft the date-room hot RPCs + backfill canonical room metadata.
--
-- PRODUCTION SYMPTOM (2026-06-04): both participants reach the Ready Gate, mark ready,
-- but the date never starts. The UI cycles lobby -> "Opening your date" -> "You're both
-- here" -> handshake -> verdict -> lobby, Daily logs "producer not found for track
-- cam-video", and the Network tab shows HTTP 500 from video_date_transition,
-- claim_video_date_surface, mark_video_date_daily_joined (date room) plus
-- video_session_mark_ready_v2 / get_profile_for_viewer (lobby).
--
-- ROOT CAUSE (two layers):
--   Layer 1 (cycling): split-ready mark_ready NULLs daily_room_name/url on the
--     video_sessions row (rgt_preserve_warmup_base_v1). When the row is roomless at
--     both_ready, client route truth (canAttemptDailyRoomFromVideoSessionTruth) returns
--     false -> SessionRouteHydration bounces /date -> lobby -> ReadyGate remount storm ->
--     the two peers never co-occupy the Daily room. Write-side re-derive shipped in
--     20260603193000 / 20260603215948, but stuck rows from before the fix remain, and the
--     race can still expose a transient NULL.
--   Layer 2 (500 cascade): video_date_transition / claim_video_date_surface /
--     mark_video_date_daily_joined have NO EXCEPTION WHEN OTHERS wrapper (unlike the lobby
--     RPCs hardened in 20260603150106). claim_* and mark_* take SELECT ... FOR UPDATE row
--     locks; under the remount-storm retry pressure they contend on the same video_sessions
--     row -> statement timeout (57014) / lock waits -> raw 500. With no handler, any error
--     in the transition path surfaces as 500 instead of a structured, retryable result.
--
-- THIS MIGRATION (fix-forward, neutralizes timeout/permission/divergence at once):
--   Part A — wrap the three date-room RPCs in the established fail-soft idiom
--     (idempotent guarded rename to a dated _base + thin EXCEPTION WHEN OTHERS wrapper that
--     returns structured { ok:false, retryable:true, sqlstate, message }). Raw 500s become
--     200 + retryable JSON; any residual failure is now self-diagnosing in the response body.
--   Part B — one-time, NULL-only, non-destructive backfill of canonical Daily room metadata
--     for currently-stuck active sessions, reusing video_date_restore_canonical_room_metadata_v1
--     (20260603215948). Read determinism for the route decision is handled client-side
--     (canAttemptDailyRoomFromVideoSessionTruth derives the deterministic date-<id> room) so
--     the 356-line get_video_date_start_snapshot_v1 is left untouched (no drift risk).
--
-- Idempotent: guarded renames use to_regprocedure() so a re-applied/partial push cannot
-- corrupt the chain (the prior migrations' bare ALTER ... RENAME are not re-run-safe).
-- Introduces NO new config, secret, table, or provider dependency. Touches only these three
-- public functions and their new _base siblings; performs one bounded data backfill.

BEGIN;

-- ============================================================================
-- Part A.1 — video_date_transition(uuid, text, text)
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure(
       'public.video_date_transition_20260604093000_failsoft_base(uuid, text, text)'
     ) IS NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260604093000_failsoft_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.video_date_transition_20260604093000_failsoft_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260604093000_failsoft_base(uuid, text, text)
  TO service_role;

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
DECLARE
  v_result jsonb;
  v_message text;
  v_server_now_ms bigint;
BEGIN
  v_result := public.video_date_transition_20260604093000_failsoft_base(
    p_session_id,
    p_action,
    p_reason
  );
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'video_date_transition_failed',
      'reason', 'video_date_transition_failed',
      'code', 'VIDEO_DATE_TRANSITION_FAILED',
      'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_ms', 1500,
      'retry_after_seconds', 2,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical Video Date transition RPC. Fail-soft wrapper: delegates to the prior stack and converts any uncaught backend error (timeout/lock/divergence) into a structured retryable result instead of an HTTP 500.';

-- ============================================================================
-- Part A.2 — claim_video_date_surface(uuid, text, text, boolean, integer)
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure(
       'public.claim_video_date_surface_20260604093000_failsoft_base(uuid, text, text, boolean, integer)'
     ) IS NULL THEN
    ALTER FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
      RENAME TO claim_video_date_surface_20260604093000_failsoft_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface_20260604093000_failsoft_base(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface_20260604093000_failsoft_base(uuid, text, text, boolean, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_video_date_surface(
  p_session_id uuid,
  p_surface text,
  p_client_instance_id text,
  p_takeover boolean DEFAULT false,
  p_ttl_seconds integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_message text;
  v_server_now_ms bigint;
BEGIN
  v_result := public.claim_video_date_surface_20260604093000_failsoft_base(
    p_session_id,
    p_surface,
    p_client_instance_id,
    p_takeover,
    p_ttl_seconds
  );
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'surface_claim_failed',
      'code', 'SURFACE_CLAIM_FAILED',
      'error_code', 'SURFACE_CLAIM_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Dup-tab Video Date surface claim. Fail-soft wrapper: converts uncaught backend errors into a structured retryable result (code SURFACE_CLAIM_FAILED) so the dup-tab guard never sees a raw 500 and does not false-close on transient contention.';

-- ============================================================================
-- Part A.3 — mark_video_date_daily_joined(uuid)
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure(
       'public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_joined(uuid)
      RENAME TO mark_video_date_daily_joined_20260604093000_failsoft_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_message text;
  v_server_now_ms bigint;
BEGIN
  v_result := public.mark_video_date_daily_joined_20260604093000_failsoft_base(p_session_id);
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'daily_join_stamp_failed',
      'code', 'DAILY_JOIN_STAMP_FAILED',
      'error_code', 'DAILY_JOIN_STAMP_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid) IS
  'Idempotent Daily join stamp for routeable Video Date sessions. Fail-soft wrapper: converts uncaught backend errors (e.g. row-lock timeout under retry pressure) into a structured retryable result instead of an HTTP 500.';

-- ============================================================================
-- Part B — one-time, NULL-only canonical room-metadata backfill for stuck rows.
-- Reuses the deterministic repair from 20260603215948. Non-destructive: only fills
-- rows that are active (not ended) and currently missing name or url; the repair
-- function itself no-ops when the row already holds the canonical date-<id> room.
-- ============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state::text IN ('ready_gate', 'handshake', 'date')
      AND (daily_room_name IS NULL OR daily_room_url IS NULL)
  LOOP
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      r.id,
      'failsoft_backfill_20260604093000'
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
