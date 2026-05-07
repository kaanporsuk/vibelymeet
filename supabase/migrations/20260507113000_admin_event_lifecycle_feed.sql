-- Event Analytics lifecycle feed read model.
-- Centralizes event-scoped queue/log reads behind a security-definer admin RPC so
-- browser RLS cannot make internal sources look falsely empty.

CREATE OR REPLACE FUNCTION public.admin_get_event_lifecycle_feed(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event_exists boolean := false;
  v_reminder_sent integer := 0;
  v_reminder_pending integer := 0;
  v_notification_count integer := 0;
  v_waitlist_processed integer := 0;
  v_waitlist_total integer := 0;
  v_settlement_count integer := 0;
  v_swipe_count integer := 0;
  v_session_count integer := 0;
  v_admin_action_count integer := 0;
  v_sources jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id = p_event_id)
  INTO v_event_exists;

  IF NOT v_event_exists THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  SELECT
    count(*) FILTER (WHERE erq.sent_at IS NOT NULL)::integer,
    count(*) FILTER (WHERE erq.sent_at IS NULL)::integer
  INTO v_reminder_sent, v_reminder_pending
  FROM public.event_reminder_queue erq
  WHERE erq.event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_notification_count
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

  SELECT
    count(*) FILTER (WHERE wpnq.processed_at IS NOT NULL)::integer,
    count(*)::integer
  INTO v_waitlist_processed, v_waitlist_total
  FROM public.waitlist_promotion_notify_queue wpnq
  WHERE wpnq.event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_settlement_count
  FROM public.stripe_event_ticket_settlements sets
  WHERE sets.event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_swipe_count
  FROM public.event_swipes es
  WHERE es.event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_session_count
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_admin_action_count
  FROM public.admin_activity_logs aal
  WHERE aal.target_type = 'event'
    AND aal.target_id = p_event_id;

  v_sources := jsonb_build_array(
    jsonb_build_object(
      'source', 'reminder_queue',
      'status', 'ok',
      'detail', v_reminder_sent || ' sent / ' || v_reminder_pending || ' pending'
    ),
    jsonb_build_object(
      'source', 'notification_log',
      'status', 'ok',
      'detail', v_notification_count || ' matching records'
    ),
    jsonb_build_object(
      'source', 'waitlist_promotion_queue',
      'status', 'ok',
      'detail', v_waitlist_processed || '/' || v_waitlist_total || ' processed'
    ),
    jsonb_build_object(
      'source', 'ticket_settlements',
      'status', 'ok',
      'detail', v_settlement_count || ' settlements'
    ),
    jsonb_build_object(
      'source', 'event_swipes',
      'status', 'ok',
      'detail', v_swipe_count || ' swipes'
    ),
    jsonb_build_object(
      'source', 'video_sessions',
      'status', 'ok',
      'detail', v_session_count || ' session records'
    ),
    jsonb_build_object(
      'source', 'admin_activity_logs',
      'status', 'ok',
      'detail', v_admin_action_count || ' admin actions'
    )
  );

  WITH raw_items AS (
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
    FROM (
      SELECT *
      FROM public.event_reminder_queue
      WHERE event_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 30
    ) erq

    UNION ALL

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
    FROM (
      SELECT *
      FROM public.notification_log
      WHERE data ->> 'event_id' = p_event_id::text
        AND category IN (
          'event_reminder',
          'event_reminder_30m',
          'event_reminder_5m',
          'event_waitlist_promoted',
          'event_cancelled',
          'event_live'
        )
      ORDER BY created_at DESC
      LIMIT 40
    ) nl

    UNION ALL

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
    FROM (
      SELECT *
      FROM public.waitlist_promotion_notify_queue
      WHERE event_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 30
    ) wpnq

    UNION ALL

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
    FROM (
      SELECT *
      FROM public.stripe_event_ticket_settlements
      WHERE event_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 30
    ) sets

    UNION ALL

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
    FROM (
      SELECT *
      FROM public.event_swipes
      WHERE event_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 40
    ) es

    UNION ALL

    SELECT
      COALESCE(vs.state_updated_at, vs.ended_at, vs.started_at, 'epoch'::timestamptz) AS sort_at,
      jsonb_build_object(
        'timestamp', COALESCE(vs.state_updated_at, vs.ended_at, vs.started_at, 'epoch'::timestamptz),
        'source', 'video_sessions',
        'category', 'video_date_state',
        'result', CASE
          WHEN vs.ended_reason IS NOT NULL THEN COALESCE(vs.state, 'unknown') || ':' || vs.ended_reason
          ELSE COALESCE(vs.state, 'unknown')
        END,
        'event_id', vs.event_id,
        'session_id', vs.id
      ) AS item
    FROM (
      SELECT *
      FROM public.video_sessions
      WHERE event_id = p_event_id
      ORDER BY state_updated_at DESC NULLS LAST, ended_at DESC NULLS LAST, started_at DESC
      LIMIT 30
    ) vs

    UNION ALL

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
    FROM (
      SELECT *
      FROM public.admin_activity_logs
      WHERE target_type = 'event'
        AND target_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 30
    ) aal
  ),
  limited_items AS (
    SELECT item, sort_at
    FROM raw_items
    ORDER BY sort_at DESC
    LIMIT 40
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY sort_at DESC), '[]'::jsonb)
  INTO v_items
  FROM limited_items;

  RETURN public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'sources', v_sources,
    'items', v_items
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_event_lifecycle_feed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_event_lifecycle_feed(uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507113000',
  'Admin event lifecycle feed read model',
  'schema-only',
  'Adds a security-definer admin RPC that reads event-scoped queue and lifecycle sources for Event Analytics. It does not mutate event, queue, notification, or payment data.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_event_lifecycle_feed(uuid) IS
  'Admin Event Analytics lifecycle queue/log read model. Uses security definer to distinguish true zero rows from browser RLS-hidden sources.';
