-- Client feature flags for media-v2 rollout gates.
--
-- This is intentionally separate from the admin experimentation `feature_flags`
-- table. Clients evaluate flags only through `evaluate_client_feature_flag`;
-- direct table reads remain admin/service-role owned.

CREATE TABLE IF NOT EXISTS public.client_feature_flags (
  flag_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rollout_bps integer NOT NULL DEFAULT 0 CHECK (rollout_bps BETWEEN 0 AND 10000),
  description text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_feature_flags_key_not_blank CHECK (btrim(flag_key) <> '')
);

CREATE TABLE IF NOT EXISTS public.client_feature_flag_user_overrides (
  flag_key text NOT NULL REFERENCES public.client_feature_flags(flag_key) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  reason text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_feature_flag_user_overrides_user
  ON public.client_feature_flag_user_overrides(user_id, flag_key);

DROP TRIGGER IF EXISTS client_feature_flags_updated_at ON public.client_feature_flags;
CREATE TRIGGER client_feature_flags_updated_at
  BEFORE UPDATE ON public.client_feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS client_feature_flag_user_overrides_updated_at
  ON public.client_feature_flag_user_overrides;
CREATE TRIGGER client_feature_flag_user_overrides_updated_at
  BEFORE UPDATE ON public.client_feature_flag_user_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.client_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_feature_flag_user_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_select_client_feature_flags ON public.client_feature_flags;
CREATE POLICY admins_select_client_feature_flags ON public.client_feature_flags
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_insert_client_feature_flags ON public.client_feature_flags;
CREATE POLICY admins_insert_client_feature_flags ON public.client_feature_flags
  FOR INSERT WITH CHECK (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_update_client_feature_flags ON public.client_feature_flags;
CREATE POLICY admins_update_client_feature_flags ON public.client_feature_flags
  FOR UPDATE USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'))
  WITH CHECK (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_delete_client_feature_flags ON public.client_feature_flags;
CREATE POLICY admins_delete_client_feature_flags ON public.client_feature_flags
  FOR DELETE USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides;
CREATE POLICY admins_select_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_insert_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides;
CREATE POLICY admins_insert_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides
  FOR INSERT WITH CHECK (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_update_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides;
CREATE POLICY admins_update_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides
  FOR UPDATE USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'))
  WITH CHECK (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_delete_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides;
CREATE POLICY admins_delete_client_feature_flag_user_overrides
  ON public.client_feature_flag_user_overrides
  FOR DELETE USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

CREATE OR REPLACE FUNCTION public.client_feature_flag_bucket(p_flag text, p_user uuid)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_catalog
AS $$
  WITH digest AS (
    SELECT decode(substr(md5(p_flag || ':' || p_user::text), 1, 8), 'hex') AS bytes
  )
  SELECT (
    (
      get_byte(bytes, 0)::bigint * 16777216 +
      get_byte(bytes, 1)::bigint * 65536 +
      get_byte(bytes, 2)::bigint * 256 +
      get_byte(bytes, 3)::bigint
    ) % 10000
  )::integer
  FROM digest;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_client_feature_flag(
  p_flag text,
  p_user uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag_key text := btrim(coalesce(p_flag, ''));
  v_user uuid := coalesce(p_user, auth.uid());
  v_override boolean;
  v_flag record;
  v_bucket integer;
BEGIN
  IF v_flag_key = '' OR v_user IS NULL THEN
    RETURN false;
  END IF;

  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM v_user THEN
    RETURN false;
  END IF;

  SELECT o.enabled
    INTO v_override
  FROM public.client_feature_flag_user_overrides o
  WHERE o.flag_key = v_flag_key
    AND o.user_id = v_user;

  IF FOUND THEN
    RETURN v_override;
  END IF;

  SELECT f.enabled, f.rollout_bps
    INTO v_flag
  FROM public.client_feature_flags f
  WHERE f.flag_key = v_flag_key;

  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;

  IF v_flag.rollout_bps >= 10000 THEN
    RETURN true;
  END IF;

  IF v_flag.rollout_bps <= 0 THEN
    RETURN false;
  END IF;

  v_bucket := public.client_feature_flag_bucket(v_flag_key, v_user);
  RETURN v_bucket < v_flag.rollout_bps;
END;
$$;

REVOKE ALL ON FUNCTION public.client_feature_flag_bucket(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_feature_flag_bucket(text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.evaluate_client_feature_flag(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_client_feature_flag(text, uuid) TO authenticated, service_role;

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description)
VALUES
  ('media_v2_video', false, 0, 'Routes video uploads through the media SDK when enabled.'),
  ('media_v2_photo', false, 0, 'Routes photo uploads through the media SDK when enabled.'),
  ('media_v2_voice', false, 0, 'Routes voice uploads through the media SDK when enabled.')
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

COMMENT ON TABLE public.client_feature_flags IS
  'Client-consumed feature flags evaluated through evaluate_client_feature_flag.';
COMMENT ON TABLE public.client_feature_flag_user_overrides IS
  'Per-user client feature flag overrides. Overrides win over rollout buckets.';
COMMENT ON FUNCTION public.evaluate_client_feature_flag(text, uuid) IS
  'Evaluates a client feature flag for the current authenticated user: override, then deterministic rollout bucket, default false.';
