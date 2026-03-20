# Vibely Native App (iOS + Android) — Complete Sitemap & UX Specification

> Source: `apps/mobile/app/**`, `apps/mobile/components/**`, `apps/mobile/lib/**`, `app.json`.  
> **Router:** Expo Router (file-based). Root `Stack` has **no path prefix** for most screens; tabs live under `/(tabs)`.

---

## SECTION 1: ROUTE MAP (full tree)

### Root `app/_layout.tsx` — Stack (headerShown: false)

| Route (Expo path) | File | Auth | Layout | Header | Presentation |
|-------------------|------|------|--------|--------|--------------|
| `index` | `app/index.tsx` | Gate | Full screen | Hidden | Spinner → Redirect |
| `(auth)` | `app/(auth)/_layout.tsx` | Public | Stack | Hidden | Auth group |
| `(onboarding)` | `app/(onboarding)/_layout.tsx` | Implicit (post-sign-in) | Stack | **Shown** (default) | Onboarding |
| `(tabs)` | `app/(tabs)/_layout.tsx` | Implicit | **Tabs** | Hidden | Main shell |
| `event/[eventId]/lobby` | `app/event/[eventId]/lobby.tsx` | Session | Full screen | Hidden | Lobby deck |
| `chat/[id]` | `app/chat/[id].tsx` | Session | Full screen | `GlassHeaderBar` | Chat (`id` = **other user profile id**, not match UUID — see `chatApi`) |
| `daily-drop` | `app/daily-drop.tsx` | Session | Full screen | Glass header | Daily Drop full page |
| `ready/[id]` | `app/ready/[id].tsx` | Session | Full screen | Glass header | Ready gate (**`id` = sessionId**) |
| `date/[id]` | `app/date/[id].tsx` | Session | Full screen | Hidden | Video date (Daily.co) |
| `settings` | `app/settings/_layout.tsx` | Session | Stack | Hidden | Settings subtree |
| `premium` | `app/premium.tsx` | Session | Full screen | Glass header | RevenueCat |
| `vibe-video-record` | `app/vibe-video-record.tsx` | Session | Full screen | Custom back | Camera record |
| `user/[userId]` | `app/user/[userId].tsx` | Session | Full screen | Back | Public-style profile |
| `match-celebration` | `app/match-celebration.tsx` | Session | Full screen | Back | Post-date match |
| `schedule` | `app/schedule.tsx` | Session | Full screen | Back | Schedule |
| `subscription-success` | `app/subscription-success.tsx` | Session | Center | Minimal | Premium success |
| `credits-success` | `app/credits-success.tsx` | Session | Center | Minimal | Credits success |
| `event-payment-success` | `app/event-payment-success.tsx` | Session | Center | CTAs | Post-Stripe event pay |
| `how-it-works` | `app/how-it-works.tsx` | Session | Scroll | Back | Explainer |

**Not registered in root Stack (orphan / template):** `app/modal.tsx`, `app/+html.tsx` — **not linked** from `_layout.tsx`; `modal.tsx` is Expo template residue.

**Tabs group** `app/(tabs)/_layout.tsx`:

| Tab route | File | Nested layout |
|-----------|------|---------------|
| `index` | `(tabs)/index.tsx` | — |
| `events` | `(tabs)/events/_layout.tsx` → Stack | `(tabs)/events/index.tsx`, `(tabs)/events/[id].tsx` |
| `matches` | `(tabs)/matches/_layout.tsx` → Stack | `(tabs)/matches/index.tsx` |
| `profile` | `(tabs)/profile/_layout.tsx` → Stack | `(tabs)/profile/index.tsx` |

**Auth stack** `(auth)/_layout.tsx`:

| Screen | File |
|--------|------|
| `sign-in` | `(auth)/sign-in.tsx` |
| `sign-up` | `(auth)/sign-up.tsx` |
| `reset-password` | `(auth)/reset-password.tsx` |

**Settings stack** `settings/_layout.tsx`:

| Screen | File |
|--------|------|
| `index` | `settings/index.tsx` |
| `notifications` | `settings/notifications.tsx` |
| `credits` | `settings/credits.tsx` |
| `account` | `settings/account.tsx` |
| `privacy` | `settings/privacy.tsx` |

