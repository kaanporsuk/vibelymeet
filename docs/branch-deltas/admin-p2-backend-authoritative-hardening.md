# Branch Delta: Admin P2 Backend-Authoritative Hardening

**Date:** 2026-05-06  
**Scope:** `/kaan` admin backend hardening for transactional mutations, idempotency, audit logging, and authoritative metrics.

## Rebuild Impact

| Area | Change |
|------|--------|
| Database | Adds `admin_idempotency_keys`, shared admin JSON/idempotency/audit helpers, admin mutation RPCs, notification RPCs, support exception overloads, and admin metrics/search RPCs. |
| Web | `/kaan` admin mutation paths call semantic admin RPCs instead of browser-coordinated multi-table writes for credits, premium, moderation, event lifecycle, verification, notifications, and support exceptions. |
| Edge Functions | `admin-review-verification` is changed into a thin wrapper around `admin_review_photo_verification`. No provider-dashboard configuration changes. |
| Tests | Adds `npm run test:admin-p2-backend-contracts` plus P1 contract updates for backend-owned flows. |
| Validation | Adds `supabase/validation/admin_p2_backend_authoritative_hardening.sql` for read-only schema/RPC ACL/parity checks. |
| Env / Providers | Unchanged. No new secrets, provider IDs, feature flags, or route changes. |

## Migration

| File | Risk | Notes |
|------|------|-------|
| `supabase/migrations/20260506103000_admin_p2_backend_authoritative_hardening.sql` | High | Adds many admin RPCs and replaces selected admin function signatures with defaulted idempotency arguments. Intended deployment path is reviewed Supabase migration apply only. No data backfill or destructive row rewrite is included. |

## RPC Surfaces

Mutation/admin action RPCs include credits, premium, report resolution, direct moderation, photo verification, event create/update/lifecycle/archive/delete/recurring/reminder, notification list/count/bulk mark/delete, and support exception create/transition.

Read/admin metrics RPCs include overview metrics, user search, event metrics, notification counts, and push delivery metrics. Admin reporting windows are UTC-oriented.

## Safety Notes

- P0 Events read path remains read-only.
- P1 confirmation/honest-copy patterns remain in place.
- New backend actions derive admin identity from `auth.uid()` and verify `has_role(..., 'admin')`.
- New high-impact RPCs use `admin_idempotency_keys` for duplicate-click/retry protection.
- Successful mutations write `admin_activity_logs`; audit failure is intended to fail the transaction.
- The existing event-created email Edge Function call from the event form remains as a deferred notification ownership item; reminder/live/cancel claims are moved behind backend RPC semantics.

## Deploy Requirements

- Supabase migration deploy: required for production behavior to match this branch.
- Edge Function deploy: required for `admin-review-verification` wrapper change.
- Supabase type regeneration: recommended after local migration validation.
- No env/provider dashboard changes required.

## Validation

Run locally before cloud deploy:

```bash
npm run test:admin-events-p0
npm run test:admin-p1-ui-safety
npm run test:admin-route-access
npm run test:admin-p2-backend-contracts
npm run typecheck:core
npm run build
```

Optional after a linked local database is available:

```bash
supabase db reset
supabase db lint
```

## Deferred

- Provider telemetry reconciliation for OneSignal/Resend/Stripe/Bunny dashboards.
- Full audit-log viewer redesign and long-term moderator/support RBAC.
- Historical data backfills for report provenance or event-scoped report history.
- Moving event-created email dispatch into a fully backend-owned admin create-event transaction/queue.
