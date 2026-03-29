# Web push: service worker layout (Vibely)

## What controls `/`?

1. **`public/OneSignalSDK.sw.js`** — Root shim that `importScripts` the official OneSignal CDN worker (v16). OneSignal’s page SDK registers this path when initializing web push. **This is the only service worker registered by the app for push.**

2. **`public/sw.js`** — **Removed.** It previously conflicted with OneSignal for scope `/`. Local / scheduled reminders use `window.Notification` + `localStorage` fallbacks via `usePushNotifications` and `useEventReminders` (`useServiceWorker` no longer registers a custom worker).

## Operational notes

- DevTools → Application → Service Workers should show **OneSignal** controlling `/` after the user opts in to push.
- See `docs/web-push-production-checklist.md` for production verification.
