-- Admin-editable tier capability overrides (sparse). Empty = code defaults in supabase/functions/_shared/tiers.ts.

CREATE TABLE IF NOT EXISTS public.tier_config_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id text NOT NULL,
  capability_key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier_id, capability_key)
);

ALTER TABLE public.tier_config_overrides
  DROP CONSTRAINT IF EXISTS tier_config_overrides_tier_check;
ALTER TABLE public.tier_config_overrides
  ADD CONSTRAINT tier_config_overrides_tier_check
  CHECK (tier_id IN ('free', 'premium', 'vip'));

ALTER TABLE public.tier_config_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage tier config" ON public.tier_config_overrides;
CREATE POLICY "Admins can manage tier config"
  ON public.tier_config_overrides
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Authenticated users can read tier config" ON public.tier_config_overrides;
CREATE POLICY "Authenticated users can read tier config"
  ON public.tier_config_overrides
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.tier_config_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id text NOT NULL,
  capability_key text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  action text NOT NULL,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tier_config_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read tier config audit" ON public.tier_config_audit;
CREATE POLICY "Admins can read tier config audit"
  ON public.tier_config_audit
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.set_tier_config_override(
  p_tier_id text,
  p_capability_key text,
  p_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value jsonb;
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF p_tier_id NOT IN ('free', 'premium', 'vip') THEN
    RAISE EXCEPTION 'invalid tier_id';
  END IF;

  SELECT value INTO v_old_value
  FROM public.tier_config_overrides
  WHERE tier_id = p_tier_id AND capability_key = p_capability_key;

  INSERT INTO public.tier_config_overrides (tier_id, capability_key, value, updated_by, updated_at)
  VALUES (p_tier_id, p_capability_key, p_value, v_admin, now())
  ON CONFLICT (tier_id, capability_key)
  DO UPDATE SET value = EXCLUDED.value, updated_by = v_admin, updated_at = now();

  INSERT INTO public.tier_config_audit (tier_id, capability_key, old_value, new_value, action, admin_id)
  VALUES (p_tier_id, p_capability_key, v_old_value, p_value, 'set', v_admin);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_tier_config_override(
  p_tier_id text,
  p_capability_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value jsonb;
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT value INTO v_old_value
  FROM public.tier_config_overrides
  WHERE tier_id = p_tier_id AND capability_key = p_capability_key;

  DELETE FROM public.tier_config_overrides
  WHERE tier_id = p_tier_id AND capability_key = p_capability_key;

  IF v_old_value IS NOT NULL THEN
    INSERT INTO public.tier_config_audit (tier_id, capability_key, old_value, new_value, action, admin_id)
    VALUES (p_tier_id, p_capability_key, v_old_value, NULL, 'reset', v_admin);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_tier_config_override(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_tier_config_override(text, text) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tier_config_overrides;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;
