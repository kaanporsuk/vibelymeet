# VIBELY — GOLDEN STATE TECHNICAL SNAPSHOT
## Complete Rebuild Reference Dossier
### Snapshot Date: March 10, 2026
### Git Tag: `v1.0-golden-pre-native` (to be created)
### Supabase Project ID: `schdyxcunwcvddlcshwd`

---

# TABLE OF CONTENTS

1. Stack Overview
2. Complete Route Map
3. Page Inventory (every page, what it does, what it depends on)
4. Hook Inventory (every custom hook, purpose, dependencies)
5. Service Layer Inventory
6. Context Providers
7. Supabase Edge Functions (complete inventory)
8. Database RPCs / PostgreSQL Functions
9. Database Schema (all tables, key columns, relationships)
10. RLS Policies Summary
11. Storage Buckets
12. Realtime Subscriptions
13. Third-Party Integration Touchpoints
14. Environment Variables Inventory
15. Notification System Map
16. Payment/Credits/Premium Architecture
17. Media Pipeline (Photos + Video)
18. Core Flow Sequences (step-by-step)
19. Admin System
20. Known Dead Code / Legacy Surfaces
21. Key Libraries and Versions
22. File Structure Overview
23. Rebuild Notes

---

# 1. STACK OVERVIEW

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend Framework | React | 18.3.1 |
| Build Tool | Vite | 5.4.19 |
| Language | TypeScript | 5.8.3 |
| Styling | Tailwind CSS | 3.4.17 |
| UI Components | shadcn/ui (Radix primitives) | Various |
| Animation | Framer Motion | 12.23.26 |
| Routing | react-router-dom | 7.12.0 |
| State/Data | @tanstack/react-query | 5.83.0 |
| Backend | Supabase (PostgreSQL + Edge Functions + Auth + Realtime) | JS client 2.88.0 |
| Live Video | Daily.co (@daily-co/daily-js) | Latest |
| VOD Video | Bunny Stream (HLS playback via hls.js) | — |
| Images | Bunny Storage + CDN + Optimizer | — |
| SMS | Twilio (via Supabase Auth + Edge Function) | — |
| Email | Resend (via Edge Function) | — |
| Payments | Stripe (Checkout + Webhooks) | — |
| Push Notifications | OneSignal (web) + Browser Notification API | — |
| Analytics | PostHog (posthog-js) | — |
| Error Tracking | Sentry (@sentry/react) | — |
| Form Validation | react-hook-form + zod | 7.61.1 / 3.25.76 |
| Date Utils | date-fns | 3.6.0 |
| Charts | recharts | 2.15.4 |
| Confetti | canvas-confetti | 1.9.4 |
| Face Detection | face-api.js (UNUSED — marked for removal) | 0.22.2 |
| Toast | sonner | 1.7.4 |

**Hosting:** Lovable (lovable.app) — handles build, deploy, CI/CD
**Domain:** vibelymeet.lovable.app (custom domain TBD)

---

# 2. COMPLETE ROUTE MAP

Source: `src/App.tsx`

## Public Routes (no auth required)
| Route | Page Component | Purpose |
|-------|---------------|---------|
| `/` | `Index` | Landing page with aurora background, CTA to sign up/sign in |
| `/auth` | `Auth` | Email/password sign in and sign up. Accepts `?mode=signup` param |
| `/reset-password` | `ResetPassword` | Password reset flow |
| `/how-it-works` | `HowItWorks` | Static explainer page |
| `/privacy` | `PrivacyPolicy` | Legal — privacy policy |
| `/terms` | `TermsOfService` | Legal — terms of service |
| `/delete-account` | `DeleteAccountWeb` | Legal — web-based account deletion (App Store requirement) |
| `/premium` | `Premium` | Premium plan marketing/info page |
| `/subscription/success` | `SubscriptionSuccess` | Post-Stripe-checkout success landing |
| `/subscription/cancel` | `SubscriptionCancel` | Post-Stripe-checkout cancel landing |

## Protected Routes (auth required, onboarding enforced)
| Route | Page Component | Purpose |
|-------|---------------|---------|
| `/onboarding` | `Onboarding` | Multi-step profile setup: name, DOB, gender, interested-in, photos, vibes, location |
| `/dashboard` | `Dashboard` | Home screen: next event, live event banner, recent matches, upcoming events |
| `/home` | `Dashboard` | Alias for `/dashboard` |
| `/events` | `Events` | Browse all upcoming events |
| `/events/:id` | `EventDetails` | Event detail: description, guest list, registration, pricing, venue, vibes |
| `/event/:eventId/lobby` | `EventLobby` | **THE CORE LOOP** — swipe deck during live event, Ready Gate overlay, match queue |
| `/matches` | `Matches` | All matches: new vibes, conversations, archived. Tabs: Conversations / Drops / Archived |
| `/chat/:id` | `Chat` | 1:1 messaging with match. Text, voice messages, video messages, arcade games, date proposals |
| `/profile` | `Profile` | Edit profile: photos, bio, vibes, prompts, vibe video, verification, settings |
| `/settings` | `Settings` | Account settings, notification preferences, privacy, account deletion |
| `/date/:id` | `VideoDate` | **TRUST-CRITICAL** — live video date with progressive blur, handshake/date phases, timer, vibe button |
| `/ready/:id` | `ReadyGate` | Standalone Ready Gate page (LEGACY — lobby overlay is the canonical path) |
| `/admin/create-event` | `AdminCreateEvent` | Admin-only event creation form |
| `/match-celebration` | `MatchCelebration` | Match celebration animation page |
| `/vibe-studio` | `VibeStudio` | Redirects to `/profile` (dead page — recording happens in VibeStudioModal) |
| `/vibe-feed` | `VibeFeed` | TikTok-style video feed (USES MOCK DATA — not wired to real videos) |
| `/schedule` | `Schedule` | Availability scheduling for date proposals |
| `/credits` | `Credits` | Credit pack purchase page |
| `/credits/success` | `CreditsSuccess` | Post-credit-purchase success |
| `/event-payment/success` | `EventPaymentSuccess` | Post-event-payment success |
| `/user/:userId` | `UserProfile` | View another user's public profile |

## Admin Routes
| Route | Page Component | Purpose |
|-------|---------------|---------|
| `/kaan` | `AdminLogin` | Admin login page (hardcoded path) |
| `/kaan/dashboard` | `AdminDashboard` | Full admin panel: events, users, reports, metrics, notifications, credits, moderation |

## Global Wrappers (in App.tsx)
- `QueryClientProvider` — React Query
- `AuthProvider` — Auth context (session, profile, admin check)
- `NotificationProvider` — In-app notification context
- `Sentry.ErrorBoundary` — Crash boundary with fallback UI
- `PostHogPageTracker` — Pageview tracking on every route change
- `AppContent` — Runs `useActivityHeartbeat` (updates last_seen_at)
- `NotificationContainer` + `NotificationManager` — In-app notification rendering
- `PushPermissionPrompt` — Push notification permission prompt
- `OfflineBanner` — Shows banner when offline

