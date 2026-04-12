# VIBELY — EDGE FUNCTION MANIFEST

**Date:** 2026-03-11  
**Baseline:** post-hardening (frozen golden: `vibelymeet-pre-native-hardening-golden-2026-03-10.zip`)  
**Primary sources:**
- `supabase/functions/*`
- `supabase/config.toml`
- frontend call sites under `src/`

---

## 1. Purpose

This document is the operational manifest for the Supabase Edge Function layer after the auth-hardening campaign. It reflects the current post-hardening state.

It answers:
- which deployable functions exist
- which ones are listed in `supabase/config.toml`
- their intended auth posture
- the env vars each function depends on
- the main tables/services each one touches
- where the frontend invokes them, if applicable

This is a rebuild and hardening artifact, not a substitute for reading function code.

### Current-state addendum (2026-04-12)

This manifest started as a frozen/post-hardening baseline artifact. The current repo has moved ahead:

- Current repo inventory: **44 deployable Edge Functions** plus `_shared`.
- `supabase/config.toml` now explicitly configures all 44 deployable functions.
- Sprint 1 adds `process-media-delete-jobs` with `verify_jwt = false` and manual `CRON_SECRET` bearer auth in code.
- Current repo-only additions beyond the original baseline list include:
  - `admin-proof-selfie-sign`
  - `date-suggestion-actions`
  - `date-suggestion-expiry`
  - `event-reminders`
  - `health`
  - `post-date-verdict`
  - `process-media-delete-jobs`
  - `send-email`
  - `send-game-event`
  - `send-support-reply`
  - `sync-revenuecat-subscriber`
  - `upload-chat-video`
- Some functions documented in the original frozen baseline are no longer current repo directories, including `account-pause`, `account-resume`, `email-drip`, `unsubscribe`, and `vibe-notification`.

---

## 2. Inventory summary

> Current repo addendum (2026-04-12): the repo now has **44 deployable Edge Functions** plus `_shared`. Sprint 2 does **not** add a new Edge Function; it changes `create-video-upload`, `delete-vibe-video`, and `upload-image` so vibe videos and profile photos dual-write into media lifecycle tables while preserving legacy profile columns as compatibility mirrors.

### Deployable directories (historical baseline)

There are **34 deployable Edge Functions** plus one shared helper directory:

- deployable functions: **34**
- shared helper directory: `_shared`

### Config coverage (historical baseline)

`supabase/config.toml` explicitly configures **all 34** functions. No config gaps remain.

For exact current repo inventory, use the 2026-04-12 addendum above plus `_cursor_context/vibely_machine_readable_inventory.json`.

### Gateway JWT posture from config (post-hardening)

**JWT-at-gateway (`verify_jwt = true`):**  
account-pause, account-resume, phone-verify, forward-geocode, daily-room, verify-admin, admin-review-verification, create-checkout-session, create-portal-session, create-event-checkout, create-credits-checkout, delete-account, event-notifications, email-verification, vibe-notification, geocode, create-video-upload, delete-vibe-video, upload-image, upload-voice, upload-event-cover, cancel-deletion, send-notification, daily-drop-actions, send-message, swipe-actions.

**Public-but-protected (`verify_jwt = false`):**  
stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, request-account-deletion, generate-daily-drops, process-waitlist-promotion-notify-queue (Bearer `CRON_SECRET`), plus additional entries in `supabase/config.toml` (e.g. credit-replenish, date-reminder-cron).

---

## 3. Critical auth caveat

For this codebase, **Supabase gateway JWT verification** and **application-level authentication inside the function** are not the same thing.

In practice:
- many functions are deployed with `verify_jwt = false`
- but still require an `Authorization: Bearer ...` header inside the code
- then create a user-scoped Supabase client from that bearer token

So the correct interpretation is:
- `verify_jwt = false` often means **publicly reachable endpoint with manual auth logic**, not “anonymous business action allowed”
- rebuild operators must preserve both layers of behavior

---

## 4. Auth posture classes used in this manifest

