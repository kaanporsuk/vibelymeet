-- Event attendance visibility enforcement contract.
--
-- event_attendance_visibility controls passive event-presence exposure:
-- attendee previews, attendee rosters, visible attendee counts, raw
-- registration enumeration, and profile attendance-count signals.
--
-- Live event deck/lobby matching is active participation. get_event_deck is
-- intentionally not filtered by event_attendance_visibility, so roster privacy
-- does not silently remove a confirmed participant from the live matching loop.

CREATE OR REPLACE FUNCTION public.profile_event_attendance_visible_to_viewer(
  p_target_id uuid,
  p_viewer_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p_target_id IS NOT NULL
    AND p_viewer_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = p_target_id
        AND (
          p_target_id = p_viewer_id
          OR public.has_role(p_viewer_id, 'admin'::public.app_role)
          OR COALESCE(p.event_attendance_visibility, 'attendees') = 'attendees'
          OR (
            COALESCE(p.event_attendance_visibility, 'attendees') = 'matches_only'
            AND EXISTS (
              SELECT 1
              FROM public.matches m
              WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_target_id)
                 OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_target_id)
            )
          )
        )
    );
$$;

COMMENT ON FUNCTION public.profile_event_attendance_visible_to_viewer(uuid, uuid) IS
  'Preference-only predicate for passive event attendance signals. attendees is visible; matches_only requires an existing match; hidden is never visible to other normal users. Safety/discovery checks remain the caller responsibility.';

COMMENT ON FUNCTION public.profiles_have_qualifying_shared_event(uuid, uuid, uuid) IS
  'Confirmed shared-event helper for discovery_audience=event_based. It intentionally does not reveal attendance and does not enforce event_attendance_visibility by itself; attendee/privacy surfaces must also call profile_event_attendance_visible_to_viewer or viewer_shares_event_with_profile.';