---

# 3. PAGE INVENTORY (KEY PAGES — DETAILED)

## Dashboard (`/dashboard`)
- **Sections:** Active call rejoin banner, deletion recovery banner, notification permission flow, next event (live vs upcoming), recent matches avatars, upcoming events carousel
- **Hooks used:** `useNextRegisteredEvent`, `useEvents`, `useRealtimeEvents`, `useDashboardMatches`, `useSchedule`, `useDateReminders`, `usePushNotifications`, `useNotifications`, `useAuth`, `useOtherCityEvents`, `useDeletionRecovery`
- **Key behavior:** Detects active video sessions for rejoin. Shows live event with "Enter Lobby" CTA. Shows next upcoming event with countdown.

## EventLobby (`/event/:eventId/lobby`)
- **THE CORE LOOP PAGE**
- **Hooks used:** `useEventDetails`, `useIsRegisteredForEvent`, `useEventDeck`, `useSwipeAction`, `useEventStatus`, `useMatchQueue`
- **Components:** `LobbyProfileCard` (swipeable card), `LobbyEmptyState`, `ReadyGateOverlay`, `PremiumPill`
- **Key behavior:** Loads filtered deck via `get_event_deck` RPC. Framer Motion swipe gestures. On mutual vibe → shows `ReadyGateOverlay`. On queued match → toast. Tracks seen profiles to prevent duplicates on refetch. Timer shows event time remaining. Status tracking via `useEventStatus`.
- **Guards:** Redirects if event not live or user not registered.

## VideoDate (`/date/:id`)
- **TRUST-CRITICAL PAGE**
- **Hooks used:** `useVideoCall` (Daily.co), `useCredits`, `useReconnection`, `useAuth`, `useEventStatus`
- **Components:** `HandshakeTimer`, `IceBreakerCard`, `VideoDateControls`, `SelfViewPIP`, `ConnectionOverlay`, `PartnerProfileSheet`, `PostDateSurvey`, `UrgentBorderEffect`, `VibeCheckButton`, `MutualVibeToast`, `KeepTheVibe`, `ReconnectionOverlay`
- **Phases:** `handshake` (60s, progressive blur 20→0 over 10s) → `date` (300s, full video) → `ended` (survey)
- **Key behavior:** Fetches partner data from video_sessions. Starts Daily.co call. Blur clears over 10s. Vibe button visible from start, glows at 40s. Both vibe → mutual toast → extends to 5min. Credits can extend further. Call ends → PostDateSurvey. Reconnection grace window on partner disconnect.

## Chat (`/chat/:id`)
- **Hooks used:** `useMessages`, `useSendMessage`, `useAuth`, `useMatchCall`, `useRealtimeMessages`
- **Features:** Text messaging, voice messages (recorded + uploaded to Bunny via `uploadVoiceToBunny`), video messages, typing indicator, date proposals (`VibeSyncModal`), Vibe Arcade games (`VibeArcadeMenu`, `GameBubbleRenderer`, multiple game creators)
- **Realtime:** Subscribes to messages table changes for the match

## Profile (`/profile`)
- **Key features:** Photo management (6 slots), bio editing, vibe tag selection, profile prompts, height selector, relationship intent, lifestyle details, vibe video recording (`VibeStudioModal`), vibe video playback (`VibePlayer` + fullscreen HLS player), email verification, phone verification (`PhoneVerification`), photo verification (`SimplePhotoVerification`), profile preview, profile wizard, safety hub
- **Services used:** `profileService` (fetchMyProfile, updateMyProfile), `storageService` (persistPhotos), `resolvePhotoUrl`

## Matches (`/matches`)
- **Tabs:** Conversations, Drops, Archived
- **Features:** Search, sort (recent/unread/compatibility), new vibes section, swipeable match cards, unmatch/block/archive/mute/report actions, Daily Drop content (`DropsTabContent`), "Who Liked You" premium gate
- **Hooks:** `useMatches`, `useUndoableUnmatch`, `useArchiveMatch`, `useBlockUser`, `useMuteMatch`, `useSubscription`

---

# 4. HOOK INVENTORY

## Core Flow Hooks
| Hook | File | Purpose |
|------|------|---------|
| `useEventDeck` | `src/hooks/useEventDeck.ts` | Fetches swipeable profiles via `get_event_deck` RPC. 15s auto-refresh. Returns `DeckProfile[]` with photos, vibes, shared_vibe_count, has_met_before |
| `useSwipeAction` | `src/hooks/useSwipeAction.ts` | Calls `handle_swipe` RPC. Handles all outcomes: vibe_recorded, match, match_queued, super_vibe_sent, pass, no_credits, limit_reached, blocked, etc. Sends notifications (TO BE MOVED SERVER-SIDE) |
| `useReadyGate` | `src/hooks/useReadyGate.ts` | Manages Ready Gate state. Subscribes to video_sessions Realtime. markReady, skip, snooze actions. Detects both-ready. (NEEDS SERVER ATOMICITY) |
| `useVideoCall` | `src/hooks/useVideoCall.ts` | Daily.co video call lifecycle. Creates room via `daily-room` Edge Function. Manages join, participant tracking, track attachment, mute/video, cleanup |
| `useMatchCall` | `src/hooks/useMatchCall.ts` | Daily.co calls for chat (voice + video). Incoming call detection via Realtime. Separate from event video dates |
| `useCredits` | `src/hooks/useCredits.ts` | Fetches user credits. `useExtraTime` and `useExtendedVibe` call `deduct_credit` RPC |
| `useReconnection` | `src/hooks/useReconnection.ts` | 60s grace window when partner disconnects during video date. Pauses timer. Shows overlay |
| `useEventStatus` | `src/hooks/useEventStatus.ts` | Tracks user status in event: browsing, in_ready_gate, in_handshake, in_date, in_survey, offline. Updates via `update_participant_status` RPC. 60s heartbeat |
| `useMatchQueue` | `src/hooks/useMatchQueue.ts` | Monitors queued matches. Calls `drain_match_queue` RPC when user returns to browsing. Realtime subscription for queue-to-ready transitions |

