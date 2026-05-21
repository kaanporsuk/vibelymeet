-- Vibely Video Date v4 foundation.
-- Additive only: establishes the token-free snapshot core, visibility-aware
-- event log, leaseable deadline/outbox tables, command idempotency with request
-- hashes, runtime readiness, and server-dealt deck impressions.

-- Synthetic monitors must never leak into real event surfaces.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_test_event boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.is_test_event IS
  'True only for isolated synthetic monitor events. User-facing event queries must exclude these rows by default.';

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS ready_gate_suppressed_until timestamptz;

COMMENT ON COLUMN public.event_registrations.ready_gate_suppressed_until IS
  'Server-owned suppression window after a manual Ready Gate exit; replaces client-only refs.';

-- Controlled sequence: transition RPCs/helper bump this only for user-visible
-- state changes. Do not use a broad UPDATE trigger; that creates noisy snapshot
-- invalidations from internal metadata writes.
ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS session_seq bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.video_sessions.session_seq IS
  'Monotonic user-visible session sequence. Bumped explicitly by v4 transition helpers, not every UPDATE.';

CREATE OR REPLACE FUNCTION public.bump_video_session_seq(p_session_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_seq bigint;
BEGIN
  UPDATE public.video_sessions
  SET session_seq = COALESCE(session_seq, 0) + 1
  WHERE id = p_session_id
  RETURNING session_seq INTO v_seq;

  RETURN v_seq;
END;
$function$;

REVOKE ALL ON FUNCTION public.bump_video_session_seq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_video_session_seq(uuid) TO service_role;

-- Visibility-aware event log. Only sanitized participant-visible events may be
-- broadcast to both clients. Internal/safety payloads stay server-side.
CREATE TABLE IF NOT EXISTS public.video_session_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  session_seq bigint NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  visibility text NOT NULL DEFAULT 'participants'
    CHECK (visibility IN ('participants', 'actor_only', 'internal', 'safety_review')),
  actor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS idx_vse_session_at
  ON public.video_session_events(session_id, at);

CREATE INDEX IF NOT EXISTS idx_vse_participant_broadcast
  ON public.video_session_events(session_id, session_seq)
  WHERE visibility = 'participants';

ALTER TABLE public.video_session_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_session_events FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  session_id,
  session_seq,
  at,
  kind,
  visibility,
  actor,
  sanitized_payload,
  correlation_id
) ON public.video_session_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_session_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_session_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Participants can read sanitized video session events"
  ON public.video_session_events;
CREATE POLICY "Participants can read sanitized video session events"
  ON public.video_session_events
  FOR SELECT
  USING (
    visibility = 'participants'
    AND EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = video_session_events.session_id
        AND (vs.participant_1_id = auth.uid() OR vs.participant_2_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Actors can read own actor-only video session events"
  ON public.video_session_events;
CREATE POLICY "Actors can read own actor-only video session events"
  ON public.video_session_events
  FOR SELECT
  USING (visibility = 'actor_only' AND actor = auth.uid());

COMMENT ON TABLE public.video_session_events IS
  'Append-only v4 session event log. Participant SELECT is restricted to sanitized participant-visible or actor-only rows.';

CREATE OR REPLACE VIEW public.video_session_participant_events
WITH (security_invoker = true) AS
SELECT
  id,
  session_id,
  session_seq,
  at,
  kind,
  visibility,
  actor,
  sanitized_payload AS payload,
  correlation_id
FROM public.video_session_events;

REVOKE ALL ON TABLE public.video_session_participant_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.video_session_participant_events TO authenticated;

COMMENT ON VIEW public.video_session_participant_events IS
  'Participant-safe video date event log view. Exposes sanitized_payload as payload and relies on video_session_events RLS.';

-- Deadline finalization with leases. Lease recovery jobs can reset expired
-- claimed rows back to pending if an Edge Function dies mid-claim.
CREATE TABLE IF NOT EXISTS public.video_session_deadlines (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'done', 'cancelled', 'failed')),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_vsd_due
  ON public.video_session_deadlines(state, due_at)
  WHERE state IN ('pending', 'claimed');

ALTER TABLE public.video_session_deadlines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_session_deadlines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_session_deadlines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_session_deadlines_id_seq TO service_role;

COMMENT ON TABLE public.video_session_deadlines IS
  'Internal v4 server deadlines with crash-recoverable leases.';

-- Command table. request_hash prevents a reused idempotency key from replaying
-- a result for a different command/session/payload.
CREATE TABLE IF NOT EXISTS public.video_session_commands (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  actor uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  command_kind text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'committed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  CONSTRAINT video_session_commands_key_length
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 160),
  CONSTRAINT video_session_commands_hash_length
    CHECK (length(btrim(request_hash)) BETWEEN 16 AND 160),
  UNIQUE (actor, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_vsc_session_actor
  ON public.video_session_commands(session_id, actor, created_at DESC);

ALTER TABLE public.video_session_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_session_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.video_session_commands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_session_commands TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_session_commands_id_seq TO service_role;

DROP POLICY IF EXISTS "Users can read own video session commands"
  ON public.video_session_commands;
CREATE POLICY "Users can read own video session commands"
  ON public.video_session_commands
  FOR SELECT
  USING (actor = auth.uid());

COMMENT ON TABLE public.video_session_commands IS
  'Concurrency-safe v4 command idempotency table with request_hash conflict detection.';

-- Side-effect outbox. Payloads are instructions/references only; tokens/secrets
-- must never be persisted here.
CREATE TABLE IF NOT EXISTS public.video_date_provider_outbox (
  id bigserial PRIMARY KEY,
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'done', 'failed')),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by text,
  last_error text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_provider_outbox_no_top_level_token
    CHECK (
      NOT (payload ? 'token')
      AND NOT (payload ? 'daily_token')
      AND NOT (payload ? 'meeting_token')
      AND NOT (payload ? 'meetingToken')
    )
);

