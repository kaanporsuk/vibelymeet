# Phase 2 — Web-to-native dashboard parity matrix

**Web source:** `src/pages/Dashboard.tsx`, `src/components/DashboardGreeting.tsx`, `src/components/BottomNav.tsx`, `src/index.css` (.glass-card).  
**Native source:** `apps/mobile/app/(tabs)/index.tsx`, `DashboardGreeting.tsx`, `(tabs)/_layout.tsx`, `components/ui.tsx` (GlassHeaderBar, Card, etc.).

---

## 1. Parity matrix

| Block / section | Exists web? | Exists native? | Visual parity | Behavior parity | Priority |
|-----------------|-------------|----------------|---------------|-----------------|----------|
| **Top header** | Yes — sticky glass-card border-b, px-4 py-4, max-w-lg | Yes — GlassHeaderBar (glass + layout padding) | Partial — same intent; web border white/10 | Yes — greeting + actions + profile | Critical |
| **Greeting / title hierarchy** | Yes — "Good morning," + firstName; optional "Complete profile" chip | Yes — DashboardGreeting same copy and chip | Yes | Yes | Critical |
| **Section rhythm and spacing** | Yes — main py-6 space-y-8, sections space-y-3 | Yes — main paddingTop 24, gap 32; section gap ~14 | Yes (after Phase 2 Stage 1 pass) | Yes | Critical |
| **Banners / hero / status** | ActiveCallBanner, DeletionRecoveryBanner, PhoneVerificationNudge, Imminent date reminders | None | No | No | Medium (deferred) |
| **Live event hero** | Yes — glass-card neon-glow-pink, LIVE badge (pulse), gradient CTA | Yes — same CTA; card solid; no pulse | Partial — no glass, no pulse on badge | Yes | Medium |
| **Next Event (not live)** | Yes — glass-card, h-36 cover, gradient overlay, countdown 56×56 rounded-xl bg-secondary, gradient-text | Yes — solid card, 192px cover, 56×56 countdown, secondary bg | Partial — card solid; cover 192 vs 144 | Yes | Critical |
| **No events block** | Yes — glass-card p-6, "No upcoming events", ghost Browse | Yes — Card + EmptyState | Partial — Card vs glass; copy aligned | Yes | Low |
| **Premium / other cities nudge** | Yes — glass-card, gradient border, "X events in Y cities" | No | No | No | Low (deferred) |
| **Your Matches** | Yes — title + "X new" pill, See all, horizontal scroll, gradient ring for new | Yes — title + pill + See all + ring for new | Yes (after Stage 1) | Yes | Critical |
| **Upcoming Events rail** | Yes — min-w-[260px] glass-card, cover + title, date•time, attendees | Yes — 248px cards, same content | Partial — width 248 vs 260; solid vs glass | Yes | Medium |
| **Cards, corners, shadows, borders** | glass-card: bg-card/60 backdrop-blur border white/10 rounded-2xl | Card default solid surface; variant=glass (surfaceSubtle + border) | Partial — no blur; glass variant exists | — | Critical |
| **Empty / loading / error** | EventCardSkeleton, MatchAvatarSkeleton; empty states inline | Skeleton, EmptyState, ErrorState | Yes | Yes | Critical |
| **Scroll rhythm and safe-area** | PullToRefresh, pb-24 for tab bar, max-w-lg mx-auto | ScrollView + RefreshControl, scrollContentPaddingBottomTab, maxWidth contentWidth | Yes | Yes | Critical |
| **Tab / shell relationship** | BottomNav fixed bottom, glass-card border-t pb-safe, h-16 max-w-lg | Tab bar from layout constants, glassSurface, safe area bottom | Yes | Yes | Critical |

---

## 2. Top 5 visible issues (placeholder/basic feel)

1. **Cards look flat/solid** — Web uses glass-card (translucent, blur, white/10 border). Native Next Event and Discover use solid surface. Glass variant exists but is not used on dashboard cards.
2. **Next Event cover too tall** — Web h-36 (144px); native 192px. Proportions feel off.
3. **Discover cards narrow and solid** — 248px vs web 260px; solid vs glass.
4. **Header/content breathing room** — Scroll content starts immediately under header; web main has py-6 (24px). Native has paddingTop 24 on main but scrollContent paddingTop only 24; can add a bit more air.
5. **Tab bar visual weight** — Native tab bar has strong violet shadow; web BottomNav is glass with subtle border. Slight reduction in shadow keeps focus on content.

---

## 3. Implementation plan (next edits)

- **Stage 1 (audit complete):** Parity matrix and top 5 documented; fix top 1–2: (1) Use Card variant="glass" for Next Event wrapper and for Discover cards; (2) Next Event cover height 144px; Discover card width 260px.
- **Stage 2 (shell):** (a) Add layout constant for content-below-header padding if needed; (b) Slightly soften tab bar shadow; (c) Ensure section spacing and gutters are reused (Events, Matches, Settings inherit).

---

## 4. Code changes applied

| File | Change |
|------|--------|
| `apps/mobile/app/(tabs)/index.tsx` | Next Event: backgroundColor theme.surfaceSubtle (glass-like), eventCardMedia height 144. Discover: width 260, backgroundColor theme.surfaceSubtle; skeleton width 260. scrollContent/main use layout.mainContentPaddingTop. |
| `apps/mobile/app/(tabs)/_layout.tsx` | Tab bar: shadowOpacity 0.2→0.12, shadowRadius 10→8, elevation 8→6. |
| `apps/mobile/constants/theme.ts` | layout.mainContentPaddingTop = spacing.xl (24). |

---

## 5. Summary of what improved

- **Next Event:** Glass-like surface (surfaceSubtle), 144px cover height (web parity).
- **Discover:** Glass-like surface, 260px width (web parity).
- **Shell:** Tab bar shadow softened; content-top padding from layout.mainContentPaddingTop; Events, Matches, Settings already use GlassHeaderBar and layout constants (inherit same shell).
