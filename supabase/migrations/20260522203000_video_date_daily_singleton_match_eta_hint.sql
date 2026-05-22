-- Vibely Video Date Daily singleton and post-date ETA hint.
-- Additive follow-up because 20260522193000 is already applied remotely.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  ('video_date.daily_call_singleton_v2', false, 0, 'Web/native Daily call-object warm handoff between consecutive video dates.', false)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.emit_video_date_match_eta_hint_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hint_enabled boolean := false;
  v_eta_seconds integer := 30;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.ready_gate_status IS NOT DISTINCT FROM NEW.ready_gate_status
     OR NEW.ready_gate_status IS DISTINCT FROM 'ready'
     OR OLD.ready_gate_status IS DISTINCT FROM 'queued'
     OR NEW.ended_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.client_feature_flags
    WHERE flag_key = 'video_date.post_date_instant_next_v2'
      AND enabled = true
      AND kill_switch_active = false
      AND rollout_bps >= 10000
  )
  INTO v_hint_enabled;

  IF NOT v_hint_enabled THEN
    RETURN NEW;
  END IF;

  IF NEW.ready_gate_expires_at IS NOT NULL THEN
    v_eta_seconds := GREATEST(
      0,
      LEAST(30, CEIL(EXTRACT(EPOCH FROM (NEW.ready_gate_expires_at - now())))::integer)
    );
  END IF;

  PERFORM public.append_video_session_event_v2(
    NEW.id,
    'match_eta_hint',
    'participants',
    NULL,
    jsonb_build_object(
      'event_id', NEW.event_id,
      'eta_seconds', v_eta_seconds,
      'ready_gate_status', NEW.ready_gate_status,
      'ready_gate_expires_at', NEW.ready_gate_expires_at
    ),
    jsonb_build_object(
      'event_id', NEW.event_id,
      'eta_seconds', v_eta_seconds,
      'ready_gate_status', NEW.ready_gate_status
    ),
    true,
    gen_random_uuid()
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.emit_video_date_match_eta_hint_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_video_date_match_eta_hint_v2() TO service_role;

COMMENT ON FUNCTION public.emit_video_date_match_eta_hint_v2() IS
  'Emits a sanitized participant-visible match_eta_hint event when a queued match promotes into Ready Gate after post-date instant-next is fully rolled out.';

DROP TRIGGER IF EXISTS emit_video_date_match_eta_hint_v2
  ON public.video_sessions;

CREATE TRIGGER emit_video_date_match_eta_hint_v2
AFTER UPDATE OF ready_gate_status ON public.video_sessions
FOR EACH ROW
EXECUTE FUNCTION public.emit_video_date_match_eta_hint_v2();