## Data Hooks
| Hook | File | Purpose |
|------|------|---------|
| `useMessages` | `src/hooks/useMessages.ts` | Fetches messages for a match. Returns messages + other user profile data |
| `useSendMessage` | `src/hooks/useMessages.ts` | Mutation to insert message. Sends push notification to recipient |
| `useRealtimeMessages` | `src/hooks/useRealtimeMessages.ts` | Realtime subscription for new messages in a match |
| `useMatches` | `src/hooks/useMatches.ts` | Fetches all user matches with profile data, last message, unread status |
| `useDashboardMatches` | `src/hooks/useMatches.ts` | Lightweight match fetch for dashboard avatars |
| `useEvents` | `src/hooks/useEvents.ts` | Fetches all events |
| `useRealtimeEvents` | `src/hooks/useEvents.ts` | Realtime subscription for event changes |
| `useNextRegisteredEvent` | `src/hooks/useEvents.ts` | Fetches user's next registered event |
| `useEventDetails` | `src/hooks/useEventDetails.ts` | Fetches single event with computed fields (isLive, capacity, pricing) |
| `useEventAttendees` | `src/hooks/useEventDetails.ts` | Fetches event attendee list with profiles |
| `useIsRegisteredForEvent` | `src/hooks/useEventDetails.ts` | Boolean check if user is registered |
| `useRegisterForEvent` | `src/hooks/useRegistrations.ts` | Register/unregister mutations |
| `useEventVibes` | `src/hooks/useEventVibes.ts` | Pre-event interest expressions between attendees |
| `useOtherCityEvents` | `src/hooks/useVisibleEvents.ts` | Events in other cities for discovery |

## Feature Hooks
| Hook | File | Purpose |
|------|------|---------|
| `useDailyDrop` | `src/hooks/useDailyDrop.ts` | Complete Daily Drop lifecycle: fetch drop, partner profile, countdown, mark viewed, send opener, send reply (CREATES MATCH CLIENT-SIDE — needs server migration), pass, past drops |
| `useSubscription` | `src/hooks/useSubscription.ts` | Stripe subscription status. Creates checkout session via Edge Function. `isPremium` boolean |
| `useSchedule` | `src/hooks/useSchedule.ts` | Availability scheduling. Toggle slots, send/respond to date proposals |
| `useDateReminders` | `src/hooks/useDateReminders.ts` | Event reminder scheduling |
| `usePushNotifications` | `src/hooks/usePushNotifications.ts` | Push notification permissions and state |
| `useEventNotifications` | `src/hooks/useEventNotifications.ts` | Browser Notification API for match, ready gate, queued match, super vibe |
| `useEmailVerification` | `src/hooks/useEmailVerification.ts` | Email OTP send/verify via Edge Function |
| `useActivityHeartbeat` | `src/hooks/useActivityHeartbeat.ts` | Updates profile last_seen_at periodically |
| `useDeletionRecovery` | `src/hooks/useDeletionRecovery.ts` | Account deletion recovery flow |
| `useLogout` | `src/hooks/useLogout.ts` | Logout handler |

## UI/UX Hooks
| Hook | File | Purpose |
|------|------|---------|
| `useUndoableUnmatch` | `src/hooks/useUndoableUnmatch.ts` | Unmatch with undo toast |
| `useArchiveMatch` | `src/hooks/useArchiveMatch.ts` | Archive match action |
| `useBlockUser` | `src/hooks/useBlockUser.ts` | Block user action |
| `useMuteMatch` | `src/hooks/useMuteMatch.ts` | Mute/unmute match notifications |
| `useMutualAvailability` | `src/hooks/useSchedule.ts` | Mutual availability calculation for date proposals |

---

# 5. SERVICE LAYER INVENTORY

| Service | File | Purpose |
|---------|------|---------|
| `profileService` | `src/services/profileService.ts` | `fetchMyProfile`, `updateMyProfile`, `createProfile`, `autoDetectLocation`, `calculateAge`, `getZodiacSign`. Maps DB snake_case ↔ camelCase via `profileToDb`/`dbToProfile` |
| `storageService` | `src/services/storageService.ts` | `persistPhotos` — uploads photos to Supabase Storage (profile-photos bucket). Photo URL resolution |
| `vibelyService` | `src/services/vibelyService.ts` | Unified service layer: profile CRUD, vibe tags, profile vibes, discoverable profiles. Legacy Daily Drop localStorage service (superseded by `useDailyDrop` hook) |
| `voiceUploadService` | `src/services/voiceUploadService.ts` | `uploadVoiceToBunny` — uploads voice messages to Bunny via `upload-voice` Edge Function |
| `videoStorageService` | `src/services/videoStorageService.ts` | Legacy video upload to Supabase Storage (may be superseded by Bunny `create-video-upload`) |

## Lib Utilities
| File | Purpose |
|------|---------|
| `src/lib/analytics.ts` | `trackEvent` wrapper for PostHog |
| `src/lib/notifications.ts` | `sendNotification` — calls `send-notification` Edge Function |
| `src/lib/photoUtils.ts` | `resolvePhotoUrl` — resolves various photo URL formats (Supabase signed, Bunny CDN, raw paths) |
| `src/lib/errorTracking.ts` | `captureSupabaseError` — sends Supabase errors to Sentry with context |
| `src/lib/haptics.ts` | `haptics` — navigator.vibrate wrapper with try-catch |
| `src/lib/utils.ts` | `cn` — Tailwind class merge utility |
| `src/integrations/supabase/client.ts` | Supabase client initialization |
| `src/integrations/supabase/types.ts` | Auto-generated Supabase types |

---

# 6. CONTEXT PROVIDERS

| Context | File | Purpose | Issues |
|---------|------|---------|--------|
| `AuthProvider` | `src/contexts/AuthContext.tsx` | Session management, profile hydration, admin role lookup, Sentry/PostHog/OneSignal identity, signup profile creation, logout cleanup, pause/resume state | OVERLOADED — needs decomposition. pause/resume is React-state-only, does not persist to DB |
| `NotificationProvider` | `src/contexts/NotificationContext.tsx` | In-app notification state management, unread count | |

---

# 7. SUPABASE EDGE FUNCTIONS (COMPLETE INVENTORY)

Source: `supabase/config.toml` + function source files

### Media Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `create-video-upload` | false | Creates Bunny Stream video object, computes SHA256 signature, returns tus upload credentials |
| `video-webhook` | false | Receives Bunny transcoding webhook, updates `bunny_video_status` to 'ready' |
| `delete-vibe-video` | false | Deletes a vibe video from Bunny Stream |
| `upload-image` | false | Uploads image to Bunny Storage, returns storage path |
| `upload-voice` | false | Uploads voice message to Bunny Storage |
| `upload-event-cover` | false | Uploads event cover image |

### Video Date Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `daily-room` | false | Creates/deletes Daily.co rooms. Actions: `create_date_room` (creates room + generates meeting token), `delete_room` |

### Auth / Verification Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `phone-verify` | true | SMS OTP via Twilio Verify API. Actions: `send` (with VoIP detection, WebOTP format, rate limiting), `check` (with 1:1 phone association). Always returns HTTP 200 |
| `email-verification` | false | Email OTP via Resend. Actions: `send` (generates OTP, hashes before storing, sends branded email), `verify` (hash comparison, max 7 attempts/hour, clears on success, updates profile.email_verified) |
| `verify-admin` | false | Server-side admin role verification |
| `admin-review-verification` | false | Admin reviews photo verification selfies |

