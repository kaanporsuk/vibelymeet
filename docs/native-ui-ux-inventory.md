# Native app UI/UX inventory

**Purpose:** Spec-level reference to rebuild the Expo Router mobile UI from code.  
**Sources:** `apps/mobile/constants/Colors.ts`, `apps/mobile/constants/theme.ts`, `apps/mobile/app/**/*.tsx`, `apps/mobile/components/**/*.tsx`.  
**Note:** Light and dark themes currently use the **same** palette (`const light = { ...base }; const dark = { ...base };`). System color scheme still toggles `Colors.light` / `Colors.dark` in code paths.

---

## PART 1: GLOBAL DESIGN TOKENS

### 1.1 Colors (`Colors.ts`)

**Shared constants (referenced by tokens):**

| Name | Value |
|------|-------|
| vibelyPrimary | `hsl(263, 70%, 66%)` |
| vibelyAccent | `hsl(330, 81%, 60%)` |
| vibelyCyan | `hsl(187, 94%, 43%)` |
| vibelyYellow | `hsl(45, 93%, 58%)` |

**Backgrounds**

| Token | Value |
|-------|-------|
| background | `hsl(240, 10%, 4%)` |
| surface | `hsl(240, 10%, 8%)` |
| surfaceSubtle | `hsl(240, 10%, 10%)` |
| secondary | `hsl(240, 10%, 14%)` |
| muted | `hsl(240, 10%, 16%)` |
| popover | `hsl(240, 10%, 8%)` |

**Text**

| Token | Value |
|-------|-------|
| text | `hsl(0, 0%, 98%)` |
| textSecondary | `hsl(240, 5%, 60%)` |
| secondaryForeground | `hsl(0, 0%, 98%)` |
| mutedForeground | `hsl(240, 5%, 60%)` |
| popoverForeground | `hsl(0, 0%, 98%)` |
| primaryForeground | `hsl(0, 0%, 100%)` |

**Borders / inputs**

| Token | Value |
|-------|-------|
| border | `hsl(240, 10%, 18%)` |
| input | `hsl(240, 10%, 18%)` |
| ring | `hsl(263, 70%, 66%)` |

**Accents / primary**

| Token | Value |
|-------|-------|
| tint | `hsl(263, 70%, 66%)` |
| accent | `hsl(330, 81%, 60%)` |
| accentSoft | `hsla(330, 81%, 60%, 0.2)` |
| tintSoft | `rgba(139,92,246,0.26)` |

**Neon**

| Token | Value |
|-------|-------|
| neonViolet | `hsl(263, 70%, 66%)` |
| neonPink | `hsl(330, 81%, 60%)` |
| neonCyan | `hsl(187, 94%, 43%)` |
| neonYellow | `hsl(45, 93%, 58%)` |

**Glass**

| Token | Value |
|-------|-------|
| glassSurface | `rgba(20,20,24,0.6)` (web bg-card/60) |
| glassBorder | `rgba(255,255,255,0.1)` |

**Semantic**

| Token | Value |
|-------|-------|
| danger | `hsl(0, 84%, 60%)` |
| dangerSoft | `hsla(0, 84%, 60%, 0.16)` |
| success | `#22c55e` |
| successSoft | `rgba(34, 197, 94, 0.16)` |

**Tab bar**

| Token | Value |
|-------|-------|
| tabIconDefault | `hsl(240, 5%, 60%)` |
| tabIconSelected | `hsl(263, 70%, 66%)` |

### 1.2 Typography (`theme.ts` → `typography`)

`lineHeight` is **not** set in tokens (React Native default per platform). `fontWeight` omitted where weight is baked into the font file.

| Variant | fontFamily | fontSize | fontWeight (implicit) | lineHeight | letterSpacing | Other |
|---------|------------|----------|------------------------|------------|---------------|-------|
| titleXL | SpaceGrotesk_700Bold | 24 | Bold (file) | default | 0.3 | web text-2xl |
| titleLG | SpaceGrotesk_700Bold | 20 | Bold | default | 0.2 | web text-xl |
| titleMD | SpaceGrotesk_600SemiBold | 18 | SemiBold | default | — | — |
| titleSM | SpaceGrotesk_600SemiBold | 16 | SemiBold | default | — | — |
| body | Inter_400Regular | 16 | Regular | default | — | web text-base |
| bodySecondary | Inter_400Regular | 14 | Regular | default | — | opacity 0.8 |
| caption | Inter_400Regular | 12 | Regular | default | — | opacity 0.75 |
| overline | Inter_600SemiBold | 11 | SemiBold | default | 1 | opacity 0.9 |

