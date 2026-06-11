-- Remove Ready Gate entry-proof telemetry (golden-flow simplification PR 1).
--
-- The entry-proof stack (record_video_date_ready_gate_entered_v1 RPC, the
-- video_date_ready_gate_entries ledger, and the
-- video_sessions.ready_gate_participant_*_entered_at stamps) was proof
-- scaffolding from the PR #1230 recovery era. It mutated the hot
-- video_sessions row on every Ready Gate mount and was implicated in the
-- 2026-06-10 ready-gate lock convoy (see migration 20260610201512). Audit on
-- 2026-06-11 confirmed:
--   * the participant entered_at columns have no readers besides the RPC;
--   * video_date_ready_gate_entries is read only by
--     video_date_partial_ready_diagnostics_v1 (operator diagnostics with zero
--     DB/client/Edge callers);
--   * the RPC's TTL extension is intentionally NOT relocated - Ready Gate
--     timing is owned by session creation and mark_ready.
--
-- Order: redefine diagnostics without the entries joins, then drop the RPC,
-- the ledger table, and the inert columns in one forward migration.

CREATE OR REPLACE FUNCTION public.video_date_partial_ready_diagnostics_v1(p_event_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_rows jsonb;
BEGIN
  WITH candidates AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.ready_gate_status,
      vs.ready_participant_1_at,
      vs.ready_participant_2_at,
      vs.ready_gate_expires_at,
      vs.daily_room_name,
      vs.daily_room_url,
      vs.prepare_entry_expires_at,
      vs.state,
      vs.phase,
      vs.started_at,
      vs.state_updated_at
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND vs.ready_gate_status IN ('ready_a', 'ready_b', 'snoozed')
      AND (p_event_id IS NULL OR vs.event_id = p_event_id)
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.state_updated_at, vs.started_at) ASC
    LIMIT v_limit
  ),
  joined AS (
    SELECT
      c.*,
      er1.queue_status AS participant_1_queue_status,
      er1.current_room_id AS participant_1_current_room_id,
      er1.current_partner_id AS participant_1_current_partner_id,
      er2.queue_status AS participant_2_queue_status,
      er2.current_room_id AS participant_2_current_room_id,
      er2.current_partner_id AS participant_2_current_partner_id
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
        CASE WHEN j.ready_gate_status = 'ready_a' AND j.ready_participant_1_at IS NULL THEN 'ready_a_missing_participant_1_timestamp' END,
        CASE WHEN j.ready_gate_status = 'ready_a' AND j.ready_participant_2_at IS NOT NULL THEN 'ready_a_has_participant_2_timestamp' END,
        CASE WHEN j.ready_gate_status = 'ready_b' AND j.ready_participant_2_at IS NULL THEN 'ready_b_missing_participant_2_timestamp' END,
        CASE WHEN j.ready_gate_status = 'ready_b' AND j.ready_participant_1_at IS NOT NULL THEN 'ready_b_has_participant_1_timestamp' END,
        CASE WHEN j.participant_1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
        CASE WHEN j.participant_2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END,
        CASE WHEN j.participant_1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_room_mismatch' END,
        CASE WHEN j.participant_2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_room_mismatch' END,
        CASE WHEN j.participant_1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
        CASE WHEN j.participant_2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
        CASE WHEN j.ready_gate_expires_at IS NOT NULL AND j.ready_gate_expires_at <= now() THEN 'partial_ready_expired' END
      ]::text[], NULL) AS issues
    FROM joined j
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'session_id', e.id,
        'event_id', e.event_id,
        'ready_gate_status', e.ready_gate_status,
        'ready_participant_1_at', e.ready_participant_1_at,
        'ready_participant_2_at', e.ready_participant_2_at,
        'ready_gate_expires_at', e.ready_gate_expires_at,
        'daily_room_present', e.daily_room_name IS NOT NULL OR e.daily_room_url IS NOT NULL,
        'prepare_entry_expires_at', e.prepare_entry_expires_at,
        'participant_1_queue_status', e.participant_1_queue_status,
        'participant_2_queue_status', e.participant_2_queue_status,
        'issues', to_jsonb(e.issues)
      )
      ORDER BY COALESCE(e.ready_gate_expires_at, e.state_updated_at, e.started_at) ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM evaluated e;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'generated_at', now(),
    'event_id', p_event_id,
    'count', jsonb_array_length(v_rows),
    'sessions', v_rows
  );
END;
$function$;


DROP FUNCTION IF EXISTS public.record_video_date_ready_gate_entered_v1(uuid, text, text, text, text, text, text);

DROP TABLE IF EXISTS public.video_date_ready_gate_entries;

ALTER TABLE public.video_sessions
  DROP COLUMN IF EXISTS ready_gate_participant_1_entered_at,
  DROP COLUMN IF EXISTS ready_gate_participant_2_entered_at;
