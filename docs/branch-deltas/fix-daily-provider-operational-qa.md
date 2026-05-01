# Stream 13 - Daily Provider Operational QA

Branch: `fix/daily-provider-operational-qa`
Date: 2026-05-01

## Problem

Daily is the live-call provider for Vibely video dates and match calls. Provider drift can break room creation, meeting token issuance, reconnect, cleanup, or the web/native join contract without changing product code. This stream audits those assumptions and locks the current contract with static tests and docs.

## Files Audited

- `supabase/functions/daily-room/index.ts`
- `supabase/functions/daily-room/dailyRoomContracts.ts`
- `supabase/functions/match-call-room-cleanup/index.ts`
- `supabase/functions/video-date-room-cleanup/index.ts`
- `src/hooks/useVideoCall.ts`
- `src/hooks/useMatchCall.tsx`
- `src/pages/VideoDate.tsx`
- `src/lib/videoDatePrepareEntry.ts`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`
- `apps/mobile/lib/useMatchCall.tsx`
- `apps/mobile/lib/matchCallApi.ts`
- `supabase/config.toml`
- `_cursor_context/vibely_daily_provider_sheet.md`
- Daily-related branch deltas and provider docs

## Read-Only Supabase Checks

- Supabase linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`
- `supabase/functions/daily-room` config: `verify_jwt = true`
- `daily-room` is deployed and active in project `schdyxcunwcvddlcshwd`
- `DAILY_API_KEY` and `DAILY_DOMAIN` secret names are present
- Secret values were not printed; only names and digests were visible

Commands run:
- `supabase projects list`
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd`

## Daily Room/Token Contract

`daily-room` reads:
- `DAILY_API_KEY`
- `DAILY_DOMAIN`

It calls Daily REST at:
- `https://api.daily.co/v1`

Room operations:
- creates rooms through `POST /rooms`
- looks up rooms through `GET /rooms/{roomName}`
- deletes rooms through `DELETE /rooms/{roomName}` when cleanup safety allows

Meeting tokens:
- created through `POST /meeting-tokens`
- scoped to `room_name` and `user_id`
- returned only to the authenticated caller
- not persisted in DB
- not logged as raw values

Provider error handling:
- auth failures map to `DAILY_AUTH_FAILED`
- rate limits map to `DAILY_RATE_LIMIT`
- provider `5xx` maps to `DAILY_PROVIDER_UNAVAILABLE`
- other provider rejects map to `DAILY_REQUEST_REJECTED`

## Fallback Domain Posture

`DAILY_DOMAIN` is supported and present in production secrets. If absent, the code falls back to:

- `vibelyapp.daily.co`

The fallback remains a resilience mechanism, not a desired production operating mode. The Daily dashboard must still be checked to confirm the intended production domain and workspace.

## Video-Date Path

Canonical video-date entry is backend prepare-entry gated:

1. Web/native calls `prepareVideoDateEntry`.
2. `prepareVideoDateEntry` invokes `daily-room` with `action: "prepare_date_entry"`.
3. The Edge Function runs `video_date_transition('prepare_entry')`.
4. The Edge Function creates/reuses/recovers the canonical Daily room.
5. The Edge Function confirms prepared entry and returns `room_name`, `room_url`, and token.
6. Web/native joins Daily with `url + token`.
7. Post-join confirmation and terminal state remain backend-owned.

Video-date room name:

- `date-${sessionId without hyphens}`

Video-date room/token posture:
- room TTL: `14_400` seconds
- token TTL: `15 * 60` seconds
- provider room is verified/recovered before token issuance
- duplicate Daily room creation is idempotent when Daily reports "already exists"

## Match-Call Path

Match calls use the same `daily-room` Edge Function:

- `create_match_call`
- `answer_match_call`
- `join_match_call`
- `delete_room`

Room name pattern:

- `call-${normalized match id prefix}-${timestamp base36}`

Match-call posture:
- caller must belong to the match
- archived, blocked, suspended, paused, and duplicate active/ringing calls are blocked
- caller token is issued before the caller joins
- `answer_match_call` activates the backend row before issuing the callee token
- `join_match_call` issues fresh tokens for active calls
- missing/expired provider rooms are recovered before token issuance

## `delete_room` Posture

The older provider sheet said `delete_room` was unauthenticated for `sendBeacon`. That is stale.

