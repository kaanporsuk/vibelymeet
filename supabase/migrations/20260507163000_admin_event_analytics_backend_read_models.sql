-- Admin Event Analytics backend read models.
--
-- Moves the remaining Event Analytics browser table reads behind explicit,
-- permission-checked read models. Public events RLS and user discovery behavior
-- are intentionally unchanged.

CREATE OR REPLACE FUNCTION public.admin_list_event_analytics_options(
  p_limit integer DEFAULT 50,
  p_include_archived boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_include_archived boolean := COALESCE(p_include_archived, true);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Intelligence read permission is required.');
  END IF;

  WITH filtered AS (
    SELECT
      e.id,
      e.title,
      e.event_date,
      e.duration_minutes,
      e.status,
      e.ended_at,
      e.archived_at,
      count(*) OVER ()::integer AS total_count
    FROM public.events e
    WHERE (v_include_archived OR e.archived_at IS NULL)
    ORDER BY e.event_date DESC, e.created_at DESC, e.id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', filtered.id,
        'title', filtered.title,
        'event_date', filtered.event_date,
        'duration_minutes', filtered.duration_minutes,
        'status', filtered.status,
        'ended_at', filtered.ended_at,
        'archived_at', filtered.archived_at
      )
      ORDER BY filtered.event_date DESC, filtered.id DESC
    ), '[]'::jsonb),
    COALESCE(max(filtered.total_count), 0)
  INTO v_rows, v_total
  FROM filtered;

  RETURN public.admin_json_success(jsonb_build_object(
    'events', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'include_archived', v_include_archived
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_event_live_analytics(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event_date timestamptz;
  v_event_duration_minutes integer;
  v_active_users integer := 0;
  v_browsing integer := 0;
  v_in_ready_gate integer := 0;
  v_in_dates integer := 0;
  v_in_survey integer := 0;
  v_in_queue integer := 0;
  v_registrations integer := 0;
  v_confirmed integer := 0;
  v_waitlisted integer := 0;
  v_attended integer := 0;
  v_attendance_marked integer := 0;
  v_no_show integer := 0;
  v_gender_count jsonb := jsonb_build_object('man', 0, 'woman', 0, 'non-binary', 0);
  v_video_sessions integer := 0;
  v_completed_sessions integer := 0;
  v_mutual_vibes integer := 0;
  v_extended_sessions integer := 0;
  v_avg_duration integer := 0;
  v_match_rate integer := 0;
  v_extension_rate integer := 0;
  v_matches integer := 0;
  v_participant_reports integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Intelligence read permission is required.');
  END IF;

  SELECT e.event_date, e.duration_minutes
  INTO v_event_date, v_event_duration_minutes
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  SELECT
    count(*) FILTER (WHERE er.queue_status IS NOT NULL AND er.queue_status NOT IN ('idle', 'offline', 'completed'))::integer,
    count(*) FILTER (WHERE er.queue_status = 'browsing')::integer,
    count(*) FILTER (WHERE er.queue_status = 'in_ready_gate')::integer,
    count(*) FILTER (WHERE er.queue_status IN ('in_handshake', 'in_date'))::integer,
    count(*) FILTER (WHERE er.queue_status = 'in_survey')::integer,
    count(*) FILTER (WHERE er.queue_status = 'searching')::integer,
    count(*)::integer,
    count(*) FILTER (WHERE er.admission_status = 'confirmed')::integer,
    count(*) FILTER (WHERE er.admission_status = 'waitlisted')::integer,
    count(*) FILTER (WHERE er.attended IS TRUE)::integer,
    count(*) FILTER (WHERE er.attendance_marked IS TRUE)::integer,
    count(*) FILTER (WHERE er.attendance_marked IS TRUE AND er.attended IS NOT TRUE)::integer,
    jsonb_build_object(
      'man', count(*) FILTER (WHERE p.gender = 'man')::integer,
      'woman', count(*) FILTER (WHERE p.gender = 'woman')::integer,
      'non-binary', count(*) FILTER (WHERE p.gender = 'non-binary')::integer
    )
  INTO
    v_active_users,
    v_browsing,
    v_in_ready_gate,
    v_in_dates,
    v_in_survey,
    v_in_queue,
    v_registrations,
    v_confirmed,
    v_waitlisted,
    v_attended,
    v_attendance_marked,
    v_no_show,
    v_gender_count
  FROM public.event_registrations er
  LEFT JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE vs.ended_at IS NOT NULL)::integer,
    count(*) FILTER (WHERE vs.ended_at IS NOT NULL AND vs.participant_1_liked IS TRUE AND vs.participant_2_liked IS TRUE)::integer,
    count(*) FILTER (WHERE vs.ended_at IS NOT NULL AND COALESCE(vs.duration_seconds, 0) > 60)::integer,
    COALESCE(round(avg(COALESCE(vs.duration_seconds, 0)) FILTER (WHERE vs.ended_at IS NOT NULL)), 0)::integer
  INTO
    v_video_sessions,
    v_completed_sessions,
    v_mutual_vibes,
    v_extended_sessions,
    v_avg_duration
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id;

  IF v_completed_sessions > 0 THEN
    v_match_rate := round((v_mutual_vibes::numeric / v_completed_sessions::numeric) * 100)::integer;
    v_extension_rate := round((v_extended_sessions::numeric / v_completed_sessions::numeric) * 100)::integer;
  END IF;

  SELECT count(*)::integer
  INTO v_matches
  FROM public.matches
  WHERE event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_participant_reports
  FROM public.user_reports ur
  WHERE ur.created_at >= v_event_date - interval '1 day'
    AND ur.created_at <= v_event_date + make_interval(mins => COALESCE(v_event_duration_minutes, 60)) + interval '1 day'
    AND (
      ur.reporter_id IN (SELECT profile_id FROM public.event_registrations WHERE event_id = p_event_id)
      OR ur.reported_id IN (SELECT profile_id FROM public.event_registrations WHERE event_id = p_event_id)
    );

  RETURN public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'active_users', v_active_users,
    'browsing', v_browsing,
    'in_ready_gate', v_in_ready_gate,
    'in_dates', v_in_dates,
    'in_survey', v_in_survey,
    'in_queue', v_in_queue,
    'match_rate', v_match_rate,
    'extension_rate', v_extension_rate,
    'avg_duration_seconds', v_avg_duration,
    'gender_count', v_gender_count,
    'video_sessions', v_video_sessions,
    'completed_video_sessions', v_completed_sessions,
    'registrations', v_registrations,
    'confirmed_registrations', v_confirmed,
    'waitlisted_registrations', v_waitlisted,
    'confirmed_attendance', v_attended,
    'attendance_marked_count', v_attendance_marked,
    'no_show_count', v_no_show,
    'persistent_matches', v_matches,
    'participant_reports_near_event_window', v_participant_reports,
    'report_scope', 'participant_reports_near_event_window'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_event_post_analytics(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event_exists boolean := false;
  v_feedback_count integer := 0;
  v_tag_chemistry integer := 0;
  v_tag_fun integer := 0;
  v_tag_smart integer := 0;
  v_tag_respectful integer := 0;
  v_flow_natural integer := 0;
  v_flow_effort integer := 0;
  v_flow_one_sided integer := 0;
  v_total_flow integer := 0;
  v_photo_yes integer := 0;
  v_photo_total integer := 0;
  v_photo_accuracy_rate integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Intelligence read permission is required.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id = p_event_id)
  INTO v_event_exists;

  IF NOT v_event_exists THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  BEGIN
    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE df.tag_chemistry IS TRUE)::integer,
      count(*) FILTER (WHERE df.tag_fun IS TRUE)::integer,
      count(*) FILTER (WHERE df.tag_smart IS TRUE)::integer,
      count(*) FILTER (WHERE df.tag_respectful IS TRUE)::integer,
      count(*) FILTER (WHERE df.conversation_flow = 'natural')::integer,
      count(*) FILTER (WHERE df.conversation_flow = 'effort')::integer,
      count(*) FILTER (WHERE df.conversation_flow = 'one_sided')::integer,
      count(*) FILTER (WHERE df.photo_accurate = 'yes')::integer,
      count(*) FILTER (WHERE df.photo_accurate IS NOT NULL)::integer
    INTO
      v_feedback_count,
      v_tag_chemistry,
      v_tag_fun,
      v_tag_smart,
      v_tag_respectful,
      v_flow_natural,
      v_flow_effort,
      v_flow_one_sided,
      v_photo_yes,
      v_photo_total
    FROM public.date_feedback df
    JOIN public.video_sessions vs ON vs.id = df.session_id
    WHERE vs.event_id = p_event_id;
  EXCEPTION WHEN others THEN
    RETURN public.admin_json_success(jsonb_build_object(
      'event_id', p_event_id,
      'post_metrics', 'null'::jsonb,
      'post_metrics_status', 'unavailable'
    ));
  END;

  IF v_feedback_count = 0 THEN
    RETURN public.admin_json_success(jsonb_build_object(
      'event_id', p_event_id,
      'post_metrics', 'null'::jsonb,
      'post_metrics_status', 'empty'
    ));
  END IF;

  v_total_flow := v_flow_natural + v_flow_effort + v_flow_one_sided;
  IF v_photo_total > 0 THEN
    v_photo_accuracy_rate := round((v_photo_yes::numeric / v_photo_total::numeric) * 100)::integer;
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'post_metrics_status', 'ok',
    'post_metrics', jsonb_build_object(
      'tag_counts', jsonb_build_object(
        'chemistry', v_tag_chemistry,
        'fun', v_tag_fun,
        'smart', v_tag_smart,
        'respectful', v_tag_respectful
      ),
      'flow_counts', jsonb_build_object(
        'natural', v_flow_natural,
        'effort', v_flow_effort,
        'one_sided', v_flow_one_sided
      ),
      'total_flow', v_total_flow,
      'photo_accuracy_rate', v_photo_accuracy_rate
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_event_lifecycle_feed(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event_exists boolean := false;
  v_sources jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_source_items jsonb := '[]'::jsonb;
  v_payment_exceptions jsonb := '[]'::jsonb;
  v_payment_exception_status_counts jsonb := '{}'::jsonb;
  v_count_a integer := 0;
  v_count_b integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'intelligence.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Intelligence read permission is required.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id = p_event_id)
  INTO v_event_exists;

  IF NOT v_event_exists THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  BEGIN
    SELECT
      count(*) FILTER (WHERE erq.sent_at IS NOT NULL)::integer,
      count(*) FILTER (WHERE erq.sent_at IS NULL)::integer
    INTO v_count_a, v_count_b
    FROM public.event_reminder_queue erq
    WHERE erq.event_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'reminder_queue',
      'status', 'ok',
      'detail', v_count_a || ' sent / ' || v_count_b || ' pending'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        erq.created_at AS sort_at,
        jsonb_build_object(
          'timestamp', erq.created_at,
          'source', 'reminder_queue',
          'category', erq.reminder_type,
          'result', CASE WHEN erq.sent_at IS NOT NULL THEN 'sent' ELSE 'pending' END,
          'event_id', erq.event_id,
          'queue_id', erq.id
        ) AS item
      FROM public.event_reminder_queue erq
      WHERE erq.event_id = p_event_id
      ORDER BY erq.created_at DESC
      LIMIT 30
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'reminder_queue', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT count(*)::integer
    INTO v_count_a
    FROM public.notification_log nl
    WHERE nl.data ->> 'event_id' = p_event_id::text
      AND nl.category IN (
        'event_reminder',
        'event_reminder_30m',
        'event_reminder_5m',
        'event_waitlist_promoted',
        'event_cancelled',
        'event_live'
      );

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'notification_log',
      'status', 'ok',
      'detail', v_count_a || ' matching records'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        COALESCE(nl.created_at, 'epoch'::timestamptz) AS sort_at,
        jsonb_build_object(
          'timestamp', COALESCE(nl.created_at, 'epoch'::timestamptz),
          'source', 'notification_log',
          'category', nl.category,
          'result', CASE WHEN nl.delivered IS TRUE THEN 'delivered' ELSE 'suppressed' END,
          'event_id', COALESCE(nl.data ->> 'event_id', p_event_id::text),
          'session_id', COALESCE(nl.data ->> 'session_id', nl.data ->> 'video_session_id'),
          'admission_status', nl.data ->> 'admission_status',
          'queue_id', nl.data ->> 'queue_id',
          'error_reason', CASE WHEN nl.delivered IS TRUE THEN NULL ELSE nl.suppressed_reason END
        ) AS item
      FROM public.notification_log nl
      WHERE nl.data ->> 'event_id' = p_event_id::text
        AND nl.category IN (
          'event_reminder',
          'event_reminder_30m',
          'event_reminder_5m',
          'event_waitlist_promoted',
          'event_cancelled',
          'event_live'
        )
      ORDER BY nl.created_at DESC
      LIMIT 40
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'notification_log', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT
      count(*) FILTER (WHERE wpnq.processed_at IS NOT NULL)::integer,
      count(*)::integer
    INTO v_count_a, v_count_b
    FROM public.waitlist_promotion_notify_queue wpnq
    WHERE wpnq.event_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'waitlist_promotion_queue',
      'status', 'ok',
      'detail', v_count_a || '/' || v_count_b || ' processed'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        wpnq.created_at AS sort_at,
        jsonb_build_object(
          'timestamp', wpnq.created_at,
          'source', 'waitlist_promotion_queue',
          'category', 'event_waitlist_promoted',
          'result', CASE WHEN wpnq.processed_at IS NOT NULL THEN 'processed' ELSE 'pending' END,
          'event_id', wpnq.event_id,
          'admission_status', 'promoted',
          'queue_id', wpnq.id
        ) AS item
      FROM public.waitlist_promotion_notify_queue wpnq
      WHERE wpnq.event_id = p_event_id
      ORDER BY wpnq.created_at DESC
      LIMIT 30
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'waitlist_promotion_queue', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT count(*)::integer
    INTO v_count_a
    FROM public.stripe_event_ticket_settlements sets
    WHERE sets.event_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'ticket_settlements',
      'status', 'ok',
      'detail', v_count_a || ' settlements'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        sets.created_at AS sort_at,
        jsonb_build_object(
          'timestamp', sets.created_at,
          'source', 'ticket_settlements',
          'category', 'stripe_event_ticket_settlement',
          'result', sets.outcome,
          'event_id', sets.event_id,
          'admission_status', sets.result ->> 'admission_status',
          'queue_id', sets.checkout_session_id
        ) AS item
      FROM public.stripe_event_ticket_settlements sets
      WHERE sets.event_id = p_event_id
      ORDER BY sets.created_at DESC
      LIMIT 30
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'ticket_settlements', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT count(*)::integer
    INTO v_count_a
    FROM public.event_swipes es
    WHERE es.event_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'event_swipes',
      'status', 'ok',
      'detail', v_count_a || ' swipes'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        es.created_at AS sort_at,
        jsonb_build_object(
          'timestamp', es.created_at,
          'source', 'event_swipes',
          'category', 'swipe_action',
          'result', es.swipe_type,
          'event_id', es.event_id,
          'queue_id', es.id
        ) AS item
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
      ORDER BY es.created_at DESC
      LIMIT 40
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'event_swipes', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT count(*)::integer
    INTO v_count_a
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'video_sessions',
      'status', 'ok',
      'detail', v_count_a || ' session records'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        COALESCE(vs.state_updated_at, vs.ended_at, vs.started_at, 'epoch'::timestamptz) AS sort_at,
        jsonb_build_object(
          'timestamp', COALESCE(vs.state_updated_at, vs.ended_at, vs.started_at, 'epoch'::timestamptz),
          'source', 'video_sessions',
          'category', 'video_date_state',
          'result', CASE
            WHEN vs.ended_reason IS NOT NULL THEN COALESCE(vs.state::text, 'unknown') || ':' || vs.ended_reason
            ELSE COALESCE(vs.state::text, 'unknown')
          END,
          'event_id', vs.event_id,
          'session_id', vs.id
        ) AS item
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
      ORDER BY vs.state_updated_at DESC NULLS LAST, vs.ended_at DESC NULLS LAST, vs.started_at DESC
      LIMIT 30
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'video_sessions', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT count(*)::integer
    INTO v_count_a
    FROM public.admin_activity_logs aal
    WHERE aal.target_type = 'event'
      AND aal.target_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'admin_activity_logs',
      'status', 'ok',
      'detail', v_count_a || ' admin actions'
    ));

    SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
    INTO v_source_items
    FROM (
      SELECT
        aal.created_at AS sort_at,
        jsonb_build_object(
          'timestamp', aal.created_at,
          'source', 'admin_activity_logs',
          'category', aal.target_type,
          'result', aal.action_type,
          'event_id', aal.target_id,
          'queue_id', aal.id
        ) AS item
      FROM public.admin_activity_logs aal
      WHERE aal.target_type = 'event'
        AND aal.target_id = p_event_id
      ORDER BY aal.created_at DESC
      LIMIT 30
    ) rows;
    v_items := v_items || v_source_items;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'admin_activity_logs', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
  END;

  BEGIN
    SELECT count(*)::integer
    INTO v_count_a
    FROM public.event_payment_exceptions epe
    WHERE epe.event_id = p_event_id;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', 'payment_exceptions',
      'status', 'ok',
      'detail', v_count_a || ' exception cases'
    ));

    SELECT COALESCE(jsonb_object_agg(exception_status, status_count), '{}'::jsonb)
    INTO v_payment_exception_status_counts
    FROM (
      SELECT COALESCE(epe.exception_status, 'unknown') AS exception_status, count(*)::integer AS status_count
      FROM public.event_payment_exceptions epe
      WHERE epe.event_id = p_event_id
      GROUP BY COALESCE(epe.exception_status, 'unknown')
    ) counts;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', epe.id,
        'profile_ref', epe.profile_id IS NOT NULL,
        'support_ticket_ref', epe.support_ticket_id IS NOT NULL,
        'checkout_session_ref', epe.checkout_session_id IS NOT NULL,
        'exception_type', epe.exception_type,
        'exception_status', epe.exception_status,
        'created_at', epe.created_at,
        'updated_at', epe.updated_at
      )
      ORDER BY epe.updated_at DESC
    ), '[]'::jsonb)
    INTO v_payment_exceptions
    FROM (
      SELECT
        id,
        profile_id,
        support_ticket_id,
        checkout_session_id,
        exception_type,
        exception_status,
        created_at,
        updated_at
      FROM public.event_payment_exceptions
      WHERE event_id = p_event_id
      ORDER BY updated_at DESC
      LIMIT 30
    ) epe;
  EXCEPTION WHEN others THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('source', 'payment_exceptions', 'status', 'unavailable', 'detail', left(SQLERRM, 180)));
    v_payment_exceptions := '[]'::jsonb;
    v_payment_exception_status_counts := '{}'::jsonb;
  END;

  WITH flattened AS (
    SELECT
      item,
      COALESCE((item ->> 'timestamp')::timestamptz, 'epoch'::timestamptz) AS sort_at
    FROM jsonb_array_elements(v_items) AS element(item)
  ),
  limited AS (
    SELECT item, sort_at
    FROM flattened
    ORDER BY sort_at DESC
    LIMIT 40
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
  INTO v_items
  FROM limited;

  RETURN public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'sources', v_sources,
    'items', v_items,
    'payment_exceptions', v_payment_exceptions,
    'payment_exception_status_counts', v_payment_exception_status_counts
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_event_analytics_options(integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_event_live_analytics(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_event_post_analytics(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_event_lifecycle_feed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_event_analytics_options(integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event_live_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event_post_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event_lifecycle_feed(uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507163000',
  'Admin Event Analytics backend read models',
  'schema-only',
  'Adds security-definer read models for Event Analytics selector, live metrics, post-event feedback, lifecycle feed, and payment exception summaries. No public RLS or user discovery behavior changes.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_list_event_analytics_options(integer, boolean) IS
  'Admin Event Analytics selector read model. Returns only event option fields.';
COMMENT ON FUNCTION public.admin_get_event_live_analytics(uuid) IS
  'Admin Event Analytics live aggregate read model. confirmed_attendance counts attended IS TRUE; reviewed and no-show totals are separate.';
COMMENT ON FUNCTION public.admin_get_event_post_analytics(uuid) IS
  'Admin Event Analytics post-event feedback aggregate read model.';
COMMENT ON FUNCTION public.admin_get_event_lifecycle_feed(uuid) IS
  'Admin Event Analytics lifecycle queue/log and payment exception read model with per-source fail-soft status.';