### Payment Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `create-checkout-session` | false | Creates Stripe Checkout session for premium subscription |
| `create-event-checkout` | false | Creates Stripe Checkout session for paid event registration |
| `create-credits-checkout` | false | Creates Stripe Checkout session for credit packs |
| `create-portal-session` | false | Creates Stripe Customer Portal session for subscription management |
| `stripe-webhook` | false | Processes Stripe webhook events (checkout.session.completed, subscription changes) |

### Notification Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `send-notification` | false | Sends push notifications (OneSignal + in-app). Accepts `{ user_id, category, title, body, data }` |
| `event-notifications` | false | Event-related notification dispatch |
| `vibe-notification` | false | "Someone vibed you" notification |
| `email-drip` | false | Email drip campaign delivery |
| `unsubscribe` | false | Email unsubscribe handler |

### Daily Drop Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `generate-daily-drops` | false | Generates daily drop pairings. Runs as scheduled job or manual trigger |

### Account Management Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `request-account-deletion` | false | Schedules account for deletion (30-day grace period) |
| `cancel-deletion` | false | Cancels pending account deletion |
| `delete-account` | false | Permanent account deletion (after grace period) |

### Utility Functions
| Function | JWT | Purpose |
|----------|-----|---------|
| `geocode` | false | Geocodes location text to coordinates |

---

# 8. DATABASE RPCs / POSTGRESQL FUNCTIONS

Source: `src/integrations/supabase/types.ts` (Functions section)

| Function | Parameters | Returns | Purpose |
|----------|-----------|---------|---------|
| `get_event_deck` | `p_event_id, p_limit?, p_user_id` | JSON (profile array) | Returns swipeable profiles with 7 filtering rules: same event, gender compatibility, exclude swiped, exclude already-dated, exclude persistent matches, exclude blocked/reported, exclude suspended. Returns shared_vibe_count, has_met_before |
| `handle_swipe` | `p_actor_id, p_event_id, p_swipe_type, p_target_id` | JSON | Processes swipe action. Validates registration, blocking, reporting. For super_vibe: checks credits, deducts atomically, enforces 3/event + 30-day cooldown. Detects mutual vibe → creates video_sessions row. If target busy → queues match |
| `check_mutual_vibe_and_match` | `p_session_id` | JSON | Reads both participant likes from video_sessions. If both true → creates persistent match with ON CONFLICT DO NOTHING. Returns { mutual: true, match_id } or { mutual: false } or { pending: true } |
| `drain_match_queue` | `p_event_id, p_user_id` | JSON | Activates queued matches when user returns to browsing. Checks for pending sessions, activates if partner available |
| `find_video_date_match` | `p_event_id, p_user_id` | JSON | Legacy FIFO matching (may still exist alongside swipe system) |
| `find_mystery_match` | `p_event_id, p_user_id` | JSON | Finds random compatible candidate when deck is empty. All safety filters apply |
| `deduct_credit` | `p_credit_type, p_user_id` | boolean | Atomic credit deduction. Race-condition-safe. Returns true if deducted, false if insufficient |
| `update_participant_status` | (params vary) | void | Updates event_registrations.queue_status for user status tracking |
| `check_gender_compatibility` | `_target_gender, _target_interested_in, _viewer_id` | boolean | Bidirectional gender preference check |
| `check_premium_status` | `p_user_id` | boolean | Checks if user has active premium subscription |
| `can_view_profile_photo` | `photo_owner_id` | boolean | Permission check for viewing profile photos |
| `has_role` | `_user_id, _role` | boolean | Checks user role (admin, moderator, user). SECURITY DEFINER to prevent RLS recursion |
| `is_blocked` | `user1_id, user2_id` | boolean | Bidirectional block check. SECURITY DEFINER |
| `generate_recurring_events` | `p_parent_id, p_count?` | number | Generates recurring event instances |

---

# 9. DATABASE SCHEMA

## Core Tables

### `profiles`
Primary user data. FK to `auth.users(id)`.
```
id (uuid PK), name, birth_date, age, gender, interested_in,
tagline, height_cm, location, location_data (jsonb), job, company,
about_me, looking_for, lifestyle (jsonb), prompts (jsonb),
photos (text[]), avatar_url, bunny_video_uid, bunny_video_status,
vibe_caption, vibe_video_status, photo_verified, photo_verified_at,
proof_selfie_url, phone_number, phone_verified, phone_verified_at,
email_verified, verified_email, is_premium, premium_until,
events_attended, total_matches, total_conversations,
relationship_intent, last_seen_at, created_at, updated_at
```

### `events`
```
id (uuid PK), title, description, event_date, duration_minutes,
cover_image, status (scheduled|live|ended|draft|cancelled),
created_by (FK profiles), max_men, max_women, current_men,
current_women, is_virtual, venue (jsonb), city, country,
price_male, price_female, is_free, scope (global|regional|local),
recurrence_type, parent_event_id, ends_at, ended_at,
created_at, updated_at
```

### `event_registrations`
```
id (uuid PK), event_id (FK events), profile_id (FK profiles),
registered_at, attended, queue_status (browsing|in_ready_gate|
in_handshake|in_date|in_survey|offline|idle|searching|matched),
current_partner_id, current_room_id, joined_queue_at,
last_active_at, last_matched_at, dates_completed,
payment_status, attendance_marked, attendance_marked_at,
attendance_marked_by
```

### `event_swipes`
```
id (uuid PK), swiper_id (FK profiles), target_id (FK profiles),
event_id (FK events), action (pass|vibe|super_vibe), created_at
UNIQUE(event_id, swiper_id, target_id)
```

### `matches`
```
id (uuid PK), profile_id_1 (FK profiles), profile_id_2 (FK profiles),
event_id (FK events), matched_at, last_message_at,
archived_at, archived_by
UNIQUE(profile_id_1, profile_id_2)
CHECK(profile_id_1 < profile_id_2) — canonical ordering
```

### `messages`
```
id (uuid PK), match_id (FK matches), sender_id (FK profiles),
content, message_type, audio_url, audio_duration_seconds,
video_url, video_duration_seconds, read_at, created_at
```

### `video_sessions`
```
id (uuid PK), event_id (FK events),
participant_1_id (FK profiles), participant_2_id (FK profiles),
started_at, ended_at, participant_1_liked (bool),
participant_2_liked (bool), duration_seconds,
daily_room_url, status,
ready_gate_status, ready_participant_1_at, ready_participant_2_at,
ready_gate_expires_at, snoozed_by, snooze_expires_at,
vibe_questions (jsonb)
```

### `daily_drops`
```
id (uuid PK), user_a_id, user_b_id, drop_date, status
(active_unopened|active_viewed|active_opener_sent|replied|
matched|passed|expired_no_opener|expired_no_reply),
expires_at, user_a_viewed, user_b_viewed,
opener_sender_id, opener_text, opener_sent_at,
reply_sender_id, reply_text, reply_sent_at,
chat_unlocked, match_id, passed_by_user_id,
pick_reasons (text[]), affinity_score (numeric),
created_at, updated_at
UNIQUE(user_a_id, drop_date) — one drop per user per day
```

