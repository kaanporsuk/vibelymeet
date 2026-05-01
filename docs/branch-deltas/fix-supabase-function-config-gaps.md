# fix/supabase-function-config-gaps

## Problem

The historical rebuild notes called out `forward-geocode` and `push-webhook` as Supabase Edge Function config gaps. Current source already contains both functions and `supabase/config.toml` already represented both slugs, but older docs still carried stale inventory counts and did not make the final gateway/auth posture obvious enough for rebuild-sensitive deploys.

## Files Audited

- `supabase/config.toml`
- `supabase/functions/forward-geocode/index.ts`
- `supabase/functions/push-webhook/index.ts`
- `src/components/admin/AdminEventFormModal.tsx`
- `src/pages/onboarding/steps/LocationStep.tsx`
- `src/components/events/EventsFilterBar.tsx`
- `src/components/settings/DiscoveryDrawer.tsx`
- `apps/mobile/components/onboarding/steps/LocationStep.tsx`
- `apps/mobile/components/events/EventFilterSheet.tsx`
- `apps/mobile/app/settings/discovery.tsx`
- `src/components/admin/LiveNotificationMonitor.tsx`
- `src/hooks/usePushNotificationEvents.ts`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_supabase_provider_sheet.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `docs/post-audit-operational-verification-checklist.md`
- `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`
- `docs/notification-delivery-observability-audit.md`

## Final JWT Posture

- `forward-geocode`: `verify_jwt = true`
  - The gateway should require a Supabase JWT.
  - The function also resolves the caller through `supabaseUser.auth.getUser()`.
  - It allows admin/premium users and onboarding city search for incomplete profiles.
  - It applies a per-user rate limit before calling OpenStreetMap Nominatim.
- `push-webhook`: `verify_jwt = false`
  - Provider callbacks cannot present a Supabase user JWT.
  - The function fail-closes unless `PUSH_WEBHOOK_SECRET` is set and the request sends a matching `x-webhook-secret`.
  - It should remain externally reachable but secret-gated.

## Deploy Posture

Deploy required after merge: yes.

Only `supabase/config.toml` and docs/tests changed. No function source changed. Because the config file was touched to lock the intended posture in comments, deploy exactly these functions after merge so Supabase cloud is explicitly aligned:

```bash
supabase functions deploy forward-geocode --project-ref schdyxcunwcvddlcshwd
supabase functions deploy push-webhook --project-ref schdyxcunwcvddlcshwd
```

Do not deploy all functions. Supabase DB push: not required.

## Read-Only Supabase Check

- `supabase projects list` showed linked project `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd` showed both functions active:
  - `forward-geocode`: ACTIVE
  - `push-webhook`: ACTIVE
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd` showed `PUSH_WEBHOOK_SECRET` present by name/digest only. No secret values were printed.
- Supabase CLI function list does not expose `verify_jwt`; repo config remains the intended gateway source of truth, and the post-merge deploy locks it in cloud.

## `forward-geocode` City-Search Role

`forward-geocode` is an authenticated admin/premium/onboarding city search proxy for event creation, event filters, discovery settings, and onboarding-compatible city selection. It validates the user, checks admin or premium status, permits onboarding search while `profiles.onboarding_complete` is not true, rate-limits with the shared rate limiter, and calls OpenStreetMap Nominatim with settlement-focused query parameters.

No provider dashboard mutation is required for Nominatim. Manual follow-up is limited to confirming provider usage policy and contact/user-agent expectations if OpenStreetMap policy changes.

## `push-webhook` Receipt/Telemetry Role

`push-webhook` is a generic FCM/APNs/web receipt telemetry endpoint that writes or updates `push_notification_events`. It is not proven wired to OneSignal receipts from repository state alone. Stream 11 documentation and the notification observability audit both treat `push_notification_events` as separate provider/webhook/admin telemetry unless an external provider dashboard is confirmed to call this endpoint with the correct `x-webhook-secret`.

Manual follow-up:

1. Confirm whether OneSignal or any push provider is configured to call `/functions/v1/push-webhook?provider=fcm`, `/functions/v1/push-webhook?provider=apns`, or `/functions/v1/push-webhook?provider=web`.
2. Confirm the provider sends `x-webhook-secret` matching `PUSH_WEBHOOK_SECRET`.
3. Do not treat `push_notification_events` as transactional OneSignal delivery truth until correlation is intentionally wired and verified.

## Code Changes

- `supabase/config.toml`: added posture comments for `forward-geocode` and `push-webhook`.
- `_cursor_context/vibely_edge_function_manifest.md`: refreshed current function inventory count and documented the two function postures.
- `_cursor_context/vibely_supabase_provider_sheet.md`: refreshed current function inventory count and posture summary.
- `_cursor_context/vibely_external_dependency_ledger.md`: refreshed current Supabase function inventory count and added Stream 19 posture notes.
- `docs/post-audit-operational-verification-checklist.md`: clarified live verification for the two functions.
- `shared/matching/supabaseFunctionConfigGaps.test.ts`: added static/provider-contract coverage.

No Edge Function source code changed.

## Tests Added

- `shared/matching/supabaseFunctionConfigGaps.test.ts`

Coverage:

- both function sources exist
- all deployable functions are represented in `supabase/config.toml`
- final `verify_jwt` posture is explicit and documented
- `push-webhook` references and enforces `PUSH_WEBHOOK_SECRET`
- `forward-geocode` remains authenticated, user-gated, rate-limited city search
- no DB migration, env var, native module, or `expo-av` change
- Streams 1-18 artifacts remain present

## Environment And Safety

- Env var changes: none.
- Native modules: none.
- `expo-av`: not imported or required.
- Supabase migration: none.
- Supabase DB push: not required and not run.
- Local Supabase: not used.
- Docker: not used.
- Provider/webhook mutation: not performed.

## Manual Provider Follow-Up

- `forward-geocode`: confirm OpenStreetMap Nominatim usage policy remains compatible with Vibely's user-agent and city-search volume.
- `push-webhook`: confirm external provider dashboard wiring, if any, and confirm the provider sends `x-webhook-secret`.
- If no external push provider is wired to `push-webhook`, leave it documented as ready generic receipt telemetry rather than authoritative OneSignal delivery tracking.
