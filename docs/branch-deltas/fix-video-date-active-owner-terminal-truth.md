# Video Date Active Owner And Terminal Truth Patch

Date: 2026-06-08

Status: local implementation and documentation evidence only. This branch is not production-certified until merged, Supabase cloud is applied, and a fresh disposable two-user production run completes through `date_feedback` for both users.

## Problem

The latest two-user failures showed that route entry, `both_ready`, Daily room creation, warm-up UI, or brief media are still insufficient proof. The remaining failure class was cross-surface ownership churn after the date route had already become the rightful owner:

- Web and native/mobile event lobby side effects could still poll readiness/status, drain queue state, or run action loops while `/date/:sessionId` owned an active handoff/date or terminal survey recovery.
- Terminal evidence was hard to reconstruct as one chronological story because surface claims, `video_sessions.state_updated_at`, `ended_at`, and `ended_reason` did not carry a shared terminal generation/audit tuple.
- Delayed Daily webhook facts could arrive after terminal state and be blocked from mutating the row, losing historical proof that a participant actually joined.
- Hot lifecycle RPCs needed HTTP/PostgREST probes that prove duplicate, invalid, and terminal-style requests return structured JSON instead of raw 500s.
- Survey truth needed to remain a hard stop for Daily/date/queue loops until feedback persists.

## Implementation

- Web `src/pages/EventLobby.tsx` now derives `activeDateRouteOwnsLobby` from active date navigation, same-event active video truth, and `queue_status = 'in_survey'`; lobby side effects and actions are disabled while that owner is present.
- Native/mobile `apps/mobile/app/event/[eventId]/lobby.tsx` applies the same single-owner gate before readiness, status, queue, and foreground side effects.
- Migration `20260608171837_video_date_active_owner_terminal_truth.sql` adds terminal generation/audit fields to `video_sessions`, terminal tuple columns to `video_date_surface_claim_events`, a terminal audit trigger, and final PostgREST-safe wrappers for `video_session_mark_ready_v2(...)` and `claim_video_date_surface(...)`.
- The migration preserves delayed Daily provider join/left truth by webhook `occurred_at` into participant provider-proof columns and an append-only `daily_webhook_historical_truth` presence event, even when terminal state blocks further lifecycle mutation. This includes the base Daily recorder's terminal no-mutation response shape (`state = ignored`, `result = ignored_terminal_session`), because that response can still carry historically true provider join/left evidence.
- `shared/matching/videoDateLifecycleRpcPostgrestRuntime.test.ts` adds authenticated HTTP/PostgREST probes for lifecycle RPC duplicate, invalid, and optional seeded terminal contracts.
- Generated Supabase types and static red-flag tests now include the new audit/proof fields and route-owner gates.

## Guidance

- Treat `/date/:sessionId` as the single owner after `both_ready`, during handshake/date, and during terminal survey recovery. Event lobby and deck logic may display passive hints only after the active owner releases ownership or feedback persists.
- Do not clear or rebuild a live same-session Daily heartbeat/call on route remount. Existing web and native date routes already preserve active call identity for the explicit warm handoff path; this patch protects surrounding lobby loops from competing with that preserved owner.
- Preserve delayed provider truth as historical evidence by provider `occurred_at`; do not use late webhook arrival time to erase the fact that a participant actually joined. A terminal-ignored Daily webhook is not active state mutation permission, but it is still historical proof that must be preserved.
- Terminal/survey rows are not success proof. They are only recovery truth until both users complete `date_feedback`.
- For future failures, collect `terminal_generation`, `terminal_audit_*`, `participant_*_provider_joined_at`, `participant_*_provider_left_at`, surface-claim terminal tuple fields, `daily_webhook_historical_truth` presence events, and the lifecycle RPC response bodies before changing ownership or provider logic again.

## Verification

Completed locally:

- `npx tsx shared/matching/webEventLobbyGating.test.ts`
- `npx tsx shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts`
- `npx tsx shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `npx tsx shared/matching/videoDateLifecycleRpcPostgrestRuntime.test.ts` with expected local skip when seeded `VIDEO_DATE_PUBLIC_API_RLS_*` credentials are absent.
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`

Known limitation:

- Local Supabase apply/reset could not run because Docker was unavailable. Supabase cloud apply was not performed during the local implementation pass.
