CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.expire_stale_video_sessions_bounded(100);
END;
$function$
