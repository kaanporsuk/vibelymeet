-- Definitive refund-on-platform-failure for video dates.
-- Migration classification: schema+policy.
--
-- Background:
--   When a video date ends through a platform / peer-side failure (Daily room
--   provider outage, peer never joined, handshake last-chance grace expired,
--   reconnect grace expired, ready gate window elapsed without both peers,
--   queued TTL expired) the user has no agency over the failure but loses
--   any extension credits they spent during the date phase. Even when no
--   credits were spent, the user's expectation of a date evaporates with no
--   acknowledgement.
--
--   This migration:
--     1. Adds refund_status / refund_granted_at / refund_breakdown columns
--        on video_sessions.
--     2. Adds refund_failed_video_date(p_session_id) which is idempotent and
--        applies precise extension-credit refunds derived from the canonical
--        video_date_credit_extension_spends ledger (added in migration
--        20260501090000), plus a small goodwill +1 extra_time_credits make-up
--        grant when the failure occurred before the date phase started.
--     3. Adds an AFTER UPDATE trigger that fires the refund function whenever
--        ended_reason transitions to a refund-eligible value, so every code
--        path that ends a session benefits without further code changes.
--
--   Notes:
--     * No wrapping of spend_video_date_credit_extension is needed because
--       the existing ledger (video_date_credit_extension_spends) already
--       records every spend with session_id + user_id + credit_type +
--       added_seconds. The refund engine reads from there.
--     * The trigger only fires AFTER UPDATE OF ended_reason; the recursive
--       UPDATE that the refund function does to write refund_status touches
--       a different column and is excluded by the WHEN clause.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_breakdown jsonb;

ALTER TABLE public.video_sessions
  DROP CONSTRAINT IF EXISTS video_sessions_refund_status_check;
ALTER TABLE public.video_sessions
  ADD CONSTRAINT video_sessions_refund_status_check
  CHECK (refund_status IS NULL OR refund_status IN ('granted', 'denied', 'noop'));

COMMENT ON COLUMN public.video_sessions.refund_status IS
  'Terminal refund decision: NULL until evaluated, then granted | denied | noop. Idempotent under refund_failed_video_date.';
COMMENT ON COLUMN public.video_sessions.refund_granted_at IS
  'When refund_failed_video_date settled this session''s refund evaluation.';
COMMENT ON COLUMN public.video_sessions.refund_breakdown IS
  'Per-participant refund breakdown captured at settlement time: {ended_reason, participant_1: {profile_id, extra_time_refunded, extended_vibe_refunded, extra_time_makeup}, participant_2: {…}}.';

