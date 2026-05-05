-- DB lint error cleanup.
--
-- Preserve the existing public RPC contracts while removing live plpgsql_check
-- errors from admin audit inserts and the stale Vibe Video watchdog.

CREATE OR REPLACE FUNCTION public.admin_create_event_payment_exception(
  p_event_id uuid,
  p_profile_id uuid,
  p_exception_type text,
  p_exception_status text DEFAULT 'open',
  p_checkout_session_id text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_settlement_outcome text;
  v_admission_status text;
  v_event_status text;
  v_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_event_id IS NULL OR p_profile_id IS NULL OR p_exception_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_args');
  END IF;

  IF p_exception_type NOT IN (
    'refund_requested',
    'refund_handled_externally',
    'payment_mismatch',
    'registration_corrected',
    'cancelled_after_payment',
    'support_exception'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_type');
  END IF;

  IF p_exception_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_status');
  END IF;

  SELECT er.admission_status
  INTO v_admission_status
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_profile_id
  LIMIT 1;

  SELECT e.status
  INTO v_event_status
  FROM public.events e
  WHERE e.id = p_event_id;

  IF p_checkout_session_id IS NOT NULL THEN
    SELECT s.outcome
    INTO v_settlement_outcome
    FROM public.stripe_event_ticket_settlements s
    WHERE s.checkout_session_id = p_checkout_session_id
    LIMIT 1;
  ELSE
    SELECT s.outcome
    INTO v_settlement_outcome
    FROM public.stripe_event_ticket_settlements s
    WHERE s.event_id = p_event_id
      AND s.profile_id = p_profile_id
    ORDER BY s.created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.event_payment_exceptions (
    event_id,
    profile_id,
    checkout_session_id,
    support_ticket_id,
    exception_type,
    exception_status,
    settlement_outcome_snapshot,
    registration_admission_snapshot,
    event_status_snapshot,
    notes,
    created_by,
    resolved_by,
    resolved_at
  ) VALUES (
    p_event_id,
    p_profile_id,
    p_checkout_session_id,
    p_support_ticket_id,
    p_exception_type,
    p_exception_status,
    v_settlement_outcome,
    v_admission_status,
    v_event_status,
    p_notes,
    v_admin_id,
    CASE WHEN p_exception_status = 'resolved' THEN v_admin_id ELSE NULL END,
    CASE WHEN p_exception_status = 'resolved' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;

  IF p_support_ticket_id IS NOT NULL THEN
    UPDATE public.support_tickets
    SET
      event_id = p_event_id,
      checkout_session_id = COALESCE(p_checkout_session_id, checkout_session_id),
      event_payment_exception_id = v_id
    WHERE id = p_support_ticket_id;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    'create_event_payment_exception',
    'event_payment_exception',
    v_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'profile_id', p_profile_id,
      'checkout_session_id', p_checkout_session_id,
      'support_ticket_id', p_support_ticket_id,
      'exception_type', p_exception_type,
      'exception_status', p_exception_status,
      'settlement_outcome_snapshot', v_settlement_outcome,
      'registration_admission_snapshot', v_admission_status,
      'event_status_snapshot', v_event_status
    )
  );

  RETURN jsonb_build_object('success', true, 'exception_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text) IS
  'Admin helper for creating event payment exception cases. Audit target_id remains the exception UUID.';

CREATE OR REPLACE FUNCTION public.admin_transition_event_payment_exception(
  p_exception_id uuid,
  p_exception_type text DEFAULT NULL,
  p_exception_status text DEFAULT NULL,
  p_resolution text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_refund_handled_externally boolean DEFAULT NULL,
  p_external_refund_reference text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before record;
  v_after record;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_before
  FROM public.event_payment_exceptions
  WHERE id = p_exception_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF p_exception_type IS NOT NULL AND p_exception_type NOT IN (
    'refund_requested',
    'refund_handled_externally',
    'payment_mismatch',
    'registration_corrected',
    'cancelled_after_payment',
    'support_exception'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_type');
  END IF;

  IF p_exception_status IS NOT NULL
     AND p_exception_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_status');
  END IF;

  UPDATE public.event_payment_exceptions
  SET
    exception_type = COALESCE(p_exception_type, exception_type),
    exception_status = COALESCE(p_exception_status, exception_status),
    resolution = COALESCE(p_resolution, resolution),
    notes = COALESCE(p_notes, notes),
    refund_handled_externally = COALESCE(p_refund_handled_externally, refund_handled_externally),
    external_refund_reference = COALESCE(p_external_refund_reference, external_refund_reference),
    support_ticket_id = COALESCE(p_support_ticket_id, support_ticket_id),
    resolved_by = CASE
      WHEN COALESCE(p_exception_status, exception_status) = 'resolved' THEN v_admin_id
      ELSE resolved_by
    END,
    resolved_at = CASE
      WHEN COALESCE(p_exception_status, exception_status) = 'resolved' THEN now()
      ELSE resolved_at
    END,
    settlement_outcome_snapshot = COALESCE(
      (
        SELECT s.outcome
        FROM public.stripe_event_ticket_settlements s
        WHERE s.checkout_session_id = COALESCE(v_before.checkout_session_id, s.checkout_session_id)
          AND s.event_id = v_before.event_id
          AND s.profile_id = v_before.profile_id
        ORDER BY s.created_at DESC
        LIMIT 1
      ),
      settlement_outcome_snapshot
    ),
    registration_admission_snapshot = COALESCE(
      (
        SELECT er.admission_status
        FROM public.event_registrations er
        WHERE er.event_id = v_before.event_id
          AND er.profile_id = v_before.profile_id
        LIMIT 1
      ),
      registration_admission_snapshot
    ),
    event_status_snapshot = COALESCE(
      (
        SELECT e.status
        FROM public.events e
        WHERE e.id = v_before.event_id
      ),
      event_status_snapshot
    )
  WHERE id = p_exception_id;

  SELECT * INTO v_after
  FROM public.event_payment_exceptions
  WHERE id = p_exception_id;

  IF v_after.support_ticket_id IS NOT NULL THEN
    UPDATE public.support_tickets
    SET
      event_id = v_after.event_id,
      checkout_session_id = COALESCE(v_after.checkout_session_id, checkout_session_id),
      event_payment_exception_id = v_after.id
    WHERE id = v_after.support_ticket_id;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    'transition_event_payment_exception',
    'event_payment_exception',
    p_exception_id,
    jsonb_build_object(
      'before_exception_type', v_before.exception_type,
      'after_exception_type', v_after.exception_type,
      'before_exception_status', v_before.exception_status,
      'after_exception_status', v_after.exception_status,
      'before_resolution', v_before.resolution,
      'after_resolution', v_after.resolution,
      'before_refund_handled_externally', v_before.refund_handled_externally,
      'after_refund_handled_externally', v_after.refund_handled_externally,
      'before_external_refund_reference', v_before.external_refund_reference,
      'after_external_refund_reference', v_after.external_refund_reference,
      'event_id', v_after.event_id,
      'profile_id', v_after.profile_id,
      'support_ticket_id', v_after.support_ticket_id,
      'checkout_session_id', v_after.checkout_session_id
    )
  );

  RETURN jsonb_build_object('success', true, 'exception_id', p_exception_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid) IS
  'Admin helper for transitioning event payment exception cases. Audit target_id remains the exception UUID.';

CREATE OR REPLACE FUNCTION public.mark_stale_vibe_video_uploads_failed(
  p_stale_minutes int DEFAULT 45,
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_stale_minutes int := GREATEST(COALESCE(p_stale_minutes, 45), 10);
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_candidates jsonb := '[]'::jsonb;
  v_candidate_count int := 0;
  v_classifications jsonb := '{}'::jsonb;
  v_profile_count int := 0;
  v_session_count int := 0;
  v_profile_video_count int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  WITH candidates AS (
    SELECT
      p.id AS user_id,
      btrim(p.bunny_video_uid) AS provider_id,
      COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') AS profile_status,
      dms.id AS session_id,
      dms.status AS session_status,
      COALESCE(dms.updated_at, p.updated_at) AS last_activity_at
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT id, status, created_at, updated_at
      FROM public.draft_media_sessions dms
      WHERE dms.user_id = p.id
        AND dms.media_type = 'vibe_video'
        AND dms.provider_id = btrim(p.bunny_video_uid)
        AND dms.status IN ('created', 'uploading', 'processing')
      ORDER BY dms.updated_at DESC, dms.created_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ) dms ON true
    WHERE p.bunny_video_uid IS NOT NULL
      AND btrim(p.bunny_video_uid) <> ''
      AND COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') IN ('uploading', 'processing')
      AND COALESCE(dms.updated_at, p.updated_at) < now() - make_interval(mins => v_stale_minutes)
    ORDER BY COALESCE(dms.updated_at, p.updated_at) ASC
    LIMIT v_limit
    FOR UPDATE OF p SKIP LOCKED
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN session_id IS NULL THEN 'profile_' || profile_status || '_without_active_session'
        WHEN session_status = 'created' THEN 'session_created_without_upload_progress'
        WHEN session_status = 'uploading' THEN 'session_uploading_stale'
        WHEN session_status = 'processing' THEN 'session_processing_stale'
        ELSE 'profile_' || profile_status || '_stale'
      END AS classification
    FROM candidates
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
          'provider_id', provider_id,
          'profile_status', profile_status,
          'session_id', session_id,
          'session_status', session_status,
          'classification', classification,
          'last_activity_at', last_activity_at
        )
        ORDER BY last_activity_at ASC
      ),
      '[]'::jsonb
    ),
    count(*)::int,
    COALESCE(
      (
        SELECT jsonb_object_agg(classification, n)
        FROM (
          SELECT classification, count(*) AS n
          FROM classified
          GROUP BY classification
        ) grouped
      ),
      '{}'::jsonb
    )
  INTO v_candidates, v_candidate_count, v_classifications
  FROM classified;

  UPDATE public.draft_media_sessions dms
  SET status = 'failed',
      error_detail = COALESCE(dms.error_detail, 'stale_vibe_video_upload_watchdog')
  FROM jsonb_to_recordset(v_candidates) AS c(
    user_id uuid,
    provider_id text,
    session_id uuid
  )
  WHERE dms.id = c.session_id
    AND dms.user_id = c.user_id
    AND dms.media_type = 'vibe_video'
    AND dms.provider_id = c.provider_id
    AND dms.status IN ('created', 'uploading', 'processing');

  GET DIAGNOSTICS v_session_count = ROW_COUNT;

  UPDATE public.profile_vibe_videos pvv
  SET video_status = 'failed'
  FROM public.media_assets ma,
    jsonb_to_recordset(v_candidates) AS c(
      user_id uuid,
      provider_id text
    )
  WHERE pvv.user_id = c.user_id
    AND pvv.asset_id = ma.id
    AND pvv.is_active = true
    AND ma.provider = 'bunny_stream'
    AND ma.provider_object_id = c.provider_id
    AND pvv.video_status IN ('uploading', 'processing');

  GET DIAGNOSTICS v_profile_video_count = ROW_COUNT;

  UPDATE public.profiles p
  SET bunny_video_status = 'failed',
      updated_at = now()
  FROM jsonb_to_recordset(v_candidates) AS c(
    user_id uuid,
    provider_id text
  )
  WHERE p.id = c.user_id
    AND btrim(p.bunny_video_uid) = c.provider_id
    AND COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') IN ('uploading', 'processing');

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'stale_minutes', v_stale_minutes,
    'limit', v_limit,
    'candidate_count', v_candidate_count,
    'profile_rows_marked_failed', v_profile_count,
    'session_rows_marked_failed', v_session_count,
    'profile_vibe_video_rows_marked_failed', v_profile_video_count,
    'classifications', v_classifications
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) TO service_role;

COMMENT ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) IS
  'Service-role repair helper for stale Vibe Video current profile UIDs. Marks stale uploading/processing rows failed, preserves bunny_video_uid for score/history, and never deletes provider media.';
