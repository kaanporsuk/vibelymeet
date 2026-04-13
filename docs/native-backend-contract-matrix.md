# Native backend contract matrix

Backend contracts used by native-v1 screens. All clients (web and native) use the **same** Supabase project, RPCs, and Edge Functions. No client-owned business logic; no native-only RPCs for core domains.

**Source of truth:** `supabase/migrations`, `supabase/functions`. Web usage from `src/` (hooks, pages, services).

---

## Auth and session

| Contract | Type | Purpose | Native use |
|---------|------|---------|------------|
| Supabase Auth | Auth API | Sign in/up, reset password, session, JWT | Same client; SecureStore/AsyncStorage for session |
| `profiles` | Table | User profile row; onboarding_complete etc. | Read/insert/update via same RLS |

---

## Onboarding and profile

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `profiles` insert/update | Table | Create/update profile (name, gender, tagline, etc.) | Same |
| `user_credits` upsert | Table | Initial credits on onboarding | Same |
| `geocode` | Edge Function | Resolve location for events | Same |
| `upload-image` (Bunny) | Edge Function | Profile photo upload and chat-image upload. `context = onboarding | profile_studio` keeps draft-safe profile lifecycle; `context = chat` + `match_id` registers `chat_image` assets after membership check | Same (Bunny adapter); native/web chat-image send now passes `context = chat` and `match_id` |
| `publish_photo_set` | RPC | Canonical published-photo save path; updates `profiles.photos` / `avatar_url` and active `media_references` together | Same profile photo save path on web + native |
| profileService (profiles, profile_vibes, event_registrations, matches) | Queries | Load profile + related counts | Same queries or shared API layer |
| `create-video-upload` | Edge Function | Bunny Stream object + TUS signature; activates the current primary vibe video in lifecycle tables while keeping `profiles.bunny_video_uid` / `bunny_video_status` current | Native `vibeVideoApi`; web `VibeStudioModal`. Hard failures use **non-2xx** HTTP + JSON `{ success: false, error, code? }` (success remains **200** + `{ success: true, ... }`). |
| `delete-vibe-video` | Edge Function | Clear current vibe-video snapshot, release active reference, and defer physical Bunny delete to lifecycle worker | Native + web Profile; compatibility response keys remain, but remote delete is no longer inline in Sprint 2. |
| `video-webhook` | Edge Function | Bunny encoding callbacks → `draft_media_sessions`, `profile_vibe_videos.video_status`, and current `profiles.bunny_video_status` | **No JWT**; `?token=` must match `BUNNY_VIDEO_WEBHOOK_TOKEN`. See `docs/vibe-video-webhook-operator.md`. |

---

## Events and deck

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `get_visible_events` | RPC | Events list (location-aware) | Same |
| `get_other_city_events` | RPC | Other cities | Same |
| `get_event_deck` | RPC | Deck for lobby (pause-aware, auth guard); filters targets by viewer **`profiles.preferred_age_min` / `preferred_age_max`** when target **`profiles.age`** is non-null (migration `20260415100000_get_event_deck_preferred_age.sql`) | Same |
| `update_participant_status` | RPC | Lobby status (browsing, in_room, etc.) | Same |
| `drain_match_queue` | RPC | Drain match queue on lobby | Same |
| `events`, `event_registrations` | Tables | Event detail, register/unregister | Same |

---

## Swipes and matches

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `swipe-actions` | Edge Function | handle_swipe + notifications | Same; no direct match writes |
| `handle_swipe` | RPC (called by EF) | Swipe outcome (match, super_vibe, etc.) | Via swipe-actions only |
| `matches` | Table | Match list, archive, mute, block | Same; useMatches, useBlockUser, etc. |

---

## Chat and messages

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `send-message` | Edge Function | Text/image (`content`), **`message_kind: voice`** (after `upload-voice`), **`message_kind: vibe_clip`** (after `upload-chat-video`); idempotency via `client_request_id`; `send-notification`; Sprint 3 also syncs persisted media into `media_assets` / `media_references` / `chat_media_retention_states` | Same; no client `messages.insert` for voice or Vibe Clip — see `docs/chat-video-vibe-clip-architecture.md` |
| `messages` | Table + Realtime | History and live updates | Same; subscribe same channel |
| Bunny (voice/chat video) | Upload then URL in message | Audio/video message payloads | Same upload flow or native adapter |

---

## Daily Drop

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `daily_drop_transition` | RPC | view, open, reply, pass | Same |
| `daily-drop-actions` | Edge Function | Opener/reply actions; notifications; match creation | Same |

---

## Ready Gate

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `ready_gate_transition` | RPC | ready, snooze, forfeit | Same |
| `video_sessions` / ready_gate state | Table | Session state for Ready Gate UI | Same |

---

