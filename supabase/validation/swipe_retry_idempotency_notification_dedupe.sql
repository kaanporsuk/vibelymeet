-- Read-only validation pack for Event Lobby swipe retry idempotency,
-- explicit duplicate outcomes, and notification dedupe.
-- Safe for production catalog verification after the migration is applied.

with fn as (
  select
    pg_get_functiondef('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)'::regprocedure) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'handle_swipe_20260607103000_mutual_match_source_base'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text'
)
select
  'handle_swipe_preserved_mutation_base_security_search_path' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public']) as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'active_event_guard_precedes_replay_and_delegation' as check_name,
  def like '%public.get_event_lobby_active_state(p_event_id, now())%'
  and def like '%''result'', ''event_not_active''%'
  and def like '%FOR SHARE OF ev%'
  and position('public.get_event_lobby_active_state(p_event_id, now())' in def) < position('FROM public.event_swipes es' in def)
  and position('FROM public.event_swipes es' in def) < position('public.handle_swipe_20260501210000_idempotency_base' in def)
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'existing_swipe_detection_precedes_delegated_mutation' as check_name,
  def like '%handle_swipe_idempotency:%'
  and def like '%FROM public.event_swipes es%'
  and def like '%FOR UPDATE%'
  and def like '%v_existing_swipe_type IS DISTINCT FROM p_swipe_type%'
  and position('FROM public.event_swipes es' in def) < position('public.handle_swipe_20260501210000_idempotency_base' in def)
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'same_type_duplicates_return_already_swiped' as check_name,
  def like '%''outcome'', ''already_swiped''%'
  and def like '%''result'', ''already_swiped''%'
  and def like '%''duplicate'', true%'
  and def like '%''idempotent'', true%'
  and def like '%''replay'', true%'
  and def like '%''notification_suppressed'', true%'
  and def like '%''dedupe_reason'', ''existing_swipe''%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'session_replay_and_conflict_markers_are_returned' as check_name,
  def like '%''outcome'', ''already_matched''%'
  and def like '%''dedupe_reason'', ''existing_match''%'
  and def like '%''outcome'', ''swipe_already_recorded''%'
  and def like '%''result'', ''swipe_already_recorded''%'
  and def like '%''error'', ''swipe_already_recorded''%'
  and def like '%''existing_swipe_type'', v_existing_swipe_type%'
  and def like '%''requested_swipe_type'', p_swipe_type%'
  and def like '%''dedupe_reason'', ''swipe_type_conflict''%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'super_vibe_accounting_is_after_replay_guard' as check_name,
  position('FROM public.event_swipes es' in def) > 0
  and position('public.handle_swipe_20260501210000_idempotency_base' in def) > position('FROM public.event_swipes es' in def)
  and def not like '%user_credits%'
  and def not like '%credit_transactions%'
  and def not like '%deduct_credit%'
  as ok
from fn;

with bases as (
  select
    to_regprocedure('public.handle_swipe_20260501210000_idempotency_base(uuid,uuid,uuid,text)') as idempotency_oid,
    to_regprocedure('public.handle_swipe_20260607103000_mutual_match_source_base(uuid,uuid,uuid,text)') as preserved_oid
)
select
  'renamed_base_functions_are_not_client_executable' as check_name,
  idempotency_oid is not null
  and preserved_oid is not null
  and not has_function_privilege('anon', idempotency_oid, 'EXECUTE')
  and not has_function_privilege('authenticated', idempotency_oid, 'EXECUTE')
  and not has_function_privilege('anon', preserved_oid, 'EXECUTE')
  and not has_function_privilege('authenticated', preserved_oid, 'EXECUTE') as ok
from bases;
