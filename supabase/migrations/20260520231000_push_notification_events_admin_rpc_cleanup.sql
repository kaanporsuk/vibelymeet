-- Push notification telemetry admin RPC cleanup.
--
-- Replaces the exposed push_notification_events_admin security-definer view with
-- explicit admin RPC read models. Raw provider IDs and device tokens remain
-- readable only inside admin-checked SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.admin_list_push_notification_events(
  p_limit integer DEFAULT 50
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
  v_events jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  WITH event_rows AS (
    SELECT
      pne.id,
      pne.campaign_id,
      pne.user_id,
      pne.platform,
      pne.status,
      pne.queued_at,
      pne.sent_at,
      pne.delivered_at,
      pne.opened_at,
      pne.clicked_at,
      pne.created_at,
      pne.fcm_message_id,
      pne.apns_message_id,
      pne.device_token,
      pne.error_code,
      pne.error_message,
      row_number() OVER (ORDER BY pne.created_at DESC, pne.id DESC) AS row_order
    FROM public.push_notification_events pne
    ORDER BY pne.created_at DESC, pne.id DESC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'campaign_id', campaign_id,
        'user_id', user_id,
        'platform', platform,
        'status', status,
        'queued_at', queued_at,
        'sent_at', sent_at,
        'delivered_at', delivered_at,
        'opened_at', opened_at,
        'clicked_at', clicked_at,
        'created_at', created_at,
        'fcm_message_id', CASE WHEN fcm_message_id IS NULL THEN NULL ELSE '[REDACTED]'::text END,
        'apns_message_id', CASE WHEN apns_message_id IS NULL THEN NULL ELSE '[REDACTED]'::text END,
        'device_token', CASE WHEN device_token IS NULL THEN NULL ELSE '[REDACTED]'::text END,
        'error_code', error_code,
        'error_message', error_message
      )
      ORDER BY row_order
    ),
    '[]'::jsonb
  )
  INTO v_events
  FROM event_rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'events', v_events,
    'limit', v_limit,
    'source', 'admin_list_push_notification_events'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_push_delivery_metrics(
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_push_queued integer;
  v_push_sent integer;
  v_push_delivered integer;
  v_push_opened integer;
  v_push_clicked integer;
  v_app_logs integer;
  v_app_delivered integer;
  v_app_suppressed integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start >= p_window_end THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Push metrics window is invalid.');
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE sent_at IS NOT NULL)::integer,
    count(*) FILTER (WHERE delivered_at IS NOT NULL OR status IN ('delivered', 'opened', 'clicked'))::integer,
    count(*) FILTER (WHERE opened_at IS NOT NULL OR status IN ('opened', 'clicked'))::integer,
    count(*) FILTER (WHERE clicked_at IS NOT NULL OR status = 'clicked')::integer
  INTO v_push_queued, v_push_sent, v_push_delivered, v_push_opened, v_push_clicked
  FROM public.push_notification_events
  WHERE created_at >= p_window_start
    AND created_at < p_window_end;

  SELECT count(*)::integer INTO v_app_logs FROM public.notification_log WHERE created_at >= p_window_start AND created_at < p_window_end;
  SELECT count(*)::integer INTO v_app_delivered FROM public.notification_log WHERE created_at >= p_window_start AND created_at < p_window_end AND delivered IS TRUE;
  SELECT count(*)::integer INTO v_app_suppressed FROM public.notification_log WHERE created_at >= p_window_start AND created_at < p_window_end AND delivered IS NOT TRUE;

  RETURN public.admin_json_success(jsonb_build_object(
    'window_start', p_window_start,
    'window_end', p_window_end,
    'push_telemetry', jsonb_build_object(
      'queued_rows', v_push_queued,
      'sent_rows', v_push_sent,
      'delivered_rows', v_push_delivered,
      'opened_rows', v_push_opened,
      'clicked_rows', v_push_clicked,
      'source', 'push_notification_events'
    ),
    'app_notification_log', jsonb_build_object(
      'log_rows', v_app_logs,
      'delivered_rows', v_app_delivered,
      'suppressed_rows', v_app_suppressed,
      'source', 'notification_log'
    ),
    'semantics', 'App notification logs and push provider telemetry are intentionally separate.'
  ));
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
  v_daily_stale_match_calls integer := 0;
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
  INTO v_daily_stale_match_calls
  FROM public.match_calls
  WHERE status IN ('ringing', 'active')
    AND created_at < p_now - interval '4 hours';

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
        'status', CASE WHEN v_daily_stale_video_sessions > 0 OR v_daily_stale_match_calls > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('stale_video_sessions', v_daily_stale_video_sessions, 'stale_match_calls', v_daily_stale_match_calls),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Check Daily rooms and cleanup results for stale room drift.'),
        'drift_count', v_daily_stale_video_sessions + v_daily_stale_match_calls
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
    FROM public.push_notification_events pne
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
    'source', 'push_notification_events'
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
    LEFT JOIN public.push_notification_events pne
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

REVOKE ALL ON FUNCTION public.admin_list_push_notification_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_push_notification_events(integer) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_push_delivery_metrics(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_push_delivery_metrics(timestamptz, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_provider_health(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_health(timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_engagement_analytics(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_engagement_analytics(timestamptz, timestamptz) TO authenticated;

DROP VIEW IF EXISTS public.push_notification_events_admin;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260520231000',
  'Push notification events admin RPC cleanup',
  'schema+policy',
  'Replaces the exposed security-definer push telemetry view with admin-checked SECURITY DEFINER RPCs that redact provider identifiers before returning JSON. Existing aggregate admin RPCs now read the base push table only inside their admin-verified bodies.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_list_push_notification_events(integer) IS
  'Admin-only redacted push notification event list. Replaces the former push_notification_events_admin view so public API callers use an explicit RPC boundary.';
