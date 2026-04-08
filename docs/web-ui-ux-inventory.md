# Web app UI/UX inventory

**Purpose:** Source-of-truth spec for the web codebase. The native app must match this.  
**Sources:** `src/index.css`, `tailwind.config.ts`, `src/pages/**`, `src/components/**`, `src/components/ui/**`.  
**Note:** `src/index.css` defines only `:root`; there is **no `.dark`** block, so light and dark values are the same (single theme).

---

## PART 1: WEB DESIGN SYSTEM

### 1.1 CSS Variables

**File:** `src/index.css`. Only `:root` is defined; no `.dark` overrides.

| Variable | Light value | Dark value |
|----------|-------------|------------|
| --background | 240 10% 4% | *(same — no .dark)* |
| --foreground | 0 0% 98% | *(same)* |
| --card | 240 10% 8% | *(same)* |
| --card-foreground | 0 0% 98% | *(same)* |
| --popover | 240 10% 8% | *(same)* |
| --popover-foreground | 0 0% 98% | *(same)* |
| --primary | 263 70% 66% | *(same)* |
| --primary-foreground | 0 0% 100% | *(same)* |
| --secondary | 240 10% 14% | *(same)* |
| --secondary-foreground | 0 0% 98% | *(same)* |
| --muted | 240 10% 16% | *(same)* |
| --muted-foreground | 240 5% 60% | *(same)* |
| --accent | 330 81% 60% | *(same)* |
| --accent-foreground | 0 0% 100% | *(same)* |
| --destructive | 0 84% 60% | *(same)* |
| --destructive-foreground | 0 0% 100% | *(same)* |
| --border | 240 10% 18% | *(same)* |
| --input | 240 10% 18% | *(same)* |
| --ring | 263 70% 66% | *(same)* |
| --radius | 1rem | *(same)* |
| --neon-violet | 263 70% 66% | *(same)* |
| --neon-pink | 330 81% 60% | *(same)* |
| --neon-cyan | 187 94% 43% | *(same)* |
| --neon-yellow | 45 93% 58% | *(same)* |
| --neon-violet-glow | 263 70% 66% | *(same)* |
| --neon-pink-glow | 330 81% 60% | *(same)* |
| *(--neon-cyan-glow not in :root)* | — | — |
| --glass-bg | *(not in :root; glass uses Tailwind)* | — |
| --glass-border | *(not in :root)* | — |
| --gradient-primary | *(not var; inline linear-gradient)* | — |
| --gradient-accent | *(not var; inline)* | — |
| --gradient-glow | *(inline radial-gradient)* | — |

**Usage:** Tailwind uses these as `hsl(var(--primary))` etc. Custom gradients in `:root`:
- `--gradient-primary: linear-gradient(135deg, hsl(263 70% 66%), hsl(330 81% 60%));`
- `--gradient-accent: linear-gradient(135deg, hsl(330 81% 60%), hsl(187 94% 43%));`
- `--gradient-glow: radial-gradient(circle at center, hsl(263 70% 66% / 0.3), transparent 70%);`

---

### 1.2 Tailwind Config

**File:** `tailwind.config.ts`.

- **darkMode:** `["class"]`.
- **content:** `["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"]`.
- **container:** center true, padding `1rem`, screens `2xl: 1400px`.
- **fontFamily:** `sans: ['Inter', 'system-ui', 'sans-serif']`, `display: ['Space Grotesk', 'system-ui', 'sans-serif']`.
- **colors:** All map to `hsl(var(--…))`: border, input, ring, background, foreground, primary (DEFAULT + foreground), secondary, destructive, muted, accent, popover, card; plus `neon.violet`, `neon.pink`, `neon.cyan`, `neon.yellow`.
- **borderRadius:** `lg: var(--radius)` (1rem), `md: calc(var(--radius) - 2px)`, `sm: calc(var(--radius) - 4px)`, `2xl: 1.5rem`, `3xl: 2rem`.
- **keyframes:** accordion-down/up, fade-in, fade-out, scale-in, slide-up, glow-pulse, shimmer, float.
- **animation:** accordion-down 0.2s, accordion-up 0.2s, fade-in 0.4s, fade-out 0.3s, scale-in 0.3s, slide-up 0.5s, glow-pulse 2s infinite, shimmer 2s linear infinite, float 3s ease-in-out infinite.
- **backgroundImage:** gradient-radial, gradient-primary (neon violet → pink), gradient-accent (pink → cyan), shimmer.
- **plugins:** `tailwindcss-animate`.

No custom spacing or boxShadow in theme.extend; default Tailwind spacing/scale apply.

---

### 1.3 Typography System

- **Body font:** Inter. Import: `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');` in `src/index.css`. Body: `font-family: 'Inter', system-ui, sans-serif` (via `@apply font-sans`).
- **Display/headings:** Space Grotesk. `h1–h6 { font-family: 'Space Grotesk', system-ui, sans-serif }` in base layer.

**Tailwind text size → px (default scale):**

| Class | px |
|-------|-----|
| text-xs | 12px |
| text-sm | 14px |
| text-base | 16px |
| text-lg | 18px |
| text-xl | 20px |
| text-2xl | 24px |
| text-3xl | 30px |
| text-4xl | 36px |
| text-[10px] | 10px (arbitrary) |

**Font weight:** font-normal 400, font-medium 500, font-semibold 600, font-bold 700.

---

### 1.4 Global Styles

**Body:** `@apply bg-background text-foreground font-sans antialiased` → background hsl(240 10% 4%), color 0 0% 98%, Inter, antialiased.

**Component classes (index.css @layer components):**

