# VIBELY — DAILY PROVIDER SHEET

**Date:** 2026-03-10  
**Baseline:** pre-native-hardening frozen baseline  
**Priority:** Tier 1 / live-session-critical

---

## 1. Purpose

This sheet is the provider-specific operating reference for Daily.co.

It is meant to answer:
- what Daily does in Vibely
- which call flows depend on it
- how rooms and meeting tokens are created
- what is env-driven vs hardcoded
- what must exist outside the repo
- what can silently fail during rebuild even when the UI still loads

This sheet is more detailed than the general External Dependency Ledger.

---

## 2. Why Daily is high-risk

Daily is the live-session backbone for Vibely’s real-time call experiences.

It powers:
- live video-date sessions tied to `video_sessions`
- 1:1 match calls tied to `match_calls`
- room creation
- user-scoped meeting token creation
- room teardown

A rebuild can therefore fail in several subtle ways:
- room creation fails because the API key is wrong
- tokens fail even though the app reaches the function
- the domain is wrong but hidden by a fallback
- rooms are created but never cleaned up
- unload cleanup is broken and leaves stale rooms behind
- the room flow works for one call type but not the other

---

## 3. What Daily powers in Vibely

## A. Video-date sessions
Daily powers the live date call experience on:
- `/date/:id`

### Main repo touchpoints
- `src/pages/VideoDate.tsx`
- `src/hooks/useVideoCall.ts`
- `supabase/functions/daily-room`

### Database surfaces involved
- `video_sessions`
- `event_registrations` indirectly via date/event state

### Daily-related session fields in `video_sessions`
- `daily_room_name`
- `daily_room_url`
- `participant_1_id`
- `participant_2_id`
- timing/phase fields used by the date flow

## B. Match calls
Daily also powers 1:1 voice/video calls between matched users.

### Main repo touchpoints
- `src/hooks/useMatchCall.ts`
- `supabase/functions/daily-room`

### Database surfaces involved
- `match_calls`
- `matches`

### Daily-related fields in `match_calls`
- `daily_room_name`
- `daily_room_url`
- `call_type`
- `status`
- `started_at`
- `ended_at`
- `duration_seconds`

---

## 4. Daily-related repo surfaces

## Edge Function
- `daily-room`

## Frontend / hooks
- `src/hooks/useVideoCall.ts`
- `src/hooks/useMatchCall.ts`
- `src/pages/VideoDate.tsx`

## Dependency package
- `@daily-co/daily-js`

---

## 5. Daily env/config surface

### Required Edge Function variables
- `DAILY_API_KEY`
- `DAILY_DOMAIN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### Hardcoded fallback
If `DAILY_DOMAIN` is absent, the function falls back to:
- `vibelyapp.daily.co`

### Hardcoded API base
The function calls the Daily REST API at:
- `https://api.daily.co/v1`

### Operator note
The fallback domain is convenient but dangerous during rebuild because it can hide misconfiguration.
A deployment may appear partially healthy while still pointing at the wrong Daily domain.

---

## 6. Daily room function contract

The `daily-room` Edge Function is the central control point for Daily interactions.

### Auth posture
- `verify_jwt = false` in config
- most actions still require bearer auth inside the function
- **exception:** `delete_room` is intentionally unauthenticated

### Supported actions
- `create_date_room`
- `join_date_room`
- `create_match_call`
- `answer_match_call`
- `delete_room`

### Important auth nuance
This function is a good example of Vibely’s split auth model:
- gateway JWT is not enforced
- business actions still resolve the user via Supabase bearer auth
- but room deletion is left open intentionally so it can be called from `sendBeacon`

---

## 7. Daily room creation behavior

The function creates private Daily rooms using the REST API.

### Shared room properties
Observed room properties include:
- `privacy: private`
- `max_participants: 2`
- `enable_chat: false`
- `enable_screenshare: false`
- `exp` around 2 hours from creation
- `eject_at_room_exp: false`

### Meeting token behavior
Meeting tokens are created with:
- `room_name`
- `user_id`
- `enable_screenshare: false`
- `exp` around 2 hours from issuance

### Retry behavior
When creating a room:
- Daily HTTP `429` triggers a small retry/backoff loop
- Daily HTTP `400` with “already exists” returns the computed room URL instead of failing outright

### Rebuild implication
The room layer is somewhat resilient to duplicate creation attempts and transient rate limits, but only if the Daily domain and API key are correct.

---

## 8. Video-date flow architecture

This is the main Daily-backed product flow in the baseline.