-- The refund engine. Service-role only.
CREATE OR REPLACE FUNCTION public.refund_failed_video_date(
  p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_sess record;
  v_eligible_reasons constant text[] := ARRAY[
    'partial_join_peer_timeout',
    'prepare_entry_provider_failed_repair',
    'prepare_entry_daily_join_missing',
    'prepare_entry_timeout',
    'handshake_grace_expired',
    'reconnect_grace_expired',
    'queued_ttl_expired',
    'ready_gate_expired'
  ];
  v_p1_extra_time int := 0;
  v_p1_extended_vibe int := 0;
  v_p2_extra_time int := 0;
  v_p2_extended_vibe int := 0;
  v_p1_makeup int := 0;
  v_p2_makeup int := 0;
  v_session_started_date boolean := false;
  v_breakdown jsonb;
  v_refund_status text;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_id_required');
  END IF;

  SELECT *
  INTO v_sess
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- Idempotent: a settled session never gets another refund.
  IF v_sess.refund_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'refund_status', v_sess.refund_status,
      'refund_granted_at', v_sess.refund_granted_at,
      'breakdown', v_sess.refund_breakdown
    );
  END IF;

  -- Only ended sessions are eligible for evaluation.
  IF v_sess.ended_at IS NULL OR v_sess.ended_reason IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_ended');
  END IF;

  v_session_started_date := v_sess.date_started_at IS NOT NULL;

  -- If the ended_reason is not platform / peer failure, mark denied and exit.
  IF NOT (v_sess.ended_reason = ANY(v_eligible_reasons)) THEN
    UPDATE public.video_sessions
    SET refund_status = 'denied',
        refund_granted_at = now(),
        refund_breakdown = jsonb_build_object(
          'ended_reason', v_sess.ended_reason,
          'reason', 'ineligible_ended_reason'
        )
    WHERE id = p_session_id
      AND refund_status IS NULL;

    RETURN jsonb_build_object(
      'success', true,
      'refund_status', 'denied',
      'reason', 'ineligible_ended_reason',
      'ended_reason', v_sess.ended_reason
    );
  END IF;

  -- Compute per-participant extension spend totals from the canonical ledger.
  IF v_sess.participant_1_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN credit_type = 'extra_time' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(CASE WHEN credit_type = 'extended_vibe' THEN 1 ELSE 0 END), 0)::int
    INTO v_p1_extra_time, v_p1_extended_vibe
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_sess.participant_1_id;
  END IF;

  IF v_sess.participant_2_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN credit_type = 'extra_time' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(CASE WHEN credit_type = 'extended_vibe' THEN 1 ELSE 0 END), 0)::int
    INTO v_p2_extra_time, v_p2_extended_vibe
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_sess.participant_2_id;
  END IF;

  -- Goodwill make-up: only when the session never reached the date phase
  -- (i.e. the failure cost the user the date itself) AND no extension was
  -- already consumed for that participant. Extension refunds are precise
  -- compensation when extensions were actually spent; make-up never stacks.
  IF v_p1_extra_time + v_p1_extended_vibe = 0 AND NOT v_session_started_date THEN
    v_p1_makeup := 1;
  END IF;
  IF v_p2_extra_time + v_p2_extended_vibe = 0 AND NOT v_session_started_date THEN
    v_p2_makeup := 1;
  END IF;

  -- Apply the refunds. INSERT … ON CONFLICT so users without a baseline
  -- credit row still receive the grant.
  IF v_sess.participant_1_id IS NOT NULL
     AND (v_p1_extra_time + v_p1_extended_vibe + v_p1_makeup) > 0 THEN
    INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
    VALUES (
      v_sess.participant_1_id,
      v_p1_extra_time + v_p1_makeup,
      v_p1_extended_vibe
    )
    ON CONFLICT (user_id) DO UPDATE
    SET extra_time_credits = public.user_credits.extra_time_credits + EXCLUDED.extra_time_credits,
        extended_vibe_credits = public.user_credits.extended_vibe_credits + EXCLUDED.extended_vibe_credits,
        updated_at = now();
  END IF;

  IF v_sess.participant_2_id IS NOT NULL
     AND (v_p2_extra_time + v_p2_extended_vibe + v_p2_makeup) > 0 THEN
    INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
    VALUES (
      v_sess.participant_2_id,
      v_p2_extra_time + v_p2_makeup,
      v_p2_extended_vibe
    )
    ON CONFLICT (user_id) DO UPDATE
    SET extra_time_credits = public.user_credits.extra_time_credits + EXCLUDED.extra_time_credits,
        extended_vibe_credits = public.user_credits.extended_vibe_credits + EXCLUDED.extended_vibe_credits,
        updated_at = now();
  END IF;

  v_breakdown := jsonb_build_object(
    'ended_reason', v_sess.ended_reason,
    'session_started_date', v_session_started_date,
    'participant_1', jsonb_build_object(
      'profile_id', v_sess.participant_1_id,
      'extra_time_refunded', v_p1_extra_time,
      'extended_vibe_refunded', v_p1_extended_vibe,
      'extra_time_makeup', v_p1_makeup
    ),
    'participant_2', jsonb_build_object(
      'profile_id', v_sess.participant_2_id,
      'extra_time_refunded', v_p2_extra_time,
      'extended_vibe_refunded', v_p2_extended_vibe,
      'extra_time_makeup', v_p2_makeup
    )
  );

  v_refund_status := CASE
    WHEN (v_p1_extra_time + v_p1_extended_vibe + v_p1_makeup
          + v_p2_extra_time + v_p2_extended_vibe + v_p2_makeup) > 0
      THEN 'granted'
    ELSE 'noop'
  END;

  UPDATE public.video_sessions
  SET refund_status = v_refund_status,
      refund_granted_at = now(),
      refund_breakdown = v_breakdown
  WHERE id = p_session_id
    AND refund_status IS NULL;

  -- Best-effort observability hook.
  BEGIN
    PERFORM public.record_event_loop_observability(
      'refund_failed_video_date',
      'success',
      v_sess.ended_reason,
      NULL,
      v_sess.event_id,
      v_sess.participant_1_id,
      v_sess.id,
      v_breakdown
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- Observability must never break the refund.
      NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'refund_status', v_refund_status,
    'breakdown', v_breakdown
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_failed_video_date(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_failed_video_date(uuid) TO service_role;

COMMENT ON FUNCTION public.refund_failed_video_date(uuid) IS
  'Idempotent refund engine for video dates ended through platform / peer-side failure. Refunds exactly the extension credits each participant spent during the session (sourced from video_date_credit_extension_spends), plus a goodwill +1 extra_time_credits make-up grant when the date phase never started.';

-- Trigger that fires the refund function whenever ended_reason transitions
-- to a non-null value. The function itself decides eligibility; the trigger
-- just ensures every end path benefits without per-call wiring.
CREATE OR REPLACE FUNCTION public.video_session_refund_on_end_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.ended_reason IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ended_reason IS NOT DISTINCT FROM OLD.ended_reason THEN
    RETURN NEW;
  END IF;

  IF NEW.refund_status IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The refund function takes its own row lock and is fully idempotent.
  PERFORM public.refund_failed_video_date(NEW.id);

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_refund_on_end_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_refund_on_end_trigger() TO service_role;

DROP TRIGGER IF EXISTS video_session_refund_on_end ON public.video_sessions;
CREATE TRIGGER video_session_refund_on_end
AFTER UPDATE OF ended_reason ON public.video_sessions
FOR EACH ROW
WHEN (NEW.ended_reason IS NOT NULL AND NEW.ended_reason IS DISTINCT FROM OLD.ended_reason AND NEW.refund_status IS NULL)
EXECUTE FUNCTION public.video_session_refund_on_end_trigger();

COMMENT ON TRIGGER video_session_refund_on_end ON public.video_sessions IS
  'Fires refund_failed_video_date(id) whenever a session transitions to an ended_reason. Idempotent — recursive UPDATEs that only touch refund_status do not satisfy the WHEN clause.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508142000',
  'Video date refund-on-platform-failure engine + auto-trigger',
  'schema+policy',
  'Adds refund_status / refund_granted_at / refund_breakdown columns on video_sessions. Adds refund_failed_video_date(uuid) which is idempotent, eligibility-aware (partial_join_peer_timeout, prepare_entry_*, handshake_grace_expired, reconnect_grace_expired, queued_ttl_expired, ready_gate_expired), and applies precise extension refunds sourced from the canonical video_date_credit_extension_spends ledger, plus a goodwill +1 extra_time_credits make-up grant for never-started dates. Adds an AFTER UPDATE OF ended_reason trigger so every end path settles a refund automatically. No wrapping of spend_video_date_credit_extension is required because the existing spend ledger is the canonical source for refund amounts.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
