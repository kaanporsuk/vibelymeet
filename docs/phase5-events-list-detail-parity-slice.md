# Phase 5 — Events list & event detail parity slice

First visible parity slice for Phase 5: **events list** and **event detail** screens. Backend behavior (event fetching, registration) unchanged.

---

## Files changed

| File | Changes |
|------|--------|
| `apps/mobile/app/(tabs)/events/index.tsx` | Featured card: `surfaceSubtle` + `glassBorder` + `shadows.card`; gradient overlay 78% height; rail cards same treatment; content `paddingTop` → `layout.mainContentPaddingTop`; search wrap `borderRadius` → `radius.xl`; `EventsSkeleton` uses `theme.muted` for Skeleton backgrounds; filtered empty state `showIllustration={false}`. |
| `apps/mobile/app/(tabs)/events/[id].tsx` | Hero: cover height responsive (`min(280, 40% viewport)`); gradient overlay 50% of cover height, stronger opacity; info block: `Card variant="glass"`; date/time rows with Calendar and Clock icons; event info row (duration · going) in bordered block; optional venue line when `location_name` present; Who's Going → `Card variant="glass"`; section spacing `spacing.xl`; Register CTA full width (`ctaPrimary`). |
| `docs/phase5-events-list-detail-parity-slice.md` | This summary. |

---

## Visual decisions

- **Events list**
  - **Featured card:** Glass-style surface (`surfaceSubtle`, `glassBorder`) and `shadows.card` for depth; gradient overlay 78% height for legible text over image.
  - **Rail cards:** Same card treatment as featured for consistency.
  - **Content rhythm:** Main content uses `layout.mainContentPaddingTop`; filter bar search uses `radius.xl`.
  - **Loading:** Skeleton uses `theme.muted` so loading state matches theme.
  - **Empty (filtered):** No illustration for “No events found” to keep it minimal.

- **Event detail**
  - **Hero/cover:** Height scales with viewport (capped at 280px, max 40% height) for a 50vh-like feel; bottom gradient 50% of cover height, `rgba(0,0,0,0.5)`.
  - **Info card:** `Card variant="glass"`; title; date and time on separate rows with Calendar/Clock icons; duration and “X going” in a subtle bordered “event info” block.
  - **Venue:** When `location_name` is present, show a single line with location icon (web-style location context).
  - **Who’s Going:** Rendered as `Card variant="glass"` for consistency with info card.
  - **Sections:** `spacing.xl` between info card, Who’s Going, You’re in, and CTAs.
  - **Registration CTA:** Primary “Register” uses full width (`alignSelf: 'stretch'`) for clearer hierarchy.

---

## Remaining gaps (events list / event detail)

- **Events list:** Web “Featured Event” vs “Live Now” vs “Near You” vs “Global” rails; native currently has “Live Now” + “Upcoming/Discover” only — no scope-based rails or “Near You” copy. Location prompt is shell-only (no geolocation).
- **Event detail:** Web hero has back + share in top bar; native has back + title only (no share). Web has “Category” + “X% Match” badges in hero; native has no match badge. Recurring series and “Next in series” link not implemented. Phone verification nudge for events not ported.
- **General:** Parallax on hero, confetti on register, and motion on cards are not replicated (by design for this slice).

---

## Next slice

**Lobby and discovery** is the next slice: deck cards, swipe actions, Ready Gate, and any Daily Drop / discovery-specific UI. Events list and event detail are in good shape for a device pass; lobby/discovery can follow as the next Phase 5 slice.
