-- Reassert the archive/unmatch terminal reason after 20260511120000 for
-- Supabase projects that already recorded that migration before the source
-- allow-list was corrected.

ALTER TABLE public.match_calls
  DROP CONSTRAINT IF EXISTS match_calls_ended_reason_check;

ALTER TABLE public.match_calls
  ADD CONSTRAINT match_calls_ended_reason_check
  CHECK (
    ended_reason IS NULL
    OR ended_reason IN (
      'declined',
      'hangup',
      'caller_cancelled',
      'missed',
      'timeout',
      'join_failed',
      'stale_active',
      'provider_error',
      'blocked_pair',
      'unmatched_pair',
      'busy',
      'connection_lost',
      'media_failure'
    )
  );

DO $$
DECLARE
  v_transition_fn regprocedure;
  v_definition text;
  v_repaired_definition text;
BEGIN
  v_transition_fn := to_regprocedure('public.match_call_transition(uuid,text,text)');

  IF v_transition_fn IS NULL THEN
    RAISE EXCEPTION 'public.match_call_transition(uuid, text, text) is missing';
  END IF;

  SELECT pg_get_functiondef(v_transition_fn)
  INTO v_definition;

  v_repaired_definition := v_definition;

  IF v_definition NOT LIKE '%''blocked_pair''%' AND v_definition NOT LIKE '%''unmatched_pair''%' THEN
    v_repaired_definition := replace(
      v_definition,
      '''provider_error'',
    ''busy''',
      '''provider_error'',
    ''blocked_pair'',
    ''unmatched_pair'',
    ''busy'''
    );
  ELSIF v_definition LIKE '%''blocked_pair''%' AND v_definition NOT LIKE '%''unmatched_pair''%' THEN
    v_repaired_definition := replace(
      v_definition,
      '''blocked_pair'',
    ''busy''',
      '''blocked_pair'',
    ''unmatched_pair'',
    ''busy'''
    );
  ELSIF v_definition NOT LIKE '%''blocked_pair''%' AND v_definition LIKE '%''unmatched_pair''%' THEN
    v_repaired_definition := replace(
      v_definition,
      '''provider_error'',
    ''unmatched_pair''',
      '''provider_error'',
    ''blocked_pair'',
    ''unmatched_pair'''
    );
  END IF;

  IF v_repaired_definition NOT LIKE '%''blocked_pair''%' OR v_repaired_definition NOT LIKE '%''unmatched_pair''%' THEN
    RAISE EXCEPTION 'unable to patch match_call_transition terminal reason allow-list';
  END IF;

  IF v_repaired_definition IS DISTINCT FROM v_definition THEN
    EXECUTE v_repaired_definition;
  END IF;

  REVOKE ALL ON FUNCTION public.match_call_transition(uuid, text, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.match_call_transition(uuid, text, text) TO authenticated;
END $$;
