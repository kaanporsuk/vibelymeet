-- Read-only validation pack for Event Lobby deck payload/media contract.
-- Safe for production catalog verification after the migration is applied.

with deck as (
  select
    pg_get_functiondef('public.get_event_deck(uuid,uuid,integer)'::regprocedure) as def,
    pg_get_function_result('public.get_event_deck(uuid,uuid,integer)'::regprocedure) as result_type,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_event_deck'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid, p_user_id uuid, p_limit integer'
)
select
  'get_event_deck_safe_payload_shape' as check_name,
  count(*) = 1
  and bool_and(prosecdef)
  and bool_and(proconfig @> array['search_path=public'])
  and bool_and(result_type like '%primary_photo_path text%')
  and bool_and(result_type like '%photo_verified boolean%')
  and bool_and(result_type like '%premium_badge text%')
  and bool_and(result_type like '%availability_state text%')
  and bool_and(def like '%public.get_event_lobby_active_state(p_event_id, now())%')
  and bool_and(def like '%RAISE EXCEPTION ''event_not_active''%')
  and bool_and(def like '%COALESCE(base.queue_status, ''idle'') IN (''browsing'', ''idle'')%')
  and bool_and(def like '%COALESCE(p.photo_verified, false)%')
  and bool_and(def like '%''available''::text AS availability_state%') as ok
from deck;

with deck as (
  select
    pg_get_function_result('public.get_event_deck(uuid,uuid,integer)'::regprocedure) as result_type
)
select
  'forbidden_private_fields_not_returned' as check_name,
  result_type not ilike '%proof_selfie%'
  and result_type not ilike '%moderation%'
  and result_type not ilike '%suspension%'
  and result_type not ilike '%report%'
  and result_type not ilike '%block%'
  and result_type not ilike '%phone%'
  and result_type not ilike '%email%'
  and result_type not ilike '%photo_verified_at%'
  and result_type not ilike '%premium_until%'
  and result_type not ilike '%subscription_tier%' as ok
from deck;

select
  'public_contract_grants_preserved' as check_name,
  has_function_privilege('authenticated', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_event_deck(uuid,uuid,integer)', 'EXECUTE') as ok;
