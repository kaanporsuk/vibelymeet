-- Expose subscription_tier in the admin user detail read model so admin UI can
-- distinguish Free, Premium, and VIP grants in the profile drawer.

BEGIN;

DO $$
DECLARE
  v_definition text;
  v_next text;
BEGIN
  SELECT pg_get_functiondef('public.admin_get_user_detail_read_model(uuid)'::regprocedure)
  INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'admin_get_user_detail_read_model(uuid) was not found';
  END IF;

  IF strpos(v_definition, '''subscription_tier'', p.subscription_tier') > 0 THEN
    RETURN;
  END IF;

  v_next := replace(
    v_definition,
    E'      p.is_premium,\n      p.premium_until,',
    E'      p.is_premium,\n      p.subscription_tier,\n      p.premium_until,'
  );

  v_next := replace(
    v_next,
    E'    ''is_premium'', p.is_premium,\n    ''premium_until'', p.premium_until,',
    E'    ''is_premium'', p.is_premium,\n    ''subscription_tier'', p.subscription_tier,\n    ''premium_until'', p.premium_until,'
  );

  IF v_next = v_definition
    OR strpos(v_next, 'p.subscription_tier') = 0
    OR strpos(v_next, '''subscription_tier'', p.subscription_tier') = 0
  THEN
    RAISE EXCEPTION 'Could not patch subscription_tier into admin_get_user_detail_read_model(uuid)';
  END IF;

  EXECUTE v_next;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_user_detail_read_model(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail_read_model(uuid) TO authenticated;

COMMIT;