**Deep linking:** Scheme `mobile` (`app.json` → `"scheme": "mobile"`). URLs like `mobile://chat/...` depend on Expo Router linking; universal links not enumerated in `app.json` snippet — verify `associatedDomains` in EAS if used.

**Auth gate:** `app/index.tsx` — no session → `/(auth)/sign-in`; session + no profile row → `/(onboarding)`; else → `/(tabs)`.

---

## SECTION 2: SCREEN-BY-SCREEN BREAKDOWN

### Gate: Index
- **Route:** `/`
- **File:** `app/index.tsx`
- **States:** Loading spinner; Redirect to auth / onboarding / tabs.

---

### Sign In
- **Route:** `/(auth)/sign-in`
- **Header:** Custom in-screen (back to sign-up toggle)
- **Form:** email, password → `signIn` → success **1.2s** delay → `router.replace('/(tabs)')` (code uses replace to tabs directly)
- **Analytics:** `login` { method: email }

---

### Sign Up
- **Route:** `/(auth)/sign-up`
- **Form:** email, password → `signUp` → `signup_completed` → replace `/(tabs)` (user may hit onboarding if no profile)

---

### Reset Password
- **Route:** `/(auth)/reset-password`
- **Flow:** Request email / update password (Supabase recovery)

---

### Onboarding (native — shorter than web)
- **Route:** `/(onboarding)` → single file `app/(onboarding)/index.tsx`
- **Layout:** Stack **header shown** (Expo default title area)
- **Steps:** 0 Welcome → 1 Identity (name) → 2 Details (gender required; tagline, job, about_me optional)
- **Submit:** `createProfile` → `refreshOnboarding` → `/(tabs)`
- **Step 2 footer:** Link **“Add photos on the web”** → `https://vibelymeet.com/profile`
- **Alert:** Error on failure
- **Note:** No multi-step photo/onboarding parity with web; profile row existence completes onboarding.

---

### Dashboard (Home tab)
- **Route:** `/(tabs)` / `/(tabs)/index`
- **Header:** `GlassHeaderBar` — `DashboardGreeting`, bell → notification flow or `/settings/notifications`, avatar → `/profile`
- **RefreshControl:** `tintColor={theme.tint}`
- **Sections:** DeletionRecoveryBanner; PhoneVerificationNudge; DateReminderCards (Join → `/date/:sessionId` if active session else `/chat/:partnerProfileId`); Live event CTA → lobby or event detail; Next event countdown; premium other-cities nudge; matches strip → `/chat/:id`; events rail → `/events/:id`
- **Web fallbacks:** `Linking.openURL('https://vibelymeet.com/schedule')` (upcoming dates empty); `onJoinDate` on reminder → `https://vibelymeet.com/video-date`
- **Modals:** `NotificationPermissionFlow`
- **Animations:** `PulsingLiveDot` (Animated loop)
- **Realtime:** None on dashboard itself; hooks refetch on focus/refresh

---

### Events list
- **Route:** `/(tabs)/events`
- **File:** `app/(tabs)/events/index.tsx`
- **Header:** `GlassHeaderBar`, search, filters, location enable CTA
- **RefreshControl** + skeletons / ErrorState
- **Card tap:** `router.push(/events/${id})`
- **Premium gates:** `router.push('/premium')`
- **Location:** `Linking.openURL('https://vibelymeet.com/profile')` for web profile to add location

---

### Event detail
- **Route:** `/(tabs)/events/[id]`
- **Header:** `GlassHeaderBar`, back → `router.back()`, share
- **States:** Loading, ErrorState, loaded — hero, attendees (Alert for vibe send), `PricingBar`, `VenueCard`, `MutualVibesSection`, `WhosGoingSection`, registered bar
- **Register:** Free register or RevenueCat/Stripe via `Linking.openURL(result.url)` for payment
- **Alerts:** Vibe sent errors, payment, cancel booking, sign-in
- **Navigation:** Enter Lobby → `/event/${event.id}/lobby`; user profiles → `/user/:userId`
- **Analytics:** `event_registered` { event_id, event_title, is_free }

---

