-- Proposer cancel: idempotent when already cancelled; explicit not_found for missing suggestion id.
-- Edge Function contract unchanged (ok, status, notify).

CREATE OR REPLACE FUNCTION public.date_suggestion_apply(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_suggestion public.date_suggestions;
  v_prev public.date_suggestion_revisions;
  v_rev public.date_suggestion_revisions;
  v_next_rev int;
  v_partner uuid;
  v_match_id uuid;
  v_sid uuid;
  v_plan public.date_plans;
  v_title_a text;
  v_title_b text;
  v_notify jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_agreed jsonb;
  v_msg_id uuid;
  -- payload fields
  p_match_id uuid;
  p_suggestion_id uuid;
  p_draft jsonb;
  r_date_type text;
  r_time_choice text;
  r_place_mode text;
  r_venue text;
  r_optional text;
  r_share boolean;
  r_starts text;
  r_ends text;
  r_block text;
  p_plan_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  p_suggestion_id := nullif(p_payload->>'suggestion_id', '')::uuid;
  p_match_id := nullif(p_payload->>'match_id', '')::uuid;

  IF p_action = 'create_draft' THEN
    IF p_match_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'match_id_required');
    END IF;
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF NOT FOUND THEN
      PERFORM public._date_suggestion_log(null, v_uid, p_action, null, null, false, 'match_not_found', p_payload);
      RETURN jsonb_build_object('ok', false, 'error', 'match_not_found');
    END IF;
    v_partner := CASE WHEN v_match.profile_id_1 = v_uid THEN v_match.profile_id_2 ELSE v_match.profile_id_1 END;
    IF public.is_blocked(v_uid, v_partner) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'blocked');
    END IF;
    IF v_partner IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_match');
    END IF;
    INSERT INTO public.date_suggestions (match_id, proposer_id, recipient_id, status, draft_payload)
    VALUES (p_match_id, v_uid, v_partner, 'draft', p_payload->'draft')
    RETURNING * INTO v_suggestion;
    PERFORM public._date_suggestion_log(v_suggestion.id, v_uid, p_action, null, 'draft', true, null, jsonb_build_object('suggestion_id', v_suggestion.id));
    RETURN jsonb_build_object('ok', true, 'suggestion_id', v_suggestion.id, 'status', v_suggestion.status);

  ELSIF p_action = 'update_draft' THEN
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF v_suggestion.proposer_id <> v_uid OR v_suggestion.status <> 'draft' THEN
      PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, null, false, 'forbidden', p_payload);
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    UPDATE public.date_suggestions SET draft_payload = p_payload->'draft', updated_at = now() WHERE id = p_suggestion_id;
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, 'draft', 'draft', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id);

  ELSIF p_action = 'send_proposal' THEN
    r_date_type := coalesce(p_payload->'revision'->>'date_type_key', '');
    r_time_choice := coalesce(p_payload->'revision'->>'time_choice_key', '');
    r_place_mode := coalesce(p_payload->'revision'->>'place_mode_key', '');
    r_venue := p_payload->'revision'->>'venue_text';
    r_optional := p_payload->'revision'->>'optional_message';
    r_share := coalesce((p_payload->'revision'->>'schedule_share_enabled')::boolean, false);
    r_starts := p_payload->'revision'->>'starts_at';
    r_ends := p_payload->'revision'->>'ends_at';
    r_block := p_payload->'revision'->>'time_block';
    IF r_date_type = '' OR r_time_choice = '' OR r_place_mode = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;
    v_starts := CASE WHEN r_starts IS NOT NULL AND r_starts <> '' THEN r_starts::timestamptz ELSE NULL END;
    v_ends := CASE WHEN r_ends IS NOT NULL AND r_ends <> '' THEN r_ends::timestamptz ELSE NULL END;

    IF p_suggestion_id IS NOT NULL THEN
      SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
      END IF;
      IF v_suggestion.proposer_id <> v_uid OR v_suggestion.status <> 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
      END IF;
      v_match_id := v_suggestion.match_id;
    ELSIF p_match_id IS NOT NULL THEN
      SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'match_not_found');
      END IF;
      v_partner := CASE WHEN v_match.profile_id_1 = v_uid THEN v_match.profile_id_2 ELSE v_match.profile_id_1 END;
      IF public.is_blocked(v_uid, v_partner) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'blocked');
      END IF;
      INSERT INTO public.date_suggestions (match_id, proposer_id, recipient_id, status, draft_payload)
      VALUES (p_match_id, v_uid, v_partner, 'draft', p_payload->'draft')
      RETURNING * INTO v_suggestion;
      p_suggestion_id := v_suggestion.id;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_or_match_required');
    END IF;

    v_next_rev := 1;
    INSERT INTO public.date_suggestion_revisions (
      date_suggestion_id, revision_number, proposed_by,
      date_type_key, time_choice_key, place_mode_key, venue_text, optional_message,
      schedule_share_enabled, starts_at, ends_at, time_block, agreed_field_flags
    ) VALUES (
      p_suggestion_id, v_next_rev, v_uid,
      r_date_type, r_time_choice, r_place_mode, r_venue, r_optional,
      r_share, v_starts, v_ends, r_block,
      '{}'::jsonb
    ) RETURNING * INTO v_rev;

    UPDATE public.date_suggestions SET
      status = 'proposed',
      current_revision_id = v_rev.id,
      draft_payload = NULL,
      expires_at = now() + interval '7 days',
      schedule_share_expires_at = CASE WHEN r_share THEN now() + interval '48 hours' ELSE NULL END,
      updated_at = now()
    WHERE id = p_suggestion_id
    RETURNING * INTO v_suggestion;

    IF r_share THEN
      PERFORM public._date_suggestion_upsert_share_grant(
        v_suggestion.match_id, v_suggestion.recipient_id, v_suggestion.proposer_id,
        p_suggestion_id, v_rev.id
      );
    END IF;

    INSERT INTO public.messages (match_id, sender_id, content, message_kind, ref_id, structured_payload)
    VALUES (
      v_suggestion.match_id,
      v_uid,
      'Date suggestion',
      'date_suggestion',
      p_suggestion_id,
      jsonb_build_object('version', 1, 'kind', 'date_suggestion', 'date_suggestion_id', p_suggestion_id, 'revision_id', v_rev.id)
    );

    v_notify := jsonb_build_object(
      'kind', 'proposed',
      'recipient_id', v_suggestion.recipient_id,
      'match_id', v_suggestion.match_id,
      'suggestion_id', p_suggestion_id,
      'from_user_id', v_uid
    );
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, 'draft', 'proposed', true, null, jsonb_build_object('revision_id', v_rev.id));
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'revision_id', v_rev.id, 'status', 'proposed', 'notify', v_notify);

  ELSIF p_action = 'mark_viewed' THEN
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    SELECT * INTO v_rev FROM public.date_suggestion_revisions WHERE id = v_suggestion.current_revision_id;
    IF v_rev.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_revision');
    END IF;
    IF v_rev.proposed_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'author_cannot_mark_viewed');
    END IF;
    IF v_suggestion.status NOT IN ('proposed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;
    UPDATE public.date_suggestions SET status = 'viewed', updated_at = now() WHERE id = p_suggestion_id;
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, 'viewed', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'status', 'viewed');

  ELSIF p_action = 'counter' THEN
    r_date_type := coalesce(p_payload->'revision'->>'date_type_key', '');
    r_time_choice := coalesce(p_payload->'revision'->>'time_choice_key', '');
    r_place_mode := coalesce(p_payload->'revision'->>'place_mode_key', '');
    r_venue := p_payload->'revision'->>'venue_text';
    r_optional := p_payload->'revision'->>'optional_message';
    r_share := coalesce((p_payload->'revision'->>'schedule_share_enabled')::boolean, false);
    r_starts := p_payload->'revision'->>'starts_at';
    r_ends := p_payload->'revision'->>'ends_at';
    r_block := p_payload->'revision'->>'time_block';
    IF p_suggestion_id IS NULL OR r_date_type = '' OR r_time_choice = '' OR r_place_mode = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;
    v_starts := CASE WHEN r_starts IS NOT NULL AND r_starts <> '' THEN r_starts::timestamptz ELSE NULL END;
    v_ends := CASE WHEN r_ends IS NOT NULL AND r_ends <> '' THEN r_ends::timestamptz ELSE NULL END;

    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    SELECT * INTO v_prev FROM public.date_suggestion_revisions WHERE id = v_suggestion.current_revision_id;
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
    FROM public.date_suggestion_revisions WHERE date_suggestion_id = p_suggestion_id;

    v_agreed := public._date_suggestion_compute_agreed(
      v_prev, r_date_type, r_time_choice, r_place_mode, r_venue, r_optional, r_share,
      v_starts, v_ends, r_block
    );

    INSERT INTO public.date_suggestion_revisions (
      date_suggestion_id, revision_number, proposed_by,
      date_type_key, time_choice_key, place_mode_key, venue_text, optional_message,
      schedule_share_enabled, starts_at, ends_at, time_block, agreed_field_flags
    ) VALUES (
      p_suggestion_id, v_next_rev, v_uid,
      r_date_type, r_time_choice, r_place_mode, r_venue, r_optional,
      r_share, v_starts, v_ends, r_block,
      v_agreed
    ) RETURNING * INTO v_rev;

    UPDATE public.date_suggestions SET
      status = 'countered',
      current_revision_id = v_rev.id,
      expires_at = coalesce(expires_at, now() + interval '7 days'),
      schedule_share_expires_at = CASE WHEN r_share THEN now() + interval '48 hours' ELSE schedule_share_expires_at END,
      updated_at = now()
    WHERE id = p_suggestion_id
    RETURNING * INTO v_suggestion;

    IF r_share THEN
      v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
      PERFORM public._date_suggestion_upsert_share_grant(
        v_suggestion.match_id, v_partner, v_uid,
        p_suggestion_id, v_rev.id
      );
    END IF;

    INSERT INTO public.messages (match_id, sender_id, content, message_kind, ref_id, structured_payload)
    VALUES (
      v_suggestion.match_id,
      v_uid,
      'Date suggestion',
      'date_suggestion',
      p_suggestion_id,
      jsonb_build_object('version', 1, 'kind', 'date_suggestion', 'date_suggestion_id', p_suggestion_id, 'revision_id', v_rev.id, 'event', 'counter')
    );

    v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
    v_notify := jsonb_build_object(
      'kind', 'countered',
      'recipient_id', v_partner,
      'match_id', v_suggestion.match_id,
      'suggestion_id', p_suggestion_id,
      'from_user_id', v_uid
    );
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, 'countered', true, null, jsonb_build_object('revision_id', v_rev.id));
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'revision_id', v_rev.id, 'status', 'countered', 'notify', v_notify);

  ELSIF p_action = 'accept' THEN
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    SELECT * INTO v_rev FROM public.date_suggestion_revisions WHERE id = v_suggestion.current_revision_id;
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
      p_suggestion_id,
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

    UPDATE public.date_suggestions SET
      status = 'accepted',
      date_plan_id = v_plan.id,
      updated_at = now()
    WHERE id = p_suggestion_id;

    INSERT INTO public.messages (match_id, sender_id, content, message_kind, ref_id, structured_payload)
    VALUES (
      v_suggestion.match_id,
      v_uid,
      'Date confirmed',
      'date_suggestion_event',
      p_suggestion_id,
      jsonb_build_object('version', 1, 'kind', 'date_suggestion_accepted', 'date_suggestion_id', p_suggestion_id, 'date_plan_id', v_plan.id)
    );

    v_notify := jsonb_build_object(
      'kind', 'accepted',
      'recipient_id', v_suggestion.proposer_id,
      'match_id', v_suggestion.match_id,
      'suggestion_id', p_suggestion_id,
      'from_user_id', v_uid
    );
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, 'accepted', true, null, jsonb_build_object('date_plan_id', v_plan.id));
    RETURN jsonb_build_object(
      'ok', true,
      'suggestion_id', p_suggestion_id,
      'status', 'accepted',
      'date_plan_id', v_plan.id,
      'notify', v_notify
    );

  ELSIF p_action = 'decline' THEN
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    IF v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_suggestion.status NOT IN ('proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;
    UPDATE public.date_suggestions SET status = 'declined', updated_at = now() WHERE id = p_suggestion_id;
    v_notify := jsonb_build_object(
      'kind', 'declined',
      'recipient_id', v_suggestion.proposer_id,
      'match_id', v_suggestion.match_id,
      'suggestion_id', p_suggestion_id,
      'from_user_id', v_uid
    );
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, 'declined', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'status', 'declined', 'notify', v_notify);

  ELSIF p_action = 'not_now' THEN
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_suggestion.status NOT IN ('proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;
    UPDATE public.date_suggestions SET status = 'not_now', updated_at = now() WHERE id = p_suggestion_id;
    v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, 'not_now', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'status', 'not_now', 'notify', jsonb_build_object(
      'kind', 'not_now',
      'recipient_id', v_partner,
      'match_id', v_suggestion.match_id,
      'suggestion_id', p_suggestion_id,
      'from_user_id', v_uid
    ));

  ELSIF p_action = 'cancel' THEN
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF v_suggestion.proposer_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    -- Idempotent: duplicate cancel after success returns ok without re-notifying.
    IF v_suggestion.status = 'cancelled' THEN
      RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'status', 'cancelled', 'notify', null);
    END IF;
    IF v_suggestion.status NOT IN ('draft', 'proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;
    UPDATE public.date_suggestions SET status = 'cancelled', updated_at = now() WHERE id = p_suggestion_id;
    v_notify := jsonb_build_object(
      'kind', 'cancelled',
      'recipient_id', v_suggestion.recipient_id,
      'match_id', v_suggestion.match_id,
      'suggestion_id', p_suggestion_id,
      'from_user_id', v_uid
    );
    PERFORM public._date_suggestion_log(p_suggestion_id, v_uid, p_action, v_suggestion.status, 'cancelled', true, null, null);
    RETURN jsonb_build_object('ok', true, 'suggestion_id', p_suggestion_id, 'status', 'cancelled', 'notify', v_notify);

  ELSIF p_action = 'plan_mark_complete' THEN
    p_plan_id := nullif(p_payload->>'plan_id', '')::uuid;
    IF p_plan_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
    END IF;
    SELECT * INTO v_plan FROM public.date_plans WHERE id = p_plan_id FOR UPDATE;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = v_plan.date_suggestion_id;
    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_suggestion.status <> 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_suggestion_status');
    END IF;
    IF v_plan.completion_confirmed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'complete_already_recorded');
    END IF;
    IF v_plan.completion_initiated_by IS NULL THEN
      UPDATE public.date_plans SET
        completion_initiated_by = v_uid,
        completion_initiated_at = now()
      WHERE id = p_plan_id;
    ELSIF v_plan.completion_initiated_by = v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'awaiting_partner_confirm');
    ELSIF v_plan.completion_initiated_by IS NOT NULL AND v_plan.completion_initiated_by <> v_uid THEN
      UPDATE public.date_plans SET
        completion_confirmed_by = v_uid,
        completion_confirmed_at = now(),
        status = 'completed'
      WHERE id = p_plan_id;
      UPDATE public.date_suggestions SET status = 'completed', updated_at = now() WHERE id = v_suggestion.id;
    END IF;
    PERFORM public._date_suggestion_log(v_suggestion.id, v_uid, p_action, v_suggestion.status, (SELECT status FROM public.date_suggestions WHERE id = v_suggestion.id), true, null, jsonb_build_object('plan_id', p_plan_id));
    RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id, 'suggestion_status', (SELECT status FROM public.date_suggestions WHERE id = v_suggestion.id));

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
  END IF;
END;
$$;
