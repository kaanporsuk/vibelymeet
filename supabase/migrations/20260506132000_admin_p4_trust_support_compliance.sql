-- P4 /kaan trust triage, authenticity, policy, and support primitives.
--
-- Migration class: schema + policy + RPC.
-- Intent: add human-in-the-loop triage and support context. Recommendations
-- never execute enforcement; existing P2 moderation RPCs remain authoritative.

-- ─────────────────────────────────────────────────────────────────────────────
-- Policy, triage, and support tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.moderation_policy_categories (
  policy_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  severity integer NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_policy_categories_key_not_blank CHECK (btrim(policy_key) <> '')
);

CREATE TABLE IF NOT EXISTS public.trust_triage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderation_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid REFERENCES public.trust_triage_snapshots(id) ON DELETE SET NULL,
  report_id uuid REFERENCES public.user_reports(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  policy_category text REFERENCES public.moderation_policy_categories(policy_key) ON DELETE SET NULL,
  recommended_action text NOT NULL DEFAULT 'review'
    CHECK (recommended_action IN ('review', 'dismiss', 'issue_warning', 'suspend_user', 'verify_identity', 'support_followup', 'no_action')),
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.user_reports(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'upheld', 'overturned', 'closed')),
  appeal_text text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_response_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  pii_classification text NOT NULL DEFAULT 'support'
    CHECK (pii_classification IN ('support', 'safety', 'payment', 'compliance')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'engineering_escalation')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS policy_category text REFERENCES public.moderation_policy_categories(policy_key) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderation_recommendation_id uuid REFERENCES public.moderation_recommendations(id) ON DELETE SET NULL;

ALTER TABLE public.moderation_policy_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_triage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_response_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_internal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_select_moderation_policy_categories ON public.moderation_policy_categories;
CREATE POLICY admins_select_moderation_policy_categories
  ON public.moderation_policy_categories FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'trust.triage'));

DROP POLICY IF EXISTS admins_select_trust_triage_snapshots ON public.trust_triage_snapshots;
CREATE POLICY admins_select_trust_triage_snapshots
  ON public.trust_triage_snapshots FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'trust.triage'));

DROP POLICY IF EXISTS admins_select_moderation_recommendations ON public.moderation_recommendations;
CREATE POLICY admins_select_moderation_recommendations
  ON public.moderation_recommendations FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'trust.triage'));

DROP POLICY IF EXISTS admins_select_moderation_appeals ON public.moderation_appeals;
CREATE POLICY admins_select_moderation_appeals
  ON public.moderation_appeals FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'trust.triage'));

DROP POLICY IF EXISTS admins_select_support_response_templates ON public.support_response_templates;
CREATE POLICY admins_select_support_response_templates
  ON public.support_response_templates FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'support.manage'));

DROP POLICY IF EXISTS admins_select_support_ticket_events ON public.support_ticket_events;
CREATE POLICY admins_select_support_ticket_events
  ON public.support_ticket_events FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'support.manage'));

DROP POLICY IF EXISTS admins_select_support_internal_notes ON public.support_internal_notes;
CREATE POLICY admins_select_support_internal_notes
  ON public.support_internal_notes FOR SELECT
  USING (public.admin_user_has_permission(auth.uid(), 'support.manage'));