- **.glass-card:** `bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl`.
- **.neon-glow-violet:** box-shadow 0 0 20px hsl(var(--neon-violet)/0.4), 0 0 40px /0.2, inset 0 0 20px /0.1.
- **.neon-glow-pink:** same pattern with --neon-pink.
- **.neon-glow-cyan:** 0 0 20px/40px --neon-cyan (no inset).
- **.gradient-text:** `bg-clip-text text-transparent`, background-image var(--gradient-primary).
- **.skeleton:** `animate-pulse bg-muted rounded-lg`.
- **.pb-safe:** `padding-bottom: max(1rem, env(safe-area-inset-bottom));`
- **.scrollbar-hide:** webkit scrollbar display none; ms-overflow-style none; scrollbar-width none.
- **.shimmer-effect:** linear-gradient 90deg muted → muted-foreground/0.1 → muted; background-size 200% 100%; animation shimmer 1.5s infinite.
- **@keyframes shimmer:** 0% background-position 200% 0; 100% -200% 0.
- **.swipe-stamp:** pointer-events-none.

**Base layer:** `* { @apply border-border }`.

---

### 1.5 shadcn/ui Defaults

**Button** (`src/components/ui/button.tsx`):

- Base: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-semibold ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 active:scale-95`.
- **default:** bg-primary text-primary-foreground hover:bg-primary/90. **destructive:** bg-destructive text-destructive-foreground hover:bg-destructive/90. **outline:** border border-primary/50 bg-transparent text-primary hover:bg-primary/10 hover:border-primary. **secondary:** bg-secondary text-secondary-foreground hover:bg-secondary/80. **ghost:** hover:bg-secondary hover:text-foreground. **link:** text-primary underline-offset-4 hover:underline. **gradient:** bg-gradient-to-r from-[hsl(263,70%,66%)] to-[hsl(330,81%,60%)] text-white hover:opacity-90 shadow-lg shadow-primary/25. **glass:** bg-card/60 backdrop-blur-xl border border-white/10 text-foreground hover:bg-card/80. **neon:** bg-transparent border-2 border-accent text-accent hover:bg-accent/10.
- **size default:** h-12 px-6 py-3. **sm:** h-10 rounded-xl px-4. **lg:** h-14 rounded-2xl px-8 text-base. **xl:** h-16 rounded-3xl px-10 text-lg. **icon:** h-12 w-12.

**Input** (`src/components/ui/input.tsx`):

- `flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm`.
- Height 40px, borderRadius calc(var(--radius)-2px) (md), fontSize 16px (14px on md+), border and bg from CSS vars.

**Card** (`src/components/ui/card.tsx`):

- Card: `rounded-lg border bg-card text-card-foreground shadow-sm`.
- CardHeader: `flex flex-col space-y-1.5 p-6`.
- CardTitle: `text-2xl font-semibold leading-none tracking-tight`.
- CardDescription: `text-sm text-muted-foreground`.
- CardContent: `p-6 pt-0`.
- CardFooter: `flex items-center p-6 pt-0`.

**Dialog** (`src/components/ui/dialog.tsx`):

- Overlay: `fixed inset-0 z-50 bg-black/80` + animate-in/out.
- Content: `fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200` + zoom/slide animations. Close button: absolute right-4 top-4, X icon 16×16.
- DialogTitle: text-lg font-semibold. DialogDescription: text-sm text-muted-foreground.

**Drawer** (vaul):

- Overlay: `fixed inset-0 z-50 bg-black/80`.
- Content: `fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background`; handle bar: mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted.
- DrawerTitle: text-lg font-semibold. DrawerDescription: text-sm text-muted-foreground.

**Tabs** (`src/components/ui/tabs.tsx`):

- TabsList: `inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground`.
- TabsTrigger: `inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium`; data-[state=active]: bg-background text-foreground shadow-sm.

**Badge** (`src/components/ui/badge.tsx`):

- Base: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold`.
- **default:** border-transparent bg-primary text-primary-foreground. **secondary:** bg-secondary text-secondary-foreground. **destructive:** bg-destructive text-destructive-foreground. **outline:** text-foreground (no bg).

**Sheet** (`src/components/ui/sheet.tsx`):

- Overlay: same as Dialog bg-black/80.
- Content: side variants (top/bottom/left/right); default right, `w-3/4 sm:max-w-sm`, border, bg-background, slide animations.

---

## PART 2: SCREENS

### Screen: Index (redirect/landing)

- **File:** `src/pages/Index.tsx`
- **Route:** `/`
- **Auth required:** No

Redirect/landing; content depends on auth state. Typically redirects to `/auth`, `/onboarding`, or `/dashboard`.

---

### Screen: Dashboard

- **File:** `src/pages/Dashboard.tsx`
- **Route:** `/dashboard`, `/home`
- **Auth required:** Yes

**Visual elements (top to bottom, render order):**

1. **PullToRefresh** — wrapper  
   - **Element:** Scroll container  
   - **Classes:** `min-h-screen bg-background pb-24`  
   - **Resolved:** min-height 100vh, background hsl(240 10% 4%), padding-bottom 96px  

2. **AnimatePresence → ActiveCallBanner** (conditional: `activeSession`)  
   - **Element:** Rejoin banner  
   - **Component:** ActiveCallBanner; sessionId, onRejoin, onEnd  

3. **DeletionRecoveryBanner** (conditional: `pendingDeletion`)  
   - **Element:** Recovery CTA  
   - **Content:** scheduledDate, onCancel, isCancelling  

4. **NotificationPermissionFlow** — modal; open=showNotificationFlow  

5. **header**  
   - **Element:** Sticky header bar  
   - **Classes:** `sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-4`  
   - **Resolved:** position sticky, top 0, z-index 40; bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl; border-bottom white/10; padding 16px 16px  

6. **header inner div**  
   - **Classes:** `flex items-center justify-between max-w-lg mx-auto`  
   - **Resolved:** max-width 512px, margin horizontal auto  

7. **DashboardGreeting** — left side of header  
   - **Element:** Greeting + optional “Complete your profile”  
   - **Content:** “Good morning|afternoon|evening”, firstName; button “Complete your profile for better matches” (conditional completeness < 80%)  

