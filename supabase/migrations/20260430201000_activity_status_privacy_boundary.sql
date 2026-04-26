-- Activity Status privacy boundary.
-- User-facing presence reads must use the masked RPCs below. Raw profile
-- activity timestamps and legacy visibility fields are internal/admin data.

REVOKE SELECT (activity_status_visibility, last_seen_at, show_online_status)
ON TABLE public.profiles
FROM PUBLIC;

REVOKE SELECT (activity_status_visibility, last_seen_at, show_online_status)
ON TABLE public.profiles
FROM anon, authenticated;

COMMENT ON COLUMN public.profiles.last_seen_at IS
  'Internal activity heartbeat timestamp. Direct client SELECT is revoked; user-facing surfaces must use get_profile_presence_for_viewer or get_chat_partner_presence.';

COMMENT ON COLUMN public.profiles.activity_status_visibility IS
  'Canonical user activity visibility preference. Other-user reads are not a presence authorization decision; use masked presence RPCs for user-facing activity.';

COMMENT ON COLUMN public.profiles.show_online_status IS
  'Legacy mirror of activity_status_visibility for write compatibility. Direct client SELECT is revoked to avoid stale privacy-signal leakage.';

COMMENT ON COLUMN public.event_registrations.last_active_at IS
  'Operational event/session heartbeat timestamp. Not a public attendee presence contract; normal clients are limited by event_registrations RLS and user-facing event presence must use a masked RPC if added.';

COMMENT ON COLUMN public.event_registrations.last_lobby_foregrounded_at IS
  'Operational lobby foreground timestamp for matching/session recovery. Not a public attendee presence contract; normal clients are limited by event_registrations RLS.';

COMMENT ON COLUMN public.match_calls.caller_last_seen_at IS
  'Call-scoped operational heartbeat for active call lifecycle cleanup, not a general user-facing activity status.';

COMMENT ON COLUMN public.match_calls.callee_last_seen_at IS
  'Call-scoped operational heartbeat for active call lifecycle cleanup, not a general user-facing activity status.';

