-- Phase 5: hardened outbox/finalizer invariants, webhook DLQ, safety-aware cleanup,
-- and circuit-breaker decision surfaces.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  ('video_date.outbox_lease_refresh_v2', false, 0, 'Provider outbox row lease refresh and stuck-claim rollback guardrails.', false),
  ('video_date.deadline_partial_unique_v2', false, 0, 'Active deadline partial uniqueness and finalizer duplicate protection.', false),
  ('video_date.orphan_safety_interlock_v2', false, 0, 'Safety-evidence-aware Daily orphan room cleanup interlock.', false),
  ('video_date.circuit_breaker_v2', false, 0, 'Service-role video-date reliability circuit-breaker decision and rollback surface.', false)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE INDEX IF NOT EXISTS idx_vdpo_state_kind_active
  ON public.video_date_provider_outbox(state, kind)
  WHERE state IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_vsd_state_kind_active
  ON public.video_session_deadlines(state, kind)
  WHERE state IN ('pending', 'claimed');

CREATE TEMP TABLE IF NOT EXISTS phase5_duplicate_video_session_deadlines (
  id bigint PRIMARY KEY
) ON COMMIT DROP;

TRUNCATE phase5_duplicate_video_session_deadlines;

INSERT INTO phase5_duplicate_video_session_deadlines (id)
SELECT id
FROM (
  SELECT
    d.id,
    row_number() OVER (
      PARTITION BY d.session_id, d.kind
      ORDER BY
        CASE d.state WHEN 'claimed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        d.due_at ASC,
        d.id ASC
    ) AS rn
  FROM public.video_session_deadlines d
  WHERE d.state IN ('pending', 'claimed')
) ranked
WHERE ranked.rn > 1;

UPDATE public.video_session_deadlines d
SET
  state = 'failed',
  last_error = 'phase5_duplicate_active_deadline_retired',
  claimed_at = NULL,
  claim_expires_at = NULL,
  claimed_by = NULL,
  updated_at = now()
WHERE d.id IN (
  SELECT duplicates.id
  FROM phase5_duplicate_video_session_deadlines duplicates
);

DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.video_session_deadlines'::regclass
      AND c.contype = 'u'
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(c.conkey) WITH ORDINALITY AS key_cols(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = key_cols.attnum
        ORDER BY key_cols.ordinality
      ) = ARRAY['session_id', 'kind']::text[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.video_session_deadlines DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS video_session_deadlines_active_session_kind_uidx
  ON public.video_session_deadlines(session_id, kind)
  WHERE state IN ('pending', 'claimed');

COMMENT ON INDEX public.video_session_deadlines_active_session_kind_uidx IS
  'Allows historical terminal deadline rows while enforcing exactly one active pending/claimed deadline per session/kind.';

DROP POLICY IF EXISTS "Safety review video session events require staff"
  ON public.video_session_events;
CREATE POLICY "Safety review video session events require staff"
  ON public.video_session_events
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    visibility <> 'safety_review'
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

CREATE TABLE IF NOT EXISTS public.video_date_webhook_dlq (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text,
  event_type text,
  room_name text,
  payload_hash text NOT NULL,
  sanitized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_class text NOT NULL,
  error_message text,
  retryable boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'retrying', 'resolved', 'ignored')),
  next_retry_at timestamptz,
  signature_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_webhook_dlq_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT video_date_webhook_dlq_provider_len CHECK (char_length(provider) <= 40),
  CONSTRAINT video_date_webhook_dlq_provider_event_id_len CHECK (provider_event_id IS NULL OR char_length(provider_event_id) <= 500),
  CONSTRAINT video_date_webhook_dlq_event_type_len CHECK (event_type IS NULL OR char_length(event_type) <= 120),
  CONSTRAINT video_date_webhook_dlq_room_name_len CHECK (room_name IS NULL OR char_length(room_name) <= 180),
  CONSTRAINT video_date_webhook_dlq_hash_len CHECK (char_length(payload_hash) BETWEEN 32 AND 128),
  CONSTRAINT video_date_webhook_dlq_error_class_not_blank CHECK (btrim(error_class) <> ''),
  CONSTRAINT video_date_webhook_dlq_error_class_len CHECK (char_length(error_class) <= 120),
  CONSTRAINT video_date_webhook_dlq_payload_object CHECK (jsonb_typeof(sanitized_payload) = 'object'),
  CONSTRAINT video_date_webhook_dlq_no_secret_keys CHECK (NOT public.video_date_jsonb_has_secret_key(sanitized_payload))
);