CREATE INDEX IF NOT EXISTS idx_vdpo_due
  ON public.video_date_provider_outbox(state, next_attempt_at)
  WHERE state IN ('pending', 'claimed');

CREATE UNIQUE INDEX IF NOT EXISTS idx_vdpo_dedupe
  ON public.video_date_provider_outbox(session_id, kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'claimed');

ALTER TABLE public.video_date_provider_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_provider_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_provider_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_provider_outbox_id_seq TO service_role;

COMMENT ON TABLE public.video_date_provider_outbox IS
  'Internal v4 side-effect outbox. Payloads are references/instructions only; no Daily tokens or secrets.';

CREATE OR REPLACE FUNCTION public.video_date_jsonb_has_secret_key(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_key text;
  v_child jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN SELECT key, value FROM jsonb_each(p_value) LOOP
      IF lower(v_key) LIKE '%token%'
         OR lower(v_key) LIKE '%secret%'
         OR replace(replace(lower(v_key), '_', ''), '-', '') LIKE '%apikey%' THEN
        RETURN true;
      END IF;
      IF public.video_date_jsonb_has_secret_key(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF public.video_date_jsonb_has_secret_key(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_jsonb_has_secret_key(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_jsonb_has_secret_key(jsonb) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.video_session_events'::regclass
      AND conname = 'video_session_events_no_payload_secret_keys'
  ) THEN
    ALTER TABLE public.video_session_events
      ADD CONSTRAINT video_session_events_no_payload_secret_keys
      CHECK (
        NOT public.video_date_jsonb_has_secret_key(payload)
        AND NOT public.video_date_jsonb_has_secret_key(sanitized_payload)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.video_session_commands'::regclass
      AND conname = 'video_session_commands_no_secret_keys'
  ) THEN
    ALTER TABLE public.video_session_commands
      ADD CONSTRAINT video_session_commands_no_secret_keys
      CHECK (
        NOT public.video_date_jsonb_has_secret_key(request_payload)
        AND (
          result_payload IS NULL
          OR NOT public.video_date_jsonb_has_secret_key(result_payload)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.video_date_provider_outbox'::regclass
      AND conname = 'video_date_provider_outbox_no_secret_keys'
  ) THEN
    ALTER TABLE public.video_date_provider_outbox
      ADD CONSTRAINT video_date_provider_outbox_no_secret_keys
      CHECK (NOT public.video_date_jsonb_has_secret_key(payload));
  END IF;
END $$;

-- Runtime heartbeat/readiness. Supabase Presence remains display-only; this
-- table is the server-side matching eligibility input.
CREATE TABLE IF NOT EXISTS public.event_participant_runtime_state (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  foreground boolean NOT NULL DEFAULT true,
  readiness_status text NOT NULL DEFAULT 'unchecked'
    CHECK (readiness_status IN ('unchecked', 'ready', 'warning', 'blocked')),
  readiness_checked_at timestamptz,
  device_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_platform text CHECK (client_platform IS NULL OR client_platform IN ('web', 'ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_eprs_event_heartbeat
  ON public.event_participant_runtime_state(event_id, last_heartbeat_at DESC);

ALTER TABLE public.event_participant_runtime_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_participant_runtime_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_participant_runtime_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_participant_runtime_state TO service_role;

DROP POLICY IF EXISTS "Users can read own event runtime state"
  ON public.event_participant_runtime_state;
CREATE POLICY "Users can read own event runtime state"
  ON public.event_participant_runtime_state
  FOR SELECT
  USING (participant_id = auth.uid());

COMMENT ON TABLE public.event_participant_runtime_state IS
  'Persisted lobby heartbeat/readiness used by matching. Presence remains display-only.';

-- Server-dealt impressions. strongest_exclusion_reason is ranked so safety and
-- prior-pair exclusions cannot be downgraded by later seen/pass events.
CREATE TABLE IF NOT EXISTS public.event_profile_impressions (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_action text NOT NULL,
  last_action_at timestamptz NOT NULL DEFAULT now(),
  strongest_exclusion_reason text NOT NULL,
  source text NOT NULL DEFAULT 'server',
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, viewer_id, target_id),
  CHECK (viewer_id <> target_id),
  CHECK (last_action IN ('dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported')),
  CHECK (strongest_exclusion_reason IN ('dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported'))
);

CREATE INDEX IF NOT EXISTS idx_epi_viewer_event
  ON public.event_profile_impressions(viewer_id, event_id);

CREATE INDEX IF NOT EXISTS idx_epi_event_target
  ON public.event_profile_impressions(event_id, target_id);

ALTER TABLE public.event_profile_impressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_profile_impressions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_profile_impressions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_profile_impressions TO service_role;

DROP POLICY IF EXISTS "Users can read own event profile impressions"
  ON public.event_profile_impressions;
CREATE POLICY "Users can read own event profile impressions"
  ON public.event_profile_impressions
  FOR SELECT
  USING (viewer_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.event_profile_impression_events (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported')),
  source text NOT NULL DEFAULT 'server',
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_epie_viewer_event_created
  ON public.event_profile_impression_events(viewer_id, event_id, created_at DESC);

ALTER TABLE public.event_profile_impression_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_profile_impression_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_profile_impression_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_profile_impression_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.event_profile_impression_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Users can read own event profile impression events"
  ON public.event_profile_impression_events;
CREATE POLICY "Users can read own event profile impression events"
  ON public.event_profile_impression_events
  FOR SELECT
  USING (viewer_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_profile_impressions'::regclass
      AND conname = 'event_profile_impressions_no_metadata_secret_keys'
  ) THEN
    ALTER TABLE public.event_profile_impressions
      ADD CONSTRAINT event_profile_impressions_no_metadata_secret_keys
      CHECK (NOT public.video_date_jsonb_has_secret_key(metadata));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_profile_impression_events'::regclass
      AND conname = 'event_profile_impression_events_no_metadata_secret_keys'
  ) THEN
    ALTER TABLE public.event_profile_impression_events
      ADD CONSTRAINT event_profile_impression_events_no_metadata_secret_keys
      CHECK (NOT public.video_date_jsonb_has_secret_key(metadata));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.video_date_impression_rank(p_reason text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_reason
    WHEN 'dealt' THEN 10
    WHEN 'seen' THEN 20
    WHEN 'pass' THEN 30
    WHEN 'vibe' THEN 40
    WHEN 'super_vibe' THEN 50
    WHEN 'paired' THEN 80
    WHEN 'blocked' THEN 100
    WHEN 'reported' THEN 110
    ELSE 0
  END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_impression_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_impression_rank(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_event_profile_impression_v2(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_action text,
  p_source text DEFAULT 'server',
  p_session_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'server'), 80);
BEGIN
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_viewer_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_event_id IS NULL OR p_viewer_id IS NULL OR p_target_id IS NULL OR p_viewer_id = p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_impression');
  END IF;
  IF v_action NOT IN ('dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_viewer_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_registered');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_target_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_not_registered');
  END IF;

  INSERT INTO public.event_profile_impressions (
    event_id,
    viewer_id,
    target_id,
    last_action,
    strongest_exclusion_reason,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    p_viewer_id,
    p_target_id,
    v_action,
    v_action,
    v_source,
    p_session_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (event_id, viewer_id, target_id) DO UPDATE
  SET
    last_action = EXCLUDED.last_action,
    last_action_at = now(),
    strongest_exclusion_reason = CASE
      WHEN public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
           >= public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN EXCLUDED.strongest_exclusion_reason
      ELSE event_profile_impressions.strongest_exclusion_reason
    END,
    source = EXCLUDED.source,
    session_id = COALESCE(EXCLUDED.session_id, event_profile_impressions.session_id),
    metadata = event_profile_impressions.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.event_profile_impression_events (
    event_id,
    viewer_id,
    target_id,
    action,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    p_viewer_id,
    p_target_id,
    v_action,
    v_source,
    p_session_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true, 'action', v_action);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_event_profile_impression_v2(uuid, uuid, uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_event_profile_impression_v2(uuid, uuid, uuid, text, text, uuid, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_deck_deal_v2(
  p_event_id uuid,
  p_target_id uuid,
  p_source text DEFAULT 'client_top_card'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN public.record_event_profile_impression_v2(
    p_event_id,
    v_uid,
    p_target_id,
    'dealt',
    p_source,
    NULL,
    '{}'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_deck_deal_v2(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_deck_deal_v2(uuid, uuid, text)
  TO authenticated, service_role;

-- Token-free snapshot core. Edge Functions that hold Daily credentials wrap this
-- response and mint per-user tokens; this function never returns/stores tokens.
CREATE OR REPLACE FUNCTION public.get_video_date_snapshot_core(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_at timestamptz;
  v_allowed text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_session.ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  IF v_deadline_at IS NULL THEN
    v_deadline_at := CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END;
  END IF;

  v_allowed := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_phase = 'ended' THEN ARRAY['submit_verdict']::text[]
    WHEN v_phase = 'ready_gate' THEN ARRAY['mark_ready', 'forfeit', 'report_block']::text[]
    WHEN v_phase = 'handshake' THEN ARRAY['continue', 'pass', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'date' THEN ARRAY['spend_extension', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'verdict' THEN ARRAY['submit_verdict', 'report_block']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sessionId', v_session.id,
    'seq', COALESCE(v_session.session_seq, 0),
    'serverNow', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
    'phase', v_phase,
    'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
    'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
    'allowedActions', to_jsonb(v_allowed),
    'participants', jsonb_build_array(
      jsonb_build_object(
        'id', v_session.participant_1_id,
        'isSelf', v_session.participant_1_id = v_uid,
        'isPartner', v_session.participant_1_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_1_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_joined_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_1_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_away_at) * 1000)::bigint END
      ),
      jsonb_build_object(
        'id', v_session.participant_2_id,
        'isSelf', v_session.participant_2_id = v_uid,
        'isPartner', v_session.participant_2_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_2_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_joined_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_2_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_away_at) * 1000)::bigint END
      )
    ),
    'room', CASE
      WHEN v_session.daily_room_url IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', v_session.daily_room_name,
        'url', v_session.daily_room_url,
        'tokenRequired', true
      )
    END,
    'endedReason', v_session.ended_reason,
    'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_snapshot_core(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_snapshot_core(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_video_date_snapshot_core(uuid) IS
  'Token-free video date snapshot. Daily token minting stays in authorized Edge Functions that hold provider credentials.';

CREATE OR REPLACE FUNCTION public.record_heartbeat_v2(
  p_event_id uuid,
  p_foreground boolean DEFAULT true,
  p_client_platform text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_platform text := lower(NULLIF(btrim(COALESCE(p_client_platform, '')), ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_platform IS NOT NULL AND v_platform NOT IN ('web', 'ios', 'android') THEN
    v_platform := NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = v_uid
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_registered');
  END IF;

  INSERT INTO public.event_participant_runtime_state (
    event_id,
    participant_id,
    last_heartbeat_at,
    foreground,
    client_platform
  )
  VALUES (p_event_id, v_uid, now(), COALESCE(p_foreground, true), v_platform)
  ON CONFLICT (event_id, participant_id) DO UPDATE
  SET
    last_heartbeat_at = now(),
    foreground = EXCLUDED.foreground,
    client_platform = COALESCE(EXCLUDED.client_platform, event_participant_runtime_state.client_platform),
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_heartbeat_v2(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_heartbeat_v2(uuid, boolean, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_readiness_check_v2(
  p_event_id uuid,
  p_status text,
  p_capabilities jsonb DEFAULT '{}'::jsonb,
  p_client_platform text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_platform text := lower(NULLIF(btrim(COALESCE(p_client_platform, '')), ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_status NOT IN ('ready', 'warning', 'blocked', 'unchecked') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_readiness_status');
  END IF;
  IF v_platform IS NOT NULL AND v_platform NOT IN ('web', 'ios', 'android') THEN
    v_platform := NULL;
  END IF;
  IF jsonb_typeof(COALESCE(p_capabilities, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_capabilities');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = v_uid
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_registered');
  END IF;

  INSERT INTO public.event_participant_runtime_state (
    event_id,
    participant_id,
    last_heartbeat_at,
    foreground,
    readiness_status,
    readiness_checked_at,
    device_capabilities,
    client_platform
  )
  VALUES (
    p_event_id,
    v_uid,
    now(),
    true,
    v_status,
    now(),
    COALESCE(p_capabilities, '{}'::jsonb),
    v_platform
  )
  ON CONFLICT (event_id, participant_id) DO UPDATE
  SET
    last_heartbeat_at = now(),
    foreground = true,
    readiness_status = EXCLUDED.readiness_status,
    readiness_checked_at = now(),
    device_capabilities = EXCLUDED.device_capabilities,
    client_platform = COALESCE(EXCLUDED.client_platform, event_participant_runtime_state.client_platform),
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'readiness_status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_readiness_check_v2(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_readiness_check_v2(uuid, text, jsonb, text)
  TO authenticated, service_role;

-- Deck v2 keeps the existing get_event_deck contract, excludes server-side
-- impressions, and records the top dealt card. Clients should also call
-- record_deck_deal_v2 when the visible top card changes.
CREATE OR REPLACE FUNCTION public.get_event_deck_v2(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  profile_id uuid,
  name text,
  age integer,
  gender text,
  avatar_url text,
  photos text[],
  about_me text,
  job text,
  location text,
  height_cm integer,
  tagline text,
  looking_for text,
  queue_status text,
  has_met_before boolean,
  is_already_connected boolean,
  has_super_vibed boolean,
  shared_vibe_count integer,
  primary_photo_path text,
  photo_verified boolean,
  premium_badge text,
  availability_state text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 50));
  v_scan_limit integer := LEAST(GREATEST(GREATEST(1, LEAST(COALESCE(p_limit, 50), 50)) * 5, 200), 500);
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'not_registered' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_date_deck_v2:' || p_event_id::text || ':' || p_user_id::text, 0)
  );

  RETURN QUERY
  WITH raw_deck AS (
    SELECT *
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit)
  ),
  filtered AS (
    SELECT rd.*
    FROM raw_deck rd
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_profile_impressions epi
      WHERE epi.event_id = p_event_id
        AND epi.viewer_id = p_user_id
        AND epi.target_id = rd.profile_id
        AND public.video_date_impression_rank(epi.strongest_exclusion_reason) >= public.video_date_impression_rank('dealt')
    )
  ),
  ranked AS (
    SELECT filtered.*, row_number() OVER () AS rn
    FROM filtered
    LIMIT v_limit
  ),
  mark_top AS (
    SELECT public.record_event_profile_impression_v2(
      p_event_id,
      p_user_id,
      ranked.profile_id,
      'dealt',
      'get_event_deck_v2_top',
      NULL,
      jsonb_build_object('server_dealt', true)
    ) AS result
    FROM ranked
    WHERE ranked.rn = 1
  )
  SELECT
    ranked.profile_id,
    ranked.name,
    ranked.age,
    ranked.gender,
    ranked.avatar_url,
    ranked.photos,
    ranked.about_me,
    ranked.job,
    ranked.location,
    ranked.height_cm,
    ranked.tagline,
    ranked.looking_for,
    ranked.queue_status,
    ranked.has_met_before,
    ranked.is_already_connected,
    ranked.has_super_vibed,
    ranked.shared_vibe_count,
    ranked.primary_photo_path,
    ranked.photo_verified,
    ranked.premium_badge,
    ranked.availability_state
  FROM ranked
  LEFT JOIN mark_top ON true
  ORDER BY ranked.rn;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v2(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v2(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v2(uuid, uuid, integer) IS
  'Server-dealt event deck. Excludes event_profile_impressions and records the top dealt card to prevent duplicate top-card resurfacing after refresh/crash.';
