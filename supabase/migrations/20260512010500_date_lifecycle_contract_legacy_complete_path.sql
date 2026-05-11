-- Date lifecycle contract hardening.
--
-- The current supported write surface is the date-suggestion-actions Edge
-- Function. It routes plan_mark_complete directly to date_plan_mark_complete_v2,
-- but the legacy SQL functions still had paths that could reach the older
-- completion model. Preserve all non-completion behavior by wrapping the latest
-- function bodies and intercepting plan_mark_complete at the public entrypoints.

BEGIN;

ALTER FUNCTION public.date_suggestion_apply_v2(text, jsonb)
  RENAME TO date_suggestion_apply_v2_legacy_dispatch_20260512;

ALTER FUNCTION public.date_suggestion_apply(text, jsonb)
  RENAME TO date_suggestion_apply_legacy_dispatch_20260512;

CREATE OR REPLACE FUNCTION public.date_suggestion_apply(
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_plan_id_raw text := nullif(coalesce(p_payload, '{}'::jsonb)->>'plan_id', '');
  v_plan_id uuid;
BEGIN
  IF p_action = 'plan_mark_complete' THEN
    IF v_plan_id_raw IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
    END IF;

    BEGIN
      v_plan_id := v_plan_id_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_plan_id');
    END;

    RETURN public.date_plan_mark_complete_v2(v_plan_id);
  END IF;

  RETURN public.date_suggestion_apply_legacy_dispatch_20260512(p_action, p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_plan_id_raw text := nullif(coalesce(p_payload, '{}'::jsonb)->>'plan_id', '');
  v_plan_id uuid;
BEGIN
  IF p_action = 'plan_mark_complete' THEN
    IF v_plan_id_raw IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
    END IF;

    BEGIN
      v_plan_id := v_plan_id_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_plan_id');
    END;

    RETURN public.date_plan_mark_complete_v2(v_plan_id);
  END IF;

  RETURN public.date_suggestion_apply_v2_legacy_dispatch_20260512(p_action, p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply(text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) TO authenticated;

-- These preserved bodies are implementation details for the wrappers above.
REVOKE ALL ON FUNCTION public.date_suggestion_apply_legacy_dispatch_20260512(text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2_legacy_dispatch_20260512(text, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.date_suggestion_apply(text, jsonb) IS
  'Legacy date suggestion write RPC wrapper. plan_mark_complete is routed to date_plan_mark_complete_v2; other actions delegate to the preserved legacy body.';

COMMENT ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) IS
  'Date suggestion write RPC wrapper. plan_mark_complete is routed to date_plan_mark_complete_v2; other actions delegate to the preserved v2 body.';

COMMIT;
