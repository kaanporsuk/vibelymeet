# SelfViewPIP × DraggablePIP — focused investigation & plan (no implementation)

**Date:** 2026-04-14  
**Scope:** Whether to merge **interaction ideas** from deleted `DraggablePIP.tsx` into live **`SelfViewPIP.tsx`**.  
**Evidence:** Current repo files + `git show d60626766:src/components/video-date/DraggablePIP.tsx` (last version before deletion).

---

## Executive finding

**Live `SelfViewPIP` already implements Framer Motion `drag` with `dragConstraints={containerRef}`, `dragMomentum={false}`, and a drag handle affordance.** The deleted `DraggablePIP` did **not** add “drag” as a new capability — it added **attempted horizontal corner-snap on `onDragEnd`** using **`window` dimensions and fragile math** that does **not** match the Video Date layout (nested `flex-1` region, not full viewport).

**Conclusion:** The only **worthwhile** port is **snap-to-corners (or snap-to-nearest-edge) *inside the constraint element’s box***, reimplemented cleanly — **not** a copy-paste of old `handleDragEnd`.

---

## 1. Live self-view path

### Where `SelfViewPIP` is used

| Location | Role |
|----------|------|
| `src/pages/VideoDate.tsx` | Primary video date UI: passes `localStream`, `remoteContainerRef` (`flex-1 relative` wrapper around remote `<video>` + overlays), `blurAmount` for progressive blur. |
| `src/components/chat/ActiveCallOverlay.tsx` | Match-call overlay: passes `localStream`, `containerRef` on the **full-screen** `fixed inset-0` video shell. **Guard:** renders `<SelfViewPIP>` only when `containerRef.current` is truthy (first-frame gap risk). |

### Sole owner of web self-view in these flows?

- **Video Date / handshake / in-call date:** Yes — **only** `SelfViewPIP` renders the web self-preview for Daily `MediaStream` in `VideoDate.tsx`.
- **Chat video call overlay:** Yes — same component for local preview in `ActiveCallOverlay` (video branch).

No other `src/components/**` file defines an alternate self-view PIP for these paths.

### Parents / stacking (Video Date)

Relevant structure in `VideoDate.tsx` (simplified):

- Root: `fixed inset-0 … flex flex-col overflow-hidden`
- **Top HUD** (`absolute top-0 … z-30`): partner pill, phase chips, `HandshakeTimer`
- **`remoteContainerRef`**: `div.flex-1.relative` — remote video + `ConnectionOverlay` + `ReconnectionOverlay` + bottom gradient
- **`SelfViewPIP`**: sibling **after** that div, still inside root; `absolute top-16 right-3 z-40`
- **Ice breaker** `bottom-28` `z-20`; **VibeCheckButton** `z-25`; **controls** `bottom-0 … z-30`; **PartnerProfileSheet** / **PostDateSurvey** as separate layers

**PIP z-index 40 > controls z-30** — user can drag PIP over the control dock (by design today); drag already allows that within constraints.

---

## 2. Old vs live comparison

### Deleted `DraggablePIP.tsx` (summary)

- **Inputs:** `isVideoOff`, `isMicActive`, **`imageSrc`** (static `<img>`, not `MediaStream`) — **not drop-in equivalent** to production self-view.
- **Drag:** `drag` + `onDragEnd` → `handleDragEnd` computes snap using **`window.innerWidth` / `window.innerHeight`**, hard-coded `pipWidth`/`pipHeight` (112×160 vs live 100×140), and **state** `{ x, y }` + `animate={{ x: position.x, y: position.y }}`.
- **Snap logic:** Compares `currentX` to `windowWidth/2 - pipWidth/2` then sets `snapX` to expressions mixing window width and margins — **easy to misalign** with actual constraint rect; **not** using `containerRef.getBoundingClientRect()`.
- **Unused:** `useDragControls` imported, `constraintsRef` on a full-screen `pointer-events-none` wrapper — partially dead pattern.
- **Visual extras:** Neon violet border when “mic active” — different from live `SelfViewPIP` (muted badge + cyan “speaking” inset ring).

### Live `SelfViewPIP.tsx` (summary)

- **Inputs:** `MediaStream | null`, `isVideoOff`, `isMuted`, **`containerRef`**, `blurAmount`.
- **Drag:** `drag` + **`dragConstraints={containerRef}`** + `dragElastic={0.05}` + `dragMomentum={false}` + `whileDrag={{ scale: 1.05 }}`.
- **No `onDragEnd`:** Release position stays where the user leaves it (within constraints) — **no snap**.
- **Video:** `<video>` + mirror + blur; **not** static image.

### Map: what existed vs what exists

| Aspect | DraggablePIP (old) | SelfViewPIP (live) |
|--------|--------------------|---------------------|
| Drag | Yes | Yes |
| Constraint region | Implicit/window-ish | **`dragConstraints` = passed ref** |
| Corner snap on release | Attempted (bug-prone) | **None** |
| Stream vs image | Image | **Stream** (correct) |
| Mic / speaking UX | Violet outer ring | **Muted badge + speaking inset animation** |

### What can be ported **cleanly**

- **Only** the **product intent**: “after drag end, snap to nearest corner (or edge) **inside the constraint ref’s bounding box**,” with margins consistent with safe areas.
- Implementation should use **`getBoundingClientRect()`** on `containerRef.current` and the dragged node — **not** `window` — and snap **x/y** in the coordinate space Framer expects (or use `animate` to settle position).

### What should **not** be ported

- Window-based snap math from old `handleDragEnd`.
- Static `imageSrc` preview path.
- Duplicating old neon-violet styling (live has its own system).
- `useDragControls` unless we need “drag only from handle” (optional UX tightening; not required for snap).

