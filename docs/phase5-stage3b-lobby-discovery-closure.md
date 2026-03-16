# Phase 5 — Stage 3B: Lobby / discovery closure pass

Focused parity pass for the lobby/discovery deck and card experience. Swipe behavior and backend-owned outcomes unchanged.

---

## Exact files changed

| File | Changes |
|------|--------|
| `apps/mobile/app/event/[eventId]/lobby.tsx` | All implementation and style updates below. |
| `docs/phase5-stage3b-lobby-discovery-closure.md` | This document. |

---

## What changed visually (lobby/discovery card pass)

### Deck shell
- **Unchanged:** Header (back, event title, LIVE pill, countdown), body padding, deck container aspect ratio and max height. No structural change to the shell.

### Lobby profile card
- **Media:** When there is no photo, the card shows a centered person icon on `surfaceSubtle` instead of a blank rectangle (`cardImagePlaceholder` + `Ionicons name="person"`).
- **Gradient overlay:** Height 70% → 72%, opacity 0.65 → 0.78 (`rgba(0,0,0,0.78)`) so the bottom strip reads like web’s `from-black/80` and text legibility is stronger.
- **Card body:** `paddingTop` 56 → 52; vertical rhythm uses `spacing.md` (12) between name row, job/location row, shared-vibes chip, and bio to align with web `space-y-3`.
- **Name/age hierarchy:** Name 24 → 25px, fontWeight `'700'` → `'800'`; age color `rgba(255,255,255,0.8)` → `0.82`; meta and bio use `rgba(255,255,255,0.72)` / `0.78` and bio `lineHeight` 18 → 19 for clearer hierarchy.

### Overlays / badges
- **Super Vibe / “In a date”:** Layout and copy unchanged; they sit on the stronger gradient so contrast is improved.

### Stacking and depth
- **Front card:** Replaced generic `shadows.card` with a custom shadow: `shadowOffset` height 6, `shadowOpacity` 0.18, `shadowRadius` 14, `elevation` 8 so the top card reads as clearly elevated.
- **Back cards:** Third card scale 0.92 → 0.90, translateY 4 → 6, opacity 0.3 → 0.25. Second card scale 0.96 → 0.95, translateY 2 → 3, opacity 0.6 → 0.55. Stack depth is more noticeable and the front card reads as primary.

### Action row
- **Spacing:** `gap` `spacing.lg` → `spacing.xl` (24); added `marginTop: spacing.xl` (24) so the row is clearly separated from the deck (web `mt-5`).
- **Sizing:** Pass and Vibe circles 58 → 60px (borderRadius 30). Super Vibe circle 54px (borderRadius 27) via `actionCircleSuper` so it is slightly smaller and the primary actions are more prominent.

### Empty / no-candidate deck state
- **Container:** Wrapped in `Card variant="glass"` with `maxWidth: 320` and padding so the block feels like a card, not floating copy.
- **Copy:** Added subline: “Tap Refresh to check for new people.” below the main message.
- **Layout:** `emptyMessage` margin and padding tightened; `emptySubline` style added.

### Loading state
- **Deck skeleton:** Third skeleton line added in the bottom strip (200×12, matching a bio line) so the loading state better matches the real card body (name, meta, bio).

---

## What remains deferred

- **Vibe tag pills:** Web shows up to 3 vibe labels (emoji + label) from `profile_vibes`. Native deck RPC does not return per-profile vibe labels; only `shared_vibe_count` is used. Showing individual vibe pills would require an extra fetch or RPC change. Deferred.
- **Premium badge on card:** Web shows a Premium badge when the profile is premium. Native does not fetch or show it; would need per-profile premium check or RPC field. Deferred.
- **Super Vibe credit pill on button:** Web shows remaining super-vibe count on the Super Vibe button. Native does not fetch or display it. Deferred.
- **Swipe gestures and VIBE/PASS overlays:** Web uses drag-to-swipe with overlays; native remains tap-only with no drag overlays. Out of scope for this pass.

---

## Judgment

**Phase 5 is now closure-ready** for the lobby/discovery experience.

The deck and card now have:
- Clear card hierarchy (name/age, job/location, shared vibes, bio) and legible overlay.
- Stronger perceived depth (front shadow, back card scale/opacity).
- Consistent profile snippet spacing and typography.
- Media fallback (person icon when no photo).
- More prominent action row (spacing and Pass/Vibe vs Super Vibe sizing).
- A card-style empty state with a clear recovery line.
- A loading skeleton that better matches the card body.

Remaining gaps (vibe tags, premium badge, super-vibe count on button, swipe gestures) are either data/backend or product scope and do not block closing Phase 5 lobby/discovery.
