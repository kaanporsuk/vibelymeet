-- Normalize the preserved confirmed-encounter promotion base helper name.
-- The preceding review-comments migration used a helper name longer than
-- PostgreSQL's 63-byte identifier limit, so PostgreSQL truncated it in the
-- live catalog. Rename it to a short stable helper and recreate the wrapper
-- against that explicit name.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vd_promote_ce_auth_20260605221535_base(uuid, uuid, text, text, boolean)') IS NULL
     AND to_regprocedure('public.video_date_promote_confirmed_encounter_v1_20260605221535_partic(uuid, uuid, text, text, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_promote_confirmed_encounter_v1_20260605221535_partic(uuid, uuid, text, text, boolean)
      RENAME TO vd_promote_ce_auth_20260605221535_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.vd_promote_ce_auth_20260605221535_base(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vd_promote_ce_auth_20260605221535_base(uuid, uuid, text, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_promote_confirmed_encounter_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_confirmed_encounter_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF p_require_participant THEN
    IF p_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
    END IF;

    IF p_actor IS DISTINCT FROM v_session.participant_1_id
       AND p_actor IS DISTINCT FROM v_session.participant_2_id THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
    END IF;
  END IF;

  RETURN public.vd_promote_ce_auth_20260605221535_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason,
    p_require_participant
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean) IS
  'Participant-authorized confirmed-encounter promotion wrapper. Authenticated callers are checked before delegating to the preserved base function that may repair room metadata.';

NOTIFY pgrst, 'reload schema';

COMMIT;