**Additional font tokens (`fonts`):**  
`Inter_400Regular`, `Inter_500Medium`, `Inter_600SemiBold`, `Inter_700Bold`, `SpaceGrotesk_600SemiBold`, `SpaceGrotesk_700Bold`.

**Loaded in root `_layout.tsx`:** Inter family, Space Grotesk 500/600/700, plus `SpaceMono` (asset).

### 1.3 Spacing

| Token | px |
|-------|-----|
| xs | 4 |
| sm | 8 |
| md | 12 |
| lg | 16 |
| xl | 24 |
| 2xl | 32 |
| 3xl | 40 |

### 1.4 Border radii

| Token | px |
|-------|-----|
| xs | 4 |
| sm | 12 |
| md | 14 |
| lg | 16 |
| base | 16 |
| xl | 12 (web rounded-xl) |
| 2xl | 24 |
| 3xl | 32 |
| pill | 999 |
| button | 24 |
| input | 14 (web Input rounded-md) |

### 1.5 Shadows

| Name | shadowColor | offset | shadowOpacity | shadowRadius | elevation |
|------|-------------|--------|---------------|--------------|-----------|
| card | `#000` | {0, 4} | 0.12 | 12 | 5 |
| glowViolet | `hsl(263, 70%, 66%)` | {0, 0} | 0.25 | 8 | 4 |
| glowPink | `hsl(330, 81%, 60%)` | {0, 0} | 0.22 | 8 | 4 |
| glowCyan | `hsl(187, 94%, 43%)` | {0, 0} | 0.22 | 8 | 4 |

### 1.6 Gradients (`gradient`)

| Name | Stops |
|------|-------|
| primary | `['hsl(263, 70%, 66%)', 'hsl(330, 81%, 60%)']` |
| accent | `['hsl(330, 81%, 60%)', 'hsl(187, 94%, 43%)']` |

*(Used e.g. by `GradientSurface`; many CTAs use solid `tint`.)*

### 1.7 Layout & button tokens

**layout**

| Key | px / note |
|-----|-----------|
| containerPadding | 16 |
| screenPadding.default | 20 |
| screenPadding.compact | 16 |
| contentWidth | 512 |
| inputHeight | 40 |
| tabBarScrollPadding | 88 |
| scrollContentPaddingBottomTab | 112 (88+24) |
| tabBarContentHeightIos | 64 |
| tabBarContentHeightAndroid | 60 |
| tabBarPaddingTop | 8 |
| tabBarPaddingBottomAndroid | 10 |
| headerPaddingTopExtra | 8 |
| headerPaddingBottom | 12 |
| mainContentPaddingTop | 24 |
| minTouchTargetSize | 48 |

**button**

| Size | height | radius |
|------|--------|--------|
| sm | 40 | 12 |
| default | 48 | 24 |
| lg | 56 | 24 |

**border.width:** hairline 1, thin 1, medium 2.

**inputStyles (ui.tsx):** height `layout.inputHeight` (40), borderRadius `radius.input` (14), paddingH `spacing.md` (12), paddingV `spacing.sm` (8), borderWidth 1, **fontSize 16** (web text-base).

---

## PART 2: SCREENS (`apps/mobile/app/`)

Convention: **Route** = Expo Router path from `app/`. **Layout** from parent `_layout.tsx`. Styles cite `theme.*` → resolve via §1.1.

---

### Screen: Root redirect

- **File:** `app/index.tsx`
- **Route:** `/`
- **Layout:** Root Stack (no chrome)

**Data:** `useAuth` → `session`, `loading`, `onboardingComplete`; `useColorScheme`.

**Visual (render order):**
1. **Loading:** `View` flex 1, centered, `backgroundColor: theme.background`, `ActivityIndicator` large, `color: theme.tint`.
2. **Else:** `<Redirect>` to `/(auth)/sign-in`, `/(onboarding)`, or `/(tabs)`.

---

### Screen: Auth — Sign in

- **File:** `app/(auth)/sign-in.tsx`
- **Route:** `/(auth)/sign-in`
- **Layout:** Stack, `headerShown: false`

**Data:** `useAuth` (`signIn`, `loading`), `useState` email/password/error, `router`.

**Visual:** `ScreenContainer` title “Welcome back”; `TextInput`×2 (email/password) with theme border/bg; primary `Pressable` “Sign in”; links to sign-up / reset-password. Typography mix of `typography.titleMD` / body sizes in local StyleSheet.

**Loading:** button disabled + loading text pattern if present.

---

### Screen: Auth — Sign up

- **File:** `app/(auth)/sign-up.tsx`
- **Route:** `/(auth)/sign-up`
- **Layout:** Stack

**Data:** `signUp`, local state.

