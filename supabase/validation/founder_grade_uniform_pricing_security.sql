-- Read-only founder-grade hardening validation.

select
  'founder_grade_core_objects_present' as check_name,
  to_regclass('public.stripe_event_ticket_checkout_intents') is not null
  and to_regprocedure('public.verify_event_ticket_checkout_intent(text,uuid,uuid,integer,text,text)') is not null
  and to_regclass('public.revenuecat_webhook_events') is not null
  and to_regclass('public.public_account_deletion_request_log') is not null
  as ok;

select
  'founder_grade_service_helpers_locked' as check_name,
  has_function_privilege(
    'service_role',
    'public.verify_event_ticket_checkout_intent(text,uuid,uuid,integer,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.verify_event_ticket_checkout_intent(text,uuid,uuid,integer,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.verify_event_ticket_checkout_intent(text,uuid,uuid,integer,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.recompute_profile_subscription_entitlement(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.recompute_profile_subscription_entitlement(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.recompute_profile_subscription_entitlement(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.record_public_account_deletion_request(text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_public_account_deletion_request(text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_public_account_deletion_request(text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.sync_profiles_is_premium_from_subscriptions()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.sync_profiles_is_premium_from_subscriptions()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.sync_profiles_is_premium_from_subscriptions()',
    'EXECUTE'
  )
  as ok;
