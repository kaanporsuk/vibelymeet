# VIBELY — AUDITED GOLDEN STATE TECHNICAL SNAPSHOT

**Audit date:** 2026-03-11  
**Audit basis:** frozen ZIP `vibelymeet-pre-native-hardening-golden-2026-03-10.zip` + post-hardening repo state  
**Supabase project ID:** `schdyxcunwcvddlcshwd` (from `supabase/config.toml`)  
**Intent:** rebuild-oriented source-of-truth for the web codebase after auth-hardening; reflects current function auth posture and live storage reality.

> **2026-04-11 — Current-repo alignment (live `src/App.tsx`):** **`/ready/:readyId`** mounts **`ReadyRedirect`** (`src/pages/ReadyRedirect.tsx`): it resolves the id against `video_sessions` (or treats it as an event id) and **navigates to the event lobby** — not a standalone full-page ready gate. Legacy **`src/pages/ReadyGate.tsx` was removed**; in-lobby UX is **`ReadyGateOverlay`**. **`src/pages/VideoLobby.tsx` was removed** (unrouted dead surface). Authoritative record: `docs/repo-hardening-closure-2026-04-11.md`. Rows in §4 mix **2026-03-11 audit** baseline with **superseded** entries — **verify routes against `src/App.tsx`** when implementing.

---

## 1. What this snapshot is

This document is based on the frozen repository archive itself, not just prose notes. It is meant to be used as a rebuild reference. Where a statement is verified directly from code, that takes precedence over prior narrative documentation.

This audited snapshot intentionally excludes secret values. It records required variable names, hardcoded integration touchpoints, and structural dependencies.

## 2. Repository baseline

- Frontend: Vite + React + TypeScript application under `src/`
- Public assets: `public/`
- Backend integration: Supabase project with config, migrations, generated types, and Edge Functions
- Package manager artifacts present: `package-lock.json`, `bun.lock`, `bun.lockb`
- Root README is Lovable-generic and is **not** a sufficient rebuild guide

### Inventory counts

- `src/pages`: **34** files
- `src/components`: **259** files
- `src/hooks`: **53** files
- `src/services`: **6** files
- `supabase/functions`: **28** deployable function directories (+ `_shared`)
- `supabase/migrations`: **101** SQL migrations

### Migration range

- First migration in archive: `20251218002545_d8e57774-e32c-4b62-ba72-476b014bc930.sql`
- Last migration in archive: `20260310124838_45630bae-e49a-4d34-a108-326f06e5ed18.sql`

## 3. Verified stack

| Layer | Verified technology | Notes |
|---|---|---|
| Frontend framework | React 18.3.1 | from `package.json` |
| Build tool | Vite 5.4.19 | from `package.json` |
| Language | TypeScript 5.8.3 | from `package.json` |
| Styling | Tailwind CSS 3.4.17 + shadcn/ui + Radix | from deps and component structure |
| Routing | react-router-dom 7.12.0 | `src/App.tsx` |
| Data/cache | @tanstack/react-query 5.83.0 | `QueryClientProvider` in `src/App.tsx` |
| Backend platform | Supabase | client, generated types, functions, migrations present |
| Live video | Daily.co | `@daily-co/daily-js` + `daily-room` function |
| Vibe video / VOD | Bunny Stream | HLS playback + upload flow + webhook |
| Image/media delivery | Bunny CDN / Bunny Storage | upload functions + CDN hostname use |
| Payments | Stripe | checkout + portal + webhooks |
| Email | Resend | email functions |
| Phone verification | Twilio Verify / Lookup | `phone-verify` function |
| Push | OneSignal + browser notifications | OneSignal lib + notification functions |
| Analytics | PostHog | initialized in `src/main.tsx` |
| Error tracking | Sentry | initialized in `src/main.tsx` |
| Geocoding | OpenStreetMap Nominatim | `geocode` and `forward-geocode` functions |

## 4. Route map verified from `src/App.tsx`

### Public routes
- `/` → `Index` — Landing page
- `/auth` → `Auth` — Sign in / sign up
- `/reset-password` → `ResetPassword` — Password reset
- `/how-it-works` → `HowItWorks` — Marketing explainer
- `/privacy` → `PrivacyPolicy` — Legal
- `/terms` → `TermsOfService` — Legal
- `/delete-account` → `DeleteAccountWeb` — Web account deletion path
- `/premium` → `Premium` — Premium marketing / upgrade page
- `/subscription/success` → `SubscriptionSuccess` — Stripe success landing
- `/subscription/cancel` → `SubscriptionCancel` — Stripe cancel landing