**Visual:** Parallel to sign-in; placeholders “Email”, “Password”.

---

### Screen: Auth — Reset password

- **File:** `app/(auth)/reset-password.tsx`
- **Route:** `/(auth)/reset-password`

**Data:** Supabase auth reset flow + local state.

**Visual:** Email field + submit; back navigation.

---

### Screen: Onboarding

- **File:** `app/(onboarding)/index.tsx`
- **Route:** `/(onboarding)` (stack index)
- **Layout:** `Stack` **`headerShown: true`** (native header on onboarding)

**Data:** `useAuth`, profile create/update, `useState` step + form fields; Supabase `profiles` writes.

**Visual (key):** Step indicator; `TextInput` placeholders: first name, tagline, job, bio; `VibelyButton` “Let’s Go”, “Continue”, “Complete on web”, “Creating Profile…” / “Complete Profile”. Styles use `theme.background`, cards, spacing from theme.

**Empty/error:** validation disables Continue.

---

### Screen: Dashboard (Home tab)

- **File:** `app/(tabs)/index.tsx`
- **Route:** `/(tabs)` or `/(tabs)/index`
- **Layout:** Tabs (header false)

**Data:** `useAuth`, `useQuery`/inline `supabase.from('profiles')`, `event_registrations`; custom hooks for events; `useSafeAreaInsets`.

**Visual (top → bottom):** `GlassHeaderBar` + greeting (`DashboardGreeting`); phone verification nudge; **Next Event** card (cover `Image`, countdown, `VibelyButton` “Enter Lobby →”); schedule/reminder rows; discover carousel; empty `EmptyState` / error `ErrorState` + Retry; `ActivityIndicator` while loading sections.

**Loading:** skeletons (`EventCardSkeleton`, etc.) where implemented.

---

### Screen: Events list

- **File:** `app/(tabs)/events/index.tsx`
- **Route:** `/(tabs)/events`
- **Layout:** Events stack

**Data:** `useQuery` on `profiles.location_data`; events list queries; search state; premium gating.

**Visual:** `GlassHeaderBar`; search `TextInput` placeholder “Search events, vibes, or communities…”; filters/chips; `FlatList` of cards (cover, title, date, city, attendee UI); “Happening Elsewhere”; `VibelyButton` “Explore with Premium →”; pull-to-refresh.

---

### Screen: Event detail

- **File:** `app/(tabs)/events/[id].tsx`
- **Route:** `/(tabs)/events/[id]`

**Data:** `useQueryClient`, event + registration; `supabase.from('profiles')`, `auth.getSession`, `functions.invoke('create-event-checkout')`.

**Visual:** Hero cover + gradient overlay; back `Pressable` + `Ionicons`; date/time (`date-fns`); `VenueCard` / `PricingBar` / `WhosGoingSection` / `MutualVibesSection`; CTAs `VibelyButton` “Enter Lobby”, “View Ticket”, “Manage Booking”.

---

### Screen: Event lobby

- **File:** `app/event/[eventId]/lobby.tsx`
- **Route:** `/event/[eventId]/lobby`

**Data:** Realtime channels; `video_sessions`, `event_registrations`, `profiles`, `profile_vibes`; `Alert.alert`; `EventEndedModal`.

**Visual:** Full-screen dark `theme.background`; queue cards; video preview tiles; `Ionicons` actions; overlays `ReadyGateOverlay`, banners; modals for ended event.

---

### Screen: Matches

- **File:** `app/(tabs)/matches/index.tsx`
- **Route:** `/(tabs)/matches`

**Data:** Tabs state; conversations + drops; search `TextInput` “Search by name or vibe…”; Supabase via hooks.

**Visual:** `GlassHeaderBar`; segmented control (Messages / Daily Drops); `MatchListRow` list; `DropsTabContent` with inputs and `VibelyButton` “Start Chatting”.

---

### Screen: Profile (edit)

- **File:** `app/(tabs)/profile/index.tsx`
- **Route:** `/(tabs)/profile`

**Data:** `useQuery` / `useQueryClient` on `profiles`; many `useState`; image picker; `LayoutAnimation`, `Animated`; multiple `Modal`s (gallery, vibe video, manage photos).

**Visual:** Large hero/cover; vibe score; gallery grid; prompts; lifestyle; `Chip`s; `VibelyButton` Record/Save/Logout; `VibelyInput` edit fields; settings entry row; full-screen gallery `Modal` `rgba(0,0,0,0.96)` backdrop.

---

### Screen: Settings hub

- **File:** `app/settings/index.tsx`
- **Route:** `/settings`