CREATE UNIQUE INDEX IF NOT EXISTS video_date_webhook_dlq_provider_payload_error_uidx
  ON public.video_date_webhook_dlq(provider, payload_hash, error_class);

CREATE INDEX IF NOT EXISTS idx_video_date_webhook_dlq_state
  ON public.video_date_webhook_dlq(state, next_retry_at, created_at DESC)
  WHERE state IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_video_date_webhook_dlq_provider_event
  ON public.video_date_webhook_dlq(provider, provider_event_id, created_at DESC)
  WHERE provider_event_id IS NOT NULL;

ALTER TABLE public.video_date_webhook_dlq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_webhook_dlq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_webhook_dlq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_webhook_dlq_id_seq TO service_role;

COMMENT ON TABLE public.video_date_webhook_dlq IS
  'Service-role Daily webhook dead-letter queue. Stores only sanitized provider metadata and payload hashes; no provider tokens or secrets.';

CREATE OR REPLACE FUNCTION public.record_video_date_webhook_dlq_v1(
  p_provider text,
  p_provider_event_id text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_room_name text DEFAULT NULL,
  p_payload_hash text DEFAULT NULL,
  p_sanitized_payload jsonb DEFAULT '{}'::jsonb,
  p_error_class text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retryable boolean DEFAULT false,
  p_signature_timestamp timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_provider text := left(NULLIF(btrim(COALESCE(p_provider, '')), ''), 40);
  v_provider_event_id text := NULLIF(left(btrim(COALESCE(p_provider_event_id, '')), 500), '');
  v_event_type text := NULLIF(left(btrim(COALESCE(p_event_type, '')), 120), '');
  v_room_name text := NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), '');
  v_payload_hash text := left(NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), 128);
  v_error_class text := left(NULLIF(btrim(COALESCE(p_error_class, '')), ''), 120);
  v_error_message text := NULLIF(left(btrim(COALESCE(p_error_message, '')), 1000), '');
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_sanitized_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_sanitized_payload, '{}'::jsonb)
    ELSE jsonb_build_object('payload_type', jsonb_typeof(p_sanitized_payload))
  END;
  v_row public.video_date_webhook_dlq%ROWTYPE;
