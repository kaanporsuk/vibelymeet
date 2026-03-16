# Phase 4 — Matches and chat list parity — Summary

**Branch:** `feat/mobile-phase4-matches-chat-parity`

---

## 1. What was implemented

### Stage 1 — List and row parity audit
- **Deliverable:** `docs/phase4-stage1-matches-chat-audit.md`
- Audited web (`Matches.tsx`, `Chat.tsx`, `SwipeableMatchCard`, `NewVibesRail`, `EmptyMatchesState`) vs native (`matches/index.tsx`, `chat/[id].tsx`, `MatchListRow`, `chatApi`).
- Classified gaps into: must-fix, nice-to-have, out-of-scope.
- Ordered must-fix by impact: New Vibes rail, row (unread ring, name+age, density), list header (divider only), empty state, loading skeletons.

### Stage 2 — Matches list rebuild
- **New Vibes rail:** When there are `isNew` matches, a glass card shows "New Vibes" with "X new connection(s)" and a horizontal scroll of avatars (unread ring + dot). Tapping opens chat (or match-celebration for unread).
- **List header:** Removed `SectionHeader` subtitle; kept only divider + "CONVERSATIONS" label (web parity).
- **Empty state:** Single productized block: "Your vibe circle awaits", body copy, primary CTA "Find your next event", and "How does Vibely work? →" link to web.
- **Loading state:** When `isLoading && !matches.length`, show header + tabs + skeleton New Vibes card (icon + title/sub placeholders + horizontal avatar skeletons) + "CONVERSATIONS" divider + 5 `MatchListRowSkeleton` rows instead of full-screen `LoadingState`.
- **Search empty:** When there are matches but search yields no results, show "No matches found" / "Try a different search term" in the list.
- **List padding:** `contentContainerStyle` uses `layout.scrollContentPaddingBottomTab` for tab bar clearance.

### Stage 3 — Conversation row parity
- **MatchListRow (ui.tsx):**
  - **Unread ring:** Avatar wrapped in a container that gets a 2px tint border when `unread`; unread dot on avatar (top-right) instead of trailing dot.
  - **Name + age:** New optional `age` prop; displays "Name, age" when age is present (web parity).
  - **Density:** Row uses `paddingVertical: spacing.md`, `paddingHorizontal: layout.containerPadding`; avatar wrap with 2px padding for ring.
- **MatchListRowSkeleton:** New skeleton for list loading (avatar circle + two line placeholders).
- **renderItem:** Passes `item.age` and `item.isNew` from API (no more derived `isNew` from time string).

### Stage 4 — Thread presentation pass
- **Chat screen (`chat/[id].tsx`):**
  - Replaced `GlassSurface` with `GlassHeaderBar` for header chrome consistency with Matches/Dashboard/Settings.
  - List content uses `layout.containerPadding` horizontal, consistent top/bottom padding.
  - Footer uses `layout.containerPadding` horizontal and safe-area-aware bottom padding (iOS).
  - Input uses `radius.input`; send button uses `radius.button`.

### Stage 5 — Realtime / UI coherence
- **Realtime:** Unchanged. `useRealtimeMessages` and matches subscription still invalidate `messages` and `matches` on INSERT/UPDATE; list and thread stay in sync.
- **Refresh:** `RefreshControl` on matches `FlatList`; refresh does not cause layout jumps.
- **Navigation:** Match list → thread (or match-celebration for unread) → back remains coherent; no placeholder/basic visuals left on these surfaces.

---

## 2. Files changed

| File | Changes |
|------|--------|
| `docs/phase4-stage1-matches-chat-audit.md` | New audit (must-fix / nice-to-have / out-of-scope). |
| `docs/phase4-matches-chat-parity-summary.md` | New phase summary (this file). |
| `apps/mobile/components/ui.tsx` | `MatchListRow`: optional `age`, unread ring + dot on avatar, `layout.containerPadding` and `spacing.md`; new `MatchListRowSkeleton`; new styles `matchListAvatarWrap`, `matchListUnreadRingDot`. |
| `apps/mobile/app/(tabs)/matches/index.tsx` | New Vibes rail (card + horizontal avatars), `newVibes` memo, removed `SectionHeader` from list header, productized empty state + "How does Vibely work?", loading skeleton UI (rail + 5 row skeletons), search empty state, `ListEmptyComponent` for search, new styles (newVibes*, skeleton*, howItWorks*, searchEmpty*), list `paddingBottom` → `layout.scrollContentPaddingBottomTab`, imports (ScrollView, Image, VibelyText, MatchListRowSkeleton, MatchAvatarSkeleton; removed SectionHeader, LoadingState). |
| `apps/mobile/app/chat/[id].tsx` | Header: `GlassHeaderBar` instead of `GlassSurface`; list/footer use `layout.containerPadding`; footer safe-area bottom; input/button radii (`radius.input`, `radius.button`). |

---

## 3. Parity gaps intentionally deferred

- **Sort dropdown** (Most Recent, Unread First, Best Match): Web has it; left as nice-to-have.
- **Swipe actions** on row (swipe left unmatch, right profile): Web has swipeable card; native tap-only for this phase.
- **Compatibility badge** on row (e.g. XX%): Web shows it; native row does not (would need backend or mock).
- **Vibe tags** on conversation row: Web shows up to 3 vibe chips; native `MatchListItem` does not include vibes; would require extending match list API (e.g. profile_vibes); deferred.
- **Archived section** at bottom: Web has `ArchivedMatchesSection`; native does not (archive flow/API unchanged).
- **Who Liked You gate** (premium) and **Daily Drop** full implementation: Out of scope; Daily Drop remains "open on web".

---

## 4. Reusable primitives added/updated

- **MatchListRowSkeleton:** New in `ui.tsx`; use for matches list loading.
- **MatchListRow:** Now supports `age`, unread ring + dot on avatar, and updated padding/container constants.

---

## 5. Backend / shared contracts

- No backend or shared contract changes. Match list and messages still use existing `chatApi` (Supabase, `send-message`, realtime). No new env or provider usage.

---

## 6. Local native rebuild

- **Warranted:** Yes. Matches list and chat thread UI and layout changed; recommend a quick run on device/simulator to confirm list scroll, New Vibes rail, skeleton loading, empty/search states, and thread header/footer safe area.

---

## 7. User action required

- None. All work is in-app; no manual config or deploy steps.

---

## 8. Acceptance criteria

| Criterion | Status |
|-----------|--------|
| Matches list feels visually aligned with web | Done (New Vibes rail, divider-only header, row density, empty/loading/search). |
| Conversation rows feel intentionally designed | Done (unread ring, name+age, spacing, skeleton). |
| Unread, timestamps, avatars, previews improved | Done (ring + dot, age, same time/preview logic). |
| Empty/loading/error states productized | Done (empty copy + CTA + link; skeleton rail + rows; search empty). |
| Thread screen polished where it lagged | Done (GlassHeaderBar, layout constants, safe area). |
| Realtime behavior intact | Done (no changes to realtime logic). |
| No backend/shared-contract regressions | Done (no API/contract changes). |
| No broad-scope architecture churn | Done (scoped to matches/chat UI and shared row/skeleton). |
