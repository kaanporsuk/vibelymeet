# Phase 5 — Events, discovery, and lobby parity — Summary

**Branch:** `feat/mobile-phase5-events-discovery-lobby-parity`

---

## 1. What changed

### Audit
- **Doc:** `docs/phase5-events-discovery-lobby-audit.md`
- Compared web Events, EventDetails, EventLobby, FeaturedEventCard, LobbyProfileCard, ReadyGateOverlay with native equivalents.
- Gaps classified; implementation order: event detail → events list → lobby → Ready Gate.

### Event detail (`apps/mobile/app/(tabs)/events/[id].tsx`)
- **Header:** Replaced `GlassSurface` with `GlassHeaderBar` for consistency with other screens.
- **Cover:** Added bottom gradient overlay (`coverGradient`: 100px height, `rgba(0,0,0,0.35)`) over the cover image for web-aligned hero treatment.
- **Tags:** When `event.tags` exists, render a row of up to 5 tag pills (tint background + border) below meta and above description.
- **Scroll:** `contentContainerStyle` uses `layout.scrollContentPaddingBottomTab` so content clears the tab bar.

### Events list (`apps/mobile/app/(tabs)/events/index.tsx`)
- **Scroll:** `scrollContent` uses `layout.scrollContentPaddingBottomTab` instead of fixed `paddingBottom: 24`.
- **Bottom spacer:** Removed the extra `bottomSpacer` View; padding is handled by `scrollContent` only.

### Lobby (`apps/mobile/app/event/[eventId]/lobby.tsx`)
- **Header:** Replaced `GlassSurface` with `GlassHeaderBar`.
- **Action order:** Buttons reordered to match web: **Pass** (X) → **Super Vibe** (star) → **Vibe** (heart). Previously was Pass → Vibe → Super Vibe.
- **Ready Gate partner avatar:** On match, lobby now sets `activeSessionPartnerImage` from the current profile (`avatar_url` or `photos[0]`) and passes it to `ReadyGateOverlay` as `partnerImageUri`.

### Ready Gate overlay (`apps/mobile/components/lobby/ReadyGateOverlay.tsx`)
- **Props:** Added optional `partnerImageUri?: string | null`.
- **UI:** When `partnerImageUri` is provided, the overlay shows the partner’s image in the circle instead of the generic person icon.

---

## 2. Files changed

| File | Change |
|------|--------|
| `docs/phase5-events-discovery-lobby-audit.md` | New audit (events list, event detail, lobby, Ready Gate). |
| `docs/phase5-events-discovery-lobby-summary.md` | New (this summary). |
| `apps/mobile/app/(tabs)/events/[id].tsx` | GlassHeaderBar, cover gradient, tags row, layout padding. |
| `apps/mobile/app/(tabs)/events/index.tsx` | `scrollContent` padding from layout constant; removed bottomSpacer; removed unused `Platform` import. |
| `apps/mobile/app/event/[eventId]/lobby.tsx` | GlassHeaderBar, action order (Pass, Super Vibe, Vibe), partner image state and `partnerImageUri` passed to ReadyGateOverlay. |
| `apps/mobile/components/lobby/ReadyGateOverlay.tsx` | `partnerImageUri` prop, avatar circle shows partner image when provided. |

---

## 3. What remains (deferred / out of scope)

- **Event detail:** Share button, location/scope line, recurring series indicator, guest list teaser/roster, pricing/capacity — left for a later pass or product decision.
- **Events list:** Location prompt behavior (still shell); “Happening Elsewhere” city cards (blurred) — unchanged.
- **Lobby:** Swipe gesture on card (web has SwipeableCard); Super Vibe badge on card; Premium/“In a date” badges on card — deferred.
- **Ready Gate:** Timer, snooze, shared vibes — web has them; native overlay remains minimal; backend flow unchanged.
- **Daily Drop:** In-app deck/shell remains “open on web”; no new Daily Drop UI in this phase.

---

## 4. Backend / contracts

- No backend or shared-contract changes. Event detail still uses `useEventDetails` (existing select). Lobby still uses `useEventDeck`, `swipe`, and existing Ready Gate → date navigation. No changes to `ready_gate_transition`, `video_date_transition`, `daily_drop_transition`, or other critical surfaces.

---

## 5. Android rebuild

- **Recommendation:** Run an Android (and ideally iOS) build after this phase. Changes are UI-only (event detail, events list, lobby, Ready Gate overlay). A rebuild is warranted to confirm:
  - Event detail: header, gradient, tags, and scroll padding.
  - Events list: scroll and tab bar clearance.
  - Lobby: header, button order, and Ready Gate with partner avatar.
- If you are batching parity work, you can do one more parity slice (e.g. event detail guest/pricing or lobby card badges) and then rebuild; otherwise rebuilding now is reasonable.

---

## 6. Acceptance

- Events list: scroll padding aligned with layout; no new features.
- Event detail: feels more branded (header, gradient, tags) and consistent with other screens.
- Lobby: header and action order match web; Ready Gate shows partner avatar when available.
- No backend or provider changes; no broad refactors.
