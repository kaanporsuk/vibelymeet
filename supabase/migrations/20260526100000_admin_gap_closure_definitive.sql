-- Admin gap closure definitive pass.
-- Adds durable job worker liveness, retry controls, meta-audit filtering, and
-- server-side event pagination/filtering.

CREATE TABLE IF NOT EXISTS public.admin_durable_worker_runs (
  worker_name text PRIMARY KEY,
  worker_id text,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'running', 'completed', 'completed_with_failures', 'failed')),
  action text,
  batch_size integer,
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_durable_worker_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_durable_worker_runs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.admin_durable_worker_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_durable_worker_runs TO service_role;

DROP POLICY IF EXISTS admin_durable_worker_runs_admin_select ON public.admin_durable_worker_runs;
CREATE POLICY admin_durable_worker_runs_admin_select
  ON public.admin_durable_worker_runs
  FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'ops.read'));

DROP POLICY IF EXISTS admin_durable_worker_runs_service_role_all ON public.admin_durable_worker_runs;
CREATE POLICY admin_durable_worker_runs_service_role_all
  ON public.admin_durable_worker_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.admin_get_admin_durable_job_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_worker_name text := 'process-admin-durable-jobs';
  v_worker_stale_after interval := interval '15 minutes';
  v_cron_job_present boolean;
  v_last_run jsonb := NULL;
  v_deletion_counts jsonb := '{}'::jsonb;
  v_support_counts jsonb := '{}'::jsonb;
  v_deletion_oldest jsonb := NULL;
  v_support_oldest jsonb := NULL;
  v_deletion_blocked integer := 0;
  v_support_blocked integer := 0;
  v_deletion_permanent integer := 0;
  v_support_permanent integer := 0;
  v_deletion_retryable integer := 0;
  v_support_retryable integer := 0;
  v_deletion_stale_processing integer := 0;
  v_support_stale_processing integer := 0;
  v_status text := 'healthy';
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'ops.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Operations read permission is required.');
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $$SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'process-admin-durable-jobs')$$
      INTO v_cron_job_present;
  ELSE
    v_cron_job_present := NULL;
  END IF;

  SELECT to_jsonb(r)
  INTO v_last_run
  FROM (
    SELECT worker_name, worker_id, status, action, batch_size, started_at, finished_at,
           last_heartbeat_at, last_error, result, updated_at
    FROM public.admin_durable_worker_runs
    WHERE worker_name = v_worker_name
  ) r;

  SELECT COALESCE(jsonb_object_agg(state, count), '{}'::jsonb)
  INTO v_deletion_counts
  FROM (
    SELECT state, count(*)::integer AS count
    FROM public.account_deletion_completion_jobs
    GROUP BY state
  ) counts;

  SELECT COALESCE(jsonb_object_agg(state, count), '{}'::jsonb)
  INTO v_support_counts
  FROM (
    SELECT state, count(*)::integer AS count
    FROM public.support_reply_delivery_jobs
    GROUP BY state
  ) counts;

  SELECT to_jsonb(job)
  INTO v_deletion_oldest
  FROM (
    SELECT id, deletion_request_id, user_id, state, attempts, next_retry_at, last_error,
           error_code, blocked_reason, created_at
    FROM public.account_deletion_completion_jobs
    WHERE state IN ('queued', 'retryable_failed', 'blocked', 'permanent_failed')
    ORDER BY next_retry_at ASC NULLS FIRST, created_at ASC, id ASC
    LIMIT 1
  ) job;

  SELECT to_jsonb(job)
  INTO v_support_oldest
  FROM (
    SELECT id, ticket_id, reply_id, channel, state, attempts, next_retry_at, last_error,
           error_code, created_at
    FROM public.support_reply_delivery_jobs
    WHERE state IN ('queued', 'retryable_failed', 'blocked', 'permanent_failed')
    ORDER BY next_retry_at ASC NULLS FIRST, created_at ASC, id ASC
    LIMIT 1
  ) job;

  SELECT
    count(*) FILTER (WHERE state = 'blocked')::integer,
    count(*) FILTER (WHERE state = 'permanent_failed')::integer,
    count(*) FILTER (WHERE state = 'retryable_failed')::integer,
    count(*) FILTER (WHERE state = 'processing' AND COALESCE(lease_expires_at, now()) < now())::integer
  INTO v_deletion_blocked, v_deletion_permanent, v_deletion_retryable, v_deletion_stale_processing
  FROM public.account_deletion_completion_jobs;

  SELECT
    count(*) FILTER (WHERE state = 'blocked')::integer,
    count(*) FILTER (WHERE state = 'permanent_failed')::integer,
    count(*) FILTER (WHERE state = 'retryable_failed')::integer,
    count(*) FILTER (WHERE state = 'processing' AND COALESCE(lease_expires_at, now()) < now())::integer
  INTO v_support_blocked, v_support_permanent, v_support_retryable, v_support_stale_processing
  FROM public.support_reply_delivery_jobs;

  IF v_deletion_blocked + v_support_blocked + v_deletion_permanent + v_support_permanent > 0
     OR v_deletion_stale_processing + v_support_stale_processing > 0 THEN
    v_status := 'incident';
  ELSIF v_last_run IS NULL
     OR COALESCE((v_last_run ->> 'last_heartbeat_at')::timestamptz, '-infinity'::timestamptz) < now() - v_worker_stale_after
     OR COALESCE(v_cron_job_present, true) = false
     OR v_deletion_retryable + v_support_retryable > 0
     OR COALESCE((v_deletion_counts ->> 'queued')::integer, 0) + COALESCE((v_support_counts ->> 'queued')::integer, 0) > 0 THEN
    v_status := 'degraded';
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'status', v_status,
    'worker_name', v_worker_name,
    'worker_stale_after_minutes', 15,
    'cron_job_present', v_cron_job_present,
    'last_run', v_last_run,
    'account_deletions', jsonb_build_object(
      'counts_by_state', v_deletion_counts,
      'oldest_pending_or_failed', v_deletion_oldest,
      'blocked_count', v_deletion_blocked,
      'permanent_failed_count', v_deletion_permanent,
      'retryable_failed_count', v_deletion_retryable,
      'stale_processing_count', v_deletion_stale_processing
    ),
    'support_delivery', jsonb_build_object(
      'counts_by_state', v_support_counts,
      'oldest_pending_or_failed', v_support_oldest,
      'blocked_count', v_support_blocked,
      'permanent_failed_count', v_support_permanent,
      'retryable_failed_count', v_support_retryable,
      'stale_processing_count', v_support_stale_processing
    )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_admin_durable_job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_admin_durable_job_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_retry_support_reply_delivery_job(
  p_job_id uuid,
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
  v_job public.support_reply_delivery_jobs%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_response jsonb;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_retry_support_reply_delivery_job',
    p_idempotency_key,
    jsonb_build_object('job_id', p_job_id, 'reason', v_reason)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_job
  FROM public.support_reply_delivery_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Support delivery job was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_support_reply_delivery_job', p_idempotency_key, v_response);
  END IF;

  IF v_job.state = 'completed' THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Completed delivery jobs cannot be retried.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_support_reply_delivery_job', p_idempotency_key, v_response);
  END IF;

  IF v_job.state = 'processing' AND COALESCE(v_job.lease_expires_at, now()) >= now() THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Delivery job is currently processing.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_support_reply_delivery_job', p_idempotency_key, v_response);
  END IF;

  UPDATE public.support_reply_delivery_jobs
  SET state = 'queued',
      worker_id = NULL,
      lease_expires_at = NULL,
      attempts = 0,
      next_retry_at = now(),
      last_error = NULL,
      error_code = NULL,
      last_error_at = NULL,
      completed_at = NULL,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_retry', jsonb_build_object(
          'requested_by', v_admin_id,
          'reason', v_reason,
          'requested_at', now()
        )
      ),
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_audit_id := public.log_admin_action(
    'support.reply_delivery_retry_queued',
    'support_reply_delivery_job',
    p_job_id,
    jsonb_build_object(
      'ticket_id', v_job.ticket_id,
      'reply_id', v_job.reply_id,
      'channel', v_job.channel,
      'reason', v_reason,
      'action_outcome', 'queued'
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'job_id', v_job.id,
    'ticket_id', v_job.ticket_id,
    'reply_id', v_job.reply_id,
    'channel', v_job.channel,
    'state', v_job.state,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_support_reply_delivery_job', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_retry_support_reply_delivery_job(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_support_reply_delivery_job(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_retry_account_deletion_completion_job(
  p_job_id uuid,
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
  v_job public.account_deletion_completion_jobs%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_response jsonb;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_retry_account_deletion_completion_job',
    p_idempotency_key,
    jsonb_build_object('job_id', p_job_id, 'reason', v_reason)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_job
  FROM public.account_deletion_completion_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Account deletion completion job was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_account_deletion_completion_job', p_idempotency_key, v_response);
  END IF;

  IF v_job.state = 'completed' THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Completed deletion jobs cannot be retried.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_account_deletion_completion_job', p_idempotency_key, v_response);
  END IF;

  IF v_job.state = 'processing' AND COALESCE(v_job.lease_expires_at, now()) >= now() THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Deletion job is currently processing.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_account_deletion_completion_job', p_idempotency_key, v_response);
  END IF;

  UPDATE public.account_deletion_completion_jobs
  SET state = 'queued',
      worker_id = NULL,
      lease_expires_at = NULL,
      attempts = 0,
      next_retry_at = now(),
      blocked_reason = NULL,
      last_error = NULL,
      error_code = NULL,
      last_error_at = NULL,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_retry', jsonb_build_object(
          'requested_by', v_admin_id,
          'reason', v_reason,
          'requested_at', now()
        )
      ),
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_audit_id := public.log_admin_action(
    'account_deletion.completion_job_retry_queued',
    'account_deletion_completion_job',
    p_job_id,
    jsonb_build_object(
      'deletion_request_id', v_job.deletion_request_id,
      'user_id', v_job.user_id,
      'reason', v_reason,
      'action_outcome', 'queued'
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'job_id', v_job.id,
    'deletion_request_id', v_job.deletion_request_id,
    'user_id', v_job.user_id,
    'state', v_job.state,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_retry_account_deletion_completion_job', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_retry_account_deletion_completion_job(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_account_deletion_completion_job(uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_search_admin_audit_logs(
  p_actor_id uuid DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_include_meta boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_correlation_id text := gen_random_uuid()::text;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'audit.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Audit read permission is required.');
  END IF;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
      AND (
        p_include_meta
        OR al.action_type NOT IN ('admin_audit_logs.searched', 'admin_audit_logs.exported')
      )
  )
  SELECT count(*)::integer INTO v_total FROM filtered;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
      AND (
        p_include_meta
        OR al.action_type NOT IN ('admin_audit_logs.searched', 'admin_audit_logs.exported')
      )
  ),
  page AS (
    SELECT
      al.id,
      al.admin_id,
      admin_profile.name AS admin_name,
      al.action_type,
      al.target_type,
      al.target_id,
      al.details,
      al.request_id,
      al.correlation_id,
      al.action_outcome,
      al.error_code,
      al.created_at
    FROM filtered al
    LEFT JOIN public.profiles admin_profile ON admin_profile.id = al.admin_id
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM page;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details,
    correlation_id,
    action_outcome
  ) VALUES (
    v_admin_id,
    'admin_audit_logs.searched',
    'admin_activity_logs',
    NULL,
    jsonb_build_object(
      'correlation_id', v_correlation_id,
      'filters', jsonb_build_object(
        'actor_id', p_actor_id,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'action_type', p_action_type,
        'from', p_from,
        'to', p_to,
        'limit', v_limit,
        'offset', v_offset,
        'include_meta', p_include_meta
      ),
      'result_count', jsonb_array_length(v_rows),
      'total_count', v_total,
      'action_outcome', 'success'
    ),
    v_correlation_id,
    'success'
  )
  RETURNING id INTO v_audit_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'scope', 'admin_activity_logs',
    'include_meta', p_include_meta,
    'meta_audit_log_id', v_audit_id,
    'correlation_id', v_correlation_id,
    'incident_usage', 'Use action_type, target_type, target_id, actor, and date filters to reconstruct production-impacting admin actions.'
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_events(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_filters jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text;
  v_show_archived boolean := false;
  v_status text;
  v_scope text;
  v_city text;
  v_date_from date;
  v_date_to date;
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_filters := CASE WHEN p_filters IS NULL OR p_filters = 'null'::jsonb THEN '{}'::jsonb ELSE p_filters END;
  IF jsonb_typeof(v_filters) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event filters must be a JSON object.');
  END IF;
  IF v_filters ? 'show_archived' AND lower(COALESCE(v_filters ->> 'show_archived', '')) NOT IN ('true', 'false') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'show_archived filter must be boolean.');
  END IF;

  v_search := NULLIF(btrim(COALESCE(v_filters ->> 'search', '')), '');
  v_show_archived := lower(COALESCE(v_filters ->> 'show_archived', 'false')) = 'true';
  v_status := NULLIF(btrim(COALESCE(v_filters ->> 'status', '')), '');
  v_scope := NULLIF(btrim(COALESCE(v_filters ->> 'scope', '')), '');
  v_city := NULLIF(btrim(COALESCE(v_filters ->> 'city', '')), '');

  BEGIN
    v_date_from := NULLIF(btrim(COALESCE(v_filters ->> 'date_from', '')), '')::date;
    v_date_to := NULLIF(btrim(COALESCE(v_filters ->> 'date_to', '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event date filters must be YYYY-MM-DD values.');
  END;

  WITH filtered AS (
    SELECT
      e.*,
      CASE
        WHEN e.archived_at IS NOT NULL OR lower(COALESCE(e.status, '')) = 'archived' THEN 'archived'
        WHEN lower(COALESCE(e.status, '')) = 'draft' THEN 'draft'
        WHEN lower(COALESCE(e.status, '')) = 'cancelled' THEN 'cancelled'
        WHEN e.ended_at IS NULL
          AND lower(COALESCE(e.status, '')) NOT IN ('draft', 'cancelled')
          AND e.event_date + make_interval(mins => COALESCE(e.duration_minutes, 60)) + interval '10 minutes' <= v_now
          THEN 'needs_finalization_repair'
        WHEN e.ended_at IS NULL
          AND lower(COALESCE(e.status, '')) NOT IN ('draft', 'cancelled')
          AND e.event_date + make_interval(mins => COALESCE(e.duration_minutes, 60)) <= v_now
          AND e.event_date + make_interval(mins => COALESCE(e.duration_minutes, 60)) + interval '10 minutes' > v_now
          THEN 'wrap_up_grace'
        WHEN e.ended_at IS NOT NULL OR lower(COALESCE(e.status, '')) IN ('ended', 'completed') THEN 'ended'
        WHEN e.event_date <= v_now
          AND e.event_date + make_interval(mins => COALESCE(e.duration_minutes, 60)) > v_now
          THEN 'live'
        ELSE 'upcoming'
      END AS admin_status_display
    FROM public.events e
    WHERE (v_show_archived OR e.archived_at IS NULL)
      AND (v_search IS NULL OR position(lower(v_search) in lower(COALESCE(e.title, '') || ' ' || COALESCE(e.description, ''))) > 0)
      AND (v_scope IS NULL OR v_scope = 'all' OR COALESCE(e.scope, 'global') = v_scope)
      AND (v_city IS NULL OR v_city = 'all' OR lower(btrim(COALESCE(e.city, ''))) = lower(v_city))
      AND (v_date_from IS NULL OR e.event_date >= (v_date_from::timestamp AT TIME ZONE 'UTC'))
      AND (v_date_to IS NULL OR e.event_date < ((v_date_to + 1)::timestamp AT TIME ZONE 'UTC'))
  ),
  status_filtered AS (
    SELECT *
    FROM filtered
    WHERE v_status IS NULL OR v_status = 'all' OR admin_status_display = v_status
  ),
  enriched AS (
    SELECT
      status_filtered.*,
      cover.asset_id AS cover_media_asset_id
    FROM status_filtered
    LEFT JOIN LATERAL (
      SELECT r.asset_id
      FROM public.media_references r
      WHERE r.ref_type = 'event_cover'
        AND r.ref_table = 'events'
        AND r.ref_id = status_filtered.id::text
        AND r.ref_key = 'cover_image'
        AND r.is_active = true
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1
    ) cover ON true
  ),
  paged AS (
    SELECT enriched.*
    FROM enriched
    ORDER BY enriched.event_date DESC, enriched.created_at DESC, enriched.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(paged) - 'admin_status_display' ORDER BY paged.event_date DESC, paged.created_at DESC, paged.id DESC) FROM paged), '[]'::jsonb),
    (SELECT count(*)::integer FROM enriched)
  INTO v_rows, v_total
  ;

  RETURN public.admin_json_success(jsonb_build_object(
    'events', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'filters', jsonb_build_object(
      'search', v_search,
      'show_archived', v_show_archived,
      'status', v_status,
      'scope', v_scope,
      'city', v_city,
      'date_from', v_date_from,
      'date_to', v_date_to
    )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_events(jsonb, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_events(jsonb, integer, integer) TO authenticated;

COMMENT ON TABLE public.admin_durable_worker_runs IS
  'One-row liveness/readiness ledger for the durable admin job worker.';
COMMENT ON FUNCTION public.admin_get_admin_durable_job_health() IS
  'Admin operations read model for durable deletion and support delivery job backlog, worker liveness, and cron readiness.';
COMMENT ON FUNCTION public.admin_retry_support_reply_delivery_job(uuid, text, text) IS
  'Safely requeues a non-completed support reply delivery job with audit and target-scoped idempotency.';
COMMENT ON FUNCTION public.admin_retry_account_deletion_completion_job(uuid, text, text) IS
  'Safely requeues a non-completed account deletion completion job with audit and target-scoped idempotency.';
COMMENT ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer, boolean) IS
  'Searches admin audit logs with deterministic ordering; meta-audit rows are hidden unless p_include_meta is true, and every search is audited.';
COMMENT ON FUNCTION public.admin_list_events(jsonb, integer, integer) IS
  'Admin event listing with server-side search, status, scope, city, UTC date pagination filters, total count, and active event-cover asset ids.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260526100000',
  'Admin gap closure definitive',
  'schema+policy',
  'Adds durable worker health and retry RPCs, hides audit meta-noise by default, and changes admin event listing from client-side filtering to server-side paginated filters.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
