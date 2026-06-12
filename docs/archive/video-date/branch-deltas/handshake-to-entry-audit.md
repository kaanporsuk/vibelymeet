# Audit Map — "handshake" → "entry" Vocabulary Migration

Date: 2026-06-10
Status: **SUPERSEDED BY PHASE D/E ACTIVE CONTRACT PASS (2026-06-11).** This file remains the pre-edit inventory. Current outcome is recorded below and in `docs/video-date-success-command-center.md`.

Goal: replace legacy "handshake" terminology/state with clearer "entry" terminology across the Video Date stack. This document lists every **active** handshake surface before any edit, per the implementation plan's gate ("Do not edit until every active handshake surface is listed").

## 2026-06-11 Phase D/E outcome

The active web/native/shared contract now uses `entry` vocabulary:

- current clients call `complete_entry` / `continue_entry`;
- current clients call `video_session_continue_entry_v2` / `video_session_entry_auto_promote_v2`;
- current flag keys are `video_date.outbox_v2.continue_entry` and `video_date.outbox_v2.entry_auto_promote`;
- current readers use `entry_started_at` / `entry_grace_expires_at`;
- snapshot, token-refresh, push-preload, public API, recovery, route-decision, timeline, and active-session boundaries normalize legacy server `handshake` phase to canonical `entry`;
- migration `20260611114354_video_date_entry_contract_phase_de.sql` seeds entry-named flags and replaces `get_video_date_snapshot_core(uuid)` so the public snapshot emits `phase = 'entry'`.

Physical enum/column/function-name purge was deferred inside this same safety pass. Linked preflight found one live `video_sessions` row still in `state='handshake'` / `phase='handshake'` and broad live catalog dependencies, so `public.video_date_state = 'handshake'`, the underlying `handshake_*` storage, and old server implementation names remain a contained compatibility layer until a later DB-only purge can be done safely. Active `handshake` references should now be limited to that compatibility layer, persisted `in_handshake` registration status handling, old applied migrations, historical docs, and tests that assert old migrations or compatibility normalization.

## 0. Scale (reference density)

| Area | refs | files | Notes |
|---|---|---|---|
| `src/` (web) | 333 | 18 | active client |
| `apps/mobile/` (native) | 333 | 15 | active client |
| `shared/` | 586 | 75 | active shared helpers/contracts |
| `supabase/functions/` | 24 | 6 | active Edge Functions |
| `supabase/migrations/` | 1639 | 143 | **historical — forward-only, do not rewrite** |
| `supabase/validation/` | 27 | 6 | live validation SQL |
| `docs/` | 541 | 81 | docs (update last) |
| tests | — | 58 | contract/regression tests |

## 1. DB schema (LIVE) — highest blast radius

### 1a. Enum value (atomic, global)
- `public.video_date_state` ENUM = `(ready_gate, 'handshake', date, post_date, ended)` — defined in `20260311133000_video_date_state_machine.sql`, **never altered since**. The `'handshake'` value is read/written by dozens of functions as `state = 'handshake'::video_date_state` and `state::text = 'handshake'`.
  - Rename target: enum value `entry`.
  - Mechanism options: (A) `ALTER TYPE public.video_date_state RENAME VALUE 'handshake' TO 'entry'` — atomic, rewrites the label in the catalog; every `'handshake'::video_date_state` literal in **live** functions must be updated in the same migration or they break. (B) additive `ADD VALUE 'entry'` + dual-accept + backfill + later retire — safer across a release boundary but leaves both labels live.
  - **This is the single riskiest item.** Recommend a dedicated phase.

### 1b. Columns on `public.video_sessions`
- `handshake_started_at timestamptz` — added `20260301001911`. The canonical entry/date start timestamp (already surfaced to clients as "entry" timing, see §6).
- `handshake_grace_expires_at timestamptz` — added `20260430090000_video_date_handshake_hardening.sql`.
- `phase text NOT NULL DEFAULT 'handshake'` — added `20260301001911`; value `'handshake'` is a live phase string parallel to the enum.
  - Rename targets: `entry_started_at`, `entry_grace_expires_at`, phase value `entry` (column `phase` keeps its name).
  - Mechanism: prefer **additive generated/mirror columns + compat** over a hard `RENAME COLUMN` (a hard rename breaks every function/view/RLS/Edge selector at once). Option: add `entry_started_at`/`entry_grace_expires_at`, dual-write in transition functions, migrate readers, then drop old in a later release.

