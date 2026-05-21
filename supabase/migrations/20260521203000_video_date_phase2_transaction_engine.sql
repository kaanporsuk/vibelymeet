-- Vibely Video Date v4 Phase 2.1-2.3 transaction engine.
--
-- Additive-only primitives:
--   PR 2.1: command idempotency helpers with request_hash conflict detection.
--   PR 2.2: lease-based provider outbox enqueue/claim/complete helpers.
--   PR 2.3: lease-based deadline claim/complete/finalize helpers.
--
-- Daily tokens/secrets must never be stored in these tables or payloads. The
-- foundation CHECK constraints remain the hard stop; these helpers also reject
-- non-object payloads and normalize all worker-owned payloads.
-- Inherited hard stops include video_session_commands_no_secret_keys,
-- video_session_events_no_payload_secret_keys, and
-- video_date_provider_outbox_no_secret_keys.

CREATE OR REPLACE FUNCTION public.video_date_command_request_hash_v2(
  p_session_id uuid,
  p_command_kind text,
  p_request_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT md5(
    COALESCE(p_session_id::text, '') || '|' ||
    lower(btrim(COALESCE(p_command_kind, ''))) || '|' ||
    COALESCE(
      CASE
        WHEN jsonb_typeof(COALESCE(p_request_payload, '{}'::jsonb)) = 'object'
          THEN COALESCE(p_request_payload, '{}'::jsonb)::text
        ELSE '{}'::jsonb::text
      END,
      '{}'::jsonb::text
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.video_date_command_request_hash_v2(uuid, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_command_request_hash_v2(uuid, text, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_command_request_hash_v2(uuid, text, jsonb) IS
  'Stable v4 command request hash. Includes session, command kind, and canonical jsonb payload.';

CREATE OR REPLACE FUNCTION public.video_session_command_begin_v2(
  p_session_id uuid,
  p_actor uuid,
  p_command_kind text,
  p_idempotency_key text,
  p_request_payload jsonb DEFAULT '{}'::jsonb,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_command public.video_session_commands%ROWTYPE;
  v_kind text := lower(btrim(COALESCE(p_command_kind, '')));
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_request_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_request_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_canonical_hash text;
  v_hash text;
BEGIN
  IF p_session_id IS NULL OR p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_command_scope');
  END IF;

  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF length(v_kind) < 2 OR length(v_kind) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_command_kind');
  END IF;

  IF length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  END IF;

  v_canonical_hash := public.video_date_command_request_hash_v2(
    p_session_id,
    v_kind,
    v_payload
  );
  v_hash := COALESCE(NULLIF(btrim(p_request_hash), ''), v_canonical_hash);

  IF length(v_hash) < 16 OR length(v_hash) > 160
     OR v_hash IS DISTINCT FROM v_canonical_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request_hash');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF p_actor IS DISTINCT FROM v_session.participant_1_id
     AND p_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  INSERT INTO public.video_session_commands (
    session_id,
    actor,
    command_kind,
    idempotency_key,
    request_hash,
    request_payload,
    status
  )
  VALUES (
    p_session_id,
    p_actor,
    v_kind,
    v_key,
    v_hash,
    v_payload,
    'processing'
  )
  ON CONFLICT (actor, idempotency_key) DO NOTHING
  RETURNING *
  INTO v_command;

  IF v_command.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'started',
      'commandId', v_command.id,
      'requestHash', v_command.request_hash
    );
  END IF;

  SELECT *
  INTO v_command
  FROM public.video_session_commands
  WHERE actor = p_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'command_lookup_failed');
  END IF;

  IF v_command.session_id IS DISTINCT FROM p_session_id
     OR v_command.command_kind IS DISTINCT FROM v_kind
     OR v_command.request_hash IS DISTINCT FROM v_hash
     OR v_command.request_payload IS DISTINCT FROM v_payload THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'idempotency_conflict',
      'status', 'idempotency_conflict',
      'commandId', v_command.id,
      'existingSessionId', v_command.session_id,
      'existingCommandKind', v_command.command_kind,
      'existingRequestHash', v_command.request_hash
    );
  END IF;

  IF v_command.status = 'committed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'replay',
      'commandId', v_command.id,
      'requestHash', v_command.request_hash,
      'result', COALESCE(v_command.result_payload, '{}'::jsonb)
    );
  END IF;

  IF v_command.status = 'rejected' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'replay_rejected',
      'commandId', v_command.id,
      'requestHash', v_command.request_hash,
      'result', COALESCE(v_command.result_payload, '{}'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'in_progress',
    'commandId', v_command.id,
    'requestHash', v_command.request_hash
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_command_begin_v2(uuid, uuid, text, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_command_begin_v2(uuid, uuid, text, text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public.video_session_command_begin_v2(uuid, uuid, text, text, jsonb, text) IS
  'Internal v4 command begin helper. Reused idempotency keys with different session/kind/hash/payload return idempotency_conflict.';

CREATE OR REPLACE FUNCTION public.video_session_command_finish_v2(
  p_command_id bigint,
  p_actor uuid,
  p_status text,
  p_result_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_result_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_result_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_command public.video_session_commands%ROWTYPE;
BEGIN
  IF p_command_id IS NULL OR p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_command_scope');
  END IF;

  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_status NOT IN ('committed', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_command_status');
  END IF;

  SELECT *
  INTO v_command
  FROM public.video_session_commands
  WHERE id = p_command_id
    AND actor = p_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'command_not_found');
  END IF;

  IF v_command.status IN ('committed', 'rejected') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'already_finished',
      'commandId', v_command.id,
      'result', COALESCE(v_command.result_payload, '{}'::jsonb)
    );
  END IF;

  UPDATE public.video_session_commands
  SET
    status = v_status,
    result_payload = v_payload,
    committed_at = now()
  WHERE id = p_command_id
    AND actor = p_actor
    AND status = 'processing'
  RETURNING *
  INTO v_command;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_command.status,
    'commandId', v_command.id,
    'result', COALESCE(v_command.result_payload, '{}'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_command_finish_v2(bigint, uuid, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_command_finish_v2(bigint, uuid, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.video_session_command_finish_v2(bigint, uuid, text, jsonb) IS
  'Internal v4 command finish helper. Result payload remains covered by no-secret constraints.';

CREATE OR REPLACE FUNCTION public.append_video_session_event_v2(
  p_session_id uuid,
  p_kind text,
  p_visibility text DEFAULT 'participants',
  p_actor uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_sanitized_payload jsonb DEFAULT '{}'::jsonb,
  p_bump_seq boolean DEFAULT true,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_kind, '')));
  v_visibility text := lower(btrim(COALESCE(p_visibility, 'participants')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_sanitized jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_sanitized_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_sanitized_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_seq bigint;
  v_event_id bigint;
BEGIN
  IF p_session_id IS NULL OR length(v_kind) < 2 OR length(v_kind) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_event');
  END IF;

  IF v_visibility NOT IN ('participants', 'actor_only', 'internal', 'safety_review') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_visibility');
  END IF;

  IF p_bump_seq THEN
    v_seq := public.bump_video_session_seq(p_session_id);
  ELSE
    SELECT COALESCE(session_seq, 0)
    INTO v_seq
    FROM public.video_sessions
    WHERE id = p_session_id;
  END IF;

  IF v_seq IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  INSERT INTO public.video_session_events (
    session_id,
    session_seq,
    kind,
    visibility,
    actor,
    payload,
    sanitized_payload,
    correlation_id
  )
  VALUES (
    p_session_id,
    v_seq,
    v_kind,
    v_visibility,
    p_actor,
    v_payload,
    v_sanitized,
    COALESCE(p_correlation_id, gen_random_uuid())
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'eventId', v_event_id,
    'sessionSeq', v_seq,
    'visibility', v_visibility
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.append_video_session_event_v2(uuid, text, text, uuid, jsonb, jsonb, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_video_session_event_v2(uuid, text, text, uuid, jsonb, jsonb, boolean, uuid)
  TO service_role;

COMMENT ON FUNCTION public.append_video_session_event_v2(uuid, text, text, uuid, jsonb, jsonb, boolean, uuid) IS
  'Appends a v4 session event and optionally bumps session_seq for user-visible state changes.';

CREATE OR REPLACE FUNCTION public.video_date_outbox_enqueue_v2(
  p_session_id uuid,
  p_kind text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_kind, '')));
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_dedupe text := NULLIF(left(btrim(COALESCE(p_dedupe_key, '')), 160), '');
  v_existing public.video_date_provider_outbox%ROWTYPE;
  v_outbox_id bigint;
BEGIN
  IF length(v_kind) < 2 OR length(v_kind) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_outbox_kind');
  END IF;

  IF v_dedupe IS NOT NULL THEN
    -- The partial unique index cannot protect NULL session_id rows because
    -- Postgres treats NULLs as distinct. Serialize every dedupe scope first.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'video_date_outbox_v2:' ||
      COALESCE(p_session_id::text, 'global') || ':' ||
      v_kind || ':' ||
      v_dedupe,
      0
    ));

    SELECT *
    INTO v_existing
    FROM public.video_date_provider_outbox
    WHERE session_id IS NOT DISTINCT FROM p_session_id
      AND kind = v_kind
      AND dedupe_key = v_dedupe
      AND state IN ('pending', 'claimed', 'done')
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.video_date_provider_outbox
      SET
        next_attempt_at = LEAST(next_attempt_at, COALESCE(p_next_attempt_at, now())),
        updated_at = now()
      WHERE id = v_existing.id
      RETURNING id INTO v_outbox_id;

      RETURN jsonb_build_object(
        'ok', true,
        'deduped', true,
        'outboxId', v_outbox_id,
        'state', v_existing.state
      );
    END IF;
  END IF;

  INSERT INTO public.video_date_provider_outbox (
    session_id,
    kind,
    payload,
    dedupe_key,
    next_attempt_at,
    state
  )
  VALUES (
    p_session_id,
    v_kind,
    v_payload,
    v_dedupe,
    COALESCE(p_next_attempt_at, now()),
    'pending'
  )
  RETURNING id INTO v_outbox_id;

  RETURN jsonb_build_object('ok', true, 'deduped', false, 'outboxId', v_outbox_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz) IS
  'Enqueues v4 provider side effects with optional pending/claimed dedupe. Payloads are no-secret checked.';

CREATE OR REPLACE FUNCTION public.claim_video_date_provider_outbox_v2(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE(
  id bigint,
  session_id uuid,
  kind text,
  payload jsonb,
  attempts integer,
  dedupe_key text,
  claim_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 300);
BEGIN
  IF v_worker = '' THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.video_date_provider_outbox o
    WHERE (
        o.state = 'pending'
        AND o.next_attempt_at <= now()
      )
      OR (
        o.state = 'claimed'
        AND o.claim_expires_at IS NOT NULL
        AND o.claim_expires_at <= now()
      )
    ORDER BY o.next_attempt_at ASC, o.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.video_date_provider_outbox o
    SET
      state = 'claimed',
      attempts = o.attempts + 1,
      claimed_at = now(),
      claim_expires_at = now() + (v_lease_seconds * interval '1 second'),
      claimed_by = v_worker,
      updated_at = now()
    FROM due
    WHERE o.id = due.id
    RETURNING
      o.id,
      o.session_id,
      o.kind,
      o.payload,
      o.attempts,
      o.dedupe_key,
      o.claim_expires_at
  )
  SELECT
    updated.id,
    updated.session_id,
    updated.kind,
    updated.payload,
    updated.attempts,
    updated.dedupe_key,
    updated.claim_expires_at
  FROM updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_provider_outbox_v2(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_date_provider_outbox_v2(text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_video_date_provider_outbox_v2(text, integer, integer) IS
  'Claims due provider outbox rows with FOR UPDATE SKIP LOCKED and crash-recoverable leases.';

CREATE OR REPLACE FUNCTION public.complete_video_date_provider_outbox_v2(
  p_outbox_id bigint,
  p_worker_id text,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_permanent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_row public.video_date_provider_outbox%ROWTYPE;
  v_error text := left(COALESCE(NULLIF(btrim(p_error), ''), 'worker_failed'), 1000);
  v_retry_seconds integer;
BEGIN
  IF p_outbox_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_outbox_completion');
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_date_provider_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'outbox_not_found');
  END IF;

  IF v_row.state = 'done' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'done', 'alreadyDone', true);
  END IF;

  IF v_row.state IS DISTINCT FROM 'claimed' OR v_row.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lease_mismatch',
      'state', v_row.state,
      'claimedBy', v_row.claimed_by
    );
  END IF;

  IF v_row.claim_expires_at IS NULL OR v_row.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  IF COALESCE(p_success, false) THEN
    UPDATE public.video_date_provider_outbox
    SET
      state = 'done',
      last_error = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_outbox_id;

    RETURN jsonb_build_object('ok', true, 'state', 'done');
  END IF;

  IF COALESCE(p_permanent, false) OR v_row.attempts >= 8 THEN
    UPDATE public.video_date_provider_outbox
    SET
      state = 'failed',
      last_error = v_error,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_outbox_id;

    RETURN jsonb_build_object('ok', true, 'state', 'failed', 'permanent', true);
  END IF;

  v_retry_seconds := LEAST(
    900,
    GREATEST(
      5,
      COALESCE(p_retry_after_seconds, LEAST(300, (2 ^ LEAST(v_row.attempts, 8))::integer))
    )
  );

  UPDATE public.video_date_provider_outbox
  SET
    state = 'pending',
    next_attempt_at = now() + (v_retry_seconds * interval '1 second'),
    last_error = v_error,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claimed_by = NULL,
    updated_at = now()
  WHERE id = p_outbox_id;

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'pending',
    'retryAfterSeconds', v_retry_seconds
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_video_date_provider_outbox_v2(bigint, text, boolean, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_video_date_provider_outbox_v2(bigint, text, boolean, text, integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.complete_video_date_provider_outbox_v2(bigint, text, boolean, text, integer, boolean) IS
  'Completes a leased provider outbox row. Stale workers cannot overwrite expired or re-claimed leases.';

CREATE OR REPLACE FUNCTION public.claim_video_session_deadlines_v2(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE(
  id bigint,
  session_id uuid,
  kind text,
  due_at timestamptz,
  attempts integer,
  claim_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 300);
BEGIN
  IF v_worker = '' THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT d.id
    FROM public.video_session_deadlines d
    WHERE (
        d.state = 'pending'
        AND d.due_at <= now()
      )
      OR (
        d.state = 'claimed'
        AND d.claim_expires_at IS NOT NULL
        AND d.claim_expires_at <= now()
      )
    ORDER BY d.due_at ASC, d.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.video_session_deadlines d
    SET
      state = 'claimed',
      attempts = d.attempts + 1,
      claimed_at = now(),
      claim_expires_at = now() + (v_lease_seconds * interval '1 second'),
      claimed_by = v_worker,
      updated_at = now()
    FROM due
    WHERE d.id = due.id
    RETURNING
      d.id,
      d.session_id,
      d.kind,
      d.due_at,
      d.attempts,
      d.claim_expires_at
  )
  SELECT
    updated.id,
    updated.session_id,
    updated.kind,
    updated.due_at,
    updated.attempts,
    updated.claim_expires_at
  FROM updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_session_deadlines_v2(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_session_deadlines_v2(text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_video_session_deadlines_v2(text, integer, integer) IS
  'Claims due video-session deadlines with FOR UPDATE SKIP LOCKED and crash-recoverable leases.';

CREATE OR REPLACE FUNCTION public.complete_video_session_deadline_v2(
  p_deadline_id bigint,
  p_worker_id text,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_permanent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_row public.video_session_deadlines%ROWTYPE;
  v_error text := left(COALESCE(NULLIF(btrim(p_error), ''), 'deadline_failed'), 1000);
  v_retry_seconds integer;
BEGIN
  IF p_deadline_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_deadline_completion');
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_session_deadlines
  WHERE id = p_deadline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deadline_not_found');
  END IF;

  IF v_row.state = 'done' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'done', 'alreadyDone', true);
  END IF;

  IF v_row.state IS DISTINCT FROM 'claimed' OR v_row.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lease_mismatch',
      'state', v_row.state,
      'claimedBy', v_row.claimed_by
    );
  END IF;

  IF v_row.claim_expires_at IS NULL OR v_row.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  IF COALESCE(p_success, false) THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'done',
      last_error = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object('ok', true, 'state', 'done');
  END IF;

  IF COALESCE(p_permanent, false) OR v_row.attempts >= 8 THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = v_error,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object('ok', true, 'state', 'failed', 'permanent', true);
  END IF;

  v_retry_seconds := LEAST(
    900,
    GREATEST(
      5,
      COALESCE(p_retry_after_seconds, LEAST(300, (2 ^ LEAST(v_row.attempts, 8))::integer))
    )
  );

  UPDATE public.video_session_deadlines
  SET
    state = 'pending',
    due_at = now() + (v_retry_seconds * interval '1 second'),
    last_error = v_error,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claimed_by = NULL,
    updated_at = now()
  WHERE id = p_deadline_id;

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'pending',
    'retryAfterSeconds', v_retry_seconds
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_video_session_deadline_v2(bigint, text, boolean, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_video_session_deadline_v2(bigint, text, boolean, text, integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.complete_video_session_deadline_v2(bigint, text, boolean, text, integer, boolean) IS
  'Completes a leased deadline row. Stale workers cannot overwrite expired or re-claimed leases.';

CREATE OR REPLACE FUNCTION public.finalize_video_session_deadline_v2(
  p_deadline_id bigint,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_deadline public.video_session_deadlines%ROWTYPE;
  v_before record;
  v_after record;
  v_result jsonb := '{}'::jsonb;
  v_success boolean := false;
  v_seconds_remaining integer;
  v_state_changed boolean := false;
BEGIN
  IF p_deadline_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_deadline_finalize');
  END IF;

  SELECT *
  INTO v_deadline
  FROM public.video_session_deadlines
  WHERE id = p_deadline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deadline_not_found');
  END IF;

  IF v_deadline.state = 'done' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'done', 'alreadyDone', true);
  END IF;

  IF v_deadline.state IS DISTINCT FROM 'claimed'
     OR v_deadline.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lease_mismatch',
      'state', v_deadline.state,
      'claimedBy', v_deadline.claimed_by
    );
  END IF;

  IF v_deadline.claim_expires_at IS NULL OR v_deadline.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  SELECT
    state::text AS state,
    phase,
    ended_at,
    ended_reason,
    date_started_at,
    handshake_started_at
  INTO v_before
  FROM public.video_sessions
  WHERE id = v_deadline.session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = 'session_not_found',
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'session_not_found',
      'state', 'failed'
    );
  END IF;

  IF v_deadline.kind = 'noop' THEN
    v_result := jsonb_build_object('success', true, 'state', COALESCE(v_before.state, 'unknown'));
  ELSIF v_deadline.kind IN ('handshake_auto_promote', 'handshake_timeout') THEN
    v_result := public.finalize_video_date_handshake_deadline(
      v_deadline.session_id,
      NULL,
      'deadline-finalizer-v2',
      v_deadline.kind
    );
  ELSE
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = 'unsupported_deadline_kind:' || v_deadline.kind,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unsupported_deadline_kind',
      'kind', v_deadline.kind,
      'state', 'failed'
    );
  END IF;

  v_success := COALESCE(
    CASE WHEN v_result ? 'success' THEN (v_result->>'success')::boolean ELSE NULL END,
    CASE WHEN v_result ? 'ok' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF NOT v_success THEN
    RETURN public.complete_video_session_deadline_v2(
      p_deadline_id,
      v_worker,
      false,
      COALESCE(v_result->>'code', v_result->>'error', 'deadline_transition_failed'),
      NULL,
      false
    );
  END IF;

  v_seconds_remaining := CASE
    WHEN v_result ? 'seconds_remaining' THEN NULLIF(v_result->>'seconds_remaining', '')::integer
    ELSE NULL
  END;

  IF COALESCE(v_result->>'state', '') = 'handshake'
     AND COALESCE(v_seconds_remaining, 0) > 0 THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'pending',
      due_at = now() + (v_seconds_remaining * interval '1 second'),
      last_error = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', true,
      'state', 'pending',
      'reason', 'deadline_not_due',
      'retryAfterSeconds', v_seconds_remaining,
      'result', v_result
    );
  END IF;

  UPDATE public.video_session_deadlines
  SET
    state = 'done',
    last_error = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claimed_by = NULL,
    updated_at = now()
  WHERE id = p_deadline_id;

  SELECT
    state::text AS state,
    phase,
    ended_at,
    ended_reason,
    date_started_at,
    handshake_started_at
  INTO v_after
  FROM public.video_sessions
  WHERE id = v_deadline.session_id;

  v_state_changed := (
    v_before.state IS DISTINCT FROM v_after.state
    OR v_before.phase IS DISTINCT FROM v_after.phase
    OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
    OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
    OR v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
  );

  IF v_state_changed THEN
    PERFORM public.append_video_session_event_v2(
      v_deadline.session_id,
      'deadline_finalized',
      'participants',
      NULL,
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateBefore', v_before.state,
        'stateAfter', v_after.state,
        'phaseBefore', v_before.phase,
        'phaseAfter', v_after.phase,
        'endedReason', v_after.ended_reason
      ),
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateBefore', v_before.state,
        'stateAfter', v_after.state,
        'phaseBefore', v_before.phase,
        'phaseAfter', v_after.phase,
        'endedReason', v_after.ended_reason
      ),
      true,
      gen_random_uuid()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'done',
    'deadlineKind', v_deadline.kind,
    'stateChanged', v_state_changed,
    'result', v_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_session_deadline_v2(bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_session_deadline_v2(bigint, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_video_session_deadline_v2(bigint, text) IS
  'Finalizes a claimed deadline through the current canonical transition path, then marks the deadline done/retry/failed under the same lease.';

DO $$
DECLARE
  v_project_url text;
  v_cron_secret text;
  v_has_vault boolean := false;
BEGIN
  -- Keep scheduling fail-soft. Environments without pg_cron/pg_net/Vault can
  -- still invoke these workers externally with CRON_SECRET.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    v_has_vault := EXISTS (
      SELECT 1
      FROM information_schema.views
      WHERE table_schema = 'vault'
        AND table_name = 'decrypted_secrets'
    );

    IF v_has_vault THEN
      SELECT trim(decrypted_secret)
      INTO v_project_url
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
      LIMIT 1;

      SELECT trim(decrypted_secret)
      INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_secret'
      LIMIT 1;
    END IF;

    IF NULLIF(v_project_url, '') IS NOT NULL AND NULLIF(v_cron_secret, '') IS NOT NULL THEN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname IN ('video-date-outbox-drainer', 'video-date-deadline-finalizer');

      PERFORM cron.schedule(
        'video-date-outbox-drainer',
        '* * * * *',
        $cron$
        SELECT net.http_post(
          url := trim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url'))
            || '/functions/v1/video-date-outbox-drainer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || trim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 25)
        );
        $cron$
      );

      PERFORM cron.schedule(
        'video-date-deadline-finalizer',
        '* * * * *',
        $cron$
        SELECT net.http_post(
          url := trim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url'))
            || '/functions/v1/video-date-deadline-finalizer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || trim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 25)
        );
        $cron$
      );
    ELSE
      RAISE NOTICE 'video-date phase2 workers not scheduled: missing Vault project_url or cron_secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'video-date phase2 worker cron scheduling skipped: %', SQLERRM;
END $$;