### Event lobby
- **Route:** `/event/[eventId]/lobby`
- **Realtime channels:**
  - `lobby-reg-{eventId}-{userId}` — `event_registrations` UPDATE → open ReadyGateOverlay when `in_ready_gate`
  - `lobby-video-{eventId}-{userId}` — `video_sessions` UPDATE (match lifecycle)
  - `event-lifecycle-{eventId}` — `events` UPDATE (ended → modal)
- **Deck:** Pass / Super Vibe / Vibe; `trackEvent('swipe', { event_id, swipe_type, result })`
- **ReadyGateOverlay (Modal):** “I'm Ready ✨” → **`router.push(`/date/${sessionId}`)** directly (**does not** navigate to `/ready/[id]`). Skip → closes overlay.
- **Alerts:** Offline, swipe errors, super vibe toasts, queue message
- **EventEndedModal:** Replace to matches or home

---

### Ready gate screen (standalone)
- **Route:** `/ready/[id]` — **`id` = video session UUID**
- **File:** `app/ready/[id].tsx`
- **Status:** **No `router.push` to this route anywhere in codebase** — reachable only via deep link or future wiring. Implements full-screen gate with `useReadyGate` realtime (`ready-gate-{sessionId}` on `video_sessions`). Both ready → `router.replace(/date/${sessionId})`; forfeit → lobby or tabs.
- **Alert:** “Step away?” on skip

---

### Video date
- **Route:** `/date/[id]`
- **File:** `app/date/[id].tsx` (+ components under `components/video-date/`)
- **Realtime:** `video-date-session-{sessionId}` (`lib/videoDateApi.ts`)
- **Post-date:** Survey → navigate match celebration / chat

---

### Match celebration
- **Route:** `/match-celebration` — query params for match context → `router.replace(/chat/${otherUserId})`

---

### Matches tab
- **Route:** `/(tabs)/matches`
- **Header:** `GlassHeaderBar`; tabs **Chat** | **Daily Drop** (inline); search + sort
- **RefreshControl**
- **Premium:** `NewVibesRail` equivalent via list + `WhoLikedYouGate` for free users
- **Invite:** Share + `Linking.openURL` referral; “How it works” → web
- **Alerts:** Unmatch (undo 5s via `UnmatchSnackbar`), Block
- **Sheets:** `ProfileDetailSheet`, `MatchActionsSheet`, `ReportFlowModal`

---

### Daily Drop
- **Primary UX:** **Matches tab** → sub-tab **“Daily Drop”** → `DropsTabContent` (`components/matches/DropsTabContent.tsx`) inline (same file tree as web).
- **Full-screen route:** `app/daily-drop.tsx` at **`/daily-drop`** is registered in root Stack but **no `router.push('/daily-drop')` exists in the repo** — reachable only via **deep link** or future wiring. That file duplicates/extends full-page drop flow with `GlassHeaderBar`.
- **Home tab dot:** `useDailyDropTabBadge` — user still lands on **Matches → Daily Drop tab**, not auto-navigated to `/daily-drop`.
- **Alerts:** Opener/reply errors, pass confirm (in `DropsTabContent` + `daily-drop.tsx`)
- **Realtime:** `daily-drop-{dropId}` on `daily_drops` (`lib/dailyDropApi.ts`)

---

### Chat
- **Route:** `/chat/[id]` — **`id` = other user’s **profile** UUID**
- **Header:** `GlassHeaderBar` — back, call buttons, menu (unmatch/block/report)
- **Realtime:** `messages-{matchId}` INSERT/UPDATE; typing via `chatApi`
- **IncomingCallOverlay / ActiveCallOverlay** — `useMatchCall` + channel `match-calls-{userId}-{matchId}`
- **Sheets:** `DateSuggestionSheet`, `ReactionPicker` on long-press
- **Alerts:** Offline, voice permission, video from library, call errors, unmatch/block, “Coming soon” for camera photo
- **Quick action:** Opens `https://vibelymeet.com/matches`

---

### Profile tab
- **Route:** `/(tabs)/profile`
- **RefreshControl**
- **Sections:** Photos (picker Alerts), vibe video → `/vibe-video-record`, prompts sheets, verification rows (web links), invite friends, sign out
- **Modals:** `ProfilePreviewModal`, `PromptEditSheet`, phone/email flows
- **Alerts:** Save, delete account (legacy immediate delete path if present), permissions, upload limits

