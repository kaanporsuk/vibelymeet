# Review Comments 1306-1313 Follow-ups

Date: 2026-06-13

Scope: thread-aware GitHub review-comment follow-up for merged PRs #1306 through
#1313. No Copilot-authored review threads exist in this repository; all threads
are Codex (`chatgpt-codex-connector[bot]`). Each thread was re-triaged against
current `main` HEAD. No migration in this batch — all changes are client
routing, a contract-test re-pin, and docs.

## Addressed Threads

- **#1310 P2 — date-route survey scoping (`current_room_id`).** The native
  (`apps/mobile/app/date/[id].tsx`) and web (`src/pages/VideoDate.tsx`)
  date-route guards both passed `current_room_id: null` into
  `decideVideoDateSurfaceRoute`. `videoDateRegistrationIndicatesPendingSurvey`
  treats a falsy room id as unscoped, so an `in_survey` registration belonging to
  a *different* room in the same event would force this `/date/:sessionId` into
  the survey path (stale/native deep-link risk). Both guards now `select`
  `current_room_id` and pass the real value (`reg?.current_room_id ?? null`).
  After `end`, `current_room_id` is cleared to null, so the normal pending-survey
  recovery is unchanged; only the cross-session case is now correctly scoped.
  Fixed on both platforms for parity.

- **#1311 P1 — stale claim-surface survey-eligibility pin.**
  `videoDateEvidenceSingleBodyContracts.test.ts` pinned the claim-surface survey
  gate from the immutable PR-3 migration `20260611190852`, which called the bare
  v1 `video_date_session_is_post_date_survey_eligible(`. PR #1311 dropped v1 and
  consolidated `claim_video_date_surface` onto the v2 (confirmed-encounter)
  helper in `20260612200500`. The suite kept passing (it read the old migration,
  not the live fixture) but pinned a superseded contract. The survey-gate
  assertion now reads the consolidated body from `20260612200500` and asserts
  `video_date_session_is_post_date_survey_eligible_v2(` (and the bare v1 is
  absent). Other claim semantics stay pinned to the PR-3 body.

- **#1313 P3 — dead branch-delta links (`docs/native-final-blocker-matrix.md`).**
  The Video Date acceptance row's command-center link was moved to
  `docs/archive/video-date/...` but its four `fix-video-date-*` branch-delta
  links still pointed at `docs/branch-deltas/`. Those files now live under
  `docs/archive/video-date/branch-deltas/`; all four links are repointed so the
  launch-blocker evidence trail resolves.

## Resolved Before This Branch (no action needed)

- **#1307 P2 (remote-frame audit):** `scripts/audit-video-date-remote-frame.mjs`
  was updated to scan the decomposed web source family (`src/pages/videoDate/*`,
  `src/lib/daily/*`, `src/hooks/videoCall/*`); `node ...audit-video-date-remote-frame.mjs`
  passes.
- **#1309 P1 (TS18047 narrowing on `sharedDailyCallEntry`):** fixed in-PR by the
  author (`bf4e84c`) — both `parkSharedCallForWarmHandoff` and the cleanup path
  copy the singleton entry to a local `const entry` after the guard. Native
  `tsc --noEmit` is clean.
- **#1312 P2 (deleted `videoDateClientStuckObservability` module):** fixed in-PR
  by the author (`9e5f351`) — `videoDateWarmupStabilityContracts.test.ts` no
  longer reads the removed module.

## Intentional Boundaries

- **#1309 P2 (dropped-v2 RPC fixtures still loaded by the truth-pin suite):**
  resolved by deliberate design, not by removal. The later curation made the
  dropped v2 heads (`video_session_forfeit_v2`, `video_session_date_timeout_v2`,
  `video_session_handshake_auto_promote_v2`) **frozen dropped-chain history
  pins**: the live functions are gone, but their last `pg_get_functiondef()`
  dumps are retained so the truth-pin suite asserts the dropped contract and any
  silent revival is detectable. `scripts/check-contract-fixture-drift.mjs`'s
  `DROPPED_HISTORY` set tracks them as expected-absent against live. Codex's
  literal suggestion (delete the fixtures/tests) was therefore superseded.
  Hygiene note: the prior PR #1322 follow-up had listed two of these as live
  client-facing heads in `supabase/contract-fixtures/2026-06/README.md`; that
  README now distinguishes the 12 live heads from the 4 dropped-chain history
  pins.
- `shared/observability/videoDateClientStuckObservability` test
  (`videoDateWarmupStabilityContracts.test.ts`) has 3 pre-existing failures on
  `origin/main` unrelated to these threads and is wired into no npm runner
  (documented by the author in #1312); out of scope here.
- This is review-comment hardening. The survey-scoping change is the only live
  behavior change (a strict correctness/scoping fix on the client date-route
  guard); no backend migration, signature, or grant change. Acceptance remains a
  fresh two-user run through persisted `date_feedback`.