**Data:** `useQuery` `user_credits`; `Alert.alert`; `Linking`; RevenueCat portal via `supabase.functions.invoke('create-portal-session')`; `FeedbackSheet`.

**Visual:** `ScreenHeader` + scroll; `SettingsRow` grid (icons `Ionicons`); Premium card; `VibelyButton` Manage subscription, Log Out, Delete; destructive row.

---

### Screen: Settings — Notifications

- **File:** `app/settings/notifications.tsx`

**Data:** permission state; `NotificationPermissionFlow`.

**Visual:** Rows + `VibelyButton` “Open Settings”, “Enable notifications”, web link.

---

### Screen: Settings — Credits

- **File:** `app/settings/credits.tsx`

**Data:** `useQuery` `user_credits`.

**Visual:** Balance copy + `Ionicons`.

---

### Screen: Settings — Account

- **File:** `app/settings/account.tsx`

**Data:** `useQuery` `profiles` verification fields; `functions.invoke('request-account-deletion')`.

**Visual:** Verification rows; web link button.

---

### Screen: Settings — Privacy

- **File:** `app/settings/privacy.tsx`

**Visual:** Copy + `VibelyButton` “Open privacy on web”.

---

### Screen: Chat thread

- **File:** `app/chat/[id].tsx`
- **Route:** `/chat/[id]`

**Data:** Messages realtime; attachments; call state; `IncomingCallOverlay`, `ActiveCallOverlay`, `DateSuggestionSheet`, `ReactionPicker`.

**Visual:** Header row back + name; `FlatList` bubbles; input bar `TextInput` “Type a message…”; send `Pressable` + `Ionicons`; multiple overlays as Modals.

---

### Screen: Video date

- **File:** `app/date/[id].tsx`

**Data:** `supabase.rpc('leave_matching_queue', …)`; session/video hooks.

**Visual:** Full-screen video UI; `ConnectionOverlay`, `HandshakeTimer`, `VideoDateControls`, `VibeCheckButton`, sheets.

---

### Screen: Ready gate

- **File:** `app/ready/[id].tsx`

**Data:** `video_sessions`, partner `profiles`; `Alert.alert` leave confirm.

**Visual:** Partner preview; countdown copy; `VibelyButton` “I’m Ready ✨” primary lg.

---

### Screen: Premium paywall

- **File:** `app/premium.tsx`

**Data:** RevenueCat purchase state.

**Visual:** Marketing copy; `VibelyButton` “Get Premium”, “Go Home”, “Back”; `Ionicons`.

---

### Screen: Daily Drop

- **File:** `app/daily-drop.tsx`

**Data:** Drop payload + reply mutations; `refetch`.

**Visual:** Cards; `VibelyButton` Refresh, Send reply, Send opener; `TextInput` placeholders.

---

### Screen: Match celebration

- **File:** `app/match-celebration.tsx`

**Visual:** `Image` celebratory asset; `VibelyButton` “Message”.

---

### Screen: User profile (other)

- **File:** `app/user/[userId].tsx`

**Data:** `useQuery` public profile.

**Visual:** Photos, prompts, `VibelyButton` “Message”; many `Ionicons`.

---

### Screen: Vibe video record

- **File:** `app/vibe-video-record.tsx`

**Visual:** Camera/recorder UI; permission; `Ionicons`.

---

### Screen: Modal (template)

- **File:** `app/modal.tsx` — Expo template-style modal screen.

---

### Screen: Not found

- **File:** `app/+not-found.tsx`

**Visual:** Minimal redirect/message.

---

### Screen: HTML shell

- **File:** `app/+html.tsx` — web document wrapper, not in-app UI.

---

## PART 3: SHARED COMPONENTS (`apps/mobile/components/`)

Each entry: **file**, **props (summary)**, **visual notes**.

