-- Media lifecycle cron status resilience + event-cover reference repair.
--
-- The admin dashboard must be able to prove the scheduler row is active even
-- when cron.job_run_details is slow or unavailable. Keep the fast cron.job read
-- separate from best-effort run history, and index run history by job.

DO $$
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS job_run_details_jobid_runid_desc_idx ON cron.job_run_details (jobid, runid DESC)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_media_worker_cron_job_status(
  p_job_name text DEFAULT 'media-delete-worker-every-15m'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job_id   bigint;
  v_jobname  text;
  v_schedule text;
  v_active   boolean;
BEGIN
  IF NULLIF(btrim(COALESCE(p_job_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_job_name is required';
  END IF;

  SELECT jobid, jobname, schedule, active
  INTO v_job_id, v_jobname, v_schedule, v_active
  FROM cron.job
  WHERE jobname = p_job_name
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'status', 'missing_job',
      'jobname', p_job_name
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', CASE WHEN v_active THEN 'found' ELSE 'inactive' END,
    'job_id', v_job_id,
    'jobname', v_jobname,
    'schedule', v_schedule,
    'active', v_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_media_worker_cron_job_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_worker_cron_job_status(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_media_worker_cron_run_history(
  p_job_name  text    DEFAULT 'media-delete-worker-every-15m',
  p_run_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job_id     bigint;
  v_runs_arr   jsonb := '[]'::jsonb;
  v_run_limit  integer := COALESCE(p_run_limit, 10);
  v_runid      bigint;
  v_run_status text;
  v_run_start  timestamptz;
  v_run_end    timestamptz;
  v_dur_ms     numeric;

  v_last_succeeded text := NULL;
  v_last_failed    text := NULL;
  v_consec_fail    integer := 0;
  v_stop_counting  boolean := false;
BEGIN
  IF NULLIF(btrim(COALESCE(p_job_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_job_name is required';
  END IF;

  IF v_run_limit < 0 OR v_run_limit > 100 THEN
    RAISE EXCEPTION 'p_run_limit must be between 0 and 100';
  END IF;

  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = p_job_name
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'status', 'missing_job',
      'jobname', p_job_name,
      'recent_runs', '[]'::jsonb
    );
  END IF;

  BEGIN
    FOR v_runid, v_run_status, v_run_start, v_run_end IN
      SELECT runid, status, start_time, end_time
      FROM cron.job_run_details
      WHERE jobid = v_job_id
      ORDER BY runid DESC
      LIMIT v_run_limit
    LOOP
      v_dur_ms := CASE
        WHEN v_run_end IS NOT NULL
        THEN extract(epoch FROM (v_run_end - v_run_start)) * 1000
        ELSE NULL
      END;

      v_runs_arr := v_runs_arr || jsonb_build_array(
        jsonb_build_object(
          'runid',       v_runid,
          'status',      v_run_status,
          'start_time',  to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'end_time',    CASE WHEN v_run_end IS NOT NULL
                           THEN to_char(v_run_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                           ELSE NULL END,
          'duration_ms', v_dur_ms
        )
      );

      IF v_last_succeeded IS NULL AND v_run_status = 'succeeded' THEN
        v_last_succeeded := to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
      END IF;

      IF NOT v_stop_counting THEN
        IF v_run_status = 'succeeded' THEN
          v_stop_counting := true;
        ELSE
          v_consec_fail := v_consec_fail + 1;
          IF v_last_failed IS NULL THEN
            v_last_failed := to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
          END IF;
        END IF;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'found', true,
      'status', 'recent_runs_unavailable',
      'job_id', v_job_id,
      'jobname', p_job_name,
      'recent_runs', '[]'::jsonb,
      'recent_runs_error', SQLERRM,
      'last_succeeded_at', NULL,
      'last_failed_at', NULL,
      'consecutive_failures', 0
    );
  END;

  RETURN jsonb_build_object(
    'found', true,
    'status', 'found',
    'job_id', v_job_id,
    'jobname', p_job_name,
    'recent_runs', v_runs_arr,
    'recent_runs_error', NULL,
    'last_succeeded_at', v_last_succeeded,
    'last_failed_at', v_last_failed,
    'consecutive_failures', v_consec_fail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_media_worker_cron_run_history(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_worker_cron_run_history(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_media_worker_cron_status(
  p_job_name  text    DEFAULT 'media-delete-worker-every-15m',
  p_run_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job  jsonb;
  v_runs jsonb;
BEGIN
  v_job := public.get_media_worker_cron_job_status(p_job_name);

  IF COALESCE((v_job ->> 'found')::boolean, false) IS NOT TRUE THEN
    RETURN v_job || jsonb_build_object('recent_runs', '[]'::jsonb);
  END IF;

  v_runs := public.get_media_worker_cron_run_history(p_job_name, p_run_limit);

  RETURN v_job
    || jsonb_build_object(
      'status', CASE
                  WHEN COALESCE((v_job ->> 'active')::boolean, false) IS NOT TRUE THEN 'inactive'
                  WHEN v_runs ->> 'status' = 'recent_runs_unavailable' THEN 'recent_runs_unavailable'
                  ELSE 'found'
                END,
      'recent_runs', COALESCE(v_runs -> 'recent_runs', '[]'::jsonb),
      'recent_runs_error', v_runs ->> 'recent_runs_error',
      'last_succeeded_at', v_runs ->> 'last_succeeded_at',
      'last_failed_at', v_runs ->> 'last_failed_at',
      'consecutive_failures', COALESCE((v_runs ->> 'consecutive_failures')::integer, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_media_worker_cron_status(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_worker_cron_status(text, integer) TO service_role;

-- Event cover uploads can happen before an event id exists. Once the event row
-- is created or updated, attach the lifecycle asset to events.cover_image.

CREATE OR REPLACE FUNCTION public.normalize_event_cover_provider_path(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_value text := NULLIF(trim(COALESCE(p_value, '')), '');
  v_prefix text := NULLIF(
    trim(BOTH '/' FROM COALESCE(current_setting('app.bunny_cdn_path_prefix', true), '')),
    ''
  );
BEGIN
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_value := regexp_replace(v_value, '[?#].*$', '');

  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://[^/]+/', '');
  END IF;

  v_value := regexp_replace(v_value, '^/+', '');

  IF v_prefix IS NOT NULL AND left(v_value, length(v_prefix) + 1) = v_prefix || '/' THEN
    v_value := substring(v_value FROM length(v_prefix) + 2);
  END IF;

  v_value := regexp_replace(v_value, '^/+', '');

  IF strpos(v_value, '..') > 0 THEN
    RETURN NULL;
  END IF;

  IF v_value LIKE 'photos/%'
     OR v_value LIKE 'chat-videos/%'
     OR v_value LIKE 'voice/%' THEN
    RETURN NULL;
  END IF;

  IF v_value LIKE 'events/%' THEN
    RETURN v_value;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_event_cover_provider_path(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_event_cover_provider_path(text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_event_cover_media_lifecycle(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_path text;
  v_asset_id uuid;
  v_ref_id uuid;
  v_ref record;
  v_released_count integer := 0;
  v_ref_created boolean := false;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_not_found', 'event_id', p_event_id);
  END IF;

  v_path := public.normalize_event_cover_provider_path(v_event.cover_image);

  FOR v_ref IN
    SELECT r.id
    FROM public.media_references r
    JOIN public.media_assets a ON a.id = r.asset_id
    WHERE r.ref_type = 'event_cover'
      AND r.ref_table = 'events'
      AND r.ref_id = p_event_id::text
      AND r.is_active = true
      AND (
        v_path IS NULL
        OR a.provider IS DISTINCT FROM 'bunny_storage'
        OR a.provider_path IS DISTINCT FROM v_path
      )
  LOOP
    PERFORM public.release_media_reference(v_ref.id, 'replace');
    v_released_count := v_released_count + 1;
  END LOOP;

  IF v_path IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'tracked', false,
      'released_refs', v_released_count
    );
  END IF;

  SELECT id
  INTO v_asset_id
  FROM public.media_assets
  WHERE provider = 'bunny_storage'
    AND provider_path = v_path
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_asset_id IS NULL THEN
    INSERT INTO public.media_assets (
      provider,
      media_family,
      provider_path,
      status,
      legacy_table,
      legacy_id
    )
    VALUES (
      'bunny_storage',
      'event_cover',
      v_path,
      'active',
      'events',
      p_event_id::text
    )
    RETURNING id INTO v_asset_id;
  ELSE
    UPDATE public.media_assets
    SET
      media_family = 'event_cover',
      status = CASE
                 WHEN status IN ('soft_deleted', 'purge_ready', 'failed') THEN 'active'
                 ELSE status
               END,
      deleted_at = CASE
                     WHEN status IN ('soft_deleted', 'purge_ready', 'failed') THEN NULL
                     ELSE deleted_at
                   END,
      purge_after = CASE
                      WHEN status IN ('soft_deleted', 'purge_ready', 'failed') THEN NULL
                      ELSE purge_after
                    END,
      last_error = NULL,
      legacy_table = 'events',
      legacy_id = p_event_id::text,
      updated_at = now()
    WHERE id = v_asset_id;
  END IF;

  SELECT id
  INTO v_ref_id
  FROM public.media_references
  WHERE asset_id = v_asset_id
    AND ref_type = 'event_cover'
    AND ref_table = 'events'
    AND ref_id = p_event_id::text
    AND is_active = true
  LIMIT 1;

  IF v_ref_id IS NULL THEN
    INSERT INTO public.media_references (
      asset_id,
      ref_type,
      ref_table,
      ref_id,
      ref_key,
      is_active
    )
    VALUES (
      v_asset_id,
      'event_cover',
      'events',
      p_event_id::text,
      'cover_image',
      true
    )
    RETURNING id INTO v_ref_id;
    v_ref_created := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tracked', true,
    'asset_id', v_asset_id,
    'reference_id', v_ref_id,
    'reference_created', v_ref_created,
    'released_refs', v_released_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_cover_media_lifecycle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_cover_media_lifecycle(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.events_cover_media_lifecycle_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_event_cover_media_lifecycle(NEW.id);
  ELSIF NEW.cover_image IS DISTINCT FROM OLD.cover_image THEN
    PERFORM public.sync_event_cover_media_lifecycle(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_cover_media_lifecycle ON public.events;
CREATE TRIGGER trg_events_cover_media_lifecycle
AFTER INSERT OR UPDATE OF cover_image ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.events_cover_media_lifecycle_trigger();

REVOKE ALL ON FUNCTION public.events_cover_media_lifecycle_trigger() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_event_id uuid;
BEGIN
  FOR v_event_id IN
    SELECT id
    FROM public.events
    WHERE public.normalize_event_cover_provider_path(cover_image) IS NOT NULL
  LOOP
    PERFORM public.sync_event_cover_media_lifecycle(v_event_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.soft_delete_orphan_event_cover_assets(
  p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
  v_limit integer := COALESCE(p_limit, 50);
BEGIN
  IF v_limit < 1 OR v_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  WITH targets AS (
    SELECT a.id
    FROM public.media_assets a
    WHERE a.media_family = 'event_cover'
      AND a.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.events e
        WHERE public.normalize_event_cover_provider_path(e.cover_image) = a.provider_path
      )
    ORDER BY a.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.media_assets a
  SET
    status = 'soft_deleted',
    deleted_at = now(),
    purge_after = now() + make_interval(days => COALESCE(s.retention_days, 90)),
    updated_at = now(),
    last_error = NULL
  FROM targets t
  LEFT JOIN public.media_retention_settings s ON s.media_family = 'event_cover'
  WHERE a.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_orphan_event_cover_assets(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_orphan_event_cover_assets(integer) TO service_role;
