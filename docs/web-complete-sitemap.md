# Vibely Web App — Complete Sitemap & UX Specification

> Generated from `src/App.tsx`, all files under `src/pages/`, and traced through `src/components/`.  
> **Note:** `src/pages/ReadyGate.tsx` (full-page ready gate) is **not** mounted in the router; `/ready/:id` uses `ReadyRedirect` instead.  
> **Note:** `ArchiveMatchDialog`, `BlockUserDialog`, and `MuteOptionsSheet` on Matches are rendered but **no UI path sets** `archiveTarget` / `blockTarget` / `muteTarget` — dialogs exist for future use.

---

## SECTION 1: ROUTE MAP

| Route | Component | Auth | Layout | Page title (browser) |
|-------|-----------|------|--------|----------------------|
| `/` | `Index` | Public | Full-screen marketing | `Vibely — Live Video Dating` (index.html) |
| `/auth` | `Auth` | Public | Centered form | Same |
| `/reset-password` | `ResetPassword` | Public | Centered form | Same |
| `/onboarding` | `Onboarding` | Protected + onboarding OK | Full-screen wizard | Same |
| `/dashboard` | `Dashboard` | Protected | BottomNav + PullToRefresh | Same |
| `/home` | `Dashboard` (alias) | Protected | Same | Same |
| `/events` | `Events` | Protected | BottomNav | Same |
| `/events/:id` | `EventDetails` | Protected | Sticky bars, scroll | Same |
| `/event/:eventId/lobby` | `EventLobby` | Protected | No BottomNav | Same |
| `/matches` | `Matches` | Protected | BottomNav + PullToRefresh | Same |
| `/chat/:id` | `Chat` | Protected | Full viewport chat | Same |
| `/profile` | `Profile` | Protected | BottomNav | Same |
| `/settings` | `Settings` | Protected | BottomNav | Same |
| `/settings/referrals` | `Referrals` | Protected | BottomNav | Same |
| `/date/:id` | `VideoDate` | Protected | Full-screen video | Same |
| `/ready/:id` | `ReadyRedirect` → redirects | Protected | — | Same |
| `/admin/create-event` | `AdminCreateEvent` | Protected + **admin** | Admin form | Same |
| `/match-celebration` | `MatchCelebration` | Protected | Demo modal page | Same |
| `/vibe-studio` | `VibeStudio` | Protected | Dedicated Vibe Video studio surface | Same |
| `/schedule` | `Schedule` | Protected | BottomNav | Same |
| `/how-it-works` | `HowItWorks` | Public | BottomNav | Same |
| `/privacy` | `PrivacyPolicy` | Public | Scroll legal | Same |
| `/terms` | `TermsOfService` | Public | Scroll legal | Same |
| `/delete-account` | `DeleteAccountWeb` | Public | Web delete info | Same |
| `/community-guidelines` | `CommunityGuidelines` | Public | Scroll legal | Same |
| `/premium` | `Premium` | Public (Stripe) | Full-screen | Same |
| `/subscription/success` | `SubscriptionSuccess` | Public | Success | Same |
| `/subscription/cancel` | `SubscriptionCancel` | Public | Cancel | Same |
| `/event-payment/success` | `EventPaymentSuccess` | Protected | Success + confetti | Same |
| `/credits` | `Credits` | Protected | BottomNav | Same |
| `/credits/success` | `CreditsSuccess` | Protected | Success | Same |
| `/user/:userId` | `UserProfile` | Protected | Back overlay | Same |
| `/kaan` | `AdminLogin` | Public | Admin login | Same |
| `/kaan/dashboard` | `AdminDashboard` | Protected + admin, **no onboarding gate** | Admin shell | Same |
| `*` | `NotFound` | Public | 404 | Same |

**Global app shell (all routes):** `QueryClientProvider` → `AuthProvider` → `NotificationProvider` → `TooltipProvider` → `Toaster` (shadcn) → `Sonner` (top-center, dark) → `OfflineBanner` → `Sentry.ErrorBoundary` → `BrowserRouter` → `PostHogPageTracker` (`$pageview`) → `AppContent` (heartbeat + bootstrap) → `NotificationContainer` → `NotificationManager` → `PushPermissionPrompt`.

---

## SECTION 2: SCREEN-BY-SCREEN BREAKDOWN

