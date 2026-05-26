-- Admin Sprint 2: durable compliance jobs, support delivery jobs, audit meta-logging,
-- and target-scoped admin idempotency support.

ALTER TABLE public.admin_activity_logs
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS action_outcome text,
  ADD COLUMN IF NOT EXISTS error_code text;

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_action_type_created_at
  ON public.admin_activity_logs(action_type, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type text,
  p_target_type text,
  p_target_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_details jsonb := COALESCE(p_details, '{}'::jsonb);
  v_log_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_admin_id, 'admin'::public.app_role)
    OR public.has_role(v_admin_id, 'moderator'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details,
    request_id,
    correlation_id,
    action_outcome,
    error_code
  ) VALUES (
    v_admin_id,
    p_action_type,
    p_target_type,
    p_target_id,
    v_details,
    NULLIF(left(btrim(COALESCE(v_details->>'request_id', '')), 160), ''),
    NULLIF(left(btrim(COALESCE(v_details->>'correlation_id', '')), 160), ''),
    COALESCE(NULLIF(left(btrim(COALESCE(v_details->>'action_outcome', '')), 80), ''), 'success'),
    NULLIF(left(btrim(COALESCE(v_details->>'error_code', '')), 120), '')
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_user_id_auth_users_fkey;

COMMENT ON COLUMN public.account_deletion_requests.user_id IS
  'Auth user id retained as a compliance tombstone. This intentionally does not reference auth.users because completed deletion hard-deletes the Supabase auth identity.';

ALTER TABLE public.daily_drops
  DROP CONSTRAINT IF EXISTS daily_drops_opener_sender_id_fkey,
  DROP CONSTRAINT IF EXISTS daily_drops_reply_sender_id_fkey,
  DROP CONSTRAINT IF EXISTS daily_drops_passed_by_user_id_fkey;

ALTER TABLE public.daily_drops
  ADD CONSTRAINT daily_drops_opener_sender_id_fkey
    FOREIGN KEY (opener_sender_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT daily_drops_reply_sender_id_fkey
    FOREIGN KEY (reply_sender_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT daily_drops_passed_by_user_id_fkey
    FOREIGN KEY (passed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.account_deletion_completion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'processing', 'blocked', 'retryable_failed', 'permanent_failed', 'completed')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_reason text,
  worker_id text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 10 CHECK (max_attempts > 0),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  provider_cleanup_completed_at timestamptz,
  provider_cleanup_provider_id text,
  media_cleanup_completed_at timestamptz,
  pii_scrub_completed_at timestamptz,
  auth_delete_completed_at timestamptz,
  completed_at timestamptz,
  blocked_reason text,
  error_code text,
  last_error text,
  last_error_at timestamptz,
  legacy_checkpoint boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deletion_request_id)
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_completion_jobs_state_retry
  ON public.account_deletion_completion_jobs(state, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_account_deletion_completion_jobs_user
  ON public.account_deletion_completion_jobs(user_id, created_at DESC);

ALTER TABLE public.account_deletion_completion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_deletion_completion_jobs_service_role_all
  ON public.account_deletion_completion_jobs;
CREATE POLICY account_deletion_completion_jobs_service_role_all
  ON public.account_deletion_completion_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS account_deletion_completion_jobs_admin_select
  ON public.account_deletion_completion_jobs;
CREATE POLICY account_deletion_completion_jobs_admin_select
  ON public.account_deletion_completion_jobs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.account_deletion_completion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_completed boolean := false;
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') IS DISTINCT FROM 'completed') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.account_deletion_completion_jobs j
      WHERE j.deletion_request_id = NEW.id
        AND j.state = 'completed'
        AND j.provider_cleanup_completed_at IS NOT NULL
        AND j.media_cleanup_completed_at IS NOT NULL
        AND j.pii_scrub_completed_at IS NOT NULL
        AND j.auth_delete_completed_at IS NOT NULL
    ) INTO v_completed;

    IF NOT v_completed THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_COMPLETION_JOB_INCOMPLETE'
        USING MESSAGE = 'Account deletion cannot be marked completed until provider cleanup, media cleanup, PII scrub, and auth deletion are complete.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_account_deletion_completion_guard
  ON public.account_deletion_requests;
CREATE TRIGGER trg_account_deletion_completion_guard
  BEFORE INSERT OR UPDATE OF status
  ON public.account_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.account_deletion_completion_guard();

-- Sprint 2 owns media cleanup through account_deletion_completion_jobs. Leaving
-- the old status trigger attached would run media cleanup a second time when the
-- durable worker finally marks the request completed.
DROP TRIGGER IF EXISTS trg_account_deletion_requests_media_lifecycle
  ON public.account_deletion_requests;

INSERT INTO public.account_deletion_completion_jobs (
  deletion_request_id,
  user_id,
  state,
  provider_cleanup_completed_at,
  media_cleanup_completed_at,
  pii_scrub_completed_at,
  auth_delete_completed_at,
  completed_at,
  legacy_checkpoint,
  metadata,
  created_at,
  updated_at
)
SELECT
  adr.id,
  adr.user_id,
  'completed',
  COALESCE(adr.completed_at, adr.cancelled_at, adr.requested_at, now()),
  COALESCE(adr.completed_at, adr.cancelled_at, adr.requested_at, now()),
  COALESCE(adr.completed_at, adr.cancelled_at, adr.requested_at, now()),
  COALESCE(adr.completed_at, adr.cancelled_at, adr.requested_at, now()),
  COALESCE(adr.completed_at, adr.cancelled_at, adr.requested_at, now()),
  true,
  jsonb_build_object(
    'legacy_checkpoint', true,
    'source', 'backfill_existing_completed_account_deletion_requests'
  ),
  COALESCE(adr.requested_at, now()),
  now()
FROM public.account_deletion_requests adr
WHERE adr.status = 'completed'
ON CONFLICT (deletion_request_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.scrub_account_deletion_profile_pii_v1(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_profile_updated integer := 0;
  v_vibes_deleted integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_USER_ID');
  END IF;

  PERFORM set_config('vibely.verification_server_update', '1', true);
  PERFORM set_config('vibely.onboarding_server_update', '1', true);

  UPDATE public.profiles
  SET
    name = 'Deleted User',
    age = 18,
    gender = 'deleted',
    job = NULL,
    height_cm = NULL,
    location = NULL,
    country = NULL,
    bio = NULL,
    avatar_url = NULL,
    photos = ARRAY[]::text[],
    birth_date = NULL,
    tagline = NULL,
    interested_in = ARRAY[]::text[],
    company = NULL,
    about_me = NULL,
    looking_for = NULL,
    lifestyle = '{}'::jsonb,
    prompts = '[]'::jsonb,
    location_data = NULL,
    proof_selfie_url = NULL,
    bunny_video_uid = NULL,
    bunny_video_status = 'none',
    vibe_caption = NULL,
    vibe_video_status = NULL,
    vibe_score = 0,
    vibe_score_label = 'Deleted',
    phone_number = NULL,
    phone_verified = false,
    phone_verified_at = NULL,
    email_verified = false,
    verified_email = NULL,
    email_unsubscribed = false,
    photo_verified = false,
    photo_verified_at = NULL,
    photo_verification_expires_at = NULL,
    is_premium = false,
    premium_until = NULL,
    premium_granted_at = NULL,
    premium_granted_by = NULL,
    subscription_tier = 'free',
    is_suspended = false,
    suspension_reason = NULL,
    is_paused = false,
    paused_at = NULL,
    paused_until = NULL,
    pause_reason = NULL,
    account_paused = false,
    account_paused_until = NULL,
    discoverable = false,
    discovery_mode = 'hidden',
    discovery_audience = 'hidden',
    discovery_snooze_until = NULL,
    activity_status_visibility = 'nobody',
    distance_visibility = 'hidden',
    event_attendance_visibility = 'hidden',
    event_discovery_prefs = NULL,
    preferred_age_min = NULL,
    preferred_age_max = NULL,
    relationship_intent = NULL,
    show_online_status = false,
    last_seen_at = NULL,
    referred_by = NULL,
    community_agreed_at = NULL,
    events_attended = 0,
    total_matches = 0,
    total_conversations = 0,
    onboarding_complete = false,
    onboarding_stage = 'none',
    updated_at = now()
  WHERE id = p_user_id;

  GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

  DELETE FROM public.profile_vibes
  WHERE profile_id = p_user_id;
  GET DIAGNOSTICS v_vibes_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'profile_scrubbed', v_profile_updated,
    'entitlements_scrubbed', v_profile_updated,
    'profile_vibes_deleted', v_vibes_deleted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_due_account_deletion_completion_jobs_v1(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.account_deletion_completion_jobs (
    deletion_request_id,
    user_id,
    state,
    next_retry_at,
    metadata
  )
  SELECT
    due.id,
    due.user_id,
    'queued',
    now(),
    jsonb_build_object('queued_from', 'enqueue_due_account_deletion_completion_jobs_v1')
  FROM (
    SELECT adr.id, adr.user_id
    FROM public.account_deletion_requests adr
    LEFT JOIN public.account_deletion_completion_jobs j ON j.deletion_request_id = adr.id
    WHERE adr.status = 'pending'
      AND adr.scheduled_deletion_at IS NOT NULL
      AND adr.scheduled_deletion_at <= now()
      AND j.id IS NULL
    ORDER BY adr.scheduled_deletion_at ASC, adr.requested_at ASC, adr.id ASC
    LIMIT v_limit
  ) due
  ON CONFLICT (deletion_request_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_completion_jobs_v1(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.account_deletion_completion_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  WITH claimable AS (
    SELECT j.id
    FROM public.account_deletion_completion_jobs j
    JOIN public.account_deletion_requests adr ON adr.id = j.deletion_request_id
    WHERE adr.status = 'pending'
      AND adr.scheduled_deletion_at IS NOT NULL
      AND adr.scheduled_deletion_at <= now()
      AND (
        j.state IN ('queued', 'retryable_failed')
        OR (j.state = 'processing' AND COALESCE(j.lease_expires_at, '-infinity'::timestamptz) < now())
      )
      AND j.next_retry_at <= now()
      AND j.attempts < j.max_attempts
    ORDER BY j.next_retry_at ASC, j.created_at ASC, j.id ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  )
  UPDATE public.account_deletion_completion_jobs j
  SET state = 'processing',
      worker_id = NULLIF(left(btrim(COALESCE(p_worker_id, '')), 160), ''),
      lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 15), 900)),
      attempts = j.attempts + 1,
      blocked_reason = NULL,
      updated_at = now()
  FROM claimable
  WHERE j.id = claimable.id
  RETURNING j.*;
$function$;

CREATE OR REPLACE FUNCTION public.complete_account_deletion_completion_step_v1(
  p_job_id uuid,
  p_worker_id text,
  p_step text,
  p_provider_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_job public.account_deletion_completion_jobs%ROWTYPE;
  v_step text := lower(NULLIF(btrim(COALESCE(p_step, '')), ''));
  v_now timestamptz := now();
  v_completed boolean := false;
BEGIN
  SELECT *
  INTO v_job
  FROM public.account_deletion_completion_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  END IF;

  IF v_job.state <> 'processing' OR COALESCE(v_job.worker_id, '') <> COALESCE(p_worker_id, '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_CLAIMED_BY_WORKER', 'state', v_job.state);
  END IF;

  IF v_step = 'provider_cleanup' THEN
    UPDATE public.account_deletion_completion_jobs
    SET provider_cleanup_completed_at = COALESCE(provider_cleanup_completed_at, v_now),
        provider_cleanup_provider_id = COALESCE(NULLIF(btrim(COALESCE(p_provider_id, '')), ''), provider_cleanup_provider_id),
        metadata = metadata || jsonb_build_object('provider_cleanup', COALESCE(p_details, '{}'::jsonb)),
        updated_at = v_now
    WHERE id = p_job_id;
  ELSIF v_step = 'media_cleanup' THEN
    UPDATE public.account_deletion_completion_jobs
    SET media_cleanup_completed_at = COALESCE(media_cleanup_completed_at, v_now),
        metadata = metadata || jsonb_build_object('media_cleanup', COALESCE(p_details, '{}'::jsonb)),
        updated_at = v_now
    WHERE id = p_job_id;
  ELSIF v_step = 'pii_scrub' THEN
    UPDATE public.account_deletion_completion_jobs
    SET pii_scrub_completed_at = COALESCE(pii_scrub_completed_at, v_now),
        metadata = metadata || jsonb_build_object('pii_scrub', COALESCE(p_details, '{}'::jsonb)),
        updated_at = v_now
    WHERE id = p_job_id;
  ELSIF v_step = 'auth_delete' THEN
    UPDATE public.account_deletion_completion_jobs
    SET auth_delete_completed_at = COALESCE(auth_delete_completed_at, v_now),
        metadata = metadata || jsonb_build_object('auth_delete', COALESCE(p_details, '{}'::jsonb)),
        updated_at = v_now
    WHERE id = p_job_id;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'step', p_step);
  END IF;

  UPDATE public.account_deletion_completion_jobs
  SET state = CASE
        WHEN provider_cleanup_completed_at IS NOT NULL
         AND media_cleanup_completed_at IS NOT NULL
         AND pii_scrub_completed_at IS NOT NULL
         AND auth_delete_completed_at IS NOT NULL
        THEN 'completed'
        ELSE state
      END,
      completed_at = CASE
        WHEN provider_cleanup_completed_at IS NOT NULL
         AND media_cleanup_completed_at IS NOT NULL
         AND pii_scrub_completed_at IS NOT NULL
         AND auth_delete_completed_at IS NOT NULL
        THEN COALESCE(completed_at, v_now)
        ELSE completed_at
      END,
      lease_expires_at = CASE
        WHEN provider_cleanup_completed_at IS NOT NULL
         AND media_cleanup_completed_at IS NOT NULL
         AND pii_scrub_completed_at IS NOT NULL
         AND auth_delete_completed_at IS NOT NULL
        THEN NULL
        ELSE lease_expires_at
      END,
      last_error = NULL,
      error_code = NULL,
      last_error_at = NULL,
      blocked_reason = NULL,
      updated_at = v_now
  WHERE id = p_job_id
  RETURNING
    state = 'completed'
    AND provider_cleanup_completed_at IS NOT NULL
    AND media_cleanup_completed_at IS NOT NULL
    AND pii_scrub_completed_at IS NOT NULL
    AND auth_delete_completed_at IS NOT NULL
  INTO v_completed;

  IF v_completed THEN
    UPDATE public.account_deletion_requests
    SET status = 'completed',
        completed_at = COALESCE(completed_at, v_now),
        cancelled_at = NULL
    WHERE id = v_job.deletion_request_id
      AND status = 'pending';
  END IF;

  RETURN jsonb_build_object('success', true, 'job_id', p_job_id, 'step', v_step, 'completed', v_completed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_account_deletion_completion_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_error_code text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_permanent boolean DEFAULT false,
  p_blocked boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_job public.account_deletion_completion_jobs%ROWTYPE;
  v_state text;
  v_retry_seconds integer;
BEGIN
  SELECT *
  INTO v_job
  FROM public.account_deletion_completion_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  END IF;

  IF v_job.state <> 'processing' OR COALESCE(v_job.worker_id, '') <> COALESCE(p_worker_id, '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_CLAIMED_BY_WORKER', 'state', v_job.state);
  END IF;

  v_state := CASE
    WHEN COALESCE(p_blocked, false) THEN 'blocked'
    WHEN COALESCE(p_permanent, false) OR v_job.attempts >= v_job.max_attempts THEN 'permanent_failed'
    ELSE 'retryable_failed'
  END;
  v_retry_seconds := LEAST(GREATEST(COALESCE(p_retry_after_seconds, 60 * GREATEST(1, v_job.attempts)), 15), 86400);

  UPDATE public.account_deletion_completion_jobs
  SET state = v_state,
      lease_expires_at = NULL,
      next_retry_at = CASE WHEN v_state = 'retryable_failed' THEN now() + make_interval(secs => v_retry_seconds) ELSE next_retry_at END,
      error_code = NULLIF(left(btrim(COALESCE(p_error_code, '')), 120), ''),
      last_error = left(COALESCE(p_error, 'Unknown deletion completion failure.'), 1000),
      last_error_at = now(),
      blocked_reason = CASE WHEN v_state = 'blocked' THEN left(COALESCE(p_error, 'Blocked deletion completion job.'), 1000) ELSE NULL END,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object('success', true, 'job_id', p_job_id, 'state', v_state, 'retry_after_seconds', v_retry_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_account_deletions(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_status text := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_pending_count integer := 0;
  v_completed_count integer := 0;
  v_recovered_count integer := 0;
  v_other_count integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF v_status = 'recovered' THEN
    v_status := 'cancelled';
  END IF;

  IF v_status IS NOT NULL AND v_status NOT IN ('pending', 'completed', 'cancelled') THEN
    RETURN public.admin_json_error(
      'VALIDATION_ERROR',
      'Unsupported account deletion status filter.',
      jsonb_build_object('status', v_status)
    );
  END IF;

  SELECT
    count(*) FILTER (WHERE adr.status = 'pending')::integer,
    count(*) FILTER (WHERE adr.status = 'completed')::integer,
    count(*) FILTER (WHERE adr.status = 'cancelled')::integer,
    count(*) FILTER (
      WHERE COALESCE(adr.status, '') NOT IN ('pending', 'completed', 'cancelled')
    )::integer
  INTO v_pending_count, v_completed_count, v_recovered_count, v_other_count
  FROM public.account_deletion_requests adr;

  WITH rows AS (
    SELECT
      adr.id,
      adr.user_id,
      COALESCE(NULLIF(btrim(p.name), ''), 'Unknown User') AS user_name,
      adr.status,
      adr.reason,
      adr.requested_at,
      adr.scheduled_deletion_at,
      adr.cancelled_at,
      adr.completed_at,
      j.id AS completion_job_id,
      j.state AS completion_job_state,
      j.attempts AS completion_attempts,
      j.next_retry_at AS completion_next_retry_at,
      j.last_error AS completion_last_error,
      j.error_code AS completion_error_code,
      j.legacy_checkpoint,
      jsonb_build_object(
        'provider_cleanup_completed_at', j.provider_cleanup_completed_at,
        'media_cleanup_completed_at', j.media_cleanup_completed_at,
        'pii_scrub_completed_at', j.pii_scrub_completed_at,
        'auth_delete_completed_at', j.auth_delete_completed_at
      ) AS completion_steps,
      (
        adr.status = 'pending'
        AND adr.scheduled_deletion_at IS NOT NULL
        AND adr.scheduled_deletion_at <= now()
        AND COALESCE(j.state, 'missing') NOT IN ('queued', 'processing', 'completed')
      ) AS can_mark_completed
    FROM public.account_deletion_requests adr
    LEFT JOIN public.profiles p ON p.id = adr.user_id
    LEFT JOIN public.account_deletion_completion_jobs j ON j.deletion_request_id = adr.id
    WHERE v_status IS NULL OR adr.status = v_status
    ORDER BY adr.requested_at DESC NULLS LAST, adr.id DESC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rows.id,
        'user_id', rows.user_id,
        'user_name', rows.user_name,
        'status', rows.status,
        'reason', rows.reason,
        'requested_at', rows.requested_at,
        'scheduled_deletion_at', rows.scheduled_deletion_at,
        'cancelled_at', rows.cancelled_at,
        'completed_at', rows.completed_at,
        'can_mark_completed', rows.can_mark_completed,
        'completion_job_id', rows.completion_job_id,
        'completion_job_state', rows.completion_job_state,
        'completion_attempts', rows.completion_attempts,
        'completion_next_retry_at', rows.completion_next_retry_at,
        'completion_last_error', rows.completion_last_error,
        'completion_error_code', rows.completion_error_code,
        'completion_steps', rows.completion_steps,
        'legacy_checkpoint', rows.legacy_checkpoint
      )
      ORDER BY rows.requested_at DESC NULLS LAST, rows.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', v_pending_count,
      'completed', v_completed_count,
      'recovered', v_recovered_count,
      'other', v_other_count
    ),
    'rows', v_rows,
    'status', v_status,
    'limit', v_limit
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_account_deletion_completed(
  p_request_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_request public.account_deletion_requests%ROWTYPE;
  v_job public.account_deletion_completion_jobs%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_mark_account_deletion_completed',
    p_idempotency_key,
    jsonb_build_object('request_id', p_request_id, 'reason', v_reason, 'durable_completion_job', true)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT *
  INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Account deletion request was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF COALESCE(v_request.status, '') = 'completed' THEN
    SELECT * INTO v_job
    FROM public.account_deletion_completion_jobs
    WHERE deletion_request_id = p_request_id;

    v_response := public.admin_json_success(jsonb_build_object(
      'request_id', v_request.id,
      'user_id', v_request.user_id,
      'completed_at', v_request.completed_at,
      'completion_queued', false,
      'completion_job_id', v_job.id,
      'completion_job_state', v_job.state,
      'checkpoint_only', false,
      'auth_user_deleted', true,
      'profile_pii_scrubbed', true
    ));
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF COALESCE(v_request.status, '') <> 'pending' THEN
    v_response := public.admin_json_error(
      'INVALID_TRANSITION',
      'Only pending account deletion requests can have completion jobs queued.',
      jsonb_build_object('status', v_request.status)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF v_request.scheduled_deletion_at IS NULL OR v_request.scheduled_deletion_at > now() THEN
    v_response := public.admin_json_error(
      'INVALID_TRANSITION',
      'Account deletion request is not eligible for completion until its scheduled deletion date.',
      jsonb_build_object('scheduled_deletion_at', v_request.scheduled_deletion_at)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  INSERT INTO public.account_deletion_completion_jobs (
    deletion_request_id,
    user_id,
    state,
    requested_by,
    request_reason,
    next_retry_at,
    metadata
  ) VALUES (
    v_request.id,
    v_request.user_id,
    'queued',
    v_admin_id,
    v_reason,
    now(),
    jsonb_build_object('queued_from', 'admin_mark_account_deletion_completed')
  )
  ON CONFLICT (deletion_request_id) DO UPDATE
  SET state = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('queued', 'processing', 'completed')
        THEN public.account_deletion_completion_jobs.state
        ELSE 'queued'
      END,
      requested_by = EXCLUDED.requested_by,
      request_reason = EXCLUDED.request_reason,
      attempts = CASE
        WHEN public.account_deletion_completion_jobs.state = 'permanent_failed' THEN 0
        ELSE public.account_deletion_completion_jobs.attempts
      END,
      worker_id = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.worker_id
      END,
      lease_expires_at = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.lease_expires_at
      END,
      next_retry_at = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN now()
        ELSE public.account_deletion_completion_jobs.next_retry_at
      END,
      blocked_reason = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.blocked_reason
      END,
      last_error = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.last_error
      END,
      error_code = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.error_code
      END,
      last_error_at = CASE
        WHEN public.account_deletion_completion_jobs.state IN ('retryable_failed', 'blocked', 'permanent_failed') THEN NULL
        ELSE public.account_deletion_completion_jobs.last_error_at
      END,
      updated_at = now()
  RETURNING * INTO v_job;

  v_audit_id := public.log_admin_action(
    'account_deletion.completion_job_queued',
    'account_deletion_request',
    p_request_id,
    jsonb_build_object(
      'reason', v_reason,
      'completion_job_id', v_job.id,
      'completion_job_state', v_job.state,
      'checkpoint_only', false,
      'required_steps', jsonb_build_array('provider_cleanup', 'media_cleanup', 'pii_scrub', 'auth_delete'),
      'action_outcome', 'queued'
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'request_id', v_request.id,
    'user_id', v_request.user_id,
    'completion_queued', v_job.state <> 'completed',
    'completion_job_id', v_job.id,
    'completion_job_state', v_job.state,
    'audit_log_id', v_audit_id,
    'checkpoint_only', false,
    'auth_user_deleted', false,
    'profile_pii_scrubbed', false
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
END;
$function$;

CREATE TABLE IF NOT EXISTS public.support_reply_delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  reply_id uuid NOT NULL REFERENCES public.support_ticket_replies(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'email')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'processing', 'blocked', 'retryable_failed', 'permanent_failed', 'completed')),
  recipient_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email text,
  provider_id text,
  worker_id text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  error_code text,
  last_error_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (reply_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_support_reply_delivery_jobs_state_retry
  ON public.support_reply_delivery_jobs(state, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_support_reply_delivery_jobs_ticket
  ON public.support_reply_delivery_jobs(ticket_id, created_at DESC);

ALTER TABLE public.support_reply_delivery_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_reply_delivery_jobs_service_role_all
  ON public.support_reply_delivery_jobs;
CREATE POLICY support_reply_delivery_jobs_service_role_all
  ON public.support_reply_delivery_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS support_reply_delivery_jobs_admin_select
  ON public.support_reply_delivery_jobs;
CREATE POLICY support_reply_delivery_jobs_admin_select
  ON public.support_reply_delivery_jobs
  FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'support.manage'));

DROP FUNCTION IF EXISTS public.admin_create_support_reply(uuid, text, text);

CREATE OR REPLACE FUNCTION public.admin_create_support_reply(
  p_ticket_id uuid,
  p_message text,
  p_idempotency_key text DEFAULT NULL,
  p_send_email boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_ticket public.support_tickets%ROWTYPE;
  v_after public.support_tickets%ROWTYPE;
  v_reply public.support_ticket_replies%ROWTYPE;
  v_message text := btrim(COALESCE(p_message, ''));
  v_audit_id uuid;
  v_push_job_id uuid;
  v_email_job_id uuid;
  v_email_warning text := NULL;
  v_delivery_jobs jsonb := '[]'::jsonb;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.'); END IF;
  IF p_ticket_id IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Ticket id is required.'); END IF;
  IF v_message = '' THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Reply message is required.'); END IF;
  IF length(v_message) > 5000 THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Reply message is too long.'); END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_create_support_reply',
    p_idempotency_key,
    jsonb_build_object('ticket_id', p_ticket_id, 'message', v_message, 'send_email', COALESCE(p_send_email, true))
  );
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT *
  INTO v_ticket
  FROM public.support_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Support ticket was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_support_reply', p_idempotency_key, v_response);
  END IF;

  IF v_ticket.status = 'resolved' THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Reopen the support ticket before sending another reply.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_support_reply', p_idempotency_key, v_response);
  END IF;

  INSERT INTO public.support_ticket_replies (ticket_id, sender_type, sender_id, message)
  VALUES (p_ticket_id, 'admin', v_admin_id, v_message)
  RETURNING * INTO v_reply;

  UPDATE public.support_tickets
  SET status = 'waiting_on_user',
      updated_at = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_after;

  INSERT INTO public.support_reply_delivery_jobs (
    ticket_id,
    reply_id,
    channel,
    state,
    recipient_user_id,
    metadata
  ) VALUES (
    p_ticket_id,
    v_reply.id,
    'push',
    'queued',
    v_ticket.user_id,
    jsonb_build_object(
      'reference_id', v_ticket.reference_id,
      'title', 'Vibely Support',
      'body', 'We''ve replied to your request ' || v_ticket.reference_id,
      'url', '/settings/ticket/' || v_ticket.id::text
    )
  )
  ON CONFLICT (reply_id, channel) DO UPDATE
  SET state = CASE WHEN public.support_reply_delivery_jobs.state IN ('completed', 'processing') THEN public.support_reply_delivery_jobs.state ELSE 'queued' END,
      next_retry_at = now(),
      updated_at = now()
  RETURNING id INTO v_push_job_id;

  IF COALESCE(p_send_email, true) THEN
    IF NULLIF(btrim(COALESCE(v_ticket.user_email, '')), '') IS NULL THEN
      v_email_warning := 'Reply saved, but email delivery was requested and the ticket has no recipient email.';

      INSERT INTO public.support_reply_delivery_jobs (
        ticket_id,
        reply_id,
        channel,
        state,
        recipient_user_id,
        recipient_email,
        last_error,
        error_code,
        last_error_at,
        metadata
      ) VALUES (
        p_ticket_id,
        v_reply.id,
        'email',
        'blocked',
        v_ticket.user_id,
        NULL,
        'Email delivery requested but ticket has no recipient email.',
        'missing_recipient_email',
        now(),
        jsonb_build_object('reference_id', v_ticket.reference_id)
      )
      ON CONFLICT (reply_id, channel) DO UPDATE
      SET state = 'blocked',
          last_error = EXCLUDED.last_error,
          error_code = EXCLUDED.error_code,
          last_error_at = now(),
          updated_at = now()
      RETURNING id INTO v_email_job_id;
    ELSE
      INSERT INTO public.support_reply_delivery_jobs (
        ticket_id,
        reply_id,
        channel,
        state,
        recipient_user_id,
        recipient_email,
        metadata
      ) VALUES (
        p_ticket_id,
        v_reply.id,
        'email',
        'queued',
        v_ticket.user_id,
        v_ticket.user_email,
        jsonb_build_object('reference_id', v_ticket.reference_id)
      )
      ON CONFLICT (reply_id, channel) DO UPDATE
      SET state = CASE WHEN public.support_reply_delivery_jobs.state IN ('completed', 'processing') THEN public.support_reply_delivery_jobs.state ELSE 'queued' END,
          recipient_email = EXCLUDED.recipient_email,
          next_retry_at = now(),
          updated_at = now()
      RETURNING id INTO v_email_job_id;
    END IF;
  END IF;

  INSERT INTO public.support_ticket_events (ticket_id, actor_id, event_type, details)
  VALUES (
    p_ticket_id,
    v_admin_id,
    'admin_reply_created',
    jsonb_build_object(
      'reply_id', v_reply.id,
      'before_status', v_ticket.status,
      'after_status', v_after.status,
      'delivery_job_ids', jsonb_strip_nulls(jsonb_build_object('push', v_push_job_id, 'email', v_email_job_id)),
      'email_warning', v_email_warning
    )
  );

  v_audit_id := public.log_admin_action(
    'support.reply_create',
    'support_ticket',
    p_ticket_id,
    jsonb_build_object(
      'reply_id', v_reply.id,
      'before_status', v_ticket.status,
      'after_status', v_after.status,
      'delivery_job_ids', jsonb_strip_nulls(jsonb_build_object('push', v_push_job_id, 'email', v_email_job_id)),
      'email_warning', v_email_warning,
      'action_outcome', CASE WHEN v_email_warning IS NULL THEN 'queued' ELSE 'warning' END,
      'error_code', CASE WHEN v_email_warning IS NULL THEN NULL ELSE 'missing_recipient_email' END
    )
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', j.id,
      'channel', j.channel,
      'state', j.state,
      'attempts', j.attempts,
      'next_retry_at', j.next_retry_at,
      'last_error', j.last_error,
      'error_code', j.error_code,
      'provider_id', j.provider_id
    ) ORDER BY j.channel
  ), '[]'::jsonb)
  INTO v_delivery_jobs
  FROM public.support_reply_delivery_jobs j
  WHERE j.reply_id = v_reply.id;

  v_response := public.admin_json_success(jsonb_build_object(
    'ticket_id', p_ticket_id,
    'reply', to_jsonb(v_reply),
    'ticket', to_jsonb(v_after),
    'audit_log_id', v_audit_id,
    'delivery_jobs', v_delivery_jobs,
    'notification_warning', NULL,
    'email_warning', v_email_warning
  ));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_support_reply', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_support_reply_delivery_jobs_v1(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.support_reply_delivery_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  WITH claimable AS (
    SELECT j.id
    FROM public.support_reply_delivery_jobs j
    WHERE (
        j.state IN ('queued', 'retryable_failed')
        OR (j.state = 'processing' AND COALESCE(j.lease_expires_at, '-infinity'::timestamptz) < now())
      )
      AND j.next_retry_at <= now()
      AND j.attempts < j.max_attempts
    ORDER BY j.next_retry_at ASC, j.created_at ASC, j.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  )
  UPDATE public.support_reply_delivery_jobs j
  SET state = 'processing',
      worker_id = NULLIF(left(btrim(COALESCE(p_worker_id, '')), 160), ''),
      lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 15), 900)),
      attempts = j.attempts + 1,
      updated_at = now()
  FROM claimable
  WHERE j.id = claimable.id
  RETURNING j.*;
$function$;

CREATE OR REPLACE FUNCTION public.complete_support_reply_delivery_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_success boolean,
  p_provider_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_permanent boolean DEFAULT false,
  p_blocked boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_job public.support_reply_delivery_jobs%ROWTYPE;
  v_state text;
  v_retry_seconds integer;
BEGIN
  SELECT *
  INTO v_job
  FROM public.support_reply_delivery_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  END IF;

  IF v_job.state <> 'processing' OR COALESCE(v_job.worker_id, '') <> COALESCE(p_worker_id, '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_CLAIMED_BY_WORKER', 'state', v_job.state);
  END IF;

  IF COALESCE(p_success, false) THEN
    UPDATE public.support_reply_delivery_jobs
    SET state = 'completed',
        provider_id = COALESCE(NULLIF(btrim(COALESCE(p_provider_id, '')), ''), provider_id),
        lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, now()),
        last_error = NULL,
        error_code = NULL,
        last_error_at = NULL,
        updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true, 'job_id', p_job_id, 'state', 'completed');
  END IF;

  v_state := CASE
    WHEN COALESCE(p_blocked, false) THEN 'blocked'
    WHEN COALESCE(p_permanent, false) OR v_job.attempts >= v_job.max_attempts THEN 'permanent_failed'
    ELSE 'retryable_failed'
  END;
  v_retry_seconds := LEAST(GREATEST(COALESCE(p_retry_after_seconds, 60 * GREATEST(1, v_job.attempts)), 15), 86400);

  UPDATE public.support_reply_delivery_jobs
  SET state = v_state,
      lease_expires_at = NULL,
      next_retry_at = CASE WHEN v_state = 'retryable_failed' THEN now() + make_interval(secs => v_retry_seconds) ELSE next_retry_at END,
      last_error = left(COALESCE(p_error, 'Unknown delivery failure.'), 1000),
      error_code = NULLIF(left(btrim(COALESCE(p_error_code, '')), 120), ''),
      last_error_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object('success', true, 'job_id', p_job_id, 'state', v_state, 'retry_after_seconds', v_retry_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_support_ticket_thread(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_ticket_user_id uuid;
  v_ticket_exception_id uuid;
  v_ticket_json jsonb := NULL;
  v_profile jsonb := NULL;
  v_replies jsonb := '[]'::jsonb;
  v_linked_exception jsonb := NULL;
  v_events jsonb := '[]'::jsonb;
  v_delivery_jobs jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.');
  END IF;

  IF p_ticket_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Ticket id is required.');
  END IF;

  SELECT
    t.user_id,
    t.event_payment_exception_id,
    jsonb_build_object(
      'id', t.id,
      'reference_id', t.reference_id,
      'user_id', t.user_id,
      'event_id', t.event_id,
      'checkout_session_id', t.checkout_session_id,
      'event_payment_exception_id', t.event_payment_exception_id,
      'primary_type', t.primary_type,
      'subcategory', t.subcategory,
      'subject', t.subject,
      'status', t.status,
      'priority', t.priority,
      'message', t.message,
      'user_email', t.user_email,
      'platform', t.platform,
      'app_version', t.app_version,
      'device_model', t.device_model,
      'os_version', t.os_version,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'resolved_at', t.resolved_at,
      'assigned_to', t.assigned_to,
      'admin_notes', t.admin_notes
    )
  INTO v_ticket_user_id, v_ticket_exception_id, v_ticket_json
  FROM public.support_tickets t
  WHERE t.id = p_ticket_id;

  IF v_ticket_json IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Support ticket was not found.');
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'avatar_url', p.avatar_url
  )
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_ticket_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'ticket_id', r.ticket_id,
      'sender_type', r.sender_type,
      'sender_id', r.sender_id,
      'message', r.message,
      'is_read', r.is_read,
      'created_at', r.created_at
    ) ORDER BY r.created_at ASC, r.id ASC
  ), '[]'::jsonb)
  INTO v_replies
  FROM public.support_ticket_replies r
  WHERE r.ticket_id = p_ticket_id;

  SELECT jsonb_build_object(
    'id', e.id,
    'event_id', e.event_id,
    'profile_id', e.profile_id,
    'checkout_session_id', e.checkout_session_id,
    'support_ticket_id', e.support_ticket_id,
    'exception_type', e.exception_type,
    'exception_status', e.exception_status,
    'resolution', e.resolution,
    'settlement_outcome_snapshot', e.settlement_outcome_snapshot,
    'registration_admission_snapshot', e.registration_admission_snapshot,
    'event_status_snapshot', e.event_status_snapshot,
    'refund_handled_externally', e.refund_handled_externally,
    'external_refund_reference', e.external_refund_reference,
    'notes', e.notes,
    'resolved_at', e.resolved_at,
    'created_at', e.created_at,
    'updated_at', e.updated_at
  )
  INTO v_linked_exception
  FROM public.event_payment_exceptions e
  WHERE e.support_ticket_id = p_ticket_id
     OR (v_ticket_exception_id IS NOT NULL AND e.id = v_ticket_exception_id)
  ORDER BY e.updated_at DESC, e.created_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ste.id,
      'ticket_id', ste.ticket_id,
      'actor_id', ste.actor_id,
      'event_type', ste.event_type,
      'details', ste.details,
      'created_at', ste.created_at
    ) ORDER BY ste.created_at DESC, ste.id DESC
  ), '[]'::jsonb)
  INTO v_events
  FROM public.support_ticket_events ste
  WHERE ste.ticket_id = p_ticket_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', j.id,
      'ticket_id', j.ticket_id,
      'reply_id', j.reply_id,
      'channel', j.channel,
      'state', j.state,
      'recipient_user_id', j.recipient_user_id,
      'recipient_email', CASE WHEN j.recipient_email IS NULL THEN NULL ELSE '[redacted]' END,
      'provider_id', j.provider_id,
      'attempts', j.attempts,
      'next_retry_at', j.next_retry_at,
      'last_error', j.last_error,
      'error_code', j.error_code,
      'created_at', j.created_at,
      'updated_at', j.updated_at,
      'completed_at', j.completed_at
    ) ORDER BY j.created_at DESC, j.id DESC
  ), '[]'::jsonb)
  INTO v_delivery_jobs
  FROM public.support_reply_delivery_jobs j
  WHERE j.ticket_id = p_ticket_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'ticket', v_ticket_json,
    'profile', v_profile,
    'replies', v_replies,
    'linked_exception', v_linked_exception,
    'support_events', v_events,
    'delivery_jobs', v_delivery_jobs
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_admin_audit_logs(
  p_actor_id uuid DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_correlation_id text := gen_random_uuid()::text;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'audit.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Audit read permission is required.');
  END IF;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
  )
  SELECT count(*)::integer INTO v_total FROM filtered;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
  ),
  page AS (
    SELECT
      al.id,
      al.admin_id,
      admin_profile.name AS admin_name,
      al.action_type,
      al.target_type,
      al.target_id,
      al.details,
      al.request_id,
      al.correlation_id,
      al.action_outcome,
      al.error_code,
      al.created_at
    FROM filtered al
    LEFT JOIN public.profiles admin_profile ON admin_profile.id = al.admin_id
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM page;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details,
    correlation_id,
    action_outcome
  ) VALUES (
    v_admin_id,
    'admin_audit_logs.searched',
    'admin_activity_logs',
    NULL,
    jsonb_build_object(
      'correlation_id', v_correlation_id,
      'filters', jsonb_build_object(
        'actor_id', p_actor_id,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'action_type', p_action_type,
        'from', p_from,
        'to', p_to,
        'limit', v_limit,
        'offset', v_offset
      ),
      'result_count', jsonb_array_length(v_rows),
      'total_count', v_total,
      'action_outcome', 'success'
    ),
    v_correlation_id,
    'success'
  )
  RETURNING id INTO v_audit_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'scope', 'admin_activity_logs',
    'meta_audit_log_id', v_audit_id,
    'correlation_id', v_correlation_id,
    'incident_usage', 'Use action_type, target_type, target_id, actor, and date filters to reconstruct production-impacting admin actions.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_admin_audit_log_export_job_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NEW.scope_type = 'admin_audit_logs' THEN
    INSERT INTO public.admin_activity_logs (
      admin_id,
      action_type,
      target_type,
      target_id,
      details,
      correlation_id,
      action_outcome
    ) VALUES (
      NEW.created_by,
      'admin_audit_logs.exported',
      'data_export_job',
      NEW.id,
      jsonb_build_object(
        'scope_type', NEW.scope_type,
        'scope_filters', NEW.scope_filters,
        'format', NEW.format,
        'status', NEW.status
      ),
      gen_random_uuid()::text,
      'queued'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_admin_audit_log_export_job
  ON public.data_export_jobs;
CREATE TRIGGER trg_audit_admin_audit_log_export_job
  AFTER INSERT
  ON public.data_export_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_admin_audit_log_export_job_v1();

DO $$
DECLARE
  v_project_url text;
  v_cron_secret text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    SELECT btrim(decrypted_secret, E' \t\n\r')
    INTO v_project_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;

    SELECT btrim(decrypted_secret, E' \t\n\r')
    INTO v_cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
    LIMIT 1;

    IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_cron_secret, '') IS NULL THEN
      RAISE NOTICE 'process-admin-durable-jobs cron not scheduled: project_url or cron_secret Vault secret missing';
      RETURN;
    END IF;

    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'process-admin-durable-jobs';

    PERFORM cron.schedule(
      'process-admin-durable-jobs',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := btrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1), E' \t\n\r')
          || '/functions/v1/process-admin-durable-jobs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || btrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1), E' \t\n\r')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'action', 'all', 'batch_size', 25)
      );
      $cron$
    );
  ELSE
    RAISE NOTICE 'process-admin-durable-jobs cron not scheduled: pg_cron, pg_net, or Vault secrets table missing';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'process-admin-durable-jobs cron schedule skipped: %', SQLERRM;
