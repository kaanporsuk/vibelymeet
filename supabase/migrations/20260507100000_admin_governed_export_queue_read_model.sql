-- Admin governed export queue read model and expanded export scopes.
--
-- Migration class: schema+policy (RPC/read-model governance).
-- Intent: make /kaan Data Export default to governed queued/audited export
-- metadata, while keeping file generation as a deferred worker step.

ALTER TABLE public.data_export_jobs
  DROP CONSTRAINT IF EXISTS data_export_jobs_scope_type_check;

ALTER TABLE public.data_export_jobs
  ADD CONSTRAINT data_export_jobs_scope_type_check
  CHECK (
    scope_type IN (
      'user',
      'reports',
      'support',
      'analytics',
      'audit',
      'events',
      'revenue',
      'messages',
      'notifications',
      'operations',
      'intelligence',
      'compliance'
    )
  );

CREATE INDEX IF NOT EXISTS idx_data_export_jobs_scope_status_time
  ON public.data_export_jobs(scope_type, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_create_data_export_job(
  p_scope_type text,
  p_scope jsonb,
  p_reason text,
  p_pii_classification text DEFAULT 'sensitive'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_request_id uuid;
  v_job_id uuid;
  v_user_id uuid;
  v_event_id uuid;
  v_user_id_text text;
  v_event_id_text text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_rows integer := 0;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'compliance.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Compliance permission is required.');
  END IF;
  IF p_scope_type NOT IN (
    'user',
    'reports',
    'support',
    'analytics',
    'audit',
    'events',
    'revenue',
    'messages',
    'notifications',
    'operations',
    'intelligence',
    'compliance'
  ) THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Export scope is invalid.');
  END IF;
  IF p_pii_classification NOT IN ('aggregate', 'pseudonymous', 'sensitive', 'special_category') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'PII classification is invalid.');
  END IF;
  IF p_scope_type IN ('user', 'reports', 'messages') AND p_pii_classification <> 'special_category' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'This export scope requires special_category PII classification.');
  END IF;
  IF p_scope_type IN ('events', 'revenue', 'support', 'compliance') AND p_pii_classification NOT IN ('sensitive', 'special_category') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'This export scope requires sensitive PII classification or higher.');
  END IF;
  IF p_scope_type IN ('notifications', 'audit', 'operations') AND p_pii_classification NOT IN ('pseudonymous', 'sensitive', 'special_category') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'This export scope requires pseudonymous PII classification or higher.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A reason is required for governed exports.');
  END IF;

  BEGIN
    v_window_start := NULLIF(COALESCE(p_scope, '{}'::jsonb) ->> 'window_start', '')::timestamptz;
    v_window_end := NULLIF(COALESCE(p_scope, '{}'::jsonb) ->> 'window_end', '')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Export date window is invalid.');
  END;

  v_user_id_text := NULLIF(COALESCE(p_scope, '{}'::jsonb) ->> 'user_id', '');
  v_event_id_text := NULLIF(COALESCE(p_scope, '{}'::jsonb) ->> 'event_id', '');

  IF v_user_id_text IS NOT NULL THEN
    IF v_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'User export scope user_id is invalid.');
    END IF;
    v_user_id := v_user_id_text::uuid;
  END IF;

  IF v_event_id_text IS NOT NULL THEN
    IF v_event_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Event export scope event_id is invalid.');
    END IF;
    v_event_id := v_event_id_text::uuid;
  END IF;

  IF p_scope_type = 'user' THEN
    IF v_user_id IS NULL THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'User export scope requires user_id.');
    END IF;

    SELECT
      (SELECT count(*) FROM public.profiles WHERE id = v_user_id)
      + (SELECT count(*) FROM public.support_tickets WHERE user_id = v_user_id)
      + (SELECT count(*) FROM public.user_reports WHERE reporter_id = v_user_id OR reported_id = v_user_id)
      + (SELECT count(*) FROM public.event_registrations WHERE profile_id = v_user_id)
      + (SELECT count(*) FROM public.consent_events WHERE user_id = v_user_id)
      + (SELECT count(*) FROM public.data_subject_requests WHERE user_id = v_user_id)
    INTO v_rows;
  ELSIF p_scope_type = 'reports' THEN
    SELECT
      (SELECT count(*) FROM public.user_reports WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.user_warnings WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.user_suspensions WHERE (v_window_start IS NULL OR suspended_at >= v_window_start) AND (v_window_end IS NULL OR suspended_at <= v_window_end))
      + (SELECT count(*) FROM public.blocked_users WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'support' THEN
    SELECT
      (SELECT count(*) FROM public.support_tickets WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.support_ticket_events WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.support_ticket_replies WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.support_ticket_attachments WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.support_internal_notes WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'audit' THEN
    SELECT count(*)::integer
    INTO v_rows
    FROM public.admin_activity_logs
    WHERE (v_window_start IS NULL OR created_at >= v_window_start)
      AND (v_window_end IS NULL OR created_at <= v_window_end);
  ELSIF p_scope_type = 'events' THEN
    SELECT
      (SELECT count(*) FROM public.events e WHERE (v_event_id IS NULL OR e.id = v_event_id) AND (v_window_start IS NULL OR e.event_date >= v_window_start) AND (v_window_end IS NULL OR e.event_date <= v_window_end))
      + (SELECT count(*) FROM public.event_registrations er JOIN public.events e ON e.id = er.event_id WHERE (v_event_id IS NULL OR er.event_id = v_event_id) AND (v_window_start IS NULL OR e.event_date >= v_window_start) AND (v_window_end IS NULL OR e.event_date <= v_window_end))
      + (SELECT count(*) FROM public.event_payment_exceptions epe WHERE (v_event_id IS NULL OR epe.event_id = v_event_id) AND (v_window_start IS NULL OR epe.created_at >= v_window_start) AND (v_window_end IS NULL OR epe.created_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'revenue' THEN
    SELECT
      (SELECT count(*) FROM public.subscriptions WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.premium_history WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.credit_adjustments WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.user_credits)
      + (SELECT count(*) FROM public.payment_observability_events WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'messages' THEN
    SELECT
      (SELECT count(*) FROM public.matches WHERE (v_window_start IS NULL OR matched_at >= v_window_start) AND (v_window_end IS NULL OR matched_at <= v_window_end))
      + (SELECT count(*) FROM public.messages WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.video_sessions WHERE (v_window_start IS NULL OR started_at >= v_window_start) AND (v_window_end IS NULL OR started_at <= v_window_end))
      + (SELECT count(*) FROM public.date_feedback WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'notifications' THEN
    SELECT
      (SELECT count(*) FROM public.admin_notifications WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.notification_log WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.push_campaigns WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.push_notification_events WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'operations' THEN
    SELECT
      (SELECT count(*) FROM public.media_delete_jobs WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.video_sessions WHERE (v_window_start IS NULL OR started_at >= v_window_start) AND (v_window_end IS NULL OR started_at <= v_window_end))
      + (SELECT count(*) FROM public.match_calls WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.provider_cost_snapshots WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.provider_usage_snapshots WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.quality_budget_observations WHERE (v_window_start IS NULL OR observed_at >= v_window_start) AND (v_window_end IS NULL OR observed_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'intelligence' THEN
    SELECT
      (SELECT count(*) FROM public.trust_triage_snapshots WHERE (v_window_start IS NULL OR generated_at >= v_window_start) AND (v_window_end IS NULL OR generated_at <= v_window_end))
      + (SELECT count(*) FROM public.referral_quality_snapshots WHERE (v_window_start IS NULL OR generated_at >= v_window_start) AND (v_window_end IS NULL OR generated_at <= v_window_end))
      + (SELECT count(*) FROM public.product_metric_definitions WHERE active IS TRUE)
      + (SELECT count(*) FROM public.quality_budget_observations WHERE (v_window_start IS NULL OR observed_at >= v_window_start) AND (v_window_end IS NULL OR observed_at <= v_window_end))
    INTO v_rows;
  ELSIF p_scope_type = 'compliance' THEN
    SELECT
      (SELECT count(*) FROM public.data_subject_requests WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.data_export_jobs WHERE (v_window_start IS NULL OR created_at >= v_window_start) AND (v_window_end IS NULL OR created_at <= v_window_end))
      + (SELECT count(*) FROM public.consent_events WHERE (v_window_start IS NULL OR recorded_at >= v_window_start) AND (v_window_end IS NULL OR recorded_at <= v_window_end))
      + (SELECT count(*) FROM public.retention_policy_registry WHERE active IS TRUE)
    INTO v_rows;
  ELSE
    v_rows := 0;
  END IF;

  INSERT INTO public.data_subject_requests (
    user_id,
    request_type,
    status,
    reason,
    requested_by,
    metadata
  ) VALUES (
    v_user_id,
    CASE WHEN p_scope_type = 'user' THEN 'export' ELSE 'access' END,
    'queued',
    p_reason,
    v_admin_id,
    jsonb_build_object('scope_type', p_scope_type, 'scope', COALESCE(p_scope, '{}'::jsonb))
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.data_export_jobs (
    request_id,
    created_by,
    scope_type,
    scope,
    reason,
    pii_classification,
    row_count_estimate
  ) VALUES (
    v_request_id,
    v_admin_id,
    p_scope_type,
    COALESCE(p_scope, '{}'::jsonb),
    p_reason,
    p_pii_classification,
    COALESCE(v_rows, 0)
  )
  RETURNING id INTO v_job_id;

  v_audit_id := public.log_admin_action(
    'compliance.export_queued',
    'data_export_job',
    v_job_id,
    jsonb_build_object(
      'request_id', v_request_id,
      'scope_type', p_scope_type,
      'scope', COALESCE(p_scope, '{}'::jsonb),
      'pii_classification', p_pii_classification,
      'row_count_estimate', COALESCE(v_rows, 0),
      'expires_in_days', 7
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'request_id', v_request_id,
    'job_id', v_job_id,
    'status', 'queued',
    'row_count_estimate', COALESCE(v_rows, 0),
    'expires_at', (now() + interval '7 days'),
    'audit_log_id', v_audit_id,
    'storage_path', NULL,
    'generation_semantics', 'P4 queues an audited governed export job. File generation/storage delivery remains a controlled worker step.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_data_export_jobs(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_scope_type text := NULLIF(COALESCE(p_filters, '{}'::jsonb) ->> 'scope_type', '');
  v_status text := NULLIF(COALESCE(p_filters, '{}'::jsonb) ->> 'status', '');
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'compliance.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Compliance permission is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_total
  FROM public.data_export_jobs dej
  WHERE (v_scope_type IS NULL OR dej.scope_type = v_scope_type)
    AND (v_status IS NULL OR dej.status = v_status);

  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      dej.id,
      dej.request_id,
      dej.created_by,
      p.name AS created_by_name,
      dej.scope_type,
      dej.scope,
      dej.reason,
      dej.status,
      dej.pii_classification,
      dej.row_count_estimate,
      dej.storage_path,
      dej.expires_at,
      dej.created_at,
      dej.completed_at,
      dej.error_message
    FROM public.data_export_jobs dej
    LEFT JOIN public.profiles p ON p.id = dej.created_by
    WHERE (v_scope_type IS NULL OR dej.scope_type = v_scope_type)
      AND (v_status IS NULL OR dej.status = v_status)
    ORDER BY dej.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'semantics', 'Read-only governed export job metadata. storage_path is null until controlled file generation completes.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_data_export_job(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_job jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'compliance.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Compliance permission is required.');
  END IF;

  SELECT to_jsonb(job_row)
  INTO v_job
  FROM (
    SELECT
      dej.id,
      dej.request_id,
      dej.created_by,
      p.name AS created_by_name,
      dej.scope_type,
      dej.scope,
      dej.reason,
      dej.status,
      dej.pii_classification,
      dej.row_count_estimate,
      dej.storage_path,
      dej.expires_at,
      dej.created_at,
      dej.completed_at,
      dej.error_message,
      dsr.request_type,
      dsr.status AS request_status,
      dsr.user_id AS request_user_id
    FROM public.data_export_jobs dej
    LEFT JOIN public.profiles p ON p.id = dej.created_by
    LEFT JOIN public.data_subject_requests dsr ON dsr.id = dej.request_id
    WHERE dej.id = p_job_id
  ) job_row;

  IF v_job IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Export job not found.');
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'job', v_job,
    'semantics', 'Read-only governed export job detail. Download URLs are intentionally absent until controlled file generation is implemented.'
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_data_export_jobs(integer, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_data_export_job(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_data_export_jobs(integer, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_data_export_job(uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507100000',
  'Admin governed export queue read model',
  'schema+policy',
  'Expands governed export metadata scopes and adds read-only export-job list/detail RPCs. No export files are generated and no provider systems are mutated.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_list_data_export_jobs(integer, integer, jsonb) IS
  'P4 read-only governed export job list for /kaan Data Export.';
COMMENT ON FUNCTION public.admin_get_data_export_job(uuid) IS
  'P4 read-only governed export job detail for /kaan Data Export.';
