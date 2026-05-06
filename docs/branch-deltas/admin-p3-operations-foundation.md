# Admin P3 Operations Foundation Rebuild Delta

## Summary

P3 begins the production-operations layer for `/kaan`: system health, provider reconciliation, incident signals, audit exploration, permission inventory, and rebuild governance.

This slice is intentionally read-only. It does not add provider repair actions, background jobs, provider API calls, or destructive data changes.

## Code Delta

- Added `/kaan` Operations Center panel:
  - `src/components/admin/AdminOperationsCenter.tsx`
  - `src/pages/admin/AdminDashboard.tsx`
  - `src/components/admin/AdminSidebar.tsx`
- Aligned existing P2 admin read surfaces:
  - `src/components/admin/AdminUsersPanel.tsx` now calls `admin_search_users` for list, filters, registration counts, and vibes instead of broad browser table aggregation.
  - `src/components/admin/AdminLiveEventMetrics.tsx` now calls `admin_get_event_metrics` for event-scoped counts and participant-report telemetry.
- Added P3 source-contract tests:
  - `shared/admin/adminP3OperationsContracts.test.ts`
  - `npm run test:admin-p3-operations`

## Supabase Delta

- Added migration:
  - `supabase/migrations/20260506120000_admin_p3_operations_foundation.sql`
- Added validation pack:
  - `supabase/validation/admin_p3_operations_foundation.sql`

### New Tables

- `admin_permissions`
- `admin_role_permissions`
- `migration_classifications`
- `rebuild_rehearsal_runs`

### New RPCs

- `admin_has_permission`
- `admin_get_admin_permissions`
- `admin_get_system_health`
- `admin_get_provider_health`
- `admin_get_rebuild_status`
- `admin_get_incident_signals`
- `admin_search_admin_audit_logs`

All new RPCs are `SECURITY DEFINER`, derive identity from `auth.uid()`, pin `search_path`, use the P3 permission model, and return typed JSON through the existing admin RPC pattern.

### Updated RPCs

- `admin_search_users` is redefined with server-side support for the existing `/kaan` Users panel filters and sorts:
  - `gender_bucket`
  - `relationship_intents`
  - `location_*`
  - `total_matches_*`
  - `registrations_*`

## Provider Delta

No provider dashboard, API key, webhook, DNS, CDN, or secret changes.

The provider health RPC is app-layer only. It separates:

- app truth from Supabase tables,
- provider truth that must be checked in provider dashboards,
- drift counts visible from app telemetry.

## Route Delta

- Existing `/kaan` and `/kaan/dashboard` routes remain unchanged.
- One new internal admin panel key was added: `operations`.

## Audit Tidy Delta

- Admin Users panel and user drawer now use `event_registrations` for registration-derived counts instead of the obsolete `events_attended` internal name.
- Event Analytics report copy now uses `Participant Reports` from `admin_get_event_metrics`, not the old global platform-report query.
- `test:admin-p1-ui-safety` now guards against reintroducing the misleading admin UI name.

## Migration Classification

`20260506120000_admin_p3_operations_foundation.sql`

- Classification: `schema+policy`
- Data impact: reference/governance rows only
- Destructive: no
- Backfill: no
- Provider mutation: no

## Validation

Expected local validation:

```bash
npm run test:admin-events-p0
npm run test:admin-p1-ui-safety
npm run test:admin-p2-backend-contracts
npm run test:admin-p3-operations
npm run test:admin-route-access
npm run typecheck:core
npm run typecheck
npm run lint
npm run build
```

Supabase validation:

```bash
supabase db push --linked --dry-run
supabase db lint --linked
```

Cloud migration/function deployment is a separate release step.

## Deferred P3 Work

- Provider API-backed reconciliation Edge Functions.
- Confirmed, audited repair actions.
- Full RBAC enforcement across all P2 mutation RPCs.
- Governed export generation and expiry.
- Logged rebuild rehearsal automation.
- CI golden-path smoke expansion.
- Incident runbook authoring for payment, media, push, Daily, auth/admin, and deploy drift.
