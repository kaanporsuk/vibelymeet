-- Admin Engagement Analytics backend read model.
--
-- Moves the Engagement tab's notification, Daily Drop, and activity metrics
-- behind one backend-authoritative aggregate RPC. This migration performs no
-- data backfill and no production data mutation.

CREATE OR REPLACE FUNCTION public.admin_get_engagement_analytics(
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_notification_totals jsonb;
  v_notification_by_day jsonb;
  v_app_log_totals jsonb;
  v_app_by_category jsonb;
  v_daily_drop_totals jsonb;
  v_daily_drop_by_day jsonb;
  v_daily_drop_status_distribution jsonb;
  v_user_activity_totals jsonb;
  v_user_activity_by_day jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start >= p_window_end THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Engagement analytics window is invalid.');
  END IF;

  v_window_start := date_trunc('day', p_window_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_window_end := date_trunc('day', p_window_end AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_window_start >= v_window_end THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Engagement analytics UTC day window is invalid.');
  END IF;

  IF v_window_end - v_window_start > interval '120 days' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Engagement analytics window is too large.');
  END IF;

  WITH counts AS (
    SELECT
      count(*)::integer AS queued_rows,
      count(*) FILTER (
        WHERE pne.sent_at IS NOT NULL
           OR pne.status IN ('sent', 'delivered', 'opened', 'clicked')
      )::integer AS sent_rows,
      count(*) FILTER (
        WHERE pne.delivered_at IS NOT NULL
           OR pne.status IN ('delivered', 'opened', 'clicked')
      )::integer AS delivered_rows,
      count(*) FILTER (
        WHERE pne.opened_at IS NOT NULL
           OR pne.status IN ('opened', 'clicked')
      )::integer AS opened_rows,
      count(*) FILTER (
        WHERE pne.clicked_at IS NOT NULL
           OR pne.status = 'clicked'
      )::integer AS clicked_rows,
      count(*) FILTER (WHERE pne.status = 'failed')::integer AS failed_rows,
      count(*) FILTER (WHERE pne.status = 'bounced')::integer AS bounced_rows
    FROM public.push_notification_events_admin pne
    WHERE pne.created_at >= v_window_start
      AND pne.created_at < v_window_end
  )
  SELECT jsonb_build_object(
    'queued_rows', queued_rows,
    'sent_rows', sent_rows,
    'delivered_rows', delivered_rows,
    'opened_rows', opened_rows,
    'clicked_rows', clicked_rows,
    'failed_rows', failed_rows,
    'bounced_rows', bounced_rows,
    'delivery_rate', CASE WHEN sent_rows > 0 THEN round((delivered_rows::numeric / sent_rows::numeric) * 100)::integer ELSE 0 END,
    'open_rate', CASE WHEN delivered_rows > 0 THEN round((opened_rows::numeric / delivered_rows::numeric) * 100)::integer ELSE 0 END,
    'click_rate', CASE WHEN opened_rows > 0 THEN round((clicked_rows::numeric / opened_rows::numeric) * 100)::integer ELSE 0 END,
    'source', 'push_notification_events_admin'
  )
  INTO v_notification_totals
  FROM counts;

  WITH days AS (
    SELECT generate_series(v_window_start, v_window_end - interval '1 day', interval '1 day') AS day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      count(pne.id)::integer AS queued,
      count(pne.id) FILTER (
        WHERE pne.sent_at IS NOT NULL
           OR pne.status IN ('sent', 'delivered', 'opened', 'clicked')
      )::integer AS sent,
      count(pne.id) FILTER (
        WHERE pne.delivered_at IS NOT NULL
           OR pne.status IN ('delivered', 'opened', 'clicked')
      )::integer AS delivered,
      count(pne.id) FILTER (
        WHERE pne.opened_at IS NOT NULL
           OR pne.status IN ('opened', 'clicked')
      )::integer AS opened,
      count(pne.id) FILTER (
        WHERE pne.clicked_at IS NOT NULL
           OR pne.status = 'clicked'
      )::integer AS clicked
    FROM days
    LEFT JOIN public.push_notification_events_admin pne
      ON pne.created_at >= days.day_start
     AND pne.created_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start AT TIME ZONE 'UTC', 'Mon FMDD'),
      'queued', queued,
      'sent', sent,
      'delivered', delivered,
      'opened', opened,
      'clicked', clicked
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_notification_by_day
  FROM counted;

  WITH counts AS (
    SELECT
      count(*)::integer AS log_rows,
      count(*) FILTER (WHERE nl.delivered IS TRUE)::integer AS delivered_rows,
      count(*) FILTER (WHERE nl.delivered IS NOT TRUE)::integer AS suppressed_rows
    FROM public.notification_log nl
    WHERE nl.created_at >= v_window_start
      AND nl.created_at < v_window_end
  )
  SELECT jsonb_build_object(
    'log_rows', log_rows,
    'delivered_rows', delivered_rows,
    'suppressed_rows', suppressed_rows,
    'delivery_rate', CASE WHEN log_rows > 0 THEN round((delivered_rows::numeric / log_rows::numeric) * 100)::integer ELSE 0 END,
    'source', 'notification_log'
  )
  INTO v_app_log_totals
  FROM counts;

  WITH category_counts AS (
    SELECT
      nl.category,
      count(*)::integer AS total,
      count(*) FILTER (WHERE nl.delivered IS TRUE)::integer AS delivered,
      count(*) FILTER (WHERE nl.delivered IS NOT TRUE)::integer AS suppressed
    FROM public.notification_log nl
    WHERE nl.created_at >= v_window_start
      AND nl.created_at < v_window_end
    GROUP BY nl.category
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category', category,
      'label', initcap(replace(category, '_', ' ')),
      'total', total,
      'delivered', delivered,
      'suppressed', suppressed,
      'delivery_rate', CASE WHEN total > 0 THEN round((delivered::numeric / total::numeric) * 100)::integer ELSE 0 END
    )
    ORDER BY total DESC, category ASC
  ), '[]'::jsonb)
  INTO v_app_by_category
  FROM category_counts;

  WITH counts AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE dd.status = 'active_unopened')::integer AS active_unopened,
      count(*) FILTER (WHERE dd.status = 'active_viewed')::integer AS active_viewed,
      count(*) FILTER (WHERE dd.status = 'active_opener_sent')::integer AS active_opener_sent,
      count(*) FILTER (WHERE dd.status = 'matched')::integer AS matched,
      count(*) FILTER (WHERE dd.status = 'passed')::integer AS passed,
      count(*) FILTER (WHERE dd.status = 'expired_no_action')::integer AS expired_no_action,
      count(*) FILTER (WHERE dd.status = 'expired_no_reply')::integer AS expired_no_reply,
      count(*) FILTER (WHERE dd.status = 'invalidated')::integer AS invalidated,
      count(*) FILTER (WHERE dd.status <> 'active_unopened' AND dd.status <> 'invalidated')::integer AS engaged_rows,
      count(*) FILTER (
        WHERE dd.opener_sent_at IS NOT NULL
           OR dd.status IN ('active_opener_sent', 'matched', 'expired_no_reply')
      )::integer AS opener_rows
    FROM public.daily_drops dd
    WHERE dd.starts_at >= v_window_start
      AND dd.starts_at < v_window_end
  )
  SELECT jsonb_build_object(
    'total', total,
    'active_unopened', active_unopened,
    'active_viewed', active_viewed,
    'active_opener_sent', active_opener_sent,
    'matched', matched,
    'passed', passed,
    'expired_no_action', expired_no_action,
    'expired_no_reply', expired_no_reply,
    'invalidated', invalidated,
    'engaged_rows', engaged_rows,
    'opener_rows', opener_rows,
    'engagement_rate', CASE WHEN (total - invalidated) > 0 THEN round((engaged_rows::numeric / (total - invalidated)::numeric) * 100)::integer ELSE 0 END,
    'opener_rate', CASE WHEN (total - invalidated) > 0 THEN round((opener_rows::numeric / (total - invalidated)::numeric) * 100)::integer ELSE 0 END,
    'match_conversion_rate', CASE WHEN total > 0 THEN round((matched::numeric / total::numeric) * 100)::integer ELSE 0 END
  )
  INTO v_daily_drop_totals
  FROM counts;

  WITH status_labels AS (
    SELECT labels.status, labels.label, labels.color, labels.sort_order
    FROM (VALUES
      ('active_unopened'::text, 'Unopened'::text, 'hsl(var(--muted-foreground))'::text, 1),
      ('active_viewed'::text, 'Viewed'::text, '#22d3ee'::text, 2),
      ('active_opener_sent'::text, 'Opener sent'::text, '#f472b6'::text, 3),
      ('matched'::text, 'Matched'::text, '#34d399'::text, 4),
      ('passed'::text, 'Passed'::text, '#a78bfa'::text, 5),
      ('expired_no_action'::text, 'Expired no action'::text, '#64748b'::text, 6),
      ('expired_no_reply'::text, 'Expired no reply'::text, '#94a3b8'::text, 7),
      ('invalidated'::text, 'Invalidated'::text, '#ef4444'::text, 8)
    ) AS labels(status, label, color, sort_order)
  ),
  counted AS (
    SELECT
      status_labels.status,
      status_labels.label,
      status_labels.color,
      status_labels.sort_order,
      count(dd.id)::integer AS value
    FROM status_labels
    LEFT JOIN public.daily_drops dd
      ON dd.status = status_labels.status
     AND dd.starts_at >= v_window_start
     AND dd.starts_at < v_window_end
    GROUP BY status_labels.status, status_labels.label, status_labels.color, status_labels.sort_order
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'status', status,
      'name', label,
      'value', value,
      'color', color
    )
    ORDER BY sort_order ASC
  ), '[]'::jsonb)
  INTO v_daily_drop_status_distribution
  FROM counted;

  WITH days AS (
    SELECT generate_series(v_window_start, v_window_end - interval '1 day', interval '1 day') AS day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      count(dd.id)::integer AS total,
      count(dd.id) FILTER (WHERE dd.status = 'active_unopened')::integer AS unopened,
      count(dd.id) FILTER (WHERE dd.status = 'active_viewed')::integer AS viewed,
      count(dd.id) FILTER (
        WHERE dd.opener_sent_at IS NOT NULL
           OR dd.status IN ('active_opener_sent', 'matched', 'expired_no_reply')
      )::integer AS opener_sent,
      count(dd.id) FILTER (WHERE dd.status = 'matched')::integer AS matched,
      count(dd.id) FILTER (WHERE dd.status = 'passed')::integer AS passed,
      count(dd.id) FILTER (WHERE dd.status IN ('expired_no_action', 'expired_no_reply'))::integer AS expired,
      count(dd.id) FILTER (WHERE dd.status = 'invalidated')::integer AS invalidated,
      count(dd.id) FILTER (WHERE dd.status <> 'active_unopened' AND dd.status <> 'invalidated')::integer AS engaged
    FROM days
    LEFT JOIN public.daily_drops dd
      ON dd.starts_at >= days.day_start
     AND dd.starts_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start AT TIME ZONE 'UTC', 'Mon FMDD'),
      'total', total,
      'unopened', unopened,
      'viewed', viewed,
      'opener_sent', opener_sent,
      'matched', matched,
      'passed', passed,
      'expired', expired,
      'invalidated', invalidated,
      'engaged', engaged
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_daily_drop_by_day
  FROM counted;

  WITH counts AS (
    SELECT
      (SELECT count(*)::integer FROM public.messages msg WHERE msg.created_at >= v_window_start AND msg.created_at < v_window_end) AS total_messages,
      (SELECT count(*)::integer FROM public.matches m WHERE m.matched_at >= v_window_start AND m.matched_at < v_window_end) AS total_matches,
      (SELECT count(*)::integer FROM public.event_registrations er WHERE er.registered_at >= v_window_start AND er.registered_at < v_window_end) AS total_registrations
  )
  SELECT jsonb_build_object(
    'total_messages', total_messages,
    'total_matches', total_matches,
    'total_registrations', total_registrations,
    'total_activities', total_messages + total_matches + total_registrations
  )
  INTO v_user_activity_totals
  FROM counts;

  WITH days AS (
    SELECT generate_series(v_window_start, v_window_end - interval '1 day', interval '1 day') AS day_start
  ),
  message_counts AS (
    SELECT
      days.day_start,
      count(msg.id)::integer AS messages
    FROM days
    LEFT JOIN public.messages msg
      ON msg.created_at >= days.day_start
     AND msg.created_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
  ),
  match_counts AS (
    SELECT
      days.day_start,
      count(m.id)::integer AS matches
    FROM days
    LEFT JOIN public.matches m
      ON m.matched_at >= days.day_start
     AND m.matched_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
  ),
  registration_counts AS (
    SELECT
      days.day_start,
      count(er.id)::integer AS registrations
    FROM days
    LEFT JOIN public.event_registrations er
      ON er.registered_at >= days.day_start
     AND er.registered_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      COALESCE(message_counts.messages, 0)::integer AS messages,
      COALESCE(match_counts.matches, 0)::integer AS matches,
      COALESCE(registration_counts.registrations, 0)::integer AS registrations
    FROM days
    LEFT JOIN message_counts ON message_counts.day_start = days.day_start
    LEFT JOIN match_counts ON match_counts.day_start = days.day_start
    LEFT JOIN registration_counts ON registration_counts.day_start = days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start AT TIME ZONE 'UTC', 'Mon FMDD'),
      'messages', messages,
      'matches', matches,
      'registrations', registrations
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_user_activity_by_day
  FROM counted;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_window_start,
    'window_end', v_window_end,
    'notifications', jsonb_build_object(
      'provider_totals', v_notification_totals,
      'by_day', v_notification_by_day,
      'app_log_totals', v_app_log_totals,
      'app_by_category', v_app_by_category
    ),
    'daily_drop', jsonb_build_object(
      'totals', v_daily_drop_totals,
      'by_day', v_daily_drop_by_day,
      'status_distribution', v_daily_drop_status_distribution
    ),
    'user_activity', jsonb_build_object(
      'totals', v_user_activity_totals,
      'by_day', v_user_activity_by_day
    )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_engagement_analytics(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_engagement_analytics(timestamptz, timestamptz) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_drops;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_log;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507201000',
  'Admin Engagement Analytics read model',
  'schema-only',
  'Adds one security-definer aggregate read model for the Engagement Analytics tab and pins Daily Drop / notification-log realtime publication membership. It reads push telemetry, notification logs, Daily Drop rows, messages, matches, and registrations, and performs no user-facing or production data mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_engagement_analytics(timestamptz, timestamptz) IS
  'Read-only backend-authoritative /kaan Engagement Analytics payload. Uses UTC windows and admin role verification; performs no writes.';
