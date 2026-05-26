-- Admin hardening gap closure.
-- Makes realtime-published durable job tables explicitly selectable under RLS,
-- and bounds the role/session invalidation stream so revocation metadata cannot
-- grow forever.

REVOKE ALL ON TABLE public.account_deletion_completion_jobs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.account_deletion_completion_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_completion_jobs TO service_role;

REVOKE ALL ON TABLE public.support_reply_delivery_jobs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.support_reply_delivery_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_reply_delivery_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.admin_mark_account_deletion_completed(
  p_request_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_request public.account_deletion_requests%ROWTYPE;
  v_job public.account_deletion_completion_jobs%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_audit_id uuid;
  v_response jsonb;
  v_hard_delete_evidence_complete boolean := false;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_mark_account_deletion_completed',
    p_idempotency_key,
    jsonb_build_object('request_id', p_request_id, 'reason', v_reason, 'durable_completion_job', true)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT *
  INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Account deletion request was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF COALESCE(v_request.status, '') = 'completed' THEN
    SELECT *
    INTO v_job
    FROM public.account_deletion_completion_jobs
    WHERE deletion_request_id = p_request_id;

    IF NOT FOUND THEN
      v_response := public.admin_json_error(
        'COMPLETION_EVIDENCE_MISSING',
        'Completed account deletion request is missing durable completion job evidence.',
        jsonb_build_object('request_id', p_request_id)
      );
      RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
    END IF;

    v_hard_delete_evidence_complete :=
      v_job.state = 'completed'
      AND v_job.provider_cleanup_completed_at IS NOT NULL
      AND v_job.media_cleanup_completed_at IS NOT NULL
      AND v_job.pii_scrub_completed_at IS NOT NULL
      AND v_job.auth_delete_completed_at IS NOT NULL
      AND NOT COALESCE(v_job.legacy_checkpoint, false);

    IF NOT v_hard_delete_evidence_complete AND NOT COALESCE(v_job.legacy_checkpoint, false) THEN
      v_response := public.admin_json_error(
        'COMPLETION_EVIDENCE_INCOMPLETE',
        'Completed account deletion request has incomplete durable hard-delete evidence.',
        jsonb_build_object(
          'request_id', p_request_id,
          'completion_job_id', v_job.id,
          'completion_job_state', v_job.state
        )
      );
      RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
    END IF;

    v_response := public.admin_json_success(jsonb_build_object(
      'request_id', v_request.id,
      'user_id', v_request.user_id,
      'completed_at', v_request.completed_at,
      'completion_queued', false,
      'completion_job_id', v_job.id,
      'completion_job_state', v_job.state,
      'checkpoint_only', COALESCE(v_job.legacy_checkpoint, false),
      'legacy_checkpoint', COALESCE(v_job.legacy_checkpoint, false),
      'auth_user_deleted', v_hard_delete_evidence_complete,
      'profile_pii_scrubbed', v_hard_delete_evidence_complete
    ));
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF COALESCE(v_request.status, '') <> 'pending' THEN
    v_response := public.admin_json_error(
      'INVALID_TRANSITION',
      'Only pending account deletion requests can have completion jobs queued.',
      jsonb_build_object('status', v_request.status)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF v_request.scheduled_deletion_at IS NULL OR v_request.scheduled_deletion_at > now() THEN
    v_response := public.admin_json_error(
      'INVALID_TRANSITION',
      'Account deletion request is not eligible for completion until its scheduled deletion date.',
      jsonb_build_object('scheduled_deletion_at', v_request.scheduled_deletion_at)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  INSERT INTO public.account_deletion_completion_jobs (
    deletion_request_id,
    user_id,
    state,
    requested_by,
    request_reason,
    next_retry_at,
    metadata
  ) VALUES (
    v_request.id,
    v_request.user_id,
    'queued',
    v_admin_id,
    v_reason,
    now(),
    jsonb_build_object('queued_from', 'admin_mark_account_deletion_completed')
  )
  ON CONFLICT (deletion_request_id) DO UPDATE
  SET state = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('queued', 'processing', 'completed')
        THEN public.account_deletion_completion_jobs.state
        ELSE 'queued'
      END,
      requested_by = EXCLUDED.requested_by,
      request_reason = EXCLUDED.request_reason,
      attempts = CASE
        WHEN public.account_deletion_completion_jobs.state = 'permanent_failed' THEN 0
        ELSE public.account_deletion_completion_jobs.attempts
      END,
      worker_id = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.worker_id
      END,
      lease_expires_at = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.lease_expires_at
      END,
      next_retry_at = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN now()
        ELSE public.account_deletion_completion_jobs.next_retry_at
      END,
      blocked_reason = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.blocked_reason
      END,
      last_error = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.last_error
      END,
      error_code = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.error_code
      END,
      last_error_at = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.last_error_at
      END,
      updated_at = now()
  RETURNING * INTO v_job;

  v_audit_id := public.log_admin_action(
    'account_deletion.completion_job_queued',
    'account_deletion_request',
    p_request_id,
    jsonb_build_object(
      'reason', v_reason,
      'completion_job_id', v_job.id,
      'completion_job_state', v_job.state,
      'checkpoint_only', false,
      'required_steps', jsonb_build_array('provider_cleanup', 'media_cleanup', 'pii_scrub', 'auth_delete'),
      'action_outcome', 'queued'
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'request_id', v_request.id,
    'user_id', v_request.user_id,
    'completion_queued', v_job.state <> 'completed',
    'completion_job_id', v_job.id,
    'completion_job_state', v_job.state,
    'audit_log_id', v_audit_id,
    'checkpoint_only', false,
    'auth_user_deleted', false,
    'profile_pii_scrubbed', false
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_account_deletion_completed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_account_deletion_completed(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_old_admin_session_invalidation_events(
  p_retention_days integer DEFAULT 90,
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_retention_days integer := GREATEST(COALESCE(p_retention_days, 90), 7);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 25000);
  v_deleted integer := 0;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM public.admin_session_invalidation_events
    WHERE created_at < now() - make_interval(days => v_retention_days)
    ORDER BY created_at ASC, id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.admin_session_invalidation_events e
  USING doomed
  WHERE e.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_old_admin_session_invalidation_events(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_admin_session_invalidation_events(integer, integer) TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'purge-old-admin-session-invalidation-events';

    PERFORM cron.schedule(
      'purge-old-admin-session-invalidation-events',
      '17 3 * * *',
      $cron$
      SELECT public.purge_old_admin_session_invalidation_events(90, 5000);
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'purge-old-admin-session-invalidation-events cron schedule skipped: %', SQLERRM;
END
$$;

COMMENT ON FUNCTION public.purge_old_admin_session_invalidation_events(integer, integer) IS
  'Service-role retention cleanup for admin role/session invalidation events. Keeps recent revocation evidence while bounding long-term metadata growth.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260526050000',
  'Admin hardening gap closure',
  'schema+policy',
  'Adds explicit SELECT grants for realtime-published durable admin job tables and a bounded retention cleanup for admin session invalidation events older than 90 days.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
