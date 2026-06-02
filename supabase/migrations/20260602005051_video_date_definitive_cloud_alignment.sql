-- Definitive cloud alignment for Video Date review followups.
--
-- Cloud already records the earlier 20260602000417 followup, so keep that
-- migration locally. This connector-applied migration is recorded in cloud
-- history as 20260602005051 and reasserts the scoped Daily token-refresh
-- provider limiter, preserves rollout kill switches, and removes anonymous
-- access drift from Video Date RPC/table surfaces.

CREATE OR REPLACE FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(
  p_session_id uuid,
  p_bucket text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bucket text := btrim(lower(COALESCE(p_bucket, '')));
  v_scoped_bucket text;
  v_capacity integer;
  v_refill numeric;
  v_session record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated', 'retryAfterSeconds', 30);
  END IF;

  SELECT vs.id, vs.state, vs.phase, vs.ended_at
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id
    AND (vs.participant_1_id = v_uid OR vs.participant_2_id = v_uid)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant', 'retryAfterSeconds', 30);
  END IF;

  IF v_session.ended_at IS NOT NULL
    OR NOT (
      COALESCE(v_session.state, '') IN ('handshake', 'date')
      OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
    )
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_active', 'retryAfterSeconds', 30);
  END IF;

  IF v_bucket = 'room_lookup' THEN
    v_capacity := 15;
    v_refill := 5;
  ELSIF v_bucket = 'meeting_token' THEN
    v_capacity := 20;
    v_refill := 10;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rate_limit_bucket', 'retryAfterSeconds', 30);
  END IF;

  v_scoped_bucket := concat(v_bucket, ':session:', p_session_id::text, ':user:', v_uid::text);

  RETURN public.take_provider_rate_limit_token_v1(
    'daily',
    v_scoped_bucket,
    1,
    v_capacity,
    v_refill
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(uuid, text) IS
  'Caller-authenticated Daily provider limiter for video-date token refresh room lookup and meeting-token calls; buckets are scoped per session and participant.';

WITH definitive_flag_keys(flag_key) AS (
  VALUES
    ('video_date.snapshot_v2'),
    ('video_date.deck_deal_v2'),
    ('video_date.readiness_v2'),
    ('video_date.micro_verdict_v2'),
    ('video_date.broadcast_v2'),
    ('video_date.timeline_v2'),
    ('video_date.deck_prefetch_polish_v2'),
    ('video_date.lobby_timeline_v2'),
    ('video_date.post_date_instant_next_v2'),
    ('video_date.daily_call_singleton_v2'),
    ('video_date.broadcast_batched_v2'),
    ('video_date.resilience_v2'),
    ('video_date.daily_token_refresh_v2'),
    ('video_date.push_payload_v2'),
    ('video_date.multi_device_dedup_v2'),
    ('video_date.push_open_dedupe_v1'),
    ('video_date.verdict_confirm_v2'),
    ('video_date.verdict_confirm_v1'),
    ('video_date.ready_gate_resilient_clock_v1'),
    ('video_date.deck_optimistic_v1'),
    ('video_date.outbox_lease_refresh_v2'),
    ('video_date.deadline_partial_unique_v2'),
    ('video_date.orphan_safety_interlock_v2'),
    ('video_date.circuit_breaker_v2'),
    ('video_date.daily_webhooks_v2'),
    ('video_date.extension_mutual_v2'),
    ('video_date.safety_always_on_v2'),
    ('video_date.multi_device_v2'),
    ('video_date.outbox_v2.mark_ready'),
    ('video_date.outbox_v2.forfeit'),
    ('video_date.outbox_v2.continue_handshake'),
    ('video_date.outbox_v2.handshake_auto_promote'),
    ('video_date.outbox_v2.date_timeout'),
    ('video_date.outbox_v2.submit_verdict'),
    ('video_date.outbox_v2.extension'),
    ('video_date.outbox_v2.safety'),
    ('video_date.outbox_v2.drain_match_queue')
)
UPDATE public.client_feature_flags f
SET
  enabled = true,
  rollout_bps = 10000,
  updated_at = now()
FROM definitive_flag_keys k
WHERE f.flag_key = k.flag_key;

-- RPC ACL reassertions. These functions are intentionally in public for
-- current client compatibility, so the boundary is explicit execute grants.
REVOKE ALL ON FUNCTION public.advance_video_session_vibe_question(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_video_session_vibe_question(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.find_video_date_match(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_video_date_match(uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.repair_stale_video_date_prepare_entries(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_stale_video_date_prepare_entries(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_pair_has_terminal_encounter(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_pair_has_terminal_encounter(uuid, uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.enforce_one_active_video_session()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_one_active_video_session()
  TO service_role;

REVOKE ALL ON FUNCTION public.enrich_video_date_transition_observability()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enrich_video_date_transition_observability()
  TO service_role;

-- Table ACL reassertions. RLS remains the row-level authority; these grants
-- remove anonymous Data API reachability and preserve authenticated client
-- reads/writes that web, mobile web, and native clients already depend on.
ALTER TABLE public.date_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.date_feedback FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.date_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.date_feedback TO service_role;

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_registrations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_registrations TO service_role;

ALTER TABLE public.event_swipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_swipes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.event_swipes
  FROM authenticated;
GRANT SELECT ON TABLE public.event_swipes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_swipes TO service_role;

ALTER TABLE public.video_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_sessions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.video_sessions
  FROM authenticated;
GRANT SELECT ON TABLE public.video_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_sessions TO service_role;

ALTER TABLE public.video_date_credit_extension_spends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_credit_extension_spends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_credit_extension_spends TO service_role;