### Protected routes
- `/onboarding` → `Onboarding` — Profile setup flow
- `/dashboard` → `Dashboard` — Primary signed-in home
- `/home` → `Dashboard` — Alias of /dashboard
- `/events` → `Events` — Event discovery
- `/events/:id` → `EventDetails` — Event detail
- `/event/:eventId/lobby` → `EventLobby` — Live event swipe deck / core loop
- `/matches` → `Matches` — Matches / drops / archived
- `/chat/:id` → `Chat` — 1:1 chat
- `/profile` → `Profile` — Profile edit and vibe video
- `/settings` → `Settings` — Account / privacy / notifications
- `/date/:id` → `VideoDate` — Live video date
- `/ready/:readyId` → `ReadyRedirect` — Deep-link helper: resolves session/event, then **redirects** to `/event/:eventId/lobby` (not a standalone full-page gate; see banner above)
- `/admin/create-event` → `AdminCreateEvent` — Admin-only create event
- `/match-celebration` → `MatchCelebration` — Celebration screen
- `/vibe-studio` → `VibeStudio` — Dedicated vibe-video studio surface
- **(Historical — not in current `src/App.tsx`)** `/vibe-feed` / `VibeFeed` — described in older audits; **no `VibeFeed` page or route** in the current tree — treat as superseded unless reintroduced.
- `/schedule` → `Schedule` — Availability + planning hub
- `/credits` → `Credits` — Credits purchase
- `/credits/success` → `CreditsSuccess` — Credits checkout success
- `/event-payment/success` → `EventPaymentSuccess` — Event checkout success
- `/user/:userId` → `UserProfile` — Public profile view

### Admin routes
- `/kaan` → `AdminLogin` — Admin login
- `/kaan/dashboard` → `AdminDashboard` — Admin dashboard

### Route anomalies / corrections

- **Removed 2026-04-11:** `src/pages/VideoLobby.tsx` (unrouted dead surface; not present in repo — see `docs/repo-hardening-closure-2026-04-11.md`).
- **Removed 2026-04-11:** standalone `src/pages/ReadyGate.tsx`; **`/ready/:readyId`** uses `ReadyRedirect` only (see banner above).
- `src/pages/VibeStudio.tsx` is a standalone studio management surface that still reuses `VibeStudioModal` for recording/upload authoring.
- **(Historical)** `VibeFeed` / mock feed narratives — **no `VibeFeed.tsx` in current `src/pages/`**; ignore unless the route is added back to `App.tsx`.
- Admin path `/kaan` is a hardcoded route, not feature-flagged.

## 5. App wrappers and global runtime surfaces

Verified in `src/App.tsx`:

- `QueryClientProvider`
- `AuthProvider`
- `NotificationProvider`
- `TooltipProvider`
- `Sentry.ErrorBoundary`
- `OfflineBanner`
- `NotificationContainer`
- `NotificationManager`
- `PushPermissionPrompt`
- `PostHogPageTracker`
- `useActivityHeartbeat` via `AppContent`

## 6. Supabase function inventory

- `admin-review-verification`
- `cancel-deletion`
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `create-video-upload`
- `daily-room`
- `delete-account`
- `delete-vibe-video`
- `email-drip`
- `email-verification`
- `event-notifications`
- `forward-geocode`
- `generate-daily-drops`
- `geocode`
- `phone-verify`
- `push-webhook`
- `request-account-deletion`
- `send-notification`
- `stripe-webhook`
- `unsubscribe`
- `upload-event-cover`
- `upload-image`
- `upload-voice`
- `verify-admin`
- `vibe-notification`
- `video-webhook`

### Function config audit (`supabase/config.toml`) — post-hardening

