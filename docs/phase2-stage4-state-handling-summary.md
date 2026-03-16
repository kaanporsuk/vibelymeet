# Phase 2 Stage 4 — State handling polish summary

**Goal:** Align dashboard loading, skeleton, empty, and error states with Vibely web product quality — branded, layout-consistent, calm, and structurally aligned with loaded content.

---

## 1. Polished state components and patterns

| State | Pattern | Implementation |
|------|--------|----------------|
| **Loading placeholders** | Layout-matched skeletons (web: EventCardSkeleton, MatchAvatarSkeleton) | **EventCardSkeleton** — Next Event card shape: 144px image area + body with four countdown blocks + CTA bar. **MatchAvatarSkeleton** — circle (52) + name line (40×12). **DiscoverCardSkeleton** — 260×120 image + body with title/meta/attendees lines. All use `theme.muted` for placeholder blocks (web bg-muted parity). |
| **Empty event state** | Minimal, restrained (web: glass-card, text + ghost button) | **EmptyState** with `showIllustration={false}` for “No upcoming events” — title + “Browse Events” button only; no gradient illustration. Wrapper: Card variant="glass". |
| **Empty matches state** | Same minimal treatment | **EmptyState** with `showIllustration={false}` for “No matches yet” — title, message, “Browse Events” button; Card variant="glass". |
| **Error / unavailable** | Minimal inline recovery | **Error banner** when `(eventsError || matchesError) && !loading`: Card variant="glass", one line “Something went wrong” + “Retry” secondary button that refetches both queries. No full-screen takeover. |
| **Pull-to-refresh** | Existing RefreshControl | Unchanged: `RefreshControl` with `tintColor={theme.tint}`. No extra success toast or animation to avoid clutter. |
| **Layout stability** | No abrupt jumps | Next Event section always present: when loading and no `nextEvent`, show **EventCardSkeleton** in same slot (SectionHeader + skeleton card). When data arrives, swap skeleton for real card. Matches and Upcoming sections keep same structure; only inner content swaps between skeleton and real/list/empty. |

---

## 2. Changes applied on dashboard

- **Next Event:** When `loading && !nextEvent`, render SectionHeader + EventCardSkeleton (no longer hide section). When `nextEvent`, render real card. When `!loading && !nextEvent`, render empty Card + EmptyState with `showIllustration={false}`.
- **Your Matches:** Loading → 5× MatchAvatarSkeleton in same row layout. Empty → Card variant="glass" + EmptyState with `showIllustration={false}`.
- **Upcoming Events:** Loading → 2× DiscoverCardSkeleton in same horizontal rail. Empty (no discover events) → nothing (section stays; “All events” link still goes to events).
- **Error:** If `eventsError` or `matchesError` and not loading, show error banner at top of main content with Retry; `handleRetry` calls `refetchEvents()` and `refetchMatches()`.

---

## 3. Reusable patterns for later screens

| Pattern / primitive | Location | Reuse |
|---------------------|----------|--------|
| **EventCardSkeleton** | ui.tsx | Any “next event” or single event card loading (e.g. event detail hero). Same layout: media strip + body with blocks + CTA. |
| **MatchAvatarSkeleton** | ui.tsx | Any horizontal match/avatar list loading (e.g. matches tab, “recent activity”). |
| **DiscoverCardSkeleton** | ui.tsx | Any horizontal event/discover rail loading (e.g. events list, “more events”). |
| **Skeleton** with **backgroundColor** | ui.tsx | Use `backgroundColor={theme.muted}` for web bg-muted parity on other custom skeletons. |
| **EmptyState** with **showIllustration={false}** | ui.tsx | Any minimal empty (e.g. search no results, filtered list empty) where the web uses text + button only. |
| **Inline error banner** | dashboard only (pattern) | Other tab screens can show a Card variant="glass" row with message + Retry when a query fails, without full-screen ErrorState. |

---

## 4. Files changed

| File | Change |
|------|--------|
| `apps/mobile/components/ui.tsx` | Skeleton: optional `backgroundColor`. Added EventCardSkeleton, MatchAvatarSkeleton, DiscoverCardSkeleton. EmptyState: `showIllustration` prop (default true). New styles: eventCardSkeleton*, matchAvatarSkeleton, discoverCardSkeleton*. |
| `apps/mobile/app/(tabs)/index.tsx` | useEvents/useMatches: destructure `error`, `refetch`. Added `hasError`, `handleRetry`. Error banner when hasError. Next Event: show EventCardSkeleton when loading && !nextEvent. Matches: MatchAvatarSkeleton ×5 when loading. Upcoming: DiscoverCardSkeleton ×2 when loading. EmptyState for no events and no matches: `showIllustration={false}`. Styles: errorBanner, errorBannerText. |

---

## 5. Summary

- **Loading:** Layout-matched skeletons (event card, match avatar, discover card) avoid layout jumps and match web structure; muted fill keeps them calm and on-brand.
- **Empty:** Minimal empty states (no illustration) for no events and no matches align with web’s restrained copy + button.
- **Error:** Single inline error banner with Retry keeps recovery in-context without a full-screen takeover.
- **Refresh:** Unchanged; no extra feedback.
- **Reuse:** EventCardSkeleton, MatchAvatarSkeleton, DiscoverCardSkeleton, and EmptyState `showIllustration={false}` are ready for use on Events, Matches, and other screens.
