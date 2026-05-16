-- Keep schedule-share active blocking aligned with the 48-hour shared-slot
-- visibility window. This follow-up is intentionally separate in case the
-- previous active-window migration has already run in an environment.

CREATE OR REPLACE FUNCTION public._date_suggestion_window_end(
  p_time_choice_key text,
  p_starts_at timestamptz,
  p_anchor_at timestamptz,
  p_expires_at timestamptz,
  p_schedule_share_expires_at timestamptz,
  p_schedule_share_enabled boolean,
  p_local_timezone text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_timezone text := public._date_suggestion_normalize_timezone(p_local_timezone);
  v_anchor_local timestamp;
  v_anchor_day timestamp;
  v_iso_dow int;
  v_days_to_end int;
BEGIN
  IF p_starts_at IS NOT NULL THEN
    RETURN p_starts_at;
  END IF;

  IF p_time_choice_key = 'share_schedule' OR COALESCE(p_schedule_share_enabled, false) THEN
    RETURN COALESCE(p_schedule_share_expires_at, p_expires_at);
  END IF;

  IF p_time_choice_key NOT IN ('tonight', 'tomorrow', 'this_weekend', 'next_week') THEN
    RETURN p_expires_at;
  END IF;

  v_anchor_local := COALESCE(p_anchor_at, now()) AT TIME ZONE v_timezone;
  v_anchor_day := date_trunc('day', v_anchor_local);
  v_iso_dow := EXTRACT(ISODOW FROM v_anchor_local)::int;

  v_days_to_end := CASE p_time_choice_key
    WHEN 'tonight' THEN 1
    WHEN 'tomorrow' THEN 2
    WHEN 'this_weekend' THEN 8 - v_iso_dow
    WHEN 'next_week' THEN 15 - v_iso_dow
    ELSE NULL
  END;

  IF v_days_to_end IS NULL THEN
    RETURN p_expires_at;
  END IF;

  RETURN (v_anchor_day + make_interval(days => v_days_to_end)) AT TIME ZONE v_timezone;
END;
$$;

CREATE OR REPLACE FUNCTION public._date_suggestion_blocks_new_proposal(
  p_status text,
  p_time_choice_key text,
  p_starts_at timestamptz,
  p_revision_created_at timestamptz,
  p_suggestion_created_at timestamptz,
  p_expires_at timestamptz,
  p_schedule_share_expires_at timestamptz,
  p_schedule_share_enabled boolean,
  p_local_timezone text,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_window_end timestamptz;
BEGIN
  IF p_status = 'draft' THEN
    RETURN true;
  END IF;

  IF p_status NOT IN ('proposed', 'viewed', 'countered') THEN
    RETURN false;
  END IF;

  v_window_end := public._date_suggestion_window_end(
    p_time_choice_key,
    p_starts_at,
    COALESCE(p_revision_created_at, p_suggestion_created_at),
    p_expires_at,
    p_schedule_share_expires_at,
    p_schedule_share_enabled,
    p_local_timezone
  );

  IF v_window_end IS NULL THEN
    RETURN true;
  END IF;

  RETURN v_window_end > p_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.date_suggestion_expire_stale_open_suggestions(
  p_match_id uuid DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stale AS (
    SELECT ds.id, ds.status AS from_status
    FROM public.date_suggestions ds
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.date_suggestion_revisions candidate
      WHERE candidate.date_suggestion_id = ds.id
      ORDER BY (candidate.id = ds.current_revision_id) DESC, candidate.revision_number DESC
      LIMIT 1
    ) rev ON true
    WHERE ds.status IN ('proposed', 'viewed', 'countered')
      AND (p_match_id IS NULL OR ds.match_id = p_match_id)
      AND NOT public._date_suggestion_blocks_new_proposal(
        ds.status,
        rev.time_choice_key,
        rev.starts_at,
        rev.created_at,
        ds.created_at,
        ds.expires_at,
        ds.schedule_share_expires_at,
        rev.schedule_share_enabled,
        rev.local_timezone,
        p_now
      )
  ),
  updated AS (
    UPDATE public.date_suggestions ds
    SET status = 'expired',
        updated_at = p_now
    FROM stale
    WHERE ds.id = stale.id
      AND ds.status = stale.from_status
    RETURNING ds.id, stale.from_status
  ),
  logged AS (
    INSERT INTO public.date_suggestion_transition_log (
      date_suggestion_id,
      actor_id,
      action,
      from_status,
      to_status,
      success,
      payload
    )
    SELECT
      id,
      NULL,
      'expire',
      from_status,
      'expired',
      true,
      jsonb_build_object('reason', 'proposal_window_elapsed')
    FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._date_suggestion_window_end(text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_suggestion_blocks_new_proposal(text, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.date_suggestion_expire_stale_open_suggestions(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.date_suggestion_expire_stale_open_suggestions(uuid, timestamptz) TO service_role;

DROP FUNCTION IF EXISTS public._date_suggestion_blocks_new_proposal(text, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, text, timestamptz);
DROP FUNCTION IF EXISTS public._date_suggestion_window_end(text, timestamptz, timestamptz, timestamptz, boolean, text);

COMMENT ON FUNCTION public.date_suggestion_expire_stale_open_suggestions(uuid, timestamptz) IS
  'Expires open date suggestions whose exact, vague, or schedule-share visibility window has elapsed.';
