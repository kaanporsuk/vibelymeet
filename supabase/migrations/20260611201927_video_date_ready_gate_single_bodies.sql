BEGIN;

-- ============================================================================
-- Video Date rebuild PR 4: rewrite the Ready Gate family RPCs as single
-- self-contained bodies and drop their historical public generations.
--
-- Functions rewritten (names/signatures/grants unchanged):
--   - public.ready_gate_transition(uuid, text, text)
--   - public.video_session_mark_ready_v2(uuid, text, text)
--   - public.video_date_ready_gate_actionability_v1(uuid, uuid, text,
--       boolean, boolean, boolean, boolean)
--
-- Already single bodies, verified and intentionally untouched:
--   - public.terminalize_event_ready_gates(uuid, text)
--   - public.terminalize_stale_pre_date_ready_gate_blockers(integer, text)
--   - public.recover_ready_gate_missing_rooms_v1(integer, integer, integer)
--   - public.video_date_terminalize_ready_gate_session_v1(uuid, uuid, text, jsonb)
--     (shared per-session terminal owner; called by terminalize_event_ready_gates
--      and the actionability single body)
--   - public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean)
--     (preserved standalone; the live mark-ready chain does not call it — the
--      45s both-ready grace lives in the decisive commit itself)
--   - public.handle_event_ready_gate_terminalization() (events trigger)
--   - public.persist_ready_gate_suppression_v2(uuid, timestamptz)
--
-- Live-chain truth (reconstructed from pg_get_functiondef of the linked
-- project on 2026-06-11; PR-1 fixtures pin the heads):
--
--   ready_gate_transition (9 layers):
--     head -> _20260603150106_start_snapshot_base -> _20260602231752_57014_base
--     -> _20260524120000_clock_base -> _20260505214500_result_status_base
--     -> _20260505203000_registration_desync_base -> rgt_preserve_warmup_base_v1
--     -> rgt_pre_ready_room_meta_base_v1 -> _20260501200000_event_inactive_base
--     (core). The trio _20260501190000_expiry_rowcount_prior ->
--     _20260501170000_both_ready_grace_base -> _20260501135000_observability_base
--     is a DETACHED dead sub-chain (no live referencers; superseded by the
--     event_inactive core).
--
--   video_session_mark_ready_v2 (9 layers):
--     head -> vd_mark_ready_20260609130139_hot_base
--     -> _20260609105249_active_entry_base -> vd_mark_ready_both_ready_owner_base
--     -> vd_mark_ready_terminal_truth_base -> vd_mark_ready_partial_base
--     -> _20260608114500_review_comments_base -> _20260607123952_routeable_entry_base
--     -> _20260606212727_event_cleanup_base (core). The trio
--     _20260604131708_event_active_base -> _20260604104154_grace_base and the
--     detached _20260603150106_start_snapshot_base are DEAD sub-chain layers
--     (no live referencers; superseded by the event_cleanup core).
--
--   video_date_ready_gate_actionability_v1:
--     head -> vd_ready_gate_actionability_owner_eligibility_base (sole caller).
--
-- Inventory truth corrections versus the rebuild plan enumeration (same class
-- as PR 3's vd_alive_strict_provider_base): the live chains contain six
-- chain-private layers that were not in the plan's generation lists —
-- rgt_preserve_warmup_base_v1, rgt_pre_ready_room_meta_base_v1,
-- vd_mark_ready_20260609130139_hot_base, vd_mark_ready_both_ready_owner_base,
-- vd_mark_ready_terminal_truth_base, vd_mark_ready_partial_base. All are
-- inlined here and dropped with their families (DB-wide prosrc/cron/view scan
-- proves their only referencers are family-internal).
--
-- Intentional changes versus the literal chains (called out in the PR):
--   - raw 'sqlstate' / 'message' / 'detail' / 'hint' fragments no longer enter
--     authenticated client failure payloads (same rule as rebuild PRs 2/3);
--     diagnostics route into public.video_date_lifecycle_observe_exception_v2;
--   - the legacy mark_ready machine inside the transition chain (45s grace +
--     'both_ready_provider_prepare_grace_extended' observability in the
--     event_inactive core, and the after-ready warmup restore path in the
--     registration-desync layer) is not carried over: it has been unreachable
--     since the head bridged every mark_ready spelling to
--     video_session_mark_ready_v2, which owns identical 45s-grace decisive
--     semantics;
--   - the review-comments precheck layer's duplicate auth/participant/queued/
--     partner-snooze/safety re-checks are not carried over: the actionability
--     precheck performs the same checks under the same FOR UPDATE locks in the
--     same transaction immediately before;
--   - pure fail-soft wrapper layers collapse into the single bodies' exception
--     structure (codes preserved);
--   - the detached dead sub-chains (3 ready_gate_transition generations, 3
--     video_session_mark_ready_v2 generations) are dropped without
--     replacement.
--
-- Dropped public functions (23; no remaining callers — verified via prosrc
-- scan across all schemas, cron.job, pg_views, and repo grep including
-- supabase/functions and generated types):
--   ready_gate_transition family (11):
--     ready_gate_transition_20260603150106_start_snapshot_base
--     ready_gate_transition_20260602231752_57014_base
--     ready_gate_transition_20260524120000_clock_base
--     ready_gate_transition_20260505214500_result_status_base
--     ready_gate_transition_20260505203000_registration_desync_base
--     rgt_preserve_warmup_base_v1
--     rgt_pre_ready_room_meta_base_v1
--     ready_gate_transition_20260501200000_event_inactive_base
--     ready_gate_transition_20260501190000_expiry_rowcount_prior  (detached)
--     ready_gate_transition_20260501170000_both_ready_grace_base  (detached)
--     ready_gate_transition_20260501135000_observability_base     (detached)
--   video_session_mark_ready_v2 family (11):
--     vd_mark_ready_20260609130139_hot_base
--     video_session_mark_ready_v2_20260609105249_active_entry_base
--     vd_mark_ready_both_ready_owner_base
--     vd_mark_ready_terminal_truth_base
--     vd_mark_ready_partial_base
--     video_session_mark_ready_v2_20260608114500_review_comments_base
--     video_session_mark_ready_v2_20260607123952_routeable_entry_base
--     video_session_mark_ready_v2_20260606212727_event_cleanup_base
--     video_session_mark_ready_v2_20260604131708_event_active_base (detached)
--     video_session_mark_ready_v2_20260604104154_grace_base        (detached)
--     video_session_mark_ready_v2_20260603150106_start_snapshot_base (detached)
--   actionability family (1):
--     vd_ready_gate_actionability_owner_eligibility_base
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. video_date_ready_gate_actionability_v1: single body
--    (formerly head -> vd_ready_gate_actionability_owner_eligibility_base)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid(),
  p_source text DEFAULT 'video_date_ready_gate_actionability_v1'::text,
  p_allow_actor_owned_snooze boolean DEFAULT false,
  p_require_current_ready_gate_registration boolean DEFAULT true,
  p_terminalize_invalid boolean DEFAULT false,
  p_lock_rows boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
-- video_date_ready_gate_actionability_v1.single_body_core (rebuild PR 4):
-- owner-eligibility matrix + participant eligibility + route payload wrap.
DECLARE
  v_now timestamptz := now();
  v_actor uuid := p_actor_id;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_ready_gate_actionability_v1');
  v_session public.video_sessions%ROWTYPE;
  v_status text;
  v_partner_id uuid;
  v_inactive_reason text;
  v_terminal_reason text;
  v_is_blocked boolean := false;
  v_has_report boolean := false;
  v_actor_hidden boolean := false;
  v_partner_hidden boolean := false;
  v_p1_queue_status text;
  v_p2_queue_status text;
  v_p1_current_room_id uuid;
  v_p2_current_room_id uuid;
  v_p1_current_partner_id uuid;
  v_p2_current_partner_id uuid;
  v_p1_registration_found boolean := false;
  v_p2_registration_found boolean := false;
  v_registration_issues text[] := ARRAY[]::text[];
  v_timestamp_issue text := NULL;
  v_terminalize jsonb;
  v_base jsonb := NULL;
  v_actor_eligibility jsonb := '{}'::jsonb;
  v_partner_eligibility jsonb := '{}'::jsonb;
  v_invalid_eligibility jsonb := '{}'::jsonb;
  v_actor_ok boolean := true;
  v_partner_ok boolean := true;
  v_invalid_role text := NULL;
  v_invalid_retryable boolean := false;
  v_invalid_terminal boolean := true;
  v_invalid_code text;
  v_invalid_reason text;
  v_invalid_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- ── Owner-eligibility matrix (formerly the owner_eligibility base). Every
  -- failure returns through the route-payload wrap below; v_base stays NULL
  -- until the matrix decides. ──
  IF v_actor IS NULL THEN
    v_base := jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'AUTH_REQUIRED',
      'error_code', 'AUTH_REQUIRED',
      'error', 'auth_required',
      'reason', 'auth_required',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  IF v_base IS NULL THEN
    IF p_lock_rows THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;
    ELSE
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;
    END IF;

    IF NOT FOUND THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'code', 'SESSION_NOT_FOUND',
        'error_code', 'SESSION_NOT_FOUND',
        'error', 'session_not_found',
        'reason', 'session_not_found',
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    ELSIF v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'code', 'ACCESS_DENIED',
        'error_code', 'ACCESS_DENIED',
        'error', 'not_participant',
        'reason', 'not_participant',
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    v_status := COALESCE(v_session.ready_gate_status, 'queued');
    v_partner_id := CASE
      WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END;

    IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
       OR COALESCE(v_session.phase, 'ready_gate') IN ('handshake', 'date')
       OR v_session.handshake_started_at IS NOT NULL
       OR v_session.date_started_at IS NOT NULL
       OR v_session.participant_1_joined_at IS NOT NULL
       OR v_session.participant_2_joined_at IS NOT NULL THEN
      v_base := jsonb_build_object(
        'ok', true,
        'success', true,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'actionable', true,
        'source', v_source,
        'non_ready_gate_owned', true
      );
    ELSIF v_session.ended_at IS NOT NULL
       OR v_session.state = 'ended'::public.video_date_state
       OR COALESCE(v_session.phase, '') = 'ended'
       OR v_status IN ('expired', 'forfeited', 'cancelled', 'ended') THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'SESSION_ENDED',
        'error_code', 'SESSION_ENDED',
        'error', 'session_ended',
        'reason', COALESCE(v_session.ended_reason, 'session_ended'),
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    ELSIF v_status = 'queued' THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'READY_GATE_NOT_OPEN',
        'error_code', 'READY_GATE_NOT_OPEN',
        'error', 'ready_gate_not_open',
        'reason', 'ready_gate_not_open',
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    ELSIF v_status = 'snoozed'
       AND (
         p_allow_actor_owned_snooze IS NOT TRUE
         OR v_session.snoozed_by IS NULL
         OR v_session.snoozed_by IS DISTINCT FROM v_actor
         OR (v_session.snooze_expires_at IS NOT NULL AND v_session.snooze_expires_at <= v_now)
       ) THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'snoozed_by', v_session.snoozed_by,
        'snooze_expires_at', v_session.snooze_expires_at,
        'code', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'PARTNER_SNOOZED' ELSE 'READY_GATE_SNOOZED' END,
        'error_code', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'PARTNER_SNOOZED' ELSE 'READY_GATE_SNOOZED' END,
        'error', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'partner_snoozed' ELSE 'ready_gate_snoozed' END,
        'reason', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'partner_snoozed' ELSE 'ready_gate_snoozed' END,
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    ELSIF v_status NOT IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'READY_GATE_NOT_READY',
        'error_code', 'READY_GATE_NOT_READY',
        'error', 'ready_gate_not_ready',
        'reason', 'ready_gate_not_ready',
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    IF v_status = 'ready_a'
       AND (v_session.ready_participant_1_at IS NULL OR v_session.ready_participant_2_at IS NOT NULL) THEN
      v_timestamp_issue := 'ready_a_timestamp_mismatch';
    ELSIF v_status = 'ready_b'
       AND (v_session.ready_participant_2_at IS NULL OR v_session.ready_participant_1_at IS NOT NULL) THEN
      v_timestamp_issue := 'ready_b_timestamp_mismatch';
    ELSIF v_status = 'both_ready'
       AND (v_session.ready_participant_1_at IS NULL OR v_session.ready_participant_2_at IS NULL) THEN
      v_timestamp_issue := 'both_ready_timestamp_mismatch';
    END IF;

    IF v_timestamp_issue IS NOT NULL THEN
      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          'ready_gate_status_timestamp_desync',
          jsonb_build_object('source', v_source, 'issue', v_timestamp_issue)
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'READY_GATE_STATUS_TIMESTAMP_DESYNC',
        'error_code', 'READY_GATE_STATUS_TIMESTAMP_DESYNC',
        'error', 'ready_gate_status_timestamp_desync',
        'reason', 'ready_gate_status_timestamp_desync',
        'timestamp_issue', v_timestamp_issue,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL
     AND v_session.ready_gate_expires_at IS NOT NULL
     AND v_session.ready_gate_expires_at <= v_now
     AND NOT (
       v_status = 'both_ready'
       AND v_session.prepare_entry_expires_at IS NOT NULL
       AND v_session.prepare_entry_expires_at > v_now
     ) THEN
    IF p_terminalize_invalid THEN
      v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
        v_session.id,
        v_actor,
        'ready_gate_expired',
        jsonb_build_object('source', v_source)
      );
    END IF;

    v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
      'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
      'code', 'READY_GATE_EXPIRED',
      'error_code', 'READY_GATE_EXPIRED',
      'error', 'ready_gate_expired',
      'reason', 'ready_gate_expired',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  IF v_base IS NULL THEN
    BEGIN
      v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
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
            v_source || '.event_active_check',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
        v_base := jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', v_session.id,
          'event_id', v_session.event_id,
          'status', v_status,
          'ready_gate_status', v_status,
          'code', 'EVENT_ACTIVE_CHECK_UNAVAILABLE',
          'error_code', 'EVENT_ACTIVE_CHECK_UNAVAILABLE',
          'error', 'event_active_check_unavailable',
          'reason', 'event_active_check_unavailable',
          'retryable', true,
          'terminal', false,
          'source', v_source
        );
    END;

    IF v_base IS NULL AND v_inactive_reason IS NOT NULL THEN
      v_terminal_reason := CASE v_inactive_reason
        WHEN 'event_archived' THEN 'ready_gate_event_archived'
        WHEN 'event_cancelled' THEN 'ready_gate_event_cancelled'
        WHEN 'event_ended' THEN 'ready_gate_event_ended'
        WHEN 'event_outside_live_window' THEN 'ready_gate_event_ended'
        ELSE 'ready_gate_event_inactive'
      END;

      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          v_terminal_reason,
          jsonb_build_object('source', v_source, 'inactive_reason', v_inactive_reason)
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'EVENT_NOT_ACTIVE',
        'error_code', 'EVENT_NOT_ACTIVE',
        'error', 'event_not_active',
        'reason', v_terminal_reason,
        'inactive_reason', v_inactive_reason,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    BEGIN
      v_is_blocked := COALESCE(public.is_blocked(v_session.participant_1_id, v_session.participant_2_id), false);

      SELECT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_partner_id)
           OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_actor)
      )
      INTO v_has_report;

      v_actor_hidden := COALESCE(public.is_profile_hidden(v_actor), false);
      v_partner_hidden := COALESCE(public.is_profile_hidden(v_partner_id), false);
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
            v_source || '.safety_check',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
        v_base := jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', v_session.id,
          'event_id', v_session.event_id,
          'status', v_status,
          'ready_gate_status', v_status,
          'code', 'SAFETY_CHECK_UNAVAILABLE',
          'error_code', 'SAFETY_CHECK_UNAVAILABLE',
          'error', 'safety_check_unavailable',
          'reason', 'safety_check_unavailable',
          'retryable', true,
          'terminal', false,
          'source', v_source
        );
    END;

    IF v_base IS NULL AND (v_is_blocked OR v_has_report OR v_actor_hidden OR v_partner_hidden) THEN
      v_terminal_reason := CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END;

      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          v_terminal_reason,
          jsonb_build_object(
            'source', v_source,
            'blocked_pair', v_is_blocked,
            'reported_pair', v_has_report,
            'actor_hidden', v_actor_hidden,
            'partner_hidden', v_partner_hidden
          )
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', CASE
          WHEN v_is_blocked THEN 'BLOCKED_PAIR'
          WHEN v_has_report THEN 'REPORTED_PAIR'
          WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
          ELSE 'PARTNER_NOT_ELIGIBLE'
        END,
        'error_code', CASE
          WHEN v_is_blocked THEN 'BLOCKED_PAIR'
          WHEN v_has_report THEN 'REPORTED_PAIR'
          WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
          ELSE 'PARTNER_NOT_ELIGIBLE'
        END,
        'error', v_terminal_reason,
        'reason', v_terminal_reason,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL AND p_require_current_ready_gate_registration THEN
    IF p_lock_rows THEN
      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p1_queue_status,
        v_p1_current_room_id,
        v_p1_current_partner_id,
        v_p1_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_1_id
      FOR UPDATE;

      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p2_queue_status,
        v_p2_current_room_id,
        v_p2_current_partner_id,
        v_p2_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_2_id
      FOR UPDATE;
    ELSE
      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p1_queue_status,
        v_p1_current_room_id,
        v_p1_current_partner_id,
        v_p1_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_1_id;

      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p2_queue_status,
        v_p2_current_room_id,
        v_p2_current_partner_id,
        v_p2_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_2_id;
    END IF;

    v_p1_registration_found := COALESCE(v_p1_registration_found, false);
    v_p2_registration_found := COALESCE(v_p2_registration_found, false);

    v_registration_issues := array_remove(ARRAY[
      CASE WHEN NOT v_p1_registration_found THEN 'participant_1_registration_missing' END,
      CASE WHEN NOT v_p2_registration_found THEN 'participant_2_registration_missing' END,
      CASE WHEN v_p1_registration_found AND v_p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
      CASE WHEN v_p2_registration_found AND v_p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END,
      CASE WHEN v_p1_registration_found AND v_p1_current_room_id IS DISTINCT FROM v_session.id THEN 'participant_1_current_room_mismatch' END,
      CASE WHEN v_p2_registration_found AND v_p2_current_room_id IS DISTINCT FROM v_session.id THEN 'participant_2_current_room_mismatch' END,
      CASE WHEN v_p1_registration_found AND v_p1_current_partner_id IS DISTINCT FROM v_session.participant_2_id THEN 'participant_1_partner_mismatch' END,
      CASE WHEN v_p2_registration_found AND v_p2_current_partner_id IS DISTINCT FROM v_session.participant_1_id THEN 'participant_2_partner_mismatch' END
    ]::text[], NULL);

    IF cardinality(v_registration_issues) > 0 THEN
      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          'ready_gate_registration_desync',
          jsonb_build_object(
            'source', v_source,
            'registration_issues', to_jsonb(v_registration_issues),
            'participant_1_queue_status', v_p1_queue_status,
            'participant_2_queue_status', v_p2_queue_status,
            'participant_1_current_room_id', v_p1_current_room_id,
            'participant_2_current_room_id', v_p2_current_room_id,
            'participant_1_current_partner_id', v_p1_current_partner_id,
            'participant_2_current_partner_id', v_p2_current_partner_id
          )
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'READY_GATE_REGISTRATION_DESYNC',
        'error_code', 'READY_GATE_REGISTRATION_DESYNC',
        'error', 'ready_gate_registration_desync',
        'reason', 'ready_gate_registration_desync',
        'registration_desync', true,
        'registration_issues', to_jsonb(v_registration_issues),
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  -- ── Matrix failures: route-payload wrap without eligibility checks
  -- (identical to the former head's not-ok base handling). ──
  IF v_base IS NOT NULL
     AND lower(COALESCE(v_base ->> 'ok', v_base ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'eligibility_checked', false
      ),
      v_source
    );
  END IF;

  IF v_base IS NULL THEN
    v_base := jsonb_build_object(
      'ok', true,
      'success', true,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'status', v_status,
      'ready_gate_status', v_status,
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'prepare_entry_expires_at', v_session.prepare_entry_expires_at,
      'actionable', true,
      'source', v_source,
      'registration_checked', p_require_current_ready_gate_registration,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  END IF;

  -- ── Participant eligibility (former head layer; runs for ok bases,
  -- including the non-ready-gate-owned pass-through, as before). ──
  v_actor_eligibility := public.video_date_participant_eligibility_v1(v_actor, v_source || '.actor');
  v_partner_eligibility := public.video_date_participant_eligibility_v1(v_partner_id, v_source || '.partner');
  v_actor_ok := lower(COALESCE(v_actor_eligibility ->> 'ok', v_actor_eligibility ->> 'success', 'false')) IN ('true', 't', '1', 'yes');
  v_partner_ok := lower(COALESCE(v_partner_eligibility ->> 'ok', v_partner_eligibility ->> 'success', 'false')) IN ('true', 't', '1', 'yes');

  IF NOT v_actor_ok OR NOT v_partner_ok THEN
    v_invalid_role := CASE WHEN NOT v_actor_ok THEN 'actor' ELSE 'partner' END;
    v_invalid_eligibility := CASE
      WHEN v_invalid_role = 'actor' THEN v_actor_eligibility
      ELSE v_partner_eligibility
    END;
    v_invalid_retryable := lower(COALESCE(v_invalid_eligibility ->> 'retryable', 'false')) IN ('true', 't', '1', 'yes');
    v_invalid_terminal := lower(COALESCE(v_invalid_eligibility ->> 'terminal', 'true')) IN ('true', 't', '1', 'yes');
    v_invalid_code := COALESCE(
      NULLIF(v_invalid_eligibility ->> 'code', ''),
      NULLIF(v_invalid_eligibility ->> 'error_code', ''),
      CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END
    );
    v_invalid_reason := COALESCE(
      NULLIF(v_invalid_eligibility ->> 'reason', ''),
      NULLIF(v_invalid_eligibility ->> 'error', ''),
      CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END
    );

    v_terminalize := NULL;
    IF p_terminalize_invalid AND NOT v_invalid_retryable AND v_invalid_terminal THEN
      v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
        p_session_id,
        v_actor,
        CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END,
        jsonb_build_object(
          'source', v_source,
          'invalid_role', v_invalid_role,
          'actor_eligibility', v_actor_eligibility,
          'partner_eligibility', v_partner_eligibility
        )
      );
    END IF;

    v_invalid_payload := COALESCE(v_terminalize, '{}'::jsonb)
      || COALESCE(v_base, '{}'::jsonb)
      || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_session.ready_gate_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_session.ready_gate_status),
        'code', CASE WHEN v_invalid_retryable THEN v_invalid_code ELSE CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END END,
        'error_code', CASE WHEN v_invalid_retryable THEN v_invalid_code ELSE CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END END,
        'error', CASE WHEN v_invalid_retryable THEN v_invalid_reason ELSE CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END END,
        'reason', CASE WHEN v_invalid_retryable THEN v_invalid_reason ELSE CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END END,
        'retryable', v_invalid_retryable,
        'terminal', NOT v_invalid_retryable AND v_invalid_terminal,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
        'eligibility_retryable', v_invalid_retryable,
        'eligibility_terminal', v_invalid_terminal,
        'eligibility_code', v_invalid_code,
        'actor_eligibility', v_actor_eligibility,
        'partner_eligibility', v_partner_eligibility,
        'invalid_eligibility_role', v_invalid_role,
        'source', v_source
      );

    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      v_invalid_payload,
      v_source
    );
  END IF;

  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
      'ready_gate_actionability_checked', true,
      'eligibility_checked', true,
      'actor_eligibility_ok', true,
      'partner_eligibility_ok', true
    ),
    v_source
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
        v_source,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
        'error_code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
        'error', 'ready_gate_actionability_unavailable',
        'reason', 'ready_gate_actionability_unavailable',
        'retryable', true,
        'terminal', false,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
        'single_body_rpc', true,
        'source', v_source
      ),
      v_source
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_ready_gate_actionability_v1(uuid, uuid, text, boolean, boolean, boolean, boolean) IS
  'Single-body Ready Gate actionability precheck (rebuild PR 4). Owner-eligibility matrix (auth/session/participant/terminal/queued/snooze/status/timestamp/expiry-with-prepare-lease/event-active/safety/registration) with optional terminalization via video_date_terminalize_ready_gate_session_v1, plus participant eligibility, wrapped in video_date_both_ready_route_payload_v1. Callers: daily-room Edge, video_date_transition.prepare_entry, video_session_mark_ready_v2.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ready_gate_transition: single body
