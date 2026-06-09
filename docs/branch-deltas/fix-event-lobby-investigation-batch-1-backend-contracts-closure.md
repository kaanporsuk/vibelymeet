# Event Lobby Investigation Batch 1 Backend Contracts Closure

Branch: `fix/event-lobby-investigation-batch-1-backend-contracts-closure`

Superseded 2026-06-09: the note below saying deprecated legacy queue/date RPCs remain callable is historical. `find_video_date_match(uuid,uuid)` and `join_matching_queue(uuid,uuid)` were later removed from the active linked schema by `20260609163130_remove_legacy_queue_session_rpcs.sql`, and `leave_matching_queue(uuid)` was later removed by `20260609165218_remove_leave_matching_queue.sql`.

## Investigation Source

- `docs/audits/event-lobby-investigation-batch-1-backend-contracts.md`

## Closure Mode

Mode C: docs/test-only closure.

The investigation verdict was PASS. It found no implementation defect in the Stream 0-2 Event Lobby audit lineage, active-event backend contract, swipe idempotency, notification dedupe, or web/native additive-outcome compatibility surfaces.

## Findings Addressed

- PASS: Audit lineage remains coherent; stale pre-hardening claims are marked as historical context.
- PASS: `get_event_lobby_active_state(uuid,timestamptz)` and compatibility wrappers remain present with service-role-only helper grants.
- PASS: Event Lobby backend surfaces reject inactive/non-live/ended events before candidate/session/swipe mutation paths.
- PASS: `handle_swipe` preserves natural-key idempotency, duplicate markers, active-session conflict protection, and explicit replay/conflict outcomes.
- PASS: `swipe-actions` suppresses duplicate/idempotent/replay/inactive/block/conflict notifications while preserving fresh notification paths.
- PASS: Web and native clients tolerate additive backend outcomes and continue to use `swipe-actions`.

## Findings Deferred

None from this investigation batch.

Runtime business-data smoke remains intentionally unperformed because it can create production business data or user-visible side effects and requires explicit approval. Deprecated legacy queue/date RPCs remain callable by design, but the audit verified they are no-session or cleanup-only compatibility surfaces rather than active bypass paths.

## Files Changed

- `docs/branch-deltas/fix-event-lobby-investigation-batch-1-backend-contracts-closure.md`
- `shared/matching/eventLobbyInvestigationBatch1Closure.test.ts`

## Exact Implementation

- Added a static closure test proving:
  - the investigation report records a PASS verdict and no implementation defect
  - this branch delta documents Mode C docs/test-only scope
  - audited Event Lobby batch artifacts remain present
  - active-event helper, service-role helper grant, swipe idempotency, duplicate suppression, and conflict markers remain visible in source artifacts
  - web and native clients continue to invoke `swipe-actions` rather than direct `handle_swipe`
  - no Supabase migration, validation SQL, Edge Function, env var, native module, or `expo-av` drift was introduced by the closure
- Added this branch delta to document closure scope, deploy posture, and runtime proof limits.

## Tests Added Or Updated

Added:

- `shared/matching/eventLobbyInvestigationBatch1Closure.test.ts`

Expected targeted validation:

- `npx tsx shared/matching/eventLobbyInvestigationBatch1Closure.test.ts`
- `npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts`
- `npx tsx shared/matching/eventLobbyActiveEventContract.test.ts`
- `npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`

Expected carry-forward validation:

- `npm run test:event-lobby-regression`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Rebuild Impact

None expected. This closure adds docs and static matching tests only.

## Route/Page Drift

- Added: none
- Removed: none
- Changed: none

## Edge Functions

- Edge Functions changed/deployed: not required
- Edge Function deploy requirement: not required

## Schema And Storage

- Supabase migration requirement: not required
- Validation SQL requirement: not required
- Storage changes: none

## Config And Environment

- Env vars added/changed: none
- Provider/dashboard changes required: none
- Supabase config changes: none

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Web/static deploy requirement: not required
- Native/EAS deploy requirement: not required

## Native Safety

- Native module changes: none
- `expo-av`: not used

## Production Smoke Limitations

- Production data-mutating smoke: not run
- Live concurrent swipe race smoke: not run
- Live notification-provider invocation: not run

These are intentionally excluded from this closure because they can create production business data or user-visible side effects without explicit approval.

## Remaining Manual Follow-Up

None required for this closure.

Optional future release QA may include controlled production-like Event Lobby smoke with explicit approval and non-customer test accounts.
