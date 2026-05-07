-- Admin Users lifecycle read models.
--
-- Migration class: schema-only RPC correction.
-- Intent: keep /kaan Users as a complete account ledger while making
-- bootstrap-fresh and incomplete onboarding state explicit in backend-owned
-- read models. No cleanup or destructive account action is performed.

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_search text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'created_at_desc',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_filters jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
  v_gender_bucket text;
  v_lifecycle_filter text;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_filters := CASE
    WHEN p_filters IS NULL OR p_filters = 'null'::jsonb THEN '{}'::jsonb
    ELSE p_filters
  END;

  IF jsonb_typeof(v_filters) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User filters must be a JSON object.');
  END IF;

  IF v_filters ? 'photo_verified'
     AND v_filters -> 'photo_verified' <> 'null'::jsonb
     AND lower(v_filters ->> 'photo_verified') NOT IN ('true', 'false') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'photo_verified filter must be boolean.');
  END IF;

  IF v_filters ? 'is_suspended'
     AND v_filters -> 'is_suspended' <> 'null'::jsonb
     AND lower(v_filters ->> 'is_suspended') NOT IN ('true', 'false') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'is_suspended filter must be boolean.');
  END IF;

  IF v_filters ? 'relationship_intents'
     AND v_filters -> 'relationship_intents' <> 'null'::jsonb
     AND jsonb_typeof(v_filters -> 'relationship_intents') <> 'array' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'relationship_intents filter must be an array.');
  END IF;

  v_gender_bucket := NULLIF(btrim(COALESCE(v_filters ->> 'gender_bucket', '')), '');
  v_lifecycle_filter := lower(NULLIF(btrim(COALESCE(v_filters ->> 'lifecycle_status', v_filters ->> 'lifecycle', 'all')), ''));
  v_lifecycle_filter := COALESCE(v_lifecycle_filter, 'all');

  IF v_lifecycle_filter NOT IN ('all', 'complete', 'incomplete', 'bootstrap_fresh', 'suspended') THEN
    RETURN public.admin_json_error(
      'VALIDATION_ERROR',
      'Unsupported lifecycle filter.',
      jsonb_build_object('lifecycle_status', v_lifecycle_filter)
    );
  END IF;

  WITH base AS (
    SELECT
      p.id,
      p.name,
      p.age,
      p.gender,
      p.birth_date,
      p.location,
      p.height_cm,
      p.looking_for,
      p.relationship_intent,
      p.avatar_url,
      p.photos,
      p.email_verified,
      p.photo_verified,
      p.is_premium,
      p.is_suspended,
      p.created_at,
      p.updated_at,
      p.total_matches,
      p.onboarding_complete,
      p.onboarding_stage,
      p.last_seen_at,
      COALESCE(reg.registration_count, 0) AS event_registrations,
      COALESCE(reg.attended_count, 0) AS confirmed_attendance,
      COALESCE(vibes.vibes, '[]'::jsonb) AS vibes,
      COALESCE(activity.has_activity, false) AS has_activity,
      (
        COALESCE(p.onboarding_complete, false) IS FALSE
        AND p.birth_date IS NULL
        AND p.age = 18
        AND (
          NULLIF(btrim(COALESCE(p.gender, '')), '') IS NULL
          OR lower(COALESCE(p.gender, '')) IN ('prefer_not_to_say', 'other')
        )
        AND cardinality(COALESCE(p.photos, ARRAY[]::text[])) = 0
        AND cardinality(COALESCE(p.interested_in, ARRAY[]::text[])) = 0
        AND NULLIF(btrim(COALESCE(p.location, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.relationship_intent, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.looking_for, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.about_me, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.avatar_url, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.tagline, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.job, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.company, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.vibe_caption, '')), '') IS NULL
        AND COALESCE(vibes.vibe_count, 0) = 0
        AND (p.lifestyle IS NULL OR p.lifestyle = '{}'::jsonb OR p.lifestyle = 'null'::jsonb)
        AND (p.prompts IS NULL OR p.prompts = '[]'::jsonb OR p.prompts = 'null'::jsonb)
        AND p.community_agreed_at IS NULL
      ) AS is_bootstrap_fresh,
      (
        COALESCE(p.onboarding_complete, false) IS FALSE
        AND p.birth_date IS NULL
        AND p.age = 18
      ) AS age_is_placeholder
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS registration_count,
        count(*) FILTER (WHERE er.attended IS TRUE)::integer AS attended_count
      FROM public.event_registrations er
      WHERE er.profile_id = p.id
    ) reg ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS vibe_count,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('label', vt.label, 'emoji', vt.emoji, 'category', vt.category)
            ORDER BY vt.category ASC NULLS LAST, vt.label ASC
          ),
          '[]'::jsonb
        ) AS vibes
      FROM public.profile_vibes pv
      JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
      WHERE pv.profile_id = p.id
    ) vibes ON true
    LEFT JOIN LATERAL (
      SELECT (
        EXISTS (SELECT 1 FROM public.event_registrations er WHERE er.profile_id = p.id)
        OR EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE m.profile_id_1 = p.id OR m.profile_id_2 = p.id
        )
        OR EXISTS (SELECT 1 FROM public.messages msg WHERE msg.sender_id = p.id)
        OR EXISTS (
          SELECT 1
          FROM public.video_sessions vs
          WHERE vs.participant_1_id = p.id OR vs.participant_2_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.daily_drops dd
          WHERE dd.user_a_id = p.id OR dd.user_b_id = p.id
        )
      ) AS has_activity
    ) activity ON true
  ),
  annotated AS (
    SELECT
      base.*,
      CASE
        WHEN COALESCE(base.is_suspended, false) THEN 'suspended'
        WHEN COALESCE(base.onboarding_complete, false) THEN 'complete'
        WHEN base.is_bootstrap_fresh THEN 'bootstrap_fresh'
        WHEN base.has_activity THEN 'incomplete_active'
        ELSE 'incomplete'
      END AS lifecycle_status
    FROM base
  ),
  filtered AS (
    SELECT *
    FROM annotated a
    WHERE (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR a.name ILIKE '%' || p_search || '%'
        OR a.location ILIKE '%' || p_search || '%'
      )
      AND (
        v_filters ->> 'photo_verified' IS NULL
        OR a.photo_verified IS NOT DISTINCT FROM (v_filters ->> 'photo_verified')::boolean
      )
      AND (
        v_filters ->> 'is_suspended' IS NULL
        OR a.is_suspended IS NOT DISTINCT FROM (v_filters ->> 'is_suspended')::boolean
      )
      AND (
        v_filters ->> 'gender' IS NULL
        OR a.gender = v_filters ->> 'gender'
      )
      AND (
        v_gender_bucket IS NULL
        OR (
          v_gender_bucket = 'man'
          AND lower(COALESCE(a.gender, '')) IN ('man', 'male')
        )
        OR (
          v_gender_bucket = 'woman'
          AND lower(COALESCE(a.gender, '')) IN ('woman', 'female')
        )
        OR (
          v_gender_bucket = 'non-binary'
          AND lower(COALESCE(a.gender, '')) IN ('non-binary', 'non_binary')
        )
        OR (
          v_gender_bucket = 'other'
          AND (
            NULLIF(btrim(COALESCE(a.gender, '')), '') IS NULL
            OR lower(COALESCE(a.gender, '')) NOT IN ('man', 'male', 'woman', 'female', 'non-binary', 'non_binary')
          )
        )
      )
      AND (
        v_filters -> 'relationship_intents' IS NULL
        OR v_filters -> 'relationship_intents' = 'null'::jsonb
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(v_filters -> 'relationship_intents') intent(value)
          WHERE a.relationship_intent = intent.value
             OR a.looking_for = intent.value
        )
      )
      AND (
        v_lifecycle_filter = 'all'
        OR (v_lifecycle_filter = 'complete' AND a.lifecycle_status = 'complete')
        OR (v_lifecycle_filter = 'incomplete' AND a.lifecycle_status IN ('bootstrap_fresh', 'incomplete', 'incomplete_active'))
        OR (v_lifecycle_filter = 'bootstrap_fresh' AND a.lifecycle_status = 'bootstrap_fresh')
        OR (v_lifecycle_filter = 'suspended' AND a.lifecycle_status = 'suspended')
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total_count FROM filtered
  ),
  ranked AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'name_asc' THEN f.name END ASC NULLS LAST,
          CASE WHEN p_sort = 'name_desc' THEN f.name END DESC NULLS LAST,
          CASE WHEN p_sort = 'age_asc' THEN f.age END ASC NULLS LAST,
          CASE WHEN p_sort = 'age_desc' THEN f.age END DESC NULLS LAST,
          CASE WHEN p_sort = 'location_asc' THEN f.location END ASC NULLS LAST,
          CASE WHEN p_sort = 'location_desc' THEN f.location END DESC NULLS LAST,
          CASE WHEN p_sort = 'total_matches_asc' THEN f.total_matches END ASC NULLS LAST,
          CASE WHEN p_sort = 'total_matches_desc' THEN f.total_matches END DESC NULLS LAST,
          CASE WHEN p_sort = 'registrations_asc' THEN f.event_registrations END ASC,
          CASE WHEN p_sort = 'registrations_desc' THEN f.event_registrations END DESC,
          CASE WHEN p_sort = 'created_at_asc' THEN f.created_at END ASC,
          f.created_at DESC
      ) AS sort_index
    FROM filtered f
  ),
  page AS (
    SELECT *
    FROM ranked
    ORDER BY sort_index
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    COALESCE((SELECT total_count FROM counted), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', page.id,
          'name', page.name,
          'age', page.age,
          'gender', page.gender,
          'birth_date', page.birth_date,
          'location', page.location,
          'height_cm', page.height_cm,
          'looking_for', page.looking_for,
          'relationship_intent', page.relationship_intent,
          'avatar_url', page.avatar_url,
          'photos', page.photos,
          'email_verified', page.email_verified,
          'photo_verified', page.photo_verified,
          'is_premium', page.is_premium,
          'is_suspended', page.is_suspended,
          'created_at', page.created_at,
          'updated_at', page.updated_at,
          'total_matches', page.total_matches,
          'event_registrations', page.event_registrations,
          'confirmed_attendance', page.confirmed_attendance,
          'vibes', page.vibes,
          'onboarding_complete', page.onboarding_complete,
          'onboarding_stage', page.onboarding_stage,
          'last_seen_at', page.last_seen_at,
          'is_bootstrap_fresh', page.is_bootstrap_fresh,
          'has_activity', page.has_activity,
          'lifecycle_status', page.lifecycle_status,
          'age_is_placeholder', page.age_is_placeholder
        )
        ORDER BY page.sort_index
      ),
      '[]'::jsonb
    )
  INTO v_total, v_rows
  FROM page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'registration_semantics', 'event_registrations counts event_registrations rows; confirmed_attendance counts attended IS TRUE only.',
    'filter_semantics', 'gender_bucket and relationship_intents mirror /kaan Users panel filters server-side. lifecycle_status supports all, complete, incomplete, bootstrap_fresh, and suspended; all remains the default account ledger.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail_read_model(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_profile jsonb;
  v_vibes jsonb := '[]'::jsonb;
  v_matches jsonb := '[]'::jsonb;
  v_daily_drops jsonb := '[]'::jsonb;
  v_moderation jsonb := '{}'::jsonb;
  v_premium_history jsonb := '[]'::jsonb;
  v_credits jsonb := jsonb_build_object(
    'extra_time_credits', 0,
    'extended_vibe_credits', 0,
    'updated_at', NULL
  );
  v_event_registrations integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User id is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_event_registrations
  FROM public.event_registrations
  WHERE profile_id = p_user_id;

  WITH profile_lifecycle AS (
    SELECT
      p.id,
      p.name,
      p.age,
      p.gender,
      p.birth_date,
      p.interested_in,
      p.tagline,
      p.height_cm,
      p.location,
      p.job,
      p.company,
      p.about_me,
      p.looking_for,
      p.relationship_intent,
      p.lifestyle,
      p.prompts,
      p.photos,
      p.avatar_url,
      p.bunny_video_uid,
      p.bunny_video_status,
      p.vibe_caption,
      p.photo_verified,
      p.email_verified,
      p.verified_email,
      p.is_premium,
      p.premium_until,
      p.is_suspended,
      p.total_matches,
      p.total_conversations,
      p.created_at,
      p.updated_at,
      p.onboarding_complete,
      p.onboarding_stage,
      p.last_seen_at,
      COALESCE(activity.has_activity, false) AS has_activity,
      (
        COALESCE(p.onboarding_complete, false) IS FALSE
        AND p.birth_date IS NULL
        AND p.age = 18
        AND (
          NULLIF(btrim(COALESCE(p.gender, '')), '') IS NULL
          OR lower(COALESCE(p.gender, '')) IN ('prefer_not_to_say', 'other')
        )
        AND cardinality(COALESCE(p.photos, ARRAY[]::text[])) = 0
        AND cardinality(COALESCE(p.interested_in, ARRAY[]::text[])) = 0
        AND NULLIF(btrim(COALESCE(p.location, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.relationship_intent, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.looking_for, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.about_me, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.avatar_url, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.tagline, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.job, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.company, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(p.vibe_caption, '')), '') IS NULL
        AND COALESCE(vibes.vibe_count, 0) = 0
        AND (p.lifestyle IS NULL OR p.lifestyle = '{}'::jsonb OR p.lifestyle = 'null'::jsonb)
        AND (p.prompts IS NULL OR p.prompts = '[]'::jsonb OR p.prompts = 'null'::jsonb)
        AND p.community_agreed_at IS NULL
      ) AS is_bootstrap_fresh,
      (
        COALESCE(p.onboarding_complete, false) IS FALSE
        AND p.birth_date IS NULL
        AND p.age = 18
      ) AS age_is_placeholder
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS vibe_count
      FROM public.profile_vibes pv
      WHERE pv.profile_id = p.id
    ) vibes ON true
    LEFT JOIN LATERAL (
      SELECT (
        EXISTS (SELECT 1 FROM public.event_registrations er WHERE er.profile_id = p.id)
        OR EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE m.profile_id_1 = p.id OR m.profile_id_2 = p.id
        )
        OR EXISTS (SELECT 1 FROM public.messages msg WHERE msg.sender_id = p.id)
        OR EXISTS (
          SELECT 1
          FROM public.video_sessions vs
          WHERE vs.participant_1_id = p.id OR vs.participant_2_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.daily_drops dd
          WHERE dd.user_a_id = p.id OR dd.user_b_id = p.id
        )
      ) AS has_activity
    ) activity ON true
    WHERE p.id = p_user_id
  ),
  annotated AS (
    SELECT
      profile_lifecycle.*,
      CASE
        WHEN COALESCE(profile_lifecycle.is_suspended, false) THEN 'suspended'
        WHEN COALESCE(profile_lifecycle.onboarding_complete, false) THEN 'complete'
        WHEN profile_lifecycle.is_bootstrap_fresh THEN 'bootstrap_fresh'
        WHEN profile_lifecycle.has_activity THEN 'incomplete_active'
        ELSE 'incomplete'
      END AS lifecycle_status
    FROM profile_lifecycle
  )
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'age', p.age,
    'gender', p.gender,
    'birth_date', p.birth_date,
    'interested_in', p.interested_in,
    'tagline', p.tagline,
    'height_cm', p.height_cm,
    'location', p.location,
    'job', p.job,
    'company', p.company,
    'about_me', p.about_me,
    'looking_for', p.looking_for,
    'relationship_intent', p.relationship_intent,
    'lifestyle', p.lifestyle,
    'prompts', p.prompts,
    'photos', p.photos,
    'avatar_url', p.avatar_url,
    'bunny_video_uid', p.bunny_video_uid,
    'bunny_video_status', p.bunny_video_status,
    'vibe_caption', p.vibe_caption,
    'photo_verified', p.photo_verified,
    'email_verified', p.email_verified,
    'verified_email', p.verified_email,
    'is_premium', p.is_premium,
    'premium_until', p.premium_until,
    'is_suspended', p.is_suspended,
    'total_matches', p.total_matches,
    'total_conversations', p.total_conversations,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'event_registrations', v_event_registrations,
    'event_registrations_unavailable', false,
    'onboarding_complete', p.onboarding_complete,
    'onboarding_stage', p.onboarding_stage,
    'last_seen_at', p.last_seen_at,
    'is_bootstrap_fresh', p.is_bootstrap_fresh,
    'has_activity', p.has_activity,
    'lifecycle_status', p.lifecycle_status,
    'age_is_placeholder', p.age_is_placeholder
  )
  INTO v_profile
  FROM annotated p;

  IF v_profile IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'User profile was not found.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label', vt.label,
        'emoji', vt.emoji,
        'category', vt.category
      )
      ORDER BY vt.category ASC NULLS LAST, vt.label ASC
    ),
    '[]'::jsonb
  )
  INTO v_vibes
  FROM public.profile_vibes pv
  JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
  WHERE pv.profile_id = p_user_id;

  WITH user_matches AS (
    SELECT
      m.id,
      m.matched_at,
      m.profile_id_1,
      m.profile_id_2,
      CASE WHEN m.profile_id_1 = p_user_id THEN m.profile_id_2 ELSE m.profile_id_1 END AS other_user_id
    FROM public.matches m
    WHERE m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id
    ORDER BY m.matched_at DESC, m.id ASC
    LIMIT 20
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', um.id,
        'matched_at', um.matched_at,
        'profile_id_1', um.profile_id_1,
        'profile_id_2', um.profile_id_2,
        'other_profile', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos
        )
      )
      ORDER BY um.matched_at DESC, um.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM user_matches um
  LEFT JOIN public.profiles p ON p.id = um.other_user_id;

  WITH user_drops AS (
    SELECT
      dd.id,
      dd.user_a_id,
      dd.user_b_id,
      dd.status,
      dd.drop_date,
      dd.created_at,
      CASE WHEN dd.user_a_id = p_user_id THEN dd.user_b_id ELSE dd.user_a_id END AS partner_id
    FROM public.daily_drops dd
    WHERE dd.user_a_id = p_user_id OR dd.user_b_id = p_user_id
    ORDER BY dd.created_at DESC, dd.id ASC
    LIMIT 50
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ud.id,
        'user_a_id', ud.user_a_id,
        'user_b_id', ud.user_b_id,
        'status', ud.status,
        'drop_date', ud.drop_date,
        'created_at', ud.created_at,
        'partner_profile', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos
        )
      )
      ORDER BY ud.created_at DESC, ud.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_daily_drops
  FROM user_drops ud
  LEFT JOIN public.profiles p ON p.id = ud.partner_id;

  WITH current_suspension AS (
    SELECT jsonb_build_object(
      'id', us.id,
      'user_id', us.user_id,
      'suspended_by', us.suspended_by,
      'reason', us.reason,
      'suspended_at', us.suspended_at,
      'expires_at', us.expires_at,
      'lifted_at', us.lifted_at,
      'lifted_by', us.lifted_by,
      'status', us.status
    ) AS row_json
    FROM public.user_suspensions us
    WHERE us.user_id = p_user_id
      AND us.status = 'active'
    ORDER BY us.suspended_at DESC, us.id DESC
    LIMIT 1
  ),
  suspension_history AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', us.id,
          'user_id', us.user_id,
          'suspended_by', us.suspended_by,
          'reason', us.reason,
          'suspended_at', us.suspended_at,
          'expires_at', us.expires_at,
          'lifted_at', us.lifted_at,
          'lifted_by', us.lifted_by,
          'status', us.status
        )
        ORDER BY us.suspended_at DESC, us.id DESC
      ),
      '[]'::jsonb
    ) AS rows_json
    FROM public.user_suspensions us
    WHERE us.user_id = p_user_id
  ),
  warning_history AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', uw.id,
          'user_id', uw.user_id,
          'issued_by', uw.issued_by,
          'reason', uw.reason,
          'message', uw.message,
          'acknowledged_at', uw.acknowledged_at,
          'created_at', uw.created_at
        )
        ORDER BY uw.created_at DESC, uw.id DESC
      ),
      '[]'::jsonb
    ) AS rows_json
    FROM public.user_warnings uw
    WHERE uw.user_id = p_user_id
  )
  SELECT jsonb_build_object(
    'current_suspension', (SELECT row_json FROM current_suspension),
    'suspension_history', (SELECT rows_json FROM suspension_history),
    'warning_history', (SELECT rows_json FROM warning_history)
  )
  INTO v_moderation;

  WITH history AS (
    SELECT
      ph.id,
      ph.action,
      ph.premium_until,
      ph.reason,
      ph.created_at,
      ph.admin_id,
      admin_profile.name AS admin_name
    FROM public.premium_history ph
    LEFT JOIN public.profiles admin_profile ON admin_profile.id = ph.admin_id
    WHERE ph.user_id = p_user_id
    ORDER BY ph.created_at DESC, ph.id DESC
    LIMIT 10
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', history.id,
        'action', history.action,
        'premium_until', history.premium_until,
        'reason', history.reason,
        'created_at', history.created_at,
        'admin_id', history.admin_id,
        'adminName', COALESCE(history.admin_name, CASE WHEN history.admin_id IS NULL THEN 'System' ELSE 'Admin' END)
      )
      ORDER BY history.created_at DESC, history.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_premium_history
  FROM history;

  SELECT jsonb_build_object(
    'extra_time_credits', COALESCE(uc.extra_time_credits, 0),
    'extended_vibe_credits', COALESCE(uc.extended_vibe_credits, 0),
    'updated_at', uc.updated_at
  )
  INTO v_credits
  FROM public.user_credits uc
  WHERE uc.user_id = p_user_id;

  v_credits := COALESCE(
    v_credits,
    jsonb_build_object(
      'extra_time_credits', 0,
      'extended_vibe_credits', 0,
      'updated_at', NULL
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'profile', v_profile,
    'vibes', v_vibes,
    'matches', v_matches,
    'daily_drops', v_daily_drops,
    'moderation', v_moderation,
    'premium_history', v_premium_history,
    'credits', v_credits
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_search_users(text, jsonb, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_detail_read_model(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, jsonb, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail_read_model(uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507143000',
  'Admin Users lifecycle read models',
  'schema-only',
  'Redefines admin Users read-model RPCs with lifecycle fields and nested read-model data. No account cleanup or data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_search_users(text, jsonb, text, integer, integer) IS
  'Read-only /kaan Users table read model with explicit lifecycle fields and lifecycle_status filtering.';

COMMENT ON FUNCTION public.admin_get_user_detail_read_model(uuid) IS
  'Read-only /kaan user detail drawer read model with explicit profile, lifecycle, moderation, premium, and credits projections.';