8. **Header right div**  
   - **Classes:** `flex items-center gap-2`  
   - **Contains:** MiniDateCountdown (conditional nextReminder), NotificationPermissionButton, profile photo button (ProfilePhoto 32×32, navigate to /profile)  

9. **main**  
   - **Classes:** `max-w-lg mx-auto px-4 py-6 space-y-8`  
   - **Resolved:** max-width 512px, padding 16px 24px, gap 32px between sections  

10. **PhoneVerificationNudge** (AnimatePresence; conditional showDashboardPhoneNudge)  
    - **Element:** motion.div initial opacity 0 height 0 → animate opacity 1 height auto  
    - **Content:** PhoneVerificationNudge variant=wizard, onDismiss, onVerified  

11. **Imminent date reminders section** (conditional imminentReminders.length > 0)  
    - **Classes:** `space-y-3`  
    - **Content:** DateReminderCard per reminder; onJoinDate, onEnableNotifications, notificationsEnabled  

12. **SECTION 1: Live event** (conditional isLiveEvent && isRegisteredForNextEvent && nextEvent)  
    - **Element:** motion.section initial opacity 0 y 10 → animate opacity 1 y 0; `space-y-3`  
    - **Card:** `relative glass-card overflow-hidden neon-glow-pink`  
    - **Cover:** EventCover absolute inset-0; gradient overlay `from-background via-background/80 to-background/40`  
    - **Content block:** `relative p-6 space-y-4`  
    - **Live badge:** motion.div scale [1,1.2,1] 1.5s repeat; `flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive/20 border border-destructive/40`; Radio icon 14px text-destructive; span “Live Now” `text-xs font-bold text-destructive uppercase tracking-wider`  
    - **Title:** h3 `text-xl font-display font-bold text-foreground` — nextEvent.title  
    - **Subtitle:** p `text-sm text-muted-foreground mt-1 flex items-center gap-1.5`; Users icon 14px; “People vibing right now”  
    - **Button:** variant=gradient, `w-full text-base py-6`, “Enter Lobby →”, onClick navigate to event lobby  

13. **SECTION 2: Next event (not live)** (conditional !isLiveEvent && nextEvent)  
    - **Section header:** “Next Event” — h2 `text-lg font-display font-semibold text-foreground`  
    - **Loading:** EventCardSkeleton  
    - **Else:** Card `glass-card overflow-hidden cursor-pointer`; h-36 cover with EventCover + gradient; “✓ Registered” badge (conditional) `absolute top-3 right-3 px-2 py-1 text-xs font-medium rounded-full bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30`; bottom left title + date; countdown row (DAYS/HRS/MIN/SEC) — each `w-14 h-14 rounded-xl bg-secondary`, value gradient-text; View & Register outline sm button (conditional !isRegisteredForNextEvent)  

14. **No events block** (conditional !nextEvent && !loading)  
    - **Element:** glass-card p-6 text-center  
    - **Content:** p “No upcoming events”; Button ghost “Browse Events” → /events  

15. **Premium nudge — other cities** (conditional otherCities.length > 0)  
    - **Element:** motion.div; `glass-card p-4 border border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5`  
    - **Content:** emoji 💎; “{n} events in {n} city|cities”; cities list text-xs muted; Button size sm variant outline “Go Premium →” → /events  

16. **SECTION 3: Your Matches**  
    - **Section header:** h2 “Your Matches” + optional “{newMatchCount} new” badge `ml-2 px-2 py-0.5 text-xs rounded-full bg-neon-pink/20 text-neon-pink`; button “See all” text-sm text-primary + ChevronRight  
    - **Horizontal list:** `flex gap-4 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4`  
    - **Loading:** 5× MatchAvatarSkeleton  
    - **With data:** match buttons — gradient or border ring, ProfilePhoto, name truncate max-w-[64px] text-xs  
    - **Empty:** “No matches yet. Join an event to start connecting!”; Button outline sm “Browse Events →”  

17. **SECTION 4: Upcoming Events (Discover)**  
    - **Section header:** “Upcoming Events”; “All events” link + ChevronRight  
    - **Horizontal list:** `flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2`  
    - **Loading:** 2× min-w-[260px] EventCardSkeleton  
    - **Cards:** min-w-[260px] glass-card; EventCover; p-3 title line-clamp-1, date • time, Users + attendees  

18. **BottomNav** — fixed bottom  

**Loading state:** eventLoading || eventsLoading || matchesLoading → skeletons in Next Event and Discover; header and structure still visible.  
**Empty state:** No next event → “No upcoming events” + Browse Events. No matches → “No matches yet” + Browse Events.  
**Error state:** No dedicated error UI in snippet; refetch via PullToRefresh.

---

### Screen: Events

- **File:** `src/pages/Events.tsx`
- **Route:** `/events`
- **Auth required:** Yes

**Visual structure:**

1. **Root:** `min-h-screen bg-background pb-24`  
2. **Header:** `pt-safe-top px-4 py-6`; icon container `p-2.5 rounded-xl bg-primary/10` with Calendar 24×24 text-primary; h1 “Discover Events” `font-display text-2xl font-bold text-foreground`; p “Find your next vibe match” text-muted-foreground text-sm  
3. **LocationPromptBanner** (conditional hasLocation === false): motion.div; MapPin; “Share your location…”; Not now / Enable buttons  
4. **EventsFilterBar:** searchQuery, onSearchChange, activeFilters, onFiltersChange  
5. **Content:** If loading → FeaturedEventSkeleton + 3× EventsRailSkeleton. If filtering → “{n} events found” + grid of EventCardPremium or empty “No events found”. Else → FeaturedEventCard (featured), then EventsRail sections: Live Now, Near You, Global Events, In Your Region; empty “No events near you yet” + “Go Premium to explore”; HappeningElsewhere (other cities + CTA card “Explore with Premium →”)  
6. **BottomNav**

