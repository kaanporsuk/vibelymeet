-- Vibely Video Date v4 Phase 2.4-2.6 recovery, Daily webhooks, and orphan room cleanup.
-- Additive only. Keeps Daily tokens out of Postgres while giving ops a durable
-- ledger for provider webhooks and destructive room cleanup decisions.

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.event_registrations
SET updated_at = registered_at
WHERE updated_at IS NULL;

ALTER TABLE public.event_registrations
  ALTER COLUMN updated_at SET DEFAULT now();

COMMENT ON COLUMN public.event_registrations.updated_at IS
  'Server-maintained registration mutation timestamp. Added to satisfy Ready Gate suppression and queue lifecycle RPCs that update registrations atomically.';

CREATE TABLE IF NOT EXISTS public.video_date_daily_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  room_name text,
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE SET NULL,
  provider_participant_id text,
  provider_user_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  signature_timestamp timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_state text NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received', 'processed', 'ignored', 'failed')),
  processing_result text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_daily_webhook_events_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT video_date_daily_webhook_events_no_secret_keys
    CHECK (NOT public.video_date_jsonb_has_secret_key(payload))
);

CREATE INDEX IF NOT EXISTS idx_video_date_daily_webhook_events_session
  ON public.video_date_daily_webhook_events(session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_date_daily_webhook_events_room
  ON public.video_date_daily_webhook_events(room_name, occurred_at DESC)
  WHERE room_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_date_daily_webhook_events_state
  ON public.video_date_daily_webhook_events(processing_state, created_at DESC);

ALTER TABLE public.video_date_daily_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_daily_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_daily_webhook_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_daily_webhook_events_id_seq TO service_role;

COMMENT ON TABLE public.video_date_daily_webhook_events IS
  'Service-role Daily webhook idempotency ledger for v4 video dates. Stores provider event metadata only; no Daily meeting tokens or provider secrets.';

CREATE TABLE IF NOT EXISTS public.video_date_orphan_room_cleanup_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_name text NOT NULL,
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE SET NULL,
  provider_room_id text,
  provider_created_at timestamptz,
  provider_expires_at timestamptz,
  active_participant_count integer NOT NULL DEFAULT 0 CHECK (active_participant_count >= 0),
  action text NOT NULL
    CHECK (action IN ('delete_candidate', 'dry_run_delete', 'deleted', 'skipped_active', 'skipped_recent', 'skipped_unknown', 'delete_failed')),
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_orphan_room_cleanup_audit_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT video_date_orphan_room_cleanup_audit_no_secret_keys
    CHECK (NOT public.video_date_jsonb_has_secret_key(metadata))
);

CREATE INDEX IF NOT EXISTS idx_video_date_orphan_room_cleanup_audit_created
  ON public.video_date_orphan_room_cleanup_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_date_orphan_room_cleanup_audit_room
  ON public.video_date_orphan_room_cleanup_audit(room_name, created_at DESC);

ALTER TABLE public.video_date_orphan_room_cleanup_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_orphan_room_cleanup_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_orphan_room_cleanup_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_orphan_room_cleanup_audit_id_seq TO service_role;

COMMENT ON TABLE public.video_date_orphan_room_cleanup_audit IS
  'Service-role audit trail for Daily video-date orphan room cleanup. Every destructive candidate records the safety decision.';