BEGIN
  IF v_provider IS NULL OR v_payload_hash IS NULL OR v_error_class IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_webhook_dlq_record');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_payload) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'secret_payload_rejected');
  END IF;

  INSERT INTO public.video_date_webhook_dlq (
    provider,
    provider_event_id,
    event_type,
    room_name,
    payload_hash,
    sanitized_payload,
    error_class,
    error_message,
    retryable,
    state,
    next_retry_at,
    signature_timestamp
  )
  VALUES (
    v_provider,
    v_provider_event_id,
    v_event_type,
    v_room_name,
    v_payload_hash,
    v_payload,
    v_error_class,
    v_error_message,
    COALESCE(p_retryable, false),
    CASE WHEN COALESCE(p_retryable, false) THEN 'retrying' ELSE 'pending' END,
    CASE WHEN COALESCE(p_retryable, false) THEN now() + interval '5 minutes' ELSE NULL END,
    p_signature_timestamp
  )
  ON CONFLICT (provider, payload_hash, error_class) DO UPDATE
  SET
    provider_event_id = COALESCE(EXCLUDED.provider_event_id, public.video_date_webhook_dlq.provider_event_id),
    event_type = COALESCE(EXCLUDED.event_type, public.video_date_webhook_dlq.event_type),
    room_name = COALESCE(EXCLUDED.room_name, public.video_date_webhook_dlq.room_name),
    sanitized_payload = EXCLUDED.sanitized_payload,
    error_message = COALESCE(EXCLUDED.error_message, public.video_date_webhook_dlq.error_message),
    retryable = EXCLUDED.retryable,
    attempts = public.video_date_webhook_dlq.attempts + 1,
    state = CASE WHEN EXCLUDED.retryable THEN 'retrying' ELSE 'pending' END,
    next_retry_at = CASE WHEN EXCLUDED.retryable THEN now() + interval '5 minutes' ELSE NULL END,
    signature_timestamp = COALESCE(EXCLUDED.signature_timestamp, public.video_date_webhook_dlq.signature_timestamp),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'provider', v_row.provider,
    'state', v_row.state,
    'attempts', v_row.attempts,
    'retryable', v_row.retryable
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_webhook_dlq_v1(
  text, text, text, text, text, jsonb, text, text, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_webhook_dlq_v1(
  text, text, text, text, text, jsonb, text, text, boolean, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_webhook_dlq_v1(
  text, text, text, text, text, jsonb, text, text, boolean, timestamptz
) IS
  'Idempotently records signed Daily webhook failures into a sanitized service-role DLQ.';

CREATE OR REPLACE FUNCTION public.video_date_orphan_safety_interlock_v1(
  p_session_id uuid,
  p_room_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_safety_event_count integer := 0;
  v_pending_report_count integer := 0;
  v_latest_safety_at timestamptz;
  v_delay_until timestamptz;
  v_kill_switch_active boolean := false;
BEGIN
  SELECT COALESCE(f.kill_switch_active, false)
  INTO v_kill_switch_active
  FROM public.client_feature_flags f
  WHERE f.flag_key = 'video_date.orphan_safety_interlock_v2';

  IF COALESCE(v_kill_switch_active, false) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'blocked', false,
      'reason', 'interlock_kill_switch_active'
    );
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'blocked', false, 'reason', 'session_id_missing');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'blocked', false, 'reason', 'session_not_found');
  END IF;

  SELECT
    count(*)::integer,
    max(vse.at)
  INTO v_safety_event_count, v_latest_safety_at
  FROM public.video_session_events vse
  WHERE vse.session_id = p_session_id
    AND vse.visibility = 'safety_review';

  SELECT
    count(*)::integer,
    greatest(
      COALESCE(v_latest_safety_at, '-infinity'::timestamptz),
      COALESCE(max(ur.created_at), '-infinity'::timestamptz)
    )
  INTO v_pending_report_count, v_latest_safety_at
  FROM public.user_reports ur
  WHERE ur.status = 'pending'
    AND (
      (ur.reporter_id = v_session.participant_1_id AND ur.reported_id = v_session.participant_2_id)
      OR (ur.reporter_id = v_session.participant_2_id AND ur.reported_id = v_session.participant_1_id)
    );

  IF v_latest_safety_at IS NULL OR v_latest_safety_at = '-infinity'::timestamptz THEN
    RETURN jsonb_build_object(
      'ok', true,
      'blocked', false,
      'reason', 'no_recent_safety_evidence',
      'safetyReviewEventCount', COALESCE(v_safety_event_count, 0),
      'pendingReportCount', COALESCE(v_pending_report_count, 0)
    );
  END IF;

  v_delay_until := v_latest_safety_at + interval '7 days';
  IF now() < v_delay_until THEN
    RETURN jsonb_build_object(
      'ok', true,
      'blocked', true,
      'reason', 'safety_review_pending',
      'delayUntil', v_delay_until,
      'roomName', NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), ''),
      'safetyReviewEventCount', COALESCE(v_safety_event_count, 0),
      'pendingReportCount', COALESCE(v_pending_report_count, 0),
      'latestSafetyEvidenceAt', v_latest_safety_at
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'blocked', false,
    'reason', 'safety_evidence_retention_elapsed',
    'delayUntil', v_delay_until,
    'safetyReviewEventCount', COALESCE(v_safety_event_count, 0),
    'pendingReportCount', COALESCE(v_pending_report_count, 0),
    'latestSafetyEvidenceAt', v_latest_safety_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_orphan_safety_interlock_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_orphan_safety_interlock_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_orphan_safety_interlock_v1(uuid, text) IS
  'Pre-delete interlock for Daily orphan room cleanup. Delays provider room deletion for seven days after pending safety-review evidence.';

