# Native Video Date Deep Flow Audit - 2026-06-14

## Scope

This is a source-first and linked-backend investigation of the native Vibely Video Date flow. It covers the native UI, client contracts, local state machines, Supabase RPCs, Edge Functions, database checkpoints, and the latest observed two-user Web/native run.

This audit is not a launch-proof certification. For Video Date, launch proof still requires a fresh disposable two-user production run on the target surfaces, including a physical native iOS device, that reaches persisted `date_feedback` for the post-date survey.

## Evidence Status

- Workspace inspected: `/Users/kaanporsuk/Documents/Vibely/Git/vibelymeet`.
- Canonical docs inspected: `docs/active-doc-map.md`, `docs/video-date-architecture.md`, `docs/video-date-runbook.md`, `docs/qa/video-date-native-device-certification.md`, `docs/qa/video-date-golden-flow-certification.md`, `AGENTS.md`, `CODEX.md`, `CLAUDE.md`.
- Linked Supabase project inspected: `schdyxcunwcvddlcshwd`.
- Cloud migration state: `supabase db push --linked --dry-run` reported the remote database is up to date.
- Live production RPC heads spot-checked with `pg_get_functiondef(...)` markers.
- Local contract checks passed:
  - `npx tsx shared/videoDate/videoDateSessionController.test.ts`
  - `npx tsx shared/videoDate/videoDateSurfaceRouteDecision.test.ts`
  - `npx tsx shared/matching/nativeReadyGateParityContract.test.ts`
  - `npx tsx shared/matching/nativePhysicalDeviceQaReadiness.test.ts`
  - `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
  - `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`
  - `npx tsx shared/matching/videoDateRemoteSeenRetryContracts.test.ts`
  - `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
  - `npm run test:video-date:red-flags`
  - `npm run typecheck` in `apps/mobile`
- Important caveat: this audit reflects the current local candidate source plus the linked live backend, but local app source changes are not the same as deployed production proof until the GitHub/Supabase publish flow and a fresh two-user runtime run are completed.

## Executive Finding

The native Video Date call-establishment pipeline is now server-owned and evidence-gated at the right boundaries. Ready Gate, provider room preparation, Daily join, Daily alive heartbeat, remote-seen proof, stable bilateral media, and date start all have explicit contracts and local tests.

The latest observed failure boundary is after a successful call, not before it. The latest session reached:

- `ready_gate_status = both_ready`
- both participant Daily join stamps
- both participant remote-seen stamps
- `stable_bilateral_media_at`
- `date_started_at`
- terminal `ended` state
- both event registrations set to `queue_status = in_survey`

The missing terminal proof is `date_feedback`. There were no `date_feedback` rows for session `7b0795ed-133d-47ad-a31b-c738e00248b7` at the time of the linked database check. Therefore, the current risk is native post-date survey recovery/submission/confirmation, not Daily room creation or remote media promotion.

## Native User Flow Map

### 1. Lobby and Mutual Swipe

Primary files:

- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/videoDate/useActiveSession.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `shared/matching/videoDateRouteDecision.ts`
- `shared/videoDate/routeDecision.ts`
- `shared/videoDate/navigationIntents.ts`

Canonical behavior:

- The lobby card/deck is not the owner of the Video Date lifecycle.
- The lobby observes backend truth and routes to Ready Gate or Date only when the server state is routeable.
- Legacy Mystery Match/post-date auto-promotion is not part of the golden path.
- Manual-exit and route-owner latches suppress route bouncing after the user leaves or when a date route already owns recovery.

Key checkpoints:

- `event_registrations.queue_status`
- `event_registrations.current_room_id`
- `video_sessions.ready_gate_status`
- `video_sessions.phase`
- `video_sessions.state`

### 2. Ready Gate

Primary files:

- `apps/mobile/components/video-date/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateDailyPrewarm.ts`

Canonical behavior:

- Native Ready Gate checks camera and microphone readiness without prompting before explicit user intent.
- `video_session_mark_ready_v2` is the decisive mark-ready RPC.
- `ready_gate_transition` owns `sync`, `snooze`, and `forfeit`.
- The client does not directly mutate server-owned lifecycle fields.
- Once both users are ready, the native client calls `prepareVideoDateEntry`, which invokes the `daily-room` Edge Function with `action = prepare_date_entry`.
- Native may prewarm Daily locally, but provider entry remains owned by the backend/Edge function contract.

Important variables and latches:

