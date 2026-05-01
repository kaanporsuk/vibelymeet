# VIBELY - DAILY PROVIDER SHEET

**Last audited:** 2026-05-01
**Baseline:** Stream 13 Daily provider operational QA
**Priority:** Tier 1 / live-session-critical

---

## 1. Purpose

This sheet is the provider-specific operating reference for Daily.co in Vibely.

It answers:
- what Daily powers
- which code paths create rooms and issue meeting tokens
- which env names are provider-critical
- how video-date and match-call cleanup works
- what must be verified in the Daily dashboard
- what the repo can prove without creating real production rooms

---

## 2. Why Daily Is High-Risk

Daily is the live-session backbone for:
- video dates tied to `video_sessions`
- 1:1 match calls tied to `match_calls`
- room creation and recovery
- user-scoped meeting token issuance
- provider room cleanup

A rebuild can fail subtly:
- `DAILY_API_KEY` can be wrong while the Edge Function still deploys
- `DAILY_DOMAIN` can drift while the fallback hides the issue
- room creation can work but meeting-token creation can fail
- a video-date room can exist in DB while missing or expired at Daily
- reconnect or cleanup can leave stale rooms for cron cleanup
- match-call and video-date semantics can diverge between web and native

---

## 3. What Daily Powers

### Video Dates

Primary user surfaces:
- web `/date/:id`
- native `apps/mobile/app/date/[id].tsx`

Main code:
- `supabase/functions/daily-room/index.ts`
- `supabase/functions/daily-room/dailyRoomContracts.ts`
- `src/hooks/useVideoCall.ts`
- `src/pages/VideoDate.tsx`
- `src/lib/videoDatePrepareEntry.ts`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`

Daily fields in `video_sessions`:
- `daily_room_name`
- `daily_room_url`
- participant, phase, reconnect, and terminal fields used by the backend state machine

### Match Calls

Primary user surfaces:
- web chat call controller
- native app-level match-call controller

Main code:
- `src/hooks/useMatchCall.tsx`
- `apps/mobile/lib/useMatchCall.tsx`
- `apps/mobile/lib/matchCallApi.ts`
- `supabase/functions/daily-room/index.ts`
- `supabase/functions/match-call-room-cleanup/index.ts`

Daily fields in `match_calls`:
- `daily_room_name`
- `daily_room_url`
- `call_type`
- `status`
- `started_at`
- `ended_at`
- `provider_deleted_at`

---

## 4. Env And Domain Contract

`daily-room` reads:
- `DAILY_API_KEY`
- `DAILY_DOMAIN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The function calls Daily REST at:
- `https://api.daily.co/v1`

If `DAILY_DOMAIN` is absent, `daily-room` falls back to:
- `vibelyapp.daily.co`

Operational posture:
- `DAILY_DOMAIN` is present in production secrets as of the 2026-05-01 read-only check.
- The fallback is still code-supported for resilience, but production should not rely on it silently.
- Dashboard/domain ownership must be verified manually because the repo cannot prove the live Daily account or domain binding.

---

## 5. Edge Function Contract

`daily-room` is configured with:
- `verify_jwt = true`

Supported actions:
- `prepare_date_entry`
- `create_date_room`
- `join_date_room`
- `video_date_leave`
- `create_match_call`
- `join_match_call`
- `answer_match_call`
- `delete_room`

Auth posture:
- all actions require a bearer auth header
- the function resolves the current Supabase user before action handling
- `delete_room` is not public; it verifies the caller is a participant of the `video_sessions` or `match_calls` row for the requested room

Token posture:
- Daily meeting tokens are returned only in successful API responses to the authenticated caller
- tokens are not persisted in DB
- logs use booleans such as `has_token` and do not print token values

Provider error posture:
- Daily `401` / `403` maps to `DAILY_AUTH_FAILED`
- Daily `429` maps to `DAILY_RATE_LIMIT`
- Daily `5xx` maps to `DAILY_PROVIDER_UNAVAILABLE`
- other provider rejects map to `DAILY_REQUEST_REJECTED`
- structured provider logs include operation, room name, HTTP status, provider code, action, and actor IDs, not secrets

