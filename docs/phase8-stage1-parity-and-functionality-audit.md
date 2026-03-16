# Phase 8 Stage 1 — Full Native Parity and Functionality Audit

**Scope:** Screen-by-screen and flow-by-flow audit of `apps/mobile` against the web app (source of truth).  
**Constraints:** No new app or architecture; web = design/product source of truth; shared backend contracts and providers (RevenueCat, OneSignal, Daily, Supabase) preserved.  
**Purpose:** Produce a complete backlog of remaining native gaps and a remediation plan.

---

## 1. Full Audit Table of Remaining Issues

| # | Screen / flow | Issue type | Severity | Platform | Source of truth reference | Likely cause | Recommended fix |
|---|----------------|------------|----------|----------|---------------------------|--------------|------------------|
| 1 | **Dashboard** | Functional | **Critical** | Both | Web: `DateReminderCard`, imminent date reminders, "Join date" / "Enable notifications" | Missing: `useDateReminders`, `useSchedule`, `DateReminderCard`, schedule-date reminder flow | Add native hooks for schedule/reminders; implement DateReminderCard (or equivalent) and wire to Daily date entry + notification permission. |
| 2 | **Dashboard** | Functional | **Critical** | Both | Web: `ActiveCallBanner` when user has active video session (rejoin or end) | Missing: active-session detection and rejoin banner | Query `event_registrations` + `video_sessions` for current user; show banner with Rejoin / End; wire Rejoin to `/date/[sessionId]`. |
| 3 | **Dashboard** | Functional | **High** | Both | Web: `NotificationPermissionFlow` modal + `NotificationPermissionButton` in header; request permission, then schedule reminders | Missing: in-app notification permission request flow and header affordance | Add native permission request flow (OneSignal/OS) and optional modal; surface in header when not granted. |
| 4 | **Dashboard** | Functional | **High** | Both | Web: `PhoneVerificationNudge` (wizard) for unverified users | Missing: phone verification nudge on dashboard | Check `profiles.phone_verified`; show nudge (dismissible) and entry to phone verification flow if available on native. |
| 5 | **Dashboard** | Functional | **High** | Both | Web: `DeletionRecoveryBanner` when account has pending deletion | Missing: deletion recovery banner | Use `useDeletionRecovery` (or equivalent) and show banner with cancel-deletion CTA. |
| 6 | **Dashboard** | Visual/UX | Medium | Both | Web: "Happening Elsewhere" (other cities) rail with blurred cards + Premium CTA | Native: single "Happening Elsewhere" card; no multi-city rail | Add `useOtherCityEvents` (or equivalent) and render rail of city cards with blur + lock; link to Premium. |
| 7 | **Dashboard** | Visual | Low | Both | Web: section ordering, spacing, "Imminent date reminders" above "Live event" | Native: no reminders section; different section order | Align section order and add reminder block when reminders exist. |
| 8 | **Auth / onboarding** | Functional | **Critical** | Both | Web: 8-step onboarding (name, birthDate, gender, interestedIn, location, height, job, aboutMe, vibes, lookingFor, lifestyle, photos, vibe video); progress persistence; `VibeTagSelector`, `HeightSelector`, `LifestyleDetails`, `RelationshipIntent` | Native: 2 steps only (name; gender + tagline + job + about_me); no birthDate, interestedIn, location, height, vibes, lifestyle, photos, vibe video | Extend onboarding to match web steps and components; add progress persistence; add photo upload and vibe video entry or defer with clear "Complete on web" path. |
| 9 | **Auth** | Visual/UX | Medium | Both | Web: landing (Index) with aurora background, logo, gradient text, "Find your vibe" CTA | Native: no landing; index redirects to sign-in when unauthenticated | Optional: add minimal branded landing for app (or accept redirect-only for app store). |
| 10 | **Auth** | UX | Low | Both | Web: reset-password flow with email send and success state | Native: reset-password exists but minimal; doc notes "minimal flow" | Harden reset-password copy and success/error states to match web. |
| 11 | **Events list** | Functional | **High** | Both | Web: `LocationPromptBanner` when profile has no location_data; enables geolocation and saves to profile | Native: `LocationPromptBanner` exists but `showLocationPrompt` is hardcoded `false` | Gate prompt on missing `profiles.location_data`; implement enable flow (geolocation → geocode → profile update) and invalidate events. |
| 12 | **Events list** | Visual | Medium | Both | Web: `EventsFilterBar` (date/category filters), `EventsRail` structure | Native: has date filters and rails; visual density and filter chips may differ | Align filter bar and rail styling to web. |
| 13 | **Event detail** | Functional | **Critical** | Both | Web: `VenueCard`, `GuestListTeaser`, `GuestListRoster`, `PricingBar`, `PaymentModal`, `ManageBookingModal`, `CancelBookingModal`; gender-based pricing; registration → payment (Stripe) for paid events | Native: no venue, no guest list, no pricing/payment, no manage/cancel booking | Add venue block; guest list tease/roster; pricing bar; payment flow (Stripe or "Pay on web" with deep link); manage/cancel booking. |
| 14 | **Event detail** | Functional | High | Both | Web: `useEventAttendees`, `useEventVibes`, `MutualVibesSection`; `MiniProfileModal`; `ProfileDetailDrawer` for attendee | Native: no attendees list, no event vibes, no mutual vibes, no profile drawer from event | Add attendees query and roster/teaser; add event vibes and mutual vibes section; add profile preview/drawer for attendees. |
| 15 | **Event detail** | Functional | Medium | Both | Web: next-in-series indicator, `PhoneVerificationNudge` before register | Native: no series indicator; no phone nudge before register | Add next-in-series when `parent_event_id`; add phone verification gate before registration if required by product. |
| 16 | **Lobby / discovery** | Functional | **Critical** | Both | Web: `useMatchQueue` — realtime subscription on `event_registrations`; when status becomes `in_ready_gate` with `current_room_id`, show Ready Gate | Native: only shows Ready Gate when swipe returns `result === 'match'`; on `match_queued` shows alert "You'll be notified" but no realtime → Ready Gate never appears for queued matches | Add realtime subscription (Supabase channel on `event_registrations` for current user + event); on `in_ready_gate` + `current_room_id` set activeSessionId and show ReadyGateOverlay. |
| 17 | **Lobby** | Visual/UX | Medium | Both | Web: deck stack depth, card styling, shared vibes chips, "Someone wants to meet you" badge | Native: has deck and badges; shared vibes and styling may differ | Align shared vibes display and card depth/styling to web. |
| 18 | **Matches list** | Functional | **High** | Both | Web: `UnmatchDialog`, `ArchiveMatchDialog`, `BlockUserDialog`, `MuteOptionsSheet`; undo unmatch | Native: no unmatch/archive/block/mute flows | Add unmatch (with undo if product supports), archive, block, mute; reuse backend contracts. |
| 19 | **Matches list** | Functional | **High** | Both | Web: `ProfileDetailDrawer` (tap match → drawer with full profile) | Native: tap goes to chat; no profile drawer from list | Add profile detail drawer or sheet when tapping avatar/name. |
| 20 | **Matches list** | Functional | High | Both | Web: `ReportWizard` (safety report from match context) | Native: no report flow from matches | Add report entry (sheet or screen) and submit via existing backend if available. |
| 21 | **Matches list** | Functional | High | Both | Web: `DropsTabContent` (Daily Drop tab with its own list/state) | Native: "Daily Drop" tab exists in UI but content may be placeholder or link; no full Drops list in tab | Implement Drops tab content (list of Daily Drop matches/conversations) or deep link to daily-drop screen. |
| 22 | **Matches list** | Functional | Medium | Both | Web: `WhoLikedYouGate` (premium gate for "who liked you") | Native: no who-liked-you gate/surface | Add who-liked-you entry behind premium if product has it. |
| 23 | **Matches list** | Functional | Medium | Both | Web: `ArchivedMatchesSection` with unarchive | Native: no archived section | Add archived section and unarchive action. |
| 24 | **Matches list** | UX | Medium | Both | Web: `PhoneVerificationNudge` for empty state when not verified | Native: empty state does not check phone_verified | Gate empty-state nudge on phone_verified. |
| 25 | **Chat thread** | Functional | **High** | Both | Web: `VideoDateCard`, `DateSuggestionChip`, `VibeSyncModal`, `DateProposalTicket`; schedule date from chat | Native: no date proposal/schedule UI in chat | Add date proposal/suggestion UI and wire to schedule backend (useSchedule, proposals). |
| 26 | **Chat thread** | Functional | **High** | Both | Web: `VibeArcadeMenu`, `GameBubbleRenderer`, game creators (TwoTruths, WouldRather, Charades, etc.) | Native: no arcade/games in chat | Add arcade entry and game bubbles or defer with "Play on web" CTA. |
| 27 | **Chat thread** | Functional | High | Both | Web: `IncomingCallOverlay`, `ActiveCallOverlay`, `useMatchCall` (video call from chat) | Native: no in-chat video call | Add match call (Daily or link to video date flow) or document as web-only for v1. |
| 28 | **Chat thread** | UX | Medium | Both | Web: typing indicator, read receipts, message status | Native: has realtime messages; typing/read status may be partial | Verify typing indicator and read state; align to web. |
| 29 | **Profile** | Functional | **High** | Both | Web: `ProfileWizard`, `SafetyHub`, full edit flows; `VerificationSteps`, `SimplePhotoVerification`, `PhoneVerification`; `VibeStudioModal` (record/edit vibe video in modal) | Native: edit flows exist but may be simpler; verification and Safety Hub may be reduced or link-out | Add or align verification steps, Safety Hub entry, and vibe video record/edit in-app or clear "Complete on web" for missing pieces. |
| 30 | **Profile** | Visual/UX | Medium | Both | Web: `PhotoManager`, `PhotoGallery`, reorder/delete; `PhotoPreviewModal` | Native: has gallery and manage; parity of reorder/delete and preview modal | Align photo reorder, delete, and preview to web. |
| 31 | **Profile** | Functional | Medium | Both | Web: `RelationshipIntent`, `LifestyleDetails`, `HeightSelector`, `ProfilePrompt`/`PromptSelector` | Native: some fields present; lifestyle/height/prompts may be missing or simplified | Add missing profile fields and selectors to match web. |
| 32 | **Settings** | Functional | **High** | Both | Web: `NotificationsDrawer` (in-app toggles, quiet hours, alert sounds); `AccountSettingsDrawer`; `FeedbackDrawer`; privacy toggles (showOnlineStatus, showLastSeen, showReadReceipts, discoverableByLocation, showAge) | Native: notifications screen is "manage on web" only; no account drawer; no feedback; no privacy toggles | Add in-app notification toggles and/or quiet hours if backend supports; add account settings drawer; add feedback entry; add privacy toggles with profile update. |
| 33 | **Settings** | UX | Medium | Both | Web: `DeleteAccountModal` with reason selection and confirmation | Native: two-step Alert only; no reason | Add delete-account modal with reason and match web copy. |
| 34 | **Premium / paywall** | Visual/UX | Medium | Both | Web: plan selector (monthly vs annual), Stripe checkout; ambient glow, Crown icon | Native: RevenueCat packages; no monthly/annual toggle if RC offers both; styling may differ | Align plan selector if multiple packages; align hero/glow styling. |
| 35 | **Credits** | Functional | High | Both | Web: `Credits` page with Stripe checkout for packs (extra time, extended vibe, bundle); success/cancel return handling | Native: credits screen opens web URL for checkout; no success/cancel return deep link | Implement in-app checkout (Stripe SDK or secure webview) or deep link back to app with success/cancel and refresh balance. |
| 36 | **Notifications** | Functional | High | Both | Web: in-app notification preferences (drawer); device registered for push | Native: "Open on web" only; device registration exists via PushRegistration | Add in-app notification preference toggles if backend/OneSignal supports; keep device registration. |
| 37 | **Daily / video date** | Functional | Medium | Both | Web: join flow, permissions, track behavior, disconnect/reconnect, exit/cleanup | Native: join and cleanup implemented; permissions and track behavior verified in Phase 7 | Document any remaining gaps (e.g. reconnection UI) and fix if critical. |
| 38 | **Ready Gate** | Functional | High | Both | Web: Ready Gate screen with countdown, partner info, Snooze/Skip, "I'm Ready" → navigate to date | Native: Ready Gate screen exists; flow parity to be verified on device | Verify navigation to date and backend transition; fix if broken. |
| 39 | **Daily Drop** | Functional | Medium | Both | Web: Daily Drop as tab content and/or standalone; opener/reply/pass | Native: standalone daily-drop screen; content and actions exist | Align tab vs standalone and list content to web. |
| 40 | **Schedule** | Functional | Medium | Both | Web: `/schedule` — date reminders, proposals, upcoming dates | Native: no Schedule screen | Add Schedule screen (date reminders, proposals) or deep link to web. |
| 41 | **Match celebration** | Visual/UX | Low | Both | Web: MatchCelebration page after mutual match | Native: match-celebration route exists | Verify visual and copy parity. |
| 42 | **Navigation / shell** | Visual | Medium | Both | Web: BottomNav, glass-card header, section rhythm | Native: tab bar and GlassHeaderBar in place | Align tab bar and header styling (height, padding, icons) to web. |
| 43 | **Loading / empty / error** | Visual/UX | Low | Both | Web: skeletons, empty states, error states per screen | Native: has skeletons and empty/error; copy and layout may differ | Align copy and layout for key screens. |
| 44 | **Typography / buttons / cards** | Visual | Low | Both | Web: design tokens, glass cards, primary/secondary buttons | Native: theme and primitives in place; font loading (Inter/Space Grotesk) may differ | Align font loading and final token values; ensure buttons/cards match web. |

