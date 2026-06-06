# Branch Delta: Video Date Entry/Daily Owner And Stable Copresence

Date: 2026-06-06

## Purpose

Close the remaining Video Date failure class as an ownership and copresence problem, not as another retry-only patch.

The latest failures showed that Ready Gate, canonical Daily room creation, and even brief Daily entry could succeed while the active client owner churned across lobby, Ready Gate, and `/date`. Backend lifecycle could then treat stale joined state or a very brief provider overlap as enough to start handshake/date flow. This branch adds one shared date-entry owner, one shared Daily owner, and a backend stable-copresence gate before handshake starts.

## Code Changes

- Added `shared/matching/videoDateEntryOwner.ts` with shared date-entry owner state and route/session Daily owner state keyed by session/user/room.
- Wrapped web and native/mobile `prepareVideoDateEntry` paths so Ready Gate, lobby, `/ready`, and `/date` coalesce duplicate work under the same owner instead of force-spawning competing Daily preparation.
- Marked owner handoff as `navigating` from web Event Lobby / Ready Gate and native/mobile Ready Gate / `/ready`.
- Added web and native/mobile Daily owner heartbeats through `mark_video_date_daily_alive(...)` after provider join.
- Added `daily_owner_provider_left_unexpected` observability when Daily reports `left-meeting` while the route/session owner still believes it is joined.
- Preserved terminal and explicit leave/end as destructive cleanup boundaries; nonterminal route remounts remain owner/UI detach paths.

## Database Changes

Migration: `supabase/migrations/20260606180000_video_date_stable_copresence_handshake_guard.sql`

Adds:

- Service-only append ledger `video_date_presence_events`.
- Public RPC `mark_video_date_daily_alive(...)`.
- Service helper `video_date_stable_copresence_v1(session_id)`.
- Replacement fail-soft `mark_video_date_daily_joined` base that records join evidence but returns `waiting_for_stable_copresence=true` until the helper passes.

Stable copresence requires both latest provider/client joined evidence active after any latest leave, both owner heartbeats newer than the later joined time, both latest heartbeats fresh within 15 seconds, and at least 2 seconds of stability unless canonical remote-seen is already present. The stability window is anchored to the first qualifying bilateral owner-heartbeat pair after the later join; ongoing heartbeat refreshes prove freshness but must not reset the 2-second stability timer.

Audit correction: the first migration draft tied the 2-second stability check to the latest owner heartbeat. That would let continuous heartbeat refreshes keep the session in `owner_heartbeat_stabilizing`. The applied migration separates first-heartbeat stability evidence from latest-heartbeat freshness evidence and returns `stable_copresence_since_at` plus per-participant first/latest owner heartbeat timestamps for diagnostics.

## Rollout Boundary

Source code merged via PR #1212 at `0a85449a0384f257d314a77c5a7fe455a71e2003`, and migration `20260606180000_video_date_stable_copresence_handshake_guard.sql` was applied to Supabase cloud on 2026-06-06 after that source merge. Post-apply dry-run reports the remote database is up to date. This records repository/cloud schema alignment only; it does not prove heartbeat-capable web or native/mobile clients were deployed, built, installed, or live in production.

Rollout documentation was synchronized afterward in PR #1213 at `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8`; the parent workspace has no remote and records the nested app pointer locally at `9d0536877ebb9c808abb8b538c68935bf0581702`.

Verified implementation order:

1. Merged web/native/mobile source with shared owner and alive heartbeat support.
2. Applied `20260606180000_video_date_stable_copresence_handshake_guard.sql` to Supabase cloud.
3. Verified migration list/dry-run alignment plus live catalog markers for `video_date_presence_events`, `mark_video_date_daily_alive(...)`, and `video_date_stable_copresence_v1(session_id)`.
4. Client deployment/build confirmation remained required after the source merge/cloud apply. Remaining acceptance work is still the disposable two-user production proof and inspection of `video_date_presence_events`, `mark_video_date_daily_alive` responses, and handshake reason codes.

## Verification

No web deployment verification or native build was run; therefore this branch delta must not be used as proof that all clients live in production can send `mark_video_date_daily_alive`.

Passed:

- `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`
- `npm run test:video-date-v4` with only the two expected env-gated RLS skips
- `npm run test:daily-room-contract`
- `npx tsx shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npm run lint`
- `npm run typecheck`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --level error --fail-on error`

Supabase post-apply dry-run reports the remote database is up to date. Live catalog verification confirmed `video_date_presence_events` exists with RLS enabled, anon/authenticated cannot select it directly, `mark_video_date_daily_alive` exists, `mark_video_date_daily_joined` exists, and `video_date_stable_copresence_v1` returns a typed waiting payload for a missing session.

## Acceptance Boundary

This is implementation verification only. Do not claim Video Date healthy from static checks, both-ready, route entry, Daily room creation, brief warm-up UI, or terminal survey rows.

Acceptance remains a fresh disposable two-user production run:

match -> Ready Gate -> same Daily room -> stable owner heartbeat copresence -> stable bilateral media/warm-up/date -> date end -> post-date survey opens and completes.

Also verify:

- short Daily leave/rejoin under 12 seconds stays nonterminal and recovers through the same owner;
- real prolonged absence terminalizes after transport grace plus absence confirmation;
- no stale joined state, expired surface claim, or one-second provider overlap starts handshake without stable copresence or remote-seen.
