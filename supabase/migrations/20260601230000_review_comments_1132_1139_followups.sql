-- Review comments 1132-1139 follow-ups.
--
-- Preserve active Event Deck reservation buffers during top-up refetches so
-- still-rendered prefetched cards keep their token/order instead of being
-- displaced by fresh candidates before the user can act on them.

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
  v_reused_reservation_count integer := 0;
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
  latest_active_batch AS (
    SELECT r.issued_at
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
    GROUP BY r.issued_at
    ORDER BY r.issued_at DESC
    LIMIT 1
  ),
  latest_active_reservations AS (
    SELECT
      r.id,
      r.target_id,
      r.deck_token,
      r.deck_rank,
      r.expires_at,
      r.issued_at
    FROM public.event_deck_card_reservations r
    JOIN latest_active_batch b ON b.issued_at = r.issued_at
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
  ),
  reservation_batch AS (
    SELECT COALESCE((SELECT issued_at FROM latest_active_batch), now()) AS issued_at
  ),
  filtered AS (
    SELECT
      erd.*,
      epi.strongest_exclusion_reason AS impression_reason,
      epi.prefetch_expires_at AS impression_prefetch_expires_at,
      lar.deck_token AS active_reservation_deck_token,
      lar.deck_rank AS active_reservation_deck_rank,
      lar.expires_at AS active_reservation_expires_at,
      lar.issued_at AS active_reservation_issued_at
    FROM eligible_raw erd
    LEFT JOIN public.event_profile_impressions epi
      ON epi.event_id = p_event_id
      AND epi.viewer_id = p_user_id
      AND epi.target_id = erd.profile_id
    LEFT JOIN latest_active_reservations lar
      ON lar.target_id = erd.profile_id
    WHERE epi.target_id IS NULL
      OR public.video_date_impression_rank(epi.strongest_exclusion_reason)
          < public.video_date_impression_rank('pass')
  ),
  ranked AS (
    SELECT *
    FROM (
      SELECT
        filtered.*,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN filtered.active_reservation_deck_rank IS NOT NULL THEN 0
              ELSE 1
            END,
            filtered.active_reservation_deck_rank,
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
  active_reusable_reservations AS (
    UPDATE public.event_deck_card_reservations r
    SET deck_rank = ranked.rn::integer,
        expires_at = GREATEST(r.expires_at, now() + interval '2 minutes'),
        metadata = r.metadata || jsonb_build_object(
          'reservation_reused', true,
          'reservation_reused_at', now(),
          'reservation_reuse_scope', 'card',
          'reservation_previous_deck_rank', r.deck_rank
        )
    FROM latest_active_batch b, ranked
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND ranked.profile_id = r.target_id
      AND r.issued_at = b.issued_at
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
    RETURNING r.target_id, r.deck_token, r.deck_rank, r.expires_at, true AS reused
  ),
  new_reservations AS (
    INSERT INTO public.event_deck_card_reservations (
      event_id,
      viewer_id,
      target_id,
      deck_token,
      deck_rank,
      issued_at,
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
      rb.issued_at,
      now() + interval '2 minutes',
      'get_event_deck_v3',
      jsonb_build_object('deck_version', 'v3', 'server_prefetched', true)
    FROM ranked
    CROSS JOIN reservation_batch rb
    WHERE NOT EXISTS (
      SELECT 1
      FROM active_reusable_reservations existing
      WHERE existing.target_id = ranked.profile_id
    )
    RETURNING target_id, deck_token, deck_rank, expires_at, false AS reused
  ),
  reservations AS (
    SELECT target_id, deck_token, deck_rank, expires_at, reused FROM active_reusable_reservations
    UNION ALL
    SELECT target_id, deck_token, deck_rank, expires_at, reused FROM new_reservations
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
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_profile_impressions existing_prefetch
      WHERE existing_prefetch.event_id = p_event_id
        AND existing_prefetch.viewer_id = p_user_id
        AND existing_prefetch.target_id = ranked.profile_id
        AND (
          public.video_date_impression_rank(existing_prefetch.strongest_exclusion_reason)
            >= public.video_date_impression_rank('dealt')
          OR (
            existing_prefetch.strongest_exclusion_reason = 'prefetched'
            AND existing_prefetch.prefetch_expires_at > now()
          )
        )
    )
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
            - 'active_reservation_deck_token'
            - 'active_reservation_deck_rank'
            - 'active_reservation_expires_at'
            - 'active_reservation_issued_at'
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
    ), 0),
    COALESCE((
      SELECT count(*)::integer
      FROM reservations
      WHERE reused
    ), 0)
  INTO v_profiles, v_raw_count, v_eligible_count, v_profile_count, v_marked_count, v_reused_reservation_count
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
      'reservation_ttl_seconds', 120,
      'reused_reservation_count', v_reused_reservation_count,
      'preserves_active_reservations', true,
      'redeal_unacted', true
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns structured deck_state, preserves active reservation buffers during top-up refetches, re-deals visible unacted cards, soft-prefetches idempotently, and issues short-lived card reservations for visible/swipe authority.';