**Empty state (filtering):** “No events found”, “Try adjusting your filters or search terms”.  
**Empty state (no local):** “No events near you yet 💫”, “But there are events happening in other cities!”, Button “Go Premium to explore →”.

---

### Screen: EventDetails

- **File:** `src/pages/EventDetails.tsx`
- **Route:** `/events/:id`
- **Auth required:** Yes

**Loading:** min-h-screen bg-background flex center; Loader2 32×32 animate-spin text-primary.  
**Error/not found:** “Event not found”, “This event may have been removed or doesn't exist.”, Button “Back to Events”.  
**Main:** Hero with cover image + gradient overlay; back button (ArrowLeft); date/time (formatDate weekday long month long day); VenueCard, PricingBar, GuestListTeaser/GuestListRoster, MutualVibesSection; CTAs Enter Lobby, View Ticket, Manage Booking; PhoneVerificationNudge (conditional); PaymentModal, ManageBookingModal, CancelBookingModal, TicketStub, MiniProfileModal, ProfileDetailDrawer.  
**Buttons:** Enter Lobby (gradient/primary), View Ticket, Manage Booking (secondary/outline); Share (Share2); Register / Purchase (PricingBar).

---

### Screen: EventLobby

- **File:** `src/pages/EventLobby.tsx`
- **Route:** `/event/:eventId/lobby`
- **Auth required:** Yes

**Visual:** Full-screen lobby; back button; event title/info; deck of LobbyProfileCard (swipe); LobbyEmptyState when no profiles; ReadyGateOverlay when match (activeSessionId); PremiumPill; timer; Super Vibe / actions. Uses motion, useMotionValue, useTransform for swipe. Data: useEventDetails, useEventDeck, useEventStatus, useMatchQueue, useSwipeAction.

---

### Screen: Matches

- **File:** `src/pages/Matches.tsx`
- **Route:** `/matches`
- **Auth required:** Yes

**Visual:** BottomNav; header with search and tabs (Conversations / Daily Drops). TabsList + TabsTrigger; search Input placeholder “Search by name or vibe…”; WhoLikedYouGate (premium gate); NewVibesRail (new vibes); list of SwipeableMatchCard or MatchAvatar; ProfileDetailDrawer; DropsTabContent (Daily Drops tab); UnmatchDialog, ArchiveMatchDialog, BlockUserDialog, MuteOptionsSheet, ReportWizard; PullToRefresh; EmptyMatchesState when no matches. PhoneVerificationNudge conditional.

**Empty state:** EmptyMatchesState — icon, heading, body, CTA.

---

### Screen: Chat

- **File:** `src/pages/Chat.tsx`
- **Route:** `/chat/:id`
- **Auth required:** Yes

**Visual:** ChatHeader (back, name, avatar, actions — film/Vibe Clip, CalendarDays, Gamepad2); message list (MessageBubble, VoiceMessageBubble, VideoMessageBubble for legacy video, **VibeClipBubble** for `vibe_clip`, DateProposalTicket, GameBubbleRenderer, TypingIndicator); input bar (textarea, Send, VoiceRecorder, VideoMessageRecorder, DateSuggestionChip, VibeArcadeMenu); IncomingCallOverlay, ActiveCallOverlay; VibeSyncModal. Lucide: Send, Film, CalendarDays, Gamepad2.

---

### Screen: Profile

- **File:** `src/pages/Profile.tsx` (route wrapper) + `src/pages/ProfileStudio.tsx` (full implementation)
- **Route:** `/profile`
- **Auth required:** Yes

**Visual:** `/profile` delegates to Profile Studio. The complete visual/edit surface (hero/cover, photos, vibe score, prompts, intent, verification, drawers/sheets, Record vibe, Save, Log out) is implemented in `src/pages/ProfileStudio.tsx`.

---

### Screen: Settings

- **File:** `src/pages/Settings.tsx`
- **Route:** `/settings`
- **Auth required:** Yes

**Visual:** Settings rows (NotificationsDrawer, AccountSettingsDrawer, FeedbackDrawer, etc.); Manage Subscription; Log Out; Delete account; Credits; version/copy. Uses Sheet/Drawer for sub-pages.

---

### Screen: Auth

- **File:** `src/pages/Auth.tsx`
- **Route:** `/auth`
- **Auth required:** No

**Visual:** Centered card; logo/title; mode signin/signup; Input email, password, name (signup); Button “Sign in” / “Create account”; “Forgot password?” link; toggle “Don't have an account? Sign up” / “Already have an account? Sign in”; success state (Check, “Welcome!”). Icons: Mail, Lock, User, Loader2, Sparkles, ArrowLeft. Glow intensity from form completion.

---

### Screen: Onboarding

- **File:** `src/pages/Onboarding.tsx`
- **Route:** `/onboarding`
- **Auth required:** Yes (ProtectedRoute)

**Visual:** Step indicator; form fields (name, tagline, job, about, photos, vibes, etc.); Button “Let's Go”, “Continue”, “Complete on web”, “Complete Profile”. ProfileWizard, OnboardingStep.

---

### Screen: VideoDate

- **File:** `src/pages/VideoDate.tsx`
- **Route:** `/date/:id`
- **Auth required:** Yes

**Visual:** Full-screen video; HandshakeTimer, VideoDateControls, VibeCheckButton, ConnectionOverlay, PartnerProfileSheet, PostDateSurvey, KeepTheVibe, ReconnectionOverlay, MutualVibeToast; SelfViewPIP.

---

### Screen: Premium

- **File:** `src/pages/Premium.tsx`
- **Route:** `/premium`
- **Auth required:** No

**Visual:** Marketing copy; pricing; Button “Get Premium”, “Go Home”, “Back”. Icons Sparkles, Check.

---

### Screen: Credits

- **File:** `src/pages/Credits.tsx`
- **Route:** `/credits`
- **Auth required:** Yes

**Visual:** Balance display; purchase/restore; link to success page.

