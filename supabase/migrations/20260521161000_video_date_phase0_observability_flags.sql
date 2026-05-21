-- Vibely Video Date v4 Phase 0.
-- Additive rollout groundwork: synthetic event isolation, service-role
-- dashboard read models, default-off rollout flags, and a safe monitor cron.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_test_event boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_public_not_test
  ON public.events(event_date, status)
  WHERE archived_at IS NULL AND COALESCE(is_test_event, false) = false;

DROP POLICY IF EXISTS "Anyone can view events" ON public.events;
CREATE POLICY "Anyone can view events" ON public.events
  FOR SELECT
  USING (
    COALESCE(is_test_event, false) = false
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

COMMENT ON POLICY "Anyone can view events" ON public.events IS
  'Public event reads exclude synthetic is_test_event rows. Admins can inspect fixtures; service_role bypasses RLS.';

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id          uuid,
  p_user_lat         double precision DEFAULT NULL,
  p_user_lng         double precision DEFAULT NULL,
  p_is_premium       boolean          DEFAULT false,
  p_browse_lat       double precision DEFAULT NULL,
  p_browse_lng       double precision DEFAULT NULL,
  p_filter_radius_km double precision DEFAULT NULL
)
RETURNS TABLE(
  id                  uuid,
  title               text,
  description         text,
  cover_image         text,
  event_date          timestamptz,
  duration_minutes    integer,
  max_attendees       integer,
  current_attendees   integer,
  tags                text[],
  category_keys       text[],
  categories          jsonb,
  vibes               text[],
  status              text,
  city                text,
  country             text,
  scope               text,
  latitude            double precision,
  longitude           double precision,
  radius_km           integer,
  distance_km         double precision,
  is_registered       boolean,
  computed_status     text,
  is_recurring        boolean,
  parent_event_id     uuid,
  occurrence_number   integer,
  language            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_is_admin            boolean;
  v_can_city_browse     boolean;
  v_profile_country     text;
  v_profile_lat         double precision;
  v_profile_lng         double precision;
  v_user_lat_eff        double precision;
  v_user_lng_eff        double precision;
  v_browse_lat_eff      double precision;
  v_browse_lng_eff      double precision;
  v_effective_lat       double precision;
  v_effective_lng       double precision;
  v_browse_requested    boolean;
  v_valid_user_coords   boolean;
  v_valid_browse_coords boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    p.country,
    public.profile_location_coord(p.location_data, 'lat'),
    public.profile_location_coord(p.location_data, 'lng')
  INTO
    v_profile_country,
    v_profile_lat,
    v_profile_lng
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  v_can_city_browse :=
    COALESCE(v_is_admin, false)
    OR COALESCE(public._get_user_tier_capability_bool_unchecked(p_user_id, 'canCityBrowse'), false);

  v_browse_requested := p_browse_lat IS NOT NULL OR p_browse_lng IS NOT NULL;

  v_valid_user_coords :=
    p_user_lat IS NOT NULL
    AND p_user_lng IS NOT NULL
    AND p_user_lat BETWEEN -90 AND 90
    AND p_user_lng BETWEEN -180 AND 180;

  v_valid_browse_coords :=
    p_browse_lat IS NOT NULL
    AND p_browse_lng IS NOT NULL
    AND p_browse_lat BETWEEN -90 AND 90
    AND p_browse_lng BETWEEN -180 AND 180;

  IF NOT v_can_city_browse AND v_browse_requested THEN
    v_user_lat_eff := v_profile_lat;
    v_user_lng_eff := v_profile_lng;
  ELSE
    v_user_lat_eff := COALESCE(
      CASE WHEN v_valid_user_coords THEN p_user_lat ELSE NULL END,
      v_profile_lat
    );
    v_user_lng_eff := COALESCE(
      CASE WHEN v_valid_user_coords THEN p_user_lng ELSE NULL END,
      v_profile_lng
    );
  END IF;

  v_browse_lat_eff := CASE
    WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, v_user_lat_eff);
  v_effective_lng := COALESCE(v_browse_lng_eff, v_user_lng_eff);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.category_keys,
    COALESCE(cat.categories, '[]'::jsonb) AS categories,
    e.vibes,
    e.status, e.city, e.country, e.scope, e.latitude, e.longitude,
    e.radius_km,
    CASE
      WHEN e.latitude IS NOT NULL
           AND e.longitude IS NOT NULL
           AND v_effective_lat IS NOT NULL
           AND v_effective_lng IS NOT NULL
      THEN public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = e.id
        AND er.profile_id = p_user_id
    ) AS is_registered,
    CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'draft' THEN 'draft'
      WHEN e.ended_at IS NOT NULL THEN 'ended'
      WHEN now() >= e.event_date
           AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'live'
      WHEN now() >= (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'ended'
      ELSE 'upcoming'
    END AS computed_status,
    e.is_recurring, e.parent_event_id, e.occurrence_number,
    e.language
  FROM public.events e
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN e.scope = 'regional' THEN 'regional'
      WHEN e.scope = 'local' OR COALESCE(e.is_location_specific, false) THEN 'local'
      WHEN e.scope = 'global' THEN 'global'
      WHEN e.scope IS NULL AND (e.latitude IS NOT NULL OR e.longitude IS NOT NULL) THEN 'local'
      ELSE 'global'
    END AS discovery_scope
  ) ds
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object('key', ec.key, 'label', ec.label, 'emoji', ec.emoji)
      ORDER BY ec.sort_order, ec.label
    ) AS categories
    FROM public.event_categories ec
    WHERE ec.key = ANY(COALESCE(e.category_keys, ARRAY[]::text[]))
  ) cat ON true
  WHERE e.archived_at IS NULL
    AND COALESCE(e.is_test_event, false) = false
    AND e.status != 'draft'
    AND e.status IS DISTINCT FROM 'cancelled'
    AND COALESCE(e.is_recurring, false) = false
    AND public._user_can_access_event_visibility_unchecked(p_user_id, COALESCE(e.visibility, 'all'))
    AND now() <= COALESCE(
      e.ended_at,
      e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute'
    ) + interval '6 hours'

    AND (
      ds.discovery_scope = 'global'

      OR (
        ds.discovery_scope = 'regional'
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND (
          e.country IS NULL
          OR e.country = v_profile_country
          OR v_can_city_browse
        )
      )

      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= COALESCE(e.radius_km, 50)::double precision
      )
    )

    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR ds.discovery_scope IN ('global', 'regional')
      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= p_filter_radius_km
      )
    )

  ORDER BY
    CASE
      WHEN now() >= e.event_date
           AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) IS
  'Returns discover/home-visible non-test events for the authenticated p_user_id. '
  'Synthetic is_test_event rows are excluded from user-facing discovery by default. '
  'Non-service callers must match auth.uid(); p_is_premium is ignored. '
  'City browse is server-derived from admin role or tier capability grants. '
  'Rejected non-premium browse coordinates fall back to stored profile coordinates only. '
  'Local/location-specific rows require event latitude/longitude and an effective reference point; radius filters apply only to local rows. '
  'Global rows and regional rows intentionally bypass strict radius only through explicit scope semantics.';