---

## 6. Room And Token Contract

### Video-Date Rooms

Room name:
- `date-${sessionId without hyphens}`

Room URL:
- `https://${DAILY_DOMAIN}/${roomName}`

Room behavior:
- deterministic per `video_sessions.id`
- provider room existence is checked before token issuance
- missing or expired provider rooms are recreated with the same canonical name
- Daily "already exists" during create is treated as idempotent success
- canonical `daily_room_name` / `daily_room_url` are persisted idempotently

Video-date room properties include:
- `privacy: private`
- `max_participants: 2`
- `enable_chat: false`
- `enable_screenshare: false`
- `enable_knocking: false`
- `enforce_unique_user_ids: true`
- room TTL: `14_400` seconds
- `eject_at_room_exp: true`

Video-date meeting token:
- scoped to `room_name` and `user_id`
- TTL: `15 * 60` seconds
- issued only after backend-owned prepare-entry / handshake/date truth allows entry

### Match-Call Rooms

Room name:
- `call-${normalized match id prefix}-${timestamp base36}`

Room behavior:
- `create_match_call` creates a private room and inserts a `match_calls` row
- duplicate active/ringing rows are blocked and may reuse an existing open call for retry
- `answer_match_call` activates the backend row before returning a token
- `join_match_call` issues a fresh token only for participants of active calls
- missing or expired provider rooms are recovered before token issuance

Match-call room properties include:
- `privacy: private`
- `max_participants: 2`
- `enable_chat: false`
- `enable_screenshare: false`
- voice calls start video off
- room TTL: `7_200` seconds
- `eject_at_room_exp: false`

Match-call meeting token:
- scoped to `room_name` and `user_id`
- TTL: `7_200` seconds

---

## 7. Video-Date Flow

Current canonical entry path:
1. Web/native pre-entry calls `prepareVideoDateEntry`.
2. `prepareVideoDateEntry` invokes `daily-room` with `action: "prepare_date_entry"`.
3. The Edge Function runs `video_date_transition('prepare_entry')`.
4. The Edge Function creates/reuses/recovers the canonical Daily room.
5. The Edge Function confirms prepared entry and returns `room_name`, `room_url`, and token.
6. Web/native creates a Daily call object and joins with `url + token`.
7. After join, clients confirm Daily joined state through backend RPCs/transition helpers.

Legacy-compatible actions still present:
- `create_date_room`
- `join_date_room`

Frontend/native runtime handles:
- permission prompts
- Daily call object creation
- local and remote track attachment
- `participant-joined`
- `participant-updated`
- `participant-left`
- `left-meeting`
- provider errors
- network quality / reconnect signals
- terminal state reconciliation from backend truth

---

## 8. Video-Date Cleanup And Reconnect

Video-date provider room deletion is backend cleanup owned.

Current web/native behavior:
- local call object is left/destroyed on local end or teardown
- `daily_room_name` is intentionally preserved in DB until cleanup succeeds
- web lifecycle uses authenticated `fetch(..., keepalive: true)` to `daily-room` with `action: "video_date_leave"`
- native marks reconnect/away state through backend-owned transition helpers
- clients log `daily_room_delete_skipped` for video-date rooms because `video-date-room-cleanup` owns provider deletion after terminal state

Cleanup worker:
- `video-date-room-cleanup`
- `verify_jwt = false`
- protected by `CRON_SECRET`
- deletes Daily rooms for terminal `video_sessions` rows

Reconnect behavior:
- `participant-left`, Daily transport/network events, and app lifecycle paths mark transient away/reconnect state
- partner absence uses a grace window before terminal handling
- foreground/reconnect paths refetch backend truth

---

## 9. Match-Call Flow

Caller flow:
1. web/native `useMatchCall` calls `daily-room` with `action: "create_match_call"`.
2. The Edge Function verifies the caller belongs to the match and that the pair is not archived/blocked/suspended/paused.
3. The Edge Function creates a Daily room and caller token.
4. The Edge Function inserts `match_calls` with `status = "ringing"`.
5. Caller joins immediately.

