# Web push: service worker layout (Vibely)

## What controls `/`?

1. **`public/sw.js`** — Registered explicitly by `src/hooks/useServiceWorker.ts` via `navigator.serviceWorker.register('/sw.js', { scope: '/' })`. Handles legacy `postMessage` scheduling (`SHOW_NOTIFICATION`, `SCHEDULE_NOTIFICATION`), generic `push` events, and local notification fallbacks.

2. **`public/OneSignalSDK.sw.js`** — Root shim that `importScripts` the official OneSignal CDN worker (`OneSignalSDK.sw.js` v16). OneSignal’s page SDK registers this path when initializing web push (default path under site root).

## Operational risk

Both paths use **scope `/`**. Depending on browser registration order and which script last controls the root controller, **either** the custom `sw.js` **or** OneSignal’s worker may end up as the active client for that scope. That can affect:

- Whether OneSignal can complete push subscription for server-delivered notifications.
- Whether Vibely’s custom SW message handlers run as expected.

**Mitigation in product:** All user-facing “enable push” flows go through `requestWebPushPermissionAndSync` → OneSignal `promptForPush` / `getPlayerId`, so server push depends on OneSignal’s worker winning or coexisting correctly. If push fails in the field, DevTools → Application → Service Workers should show which script is **controlling** `/`.

## No code change in this doc

This file documents the current topology for PR review; a broader merge to a single worker strategy would be a separate change.