CREATE OR REPLACE VIEW public.vw_video_date_lease_recovery_health
WITH (security_invoker = true) AS
WITH outbox AS (
  SELECT
    'provider_outbox'::text AS queue_name,
    kind,
    state,
    count(*)::bigint AS row_count,
    min(next_attempt_at) FILTER (WHERE state IN ('pending', 'claimed')) AS oldest_due_at,
    count(*) FILTER (
      WHERE state = 'pending'
        AND next_attempt_at <= now() - interval '2 minutes'
    )::bigint AS late_due_count,
    count(*) FILTER (
      WHERE state = 'claimed'
        AND claim_expires_at IS NOT NULL
        AND claim_expires_at <= now()
    )::bigint AS expired_lease_count,
    count(*) FILTER (WHERE attempts >= 5 AND state <> 'done')::bigint AS high_attempt_count,
    count(*) FILTER (WHERE state = 'failed')::bigint AS failed_count,
    max(attempts)::integer AS max_attempts
  FROM public.video_date_provider_outbox
  GROUP BY kind, state
),
deadlines AS (
  SELECT
    'session_deadlines'::text AS queue_name,
    kind,
    state,
    count(*)::bigint AS row_count,
    min(due_at) FILTER (WHERE state IN ('pending', 'claimed')) AS oldest_due_at,
    count(*) FILTER (
      WHERE state = 'pending'
        AND due_at <= now() - interval '2 minutes'
    )::bigint AS late_due_count,
    count(*) FILTER (
      WHERE state = 'claimed'
        AND claim_expires_at IS NOT NULL
        AND claim_expires_at <= now()
    )::bigint AS expired_lease_count,
    count(*) FILTER (WHERE attempts >= 5 AND state <> 'done')::bigint AS high_attempt_count,
    count(*) FILTER (WHERE state = 'failed')::bigint AS failed_count,
    max(attempts)::integer AS max_attempts
  FROM public.video_session_deadlines
  GROUP BY kind, state
)
SELECT
  queue_name,
  kind,
  state,
  row_count,
  oldest_due_at,
  CASE
    WHEN oldest_due_at IS NULL THEN NULL
    ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - oldest_due_at)))::integer
  END AS oldest_due_age_seconds,
  late_due_count,
  expired_lease_count,
  high_attempt_count,
  failed_count,
  COALESCE(max_attempts, 0) AS max_attempts
FROM (
  SELECT * FROM outbox
  UNION ALL
  SELECT * FROM deadlines
) health;

REVOKE ALL ON public.vw_video_date_lease_recovery_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_lease_recovery_health TO service_role;

COMMENT ON VIEW public.vw_video_date_lease_recovery_health IS
  'Service-role dashboard for stuck Phase 2 leases, overdue work, retry pressure, and failed rows.';

CREATE OR REPLACE VIEW public.vw_video_date_recovery_alerts
WITH (security_invoker = true) AS
SELECT
  queue_name,
  kind,
  state,
  CASE
    WHEN failed_count > 0 OR expired_lease_count > 5 THEN 'page'
    WHEN late_due_count > 0 OR expired_lease_count > 0 OR high_attempt_count > 0 THEN 'watch'
    ELSE 'ok'
  END AS severity,
  jsonb_build_object(
    'rowCount', row_count,
    'oldestDueAt', oldest_due_at,
    'oldestDueAgeSeconds', oldest_due_age_seconds,
    'lateDueCount', late_due_count,
    'expiredLeaseCount', expired_lease_count,
    'highAttemptCount', high_attempt_count,
    'failedCount', failed_count,
    'maxAttempts', max_attempts
  ) AS details,
  now() AS generated_at
FROM public.vw_video_date_lease_recovery_health
WHERE failed_count > 0
   OR late_due_count > 0
   OR expired_lease_count > 0
   OR high_attempt_count > 0;

REVOKE ALL ON public.vw_video_date_recovery_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_recovery_alerts TO service_role;

COMMENT ON VIEW public.vw_video_date_recovery_alerts IS
  'Service-role alert feed for Phase 2 work queues. Empty means no current recovery alert.';

CREATE OR REPLACE VIEW public.vw_video_date_provider_room_reconciliation
WITH (security_invoker = true) AS
SELECT
  vs.id AS session_id,
  vs.event_id,
  vs.daily_room_name AS room_name,
  vs.daily_room_url AS room_url,
  vs.state,
  vs.phase,
  vs.started_at,
  vs.ended_at,
  vs.ended_reason,
  vs.daily_room_verified_at,
  vs.daily_room_expires_at,
  (vs.ended_at IS NOT NULL OR vs.state = 'ended' OR vs.phase = 'ended') AS is_terminal,
  (
    vs.daily_room_name IS NOT NULL
    AND (vs.ended_at IS NOT NULL OR vs.state = 'ended' OR vs.phase = 'ended')
    AND (
      vs.ended_at IS NULL
      OR vs.ended_at <= now() - interval '2 minutes'
    )
  ) AS cleanup_candidate,
  CASE
    WHEN vs.ended_at IS NULL THEN NULL
    ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - vs.ended_at)))::integer
  END AS terminal_age_seconds,
  (vs.participant_1_joined_at IS NOT NULL OR vs.participant_2_joined_at IS NOT NULL) AS has_join_evidence,
  COALESCE(vs.session_seq, 0) AS session_seq