- All 28 functions are explicitly configured in `config.toml`. No config gaps.
- **JWT-at-gateway (`verify_jwt = true`):** phone-verify, forward-geocode, daily-room, verify-admin, admin-review-verification, create-checkout-session, create-portal-session, create-event-checkout, create-credits-checkout, delete-account, event-notifications, email-verification, vibe-notification, geocode, create-video-upload, delete-vibe-video, upload-image, upload-voice, upload-event-cover, cancel-deletion, send-notification.
- **Public-but-protected (`verify_jwt = false`):** stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, request-account-deletion, generate-daily-drops.
- Required hardening secrets: `PUSH_WEBHOOK_SECRET`, `UNSUB_HMAC_SECRET`, `CRON_SECRET`, `BUNNY_VIDEO_WEBHOOK_TOKEN`.

### Live Supabase storage buckets

Only **two** Supabase storage buckets are live and in use: `chat-videos`, `proof-selfies`. Other bucket names (e.g. `profile-photos`, `vibe-videos`, `event-covers`, `voice-messages`) are legacy or migrated to Bunny; treat them as such for rebuild and migration.

**Clarification (chat video):** new inline / Vibe Clip video **uploads** use the `upload-chat-video` Edge Function and **Bunny Storage** (see `vibely_bunny_provider_sheet.md` §4). A Supabase bucket named `chat-videos` must not be conflated with that Bunny object path prefix or the `messages.video_url` contract.

## 7. Database inventory from generated Supabase types

### Public tables
- `account_deletion_requests`
- `admin_activity_logs`
- `admin_notifications`
- `age_gate_blocks`
- `blocked_users`
- `credit_adjustments`
- `daily_drop_cooldowns`
- `daily_drops`
- `date_feedback`
- `date_proposals`
- `email_drip_log`
- `email_verifications`
- `event_registrations`
- `event_swipes`
- `event_vibes`
- `events`
- `feedback`
- `match_calls`
- `match_mutes`
- `match_notification_mutes`
- `matches`
- `messages`
- `notification_log`
- `notification_preferences`
- `photo_verifications`
- `premium_history`
- `profile_vibes`
- `profiles`
- `push_campaigns`
- `push_notification_events`
- `push_notification_events_admin`
- `rate_limits`
- `subscriptions`
- `user_credits`
- `user_reports`
- `user_roles`
- `user_schedules`
- `user_suspensions`
- `user_warnings`
- `verification_attempts`
- `vibe_tags`
- `video_sessions`

### RPC / PostgreSQL function surfaces exposed in generated types
- `can_view_profile_photo`
- `check_gender_compatibility`
- `check_mutual_vibe_and_match`
- `deduct_credit`
- `drain_match_queue`
- `find_mystery_match`
- `find_video_date_match`
- `generate_recurring_events`
- `get_event_deck`
- `get_other_city_events`
- `get_own_pii`
- `get_user_subscription_status`
- `get_visible_events`
- `handle_swipe`
- `has_role`
- `haversine_distance`
- `is_blocked`
- `is_registered_for_event`
- `join_matching_queue`
- `leave_matching_queue`
- `update_participant_status`

## 8. Environment-variable inventory

### Frontend Vite variables actually referenced in source
- `VITE_BUNNY_CDN_HOSTNAME`
- `VITE_BUNNY_STREAM_CDN_HOSTNAME`
- `VITE_POSTHOG_API_KEY`
- `VITE_POSTHOG_HOST`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SENTRY_DSN`
- `VITE_ONESIGNAL_APP_ID`

### Backend / Edge Function environment variables referenced via `Deno.env.get(...)`
- `APP_URL`
- `BUNNY_CDN_HOSTNAME`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_STREAM_LIBRARY_ID`
- `CRON_SECRET`
- `DAILY_API_KEY`
- `DAILY_DOMAIN`
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`
- `PUSH_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `STRIPE_ANNUAL_PRICE_ID`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `UNSUB_HMAC_SECRET`
- `BUNNY_VIDEO_WEBHOOK_TOKEN`

### Important correction on env reality

- The root `.env` file is **not an authoritative full environment manifest** for the system.
- It contains Vite-style variables, but also contains malformed/non-Vite syntax lines (for example colon-separated and spaced assignments).
- Several critical backend variables are only inferable from Edge Function source, not from the root `.env`.
- Therefore rebuild should use a dedicated env manifest, not the checked-in `.env` alone.

## 9. Hardcoded integration touchpoints that matter for rebuild

