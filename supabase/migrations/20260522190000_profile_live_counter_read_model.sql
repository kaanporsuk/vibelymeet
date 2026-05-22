-- Maintain Profile Studio live counters from source tables.
--
-- `profiles.events_attended` is the legacy storage column for the Profile Studio
-- Events counter. It intentionally counts event_registrations rows, not checked-in
-- attendance.

CREATE INDEX IF NOT EXISTS idx_profile_live_counts_event_registrations_profile_id
  ON public.event_registrations (profile_id);

CREATE INDEX IF NOT EXISTS idx_profile_live_counts_matches_profile_id_1
  ON public.matches (profile_id_1);

CREATE INDEX IF NOT EXISTS idx_profile_live_counts_matches_profile_id_2
  ON public.matches (profile_id_2);

CREATE OR REPLACE FUNCTION public.recompute_profile_live_counts(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_events integer := 0;
  v_matches integer := 0;
  v_conversations integer := 0;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO v_events
  FROM public.event_registrations er
  WHERE er.profile_id = p_profile_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE m.last_message_at IS NOT NULL)::integer
  INTO v_matches, v_conversations
  FROM public.matches m
  WHERE m.profile_id_1 = p_profile_id
     OR m.profile_id_2 = p_profile_id;

  UPDATE public.profiles p
  SET
    events_attended = v_events,
    total_matches = v_matches,
    total_conversations = v_conversations
  WHERE p.id = p_profile_id
    AND (
      p.events_attended IS DISTINCT FROM v_events
      OR p.total_matches IS DISTINCT FROM v_matches
      OR p.total_conversations IS DISTINCT FROM v_conversations
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_profile_live_counts_for_event_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_profile_live_counts(NEW.profile_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_profile_live_counts(OLD.profile_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.profile_id IS DISTINCT FROM NEW.profile_id THEN
    PERFORM public.recompute_profile_live_counts(OLD.profile_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_profile_live_counts_for_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_profile_id uuid;
  v_profile_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_profile_ids := ARRAY[NEW.profile_id_1, NEW.profile_id_2];
  ELSIF TG_OP = 'DELETE' THEN
    v_profile_ids := ARRAY[OLD.profile_id_1, OLD.profile_id_2];
  ELSE
    v_profile_ids := ARRAY[NEW.profile_id_1, NEW.profile_id_2, OLD.profile_id_1, OLD.profile_id_2];
  END IF;

  FOR v_profile_id IN
    SELECT DISTINCT profile_id
    FROM unnest(v_profile_ids) AS affected(profile_id)
    WHERE profile_id IS NOT NULL
  LOOP
    PERFORM public.recompute_profile_live_counts(v_profile_id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

WITH counts AS (
  SELECT
    p.id,
    (
      SELECT count(*)::integer
      FROM public.event_registrations er
      WHERE er.profile_id = p.id
    ) AS events_attended,
    (
      SELECT count(*)::integer
      FROM public.matches m
      WHERE m.profile_id_1 = p.id
         OR m.profile_id_2 = p.id
    ) AS total_matches,
    (
      SELECT count(*)::integer
      FROM public.matches m
      WHERE (m.profile_id_1 = p.id OR m.profile_id_2 = p.id)
        AND m.last_message_at IS NOT NULL
    ) AS total_conversations
  FROM public.profiles p
)
UPDATE public.profiles p
SET
  events_attended = counts.events_attended,
  total_matches = counts.total_matches,
  total_conversations = counts.total_conversations
FROM counts
WHERE p.id = counts.id
  AND (
    p.events_attended IS DISTINCT FROM counts.events_attended
    OR p.total_matches IS DISTINCT FROM counts.total_matches
    OR p.total_conversations IS DISTINCT FROM counts.total_conversations
  );

DROP TRIGGER IF EXISTS trg_event_registrations_profile_live_counts
  ON public.event_registrations;

CREATE TRIGGER trg_event_registrations_profile_live_counts
AFTER INSERT OR UPDATE OF profile_id OR DELETE ON public.event_registrations
FOR EACH ROW
EXECUTE FUNCTION public.recompute_profile_live_counts_for_event_registration();

DROP TRIGGER IF EXISTS trg_matches_profile_live_counts
  ON public.matches;

CREATE TRIGGER trg_matches_profile_live_counts
AFTER INSERT OR UPDATE OF profile_id_1, profile_id_2, last_message_at OR DELETE ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.recompute_profile_live_counts_for_match();

COMMENT ON FUNCTION public.recompute_profile_live_counts(uuid) IS
  'Internal read-model repair helper for Profile Studio Events, Matches, and Convos counters.';

COMMENT ON TRIGGER trg_event_registrations_profile_live_counts ON public.event_registrations IS
  'Keeps profiles.events_attended aligned with event_registrations rows for Profile Studio counters.';

COMMENT ON TRIGGER trg_matches_profile_live_counts ON public.matches IS
  'Keeps profiles.total_matches and profiles.total_conversations aligned with matches rows and last_message_at.';

REVOKE ALL ON FUNCTION public.recompute_profile_live_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_profile_live_counts_for_event_registration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_profile_live_counts_for_match() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_profile_live_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_profile_live_counts_for_event_registration() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_profile_live_counts_for_match() TO service_role;

NOTIFY pgrst, 'reload schema';