---

### Settings root
- **Route:** `/settings` (from stack push, e.g. profile gear — **entry:** `router.push` not in tab bar)
- **Rows:** Premium, Credits, Notifications, Account, Privacy, Support & Feedback (`/settings/support` stack), legal **web** links, Sign out Alert

---

### Settings → Notifications / Credits / Account / Privacy
- **Credits:** RevenueCat/Stripe checkout `Linking.openURL(url)`; Alert on error
- **Account:** Pause (Alert duration picker) → `account-pause`; Resume → `account-resume`; Deletion → `request-account-deletion` + `DeletionRecoveryBanner` data; `PhoneVerificationFlow` / `EmailVerificationFlow` as modals
- **Privacy:** Toggles + web links for advanced settings

---

### Premium
- **Route:** `/premium`
- **RevenueCat** purchase → `/subscription-success`; restore → Alert
- **GlassHeaderBar** back

---

### Vibe video record
- **Route:** `/vibe-video-record`
- **Camera** (expo-camera); Alerts recording/upload fail; success → `router.replace('/(tabs)/profile')`

---

### User profile (other user)
- **Route:** `/user/[userId]`
- **Alerts:** Unmatch, Block

---

### Schedule
- **Route:** `/schedule`
- **RefreshControl**; proposals; Join logic → `/date/` or `/chat/` (native routes, not web)

---

### How it works
- **Route:** `/how-it-works`
- **Back** → `router.back()`

---

### Success screens
- **subscription-success, credits-success, event-payment-success** — CTAs back into app routes

---

### +not-found
- **Route:** unmatched paths → `+not-found.tsx`

---

## SECTION 3: GLOBAL ELEMENTS

### Tab bar
- **Screens:** Only inside `/(tabs)/*` — Home, Events, Matches, Profile.
- **Hidden:** Chat, lobby, date, settings stack, premium, daily-drop, etc.
- **Items:**

| Label | SF Symbol (iOS) | Android mapping | Route |
|-------|-----------------|-----------------|-------|
| Home | `house` | `home` | `/(tabs)` |
| Events | `list.bullet` | `list` | `/(tabs)/events` |
| Matches | `heart.fill` | `favorite` | `/(tabs)/matches` |
| Profile | `person.circle` | `person` | `/(tabs)/profile` |

- **Badge:** 6px dot on **Home** when `useDailyDropTabBadge(userId)` true (drop available / not consumed — see hook).
- **Colors:** `tabBarActiveTintColor` / `inactive` from `Colors[scheme]`; `tabBarActiveBackgroundColor` = `tintSoft`.
- **Heights:** Content area **64 iOS** / **60 Android** + `safe area bottom`; `paddingBottom` iOS = inset; Android `max(insets.bottom, 10)`.

### OfflineBanner
- **`useIsOffline`** (`lib/useNetworkStatus`); **Animated** slide from top; text **“No internet connection”**; orange `#c2410c`; `zIndex: 9999`; safe area top padding.

### GlassHeaderBar
- **`components/ui.tsx`** — blur/glass row; used on Dashboard, Events list, Event detail, Lobby, Chat, Settings*, Premium, Privacy, Notifications, Account, Credits, Daily-drop, Ready screen, Matches.

### PullToRefresh
- **Dashboard, Events index, Profile, Matches, Schedule** — `RefreshControl` **tintColor = theme.tint**.

### Sentry
- **`Sentry.wrap(RootLayout)`** in `app/_layout.tsx`; DSN from env; **expo-router `ErrorBoundary` export** for route-level errors.

### PostHog
- **`PostHogScreenTracker`:** on pathname change → `posthog.capture('$screen', { $screen_name: pathname })`.
- **`setPostHogClient`** for `trackEvent` in `lib/analytics.ts`.

---

## SECTION 4: USER JOURNEYS (native)

### 4.1 First-time
`/` → sign-in or sign-up → `/(onboarding)` steps 0–2 → `/(tabs)`. Photos via web link.

### 4.2 Returning
Sign in → replace `/(tabs)` (or onboarding if profile missing).

### 4.3 Browse & register
Events tab → detail → register / pay → `event-payment-success` → event detail or events list.

