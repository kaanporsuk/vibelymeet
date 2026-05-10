-- Chat schedule: selective share grants + event-lock for confirmed dates.
-- See plan: /Users/kaanporsuk/.claude/plans/see-attached-the-chat-agile-acorn.md
--
-- This migration:
--   1. Adds schedule_share_grant_slots (per-grant selected open blocks).
--   2. Extends user_schedules.status to allow 'event' and adds source_date_plan_id +
--      prior_status columns. Adds invariant CHECK + partial UNIQUE so each event lock
--      has a tracked owner and one slot can carry at most one active lock.
--   3. Replaces _date_suggestion_upsert_share_grant with a 6-arg version that
--      requires selected_slot_keys and replaces the slot set atomically.
--   4. Updates get_shared_schedule_for_date_planning to filter by selected slots
--      AND require still-open status server-side (privacy stays in the database).
--   5. Adds _block_hour_range / _apply_date_plan_event_lock /
--      _revert_date_plan_event_lock helpers. Apply refuses to overwrite a user-set
--      busy slot (slot_user_busy) or a slot held by another active plan
--      (slot_already_locked). Revert is idempotent and source-tracked.
--   6. Redefines date_suggestion_apply (cancel-idempotent baseline + new accept
--      that locks blocks + new cancel_plan action that reverts locks).
--   7. Redefines date_suggestion_apply_v2 (counter-response-authority baseline +
--      new accept that locks blocks + cancel_plan delegated to v1).
--
-- Idempotency: every CREATE/ALTER uses IF [NOT] EXISTS or CREATE OR REPLACE so
-- the migration is replay-safe.

BEGIN;

-- ============================================================================
-- 1. schedule_share_grant_slots
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.schedule_share_grant_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.schedule_share_grants(id) ON DELETE CASCADE,
  slot_date date NOT NULL,
  time_block text NOT NULL CHECK (time_block IN ('morning', 'afternoon', 'evening', 'night')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_share_grant_slots_unique UNIQUE (grant_id, slot_date, time_block)
);

CREATE INDEX IF NOT EXISTS idx_schedule_share_grant_slots_grant
  ON public.schedule_share_grant_slots(grant_id);

ALTER TABLE public.schedule_share_grant_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Grant participants can view grant slots"
  ON public.schedule_share_grant_slots;

CREATE POLICY "Grant participants can view grant slots"
  ON public.schedule_share_grant_slots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.schedule_share_grants g
      WHERE g.id = schedule_share_grant_slots.grant_id
        AND (g.viewer_user_id = auth.uid() OR g.subject_user_id = auth.uid())
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'schedule_share_grant_slots'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_share_grant_slots';
  END IF;
END $$;

-- ============================================================================
-- 2. user_schedules: 'event' status + source_date_plan_id + prior_status
-- ============================================================================

ALTER TABLE public.user_schedules
  DROP CONSTRAINT IF EXISTS user_schedules_status_check;

ALTER TABLE public.user_schedules
  ADD CONSTRAINT user_schedules_status_check
  CHECK (status IN ('open', 'busy', 'event'));

ALTER TABLE public.user_schedules
  ADD COLUMN IF NOT EXISTS source_date_plan_id uuid NULL
    REFERENCES public.date_plans(id) ON DELETE SET NULL;

ALTER TABLE public.user_schedules
  ADD COLUMN IF NOT EXISTS prior_status text NULL;

ALTER TABLE public.user_schedules
  DROP CONSTRAINT IF EXISTS user_schedules_prior_status_check;

ALTER TABLE public.user_schedules
  ADD CONSTRAINT user_schedules_prior_status_check
  CHECK (prior_status IS NULL OR prior_status IN ('open', 'busy'));

ALTER TABLE public.user_schedules
  DROP CONSTRAINT IF EXISTS user_schedules_event_requires_source;