## Supporting Tables

### `vibe_tags`
```
id (uuid PK), label, emoji, category, created_at
```

### `profile_vibes`
```
id (uuid PK), profile_id (FK profiles), vibe_tag_id (FK vibe_tags)
```

### `user_credits`
```
user_id (FK profiles), extra_time_credits, extended_vibe_credits,
super_vibe_credits
```

### `blocked_users`
```
id (uuid PK), blocker_id, blocked_id, reason, created_at
UNIQUE(blocker_id, blocked_id)
```

### `user_reports`
```
id (uuid PK), reporter_id, reported_id, reason, details,
status (pending|reviewed|dismissed|action_taken), created_at
```

### `date_feedback`
```
id (uuid PK), session_id (FK video_sessions), user_id (FK profiles),
liked (bool), highlight_tags (text[]), energy_rating, flow_rating,
photo_accurate (bool), honest_rating, report_text,
UNIQUE(session_id, user_id)
```

### `date_proposals`
```
id (uuid PK), proposer_id, recipient_id, match_id (FK matches),
proposed_date, time_block (morning|lunch|afternoon|evening|night),
activity, status (pending|accepted|declined), created_at, responded_at
```

### `match_mutes`
```
id (uuid PK), match_id (FK matches), user_id, muted_until, created_at
```

## Verification Tables

### `email_verifications`
```
id (uuid PK), user_id, email, code (hashed), expires_at,
verified_at, created_at
```

### `verification_attempts`
```
id (uuid PK), user_id, attempt_at, ip_address
INDEX on (user_id, attempt_at DESC)
Auto-cleanup trigger: deletes attempts older than 1 hour
```

## Admin Tables

### `user_roles`
```
id (uuid PK), user_id (FK auth.users), role (app_role enum: admin|moderator|user),
created_at. UNIQUE(user_id, role)
```

### `admin_notifications`
```
id (uuid PK), type, title, message, data (jsonb), read, created_at
```

### `user_suspensions`
```
id (uuid PK), user_id, suspended_by, reason, suspended_at,
expires_at, lifted_at, lifted_by, status (active|lifted|expired)
```

### `user_warnings`
```
id (uuid PK), user_id, issued_by, reason, message, created_at
```

### `admin_activity_logs`
```
id (uuid PK), admin_id, action_type, target_type, target_id,
details (jsonb), created_at
```

### `credit_adjustments`
```
id (uuid PK), user_id, admin_id, credit_type, amount, reason, created_at
```

## Notification Tables

### `push_campaigns`
```
id (uuid PK), title, body, target_segment, scheduled_at,
sent_at, created_by, created_at, status
```

### `push_notification_events`
```
id (uuid PK), campaign_id, user_id, device_token, platform
(notification_platform enum: web|ios|android|pwa),
status (notification_status enum: queued|sending|sent|delivered|
opened|clicked|failed|bounced), error_code, error_message,
queued_at, sent_at, delivered_at, opened_at, clicked_at, created_at
```

### `notification_preferences`
```
(stores user notification settings, OneSignal player ID)
```

## Payment Tables

### `subscriptions`
```
(Stripe subscription data: user_id, stripe_customer_id,
stripe_subscription_id, status, plan, current_period_start/end)
```

### `email_drip_log`
```
id (uuid PK), user_id, email_key, sent_at
```

---

# 10. RLS POLICIES SUMMARY

**All tables have RLS enabled.** Key patterns:

- **Profiles:** Anyone authenticated can view. Users can only update their own. Admins can view all.
- **Matches:** Users can view where they are profile_id_1 or profile_id_2, AND not blocked. Admins can view all.
- **Messages:** Users can view/insert in their own matches. Block check on insert. Users can update/delete own messages.
- **Events:** Public read. Admin-only create/update/delete (via `has_role` function).
- **Event Registrations:** Public read. Users can register/unregister themselves. Admins can view all.
- **Video Sessions:** Participants can view/update own sessions. Admins can view all.
- **Blocked Users:** Users can view/create/delete their own blocks.
- **User Reports:** Users can insert reports. Admins view all.
- **Admin tables:** All gated by `has_role(auth.uid(), 'admin')`.
- **Storage (vibe-videos):** Private bucket. Authenticated users can view all (v1 trade-off). Owner can upload/update/delete own folder.
- **Storage (profile-photos):** Public bucket. Owner can upload/update/delete own folder.
- **Storage (proof-selfies):** Private. Owner can upload/view own. Admins can view all.

---

# 11. STORAGE BUCKETS

| Bucket | Public | Purpose |
|--------|--------|---------|
| `profile-photos` | Yes | Profile photos (6 slots per user). Path: `{userId}/{timestamp}.jpg` |
| `vibe-videos` | No (private) | Vibe intro videos. Path: `{userId}/{filename}` |
| `proof-selfies` | No (private) | Photo verification selfies. Path: `{userId}/{filename}` |

**Note:** Media is migrating to Bunny (Storage for images, Stream for video). Supabase Storage is still in use for some paths. The Bunny migration status at snapshot time is partial.

---

# 12. REALTIME SUBSCRIPTIONS

| Table | Events | Used By | Purpose |
|-------|--------|---------|---------|
| `messages` | INSERT | `useRealtimeMessages` | Real-time chat messages per match |
| `matches` | INSERT, UPDATE | `useMatches` | New match detection |
| `video_sessions` | UPDATE | `useReadyGate`, `VideoDate` | Ready gate sync, reconnection |
| `events` | UPDATE | `useRealtimeEvents`, `useEventLifecycle` | Event status changes (admin ends event) |
| `daily_drops` | UPDATE | `useDailyDrop` | Drop state changes (opener sent, reply sent, etc.) |
| `event_registrations` | UPDATE | `useMatchQueue` | Queue status changes for match queue drain |

**All Realtime enabled via:** `ALTER PUBLICATION supabase_realtime ADD TABLE <table>;`

---

# 13. THIRD-PARTY INTEGRATION TOUCHPOINTS

### Daily.co (Live Video)
- **Edge Function:** `daily-room` → creates rooms via Daily REST API, generates meeting tokens
- **Client:** `@daily-co/daily-js` in `useVideoCall.ts` and `useMatchCall.ts`
- **Config needed:** `DAILY_API_KEY` env var in Edge Functions
- **Rooms:** Auto-expire. Created per video session. Deleted on call end.

### Stripe (Payments)
- **Edge Functions:** `create-checkout-session`, `create-event-checkout`, `create-credits-checkout`, `create-portal-session`, `stripe-webhook`
- **Client:** `useSubscription.ts` — redirects to Stripe Checkout via `window.location.href`
- **Config needed:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` env vars. Stripe products/prices configured in Stripe dashboard.
- **Webhook endpoint:** `https://<supabase-project>.supabase.co/functions/v1/stripe-webhook`

