-- Phase 4: Daily token/push lifecycle feature flags and cross-device notification ack contract.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  ('video_date.daily_token_refresh_v2', false, 0, 'Phase-bounded Daily token refresh and reconnect near-expiry protection.', false),
  ('video_date.push_payload_v2', false, 0, 'Video-date push payload snapshot preload for faster date/ready deep links.', false),
  ('video_date.multi_device_dedup_v2', false, 0, 'Cross-device video-date push dispatch grouping and first-ack dedup.', false)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.notification_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dispatch_group_id text NOT NULL,
  ack_source text,
  provider_notification_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  acked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_acks_dispatch_group_not_blank CHECK (btrim(dispatch_group_id) <> ''),
  CONSTRAINT notification_acks_dispatch_group_len CHECK (char_length(dispatch_group_id) <= 160),
  CONSTRAINT notification_acks_source_len CHECK (ack_source IS NULL OR char_length(ack_source) <= 80),
  CONSTRAINT notification_acks_provider_id_len CHECK (provider_notification_id IS NULL OR char_length(provider_notification_id) <= 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_acks_user_dispatch_group_uidx
  ON public.notification_acks (user_id, dispatch_group_id);

CREATE INDEX IF NOT EXISTS notification_acks_user_acked_at_idx
  ON public.notification_acks (user_id, acked_at DESC);

DROP TRIGGER IF EXISTS notification_acks_updated_at ON public.notification_acks;
CREATE TRIGGER notification_acks_updated_at
BEFORE UPDATE ON public.notification_acks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.notification_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification acks" ON public.notification_acks;
CREATE POLICY "Users can view own notification acks"
ON public.notification_acks FOR SELECT TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON public.notification_acks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_acks TO authenticated;
GRANT ALL ON public.notification_acks TO service_role;

CREATE OR REPLACE FUNCTION public.ack_notification_dispatch(
  p_dispatch_group_id text,
  p_provider_notification_id text DEFAULT NULL,
  p_ack_source text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_dispatch_group_id text := NULLIF(btrim(COALESCE(p_dispatch_group_id, '')), '');
  v_ack_source text := NULLIF(left(btrim(COALESCE(p_ack_source, '')), 80), '');
  v_provider_notification_id text := NULLIF(left(btrim(COALESCE(p_provider_notification_id, '')), 160), '');
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_stored_payload jsonb := '{}'::jsonb;
  v_acked_at timestamptz;
  v_first_ack boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF v_dispatch_group_id IS NULL OR char_length(v_dispatch_group_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_dispatch_group_id');
  END IF;

  v_stored_payload := CASE
    WHEN jsonb_typeof(v_payload) <> 'object' THEN '{}'::jsonb
    WHEN pg_column_size(v_payload) > 8192 THEN jsonb_build_object('truncated', true)
    ELSE v_payload
  END;

  INSERT INTO public.notification_acks (
    user_id,
    dispatch_group_id,
    ack_source,
    provider_notification_id,
    payload,
    acked_at
  )
  VALUES (
    v_user_id,
    v_dispatch_group_id,
    v_ack_source,
    v_provider_notification_id,
    v_stored_payload,
    now()
  )
  ON CONFLICT (user_id, dispatch_group_id) DO NOTHING
  RETURNING acked_at INTO v_acked_at;

  v_first_ack := FOUND;

  IF v_acked_at IS NULL THEN
    SELECT acked_at
    INTO v_acked_at
    FROM public.notification_acks
    WHERE user_id = v_user_id
      AND dispatch_group_id = v_dispatch_group_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'first_ack', v_first_ack,
    'dispatch_group_id', v_dispatch_group_id,
    'acked_at', v_acked_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ack_notification_dispatch(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_notification_dispatch(text, text, text, jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.notification_acks IS
  'Per-user notification dispatch acknowledgement table. Unique dispatch_group_id lets the first device/action win across web/native/mobile without storing push tokens.';

COMMENT ON FUNCTION public.ack_notification_dispatch(text, text, text, jsonb) IS
  'Authenticated first-ack RPC for cross-device push dedup. Returns first_ack=false when another device already acknowledged the same dispatch group.';

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
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_session.ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
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
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_computed_deadline_at := CASE
    WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
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

  v_allowed := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_phase = 'ended' THEN ARRAY['submit_verdict']::text[]
    WHEN v_phase = 'ready_gate' THEN ARRAY['mark_ready', 'forfeit', 'report_block']::text[]
    WHEN v_phase = 'handshake' THEN ARRAY['continue', 'pass', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'date' THEN ARRAY['spend_extension', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'verdict' THEN ARRAY['submit_verdict', 'report_block']::text[]
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
    'participants', jsonb_build_array(
      jsonb_build_object(
        'id', v_session.participant_1_id,
        'isSelf', v_session.participant_1_id = v_uid,
        'isPartner', v_session.participant_1_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_1_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_joined_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_1_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_away_at) * 1000)::bigint END
      ),
      jsonb_build_object(
        'id', v_session.participant_2_id,
        'isSelf', v_session.participant_2_id = v_uid,
        'isPartner', v_session.participant_2_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_2_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_joined_at) * 1000)::bigint END,
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
  'Token-free video date snapshot core. Date-phase deadlines prefer the later of pending deadline rows and the canonical date_extra_seconds budget so extended dates cannot inherit stale token cutoffs.';
