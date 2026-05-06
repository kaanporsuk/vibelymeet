-- P3 /kaan operations foundation validation pack.
-- Read-only checks for admin operations, provider reconciliation, permissions,
-- audit explorer, and rebuild-governance surfaces.

select
  'admin_p3_operations_foundation_permission_tables_exist' as check_name,
  to_regclass('public.admin_permissions') is not null
  and to_regclass('public.admin_role_permissions') is not null as ok;

select
  'admin_p3_governance_tables_exist' as check_name,
  to_regclass('public.migration_classifications') is not null
  and to_regclass('public.rebuild_rehearsal_runs') is not null as ok;

select
  'admin_p3_read_rpcs_exist' as check_name,
  count(*) = 7 as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_get_admin_permissions',
    'admin_has_permission',
    'admin_get_system_health',
    'admin_get_provider_health',
    'admin_get_rebuild_status',
    'admin_get_incident_signals',
    'admin_search_admin_audit_logs'
  );

select
  'admin_p3_rpcs_are_security_definer' as check_name,
  bool_and(p.prosecdef) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_get_admin_permissions',
    'admin_has_permission',
    'admin_get_system_health',
    'admin_get_provider_health',
    'admin_get_rebuild_status',
    'admin_get_incident_signals',
    'admin_search_admin_audit_logs'
  );

select
  'admin_p3_permission_seed_exists' as check_name,
  exists (select 1 from public.admin_permissions where permission = 'ops.read')
  and exists (select 1 from public.admin_permissions where permission = 'providers.read')
  and exists (select 1 from public.admin_permissions where permission = 'rebuild.read')
  and exists (select 1 from public.admin_permissions where permission = 'audit.read') as ok;

select
  'admin_p3_migration_classification_exists' as check_name,
  exists (
    select 1
    from public.migration_classifications
    where migration_version = '20260506120000'
      and classification = 'schema+policy'
  ) as ok;
