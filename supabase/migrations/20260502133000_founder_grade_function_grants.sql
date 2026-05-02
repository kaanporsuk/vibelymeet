-- Founder-grade service helper grant lockdown.
--
-- CREATE OR REPLACE FUNCTION preserves existing explicit grants. The
-- 20260502120000 migration revoked PUBLIC, but environments that already had
-- anon/authenticated EXECUTE grants retained them. Keep service-owned helper
-- calls service-role-only and trigger plumbing trigger-only.

REVOKE ALL ON FUNCTION public.verify_event_ticket_checkout_intent(text, uuid, uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_event_ticket_checkout_intent(text, uuid, uuid, integer, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.recompute_profile_subscription_entitlement(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_profile_subscription_entitlement(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_public_account_deletion_request(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_public_account_deletion_request(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.sync_profiles_is_premium_from_subscriptions()
  FROM PUBLIC, anon, authenticated, service_role;
