-- Read-only validation pack for profile_direct_select_self_only.
-- Matrix coverage:
-- - anon: direct public.profiles SELECT is denied and get_profile_for_viewer is not executable.
-- - authenticated self: safe direct columns are selectable only through self RLS; private owner fields use get_my_profile_settings.
-- - authenticated other user: direct public.profiles policies for matches/events/daily drop are absent; get_profile_for_viewer is canonical.
-- - blocked / not eligible other user: get_profile_for_viewer keeps its established-access and block/report gates.
-- - admin: admin profile read policy and admin read-model RPCs remain available.
-- - service_role: direct profile SELECT remains available for backend read models.
-- - direct table API vs get_profile_for_viewer: direct table grants exclude PII/backend columns; RPC returns safe other-user display only.
-- - list surfaces: get_profiles_for_viewer batches canonical per-profile checks without broad table grants.
-- - owner runtime payload: get_my_profile_settings executes under an owner claim without leaking values in validation output.

select
  'anon_direct_profiles_table_select_denied' as check_name,
  not has_table_privilege('anon', 'public.profiles', 'SELECT') as ok;

select
  'authenticated_direct_profiles_table_select_not_broad' as check_name,
  not has_table_privilege('authenticated', 'public.profiles', 'SELECT') as ok;

select
  'authenticated_direct_safe_owner_columns_allowed' as check_name,
  bool_and(has_column_privilege('authenticated', 'public.profiles', column_name, 'SELECT')) as ok
from unnest(array[
  'id',
  'name',
  'age',
  'avatar_url',
  'photos',
  'phone_verified',
  'subscription_tier',
  'event_discovery_prefs',
  'account_paused'
]) as t(column_name);

select
  'anon_no_direct_profile_column_grants' as check_name,
  bool_and(not has_column_privilege('anon', 'public.profiles', column_name, 'SELECT')) as ok
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles';

select
  'authenticated_private_profile_columns_revoked' as check_name,
  bool_and(not has_column_privilege('authenticated', 'public.profiles', column_name, 'SELECT')) as ok
from unnest(array[
  'birth_date',
  'location_data',
  'phone_number',
  'verified_email',
  'photo_verification_expires_at',
  'proof_selfie_url',
  'referred_by',
  'premium_until',
  'premium_granted_at',
  'premium_granted_by',
  'is_suspended',
  'suspension_reason',
  'last_seen_at',
  'phone_verified_at',
  'photo_verified_at',
  'community_agreed_at',
  'email_unsubscribed'
]) as t(column_name);

select
  'profiles_self_select_policy_only_for_non_admin' as check_name,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can view own profile'
      and cmd = 'SELECT'
      and qual = '(auth.uid() = id)'
  )
  and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname in (
        'Anyone can view profiles',
        'Authenticated users can view profiles',
        'Require authentication for profiles',
        'Users can view matched profiles',
        'Users can view event participant profiles',
        'Users can view potential matches for Daily Drop'
      )
  ) as ok;

select
  'admin_profile_policy_preserved' as check_name,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Admins can view all profiles'
      and cmd = 'SELECT'
  ) as ok;

select
  'service_role_direct_profile_select_preserved' as check_name,
  has_table_privilege('service_role', 'public.profiles', 'SELECT') as ok;

select
  'get_my_profile_settings_owner_rpc_acl' as check_name,
  p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and has_function_privilege('service_role', p.oid, 'EXECUTE')
  and not has_function_privilege('anon', p.oid, 'EXECUTE') as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_my_profile_settings';

select
  'get_profile_for_viewer_canonical_rpc_acl' as check_name,
  p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and has_function_privilege('service_role', p.oid, 'EXECUTE')
  and not has_function_privilege('anon', p.oid, 'EXECUTE')
  and pg_get_functiondef(p.oid) like '%profile_has_established_access%'
  and pg_get_functiondef(p.oid) like '%profiles_have_safety_block%'
  and pg_get_functiondef(p.oid) like '%''subscription_tier'', v_profile.subscription_tier%' as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_profile_for_viewer';

select
  'get_profiles_for_viewer_batch_rpc_acl' as check_name,
  p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and has_function_privilege('service_role', p.oid, 'EXECUTE')
  and not has_function_privilege('anon', p.oid, 'EXECUTE')
  and pg_get_functiondef(p.oid) like '%get_profile_for_viewer(ids.target_id)%'
  and pg_get_functiondef(p.oid) like '%v_count > 100%' as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_profiles_for_viewer';

with candidate as (
  select id
  from public.profiles
  order by updated_at desc nulls last, id
  limit 1
),
claim as (
  select set_config('request.jwt.claim.sub', (select id::text from candidate), true)
  where exists (select 1 from candidate)
),
payload as (
  select public.get_my_profile_settings() as body
  from claim
),
expected_keys as (
  select unnest(array[
    'id',
    'updated_at',
    'created_at',
    'name',
    'birth_date',
    'age',
    'gender',
    'interested_in',
    'tagline',
    'height_cm',
    'location',
    'country',
    'job',
    'company',
    'about_me',
    'bio',
    'looking_for',
    'relationship_intent',
    'onboarding_complete',
    'onboarding_stage',
    'lifestyle',
    'prompts',
    'photos',
    'avatar_url',
    'bunny_video_uid',
    'bunny_video_status',
    'vibe_video_status',
    'vibe_caption',
    'photo_verified',
    'photo_verified_at',
    'photo_verification_expires_at',
    'phone_number',
    'phone_verified',
    'phone_verified_at',
    'email_verified',
    'verified_email',
    'is_premium',
    'premium_until',
    'subscription_tier',
    'vibe_score',
    'vibe_score_label',
    'preferred_age_min',
    'preferred_age_max',
    'event_discovery_prefs',
    'discoverable',
    'discovery_mode',
    'discovery_snooze_until',
    'discovery_audience',
    'activity_status_visibility',
    'distance_visibility',
    'event_attendance_visibility',
    'show_online_status',
    'account_paused',
    'account_paused_until',
    'is_paused',
    'paused_at',
    'paused_until',
    'pause_reason',
    'is_suspended',
    'suspension_reason',
    'email_unsubscribed',
    'community_agreed_at',
    'referred_by',
    'referrer_name',
    'events_attended',
    'total_matches',
    'total_conversations'
  ]) as key
),
payload_keys as (
  select jsonb_object_keys(body) as key
  from payload
  where jsonb_typeof(body) = 'object'
)
select
  'get_my_profile_settings_owner_rpc_runtime_payload' as check_name,
  case
    when not exists (select 1 from candidate) then true
    else coalesce(
      (
        select
          jsonb_typeof(body) = 'object'
          and not exists (
            select 1
            from expected_keys expected
            left join payload_keys actual using (key)
            where actual.key is null
          )
          and not exists (
            select 1
            from payload_keys actual
            left join expected_keys expected using (key)
            where expected.key is null
          )
        from payload
      ),
      false
    )
  end as ok;
