-- Make ghost bootstrap diagnostics align with production last_seen_at semantics.
-- profiles.last_seen_at defaults to now(), so a signup-time heartbeat should
-- still count as "not meaningfully seen" for HIGH confidence candidates.

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
DECLARE
  v_days_old_threshold int := GREATEST(COALESCE(days_old_threshold, 7), 1);
  v_min_activity_threshold int := GREATEST(COALESCE(min_activity_threshold, 0), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH profile_completeness AS (
    SELECT
      p.id,
      p.created_at,
      FLOOR(EXTRACT(EPOCH FROM now() - p.created_at) / 86400)::int as days_since_creation,
      ROUND((EXTRACT(EPOCH FROM now() - p.created_at) / 3600)::numeric, 2) as account_age_hours,
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
      (
        COALESCE(msg_count.cnt, 0)
        + COALESCE(match_count.cnt, 0) * 2
        + COALESCE(video_count.cnt, 0) * 3
        + COALESCE(event_count.cnt, 0) * 2
      )::int as profile_activity_score
    FROM profile_completeness pc
    LEFT JOIN (
      SELECT msg.sender_id, COUNT(*) as cnt
      FROM public.messages msg
      WHERE msg.created_at > now() - interval '30 days'
      GROUP BY msg.sender_id
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
      WHEN ac.profile_activity_score = 0
        AND (ac.last_seen_at IS NULL OR ac.last_seen_at <= ac.created_at + interval '5 minutes')
      THEN 'HIGH'
      WHEN ac.profile_activity_score = 0
        AND ac.last_seen_at <= ac.created_at + interval '1 day'
      THEN 'MEDIUM'
      ELSE 'LOW'
    END as review_confidence
  FROM activity_counts ac
  LEFT JOIN identity_collision_detection icd ON ac.profile_id = icd.profile_id
  WHERE ac.is_bootstrap_fresh
    AND ac.days_since_creation >= v_days_old_threshold
    AND ac.profile_activity_score <= v_min_activity_threshold
  ORDER BY
    ac.profile_activity_score ASC,
    CASE
      WHEN ac.profile_activity_score = 0
        AND (ac.last_seen_at IS NULL OR ac.last_seen_at <= ac.created_at + interval '5 minutes')
      THEN 1
      WHEN ac.profile_activity_score = 0
        AND ac.last_seen_at <= ac.created_at + interval '1 day'
      THEN 2
      ELSE 3
    END ASC,
    ac.days_since_creation DESC,
    ac.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) IS
  'Admin-guarded diagnostic RPC for likely ghost/abandoned bootstrap-fresh profiles. Uses strict age filtering and treats signup-time last_seen_at defaults as HIGH confidence when activity is zero.';

REVOKE ALL ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_ghost_bootstrap_accounts(int, int) TO authenticated, service_role;
