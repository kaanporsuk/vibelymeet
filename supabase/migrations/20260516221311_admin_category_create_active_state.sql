-- Create admin-managed event categories with their intended active state in
-- the same RPC transaction, so inactive drafts are never briefly visible.

DROP FUNCTION IF EXISTS public.admin_create_event_category(text, text, integer);

CREATE OR REPLACE FUNCTION public.admin_create_event_category(
  p_label text,
  p_emoji text,
  p_sort_order integer DEFAULT NULL,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_emoji text := NULLIF(btrim(COALESCE(p_emoji, '')), '');
  v_base_key text;
  v_key text;
  v_suffix integer := 1;
  v_category public.event_categories%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF v_label IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category label is required.');
  END IF;
  IF v_emoji IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category emoji is required.');
  END IF;

  v_base_key := public.event_category_slug(v_label);
  IF v_base_key IS NULL OR v_base_key = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category label must contain letters or numbers.');
  END IF;
  v_key := v_base_key;
  WHILE EXISTS (SELECT 1 FROM public.event_categories WHERE key = v_key) LOOP
    v_suffix := v_suffix + 1;
    v_key := v_base_key || '_' || v_suffix::text;
  END LOOP;

  INSERT INTO public.event_categories (key, label, emoji, active, sort_order, created_by, updated_by)
  VALUES (
    v_key,
    v_label,
    v_emoji,
    COALESCE(p_active, true),
    COALESCE(p_sort_order, (SELECT COALESCE(max(sort_order), 0) + 10 FROM public.event_categories)),
    v_admin_id,
    v_admin_id
  )
  RETURNING * INTO v_category;

  PERFORM public.log_admin_action(
    'event_category.create',
    'event_category',
    v_category.id,
    jsonb_build_object('category', to_jsonb(v_category))
  );

  RETURN public.admin_json_success(jsonb_build_object('category', to_jsonb(v_category)));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_event_category(text, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_event_category(text, text, integer, boolean) TO authenticated;
