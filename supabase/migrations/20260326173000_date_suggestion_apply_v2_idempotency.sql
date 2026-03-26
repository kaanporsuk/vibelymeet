-- Harden send_proposal idempotency without weakening one-open-per-match DB invariant.
-- Wrap existing RPC with deterministic lock/reuse semantics for send_proposal.

CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match_id uuid := nullif(p_payload->>'match_id', '')::uuid;
  v_suggestion_id uuid := nullif(p_payload->>'suggestion_id', '')::uuid;
  v_match record;
  v_existing public.date_suggestions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
BEGIN
  -- Preserve existing behavior for all non-send_proposal actions.
  IF p_action IS DISTINCT FROM 'send_proposal' THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  -- Existing suggestion flow should continue through canonical RPC behavior.
  IF v_suggestion_id IS NOT NULL THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  -- Let canonical RPC produce its own validation error when match_id is absent.
  IF v_match_id IS NULL THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  -- Lock match row first so concurrent send_proposal calls for same match serialize.
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = v_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'match_not_found');
  END IF;

  IF v_match.profile_id_1 <> v_uid AND v_match.profile_id_2 <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Single-open-suggestion rule: if one exists, return structured domain outcome.
  SELECT * INTO v_existing
  FROM public.date_suggestions
  WHERE match_id = v_match_id
    AND status IN ('draft', 'proposed', 'viewed', 'countered')
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- Product-safe reuse: proposer can continue their own draft.
    IF v_existing.proposer_id = v_uid AND v_existing.status = 'draft' THEN
      v_payload := jsonb_set(v_payload, '{suggestion_id}', to_jsonb(v_existing.id::text), true);
      RETURN public.date_suggestion_apply(p_action, v_payload);
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'active_suggestion_exists',
      'error_code', 'active_suggestion_exists',
      'suggestion_id', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  -- Race-safe fallback: if a concurrent insert still wins, map conflict to domain result.
  BEGIN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing
      FROM public.date_suggestions
      WHERE match_id = v_match_id
        AND status IN ('draft', 'proposed', 'viewed', 'countered')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'active_suggestion_exists',
          'error_code', 'active_suggestion_exists',
          'suggestion_id', v_existing.id,
          'status', v_existing.status
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'error', 'date_suggestion_unique_conflict',
        'error_code', 'date_suggestion_unique_conflict'
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) TO authenticated;
