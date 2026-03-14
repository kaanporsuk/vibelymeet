# Native release readiness (through Sprint 5)

Scope: App and provider/build closure prep. Reflects Sprints 1–4 (parity, public profile, match celebration, credits) and Sprint 5 (OneSignal/RevenueCat real-device prep, build validation docs, blocker matrix refresh).

---

## 1. What is complete

- **App shell and navigation:** Tab layout (Dashboard, Events, Matches, Profile), stack screens, auth gate, onboarding gate.
- **P0 screens (native v1):** Index, auth (sign-in, sign-up, reset-password), onboarding, dashboard, events list/detail, event lobby, matches, chat, profile (including profile photo upload and vibe video), settings (with subpages: notifications, credits, account), Ready Gate, video date, Daily Drop, premium (RevenueCat; hard blocker). **Sprint 4:** Public profile (`/user/:userId`), match celebration (unread → celebration → chat), credits (pack selection + create-credits-checkout → Stripe in browser).
- **Profile photo upload:** In v1; native image picker → upload-image EF → profiles.photos update; implemented in Sprint 1.
- **Vibe video:** In v1; native record → create-video-upload → tus upload → video-webhook; state (none/uploading/processing/ready/failed) and delete via delete-vibe-video; implemented in Sprint 1.
- **Dead-end cleanup:** Profile preview, schedule, and settings rows wired to navigation or explicit web handoff (see `docs/native-web-handoff-burndown.md`).
- **Branding config:** `app.json` — name "Vibely", icon, splash, Android adaptive icons and favicon referenced. All referenced assets exist in repo.
- **Backend contracts:** Same Supabase project, RPCs, Edge Functions as web; no native-only business logic.
- **Platform adapters:** OneSignal (push; APNs mode via `app.config.js` for preview/production), RevenueCat (entitlements), Daily (video date) wired; env and closure checklists in `docs/native-external-setup-checklist.md`.

---

## 2. What is acceptable in dev build only

- **Expo dev client chrome:** Dev menu, reload, debug UI. Expected; not present in production builds.
- **RevenueCat console warnings** (e.g. configuration/offerings) when dashboard or offerings are not fully set up. Non-blocking for flow validation.
- **Splash/icon:** Config is correct; to see final assets on device after replacing files, a native rebuild is required (no Metro-only change).

---

## 3. What is still blocked before production-style validation

- **Kaan dashboard/device actions (hard blockers for launch):** RevenueCat (products, offerings, entitlement, webhook URL + auth; App Store Connect / Play Console products). OneSignal (iOS app + APNs, Android app + FCM). See `docs/native-external-setup-checklist.md` for exact steps.
- **Production build and TestFlight/Store:** EAS build + credentials + EAS secrets; no app code blocker. Use `preview` or `production` profile for real-device push/IAP.
- **Photo/media loading:** Bunny CDN may return 404 until pull zone configured; URL logic is correct. Does not block launch if accepted as known limitation; see `docs/native-final-blocker-matrix.md`.
- **RevenueCat offerings:** If offerings/packages not configured in dashboard, premium screen shows "No offerings available"; resolve in RevenueCat + store consoles before launch.

---

## 4. What is explicitly deferred

- **Photo loading (Bunny 404):** Profile/event/avatar images from Bunny; path prefix and URL logic in place; CDN/path may still return 404 until pull zone is configured. Profile photo **upload** is in v1 and implemented (upload-image EF). Loading remains tracked in `docs/native-runtime-stabilization-diagnosis.md`.
- **Vibe video:** In v1; native record, upload (create-video-upload + tus), state display, delete implemented. Full studio UX (trimming, caption) can follow in a later release.
- **Screens (Sprint 4):** Public user profile (`/user/:userId`) and match celebration implemented natively; schedule remains web handoff (explicit copy). Credits: native pack selection + create-credits-checkout → Stripe in browser. Legal/marketing/admin remain web-only.
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

## 6. Final blocker matrix and Sprint 5

See `docs/native-final-blocker-matrix.md` for the categorized list (blocker / non-blocking / deferred / dev-only). **Sprint 5:** OneSignal real-device closure prep (§3) and RevenueCat audit (§2) documented in `docs/native-external-setup-checklist.md`; production-style build validation prep (§5.1); OneSignal APNs mode set via `app.config.js` for EAS preview/production builds.