### Screen: Landing (Index)
- **Route:** `/`
- **File:** `src/pages/Index.tsx`
- **Layout:** Plain (no BottomNav)

**Entry points:** Direct URL; logged-out users only (authenticated users are redirected to `/dashboard`).

**States:**
| State | Renders |
|-------|---------|
| Loading auth | Brief null while `useAuth` loads, then redirect if authed |
| Logged out | Aurora bg, Sign In (top-right), logo, “Vibely”, tagline, description, Get Started → `/auth?mode=signup`, “How does Vibely work?” → `/how-it-works`, footer Terms/Privacy links (new tab) |

**Forms:** None.

**Realtime:** None.

---

### Screen: Auth
- **Route:** `/auth`?`mode=signup`|`signin`
- **File:** `src/pages/Auth.tsx`

**Entry points:** Index CTAs, redirect from protected routes, referral `?ref=` (stored in `localStorage` as `vibely_referrer_id`).

**States:**
| State | Renders |
|-------|---------|
| Sign in | Email, password, Sign In, Forgot password → `/reset-password`, toggle to sign up, Terms/Privacy |
| Sign up | + Name field, Create Account |
| Success (post sign-in) | Green check, “Welcome!”, auto-navigate `/dashboard` after 1.5s |
| Error | Inline red message under form |
| Loading | Spinner in submit button |

**On authenticated:** Profile check → `/onboarding` if incomplete (`gender` missing/`prefer_not_to_say` or **&lt;2 photos**) else `/dashboard`.

**Toasts:** Sign up success → “Account created! Check your email to confirm.” then mode → signin.

**Analytics:** `login` { method: email }; `signup_completed` { method: email }.

---

### Screen: Onboarding
- **Route:** `/onboarding`
- **File:** `src/pages/Onboarding.tsx`
- **Layout:** Fixed progress header, bottom CTA

**Steps (0–7, 8 total):** Welcome → Identity → Location → Details (height, job) → About Me → Vibes + Lifestyle → Looking For → Photos + optional Vibe Video.

**States:**
| State | Renders |
|-------|---------|
| Age &lt; 18 after step 1 | Full-screen shield: “You must be 18 or older”, “Close App” → sign out + clear storage + `/` |
| Per step | `ProgressBar`, back chevron (step &gt; 0), step content |
| Submitting final | “Creating Profile…” spinner |
| Photo upload partial fail | Toast “Some photos failed to upload…” |

**Navigation:** “Record Vibe” → `/vibe-studio` (dedicated studio page; recording still uses `VibeStudioModal`, but management now lives on the route itself).

**Toasts:** Location OK/error, photo added, welcome, profile error.

**Forms:** Many fields; final submit → `createProfile` + `user_credits` upsert.

**Analytics:** `onboarding_completed` { has_photo, has_bio, has_vibes, vibe_count }.

---

### Screen: Referrals
- **Route:** `/settings/referrals`
- **File:** `src/pages/Referrals.tsx`

**Entry points:** Settings, Matches invite banner, Profile Studio invite card.

**States:**
| State | Renders |
|-------|---------|
| Loading status | Referral status card shows loading copy |
| No inviter linked | Share + copy CTA, "No invite linked yet" guidance |
| Existing inviter linked | Share + copy CTA, existing `referred_by` visibility |

**Behavior:** Uses canonical `https://vibelymeet.com/invite?ref=` links, preserves existing `/invite` redirect flow, and surfaces current `profiles.referred_by` status.

---

### Screen: Dashboard
- **Route:** `/dashboard`, `/home`
- **File:** `src/pages/Dashboard.tsx`

**Layout:** `PullToRefresh` → header → main → `BottomNav`.

**Entry points:** Post-auth, tab Home (`/home` — **note:** `/dashboard` URL does not highlight Home tab; tab links to `/home`).

**Data hooks:** `useRealtimeEvents`, `useNextRegisteredEvent`, `useEvents`, `useDashboardMatches`, `useSchedule`, `useDateReminders`, `usePushNotifications`, `useNotifications`, `useOtherCityEvents`, `useDeletionRecovery`.

