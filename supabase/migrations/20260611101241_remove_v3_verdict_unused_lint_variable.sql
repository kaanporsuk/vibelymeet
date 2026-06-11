-- Remove an unused local variable from the canonical v3 post-date verdict RPC.
--
-- The v3-only verdict migration has already been applied in linked cloud, so
-- keep this as a forward-only function-body cleanup instead of rewriting that
-- migration file.

DO $$
DECLARE
  v_definition text;
  v_before text := $replace$
    SELECT
      COALESCE(bool_or(df.user_id = v_actor), false),
      COALESCE(bool_or(df.user_id = v_target), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_actor), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_target), false)
    INTO
      v_actor_has_feedback,
      v_partner_has_feedback,
      v_actor_liked,
      v_partner_liked
$replace$;
  v_after text := $replace$
    SELECT
      COALESCE(bool_or(df.user_id = v_target), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_actor), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_target), false)
    INTO
      v_partner_has_feedback,
      v_actor_liked,
      v_partner_liked
$replace$;
BEGIN
  SELECT pg_get_functiondef('public.submit_post_date_verdict_v3(uuid,boolean,text,jsonb,text)'::regprocedure)
  INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'submit_post_date_verdict_v3 is missing';
  END IF;

  v_definition := replace(v_definition, E'\n  v_actor_has_feedback boolean := false;', '');
  v_definition := replace(v_definition, v_before, v_after);

  IF v_definition LIKE '%v_actor_has_feedback%' THEN
    RAISE EXCEPTION 'submit_post_date_verdict_v3 cleanup did not remove v_actor_has_feedback';
  END IF;

  EXECUTE v_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text) IS
  'Canonical v3-only post-date verdict persistence path. Owns command idempotency, date_feedback writes, safety handling, verdict events, and next_surface; legacy verdict RPC compatibility is removed.';
