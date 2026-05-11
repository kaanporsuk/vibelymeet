-- Confirmed physical-date lifecycle polish.
--
-- Scope:
--   * Per-user completion confirmations for accepted physical date_plans.
--   * Private physical-date feedback storage (separate from video-session date_feedback).
--   * Dedicated RPCs for date-plan completion + feedback submission/status.
--   * Defensive trigger preventing early completion writes to date_plans.
--
-- Non-scope:
--   * Does NOT touch public.date_feedback (Vibely Video post-date survey).
--   * Does NOT alter schedule-share Accept/Edit behavior.
--   * Does NOT add realtime publication tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Per-user completion confirmations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.date_plan_completion_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_plan_id uuid NOT NULL REFERENCES public.date_plans(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marked_complete_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date_plan_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_date_plan_completion_confirmations_plan
  ON public.date_plan_completion_confirmations (date_plan_id);
CREATE INDEX IF NOT EXISTS idx_date_plan_completion_confirmations_user
  ON public.date_plan_completion_confirmations (user_id, marked_complete_at DESC);
CREATE INDEX IF NOT EXISTS idx_date_plan_completion_confirmations_match
  ON public.date_plan_completion_confirmations (match_id);

ALTER TABLE public.date_plan_completion_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "date_plan_completion_confirmations_select_own_or_admin"
  ON public.date_plan_completion_confirmations;
CREATE POLICY "date_plan_completion_confirmations_select_own_or_admin"
  ON public.date_plan_completion_confirmations
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

DROP POLICY IF EXISTS "date_plan_completion_confirmations_insert_own_participant"
  ON public.date_plan_completion_confirmations;
CREATE POLICY "date_plan_completion_confirmations_insert_own_participant"
  ON public.date_plan_completion_confirmations
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.date_plans dp
      JOIN public.date_suggestions ds ON ds.id = dp.date_suggestion_id
      WHERE dp.id = date_plan_completion_confirmations.date_plan_id
        AND dp.match_id = date_plan_completion_confirmations.match_id
        AND (ds.proposer_id = auth.uid() OR ds.recipient_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Private physical-date feedback (separate from public.date_feedback)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.date_plan_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_plan_id uuid NOT NULL REFERENCES public.date_plans(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  did_meet text NOT NULL CHECK (did_meet IN ('yes', 'no')),
  felt_safe text NOT NULL CHECK (felt_safe IN ('yes', 'not_really', 'report')),
  would_meet_again text CHECK (would_meet_again IS NULL OR would_meet_again IN ('yes', 'maybe', 'no')),
  profile_accurate text CHECK (profile_accurate IS NULL OR profile_accurate IN ('yes', 'somewhat', 'no')),
  free_text text,
  report_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date_plan_id, reviewer_user_id),
  CONSTRAINT date_plan_feedback_distinct_users CHECK (reviewer_user_id <> subject_user_id)
);

CREATE INDEX IF NOT EXISTS idx_date_plan_feedback_reviewer_created
  ON public.date_plan_feedback (reviewer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_date_plan_feedback_subject_created
  ON public.date_plan_feedback (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_date_plan_feedback_plan
  ON public.date_plan_feedback (date_plan_id);
CREATE INDEX IF NOT EXISTS idx_date_plan_feedback_match
  ON public.date_plan_feedback (match_id);
CREATE INDEX IF NOT EXISTS idx_date_plan_feedback_report_requested_created
  ON public.date_plan_feedback (report_requested, created_at DESC);

DROP TRIGGER IF EXISTS trg_date_plan_feedback_updated_at ON public.date_plan_feedback;
CREATE TRIGGER trg_date_plan_feedback_updated_at
  BEFORE UPDATE ON public.date_plan_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.date_plan_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "date_plan_feedback_select_reviewer_or_admin"
  ON public.date_plan_feedback;
CREATE POLICY "date_plan_feedback_select_reviewer_or_admin"
  ON public.date_plan_feedback
  FOR SELECT
  USING (
    reviewer_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

DROP POLICY IF EXISTS "date_plan_feedback_insert_reviewer_only"
  ON public.date_plan_feedback;
CREATE POLICY "date_plan_feedback_insert_reviewer_only"
  ON public.date_plan_feedback
  FOR INSERT
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_user_id <> subject_user_id
    AND EXISTS (
      SELECT 1
      FROM public.date_plans dp
      JOIN public.date_suggestions ds ON ds.id = dp.date_suggestion_id
      WHERE dp.id = date_plan_feedback.date_plan_id
        AND dp.match_id = date_plan_feedback.match_id
        AND (
          (ds.proposer_id = reviewer_user_id AND ds.recipient_id = subject_user_id)
          OR (ds.recipient_id = reviewer_user_id AND ds.proposer_id = subject_user_id)
        )
    )
  );

DROP POLICY IF EXISTS "date_plan_feedback_update_reviewer_only"
  ON public.date_plan_feedback;
CREATE POLICY "date_plan_feedback_update_reviewer_only"
  ON public.date_plan_feedback
  FOR UPDATE
  USING (reviewer_user_id = auth.uid())
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_user_id <> subject_user_id
  );

-- ---------------------------------------------------------------------------
-- 3. Defensive guard: no date_plan completion before starts_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._date_plan_prevent_early_completion_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF (
    (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
    OR (OLD.completion_initiated_by IS DISTINCT FROM NEW.completion_initiated_by)
    OR (OLD.completion_confirmed_by IS DISTINCT FROM NEW.completion_confirmed_by)
    OR (OLD.completion_confirmed_at IS DISTINCT FROM NEW.completion_confirmed_at)
  )
  AND (NEW.starts_at IS NULL OR now() < NEW.starts_at) THEN
    RAISE EXCEPTION 'date_not_started';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_date_plan_prevent_early_completion_update
  ON public.date_plans;
CREATE TRIGGER trg_date_plan_prevent_early_completion_update
  BEFORE UPDATE ON public.date_plans
  FOR EACH ROW
  EXECUTE FUNCTION public._date_plan_prevent_early_completion_update();

-- ---------------------------------------------------------------------------
-- 4. Dedicated backend completion RPC used by date-suggestion-actions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.date_plan_mark_complete_v2(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.date_plans;
  v_suggestion public.date_suggestions;
  v_confirmation_count int := 0;
  v_expected_count int := 2;
  v_waiting_for uuid;
  v_first_user uuid;
  v_first_at timestamptz;
  v_latest_user uuid;
  v_latest_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF p_plan_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
  END IF;

  SELECT * INTO v_plan
  FROM public.date_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_suggestion
  FROM public.date_suggestions
  WHERE id = v_plan.date_suggestion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'suggestion_not_found');
  END IF;

  IF v_suggestion.proposer_id <> v_uid AND v_suggestion.recipient_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_plan.status = 'cancelled' OR v_suggestion.status NOT IN ('accepted', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_plan_status');
  END IF;

  IF v_plan.starts_at IS NULL OR now() < v_plan.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'date_not_started');
  END IF;

  INSERT INTO public.date_plan_completion_confirmations (
    date_plan_id, match_id, user_id, marked_complete_at
  )
  VALUES (v_plan.id, v_plan.match_id, v_uid, now())
  ON CONFLICT (date_plan_id, user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_expected_count
  FROM public.date_plan_participants
  WHERE date_plan_id = v_plan.id;

  IF COALESCE(v_expected_count, 0) < 2 THEN
    v_expected_count := 2;
  END IF;

  SELECT COUNT(*) INTO v_confirmation_count
  FROM public.date_plan_completion_confirmations
  WHERE date_plan_id = v_plan.id;

  SELECT c.user_id, c.marked_complete_at
  INTO v_first_user, v_first_at
  FROM public.date_plan_completion_confirmations c
  WHERE c.date_plan_id = v_plan.id
  ORDER BY c.marked_complete_at ASC, c.created_at ASC
  LIMIT 1;

  SELECT c.user_id, c.marked_complete_at
  INTO v_latest_user, v_latest_at
  FROM public.date_plan_completion_confirmations c
  WHERE c.date_plan_id = v_plan.id
  ORDER BY c.marked_complete_at DESC, c.created_at DESC
  LIMIT 1;

  IF v_confirmation_count >= v_expected_count THEN
    UPDATE public.date_plans
    SET
      status = 'completed',
      completion_initiated_by = COALESCE(completion_initiated_by, v_first_user),
      completion_initiated_at = COALESCE(completion_initiated_at, v_first_at),
      completion_confirmed_by = COALESCE(completion_confirmed_by, v_latest_user),
      completion_confirmed_at = COALESCE(completion_confirmed_at, v_latest_at, now())
    WHERE id = v_plan.id;

    UPDATE public.date_suggestions
    SET status = 'completed', updated_at = now()
    WHERE id = v_suggestion.id;

    PERFORM public._date_suggestion_log(
      v_suggestion.id,
      v_uid,
      'plan_mark_complete',
      v_suggestion.status,
      'completed',
      true,
      null,
      jsonb_build_object('plan_id', v_plan.id, 'completion_state', 'mutually_completed')
    );

    RETURN jsonb_build_object(
      'ok', true,
      'plan_id', v_plan.id,
      'suggestion_id', v_suggestion.id,
      'suggestion_status', 'completed',
      'completion_state', 'mutually_completed',
      'waiting_for_user_id', null
    );
  END IF;

  UPDATE public.date_plans
  SET
    completion_initiated_by = COALESCE(completion_initiated_by, v_uid),
    completion_initiated_at = COALESCE(completion_initiated_at, now())
  WHERE id = v_plan.id;

  SELECT participant_id INTO v_waiting_for
  FROM (
    VALUES (v_suggestion.proposer_id), (v_suggestion.recipient_id)
  ) AS participants(participant_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.date_plan_completion_confirmations c
    WHERE c.date_plan_id = v_plan.id
      AND c.user_id = participants.participant_id
  )
  LIMIT 1;

  PERFORM public._date_suggestion_log(
    v_suggestion.id,
    v_uid,
    'plan_mark_complete',
    v_suggestion.status,
    v_suggestion.status,
    true,
    null,
    jsonb_build_object('plan_id', v_plan.id, 'completion_state', 'self_marked', 'waiting_for_user_id', v_waiting_for)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'plan_id', v_plan.id,
    'suggestion_id', v_suggestion.id,
    'suggestion_status', v_suggestion.status,
    'completion_state', 'self_marked',
    'waiting_for_user_id', v_waiting_for
  );
END;
$$;

REVOKE ALL ON FUNCTION public.date_plan_mark_complete_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.date_plan_mark_complete_v2(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Private physical-date feedback RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_date_plan_feedback(
  p_plan_id uuid,
  p_did_meet text,
  p_felt_safe text,
  p_would_meet_again text DEFAULT NULL,
  p_profile_accurate text DEFAULT NULL,
  p_free_text text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.date_plans;
  v_suggestion public.date_suggestions;
  v_subject uuid;
  v_free_text text;
  v_report_requested boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF p_plan_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
  END IF;

  IF p_did_meet NOT IN ('yes', 'no') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_did_meet');
  END IF;

  IF p_felt_safe NOT IN ('yes', 'not_really', 'report') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_felt_safe');
  END IF;

  p_would_meet_again := NULLIF(p_would_meet_again, '');
  IF p_would_meet_again IS NOT NULL AND p_would_meet_again NOT IN ('yes', 'maybe', 'no') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_would_meet_again');
  END IF;

  p_profile_accurate := NULLIF(p_profile_accurate, '');
  IF p_profile_accurate IS NOT NULL AND p_profile_accurate NOT IN ('yes', 'somewhat', 'no') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_profile_accurate');
  END IF;

  SELECT * INTO v_plan
  FROM public.date_plans
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_suggestion
  FROM public.date_suggestions
  WHERE id = v_plan.date_suggestion_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'suggestion_not_found');
  END IF;

  IF v_suggestion.proposer_id = v_uid THEN
    v_subject := v_suggestion.recipient_id;
  ELSIF v_suggestion.recipient_id = v_uid THEN
    v_subject := v_suggestion.proposer_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.date_plan_completion_confirmations c
    WHERE c.date_plan_id = v_plan.id
      AND c.user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'completion_required');
  END IF;

  v_free_text := NULLIF(left(trim(COALESCE(p_free_text, '')), 2000), '');
  v_report_requested := p_felt_safe = 'report';

  INSERT INTO public.date_plan_feedback (
    date_plan_id,
    match_id,
    reviewer_user_id,
    subject_user_id,
    did_meet,
    felt_safe,
    would_meet_again,
    profile_accurate,
    free_text,
    report_requested
  )
  VALUES (
    v_plan.id,
    v_plan.match_id,
    v_uid,
    v_subject,
    p_did_meet,
    p_felt_safe,
    p_would_meet_again,
    p_profile_accurate,
    v_free_text,
    v_report_requested
  )
  ON CONFLICT (date_plan_id, reviewer_user_id)
  DO UPDATE SET
    did_meet = EXCLUDED.did_meet,
    felt_safe = EXCLUDED.felt_safe,
    would_meet_again = EXCLUDED.would_meet_again,
    profile_accurate = EXCLUDED.profile_accurate,
    free_text = EXCLUDED.free_text,
    report_requested = EXCLUDED.report_requested,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'date_plan_id', v_plan.id,
    'report_requested', v_report_requested
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_date_plan_feedback(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_date_plan_feedback(uuid, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_date_plan_feedback_status(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_feedback public.date_plan_feedback;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF p_plan_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
  END IF;

  SELECT * INTO v_feedback
  FROM public.date_plan_feedback
  WHERE date_plan_id = p_plan_id
    AND reviewer_user_id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'submitted', FOUND,
    'report_requested', COALESCE(v_feedback.report_requested, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_date_plan_feedback_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_date_plan_feedback_status(uuid) TO authenticated;

COMMENT ON TABLE public.date_plan_feedback IS
  'Private physical scheduled-date feedback. Separate from public.date_feedback, which is reserved for Vibely Video session feedback.';

COMMENT ON TABLE public.date_plan_completion_confirmations IS
  'Per-user attendance confirmations for accepted physical date plans; mutual completion occurs only after both participants confirm.';

COMMIT;
