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
| `upload-image` (Bunny) | Edge Function | Profile photo upload | Same (Bunny adapter) |
| profileService (profiles, profile_vibes, event_registrations, matches) | Queries | Load profile + related counts | Same queries or shared API layer |
| `create-video-upload` | Edge Function | Bunny Stream object + TUS signature | Native `vibeVideoApi`; web `VibeStudioModal`. Hard failures use **non-2xx** HTTP + JSON `{ success: false, error, code? }` (success remains **200** + `{ success: true, ... }`). |
| `delete-vibe-video` | Edge Function | Delete Bunny video + clear profile fields | Native + web Profile; response includes `bunnyRemoteDeleteOk` / `possibleBunnyOrphan` for ops. |
| `video-webhook` | Edge Function | Bunny encoding callbacks → `profiles.bunny_video_status` | **No JWT**; `?token=` must match `BUNNY_VIDEO_WEBHOOK_TOKEN`. See `docs/vibe-video-webhook-operator.md`. |

---

## Events and deck

| Contract | Type | Purpose | Native use |
|----------|------|---------|------------|
| `get_visible_events` | RPC | Events list (location-aware) | Same |
| `get_other_city_events` | RPC | Other cities | Same |
| `get_event_deck` | RPC | Deck for lobby (pause-aware, auth guard) | Same; get_event_deck_exclude_paused semantics |
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
| `send-message` | Edge Function | Text/image (`content`), **`message_kind: voice`** (after `upload-voice`), **`message_kind: vibe_clip`** (after `upload-chat-video`); idempotency via `client_request_id`; `send-notification` | Same; no client `messages.insert` for voice or Vibe Clip — see `docs/chat-video-vibe-clip-architecture.md` |
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
| `daily-room` | Edge Function | create_date_room, get token, delete_room | Same; Daily SDK on device |
| `video_date_transition` | RPC | enter_handshake, vibe, end, etc. | Same |
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
| `delete-account` | Edge Function | Request deletion | Same or link to web |
| `verify-admin` | Edge Function | Admin gating | Web only (admin routes) |

---

## Edge Functions inventory (reference)

From `supabase/functions/`: admin-review-verification, cancel-deletion, create-checkout-session, create-credits-checkout, create-event-checkout, create-portal-session, create-video-upload, daily-drop-actions, daily-room, delete-account, delete-vibe-video, email-verification, event-notifications, forward-geocode, generate-daily-drops, geocode, phone-verify, push-webhook, request-account-deletion, revenuecat-webhook, send-message, send-notification, stripe-webhook, swipe-actions, upload-chat-video, upload-event-cover, upload-image, upload-voice, verify-admin, video-webhook.

Native-v1 critical: send-message, swipe-actions, daily-drop-actions, daily-room, send-notification, account-pause, account-resume, geocode, create-checkout-session (web); revenuecat-webhook (native). Others as needed per screen.
