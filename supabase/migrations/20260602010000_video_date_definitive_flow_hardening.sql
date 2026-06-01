-- Definitive Vibe Video Date flow hardening.
--
-- 1. Promote the core hardened video-date paths to 100% rollout for all clients.
--    Daily room pooling remains deliberately excluded because it is a measurement-
--    gated performance optimization rather than a correctness/safety hardening.
-- 2. Make legacy extension spends idempotent even when old clients omit a key.
--    New web/native clients still pass explicit keys and can spend multiple
--    extensions of the same type. No-key legacy clients get one server-owned
--    idempotency slot per session/user/credit type, preventing retry double-spends
--    without stranding older mobile binaries.

WITH definitive_flags(flag_key, description) AS (
  VALUES
    ('video_date.snapshot_v2', 'Video Date v4 token-free snapshot core plus Edge token wrapper.'),
    ('video_date.deck_deal_v2', 'Server-dealt deck impressions that prevent duplicate top cards after refresh/crash.'),
    ('video_date.readiness_v2', 'Persisted heartbeat/readiness and non-blocking pre-event readiness UX.'),
    ('video_date.micro_verdict_v2', 'Short in-event post-date verdict timeout while preserving long recovery.'),
    ('video_date.broadcast_v2', 'Private sanitized Broadcast for participant-visible session events.'),
    ('video_date.timeline_v2', 'Server-owned timeline and countdown rendering from snapshot deadlines.'),
    ('video_date.deck_prefetch_polish_v2', 'Web/native deck media prefetch, swipe paint, cache-hit, and top-up telemetry polish.'),
    ('video_date.lobby_timeline_v2', 'RAF-driven lobby timeline plus private active-session Broadcast convergence.'),
    ('video_date.post_date_instant_next_v2', 'Post-date survey prestage, next-deck prewarm, and optimistic verdict telemetry.'),
    ('video_date.daily_call_singleton_v2', 'Web/native Daily call-object warm handoff between consecutive video dates.'),
    ('video_date.broadcast_batched_v2', 'Statement-level batched participant Broadcast envelopes for video_session_events.'),
    ('video_date.resilience_v2', 'Premium reconnect resilience UI, ETA copy, low-quality mode telemetry, and capability-checked fallback.'),
    ('video_date.daily_token_refresh_v2', 'Phase-bounded Daily token refresh and reconnect near-expiry protection.'),
    ('video_date.push_payload_v2', 'Video-date push payload snapshot preload for faster date/ready deep links.'),
    ('video_date.multi_device_dedup_v2', 'Cross-device video-date push dispatch grouping and first-ack dedup.'),
    ('video_date.push_open_dedupe_v1', 'Compatibility alias for video-date push open dedupe. Prefer video_date.multi_device_dedup_v2.'),
    ('video_date.verdict_confirm_v2', 'Canonical post-date verdict confirmation before permanent UI advancement.'),
    ('video_date.verdict_confirm_v1', 'Compatibility alias for post-date verdict confirmation rollout.'),
    ('video_date.ready_gate_resilient_clock_v1', 'Compatibility alias for Ready Gate server-clock countdown and realtime resilience.'),
    ('video_date.deck_optimistic_v1', 'Compatibility alias for optimistic deck polish. Prefer video_date.deck_prefetch_polish_v2.'),
    ('video_date.outbox_lease_refresh_v2', 'Provider outbox row lease refresh and stuck-claim rollback guardrails.'),
    ('video_date.deadline_partial_unique_v2', 'Active deadline partial uniqueness and finalizer duplicate protection.'),
    ('video_date.orphan_safety_interlock_v2', 'Safety-evidence-aware Daily orphan room cleanup interlock.'),
    ('video_date.circuit_breaker_v2', 'Service-role video-date reliability circuit-breaker decision and rollback surface.'),
    ('video_date.daily_webhooks_v2', 'Daily webhook reconciliation with signature verification.'),
    ('video_date.extension_mutual_v2', 'Mutual extension flow with room-expiry proof and refund safety.'),
    ('video_date.safety_always_on_v2', 'Always-on in-call report/block surfaces backed by private safety events.'),
    ('video_date.multi_device_v2', 'Multi-device video-date session convergence and duplicate-surface safety.'),
    ('video_date.outbox_v2.mark_ready', 'Transactional outbox path for mark-ready transition.'),
    ('video_date.outbox_v2.forfeit', 'Transactional outbox path for forfeit/end-before-date transition.'),
    ('video_date.outbox_v2.continue_handshake', 'Transactional outbox path for early handshake continue.'),
    ('video_date.outbox_v2.handshake_auto_promote', 'Transactional outbox path for server handshake auto-promote.'),
    ('video_date.outbox_v2.date_timeout', 'Transactional outbox path for server date timeout.'),
    ('video_date.outbox_v2.submit_verdict', 'Transactional outbox path for post-date verdict submission.'),
    ('video_date.outbox_v2.extension', 'Transactional outbox path for extension proposal/accept/refund.'),
    ('video_date.outbox_v2.safety', 'Transactional outbox path for report/block session ending.'),
    ('video_date.outbox_v2.drain_match_queue', 'Transactional outbox path for match-queue drain and promotion.')
)
INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
SELECT flag_key, true, 10000, description, false
FROM definitive_flags
ON CONFLICT (flag_key) DO UPDATE
SET
  enabled = true,
  rollout_bps = 10000,
  kill_switch_active = false,
  description = EXCLUDED.description,
  updated_at = now();