### Class A — Public endpoint with manual bearer-token auth in code
The function is callable at the gateway without JWT enforcement, but the code still expects a bearer token and resolves the user manually.

### Class B — Public endpoint intentionally callable without user auth
The function is meant for webhooks, geocoding, cron-style jobs, or public/legal flows.

### Class C — Gateway-enforced JWT
The function is configured with `verify_jwt = true` and also handles authenticated behavior in code.

### Class D — Config gap / operator must decide explicitly
The function exists in source but is not represented in `supabase/config.toml`.

---

## 5. Deployable function catalog

## A. Admin / moderation / trust

### `admin-review-verification`
- **Purpose:** approve or reject photo-verification submissions and update profile verification state
- **Auth posture:** Class C — `verify_jwt = true`; code confirms admin role in `user_roles`
- **Frontend call sites:** `src/components/admin/AdminPhotoVerificationPanel.tsx`
- **Primary tables touched:** `photo_verifications`, `profiles`, `user_roles`, `admin_activity_logs`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** admin-only; logs moderation actions to `admin_activity_logs`

### `verify-admin`
- **Purpose:** checks whether the current user has admin rights
- **Auth posture:** Class C — `verify_jwt = true`; code checks `user_roles`
- **Frontend call sites:** `src/components/ProtectedRoute.tsx`
- **Primary tables touched:** `user_roles`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** critical for admin route protection; keep role semantics aligned with `app_role` / `user_roles`

---

## B. Account lifecycle / deletion / legal

### `request-account-deletion`
- **Purpose:** receives deletion requests from the public delete-account flow and creates a pending request if the email maps to a real user
- **Auth posture:** Class B — intentionally callable without logged-in user auth
- **Frontend call sites:** `src/pages/legal/DeleteAccountWeb.tsx`
- **Primary tables touched:** `account_deletion_requests`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** returns generic success even for invalid/nonexistent emails to avoid account enumeration; does not immediately suspend the account

### `cancel-deletion`
- **Purpose:** cancels a pending account-deletion request for the authenticated user
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/hooks/useDeletionRecovery.ts`
- **Primary tables touched:** `account_deletion_requests`, `profiles`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** relies on pending-request semantics in `account_deletion_requests`; only clears legacy deletion-induced `profiles.is_suspended` holds and must not lift genuine moderation suspensions

### `account-pause` (Stream 1B)
- **Purpose:** set profile to paused state (backend-authoritative); updates `profiles.is_paused`, `paused_at`, `paused_until`, `pause_reason`
- **Auth posture:** Class C — `verify_jwt = true`; JWT required, updates only the authenticated user's profile
- **Frontend call sites:** `src/contexts/AuthContext.tsx` (via `pauseAccount` → `supabase.functions.invoke('account-pause', { body: { duration } })`)
- **Primary tables touched:** `profiles`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** body.duration: `'day'` | `'week'` | `'indefinite'`; paused profiles are excluded from event deck, daily drops, and notification dispatch

### `account-resume` (Stream 1B)
- **Purpose:** clear profile pause state (backend-authoritative)
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/contexts/AuthContext.tsx` (via `resumeAccount` → `supabase.functions.invoke('account-resume', { body: {} })`)
- **Primary tables touched:** `profiles`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** sets `is_paused = false`, `paused_at`/`paused_until`/`pause_reason` = null

### `delete-account`
- **Purpose:** authenticated deletion-request wrapper; schedules the same pending deletion hold, signs the user out, and performs Stripe-linked cleanup
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/hooks/useDeleteAccount.ts`
- **Primary tables touched:** `account_deletion_requests`, `profiles`, `subscriptions`
- **External services:** Stripe
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`
- **Rebuild notes:** uses shared rate-limiter helper; must stay aligned with `request-account-deletion` semantics and should not mark deletion-hold users as moderation-suspended

---

## C. Payments / premium / credits

### `create-checkout-session`
- **Purpose:** creates Stripe Checkout sessions for premium subscriptions
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/hooks/useSubscription.ts`
- **Primary tables touched:** `subscriptions`
- **External services:** Stripe
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID`
- **Rebuild notes:** one of the most deployment-sensitive functions because bad price IDs silently misroute monetization