CREATE OR REPLACE FUNCTION public.viewer_shares_event_with_profile(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_other_profile_id IS DISTINCT FROM auth.uid()
    AND NOT public.profiles_have_safety_block(p_other_profile_id, auth.uid())
    AND public.is_profile_discoverable(p_other_profile_id, auth.uid())
    AND public.profiles_have_qualifying_shared_event(auth.uid(), p_other_profile_id)
    AND public.profile_event_attendance_visible_to_viewer(p_other_profile_id, auth.uid());
$$;

COMMENT ON FUNCTION public.viewer_shares_event_with_profile(uuid) IS
  'RLS helper for passive shared-event profile visibility. Requires confirmed shared event, discoverability, attendance visibility, and block/report safety; hidden never unlocks profile access, matches_only requires an existing match.';

CREATE OR REPLACE FUNCTION public.can_view_event_registration_profile(
  p_event_id uuid,
  p_profile_id uuid,
  p_viewer_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p_event_id IS NOT NULL
    AND p_profile_id IS NOT NULL
    AND p_viewer_id IS NOT NULL
    AND (
      p_profile_id = p_viewer_id
      OR public.has_role(p_viewer_id, 'admin'::public.app_role)
    );
$$;

COMMENT ON FUNCTION public.can_view_event_registration_profile(uuid, uuid, uuid) IS
  'RLS helper for event_registrations SELECT. event_registrations is not a public roster API: normal users may read only their own row; admin/service-role paths remain privileged.';

DROP POLICY IF EXISTS "Users can view registrations for shared events" ON public.event_registrations;
DROP POLICY IF EXISTS "Users can view own event registrations" ON public.event_registrations;
CREATE POLICY "Users can view own event registrations"
ON public.event_registrations
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND public.can_view_event_registration_profile(event_id, profile_id, auth.uid())
);

COMMENT ON POLICY "Users can view own event registrations" ON public.event_registrations IS
  'Normal authenticated clients can read their own registration status only. User-facing rosters/previews must use privacy-aware RPCs, not raw event_registrations enumeration.';

COMMENT ON TABLE public.event_registrations IS
  'Registration/admission ledger. Not a public attendee roster API; normal clients should use get_event_attendee_preview or get_event_visible_attendees for privacy-aware attendee discovery.';

COMMENT ON COLUMN public.profiles.events_attended IS
  'Sensitive aggregate attendance signal. User-facing profile reads should use get_profile_for_viewer, which masks this value according to event_attendance_visibility for non-self/non-admin viewers.';

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
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_viewer_id THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er0
    WHERE er0.event_id = p_event_id
      AND er0.profile_id = p_viewer_id
      AND er0.admission_status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT er.profile_id
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.profile_id <> p_viewer_id
    AND public.is_profile_discoverable(er.profile_id, p_viewer_id)
    AND public.profile_event_attendance_visible_to_viewer(er.profile_id, p_viewer_id);
END;
$$;

COMMENT ON FUNCTION public.get_event_visible_attendees(uuid, uuid) IS
  'Canonical privacy-aware full attendee roster contract. Only confirmed viewers get rows; results exclude the viewer and include only attendees visible to that viewer.';

CREATE OR REPLACE FUNCTION public.get_event_attendee_preview(
  p_event_id uuid,
  p_viewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_admission text;
  v_visible_count integer := 0;
  v_revealed jsonb := '[]'::jsonb;
  v_obscured integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_viewer_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized',
      'code', 'UNAUTHORIZED'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_viewer_id
      AND er.admission_status = 'confirmed'
  ) THEN
    v_admission := 'confirmed';
  ELSIF EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_viewer_id
      AND er.admission_status = 'waitlisted'
  ) THEN
    v_admission := 'waitlisted';
  ELSE
    v_admission := 'none';
  END IF;

  IF v_admission <> 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'viewer_admission', v_admission,
      'visible_other_count', 0,
      'total_other_confirmed', 0,
      'visible_cohort_count', 0,
      'obscured_remaining', 0,
      'revealed', '[]'::jsonb
    );
  END IF;

  WITH visible AS (
    SELECT
      er.profile_id AS pid,
      p.name,
      p.age,
      p.avatar_url,
      p.photos
    FROM public.event_registrations er
    JOIN public.profiles p ON p.id = er.profile_id
    WHERE er.event_id = p_event_id
      AND er.admission_status = 'confirmed'
      AND er.profile_id <> p_viewer_id
      AND public.is_profile_discoverable(er.profile_id, p_viewer_id)
      AND public.profile_event_attendance_visible_to_viewer(er.profile_id, p_viewer_id)
  ),
  scored AS (
    SELECT
      v.pid,
      v.name,
      v.age,
      CASE
        WHEN v.avatar_url IS NOT NULL AND btrim(v.avatar_url) <> '' THEN btrim(v.avatar_url)
        WHEN v.photos IS NOT NULL AND COALESCE(cardinality(v.photos), 0) >= 1 THEN v.photos[1]
        ELSE NULL::text
      END AS avatar_path,
      COALESCE((
        SELECT COUNT(*)::integer
        FROM public.profile_vibes pv1
        INNER JOIN public.profile_vibes pv2
          ON pv1.vibe_tag_id = pv2.vibe_tag_id
        WHERE pv1.profile_id = p_viewer_id
          AND pv2.profile_id = v.pid
      ), 0) AS shared_vibe_count,
      EXISTS (
        SELECT 1
        FROM public.event_swipes es
        WHERE es.event_id = p_event_id
          AND es.actor_id = v.pid
          AND es.target_id = p_viewer_id
          AND es.swipe_type = 'super_vibe'
      ) AS super_toward,
      (
        SELECT vt.label
        FROM public.profile_vibes pv
        INNER JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
        WHERE pv.profile_id = v.pid
        ORDER BY vt.label ASC
        LIMIT 1
      ) AS vibe_label
    FROM visible v
  ),
  top2 AS (
    SELECT *
    FROM scored
    ORDER BY shared_vibe_count DESC, super_toward DESC, pid ASC
    LIMIT 2
  )
  SELECT
    (SELECT COUNT(*)::integer FROM visible),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'profile_id', t.pid,
            'name', t.name,
            'age', t.age,
            'avatar_path', t.avatar_path,
            'avatar_url', t.avatar_path,
            'shared_vibe_count', t.shared_vibe_count,
            'super_vibe_toward_viewer', t.super_toward,
            'super_vibed_you', t.super_toward,
            'vibe_label', t.vibe_label
          )
          ORDER BY t.shared_vibe_count DESC, t.super_toward DESC, t.pid ASC
        )
        FROM top2 t
      ),
      '[]'::jsonb
    )
  INTO v_visible_count, v_revealed;

  v_obscured := GREATEST(v_visible_count - COALESCE(jsonb_array_length(v_revealed), 0), 0);

  RETURN jsonb_build_object(
    'success', true,
    'viewer_admission', v_admission,
    'visible_other_count', v_visible_count,
    'total_other_confirmed', v_visible_count,
    'visible_cohort_count', v_visible_count,
    'obscured_remaining', v_obscured,
    'revealed', v_revealed
  );
