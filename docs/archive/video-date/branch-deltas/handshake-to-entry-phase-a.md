# handshake → entry, Phase A (client-facing vocabulary only)

Date: 2026-06-10
Branch: `codex/handshake-to-entry-phase-a`
Audit: `docs/branch-deltas/handshake-to-entry-audit.md`

## Scope

First execution pass of the handshake → entry vocabulary migration: **client-facing TS identifiers only**, while the DB/wire stays on "handshake". No migration, no Edge Function change, no generated-types change. Done after queue/drain removal (#1282) and Ready Gate single prepare-owner (#1283).

Target vocabulary: **`entry`** (matches the plan and the existing client `EntryPhaseTimer` / `videoDateEntryTiming` from #1279).

## What changed

Renamed a safe **allowlist** of ~40 internal camelCase/PascalCase identifiers (312 substitutions across 14 files) via word-boundary exact match, plus two file renames:

- `shared/matching/videoDateHandshakePersistence.ts` → `videoDateEntryPersistence.ts` (+ exports: `VideoDateHandshakeTruth` → `VideoDateEntryTruth`, `completeHandshakeExpectation` → `completeEntryExpectation`, `recordHandshakeDecision` → `recordEntryDecision`, `VIDEO_DATE_HANDSHAKE_TRUTH_SELECT` → `VIDEO_DATE_ENTRY_TRUTH_SELECT` (value unchanged), etc.).
- `…videoDateHandshakePersistence.test.ts` → `videoDateEntryPersistence.test.ts`.
- Client locals: `clearHandshakeGraceState` → `clearEntryGraceState`, `completeHandshake` → `completeEntry`, `completeHandshakeFromServerDeadline` → `completeEntryFromServerDeadline`, `handleHandshakeDecision` → `handleEntryDecision`, `showHandshakeChrome` → `showEntryChrome`, `resolveVideoDateHandshakeUiState` → `resolveVideoDateEntryUiState`, `videoSessionRowIndicatesHandshakeOrDate` → `videoSessionRowIndicatesEntryOrDate`, the `set*` UI setters, etc.

The same renames were applied to the affected test files so source-pinned contract assertions stay aligned.

## Deliberately PRESERVED (wire/data/contract — would break if renamed)

- **Wire action strings** sent to `video_date_transition`: `'complete_handshake'`, `'continue_handshake'`, `'enter_handshake'`.
- **DB column field accesses**: `handshake_started_at`, `handshake_grace_expires_at` (85 refs in non-test source) and the `phase`/`state` value `'handshake'`.
- **`ReadyGateQueueStatus.InHandshake` = `"in_handshake"`** (DB `event_registrations.queue_status` value) — member and value untouched.
- **Feature flag key** `video_date.outbox_v2.continue_handshake` and its hook variable `continueHandshakeV2` (DB-backed; renaming the lookup without a DB change would silently disable the flag).
- **Analytics payload keys** `completeHandshakeTriggerReason`, `completeHandshakeTriggeredAfterPersistence`, and snake_case telemetry keys (PostHog dashboard continuity).
- **`HeartHandshake`** — the lucide-react icon (external symbol).
- All generated types (`src/integrations/supabase/types.ts`), migrations, Edge Functions, validation SQL.

## Verification

- `npm run typecheck` — pass (the strong net: every renamed identifier resolves; no missed usages).
- `npm run lint` — pass.
- `npm run test:video-date:red-flags`, `npm run test:video-date-v4` — pass.
- `shared/matching/videoDateEntryPersistence.test.ts` — 18/18.
- Full `shared/matching` + `shared/observability` sweep — the 13 still-red files are confirmed **pre-existing** failures on clean `main` (same baseline as #1283); **zero new failures** from this change.
- Sanity: landmines confirmed untouched (`HeartHandshake`=4, `InHandshake`=3, `"in_handshake"` value intact, `complete_handshake`=8, payload keys=3, `handshake_started_at`=85).

## Known trade-off (intentional)

This is client-internal vocabulary only. The DB/wire still says "handshake", so a few seams read `entry… = row.handshake_started_at` (same pattern #1279 already established). These identifiers will be revisited when the DB phases land so client and wire vocabulary converge. No behavior changed.

## Not done (subsequent phases — separate sign-off + real e2e window)

DB additive compat (`entry_started_at`/`entry_grace_expires_at`, `entry`-named RPC wrappers, `complete_entry`/`continue_entry` actions), Edge Function migration, `ALTER TYPE video_date_state RENAME VALUE 'handshake' → 'entry'`, feature-flag key rename, generated-types regen. See the audit map for the phased plan.

## Proof boundary

Client vocabulary refactor, not Video Date acceptance. No two-user end-to-end run was possible here. Behavior is unchanged (identifier-only rename); acceptance still requires a real run: Ready Gate → date entry, pass/vibe decision period, auto-promote/finalize, post-date survey persists `date_feedback`.
