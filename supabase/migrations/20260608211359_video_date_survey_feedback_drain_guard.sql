-- Video Date survey feedback drain guard.
--
-- Queue drain must never advance a participant to another Ready Gate before
-- their current survey-required Video Date has an actor-owned date_feedback row.
-- This wraps both public drain RPC names and closes direct authenticated writes
-- to the mandatory verdict table so web, native, and mobile-web callers share
-- the same backend finish-line rule.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.drain_match_queue_v2_20260608211359_survey_feedback_base(uuid, text)') IS NULL
     AND to_regprocedure('public.drain_match_queue_v2(uuid, text)') IS NOT NULL THEN
    ALTER FUNCTION public.drain_match_queue_v2(uuid, text)
      RENAME TO drain_match_queue_v2_20260608211359_survey_feedback_base;
  END IF;

  IF to_regprocedure('public.drain_match_queue_20260608211359_survey_feedback_base(uuid)') IS NULL
     AND to_regprocedure('public.drain_match_queue(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.drain_match_queue(uuid)
      RENAME TO drain_match_queue_20260608211359_survey_feedback_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.drain_match_queue_v2_20260608211359_survey_feedback_base(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drain_match_queue_v2_20260608211359_survey_feedback_base(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.drain_match_queue_20260608211359_survey_feedback_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drain_match_queue_20260608211359_survey_feedback_base(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_actor_pending_feedback_gate_v1(
  p_event_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := COALESCE(p_actor_id, auth.uid());
  v_pending record;
  v_path text;
BEGIN
  IF v_actor IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'success', true, 'blocked', false);
  END IF;

  SELECT
    vs.id AS session_id,
    vs.event_id,
    partner.partner_id,
    er.id AS registration_id,
    er.queue_status,
    vs.ended_at,
    vs.ended_reason
  INTO v_pending
  FROM public.video_sessions vs
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN vs.participant_1_id = v_actor THEN vs.participant_2_id
      WHEN vs.participant_2_id = v_actor THEN vs.participant_1_id
      ELSE NULL::uuid
    END AS partner_id
  ) partner
  LEFT JOIN public.event_registrations er
    ON er.event_id = vs.event_id
   AND er.profile_id = v_actor
  WHERE vs.event_id = p_event_id
    AND partner.partner_id IS NOT NULL
    AND public.video_date_session_is_post_date_survey_eligible_v2(
      vs.ended_at,
      vs.ended_reason,
      vs.date_started_at,
      vs.state::text,
      vs.phase,
      vs.participant_1_joined_at,
      vs.participant_2_joined_at,
      vs.participant_1_remote_seen_at,
      vs.participant_2_remote_seen_at
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.date_feedback df
      WHERE df.session_id = vs.id
        AND df.user_id = v_actor
    )
    AND NOT public.is_blocked(v_actor, partner.partner_id)
    AND NOT public.is_blocked(partner.partner_id, v_actor)
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_actor AND ur.reported_id = partner.partner_id)
         OR (ur.reporter_id = partner.partner_id AND ur.reported_id = v_actor)
    )
  ORDER BY
    COALESCE(vs.ended_at, vs.state_updated_at, vs.created_at) DESC,
    vs.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'success', true, 'blocked', false);
  END IF;

  v_path := '/date/' || v_pending.session_id::text;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'found', false,
    'queued', false,
    'blocked', true,
    'reason', 'pending_post_date_feedback',
    'code', 'PENDING_POST_DATE_FEEDBACK',
    'error_code', 'PENDING_POST_DATE_FEEDBACK',
    'retryable', false,
    'session_id', v_pending.session_id,
    'video_session_id', v_pending.session_id,
    'event_id', v_pending.event_id,
    'partner_id', v_pending.partner_id,
    'route', v_path,
    'path', v_path,
    'next_surface', jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'path', v_path,
      'session_id', v_pending.session_id,
      'event_id', v_pending.event_id,
      'target_id', v_pending.partner_id,
      'reason', 'pending_post_date_feedback'
    ),
    'feedback_gate', jsonb_build_object(
      'registration_id', v_pending.registration_id,
      'queue_status', v_pending.queue_status,
      'ended_at', v_pending.ended_at,
      'ended_reason', v_pending.ended_reason
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_actor_pending_feedback_gate_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_actor_pending_feedback_gate_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_actor_pending_feedback_gate_v1(uuid, uuid) IS
  'Service-only Video Date queue-drain guard. Returns pending_post_date_feedback when the actor has any same-event survey-eligible ended session without their date_feedback row.';

CREATE OR REPLACE FUNCTION public.drain_match_queue_v2(
  p_event_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_actor uuid := auth.uid();
  v_gate jsonb;
  v_message text;
  v_detail text;
  v_hint text;
  v_retryable boolean;
BEGIN
  v_gate := public.video_date_actor_pending_feedback_gate_v1(p_event_id, v_actor);

  IF COALESCE((v_gate->>'blocked')::boolean, false)
     AND v_gate->>'reason' = 'pending_post_date_feedback' THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    BEGIN
      PERFORM public.record_event_loop_observability(
        'drain_match_queue_v2',
        'blocked',
        'pending_post_date_feedback',
        v_ms,
        p_event_id,
        v_actor,
        (v_gate->>'session_id')::uuid,
        jsonb_build_object(
          'idempotency_key', p_idempotency_key,
          'source', 'survey_feedback_drain_guard',
          'next_surface', v_gate->'next_surface'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN v_gate || jsonb_build_object(
      'commandStatus', 'rejected',
      'drain_blocked', true
    );
  END IF;

  RETURN public.drain_match_queue_v2_20260608211359_survey_feedback_base(
    p_event_id,
    p_idempotency_key
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_retryable := SQLSTATE IS DISTINCT FROM '42501';
    RETURN jsonb_build_object(
      'ok', false,
      'found', false,
      'success', false,
      'error', 'drain_match_queue_failed',
      'reason', 'drain_match_queue_failed',
      'code', 'DRAIN_MATCH_QUEUE_FAILED',
      'error_code', 'DRAIN_MATCH_QUEUE_FAILED',
      'commandStatus', CASE WHEN v_retryable THEN 'retryable_error' ELSE 'error' END,
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', v_retryable,
      'retry_after_ms', 1500
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.drain_match_queue(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_actor uuid := auth.uid();
  v_key text;
  v_gate jsonb;
  v_message text;
  v_detail text;
  v_hint text;
  v_retryable boolean;
BEGIN
  v_gate := public.video_date_actor_pending_feedback_gate_v1(p_event_id, v_actor);

  IF COALESCE((v_gate->>'blocked')::boolean, false)
     AND v_gate->>'reason' = 'pending_post_date_feedback' THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    BEGIN
      PERFORM public.record_event_loop_observability(
        'drain_match_queue',
        'blocked',
        'pending_post_date_feedback',
        v_ms,
        p_event_id,
        v_actor,
        (v_gate->>'session_id')::uuid,
        jsonb_build_object(
          'source', 'survey_feedback_drain_guard',
          'next_surface', v_gate->'next_surface'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN v_gate || jsonb_build_object(
      'commandStatus', 'rejected',
      'drain_blocked', true,
      'legacy_wrapper', true
    );
  END IF;

  v_key :=
    'legacy:' ||
    p_event_id::text ||
    ':' ||
    COALESCE(v_actor::text, 'anon') ||
    ':' ||
    (floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000))::bigint::text ||
    ':' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  RETURN public.drain_match_queue_v2_20260608211359_survey_feedback_base(
    p_event_id,
    v_key
  ) || jsonb_build_object('legacy_wrapper', true);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_retryable := SQLSTATE IS DISTINCT FROM '42501';
    RETURN jsonb_build_object(
      'ok', false,
      'found', false,
      'success', false,
      'error', 'drain_match_queue_failed',
      'reason', 'drain_match_queue_failed',
      'code', 'DRAIN_MATCH_QUEUE_FAILED',
      'error_code', 'DRAIN_MATCH_QUEUE_FAILED',
      'commandStatus', CASE WHEN v_retryable THEN 'retryable_error' ELSE 'error' END,
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', v_retryable,
      'retry_after_ms', 1500,
      'legacy_wrapper', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue_v2(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drain_match_queue_v2(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.drain_match_queue(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drain_match_queue(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue_v2(uuid, text) IS
  'Queue-drain v2 public wrapper. Blocks Ready Gate promotion with pending_post_date_feedback until the actor submits date_feedback for any same-event survey-required Video Date.';

COMMENT ON FUNCTION public.drain_match_queue(uuid) IS
  'Legacy queue-drain compatibility wrapper over the guarded v2 drain contract; preserves legacy_wrapper while enforcing pending_post_date_feedback.';

ALTER TABLE public.date_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.date_feedback FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.date_feedback
  FROM authenticated;
GRANT SELECT ON TABLE public.date_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.date_feedback TO service_role;

DROP POLICY IF EXISTS "Users can create own feedback"
  ON public.date_feedback;
DROP POLICY IF EXISTS "Users can update own feedback"
  ON public.date_feedback;

COMMENT ON TABLE public.date_feedback IS
  'Post-date verdict and optional survey details. Authenticated clients may read their RLS-visible rows, but mandatory verdict writes are backend-owned through submit_post_date_verdict_v3/post-date-verdict and optional patches through update_post_date_feedback_details.';

COMMIT;
