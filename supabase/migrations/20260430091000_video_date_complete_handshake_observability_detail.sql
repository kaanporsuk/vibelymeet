-- Add explicit complete_handshake diagnostic fields without changing
-- video_date_transition semantics.

CREATE OR REPLACE FUNCTION public.enrich_video_date_transition_observability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_grace_status text;
BEGIN
  IF NEW.operation = 'video_date_transition' THEN
    v_action := COALESCE(NEW.detail->>'action', '');

    IF v_action = 'complete_handshake' THEN
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
        'actor_id', NEW.actor_id,
        'participant_1_liked', COALESCE(NEW.detail->'participant_1_liked', 'null'::jsonb),
        'participant_2_liked', COALESCE(NEW.detail->'participant_2_liked', 'null'::jsonb),
        'complete_handshake_grace_status', v_grace_status,
        'handshake_grace_started', v_grace_status = 'grace_started',
        'handshake_grace_active', v_grace_status = 'grace_active',
        'handshake_grace_expired', v_grace_status = 'grace_expired'
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enrich_video_date_transition_observability_before_insert
  ON public.event_loop_observability_events;

CREATE TRIGGER enrich_video_date_transition_observability_before_insert
BEFORE INSERT ON public.event_loop_observability_events
FOR EACH ROW
EXECUTE FUNCTION public.enrich_video_date_transition_observability();

REVOKE ALL ON FUNCTION public.enrich_video_date_transition_observability() FROM PUBLIC;

COMMENT ON FUNCTION public.enrich_video_date_transition_observability() IS
  'Enriches video_date_transition complete_handshake observability rows with actor, liked flags, and explicit handshake grace status.';
