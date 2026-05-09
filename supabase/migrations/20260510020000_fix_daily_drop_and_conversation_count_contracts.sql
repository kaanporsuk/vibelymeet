-- Patch outstanding Codex follow-up contract mismatches:
-- 1) Conversation capacity checks must honor per-user archival rows from match_archives.
-- 2) Daily-drop recovery should not reapply cooldowns once a pair already has a cooldown row.

-- 1) _user_active_conversation_count_unchecked:
--    Count active conversations per viewer by excluding only that viewer's archive row.
CREATE OR REPLACE FUNCTION public._user_active_conversation_count_unchecked(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::integer
  FROM public.matches m
  WHERE (m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.match_archives ma
      WHERE ma.match_id = m.id
        AND ma.user_id = p_user_id
    )
$$;

COMMENT ON FUNCTION public._user_active_conversation_count_unchecked(uuid) IS
  'Counts active matches for a user excluding matches they have archived in match_archives.';

-- 2) select_pending_cooldown_pairs:
--    Return only expired/passed drops that have never had a cooldown row created.
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
    AND c.user_a_id IS NULL;
$$;

COMMENT ON FUNCTION public.select_pending_cooldown_pairs() IS
  'Returns expired/passed daily_drops pairs that have never received a cooldown row.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260510020000',
  'Fix active conversation counting and cooldown pair recovery',
  'schema-only',
  'Aligns _user_active_conversation_count_unchecked with per-user archive state and updates select_pending_cooldown_pairs to avoid reapplying cooldowns for pairs already present in daily_drop_cooldowns.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