FROM public.video_sessions vs
WHERE vs.daily_room_name IS NOT NULL;

REVOKE ALL ON public.vw_video_date_provider_room_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_provider_room_reconciliation TO service_role;

COMMENT ON VIEW public.vw_video_date_provider_room_reconciliation IS
  'Service-role room reconciliation view for DB-known Daily rooms and cleanup candidates.';

CREATE OR REPLACE VIEW public.vw_video_date_orphan_room_cleanup_health
WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', created_at) AS bucket_hour,
  action,
  reason,
  count(*)::bigint AS row_count,
  count(*) FILTER (WHERE action = 'delete_failed')::bigint AS failed_count,
  count(*) FILTER (WHERE action IN ('delete_candidate', 'deleted', 'dry_run_delete'))::bigint AS destructive_candidate_count,
  max(created_at) AS last_seen_at
FROM public.video_date_orphan_room_cleanup_audit
WHERE created_at >= now() - interval '7 days'
GROUP BY date_trunc('hour', created_at), action, reason;

REVOKE ALL ON public.vw_video_date_orphan_room_cleanup_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_orphan_room_cleanup_health TO service_role;

COMMENT ON VIEW public.vw_video_date_orphan_room_cleanup_health IS
  'Service-role health rollup for Daily orphan-room cleanup decisions.';

CREATE OR REPLACE FUNCTION public.get_video_date_phase2_recovery_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_queues jsonb;
  v_alerts jsonb;
  v_cleanup jsonb;
  v_severity text := 'ok';
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.queue_name, h.kind, h.state), '[]'::jsonb)
  INTO v_queues
  FROM public.vw_video_date_lease_recovery_health h;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.severity DESC, a.queue_name, a.kind), '[]'::jsonb)
  INTO v_alerts
  FROM public.vw_video_date_recovery_alerts a;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.bucket_hour DESC, c.action, c.reason), '[]'::jsonb)
  INTO v_cleanup
  FROM public.vw_video_date_orphan_room_cleanup_health c;

  IF EXISTS (SELECT 1 FROM public.vw_video_date_recovery_alerts WHERE severity = 'page') THEN
    v_severity := 'page';
  ELSIF EXISTS (SELECT 1 FROM public.vw_video_date_recovery_alerts WHERE severity = 'watch') THEN
    v_severity := 'watch';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'severity', v_severity,
    'queues', v_queues,
    'alerts', v_alerts,
    'orphanRoomCleanup', v_cleanup
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_phase2_recovery_health()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_phase2_recovery_health()
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_phase2_recovery_health() IS
  'Service-role JSON summary for Phase 2 lease recovery, alerts, and orphan room cleanup health.';

CREATE OR REPLACE FUNCTION public.record_video_date_daily_webhook_event_v2(
  p_provider_event_id text,
  p_event_type text,
  p_room_name text DEFAULT NULL,
  p_provider_participant_id text DEFAULT NULL,
  p_provider_user_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_signature_timestamp timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_provider_event_id text := btrim(COALESCE(p_provider_event_id, ''));
  v_event_type text := lower(btrim(COALESCE(p_event_type, '')));
  v_event_kind text;
  v_room_name text := NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), '');
  v_provider_participant_id text := NULLIF(left(btrim(COALESCE(p_provider_participant_id, '')), 180), '');
  v_provider_user_id text := NULLIF(left(btrim(COALESCE(p_provider_user_id, '')), 180), '');
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_ledger_id bigint;
  v_existing public.video_date_daily_webhook_events%ROWTYPE;
  v_session public.video_sessions%ROWTYPE;
  v_actor uuid;
  v_actor_role text;
  v_webhooks_enabled boolean := false;
  v_result text := 'ignored_unsupported_event';
  v_state text := 'ignored';
  v_rows_changed integer := 0;