| Component | File | Props / behavior | Key styles |
|-----------|------|------------------|------------|
| VibelyText | ui.tsx | variant, color?, style | typography[token] + theme.text |
| GlassSurface | ui.tsx | borderBottom? | glassSurface, glassBorder |
| GlassHeaderBar | ui.tsx | insets | paddingTop/Bottom/H per layout |
| ScreenHeader | ui.tsx | title, onBack, right, insets | titleMD centered; back 44×44; Ionicons 24 theme.text |
| Chip | ui.tsx | label, variant | pill radius; 12/600 label |
| Skeleton | ui.tsx | w/h/radius/bg | surfaceSubtle default |
| Event/Match/Discover skeletons | ui.tsx | — | fixed dimensions in StyleSheet |
| ScreenContainer | ui.tsx | title, footer | screenTitle titleLG |
| SectionHeader | ui.tsx | title, subtitle, action | titleMD, bodySecondary |
| Card | ui.tsx | variant default/glass | radius 2xl, border, shadows.card |
| VibelyButton | ui.tsx | label, variant, size, loading | heights 40/48/56; radius 12/24; label **fontSize 14 fontWeight 600** (web text-sm) |
| Avatar | ui.tsx | size default 56 | circle; accentSoft fallback |
| MediaTile | ui.tsx | aspectRatio 16/9 | radius 2xl |
| EmptyState / ErrorState / LoadingState | ui.tsx | — | stateTitle titleMD; GradientSurface 48 circle |
| ListRow / SettingsRow | ui.tsx | — | settings icon 40×40 radius lg |
| DestructiveRow | ui.tsx | — | danger text 16/600 |
| MatchListRow | ui.tsx | imageUri, name, age, time, … | avatar 52; preview 13px |
| VibelyInput | ui.tsx | multiline minHeight 96 | inputStyles + theme |
| GradientSurface | GradientSurface.tsx | variant | LinearGradient from tokens |
| Themed / StyledText | Themed.tsx, StyledText.tsx | — | light/dark text helpers |
| DashboardGreeting | DashboardGreeting.tsx | — | header copy |
| OfflineBanner | OfflineBanner.tsx | — | top banner; Ionicons |
| PushRegistration | PushRegistration.tsx | — | no UI |
| PhoneVerificationNudge | PhoneVerificationNudge.tsx | — | VibelyButton + copy |
| Event subcomponents | events/* | see each | VenueCard, TicketStub Modal, etc. |
| Chat subcomponents | chat/* | Modals, overlays | TypingIndicator Animated |
| Match subcomponents | match/* | Modals/sheets | ReportFlowModal, ProfileDetailSheet |
| Profile subcomponents | profile/* | Sheets, selectors | PromptEditSheet Modal slide |
| Video-date subcomponents | video-date/* | overlays | Animated pulses |
| Lobby | lobby/ReadyGateOverlay.tsx | Modal fade | Primary CTA |
| Premium | premium/* | gates, pill | — |
| Settings | settings/FeedbackSheet Modal | — | TextInput + submit |
| Verification | verification/* | Modal slides | OTP inputs |
| Notifications | NotificationPermissionFlow | Modal fade | Two-step CTAs |
| schedule/DateReminderCard | — | VibelyButton sm | — |
| EditScreenInfo | EditScreenInfo.tsx | dev | — |
| ExternalLink | ExternalLink.tsx | href | — |
| useColorScheme | useColorScheme.ts | — | — |

---

## PART 4: BUTTON INVENTORY

| Location | Label | Type | Width | Height | BorderRadius | Font | BG | Text | Icon | Action |
|----------|-------|------|-------|--------|--------------|------|-----|------|------|--------|
| ui VibelyButton | * | primary/secondary/ghost/destructive | min full from style | 40/48/56 | 12/24 | 14/600 | tint/surface/transparent/danger | see variant | optional ActivityIndicator | onPress |
| ReadyGateOverlay | I'm Ready ✨ | primary | — | default | 24 | 14/600 | tint | primaryFg | — | onReady |
| VenueCard | Enter Lobby / Event Ended / … | primary/secondary/ghost | style.cta | 48 | 24 | — | — | — | — | lobby / disabled |
| VenueCard | Get Directions | secondary | — | 48 | — | — | — | — | — | maps stub |
| events/index | Explore with Premium → | primary | — | — | — | — | — | — | — | premium |
| daily-drop | Refresh | secondary | — | — | — | — | — | — | — | refetch |
| daily-drop | Open chat / Send reply / Send opener | primary | — | — | — | — | — | — | — | chat/send |
| PhoneVerificationNudge | copy.cta | varies | — | — | — | — | — | — | — | verify flow |
| Dashboard | Retry | secondary sm | — | 40 | 16 | — | — | — | — | refetch |
| Dashboard | Enter Lobby → | primary | — | 48 | — | — | — | — | — | lobby |
| Dashboard | View & Register | primary | — | — | — | — | — | — | — | event |
| privacy | Open privacy on web | secondary | — | — | — | — | — | — | — | Linking |
| EmailVerificationFlow | Send code / Verify | primary | — | 48 | — | — | — | — | loading | verify |
| DropsTabContent | Start Chatting | primary | — | 48 | — | — | — | — | — | router chat |
| settings/index | Manage Subscription | secondary sm | — | 40 | — | — | — | — | — | billing portal |
| settings/index | Log Out / Delete My Account | destructive + secondary | — | — | — | — | — | — | — | auth / delete flow |
| DateReminderCard | Join Now | primary sm | — | 40 | — | — | — | — | — | join date |
| match-celebration | Message | primary | styles.btn | 48 | — | — | — | — | — | chat |
| onboarding | Let's Go / Continue / Complete… | primary | — | 48 | — | — | — | — | — | step advance |
| FeedbackSheet | Open email… | primary | submitBtn | — | — | — | — | — | — | mailto |
| events/[id] | Enter Lobby / View Ticket / Manage Booking | primary/secondary | — | 48 | — | — | — | — | — | navigate |
| ready/[id] | I'm Ready ✨ | primary lg | — | 56 | 24 | — | — | — | — | markReady |
| notifications | Open Settings / Enable / web | primary | — | 48 | — | — | — | — | — | settings |
| premium | Go Home / Get Premium / Back | primary/secondary | — | — | — | — | — | — | — | nav / purchase |
| NotificationPermissionFlow | Not Now / Enable / Open Settings / Got it | secondary/primary/ghost | actionBtn | — | — | — | — | — | — | dismiss/enable |
| account | Open account… | secondary | — | — | — | — | — | — | — | web |
| PhoneVerificationFlow | Send Code | primary | — | 48 | — | — | — | — | loading | OTP |
| ActiveCallBanner | Rejoin | primary sm | — | 40 | — | — | — | — | — | rejoin |
| profile | Complete / Record* / Save / Cancel / Log Out | mixed | flex 1 on sheet | 40–56 | — | — | — | — | — | profile actions |
| user/[userId] | Message | primary | — | — | — | — | — | — | — | chat |
| ManageBookingModal | Share Event | secondary | — | — | — | — | — | — | — | share |
| EmptyState CTA | actionLabel | secondary | — | 48 | — | titleMD msg | — | — | — | onAction |
| ErrorState CTA | actionLabel | primary | — | 48 | — | — | — | — | — | onAction |

*Many secondary `Pressable` rows (chevron, back) use opacity 0.8 pressed — not in table.*

---

## PART 5: INPUT INVENTORY

| Location | Placeholder | Height | BorderRadius | FontSize | BG | Border | PaddingH/V | Keyboard |
|----------|-------------|--------|--------------|----------|-----|--------|------------|----------|
| VibelyInput default | * | 40 | 14 | 16 | transparent | theme.border | 12/8 | default |
| VibelyInput multiline | * | min 96 | 14 | 16 | — | — | — | multiline |
| sign-in | Email / •••••••• | ~40 | 14 | 16 | theme.surface | theme.border | custom | email / secure |
| sign-up | Email / Password | same | — | — | — | — | — | — |
| chat/[id] | Type a message… | ~40+ | 14+ | 16 | theme | border | — | default |
| DateSuggestionSheet | YYYY-MM-DD / Coffee… | varies | — | — | — | — | — | — |
| FeedbackSheet | Describe… | multiline | — | — | — | — | — | — |
| DropsTabContent | Reply… / Say something… | — | — | — | — | — | — | — |
| matches/index search | Search by name or vibe… | 40 | 14 | 16 | — | — | — | search |
| PromptEditSheet | Tap to add… | multiline | — | — | — | — | — | — |
| ReportFlowModal | Anything else… | multiline | — | — | — | — | — | — |
| events/index search | Search events… | 40 | 14 | 16 | — | — | — | search |
| onboarding | name/tagline/job/bio | native TextInput | — | — | — | — | — | default |
| daily-drop | Reply / Say hi | — | — | — | — | — | — | — |
| PhoneVerificationFlow | Phone number | — | — | — | — | — | — | phone |
| profile edit | name/tagline/job/bio | VibelyInput | 40/96 | 14 | 16 | — | — | — | default |

---

## PART 6: ICON INVENTORY

**Libraries:** `@expo/vector-icons` **Ionicons** (majority); **expo-symbols** `SymbolView` (tab bar only, size **24**, tint = tab active/inactive colors).

| Area | Library | Name (examples) | Size | Color |
|------|---------|-----------------|------|-------|
| ScreenHeader back | Ionicons | arrow-back | 24 | theme.text |
| Settings rows | Ionicons | varied (notifications, card, person…) | ~22 | theme.tint / text |
| Tab bar | SymbolView | house, list, heart, person | 24 | tabBarActiveTintColor / Inactive |
| Chat header/actions | Ionicons | call, videocam, attach, send, chevron | 20–28 | theme.text / tint |
| Event detail | Ionicons | arrow-back, calendar, location | 24 | theme.text |
| Lobby | Ionicons | multiple | 22–28 | theme.* |
| Profile | Ionicons | camera, settings, add, trash, checkmark | 18–28 | theme.* |
| Premium | Ionicons | star, checkmark | 24 | — |
| OfflineBanner | Ionicons | cloud-offline | 18 | — |
| ui.tsx Empty | — | (gradient only) | — | — |
| TicketStub / Modals | Ionicons | close, share | 24 | — |
| Many more | Ionicons | see each file grep `Ionicons name=` | — | theme.textSecondary / tint / danger |

*Full enumeration: run `rg "Ionicons name=" apps/mobile` — 200+ occurrences across listed files.*

---

## PART 7: IMAGE INVENTORY

| Location | Source | W×H / layout | BorderRadius | ResizeMode | Placeholder |
|--------|--------|--------------|--------------|------------|-------------|
| Event cards | `{ uri: cover_url }` | flex / aspect | 2xl top | cover | Skeleton |
| Event detail hero | uri | full width | top 2xl | cover | — |
| Match avatars | uri | 52 circle | 26 | cover | initials |
| Profile gallery | uri[] | grid tiles | lg | cover | muted bg |
| User profile | uri | full width strips | varies | cover | — |
| match-celebration | require/local or uri | centered | — | contain | — |
| Dashboard discover | event images | card | 2xl | cover | — |
| Chat bubbles | optional attachment uri | max width | sm | cover | — |
| Lobby queue | profile photos | tile | circle | cover | — |
| Video date | remote stream | full screen | 0 | — | — |

---

## PART 8: ANIMATION INVENTORY

| Location | What | API | Duration | Easing | Trigger |
|----------|------|-----|----------|--------|---------|
| TypingIndicator | 3 dots scale/opacity | Animated.loop sequence | 300ms | timing | mount |
| ActiveCallBanner | icon scale pulse | Animated.loop | 750ms | timing | active call |
| HandshakeTimer | wrap scale | Animated.loop | 300ms | timing | urgent |
| VibeCheckButton | button scale | Animated | 900ms loop | timing | prominent |
| ConnectionOverlay | rings scale | Animated.loop | 1000ms | timing | connecting |
| MutualVibeToast | toast | Animated | — | — | event |
| profile/index | fade main; gallery backdrop; new photo scale | Animated + LayoutAnimation | 220–350ms | timing / easeInEaseOut | load / gallery / photo add |
| Reanimated | — | import in root only | — | — | layout animations driver |

*No `useSharedValue` / Reanimated hooks in app TSX at inventory time; `react-native-reanimated` loaded in root.*

---

## PART 9: MODAL / SHEET / OVERLAY INVENTORY

| Name | File | Trigger | Type | Backdrop | Animation |
|------|------|---------|------|----------|-----------|
| DateSuggestionSheet | chat/DateSuggestionSheet | chat CTA | Modal transparent | dark | slide |
| MatchActionsSheet | match/MatchActionsSheet | match row menu | Modal | dark | fade |
| ProfilePreviewModal | profile/ProfilePreviewModal | preview | Modal | dark | slide |
| ManageBookingModal | events/ManageBookingModal | event detail | Modal | dark | slide |
| profile gallery / vibe fullscreen / manage | profile/index | taps | Modal | black 0.96 / fade | fade/slide |
| EmailVerificationFlow | verification | settings | Modal | — | slide |
| IncomingCallOverlay | chat | incoming call | Modal | dark | fade |
| PromptEditSheet | profile | edit prompt | Modal | — | slide |
| ReportFlowModal | match | report | Modal | — | slide |
| ProfileDetailSheet | match | profile tap | Modal | — | slide |
| ReactionPicker | chat | long-press msg | Modal | — | fade |
| EventEndedModal | events | lobby time | Modal | — | fade |
| TicketStub | events | view ticket | Modal | — | slide |
| NotificationPermissionFlow | notifications/settings | permission | Modal | — | fade |
| ActiveCallOverlay | chat/date | in call | Modal(s) | — | fade |
| PhoneVerificationFlow | nudge/settings | verify | Modal | — | slide |
| ReadyGateOverlay | lobby | gate open | Modal | — | fade |
| FeedbackSheet | settings | feedback | Modal | — | slide |
| PartnerProfileSheet | video-date | partner | Modal | — | slide |
| Alert.alert | many screens | confirm/errors | Native alert | — | system |

---

## PART 10: NAVIGATION MAP

**Root Stack** (`app/_layout.tsx`): `headerShown: false` globally.

```
Root Stack
├── index                    → redirect (session/onboarding)
├── (auth)/                  Stack, headerShown: false
│   ├── sign-in
│   ├── sign-up
│   └── reset-password
├── (onboarding)/            Stack, headerShown: true
│   └── index
├── (tabs)/                  Tabs, headerShown: false
│   ├── index                Dashboard
│   ├── events/              Stack, headerShown: false
│   │   ├── index            Events list
│   │   └── [id]             Event detail
│   ├── matches/             Stack
│   │   └── index            Matches
│   └── profile/             Stack
│       └── index            Profile
├── event/[eventId]/lobby    title: Event Lobby
├── chat/[id]                title: Chat
├── daily-drop               title: Daily Drop
├── ready/[id]               title: Ready Gate
├── date/[id]                title: Video Date
├── settings/                Stack, headerShown: false
│   ├── index
│   ├── notifications
│   ├── credits
│   ├── account
│   └── privacy
├── premium                  title: Premium
├── vibe-video-record        title: Record Vibe Video
├── user/[userId]            title: Profile
├── match-celebration        title: It's a match!
├── modal                    (template)
└── +not-found
```

**Presentation:** All listed stack screens use default card transition unless overridden; no `presentation: 'modal'` on root stack entries in `_layout.tsx`.

---

## PART 11: TAB BAR

| Property | Value |
|----------|-------|
| Tab count | 4 |
| Height | iOS: `64 + safeArea.bottom`; Android: `60 + max(safeArea.bottom, 10)` |
| Background | `theme.glassSurface` → `rgba(20,20,24,0.6)` |
| Border | top `theme.glassBorder`, width 1 |
| Shadow | `shadowColor: theme.tint`, offset {0,-2}, opacity 0.12, radius 8, elevation 6 |
| Active tint | `theme.tint` `hsl(263,70%,66%)` |
| Inactive tint | `theme.tabIconDefault` `hsl(240,5%,60%)` |
| Active tab bg | `theme.tintSoft` |
| Inactive tab bg | transparent |
| Label | fontSize **12**, fontWeight **500** |
| Item | paddingVertical 4, borderRadius 12, marginHorizontal 3; Android minHeight 48 |
| Icon | SymbolView **20**; names: house/home, list, heart/favorite, person |
| Safe area | paddingBottom = iOS inset bottom else max(inset, 10) |

---

## PART 12: FONT USAGE AUDIT

| Pattern | Usage |
|---------|--------|
| **Typography tokens** | `VibelyText variant=*`; `styles` spreading `typography.titleMD/LG/XL`; SectionHeader, ScreenContainer title, EmptyState titles, chip label 12/600 (raw size) |
| **Raw fontSize common** | VibelyButton label **14/600**; MatchListRow name **15/600**, time **11**, preview **13**; settingsRowTitle **16** with titleMD; inputStyles **16**; screenHeaderTitle uses titleMD (18 Space Grotesk) |
| **Mixed** | Many screens use `Text` + `{ color: theme.text }` + ad-hoc fontSize 13–17 |

**Sample audit rows**

| File | Text (truncated) | Token? | Token or raw |
|------|------------------|--------|--------------|
| ui VibelyButton | label | No | 14 / 600 |
| ui VibelyText | children | Yes | variant key |
| ui ScreenHeader title | title | Partial | titleMD |
| ui MatchListRow | name | No | 15/600 |
| ui settingsRowTitle | title | Hybrid | titleMD + fontSize 16 |
| tabs/index | section titles | Mixed | titleMD / raw |
| profile/index | body copy | Mixed | 14–16 raw + theme colors |
| chat/[id] | bubbles | Mostly raw | 15–16 |

**Flag:** Prefer migrating stray `Text` to `VibelyText` + tokens for parity; VibelyButton uses 14/600 (web text-sm / semibold).

---

## Appendix: file checklist

**App TSX (35):** `_layout`, `index`, `(auth)/_layout`, `sign-in`, `sign-up`, `reset-password`, `(onboarding)/_layout`, `(onboarding)/index`, `(tabs)/_layout`, `(tabs)/index`, `events/_layout`, `events/index`, `events/[id]`, `matches/_layout`, `matches/index`, `profile/_layout`, `profile/index`, `event/[eventId]/lobby`, `chat/[id]`, `date/[id]`, `ready/[id]`, `settings/_layout`, `settings/index`, `notifications`, `credits`, `account`, `privacy`, `premium`, `daily-drop`, `match-celebration`, `user/[userId]`, `vibe-video-record`, `modal`, `+not-found`, `+html`.

**Components (58):** full tree under `components/` including `events/`, `chat/`, `match/`, `profile/`, `video-date/`, `verification/`, `settings/`, `lobby/`, `premium/`, `matches/`, `notifications/`, `schedule/`, root `ui.tsx`, `GradientSurface.tsx`, etc.

---

*Generated from codebase. For line-level JSX of the largest screens (profile, chat, events list), open the source file alongside this doc.*
