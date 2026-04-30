-- Read-only validation pack for the Event Lobby active-event contract.
-- Run in SQL editor after applying the migration to a non-production database.

-- 1) Shared inactive-reason helper exists and encodes the live-window contract.
select
  'event_lobby_inactive_reason_helper_exists' as check_name,
  to_regprocedure('public.get_event_lobby_inactive_reason(uuid)') is not null
  and pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%event_archived%'
  and pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%event_cancelled%'
  and pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%event_ended%'
  and pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%event_not_live%'
  and pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%event_outside_live_window%'
  and pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%COALESCE(v_event.duration_minutes, 60)%'
  as ok;

-- 2) Internal helpers are not client-executable.
select
  'event_lobby_helpers_not_client_executable' as check_name,
  not has_function_privilege(
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
    'public.get_event_lobby_inactive_reason(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.is_event_lobby_active(uuid)',
    'EXECUTE'
  )
  as ok;

-- 3) Public deck RPC gates before delegating to the preserved implementation.
select
  'get_event_deck_active_guard_present' as check_name,
  pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure)
    like '%public.get_event_lobby_inactive_reason(p_event_id) IS NOT NULL%'
  and pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure)
    like '%public.get_event_deck_20260501180000_active_base%'
  and not has_function_privilege(
    'authenticated',
    'public.get_event_deck_20260501180000_active_base(uuid,uuid,integer)',
    'EXECUTE'
  )
  as ok;

-- 4) Public swipe RPC returns inactive before direct swipe/session mutation.
select
  'handle_swipe_active_guard_present' as check_name,
  pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%''result'', ''event_not_active''%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%FOR SHARE OF ev%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%public.handle_swipe_20260501180000_active_base%'
  and not has_function_privilege(
    'authenticated',
    'public.handle_swipe_20260501180000_active_base(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  as ok;

-- 5) Mystery Match cannot create Ready Gate sessions for inactive events.
select
  'find_mystery_match_active_guard_present' as check_name,
  pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%''error'', ''event_not_active''%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%''terminal'', true%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%public.find_mystery_match_20260501180000_active_base%'
  and not has_function_privilege(
    'authenticated',
    'public.find_mystery_match_20260501180000_active_base(uuid,uuid)',
    'EXECUTE'
  )
  as ok;

-- 6) Queue promotion paths return event_not_valid before promoting Ready Gate.
select
  'queue_promotion_active_guard_present' as check_name,
  pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%v_is_service_role boolean := auth.role() = ''service_role''%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%IF NOT v_is_service_role%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%v_actor IS NULL OR v_actor IS DISTINCT FROM p_uid%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%actor_registration_guard%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%''reason'', ''event_not_valid''%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%''inactive_reason'', v_inactive_reason%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%public.promote_ready_gate_if_eligible_20260501180000_active_base%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%actor_registration_guard%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%''reason'', ''event_not_valid''%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%''inactive_reason'', v_inactive_reason%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%public.drain_match_queue_20260501180000_active_base%'
  and not has_function_privilege(
    'authenticated',
    'public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.drain_match_queue_20260501180000_active_base(uuid)',
    'EXECUTE'
  )
  as ok;

-- 7) Public client contracts remain callable.
select
  'event_lobby_public_rpcs_client_executable' as check_name,
  has_function_privilege('authenticated', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.handle_swipe(uuid,uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.find_mystery_match(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.drain_match_queue(uuid)', 'EXECUTE')
  as ok;