- OneSignal App ID now reads from `VITE_ONESIGNAL_APP_ID` with a fallback to the historical hardcoded value in `src/lib/onesignal.ts`.
- Sentry DSN now reads from `VITE_SENTRY_DSN` with a fallback to the historical hardcoded value in `src/main.tsx`.
- PostHog host now reads from `VITE_POSTHOG_HOST` with a fallback to `https://eu.i.posthog.com` in `src/main.tsx`; the API key remains env-driven via `VITE_POSTHOG_API_KEY`.
- Daily fallback domain defaults to `vibelyapp.daily.co` in the `daily-room` function if env is absent.
- Several frontend and function files hardcode the production domain `vibelymeet.com` for links, referrals, notifications, unsubscribe flows, and email templates.
- Bunny video upload endpoint is hardcoded to `video.bunnycdn.com/tusupload` in the vibe studio modal.

## 10. Media architecture verified from code

- Profile/vibe videos: Bunny Stream HLS playback using `VITE_BUNNY_STREAM_CDN_HOSTNAME`.
- Video upload flow: frontend calls Supabase Edge Function `create-video-upload`; Bunny upload is performed client-side against Bunny TUS endpoint; webhook surfaces exist for processing completion.
- Video deletion flow: frontend calls `delete-vibe-video` function.
- Images / event covers / voice uploads: handled through separate upload functions (`upload-image`, `upload-event-cover`, `upload-voice`).
- Image URL resolution is mixed: code can resolve Bunny CDN URLs and Supabase-based paths, which implies historical storage evolution rather than a single clean medium.

## 11. Notification architecture verified from source

- In-app notification state: `NotificationContext` + `NotificationContainer` + `NotificationManager`.
- Web push: OneSignal integration via `src/lib/onesignal.ts` and `send-notification` function.
- Browser-level prompts: `PushPermissionPrompt`.
- Event and re-engagement email surfaces: `event-notifications`, `email-drip`, `email-verification`, `unsubscribe`.
- `push-webhook` is in config with `verify_jwt = false` and requires `PUSH_WEBHOOK_SECRET` (x-webhook-secret header); fail-closed if missing.

## 12. Payment / premium / credits surfaces

Verified Stripe-facing function set:

- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `stripe-webhook`
- `delete-account` also contains Stripe subscription cleanup logic

Frontend routes tied to payments:

- `/premium`
- `/subscription/success`
- `/subscription/cancel`
- `/credits`
- `/credits/success`
- `/event-payment/success`

## 13. Build/rebuild-critical corrections vs the earlier narrative snapshot

These are the highest-value corrections verified directly from the frozen repo:

- `forward-geocode` and `push-webhook` are both in config.toml (post-hardening); forward-geocode is JWT + admin + rate limit, push-webhook is secret-protected.
- **`VideoLobby.tsx` was removed 2026-04-11** after hardening (documented removal — no silent delete). **`ReadyGate.tsx`** (full page) same; **`ReadyRedirect`** is the `/ready/:readyId` implementation.
- The production domain is not merely “custom domain TBD”; `vibelymeet.com` is already hard-referenced across multiple runtime surfaces.
- The checked-in `.env` is incomplete and partially malformed; source inspection is required to derive the true env set.
- OneSignal and Sentry each have hardcoded runtime config points outside a clean env-only model.
- **(Historical)** Older audits referenced a `VibeFeed` mock feed; **no `VibeFeed` route/page** in current `src/` — do not assume that surface exists unless it returns in `App.tsx`.

## 14. Rebuild notes

For a faithful rebuild of this exact baseline, all of the following must be preserved or consciously replaced with mapped equivalents:

- Route structure, including admin and legal paths
- Supabase project linkage and all 101 migrations in order
- All 28 Edge Functions
- JWT verification intent for functions (all 28 in config.toml; 21 JWT-at-gateway, 7 public-but-protected with secrets/tokens)
- Bunny Stream and Bunny Storage integration surfaces
- Daily room creation flow and Daily domain configuration
- Stripe checkout, portal, and webhook wiring
- Resend email templates/flows
- Twilio verification flow
- OneSignal push identity + webhook surface
- Hardcoded production-domain references
- Hardcoded Sentry DSN / OneSignal app ID unless intentionally refactored

## 15. Audit confidence and limits

- High confidence on repo structure, routes, functions, env names, generated database surfaces, and hardcoded integration points.
- Medium confidence on end-to-end business semantics for every page and hook unless separately exercised at runtime.
- This document is structural truth for rebuild; runtime correctness still needs separate validation.