Current posture:
- `daily-room` has `verify_jwt = true`
- every action requires bearer auth
- `delete_room` resolves the current Supabase user
- the requested `roomName` must match `video_sessions` or `match_calls`
- the caller must be a participant
- video-date room deletion is skipped because `video-date-room-cleanup` owns terminal provider cleanup
- match-call room deletion is skipped while ringing/active or already cleaned
- terminal match-call rooms may be deleted and marked with `provider_deleted_at`

## Cleanup/Reconnect Behavior

Video dates:
- web lifecycle uses authenticated `fetch(..., keepalive: true)` with `action: "video_date_leave"`
- native marks reconnect/away through backend-owned transition helpers
- clients leave/destroy local Daily call objects
- video-date provider deletion is cron-owned by `video-date-room-cleanup`

Match calls:
- web/native run backend `match_call_transition` actions for answer, joined, heartbeat, end, decline, missed, and join failure
- clients attempt best-effort `delete_room` after terminal cleanup
- `match-call-room-cleanup` is the cron safety net for terminal rows

Reconnect:
- web and native listen for `participant-joined`, `participant-updated`, `participant-left`, `left-meeting`, errors, and network quality signals
- remote leave enters a grace/reconnect path rather than immediately rewriting provider state

## Safe Logging Posture

Audited logs include action, status, room name, provider code, IDs, and boolean token presence markers such as `has_token`.

Raw Daily API key, auth headers, and meeting token values are not logged.

## Code Fixes Made

No Daily Edge Function runtime code changed.

Docs were updated:
- `_cursor_context/vibely_daily_provider_sheet.md` now matches the current authenticated `delete_room`, prepare-entry, cron cleanup, and web/native contract.

## Tests Added

Added:
- `shared/matching/dailyProviderOperationalQa.test.ts`

Coverage:
- `DAILY_API_KEY`
- `DAILY_DOMAIN`
- fallback domain
- Daily REST room creation
- meeting token creation
- token secrecy in logs
- deterministic video-date room naming
- match-call room creation and answer flow
- authenticated participant-gated `delete_room`
- cleanup worker posture
- web/native prepare-entry gating
- web/native reconnect and leave contracts
- match-call web/native action presence
- no env var, migration, native module, `expo-av`, or unrelated provider changes

## Manual Daily Dashboard Checklist

1. Confirm the Daily account/workspace is the intended production workspace.
2. Confirm `DAILY_API_KEY` can create rooms, look up rooms, delete rooms, and create meeting tokens.
3. Confirm `DAILY_DOMAIN` is the intended production domain.
4. Confirm `vibelyapp.daily.co` is still expected if the fallback is ever used.
5. Confirm private room creation is allowed.
6. Confirm meeting tokens are enabled and accepted for private rooms.
7. Confirm no recording/transcription/dashboard automation setting unexpectedly changes room behavior.
8. Confirm provider quotas and rate limits are healthy.
9. Run controlled internal Daily QA with test users only:
   - video-date prepare entry
   - both users join the same room
   - reconnect grace
   - terminal video-date cleanup
   - voice match call
   - video match call
   - answer/rejoin
   - terminal match-call cleanup

## Deploy Requirements

Supabase migration requirement: none.

Edge Function deploy requirement:
- none if this branch does not change `supabase/functions/daily-room/index.ts`
- if `daily-room` changes later, deploy only:
  - `supabase functions deploy daily-room --project-ref schdyxcunwcvddlcshwd`

This branch does not deploy all Edge Functions.

## Explicit Non-Changes

- Env var changes: none
- Native module changes: none
- Supabase migration requirement: none
- Edge Function source changes: none
- No Docker was used
- No local Supabase was used
- No Supabase DB deploy was run
- No real production Daily rooms were created or deleted
- No `expo-av` import/require was added
- No Ready Gate, swipe, payment, Bunny, OneSignal, RevenueCat, Resend, or Twilio changes were made

## Remaining Controlled Internal Daily QA

- Create and join a video date with two internal test users
- Verify Daily room reuse/recovery on retry
- Verify meeting token joins on web and native
- Verify remote leave/reconnect grace
- Verify terminal video-date cleanup worker deletes the provider room
- Create/answer/end voice and video match calls with test users
- Verify terminal match-call room cleanup and `provider_deleted_at`
- Perform physical-device camera/mic checks on iOS and Android
