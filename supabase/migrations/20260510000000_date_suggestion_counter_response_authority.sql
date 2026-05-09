-- Date suggestion counter authority: counter is a response action, not a new-proposal initiation.
-- Harden participant/latest-revision checks at the public v2 RPC boundary.

CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match_id uuid := nullif(p_payload->>'match_id', '')::uuid;
  v_suggestion_id uuid := nullif(p_payload->>'suggestion_id', '')::uuid;
  v_match record;
  v_existing public.date_suggestions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_share_requested boolean := lower(COALESCE(p_payload->'revision'->>'schedule_share_enabled', 'false')) IN ('true', 't', '1', 'yes');
  v_suggestion public.date_suggestions;
  v_prev public.date_suggestion_revisions;
  v_rev public.date_suggestion_revisions;
  v_next_rev int;
  v_partner uuid;
  v_notify jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_agreed jsonb;
  v_plan public.date_plans;
  v_previous_status text;
  v_title_a text;
  v_title_b text;
  r_date_type text;
  r_time_choice text;
  r_place_mode text;
  r_venue text;
  r_optional text;
  r_share boolean;
  r_starts text;
  r_ends text;
  r_block text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF p_action IN ('create_draft', 'update_draft', 'send_proposal')
     AND NOT public._get_user_tier_capability_bool_unchecked(v_uid, 'canSuggestDate') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'tier_capability_disabled',
      'error_code', 'tier_capability_disabled',
      'capability', 'canSuggestDate'
    );
  END IF;

  IF p_action IN ('send_proposal', 'counter')
     AND v_share_requested
     AND NOT public._get_user_tier_capability_bool_unchecked(v_uid, 'canUseVibeSchedule') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'tier_capability_disabled',
      'error_code', 'tier_capability_disabled',
      'capability', 'canUseVibeSchedule'
    );
  END IF;

  IF p_action = 'mark_viewed' THEN
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    SELECT * INTO v_suggestion
    FROM public.date_suggestions
    WHERE id = v_suggestion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT * INTO v_rev
    FROM public.date_suggestion_revisions
    WHERE id = v_suggestion.current_revision_id;

    IF v_rev.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_revision');
    END IF;

    IF v_rev.proposed_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'author_cannot_mark_viewed');
    END IF;

    IF v_suggestion.status = 'viewed' THEN
      RETURN jsonb_build_object('ok', true, 'suggestion_id', v_suggestion_id, 'status', 'viewed');
    END IF;

    IF v_suggestion.status NOT IN ('proposed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;

    UPDATE public.date_suggestions
    SET status = 'viewed', updated_at = now()
    WHERE id = v_suggestion_id;

    PERFORM public._date_suggestion_log(v_suggestion_id, v_uid, p_action, v_suggestion.status, 'viewed', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', v_suggestion_id, 'status', 'viewed');

  ELSIF p_action = 'counter' THEN
    r_date_type := coalesce(v_payload->'revision'->>'date_type_key', '');
    r_time_choice := coalesce(v_payload->'revision'->>'time_choice_key', '');
    r_place_mode := coalesce(v_payload->'revision'->>'place_mode_key', '');
    r_venue := v_payload->'revision'->>'venue_text';
    r_optional := v_payload->'revision'->>'optional_message';
    r_share := coalesce((v_payload->'revision'->>'schedule_share_enabled')::boolean, false);
    r_starts := v_payload->'revision'->>'starts_at';
    r_ends := v_payload->'revision'->>'ends_at';
    r_block := v_payload->'revision'->>'time_block';

    IF v_suggestion_id IS NULL OR r_date_type = '' OR r_time_choice = '' OR r_place_mode = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;

    v_starts := CASE WHEN r_starts IS NOT NULL AND r_starts <> '' THEN r_starts::timestamptz ELSE NULL END;
    v_ends := CASE WHEN r_ends IS NOT NULL AND r_ends <> '' THEN r_ends::timestamptz ELSE NULL END;

    SELECT * INTO v_suggestion
    FROM public.date_suggestions
    WHERE id = v_suggestion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT * INTO v_prev
    FROM public.date_suggestion_revisions
    WHERE id = v_suggestion.current_revision_id;

    IF v_prev.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_revision');
    END IF;

    IF v_suggestion.status NOT IN ('proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;

    IF v_prev.proposed_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cannot_counter_own_revision');
    END IF;

    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_rev
    FROM public.date_suggestion_revisions
    WHERE date_suggestion_id = v_suggestion_id;

    v_agreed := public._date_suggestion_compute_agreed(
      v_prev, r_date_type, r_time_choice, r_place_mode, r_venue, r_optional, r_share,
      v_starts, v_ends, r_block
    );

    INSERT INTO public.date_suggestion_revisions (
      date_suggestion_id, revision_number, proposed_by,
      date_type_key, time_choice_key, place_mode_key, venue_text, optional_message,
      schedule_share_enabled, starts_at, ends_at, time_block, agreed_field_flags
    ) VALUES (
      v_suggestion_id, v_next_rev, v_uid,
      r_date_type, r_time_choice, r_place_mode, r_venue, r_optional,
      r_share, v_starts, v_ends, r_block,
      v_agreed
    ) RETURNING * INTO v_rev;

    v_previous_status := v_suggestion.status;

    UPDATE public.date_suggestions
    SET
      status = 'countered',
      current_revision_id = v_rev.id,
      expires_at = coalesce(expires_at, now() + interval '7 days'),
      schedule_share_expires_at = CASE WHEN r_share THEN now() + interval '48 hours' ELSE schedule_share_expires_at END,
      updated_at = now()
    WHERE id = v_suggestion_id
    RETURNING * INTO v_suggestion;

    IF r_share THEN
      v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
      PERFORM public._date_suggestion_upsert_share_grant(
        v_suggestion.match_id, v_partner, v_uid,
        v_suggestion_id, v_rev.id
      );
    END IF;

    INSERT INTO public.messages (match_id, sender_id, content, message_kind, ref_id, structured_payload)
    VALUES (
      v_suggestion.match_id,
      v_uid,
      'Date suggestion',
      'date_suggestion',
      v_suggestion_id,
      jsonb_build_object('version', 1, 'kind', 'date_suggestion', 'date_suggestion_id', v_suggestion_id, 'revision_id', v_rev.id, 'event', 'counter')
    );

    v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
    v_notify := jsonb_build_object(
      'kind', 'countered',
      'recipient_id', v_partner,
      'match_id', v_suggestion.match_id,
      'suggestion_id', v_suggestion_id,
      'from_user_id', v_uid
    );

    PERFORM public._date_suggestion_log(v_suggestion_id, v_uid, p_action, v_previous_status, 'countered', true, null, jsonb_build_object('revision_id', v_rev.id));
    RETURN jsonb_build_object('ok', true, 'suggestion_id', v_suggestion_id, 'revision_id', v_rev.id, 'status', 'countered', 'notify', v_notify);

  ELSIF p_action = 'accept' THEN
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    SELECT * INTO v_suggestion
    FROM public.date_suggestions
    WHERE id = v_suggestion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT * INTO v_rev
    FROM public.date_suggestion_revisions
    WHERE id = v_suggestion.current_revision_id;

    IF v_rev.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_revision');
    END IF;

    IF v_rev.proposed_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'author_cannot_accept_own_revision');
    END IF;

    IF v_suggestion.status NOT IN ('proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;

    INSERT INTO public.date_plans (
      date_suggestion_id, match_id, starts_at, ends_at,
      venue_label, date_type_key, status
    ) VALUES (
      v_suggestion_id,
      v_suggestion.match_id,
      v_rev.starts_at,
      v_rev.ends_at,
      CASE
        WHEN v_rev.place_mode_key IN ('custom_venue', 'custom') THEN v_rev.venue_text
        ELSE v_rev.place_mode_key
      END,
      v_rev.date_type_key,
      'active'
    )
    RETURNING * INTO v_plan;

    v_title_a := 'Date with ' || public._date_suggestion_partner_first_name(v_suggestion.recipient_id);
    v_title_b := 'Date with ' || public._date_suggestion_partner_first_name(v_suggestion.proposer_id);

    INSERT INTO public.date_plan_participants (date_plan_id, user_id, calendar_title)
    VALUES (v_plan.id, v_suggestion.proposer_id, v_title_a)
    ON CONFLICT (date_plan_id, user_id) DO NOTHING;

    INSERT INTO public.date_plan_participants (date_plan_id, user_id, calendar_title)
    VALUES (v_plan.id, v_suggestion.recipient_id, v_title_b)
    ON CONFLICT (date_plan_id, user_id) DO NOTHING;

    UPDATE public.date_suggestions
    SET status = 'accepted', date_plan_id = v_plan.id, updated_at = now()
    WHERE id = v_suggestion_id;

    INSERT INTO public.messages (match_id, sender_id, content, message_kind, ref_id, structured_payload)
    VALUES (
      v_suggestion.match_id,
      v_uid,
      'Date confirmed',
      'date_suggestion_event',
      v_suggestion_id,
      jsonb_build_object('version', 1, 'kind', 'date_suggestion_accepted', 'date_suggestion_id', v_suggestion_id, 'date_plan_id', v_plan.id)
    );

    v_notify := jsonb_build_object(
      'kind', 'accepted',
      'recipient_id', v_rev.proposed_by,
      'match_id', v_suggestion.match_id,
      'suggestion_id', v_suggestion_id,
      'from_user_id', v_uid
    );

    PERFORM public._date_suggestion_log(v_suggestion_id, v_uid, p_action, v_suggestion.status, 'accepted', true, null, jsonb_build_object('date_plan_id', v_plan.id));
    RETURN jsonb_build_object(
      'ok', true,
      'suggestion_id', v_suggestion_id,
      'status', 'accepted',
      'date_plan_id', v_plan.id,
      'notify', v_notify
    );

  ELSIF p_action = 'decline' THEN
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    SELECT * INTO v_suggestion
    FROM public.date_suggestions
    WHERE id = v_suggestion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    IF v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT * INTO v_rev
    FROM public.date_suggestion_revisions
    WHERE id = v_suggestion.current_revision_id;

    IF v_rev.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_revision');
    END IF;

    IF v_rev.proposed_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'author_cannot_decline_own_revision');
    END IF;

    IF v_suggestion.status NOT IN ('proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;

    UPDATE public.date_suggestions
    SET status = 'declined', updated_at = now()
    WHERE id = v_suggestion_id;

    v_notify := jsonb_build_object(
      'kind', 'declined',
      'recipient_id', v_suggestion.proposer_id,
      'match_id', v_suggestion.match_id,
      'suggestion_id', v_suggestion_id,
      'from_user_id', v_uid
    );

    PERFORM public._date_suggestion_log(v_suggestion_id, v_uid, p_action, v_suggestion.status, 'declined', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', v_suggestion_id, 'status', 'declined', 'notify', v_notify);

  ELSIF p_action = 'not_now' THEN
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    SELECT * INTO v_suggestion
    FROM public.date_suggestions
    WHERE id = v_suggestion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT * INTO v_rev
    FROM public.date_suggestion_revisions
    WHERE id = v_suggestion.current_revision_id;

    IF v_rev.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_revision');
    END IF;

    IF v_rev.proposed_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'author_cannot_not_now_own_revision');
    END IF;

    IF v_suggestion.status NOT IN ('proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;

    UPDATE public.date_suggestions
    SET status = 'not_now', updated_at = now()
    WHERE id = v_suggestion_id;

    v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
    PERFORM public._date_suggestion_log(v_suggestion_id, v_uid, p_action, v_suggestion.status, 'not_now', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', v_suggestion_id, 'status', 'not_now', 'notify', jsonb_build_object(
      'kind', 'not_now',
      'recipient_id', v_partner,
      'match_id', v_suggestion.match_id,
      'suggestion_id', v_suggestion_id,
      'from_user_id', v_uid
    ));
  END IF;

  -- Preserve existing behavior for all non-send_proposal actions that do not need
  -- v2 response hardening (draft update/cancel/plan completion).
  IF p_action IS DISTINCT FROM 'send_proposal' THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
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

REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) TO authenticated;
