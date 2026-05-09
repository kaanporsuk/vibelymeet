-- Daily Drop cooldown + expire helper RPCs.
--
-- Migration class: schema (functions + indexes), no data rewrite.
-- Replaces JS-side multi-statement work in generate-daily-drops:
--   * apply_drop_cooldown: idempotent upsert that preserves the stricter
--     cooldown_until (avoids loose 7d 'no_action' overwriting tight 30d 'passed').
--   * expire_pending_daily_drops: single-statement CASE expire so the two
--     UPDATE rounds in generate-daily-drops can be replaced with one atomic call.
--   * select_pending_cooldown_pairs: surfaces all expired/passed drops that
--     have no active cooldown row yet, recovering pairs older than yesterday
--     when the cron has been down.

-- ----------------------------------------------------------------------------
-- 1. apply_drop_cooldown(user_a, user_b, until, reason) - keep-stricter upsert
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_drop_cooldown(
  p_user_a uuid,
  p_user_b uuid,
  p_cooldown_until date,
  p_reason text
)
RETURNS public.daily_drop_cooldowns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_lo uuid;
  v_hi uuid;
  v_row public.daily_drop_cooldowns%ROWTYPE;
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL THEN
    RAISE EXCEPTION 'apply_drop_cooldown requires both user ids';
  END IF;
  IF p_user_a = p_user_b THEN
    RAISE EXCEPTION 'apply_drop_cooldown requires distinct user ids';
  END IF;
  IF p_cooldown_until IS NULL THEN
    RAISE EXCEPTION 'apply_drop_cooldown requires p_cooldown_until';
  END IF;

  IF p_user_a < p_user_b THEN
    v_lo := p_user_a; v_hi := p_user_b;
  ELSE
    v_lo := p_user_b; v_hi := p_user_a;
  END IF;

  INSERT INTO public.daily_drop_cooldowns (user_a_id, user_b_id, cooldown_until, reason)
  VALUES (v_lo, v_hi, p_cooldown_until, p_reason)
  ON CONFLICT (user_a_id, user_b_id) DO UPDATE
    SET cooldown_until = GREATEST(daily_drop_cooldowns.cooldown_until, EXCLUDED.cooldown_until),
        reason         = CASE
          WHEN EXCLUDED.cooldown_until > daily_drop_cooldowns.cooldown_until
            THEN EXCLUDED.reason
          ELSE daily_drop_cooldowns.reason
        END
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_drop_cooldown(uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_drop_cooldown(uuid, uuid, date, text) TO service_role;

COMMENT ON FUNCTION public.apply_drop_cooldown(uuid, uuid, date, text) IS
  'Idempotent cooldown upsert with canonical (LEAST,GREATEST) ordering. Preserves stricter cooldown_until when a row already exists.';

-- ----------------------------------------------------------------------------
-- 2. expire_pending_daily_drops() - single-statement CASE expire
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_pending_daily_drops()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_now timestamptz := now();
  v_no_action integer := 0;
  v_no_reply  integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.daily_drops
    SET status = CASE
        WHEN status = 'active_opener_sent' THEN 'expired_no_reply'
        ELSE 'expired_no_action'
      END,
      updated_at = v_now
    WHERE expires_at < v_now
      AND status IN ('active_unopened', 'active_viewed', 'active_opener_sent')
    RETURNING status
  )
  SELECT
    COALESCE(SUM(CASE WHEN status = 'expired_no_action' THEN 1 ELSE 0 END), 0)::integer,
    COALESCE(SUM(CASE WHEN status = 'expired_no_reply'  THEN 1 ELSE 0 END), 0)::integer
  INTO v_no_action, v_no_reply
  FROM expired;

  RETURN jsonb_build_object(
    'expired_no_action', v_no_action,
    'expired_no_reply', v_no_reply,
    'now', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_pending_daily_drops() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_pending_daily_drops() TO service_role;

COMMENT ON FUNCTION public.expire_pending_daily_drops() IS
  'Single-statement CASE expire of past-due active daily_drops. Returns counts of newly-expired rows by status.';

-- ----------------------------------------------------------------------------
-- 3. select_pending_cooldown_pairs() - recovery for cron downtime gaps
-- ----------------------------------------------------------------------------
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
AS $function$
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
      c.cooldown_until IS NULL
      OR c.cooldown_until < (now() AT TIME ZONE 'UTC')::date
    );
$function$;

REVOKE ALL ON FUNCTION public.select_pending_cooldown_pairs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_pending_cooldown_pairs() TO service_role;

COMMENT ON FUNCTION public.select_pending_cooldown_pairs() IS
  'Returns expired/passed daily_drops pairs that do not have an active cooldown yet. Used by generate-daily-drops to recover after cron downtime so cooldowns are still applied.';

-- ----------------------------------------------------------------------------
-- 4. Index to accelerate the recovery query
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_daily_drops_status_expires_at
  ON public.daily_drops(status, expires_at);

-- ----------------------------------------------------------------------------
-- 5. Manifest entry
-- ----------------------------------------------------------------------------
INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260509220000',
  'Daily Drop cooldown + expire RPCs',
  'schema-only',
  'Adds apply_drop_cooldown (keep-stricter upsert), expire_pending_daily_drops (single CASE expire), and select_pending_cooldown_pairs (recovery). Indexes daily_drops(status, expires_at). No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