CREATE OR REPLACE FUNCTION public.get_my_privacy_settings()
RETURNS TABLE (
  discovery_mode text,
  discovery_snooze_until timestamptz,
  discovery_audience text,
  activity_status_visibility text,
  distance_visibility text,
  event_attendance_visibility text,
  discoverable boolean,
  show_online_status boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(p.discovery_mode, 'visible') AS discovery_mode,
    p.discovery_snooze_until,
    COALESCE(p.discovery_audience, 'everyone') AS discovery_audience,
    COALESCE(p.activity_status_visibility, 'matches') AS activity_status_visibility,
    COALESCE(p.distance_visibility, 'approximate') AS distance_visibility,
    COALESCE(p.event_attendance_visibility, 'attendees') AS event_attendance_visibility,
    COALESCE(p.discoverable, true) AS discoverable,
    COALESCE(p.show_online_status, true) AS show_online_status
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_privacy_settings() IS
  'Owner-only settings read path for privacy controls whose raw columns should not be directly readable from other profile rows.';

CREATE OR REPLACE FUNCTION public.update_my_privacy_settings(p_patch jsonb)
RETURNS TABLE (
  discovery_mode text,
  discovery_snooze_until timestamptz,
  discovery_audience text,
  activity_status_visibility text,
  distance_visibility text,
  event_attendance_visibility text,
  discoverable boolean,
  show_online_status boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_activity text;
  v_discovery_mode text;
  v_discovery_audience text;
  v_distance_visibility text;
  v_event_attendance_visibility text;
  v_bad_key text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Privacy settings patch must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT key INTO v_bad_key
  FROM jsonb_object_keys(p_patch) AS key
  WHERE key NOT IN (
    'discovery_mode',
    'discovery_snooze_until',
    'discovery_audience',
    'activity_status_visibility',
    'distance_visibility',
    'event_attendance_visibility',
    'discoverable'
  )
  LIMIT 1;

  IF v_bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported privacy setting: %', v_bad_key USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'activity_status_visibility' THEN
    v_activity := p_patch ->> 'activity_status_visibility';
    IF v_activity NOT IN ('matches', 'event_connections', 'nobody') THEN
      RAISE EXCEPTION 'Invalid activity_status_visibility: %', v_activity USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'discovery_mode' THEN
    v_discovery_mode := p_patch ->> 'discovery_mode';
    IF v_discovery_mode NOT IN ('visible', 'snoozed', 'hidden') THEN
      RAISE EXCEPTION 'Invalid discovery_mode: %', v_discovery_mode USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'discovery_audience' THEN
    v_discovery_audience := p_patch ->> 'discovery_audience';
    IF v_discovery_audience NOT IN ('everyone', 'event_based', 'hidden') THEN
      RAISE EXCEPTION 'Invalid discovery_audience: %', v_discovery_audience USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'distance_visibility' THEN
    v_distance_visibility := p_patch ->> 'distance_visibility';
    IF v_distance_visibility NOT IN ('approximate', 'hidden') THEN
      RAISE EXCEPTION 'Invalid distance_visibility: %', v_distance_visibility USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'event_attendance_visibility' THEN
    v_event_attendance_visibility := p_patch ->> 'event_attendance_visibility';
    IF v_event_attendance_visibility NOT IN ('attendees', 'matches_only', 'hidden') THEN
      RAISE EXCEPTION 'Invalid event_attendance_visibility: %', v_event_attendance_visibility USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.profiles p
  SET
    discovery_mode = CASE
      WHEN p_patch ? 'discovery_mode' THEN v_discovery_mode
      ELSE p.discovery_mode
    END,
    discovery_snooze_until = CASE
      WHEN p_patch ? 'discovery_snooze_until' THEN NULLIF(p_patch ->> 'discovery_snooze_until', '')::timestamptz
      ELSE p.discovery_snooze_until
    END,
    discovery_audience = CASE
      WHEN p_patch ? 'discovery_audience' THEN v_discovery_audience
      ELSE p.discovery_audience
    END,
    activity_status_visibility = CASE
      WHEN p_patch ? 'activity_status_visibility' THEN v_activity
      ELSE p.activity_status_visibility
    END,
    distance_visibility = CASE
      WHEN p_patch ? 'distance_visibility' THEN v_distance_visibility
      ELSE p.distance_visibility
    END,
    event_attendance_visibility = CASE
      WHEN p_patch ? 'event_attendance_visibility' THEN v_event_attendance_visibility
      ELSE p.event_attendance_visibility
    END,
    discoverable = CASE
      WHEN p_patch ? 'discoverable' THEN (p_patch ->> 'discoverable')::boolean
      ELSE p.discoverable
    END
  WHERE p.id = v_uid;

  RETURN QUERY
  SELECT * FROM public.get_my_privacy_settings();
END;
$$;

COMMENT ON FUNCTION public.update_my_privacy_settings(jsonb) IS
  'Owner-only privacy settings update path. Keeps activity_status_visibility writable after raw column SELECT is revoked from clients.';

CREATE OR REPLACE FUNCTION public.mark_my_activity_seen()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles p
  SET last_seen_at = now()
  WHERE p.id = v_uid
    AND COALESCE(p.activity_status_visibility, 'matches') <> 'nobody';

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.mark_my_activity_seen() IS
  'Server-owned activity heartbeat. Skips last_seen_at writes while the caller has activity_status_visibility = nobody; raw last_seen_at remains internal.';

CREATE OR REPLACE FUNCTION public.can_view_profile_presence(
  p_viewer_id uuid,
  p_target_user_id uuid,
  p_event_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_viewer_id IS NOT NULL
    AND p_target_user_id IS NOT NULL
    AND p_viewer_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.profiles target
      WHERE target.id = p_target_user_id
        AND (
          p_target_user_id = p_viewer_id
          OR (
            NOT public.profiles_have_safety_block(p_target_user_id, p_viewer_id)
            AND (
              (
                COALESCE(target.activity_status_visibility, 'matches') = 'matches'
                AND EXISTS (
                  SELECT 1
                  FROM public.matches m
                  WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_target_user_id)
                     OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_target_user_id)
                )
              )
              OR (
                COALESCE(target.activity_status_visibility, 'matches') = 'event_connections'
                AND (
                  EXISTS (
                    SELECT 1
                    FROM public.matches m
                    WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_target_user_id)
                       OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_target_user_id)
                  )
                  OR (
                    p_event_id IS NOT NULL
                    AND public.profiles_have_qualifying_shared_event(
                      p_viewer_id,
                      p_target_user_id,
                      p_event_id
                    )
                  )
                )
              )
            )
          )
        )
    );
