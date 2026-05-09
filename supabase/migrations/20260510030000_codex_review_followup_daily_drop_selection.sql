-- Codex review follow-up: make Daily Drop cooldown recovery one-shot per pair window.
--
-- The cooldown row is the pair-level processing watermark. A terminal drop on or
-- before the stored cooldown_until has already been cooled down; only terminal
-- drops created after that watermark should renew cooldown once the old window
-- has expired.

CREATE OR REPLACE FUNCTION public.select_pending_cooldown_pairs()
RETURNS TABLE (
  user_a_id uuid,
  user_b_id uuid,
  drop_status text,
  expired_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    LEAST(d.user_a_id, d.user_b_id) AS user_a_id,
    GREATEST(d.user_a_id, d.user_b_id) AS user_b_id,
    d.status::text AS drop_status,
    d.expires_at AS expired_at
  FROM public.daily_drops d
  LEFT JOIN public.daily_drop_cooldowns c
    ON c.user_a_id = LEAST(d.user_a_id, d.user_b_id)
   AND c.user_b_id = GREATEST(d.user_a_id, d.user_b_id)
  WHERE d.status IN ('expired_no_action', 'expired_no_reply', 'passed')
    AND (
      c.user_a_id IS NULL
      OR d.drop_date > c.cooldown_until
    );
$$;

REVOKE ALL ON FUNCTION public.select_pending_cooldown_pairs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_pending_cooldown_pairs() TO service_role;

COMMENT ON FUNCTION public.select_pending_cooldown_pairs() IS
  'Returns terminal daily_drops whose pair has not already been cooled down for that drop_date window.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260510030000',
  'Daily Drop cooldown recovery watermark follow-up',
  'schema-only',
  'Replaces select_pending_cooldown_pairs so expired cooldown rows do not repeatedly renew historical terminal drops; new terminal drops after an expired cooldown still renew normally. No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
