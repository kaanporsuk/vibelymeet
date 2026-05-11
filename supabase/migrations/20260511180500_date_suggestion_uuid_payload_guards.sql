-- Follow-up to PR 839 review comments on date_suggestion_apply_v2.
--
-- Replay-safe: pure CREATE OR REPLACE FUNCTION.
-- Non-destructive: preserves the existing v2 action surface while guarding
-- malformed UUID payloads and non-array edit slot payloads.

BEGIN;

CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match_id_raw text := nullif(p_payload->>'match_id', '');
  v_suggestion_id_raw text := nullif(p_payload->>'suggestion_id', '');
  v_match_id uuid;
  v_suggestion_id uuid;
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
  r_slot_keys text[];
  -- accept payload (new)
  a_chosen_slot_key text;
  a_slot_date date;
  a_time_block text;
  a_starts text;
  a_starts_ts timestamptz;
  a_block_range int4range;
  a_starts_hour int;
  a_local_tz text;
  a_local_date date;
  a_local_hour int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF v_match_id_raw IS NOT NULL THEN
    BEGIN
      v_match_id := v_match_id_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_match_id');
    END;
  END IF;

  IF v_suggestion_id_raw IS NOT NULL THEN
    BEGIN
      v_suggestion_id := v_suggestion_id_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_suggestion_id');
    END;
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

  -- New: same-suggestion edit of the current actor's selected_slot_keys.
  -- Requires canUseVibeSchedule (the existing schedule-share entitlement).
  IF p_action = 'edit_schedule_share_slots'
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
    r_slot_keys := CASE
      WHEN v_payload->'revision'->'selected_slot_keys' IS NULL THEN NULL
      ELSE ARRAY(SELECT jsonb_array_elements_text(v_payload->'revision'->'selected_slot_keys'))
    END;

    IF v_suggestion_id IS NULL OR r_date_type = '' OR r_time_choice = '' OR r_place_mode = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;
    IF r_share AND (r_slot_keys IS NULL OR array_length(r_slot_keys, 1) IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
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
        v_suggestion_id, v_rev.id, r_slot_keys
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
    -- Schedule-share Accept is START-TIME-ONLY.
    -- The user is only choosing the meeting start time; physical-date
    -- duration is NOT part of the commitment. The product source of truth
    -- for which Vibely Schedule block to event-lock is:
    --     chosen_slot_key + starts_at  (NEVER starts_at + ends_at duration)
    --
    -- Boundaries are end-exclusive:
    --     Morning   = 08:00 <= start < 12:00
    --     Afternoon = 12:00 <= start < 17:00
    --     Evening   = 17:00 <= start < 21:00
    --     Night     = 21:00 <= start < 00:00
    -- 12:00 blocks Afternoon (not Morning); 17:00 blocks Evening (not
    -- Afternoon); 21:00 blocks Night (not Evening).
    --
    -- LOCAL-DATE CONSISTENCY (mandatory when chosen_slot_key is present):
    --   The client also sends `local_timezone` (IANA, e.g. "America/Los_Angeles").
    --   The server derives the user's local calendar date and local hour from
    --   `starts_at AT TIME ZONE local_timezone` and asserts:
    --     (a) local_date == chosen_slot_key date  (prevents day-shift crafting)
    --     (b) local_hour in block range            (prevents hour drift)
    --   `local_start_hour` is accepted only as a defense-in-depth cross-check
    --   when provided; the timezone-derived hour is the authority.
    --
    -- ends_at is intentionally ignored here. date_plans.ends_at is nullable
    -- in the schema (supabase/migrations/20260326120000_date_suggestion_foundation.sql),
    -- so for the schedule-share accept path we persist NULL. Legacy accept
    -- paths (no chosen_slot_key) continue to use the revision's ends_at to
    -- preserve all existing accept call sites.
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    a_chosen_slot_key := nullif(v_payload->>'chosen_slot_key', '');
    a_starts := nullif(v_payload->>'starts_at', '');

    IF a_chosen_slot_key IS NOT NULL THEN
      IF a_starts IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_required');
      END IF;
      IF length(a_chosen_slot_key) < 12 OR substring(a_chosen_slot_key from 11 for 1) <> '_' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END IF;
      BEGIN
        a_slot_date := substring(a_chosen_slot_key from 1 for 10)::date;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END;
      a_time_block := substring(a_chosen_slot_key from 12);
      IF a_time_block NOT IN ('morning', 'afternoon', 'evening', 'night') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END IF;

      BEGIN
        a_starts_ts := a_starts::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_required');
      END;

      -- local_timezone is required when chosen_slot_key is present so the
      -- server (not the client) is the authority on local-date / local-hour
      -- derivation. The client MUST send a valid IANA zone name.
      a_local_tz := nullif(p_payload->>'local_timezone', '');
      IF a_local_tz IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'local_timezone_required');
      END IF;

      -- Validate the IANA zone by attempting the conversion in a savepoint.
      -- An invalid zone raises 'invalid_parameter_value' from AT TIME ZONE.
      BEGIN
        a_local_date := (a_starts_ts AT TIME ZONE a_local_tz)::date;
        a_local_hour := EXTRACT(HOUR FROM (a_starts_ts AT TIME ZONE a_local_tz))::int;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_local_timezone');
      END;

      -- (a) local calendar date of starts_at MUST equal the date embedded in
      -- chosen_slot_key. This is the day-shift guard.
      IF a_local_date <> a_slot_date THEN
        RETURN jsonb_build_object('ok', false, 'error', 'local_date_mismatch');
      END IF;

      -- (b) Server-derived local hour must fall inside the chosen block. The
      -- block check is end-exclusive (matches _block_hour_range): morning=
      -- [8..11], afternoon=[12..16], evening=[17..20], night=[21..23].
      a_block_range := public._block_hour_range(a_time_block);
      IF a_local_hour NOT BETWEEN lower(a_block_range) AND upper(a_block_range) - 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_outside_block');
      END IF;

      -- Defense-in-depth: if the client also sent a local_start_hour, it must
      -- agree with the server-derived hour. This catches client/server skew
      -- early without making the field load-bearing.
      a_starts_hour := NULL;
      IF nullif(p_payload->>'local_start_hour', '') IS NOT NULL THEN
        BEGIN
          a_starts_hour := nullif(p_payload->>'local_start_hour', '')::int;
        EXCEPTION WHEN OTHERS THEN
          RETURN jsonb_build_object('ok', false, 'error', 'local_start_hour_mismatch');
        END;
      END IF;
      IF a_starts_hour IS NOT NULL AND a_starts_hour <> a_local_hour THEN
        RETURN jsonb_build_object('ok', false, 'error', 'local_start_hour_mismatch');
      END IF;
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

    IF a_chosen_slot_key IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.schedule_share_grants g
        JOIN public.schedule_share_grant_slots s ON s.grant_id = g.id
        JOIN public.user_schedules us
          ON us.user_id = g.subject_user_id
          AND us.slot_date = s.slot_date
          AND us.time_block = s.time_block
        WHERE g.match_id = v_suggestion.match_id
          AND g.viewer_user_id = v_uid
          AND g.subject_user_id = v_rev.proposed_by
          AND g.expires_at > now()
          AND s.slot_date = a_slot_date
          AND s.time_block = a_time_block
          AND us.status = 'open'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'slot_not_in_share_grant');
      END IF;
    END IF;

    INSERT INTO public.date_plans (
      date_suggestion_id, match_id, starts_at, ends_at,
      venue_label, date_type_key, status
    ) VALUES (
      v_suggestion_id,
      v_suggestion.match_id,
      COALESCE(a_starts_ts, v_rev.starts_at),
      -- Schedule-share accept (chosen_slot_key present): ends_at is NULL
      -- because date duration is not part of the commitment. Legacy accept
      -- paths (no chosen_slot_key) keep the revision's ends_at.
      CASE WHEN a_chosen_slot_key IS NOT NULL THEN NULL ELSE v_rev.ends_at END,
      CASE
        WHEN v_rev.place_mode_key IN ('custom_venue', 'custom') THEN v_rev.venue_text
        ELSE v_rev.place_mode_key
      END,
      v_rev.date_type_key,
      'active'
    )
    RETURNING * INTO v_plan;

    IF a_chosen_slot_key IS NOT NULL THEN
      PERFORM public._apply_date_plan_event_lock(v_plan.id, v_suggestion.proposer_id, a_slot_date, a_time_block);
      PERFORM public._apply_date_plan_event_lock(v_plan.id, v_suggestion.recipient_id, a_slot_date, a_time_block);
    END IF;

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

  ELSIF p_action = 'edit_schedule_share_slots' THEN
    -- Same-suggestion edit. Replaces the CALLER's own grant slot set
    -- without creating a new revision and without touching the partner's
    -- separate grant row (partner grant is keyed on subject_user_id = partner).
    --
    -- Authorization invariant (intentionally NOT gated on current revision
    -- authorship — the partner who shared back can still edit their own
    -- selected blocks even after the current revision flipped to the other
    -- side):
    --   * caller is a participant in the match
    --   * suggestion is active (draft/proposed/viewed/countered)
    --   * caller owns an existing schedule_share_grants row attached to
    --     THIS suggestion (subject_user_id = caller AND
    --     source_date_suggestion_id = this suggestion). This is the gate
    --     proving the caller has previously shared on this suggestion.
    --   * submitted selected_slot_keys is non-empty AND every submitted
    --     slot is currently 'open' in the caller's own user_schedules.
    --
    -- Side effects: replaces the caller's grant_slots set atomically via
    -- _date_suggestion_upsert_share_grant (subject=caller). Refreshes the
    -- 48h live window. Does NOT change suggestion.status,
    -- current_revision_id, or expires_at. Does NOT create a new
    -- date_suggestion_revisions row.
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    IF v_payload->'selected_slot_keys' IS NULL THEN
      r_slot_keys := NULL;
    ELSIF jsonb_typeof(v_payload->'selected_slot_keys') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_slot_keys');
    ELSE
      r_slot_keys := ARRAY(SELECT jsonb_array_elements_text(v_payload->'selected_slot_keys'));
    END IF;

    IF r_slot_keys IS NULL OR array_length(r_slot_keys, 1) IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
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

    IF v_suggestion.status NOT IN ('draft', 'proposed', 'viewed', 'countered') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
    END IF;

    v_partner := CASE
      WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id
      ELSE v_suggestion.proposer_id
    END;

    -- Active grant-owner gate: caller must already have a live grant on THIS suggestion.
    -- This permits the original sender AND a partner who shared back to edit
    -- their own selected blocks independently of who authored the current
    -- revision.
    IF NOT EXISTS (
      SELECT 1
      FROM public.schedule_share_grants g
      WHERE g.match_id = v_suggestion.match_id
        AND g.viewer_user_id = v_partner
        AND g.subject_user_id = v_uid
        AND g.source_date_suggestion_id = v_suggestion_id
        AND g.expires_at > now()
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_share_grant_to_edit');
    END IF;

    -- Defense-in-depth: every submitted slot must be currently 'open' in the
    -- caller's own user_schedules. (Format/value validation also happens in
    -- _date_suggestion_upsert_share_grant.) This blocks editing a slot the
    -- caller has marked busy or that is now event-locked.
    IF EXISTS (
      SELECT 1
      FROM unnest(r_slot_keys) AS k(slot_key)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.user_schedules us
        WHERE us.user_id = v_uid
          AND us.slot_key = k.slot_key
          AND us.status = 'open'
      )
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slot_not_open');
    END IF;

    SELECT * INTO v_rev
    FROM public.date_suggestion_revisions
    WHERE id = v_suggestion.current_revision_id;

    -- Atomic replace of THIS actor's grant slot set only.
    -- Partner's grant row (subject_user_id = partner) is a different row and is untouched.
    -- source_revision_id is metadata; we use current revision id when present,
    -- else the existing row's value will be preserved by the upsert's
    -- DO UPDATE clause writing EXCLUDED.source_revision_id (NULL is allowed).
    PERFORM public._date_suggestion_upsert_share_grant(
      v_suggestion.match_id, v_partner, v_uid,
      v_suggestion.id, v_rev.id, r_slot_keys
    );

    UPDATE public.date_suggestions
    SET schedule_share_expires_at = now() + interval '48 hours',
        updated_at = now()
    WHERE id = v_suggestion_id;

    v_notify := jsonb_build_object(
      'kind', 'schedule_share_updated',
      'recipient_id', v_partner,
      'match_id', v_suggestion.match_id,
      'suggestion_id', v_suggestion_id,
      'from_user_id', v_uid
    );

    PERFORM public._date_suggestion_log(
      v_suggestion_id,
      v_uid,
      p_action,
      v_suggestion.status,
      v_suggestion.status,
      true,
      null,
      jsonb_build_object('revision_id', v_rev.id, 'slot_count', array_length(r_slot_keys, 1))
    );

    RETURN jsonb_build_object(
      'ok', true,
      'suggestion_id', v_suggestion_id,
      'status', v_suggestion.status,
      'revision_id', v_rev.id,
      'notify', v_notify
    );
  END IF;

  -- Non-handled actions (cancel, cancel_plan, plan_mark_complete, update_draft):
  -- delegate to v1 which owns the canonical behavior + new lock-revert side effect
  -- (see cancel_plan branch in date_suggestion_apply above).
  IF p_action IS DISTINCT FROM 'send_proposal' THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  -- send_proposal flow: existing suggestion → continue through canonical RPC
  IF v_suggestion_id IS NOT NULL THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

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

COMMIT;
