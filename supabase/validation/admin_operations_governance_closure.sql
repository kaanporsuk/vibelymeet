-- Operations Center governance closure validation pack.
-- Read-only checks for migration classification coverage and rebuild rehearsal
-- evidence after 20260507203000_admin_operations_governance_closure.sql.

select
  'admin_operations_governance_closure_no_unclassified_applied_migrations' as check_name,
  not exists (
    select 1
    from supabase_migrations.schema_migrations sm
    left join public.migration_classifications mc
      on mc.migration_version = sm.version
    where mc.migration_version is null
  ) as ok;

select
  'admin_operations_governance_closure_passed_rehearsal_exists' as check_name,
  exists (
    select 1
    from public.rebuild_rehearsal_runs
    where id = '53df1867-ef76-4391-bf37-b39e0a3ff001'::uuid
      and status = 'passed'
      and scope = 'final-hardening-release-rehearsal'
  ) as ok;

select
  'admin_operations_governance_closure_rebuild_rpc_exposes_healthy_drivers' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_get_rebuild_status'
      and p.prosecdef
  )
  and exists (
    select 1
    from public.migration_classifications
    where migration_version = '20260507203000'
      and classification = 'schema+policy'
  ) as ok;