---

## 2. Top-Priority Shortlist (Critical and High)

| Priority | # | Item | Why |
|----------|---|------|-----|
| P0 | 1, 2 | Dashboard: date reminders + active call rejoin banner | Core loop: user must see imminent dates and rejoin an active call; without these, experience is broken. |
| P0 | 8 | Onboarding: 2 steps vs 8; missing photos, vibes, location, birthDate, vibe video | Incomplete profile blocks matching and event relevance; web and backend expect full onboarding. |
| P0 | 13 | Event detail: no payment, no venue, no guest list, no manage/cancel | Paid events and event discovery are central; native cannot complete registration or manage booking. |
| P0 | 16 | Lobby: no realtime match queue → Ready Gate never shows for queued matches | After "match queued", user never gets Ready Gate on native; flow is dead. |
| P1 | 3, 4, 5 | Dashboard: notification permission flow, phone verification nudge, deletion recovery banner | Trust and re-engagement; prevents support issues. |
| P1 | 11 | Events list: location prompt gated and functional | Events relevance depends on location; currently disabled. |
| P1 | 18, 19 | Matches: unmatch/archive/block/mute + profile drawer | Safety and control; expected in any dating product. |
| P1 | 25, 26 | Chat: date proposals/schedule + arcade/games | Differentiators; chat feels incomplete without them. |
| P1 | 29, 32 | Profile: verification + Safety Hub; Settings: notifications/privacy/account drawers | Trust and control; reduces "use web for that" friction. |
| P1 | 35, 36 | Credits: in-app checkout or return deep link; Notifications: in-app toggles | Monetization and retention; credits and notifications are high-touch. |