### Conflicts / overlays

| Layer | z-index (Video Date) | Conflict with drag/snap |
|-------|----------------------|-------------------------|
| Top HUD | 30 | PIP 40 can overlap header if dragged high — **acceptable**; snap could prefer **bottom** corners near controls if product wants PIP out of HUD. |
| Controls dock | 30 | PIP can sit on top — **already true**; snap could bias to **top** corners to reduce covering mute/leave. |
| Ice breaker / Vibe row | 20–25 | Below PIP; user might drag PIP over pills — rare. |
| Reconnection overlay | (check component) | Full-area messaging; drag might feel odd while partner away — **low priority** edge case. |
| Post-date `PostDateSurvey` | typically full-screen | Survey open: `SelfViewPIP` still mounts if `isConnected` — verify z-order vs survey modal (possible **pre-existing** polish issue, out of snap scope). |

---

## 3. Risk assessment

### Bottom controls / timers / partner sheet

- **Controls:** Drag already allows overlap; **snap** could **reduce** overlap if default snaps to **top-left / top-right** of constraint rect.
- **Timers:** In top HUD; same as HUD overlap.
- **Partner sheet:** Modal/sheet above call — PIP interaction usually disabled or obscured; **no special snap conflict** beyond “don’t animate while sheet open” (optional `disabled={showProfileSheet}` on drag — future).

### Reconnect / post-date

- **ReconnectOverlay:** Covers remote area; PIP remains draggable in constraint — **OK**.
- **Post-date transition:** Survey takeover — if PIP remains visible under semi-transparent overlay, that’s **separate** from snap; consider hiding PIP when `showFeedback` if not already (audit: `SelfViewPIP` is **not** gated on `!showFeedback` in `VideoDate.tsx`).

### Mobile / native parity

- **Web:** `SelfViewPIP` + Framer.
- **Native video date** (`apps/mobile/app/date/[id].tsx`): Local preview is **`VideoView`** (Daily) in **fixed `StyleSheet` position** — **not draggable**.  
- **Implication:** Corner snap on web is **web-first polish** unless product specs **gesture + snap** on native (react-native-gesture-handler + Reanimated + layout metrics) — **non-trivial**; should **not** be bundled silently with a web-only change.

---

## 4. Deliverables (precise)

### Files involved (implementation touch-set when/if built)

| File | Role |
|------|------|
| `src/components/video-date/SelfViewPIP.tsx` | **Only** file that should gain snap logic (minimal blast radius). |
| `src/pages/VideoDate.tsx` | Possibly pass optional props (`snapEnabled`, `defaultCorner`) — only if API needed; else keep API unchanged. |
| `src/components/chat/ActiveCallOverlay.tsx` | Same component; **fix `containerRef.current &&` render guard** separately (first-frame PIP) — orthogonal bug. |
| `apps/mobile/...` | **No change** for a web-only snap milestone. |

### Behavior to port (conceptual)

- **Snap to nearest corner** (or horizontal snap only, matching old intent) **within `containerRef`’s client rect**, with configurable inset (e.g. 8–16px).
- Optional: **animate** snap with short spring (Framer `animate` on `x`/`y`).

### Behavior not to port

- Old `handleDragEnd` formulas.
- Window-relative coordinates.
- Image-based preview.

### Minimal blast radius approach

1. Add **`onDragEnd`** to the existing `motion.div` in `SelfViewPIP`.
2. Read **`containerRef.current.getBoundingClientRect()`** and the dragged element’s rect (or use Framer’s `point` / offset APIs if preferred).
3. Compute target **x, y** for top-left of PIP for each corner; pick **min distance**; **clamp** inside constraint rect.
4. Apply via **`animate={{ x, y }}`** or controlled state + `transition` — verify compatibility with **`dragConstraints`** (may need `dragElastic={0}` on snap frame or use **`layoutId`** / explicit position mode — **spike required** in implementation phase).
5. **Feature flag or prop** `enableCornerSnap` default `true`/`false` for safe rollout — optional.

### Decision: implement now vs defer vs cross-platform spec

| Option | Verdict |
|--------|--------|
| **Implement now (web only)** | **Reasonable** if you accept **native parity lag** and treat snap as **desktop/tablet polish** (mouse/touch drag already works). |
| **Defer** | **Reasonable** because live PIP **already drags**; snap is **incremental UX**, not fixing a broken path. Old DraggablePIP snap was **not** production-validated. |
| **Spec web + native together** | Required **before** investing in native drag — **large**; use a **short product spec** (corners, safe areas, behavior when keyboard opens). |

**Recommendation:** **Defer by default** *or* **small web-only spike** behind a prop — **unless** UX research says users lose PIP behind controls (snap would then **prioritize top corners**). Do **not** block on native; document **parity gap** if web ships snap first.

---

## 5. uncomfortable precision

- **“Recover DraggablePIP” is misleading** — live code **already** merged **drag**; the deleted file mainly adds a **flawed snap recipe**. The real task is **new snap math**, not restoration of that file.
- **ActiveCallOverlay**’s `containerRef.current &&` guard is a **real bug risk** for PIP visibility — fix **independently** of snap.
- **Native** will stay **fixed PIP** until explicitly designed — **acceptable** if labeled web-first.

---

## 6. Suggested next step (when you choose to implement)

1. Spike snap in `SelfViewPIP` only, desktop + mobile web touch.  
2. Add unit or Playwright check optional (hard for drag).  
3. Document parity gap in `docs/native-sprint0-architecture-lock.md` or video-date UX note.  
4. Native: separate ticket if product wants draggable local preview.
