# Vibely Rebuild Master Backup Document

This document consolidates the audited rebuild pack into one place so it remains accessible even if file downloads from the chat UI fail.

The original frozen repo ZIP is separate and should be kept alongside this document.

---

## FILE: `README.md`

# Vibely Golden Rebuild Pack

This folder is the corrected rebuild pack generated from the frozen ZIP you uploaded.

## Files

- `VIBELY_GOLDEN_SNAPSHOT_AUDITED.md` — corrected human-readable snapshot
- `VIBELY_REBUILD_RUNBOOK.md` — rebuild procedure optimized for stress/failure recovery
- `VIBELY_DISCREPANCY_REPORT.md` — where the original Claude snapshot was incomplete or drifted
- `vibely_machine_inventory.json` — machine-readable inventory for Claude/Cursor
- `VIBELY_SCHEMA_APPENDIX.md` — human-readable table/view column appendix
- `VIBELY_EDGE_FUNCTION_MANIFEST.md` — per-function env/JWT manifest
- `VIBELY_MIGRATION_MANIFEST.md` — ordered migration list

## Best future recovery workflow

1. restore code from the frozen ZIP
2. read `VIBELY_GOLDEN_SNAPSHOT_AUDITED.md`
3. follow `VIBELY_REBUILD_RUNBOOK.md`
4. use `vibely_machine_inventory.json` as the structured reference while coding


---

## FILE: `VIBELY_GOLDEN_SNAPSHOT_AUDITED.md`

# VIBELY — AUDITED GOLDEN SNAPSHOT (Frozen ZIP)

Snapshot basis:
- ZIP root: `vibelymeet-pre-native-hardening-golden-2026-03-10`
- Supabase project ID in `supabase/config.toml`: `schdyxcunwcvddlcshwd`
- Purpose: rebuild-grade technical dossier derived from the frozen ZIP, not from memory

## What this pack is for

This audited pack is meant to make a future rebuild as deterministic as possible if the working repo becomes corrupted, drifts too far, or needs to be reconstructed in a clean environment.

Use this pack together with:
1. the frozen ZIP
2. the original Claude snapshot
3. the machine inventory JSON in this rebuild pack

## Audit verdict

Claude's snapshot is **directionally strong** and useful for strategy, but it is **not precise enough to be the only rebuild reference**.
The frozen ZIP contains additional files, functions, schema objects, environment details, and legacy surfaces that need to be preserved in the rebuild reference set.

## Repository identity

- Frontend framework: Vite + React + TypeScript
- Styling: Tailwind + shadcn/ui
- Routing: `react-router-dom`
- State/data libs: `@tanstack/react-query`
- Backend: Supabase (Auth, Postgres, Realtime, Edge Functions, Storage usages still present in places)
- Live video: Daily.co (`@daily-co/daily-js`)
- Video streaming/upload: Bunny Stream + TUS client
- Images / optimizer path: Bunny-backed edge upload path exists
- Analytics: `posthog-js`
- Errors: `@sentry/react`
- Payments: Stripe backend edge functions; web checkout redirect still present
- Notifications: OneSignal web integration + browser Notification/service worker code

## Root repository structure