ALTER TABLE public.user_schedules
  ADD CONSTRAINT user_schedules_event_requires_source
  CHECK (
    (status = 'event' AND source_date_plan_id IS NOT NULL)
    OR (status <> 'event' AND source_date_plan_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS user_schedules_one_event_lock_per_slot
  ON public.user_schedules(user_id, slot_date, time_block)
  WHERE status = 'event';

CREATE INDEX IF NOT EXISTS idx_user_schedules_source_date_plan
  ON public.user_schedules(source_date_plan_id)
  WHERE source_date_plan_id IS NOT NULL;

-- ============================================================================
-- 3. _date_suggestion_upsert_share_grant: requires selected_slot_keys
-- ============================================================================
-- Drop the old 5-arg signature so call sites cannot accidentally use the broad
-- (no-selection) path. New signature requires a non-empty text[] of slot keys.

DROP FUNCTION IF EXISTS public._date_suggestion_upsert_share_grant(uuid, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public._date_suggestion_upsert_share_grant(
  p_match_id uuid,
  p_viewer uuid,
  p_subject uuid,
  p_suggestion_id uuid,
  p_revision_id uuid,
  p_selected_slot_keys text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_grant_id uuid;
  v_key text;
  v_slot_date date;
  v_time_block text;
BEGIN
  IF p_selected_slot_keys IS NULL OR array_length(p_selected_slot_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'selected_slots_required';
  END IF;

  INSERT INTO public.schedule_share_grants (
    match_id, viewer_user_id, subject_user_id,
    source_date_suggestion_id, source_revision_id, expires_at
  ) VALUES (
    p_match_id, p_viewer, p_subject, p_suggestion_id, p_revision_id, now() + interval '48 hours'
  )
  ON CONFLICT (match_id, viewer_user_id, subject_user_id)
  DO UPDATE SET
    expires_at = now() + interval '48 hours',
    source_revision_id = EXCLUDED.source_revision_id,
    source_date_suggestion_id = EXCLUDED.source_date_suggestion_id
  RETURNING id INTO v_grant_id;

  -- Atomically replace the slot set for this grant
  DELETE FROM public.schedule_share_grant_slots WHERE grant_id = v_grant_id;

  FOREACH v_key IN ARRAY p_selected_slot_keys LOOP
    -- slot_key format: YYYY-MM-DD_<block>
    IF length(v_key) < 12 OR substring(v_key from 11 for 1) <> '_' THEN
      RAISE EXCEPTION 'invalid_slot_key' USING DETAIL = v_key;
    END IF;

    v_slot_date := substring(v_key from 1 for 10)::date;
    v_time_block := substring(v_key from 12);

    IF v_time_block NOT IN ('morning', 'afternoon', 'evening', 'night') THEN
      RAISE EXCEPTION 'invalid_slot_key' USING DETAIL = v_key;
    END IF;

    INSERT INTO public.schedule_share_grant_slots (grant_id, slot_date, time_block)
    VALUES (v_grant_id, v_slot_date, v_time_block)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._date_suggestion_upsert_share_grant(uuid, uuid, uuid, uuid, uuid, text[]) FROM PUBLIC;

-- ============================================================================
-- 4. get_shared_schedule_for_date_planning: filter by selected slots + still-open
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_shared_schedule_for_date_planning(
  p_match_id uuid,
  p_subject_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_grant_id uuid;
  v_slots jsonb;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Allow either side to read the grant's visible slots:
  --   - viewer (recipient of the share): the canonical privacy-filtered read
  --   - subject (the user who shared): so the proposer's own card can render
  --     the same currently-visible subset they offered
  SELECT g.id INTO v_grant_id
  FROM public.schedule_share_grants g
  WHERE g.match_id = p_match_id
    AND g.subject_user_id = p_subject_user_id
    AND (g.viewer_user_id = v_viewer OR g.subject_user_id = v_viewer)
    AND g.expires_at > now()
  LIMIT 1;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'grant_required';
  END IF;

  -- Privacy: only return slots that are
  --   (a) explicitly selected for this grant,
  --   (b) currently 'open' (busy/event/unset are filtered server-side),
  --   (c) within the next 14 days.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'slot_key', us.slot_key,
        'slot_date', us.slot_date,
        'time_block', us.time_block,
        'status', us.status
      )
      ORDER BY us.slot_date, us.time_block
    ),
    '[]'::jsonb
  )
  INTO v_slots
  FROM public.user_schedules us
  INNER JOIN public.schedule_share_grant_slots sgs
    ON sgs.grant_id = v_grant_id
    AND sgs.slot_date = us.slot_date
    AND sgs.time_block = us.time_block
  WHERE us.user_id = p_subject_user_id
    AND us.status = 'open'
    AND us.slot_date >= CURRENT_DATE
    AND us.slot_date < CURRENT_DATE + 14;

  RETURN jsonb_build_object('slots', v_slots);
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_schedule_for_date_planning(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_schedule_for_date_planning(uuid, uuid) TO authenticated;

-- ============================================================================
-- 5. Event-lock helpers: _block_hour_range, _apply, _revert
-- ============================================================================

CREATE OR REPLACE FUNCTION public._block_hour_range(p_time_block text)
RETURNS int4range
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_time_block
    WHEN 'morning'   THEN int4range(8, 12)
    WHEN 'afternoon' THEN int4range(12, 17)
    WHEN 'evening'   THEN int4range(17, 21)
    WHEN 'night'     THEN int4range(21, 24)
    ELSE NULL
  END;
$$;

-- _apply_date_plan_event_lock: idempotent on retry, refuses on conflict.
--   - Re-running for the same (plan, user, slot) is a no-op.
--   - If another active plan holds the slot: RAISE slot_already_locked.
--   - If user has marked the slot busy: RAISE slot_user_busy (never overwrite).
--   - status='open': UPDATE to event with prior_status snapshot for revert.
--   - No row: INSERT event lock with prior_status = NULL.
CREATE OR REPLACE FUNCTION public._apply_date_plan_event_lock(
  p_date_plan_id uuid,
  p_user_id uuid,
  p_slot_date date,
  p_time_block text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing public.user_schedules;
  v_slot_key text;
BEGIN
  IF p_time_block NOT IN ('morning', 'afternoon', 'evening', 'night') THEN
    RAISE EXCEPTION 'invalid_time_block' USING DETAIL = p_time_block;
  END IF;

  v_slot_key := to_char(p_slot_date, 'YYYY-MM-DD') || '_' || p_time_block;

  SELECT * INTO v_existing
  FROM public.user_schedules
  WHERE user_id = p_user_id
    AND slot_date = p_slot_date
    AND time_block = p_time_block
  FOR UPDATE;

  IF FOUND THEN
    -- Idempotent retry on the same plan
    IF v_existing.status = 'event' AND v_existing.source_date_plan_id = p_date_plan_id THEN
      RETURN;
    END IF;

    -- Locked by another active plan: refuse double-booking
    IF v_existing.status = 'event' AND v_existing.source_date_plan_id IS DISTINCT FROM p_date_plan_id THEN
      RAISE EXCEPTION 'slot_already_locked'
        USING DETAIL = jsonb_build_object(
          'user_id', p_user_id,
          'slot_date', p_slot_date,
          'time_block', p_time_block,
          'existing_plan_id', v_existing.source_date_plan_id
        )::text;
    END IF;

    -- User-marked busy: never silently overwrite
    IF v_existing.status = 'busy' THEN
      RAISE EXCEPTION 'slot_user_busy'
        USING DETAIL = jsonb_build_object(
          'user_id', p_user_id,
          'slot_date', p_slot_date,
          'time_block', p_time_block
        )::text;
    END IF;

    -- status='open' → snapshot and lock
    UPDATE public.user_schedules
    SET status = 'event',
        source_date_plan_id = p_date_plan_id,
        prior_status = 'open'
    WHERE id = v_existing.id;
  ELSE
    -- No row exists → INSERT a new event lock with prior_status = NULL
    INSERT INTO public.user_schedules (
      user_id, slot_key, slot_date, time_block, status,
      source_date_plan_id, prior_status
    ) VALUES (
      p_user_id, v_slot_key, p_slot_date, p_time_block, 'event',
      p_date_plan_id, NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_date_plan_event_lock(uuid, uuid, date, text) FROM PUBLIC;

-- _revert_date_plan_event_lock: idempotent. Restores prior_status or deletes
-- orphan rows. Safe to call multiple times; re-runs are no-ops.
CREATE OR REPLACE FUNCTION public._revert_date_plan_event_lock(p_date_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Orphan rows (no prior status) → delete to restore the original "unset" state
  DELETE FROM public.user_schedules
  WHERE source_date_plan_id = p_date_plan_id
    AND prior_status IS NULL;

  -- Pre-existing rows → restore original status
  UPDATE public.user_schedules
  SET status = prior_status,
      source_date_plan_id = NULL,
      prior_status = NULL
  WHERE source_date_plan_id = p_date_plan_id
    AND prior_status IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._revert_date_plan_event_lock(uuid) FROM PUBLIC;

-- ============================================================================
-- 6. date_suggestion_apply (v1): cancel-idempotent baseline + new accept that
--    locks blocks + new cancel_plan action that reverts locks. All other
--    branches preserved verbatim from migration 20260328190000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.date_suggestion_apply(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
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
  r_slot_keys text[];
  p_plan_id uuid;
  -- accept payload fields (new)
  a_chosen_slot_key text;
  a_slot_date date;
  a_time_block text;
  a_starts text;
  a_ends text;
  a_starts_ts timestamptz;
  a_ends_ts timestamptz;
  a_block_range int4range;
  a_starts_hour int;
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
    -- NEW: extract selected_slot_keys for share grant
    r_slot_keys := CASE
      WHEN p_payload->'revision'->'selected_slot_keys' IS NULL THEN NULL
      ELSE ARRAY(SELECT jsonb_array_elements_text(p_payload->'revision'->'selected_slot_keys'))
    END;
    IF r_date_type = '' OR r_time_choice = '' OR r_place_mode = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;
    IF r_share AND (r_slot_keys IS NULL OR array_length(r_slot_keys, 1) IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
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
        p_suggestion_id, v_rev.id, r_slot_keys
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
    r_slot_keys := CASE
      WHEN p_payload->'revision'->'selected_slot_keys' IS NULL THEN NULL
      ELSE ARRAY(SELECT jsonb_array_elements_text(p_payload->'revision'->'selected_slot_keys'))
    END;
    IF p_suggestion_id IS NULL OR r_date_type = '' OR r_time_choice = '' OR r_place_mode = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;
    IF r_share AND (r_slot_keys IS NULL OR array_length(r_slot_keys, 1) IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
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
        p_suggestion_id, v_rev.id, r_slot_keys
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
    -- Accept supports two payload shapes:
    --   (a) NEW schedule-share flow: chosen_slot_key + starts_at + ends_at →
    --       parse slot, validate exact-time within block range, INSERT date_plans
    --       with payload times, apply event lock for both users (any conflict
    --       rolls back the entire transaction).
    --   (b) LEGACY flow (no chosen_slot_key): use revision.starts_at/ends_at
    --       directly, no event lock applied (preserves all existing accept paths).
    IF p_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    a_chosen_slot_key := nullif(p_payload->>'chosen_slot_key', '');
    a_starts := nullif(p_payload->>'starts_at', '');
    a_ends := nullif(p_payload->>'ends_at', '');

    IF a_chosen_slot_key IS NOT NULL THEN
      -- New schedule-share flow: validate everything, prepare to lock
      IF a_starts IS NULL OR a_ends IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_required');
      END IF;
      IF length(a_chosen_slot_key) < 12 OR substring(a_chosen_slot_key from 11 for 1) <> '_' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END IF;
      a_slot_date := substring(a_chosen_slot_key from 1 for 10)::date;
      a_time_block := substring(a_chosen_slot_key from 12);
      IF a_time_block NOT IN ('morning', 'afternoon', 'evening', 'night') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END IF;

      a_starts_ts := a_starts::timestamptz;
      a_ends_ts := a_ends::timestamptz;
      IF a_ends_ts <= a_starts_ts THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_invalid_range');
      END IF;

      -- Validate exact hour falls inside the chosen block range. The client
      -- sends `local_start_hour` (0-23) explicitly because EXTRACT HOUR FROM
      -- starts_at after timezone normalization gives the wrong hour for users
      -- outside UTC. The client knows its own wall-clock hour; the server
      -- just enforces the constraint using the integer it sent.
      a_block_range := public._block_hour_range(a_time_block);
      a_starts_hour := nullif(p_payload->>'local_start_hour', '')::int;
      IF a_starts_hour IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'local_start_hour_required');
      END IF;
      IF a_starts_hour NOT BETWEEN lower(a_block_range) AND upper(a_block_range) - 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_outside_block');
      END IF;
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

    -- Server-enforced grant validation for the schedule-share accept path.
    -- The chosen slot MUST come from the offer-author's currently-active
    -- grant_slots set AND must still be 'open' in their schedule. This
    -- prevents a malicious accepter from crafting a stale or made-up
    -- chosen_slot_key and locking both calendars on a slot the offer
    -- author never shared.
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
      p_suggestion_id,
      v_suggestion.match_id,
      COALESCE(a_starts_ts, v_rev.starts_at),
      COALESCE(a_ends_ts, v_rev.ends_at),
      CASE
        WHEN v_rev.place_mode_key IN ('custom_venue', 'custom') THEN v_rev.venue_text
        ELSE v_rev.place_mode_key
      END,
      v_rev.date_type_key,
      'active'
    )
    RETURNING * INTO v_plan;

    -- Event lock: only for the new schedule-share flow (chosen_slot_key present).
    -- Legacy accept paths preserve their existing behavior (no lock).
    -- Either RAISE rolls back the transaction → suggestion stays in prior state.
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
      'recipient_id', v_rev.proposed_by,
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
    -- Cancel-idempotent (preserved from migration 20260328190000).
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

  ELSIF p_action = 'cancel_plan' THEN
    -- NEW: cancel an accepted/confirmed date and revert the event lock.
    -- Either participant may cancel an active plan. Idempotent on already-cancelled.
    p_plan_id := nullif(p_payload->>'plan_id', '')::uuid;
    IF p_plan_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
    END IF;
    SELECT * INTO v_plan FROM public.date_plans WHERE id = p_plan_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    SELECT * INTO v_suggestion FROM public.date_suggestions WHERE id = v_plan.date_suggestion_id FOR UPDATE;
    IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_plan.status = 'cancelled' THEN
      -- Idempotent: already cancelled
      RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id, 'status', 'cancelled', 'notify', null);
    END IF;
    IF v_plan.status <> 'active' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_plan_status');
    END IF;

    UPDATE public.date_plans SET status = 'cancelled' WHERE id = p_plan_id;
    PERFORM public._revert_date_plan_event_lock(p_plan_id);
    UPDATE public.date_suggestions SET status = 'cancelled', updated_at = now()
      WHERE id = v_suggestion.id;

    INSERT INTO public.messages (match_id, sender_id, content, message_kind, ref_id, structured_payload)
    VALUES (
      v_suggestion.match_id,
      v_uid,
      'Date cancelled',
      'date_suggestion_event',
      v_suggestion.id,
      jsonb_build_object('version', 1, 'kind', 'date_plan_cancelled', 'date_suggestion_id', v_suggestion.id, 'date_plan_id', p_plan_id)
    );

    v_partner := CASE WHEN v_uid = v_suggestion.proposer_id THEN v_suggestion.recipient_id ELSE v_suggestion.proposer_id END;
    v_notify := jsonb_build_object(
      'kind', 'plan_cancelled',
      'recipient_id', v_partner,
      'match_id', v_suggestion.match_id,
      'suggestion_id', v_suggestion.id,
      'plan_id', p_plan_id,
      'from_user_id', v_uid
    );
    PERFORM public._date_suggestion_log(v_suggestion.id, v_uid, p_action, 'accepted', 'cancelled', true, null, jsonb_build_object('plan_id', p_plan_id));
    RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id, 'status', 'cancelled', 'notify', v_notify);

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
      -- Lock stays in place for completed dates: the slot is in the past and the
      -- block remains as a historical "this is when we met" marker on both schedules.
    END IF;
    PERFORM public._date_suggestion_log(v_suggestion.id, v_uid, p_action, v_suggestion.status, (SELECT status FROM public.date_suggestions WHERE id = v_suggestion.id), true, null, jsonb_build_object('plan_id', p_plan_id));
    RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id, 'suggestion_status', (SELECT status FROM public.date_suggestions WHERE id = v_suggestion.id));

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
  END IF;
END;
$$;

-- ============================================================================
-- 7. date_suggestion_apply_v2: counter-response-authority baseline + new accept
--    that locks blocks. cancel/cancel_plan delegate to v1 via the trailing
--    fall-through. mark_viewed/counter/decline/not_now preserved verbatim from
--    migration 20260510000000.
-- ============================================================================

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
  r_slot_keys text[];
  -- accept payload (new)
  a_chosen_slot_key text;
  a_slot_date date;
  a_time_block text;
  a_starts text;
  a_ends text;
  a_starts_ts timestamptz;
  a_ends_ts timestamptz;
  a_block_range int4range;
  a_starts_hour int;
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
    -- Same backwards-compatible accept contract as v1: chosen_slot_key is
    -- OPTIONAL. When provided, validate exact-time within block range and
    -- apply the event lock for both users (atomic with date_plans insert,
    -- conflict rolls back). When absent, use revision.starts_at/ends_at and
    -- skip the lock (preserves all existing accept paths).
    IF v_suggestion_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'suggestion_id_required');
    END IF;

    a_chosen_slot_key := nullif(v_payload->>'chosen_slot_key', '');
    a_starts := nullif(v_payload->>'starts_at', '');
    a_ends := nullif(v_payload->>'ends_at', '');

    IF a_chosen_slot_key IS NOT NULL THEN
      IF a_starts IS NULL OR a_ends IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_required');
      END IF;
      IF length(a_chosen_slot_key) < 12 OR substring(a_chosen_slot_key from 11 for 1) <> '_' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END IF;
      a_slot_date := substring(a_chosen_slot_key from 1 for 10)::date;
      a_time_block := substring(a_chosen_slot_key from 12);
      IF a_time_block NOT IN ('morning', 'afternoon', 'evening', 'night') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_slot_key');
      END IF;

      a_starts_ts := a_starts::timestamptz;
      a_ends_ts := a_ends::timestamptz;
      IF a_ends_ts <= a_starts_ts THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_invalid_range');
      END IF;

      -- Validate exact hour falls inside the chosen block range. The client
      -- sends `local_start_hour` (0-23) explicitly because EXTRACT HOUR FROM
      -- starts_at after timezone normalization gives the wrong hour for users
      -- outside UTC. The client knows its own wall-clock hour; the server
      -- just enforces the constraint using the integer it sent.
      a_block_range := public._block_hour_range(a_time_block);
      a_starts_hour := nullif(p_payload->>'local_start_hour', '')::int;
      IF a_starts_hour IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'local_start_hour_required');
      END IF;
      IF a_starts_hour NOT BETWEEN lower(a_block_range) AND upper(a_block_range) - 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'exact_time_outside_block');
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

    -- Server-enforced grant validation for the schedule-share accept path
    -- (mirrors v1). Prevents a malicious accepter from crafting a stale or
    -- made-up chosen_slot_key and locking both calendars on a slot the
    -- offer-author never shared.
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
      COALESCE(a_ends_ts, v_rev.ends_at),
      CASE
        WHEN v_rev.place_mode_key IN ('custom_venue', 'custom') THEN v_rev.venue_text
        ELSE v_rev.place_mode_key
      END,
      v_rev.date_type_key,
      'active'
    )
    RETURNING * INTO v_plan;

    -- Event lock: only for the new schedule-share flow (chosen_slot_key present).
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

REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) TO authenticated;

COMMIT;