---

## 3. Recommended Remediation Sequence (2–3 Sprints)

### Sprint A — Core loop and lobby (critical)

- **Goal:** Dashboard usable for "next date" and "rejoin call"; event detail supports paid registration and basic info; lobby Ready Gate works for queued matches.
- **Items:** 1, 2, 13 (minimal: venue, pricing, payment or "Pay on web" + manage/cancel), 16.
- **Outcome:** User can see reminders, rejoin a call, register (or pay) for events, and get Ready Gate when a queued match is ready.

### Sprint B — Onboarding and trust

- **Goal:** Onboarding captures enough data for matching and events; dashboard and settings build trust.
- **Items:** 8 (extend to 8 steps or add "Complete on web" for missing steps), 3, 4, 5, 11, 29 (verification + Safety Hub entry), 32 (notifications/privacy/account/feedback).
- **Outcome:** New users complete profile; existing users get notification and phone verification nudges, deletion recovery, and in-app settings where possible.

### Sprint C — Matches, chat, and monetization

- **Goal:** Matches list and chat feel complete; credits and premium are usable on device.
- **Items:** 18, 19, 20, 21 (Drops tab), 25 (date proposals in chat), 26 or "Play on web" for arcade, 35 (credits checkout or return deep link), 36 (in-app notification toggles if supported).
- **Outcome:** Unmatch/archive/block/mute, profile drawer, report, Drops tab; date suggestions in chat; credits and notifications manageable in-app.

