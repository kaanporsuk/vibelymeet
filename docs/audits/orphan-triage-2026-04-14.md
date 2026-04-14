# Orphan component triage — 2026-04-14

**Source:** `docs/audits/surface-inventory-candidates-2026-04-14.md` (56 components).

## Buckets

### A. Safe delete now (applied)

Superseded **legacy video-date checkpoint / unused shell** subgraph — **not** imported from `VideoDate.tsx` (which uses `PostDateSurvey` + current controls). Confirmed no other `src` imports via repo-wide search.

**Deleted (15 files):**

- `src/components/video-date/survey/MutualMatchCelebration.tsx`
- `src/components/video-date/PostDateModal.tsx`
- `src/components/video-date/PostDateCheckpoint.tsx`
- `src/components/video-date/AudioVisualizer.tsx`
- `src/components/video-date/SelfCheckMirror.tsx`
- `src/components/video-date/CompactTimer.tsx`
- `src/components/video-date/DraggablePIP.tsx`
- `src/components/video-date/PartnerTeaseCard.tsx`
- `src/components/video-date/TipsCarousel.tsx`
- `src/components/video-date/VibeProgressRing.tsx`
- `src/components/video-date/VideoControls.tsx`
- `src/components/video-date/checkpoint/FinalVerdict.tsx`
- `src/components/video-date/checkpoint/HolographicLock.tsx`
- `src/components/video-date/checkpoint/IntegrityAudit.tsx`
- `src/components/video-date/checkpoint/VibeMeter.tsx`

**Rationale:** Pre-`PostDateSurvey` experiment UI; mutual celebration on web is handled via `MatchSuccessModal` / survey flow elsewhere — see live `PostDateSurvey.tsx` imports.

### B. Archive / legacy — keep for rollback

- **`src/components/safety/*` orphans** (`SafetyHub`, `PauseAccountFlow`, `EmergencyResources`, etc.) — product may re-wire; **do not delete**.
- **`src/components/wizard/*`** — onboarding evolution; **keep**.

### C. Likely future-use / do not touch

- **`src/components/ui/*` unused shadcn primitives** — standard kit; removing breaks `npx shadcn add` expectations and future composition.
- **Marketing / deck components** (`EventCard`, `DashboardGreeting`, `NavLink`, …) — **keep** until explicit product cut.

## Remaining orphan count (after deletes)

Re-run: `npm run audit:surfaces` to refresh `docs/audits/surface-inventory-candidates-2026-04-14.md` (~41 components left, 0 pages/hooks).
