-- Vibely Video Date v4 Phase 0-2 audit hardening.
--
-- Forward-only fixes for the post-deployment audit:
--   * recovery alert dispatch ledger + cron target
--   * stale Daily webhook signature metric in recovery alerts
--   * deadline finalizer internal audit event on no-op finalization
--   * service-role manual orphan cleanup trigger
--   * schema inventory view for v4 ops checks
--   * explicit idempotency-key length guidance

CREATE TABLE IF NOT EXISTS public.video_date_recovery_alert_dispatches (
  id bigserial PRIMARY KEY,
  severity text NOT NULL CHECK (severity IN ('page', 'watch')),
  fingerprint text NOT NULL CHECK (length(btrim(fingerprint)) BETWEEN 3 AND 240),
  hour_bucket timestamptz NOT NULL,
  alert_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sentry_sent_at timestamptz,
  slack_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_recovery_alert_dispatches_payload_object
    CHECK (jsonb_typeof(alert_payload) = 'object'),
  CONSTRAINT video_date_recovery_alert_dispatches_no_secret_keys
    CHECK (alert_payload::text !~* '(meeting[_-]?token|daily[_-]?token|token|secret|api[_-]?key)')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_date_recovery_alert_dispatches_hour
  ON public.video_date_recovery_alert_dispatches(severity, fingerprint, hour_bucket);

CREATE INDEX IF NOT EXISTS idx_video_date_recovery_alert_dispatches_created
  ON public.video_date_recovery_alert_dispatches(created_at DESC);

ALTER TABLE public.video_date_recovery_alert_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_recovery_alert_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_recovery_alert_dispatches TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_recovery_alert_dispatches_id_seq TO service_role;

COMMENT ON TABLE public.video_date_recovery_alert_dispatches IS
  'Service-role idempotency ledger for Phase 2 recovery alert dispatch. Dedupe is one alert fingerprint per severity per hour.';

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
   OR high_attempt_count > 0

UNION ALL

SELECT
  'webhook_security'::text AS queue_name,
  'signature_rejected_stale'::text AS kind,
  'blocked'::text AS state,
  CASE WHEN count(*) >= 10 THEN 'page' ELSE 'watch' END AS severity,
  jsonb_build_object(
    'rowCount', count(*),
    'oldestRejectedAt', min(created_at),
    'newestRejectedAt', max(created_at),
    'windowSeconds', 900,
    'maxTimestampSkewMs', max((detail->>'max_timestamp_skew_ms')::integer),
    'maxObservedSkewMs', max((detail->>'skew_ms')::integer)
  ) AS details,
  now() AS generated_at
FROM public.event_loop_observability_events
WHERE operation = 'video_date_daily_webhook'
  AND reason_code = 'signature_rejected_stale'
  AND created_at >= now() - interval '15 minutes'
HAVING count(*) > 0;

REVOKE ALL ON public.vw_video_date_recovery_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_recovery_alerts TO service_role;

COMMENT ON VIEW public.vw_video_date_recovery_alerts IS
  'Service-role alert feed for Phase 2 work queues and stale Daily webhook signature rejects. Empty means no current recovery alert.';

CREATE OR REPLACE FUNCTION public.finalize_video_session_deadline_v2(
  p_deadline_id bigint,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_deadline public.video_session_deadlines%ROWTYPE;
  v_before record;
  v_after record;
  v_result jsonb := '{}'::jsonb;
  v_success boolean := false;
  v_seconds_remaining integer;
  v_state_changed boolean := false;
BEGIN
  IF p_deadline_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_deadline_finalize');
  END IF;

  SELECT *
  INTO v_deadline
  FROM public.video_session_deadlines
  WHERE id = p_deadline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deadline_not_found');
  END IF;

  IF v_deadline.state = 'done' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'done', 'alreadyDone', true);
  END IF;

  IF v_deadline.state IS DISTINCT FROM 'claimed'
     OR v_deadline.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lease_mismatch',
      'state', v_deadline.state,
      'claimedBy', v_deadline.claimed_by
    );
  END IF;

  IF v_deadline.claim_expires_at IS NULL OR v_deadline.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  SELECT
    state::text AS state,
    phase,
    ended_at,
    ended_reason,
    date_started_at,
    handshake_started_at
  INTO v_before
  FROM public.video_sessions
  WHERE id = v_deadline.session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = 'session_not_found',
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'session_not_found',
      'state', 'failed'
    );
  END IF;

  IF v_deadline.kind = 'noop' THEN
    v_result := jsonb_build_object('success', true, 'state', COALESCE(v_before.state, 'unknown'));
  ELSIF v_deadline.kind IN ('handshake_auto_promote', 'handshake_timeout') THEN
    v_result := public.finalize_video_date_handshake_deadline(
      v_deadline.session_id,
      NULL,
      'deadline-finalizer-v2',
      v_deadline.kind
    );
  ELSE
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = 'unsupported_deadline_kind:' || v_deadline.kind,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unsupported_deadline_kind',
      'kind', v_deadline.kind,
      'state', 'failed'
    );
  END IF;

  v_success := COALESCE(
    CASE WHEN v_result ? 'success' THEN (v_result->>'success')::boolean ELSE NULL END,
    CASE WHEN v_result ? 'ok' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF NOT v_success THEN
    RETURN public.complete_video_session_deadline_v2(
      p_deadline_id,
      v_worker,
      false,
      COALESCE(v_result->>'code', v_result->>'error', 'deadline_transition_failed'),
      NULL,
      false
    );
  END IF;

  v_seconds_remaining := CASE
    WHEN v_result ? 'seconds_remaining' THEN NULLIF(v_result->>'seconds_remaining', '')::integer
    ELSE NULL
  END;

  IF COALESCE(v_result->>'state', '') = 'handshake'
     AND COALESCE(v_seconds_remaining, 0) > 0 THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'pending',
      due_at = now() + (v_seconds_remaining * interval '1 second'),
      last_error = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', true,
      'state', 'pending',
      'reason', 'deadline_not_due',
      'retryAfterSeconds', v_seconds_remaining,
      'result', v_result
    );
  END IF;

  UPDATE public.video_session_deadlines
  SET
    state = 'done',
    last_error = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claimed_by = NULL,
    updated_at = now()
  WHERE id = p_deadline_id;

  SELECT
    state::text AS state,
    phase,
    ended_at,
    ended_reason,
    date_started_at,
    handshake_started_at
  INTO v_after
  FROM public.video_sessions
  WHERE id = v_deadline.session_id;

  v_state_changed := (
    v_before.state IS DISTINCT FROM v_after.state
    OR v_before.phase IS DISTINCT FROM v_after.phase
    OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
    OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
    OR v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
    OR v_before.handshake_started_at IS DISTINCT FROM v_after.handshake_started_at
  );

  IF v_state_changed THEN
    PERFORM public.append_video_session_event_v2(
      v_deadline.session_id,
      'deadline_finalized',
      'participants',
      NULL,
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateBefore', v_before.state,
        'stateAfter', v_after.state,
        'phaseBefore', v_before.phase,
        'phaseAfter', v_after.phase,
        'endedReason', v_after.ended_reason
      ),
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateBefore', v_before.state,
        'stateAfter', v_after.state,
        'phaseBefore', v_before.phase,
        'phaseAfter', v_after.phase,
        'endedReason', v_after.ended_reason
      ),
      true,
      gen_random_uuid()
    );
  ELSE
    PERFORM public.append_video_session_event_v2(
      v_deadline.session_id,
      'deadline_finalized',
      'internal',
      NULL,
      jsonb_build_object(
        'deadlineId', v_deadline.id,
        'deadlineKind', v_deadline.kind,
        'stateChanged', false,
        'state', v_after.state,
        'phase', v_after.phase,
        'result', v_result
      ),
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateChanged', false
      ),
      false,
      gen_random_uuid()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'done',
    'deadlineKind', v_deadline.kind,
    'stateChanged', v_state_changed,
    'result', v_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_session_deadline_v2(bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_session_deadline_v2(bigint, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_video_session_deadline_v2(bigint, text) IS
  'Finalizes a claimed deadline through the canonical transition path. State-changing finalizations emit participant events; no-op finalizations emit internal audit-only events.';

COMMENT ON FUNCTION public.video_session_command_begin_v2(uuid, uuid, text, text, jsonb, text) IS
  'Internal v4 command begin helper. Idempotency keys must be 8-160 characters; shared clients should use 36-character UUID v4 request ids inside composed keys. Reused keys with different session/kind/hash/payload return idempotency_conflict.';

CREATE OR REPLACE FUNCTION public.trigger_video_date_orphan_cleanup_now(
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_project_url text;
  v_cron_secret text;
  v_url text;
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pg_net_not_available');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'vault'
      AND table_name = 'decrypted_secrets'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'vault_not_available');
  END IF;

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

  IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_cron_secret, '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_vault_project_url_or_cron_secret');
  END IF;

  v_url := rtrim(v_project_url, '/') || '/functions/v1/video-date-orphan-room-cleanup';

  EXECUTE 'SELECT net.http_post(url := $1, headers := $2::jsonb, body := $3::jsonb)'
  INTO v_request_id
  USING
    v_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    jsonb_build_object(
      'source', 'manual_rpc',
      'dry_run', COALESCE(p_dry_run, true),
      'batch_size', 100
    );

  RETURN jsonb_build_object(
    'ok', true,
    'requestId', v_request_id,
    'dryRun', COALESCE(p_dry_run, true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_video_date_orphan_cleanup_now(boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_video_date_orphan_cleanup_now(boolean)
  TO service_role;

COMMENT ON FUNCTION public.trigger_video_date_orphan_cleanup_now(boolean) IS
  'Service-role ops RPC that invokes video-date-orphan-room-cleanup immediately through pg_net. Defaults to dry-run.';

CREATE OR REPLACE VIEW public.vw_video_date_v4_schema_inventory
WITH (security_invoker = true) AS
SELECT *
FROM (
  VALUES
    ('table', 'video_session_events', to_regclass('public.video_session_events') IS NOT NULL),
    ('table', 'video_session_commands', to_regclass('public.video_session_commands') IS NOT NULL),
    ('table', 'video_session_deadlines', to_regclass('public.video_session_deadlines') IS NOT NULL),
    ('table', 'video_date_provider_outbox', to_regclass('public.video_date_provider_outbox') IS NOT NULL),
    ('table', 'video_date_daily_webhook_events', to_regclass('public.video_date_daily_webhook_events') IS NOT NULL),
    ('table', 'video_date_orphan_room_cleanup_audit', to_regclass('public.video_date_orphan_room_cleanup_audit') IS NOT NULL),
    ('table', 'video_date_recovery_alert_dispatches', to_regclass('public.video_date_recovery_alert_dispatches') IS NOT NULL),
    ('view', 'vw_video_date_recovery_alerts', to_regclass('public.vw_video_date_recovery_alerts') IS NOT NULL),
    ('view', 'vw_video_date_orphan_room_cleanup_health', to_regclass('public.vw_video_date_orphan_room_cleanup_health') IS NOT NULL),
    ('view', 'vw_video_date_v4_schema_inventory', to_regclass('public.vw_video_date_v4_schema_inventory') IS NOT NULL),
    ('function', 'get_video_date_snapshot_core(uuid)', to_regprocedure('public.get_video_date_snapshot_core(uuid)') IS NOT NULL),
    ('function', 'video_session_command_begin_v2(uuid, uuid, text, text, jsonb, text)', to_regprocedure('public.video_session_command_begin_v2(uuid, uuid, text, text, jsonb, text)') IS NOT NULL),
    ('function', 'finalize_video_session_deadline_v2(bigint, text)', to_regprocedure('public.finalize_video_session_deadline_v2(bigint, text)') IS NOT NULL),
    ('function', 'record_video_date_daily_webhook_event_v2(text,text,text,text,text,timestamptz,jsonb,timestamptz)', to_regprocedure('public.record_video_date_daily_webhook_event_v2(text,text,text,text,text,timestamptz,jsonb,timestamptz)') IS NOT NULL),
    ('function', 'trigger_video_date_orphan_cleanup_now(boolean)', to_regprocedure('public.trigger_video_date_orphan_cleanup_now(boolean)') IS NOT NULL),
    ('edge_function', 'video-date-snapshot', true),
    ('edge_function', 'video-date-daily-webhook', true),
    ('edge_function', 'video-date-orphan-room-cleanup', true),
    ('edge_function', 'video-date-recovery-alert-dispatcher', true)
) AS inventory(object_kind, object_name, present);

REVOKE ALL ON public.vw_video_date_v4_schema_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_v4_schema_inventory TO service_role;

COMMENT ON VIEW public.vw_video_date_v4_schema_inventory IS
  'Service-role inventory checklist for the Video Date v4 Phase 0-2 operational schema and Edge Function surface.';

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
      WHERE jobname = 'video-date-recovery-alert-dispatcher';

      PERFORM cron.schedule(
        'video-date-recovery-alert-dispatcher',
        '*/5 * * * *',
        $cron$
        SELECT net.http_post(
          url := (select trim(decrypted_secret) from vault.decrypted_secrets where name = 'project_url' limit 1)
            || '/functions/v1/video-date-recovery-alert-dispatcher',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select trim(decrypted_secret) from vault.decrypted_secrets where name = 'cron_secret' limit 1)
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
        $cron$
      );
    ELSE
      RAISE NOTICE 'video-date recovery alert dispatcher not scheduled: missing Vault project_url or cron_secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'video-date recovery alert dispatcher cron scheduling skipped: %', SQLERRM;
END $$;
