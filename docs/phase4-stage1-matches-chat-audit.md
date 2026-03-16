# Phase 4 — Stage 1: Matches and chat list parity audit

**Web source:** `src/pages/Matches.tsx`, `src/pages/Chat.tsx`, `SwipeableMatchCard`, `NewVibesRail`, `MatchAvatar`, `EmptyMatchesState`, `ChatHeader`, `MessageBubble`, `MatchCardSkeleton`, `NewVibesRailSkeleton`.  
**Native source:** `apps/mobile/app/(tabs)/matches/index.tsx`, `apps/mobile/app/chat/[id].tsx`, `lib/chatApi.ts`, `MatchListRow` in `ui.tsx`.

---

## 1. Matches list structure

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| **Header** | Sticky glass-card, MessageCircle + "Matches" title (text-2xl font-display), count pill "X matches" | GlassHeaderBar, icon + "Matches", count pill | Aligned; native uses typography.titleLG. |
| **Tabs** | TabsList grid-cols-2: Chat (MessageCircle), Daily Drop (Droplet); optional badge on Drops | Two pills: Chat, Daily Drop (water-outline) | Aligned. |
| **Search** | Only when conversations tab and matches.length > 0; Input + SlidersHorizontal sort dropdown | Same: only when conversations and matches exist | Aligned. |
| **New Vibes rail** | When isPremium and newVibes.length: glass-card "New Vibes", "X new connections", horizontal MatchAvatar row (gradient ring, NEW badge, unread). Else WhoLikedYouGate if newVibes. | **Missing:** no "New Vibes" rail; new matches go straight into list | **Must-fix: add New Vibes rail** when there are isNew matches. |
| **Section divider** | "Conversations" with two flex-1 h-px lines (no extra section title) | Divider + **SectionHeader** "Conversations" + subtitle "Keep talking..." | **Must-fix: remove SectionHeader from list header;** use divider + label only (web has no subtitle there). |
| **List container** | divide-y divide-border/50 | FlatList, MatchListRow with borderBottom | Native has border on row; web divide-y. Align row border/divider. |

---

## 2. Conversation row (list item)

| Area | Web (SwipeableMatchCard) | Native (MatchListRow) | Gap |
|------|---------------------------|------------------------|-----|
| **Avatar** | 14×14 (w-14 h-14), gradient ring when unread, PhotoVerifiedMark, PhoneVerifiedBadge, unread dot top-right | 52px Avatar, unread dot right side | **Must-fix: unread ring** on avatar (tint/gradient border); optional photo verified badge. |
| **Name/age** | "Name, age" font-semibold | name only (no age) | **Must-fix: show age** (name, age) if available. |
| **Compatibility** | Badge: neon-cyan/20, "XX%" with Sparkles | Missing | Nice-to-have (web uses mock %); can defer or add if backend provides. |
| **Time** | text-xs text-muted-foreground, right-aligned | time right-aligned, fontSize 11 | Aligned. |
| **Last message** | text-sm truncate, font-medium when unread | preview, fontWeight 600 when unread | Aligned. |
| **Vibe tags** | Up to 3 chips + "+N" (primary/15, border primary/20) | Missing | **Must-fix: show vibes** if available from API (native chatApi may not fetch vibes for list; check). |
| **Row density** | p-4, gap-4 | matchListRow padding (from styles) | **Must-fix: align padding** to spacing.lg (16) for rhythm. |
| **Swipe actions** | Swipe left unmatch, right view profile (Framer Motion) | Tap only | Nice-to-have: swipe; not required for parity feel. |

---

## 3. Empty and loading states

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| **Empty** | EmptyMatchesState: gradient illustration, "Your vibe circle awaits", feature pills (Video, Heart, Sparkles), "Find Your Next Event" button, "How does Vibely work?" link | Hero card + EmptyState (title, message, CTA) | **Must-fix: productized empty** — headline, short copy, feature pills or single CTA, optional How it works link. |
| **Loading (no data)** | NewVibesRailSkeleton + 5× MatchCardSkeleton in p-4 space-y-4 | Full-screen LoadingState text | **Must-fix: skeleton list** (rail skeleton + 5 row skeletons) instead of spinner. |
| **Loading (refetch)** | PullToRefresh | RefreshControl on FlatList | Aligned. |
| **Error** | (not shown in snippet) | ErrorState with Retry | OK. |

---

## 4. Top bar / header behavior

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| **Matches header** | Sticky, glass-card, border-b | GlassHeaderBar | Aligned. |
| **Chat thread header** | ChatHeader: back, avatar, name, online/last seen, dropdown (video, mute, unmatch, etc.) | GlassSurface: back, title (name), profile icon | **Polish:** optional avatar in header, last seen; no dropdown required in Phase 4. |

---

## 5. Thread screen (chat)

| Area | Web | Native | Gap |
|------|-----|--------|-----|
| **Bubbles** | MessageBubble, grouped by sender, avatar on first-of-group (them) | bubbleMe / bubbleThem, avatar on first them message | Aligned. |
| **Input** | Textarea + Send + voice/video/arcade affordances | TextInput + voice + video + send | Aligned. |
| **Composer** | Rounded, border | footer with borderTop, input rounded | **Polish:** use radius.input, consistent padding. |
| **Empty thread** | "No messages yet. Say hi!" | Same | Aligned. |

---

## 6. Must-fix parity gaps (ordered by impact)

1. **New Vibes rail** — When there are matches with `isNew`, show a horizontal rail (glass-style card) at top: "New Vibes", "X new connections", scrollable avatars with ring/badge; tap opens chat or moves to list.
2. **Conversation row** — Unread: avatar ring (border tint/accent); show "Name, age" when age available; add vibe tags if API provides them (else defer); row padding spacing.lg.
3. **List header** — Remove SectionHeader from list; use divider + "Conversations" label only (match web).
4. **Empty state** — Headline "Your vibe circle awaits", body copy, single primary CTA "Find your next event", optional "How Vibely works" link; remove redundant hero card or fold into one empty block.
5. **Loading state** — When loading and no matches yet, show skeleton rail + 5 skeleton rows instead of full-screen LoadingState.

---

## 7. Nice-to-have polish

- Sort dropdown (Most Recent, Unread First, Best Match).
- Swipeable row (swipe left unmatch, right profile).
- Compatibility badge on row (if backend provides or mock).
- Thread header: avatar, last seen text.

---

## 8. Out-of-scope (do not expand in Phase 4)

- Daily Drop full implementation (keep "open on web").
- Who Liked You gate (premium) unless already in native.
- Video call, arcade games, date proposals inside thread.
- Archive/block/unmatch dialogs (keep existing behavior; no new modals).
- Backend/contract changes for matches (e.g. vibes on list item — only if already available from existing API).

---

## 9. Native data availability

- **chatApi.ts** `MatchListItem`: id, name, age, image, lastMessage, time, unread, isNew, matchId. No `vibes` or `photoVerified` on list item. **Vibes:** web useMatches fetches profiles + profile_vibes; native fetch does not. Adding vibes to native list would require extending the match list query (profiles + profile_vibes). **Decision:** implement row with name+age, unread ring, padding, divider; add vibes in row only if we extend API in this phase (optional, small extension).