### 1c. Functions named `*handshake*` (LIVE — latest definitions)
| Function | Latest-definition migration |
|---|---|
| `video_session_handshake_auto_promote_v2(...)` | `20260609035833_video_date_definitive_active_media_ownership.sql` |
| `finalize_video_date_handshake_deadline(...)` | `20260605115657_video_date_early_confirmed_encounter_promotion.sql` |
| `video_session_continue_handshake_v2(...)` | `20260603090000_video_date_remote_seen_encounter_guard.sql` |
| `expire_due_joined_video_date_handshakes_bounded(...)` | `20260502143000_video_date_handshake_deadline_finalizer.sql` (cron-invoked) |
  - Rename targets: `video_session_entry_auto_promote_v2`, `finalize_video_date_entry_deadline`, `video_session_continue_entry_v2`, `expire_due_joined_video_date_entries_bounded`.
  - Compat: keep old function names as thin delegating wrappers for one release boundary (callers include Edge Functions, cron, and clients).

### 1d. `video_date_transition` action strings (NOT standalone functions)
- `complete_handshake` (59 live occurrences) and `continue_handshake` (4) are **action strings** handled inside `video_date_transition(...)` (latest wrapper: `20260609202707_remove_standalone_enter_handshake.sql`). `enter_handshake` (24) is already **deprecated** — it returns `ENTER_HANDSHAKE_REMOVED`.
  - Rename targets: action strings `complete_entry`, `continue_entry`.
  - Compat: accept both old and new action strings for one release boundary (clients send these).

### 1e. Functions that READ/WRITE handshake without "handshake" in their name
Many core state-machine RPCs reference `handshake_started_at`, `state='handshake'`, `phase='handshake'` (e.g. mark-ready, snapshot, daily-gate, presence, remote-seen, cleanup, terminalization). These must be updated in lockstep with any enum/column rename. **To be enumerated precisely per phase** via `pg_get_functiondef` against the live catalog before each migration (the migration file history is not a reliable live-state source — inspect the catalog).

### 1f. Views (LIVE, observability/operator) referencing handshake
- `20260521161000_video_date_phase0_observability_flags.sql` (`handshake_sessions`, `handshake_started_at`, `phase='handshake'`)
- `20260521150000_video_date_v4_foundation.sql`
- `20260522002000_video_date_phase2_audit_hardening.sql`
- `20260522011000_video_date_phase6_queue_fairness.sql`
- `20260522020000` / `20260522021000` / `20260522023000` (phase8 cert/release/review)
  - These are operator telemetry; rename column aliases in lockstep or keep `handshake_*` output keys until operator dashboards are updated (decision needed).

## 2. Generated types
- `src/integrations/supabase/types.ts` — `video_date_state` union includes `'handshake'`; `handshake_started_at`/`handshake_grace_expires_at` on `video_sessions` Row/Insert/Update; function arg/return types. Regenerate via `npm run regen:supabase-types` after each DB phase (never hand-edit).

## 3. Edge Functions (LIVE)
- `supabase/functions/video-date-token-refresh/index.ts:524` — **token refresh eligibility**: `if (phase !== "handshake" && phase !== "date")`.
- `supabase/functions/video-date-snapshot/index.ts:565` — **snapshot eligibility**: same gate.
- `supabase/functions/daily-room/index.ts` — reads/writes `handshake_started_at`, `phase === 'handshake'` across snapshot/prepare/confirm payloads (lines ~103, 622, 840, 1031–1032, 1609, 1772, 2090, 2218, 2299, 2419).
- `supabase/functions/send-notification/index.ts:645–700` — `state === 'handshake'`, `phase === 'handshake'`, `handshake_started_at`.
- `supabase/functions/admin-video-date-ops/index.ts:1277` — `stuck_handshake_count` (operator metric key).
  - Edge deploys are required for these (cloud deploy in scope when these change).

## 4. Web (`src/`) — 18 active files
`domain/enums.ts`, `domain/transitions.ts`, `pages/VideoDate.tsx` (/date phase logic), `hooks/useVideoCall.ts`, `hooks/useReconnection.ts`, `hooks/useActiveSession.ts`, `hooks/useEventStatus.ts`, `components/session/SessionRouteHydration.tsx`, `lib/videoDateSessionTruth.ts`, `components/lobby/ReadyGateOverlay.tsx`, `components/lobby/LobbyProfileCard.tsx`, `components/video-date/EntryPhaseTimer.tsx` (already entry-aliased), `components/video-date/survey/HighlightsScreen.tsx`, `pages/Dashboard.tsx`, `pages/EventLobby.tsx`, `pages/Schedule.tsx`, `pages/HowItWorks.tsx`, `integrations/supabase/types.ts`.

