# Phase 2 — Branch summary and completion verification

## Verification checklist

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Dashboard no longer reads as placeholder/basic** | ✓ Met | GlassHeaderBar; VibelyText for titles/names; glass-like cards (surfaceSubtle, glassBorder, shadows); LIVE/registered badges; countdown with theme.secondary; “X new” pill; layout-matched skeletons (EventCardSkeleton, MatchAvatarSkeleton, DiscoverCardSkeleton); minimal empty states (showIllustration={false}); error banner with Retry; upcoming empty block; chip copy “Complete your profile for better matches”. |
| **Shell/header/tab spacing feels intentional and premium** | ✓ Met | layout.mainContentPaddingTop, containerPadding, scrollContentPaddingBottomTab; GlassHeaderBar uses layout.headerPadding* and containerPadding; tab bar uses layout.tabBar* and softened shadow (opacity/radius/elevation reduced). |
| **Dashboard sections visually hierarchical and web-consistent** | ✓ Met | SectionHeader and VibelyText titleMD; “See all” / “All events” at 12px; section gap spacing['2xl']; same section order as web (Next Event → Your Matches → Upcoming Events). |
| **Loading/empty/error states polished** | ✓ Met | EventCardSkeleton, MatchAvatarSkeleton, DiscoverCardSkeleton (theme.muted, layout-matched); EmptyState showIllustration={false} for no-events and no-matches; inline error banner (“Something went wrong” + Retry); upcoming empty block (dashed border + “Browse events” link). |
| **No backend contract changed unintentionally** | ✓ Met | useEvents: same Supabase query (events table, same select/order). useMatches: same query; isNew is derived client-side from existing matched_at. No new RPCs, no changed request/response shapes. eventCoverUrl, fetchMyProfile, useIsRegisteredForEvent unchanged. |
| **No provider stack drift** | ✓ Met | No changes to RevenueCat, OneSignal, Daily, or Supabase auth/client init. Dashboard uses only useEvents, useMatches, useIsRegisteredForEvent, useAuth. package.json unchanged. |
| **Changed shared/config/runtime surfaces called out** | ✓ Below | Rebuild delta section documents MatchListItem extension and theme layout addition. |
| **Branch ready for local device validation or Android dev rebuild** | ✓ Ready | UI changes are substantial (dashboard + shell + states); recommend local device validation first, then Android dev rebuild. |

---

## Final branch summary

### 1. What changed

- **Dashboard (app/(tabs)/index.tsx):** Layout and spacing from theme (mainContentPaddingTop, containerPadding, scrollContentPaddingBottomTab); Next Event card with glass-like styling, 144px cover, LIVE/registered badges, countdown (theme.secondary), VibelyText, CTA sizing; Your Matches with “X new” pill, new-match ring, MatchAvatarSkeleton when loading, minimal empty; Upcoming Events with 260px discover cards (radius 2xl, shadow, people icon), DiscoverCardSkeleton when loading, empty block when no events; error banner with Retry; EventCardSkeleton when loading and no next event; section link text 12px; empty states with showIllustration={false}.
- **Shell:** Tab bar shadow softened (opacity/radius/elevation); layout.mainContentPaddingTop added and used for content-below-header.
- **Components (ui.tsx):** Skeleton accepts optional backgroundColor; EventCardSkeleton, MatchAvatarSkeleton, DiscoverCardSkeleton added; EmptyState showIllustration prop; new skeleton styles.
- **DashboardGreeting:** Chip copy “Complete your profile for better matches”; skeleton uses theme.muted.
- **Data (chatApi.ts):** MatchListItem extended with isNew (derived from matched_at &lt; 24h). Same Supabase query; no API contract change.

### 2. Why it improved parity

- **Visual:** Dashboard and shell now match web hierarchy (section titles, links, card treatment), spacing (py-6, space-y-8, container padding), and glass-card intent (surfaceSubtle, border, shadow). Loading and empty states are layout-stable and restrained; error recovery is in-context.
- **Copy and hierarchy:** Greeting chip and section links aligned with web; typography scale (VibelyText) and 12px links make sections read clearly.
- **States:** Layout-matched skeletons avoid jumps; minimal empty and inline error keep the experience consistent with web quality.

### 3. Shared primitives added/updated

| Primitive | Location | Change |
|-----------|----------|--------|
| **Skeleton** | ui.tsx | Optional `backgroundColor` (e.g. theme.muted). |
| **EventCardSkeleton** | ui.tsx | New. Next-event card shape (media + countdown row + CTA). |
| **MatchAvatarSkeleton** | ui.tsx | New. Avatar circle + name line. |
| **DiscoverCardSkeleton** | ui.tsx | New. 260×120 + body lines. |
| **EmptyState** | ui.tsx | `showIllustration` prop (default true); false for minimal empty. |
| **layout.mainContentPaddingTop** | theme.ts | New. 24px content-top padding below header. |
| **MatchListItem** | lib/chatApi.ts | Extended with `isNew: boolean` (client-derived). |

