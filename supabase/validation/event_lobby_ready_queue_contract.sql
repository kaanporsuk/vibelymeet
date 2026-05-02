-- Read-only validation pack for Event Lobby busy-user, Ready Gate, and
-- queued-match contract hardening.
-- Safe for production catalog verification after the migration is applied.

with deck as (
  select
    pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_event_deck'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid, p_user_id uuid, p_limit integer'
)
select
  'get_event_deck_security_and_busy_filter' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public'])
  and bool_and(def like '%public.get_event_lobby_active_state(p_event_id, now())%')
  and bool_and(def like '%RAISE EXCEPTION ''event_not_active''%')
  and bool_and(def like '%COALESCE(%queue_status, ''idle'') IN (''browsing'', ''idle'')%')
  and bool_and(def like '%vs.ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''both_ready'', ''snoozed'')%')
  and bool_and(def like '%vs.state IN (''handshake'', ''date'')%')
  and bool_and(def like '%vs.phase IN (''handshake'', ''date'')%')
  and bool_and(def like '%vs.handshake_started_at IS NOT NULL%')
  and bool_and(def like '%vs.date_started_at IS NOT NULL%')
  and bool_and(def like '%video_date_pair_has_terminal_encounter%') as ok
from deck;

with swipe as (
  select
    pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'handle_swipe'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text'
)
select
  'handle_swipe_pre_mutation_active_session_conflict_guard' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public'])
  and bool_and(def like '%event_lobby_participant_session:%')
  and bool_and(def like '%pre_swipe_active_session_guard%')
  and bool_and(def like '%''outcome'', ''participant_has_active_session_conflict''%')
  and bool_and(def like '%''notification_suppressed'', true%')
  and bool_and(def like '%''dedupe_reason'', ''active_session_conflict''%')
  and bool_and(position('pre_swipe_active_session_guard' in def) < position('FROM public.event_swipes es' in def))
  and bool_and(position('pre_swipe_active_session_guard' in def) < position('public.handle_swipe_20260501210000_idempotency_base' in def))
  and bool_and(position('FROM public.event_swipes es' in def) < position('public.handle_swipe_20260501210000_idempotency_base' in def)) as ok
from swipe;

with promote as (
  select
    pg_get_functiondef('public.promote_ready_gate_if_eligible(uuid,uuid)'::regprocedure) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'promote_ready_gate_if_eligible'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid, p_uid uuid'
)
select
  'promote_ready_gate_participant_lock_and_conflict_guard' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public'])
  and bool_and(def like '%public.get_event_lobby_active_state(p_event_id, now())%')
  and bool_and(def like '%event_lobby_participant_session:%')
  and bool_and(def like '%pre_promotion_active_session_guard%')
  and bool_and(def like '%''reason'', ''participant_has_active_session_conflict''%')
  and bool_and(def like '%public.promote_ready_gate_if_eligible_20260501180000_active_base%')
  and bool_and(position('pre_promotion_active_session_guard' in def) < position('public.promote_ready_gate_if_eligible_20260501180000_active_base' in def)) as ok
from promote;

select
  'drain_match_queue_uses_public_promotion_contract' as check_name,
  pg_get_functiondef('public.drain_match_queue_20260501180000_active_base(uuid)'::regprocedure)
    like '%public.promote_ready_gate_if_eligible(p_event_id, v_uid)%'
  and pg_get_functiondef('public.drain_match_queue(uuid)'::regprocedure)
    like '%public.drain_match_queue_20260501180000_active_base%'
  as ok;

select
  'public_contract_grants_preserved' as check_name,
  has_function_privilege('authenticated', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.handle_swipe(uuid,uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.promote_ready_gate_if_eligible(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.drain_match_queue(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.handle_swipe(uuid,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.promote_ready_gate_if_eligible(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.drain_match_queue(uuid)', 'EXECUTE') as ok;