## 5. Native (`apps/mobile/`) — 15 active files
`app/date/[id].tsx` (/date phase logic; `completeHandshake`, `continueHandshakeV2`, `completeHandshakeFromServerDeadline`), `lib/videoDateApi.ts`, `lib/activeSessionRoutes.ts`, `lib/useActiveSession.ts`, `lib/eventStatus.ts`, `lib/videoDateEntryStartable.ts`, `app/event/[eventId]/lobby.tsx`, `app/ready/[id].tsx`, `components/NativeSessionRouteHydration.tsx`, `components/NotificationDeepLinkHandler.tsx`, `components/video-date/EntryPhaseTimer.tsx` (entry-aliased), `components/video-date/ConnectionOverlay.tsx`, `components/video-date/VibeCheckButton.tsx`, `components/events/ActiveCallBanner.tsx`.

## 6. Shared (`shared/`) — 75 files; key modules
`videoDateHandshakePersistence.ts` (→ rename file/symbols), `videoDateTransitionCommands.ts` (`VideoDatePhase3TransitionAction = "mark_ready" | "forfeit" | "continue_handshake"`), `videoDateCountdown.ts`, `videoDateRouteDecision.ts`, `videoDateSnapshot.ts`, `videoDateStartSnapshot.ts`, `videoDateTimeline.ts`, `videoDatePublicApi.ts`, `videoDatePhase4.ts`, `activeSession.ts`, `videoDateRecoveryAdvisor.ts`.
- **Already on "entry" vocabulary (PR #1279 neutral entry timer aliases):** `shared/matching/videoDateEntryTiming.ts`, `shared/matching/videoDateCountdown.ts`, `src`+native `components/video-date/EntryPhaseTimer.tsx`. The client countdown/timer UI already presents "entry"; the underlying source is still `handshake_started_at`.

## 7. Feature flags
- `video_date.outbox_v2.continue_handshake` (`shared/featureFlags/videoDateV4Flags.ts`; consumed in native `app/date/[id].tsx`). Renaming a flag key requires a flag-table migration + dual-read for one boundary.

## 8. Tests (58 files) & validation SQL (6 files)
58 test files assert handshake markers (state-machine, snapshot, daily-gate, transition, persistence, etc.). `supabase/validation/*.sql` (6) assert handshake catalog/behavior. All must be updated in lockstep with each phase (many are source/migration-string-pinned contract tests).

---

## Recommended phased plan (for sign-off — not yet executed)

Vocabulary: **`entry`** (matches the plan and the existing client `EntryPhaseTimer`/`videoDateEntryTiming`). `entry_started_at`, `entry_grace_expires_at`, `complete_entry`, `continue_entry`, `entry_auto_promote`.

- **Phase A — client-facing vocabulary only (lowest risk).** Finish the entry-aliasing already started in #1279: rename client/shared symbols, copy, file names, log keys, and feature-flag-independent UI from "handshake" → "entry", while still reading the existing `handshake_*` columns/enum. No DB change. Verifiable by typecheck/lint/contract-test updates.
- **Phase B — DB additive compat layer (forward migration).** Add `entry_started_at`/`entry_grace_expires_at` mirror columns + dual-write in transition functions; add `entry`-named wrapper functions delegating to the existing handshake ones; accept `complete_entry`/`continue_entry` action strings alongside the old. Regenerate types. No reader is forced to switch yet.
- **Phase C — migrate readers** (Edge Functions, RPC internals, views, clients) to the new columns/functions/actions. Deploy Edge Functions. Keep old surfaces as compat.
- **Phase D — enum value + phase string.** `ALTER TYPE … RENAME VALUE 'handshake' → 'entry'` (or additive+retire), update all live functions/views in the same migration; flip clients to `state==='entry'`.
- **Phase E — retire compat** (old columns/functions/action strings/flag) after one release boundary proves the new surfaces.

### Hard constraints / decisions needed before Phase B+
1. **Enum strategy**: atomic `RENAME VALUE` (one migration, must update all live functions simultaneously) vs additive `ADD VALUE 'entry'` + dual-state + later retire. (Atomic is cleaner but higher single-migration risk; additive is safer across boundaries.)
2. **Physical DB rename vs client-only**: rename the actual columns/enum, or keep DB-internal vocabulary as "handshake" and only standardize **client-facing** terminology (plan step 6 emphasizes "client-facing"). This decision sets the true blast radius.
3. **Observability/operator keys**: rename `handshake_sessions`/`stuck_handshake_count`/view aliases (breaks dashboards) or preserve output keys.

### Verification bar (per phase)
`npm run typecheck`, `npm run lint`, Video Date state-machine tests, `supabase db lint --linked`, `supabase db push --linked --dry-run`, and — the real acceptance bar that **cannot** be met in this environment — a two-user run: Ready Gate → date entry, pass/vibe decision period, auto-promote/finalize, post-date survey persists `date_feedback`.