### 4. Rebuild delta

- **Shared / config / runtime:**  
  - **MatchListItem** (lib/chatApi.ts): Type now includes `isNew: boolean`. Additive only; all consumers (dashboard, matches screen) remain compatible. No server or API contract change.  
  - **theme.ts**: New token `layout.mainContentPaddingTop`. No env or config file changes.  
  - **package.json**: No dependency changes.  
- **Recommendation:** No backend or provider redeploy. Native app: run `npx expo start` and/or Android dev build; TypeScript and existing tests remain valid.

### 5. Recommended validation step now

- **Local device validation first:** Run the app in simulator or on a device (iOS/Android). Check: header and content spacing; tab bar and safe area; pull-to-refresh; error banner and Retry; empty states (no events, no matches, no upcoming); skeleton layout during load; Next Event and discover cards readable and tappable.
- **Then Android dev rebuild:** If local validation looks good, run the Android EAS dev build to confirm on physical device and capture any device-specific issues before the next phase.

### 6. Recommended starting point for the next phase

- **Option A — Matches tab parity:** Apply the same shell and card patterns (GlassHeaderBar already used), VibelyText, section headers, and state primitives (MatchAvatarSkeleton, EmptyState, error pattern) so Matches feels consistent with the dashboard. Optionally switch Matches to use `item.isNew` from useMatches instead of time-based heuristic.
- **Option B — Events list parity:** Bring the Events tab to the same bar: header, section rhythm, event cards, DiscoverCardSkeleton/EventCardSkeleton, empty state.
- **Option C — Banners and nudges:** Add ActiveCallBanner, DeletionRecoveryBanner, and optional phone/date/Premium nudges on native, reusing web logic where possible.

Use the same layout constants and state primitives from Phase 2 so new screens stay consistent with the dashboard and shell.

---

## Phase 2 cleanup pass (post-verification)

### Next Event selection (web parity)

- **Web:** Dashboard uses `useNextRegisteredEvent()` — user’s next **registered** event (by date), or first upcoming event if none registered.
- **Native (before):** Dashboard used first upcoming from `useEvents()` (all events), and a separate `useIsRegisteredForEvent(nextEvent?.id)` for badge only.
- **Native (after):** Dashboard uses `useNextRegisteredEvent(user?.id)` from `lib/eventsApi.ts`: same logic as web (next registered, else first upcoming). `nextEvent` and `isRegistered` both come from this hook. Register/unregister mutations invalidate `next-registered-event` so the card updates.

### Font parity

- **Audit:** Web uses Inter (body) and Space Grotesk (display) via Google Fonts in `src/index.css`. Mobile loads only SpaceMono in `app/_layout.tsx`; `theme.fonts.body` / `theme.fonts.display` are `undefined` (system fallback).
- **Blocker:** No Inter or Space Grotesk font assets in `apps/mobile/assets/fonts/`. Font loading was not changed in this pass.
- **Documentation:** `docs/phase2-cleanup-font-parity.md` describes the blocker and the exact files/steps to complete font parity once assets are added.

### Cleanup files changed

| File | Change |
|------|--------|
| `apps/mobile/lib/eventsApi.ts` | Added `useNextRegisteredEvent(userId)`, `NextRegisteredEventResult`, `rowToEventListItem`, `fetchFirstUpcomingEvent`; register/unregister invalidate `next-registered-event`. |
| `apps/mobile/app/(tabs)/index.tsx` | Switched to `useNextRegisteredEvent(user?.id)` for `nextEvent` and `isRegistered`; removed `useIsRegisteredForEvent`; refresh and retry include `refetchNextEvent`; loading includes `nextEventLoading`. |
| `docs/phase2-cleanup-font-parity.md` | New: font parity audit, blocker, and completion steps. |
| `docs/phase2-branch-summary.md` | This cleanup section added. |

### Rebuild delta after cleanup

- **None.** No new env, config, or provider changes. Same Supabase/API usage; only dashboard data source for “Next Event” aligned with web.

### Phase 2 signoff

- **Next Event behavior:** Matches web (next registered, else first upcoming).
- **Font parity:** Documented; not in place until Inter/Space Grotesk assets are added and wired per `docs/phase2-cleanup-font-parity.md`.
- **Phase 2 is fully signoff-ready** for UI/shell/state and Next Event logic; font parity remains a follow-up when assets exist.
