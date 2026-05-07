-- P3 /kaan operations foundation.
--
-- Migration class: schema + RPC + policy + reference data.
-- Intent: add read-only production operations, provider reconciliation,
-- audit exploration, permissions, and rebuild-governance primitives.
-- No destructive data rewrite, provider mutation, or repair action is performed.

-- ─────────────────────────────────────────────────────────────────────────────
-- Permission and governance primitives
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_permissions (
  permission text PRIMARY KEY,
  area text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  is_break_glass boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_permissions_permission_not_blank CHECK (btrim(permission) <> ''),
  CONSTRAINT admin_permissions_area_not_blank CHECK (btrim(area) <> '')
);

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role public.app_role NOT NULL,
  permission text NOT NULL REFERENCES public.admin_permissions(permission) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS public.migration_classifications (
  migration_version text PRIMARY KEY,
  title text NOT NULL,
  classification text NOT NULL
    CHECK (classification IN ('schema-only', 'schema+policy', 'data-backfill', 'operational-test', 'destructive')),
  risk_notes text NOT NULL DEFAULT '',
  destructive_requires_signoff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_classifications_version_not_blank CHECK (btrim(migration_version) <> ''),
  CONSTRAINT migration_classifications_title_not_blank CHECK (btrim(title) <> '')
);

CREATE TABLE IF NOT EXISTS public.rebuild_rehearsal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'passed', 'failed', 'blocked')),
  scope text NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rebuild_rehearsal_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_select_admin_permissions" ON public.admin_permissions;
CREATE POLICY "admins_select_admin_permissions"
  ON public.admin_permissions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins_select_admin_role_permissions" ON public.admin_role_permissions;
CREATE POLICY "admins_select_admin_role_permissions"
  ON public.admin_role_permissions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins_select_migration_classifications" ON public.migration_classifications;
CREATE POLICY "admins_select_migration_classifications"
  ON public.migration_classifications
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins_select_rebuild_rehearsal_runs" ON public.rebuild_rehearsal_runs;
CREATE POLICY "admins_select_rebuild_rehearsal_runs"
  ON public.rebuild_rehearsal_runs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.admin_permissions (permission, area, label, description, is_break_glass)
VALUES
  ('admin.super', 'Governance', 'Super admin', 'Full administrative authority including break-glass governance.', true),
  ('ops.read', 'Operations', 'Read operations health', 'View production health, incident signals, and provider reconciliation summaries.', false),
  ('ops.repair', 'Operations', 'Run operational repairs', 'Run confirmed and audited production repair actions.', true),
  ('providers.read', 'Providers', 'Read provider health', 'View app-layer provider reconciliation and telemetry health.', false),
  ('providers.repair', 'Providers', 'Repair provider drift', 'Run confirmed and audited provider drift repairs.', true),
  ('audit.read', 'Audit', 'Read audit logs', 'Search admin activity logs for incident reconstruction.', false),
  ('audit.export', 'Audit', 'Export audit slices', 'Create scoped and audited incident evidence exports.', false),
  ('rebuild.read', 'Rebuild', 'Read rebuild state', 'View migration classification, function inventory, and rebuild rehearsal state.', false),
  ('rebuild.manage', 'Rebuild', 'Manage rebuild governance', 'Record rebuild rehearsals and migration governance metadata.', true),
  ('exports.create', 'Exports', 'Create governed exports', 'Create reasoned and audited operational exports.', false),
  ('roles.manage', 'Governance', 'Manage admin permissions', 'Assign and review administrative permissions.', true)
ON CONFLICT (permission) DO UPDATE
SET area = EXCLUDED.area,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_break_glass = EXCLUDED.is_break_glass;

INSERT INTO public.admin_role_permissions (role, permission)
VALUES
  ('admin'::public.app_role, 'admin.super'),
  ('admin'::public.app_role, 'ops.read'),
  ('admin'::public.app_role, 'ops.repair'),
  ('admin'::public.app_role, 'providers.read'),
  ('admin'::public.app_role, 'providers.repair'),
  ('admin'::public.app_role, 'audit.read'),
  ('admin'::public.app_role, 'audit.export'),
  ('admin'::public.app_role, 'rebuild.read'),
  ('admin'::public.app_role, 'rebuild.manage'),
  ('admin'::public.app_role, 'exports.create'),
  ('admin'::public.app_role, 'roles.manage'),
  ('moderator'::public.app_role, 'audit.read')
