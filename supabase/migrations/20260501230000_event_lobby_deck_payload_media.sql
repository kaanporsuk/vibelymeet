-- Event Lobby deck payload and media contract cleanup.
--
-- Adds viewer-safe rendering fields directly to get_event_deck so web/native
-- cards do not fetch profiles per card for premium/photo verification state.
-- The payload intentionally excludes private verification artifacts, contact
-- fields, moderation/admin fields, and report/block internals.

DROP FUNCTION IF EXISTS public.get_event_deck(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.get_event_deck(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  profile_id uuid,
  name text,
  age integer,
  gender text,
  avatar_url text,
  photos text[],
  about_me text,
  job text,
  location text,
  height_cm integer,
  tagline text,
  looking_for text,
  queue_status text,
  has_met_before boolean,
  is_already_connected boolean,
  has_super_vibed boolean,
  shared_vibe_count integer,
  primary_photo_path text,
  photo_verified boolean,
  premium_badge text,
  availability_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_active record;
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RAISE EXCEPTION 'event_not_active'
      USING ERRCODE = 'P0001',
            DETAIL = COALESCE(v_active.reason, 'event_not_active');
  END IF;

  RETURN QUERY
  WITH deck AS (
    SELECT base.*
    FROM public.get_event_deck_20260501180000_active_base(
      p_event_id,
      p_user_id,
      p_limit
    ) AS base
    WHERE COALESCE(base.queue_status, 'idle') IN ('browsing', 'idle')
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_sessions vs
        WHERE vs.event_id = p_event_id
          AND vs.ended_at IS NULL
          AND (
            vs.participant_1_id = base.profile_id
            OR vs.participant_2_id = base.profile_id
          )
          AND (
            vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
            OR vs.state IN ('handshake', 'date')
            OR vs.phase IN ('handshake', 'date')
            OR vs.handshake_started_at IS NOT NULL
            OR vs.date_started_at IS NOT NULL
          )
      )
  )
  SELECT
    deck.profile_id,
    deck.name,
    deck.age,
    deck.gender,
    deck.avatar_url,
    deck.photos,
    deck.about_me,
    deck.job,
    deck.location,
    deck.height_cm,
    deck.tagline,
    deck.looking_for,
    deck.queue_status,
    deck.has_met_before,
    deck.is_already_connected,
    deck.has_super_vibed,
    deck.shared_vibe_count,
    COALESCE(
      (
        SELECT NULLIF(btrim(photo), '')
        FROM unnest(COALESCE(deck.photos, ARRAY[]::text[])) AS photo
        WHERE NULLIF(btrim(photo), '') IS NOT NULL
        LIMIT 1
      ),
      NULLIF(btrim(deck.avatar_url), '')
    ) AS primary_photo_path,
    COALESCE(p.photo_verified, false) AS photo_verified,
    CASE
      WHEN p.subscription_tier IN ('premium', 'vip') THEN p.subscription_tier
      ELSE NULL
    END AS premium_badge,
    'available'::text AS availability_state
  FROM deck
  JOIN public.profiles p ON p.id = deck.profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck(uuid, uuid, integer) IS
  'Event deck RPC. Raises event_not_active unless the event is active; hides busy candidates; returns one viewer-safe media/premium/verification payload for web and native cards.';
