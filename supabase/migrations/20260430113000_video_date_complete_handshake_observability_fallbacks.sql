-- Hardening: guarantee complete_handshake observability detail keys even if
-- enrichment logic partially fails.
CREATE OR REPLACE FUNCTION public.enrich_video_date_transition_observability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_grace_status text;
  v_actor_text text;
BEGIN
  IF NEW.operation = 'video_date_transition' THEN
    v_action := COALESCE(NEW.detail->>'action', '');

    IF v_action = 'complete_handshake' THEN
      v_actor_text := COALESCE(NEW.actor_id::text, 'system');

      BEGIN
        v_grace_status := CASE NEW.reason_code
          WHEN 'handshake_grace_started' THEN 'grace_started'
          WHEN 'handshake_grace_active' THEN 'grace_active'
          WHEN 'handshake_grace_expired_no_mutual' THEN 'grace_expired'
          WHEN 'handshake_completed_mutual' THEN 'not_needed_mutual'
          WHEN 'handshake_completed_no_mutual' THEN 'not_needed_no_mutual'
          WHEN 'session_already_ended' THEN 'already_ended'
          ELSE 'unknown'
        END;

        NEW.detail := COALESCE(NEW.detail, '{}'::jsonb) || jsonb_build_object(
          'actor_id', v_actor_text,
          'participant_1_liked', COALESCE(NEW.detail->'participant_1_liked', 'null'::jsonb),
          'participant_2_liked', COALESCE(NEW.detail->'participant_2_liked', 'null'::jsonb),
          'complete_handshake_grace_status', COALESCE(v_grace_status, 'unknown'),
          'handshake_grace_started', COALESCE(v_grace_status, 'unknown') = 'grace_started',
          'handshake_grace_active', COALESCE(v_grace_status, 'unknown') = 'grace_active',
          'handshake_grace_expired', COALESCE(v_grace_status, 'unknown') = 'grace_expired'
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Fallback guarantee: always stamp core complete_handshake detail keys.
          NEW.detail := COALESCE(NEW.detail, '{}'::jsonb) || jsonb_build_object(
            'actor_id', v_actor_text,
            'complete_handshake_grace_status', 'unknown'
          );
      END;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enrich_video_date_transition_observability() FROM PUBLIC;

COMMENT ON FUNCTION public.enrich_video_date_transition_observability() IS
  'Enriches video_date_transition complete_handshake observability rows with actor, liked flags, and grace status; guarantees actor_id and complete_handshake_grace_status fallback keys.';