ON CONFLICT (role, permission) DO NOTHING;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES
  (
    '20260506103000',
    'P2 admin backend-authoritative hardening',
    'schema+policy',
    'Adds transactional admin RPCs, admin idempotency, audit logging, and read RPCs. No destructive data rewrite.',
    false
  ),
  (
    '20260506120000',
    'P3 admin operations foundation',
    'schema+policy',
    'Adds read-only operations health, provider reconciliation summaries, audit explorer RPC, permissions, and governance tables.',
    false
  )
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON TABLE public.admin_permissions IS
  'P3 least-privilege admin permission catalog. Reference data only; no user production state.';
COMMENT ON TABLE public.admin_role_permissions IS
  'P3 mapping from existing app_role values to admin operation permissions.';
COMMENT ON TABLE public.migration_classifications IS
  'P3 rebuild-governance manifest for migration replay risk classification.';
COMMENT ON TABLE public.rebuild_rehearsal_runs IS
  'P3 rebuild rehearsal ledger. Records operational proof that Vibely can be rebuilt from documented inputs.';

-- ─────────────────────────────────────────────────────────────────────────────
-- P2 read-surface alignment
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_search text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'created_at_desc',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
  v_gender_bucket text := NULLIF(btrim(COALESCE(p_filters ->> 'gender_bucket', '')), '');
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  WITH filtered AS (
    SELECT p.*
    FROM public.profiles p
    WHERE (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR p.name ILIKE '%' || p_search || '%'
        OR p.location ILIKE '%' || p_search || '%'
      )
      AND (
        p_filters ->> 'photo_verified' IS NULL
        OR p.photo_verified IS NOT DISTINCT FROM (p_filters ->> 'photo_verified')::boolean
      )
      AND (
        p_filters ->> 'is_suspended' IS NULL
        OR p.is_suspended IS NOT DISTINCT FROM (p_filters ->> 'is_suspended')::boolean
      )
      AND (
        p_filters ->> 'gender' IS NULL
        OR p.gender = p_filters ->> 'gender'
      )
      AND (
        v_gender_bucket IS NULL
        OR (
          v_gender_bucket = 'man'
          AND lower(COALESCE(p.gender, '')) IN ('man', 'male')
        )
        OR (
          v_gender_bucket = 'woman'
          AND lower(COALESCE(p.gender, '')) IN ('woman', 'female')
        )
        OR (
          v_gender_bucket = 'non-binary'
          AND lower(COALESCE(p.gender, '')) IN ('non-binary', 'non_binary')
        )
        OR (
          v_gender_bucket = 'other'
          AND (
            NULLIF(btrim(COALESCE(p.gender, '')), '') IS NULL
            OR lower(COALESCE(p.gender, '')) NOT IN ('man', 'male', 'woman', 'female', 'non-binary', 'non_binary')
          )
        )
      )
      AND (
        p_filters -> 'relationship_intents' IS NULL
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p_filters -> 'relationship_intents') intent(value)
          WHERE p.relationship_intent = intent.value
             OR p.looking_for = intent.value
        )
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total_count FROM filtered
  ),
  enriched AS (
    SELECT
      p.id,
      p.name,
      p.age,
      p.gender,
      p.birth_date,
      p.location,
      p.height_cm,
      p.looking_for,
      p.relationship_intent,
      p.avatar_url,
      p.photos,
      p.email_verified,
      p.photo_verified,
      p.is_premium,
      p.is_suspended,
      p.created_at,
      p.updated_at,
      p.total_matches,
      COALESCE(reg.registration_count, 0) AS event_registrations,
      COALESCE(reg.attended_count, 0) AS confirmed_attendance,
      COALESCE(vibes.vibes, '[]'::jsonb) AS vibes
    FROM filtered p
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS registration_count,
        count(*) FILTER (WHERE er.attendance_marked IS TRUE OR er.attended IS TRUE)::integer AS attended_count
      FROM public.event_registrations er
      WHERE er.profile_id = p.id
    ) reg ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', vt.label, 'emoji', vt.emoji)), '[]'::jsonb) AS vibes
      FROM public.profile_vibes pv
      JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
      WHERE pv.profile_id = p.id
    ) vibes ON true
  ),
  ranked AS (
    SELECT
      e.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'name_asc' THEN e.name END ASC NULLS LAST,
          CASE WHEN p_sort = 'name_desc' THEN e.name END DESC NULLS LAST,
          CASE WHEN p_sort = 'age_asc' THEN e.age END ASC NULLS LAST,
          CASE WHEN p_sort = 'age_desc' THEN e.age END DESC NULLS LAST,
          CASE WHEN p_sort = 'location_asc' THEN e.location END ASC NULLS LAST,
          CASE WHEN p_sort = 'location_desc' THEN e.location END DESC NULLS LAST,
          CASE WHEN p_sort = 'total_matches_asc' THEN e.total_matches END ASC NULLS LAST,
          CASE WHEN p_sort = 'total_matches_desc' THEN e.total_matches END DESC NULLS LAST,
          CASE WHEN p_sort = 'registrations_asc' THEN e.event_registrations END ASC,
          CASE WHEN p_sort = 'registrations_desc' THEN e.event_registrations END DESC,
          CASE WHEN p_sort = 'created_at_asc' THEN e.created_at END ASC,
          e.created_at DESC
      ) AS sort_index
    FROM enriched e
  ),
  page AS (
    SELECT *
    FROM ranked
    ORDER BY
      sort_index
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    COALESCE((SELECT total_count FROM counted), 0),
    COALESCE(jsonb_agg(to_jsonb(page) - 'sort_index' ORDER BY page.sort_index), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'registration_semantics', 'event_registrations counts event_registrations rows; confirmed_attendance uses explicit attendance markers only.',
    'filter_semantics', 'gender_bucket and relationship_intents mirror /kaan Users panel filters server-side.'
  ));
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permission helpers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_user_has_permission(
  p_user_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND NULLIF(btrim(COALESCE(p_permission, '')), '') IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.admin_role_permissions arp ON arp.role = ur.role
        WHERE ur.user_id = p_user_id
          AND arp.permission = 'admin.super'
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.admin_role_permissions arp ON arp.role = ur.role
        WHERE ur.user_id = p_user_id
          AND arp.permission = p_permission
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_has_permission(p_permission text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  v_allowed := public.admin_user_has_permission(v_admin_id, p_permission);

  RETURN public.admin_json_success(jsonb_build_object(
    'permission', p_permission,
    'allowed', v_allowed
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_admin_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_roles text[];
  v_permissions text[];
  v_catalog jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'ops.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Operations permission is required.');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT role::text ORDER BY role::text), ARRAY[]::text[])
  INTO v_roles
  FROM public.user_roles
  WHERE user_id = v_admin_id;

  IF public.admin_user_has_permission(v_admin_id, 'admin.super') THEN
    SELECT COALESCE(array_agg(permission ORDER BY permission), ARRAY[]::text[])
    INTO v_permissions
    FROM public.admin_permissions;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT arp.permission ORDER BY arp.permission), ARRAY[]::text[])
    INTO v_permissions
    FROM public.user_roles ur
    JOIN public.admin_role_permissions arp ON arp.role = ur.role
    WHERE ur.user_id = v_admin_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.area, p.permission), '[]'::jsonb)
  INTO v_catalog
  FROM public.admin_permissions p;

  RETURN public.admin_json_success(jsonb_build_object(
    'admin_id', v_admin_id,
    'roles', v_roles,
    'permissions', v_permissions,
    'catalog', v_catalog,
    'permission_model', 'P3 least-privilege foundation; /kaan route remains admin-only while backend permissions are introduced.'
  ));
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Read-only operations and provider health RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_system_health(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_failed_admin_ops integer := 0;
  v_admin_actions_24h integer := 0;
  v_unread_notifications integer := 0;
  v_pending_reports integer := 0;
  v_open_support integer := 0;
  v_overdue_deletions integer := 0;
  v_pending_verifications integer := 0;
  v_stale_video_sessions integer := 0;
  v_failed_media_jobs integer := 0;
  v_overall text := 'healthy';
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'ops.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Operations permission is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_failed_admin_ops
  FROM public.admin_idempotency_keys
  WHERE updated_at >= p_now - interval '24 hours'
    AND COALESCE(response->>'success', 'true') = 'false';

  SELECT count(*)::integer
  INTO v_admin_actions_24h
  FROM public.admin_activity_logs
  WHERE created_at >= p_now - interval '24 hours';

  SELECT count(*)::integer
  INTO v_unread_notifications
  FROM public.admin_notifications
  WHERE read IS NOT TRUE;

  SELECT count(*)::integer
  INTO v_pending_reports
  FROM public.user_reports
  WHERE status IN ('pending', 'submitted', 'open');

  SELECT count(*)::integer
  INTO v_open_support
  FROM public.support_tickets
  WHERE status IN ('submitted', 'in_review', 'waiting_on_user');

  SELECT count(*)::integer
  INTO v_overdue_deletions
  FROM public.account_deletion_requests
  WHERE status = 'pending'
    AND scheduled_deletion_at < p_now;

  SELECT count(*)::integer
  INTO v_pending_verifications
  FROM public.photo_verifications
  WHERE status = 'pending';

  SELECT count(*)::integer
  INTO v_stale_video_sessions
  FROM public.video_sessions
  WHERE ended_at IS NULL
    AND started_at < p_now - interval '4 hours';

  SELECT count(*)::integer
  INTO v_failed_media_jobs
  FROM public.media_delete_jobs
  WHERE status IN ('failed', 'abandoned');

  IF v_failed_admin_ops > 0 OR v_overdue_deletions > 0 THEN
    v_overall := 'incident';
  ELSIF v_failed_media_jobs > 0 OR v_stale_video_sessions > 0 OR v_pending_reports > 0 OR v_open_support > 0 THEN
    v_overall := 'degraded';
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', p_now,
    'overall_status', v_overall,
    'reporting_timezone', 'UTC',
    'health_areas', jsonb_build_array(
      jsonb_build_object(
        'id', 'supabase',
        'label', 'Supabase / Database',
        'status', CASE WHEN v_failed_admin_ops > 0 THEN 'degraded' ELSE 'healthy' END,
        'primary_count', v_failed_admin_ops,
        'primary_label', 'failed admin operations in 24h',
        'details', jsonb_build_object('admin_actions_24h', v_admin_actions_24h)
      ),
      jsonb_build_object(
        'id', 'moderation',
        'label', 'Moderation / Support',
        'status', CASE WHEN v_pending_reports > 0 OR v_open_support > 0 THEN 'degraded' ELSE 'healthy' END,
        'primary_count', v_pending_reports + v_open_support,
        'primary_label', 'pending reports and open support tickets',
        'details', jsonb_build_object('pending_reports', v_pending_reports, 'open_support_tickets', v_open_support, 'pending_verifications', v_pending_verifications)
      ),
      jsonb_build_object(
        'id', 'notifications',
        'label', 'Admin Notifications',
        'status', 'healthy',
        'primary_count', v_unread_notifications,
        'primary_label', 'unread admin notifications',
        'details', jsonb_build_object('scope', 'exact admin_notifications unread count')
      ),
      jsonb_build_object(
        'id', 'media',
        'label', 'Media Lifecycle',
        'status', CASE WHEN v_failed_media_jobs > 0 THEN 'degraded' ELSE 'healthy' END,
        'primary_count', v_failed_media_jobs,
        'primary_label', 'failed or abandoned media jobs',
        'details', jsonb_build_object('source', 'media_delete_jobs')
      ),
      jsonb_build_object(
        'id', 'live_sessions',
        'label', 'Live Sessions',
        'status', CASE WHEN v_stale_video_sessions > 0 THEN 'degraded' ELSE 'healthy' END,
        'primary_count', v_stale_video_sessions,
        'primary_label', 'video sessions open for more than 4 hours',
        'details', jsonb_build_object('source', 'video_sessions')
      ),
      jsonb_build_object(
        'id', 'trust_lifecycle',
        'label', 'Trust / Account Lifecycle',
        'status', CASE WHEN v_overdue_deletions > 0 THEN 'incident' ELSE 'healthy' END,
        'primary_count', v_overdue_deletions,
        'primary_label', 'overdue account deletion requests',
        'details', jsonb_build_object('source', 'account_deletion_requests')
      )
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_provider_health(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_stripe_recent integer := 0;
  v_stripe_failed integer := 0;
  v_payment_failed integer := 0;
  v_bunny_failed_jobs integer := 0;
  v_bunny_stale_assets integer := 0;
  v_daily_stale_video_sessions integer := 0;
  v_daily_stale_match_calls integer := 0;
  v_onesignal_missing_players integer := 0;
  v_onesignal_suppressed_24h integer := 0;
  v_push_telemetry_24h integer := 0;
  v_overall text := 'healthy';
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'providers.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Provider health permission is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_stripe_recent
  FROM public.stripe_webhook_events
  WHERE received_at >= p_now - interval '24 hours';

  SELECT count(*)::integer
  INTO v_stripe_failed
  FROM public.stripe_webhook_events
  WHERE received_at >= p_now - interval '24 hours'
    AND status = 'failed';

  SELECT count(*)::integer
  INTO v_payment_failed
  FROM public.payment_observability_events
  WHERE created_at >= p_now - interval '24 hours'
    AND status IN ('failed', 'error');

  SELECT count(*)::integer
  INTO v_bunny_failed_jobs
  FROM public.media_delete_jobs
  WHERE provider IN ('bunny_stream', 'bunny_storage')
    AND status IN ('failed', 'abandoned');

  SELECT count(*)::integer
  INTO v_bunny_stale_assets
  FROM public.media_assets
  WHERE provider IN ('bunny_stream', 'bunny_storage')
    AND status = 'uploading'
    AND created_at < p_now - interval '2 hours';

  SELECT count(*)::integer
  INTO v_daily_stale_video_sessions
  FROM public.video_sessions
  WHERE ended_at IS NULL
    AND daily_room_name IS NOT NULL
    AND started_at < p_now - interval '4 hours';

  SELECT count(*)::integer
  INTO v_daily_stale_match_calls
  FROM public.match_calls
  WHERE status IN ('ringing', 'active')
    AND created_at < p_now - interval '4 hours';

  SELECT count(*)::integer
  INTO v_onesignal_missing_players
  FROM public.notification_preferences
  WHERE push_enabled IS TRUE
    AND onesignal_subscribed IS TRUE
    AND NULLIF(btrim(COALESCE(onesignal_player_id, '')), '') IS NULL;

  SELECT count(*)::integer
  INTO v_onesignal_suppressed_24h
  FROM public.notification_log
  WHERE created_at >= p_now - interval '24 hours'
    AND delivered IS NOT TRUE;

  SELECT count(*)::integer
  INTO v_push_telemetry_24h
  FROM public.push_notification_events_admin
  WHERE created_at >= p_now - interval '24 hours';

  IF v_stripe_failed > 0 OR v_payment_failed > 0 OR v_bunny_failed_jobs > 0 OR v_daily_stale_video_sessions > 0 THEN
    v_overall := 'degraded';
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', p_now,
    'overall_status', v_overall,
    'provider_checks_are_app_layer_only', true,
    'providers', jsonb_build_array(
      jsonb_build_object(
        'id', 'stripe',
        'label', 'Stripe',
        'status', CASE WHEN v_stripe_failed > 0 OR v_payment_failed > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('webhook_events_24h', v_stripe_recent, 'payment_observability_failures_24h', v_payment_failed),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Compare Stripe Dashboard webhooks, checkout sessions, subscriptions, and invoices.'),
        'drift_count', v_stripe_failed + v_payment_failed
      ),
      jsonb_build_object(
        'id', 'bunny',
        'label', 'Bunny',
        'status', CASE WHEN v_bunny_failed_jobs > 0 OR v_bunny_stale_assets > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('failed_delete_jobs', v_bunny_failed_jobs, 'stale_uploading_assets', v_bunny_stale_assets),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Check Bunny Stream object status, webhook freshness, and CDN playback separately.'),
        'drift_count', v_bunny_failed_jobs + v_bunny_stale_assets
      ),
      jsonb_build_object(
        'id', 'daily',
        'label', 'Daily',
        'status', CASE WHEN v_daily_stale_video_sessions > 0 OR v_daily_stale_match_calls > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('stale_video_sessions', v_daily_stale_video_sessions, 'stale_match_calls', v_daily_stale_match_calls),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Check Daily rooms and cleanup results for stale room drift.'),
        'drift_count', v_daily_stale_video_sessions + v_daily_stale_match_calls
      ),
      jsonb_build_object(
        'id', 'onesignal',
        'label', 'OneSignal',
        'status', CASE WHEN v_onesignal_missing_players > 0 THEN 'degraded' ELSE 'healthy' END,
        'app_truth', jsonb_build_object('missing_player_ids', v_onesignal_missing_players, 'suppressed_notification_logs_24h', v_onesignal_suppressed_24h, 'push_telemetry_rows_24h', v_push_telemetry_24h),
        'provider_truth', jsonb_build_object('status', 'not_contacted_by_this_rpc', 'runbook', 'Compare OneSignal app ID, subscriptions, accepted sends, and webhook telemetry.'),
        'drift_count', v_onesignal_missing_players
      ),
      jsonb_build_object(
        'id', 'supabase',
        'label', 'Supabase',
        'status', 'healthy',
        'app_truth', jsonb_build_object('database_rpc', 'available'),
        'provider_truth', jsonb_build_object('status', 'partially_visible_from_database', 'runbook', 'Use Supabase CLI/dashboard for deployed function inventory, secrets, buckets, and auth settings.'),
        'drift_count', 0
      )
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_rebuild_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_migration_count integer := 0;
  v_latest_migration text;
  v_unclassified_count integer := 0;
  v_classified_count integer := 0;
  v_rehearsal_count integer := 0;
  v_latest_rehearsal jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'rebuild.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Rebuild governance permission is required.');
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer, max(version)::text FROM supabase_migrations.schema_migrations'
      INTO v_migration_count, v_latest_migration;

    EXECUTE 'SELECT count(*)::integer FROM supabase_migrations.schema_migrations sm JOIN public.migration_classifications mc ON mc.migration_version = sm.version'
      INTO v_classified_count;

    EXECUTE 'SELECT count(*)::integer FROM supabase_migrations.schema_migrations sm LEFT JOIN public.migration_classifications mc ON mc.migration_version = sm.version WHERE mc.migration_version IS NULL'
      INTO v_unclassified_count;
  END IF;

  SELECT count(*)::integer
  INTO v_rehearsal_count
  FROM public.rebuild_rehearsal_runs;

  SELECT to_jsonb(r)
  INTO v_latest_rehearsal
  FROM public.rebuild_rehearsal_runs r
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN public.admin_json_success(jsonb_build_object(
    'migration_count', v_migration_count,
    'latest_migration', v_latest_migration,
    'classified_migrations', v_classified_count,
    'unclassified_migrations', v_unclassified_count,
    'rebuild_rehearsal_count', v_rehearsal_count,
    'latest_rehearsal', v_latest_rehearsal,
    'expected_functions', jsonb_build_array(
      'verify-admin',
      'admin-review-verification',
      'send-notification',
      'stripe-webhook',
      'video-webhook',
      'daily-room',
      'process-media-delete-jobs',
      'admin-media-lifecycle-controls'
    ),
    'provider_inventory_required', jsonb_build_array(
      'Supabase project ref and function secrets',
      'Stripe webhook endpoint and signing secret',
      'Bunny Stream library/CDN/webhook settings',
      'Daily domain/API key and cleanup jobs',
      'OneSignal app ID/API key/webhook',
      'Resend/Twilio credentials and verified sender/domain state'
    ),
    'status', CASE
      WHEN v_rehearsal_count = 0 THEN 'degraded'
      WHEN v_unclassified_count > 0 THEN 'degraded'
      ELSE 'healthy'
    END
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_incident_signals(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_signals jsonb := '[]'::jsonb;
  v_count integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'ops.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Operations permission is required.');
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.admin_idempotency_keys
  WHERE updated_at >= p_now - interval '24 hours'
    AND COALESCE(response->>'success', 'true') = 'false';
  IF v_count > 0 THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'severity', 'SEV2',
      'type', 'admin_mutation_failure',
      'title', 'Admin backend operations failed in the last 24 hours',
      'count', v_count,
      'next_step', 'Open Audit Explorer and inspect admin_idempotency_keys responses for failed operation IDs.'
    ));
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.stripe_webhook_events
  WHERE received_at >= p_now - interval '24 hours'
    AND status = 'failed';
  IF v_count > 0 THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'severity', 'SEV1',
      'type', 'payment_settlement_failure',
      'title', 'Stripe webhook failures detected',
      'count', v_count,
      'next_step', 'Compare stripe_webhook_events with Stripe Dashboard webhook attempts before repairing entitlements.'
    ));
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.media_delete_jobs
  WHERE status IN ('failed', 'abandoned');
  IF v_count > 0 THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'severity', 'SEV2',
      'type', 'media_lifecycle_failure',
      'title', 'Media delete jobs failed or were abandoned',
      'count', v_count,
      'next_step', 'Inspect Media Lifecycle before any provider-side cleanup.'
    ));
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.video_sessions
  WHERE ended_at IS NULL
    AND started_at < p_now - interval '4 hours';
  IF v_count > 0 THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'severity', 'SEV2',
      'type', 'live_session_stale',
      'title', 'Video sessions appear stale',
      'count', v_count,
      'next_step', 'Check Daily room state and app session timeline before cleanup.'
    ));
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.account_deletion_requests
  WHERE status = 'pending'
    AND scheduled_deletion_at < p_now;
  IF v_count > 0 THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'severity', 'SEV2',
      'type', 'account_deletion_overdue',
      'title', 'Account deletion requests are overdue',
      'count', v_count,
      'next_step', 'Review deletion queue and provider cleanup state; do not mark complete unless cleanup is verified.'
    ));
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', p_now,
    'signals', v_signals,
    'status', CASE WHEN jsonb_array_length(v_signals) > 0 THEN 'degraded' ELSE 'healthy' END,
    'severity_taxonomy', jsonb_build_object(
      'SEV1', 'critical customer or revenue path is failing',
      'SEV2', 'major subsystem degraded or drift detected',
      'SEV3', 'limited operational drift',
      'SEV4', 'informational follow-up'
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_admin_audit_logs(
  p_actor_id uuid DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'audit.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Audit read permission is required.');
  END IF;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
  )
  SELECT count(*)::integer INTO v_total FROM filtered;

  WITH filtered AS (
    SELECT al.*
    FROM public.admin_activity_logs al
    WHERE (p_actor_id IS NULL OR al.admin_id = p_actor_id)
      AND (NULLIF(btrim(COALESCE(p_target_type, '')), '') IS NULL OR al.target_type = p_target_type)
      AND (p_target_id IS NULL OR al.target_id = p_target_id)
      AND (NULLIF(btrim(COALESCE(p_action_type, '')), '') IS NULL OR al.action_type = p_action_type)
      AND (p_from IS NULL OR al.created_at >= p_from)
      AND (p_to IS NULL OR al.created_at < p_to)
  ),
  page AS (
    SELECT
      al.id,
      al.admin_id,
      admin_profile.name AS admin_name,
      al.action_type,
      al.target_type,
      al.target_id,
      al.details,
      al.created_at
    FROM filtered al
    LEFT JOIN public.profiles admin_profile ON admin_profile.id = al.admin_id
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'scope', 'admin_activity_logs',
    'incident_usage', 'Use action_type, target_type, target_id, actor, and date filters to reconstruct production-impacting admin actions.'
  ));
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants for P3 read-only operations contracts
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.admin_user_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_admin_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_system_health(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_provider_health(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_rebuild_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_incident_signals(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_admin_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_system_health(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_health(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_rebuild_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_incident_signals(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_get_system_health(timestamptz) IS
  'P3 read-only /kaan Operations Center health summary. Uses app-layer Supabase truth only.';
COMMENT ON FUNCTION public.admin_get_provider_health(timestamptz) IS
  'P3 read-only provider reconciliation summary. Separates app truth from provider truth and does not call provider APIs.';
COMMENT ON FUNCTION public.admin_get_rebuild_status() IS
  'P3 read-only rebuild-governance summary from migration history, classification manifest, and rehearsal ledger.';
COMMENT ON FUNCTION public.admin_get_incident_signals(timestamptz) IS
  'P3 read-only incident signal taxonomy for operations triage.';
COMMENT ON FUNCTION public.admin_search_admin_audit_logs(uuid, text, uuid, text, timestamptz, timestamptz, integer, integer) IS
  'P3 admin audit explorer backend read surface for incident reconstruction.';
