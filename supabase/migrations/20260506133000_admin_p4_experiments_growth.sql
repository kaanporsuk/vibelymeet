-- P4 experimentation and growth attribution.
--
-- Migration class: schema + RPC + policy.
-- Intent: backend-owned experiment assignment/exposure and durable growth
-- attribution. No rewards, spam loops, or product-state overrides.

-- ─────────────────────────────────────────────────────────────────────────────
-- Experimentation primitives
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feature_flags (
  flag_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_key_not_blank CHECK (btrim(flag_key) <> '')
);

CREATE TABLE IF NOT EXISTS public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_key text NOT NULL UNIQUE,
  name text NOT NULL,
  hypothesis text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT 'product',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'paused', 'ended', 'killed')),
  seed text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'),
  rollout_percentage integer NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiments_key_not_blank CHECK (btrim(experiment_key) <> '')
);

CREATE TABLE IF NOT EXISTS public.experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  label text NOT NULL,
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, variant_key)
);

CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.experiment_variants(id) ON DELETE CASCADE,
  bucket integer NOT NULL CHECK (bucket BETWEEN 0 AND 9999),
  context_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.experiment_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.experiment_variants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface text NOT NULL,
  context_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  exposed_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Growth attribution primitives
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.growth_attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_token_hash text,
  referrer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('landing', 'invite_click', 'event_share_click', 'signup_seen', 'claim_attempt')),
  surface text NOT NULL DEFAULT 'unknown',
  context_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invite_attribution_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referrer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  referral_token_hash text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'already_set', 'self', 'invalid', 'missing_profile', 'failed')),
  context_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)
);

CREATE TABLE IF NOT EXISTS public.referral_quality_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  invite_clicks integer NOT NULL DEFAULT 0,
  referred_signups integer NOT NULL DEFAULT 0,
  activated_users integer NOT NULL DEFAULT 0,
  retained_users integer NOT NULL DEFAULT 0,
  matched_users integer NOT NULL DEFAULT 0,
  safety_events integer NOT NULL DEFAULT 0,
  quality_score integer NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_attribution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_attribution_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_quality_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_select_feature_flags ON public.feature_flags;
CREATE POLICY admins_select_feature_flags ON public.feature_flags
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_experiments ON public.experiments;
CREATE POLICY admins_select_experiments ON public.experiments
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_experiment_variants ON public.experiment_variants;
CREATE POLICY admins_select_experiment_variants ON public.experiment_variants
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_experiment_assignments ON public.experiment_assignments;
CREATE POLICY admins_select_experiment_assignments ON public.experiment_assignments
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_experiment_exposures ON public.experiment_exposures;
CREATE POLICY admins_select_experiment_exposures ON public.experiment_exposures
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'experiments.manage'));

DROP POLICY IF EXISTS admins_select_growth_attribution_events ON public.growth_attribution_events;
CREATE POLICY admins_select_growth_attribution_events ON public.growth_attribution_events
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'growth.read'));

DROP POLICY IF EXISTS admins_select_invite_attribution_claims ON public.invite_attribution_claims;
CREATE POLICY admins_select_invite_attribution_claims ON public.invite_attribution_claims
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'growth.read'));

DROP POLICY IF EXISTS admins_select_referral_quality_snapshots ON public.referral_quality_snapshots;
CREATE POLICY admins_select_referral_quality_snapshots ON public.referral_quality_snapshots
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'growth.read'));

