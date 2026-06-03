-- Video Date — guarantee canonical Daily room metadata at `both_ready`.
--
-- ROOT CAUSE (prod session de4b1dc4-95c8-45dc-9a47-750724048efa, 2026-06-03):
-- The pre-ready repair (`rgt_preserve_warmup_base_v1`) NULLs
-- daily_room_name / daily_room_url on EVERY pre-ready `mark_ready`. The existing
-- both-ready restore in this function only re-persisted metadata when the row
-- captured *before this call* (`v_before`) still held a fresh canonical room.
-- In the normal SPLIT-ready flow (the two participants mark ready in two
-- separate RPC calls) the FIRST ready already nulled the metadata, so by the
-- time the SECOND call reaches `both_ready`, `v_before` is null →
-- `v_can_restore = false` → no restore → daily_room_name/url stay NULL.
--
-- Downstream blast radius of those NULLs:
--   canAttemptDaily() (videoDateRouteTruthHasProviderRoom requires name AND url)
--     → false → canonical route = `ready_gate`, not `date`
--     → SessionRouteHydration bounces /date → lobby in a loop
--     → ReadyGateOverlay remounts, per-mount idempotency resets, both_ready
--       re-fires → entry remount storm → neither side holds a stable mount
--     → only one side renders a remote frame → bilateral remote-seen never
--       both-stamps → handshake auto-promote never fires → handshake_timeout,
--       date_started_at NULL. The date never starts.
--
-- FIX (option B): on the `both_ready` transition, RE-DERIVE the canonical room
-- identifiers instead of depending on `v_before` still holding them. The room
-- name is deterministic (`date-<id>`); the URL base is recovered from, in order:
--   1. `app.daily_domain` GUC  (set this to match the DAILY_DOMAIN edge env —
--      see OPERATIONAL NOTE below; recommended for a bulletproof fix), else
--   2. the URL captured in `v_before` (covers the same-call case), else
--   3. the most recent canonical daily_room_url already in video_sessions.
-- When a fresh warmup verification proof survived (`v_can_restore`), we preserve
-- verified_at/expires so provider verify can still be skipped; otherwise we fill
-- only name/url and leave verified_at NULL so prepare-entry re-verifies (safe —
-- the route only needs name+url present to resolve to `date`).
--
-- Idempotent + non-destructive: only fills when name OR url is currently NULL,
-- only in the pre-join ready_gate/both_ready window, never on ended sessions.
-- Does NOT touch any other function, table, route, or grant.
--
-- OPERATIONAL NOTE (new OPTIONAL config — documented per rebuild discipline):
--   For the most reliable URL reconstruction, set a database GUC equal to the
--   edge `DAILY_DOMAIN` (e.g. `vibelyapp.daily.co`):
--     ALTER DATABASE postgres SET app.daily_domain = 'vibelyapp.daily.co';
--   The fix degrades gracefully without it (falls back to recovery from
--   existing rows), but the GUC removes any cold-start dependency.

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

    -- Re-derive the canonical URL base (deterministic name `date-<id>`):
    --   GUC → v_before URL → most recent canonical URL in the table.
    v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');

    IF v_domain IS NULL AND v_before.daily_room_url IS NOT NULL THEN
      v_domain := substring(v_before.daily_room_url from '^https?://([^/]+)/');
    END IF;

    IF v_domain IS NULL THEN
      SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
      INTO v_domain
      FROM public.video_sessions vs
      WHERE vs.daily_room_url IS NOT NULL
      ORDER BY vs.state_updated_at DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF v_domain IS NOT NULL THEN
      v_url := 'https://' || v_domain || '/' || v_expected_room_name;
    ELSIF v_before.daily_room_url IS NOT NULL
          AND v_before.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
      v_url := v_before.daily_room_url;
    END IF;

    IF v_url IS NOT NULL THEN
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
    ELSE
      -- Could not reconstruct a URL base (no GUC, no v_before URL, no prior row).
      -- Leave the row untouched; prepare-entry will still provision + persist.
      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        'degraded',
        'both_ready_room_metadata_rederive_no_domain',
        NULL,
        COALESCE(v_before.event_id, NULL),
        v_actor,
        p_session_id,
        jsonb_build_object('action', p_action, 'p_reason', p_reason)
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text) IS
  'Internal Ready Gate base. On both_ready, re-derives canonical Daily room name/url (deterministic date-<id> + recovered domain) so split-ready flows never lose room metadata; preserves fresh warmup verification proof when present. Delegates to the short pre-ready repair base.';

COMMIT;
