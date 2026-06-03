-- Video Date — both_ready canonical room metadata: deterministic domain fallback.
--
-- SUPERSEDES migration 20260603190000_video_date_both_ready_room_metadata_rederive.sql.
-- That migration re-derived the canonical Daily room name/url at `both_ready`, but
-- resolved the URL domain from (a) the `app.daily_domain` GUC, (b) a host recovered
-- from existing rows, and otherwise gave up (a `both_ready_room_metadata_rederive_no_domain`
-- degraded path). Setting `app.daily_domain` is impossible on managed Supabase — the
-- SQL Editor / `postgres` role cannot run `ALTER DATABASE ... SET app.*`
-- (`ERROR: 42501: permission denied to set parameter "app.daily_domain"`), because
-- `postgres` is not a true superuser. On a cold table with no recoverable URL, the
-- prior version therefore left daily_room_name/url NULL and the bug persisted.
--
-- 20260603190000 is already applied to the remote project, and Supabase will not
-- re-run an applied version, so this fix ships as a new CREATE OR REPLACE.
--
-- ROOT CAUSE recap (prod session de4b1dc4-…, 2026-06-03): the pre-ready repair
-- (`rgt_preserve_warmup_base_v1`) NULLs daily_room_name/url on every pre-ready
-- `mark_ready`; the both-ready restore only re-persisted when the row captured
-- *before this call* (`v_before`) still held a fresh canonical room — which fails in
-- the normal SPLIT-ready flow (two separate mark_ready calls; the first already
-- nulled it). NULL name/url → canAttemptDaily=false → canonical route `ready_gate`
-- not `date` → SessionRouteHydration bounces /date→lobby → ReadyGateOverlay remounts,
-- idempotency resets, both_ready re-fires → entry remount storm → only one side
-- renders → bilateral remote-seen never both-stamps → handshake_timeout, date never
-- starts.
--
-- FIX: at `both_ready`, RE-DERIVE the canonical identifiers and ALWAYS resolve a
-- domain so the fill is cold-table safe with ZERO manual config. Resolution order:
--   1. `app.daily_domain` GUC, IF set (optional; read-only current_setting(...,true)
--      is safe even when unset — no ALTER DATABASE is performed here),
--   2. host recovered from `v_before.daily_room_url`,
--   3. host recovered from the most recent canonical video_sessions.daily_room_url,
--   4. final deterministic hard fallback: 'vibelyapp.daily.co'
--      (= DAILY_ROOM_DOMAIN_FALLBACK in supabase/functions/daily-room/
--      dailyRoomContracts.ts; asserted across the CSP contract tests). Locked,
--      non-secret production Daily domain — not a new assumption.
-- URL shape mirrors videoDateRoomUrlForName(): https://<domain>/<date-<id>>.
-- When a fresh warmup verification proof survived (`v_can_restore`), verified_at/
-- expires are preserved (provider verify can be skipped); otherwise only name/url
-- are filled and prepare-entry re-verifies (safe — the route only needs name+url
-- present to resolve to `date`).
--
-- Idempotent + non-destructive: only fills when name OR url is currently NULL, only
-- in the pre-join ready_gate/both_ready window, never on ended sessions. Touches no
-- other function/table/route/grant. Introduces NO config, secret, config table, or
-- Vault dependency, and runs NO ALTER DATABASE/ALTER ROLE/GRANT ... ON PARAMETER.

BEGIN;

CREATE OR REPLACE FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  v_before public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_status text;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_can_restore boolean := false;
  v_restored public.video_sessions%ROWTYPE;
  v_domain text;
  v_url text;
BEGIN
  IF v_actor IS NOT NULL AND p_action = 'mark_ready' THEN
    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id;

    -- Fresh after-ready warmup proof survived into this call: preserve verified_at
    -- / expires so provider verify can be skipped (pure optimization path).
    v_can_restore := FOUND
      AND (v_before.participant_1_id = v_actor OR v_before.participant_2_id = v_actor)
      AND v_before.ended_at IS NULL
      AND v_before.state = 'ready_gate'::public.video_date_state
      AND v_before.ready_gate_status IN ('ready_a', 'ready_b')
      AND (v_before.ready_participant_1_at IS NOT NULL OR v_before.ready_participant_2_at IS NOT NULL)
      AND v_before.handshake_started_at IS NULL
      AND v_before.date_started_at IS NULL
      AND v_before.participant_1_joined_at IS NULL
      AND v_before.participant_2_joined_at IS NULL
      AND v_before.daily_room_name = v_expected_room_name
      AND v_before.daily_room_url IS NOT NULL
      AND v_before.daily_room_url LIKE ('%/' || v_expected_room_name)
      AND v_before.daily_room_verified_at IS NOT NULL
      AND v_before.daily_room_verified_at >= v_now - interval '90 seconds'
      AND v_before.daily_room_expires_at IS NOT NULL
      AND v_before.daily_room_expires_at > v_now + interval '60 seconds';
  END IF;

  v_result := public.rgt_preserve_warmup_base_v1(
    p_session_id,
    p_action,
    p_reason
  );

  v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status');

  IF COALESCE((v_result->>'success')::boolean, false)
     AND v_status = 'both_ready' THEN

    -- Resolve the canonical Daily domain (deterministic room name `date-<id>`):
    --   GUC (optional) → v_before host → most recent canonical host → hard fallback.
    -- A domain is ALWAYS resolved, so the fix is cold-table safe with no config.
    v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');

    IF v_domain IS NULL AND v_before.daily_room_url IS NOT NULL THEN
      v_domain := substring(v_before.daily_room_url from '^https?://([^/]+)/');
    END IF;

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
        daily_room_verified_at = CASE
          WHEN v_can_restore THEN v_before.daily_room_verified_at
          ELSE daily_room_verified_at
        END,
        daily_room_expires_at = CASE
          WHEN v_can_restore THEN v_before.daily_room_expires_at
          ELSE daily_room_expires_at
        END,
        daily_room_provider_verify_reason = CASE
          WHEN v_can_restore THEN COALESCE(
            v_before.daily_room_provider_verify_reason,
            'ready_gate_after_ready_room_warmup'
          )
          ELSE COALESCE(
            daily_room_provider_verify_reason,
            'ready_gate_both_ready_canonical_rederive'
          )
        END,
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
          CASE WHEN v_can_restore
            THEN 'after_ready_room_metadata_preserved_for_both_ready'
            ELSE 'both_ready_canonical_room_metadata_rederived'
          END,
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
            'rederived', NOT v_can_restore,
            'provider_verify_skip_eligible', v_can_restore
          )
        );

        RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
          'daily_room_name', v_restored.daily_room_name,
          'daily_room_url', v_restored.daily_room_url,
          'daily_room_verified_at', v_restored.daily_room_verified_at,
          'daily_room_expires_at', v_restored.daily_room_expires_at,
          'daily_room_provider_verify_reason', v_restored.daily_room_provider_verify_reason
        );
      END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text) IS
  'Internal Ready Gate base. On both_ready, re-derives canonical Daily room name/url (deterministic date-<id> + domain resolved via optional app.daily_domain GUC, recovered host, or the locked vibelyapp.daily.co fallback) so split-ready flows never lose room metadata with zero manual config; preserves fresh warmup verification proof when present. Delegates to the short pre-ready repair base.';

COMMIT;
