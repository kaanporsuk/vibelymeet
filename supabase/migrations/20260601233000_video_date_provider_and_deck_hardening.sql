-- Video Date provider/deck hardening follow-up.
--
-- Keep the current-top card authority strict: data, policy, or eligibility
-- errors must surface to the caller instead of being collapsed into a
-- retryable "no current top card" state.

CREATE OR REPLACE FUNCTION public.event_deck_current_top_candidate(
  p_event_id uuid,
  p_viewer_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_target_id uuid;
  v_visible_grace interval := interval '20 minutes';
BEGIN
  WITH latest_batch AS (
    SELECT max(r.issued_at) AS issued_at
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND (
        r.expires_at > now()
        OR (r.visible_at IS NOT NULL AND r.visible_at > now() - v_visible_grace)
      )
  ),
  candidates AS (
    SELECT
      r.target_id,
      r.deck_rank
    FROM public.event_deck_card_reservations r
    JOIN latest_batch lb ON lb.issued_at = r.issued_at
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND (
        r.expires_at > now()
        OR (r.visible_at IS NOT NULL AND r.visible_at > now() - v_visible_grace)
      )
      AND r.swiped_at IS NULL
      AND COALESCE((public.event_deck_candidate_eligibility(
        p_event_id,
        p_viewer_id,
        r.target_id,
        true,
        true
      )->>'ok')::boolean, false)
  )
  SELECT candidates.target_id
  INTO v_target_id
  FROM candidates
  ORDER BY candidates.deck_rank
  LIMIT 1;

  RETURN v_target_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid) IS
  'Returns the current top Event Lobby Deck candidate from authoritative reservations, including a bounded grace window for already-visible cards. Raises unexpected authority errors instead of hiding them as empty deck state.';
