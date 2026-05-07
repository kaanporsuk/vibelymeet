-- Account Deletions /kaan backend-authoritative admin surface.
--
-- Migration class: schema + RPC + policy.
-- Intent: move the Account Deletions admin tab behind guarded read/action RPCs.
-- The completion action is a verified checkpoint only; it does not delete
-- auth.users or profiles.

CREATE OR REPLACE FUNCTION public.admin_list_account_deletions(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_status text := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_pending_count integer := 0;
  v_completed_count integer := 0;
  v_recovered_count integer := 0;
  v_other_count integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF v_status = 'recovered' THEN
    v_status := 'cancelled';
  END IF;

  IF v_status IS NOT NULL AND v_status NOT IN ('pending', 'completed', 'cancelled') THEN
    RETURN public.admin_json_error(
      'VALIDATION_ERROR',
      'Unsupported account deletion status filter.',
      jsonb_build_object('status', v_status)
    );
  END IF;

  SELECT
    count(*) FILTER (WHERE adr.status = 'pending')::integer,
    count(*) FILTER (WHERE adr.status = 'completed')::integer,
    count(*) FILTER (WHERE adr.status = 'cancelled')::integer,
    count(*) FILTER (
      WHERE COALESCE(adr.status, '') NOT IN ('pending', 'completed', 'cancelled')
    )::integer
  INTO v_pending_count, v_completed_count, v_recovered_count, v_other_count
  FROM public.account_deletion_requests adr;

  WITH rows AS (
    SELECT
      adr.id,
      adr.user_id,
      COALESCE(NULLIF(btrim(p.name), ''), 'Unknown User') AS user_name,
      adr.status,
      adr.reason,
      adr.requested_at,
      adr.scheduled_deletion_at,
      adr.cancelled_at,
      adr.completed_at,
      (
        adr.status = 'pending'
        AND adr.scheduled_deletion_at IS NOT NULL
        AND adr.scheduled_deletion_at <= now()
      ) AS can_mark_completed
    FROM public.account_deletion_requests adr
    LEFT JOIN public.profiles p ON p.id = adr.user_id
    WHERE v_status IS NULL OR adr.status = v_status
    ORDER BY adr.requested_at DESC NULLS LAST, adr.id DESC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rows.id,
        'user_id', rows.user_id,
        'user_name', rows.user_name,
        'status', rows.status,
        'reason', rows.reason,
        'requested_at', rows.requested_at,
        'scheduled_deletion_at', rows.scheduled_deletion_at,
        'cancelled_at', rows.cancelled_at,
        'completed_at', rows.completed_at,
        'can_mark_completed', rows.can_mark_completed
      )
      ORDER BY rows.requested_at DESC NULLS LAST, rows.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM rows;

  RETURN public.admin_json_success(jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', v_pending_count,
      'completed', v_completed_count,
      'recovered', v_recovered_count,
      'other', v_other_count
    ),
    'rows', v_rows,
    'status', v_status,
    'limit', v_limit
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_account_deletion_completed(
  p_request_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_before public.account_deletion_requests%ROWTYPE;
  v_after public.account_deletion_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_mark_account_deletion_completed',
    p_idempotency_key,
    jsonb_build_object('request_id', p_request_id, 'reason', v_reason)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT *
  INTO v_before
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Account deletion request was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF COALESCE(v_before.status, '') <> 'pending' THEN
    v_response := public.admin_json_error(
      'INVALID_TRANSITION',
      'Only pending account deletion requests can be marked completed.',
      jsonb_build_object('status', v_before.status)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  IF v_before.scheduled_deletion_at IS NULL OR v_before.scheduled_deletion_at > now() THEN
    v_response := public.admin_json_error(
      'INVALID_TRANSITION',
      'Account deletion request is not eligible for completion until its scheduled deletion date.',
      jsonb_build_object('scheduled_deletion_at', v_before.scheduled_deletion_at)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'completed',
      completed_at = now(),
      cancelled_at = NULL
  WHERE id = p_request_id
  RETURNING *
  INTO v_after;

  v_audit_id := public.log_admin_action(
    'account_deletion.complete_verified_checkpoint',
    'account_deletion_request',
    p_request_id,
    jsonb_build_object(
      'reason', v_reason,
      'checkpoint_only', true,
      'auth_user_deleted', false,
      'profile_deleted', false,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after)
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'request_id', v_after.id,
    'user_id', v_after.user_id,
    'completed_at', v_after.completed_at,
    'audit_log_id', v_audit_id,
    'checkpoint_only', true,
    'auth_user_deleted', false,
    'profile_deleted', false
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_account_deletion_completed', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_account_deletions(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_mark_account_deletion_completed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_account_deletions(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_account_deletion_completed(uuid, text, text) TO authenticated;

DROP POLICY IF EXISTS "Admins can view all deletion requests" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "Admins can update deletion requests" ON public.account_deletion_requests;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507140000',
  'Admin Account Deletions backend-authoritative surface',
  'schema+policy',
  'Adds guarded admin read/action RPCs and removes direct browser-admin select/update policies for account deletion requests. Completion remains a checkpoint, not auth/profile deletion.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_list_account_deletions(text, integer) IS
  'Read-only /kaan Account Deletions read model with status counts and minimal profile display fields.';

COMMENT ON FUNCTION public.admin_mark_account_deletion_completed(uuid, text, text) IS
  'Audited /kaan Account Deletions completion checkpoint. Does not delete auth.users or profiles.';