---

### Screen: MatchCelebration

- **File:** `src/pages/MatchCelebration.tsx`
- **Route:** `/match-celebration`
- **Auth required:** Yes

**Visual:** Celebration asset/image; Button “Message” → chat.

---

### Screen: ReadyGate

- **File:** `src/pages/ReadyRedirect.tsx` (ReadyGate)
- **Route:** `/ready/:id`
- **Auth required:** Yes

**Visual:** Ready gate flow; partner preview; “I'm Ready” CTA.

---

### Other pages (brief)

- **ResetPassword:** `/reset-password` — form + submit.
- **HowItWorks:** `/how-it-works` — marketing.
- **UserProfile:** `/user/:userId` — public profile view.
- **VibeStudio:** `/vibe-studio` — dedicated Vibe Video studio page; recording/editing still reuse `VibeStudioModal`, but management now lives on the route itself.
- **Schedule:** `/schedule` — first-class planning hub for availability, pending plans, upcoming plans, and history.
- **SubscriptionSuccess / SubscriptionCancel:** post-payment.
- **EventPaymentSuccess, CreditsSuccess:** success screens.
- **PrivacyPolicy, TermsOfService, DeleteAccountWeb, CommunityGuidelines:** legal under `/privacy`, `/terms`, `/delete-account`, `/community-guidelines`.
- **NotFound:** `*` — 404.
- **Admin:** `/kaan`, `/kaan/dashboard` — admin login and dashboard.

---

## PART 3: SHARED COMPONENTS

| Component | File | Used in | Props (summary) | Key styles |
|-----------|------|---------|-----------------|------------|
| BottomNav | BottomNav.tsx | All tab pages | — | fixed bottom z-50 glass-card border-t border-white/10 pb-safe; h-16 max-w-lg mx-auto; NavLink text-primary when active else text-muted-foreground; icon wrapper active: bg-primary/20 neon-glow-violet; Lucide Home, Calendar, Heart, User 20×20; label text-xs font-medium; Droplet badge when drop ready |
| DashboardGreeting | DashboardGreeting.tsx | Dashboard | — | space-y-2; greeting text-sm text-muted-foreground; name text-xl font-display font-bold; button “Complete your profile…” rounded-full bg-accent/10 border border-accent/20 text-xs text-accent |
| FeaturedEventCard | events/FeaturedEventCard.tsx | Events | id, title, description, image, eventDate, attendees, tags | glass-card, cover, gradient, title, date, CTA |
| EventCardPremium | events/EventCardPremium.tsx | Events | id, title, image, date, time, attendees, tags, status, scope, city, country, distanceKm | Card with scope label, status badge, Register/Enter Lobby |
| VenueCard | events/VenueCard.tsx | EventDetails | event, onEnterLobby, … | Cover, gradient, back button, date, Enter Lobby / View Ticket / Manage Booking |
| LobbyProfileCard | lobby/LobbyProfileCard.tsx | EventLobby | profile, onSwipe, … | Swipeable card, photo, name, vibes |
| ReadyGateOverlay | lobby/ReadyGateOverlay.tsx | EventLobby | sessionId, partner, onReady, onClose | Modal overlay; “I'm Ready ✨” primary button |
| MessageBubble | chat/MessageBubble.tsx | Chat | message, isMe, … | Bubble styling, time, status |
| ChatHeader | chat/ChatHeader.tsx | Chat | match, onBack, onVideo, … | Back, avatar, name, actions (Video, Calendar, Gamepad) |
| SwipeableMatchCard | SwipeableMatchCard.tsx | Matches | match, onClick, … | Card with avatar, name, last message, unread |
| ProfileDetailDrawer | ProfileDetailDrawer.tsx | Matches, EventDetails | match, open, onClose | Sheet/drawer; profile content, Message, Unmatch, etc. |
| DropsTabContent | matches/DropsTabContent.tsx | Matches | drops, … | Daily drops list; reply input; “Start Chatting” |
| DateReminderCard | schedule/DateReminderCard.tsx | Dashboard, Schedule | reminder, onJoinDate, onEnableNotifications | Card with countdown, “Join Now” button; CTA prefers active `/date/:id` when known, otherwise safe fallback by surface |
| MiniDateCountdown | schedule/DateReminderCard.tsx | Dashboard | reminder, onClick | Compact countdown pill |
| PricingBar | events/PricingBar.tsx | EventDetails | event, userPrice, onPurchase, … | Price, “Purchase Ticket” / “Register” |
| WhosGoingSection / GuestListTeaser | events/ | EventDetails | attendees, … | Avatars, “See all” |
| ActiveCallBanner | events/ActiveCallBanner.tsx | Dashboard | sessionId, onRejoin, onEnd | Banner “Rejoin” / “End” |
| OfflineBanner | OfflineBanner.tsx | App | — | Top banner WifiOff, “You're offline” |
| PhoneVerificationNudge | PhoneVerificationNudge.tsx | Dashboard, Events, Matches | variant, onDismiss, onVerified | CTA to verify phone |
| DeletionRecoveryBanner | settings/DeletionRecoveryBanner.tsx | Dashboard | scheduledDate, onCancel, isCancelling | “Account scheduled for deletion” + Cancel |
| WhoLikedYouGate | premium/WhoLikedYouGate.tsx | Matches | children | Premium gate overlay |
| PremiumPill | premium/PremiumPill.tsx | EventLobby | — | Premium badge/pill |
| NotificationPermissionFlow | NotificationPermissionFlow.tsx | Dashboard, Settings | open, onOpenChange, onRequestPermission | Modal; Enable / Not now |
| VibePlayer / VibeStudioModal | vibe-video/ | ProfileStudio (`/profile`), VibeStudio (`/vibe-studio`) | — | Video player, record/edit modal |
| VerificationBadge / PhotoVerifiedMark | verification/ | Profile, cards | — | Checkmark/badge |
| PullToRefresh | PullToRefresh.tsx | Dashboard, Matches | onRefresh, className, children | Wrapper for pull-to-refresh |
| Skeleton / EventCardSkeleton / MatchAvatarSkeleton | Skeleton.tsx, ShimmerSkeleton.tsx | Dashboard, Events | — | animate-pulse bg-muted rounded-lg; card/avatar shapes |
| ProfilePhoto | ui/ProfilePhoto.tsx | Dashboard, cards | photos, name, size, rounded | Avatar with fallback initials |