### Twilio (SMS Verification)
- **Edge Function:** `phone-verify` — uses Twilio Verify API
- **Config needed:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` env vars
- **Features:** VoIP detection (blocks virtual numbers), WebOTP format for auto-fill, exponential rate limiting, 1:1 phone association

### Resend (Transactional Email)
- **Edge Functions:** `email-verification` (sends OTP emails), `email-drip` (drip campaigns), `unsubscribe`
- **Config needed:** `RESEND_API_KEY` env var. Sending domain configured in Resend dashboard.

### Bunny.net (Media CDN)
- **Edge Functions:** `create-video-upload` (Bunny Stream API), `video-webhook` (transcoding status), `delete-vibe-video`, `upload-image` (Bunny Storage), `upload-voice` (Bunny Storage), `upload-event-cover`
- **Client:** Vibe video playback via HLS URL: `https://{BUNNY_STREAM_CDN_HOSTNAME}/{videoId}/playlist.m3u8`
- **Config needed:** `BUNNY_API_KEY`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_CDN_HOSTNAME`, `BUNNY_STORAGE_ZONE_NAME`, `BUNNY_STORAGE_API_KEY`, `BUNNY_CDN_HOSTNAME` env vars
- **Client env:** `VITE_BUNNY_STREAM_CDN_HOSTNAME` (in `.env` for frontend HLS URL construction)

### OneSignal (Push Notifications)
- **Client:** Initialized in `AuthContext.tsx`. Player ID stored in `notification_preferences`.
- **Edge Function:** `send-notification` sends via OneSignal REST API
- **Config needed:** `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY` env vars

### PostHog (Analytics)
- **Client:** `posthog-js` initialized in app. `trackEvent` wrapper in `src/lib/analytics.ts`. `PostHogPageTracker` component in App.tsx.
- **Config needed:** `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` env vars

### Sentry (Error Tracking)
- **Client:** `@sentry/react` with `ErrorBoundary` in App.tsx. Breadcrumbs in video date flow and swipe actions.
- **Config needed:** `VITE_SENTRY_DSN` env var

---

# 14. ENVIRONMENT VARIABLES INVENTORY

## Frontend (Vite — prefixed with `VITE_`)
| Variable | Service | Purpose |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | Supabase | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase | Anonymous/public API key |
| `VITE_BUNNY_STREAM_CDN_HOSTNAME` | Bunny | CDN hostname for HLS video playback URLs |
| `VITE_POSTHOG_KEY` | PostHog | Analytics project key |
| `VITE_POSTHOG_HOST` | PostHog | Analytics API host |
| `VITE_SENTRY_DSN` | Sentry | Error tracking DSN |
| `VITE_ONESIGNAL_APP_ID` | OneSignal | Push notification app ID |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe | Public Stripe key (if used client-side) |

## Edge Functions (Supabase Secrets)
| Variable | Service | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | Supabase | Auto-provided |
| `SUPABASE_ANON_KEY` | Supabase | Auto-provided |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Auto-provided — admin access |
| `DAILY_API_KEY` | Daily.co | Room creation + meeting tokens |
| `STRIPE_SECRET_KEY` | Stripe | Payment processing |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Webhook signature verification |
| `TWILIO_ACCOUNT_SID` | Twilio | SMS account |
| `TWILIO_AUTH_TOKEN` | Twilio | SMS auth |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio | SMS Verify service |
| `RESEND_API_KEY` | Resend | Email sending |
| `BUNNY_API_KEY` | Bunny | Stream + Storage API access |
| `BUNNY_STREAM_LIBRARY_ID` | Bunny | Stream library ID |
| `BUNNY_STREAM_CDN_HOSTNAME` | Bunny | CDN hostname |
| `BUNNY_STORAGE_ZONE_NAME` | Bunny | Storage zone |
| `BUNNY_STORAGE_API_KEY` | Bunny | Storage access key |
| `BUNNY_CDN_HOSTNAME` | Bunny | CDN for images |
| `ONESIGNAL_APP_ID` | OneSignal | Push app ID |
| `ONESIGNAL_REST_API_KEY` | OneSignal | Push API key |

---

# 15. NOTIFICATION SYSTEM MAP

### Server-Side Dispatch
- `src/lib/notifications.ts` → calls `send-notification` Edge Function
- Edge Function routes to OneSignal (web push) and/or in-app

### Client-Side (Browser API)
- `useEventNotifications.ts` → Browser `Notification` API. Only fires when tab is hidden. Throttled 1 per 30s.
- Methods: `notifyMatch`, `notifyReadyGateWaiting`, `notifyQueuedMatchReady`, `notifySuperVibe`

### Notification Categories
| Category | Trigger | Delivery |
|----------|---------|----------|
| `new_match` | Mutual vibe in swipe or survey | Server push + in-app |
| `ready_gate` | Partner waiting in Ready Gate | Server push |
| `daily_drop` | New drop or opener/reply | Server push |
| `messages` | New chat message | Server push |
| `someone_vibed_you` | Someone swiped vibe on you | Server push (anonymous) |
| `event_reminder` | Event starting soon | Client-scheduled (localStorage) |
| `system` | Admin/moderation | Server push |

---

# 16. PAYMENT / CREDITS / PREMIUM ARCHITECTURE

### Stripe Products (configured in Stripe dashboard)
- Premium subscription plans
- Credit packs (Extra Time, Extended Vibe, Super Vibe)
- Paid event tickets

### Credit Types (in `user_credits` table)
- `extra_time_credits` — adds 2 minutes to video date
- `extended_vibe_credits` — adds 5 minutes to video date
- `super_vibe_credits` — sends Super Vibe (priority position in deck)

### Premium Benefits
- "Who Liked You" visibility
- Priority in deck
- Extended event access
- Checked via `useSubscription.isPremium` or `check_premium_status` RPC

### Flow
1. User selects plan/pack → `create-checkout-session` / `create-credits-checkout` Edge Function → Stripe Checkout URL
2. `window.location.href` redirect to Stripe
3. On success: Stripe webhook → `stripe-webhook` Edge Function → updates `subscriptions` table or `user_credits` table
4. User redirected to success page → app reads updated state

---

# 17. MEDIA PIPELINE

### Profile Photos (CURRENT STATE)
- **Upload:** `persistPhotos` in `storageService.ts` → Supabase Storage `profile-photos` bucket
- **Storage path:** `{userId}/{timestamp}.jpg`
- **Display:** `resolvePhotoUrl` in `photoUtils.ts` — handles Supabase public URLs, signed URLs, various formats
- **Target state (Bunny):** `upload-image` Edge Function → Bunny Storage. `getImageUrl()` helper → Bunny CDN + Optimizer

### Vibe Videos (PARTIALLY MIGRATED TO BUNNY)
- **Record:** `VibeStudioModal` component. Browser MediaRecorder API. Codec priority: Safari→MP4, Chrome→WebM
- **Upload:** Client calls `create-video-upload` Edge Function → gets Bunny tus credentials → uploads via tus-js-client to Bunny Stream
- **Transcoding:** Bunny transcodes to HLS. `video-webhook` Edge Function updates DB status
- **Storage:** `profiles.bunny_video_uid` (Bunny GUID), `profiles.bunny_video_status` (uploading|processing|ready|failed)
- **Playback:** HLS URL: `https://{CDN_HOSTNAME}/{videoId}/playlist.m3u8`. Uses native HLS on Safari, hls.js on Chrome. `VibePlayer` component with IntersectionObserver for lazy loading
- **Cleanup:** On new upload, Edge Function deletes old Bunny video

