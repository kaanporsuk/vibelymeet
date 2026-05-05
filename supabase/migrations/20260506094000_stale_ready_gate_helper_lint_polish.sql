-- Lint polish for stale Ready Gate active-conflict helper.
--
-- Keep the deployed signature stable for trigger/wrapper callers while making
-- the queued-expiry input intentionally referenced. Queued sessions remain
-- browseable and never block global active-session conflict checks.

CREATE OR REPLACE FUNCTION public.video_session_blocks_global_active_conflict(
  p_event_id uuid,
  p_ready_gate_status text,
  p_state text,
  p_phase text,
  p_handshake_started_at timestamptz,
  p_date_started_at timestamptz,
  p_ended_at timestamptz,
  p_ready_gate_expires_at timestamptz,
  p_queued_expires_at timestamptz,
  p_snooze_expires_at timestamptz,
  p_prepare_entry_expires_at timestamptz,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_status text := COALESCE(NULLIF(p_ready_gate_status, ''), '');
  v_state text := COALESCE(NULLIF(p_state, ''), '');
  v_phase text := COALESCE(NULLIF(p_phase, ''), '');
  v_inactive_reason text;
BEGIN
  IF p_ended_at IS NOT NULL OR v_state = 'ended' OR v_phase = 'ended' THEN
    RETURN false;
  END IF;

  IF p_handshake_started_at IS NOT NULL
     OR p_date_started_at IS NOT NULL
     OR p_participant_1_joined_at IS NOT NULL
     OR p_participant_2_joined_at IS NOT NULL
     OR v_state IN ('handshake', 'date')
     OR v_phase IN ('handshake', 'date') THEN
    RETURN true;
  END IF;

  IF v_status = 'queued' THEN
    IF p_queued_expires_at IS NOT NULL AND p_queued_expires_at <= v_now THEN
      RETURN false;
    END IF;
    RETURN false;
  END IF;

  IF v_status IN ('expired', 'forfeited') THEN
    RETURN false;
  END IF;

  IF v_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
    IF p_event_id IS NOT NULL THEN
      v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
      IF v_inactive_reason IS NOT NULL THEN
        RETURN false;
      END IF;
    END IF;

    IF p_prepare_entry_expires_at IS NOT NULL AND p_prepare_entry_expires_at > v_now THEN
      RETURN true;
    END IF;

    IF v_status = 'snoozed' THEN
      RETURN p_snooze_expires_at IS NULL OR p_snooze_expires_at > v_now;
    END IF;

    RETURN p_ready_gate_expires_at IS NULL OR p_ready_gate_expires_at > v_now;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) IS
  'True for real non-ended participant conflicts across events. Queued, expired, event-inactive, and expired pre-date Ready Gates do not block future matches.';