- camera permission result
- microphone permission result
- readiness state
- `mark_ready` idempotency key
- `ready_gate_transition` action/reason
- prepare-entry in-flight latch
- route recovery latch
- native Daily prewarm cache

Failure semantics:

- Retryable prepare failures are reconciled against server truth.
- If backend truth says the session is routeable to date, native navigates to `/date/[id]`.
- Terminal truth exits Ready Gate and avoids creating a new provider entry.

### 3. Date Route Ownership and Bootstrap

Primary file:

- `apps/mobile/app/date/[id].tsx`

Shared controller:

- `shared/videoDate/sessionController.ts`
- `shared/videoDate/types.ts`

Canonical phases:

- `hydrate`
- `ready_gate`
- `preparing_entry`
- `joining`
- `entry`
- `date`
- `reconnecting`
- `parked_remount`
- `ending`
- `survey_required`
- `done`

Controller commands:

- `prepare_entry`
- `mint_daily_token`
- `daily_join`
- `daily_leave`
- `daily_park`
- `mark_daily_joined`
- `mark_remote_seen`
- `start_daily_alive_heartbeat`
- `stop_daily_alive_heartbeat`
- `complete_entry`
- `end_date`
- `refetch_snapshot`
- `confirm_survey_own_row`

Date route ownership behavior:

- The native date route treats server truth as authoritative.
- Route and entry latches prevent the app from bouncing back to lobby/Ready Gate while a valid date pipeline is active.
- Surface ownership is claimed through `claim_video_date_surface`.
- Terminal survey truth hard-stops Daily and opens the post-date survey.

Important native refs/state:

- current session id
- current user id
- event id
- participant ids
- latest backend route decision
- local phase
- `activeDailyIdentityRef`
- `activeProviderSessionIdRef`
- `activeEntryAttemptIdRef`
- `activeCallInstanceIdRef`
- `dateEstablishedRef`
- `surfaceClaimRef`
- `openedSurveyRef`
- `terminalSurveyRecoveryRef`
- prepared entry handoff
- token expiry and refresh refs
- remote participant refs
- first playable remote media refs
- call cleanup/parked remount refs

### 4. Provider Entry and Daily Join

Primary files:

- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDate/useNativeVideoDateStartCall.ts`
- `apps/mobile/lib/videoDateTokenRefresh.ts`
- `apps/mobile/lib/videoDateDailyMediaConfig.ts`
- `apps/mobile/lib/videoDateDailyPrewarm.ts`
- `supabase/functions/daily-room/index.ts`

Backend entry path:

- Client calls `getDailyRoomToken(...)`.
- `getDailyRoomToken(...)` invokes Edge Function `daily-room`.
- The only public date-entry action is `prepare_date_entry`.
- The Edge Function calls `video_date_transition(session, 'prepare_entry', ...)`.
- The Edge Function verifies or creates the deterministic Daily room.
- The Edge Function calls `confirm_video_date_entry_prepared`.
- The Edge Function mints a Daily meeting token and returns provider proof.

Native join path:

- Native checks media permissions.
- Native consumes prepared entry or requests a fresh provider token.
- Native creates/uses the Daily call object.
- Native joins the room.
- Native records joined truth with `mark_video_date_daily_joined`.
- Native starts the alive heartbeat with `mark_video_date_daily_alive`.
- Native observes remote participants and remote media evidence.

Critical invariants:

- `video_date_transition('enter_handshake')` is rejected as standalone.
- `prepare_entry` is the lifecycle entry point.
- Daily room/token creation alone is not enough to prove date start.
- The server requires current provider proof before accepting joined/alive/remote-seen stamps.

### 5. Daily Alive and Remote-Seen Proof

Primary files:

- `apps/mobile/lib/videoDate/useNativeDailyAliveHeartbeat.ts`
- `apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts`
- `shared/matching/videoDateRemoteSeenEvidence.ts`
- `src/hooks/videoCall/useVideoDateRemoteSeen.ts`

Native alive contract:

- The heartbeat only sends while the native Daily call is in `joined-meeting`.
- It requires:
  - session id
  - owner id
  - call instance id
  - provider session id
  - entry attempt id
  - owner state
- It calls `mark_video_date_daily_alive(...)`.
- Missing provider proof is treated as a structured no-op/failure, not as media proof.

Native remote-seen contract:

- Native remote-seen requires render/media evidence, not just a participant object.
- Accepted evidence sources include mounted/playing/first-frame style evidence from the local renderer path.
- The client builds provider-bound RPC args and calls `mark_video_date_remote_seen(...)`.
- If render evidence arrives before provider proof, the client queues bounded retries.
- Retries are bounded and restamping is throttled.
- Terminal survey truth can interrupt remote-seen retry and open survey.

Server remote-seen contract:

- The live `mark_video_date_remote_seen(...)` head contains:
  - render evidence requirement
  - provider presence requirement
  - `in_survey` continuity handling
  - `date_feedback` guard references
  - `post_date_survey` surface references
- This is the right shape: it prevents false date promotion from stale participant rows or snapshots.

### 6. Entry Warm-Up and Date Start

Primary files:

- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/components/video-date/VibeCheckButton.tsx`
- `apps/mobile/components/video-date/IceBreakerCard.tsx`
- `apps/mobile/lib/videoDateApi.ts`