### `create-credits-checkout`
- **Purpose:** creates Stripe Checkout sessions for one-off credit packs
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/pages/Credits.tsx`
- **Primary tables touched:** `subscriptions`
- **External services:** Stripe
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`
- **Rebuild notes:** credit packs are defined in function code; if commercial packaging changes, this function must be updated, not just dashboard settings

### `create-event-checkout`
- **Purpose:** creates Stripe Checkout sessions for paid event registration
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/components/events/PaymentModal.tsx`
- **Primary tables touched:** `events`, `event_registrations`, `subscriptions`
- **External services:** Stripe
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`
- **Rebuild notes:** ties event payment completion back into registration state; validate against `event-payment/success` route

### `create-portal-session`
- **Purpose:** creates Stripe customer-portal sessions
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/components/premium/PremiumSettingsCard.tsx`
- **Primary tables touched:** `subscriptions`
- **External services:** Stripe
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`
- **Rebuild notes:** depends on stable Stripe customer IDs in `subscriptions`

### `stripe-webhook`
- **Purpose:** processes Stripe webhook events and updates subscription / registration / credit state
- **Auth posture:** Class B — public webhook endpoint; verifies incoming Stripe signature itself
- **Frontend call sites:** none; provider webhook target
- **Primary tables touched:** `subscriptions`, `profiles`, `event_registrations`, `user_credits`, `stripe_event_ticket_settlements` (event-ticket checkout path)
- **External services:** Stripe
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ANNUAL_PRICE_ID`
- **Rebuild notes:** webhook endpoint registration outside the repo must match the deployed function URL; signature secret must align exactly. **Event tickets** (`metadata.type = event_ticket`): completion is applied via RPC **`settle_event_ticket_checkout`** (canonical capacity + paid waitlist + idempotency), not via a direct client/table upsert from this function.

---

## D. Media / uploads / video

### `create-video-upload`
- **Purpose:** creates Bunny Stream upload metadata / authorization for user vibe-video uploads
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/components/vibe-video/VibeStudioModal.tsx`
- **Primary tables touched:** `profiles`, `media_assets`, `media_references`, `profile_vibe_videos`, `draft_media_sessions`
- **External services:** Bunny Stream
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`
- **Rebuild notes:** frontend still uploads directly to Bunny’s TUS endpoint; Sprint 2 now activates the current/primary vibe video in lifecycle tables immediately and keeps `profiles.bunny_video_uid` / `bunny_video_status` as the published compatibility mirror.

### `video-webhook`
- **Purpose:** receives Bunny video-status callbacks and updates profile video readiness state
- **Auth posture:** Class B — public webhook; protected by URL token. Requires `BUNNY_VIDEO_WEBHOOK_TOKEN` (query param); fail-closed if secret missing.
- **Frontend call sites:** none; provider webhook target
- **Primary tables touched:** `draft_media_sessions`, `profiles`, `profile_vibe_videos`
- **External services:** Bunny Stream
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BUNNY_VIDEO_WEBHOOK_TOKEN`
- **Rebuild notes:** Bunny dashboard must send callback URL with `?token=<BUNNY_VIDEO_WEBHOOK_TOKEN>`; Sprint 2 keeps `profiles.bunny_video_status` current for old consumers while also updating `profile_vibe_videos.video_status`.

