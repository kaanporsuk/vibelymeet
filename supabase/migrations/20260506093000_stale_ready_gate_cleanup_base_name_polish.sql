-- Name polish for the stale Ready Gate cleanup wrapper.
--
-- PostgreSQL truncates identifiers past 63 bytes. The previous migration's
-- delegated cleanup base name was functional but truncated in pg_proc. Rename
-- it to a deliberately short, stable internal name and repoint the wrapper.

ALTER FUNCTION public.expire_stale_video_sessions_bounded_20260506090000_stale_room_b(integer)
  RENAME TO expire_stale_vsessions_bounded_202605060900_base;

REVOKE ALL ON FUNCTION public.expire_stale_vsessions_bounded_202605060900_base(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_vsessions_bounded_202605060900_base(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions_bounded(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_repaired integer := 0;
  v_base integer := 0;
BEGIN
  v_repaired := public.terminalize_stale_pre_date_ready_gate_blockers(
    v_limit,
    'expire_stale_video_sessions'
  );
  v_base := public.expire_stale_vsessions_bounded_202605060900_base(v_limit);
  RETURN COALESCE(v_repaired, 0) + COALESCE(v_base, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions_bounded(integer) IS
  'Bounded stale-session cleanup. First terminalizes expired/event-inactive pre-date Ready Gates with stale room metadata, then delegates to the prior cleanup stack.';