### 4.4 Lobby → date (actual code)
Event detail → **Enter Lobby** → swipe → **ReadyGateOverlay** → **I'm Ready** → **`/date/[sessionId]`** (skips `/ready/[id]`). Post-date survey → match-celebration → chat.  
**`/ready/[id]`** is parallel full-screen implementation **not linked** from lobby button.

### 4.5 Chat
Matches → thread → text, voice, video note (library), date suggestion sheet, reactions.

### 4.6 Call from chat
Header → ring → Incoming → Active overlay → end.

### 4.7 Daily Drop
**Matches** tab → **Daily Drop** sub-tab → `DropsTabContent` → opener/reply → Start Chatting → `/chat/[id]`. **`/daily-drop` screen is not linked from UI** (deep link only).

### 4.8 Profile
Edit fields, save, photos, **vibe-video-record**.

### 4.9 Premium
`/premium` → RC → subscription-success.

### 4.10 Credits
`/settings/credits` → checkout URL → credits-success.

### 4.11 Deletion
Settings → Account → confirm Alert → `request-account-deletion` → banner on dashboard → `cancel-deletion`.

### 4.12 Pause
Account → Alert (24h / week / until resume) → `account-pause` / `account-resume`.

### 4.13 Phone verification
Nudge or Account → `PhoneVerificationFlow` modal.

### 4.14 Email verification
Account → `EmailVerificationFlow` modal.

### 4.15 Schedule
Dashboard mini countdown → `/schedule` → native join paths to date/chat.

### 4.16 How it works
Settings → link to **`https://vibelymeet.com/how-it-works`** OR in-app `/how-it-works` if navigated from code.

---

## SECTION 5: PLATFORM DIFFERENCES

| Topic | iOS | Android |
|-------|-----|---------|
| Tab content height | 64 | 60 |
| Tab padding bottom | `insets.bottom` | `max(insets.bottom, 10)` |
| SymbolView | SF Symbols names | Material mapping in `SymbolView` props |
| Open settings | `app-settings:` | `Linking.openSettings()` |
| Permissions copy | Info.plist strings | Android permission list in app.json |
| Background modes | `remote-notification`, `voip` | Foreground service camera/mic |
| Predictive back | — | `predictiveBackGestureEnabled: false` |
| Keyboard | KAV on onboarding | KAV optional |

---

## SECTION 6: NATIVE-ONLY FEATURES

- **OneSignal** (`PushRegistration`, `onesignal-expo-plugin`)
- **RevenueCat** (`initRevenueCat`, premium + credits)
- **Daily.co** (video date)
- **expo-camera** vibe recording
- **Haptics** (lobby/swipe — where implemented)
- **Activity heartbeat** (`useActivityHeartbeat` every 60s foreground)
- **expo-network / useIsOffline**
- **SymbolView** tab icons
- **Biometrics:** not documented in grep pass — verify if added later

---

## SECTION 7: WEB FALLBACKS (`Linking.openURL`)

| File | URL | Reason |
|------|-----|--------|
| `chat/[id].tsx` | `https://vibelymeet.com/matches` | Quick action |
| `settings/support.tsx` | — | In-app Support & Feedback hub |
| `settings/privacy.tsx` | `vibelymeet.com/settings` (×2), `/privacy` | Manage privacy on web |
| `settings/index.tsx` | Billing portal `data.url` (Stripe) | Manage subscription |
| `settings/index.tsx` | `/community-guidelines`, `/how-it-works`, `/settings`, `/privacy`, `/terms` | Legal / full settings on web |
| `settings/notifications.tsx` | `/settings` | Advanced notification prefs |
| `settings/account.tsx` | `/settings` | “Some options on web” |
| `(tabs)/profile/index.tsx` | invite link (vibelymeet), `/schedule`, `/profile` | Share + schedule on web + photo verify on web |
| `(tabs)/index.tsx` | `/schedule`, `/video-date` | Empty schedule / join date web fallback |
| `(tabs)/events/index.tsx` | `/profile` | Enable location via web profile |
| `(tabs)/events/[id].tsx` | Stripe `result.url` | Paid event checkout |
| `settings/credits.tsx` | Checkout URL | Credits purchase |
| `PhoneVerificationNudge.tsx` | `WEB_VERIFY_URL` (web verify) | Phone verify on web |
| `VerificationBadgesRow.tsx` | Photo verify web | |
| `settings/submit-ticket.tsx` | Supabase `support_tickets` | Submit support / feedback / safety |
| `usePushPermission.ts` | `app-settings:` | Open OS settings |
| `(onboarding)/index.tsx` | `/profile` | Add photos on web |
| `(tabs)/matches/index.tsx` | `/how-it-works` | Product help |

