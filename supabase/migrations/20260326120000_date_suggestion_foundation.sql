-- Date Suggestion foundation: entities, constraints, RLS, RPC, schedule-share enforcement, messages contract.

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.date_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  proposer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'proposed', 'viewed', 'countered', 'accepted', 'declined',
    'not_now', 'expired', 'cancelled', 'completed'
  )),
  current_revision_id uuid,
  draft_payload jsonb,
  expires_at timestamptz,
  schedule_share_expires_at timestamptz,
  expiring_soon_sent_at timestamptz,
  date_plan_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT date_suggestions_proposer_recipient_distinct CHECK (proposer_id <> recipient_id)
);

CREATE UNIQUE INDEX date_suggestions_one_open_per_match
  ON public.date_suggestions (match_id)
  WHERE status IN ('draft', 'proposed', 'viewed', 'countered');

CREATE INDEX idx_date_suggestions_match ON public.date_suggestions (match_id);
CREATE INDEX idx_date_suggestions_status_expires ON public.date_suggestions (status, expires_at);

CREATE TABLE public.date_suggestion_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_suggestion_id uuid NOT NULL REFERENCES public.date_suggestions(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  proposed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date_type_key text NOT NULL,
  time_choice_key text NOT NULL,
  place_mode_key text NOT NULL,
  venue_text text,
  optional_message text,
  schedule_share_enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  time_block text CHECK (time_block IS NULL OR time_block IN ('morning', 'afternoon', 'evening', 'night')),
  agreed_field_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date_suggestion_id, revision_number)
);

CREATE INDEX idx_date_suggestion_revisions_suggestion ON public.date_suggestion_revisions (date_suggestion_id);

ALTER TABLE public.date_suggestions
  ADD CONSTRAINT date_suggestions_current_revision_fkey
  FOREIGN KEY (current_revision_id) REFERENCES public.date_suggestion_revisions(id) ON DELETE SET NULL;

CREATE TABLE public.schedule_share_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_date_suggestion_id uuid NOT NULL REFERENCES public.date_suggestions(id) ON DELETE CASCADE,
  source_revision_id uuid REFERENCES public.date_suggestion_revisions(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, viewer_user_id, subject_user_id)
);

CREATE INDEX idx_schedule_share_grants_viewer_subject ON public.schedule_share_grants (viewer_user_id, subject_user_id);
CREATE INDEX idx_schedule_share_grants_expires ON public.schedule_share_grants (expires_at);

CREATE TABLE public.date_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_suggestion_id uuid NOT NULL REFERENCES public.date_suggestions(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_label text,
  date_type_key text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  completion_initiated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completion_initiated_at timestamptz,
  completion_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completion_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (date_suggestion_id)
);

CREATE TABLE public.date_plan_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_plan_id uuid NOT NULL REFERENCES public.date_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  calendar_title text NOT NULL,
  calendar_issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date_plan_id, user_id)
);

CREATE INDEX idx_date_plan_participants_user ON public.date_plan_participants (user_id);

ALTER TABLE public.date_suggestions
  ADD CONSTRAINT date_suggestions_date_plan_fkey
  FOREIGN KEY (date_plan_id) REFERENCES public.date_plans(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2) Messages: typed timeline contract (no raw blob for UI logic)
-- ---------------------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS message_kind text NOT NULL DEFAULT 'text'
    CHECK (message_kind IN ('text', 'date_suggestion', 'date_suggestion_event')),
  ADD COLUMN IF NOT EXISTS structured_payload jsonb,
  ADD COLUMN IF NOT EXISTS ref_id uuid REFERENCES public.date_suggestions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_ref_kind ON public.messages (match_id, message_kind, ref_id)
  WHERE ref_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Observability (no PII in free-text; use ids + statuses)
-- ---------------------------------------------------------------------------

CREATE TABLE public.date_suggestion_transition_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_suggestion_id uuid REFERENCES public.date_suggestions(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  success boolean NOT NULL DEFAULT true,
  error_code text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_date_suggestion_transition_log_suggestion ON public.date_suggestion_transition_log (date_suggestion_id);
CREATE INDEX idx_date_suggestion_transition_log_created ON public.date_suggestion_transition_log (created_at);

-- ---------------------------------------------------------------------------
-- 4) Schedule visibility: replace broad match policy with grant-based access
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Matched users can view each other schedules" ON public.user_schedules;

CREATE POLICY "Match partner can view schedule with active share grant"
ON public.user_schedules
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.schedule_share_grants g
    WHERE g.subject_user_id = user_schedules.user_id
      AND g.viewer_user_id = auth.uid()
      AND g.expires_at > now()
      AND NOT is_blocked(auth.uid(), g.subject_user_id)
  )
);

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.date_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_suggestion_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_share_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_plan_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_suggestion_transition_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "date_suggestions_select_match"
ON public.date_suggestions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = date_suggestions.match_id
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
  )
);

CREATE POLICY "date_suggestion_revisions_select_match"
ON public.date_suggestion_revisions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.date_suggestions ds
    JOIN public.matches m ON m.id = ds.match_id
    WHERE ds.id = date_suggestion_revisions.date_suggestion_id
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
  )
);

CREATE POLICY "schedule_share_grants_select_parties"
ON public.schedule_share_grants FOR SELECT
USING (viewer_user_id = auth.uid() OR subject_user_id = auth.uid());

CREATE POLICY "date_plans_select_match"
ON public.date_plans FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = date_plans.match_id
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
  )
);