**States:**
| State | Renders |
|-------|---------|
| Loading | Skeletons for event card, match avatars, event rail |
| Active video session | `ActiveCallBanner`: Rejoin → `/date/:sessionId`, End → ends session + clears registration queue |
| Pending deletion | `DeletionRecoveryBanner` + cancel |
| Phone not verified | `PhoneVerificationNudge` wizard variant (dismiss → localStorage) |
| Imminent date reminders | `DateReminderCard` rows; Join prefers **`/date/:id`** when an active `in_handshake`/`in_date` session is known, otherwise falls back to **`/schedule`**; enable notifications opens flow |
| Live + registered | Big “Live Now” card, Enter Lobby → `/event/:id/lobby` |
| Next event (not live) | Countdown, tap card → `/events/:id`, “View & Register” if not registered |
| No next event | “No upcoming events”, Browse Events |
| Premium nudge | Other cities card → `/events` (“Go Premium”) |
| Matches row | Horizontal avatars → `/chat/:matchId`; empty → copy + Browse Events |
| Discover rail | Cards → `/events/:id` |

**Modals:** `NotificationPermissionFlow` (bell in header).

**Header:** `DashboardGreeting`, optional `MiniDateCountdown` → `/schedule`, notification button, avatar → `/profile`.

---

### Screen: Events (Discover)
- **Route:** `/events`
- **File:** `src/pages/Events.tsx`

**States:**
| State | Renders |
|-------|---------|
| No `location_data` on profile | `LocationPromptBanner`: Enable / Not now; toast on success/error |
| Loading | Featured + rail skeletons |
| Filtering | Search + `EventsFilterBar`; grid of `EventCardPremium` or empty “No events found” |
| Default | Featured card, rails: Live Now, Near You, Global, Region; empty → premium CTA; `HappeningElsewhere` (blurred cities) — **“Explore with Premium” button has no `onClick`** in code |

---

### Screen: Event Details
- **Route:** `/events/:id`
- **File:** `src/pages/EventDetails.tsx`

**States:**
| State | Renders |
|-------|---------|
| Loading | Center spinner |
| Error / missing | “Event not found”, Back to Events |
| Loaded | Parallax hero, back/share, category, vibe match %, date/time, phone nudge if not registered & not verified, scope lines, tags, description, guest teaser OR roster (if registered), mutual vibes, venue, bottom bar |

**Registered:** “You’re In!”, Manage Booking → `ManageBookingModal` → Cancel → `CancelBookingModal`.

**Not registered:** `PricingBar` → free: direct register; paid: `PaymentModal` (Stripe); premium-only event without sub → toast + `/premium`.

**Modals:** `MiniProfileModal`, `ProfileDetailDrawer` (full attendee), `TicketStub` after register, `PaymentModal`, `ManageBookingModal`, `CancelBookingModal`.

**Toasts:** Register success/fail, cancel success/fail, share copy.

**Analytics:** `event_viewed`, `event_registered`.

---

### Screen: Event Lobby
- **Route:** `/event/:eventId/lobby`
- **File:** `src/pages/EventLobby.tsx`

**Guards:** If event not live window or not registered → toast + redirect to `/events/:eventId`.

**States:**
| State | Renders |
|-------|---------|
| Loading | Spinner |
| Deck loading | Card skeleton |
| Empty deck | `LobbyEmptyState` + refresh |
| Cards | Stack swipe, Pass / Super Vibe / Vibe buttons |
| Match | `ReadyGateOverlay` |

**Realtime:** Supabase channel `lobby-match-{eventId}-{userId}` on `event_registrations` UPDATE for own row → opens ready gate when `in_ready_gate`.

**Header:** Back → `/dashboard`, title, LIVE pill, timer, `PremiumPill`.

**Analytics:** `lobby_entered`.

**Swipe toasts (via `useSwipeAction`):** match queued, super vibe sent, no credits, limit reached, offline/error.

**Analytics per swipe:** `swipe` { event_id, swipe_type, result }.

---

### Screen: Ready Gate (overlay, in-lobby)
- **Component:** `src/components/lobby/ReadyGateOverlay.tsx`
- **Trigger:** Match from lobby (immediate or queue) or `?pendingMatch=` cleared from URL.

**Flow:** Both ready → `navigate(/date/:sessionId)`; forfeit → toast, `onClose`, back to browsing.

---

### Screen: Video Date
- **Route:** `/date/:id` (`id` = video session UUID)
- **File:** `src/pages/VideoDate.tsx`

**Phases:** Handshake (60s default) → Date (300s) → ended.