$$;

COMMENT ON FUNCTION public.can_view_profile_presence(uuid, uuid, uuid) IS
  'Authoritative predicate for user-facing profile presence. Caller-bound: p_viewer_id must equal auth.uid(). nobody hides from viewers; matches requires an established match; event_connections requires a match or current/upcoming/live shared event context; safety blocks override visibility. Admin diagnostics must use separate admin-guarded paths.';

CREATE OR REPLACE FUNCTION public.get_profile_presence_for_viewer(
  p_target_user_id uuid,
  p_event_id uuid DEFAULT NULL
) RETURNS TABLE (
  target_user_id uuid,
  last_seen_at timestamptz,
  is_online boolean,
  can_view_presence boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_can_view boolean := false;
BEGIN
  IF v_viewer_id IS NULL OR p_target_user_id IS NULL THEN
    RETURN QUERY SELECT p_target_user_id, NULL::timestamptz, false, false;
    RETURN;
  END IF;

  v_can_view := public.can_view_profile_presence(v_viewer_id, p_target_user_id, p_event_id);

  RETURN QUERY
  SELECT
    p_target_user_id,
    CASE WHEN v_can_view THEN p.last_seen_at ELSE NULL::timestamptz END,
    CASE WHEN v_can_view THEN COALESCE(p.last_seen_at >= now() - interval '5 minutes', false) ELSE false END,
    v_can_view
  FROM public.profiles p
  WHERE p.id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_target_user_id, NULL::timestamptz, false, false;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_profile_presence_for_viewer(uuid, uuid) IS
  'Masked user-facing profile presence. Returns NULL/false when the viewer is not allowed to see raw activity.';

CREATE OR REPLACE FUNCTION public.get_chat_partner_presence(
  p_match_id uuid
) RETURNS TABLE (
  target_user_id uuid,
  last_seen_at timestamptz,
  is_online boolean,
  can_view_presence boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_target_user_id uuid;
BEGIN
  IF v_viewer_id IS NULL OR p_match_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    CASE
      WHEN m.profile_id_1 = v_viewer_id THEN m.profile_id_2
      WHEN m.profile_id_2 = v_viewer_id THEN m.profile_id_1
      ELSE NULL
    END
  INTO v_target_user_id
  FROM public.matches m
  WHERE m.id = p_match_id
    AND (m.profile_id_1 = v_viewer_id OR m.profile_id_2 = v_viewer_id)
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.get_profile_presence_for_viewer(v_target_user_id, NULL::uuid);
END;
$$;

COMMENT ON FUNCTION public.get_chat_partner_presence(uuid) IS
  'Chat-specific masked presence wrapper. Resolves the match partner server-side and fails closed when the caller is not part of the match.';

CREATE OR REPLACE FUNCTION public.detect_ghost_bootstrap_accounts(
  days_old_threshold int DEFAULT 7,
  min_activity_threshold int DEFAULT 0
)
RETURNS TABLE (
  profile_id uuid,
  created_at timestamp with time zone,
  days_since_creation int,
  email_masked text,
  phone_masked text,
  onboarding_complete boolean,
  profile_activity_score int,
  total_messages int,
  total_matches int,
  total_video_sessions int,
  total_event_regs int,
  last_seen_at timestamp with time zone,
  account_age_hours numeric,
  is_bootstrap_fresh boolean,
  identity_collision_hints text[],
  review_confidence text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH profile_completeness AS (
    SELECT
      p.id,
      p.created_at,
      EXTRACT(DAY FROM now() - p.created_at)::int as days_since_creation,
      EXTRACT(HOUR FROM now() - p.created_at)::numeric as account_age_hours,
      au.email,
      au.phone,
      p.onboarding_complete,
      p.birth_date,
      p.gender,
      p.photos,
      p.interested_in,
      p.relationship_intent,
      p.location,
      p.community_agreed_at,
      p.about_me,
      p.last_seen_at,
      (
        p.onboarding_complete = false
        AND p.birth_date IS NULL
        AND (p.gender IS NULL OR p.gender = 'prefer_not_to_say')
        AND COALESCE(array_length(p.photos, 1), 0) = 0
        AND COALESCE(array_length(p.interested_in, 1), 0) = 0
        AND NULLIF(trim(COALESCE(p.relationship_intent, '')), '') IS NULL
        AND NULLIF(trim(COALESCE(p.location, '')), '') IS NULL
        AND p.community_agreed_at IS NULL
        AND NULLIF(trim(COALESCE(p.about_me, '')), '') IS NULL
      ) AS is_bootstrap_fresh
    FROM public.profiles p
    INNER JOIN auth.users au ON p.id = au.id
    WHERE au.deleted_at IS NULL
  ),
  activity_counts AS (
    SELECT
      pc.id as profile_id,
      pc.created_at,
      pc.days_since_creation,
      pc.account_age_hours,
      pc.email,
      pc.phone,
      pc.onboarding_complete,
      pc.last_seen_at,
      pc.is_bootstrap_fresh,
      COALESCE(msg_count.cnt, 0)::int as total_messages,
      COALESCE(match_count.cnt, 0)::int as total_matches,
      COALESCE(video_count.cnt, 0)::int as total_video_sessions,
      COALESCE(event_count.cnt, 0)::int as total_event_regs,
      COALESCE(msg_count.cnt, 0)
        + COALESCE(match_count.cnt, 0) * 2
        + COALESCE(video_count.cnt, 0) * 3
        + COALESCE(event_count.cnt, 0) * 2 as profile_activity_score
    FROM profile_completeness pc
    LEFT JOIN (
      SELECT sender_id, COUNT(*) as cnt
      FROM public.messages
      WHERE created_at > now() - interval '30 days'
      GROUP BY sender_id
    ) msg_count ON pc.id = msg_count.sender_id
    LEFT JOIN (
      SELECT participant_id as profile_id, COUNT(*) as cnt
      FROM (
        SELECT profile_id_1 as participant_id
        FROM public.matches
        WHERE matched_at > now() - interval '30 days'
        UNION ALL
        SELECT profile_id_2 as participant_id
        FROM public.matches
        WHERE matched_at > now() - interval '30 days'
      ) match_participants
      GROUP BY participant_id
    ) match_count ON pc.id = match_count.profile_id
    LEFT JOIN (
      SELECT participant_id, COUNT(*) as cnt
      FROM (
        SELECT participant_1_id as participant_id
        FROM public.video_sessions
        WHERE started_at > now() - interval '30 days'
        UNION ALL
        SELECT participant_2_id as participant_id
        FROM public.video_sessions
        WHERE started_at > now() - interval '30 days'
      ) video_participants
      GROUP BY participant_id
    ) video_count ON pc.id = video_count.participant_id
    LEFT JOIN (
      SELECT er.profile_id, COUNT(*) as cnt
      FROM public.event_registrations er
      WHERE er.registered_at > now() - interval '30 days'
      GROUP BY er.profile_id
    ) event_count ON pc.id = event_count.profile_id
  ),
  identity_collision_detection AS (
    SELECT
      ac.profile_id,
      ARRAY_AGG(DISTINCT
        CASE
          WHEN collision_type IS NOT NULL
          THEN collision_type || ' (' || collision_count::text || ')'
          ELSE NULL
        END
        ORDER BY
          CASE
            WHEN collision_type IS NOT NULL
            THEN collision_type || ' (' || collision_count::text || ')'
            ELSE NULL
          END
      ) FILTER (WHERE collision_type IS NOT NULL) as collision_hints
    FROM activity_counts ac
    LEFT JOIN LATERAL (
      SELECT 'email_collision' as collision_type, COUNT(*) as collision_count
      FROM public.profiles p2
      INNER JOIN auth.users au2 ON p2.id = au2.id
      WHERE au2.email = ac.email
        AND au2.email IS NOT NULL
        AND NULLIF(trim(au2.email), '') IS NOT NULL
        AND p2.id <> ac.profile_id
      UNION ALL
      SELECT 'phone_collision' as collision_type, COUNT(*) as collision_count
      FROM public.profiles p2
      INNER JOIN auth.users au2 ON p2.id = au2.id
      WHERE au2.phone = ac.phone
        AND au2.phone IS NOT NULL
        AND NULLIF(trim(au2.phone), '') IS NOT NULL
        AND p2.id <> ac.profile_id
    ) collisions ON true
    GROUP BY ac.profile_id
  )
  SELECT
    ac.profile_id,
    ac.created_at,
    ac.days_since_creation,
    CASE
      WHEN ac.email IS NOT NULL AND char_length(ac.email) > 3
      THEN left(split_part(ac.email, '@', 1), 1) || '***@' || split_part(ac.email, '@', 2)
      ELSE 'unknown'
    END as email_masked,
    CASE
      WHEN ac.phone IS NOT NULL AND char_length(COALESCE(ac.phone, '')) > 4
      THEN left(ac.phone, LEAST(4, GREATEST(char_length(ac.phone) - 2, 2))) || ' **** ' || right(ac.phone, 2)
      ELSE 'unknown'
    END as phone_masked,
    ac.onboarding_complete,
    ac.profile_activity_score,
    ac.total_messages,
    ac.total_matches,
    ac.total_video_sessions,
    ac.total_event_regs,
    ac.last_seen_at,
    ac.account_age_hours,
    ac.is_bootstrap_fresh,
    COALESCE(icd.collision_hints, ARRAY[]::text[]) as identity_collision_hints,
    CASE
      WHEN ac.is_bootstrap_fresh
        AND ac.days_since_creation >= days_old_threshold
        AND ac.profile_activity_score <= min_activity_threshold
        AND ac.last_seen_at IS NULL
      THEN 'HIGH'
      WHEN ac.is_bootstrap_fresh
        AND ac.days_since_creation >= (days_old_threshold - 2)
        AND ac.profile_activity_score <= min_activity_threshold
      THEN 'MEDIUM'
      WHEN ac.is_bootstrap_fresh
        AND ac.profile_activity_score = 0
      THEN 'LOW'
      ELSE 'NONE'
    END as review_confidence
  FROM activity_counts ac
  LEFT JOIN identity_collision_detection icd ON ac.profile_id = icd.profile_id
  WHERE ac.is_bootstrap_fresh
    AND ac.days_since_creation >= (days_old_threshold - 3)
    AND ac.profile_activity_score <= min_activity_threshold
  ORDER BY
    ac.profile_activity_score ASC,
    ac.days_since_creation DESC,
    ac.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) IS
  'Admin-guarded diagnostic RPC for likely ghost/abandoned bootstrap-fresh profiles. Non-admin callers receive insufficient_privilege before any raw activity data is read.';

REVOKE ALL ON FUNCTION public.get_my_privacy_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_privacy_settings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_my_activity_seen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_profile_presence(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_presence_for_viewer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chat_partner_presence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_privacy_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_privacy_settings(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_my_activity_seen() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_profile_presence(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_presence_for_viewer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_partner_presence(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) TO authenticated, service_role;
