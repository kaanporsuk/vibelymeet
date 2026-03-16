# Phase 5 — Lobby / discovery card parity pass

Lobby and discovery deck parity: card structure, profile snippet, media, badges, empty/loading/error states, and action treatment. Swipe behavior and backend match handling unchanged.

---

## Files changed

| File | Changes |
|------|--------|
| `apps/mobile/app/event/[eventId]/lobby.tsx` | **LobbyProfileCard:** Replaced `Card` with custom `View`; full-bleed image + 70% height gradient overlay; Super Vibe badge (top-left) when `has_super_vibed`; "In a date" queue badge (top-right) when relevant; bottom strip: name + age row, job/location with Briefcase/Location icons, "X shared vibes" chip when `shared_vibe_count` > 0, bio (2 lines); `shadows.card` and `glassBorder` on front card. **Empty state:** Web copy ("You've seen everyone for now!", "More people are joining — we'll refresh automatically."), sparkles icon in bordered circle, "Refresh Now" button with refresh icon. **Loading:** Card skeleton (muted image area + bottom title/meta placeholders) instead of generic LoadingState. **Error:** Deck error state with "Couldn't load deck" and Retry. **Actions:** Pass = danger tint and border; Super Vibe = neon-yellow background/border; Vibe = primary fill; 58px circles, 2px borders. **Deck depth:** Front card uses `stackCardFront` with `shadows.card`; back cards unchanged. **Imports:** `layout`, `shadows`; removed `Card`, `EmptyState`, `VibelyButton`; added `Skeleton`. |
| `docs/phase5-lobby-discovery-parity-pass.md` | This report. |

---

## What now matches web more closely

- **Swipe card structure:** Full-bleed photo, bottom gradient overlay (~70%), rounded-2xl, border; front card has shadow for depth.
- **Profile snippet hierarchy:** Name (large, white) + age; then job and location with icons; then shared-vibes chip; then bio (2 lines). Matches web order and emphasis.
- **Media treatment:** Single primary image (avatar_url or first photo), cover resize, gradient so text stays readable.
- **Badges:** "Someone wants to meet you!" (Super Vibe) top-left; "In a date" top-right when `queue_status` indicates in-date.
- **Vibe tags / metadata:** "X shared vibes" chip when `shared_vibe_count` > 0 (no per-tag labels; deck RPC doesn’t return vibe tag list).
- **Overlays:** One gradient overlay; no drag-direction VIBE/PASS overlays (native uses buttons only).
- **CTA placement:** Pass (left), Super Vibe (center), Vibe (right); Pass = danger, Super = neon-yellow, Vibe = primary; sizing and borders aligned with web intent.
- **Deck depth / stacking:** Three-layer stack with scale/opacity; front card has shadow.
- **Empty deck:** Copy and structure aligned with web: headline, subcopy, Refresh Now with icon.
- **No-candidate / exhausted:** Same empty state as "no cards"; copy implies "seen everyone" and auto-refresh.
- **Loading:** Card-shaped skeleton (image block + bottom text placeholders) instead of generic spinner.
- **Retry:** Deck error shows ErrorState with Retry; refetch on button press.
- **Header / event context:** Existing GlassHeaderBar with back, event title, LIVE pill, and countdown unchanged; no logic changes.

---

## What still separates native from web in the lobby flow

- **Swipe gestures:** Web uses drag-to-swipe with VIBE/PASS overlays that appear on drag; native uses tap-only buttons. No gesture-based swipe or overlay-on-drag.
- **Vibe tag pills:** Web shows up to 3 vibe labels (emoji + label) from `profile_vibes`; native only shows "X shared vibes" from `shared_vibe_count` (RPC doesn’t return tag list). Adding tag labels would require extra fetch or RPC change.
- **Premium badge:** Web shows PremiumBadge on card when profile is premium; native does not (would need per-profile premium check or RPC field).
- **Card entrance / exit animation:** Web uses Framer Motion for card fly-off and stamp overlay; native advances index with no fly-off animation.
- **Super Vibe credit pill:** Web shows remaining super-vibe count on the Super Vibe button; native does not fetch or display credit count.
- **LIVE dot animation:** Web uses pulse on the green LIVE dot; native uses static dot.

---

## Ready Gate / Daily Drop next?

- **Ready Gate:** Already implemented (partner name, partner image, onReady/onClose). A **visible parity pass** for Ready Gate would be: compare web `ReadyGateOverlay` (copy, layout, primary CTA, close affordance) to native and align copy and hierarchy; no engine changes.
- **Daily Drop:** Separate surface (inbox-style “drops”). A **Daily Drop parity pass** would be: audit web Daily Drop UI and implement native list/detail and any reply surfaces to match. That is a separate slice from lobby deck and Ready Gate.

**Recommendation:** Treat **Ready Gate visible parity** as the next small slice (copy, spacing, CTA styling). Then **Daily Drop** as a separate feature parity slice if desired.
