-- Stream 2C: Server-owned Daily Drop transitions
-- Goal: move view / opener / reply / pass into a canonical, backend-authoritative RPC.

CREATE OR REPLACE FUNCTION public.daily_drop_transition(
  p_drop_id uuid,
  p_action text,
  p_text text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_drop public.daily_drops%ROWTYPE;
  v_actor uuid;
  v_now timestamptz := now();
  v_partner uuid;
  v_match_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_drop
  FROM public.daily_drops
  WHERE id = p_drop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'drop_not_found');
  END IF;

  IF v_actor <> v_drop.user_a_id AND v_actor <> v_drop.user_b_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  -- Treat expired / terminal statuses as read-only
  IF v_drop.expires_at <= v_now
     OR v_drop.status IN ('expired_no_action', 'expired_no_reply', 'passed', 'matched', 'invalidated') THEN
    RETURN jsonb_build_object(
      'success', true,
      'terminal', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  -- Action: view (idempotent per user)
  IF p_action = 'view' THEN
    IF v_actor = v_drop.user_a_id AND COALESCE(v_drop.user_a_viewed, false) = false THEN
      v_drop.user_a_viewed := true;
    ELSIF v_actor = v_drop.user_b_id AND COALESCE(v_drop.user_b_viewed, false) = false THEN
      v_drop.user_b_viewed := true;
    END IF;

    IF v_drop.status = 'active_unopened' THEN
      v_drop.status := 'active_viewed';
    END IF;

    UPDATE public.daily_drops
    SET
      user_a_viewed = v_drop.user_a_viewed,
      user_b_viewed = v_drop.user_b_viewed,
      status = v_drop.status,
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  -- Action: send_opener
  IF p_action = 'send_opener' THEN
    IF v_drop.opener_sender_id IS NOT NULL THEN
      -- Idempotent: opener already sent
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', v_drop.status,
        'drop', row_to_json(v_drop)
      );
    END IF;

    IF p_text IS NULL OR length(btrim(p_text)) = 0 OR length(p_text) > 140 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_text');
    END IF;

    v_drop.opener_sender_id := v_actor;
    v_drop.opener_text := btrim(p_text);
    v_drop.opener_sent_at := v_now;
    v_drop.status := 'active_opener_sent';

    UPDATE public.daily_drops
    SET
      opener_sender_id = v_drop.opener_sender_id,
      opener_text = v_drop.opener_text,
      opener_sent_at = v_drop.opener_sent_at,
      status = v_drop.status,
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  -- Action: send_reply (creates match + seeds messages)
  IF p_action = 'send_reply' THEN
    IF v_drop.opener_sender_id IS NULL OR v_drop.opener_sender_id = v_actor THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_reply_actor');
    END IF;

    IF COALESCE(v_drop.chat_unlocked, false) THEN
      -- Idempotent: already matched/unlocked
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', v_drop.status,
        'match_id', v_drop.match_id,
        'drop', row_to_json(v_drop)
      );
    END IF;

    IF p_text IS NULL OR length(btrim(p_text)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_text');
    END IF;

    -- Determine partner
    IF v_actor = v_drop.user_a_id THEN
      v_partner := v_drop.user_b_id;
    ELSE
      v_partner := v_drop.user_a_id;
    END IF;

    -- Create or re-use match
    IF v_drop.match_id IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, matched_at)
      VALUES (LEAST(v_actor, v_partner), GREATEST(v_actor, v_partner), v_now)
      RETURNING id INTO v_match_id;
    ELSE
      v_match_id := v_drop.match_id;
    END IF;

    IF v_match_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'match_creation_failed');
    END IF;

    -- Seed opener and reply messages
    IF v_drop.opener_sender_id IS NOT NULL AND v_drop.opener_text IS NOT NULL THEN
      INSERT INTO public.messages (match_id, sender_id, content, created_at)
      VALUES (
        v_match_id,
        v_drop.opener_sender_id,
        v_drop.opener_text,
        COALESCE(v_drop.opener_sent_at, v_now)
      );
    END IF;

    INSERT INTO public.messages (match_id, sender_id, content, created_at)
    VALUES (v_match_id, v_actor, btrim(p_text), v_now);

    UPDATE public.daily_drops
    SET
      reply_sender_id = v_actor,
      reply_text = btrim(p_text),
      reply_sent_at = v_now,
      chat_unlocked = true,
      match_id = v_match_id,
      status = 'matched',
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'match_id', v_match_id,
      'drop', row_to_json(v_drop)
    );
  END IF;

  -- Action: pass
  IF p_action = 'pass' THEN
    IF v_drop.status = 'matched' OR v_drop.status = 'passed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', v_drop.status,
        'drop', row_to_json(v_drop)
      );
    END IF;

    v_drop.passed_by_user_id := v_actor;
    v_drop.status := 'passed';

    UPDATE public.daily_drops
    SET
      passed_by_user_id = v_drop.passed_by_user_id,
      status = v_drop.status,
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_action');
END;
$function$;

