-- Event Lobby Deck audit closure.
--
-- Scope:
-- - Mystery Match now uses the same canonical candidate eligibility contract as
--   Event Deck visible-card and swipe authority.
-- - get_event_deck_v3 keeps empty-state reasons granular enough for web/native UX.
-- - Reservation cleanup is available as a service-only bounded task and is
--   scheduled when pg_cron is installed.

CREATE INDEX IF NOT EXISTS idx_event_deck_card_reservations_expires_cleanup
  ON public.event_deck_card_reservations(expires_at);

CREATE OR REPLACE FUNCTION public.cleanup_event_deck_card_reservations(
  p_older_than interval DEFAULT interval '1 day',
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_older_than interval := COALESCE(p_older_than, interval '1 day');
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 5000), 50000));
  v_deleted integer := 0;
BEGIN
  IF v_older_than < interval '5 minutes' THEN
    v_older_than := interval '5 minutes';
  END IF;

  WITH expired AS (
    SELECT r.ctid
    FROM public.event_deck_card_reservations r
    WHERE r.expires_at < now() - v_older_than
    ORDER BY r.expires_at
    LIMIT v_limit
  ),
  deleted AS (
    DELETE FROM public.event_deck_card_reservations r
    USING expired e
    WHERE r.ctid = e.ctid
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_deleted
  FROM deleted;

  RETURN COALESCE(v_deleted, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_event_deck_card_reservations(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_event_deck_card_reservations(interval, integer)
  TO service_role;

COMMENT ON FUNCTION public.cleanup_event_deck_card_reservations(interval, integer) IS
  'Service-only bounded cleanup for expired Event Lobby Deck reservation rows. Keeps token fallback rows long enough for visible/swipe continuity, then removes old clutter.';

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND to_regclass('cron.job') IS NOT NULL THEN
    SELECT jobid
    INTO v_job_id
    FROM cron.job
    WHERE jobname = 'cleanup-event-deck-card-reservations-hourly'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'cleanup-event-deck-card-reservations-hourly',
      '17 * * * *',
      $sql$SELECT public.cleanup_event_deck_card_reservations(interval '1 day', 50000);$sql$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'event deck reservation cleanup cron not scheduled: %', SQLERRM;
END;
$cron$;

CREATE OR REPLACE FUNCTION public.find_mystery_match_20260501180000_active_base(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer_reg record;
  v_partner_id uuid;
  v_session_id uuid;
  v_validation jsonb;
  v_locked_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_hidden');
  END IF;

  SELECT er.admission_status, er.queue_status
  INTO v_viewer_reg
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_user_id;

  IF NOT FOUND OR COALESCE(v_viewer_reg.admission_status, '') <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_registered');
  END IF;

  IF COALESCE(v_viewer_reg.queue_status, 'idle') NOT IN ('browsing', 'idle') THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'error', 'viewer_unavailable',
      'reason', 'viewer_unavailable'
    );
  END IF;

  SELECT er.profile_id
  INTO v_partner_id
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND COALESCE(er.admission_status, '') = 'confirmed'
    AND COALESCE(er.queue_status, 'idle') = 'browsing'
    AND er.profile_id <> p_user_id
    AND COALESCE((public.event_deck_candidate_eligibility(
      p_event_id,
      p_user_id,
      er.profile_id,
      true,
      true
    )->>'ok')::boolean, false)
  ORDER BY random()
  LIMIT 1
  FOR UPDATE OF er SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'no_candidates'
    );
  END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_user_id, v_partner_id)::text,
      0
    )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'lock_busy',
      'lock_scope', 'participant_session_low'
    );
  END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_user_id, v_partner_id)::text,
      0
    )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'lock_busy',
      'lock_scope', 'participant_session_high'
    );
  END IF;

  BEGIN
    PERFORM 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id IN (p_user_id, v_partner_id)
    ORDER BY er.profile_id
    FOR UPDATE NOWAIT;

    GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'lock_busy',
      'lock_scope', 'event_registrations'
    );
  END;

  IF v_locked_count <> 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'registration_changed'
    );
  END IF;

  v_validation := public.event_deck_candidate_eligibility(
    p_event_id,
    p_user_id,
    v_partner_id,
    true,
    true
  );

  IF COALESCE((v_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', COALESCE(v_validation->>'reason', 'candidate_ineligible')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND COALESCE(er.admission_status, '') = 'confirmed'
      AND COALESCE(er.queue_status, 'idle') IN ('browsing', 'idle')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'error', 'viewer_unavailable',
      'reason', 'viewer_unavailable'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = v_partner_id
      AND COALESCE(er.admission_status, '') = 'confirmed'
      AND COALESCE(er.queue_status, 'idle') = 'browsing'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'target_unavailable'
    );
  END IF;

  INSERT INTO public.video_sessions (
    event_id,
    participant_1_id,
    participant_2_id,
    ready_gate_status,
    ready_gate_expires_at,
    queued_expires_at
  ) VALUES (
    p_event_id,
    LEAST(p_user_id, v_partner_id),
    GREATEST(p_user_id, v_partner_id),
    'ready',
    now() + interval '30 seconds',
    NULL
  )
  ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
  RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'no_candidates', true,
      'reason', 'pair_already_in_session'
    );
  END IF;

  UPDATE public.event_registrations
  SET queue_status = 'in_ready_gate',
      current_room_id = v_session_id,
      current_partner_id = CASE WHEN profile_id = p_user_id THEN v_partner_id ELSE p_user_id END,
      last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (p_user_id, v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'partner_id', v_partner_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid) IS
  'Internal Mystery Match fallback candidate picker. Uses canonical Event Deck eligibility, participant-session locks, and idempotent session creation.';

