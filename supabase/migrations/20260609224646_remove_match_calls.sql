-- Remove the non-golden Chat Match Calls product surface.
--
-- This is forward-only cleanup. Golden Video Date remains on daily-room
-- prepare_date_entry/video_date_leave/delete_room and public.video_sessions.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'expire-stale-match-calls',
      'expire_stale_match_calls',
      'match-call-room-cleanup'
    );
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'match-call cron unschedule skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'match_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.match_calls;
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'match_calls realtime publication removal skipped: %', SQLERRM;
END $$;

DROP FUNCTION IF EXISTS public.match_call_transition(uuid, text, text);
DROP FUNCTION IF EXISTS public.match_call_transition(uuid, text);
DROP FUNCTION IF EXISTS public.expire_stale_match_calls();

ALTER TABLE IF EXISTS public.notification_preferences
  DROP COLUMN IF EXISTS notify_match_calls;

CREATE OR REPLACE FUNCTION public.unmatch_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_user_a uuid;
  v_user_b uuid;
  v_messages_deleted int := 0;
  v_mutes_deleted int := 0;
  v_archives_deleted int := 0;
  v_matches_deleted int := 0;
  v_date_proposals_closed int := 0;
  v_date_suggestions_closed int := 0;
  v_date_plans_closed int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'code', 'already_unmatched', 'match_id', p_match_id);
  END IF;

  IF v_uid NOT IN (v_match.profile_id_1, v_match.profile_id_2) THEN
    RETURN jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'access_denied');
  END IF;

  v_user_a := v_match.profile_id_1;
  v_user_b := v_match.profile_id_2;

  UPDATE public.date_proposals
  SET
    status = 'declined',
    responded_at = COALESCE(responded_at, now())
  WHERE match_id = p_match_id
    AND status = 'pending';
  GET DIAGNOSTICS v_date_proposals_closed = ROW_COUNT;

  UPDATE public.date_plans dp
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(dp.cancelled_at, now())
  FROM public.date_suggestions ds
  WHERE dp.id = ds.date_plan_id
    AND ds.match_id = p_match_id
    AND dp.status = 'active';
  GET DIAGNOSTICS v_date_plans_closed = ROW_COUNT;

  UPDATE public.date_suggestions
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE match_id = p_match_id
    AND status IN ('draft', 'proposed', 'viewed', 'countered');
  GET DIAGNOSTICS v_date_suggestions_closed = ROW_COUNT;

  DELETE FROM public.match_archives
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_archives_deleted = ROW_COUNT;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_mutes_deleted = ROW_COUNT;

  DELETE FROM public.messages
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  DELETE FROM public.matches
  WHERE id = p_match_id;
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'unmatched',
    'match_id', p_match_id,
    'unmatched_by', v_uid,
    'profile_id_1', v_user_a,
    'profile_id_2', v_user_b,
    'cleanup', jsonb_build_object(
      'messages_deleted', v_messages_deleted,
      'mutes_deleted', v_mutes_deleted,
      'archives_deleted', v_archives_deleted,
      'matches_deleted', v_matches_deleted,
      'date_proposals_closed', v_date_proposals_closed,
      'date_suggestions_closed', v_date_suggestions_closed,
      'date_plans_closed', v_date_plans_closed
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_user_with_cleanup(
  p_blocked_id uuid,
  p_reason text DEFAULT NULL,
  p_match_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_blocker_id uuid := auth.uid();
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '');
  v_inserted boolean := false;
  v_match_ids uuid[] := '{}'::uuid[];
  v_session_ids uuid[] := '{}'::uuid[];
  v_messages_deleted int := 0;
  v_mutes_deleted int := 0;
  v_matches_deleted int := 0;
  v_date_proposals_closed int := 0;
  v_date_suggestions_closed int := 0;
  v_date_plans_closed int := 0;
  v_daily_drops_invalidated int := 0;
  v_event_vibes_deleted int := 0;
  v_video_sessions_closed int := 0;
  v_registrations_cleared int := 0;
BEGIN
  IF v_blocker_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_blocked_id IS NULL OR p_blocked_id = v_blocker_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_target', 'error', 'invalid_target');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_blocker_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'profile_not_found', 'error', 'profile_not_found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_blocked_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'target_not_found', 'error', 'target_not_found');
  END IF;

  INSERT INTO public.blocked_users (blocker_id, blocked_id, reason)
  VALUES (v_blocker_id, p_blocked_id, v_reason)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  RETURNING true INTO v_inserted;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO v_match_ids
  FROM (
    SELECT id
    FROM public.matches
    WHERE (profile_id_1 = LEAST(v_blocker_id, p_blocked_id)
       AND profile_id_2 = GREATEST(v_blocker_id, p_blocked_id))
       OR (profile_id_1 = v_blocker_id AND profile_id_2 = p_blocked_id)
       OR (profile_id_1 = p_blocked_id AND profile_id_2 = v_blocker_id)
    FOR UPDATE
  ) pair_matches;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO v_session_ids
  FROM (
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND (
        (participant_1_id = v_blocker_id AND participant_2_id = p_blocked_id)
        OR (participant_1_id = p_blocked_id AND participant_2_id = v_blocker_id)
      )
    FOR UPDATE
  ) pair_sessions;

  UPDATE public.date_proposals
  SET
    status = 'declined',
    responded_at = COALESCE(responded_at, now())
  WHERE ((proposer_id = v_blocker_id AND recipient_id = p_blocked_id)
      OR (proposer_id = p_blocked_id AND recipient_id = v_blocker_id)
      OR match_id = ANY(v_match_ids))
    AND status = 'pending';
  GET DIAGNOSTICS v_date_proposals_closed = ROW_COUNT;

  UPDATE public.date_plans dp
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(dp.cancelled_at, now())
  FROM public.date_suggestions ds
  WHERE dp.id = ds.date_plan_id
    AND dp.status = 'active'
    AND (
      ds.match_id = ANY(v_match_ids)
      OR (ds.proposer_id = v_blocker_id AND ds.recipient_id = p_blocked_id)
      OR (ds.proposer_id = p_blocked_id AND ds.recipient_id = v_blocker_id)
    );
  GET DIAGNOSTICS v_date_plans_closed = ROW_COUNT;

  UPDATE public.date_suggestions
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE (match_id = ANY(v_match_ids)
      OR (proposer_id = v_blocker_id AND recipient_id = p_blocked_id)
      OR (proposer_id = p_blocked_id AND recipient_id = v_blocker_id))
    AND status IN ('draft', 'proposed', 'viewed', 'countered');
  GET DIAGNOSTICS v_date_suggestions_closed = ROW_COUNT;

  UPDATE public.daily_drops
  SET
    status = 'invalidated',
    updated_at = now()
  WHERE user_a_id = LEAST(v_blocker_id, p_blocked_id)
    AND user_b_id = GREATEST(v_blocker_id, p_blocked_id)
    AND status IN ('active_unopened', 'active_viewed', 'active_opener_sent');
  GET DIAGNOSTICS v_daily_drops_invalidated = ROW_COUNT;

  DELETE FROM public.event_vibes
  WHERE (sender_id = v_blocker_id AND receiver_id = p_blocked_id)
     OR (sender_id = p_blocked_id AND receiver_id = v_blocker_id);
  GET DIAGNOSTICS v_event_vibes_deleted = ROW_COUNT;

  UPDATE public.video_sessions
  SET
    ended_at = COALESCE(ended_at, now()),
    ended_reason = COALESCE(ended_reason, 'blocked_pair'),
    state = 'ended'::public.video_date_state,
    state_updated_at = now(),
    phase = 'ended',
    ready_gate_status = CASE
      WHEN ready_gate_status IN ('forfeited', 'expired') THEN ready_gate_status
      ELSE 'forfeited'
    END
  WHERE id = ANY(v_session_ids);
  GET DIAGNOSTICS v_video_sessions_closed = ROW_COUNT;

  UPDATE public.event_registrations
  SET
    current_room_id = NULL,
    current_partner_id = NULL,
    queue_status = CASE
      WHEN queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date', 'in_survey') THEN 'browsing'
      ELSE queue_status
    END,
    last_active_at = now()
  WHERE current_room_id = ANY(v_session_ids)
     OR (profile_id = v_blocker_id AND current_partner_id = p_blocked_id)
     OR (profile_id = p_blocked_id AND current_partner_id = v_blocker_id);
  GET DIAGNOSTICS v_registrations_cleared = ROW_COUNT;

  DELETE FROM public.messages
  WHERE match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_mutes_deleted = ROW_COUNT;

  DELETE FROM public.matches
  WHERE id = ANY(v_match_ids);
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', CASE WHEN COALESCE(v_inserted, false) THEN 'blocked' ELSE 'already_blocked' END,
    'status', CASE WHEN COALESCE(v_inserted, false) THEN 'blocked' ELSE 'already_blocked' END,
    'blocked_id', p_blocked_id,
    'hint_match_id', p_match_id,
    'cleanup', jsonb_build_object(
      'matches_found', COALESCE(array_length(v_match_ids, 1), 0),
      'messages_deleted', v_messages_deleted,
      'mutes_deleted', v_mutes_deleted,
      'matches_deleted', v_matches_deleted,
      'date_proposals_closed', v_date_proposals_closed,
      'date_suggestions_closed', v_date_suggestions_closed,
      'date_plans_closed', v_date_plans_closed,
      'daily_drops_invalidated', v_daily_drops_invalidated,
      'event_vibes_deleted', v_event_vibes_deleted,
      'video_sessions_closed', v_video_sessions_closed,
      'registrations_cleared', v_registrations_cleared
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_provider_health(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_stripe_recent integer := 0;
  v_stripe_failed integer := 0;
  v_payment_failed integer := 0;
  v_bunny_failed_jobs integer := 0;
  v_bunny_stale_assets integer := 0;
  v_daily_stale_video_sessions integer := 0;
  v_onesignal_missing_players integer := 0;
  v_onesignal_suppressed_24h integer := 0;
  v_push_telemetry_24h integer := 0;
  v_overall text := 'healthy';
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'providers.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Provider health permission is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_stripe_recent
  FROM public.stripe_webhook_events
  WHERE received_at >= p_now - interval '24 hours';

  SELECT count(*)::integer
  INTO v_stripe_failed
  FROM public.stripe_webhook_events
  WHERE received_at >= p_now - interval '24 hours'
    AND status = 'failed';

  SELECT count(*)::integer
  INTO v_payment_failed
  FROM public.payment_observability_events
  WHERE created_at >= p_now - interval '24 hours'
    AND status IN ('failed', 'error');

  SELECT count(*)::integer
  INTO v_bunny_failed_jobs
  FROM public.media_delete_jobs
  WHERE provider IN ('bunny_stream', 'bunny_storage')
    AND status IN ('failed', 'abandoned');

  SELECT count(*)::integer
  INTO v_bunny_stale_assets
  FROM public.media_assets
  WHERE provider IN ('bunny_stream', 'bunny_storage')
    AND status = 'uploading'
    AND created_at < p_now - interval '2 hours';

  SELECT count(*)::integer
  INTO v_daily_stale_video_sessions
  FROM public.video_sessions
  WHERE ended_at IS NULL
    AND daily_room_name IS NOT NULL
    AND started_at < p_now - interval '4 hours';

  SELECT count(*)::integer
  INTO v_onesignal_missing_players
  FROM public.notification_preferences
  WHERE push_enabled IS TRUE
    AND onesignal_subscribed IS TRUE
    AND NULLIF(btrim(COALESCE(onesignal_player_id, '')), '') IS NULL;

  SELECT count(*)::integer
  INTO v_onesignal_suppressed_24h
  FROM public.notification_log
  WHERE created_at >= p_now - interval '24 hours'
    AND delivered IS NOT TRUE;

  SELECT count(*)::integer
  INTO v_push_telemetry_24h
  FROM public.push_notification_events
  WHERE created_at >= p_now - interval '24 hours';

  IF v_stripe_failed > 0 OR v_payment_failed > 0 OR v_bunny_failed_jobs > 0 OR v_daily_stale_video_sessions > 0 THEN
    v_overall := 'degraded';
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', p_now,
    'overall_status', v_overall,
    'provider_checks_are_app_layer_only', true,
    'providers', jsonb_build_array(
      jsonb_build_object(
        'id', 'stripe',
        'label', 'Stripe',
        'status', CASE WHEN v_stripe_failed > 0 OR v_payment_failed > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('webhook_events_24h', v_stripe_recent, 'payment_observability_failures_24h', v_payment_failed),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Compare Stripe Dashboard webhooks, checkout sessions, subscriptions, and invoices.'),
        'drift_count', v_stripe_failed + v_payment_failed
      ),
      jsonb_build_object(
        'id', 'bunny',
        'label', 'Bunny',
        'status', CASE WHEN v_bunny_failed_jobs > 0 OR v_bunny_stale_assets > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('failed_delete_jobs', v_bunny_failed_jobs, 'stale_uploading_assets', v_bunny_stale_assets),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Check Bunny Stream object status, webhook freshness, and CDN playback separately.'),
        'drift_count', v_bunny_failed_jobs + v_bunny_stale_assets
      ),
      jsonb_build_object(
        'id', 'daily',
        'label', 'Daily',
        'status', CASE WHEN v_daily_stale_video_sessions > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('stale_video_sessions', v_daily_stale_video_sessions),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Check Daily rooms and cleanup results for stale video-date room drift.'),
        'drift_count', v_daily_stale_video_sessions
      ),
      jsonb_build_object(
        'id', 'onesignal',
        'label', 'OneSignal',
        'status', CASE WHEN v_onesignal_missing_players > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('missing_player_ids', v_onesignal_missing_players, 'suppressed_notification_logs_24h', v_onesignal_suppressed_24h, 'push_telemetry_rows_24h', v_push_telemetry_24h),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Compare OneSignal app ID, subscriptions, accepted sends, and webhook telemetry.'),
        'drift_count', v_onesignal_missing_players
      ),
      jsonb_build_object(
        'id', 'supabase',
        'label', 'Supabase',
        'status', 'healthy',
        'app_truth', jsonb_build_object('database_rpc', 'available'),
        'provider_truth', jsonb_build_object('status', 'partially_visible_from_database', 'runbook', 'Use Supabase CLI/dashboard for deployed function inventory, secrets, buckets, and auth settings.'),
        'drift_count', 0
      )
    )
  ));
END;
$function$;

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

REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unmatch_match(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_provider_health(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_health(timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.unmatch_match(uuid) IS
  'Atomically removes a match for both participants and cleans match-scoped messages, mutes, archive state, and date coordination rows.';

COMMENT ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) IS
  'Server-owned block action that severs matches, messages, mutes, Daily Drops, event vibes, active Video Date sessions, and date coordination rows for the blocked pair.';

COMMENT ON FUNCTION public.admin_get_provider_health(timestamptz) IS
  'Admin provider-health read model. Daily health covers golden Video Date room drift only.';

COMMENT ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) IS
  'P4 queues an audited governed export job without the removed match_calls table scope.';

DROP TABLE IF EXISTS public.match_calls CASCADE;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260609224646',
  'Remove Match Calls',
  'destructive',
  'Drops non-golden Chat Match Calls table/RPC/cron/preference and rewrites active cleanup/admin RPCs to avoid match_calls. Golden Video Date and Chat messages remain intact.',
  true
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