### Step 1 — Frontend calls `create_date_room`
Hook:
- `useVideoCall.startCall()`

Function request body:
- `action: "create_date_room"`
- `sessionId`

### Step 2 — Function authorizes user against `video_sessions`
The function loads:
- `id`
- `participant_1_id`
- `participant_2_id`
- `daily_room_name`

It rejects users who are not one of the two session participants.

### Step 3 — Function reuses or creates the room
Room name pattern:
- `date-${sessionId without hyphens}`

If `daily_room_name` already exists, it is reused.
If not, the function:
- creates the Daily room
- stores `daily_room_name`
- stores `daily_room_url`
  in `video_sessions`

### Step 4 — Function returns user-scoped meeting token
Response includes:
- `room_name`
- `room_url`
- `token`

### Step 5 — Frontend joins room with Daily JS
`useVideoCall`:
- checks camera/mic permissions first
- creates a Daily call object
- joins with `url + token`
- attaches local/remote tracks

### Step 6 — Frontend reacts to Daily events
Important handlers:
- `participant-joined`
- `participant-updated`
- `participant-left`
- `error`
- `left-meeting`
- `network-connection`
- `network-quality-change`

### Step 7 — Cleanup
When the call ends or unload happens:
- frontend leaves/destroys the call object
- best-effort `delete_room` is invoked
- `VideoDate.tsx` also uses `sendBeacon` on unload to:
  - update `video_sessions.ended_at`
  - mark participant status `offline`
  - call `daily-room` with `delete_room`

---

## 9. Match-call flow architecture

Daily also powers ad hoc match calls outside the event-date flow.

### Step 1 — Caller starts a match call
Hook:
- `useMatchCall.startCall(type)`

Function request body:
- `action: "create_match_call"`
- `matchId`
- `callType` = `voice` or `video`

### Step 2 — Function authorizes caller against `matches`
The function confirms the caller is one of:
- `profile_id_1`
- `profile_id_2`

### Step 3 — Function creates room and match call row
Room naming pattern:
- `call-${normalized match id prefix}-${timestamp base36}`

Room properties differ slightly by call type:
- for voice calls, `start_video_off = true`
- for video calls, `start_video_off = false`

The function then inserts a `match_calls` row with:
- `match_id`
- `caller_id`
- `callee_id`
- `call_type`
- `daily_room_name`
- `daily_room_url`
- `status = "ringing"`

### Step 4 — Caller joins immediately
The caller receives:
- `call_id`
- `room_name`
- `room_url`
- `token`

The frontend joins the Daily room immediately.

### Step 5 — Callee answers the ringing call
Hook:
- `useMatchCall.answerCall()`

Function request body:
- `action: "answer_match_call"`
- `callId`

The function:
- ensures the callee owns the ringing call
- returns room/token info

The frontend then:
- joins the room
- updates `match_calls.status = "active"`
- sets `started_at`

### Step 6 — Missed/declined/ended handling
Observed frontend logic:
- unanswered ring after 30 seconds → marks `status = "missed"`
- explicit decline → marks `status = "declined"`
- local end → marks `status = "ended"`, sets `ended_at`, `duration_seconds`
- best-effort `delete_room` is invoked on end

---

## 10. Daily JS runtime behavior in frontend

### `useVideoCall`
This hook handles the video-date runtime.

Observed behavior:
- asks for camera/mic permissions before starting
- uses `DailyIframe.createCallObject()`
- attaches local and remote tracks to video elements
- reacts to partner join/leave
- exposes mute/video toggles
- shows weak-connection warning on low network quality
- invokes `delete_room` on end

### `useMatchCall`
This hook handles match voice/video calls.

Observed behavior:
- creates Daily call object with `videoSource` depending on call type
- starts caller ringing state immediately
- auto-marks a call missed after ~30s if nobody joins
- ends the call if the remote participant leaves
- updates `match_calls` lifecycle state from the frontend
- invokes `delete_room` on end

### Rebuild implication
Daily correctness depends on both:
- the backend room/token function
- the frontend runtime hooks/event handling

A function-only test is not enough.

---

## 11. Outside-the-repo Daily state that must exist

The repo proves the code contracts, but not the provider-side setup.

### Required Daily-side reality
- a Daily account/workspace
- an API key with permission to create/delete rooms and create meeting tokens
- a valid domain/subdomain matching `DAILY_DOMAIN` or the fallback assumption
- room creation allowed for the configured account/domain

### What the repo does **not** fully preserve
- exact Daily account/workspace identity
- exact live domain/subdomain ownership state
- any Daily dashboard configuration beyond what the API implies
- any rate limits, plan limits, or account restrictions in the provider dashboard