BEGIN
  IF v_provider_event_id = ''
     OR length(v_provider_event_id) > 500
     OR v_event_type = ''
     OR length(v_event_type) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_webhook_event');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_payload) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'secret_payload_rejected');
  END IF;

  INSERT INTO public.video_date_daily_webhook_events (
    provider_event_id,
    event_type,
    room_name,
    provider_participant_id,
    provider_user_id,
    occurred_at,
    signature_timestamp,
    payload
  )
  VALUES (
    v_provider_event_id,
    v_event_type,
    v_room_name,
    v_provider_participant_id,
    v_provider_user_id,
    v_occurred_at,
    p_signature_timestamp,
    v_payload
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    SELECT *
    INTO v_existing
    FROM public.video_date_daily_webhook_events
    WHERE provider_event_id = v_provider_event_id;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'eventId', v_existing.id,
      'processingState', v_existing.processing_state,
      'processingResult', v_existing.processing_result,
      'sessionId', v_existing.session_id
    );
  END IF;

  IF v_room_name IS NULL THEN
    v_result := 'ignored_room_missing';
    UPDATE public.video_date_daily_webhook_events
    SET processing_state = v_state,
        processing_result = v_result,
        processed_at = now()
    WHERE id = v_ledger_id;

    RETURN jsonb_build_object('ok', true, 'duplicate', false, 'state', v_state, 'result', v_result);
  END IF;

  SELECT vs.*
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = (
    SELECT latest.id
    FROM public.video_sessions latest
    WHERE latest.daily_room_name = v_room_name
    ORDER BY latest.started_at DESC
    LIMIT 1
  )
  FOR UPDATE;

  IF NOT FOUND THEN
    v_result := 'ignored_session_not_found';
    UPDATE public.video_date_daily_webhook_events
    SET processing_state = v_state,
        processing_result = v_result,
        processed_at = now()
    WHERE id = v_ledger_id;

    RETURN jsonb_build_object('ok', true, 'duplicate', false, 'state', v_state, 'result', v_result);
  END IF;

  IF v_provider_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_provider_user_id::uuid;
  END IF;

  IF v_actor IS NOT NULL AND v_actor = v_session.participant_1_id THEN
    v_actor_role := 'participant_1';
  ELSIF v_actor IS NOT NULL AND v_actor = v_session.participant_2_id THEN
    v_actor_role := 'participant_2';
  END IF;

  IF v_actor_role IS NOT NULL THEN
    v_webhooks_enabled := COALESCE(
      public.evaluate_client_feature_flag('video_date.daily_webhooks_v2', v_actor),
      false
    );
  END IF;

  v_event_kind := replace(replace(v_event_type, '_', '.'), '-', '.');

  IF v_session.ended_at IS NOT NULL OR v_session.state = 'ended' OR v_session.phase = 'ended' THEN
    v_result := 'ignored_terminal_session';
  ELSIF v_event_kind IN ('participant.joined', 'participant.join') THEN
    IF v_actor_role IS NULL THEN
      v_result := 'ignored_participant_not_matched';
    ELSIF NOT v_webhooks_enabled THEN
      v_result := 'ignored_feature_disabled';
    ELSIF v_actor_role = 'participant_1' THEN
      UPDATE public.video_sessions
      SET participant_1_joined_at = COALESCE(participant_1_joined_at, v_occurred_at),
          participant_1_away_at = NULL
      WHERE id = v_session.id
        AND (participant_1_joined_at IS NULL OR participant_1_away_at IS NOT NULL);
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
      v_state := 'processed';
      v_result := 'participant_1_join_reconciled';
    ELSIF v_actor_role = 'participant_2' THEN
      UPDATE public.video_sessions
      SET participant_2_joined_at = COALESCE(participant_2_joined_at, v_occurred_at),
          participant_2_away_at = NULL
      WHERE id = v_session.id
        AND (participant_2_joined_at IS NULL OR participant_2_away_at IS NOT NULL);
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
      v_state := 'processed';
      v_result := 'participant_2_join_reconciled';
    END IF;
  ELSIF v_event_kind IN ('participant.left', 'participant.leave') THEN
    IF v_actor_role IS NULL THEN
      v_result := 'ignored_participant_not_matched';
    ELSIF NOT v_webhooks_enabled THEN
      v_result := 'ignored_feature_disabled';
    ELSIF v_actor_role = 'participant_1' THEN
      UPDATE public.video_sessions
      SET participant_1_away_at = v_occurred_at
      WHERE id = v_session.id
        AND participant_1_away_at IS DISTINCT FROM v_occurred_at;
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
      v_state := 'processed';
      v_result := 'participant_1_left_reconciled';
    ELSIF v_actor_role = 'participant_2' THEN
      UPDATE public.video_sessions
      SET participant_2_away_at = v_occurred_at
      WHERE id = v_session.id
        AND participant_2_away_at IS DISTINCT FROM v_occurred_at;
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
      v_state := 'processed';
      v_result := 'participant_2_left_reconciled';
    END IF;
  END IF;

  IF v_rows_changed > 0 THEN
    PERFORM public.bump_video_session_seq(v_session.id);
  END IF;

  PERFORM public.append_video_session_event_v2(
    v_session.id,
    'daily_webhook_reconciled',
    'internal',
    v_actor,
    jsonb_build_object(
      'providerEventId', v_provider_event_id,
      'eventType', v_event_type,
      'roomName', v_room_name,
      'providerParticipantId', v_provider_participant_id,
      'providerUserId', v_provider_user_id,
      'actorRole', v_actor_role,
      'result', v_result
    ),
    jsonb_build_object(
      'eventType', v_event_type,
      'actorRole', v_actor_role,
      'result', v_result
    ),
    false,
    gen_random_uuid()
  );

  UPDATE public.video_date_daily_webhook_events
  SET session_id = v_session.id,
      processing_state = v_state,
      processing_result = v_result,
      processed_at = now()
  WHERE id = v_ledger_id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'state', v_state,
    'result', v_result,
    'sessionId', v_session.id,
    'actorRole', v_actor_role,
    'rowsChanged', v_rows_changed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) IS
  'Records a Daily webhook event idempotently and reconciles participant joined/left timestamps without starting lifecycle transitions or storing Daily tokens.';