CREATE OR REPLACE FUNCTION public.find_mystery_match_20260502083000_active_base(
  p_event_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_active record;
  v_inactive_reason text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_hidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND COALESCE(er.admission_status, '') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_registered');
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'success', false,
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'terminal', true
    );
  END IF;

  RETURN public.find_mystery_match_20260501180000_active_base(
    p_event_id,
    p_user_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260502083000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mystery_match_20260502083000_active_base(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.find_mystery_match_20260502083000_active_base(uuid, uuid) IS
  'Scheduled-active Mystery Match compatibility delegate. Preserves the current public RPC chain while routing candidate selection to canonical deck eligibility.';

CREATE OR REPLACE FUNCTION public.get_event_deck_v3(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 50));
  v_scan_limit integer := 5000;
  v_active record;
  v_profiles jsonb := '[]'::jsonb;
  v_confirmed_candidate_count integer := 0;
  v_eligible_unswiped_count integer := 0;
  v_raw_count integer := 0;
  v_eligible_count integer := 0;
  v_profile_count integer := 0;
  v_marked_count integer := 0;
  v_reason text := 'unknown';
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'event_not_active',
        'inactive_reason', COALESCE(v_active.reason, 'event_not_active'),
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND COALESCE(er.admission_status, '') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'not_registered',
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'viewer_paused',
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  SELECT count(*)::integer
  INTO v_confirmed_candidate_count
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id <> p_user_id
    AND COALESCE(er.admission_status, '') = 'confirmed';

  PERFORM public.cleanup_event_deck_card_reservations(interval '1 day', 5000);

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_date_deck_v3:' || p_event_id::text || ':' || p_user_id::text, 0)
  );

  WITH raw_deck AS (
    SELECT gd.*, gd.ordinality::integer AS base_rn
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit) WITH ORDINALITY AS gd
  ),
  raw_count AS (
    SELECT count(*)::integer AS n FROM raw_deck
  ),
  eligible_raw AS (
    SELECT rd.*
    FROM raw_deck rd
    CROSS JOIN LATERAL (
      SELECT public.event_deck_candidate_eligibility(
        p_event_id,
        p_user_id,
        rd.profile_id,
        true,
        true
      ) AS value
    ) eligibility
    WHERE COALESCE((eligibility.value->>'ok')::boolean, false)
  ),
  eligible_count AS (
    SELECT count(*)::integer AS n FROM eligible_raw
  ),
  filtered AS (
    SELECT
      erd.*,
      epi.strongest_exclusion_reason AS impression_reason,
      epi.prefetch_expires_at AS impression_prefetch_expires_at
    FROM eligible_raw erd
    LEFT JOIN public.event_profile_impressions epi
      ON epi.event_id = p_event_id
      AND epi.viewer_id = p_user_id
      AND epi.target_id = erd.profile_id
    WHERE epi.target_id IS NULL
      OR public.video_date_impression_rank(epi.strongest_exclusion_reason)
          < public.video_date_impression_rank('dealt')
  ),
  ranked AS (
    SELECT *
    FROM (
      SELECT
        filtered.*,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN filtered.impression_prefetch_expires_at IS NULL
                   OR filtered.impression_prefetch_expires_at <= now()
                THEN 0
              ELSE 1
            END,
            filtered.base_rn
        ) AS rn
      FROM filtered
    ) ordered
    ORDER BY rn
    LIMIT v_limit
  ),
  reservations AS (
    INSERT INTO public.event_deck_card_reservations (
      event_id,
      viewer_id,
      target_id,
      deck_token,
      deck_rank,
      expires_at,
      source,
      metadata
    )
    SELECT
      p_event_id,
      p_user_id,
      ranked.profile_id,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      ranked.rn::integer,
      now() + interval '2 minutes',
      'get_event_deck_v3',
      jsonb_build_object('deck_version', 'v3', 'server_prefetched', true)
    FROM ranked
    RETURNING target_id, deck_token, deck_rank, expires_at
  ),
  mark_buffer AS (
    SELECT public.record_event_profile_impression_v2(
      p_event_id,
      p_user_id,
      ranked.profile_id,
      'prefetched',
      'get_event_deck_v3_buffer',
      NULL,
      jsonb_build_object(
        'server_prefetched', true,
        'prefetch_ttl_seconds', 120,
        'deck_rank', ranked.rn,
        'deck_version', 'v3',
        'reservation_issued', true
      )
    ) AS result
    FROM ranked
    JOIN reservations r ON r.target_id = ranked.profile_id
  )
  SELECT
    COALESCE(
      jsonb_agg(
        (
          to_jsonb(ranked)
            - 'rn'
            - 'base_rn'
            - 'ordinality'
            - 'impression_reason'
            - 'impression_prefetch_expires_at'
        ) || jsonb_build_object(
          'deck_token', reservations.deck_token,
          'deck_rank', ranked.rn
        )
        ORDER BY ranked.rn
      ),
      '[]'::jsonb
    ),
    COALESCE((SELECT n FROM raw_count), 0),
    COALESCE((SELECT n FROM eligible_count), 0),
    count(ranked.profile_id)::integer,
    COALESCE((
      SELECT count(*)::integer
      FROM mark_buffer
      WHERE COALESCE((result->>'ok')::boolean, false)
    ), 0)
  INTO v_profiles, v_raw_count, v_eligible_count, v_profile_count, v_marked_count
  FROM ranked
  JOIN reservations ON reservations.target_id = ranked.profile_id;

  IF v_profile_count = 0 AND v_confirmed_candidate_count > 0 THEN
    SELECT count(*)::integer
    INTO v_eligible_unswiped_count
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id <> p_user_id
      AND COALESCE(er.admission_status, '') = 'confirmed'
      AND COALESCE((public.event_deck_candidate_eligibility(
        p_event_id,
        p_user_id,
        er.profile_id,
        true,
        false
      )->>'ok')::boolean, false);
  END IF;

  v_reason := CASE
    WHEN v_profile_count > 0 THEN 'has_profiles'
    WHEN v_eligible_count > 0 THEN 'no_remaining_profiles'
    WHEN v_raw_count > 0 THEN 'scan_window_exhausted'
    WHEN v_eligible_unswiped_count > 0 THEN 'no_remaining_profiles'
    WHEN v_confirmed_candidate_count = 0 THEN 'no_confirmed_candidates'
    ELSE 'scan_window_exhausted'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profiles', v_profiles,
    'deck_state', jsonb_build_object(
      'reason', v_reason,
      'retryable', false,
      'limit', v_limit,
      'scan_limit', v_scan_limit,
      'confirmed_candidate_count', v_confirmed_candidate_count,
      'raw_count', v_raw_count,
      'eligible_count', v_eligible_count,
      'eligible_unswiped_count', v_eligible_unswiped_count,
      'profile_count', v_profile_count,
      'marked_count', v_marked_count,
      'mark_action', 'prefetched',
      'prefetch_ttl_seconds', 120,
      'reservation_ttl_seconds', 120
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns granular deck_state, soft-prefetches buffered cards, filters through canonical eligibility, and issues short-lived card reservations for visible/swipe authority.';