**UI blocks:** `HandshakeTimer`, `IceBreakerCard`, Daily.co iframe via `useVideoCall` (`daily-room` edge function), `SelfViewPIP`, `ConnectionOverlay`, `PartnerProfileSheet`, `PostDateSurvey`, extensions (`KeepTheVibe`, credits), `ReconnectionOverlay`, `MutualVibeToast`, etc.

**Toasts:** Permissions, reconnection, partner left, credit usage.

**Analytics:** `video_date_started`, `video_date_extended`, `credit_used`, `video_date_ended`.

---

### Screen: Matches
- **Route:** `/matches`
- **File:** `src/pages/Matches.tsx`

**Tabs:** Chat | Daily Drop (`DropsTabContent`).

**Chat tab — Premium:** `NewVibesRail` → tap → `/chat/:id`.

**Chat tab — Free with new matches:** `WhoLikedYouGate` (blur upgrade).

**List:** `SwipeableMatchCard` — swipe right profile drawer, left unmatch → `UnmatchDialog` (option Report → `ReportWizard` sheet).

**Search + sort** dropdown when matches exist.

**Empty:** `EmptyMatchesState` + optional `PhoneVerificationNudge` empty variant.

**Daily Drop tab:** See Drops states below.

**PullToRefresh:** Refetches matches.

---

### Screen: Daily Drop (embedded in Matches)
- **Component:** `src/components/matches/DropsTabContent.tsx`
- **Hook:** `useDailyDrop`

**States (summary):** loading; no drop today; teaser unopened; viewed send opener; waiting reply; reply phase; chat unlocked → “Start Chatting” → `/chat/:matchId`; passed; expired; past drops accordion.

---

### Screen: Chat
- **Route:** `/chat/:id` (**id = match id** in app routes)
- **File:** `src/pages/Chat.tsx`

**Realtime:** `useRealtimeMessages` on match.

**States:**
| State | Renders |
|-------|---------|
| Loading chat | Spinner |
| Empty thread | Match celebration empty state, “Send a Wave 👋” |
| Messages | Text (`MessageBubble` + persisted `message_reactions`), voice (server `send-message`), legacy generic video + **Vibe Clip** (`VibeClipBubble`), game bubbles, date cards, `DateProposalTicket`, typing indicator — see `docs/chat-video-vibe-clip-architecture.md` |

**Composer:** Textarea, Send, `VoiceRecorder`, video clip button → `VideoMessageRecorder` overlay, calendar → `VibeSyncModal`, gamepad → `VibeArcadeMenu` + creators (2 truths, would rather, charades, scavenger, roulette, intuition).

**Date keyword chip:** `DateSuggestionChip` → sends video invite message.

**Calls:** `IncomingCallOverlay` / `ActiveCallOverlay` (`useMatchCall` — separate from event Daily dates).

**Toasts:** Offline send, errors, game sent, voice/video errors.

---

### Screen: Profile
- **Route:** `/profile`
- **File:** `src/pages/Profile.tsx` (thin wrapper) -> `src/pages/ProfileStudio.tsx` (implementation)

**Layout:** `/profile` delegates to Profile Studio. The full edit surface (BottomNav, drawers, `ProfileWizard`, `SafetyHub`, `VibeStudioModal`, verification/photo flows, fullscreen playback/preview) is implemented in `src/pages/ProfileStudio.tsx`.

**States:** Loading profile; saving; premium crown; verification flows. **Safety Hub** (in-profile) hosts **Report**, **PauseAccountFlow**, emergency resources, etc.

**Analytics (dynamic import):** `vibe_video_uploaded` on upload.

---

### Screen: Settings
- **Route:** `/settings`
- **File:** `src/pages/Settings.tsx`

**Sections:** `PremiumSettingsCard`, Credits → `/credits`, Notifications drawer, Privacy drawer (switches — **client-only state**, toast on toggle), Account drawer (`AccountSettingsDrawer`: email/password/phone), How it works, Feedback drawer, Privacy/Terms links, Log out confirm, Delete account → `DeleteAccountModal` (multi-step: warning → reason → type DELETE).

---

### Screen: Schedule
- **Route:** `/schedule`
- **File:** `src/pages/Schedule.tsx`

**Content:** `DateReminderCard` (Join uses `/date/:id` when an active handshake/date session exists; otherwise safe fallback `/schedule`), `VibeSchedule`, `MyDatesSection` accept/decline proposals, notification flow.

---

### Screen: User profile (other user)
- **Route:** `/user/:userId`
- **File:** `src/pages/UserProfile.tsx`

