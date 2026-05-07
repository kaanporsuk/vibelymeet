-- Govern /kaan Support Inbox behind backend read models and audited mutations.
--
-- Migration class: RPC + trigger.
-- Intent: keep strict support table grants while allowing admins to triage
-- support tickets through server-owned read and mutation paths.

-- Keep user replies from leaving tickets stale. Admin replies are transitioned
-- explicitly through admin_create_support_reply.
CREATE OR REPLACE FUNCTION public.support_ticket_reply_status_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NEW.sender_type = 'user' THEN
    UPDATE public.support_tickets
    SET status = CASE
          WHEN status = 'resolved' THEN status
          ELSE 'in_review'
        END,
        updated_at = now()
    WHERE id = NEW.ticket_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS support_ticket_replies_status_sync ON public.support_ticket_replies;
CREATE TRIGGER support_ticket_replies_status_sync
  AFTER INSERT ON public.support_ticket_replies
  FOR EACH ROW
  EXECUTE FUNCTION public.support_ticket_reply_status_sync();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_replies;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_events;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

GRANT SELECT ON public.support_ticket_events TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_support_inbox(
  p_status text DEFAULT 'all',
  p_primary_type text DEFAULT 'all',
  p_priority text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_status text := lower(COALESCE(NULLIF(btrim(p_status), ''), 'all'));
  v_primary_type text := lower(COALESCE(NULLIF(btrim(p_primary_type), ''), 'all'));
  v_priority text := lower(COALESCE(NULLIF(btrim(p_priority), ''), 'all'));
  v_search text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_tickets jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_filtered_count integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.');
  END IF;

  IF v_status NOT IN ('all', 'submitted', 'in_review', 'waiting_on_user', 'resolved') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Support status filter is invalid.');
  END IF;
  IF v_primary_type NOT IN ('all', 'support', 'feedback', 'safety') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Support type filter is invalid.');
  END IF;
  IF v_priority NOT IN ('all', 'low', 'normal', 'high', 'urgent') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Support priority filter is invalid.');
  END IF;

  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'submitted', count(*) FILTER (WHERE status = 'submitted')::integer,
    'in_review', count(*) FILTER (WHERE status = 'in_review')::integer,
    'waiting_on_user', count(*) FILTER (WHERE status = 'waiting_on_user')::integer,
    'resolved', count(*) FILTER (WHERE status = 'resolved')::integer,
    'open', count(*) FILTER (WHERE status IN ('submitted', 'in_review'))::integer,
    'safety', count(*) FILTER (WHERE primary_type = 'safety')::integer,
    'urgent', count(*) FILTER (WHERE priority = 'urgent')::integer
  )
  INTO v_counts
  FROM public.support_tickets;

  WITH reply_stats AS (
    SELECT
      r.ticket_id,
      count(*)::integer AS reply_count,
      count(*) FILTER (WHERE r.sender_type = 'user')::integer AS user_reply_count,
      count(*) FILTER (WHERE r.sender_type = 'admin')::integer AS admin_reply_count,
      max(r.created_at) AS last_reply_at,
      (array_agg(r.sender_type ORDER BY r.created_at DESC, r.id DESC))[1] AS last_reply_sender_type
    FROM public.support_ticket_replies r
    GROUP BY r.ticket_id
  ),
  filtered AS (
    SELECT
      t.id,
      t.reference_id,
      t.user_id,
      t.event_id,
      t.checkout_session_id,
      t.event_payment_exception_id,
      t.primary_type,
      t.subcategory,
      t.subject,
      t.status,
      t.priority,
      t.message,
      t.user_email,
      t.platform,
      t.app_version,
      t.device_model,
      t.os_version,
      t.created_at,
      t.updated_at,
      t.resolved_at,
      t.assigned_to,
      t.admin_notes,
      p.name AS profile_name,
      p.avatar_url AS profile_avatar_url,
      COALESCE(rs.reply_count, 0) AS reply_count,
      COALESCE(rs.user_reply_count, 0) AS user_reply_count,
      COALESCE(rs.admin_reply_count, 0) AS admin_reply_count,
      rs.last_reply_at,
      rs.last_reply_sender_type,
      (
        t.status <> 'resolved'
        AND (
          (COALESCE(rs.reply_count, 0) = 0 AND t.status = 'submitted')
          OR rs.last_reply_sender_type = 'user'
        )
      ) AS needs_attention
    FROM public.support_tickets t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    LEFT JOIN reply_stats rs ON rs.ticket_id = t.id
    WHERE (v_status = 'all' OR t.status = v_status)
      AND (v_primary_type = 'all' OR t.primary_type = v_primary_type)
      AND (v_priority = 'all' OR t.priority = v_priority)
      AND (
        v_search IS NULL
        OR position(v_search in lower(COALESCE(t.reference_id, ''))) > 0
        OR position(v_search in lower(COALESCE(t.user_email, ''))) > 0
        OR position(v_search in lower(COALESCE(t.message, ''))) > 0
        OR position(v_search in lower(COALESCE(t.subcategory, ''))) > 0
        OR position(v_search in lower(COALESCE(p.name, ''))) > 0
      )
  )
  SELECT count(*)::integer
  INTO v_filtered_count
  FROM filtered;

  WITH reply_stats AS (
    SELECT
      r.ticket_id,
      count(*)::integer AS reply_count,
      count(*) FILTER (WHERE r.sender_type = 'user')::integer AS user_reply_count,
      count(*) FILTER (WHERE r.sender_type = 'admin')::integer AS admin_reply_count,
      max(r.created_at) AS last_reply_at,
      (array_agg(r.sender_type ORDER BY r.created_at DESC, r.id DESC))[1] AS last_reply_sender_type
    FROM public.support_ticket_replies r
    GROUP BY r.ticket_id
  ),
  filtered AS (
    SELECT
      t.id,
      t.reference_id,
      t.user_id,
      t.event_id,
      t.checkout_session_id,
      t.event_payment_exception_id,
      t.primary_type,
      t.subcategory,
      t.subject,
      t.status,
      t.priority,
      t.message,
      t.user_email,
      t.platform,
      t.app_version,
      t.device_model,
      t.os_version,
      t.created_at,
      t.updated_at,
      t.resolved_at,
      t.assigned_to,
      t.admin_notes,
      p.name AS profile_name,
      p.avatar_url AS profile_avatar_url,
      COALESCE(rs.reply_count, 0) AS reply_count,
      COALESCE(rs.user_reply_count, 0) AS user_reply_count,
      COALESCE(rs.admin_reply_count, 0) AS admin_reply_count,
      rs.last_reply_at,
      rs.last_reply_sender_type,
      (
        t.status <> 'resolved'
        AND (
          (COALESCE(rs.reply_count, 0) = 0 AND t.status = 'submitted')
          OR rs.last_reply_sender_type = 'user'
        )
      ) AS needs_attention
    FROM public.support_tickets t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    LEFT JOIN reply_stats rs ON rs.ticket_id = t.id
    WHERE (v_status = 'all' OR t.status = v_status)
      AND (v_primary_type = 'all' OR t.primary_type = v_primary_type)
      AND (v_priority = 'all' OR t.priority = v_priority)
      AND (
        v_search IS NULL
        OR position(v_search in lower(COALESCE(t.reference_id, ''))) > 0
        OR position(v_search in lower(COALESCE(t.user_email, ''))) > 0
        OR position(v_search in lower(COALESCE(t.message, ''))) > 0
        OR position(v_search in lower(COALESCE(t.subcategory, ''))) > 0
        OR position(v_search in lower(COALESCE(p.name, ''))) > 0
      )
  ),
  ordered AS (
    SELECT
      id,
      reference_id,
      user_id,
      event_id,
      checkout_session_id,
      event_payment_exception_id,
      primary_type,
      subcategory,
      subject,
      status,
      priority,
      message,
      user_email,
      platform,
      app_version,
      device_model,
      os_version,
      created_at,
      updated_at,
      resolved_at,
      assigned_to,
      admin_notes,
      profile_name,
      profile_avatar_url,
      reply_count,
      user_reply_count,
      admin_reply_count,
      last_reply_at,
      last_reply_sender_type,
      needs_attention,
      row_number() OVER (
        ORDER BY
          CASE priority
            WHEN 'urgent' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 9
          END ASC,
          updated_at DESC,
          id ASC
      ) AS row_order
    FROM filtered
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'reference_id', reference_id,
      'user_id', user_id,
      'event_id', event_id,
      'checkout_session_id', checkout_session_id,
      'event_payment_exception_id', event_payment_exception_id,
      'primary_type', primary_type,
      'subcategory', subcategory,
      'subject', subject,
      'status', status,
      'priority', priority,
      'message', message,
      'user_email', user_email,
      'platform', platform,
      'app_version', app_version,
      'device_model', device_model,
      'os_version', os_version,
      'created_at', created_at,
      'updated_at', updated_at,
      'resolved_at', resolved_at,
      'assigned_to', assigned_to,
      'admin_notes', admin_notes,
      'profile_name', profile_name,
      'profile_avatar_url', profile_avatar_url,
      'reply_count', reply_count,
      'user_reply_count', user_reply_count,
      'admin_reply_count', admin_reply_count,
      'last_reply_at', last_reply_at,
      'last_reply_sender_type', last_reply_sender_type,
      'needs_attention', needs_attention
    ) ORDER BY row_order
  ), '[]'::jsonb)
  INTO v_tickets
  FROM ordered;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'tickets', v_tickets,
    'counts', v_counts || jsonb_build_object('filtered', v_filtered_count),
    'filtered_count', v_filtered_count,
    'limit', v_limit
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_support_ticket_thread(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_ticket_user_id uuid;
  v_ticket_exception_id uuid;
  v_ticket_json jsonb := NULL;
  v_profile jsonb := NULL;
  v_replies jsonb := '[]'::jsonb;
  v_linked_exception jsonb := NULL;
  v_events jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.');
  END IF;

  IF p_ticket_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Ticket id is required.');
  END IF;

  SELECT
    t.user_id,
    t.event_payment_exception_id,
    jsonb_build_object(
      'id', t.id,
      'reference_id', t.reference_id,
      'user_id', t.user_id,
      'event_id', t.event_id,
      'checkout_session_id', t.checkout_session_id,
      'event_payment_exception_id', t.event_payment_exception_id,
      'primary_type', t.primary_type,
      'subcategory', t.subcategory,
      'subject', t.subject,
      'status', t.status,
      'priority', t.priority,
      'message', t.message,
      'user_email', t.user_email,
      'platform', t.platform,
      'app_version', t.app_version,
      'device_model', t.device_model,
      'os_version', t.os_version,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'resolved_at', t.resolved_at,
      'assigned_to', t.assigned_to,
      'admin_notes', t.admin_notes
    )
  INTO v_ticket_user_id, v_ticket_exception_id, v_ticket_json
  FROM public.support_tickets t
  WHERE t.id = p_ticket_id;

  IF v_ticket_json IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Support ticket was not found.');
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'avatar_url', p.avatar_url
  )
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_ticket_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'ticket_id', r.ticket_id,
      'sender_type', r.sender_type,
      'sender_id', r.sender_id,
      'message', r.message,
      'is_read', r.is_read,
      'created_at', r.created_at
    ) ORDER BY r.created_at ASC, r.id ASC
  ), '[]'::jsonb)
  INTO v_replies
  FROM public.support_ticket_replies r
  WHERE r.ticket_id = p_ticket_id;

  SELECT jsonb_build_object(
    'id', e.id,
    'event_id', e.event_id,
    'profile_id', e.profile_id,
    'checkout_session_id', e.checkout_session_id,
    'support_ticket_id', e.support_ticket_id,
    'exception_type', e.exception_type,
    'exception_status', e.exception_status,
    'resolution', e.resolution,
    'settlement_outcome_snapshot', e.settlement_outcome_snapshot,
    'registration_admission_snapshot', e.registration_admission_snapshot,
    'event_status_snapshot', e.event_status_snapshot,
    'refund_handled_externally', e.refund_handled_externally,
    'external_refund_reference', e.external_refund_reference,
    'notes', e.notes,
    'resolved_at', e.resolved_at,
    'created_at', e.created_at,
    'updated_at', e.updated_at
  )
  INTO v_linked_exception
  FROM public.event_payment_exceptions e
  WHERE e.support_ticket_id = p_ticket_id
     OR (v_ticket_exception_id IS NOT NULL AND e.id = v_ticket_exception_id)
  ORDER BY e.updated_at DESC, e.created_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ste.id,
      'ticket_id', ste.ticket_id,
      'actor_id', ste.actor_id,
      'event_type', ste.event_type,
      'details', ste.details,
      'created_at', ste.created_at
    ) ORDER BY ste.created_at DESC, ste.id DESC
  ), '[]'::jsonb)
  INTO v_events
  FROM public.support_ticket_events ste
  WHERE ste.ticket_id = p_ticket_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'ticket', v_ticket_json,
    'profile', v_profile,
    'replies', v_replies,
    'linked_exception', v_linked_exception,
    'support_events', v_events
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_support_ticket(
  p_ticket_id uuid,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_admin_notes text DEFAULT NULL,
  p_set_admin_notes boolean DEFAULT false,
  p_event_id uuid DEFAULT NULL,
  p_set_event_id boolean DEFAULT false,
  p_checkout_session_id text DEFAULT NULL,
  p_set_checkout_session_id boolean DEFAULT false,
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
  v_before public.support_tickets%ROWTYPE;
  v_after public.support_tickets%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
  v_checkout_session_id text := NULLIF(btrim(COALESCE(p_checkout_session_id, '')), '');
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.'); END IF;
  IF p_ticket_id IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Ticket id is required.'); END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('submitted', 'in_review', 'waiting_on_user', 'resolved') THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Support status is invalid.'); END IF;
  IF p_priority IS NOT NULL AND p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Support priority is invalid.'); END IF;

  IF p_set_event_id AND p_event_id IS NOT NULL THEN
    PERFORM 1 FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_update_support_ticket',
    p_idempotency_key,
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'status', p_status,
      'priority', p_priority,
      'set_admin_notes', p_set_admin_notes,
      'admin_notes', p_admin_notes,
      'set_event_id', p_set_event_id,
      'event_id', p_event_id,
      'set_checkout_session_id', p_set_checkout_session_id,
      'checkout_session_id', v_checkout_session_id
    )
  );
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT *
  INTO v_before
  FROM public.support_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Support ticket was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_update_support_ticket', p_idempotency_key, v_response);
  END IF;

  UPDATE public.support_tickets
  SET status = COALESCE(p_status, status),
      priority = COALESCE(p_priority, priority),
      admin_notes = CASE WHEN p_set_admin_notes THEN p_admin_notes ELSE admin_notes END,
      event_id = CASE WHEN p_set_event_id THEN p_event_id ELSE event_id END,
      checkout_session_id = CASE WHEN p_set_checkout_session_id THEN v_checkout_session_id ELSE checkout_session_id END,
      resolved_at = CASE
        WHEN p_status = 'resolved' AND v_before.status IS DISTINCT FROM 'resolved' THEN now()
        WHEN p_status IS NOT NULL AND p_status <> 'resolved' THEN NULL
        ELSE resolved_at
      END
  WHERE id = p_ticket_id
  RETURNING * INTO v_after;

  INSERT INTO public.support_ticket_events (ticket_id, actor_id, event_type, details)
  VALUES (
    p_ticket_id,
    v_admin_id,
    'ticket_updated',
    jsonb_build_object(
      'before_status', v_before.status,
      'after_status', v_after.status,
      'before_priority', v_before.priority,
      'after_priority', v_after.priority,
      'event_id_changed', v_before.event_id IS DISTINCT FROM v_after.event_id,
      'checkout_session_changed', v_before.checkout_session_id IS DISTINCT FROM v_after.checkout_session_id,
      'admin_notes_changed', v_before.admin_notes IS DISTINCT FROM v_after.admin_notes
    )
  );

  v_audit_id := public.log_admin_action(
    'support.ticket_update',
    'support_ticket',
    p_ticket_id,
    jsonb_build_object(
      'before_status', v_before.status,
      'after_status', v_after.status,
      'before_priority', v_before.priority,
      'after_priority', v_after.priority,
      'event_id_changed', v_before.event_id IS DISTINCT FROM v_after.event_id,
      'checkout_session_changed', v_before.checkout_session_id IS DISTINCT FROM v_after.checkout_session_id,
      'admin_notes_changed', v_before.admin_notes IS DISTINCT FROM v_after.admin_notes
    )
  );

  v_response := public.admin_json_success(jsonb_build_object('ticket_id', p_ticket_id, 'ticket', to_jsonb(v_after), 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_update_support_ticket', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_support_reply(
  p_ticket_id uuid,
  p_message text,
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
  v_ticket public.support_tickets%ROWTYPE;
  v_after public.support_tickets%ROWTYPE;
  v_reply public.support_ticket_replies%ROWTYPE;
  v_message text := btrim(COALESCE(p_message, ''));
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'support.manage') THEN RETURN public.admin_json_error('FORBIDDEN', 'Support management permission is required.'); END IF;
  IF p_ticket_id IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Ticket id is required.'); END IF;
  IF v_message = '' THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Reply message is required.'); END IF;
  IF length(v_message) > 5000 THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Reply message is too long.'); END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_create_support_reply',
    p_idempotency_key,
    jsonb_build_object('ticket_id', p_ticket_id, 'message', v_message)
  );
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT *
  INTO v_ticket
  FROM public.support_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Support ticket was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_support_reply', p_idempotency_key, v_response);
  END IF;

  IF v_ticket.status = 'resolved' THEN
    v_response := public.admin_json_error('INVALID_TRANSITION', 'Reopen the support ticket before sending another reply.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_support_reply', p_idempotency_key, v_response);
  END IF;

  INSERT INTO public.support_ticket_replies (ticket_id, sender_type, sender_id, message)
  VALUES (p_ticket_id, 'admin', v_admin_id, v_message)
  RETURNING * INTO v_reply;

  UPDATE public.support_tickets
  SET status = 'waiting_on_user',
      updated_at = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_after;

  INSERT INTO public.support_ticket_events (ticket_id, actor_id, event_type, details)
  VALUES (
    p_ticket_id,
    v_admin_id,
    'admin_reply_created',
    jsonb_build_object(
      'reply_id', v_reply.id,
      'before_status', v_ticket.status,
      'after_status', v_after.status
    )
  );

  v_audit_id := public.log_admin_action(
    'support.reply_create',
    'support_ticket',
    p_ticket_id,
    jsonb_build_object(
      'reply_id', v_reply.id,
      'before_status', v_ticket.status,
      'after_status', v_after.status
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'ticket_id', p_ticket_id,
    'reply', to_jsonb(v_reply),
    'ticket', to_jsonb(v_after),
    'audit_log_id', v_audit_id
  ));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_support_reply', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.support_ticket_reply_status_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_support_inbox(text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_support_ticket_thread(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_support_ticket(uuid, text, text, text, boolean, uuid, boolean, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_support_reply(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_support_inbox(text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_support_ticket_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_support_ticket(uuid, text, text, text, boolean, uuid, boolean, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_support_reply(uuid, text, text) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507180000',
  'Admin Support Inbox governed read and mutation paths',
  'schema+policy',
  'Adds security-definer admin Support Inbox read models, audited reply/ticket mutation RPCs, and a reply lifecycle trigger. No support tickets are seeded or backfilled.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_support_inbox(text, text, text, text, integer) IS
  'Read-only /kaan Support Inbox read model with filters, reply summaries, needs-attention state, and counts.';
COMMENT ON FUNCTION public.admin_get_support_ticket_thread(uuid) IS
  'Read-only /kaan Support Inbox ticket detail read model with profile summary, thread replies, support events, and linked payment exception.';
COMMENT ON FUNCTION public.admin_update_support_ticket(uuid, text, text, text, boolean, uuid, boolean, text, boolean, text) IS
  'Governed /kaan Support Inbox ticket update RPC for status, priority, notes, and payment/event context.';
COMMENT ON FUNCTION public.admin_create_support_reply(uuid, text, text) IS
  'Governed /kaan Support Inbox admin reply RPC. Inserts the reply, transitions ticket state, records support events, and audits.';
