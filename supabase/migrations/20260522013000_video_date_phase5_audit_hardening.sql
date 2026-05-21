-- Phase 5 audit hardening:
-- 1. Make participant-visible sanitized_payload impossible to misuse for
--    secrets, auth material, idempotency keys, or safety/report details.
-- 2. Add the default-off multi-device flag and a service-role health view for
--    the already-existing video_date_surface_claims ownership model.

CREATE OR REPLACE FUNCTION public.video_date_jsonb_has_secret_key(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_key text;
  v_key_norm text;
  v_child jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN SELECT key, value FROM jsonb_each(p_value) LOOP
      v_key_norm := regexp_replace(lower(v_key), '[^a-z0-9]+', '', 'g');
      IF lower(v_key) LIKE '%token%'
         OR lower(v_key) LIKE '%secret%'
         OR lower(v_key) LIKE '%bearer%'
         OR v_key_norm LIKE '%apikey%'
         OR v_key_norm IN (
           'password',
           'authorization',
           'authheader',
           'jwt',
           'servicerole',
           'safetydetails',
           'safetyreason',
           'reportreason',
           'reportdetails',
           'idempotencykey',
           'dailytoken',
           'meetingtoken',
           'accesstoken',
           'refreshtoken'
         ) THEN
        RETURN true;
      END IF;
      IF public.video_date_jsonb_has_secret_key(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF public.video_date_jsonb_has_secret_key(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_jsonb_has_secret_key(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_jsonb_has_secret_key(jsonb) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.video_session_events'::regclass
      AND conname = 'video_session_events_no_sanitized_payload_sensitive_keys_v2'
  ) THEN
    ALTER TABLE public.video_session_events
      ADD CONSTRAINT video_session_events_no_sanitized_payload_sensitive_keys_v2
      CHECK (NOT public.video_date_jsonb_has_secret_key(sanitized_payload))
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT video_session_events_no_sanitized_payload_sensitive_keys_v2
ON public.video_session_events IS
  'Defense-in-depth for private Broadcast: participant-visible sanitized_payload cannot contain token/auth/idempotency/safety/report detail keys.';

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES (
  'video_date.multi_device_v2',
  false,
  0,
  'Video Date explicit multi-device takeover UX backed by server surface claims.',
  false
)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE OR REPLACE VIEW public.vw_video_date_multi_device_health
WITH (security_invoker = true)
AS
WITH live_claims AS (
  SELECT *
  FROM public.video_date_surface_claims
  WHERE released_at IS NULL
    AND expires_at > now()
),
expired_claims AS (
  SELECT *
  FROM public.video_date_surface_claims
  WHERE released_at IS NULL
    AND expires_at <= now()
),
conflicts AS (
  SELECT *
  FROM public.audit_active_video_date_surface_conflicts()
)
SELECT
  now() AS observed_at,
  (SELECT count(*)::integer FROM live_claims) AS live_claim_count,
  (SELECT count(*)::integer FROM live_claims WHERE surface = 'video_date') AS live_video_date_claim_count,
  (SELECT count(*)::integer FROM expired_claims) AS expired_unreleased_claim_count,
  (SELECT count(*)::integer FROM conflicts) AS active_surface_conflict_count,
  (
    SELECT COALESCE(jsonb_agg(to_jsonb(conflicts) ORDER BY profile_id), '[]'::jsonb)
    FROM conflicts
  ) AS active_surface_conflicts;

REVOKE ALL ON public.vw_video_date_multi_device_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_video_date_multi_device_health TO service_role;

COMMENT ON VIEW public.vw_video_date_multi_device_health IS
  'Service-role Video Date multi-device health: active surface claims, stale unreleased claims, and overlapping active surface conflicts.';
