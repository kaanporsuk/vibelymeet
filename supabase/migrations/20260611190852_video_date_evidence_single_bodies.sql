BEGIN;

-- ============================================================================
-- Video Date rebuild PR 3: rewrite the evidence-family RPCs as single
-- self-contained bodies and drop their historical public generations.
--
-- Families rewritten (names/signatures unchanged):
--   - public.claim_video_date_surface(uuid, text, text, boolean, integer)
--   - public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
--   - public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
--   - public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text)
--   (public.release_video_date_surface_claim was already a single body and is
--   intentionally untouched.)
--
-- Each head previously delegated through a per-family onion of dated public
-- "base" generations. This migration implements the EFFECTIVE composition of
-- each live chain (pinned by supabase/contract-fixtures/2026-06/ and the PR-1
-- truth-pin suite) in one body, preserving:
--   - surface-claim single-active-owner semantics: per-profile claim upsert,
--     stale-claim expiry, takeover-gated SURFACE_CLAIM_CONFLICT, surface
--     state gating (ready_gate / video_date / post_date_survey), the
--     video_date_surface_claim_events ledger ('claim' rows) and the
--     terminal-truth audit stamping of recent claim events;
--   - daily_alive heartbeat semantics: lifecycle eligibility precheck,
--     current-provider-session proof precheck (structured ok:true no-op when
--     proof is missing), webhook-backed provider-presence gating, throttled
--     client_daily_alive presence ledger rows, joined-stamp/away-clear/
--     reconnect-grace-clear, stable-copresence handshake start, and
--     event_registrations in_handshake/in_date continuity;
--   - daily_joined: delegation to canonical mark_video_date_daily_alive as
--     the single heartbeat truth, plus joined markers and the
--     provider_backed_joined overlap-promotion pass;
--   - remote_seen provider-proof requirements: owner_id, call_instance_id,
--     provider_session_id, entry_attempt_id, owner_state='joined', current
--     provider webhook join, and a fresh (15s) matching owner heartbeat;
--     stale/non-owner calls return structured no-op JSON with the pinned
--     rejection-code matrix and never mutate encounter truth; render-evidence
--     source allow-list unchanged;
--   - the stable-bilateral-media gate + auto-promote interplay: the shared
--     promotion owners video_date_promote_confirmed_encounter_v1 and
--     video_date_promote_provider_overlap_v1 (and the separate
--     video_session_handshake_auto_promote_v2 path) are untouched and are
--     called in the same order with the same arguments;
--   - the lifecycle enrichment pipeline (enrich_v1 passes,
--     sanitize_client_failsoft_v1, enrich_and_sanitize_v2), payload marker
--     keys, retry semantics, server_now_ms fields, and
--     authenticated/service_role-only grants.
--
-- Intentional changes versus the literal chains (called out in the PR):
--   - raw 'sqlstate' / 'sql_message' / 'message' / 'detail' / 'hint'
--     fragments no longer enter authenticated client failure payloads (same
--     rule as rebuild PR 2); core exceptions are routed into
--     public.video_date_lifecycle_observe_exception_v2 and the sanitized
--     structured failure payloads keep their codes and retry semantics;
--   - per-layer pure fail-soft wrappers (outer/single_owner/grace/strict
--     shells) collapse into the single body's exception structure; the
--     wrapper-failure code SURFACE_CLAIM_WRAPPER_FAILED is preserved for
--     pipeline failures in the claim head;
--   - dead duplicate guards that re-checked auth/participant on rows already
--     locked and verified earlier in the same body are not carried over;
--   - the two uuid-only mark_video_date_daily_joined generations
--     (20260604093000_failsoft / 20260605170249_outer) were detached from the
--     live chain and are dropped without replacement.
--
-- Dropped public functions (26; no remaining callers — verified via prosrc
-- scan across all schemas, pg_depend, cron.job, and repo grep):
--   claim family:
--     claim_video_date_surface_20260604093000_failsoft_base
--     claim_video_date_surface_20260605170249_outer_base
--     claim_video_date_surface_20260605232304_single_owner_base
--     claim_video_date_surface_20260607155414_lifecycle_base
--     claim_video_date_surface_20260608080938_last_resort_base
--     vd_claim_surface_terminal_truth_base
--     vd_claim_surface_20260609130139_hot_base
--   daily_joined family:
--     mark_video_date_daily_joined_20260604093000_failsoft_base (uuid)
--     mark_video_date_daily_joined_20260605170249_outer_base (uuid)
--     mark_video_date_daily_joined_20260607155414_lifecycle_base
--     mark_video_date_daily_joined_20260607222923_definitive_base
--     mark_video_date_daily_joined_20260608080938_last_resort_base
--     mark_video_date_daily_joined_20260609105249_active_entry_base
--     vd_daily_joined_20260609130139_hot_base
--   daily_alive family:
--     mark_video_date_daily_alive_20260607155414_lifecycle_base
--     mark_video_date_daily_alive_20260607222923_definitive_base
--     mark_video_date_daily_alive_20260608080938_last_resort_base
--     vd_daily_alive_remote_seen_base
--     vd_alive_strict_provider_base  (live chain layer not in the original
--       enumeration; inlined here and dropped — it was only referenced by
--       vd_daily_alive_20260609130139_hot_base)
--     vd_daily_alive_20260609130139_hot_base
--   remote_seen family:
--     mark_video_date_remote_seen_20260605115657_base (uuid)
--     mark_video_date_remote_seen_20260605170249_outer_base (uuid)
--     mark_video_date_remote_seen_20260605200729_grace_base (uuid)
--     mark_video_date_remote_seen_20260607155414_lifecycle_base (uuid)
--     mark_video_date_remote_seen_20260608120000_provider_base (uuid)
--     vd_remote_seen_render_base
--
-- Intentionally retained: vd_daily_webhook_terminal_truth_base — it belongs
-- to the Daily webhook ledger family (live base of
-- record_video_date_daily_webhook_event_v2), which this PR preserves.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. claim_video_date_surface: single body
--    (formerly head -> vd_claim_surface_20260609130139_hot_base ->
--     vd_claim_surface_terminal_truth_base -> ..._20260608080938_last_resort
--     -> ..._20260607155414_lifecycle -> ..._20260605232304_single_owner ->
--     ..._20260605170249_outer -> ..._20260604093000_failsoft)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_video_date_surface(
  p_session_id uuid,
  p_surface text,
  p_client_instance_id text,
  p_takeover boolean DEFAULT false,
  p_ttl_seconds integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_now timestamptz := now();
  v_surface text := lower(btrim(COALESCE(p_surface, '')));
  v_client_instance_id text := left(btrim(COALESCE(p_client_instance_id, '')), 120);
  v_ttl_seconds integer := GREATEST(5, LEAST(COALESCE(p_ttl_seconds, 12), 60));
  v_session public.video_sessions%ROWTYPE;
  v_existing public.video_date_surface_claims%ROWTYPE;
  v_surface_allowed boolean := false;
  v_result jsonb;
  v_result_code text;
  v_ok boolean;
  v_blocked boolean;
  v_retryable boolean;
  v_term record;
  v_updated integer := 0;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Core claim machine (formerly the 20260604093000 failsoft base). ──
    BEGIN
      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
      ELSIF v_surface NOT IN ('ready_gate', 'video_date', 'post_date_survey') THEN
        v_result := jsonb_build_object('success', false, 'code', 'INVALID_SURFACE', 'error', 'invalid_surface');
      ELSIF length(v_client_instance_id) < 8 THEN
        v_result := jsonb_build_object('success', false, 'code', 'INVALID_CLIENT_INSTANCE', 'error', 'invalid_client_instance');
      ELSE
        SELECT * INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF v_session.id IS NULL THEN
          v_result := jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
        ELSIF v_session.participant_1_id IS DISTINCT FROM v_actor
          AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
          v_result := jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
        ELSE
          v_surface_allowed := CASE v_surface
            WHEN 'ready_gate' THEN
              public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
              AND v_session.state = 'ready_gate'::public.video_date_state
            WHEN 'video_date' THEN
              public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
              AND (
                v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
                OR v_session.handshake_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
              )
            WHEN 'post_date_survey' THEN
              public.video_date_session_is_post_date_survey_eligible(
                v_session.ended_at,
                v_session.ended_reason,
                v_session.date_started_at,
                v_session.state::text,
                v_session.phase,
                v_session.participant_1_joined_at,
                v_session.participant_2_joined_at
              )
            ELSE false
          END;

          IF NOT v_surface_allowed THEN
            v_result := jsonb_build_object(
              'success', false,
              'code', 'SURFACE_NOT_CLAIMABLE',
              'error', 'surface_not_claimable',
              'state', v_session.state,
              'phase', v_session.phase,
              'ended_reason', v_session.ended_reason
            );
          ELSE
            UPDATE public.video_date_surface_claims
            SET released_at = COALESCE(released_at, v_now), updated_at = v_now
            WHERE profile_id = v_actor
              AND released_at IS NULL
              AND expires_at <= v_now;

            SELECT * INTO v_existing
            FROM public.video_date_surface_claims
            WHERE profile_id = v_actor
            FOR UPDATE;

            IF v_existing.profile_id IS NOT NULL
               AND v_existing.released_at IS NULL
               AND v_existing.expires_at > v_now
               AND (
                 v_existing.session_id IS DISTINCT FROM p_session_id
                 OR v_existing.client_instance_id IS DISTINCT FROM v_client_instance_id
               )
               AND NOT p_takeover THEN
              v_result := jsonb_build_object(
                'success', false,
                'code', 'SURFACE_CLAIM_CONFLICT',
                'error', 'surface_claim_conflict',
                'conflict_session_id', v_existing.session_id,
                'conflict_surface', v_existing.surface,
                'expires_at', v_existing.expires_at
              );
            ELSE
              INSERT INTO public.video_date_surface_claims (
                profile_id,
                session_id,
                surface,
                client_instance_id,
                claimed_at,
                expires_at,
                released_at,
                updated_at
              )
              VALUES (
                v_actor,
                p_session_id,
                v_surface,
                v_client_instance_id,
                v_now,
                v_now + make_interval(secs => v_ttl_seconds),
                NULL,
                v_now
              )
              ON CONFLICT (profile_id)
              DO UPDATE SET
                session_id = EXCLUDED.session_id,
                surface = EXCLUDED.surface,
                client_instance_id = EXCLUDED.client_instance_id,
                claimed_at = EXCLUDED.claimed_at,
                expires_at = EXCLUDED.expires_at,
                released_at = NULL,
                updated_at = EXCLUDED.updated_at;

              v_result := jsonb_build_object(
                'success', true,
                'session_id', p_session_id,
                'surface', v_surface,
                'expires_at', v_now + make_interval(secs => v_ttl_seconds),
                'takeover', p_takeover
              );
            END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        -- Raw diagnostics go to server-side observability, never into
        -- authenticated client payloads (formerly the outer/single_owner
        -- fail-soft shells, which leaked sqlstate/message/detail/hint).
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'claim_video_date_surface.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'surface_claim_failed',
          'code', 'SURFACE_CLAIM_FAILED',
          'error_code', 'SURFACE_CLAIM_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Surface-claim event ledger (formerly the 20260607155414 lifecycle
    -- base). Best effort; never blocks the claim result. ──
    v_result_code := public.video_date_client_stuck_safe_text(
      COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error', v_result->>'reason'),
      120
    );
    v_ok := CASE lower(COALESCE(v_result->>'ok', v_result->>'success', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE NULL
    END;
    v_blocked := CASE lower(COALESCE(v_result->>'blocked', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE CASE
        WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN true
        ELSE NULL
      END
    END;
    v_retryable := CASE lower(COALESCE(v_result->>'retryable', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE NULL
    END;

    BEGIN
      INSERT INTO public.video_date_surface_claim_events (
        session_id,
        actor_id,
        surface,
        client_instance_id,
        action,
        takeover,
        ttl_seconds,
        ok,
        blocked,
        retryable,
        result_code,
        detail
      ) VALUES (
        p_session_id,
        v_actor,
        public.video_date_client_stuck_safe_text(p_surface, 80),
        public.video_date_client_stuck_safe_text(p_client_instance_id, 160),
        'claim',
        COALESCE(p_takeover, false),
        CASE
          WHEN p_ttl_seconds IS NULL THEN NULL
          ELSE LEAST(3600, GREATEST(1, p_ttl_seconds))
        END,
        v_ok,
        v_blocked,
        v_retryable,
        v_result_code,
        jsonb_strip_nulls(jsonb_build_object(
          'result', v_result,
          'source', 'claim_video_date_surface',
          'ok_source', CASE
            WHEN v_result ? 'ok' THEN 'ok'
            WHEN v_result ? 'success' THEN 'success'
            ELSE NULL
          END,
          'blocked_source', CASE
            WHEN v_result ? 'blocked' THEN 'blocked'
            WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN 'code'
            ELSE NULL
          END
        ))
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    -- ── Lifecycle enrichment + sanitization (formerly the 20260608080938
    -- last-resort and vd_claim_surface_terminal_truth bases). ──
    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'claim_video_date_surface',
      v_result
    );

    -- ── Terminal-truth audit stamping (formerly vd_claim_surface
    -- 20260609130139 hot base). ──
    SELECT
      vs.id,
      vs.event_id,
      vs.terminal_generation,
      vs.state_updated_at,
      vs.ended_at,
      vs.ended_reason,
      vs.terminal_audit_at,
      vs.terminal_audit_reason
    INTO v_term
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    IF FOUND THEN
      UPDATE public.video_date_surface_claim_events e
      SET
        session_terminal_generation = v_term.terminal_generation,
        session_state_updated_at = v_term.state_updated_at,
        session_ended_at = v_term.ended_at,
        session_ended_reason = v_term.ended_reason,
        detail = COALESCE(e.detail, '{}'::jsonb)
          || jsonb_build_object(
            'session_terminal_generation', v_term.terminal_generation,
            'session_state_updated_at', v_term.state_updated_at,
            'session_ended_at', v_term.ended_at,
            'session_ended_reason', v_term.ended_reason,
            'terminal_audit_at', v_term.terminal_audit_at,
            'terminal_audit_reason', v_term.terminal_audit_reason
          )
      WHERE e.id IN (
        SELECT recent.id
        FROM public.video_date_surface_claim_events recent
        WHERE recent.session_id = p_session_id
          AND recent.surface = COALESCE(NULLIF(p_surface, ''), recent.surface)
          AND (
            p_client_instance_id IS NULL
            OR recent.client_instance_id = p_client_instance_id
          )
        ORDER BY recent.created_at DESC, recent.id DESC
        LIMIT 3
      );

      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        INSERT INTO public.video_date_surface_claim_events (
          session_id,
          surface,
          actor_id,
          client_instance_id,
          action,
          takeover,
          ttl_seconds,
          ok,
          blocked,
          retryable,
          result_code,
          detail,
          session_terminal_generation,
          session_state_updated_at,
          session_ended_at,
          session_ended_reason
        ) VALUES (
          p_session_id,
          COALESCE(NULLIF(p_surface, ''), 'video_date'),
          v_actor,
          NULLIF(p_client_instance_id, ''),
          'claim_terminal_audit',
          COALESCE(p_takeover, false),
          p_ttl_seconds,
          lower(COALESCE(v_result->>'ok', v_result->>'success', 'false')) IN ('true', 't', '1', 'yes'),
          lower(COALESCE(v_result->>'blocked', 'false')) IN ('true', 't', '1', 'yes'),
          lower(COALESCE(v_result->>'retryable', 'false')) IN ('true', 't', '1', 'yes'),
          COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error'),
          COALESCE(v_result, '{}'::jsonb)
            || jsonb_build_object(
              'session_terminal_generation', v_term.terminal_generation,
              'session_state_updated_at', v_term.state_updated_at,
              'session_ended_at', v_term.ended_at,
              'session_ended_reason', v_term.ended_reason,
              'terminal_audit_at', v_term.terminal_audit_at,
              'terminal_audit_reason', v_term.terminal_audit_reason
            ),
          v_term.terminal_generation,
          v_term.state_updated_at,
          v_term.ended_at,
          v_term.ended_reason
        );
      END IF;

      v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'session_terminal_generation', v_term.terminal_generation,
        'session_state_updated_at', v_term.state_updated_at,
        'session_ended_at', v_term.ended_at,
        'session_ended_reason', v_term.ended_reason
      );
    END IF;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'claim_video_date_surface.single_body',
          'surface_claim_wrapper_failed',
          'SURFACE_CLAIM_WRAPPER_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'claim_video_date_surface',
            'surface', left(btrim(COALESCE(p_surface, '')), 80),
            'client_instance_id', NULLIF(left(btrim(COALESCE(p_client_instance_id, '')), 180), ''),
            'error', 'surface_claim_failed',
            'reason', 'surface_claim_failed',
            'code', 'SURFACE_CLAIM_FAILED',
            'error_code', 'SURFACE_CLAIM_FAILED',
            'retryable', true,
            'terminal', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Single-body Video Date surface-claim RPC (rebuild PR 3). Single-active-owner claim upsert + claim-event ledger + terminal-truth audit; shared video_date_lifecycle_* helpers stay the payload/observability owners.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. mark_video_date_daily_alive: single body
--    (formerly head -> vd_daily_alive_20260609130139_hot_base ->
--     vd_alive_strict_provider_base -> vd_daily_alive_remote_seen_base ->
--     ..._20260608080938_last_resort -> ..._20260607222923_definitive ->
--     ..._20260607155414_lifecycle)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_row public.video_sessions%ROWTYPE;
  v_event_id uuid;
  v_eligibility jsonb := '{}'::jsonb;
  v_provider jsonb := '{}'::jsonb;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_payload jsonb;
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_reason_code text;
  v_observed boolean := false;
  -- heartbeat worker state (formerly the 20260607155414 lifecycle base)
  v_now timestamptz;
  v_status text;
  v_routeable boolean := false;
  v_started_handshake boolean := false;
  v_reconnect_grace_cleared boolean := false;
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_provider_backed_current boolean := false;
  v_provider_presence jsonb := '{}'::jsonb;
  v_join_stamp_accepted boolean := false;
  v_presence_event_recorded boolean := false;
  v_noop_observability_recorded boolean := false;
  v_presence_throttle interval;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Lifecycle eligibility precheck (formerly the hot base). ──
    v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
      v_payload := v_eligibility || jsonb_build_object(
        'rpc', 'mark_video_date_daily_alive',
        'provider_presence_required', true,
        'provider_backed_current', false,
        'provider_presence_missing', true,
        'join_stamp_accepted', false,
        'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
        'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
        'owner_state', v_owner_state,
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    SELECT vs.event_id INTO v_event_id
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    -- ── Current-provider-session proof precheck (formerly the hot base):
    -- proof-missing calls are structured ok:true no-ops, never stamps. ──
    v_provider := public.video_date_current_provider_session_proof_v1(
      p_session_id,
      v_actor,
      v_provider_session_id,
      v_owner_state,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_provider->>'ok')::boolean, false) IS NOT TRUE THEN
      v_reason_code := COALESCE(v_provider->>'code', 'DAILY_JOIN_PROVIDER_PROOF_MISSING');

      BEGIN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          CASE
            WHEN COALESCE((v_provider->>'provider_presence_terminal')::boolean, false)
              THEN 'daily_alive_provider_session_left'
            ELSE 'daily_alive_provider_join_pending'
          END,
          NULL,
          v_event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', v_provider_session_id,
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', v_owner_state,
            'provider_proof', v_provider,
            'join_stamp_accepted', false,
            'lifecycle_eligibility_checked', true,
            'retryable', COALESCE((v_provider->>'retryable')::boolean, true),
            'rejection_code', v_reason_code
          )
        );
        v_observed := true;
      EXCEPTION
        WHEN OTHERS THEN
          v_observed := false;
      END;

      v_payload := v_provider
        || jsonb_build_object(
          'ok', true,
          'success', true,
          'rpc', 'mark_video_date_daily_alive',
          'error', lower(v_reason_code),
          'code', v_reason_code,
          'error_code', v_reason_code,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true,
          'join_stamp_accepted', false,
          'waiting_for_stable_copresence', true,
          'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
          'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'owner_state', v_owner_state,
          'lifecycle_eligibility_checked', true,
          'provider_join_webhook_required', true,
          'provider_proof_observed', v_observed
        );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    -- ── Heartbeat worker (formerly the 20260607155414 lifecycle base). ──
    BEGIN
      v_now := clock_timestamp();

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object(
          'ok', false,
          'error', 'unauthorized',
          'retryable', false
        );
      ELSE
        SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
        IF NOT FOUND THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'not_found',
            'retryable', false
          );
        ELSIF v_actor IS DISTINCT FROM v_row.participant_1_id
          AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'forbidden',
            'retryable', false
          );
        ELSIF v_row.ended_at IS NOT NULL THEN
          UPDATE public.video_date_surface_claims
          SET released_at = COALESCE(released_at, v_now),
              updated_at = v_now
          WHERE profile_id = v_actor
            AND session_id = p_session_id
            AND surface = 'video_date'
            AND released_at IS NULL;

          v_result := jsonb_build_object(
            'ok', false,
            'error', 'session_ended',
            'retryable', false,
            'terminal', true,
            'queue_status', 'in_survey',
            'ended_at', v_row.ended_at,
            'ended_reason', v_row.ended_reason,
            'surface_claim_released', true
          );
        ELSE
          v_routeable :=
            v_row.ready_gate_status = 'both_ready'
            AND (
              v_row.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
              OR v_row.phase IN ('handshake', 'date')
              OR v_row.handshake_started_at IS NOT NULL
              OR v_row.date_started_at IS NOT NULL
            );

          IF NOT v_routeable THEN
            v_result := jsonb_build_object(
              'ok', false,
              'error', 'not_routeable',
              'retryable', true,
              'retry_after_ms', 750,
              'ready_gate_status', v_row.ready_gate_status,
              'state', v_row.state,
              'phase', v_row.phase
            );
          ELSE
            SELECT
              vde.event_type,
              vde.occurred_at,
              public.video_date_daily_provider_session_id_from_event_v1(
                vde.provider_participant_id,
                vde.payload
              )
            INTO
              v_latest_provider_event_type,
              v_latest_provider_event_at,
              v_latest_provider_session_id
            FROM public.video_date_daily_webhook_events vde
            WHERE vde.session_id = p_session_id
              AND vde.provider_user_id = v_actor::text
              AND vde.event_type IN ('participant.joined', 'participant.left')
            ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
            LIMIT 1;

            v_provider_backed_current :=
              v_owner_state = 'joined'
              AND v_provider_session_id IS NOT NULL
              AND (
                v_latest_provider_event_type IS NULL
                OR (
                  v_latest_provider_event_type = 'participant.joined'
                  AND v_latest_provider_session_id = v_provider_session_id
                )
                OR (
                  v_latest_provider_event_type = 'participant.left'
                  AND v_latest_provider_session_id IS NOT NULL
                  AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
                )
              );

            v_presence_throttle := CASE
              WHEN v_provider_backed_current THEN interval '6 seconds'
              ELSE interval '30 seconds'
            END;

            IF NOT EXISTS (
              SELECT 1
              FROM public.video_date_presence_events vpe
              WHERE vpe.session_id = p_session_id
                AND vpe.actor_id = v_actor
                AND vpe.event_type = 'client_daily_alive'
                AND vpe.provider_session_id IS NOT DISTINCT FROM v_provider_session_id
                AND vpe.owner_state IS NOT DISTINCT FROM v_owner_state
                AND vpe.occurred_at >= v_now - v_presence_throttle
              LIMIT 1
            ) THEN
              INSERT INTO public.video_date_presence_events (
                session_id,
                actor_id,
                source,
                event_type,
                owner_id,
                call_instance_id,
                provider_session_id,
                entry_attempt_id,
                owner_state,
                occurred_at,
                details
              ) VALUES (
                p_session_id,
                v_actor,
                'mark_video_date_daily_alive',
                'client_daily_alive',
                NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                v_provider_session_id,
                NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                v_owner_state,
                v_now,
                jsonb_build_object(
                  'rpc', 'mark_video_date_daily_alive',
                  'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                  'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                  'provider_session_id', v_provider_session_id,
                  'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                  'owner_state', v_owner_state,
                  'provider_presence_required', true,
                  'provider_backed_current', v_provider_backed_current,
                  'join_stamp_accepted', v_provider_backed_current,
                  'latest_provider_event_type', v_latest_provider_event_type,
                  'latest_provider_event_at', v_latest_provider_event_at,
                  'latest_provider_session_id', v_latest_provider_session_id,
                  'provider_participant_id_source', 'provider_participant_id_or_payload',
                  'throttle_window_seconds', EXTRACT(EPOCH FROM v_presence_throttle)::integer
                )
              );
              v_presence_event_recorded := true;
            END IF;

            IF NOT v_provider_backed_current THEN
              IF NOT EXISTS (
                SELECT 1
                FROM public.event_loop_observability_events el
                WHERE el.operation = 'video_date_transition'
                  AND el.session_id = p_session_id
                  AND el.actor_id = v_actor
                  AND el.reason_code = 'daily_alive_without_current_provider_presence'
                  AND el.created_at >= v_now - interval '30 seconds'
                LIMIT 1
              ) THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'no_op',
                  'daily_alive_without_current_provider_presence',
                  NULL,
                  v_row.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', 'mark_video_date_daily_alive',
                    'owner_state', v_owner_state,
                    'provider_session_id', v_provider_session_id,
                    'provider_presence_required', true,
                    'latest_provider_event_type', v_latest_provider_event_type,
                    'latest_provider_event_at', v_latest_provider_event_at,
                    'latest_provider_session_id', v_latest_provider_session_id,
                    'provider_participant_id_source', 'provider_participant_id_or_payload',
                    'throttled', true
                  )
                );
                v_noop_observability_recorded := true;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_handshake'
              END;

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'handshake_started', false,
                'waiting_for_stable_copresence', true,
                'retry_after_ms', 3000,
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence_required', true,
                'provider_backed_current', false,
                'presence_event_recorded', v_presence_event_recorded,
                'noop_observability_recorded', v_noop_observability_recorded,
                'latest_provider_event_type', v_latest_provider_event_type,
                'latest_provider_event_at', v_latest_provider_event_at,
                'latest_provider_session_id', v_latest_provider_session_id,
                'provider_presence_missing', true,
                'provider_presence_terminal', v_latest_provider_event_type = 'participant.left',
                'join_stamp_accepted', false,
                'stable_copresence_required', true
              );
            ELSE
              v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

              IF v_actor = v_row.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_joined_at = COALESCE(participant_1_joined_at, v_now),
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_1_joined_at IS NULL
                      OR participant_1_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_joined_at = COALESCE(participant_2_joined_at, v_now),
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_2_joined_at IS NULL
                      OR participant_2_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              END IF;
              v_join_stamp_accepted := true;

              SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

              v_stable := public.video_date_stable_copresence_v1(p_session_id);
              v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
              v_participant_1_active := COALESCE((v_stable->>'participant_1_active')::boolean, false);
              v_participant_2_active := COALESCE((v_stable->>'participant_2_active')::boolean, false);
              v_provider_presence := CASE
                WHEN v_actor = v_row.participant_1_id THEN v_stable->'participant_1_provider_presence'
                ELSE v_stable->'participant_2_provider_presence'
              END;

              IF v_row.date_started_at IS NULL
                 AND v_row.handshake_started_at IS NULL
                 AND v_stable_copresence THEN
                UPDATE public.video_sessions
                SET
                  handshake_started_at = v_now,
                  state = 'handshake'::public.video_date_state,
                  phase = 'handshake',
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND date_started_at IS NULL
                  AND handshake_started_at IS NULL
                RETURNING * INTO v_row;

                IF FOUND THEN
                  v_started_handshake := true;
                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'success',
                    'handshake_started_after_stable_daily_alive',
                    NULL,
                    v_row.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', 'mark_video_date_daily_alive',
                      'stable_copresence', v_stable,
                      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                      'provider_session_id', v_provider_session_id,
                      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                      'provider_presence_required', true,
                      'stable_copresence_required', true
                    )
                  );
                ELSE
                  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
                END IF;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_handshake'
              END;

              UPDATE public.event_registrations
              SET
                queue_status = v_status,
                current_room_id = p_session_id,
                current_partner_id = CASE
                  WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                  ELSE v_row.participant_1_id
                END,
                last_active_at = v_now
              WHERE event_id = v_row.event_id
                AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
                AND (
                  queue_status IS DISTINCT FROM v_status
                  OR current_room_id IS DISTINCT FROM p_session_id
                  OR current_partner_id IS DISTINCT FROM CASE
                    WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                    ELSE v_row.participant_1_id
                  END
                  OR last_active_at < v_now - interval '15 seconds'
                  OR last_active_at IS NULL
                );

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'handshake_started', v_started_handshake,
                'handshake_started_at', v_row.handshake_started_at,
                'waiting_for_stable_copresence', COALESCE((v_stable->>'waiting_for_stable_copresence')::boolean, false),
                'stable_copresence', v_stable,
                'retry_after_ms', COALESCE((v_stable->>'retry_after_ms')::integer, 0),
                'latest_joined_at', CASE
                  WHEN v_actor = v_row.participant_1_id THEN v_row.participant_1_joined_at
                  ELSE v_row.participant_2_joined_at
                END,
                'latest_owner_heartbeat_at', v_stable->>'latest_owner_heartbeat_at',
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence', v_provider_presence,
                'provider_presence_required', true,
                'provider_backed_current', v_provider_backed_current,
                'presence_event_recorded', v_presence_event_recorded,
                'join_stamp_accepted', v_join_stamp_accepted,
                'reconnect_grace_cleared', v_reconnect_grace_cleared AND v_join_stamp_accepted,
                'participant_1_joined_at', v_row.participant_1_joined_at,
                'participant_1_away_at', v_row.participant_1_away_at,
                'participant_1_active', v_participant_1_active,
                'participant_2_joined_at', v_row.participant_2_joined_at,
                'participant_2_away_at', v_row.participant_2_away_at,
                'participant_2_active', v_participant_2_active,
                'stable_copresence_required', true
              );
            END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'mark_video_date_daily_alive.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'daily_alive_stamp_failed',
          'code', 'DAILY_ALIVE_STAMP_FAILED',
          'error_code', 'DAILY_ALIVE_STAMP_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Promotion + enrichment pipeline (formerly the definitive,
    -- last-resort, remote_seen and strict/hot wrapper bases). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_promotion := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        'provider_backed_alive',
        true
      );
    END IF;

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_promotion,
      'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
    );

    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      v_result
    );

    v_result := v_result || jsonb_build_object(
      'strict_provider_join_proof_checked', true,
      'provider_join_webhook_required', true,
      'provider_proof', v_provider,
      'lifecycle_eligibility_checked', true
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'mark_video_date_daily_alive.single_body',
          'daily_alive_stamp_failed',
          'DAILY_ALIVE_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'unknown'),
            'error', 'daily_alive_failed',
            'reason', 'daily_alive_failed',
            'code', 'DAILY_ALIVE_FAILED',
            'error_code', 'DAILY_ALIVE_FAILED',
            'retryable', true,
            'terminal', false,
            'provider_presence_required', true,
            'provider_backed_current', false,
            'provider_presence_missing', true,
            'join_stamp_accepted', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Single-body Video Date Daily heartbeat RPC (rebuild PR 3). Lifecycle eligibility + provider-session proof prechecks, webhook-backed presence gating, throttled presence ledger, joined-stamp/grace-clear, stable-copresence handshake start, registration continuity, provider-overlap promotion pass.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. mark_video_date_daily_joined: single body
--    (formerly head -> vd_daily_joined_20260609130139_hot_base ->
--     ..._20260609105249_active_entry -> ..._20260608080938_last_resort ->
--     ..._20260607222923_definitive -> ..._20260607155414_lifecycle ->
--     canonical mark_video_date_daily_alive)
--    The delegation to canonical mark_video_date_daily_alive is preserved by
--    design: the heartbeat machine has exactly one owner.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT 'joined'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Joined delegates to the canonical heartbeat owner (formerly the
    -- 20260607155414 lifecycle base). ──
    v_result := public.mark_video_date_daily_alive(
      p_session_id,
      p_owner_id,
      p_call_instance_id,
      v_provider_session_id,
      p_entry_attempt_id,
      COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'joined')
    );

    v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'rpc', 'mark_video_date_daily_joined',
      'joined_delegated_to_daily_alive', true,
      'provider_presence_required', true,
      'legacy_providerless_noop', v_provider_session_id IS NULL,
      'join_stamp_accepted', COALESCE((v_result->>'join_stamp_accepted')::boolean, false)
    );

    -- ── Promotion + enrichment pipeline (formerly the definitive,
    -- last-resort, active_entry and hot wrapper bases). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_promotion := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_joined',
        'provider_backed_joined',
        true
      );
    END IF;

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_promotion,
      'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
    );

    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_joined',
      v_result
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'active_entry_failsoft_shell', true,
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'mark_video_date_daily_joined.single_body',
          'daily_join_stamp_failed',
          'DAILY_JOIN_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'mark_video_date_daily_joined',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'joined'),
            'error', 'daily_join_stamp_failed',
            'reason', 'daily_join_stamp_failed',
            'code', 'DAILY_JOIN_STAMP_FAILED',
            'error_code', 'DAILY_JOIN_STAMP_FAILED',
            'retryable', true,
            'terminal', false,
            'provider_presence_required', true,
            'provider_backed_current', false,
            'provider_presence_missing', true,
            'join_stamp_accepted', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Single-body Video Date Daily joined RPC (rebuild PR 3). Delegates to canonical mark_video_date_daily_alive as the single heartbeat owner, adds joined markers and the provider_backed_joined overlap-promotion pass.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. mark_video_date_remote_seen: single body