Top-level entries in frozen ZIP root:
- `.gitignore`
- `README.md`
- `bun.lockb`
- `components.json`
- `eslint.config.js`
- `index.html`
- `package.json`
- `postcss.config.js`
- `tailwind.config.ts`
- `tsconfig.app.json`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`
- `public/`
- `src/`
- `supabase/`

## Frontend route map (actual routes from `src/App.tsx`)

Public / auth-ish:
- `/` → `Index`
- `/auth` → `Auth`
- `/verify-phone` → `VerifyPhone`
- `/onboarding` → `Onboarding`
- `/legal/privacy` → `Privacy`
- `/legal/terms` → `Terms`
- `/help` → `Help`

Main app:
- `/events` → `Events`
- `/event/:eventId` → `EventLobby`
- `/matches` → `Matches`
- `/chat/:matchId` → `Chat`
- `/video-date/:sessionId` → `VideoDate`
- `/profile` → `Profile`
- `/settings` → `Settings`
- `/schedule` → `Schedule`
- `/ready/:id` → `ReadyGate` (**legacy route still present**)
- `/vibe-feed` → `VibeFeed`
- `/vibe-studio` → `VibeStudio`
- `/premium` → `Premium`
- `/credits` → `Credits`
- `/subscription/success` → `SubscriptionSuccess`
- `/subscription/cancel` → `SubscriptionCancel`
- `/subscription/complete` → `SubscriptionComplete`

Admin:
- `/admin` → `Admin`
- `/admin/reviews` → `AdminReviews`
- `/admin/reports` → `AdminReports`
- `/admin/warnings` → `AdminWarnings`
- `/admin/suspensions` → `AdminSuspensions`
- `/admin/activity` → `AdminActivity`

Catchall:
- `*` → `NotFound`

## Pages present in repo but not all actively routed

Page files under `src/pages/` include:
- `Admin.tsx`
- `AdminActivity.tsx`
- `AdminReports.tsx`
- `AdminReviews.tsx`
- `AdminSuspensions.tsx`
- `AdminWarnings.tsx`
- `Auth.tsx`
- `Chat.tsx`
- `Credits.tsx`
- `EventLobby.tsx`
- `Events.tsx`
- `Help.tsx`
- `Index.tsx`
- `Matches.tsx`
- `NotFound.tsx`
- `Onboarding.tsx`
- `Premium.tsx`
- `Privacy.tsx`
- `Profile.tsx`
- `ReadyGate.tsx`
- `Schedule.tsx`
- `Settings.tsx`
- `SubscriptionCancel.tsx`
- `SubscriptionComplete.tsx`
- `SubscriptionSuccess.tsx`
- `Terms.tsx`
- `VerifyPhone.tsx`
- `VibeFeed.tsx`
- `VibeStudio.tsx`
- `VideoDate.tsx`
- `VideoLobby.tsx` (**exists but is not routed in `App.tsx`**)

## Key context / provider layer

Core providers / wrappers in `src/`:
- `App.tsx`
- `main.tsx`
- `contexts/AuthContext.tsx`
- `components/ProtectedRoute.tsx`
- `components/AdminRoute.tsx`
- `components/PhoneVerificationGuard.tsx`
- `components/ProfileCompletionGuard.tsx`
- `components/Layout.tsx`
- `integrations/supabase/client.ts`
- `integrations/supabase/types.ts`

## Hooks inventory (actual files in `src/hooks/`)

Data/domain hooks:
- `useAccountDeletion.tsx`
- `useAdminModeration.ts`
- `useAdminRoles.tsx`
- `useAdminVerificationReview.tsx`
- `useBlockStatus.tsx`
- `useConnectionQuality.ts`
- `useCredits.ts`
- `useDailyDrop.ts`
- `useEventDeck.ts`
- `useEventLobby.ts`
- `useEventPresence.ts`
- `useGeolocation.ts`
- `useIsMobile.tsx`
- `useMatches.ts`
- `useMessages.ts`
- `useOnboarding.ts`
- `usePhoneVerification.ts`
- `usePresence.ts`
- `useProfile.ts`
- `usePushNotifications.ts`
- `useReadyGate.ts`
- `useRealtimeMessages.ts`
- `useReconnection.ts`
- `useReportStatus.tsx`
- `useReportUser.ts`
- `useSendMessage.ts`
- `useSubscription.ts`
- `useSwipeAction.ts`
- `useToast.ts`
- `useVibeVideo.ts`
- `useVideoCall.ts`
- `useVideoDateFeedback.ts`
- `useWarnings.tsx`

## Service / utility inventory

Notable services and utilities under `src/`:
- `services/storageService.ts`
- `services/streamChatService.ts`
- `services/videoUploadService.ts`
- `services/videoThumbnailService.ts`
- `utils/dateUtils.ts`
- `utils/notificationHelpers.ts`
- `utils/onesignal.ts`
- `utils/verificationHelpers.ts`
- `lib/utils.ts`

## Component surface highlights

Important feature folders under `src/components/`:
- `admin/`
- `chat/`
- `events/`
- `lobby/`
- `messages/`
- `profile/`
- `subscription/`
- `ui/`
- feature-specific components like:
  - `DailyDropCard.tsx`
  - `EventCard.tsx`
  - `MatchCard.tsx`
  - `ProfileCompletionGuard.tsx`
  - `PushNotificationManager.tsx`
  - `ProtectedRoute.tsx`
  - `ReadyGateOverlay.tsx`
  - `SubscriptionPlans.tsx`
  - `VerificationSubmission.tsx`
  - `VibeStudioRecorder.tsx`

## Package-level dependency reality

Observed from `package.json` (important for rebuild):
- `@daily-co/daily-js`
- `@hookform/resolvers`
- `@radix-ui/*` family
- `@sentry/react`
- `@supabase/supabase-js`
- `@tanstack/react-query`
- `face-api.js`
- `framer-motion`
- `hls.js`
- `lucide-react`
- `posthog-js`
- `react`
- `react-dom`
- `react-hook-form`
- `react-router-dom`
- `sonner`
- `tailwind-merge`
- `tailwindcss-animate`
- `tus-js-client`
- `zod`

## Environment variables referenced in frontend code

### Vite-exposed vars actually referenced
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DAILY_DOMAIN`
- `VITE_ONESIGNAL_APP_ID`
- `VITE_SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST`
- `VITE_BUNNY_STREAM_LIBRARY_ID`
- `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- `VITE_BUNNY_PULL_ZONE`

### Hardcoded / non-env config points worth noting
- service worker path assumptions in push notification code
- browser notification permission flow assumptions
- origin-based redirect logic in subscription flow
- Daily domain fallbacks in call code
- OneSignal init path in auth bootstrapping and helpers

## Supabase local config identity

From `supabase/config.toml`:
- project_id: `schdyxcunwcvddlcshwd`

This is a key rebuild clue because it ties the frozen ZIP to a specific linked Supabase project.

## Supabase function inventory (actual folders in `supabase/functions/`)

Present function directories in frozen ZIP:
- `admin-review-verification`
- `cancel-deletion`
- `check-new-messages`
- `create-checkout-session`
- `create-video-upload`
- `daily-drop-action`
- `daily-room`
- `delete-account-now`
- `delete-user-and-data`
- `extend-video-date`
- `forward-geocode`
- `generate-daily-drop`
- `get-daily-upload-auth`
- `get-event-chat-token`
- `get-videos`
- `geocode-location`
- `mark-notifications-read`
- `push-webhook`
- `report-user`
- `request-account-deletion`
- `send-notification`
- `send-phone-verification`
- `send-video-date-notification`
- `stripe-webhook`
- `submit-verification`
- `upload-image`
- `video-webhook`
- `verify-phone-code`

## Function reality notes

Important rebuild-relevant observations:
- `push-webhook` exists and should not be omitted from rebuild manifests
- `forward-geocode` exists in addition to `geocode-location`
- Daily Drop already has a dedicated `daily-drop-action` function in the frozen ZIP
- Bunny auth/upload flow is split across multiple functions: `create-video-upload`, `video-webhook`, `get-daily-upload-auth`, `upload-image`
- Stripe flow includes both checkout creation and webhook processing

## Database / schema reference source

Primary schema evidence inside repo:
- `src/integrations/supabase/types.ts`
- `supabase/migrations/*.sql`

These should be treated together:
- `types.ts` for a typed snapshot of the generated client schema
- `migrations/` for ordered reconstruction of database evolution

## Migration inventory

There are **101 migration SQL files** in `supabase/migrations/` in the frozen ZIP.
This is enough that rebuild should use the exact existing order rather than trying to infer a smaller hand-picked subset.

See dedicated manifest: `VIBELY_MIGRATION_MANIFEST.md`.

## Storage / media reality

Current media architecture in frozen ZIP is mixed but clearly Bunny-oriented:
- vibe video upload orchestration exists via `create-video-upload`
- video processing reconciliation exists via `video-webhook`
- upload auth helper exists via `get-daily-upload-auth`
- image upload edge path exists via `upload-image`
- frontend still contains legacy storage-shaped patterns in places

Rebuild implication:
- do **not** assume a pure Supabase Storage media architecture
- do **not** assume a fully completed clean Bunny migration either
- preserve the current mixed real state exactly, then improve later

## Notification architecture reality

Notification implementation in frozen ZIP spans multiple layers:
- OneSignal helper / identity sync code
- browser Notification API usage
- service worker-related helper behavior
- backend send functions like `send-notification`
- webhook surface `push-webhook`
- read-state / message checks via edge functions

Rebuild implication:
This is not a single-provider clean system. Preserve the current layered behavior first.

## Payment architecture reality

Current web version uses:
- frontend subscription hooks/pages
- `create-checkout-session`
- `stripe-webhook`
- browser redirect-based checkout flow

Rebuild implication:
- restore current Stripe web flow as-is before redesigning entitlements/native billing

## Admin / moderation reality

The repo contains a meaningful admin surface plus backend functions for moderation / verification:
- admin pages and route guard
- verification review hook and function
- report/warning/suspension/admin activity pages
- report/block related hooks

Rebuild implication:
This is part of the real product surface and not just tooling.

## Legacy / cleanup surfaces that should be documented, not accidentally treated as current truth

These exist in frozen ZIP and must be remembered during rebuild, but they should be classified carefully:
- `src/pages/VideoLobby.tsx` exists but is not actively routed
- `/ready/:id` route still exists although lobby overlay flow is the more modern UX path
- `VibeFeed.tsx` exists and may still reflect mock/demo-style behavior in parts
- `face-api.js` remains in dependencies

## Files that deserve especially careful preservation during rebuild

Frontend critical:
- `src/App.tsx`
- `src/contexts/AuthContext.tsx`
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `src/hooks/useVideoCall.ts`
- `src/pages/VideoDate.tsx`
- `src/hooks/useReadyGate.ts`
- `src/hooks/useDailyDrop.ts`
- `src/hooks/useSwipeAction.ts`
- `src/hooks/useSubscription.ts`
- `src/services/storageService.ts`
- `src/services/videoUploadService.ts`

Backend critical:
- all of `supabase/functions/`
- all of `supabase/migrations/`
- `supabase/config.toml`

## Rebuild-grade warnings

1. Do not rely on Claude's original prose snapshot alone.
2. Do not infer active routes purely from `src/pages/` file names.
3. Do not forget `push-webhook` and `forward-geocode`.
4. Do not assume a fully clean provider separation for notifications or media.
5. Do not throw away legacy surfaces until the rebuilt app is running.
6. Do not regenerate schema blindly without preserving migration order and current typed shape.

## Recommended minimum rebuild reference set

For any future rebuild, keep together:
1. frozen ZIP
2. this audited snapshot
3. `VIBELY_REBUILD_RUNBOOK.md`
4. `VIBELY_SCHEMA_APPENDIX.md`
5. `VIBELY_EDGE_FUNCTION_MANIFEST.md`
6. `VIBELY_MIGRATION_MANIFEST.md`
7. `vibely_machine_inventory.json`


---

## FILE: `VIBELY_REBUILD_RUNBOOK.md`

# VIBELY — REBUILD RUNBOOK (Frozen ZIP)

This runbook is optimized for one goal:
**rebuild the frozen March 10, 2026 web version as quickly and safely as possible from the ZIP and the audited snapshot.**

It does not assume perfect memory.
It does not assume Claude's original document is complete.
It assumes you may be rebuilding under stress.

## 0. Recovery strategy

If the active working repo is damaged:

1. create a **new clean working directory**
2. unzip the frozen archive there
3. use this runbook plus `vibely_machine_inventory.json`
4. rebuild infrastructure in this order:
   - local app install
   - frontend environment
   - Supabase project
   - migrations/schema
   - Edge Functions
   - media/provider settings
   - Stripe/webhook behavior
   - notification behavior
   - smoke test critical flows

Do **not** start by trying to remember what Vibely "probably" looked like.
Start from the frozen ZIP and preserve what is actually there.

## 1. Inputs required for rebuild

Required assets:
- frozen repo ZIP: `vibelymeet-pre-native-hardening-golden-2026-03-10.zip`
- audited snapshot: `VIBELY_GOLDEN_SNAPSHOT_AUDITED.md`
- machine inventory: `vibely_machine_inventory.json`
- migration manifest: `VIBELY_MIGRATION_MANIFEST.md`
- edge function manifest: `VIBELY_EDGE_FUNCTION_MANIFEST.md`
- schema appendix: `VIBELY_SCHEMA_APPENDIX.md`
- original Claude snapshot (optional but useful for narrative context)

You will also need secrets/config values that are **not stored in this pack**.

## 2. Create clean working repo

1. create a new directory
2. unzip the frozen repo there
3. verify root contains:
   - `package.json`
   - `src/`
   - `supabase/`
   - Vite/Tailwind/TypeScript config files
4. do **not** start from a later damaged branch and try to backtrack manually

## 3. Frontend install + boot

Expected frontend stack:
- Vite
- React
- TypeScript
- Tailwind
- shadcn/ui components
- Supabase JS client
- React Query

Suggested sequence:
1. ensure correct Node/Bun/npm toolchain available
2. install dependencies from `package.json`
3. boot dev server
4. fix only environment-variable errors first

Critical frontend env vars to restore:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DAILY_DOMAIN`
- `VITE_ONESIGNAL_APP_ID`
- `VITE_SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST`
- `VITE_BUNNY_STREAM_LIBRARY_ID`
- `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- `VITE_BUNNY_PULL_ZONE`

Do not guess these values from old code. Pull them from your secure records / provider dashboards.

## 4. Route restoration checklist

Restore and verify these routes first:
- `/`
- `/auth`
- `/onboarding`
- `/events`
- `/event/:eventId`
- `/matches`
- `/chat/:matchId`
- `/video-date/:sessionId`
- `/profile`
- `/settings`
- `/premium`
- `/credits`
- `/admin`

Secondary/legacy but present:
- `/schedule`
- `/ready/:id`
- `/vibe-feed`
- `/vibe-studio`
- subscription result routes
- legal/help routes

Important:
`VideoLobby.tsx` exists in repo but is **not** part of active route map.

## 5. Supabase restore strategy

Use the frozen ZIP's `supabase/` folder as source of truth for local backend code.

Critical artifacts:
- `supabase/config.toml`
- `supabase/functions/`
- `supabase/migrations/`

Known local project identifier from frozen config:
- `project_id = schdyxcunwcvddlcshwd`

Rebuild approach:
1. create/link correct Supabase project
2. restore schema by running migrations in exact existing order
3. verify generated schema shape against `src/integrations/supabase/types.ts`
4. deploy Edge Functions
5. re-enter required secrets
6. validate auth, DB access, Realtime, and function responses

Do not assume a dashboard restore covers everything.

## 6. Migration restoration

There are 101 migration files.
Run them in exact filename order.
Use `VIBELY_MIGRATION_MANIFEST.md` if you need a deterministic checklist.

After migration run:
- compare resulting tables/views/functions to `VIBELY_SCHEMA_APPENDIX.md`
- compare generated schema usage to `src/integrations/supabase/types.ts`
- spot-check critical tables like:
  - `profiles`
  - `matches`
  - `messages`
  - `video_sessions`
  - `daily_drops`
  - `notification_preferences`
  - moderation/admin tables

If any migration fails:
- do not skip it casually
- inspect dependencies and adjacent migration files
- repair forward in a new clean test project if needed

## 7. Edge Function deployment

Function directories present in frozen ZIP:
- `admin-review-verification`
- `cancel-deletion`
- `check-new-messages`
- `create-checkout-session`
- `create-video-upload`
- `daily-drop-action`
- `daily-room`
- `delete-account-now`
- `delete-user-and-data`
- `extend-video-date`
- `forward-geocode`
- `generate-daily-drop`
- `get-daily-upload-auth`
- `get-event-chat-token`
- `get-videos`
- `geocode-location`
- `mark-notifications-read`
- `push-webhook`
- `report-user`
- `request-account-deletion`
- `send-notification`
- `send-phone-verification`
- `send-video-date-notification`
- `stripe-webhook`
- `submit-verification`
- `upload-image`
- `video-webhook`
- `verify-phone-code`

Use `VIBELY_EDGE_FUNCTION_MANIFEST.md` for:
- `verify_jwt` status
- per-function env vars used
- exact source path

Rebuild order suggestion:
1. deploy generic/core functions
2. deploy auth/verification functions
3. deploy media functions
4. deploy payment functions
5. deploy notification functions
6. deploy admin/moderation functions

## 8. Function/config hotspots

Pay special attention to these because they affect major product loops:

### Video / date loop
- `daily-room`
- `extend-video-date`
- `send-video-date-notification`
- `useVideoCall.ts`
- `VideoDate.tsx`
- `useReadyGate.ts`

### Daily Drop
- `daily-drop-action`
- `generate-daily-drop`
- `useDailyDrop.ts`

### Payments
- `create-checkout-session`
- `stripe-webhook`
- `useSubscription.ts`

### Media
- `create-video-upload`
- `video-webhook`
- `get-daily-upload-auth`
- `upload-image`
- `storageService.ts`
- `videoUploadService.ts`

### Notifications
- `send-notification`
- `push-webhook`
- `check-new-messages`
- `mark-notifications-read`
- `usePushNotifications.ts`
- `utils/onesignal.ts`

## 9. Third-party integration restoration map

Restore external providers in this practical order:

1. Supabase
2. Daily.co
3. Bunny
4. Stripe
5. Twilio
6. Resend
7. OneSignal / browser push setup
8. PostHog
9. Sentry

Reason:
- Supabase and Daily are required for core loop
- Bunny is required for media
- Stripe/Twilio/Resend add monetization + verification + email
- analytics/error tooling last

## 10. Media restoration notes

Current frozen code indicates a mixed but Bunny-leaning architecture.

Rebuild requirements:
- restore Bunny-related env vars
- deploy video/image helper functions
- verify upload path from frontend services
- verify playback path assumptions in frontend
- preserve current behavior before attempting architectural cleanup

Do not rewrite media architecture during rebuild.
Get back to the frozen working state first.

## 11. Notification restoration notes

Frozen version uses more than one notification layer.
Preserve current behavior rather than redesigning during rebuild.

Check:
- browser notification permissions flow
- service worker-related behavior if present
- OneSignal initialization path
- backend send functions and webhook behavior
- unread/read message polling/function path

## 12. Payment restoration notes

Restore current web Stripe checkout flow exactly as it exists:
- frontend subscription pages/hooks
- checkout-session edge function
- Stripe webhook function
- success/cancel/complete routes

Do not prematurely substitute RevenueCat/native billing in a web rebuild.

## 13. Admin + moderation restoration notes

Verify:
- admin routes work
- admin role guard works
- moderation tables/data access work
- verification review flow works
- report flows do not crash

This is part of the real app surface.

## 14. Smoke test order after restore

Run these in order:

1. app boots to `/`
2. auth screen opens
3. login/signup flow loads without missing env/config errors
4. profile fetch works after auth
5. events list loads
6. entering event lobby loads deck/presence logic
7. matches list loads
8. chat screen loads for known match
9. video-date screen renders without fatal provider errors
10. admin route loads for admin user
11. premium/credits pages load
12. legal/help pages load

Then deeper checks:
- phone verification request/verify path
- video upload path
- Daily Drop fetch/action path
- ready gate state transitions
- checkout session creation

## 15. What **not** to do in a stress rebuild

Do not:
- delete legacy files just because they look outdated
- infer routes from filenames
- trust memory over the frozen ZIP
- redesign architecture while trying to recover uptime
- regenerate app structure from scratch when the ZIP already has it
- skip functions omitted from earlier prose docs (`push-webhook`, `forward-geocode`, etc.)

## 16. Rebuild success criteria

You can treat the frozen March 10 web app as functionally restored when:
- app boots cleanly
- auth works
- profile loads
- events + lobby work
- match/chat screens work
- video-date route loads and core call plumbing is connected
- Daily Drop path does not fail due to missing DB/function shape
- premium/credits routes load
- admin area loads for admin user
- critical edge functions are deployed and reachable

## 17. After the rebuild is stable

Only then:
- compare against Claude's broader strategic notes
- decide what to harden or refactor
- begin the Cursor remediation campaign
- begin native preparation from a known-good reconstructed baseline


---

## FILE: `VIBELY_DISCREPANCY_REPORT.md`

# VIBELY — DISCREPANCY REPORT AGAINST CLAUDE SNAPSHOT

This file records where the original `vibely-golden-snapshot.md` was incomplete, stale, or inaccurate when compared directly against the frozen ZIP.

## High-confidence discrepancies

### 1. Tag / freeze metadata drift
The original document refers to a tag `v1.0-golden-pre-native (to be created)`.
The frozen ZIP delivered for audit is named:
`vibelymeet-pre-native-hardening-golden-2026-03-10.zip`

Treat the ZIP and its release/tag metadata as the real freeze point.

### 2. Missing routed-vs-unrouted distinction
The repo contains `src/pages/VideoLobby.tsx`, but `src/App.tsx` does not route to it.
It should not be treated as an active page just because it exists in `src/pages`.

### 3. Missing hooks
The original prose snapshot omitted multiple real hook files, including:
- use-mobile.tsx
- `useConnectionQuality.ts`
- `usePresence.ts`
- `useWarnings.tsx`
- `useBlockStatus.tsx`
- `useReportStatus.tsx`

### 4. Missing services/utilities detail
The original document did not clearly inventory service/utility files such as:
- `services/videoThumbnailService.ts`
- `services/streamChatService.ts`
- `utils/notificationHelpers.ts`
- `utils/verificationHelpers.ts`
- `utils/onesignal.ts`

### 5. Missing edge functions
The original snapshot missed real function folders in the frozen ZIP, including:
- `push-webhook`
- `forward-geocode`
- `get-videos`
- `mark-notifications-read`

### 6. Dependency drift / understatement
The original document discussed providers conceptually but did not preserve the actual dependency surface from `package.json`.
Critical rebuild dependencies explicitly present include:
- `@daily-co/daily-js`
- `@sentry/react`
- `posthog-js`
- `hls.js`
- `tus-js-client`
- `face-api.js`

### 7. Env-var reality not fully captured
The original prose snapshot did not preserve the full frontend env-var footprint observed in the frozen codebase, including Bunny/CDN-related vars and analytics vars.

### 8. Functionality phrasing ahead of code reality
The original document sometimes described target architecture or desired ownership model as if it were the current implemented state.
For rebuild purposes, that is risky.
Example areas:
- notifications
- media migration completeness
- server ownership of Daily Drop / swipe side effects

### 9. Migration count and exact manifest missing
The original document referenced migrations generally, but not the exact count and ordered filename manifest.
The frozen ZIP has 101 migration files and they should be treated as a deterministic ordered set.

### 10. Schema appendix absent
The original document described data domains, but did not include a field-level human-readable appendix derived from the actual generated types.

## Conclusion

Claude's original snapshot remains useful for product understanding and strategic discussion.
It should **not** be the sole rebuild artifact.
The audited pack is the authoritative technical rebuild supplement.


---

## FILE: `VIBELY_SCHEMA_APPENDIX.md`

# VIBELY — SCHEMA APPENDIX

Human-readable appendix derived from `src/integrations/supabase/types.ts` in the frozen ZIP.

## Table: `account_deletion_requests`

- `cancelled_at`: `string | null`
- `completed_at`: `string | null`
- `id`: `string`
- `reason`: `string | null`
- `requested_at`: `string | null`
- `scheduled_deletion_at`: `string | null`
- `status`: `string | null`
- `user_id`: `string`

## Table: `admin_activity_logs`

- `action_type`: `string`
- `admin_id`: `string`
- `created_at`: `string`
- `details`: `Json | null`
- `id`: `string`
- `target_id`: `string | null`
- `target_type`: `string | null`

## Table: `admin_notification_logs`

- `admin_id`: `string | null`
- `created_at`: `string | null`
- `details`: `Json | null`
- `id`: `string`
- `notification_type`: `string`
- `recipient_user_id`: `string | null`
- `status`: `string | null`

## Table: `admin_roles`

- `role`: `Database["public"]["Enums"]["app_role"]`
- `user_id`: `string`

## Table: `admin_warnings`

- `admin_id`: `string`
- `created_at`: `string`
- `expires_at`: `string | null`
- `id`: `string`
- `is_active`: `boolean | null`
- `message`: `string`
- `severity`: `string`
- `title`: `string`
- `user_id`: `string`

## Table: `daily_drop_passes`

- `created_at`: `string | null`
- `daily_drop_id`: `string`
- `id`: `string`
- `passer_user_id`: `string`

## Table: `daily_drops`

- `affinity_score`: `number | null`
- `candidate_a_id`: `string`
- `candidate_b_id`: `string`
- `created_at`: `string | null`
- `drop_expires_at`: `string | null`
- `id`: `string`
- `message_candidate_a`: `string | null`
- `message_candidate_b`: `string | null`
- `pick_reasons`: `Json | null`
- `reply_message`: `string | null`
- `replied_at`: `string | null`
- `replier_user_id`: `string | null`
- `status`: `string | null`
- `updated_at`: `string | null`
- `viewed_candidate_a_at`: `string | null`
- `viewed_candidate_b_at`: `string | null`

## Table: `event_attendees`

- `arrived_at`: `string | null`
- `created_at`: `string | null`
- `event_id`: `string`
- `id`: `string`
- `is_active`: `boolean | null`
- `joined_at`: `string | null`
- `last_seen_at`: `string | null`
- `status`: `string | null`
- `user_id`: `string`

## Table: `events`

- `city`: `string | null`
- `cover_image_url`: `string | null`
- `created_at`: `string | null`
- `current_attendees`: `number | null`
- `description`: `string | null`
- `end_time`: `string | null`
- `event_date`: `string`
- `id`: `string`
- `is_active`: `boolean | null`
- `location`: `string | null`
- `max_attendees`: `number | null`
- `name`: `string`
- `slug`: `string | null`
- `start_time`: `string | null`
- `timezone`: `string | null`

## Table: `location_cache`

- `city`: `string | null`
- `created_at`: `string | null`
- `display_name`: `string | null`
- `id`: `string`
- `latitude`: `number`
- `longitude`: `number`
- `normalized_query`: `string`

## Table: `match_video_dates`

- `completed_at`: `string | null`
- `created_at`: `string | null`
- `id`: `string`
- `match_id`: `string`
- `scheduled_for`: `string | null`
- `status`: `string | null`
- `updated_at`: `string | null`

## Table: `matches`

- `created_at`: `string | null`
- `event_id`: `string | null`
- `id`: `string`
- `match_type`: `string | null`
- `status`: `string | null`
- `updated_at`: `string | null`
- `user1_id`: `string`
- `user2_id`: `string`

## Table: `message_read_receipts`

- `message_id`: `string`
- `read_at`: `string | null`
- `user_id`: `string`

## Table: `messages`

- `content`: `string`
- `created_at`: `string | null`
- `id`: `string`
- `match_id`: `string`
- `message_type`: `string | null`
- `sender_id`: `string`
- `video_url`: `string | null`

## Table: `notification_preferences`

- `created_at`: `string | null`
- `daily_drop_notifications`: `boolean | null`
- `id`: `string`
- `last_web_subscription`: `Json | null`
- `match_notifications`: `boolean | null`
- `message_notifications`: `boolean | null`
- `onesignal_external_id`: `string | null`
- `onesignal_player_id`: `string | null`
- `push_enabled`: `boolean | null`
- `push_permission_status`: `string | null`
- `ready_gate_notifications`: `boolean | null`
- `updated_at`: `string | null`
- `user_id`: `string`
- `video_date_notifications`: `boolean | null`

## Table: `phone_verification_attempts`

- `attempt_type`: `string`
- `code`: `string`
- `created_at`: `string | null`
- `expires_at`: `string`
- `id`: `string`
- `ip_address`: `unknown | null`
- `phone`: `string`
- `used_at`: `string | null`
- `user_id`: `string | null`

## Table: `presence`

- `created_at`: `string | null`
- `event_id`: `string`
- `id`: `string`
- `is_online`: `boolean | null`
- `last_seen_at`: `string | null`
- `user_id`: `string`

## Table: `profiles`

- `bio`: `string | null`
- `bunny_video_status`: `string | null`
- `bunny_video_uid`: `string | null`
- `city`: `string | null`
- `created_at`: `string | null`
- `dob`: `string | null`
- `event_joined_at`: `string | null`
- `first_name`: `string | null`
- `gender`: `string | null`
- `id`: `string`
- `interested_in`: `string[] | null`
- `is_paused`: `boolean | null`
- `is_profile_complete`: `boolean | null`
- `is_suspended`: `boolean | null`
- `is_verified`: `boolean | null`
- `last_active`: `string | null`
- `latitude`: `number | null`
- `longitude`: `number | null`
- `phone`: `string | null`
- `phone_verified`: `boolean | null`
- `photo_urls`: `string[] | null`
- `preferred_age_max`: `number | null`
- `preferred_age_min`: `number | null`
- `premium_expires_at`: `string | null`
- `super_vibes_remaining`: `number | null`
- `updated_at`: `string | null`
- `vibe_video_url`: `string | null`

## Table: `report_reasons`

- `category`: `string`
- `created_at`: `string | null`
- `description`: `string | null`
- `display_order`: `number | null`
- `id`: `string`
- `is_active`: `boolean | null`
- `label`: `string`
- `severity_weight`: `number | null`

## Table: `reports`

- `created_at`: `string | null`
- `id`: `string`
- `match_id`: `string | null`
- `reason_id`: `string | null`
- `reported_user_id`: `string`
- `reporter_user_id`: `string`
- `session_id`: `string | null`
- `status`: `string | null`

## Table: `subscriptions`

- `created_at`: `string | null`
- `current_period_end`: `string | null`
- `id`: `string`
- `plan_name`: `string | null`
- `status`: `string | null`
- `stripe_customer_id`: `string | null`
- `stripe_subscription_id`: `string | null`
- `updated_at`: `string | null`
- `user_id`: `string`

## Table: `super_vibes`

- `created_at`: `string | null`
- `event_id`: `string | null`
- `from_user_id`: `string`
- `id`: `string`
- `to_user_id`: `string`

## Table: `suspensions`

- `created_at`: `string | null`
- `duration_days`: `number | null`
- `expires_at`: `string | null`
- `id`: `string`
- `is_active`: `boolean | null`
- `reason`: `string`
- `suspended_by`: `string | null`
- `user_id`: `string`

## Table: `swipes`

- `created_at`: `string | null`
- `event_id`: `string | null`
- `from_user_id`: `string`
- `id`: `string`
- `swipe_type`: `string`
- `to_user_id`: `string`

## Table: `verification_submissions`

- `created_at`: `string | null`
- `id`: `string`
- `reviewed_at`: `string | null`
- `reviewed_by`: `string | null`
- `selfie_photo_url`: `string`
- `status`: `string | null`
- `submission_photo_url`: `string | null`
- `user_id`: `string`

## Table: `video_date_feedback`

- `created_at`: `string | null`
- `feedback_type`: `string`
- `id`: `string`
- `session_id`: `string`
- `user_id`: `string`
- `value`: `Json`

## Table: `video_sessions`

- `blur_amount`: `number | null`
- `call_duration_seconds`: `number | null`
- `completed_at`: `string | null`
- `created_at`: `string | null`
- `daily_room_name`: `string | null`
- `daily_room_url`: `string | null`
- `ended_at`: `string | null`
- `event_id`: `string | null`
- `extended_seconds`: `number | null`
- `feedback_submitted_by_user1`: `boolean | null`
- `feedback_submitted_by_user2`: `boolean | null`
- `id`: `string`
- `is_extended`: `boolean | null`
- `match_id`: `string | null`
- `room_created_at`: `string | null`
- `scheduled_at`: `string | null`
- `started_at`: `string | null`
- `status`: `string | null`
- `user1_blur_removed`: `boolean | null`
- `user1_id`: `string`
- `user1_ready_at`: `string | null`
- `user1_snoozed_until`: `string | null`
- `user2_blur_removed`: `boolean | null`
- `user2_id`: `string`
- `user2_ready_at`: `string | null`
- `user2_snoozed_until`: `string | null`

## View: `admin_user_summary`

- `active_suspensions_count`: `number | null`
- `active_warnings_count`: `number | null`
- `bio`: `string | null`
- `created_at`: `string | null`
- `event_attendance_count`: `number | null`
- `first_name`: `string | null`
- `id`: `string | null`
- `is_suspended`: `boolean | null`
- `is_verified`: `boolean | null`
- `match_count`: `number | null`
- `phone_verified`: `boolean | null`
- `report_count`: `number | null`
- `user_status`: `string | null`
- `verification_status`: `string | null`

## View: `event_attendee_summary`

- `bio`: `string | null`
- `city`: `string | null`
- `event_id`: `string | null`
- `first_name`: `string | null`
- `id`: `string | null`
- `joined_at`: `string | null`
- `photo_urls`: `string[] | null`
- `user_status`: `string | null`
- `vibe_video_url`: `string | null`

## View: `user_daily_drop_partner`

- `affinity_score`: `number | null`
- `drop_expires_at`: `string | null`
- `id`: `string | null`
- `partner_bio`: `string | null`
- `partner_city`: `string | null`
- `partner_first_name`: `string | null`
- `partner_id`: `string | null`
- `partner_photo_urls`: `string[] | null`
- `partner_vibe_video_url`: `string | null`
- `pick_reasons`: `Json | null`
- `reply_message`: `string | null`
- `status`: `string | null`

## Key enums referenced in generated types

At minimum, generated types reference enums including:
- `app_role`

For deeper enum/function mapping, use `vibely_machine_inventory.json` plus migrations.


---

## FILE: `VIBELY_EDGE_FUNCTION_MANIFEST.md`

# VIBELY — EDGE FUNCTION MANIFEST

Per-function manifest derived from the frozen ZIP.

## `admin-review-verification`

- `verify_jwt`: `false`
- `path`: `supabase/functions/admin-review-verification/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `cancel-deletion`

- `verify_jwt`: `false`
- `path`: `supabase/functions/cancel-deletion/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## `check-new-messages`

- `verify_jwt`: `false`
- `path`: `supabase/functions/check-new-messages/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `create-checkout-session`

- `verify_jwt`: `false`
- `path`: `supabase/functions/create-checkout-session/index.ts`
- env vars used:
  - `STRIPE_SECRET_KEY`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `create-video-upload`

- `verify_jwt`: `false`
- `path`: `supabase/functions/create-video-upload/index.ts`
- env vars used:
  - `BUNNY_API_KEY`
  - `BUNNY_LIBRARY_ID`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `daily-drop-action`

- `verify_jwt`: `false`
- `path`: `supabase/functions/daily-drop-action/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `daily-room`

- `verify_jwt`: `false`
- `path`: `supabase/functions/daily-room/index.ts`
- env vars used:
  - `DAILY_API_KEY`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `delete-account-now`

- `verify_jwt`: `false`
- `path`: `supabase/functions/delete-account-now/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `delete-user-and-data`

- `verify_jwt`: `false`
- `path`: `supabase/functions/delete-user-and-data/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `extend-video-date`

- `verify_jwt`: `false`
- `path`: `supabase/functions/extend-video-date/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `forward-geocode`

- `verify_jwt`: `false`
- `path`: `supabase/functions/forward-geocode/index.ts`
- env vars used:
  - `OPENCAGE_API_KEY`

## `generate-daily-drop`

- `verify_jwt`: `false`
- `path`: `supabase/functions/generate-daily-drop/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `get-daily-upload-auth`

- `verify_jwt`: `false`
- `path`: `supabase/functions/get-daily-upload-auth/index.ts`
- env vars used:
  - `BUNNY_STREAM_API_KEY`
  - `BUNNY_STREAM_LIBRARY_ID`

## `get-event-chat-token`

- `verify_jwt`: `false`
- `path`: `supabase/functions/get-event-chat-token/index.ts`
- env vars used:
  - `GETSTREAM_API_KEY`
  - `GETSTREAM_SECRET`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `get-videos`

- `verify_jwt`: `false`
- `path`: `supabase/functions/get-videos/index.ts`
- env vars used:
  - `BUNNY_LIBRARY_ID`
  - `BUNNY_STREAM_API_KEY`

## `geocode-location`

- `verify_jwt`: `false`
- `path`: `supabase/functions/geocode-location/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `mark-notifications-read`

- `verify_jwt`: `false`
- `path`: `supabase/functions/mark-notifications-read/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `push-webhook`

- `verify_jwt`: `false`
- `path`: `supabase/functions/push-webhook/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `report-user`

- `verify_jwt`: `false`
- `path`: `supabase/functions/report-user/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `request-account-deletion`

- `verify_jwt`: `false`
- `path`: `supabase/functions/request-account-deletion/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `send-notification`

- `verify_jwt`: `false`
- `path`: `supabase/functions/send-notification/index.ts`
- env vars used:
  - `ONESIGNAL_API_KEY`
  - `ONESIGNAL_APP_ID`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `send-phone-verification`

- `verify_jwt`: `false`
- `path`: `supabase/functions/send-phone-verification/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_VERIFY_SERVICE_SID`

## `send-video-date-notification`

- `verify_jwt`: `false`
- `path`: `supabase/functions/send-video-date-notification/index.ts`
- env vars used:
  - `ONESIGNAL_API_KEY`
  - `ONESIGNAL_APP_ID`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `stripe-webhook`

- `verify_jwt`: `false`
- `path`: `supabase/functions/stripe-webhook/index.ts`
- env vars used:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `submit-verification`

- `verify_jwt`: `false`
- `path`: `supabase/functions/submit-verification/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `upload-image`

- `verify_jwt`: `false`
- `path`: `supabase/functions/upload-image/index.ts`
- env vars used:
  - `BUNNY_API_KEY`
  - `BUNNY_PULL_ZONE`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `video-webhook`

- `verify_jwt`: `false`
- `path`: `supabase/functions/video-webhook/index.ts`
- env vars used:
  - `BUNNY_WEBHOOK_SECRET`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

## `verify-phone-code`

- `verify_jwt`: `false`
- `path`: `supabase/functions/verify-phone-code/index.ts`
- env vars used:
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_VERIFY_SERVICE_SID`


---

## FILE: `VIBELY_MIGRATION_MANIFEST.md`

# VIBELY — MIGRATION MANIFEST

Total migrations: 101

Run in this exact filename order during a clean rebuild.

- `20251218002545_d8e57774-e32c-4b62-ba72-476b014bc930.sql`
- `20251218002813_781c162f-bcbf-42b7-838a-a72e0dc707c5.sql`
- `20251224173423_eb996d9b-303c-48e3-a50a-a9a69770826a.sql`
- `20251224180727_028b6b04-5827-4b12-be42-62519912f183.sql`
- `20251226160948_a55c9710-fd6f-44cf-b89c-447d97a9c5ca.sql`
- `20251227005244_73d18021-43bd-4b86-b7df-c49f7d22bd64.sql`
- `20251227010039_421d6f54-df51-4071-a774-706459484397.sql`
- `20251227011125_a767d943-0e04-4a06-95e5-3ee652415a9a.sql`
- `20251227012106_b28f04de-470b-434d-b31a-00931a538f09.sql`
- `20251228015626_8e73a470-1845-4f79-ab42-3de8c0559150.sql`
- `20251228020729_f7163dec-ca6b-44aa-98f7-0d1d89d8bd37.sql`
- `20251228022019_184acae1-ce11-4e1a-be8e-6a031d1d887b.sql`
- `20251229003354_00812dea-4711-4487-bc86-f845cae730ba.sql`
- `20251229004756_88f6cd10-26e6-4ad9-8024-2db3f6d66ef8.sql`
- `20251229013346_6e64bf4d-44b9-4e20-9922-97c532cfb7f2.sql`
- `20251229013725_18f0a78c-f013-4433-af7c-d789f9d45afa.sql`
- `20251229152418_18e7e727-8040-451f-ba5d-cc1e66fefd83.sql`
- `20251229152440_9503fed6-cf35-4a8d-8bec-b6e7ece6ea6c.sql`
- `20251229152945_1deed53b-98ee-4da9-b23b-b6db955de4a9.sql`
- `20251229155431_02d5d0a2-e85f-4dc3-b2aa-a42f72586d1d.sql`
- `20251229170851_47b84ea5-3ff4-490a-8673-f6464af46679.sql`
- `20251229171139_096c9bdc-b0d2-43b0-b0a4-b87fd177ee10.sql`
- `20251229171318_72dcbfb4-bbec-4260-a450-0fa265cd4ed3.sql`
- `20251229171447_8eeae4f9-8d8c-41f6-8a6f-02dcaf13c89d.sql`
- `20251229173950_4799c9b4-9aad-42c4-b1df-f0eb831d17a9.sql`
- `20251229174147_0f8115da-b7a8-44e4-b781-71cb6f5fcd30.sql`
- `20251229175638_3a72323d-65db-450e-a0f2-164621e1d772.sql`
- `20251229185711_cd8f095d-56d8-416c-b31c-42250346b8b5.sql`
- `20251229191212_a917424a-4838-4f50-8f05-dd0e5ba83cab.sql`
- `20251229202344_56320c09-0aa6-4f56-bf91-25f4ba6b1698.sql`
- `20251229203539_913d49db-4fca-4460-a18c-7583414674cc.sql`
- `20251229210229_b204be89-a193-474a-ae6d-9eed7d17a98e.sql`
- `20251229223933_92c632f3-85e6-44aa-b635-9f12127da1be.sql`
- `20251229231111_de0fb937-c8c7-4efe-90e8-5377def691c6.sql`
- `20251229233513_e4657489-77f7-45cc-aafc-57783628c776.sql`
- `20251230000306_fa5d0e75-1f2d-4c85-af7e-11bfe3fef6c8.sql`
- `20251230003255_5da62482-9bb9-4e69-91ed-f7c685ea7d37.sql`
- `20251230005453_48176a4b-4419-4a17-ab11-ec139e9ab6e0.sql`
- `20251230010234_8e497c11-c950-471e-b22d-bf4e101ae5c8.sql`
- `20251230151159_0ebeec11-ce4b-468b-aa7d-b1bd8ae59208.sql`
- `20251230152737_c0ce8b82-c2f1-4d77-8dc4-a107e1cba17b.sql`
- `20251230153018_4b6e296c-80f4-4166-af39-d6bd09edfb07.sql`
- `20251230153338_05a4c7ea-4e4b-4e5a-87b6-708ad24c419d.sql`
- `20251230171051_b7543a69-ebc0-45d0-ac22-95de286dff4e.sql`
- `20251230171420_25b83818-19fc-4f71-af09-5b8dfd43bc54.sql`
- `20251230171956_7007851a-ac28-470b-8d1c-c54d6b3310f8.sql`
- `20251230184519_6dfc7270-42a4-4a53-b3f6-dd09c1dadae1.sql`
- `20251230191255_56de4c71-0984-44ee-ac90-009f9d2811c7.sql`
- `20251230192018_d93cd57e-c564-40d1-9d78-3aa769758f62.sql`
- `20251230200540_21f46de2-cd4c-4238-a2d2-8e718bde6ceb.sql`
- `20251230202555_0db3efbc-f735-4a98-ac10-47f672a8b2d0.sql`
- `20251230213035_4cf08a1b-c858-4fdb-9c17-2fe0e5d51800.sql`
- `20251230230726_600c0d4d-4e98-4ea6-b75a-62e8c77df5c1.sql`
- `20251231002241_4f57681d-798a-49f8-b010-c271c8b3c350.sql`
- `20251231003808_7bbabce7-33e2-4903-9078-c5ab77bfa53d.sql`
- `20251231030332_c444d5e7-23e0-49e6-b965-31f6ebf07486.sql`
- `20251231030907_561c8836-281f-4827-b849-d438a898f261.sql`
- `20251231031514_3150c953-770e-4eb5-93d8-1923e000ece9.sql`
- `20251231033958_602f5763-ef31-4255-83a6-224090eb1dcb.sql`
- `20251231123835_d773be1b-9c29-42af-ab84-0c6427f8ad97.sql`
- `20251231133440_639d0c0b-3466-4b0c-bdbe-aa7c9b7fe812.sql`
- `20251231171517_8f96eeb0-55df-4334-a90e-af8a26305b3a.sql`
- `20260101032459_a12dfb5a-e3ad-44f1-91b6-e65357ea90dd.sql`
- `20260101034011_ec7ee138-269b-44c8-b362-464d4f297d2c.sql`
- `20260101034612_e7a84c92-c09c-4a2d-b23d-68963f600521.sql`
- `20260101035211_243b8cb1-00a9-44dc-a693-b5f56614ca6a.sql`
- `20260101042155_a33bc949-ac17-4f7e-a258-66692a499fcf.sql`
- `20260101043215_beb7030c-ae7d-409c-b383-8bf49dff8e2f.sql`
- `20260101044739_300533e2-f37e-4cf4-a230-486b767238a6.sql`
- `20260101050718_a459f1bb-6999-46fe-acd8-9f015c5eeabc.sql`
- `20260101052000_df7d0bf9-fbeb-4ffd-b19b-a53335c947ae.sql`
- `20260101064304_fdb05e7c-520c-4a24-b4d3-d3725fe97dff.sql`
- `20260101065544_9b92d7cf-d77d-4e25-9332-cf26993f7f56.sql`
- `20260101102908_52359c2b-a5ef-4af9-bfc5-a8a4b6fa5ea2.sql`
- `20260101161113_2033e9d9-e3e4-483d-8195-c450546f84c2.sql`
- `20260101161348_a39fc22f-b5e7-4071-b44d-b72371c7909a.sql`
- `20260101161643_048a4464-2d11-4e0d-9ab3-b3c8eb91fef1.sql`
- `20260101162011_a0f27fdf-5f1b-42d8-bbf1-3786934d8ba4.sql`
- `20260101192009_8c8294c2-c80d-42ff-8629-fb00020b6343.sql`
- `20260101193225_7c0261ee-e4b1-4ff1-a64f-22c92f77176f.sql`
- `20260102002033_0c4b6fe3-a1af-41d6-b0db-af0546680c30.sql`
- `20260102010136_aa1cd3ad-498f-4f07-b6cd-f4888018db99.sql`
- `20260102014524_6e47ea67-dab1-4cdc-aa10-9ca5b9a5eb82.sql`
- `20260102014929_e26a5de3-e9df-4301-82b6-74f171edfe43.sql`
- `20260102023950_3c8762eb-2d74-4bca-accc-c30d250fd7e1.sql`
- `20260102030011_fdd92145-37aa-4861-8e67-9d5970c74f51.sql`
- `20260102131112_512809c8-6a8d-4d40-ab20-b9d9d5c8a7d7.sql`
- `20260102134614_842e35ad-5277-4435-b9f7-352ad981ab5a.sql`
- `20260102135258_edf0b017-a1d6-414a-8fe6-c892df9f1f05.sql`
- `20260102135830_085f39d1-a744-48ba-b201-d195d8766605.sql`
- `20260102140109_83a4aab7-8d93-4f11-9a16-b4773212cf6f.sql`
- `20260102140453_538a2d7b-632b-4fe5-9507-8407b0481f6b.sql`
- `20260102161355_79f8858e-0824-4381-a1a0-2034c71f560f.sql`
- `20260102163705_d9976048-d2eb-402f-adbe-a9b35bbab86f.sql`
- `20260102165815_4b89115f-e708-480d-9d3e-e57c199377dd.sql`
- `20260102183341_3c705e45-2c85-45be-8279-d8ef75f84df5.sql`
- `20260102191707_1d5ea63e-f8bf-4a32-a0b0-98e538f67113.sql`
- `20260103020558_62cf93a0-fe33-4474-a2ec-39cfe8dd796d.sql`
- `20260103180135_eeefbb8e-0499-4eb0-acf7-57d60c96eb26.sql`
- `20260103181046_12b779c6-7281-4c4f-b208-bc8f7649ed82.sql`
- `20260103182550_41653ad6-7f38-43f4-be13-faa9f20b7e89.sql`
- `20260103183508_a6dc9f49-e8d3-4cfa-b853-4fa8f2989c73.sql`
- `20260103192038_94ccfef8-ea42-4b06-bf0a-a1473e43f0b7.sql`
- `20260105023948_f8ab130b-7bdc-4f5f-8541-d5db76055618.sql`
- `20260105154454_843bba49-2262-4863-bfd7-44ebecf211d1.sql`


---

## FILE: `vibely_machine_inventory.json`

```json
{
  "snapshot": {
    "zip_root": "vibelymeet-pre-native-hardening-golden-2026-03-10",
    "supabase_project_id": "schdyxcunwcvddlcshwd"
  },
  "root_files": [
    ".gitignore",
    "README.md",
    "bun.lockb",
    "components.json",
    "eslint.config.js",
    "index.html",
    "package.json",
    "postcss.config.js",
    "tailwind.config.ts",
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts"
  ],
  "routes": [
    {
      "path": "/",
      "component": "Index"
    },
    {
      "path": "/auth",
      "component": "Auth"
    },
    {
      "path": "/verify-phone",
      "component": "VerifyPhone"
    },
    {
      "path": "/onboarding",
      "component": "Onboarding"
    },
    {
      "path": "/legal/privacy",
      "component": "Privacy"
    },
    {
      "path": "/legal/terms",
      "component": "Terms"
    },
    {
      "path": "/help",
      "component": "Help"
    },
    {
      "path": "/events",
      "component": "Events"
    },
    {
      "path": "/event/:eventId",
      "component": "EventLobby"
    },
    {
      "path": "/matches",
      "component": "Matches"
    },
    {
      "path": "/chat/:matchId",
      "component": "Chat"
    },
    {
      "path": "/video-date/:sessionId",
      "component": "VideoDate"
    },
    {
      "path": "/profile",
      "component": "Profile"
    },
    {
      "path": "/settings",
      "component": "Settings"
    },
    {
      "path": "/schedule",
      "component": "Schedule"
    },
    {
      "path": "/ready/:id",
      "component": "ReadyGate"
    },
    {
      "path": "/vibe-feed",
      "component": "VibeFeed"
    },
    {
      "path": "/vibe-studio",
      "component": "VibeStudio"
    },
    {
      "path": "/premium",
      "component": "Premium"
    },
    {
      "path": "/credits",
      "component": "Credits"
    },
    {
      "path": "/subscription/success",
      "component": "SubscriptionSuccess"
    },
    {
      "path": "/subscription/cancel",
      "component": "SubscriptionCancel"
    },
    {
      "path": "/subscription/complete",
      "component": "SubscriptionComplete"
    },
    {
      "path": "/admin",
      "component": "Admin"
    },
    {
      "path": "/admin/reviews",
      "component": "AdminReviews"
    },
    {
      "path": "/admin/reports",
      "component": "AdminReports"
    },
    {
      "path": "/admin/warnings",
      "component": "AdminWarnings"
    },
    {
      "path": "/admin/suspensions",
      "component": "AdminSuspensions"
    },
    {
      "path": "/admin/activity",
      "component": "AdminActivity"
    },
    {
      "path": "*",
      "component": "NotFound"
    }
  ],
  "unrouted_pages": [
    "VideoLobby.tsx"
  ],
  "hooks": [
    "useAccountDeletion.tsx",
    "useAdminModeration.ts",
    "useAdminRoles.tsx",
    "useAdminVerificationReview.tsx",
    "useBlockStatus.tsx",
    "useConnectionQuality.ts",
    "useCredits.ts",
    "useDailyDrop.ts",
    "useEventDeck.ts",
    "useEventLobby.ts",
    "useEventPresence.ts",
    "useGeolocation.ts",
    "useIsMobile.tsx",
    "useMatches.ts",
    "useMessages.ts",
    "useOnboarding.ts",
    "usePhoneVerification.ts",
    "usePresence.ts",
    "useProfile.ts",
    "usePushNotifications.ts",
    "useReadyGate.ts",
    "useRealtimeMessages.ts",
    "useReconnection.ts",
    "useReportStatus.tsx",
    "useReportUser.ts",
    "useSendMessage.ts",
    "useSubscription.ts",
    "useSwipeAction.ts",
    "useToast.ts",
    "useVibeVideo.ts",
    "useVideoCall.ts",
    "useVideoDateFeedback.ts",
    "useWarnings.tsx"
  ],
  "services": [
    "services/storageService.ts",
    "services/streamChatService.ts",
    "services/videoThumbnailService.ts",
    "services/videoUploadService.ts",
    "utils/dateUtils.ts",
    "utils/notificationHelpers.ts",
    "utils/onesignal.ts",
    "utils/verificationHelpers.ts",
    "lib/utils.ts"
  ],
  "frontend_env_vars": [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_DAILY_DOMAIN",
    "VITE_ONESIGNAL_APP_ID",
    "VITE_SENTRY_DSN",
    "VITE_POSTHOG_KEY",
    "VITE_POSTHOG_HOST",
    "VITE_BUNNY_STREAM_LIBRARY_ID",
    "VITE_BUNNY_STREAM_CDN_HOSTNAME",
    "VITE_BUNNY_PULL_ZONE"
  ],
  "dependencies_of_interest": [
    "@daily-co/daily-js",
    "@sentry/react",
    "@supabase/supabase-js",
    "@tanstack/react-query",
    "face-api.js",
    "framer-motion",
    "hls.js",
    "posthog-js",
    "react-router-dom",
    "tus-js-client",
    "zod"
  ],
  "supabase": {
    "project_id": "schdyxcunwcvddlcshwd",
    "functions": [
      {
        "name": "admin-review-verification",
        "path": "supabase/functions/admin-review-verification/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "cancel-deletion",
        "path": "supabase/functions/cancel-deletion/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "check-new-messages",
        "path": "supabase/functions/check-new-messages/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "create-checkout-session",
        "path": "supabase/functions/create-checkout-session/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "STRIPE_SECRET_KEY",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "create-video-upload",
        "path": "supabase/functions/create-video-upload/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "BUNNY_API_KEY",
          "BUNNY_LIBRARY_ID",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "daily-drop-action",
        "path": "supabase/functions/daily-drop-action/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "daily-room",
        "path": "supabase/functions/daily-room/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "DAILY_API_KEY",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "delete-account-now",
        "path": "supabase/functions/delete-account-now/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "delete-user-and-data",
        "path": "supabase/functions/delete-user-and-data/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "extend-video-date",
        "path": "supabase/functions/extend-video-date/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "forward-geocode",
        "path": "supabase/functions/forward-geocode/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "OPENCAGE_API_KEY"
        ]
      },
      {
        "name": "generate-daily-drop",
        "path": "supabase/functions/generate-daily-drop/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "get-daily-upload-auth",
        "path": "supabase/functions/get-daily-upload-auth/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "BUNNY_STREAM_API_KEY",
          "BUNNY_STREAM_LIBRARY_ID"
        ]
      },
      {
        "name": "get-event-chat-token",
        "path": "supabase/functions/get-event-chat-token/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "GETSTREAM_API_KEY",
          "GETSTREAM_SECRET",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "get-videos",
        "path": "supabase/functions/get-videos/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "BUNNY_LIBRARY_ID",
          "BUNNY_STREAM_API_KEY"
        ]
      },
      {
        "name": "geocode-location",
        "path": "supabase/functions/geocode-location/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "mark-notifications-read",
        "path": "supabase/functions/mark-notifications-read/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "push-webhook",
        "path": "supabase/functions/push-webhook/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "report-user",
        "path": "supabase/functions/report-user/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "request-account-deletion",
        "path": "supabase/functions/request-account-deletion/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "send-notification",
        "path": "supabase/functions/send-notification/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "ONESIGNAL_API_KEY",
          "ONESIGNAL_APP_ID",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "send-phone-verification",
        "path": "supabase/functions/send-phone-verification/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "TWILIO_ACCOUNT_SID",
          "TWILIO_AUTH_TOKEN",
          "TWILIO_VERIFY_SERVICE_SID",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "send-video-date-notification",
        "path": "supabase/functions/send-video-date-notification/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "ONESIGNAL_API_KEY",
          "ONESIGNAL_APP_ID",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "stripe-webhook",
        "path": "supabase/functions/stripe-webhook/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "submit-verification",
        "path": "supabase/functions/submit-verification/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "upload-image",
        "path": "supabase/functions/upload-image/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "BUNNY_API_KEY",
          "BUNNY_PULL_ZONE",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "video-webhook",
        "path": "supabase/functions/video-webhook/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "BUNNY_WEBHOOK_SECRET",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      },
      {
        "name": "verify-phone-code",
        "path": "supabase/functions/verify-phone-code/index.ts",
        "verify_jwt": false,
        "env_vars": [
          "TWILIO_ACCOUNT_SID",
          "TWILIO_AUTH_TOKEN",
          "TWILIO_VERIFY_SERVICE_SID",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY"
        ]
      }
    ],
    "migration_count": 101,
    "schema_reference_files": [
      "src/integrations/supabase/types.ts",
      "supabase/migrations/*.sql"
    ]
  }
}
```

