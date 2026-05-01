# Push, Media, Daily Provider Readiness Closure

Branch: `fix/push-media-daily-provider-readiness-closure`
Date: 2026-05-01

## Investigation Source

Investigation report: `docs/investigations/push-media-daily-provider-readiness.md`

Source report branch: `docs/investigate-push-media-daily-provider-readiness`

## Findings Addressed

### WARN-OS-DOC-DRIFT

The investigation found that OneSignal runtime code and Stream 11 tests are env-backed, but older provider docs still described a hardcoded/fallback frontend OneSignal app ID.

Addressed by updating:

- `_cursor_context/vibely_onesignal_provider_sheet.md`
- `_cursor_context/vibely_rebuild_runbook.md`

The docs now match `src/lib/onesignal.ts`: web OneSignal initialization reads `VITE_ONESIGNAL_APP_ID`; if it is unset or blank, web push initialization is skipped for that runtime. No checked-in fallback OneSignal app ID is documented as current behavior.

## Findings Deferred

### WARN-BUNNY-CHAT-OWNERSHIP

Deferred for product/provider ownership confirmation.

The investigation prompt expected `chat-videos` not to be Bunny-owned, while the closed Stream 12 baseline intentionally treats `upload-chat-video` as Bunny Storage under the `chat-videos/...` path prefix. Existing Stream 12 source, docs, and tests all agree on that current baseline.

This closure does not change `chat-videos/...` ownership because that would be a product/provider semantics change and should be handled in a separate approved stream if the prompt expectation is authoritative.

## Files Changed

- `docs/investigations/push-media-daily-provider-readiness.md`
- `docs/branch-deltas/fix-push-media-daily-provider-readiness-closure.md`
- `_cursor_context/vibely_onesignal_provider_sheet.md`
- `_cursor_context/vibely_rebuild_runbook.md`
- `shared/matching/pushMediaDailyProviderReadinessClosure.test.ts`

## Implementation

- Carried forward the investigation report into the closure branch so the PR has the cited source-of-truth report on `main`.
- Removed stale OneSignal hardcoded/fallback app-ID language from the provider sheet and rebuild runbook.
- Documented OneSignal web push as disabled when `VITE_ONESIGNAL_APP_ID` is unset.
- Preserved Bunny chat-video runtime/provider behavior and documented the ownership warning as deferred.

## Tests Added

- `shared/matching/pushMediaDailyProviderReadinessClosure.test.ts`

Coverage:

- investigation report and closure branch delta are present
- OneSignal provider docs no longer describe current frontend behavior as hardcoded/fallback app-ID based
- runtime OneSignal source still reads `VITE_ONESIGNAL_APP_ID` and disables push when unset
- Bunny chat-video ownership warning is deferred without changing the current Bunny-owned baseline
- no Supabase migration or validation SQL was added
- no Edge Function deploy requirement was introduced
- no env vars or native modules were added
- `expo-av` remains unused
- Stream 11, 12, and 13 artifacts remain present

## Rebuild Impact

Docs/tests only. Runtime behavior is unchanged.

## Route/Page Drift

None.

## Edge Functions

Changed: none.

Edge Function deploy requirement: none.

## Schema/Storage

Schema/storage changes: none.

Supabase migration requirement: none.

## Environment Variables

Env vars added/changed: none.

No new provider secret is required.

## Provider/Dashboard Changes

No provider dashboard mutation was performed.

Remaining manual follow-up:

- OneSignal dashboard app identity, REST key, origin/service-worker settings, controlled internal push smoke, and webhook receipt wiring.
- Bunny dashboard library/zone/CDN/webhook auth, controlled internal media smoke, and `chat-videos/...` provider ownership confirmation.
- Daily dashboard workspace/domain/token/private-room settings, quota health, and controlled internal video-date/match-call QA.

## Deployment Requirements

Supabase migration deploy: not required.

Edge Function deploy: not required.

Web/static deploy: not required for runtime behavior; normal host deployment/checks may run for the docs/test PR.

## Native

Native module changes: none.

`expo-av`: not used.

## Production Smoke Limitations

No real push, real media upload/delete/webhook, or real Daily room create/delete smoke was run. Any provider smoke remains a controlled internal manual follow-up.

## Safety Confirmation

- No Docker used.
- No local Supabase used.
- No Supabase cloud mutation before PR.
- No env vars changed.
- No unrelated provider/dashboard mutation.
- No native modules added.
- No `expo-av` import/require.
- No production data-mutating smoke run.
