# Branch Delta: Event Lobby Investigation Batch 3 Closure

Branch: `fix/event-lobby-investigation-batch-3-payload-observability-tests-closure`
Date: 2026-05-01
Closure mode: Mode A - code fix

## Investigation Source

- Report path: `docs/audits/event-lobby-investigation-batch-3-payload-observability-tests.md`
- Investigation PR: `#669`
- Investigation verdict: PARTIAL

The source report was produced by the immediately preceding audit branch and was read from the investigation output/PR because it had not yet landed on `main` when this closure branch started.

## Findings Addressed

- `B3-001` FAIL: Legacy web Event Lobby analytics emitted raw target `profile_id` values in `lobby_profile_swiped` and `super_vibe_used` payloads.

## Findings Deferred

- `B3-002` WARN: Deployed `swipe-actions` source hash could not be directly proven from the available Supabase CLI output. This is a proof limitation, not a repo defect in this closure scope.

## Files Changed

- `src/pages/EventLobby.tsx`
- `shared/matching/eventLobbyInvestigationBatch3Closure.test.ts`
- `docs/branch-deltas/fix-event-lobby-investigation-batch-3-payload-observability-tests-closure.md`

## Exact Implementation

- Replaced raw `profile_id: targetId` legacy analytics fields with `target_present: true`.
- Preserved the legacy event names `lobby_profile_swiped` and `super_vibe_used` for dashboard continuity.
- Preserved `event_id`, `swipe_type`, swipe outcome handling, deck advancement, haptics, and super-vibe remaining-count behavior.
- Added a static closure test that fails if Event Lobby legacy swipe analytics include raw `profile_id`, `target_id`, `actor_id`, `user_id`, or `targetId` values.

No backend swipe logic changed.
No deck payload shape changed.
No notification behavior changed.
No Ready Gate, queue, media, or native runtime behavior changed.

## Tests Added/Updated

- Added `shared/matching/eventLobbyInvestigationBatch3Closure.test.ts`.

Targeted validation:

- `npx tsx shared/matching/eventLobbyInvestigationBatch3Closure.test.ts`
- `npx tsx shared/observability/eventLobbyObservability.test.ts`
- `npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts`
- `npm run test:event-lobby-regression`

Carry-forward validation:

- `npm run test:hardening-contracts`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `git diff --check`

## Rebuild Impact

Web rebuild impact only: a client analytics payload redaction in `EventLobby.tsx`.

No backend, Edge Function, database, storage, provider, or native rebuild impact is expected.

## Route / Page Drift

Route/page drift: none.

No routes were added, removed, or renamed.

## Edge Functions

Edge Functions changed/deployed: not required.

Edge Function deploy requirement: none.

## Schema / Storage

Schema/storage changes: none.

Supabase migration requirement: none.

No Supabase migration was added.

No validation SQL was added because no migration was added.

## Environment Variables

Env vars added/changed: none.

## Provider / Dashboard Changes

Provider/dashboard changes required: none.

The legacy analytics event names are preserved; only raw target identifiers were removed from payloads.

## Web / Static Deploy

Web/static deploy requirement: normal host deployment through the merged PR path only.

No manual web/static deployment step is required by this closure.

## Native

Native module changes: none.

`expo-av`: not used.

No native package or runtime files changed.

## Production Smoke Limitations

No production data-mutating smoke was run.

No real push, payment, email, SMS, media, Daily, or user-flow mutation was required.

## Remaining Manual Follow-Up

None required for `B3-001`.

Optional future proofing, outside this closure:

- Record comparable deployed Edge Function artifact hashes when Edge Functions change, so future audits can prove source parity without relying on deployment timestamps or version numbers.
