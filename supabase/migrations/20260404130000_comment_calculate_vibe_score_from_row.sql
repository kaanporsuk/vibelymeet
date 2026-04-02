-- Documentation-only: clarify engineer-facing semantics (no function body change).
-- Persisted profiles.vibe_score / vibe_score_label are maintained by triggers that call
-- public.calculate_vibe_score(uuid). The from_row variant is not on that path.

COMMENT ON FUNCTION public.calculate_vibe_score_from_row(public.profiles) IS
'NON-AUTHORITATIVE for persisted vibe_score: profiles are updated by triggers invoking public.calculate_vibe_score(uuid), not this function. Retained after historical migrations; may diverge from calculate_vibe_score(uuid). Do not use for new features. Authoritative scorer: see 20260404120000_calculate_vibe_score_intent_coalesce.sql.';