---

## 12. What the repo proves vs what it does not prove

## What the repo proves strongly
- the exact function contract for Daily actions
- required secret names
- room naming conventions
- token generation pattern
- room property defaults
- which database tables persist Daily room state
- how frontend hooks join/leave and react to Daily events
- that unload cleanup is intentionally supported via unauthenticated `delete_room`

## What the repo does not prove strongly
- exact live Daily account
- exact current API key state
- exact intended production domain if it differs from fallback
- whether any Daily dashboard toggles materially affect room behavior
- whether any provider-side quotas or restrictions are near their limits

---

## 13. Daily-specific rebuild risks

## Risk 1 — Fallback domain can hide misconfiguration
If `DAILY_DOMAIN` is missing, the function silently falls back to:
- `vibelyapp.daily.co`

That can be helpful, but it can also mask the fact that a new environment is pointing to the wrong or outdated Daily domain.

## Risk 2 — `delete_room` is intentionally unauthenticated
This is required so browser unload cleanup can use `sendBeacon` without bearer auth.

That means room deletion exposure is a deliberate tradeoff and should be verified, not assumed safe by accident.

## Risk 3 — Cleanup is best-effort
Both `useVideoCall` and `useMatchCall` call `delete_room` as best effort.

If room deletion fails:
- the app can still appear to end the call locally
- Daily rooms may remain until provider-side expiration or manual cleanup

## Risk 4 — Frontend and backend each own part of call correctness
The function handles authorization, room creation, and token creation.
The frontend handles:
- permission checks
- join/leave lifecycle
- remote presence state
- call status updates for match calls

A rebuild must validate both layers together.

## Risk 5 — Match-call state is partly frontend-settled
Statuses like:
- `active`
- `missed`
- `declined`
- `ended`

are updated from frontend flows, not only by the function.

This means interrupted sessions or UI regressions can leave `match_calls` in misleading states.

## Risk 6 — Video-date unload flow depends on browser beacon behavior
`VideoDate.tsx` uses `navigator.sendBeacon()` to:
- update `video_sessions.ended_at`
- set participant status offline
- request room deletion

A browser/platform that suppresses or delays these calls can create stale session state.

---

## 14. Minimum Daily verification procedure

### Step 1 — Secret and domain verification
Confirm presence and correctness of:
- `DAILY_API_KEY`
- `DAILY_DOMAIN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### Step 2 — Video-date room creation test
Verify:
- `create_date_room` succeeds for a valid participant
- `video_sessions.daily_room_name` is created or reused
- `video_sessions.daily_room_url` is set correctly
- returned token joins successfully

### Step 3 — Video-date partner join test
Verify:
- second participant can join the same session
- remote media appears
- connect/disconnect UI behaves correctly

### Step 4 — Match-call test
Verify:
- caller can create a voice call
- caller can create a video call
- callee can answer the ringing call
- `match_calls` status transitions behave as expected

### Step 5 — Cleanup test
Verify:
- normal call end triggers local cleanup
- `delete_room` succeeds
- unload path via `sendBeacon` works acceptably in supported browsers

### Step 6 — Failure-path test
Verify at least one of:
- invalid user cannot access another session/call
- missing auth fails for protected actions
- weak/no network handling shows expected UX
- call timeout marks missed call as expected

---

## 15. Known unknowns to resolve in the next Daily-focused audit

1. Is `vibelyapp.daily.co` still the intended production Daily domain?  
2. What is the exact live Daily account/workspace for this baseline?  
3. Are there any Daily dashboard settings that materially affect room permissions, recording, or access beyond what the code implies?  
4. Is unauthenticated `delete_room` acceptable as-is for the intended threat model, or should it be hardened later?  
5. Are there any provider-side rate limits or quotas that have already affected production behavior?  

---

## 16. Recommended next provider sheet after Daily

The strongest next provider sheet is:

**VIBELY_ONESIGNAL_PROVIDER_SHEET.md**

Reason:
- push behavior is operationally brittle
- OneSignal includes a hardcoded app ID in source
- notification delivery depends on both frontend identity setup and backend send/webhook flows

---

## 17. Bottom line

Daily in Vibely is the live-session control plane for video dates and match calls.

To rebuild it correctly, you need more than the code:
- a valid Daily account and API key
- the correct domain/subdomain
- working room and token creation
- browser/runtime behavior that can actually join and clean up calls
- confidence that best-effort teardown and unload cleanup are acceptable in practice

This sheet is the provider-level control point for that reality.

