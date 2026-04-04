# Native Post-RC Cleanup Audit

## Scope

Broader native cleanup not required for RC, with safe removals only.

## Ranked Findings

1. Remove: dead `restorePurchases()` wrapper in `apps/mobile/lib/revenuecat.ts`.
2. Keep for compatibility: deprecated attendee-preview mapping wrappers still referenced by events list.
3. Keep for compatibility: daily-drop schedule helpers still imported by active daily-drop and badge flows.

## Removal Applied

- Deleted `restorePurchases()` from `apps/mobile/lib/revenuecat.ts`.

## Safety Evidence

- Active restore flows in account/premium use `restorePurchasesWithCustomerInfo()`.
- Event/date/chat/provider bootstrap paths are unchanged in this pass.
- No backend/public contract changes.

## Operational Constraints

- No native build run.
- No Supabase deploy run.# Native Post-RC Cleanup Audit

## Scope

Deferred-surface safe cleanup only.

## Safe Cleanup Applied

- Removed route registration for `match-celebration` from native app shell.
- Deleted `apps/mobile/app/match-celebration.tsx` because it had no live call sites in current native paths.

## Why This Is Safe

- Active event, date, and chat navigation paths do not push `match-celebration`.
- Provider bootstrap and route-transition-critical paths are unchanged.
- No backend/public contract or API surface changed.

## Notes

- Other deferred surfaces remain documented for later parking and were not changed in this pass.