### `delete-vibe-video`
- **Purpose:** clears the current user’s active vibe-video reference and published profile metadata
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/pages/Profile.tsx`
- **Primary tables touched:** `profiles`, `media_references`, `media_assets`, `profile_vibe_videos`, `draft_media_sessions`
- **External services:** none directly in Sprint 2; physical Bunny deletion is deferred to `process-media-delete-jobs`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** Sprint 2 no longer hard-deletes the provider asset inline. The function clears the compatibility mirror immediately, releases the active reference, and lets retention + worker processing handle physical deletion later.

### `upload-image`
- **Purpose:** uploads user images to Bunny Storage
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/services/imageUploadService.ts`
- **Primary tables touched:** `draft_media_sessions`, `media_assets` (only when explicit `context` is `onboarding` or `profile_studio`)
- **External services:** Bunny Storage
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY`
- **Rebuild notes:** Sprint 2 keeps chat-image uploads out of profile-photo lifecycle by requiring an explicit profile context before draft-session/media-asset registration is attempted.

### `upload-event-cover`
- **Purpose:** uploads event cover assets for admins and returns CDN-backed URLs
- **Auth posture:** Class C — `verify_jwt = true`; code checks admin role
- **Frontend call sites:** `src/services/eventCoverUploadService.ts`
- **Primary tables touched:** `user_roles`
- **External services:** Bunny Storage / Bunny CDN
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY`, `BUNNY_CDN_HOSTNAME`
- **Rebuild notes:** admin-only upload path; CDN hostname must match actual production delivery path

### `upload-voice`
- **Purpose:** uploads voice-message media and returns CDN-backed paths for chat usage
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/services/voiceUploadService.ts`
- **Primary tables touched:** none directly in the function body
- **External services:** Bunny Storage / Bunny CDN
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY`, `BUNNY_CDN_HOSTNAME`
- **Rebuild notes:** chat audio behavior depends on this function plus storage bucket / message schema alignment

---

## E. Events / matching / live sessions

### `daily-room`
- **Purpose:** creates or resumes Daily rooms and meeting tokens for event/video-date call flows
- **Auth posture:** Class C — `verify_jwt = true`. Frontend unload cleanup uses `fetch(..., { keepalive: true })` with `Authorization: Bearer <session access_token>` (no sendBeacon).
- **Frontend call sites:** `src/hooks/useMatchCall.ts`, `src/hooks/useVideoCall.ts`, `src/pages/VideoDate.tsx`
- **Primary tables touched:** `video_sessions`, `matches`, `match_calls`
- **External services:** Daily.co
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DAILY_API_KEY`, `DAILY_DOMAIN`
- **Rebuild notes:** defaults `DAILY_DOMAIN` to `vibelyapp.daily.co` if missing; VideoDate beforeunload cleanup must send JWT via fetch keepalive

### `vibe-notification`
- **Purpose:** records and dispatches vibe-related notification events between users in event contexts
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/hooks/useEventVibes.ts`
- **Primary tables touched:** `events`, `profiles`, `push_notification_events`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** uses shared rate limiting; this function is part of the social signal layer, not just passive notification logging

### `generate-daily-drops`
- **Purpose:** expires stale daily drops, applies cooldowns, scores eligible pairs, and inserts the next set of drops
- **Auth posture:** Class B — `verify_jwt = false`. Dual auth: `Authorization: Bearer <CRON_SECRET>` OR valid admin JWT. Fail-closed if CRON_SECRET missing and no valid admin.
- **Frontend call sites:** `src/components/admin/AdminDailyDropCard.tsx`
- **Primary tables touched:** `daily_drops`, `daily_drop_cooldowns`, `matches`, `blocked_users`, `profiles`, `profile_vibes`, `vibe_tags`
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
- **Rebuild notes:** cron uses Bearer CRON_SECRET; admin UI uses logged-in admin JWT. Do not expose CRON_SECRET to frontend.

---

## F. Email / verification / contact flows

### `email-verification`
- **Purpose:** supports both email OTP send and verify flows
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:**
  - `src/hooks/useEmailVerification.ts` invoking `/email-verification/send`
  - `src/hooks/useEmailVerification.ts` invoking `/email-verification/verify`
- **Primary tables touched:** `email_verifications`, `profiles`, `verification_attempts`
- **External services:** Resend
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`
- **Rebuild notes:** route suffixes matter; this is one function serving multiple logical actions based on the trailing path segment

### `event-notifications`
- **Purpose:** sends event-related emails such as launches/capacity-driven updates to registered users
- **Auth posture:** Class C — `verify_jwt = true`; code checks admin role
- **Frontend call sites:** `src/components/admin/AdminEventFormModal.tsx`
- **Primary tables touched:** `events`, `event_registrations`, `profiles`, `user_roles`
- **External services:** Resend
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`
- **Rebuild notes:** embeds production-domain URLs in outbound email content; domain drift will break links even if email sends succeed