**States:** Loading; not found; carousel + bio, vibes, prompts, lifestyle, intent.

---

### Screen: Premium
- **Route:** `/premium`
- **File:** `src/pages/Premium.tsx`

**States:** Loading; already premium (plan, renew date, Go Home → `/`); checkout Monthly/Annual → Stripe `startCheckout`.

---

### Screen: Credits
- **Route:** `/credits`, `?cancelled=true` shows toast and cleans URL
- **File:** `src/pages/Credits.tsx`

**Packs:** extra_time_3, extended_vibe_3, bundle_3_3 → edge `create-credits-checkout`.

**Analytics:** `credit_purchase_initiated`.

---

### Screen: Vibe Studio route
- **Route:** `/vibe-studio`
- **File:** `src/pages/VibeStudio.tsx`
- **Behavior:** Dedicated Vibe Studio page for current state, create/replace/delete, caption editing, honest processing/failed/ready UX, and fullscreen preview. Recording still reuses `VibeStudioModal`.

---

### Screen: Match Celebration (demo)
- **Route:** `/match-celebration`
- **File:** `src/pages/MatchCelebration.tsx`

Fake `MatchSuccessModal` with static Sarah data; close → `/events`.

---

### Screen: How It Works
- **Route:** `/how-it-works`
- **File:** `src/pages/HowItWorks.tsx`

Steps, features grid, links to `/events`, `/privacy`, `/terms`, BottomNav.

---

### Screen: Reset Password
- **Route:** `/reset-password`
- **File:** `src/pages/ResetPassword.tsx`

Modes: request email → success; recovery session → new password; success → `/auth`.

---

### Screen: Subscription / payment success pages
- **SubscriptionSuccess:** Countdown → `/`, CTA Start Exploring.
- **SubscriptionCancel:** Try Again `/premium`, Home `/`.
- **EventPaymentSuccess:** `?event_id=`, confetti, CTA to event.
- **CreditsSuccess:** `?pack=` → `credit_purchase_completed`, then URL cleaned; Got it → `/`.

---

### Screen: Admin Login
- **Route:** `/kaan`
- **File:** `src/pages/admin/AdminLogin.tsx`

Admin email/password; non-admin role → sign out + “Access Denied”; success → `/kaan/dashboard`.

---

### Screen: Admin Dashboard
- **Route:** `/kaan/dashboard`
- **File:** `src/pages/admin/AdminDashboard.tsx`

Sidebar panels: overview, users, events, reports, export, event analytics, activity log, engagement, campaigns, photo verification, deletions, feedback. `useAdminRealtime`. Non-admin redirected to `/dashboard`.

---

### Screen: Admin Create Event
- **Route:** `/admin/create-event`
- **File:** `src/pages/AdminCreateEvent.tsx`

Large form: theme, date/time, virtual toggle, venue, cover upload (Bunny), capacity, pricing, Publish (currently simulated delay + toast + `/events`). Preview button non-functional.

---

### Screen: Legal / public
- **PrivacyPolicy, TermsOfService, DeleteAccountWeb, CommunityGuidelines:** Long-form scroll; typical back/legal CTAs per file.

---

### Screen: Not Found
- **Route:** `*`
- **File:** `src/pages/NotFound.tsx`

404, link to `/`.

---

### Orphan page (not routed)
- **`src/pages/ReadyGate.tsx`:** Full-page ready gate UI — **not** linked from `App.tsx`. Production ready gate is `ReadyGateOverlay` inside lobby.

---

## SECTION 3: GLOBAL ELEMENTS

### BottomNav
- **Shown on:** Dashboard (`/home` only for active Home tab), Events, Matches, Profile — **not** on Chat, Event Details, Lobby, Video Date, Settings, Schedule (Schedule has BottomNav), Credits, HowItWorks.
- **Items:** Home `/home`, Events `/events`, Matches `/matches`, Profile `/profile`.
- **Badge:** Droplet on Home when local time ≥ 18:00 and today’s drop not viewed (`vibely_drop_history`). **Bug:** Badge condition uses `item.path === '/dashboard'` but nav path is `/home` — badge may never show.

**Active styling:** `text-primary`, `bg-primary/20 neon-glow-violet`.

---