CREATE INDEX IF NOT EXISTS idx_trust_triage_snapshots_user_generated
  ON public.trust_triage_snapshots(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_recommendations_status
  ON public.moderation_recommendations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket
  ON public.support_ticket_events(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_internal_notes_ticket
  ON public.support_internal_notes(ticket_id, created_at DESC);

DROP TRIGGER IF EXISTS support_response_templates_updated_at ON public.support_response_templates;
CREATE TRIGGER support_response_templates_updated_at
  BEFORE UPDATE ON public.support_response_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.moderation_policy_categories (policy_key, label, description, severity)
VALUES
  ('harassment', 'Harassment', 'Abusive, threatening, hateful, or unwanted behavior.', 4),
  ('fake', 'Fake profile', 'Impersonation, fake identity, suspicious media, or authenticity risk.', 4),
  ('inappropriate', 'Inappropriate content', 'Sexual, graphic, illegal, or platform-inappropriate content.', 4),
  ('spam', 'Spam or scams', 'Commercial spam, scams, phishing, referral abuse, or low-quality automation.', 3),
  ('safety', 'Safety concern', 'Behavior that creates a safety, consent, or event-risk concern.', 5),
  ('underage', 'Underage concern', 'Possible underage account or age-gate concern.', 5),
  ('no_show', 'No-show or reliability', 'Repeated ready-gate drops, event no-shows, or unreliable participation.', 2),
  ('payment', 'Payment or refund trust', 'Chargeback, refund, entitlement, or paid-event support risk.', 3),
  ('other', 'Other', 'Needs human classification.', 1)
ON CONFLICT (policy_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    severity = EXCLUDED.severity,
    active = true;

INSERT INTO public.support_response_templates (template_key, category, title, body, pii_classification)
VALUES
  ('verification_retry', 'verification', 'Verification retry guidance', 'We could not verify this submission. Please retake the photo in clear lighting and make sure your face is visible.', 'safety'),
  ('payment_settlement_check', 'payment', 'Payment settlement check', 'We are checking your payment and entitlement state. Please do not retry the purchase until support confirms the next step.', 'payment'),
  ('safety_report_received', 'safety', 'Safety report received', 'Thanks for reporting this. Our team will review it against Vibely community standards and follow up if we need more context.', 'safety'),
  ('account_deletion_status', 'compliance', 'Account deletion status', 'We can confirm the current deletion request status and will share any provider cleanup steps that still require attention.', 'compliance')
ON CONFLICT (template_key) DO UPDATE
SET category = EXCLUDED.category,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    pii_classification = EXCLUDED.pii_classification,
    active = true,
    updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Read and decision RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_trust_triage_queue(
  p_filters jsonb DEFAULT '{}'::jsonb,
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
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'trust.triage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Trust triage permission is required.');
  END IF;

  WITH risk AS (
    SELECT
      p.id AS user_id,
      p.name,
      p.created_at,
      COALESCE((SELECT count(*) FROM public.user_reports ur WHERE ur.reported_id = p.id AND ur.status = 'pending'), 0)::integer AS pending_reports,
      COALESCE((SELECT count(*) FROM public.user_reports ur WHERE ur.reported_id = p.id), 0)::integer AS total_reports,
      COALESCE((SELECT count(*) FROM public.blocked_users bu WHERE bu.blocked_id = p.id), 0)::integer AS blocks_received,
      COALESCE((SELECT count(*) FROM public.user_warnings uw WHERE uw.user_id = p.id), 0)::integer AS warnings,
      COALESCE((SELECT count(*) FROM public.user_suspensions us WHERE us.user_id = p.id AND us.status = 'active'), 0)::integer AS active_suspensions,
      COALESCE((SELECT count(*) FROM public.verification_attempts va WHERE va.user_id = p.id), 0)::integer AS verification_attempts,
      COALESCE((
        SELECT count(*)
        FROM public.event_registrations er
        JOIN public.events e ON e.id = er.event_id
        WHERE er.profile_id = p.id
          AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
          AND er.attended IS NOT TRUE
          AND er.attendance_marked IS NOT TRUE
          AND e.event_date < now() - interval '1 day'
      ), 0)::integer AS possible_no_shows
    FROM public.profiles p
  ),
  scored AS (
    SELECT
      *,
      GREATEST(0, LEAST(100,
        pending_reports * 25
        + total_reports * 8
        + blocks_received * 8
        + warnings * 10
        + active_suspensions * 25
        + LEAST(verification_attempts, 5) * 4
        + LEAST(possible_no_shows, 5) * 3
      ))::integer AS risk_score
    FROM risk
    WHERE pending_reports > 0
       OR total_reports > 0
       OR blocks_received > 0
       OR warnings > 0
       OR active_suspensions > 0
       OR verification_attempts > 2
       OR possible_no_shows > 2
  )
  SELECT count(*)::integer INTO v_total FROM scored;

  WITH risk AS (
    SELECT
      p.id AS user_id,
      p.name,
      p.created_at,
      COALESCE((SELECT count(*) FROM public.user_reports ur WHERE ur.reported_id = p.id AND ur.status = 'pending'), 0)::integer AS pending_reports,
      COALESCE((SELECT count(*) FROM public.user_reports ur WHERE ur.reported_id = p.id), 0)::integer AS total_reports,
      COALESCE((SELECT count(*) FROM public.blocked_users bu WHERE bu.blocked_id = p.id), 0)::integer AS blocks_received,
      COALESCE((SELECT count(*) FROM public.user_warnings uw WHERE uw.user_id = p.id), 0)::integer AS warnings,
      COALESCE((SELECT count(*) FROM public.user_suspensions us WHERE us.user_id = p.id AND us.status = 'active'), 0)::integer AS active_suspensions,
      COALESCE((SELECT count(*) FROM public.verification_attempts va WHERE va.user_id = p.id), 0)::integer AS verification_attempts,
      COALESCE((
        SELECT count(*)
        FROM public.event_registrations er
        JOIN public.events e ON e.id = er.event_id
        WHERE er.profile_id = p.id
          AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
          AND er.attended IS NOT TRUE
          AND er.attendance_marked IS NOT TRUE
          AND e.event_date < now() - interval '1 day'
      ), 0)::integer AS possible_no_shows
    FROM public.profiles p
  ),
  scored AS (
    SELECT
      *,
      GREATEST(0, LEAST(100,
        pending_reports * 25
        + total_reports * 8
        + blocks_received * 8
        + warnings * 10
        + active_suspensions * 25
        + LEAST(verification_attempts, 5) * 4
        + LEAST(possible_no_shows, 5) * 3
      ))::integer AS risk_score
    FROM risk
    WHERE pending_reports > 0
       OR total_reports > 0
       OR blocks_received > 0
       OR warnings > 0
       OR active_suspensions > 0
       OR verification_attempts > 2
       OR possible_no_shows > 2
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', user_id,
      'name', name,
      'risk_score', risk_score,
      'confidence', CASE WHEN total_reports + blocks_received + verification_attempts >= 8 THEN 'high' WHEN total_reports + blocks_received >= 3 THEN 'medium' ELSE 'low' END,
      'recommended_action', CASE
        WHEN active_suspensions > 0 THEN 'monitor_suspension'
        WHEN pending_reports >= 2 OR risk_score >= 70 THEN 'review_for_suspension'
        WHEN pending_reports = 1 OR risk_score >= 40 THEN 'review_report'
        WHEN verification_attempts > 2 THEN 'verify_identity'
        ELSE 'monitor'
      END,
      'signals', jsonb_build_object(
        'pending_reports', pending_reports,
        'total_reports', total_reports,
        'blocks_received', blocks_received,
        'warnings', warnings,
        'active_suspensions', active_suspensions,
        'verification_attempts', verification_attempts,
        'possible_no_shows', possible_no_shows
      )
    )
    ORDER BY risk_score DESC, pending_reports DESC, created_at ASC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM scored
    ORDER BY risk_score DESC, pending_reports DESC, created_at ASC
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'filters', COALESCE(p_filters, '{}'::jsonb),
    'rows', v_rows,
    'total_count', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'automation_policy', 'Advisory triage only. Suspensions, warnings, bans, refunds, deletes, and revocations remain human-confirmed through P2 RPCs.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_trust_timeline(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'trust.triage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Trust triage permission is required.');
  END IF;
  IF p_user_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User id is required.');
  END IF;

  WITH timeline AS (
    SELECT created_at AS occurred_at, jsonb_build_object('type', 'report_received', 'id', id, 'reason', reason, 'status', status, 'reporter_id', reporter_id) AS item
    FROM public.user_reports WHERE reported_id = p_user_id
    UNION ALL
    SELECT created_at, jsonb_build_object('type', 'report_sent', 'id', id, 'reason', reason, 'status', status, 'reported_id', reported_id)
    FROM public.user_reports WHERE reporter_id = p_user_id
    UNION ALL
    SELECT created_at, jsonb_build_object('type', 'warning', 'id', id, 'reason', reason, 'acknowledged', acknowledged_at IS NOT NULL)
    FROM public.user_warnings WHERE user_id = p_user_id
    UNION ALL
    SELECT suspended_at, jsonb_build_object('type', 'suspension', 'id', id, 'reason', reason, 'status', status, 'expires_at', expires_at)
    FROM public.user_suspensions WHERE user_id = p_user_id
    UNION ALL
    SELECT created_at, jsonb_build_object('type', 'blocked_by_user', 'id', id, 'blocked_id', blocked_id, 'reason', reason)
    FROM public.blocked_users WHERE blocker_id = p_user_id
    UNION ALL
    SELECT created_at, jsonb_build_object('type', 'user_blocked', 'id', id, 'blocker_id', blocker_id, 'reason', reason)
    FROM public.blocked_users WHERE blocked_id = p_user_id
    UNION ALL
    SELECT attempt_at, jsonb_build_object('type', 'verification_attempt', 'id', id)
    FROM public.verification_attempts WHERE user_id = p_user_id
    UNION ALL
    SELECT created_at, jsonb_build_object('type', 'photo_verification', 'id', id, 'status', status, 'client_match_result', client_match_result)
    FROM public.photo_verifications WHERE user_id = p_user_id
  )
  SELECT COALESCE(jsonb_agg(item || jsonb_build_object('occurred_at', occurred_at) ORDER BY occurred_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM timeline;

  RETURN public.admin_json_success(jsonb_build_object(
    'user_id', p_user_id,
    'rows', v_rows,
    'timeline_semantics', 'Trust timeline links evidence for human review; it does not execute enforcement.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_authenticity_operations(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_pending integer := 0;
  v_approved integer := 0;
  v_rejected integer := 0;
  v_expired_profiles integer := 0;
  v_failed_attempt_users integer := 0;
  v_queue jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'trust.triage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Trust triage permission is required.');
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'pending')::integer,
    count(*) FILTER (WHERE status = 'approved')::integer,
    count(*) FILTER (WHERE status = 'rejected')::integer
  INTO v_pending, v_approved, v_rejected
  FROM public.photo_verifications;

  SELECT count(*)::integer INTO v_expired_profiles
  FROM public.profiles
  WHERE photo_verified IS TRUE
    AND photo_verification_expires_at IS NOT NULL
    AND photo_verification_expires_at < now();

  SELECT count(*)::integer INTO v_failed_attempt_users
  FROM (
    SELECT user_id
    FROM public.verification_attempts
    WHERE attempt_at >= now() - interval '7 days'
    GROUP BY user_id
    HAVING count(*) >= 3
  ) repeated;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'verification_id', pv.id,
      'user_id', pv.user_id,
      'status', pv.status,
      'client_confidence_score', pv.client_confidence_score,
      'client_match_result', pv.client_match_result,
      'created_at', pv.created_at,
      'expires_at', pv.expires_at
    )
    ORDER BY pv.created_at ASC
  ), '[]'::jsonb)
  INTO v_queue
  FROM (
    SELECT *
    FROM public.photo_verifications
    WHERE status IN ('pending', 'rejected')
    ORDER BY created_at ASC
    LIMIT 50
  ) pv;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'filters', COALESCE(p_filters, '{}'::jsonb),
    'metrics', jsonb_build_object(
      'pending_verifications', v_pending,
      'approved_verifications', v_approved,
      'rejected_verifications', v_rejected,
      'expired_verified_profiles', v_expired_profiles,
      'users_with_repeated_failed_attempts_7d', v_failed_attempt_users
    ),
    'queue', v_queue,
    'automation_policy', 'Authenticity signals prioritize human review and recovery; they do not automatically verify or punish users.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_moderation_recommendation_decision(
  p_recommendation_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_row public.moderation_recommendations%ROWTYPE;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'trust.triage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Trust triage permission is required.');
  END IF;
  IF p_recommendation_id IS NULL OR p_decision NOT IN ('accepted', 'rejected', 'superseded') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Recommendation decision is invalid.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A decision reason is required.');
  END IF;

  UPDATE public.moderation_recommendations
  SET status = p_decision,
      decided_by = v_admin_id,
      decided_at = now(),
      decision_reason = p_reason
  WHERE id = p_recommendation_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Moderation recommendation was not found.');
  END IF;

  v_audit_id := public.log_admin_action(
    'trust.recommendation_decision',
    'moderation_recommendation',
    p_recommendation_id,
    jsonb_build_object(
      'decision', p_decision,
      'reason', p_reason,
      'user_id', v_row.user_id,
      'report_id', v_row.report_id,
      'recommended_action', v_row.recommended_action
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'recommendation_id', p_recommendation_id,
    'decision', p_decision,
    'audit_log_id', v_audit_id,
    'enforcement_executed', false
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_support_timeline(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_tickets jsonb;
  v_events jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Support permission is required.');
  END IF;
  IF p_user_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User id is required.');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC), '[]'::jsonb)
  INTO v_tickets
  FROM public.support_tickets t
  WHERE t.user_id = p_user_id;

  SELECT COALESCE(jsonb_agg(item ORDER BY occurred_at DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT st.created_at AS occurred_at, jsonb_build_object('type', 'ticket_created', 'ticket_id', st.id, 'reference_id', st.reference_id, 'status', st.status, 'priority', st.priority, 'subject', st.subject) AS item
    FROM public.support_tickets st
    WHERE st.user_id = p_user_id
    UNION ALL
    SELECT ste.created_at, jsonb_build_object('type', ste.event_type, 'ticket_id', ste.ticket_id, 'details', ste.details)
    FROM public.support_ticket_events ste
    JOIN public.support_tickets st ON st.id = ste.ticket_id
    WHERE st.user_id = p_user_id
    UNION ALL
    SELECT sin.created_at, jsonb_build_object('type', 'internal_note', 'ticket_id', sin.ticket_id, 'visibility', sin.visibility, 'note_present', true)
    FROM public.support_internal_notes sin
    JOIN public.support_tickets st ON st.id = sin.ticket_id
    WHERE st.user_id = p_user_id
  ) timeline;

  RETURN public.admin_json_success(jsonb_build_object(
    'user_id', p_user_id,
    'tickets', v_tickets,
    'timeline', v_events,
    'pii_policy', 'Support timeline exposes ticket context to support-authorized admins only; exports require the compliance workflow.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_report_with_policy(
  p_report_id uuid,
  p_action text,
  p_reason text,
  p_message text DEFAULT NULL,
  p_suspension_expires_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_policy_category text DEFAULT NULL,
  p_recommendation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_payload jsonb;
  v_audit_id uuid;
  v_report public.user_reports%ROWTYPE;
BEGIN
  IF p_policy_category IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.moderation_policy_categories WHERE policy_key = p_policy_category AND active IS TRUE
  ) THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Unknown or inactive moderation policy category.');
  END IF;

  IF p_recommendation_id IS NOT NULL THEN
    SELECT * INTO v_report
    FROM public.user_reports
    WHERE id = p_report_id;

    IF NOT FOUND THEN
      RETURN public.admin_json_error('NOT_FOUND', 'Report was not found.');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.moderation_recommendations mr
      WHERE mr.id = p_recommendation_id
        AND mr.status = 'pending'
        AND mr.report_id = p_report_id
        AND mr.user_id = v_report.reported_id
    ) THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Recommendation does not belong to this pending report action.');
    END IF;
  END IF;

  v_payload := public.admin_resolve_report(
    p_report_id,
    p_action,
    p_reason,
    p_message,
    p_suspension_expires_at,
    p_idempotency_key
  );

  IF COALESCE((v_payload ->> 'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_payload;
  END IF;

  UPDATE public.user_reports
  SET policy_category = COALESCE(p_policy_category, policy_category),
      moderation_recommendation_id = COALESCE(p_recommendation_id, moderation_recommendation_id)
  WHERE id = p_report_id;

  IF p_recommendation_id IS NOT NULL THEN
    UPDATE public.moderation_recommendations
    SET status = 'accepted',
        decided_by = auth.uid(),
        decided_at = now(),
        decision_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'Report resolved through admin moderation action.')
    WHERE id = p_recommendation_id
      AND status = 'pending';
  END IF;

  v_audit_id := public.log_admin_action(
    'report.policy_context_attached',
    'report',
    p_report_id,
    jsonb_build_object(
      'policy_category', p_policy_category,
      'recommendation_id', p_recommendation_id,
      'enforcement_executed_by_p4', false
    )
  );

  RETURN v_payload || jsonb_build_object(
    'policy_category', p_policy_category,
    'recommendation_id', p_recommendation_id,
    'policy_context_audit_log_id', v_audit_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_trust_triage_queue(jsonb, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_trust_timeline(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_authenticity_operations(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_moderation_recommendation_decision(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_support_timeline(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_report_with_policy(uuid, text, text, text, timestamptz, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_trust_triage_queue(jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_trust_timeline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_authenticity_operations(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_moderation_recommendation_decision(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_support_timeline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report_with_policy(uuid, text, text, text, timestamptz, text, text, uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260506132000',
  'P4 trust support compliance foundation',
  'schema+policy',
  'Adds policy, trust triage, recommendations, appeals, and support context. P4 recommendation decisions do not execute enforcement.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON TABLE public.moderation_recommendations IS
  'P4 human-in-the-loop moderation recommendations. Advisory only; enforcement remains in P2 admin RPCs.';
COMMENT ON FUNCTION public.admin_record_moderation_recommendation_decision(uuid, text, text) IS
  'Records human decision on a P4 trust recommendation without executing enforcement.';
