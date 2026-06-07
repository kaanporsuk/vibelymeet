-- Video Session Created definitive contract closure.
--
-- This corrective migration keeps the current routeable both_ready baseline,
-- normalizes Mystery Match session payloads, and adds service-only drift
-- assertions/repair for registration <-> video_session convergence.

CREATE OR REPLACE FUNCTION public.video_date_protect_both_ready_entry_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid(),
  p_entry_attempt_id text DEFAULT NULL,
  p_source text DEFAULT 'video_date_protect_both_ready_entry_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_actor uuid := p_actor_id;
  v_attempt_id text := NULLIF(btrim(COALESCE(p_entry_attempt_id, '')), '');
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_protect_both_ready_entry_v1');
  v_inactive_reason text;
  v_previous_lease_expires_at timestamptz;
  v_lease_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_row_count integer := 0;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR COALESCE(v_session.phase, '') = 'ended' THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_ENDED',
      'error', 'Session has ended',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  IF v_actor IS NULL
     OR (
       v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'ACCESS_DENIED',
      'error', 'Access denied',
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  IF v_inactive_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'EVENT_INACTIVE',
      'error', 'Event is no longer active',
      'inactive_reason', v_inactive_reason,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  IF v_session.state::text IS DISTINCT FROM 'ready_gate'
     OR COALESCE(v_session.phase, 'ready_gate') IS DISTINCT FROM 'ready_gate'
     OR v_session.ready_gate_status IS DISTINCT FROM 'both_ready'
     OR v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'NOT_PROTECTABLE',
      'retryable', true,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'handshake_started_at', v_session.handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at
    );
  END IF;

  v_domain := NULLIF(btrim(current_setting('app.daily_domain', true)), '');
  IF v_domain IS NULL
     AND v_session.daily_room_url IS NOT NULL
     AND v_session.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
    v_domain := substring(v_session.daily_room_url from '^https?://([^/]+)/');
  END IF;
  IF v_domain IS NULL THEN
    SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
    INTO v_domain
    FROM public.video_sessions vs
    WHERE vs.daily_room_url LIKE 'http%://%/date-%'
    ORDER BY vs.state_updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
  v_url := 'https://' || v_domain || '/' || v_expected_room_name;

  v_previous_lease_expires_at := v_session.prepare_entry_expires_at;
  v_lease_expires_at := GREATEST(
    COALESCE(v_session.prepare_entry_expires_at, v_now),
    v_now + interval '5 minutes'
  );

  UPDATE public.video_sessions
  SET
    prepare_entry_started_at = COALESCE(prepare_entry_started_at, v_now),
    prepare_entry_expires_at = v_lease_expires_at,
    prepare_entry_attempt_id = COALESCE(NULLIF(prepare_entry_attempt_id, ''), v_attempt_id),
    prepare_entry_actor_id = COALESCE(prepare_entry_actor_id, v_actor),
    ready_gate_expires_at = GREATEST(
      COALESCE(ready_gate_expires_at, v_now),
      v_lease_expires_at
    ),
    daily_room_name = v_expected_room_name,
    daily_room_url = CASE
      WHEN daily_room_url IS NOT NULL AND daily_room_url LIKE ('%/' || v_expected_room_name)
        THEN daily_room_url
      ELSE v_url
    END,
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'ready_gate_entry_protected'
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state::text = 'ready_gate'
    AND COALESCE(phase, 'ready_gate') = 'ready_gate'
    AND ready_gate_status = 'both_ready'
    AND handshake_started_at IS NULL
    AND date_started_at IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'PROTECT_ZERO_ROWS',
      'retryable', true,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE
      WHEN v_previous_lease_expires_at IS NULL THEN 'prepare_entry_route_protected'
      ELSE 'prepare_entry_route_protection_refreshed'
    END,
    NULL,
    v_after.event_id,
    v_actor,
    v_after.id,
    jsonb_build_object(
      'source', v_source,
      'entry_attempt_id', v_attempt_id,
      'ready_gate_status', v_after.ready_gate_status,
      'prepare_entry_started_at', v_after.prepare_entry_started_at,
      'prepare_entry_expires_at', v_after.prepare_entry_expires_at,
      'previous_prepare_entry_expires_at', v_previous_lease_expires_at,
      'ready_gate_expires_at', v_after.ready_gate_expires_at,
      'daily_room_name', v_after.daily_room_name,
      'daily_room_url', v_after.daily_room_url,
      'provider_reason', v_after.daily_room_provider_verify_reason,
      'routeable_for_date_owner', true,
      'provider_ready', v_after.daily_room_verified_at IS NOT NULL,
      'daily_metadata_authoritative_before_both_ready', false
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'ok', true,
    'code', 'OK',
    'event_id', v_after.event_id,
    'state', v_after.state::text,
    'phase', v_after.phase,
    'ready_gate_status', v_after.ready_gate_status,
    'ready_gate_expires_at', v_after.ready_gate_expires_at,
    'prepare_entry_started_at', v_after.prepare_entry_started_at,
    'prepare_entry_expires_at', v_after.prepare_entry_expires_at,
    'prepare_entry_attempt_id', v_after.prepare_entry_attempt_id,
    'prepare_entry_actor_id', v_after.prepare_entry_actor_id,
    'participant_1_id', v_after.participant_1_id,
    'participant_2_id', v_after.participant_2_id,
    'daily_room_name', v_after.daily_room_name,
    'daily_room_url', v_after.daily_room_url,
    'daily_room_verified_at', v_after.daily_room_verified_at,
    'daily_room_expires_at', v_after.daily_room_expires_at,
    'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
    'routeable_for_date_owner', true,
    'provider_ready', v_after.daily_room_verified_at IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_protect_both_ready_entry_v1(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_protect_both_ready_entry_v1(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_protect_both_ready_entry_v1(uuid, uuid, text, text) IS
  'Protects a both_ready Ready Gate handoff before Daily entry by refreshing a 5 minute prepare-entry lease and deterministic Daily room metadata; both_ready is routeable for date owner even while provider verification remains pending.';

CREATE OR REPLACE FUNCTION public.find_mystery_match_20260501180000_active_base(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_session_id_text text;
  v_ready_gate_status text;
BEGIN
  v_result := public.find_mystery_match_20260607103000_session_source_base(p_event_id, p_user_id);
  v_session_id_text := v_result->>'session_id';

  IF COALESCE(v_result->>'success', 'false') = 'true'
     AND v_session_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE public.video_sessions
    SET session_source = 'mystery_match'
    WHERE id = v_session_id_text::uuid
      AND session_source IS DISTINCT FROM 'mystery_match';

    v_ready_gate_status := COALESCE(NULLIF(v_result->>'ready_gate_status', ''), 'ready');
    v_result := v_result || jsonb_build_object(
      'session_source', 'mystery_match',
      'video_session_id', v_session_id_text,
      'match_id', COALESCE(NULLIF(v_result->>'match_id', ''), v_session_id_text),
      'event_id', p_event_id::text,
      'ready_gate_status', v_ready_gate_status
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid) IS
  'Mystery Match active-event base wrapper that labels created video_sessions and returns canonical video_session_id/match_id/event_id/ready_gate_status/session_source fields.';

CREATE OR REPLACE FUNCTION public.validate_video_date_registration_session_drift_v1(
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));
  v_checked integer := 0;
  v_drift jsonb := '[]'::jsonb;
BEGIN
  WITH candidates AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.ready_gate_status,
      vs.ready_gate_expires_at,
      vs.state::text AS state,
      vs.phase,
      vs.ended_at,
      vs.state_updated_at
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.state::text = 'ready_gate'
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND vs.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      AND (p_event_id IS NULL OR vs.event_id = p_event_id)
    ORDER BY vs.state_updated_at DESC NULLS LAST, vs.started_at DESC NULLS LAST
    LIMIT v_limit
  ),
  joined AS (
    SELECT
      c.*,
      er1.profile_id AS p1_profile_id,
      er1.queue_status AS p1_queue_status,
      er1.current_room_id AS p1_current_room_id,
      er1.current_partner_id AS p1_current_partner_id,
      er2.profile_id AS p2_profile_id,
      er2.queue_status AS p2_queue_status,
      er2.current_room_id AS p2_current_room_id,
      er2.current_partner_id AS p2_current_partner_id
    FROM candidates c
    LEFT JOIN public.event_registrations er1
      ON er1.event_id = c.event_id
     AND er1.profile_id = c.participant_1_id
    LEFT JOIN public.event_registrations er2
      ON er2.event_id = c.event_id
     AND er2.profile_id = c.participant_2_id
  ),
  evaluated AS (
    SELECT
      j.*,
      array_remove(ARRAY[
        CASE WHEN j.p1_profile_id IS NULL THEN 'participant_1_registration_missing' END,
        CASE WHEN j.p2_profile_id IS NULL THEN 'participant_2_registration_missing' END,
        CASE WHEN j.p1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_current_room_mismatch' END,
        CASE WHEN j.p2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_current_room_mismatch' END,
        CASE WHEN j.p1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
        CASE WHEN j.p2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
        CASE WHEN j.ready_gate_status <> 'queued' AND j.p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
        CASE WHEN j.ready_gate_status <> 'queued' AND j.p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END
      ]::text[], NULL) AS issues
    FROM joined j
  )
  SELECT
    (SELECT count(*)::integer FROM evaluated),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'session_id', e.id,
          'event_id', e.event_id,
          'ready_gate_status', e.ready_gate_status,
          'state', e.state,
          'phase', e.phase,
          'participant_1_id', e.participant_1_id,
          'participant_2_id', e.participant_2_id,
          'participant_1_queue_status', e.p1_queue_status,
          'participant_2_queue_status', e.p2_queue_status,
          'participant_1_current_room_id', e.p1_current_room_id,
          'participant_2_current_room_id', e.p2_current_room_id,
          'participant_1_current_partner_id', e.p1_current_partner_id,
          'participant_2_current_partner_id', e.p2_current_partner_id,
          'issues', to_jsonb(e.issues)
        )
        ORDER BY e.state_updated_at DESC NULLS LAST
      ) FILTER (WHERE cardinality(e.issues) > 0),
      '[]'::jsonb
    )
  INTO v_checked, v_drift
  FROM evaluated e;

  RETURN jsonb_build_object(
    'ok', true,
    'checked_count', v_checked,
    'drift_count', jsonb_array_length(v_drift),
    'drift', v_drift
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_video_date_registration_session_drift_v1(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_video_date_registration_session_drift_v1(uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.validate_video_date_registration_session_drift_v1(uuid, integer) IS
  'Service-only assertion for Video Session Created drift: active queued/Ready Gate video_sessions must have reciprocal event_registration room and partner pointers, and non-queued gates must keep both registrations in_ready_gate.';

CREATE OR REPLACE FUNCTION public.repair_video_date_registration_session_drift_v1(
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_row record;
  v_items jsonb := '[]'::jsonb;
  v_repaired integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR v_row IN
    WITH candidates AS (
      SELECT
        vs.id,
        vs.event_id,
        vs.participant_1_id,
        vs.participant_2_id,
        vs.ready_gate_status,
        vs.state_updated_at
      FROM public.video_sessions vs
      WHERE vs.ended_at IS NULL
        AND vs.state::text = 'ready_gate'
        AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
        AND vs.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
        AND (p_event_id IS NULL OR vs.event_id = p_event_id)
      ORDER BY vs.state_updated_at DESC NULLS LAST, vs.started_at DESC NULLS LAST
      LIMIT v_limit
    ),
    joined AS (
      SELECT
        c.*,
        er1.profile_id AS p1_profile_id,
        er1.queue_status AS p1_queue_status,
        er1.current_room_id AS p1_current_room_id,
        er1.current_partner_id AS p1_current_partner_id,
        er2.profile_id AS p2_profile_id,
        er2.queue_status AS p2_queue_status,
        er2.current_room_id AS p2_current_room_id,
        er2.current_partner_id AS p2_current_partner_id
      FROM candidates c
      LEFT JOIN public.event_registrations er1
        ON er1.event_id = c.event_id
       AND er1.profile_id = c.participant_1_id
      LEFT JOIN public.event_registrations er2
        ON er2.event_id = c.event_id
       AND er2.profile_id = c.participant_2_id
    ),
    evaluated AS (
      SELECT
        j.*,
        array_remove(ARRAY[
          CASE WHEN j.p1_profile_id IS NULL THEN 'participant_1_registration_missing' END,
          CASE WHEN j.p2_profile_id IS NULL THEN 'participant_2_registration_missing' END,
          CASE WHEN j.p1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_current_room_mismatch' END,
          CASE WHEN j.p2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_current_room_mismatch' END,
          CASE WHEN j.p1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
          CASE WHEN j.p2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
          CASE WHEN j.ready_gate_status <> 'queued' AND j.p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
          CASE WHEN j.ready_gate_status <> 'queued' AND j.p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END
        ]::text[], NULL) AS issues
      FROM joined j
    )
    SELECT *
    FROM evaluated
    WHERE cardinality(issues) > 0
    ORDER BY state_updated_at DESC NULLS LAST
  LOOP
    IF v_row.p1_profile_id IS NULL OR v_row.p2_profile_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'session_id', v_row.id,
        'event_id', v_row.event_id,
        'action', 'skipped',
        'reason', 'missing_registration',
        'issues', to_jsonb(v_row.issues)
      ));
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = v_row.event_id
        AND er.profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
        AND er.current_room_id IS NOT NULL
        AND er.current_room_id IS DISTINCT FROM v_row.id
        AND er.queue_status IN ('in_ready_gate', 'in_handshake', 'in_date', 'in_survey')
    ) THEN
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'session_id', v_row.id,
        'event_id', v_row.event_id,
        'action', 'skipped',
        'reason', 'conflicting_active_registration',
        'issues', to_jsonb(v_row.issues)
      ));
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      UPDATE public.event_registrations er
      SET
        current_room_id = v_row.id,
        current_partner_id = CASE
          WHEN er.profile_id = v_row.participant_1_id THEN v_row.participant_2_id
          ELSE v_row.participant_1_id
        END,
        queue_status = CASE
          WHEN v_row.ready_gate_status = 'queued' THEN er.queue_status
          ELSE 'in_ready_gate'
        END,
        updated_at = now()
      WHERE er.event_id = v_row.event_id
        AND er.profile_id IN (v_row.participant_1_id, v_row.participant_2_id);
    END IF;

    v_repaired := v_repaired + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'session_id', v_row.id,
      'event_id', v_row.event_id,
      'ready_gate_status', v_row.ready_gate_status,
      'action', CASE WHEN p_dry_run THEN 'would_repair' ELSE 'repaired' END,
      'issues', to_jsonb(v_row.issues)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'repairable_count', v_repaired,
    'skipped_count', v_skipped,
    'items', v_items
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_video_date_registration_session_drift_v1(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_video_date_registration_session_drift_v1(uuid, integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.repair_video_date_registration_session_drift_v1(uuid, integer, boolean) IS
  'Service-only dry-run-by-default repair for safe pre-date registration/session drift. Queued sessions keep their queue_status; ready/both_ready/snoozed sessions restore in_ready_gate plus reciprocal room/partner pointers.';