CREATE OR REPLACE FUNCTION public.get_other_city_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL
) RETURNS TABLE (city text, country text, event_count bigint, sample_cover text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.city,
    e.country,
    COUNT(*)::bigint AS event_count,
    MIN(e.cover_image) AS sample_cover
  FROM public.events e
  WHERE e.archived_at IS NULL
    AND COALESCE(e.is_test_event, false) = false
    AND e.status NOT IN ('draft', 'cancelled', 'ended')
    AND COALESCE(e.is_recurring, false) = false
    AND e.event_date > now()
    AND e.scope = 'local'
    AND e.city IS NOT NULL
    AND e.latitude IS NOT NULL
    AND (
      p_user_lat IS NULL
      OR public.haversine_distance(p_user_lat, p_user_lng, e.latitude, e.longitude) > COALESCE(e.radius_km, 50)
    )
  GROUP BY e.city, e.country
  ORDER BY event_count DESC
  LIMIT 6;
END;
$$;

COMMENT ON FUNCTION public.get_other_city_events(uuid, double precision, double precision) IS
  'Premium teaser city rollup. Excludes synthetic is_test_event rows from user-facing surfaces.';

CREATE OR REPLACE VIEW public.vw_session_health
WITH (security_invoker = true) AS
SELECT
  vs.id AS session_id,
  vs.event_id,
  COALESCE(e.is_test_event, false) AS is_test_event,
  CASE WHEN COALESCE(e.is_test_event, false) THEN 'synthetic' ELSE 'production' END AS sample_class,
  vs.participant_1_id,
  vs.participant_2_id,
  vs.state::text AS state,
  vs.phase,
  vs.ready_gate_status,
  vs.started_at,
  vs.state_updated_at,
  vs.ready_gate_expires_at,
  vs.handshake_started_at,
  vs.date_started_at,
  vs.ended_at,
  vs.ended_reason,
  vs.daily_room_name,
  vs.session_seq,
  COALESCE(vs.ended_at, vs.state_updated_at, vs.started_at) AS last_state_at,
  CASE
    WHEN vs.ended_at IS NULL
         AND COALESCE(vs.state::text, '') <> 'ended'
         AND now() - COALESCE(vs.state_updated_at, vs.started_at) > interval '2 minutes'
      THEN true
    ELSE false
  END AS active_stuck_over_2m,
  CASE
    WHEN vs.ended_at IS NULL
         AND COALESCE(vs.state::text, '') <> 'ended'
      THEN EXTRACT(EPOCH FROM (now() - COALESCE(vs.state_updated_at, vs.started_at)))::integer
    ELSE NULL
  END AS active_age_seconds
FROM public.video_sessions vs
LEFT JOIN public.events e ON e.id = vs.event_id;

CREATE OR REPLACE VIEW public.vw_session_funnel
WITH (security_invoker = true) AS
SELECT
  vs.event_id,
  COALESCE(e.is_test_event, false) AS is_test_event,
  CASE WHEN COALESCE(e.is_test_event, false) THEN 'synthetic' ELSE 'production' END AS sample_class,
  date_trunc('hour', COALESCE(vs.started_at, now())) AS bucket_utc,
  COUNT(*)::bigint AS sessions_created,
  COUNT(*) FILTER (WHERE vs.ready_gate_status IS NOT NULL OR vs.phase = 'ready_gate' OR vs.state::text = 'ready_gate')::bigint AS ready_gate_sessions,
  COUNT(*) FILTER (WHERE vs.handshake_started_at IS NOT NULL OR vs.phase = 'handshake' OR vs.state::text = 'handshake')::bigint AS handshake_sessions,
  COUNT(*) FILTER (WHERE vs.date_started_at IS NOT NULL OR vs.phase = 'date' OR vs.state::text = 'date')::bigint AS date_sessions,
  COUNT(*) FILTER (WHERE vs.ended_at IS NOT NULL OR vs.phase = 'ended' OR vs.state::text = 'ended')::bigint AS ended_sessions,
  COUNT(*) FILTER (WHERE vs.ended_at IS NULL AND COALESCE(vs.state::text, '') <> 'ended')::bigint AS active_sessions,
  COUNT(*) FILTER (
    WHERE vs.ended_at IS NULL
      AND COALESCE(vs.state::text, '') <> 'ended'
      AND now() - COALESCE(vs.state_updated_at, vs.started_at) > interval '2 minutes'
  )::bigint AS stuck_over_2m_sessions
FROM public.video_sessions vs
LEFT JOIN public.events e ON e.id = vs.event_id
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW public.vw_synthetic_video_date_health
WITH (security_invoker = true) AS
SELECT
  e.id AS event_id,
  e.title,
  e.status,
  e.event_date,
  COUNT(DISTINCT er.profile_id)::bigint AS registration_count,
  COUNT(DISTINCT vs.id)::bigint AS session_count,
  COUNT(DISTINCT vs.id) FILTER (
    WHERE vs.ended_at IS NULL
      AND COALESCE(vs.state::text, '') <> 'ended'
  )::bigint AS active_session_count,
  COUNT(DISTINCT vs.id) FILTER (
    WHERE vs.ended_at IS NULL
      AND COALESCE(vs.state::text, '') <> 'ended'
      AND now() - COALESCE(vs.state_updated_at, vs.started_at) > interval '2 minutes'
  )::bigint AS stuck_over_2m_count,
  MAX(vs.started_at) AS last_session_started_at
FROM public.events e
LEFT JOIN public.event_registrations er ON er.event_id = e.id
LEFT JOIN public.video_sessions vs ON vs.event_id = e.id
WHERE COALESCE(e.is_test_event, false) = true
GROUP BY e.id, e.title, e.status, e.event_date;

CREATE OR REPLACE VIEW public.vw_video_date_flag_rollout
WITH (security_invoker = true) AS
SELECT
  flag_key,
  enabled,
  kill_switch_active,
  rollout_bps,
  description,
  updated_at
FROM public.client_feature_flags
WHERE flag_key LIKE 'video_date.%'
ORDER BY flag_key;

CREATE OR REPLACE VIEW public.vw_outbox_health
WITH (security_invoker = true) AS
SELECT
  state,
  kind,
  COUNT(*)::bigint AS row_count,
  MIN(next_attempt_at) AS oldest_next_attempt_at,
  MAX(attempts) AS max_attempts,
  COUNT(*) FILTER (
    WHERE state IN ('pending', 'claimed')
      AND next_attempt_at < now() - interval '5 seconds'
  )::bigint AS late_rows
FROM public.video_date_provider_outbox
GROUP BY state, kind;

REVOKE ALL ON TABLE public.vw_session_health FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vw_session_funnel FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vw_synthetic_video_date_health FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vw_video_date_flag_rollout FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vw_outbox_health FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.vw_session_health TO service_role;
GRANT SELECT ON TABLE public.vw_session_funnel TO service_role;
GRANT SELECT ON TABLE public.vw_synthetic_video_date_health TO service_role;
GRANT SELECT ON TABLE public.vw_video_date_flag_rollout TO service_role;
GRANT SELECT ON TABLE public.vw_outbox_health TO service_role;

COMMENT ON VIEW public.vw_session_health IS
  'Service-role video date health dashboard. Includes sample_class so synthetic traffic is isolated from production.';
COMMENT ON VIEW public.vw_session_funnel IS
  'Service-role video date funnel rollup by event/hour with synthetic vs production split.';
COMMENT ON VIEW public.vw_synthetic_video_date_health IS
  'Service-role synthetic fixture readiness and stuck-session dashboard.';
COMMENT ON VIEW public.vw_video_date_flag_rollout IS
  'Service-role dashboard for video_date.* rollout flags and hard kills.';
COMMENT ON VIEW public.vw_outbox_health IS
  'Service-role v4 provider outbox backlog dashboard. Phase 2 workers will drive this to zero.';

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  ('video_date.snapshot_v2', false, 0, 'Video Date v4 token-free snapshot core plus Edge token wrapper.', false),
  ('video_date.deck_deal_v2', false, 0, 'Server-dealt deck impressions that prevent duplicate top cards after refresh/crash.', false),
  ('video_date.readiness_v2', false, 0, 'Persisted heartbeat/readiness and non-blocking pre-event readiness UX.', false),
  ('video_date.micro_verdict_v2', false, 0, 'Short in-event post-date verdict timeout while preserving long recovery.', false),
  ('video_date.broadcast_v2', false, 0, 'Private sanitized Broadcast for participant-visible session events.', false),
  ('video_date.timeline_v2', false, 0, 'Server-owned timeline and countdown rendering from snapshot deadlines.', false),
  ('video_date.daily_webhooks_v2', false, 0, 'Daily webhook reconciliation with signature verification.', false),
  ('video_date.extension_mutual_v2', false, 0, 'Mutual extension flow with room-expiry proof and refund safety.', false),
  ('video_date.safety_always_on_v2', false, 0, 'Always-on in-call report/block surfaces backed by private safety events.', false),
  ('video_date.daily_pool_v2', false, 0, 'Conditional Daily room pool, enabled only if measured latency requires it.', false),
  ('video_date.outbox_v2.mark_ready', false, 0, 'Transactional outbox path for mark-ready transition.', false),
  ('video_date.outbox_v2.forfeit', false, 0, 'Transactional outbox path for forfeit/end-before-date transition.', false),
  ('video_date.outbox_v2.continue_handshake', false, 0, 'Transactional outbox path for early handshake continue.', false),
  ('video_date.outbox_v2.handshake_auto_promote', false, 0, 'Transactional outbox path for server handshake auto-promote.', false),
  ('video_date.outbox_v2.date_timeout', false, 0, 'Transactional outbox path for server date timeout.', false),
  ('video_date.outbox_v2.submit_verdict', false, 0, 'Transactional outbox path for post-date verdict submission.', false),
  ('video_date.outbox_v2.extension', false, 0, 'Transactional outbox path for extension proposal/accept/refund.', false),
  ('video_date.outbox_v2.safety', false, 0, 'Transactional outbox path for report/block session ending.', false),
  ('video_date.outbox_v2.drain_match_queue', false, 0, 'Transactional outbox path for match-queue drain and promotion.', false)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

DO $$
DECLARE
  v_job_id integer;
  v_project_url text;
  v_cron_secret text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'vault'
         AND table_name = 'decrypted_secrets'
     ) THEN

    SELECT trim(decrypted_secret) INTO v_project_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;

    SELECT trim(decrypted_secret) INTO v_cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
    LIMIT 1;

    IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_cron_secret, '') IS NULL THEN
      RAISE NOTICE 'synthetic-video-date-monitor cron not scheduled: missing Vault project_url or cron_secret';
      RETURN;
    END IF;

    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'synthetic-video-date-monitor'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'synthetic-video-date-monitor',
      '*/5 * * * *',
      $cmd$
      SELECT net.http_post(
        url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
          || '/functions/v1/synthetic-video-date-monitor',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))
        ),
        body := jsonb_build_object('mode', 'status')
      );
      $cmd$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'synthetic-video-date-monitor cron not scheduled: %', SQLERRM;
END $$;