### Voice Messages
- **Upload:** `uploadVoiceToBunny` → `upload-voice` Edge Function → Bunny Storage
- **Stored in:** `messages.audio_url` + `messages.audio_duration_seconds`

### Video Messages
- **Upload path exists** but may use same Bunny upload path
- **Stored in:** `messages.video_url` + `messages.video_duration_seconds`

---

# 18. CORE FLOW SEQUENCES

### Flow 1: Event → Lobby → Swipe → Match → Video Date → Chat

```
1. User browses /events → sees event list
2. User taps event → /events/:id → sees details, guest list, pricing
3. User registers (free or paid via Stripe)
4. Event goes live (admin sets status='live' or time-based)
5. User navigates to /event/:eventId/lobby
6. useEventStatus sets queue_status='browsing'
7. useEventDeck calls get_event_deck RPC → returns filtered profiles
8. User swipes right (Vibe) → useSwipeAction calls handle_swipe RPC
   a. If non-mutual: swipe recorded, card advances
   b. If mutual + partner available: video_sessions row created → ReadyGateOverlay appears
   c. If mutual + partner busy: match queued → toast
9. ReadyGateOverlay: 30s countdown, both tap "Ready"
   → useReadyGate detects both_ready via Realtime
   → navigate to /date/:sessionId
10. VideoDate page:
    → useVideoCall creates Daily.co room, joins call
    → Phase 1 (Handshake): 60s timer, blur 20→0 over 10s, audio clear from 0s
    → VibeCheckButton: visible from start, glows at 40s
    → If both tap Vibe: MutualVibeToast → Phase 2 (Date): 300s, full video
    → Credits can extend: +2min (Extra Time), +5min (Extended Vibe)
    → Call ends → PostDateSurvey
11. PostDateSurvey: 3 screens
    → Screen 1 (mandatory): Did you vibe? → calls check_mutual_vibe_and_match RPC
    → Screen 2 (optional): Highlight tags
    → Screen 3 (optional): Safety/report
    → If mutual vibe: persistent match created → MutualMatchCelebration
12. User returns to lobby (if event active) or goes to /matches
13. Match appears in /matches tab → tap → /chat/:id → real-time messaging
```

### Flow 2: Daily Drop

```
1. generate-daily-drops Edge Function runs (scheduled or manual)
   → Pairs users based on affinity_score, pick_reasons
   → Creates daily_drops row with status='active_unopened'
2. User opens Matches tab → Drops tab shows drop with partner preview
3. User taps to view → markViewed() → status='active_viewed'
4. One user sends opener (max 140 chars) → sendOpener() → status='active_opener_sent'
5. Partner sees opener → sends reply → sendReply()
   → CLIENT-SIDE: creates match, inserts opener+reply as messages, updates drop status='matched'
   → (TO BE FIXED: this should be one atomic server action)
6. Chat unlocked → both users can message in /chat/:matchId
7. If no action: drop expires based on expires_at
```

### Flow 3: Auth → Onboarding

```
1. User visits /auth → signs up with email/password (or signs in)
2. After auth: checks profile completeness (gender, photos)
3. If incomplete → /onboarding (multi-step)
   → Step 1: Name, DOB
   → Step 2: Gender, Interested In
   → Step 3: Photos (minimum 1)
   → Step 4: Location (auto-detect via geocode Edge Function)
   → Step 5: Vibes (select from vibe_tags)
   → Step 6: Bio/Prompts
   → createProfile() via profileService
4. Onboarding complete → /dashboard
```

---

# 19. ADMIN SYSTEM

### Access
- Route: `/kaan` (login) → `/kaan/dashboard`
- Server-verified admin check via `has_role(auth.uid(), 'admin')` RPC
- `ProtectedRoute` component with `requireAdmin` prop
- Role stored in `user_roles` table with `app_role` enum

### Admin Dashboard Panels
| Panel | Purpose |
|-------|---------|
| Events | Create, edit, end events. Extend time. View live metrics (active users, in-dates, queue count, match rate, gender ratio). Recurring events. Draft/publish flow |
| Users | View all profiles. Grant credits. Suspend/warn/ban. View verification status |
| Reports | View user reports queue. Review, dismiss, or take action. Admin report summary cards |
| Notifications | View admin notifications (new user, new match, event full, report, suspension). Mark read |
| Metrics | Live event metrics. Post-event analytics (tag distribution, conversation flow, photo accuracy) |
| Verification | Review photo verification selfies. Approve/reject |
| Activity Log | All admin actions logged with timestamps |

---

# 20. KNOWN DEAD CODE / LEGACY SURFACES

| Item | Location | Status |
|------|----------|--------|
| Standalone ReadyGate page | `src/pages/ReadyGate.tsx` at `/ready/:id` | LEGACY — lobby overlay is canonical |
| VibeFeed with mock data | `src/pages/VibeFeed.tsx` at `/vibe-feed` | Uses `mockVibeVideos` — not wired to real data |
| VibeStudio redirect | `src/pages/VibeStudio.tsx` at `/vibe-studio` | Just redirects to `/profile` — dead page |
| face-api.js | `package.json` dependency | 422KB UNUSED — photo verification simplified to selfie capture |
| Legacy FIFO matching | `find_video_date_match` RPC | May still exist alongside swipe system. Was superseded by `handle_swipe` + `get_event_deck` |
| localStorage Daily Drop service | `src/services/vibelyService.ts` | Superseded by `useDailyDrop` hook with real DB |
| videoStorageService | `src/services/videoStorageService.ts` | Legacy Supabase Storage upload. Superseded by Bunny `create-video-upload` |

---

# 21. KEY LIBRARIES AND VERSIONS

Source: `package.json`

### Production Dependencies
```
@hookform/resolvers: ^3.10.0
@radix-ui/* (15+ packages): Various (shadcn/ui primitives)
@supabase/supabase-js: ^2.88.0
@tanstack/react-query: ^5.83.0
canvas-confetti: ^1.9.4
class-variance-authority: ^0.7.1
clsx: ^2.1.1
cmdk: ^1.1.1
date-fns: ^3.6.0
embla-carousel-react: ^8.6.0
face-api.js: ^0.22.2  ← UNUSED, marked for removal
framer-motion: ^12.23.26
input-otp: ^1.4.2
lucide-react: ^0.462.0
next-themes: ^0.3.0
react: ^18.3.1
react-day-picker: ^8.10.1
react-dom: ^18.3.1
react-hook-form: ^7.61.1
react-resizable-panels: ^2.1.9
react-router-dom: ^7.12.0
recharts: ^2.15.4
sonner: ^1.7.4
tailwind-merge: ^2.6.0
tailwindcss-animate: ^1.0.7
vaul: ^0.9.9
zod: ^3.25.76
```

