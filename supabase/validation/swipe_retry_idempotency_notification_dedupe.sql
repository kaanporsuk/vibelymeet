-- Read-only validation pack for Stream 7 swipe retry idempotency and
-- notification dedupe. Safe for production catalog verification after the
-- migration is applied.

with fn as (
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
  'handle_swipe_signature_security_search_path' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public']) as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'existing_swipe_detection_precedes_delegated_mutation' as check_name,
  def like '%handle_swipe_idempotency:%'
  and def like '%FROM public.event_swipes es%'
  and position('FROM public.event_swipes es' in def) < position('public.handle_swipe_20260501210000_idempotency_base' in def)
  and def like '%FOR UPDATE%'
  and def like '%v_existing_swipe_type IS DISTINCT FROM p_swipe_type%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'replay_and_conflict_markers_are_returned' as check_name,
  def like '%''idempotent'', true%'
  and def like '%''replay'', true%'
  and def like '%''notification_suppressed'', true%'
  and def like '%''dedupe_reason'', ''existing_swipe''%'
  and def like '%''dedupe_reason'', ''swipe_type_conflict''%'
  and def like '%''result'', ''swipe_already_recorded''%'
  and def like '%''existing_swipe_type'', v_existing_swipe_type%'
  and def like '%''requested_swipe_type'', p_swipe_type%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'super_vibe_credit_like_accounting_is_after_replay_guard' as check_name,
  position('FROM public.event_swipes es' in def) > 0
  and position('public.handle_swipe_20260501210000_idempotency_base' in def) > position('FROM public.event_swipes es' in def)
  -- The delegated base contains the super-vibe cap/count path. Replays must
  -- return before delegation, so duplicate super-vibes cannot count/deduct twice.
  and def like '%WHEN ''super_vibe'' THEN ''super_vibe_sent''%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.handle_swipe(uuid,uuid,uuid,text)'::regprocedure) as def
)
select
  'stream1_active_event_guard_is_preserved' as check_name,
  def like '%public.get_event_lobby_inactive_reason(p_event_id)%'
  and def like '%''result'', ''event_not_active''%'
  and def like '%FOR SHARE OF ev%'
  and position('public.get_event_lobby_inactive_reason(p_event_id)' in def) < position('FROM public.event_swipes es' in def)
  as ok
from fn;

with bases as (
  select to_regprocedure('public.handle_swipe_20260501210000_idempotency_base(uuid,uuid,uuid,text)') as oid
)
select
  'renamed_base_function_is_not_client_executable' as check_name,
  oid is not null
  and not has_function_privilege('anon', oid, 'EXECUTE')
  and not has_function_privilege('authenticated', oid, 'EXECUTE')
from bases;
