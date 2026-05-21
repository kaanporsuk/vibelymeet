-- Vibely Video Date v4 Phase 6.3-6.4:
-- - Safety always-on is client-consumed; backend safety v2 remains the authority.
-- - Mutual extension requests are server-owned and charge only after both people
--   consent. The applying participant pays. Applied extensions still write to video_date_credit_extension_spends
--   so refund_failed_video_date remains the single refund engine.

CREATE TABLE IF NOT EXISTS public.video_date_extension_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credit_type text NOT NULL CHECK (credit_type IN ('extra_time', 'extended_vibe')),
  added_seconds integer NOT NULL CHECK (added_seconds IN (120, 300)),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'expired', 'failed', 'cancelled')),
  partner_request_id uuid NULL REFERENCES public.video_date_extension_requests(id) ON DELETE SET NULL,
  applied_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  failure_reason text NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 seconds'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NULL,
  UNIQUE (session_id, requester_id, idempotency_key)
);

ALTER TABLE public.video_date_extension_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.video_date_extension_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.video_date_extension_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_video_date_extension_requests_pending
  ON public.video_date_extension_requests(session_id, credit_type, expires_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_video_date_extension_requests_requester
  ON public.video_date_extension_requests(session_id, requester_id, status, expires_at);

COMMENT ON TABLE public.video_date_extension_requests IS
  'Server-owned mutual Video Date extension requests. Pending rows never charge credits; the applying participant pays when the second consent arrives, and applied rows write the canonical spend ledger.';

CREATE OR REPLACE FUNCTION public.video_session_request_extension_v2(
  p_session_id uuid,
  p_credit_type text,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
  v_add_seconds integer;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_request jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_actor_request public.video_date_extension_requests%ROWTYPE;
  v_partner_request public.video_date_extension_requests%ROWTYPE;
  v_partner_id uuid;
  v_required_until timestamptz;
  v_new_total integer;
  v_rows integer;
  v_event jsonb := '{}'::jsonb;
  v_result jsonb;
  v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_add_seconds := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add_seconds IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_credit_type');
  END IF;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_idempotency_key');
  END IF;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_actor IS DISTINCT FROM v_before.participant_1_id
     AND v_actor IS DISTINCT FROM v_before.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.state::text = 'ended'
     OR v_before.phase = 'ended' THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_ended');
  END IF;

  IF v_before.date_started_at IS NULL
     OR (v_before.state::text IS DISTINCT FROM 'date' AND v_before.phase IS DISTINCT FROM 'date') THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_in_date_phase');
  END IF;

  v_partner_id := CASE
    WHEN v_actor = v_before.participant_1_id THEN v_before.participant_2_id
    ELSE v_before.participant_1_id
  END;

  v_request := jsonb_build_object(
    'action', 'extension_mutual',
    'credit_type', v_credit_type
  );

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'extension_mutual',
    v_key,
    v_request,
    p_request_hash
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
      'ok', false,
      'success', false,
      'commandStatus', COALESCE(v_begin->>'status', 'rejected')
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash',
      'date_extra_seconds', COALESCE(v_after.date_extra_seconds, (COALESCE(v_begin->'result', '{}'::jsonb)->>'date_extra_seconds')::integer),
      'session_seq', COALESCE(v_after.session_seq, (COALESCE(v_begin->'result', '{}'::jsonb)->>'session_seq')::bigint)
    );
  END IF;

  IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
      'retryable', true,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  UPDATE public.video_date_extension_requests
  SET status = 'expired',
      failure_reason = COALESCE(failure_reason, 'request_expired'),
      updated_at = v_now
  WHERE session_id = p_session_id
    AND status = 'pending'
    AND expires_at <= v_now;

  SELECT *
  INTO v_partner_request
  FROM public.video_date_extension_requests
  WHERE session_id = p_session_id
    AND requester_id = v_partner_id
    AND credit_type = v_credit_type
    AND status = 'pending'
    AND expires_at > v_now
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_date_extension_requests
    SET status = 'expired',
        failure_reason = COALESCE(failure_reason, 'replaced_by_new_request'),
        updated_at = v_now
    WHERE session_id = p_session_id
      AND requester_id = v_actor
      AND status = 'pending';

    INSERT INTO public.video_date_extension_requests (
      session_id,
      requester_id,
      credit_type,
      added_seconds,
      idempotency_key,
      status,
      expires_at
    )
    VALUES (
      p_session_id,
      v_actor,
      v_credit_type,
      v_add_seconds,
      v_key,
      'pending',
      v_now + interval '45 seconds'
    )
    RETURNING *
    INTO v_actor_request;

    v_event := public.append_video_session_event_v2(
      p_session_id,
      'date_extension_requested',
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'extension_mutual_requested',
        'credit_type', v_credit_type,
        'added_seconds', v_add_seconds,
        'request_expires_at', v_actor_request.expires_at
      ),
      jsonb_build_object(
        'credit_type', v_credit_type,
        'added_seconds', v_add_seconds,
        'request_expires_at', v_actor_request.expires_at
      ),
      true,
      gen_random_uuid()
    );

    v_result := jsonb_build_object(
      'ok', true,
      'success', true,
      'backend_version', 'v2',
      'mutual', true,
      'awaiting_partner', true,
      'applied', false,
      'added_seconds', 0,
      'request_expires_at', v_actor_request.expires_at,
      'commandStatus', 'committed',
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash',
      'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_before.session_seq)
    );

    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.video_date_extension_requests
  SET status = 'expired',
      failure_reason = COALESCE(failure_reason, 'accepted_different_request'),
      updated_at = v_now
  WHERE session_id = p_session_id
    AND requester_id = v_actor
    AND status = 'pending';

  v_required_until :=
    v_before.date_started_at
    + ((300 + COALESCE(v_before.date_extra_seconds, 0) + v_add_seconds + 120 + 600) * interval '1 second');

  IF v_before.daily_room_expires_at IS NULL OR v_before.daily_room_expires_at <= v_required_until THEN
    UPDATE public.video_date_extension_requests
    SET status = 'failed',
        failure_reason = 'daily_room_expiring_before_extension',
        updated_at = v_now
    WHERE id = v_partner_request.id;

    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'daily_room_expiring_before_extension',
      'room_refresh_required', true,
      'required_until', v_required_until,
      'daily_room_expires_at', v_before.daily_room_expires_at,
      'mutual', true,
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash'
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result;
  END IF;

  IF v_credit_type = 'extra_time' THEN
    UPDATE public.user_credits
    SET extra_time_credits = extra_time_credits - 1
    WHERE user_id = v_actor
      AND extra_time_credits > 0;
  ELSE
    UPDATE public.user_credits
    SET extended_vibe_credits = extended_vibe_credits - 1
    WHERE user_id = v_actor
      AND extended_vibe_credits > 0;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.video_date_extension_requests (
      session_id,
      requester_id,
      credit_type,
      added_seconds,
      idempotency_key,
      status,
      partner_request_id,
      applied_by,
      failure_reason,
      expires_at
    )
    VALUES (
      p_session_id,
      v_actor,
      v_credit_type,
      v_add_seconds,
      v_key,
      'failed',
      v_partner_request.id,
      v_actor,
      'insufficient_credits',
      v_now
    );

    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'insufficient_credits',
      'mutual', true,
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash'
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.video_sessions
  SET
    date_extra_seconds = COALESCE(date_extra_seconds, 0) + v_add_seconds,
    state_updated_at = v_now
  WHERE id = p_session_id
  RETURNING *
  INTO v_after;

  v_new_total := COALESCE(v_after.date_extra_seconds, 0);

  INSERT INTO public.video_date_extension_requests (
    session_id,
    requester_id,
    credit_type,
    added_seconds,
    idempotency_key,
    status,
    partner_request_id,
    applied_by,
    expires_at,
    applied_at
  )
  VALUES (
    p_session_id,
    v_actor,
    v_credit_type,
    v_add_seconds,
    v_key,
    'applied',
    v_partner_request.id,
    v_actor,
    v_now,
    v_now
  )
  RETURNING *
  INTO v_actor_request;

  UPDATE public.video_date_extension_requests
  SET status = 'applied',
      partner_request_id = v_actor_request.id,
      applied_by = v_actor,
      applied_at = v_now,
      updated_at = v_now
  WHERE id = v_partner_request.id;

  INSERT INTO public.video_date_credit_extension_spends (
    session_id,
    user_id,
    credit_type,
    idempotency_key,
    added_seconds,
    date_extra_seconds_after
  )
  VALUES (
    p_session_id,
    v_actor,
    v_credit_type,
    'mutual:' || v_partner_request.id::text || ':' || v_actor_request.id::text,
    v_add_seconds,
    v_new_total
  );

  v_event := public.append_video_session_event_v2(
    p_session_id,
    'date_extension_applied',
    'participants',
    v_actor,
    jsonb_build_object(
      'action', 'extension_mutual_applied',
      'credit_type', v_credit_type,
      'added_seconds', v_add_seconds,
      'date_extra_seconds', v_new_total,
      'mutual', true
    ),
    jsonb_build_object(
      'credit_type', v_credit_type,
      'added_seconds', v_add_seconds,
      'date_extra_seconds', v_new_total,
      'mutual', true
    ),
    true,
    gen_random_uuid()
  );

  v_result := jsonb_build_object(
    'ok', true,
    'success', true,
    'backend_version', 'v2',
    'mutual', true,
    'awaiting_partner', false,
    'applied', true,
    'added_seconds', v_add_seconds,
    'date_extra_seconds', v_new_total,
    'commandStatus', 'committed',
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash',
    'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_after.session_seq)
  );

  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_request_extension_v2(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_request_extension_v2(uuid, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_request_extension_v2(uuid, text, text, text) IS
  'Phase 6.4 mutual extension command. First tap creates a participant-visible pending request; second participant tap applies the extension, charges the applying participant once, writes the canonical spend ledger, and refuses charge if Daily room expiry cannot cover the full budget.';

CREATE OR REPLACE VIEW public.vw_video_date_extension_mutual_health
WITH (security_invoker = true)
AS
SELECT
  vs.event_id,
  count(*) FILTER (WHERE req.status = 'pending')::integer AS pending_requests,
  count(*) FILTER (WHERE req.status = 'pending' AND req.expires_at <= now())::integer AS stale_pending_requests,
  count(*) FILTER (WHERE req.status = 'applied')::integer AS applied_requests,
  count(*) FILTER (WHERE req.status = 'failed')::integer AS failed_requests,
  count(*) FILTER (WHERE req.status = 'failed' AND req.failure_reason = 'daily_room_expiring_before_extension')::integer AS room_expiry_failures,
  count(*) FILTER (WHERE req.status = 'failed' AND req.failure_reason = 'insufficient_credits')::integer AS insufficient_credit_failures,
  count(*) FILTER (WHERE req.status = 'expired')::integer AS expired_requests,
  max(req.created_at) AS last_request_at,
  max(req.applied_at) AS last_applied_at
FROM public.video_date_extension_requests req
JOIN public.video_sessions vs ON vs.id = req.session_id
GROUP BY vs.event_id;

REVOKE ALL ON TABLE public.vw_video_date_extension_mutual_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_extension_mutual_health TO service_role;

COMMENT ON VIEW public.vw_video_date_extension_mutual_health IS
  'Service-role health rollup for Phase 6.4 mutual extension requests, including stale pending requests and charge-blocking failure classes.';

CREATE OR REPLACE VIEW public.vw_video_date_extension_refund_certification
WITH (security_invoker = true)
AS
SELECT
  vs.id AS session_id,
  vs.event_id,
  vs.ended_reason,
  vs.refund_status,
  vs.refund_granted_at,
  count(sp.id)::integer AS extension_spend_count,
  count(sp.id) FILTER (WHERE sp.credit_type = 'extra_time')::integer AS extra_time_spend_count,
  count(sp.id) FILTER (WHERE sp.credit_type = 'extended_vibe')::integer AS extended_vibe_spend_count,
  bool_or(sp.idempotency_key LIKE 'mutual:%') AS has_mutual_extension_spend,
  vs.refund_breakdown
FROM public.video_sessions vs
LEFT JOIN public.video_date_credit_extension_spends sp ON sp.session_id = vs.id
GROUP BY vs.id, vs.event_id, vs.ended_reason, vs.refund_status, vs.refund_granted_at, vs.refund_breakdown;

REVOKE ALL ON TABLE public.vw_video_date_extension_refund_certification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_extension_refund_certification TO service_role;

COMMENT ON VIEW public.vw_video_date_extension_refund_certification IS
  'Service-role certification view proving all one-sided and mutual extension charges are visible to the canonical refund_failed_video_date ledger path.';