CREATE INDEX IF NOT EXISTS idx_experiment_exposures_experiment_time
  ON public.experiment_exposures(experiment_id, exposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_attribution_events_ref_token_time
  ON public.growth_attribution_events(referral_token_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invite_attribution_claims_referrer
  ON public.invite_attribution_claims(referrer_id, claimed_at DESC);

DROP TRIGGER IF EXISTS feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS experiments_updated_at ON public.experiments;
CREATE TRIGGER experiments_updated_at
  BEFORE UPDATE ON public.experiments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Experiment RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_p4_context_summary(p_context jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'platform', NULLIF(p_context ->> 'platform', ''),
    'city', NULLIF(p_context ->> 'city', ''),
    'surface', NULLIF(p_context ->> 'surface', ''),
    'event_id', NULLIF(p_context ->> 'event_id', ''),
    'is_premium', CASE
      WHEN lower(COALESCE(p_context ->> 'is_premium', '')) IN ('true', 'false') THEN (p_context ->> 'is_premium')::boolean
      ELSE NULL
    END
  ));
$$;

CREATE OR REPLACE FUNCTION public.resolve_experiment_assignment(
  p_experiment_key text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_experiment public.experiments%ROWTYPE;
  v_existing record;
  v_bucket integer;
  v_total_weight integer;
  v_position integer;
  v_variant record;
  v_acc integer := 0;
  v_context jsonb := public.admin_p4_context_summary(COALESCE(p_context, '{}'::jsonb));
  v_platform text := NULLIF(p_context ->> 'platform', '');
  v_city text := NULLIF(p_context ->> 'city', '');
  v_assignment_id uuid;
  v_segment text := COALESCE(
    p_context ->> 'premium_segment',
    CASE WHEN lower(COALESCE(p_context ->> 'is_premium', '')) = 'true' THEN 'premium' ELSE 'free' END
  );
BEGIN
  IF v_user_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Experiment assignment requires a signed-in user.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_experiment_key, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Experiment key is required.');
  END IF;

  SELECT * INTO v_experiment
  FROM public.experiments
  WHERE experiment_key = p_experiment_key;

  IF NOT FOUND OR v_experiment.status <> 'running' THEN
    RETURN public.admin_json_success(jsonb_build_object(
      'experiment_key', p_experiment_key,
      'enrolled', false,
      'reason', CASE WHEN FOUND THEN 'not_running' ELSE 'not_found' END
    ));
  END IF;

  IF v_experiment.starts_at IS NOT NULL AND v_experiment.starts_at > now() THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'not_started'));
  END IF;
  IF v_experiment.ends_at IS NOT NULL AND v_experiment.ends_at <= now() THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'ended'));
  END IF;

  IF jsonb_typeof(v_experiment.targeting -> 'platforms') = 'array'
     AND v_platform IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_experiment.targeting -> 'platforms') t(value) WHERE t.value = v_platform) THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'platform_not_targeted'));
  END IF;

  IF jsonb_typeof(v_experiment.targeting -> 'cities') = 'array'
     AND v_city IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_experiment.targeting -> 'cities') t(value) WHERE lower(t.value) = lower(v_city)) THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'city_not_targeted'));
  END IF;

  IF COALESCE(v_experiment.targeting ->> 'premium_segment', 'all') <> 'all'
     AND COALESCE(v_experiment.targeting ->> 'premium_segment', 'all') <> v_segment THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'segment_not_targeted'));
  END IF;

  SELECT ea.id, ev.variant_key, ev.payload, ea.bucket
  INTO v_existing
  FROM public.experiment_assignments ea
  JOIN public.experiment_variants ev ON ev.id = ea.variant_id
  WHERE ea.experiment_id = v_experiment.id
    AND ea.user_id = v_user_id;

  IF FOUND THEN
    RETURN public.admin_json_success(jsonb_build_object(
      'experiment_key', p_experiment_key,
      'enrolled', true,
      'variant_key', v_existing.variant_key,
      'payload', v_existing.payload,
      'bucket', v_existing.bucket,
      'existing_assignment', true
    ));
  END IF;

  v_bucket := (abs(hashtext(v_user_id::text || ':' || p_experiment_key || ':' || v_experiment.seed)::bigint) % 10000)::integer;
  IF v_bucket >= v_experiment.rollout_percentage * 100 THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'outside_rollout', 'bucket', v_bucket));
  END IF;

  SELECT COALESCE(sum(weight), 0)::integer
  INTO v_total_weight
  FROM public.experiment_variants
  WHERE experiment_id = v_experiment.id;

  IF v_total_weight <= 0 THEN
    RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'no_variants'));
  END IF;

  v_position := (abs(hashtext(v_user_id::text || ':' || p_experiment_key || ':' || v_experiment.seed || ':variant')::bigint) % v_total_weight)::integer;

  FOR v_variant IN
    SELECT * FROM public.experiment_variants
    WHERE experiment_id = v_experiment.id
    ORDER BY variant_key
  LOOP
    v_acc := v_acc + v_variant.weight;
    IF v_position < v_acc THEN
      INSERT INTO public.experiment_assignments (
        experiment_id,
        user_id,
        variant_id,
        bucket,
        context_summary
      ) VALUES (
        v_experiment.id,
        v_user_id,
        v_variant.id,
        v_bucket,
        v_context
      )
      ON CONFLICT (experiment_id, user_id) DO NOTHING
      RETURNING id INTO v_assignment_id;

      IF v_assignment_id IS NULL THEN
        SELECT ea.id, ev.variant_key, ev.payload, ea.bucket
        INTO v_existing
        FROM public.experiment_assignments ea
        JOIN public.experiment_variants ev ON ev.id = ea.variant_id
        WHERE ea.experiment_id = v_experiment.id
          AND ea.user_id = v_user_id;

        RETURN public.admin_json_success(jsonb_build_object(
          'experiment_key', p_experiment_key,
          'enrolled', true,
          'variant_key', v_existing.variant_key,
          'payload', v_existing.payload,
          'bucket', v_existing.bucket,
          'existing_assignment', true
        ));
      END IF;

      RETURN public.admin_json_success(jsonb_build_object(
        'experiment_key', p_experiment_key,
        'enrolled', true,
        'variant_key', v_variant.variant_key,
        'payload', v_variant.payload,
        'bucket', v_bucket,
        'existing_assignment', false
      ));
    END IF;
  END LOOP;

  RETURN public.admin_json_success(jsonb_build_object('experiment_key', p_experiment_key, 'enrolled', false, 'reason', 'variant_selection_failed'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_experiment_exposure(
  p_experiment_key text,
  p_variant_key text,
  p_surface text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_experiment_id uuid;
  v_variant_id uuid;
  v_surface text := NULLIF(btrim(COALESCE(p_surface, '')), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Experiment exposure requires a signed-in user.');
  END IF;
  IF v_surface IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Exposure surface is required.');
  END IF;
  IF v_surface !~ '^[a-zA-Z0-9_.:/-]{1,64}$' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Exposure surface must be a stable non-PII token.');
  END IF;

  SELECT e.id, ev.id
  INTO v_experiment_id, v_variant_id
  FROM public.experiments e
  JOIN public.experiment_variants ev ON ev.experiment_id = e.id
  WHERE e.experiment_key = p_experiment_key
    AND ev.variant_key = p_variant_key;

  IF v_experiment_id IS NULL OR v_variant_id IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Experiment variant was not found.');
  END IF;

  INSERT INTO public.experiment_exposures (
    experiment_id,
    variant_id,
    user_id,
    surface,
    context_summary
  ) VALUES (
    v_experiment_id,
    v_variant_id,
    v_user_id,
    v_surface,
    public.admin_p4_context_summary(COALESCE(p_context, '{}'::jsonb))
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'experiment_key', p_experiment_key,
    'variant_key', p_variant_key,
    'exposed', true
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_experiment_metrics(p_experiment_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_experiment public.experiments%ROWTYPE;
  v_variants jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;

  SELECT * INTO v_experiment
  FROM public.experiments
  WHERE experiment_key = p_experiment_key;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Experiment was not found.');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'variant_key', ev.variant_key,
      'label', ev.label,
      'weight', ev.weight,
      'assignments', COALESCE(a.assignment_count, 0),
      'exposures', COALESCE(x.exposure_count, 0)
    )
    ORDER BY ev.variant_key
  ), '[]'::jsonb)
  INTO v_variants
  FROM public.experiment_variants ev
  LEFT JOIN (
    SELECT variant_id, count(*)::integer AS assignment_count
    FROM public.experiment_assignments
    WHERE experiment_id = v_experiment.id
    GROUP BY variant_id
  ) a ON a.variant_id = ev.id
  LEFT JOIN (
    SELECT variant_id, count(*)::integer AS exposure_count
    FROM public.experiment_exposures
    WHERE experiment_id = v_experiment.id
    GROUP BY variant_id
  ) x ON x.variant_id = ev.id
  WHERE ev.experiment_id = v_experiment.id;

  RETURN public.admin_json_success(jsonb_build_object(
    'experiment', to_jsonb(v_experiment),
    'variants', v_variants,
    'semantics', 'Assignments are backend-owned and stable by user, experiment key, and seed. Exposures must be explicitly recorded by clients.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_experiment_status(
  p_experiment_key text,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.experiments%ROWTYPE;
  v_after public.experiments%ROWTYPE;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'experiments.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Experiment management permission is required.');
  END IF;
  IF p_status NOT IN ('draft', 'running', 'paused', 'ended', 'killed') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Invalid experiment status.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A reason is required.');
  END IF;

  SELECT * INTO v_before
  FROM public.experiments
  WHERE experiment_key = p_experiment_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Experiment was not found.');
  END IF;

  UPDATE public.experiments
  SET status = p_status,
      updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'experiment.status_update',
    'experiment',
    v_after.id,
    jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'experiment_key', p_experiment_key,
    'status', p_status,
    'audit_log_id', v_audit_id
  ));
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Growth attribution RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_growth_attribution_event(
  p_referral_token text DEFAULT NULL,
  p_event_type text DEFAULT 'landing',
  p_surface text DEFAULT 'unknown',
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_referrer_id uuid;
  v_token text := NULLIF(btrim(COALESCE(p_referral_token, '')), '');
  v_hash text;
  v_surface text := COALESCE(NULLIF(btrim(p_surface), ''), 'unknown');
BEGIN
  IF p_event_type NOT IN ('landing', 'invite_click', 'event_share_click', 'signup_seen', 'claim_attempt') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Invalid growth attribution event type.');
  END IF;

  IF v_token IS NOT NULL THEN
    IF v_token !~ '^[a-zA-Z0-9_.:/-]{1,128}$' THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Referral token must be an opaque non-PII token.');
    END IF;
    v_hash := md5(v_token);
    IF v_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_referrer_id := v_token::uuid;
    END IF;
  END IF;

  IF v_surface !~ '^[a-zA-Z0-9_.:/-]{1,64}$' THEN
    v_surface := 'unknown';
  END IF;

  INSERT INTO public.growth_attribution_events (
    referral_token_hash,
    referrer_id,
    user_id,
    event_type,
    surface,
    context_summary
  ) VALUES (
    v_hash,
    v_referrer_id,
    auth.uid(),
    p_event_type,
    v_surface,
    public.admin_p4_context_summary(COALESCE(p_context, '{}'::jsonb))
  );

  RETURN public.admin_json_success(jsonb_build_object('recorded', true));
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_growth_attribution(
  p_referral_token text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_referrer_id uuid;
  v_hash text;
  v_apply jsonb;
  v_status text := 'invalid';
BEGIN
  IF v_user_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Referral claim requires a signed-in user.');
  END IF;
  IF p_referral_token IS NULL OR p_referral_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Referral token is invalid.');
  END IF;

  v_referrer_id := p_referral_token::uuid;
  v_hash := md5(p_referral_token);
  v_apply := public.apply_referral_attribution(v_referrer_id);
  v_status := COALESCE(v_apply ->> 'status', 'failed');

  INSERT INTO public.invite_attribution_claims (
    referred_user_id,
    referrer_id,
    referral_token_hash,
    status,
    context_summary
  ) VALUES (
    v_user_id,
    v_referrer_id,
    v_hash,
    CASE
      WHEN v_status = 'applied' THEN 'applied'
      WHEN v_status = 'already-set' THEN 'already_set'
      WHEN v_status IN ('self', 'invalid', 'missing-profile') THEN replace(v_status, '-', '_')
      ELSE 'failed'
    END,
    public.admin_p4_context_summary(COALESCE(p_context, '{}'::jsonb))
  )
  ON CONFLICT (referred_user_id) DO UPDATE
  SET status = EXCLUDED.status,
      context_summary = EXCLUDED.context_summary,
      claimed_at = now();

  RETURN public.admin_json_success(jsonb_build_object(
    'claim_status', v_status,
    'referrer_id', v_referrer_id,
    'applied_referral_result', v_apply
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_p4_context_summary(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_experiment_assignment(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_experiment_exposure(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_experiment_metrics(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_experiment_status(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_growth_attribution_event(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_growth_attribution(text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_experiment_assignment(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_experiment_exposure(text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_experiment_metrics(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_experiment_status(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_growth_attribution_event(text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_growth_attribution(text, jsonb) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260506133000',
  'P4 experiments and growth attribution',
  'schema+policy',
  'Adds stable experiment assignment/exposure and growth attribution. No rewards, user-facing ranking changes, or provider changes.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.resolve_experiment_assignment(text, jsonb) IS
  'P4 backend-owned stable experiment assignment. Uses auth.uid(), experiment key, and seed; no client-passed user id.';
COMMENT ON FUNCTION public.record_growth_attribution_event(text, text, text, jsonb) IS
  'P4 growth attribution capture with opaque referral token hashing and allowlisted context only.';
