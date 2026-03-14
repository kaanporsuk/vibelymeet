# Native runtime media recovery — audit report

Branch: `feat/native-runtime-media-recovery`  
Scope: Runtime audit on physical device, media loading recovery, missing screen/route audit, branding prep. No Expo cloud builds; local workflow only.

---

## 1. Classification of device issues

| Issue | Classification | Notes |
|-------|----------------|-------|
| Photos not loading | **Real native-v1 blocker** | Fixed: `photos/` paths were falling through to Supabase URL when `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` was unset. See §2. |
| Videos not loading | **Deferred by product** | Vibe/profile videos (Bunny HLS) are deferred; profile shows “Vibe Video is coming to mobile soon.” Video *dates* (Daily) are a separate flow and use Daily SDK. |
| Several screens/routes missing or placeholder | **Mix** | P0 routes exist; Schedule, Match celebration, public user profile, Vibe studio are deferred per contract. See §5. |
| Some surfaces visually off | **Expected in dev / polish** | Dev client + Metro; no production theming or “release” chrome. |
| Dev-build chrome/gear visible | **Expected in dev build only** | Expo dev client shows dev UI; production builds do not. |

---

## 2. Image loading — root cause and fix

**Root cause:**  
`apps/mobile/lib/imageUrl.ts` builds URLs for `photos/` paths using Bunny CDN only when `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` is set. When it was unset (or not in `.env`), the code fell through to:

`${SUPABASE_URL}/storage/v1/object/public/${p}`

Profile and event photos are stored on **Bunny**, not Supabase storage, so that URL returns 404 and images do not load.

**Fix applied:**

- **`apps/mobile/lib/imageUrl.ts`**  
  - For paths starting with `photos/`, if `BUNNY_CDN` is empty, return the existing placeholder URL instead of the Supabase URL.  
  - So: no more wrong Supabase URLs for Bunny assets; when the env is missing, placeholders show instead of broken images.
- **`apps/mobile/.env.example`**  
  - `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` is documented as required for profile/event/avatar images and uncommented with a placeholder value so local `.env` can be filled (same hostname as web `VITE_BUNNY_CDN_HOSTNAME`).

**To get real photos on device:**  
Set in `apps/mobile/.env`:

```bash
EXPO_PUBLIC_BUNNY_CDN_HOSTNAME=<your-bunny-cdn-hostname>
```

(No `https://`; same value as web.)

---

## 3. Video loading — root cause and status

**Vibe / profile videos (Bunny HLS):**

- **Root cause:** Not a bug. Product decision: vibe video on native is deferred (v1.1+). Profile screen shows a “Vibe Video is coming to mobile soon” shell and “Use on web” CTA. No native HLS player is implemented for Bunny streams.
- **No code change** in this pass; contract and `docs/native-screen-contract-map.md` list Vibe Studio as deferred.

**Video dates (Daily):**

- Implemented in `app/date/[id].tsx` with Daily React Native SDK; token from same `daily-room` Edge Function as web. If “videos not loading” refers to video dates, likely causes are permissions (camera/mic), network, or Daily token/room config — not the image/video URL logic above.

---

## 4. Media fixes applied (summary)

| Area | Change |
|------|--------|
| **Image URL logic** | `photos/` paths no longer fall back to Supabase when Bunny CDN hostname is unset; placeholder is used instead. |
| **Env docs** | `.env.example` updated so `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` is clearly required for real profile/event/avatar images and is uncommented. |
| **Comments** | `imageUrl.ts` documents the need for `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` and the placeholder behaviour. |

No changes to backend contracts, signed URLs, or API shapes.

---

## 5. Missing screens / routes for native v1

Audit against `docs/native-screen-contract-map.md`:

**P0 routes — present and implemented:**

- `app/index.tsx` → Index
- `app/(auth)/sign-in`, `sign-up`, `reset-password`
- `app/(onboarding)/index`
- `app/(tabs)/index` → Dashboard
- `app/(tabs)/events/index`, `app/(tabs)/events/[id]` → Events list, Event details
- `app/event/[eventId]/lobby` → Event lobby
- `app/(tabs)/matches/index` → Matches
- `app/chat/[id]` → Chat
- `app/(tabs)/profile/index` → Profile
- `app/settings.tsx` → Settings
- `app/ready/[id]` → Ready Gate
- `app/date/[id]` → Video date
- `app/daily-drop.tsx` → Daily Drop

