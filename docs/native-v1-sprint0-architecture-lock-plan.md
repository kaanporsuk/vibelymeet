# Vibely Native v1 Sprint 0: Architecture Lock and Implementation Plan

Date: 2026-04-04
Status: Locked planning baseline for implementation start
Owner stream: Native v1

## Locked assumptions
- Events stream is closed; backend-owned event flow is canonical.
- Native app lives in apps/mobile and shares the same backend as web.
- No separate mobile backend.
- RevenueCat = native payments, OneSignal = notifications, Daily = video, Bunny = media, Supabase = auth/data.
- This pass is planning-only: no native builds.

---

## A. Native screen map (web -> native v1)

### In-scope v1 screen map

| Product area | Web route(s) | Native route(s) | Source status |
|---|---|---|---|
| Auth sign in/up | /auth | /(auth)/sign-in, /(auth)/sign-up | Present |
| Reset password | /reset-password | /(auth)/reset-password | Present |
| Onboarding | /onboarding | /(onboarding)/index | Present |
| Dashboard/home | /dashboard, /home | /(tabs)/index | Present |
| Events list | /events | /(tabs)/events/index | Present |
| Event details | /events/:id | /(tabs)/events/[id] | Present |
| Event lobby | /event/:eventId/lobby | /event/[eventId]/lobby | Present |
| Matches list | /matches | /(tabs)/matches/index | Present |
| Chat thread | /chat/:id | /chat/[id] | Present |
| Ready Gate | /ready/:id | /ready/[id] | Present |
| Video date | /date/:id | /date/[id] | Present |
| Post-date survey | (embedded in video date) | components/video-date/PostDateSurvey.tsx used by /date/[id] | Present |
| Profile | /profile | /(tabs)/profile/index | Present |
| Settings | /settings | /settings (stack) | Present |
| Verification in onboarding/profile | profile + onboarding surfaces | /(onboarding)/index, /(tabs)/profile/index, /settings/account, /settings/notifications | Present |

### Explicitly deferred for this v1 plan
- Match celebration
- Public profile
- Referrals/growth surfaces
- Full premium/credits UX (native can keep current minimal behavior)
- Vibe studio full parity
- Vibe feed
- Schedule/calendar
- Delete-account full native UX unless compliance-critical

---

## B. Navigation structure (locked)

### Root navigation
- Keep Expo Router file-based architecture.
- Root stack in apps/mobile/app/_layout.tsx remains the app shell and non-tab modal/fullscreen routes.

### Route groups
- (auth): sign-in, sign-up, reset-password.
- (onboarding): onboarding flow.
- (tabs): index, events, matches, profile.

