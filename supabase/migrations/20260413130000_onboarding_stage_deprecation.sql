-- Clarify that onboarding_drafts.current_stage is the active in-progress
-- onboarding truth source. profiles.onboarding_stage and the helper RPC remain
-- only as deprecated compatibility surfaces for historical analytics.

COMMENT ON COLUMN public.profiles.onboarding_stage IS
  'DEPRECATED legacy onboarding stage marker. Active in-progress onboarding now lives in public.onboarding_drafts.current_stage. This column is retained temporarily for compatibility and historical analytics, and trusted backend completion paths still set it to ''complete''.';

COMMENT ON COLUMN public.onboarding_drafts.current_stage IS
  'Canonical in-progress onboarding stage for active web/native flows. Source of truth for onboarding resume and progress semantics.';

COMMENT ON FUNCTION public.update_onboarding_stage(uuid, text) IS
  'DEPRECATED legacy helper with no active web/native callers. Retained temporarily for compatibility and historical analytics. Active clients persist progress through save_onboarding_draft() and complete onboarding through finalize_onboarding() / complete_onboarding().';

COMMENT ON FUNCTION public.protect_sensitive_profile_columns IS
  'Blocks self-service edits to premium, verification, subscription, suspension, and onboarding columns. Onboarding columns may change from trusted finalize_onboarding / complete_onboarding RPCs (transaction-local vibely.onboarding_server_update). profiles.onboarding_stage / update_onboarding_stage are deprecated legacy semantics; active in-progress onboarding lives in onboarding_drafts.current_stage. Verification columns may change from trusted backend verification writers (transaction-local vibely.verification_server_update) or service_role.';