UPDATE public.client_feature_flags
SET
  enabled = false,
  rollout_bps = 0,
  kill_switch_active = false,
  description = 'Deprecated compatibility flag. Legacy no-key extension calls are now server-normalized into a safe idempotency slot instead of being rejected.',
  updated_at = now()
WHERE flag_key = 'video_date.require_legacy_extension_idempotency_key';

CREATE OR REPLACE FUNCTION public.spend_video_date_credit_extension(
  p_session_id uuid,
  p_credit_type text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sess record;
  v_add int;
  v_rows int;
  v_new_total int;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_client_supplied_key boolean := false;
  v_existing record;
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  v_add := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_credit_type');
  END IF;

  v_client_supplied_key := v_key IS NOT NULL;
  IF v_key IS NULL THEN
    v_key := concat('legacy-no-key-v1:', p_session_id::text, ':', v_uid::text, ':', v_credit_type);
  END IF;

  SELECT *
  INTO v_existing
  FROM public.video_date_credit_extension_spends
  WHERE session_id = p_session_id
    AND user_id = v_uid
    AND credit_type = v_credit_type
    AND idempotency_key = v_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'added_seconds', v_existing.added_seconds,
      'date_extra_seconds', v_existing.date_extra_seconds_after,
      'idempotent', true,
      'legacy_idempotency', NOT v_client_supplied_key
    );
  END IF;

  SELECT * INTO v_sess FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.video_date_credit_extension_spends
  WHERE session_id = p_session_id
    AND user_id = v_uid
    AND credit_type = v_credit_type
    AND idempotency_key = v_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'added_seconds', v_existing.added_seconds,
      'date_extra_seconds', v_existing.date_extra_seconds_after,
      'idempotent', true,
      'legacy_idempotency', NOT v_client_supplied_key
    );
  END IF;

  IF v_sess.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_ended');
  END IF;

  IF v_sess.state IS DISTINCT FROM 'date'::public.video_date_state THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_in_date_phase');
  END IF;

  IF v_uid NOT IN (v_sess.participant_1_id, v_sess.participant_2_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF v_credit_type = 'extra_time' THEN
    UPDATE public.user_credits
    SET extra_time_credits = extra_time_credits - 1
    WHERE user_id = v_uid AND extra_time_credits > 0;
  ELSE
    UPDATE public.user_credits
    SET extended_vibe_credits = extended_vibe_credits - 1
    WHERE user_id = v_uid AND extended_vibe_credits > 0;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits');
  END IF;

  UPDATE public.video_sessions
  SET
    date_extra_seconds = COALESCE(date_extra_seconds, 0) + v_add,
    state_updated_at = now()
  WHERE id = p_session_id
  RETURNING date_extra_seconds INTO v_new_total;

  INSERT INTO public.video_date_credit_extension_spends (
    session_id,
    user_id,
    credit_type,
    idempotency_key,
    added_seconds,
    date_extra_seconds_after
  )
  VALUES (
    p_session_id,
    v_uid,
    v_credit_type,
    v_key,
    v_add,
    v_new_total
  );

  RETURN jsonb_build_object(
    'success', true,
    'added_seconds', v_add,
    'date_extra_seconds', v_new_total,
    'idempotent', false,
    'legacy_idempotency', NOT v_client_supplied_key
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) IS
  'Spends one video-date extension credit for an active date session. Client-supplied keys remain fully idempotent; legacy no-key calls are normalized to one server-owned idempotency slot per session/user/credit type so old mobile retries cannot double-spend.';
