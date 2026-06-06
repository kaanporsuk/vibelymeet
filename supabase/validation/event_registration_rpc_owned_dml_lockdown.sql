-- Read-only validation pack for Event Lobby registration RLS/DML authority.
-- Safe for production catalog verification after the migration is applied.

with checks(check_name, ok) as (
  select
    'event_registrations_auth_select_only',
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'event_registrations'
    )
    and not has_table_privilege('anon', 'public.event_registrations', 'SELECT')
    and not has_table_privilege('anon', 'public.event_registrations', 'INSERT')
    and not has_table_privilege('anon', 'public.event_registrations', 'UPDATE')
    and not has_table_privilege('anon', 'public.event_registrations', 'DELETE')
    and has_table_privilege('authenticated', 'public.event_registrations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.event_registrations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.event_registrations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.event_registrations', 'DELETE')
    and has_table_privilege('service_role', 'public.event_registrations', 'SELECT')
    and has_table_privilege('service_role', 'public.event_registrations', 'INSERT')
    and has_table_privilege('service_role', 'public.event_registrations', 'UPDATE')
    and has_table_privilege('service_role', 'public.event_registrations', 'DELETE')

  union all

  select
    'event_registrations_no_direct_dml_policies',
    not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'event_registrations'
        and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    )

  union all

  select
    'event_registration_rpc_execute_preserved',
    has_function_privilege('authenticated', 'public.register_for_event(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.cancel_event_registration(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.update_participant_status(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.register_for_event(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.cancel_event_registration(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_participant_status(uuid,text)', 'EXECUTE')

  union all

  select
    'event_swipes_auth_select_only',
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'event_swipes'
    )
    and has_table_privilege('authenticated', 'public.event_swipes', 'SELECT')
    and not has_table_privilege('authenticated', 'public.event_swipes', 'INSERT')
    and not has_table_privilege('authenticated', 'public.event_swipes', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.event_swipes', 'DELETE')
    and has_table_privilege('service_role', 'public.event_swipes', 'INSERT')
    and has_table_privilege('service_role', 'public.event_swipes', 'UPDATE')
    and has_table_privilege('service_role', 'public.event_swipes', 'DELETE')

  union all

  select
    'video_sessions_auth_select_only',
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'video_sessions'
    )
    and has_table_privilege('authenticated', 'public.video_sessions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.video_sessions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.video_sessions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.video_sessions', 'DELETE')
    and has_table_privilege('service_role', 'public.video_sessions', 'INSERT')
    and has_table_privilege('service_role', 'public.video_sessions', 'UPDATE')
    and has_table_privilege('service_role', 'public.video_sessions', 'DELETE')

  union all

  select
    'event_deck_card_reservations_service_only',
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'event_deck_card_reservations'
    )
    and not has_table_privilege('authenticated', 'public.event_deck_card_reservations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.event_deck_card_reservations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.event_deck_card_reservations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.event_deck_card_reservations', 'DELETE')
    and has_table_privilege('service_role', 'public.event_deck_card_reservations', 'SELECT')
    and has_table_privilege('service_role', 'public.event_deck_card_reservations', 'INSERT')
    and has_table_privilege('service_role', 'public.event_deck_card_reservations', 'UPDATE')
    and has_table_privilege('service_role', 'public.event_deck_card_reservations', 'DELETE')

  union all

  select
    'event_impression_tables_auth_own_select_only',
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'event_profile_impressions'
    )
    and (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'event_profile_impression_events'
    )
    and has_table_privilege('authenticated', 'public.event_profile_impressions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.event_profile_impressions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.event_profile_impressions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.event_profile_impressions', 'DELETE')
    and has_table_privilege('authenticated', 'public.event_profile_impression_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.event_profile_impression_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.event_profile_impression_events', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.event_profile_impression_events', 'DELETE')
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'event_profile_impressions'
        and cmd = 'SELECT'
        and qual like '%viewer_id = auth.uid()%'
    )
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'event_profile_impression_events'
        and cmd = 'SELECT'
        and qual like '%viewer_id = auth.uid()%'
    )
)
select check_name, ok
from checks
order by check_name;
