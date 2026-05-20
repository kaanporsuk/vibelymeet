-- Client feature flag hardening for media-v2 rollout operations.
--
-- Forward-only hardening on top of 20260519120000_client_feature_flags.sql:
-- - `enabled=false` and `kill_switch_active=true` are hard global kills.
-- - Overrides only apply after the global kill checks.
-- - Detail/batch/debug RPCs expose the actual evaluated source without leaking
--   raw user IDs to analytics.
-- - Admin mutations are reasoned, audited, and managed through RPCs.

ALTER TABLE public.client_feature_flags
  ADD COLUMN IF NOT EXISTS kill_switch_active boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.client_feature_flag_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  before_state jsonb,
  after_state jsonb
);

CREATE TABLE IF NOT EXISTS public.client_feature_flag_override_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL,
  user_id uuid NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  before_state jsonb,
  after_state jsonb
);

CREATE TABLE IF NOT EXISTS public.client_feature_flag_service_evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL,
  evaluated_user_id uuid,
  caller_user_id uuid,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  enabled boolean NOT NULL,
  bucket integer,
  rollout_bps integer
);

CREATE INDEX IF NOT EXISTS idx_client_feature_flag_history_flag_time
  ON public.client_feature_flag_history(flag_key, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_feature_flag_override_history_flag_user_time
  ON public.client_feature_flag_override_history(flag_key, user_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_feature_flag_service_evals_time
  ON public.client_feature_flag_service_evals(evaluated_at DESC);

ALTER TABLE public.client_feature_flag_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_feature_flag_override_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_feature_flag_service_evals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_feature_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_feature_flag_user_overrides FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_feature_flag_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_feature_flag_override_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.client_feature_flag_service_evals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_feature_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_feature_flag_user_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_feature_flag_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_feature_flag_override_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_feature_flag_service_evals TO service_role;

DROP POLICY IF EXISTS admins_select_client_feature_flag_history
  ON public.client_feature_flag_history;
CREATE POLICY admins_select_client_feature_flag_history
  ON public.client_feature_flag_history
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_client_feature_flag_override_history
  ON public.client_feature_flag_override_history;
CREATE POLICY admins_select_client_feature_flag_override_history
  ON public.client_feature_flag_override_history
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_client_feature_flag_service_evals
  ON public.client_feature_flag_service_evals;
CREATE POLICY admins_select_client_feature_flag_service_evals
  ON public.client_feature_flag_service_evals
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

CREATE OR REPLACE FUNCTION public.client_feature_flag_state_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag_key text;
  v_changed_by uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_flag_key := NEW.flag_key;
    v_changed_by := COALESCE(NEW.updated_by, auth.uid());
    INSERT INTO public.client_feature_flag_history (
      flag_key,
      changed_by,
      operation,
      before_state,
      after_state
    ) VALUES (
      v_flag_key,
      v_changed_by,
      TG_OP,
      NULL,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_flag_key := NEW.flag_key;
    v_changed_by := COALESCE(NEW.updated_by, OLD.updated_by, auth.uid());
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      INSERT INTO public.client_feature_flag_history (
        flag_key,
        changed_by,
        operation,
        before_state,
        after_state
      ) VALUES (
        v_flag_key,
        v_changed_by,
        TG_OP,
        to_jsonb(OLD),
        to_jsonb(NEW)
      );
    END IF;
    RETURN NEW;
  END IF;

  v_flag_key := OLD.flag_key;
  v_changed_by := COALESCE(OLD.updated_by, auth.uid());
  INSERT INTO public.client_feature_flag_history (
    flag_key,
    changed_by,
    operation,
    before_state,
    after_state
  ) VALUES (
    v_flag_key,
    v_changed_by,
    TG_OP,
    to_jsonb(OLD),
    NULL
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.client_feature_flag_override_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag_key text;
  v_user_id uuid;
  v_changed_by uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_flag_key := NEW.flag_key;
    v_user_id := NEW.user_id;
    v_changed_by := COALESCE(NEW.updated_by, auth.uid());
    INSERT INTO public.client_feature_flag_override_history (
      flag_key,
      user_id,
      changed_by,
      operation,
      before_state,
      after_state
    ) VALUES (
      v_flag_key,
      v_user_id,
      v_changed_by,
      TG_OP,
      NULL,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_flag_key := NEW.flag_key;
    v_user_id := NEW.user_id;
    v_changed_by := COALESCE(NEW.updated_by, OLD.updated_by, auth.uid());
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      INSERT INTO public.client_feature_flag_override_history (
        flag_key,
        user_id,
        changed_by,
        operation,
        before_state,
        after_state
      ) VALUES (
        v_flag_key,
        v_user_id,
        v_changed_by,
        TG_OP,
        to_jsonb(OLD),
        to_jsonb(NEW)
      );
    END IF;
    RETURN NEW;
  END IF;

  v_flag_key := OLD.flag_key;
  v_user_id := OLD.user_id;
  v_changed_by := COALESCE(OLD.updated_by, auth.uid());
  INSERT INTO public.client_feature_flag_override_history (
    flag_key,
    user_id,
    changed_by,
    operation,
    before_state,
    after_state
  ) VALUES (
    v_flag_key,
    v_user_id,
    v_changed_by,
    TG_OP,
    to_jsonb(OLD),
    NULL
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS client_feature_flags_history
  ON public.client_feature_flags;
CREATE TRIGGER client_feature_flags_history
  AFTER INSERT OR UPDATE OR DELETE ON public.client_feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.client_feature_flag_state_history_trigger();

DROP TRIGGER IF EXISTS client_feature_flag_user_overrides_history
  ON public.client_feature_flag_user_overrides;
CREATE TRIGGER client_feature_flag_user_overrides_history
  AFTER INSERT OR UPDATE OR DELETE ON public.client_feature_flag_user_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.client_feature_flag_override_history_trigger();

CREATE OR REPLACE FUNCTION public.client_feature_flag_user_bucket(p_user uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_catalog
AS $$
  SELECT substr(md5(p_user::text), 1, 12);
$$;

COMMENT ON FUNCTION public.client_feature_flag_bucket(text, uuid) IS
  'Stable per-user-per-flag hash bucket. Flag keys are load-bearing rollout seeds; renaming a flag re-randomizes the rollout population.';

CREATE OR REPLACE FUNCTION public.evaluate_client_feature_flag_detail(
  p_flag text,
  p_user uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag_key text := btrim(coalesce(p_flag, ''));
  v_user uuid := coalesce(p_user, auth.uid());
  v_override boolean;
  v_flag record;
  v_bucket integer;
  v_enabled boolean := false;
  v_source text := 'invalid';
  v_rollout_bps integer;
  v_result jsonb;
BEGIN
  IF v_flag_key = '' OR v_user IS NULL THEN
    RETURN jsonb_build_object(
      'flag', v_flag_key,
      'enabled', false,
      'source', v_source,
      'bucket', NULL,
      'rollout_bps', NULL,
      'user_id_bucket', NULL
    );
  END IF;

  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM v_user THEN
    RETURN jsonb_build_object(
      'flag', v_flag_key,
      'enabled', false,
      'source', 'forbidden',
      'bucket', NULL,
      'rollout_bps', NULL,
      'user_id_bucket', public.client_feature_flag_user_bucket(v_user)
    );
  END IF;

  SELECT f.enabled, f.rollout_bps, f.kill_switch_active
    INTO v_flag
  FROM public.client_feature_flags f
  WHERE f.flag_key = v_flag_key;

  IF NOT FOUND THEN
    v_source := 'missing';
  ELSIF v_flag.kill_switch_active THEN
    v_source := 'kill_switched';
    v_rollout_bps := v_flag.rollout_bps;
  ELSIF NOT v_flag.enabled THEN
    v_source := 'disabled';
    v_rollout_bps := v_flag.rollout_bps;
  ELSE
    v_rollout_bps := v_flag.rollout_bps;

    SELECT o.enabled
      INTO v_override
    FROM public.client_feature_flag_user_overrides o
    WHERE o.flag_key = v_flag_key
      AND o.user_id = v_user;

    IF FOUND THEN
      v_enabled := v_override;
      v_source := 'override';
    ELSIF v_flag.rollout_bps >= 10000 THEN
      v_enabled := true;
      v_source := 'rollout';
      v_bucket := 0;
    ELSIF v_flag.rollout_bps <= 0 THEN
      v_enabled := false;
      v_source := 'rollout';
      v_bucket := public.client_feature_flag_bucket(v_flag_key, v_user);
    ELSE
      v_bucket := public.client_feature_flag_bucket(v_flag_key, v_user);
      v_enabled := v_bucket < v_flag.rollout_bps;
      v_source := 'rollout';
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'flag', v_flag_key,
    'enabled', v_enabled,
    'source', v_source,
    'bucket', v_bucket,
    'rollout_bps', v_rollout_bps,
    'user_id_bucket', public.client_feature_flag_user_bucket(v_user)
  );

  IF auth.role() = 'service_role' AND auth.uid() IS DISTINCT FROM v_user THEN
    INSERT INTO public.client_feature_flag_service_evals (
      flag_key,
      evaluated_user_id,
      caller_user_id,
      source,
      enabled,
      bucket,
      rollout_bps
    ) VALUES (
      v_flag_key,
      v_user,
      auth.uid(),
      v_source,
      v_enabled,
      v_bucket,
      v_rollout_bps
    );
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_client_feature_flag(
  p_flag text,
  p_user uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE((public.evaluate_client_feature_flag_detail(p_flag, p_user) ->> 'enabled')::boolean, false);
$$;

CREATE OR REPLACE FUNCTION public.evaluate_client_feature_flags(
  p_flag_keys text[],
  p_user uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flags text[] := COALESCE(p_flag_keys, ARRAY[]::text[]);
  v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(public.evaluate_client_feature_flag_detail(flag_key, p_user)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT DISTINCT btrim(flag_key) AS flag_key
    FROM unnest(v_flags) AS input_flag(flag_key)
    WHERE btrim(flag_key) <> ''
  ) flags;

  RETURN jsonb_build_object(
    'success', true,
    'flags', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_all_client_feature_flags(
  p_user uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flags text[];
BEGIN
  SELECT COALESCE(array_agg(flag_key ORDER BY flag_key), ARRAY[]::text[])
    INTO v_flags
  FROM public.client_feature_flags;

  RETURN public.evaluate_client_feature_flags(v_flags, p_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_client_feature_flags()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'flag_key', f.flag_key,
      'enabled', f.enabled,
      'kill_switch_active', f.kill_switch_active,
      'rollout_bps', f.rollout_bps,
      'description', f.description,
      'updated_by', f.updated_by,
      'updated_at', f.updated_at,
      'override_count', COALESCE(o.override_count, 0)
    )
    ORDER BY f.flag_key
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.client_feature_flags f
  LEFT JOIN (
    SELECT flag_key, count(*)::integer AS override_count
    FROM public.client_feature_flag_user_overrides
    GROUP BY flag_key
  ) o ON o.flag_key = f.flag_key;

  RETURN public.admin_json_success(jsonb_build_object('rows', v_rows));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_client_feature_flag(
  p_flag text,
  p_enabled boolean,
  p_rollout_bps integer,
  p_kill_switch_active boolean,
  p_description text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_flag_key text := btrim(coalesce(p_flag, ''));
  v_before public.client_feature_flags%ROWTYPE;
  v_after public.client_feature_flags%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;
  IF v_flag_key = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Flag key is required.');
  END IF;
  IF v_reason = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A reason is required.');
  END IF;
  IF p_rollout_bps IS NULL OR p_rollout_bps < 0 OR p_rollout_bps > 10000 THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Rollout must be between 0 and 10000 basis points.');
  END IF;

  SELECT * INTO v_before
  FROM public.client_feature_flags
  WHERE flag_key = v_flag_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Client feature flag was not found.');
  END IF;

  UPDATE public.client_feature_flags
  SET enabled = COALESCE(p_enabled, enabled),
      rollout_bps = p_rollout_bps,
      kill_switch_active = COALESCE(p_kill_switch_active, kill_switch_active),
      description = COALESCE(p_description, description),
      updated_by = v_admin_id,
      updated_at = now()
  WHERE flag_key = v_flag_key
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'client_feature_flag.update',
    'client_feature_flag',
    NULL,
    jsonb_build_object(
      'flag_key', v_flag_key,
      'reason', v_reason,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after)
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'flag', to_jsonb(v_after),
    'audit_log_id', v_audit_id
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_client_feature_flag_overrides(
  p_flag text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_flag_key text := NULLIF(btrim(coalesce(p_flag, '')), '');
  v_search text := NULLIF(btrim(coalesce(p_search, '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_rows jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.updated_at DESC, rows.flag_key, rows.user_id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.flag_key,
      o.user_id,
      o.enabled,
      o.reason,
      o.updated_by,
      o.updated_at,
      p.name AS user_name,
      au.email AS user_email
    FROM public.client_feature_flag_user_overrides o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    LEFT JOIN auth.users au ON au.id = o.user_id
    WHERE (v_flag_key IS NULL OR o.flag_key = v_flag_key)
      AND (
        v_search IS NULL
        OR o.user_id::text = v_search
        OR p.name ILIKE '%' || v_search || '%'
        OR au.email ILIKE '%' || v_search || '%'
      )
    ORDER BY o.updated_at DESC, o.flag_key, o.user_id
    LIMIT v_limit
  ) rows;

  RETURN public.admin_json_success(jsonb_build_object('rows', v_rows));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_client_feature_flag_override(
  p_flag text,
  p_user_id uuid,
  p_enabled boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_flag_key text := btrim(coalesce(p_flag, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before public.client_feature_flag_user_overrides%ROWTYPE;
  v_after public.client_feature_flag_user_overrides%ROWTYPE;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;
  IF v_flag_key = '' OR p_user_id IS NULL OR p_enabled IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Flag, user, and enabled value are required.');
  END IF;
  IF v_reason = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A reason is required.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_feature_flags WHERE flag_key = v_flag_key) THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Client feature flag was not found.');
  END IF;

  SELECT * INTO v_before
  FROM public.client_feature_flag_user_overrides
  WHERE flag_key = v_flag_key
    AND user_id = p_user_id
  FOR UPDATE;

  INSERT INTO public.client_feature_flag_user_overrides (
    flag_key,
    user_id,
    enabled,
    reason,
    updated_by,
    updated_at
  ) VALUES (
    v_flag_key,
    p_user_id,
    p_enabled,
    v_reason,
    v_admin_id,
    now()
  )
  ON CONFLICT (flag_key, user_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'client_feature_flag.override_upsert',
    'client_feature_flag',
    NULL,
    jsonb_build_object(
      'flag_key', v_flag_key,
      'user_id', p_user_id,
      'reason', v_reason,
      'before', CASE WHEN v_before.flag_key IS NULL THEN NULL ELSE to_jsonb(v_before) END,
      'after', to_jsonb(v_after)
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'override', to_jsonb(v_after),
    'audit_log_id', v_audit_id
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_client_feature_flag_override(
  p_flag text,
  p_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_flag_key text := btrim(coalesce(p_flag, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before public.client_feature_flag_user_overrides%ROWTYPE;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;
  IF v_flag_key = '' OR p_user_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Flag and user are required.');
  END IF;
  IF v_reason = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A reason is required.');
  END IF;

  SELECT * INTO v_before
  FROM public.client_feature_flag_user_overrides
  WHERE flag_key = v_flag_key
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Client feature flag override was not found.');
  END IF;

  DELETE FROM public.client_feature_flag_user_overrides
  WHERE flag_key = v_flag_key
    AND user_id = p_user_id;

  v_audit_id := public.log_admin_action(
    'client_feature_flag.override_delete',
    'client_feature_flag',
    NULL,
    jsonb_build_object(
      'flag_key', v_flag_key,
      'user_id', p_user_id,
      'reason', v_reason,
      'before', to_jsonb(v_before)
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'deleted', true,
    'audit_log_id', v_audit_id
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.client_feature_flag_user_bucket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_feature_flag_user_bucket(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.evaluate_client_feature_flag_detail(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_client_feature_flags(text[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_all_client_feature_flags(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_client_feature_flag(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_client_feature_flag_detail(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_client_feature_flags(text[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_all_client_feature_flags(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_client_feature_flag(text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_list_client_feature_flags() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_client_feature_flag(text, boolean, integer, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_client_feature_flag_overrides(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_client_feature_flag_override(text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_client_feature_flag_override(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_client_feature_flags() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_client_feature_flag(text, boolean, integer, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_client_feature_flag_overrides(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_client_feature_flag_override(text, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_client_feature_flag_override(text, uuid, text) TO authenticated;

COMMENT ON COLUMN public.client_feature_flags.kill_switch_active IS
  'Hard emergency kill switch. When true, evaluate_client_feature_flag returns false before consulting per-user overrides.';
COMMENT ON TABLE public.client_feature_flag_history IS
  'Auditable before/after history for client feature flag configuration changes.';
COMMENT ON TABLE public.client_feature_flag_override_history IS
  'Auditable before/after history for per-user client feature flag override changes.';
COMMENT ON TABLE public.client_feature_flag_service_evals IS
  'Audit trail for service-role feature flag evaluations on behalf of another user.';
COMMENT ON FUNCTION public.evaluate_client_feature_flag_detail(text, uuid) IS
  'Evaluates a client feature flag with source metadata: hard kill, disabled, override, rollout, or default false.';
COMMENT ON FUNCTION public.evaluate_client_feature_flags(text[], uuid) IS
  'Batch client feature flag evaluation for session warmup and upload-start gating.';
COMMENT ON FUNCTION public.evaluate_all_client_feature_flags(uuid) IS
  'Debug helper returning all configured client feature flags for the current user.';
