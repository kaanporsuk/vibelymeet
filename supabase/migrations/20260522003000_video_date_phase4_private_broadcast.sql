-- Vibely Video Date v4 Phase 4: private sanitized Broadcast.
-- Broadcast is a hot-state notification path only. Postgres still owns truth;
-- clients refetch snapshots on sequence gaps and fall back to Postgres Changes.

CREATE OR REPLACE FUNCTION public.video_date_realtime_topic_is_session(p_topic text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(p_topic, '') ~* '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;

REVOKE ALL ON FUNCTION public.video_date_realtime_topic_is_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_realtime_topic_is_session(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_realtime_topic_is_session(text) IS
  'True only for v4 video-date Realtime topics of the form session:{uuid}.';

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Video date participants can receive session broadcasts" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "Video date session broadcast read guard" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "Video date clients cannot send session broadcasts" ON realtime.messages';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.video_date_can_access_session_topic(text, uuid);

CREATE OR REPLACE FUNCTION public.video_date_can_access_session_topic(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_topic text := btrim(COALESCE(p_topic, ''));
  v_user_id uuid := auth.uid();
  v_session_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.video_date_realtime_topic_is_session(v_topic) THEN
    RETURN false;
  END IF;

  BEGIN
    v_session_id := substring(v_topic from 9)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.id = v_session_id
      AND (vs.participant_1_id = v_user_id OR vs.participant_2_id = v_user_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_can_access_session_topic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_can_access_session_topic(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_can_access_session_topic(text) IS
  'Realtime RLS helper: only the authenticated caller may subscribe to their own private session:{uuid} Broadcast topics.';

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Video date participants can receive session broadcasts" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "Video date session broadcast read guard" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "Video date clients cannot send session broadcasts" ON realtime.messages';

    EXECUTE $policy$
      CREATE POLICY "Video date participants can receive session broadcasts"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND public.video_date_can_access_session_topic((SELECT realtime.topic()))
      )
    $policy$;

    -- Restrictive guard: if any future broad Realtime SELECT policy is added,
    -- session:{uuid} broadcast topics still require participant membership.
    EXECUTE $policy$
      CREATE POLICY "Video date session broadcast read guard"
      ON realtime.messages
      AS RESTRICTIVE
      FOR SELECT
      TO authenticated
      USING (
        COALESCE(realtime.messages.extension, '') <> 'broadcast'
        OR NOT public.video_date_realtime_topic_is_session((SELECT realtime.topic()))
        OR public.video_date_can_access_session_topic((SELECT realtime.topic()))
      )
    $policy$;

    -- Clients listen only. Database triggers are the sole publisher for
    -- session:{uuid} events, so user-sent spoofed phase messages are denied.
    EXECUTE $policy$
      CREATE POLICY "Video date clients cannot send session broadcasts"
      ON realtime.messages
      AS RESTRICTIVE
      FOR INSERT
      TO authenticated
      WITH CHECK (
        COALESCE(realtime.messages.extension, '') <> 'broadcast'
        OR NOT public.video_date_realtime_topic_is_session((SELECT realtime.topic()))
      )
    $policy$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.broadcast_video_session_event_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.visibility IS DISTINCT FROM 'participants' THEN
    RETURN NULL;
  END IF;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'id', NEW.id,
    'sessionId', NEW.session_id,
    'sessionSeq', NEW.session_seq,
    'kind', NEW.kind,
    'at', NEW.at,
    'actor', NEW.actor,
    'payload', CASE
      WHEN jsonb_typeof(COALESCE(NEW.sanitized_payload, '{}'::jsonb)) = 'object'
        THEN COALESCE(NEW.sanitized_payload, '{}'::jsonb)
      ELSE '{}'::jsonb
    END,
    'correlationId', NEW.correlation_id
  );

  -- Private database Broadcast. Send the compact event payload directly;
  -- table-row Broadcast helpers would risk exposing raw payload fields.
  PERFORM realtime.send(
    v_payload,
    'video_session_event',
    'session:' || NEW.session_id::text,
    true
  );

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_video_session_event_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_video_session_event_v2() TO service_role;

COMMENT ON FUNCTION public.broadcast_video_session_event_v2() IS
  'Broadcasts only sanitized participant-visible video_session_events to private session:{uuid} Realtime channels.';

DROP TRIGGER IF EXISTS broadcast_video_session_event_v2
  ON public.video_session_events;

CREATE TRIGGER broadcast_video_session_event_v2
AFTER INSERT ON public.video_session_events
FOR EACH ROW
WHEN (NEW.visibility = 'participants')
EXECUTE FUNCTION public.broadcast_video_session_event_v2();
