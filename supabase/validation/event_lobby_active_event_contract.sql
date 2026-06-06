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
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%v_status IN (''ended'', ''completed'')%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    like '%v_status NOT IN (''upcoming'', ''scheduled'', ''live'')%'
  and pg_get_functiondef('public.get_event_lobby_active_state(uuid,timestamp with time zone)'::regprocedure)
    not like '%v_status <> ''live''%'
  as ok;

-- 2) Discovery computed_status treats ended_at as terminal, then scheduled live window, then computed end.
select
  'get_visible_events_lifecycle_order' as check_name,
  to_regprocedure('public.get_visible_events(uuid,double precision,double precision,boolean,double precision,double precision,double precision)') is not null
  and pg_get_functiondef('public.get_visible_events(uuid,double precision,double precision,boolean,double precision,double precision,double precision)'::regprocedure)
    like '%WHEN e.ended_at IS NOT NULL THEN ''ended''%'
  and pg_get_functiondef('public.get_visible_events(uuid,double precision,double precision,boolean,double precision,double precision,double precision)'::regprocedure)
    like '%WHEN now() >= e.event_date%THEN ''live''%'
  and pg_get_functiondef('public.get_visible_events(uuid,double precision,double precision,boolean,double precision,double precision,double precision)'::regprocedure)
    like '%WHEN now() >= (e.event_date%THEN ''ended''%'
  and pg_get_functiondef('public.get_visible_events(uuid,double precision,double precision,boolean,double precision,double precision,double precision)'::regprocedure)
    not like '%e.status = ''ended'' OR e.ended_at IS NOT NULL%'
  as ok;

-- 3) Compatibility helpers delegate to the canonical helper.
select
  'event_lobby_compat_helpers_delegate' as check_name,
  pg_get_functiondef('public.get_event_lobby_inactive_reason(uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.is_event_lobby_active(uuid)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  as ok;

-- 4) Internal helpers are not client-executable.
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
  and not has_function_privilege(
    'anon',
    'public.lock_event_lobby_scheduled_active_state(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.lock_event_lobby_scheduled_active_state(uuid,timestamp with time zone)',
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
  and has_function_privilege(
    'service_role',
    'public.lock_event_lobby_scheduled_active_state(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  as ok;

-- 5) Deck RPCs reject inactive events before candidate work.
select
  'event_deck_active_rejection_present' as check_name,
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
  and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
    like '%''reason'', ''event_not_active''%'
  and pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure)
    like '%''inactive_reason'', COALESCE(v_active.reason, ''event_not_active'')%'
  and position('public.get_event_lobby_active_state(p_event_id, now())' in pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure))
    < position('FROM public.event_registrations er' in pg_get_functiondef('public.get_event_deck_v3(uuid,uuid,integer)'::regprocedure))
  as ok;

-- 6) Public swipe RPC rejects inactive events before direct swipe/session mutation.
select
  'handle_swipe_active_guard_present' as check_name,
  pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    like '%public.handle_swipe_v2(%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    not like '%INSERT INTO public.event_swipes%'
  and pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure)
    not like '%INSERT INTO public.video_sessions%'
  and pg_get_functiondef('public.handle_swipe_v2(uuid,uuid,uuid,text,text)'::regprocedure)
    like '%public.event_deck_validate_presented_card%'
  and pg_get_functiondef('public.handle_swipe_v2(uuid,uuid,uuid,text,text)'::regprocedure)
    like '%public.handle_swipe_20260601183000_deck_authority_base%'
  and pg_get_functiondef('public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)'::regprocedure)
    like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)'::regprocedure)
    like '%''outcome'', ''event_not_active''%'
  and position('public.get_event_lobby_active_state(p_event_id, now())' in pg_get_functiondef('public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)'::regprocedure))
    < position('FROM public.event_swipes es' in pg_get_functiondef('public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)'::regprocedure))
  and position('public.get_event_lobby_active_state(p_event_id, now())' in pg_get_functiondef('public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)'::regprocedure))
    < position('FROM public.video_sessions vs' in pg_get_functiondef('public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)'::regprocedure))
  and pg_get_functiondef('public.handle_swipe_20260501210000_idempotency_base(uuid,uuid,uuid,text)'::regprocedure)
    like '%public.lock_event_lobby_scheduled_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.handle_swipe_20260501210000_idempotency_base(uuid,uuid,uuid,text)'::regprocedure)
    not like '%ev.status = ''live''%'
  and not has_function_privilege(
    'authenticated',
    'public.handle_swipe_20260502083000_ready_queue_base(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  as ok;

-- 7) Mystery Match cannot create Ready Gate sessions for inactive events.
select
  'find_mystery_match_active_guard_present' as check_name,
  pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%public.lock_event_lobby_scheduled_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%''error'', ''event_not_active''%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%''terminal'', true%'
  and pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure)
    like '%public.find_mystery_match_20260502083000_active_base%'
  and position('public.lock_event_lobby_scheduled_active_state(p_event_id, now())' in pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure))
    < position('public.find_mystery_match_20260502083000_active_base' in pg_get_functiondef('public.find_mystery_match(uuid,uuid)'::regprocedure))
  and not has_function_privilege(
    'authenticated',
    'public.find_mystery_match_20260502083000_active_base(uuid,uuid)',
    'EXECUTE'
  )
  as ok;

-- 7) Queue promotion paths return event_not_valid before promoting Ready Gate.
select
  'queue_promotion_active_guard_present' as check_name,
  pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    like '%public.promote_ready_gate_if_eligible_20260505223000_lock_order_base%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure)
    not like '%INSERT INTO public.video_sessions%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(uuid,uuid)'::regprocedure)
    like '%public.lock_event_lobby_scheduled_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(uuid,uuid)'::regprocedure)
    like '%''reason'', ''event_not_valid''%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible_20260505223000_lock_order_base(uuid,uuid)'::regprocedure)
    like '%''inactive_reason'', v_inactive_reason%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%public.drain_match_queue_v2(p_event_id, v_key)%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    not like '%INSERT INTO public.video_sessions%'
  and pg_get_functiondef('public.drain_match_queue_v2(uuid,text)'::regprocedure)
    like '%public.drain_match_queue_v2_20260605232304_single_owner_base%'
  and pg_get_functiondef('public.drain_match_queue_v2_20260605232304_single_owner_base(uuid,text)'::regprocedure)
    like '%public.lock_event_lobby_scheduled_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.drain_match_queue_v2_20260605232304_single_owner_base(uuid,text)'::regprocedure)
    like '%''reason'', ''event_not_valid''%'
  and pg_get_functiondef('public.drain_match_queue_v2_20260605232304_single_owner_base(uuid,text)'::regprocedure)
    like '%''inactive_reason'', v_inactive_reason%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid,uuid)'::regprocedure)
    like '%public.lock_event_lobby_scheduled_active_state(p_event_id, now())%'
  and pg_get_functiondef('public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid,uuid)'::regprocedure)
    not like '%e.status = ''live''%'
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
