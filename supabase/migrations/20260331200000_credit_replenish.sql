-- Monthly credit replenish bookkeeping + RPC (called by credit-replenish Edge Function via pg_cron)

ALTER TABLE public.user_credits
ADD COLUMN IF NOT EXISTS last_replenished_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.user_credits.last_replenished_at IS 'Last time monthly subscription credits were applied (idempotent per calendar month).';

CREATE OR REPLACE FUNCTION public.replenish_monthly_credits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now());
  v_premium_grant int := 3;
  v_processed int := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT p.id AS user_id, p.subscription_tier
    FROM profiles p
    WHERE p.subscription_tier IN ('premium', 'vip')
      AND NOT EXISTS (
        SELECT 1 FROM user_credits uc
        WHERE uc.user_id = p.id
          AND uc.last_replenished_at >= v_month_start
      )
  LOOP
    IF rec.subscription_tier = 'vip' THEN
      INSERT INTO user_credits (user_id, extra_time_credits, extended_vibe_credits, last_replenished_at)
      VALUES (rec.user_id, 10, 10, now())
      ON CONFLICT (user_id) DO UPDATE SET
        extra_time_credits = user_credits.extra_time_credits + 10,
        extended_vibe_credits = user_credits.extended_vibe_credits + 10,
        last_replenished_at = now();
    ELSE
      INSERT INTO user_credits (user_id, extra_time_credits, extended_vibe_credits, last_replenished_at)
      VALUES (rec.user_id, v_premium_grant, 0, now())
      ON CONFLICT (user_id) DO UPDATE SET
        extra_time_credits = user_credits.extra_time_credits + v_premium_grant,
        last_replenished_at = now();
    END IF;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'month', v_month_start);
END;
$$;

REVOKE ALL ON FUNCTION public.replenish_monthly_credits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replenish_monthly_credits() TO service_role;
