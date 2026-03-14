# Native screen contract map

Map of every native-v1 screen to web source, native route, hooks/services, RPCs/Edge Functions/realtime, platform adapters, and parity priority. Web is the product/design source of truth.

**Conventions:** Web route and component from `src/App.tsx` and `src/pages/`. Native route from `apps/mobile` Expo Router (file-based). Priority: **P0** = required for v1, **P1** = first follow-up, **P2** = deferred.

---

## Auth and shell

| Web route | Web component | Native route | Hooks / services | RPCs / Edge / Realtime | Platform adapters | Parity priority |
|----------|---------------|--------------|------------------|------------------------|-------------------|-----------------|
| `/` | `Index` | `app/index.tsx` | `useAuth` (AuthContext) | — | — | P0 |
| `/auth` | `Auth` | `app/(auth)/sign-in`, `sign-up` | `useAuth` | Supabase auth | — | P0 |
| `/reset-password` | `ResetPassword` | `app/(auth)/reset-password` | — | Supabase auth | — | P0 |
| `/onboarding` | `Onboarding` | `app/(onboarding)/index` | — | `profiles` insert/update, `user_credits` upsert; storageService (photos) | — | P0 |
| `/dashboard`, `/home` | `Dashboard` | `app/(tabs)/index` | useNextRegisteredEvent, useEvents, useRealtimeEvents, useDashboardMatches, useSchedule, useDateReminders, usePushNotifications, useNotifications, useUserProfile, useOtherCityEvents, useDeletionRecovery | video_sessions update, event_registrations update; realtime events | OneSignal (push) | P0 |

---

## Events and lobby

| Web route | Web component | Native route | Hooks / services | RPCs / Edge / Realtime | Platform adapters | Parity priority |
|----------|---------------|--------------|------------------|------------------------|-------------------|-----------------|
| `/events` | `Events` | `app/(tabs)/events/index` | useVisibleEvents, useOtherCityEvents, useUserProfile | geocode (EF), profiles update (location_data) | — | P0 |
| `/events/:id` | `EventDetails` | `app/(tabs)/events/[id]` | useEventDetails, useEventAttendees, useIsRegisteredForEvent, useRegisterForEvent, useRealtimeEvents, useEventVibes, useSubscription | — | — | P0 |
| `/event/:eventId/lobby` | `EventLobby` | `app/event/[eventId]/lobby` | useEventDetails, useIsRegisteredForEvent, useEventDeck, useSwipeAction, useEventStatus, useMatchQueue | get_event_deck (RPC), swipe-actions (EF), update_participant_status (RPC), drain_match_queue (RPC) | — | P0 |

---

## Matches and chat

| Web route | Web component | Native route | Hooks / services | RPCs / Edge / Realtime | Platform adapters | Parity priority |
|----------|---------------|--------------|------------------|------------------------|-------------------|-----------------|
| `/matches` | `Matches` | `app/(tabs)/matches/index` | useMatches, useDropMatches, useUndoableUnmatch, useArchiveMatch, useBlockUser, useMuteMatch, useUserProfile, useSubscription | matches select; daily_drops via useDropMatches; send-message not used on list | RevenueCat (entitlements) | P0 |
| `/chat/:id` | `Chat` | `app/chat/[id]` | useRealtimeMessages, useMessages, useSendMessage, useUserProfile, useMatchCall; voiceUploadService, chatVideoUploadService | send-message (EF); realtime `messages` | — | P0 |

---

## Profile and settings

| Web route | Web component | Native route | Hooks / services | RPCs / Edge / Realtime | Platform adapters | Parity priority |
|----------|---------------|--------------|------------------|------------------------|-------------------|-----------------|
| `/profile` | `Profile` | `app/(tabs)/profile/index` | persistPhotos / uploadImage (upload-image EF), useLogout, usePremium; vibe video (create-video-upload, delete-vibe-video) | profiles update; upload-image (EF); create-video-upload, video-webhook, delete-vibe-video (EF) | — | P0 |
| `/settings` | `Settings` | `app/settings` | useLogout, useDeleteAccount, useCredits, usePremium | account-pause, account-resume (EF); delete-account (EF); notification_preferences; create-checkout-session (EF) | OneSignal | P0 |