### Dev Dependencies
```
@eslint/js: ^9.32.0
@tailwindcss/typography: ^0.5.16
@types/node: ^22.16.5
@types/react: ^18.3.23
@types/react-dom: ^18.3.7
@vitejs/plugin-react-swc: ^3.11.0
autoprefixer: ^10.4.21
eslint: ^9.32.0
lovable-tagger: ^1.1.13
postcss: ^8.5.6
tailwindcss: ^3.4.17
typescript: ^5.8.3
```

### Not in package.json but used at runtime
- `@daily-co/daily-js` (imported in hooks — may be loaded via CDN or included differently)
- `@sentry/react` (imported in components)
- `posthog-js` (imported in App.tsx)
- `hls.js` (dynamic import in Profile.tsx for HLS playback on non-Safari)

---

# 22. FILE STRUCTURE OVERVIEW

```
vibelymeet/
├── public/                     # Static assets
├── src/
│   ├── App.tsx                 # Root component, routing, providers
│   ├── main.tsx                # React root render
│   ├── index.css               # Global styles, Tailwind, custom CSS vars
│   ├── components/
│   │   ├── ui/                 # shadcn/ui base components (40+ files)
│   │   ├── admin/              # Admin dashboard panels
│   │   ├── arcade/             # Vibe Arcade games (Two Truths, Would Rather, etc.)
│   │   ├── chat/               # Chat components (MessageBubble, VoiceRecorder, etc.)
│   │   ├── events/             # Event components (VenueCard, GuestList, PricingBar, etc.)
│   │   ├── lobby/              # Lobby components (LobbyProfileCard, ReadyGateOverlay, EmptyState)
│   │   ├── matches/            # Match components (DropsTabContent, SwipeableMatchCard)
│   │   ├── notifications/      # Notification components
│   │   ├── premium/            # Premium gates and pills
│   │   ├── safety/             # SafetyHub
│   │   ├── schedule/           # Date scheduling components
│   │   ├── settings/           # Settings components
│   │   ├── vibe-video/         # VibeStudioModal, VibePlayer, VibeVideoThumbnail
│   │   ├── verification/       # Phone, email, photo verification components
│   │   ├── video-date/         # All video date sub-components
│   │   ├── wizard/             # Profile completion wizard
│   │   ├── BottomNav.tsx       # Bottom navigation bar
│   │   ├── ProfileDetailDrawer.tsx
│   │   ├── ProfilePreview.tsx
│   │   ├── ProtectedRoute.tsx
│   │   └── ... (more components)
│   ├── contexts/
│   │   ├── AuthContext.tsx
│   │   └── NotificationContext.tsx
│   ├── hooks/                  # All custom hooks (30+ files)
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts       # Supabase client init
│   │       └── types.ts        # Auto-generated types
│   ├── lib/                    # Utilities (analytics, notifications, photoUtils, etc.)
│   ├── pages/                  # All page components (30+ files)
│   │   ├── admin/              # AdminLogin, AdminDashboard
│   │   └── legal/              # PrivacyPolicy, TermsOfService, DeleteAccountWeb
│   ├── services/               # Service layer (profileService, storageService, etc.)
│   └── types/                  # Shared type definitions (games.ts, dailyDrop.ts)
├── supabase/
│   ├── config.toml             # Edge Function config (JWT requirements)
│   ├── functions/              # All Edge Functions (30+ functions)
│   │   ├── daily-room/
│   │   ├── phone-verify/
│   │   ├── email-verification/
│   │   ├── create-video-upload/
│   │   ├── video-webhook/
│   │   ├── upload-image/
│   │   ├── create-checkout-session/
│   │   ├── stripe-webhook/
│   │   ├── send-notification/
│   │   ├── generate-daily-drops/
│   │   └── ... (more functions)
│   └── migrations/             # All SQL migrations (20+ files)
├── package.json
├── tsconfig.app.json           # TypeScript config (strict: false ← needs fixing)
├── tailwind.config.ts
├── vite.config.ts
├── eslint.config.js
├── components.json             # shadcn/ui config
└── index.html
```

---

# 23. REBUILD NOTES

## If you need to rebuild from scratch:

### Step 1: Code
- Clone from Git tag `v1.0-golden-pre-native` (or restore from ZIP)
- `npm install`
- Create `.env` file with all `VITE_*` variables from Section 14

### Step 2: Supabase
- Create new Supabase project
- Run all migrations from `supabase/migrations/` in order
- Deploy all Edge Functions from `supabase/functions/`
- Set all Edge Function secrets from Section 14 (Edge Functions list)
- Configure Auth providers (Email, Phone/Twilio)
- Create storage buckets: `profile-photos` (public), `vibe-videos` (private), `proof-selfies` (private)
- Insert admin user role: `INSERT INTO user_roles (user_id, role) VALUES ('<admin-uuid>', 'admin')`
- Seed vibe_tags table with tag data

### Step 3: Third-Party Services
- **Daily.co:** Create account, get API key, set in Supabase secrets
- **Stripe:** Create account, set up products/prices, configure webhook to point at `stripe-webhook` Edge Function URL, set keys in Supabase secrets
- **Twilio:** Create account, set up Verify service, set credentials in Supabase secrets
- **Resend:** Create account, verify sending domain, set API key in Supabase secrets
- **Bunny.net:** Create account, create Stream library, create Storage zone + Pull Zone + Optimizer, set credentials in Supabase secrets and `.env`
- **OneSignal:** Create account and app, set credentials in Supabase secrets and `.env`
- **PostHog:** Create project, set key/host in `.env`
- **Sentry:** Create project, set DSN in `.env`

### Step 4: Deploy
- Connect to Lovable (or deploy via Vite build to any static host)
- Configure custom domain
- Verify all flows with seed test data

### Critical Gotchas
1. Supabase migrations must run in chronological order
2. Some migrations may conflict if schema has drifted — check for `IF NOT EXISTS` guards
3. Edge Function secrets are NOT in the repo — must be set manually in Supabase dashboard
4. Stripe products/prices are configured in Stripe dashboard, not in code — IDs are referenced in Edge Functions
5. Bunny Stream library ID and CDN hostname must match Edge Function config
6. Auth redirect URLs must be updated if domain changes
7. OneSignal app ID in frontend must match backend config
8. The `user_roles` table must have at least one admin user seeded manually

---

# END OF SNAPSHOT

This document, combined with the tagged Git repository ZIP, provides sufficient information to reconstruct the complete Vibely application from scratch. The most critical non-code artifacts to preserve separately are: Supabase Edge Function secrets, Stripe product/price configurations, and third-party service account credentials.