---

## 4. Verdict: Product Parity, Beta, Release-Ready

- **Product parity:** **Incomplete.** Many screens and flows are missing or reduced (dashboard reminders and rejoin, onboarding depth, event payment/venue/guests, lobby realtime Ready Gate, matches actions and profile drawer, chat date/arcade/call, profile verification and Safety Hub, settings drawers and toggles, credits checkout, notification preferences). Visual parity is closer but not complete (typography, some cards/sections).
- **Beta candidate:** **Only if critical path is fixed.** With Sprint A done (reminders, rejoin, event payment/venue, lobby realtime Ready Gate), the app can be considered for a limited beta where users are told "some features are on web." Without Sprint A, beta is risky (broken lobby flow, no paid events, no rejoin).
- **Release-ready:** **No.** Release-ready requires at least Sprints A and B and most of C (matches safety, chat proposals, credits, notifications). Provider proof (RevenueCat, OneSignal, Daily) and store submission are separate; this audit is about product parity and functionality only.

**Summary:** The native app builds and runs on a real device but is **not** at product parity with the web app. Several functionalities are missing or only partially implemented. The highest-impact gaps are: (1) dashboard date reminders and active-call rejoin, (2) full onboarding, (3) event detail payment/venue/guests and manage booking, (4) lobby realtime match queue so Ready Gate appears for queued matches. Until these are addressed, the app is **product parity incomplete** and should be treated as **beta candidate only after Sprint A**, not release-ready.

---

## 5. Files and Areas Touched by Audit

- **Web:** `src/pages/*` (Dashboard, Onboarding, Events, EventDetails, EventLobby, Matches, Chat, Profile, Settings, Premium, Credits, etc.), `src/components/*` (schedule, notifications, lobby, chat, events, profile, settings).
- **Native:** `apps/mobile/app/**/*.tsx` (tabs, auth, onboarding, event, lobby, chat, matches, profile, settings, premium, daily-drop, ready), `apps/mobile/lib/*.ts` (eventsApi, chatApi, profileApi, etc.), `apps/mobile/components/*`.
- **Docs:** `docs/native-final-blocker-matrix.md`, `docs/phase7-stage5-release-readiness-and-go-nogo.md`, `src/App.tsx` (routes).
