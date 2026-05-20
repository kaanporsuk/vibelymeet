# Phase 7 Media Background Upload Decision

Date: 2026-05-19

ReviewAfter: 2026-11-19

## Decision

**NO-GO research-only for production OS-level background uploads.**

Phase 7 closes as a research spike and guardrail. The production contract remains the Phase 1-6 foreground persistent queue and recovery flow: web IndexedDB queue, native AsyncStorage queue, idempotent server receipts, source binding, retry, replacement fencing, and explicit recovery UI.

No runtime media service worker, native background task dependency, native upload bridge, feature flag, Supabase mutation, rollout change, web build, native build, browser automation, or device run is part of this phase.

At runtime, the web and native Media SDK factories emit `media_sdk_initialized` with `background_upload_policy_phase`, `background_upload_production_enabled`, `background_upload_decided_at`, `background_upload_review_after`, and `background_upload_source_of_truth`. That event is the production proof that foreground recovery, not OS-level background execution, is being enforced.

## Why

### Web

- Background Sync can defer work to a service worker when connectivity returns, but it is not available across every widely used browser and does not prove long media-transfer continuation by itself.
- Periodic Background Sync is experimental and limited-availability, so it cannot be a production floor for media reliability.
- The root web push worker is intentionally owned by OneSignal. OneSignal documents that only one service worker can be active for a given scope, and Vibely currently initializes OneSignal with root scope `/`.
- A non-root media worker probe under `/media/` remains a possible future experiment, but it must prove source recovery, retry idempotency, and zero push regression before any production path can depend on it.

### iOS

- Expo BackgroundTask is explicitly deferrable. It can nudge recovery work later, but it is not an immediate upload continuation engine.
- Reliable iOS upload continuation needs file-backed native URLSession background uploads and delegate restoration. The current JavaScript TUS/PUT clients must not be assumed to keep running after suspension or termination.
- Any real iOS proof requires native dependency/configuration work, a rebuilt binary, and real-device testing.
- `UIBackgroundModes` is intentionally limited to `remote-notification` and `audio` in both `apps/mobile/app.base.json` and the checked-in iOS `Info.plist` files. `voip` is not requested because the native app does not include a PushKit/PKPush incoming-call stack; Daily.co calls remain foreground/active-call features, and `audio` is the canonical source-config declaration for active-call media continuity. Neither mode is a media-upload execution mode.

### Android

- WorkManager is the right Android primitive for persistent work, with long-running work requiring user-visible foreground handling where appropriate.
- A production implementation would need a native worker or foreground service that shares the SDK's idempotency, source-binding, cancellation, retry, and replacement rules.
- Any real Android proof requires manifest/policy work, a rebuilt binary, and real-device testing.

## Measured Floors Required Before A Future Go

These are future product gates, not completed Phase 7 measurements.

| Platform | Required floor before production |
|---|---|
| Web | Chrome, Edge, Firefox, Android Chrome, iOS Safari, and desktop Safari matrix. At least >= 95 percent completion for supported browsers across kill-tab, reload, offline/online, lock-screen, and retry flows. OneSignal registration, subscription, delivery, and notification-click behavior must be unchanged. |
| iOS | At least >= 95 percent completion on supported iOS versions across suspend, terminate, reconnect, low-power, and poor-network flows. File-backed URLSession upload proof must show progress, completion, and delegate restoration. |
| Android | At least >= 95 percent completion on supported Android versions across app backgrounding, process death-adjacent recovery, network migration, retry, and reboot flows. Foreground-service/notification behavior must comply with current OS policy. |

Every platform floor also requires:

- Zero duplicate assets.
- Zero duplicate message, profile, or event publishes.
- No stale upload A overwriting replacement upload B.
- Foreground SDK queue remains authoritative when OS background scheduling is delayed, declined, or cancelled.
- Unsupported devices and browsers fall back cleanly to the foreground persistent queue and manual recovery UX.

## Foreground Recovery Observability

The no-go decision is only useful if the team can measure how often background uploads would have helped. Vibe Clip recovery now emits `media_upload_suspended_recovery` when a stale foreground upload is surfaced or manually recovered. Required fields: `family`, `client_request_id`, `suspension_duration_ms`, `bytes_already_uploaded_pct`, `recovery_outcome`, and `would_benefit_from_background`.

Use six months of that event, grouped by platform/network/device class, as the input to any future Phase 7 reopening. The event should answer: how many uploads were resumed after foreground recovery, how often local source was gone, how often credentials had to be reissued, and how long users were away before recovery.

Foreground compensation is app-shell level now, not only chat-thread level: web and native outbox runners sweep stale Vibe Clip uploads on mount and foreground, expose a global recovery attention count, and surface an upload-attention affordance even when the user is not currently inside the affected chat. Web also shows a return-to-foreground reminder that uploads continue from saved progress.

## TUS Expiry And Resume Semantics

The foreground contract does not restart every interrupted Stream upload from byte 0. Bunny Stream uploads use TUS offset resume while credentials remain valid. Current create-upload credentials are expected to last about one hour; after expiry, recovery reissues credentials with the same `client_request_id` so idempotency still prevents duplicate assets and duplicate publishes.

## Codebase Guardrails Landed

- `shared/media-sdk/background-upload-policy.ts` exports the Phase 7 policy and always returns `false` from `shouldEnableOsBackgroundUploads()`.
- `shared/media-sdk/backgroundUploadPolicy.test.ts` verifies the no-go decision, OneSignal root-worker boundary, absence of new background-task dependencies, and documentation coverage.
- `.github/workflows/phase-7-media-background-policy.yml` runs `npm run test:media-background-upload` directly for policy/config/service-worker drift.
- `scripts/native-launch-preflight.mjs` warns when `ReviewAfter` has passed so the decision cannot become stale silently.
- The existing OneSignal service-worker layout remains unchanged:
  - `public/OneSignalSDK.sw.js`
  - `public/OneSignalSDKWorker.js`
  - `public/sw.js` as a legacy inert shim only
- `src/hooks/useServiceWorker.ts` still does not register `/sw.js`.

## Future Prototype Shape

Future work should be isolated behind prototype branches:

- `spike/web-bg-uploads`: non-root `/media/` service-worker probe, Background Sync capability matrix, source recovery proof, and OneSignal scope-control proof.
- `spike/native-bg-uploads`: native rebuild prototype for iOS URLSession background uploads and Android WorkManager or user-visible foreground-service uploads.
- `decision/bg-uploads-go-no-go`: production decision update only after the measured floors above are recorded.

If this is reopened, start with:

1. `npm run test:media-background-upload`
2. `npm run launch:preflight`
3. A prototype branch that keeps production flags off and records a device/browser matrix under `docs/media-background-upload-phase7-decision.md`.

For web, include a OneSignal scope-control experiment using `Service-Worker-Allowed` and an explicit non-root registration path. For native, include a rebuilt binary proof; JavaScript-only experiments are not enough.

## Primary References

- [MDN Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [MDN Web Periodic Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API)
- [MDN ServiceWorkerContainer.register](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
- [MDN Service-Worker-Allowed header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Service-Worker-Allowed)
- [OneSignal service worker docs](https://documentation.onesignal.com/docs/en/onesignal-service-worker)
- [Expo BackgroundTask docs](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [Apple URLSessionUploadTask docs](https://developer.apple.com/documentation/foundation/urlsessionuploadtask)
- [Apple BGProcessingTask docs](https://developer.apple.com/documentation/backgroundtasks/bgprocessingtask)
- [Android task scheduling and WorkManager docs](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Android long-running workers docs](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)
