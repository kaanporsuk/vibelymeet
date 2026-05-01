-- Read-only validation pack for the current Event Lobby active-event contract.
-- Safe for production SQL editor: catalog/function-definition checks only.

-- 1) Canonical active-state helper exists and encodes the full reason taxonomy.
select
  'event_lobby_active_state_helper_exists' as check_name,
  to_regprocedure('public.get_event_lobby_active_state(uuid,timestamp with time zone)') is not null
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%RETURNS TABLE(is_active boolean, reason text, event_status text)%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_not_found%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_draft%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_cancelled%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_archived%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_ended%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_not_live%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_not_started%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%event_outside_live_window%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%COALESCE(v_event.duration_minutes, 60)%'
  as ok;

-- 2) Compatibility helpers delegate to the canonical helper.
select
  'event_lobby_compat_helpers_delegate' as check_name,
  pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.is_event_lobby_active(uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  as ok;

-- 3) Internal helpers are not client-executable.
select
  'event_lobby_helpers_not_client_executable' as check_name,
  not has_function_privilege(
    'anon',
    'public.get_event_lobby_active_state(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_event_lobby_active_state(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.get_event_lobby_inactive_reason(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_event_lobby_inactive_reason(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.is_event_lobby_active(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.is_event_lobby_active(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.get_event_lobby_active_state(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.get_event_lobby_inactive_reason(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.is_event_lobby_active(uuid)',
    'EXECUTE'
  )
  as ok;

-- 4) Public deck RPC rejects inactive events instead of silently returning an empty deck.
select
  'get_event_deck_active_rejection_present' as check_name,
  pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure)
    like '%RAISE EXCEPTION ''event_not_active''%'
  and pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure)
    like '%public.get_event_deck_20260501180000_active_base%'
  and not has_function_privilege(
    'authenticated',
    'public.get_event_deck_20260501180000_active_base(uuid,uuid,integer)',
    'EXECUTE'
  )
  as ok;

-- 5) Public swipe RPC rejects inactive events before direct swipe/session mutation.
select
  'handle_swipe_active_guard_present' as check_name,
  pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%''outcome'', ''event_not_active''%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%FOR SHARE OF ev%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%public.handle_swipe_20260501210000_idempotency_base%'
  and position('public.get_event_lobby_active_state(p_event_id, now())' in pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure))
    < position('FROM public.event_swipes es' in pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure))
  and position('public.get_event_lobby_active_state(p_event_id, now())' in pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure))
    < position('public.handle_swipe_20260501210000_idempotency_base' in pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure))
  as ok;

-- 6) Mystery Match cannot create Ready Gate sessions for inactive events.
select
  'find_mystery_match_active_guard_present' as check_name,
  pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%''error'', ''event_not_active''%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%''terminal'', true%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%public.find_mystery_match_20260501180000_active_base%'
  and position('public.get_event_lobby_active_state(p_event_id, now())' in pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure))
    < position('public.find_mystery_match_20260501180000_active_base' in pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure))
  as ok;

-- 7) Queue promotion paths return event_not_valid before promoting Ready Gate.
select
  'queue_promotion_active_guard_present' as check_name,
  pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%''reason'', ''event_not_valid''%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%''inactive_reason'', v_inactive_reason%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%public.promote_ready_gate_if_eligible_20260501180000_active_base%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%''reason'', ''event_not_valid''%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%''inactive_reason'', v_inactive_reason%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%public.drain_match_queue_20260501180000_active_base%'
  as ok;

-- 8) Deprecated direct legacy session paths still cannot create sessions.
select
  'legacy_direct_session_paths_deprecated' as check_name,
  pg_get_functiondef('public.find_video_date_match(uuid,uuid)'::regprocedure)
    like '%deprecated_legacy_queue_surface%'
  and pg_get_functiondef('public.join_matching_queue(uuid,uuid)'::regprocedure)
    like '%deprecated_legacy_queue_surface%'
  and pg_get_functiondef('public.find_video_date_match(uuid,uuid)'::regprocedure)
    not like '%INSERT INTO public.video_sessions%'
  and pg_get_functiondef('public.join_matching_queue(uuid,uuid)'::regprocedure)
    not like '%INSERT INTO public.video_sessions%'
  as ok;

-- 9) Public client contracts remain callable.
select
  'event_lobby_public_rpcs_client_executable' as check_name,
  has_function_privilege('authenticated', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.handle_swipe(uuid,uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.find_mystery_match(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.drain_match_queue(uuid)', 'EXECUTE')
  as ok;