--    (formerly head -> vd_remote_seen_render_base ->
--     ..._20260608120000_provider -> ..._20260607155414_lifecycle ->
--     ..._20260605200729_grace -> ..._20260605170249_outer ->
--     ..._20260605115657_base)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL,
  p_evidence_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_eligibility jsonb := '{}'::jsonb;
  v_source text := NULLIF(left(btrim(COALESCE(p_evidence_source, '')), 80), '');
  v_allowed_sources text[] := ARRAY[
    'loadeddata',
    'playing',
    'remote_track_mounted',
    'first_remote_frame',
    'request_video_frame_callback'
  ];
  v_row public.video_sessions%ROWTYPE;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_owner_id text := NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), '');
  v_call_instance_id text := NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), '');
  v_entry_attempt_id text := NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), '');
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_latest_alive_owner_id text;
  v_latest_alive_call_instance_id text;
  v_latest_alive_provider_session_id text;
  v_latest_alive_at timestamptz;
  v_provider_backed_current boolean := false;
  v_owner_call_current boolean := false;
  v_retryable boolean := false;
  v_rejection_code text := 'REMOTE_SEEN_PROVIDER_NOT_CURRENT';
  -- stamp core state (formerly the 20260605115657 base)
  v_now timestamptz;
  v_previous_remote_seen_at timestamptz;
  v_latest_remote_seen_at timestamptz;
  v_core_ok boolean := false;
  -- promotion / grace state (formerly outer / lifecycle / provider bases)
  v_ce_promotion jsonb := '{}'::jsonb;
  v_base_reconnect_grace_cleared boolean := false;
  v_latest_away_at timestamptz;
  v_grace_latest_remote_seen_at timestamptz;
  v_rows_changed integer := 0;
  v_enriched jsonb;
  v_overlap jsonb := '{}'::jsonb;
  v_result jsonb;
  v_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Lifecycle eligibility precheck (head layer). ──
    v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen'
    );

    IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
      v_payload := v_eligibility || jsonb_build_object(
        'rpc', 'mark_video_date_remote_seen',
        'provider_presence_required', true,
        'owner_call_presence_required', true,
        'render_evidence_required', true,
        'remote_seen_stamp_accepted', false,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      );
    END IF;

    -- ── Render-evidence source allow-list (head layer). ──
    IF v_source IS NULL OR NOT (v_source = ANY (v_allowed_sources)) THEN
      v_payload := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'remote_seen_render_evidence_required',
        'code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED',
        'error_code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED',
        'retryable', true,
        'retry_after_ms', 1500,
        'provider_presence_required', true,
        'owner_call_presence_required', true,
        'render_evidence_required', true,
        'remote_seen_stamp_accepted', false,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      );
    END IF;

    -- ── Provider-proof matrix (formerly vd_remote_seen_render_base). ──
    IF v_actor IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'unauthorized',
        'code', 'UNAUTHORIZED',
        'retryable', false
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    SELECT *
    INTO v_row
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'not_found',
        'code', 'NOT_FOUND',
        'retryable', false
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    IF v_actor IS DISTINCT FROM v_row.participant_1_id
       AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'forbidden',
        'code', 'FORBIDDEN',
        'retryable', false
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    IF v_row.ended_at IS NOT NULL THEN
      v_payload := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'session_ended',
        'code', 'SESSION_ENDED',
        'retryable', false,
        'terminal', true,
        'session_ended', true,
        'ended_at', v_row.ended_at,
        'ended_reason', v_row.ended_reason,
        'provider_session_id', v_provider_session_id,
        'owner_state', v_owner_state
      );
      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    SELECT
      vde.event_type,
      vde.occurred_at,
      public.video_date_daily_provider_session_id_from_event_v1(
        vde.provider_participant_id,
        vde.payload
      )
    INTO
      v_latest_provider_event_type,
      v_latest_provider_event_at,
      v_latest_provider_session_id
    FROM public.video_date_daily_webhook_events vde
    WHERE vde.session_id = p_session_id
      AND vde.provider_user_id = v_actor::text
      AND vde.event_type IN ('participant.joined', 'participant.left')
    ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
    LIMIT 1;

    SELECT
      vpe.owner_id,
      vpe.call_instance_id,
      vpe.provider_session_id,
      vpe.occurred_at
    INTO
      v_latest_alive_owner_id,
      v_latest_alive_call_instance_id,
      v_latest_alive_provider_session_id,
      v_latest_alive_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_actor
      AND vpe.event_type = 'client_daily_alive'
      AND vpe.owner_state = 'joined'
    ORDER BY vpe.occurred_at DESC NULLS LAST, vpe.created_at DESC
    LIMIT 1;

    v_owner_call_current := COALESCE(
      v_owner_id IS NOT NULL
      AND v_call_instance_id IS NOT NULL
      AND v_latest_alive_owner_id = v_owner_id
      AND v_latest_alive_call_instance_id = v_call_instance_id
      AND v_latest_alive_provider_session_id = v_provider_session_id
      AND v_latest_alive_at >= now() - interval '15 seconds',
      false
    );

    v_provider_backed_current := COALESCE(
      v_owner_state = 'joined'
      AND v_provider_session_id IS NOT NULL
      AND v_latest_provider_event_type = 'participant.joined'
      AND v_latest_provider_session_id = v_provider_session_id
      AND v_owner_call_current,
      false
    );

    IF v_provider_backed_current IS NOT TRUE THEN
      v_retryable := COALESCE(
        v_provider_session_id IS NOT NULL
        AND v_owner_state = 'joined'
        AND v_owner_id IS NOT NULL
        AND v_call_instance_id IS NOT NULL
        AND (
          v_latest_provider_event_type IS NULL
          OR (
            v_latest_provider_event_type = 'participant.left'
            AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
          )
          OR v_latest_alive_at IS NULL
          OR v_latest_alive_at < now() - interval '15 seconds'
        ),
        false
      );

      v_rejection_code := CASE
        WHEN v_owner_id IS NULL THEN 'REMOTE_SEEN_OWNER_MISSING'
        WHEN v_call_instance_id IS NULL THEN 'REMOTE_SEEN_CALL_INSTANCE_MISSING'
        WHEN v_provider_session_id IS NULL THEN 'REMOTE_SEEN_PROVIDER_SESSION_MISSING'
        WHEN v_owner_state IS DISTINCT FROM 'joined' THEN 'REMOTE_SEEN_OWNER_NOT_JOINED'
        WHEN v_latest_provider_event_type = 'participant.left'
             AND v_latest_provider_session_id = v_provider_session_id
          THEN 'REMOTE_SEEN_PROVIDER_SESSION_LEFT'
        WHEN v_latest_alive_at IS NULL THEN 'REMOTE_SEEN_OWNER_HEARTBEAT_MISSING'
        WHEN v_latest_alive_at < now() - interval '15 seconds' THEN 'REMOTE_SEEN_OWNER_HEARTBEAT_STALE'
        WHEN v_latest_alive_owner_id IS DISTINCT FROM v_owner_id THEN 'REMOTE_SEEN_OWNER_MISMATCH'
        WHEN v_latest_alive_call_instance_id IS DISTINCT FROM v_call_instance_id THEN 'REMOTE_SEEN_CALL_INSTANCE_MISMATCH'
        WHEN v_latest_alive_provider_session_id IS DISTINCT FROM v_provider_session_id THEN 'REMOTE_SEEN_OWNER_PROVIDER_MISMATCH'
        ELSE 'REMOTE_SEEN_PROVIDER_NOT_CURRENT'
      END;

      BEGIN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          'remote_seen_rejected_stale_provider_session',
          NULL,
          v_row.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'mark_video_date_remote_seen',
            'owner_id', v_owner_id,
            'call_instance_id', v_call_instance_id,
            'provider_session_id', v_provider_session_id,
            'entry_attempt_id', v_entry_attempt_id,
            'owner_state', v_owner_state,
            'provider_presence_required', true,
            'owner_call_presence_required', true,
            'provider_backed_current', false,
            'owner_call_current', v_owner_call_current,
            'latest_provider_event_type', v_latest_provider_event_type,
            'latest_provider_event_at', v_latest_provider_event_at,
            'latest_provider_session_id', v_latest_provider_session_id,
            'latest_alive_owner_id', v_latest_alive_owner_id,
            'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
            'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
            'latest_alive_at', v_latest_alive_at,
            'join_stamp_accepted', false,
            'remote_seen_stamp_accepted', false,
            'rejection_code', v_rejection_code,
            'retryable', v_retryable
          )
        );
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      v_payload := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', lower(v_rejection_code),
        'code', v_rejection_code,
        'error_code', v_rejection_code,
        'retryable', v_retryable,
        'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
        'provider_presence_required', true,
        'owner_call_presence_required', true,
        'provider_presence_missing', true,
        'provider_presence_terminal',
          v_latest_provider_event_type = 'participant.left'
          AND v_latest_provider_session_id = v_provider_session_id,
        'provider_backed_current', false,
        'owner_call_current', v_owner_call_current,
        'join_stamp_accepted', false,
        'remote_seen_stamp_accepted', false,
        'remote_seen_rejected_stale_provider_session', true,
        'owner_id', v_owner_id,
        'call_instance_id', v_call_instance_id,
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', v_entry_attempt_id,
        'owner_state', v_owner_state,
        'latest_provider_event_type', v_latest_provider_event_type,
        'latest_provider_event_at', v_latest_provider_event_at,
        'latest_provider_session_id', v_latest_provider_session_id,
        'latest_alive_owner_id', v_latest_alive_owner_id,
        'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
        'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
        'latest_alive_at', v_latest_alive_at
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    -- ── Canonical remote-seen stamp + survey continuity (formerly the
    -- 20260605115657 base). ──
    BEGIN
      v_now := clock_timestamp();

      v_previous_remote_seen_at := CASE
        WHEN v_actor = v_row.participant_1_id THEN v_row.participant_1_remote_seen_at
        ELSE v_row.participant_2_remote_seen_at
      END;

      IF v_actor = v_row.participant_1_id THEN
        UPDATE public.video_sessions
        SET
          participant_1_remote_seen_at = GREATEST(COALESCE(participant_1_remote_seen_at, v_now), v_now),
          state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
        WHERE id = p_session_id
        RETURNING * INTO v_row;
        v_latest_remote_seen_at := v_row.participant_1_remote_seen_at;
      ELSE
        UPDATE public.video_sessions
        SET
          participant_2_remote_seen_at = GREATEST(COALESCE(participant_2_remote_seen_at, v_now), v_now),
          state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
        WHERE id = p_session_id
        RETURNING * INTO v_row;
        v_latest_remote_seen_at := v_row.participant_2_remote_seen_at;
      END IF;

      IF public.video_date_session_is_post_date_survey_eligible_v2(
        v_row.ended_at,
        v_row.ended_reason,
        v_row.date_started_at,
        v_row.state::text,
        v_row.phase,
        v_row.participant_1_joined_at,
        v_row.participant_2_joined_at,
        v_row.participant_1_remote_seen_at,
        v_row.participant_2_remote_seen_at
      ) THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = p_session_id,
          current_partner_id = CASE
            WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
            ELSE v_row.participant_1_id
          END,
          last_active_at = v_now
        WHERE event_id = v_row.event_id
          AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
          AND (
            current_room_id IS NULL
            OR current_room_id = p_session_id
          )
          AND (
            NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df1
              WHERE df1.session_id = p_session_id
                AND df1.user_id = v_row.participant_1_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df2
              WHERE df2.session_id = p_session_id
                AND df2.user_id = v_row.participant_2_id
            )
          )
          AND NOT public.is_blocked(v_row.participant_1_id, v_row.participant_2_id)
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_reports ur
            WHERE (ur.reporter_id = v_row.participant_1_id AND ur.reported_id = v_row.participant_2_id)
               OR (ur.reporter_id = v_row.participant_2_id AND ur.reported_id = v_row.participant_1_id)
          );
      END IF;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'remote_video_seen',
        NULL,
        v_row.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'participant_1_joined_at', v_row.participant_1_joined_at,
          'participant_2_joined_at', v_row.participant_2_joined_at,
          'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
          'latest_remote_seen_at', v_latest_remote_seen_at,
          'previous_remote_seen_at', v_previous_remote_seen_at,
          'remote_seen_canonical_repaired', v_previous_remote_seen_at IS DISTINCT FROM v_latest_remote_seen_at,
          'confirmed_encounter', public.video_date_session_has_confirmed_encounter(
            v_row.date_started_at,
            v_row.state::text,
            v_row.phase,
            v_row.participant_1_joined_at,
            v_row.participant_2_joined_at,
            v_row.participant_1_remote_seen_at,
            v_row.participant_2_remote_seen_at
          )
        )
      );

      v_result := jsonb_build_object(
        'ok', true,
        'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
        'latest_remote_seen_at', v_latest_remote_seen_at,
        'previous_remote_seen_at', v_previous_remote_seen_at,
        'remote_seen_canonical_repaired', v_previous_remote_seen_at IS DISTINCT FROM v_latest_remote_seen_at,
        'confirmed_encounter', public.video_date_session_has_confirmed_encounter(
          v_row.date_started_at,
          v_row.state::text,
          v_row.phase,
          v_row.participant_1_joined_at,
          v_row.participant_2_joined_at,
          v_row.participant_1_remote_seen_at,
          v_row.participant_2_remote_seen_at
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'mark_video_date_remote_seen.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'remote_seen_failed',
          'code', 'REMOTE_SEEN_FAILED',
          'error_code', 'REMOTE_SEEN_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    v_core_ok := COALESCE(
      CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
      false
    );

    -- ── Early confirmed-encounter promotion (formerly the 20260605170249
    -- outer base; the stable-bilateral-media gate lives in the shared
    -- promotion helper and is unchanged). ──
    IF v_core_ok THEN
      v_ce_promotion := public.video_date_promote_confirmed_encounter_v1(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        'remote_media_observed',
        true
      );

      IF COALESCE((v_ce_promotion->>'promoted')::boolean, false) THEN
        v_result := v_result || jsonb_build_object(
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_ce_promotion->'date_started_at',
          'early_confirmed_encounter_promoted', true,
          'promotion_reason', v_ce_promotion->>'reason',
          'session_seq', v_ce_promotion->'session_seq'
        );
      ELSE
        v_result := v_result || jsonb_build_object(
          'early_confirmed_encounter_promoted', false,
          'promotion_reason', v_ce_promotion->>'reason',
          'active_confirmed_encounter', COALESCE((v_ce_promotion->>'active_confirmed_encounter')::boolean, false)
        );
      END IF;
    END IF;

    -- ── Reconnect-grace clearing by bilateral remote-seen evidence
    -- (formerly the 20260607155414 lifecycle base). ──
    v_base_reconnect_grace_cleared := COALESCE(
      CASE
        WHEN jsonb_typeof(v_result->'reconnect_grace_cleared') = 'boolean'
          THEN (v_result->>'reconnect_grace_cleared')::boolean
        ELSE NULL
      END,
      false
    );

    IF v_core_ok THEN
      SELECT *
      INTO v_row
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND v_actor IS NOT NULL
         AND v_row.ended_at IS NULL
         AND v_row.reconnect_grace_ends_at IS NOT NULL
         AND (v_actor = v_row.participant_1_id OR v_actor = v_row.participant_2_id) THEN
        v_latest_away_at := GREATEST(
          COALESCE(v_row.participant_1_away_at, '-infinity'::timestamptz),
          COALESCE(v_row.participant_2_away_at, '-infinity'::timestamptz)
        );
        v_grace_latest_remote_seen_at := GREATEST(
          COALESCE(v_row.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_row.participant_2_remote_seen_at, '-infinity'::timestamptz)
        );

        IF v_latest_away_at <> '-infinity'::timestamptz
           AND v_grace_latest_remote_seen_at >= v_latest_away_at THEN
          UPDATE public.video_sessions
          SET
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            reconnect_grace_ends_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND reconnect_grace_ends_at IS NOT NULL;
          GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
          IF v_rows_changed > 0 THEN
            PERFORM public.bump_video_session_seq(p_session_id);
            PERFORM public.record_event_loop_observability(
              'video_date_transition',
              'success',
              'reconnect_grace_cleared_by_remote_seen',
              NULL,
              v_row.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', 'mark_video_date_remote_seen',
                'latest_away_at', v_latest_away_at,
                'latest_remote_seen_at', v_grace_latest_remote_seen_at,
                'reconnect_grace_cleared', true,
                'base_reconnect_grace_cleared', v_base_reconnect_grace_cleared
              )
            );
          END IF;
        END IF;
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      'reconnect_grace_cleared',
      v_base_reconnect_grace_cleared OR v_rows_changed > 0
    );

    -- ── Provider-overlap promotion pass (formerly the 20260608120000
    -- provider base). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_overlap := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        'remote_media_or_provider_overlap',
        true
      );
    END IF;

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_overlap,
      'provider_overlap_promoted_to_date', COALESCE((v_overlap->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_overlap->>'reason', v_enriched->>'promotion_reason')
    );

    -- ── Provider-proof success markers + final enrichment (formerly the
    -- vd_remote_seen_render_base post block + head markers). ──
    v_payload := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'provider_presence_required', true,
      'owner_call_presence_required', true,
      'provider_backed_current', true,
      'owner_call_current', true,
      'provider_presence_missing', false,
      'provider_presence_terminal', false,
      'remote_seen_stamp_accepted', true,
      'owner_id', v_owner_id,
      'call_instance_id', v_call_instance_id,
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', v_entry_attempt_id,
      'owner_state', v_owner_state,
      'latest_provider_event_type', v_latest_provider_event_type,
      'latest_provider_event_at', v_latest_provider_event_at,
      'latest_provider_session_id', v_latest_provider_session_id,
      'latest_alive_owner_id', v_latest_alive_owner_id,
      'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
      'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
      'latest_alive_at', v_latest_alive_at
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    ) || jsonb_build_object(
      'render_evidence_required', true,
      'render_evidence_accepted', true,
      'p_evidence_source', v_source,
      'allowed_evidence_sources', to_jsonb(v_allowed_sources),
      'lifecycle_eligibility_checked', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'mark_video_date_remote_seen',
          'remote_seen_stamp_failed',
          'REMOTE_SEEN_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'remote_seen_stamp_failed',
            'code', 'REMOTE_SEEN_STAMP_FAILED',
            'error_code', 'REMOTE_SEEN_STAMP_FAILED',
            'rpc', 'mark_video_date_remote_seen',
            'retryable', true,
            'retry_after_ms', 1500,
            'session_id', p_session_id,
            'actor_id', v_actor,
            'provider_session_id', v_provider_session_id,
            'owner_state', v_owner_state,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms,
            'direct_json_fallback', true
          );
      END;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid, text, text, text, text, text, text) IS
  'Single-body Video Date remote-seen RPC (rebuild PR 3). Render-evidence allow-list + provider-proof matrix (owner/call/provider/heartbeat) with structured no-op rejections; canonical remote-seen stamp, in_survey continuity, confirmed-encounter and provider-overlap promotion passes via the shared stable-bilateral-media gate owners.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Drop the historical evidence-family generations (no remaining callers).
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.vd_claim_surface_20260609130139_hot_base(uuid, text, text, boolean, integer);
DROP FUNCTION public.vd_claim_surface_terminal_truth_base(uuid, text, text, boolean, integer);
DROP FUNCTION public.claim_video_date_surface_20260608080938_last_resort_base(uuid, text, text, boolean, integer);
DROP FUNCTION public.claim_video_date_surface_20260607155414_lifecycle_base(uuid, text, text, boolean, integer);
DROP FUNCTION public.claim_video_date_surface_20260605232304_single_owner_base(uuid, text, text, boolean, integer);
DROP FUNCTION public.claim_video_date_surface_20260605170249_outer_base(uuid, text, text, boolean, integer);
DROP FUNCTION public.claim_video_date_surface_20260604093000_failsoft_base(uuid, text, text, boolean, integer);

