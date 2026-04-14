# SelfViewPIP follow-ups — closure (2026-04-14)

Frontend-only closure for two low-blast-radius issues identified during the deleted-file reverse audit and SelfViewPIP follow-up investigation. No snap-to-corner work; no backend or state-semantics changes.

---

## Issue 1 — `ActiveCallOverlay` local PIP mount bug

**Problem:** `SelfViewPIP` was wrapped in `{containerRef.current && ( … )}`. During the first render, `containerRef.current` is `null`, so the PIP did not mount. Assigning the ref to the DOM does not re-render the component, so the PIP could remain absent for the whole call.

**Fix:** Remove the render guard and always render `SelfViewPIP` in the active video branch with the same props. Framer Motion `dragConstraints` accepts the ref object and applies constraints once the container node exists.

**File:** `src/components/chat/ActiveCallOverlay.tsx`

---

## Issue 2 — `VideoDate` PIP during post-date feedback / survey

**Problem:** `SelfViewPIP` was gated only on `isConnected`, so it could stay visible during `PostDateSurvey` / feedback takeover (`showFeedback`), conflicting with stacking and product intent.

**Fix:** Gate with `isConnected && !showFeedback` so the self-view PIP is not rendered during that takeover.

**File:** `src/pages/VideoDate.tsx`

---

## Files changed (this closure)

| File | Change |
|------|--------|
| `src/components/chat/ActiveCallOverlay.tsx` | Remove `containerRef.current &&` guard around `SelfViewPIP` |
| `src/pages/VideoDate.tsx` | `SelfViewPIP` condition: `isConnected` → `isConnected && !showFeedback` |
| `docs/branch-deltas/selfview-pip-followups-closure-2026-04-14.md` | This closure note |
| `docs/active-doc-map.md` | Evidence table entry (discoverability beside video-date audit chain) |
| `docs/audits/selfview-pip-followups-audit-2026-04-14.md` | Dated audit / fix plan (provenance) |
| `docs/audits/selfview-pip-drag-snap-investigation-2026-04-14.md` | Snap vs DraggablePIP investigation (snap not implemented here) |

---

## Validations run

- `npm run typecheck` (repo script: core strict + mobile + app)
- ESLint (targeted): `src/components/chat/ActiveCallOverlay.tsx`, `src/pages/VideoDate.tsx`

---

## Deploy / infra

**No Supabase cloud deploy required** — web-only React changes; no migrations, Edge Functions, or RLS changes.

---

## Related audit notes (same initiative)

| File | Contents |
|------|----------|
| `docs/audits/selfview-pip-followups-audit-2026-04-14.md` | Pre-fix audit / fix plan for the two issues above |
| `docs/audits/selfview-pip-drag-snap-investigation-2026-04-14.md` | DraggablePIP vs `SelfViewPIP`; snap polish explicitly out of scope for this closure |
