-- Admin Overview operational truth follow-up.
--
-- Migration class: schema + read-only RPC + indexes.
-- Intent: make /kaan Overview use database time by default, expose Daily Drop
-- generation run truth separately from generated pair rows, and add indexes for
-- the dashboard read model. No data rewrite or destructive mutation.

CREATE TABLE IF NOT EXISTS public.daily_drop_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_started_at timestamptz NOT NULL DEFAULT now(),
  run_finished_at timestamptz,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'succeeded', 'skipped', 'failed', 'partial')),
  source text NOT NULL DEFAULT 'unknown'
    CHECK (source IN ('cron', 'admin', 'unknown')),
  force boolean NOT NULL DEFAULT false,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pairs_created integer NOT NULL DEFAULT 0 CHECK (pairs_created >= 0),
  users_notified integer NOT NULL DEFAULT 0 CHECK (users_notified >= 0),
  unpaired_users integer CHECK (unpaired_users IS NULL OR unpaired_users >= 0),
  reason text,
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_drop_generation_runs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.daily_drop_generation_runs TO authenticated;

DROP POLICY IF EXISTS "admins_select_daily_drop_generation_runs" ON public.daily_drop_generation_runs;
CREATE POLICY "admins_select_daily_drop_generation_runs"
  ON public.daily_drop_generation_runs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_drop_generation_runs;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_drop_generation_runs_started_at
  ON public.daily_drop_generation_runs(run_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_drop_generation_runs_status_started
  ON public.daily_drop_generation_runs(status, run_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON public.profiles(created_at);

CREATE INDEX IF NOT EXISTS idx_matches_matched_at
  ON public.matches(matched_at);

CREATE INDEX IF NOT EXISTS idx_daily_drops_drop_date
  ON public.daily_drops(drop_date);

CREATE INDEX IF NOT EXISTS idx_events_admin_overview_actionable
  ON public.events(event_date, status)
  WHERE archived_at IS NULL AND ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_get_overview_dashboard(p_now timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_now timestamptz := COALESCE(p_now, now());
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

  v_today_start := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
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
      'upcoming', (SELECT count(*)::integer FROM public.events WHERE archived_at IS NULL AND ended_at IS NULL AND status = 'upcoming' AND event_date >= v_now),
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
    WHERE event_date >= v_now
      AND archived_at IS NULL
      AND ended_at IS NULL
      AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'completed', 'ended')
      AND v_now < event_date + (COALESCE(duration_minutes, 60)::text || ' minutes')::interval
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

  WITH last_run AS (
    SELECT
      id,
      run_started_at,
      run_finished_at,
      status,
      source,
      force,
      pairs_created,
      users_notified,
      unpaired_users,
      reason,
      error
    FROM public.daily_drop_generation_runs
    ORDER BY run_started_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'today_pairs', (
      SELECT count(*)::integer
      FROM public.daily_drops
      WHERE drop_date = (v_today_start AT TIME ZONE 'UTC')::date
    ),
    'today_date_utc', ((v_today_start AT TIME ZONE 'UTC')::date)::text,
    'last_generated_at', (SELECT max(starts_at) FROM public.daily_drops),
    'last_run', (
      SELECT jsonb_build_object(
        'id', id,
        'started_at', run_started_at,
        'finished_at', run_finished_at,
        'status', status,
        'source', source,
        'force', force,
        'pairs_created', pairs_created,
        'users_notified', users_notified,
        'unpaired_users', unpaired_users,
        'reason', reason,
        'error', error
      )
      FROM last_run
    )
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
    'generated_at', v_now,
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
  '20260507211000',
  'Admin Overview operational truth',
  'schema-only',
  'Adds Daily Drop generation run tracking table, read indexes, and redefines the read-only Overview RPC to use database time by default. No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON TABLE public.daily_drop_generation_runs IS
  'Operational ledger for generate-daily-drops cron/admin invocations. Distinguishes job run status from daily_drops pair rows.';

COMMENT ON FUNCTION public.admin_get_overview_dashboard(timestamptz) IS
  'Read-only backend-authoritative /kaan Overview payload. Uses database now() by default, UTC windows, admin role verification, Daily Drop run metadata, and performs no writes.';
