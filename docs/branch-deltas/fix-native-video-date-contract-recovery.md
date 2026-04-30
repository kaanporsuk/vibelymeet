# Native Video-Date Contract Recovery

Branch: `fix/native-video-date-contract-recovery`

## Problem

Streams 1-9 hardened the Event Lobby, Ready Gate, swipe, realtime, and payment backend contracts. Stream 10 audits the native `/date/[id]` path beyond the Ready Gate handoff so native video-date entry, reconnect, stale handoff recovery, and post-date recovery continue to consume backend truth rather than local lifecycle assumptions.

## Audit Note

Audited:

- `docs/ready-gate-backend-contract.md`
- `docs/branch-deltas/fix-native-ready-gate-parity-contract.md`
- `docs/branch-deltas/fix-ready-gate-event-ended-terminalization.md`
- `docs/branch-deltas/fix-realtime-subscription-tightening.md`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`
- `apps/mobile/lib/useActiveSession.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- web reference surfaces:
  - `src/pages/VideoDate.tsx`
  - `src/lib/videoDatePrepareEntry.ts`
  - `src/hooks/useVideoCall.ts`
- `supabase/functions/daily-room/index.ts` for contract reading only

The native route already uses backend-owned date truth for routeability and lifecycle. No backend SQL, Edge Function, environment variable, provider configuration, native module, or `expo-av` change was required.

## Native Fixes

No production code changes were required after audit. The current native implementation already satisfies the Stream 10 contract:

- `/date/[id]` loads `fetchVideoSessionDateEntryTruthCoalesced(sessionId)` before allowing Daily entry.
- The route verifies the authenticated user is a session participant.
- Routeability is decided through `decideVideoSessionRouteFromTruth` and `canAttemptDailyRoomFromVideoSessionTruth`.
- Stale ready-only sessions bounce back to `/ready/[id]`.
- ended sessions recover to post-date survey when appropriate, otherwise lobby/dashboard fallback.
- Daily room/token acquisition flows through `prepareVideoDateEntry`, which calls `daily-room` `prepare_date_entry`.
- Daily joined stamps use `mark_video_date_daily_joined`.
- lifecycle transitions use `video_date_transition` through native video-date API helpers.
- no direct native writes to server-owned `video_sessions` lifecycle fields or Ready Gate-owned `event_registrations` fields were found.

## Date Bootstrap

Native date bootstrap is backend-first:

1. read session truth by ID
2. verify participant ownership
3. classify backend routeability
4. allow date entry only for date-capable/provider-prepared truth
5. recover stale, missing, unauthorized, or ended sessions without retry loops

## Daily Join Gating

Native joins Daily only after:

- backend truth is already date-capable/provider-prepared, or
- `prepareVideoDateEntry` succeeds through `daily-room` and the backend remains startable.

The route does not construct Daily rooms locally and does not navigate/start from local `both_ready` alone.

## Lifecycle Behavior

Native lifecycle remains backend-owned:

- enter/sync/reconnect/end/complete-handshake use `video_date_transition`
- joined stamps use `mark_video_date_daily_joined`
- Daily room/token data comes from `daily-room`
- post-date/survey recovery reads backend terminal truth

## Stale Handoff Handling

`READY_GATE_NOT_READY`, `EVENT_NOT_ACTIVE`, ended sessions, missing sessions, and not-participant cases are handled as backend truth. `READY_GATE_NOT_READY` gets only bounded race-window refetches; non-startable truth redirects to Ready Gate, lobby, or dashboard rather than looping.

## Duplicate Latches

The native date route already has session-scoped guards for duplicate side effects:

- `hasStartedJoinRef`
- `prejoinAttemptRef`
- `joinAttemptNonce`
- `reconnectEndedHandledRef`
- `handshakeCompletionInFlightRef`
- `handshakeCompletionDeadlineKeyRef`
- post-date journey logging latches

These reset on session ID changes and suppress duplicate join/terminal effects without suppressing refetch or backend reconciliation.

## App Foreground And Reconnect

The route preserves existing `AppState` foreground reconciliation and `syncReconnect` behavior. This stream did not add custom connectivity probes, fetch-based health checks, or a native-only state machine.

## Observability

Existing native observability was confirmed and left intact:

- `VIDEO_DATE_ROUTE_ENTERED`
- `VIDEO_DATE_PREPARE_ENTRY_FAILURE`
- `VIDEO_DATE_DAILY_TOKEN_FAILURE`
- `VIDEO_DATE_DAILY_JOIN_FAILURE`
- `MARK_VIDEO_DATE_DAILY_JOINED_FAILED`
- `VIDEO_DATE_SURVEY_RECOVERED`
- `VIDEO_DATE_SYNC_RECONNECT_FAILED`
- RC/Sentry breadcrumbs scoped to safe operational context

No new analytics provider or environment variables were added.

## Tests Added

- `shared/matching/nativeVideoDateContractRecovery.test.ts`

Coverage:

- native date route exists and gates bootstrap on backend truth
- Daily join remains `prepareVideoDateEntry` / `daily-room prepare_date_entry` gated
- pre-navigation helper rejects stale handoff before date navigation
- native lifecycle uses `video_date_transition`
- joined stamps use `mark_video_date_daily_joined`
- ended/event-inactive/stale blockers recover without retry loops
- session-scoped duplicate join/terminal guards remain present
- AppState foreground/reconnect recovery remains present
- native video-date observability markers remain wired
- no forbidden direct writes to `video_sessions` lifecycle fields
- no forbidden direct writes to server-owned `event_registrations` fields
- no `expo-av` import/require or native module addition
- no Supabase migration or Edge Function change
- Streams 1-9 artifacts remain present

## Manual Physical-Device QA Script

Before a mobile release, run a device smoke for:

1. native app opens `/date/[id]` only after Ready Gate both-ready and backend prepare-entry truth
2. web -> native date handoff
3. native -> native date handoff
4. stale `/date/[id]` direct open before prepare-entry
5. event-ended stale handoff
6. duplicate foreground/focus during date entry
7. partner disconnect/reconnect if supported by the environment
8. end date and post-date survey recovery
9. verify no `expo-av` runtime crash
10. verify no duplicate Daily join/token request loop

Runtime device execution was not required for this code-only contract stream in the current environment.

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Environment variables: none
- Native modules: none
- `expo-av`: not used
- Docker/local Supabase: not used
- EAS cloud build: not required

## Remaining Deferred Work

- physical-device execution of the manual QA script
- screenshot-led native visual parity
- OneSignal/provider operational QA
- RevenueCat/native entitlement implementation if still incomplete
- broader native video-date visual polish beyond contract/recovery