Warm-up behavior:

- Entry/warm-up is a short, quiet first stage before the full date.
- UI may show vibe prompts, pass/continue controls, and blurred/soft media depending on the phase.
- The client records entry decisions through `recordEntryDecision`.
- `recordEntryDecision` persists the decision through `video_date_transition('vibe'|'pass')`.
- UI state is updated only after persisted decision truth.
- `completeEntry` calls `video_date_transition('complete_entry')`.

Server date-start behavior:

- Date start is promoted by server evidence:
  - bilateral provider-backed remote media, or
  - stable provider-overlap media gate
- The client does not locally decide that a date has started.
- `date_started_at` and server phase/state are the authoritative start proof.

### 7. Active Date UI

Primary components:

- `apps/mobile/components/video-date/VideoDateControls.tsx`
- `apps/mobile/components/video-date/ConnectionOverlay.tsx`
- `apps/mobile/components/video-date/ReconnectionOverlay.tsx`
- `apps/mobile/components/video-date/KeepTheVibe.tsx`
- `apps/mobile/components/video-date/InCallSafetySheet.tsx`
- `apps/mobile/components/video-date/PostDateSurvey.tsx`
- `apps/mobile/components/video-date/ReadyGateDiagnosticChecklist.tsx`
- `apps/mobile/components/video-date/ActiveCallBanner.tsx`

Primary active controls:

- profile/partner view
- audio mute/unmute
- camera enable/disable
- camera flip
- leave/end date
- safety/report
- extension request
- vibe question prompt

Important UI contracts:

- Leave/end is destructive and routes through server terminal truth.
- Camera flip is a Daily-local action plus app-message hint/stats watch for peer confirmation.
- Keep-the-vibe extensions use backend extension request contracts.
- Safety/report uses Video Date specific report RPCs with fallback behavior and optional date ending.
- Post-date survey does not optimistically finish until the actor's `date_feedback` row is confirmed.

### 8. Reconnect, Backgrounding, and Remounts

Primary files:

- `apps/mobile/lib/videoDate/useNativeVideoDateCallListeners.ts`
- `apps/mobile/lib/videoDate/useNativeVideoDateCallEndCleanup.ts`
- `apps/mobile/lib/videoDate/useNativeVideoDateStartCall.ts`
- `apps/mobile/app/date/[id].tsx`

Reconnect sources:

- Daily participant left/updated events
- Daily `left-meeting`
- Daily errors
- token expiry/auth failure
- app background/inactive
- route remount
- surface takeover

Native behavior:

- Short transport interruptions enter `reconnecting`.
- A partner-left grace timer gives the remote participant time to return.
- App background/inactive starts a native grace timer.
- Foreground returns reconcile server truth before rejoining or showing terminal UI.
- Parked remount preserves the active call instead of ending it unnecessarily.
- Fatal Daily errors force truth reconciliation and degrade to reconnect or terminal survey based on backend state.

Important timing constants:

- first connect timeout: 25 seconds
- prejoin step timeout: 12 seconds
- native background grace: 12 seconds
- transport reconnect grace: 12 seconds
- Daily alive heartbeat: 3 seconds
- native terminal survey retry delays: `0`, `350`, `900`, `1600` ms
- native prepare-entry retry delays: `700`, `1600` ms
- remote-seen retry delay: 1500 ms

### 9. Ending and Post-Date Survey

Primary files:

- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/components/video-date/PostDateSurvey.tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `supabase/functions/post-date-verdict/index.ts`

Server terminal behavior:

- `endVideoDate(...)` calls `video_date_transition('end', reason)`.
- After a confirmed date, terminal truth should stamp the actor's registration as `in_survey` when that actor lacks feedback.
- `resolve_post_date_next_surface(...)` chooses whether the actor needs survey, lobby, chat, wrap-up, or home.

Native terminal recovery:

- `openNativePostDateSurvey(...)` opens the native survey with session/event/partner context.
- `openNativePostDateSurveyFromTerminalTruth(...)` opens from terminal session truth.
- `recoverNativePostDateSurveyFromInSurveyRegistration(...)` recovers from the actor's `event_registrations.queue_status = in_survey`.
- `confirmNativeTerminalPostDateRecovery(...)` retries terminal truth and uses registration recovery when needed.

Survey submission:

- `PostDateSurvey` submits through `submitVerdictAndCheckMutual`.
- Native uses the shared verdict-confirmation path.
- The Edge wrapper calls `submit_post_date_verdict_v3`.
- The client waits for confirmation that the actor's own `date_feedback` row is visible before advancing.

Current risk:

- The latest run ended with both participants still `in_survey` and no `date_feedback` rows.
- That means the remaining native/Web interoperability proof must focus on survey opening, survey submit, verdict confirmation, outbox behavior, and final route release.

## Backend Contract Inventory

### RPCs

The native flow depends on these live RPC contracts:

- `video_session_mark_ready_v2(p_session_id, p_idempotency_key, p_request_hash)`
- `ready_gate_transition(p_session_id, p_action, p_reason)`
- `video_date_transition(p_session_id, p_action, p_reason)`
- `confirm_video_date_entry_prepared(p_session_id, p_room_name, p_room_url, p_entry_attempt_id)`
- `mark_video_date_daily_joined(p_session_id, p_owner_id, p_call_instance_id, p_provider_session_id, p_entry_attempt_id, p_owner_state)`
- `mark_video_date_daily_alive(p_session_id, p_owner_id, p_call_instance_id, p_provider_session_id, p_entry_attempt_id, p_owner_state)`
- `mark_video_date_remote_seen(p_session_id, p_owner_id, p_call_instance_id, p_provider_session_id, p_entry_attempt_id, p_owner_state, p_evidence_source)`
- `claim_video_date_surface(p_session_id, p_surface, p_client_instance_id, p_takeover, p_ttl_seconds)`
- `release_video_date_surface(...)`
- `resolve_post_date_next_surface(p_session_id)`
- `submit_post_date_verdict_v3(p_session_id, p_liked, p_idempotency_key, p_safety_report, p_request_hash)`
- `video_session_request_extension_v2(...)`

### Edge Functions

Native Video Date touches or depends on:

- `daily-room`
- `video-date-snapshot`
- `video-date-token-refresh`
- `video-date-daily-webhook`
- `post-date-verdict`
- `video-date-outbox-drainer`
- `video-date-deadline-finalizer`
- `video-date-room-cleanup`
- `admin-video-date-ops`

### Live RPC Marker Check

The linked production function heads were inspected with `pg_get_functiondef(...)` marker checks. The current live database has the expected markers:

- `video_date_transition`: contains `prepare_entry`, `enter_handshake` rejection/reference, `in_survey`, `date_feedback`, and `post_date_survey` references.
- `mark_video_date_remote_seen`: contains `REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED`, `provider_presence_required`, `in_survey`, `date_feedback`, and `post_date_survey` references.
- `mark_video_date_daily_alive`: contains `provider_presence_required` and `in_survey` references.
- `mark_video_date_daily_joined`: contains provider presence requirement markers.
- `claim_video_date_surface`: contains `post_date_survey` surface references.
- `submit_post_date_verdict_v3`: contains survey eligibility guard, `date_feedback`, and `post_date_survey` references.
- `resolve_post_date_next_surface`: contains `date_feedback` and `post_date_survey` references.
- `confirm_video_date_entry_prepared`: contains `prepare_entry` markers.

## Database Checkpoints

The golden native flow should be accepted only when these checkpoints align:

1. `video_sessions.ready_gate_status = 'both_ready'`
2. `video_date_transition('prepare_entry')` succeeds through the Edge Function owner
3. `confirm_video_date_entry_prepared` verifies the provider room/entry attempt
4. Daily token is minted and native joins the deterministic room
5. `participant_1_joined_at` and `participant_2_joined_at` are present
6. `mark_video_date_daily_alive` continues with current provider proof
7. `participant_1_remote_seen_at` and `participant_2_remote_seen_at` are present from render/provider proof
8. `stable_bilateral_media_at` or equivalent server date promotion proof is present
9. `date_started_at` is present
10. Date terminal state is reached by timeout/client/extension/explicit end
11. Actor registration is `in_survey` if actor has no feedback
12. `date_feedback` row exists for each participant who completed the survey
13. Survey next-surface resolution releases route/surface ownership without bouncing back to date

## Latest Runtime Evidence

Observed session:

- event: `bb75a47f-bbb8-4a31-8c79-9592e3ae4611`
- video session: `7b0795ed-133d-47ad-a31b-c738e00248b7`
- Daily room: `date-7b0795ed133d47ada31bc738e00248b7`

Live database evidence:

- `ready_gate_status = both_ready`
- `state = ended`
- `phase = ended`
- `ended_reason = ended_from_client`
- `entry_started_at = 2026-06-14T05:36:59.160558Z`
- `date_started_at = 2026-06-14T05:36:59.160558Z`
- `participant_1_joined_at = 2026-06-14T05:36:54.189Z`
- `participant_2_joined_at = 2026-06-14T05:36:54.233Z`
- `participant_1_remote_seen_at = 2026-06-14T05:36:59.061649Z`
- `participant_2_remote_seen_at = 2026-06-14T05:37:18.107262Z`
- `stable_bilateral_media_at = 2026-06-14T05:36:59.107259Z`
- both participant registrations: `queue_status = in_survey`
- `date_feedback`: no rows for the session

Interpretation:

- Daily/provider/media start succeeded.
- Server promotion to date succeeded.
- Terminal end succeeded.
- Survey continuity state was reached.
- Survey completion did not persist.

## UI Risk Register

### R1 - Post-Date Survey Recovery Is The Active Failure Boundary

Evidence:

- Latest run has complete call-start evidence and no feedback rows.
- Both participants remain `in_survey`.

Risk:

- The native route may not always open the survey after terminal truth, or may open it but fail submission/confirmation/release.

Mitigation direction:

- Treat `in_survey` registration as a first-class recovery source on native.
- Keep terminal survey recovery independent of Daily teardown timing.
- Prove by physical iOS/native run through `date_feedback`, not by `in_survey` alone.

### R2 - Local Candidate Source Includes Recovery Logic That Needs Runtime Proof

Evidence:

- The current local native date route includes `recoverNativePostDateSurveyFromInSurveyRegistration(...)` and terminal survey retry logic.
- Static contracts pass.

Risk:

- The code may not yet be deployed to the exact native runtime under test, or may still fail under device timing.

Mitigation direction:

- Deploy/build the exact candidate and repeat the two-user run.
- Capture post-date survey logs and final `date_feedback` rows.

### R3 - Provider/Render Proof Is Strict By Design

Evidence:

- Native and web remote-seen tests pin render-bound evidence.
- Live RPC has render and provider markers.

Risk:

- Under slow provider proof, remote evidence can arrive early and require retries.

Mitigation direction:

- Keep bounded remote-seen retry logic.
- In runtime logs, prove `mark_video_date_remote_seen_provider_pending` drains to a successful stamp rather than leaving the call in warm-up.

### R4 - Backgrounding, Remounts, and Token Refresh Are Fragile Native Edges

Evidence:

- The native route carries explicit app-state, remount parking, token refresh, and reconnect logic.

Risk:

- Physical iOS timing can differ from static tests, especially when Expo/dev-client reloads, app backgrounding, or Daily auth refresh happens near terminal survey.

Mitigation direction:

- Add these as explicit native certification scenarios after the basic two-user survey completion passes.

### R5 - Surface Ownership Prevents Bounces But Can Hide Stale State Bugs

Evidence:

- The route uses surface claims, latches, manual-exit suppression, and survey force routing.

Risk:

- Correct suppression can make a stale `current_room_id` or `in_survey` row look like a UI hang if survey recovery does not open.

Mitigation direction:

- For every stuck date/lobby state, inspect both `video_sessions` and `event_registrations` before judging the UI.

### R6 - Static Tests Are Strong But Not Sufficient

Evidence:

- The full red-flag suite and mobile typecheck pass.
- The latest runtime still lacks feedback rows.

Risk:

- The test suite can prove contracts and prevent regressions, but it cannot prove physical device timing, Daily provider behavior, browser/native interop, or survey persistence in production.

