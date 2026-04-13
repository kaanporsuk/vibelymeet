# Final Sync Audit

**Date:** 2026-03-18  
**Scope:** Git (origin/main vs local), Supabase Cloud (project ref: schdyxcunwcvddlcshwd), codebase health, native build readiness.

> Update 2026-04-13: this file preserves a March 2026 sync snapshot and should not be treated as the current backend inventory by itself. Cron is now enabled (`media-delete-worker-every-15m`, jobid 18, `*/15 * * * *`). See `docs/media-lifecycle-operations-runbook.md` for the current operational state.

---

## 1. Git state

| Item | Result |
|------|--------|
| **HEAD commit (main)** | `f18f86bf15d476b2a5f87494313b7d98555172de` |
| **Branch** | `main` (up to date with `origin/main`) |
| **Working tree** | Clean (no modified, untracked, or staged files) |
| **Local main = origin/main** | Yes |

### .env tracking
- `git ls-files .env apps/mobile/.env` → **no output** → `.env` and `apps/mobile/.env` are **not** tracked. OK.

### Branches
- **Local branches:** 40+ (many feature/fix branches).
- **Merged into origin/main (can be cleaned up locally):**  
  `cursor/audit-live-vs-frozen`, `cursor/hardening-auth-secrets`, `docs/rebuild-rehearsal-log`, `qa/web-golden-path-regression-lane`, and remote `origin/cursor/hardening-auth-secrets`.
- **Stale local branches (already merged via PRs, safe to delete):**  
  Any branch that was merged into main (e.g. `fix/native-event-detail-bunny-sentry`, `feat/mobile-phase5-events-discovery-lobby-parity`) can be deleted locally with `git branch -d <name>`. Run `git branch --merged main` to list merged local branches before cleanup.

---

## 2. Supabase Cloud sync

**Link:** `supabase link --project-ref schdyxcunwcvddlcshwd` — completed successfully.

### 2a. Migration sync

| Metric | Value |
|--------|--------|
| **Migrations in local repo** | 113 files (`supabase/migrations/*.sql`) |
| **Migrations applied on remote** | 113 (all listed in `supabase migration list`) |
| **Local but NOT applied remotely** | 0 |
| **Applied remotely but NOT in local repo** | 0 |

**Verdict:** Migrations are in sync.

### 2b. Edge Functions sync

| Deployed (live) | In repo (`supabase/functions/*/`) |
|-----------------|-----------------------------------|
| 34 functions | 34 deployable dirs (excluding `_shared`) |

- **Functions deployed but NOT in repo:** None.
- **Functions in repo but NOT deployed:** None (`_shared` is shared code, not a function).
- **Count match:** Yes.

### 2c. Secrets sync

**Secrets set in cloud (30):**  
APP_URL, BUNNY_CDN_HOSTNAME, BUNNY_STORAGE_API_KEY, BUNNY_STORAGE_ZONE, BUNNY_STREAM_API_KEY, BUNNY_STREAM_CDN_HOSTNAME, BUNNY_STREAM_LIBRARY_ID, BUNNY_VIDEO_WEBHOOK_TOKEN, BUNNY_WEBHOOK_SIGNING_KEY, CRON_SECRET, DAILY_API_KEY, DAILY_DOMAIN, LOVABLE_API_KEY, ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, PUSH_WEBHOOK_SECRET, RESEND_API_KEY, REVENUECAT_WEBHOOK_AUTHORIZATION, STRIPE_ANNUAL_PRICE_ID, STRIPE_MONTHLY_PRICE_ID, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_ANON_KEY, SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID, UNSUB_HMAC_SECRET.

**Secrets referenced in Edge Functions (Deno.env.get):**  
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MONTHLY_PRICE_ID, STRIPE_ANNUAL_PRICE_ID, BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_STREAM_CDN_HOSTNAME, BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY, BUNNY_CDN_HOSTNAME, BUNNY_VIDEO_WEBHOOK_TOKEN, RESEND_API_KEY, UNSUB_HMAC_SECRET, CRON_SECRET, DAILY_API_KEY, DAILY_DOMAIN, ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, APP_URL, PUSH_WEBHOOK_SECRET, REVENUECAT_WEBHOOK_AUTHORIZATION, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID.

- **Referenced in code but NOT set in cloud:** None.
- **Set in cloud but not referenced in any function:**  
  **LOVABLE_API_KEY**, **SUPABASE_DB_URL**, **BUNNY_WEBHOOK_SIGNING_KEY** — flag for potential cleanup if unused elsewhere.

### 2d. Live schema spot check