### `email-drip`
- **Purpose:** scheduled/re-engagement email sender with send-log tracking
- **Auth posture:** Class B — `verify_jwt = false`; guarded by `Authorization: Bearer <CRON_SECRET>`. Unsubscribe URL generation requires `UNSUB_HMAC_SECRET` only (no fallback).
- **Frontend call sites:** none directly from normal user UI
- **Primary tables touched:** `profiles`, `event_registrations`, `email_drip_log`
- **External services:** Resend
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `UNSUB_HMAC_SECRET`
- **Rebuild notes:** operationally behaves like a cron target; external scheduler configuration is not stored in the repo

### `unsubscribe`
- **Purpose:** processes unsubscribe links and updates profile email opt-out state
- **Auth posture:** Class B — `verify_jwt = false`; HMAC token only via `UNSUB_HMAC_SECRET` (no fallback); rate-limited
- **Frontend call sites:** none directly; linked from email templates
- **Primary tables touched:** `profiles`
- **External services:** none beyond email-origin links
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UNSUB_HMAC_SECRET`
- **Rebuild notes:** unsubscribe URLs are part of the email ecosystem and include hardcoded production-domain assumptions elsewhere in the stack

---

## G. Geocoding / location

### `geocode`
- **Purpose:** reverse-geocodes lat/lng coordinates into human-readable place data for authenticated app flows
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/pages/Events.tsx`, `src/services/profileService.ts`
- **Primary tables touched:** none directly
- **External services:** OpenStreetMap Nominatim (reverse geocoding)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- **Rebuild notes:** preserve provider usage policy and user-agent behavior if refactored

### `forward-geocode`
- **Purpose:** forward-geocodes place queries for event creation/admin location search
- **Auth posture:** Class C — `verify_jwt = true`; JWT + admin role check + rate limiting
- **Frontend call sites:** `src/components/admin/AdminEventFormModal.tsx`
- **Primary tables touched:** none
- **External services:** OpenStreetMap Nominatim (search endpoint)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** admin-only; uses shared rate-limiter; listed in config.toml

---

## H. Phone / SMS verification

### `phone-verify`
- **Purpose:** sends phone verification OTPs and verifies submitted OTP codes
- **Auth posture:** Class C — `verify_jwt = true` in config and also expects authenticated user context in code
- **Frontend call sites:** `src/components/PhoneVerification.tsx`
- **Primary tables touched:** `profiles`, `verification_attempts`
- **External services:** Twilio Verify, Twilio Lookup
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- **Rebuild notes:** the only function explicitly gateway-protected by JWT in the checked-in config; do not accidentally normalize it to the looser posture used elsewhere

---

## I. Push / notification delivery

### `send-notification`
- **Purpose:** sends application push notifications, respects user preferences/mutes, and logs notification state
- **Auth posture:** Class C — `verify_jwt = true`
- **Frontend call sites:** `src/lib/notifications.ts`
- **Primary tables touched:** `notification_preferences`, `notification_log`, `match_mutes`, `match_notification_mutes`
- **External services:** OneSignal
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `APP_URL`
- **Rebuild notes:** depends on the OneSignal app existing and the app/user identity model matching what the frontend sets up

### `process-waitlist-promotion-notify-queue` (2026-04)
- **Purpose:** drains `waitlist_promotion_notify_queue` in batches and invokes `send-notification` with category `event_waitlist_promoted` for users promoted from paid waitlist to confirmed
- **Auth posture:** Class B — `verify_jwt = false`; requires `Authorization: Bearer` matching Edge secret **`CRON_SECRET`** (function runtime) and the **same string** stored in Vault as **`cron_secret`** when invoked by `pg_cron` (migration `20260408120000_waitlist_promotion_cron_vault.sql`; base URL from Vault **`project_url`** — **not** DB GUC `app.*`)
- **Frontend call sites:** none (pg_cron / operator HTTP only)
- **Primary tables touched:** `waitlist_promotion_notify_queue`, `events` (title lookup); cron path reads **`vault.decrypted_secrets`**
- **External services:** OneSignal (via `send-notification`)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
- **Rebuild notes:** ensure Vault secrets **`project_url`** and **`cron_secret`** exist before expecting the minutely job to succeed; queue rows remain pending until this function runs successfully

