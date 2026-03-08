-- Fix function search_path for Supabase security linter
-- Only haversine_distance and update_updated_at_column are missing search_path entirely.
-- Also standardize update_match_last_message and update_event_attendees to include pg_catalog.

-- 1. haversine_distance
CREATE OR REPLACE FUNCTION public.haversine_distance(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, pg_catalog
AS $function$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) *
    sin(radians(lng2 - lng1) / 2) ^ 2
  ))
$function$;

-- 2. update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 3. update_match_last_message
CREATE OR REPLACE FUNCTION public.update_match_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  UPDATE public.matches 
  SET last_message_at = NEW.created_at 
  WHERE id = NEW.match_id;
  RETURN NEW;
END;
$function$;

-- 4. update_event_attendees
CREATE OR REPLACE FUNCTION public.update_event_attendees()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events 
    SET current_attendees = current_attendees + 1 
    WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events 
    SET current_attendees = current_attendees - 1 
    WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;