### Header patterns
- **Sticky glass headers:** Dashboard, Events, Matches, Schedule, Settings, Credits, HowItWorks, Admin create event.
- **Chat:** `ChatHeader` with back → `/matches`, video call, profile focus.

---

### OfflineBanner
- **When:** `useNetworkStatus` — top fixed red bar “You’re offline”; after reconnect, green “Back online” ~3s.

---

### PullToRefresh
- **Dashboard, Matches** (`PullToRefresh` wrapper).

---

### Notification flows
- **`PushPermissionPrompt`:** After 5s if user has match or event reg, not subscribed, permission default; drawer “Stay in the loop”; Enable → OneSignal + DB + `push_permission_granted` + welcome push; Maybe Later → `push_permission_deferred`.
- **`NotificationPermissionFlow`:** Used on Dashboard, Schedule; in-app notification list via `NotificationContainer` / context.

---

## SECTION 4: USER JOURNEYS (end-to-end)

### 4.1 First-time user
`/` → Get Started → `/auth?mode=signup` → name/email/password → Create → email confirm toast → sign in → `/onboarding` steps 0–7 → Complete → `/dashboard`.

### 4.2 Returning user
`/` or `/auth` → Sign in → `/dashboard` or `/onboarding` if profile incomplete (**note:** stricter photo rule on Auth path &lt;2 vs ProtectedRoute &lt;1 photo).

### 4.3 Browse & register
`/events` → filter/search → `/events/:id` → Register / Stripe → success toast → optional ticket → Manage booking.

### 4.4 Attend event (lobby → date)
Registered + live → `/event/:id/lobby` → swipe → Ready Gate overlay → `/date/:sessionId` → handshake → date → PostDateSurvey → (MatchCelebration path in app is separate demo) → lobby may append `?pendingMatch=` from survey.

### 4.5 Chat
`/matches` → conversation → `/chat/:id` → text/voice/video/games/VibeSync.

### 4.6 Video call from chat
Header video → `IncomingCallOverlay` / `ActiveCallOverlay` → end call.

### 4.7 Daily Drop
Matches tab → Daily Drop → states per SECTION 2 → opener/reply → Start Chatting.

### 4.8 Profile editing
`/profile` → delegates to `ProfileStudio` (drawers / wizard / vibe studio modal implementation).

### 4.9 Premium
`/premium` → plan → Stripe → `/subscription/success`.

### 4.10 Credits
`/credits` or Settings → packs → Stripe → `/credits/success?pack=…`.

### 4.11 Account deletion
Settings → Delete My Account → `DeleteAccountModal` steps → `useDeleteAccount` (backend governs grace — UI copy says permanent; align with `DeletionRecoveryBanner` if 30-day grace exists server-side).

### 4.12 Pause/resume
**Profile** → open **Safety Hub** → Pause account flow (`PauseAccountFlow`): choose **24 Hours**, **1 Week**, or **Indefinite** → confirm → success “Taking a Vibe Break” (profile hidden from guest list; matches kept) → Got it. Resume is via `useAccountStatus` / auth context (not re-documented here — see `PauseAccountFlow` + `AuthContext`).

### 4.13 Phone verification
`PhoneVerificationNudge` / `PhoneVerification` / `AccountSettingsDrawer` embedded flow — OTP via Supabase patterns in component.

### 4.14 Password reset
`/auth` → Forgot password → `/reset-password` → email → Supabase email link → set password → `/auth`.

---

## SECTION 5: ADMIN SCREENS

| Route | Capabilities |
|-------|----------------|
| `/kaan` | Admin auth |
| `/kaan/dashboard` | Sidebar: Overview stats/charts, Users, Events, Reports, Export, Event analytics, Activity log, Engagement, Push campaigns, Photo verification queue, Account deletions, Feedback |
| `/admin/create-event` | Event creation form (admin-only) |

---

## SECTION 6: LEGAL/PUBLIC PAGES

| Path | Purpose |
|------|---------|
| `/privacy` | Privacy policy content |
| `/terms` | Terms of service |
| `/delete-account` | Account deletion instructions (web) |
| `/community-guidelines` | Guidelines |
| `/how-it-works` | Product explainer + BottomNav |

---

## SECTION 7: ERROR / EDGE CASES

| Case | Behavior |
|------|----------|
| 404 | `NotFound` |
| React error | Sentry boundary: “Something went wrong”, Refresh, Try Again |
| Session expired | Protected routes → `/auth` |
| Offline at boot (authenticated) | Full-screen “No Internet Connection”, Try Again |
| Offline mid-session | Banner; chat send blocked with toast |
| Maintenance | None in codebase |

