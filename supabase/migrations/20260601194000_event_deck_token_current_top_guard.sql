-- Event Deck token current-top guard.
--
-- The reservation token proves a card came from the server deck response, but
-- it must not allow a prefetched lower-rank card to be swiped before the
-- top card from that response. Legacy no-token clients still use the latest
-- active reservation fallback.

CREATE OR REPLACE FUNCTION public.event_deck_validate_presented_card(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_deck_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_validation jsonb;
  v_token text := NULLIF(btrim(COALESCE(p_deck_token, '')), '');
  v_reservation record;
  v_current_top uuid;
BEGIN
  v_validation := public.event_deck_candidate_eligibility(
    p_event_id,
    p_viewer_id,
    p_target_id,
    true,
    true
  );

  IF COALESCE((v_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_validation;
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT r.id, r.issued_at, r.expires_at, r.deck_rank
    INTO v_reservation
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND r.target_id = p_target_id
      AND r.deck_token = v_token
      AND (r.expires_at > now() OR r.visible_at IS NOT NULL)
      AND r.swiped_at IS NULL
    ORDER BY r.issued_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_deck_token');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.event_deck_card_reservations lower_rank
      WHERE lower_rank.event_id = p_event_id
        AND lower_rank.viewer_id = p_viewer_id
        AND lower_rank.issued_at = v_reservation.issued_at
        AND lower_rank.deck_rank < v_reservation.deck_rank
        AND (lower_rank.expires_at > now() OR lower_rank.visible_at IS NOT NULL)
        AND lower_rank.swiped_at IS NULL
        AND COALESCE((public.event_deck_candidate_eligibility(
          p_event_id,
          p_viewer_id,
          lower_rank.target_id,
          true,
          true
        )->>'ok')::boolean, false)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_current_top_card');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'reason', 'valid_deck_token',
      'reservation_id', v_reservation.id,
      'expires_at', v_reservation.expires_at
    );
  END IF;

  v_current_top := public.event_deck_current_top_candidate(p_event_id, p_viewer_id);
  IF v_current_top IS NULL OR v_current_top IS DISTINCT FROM p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_current_top_card');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'current_top_card');
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text) IS
  'Validates Event Lobby presented cards. A deck token must be unexpired or already shown, and topmost within its reservation batch; no-token legacy clients use the latest active reservation fallback.';
