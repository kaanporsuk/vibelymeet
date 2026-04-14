# Web vs Native Comparative Audit

**Date:** 2025-03-16  
**Web app:** `src/` (React + Vite + TypeScript, Tailwind, shadcn/ui, Framer Motion, react-router-dom)  
**Native app:** `apps/mobile/` (Expo + React Native, StyleSheet, Expo Router)  
**Shared backend:** `supabase/`

---

## SECTION 1: ROUTE/SCREEN COMPARISON

| Web route path | Web component | Native screen exists? | Native file path |
|----------------|---------------|------------------------|------------------|
| `/` | Index | Yes (redirect only) | `apps/mobile/app/index.tsx` |
| `/auth` | Auth | Yes | `apps/mobile/app/(auth)/sign-in.tsx`, `sign-up.tsx` (split) |
| `/reset-password` | ResetPassword | Yes | `apps/mobile/app/(auth)/reset-password.tsx` |
| `/onboarding` | Onboarding | Yes | `apps/mobile/app/(onboarding)/index.tsx` |
| `/dashboard` | Dashboard | Yes | `apps/mobile/app/(tabs)/index.tsx` |
| `/home` | Dashboard (alias) | Yes | Same as dashboard: `(tabs)/index.tsx` |
| `/events` | Events | Yes | `apps/mobile/app/(tabs)/events/index.tsx` |
| `/events/:id` | EventDetails | Yes | `apps/mobile/app/(tabs)/events/[id].tsx` |
| `/event/:eventId/lobby` | EventLobby | Yes | `apps/mobile/app/event/[eventId]/lobby.tsx` |
| `/matches` | Matches | Yes | `apps/mobile/app/(tabs)/matches/index.tsx` |
| `/chat/:id` | Chat | Yes | `apps/mobile/app/chat/[id].tsx` |
| `/profile` | Profile | Yes | `apps/mobile/app/(tabs)/profile/index.tsx` |
| `/settings` | Settings | Yes | `apps/mobile/app/settings/index.tsx` (+ stack: notifications, credits, account, privacy) |
| `/date/:id` | VideoDate | Yes | `apps/mobile/app/date/[id].tsx` |
| `/ready/:id` | ReadyGate (ReadyRedirect) | Yes | `apps/mobile/app/ready/[id].tsx` |
| `/admin/create-event` | AdminCreateEvent | **MISSING** | — |
| `/match-celebration` | MatchCelebration | Yes | `apps/mobile/app/match-celebration.tsx` |
| `/vibe-studio` | VibeStudio | Yes (foundation) | `apps/mobile/app/vibe-studio.tsx` + `apps/mobile/app/vibe-video-record.tsx` |
| `/schedule` | Schedule | **MISSING** | — |
| `/how-it-works` | HowItWorks | **MISSING** | — |
| `/privacy` | PrivacyPolicy | **MISSING** (no legal route) | — |
| `/terms` | TermsOfService | **MISSING** | — |
| `/delete-account` | DeleteAccountWeb | **MISSING** (account deletion via settings/account) | — |
| `/community-guidelines` | CommunityGuidelines | **MISSING** | — |
| `/premium` | Premium | Yes | `apps/mobile/app/premium.tsx` |
| `/subscription/success` | SubscriptionSuccess | **MISSING** | — |
| `/subscription/cancel` | SubscriptionCancel | **MISSING** | — |
| `/event-payment/success` | EventPaymentSuccess | **MISSING** | — |
| `/credits` | Credits | Yes (in settings stack) | `apps/mobile/app/settings/credits.tsx` |
| `/credits/success` | CreditsSuccess | **MISSING** | — |
| `/user/:userId` | UserProfile | Yes | `apps/mobile/app/user/[userId].tsx` |
| `/kaan` | AdminLogin | **MISSING** | — |
| `/kaan/dashboard` | AdminDashboard | **MISSING** | — |
| `*` (404) | NotFound | Yes | `apps/mobile/app/+not-found.tsx` |

**Native-only routes (no web equivalent):**

| Native route | Purpose |
|--------------|---------|
| `(auth)/sign-in`, `(auth)/sign-up` | Split auth (web has single `/auth`) |
| `daily-drop` | Daily Drop screen (web may use different path) |
| `settings/notifications` | Notifications settings (web: drawer/settings) |
| `settings/account` | Account settings |
| `settings/privacy` | Privacy settings |
| `modal` | Placeholder modal (Expo Router default) |

---

## SECTION 2: HOOK COMPARISON

