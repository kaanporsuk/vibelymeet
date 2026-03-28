-- Fix: sync trigger must set subscription_tier alongside is_premium.
-- When a subscription row changes, derive the tier from the plan column
-- and merge with admin grant state.

CREATE OR REPLACE FUNCTION public.sync_profiles_is_premium_from_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_has_active_sub boolean;
  v_sub_tier text;
  v_until timestamptz;
  v_is_premium boolean;
  v_final_tier text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;

  -- Check for any active subscription
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = v_user_id
      AND status IN ('active', 'trialing')
  ) INTO v_has_active_sub;

  -- Determine tier from the active subscription's plan
  -- Convention: plan containing 'vip' = vip tier, otherwise premium
  SELECT CASE
    WHEN s.plan ILIKE '%vip%' THEN 'vip'
    ELSE 'premium'
  END INTO v_sub_tier
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
    AND s.status IN ('active', 'trialing')
  ORDER BY
    CASE WHEN s.plan ILIKE '%vip%' THEN 0 ELSE 1 END  -- prefer VIP if multiple
  LIMIT 1;

  -- Check admin-granted premium window
  SELECT p.premium_until INTO v_until
  FROM public.profiles p
  WHERE p.id = v_user_id;

  -- is_premium: true if active sub OR admin grant still valid
  v_is_premium := COALESCE(v_has_active_sub, false)
    OR (v_until IS NOT NULL AND v_until > now());

  -- Determine final tier
  IF COALESCE(v_has_active_sub, false) THEN
    -- Active subscription drives the tier
    v_final_tier := COALESCE(v_sub_tier, 'premium');
  ELSIF v_until IS NOT NULL AND v_until > now() THEN
    -- No active sub but admin grant is live
    -- Read current tier; if it's 'free', bump to 'premium'
    SELECT p.subscription_tier INTO v_final_tier
    FROM public.profiles p
    WHERE p.id = v_user_id;
    IF v_final_tier IS NULL OR v_final_tier = 'free' THEN
      v_final_tier := 'premium';
    END IF;
  ELSE
    -- No sub, no admin grant
    v_final_tier := 'free';
  END IF;

  UPDATE public.profiles
  SET is_premium = v_is_premium,
      subscription_tier = v_final_tier
  WHERE id = v_user_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Clean up duplicate / legacy premium_history policies
DROP POLICY IF EXISTS "Admins can insert premium history" ON public.premium_history;
DROP POLICY IF EXISTS "Admins can insert premium_history" ON public.premium_history;
DROP POLICY IF EXISTS "Admins can read premium_history" ON public.premium_history;
DROP POLICY IF EXISTS "Admins can view all premium history" ON public.premium_history;
DROP POLICY IF EXISTS "Users can view own premium history" ON public.premium_history;

CREATE POLICY "premium_history_admin_all"
  ON public.premium_history FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "premium_history_user_select_own"
  ON public.premium_history FOR SELECT
  USING (auth.uid() = user_id);
