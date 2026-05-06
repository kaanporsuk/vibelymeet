-- Admin Overview dashboard read model.
--
-- Migration class: schema + read-only RPC.
-- Intent: make /kaan Overview cards and charts read one backend-authoritative
-- surface so loading/errors cannot masquerade as true zeroes. This migration
-- performs no data backfill and no production data mutation.

CREATE OR REPLACE FUNCTION public.admin_get_overview_dashboard(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_today_start timestamptz;
  v_window_start timestamptz;
  v_stats jsonb;
  v_quick_actions jsonb;
  v_daily_drop jsonb;
  v_user_growth jsonb;
  v_match_trends jsonb;
  v_event_fill_rows jsonb;
  v_gender_distribution jsonb;
  v_possible_test_event_rows integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_today_start := date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_window_start := v_today_start - interval '29 days';

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*)::integer FROM public.profiles),
    'today_users', (SELECT count(*)::integer FROM public.profiles WHERE created_at >= v_today_start),
    'total_matches', (SELECT count(*)::integer FROM public.matches),
    'total_messages', (SELECT count(*)::integer FROM public.messages),
    'verified_users', (SELECT count(*)::integer FROM public.profiles WHERE photo_verified IS TRUE),
    'matches_per_user', (
      SELECT CASE
        WHEN count_profiles.total_users > 0
          THEN round(((SELECT count(*)::numeric FROM public.matches) / count_profiles.total_users::numeric), 2)
        ELSE 0
      END
      FROM (SELECT count(*)::integer AS total_users FROM public.profiles) count_profiles
    ),
    'events', jsonb_build_object(
      'total', (SELECT count(*)::integer FROM public.events),
      'live', (SELECT count(*)::integer FROM public.events WHERE archived_at IS NULL AND ended_at IS NULL AND status = 'live'),
      'upcoming', (SELECT count(*)::integer FROM public.events WHERE archived_at IS NULL AND ended_at IS NULL AND status = 'upcoming' AND event_date >= p_now),
      'draft', (SELECT count(*)::integer FROM public.events WHERE status = 'draft'),
      'cancelled', (SELECT count(*)::integer FROM public.events WHERE status = 'cancelled'),
      'archived', (SELECT count(*)::integer FROM public.events WHERE archived_at IS NOT NULL),
      'ended', (SELECT count(*)::integer FROM public.events WHERE ended_at IS NOT NULL OR status IN ('ended', 'completed'))
    )
  ) INTO v_stats;

  WITH actionable AS (
    SELECT
      id,
      title,
      event_date,
      status,
      current_attendees,
      max_attendees
    FROM public.events
    WHERE event_date >= p_now
      AND archived_at IS NULL
      AND ended_at IS NULL
      AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'completed', 'ended')
      AND p_now < event_date + (COALESCE(duration_minutes, 60)::text || ' minutes')::interval
    ORDER BY event_date ASC
  ),
  preview AS (
    SELECT * FROM actionable LIMIT 3
  )
  SELECT jsonb_build_object(
    'pending_reports_count', (SELECT count(*)::integer FROM public.user_reports WHERE status = 'pending'),
    'new_users_today_count', (SELECT count(*)::integer FROM public.profiles WHERE created_at >= v_today_start),
    'actionable_upcoming_events', jsonb_build_object(
      'count', (SELECT count(*)::integer FROM actionable),
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'title', title,
            'event_date', event_date,
            'status', status,
            'current_attendees', current_attendees,
            'max_attendees', max_attendees
          )
          ORDER BY event_date ASC
        )
        FROM preview
      ), '[]'::jsonb)
    )
  ) INTO v_quick_actions;

  SELECT jsonb_build_object(
    'today_pairs', (
      SELECT count(*)::integer
      FROM public.daily_drops
      WHERE drop_date = (v_today_start AT TIME ZONE 'UTC')::date
    ),
    'today_date_utc', ((v_today_start AT TIME ZONE 'UTC')::date)::text,
    'last_generated_at', (SELECT max(starts_at) FROM public.daily_drops)
  ) INTO v_daily_drop;

  WITH days AS (
    SELECT generate_series(v_window_start, v_today_start, interval '1 day') AS day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      count(profiles.id)::integer AS users
    FROM days
    LEFT JOIN public.profiles
      ON profiles.created_at >= days.day_start
     AND profiles.created_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start, 'Mon FMDD'),
      'users', users
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_user_growth
  FROM counted;

  WITH days AS (
    SELECT generate_series(v_window_start, v_today_start, interval '1 day') AS day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      count(matches.id)::integer AS matches
    FROM days
    LEFT JOIN public.matches
      ON matches.matched_at >= days.day_start
     AND matches.matched_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start, 'Mon FMDD'),
      'matches', matches
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_match_trends
  FROM counted;

  WITH latest_events AS (
    SELECT
      id,
      title,
      event_date,
      status,
      current_attendees,
      COALESCE(NULLIF(max_attendees, 0), 50) AS capacity,
      archived_at,
      ended_at
    FROM public.events
    ORDER BY event_date DESC NULLS LAST
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'title', title,
      'name', CASE WHEN length(title) > 15 THEN substring(title from 1 for 15) || '...' ELSE title END,
      'attendees', COALESCE(current_attendees, 0),
      'capacity', capacity,
      'fillRate', round((COALESCE(current_attendees, 0)::numeric / capacity::numeric) * 100)::integer,
      'status', status,
      'archived', archived_at IS NOT NULL,
      'ended', ended_at IS NOT NULL OR status IN ('ended', 'completed')
    )
    ORDER BY event_date DESC NULLS LAST
  ), '[]'::jsonb)
  INTO v_event_fill_rows
  FROM latest_events;

  WITH gender_counts AS (
    SELECT
      COALESCE(NULLIF(gender, ''), 'Unknown') AS raw_gender,
      count(*)::integer AS value
    FROM public.profiles
    GROUP BY COALESCE(NULLIF(gender, ''), 'Unknown')
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'raw_gender', raw_gender,
      'name', initcap(replace(raw_gender, '_', ' ')),
      'value', value
    )
    ORDER BY value DESC, raw_gender ASC
  ), '[]'::jsonb)
  INTO v_gender_distribution
  FROM gender_counts;

  SELECT count(*)::integer
  INTO v_possible_test_event_rows
  FROM public.events
  WHERE title ILIKE ANY (ARRAY['%test%', '%codex%', '%prewarm%', '%smoke%']);

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', p_now,
    'reporting_timezone', 'UTC',
    'window_start_today', v_today_start,
    'stats', v_stats,
    'quick_actions', v_quick_actions,
    'daily_drop', v_daily_drop,
    'charts', jsonb_build_object(
      'user_growth_30d', v_user_growth,
      'match_trends_30d', v_match_trends,
      'latest_event_fill_rows', v_event_fill_rows,
      'gender_distribution', v_gender_distribution
    ),
    'data_hygiene', jsonb_build_object(
      'possible_test_event_rows', v_possible_test_event_rows
    )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_overview_dashboard(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_overview_dashboard(timestamptz) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260506135000',
  'Admin Overview dashboard read model',
  'schema-only',
  'Adds one read-only admin RPC for Overview dashboard cards, quick actions, Daily Drop status, and charts. No data rewrite or production mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_overview_dashboard(timestamptz) IS
  'Read-only backend-authoritative /kaan Overview dashboard payload. Uses UTC windows and admin role verification; performs no writes.';
