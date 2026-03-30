-- ============================================================
-- Privacy & Visibility backend enforcement
-- - is_profile_discoverable(target, viewer)
-- - get_event_visible_attendees(event, viewer)
-- - bidirectional legacy/new privacy sync trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_profile_discoverable(
  p_target_id uuid,
  p_viewer_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile RECORD;
  v_shares_event boolean;
BEGIN
  SELECT
    p.discovery_mode,
    p.discovery_snooze_until,
    p.discovery_audience,
    p.is_paused,
    p.paused_until,
    p.account_paused,
    p.account_paused_until,
    p.discoverable
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Effective pause checks (indefinite or still-active timed pauses).
  IF (
    COALESCE(v_profile.is_paused, false)
    AND (v_profile.paused_until IS NULL OR v_profile.paused_until > now())
  ) OR (
    COALESCE(v_profile.account_paused, false)
    AND (v_profile.account_paused_until IS NULL OR v_profile.account_paused_until > now())
  ) THEN
    RETURN false;
  END IF;

  -- Query-time snooze expiry (self-heal).
  IF v_profile.discovery_mode = 'snoozed' THEN
    IF v_profile.discovery_snooze_until IS NOT NULL
       AND v_profile.discovery_snooze_until <= now() THEN
      UPDATE public.profiles
      SET discovery_mode = 'visible',
          discovery_snooze_until = NULL,
          discoverable = true
      WHERE id = p_target_id;
    ELSE
      RETURN false;
    END IF;
  END IF;

  IF v_profile.discovery_mode = 'hidden' THEN
    RETURN false;
  END IF;

  IF v_profile.discovery_mode IS NULL
     AND COALESCE(v_profile.discoverable, true) = false THEN
    RETURN false;
  END IF;

  IF COALESCE(v_profile.discovery_audience, 'everyone') = 'hidden' THEN
    RETURN false;
  END IF;

  IF v_profile.discovery_audience = 'event_based' THEN
    IF p_viewer_id IS NULL THEN
      RETURN false;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_registrations er1
      JOIN public.event_registrations er2 ON er1.event_id = er2.event_id
      WHERE er1.profile_id = p_target_id
        AND er2.profile_id = p_viewer_id
    )
    INTO v_shares_event;

    RETURN v_shares_event;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_visible_attendees(
  p_event_id uuid,
  p_viewer_id uuid
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT er.profile_id
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.profile_id <> p_viewer_id
    AND NOT (
      COALESCE(p.is_paused, false)
      AND (p.paused_until IS NULL OR p.paused_until > now())
    )
    AND NOT (
      COALESCE(p.account_paused, false)
      AND (p.account_paused_until IS NULL OR p.account_paused_until > now())
    )
    AND (
      COALESCE(p.event_attendance_visibility, 'attendees') = 'attendees'
      OR (
        COALESCE(p.event_attendance_visibility, 'attendees') = 'matches_only'
        AND EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE
            (m.profile_id_1 = er.profile_id AND m.profile_id_2 = p_viewer_id)
            OR
            (m.profile_id_2 = er.profile_id AND m.profile_id_1 = p_viewer_id)
        )
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_legacy_to_privacy_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Legacy -> new
  IF OLD.discoverable IS DISTINCT FROM NEW.discoverable
     AND OLD.discovery_mode IS NOT DISTINCT FROM NEW.discovery_mode THEN
    IF NEW.discoverable = true THEN
      NEW.discovery_mode := 'visible';
      NEW.discovery_snooze_until := NULL;
    ELSE
      NEW.discovery_mode := 'hidden';
      NEW.discovery_snooze_until := NULL;
    END IF;
  END IF;

  IF OLD.show_distance IS DISTINCT FROM NEW.show_distance
     AND OLD.distance_visibility IS NOT DISTINCT FROM NEW.distance_visibility THEN
    NEW.distance_visibility := CASE WHEN NEW.show_distance = true THEN 'approximate' ELSE 'hidden' END;
  END IF;

  IF OLD.show_online_status IS DISTINCT FROM NEW.show_online_status
     AND OLD.activity_status_visibility IS NOT DISTINCT FROM NEW.activity_status_visibility THEN
    NEW.activity_status_visibility := CASE WHEN NEW.show_online_status = true THEN 'matches' ELSE 'nobody' END;
  END IF;

  -- New -> legacy
  IF OLD.discovery_mode IS DISTINCT FROM NEW.discovery_mode
     AND OLD.discoverable IS NOT DISTINCT FROM NEW.discoverable THEN
    NEW.discoverable := (NEW.discovery_mode = 'visible');
  END IF;

  IF OLD.distance_visibility IS DISTINCT FROM NEW.distance_visibility
     AND OLD.show_distance IS NOT DISTINCT FROM NEW.show_distance THEN
    NEW.show_distance := (NEW.distance_visibility = 'approximate');
  END IF;

  IF OLD.activity_status_visibility IS DISTINCT FROM NEW.activity_status_visibility
     AND OLD.show_online_status IS NOT DISTINCT FROM NEW.show_online_status THEN
    NEW.show_online_status := (NEW.activity_status_visibility <> 'nobody');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_to_privacy ON public.profiles;

CREATE TRIGGER trg_sync_legacy_to_privacy
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_legacy_to_privacy_columns();

GRANT EXECUTE ON FUNCTION public.is_profile_discoverable(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_profile_discoverable(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_visible_attendees(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_visible_attendees(uuid, uuid) TO service_role;