DROP FUNCTION public.vd_daily_joined_20260609130139_hot_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_joined_20260609105249_active_entry_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_joined_20260608080938_last_resort_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_joined_20260607222923_definitive_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_joined_20260607155414_lifecycle_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_joined_20260605170249_outer_base(uuid);
DROP FUNCTION public.mark_video_date_daily_joined_20260604093000_failsoft_base(uuid);

DROP FUNCTION public.vd_daily_alive_20260609130139_hot_base(uuid, text, text, text, text, text);
DROP FUNCTION public.vd_alive_strict_provider_base(uuid, text, text, text, text, text);
DROP FUNCTION public.vd_daily_alive_remote_seen_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_alive_20260608080938_last_resort_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_alive_20260607222923_definitive_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_daily_alive_20260607155414_lifecycle_base(uuid, text, text, text, text, text);

DROP FUNCTION public.vd_remote_seen_render_base(uuid, text, text, text, text, text);
DROP FUNCTION public.mark_video_date_remote_seen_20260608120000_provider_base(uuid);
DROP FUNCTION public.mark_video_date_remote_seen_20260607155414_lifecycle_base(uuid);
DROP FUNCTION public.mark_video_date_remote_seen_20260605200729_grace_base(uuid);
DROP FUNCTION public.mark_video_date_remote_seen_20260605170249_outer_base(uuid);
DROP FUNCTION public.mark_video_date_remote_seen_20260605115657_base(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