### Non-tab full-screen flows
- /event/[eventId]/lobby
- /chat/[id]
- /ready/[id]
- /date/[id]
- /settings/*
- /premium and payment-result adjunct screens already present

### Navigation rules to lock now
1. Dashboard and tab surfaces never directly mutate domain state; they route and call APIs only.
2. Event flow progression order: events list -> details -> lobby -> ready -> date -> survey -> lobby/events.
3. Terminal route behavior:
   - Ready Gate timeout/forfeit returns to lobby if event context exists, else tabs home.
   - Date end always exits through post-date survey handler, then returns to event lobby or tabs fallback.
4. Keep deep-link-safe route params:
   - ready/id = video session id
   - date/id = video session id
   - chat/id = peer profile id (current native convention)

---

## C. Backend contract map by screen

### Auth and onboarding
- Screens:
  - /(auth)/sign-in, /(auth)/sign-up, /(auth)/reset-password, /(onboarding)/index
- Contracts:
  - Supabase Auth
  - profiles table create/update
  - user_credits bootstrap writes (where onboarding uses them)
  - upload-image edge function (profile media)

### Dashboard/home
- Screen:
  - /(tabs)/index
- Contracts:
  - events/discovery reads
  - registrations and active-session checks
  - notification preference reads
  - no server-state business transitions outside explicit user actions

### Events list and details
- Screens:
  - /(tabs)/events/index, /(tabs)/events/[id], /event-payment-success
- Contracts:
  - get_visible_events RPC
  - get_other_city_events RPC
  - events table reads
  - event_registrations registration/unregistration
  - create-event-checkout edge function (where still used)
  - admission status truth read from event_registrations

### Event lobby
- Screen:
  - /event/[eventId]/lobby
- Contracts:
  - get_event_deck RPC
  - swipe-actions edge function -> handle_swipe RPC
  - drain_match_queue RPC
  - update_participant_status RPC
  - mark_lobby_foreground RPC
  - realtime: event_registrations + video_sessions + events

### Ready Gate
- Screen:
  - /ready/[id], plus overlay usage from lobby
- Contracts:
  - ready_gate_transition RPC only
  - video_sessions realtime updates

### Video date and reconnect
- Screen:
  - /date/[id]
- Contracts:
  - daily-room edge function
  - video_date_transition RPC (enter_handshake, vibe, complete_handshake, end, reconnect actions)
  - update_participant_status RPC for in_survey/browsing handoff

### Post-date survey
- Surface:
  - components/video-date/PostDateSurvey.tsx from /date/[id]
- Contracts:
  - post-date-verdict edge function (where used)
  - date feedback writes
  - queue drain re-entry path and lobby return

### Matches and chat
- Screens:
  - /(tabs)/matches/index, /chat/[id]
- Contracts:
  - matches table + moderation actions
  - send-message edge function
  - realtime messages
  - media upload contracts (upload-voice, upload-chat-video)

### Profile and settings
- Screens:
  - /(tabs)/profile/index, /settings/*
- Contracts:
  - profiles updates
  - profile_vibes and related profile tables
  - notification_preferences (OneSignal ids and preference flags)
  - account-pause / account-resume edge functions
  - revenuecat-webhook-backed entitlement reads + native RevenueCat SDK purchase side

---

## D. Shared vs native-only state ownership

### Backend-owned state (authoritative)
- Auth/session validity
- Profile completeness and verification status
- Event registration/admission status (confirmed/waitlisted)
- Event lobby participant status and presence semantics
- Deck eligibility and swipe outcomes
- Queue/match activation and ready-gate transitions
- Video date lifecycle and reconnect grace
- Message creation and persistence
- Entitlements/subscription effective state
- Notification preference and target IDs

### Shared client state opportunities (web + native aligned contracts)
1. Shared domain contracts in shared package
   - swipe result/session-id extraction
   - pending session URL/param helpers
   - verdict/result enums
2. Shared query key conventions for event/match/date domains
3. Shared error code to UX-message mapping for edge functions

### Native-only state (UI/process only)
- Local animation/transition flags
- In-progress form state
- Local camera/mic permission state
- Temporary draft content and outbox queue
- Device-level push permission prompts

### Ownership rule
- Native state can cache, decorate, and stage input.
- Native state cannot invent, override, or finalize business transitions outside server contracts.

---

## E. Risk register (implementation-critical)

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Route semantic drift between web and native flow exits | High | Medium | Lock route transition matrix in this doc and enforce via PR checklist |
| RevenueCat entitlement mismatch with backend flags | High | Medium | Add explicit entitlement reconciler test cases and webhook verification checklist |
| OneSignal mobile player-id registration gaps | High | Medium | Enforce login-time sync and preference write contract in settings/account QA matrix |
| Daily RN runtime instability (permissions, reconnect, background) | High | Medium | Keep reconnect server-owned; add dedicated date-flow manual matrix before each release |
| Bunny upload reliability on mobile networks | Medium | Medium | Keep resumable upload path and explicit retry/error UX states |
| Realtime channel misses on mobile suspend/resume | Medium | Medium | Preserve polling fallbacks in Ready Gate/date/lobby hooks |
| Hidden direct client writes reintroduced in native | High | Medium | Add lint/audit rule in PR template: no queue/date state writes outside RPC/EF transitions |
| Over-scoping deferred surfaces into v1 | Medium | High | Strict sprint backlog boundaries with deferred list frozen |

---

## F. Sprint backlog for Cursor (recommended)

### Sprint 1 (foundation + auth/onboarding + shell)
1. Lock navigation contracts and route transition map tests/checklist.
2. Harden auth + reset + onboarding parity against web required fields and completion gates.
3. Standardize shared API adapters in apps/mobile/lib for:
   - auth/profile
  - events read models
   - contract error normalization
4. Validate OneSignal lifecycle:
   - init
   - permission flow
   - backend sync for mobile player id
5. Validate RevenueCat init/login/offerings baseline and backend entitlement read path.
6. Ship dashboard shell readiness with no new business logic divergence.

### Sprint 2 (events core path)
1. Events list/detail parity pass (filters, registration truth, payment-success truth messaging).
2. Event lobby production pass:
   - entry guards
   - deck empty states
   - repeat-card protection
   - queue drain behavior
3. Ready Gate pass:
   - terminal dedupe
   - timeout/forfeit/snooze correctness
   - return-path CTAs
4. Contract audit gate before merge: verify only server-owned transitions used.

### Sprint 3 (matches/chat/date and closure)
1. Matches list + chat thread parity for active path.
2. Video date end-to-end hardening on native:
   - enter handshake
   - reconnect grace
   - terminal end
   - post-date survey return flow
3. Cross-surface UX closure for terminal states and fallback navigation.
4. Release readiness pack:
   - native runbook updates
   - blocker matrix update
   - final parity audit checklist execution

---

## G. Exact first implementation branch recommendation

Recommended first branch:
- native/v1-sprint1-architecture-lock-auth-onboarding-shell

Rationale:
- Starts with highest-leverage scaffolding and contract locks.
- Keeps events/date risk out of first implementation branch while preserving momentum.
- Creates a clean base for Sprint 2 events path and Sprint 3 date/chat closure.

---

## Cursor execution guardrails
- Do not introduce a separate mobile backend path.
- Do not bypass backend-owned contracts with direct state writes for queue/date/match lifecycle.
- Preserve web behavior for shared backend contracts.
- Keep deferred items out of implementation branches unless explicitly promoted by owner decision.