*(Additional components in src/components/ follow same pattern: file path, usage, props, key Tailwind/classes.)*

---

## PART 4: BUTTON INVENTORY

| Screen/Component | Button text | Variant | Tailwind / classes | Height (px) | BorderRadius (px) | FontSize | FontWeight | Background | TextColor | Icon | onClick |
|-----------------|-------------|---------|--------------------|-------------|-------------------|----------|------------|------------|-----------|------|--------|
| Dashboard | Enter Lobby → | gradient | w-full text-base py-6 | 48+ | 24 | 16 | 600 | gradient primary→accent | white | — | navigate lobby |
| Dashboard | View & Register | outline sm | w-full | 40 | 16 | 14 | 600 | transparent | primary | CalendarCheck | navigate event |
| Dashboard | Browse Events | ghost | mt-2 | 48 | 24 | 14 | 600 | transparent | foreground | — | /events |
| Dashboard | Go Premium → | outline sm | shrink-0 text-xs border-primary/30 | 40 | 16 | 12 | 600 | transparent | primary | — | /events |
| Dashboard | See all | (link) | text-sm text-primary | — | — | 14 | 400 | — | primary | ChevronRight | /matches |
| Dashboard | Browse Events → | outline sm | — | 40 | 16 | 14 | 600 | — | — | — | /events |
| Events | Not now | ghost | h-7 text-xs | 28 | 24 | 12 | 600 | — | muted-foreground | — | dismiss |
| Events | Enable | default sm | h-7 text-xs | 28 | 24 | 12 | 600 | primary | primary-foreground | — | enable location |
| Events | Explore with Premium → | gradient/custom | from-primary to-accent | 40 | 24 | 14 | 600 | gradient | white | Sparkles | premium |
| Auth | Sign in / Create account | default | — | 48 | 24 | 14 | 600 | primary | primary-foreground | — | submit |
| EventDetails | Back to Events | default | — | 48 | 24 | 14 | 600 | primary | primary-foreground | — | /events |
| EventDetails | Enter Lobby / View Ticket / Manage Booking | primary / secondary | — | 48 | 24 | 14 | 600 | — | — | — | navigate / modal |
| Matches | (search/filter) | — | — | — | — | — | — | — | — | — | — |
| Chat | Send | (icon button) | — | — | — | — | — | — | — | Send | sendMessage |
| Profile | Save / Log out / Record / Complete | mixed | — | 40–56 | 16–24 | 14–16 | 600 | variant | variant | — | various |
| Settings | Manage Subscription / Log Out / Delete | secondary / destructive | — | 40–48 | 24 | 14 | 600 | secondary/destructive | — | — | billing / logout / delete |
| shadcn Button default | (label) | default | h-12 px-6 py-3 rounded-2xl text-sm font-semibold | 48 | 24 | 14 | 600 | primary | primary-foreground | — | onPress |
| shadcn Button sm | (label) | — | h-10 rounded-xl px-4 | 40 | 16 | 14 | 600 | — | — | — | — |
| shadcn Button lg | (label) | — | h-14 rounded-2xl px-8 text-base | 56 | 24 | 16 | 600 | — | — | — | — |

*(Every Button in the app uses one of the shadcn variants/sizes above; label and onClick are screen-specific.)*

---

## PART 5: INPUT INVENTORY

| Screen/Component | Placeholder | Type | Tailwind / classes | Height (px) | BorderRadius | FontSize | Background | BorderColor | Padding |
|-----------------|-------------|------|--------------------|-------------|--------------|----------|------------|-------------|---------|
| Auth | Email | email | Input | 40 | md (calc) | 16 (md: 14) | background | input | px-3 py-2 |
| Auth | Password | password | Input | 40 | md | 16 | background | input | px-3 py-2 |
| Auth | Name (signup) | text | Input | 40 | md | 16 | background | input | px-3 py-2 |
| Matches | Search by name or vibe… | text/search | Input | 40 | md | 14 | background | input | px-3 py-2 |
| Events | (EventsFilterBar search) | search | — | 40 | — | 14 | — | — | — |
| Chat | Type a message… | text | textarea/input | — | md | 14–16 | — | — | — |
| Profile | Name, tagline, job, about | text | Input/Textarea | 40 / multi | md | 14–16 | background | input | px-3 py-2 |
| FeedbackDrawer | Describe your feedback… | text | Textarea | — | md | 14 | background | input | — |
| DropsTabContent | Reply… / Say something… | text | — | — | — | — | — | — | — |
| shadcn Input | (placeholder) | — | h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm | 40 | md | 16/14 | background | input | 12px 8px |

---

## PART 6: ICON INVENTORY

| Screen/Component | Library | Icon name | Size (px) | Color | Purpose |
|-----------------|----------|-----------|-----------|-------|---------|
| Dashboard | lucide-react | ChevronRight, Sparkles, CalendarCheck, Users, Radio | 14–16 | primary, foreground, destructive | Section links, live badge, countdown, attendees |
| Dashboard | lucide-react | (ProfilePhoto) | 32 | — | Avatar |
| Events | lucide-react | Calendar, Sparkles, MapPin, Globe, Lock | 16–24 | primary, muted-foreground | Header, location, happening elsewhere |
| EventDetails | lucide-react | ArrowLeft, Calendar, Clock, Share2, Loader2, MapPin, Globe, RefreshCw | 24 | foreground, primary | Back, meta, share, loading |
| Auth | lucide-react | Check, Loader2, Sparkles, Mail, Lock, User, ArrowLeft | 16–24 | — | Form, success |
| BottomNav | lucide-react | Home, Calendar, Heart, User, Droplet | 20 | primary / muted-foreground | Tab icons, drop badge |
| Chat | lucide-react | Send, Video, CalendarDays, Gamepad2 | 16–24 | — | Send, video call, date, games |
| Dialog/Sheet close | lucide-react | X | 16 | — | Close |
| Various | lucide-react | AlertTriangle, WifiOff | 32, 18 | destructive, foreground | Error fallback, offline |

