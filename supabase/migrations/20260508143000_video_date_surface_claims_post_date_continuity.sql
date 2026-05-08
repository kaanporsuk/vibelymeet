-- Video Date active-surface ownership + server-owned post-date routing.
--
-- This migration tightens the remaining "one user, one active video-date
-- surface" gap without weakening the existing video_sessions trigger. The DB
-- already rejects overlapping active sessions; this adds a short-lived
-- participant-owned surface claim so duplicate tabs/devices cannot both own
-- the same live date UI, and exposes a backend decision for post-date routing.

CREATE TABLE IF NOT EXISTS public.video_date_surface_claims (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('ready_gate', 'video_date', 'post_date_survey')),
  client_instance_id text NOT NULL CHECK (length(client_instance_id) BETWEEN 8 AND 120),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_date_surface_claims_session_live
  ON public.video_date_surface_claims(session_id, expires_at)
  WHERE released_at IS NULL;

ALTER TABLE public.video_date_surface_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_surface_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.video_date_surface_claims TO authenticated;

DROP POLICY IF EXISTS "Users can read own video date surface claim" ON public.video_date_surface_claims;
CREATE POLICY "Users can read own video date surface claim"
ON public.video_date_surface_claims
FOR SELECT
TO authenticated
USING (profile_id = auth.uid());

COMMENT ON TABLE public.video_date_surface_claims IS
  'Short-lived server-owned ownership claim for the currently active Video Date surface. Prevents duplicate tabs/devices from concurrently owning the same user-facing video-date UI.';