| Web hook | Web file path | Native equivalent exists? | Native file path | Notes |
|----------|----------------|---------------------------|------------------|-------|
| useActivityHeartbeat | src/hooks/useActivityHeartbeat.ts | **MISSING** | — | Web: session heartbeat |
| useAppBootstrap | src/hooks/useAppBootstrap.ts | **MISSING** | — | Web: bootstrap logic |
| useDateReminders | src/hooks/useDateReminders.ts | Yes | apps/mobile/lib/useDateReminders.ts | Native uses DateProposal from useDateProposals |
| useProfiles | src/hooks/useProfiles.ts | Partial | profileApi.ts (fetchMyProfile, updateMyProfile) | No useProfiles hook; profile fetched in screens |
| useServiceWorker | src/hooks/useServiceWorker.ts | **MISSING** | — | N/A native |
| useCredits | src/hooks/useCredits.ts | Inline in settings | apps/mobile/app/settings/index.tsx, credits.tsx | Native: inline useQuery for credits |
| useEventVibes | src/hooks/useEventVibes.ts | **MISSING** | — | Web: event vibes for details |
| useDropMatches | *(deleted — session cleanup)* | — | — | Was obsolete; Daily Drop uses useDailyDrop |
| useEventNotifications | *(removed — PR #143)* | — | — | Was web-only; deleted |
| useVideoCall | src/hooks/useVideoCall.ts | Yes (different API) | apps/mobile/lib/videoDateApi.ts | Native: useVideoDateSession, getDailyRoomToken, enterHandshake, endVideoDate |
| useEventStatus | src/hooks/useEventStatus.ts | **MISSING** | — | Web: lobby status; native lobby uses deck + ready gate only |
| useAdminActivityLog | src/hooks/useAdminActivityLog.ts | **MISSING** | — | No admin in native |
| useSchedule | src/hooks/useSchedule.ts | Partial | useDateProposals.ts, useDateReminders.ts | Native has date proposals/reminders, no full schedule (time blocks, mutual availability) |
| useDeleteAccount | src/hooks/useDeleteAccount.ts | **MISSING** | — | Native: link to web for delete |
| useDailyDrop | src/hooks/useDailyDrop.ts | Yes | apps/mobile/lib/dailyDropApi.ts | useDailyDrop in both |
| useEventAttendees | src/hooks/useEventAttendees.ts | **MISSING** | — | Web: event details attendees |
| useDailyDropNotifications | src/hooks/useDailyDropNotifications.ts | **MISSING** | — | |
| useMatchCall | src/hooks/useMatchCall.tsx + app-level provider mount | apps/mobile/lib/useMatchCall.tsx + app-level provider mount | Both clients now use a global match-call controller with app-level overlays and realtime INSERT/UPDATE reconciliation. |
| useMatchQueue | src/hooks/useMatchQueue.ts | **MISSING** | — | Web: lobby match queue |
| useMatches | src/hooks/useMatches.ts | Yes | apps/mobile/lib/chatApi.ts | useMatches in chatApi |
| useMessages | src/hooks/useMessages.ts | Yes | apps/mobile/lib/chatApi.ts | useMessages, useSendMessage |
| useDeletionRecovery | src/hooks/useDeletionRecovery.ts | Yes | apps/mobile/lib/useDeletionRecovery.ts | |
| usePremium | src/hooks/usePremium.ts | Yes | apps/mobile/lib/subscriptionApi.ts | useBackendSubscription (isPremium, etc.) |
| useBlockUser | src/hooks/useBlockUser.ts | Yes | apps/mobile/lib/useBlockUser.ts | |
| useMuteMatch | src/hooks/useMuteMatch.ts | Yes | apps/mobile/lib/useMuteMatch.ts | |
| useNotificationPreferences | src/hooks/useNotificationPreferences.ts | Yes | apps/mobile/lib/useNotificationPreferences.ts | |
| useReconnection | src/hooks/useReconnection.ts | **MISSING** | — | Web: video date reconnection |
| useSubscription | src/hooks/useSubscription.ts | Yes | apps/mobile/lib/subscriptionApi.ts | useBackendSubscription |
| useRealtimeMessages | src/hooks/useRealtimeMessages.ts | Yes | apps/mobile/lib/chatApi.ts | useRealtimeMessages |
| useEvents | src/hooks/useEvents.ts | Yes | apps/mobile/lib/eventsApi.ts | useEvents, useNextRegisteredEvent, etc. |
| useSoundEffects | src/hooks/useSoundEffects.ts | **MISSING** | — | Web: match/UI sounds |
| useEmailVerification | src/hooks/useEmailVerification.ts | **MISSING** | — | |
| useEventDeck | src/hooks/useEventDeck.ts | Yes | apps/mobile/lib/eventsApi.ts | useEventDeck |
| useSwipeAction | src/hooks/useSwipeAction.ts | **MISSING** (logic in API) | eventsApi.ts (swipe()) | Native: swipe() in eventsApi, no useSwipeAction hook |
| useVisibleEvents | src/hooks/useVisibleEvents.ts | **MISSING** | — | Web: visible/other-city events; native uses useEvents only |
| useLogout | src/hooks/useLogout.ts | N/A | AuthContext signOut | Native: signOut from context |
| usePushNotifications | src/hooks/usePushNotifications.ts | Yes (different) | apps/mobile/lib/onesignal.ts, usePushPermission.ts | Native: OneSignal + usePushPermission |
| useReengagementNotifications | *(removed — PR #143)* | — | — | Was web-only; deleted |
| usePushNotificationEvents | src/hooks/usePushNotificationEvents.ts | **MISSING** | — | |
| useRegistrations | src/hooks/useRegistrations.ts | Partial | eventsApi.ts (useRegisterForEvent, useIsRegisteredForEvent) | No useUserRegistrations equivalent |
| useEventDetails | src/hooks/useEventDetails.ts | Yes | apps/mobile/lib/eventsApi.ts | useEventDetails, useIsRegisteredForEvent |
| useMysteryMatch | *(deleted — session cleanup)* | — | apps/mobile/lib/useMysteryMatch.ts | Web copy removed |
| useEventLifecycle | src/hooks/useEventLifecycle.ts | **MISSING** | — | Web: PostDateSurvey |
| useNetworkStatus | *(deleted — session cleanup)* | — | apps/mobile/lib/useNetworkStatus.ts | Web copy removed |
| useFaceVerification | src/hooks/useFaceVerification.ts | **MISSING** | — | |
| use-toast | src/hooks/use-toast.ts | **MISSING** | — | Native: Alert / in-app toasts |
| useAdminRealtime | src/hooks/useAdminRealtime.ts | **MISSING** | — | No admin |
| usePushAnalytics | src/hooks/usePushAnalytics.ts | **MISSING** | — | |
| useArchiveMatch | src/hooks/useArchiveMatch.ts | Yes | apps/mobile/lib/useArchiveMatch.ts | |
| useEventReminders | src/hooks/useEventReminders.ts | **MISSING** | — | Web: NotificationManager |
| useReadyGate | src/hooks/useReadyGate.ts | Yes | apps/mobile/lib/readyGateApi.ts | useReadyGate |
| useInfiniteScroll | *(deleted — session cleanup)* | — | — | Unused on web |
| useUnmatch | src/hooks/useUnmatch.ts | Yes | apps/mobile/lib/useUnmatch.ts | Web: useUndoableUnmatch; native: useUnmatch (no undo) |
| use-mobile (useIsMobile) | src/hooks/use-mobile.ts | N/A | — | Not applicable (native is always “mobile”) |

**Native-only hooks / API (no direct web hook file):**

- `useActiveSession` — apps/mobile/lib/useActiveSession.ts (active video date session for rejoin banner)
- `useDateProposals` — apps/mobile/lib/useDateProposals.ts (accepted date proposals for reminders)
- `usePushPermission` — apps/mobile/lib/usePushPermission.ts (OneSignal permission flow)
- reportApi (submitReport) — apps/mobile/lib/reportApi.ts
- getImageUrl, avatarUrl, eventCoverUrl — apps/mobile/lib/imageUrl.ts (Bunny CDN)
- getVibeVideoPlaybackUrl, getVibeVideoThumbnailUrl — apps/mobile/lib/vibeVideoPlaybackUrl.ts
- creditsCheckout (getCreditsCheckoutUrl) — apps/mobile/lib/creditsCheckout.ts
- chatMediaUpload (uploadVoiceMessage, uploadChatVideoMessage) — apps/mobile/lib/chatMediaUpload.ts

---

## SECTION 3: FEATURE COMPLETENESS PER SCREEN

### Dashboard (Web: Dashboard.tsx | Native: (tabs)/index.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useNextRegisteredEvent, useEvents, useRealtimeEvents, useDashboardMatches (useMatches), useSchedule, useDateReminders, usePushNotifications, useOtherCityEvents, useDeletionRecovery | useEvents, useNextRegisteredEvent, useMatches, useDateProposals, useDateReminders, useActiveSession, useDeletionRecovery, usePushPermission | Native: no useRealtimeEvents (no live events subscription); no useSchedule (only date reminders); no useOtherCityEvents / “Happening Elsewhere” rail |
| Components | BottomNav, DateReminderCard, MiniDateCountdown, NotificationPermissionFlow, DashboardGreeting, PullToRefresh, ActiveCallBanner, EventCover/ProfilePhoto, EventCardSkeleton, MatchAvatarSkeleton, PhoneVerificationNudge, DeletionRecoveryBanner, motion/AnimatePresence | GlassHeaderBar, DashboardGreeting, DateReminderCard, MiniDateCountdown, ActiveCallBanner, DeletionRecoveryBanner, NotificationPermissionFlow, PhoneVerificationNudge, Card, Avatar, EventCardSkeleton, MatchAvatarSkeleton | Native: no PullToRefresh (uses RefreshControl); no BottomNav (tabs); no Framer Motion |
| Interactions | Navigate to event detail, lobby, chat, profile; refresh; notification permission; phone nudge dismiss; deletion recovery cancel; rejoin active call | Same + refresh | Parity except “Happening Elsewhere” / other-city events |
| Data / Realtime | useRealtimeEvents (subscription) | None for events list | Native does not subscribe to events realtime |

### Events list (Web: Events.tsx | Native: (tabs)/events/index.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useVisibleEvents, useOtherCityEvents, useUserProfile | useEvents, useAuth | Native: no useVisibleEvents / useOtherCityEvents (no location-filtered “visible” or “other city”); no featured/other-city rails |
| Components | FeaturedEventCard, EventsFilterBar, EventsRail, EventCardPremium, LocationPromptBanner, BottomNav | Card, GlassHeaderBar, LocationPromptBanner (shell), event cards, filter chips | Native: no FeaturedEventCard; no EventsRail component (custom rails); no EventCardPremium; filter is local (Tonight/This Week/etc.) |
| Interactions | Location prompt enable (geolocation + geocode), filter, navigate to detail | Location prompt (dismiss / open web), filter, navigate to detail | Native: location set on web only |
| Data | visible-events, other-city-events queries; geocode edge | useEvents (single list) | Native: single events list, no geo-based split |

### Event detail (Web: EventDetails.tsx | Native: (tabs)/events/[id].tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useEventDetails, useEventAttendees, useIsRegisteredForEvent, useRegisterForEvent, useRealtimeEvents, useEventVibes, useSubscription | useEventDetails, useIsRegisteredForEvent, useRegisterForEvent | Native: no useEventAttendees, no useEventVibes, no useRealtimeEvents, no useSubscription (premium gate) |
| Components | WhosGoingSection, GuestListRoster, PricingBar, PaymentModal, ManageBookingModal, CancelBookingModal, EventCardPremium, AttendeeCard, VenueCard, PremiumPill | VenueCard, PricingBar, ManageBookingModal, GlassHeaderBar, Card | Native: no WhosGoingSection / guest list, no PaymentModal (web checkout), no CancelBookingModal, no AttendeeCard, no premium gate component |
| Interactions | Register, unregister, manage booking, pay (modal), cancel booking, see attendees | Register, unregister, manage booking, open web for payment | Native: payment and full attendee list on web |
| Data | Event attendees, realtime events, event vibes | Event + registration only | Native: no attendees list, no vibes |

### Event lobby (Web: EventLobby.tsx | Native: event/[eventId]/lobby.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useEventDetails, useIsRegisteredForEvent, useEventDeck, useSwipeAction, useEventStatus, useMatchQueue | useEventDetails, useIsRegisteredForEvent, useEventDeck, swipe() from eventsApi | Native: no useEventStatus, no useMatchQueue, no useSwipeAction (uses swipe() only) |
| Components | LobbyProfileCard, LobbyEmptyState, ReadyGateOverlay, PremiumPill, motion/AnimatePresence, PanInfo swipe | LobbyProfileCard (inline/custom), ReadyGateOverlay, Card, Skeleton | Native: no LobbyEmptyState component; swipe is button-based or simpler |
| Interactions | Swipe cards (vibe/pass/super), enter ready gate, match queue, status updates | Swipe (buttons/actions), open ready gate, deck refetch | Native: no match queue UI; no event status subscription |
| Data | Realtime event status, match queue | Realtime: lobby reg + video_sessions (in lobby.tsx channel), deck from useEventDeck | Native: no dedicated useEventStatus subscription |

### Matches (Web: Matches.tsx | Native: (tabs)/matches/index.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useMatches, useUndoableUnmatch, useArchiveMatch, useBlockUser, useMuteMatch, useSubscription | useMatches, useUnmatch, useBlockUser, useArchiveMatch, useMuteMatch | Native: no useSubscription (WhoLikedYouGate); unmatch is immediate (no undo) |
| Components | NewVibesRail, SwipeableMatchCard, EmptyMatchesState, ProfileDetailDrawer, DropsTabContent, UnmatchDialog, ArchiveMatchDialog, BlockUserDialog, MuteOptionsSheet, ArchivedMatchesSection, ReportWizard, WhoLikedYouGate, Tabs (conversations/drops) | MatchListRow, MatchActionsSheet, ReportFlowModal, EmptyState, SettingsRow (Drops CTA) | Native: no NewVibesRail, no SwipeableMatchCard, no ProfileDetailDrawer, no DropsTabContent (link to web); MatchActionsSheet instead of separate dialogs; no WhoLikedYouGate |
| Interactions | Search, sort, tabs (conversations/drops), unmatch (undo), archive, block, mute, report, open profile drawer, open chat | Search, sort, tabs (conversations/drops), unmatch (no undo), archive, block, mute, report, open chat | Native: no undo unmatch; no profile drawer; Drops = “use on web” CTA |
| Data | Drop matches, subscription for gate | Matches only | Native: no drop matches data |

### Chat (Web: Chat.tsx | Native: chat/[id].tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useRealtimeMessages, useMessages, useSendMessage, usePublishVoiceMessage, useMatchCall, useUserProfile; DateProposal from useSchedule | useMessages, useSendMessage, useRealtimeMessages, useMatches, useUnmatch, useBlockUser, useArchiveMatch, useMuteMatch, useMatchCall | Chat-call lifecycle is now global on both clients; native still differs on non-call chat surfaces like date suggestions and arcade. |
| Components | MessageBubble, TypingIndicator, VideoDateCard, DateSuggestionChip, ChatHeader, VoiceRecorder, VideoMessageRecorder, VoiceMessageBubble, VideoMessageBubble, VibeSyncModal, DateProposalTicket, VibeArcadeMenu, GameBubbleRenderer, TwoTruthsCreator, WouldRatherCreator, etc., IncomingCallOverlay, ActiveCallOverlay | Inline VoiceMessageBubble, VideoView for chat video, MatchActionsSheet, ReportFlowModal, GlassHeaderBar, IncomingCallOverlay, ActiveCallOverlay | Native still lacks several non-call chat components, but in-chat voice/video call overlays now exist and are mounted globally instead of per-thread. |
| Interactions | Send text/voice/video, date proposals, open VibeSync, open arcade games, accept/decline call, reaction | Send text/voice/video (image picker), match actions, report | Native: no in-chat video call UI; no date proposal/scheduling UI; no arcade; no call overlays |
| Data | Realtime messages, global match call state (`match_calls` INSERT/UPDATE) | Realtime messages, global match call state (`match_calls` INSERT/UPDATE) | Call-state subscription parity is now present on both clients; native remains stronger on outbox/offline message handling. |

### Profile (Web: Profile.tsx | Native: (tabs)/profile/index.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useLogout, usePremium, useUserProfile; profile fetch | fetchMyProfile, updateMyProfile, useAuth, deleteVibeVideo, getVibeVideoPlaybackUrl, getVibeVideoThumbnailUrl, uploadProfilePhoto | Native: no usePremium (no premium gate on profile); profile via fetchMyProfile/updateMyProfile |
| Components | ProfilePhoto, PhotoManager/PhotoGallery, VibeTagSelector, LifestyleDetails, RelationshipIntent, ProfilePrompt, VerificationBadge, PhoneVerifiedBadge, PhotoVerifiedMark, PremiumSettingsCard, DeleteAccountModal, BottomNav, VibePlayer | GradientSurface, Card, Chip, VibelyInput, SettingsRow, VibeVideoPlayer (expo-video HLS), avatarUrl/getImageUrl | Native: no LifestyleDetails, no RelationshipIntent, no ProfilePrompt, no VerificationBadge/PhoneVerifiedBadge/PhotoVerifiedMark components (logic may be inline); no PremiumSettingsCard; delete account via link to web |
| Interactions | Edit profile, photo upload/delete, vibe video upload/delete, verification prompts, premium CTA, delete account | Edit profile, photo upload/delete, vibe video delete, share, link to settings | Largely parity; verification/premium/delete often defer to web |

### Settings (Web: Settings.tsx | Native: settings/index.tsx + stack)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useLogout, useDeleteAccount, useCredits, usePremium, useUserProfile | useAuth (signOut), useBackendSubscription, inline useCredits | Native: no useDeleteAccount (delete on web); credits/premium present |
| Components | NotificationsDrawer, AccountSettingsDrawer, DeleteAccountModal, FeedbackDrawer, PremiumSettingsCard, DeletionRecoveryBanner | GlassHeaderBar, Card, SettingsRow, DestructiveRow, DeletionRecoveryBanner (in account) | Native: no NotificationsDrawer/FeedbackDrawer; account screen has verification + deletion recovery; delete account link to web |
| Interactions | Logout, manage subscription (portal), credits, notifications, account, delete account, feedback | Logout, manage subscription (portal), credits, navigate to notifications/account/privacy | Native: delete account and full feedback on web |

### Video date (Web: VideoDate.tsx | Native: date/[id].tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useVideoCall, useCredits, useReconnection, useEventStatus | useVideoDateSession, getDailyRoomToken, enterHandshake, endVideoDate, deleteDailyRoom | Native: no useCredits in screen; no useReconnection (reconnection overlay) |
| Components | HandshakeTimer, IceBreakerCard, VideoDateControls, SelfViewPIP, ConnectionOverlay, PartnerProfileSheet, PostDateSurvey, UrgentBorderEffect, VibeCheckButton, MutualVibeToast, KeepTheVibe, ReconnectionOverlay | Daily.createCallObject, DailyMediaView, avatarUrl, minimal UI | Native: no HandshakeTimer, IceBreakerCard, PartnerProfileSheet, PostDateSurvey, UrgentBorderEffect, VibeCheckButton, MutualVibeToast, KeepTheVibe, ReconnectionOverlay; core Daily join/leave works |
| Interactions | Join, leave, handshake timer, vibe check, post-date survey, reconnection | Join, leave, permissions | Native: minimal UX; no post-date survey, no reconnection overlay, no vibe check |

### Ready gate (Web: ReadyRedirect.tsx | Native: ready/[id].tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useReadyGate, useEventStatus | useReadyGate | Native: no useEventStatus |
| Components | (Ready gate UI) | GlassHeaderBar, Card, VibelyButton, ErrorState, avatarUrl | Parity for core ready/forfeit/snooze; native has minimal styling |

### Premium (Web: Premium.tsx | Native: premium.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useSubscription | useBackendSubscription, getOfferings, purchasePackage, restorePurchases (RevenueCat) | Parity |
| Components | (Premium hero, feature list, Stripe/checkout) | GlassHeaderBar, Card, VibelyButton, RevenueCat offerings | Native: RevenueCat IAP; web: Stripe. No subscription success/cancel screens on native |

### Credits (Web: Credits.tsx | Native: settings/credits.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useCredits | useQuery credits, getCreditsCheckoutUrl | Native: checkout URL opens web; no CreditsSuccess route |

### Daily Drop (Web: component/section in Matches or dedicated) | Native: daily-drop.tsx

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | useDailyDrop | useDailyDrop | Native: useDailyDrop present; full drop flow may link to web |
| Components | DailyDropSection, DropZoneWidget, VibeReplyModal, etc. | useDailyDrop state, list, pass/reveal actions | Native: simplified; some flows “use on web” |

### User profile (public) (Web: UserProfile.tsx | Native: user/[userId].tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Hooks | (profile fetch, match state) | fetchPublicProfile (publicProfileApi) | Native: fetchPublicProfile; action buttons (chat, report, etc.) |

### Onboarding (Web: Onboarding.tsx | Native: (onboarding)/index.tsx)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Components | ProfileWizard, OnboardingStep, etc. | Onboarding steps, “Complete on web” fallback | Native: reduced flow; full wizard on web |

### Auth (Web: Auth.tsx | Native: (auth)/sign-in, sign-up, reset-password)

| Aspect | Web | Native | Gap |
|--------|-----|--------|-----|
| Single auth page vs split | One Auth page | Sign-in, sign-up, reset-password separate | Structural parity for flows |

---

## SECTION 4: COMPONENT LIBRARY COMPARISON

Product-specific web components in `src/components/` (excluding `ui/`) vs native.

| Web component | Native equivalent | Status |
|---------------|-------------------|--------|
| ArchiveMatchDialog | MatchActionsSheet (archive action) | PARTIAL |
| ArchivedMatchesSection | (filter archived in list) | PARTIAL |
| BlockUserDialog | MatchActionsSheet (block action) | PARTIAL |
| BottomNav | Tab bar (Expo Tabs) | EXISTS (different pattern) |
| DashboardGreeting | DashboardGreeting | EXISTS |
| EmptyMatchesState | EmptyState in ui | EXISTS |
| EventCard | Card + event content in events/index, [id] | PARTIAL |
| HeightSelector | — | MISSING |
| LazyImage | Image + optional placeholder | PARTIAL |
| LifestyleDetails | — | MISSING |
| MatchAvatar | Avatar in list rows | PARTIAL |
| MuteOptionsSheet | MatchActionsSheet (mute) | PARTIAL |
| NavLink | router/link | EXISTS (Expo Router) |
| NewVibesRail | — | MISSING |
| OfflineBanner | — | MISSING |
| OnboardingStep | — | PARTIAL (onboarding screen exists) |
| PageTransition | — | MISSING (no Framer Motion) |
| PhoneVerification | — | MISSING (nudge links to web) |
| PhoneVerificationNudge | PhoneVerificationNudge | EXISTS |
| PhoneVerifiedBadge | — | MISSING |
| PhotoGallery | — | PARTIAL (profile photos) |
| PhotoManager | — | PARTIAL (profile) |
| PhotoPreviewModal | — | MISSING |
| PhotoVerifiedMark | — | MISSING |
| ProfileDetailDrawer | — | MISSING |
| ProfilePreview | — | PARTIAL (user [userId]) |
| ProfilePrompt | — | MISSING |
| ProgressBar | — | PARTIAL (ui) |
| ProtectedRoute | Auth redirect in layout/index | EXISTS |
| PullToRefresh | RefreshControl | EXISTS |
| PushPermissionPrompt | NotificationPermissionFlow | EXISTS |
| RelationshipIntent | — | MISSING |
| ReportWizard | ReportFlowModal | PARTIAL |
| ShimmerSkeleton | Skeleton | PARTIAL |
| Skeleton | Skeleton (ui) | EXISTS |
| SuperLikeButton | — | MISSING |
| SwipeableMatchCard | — | MISSING (list row instead) |
| UnmatchDialog | MatchActionsSheet (unmatch) | PARTIAL |
| VerificationBadge | — | MISSING |
| VibeScore | VibeScoreDisplay (inline in profile) | PARTIAL |
| VibeTag | Chip | PARTIAL |
| VibeTagSelector | Chips in profile | PARTIAL |
| admin/* | — | MISSING (no admin) |
| arcade/* (VibeArcadeMenu, GameBubbleRenderer, games, creators) | — | MISSING |
| chat/ActiveCallOverlay | src/components/chat/ActiveCallOverlay.tsx | apps/mobile/components/chat/ActiveCallOverlay.tsx |
| chat/ChatHeader | GlassHeaderBar + header content | PARTIAL |
| chat/DateSuggestionChip | — | MISSING |
| chat/EmojiBar | — | MISSING |
| chat/IncomingCallOverlay | src/components/chat/IncomingCallOverlay.tsx | apps/mobile/components/chat/IncomingCallOverlay.tsx |
| chat/MessageBubble | Inline message rendering | PARTIAL |
| chat/MessageStatus | — | MISSING |
| chat/ParticleBurst | — | MISSING |
| chat/ReactionBadge | Inline reaction display (e.g. `voiceReactionBadge` `Text` on voice rows) — not the web `ReactionBadge` component | PARTIAL |
| chat/TypingIndicator | — | MISSING |
| chat/VideoDateCard | **Removed / never in tree** — use date suggestion cards + Vibe Clip UI | Native: `VibeClipCard`, `DateSuggestionSheet` |
| chat/VideoMessageBubble | VideoView in bubble | PARTIAL |
| chat/VideoMessageRecorder | — | PARTIAL (image picker for video) |
| chat/VoiceMessageBubble | Inline VoiceMessageBubble | EXISTS |
| chat/VoiceMessagePlayer | expo-audio in bubble | EXISTS |
| chat/VoiceRecorder | — | PARTIAL (expo-audio recorder) |
| daily-drop/* (DailyDropSection, DropZoneWidget, etc.) | daily-drop screen | PARTIAL |
| events/ActiveCallBanner | ActiveCallBanner | EXISTS |
| events/AttendeeCard | — | MISSING |
| events/CancelBookingModal | — | MISSING |
| events/EmptyDeckFallback | — | MISSING |
| events/EventCardPremium | — | MISSING |
| events/EventEndedModal | — | MISSING |
| events/EventsFilterBar | Filter chips | PARTIAL |
| events/EventsRail | Custom rails | PARTIAL |
| events/FeaturedEventCard | — | MISSING |
| events/GuestListRoster | — | MISSING |
| events/GuestListTeaser | — | MISSING |
| events/ManageBookingModal | ManageBookingModal | EXISTS |
| events/MiniProfileModal | — | MISSING |
| events/MutualVibesSection | — | MISSING |
| events/PaymentModal | — | MISSING (web checkout) |
| events/PricingBar | PricingBar | EXISTS |
| events/TicketStub | — | MISSING |
| events/VenueCard | VenueCard | EXISTS |
| events/WhosGoingSection | — | MISSING |
| lobby/LobbyEmptyState | — | MISSING |
| lobby/LobbyProfileCard | (inline card in lobby) | PARTIAL |
| lobby/ReadyGateOverlay | ReadyGateOverlay | EXISTS |
| match/MatchSuccessModal | — | MISSING |
| notifications/* (NotificationContainer, Manager, etc.) | NotificationPermissionFlow, PushRegistration | PARTIAL |
| premium/WhoLikedYouGate | — | MISSING |
| premium/PremiumSettingsCard | — | MISSING |
| premium/PremiumPill | — | MISSING |
| safety/* (ReportWizard, SafetyHub, etc.) | ReportFlowModal | PARTIAL |
| schedule/DateProposalSheet | — | MISSING |
| schedule/DateProposalTicket | — | MISSING |
| schedule/DateReminderCard | DateReminderCard | EXISTS |
| schedule/MyDatesSection | — | MISSING |
| schedule/TimeBlockCell | — | MISSING |
| schedule/VibeSchedule | — | MISSING |
| schedule/VibeSyncModal | — | MISSING |
| settings/DeletionRecoveryBanner | DeletionRecoveryBanner | EXISTS |
| settings/DeleteAccountModal | — | MISSING (link to web) |
| verification/* | — | MISSING (link to web) |
| vibe-video/VibePlayer | VibeVideoPlayer (expo-video HLS) | EXISTS |
| vibe-video/VibeStudioModal | Vibe studio route orchestration | EXISTS via `app/vibe-studio.tsx` + `app/vibe-video-record.tsx` handoff |
| video-date/* (HandshakeTimer, IceBreakerCard, etc.) | — | MISSING (minimal date screen) |
| wizard/* (ProfileWizard, etc.) | — | MISSING / PARTIAL (onboarding) |

---

## SECTION 5: THIRD-PARTY INTEGRATION STATUS

| Integration | Status in native | Details |
|-------------|------------------|---------|
| **Daily.co** (@daily-co/react-native-daily-js) | Wired | Imported and used in `app/date/[id].tsx`: `Daily.createCallObject()`, `DailyMediaView`, join with token from `getDailyRoomToken(sessionId)`, leave/destroy and `deleteDailyRoom(roomName)`. Config plugin in app.json. |
| **Bunny Stream (HLS)** | Wired | `lib/vibeVideoPlaybackUrl.ts`: `getVibeVideoPlaybackUrl`, `getVibeVideoThumbnailUrl` (Bunny Stream CDN, `.m3u8`). Profile screen uses `expo-video` with `contentType: 'hls'` for vibe videos. |
| **Bunny Storage/CDN (photos)** | Wired | `lib/imageUrl.ts`: `getImageUrl`, `avatarUrl`, `eventCoverUrl`; `photos/` paths resolved to Bunny CDN via `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`. |
| **Supabase Realtime** | Wired (partial) | **Tables with active subscriptions in native:** (1) `matches` — INSERT/UPDATE in `chatApi.ts` (useMatches); (2) `messages` — INSERT/UPDATE in `chatApi.ts` (useRealtimeMessages); (3) `video_sessions` — UPDATE in `readyGateApi.ts` (useReadyGate) and in `lobby.tsx` (ready gate); (4) `event_registrations` in `lobby.tsx`; (5) `daily_drops` — UPDATE in `dailyDropApi.ts`; (6) `video_sessions` in `videoDateApi.ts`. No realtime for: events list, event details, event status in lobby, notifications. |
| **Push notifications** | Wired | OneSignal: `lib/onesignal.ts` (initOneSignal, registerPushWithBackend, logoutOneSignal). `PushRegistration` in root layout; `usePushPermission` for permission flow. iOS NSE in app.json. |
| **Payments / IAP** | Wired | RevenueCat: `lib/revenuecat.ts` (initRevenueCat, setRevenueCatUserId, getOfferings, purchasePackage, restorePurchases). Initialized in root layout. Premium screen uses RevenueCat for in-app purchase. Stripe portal for subscription management (open URL). |
| **Analytics** | Not present | No PostHog or other analytics SDK initialized in native app. |
| **Error tracking** | Not present | Sentry not initialized in native (only in web; Daily.co dependency tree includes @sentry/browser but app does not use Sentry directly). |
| **Phone verification** | Not wired (web handoff) | No Twilio phone-verify flow in app. `PhoneVerificationNudge` and copy direct user to web for verification. |
| **Email verification** | Not wired | No dedicated email verification flow in native; account/settings link to web where applicable. |

---

## SECTION 6: STYLING/THEME COMPARISON

### Web (src/index.css)

- **Colors:** `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, `--neon-violet`, `--neon-pink`, `--neon-cyan`, `--neon-yellow`, `--neon-*-glow`, `--glass-bg`, `--glass-border`, `--gradient-*`.
- **Fonts:** Inter (body), Space Grotesk (headings); loaded via Google Fonts.
- **Spacing:** Tailwind scale (1=4px, 2=8, 3=12, 4=16, 6=24, 8=32, etc.).
- **Radius:** `--radius: 1rem`; utilities rounded-sm/md/lg/2xl/3xl.

### Native (constants/theme.ts, constants/Colors.ts)

- **Colors:** theme.ts references semantic names; Colors.ts defines `base` (background, surface, text, secondary, muted, border, tint, accent, danger, success, tab, neon*, glassSurface, glassBorder). No explicit `--neon-*-glow` tokens; shadows use hardcoded HSL in theme (e.g. glowViolet, glowPink, glowCyan).
- **Fonts:** theme `fonts.body` / `fonts.display` are `undefined` (system default); SpaceMono loaded in root layout for legacy. No Inter or Space Grotesk in native.
- **Spacing:** theme `spacing` (xs=4, sm=8, md=12, lg=16, xl=24, 2xl=32, 3xl=40) — aligns with web.
- **Radius:** theme `radius` (base=16, xs–3xl, pill, button, input) — aligned.
- **Border:** theme `border.width` (hairline, thin, medium).
- **Layout:** theme `layout` (containerPadding, screenPadding, contentWidth, inputHeight, tabBar*, header*, mainContentPaddingTop, minTouchTargetSize).
- **Button:** theme `button.height` / `button.radius`.
- **Gradient:** theme `gradient.primary` / `gradient.accent` (color arrays; no CSS gradient usage in theme).

### Gaps

- **Missing color tokens:** Native has no `--neon-*-glow` equivalents as first-class tokens (only in shadows). `surfaceSubtle` exists in native only.
- **Missing font definitions:** Inter and Space Grotesk not loaded in native; `fonts.body` / `fonts.display` undefined. Typography scale exists but not tied to web font families.
- **Spacing:** Parity; no major missing values.
- **Hardcoded values in native:** Some shadow colors (e.g. `#000`, `hsl(263, 70%, 66%)`) in theme.ts; success in Colors is `#22c55e` and `rgba(34, 197, 94, 0.16)` — could be tokens. Screen-level styles sometimes use raw numbers instead of theme (e.g. font sizes, margins); not all screens consistently use `typography.*` or `spacing.*`.

---

## SECTION 7: NAVIGATION STRUCTURE

### Web (react-router-dom)

- **Top-level:** BrowserRouter, Routes, single Route tree.
- **Tabs:** No router-level tabs; Dashboard, Events, Matches, Profile are routes; BottomNav component for tab-like links.
- **Protected routes:** ProtectedRoute wrapper for most app routes; requireAdmin for admin routes; requireOnboarding for some.
- **Modals:** Implemented as components (e.g. modals/sheets on top of pages), not route-based.
- **Deep linking:** Standard URL paths (e.g. `/chat/:id`, `/event/:eventId/lobby`).

### Native (Expo Router)

- **Root:** Stack in `_layout.tsx`: index, (auth), (onboarding), (tabs), event/[eventId]/lobby, chat/[id], daily-drop, ready/[id], date/[id], settings, premium, vibe-video-record, user/[userId], match-celebration.
- **Tabs:** (tabs)/_layout.tsx: index (Home), events, matches, profile. No “Settings” tab; settings is a stack root.
- **Auth:** (auth) group: sign-in, sign-up, reset-password.
- **Settings stack:** settings/_layout.tsx: index, notifications, credits, account, privacy.
- **Modals:** `modal.tsx` exists as placeholder; no dedicated modal routes for subscription success/cancel or credits success.
- **Deep linking:** File-based routes map to paths; no explicit scheme/config reviewed in this audit.

### Differences

- **Tab structure:** Web uses one flat route set + BottomNav; native uses Expo Tabs (index, events, matches, profile) and Settings as a separate stack.
- **Auth:** Web single `/auth`; native split sign-in / sign-up / reset-password.
- **Settings:** Web single Settings page with drawers/sections; native Settings stack (index, notifications, credits, account, privacy).
- **Post-purchase / post-payment:** Web has `/subscription/success`, `/subscription/cancel`, `/event-payment/success`, `/credits/success`; native has none of these (return from browser or in-app flow not routed).
- **Admin:** Web has `/kaan`, `/kaan/dashboard`, `/admin/create-event`; native has no admin routes.
- **Legal / info:** Web has `/privacy`, `/terms`, `/delete-account`, `/community-guidelines`, `/how-it-works`; native has no equivalent routes (links to web or missing).
- **Schedule:** Web has `/schedule`; native has no schedule route.
- **Vibe studio:** Web and native both expose `/vibe-studio` as a management hub; native recording continues in `vibe-video-record`.
- **Match celebration:** Both have match-celebration; native at root stack.
- **Lobby:** Both have event lobby; native under `event/[eventId]/lobby` in root stack.

---

*End of audit.*
