-- At most one ringing or active match_calls row per match_id (DB guard; daily-room keeps prechecks).
-- Preflight: legacy duplicates are resolved by keeping the newest row (by created_at, id) and
-- terminalizing older open rows so CREATE UNIQUE INDEX can succeed.

WITH ranked AS (
  SELECT
    id,
    status,
    ROW_NUMBER() OVER (
      PARTITION BY match_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.match_calls
  WHERE status IN ('ringing', 'active')
),
to_close AS (
  SELECT id, status FROM ranked WHERE rn > 1
)
UPDATE public.match_calls mc
SET
  status = CASE
    WHEN tc.status = 'ringing' THEN 'missed'
    ELSE 'ended'
  END,
  ended_at = now(),
  duration_seconds = CASE
    WHEN tc.status = 'active' AND mc.started_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - mc.started_at)))::integer)
    ELSE NULL
  END
FROM to_close tc
WHERE mc.id = tc.id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_calls_match_id_open
  ON public.match_calls (match_id)
  WHERE (status IN ('ringing', 'active'));

COMMENT ON INDEX public.uniq_match_calls_match_id_open IS
  'Ensures at most one ringing or active call per match; terminal rows may repeat per match_id.';
