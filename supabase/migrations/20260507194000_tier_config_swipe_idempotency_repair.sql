-- Tier Config swipe idempotency repair.
-- Migration classification: schema+policy.

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_daily_limit integer;
  v_daily_count integer;
  v_actor_conversation_limit integer;
  v_target_conversation_limit integer;
  v_actor_conversation_count integer;
  v_target_conversation_count integer;
  v_would_create_match boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_swipes es
    WHERE es.event_id = p_event_id
      AND es.actor_id = p_actor_id
      AND es.target_id = p_target_id
  ) THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  v_daily_limit := public._get_user_tier_capability_int_unchecked(p_actor_id, 'dailySwipeLimit');
  IF v_daily_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_actor_id::text), hashtext('dailySwipeLimit'));
    SELECT count(*)::integer
    INTO v_daily_count
    FROM public.event_swipes es
    WHERE es.actor_id = p_actor_id
      AND es.created_at >= v_day_start;

    IF v_daily_count >= v_daily_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'daily_swipe_limit_reached',
        'result', 'daily_swipe_limit_reached',
        'error', 'daily_swipe_limit_reached',
        'code', 'DAILY_SWIPE_LIMIT_REACHED',
        'limit', v_daily_limit
      );
    END IF;
  END IF;

  IF p_swipe_type IN ('vibe', 'super_vibe') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(LEAST(p_actor_id::text, p_target_id::text)),
      hashtext(GREATEST(p_actor_id::text, p_target_id::text))
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_target_id
        AND es.target_id = p_actor_id
        AND es.swipe_type IN ('vibe', 'super_vibe')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE (m.profile_id_1 = LEAST(p_actor_id, p_target_id)
             AND m.profile_id_2 = GREATEST(p_actor_id, p_target_id))
         OR (m.profile_id_1 = GREATEST(p_actor_id, p_target_id)
             AND m.profile_id_2 = LEAST(p_actor_id, p_target_id))
    )
    INTO v_would_create_match;

    IF v_would_create_match THEN
      PERFORM pg_advisory_xact_lock(
        hashtext(LEAST(p_actor_id::text, p_target_id::text)),
        hashtext('maxActiveConversations')
      );
      PERFORM pg_advisory_xact_lock(
        hashtext(GREATEST(p_actor_id::text, p_target_id::text)),
        hashtext('maxActiveConversations')
      );

      v_actor_conversation_limit := public._get_user_tier_capability_int_unchecked(p_actor_id, 'maxActiveConversations');
      v_target_conversation_limit := public._get_user_tier_capability_int_unchecked(p_target_id, 'maxActiveConversations');
      v_actor_conversation_count := public._user_active_conversation_count_unchecked(p_actor_id);
      v_target_conversation_count := public._user_active_conversation_count_unchecked(p_target_id);

      IF v_actor_conversation_limit IS NOT NULL
         AND v_actor_conversation_count >= v_actor_conversation_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'outcome', 'active_conversation_limit_reached',
          'result', 'active_conversation_limit_reached',
          'error', 'active_conversation_limit_reached',
          'code', 'ACTIVE_CONVERSATION_LIMIT_REACHED',
          'limit', v_actor_conversation_limit
        );
      END IF;

      IF v_target_conversation_limit IS NOT NULL
         AND v_target_conversation_count >= v_target_conversation_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'outcome', 'target_active_conversation_limit_reached',
          'result', 'target_active_conversation_limit_reached',
          'error', 'target_active_conversation_limit_reached',
          'code', 'TARGET_ACTIVE_CONVERSATION_LIMIT_REACHED',
          'limit', v_target_conversation_limit
        );
      END IF;
    END IF;
  END IF;

  RETURN public.handle_swipe_20260507190000_tier_authority_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507194000',
  'Tier Config swipe idempotency repair',
  'schema+policy',
  'Routes existing actor-target swipes through the base idempotent swipe handler before daily limit accounting, while retaining transaction-level locks for new swipe and match creation paths.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