--    (formerly head -> start_snapshot -> 57014 -> clock -> result_status ->
--     registration_desync -> rgt_preserve_warmup -> rgt_pre_ready_room_meta ->
--     event_inactive core)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
-- ready_gate_transition.single_body_core (rebuild PR 4). mark_ready bridges to
-- video_session_mark_ready_v2; the inner machine owns sync/snooze/forfeit.
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_restored public.video_sessions%ROWTYPE;
  v_snapshot jsonb;
  v_result jsonb;
  v_cleanup jsonb;
  v_status text;
  v_terminal boolean := false;
  v_inactive_reason text;
  v_date_capable boolean := false;
  v_core_decided boolean := false;
  v_new_status text;
  v_expires_at timestamptz;
  v_is_p1 boolean := false;
  v_success boolean := false;
  v_status_after text;
  v_outcome text;
  v_reason_code text;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_p1_ready_gate boolean := false;
  v_p2_ready_gate boolean := false;
  v_missing_participant_registration text := NULL;
  v_repair_count integer := 0;
  v_row_count integer := 0;
  v_server_now_ms bigint;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- ── mark_ready bridge: every spelling routes to the idempotent v2 command;
  -- the machine below never sees mark_ready. ──
  IF v_action = 'mark_ready' THEN
    RETURN public.video_session_mark_ready_v2(
      p_session_id,
      p_session_id::text || ':phase3:mark_ready:legacy_ready_gate_transition',
      NULL
    ) || jsonb_build_object('legacy_ready_gate_transition_bridge', true);
  END IF;

  -- ── sync fast path A: startup-snapshot-backed, live participant-owned
  -- gates only; both_ready is expiry-exempt. ──
  IF v_action = 'sync' AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL
       AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
       AND (
         v_session.ready_gate_expires_at IS NULL
         OR v_session.ready_gate_expires_at > now()
         OR v_session.ready_gate_status = 'both_ready'
       )
       AND (
         v_session.ready_gate_status <> 'snoozed'
         OR v_session.snooze_expires_at IS NULL
         OR v_session.snooze_expires_at > now()
       ) THEN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);

      IF NULLIF(COALESCE(v_snapshot->>'inactive_reason', v_snapshot->>'inactiveReason'), '') IS NULL THEN
        v_status := COALESCE(
          v_snapshot->>'ready_gate_status',
          v_snapshot->>'status',
          'unknown'
        );

        RETURN COALESCE(v_snapshot, '{}'::jsonb) || jsonb_build_object(
          'success', COALESCE((v_snapshot->>'ok')::boolean, false),
          'status', v_status,
          'ready_gate_status', v_status,
          'result_status', v_status,
          'result_ready_gate_status', v_status,
          'startup_snapshot', v_snapshot
        );
      END IF;
    END IF;
  END IF;

  -- ── Inner machine. Statement timeouts / lock contention inside it produce
  -- the pinned retryable READY_GATE_TRANSITION_TIMEOUT payload. ──
  BEGIN
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    -- ── sync fast path B: queued-inclusive direct-row snapshot when the
    -- event is still active (former start_snapshot base). ──
    IF p_action = 'sync' AND v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
         AND v_session.ended_at IS NULL
         AND v_session.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
         AND (
           v_session.ready_gate_expires_at IS NULL
           OR v_session.ready_gate_expires_at > now()
           OR v_session.ready_gate_status = 'both_ready'
         )
         AND (
           v_session.ready_gate_status <> 'snoozed'
           OR v_session.snooze_expires_at IS NULL
           OR v_session.snooze_expires_at > now()
         ) THEN
        v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

        IF v_inactive_reason IS NULL THEN
          RETURN jsonb_build_object(
            'ok', true,
            'success', true,
            'status', v_session.ready_gate_status,
            'ready_gate_status', v_session.ready_gate_status,
            'result_status', v_session.ready_gate_status,
            'result_ready_gate_status', v_session.ready_gate_status,
            'state', v_session.state,
            'phase', v_session.phase,
            'event_id', v_session.event_id,
            'participant_1_id', v_session.participant_1_id,
            'participant_2_id', v_session.participant_2_id,
            'ready_participant_1_at', v_session.ready_participant_1_at,
            'ready_participant_2_at', v_session.ready_participant_2_at,
            'ready_gate_expires_at', v_session.ready_gate_expires_at,
            'snoozed_by', v_session.snoozed_by,
            'snooze_expires_at', v_session.snooze_expires_at,
            'daily_room_name', v_session.daily_room_name,
            'daily_room_url', v_session.daily_room_url,
            'session_seq', v_session.session_seq,
            'terminal', false,
            'snapshot', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        END IF;
      END IF;

      v_inactive_reason := NULL;
    END IF;

    -- ── Pre-ready room-metadata repair (former rgt_preserve_warmup pre-pass):
    -- a pre-both_ready gate must not carry Daily room metadata into a
    -- transition-sensitive action. ──
    IF v_actor IS NOT NULL AND p_action IN ('mark_ready', 'snooze') THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
         AND v_session.ended_at IS NULL
         AND v_session.state = 'ready_gate'::public.video_date_state
         AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
         AND v_session.handshake_started_at IS NULL
         AND v_session.date_started_at IS NULL
         AND v_session.participant_1_joined_at IS NULL
         AND v_session.participant_2_joined_at IS NULL
         AND (
           v_session.daily_room_name IS NOT NULL
           OR v_session.daily_room_url IS NOT NULL
           OR v_session.daily_room_verified_at IS NOT NULL
           OR v_session.daily_room_expires_at IS NOT NULL
           OR v_session.daily_room_provider_verify_reason IS NOT NULL
         ) THEN
        UPDATE public.video_sessions
        SET
          daily_room_name = NULL,
          daily_room_url = NULL,
          daily_room_verified_at = NULL,
          daily_room_expires_at = NULL,
          daily_room_provider_verify_reason = NULL,
          state_updated_at = now()
        WHERE id = p_session_id
          AND ended_at IS NULL
          AND state = 'ready_gate'::public.video_date_state
          AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
          AND handshake_started_at IS NULL
          AND date_started_at IS NULL
          AND participant_1_joined_at IS NULL
          AND participant_2_joined_at IS NULL
          AND (
            daily_room_name IS NOT NULL
            OR daily_room_url IS NOT NULL
            OR daily_room_verified_at IS NOT NULL
            OR daily_room_expires_at IS NOT NULL
            OR daily_room_provider_verify_reason IS NOT NULL
          )
        RETURNING * INTO v_session;

        GET DIAGNOSTICS v_repair_count = ROW_COUNT;

        IF v_repair_count > 0 THEN
          PERFORM public.record_event_loop_observability(
            'ready_gate_transition',
            'success',
            'pre_ready_room_metadata_repaired',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', p_action,
              'p_reason', p_reason,
              'repaired_daily_room_metadata', true
            )
          );
        END IF;
      END IF;
    END IF;

    -- ── Event-inactive ownership under the locked session row (former
    -- rgt_pre_ready_room_meta). Natural live-window expiry has no event-row
    -- trigger, so participant sync/snooze actions detect it here. ──
    IF p_action IN ('sync', 'mark_ready', 'snooze') AND v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

        IF v_inactive_reason IS NOT NULL THEN
          v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id;

          v_date_capable := (
            v_session.handshake_started_at IS NOT NULL
            OR v_session.date_started_at IS NOT NULL
            OR v_session.daily_room_name IS NOT NULL
            OR v_session.daily_room_url IS NOT NULL
            OR v_session.participant_1_joined_at IS NOT NULL
            OR v_session.participant_2_joined_at IS NOT NULL
            OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
            OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
          );

          IF v_session.ended_at IS NOT NULL OR v_session.ready_gate_status = 'expired' THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'reason', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
              'inactive_reason', v_inactive_reason,
              'error_code', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
              'terminal', true,
              'event_id', v_session.event_id
            );
          ELSIF p_action = 'sync' OR v_date_capable THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_participant_1_at', v_session.ready_participant_1_at,
              'ready_participant_2_at', v_session.ready_participant_2_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'snoozed_by', v_session.snoozed_by,
              'snooze_expires_at', v_session.snooze_expires_at,
              'reason', 'event_not_active',
              'inactive_reason', v_inactive_reason,
              'date_capable', v_date_capable,
              'terminal', false,
              'event_id', v_session.event_id,
              'cleanup', v_cleanup
            );
          ELSE
            PERFORM public.record_event_loop_observability(
              'ready_gate_transition',
              'blocked',
              'READY_GATE_EVENT_ENDED',
              NULL,
              v_session.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', p_action,
                'p_reason', p_reason,
                'inactive_reason', v_inactive_reason,
                'cleanup', v_cleanup
              )
            );

            v_result := jsonb_build_object(
              'success', false,
              'error', 'event_not_active',
              'code', 'EVENT_NOT_ACTIVE',
              'error_code', 'EVENT_NOT_ACTIVE',
              'reason', 'event_not_active',
              'inactive_reason', v_inactive_reason,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'terminal', false,
              'event_id', v_session.event_id
            );
          END IF;

          v_core_decided := true;
        END IF;
      END IF;
    END IF;

    -- ── Core machine (former event_inactive base) for sync/snooze/forfeit/
    -- unknown actions when the event is active. ──
    IF NOT v_core_decided THEN
      SELECT *
      INTO v_before
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('success', false, 'error', 'unauthorized');
      ELSE
        PERFORM public.expire_stale_video_sessions();

        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
        ELSE
          v_is_p1 := (v_session.participant_1_id = v_actor);
          IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
            v_result := jsonb_build_object('success', false, 'error', 'access_denied');
          ELSIF p_action = 'sync' THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_participant_1_at', v_session.ready_participant_1_at,
              'ready_participant_2_at', v_session.ready_participant_2_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'snoozed_by', v_session.snoozed_by,
              'snooze_expires_at', v_session.snooze_expires_at,
              'terminal', v_session.ended_at IS NOT NULL
                OR v_session.ready_gate_status IN ('forfeited', 'expired')
            );
          ELSE
            -- Expiry is re-checked under the locked row for transition-
            -- sensitive actions. This closes the race where cleanup ran just
            -- before the gate elapsed, but the user action reached the RPC
            -- immediately afterward. (mark_ready never reaches this machine;
            -- the literal guard is kept for the pinned contract shape.)
            IF p_action IN ('mark_ready', 'snooze')
               AND v_session.ended_at IS NULL
               AND v_session.state = 'ready_gate'::public.video_date_state
               AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
               AND v_session.ready_gate_expires_at IS NOT NULL
               AND v_session.ready_gate_expires_at <= v_now THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'expired',
                state = 'ended',
                phase = 'ended',
                ended_at = v_now,
                ended_reason = 'ready_gate_expired',
                snoozed_by = NULL,
                snooze_expires_at = NULL,
                duration_seconds = COALESCE(
                  duration_seconds,
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND state = 'ready_gate'::public.video_date_state
                AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
                AND ready_gate_expires_at IS NOT NULL
                AND ready_gate_expires_at <= v_now
                AND date_started_at IS NULL
                AND handshake_started_at IS NULL
                AND daily_room_name IS NULL
                AND daily_room_url IS NULL
                AND participant_1_joined_at IS NULL
                AND participant_2_joined_at IS NULL
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count > 0 THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = v_session.id;

                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'expired',
                  'ready_gate_status', 'expired',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', 'ready_gate_expired',
                  'error_code', 'ready_gate_expired',
                  'terminal', true
                );
              ELSE
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', true
                  );
                ELSE
                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'stale_transition',
                    'error_code', 'stale_transition',
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'reason', 'guarded_update_zero_rows',
                    'terminal', false
                  );
                END IF;
              END IF;
            ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
              v_result := jsonb_build_object(
                'success', true,
                'status', v_session.ready_gate_status,
                'ready_gate_status', v_session.ready_gate_status,
                'ready_gate_expires_at', v_session.ready_gate_expires_at,
                'terminal', true
              );
            ELSIF p_action = 'snooze' THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'snoozed',
                snoozed_by = v_actor,
                snooze_expires_at = v_now + interval '2 minutes',
                ready_gate_expires_at = v_now + interval '2 minutes',
                state = 'ready_gate',
                phase = 'ready_gate',
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND state = 'ready_gate'::public.video_date_state
                AND handshake_started_at IS NULL
                AND date_started_at IS NULL
                AND daily_room_name IS NULL
                AND daily_room_url IS NULL
                AND participant_1_joined_at IS NULL
                AND participant_2_joined_at IS NULL
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count = 0 THEN
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', true
                  );
                ELSE
                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'conflict',
                    'error_code', 'guarded_update_zero_rows',
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'reason', 'session_no_longer_ready_gate_mutable',
                    'terminal', false
                  );
                END IF;
              ELSE
                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'snoozed',
                  'ready_gate_status', 'snoozed',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'snoozed_by', v_session.snoozed_by,
                  'snooze_expires_at', v_session.snooze_expires_at,
                  'terminal', false
                );
              END IF;
            ELSIF p_action = 'forfeit' THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'forfeited',
                ready_gate_expires_at = v_now,
                snoozed_by = NULL,
                snooze_expires_at = NULL,
                state = 'ended',
                phase = 'ended',
                ended_at = COALESCE(ended_at, v_now),
                ended_reason = COALESCE(p_reason, ended_reason, 'ready_gate_forfeit'),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ready_gate_status NOT IN ('forfeited', 'expired', 'both_ready')
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count = 0 THEN
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSE
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL
                  );
                END IF;
              ELSE
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = v_session.id;

                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'forfeited',
                  'ready_gate_status', 'forfeited',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', COALESCE(p_reason, 'ready_gate_forfeit'),
                  'terminal', true
                );
              END IF;
            ELSE
              v_result := jsonb_build_object('success', false, 'error', 'unknown_action');
            END IF;
          END IF;
        END IF;
      END IF;

      -- ── Core observability: every machine call records a before/after
      -- comparison row. ──
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_success := COALESCE(v_result @> '{"success": true}'::jsonb, false);
      v_status_after := COALESCE(v_after.ready_gate_status, v_result->>'ready_gate_status', v_result->>'status');

      v_reason_code := CASE
        WHEN NOT v_success THEN COALESCE(v_result->>'error_code', v_result->>'error', v_result->>'code', 'unknown_error')
        WHEN p_action = 'sync' AND v_status_after = 'expired' THEN 'sync_expired'
        WHEN p_action = 'sync' THEN 'sync'
        WHEN p_action IN ('mark_ready', 'snooze') AND COALESCE(v_result->>'reason', '') = 'ready_gate_expired' THEN 'ready_gate_expired'
        WHEN p_action = 'snooze' THEN 'snooze'
        WHEN p_action = 'forfeit' THEN 'forfeit'
        ELSE COALESCE(p_action, 'unknown_action')
      END;

      v_outcome := CASE
        WHEN v_success THEN 'success'
        WHEN v_reason_code IN ('unauthorized', 'session_not_found', 'access_denied', 'unknown_action') THEN 'blocked'
        ELSE 'error'
      END;

      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        v_outcome,
        v_reason_code,
        NULL,
        COALESCE(v_after.event_id, v_before.event_id),
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'p_reason', p_reason,
          'success', v_success,
          'result_status', v_result->>'status',
          'result_error', v_result->>'error',
          'result_error_code', v_result->>'error_code',
          'result_reason', v_result->>'reason',
          'status_before', v_before.ready_gate_status,
          'status_after', v_status_after,
          'state_before', v_before.state::text,
          'state_after', v_after.state::text,
          'phase_before', v_before.phase,
          'phase_after', v_after.phase,
          'ready_gate_expires_at_before', v_before.ready_gate_expires_at,
          'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
          'ready_participant_1_at_before', v_before.ready_participant_1_at,
          'ready_participant_1_at_after', v_after.ready_participant_1_at,
          'ready_participant_2_at_before', v_before.ready_participant_2_at,
          'ready_participant_2_at_after', v_after.ready_participant_2_at,
          'snoozed_by_before', v_before.snoozed_by,
          'snoozed_by_after', v_after.snoozed_by,
          'snooze_expires_at_before', v_before.snooze_expires_at,
          'snooze_expires_at_after', v_after.snooze_expires_at,
          'ended_reason_after', v_after.ended_reason,
          'row_count_checked', true,
          'observed_at', now()
        )
      );
    END IF;

    -- ── Canonical-truth enrichment (former rgt_preserve_warmup post-merge):
    -- participant-safe session truth rides on every machine result. ──
    IF v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
        v_terminal := CASE
          WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
          ELSE v_session.ended_at IS NOT NULL
            OR v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
        END;

        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
          'event_id', v_session.event_id,
          'participant_1_id', v_session.participant_1_id,
          'participant_2_id', v_session.participant_2_id,
          'ready_participant_1_at', v_session.ready_participant_1_at,
          'ready_participant_2_at', v_session.ready_participant_2_at,
          'status', v_status,
          'ready_gate_status', v_status,
          'ready_gate_expires_at', v_session.ready_gate_expires_at,
          'snoozed_by', v_session.snoozed_by,
          'snooze_expires_at', v_session.snooze_expires_at,
          'terminal', v_terminal
        );

        -- ── Canonical both_ready room metadata re-derivation (former
        -- registration_desync post): a successful both_ready result must
        -- never leave the deterministic date-<id> room fields NULL. ──
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status');

        IF COALESCE((v_result->>'success')::boolean, false)
           AND v_status = 'both_ready' THEN
          -- Resolve the canonical Daily domain: GUC (optional) -> most recent
          -- canonical host -> hard fallback. A domain is ALWAYS resolved.
          v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');

          IF v_domain IS NULL THEN
            SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
            INTO v_domain
            FROM public.video_sessions vs
            WHERE vs.daily_room_url LIKE 'http%://%/date-%'
            ORDER BY vs.state_updated_at DESC NULLS LAST
            LIMIT 1;
          END IF;

          -- Locked, non-secret production Daily domain (= DAILY_ROOM_DOMAIN_FALLBACK).
          v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
          v_url := 'https://' || v_domain || '/' || v_expected_room_name;

          UPDATE public.video_sessions
            SET
              daily_room_name = v_expected_room_name,
              daily_room_url = v_url,
              daily_room_provider_verify_reason = COALESCE(
                daily_room_provider_verify_reason,
                'ready_gate_both_ready_canonical_rederive'
              ),
              state_updated_at = now()
            WHERE id = p_session_id
              AND ended_at IS NULL
              AND state = 'ready_gate'::public.video_date_state
              AND ready_gate_status = 'both_ready'
              AND handshake_started_at IS NULL
              AND date_started_at IS NULL
              AND participant_1_joined_at IS NULL
              AND participant_2_joined_at IS NULL
              AND (daily_room_name IS NULL OR daily_room_url IS NULL)
            RETURNING * INTO v_restored;

          IF FOUND THEN
            PERFORM public.record_event_loop_observability(
              'ready_gate_transition',
              'success',
              'both_ready_canonical_room_metadata_rederived',
              NULL,
              v_restored.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', p_action,
                'p_reason', p_reason,
                'daily_room_name', v_restored.daily_room_name,
                'daily_room_verified_at', v_restored.daily_room_verified_at,
                'daily_room_expires_at', v_restored.daily_room_expires_at,
                'rederived', true,
                'provider_verify_skip_eligible', false
              )
            );

            v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
              'daily_room_name', v_restored.daily_room_name,
              'daily_room_url', v_restored.daily_room_url,
              'daily_room_verified_at', v_restored.daily_room_verified_at,
              'daily_room_expires_at', v_restored.daily_room_expires_at,
              'daily_room_provider_verify_reason', v_restored.daily_room_provider_verify_reason
            );
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── Registration-desync forfeit post-check (former result_status base):
    -- an open pre-provider gate whose registrations no longer point at it is
    -- forfeited instead of being echoed back as live. ──
    IF v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
        v_terminal := CASE
          WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
          ELSE false
        END;

        -- `both_ready` is a valid pre-provider handoff while its expiry is
        -- open. Other terminal statuses/reasons are owned by the machine.
        IF NOT (
             COALESCE(v_result->>'success', 'true') = 'false'
             OR v_status NOT IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
             OR (v_terminal AND v_status IS DISTINCT FROM 'both_ready')
             OR v_session.ended_at IS NOT NULL
             OR v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
             OR v_session.handshake_started_at IS NOT NULL
             OR v_session.date_started_at IS NOT NULL
             OR v_session.daily_room_name IS NOT NULL
             OR v_session.daily_room_url IS NOT NULL
             OR v_session.participant_1_joined_at IS NOT NULL
             OR v_session.participant_2_joined_at IS NOT NULL
             OR COALESCE(v_session.phase, 'ready_gate') IN ('handshake', 'date')
             OR v_session.ready_gate_expires_at IS NULL
             OR v_session.ready_gate_expires_at <= v_now
           ) THEN
          SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
          INTO v_p1_ready_gate
          FROM public.event_registrations er
          WHERE er.event_id = v_session.event_id
            AND er.profile_id = v_session.participant_1_id
          FOR UPDATE;

          v_p1_ready_gate := COALESCE(v_p1_ready_gate, false);

          SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
          INTO v_p2_ready_gate
          FROM public.event_registrations er
          WHERE er.event_id = v_session.event_id
            AND er.profile_id = v_session.participant_2_id
          FOR UPDATE;

          v_p2_ready_gate := COALESCE(v_p2_ready_gate, false);

          IF NOT (v_p1_ready_gate AND v_p2_ready_gate) THEN
            v_missing_participant_registration := CASE
              WHEN NOT v_p1_ready_gate AND NOT v_p2_ready_gate THEN 'both'
              WHEN NOT v_p1_ready_gate THEN 'participant_1'
              ELSE 'participant_2'
            END;

            UPDATE public.video_sessions
            SET
              ready_gate_status = 'forfeited',
              ready_gate_expires_at = v_now,
              snoozed_by = NULL,
              snooze_expires_at = NULL,
              state = 'ended'::public.video_date_state,
              phase = 'ended',
              ended_at = COALESCE(ended_at, v_now),
              ended_reason = COALESCE(ended_reason, 'ready_gate_registration_desync'),
              duration_seconds = COALESCE(
                duration_seconds,
                GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
              ),
              state_updated_at = v_now
            WHERE id = p_session_id
              AND ended_at IS NULL
              AND state = 'ready_gate'::public.video_date_state
              AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
              AND handshake_started_at IS NULL
              AND date_started_at IS NULL
              AND daily_room_name IS NULL
              AND daily_room_url IS NULL
              AND participant_1_joined_at IS NULL
              AND participant_2_joined_at IS NULL
              AND COALESCE(phase, 'ready_gate') NOT IN ('handshake', 'date')
            RETURNING * INTO v_after;

            GET DIAGNOSTICS v_row_count = ROW_COUNT;

            IF v_row_count > 0 THEN
              UPDATE public.event_registrations
              SET
                queue_status = 'idle',
                current_room_id = NULL,
                current_partner_id = NULL,
                last_active_at = v_now
              WHERE event_id = v_after.event_id
                AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id)
                AND (
                  current_room_id = v_after.id
                  OR (queue_status = 'in_ready_gate' AND current_room_id IS NULL)
                );

              PERFORM public.record_event_loop_observability(
                'ready_gate_transition',
                'success',
                'ready_gate_registration_desync',
                NULL,
                v_after.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', p_action,
                  'p_reason', p_reason,
                  'status_before', v_status,
                  'missing_participant_registration', v_missing_participant_registration,
                  'registration_desync', true
                )
              );

              v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
                'success', true,
                'status', 'forfeited',
                'ready_gate_status', 'forfeited',
                'ready_gate_expires_at', v_after.ready_gate_expires_at,
                'reason', 'ready_gate_registration_desync',
                'error_code', 'ready_gate_registration_desync',
                'terminal', true,
                'registration_desync', true,
                'missing_participant_registration', v_missing_participant_registration,
                'event_id', v_after.event_id
              );
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── result_status echo + dual server clock keys (former clock/57014
    -- layers). ──
    IF jsonb_typeof(v_result) = 'object' THEN
      v_status := COALESCE(
        v_result->>'ready_gate_status',
        v_result->>'status',
        v_result->>'result_ready_gate_status',
        v_result->>'result_status'
      );

      IF NULLIF(v_status, '') IS NOT NULL THEN
        v_result := v_result || jsonb_build_object(
          'result_status', v_status,
          'result_ready_gate_status', v_status
        );
      END IF;
    END IF;

    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  EXCEPTION
    WHEN query_canceled OR lock_not_available THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        PERFORM public.video_date_lifecycle_observe_exception_v2(
          p_session_id,
          v_actor,
          'ready_gate_transition.machine_timeout',
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

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'ready_gate_transition_timeout',
        'reason', 'ready_gate_transition_timeout',
        'code', 'READY_GATE_TRANSITION_TIMEOUT',
        'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
        'retryable', true,
        'retry_after_seconds', 2,
        'retry_after_ms', 2000,
        'status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'result_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'terminal', false,
        'single_body_rpc', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;
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
        'ready_gate_transition',
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
    BEGIN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    EXCEPTION
      WHEN OTHERS THEN
        v_snapshot := NULL;
    END;
    v_status := COALESCE(
      v_snapshot->>'ready_gate_status',
      v_snapshot->>'status',
      'unknown'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'ready_gate_transition_failed',
      'reason', 'ready_gate_transition_failed',
      'code', 'READY_GATE_TRANSITION_FAILED',
      'error_code', 'READY_GATE_TRANSITION_FAILED',
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'startup_snapshot', v_snapshot,
      'single_body_rpc', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Single-body Ready Gate sync/expiry owner (rebuild PR 4). mark_ready bridges to video_session_mark_ready_v2; sync fast paths, pre-ready room-metadata repair, event-inactive ownership, the sync/snooze/forfeit machine with expiry re-check under lock, canonical both_ready room re-derivation, the registration-desync forfeit post-check, result-status echo, and dual server clock keys.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. video_session_mark_ready_v2: single body
--    (formerly head -> hot_base -> active_entry -> both_ready_owner ->
--     terminal_truth -> partial -> review_comments -> routeable_entry ->
--     event_cleanup core)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL::text,
  p_request_hash text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
-- video_session_mark_ready_v2.single_body_core (rebuild PR 4): actionability
-- precheck -> event-inactive sweep -> decisive command core -> both-ready
-- entry protection -> partner/date-starting notifications -> enrichment ->
-- both-ready route payload owner, inside the hot-path no-throw shell.
DECLARE
  v_actor uuid := NULL;
  v_now timestamptz := clock_timestamp();
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_key text := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    COALESCE(p_session_id::text, 'missing-session') || ':phase3:mark_ready'
  );
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_precheck jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_command_status text;
  v_request_hash text;
  v_replay_result jsonb := '{}'::jsonb;
  v_replay_retryable boolean := false;
  v_replay_terminal boolean := false;
  v_reopened_retryable_command boolean := false;
  v_reclaimed_processing_command boolean := false;
  v_command_created_at timestamptz;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_is_p1 boolean := false;
  v_actor_ready boolean := false;
  v_new_p1_ready_at timestamptz;
  v_new_p2_ready_at timestamptz;
  v_new_status text;
  v_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_inactive_reason text;
  v_status text;
  v_date_capable boolean := false;
  v_cleanup jsonb := '{}'::jsonb;
  v_result jsonb;
  v_clean_result jsonb;
  v_protection jsonb;
  v_success boolean := false;
  v_event_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner_id uuid;
  v_recipient uuid;
  v_enqueue_result jsonb;
  v_path text;
  v_notification_degraded boolean := false;
  v_date_starting_degraded boolean := false;
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_row_count integer := 0;
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

  -- ── Hot-path no-throw shell: everything below returns structured JSON. ──
  BEGIN
    -- ── Decisive actionability precheck (owner-eligibility + participant
    -- eligibility + safety + registration, locking the session and both
    -- registration rows; invalid gates terminalize). ──
    v_precheck := public.video_date_ready_gate_actionability_v1(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2',
      false,
      true,
      true,
      true
    );

    IF lower(COALESCE(v_precheck ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
      v_result := v_precheck
        - 'sqlstate'
        - 'message'
        - 'detail'
        - 'hint'
        - 'context'
        || jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', p_session_id,
          'commandStatus', 'rejected',
          'decisive_mark_ready_prechecked', true,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    ELSE
      -- ── Event-inactive sweep (former routeable_entry pre-pass): events
      -- that died between the precheck statement and this statement still
      -- terminalize their gates before the decisive commit. ──
      IF p_session_id IS NOT NULL THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND
           AND v_session.event_id IS NOT NULL
           AND v_session.ended_at IS NULL
           AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
           AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
           AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
          v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
          IF v_inactive_reason IS NOT NULL THEN
            PERFORM public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);
          END IF;
          v_inactive_reason := NULL;
        END IF;
      END IF;

      -- ── Decisive event-cleanup command core. Its own handlers own the
      -- READY_GATE_TRANSITION_TIMEOUT / MARK_READY_FAILED payloads and the
      -- command-finish bookkeeping. ──
      BEGIN
        PERFORM set_config('lock_timeout', '10000ms', true);
        PERFORM set_config('statement_timeout', '20000ms', true);

        IF p_session_id IS NULL THEN
          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'session_not_found',
            'reason', 'session_not_found',
            'code', 'SESSION_NOT_FOUND',
            'error_code', 'SESSION_NOT_FOUND',
            'retryable', false,
            'terminal', true,
            'commandStatus', 'rejected',
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        ELSIF v_actor IS NULL THEN
          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'not_authenticated',
            'reason', 'not_authenticated',
            'code', 'NOT_AUTHENTICATED',
            'error_code', 'NOT_AUTHENTICATED',
            'retryable', false,
            'terminal', false,
            'commandStatus', 'rejected',
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        ELSE
          v_begin := public.video_session_command_begin_v2(
            p_session_id,
            v_actor,
            'mark_ready',
            v_key,
            v_request,
            p_request_hash
          );

          IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
            v_result := COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
              'ok', false,
              'success', false,
              'commandStatus', COALESCE(v_begin->>'status', 'rejected'),
              'terminal', false,
              'server_now_ms', v_server_now_ms,
              'serverNowMs', v_server_now_ms
            );
          ELSE
            v_command_status := COALESCE(v_begin->>'status', 'unknown');
            v_command_id := NULLIF(v_begin->>'commandId', '')::bigint;
            v_request_hash := v_begin->>'requestHash';
            v_result := NULL;

            IF v_command_status IN ('replay', 'replay_rejected', 'in_progress') THEN
              SELECT *
              INTO v_after
              FROM public.video_sessions
              WHERE id = p_session_id;

              v_actor_ready := (
                (v_after.participant_1_id = v_actor AND v_after.ready_participant_1_at IS NOT NULL)
                OR (v_after.participant_2_id = v_actor AND v_after.ready_participant_2_at IS NOT NULL)
                OR v_after.ready_gate_status = 'both_ready'
              );

              IF v_actor_ready AND v_command_status IS DISTINCT FROM 'in_progress' THEN
                v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'commandStatus', v_command_status,
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'ready_gate_status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'result_status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'event_id', v_after.event_id,
                  'participant_1_id', v_after.participant_1_id,
                  'participant_2_id', v_after.participant_2_id,
                  'ready_participant_1_at', v_after.ready_participant_1_at,
                  'ready_participant_2_at', v_after.ready_participant_2_at,
                  'ready_gate_expires_at', v_after.ready_gate_expires_at,
                  'daily_room_name', v_after.daily_room_name,
                  'daily_room_url', v_after.daily_room_url,
                  'daily_room_verified_at', v_after.daily_room_verified_at,
                  'daily_room_expires_at', v_after.daily_room_expires_at,
                  'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
                  'session_seq', v_after.session_seq,
                  'terminal', v_after.ready_gate_status = 'both_ready',
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
              END IF;
            END IF;

            IF v_result IS NULL AND v_command_status = 'replay' THEN
              v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
                'commandStatus', 'replay',
                'commandId', v_command_id,
                'requestHash', v_request_hash,
                'status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'ready_gate_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'result_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'result_ready_gate_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'ready_participant_1_at', v_after.ready_participant_1_at,
                'ready_participant_2_at', v_after.ready_participant_2_at,
                'ready_gate_expires_at', v_after.ready_gate_expires_at,
                'daily_room_name', v_after.daily_room_name,
                'daily_room_url', v_after.daily_room_url,
                'session_seq', v_after.session_seq,
                'server_now_ms', v_server_now_ms,
                'serverNowMs', v_server_now_ms
              );
            END IF;

            IF v_result IS NULL AND v_command_status = 'replay_rejected' THEN
              v_replay_result := COALESCE(v_begin->'result', '{}'::jsonb);
              v_replay_retryable :=
                jsonb_typeof(v_replay_result->'retryable') = 'boolean'
                AND (v_replay_result->>'retryable')::boolean;
              v_replay_terminal :=
                jsonb_typeof(v_replay_result->'terminal') = 'boolean'
                AND (v_replay_result->>'terminal')::boolean;

              IF v_replay_retryable AND NOT v_replay_terminal THEN
                UPDATE public.video_session_commands
                SET
                  status = 'processing',
                  committed_at = NULL,
                  result_payload = NULL
                WHERE id = v_command_id
                  AND actor = v_actor
                  AND session_id = p_session_id
                  AND command_kind = 'mark_ready'
                  AND idempotency_key = v_key
                  AND request_hash = v_request_hash
                  AND status = 'rejected'
                RETURNING id INTO v_command_id;

                GET DIAGNOSTICS v_row_count = ROW_COUNT;
                IF v_row_count = 0 THEN
                  v_result := v_replay_result || jsonb_build_object(
                    'commandStatus', 'replay_rejected',
                    'commandId', NULLIF(v_begin->>'commandId', '')::bigint,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                ELSE
                  v_reopened_retryable_command := true;
                END IF;
              ELSE
                v_result := v_replay_result || jsonb_build_object(
                  'commandStatus', 'replay_rejected',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'ready_gate_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'result_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'result_ready_gate_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
              END IF;
            ELSIF v_result IS NULL AND v_command_status = 'in_progress' THEN
              SELECT created_at
              INTO v_command_created_at
              FROM public.video_session_commands
              WHERE id = v_command_id
                AND actor = v_actor
                AND session_id = p_session_id
                AND command_kind = 'mark_ready'
                AND idempotency_key = v_key
                AND request_hash = v_request_hash;

              IF v_command_created_at IS NOT NULL
                 AND v_command_created_at < v_now - interval '6 seconds' THEN
                UPDATE public.video_session_commands
                SET
                  status = 'processing',
                  committed_at = NULL,
                  result_payload = NULL
                WHERE id = v_command_id
                  AND actor = v_actor
                  AND session_id = p_session_id
                  AND command_kind = 'mark_ready'
                  AND idempotency_key = v_key
                  AND request_hash = v_request_hash
                  AND status = 'processing'
                RETURNING id INTO v_command_id;

                GET DIAGNOSTICS v_row_count = ROW_COUNT;
                v_reclaimed_processing_command := v_row_count > 0;
              END IF;

              IF NOT v_reclaimed_processing_command THEN
                v_result := jsonb_build_object(
                  'ok', false,
                  'success', false,
                  'error', 'command_in_progress',
                  'reason', 'command_in_progress',
                  'retryable', true,
                  'retry_after_seconds', 1,
                  'retry_after_ms', 1000,
                  'commandStatus', 'in_progress',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'terminal', false,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
              END IF;
            ELSIF v_result IS NULL AND v_command_status IS DISTINCT FROM 'started' THEN
              v_result := jsonb_build_object(
                'ok', false,
                'success', false,
                'error', 'command_in_progress',
                'reason', 'command_in_progress',
                'retryable', true,
                'retry_after_seconds', 1,
                'retry_after_ms', 1000,
                'commandStatus', v_command_status,
                'commandId', v_command_id,
                'requestHash', v_request_hash,
                'terminal', false,
                'server_now_ms', v_server_now_ms,
                'serverNowMs', v_server_now_ms
              );
            END IF;

            IF v_result IS NULL THEN
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id
              FOR UPDATE;

              IF NOT FOUND THEN
                v_result := jsonb_build_object(
                  'ok', false,
                  'success', false,
                  'error', 'session_not_found',
                  'reason', 'session_not_found',
                  'code', 'SESSION_NOT_FOUND',
                  'error_code', 'SESSION_NOT_FOUND',
                  'retryable', false,
                  'terminal', true,
                  'commandStatus', 'rejected',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSE
                v_is_p1 := v_session.participant_1_id = v_actor;
                IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
                  v_result := jsonb_build_object(
                    'ok', false,
                    'success', false,
                    'error', 'not_participant',
                    'reason', 'not_participant',
                    'retryable', false,
                    'terminal', true,
                    'commandStatus', 'rejected',
                    'commandId', v_command_id,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                  BEGIN
                    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                END IF;
              END IF;
            END IF;

            IF v_result IS NULL THEN
              IF v_session.event_id IS NOT NULL
                 AND v_session.ended_at IS NULL
                 AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
                 AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
                 AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
                v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
              END IF;

              IF v_inactive_reason IS NOT NULL THEN
                UPDATE public.video_sessions
                SET
                  ready_gate_status = 'expired',
                  state = 'ended'::public.video_date_state,
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = COALESCE(ended_reason, v_inactive_reason),
                  snoozed_by = NULL,
                  snooze_expires_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND COALESCE(state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
                  AND COALESCE(phase, 'ready_gate') = 'ready_gate'
                  AND COALESCE(ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
                RETURNING * INTO v_after;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = COALESCE(v_after.event_id, v_session.event_id)
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = p_session_id;

                v_status := COALESCE(v_after.ready_gate_status, v_session.ready_gate_status, 'expired');
                v_date_capable := (
                  v_after.handshake_started_at IS NOT NULL
                  OR v_after.date_started_at IS NOT NULL
                  OR v_after.daily_room_name IS NOT NULL
                  OR v_after.daily_room_url IS NOT NULL
                  OR v_after.participant_1_joined_at IS NOT NULL
                  OR v_after.participant_2_joined_at IS NOT NULL
                  OR v_after.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
                  OR COALESCE(v_after.phase, '') IN ('handshake', 'date')
                );
                v_cleanup := jsonb_build_object('session_terminalized', true);

                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', v_status,
                  'ready_gate_status', v_status,
                  'result_status', v_status,
                  'result_ready_gate_status', v_status,
                  'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
                  'reason', COALESCE(v_after.ended_reason, v_inactive_reason),
                  'error_code', COALESCE(v_after.ended_reason, v_inactive_reason),
                  'inactive_reason', v_inactive_reason,
                  'date_capable', v_date_capable,
                  'terminal', true,
                  'event_id', COALESCE(v_after.event_id, v_session.event_id),
                  'event_active_preflight_blocked', true,
                  'cleanup', v_cleanup,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.ended_at IS NOT NULL
                 OR v_session.ready_gate_status IN ('forfeited', 'expired', 'cancelled', 'ended') THEN
                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'result_status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                  'terminal', true,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.ready_gate_status = 'both_ready' THEN
                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', 'both_ready',
                  'ready_gate_status', 'both_ready',
                  'result_status', 'both_ready',
                  'result_ready_gate_status', 'both_ready',
                  'event_id', v_session.event_id,
                  'participant_1_id', v_session.participant_1_id,
                  'participant_2_id', v_session.participant_2_id,
                  'ready_participant_1_at', v_session.ready_participant_1_at,
                  'ready_participant_2_at', v_session.ready_participant_2_at,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'daily_room_name', v_session.daily_room_name,
                  'daily_room_url', v_session.daily_room_url,
                  'daily_room_verified_at', v_session.daily_room_verified_at,
                  'daily_room_expires_at', v_session.daily_room_expires_at,
                  'daily_room_provider_verify_reason', v_session.daily_room_provider_verify_reason,
                  'session_seq', v_session.session_seq,
                  'terminal', true,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
                 OR v_session.handshake_started_at IS NOT NULL
                 OR v_session.date_started_at IS NOT NULL
                 OR v_session.participant_1_joined_at IS NOT NULL
                 OR v_session.participant_2_joined_at IS NOT NULL
                 OR v_session.ready_gate_status NOT IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
                v_result := jsonb_build_object(
                  'ok', false,
                  'success', false,
                  'error', 'session_no_longer_ready_gate_mutable',
                  'reason', 'session_no_longer_ready_gate_mutable',
                  'status', v_session.ready_gate_status,
                  'ready_gate_status', v_session.ready_gate_status,
                  'result_status', v_session.ready_gate_status,
                  'result_ready_gate_status', v_session.ready_gate_status,
                  'terminal', false,
                  'retryable', true,
                  'retry_after_ms', 1000,
                  'commandStatus', 'rejected',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.ready_gate_expires_at IS NOT NULL
                 AND v_session.ready_gate_expires_at <= v_now THEN
                UPDATE public.video_sessions
                SET
                  ready_gate_status = 'expired',
                  state = 'ended'::public.video_date_state,
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = COALESCE(ended_reason, 'ready_gate_expired'),
                  snoozed_by = NULL,
                  snooze_expires_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND state = 'ready_gate'::public.video_date_state
                  AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
                  AND handshake_started_at IS NULL
                  AND date_started_at IS NULL
                  AND participant_1_joined_at IS NULL
                  AND participant_2_joined_at IS NULL
                RETURNING * INTO v_after;

                BEGIN
                  UPDATE public.event_registrations
                  SET
                    queue_status = 'idle',
                    current_room_id = NULL,
                    current_partner_id = NULL,
                    last_active_at = v_now
                  WHERE event_id = COALESCE(v_after.event_id, v_session.event_id)
                    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                    AND current_room_id = p_session_id;
                EXCEPTION WHEN OTHERS THEN
                  GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                  BEGIN
                    PERFORM public.video_date_lifecycle_observe_exception_v2(
                      p_session_id, v_actor,
                      'video_session_mark_ready_v2.expired_registration_cleanup',
                      SQLSTATE, v_message, NULL, NULL);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                  v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                    'kind', 'expired_registration_cleanup'
                  ));
                END;

                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', 'expired',
                  'ready_gate_status', 'expired',
                  'result_status', 'expired',
                  'result_ready_gate_status', 'expired',
                  'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
                  'reason', 'ready_gate_expired',
                  'error_code', 'ready_gate_expired',
                  'terminal', true,
                  'auxiliary_errors', v_auxiliary_errors,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSE
                v_new_p1_ready_at := v_session.ready_participant_1_at;
                v_new_p2_ready_at := v_session.ready_participant_2_at;

                IF v_is_p1 THEN
                  v_new_p1_ready_at := COALESCE(v_new_p1_ready_at, v_now);
                ELSE
                  v_new_p2_ready_at := COALESCE(v_new_p2_ready_at, v_now);
                END IF;

                IF v_new_p1_ready_at IS NOT NULL AND v_new_p2_ready_at IS NOT NULL THEN
                  v_new_status := 'both_ready';
                ELSIF v_is_p1 THEN
                  v_new_status := 'ready_a';
                ELSE
                  v_new_status := 'ready_b';
                END IF;

                v_expires_at := GREATEST(
                  COALESCE(v_session.ready_gate_expires_at, v_now),
                  v_now + interval '45 seconds'
                );

                IF v_new_status = 'both_ready' THEN
                  v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');
                  IF v_domain IS NULL AND v_session.daily_room_url IS NOT NULL THEN
                    v_domain := substring(v_session.daily_room_url from '^https?://([^/]+)/');
                  END IF;
                  IF v_domain IS NULL THEN
                    SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
                    INTO v_domain
                    FROM public.video_sessions vs
                    WHERE vs.daily_room_url LIKE 'http%://%/date-%'
                    ORDER BY vs.state_updated_at DESC NULLS LAST
                    LIMIT 1;
                  END IF;
                  v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
                  v_url := 'https://' || v_domain || '/' || v_expected_room_name;
                END IF;

                UPDATE public.video_sessions
                SET
                  ready_participant_1_at = v_new_p1_ready_at,
                  ready_participant_2_at = v_new_p2_ready_at,
                  ready_gate_status = v_new_status,
                  ready_gate_expires_at = v_expires_at,
                  daily_room_name = CASE
                    WHEN v_new_status = 'both_ready' THEN v_expected_room_name
                    ELSE daily_room_name
                  END,
                  daily_room_url = CASE
                    WHEN v_new_status = 'both_ready' THEN v_url
                    ELSE daily_room_url
                  END,
                  daily_room_provider_verify_reason = CASE
                    WHEN v_new_status = 'both_ready'
                      THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_mark_ready_decisive_commit')
                    ELSE daily_room_provider_verify_reason
                  END,
                  state = 'ready_gate'::public.video_date_state,
                  phase = 'ready_gate',
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND state = 'ready_gate'::public.video_date_state
                  AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
                  AND handshake_started_at IS NULL
                  AND date_started_at IS NULL
                  AND participant_1_joined_at IS NULL
                  AND participant_2_joined_at IS NULL
                RETURNING * INTO v_after;

                GET DIAGNOSTICS v_row_count = ROW_COUNT;

                IF v_row_count = 0 THEN
                  SELECT *
                  INTO v_after
                  FROM public.video_sessions
                  WHERE id = p_session_id;

                  v_result := jsonb_build_object(
                    'ok', false,
                    'success', false,
                    'error', 'guarded_update_zero_rows',
                    'reason', 'guarded_update_zero_rows',
                    'status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'retryable', true,
                    'retry_after_ms', 1000,
                    'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
                    'commandStatus', 'rejected',
                    'commandId', v_command_id,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                  BEGIN
                    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                ELSE
                  v_result := jsonb_build_object(
                    'ok', true,
                    'success', true,
                    'commandStatus', 'committed',
                    'commandId', v_command_id,
                    'requestHash', v_request_hash,
                    'status', v_after.ready_gate_status,
                    'ready_gate_status', v_after.ready_gate_status,
                    'result_status', v_after.ready_gate_status,
                    'result_ready_gate_status', v_after.ready_gate_status,
                    'event_id', v_after.event_id,
                    'participant_1_id', v_after.participant_1_id,
                    'participant_2_id', v_after.participant_2_id,
                    'ready_participant_1_at', v_after.ready_participant_1_at,
                    'ready_participant_2_at', v_after.ready_participant_2_at,
                    'ready_gate_expires_at', v_after.ready_gate_expires_at,
                    'snoozed_by', v_after.snoozed_by,
                    'snooze_expires_at', v_after.snooze_expires_at,
                    'daily_room_name', v_after.daily_room_name,
                    'daily_room_url', v_after.daily_room_url,
                    'daily_room_verified_at', v_after.daily_room_verified_at,
                    'daily_room_expires_at', v_after.daily_room_expires_at,
                    'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
                    'session_seq', v_after.session_seq,
                    'terminal', v_after.ready_gate_status = 'both_ready',
                    'provider_outbox_degraded', false,
                    'retryable_command_reopened', v_reopened_retryable_command,
                    'reclaimed_processing_command', v_reclaimed_processing_command,
                    'hot_path', true,
                    'decisive_mark_ready_commit', true,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );

                  BEGIN
                    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                  EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.command_finish',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_result := v_result || jsonb_build_object(
                      'command_finish_degraded', true
                    );
                  END;

                  BEGIN
                    PERFORM public.record_event_loop_observability(
                      'ready_gate_transition',
                      'success',
                      'mark_ready',
                      NULL,
                      v_after.event_id,
                      v_actor,
                      p_session_id,
                      jsonb_build_object(
                        'action', 'mark_ready',
                        'hot_path', true,
                        'decisive_mark_ready_commit', true,
                        'status_before', v_session.ready_gate_status,
                        'status_after', v_after.ready_gate_status,
                        'ready_participant_1_at_before', v_session.ready_participant_1_at,
                        'ready_participant_1_at_after', v_after.ready_participant_1_at,
                        'ready_participant_2_at_before', v_session.ready_participant_2_at,
                        'ready_participant_2_at_after', v_after.ready_participant_2_at,
                        'ready_gate_expires_at_before', v_session.ready_gate_expires_at,
                        'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
                        'daily_room_name', v_after.daily_room_name,
                        'retryable_command_reopened', v_reopened_retryable_command,
                        'reclaimed_processing_command', v_reclaimed_processing_command
                      )
                    );
                  EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.observability',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                      'kind', 'observability'
                    ));
                  END;

                  BEGIN
                    PERFORM public.append_video_session_event_v2(
                      p_session_id,
                      CASE WHEN v_after.ready_gate_status = 'both_ready' THEN 'ready_gate_both_ready' ELSE 'ready_gate_mark_ready' END,
                      'participants',
                      v_actor,
                      jsonb_build_object(
                        'action', 'mark_ready',
                        'ready_gate_status', v_after.ready_gate_status,
                        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END,
                        'hot_path', true,
                        'decisive_mark_ready_commit', true
                      ),
                      jsonb_build_object(
                        'ready_gate_status', v_after.ready_gate_status,
                        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END
                      ),
                      true,
                      gen_random_uuid()
                    );
                  EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.event_append',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                      'kind', 'event_append'
                    ));
                  END;

                  IF v_after.ready_gate_status = 'both_ready' THEN
                    BEGIN
                      PERFORM public.video_date_outbox_enqueue_v2(
                        p_session_id,
                        'daily.ensure_video_date_room',
                        jsonb_build_object(
                          'roomName', COALESCE(NULLIF(v_after.daily_room_name, ''), v_expected_room_name),
                          'source', 'video_session_mark_ready_v2_decisive_commit'
                        ),
                        'phase3:ensure_room:' || p_session_id::text,
                        now()
                      );
                    EXCEPTION WHEN OTHERS THEN
                      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                      BEGIN
                        PERFORM public.video_date_lifecycle_observe_exception_v2(
                          p_session_id, v_actor,
                          'video_session_mark_ready_v2.daily_room_outbox',
                          SQLSTATE, v_message, NULL, NULL);
                      EXCEPTION WHEN OTHERS THEN
                        NULL;
                      END;
                      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                        'kind', 'daily_room_outbox'
                      ));
                    END;
                  END IF;

                  v_result := v_result || jsonb_build_object(
                    'session_seq', v_after.session_seq,
                    'auxiliary_errors', v_auxiliary_errors,
                    'provider_outbox_degraded', jsonb_array_length(v_auxiliary_errors) > 0
                  );
                END IF;
              END IF;
            END IF;
          END IF;
        END IF;
      EXCEPTION
        WHEN query_canceled OR lock_not_available THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2.decisive_core_timeout',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;

          BEGIN
            SELECT *
            INTO v_after
            FROM public.video_sessions
            WHERE id = p_session_id;
          EXCEPTION WHEN OTHERS THEN
            v_after := NULL;
          END;

          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'mark_ready_timeout',
            'reason', 'mark_ready_timeout',
            'code', 'READY_GATE_TRANSITION_TIMEOUT',
            'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
            'retryable', true,
            'retry_after_seconds', 1,
            'retry_after_ms', 1000,
            'status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
            'commandStatus', 'rejected',
            'commandId', v_command_id,
            'requestHash', v_request_hash,
            'hot_path', true,
            'decisive_mark_ready_commit', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );

          IF v_command_id IS NOT NULL THEN
            BEGIN
              PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END;
          END IF;
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2.decisive_core',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;

          BEGIN
            SELECT *
            INTO v_after
            FROM public.video_sessions
            WHERE id = p_session_id;
          EXCEPTION WHEN OTHERS THEN
            v_after := NULL;
          END;

          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'mark_ready_failed',
            'reason', 'mark_ready_failed',
            'code', 'MARK_READY_FAILED',
            'error_code', 'MARK_READY_FAILED',
            'retryable', true,
            'retry_after_seconds', 1,
            'retry_after_ms', 1000,
            'status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
            'commandStatus', 'rejected',
            'commandId', v_command_id,
            'requestHash', v_request_hash,
            'hot_path', true,
            'decisive_mark_ready_commit', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );

          IF v_command_id IS NOT NULL THEN
            BEGIN
              PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END;
          END IF;
      END;

      -- ── Both-ready entry protection (former review_comments post): runs on
      -- the un-enriched core result. ──
      v_success := COALESCE(
        NULLIF(v_result ->> 'success', '')::boolean,
        NULLIF(v_result ->> 'ok', '')::boolean,
        false
      );
      v_status := COALESCE(
        NULLIF(v_result ->> 'ready_gate_status', ''),
        NULLIF(v_result ->> 'result_ready_gate_status', ''),
        NULLIF(v_result ->> 'status', '')
      );

      IF v_success AND v_status = 'both_ready' THEN
        v_protection := public.video_date_protect_both_ready_entry_v1(
          p_session_id,
          v_actor,
          NULL,
          'video_session_mark_ready_v2'
        );

        IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
          v_result := v_result || jsonb_build_object(
            'entry_protection', 'active',
            'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
            'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
            'daily_room_name', v_protection ->> 'daily_room_name',
            'daily_room_url', v_protection ->> 'daily_room_url',
            'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at'
          );
        ELSE
          v_result := v_result || jsonb_build_object(
            'entry_protection', 'failed',
            'entry_protection_code', v_protection ->> 'code'
          );
        END IF;
      END IF;

      -- ── First-ready partner notification (former terminal_truth post). ──
      v_event_id := NULLIF(v_result ->> 'event_id', '')::uuid;
      v_p1 := NULLIF(v_result ->> 'participant_1_id', '')::uuid;
      v_p2 := NULLIF(v_result ->> 'participant_2_id', '')::uuid;
      v_partner_id := CASE
        WHEN v_actor IS NOT NULL AND v_actor = v_p1 THEN v_p2
        WHEN v_actor IS NOT NULL AND v_actor = v_p2 THEN v_p1
        ELSE NULL
      END;

      IF v_success
         AND v_status IN ('ready_a', 'ready_b')
         AND v_partner_id IS NOT NULL THEN
        BEGIN
          PERFORM public.video_date_outbox_enqueue_v2(
            p_session_id,
            'notification.send',
            jsonb_build_object(
              'user_id', v_partner_id,
              'recipient_id', v_partner_id,
              'match_user_id', v_actor,
              'category', 'partner_ready',
              'title', 'Your match is ready!',
              'body', 'Tap to start your video date',
              'data', jsonb_build_object(
                'session_id', p_session_id,
                'event_id', v_event_id,
                'ready_gate_status', v_status,
                'actor_id', v_actor,
                'source', 'video_session_mark_ready_v2_first_ready'
              ),
              'dedupe_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
              'provider_idempotency_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
              'source', 'video_session_mark_ready_v2',
              'event_id', v_event_id,
              'session_id', p_session_id,
              'actor_id', v_actor
            ),
            'notification:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
            now()
          );
        EXCEPTION
          WHEN OTHERS THEN
            v_notification_degraded := true;
        END;
      END IF;

      v_result := v_result || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'partner_ready_notification_degraded', v_notification_degraded
      );
    END IF;

    -- ── Enrichment (former both_ready_owner post): applies to every outcome,
    -- including precheck rejections. ──
    BEGIN
      v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'video_session_mark_ready_v2',
        v_result
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_result := COALESCE(v_result, '{}'::jsonb)
          - 'message'
          - 'detail'
          - 'hint'
          || jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'error', 'mark_ready_enrichment_failed',
            'reason', 'mark_ready_enrichment_failed',
            'code', 'MARK_READY_ENRICHMENT_FAILED',
            'error_code', 'MARK_READY_ENRICHMENT_FAILED',
            'retryable', true
          );
    END;

    -- ── Both-ready route owner (former active_entry post): safety-payload
    -- hygiene, date_starting notifications, route payload, shell markers. ──
    v_clean_result := COALESCE(v_result, '{}'::jsonb);
    IF COALESCE(v_clean_result ->> 'code', v_clean_result ->> 'error_code') = 'SAFETY_CHECK_UNAVAILABLE' THEN
      v_clean_result := v_clean_result
        - 'sqlstate'
        - 'message'
        - 'detail'
        - 'hint'
        - 'context'
        - 'auxiliary_errors';
    END IF;

    v_success := lower(COALESCE(v_clean_result ->> 'success', v_clean_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes');
    v_status := COALESCE(
      NULLIF(v_clean_result ->> 'ready_gate_status', ''),
      NULLIF(v_clean_result ->> 'result_ready_gate_status', ''),
      NULLIF(v_clean_result ->> 'status', '')
    );

    IF v_success AND v_status = 'both_ready' THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND THEN
        v_path := '/date/' || p_session_id::text;
        FOREACH v_recipient IN ARRAY ARRAY[v_session.participant_1_id, v_session.participant_2_id]
        LOOP
          BEGIN
            v_enqueue_result := public.video_date_outbox_enqueue_v2(
              p_session_id,
              'notification.send',
              jsonb_build_object(
                'user_id', v_recipient,
                'recipient_id', v_recipient,
                'match_user_id', CASE
                  WHEN v_recipient = v_session.participant_1_id THEN v_session.participant_2_id
                  ELSE v_session.participant_1_id
                END,
                'category', 'date_starting',
                'title', 'Your video date is starting',
                'body', 'Tap to join your video date',
                'data', jsonb_build_object(
                  'session_id', p_session_id,
                  'event_id', v_session.event_id,
                  'ready_gate_status', v_status,
                  'actor_id', v_actor,
                  'url', v_path,
                  'deep_link', v_path,
                  'source', 'video_session_mark_ready_v2_both_ready'
                ),
                'dedupe_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
                'provider_idempotency_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
                'source', 'video_session_mark_ready_v2',
                'event_id', v_session.event_id,
                'session_id', p_session_id,
                'actor_id', v_actor
              ),
              'notification:date_starting:' || p_session_id::text || ':' || v_recipient::text,
              now()
            );

            IF lower(COALESCE(v_enqueue_result ->> 'ok', v_enqueue_result ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
              v_date_starting_degraded := true;
            END IF;
          EXCEPTION
            WHEN OTHERS THEN
              v_date_starting_degraded := true;
          END;
        END LOOP;
      END IF;
    END IF;

    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      v_clean_result || jsonb_build_object(
        'date_starting_notification_degraded', v_date_starting_degraded,
        'both_ready_route_owner_checked', true
      ),
      'video_session_mark_ready_v2.both_ready_owner'
    ) || jsonb_build_object(
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
          'video_session_mark_ready_v2.hot_path_shell',
          'mark_ready_unavailable',
          'MARK_READY_UNAVAILABLE',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'commandStatus', 'rejected'
        );
      EXCEPTION
        WHEN OTHERS THEN
          BEGIN
            RETURN public.video_date_direct_json_fallback_v1(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2',
              'mark_ready_wrapper_failed',
              'MARK_READY_WRAPPER_FAILED',
              true,
              SQLSTATE
            ) || jsonb_build_object(
              'hot_path_no_throw_shell', true,
              'active_entry_failsoft_shell', true,
              'commandStatus', 'rejected'
            );
          EXCEPTION
            WHEN OTHERS THEN
              RETURN jsonb_build_object(
                'ok', false,
                'success', false,
                'session_id', p_session_id,
                'rpc', 'video_session_mark_ready_v2',
                'error', 'mark_ready_unavailable',
                'reason', 'mark_ready_unavailable',
                'code', 'MARK_READY_UNAVAILABLE',
                'error_code', 'MARK_READY_UNAVAILABLE',
                'retryable', true,
                'terminal', false,
                'commandStatus', 'rejected',
                'hot_path_no_throw_shell', true,
                'active_entry_failsoft_shell', true,
                'last_resort_payload', true,
                'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
              );
          END;
      END;
  END;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_session_mark_ready_v2',
      'error', 'mark_ready_unavailable',
      'reason', 'mark_ready_unavailable',
      'code', 'MARK_READY_UNAVAILABLE',
      'error_code', 'MARK_READY_UNAVAILABLE',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Single-body decisive mark-ready owner (rebuild PR 4). Actionability precheck (locked owner-eligibility + participant eligibility + safety + registration, invalid gates terminalize), event-inactive sweep, idempotent command core (replay/reclaim, expiry under lock, decisive commit with 45s both-ready grace + deterministic date-<id> room stamping + ensure-room outbox), both-ready entry protection, partner_ready/date_starting notifications, enrichment, both-ready route payload, hot-path no-throw shell.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Drop the historical Ready Gate family generations (no remaining callers).
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.ready_gate_transition_20260603150106_start_snapshot_base(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260602231752_57014_base(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260524120000_clock_base(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260505214500_result_status_base(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text);
DROP FUNCTION public.rgt_preserve_warmup_base_v1(uuid, text, text);
DROP FUNCTION public.rgt_pre_ready_room_meta_base_v1(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260501200000_event_inactive_base(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260501190000_expiry_rowcount_prior(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260501170000_both_ready_grace_base(uuid, text, text);
DROP FUNCTION public.ready_gate_transition_20260501135000_observability_base(uuid, text, text);

DROP FUNCTION public.vd_mark_ready_20260609130139_hot_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260609105249_active_entry_base(uuid, text, text);
DROP FUNCTION public.vd_mark_ready_both_ready_owner_base(uuid, text, text);
DROP FUNCTION public.vd_mark_ready_terminal_truth_base(uuid, text, text);
DROP FUNCTION public.vd_mark_ready_partial_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260608114500_review_comments_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260607123952_routeable_entry_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260606212727_event_cleanup_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260604131708_event_active_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260604104154_grace_base(uuid, text, text);
DROP FUNCTION public.video_session_mark_ready_v2_20260603150106_start_snapshot_base(uuid, text, text);

DROP FUNCTION public.vd_ready_gate_actionability_owner_eligibility_base(uuid, uuid, text, boolean, boolean, boolean, boolean);

NOTIFY pgrst, 'reload schema';

COMMIT;
