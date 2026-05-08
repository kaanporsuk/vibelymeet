-- Definitive close of the swipe block / report / visibility race.
-- Migration classification: schema+policy.
--
-- Background:
--   Prior wrappers checked is_blocked / is_profile_hidden / is_profile_discoverable /
--   user_reports BEFORE acquiring the per-pair `event_lobby_participant_session`
--   advisory lock. A concurrent INSERT into blocked_users or user_reports could
--   commit during that window and the swipe would still proceed to create a
--   video_sessions row downstream. This wrapper acquires the same pair lock that
--   downstream session-insert paths use, then re-runs the safety checks AFTER the
--   lock so any concurrent block / report either commits before us (visible) or
--   serializes after us (no race window).
--
-- pg_advisory_xact_lock is reentrant within a transaction, so taking the same
-- lock here and then again deeper in the swipe chain is a no-op for the second
-- acquisition and does not change overall locking semantics.

DROP FUNCTION IF EXISTS public.handle_swipe_20260508140000_block_race_base(uuid, uuid, uuid, text);
ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260508140000_block_race_base;

REVOKE ALL ON FUNCTION public.handle_swipe_20260508140000_block_race_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260508140000_block_race_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_t0 timestamptz;
  v_ms integer;
BEGIN
  -- Fast-path: only intercept authenticated mutual-creating swipes. Pass swipes
  -- never create sessions, so there is no race to close — let the base handle.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260508140000_block_race_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260508140000_block_race_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  -- Acquire the same per-pair advisory lock the downstream insert uses. Any
  -- concurrent transaction that wants to insert into blocked_users / user_reports
  -- for this pair must serialize against our visibility once committed.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  v_t0 := clock_timestamp();

  -- Post-lock recheck #1: bidirectional block.
  IF public.is_blocked(p_actor_id, p_target_id) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'blocked_pair_post_lock_recheck',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'post_lock_block_race_recheck',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'race_closed', 'block'
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'blocked_pair',
      'result', 'blocked_pair',
      'error', 'blocked_pair',
      'message', 'This person is no longer available.',
      'notification_suppressed', true,
      'dedupe_reason', 'blocked_pair_post_lock_recheck'
    );
  END IF;

  -- Post-lock recheck #2: actor is paused / hidden / shadowbanned.
  IF public.is_profile_hidden(p_actor_id) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'actor_hidden_post_lock_recheck',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'post_lock_block_race_recheck',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'race_closed', 'actor_hidden'
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'actor_hidden',
      'result', 'actor_hidden',
      'error', 'actor_hidden',
      'message', 'Your profile is paused. Resume to continue.',
      'notification_suppressed', true,
      'dedupe_reason', 'actor_hidden_post_lock_recheck'
    );
  END IF;

  -- Post-lock recheck #3: target undiscoverable to actor (covers visibility,
  -- pauses, audience filtering, and discoverability flips).
  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'target_undiscoverable_post_lock_recheck',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'post_lock_block_race_recheck',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'race_closed', 'target_undiscoverable'
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available.',
      'notification_suppressed', true,
      'dedupe_reason', 'target_undiscoverable_post_lock_recheck'
    );
  END IF;

  -- Post-lock recheck #4: actor has filed a report against target. Mirrors the
  -- pre-lock suppression but now after the lock — a race-inserted report stays
  -- honored.
  IF EXISTS (
    SELECT 1
    FROM public.user_reports
    WHERE reporter_id = p_actor_id
      AND reported_id = p_target_id
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'reported_pair_post_lock_recheck',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'post_lock_block_race_recheck',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'race_closed', 'report'
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'reported_pair',
      'result', 'reported_pair',
      'error', 'reported_pair',
      'message', 'This person is no longer available.',
      'notification_suppressed', true,
      'dedupe_reason', 'reported_pair_post_lock_recheck'
    );
  END IF;

  -- Safe under the lock. Delegate to the existing swipe chain.
  RETURN public.handle_swipe_20260508140000_block_race_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching wrapper. Re-checks block / hidden / discoverability / report state AFTER acquiring the pair advisory lock so concurrent block/report/pause inserts cannot race a session creation. Delegates to the prior tier-authority swipe chain.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508140000',
  'Handle swipe post-lock block / report / visibility race recheck',
  'schema+policy',
  'Adds a definitive post-lock safety recheck inside handle_swipe. Re-uses the existing per-pair advisory lock so a concurrent block, profile hide, or report insert cannot race the swipe-to-session creation window. Delegates to the prior wrapper (renamed to handle_swipe_20260508140000_block_race_base) so all upstream tier and queue semantics are preserved.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