*(All icons are Lucide React; size via className w-* h-*; color via text-primary, text-muted-foreground, etc.)*

---

## PART 7: IMAGE INVENTORY

| Screen/Component | Source type | Width | Height | BorderRadius | ObjectFit | Aspect ratio | Fallback |
|-----------------|-------------|-------|--------|--------------|-----------|--------------|----------|
| Event cards | URL (event cover) | full / 260px min | 144 / auto | 2xl (top) | cover | 16/9 or auto | Skeleton / muted |
| EventDetails hero | URL | full | auto | 2xl top | cover | — | — |
| Profile photo (avatar) | URL or initials | 32–56 | 32–56 | full | cover | 1 | Initials |
| Match avatars | URL | 52–64 | 52–64 | full | cover | 1 | — |
| LobbyProfileCard | URL | card | card | xl/2xl | cover | — | — |
| Chat attachments | URL | max-w | auto | lg | cover | — | — |
| Vibe video | URL / stream | full | full | 0 | cover | — | — |
| HappeningElsewhere city | URL | 160 | 96 | xl | cover | — | Globe icon + bg |

---

## PART 8: ANIMATION INVENTORY

| Screen/Component | Element | initial | animate | exit | transition | Trigger |
|-----------------|---------|---------|---------|------|------------|--------|
| Dashboard | ActiveCallBanner | — | — | — | AnimatePresence | activeSession |
| Dashboard | PhoneVerificationNudge | opacity 0, height 0 | opacity 1, height auto | opacity 0, height 0 | — | showDashboardPhoneNudge |
| Dashboard | Live badge | — | scale [1, 1.2, 1] | — | duration 1.5 repeat Infinity | always |
| Dashboard | Live section | opacity 0, y 10 | opacity 1, y 0 | — | — | mount |
| Dashboard | Other cities nudge | opacity 0, y 8 | opacity 1, y 0 | — | — | mount |
| Events | LocationPromptBanner | opacity 0, y -8 | opacity 1, y 0 | — | — | mount |
| Events | Filtered grid items | opacity 0, scale 0.9 | opacity 1, scale 1 | opacity 0, scale 0.9 | duration 0.2 | filter change |
| EventLobby | Swipe cards | (motion value) | — | — | PanInfo | swipe |
| Auth | (form glow) | — | — | — | glowIntensity from fields | input |
| Dialog/Sheet | Overlay, content | (tailwind animate-in) | — | animate-out | duration-200/300/500 | open/close |
| TypingIndicator | Dots | — | scale/opacity loop | — | 300ms | isTyping |
| Skeleton | — | — | pulse | — | default | loading |

*(Framer Motion: motion.div, AnimatePresence, useMotionValue, useTransform; Tailwind: animate-in, animate-out, animate-pulse, animate-glow-pulse.)*

---

## PART 9: MODAL / SHEET / DRAWER INVENTORY

| Name | File | Trigger | Type | Overlay | Content background | BorderRadius | Width | Animation |
|------|------|----------|------|---------|--------------------|--------------|-------|-----------|
| NotificationPermissionFlow | NotificationPermissionFlow.tsx | notification click | Dialog/Modal | bg-black/80 | bg-background | lg | max-w-lg | fade-in |
| PaymentModal | events/PaymentModal.tsx | Register / Purchase | Dialog | bg-black/80 | bg-background | lg | max-w-lg | zoom/slide |
| ManageBookingModal | events/ManageBookingModal.tsx | Manage Booking | Dialog | bg-black/80 | bg-background | lg | max-w-lg | slide |
| CancelBookingModal | events/CancelBookingModal.tsx | Cancel spot | Dialog | bg-black/80 | bg-background | lg | — | — |
| TicketStub | events/TicketStub.tsx | View Ticket | Modal/Sheet | — | bg-background | — | — | slide |
| ProfileDetailDrawer | ProfileDetailDrawer.tsx | Match row click | Sheet (right) | bg-black/80 | bg-background | — | w-3/4 sm:max-w-sm | slide |
| FeedbackDrawer | settings/FeedbackDrawer.tsx | Feedback | Drawer/Sheet | bg-black/80 | bg-background | rounded-t-[10px] | — | vaul |
| NotificationsDrawer | settings/NotificationsDrawer.tsx | Notifications | Drawer | bg-black/80 | bg-background | — | — | — |
| AccountSettingsDrawer | settings/AccountSettingsDrawer.tsx | Account | Drawer | bg-black/80 | bg-background | — | — | — |
| ReadyGateOverlay | lobby/ReadyGateOverlay.tsx | Match ready | Modal | dark | glass/card | 2xl | — | fade |
| EventEndedModal | events/EventEndedModal.tsx | Event ended | Dialog | bg-black/80 | bg-background | — | — | fade |
| IncomingCallOverlay | chat/IncomingCallOverlay.tsx | Incoming call | Modal | dark | — | — | — | fade |
| ActiveCallOverlay | chat/ActiveCallOverlay.tsx | In call | Modal | dark | — | — | — | fade |
| WhoLikedYouGate | premium/WhoLikedYouGate.tsx | Who liked you | Modal/overlay | — | — | — | — | — |
| DeleteAccountModal | settings/DeleteAccountModal.tsx | Delete account | Dialog | bg-black/80 | bg-background | lg | — | — |
| UnmatchDialog | UnmatchDialog.tsx | Unmatch | Dialog | bg-black/80 | bg-background | — | — | — |
| ReportWizard | safety/ReportWizard.tsx | Report | Sheet | bg-black/80 | bg-background | — | — | — |
| VibeStudioModal | vibe-video/VibeStudioModal.tsx | Record vibe | Modal | — | — | — | — | — |