END
$$;

REVOKE ALL ON FUNCTION public.scrub_account_deletion_profile_pii_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_due_account_deletion_completion_jobs_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_account_deletion_completion_jobs_v1(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_account_deletion_completion_step_v1(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_account_deletion_completion_job_v1(uuid, text, text, text, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_support_reply_delivery_jobs_v1(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_support_reply_delivery_job_v1(uuid, text, boolean, text, text, text, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_support_reply(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.scrub_account_deletion_profile_pii_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_account_deletion_completion_jobs_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_completion_jobs_v1(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion_completion_step_v1(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_account_deletion_completion_job_v1(uuid, text, text, text, integer, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_support_reply_delivery_jobs_v1(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_support_reply_delivery_job_v1(uuid, text, boolean, text, text, text, integer, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_support_reply(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260526020000',
  'Admin Sprint 2 durable compliance and audit workflows',
  'schema+policy',
  'Adds durable account deletion completion and support reply delivery queues, replaces checkpoint-only completion with worker-confirmed hard-delete semantics, expands audit metadata, and records meta-audits for audit searches/exports.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON TABLE public.account_deletion_completion_jobs IS
  'Durable completion queue for account deletion. A request may become completed only after provider cleanup, media cleanup, PII scrub, and Supabase auth deletion are all recorded.';

COMMENT ON TABLE public.support_reply_delivery_jobs IS
  'Durable support reply delivery queue for push and email, with provider ids, attempts, retry timing, and last error visibility.';

COMMENT ON FUNCTION public.admin_mark_account_deletion_completed(uuid, text, text) IS
  'Queues a durable account deletion completion job. It never marks the request completed until required hard-delete steps are recorded.';

COMMENT ON FUNCTION public.admin_create_support_reply(uuid, text, text, boolean) IS
  'Governed Support Inbox admin reply RPC. Inserts the reply, transitions ticket state, enqueues durable push/email delivery jobs, records support events, and audits.';

COMMENT ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) IS
  'Admin audit explorer with permission-checked filters, deterministic pagination ordering, and meta-audit logging of successful reads.';