### `daily-drop-actions` (Stream 2C)
- **Purpose:** wraps `daily_drop_transition` for opener/reply flows and couples them with server-owned push notifications
- **Auth posture:** Class C — `verify_jwt = true`; uses the caller’s JWT to ensure `auth.uid()` inside `daily_drop_transition` is the actor
- **Frontend call sites:** `src/hooks/useDailyDrop.ts` (for `sendOpener` / `sendReply`)
- **Primary tables touched:** `daily_drops`, `matches`, `messages`, `profiles` (for partner name lookup), plus `notification_log` indirectly via `send-notification`
- **External services:** OneSignal (indirectly via `send-notification`)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** keep `daily_drop_transition` and this wrapper in sync; notifications are only sent for non-terminal, non-idempotent transitions to avoid duplicate sends on retry/race

### `send-message` (Stream 2E)
- **Purpose:** inserts chat messages on behalf of the authenticated user and couples the write with server-owned `"messages"` notifications. Supports **text/image** (`content`), **`message_kind: vibe_clip`** (after `upload-chat-video`), and **`message_kind: voice`** (after `upload-voice`); voice and Vibe Clip require UUID `client_request_id` for durable idempotency.
- **Auth posture:** Class C — `verify_jwt = true`; determines sender from JWT and validates membership in the match
- **Frontend call sites:** `src/hooks/useMessages.ts` (`useSendMessage`, `usePublishVibeClip`, `usePublishVoiceMessage`); native `apps/mobile/lib/chatApi.ts` (`invokeSendMessageEdge`, `invokePublishVibeClip`, `invokePublishVoiceMessage`)
- **Primary tables touched:** `matches`, `messages`, plus `notification_log` indirectly via `send-notification`
- **External services:** OneSignal (indirectly via `send-notification`)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** text path keeps short-window idempotency (same sender, match, content within 5s). Voice/Vibe Clip use `structured_payload.client_request_id` + partial unique index. DB must allow `message_kind = 'voice'` (migration `20260330100000_messages_message_kind_voice.sql`). Operative chat-media doc: `docs/chat-video-vibe-clip-architecture.md`.

### `swipe-actions` (Stream 2E)
- **Purpose:** wraps the `handle_swipe` RPC and couples core swipe/match outcomes with server-owned notifications
- **Auth posture:** Class C — `verify_jwt = true`; uses the caller’s JWT to supply `p_actor_id`
- **Frontend call sites:** `src/hooks/useSwipeAction.ts`
- **Primary tables touched:** `event_swipes`, `event_registrations`, `video_sessions`, plus `notification_log` indirectly via `send-notification`
- **External services:** OneSignal (indirectly via `send-notification`)
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Rebuild notes:** relies on `handle_swipe` for idempotency (e.g. `already_matched`, `already_super_vibed_recently`) and only emits notifications for the canonical results `match`, `match_queued`, `super_vibe_sent`, and `vibe_recorded`

