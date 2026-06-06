# Video Date Ready Gate Decisive Mark-Ready

## Scope

This change targets production session `cac485cd-da3b-475b-aa4c-27b70cd914d6` for event `21497965-394a-45fe-8700-5d91bf927f65`.

The failure happened before Daily: participant 2 committed `ready_b`, participant 1's ready attempts returned SQLSTATE `57014` / `READY_GATE_TRANSITION_TIMEOUT`, no `both_ready` or Daily room metadata was created, and the session expired as `ready_gate_expired`.

## Changes

- Supabase migration `20260606092944_video_date_decisive_mark_ready_commit.sql` replaces public `video_session_mark_ready_v2(uuid,text,text)` with a direct hot path.
- Supabase migration `20260606100511_video_date_mark_ready_lint_cleanup.sql` preserves that behavior while removing an unused event-append variable found by linked DB lint after the first apply.
- The hot path begins/reuses the idempotent command before locking the session row.
- It writes `ready_participant_*_at`, derives `ready_a` / `ready_b` / `both_ready`, and extends `ready_gate_expires_at` to at least `now() + 45 seconds` before auxiliary work.
- On `both_ready`, it writes deterministic `daily_room_name` / `daily_room_url` before observability, event append, or Daily outbox enqueue.
- Replay behavior remains compatible with deployed clients: committed replay returns current DB truth, retryable rejected replay reopens the same command, and stale `processing` commands older than six seconds can be reclaimed.
- Existing `ready_gate_transition('mark_ready')` continues to bridge to this public RPC, so web, mobile web, native/mobile, and older clients share the same backend behavior.
- Web `src/hooks/useReadyGate.ts` and native/mobile `apps/mobile/lib/readyGateApi.ts` retry bounded mark-ready RPC errors with the same deterministic idempotency key, matching the existing retryable-payload recovery.
- Contract `shared/matching/readyGateDecisiveMarkReadyCommit.test.ts` was added and wired into `npm run test:video-date-v4`.

## Verification

- `npx tsx shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `npx tsx shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `npx tsx shared/matching/videoDatePhase3Contracts.test.ts`
- `npx tsx shared/matching/videoDateStartSnapshotContracts.test.ts`
- `npx tsc --noEmit -p tsconfig.app.json`
- `cd apps/mobile && npm run typecheck`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- live marker query for `video_session_mark_ready_v2(uuid,text,text)`
- no-auth smoke call returning structured `not_authenticated` JSON
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked`
- follow-up live marker query for `unused_event_removed=true`

Cloud evidence:

- `20260606092944` and `20260606100511` are applied to linked project `schdyxcunwcvddlcshwd`.
- Final linked dry-run returned `Remote database is up to date`.
- Live marker query returned `decisive_live=true`, `unused_event_removed=true`, `authenticated_execute=true`, and `anon_execute=false`.
- Linked DB lint completed with only pre-existing warnings/notices; it no longer reports `public.video_session_mark_ready_v2`.

No web or native build was run during this implementation verification pass.

## Acceptance Boundary

This is not product-health proof. It addresses the latest Ready Gate `57014` / `ready_b` expiry class in code and cloud state. The product still requires a fresh disposable two-user production run through match -> Ready Gate -> same Daily room -> stable bilateral media/date -> date end -> post-date survey completion, plus short leave/rejoin under 12 seconds and real prolonged absence terminalization.