CREATE OR REPLACE FUNCTION public.video_date_session_is_active_surface(
  p_ended_at timestamptz,
  p_state text,
  p_phase text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_ended_at IS NULL
    AND COALESCE(p_state, '') <> 'ended'
    AND COALESCE(p_phase, '') <> 'ended';
$function$;

CREATE OR REPLACE FUNCTION public.claim_video_date_surface(
  p_session_id uuid,
  p_surface text,
  p_client_instance_id text,
  p_takeover boolean DEFAULT false,
  p_ttl_seconds integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_surface text := lower(btrim(COALESCE(p_surface, '')));
  v_client_instance_id text := left(btrim(COALESCE(p_client_instance_id, '')), 120);
  v_ttl_seconds integer := GREATEST(5, LEAST(COALESCE(p_ttl_seconds, 12), 60));
  v_existing public.video_date_surface_claims%ROWTYPE;
  v_surface_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  IF v_surface NOT IN ('ready_gate', 'video_date', 'post_date_survey') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SURFACE', 'error', 'invalid_surface');
  END IF;

  IF length(v_client_instance_id) < 8 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_CLIENT_INSTANCE', 'error', 'invalid_client_instance');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  v_surface_allowed := CASE v_surface
    WHEN 'ready_gate' THEN
      public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
      AND v_session.state = 'ready_gate'::public.video_date_state
    WHEN 'video_date' THEN
      public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
      AND (
        v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR v_session.handshake_started_at IS NOT NULL
        OR v_session.date_started_at IS NOT NULL
      )
    WHEN 'post_date_survey' THEN
      public.video_date_session_is_post_date_survey_eligible(
        v_session.ended_at,
        v_session.ended_reason,
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at
      )
    ELSE false
  END;

  IF NOT v_surface_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SURFACE_NOT_CLAIMABLE',
      'error', 'surface_not_claimable',
      'state', v_session.state,
      'phase', v_session.phase,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  UPDATE public.video_date_surface_claims
  SET released_at = COALESCE(released_at, v_now), updated_at = v_now
  WHERE profile_id = v_uid
    AND released_at IS NULL
    AND expires_at <= v_now;

  SELECT * INTO v_existing
  FROM public.video_date_surface_claims
  WHERE profile_id = v_uid
  FOR UPDATE;

  IF v_existing.profile_id IS NOT NULL
     AND v_existing.released_at IS NULL
     AND v_existing.expires_at > v_now
     AND (
       v_existing.session_id IS DISTINCT FROM p_session_id
       OR v_existing.client_instance_id IS DISTINCT FROM v_client_instance_id
     )
     AND NOT p_takeover THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SURFACE_CLAIM_CONFLICT',
      'error', 'surface_claim_conflict',
      'conflict_session_id', v_existing.session_id,
      'conflict_surface', v_existing.surface,
      'expires_at', v_existing.expires_at
    );
  END IF;

  INSERT INTO public.video_date_surface_claims (
    profile_id,
    session_id,
    surface,
    client_instance_id,
    claimed_at,
    expires_at,
    released_at,
    updated_at
  )
  VALUES (
    v_uid,
    p_session_id,
    v_surface,
    v_client_instance_id,
    v_now,
    v_now + make_interval(secs => v_ttl_seconds),
    NULL,
    v_now
  )
  ON CONFLICT (profile_id)
  DO UPDATE SET
    session_id = EXCLUDED.session_id,
    surface = EXCLUDED.surface,
    client_instance_id = EXCLUDED.client_instance_id,
    claimed_at = EXCLUDED.claimed_at,
    expires_at = EXCLUDED.expires_at,
    released_at = NULL,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'surface', v_surface,
    'expires_at', v_now + make_interval(secs => v_ttl_seconds),
    'takeover', p_takeover
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Participant-only short-lived claim for Ready Gate, live date, or post-date survey ownership. Rejects concurrent duplicate tabs/devices unless explicit takeover is requested.';

CREATE OR REPLACE FUNCTION public.release_video_date_surface_claim(
  p_session_id uuid,
  p_client_instance_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_client_instance_id text := left(btrim(COALESCE(p_client_instance_id, '')), 120);
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  UPDATE public.video_date_surface_claims
  SET released_at = COALESCE(released_at, v_now), updated_at = v_now
  WHERE profile_id = v_uid
    AND session_id = p_session_id
    AND client_instance_id = v_client_instance_id
    AND released_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'released', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.release_video_date_surface_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_video_date_surface_claim(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_video_date_surface_claim(uuid, text) IS
  'Participant-only release for a short-lived Video Date surface claim. No-op success if the claim has already expired or moved.';

CREATE OR REPLACE FUNCTION public.update_post_date_feedback_details(
  p_session_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.date_feedback
    WHERE session_id = p_session_id
      AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'VERDICT_REQUIRED', 'error', 'verdict_required');
  END IF;

  UPDATE public.date_feedback
  SET
    tag_chemistry = CASE
      WHEN jsonb_typeof(v_patch->'tag_chemistry') = 'boolean' THEN (v_patch->>'tag_chemistry')::boolean
      WHEN v_patch ? 'tag_chemistry' THEN NULL
      ELSE tag_chemistry
    END,
    tag_fun = CASE
      WHEN jsonb_typeof(v_patch->'tag_fun') = 'boolean' THEN (v_patch->>'tag_fun')::boolean
      WHEN v_patch ? 'tag_fun' THEN NULL
      ELSE tag_fun
    END,
    tag_smart = CASE
      WHEN jsonb_typeof(v_patch->'tag_smart') = 'boolean' THEN (v_patch->>'tag_smart')::boolean
      WHEN v_patch ? 'tag_smart' THEN NULL
      ELSE tag_smart
    END,
    tag_respectful = CASE
      WHEN jsonb_typeof(v_patch->'tag_respectful') = 'boolean' THEN (v_patch->>'tag_respectful')::boolean
      WHEN v_patch ? 'tag_respectful' THEN NULL
      ELSE tag_respectful
    END,
    energy = CASE
      WHEN v_patch ? 'energy' AND v_patch->>'energy' IN ('calm', 'energetic', 'intense') THEN v_patch->>'energy'
      WHEN v_patch ? 'energy' THEN NULL
      ELSE energy
    END,
    conversation_flow = CASE
      WHEN v_patch ? 'conversation_flow' AND v_patch->>'conversation_flow' IN ('natural', 'effort', 'one_sided') THEN v_patch->>'conversation_flow'
      WHEN v_patch ? 'conversation_flow' THEN NULL
      ELSE conversation_flow
    END,
    photo_accurate = CASE
      WHEN v_patch ? 'photo_accurate' AND v_patch->>'photo_accurate' IN ('yes', 'not_sure', 'no') THEN v_patch->>'photo_accurate'
      WHEN v_patch ? 'photo_accurate' THEN NULL
      ELSE photo_accurate
    END,
    honest_representation = CASE
      WHEN v_patch ? 'honest_representation' AND v_patch->>'honest_representation' IN ('yes', 'not_sure', 'no') THEN v_patch->>'honest_representation'
      WHEN v_patch ? 'honest_representation' THEN NULL
      ELSE honest_representation
    END
  WHERE session_id = p_session_id
    AND user_id = v_uid;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', v_count = 1, 'updated', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_post_date_feedback_details(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_post_date_feedback_details(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.update_post_date_feedback_details(uuid, jsonb) IS
  'Participant-only patch RPC for optional post-date feedback fields. Keeps date_feedback writes behind backend participant checks after the verdict row exists.';

CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_next public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_target_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match_id uuid;
  v_event_active boolean := false;
  v_event_reason text := 'unknown';
  v_event_ends_at timestamptz;
  v_seconds_until_event_end integer;
  v_has_feedback boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  v_target_id := CASE
    WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback
    WHERE session_id = p_session_id
      AND user_id = v_uid
  ) INTO v_has_feedback;

  IF public.video_date_session_is_post_date_survey_eligible(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at
    )
    AND NOT v_has_feedback THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'reason', 'survey_required'
    );
  END IF;

  IF v_session.event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'home',
      'route', 'home',
      'session_id', p_session_id,
      'target_id', v_target_id,
      'reason', 'no_event_context'
    );
  END IF;

  v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
  v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

  SELECT id INTO v_match_id
  FROM public.matches
  WHERE profile_id_1 = v_p1
    AND profile_id_2 = v_p2
  LIMIT 1;

  SELECT state.is_active, state.reason
  INTO v_event_active, v_event_reason
  FROM public.get_event_lobby_active_state(v_session.event_id, v_now) AS state
  LIMIT 1;

  SELECT e.event_date + (COALESCE(e.duration_minutes, 60) * interval '1 minute')
  INTO v_event_ends_at
  FROM public.events e
  WHERE e.id = v_session.event_id;

  IF v_event_ends_at IS NOT NULL THEN
    v_seconds_until_event_end := floor(EXTRACT(EPOCH FROM (v_event_ends_at - v_now)))::integer;
  END IF;

  SELECT * INTO v_next
  FROM public.video_sessions vs
  WHERE vs.id <> p_session_id
    AND (vs.participant_1_id = v_uid OR vs.participant_2_id = v_uid)
    AND public.video_date_session_is_active_surface(vs.ended_at, vs.state::text, vs.phase)
  ORDER BY
    CASE
      WHEN vs.state = 'date'::public.video_date_state THEN 1
      WHEN vs.state = 'handshake'::public.video_date_state THEN 2
      WHEN vs.state = 'ready_gate'::public.video_date_state THEN 3
      ELSE 4
    END,
    COALESCE(vs.date_started_at, vs.handshake_started_at, vs.ready_participant_1_at, vs.ready_participant_2_at, vs.created_at) DESC
  LIMIT 1;

  IF v_next.id IS NOT NULL THEN
    IF v_next.state = 'ready_gate'::public.video_date_state THEN
      RETURN jsonb_build_object(
        'success', true,
        'action', 'ready_gate',
        'route', 'event_lobby_pending_ready_gate',
        'session_id', p_session_id,
        'next_session_id', v_next.id,
        'event_id', v_next.event_id,
        'reason', 'active_ready_gate'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'video_date',
      'route', 'date',
      'session_id', p_session_id,
      'next_session_id', v_next.id,
      'event_id', v_next.event_id,
      'reason', 'active_video_date'
    );
  END IF;

  IF COALESCE(v_event_active, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'lobby',
      'route', 'event_lobby',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'seconds_until_event_end', v_seconds_until_event_end,
      'reason', CASE
        WHEN v_seconds_until_event_end IS NOT NULL AND v_seconds_until_event_end <= 300 THEN 'last_chance'
        ELSE 'event_active'
      END
    );
  END IF;

  IF v_match_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'chat',
      'route', 'chat',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'event_active', false,
      'reason', 'event_closed_mutual_match'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'wrap_up',
    'route', 'event_wrap_up',
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'event_active', false,
    'event_reason', v_event_reason,
    'reason', 'event_not_active'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_post_date_next_surface(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_post_date_next_surface(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_post_date_next_surface(uuid) IS
  'Participant-only authoritative post-date router. Returns survey, ready_gate, video_date, lobby, chat, or wrap_up based on backend session/event/match truth.';

CREATE OR REPLACE FUNCTION public.audit_active_video_date_surface_conflicts()
RETURNS TABLE (
  profile_id uuid,
  active_session_count integer,
  session_ids uuid[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH active_participants AS (
    SELECT participant_1_id AS profile_id, id AS session_id
    FROM public.video_sessions
    WHERE participant_1_id IS NOT NULL
      AND public.video_date_session_is_active_surface(ended_at, state::text, phase)
    UNION ALL
    SELECT participant_2_id AS profile_id, id AS session_id
    FROM public.video_sessions
    WHERE participant_2_id IS NOT NULL
      AND public.video_date_session_is_active_surface(ended_at, state::text, phase)
  )
  SELECT
    ap.profile_id,
    count(DISTINCT ap.session_id)::integer AS active_session_count,
    array_agg(DISTINCT ap.session_id ORDER BY ap.session_id) AS session_ids
  FROM active_participants ap
  GROUP BY ap.profile_id
  HAVING count(DISTINCT ap.session_id) > 1;
$function$;

REVOKE ALL ON FUNCTION public.audit_active_video_date_surface_conflicts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_active_video_date_surface_conflicts() TO service_role;

COMMENT ON FUNCTION public.audit_active_video_date_surface_conflicts() IS
  'Service-role audit assertion for operator checks: any returned row violates one user / one active Video Date session surface.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508143000',
  'Video Date surface claims and server-owned post-date continuity',
  'schema+policy',
  'Adds a short-lived Video Date surface-claim table, participant-checked RPCs for surface ownership and post-date feedback details, an authoritative post-date routing RPC, and a service-role-only active-session audit. Additive; does not remove existing policies or data.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
