-- Follow-up to Codex review comments on the latest eight PRs.
--
-- Dashboard matches must exclude per-user archived conversations before
-- applying the visible-card limit, otherwise archived recent matches can hide
-- older visible matches from the Home dashboard.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dashboard_visible_matches(p_limit integer DEFAULT 5)
RETURNS TABLE(
  id uuid,
  matched_at timestamp with time zone,
  profile_id_1 uuid,
  profile_id_2 uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH viewer AS (
    SELECT auth.uid() AS user_id
  )
  SELECT
    mt.id,
    mt.matched_at,
    mt.profile_id_1,
    mt.profile_id_2
  FROM viewer
  JOIN public.matches mt
    ON viewer.user_id IS NOT NULL
   AND (mt.profile_id_1 = viewer.user_id OR mt.profile_id_2 = viewer.user_id)
   AND NOT public.is_blocked(mt.profile_id_1, mt.profile_id_2)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.match_archives archive
    WHERE archive.match_id = mt.id
      AND archive.user_id = viewer.user_id
  )
  ORDER BY mt.matched_at DESC
  LIMIT greatest(0, least(coalesce(p_limit, 5), 20));
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_visible_matches(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_visible_matches(integer) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_visible_matches(integer) IS
  'Returns the current user dashboard matches after excluding archived conversations, with the limit applied last.';

COMMIT;
