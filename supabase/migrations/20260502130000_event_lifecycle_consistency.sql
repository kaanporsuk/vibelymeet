-- Event lifecycle consistency.
--
-- Forward-only replacement of existing lifecycle/computed-status functions.
-- No table schema changes. No new RPCs. Manual ended_at remains terminal, but
-- stale raw status='ended' without ended_at is allowed to resolve live inside
-- the scheduled event window.

CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  is_active boolean,
  reason text,
  event_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_now timestamptz := COALESCE(p_now, now());
  v_status text;
  v_scheduled_end timestamptz;
BEGIN
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'event_not_found'::text, NULL::text;
    RETURN;
  END IF;

  v_status := COALESCE(NULLIF(v_event.status, ''), 'upcoming');

  IF v_status = 'draft' THEN
    RETURN QUERY SELECT false, 'event_draft'::text, v_event.status;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'event_cancelled'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.archived_at IS NOT NULL OR v_status = 'archived' THEN
    RETURN QUERY SELECT false, 'event_archived'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.ended_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'event_ended'::text, v_event.status;
    RETURN;
  END IF;

  IF v_status NOT IN ('upcoming', 'scheduled', 'live', 'ended', 'completed') THEN
    RETURN QUERY SELECT false, 'event_not_live'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.event_date IS NULL THEN
    RETURN QUERY SELECT false, 'event_outside_live_window'::text, v_event.status;
    RETURN;
  END IF;

  IF v_now < v_event.event_date THEN
    RETURN QUERY SELECT false, 'event_not_started'::text, v_event.status;
    RETURN;
  END IF;

  v_scheduled_end :=
    v_event.event_date + COALESCE(v_event.duration_minutes, 60) * interval '1 minute';

  IF v_now >= v_scheduled_end THEN
    RETURN QUERY SELECT false, 'event_outside_live_window'::text, v_event.status;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_event.status;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz) IS
  'Internal canonical Event Lobby active-state helper. Active is derived from terminal fields plus the scheduled event window; ended_at is terminal, while stale raw ended/completed without ended_at may still be active during the scheduled window.';

CREATE OR REPLACE FUNCTION public.get_event_lobby_inactive_reason(
  p_event_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT state.reason
  FROM public.get_event_lobby_active_state(p_event_id, now()) AS state
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_event_lobby_active(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(state.is_active, false)
  FROM public.get_event_lobby_active_state(p_event_id, now()) AS state
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_event_lobby_inactive_reason(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_event_lobby_active(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_lobby_inactive_reason(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_event_lobby_active(uuid) TO service_role;

COMMENT ON FUNCTION public.get_event_lobby_inactive_reason(uuid) IS
  'Compatibility wrapper around get_event_lobby_active_state(uuid, timestamptz). Returns NULL only for scheduled-active Event Lobby events.';

COMMENT ON FUNCTION public.is_event_lobby_active(uuid) IS
  'Compatibility boolean wrapper around get_event_lobby_active_state(uuid, timestamptz).';

CREATE OR REPLACE FUNCTION public.lock_event_lobby_scheduled_active_state(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  is_active boolean,
  reason text,
  event_status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
  FOR SHARE OF ev;

  RETURN QUERY
  SELECT state.is_active, state.reason, state.event_status
  FROM public.get_event_lobby_active_state(p_event_id, p_now) AS state;
END;
$function$;

REVOKE ALL ON FUNCTION public.lock_event_lobby_scheduled_active_state(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_event_lobby_scheduled_active_state(uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.lock_event_lobby_scheduled_active_state(uuid, timestamptz) IS
  'Internal row-locking active-state helper for lobby mutation RPCs. Locks the event row, then applies canonical scheduled-window lifecycle rules.';

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
  v_sub_active          boolean;
  v_is_admin            boolean;
  v_profile_premium     boolean;
  v_can_premium_browse  boolean;
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
    public.profile_location_coord(p.location_data, 'lng'),
    (
      p.is_premium = true
      OR (p.premium_until IS NOT NULL AND p.premium_until > now())
    )
  INTO
    v_profile_country,
    v_profile_lat,
    v_profile_lng,
    v_profile_premium
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trialing')
  ) INTO v_sub_active;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  v_can_premium_browse :=
    COALESCE(v_sub_active, false)
    OR COALESCE(v_is_admin, false)
    OR COALESCE(v_profile_premium, false);

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

  IF NOT v_can_premium_browse AND v_browse_requested THEN
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
    WHEN v_can_premium_browse AND v_valid_browse_coords THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_premium_browse AND v_valid_browse_coords THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, v_user_lat_eff);
  v_effective_lng := COALESCE(v_browse_lng_eff, v_user_lng_eff);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
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
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND e.status IS DISTINCT FROM 'cancelled'
    AND COALESCE(e.is_recurring, false) = false
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
          OR v_can_premium_browse
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
  'Returns discover/home-visible events for the authenticated p_user_id. '
  'Non-service callers must match auth.uid(); p_is_premium is ignored. '
  'Premium/city browse is server-derived from subscriptions, admin role, or profile premium grants. '
  'Rejected non-premium browse coordinates fall back to stored profile coordinates only. '
  'Local/location-specific rows require event latitude/longitude and an effective reference point; radius filters apply only to local rows. '
  'Global rows and regional rows intentionally bypass strict radius only through explicit scope semantics. '
  'computed_status derives lifecycle from ended_at plus scheduled event window before trusting stale raw ended status.';
