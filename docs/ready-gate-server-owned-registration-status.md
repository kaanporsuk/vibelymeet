# Ready Gate Server-Owned Registration Status

## Problem

Ready Gate canonical state already lived in `video_sessions`, but clients could still write
`event_registrations.queue_status = 'in_ready_gate'` through `update_participant_status`.
That left a race window where a refresh, background/resume, retry, or stale overlay could
resurrect Ready Gate registration state after the server had moved the session forward or
ended it.

## Root Cause

`update_participant_status` was intended for presence/lobby status, but its allowlist still
included `in_ready_gate`. Web and native Ready Gate overlays also wrote `in_ready_gate`
directly, making registration state partially client-owned.

## Changed Files

- `supabase/migrations/20260501141000_ready_gate_server_owned_registration_status.sql`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/pages/EventLobby.tsx`
- `src/hooks/useEventStatus.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/lib/eventStatus.ts`
- `apps/mobile/lib/videoDateApi.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`

## Migration Summary

The migration:

- Normalizes orphan rows where `queue_status = 'in_ready_gate'` and `current_room_id IS NULL`
  back to `idle`.
- Redefines `update_participant_status(uuid, text)` with the same signature.
- Allows authenticated clients to write only `browsing`, `idle`, `in_survey`, and `offline`.
- Rejects client attempts to write `in_ready_gate`, `in_handshake`, or `in_date`.
- Keeps existing protections that prevent client presence writes from overwriting active
  joined video-date state.

## Ownership Model After Fix

- Server promotion/recovery flows own `in_ready_gate` and `current_room_id`.
- `ready_gate_transition` owns Ready Gate terminal decisions and remains row-locked.
- `video_date_transition('prepare_entry')` remains preflight-only.
- `confirm_video_date_entry_prepared` owns the routeable transition into `in_handshake` or
  `in_date` after Daily room/token success.
- Web/native clients only observe session truth and may write non-session-authoritative
  presence statuses.
- `EventLobby` has a same-runtime in-flight guard to suppress duplicate prepare/navigation
  bursts for one session.

## Validation

Commands used for this change:

- `npm run test:vibe-video-contract` - passed: 23 Vibe Video tests, 5 onboarding type tests.
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts` - passed: 86 tests.
- `npx tsc --noEmit -p tsconfig.app.json` - passed.
- `npm run typecheck:core` - passed.
- `cd apps/mobile && npm run typecheck` - passed.
- `npm run lint` - passed with 0 errors and existing warnings.
- `npm run build` - passed; Vite emitted existing chunk/dynamic-import warnings.
- `supabase db push --linked --dry-run` - passed; would push only
  `20260501141000_ready_gate_server_owned_registration_status.sql`.

## Deploy Impact

- Supabase DB migration required.
- Web rebuild/deploy required.
- Native JS rollout required.
- No Supabase Edge Function deploy is required; Edge Function code is unchanged.

## Manual QA Script

1. Web + web simultaneous Ready:
   - Join the same event with two web users.
   - Match into Ready Gate and tap Ready on both clients nearly simultaneously.
   - Refresh one browser immediately after tapping.
   - Expect one `video_sessions` row, one terminal Ready Gate outcome, and both users to
     converge on the same `/date/:sessionId` after provider-confirmed truth exists.

2. Web + native simultaneous Ready with background/resume:
   - Tap Ready on both clients nearly simultaneously.
   - Background native during the transition.
   - Resume native.
   - Expect native to route to the same date if Daily confirm succeeded, or cleanly return
     to Ready Gate/lobby if the gate expired.

3. Native `/ready/:id` kill/relaunch:
   - Open native `/ready/:sessionId`.
   - Tap Ready with a web partner.
   - Kill the app during transition, then relaunch.
   - Expect active-session recovery to enter `/date/:sessionId` only with provider-confirmed
     truth.

4. Network loss after `both_ready`:
   - Disconnect one participant after both clients are ready.
   - Let the other participant prepare and enter the date.
   - Reconnect the first participant.
   - Expect recovery to converge to the same session/date when provider truth exists.

5. SQL spot-checks:
   - `select count(*) from event_registrations where queue_status = 'in_ready_gate' and current_room_id is null;`
   - For the tested session, verify both participants share `current_room_id` and are
     `in_handshake` or `in_date` after provider confirmation.