CREATE POLICY "date_plan_participants_select_own"
ON public.date_plan_participants FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.date_plans dp
    JOIN public.matches m ON m.id = dp.match_id
    WHERE dp.id = date_plan_participants.date_plan_id
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
  )
);

-- No direct INSERT/UPDATE on these tables for authenticated users — use RPC / Edge only.
-- Service role bypasses RLS for migrations and Edge functions.

-- Transition log: match participants read-only
CREATE POLICY "date_suggestion_transition_log_select_match"
ON public.date_suggestion_transition_log FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.date_suggestions ds
    JOIN public.matches m ON m.id = ds.match_id
    WHERE ds.id = date_suggestion_transition_log.date_suggestion_id
      AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- 6) Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._date_suggestion_core_hash(r public.date_suggestion_revisions)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'date_type_key', r.date_type_key,
    'time_choice_key', r.time_choice_key,
    'place_mode_key', r.place_mode_key,
    'venue_text', r.venue_text,
    'optional_message', r.optional_message,
    'schedule_share_enabled', r.schedule_share_enabled,
    'starts_at', to_char(r.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char(r.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'time_block', r.time_block
  ));
$$;

CREATE OR REPLACE FUNCTION public._date_suggestion_compute_agreed(
  prev_row public.date_suggestion_revisions,
  new_date_type text,
  new_time_choice text,
  new_place_mode text,
  new_venue text,
  new_optional text,
  new_share boolean,
  new_starts timestamptz,
  new_ends timestamptz,
  new_block text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  prev jsonb;
  neu jsonb;
BEGIN
  prev := public._date_suggestion_core_hash(prev_row);
  neu := jsonb_strip_nulls(jsonb_build_object(
    'date_type_key', new_date_type,
    'time_choice_key', new_time_choice,
    'place_mode_key', new_place_mode,
    'venue_text', new_venue,
    'optional_message', new_optional,
    'schedule_share_enabled', new_share,
    'starts_at', to_char(new_starts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char(new_ends AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'time_block', new_block
  ));
  RETURN jsonb_build_object(
    'date_type', (prev->>'date_type_key') IS NOT DISTINCT FROM (neu->>'date_type_key'),
    'time', prev->'starts_at' IS NOT DISTINCT FROM neu->'starts_at'
      AND prev->'ends_at' IS NOT DISTINCT FROM neu->'ends_at'
      AND prev->>'time_choice_key' IS NOT DISTINCT FROM (neu->>'time_choice_key')
      AND prev->>'time_block' IS NOT DISTINCT FROM (neu->>'time_block'),
    'schedule_share', (prev->>'schedule_share_enabled')::boolean IS NOT DISTINCT FROM new_share,
    'place', (prev->>'place_mode_key') IS NOT DISTINCT FROM (neu->>'place_mode_key')
      AND (prev->>'venue_text') IS NOT DISTINCT FROM (neu->>'venue_text'),
    'optional_message', (prev->>'optional_message') IS NOT DISTINCT FROM (neu->>'optional_message')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._date_suggestion_log(
  p_suggestion_id uuid,
  p_actor uuid,
  p_action text,
  p_from text,
  p_to text,
  p_ok boolean,
  p_err text,
  p_payload jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.date_suggestion_transition_log (
    date_suggestion_id, actor_id, action, from_status, to_status, success, error_code, payload
  ) VALUES (
    p_suggestion_id, p_actor, p_action, p_from, p_to, p_ok, p_err,
    jsonb_strip_nulls(coalesce(p_payload, '{}'::jsonb))
  );
$$;

CREATE OR REPLACE FUNCTION public._date_suggestion_partner_first_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(split_part(trim(COALESCE((SELECT name FROM public.profiles WHERE id = p_user_id), '')), ' ', 1), ''),
    'Match'
  );
$$;

CREATE OR REPLACE FUNCTION public._date_suggestion_upsert_share_grant(
  p_match_id uuid,
  p_viewer uuid,
  p_subject uuid,
  p_suggestion_id uuid,
  p_revision_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.schedule_share_grants (
    match_id, viewer_user_id, subject_user_id, source_date_suggestion_id, source_revision_id, expires_at
  ) VALUES (
    p_match_id, p_viewer, p_subject, p_suggestion_id, p_revision_id, now() + interval '48 hours'
  )
  ON CONFLICT (match_id, viewer_user_id, subject_user_id)
  DO UPDATE SET
    expires_at = now() + interval '48 hours',
    source_revision_id = EXCLUDED.source_revision_id,
    source_date_suggestion_id = EXCLUDED.source_date_suggestion_id;
END;
$$;

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
    IF v_suggestion.proposer_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
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

REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shared_schedule_for_date_planning(p_match_id uuid, p_subject_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_ok boolean;
  v_slots jsonb;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.schedule_share_grants g
    WHERE g.match_id = p_match_id
      AND g.viewer_user_id = v_viewer
      AND g.subject_user_id = p_subject_user_id
      AND g.expires_at > now()
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'grant_required';
  END IF;
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
  WHERE us.user_id = p_subject_user_id
    AND us.slot_date >= CURRENT_DATE
    AND us.slot_date < CURRENT_DATE + 14;
  RETURN jsonb_build_object('slots', v_slots);
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_schedule_for_date_planning(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_schedule_for_date_planning(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.date_suggestions IS 'First-class date negotiation entity; transitions via date_suggestion_apply / Edge cron.';
COMMENT ON COLUMN public.messages.message_kind IS 'text | date_suggestion | date_suggestion_event; ref_id points at date_suggestions when applicable.';

ALTER PUBLICATION supabase_realtime ADD TABLE public.date_suggestions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.date_suggestion_revisions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.date_plans;
