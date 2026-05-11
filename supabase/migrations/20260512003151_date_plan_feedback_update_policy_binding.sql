-- Keep date_plan_feedback UPDATE subject binding aligned with INSERT.
--
-- This is a follow-up migration because
-- 20260512003000_confirmed_date_lifecycle_polish.sql has already been applied
-- to the linked Supabase cloud project.

BEGIN;

DROP POLICY IF EXISTS "date_plan_feedback_update_reviewer_only"
  ON public.date_plan_feedback;

CREATE POLICY "date_plan_feedback_update_reviewer_only"
  ON public.date_plan_feedback
  FOR UPDATE
  USING (reviewer_user_id = auth.uid())
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_user_id <> subject_user_id
    -- Defense-in-depth: same partner binding as INSERT (prevents REST PATCH
    -- from rewriting subject_user_id to a non-match third party).
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

COMMIT;
