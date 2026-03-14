# Native runtime stabilization — diagnosis (Sprint R3)

Branch: `feat/native-runtime-stabilization`  
Focus: physical iPhone runtime correctness, photo loading, media/video classification, branding/rebuild clarity. No Expo cloud builds.

---

## 1. Photo loading — actual failing point and root cause

**Root cause (diagnosis):**

Native image non-loading is caused by **one or both** of:

1. **Env not inlined at bundle time**  
   `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` is injected by Metro when the JS bundle is built. If Metro was started without loading `apps/mobile/.env`, or the bundle was cached from a run when the var was unset, `BUNNY_CDN` is `""` and all `photos/` paths resolve to the placeholder.  
   **Check:** In Metro logs (or a one-off __DEV__ log), confirm whether the hostname is set. A single-run warning was added: when `BUNNY_CDN` is empty in __DEV__, the app logs once: *"EXPO_PUBLIC_BUNNY_CDN_HOSTNAME is unset; … Set it in apps/mobile/.env and restart Metro."*

2. **Wrong URL layer**  
   If the hostname *is* set and URLs look like `https://cdn.vibelymeet.com/photos/…?width=200&height=200&quality=85`, then failure is below the app: **Bunny CDN** (pull zone, CORS, or image-resize), **network/ATS** on device, or **React Native `Image`** (e.g. redirect/cache). Next step is to log one resolved URL on device and open it in Safari; if it loads in Safari but not in-app, the issue is RN Image or cache.

**Exact failing layer (if still broken after this pass):**

- If placeholder shows everywhere for profile/event/avatars → **env not inlined** (BUNNY_CDN empty). Fix: set `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` in `apps/mobile/.env`, restart Metro, clear Metro cache if needed (`npx expo start -c`).
- If URLs are correct in logs but images don’t load → **Bunny CDN or RN Image**. Diagnose: open the same URL in device Safari; if it works, the problem is RN (e.g. cache, redirect handling).

---

## 2. What was fixed vs what remains blocked

**Fixed in this slice:**

| Change | File | Purpose |
|--------|------|--------|
| **crop_gravity for avatars** | `apps/mobile/lib/imageUrl.ts` | Avatar URLs now include `crop_gravity=center` to align with web and Bunny image API. |
| **One-time __DEV__ warning** | `apps/mobile/lib/imageUrl.ts` | When `BUNNY_CDN` is empty, log once so the user knows to set env and restart Metro. |
| **Doc** | `docs/native-runtime-media-recovery-audit.md` (existing) | Root cause and env instructions. |

**Remains blocked (if photos still don’t load):**

- **Env not loaded by Metro:** No code fix; user must ensure `.env` exists, var is set, and Metro is restarted (and optionally cache cleared).
- **Bunny pull zone / path:** If the CDN requires a path prefix or different hostname, the app would need that value (e.g. from env or config); no change in this pass.
- **RN Image / cache / redirect:** If the URL works in Safari but not in-app, follow-up is RN-specific (e.g. try `expo-image`, or clear image cache).

---

## 3. Media / video — real bug vs deferred

| Surface | Classification | Notes |
|--------|----------------|-------|
| **Vibe / profile videos (Bunny HLS)** | **Deferred by product** | No native HLS player; profile shows “Vibe Video is coming to mobile soon” and “Use on web.” Not a runtime bug. |
| **Video dates (Daily)** | **Implemented** | Uses Daily SDK and same `daily-room` EF as web. If “video doesn’t work,” it’s permissions, network, or Daily config — not image/video URL logic. |
| **Chat/voice messages** | **Backend contract exists** | Upload and playback are separate; any native playback gap is missing implementation, not a misconfiguration of the current URL layer. |

**Summary:** No media/video issue in the current codebase is a “true bug” in the sense of wrong URL or wrong contract; vibe video is product-deferred; video dates are a separate, already-implemented flow.

---

## 4. Branding / runtime validation prep

| Item | Requires rebuild? | Requires Metro restart? |
|------|-------------------|--------------------------|
| **App icon / splash image** | Yes (native assets baked into build) | No |
| **Splash background color** (`app.json`) | Yes | No |
| **Photo loading (Bunny hostname in .env)** | No | Yes (env inlined at bundle time) |
| **JS/TS logic (e.g. imageUrl)** | No | Yes (with Metro reload) |

**Icon/splash config:**  
`app.json` points to `./assets/images/icon.png`, `./assets/images/splash-icon.png`, and `splash.backgroundColor` (e.g. `#0a0a0c`). Replacing those assets or changing `app.json` only takes effect after a **native rebuild** (e.g. `npx expo run:ios`).

---

## 5. Physical-device blocker list (after feature-completeness)

Remaining runtime blockers to confirm on a physical iPhone:

1. **Photo loading**  
   - If `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` is set and Metro was restarted: do profile/event/avatar images load?  
   - If not: capture one resolved URL from the app (or add a short __DEV__ log of `getImageUrl(…)` for one `photos/` path) and open it in Safari on device.  
2. **Video date (Daily)**  
   - Camera/mic permissions granted; room joins and video/audio work.  
3. **Push (OneSignal)**  
   - Device registered; push receipt works when sent from backend.  
4. **No “blocker” from dev-client chrome**  
   - Dev menu / gear are expected in dev builds; ignore for “runtime blocker” list.

---

## 6. No cloud builds

All validation is local: typecheck, optional local run, and device testing. No EAS/Expo cloud build required for this slice.