---

## SECTION 8: DEEP LINKS / URL SCHEMES

- **Scheme:** `mobile` (e.g. `mobile://...`).
- **Bundle IDs:** iOS `com.vibelymeet.vibely`, Android same package.
- **Routes:** Standard Expo Router paths (`/chat/uuid`, `/event/{id}/lobby`, etc.).
- **Universal links:** Confirm in Apple Team / Play App Links if enabled for production.

---

## SECTION 9: PERMISSIONS

| Permission | Trigger |
|------------|---------|
| Camera | Video date, vibe video record |
| Microphone | Video date, voice messages, recording |
| Photo library | Profile photos, chat video attach |
| Push | OneSignal registration; NotificationPermissionFlow |
| Location | Not in Info.plist snippet beyond standard — events location uses profile `location_data` / geocode |

**Denied:** Alerts guide user; **openSettings** from notification flow / push hook.

---

## SECTION 10: ANALYTICS EVENTS

| Event | Where | Properties |
|-------|-------|------------|
| `$screen` | `_layout.tsx` PostHogScreenTracker | `$screen_name` = pathname |
| `login` | sign-in | `method: email` |
| `signup_completed` | sign-up | `method: email` |
| `event_registered` | events/[id] | `event_id`, `event_title`, `is_free` |
| `swipe` | event lobby | `event_id`, `swipe_type`, `result` |

**Defined but unused in app code (callers):** `identifyUser`, `resetAnalytics`, `screen()` in `analytics.ts` — no grep hits outside `analytics.ts`. Consider wiring on login/logout for parity with web.

---

## SECTION 11: ERROR HANDLING MAP

| Area | Mechanism |
|------|-----------|
| Lists / detail | `ErrorState` + retry (`onActionPress` → refetch or `router.back`) |
| Chat load | `ErrorState` |
| Lobby deck | `ErrorState`, Alert on swipe failure |
| Forms | `Alert.alert('Error', message)` |
| Network | OfflineBanner + inline Alerts (“Check your connection”) |
| Video / upload | Alert with exception message |
| Sentry | Wrapped root layout |

---

## COMPONENTS INVENTORY (`apps/mobile/components/`)

| Domain | Files |
|--------|-------|
| Chat | ActiveCallOverlay, IncomingCallOverlay, DateSuggestionSheet, ReactionPicker, MessageStatus, TypingIndicator |
| Events | TicketStub, ManageBookingModal, PricingBar, VenueCard, ActiveCallBanner, MutualVibesSection, WhosGoingSection, EventEndedModal |
| Lobby | ReadyGateOverlay |
| Match | ReportFlowModal, MatchActionsSheet, ProfileDetailSheet, UnmatchSnackbar |
| Profile | PromptEditSheet, ProfilePreviewModal, LifestyleDetailsSection, RelationshipIntentSelector, VerificationBadgesRow, PROMPT_CONSTANTS |
| Video date | HandshakeTimer, IceBreakerCard, VideoDateControls, PartnerProfileSheet, PostDateSurvey, ConnectionOverlay, ReconnectionOverlay, KeepTheVibe, MutualVibeToast, VibeCheckButton |
| Settings | DeletionRecoveryBanner (Support flows live under `app/settings/support*.tsx`) |
| Verification | EmailVerificationFlow, PhoneVerificationFlow |
| Notifications | NotificationPermissionFlow |
| Matches | DropsTabContent, WhoLikedYouGate |
| Premium | PremiumPill |
| Schedule | DateReminderCard |
| Misc | OfflineBanner, PushRegistration, DashboardGreeting, PhoneVerificationNudge, ExternalLink, Themed, ui (GlassHeaderBar, Card, buttons, skeletons), GradientSurface |

---

*End of native sitemap.*
