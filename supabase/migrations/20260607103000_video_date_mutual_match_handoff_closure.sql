-- Mutual Match -> Ready Gate / Video Date handoff closure.
-- Keep the decisive session transitions independent from auxiliary notification
-- and analytics metadata while preserving the existing RPC chain.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS session_source text;

UPDATE public.video_sessions
SET session_source = 'reciprocal_swipe'
WHERE session_source IS NULL OR btrim(session_source) = '';

ALTER TABLE public.video_sessions
  ALTER COLUMN session_source SET DEFAULT 'reciprocal_swipe',
  ALTER COLUMN session_source SET NOT NULL;

COMMENT ON COLUMN public.video_sessions.session_source IS
  'Creation source for Video Date sessions: reciprocal_swipe by default, mystery_match for fallback pairing.';

DO $$
BEGIN
  IF to_regprocedure('public.video_date_outbox_enqueue_v2_20260607103000_failsoft_base(uuid,text,jsonb,text,timestamptz)') IS NULL
     AND to_regprocedure('public.video_date_outbox_enqueue_v2(uuid,text,jsonb,text,timestamptz)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz)
      RENAME TO video_date_outbox_enqueue_v2_20260607103000_failsoft_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.video_date_outbox_enqueue_v2_20260607103000_failsoft_base(uuid, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_outbox_enqueue_v2_20260607103000_failsoft_base(uuid, text, jsonb, text, timestamptz)
  TO service_role;

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
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  RETURN public.video_date_outbox_enqueue_v2_20260607103000_failsoft_base(
    p_session_id,
    p_kind,
    p_payload,
    p_dedupe_key,
    p_next_attempt_at
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'outbox_enqueue_failed',
      'code', 'OUTBOX_ENQUEUE_FAILED',
      'kind', p_kind,
      'session_id', p_session_id,
      'dedupe_key', p_dedupe_key,
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', SQLSTATE IS DISTINCT FROM '42501',
      'auxiliary', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.video_date_outbox_enqueue_v2(uuid, text, jsonb, text, timestamptz) IS
  'Fail-soft outbox enqueue wrapper. Auxiliary provider/notification enqueue failures return structured JSON and must not poison decisive session commits.';

DO $$
BEGIN
  IF to_regprocedure('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)') IS NULL
     AND to_regprocedure('public.handle_swipe_20260601183000_deck_authority_base(uuid,uuid,uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
      RENAME TO handle_swipe_20260607103000_mutual_match_source_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260607103000_mutual_match_source_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260607103000_mutual_match_source_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe_20260601183000_deck_authority_base(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_had_super_vibe boolean := false;
  v_has_super_vibe boolean := false;
  v_result jsonb;
  v_outcome text;
  v_session_source text;
  v_session_id_text text;
BEGIN
  IF p_swipe_type = 'super_vibe' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_actor_id
        AND es.target_id = p_target_id
        AND es.swipe_type = 'super_vibe'
    ) INTO v_had_super_vibe;
  END IF;

  v_result := public.handle_swipe_20260607103000_mutual_match_source_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );
  v_outcome := COALESCE(v_result->>'result', v_result->>'outcome', v_result->>'error');

  IF p_swipe_type = 'super_vibe' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_actor_id
        AND es.target_id = p_target_id
        AND es.swipe_type = 'super_vibe'
    ) INTO v_has_super_vibe;

    IF NOT v_had_super_vibe
       AND v_has_super_vibe
       AND COALESCE(v_result->>'success', 'false') = 'true'
       AND v_outcome IN ('super_vibe_sent', 'match', 'match_queued', 'already_matched') THEN
      v_result := v_result || jsonb_build_object('super_vibe_consumed', true);
    END IF;
  END IF;

  v_session_id_text := COALESCE(v_result->>'video_session_id', v_result->>'match_id');
  IF v_session_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND v_outcome IN ('match', 'match_queued', 'already_matched') THEN
    UPDATE public.video_sessions
    SET session_source = 'reciprocal_swipe'
    WHERE id = v_session_id_text::uuid
      AND (session_source IS NULL OR btrim(session_source) = '');

    SELECT session_source
    INTO v_session_source
    FROM public.video_sessions
    WHERE id = v_session_id_text::uuid;

    v_result := v_result || jsonb_build_object(
      'session_source',
      COALESCE(NULLIF(btrim(v_session_source), ''), 'reciprocal_swipe')
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text) IS
  'Swipe mutation base wrapper that adds durable reciprocal_swipe source metadata and super_vibe_consumed response truth.';

DO $$
BEGIN
  IF to_regprocedure('public.handle_swipe_v2_20260607103000_actor_bound_base(uuid,uuid,uuid,text,text)') IS NULL
     AND to_regprocedure('public.handle_swipe_v2(uuid,uuid,uuid,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text)
      RENAME TO handle_swipe_v2_20260607103000_actor_bound_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.handle_swipe_v2_20260607103000_actor_bound_base(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_v2_20260607103000_actor_bound_base(uuid, uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe_v2(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text,
  p_deck_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_auth_uid uuid := auth.uid();
BEGIN
  IF v_auth_uid IS NOT NULL AND v_auth_uid IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'result', 'unauthorized',
      'outcome', 'unauthorized',
      'error', 'unauthorized',
      'message', 'Sign in again to keep swiping.',
      'notification_suppressed', true
    );
  END IF;

  RETURN public.handle_swipe_v2_20260607103000_actor_bound_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type,
    p_deck_token
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text) IS
  'Actor-bound Event Lobby swipe path. Authenticated callers must match p_actor_id; service-role callers retain compatibility delegation.';

DO $$
BEGIN
  IF to_regprocedure('public.find_mystery_match_20260607103000_session_source_base(uuid,uuid)') IS NULL
     AND to_regprocedure('public.find_mystery_match_20260501180000_active_base(uuid,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
      RENAME TO find_mystery_match_20260607103000_session_source_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260607103000_session_source_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mystery_match_20260607103000_session_source_base(uuid, uuid)
  TO service_role;

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
  v_result jsonb;
  v_session_id_text text;
BEGIN
  v_result := public.find_mystery_match_20260607103000_session_source_base(p_event_id, p_user_id);
  v_session_id_text := v_result->>'session_id';

  IF COALESCE(v_result->>'success', 'false') = 'true'
     AND v_session_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE public.video_sessions
    SET session_source = 'mystery_match'
    WHERE id = v_session_id_text::uuid
      AND session_source IS DISTINCT FROM 'mystery_match';
    v_result := v_result || jsonb_build_object('session_source', 'mystery_match');
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid) IS
  'Mystery Match active-event base wrapper that labels created video_sessions as mystery_match.';

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Service-role compatibility wrapper only. Production web/native/mobile clients must use swipe-actions -> handle_swipe_v2 with deck_token.';
