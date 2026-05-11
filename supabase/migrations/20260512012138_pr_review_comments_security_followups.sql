-- Follow-up to unresolved Codex/Copilot review comments on PRs 843 and 845.
--
-- Keep the public physical-date write surface RPC-only:
--   * date_plan_mark_complete_v2 handles completion confirmations.
--   * submit_date_plan_feedback handles private feedback writes.
--   * date_suggestion_apply_v2 remains the direct date-suggestion RPC.

BEGIN;

-- The legacy v1 wrapper delegates non-completion actions to preserved legacy
-- behavior, so keep it unavailable to authenticated clients.
REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.date_suggestion_apply(text, jsonb) IS
  'Internal legacy date suggestion write RPC wrapper. plan_mark_complete is routed to date_plan_mark_complete_v2; authenticated clients must use date_suggestion_apply_v2 or the Edge write surface.';

-- Direct table writes can bypass the RPC status/relationship checks. The
-- SECURITY DEFINER RPCs above still write these tables as the server-owned path.
DROP POLICY IF EXISTS "date_plan_completion_confirmations_insert_own_participant"
  ON public.date_plan_completion_confirmations;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.date_plan_completion_confirmations
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "date_plan_feedback_insert_reviewer_only"
  ON public.date_plan_feedback;

DROP POLICY IF EXISTS "date_plan_feedback_update_reviewer_only"
  ON public.date_plan_feedback;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.date_plan_feedback
  FROM PUBLIC, anon, authenticated;

-- Include completion_initiated_at in the early-completion guard so every
-- completion timestamp/write path is blocked until starts_at has passed.
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
    OR (OLD.completion_initiated_at IS DISTINCT FROM NEW.completion_initiated_at)
    OR (OLD.completion_confirmed_by IS DISTINCT FROM NEW.completion_confirmed_by)
    OR (OLD.completion_confirmed_at IS DISTINCT FROM NEW.completion_confirmed_at)
  )
  AND (NEW.starts_at IS NULL OR now() < NEW.starts_at) THEN
    RAISE EXCEPTION 'date_not_started';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
