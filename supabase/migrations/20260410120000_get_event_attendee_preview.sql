-- Top-2 attendee preview for "Who's Going" (viewer-specific ranking; no full UUID fan-out).
-- Confirmed viewers: up to 2 revealed profiles + visible cohort count. Others: aggregate-only.

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
  v_total_other_confirmed integer;
  v_visible_count integer;
  v_revealed jsonb;
  v_obscured integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_viewer_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized',
      'code', 'UNAUTHORIZED'
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_total_other_confirmed
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.profile_id IS DISTINCT FROM p_viewer_id;

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
      'total_other_confirmed', v_total_other_confirmed,
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
      )
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
            'shared_vibe_count', t.shared_vibe_count,
            'super_vibe_toward_viewer', t.super_toward,
            'vibe_label', t.vibe_label
          )
          ORDER BY t.shared_vibe_count DESC, t.super_toward DESC, t.pid ASC
        )
        FROM top2 t
      ),
      '[]'::jsonb
    )
  INTO v_visible_count, v_revealed;

  v_obscured := GREATEST(
    0,
    v_visible_count - COALESCE(jsonb_array_length(v_revealed), 0)
  );

  RETURN jsonb_build_object(
    'success', true,
    'viewer_admission', v_admission,
    'total_other_confirmed', v_total_other_confirmed,
    'visible_cohort_count', v_visible_count,
    'obscured_remaining', v_obscured,
    'revealed', v_revealed
  );
END;
$function$;

COMMENT ON FUNCTION public.get_event_attendee_preview(uuid, uuid) IS
  'Privacy-safe attendee preview: confirmed viewers get top-2 ranked by shared vibes / super-vibe; others get aggregate counts only.';

GRANT EXECUTE ON FUNCTION public.get_event_attendee_preview(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_attendee_preview(uuid, uuid) TO service_role;
