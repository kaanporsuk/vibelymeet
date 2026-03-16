# Phase 2 Stage 1 — Web-to-native dashboard audit

**Scope:** Compare web Dashboard (`src/pages/Dashboard.tsx`) with native dashboard (`apps/mobile/app/(tabs)/index.tsx`) to drive parity.

**Web source:** `src/pages/Dashboard.tsx`, `src/components/DashboardGreeting.tsx`, `src/components/BottomNav.tsx`.

---

## 1. Structure comparison

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| **Shell** | PullToRefresh, min-h-screen bg-background pb-24 | View + ScrollView + RefreshControl | ✓ Equivalent |
| **Header** | Sticky glass-card border-b px-4 py-4, max-w-lg mx-auto; Greeting \| (MiniDateCountdown?, NotificationPermissionButton, ProfilePhoto) | GlassHeaderBar; Greeting \| (notif dot, Avatar) | MiniDateCountdown not on native; notification UI differs (no permission flow in header on native) |
| **Main** | max-w-lg mx-auto px-4 py-6 space-y-8 | paddingHorizontal 16, paddingTop 20, gap 28 | Section gap web 32px (space-y-8), native 28px; top padding web 24px (py-6), native 20px |
| **Next Event (not live)** | Section "Next Event"; glass-card h-36 cover; gradient overlay; Registered badge top-right; title/date bottom-left; countdown w-14 h-14 (56px) rounded-xl bg-secondary, gradient-text; View & Register outline / View event | SectionHeader + Pressable card; 192px cover; overlay; Registered badge; countdown 54×54 radius.md; CTA | Cover height (144 vs 192); countdown block 56px + rounded-xl (web) vs 54 + md; card glass vs solid surface |
| **Live Event** | Section with glass-card neon-glow-pink; LIVE badge (destructive/20 border); "Enter Lobby →" gradient button | Same block with Enter Lobby; badge styling differs | LIVE badge styling (pulse, destructive colors) |
| **No events** | glass-card p-6 "No upcoming events" + Browse Events ghost | Card + EmptyState (illustration + CTA) | Copy aligned; presentation differs (EmptyState has default illustration) |
| **Your Matches** | "Your Matches" + "X new" pill (bg-neon-pink/20) when newMatchCount > 0; "See all" link; horizontal scroll; new matches have gradient ring (animate-glow-pulse) | SectionHeader "Your Matches" + See all; no "X new" pill; no gradient ring for new | **Missing:** new count pill; new-match ring treatment |
| **Upcoming Events** | "Upcoming Events", "All events"; horizontal scroll min-w-[260px] glass-card; EventCover + title, date•time, attendees | SectionHeader + horizontal discover cards 248px; same content | Card width 260 vs 248; glass vs surface |
| **Other** | ActiveCallBanner, DeletionRecoveryBanner, PhoneVerificationNudge, Imminent date reminders, Premium/other-cities nudge | None | Deferred: banners/nudges in later stages |

---

## 2. Visual / token gaps

- **Section spacing:** Web space-y-8 = 32px between sections; native gap 28. Use spacing['2xl'] (32) and main paddingTop spacing.xl (24).
- **Countdown:** Web 56×56 rounded-xl bg-secondary, gradient-text numbers; native 54×54 radius.md. Use 56px, radius.lg (16) for rounded-xl, theme.secondary bg.
- **Your Matches "X new" pill:** Web shows count of matches newer than 24h. Native API has matched_at but does not expose isNew; add isNew to MatchListItem and show pill.
- **Discover card width:** Web 260px; native 248px. Optional align to 260.
- **Next event cover height:** Web h-36 (144px); native 192px. Optional reduce to 144 for parity.
- **Card treatment:** Web glass-card (translucent + border); native Card default solid. Use variant="glass" where appropriate for Next Event / Discover for parity.

---

## 3. Data / behavior

- **Next event source:** Web useNextRegisteredEvent (prioritises registered); native uses first upcoming from useEvents. Different semantics; keep native behaviour unless product asks to align.
- **New match count:** Web useDashboardMatches returns isNew (matched < 24h). Native useMatches: add isNew from matched_at for pill and optional ring.

---

## 4. Implementation order (Stage 1 first pass)

1. **Layout/spacing:** Main paddingTop 24px; section gap 32px.
2. **Countdown:** Block 56×56, radius.lg, backgroundColor theme.secondary; countdown value style (gradient-text → primary/tint).
3. **Your Matches:** Add isNew to MatchListItem (chatApi); compute newMatchCount; render "X new" pill next to title; optional gradient ring for new matches (tint border/ring).
4. **Discover cards:** Width 260px; optionally Card variant glass.
5. **Next Event card:** Optionally variant="glass", cover height 144px (defer if too impactful).

Stage 1 implementation focuses on (1)–(3) as first safe, high-impact changes.

---

## 5. Stage 1 implementation completed (first pass)

| Change | Status |
|--------|--------|
| Main paddingTop 24px, gap 32px (spacing.xl, spacing['2xl']) | Done |
| Countdown blocks 56×56, radius.lg, bg theme.secondary | Done |
| MatchListItem.isNew from matched_at < 24h | Done (chatApi) |
| "Your Matches" + "X new" pill when newMatchCount > 0 | Done |
| New-match avatar ring (border theme.tint) | Done |
| Scroll bottom padding uses layout.scrollContentPaddingBottomTab | Done |
| Next Event glass card / cover 144px / discover 260px | Deferred to Stage 2 |
