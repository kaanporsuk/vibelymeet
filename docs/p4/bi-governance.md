# P4 BI Governance

P4 starts with Supabase admin RPCs and PostHog. A warehouse is deferred until complexity or scale justifies it.

## Warehouse Thresholds

Consider a warehouse only when at least one condition is true:

- Product dashboards require cross-source joins that are too slow or expensive in Supabase/PostHog.
- Finance needs recurring cohort/LTV reporting across Stripe, RevenueCat, credits, and paid events.
- Trust/safety needs historical trend analysis beyond operational queues.
- Provider telemetry volume makes Supabase operational tables unsuitable for analytical scans.
- Leadership requires governed executive dashboards with versioned metric definitions.

## Non-Negotiables

- Warehouse is analytical only.
- Supabase/backend remains transactional product truth.
- PII and sensitive dating/trust data are minimized or redacted.
- BI access is permissioned and logged.
- Metric definitions are versioned and mapped back to source tables/RPCs.

## Current P4 Position

No new warehouse is introduced in this implementation. The current decision layer uses:

- P4 admin RPCs for backend-authoritative aggregates and deterministic scores.
- Shared analytics taxonomy for web/native event consistency.
- PostHog for consent-gated behavioral analytics.
- Manual/provider evidence ledgers for store, cost, and quality operations.
