-- P4 /kaan growth-scale intelligence foundation.
--
-- Migration class: schema + policy + reference data.
-- Intent: add P4 permission areas and canonical metric definitions without
-- changing production user state or provider configuration.

-- ─────────────────────────────────────────────────────────────────────────────
-- P4 admin permissions
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.admin_permissions (permission, area, label, description, is_break_glass)
VALUES
  ('intelligence.read', 'Intelligence', 'Read product intelligence', 'View P4 product, event, match, trust, and revenue intelligence dashboards.', false),
  ('experiments.manage', 'Experiments', 'Manage experiments', 'Create, pause, kill, and inspect controlled product experiments.', true),
  ('growth.read', 'Growth', 'Read growth attribution', 'View invite, referral, and growth quality attribution summaries.', false),
  ('trust.triage', 'Trust', 'Run trust triage', 'Review assisted trust and safety triage queues without automatic enforcement.', false),
  ('revenue.read', 'Revenue', 'Read revenue intelligence', 'View Stripe, RevenueCat, credits, paid-event, and entitlement intelligence.', false),
  ('compliance.manage', 'Compliance', 'Manage compliance workflows', 'Create and review DSAR, export, deletion-proof, consent, and retention workflows.', true),
  ('support.manage', 'Support', 'Manage support workflows', 'Manage support timelines, templates, notes, and escalations.', false),
  ('store_ops.read', 'Store Ops', 'Read store operations', 'View native release, store metadata, review, and rollout operations.', false),
  ('cost.read', 'Cost', 'Read cost and quality budgets', 'View provider cost, capacity, unit economics, and release quality scorecards.', false)
ON CONFLICT (permission) DO UPDATE
SET area = EXCLUDED.area,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_break_glass = EXCLUDED.is_break_glass;

INSERT INTO public.admin_role_permissions (role, permission)
VALUES
  ('admin'::public.app_role, 'intelligence.read'),
  ('admin'::public.app_role, 'experiments.manage'),
  ('admin'::public.app_role, 'growth.read'),
  ('admin'::public.app_role, 'trust.triage'),
  ('admin'::public.app_role, 'revenue.read'),
  ('admin'::public.app_role, 'compliance.manage'),
  ('admin'::public.app_role, 'support.manage'),
  ('admin'::public.app_role, 'store_ops.read'),
  ('admin'::public.app_role, 'cost.read'),
  ('moderator'::public.app_role, 'trust.triage'),
  ('moderator'::public.app_role, 'support.manage')
ON CONFLICT (role, permission) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical metric dictionary seed
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_metric_definitions (
  metric_key text PRIMARY KEY,
  domain text NOT NULL,
  label text NOT NULL,
  definition text NOT NULL,
  source_surface text NOT NULL,
  pii_classification text NOT NULL DEFAULT 'aggregate'
    CHECK (pii_classification IN ('aggregate', 'pseudonymous', 'sensitive', 'forbidden')),
  owner text NOT NULL DEFAULT 'product',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_metric_definitions_key_not_blank CHECK (btrim(metric_key) <> ''),
  CONSTRAINT product_metric_definitions_domain_not_blank CHECK (btrim(domain) <> '')
);

ALTER TABLE public.product_metric_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_select_product_metric_definitions ON public.product_metric_definitions;
CREATE POLICY admins_select_product_metric_definitions
  ON public.product_metric_definitions
  FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'intelligence.read'));

DROP POLICY IF EXISTS admins_manage_product_metric_definitions ON public.product_metric_definitions;
CREATE POLICY admins_manage_product_metric_definitions
  ON public.product_metric_definitions
  FOR ALL
  USING (public.admin_user_has_permission(auth.uid(), 'admin.super'))
  WITH CHECK (public.admin_user_has_permission(auth.uid(), 'admin.super'));

DROP TRIGGER IF EXISTS product_metric_definitions_updated_at ON public.product_metric_definitions;
CREATE TRIGGER product_metric_definitions_updated_at
  BEFORE UPDATE ON public.product_metric_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.product_metric_definitions (
  metric_key,
  domain,
  label,
  definition,
  source_surface,
  pii_classification,
  owner
)
VALUES
  ('activation.verified_signup', 'activation', 'Verified signups', 'Profiles created in the window with at least one verified trust signal.', 'profiles', 'aggregate', 'product'),
  ('activation.first_event_registration', 'activation', 'First event registration', 'Users whose first event registration occurred in the reporting window.', 'event_registrations', 'aggregate', 'product'),
  ('events.registration_to_lobby', 'events', 'Registration to lobby participation', 'Share of event registrants who entered active lobby/ready/date states.', 'event_registrations + video_sessions', 'aggregate', 'marketplace'),
  ('events.liquidity_score', 'events', 'Event liquidity score', 'Deterministic score combining registration fill, balance, verified ratio, lobby activity, match potential, and safety signals.', 'events + registrations + sessions + reports', 'aggregate', 'marketplace'),
  ('matching.quality_score', 'matching', 'Match quality score', 'Deterministic score combining mutual feedback, completed sessions, second-message behavior, blocks, reports, and no-show signals.', 'video_sessions + date_feedback + matches + messages + reports', 'aggregate', 'marketplace'),
  ('trust.report_rate', 'trust', 'Report rate', 'User reports per active participant in a reporting window.', 'user_reports + profiles', 'aggregate', 'trust'),
  ('trust.triage_risk', 'trust', 'Trust triage risk', 'Human-review priority score based on reports, blocks, warnings, suspensions, verification failures, and no-show signals.', 'trust triage RPC', 'pseudonymous', 'trust'),
  ('revenue.entitlement_drift', 'revenue', 'Entitlement drift', 'Users whose profile premium state differs from active Stripe/RevenueCat subscription evidence.', 'profiles + subscriptions', 'aggregate', 'revenue'),
  ('growth.referral_quality', 'growth', 'Referral quality', 'Referral cohorts evaluated by activation, retention, event registration, match quality, and spam/safety outcomes.', 'growth attribution + product tables', 'aggregate', 'growth'),
  ('quality.video_date_join_latency', 'quality', 'Video-date join latency', 'Time from ready-gate handoff to successful Daily/video-date join checkpoints.', 'video-date observability', 'aggregate', 'ops'),
  ('cost.cost_per_successful_match', 'cost', 'Cost per successful match', 'Provider cost divided by successful match/date outcomes in the same reporting window.', 'provider cost snapshots + match quality', 'aggregate', 'finance')
ON CONFLICT (metric_key) DO UPDATE
SET domain = EXCLUDED.domain,
    label = EXCLUDED.label,
    definition = EXCLUDED.definition,
    source_surface = EXCLUDED.source_surface,
    pii_classification = EXCLUDED.pii_classification,
    owner = EXCLUDED.owner,
    active = true,
    updated_at = now();

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260506130000',
  'P4 admin intelligence foundation',
  'schema+policy',
  'Adds P4 permissions and product metric dictionary reference rows. No production user data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON TABLE public.product_metric_definitions IS
  'P4 canonical product metric dictionary. Defines analytics semantics; does not store transactional product truth.';