Callee flow:
1. realtime `match_calls` insert/update surfaces an incoming call.
2. `answer_match_call` verifies callee ownership.
3. Backend `match_call_transition('answer')` activates the row first.
4. The Edge Function returns a fresh callee token only after activation.
5. Callee joins with `room_url + token`.

Rejoin flow:
- `join_match_call` issues a fresh token for participants of active calls.

Cleanup:
- clients transition terminal state with backend RPCs
- clients then call `delete_room` best-effort
- `delete_room` only deletes terminal match-call rooms
- `match-call-room-cleanup` is the cron safety net for terminal rows if client cleanup is missed

---

## 10. `delete_room` Posture

`delete_room` is intentionally supported for client cleanup, but it is not unauthenticated.

Current safeguards:
- Supabase gateway JWT is enabled for `daily-room`
- the function requires an auth header
- the function resolves the current user
- requested `roomName` must match a `video_sessions` or `match_calls` row
- caller must be a participant
- video-date room deletion is skipped because cron owns it
- match-call room deletion is skipped while ringing/active or already cleaned
- terminal match-call rooms may be deleted and then marked `provider_deleted_at`

Operational implication:
- unauthorized deletion is blocked by code
- terminal cleanup remains best effort and cron-backed
- provider-side orphan rooms are possible if both client cleanup and cron cleanup fail

---

## 11. What The Repo Proves

Strongly proven by code/tests:
- Daily env names and fallback domain behavior
- REST endpoints for rooms and meeting tokens
- deterministic video-date room naming
- match-call room naming
- token issuance before client join
- token values are not logged
- video-date entry is backend prepare-entry gated
- match-call answer token is backend transition gated
- video-date cleanup is cron-owned
- match-call cleanup is client best-effort plus cron safety net
- native uses Daily native SDK and does not use `expo-av`

Not proven by repo:
- exact live Daily account/workspace
- live API key permissions
- live domain ownership
- provider quota/rate-limit health
- dashboard settings that may affect private rooms/tokens
- physical-device camera/mic behavior

---

## 12. Manual Daily Dashboard Checklist

1. Confirm the Daily account/workspace is the intended production workspace.
2. Confirm `DAILY_API_KEY` belongs to that workspace and can create rooms, delete rooms, look up rooms, and create meeting tokens.
3. Confirm `DAILY_DOMAIN` is the intended production domain.
4. Confirm the domain currently resolves/works as a Daily domain, expected `vibelyapp.daily.co` unless deliberately changed.
5. Confirm private room creation is allowed.
6. Confirm meeting tokens are enabled and accepted for private rooms.
7. Confirm room expiration/eject behavior is acceptable for 15-minute video-date tokens and 4-hour video-date rooms.
8. Confirm match-call 2-hour rooms/tokens are acceptable.
9. Confirm no recording, transcription, or dashboard automation settings unexpectedly affect rooms.
10. Confirm provider quotas/rate limits are healthy.
11. Run controlled internal QA only with test users:
    - video-date prepare entry
    - room create/reuse
    - both participants join
    - reconnect grace
    - terminal cleanup via `video-date-room-cleanup`
    - voice match call
    - video match call
    - answer/rejoin
    - terminal match-call room cleanup

---

## 13. Remaining Operational Risks

- `DAILY_DOMAIN` fallback can still hide config drift in a misconfigured environment.
- Real provider permissions cannot be proven without creating/deleting a test room.
- Client cleanup is best effort; cron cleanup is the safety net.
- Web and native media permission behavior still requires physical-device/browser QA.
- Provider dashboard settings and quotas remain manual verification items.

---

## 14. Bottom Line

Daily is production-critical for live video dates and match calls.

The current repo contract is materially stronger than the old baseline:
- `daily-room` is JWT-gated
- `delete_room` is participant-gated
- video-date cleanup is cron-owned
- match-call cleanup is terminal-state gated
- prepare-entry owns video-date room/token readiness
- tokens are response-only and not logged

The remaining work is controlled internal provider QA against the real Daily dashboard and test users.