---

## PART 10: NAVIGATION

**Routes (from App.tsx):**

| Path | Component | Protected |
|------|-----------|-----------|
| / | Index | No |
| /auth | Auth | No |
| /reset-password | ResetPassword | No |
| /onboarding | Onboarding | Yes |
| /dashboard, /home | Dashboard | Yes |
| /events | Events | Yes |
| /events/:id | EventDetails | Yes |
| /event/:eventId/lobby | EventLobby | Yes |
| /matches | Matches | Yes |
| /chat/:id | Chat | Yes |
| /profile | Profile | Yes |
| /settings | Settings | Yes |
| /date/:id | VideoDate | Yes |
| /ready/:id | ReadyGate | Yes |
| /admin/create-event | AdminCreateEvent | Yes (admin) |
| /match-celebration | MatchCelebration | Yes |
| /vibe-studio | VibeStudio | Yes |
| /schedule | Schedule | Yes |
| /how-it-works | HowItWorks | No |
| /privacy | PrivacyPolicy | No |
| /terms | TermsOfService | No |
| /delete-account | DeleteAccountWeb | No |
| /community-guidelines | CommunityGuidelines | No |
| /premium | Premium | No |
| /subscription/success | SubscriptionSuccess | No |
| /subscription/cancel | SubscriptionCancel | No |
| /event-payment/success | EventPaymentSuccess | Yes |
| /credits | Credits | Yes |
| /credits/success | CreditsSuccess | Yes |
| /user/:userId | UserProfile | Yes |
| /kaan | AdminLogin | No |
| /kaan/dashboard | AdminDashboard | Yes (admin) |
| * | NotFound | No |

**BottomNav:** Fixed bottom; 4 tabs: Home (/home), Events (/events), Matches (/matches), Profile (/profile). Icons: Home, Calendar, Heart, User (lucide 20×20). Active: text-primary, bg-primary/20 neon-glow-violet; inactive: text-muted-foreground. Label text-xs font-medium. Drop badge on Home when daily drop ready (Droplet icon). Height h-16 + pb-safe.

**Back navigation:** ArrowLeft in EventDetails, EventLobby, Chat (ChatHeader), etc.; router.back() or navigate(path).

---

## PART 11: EMPTY STATES

| Screen | Condition | Icon/Illustration | Heading text | Body text | CTA button text | CTA action |
|--------|-----------|-------------------|--------------|-----------|-----------------|------------|
| Dashboard | No next event | — | — | No upcoming events | Browse Events | /events |
| Dashboard | No matches | — | — | No matches yet. Join an event to start connecting! | Browse Events → | /events |
| Events (filtering) | No results | Calendar 32×32 muted | No events found | Try adjusting your filters or search terms | — | — |
| Events (no local) | No local events | Calendar 32×32 | No events near you yet 💫 | But there are events happening in other cities! | Go Premium to explore → | premium |
| Matches | No matches | (EmptyMatchesState) | (varies) | (varies) | (varies) | /events or verify |
| Chat | No messages | — | — | — | — | — |
| Lobby | No profiles | LobbyEmptyState | (component) | (component) | (component) | — |

---

## PART 12: LOADING STATES

| Screen | Loading component | Skeleton shapes | Spinner type | Background |
|--------|-------------------|-----------------|--------------|------------|
| Dashboard | EventCardSkeleton, MatchAvatarSkeleton | Next event card; 5 match circles; 2 discover cards 260px | — | background |
| Events | FeaturedEventSkeleton, EventsRailSkeleton | 1 featured + 3 rails | — | background |
| EventDetails | — | — | Loader2 32×32 animate-spin text-primary | bg-background center |
| Matches | MatchCardSkeleton, NewVibesRailSkeleton | Cards, rail | — | background |
| Chat | — | — | (optional TypingIndicator) | — |
| Profile | Skeleton | Lines, avatar | — | background |
| Auth | — | — | Loader2 in button | — |
| DashboardGreeting | Skeleton | h-4 w-20, h-6 w-24 | — | — |

*(ShimmerSkeleton used where shimmer-effect class applied; otherwise Skeleton animate-pulse bg-muted.)*

---

## PART 13: ERROR STATES

| Screen | Error message | Retry button text | Retry action |
|--------|----------------|-------------------|-------------|
| EventDetails | Event not found. This event may have been removed or doesn't exist. | Back to Events | navigate /events |
| App (Sentry fallback) | Something went wrong. We've been notified and are looking into it. Try refreshing the page. | Refresh Page, Try Again | window.location.reload(), resetError |
| Auth | (error state from signIn/signUp) | — | — |
| General | toast.error(…) | — | — |

*(Errors often surface via toast (sonner); dedicated error UI on EventDetails and Sentry fallback.)*

---

## Appendix: File checklist

**Pages (35):** Index, Auth, ResetPassword, Onboarding, Dashboard, Events, EventDetails, EventLobby, Matches, Chat, Profile, Settings, VideoDate, ReadyRedirect, MatchCelebration, VibeStudio, Schedule, HowItWorks, UserProfile, Premium, SubscriptionSuccess, SubscriptionCancel, EventPaymentSuccess, Credits, CreditsSuccess, legal/*, admin/*, NotFound.

**Components:** 259+ files under src/components (ui/, events/, chat/, lobby/, match/, schedule/, video-date/, premium/, settings/, notifications/, verification/, safety/, etc.). This doc references the main shared and screen-specific components; full list from glob above.

---

*Generated from codebase. Use as source of truth for native parity. For line-level JSX, open the corresponding src file.*
