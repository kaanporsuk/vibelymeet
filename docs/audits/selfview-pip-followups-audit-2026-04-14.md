# SelfViewPIP follow-ups — audit / fix plan (no implementation)

**Scope:** Two issues from `docs/audits/selfview-pip-drag-snap-investigation-2026-04-14.md`:  
(1) `ActiveCallOverlay` PIP render guard, (2) `SelfViewPIP` vs `PostDateSurvey` in `VideoDate.tsx`.

---

## Issue 1 — `ActiveCallOverlay` and `containerRef.current &&`

### Evidence

```145:152:src/components/chat/ActiveCallOverlay.tsx
      {/* Local PIP */}
      {containerRef.current && (
        <SelfViewPIP
          stream={localStream || null}
          isVideoOff={isVideoOff}
          isMuted={isMuted}
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
        />
      )}
```

Parent assigns `ref={containerRef}` on the same branch at lines 124–129:

```124:129:src/components/chat/ActiveCallOverlay.tsx
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
```

### Classification: **real bug (high confidence)**

- On the **first React render** of the active-video branch, `containerRef.current` is **`null`** (refs are attached after the host `motion.div` is committed).
- **`containerRef.current && …` is evaluated during render**; it is **false**, so **`SelfViewPIP` is not mounted**.
- Assigning the ref to the DOM **does not trigger a re-render** by itself. Unless a **parent prop/state update** causes `ActiveCallOverlay` to render again, **`SelfViewPIP` can remain unmounted indefinitely** — user sees **no local PIP** in match-call video despite being in-call.

This is the standard “ref in render condition” footgun; it is **not benign**.

### Minimal fix approach

1. **Remove** the `{containerRef.current && ( … )}` guard and **always render** `SelfViewPIP` when in the active-video branch (same props).
2. If Framer `dragConstraints` misbehaves for one frame with an empty ref, either:
   - pass **`dragConstraints={containerRef}`** as today (Framer generally accepts `RefObject` and resolves on layout), **or**
   - add a tiny **`useLayoutEffect`** in `SelfViewPIP` or parent to flip a `constraintsReady` state only if proven necessary after QA (prefer **not** adding state unless a bug appears).

**Blast radius:** `src/components/chat/ActiveCallOverlay.tsx` only (~8 lines). No API change to `SelfViewPIP`.

### Priority vs snap polish

**Prioritize this first.** It can **block local preview entirely** in chat video overlay; snap is cosmetic.

---

## Issue 2 — `SelfViewPIP` during `PostDateSurvey` / `showFeedback` in `VideoDate.tsx`

### Evidence

`SelfViewPIP` is gated only on `isConnected`:

```948:957:src/pages/VideoDate.tsx
      {/* ─── Self-View PIP ─── */}
      {isConnected && (
        <SelfViewPIP
          stream={localStream}
          isVideoOff={isVideoOff}
          isMuted={isMuted}
          containerRef={remoteContainerRef}
          blurAmount={blurAmount}
        />
      )}
```

`PostDateSurvey` is driven by `showFeedback`:

```1028:1036:src/pages/VideoDate.tsx
      {/* ─── Post-Date Survey ─── */}
      <PostDateSurvey
        isOpen={showFeedback}
        sessionId={id || ""}
        partnerId={partnerId}
        partnerName={partner.name}
        partnerImage={partnerPhotoUrl || ""}
        eventId={eventId}
      />
```

`PostDateSurvey` open UI uses **`fixed inset-0 z-50`**:

```301:307:src/components/video-date/PostDateSurvey.tsx
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-6"
```

`SelfViewPIP` wrapper uses **`z-40`**:

```39:39:src/components/video-date/SelfViewPIP.tsx
      className="absolute top-16 right-3 w-[100px] h-[140px] rounded-2xl overflow-hidden z-40 cursor-grab active:cursor-grabbing"
```

### Classification: **potential / polish — not a reliable “invisible bug”**

- **Stacking:** Survey shell is **`z-50`**, PIP is **`z-40`** in the same page root (`fixed inset-0` column). In normal stacking, the **survey should paint above** the PIP; user should **not** interact with PIP while survey is focused.
- **Residual risks:**
  - **Visual bleed:** Semi-transparent backdrop might still show PIP movement underneath (cosmetic).
  - **Resources:** Local `<video>` keeps running / decoding while survey is open — **wasted CPU/battery**, not usually a functional bug.
  - **Edge cases:** Unusual portals, `z-index` overrides, or future survey layout changes could change stacking — **gating removes the class of bugs**.

### Minimal fix approach

Gate PIP when feedback UI owns the experience:

```tsx
{isConnected && !showFeedback && (
  <SelfViewPIP ... />
)}
```

Aligns with existing patterns in the same file (`!showFeedback` on ice breaker, vibe button, connection overlay, etc.).

**Blast radius:** `VideoDate.tsx` one condition + comment; no `SelfViewPIP` API change.

### Priority vs snap polish

**After Issue 1**, and **before or with** snap: cheap clarity/perf improvement; **lower urgency** than ActiveCallOverlay if z-order always works in QA.

**Relative priority:** Issue 1 **>** Issue 2 **>** optional corner snap.

---

## Summary table

| Issue | Verdict | Minimal fix | Blast radius | Priority |
|-------|---------|-------------|--------------|----------|
| 1. `containerRef.current &&` in `ActiveCallOverlay` | **Real** — PIP may never mount | Remove guard; always render `SelfViewPIP` | One file, small | **High** |
| 2. PIP during `PostDateSurvey` | **Potential** — mostly z-order OK; gating is cleaner | `isConnected && !showFeedback` | One file, one line | **Medium** |
| Snap polish (prior investigation) | N/A | Deferred | `SelfViewPIP` only | **Low** |

---

## Recommended order when implementing

1. Fix **ActiveCallOverlay** PIP guard.  
2. Gate **VideoDate** PIP on `!showFeedback` (optional QA on celebration step if `showFeedback` toggles before step visibility — confirm `showFeedback` means “survey owns screen” for all steps including `MatchSuccessModal` inside `PostDateSurvey`).  
3. Snap / drag polish only after the above.