### `push-webhook`
- **Purpose:** ingests delivery/open/click/failure events from push providers and normalizes them into `push_notification_events`
- **Auth posture:** Class B — `verify_jwt = false`; `PUSH_WEBHOOK_SECRET` required (header `x-webhook-secret`); fail-closed if secret missing
- **Frontend call sites:** `src/components/admin/LiveNotificationMonitor.tsx`
- **Primary tables touched:** `push_notification_events`
- **External services:** webhook payloads for FCM/APNs/web push style events
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUSH_WEBHOOK_SECRET`
- **Rebuild notes:** listed in config.toml; external webhook source(s) must send `x-webhook-secret` matching `PUSH_WEBHOOK_SECRET`

---

## 6. Shared helper directory

### `_shared`
- **Purpose:** reusable helper code for multiple functions
- **Observed shared module usage:** rate limiting helper used by at least `delete-account` and `vibe-notification`
- **Rebuild notes:** not deployed as its own function, but required for successful compilation of dependent functions

---

## 7. Frontend-invoked functions map

These functions are directly invoked from the frontend codebase:

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
- `email-verification` (via `/send` and `/verify` suffixes)
- `event-notifications`
- `forward-geocode`
- `generate-daily-drops`
- `geocode`
- `phone-verify`
- `push-webhook`
- `request-account-deletion`
- `send-notification`
- `daily-drop-actions`
- `send-message`
- `swipe-actions`
- `upload-event-cover`
- `upload-image`
- `upload-voice`
- `verify-admin`
- `vibe-notification`

Functions not directly invoked from the normal frontend but still operationally required:
- `email-drip`
- `stripe-webhook`
- `unsubscribe`
- `video-webhook`

---

## 8. External-service dependency map

### Stripe
- `create-checkout-session`
- `create-credits-checkout`
- `create-event-checkout`
- `create-portal-session`
- `stripe-webhook`
- `delete-account` (cleanup path)

### Bunny Stream / Bunny Storage / Bunny CDN
- `create-video-upload`
- `video-webhook`
- `delete-vibe-video`
- `upload-image`
- `upload-event-cover`
- `upload-voice`

### Daily.co
- `daily-room`

### Resend
- `email-verification`
- `event-notifications`
- `email-drip`

### Twilio
- `phone-verify`

### OneSignal / push delivery
- `send-notification`
- `push-webhook`
- `vibe-notification` (notification event involvement)

### OpenStreetMap Nominatim
- `geocode`
- `forward-geocode`

---

## 9. Highest-risk rebuild points (post-hardening)

### 1. Provider-side webhooks live outside the repo
These flows will not recover automatically from code alone:
- `stripe-webhook`
- `video-webhook` (Bunny must send URL with `?token=BUNNY_VIDEO_WEBHOOK_TOKEN`)
- `push-webhook` (caller must send `x-webhook-secret`)
- `email-drip` scheduler / cron trigger

### 2. Required secrets (hardening)
These must be set for hardened behavior; missing = fail-closed or degraded:
- `PUSH_WEBHOOK_SECRET`
- `UNSUB_HMAC_SECRET`
- `CRON_SECRET`
- `BUNNY_VIDEO_WEBHOOK_TOKEN`

### 3. Hardcoded production-domain coupling
Several email/notification flows depend on `vibelymeet.com` assumptions beyond simple env replacement.

### 4. Shared-secret drift
These functions fail operationally if secrets mismatch provider setup:
- `stripe-webhook`
- `push-webhook`
- `unsubscribe`
- `email-drip`
- `video-webhook`
- `phone-verify` (Twilio)

---

## 10. Operator deployment guidance

For rebuild fidelity (post-hardening):

1. Deploy all 28 functions (config.toml covers all; no gaps).  
2. Set required secrets: `PUSH_WEBHOOK_SECRET`, `UNSUB_HMAC_SECRET`, `CRON_SECRET`, `BUNNY_VIDEO_WEBHOOK_TOKEN`, plus existing Stripe/Bunny/Daily/Resend/Twilio/OneSignal vars.  
3. JWT-at-gateway functions (21) will reject unauthenticated requests; public-but-protected (7) use secret/token in code.  
4. Re-register provider webhooks: Stripe signature; Bunny video callback URL with `?token=...`; push webhook with `x-webhook-secret`; email-drip cron with Bearer CRON_SECRET.  
5. Smoke-test frontend call paths and provider callback paths separately.

---

## 11. Bottom line

The Vibely Edge Function layer is not a thin helper tier. It is a major part of product behavior:
- payments
- media ingestion
- live video session orchestration
- trust and verification
- notifications
- scheduled engagement flows
- admin operations

A successful rebuild requires preserving not only the function files, but also their auth posture, secrets, external registrations, and function-to-frontend call contracts.
