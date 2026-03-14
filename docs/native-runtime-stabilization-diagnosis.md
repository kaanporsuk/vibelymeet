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

## 1b. Photo URL trace (feat/native-photo-url-trace)

**What was added:** In `__DEV__`, the app logs **one** resolved URL per category when that URL is first used: `avatar`, `profile_photo`, `event_image`. Check Metro/console for lines like:

- `[Vibely photo URL] avatar: https://…`
- `[Vibely photo URL] profile_photo: https://…`
- `[Vibely photo URL] event_image: https://…`

**Path-building vs web:** Mobile `getImageUrl` matches web: for `photos/` paths we build `https://${BUNNY_CDN_HOSTNAME}/${path}?width=…&height=…&quality=85` (and `crop_gravity=center` for avatars). Stored path shape from upload is `photos/{userId}/{timestamp}.{ext}` — no prefix. So URL construction is correct unless the CDN hostname or path prefix differs on your Bunny pull zone.

**How to identify the exact failing layer:**

1. Run the app on iPhone with Metro; open a screen that shows avatar, profile photo, and an event (e.g. dashboard + profile + events).
2. In Metro logs, copy the three logged URLs (or at least one).
3. **If you see the placeholder URL** (`placehold.co`) in the logs → **URL construction / env**: BUNNY_CDN was empty at bundle time; fix env + restart Metro.
4. **If you see `https://your-cdn…/photos/…`** → Open that **exact** URL in **Safari on the same iPhone**.  
   - **Safari loads the image** → Failing layer is **React Native `Image`** (e.g. cache, redirect, or HTTPS handling). Next step: try `expo-image` for those surfaces or clear RN image cache.  
   - **Safari does not load** (404, 403, or error) → Failing layer is **CDN or path** (wrong hostname, pull zone path prefix, or Bunny image-resize/redirect). Fix hostname/path in env or CDN config.

No code fix is applied for CDN vs RN until the layer is confirmed via this Safari check.

---

## 1c. Photo provider fix (feat/native-photo-provider-fix) — 403 and path consistency

**Validation outcome:** A logged Bunny image URL was opened in iPhone Safari and returned **403 Forbidden**. So the failing layer is **Bunny CDN / pull zone**, not React Native Image. Logs also showed: profile_photo → Bunny CDN URL; avatar → Supabase storage URL (inconsistent by data source).

**Actual root cause of Bunny 403:**

- **Bunny pull zone configuration:** 403 from the CDN means the request is rejected by the pull zone. Common causes: (1) **Token Authentication** enabled on the pull zone (requires signed URLs; we don’t generate tokens today). (2) **Edge Rules** blocking by referrer, origin, or path. (3) **Pull zone not connected** to the correct storage zone. (4) **Path mismatch:** some setups serve storage at a path prefix (e.g. `https://cdn.example.com/{storage-zone-name}/photos/...`). Official Bunny docs say the storage zone name is added internally when the pull zone talks to storage, so often no prefix is needed—but custom setups may differ.

**Path classes in live data:**

| Class | Example | Resolution |
|-------|---------|------------|
| `photos/{userId}/{timestamp}.{ext}` | From upload-image EF | Bunny CDN (with optional path prefix) |
| Full Supabase URL | `https://xxx.supabase.co/storage/...` | Returned as-is |
| Legacy bucket-relative | e.g. `avatars/...` or other non-`photos/` | Supabase storage URL |

**Why avatar resolved to Supabase:**

- Match list avatars use `profile.photos?.[0] || profile.avatar_url` (same as web). For **avatar** we log the first match’s image. If that profile has **no** `photos[]` and only **avatar_url** (legacy), the path is a Supabase path or full Supabase URL → we correctly build or pass-through a Supabase URL. **profile_photo** is the current user’s profile; they have `photos[]` from the new pipeline → we build a Bunny URL. So the “inconsistency” is **data source**: some profiles have `photos/...` (Bunny), some have `avatar_url` (legacy Supabase). Resolution logic is correct for the path we’re given.

**Exact fix applied:**

- **Optional CDN path prefix:** `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` (mobile) and `VITE_BUNNY_CDN_PATH_PREFIX` (web). If set, Bunny URLs become `https://{host}/{prefix}/{path}?params`. Use when your pull zone or custom domain requires a path prefix (e.g. storage zone name). Same logic on web and mobile.
- **.env.example:** Optional `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` documented.
- **No change** to avatar/Supabase resolution—that’s correct for legacy paths.

**If 403 persists after trying a path prefix:** The fix is in the Bunny dashboard: disable Token Authentication on the pull zone, or adjust Edge Rules so anonymous GETs to image paths are allowed. No further app code change can fix 403 if the zone requires tokens or blocks the request.

---

## 1d. Bunny 404 (Sprint R5) — actual root cause and provider-only fix

**Observed:** Bunny CDN now returns **404 Not Found** (no longer 403). So the request reaches the pull zone but the resource is not found at the requested path.

**Path contract in app:** Upload Edge Function writes to Bunny Storage at `photos/{userId}/{timestamp}.{ext}` (relative to storage zone root). The app builds URLs as `https://{host}/{path}?params` or `https://{host}/{prefix}/{path}?params`. Path in DB is exactly `photos/...` — no storage zone name in the path.

**404 root cause (one of):**

| Cause | Meaning | Fix |
|-------|--------|-----|
| **Wrong pull-zone origin** | The hostname (e.g. `cdn.vibelymeet.com`) points to a pull zone that is **not** connected to the same storage zone as `BUNNY_STORAGE_ZONE` used by upload-image. | In Bunny dashboard: ensure the pull zone used by that hostname has **Origin** = Storage Zone and is connected to the **same** storage zone as in your Supabase secrets (`BUNNY_STORAGE_ZONE`). |
| **Wrong path / origin path** | The pull zone has a custom origin path or path prefix so that the file at storage path `photos/uid/123.jpg` is served at a different public path (e.g. `/{zone}/photos/...`). | Either set `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` (and web `VITE_BUNNY_CDN_PATH_PREFIX`) to that prefix (e.g. storage zone name), or in Bunny pull zone remove/adjust the origin path so that public path `/photos/...` maps to storage path `photos/...`. |
| **Wrong storage path in data** | Stored path in DB is not the same as what was written (e.g. different zone or typo). | Verify in DB that `profiles.photos` / event cover paths look like `photos/{userId}/{timestamp}.{ext}`. Re-upload if needed. |
| **File never written** | Upload succeeded but file was deleted or storage zone was recreated. | Re-upload or restore from backup. |

**App-side:** URL construction is correct per contract. No further app change fixes 404; the fix is **provider/dashboard**: correct pull zone → storage zone connection and, if needed, path prefix in app env.

**Exact Bunny dashboard action (provider-side only):**

1. **Pull zone:** Open the pull zone that serves your CDN hostname (e.g. custom hostname `cdn.vibelymeet.com`).
2. **Origin:** Confirm **Origin type** = **Storage zone** and the selected storage zone is **exactly** the one in `BUNNY_STORAGE_ZONE` (Supabase secret for upload-image).
3. **Path:** If the zone uses an origin path or “path prefix” so that storage root is at a non-root URL path, set `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` (and web `VITE_BUNNY_CDN_PATH_PREFIX`) to that prefix (e.g. the storage zone name); otherwise leave prefix unset.
4. **Test:** Open a built image URL (from Metro trace log) in Safari; if it still 404s, the pull zone is not serving that storage path — re-check origin and path mapping.

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