Mitigation direction:

- Keep the hard acceptance bar: fresh production two-user run through persisted `date_feedback`.

## Native Implementation Plan For The Next Execution

This section is the implementation/verification plan to carry out after this investigation.

### Phase 1 - Freeze Candidate And Publish Deliberately

1. Review the existing dirty worktree and separate unrelated changes from Video Date candidate changes.
2. Confirm the native survey recovery patch, remote-seen retry patch, generated type changes, docs, and tests are intended for the same release unit.
3. Run:
   - `npm run test:video-date:red-flags`
   - `npm run typecheck` in `apps/mobile`
   - targeted native parity/terminal survey tests if any file changes after this audit
4. If the release unit is approved, commit and deploy/apply through the normal GitHub/Supabase flow.
5. Verify cloud after deploy:
   - `supabase migration list --linked`
   - `supabase db push --linked --dry-run`
   - `supabase db lint`
   - `supabase db advisors --linked --level error --fail-on error`
   - Edge Function deploy status for changed functions

### Phase 2 - Fresh Production Two-User Runtime

Run a fresh disposable production event with:

- one web user
- one physical iOS native user
- clean logs from browser console/network, Xcode console, and Expo terminal

The pass condition is not call entry. The pass condition is:

- date starts
- date ends
- native survey opens if native lacks feedback
- web survey opens if web lacks feedback
- both users can submit verdict
- `date_feedback` contains expected rows
- final route leaves date/survey without bouncing back

### Phase 3 - Required SQL Evidence Pack

For the runtime session, capture:

```sql
select
  id,
  event_id,
  participant_1_id,
  participant_2_id,
  state,
  phase,
  ready_gate_status,
  entry_started_at,
  date_started_at,
  ended_at,
  ended_reason,
  daily_room_name,
  participant_1_joined_at,
  participant_2_joined_at,
  participant_1_remote_seen_at,
  participant_2_remote_seen_at,
  stable_bilateral_media_at,
  session_seq
from public.video_sessions
where id = '<session_id>'::uuid;
```

```sql
select
  event_id,
  profile_id,
  queue_status,
  current_room_id,
  admission_status,
  ready_gate_suppressed_until,
  ready_gate_suppressed_session_id,
  updated_at
from public.event_registrations
where event_id = '<event_id>'::uuid
  and profile_id in ('<participant_1_id>'::uuid, '<participant_2_id>'::uuid);
```

```sql
select
  session_id,
  user_id,
  target_id,
  liked,
  created_at
from public.date_feedback
where session_id = '<session_id>'::uuid
order by created_at;
```

Also inspect, where present:

- Daily webhook event rows
- provider presence rows
- Video Date outbox rows
- pending verdict rows
- surface claim rows
- event loop observability rows

### Phase 4 - Log Evidence Checklist

From native/Xcode/Expo logs, capture these markers:

- Ready Gate mark-ready start/end
- prepare-entry start/end
- Daily token/room returned with provider session metadata redacted
- Daily `joined-meeting`
- `mark_video_date_daily_joined`
- alive heartbeat success
- first remote participant event
- first render/media evidence source
- `mark_video_date_remote_seen` success or retry drain
- date started/snapshot truth
- end requested/end transition
- terminal survey truth
- in-survey registration recovery, if used
- survey opened
- verdict submitted
- own `date_feedback` row confirmation
- final next-surface route

From web console/network, capture equivalent markers plus post-date verdict request/response and final route.

### Phase 5 - Acceptance Decision

Accept only if:

- both clients reach date with provider/render evidence
- both clients leave/end or timeout cleanly
- both clients can complete post-date survey
- `date_feedback` rows exist for the expected users
- no date route bounce after survey completion
- no unsupported `enter_handshake` or client lifecycle mutation path appears

Reject if:

- either participant remains `in_survey` with no feedback after attempting survey
- survey never opens after terminal truth
- the client advances without own `date_feedback` confirmation
- Daily/provider proof is missing but date still starts
- route ownership suppresses recovery into a blank/stuck state

## Current Conclusion

Native Video Date is no longer blocked at room creation or remote media promotion in the latest observed run. The backend and local contracts show the intended server-owned, evidence-gated flow. The active remaining launch blocker is terminal post-date survey completion on the actual Web/native runtime pair.

The next engineering action should be a targeted runtime verification of the local survey-recovery candidate, with SQL proof of `date_feedback` as the acceptance artifact.