CREATE OR REPLACE FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  p_room_name text,
  p_action text,
  p_reason text,
  p_session_id uuid DEFAULT NULL,
  p_provider_room_id text DEFAULT NULL,
  p_provider_created_at timestamptz DEFAULT NULL,
  p_provider_expires_at timestamptz DEFAULT NULL,
  p_active_participant_count integer DEFAULT 0,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_room_name text := left(btrim(COALESCE(p_room_name, '')), 180);
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_reason text := left(lower(btrim(COALESCE(p_reason, 'unknown'))), 160);
  v_metadata jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_metadata, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_id bigint;
BEGIN
  IF v_room_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_name_required');
  END IF;

  IF v_action NOT IN ('delete_candidate', 'dry_run_delete', 'deleted', 'skipped_active', 'skipped_recent', 'skipped_unknown', 'delete_failed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cleanup_action');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_metadata) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'secret_metadata_rejected');
  END IF;

  INSERT INTO public.video_date_orphan_room_cleanup_audit (
    room_name,
    session_id,
    provider_room_id,
    provider_created_at,
    provider_expires_at,
    active_participant_count,
    action,
    reason,
    metadata
  )
  VALUES (
    v_room_name,
    p_session_id,
    NULLIF(left(btrim(COALESCE(p_provider_room_id, '')), 180), ''),
    p_provider_created_at,
    p_provider_expires_at,
    GREATEST(0, COALESCE(p_active_participant_count, 0)),
    v_action,
    v_reason,
    v_metadata
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  text, text, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  text, text, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  text, text, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) IS
  'Service-role audit helper used by the Daily orphan room cleanup worker after presence and DB reconciliation checks.';

DO $$
DECLARE
  v_project_url text;
  v_cron_secret text;
  v_has_vault boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    v_has_vault := EXISTS (
      SELECT 1
      FROM information_schema.views
      WHERE table_schema = 'vault'
        AND table_name = 'decrypted_secrets'
    );

    IF v_has_vault THEN
      SELECT trim(decrypted_secret)
      INTO v_project_url
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
      LIMIT 1;

      SELECT trim(decrypted_secret)
      INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_secret'
      LIMIT 1;
    END IF;

    IF NULLIF(v_project_url, '') IS NOT NULL AND NULLIF(v_cron_secret, '') IS NOT NULL THEN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'video-date-orphan-room-cleanup';

      PERFORM cron.schedule(
        'video-date-orphan-room-cleanup',
        '*/10 * * * *',
        $cron$
        SELECT net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/video-date-orphan-room-cleanup',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 100)
        );
        $cron$
      );
    ELSE
      RAISE NOTICE 'video-date orphan room cleanup not scheduled: missing Vault project_url or cron_secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'video-date orphan room cleanup cron scheduling skipped: %', SQLERRM;
END $$;