---

## Video date and Ready Gate

| Web route | Web component | Native route | Hooks / services | RPCs / Edge / Realtime | Platform adapters | Parity priority |
|----------|---------------|--------------|------------------|------------------------|-------------------|-----------------|
| `/date/:id` | `VideoDate` | `app/date/[id]` | useVideoCall, useCredits, useReconnection, useAuth, useUserProfile, useEventStatus | daily-room (EF), video_date_transition (RPC), leave_matching_queue (RPC) | Daily | P0 |
| `/ready/:id` | `ReadyRedirect` (Ready Gate) | `app/ready/[id]` | useReadyGate, useUserProfile, useEventStatus | ready_gate_transition (RPC) | — | P0 |

---

## Daily Drop and premium

| Web route | Web component | Native route | Hooks / services | RPCs / Edge / Realtime | Platform adapters | Parity priority |
|----------|---------------|--------------|------------------|------------------------|-------------------|-----------------|
| (Matches tab / Drops) | DropsTabContent (Matches) | `app/daily-drop` | useDailyDrop (daily_drop_transition, daily-drop-actions) | daily_drop_transition (RPC), daily-drop-actions (EF) | — | P0 |
| `/premium` | `Premium` | `app/premium` | useBackendSubscription, RevenueCat (offerings, purchase, restore) | revenuecat-webhook (EF); subscriptions + profiles.is_premium | RevenueCat | P0 (hard blocker) |

---

## Public profile and match celebration (Sprint 4)

| Web route | Web component | Native route | Notes |
|-----------|---------------|--------------|--------|
| `/user/:userId` | UserProfile | `app/user/[userId]` | Public profile; entry from chat "View profile". |
| `/match-celebration` | MatchCelebration | `app/match-celebration` | Shown when opening unread match; "Message" → chat. |

---

## Deferred / web-only (no native route or link-out only)

| Web route | Web component | Native | Notes |
|-----------|---------------|--------|--------|
| Vibe video | (profile) | `app/(tabs)/profile/index` + record flow | In v1: create-video-upload, tus, delete-vibe-video (EF); record, upload, state, delete |
| `/schedule` | Schedule | Web handoff (explicit) | Profile card "My Vibe Schedule" → open vibelymeet.com/schedule |
| `/credits`, `/credits/success` | Credits, CreditsSuccess | Native pack selection + create-credits-checkout → Stripe in browser | Balance native; payment opens Stripe URL; success/cancel on web |
| `/subscription/success`, `/subscription/cancel` | SubscriptionSuccess, SubscriptionCancel | Web / in-app browser | RevenueCat handles natively |
| `/event-payment/success` | EventPaymentSuccess | Web / link-out | Stripe callback |
| `/how-it-works`, `/privacy`, `/terms`, `/delete-account`, `/community-guidelines` | HowItWorks, legal pages | Web-only; link out | No native duplication |
| `/admin/create-event`, `/kaan`, `/kaan/dashboard` | AdminCreateEvent, AdminLogin, AdminDashboard | Web-only | Admin stays web |

---

## Summary

- **P0 (native v1):** Auth, onboarding, dashboard, events list/detail, event lobby, matches, chat, profile (including profile photo upload and vibe video), settings, Ready Gate, video date, Daily Drop, premium (RevenueCat + backend; hard blocker).
- **P1:** Credits full UX, optional schedule.
- **Sprint 4:** Public profile (`/user/:userId`), match celebration (unread → celebration → chat), credits (pack selection + checkout URL). Schedule remains web handoff with explicit copy.
- **P2 / web-only:** Legal/marketing content, admin.

See `docs/native-backend-contract-matrix.md` for RPC/EF details and `docs/native-platform-adapter-matrix.md` for adapters (RevenueCat, OneSignal, Daily, Bunny, Supabase).
