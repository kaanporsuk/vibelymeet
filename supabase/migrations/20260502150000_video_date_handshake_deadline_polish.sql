-- Post-deploy polish for the handshake deadline cleanup wrapper:
-- give the delegated phase-cleanup helper a deliberate short name instead of
-- relying on Postgres' 63-byte identifier truncation.

DO $$
BEGIN
  IF to_regprocedure('public.expire_stale_video_date_phases_bounded_20260502143000_handshake(integer)') IS NOT NULL
     AND to_regprocedure('public.expire_vd_phases_base_20260502143000(integer)') IS NULL THEN
    ALTER FUNCTION public.expire_stale_video_date_phases_bounded_20260502143000_handshake(integer)
      RENAME TO expire_vd_phases_base_20260502143000;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_vd_phases_base_20260502143000(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_vd_phases_base_20260502143000(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_vd_phases_base_20260502143000(integer) IS
  'Private delegated stale video-date phase cleanup from 20260502143000. Called by expire_stale_video_date_phases_bounded after the hard-handshake-deadline overlay.';

CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases_bounded(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_base jsonb;
  v_due jsonb;
  v_base_total integer := 0;
  v_due_total integer := 0;
BEGIN
  v_base := public.expire_vd_phases_base_20260502143000(v_limit);
  v_due := public.expire_due_joined_video_date_handshakes_bounded(v_limit);
  v_base_total := COALESCE((v_base->>'total')::int, 0);
  v_due_total := COALESCE((v_due->>'total')::int, 0);

  RETURN v_base || jsonb_build_object(
    'handshake_deadline_completed_mutual', COALESCE((v_due->>'handshake_deadline_completed_mutual')::int, 0),
    'handshake_deadline_not_mutual', COALESCE((v_due->>'handshake_deadline_not_mutual')::int, 0),
    'handshake_deadline_timeout', COALESCE((v_due->>'handshake_deadline_timeout')::int, 0),
    'handshake_deadline_noop', COALESCE((v_due->>'handshake_deadline_noop')::int, 0),
    'total', v_base_total + v_due_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) IS
  'Bounded stale video-date phase cleanup. Keeps no-evidence and partial-join cleanup, and finalizes both-joined handshakes that pass the 60s hard deadline without Last Chance grace.';