CREATE OR REPLACE FUNCTION public.broadcast_video_session_event_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_catalog'
AS $function$
DECLARE
  v_sanitized_payload jsonb;
  v_payload jsonb;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.visibility IS DISTINCT FROM 'participants' THEN
    RETURN NULL;
  END IF;

  IF public.video_date_broadcast_batched_v2_enabled() THEN
    RETURN NULL;
  END IF;

  v_sanitized_payload := CASE
    WHEN jsonb_typeof(COALESCE(NEW.sanitized_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(NEW.sanitized_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;

  IF v_sanitized_payload = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'id', NEW.id,
    'sessionId', NEW.session_id,
    'sessionSeq', NEW.session_seq,
    'kind', NEW.kind,
    'at', NEW.at,
    'actor', NEW.actor,
    'payload', v_sanitized_payload,
    'correlationId', NEW.correlation_id
  );

  PERFORM realtime.send(
    v_payload,
    'video_session_event',
    'session:' || NEW.session_id::text,
    true
  );

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_video_session_event_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_video_session_event_v2() TO service_role;

COMMENT ON FUNCTION public.broadcast_video_session_event_v2() IS
  'Broadcasts non-empty sanitized participant-visible video_session_events to private session:{uuid} Realtime channels.';

CREATE OR REPLACE FUNCTION public.broadcast_video_session_events_batched_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_catalog'
AS $function$
DECLARE
  v_session record;
BEGIN
  IF TG_OP <> 'INSERT' OR NOT public.video_date_broadcast_batched_v2_enabled() THEN
    RETURN NULL;
  END IF;

  FOR v_session IN
    WITH sanitized AS (
      SELECT
        nr.id,
        nr.session_id,
        nr.session_seq,
        nr.kind,
        nr.at,
        nr.actor,
        CASE
          WHEN jsonb_typeof(COALESCE(nr.sanitized_payload, '{}'::jsonb)) = 'object'
            THEN COALESCE(nr.sanitized_payload, '{}'::jsonb)
          ELSE '{}'::jsonb
        END AS sanitized_payload,
        nr.correlation_id
      FROM new_rows nr
      WHERE nr.visibility = 'participants'
    )
    SELECT
      s.session_id,
      jsonb_agg(
        jsonb_build_object(
          'schemaVersion', 1,
          'id', s.id,
          'sessionId', s.session_id,
          'sessionSeq', s.session_seq,
          'kind', s.kind,
          'at', s.at,
          'actor', s.actor,
          'payload', s.sanitized_payload,
          'correlationId', s.correlation_id
        )
        ORDER BY s.session_seq, s.id
      ) AS events
    FROM sanitized s
    WHERE s.sanitized_payload <> '{}'::jsonb
    GROUP BY s.session_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'schemaVersion', 1,
        'sessionId', v_session.session_id,
        'events', v_session.events
      ),
      'video_session_event',
      'session:' || v_session.session_id::text,
      true
    );
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_video_session_events_batched_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_video_session_events_batched_v2() TO service_role;

COMMENT ON FUNCTION public.broadcast_video_session_events_batched_v2() IS
  'Batches non-empty sanitized participant-visible video_session_events per session into private session:{uuid} Broadcast array envelopes.';

CREATE OR REPLACE VIEW public.vw_video_date_phase5_circuit_breaker_decision
WITH (security_invoker = true) AS
WITH metrics AS (
  SELECT
    COALESCE((
      SELECT count(*)::integer
      FROM public.video_date_provider_outbox o
      WHERE o.state = 'claimed'
        AND COALESCE(o.claim_expires_at, o.claimed_at) < now() - interval '10 minutes'
    ), 0) AS stuck_outbox_claims,
    COALESCE((
      SELECT count(*)::integer
      FROM public.video_session_deadlines d
      WHERE d.state = 'claimed'
        AND COALESCE(d.claim_expires_at, d.claimed_at) < now() - interval '10 minutes'
    ), 0) AS stuck_deadline_claims,
    COALESCE((
      SELECT count(*)::integer
      FROM (
        SELECT session_id, kind
        FROM public.video_session_deadlines
        WHERE state IN ('pending', 'claimed')
        GROUP BY session_id, kind
        HAVING count(*) > 1
      ) duplicates
    ), 0) AS active_deadline_duplicates,
    COALESCE((
      SELECT count(*)::integer
      FROM public.video_date_webhook_dlq dlq
      WHERE dlq.created_at >= now() - interval '15 minutes'
        AND dlq.state IN ('pending', 'retrying')
    ), 0) AS recent_webhook_dlq_rows,
    COALESCE((
      SELECT count(*)::integer
      FROM public.video_date_orphan_room_cleanup_audit audit
      WHERE audit.created_at >= now() - interval '15 minutes'
        AND audit.action = 'skipped_safety_review'
        AND audit.reason = 'safety_interlock_unavailable'
    ), 0) AS recent_safety_interlock_failures
),
decisions AS (
  SELECT
    'video_date.outbox_lease_refresh_v2'::text AS flag_key,
    'provider_outbox'::text AS feature_area,
    metrics.stuck_outbox_claims AS observed_count,
    1 AS trip_threshold,
    'stuck_outbox_claims_over_10m'::text AS reason
  FROM metrics
  UNION ALL
  SELECT
    'video_date.deadline_partial_unique_v2',
    'deadline_finalizer',
    metrics.stuck_deadline_claims + metrics.active_deadline_duplicates,
    1,
    'stuck_deadline_claims_or_active_duplicates'
  FROM metrics
  UNION ALL
  SELECT
    'video_date.orphan_safety_interlock_v2',
    'orphan_room_cleanup',
    metrics.recent_safety_interlock_failures,
    1,
    'safety_interlock_unavailable'
  FROM metrics
  UNION ALL
  SELECT
    'video_date.circuit_breaker_v2',
    'webhook_dlq',
    metrics.recent_webhook_dlq_rows,
    20,
    'webhook_dlq_rows_over_15m'
  FROM metrics
)
SELECT
  d.flag_key,
  d.feature_area,
  d.observed_count,
  d.trip_threshold,
  (d.observed_count >= d.trip_threshold) AS should_disable,
  d.reason,
  '15m'::text AS window_label,
  COALESCE(f.enabled, false) AS current_enabled,
  COALESCE(f.kill_switch_active, false) AS kill_switch_active,
  now() AS evaluated_at
