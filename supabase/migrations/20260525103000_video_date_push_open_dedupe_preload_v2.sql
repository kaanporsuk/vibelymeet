-- Push open compatibility contract for video-date multi-device dedupe.

CREATE OR REPLACE FUNCTION public.mark_notification_opened_v2(notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_opened_at timestamptz;
  v_opened_at timestamptz;
  v_first_open boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT opened_at
  INTO v_existing_opened_at
  FROM public.user_notifications
  WHERE id = notification_id
    AND user_id = v_user_id
    AND dismissed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  v_first_open := v_existing_opened_at IS NULL;

  UPDATE public.user_notifications
  SET
    seen_at = COALESCE(seen_at, now()),
    read_at = COALESCE(read_at, now()),
    opened_at = COALESCE(opened_at, now())
  WHERE id = notification_id
    AND user_id = v_user_id
    AND dismissed_at IS NULL
  RETURNING opened_at INTO v_opened_at;

  RETURN jsonb_build_object(
    'ok', true,
    'first_open', v_first_open,
    'opened_at', v_opened_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_opened_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_opened_v2(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_notification_opened_v2(uuid) IS
  'Authenticated compatibility RPC for notification opens. Verifies user ownership, preserves mark_notification_opened semantics, and returns first_open for multi-device click side-effect gating.';
