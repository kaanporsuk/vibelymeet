-- Date suggestion active-window expiry.
--
-- Open status alone is not enough to decide whether a date suggestion should
-- block a new proposal. Exact picks stop blocking after starts_at, and vague
-- choices stop blocking after their inferred local calendar window.

ALTER TABLE public.date_suggestion_revisions
  ADD COLUMN IF NOT EXISTS local_timezone text;

ALTER TABLE public.date_suggestion_revisions
  ALTER COLUMN local_timezone DROP DEFAULT;

CREATE OR REPLACE FUNCTION public._date_suggestion_normalize_timezone(p_timezone text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_timezone text := NULLIF(btrim(COALESCE(p_timezone, '')), '');
BEGIN
  IF v_timezone IS NULL THEN
    RETURN 'UTC';
  END IF;

  BEGIN
    PERFORM now() AT TIME ZONE v_timezone;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'UTC';
  END;

  RETURN v_timezone;
END;
$$;

UPDATE public.date_suggestion_revisions
SET local_timezone = public._date_suggestion_normalize_timezone(local_timezone)
WHERE local_timezone IS NULL
   OR local_timezone <> public._date_suggestion_normalize_timezone(local_timezone);

CREATE OR REPLACE FUNCTION public._date_suggestion_revision_timezone_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := NULLIF(btrim(NEW.local_timezone), '');
  IF v_timezone IS NULL THEN
    v_timezone := NULLIF(btrim(current_setting('vibely.date_suggestion_local_timezone', true)), '');
  END IF;

  NEW.local_timezone := public._date_suggestion_normalize_timezone(v_timezone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS date_suggestion_revisions_timezone_before_write
  ON public.date_suggestion_revisions;

CREATE TRIGGER date_suggestion_revisions_timezone_before_write
BEFORE INSERT OR UPDATE OF local_timezone
ON public.date_suggestion_revisions
FOR EACH ROW
EXECUTE FUNCTION public._date_suggestion_revision_timezone_trigger();

CREATE OR REPLACE FUNCTION public._date_suggestion_window_end(
  p_time_choice_key text,
  p_starts_at timestamptz,
  p_anchor_at timestamptz,
  p_expires_at timestamptz,
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
    RETURN p_expires_at;
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

ALTER FUNCTION public.date_suggestion_apply_v2(text, jsonb)
  RENAME TO date_suggestion_apply_v2_stale_window_dispatch_20260517;

CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_match_id uuid;
  v_suggestion_id uuid;
  v_local_timezone text;
BEGIN
  IF p_action IN ('send_proposal', 'counter') THEN
    v_local_timezone := public._date_suggestion_normalize_timezone(
      NULLIF(v_payload->'revision'->>'local_timezone', '')
    );
    PERFORM set_config('vibely.date_suggestion_local_timezone', v_local_timezone, true);
  END IF;

  BEGIN
    v_match_id := NULLIF(v_payload->>'match_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_match_id := NULL;
  END;

  IF v_match_id IS NULL THEN
    BEGIN
      v_suggestion_id := NULLIF(v_payload->>'suggestion_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_suggestion_id := NULL;
    END;

    IF v_suggestion_id IS NOT NULL THEN
      SELECT match_id INTO v_match_id
      FROM public.date_suggestions
      WHERE id = v_suggestion_id;
    END IF;
  END IF;

  IF v_match_id IS NOT NULL THEN
    PERFORM public.date_suggestion_expire_stale_open_suggestions(v_match_id, now());
  END IF;

  RETURN public.date_suggestion_apply_v2_stale_window_dispatch_20260517(p_action, v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public._date_suggestion_normalize_timezone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_suggestion_revision_timezone_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_suggestion_window_end(text, timestamptz, timestamptz, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_suggestion_blocks_new_proposal(text, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.date_suggestion_expire_stale_open_suggestions(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.date_suggestion_expire_stale_open_suggestions(uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2_stale_window_dispatch_20260517(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) TO authenticated;

COMMENT ON COLUMN public.date_suggestion_revisions.local_timezone IS
  'IANA timezone captured when the proposal revision was created; legacy/null values normalize to UTC.';
COMMENT ON FUNCTION public.date_suggestion_expire_stale_open_suggestions(uuid, timestamptz) IS
  'Expires open date suggestions whose exact or inferred proposal window has elapsed.';
COMMENT ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) IS
  'Date suggestion write RPC wrapper. Captures revision timezone and expires stale active suggestions before the one-open-per-match gate.';