END;
$function$;

COMMENT ON FUNCTION public.get_event_attendee_preview(uuid, uuid) IS
  'Privacy-aware attendee preview. All user-facing count fields are visible-to-viewer counts; total_other_confirmed is a deprecated privacy-safe alias of visible_other_count.';

CREATE OR REPLACE FUNCTION public.get_profile_for_viewer(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_profile RECORD;
  v_vibes text[];
  v_allowed boolean;
  v_is_admin boolean;
  v_show_event_count boolean;
BEGIN
  IF v_viewer_id IS NULL OR p_target_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_admin := public.has_role(v_viewer_id, 'admin'::public.app_role);

  IF p_target_id IS DISTINCT FROM v_viewer_id
     AND NOT v_is_admin
     AND public.profiles_have_safety_block(p_target_id, v_viewer_id) THEN
    RETURN NULL;
  END IF;

  v_allowed :=
    public.profile_has_established_access(p_target_id, v_viewer_id)
    OR public.viewer_shares_event_with_profile(p_target_id);

  IF NOT v_allowed THEN
    RETURN NULL;
  END IF;

  SELECT
    p.id,
    p.name,
    p.age,
    p.gender,
    p.tagline,
    p.location,
    p.job,
    p.height_cm,
    p.about_me,
    p.looking_for,
    p.relationship_intent,
    p.photos,
    p.avatar_url,
    p.bunny_video_uid,
    p.bunny_video_status,
    p.vibe_caption,
    p.lifestyle,
    p.prompts,
    p.photo_verified,
    p.vibe_score,
    p.vibe_score_label,
    p.is_premium,
    p.events_attended,
    p.total_matches,
    p.total_conversations
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_show_event_count :=
    p_target_id = v_viewer_id
    OR v_is_admin
    OR public.profile_event_attendance_visible_to_viewer(p_target_id, v_viewer_id);

  SELECT COALESCE(array_agg(vt.label ORDER BY vt.label), ARRAY[]::text[])
  INTO v_vibes
  FROM public.profile_vibes pv
  JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
  WHERE pv.profile_id = p_target_id
    AND vt.label IS NOT NULL
    AND btrim(vt.label) <> '';

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'name', v_profile.name,
    'age', v_profile.age,
    'gender', v_profile.gender,
    'tagline', v_profile.tagline,
    'location', v_profile.location,
    'job', v_profile.job,
    'height_cm', v_profile.height_cm,
    'about_me', v_profile.about_me,
    'looking_for', v_profile.looking_for,
    'relationship_intent', v_profile.relationship_intent,
    'photos', v_profile.photos,
    'avatar_url', v_profile.avatar_url,
    'bunny_video_uid', v_profile.bunny_video_uid,
    'bunny_video_status', v_profile.bunny_video_status,
    'vibe_caption', v_profile.vibe_caption,
    'lifestyle', v_profile.lifestyle,
    'prompts', v_profile.prompts,
    'photo_verified', v_profile.photo_verified,
    'vibe_score', v_profile.vibe_score,
    'vibe_score_label', v_profile.vibe_score_label,
    'is_premium', v_profile.is_premium,
    'events_attended', CASE WHEN v_show_event_count THEN v_profile.events_attended ELSE NULL END,
    'total_matches', v_profile.total_matches,
    'total_conversations', v_profile.total_conversations,
    'vibes', COALESCE(to_jsonb(v_vibes), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Safe profile read for app surfaces. Allows self, admin, established relationships, and eligible shared-event discovery; masks events_attended for other viewers when event_attendance_visibility is hidden or unmatched matches_only.';

COMMENT ON FUNCTION public.get_event_deck(uuid, uuid, integer) IS
  'Live lobby deck for active event matching. Intentionally not filtered by event_attendance_visibility; attendee-list privacy does not disable live lobby participation.';

GRANT EXECUTE ON FUNCTION public.profile_event_attendance_visible_to_viewer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.viewer_shares_event_with_profile(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_event_registration_profile(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_visible_attendees(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_attendee_preview(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer) TO authenticated, service_role;
