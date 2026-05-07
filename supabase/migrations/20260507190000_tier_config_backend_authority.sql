-- Tier Config backend authority: canonical capability resolution + enforcement.

CREATE OR REPLACE FUNCTION public.tier_capability_type(p_capability_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_capability_key
    WHEN 'canSeeLikedYou' THEN 'boolean'
    WHEN 'canCityBrowse' THEN 'boolean'
    WHEN 'canUseVibeSchedule' THEN 'boolean'
    WHEN 'canSuggestDate' THEN 'boolean'
    WHEN 'hasBadge' THEN 'boolean'
    WHEN 'dailySwipeLimit' THEN 'number_or_null'
    WHEN 'monthlyEventJoins' THEN 'number_or_null'
    WHEN 'monthlyExtraTimeCredits' THEN 'number'
    WHEN 'monthlyExtendedVibeCredits' THEN 'number'
    WHEN 'maxActiveConversations' THEN 'number_or_null'
    WHEN 'dailyDropPriority' THEN 'number'
    WHEN 'accessibleEventTiers' THEN 'string_array'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.tier_capability_default(
  p_tier_id text,
  p_capability_key text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tier text := CASE WHEN p_tier_id IN ('free', 'premium', 'vip') THEN p_tier_id ELSE 'free' END;
BEGIN
  CASE p_capability_key
    WHEN 'canSeeLikedYou' THEN
      RETURN to_jsonb(v_tier IN ('premium', 'vip'));
    WHEN 'canCityBrowse' THEN
      RETURN to_jsonb(v_tier IN ('premium', 'vip'));
    WHEN 'canUseVibeSchedule' THEN
      RETURN 'true'::jsonb;
    WHEN 'canSuggestDate' THEN
      RETURN 'true'::jsonb;
    WHEN 'hasBadge' THEN
      RETURN to_jsonb(v_tier IN ('premium', 'vip'));
    WHEN 'dailySwipeLimit' THEN
      RETURN 'null'::jsonb;
    WHEN 'monthlyEventJoins' THEN
      RETURN 'null'::jsonb;
    WHEN 'monthlyExtraTimeCredits' THEN
      RETURN to_jsonb(CASE v_tier WHEN 'premium' THEN 3 WHEN 'vip' THEN 10 ELSE 0 END);
    WHEN 'monthlyExtendedVibeCredits' THEN
      RETURN to_jsonb(CASE v_tier WHEN 'vip' THEN 10 ELSE 0 END);
    WHEN 'maxActiveConversations' THEN
      RETURN 'null'::jsonb;
    WHEN 'dailyDropPriority' THEN
      RETURN to_jsonb(CASE v_tier WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END);
    WHEN 'accessibleEventTiers' THEN
      RETURN CASE v_tier
        WHEN 'vip' THEN '["free","premium","vip"]'::jsonb
        WHEN 'premium' THEN '["free","premium"]'::jsonb
        ELSE '["free"]'::jsonb
      END;
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.tier_config_override_value_is_valid(
  p_capability_key text,
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_type text := public.tier_capability_type(p_capability_key);
  v_value jsonb := COALESCE(p_value, 'null'::jsonb);
  v_json_type text := jsonb_typeof(COALESCE(p_value, 'null'::jsonb));
  v_num numeric;
  v_count int;
  v_distinct_count int;
BEGIN
  IF v_type IS NULL THEN
    RETURN false;
  END IF;

  IF v_type = 'boolean' THEN
    RETURN v_json_type = 'boolean';
  END IF;

  IF v_type IN ('number', 'number_or_null') THEN
    IF v_json_type = 'null' THEN
      RETURN v_type = 'number_or_null';
    END IF;

    IF v_json_type <> 'number' THEN
      RETURN false;
    END IF;

    v_num := (v_value #>> '{}')::numeric;
    RETURN v_num >= 0 AND v_num <= 2147483647 AND trunc(v_num) = v_num;
  END IF;

  IF v_type = 'string_array' THEN
    IF v_json_type <> 'array' THEN
      RETURN false;
    END IF;

    SELECT count(*), count(DISTINCT item)
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements_text(v_value) AS item;

    IF v_count IS DISTINCT FROM v_distinct_count THEN
      RETURN false;
    END IF;

    RETURN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_value) AS item
      WHERE item NOT IN ('free', 'premium', 'vip')
    );
  END IF;

  RETURN false;
EXCEPTION
  WHEN others THEN
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_tier_config_override_valid(
  p_capability_key text,
  p_value jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_type text := public.tier_capability_type(p_capability_key);
  v_value jsonb := COALESCE(p_value, 'null'::jsonb);
  v_json_type text := jsonb_typeof(COALESCE(p_value, 'null'::jsonb));
  v_num numeric;
  v_count int;
  v_distinct_count int;
BEGIN
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'invalid capability_key'
      USING ERRCODE = '22023',
            DETAIL = p_capability_key;
  END IF;

  IF v_type = 'boolean' THEN
    IF v_json_type IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'capability value must be boolean'
        USING ERRCODE = '22023',
              DETAIL = p_capability_key;
    END IF;
    RETURN;
  END IF;

  IF v_type IN ('number', 'number_or_null') THEN
    IF v_json_type = 'null' AND v_type = 'number_or_null' THEN
      RETURN;
    END IF;

    IF v_json_type IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'capability value must be a non-negative integer'
        USING ERRCODE = '22023',
              DETAIL = p_capability_key;
    END IF;

    v_num := (v_value #>> '{}')::numeric;
    IF v_num < 0 OR v_num > 2147483647 OR trunc(v_num) <> v_num THEN
      RAISE EXCEPTION 'capability value must be a non-negative integer'
        USING ERRCODE = '22023',
              DETAIL = p_capability_key;
    END IF;
    RETURN;
  END IF;

  IF v_type = 'string_array' THEN
    IF v_json_type IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'capability value must be an array'
        USING ERRCODE = '22023',
              DETAIL = p_capability_key;
    END IF;

    SELECT count(*), count(DISTINCT item)
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements_text(v_value) AS item;

    IF v_count IS DISTINCT FROM v_distinct_count THEN
      RAISE EXCEPTION 'capability array values must be unique'
        USING ERRCODE = '22023',
              DETAIL = p_capability_key;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_value) AS item
      WHERE item NOT IN ('free', 'premium', 'vip')
    ) THEN
      RAISE EXCEPTION 'capability array contains an invalid event tier'
        USING ERRCODE = '22023',
              DETAIL = p_capability_key;
    END IF;
    RETURN;
  END IF;

  RAISE EXCEPTION 'invalid capability type'
    USING ERRCODE = '22023',
          DETAIL = COALESCE(v_type, p_capability_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_tier_capability(
  p_tier_id text,
  p_capability_key text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tier text := CASE WHEN p_tier_id IN ('free', 'premium', 'vip') THEN p_tier_id ELSE 'free' END;
  v_value jsonb;
BEGIN
  SELECT o.value
  INTO v_value
  FROM public.tier_config_overrides o
  WHERE o.tier_id = v_tier
    AND o.capability_key = p_capability_key;

  IF FOUND THEN
    RETURN v_value;
  END IF;

  RETURN public.tier_capability_default(v_tier, p_capability_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_capabilities(p_tier_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tier text := CASE WHEN p_tier_id IN ('free', 'premium', 'vip') THEN p_tier_id ELSE 'free' END;
  v_access text[];
  v_caps jsonb;
BEGIN
  SELECT COALESCE(array_agg(item), ARRAY[]::text[])
  INTO v_access
  FROM jsonb_array_elements_text(public.resolve_tier_capability(v_tier, 'accessibleEventTiers')) AS item;

  v_caps := jsonb_build_object(
    'tierId', v_tier,
    'tierLabel', CASE v_tier WHEN 'premium' THEN 'Premium' WHEN 'vip' THEN 'VIP' ELSE 'Free' END,
    'isPremium', v_tier <> 'free',
    'canSeeLikedYou', public.resolve_tier_capability(v_tier, 'canSeeLikedYou'),
    'canCityBrowse', public.resolve_tier_capability(v_tier, 'canCityBrowse'),
    'canUseVibeSchedule', public.resolve_tier_capability(v_tier, 'canUseVibeSchedule'),
    'canSuggestDate', public.resolve_tier_capability(v_tier, 'canSuggestDate'),
    'hasBadge', public.resolve_tier_capability(v_tier, 'hasBadge'),
    'dailySwipeLimit', public.resolve_tier_capability(v_tier, 'dailySwipeLimit'),
    'monthlyEventJoins', public.resolve_tier_capability(v_tier, 'monthlyEventJoins'),
    'monthlyExtraTimeCredits', public.resolve_tier_capability(v_tier, 'monthlyExtraTimeCredits'),
    'monthlyExtendedVibeCredits', public.resolve_tier_capability(v_tier, 'monthlyExtendedVibeCredits'),
    'maxActiveConversations', public.resolve_tier_capability(v_tier, 'maxActiveConversations'),
    'dailyDropPriority', public.resolve_tier_capability(v_tier, 'dailyDropPriority'),
    'accessibleEventTiers', to_jsonb(v_access),
    'canAccessPremiumEvents', to_jsonb('premium' = ANY(v_access)),
    'canAccessVipEvents', to_jsonb('vip' = ANY(v_access))
  );

  v_caps := v_caps || jsonb_build_object(
    'badgeType',
    CASE
      WHEN COALESCE((v_caps->>'hasBadge')::boolean, false) THEN
        CASE v_tier WHEN 'vip' THEN 'vip' WHEN 'premium' THEN 'premium' ELSE NULL END
      ELSE NULL
    END
  );

  RETURN v_caps;
END;
$$;

CREATE OR REPLACE FUNCTION public._get_user_tier_capabilities_unchecked(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tier text;
BEGIN
  SELECT COALESCE(p.subscription_tier, 'free')
  INTO v_tier
  FROM public.profiles p
  WHERE p.id = p_user_id;

  RETURN public.get_tier_capabilities(COALESCE(v_tier, 'free'));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_tier_capabilities(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;

    IF v_uid IS DISTINCT FROM p_user_id
       AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN public._get_user_tier_capabilities_unchecked(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._get_user_tier_capability_bool_unchecked(
  p_user_id uuid,
  p_capability_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_value jsonb;
BEGIN
  v_value := public._get_user_tier_capabilities_unchecked(p_user_id)->p_capability_key;
  IF v_value IS NULL OR jsonb_typeof(v_value) <> 'boolean' THEN
    RETURN false;
  END IF;
  RETURN (v_value #>> '{}')::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION public._get_user_tier_capability_int_unchecked(
  p_user_id uuid,
  p_capability_key text
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_value jsonb;
BEGIN
  v_value := public._get_user_tier_capabilities_unchecked(p_user_id)->p_capability_key;
  IF v_value IS NULL OR jsonb_typeof(v_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_value) <> 'number' THEN
    RETURN NULL;
  END IF;
  RETURN (v_value #>> '{}')::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public._get_user_tier_capability_text_array_unchecked(
  p_user_id uuid,
  p_capability_key text
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_value jsonb;
  v_items text[];
BEGIN
  v_value := public._get_user_tier_capabilities_unchecked(p_user_id)->p_capability_key;
  IF v_value IS NULL OR jsonb_typeof(v_value) <> 'array' THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT COALESCE(array_agg(item), ARRAY[]::text[])
  INTO v_items
  FROM jsonb_array_elements_text(v_value) AS item;

  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public._user_can_access_event_visibility_unchecked(
  p_user_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_visibility text := lower(COALESCE(NULLIF(btrim(p_visibility), ''), 'free'));
  v_access text[];
BEGIN
  IF v_visibility = 'all' THEN
    RETURN true;
  END IF;

  v_access := public._get_user_tier_capability_text_array_unchecked(p_user_id, 'accessibleEventTiers');
  RETURN v_visibility = ANY(v_access);
END;
$$;

CREATE OR REPLACE FUNCTION public._user_monthly_event_join_count_unchecked(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::integer
  FROM public.event_registrations er
  WHERE er.profile_id = p_user_id
    AND er.registered_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND COALESCE(er.admission_status, 'confirmed') IN ('confirmed', 'waitlisted')
    AND COALESCE(er.admission_status, 'confirmed') NOT IN ('canceled', 'cancelled', 'removed')
$$;

CREATE OR REPLACE FUNCTION public._user_active_conversation_count_unchecked(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::integer
  FROM public.matches m
  WHERE (m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id)
    AND m.archived_at IS NULL
$$;

-- Normalize stale/derived override rows into canonical keys before adding the key check.
DO $$
DECLARE
  rec record;
  v_access text[];
  v_access_value jsonb;
  v_premium_override boolean;
  v_vip_override boolean;
BEGIN
  FOR rec IN
    SELECT DISTINCT tier_id
    FROM public.tier_config_overrides
      WHERE capability_key IN ('accessibleEventTiers', 'canAccessPremiumEvents', 'canAccessVipEvents')
  LOOP
    SELECT o.value
    INTO v_access_value
    FROM public.tier_config_overrides o
    WHERE o.tier_id = rec.tier_id
      AND o.capability_key = 'accessibleEventTiers'
      AND jsonb_typeof(o.value) = 'array';

    IF FOUND THEN
      SELECT COALESCE(array_agg(item), ARRAY[]::text[])
      INTO v_access
      FROM jsonb_array_elements_text(v_access_value) AS item
      WHERE item IN ('free', 'premium', 'vip');
    ELSE
      SELECT COALESCE(array_agg(item), ARRAY[]::text[])
      INTO v_access
      FROM jsonb_array_elements_text(public.tier_capability_default(rec.tier_id, 'accessibleEventTiers')) AS item;
    END IF;

    SELECT (value #>> '{}')::boolean
    INTO v_premium_override
    FROM public.tier_config_overrides
    WHERE tier_id = rec.tier_id
      AND capability_key = 'canAccessPremiumEvents'
      AND jsonb_typeof(value) = 'boolean';

    IF FOUND THEN
      IF v_premium_override THEN
        v_access := array_append(array_remove(v_access, 'premium'), 'premium');
      ELSE
        v_access := array_remove(v_access, 'premium');
      END IF;
    END IF;

    SELECT (value #>> '{}')::boolean
    INTO v_vip_override
    FROM public.tier_config_overrides
    WHERE tier_id = rec.tier_id
      AND capability_key = 'canAccessVipEvents'
      AND jsonb_typeof(value) = 'boolean';

    IF FOUND THEN
      IF v_vip_override THEN
        v_access := array_append(array_remove(array_append(array_remove(v_access, 'premium'), 'premium'), 'vip'), 'vip');
      ELSE
        v_access := array_remove(v_access, 'vip');
      END IF;
    END IF;

    DELETE FROM public.tier_config_overrides
    WHERE tier_id = rec.tier_id
      AND capability_key IN ('accessibleEventTiers', 'canAccessPremiumEvents', 'canAccessVipEvents');

    INSERT INTO public.tier_config_overrides (tier_id, capability_key, value, updated_at)
    VALUES (
      rec.tier_id,
      'accessibleEventTiers',
      COALESCE((
        SELECT jsonb_agg(tier ORDER BY array_position(ARRAY['free', 'premium', 'vip'], tier))
        FROM (
          SELECT DISTINCT unnest(COALESCE(v_access, ARRAY[]::text[])) AS tier
        ) tiers
        WHERE tier IN ('free', 'premium', 'vip')
      ), '[]'::jsonb),
      now()
    )
    ON CONFLICT (tier_id, capability_key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END LOOP;

  INSERT INTO public.tier_config_overrides (tier_id, capability_key, value, updated_by, updated_at)
  SELECT tier_id, 'monthlyExtraTimeCredits', value, updated_by, now()
  FROM public.tier_config_overrides
  WHERE capability_key = 'monthlyVideoDateCredits'
    AND jsonb_typeof(value) = 'number'
    AND (value #>> '{}')::numeric >= 0
    AND (value #>> '{}')::numeric <= 2147483647
    AND trunc((value #>> '{}')::numeric) = (value #>> '{}')::numeric
  ON CONFLICT (tier_id, capability_key)
  DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();

  INSERT INTO public.tier_config_overrides (tier_id, capability_key, value, updated_by, updated_at)
  SELECT tier_id, 'monthlyExtendedVibeCredits', value, updated_by, now()
  FROM public.tier_config_overrides
  WHERE capability_key = 'monthlyVideoDateCredits'
    AND tier_id = 'vip'
    AND jsonb_typeof(value) = 'number'
    AND (value #>> '{}')::numeric >= 0
    AND (value #>> '{}')::numeric <= 2147483647
    AND trunc((value #>> '{}')::numeric) = (value #>> '{}')::numeric
  ON CONFLICT (tier_id, capability_key)
  DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();

  DELETE FROM public.tier_config_overrides
  WHERE capability_key NOT IN (
    'canSeeLikedYou',
    'canCityBrowse',
    'canUseVibeSchedule',
    'canSuggestDate',
    'hasBadge',
    'dailySwipeLimit',
    'monthlyEventJoins',
    'monthlyExtraTimeCredits',
    'monthlyExtendedVibeCredits',
    'maxActiveConversations',
    'dailyDropPriority',
    'accessibleEventTiers'
  );

  DELETE FROM public.tier_config_overrides
  WHERE NOT public.tier_config_override_value_is_valid(capability_key, value);
END;
$$;

ALTER TABLE public.tier_config_overrides
  DROP CONSTRAINT IF EXISTS tier_config_overrides_capability_key_check;
ALTER TABLE public.tier_config_overrides
  ADD CONSTRAINT tier_config_overrides_capability_key_check
  CHECK (capability_key IN (
    'canSeeLikedYou',
    'canCityBrowse',
    'canUseVibeSchedule',
    'canSuggestDate',
    'hasBadge',
    'dailySwipeLimit',
    'monthlyEventJoins',
    'monthlyExtraTimeCredits',
    'monthlyExtendedVibeCredits',
    'maxActiveConversations',
    'dailyDropPriority',
    'accessibleEventTiers'
  ));

ALTER TABLE public.tier_config_overrides
  DROP CONSTRAINT IF EXISTS tier_config_overrides_value_check;
ALTER TABLE public.tier_config_overrides
  ADD CONSTRAINT tier_config_overrides_value_check
  CHECK (public.tier_config_override_value_is_valid(capability_key, value));

CREATE OR REPLACE FUNCTION public.set_tier_config_override(
  p_tier_id text,
  p_capability_key text,
  p_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_value jsonb;
  v_new_value jsonb := COALESCE(p_value, 'null'::jsonb);
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_tier_id NOT IN ('free', 'premium', 'vip') THEN
    RAISE EXCEPTION 'invalid tier_id' USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_tier_config_override_valid(p_capability_key, v_new_value);

  SELECT value INTO v_old_value
  FROM public.tier_config_overrides
  WHERE tier_id = p_tier_id AND capability_key = p_capability_key;

  INSERT INTO public.tier_config_overrides (tier_id, capability_key, value, updated_by, updated_at)
  VALUES (p_tier_id, p_capability_key, v_new_value, v_admin, now())
  ON CONFLICT (tier_id, capability_key)
  DO UPDATE SET value = EXCLUDED.value, updated_by = v_admin, updated_at = now();

  INSERT INTO public.tier_config_audit (tier_id, capability_key, old_value, new_value, action, admin_id)
  VALUES (p_tier_id, p_capability_key, v_old_value, v_new_value, 'set', v_admin);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_tier_config_override(
  p_tier_id text,
  p_capability_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_value jsonb;
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_tier_id NOT IN ('free', 'premium', 'vip') THEN
    RAISE EXCEPTION 'invalid tier_id' USING ERRCODE = '22023';
  END IF;

  IF public.tier_capability_type(p_capability_key) IS NULL THEN
    RAISE EXCEPTION 'invalid capability_key'
      USING ERRCODE = '22023',
            DETAIL = p_capability_key;
  END IF;

  SELECT value INTO v_old_value
  FROM public.tier_config_overrides
  WHERE tier_id = p_tier_id AND capability_key = p_capability_key;

  IF FOUND THEN
    DELETE FROM public.tier_config_overrides
    WHERE tier_id = p_tier_id AND capability_key = p_capability_key;

    INSERT INTO public.tier_config_audit (tier_id, capability_key, old_value, new_value, action, admin_id)
    VALUES (p_tier_id, p_capability_key, v_old_value, NULL, 'reset', v_admin);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id          uuid,
  p_user_lat         double precision DEFAULT NULL,
  p_user_lng         double precision DEFAULT NULL,
  p_is_premium       boolean          DEFAULT false,
  p_browse_lat       double precision DEFAULT NULL,
  p_browse_lng       double precision DEFAULT NULL,
  p_filter_radius_km double precision DEFAULT NULL
)
RETURNS TABLE(
  id                  uuid,
  title               text,
  description         text,
  cover_image         text,
  event_date          timestamptz,
  duration_minutes    integer,
  max_attendees       integer,
  current_attendees   integer,
  tags                text[],
  status              text,
  city                text,
  country             text,
  scope               text,
  latitude            double precision,
  longitude           double precision,
  radius_km           integer,
  distance_km         double precision,
  is_registered       boolean,
  computed_status     text,
  is_recurring        boolean,
  parent_event_id     uuid,
  occurrence_number   integer,
  language            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_is_admin            boolean;
  v_can_city_browse     boolean;
  v_profile_country     text;
  v_profile_lat         double precision;
  v_profile_lng         double precision;
  v_user_lat_eff        double precision;
  v_user_lng_eff        double precision;
  v_browse_lat_eff      double precision;
  v_browse_lng_eff      double precision;
  v_effective_lat       double precision;
  v_effective_lng       double precision;
  v_browse_requested    boolean;
  v_valid_user_coords   boolean;
  v_valid_browse_coords boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    p.country,
    public.profile_location_coord(p.location_data, 'lat'),
    public.profile_location_coord(p.location_data, 'lng')
  INTO
    v_profile_country,
    v_profile_lat,
    v_profile_lng
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  v_can_city_browse :=
    COALESCE(v_is_admin, false)
    OR COALESCE(public._get_user_tier_capability_bool_unchecked(p_user_id, 'canCityBrowse'), false);

  v_browse_requested := p_browse_lat IS NOT NULL OR p_browse_lng IS NOT NULL;

  v_valid_user_coords :=
    p_user_lat IS NOT NULL
    AND p_user_lng IS NOT NULL
    AND p_user_lat BETWEEN -90 AND 90
    AND p_user_lng BETWEEN -180 AND 180;

  v_valid_browse_coords :=
    p_browse_lat IS NOT NULL
    AND p_browse_lng IS NOT NULL
    AND p_browse_lat BETWEEN -90 AND 90
    AND p_browse_lng BETWEEN -180 AND 180;

  IF NOT v_can_city_browse AND v_browse_requested THEN
    v_user_lat_eff := v_profile_lat;
    v_user_lng_eff := v_profile_lng;
  ELSE
    v_user_lat_eff := COALESCE(
      CASE WHEN v_valid_user_coords THEN p_user_lat ELSE NULL END,
      v_profile_lat
    );
    v_user_lng_eff := COALESCE(
      CASE WHEN v_valid_user_coords THEN p_user_lng ELSE NULL END,
      v_profile_lng
    );
  END IF;

  v_browse_lat_eff := CASE
    WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, v_user_lat_eff);
  v_effective_lng := COALESCE(v_browse_lng_eff, v_user_lng_eff);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.status, e.city, e.country, e.scope, e.latitude, e.longitude,
    e.radius_km,
    CASE
      WHEN e.latitude IS NOT NULL
           AND e.longitude IS NOT NULL
           AND v_effective_lat IS NOT NULL
           AND v_effective_lng IS NOT NULL
      THEN public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = e.id
        AND er.profile_id = p_user_id
    ) AS is_registered,
    CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'draft' THEN 'draft'
      WHEN e.ended_at IS NOT NULL THEN 'ended'
      WHEN now() >= e.event_date
           AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'live'
      WHEN now() >= (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'ended'
      ELSE 'upcoming'
    END AS computed_status,
    e.is_recurring, e.parent_event_id, e.occurrence_number,
    e.language
  FROM public.events e
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN e.scope = 'regional' THEN 'regional'
      WHEN e.scope = 'local' OR COALESCE(e.is_location_specific, false) THEN 'local'
      WHEN e.scope = 'global' THEN 'global'
      WHEN e.scope IS NULL AND (e.latitude IS NOT NULL OR e.longitude IS NOT NULL) THEN 'local'
      ELSE 'global'
    END AS discovery_scope
  ) ds
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND e.status IS DISTINCT FROM 'cancelled'
    AND COALESCE(e.is_recurring, false) = false
    AND public._user_can_access_event_visibility_unchecked(p_user_id, COALESCE(e.visibility, 'all'))
    AND now() <= COALESCE(
      e.ended_at,
      e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute'
    ) + interval '6 hours'

    AND (
      ds.discovery_scope = 'global'

      OR (
        ds.discovery_scope = 'regional'
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND (
          e.country IS NULL
          OR e.country = v_profile_country
          OR v_can_city_browse
        )
      )

      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= COALESCE(e.radius_km, 50)::double precision
      )
    )

    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR ds.discovery_scope IN ('global', 'regional')
      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= p_filter_radius_km
      )
    )

  ORDER BY
    CASE
      WHEN now() >= e.event_date
           AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_visibility text;
  v_max_attendees integer;
  v_current_attendees integer;
  v_status text;
  v_already boolean;
  v_monthly_limit integer;
  v_monthly_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status
  INTO v_visibility, v_max_attendees, v_current_attendees, v_status
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.archived_at IS NULL
    AND e.status IS NOT NULL
    AND e.status NOT IN ('draft', 'cancelled', 'ended')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found or not open for registration');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_registrations er
    WHERE er.event_id = p_event_id AND er.profile_id = v_user_id
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered');
  END IF;

  IF v_max_attendees IS NOT NULL
     AND v_current_attendees IS NOT NULL
     AND v_current_attendees >= v_max_attendees THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event is full');
  END IF;

  IF NOT public._user_can_access_event_visibility_unchecked(v_user_id, COALESCE(v_visibility, 'all')) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', CASE WHEN v_visibility = 'vip' THEN 'This event requires a VIP subscription' ELSE 'This event requires a Premium subscription' END,
      'code', 'TIER_MISMATCH'
    );
  END IF;

  v_monthly_limit := public._get_user_tier_capability_int_unchecked(v_user_id, 'monthlyEventJoins');
  IF v_monthly_limit IS NOT NULL THEN
    v_monthly_count := public._user_monthly_event_join_count_unchecked(v_user_id);
    IF v_monthly_count >= v_monthly_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Monthly event join limit reached',
        'code', 'MONTHLY_EVENT_JOIN_LIMIT_REACHED',
        'limit', v_monthly_limit
      );
    END IF;
  END IF;

  INSERT INTO public.event_registrations (event_id, profile_id, admission_status, payment_status)
  VALUES (p_event_id, v_user_id, 'confirmed', 'free');

  RETURN jsonb_build_object('success', true, 'admission_status', 'confirmed');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered');
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_event_ticket_checkout(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_existing record;
  v_visibility text;
  v_max int;
  v_current int;
  v_status text;
  v_archived timestamptz;
  v_reg record;
  v_full boolean;
  v_result jsonb;
  v_monthly_limit integer;
  v_monthly_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'FORBIDDEN');
  END IF;

  IF p_checkout_session_id IS NULL OR p_profile_id IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_args', 'code', 'INVALID_ARGS');
  END IF;

  SELECT outcome, result
  INTO v_existing
  FROM public.stripe_event_ticket_settlements
  WHERE checkout_session_id = p_checkout_session_id;

  IF FOUND AND v_existing.outcome IS DISTINCT FROM 'in_progress' THEN
    RETURN v_existing.result || jsonb_build_object('idempotent', true, 'outcome', v_existing.outcome);
  END IF;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.stripe_event_ticket_settlements (checkout_session_id, profile_id, event_id, outcome, result)
      VALUES (p_checkout_session_id, p_profile_id, p_event_id, 'in_progress', '{}'::jsonb);
    EXCEPTION
      WHEN unique_violation THEN
        SELECT outcome, result INTO v_existing
        FROM public.stripe_event_ticket_settlements
        WHERE checkout_session_id = p_checkout_session_id;
        IF FOUND AND v_existing.outcome IS DISTINCT FROM 'in_progress' THEN
          RETURN v_existing.result || jsonb_build_object('idempotent', true);
        END IF;
    END;
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status, e.archived_at
  INTO v_visibility, v_max, v_current, v_status, v_archived
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_archived IS NOT NULL
     OR v_status IS NULL
     OR v_status IN ('draft', 'cancelled', 'ended') THEN
    v_result := jsonb_build_object(
      'success', false,
      'admission_status', null,
      'error', 'event_not_admissible',
      'code', 'EVENT_CLOSED'
    );
    UPDATE public.stripe_event_ticket_settlements
    SET outcome = 'rejected_event', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
  END IF;

  IF NOT public._user_can_access_event_visibility_unchecked(p_profile_id, COALESCE(v_visibility, 'all')) THEN
    v_result := jsonb_build_object(
      'success', false,
      'error', CASE WHEN v_visibility = 'vip' THEN 'tier_mismatch_vip' ELSE 'tier_mismatch_premium' END,
      'code', 'TIER_MISMATCH'
    );
    UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_tier', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = p_profile_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_reg.admission_status = 'confirmed' THEN
      IF v_reg.payment_status IS DISTINCT FROM 'paid' THEN
        UPDATE public.event_registrations
        SET payment_status = 'paid'
        WHERE event_id = p_event_id AND profile_id = p_profile_id;
      END IF;
      v_result := jsonb_build_object(
        'success', true,
        'admission_status', 'confirmed',
        'code', 'ALREADY_CONFIRMED'
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'noop_already_confirmed', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;

    IF v_reg.admission_status = 'waitlisted' THEN
      UPDATE public.event_registrations
      SET payment_status = 'paid'
      WHERE event_id = p_event_id AND profile_id = p_profile_id;

      v_full := (v_max IS NOT NULL AND v_current IS NOT NULL AND v_current >= v_max);
      IF NOT v_full THEN
        UPDATE public.event_registrations
        SET admission_status = 'confirmed'
        WHERE event_id = p_event_id AND profile_id = p_profile_id;
        v_result := jsonb_build_object(
          'success', true,
          'admission_status', 'confirmed',
          'code', 'PROMOTED_FROM_WAITLIST'
        );
        UPDATE public.stripe_event_ticket_settlements SET outcome = 'promoted_waitlist', result = v_result
        WHERE checkout_session_id = p_checkout_session_id;
        RETURN v_result;
      END IF;

      v_result := jsonb_build_object(
        'success', true,
        'admission_status', 'waitlisted',
        'code', 'STILL_WAITLISTED'
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'waitlisted_existing', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;

    v_result := jsonb_build_object(
      'success', false,
      'error', 'existing_registration_state',
      'code', 'CONFLICT'
    );
    UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_conflict', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
  END IF;

  v_monthly_limit := public._get_user_tier_capability_int_unchecked(p_profile_id, 'monthlyEventJoins');
  IF v_monthly_limit IS NOT NULL THEN
    v_monthly_count := public._user_monthly_event_join_count_unchecked(p_profile_id);
    IF v_monthly_count >= v_monthly_limit THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'monthly_event_join_limit_reached',
        'code', 'MONTHLY_EVENT_JOIN_LIMIT_REACHED',
        'limit', v_monthly_limit
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_monthly_limit', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;
  END IF;

  v_full := (v_max IS NOT NULL AND v_current IS NOT NULL AND v_current >= v_max);

  IF v_full THEN
    INSERT INTO public.event_registrations (
      event_id, profile_id, admission_status, payment_status
    ) VALUES (
      p_event_id, p_profile_id, 'waitlisted', 'paid'
    );
    v_result := jsonb_build_object(
      'success', true,
      'admission_status', 'waitlisted',
      'code', 'PAID_WAITLIST'
    );
  ELSE
    INSERT INTO public.event_registrations (
      event_id, profile_id, admission_status, payment_status
    ) VALUES (
      p_event_id, p_profile_id, 'confirmed', 'paid'
    );
    v_result := jsonb_build_object(
      'success', true,
      'admission_status', 'confirmed',
      'code', 'CONFIRMED'
    );
  END IF;

  UPDATE public.stripe_event_ticket_settlements
  SET outcome = v_result->>'admission_status',
      result = v_result
  WHERE checkout_session_id = p_checkout_session_id;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    v_result := jsonb_build_object('success', false, 'error', 'already_registered', 'code', 'UNIQUE');
    UPDATE public.stripe_event_ticket_settlements
    SET outcome = 'rejected_unique', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.replenish_monthly_credits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_processed int := 0;
  v_extra int;
  v_extended int;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_credits uc
      WHERE uc.user_id = p.id
        AND uc.last_replenished_at >= v_month_start
    )
  LOOP
    v_extra := COALESCE(public._get_user_tier_capability_int_unchecked(rec.user_id, 'monthlyExtraTimeCredits'), 0);
    v_extended := COALESCE(public._get_user_tier_capability_int_unchecked(rec.user_id, 'monthlyExtendedVibeCredits'), 0);

    IF v_extra <= 0 AND v_extended <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits, last_replenished_at)
    VALUES (rec.user_id, v_extra, v_extended, now())
    ON CONFLICT (user_id) DO UPDATE SET
      extra_time_credits = public.user_credits.extra_time_credits + v_extra,
      extended_vibe_credits = public.user_credits.extended_vibe_credits + v_extended,
      last_replenished_at = now();

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'month', v_month_start);
END;
$$;

DROP FUNCTION IF EXISTS public.handle_swipe_20260507190000_tier_authority_base(uuid, uuid, uuid, text);
ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260507190000_tier_authority_base;
REVOKE ALL ON FUNCTION public.handle_swipe_20260507190000_tier_authority_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260507190000_tier_authority_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_daily_limit integer;
  v_daily_count integer;
  v_actor_conversation_limit integer;
  v_target_conversation_limit integer;
  v_actor_conversation_count integer;
  v_target_conversation_count integer;
  v_would_create_match boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  v_daily_limit := public._get_user_tier_capability_int_unchecked(p_actor_id, 'dailySwipeLimit');
  IF v_daily_limit IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_daily_count
    FROM public.event_swipes es
    WHERE es.actor_id = p_actor_id
      AND es.created_at >= v_day_start;

    IF v_daily_count >= v_daily_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'daily_swipe_limit_reached',
        'result', 'daily_swipe_limit_reached',
        'error', 'daily_swipe_limit_reached',
        'code', 'DAILY_SWIPE_LIMIT_REACHED',
        'limit', v_daily_limit
      );
    END IF;
  END IF;

  IF p_swipe_type IN ('vibe', 'super_vibe') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_target_id
        AND es.target_id = p_actor_id
        AND es.swipe_type IN ('vibe', 'super_vibe')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE (m.profile_id_1 = LEAST(p_actor_id, p_target_id)
             AND m.profile_id_2 = GREATEST(p_actor_id, p_target_id))
         OR (m.profile_id_1 = GREATEST(p_actor_id, p_target_id)
             AND m.profile_id_2 = LEAST(p_actor_id, p_target_id))
    )
    INTO v_would_create_match;

    IF v_would_create_match THEN
      v_actor_conversation_limit := public._get_user_tier_capability_int_unchecked(p_actor_id, 'maxActiveConversations');
      v_target_conversation_limit := public._get_user_tier_capability_int_unchecked(p_target_id, 'maxActiveConversations');
      v_actor_conversation_count := public._user_active_conversation_count_unchecked(p_actor_id);
      v_target_conversation_count := public._user_active_conversation_count_unchecked(p_target_id);

      IF v_actor_conversation_limit IS NOT NULL
         AND v_actor_conversation_count >= v_actor_conversation_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'outcome', 'active_conversation_limit_reached',
          'result', 'active_conversation_limit_reached',
          'error', 'active_conversation_limit_reached',
          'code', 'ACTIVE_CONVERSATION_LIMIT_REACHED',
          'limit', v_actor_conversation_limit
        );
      END IF;

      IF v_target_conversation_limit IS NOT NULL
         AND v_target_conversation_count >= v_target_conversation_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'outcome', 'target_active_conversation_limit_reached',
          'result', 'target_active_conversation_limit_reached',
          'error', 'target_active_conversation_limit_reached',
          'code', 'TARGET_ACTIVE_CONVERSATION_LIMIT_REACHED',
          'limit', v_target_conversation_limit
        );
      END IF;
    END IF;
  END IF;

  RETURN public.handle_swipe_20260507190000_tier_authority_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_daily_drop_candidates(p_user_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid, name text, age integer, gender text, avatar_url text, photos text[],
  bio text, tagline text, location text, looking_for text, height_cm integer,
  job text, company text, about_me text, prompts jsonb, lifestyle jsonb,
  vibe_caption text, photo_verified boolean, phone_verified boolean,
  bunny_video_status text, vibe_video_status text, interested_in text[]
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.age, p.gender, p.avatar_url, p.photos,
    p.bio, p.tagline, p.location,
    COALESCE(p.relationship_intent, p.looking_for),
    p.height_cm,
    p.job, p.company, p.about_me, p.prompts, p.lifestyle,
    p.vibe_caption, p.photo_verified, p.phone_verified,
    p.bunny_video_status, p.vibe_video_status, p.interested_in
  FROM public.profiles p
  WHERE p.id != p_user_id
    AND public.is_profile_discoverable(p.id, p_user_id)
    AND check_gender_compatibility(p_user_id, p.gender, p.interested_in)
  ORDER BY
    COALESCE(public._get_user_tier_capability_int_unchecked(p.id, 'dailyDropPriority'), 0) DESC,
    random()
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_user_schedule_tier_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND auth.uid() IS NOT NULL
     AND auth.uid() = v_user_id
     AND NOT public._get_user_tier_capability_bool_unchecked(v_user_id, 'canUseVibeSchedule') THEN
    RAISE EXCEPTION 'Vibe Schedule is not enabled for your tier'
      USING ERRCODE = '42501',
            DETAIL = 'canUseVibeSchedule';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_user_schedule_tier_capability_trigger ON public.user_schedules;
CREATE TRIGGER enforce_user_schedule_tier_capability_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.user_schedules
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_schedule_tier_capability();

CREATE OR REPLACE FUNCTION public.date_suggestion_apply_v2(p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match_id uuid := nullif(p_payload->>'match_id', '')::uuid;
  v_suggestion_id uuid := nullif(p_payload->>'suggestion_id', '')::uuid;
  v_match record;
  v_existing public.date_suggestions;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_share_requested boolean := lower(COALESCE(p_payload->'revision'->>'schedule_share_enabled', 'false')) IN ('true', 't', '1', 'yes');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF p_action IN ('create_draft', 'update_draft', 'send_proposal', 'counter')
     AND NOT public._get_user_tier_capability_bool_unchecked(v_uid, 'canSuggestDate') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'tier_capability_disabled',
      'error_code', 'tier_capability_disabled',
      'capability', 'canSuggestDate'
    );
  END IF;

  IF p_action IN ('send_proposal', 'counter')
     AND v_share_requested
     AND NOT public._get_user_tier_capability_bool_unchecked(v_uid, 'canUseVibeSchedule') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'tier_capability_disabled',
      'error_code', 'tier_capability_disabled',
      'capability', 'canUseVibeSchedule'
    );
  END IF;

  -- Preserve existing behavior for all non-send_proposal actions.
  IF p_action IS DISTINCT FROM 'send_proposal' THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  -- Existing suggestion flow should continue through canonical RPC behavior.
  IF v_suggestion_id IS NOT NULL THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  -- Let canonical RPC produce its own validation error when match_id is absent.
  IF v_match_id IS NULL THEN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  END IF;

  -- Lock match row first so concurrent send_proposal calls for same match serialize.
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = v_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'match_not_found');
  END IF;

  IF v_match.profile_id_1 <> v_uid AND v_match.profile_id_2 <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Single-open-suggestion rule: if one exists, return structured domain outcome.
  SELECT * INTO v_existing
  FROM public.date_suggestions
  WHERE match_id = v_match_id
    AND status IN ('draft', 'proposed', 'viewed', 'countered')
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- Product-safe reuse: proposer can continue their own draft.
    IF v_existing.proposer_id = v_uid AND v_existing.status = 'draft' THEN
      v_payload := jsonb_set(v_payload, '{suggestion_id}', to_jsonb(v_existing.id::text), true);
      RETURN public.date_suggestion_apply(p_action, v_payload);
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'active_suggestion_exists',
      'error_code', 'active_suggestion_exists',
      'suggestion_id', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  -- Race-safe fallback: if a concurrent insert still wins, map conflict to domain result.
  BEGIN
    RETURN public.date_suggestion_apply(p_action, v_payload);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing
      FROM public.date_suggestions
      WHERE match_id = v_match_id
        AND status IN ('draft', 'proposed', 'viewed', 'countered')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'active_suggestion_exists',
          'error_code', 'active_suggestion_exists',
          'suggestion_id', v_existing.id,
          'status', v_existing.status
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'error', 'date_suggestion_unique_conflict',
        'error_code', 'date_suggestion_unique_conflict'
      );
  END;
END;
$$;

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
SET search_path TO 'public', 'pg_catalog'
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
      AND NOT public.video_date_pair_has_terminal_encounter(p_event_id, p_user_id, base.profile_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_sessions vs
        WHERE vs.event_id = p_event_id
          AND (
            vs.participant_1_id = base.profile_id
            OR vs.participant_2_id = base.profile_id
          )
          AND public.event_lobby_video_session_blocks_new_match(
            vs.ready_gate_status,
            vs.state::text,
            vs.phase,
            vs.handshake_started_at,
            vs.date_started_at,
            vs.ended_at
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
    caps.value->>'badgeType' AS premium_badge,
    'available'::text AS availability_state
  FROM deck
  JOIN public.profiles p ON p.id = deck.profile_id
  CROSS JOIN LATERAL (
    SELECT public._get_user_tier_capabilities_unchecked(deck.profile_id) AS value
  ) caps;
END;
$function$;

DROP POLICY IF EXISTS "Users can view own vibes" ON public.event_vibes;
CREATE POLICY "Users can view own vibes"
ON public.event_vibes
FOR SELECT
USING (
  auth.uid() = sender_id
  OR (
    auth.uid() = receiver_id
    AND COALESCE((public.get_user_tier_capabilities(auth.uid())->>'canSeeLikedYou')::boolean, false)
    AND (
      public.profile_has_established_access(sender_id, auth.uid())
      OR public.is_profile_discoverable(sender_id, auth.uid())
    )
  )
);

REVOKE ALL ON FUNCTION public.tier_capability_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tier_capability_type(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tier_capability_default(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tier_capability_default(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tier_config_override_value_is_valid(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tier_config_override_value_is_valid(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_tier_config_override_valid(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_tier_config_override_valid(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_tier_capability(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_tier_capability(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tier_capabilities(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tier_capabilities(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_tier_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tier_capabilities(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._get_user_tier_capabilities_unchecked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_user_tier_capabilities_unchecked(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._get_user_tier_capability_bool_unchecked(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_user_tier_capability_bool_unchecked(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._get_user_tier_capability_int_unchecked(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_user_tier_capability_int_unchecked(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._get_user_tier_capability_text_array_unchecked(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._get_user_tier_capability_text_array_unchecked(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._user_can_access_event_visibility_unchecked(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_can_access_event_visibility_unchecked(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._user_monthly_event_join_count_unchecked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_monthly_event_join_count_unchecked(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._user_active_conversation_count_unchecked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_active_conversation_count_unchecked(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_user_schedule_tier_capability() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_user_schedule_tier_capability() TO service_role;

REVOKE ALL ON FUNCTION public.set_tier_config_override(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tier_config_override(text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.reset_tier_config_override(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_tier_config_override(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.replenish_monthly_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replenish_monthly_credits() TO service_role;
REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_daily_drop_candidates(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_drop_candidates(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.date_suggestion_apply_v2(text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.get_event_deck(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer) TO authenticated, service_role;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507190000',
  'Tier Config backend authority',
  'schema+policy',
  'Moves tier capability resolution into SQL, validates override values, enforces tier gates in event discovery/registration/deck/date-suggestion/swipe paths, and normalizes stale tier_config_overrides rows. No user subscription_tier backfill is performed.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.get_tier_capabilities(text) IS
  'Returns backend-authoritative tier capabilities: code defaults merged with tier_config_overrides, including derived compatibility fields.';
COMMENT ON FUNCTION public.get_user_tier_capabilities(uuid) IS
  'Own-user/admin/service RPC for backend-authoritative tier capabilities resolved from profiles.subscription_tier.';
COMMENT ON FUNCTION public.set_tier_config_override(text, text, jsonb) IS
  'Admin-only setter for validated tier capability overrides. SQL NULL is persisted as JSON null and every change is audited.';
COMMENT ON FUNCTION public.reset_tier_config_override(text, text) IS
  'Admin-only reset for tier capability overrides. Audits row deletion even when old value is JSON null.';
COMMENT ON FUNCTION public.tier_config_override_value_is_valid(text, jsonb) IS
  'Immutable check used by tier_config_overrides_value_check so direct table writes cannot bypass capability value validation.';
COMMENT ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) IS
  'Returns discover/home-visible events for authenticated p_user_id. City browsing and event visibility are resolved through backend tier capabilities; p_is_premium is ignored.';