---

## SECTION 8: DEEP LINKS / URL PATTERNS

| Pattern | Param | Invalid/missing behavior |
|---------|-------|---------------------------|
| `/events/:id` | UUID | Event not found screen |
| `/chat/:id` | match id | Loading / errors from `useMessages` |
| `/user/:userId` | profile UUID | Profile not found |
| `/date/:id` | session UUID | Fallback timers if no session row |
| `/ready/:id` | **treated as eventId** | Redirect `/event/:id/lobby` or `/events` if no id |
| `/event/:eventId/lobby` | event UUID | Redirect to event details if not live/unregistered |
| `/credits/success?pack=` | pack id | Label defaults if unknown |

---

## SECTION 9: THIRD-PARTY (user-visible)

| Integration | UX |
|-------------|-----|
| **Stripe** | Premium checkout, event payment, credits — hosted checkout redirect |
| **Daily.co** | Video date full-screen iframe; join via `daily-room` token |
| **OneSignal** | Push prompt drawer; SDK in index.html |
| **Bunny Stream** | Vibe video HLS playback; chat video/voice uploads |
| **RevenueCat** | Not referenced in web pages read |
| **PostHog** | See Section 10 |

---

## SECTION 10: ANALYTICS EVENTS

### Automatic
- **`$pageview`** — every navigation (`App.tsx` PostHogPageTracker): `{ $current_url }`

### `trackEvent` (custom)
| Event | Trigger | Properties |
|-------|---------|------------|
| `login` | Auth sign in success | `method: 'email'` |
| `signup_completed` | Auth sign up success | `method: 'email'` |
| `onboarding_completed` | Onboarding finish | `has_photo`, `has_bio`, `has_vibes`, `vibe_count` |
| `event_viewed` | EventDetails mount | `event_id`, `event_title` |
| `event_registered` | After register | `event_id`, `event_title`, `is_free` |
| `lobby_entered` | EventLobby mount | `event_id` |
| `swipe` | useSwipeAction success | `event_id`, `swipe_type`, `result` |
| `post_date_survey_completed` | PostDateSurvey | `session_id`, `verdict` |
| `video_date_started` | VideoDate phase | `session_id`, `phase: 'handshake'` |
| `video_date_extended` | Extension used | `session_id` |
| `credit_used` | VideoDate | `type`, `minutes` |
| `video_date_ended` | Call end | (see VideoDate.tsx for full payload) |
| `ready_gate_ready` | `ReadyGate.tsx` (**not routed** — only if wired manually) | `session_id` |
| `ready_gate_skipped` | Same orphan page | `session_id` |
| `credit_purchase_initiated` | Credits pack click | `pack_id` |
| `credit_purchase_completed` | CreditsSuccess | `pack` |
| `push_permission_granted` | Push drawer enable | — |
| `push_permission_deferred` | Maybe later | — |
| `feedback_submitted` | FeedbackDrawer | `category` |
| `photo_verification_submitted` | SimplePhotoVerification | — |
| `vibe_video_uploaded` | VibeStudioModal | — |
| `premium_activated` | usePremium hook | — |

### PostHog identify / people
- **`identifyUser(userId, { email, created_at })`** — on session (`useAppBootstrap`)
- **`resetAnalytics()`** — logout
- **`setUserProperties`** — `name`, `age`, `gender`, `location`, `has_photos`, `is_premium`, `is_verified` when profile loads

---

## COMPONENT INVENTORY (by domain)

Under `src/components/` (259 files): **ui/** (shadcn primitives), **admin/** (panels, sidebar, modals), **arcade/** (games + creators), **chat/** (bubbles, header, recorders, call overlays), **daily-drop/**, **events/** (cards, modals, payment, venue), **lobby/** (profile card, empty, ready overlay), **matches/** (DropsTabContent), **notifications/**, **premium/**, **schedule/**, **settings/** (drawers, delete modal), **safety/** (report, pause, hub), **verification/**, **video-date/** (survey, timers, Daily UI), **vibe-video/**, **wizard/**, plus shared (BottomNav, PhoneVerification, PullToRefresh, etc.). Rebuild map: start from each page’s imports and follow hooks in `src/hooks/`.

---

*End of sitemap.*
