# Native release readiness (Sprint R4)

Branch: `feat/native-branding-release-readiness`  
Scope: Branding sanity, release-readiness pass, final blocker checklist. Media remains deferred but tracked. No Expo cloud builds.

---

## 1. What is complete

- **App shell and navigation:** Tab layout (Dashboard, Events, Matches, Profile), stack screens, auth gate, onboarding gate.
- **P0 screens (native v1):** Index, auth (sign-in, sign-up, reset-password), onboarding, dashboard, events list/detail, event lobby, matches, chat, profile (including profile photo upload and vibe video), settings (with subpages: notifications, credits, account), Ready Gate, video date, Daily Drop, premium (RevenueCat; hard blocker).
- **Profile photo upload:** In v1; native image picker → upload-image EF → profiles.photos update; implemented in Sprint 1.
- **Vibe video:** In v1; native record → create-video-upload → tus upload → video-webhook; state (none/uploading/processing/ready/failed) and delete via delete-vibe-video; implemented in Sprint 1.
- **Dead-end cleanup:** Profile preview, schedule, and settings rows wired to navigation or explicit deferred/web handoff. Dashboard notifications → settings/notifications.
- **Branding config:** `app.json` — name "Vibely", icon `./assets/images/icon.png`, splash `./assets/images/splash-icon.png`, splash background `#0a0a0c`, Android adaptive icons and favicon referenced. All referenced assets exist in repo.
- **Backend contracts:** Same Supabase project, RPCs, Edge Functions as web; no native-only business logic.
- **Platform adapters:** OneSignal (push), RevenueCat (entitlements), Daily (video date) wired; env and docs in place.

---

## 2. What is acceptable in dev build only

- **Expo dev client chrome:** Dev menu, reload, debug UI. Expected; not present in production builds.
- **RevenueCat console warnings** (e.g. configuration/offerings) when dashboard or offerings are not fully set up. Non-blocking for flow validation.
- **Splash/icon:** Config is correct; to see final assets on device after replacing files, a native rebuild is required (no Metro-only change).

---

## 3. What is still blocked before production-style validation

- **Production build and TestFlight/Store:** Not in scope for this sprint; local dev client + Metro only.
- **Photo/media loading:** Under observation; Bunny CDN returns 404 after path/provider work; deferred to hardening. Does not block branding or release-readiness doc.
- **RevenueCat offerings:** If offerings/packages are not configured in dashboard, premium paywall may show empty or warnings; resolve in dashboard when moving to production.

---

## 4. What is explicitly deferred

- **Photo loading (Bunny 404):** Profile/event/avatar images from Bunny; path prefix and URL logic in place; CDN/path may still return 404 until pull zone is configured. Profile photo **upload** is in v1 and implemented (upload-image EF). Loading remains tracked in `docs/native-runtime-stabilization-diagnosis.md`.
- **Vibe video:** In v1; native record, upload (create-video-upload + tus), state display, delete implemented. Full studio UX (trimming, caption) can follow in a later release.
- **Screens (per contract):** Match celebration, public user profile, schedule — deferred or link-out. Legal/marketing/admin remain web-only. Credits/delete-account remain as current repo (settings entry or link-out).
- **Polish:** Accessibility, loading-state polish, visual tweaks — after v1 essential flows.

---

## 5. Branding audit summary

| Item | Status | Notes |
|------|--------|-------|
| App name | OK | `expo.name`: "Vibely" |
| Icon | OK | `./assets/images/icon.png`; file exists |
| Splash image | OK | `./assets/images/splash-icon.png`; file exists |
| Splash background | OK | `#0a0a0c` (Vibely dark) |
| Android adaptive | OK | Foreground, background, monochrome referenced; files exist |
| Favicon (web) | OK | `./assets/images/favicon.png` |
| User-facing labels | OK | Sign-in/up, share, premium, etc. use "Vibely" |

No config or code changes were required for branding this sprint; existing wiring and assets are used. To validate on device: run a local native build; icon/splash changes require a rebuild, not just Metro restart.

---

## 6. Final blocker matrix

See `docs/native-final-blocker-matrix.md` for the categorized list (blocker / non-blocking / deferred / dev-only).
