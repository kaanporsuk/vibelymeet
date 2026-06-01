-- Video Date deck reservation reuse and bounded visible-token grace.
--
-- Reuse the latest active reservation batch when a refetch returns the same
-- ordered candidates, avoiding reservation churn while preserving current-top
-- authority. A visible card remains swipeable after its short reservation TTL
-- only for a bounded grace window.

CREATE OR REPLACE FUNCTION public.event_deck_current_top_candidate(
  p_event_id uuid,
  p_viewer_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_target_id uuid;
  v_visible_grace interval := interval '20 minutes';
BEGIN
  WITH latest_batch AS (
    SELECT max(r.issued_at) AS issued_at
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND (
        r.expires_at > now()
        OR (r.visible_at IS NOT NULL AND r.visible_at > now() - v_visible_grace)
      )
  ),
  candidates AS (
    SELECT
      r.target_id,
      r.deck_rank
    FROM public.event_deck_card_reservations r
    JOIN latest_batch lb ON lb.issued_at = r.issued_at
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND (
        r.expires_at > now()
        OR (r.visible_at IS NOT NULL AND r.visible_at > now() - v_visible_grace)
      )
      AND r.swiped_at IS NULL
      AND COALESCE((public.event_deck_candidate_eligibility(
        p_event_id,
        p_viewer_id,
        r.target_id,
        true,
        true
      )->>'ok')::boolean, false)
  )
  SELECT candidates.target_id
  INTO v_target_id
  FROM candidates
  ORDER BY candidates.deck_rank
  LIMIT 1;

  RETURN v_target_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid) IS
  'Returns the current top Event Lobby Deck candidate from authoritative reservations, including a bounded grace window for already-visible cards.';

CREATE OR REPLACE FUNCTION public.event_deck_validate_presented_card(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_deck_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_validation jsonb;
  v_token text := NULLIF(btrim(COALESCE(p_deck_token, '')), '');
  v_reservation record;
  v_current_top uuid;
  v_visible_grace interval := interval '20 minutes';
BEGIN
  v_validation := public.event_deck_candidate_eligibility(
    p_event_id,
    p_viewer_id,
    p_target_id,
    true,
    true
  );

  IF COALESCE((v_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_validation;
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT r.id, r.issued_at, r.expires_at, r.visible_at, r.deck_rank
    INTO v_reservation
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND r.target_id = p_target_id
      AND r.deck_token = v_token
      AND (
        r.expires_at > now()
        OR (r.visible_at IS NOT NULL AND r.visible_at > now() - v_visible_grace)
      )
      AND r.swiped_at IS NULL
    ORDER BY r.issued_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_deck_token');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.event_deck_card_reservations lower_rank
      WHERE lower_rank.event_id = p_event_id
        AND lower_rank.viewer_id = p_viewer_id
        AND lower_rank.issued_at = v_reservation.issued_at
        AND lower_rank.deck_rank < v_reservation.deck_rank
        AND (
          lower_rank.expires_at > now()
          OR (lower_rank.visible_at IS NOT NULL AND lower_rank.visible_at > now() - v_visible_grace)
        )
        AND lower_rank.swiped_at IS NULL
        AND COALESCE((public.event_deck_candidate_eligibility(
          p_event_id,
          p_viewer_id,
          lower_rank.target_id,
          true,
          true
        )->>'ok')::boolean, false)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_current_top_card');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'reason', 'valid_deck_token',
      'reservation_id', v_reservation.id,
      'expires_at', v_reservation.expires_at,
      'visible_grace_seconds', 1200
    );
  END IF;

  v_current_top := public.event_deck_current_top_candidate(p_event_id, p_viewer_id);
  IF v_current_top IS NULL OR v_current_top IS DISTINCT FROM p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_current_top_card');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'current_top_card');
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text) IS
  'Validates Event Lobby presented cards. A deck token must be unexpired or within bounded visible-card grace, and topmost within its reservation batch; no-token legacy clients use the latest authoritative current-top reservation.';

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
  ranked_shape AS (
    SELECT
      count(*)::integer AS n,
      COALESCE(array_agg(ranked.profile_id ORDER BY ranked.rn), ARRAY[]::uuid[]) AS target_ids
    FROM ranked
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
  latest_active_batch_shape AS (
    SELECT
      b.issued_at,
      count(r.id)::integer AS n,
      COALESCE(array_agg(r.target_id ORDER BY r.deck_rank), ARRAY[]::uuid[]) AS target_ids
    FROM latest_active_batch b
    JOIN public.event_deck_card_reservations r
      ON r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND r.issued_at = b.issued_at
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
    GROUP BY b.issued_at
  ),
  reusable_batch AS (
    SELECT lbs.issued_at
    FROM latest_active_batch_shape lbs
    CROSS JOIN ranked_shape rs
    WHERE rs.n > 0
      AND lbs.n = rs.n
      AND lbs.target_ids = rs.target_ids
  ),
  reusable_reservations AS (
    UPDATE public.event_deck_card_reservations r
    SET expires_at = GREATEST(r.expires_at, now() + interval '2 minutes'),
        metadata = r.metadata || jsonb_build_object(
          'reservation_reused', true,
          'reservation_reused_at', now()
        )
    FROM reusable_batch b
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND r.issued_at = b.issued_at
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
    WHERE NOT EXISTS (SELECT 1 FROM reusable_batch)
    RETURNING target_id, deck_token, deck_rank, expires_at, false AS reused
  ),
  reservations AS (
    SELECT target_id, deck_token, deck_rank, expires_at, reused FROM reusable_reservations
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
      'redeal_unacted', true
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns structured deck_state, re-deals visible unacted cards, reuses unchanged active reservation batches, soft-prefetches idempotently, and issues short-lived card reservations for visible/swipe authority.';
