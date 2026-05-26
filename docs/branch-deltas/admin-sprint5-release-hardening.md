# Admin Sprint 5 Release Hardening

## Summary

Sprint 5 closes the admin remediation series with integration guardrails, consistent error rendering, and release notes for manual verification. It does not add new product surfaces; it makes the already-shipped Sprint 1-4 contracts harder to regress.

## Code Delta

- Added a shared admin UI error resolver:
  - `src/lib/adminErrorResolver.ts`
  - wraps RPC sanitization and Supabase Edge Function error parsing behind `resolveAdminErrorMessage` and `resolveAdminFunctionErrorMessage`
- Normalized admin failure rendering across `/kaan` panels so direct RPC, Edge Function, query, and mutation failures use the shared resolver.
- Added Sprint 5 regression coverage:
  - `shared/admin/adminSprint5ReleaseHardening.test.ts`
  - `npm run test:admin-sprint5-release-hardening`
- Added an explicit security-header script:
  - `npm run test:security-headers`
- Added the final public admin session invalidation interface:
  - `supabase/migrations/20260526040000_admin_role_session_invalidation_events.sql`
  - emits minimal `admin_session_invalidation_events` from `user_roles` changes and lets admin clients refetch `verify-admin` immediately without exposing the acting admin id to the affected session.
- Added the definitive admin gap-closure pass:
  - `supabase/migrations/20260526100000_admin_gap_closure_definitive.sql`
  - exposes durable admin job health, safe manual retry RPCs, meta-audit filtering, and server-side admin event pagination/filtering.
- Hardened proof-selfie direct media handling so Supabase storage is signed, trusted direct media origins must be explicit HTTPS allowlist entries, and unknown external URLs fail closed.
- Tightened admin event and photo verification behavior: photo “today” stats use UTC day starts, recurrence generation partial failures are warning-visible with retry, and event destructive confirmations use the shared admin dialog pattern.
- Operator env note: `REVENUECAT_SECRET_API_KEY` is required for RevenueCat subscriber cleanup, and `ADMIN_PROOF_SELFIE_TRUSTED_ORIGINS` can explicitly add trusted HTTPS direct proof-selfie media origins when proof selfies are not stored in Supabase.

## Release Behavior Notes

- Export errors now surface through non-200 Edge Function failures and sanitized admin UI messages instead of relying on HTTP 200 plus `{ success: false }`.
- Role revocation and non-admin sessions remain server-verified through `verify-admin`; `admin_session_invalidation_events` now provide an explicit realtime invalidation path, and transient verification failures keep a recoverable retry path instead of silently treating every failure as access denial.
- Deletion completion is job-gated. A request is not fully complete until durable cleanup has succeeded, including provider cleanup, media cleanup, PII/profile scrub, and Supabase auth deletion.
- Support delivery is visible through reply delivery jobs. Reply save can succeed while email or push delivery retries remain queued or warning-visible.
- UTC timestamps are the admin default unless a field is explicitly labeled as local or user time.
- Daily CSP stays pinned to explicit Daily origins: `https://vibelyapp.daily.co`, `https://api.daily.co`, and `wss://vibelyapp.daily.co`.
- Admin and support Edge Functions stay on shared allowlisted CORS helpers, including web origins and native/mobile `capacitor://localhost` compatibility.
- RevenueCat account deletion cleanup is externally enforced. Active RevenueCat subscriptions require provider deletion evidence or the durable job blocks with an explicit provider/configuration reason.
- Durable worker health is visible in Operations: cron readiness where discoverable, last worker run, backlog counts, blocked/permanent/retryable failures, stale processing jobs, and safe retry actions.
- Admin audit browsing hides meta-audit noise by default while retaining an explicit include toggle for incident reconstruction.
- Admin Events no longer depends on a 1000-row browser fetch; the read model accepts filters, returns `total_count`, and keeps counts correct even when the current page offset has gone stale.
- Proof-selfie signing refreshes only missing or near-expiry visible URLs with bounded concurrency, avoiding focus-time Edge Function bursts.

## Validation

Expected local validation before release:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:admin-events-p0
npm run test:admin-p1-ui-safety
npm run test:admin-p2-backend-contracts
npm run test:admin-p3-operations
npm run test:admin-media-lifecycle
npm run test:admin-p4-intelligence
npm run test:admin-route-access
npm run test:admin-sprint5-release-hardening
npm run test:client-feature-flags
npm run test:security-headers
```

Manual release checks still matter for device/browser confidence: admin login, non-admin login, role revocation while logged in, failed export, support email warning, deletion completion job state and retry, durable worker health, reports and events pagination/search, selfie URL expiry refresh and unknown external URL rejection, event recurrence preview and recurrence retry warning, keyboard row navigation, modal focus restoration, and UTC timestamp scan.
