CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    p_actor,
    COALESCE(NULLIF(p_source, ''), 'finalize_video_date_handshake_deadline'),
    p_reason,
    false
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'retryable', false
    );
  END IF;

  v_result := public.finalize_vd_handshake_deadline_20260605115657_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason
  );

  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'finalize_video_date_handshake_deadline:post_base_room_repair'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$
