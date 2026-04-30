# Realtime Subscription Tightening

Branch: `fix/realtime-subscription-tightening`

## Problem

Streams 1-7 made Event Lobby and Ready Gate backend truth authoritative, but several client surfaces still listened to broad event-level `video_sessions` realtime changes. Stream 8 narrows those listeners so web and native observe only the minimum session truth needed for lobby recovery while preserving backend sync, polling, refetch, app-focus recovery, and duplicate side-effect latches.

## Audit Note

Audited:

- `docs/ready-gate-backend-contract.md`
- `docs/branch-deltas/fix-ready-gate-terminal-ux-observability.md`
- `docs/branch-deltas/fix-native-ready-gate-parity-contract.md`
- `src/pages/EventLobby.tsx`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useActiveSession.ts`
- `src/hooks/useReadyGate.ts`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/lib/videoDatePrepareEntry.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/useActiveSession.ts`
- `apps/mobile/lib/readyGateApi.ts`

No backend SQL, Edge Function, environment variable, provider configuration, native module, or `expo-av` change was required.

## Subscription Changes

Removed broad event-level `video_sessions` realtime filters from:

- `src/pages/EventLobby.tsx`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useActiveSession.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/useActiveSession.ts`

Those surfaces now use participant-scoped `video_sessions` bindings:

- `participant_1_id = current user`
- `participant_2_id = current user`

Because Supabase Realtime filters do not support the required participant OR in a single filter, each surface subscribes to both participant sides and then validates the event/session row before running side effects.

Session-specific Ready Gate listeners were already scoped and remain unchanged:

- `src/hooks/useReadyGate.ts`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/lib/readyGateApi.ts`

Own-registration subscriptions remain the primary lobby signal for user state:

- web Event Lobby and active-session hydration
- native Event Lobby and active-session hydration
- web Ready Gate overlay reconciliation

No broad event-level `video_sessions` subscription was retained in the Event Lobby / Ready Gate / Match Queue surfaces.

## Fallbacks Preserved

Realtime remains a signal, not the source of truth. These recovery paths remain in place:

- initial active-session hydration
- `drain_match_queue`
- `ready_gate_transition('sync')`
- current session refetch
- own `event_registrations` subscriptions
- web visibility refetch
- native `AppState` foreground refetch
- interval/polling fallbacks where they already existed
- Ready Gate overlay polling/reconciliation

## Latches Preserved

Session-scoped duplicate side-effect protections remain in place:

- web date navigation latches
- web terminal/recovery latches
- native date navigation latches
- native terminal/recovery latches
- match queue ready/TTL notification dedupe

The subscription changes only reduce event fan-out. They do not suppress sync/refetch or legitimate new sessions.

## Tests Added

- `shared/matching/realtimeSubscriptionTightening.test.ts`

Coverage:

- web Ready Gate current-session subscriptions remain `id=eq.<sessionId>`
- web lobby/match queue/active-session discovery no longer uses event-level `video_sessions` realtime
- participant-specific subscriptions cover both participant columns
- own `event_registrations` subscriptions remain
- polling/refetch/visibility/AppState fallbacks remain
- duplicate navigation and terminal latches remain
- date navigation remains backend prepare-entry gated
- native standalone `/ready/[id]` still syncs backend truth
- no forbidden Ready Gate client writes were introduced
- no `expo-av` import/require was introduced
- Streams 1-7 artifacts remain present
- no Stream 8 Supabase migration or validation SQL was added

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Environment variables: none
- Native modules: none
- Docker/local Supabase: not used

## Remaining Deferred Work

- Premium/credits observability
- Full native video-date polish beyond Ready Gate handoff
- Physical-device Ready Gate/native QA
- Screenshot-led native visual parity
- Broader notification/provider operational QA