## Video date

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `daily-room` | Edge Function | create_date_room, join_date_room, delete_room | **Token issuance:** requires `both_ready` **or** session already in handshake/date (`handshake_started_at` / `state` / `phase`) so rejoin works; **410** + `SESSION_ENDED` if `ended_at` set. Errors return JSON `{ error, code }` (no secrets). See `docs/native-video-date-hardening-deploy.md`. |
| `video_date_transition` | RPC | enter_handshake, vibe, end, etc. | **enter_handshake:** same readiness rule as `daily-room` for first start; idempotent when `handshake_started_at` already set; **SESSION_ENDED** / **READY_GATE_NOT_READY** + `code` on failure. |
| `leave_matching_queue` | RPC | On leave/end | Same |
| `video_sessions` | Table | Session state, ended_at | Same |

---

## Notifications

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `send-notification` | Edge Function | Single entrypoint; called by send-message, swipe-actions, daily-drop-actions, etc. | Same; OneSignal native SDK; register player ID with backend |
| `notification_preferences` | Table | Player IDs, quiet hours, mutes | Same; store iOS/Android player IDs |

---

## Entitlements and billing

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `check_premium_status` | RPC | Current premium state | Same |
| `get_user_subscription_status` | RPC | Subscription detail | Same |
| `create-checkout-session` | Edge Function | Stripe (web) | Web only |
| RevenueCat webhook | Edge Function | Native purchases → backend state | Native; sync to same entitlement schema |
| Stripe webhook | Edge Function | Web purchases | Web |

---

## Account and admin

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `account-pause` | Edge Function | Pause account | Same (settings) |
| `account-resume` | Edge Function | Resume account | Same |
| `request-account-deletion` | Edge Function | Start scheduled deletion grace window; authenticated same-user calls now apply only a reversible pending media hold, not final deletion | Same |
| `cancel-deletion` | Edge Function | Recover account during deletion grace window and clear the reversible pending media hold | Same |
| `delete-account` | Edge Function | Authenticated scheduled-deletion wrapper; applies the same reversible pending hold before sign-out/cleanup | Not required in normal app flow |
| `verify-admin` | Edge Function | Admin gating | Web only (admin routes) |
| `admin-media-lifecycle-controls` | Edge Function | Web-admin retention controls plus read-only worker readiness preview | Web admin only |

---

## Media lifecycle (backend-only)

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `media_assets` | Table | Canonical registry of all physical media files/streams | No direct client use — service_role only |
| `media_references` | Table | Links media assets to product entities (profiles, messages, events) | Read-only via RLS for asset owners |
| `media_delete_jobs` | Table | Deletion work queue with retry/backoff | service_role only |
| `media_retention_settings` | Table | Admin-configurable per-family retention policy | Read-only for authenticated (admin writes via service_role) |
| `profile_vibe_videos` | Table | Canonical per-user vibe-video history with one active/current primary row | No direct client reads yet; legacy clients still read `profiles.bunny_video_uid` |
| `chat_media_retention_states` | Table | Durable per-match participant retention state for chat media; survives message/match hard deletes and now also records grace-window pending deletion via `account_deletion_pending_at` | No direct client reads in normal UI |
| `delete_chat_for_current_user` | RPC | Backend-owned one-sided chat-retention release (`chat_deleted`) without service-role access | Shared authenticated client contract for future “delete chat for me” UI |
| `process-media-delete-jobs` | Edge Function | Cron worker: drain delete queue via Bunny/Supabase provider helpers | Server-only (CRON_SECRET auth) |
| `admin-media-lifecycle-controls` | Edge Function | Admin-only retention-setting writes and read-only preview of promotable assets + ready jobs | Web admin only |

> Sprint 1 added the foundation tables in `20260417100000_media_lifecycle_foundation.sql`. Sprint 2 (`20260417110000_media_lifecycle_profile_media_wiring.sql`) wires **vibe videos** and **profile photos** into this model while preserving legacy profile columns as the published client contract. Sprint 3 (`20260419100000_media_lifecycle_chat_account_cleanup.sql` + `20260419103000_chat_retention_user_wrappers.sql`) makes **chat images/videos/thumbnails/voice** lifecycle-managed. The grace-period follow-up (`20260419110000_account_deletion_grace_media_fix.sql`) keeps pending deletion reversible and moves final `account_deleted` release to the actual completion event. Sprint 4 adds admin-only retention controls/readiness preview via `admin-media-lifecycle-controls`. Cron is still disabled.

---

## Edge Functions inventory (reference)

From `supabase/functions/`: admin-media-lifecycle-controls, admin-review-verification, cancel-deletion, create-checkout-session, create-credits-checkout, create-event-checkout, create-portal-session, create-video-upload, daily-drop-actions, daily-room, delete-account, delete-vibe-video, email-verification, event-notifications, forward-geocode, generate-daily-drops, geocode, phone-verify, process-media-delete-jobs, push-webhook, request-account-deletion, revenuecat-webhook, send-message, send-notification, stripe-webhook, swipe-actions, upload-chat-video, upload-event-cover, upload-image, upload-voice, verify-admin, video-webhook.

Native-v1 critical: send-message, swipe-actions, daily-drop-actions, daily-room, send-notification, account-pause, account-resume, geocode, create-checkout-session (web); revenuecat-webhook (native). Others as needed per screen.