**P1 / deferred (not missing for v1):**

- **Premium:** `app/premium.tsx` exists (P1 in contract).
- **Schedule:** Deferred or later tab; no dedicated schedule route; profile has “My Vibe Schedule” card only.
- **Match celebration, public user profile, Vibe studio:** Deferred (v1.1+).
- **Credits / subscription success|cancel:** Link-out or in-app browser; RevenueCat handles native purchases.

**Exact implementation gaps remaining for native v1:**

- None for P0. Remaining work is optional polish, Schedule (if promoted), and deferred features (match celebration, user profile, vibe studio).

---

## 6. Expected only because this is a dev build

- **Dev client / Metro:** Dev menu, reload, debug UI are visible; not present in production builds.
- **Expo dev client chrome:** Any “gear” or dev-only UI is from the dev client, not from production app icon/splash.
- **Placeholder images:** If `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` is not set, placeholders are intentional until the env is set.
- **RevenueCat / OneSignal:** Dev-mode config and optional keys can affect purchase or push behaviour in dev only.

---

## 7. Icon and splash — config and assets needed

**Current config (`apps/mobile/app.json`):**

- **iOS / general:**  
  - `icon`: `./assets/images/icon.png`  
  - `splash.image`: `./assets/images/splash-icon.png`  
  - `splash.resizeMode`: `contain`  
  - `splash.backgroundColor`: `#ffffff`
- **Android:**  
  - `adaptiveIcon.foregroundImage`: `./assets/images/android-icon-foreground.png`  
  - `adaptiveIcon.backgroundColor`: `#E6F4FE`  
  - `adaptiveIcon.backgroundImage`: `./assets/images/android-icon-background.png`  
  - `adaptiveIcon.monochromeImage`: `./assets/images/android-icon-monochrome.png`
- **Web:**  
  - `favicon`: `./assets/images/favicon.png`

**Files present in repo:**

- `apps/mobile/assets/images/icon.png`
- `apps/mobile/assets/images/splash-icon.png`
- `apps/mobile/assets/images/favicon.png`
- `apps/mobile/assets/images/android-icon-foreground.png`
- `apps/mobile/assets/images/android-icon-background.png`
- `apps/mobile/assets/images/android-icon-monochrome.png`

**What is still needed from you (branding):**

- **Replace** the above assets with final Vibely branding if the current files are placeholders.  
- **Recommended specs:**  
  - **icon.png:** 1024×1024 (Expo will generate sizes).  
  - **splash-icon.png:** e.g. 1284×2778 or similar large resolution; will be scaled with `contain`.  
  - **favicon.png:** e.g. 48×48 or 96×96.  
  - **Android adaptive:** Foreground and (if used) background/monochrome per [Expo adaptive icon docs](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/); monochrome is for themed icons (Android 13+).  
- No new *files* are missing; only final branded assets need to be dropped in and, if needed, `splash.backgroundColor` updated in `app.json`.

---

## 8. Manual steps required

1. **Set Bunny CDN in local env**  
   In `apps/mobile/.env` (create from `.env.example` if needed), set:
   ```bash
   EXPO_PUBLIC_BUNNY_CDN_HOSTNAME=<your-actual-bunny-cdn-hostname>
   ```
   Restart Metro / dev client so env is picked up; then profile, event, and avatar images that use `photos/` paths will load from Bunny.

2. **Icon/splash (optional)**  
   If you want production branding: replace the files under `apps/mobile/assets/images/` with your final icon, splash, favicon, and Android adaptive set. No code changes required if filenames and paths stay the same.

3. **No cloud builds**  
   This pass is local-only; no EAS/Expo cloud build steps were run or required.

---

## Validation

- **Mobile typecheck:** Run from repo root: `pnpm --filter mobile exec tsc --noEmit` (or equivalent). Fix any reported errors before commit.
- **Local runtime:** On a physical iPhone with dev client + Metro tunnel, confirm: (1) after setting `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`, profile/event/avatar images load; (2) placeholders show when the var is unset; (3) no new regressions on auth, tabs, events, matches, chat, profile, settings, ready, date, daily-drop.

Do not commit until the audit/fix pass is complete and typecheck passes.
