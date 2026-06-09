-- Remove the temporary Video Date session-source discriminator.
--
-- Mystery Match and the direct legacy queue/session RPCs are already removed.
-- The supported creation path remains swipe-actions -> handle_swipe_v2, with
-- reciprocal swipe or supported queue promotion advancing into Ready Gate.

CREATE OR REPLACE FUNCTION public.handle_swipe_20260601183000_deck_authority_base(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_had_super_vibe boolean := false;
  v_has_super_vibe boolean := false;
  v_result jsonb;
  v_outcome text;
BEGIN
  IF p_swipe_type = 'super_vibe' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_actor_id
        AND es.target_id = p_target_id
        AND es.swipe_type = 'super_vibe'
    ) INTO v_had_super_vibe;
  END IF;

  v_result := public.handle_swipe_20260607103000_mutual_match_source_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );
  v_outcome := COALESCE(v_result->>'result', v_result->>'outcome', v_result->>'error');

  IF p_swipe_type = 'super_vibe' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_actor_id
        AND es.target_id = p_target_id
        AND es.swipe_type = 'super_vibe'
    ) INTO v_has_super_vibe;

    IF NOT v_had_super_vibe
       AND v_has_super_vibe
       AND COALESCE(v_result->>'success', 'false') = 'true'
       AND v_outcome IN ('super_vibe_sent', 'match', 'match_queued', 'already_matched') THEN
      v_result := v_result || jsonb_build_object('super_vibe_consumed', true);
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text) IS
  'Swipe mutation base wrapper that preserves Super Vibe consumed response truth without storing a session source discriminator.';

ALTER TABLE public.video_sessions
  DROP CONSTRAINT IF EXISTS video_sessions_session_source_rec_swipe_only;

ALTER TABLE public.video_sessions
  DROP COLUMN IF EXISTS session_source;