| Check | Result |
|-------|--------|
| **Public tables** | 42 |
| **Public routines (functions)** | 39 |
| **Storage buckets** | `chat-videos` (public: true), `proof-selfies` (public: false) — matches expectation (chat-videos public, proof-selfies private). |
| **Realtime publication tables** | admin_notifications, daily_drops, event_registrations, events, match_calls, matches, messages, profiles, push_notification_events, subscriptions, user_reports, video_sessions (12 tables) — matches expected set. |
| **Tables with RLS disabled** | None (query returned empty; all public tables have RLS enabled). |

---

## 3. Codebase health check

### apps/mobile
- **npm install:** Completed; 0 vulnerabilities.
- **npx tsc --noEmit:** **FAILED** (see below).

### Root
- **npm install:** Completed; 12 vulnerabilities (2 low, 5 moderate, 5 high) — run `npm audit` / `npm audit fix` as needed.
- **npx tsc --noEmit:** Passed (no errors).

### TypeScript errors in apps/mobile (origin/main)

1. **`app/(tabs)/events/[id].tsx`**  
   - Multiple “Cannot redeclare block-scoped variable” errors: `attendeeDisplays`, `mutualVibes`, `hasSentVibe`, `handleAttendeePress`, `ev`, `isFree`, `priceAmount`, `isFemale`, `userPrice`, `handleRegister`, `handlePurchase`, `handleUnregister`, `openCancelConfirm` (same names declared in more than one block).
   - Several “’ev’ is possibly ‘undefined’” at use sites.

2. **`app/(tabs)/profile/index.tsx`**  
   - Missing style keys: `vibeVideoUnavailable`, `vibeVideoUnavailableOverlay`, `vibeVideoUnavailableText`.
   - `VibeVideoPlayer` used with prop `theme` which is not in the component’s type (type only has `playbackUrl`, `thumbnailUrl`, `style`).

**Fix instruction:**  
- In `events/[id].tsx`: remove duplicate declarations (e.g. use a single set of variables/useCallback per scope, or rename inner declarations so they don’t shadow outer ones). Add null checks or non-null assertions for `ev` where appropriate.  
- In `profile/index.tsx`: add the three missing style entries to the styles object used by that screen, and either add `theme` to `VibeVideoPlayer`’s props type or remove the `theme` prop from the call site.

---

## 4. Native build readiness

### iOS
| Check | Result |
|-------|--------|
| **Podfile exists** | Yes — `apps/mobile/ios/Podfile` |
| **app.json ios** | bundleIdentifier: `com.vibelymeet.vibely`, deploymentTarget: 15.1 |
| **Info.plist CFBundleIdentifier** | Uses `$(PRODUCT_BUNDLE_IDENTIFIER)` — matches Expo/app.json. |
| **mobile.xcworkspace** | Exists — `apps/mobile/ios/mobile.xcworkspace` (ready after pod install). |

### Android
| Check | Result |
|-------|--------|
| **android/build.gradle** | **Not present** — `apps/mobile/android` directory not in repo (Expo managed workflow; `android/` is generated by `expo prebuild`). |
| **app.json android** | package: `com.vibelymeet.vibely`. |

Android native build requires running `npx expo prebuild` (or equivalent) to generate `android/` before building.

---

## 5. Overall verdict: **HAS ISSUES**

### Summary
- **Git:** Synced; main matches origin/main; working tree clean; .env not tracked.
- **Supabase:** Migrations, Edge Functions, and live schema (tables, RLS, buckets, realtime) are aligned; no critical secret gaps; 3 cloud-only secrets flagged for optional cleanup.
- **Codebase:** Root `tsc` passes; **apps/mobile `tsc` fails** due to events/[id].tsx and profile/index.tsx.
- **Build:** iOS structure and config present; Android relies on prebuild-generated folder.

### Issues to fix (by severity)

| Severity | Item | Fix |
|----------|------|-----|
| **HIGH** | apps/mobile TypeScript errors | Resolve redeclarations and `ev` undefined in `events/[id].tsx`; add missing styles and fix `VibeVideoPlayer` props in `profile/index.tsx`. Re-run `npx tsc --noEmit` in apps/mobile until clean. |
| **LOW** | Root npm vulnerabilities | Run `npm audit` and, if acceptable, `npm audit fix` (or `npm audit fix --force` for breaking changes). |
| **LOW** | Unused secrets (optional) | If confirmed unused: remove LOVABLE_API_KEY, SUPABASE_DB_URL, BUNNY_WEBHOOK_SIGNING_KEY from Supabase project secrets. |
| **INFO** | Stale local branches | Optionally delete merged local branches with `git branch -d <branch>` after verifying they are merged. |

---

*End of audit.*
