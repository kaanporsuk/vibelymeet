-- Remove an unused event-append variable from the decisive mark-ready RPC.
--
-- The 20260606092944 migration installed the correct runtime behavior, but
-- linked DB lint reported warning-extra on v_event because the append result was
-- assigned only for historical session_seq fallback and no longer read. Keep the
-- public function behavior unchanged while eliminating the warning from the
-- final live definition.

BEGIN;

DO $migration$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.video_session_mark_ready_v2(uuid,text,text)'::regprocedure);

  IF position('v_event jsonb := ''{}''::jsonb;' in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected v_event declaration was not found in video_session_mark_ready_v2';
  END IF;

  IF position('v_event := public.append_video_session_event_v2(' in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected v_event assignment was not found in video_session_mark_ready_v2';
  END IF;

  v_def := replace(v_def, E'  v_event jsonb := ''{}''::jsonb;\n', '');
  v_def := replace(
    v_def,
    'v_event := public.append_video_session_event_v2(',
    'PERFORM public.append_video_session_event_v2('
  );
  v_def := replace(v_def, E'    v_event := ''{}''::jsonb;\n', '');

  IF position('v_event' in v_def) > 0 THEN
    RAISE EXCEPTION 'v_event marker remained after cleanup rewrite';
  END IF;

  EXECUTE v_def;
END
$migration$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Decisive Ready Gate mark-ready RPC. Commits participant readiness and deterministic both_ready room metadata before observability/outbox work, without delegating through the legacy wrapper stack.';

NOTIFY pgrst, 'reload schema';

COMMIT;
