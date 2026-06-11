-- Phase D/E active contract cleanup:
-- - clients now use entry-named flags/actions/RPC wrappers;
-- - snapshot-core returns the canonical entry phase;
-- - legacy DB enum/column/function internals remain a short-lived server
--   compatibility layer because linked cloud still has live dependencies.

WITH source_flags AS (
  SELECT
    'video_date.outbox_v2.continue_entry'::text AS flag_key,
    COALESCE((
      SELECT enabled
      FROM public.client_feature_flags
      WHERE flag_key = 'video_date.outbox_v2.continue_handshake'
    ), true) AS enabled,
    COALESCE((
      SELECT rollout_bps
      FROM public.client_feature_flags
      WHERE flag_key = 'video_date.outbox_v2.continue_handshake'
    ), 10000) AS rollout_bps,
    'Transactional outbox path for early entry continue.'::text AS description,
    COALESCE((
      SELECT kill_switch_active
      FROM public.client_feature_flags
      WHERE flag_key = 'video_date.outbox_v2.continue_handshake'
    ), false) AS kill_switch_active
  UNION ALL
  SELECT
    'video_date.outbox_v2.entry_auto_promote'::text AS flag_key,
    COALESCE((
      SELECT enabled
      FROM public.client_feature_flags
      WHERE flag_key = 'video_date.outbox_v2.handshake_auto_promote'
    ), true) AS enabled,
    COALESCE((
      SELECT rollout_bps
      FROM public.client_feature_flags
      WHERE flag_key = 'video_date.outbox_v2.handshake_auto_promote'
    ), 10000) AS rollout_bps,
    'Transactional outbox path for server entry auto-promote.'::text AS description,
    COALESCE((
      SELECT kill_switch_active
      FROM public.client_feature_flags
      WHERE flag_key = 'video_date.outbox_v2.handshake_auto_promote'
    ), false) AS kill_switch_active
)
INSERT INTO public.client_feature_flags (
  flag_key,
  enabled,
  rollout_bps,
  description,
  kill_switch_active,
  created_at,
  updated_at
)
SELECT
  flag_key,
  enabled,
  rollout_bps,
  description,
  kill_switch_active,
  now(),
  now()
FROM source_flags
ON CONFLICT (flag_key) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  rollout_bps = EXCLUDED.rollout_bps,
  description = EXCLUDED.description,
  kill_switch_active = EXCLUDED.kill_switch_active,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_video_date_snapshot_core(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_computed_deadline_at timestamptz;
  v_deadline_at timestamptz;
  v_allowed text[] := ARRAY[]::text[];
  v_confirmed_encounter boolean := false;
  v_survey_required boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.entry_started_at IS NOT NULL
      OR v_session.handshake_started_at IS NOT NULL
      OR v_session.state::text IN ('entry', 'handshake') THEN 'entry'
    WHEN v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN NULLIF(v_session.phase, '') IN ('ready_gate', 'entry', 'handshake', 'date', 'verdict', 'ended')
      THEN CASE WHEN v_session.phase = 'handshake' THEN 'entry' ELSE v_session.phase END
    ELSE COALESCE(v_session.state::text, 'ready_gate')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'entry' THEN COALESCE(v_session.entry_started_at, v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'entry' AND kind IN ('entry_auto_promote', 'entry_timeout', 'handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_computed_deadline_at := CASE
    WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
    WHEN v_phase = 'entry' THEN COALESCE(v_session.entry_started_at, v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
    WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
    ELSE NULL
  END;

  v_deadline_at := CASE
    WHEN v_phase = 'date' AND v_deadline_row_at IS NOT NULL AND v_computed_deadline_at IS NOT NULL
      THEN GREATEST(v_deadline_row_at, v_computed_deadline_at)
    WHEN v_deadline_row_at IS NOT NULL THEN v_deadline_row_at
    ELSE v_computed_deadline_at
  END;

  v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );
  v_survey_required := CASE
    WHEN v_phase = 'verdict' THEN v_confirmed_encounter
    ELSE public.video_date_session_is_post_date_survey_eligible_v2(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      v_session.participant_1_remote_seen_at,
      v_session.participant_2_remote_seen_at
    )
  END;

  v_allowed := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_phase = 'ended' THEN CASE WHEN v_survey_required THEN ARRAY['submit_verdict']::text[] ELSE ARRAY[]::text[] END
    WHEN v_phase = 'ready_gate' THEN ARRAY['mark_ready', 'forfeit', 'report_block']::text[]
    WHEN v_phase = 'entry' THEN ARRAY['continue', 'pass', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'date' THEN ARRAY['spend_extension', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'verdict' THEN CASE WHEN v_survey_required THEN ARRAY['submit_verdict', 'report_block']::text[] ELSE ARRAY['report_block']::text[] END
    ELSE ARRAY[]::text[]
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sessionId', v_session.id,
    'eventId', v_session.event_id,
    'seq', COALESCE(v_session.session_seq, 0),
    'serverNow', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
    'phase', v_phase,
    'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
    'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
    'allowedActions', to_jsonb(v_allowed),
    'surveyRequired', v_survey_required,
    'survey_required', v_survey_required,
    'participants', jsonb_build_array(
      jsonb_build_object(
        'id', v_session.participant_1_id,
        'isSelf', v_session.participant_1_id = v_uid,
        'isPartner', v_session.participant_1_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_1_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_joined_at) * 1000)::bigint END,
        'remoteSeenAt', CASE WHEN v_session.participant_1_remote_seen_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_remote_seen_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_1_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_away_at) * 1000)::bigint END
      ),
      jsonb_build_object(
        'id', v_session.participant_2_id,
        'isSelf', v_session.participant_2_id = v_uid,
        'isPartner', v_session.participant_2_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_2_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_joined_at) * 1000)::bigint END,
        'remoteSeenAt', CASE WHEN v_session.participant_2_remote_seen_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_remote_seen_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_2_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_away_at) * 1000)::bigint END
      )
    ),
    'room', CASE
      WHEN v_session.daily_room_url IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', v_session.daily_room_name,
        'url', v_session.daily_room_url,
        'tokenRequired', true
      )
    END,
    'endedReason', v_session.ended_reason,
    'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_snapshot_core(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_snapshot_core(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_video_date_snapshot_core(uuid) IS
  'Video Date snapshot core. Emits canonical entry/date/survey vocabulary; legacy DB entry storage remains server-internal compatibility only.';

COMMENT ON FUNCTION public.video_session_entry_auto_promote_v2(uuid, text, text) IS
  'Canonical Video Date entry auto-promote RPC. Internally delegates through the legacy server compatibility implementation until DB internals are physically renamed.';
COMMENT ON FUNCTION public.video_session_continue_entry_v2(uuid, text, text) IS
  'Canonical Video Date entry continue RPC. Internally delegates through the legacy server compatibility implementation until DB internals are physically renamed.';
COMMENT ON FUNCTION public.finalize_video_date_entry_deadline(uuid, uuid, text, text) IS
  'Canonical Video Date entry deadline finalizer. Service-role only; legacy DB internals are hidden behind this entry wrapper.';
