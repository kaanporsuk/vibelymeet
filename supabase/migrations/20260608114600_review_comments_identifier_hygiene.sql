-- Corrective identifier hygiene for the PR #1232-#1242 follow-up.
--
-- 20260608114500 was already applied to Supabase cloud and its provider-
-- absence base helper name exceeded PostgreSQL's 63-byte identifier limit.
-- Keep applied history immutable and repair the live catalog with a short
-- explicit base name.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vd_absence_review_1232_1242_base(uuid, text)') IS NULL THEN
    IF to_regprocedure('public.video_date_reconcile_provider_absence_v1_20260608114500_review_(uuid, text)') IS NOT NULL THEN
      ALTER FUNCTION public.video_date_reconcile_provider_absence_v1_20260608114500_review_(uuid, text)
        RENAME TO vd_absence_review_1232_1242_base;
    END IF;
  END IF;

  IF to_regprocedure('public.vd_absence_review_1232_1242_base(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'missing provider absence review-comments base helper';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.vd_absence_review_1232_1242_base(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_absence_review_1232_1242_base(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_reconcile_provider_absence_v1(
  p_session_id uuid,
  p_source text DEFAULT 'video_date_reconcile_provider_absence_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_terminal boolean := false;
  v_survey_required boolean := false;
  v_resume_status text;
  v_session record;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_result := public.vd_absence_review_1232_1242_base(
    p_session_id,
    p_source
  );

  v_terminal := lower(COALESCE(v_result ->> 'terminal', 'false')) IN ('true', 't', '1', 'yes');
  v_survey_required := lower(COALESCE(v_result ->> 'survey_required', 'false')) IN ('true', 't', '1', 'yes');
  v_resume_status := NULLIF(v_result ->> 'resume_status', '');

  IF v_terminal AND NOT v_survey_required AND v_resume_status = 'idle' THEN
    SELECT
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id
    INTO v_session
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    IF FOUND THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        updated_at = v_now
      WHERE event_id = v_session.event_id
        AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
        AND queue_status IS DISTINCT FROM 'in_survey';
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text) IS
  'Provider-authoritative post-encounter absence reconciler. Wraps the short PR #1232-#1242 review-comments base and preserves idle resume status for no-survey terminalization when the event is no longer live.';

NOTIFY pgrst, 'reload schema';

COMMIT;