FROM decisions d
LEFT JOIN public.client_feature_flags f
  ON f.flag_key = d.flag_key;

REVOKE ALL ON public.vw_video_date_phase5_circuit_breaker_decision FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_phase5_circuit_breaker_decision TO service_role;

COMMENT ON VIEW public.vw_video_date_phase5_circuit_breaker_decision IS
  'Service-role Phase 5 reliability circuit-breaker decision view for stuck claims, duplicate active deadlines, safety interlock failures, and webhook DLQ spikes.';

CREATE OR REPLACE FUNCTION public.get_video_date_circuit_breaker_decision_v1()
RETURNS TABLE(
  flag_key text,
  feature_area text,
  observed_count integer,
  trip_threshold integer,
  should_disable boolean,
  reason text,
  window_label text,
  current_enabled boolean,
  kill_switch_active boolean,
  evaluated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    d.flag_key,
    d.feature_area,
    d.observed_count,
    d.trip_threshold,
    d.should_disable,
    d.reason,
    d.window_label,
    d.current_enabled,
    d.kill_switch_active,
    d.evaluated_at
  FROM public.vw_video_date_phase5_circuit_breaker_decision d
  ORDER BY d.should_disable DESC, d.flag_key;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_circuit_breaker_decision_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_circuit_breaker_decision_v1()
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_circuit_breaker_decision_v1() IS
  'Service-role Phase 5 circuit-breaker decision RPC. Complements Daily performance decisions with rollback-grade reliability signals.';

CREATE OR REPLACE FUNCTION public.apply_video_date_circuit_breaker_v1(
  p_reason text DEFAULT 'phase5_circuit_breaker',
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_reason text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 200);
  v_dry_run boolean := COALESCE(p_dry_run, true);
  v_disabled_count integer := 0;
  v_decisions jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.flag_key), '[]'::jsonb)
  INTO v_decisions
  FROM public.vw_video_date_phase5_circuit_breaker_decision d
  WHERE d.should_disable
    AND d.current_enabled
    AND NOT d.kill_switch_active;

  IF NOT v_dry_run THEN
    WITH disabled AS (
      UPDATE public.client_feature_flags f
      SET
        enabled = false,
        rollout_bps = 0,
        kill_switch_active = true,
        description = left(COALESCE(f.description, '') || ' Circuit breaker disabled: ' || COALESCE(v_reason, 'phase5_circuit_breaker'), 500),
        updated_at = now()
      FROM public.vw_video_date_phase5_circuit_breaker_decision d
      WHERE f.flag_key = d.flag_key
        AND d.should_disable
        AND d.current_enabled
        AND NOT d.kill_switch_active
      RETURNING f.flag_key
    )
    SELECT count(*)::integer INTO v_disabled_count
    FROM disabled;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dryRun', v_dry_run,
    'disabledCount', v_disabled_count,
    'reason', COALESCE(v_reason, 'phase5_circuit_breaker'),
    'decisions', v_decisions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_video_date_circuit_breaker_v1(text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_video_date_circuit_breaker_v1(text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.apply_video_date_circuit_breaker_v1(text, boolean) IS
  'Service-role rollback helper for Phase 5 circuit-breaker decisions. Defaults to dry-run; non-dry-run disables tripped flags and activates their kill switches.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260524203000',
  'Video Date Phase 5 hardened outbox finalizer cleanup',
  'schema+policy',
  'Adds active-row indexes/uniqueness, webhook DLQ, safety-aware orphan cleanup interlock, broadcast payload guards, and service-role circuit-breaker decision/apply RPCs. Drops the old full deadline uniqueness constraint only after duplicate active-row retirement, replacing it with the intended pending/claimed partial unique index.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET
  title = EXCLUDED.title,
  classification = EXCLUDED.classification,
  risk_notes = EXCLUDED.risk_notes,
  destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
