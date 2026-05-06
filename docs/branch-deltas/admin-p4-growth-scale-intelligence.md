# Admin P4 Growth-Scale Intelligence Rebuild Delta

## Summary

P4 adds the first growth-scale intelligence layer for `/kaan`: product metrics, event liquidity, match quality, trust triage, experimentation, growth attribution, revenue intelligence, compliance export queues, native/store evidence, cost snapshots, and quality budgets.

This slice preserves P0-P3 invariants:

- Events read paths remain read-only.
- High-impact admin actions remain backend-owned and audited.
- P4 scores are advisory only.
- No automated moderation, refunds, entitlement changes, deletions, provider sends, or provider repairs were added.

## Code Delta

- Added `/kaan` Intelligence panel:
  - `src/components/admin/AdminP4IntelligencePanel.tsx`
  - `src/pages/admin/AdminDashboard.tsx`
  - `src/components/admin/AdminSidebar.tsx`
- Added shared analytics taxonomy and sanitizer:
  - `shared/analytics/productIntelligence.ts`
  - wired in `src/lib/analytics.ts`
  - wired in `apps/mobile/lib/analytics.ts`
- Extended report resolution UI to attach policy category context to the P4/P2 report RPC path:
  - `src/components/admin/AdminReportsPanel.tsx`
- Added Edge Function wrappers:
  - `supabase/functions/record-growth-attribution`
  - `supabase/functions/admin-data-export`
- Added P4 source-contract test script:
  - `shared/admin/adminP4IntelligenceContracts.test.ts`
  - `npm run test:admin-p4-intelligence`

## Supabase Delta

### Migrations

- `20260506130000_admin_p4_intelligence_foundation.sql`
- `20260506131000_admin_p4_event_match_intelligence.sql`
- `20260506132000_admin_p4_trust_support_compliance.sql`
- `20260506133000_admin_p4_experiments_growth.sql`
- `20260506134000_admin_p4_revenue_store_cost_quality.sql`

### Validation

- `supabase/validation/admin_p4_growth_scale_intelligence.sql`

### Function Config

- `record-growth-attribution`: `verify_jwt = false`
- `admin-data-export`: `verify_jwt = true`

## Provider Delta

No provider dashboard, DNS, CDN, app id, webhook destination, secret, or provider-side configuration was changed.

## Route Delta

- Existing `/kaan` and `/kaan/dashboard` routes remain unchanged.
- One new internal admin panel key was added: `intelligence`.

## Migration Classification

All P4 migrations are additive `schema+policy` or schema/RPC governance additions. They create reference/evidence tables and read/admin RPCs. They do not perform destructive deletes, provider mutations, user fixture writes, or entitlement backfills.

## Validation

Expected local validation:

```bash
npm run test:admin-p4-intelligence
npm run test:admin-p3-operations
npm run test:admin-p2-backend-contracts
npm run test:admin-p1-ui-safety
npm run test:admin-events-p0
npm run test:admin-route-access
npm run typecheck
npm run lint
npm run build
npm run launch:preflight
supabase db push --linked --dry-run
supabase db lint --linked
```

Cloud migration/function deployment is a separate reviewed release step.

## Deferred P4/P5 Work

- Full BI/data warehouse.
- ML-driven matching or autonomous moderation.
- Provider-dashboard API reconciliation beyond existing P3 app-layer health.
- Automated export file generation worker and storage delivery.
- Store dashboard API imports.
- Advanced fraud graph/device intelligence.
