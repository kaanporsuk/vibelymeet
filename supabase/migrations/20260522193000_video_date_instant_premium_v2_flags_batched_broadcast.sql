-- Vibely Video Date Instant Premium Experience v2.
-- Daily warm handoff is intentionally excluded. All new risky paths are default-off.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  ('video_date.deck_prefetch_polish_v2', false, 0, 'Web/native deck media prefetch, swipe paint, cache-hit, and top-up telemetry polish.', false),
  ('video_date.lobby_timeline_v2', false, 0, 'RAF-driven lobby timeline plus private active-session Broadcast convergence.', false),
  ('video_date.post_date_instant_next_v2', false, 0, 'Post-date survey prestage, next-deck prewarm, and optimistic verdict telemetry.', false),
  ('video_date.broadcast_batched_v2', false, 0, 'Statement-level batched participant Broadcast envelopes for video_session_events.', false),
  ('video_date.resilience_v2', false, 0, 'Premium reconnect resilience UI, ETA copy, low-quality mode telemetry, and capability-checked fallback.', false)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.video_date_broadcast_batched_v2_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_feature_flags
    WHERE flag_key = 'video_date.broadcast_batched_v2'
      AND enabled = true
      AND kill_switch_active = false
      -- Broadcast batching is global at the DB publisher. Require a full rollout
      -- so older clients are not stranded by array envelopes during partial rollout.
      AND rollout_bps >= 10000
  );
$function$;

REVOKE ALL ON FUNCTION public.video_date_broadcast_batched_v2_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_broadcast_batched_v2_enabled() TO service_role;

COMMENT ON FUNCTION public.video_date_broadcast_batched_v2_enabled() IS
  'Global DB-side guard for statement-level batched video-date Broadcast. Requires full client rollout.';

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

  IF public.video_date_broadcast_batched_v2_enabled() THEN
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

CREATE OR REPLACE FUNCTION public.broadcast_video_session_events_batched_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_catalog'
AS $function$
DECLARE
  v_session record;
BEGIN
  IF TG_OP <> 'INSERT' OR NOT public.video_date_broadcast_batched_v2_enabled() THEN
    RETURN NULL;
  END IF;

  FOR v_session IN
    SELECT
      nr.session_id,
      jsonb_agg(
        jsonb_build_object(
          'schemaVersion', 1,
          'id', nr.id,
          'sessionId', nr.session_id,
          'sessionSeq', nr.session_seq,
          'kind', nr.kind,
          'at', nr.at,
          'actor', nr.actor,
          'payload', CASE
            WHEN jsonb_typeof(COALESCE(nr.sanitized_payload, '{}'::jsonb)) = 'object'
              THEN COALESCE(nr.sanitized_payload, '{}'::jsonb)
            ELSE '{}'::jsonb
          END,
          'correlationId', nr.correlation_id
        )
        ORDER BY nr.session_seq, nr.id
      ) AS events
    FROM new_rows nr
    WHERE nr.visibility = 'participants'
    GROUP BY nr.session_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'schemaVersion', 1,
        'sessionId', v_session.session_id,
        'events', v_session.events
      ),
      'video_session_event',
      'session:' || v_session.session_id::text,
      true
    );
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_video_session_events_batched_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_video_session_events_batched_v2() TO service_role;

COMMENT ON FUNCTION public.broadcast_video_session_events_batched_v2() IS
  'Batches sanitized participant-visible video_session_events per session into private session:{uuid} Broadcast array envelopes.';

DROP TRIGGER IF EXISTS broadcast_video_session_events_batched_v2
  ON public.video_session_events;

CREATE TRIGGER broadcast_video_session_events_batched_v2
AFTER INSERT ON public.video_session_events
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.broadcast_video_session_events_batched_v2();
