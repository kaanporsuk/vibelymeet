# Vibely Video Date Success Command Center

Date opened: 2026-06-04  
Owner intent: recover Vibely Video Date end to end, from match through post-date survey completion, across web, native, and mobile.

---

## Why This Document Exists

Vibely Video Date has not had a fully successful production run for over a month: match -> Ready Gate -> Daily room -> live video -> end -> post-date survey completion. Many remediation attempts have been made over many consecutive days. The failure mode has moved over time, which makes isolated fixes and isolated notes dangerous.

This document is the active common-understanding log for Video Date recovery. Every agent, engineer, or assistant working on Video Date must consult this file before changing code and update it after material investigation, code changes, migrations, deployments, manual QA, or newly observed failures.

The goal is not to record optimism. The goal is to preserve evidence, root-cause thinking, decisions, unresolved gaps, and the exact acceptance proof needed before calling Video Date healthy again.

## Operator Brief

The founder/operator brief that opened this document:

> Currently it has been over a month since the last time there was a fully successful Video Date run, from match till survey completion. Despite that we have been working to remedify the feature several hundred times and in many many consecutive days. So please let's start properly documenting everything we do at each and every step.

Working interpretation:

- This is now a recovery program, not a one-off bug fix.
- Every step needs durable documentation because repeated local fixes have not produced a stable production outcome.
- The shared goal is progressive thinking: each investigation should improve the common model of the system, not restart from scratch.

---

## Operating Rule

For any work touching Video Date, Ready Gate, event lobby match handoff, Daily.co room entry, post-date survey, notification outbox, or related Supabase RPCs:

1. Read this document first.
2. Check `docs/active-doc-map.md` for any newly promoted canonical docs.
3. Update this document with:
   - observed symptom and exact user-facing copy,
   - affected session/event IDs where available,
   - relevant console/network/Supabase/Daily evidence,
   - hypothesis and rejected hypotheses,
   - code and migration changes,
   - verification run,
   - what remains unproven.
4. Do not claim the feature is definitively fixed until a fresh end-to-end run proves match -> survey completion.

---

## Current Product Definition Of Success

A successful Video Date run means:

1. Two eligible users in the same live event mutually match.
2. Both are routed to the same Ready Gate session.
3. Each user can mark ready once, in either order, on web or native/mobile.
4. The second ready action transitions the canonical session to `both_ready`.
5. Both users are handed to `/date/:sessionId` or native date route without lobby cycling.
6. Both users enter the same Daily room name and URL.
7. Local and remote media tracks mount for both users.
8. The handshake/date timer follows server truth.
9. Ending the date opens the post-date survey.
10. Survey completion persists and routes the user into the expected next lobby/deck/Ready Gate state.
11. No raw HTTP 500 is emitted from the active hot-path RPCs.
12. Retryable backend contention shows syncing/retrying UX, not stale or changed Ready Gate copy.

---

## Known Recent Failure Pattern

### User-visible symptoms

Recent screenshots and reports showed:

- User reaches the Ready Gate.
- User taps ready.
- UI alternates between "Opening the room...", "Opening your date", "You're both here. Starting gently.", "Keeping the room open...", and back to lobby/Ready Gate.
- In the latest report, the user sees "This Ready Gate changed. Back to browsing." and never reaches a stable Video Date.
- In the subsequent latest report, the user did reach warm-up briefly, then bounced between `/date/:sessionId` and `/ready/:sessionId` while the backend had already moved the encounter to survey-required terminal truth.
- In the latest post-PR #1200 test, the session reached `date` and showed a live date UI, but the peer disappeared after Daily leave events. The session ended survey-eligible, one participant stayed `in_survey`, the other was later overwritten to `offline`, and no `date_feedback` rows were created.
- Older reports showed "Still connecting your date" and repeated Daily sessions for a single attempted date.

### Console/network signals

Observed or reported signals included:

- Earlier: raw HTTP 500 from `video_date_transition`, `claim_video_date_surface`, `mark_video_date_daily_joined`, and Ready Gate/lobby RPCs.
- Later: `video_session_mark_ready_v2` and route-state calls returning retryable/late states that the client rendered as stale Ready Gate.
- Daily/mediasoup-like warnings such as producer not found for `cam-video`, consistent with peers not co-occupying the same Daily room at the same time.
- Very noisy PostHog client rate-limit messages and OneSignal 409s that are distracting but not the primary Video Date handoff cause.

### Important interpretation

Console noise is not the root cause by itself. The recurring root theme is split authority and timing around the handoff: Ready Gate readiness, room metadata, route ownership, Daily presence, and terminal/stale interpretation must all be consistent under contention, remounts, late retries, duplicate tabs, and native/mobile route churn.

---

## 2026-06-04 Recovery Timeline

### 1. Date-room RPC fail-soft wrapper and stuck-room backfill

Migration: `supabase/migrations/20260604093000_video_date_failsoft_date_room_rpcs.sql`

What it addressed:

- Raw 500s from `video_date_transition`, `claim_video_date_surface`, and `mark_video_date_daily_joined`.
- Lock/statement-timeout cascades during `/date` -> lobby -> Ready Gate remount storms.
- Stuck active sessions with `daily_room_name` / `daily_room_url` missing after earlier split-ready paths.

Decision rationale:

- Raw 500s gave clients no structured recovery path and hid the SQLSTATE.
- Fail-soft wrappers allow clients to receive `{ ok:false, retryable:true, sqlstate, message }` for residual backend contention.
- Existing stuck rows needed a bounded NULL-only backfill because code fixes do not repair already-corrupted live rows.

Follow-up correction:

- Migration `20260604094500_video_date_transition_preserve_raise_semantics.sql` restored `video_date_transition` to transparent raise/error behavior because existing web/native callers treat a 200 payload without expected state as terminal. Fail-soft behavior remained appropriate for `claim_video_date_surface` and `mark_video_date_daily_joined`.

### 2. Ready Gate mark-ready hot-path recovery

Migration: `supabase/migrations/20260604103000_ready_gate_mark_ready_hot_path_retry_recovery.sql`

What it addressed:

- `ready_gate_transition('mark_ready')` was still too broad and too vulnerable to stale/retryable command replay.
- Mark-ready needed to be a narrow hot path: persist readiness, derive canonical Daily metadata when both-ready, and enqueue provider work fail-soft.
- The visible "Ready Gate changed" state could appear after retryable contention rather than only true session replacement/staleness.

Decision rationale:

- The ready tap is the user intent that must survive transient lock contention.
- Provider/Daily work should not block or poison the readiness commit.
- Deterministic canonical room metadata belongs in server truth once both users are ready.

### 3. Definitive Ready Gate handoff hardening

Migration: `supabase/migrations/20260604104154_ready_gate_mark_ready_grace_notification_auth.sql`

Client/server files changed in PR #1188 / squash commit `c532dca0ac324d02f0749a25c06097160357fbfb`:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `shared/matching/readyGateDiagnosticCopy.ts`
- `shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/swipe-actions/index.ts`
- `supabase/functions/video-date-outbox-drainer/index.ts`
- `supabase/config.toml`

What it addressed:

- A ready tap that started before expiry can now commit within a short server-side grace window even if the retry lands after nominal expiry.
- `video_session_mark_ready_v2` now standardizes response fields including `hot_path`, `mark_ready_started_at`, `expiry_grace_applied`, and `retryable_command_reopened`.
- Retryable mark-ready failures are rendered as syncing/retrying, not "Ready Gate changed."
- Terminal or expired canonical states cancel Ready Gate retry churn, prewarm, and media handoff work.
- Notification auth failures in the provider outbox are explicitly classified, logged, and health-checked.
- Notification payload identity was normalized so `user_id` remains the recipient and `match_user_id` is the matched profile.

Decision rationale:

- The system must honor real user intent under lock contention. A user who tapped ready before expiry should not be rejected because the database was busy.
- The server must distinguish retryable command contention from true terminal replacement.
- The client must not turn a retryable backend signal into stale UX.
- Push failure should not block Video Date, but it must become visible immediately because native/mobile users depend on notifications and push-driven state awareness.

### 4. Deployment and synchronization

PR: `https://github.com/kaanporsuk/vibelymeet/pull/1188`  
Merged: 2026-06-04 12:25:56 UTC  
Main commit: `c532dca0ac324d02f0749a25c06097160357fbfb`

Supabase DB:

- Migration `20260604104154_ready_gate_mark_ready_grace_notification_auth.sql` applied to project `schdyxcunwcvddlcshwd`.
- Final dry run reported `Remote database is up to date`.

Supabase Edge Functions deployed and verified:

- `send-notification` version `812`, updated `2026-06-04 12:28:36 UTC`.
- `swipe-actions` version `746`, updated `2026-06-04 12:29:19 UTC`.
- `video-date-outbox-drainer` version `45`, updated `2026-06-04 12:33:03 UTC`.

Git:

- Local `main` and `origin/main` both at `c532dca0ac324d02f0749a25c06097160357fbfb`.
- Working tree was clean after merge/deploy verification.
- Feature branch `fix/ready-gate-handoff-hardening` was deleted locally and remotely.

Verification run:

- `npx tsx shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `npx tsx shared/matching/phase2PaymentsDurableNotifications.test.ts`
- `npm run test:google-tls-posture`
- `supabase db push --dry-run`

No web or native build was run during this audit/commit sequence.

### 5. Latest failed two-user web test: Ready Gate succeeded, Daily co-occupancy did not

Evidence captured from screenshots, browser Network/Console pasted text, and Supabase project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `5727a8b5-1526-4230-8b5b-4bde98b4296e`
- Video session: `1592aa53-f011-45ab-bcb4-e2685fe172b9`
- Participants:
  - `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` / Kaan Apple
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` / Direk
- Canonical Daily room returned by mark-ready and webhooks: `date-1592aa53f01145abbcb4e2685fe172b9`

Observed flow:

- `13:48:24.035847Z`: mutual match created the video session.
- `13:48:28.823137Z`: Kaan mark-ready command committed as `ready_a`.
- `13:48:32.154945Z`: Direk mark-ready command committed as `both_ready`; payload included canonical `daily_room_name` and `daily_room_url`, `hot_path`, and provider verify reason `ready_gate_mark_ready_hot_path`.
- Screenshots then showed `Both ready. Connecting you now...`, `/date/1592...` opening, then black/waiting date surfaces, then repeated `Opening the room...`, `Your next date is ready`, lobby fallback, and `This date continued in another tab - closing here.`
- Daily webhooks show Kaan joined at `13:48:36.435Z` and left at `13:48:37.382Z` after `0.943s`.
- Daily webhooks show Direk joined at `13:48:43.490Z` and stayed until `13:50:13.777Z` after `90.284s`.
- Daily webhooks show Kaan rejoined at `13:49:11.368Z` and left at `13:49:12.174Z` after `0.797s`.
- Backend `mark_video_date_daily_joined` started handshake from stale joined evidence before durable co-presence: at `13:48:43.731859Z` it saw both `participant_*_joined_at` values even though Kaan had already left; later handshake evidence moved to Kaan's brief `13:49:11Z` rejoin.
- The final session row ended at `13:52:00.427253Z` with `ended_reason = reconnect_grace_expired`, `date_started_at = null`, both `participant_*_remote_seen_at = null`, and refund status `granted`.

Interpretation:

- Ready Gate hot-path authority worked for this session. The latest failure was not a mark-ready failure.
- Daily provider room creation also worked; provider webhooks prove both users reached the same room name.
- The users did not remain co-present long enough to produce durable remote-media evidence. Kaan's sub-second joins align with the web duplicate-tab branch auto-ending and navigating away on `dupBlocked && callStarted`.
- `useVideoDateDupTabGuard` used a localStorage key scoped only to `sessionId`. In same-browser/same-origin two-account tests, participant A and participant B could evict each other locally even though the backend `video_date_surface_claims` row is correctly scoped per `profile_id`.
- Event lobby registration realtime could call `prepareVideoDateEntry` again while `/date/:sessionId` already owned the entry pipeline, contributing to route/lobby churn and stale "next date" prompts.
- Backend Daily join stamping treated historical `joined_at` as active co-presence even after a Daily `participant.left` webhook. That can start or extend the handshake timer on stale evidence.

Code changes made after this investigation:

- `src/hooks/useVideoDateDupTabGuard.ts`: local duplicate lease is now scoped by `profileId + sessionId`, preserving same-user duplicate protection without making the two participants look like duplicate tabs in a disposable same-browser test.
- `src/pages/VideoDate.tsx`: duplicate-tab conflicts no longer auto-call `endCall("duplicate_tab_lease_blocked")` or auto-navigate to lobby. The takeover UI is shown only after the conflict remains stable for `2.5s`.
- `src/pages/EventLobby.tsx`: lobby prepare-entry handoff now suppresses re-entry when a same-session date-entry pipeline or date navigation claim is already active.
- `supabase/migrations/20260604142017_video_date_active_presence_join_guard.sql`: replaces the private base of the fail-soft `mark_video_date_daily_joined` wrapper so the actor's away stamp is cleared on a real route join and the handshake timer starts only when both participants' latest Daily presence is active.
- Regression contracts updated in `shared/matching/videoDateSurfaceContinuityHardening.test.ts` and `shared/matching/videoDateEndToEndHardening.test.ts`.

Verification run after code changes:

- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/videoDateHandoffOwnershipContract.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npx tsc --noEmit -p tsconfig.app.json`
- `supabase db push --dry-run` showed only `20260604142017_video_date_active_presence_join_guard.sql` pending and completed without applying it before the PR was published.

Deployment and synchronization after PR #1190:

- PR: `https://github.com/kaanporsuk/vibelymeet/pull/1190`
- Source branch: `codex/video-date-active-presence-recovery`
- Branch commit: `978f0ed8c0b98a0931309c4766bed0e4f047c24f`
- Squash merge commit on `main`: `b72e487d65972566e63f508d023cf2e1e886734a`
- Merged: `2026-06-04 14:33:06 UTC`
- Supabase project: `schdyxcunwcvddlcshwd`
- Migration `20260604142017_video_date_active_presence_join_guard.sql` was pushed and applied to Supabase cloud.
- Post-deploy `SUPABASE_NO_TELEMETRY=1 supabase db push --dry-run` returned `Remote database is up to date`.
- Direct Supabase verification confirmed:
  - `migration_applied = true`
  - `active_presence_guard_installed = true`
  - `waiting_observability_installed = true`
- Git alignment after merge:
  - local `main`, `origin/main`, and `origin/HEAD` all pointed at `b72e487d6`.
  - source branch was deleted locally and remotely, then pruned.
  - working tree was clean after the merge/deploy verification.
- PR checks passed:
  - Phase 7 no-go guardrails
  - Phase 8 privacy and media contracts
  - Phase 9 playback/captions/lifecycle contracts
  - Quick golden-path smoke
  - Video-date golden-path smoke
  - Vercel
  - Vercel Preview Comments

Remaining unproven:

- No fresh deployed two-user run has yet proved that both users remain co-present, remote media mounts, date starts, and surveys complete.
- No native/mobile runtime smoke has been run after this patch.

### 6. Latest failed two-user web test: warm-up reached, then a transport flap terminalized the session

Evidence captured from chronological screenshots, Console/Network pasted text, and Supabase project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `5ff63806-4e06-45f1-8391-a7a5bdd1c542`
- Video session: `aac15b03-8de7-45e2-a11b-629cdd9b5b16`
- Canonical Daily room: `date-aac15b038de745e2a11b629cdd9b5b16`

Observed flow:

- Ready Gate was not the final blocker. One `mark_ready` command hit retryable timeout/recovery behavior, then both `mark_ready` commands committed to the same canonical Daily room.
- Daily handoff worked briefly. Both clients joined the room, both produced `remote_seen` evidence, and the warm-up UI appeared.
- During the first seconds of co-presence, Daily emitted a `participant-left` event.
- Web `useVideoCall` treated that provider event as partner-away authority immediately and called the backend `mark_reconnect_partner_away` path before the local Daily transport grace could absorb the flap.
- Backend ended the session at `2026-06-04 15:06:41.574871+00` with `ended_reason = reconnect_grace_expired`.
- Backend correctly set both event registrations to `in_survey`, but clients kept mounting `/date/:sessionId` and `/ready/:sessionId`, claiming surfaces, retrying Daily work, polling optional reads, and later emitted a false `peer_missing_terminal`.
- Console 500s during the churn were amplifiers, not the root cause: optional/read/recovery calls should stop once terminal survey truth is known and must not block survey recovery.

Interpretation:

- The recovery problem has moved past Ready Gate handoff and past first Daily entry. The current primary failure is post-handoff warm-up stability plus terminal-survey recovery.
- A raw Daily `participant-left` is not enough evidence to start backend absence grace during the first local transport window. It can be a transient Daily/media transport flap while the peer is already on the way back.
- Once server truth says an encounter ended with survey-required evidence, `/date/:sessionId` must become the survey host immediately and synchronously stop Daily start/retry, surface claim, reconnect, broadcast, foreground, and peer-wait loops.

Code changes made after this investigation:

- `src/hooks/useVideoCall.ts`: Daily `participant-left` now starts the local 12s transport grace and defers `onPartnerLeft` until that grace expires. Remote participant return, participant update, or fresh remote frame clears the pending away mark. The first-remote watchdog now refetches server truth before showing terminal peer-missing UI. Current invariant: survey-required terminal truth suppresses peer-missing and opens survey; historical remote-seen/encounter proof does not prove the peer is currently present.
- `src/hooks/useReconnection.ts`: `mark_reconnect_partner_away` now sends `p_reason: "daily_transport_grace_expired"`, preserving backend reconnect semantics only after local transport grace has expired.
- `src/pages/VideoDate.tsx`: terminal survey recovery is a hard stop. Survey-required terminal truth clears handshake/reconnect state, stops Daily and surface churn, opens `PostDateSurvey`, and treats optional profile/observability/verdict fetch failures as non-blocking unless completed feedback already exists.
- `src/pages/ReadyRedirect.tsx`: `go_survey` and canonical survey decisions navigate to `/date/:sessionId` with `forceSurvey` route state so `VideoDate` opens survey instead of trying to restart the call.
- `apps/mobile/app/date/[id].tsx` and `apps/mobile/lib/videoDateApi.ts`: native Daily `participant-left` now uses the same local grace before backend away marking, passes the explicit `daily_transport_grace_expired` reason, and follows the same peer-missing invariant as web.
- `shared/observability/videoDateClientStuckObservability.ts`: added peer-missing survey/legacy diagnostic event names and safe payload fields for same-session Daily continuity, singleton parking, truth refresh attempts, and historical remote-seen truth.
- `supabase/migrations/20260604170438_video_date_warmup_reconnect_stability.sql`: wraps `video_date_transition` without changing the public signature. Legacy/null immediate `mark_reconnect_partner_away` calls are suppressed during early warm-up when recent bilateral joined, remote-seen, or handshake evidence exists. Explicit `p_reason = "daily_transport_grace_expired"` delegates to the base transition and still starts backend reconnect grace. The migration also allows the new suppressed peer-missing observability events.

Verification run after code changes:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateSprint1RouteDecisionContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npm run typecheck:core`
- `cd apps/mobile && npm run typecheck`
- `npx tsc --noEmit -p tsconfig.app.json`
- `npm run lint`
- `SUPABASE_NO_TELEMETRY=1 supabase db push --dry-run --linked`
- `SUPABASE_NO_TELEMETRY=1 supabase db push --linked --yes`
- `SUPABASE_NO_TELEMETRY=1 supabase db push --dry-run --linked`
- `SUPABASE_NO_TELEMETRY=1 supabase db query --linked -o json ...`

Deployment and synchronization state:

- Supabase migration `20260604170438_video_date_warmup_reconnect_stability.sql` is applied to project `schdyxcunwcvddlcshwd`.
- Post-push dry-run returned `Remote database is up to date`.
- Direct catalog verification returned:
  - `migration_applied = true`
  - `transition_wrapper_installed = true`
  - `transition_base_preserved = true`
  - `stuck_observability_installed = true`
- No Edge Functions changed in this patch, so no Edge Function deployment was required.
- PR: `https://github.com/kaanporsuk/vibelymeet/pull/1192`
- Source branch: `fix/video-date-warmup-stability`
- Branch commit before squash merge: `ed75b90a99d34ff8b25d729edc90eb3cef738437`
- Squash merge commit on `main`: `b2a4a10ce22c2f4950b94fa6b9e49aa235c6c7fa`
- Merged: `2026-06-04 17:44:30 UTC`
- Source branch was deleted on GitHub by the PR merge and is no longer present locally after sync.

Remaining unproven:

- No fresh deployed two-user run has yet proved stable warm-up, visible remote media through the full warm-up, date continuation/end, and survey completion.
- The simulated short Daily leave/rejoin under 12s has not yet been run manually after deployment.
- Native/mobile has static parity and typecheck coverage, but still needs runtime smoke.

### 7. Latest failed two-user web test: repeated Daily rebuild, stale presence, and false lifecycle away authority

Evidence source: chronological screenshots, Console/Network pasted text, and Supabase investigation from the latest two-user test.

Identifiers:

- Event: `fba940f5-b219-4f10-a046-84e86bc8cfff`
- Video session: `83e88141-ebab-4254-869a-c69db7bdb107`
- Canonical Daily room: `date-83e88141ebab4254869ac69db7bdb107`

Observed flow:

- Ready Gate and canonical Daily room handoff succeeded.
- The failing side repeatedly entered and left the same Daily room during the first minute while the other side remained longer.
- The users did not intentionally leave the screen, switch tabs, or background the browser.
- Client/network evidence showed repeated `/date` work, surface claims, Daily joins, and recovery calls during the same session.
- Backend presence was not latest-state safe enough: old `participant_*_joined_at` evidence could remain authoritative after newer leave/away evidence, and reconnect grace was not reliably cleared by later return evidence.
- A soft browser lifecycle signal such as `web_visibilitychange` could still mark self away even while Daily was joining/joined.
- Backend eventually ended with `reconnect_grace_expired`, even though the intended behavior for a short Daily transport/rebuild flap is local recovery first, backend grace only after confirmed local absence, and grace cancellation on real return.

Interpretation:

- The current failure is not a Ready Gate readiness failure and not a missing Daily room.
- The precise failure chain is: duplicate/repeated Daily start/rebuild on one side -> provider join/leave flapping -> stale/first-join backend presence -> reconnect grace not cleared on later join/return -> soft lifecycle away over-authority -> terminalization despite both users staying in the intended flow.
- `remote_seen` observability is useful evidence, but canonical DB remote-seen repair must succeed or retry because terminal eligibility and recovery must use canonical truth.

Code changes in this branch:

- `src/hooks/useVideoCall.ts`
  - Exposes `dailyMeetingState` and `localInDailyRoom`.
  - Reuses an existing nonterminal same-session Daily call instead of calling `leave()`/`destroy()` and rebuilding.
  - Converts `daily_call_busy` into an internal wait/retry path before surfacing a failure.
  - Emits append-only cleanup/reuse/busy diagnostics with room, caller, reason, meeting state, and leave/destroy flags.
  - Keeps Daily `participant-left` behind local transport grace and retries canonical `mark_video_date_remote_seen`, with a persisted diagnostic if canonical repair exhausts.
- `src/pages/VideoDate.tsx`
  - Treats `visibilitychange` as soft telemetry while Daily is joining/joined or the date is in handoff/handshake/date.
  - Keeps hard exits (`beforeunload`, non-persisted `pagehide`) authoritative.
  - Adds a terminal survey hard-stop bridge that actively tears down Daily once survey-required terminal truth is found, even if the recovery path fires before the hook callback is attached.
- `apps/mobile/app/date/[id].tsx`
  - Native background now waits until native background grace expiry before sending backend leave/away, while still cleaning local Daily resources.
- `shared/observability/videoDateClientStuckObservability.ts`
  - Adds append-only diagnostic event names and safe fields for Daily cleanup/reuse/busy and canonical remote-seen repair failure.
- `supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql`
  - Replaces the fail-soft `mark_video_date_daily_joined` base so joined timestamps advance to latest join, own away state clears, and reconnect grace clears on return.
  - Wraps Daily webhook recording so provider joins advance latest joined time and clear reconnect grace when the join proves return; stale provider leaves cannot override newer joins.
  - Wraps `video_date_transition` so soft lifecycle `mark_reconnect_self_away` is suppressed while the actor has active Daily presence, while explicit `daily_transport_grace_expired` remains the legitimate partner-away path through the existing warm-up wrapper.
  - Replaces reconnect-grace expiry so it rechecks latest presence and suppresses terminalization when newer joined or remote-seen-after-away evidence proves return.
  - Makes cleanup/reuse/busy/remote-seen repair diagnostics append-only while preserving dedupe for older stuck-state events.
- `supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql`
  - Replaces `mark_video_date_remote_seen` so canonical `participant_*_remote_seen_at` advances on every remote-media observation instead of preserving first-seen evidence.
  - Returns and logs `latest_remote_seen_at`, `previous_remote_seen_at`, and `remote_seen_canonical_repaired`, addressing PR #1194 review feedback that reconnect expiry needed current remote-seen proof after a transient leave/return.

Verification run in this branch:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsc --noEmit --pretty false --skipLibCheck`
- `cd apps/mobile && npm run typecheck`
- `npm run typecheck:core`
- `supabase db push --dry-run --linked` showed only `20260604193140_video_date_latest_presence_grace_repair.sql` pending.
- `supabase db push --linked --yes` applied `20260604193140_video_date_latest_presence_grace_repair.sql` to project `schdyxcunwcvddlcshwd`.
- Post-push `supabase db push --dry-run --linked` returned `Remote database is up to date`.
- Direct remote catalog verification confirmed the migration row, latest-presence helper, `video_date_transition`, `record_video_date_daily_webhook_event_v2`, `record_video_date_client_stuck_observability`, and append-only stuck-state index predicate.
- A follow-up review fix added and applied `20260604205645_video_date_remote_seen_latest_state.sql`; post-push dry-run returned `Remote database is up to date`, and direct catalog verification confirmed both migration rows plus latest-state `mark_video_date_remote_seen` payload fields.
- `supabase db advisors --linked --type all --level error --fail-on error`

Verification not available in this workspace:

- `supabase db lint --local --fail-on error` could not run because local Postgres at `127.0.0.1:54322` is not running and Docker is not installed.

Remaining unproven:

- No fresh deployed two-user run has proven the new single-owned Daily start and latest-state reconnect behavior.
- A short simulated Daily transport flap under 12s still needs production verification.
- A real prolonged absence still needs verification to prove terminalization remains intact.
- Native/mobile runtime smoke still needs physical-device validation.

### 8. Superseded sync state after ultimate stabilization rollout

Evidence source: direct Git, GitHub, Vercel, and Supabase verification after PR #1194 and the final documentation follow-up.

Superseded code/deploy baseline at that point:

- PR #1194: `https://github.com/kaanporsuk/vibelymeet/pull/1194`
- PR #1194 squash commit: `0a160cd975d87cd756e9c399e748810508f005cb`
- PR #1195 final documentation follow-up: `https://github.com/kaanporsuk/vibelymeet/pull/1195`
- App `main` / `origin/main` at that point: `d2c912c873cd3c119b2296a507d5c4b05007f8a9`
- Parent workspace gitlink commit: `a50175961b64b5ec18fb5a0f5b3c7d3759ac5193`; this parent repo has no remote configured, so only the nested app repo is GitHub-pushable.
- Production Vercel status for that app commit: success, deployment URL `https://vercel.com/okp805/vibelymeet/2W87s4V56hNCz16snCNhaPkrm89X`.
- Source branches `fix/video-date-ultimate-stabilization` and `docs/video-date-ultimate-rollout-final` were deleted locally and remotely.

Supabase cloud baseline:

- Linked project: `schdyxcunwcvddlcshwd`
- `supabase db push --dry-run --linked` returned `Remote database is up to date`.
- `supabase migration list --linked` showed local and remote both include `20260604193140` and `20260604205645`.
- Direct catalog verification returned true for:
  - `20260604193140_video_date_latest_presence_grace_repair.sql`
  - `20260604205645_video_date_remote_seen_latest_state.sql`
  - latest-presence helper installation
  - canonical remote-seen latest-state repair
  - public transition soft lifecycle suppression
  - transition chain partner-away local-grace semantics
  - reconnect-grace expiry latest-presence recheck
- `supabase db advisors --linked --type all --level error --fail-on error` returned no issues.

Important boundary:

- This confirms code, migrations, and deployment alignment. It still does not prove product recovery.
- The next decisive proof remains a fresh disposable two-user production run from mutual match through survey completion, plus short-flap and real-prolonged-absence checks.

### 9. Final sync state after confirmed-encounter deadline rescue rollout

Evidence source: direct Git, GitHub, and Supabase verification after PR #1199.

Current code/deploy baseline:

- PR #1199: `https://github.com/kaanporsuk/vibelymeet/pull/1199`
- PR #1199 merge commit: `ebe4690467b7956511338d94c5847b88889cd1a8`
- PR #1196 recovery hardening commit: `359fa5c42bd5fcdefef9a8a1fca9396d96194f4f`
- PR #1194 squash commit: `0a160cd975d87cd756e9c399e748810508f005cb`
- Current app `main` / `origin/main`: `ebe4690467b7956511338d94c5847b88889cd1a8`
- Source branch `codex/video-date-confirmed-encounter-rescue` was deleted on GitHub and pruned locally.

Supabase cloud baseline:

- Linked project: `schdyxcunwcvddlcshwd`
- `supabase db push --linked` applied `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`.
- `supabase migration list --linked` showed local and remote aligned through `20260605085010`.
- `supabase db push --linked --dry-run` returned `Remote database is up to date`.
- Direct live function verification confirmed `finalize_video_date_handshake_deadline(...)` has `has_confirmed_encounter_rescue=true`, `has_positive_extension_v2=true`, `wraps_20260605085010_base=true`, and `old_least_pattern_position=0`.
- `supabase db lint --linked --level warning --fail-on none` completed after rerunning with telemetry disabled; it reported existing unrelated warnings and no new overlong identifier from the rescue migration.

Important boundary:

- This confirms code, migration, and cloud alignment for the latest rescue. It still does not prove product recovery.
- The next decisive proof remains a fresh disposable two-user production run from mutual match through survey completion, plus short-flap and real-prolonged-absence checks.

### 10. Latest failed two-user production audit: confirmed encounter existed, but the date never stabilized

Evidence source: chronological screenshots, Console/Network pasted text, local source review, and read-only Supabase CLI queries against project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `5dd6716f-b18b-40b1-b238-21d4eb1bf1d5`
- Video session: `d38e4c62-3cf9-4c98-b6a5-b37b2fe36ef3`
- Participants:
  - `267aa05e-0802-4b87-9a7b-ff78b97fdfa7`
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`
- Canonical Daily room: `date-d38e4c623cf94c98b6a5b37b2fe36ef3`

Observed user/browser flow:

- The browser entered `/date/d38e4c62-3cf9-4c98-b6a5-b37b2fe36ef3` and repeatedly showed "Opening your date."
- The UI then alternated through "Still connecting your date", "Opening the room", a black in-call shell with controls/timer, and "Keeping your date state in sync."
- Network evidence showed the Daily websocket opened, repeated `claim_video_date_surface`, `video_date_transition`, `video-date-snapshot`, `video_sessions` reads, and many `record_video_date_launch_latency_checkpoint` calls.
- Console evidence included opaque 500s for `mark_video_date_daily_joined`, `record_video_date_launch_latency_checkpoint`, and `video_session_handshake_auto_promote_v2`; those were amplifiers/observability gaps, not the first boundary failure.
- Console also showed Daily call-object warnings and a non-video OneSignal CSP image violation for `https://img.onesignal.com/...`, which should be cleaned separately because it pollutes production diagnostics.

Supabase timeline:

- `10:30:48.885857Z`: match created the session.
- `10:30:51.311016Z`: participant 2 committed `mark_ready` as `ready_b`.
- `10:30:56.028410Z`: participant 1 committed `mark_ready` as `both_ready`; payload returned the canonical Daily room URL/name, `hot_path=true`, and `retryable_command_reopened=false`.
- `10:30:57.690724Z` and `10:30:58.209702Z`: `confirm_prepare_entry_prepared` recorded `room_metadata_persisted=true`.
- `10:30:59.183Z`: participant 1 joined the Daily room according to webhook `3793`.
- `10:31:01.335Z`: participant 2 joined the same Daily room according to webhook `3794`.
- `10:31:10.377441Z`: backend started the handshake after active Daily co-presence.
- `10:31:11.425544Z`: canonical remote-seen repair recorded `confirmed_encounter=true`.
- `10:31:15.392304Z`: first remote frame evidence was recorded.
- `10:31:48.723648Z`: `remote_readable` was recorded from `progressive_blur_complete`.
- `10:31:36.802Z` / processed `10:31:41.658099Z`: participant 1 left Daily.
- `10:31:38.533Z` / processed `10:31:46.296816Z`: participant 1 rejoined Daily.
- `10:32:26.857Z` / processed `10:32:41.775670Z`: participant 1 left Daily again.
- `10:32:42.235Z` / processed `10:33:44.984002Z`: participant 2 left Daily.
- `10:34:00.555980Z`: deadline cleanup extended the handshake by launch evidence instead of promoting to `date`.
- `10:36:00.217291Z`: the session ended as `handshake_timeout`, `survey_required=true`, `date_started_at=null`, registrations moved to `in_survey`, and no `date_feedback` rows were present.

Important final row facts:

- Final `state` / `phase`: `ended`
- `ended_reason`: `handshake_timeout`
- `date_started_at`: `null`
- `daily_room_name` / `daily_room_url`: `null` on the final row despite canonical room metadata being returned by `mark_ready` and `room_metadata_persisted=true` during prepare-entry.
- `participant_1_remote_seen_at`: `2026-06-05T10:31:40.856601Z`
- `participant_2_remote_seen_at`: `2026-06-05T10:32:01.410506Z`
- `participant_1_away_at`, `participant_2_away_at`, and `reconnect_grace_ends_at`: `null` in the final row.
- `date_feedback`: no rows.

Expected vs actual:

- Ready Gate: expected both users to commit readiness once and receive the same canonical room. Actual matched expectation.
- Daily room creation: expected both users to join the same room. Actual matched expectation.
- Date route ownership: expected the route handoff to keep one stable Daily call object per user while React route/state churn settles. Actual diverged: observability recorded 18 `daily_call_cleanup` events from `useVideoCall.unmount` during `handshake`, including `joining-meeting` and `joined-meeting` states.
- Daily singleton preservation: expected a same-session live remount to park/reuse without provider leave/destroy. Actual diagnostics showed `leave_called=false` and `destroy_called=false`, but no effective `parked_singleton`/reuse outcome prevented provider join/leave churn.
- Media confirmation: expected bilateral remote-seen/first-frame/readable evidence to promote the session into `date` or keep a stable warm-up until promotion. Actual diverged: `confirmed_encounter=true` was recorded by `10:31:11Z`, but `date_started_at` stayed null.
- Deadline rescue: expected the confirmed-encounter rescue to prevent false `handshake_timeout`. Actual rescue ran too late; by deadline cleanup, provider left events had already emptied the room, so the server extended once and later ended survey-required.
- Terminal survey: expected survey-required terminal truth to open and complete the survey. Actual backend moved both registrations to `in_survey`, but no feedback row was persisted in this test.

Root-cause assessment:

- Primary client root cause: web Daily lifecycle ownership is still too sensitive to React hook/component churn. `src/hooks/useVideoCall.ts` calls cleanup from a `useEffect` whose dependency is `cleanupCallObject`; when that callback identity changes, React can run the cleanup while the user is still on the intended `/date/:sessionId` flow. This exactly matches the `useVideoCall.unmount` diagnostics during active Daily states.
- Primary server root cause: promotion is too delayed. `video_session_handshake_auto_promote_v2` still waits for the 60-second handshake deadline before promoting, even when `video_date_session_has_confirmed_encounter(...)` is already true. This leaves the product in a long fragile handshake window after bilateral media evidence exists.
- Deadline-rescue limitation: `finalize_video_date_handshake_deadline` can promote an active confirmed encounter at the deadline, but this test shows that deadline is not early enough. By the time cleanup ran, provider leave rows had already been processed, so the active room had been lost.
- Room metadata integrity gap: canonical room metadata existed in command payloads and prepare-entry evidence, but the final `video_sessions` row had `daily_room_name`/`daily_room_url` null. This must be treated as an invariant failure until explained or repaired.
- RPC observability gap: the client still surfaces raw 500s for key RPCs during handoff. These should be structured, retry-classified responses with `sqlstate`, `message`, `retryable`, and source RPC name so the UI can back off without tearing down Daily.

Scoped next-change plan from this audit:

- Web: make the `useVideoCall.unmount` cleanup mount-stable. Use a ref-backed cleanup function or stable-event helper so callback identity churn cannot trigger a live Daily cleanup. During same-session `handshake`/`date`, unmount cleanup should park or no-op if the current route/session still owns the date handoff.
- Web: latch same-session Daily continuity eligibility once Daily join starts, rather than recomputing it from transient render state. The cleanup diagnostic must always include `dailyCallSingletonEligible`, `willParkSingleton`, `parked_singleton`, and the final reuse/park/destroy outcome.
- Web: treat `external_call_busy` for the same session/room as a reuse/wait path before showing "Still connecting your date"; surface blocking UI only for different room/session or after bounded same-session recovery fails.
- Server: add an early confirmed-encounter promotion path from `mark_video_date_remote_seen` and/or `video_session_handshake_auto_promote_v2`. Once both users have joined and both have canonical remote-seen evidence, and neither user has explicitly passed, promote to `date` immediately rather than waiting for the 60-second deadline.
- Server: keep the deadline rescue as a fallback, but add diagnostics that record `confirmed_encounter`, `active_confirmed_encounter`, away timestamps, latest joined/remote-seen evidence, latest provider leave/join, and the exact branch selected.
- Server: enforce canonical room metadata persistence as an invariant. A both-ready/session with a deterministic room must not end with null `daily_room_name` unless the row is intentionally anonymized, and recovery helpers should repair both active and terminal rows.
- Web/native/mobile: treat confirmed server `date` promotion as the single warm-up/date-start source of truth; avoid resetting warm-up timers or restarting Daily after a positive promotion/extension response.
- Native/mobile: preserve the existing native prejoin cleanup guard, but align the product invariant with web: transient navigation/focus/app lifecycle must not mark a failed date or tear down recoverable server state before grace expires or terminal truth arrives.
- Observability/UX cleanup: add `https://img.onesignal.com` to CSP `img-src` separately, and ensure all handoff RPC failures return structured payloads instead of opaque browser 500s.

Boundary:

- This was an audit/investigation pass only. No code changes, migrations, deploys, web build, or native build were run.
- The product remains unproven. The required proof is still a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> post-date survey opens and completes.

### 11. Implemented confirmed-encounter stability patch after session `d38e4c62`

Evidence source: local code changes, focused contract/type/lint verification, and Supabase cloud apply to linked project `schdyxcunwcvddlcshwd`.

Implementation branch:

- Branch: `codex/video-date-confirmed-encounter-stability`
- PR: `https://github.com/kaanporsuk/vibelymeet/pull/1200`
- PR #1200 merge commit: `fbca4996a096273914ee650b556ba7994477aa5e`
- New Supabase migration: `20260605115657_video_date_early_confirmed_encounter_promotion.sql`
- Cloud apply: `supabase db push --linked --yes` applied `20260605115657` successfully.
- Post-apply remote check: `supabase migration list --linked` showed local/remote alignment through `20260605115657`.
- Post-apply remote lint: `supabase db lint --linked --schema public --fail-on error` completed with no error-level issues; it reported existing unrelated warning-level issues and pre-existing identifier-truncation notices from older migrations.

What changed:

- Web Daily lifecycle now uses a ref-backed unmount cleanup, so `cleanupCallObject` callback identity churn cannot trigger `useVideoCall.unmount` cleanup while the date route is still actively settling.
- Web same-session Daily continuity now latches once start/join begins (`start_call_requested`, active truth, call object attached, join started, join success). Cleanup eligibility no longer depends only on transient `dailyCallSingletonEligible` render props.
- Parked same-session Daily cleanup preserves active session continuity metadata and avoids resetting the hook's connection/reconnect/media state on the parked path.
- Supabase now has a shared `video_date_promote_confirmed_encounter_v1(...)` helper. It promotes an active `handshake` to `date` immediately when both participants have joined, both have canonical `remote_seen`, neither participant has an explicit pass, both have not already decided, and neither side has a newer away timestamp than their latest join/remote evidence.
- `mark_video_date_remote_seen` now delegates to that helper after stamping remote media, so the second canonical remote-seen proof can start the date without waiting for the 60s deadline.
- `video_session_handshake_auto_promote_v2` now checks the same helper before delegating to the older deadline-gated command wrapper, so confirmed bilateral media bypasses `handshake_auto_promote_not_due`.
- `finalize_video_date_handshake_deadline` still delegates to the PR #1199 deadline rescue as fallback, but now checks the same early promotion helper first and restores canonical room metadata after the fallback path.
- CSP now allows `https://img.onesignal.com` in `img-src` to remove a noisy non-Daily console violation from production debugging.

Expected behavior after this patch:

- If both users reach the same Daily room and both clients/provider surfaces produce canonical remote-seen evidence, server truth should move to `state=date`, `phase=date`, and non-null `date_started_at` immediately.
- A later handshake finalizer should be fallback-only, not the primary date-start path after confirmed bilateral media.
- A React remount/state-churn event during the same `/date/:sessionId` handoff should park/reuse the live Daily call rather than leave/destroy/recreate it.
- Terminal rows should retain or restore deterministic Daily room metadata for operator forensics and survey recovery.

Verification run, with no web or native build triggered:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateInstantPremiumV2Contracts.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`
- `npx tsx shared/matching/videoDatePhase3RemainingContracts.test.ts`
- `npm run typecheck:core`
- `npx eslint src/hooks/useVideoCall.ts shared/matching/videoDateWarmupStabilityContracts.test.ts shared/matching/videoDateInstantPremiumV2Contracts.test.ts shared/matching/videoDateDefinitiveHandoffRecovery.test.ts shared/matching/videoDatePhase3RemainingContracts.test.ts`
- `supabase db push --linked --dry-run`
- `supabase db push --linked --yes`
- `supabase migration list --linked`
- `supabase db lint --linked --schema public --fail-on error`
- Live catalog/function marker query confirmed `migration_applied=true`, `mark_remote_seen_wraps_helper=true`, `mark_remote_seen_returns_flag=true`, `auto_promote_checks_helper=true`, `auto_promote_delegates_base=true`, `finalizer_delegates_base=true`, `finalizer_repairs_room_after_base=true`, `helper_records_confirmed_event=true`, and `helper_sets_date_state=true`.

Boundary:

- This is still not acceptance proof. The decisive proof remains a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> post-date survey opens and completes.
- If the next run fails, first inspect whether `mark_video_date_remote_seen` or `video_session_handshake_auto_promote_v2` returned `early_confirmed_encounter_promoted=true`, whether `confirmed_encounter_promoted_to_date` appears in `video_session_events` / `event_loop_observability_events`, and whether web cleanup rows show `same_session_daily_continuity_latched=true` with `parked_singleton=true`.

### 12. Final sync after PR #1200 confirmed-encounter stability merge

Evidence source: GitHub PR status, local Git sync, and Supabase remote checks after merging PR #1200.

Current code/cloud state:

- PR #1200: `https://github.com/kaanporsuk/vibelymeet/pull/1200`
- PR #1200 merge commit: `fbca4996a096273914ee650b556ba7994477aa5e`
- Source branch `codex/video-date-confirmed-encounter-stability` was deleted on GitHub and pruned locally.
- Local `main` and `origin/main` aligned at `fbca4996a096273914ee650b556ba7994477aa5e` immediately after the PR #1200 merge. A docs-only follow-up may sit on top of this functional baseline; verify current HEAD before quoting it.
- Supabase project `schdyxcunwcvddlcshwd` stayed aligned through `20260605115657`, and `supabase db push --linked --dry-run` reported `Remote database is up to date`.
- `supabase db lint --linked --schema public --fail-on error` completed with no error-level issues; only existing unrelated warning-level issues and older identifier-truncation notices were reported.
- Live function marker verification confirmed the migration row, early-promotion helper, `mark_video_date_remote_seen` wrapper, `video_session_handshake_auto_promote_v2` wrapper, deadline finalizer fallback wrapper, post-base room repair, and `confirmed_encounter_promoted_to_date` / `state = date` helper markers are installed.
- PR checks passed before merge: Vercel, Phase 7 no-go guardrails, Phase 8 privacy/media contracts, Phase 9 playback/captions/lifecycle contracts, Quick golden-path smoke, and Video-date golden-path smoke.

Important boundary:

- This still is not manual acceptance proof. The required proof remains a fresh disposable production two-user run from match through survey completion.

### 13. Latest failed test after PR #1200: date started, then terminal survey lifecycle broke

Evidence source: attached chronological screenshots/network panels, local code audit, and live Supabase project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `6c9c647f-242b-463c-8b24-0896f02677e5`
- Video session: `782f5eb6-497f-4fd8-9898-2f47cf939751`
- Canonical Daily room: `date-782f5eb6497f4fd898982f47cf939751`
- Participants: `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` and `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`

Observed Supabase timeline:

- `2026-06-05T13:25:28.016704Z`: participant 2 committed `mark_ready`, session moved to `ready_b`.
- `2026-06-05T13:25:32.046417Z`: participant 1 committed `mark_ready`, session moved to `both_ready`, with Daily room metadata returned.
- `2026-06-05T13:25:47.508Z` and `2026-06-05T13:25:48.257Z`: Daily provider reported both participants joined the same canonical room.
- `2026-06-05T13:25:50.242506Z`: `confirmed_encounter_promoted_to_date` fired, with `date_started_at = 2026-06-05T13:25:51.75678Z`. Ready Gate, room creation, remote-seen, and early date promotion worked.
- `2026-06-05T13:26:27.495401Z` and `2026-06-05T13:26:29.940336Z`: canonical remote-seen evidence existed for both participants.
- `2026-06-05T13:26:48Z` through `13:27:02Z`: Daily provider reported participant 1 left twice and participant 2 left once; the backend reconciled those leaves.
- `2026-06-05T13:28:09.710Z`: only participant 2 rejoined the Daily room. There was no later participant 1 provider join.
- `2026-06-05T13:30:53.723208Z`: `date_timeout` ended the session with `survey_required=true`; `date_feedback` remained empty.
- Final row originally had `date_started_at` and bilateral remote-seen truth, but `daily_room_name` and `daily_room_url` were null. Final registrations diverged: participant 1 remained `in_survey`; participant 2 was later overwritten to `offline` at `2026-06-05T13:35:14.884865Z`.
- Post-fix cloud verification repaired and preserved this terminal row as `daily_room_name=date-782f5eb6497f4fd898982f47cf939751` and `daily_room_url=https://vibelyapp.daily.co/date-782f5eb6497f4fd898982f47cf939751` with `daily_room_provider_verify_reason=canonical_room_metadata_recovered_after_outbox_drainer_v2`. After the cleanup-worker hardening deploy, provider deletion is tracked separately through `daily_room_provider_deleted_at` / `daily_room_provider_delete_reason=room_cleanup:provider_room_deleted` instead of erasing room metadata.

Interpretation:

- The failure boundary moved again. This was not Ready Gate, Daily room creation, remote-seen repair, or confirmed-encounter promotion. The date started.
- Historical remote-seen evidence proved the encounter happened, but did not prove the missing peer was currently present after the provider leave/rejoin sequence. The old peer-missing suppression theory was too broad.
- `date_timeout` was technically survey-eligible, but using the normal timeout reason after a post-encounter peer disappearance made the client wait for the wrong path and left one side vulnerable to `update_participant_status(..., 'offline')` overwriting `in_survey`.
- Terminal forensics were weaker than they should be because `video_session_date_timeout_v2` did not repair/return canonical Daily room metadata after terminal transition/replay, and the old cleanup/outbox workers used null `daily_room_name` / `daily_room_url` as the provider-room-deleted marker.

Implementation plan from this audit:

- Web/native/mobile first-remote watchdogs should suppress peer-missing only for terminal survey truth. Historical encounter proof should log `daily_no_remote_watchdog_historical_truth_requires_current_peer`, surface terminal peer-missing, and then end as a post-encounter absence when date truth exists.
- Web/native/mobile manual peer-missing exits after confirmed encounter truth should call end with `partner_absent_after_confirmed_encounter`, which remains post-date survey eligible.
- `update_participant_status` should keep `in_survey` sticky for survey-eligible ended sessions until that user has a `date_feedback` row. The old 30-second protection window is insufficient.
- `video_session_date_timeout_v2` should repair canonical Daily room metadata for already-ended/replay/post-transition terminal rows and include `daily_room_name` / `daily_room_url` in returned payloads and terminal events.
- Cleanup/outbox workers should never null terminal `daily_room_name` / `daily_room_url`. Provider room deletion must be represented by `daily_room_provider_deleted_at` and `daily_room_provider_delete_reason`, so support/debug forensics stay canonical after Daily provider cleanup.
- Observability must keep the new safe fields needed to tell same-session Daily parking, route ownership, current call object state, truth refresh attempts, and historical remote-seen truth apart.

Implemented and cloud-applied for this section:

- Supabase migration `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql` replaces `update_participant_status` and `video_session_date_timeout_v2` with the sticky-survey and terminal-room-repair behavior above.
- Supabase migration `20260605143637_video_date_terminal_room_metadata_backfill.sql` records the initial helper-loop backfill. It proved the repair path could reconstruct canonical Daily room metadata, but later evidence showed old cleanup workers could re-null the same terminal fields.
- Supabase migration `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql` performs a bounded direct backfill for already-ended, survey-eligible rows with missing/non-canonical Daily metadata.
- Supabase migration `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql` adds `daily_room_provider_deleted_at` and `daily_room_provider_delete_reason`, plus a pending-cleanup partial index, so provider deletion can be tracked without erasing terminal forensics.
- Supabase migrations `20260605145926_video_date_terminal_room_metadata_final_repair.sql` and `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql` re-repair terminal rows after the cleanup worker fix and mark historically provider-deleted rooms.
- Supabase migration `20260605152058_video_date_pending_survey_registration_repair.sql` restores pre-hardening registrations that were already downgraded to `browsing` / `idle` / `offline` while still pointing at an ended survey-eligible session with no feedback.
- Edge Functions `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup` now stamp provider-delete markers instead of nulling `daily_room_name` / `daily_room_url`.
- Live cloud verification after the fixed workers had time to run showed zero remaining ended survey-eligible terminal-room candidates, while the repaired rows still retained canonical `daily_room_name` / `daily_room_url` and had provider-delete markers. Follow-up verification also restored both affected failed-session registrations to `in_survey` with zero feedback rows.
- Web `src/hooks/useVideoCall.ts` and `src/pages/VideoDate.tsx` now enforce current-peer-vs-historical-encounter separation and request `partner_absent_after_confirmed_encounter` after peer-missing terminal UI when date truth exists.
- Native/mobile `apps/mobile/app/date/[id].tsx` now mirrors the web peer-missing and post-encounter absence behavior.
- Shared contracts now pin this incident through `shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`, `shared/matching/videoSessionDailyGate.test.ts`, and updated warm-up/review follow-up tests.

### 14. Latest failed test after single-owner hardening: Ready Gate mark-ready timed out before Daily

Evidence source: attached chronological screenshots/network panels, read-only Supabase investigation, local source review, and Supabase cloud verification for linked project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `21497965-394a-45fe-8700-5d91bf927f65`
- Video session: `cac485cd-da3b-475b-aa4c-27b70cd914d6`
- Participants:
  - `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` / Kaan Apple / participant 1
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` / Direk / participant 2

Observed flow:

- Participant 2 committed Ready Gate readiness at `2026-06-06T07:52:49.519065Z`, moving the session to `ready_b`.
- Participant 1 then attempted `mark_ready`, but repeated `video_session_mark_ready_v2` commands were rejected with SQLSTATE `57014` and `READY_GATE_TRANSITION_TIMEOUT`.
- The browser Network panel showed repeated `ready_gate_transition`, `get_video_date_start_snapshot_v1`, `video_session_mark_ready_v2`, profile/event/session reads, and one visible 500 from `get_video_date_start_snapshot_v1`.
- No `both_ready` row was reached. There was no Daily room metadata, Daily webhook row, surface claim, remote-seen evidence, date start, or feedback row for this session.
- At `2026-06-06T07:53:39.056628Z`, the session expired as `ready_gate_expired`.

Interpretation:

- This failure is distinct from the post-Ready Gate Daily-owner and survey failures. It regressed at the earliest critical intent boundary: the second user's ready tap did not durably write `ready_participant_1_at`.
- Prior mark-ready work still allowed a wrapper/preflight/observability path to consume enough time that the critical ready timestamp was never committed before retry/expires handling.
- The frontend retried explicit retryable payloads, but an RPC transport/PostgREST error could still stop the mark-ready attempt after the first failed call.

Implemented for this section:

- Supabase migration `20260606092944_video_date_decisive_mark_ready_commit.sql` replaces the public `video_session_mark_ready_v2(uuid,text,text)` with one direct decisive hot path.
- Supabase migration `20260606100511_video_date_mark_ready_lint_cleanup.sql` keeps that public function behavior unchanged but removes the unused event-append variable that linked DB lint flagged after the first apply.
- The new hot path begins the idempotent command before locking `video_sessions`, commits the actor's ready timestamp and deterministic `both_ready` Daily room metadata before observability/event/outbox work, and extends `ready_gate_expires_at` to at least `now() + 45 seconds` on every real ready tap.
- Idempotency remains compatible with deployed clients: committed replay returns current DB truth, retryable rejected replay reopens the same command, and stale `processing` commands older than six seconds can be reclaimed.
- Existing `ready_gate_transition('mark_ready')` bridges to the same public RPC, so web, mobile web, native/mobile, and older clients share the same backend behavior.
- Web `src/hooks/useReadyGate.ts` and native/mobile `apps/mobile/lib/readyGateApi.ts` now retry bounded mark-ready RPC errors with the same deterministic idempotency key, in addition to retrying explicit retryable backend payloads.
- New contract `shared/matching/readyGateDecisiveMarkReadyCommit.test.ts` pins the direct backend path, post-commit auxiliary work ordering, idempotency recovery, grants, and web/native RPC-error retry parity. It is wired into `npm run test:video-date-v4`.
- Existing Ready Gate 57014 reliability contracts were made whitespace-tolerant where line wrapping had made assertions brittle without changing product behavior.

Verification after implementation, with no web or native build triggered:

- `npx tsx shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `npx tsx shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `npx tsx shared/matching/videoDatePhase3Contracts.test.ts`
- `npx tsx shared/matching/videoDateStartSnapshotContracts.test.ts`
- `npx tsc --noEmit -p tsconfig.app.json`
- `cd apps/mobile && npm run typecheck`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- live marker query confirmed `decisive_live=true`, `authenticated_execute=true`, and `anon_execute=false` for `video_session_mark_ready_v2(uuid,text,text)`
- no-auth smoke call returned structured `not_authenticated` JSON rather than a raw database error
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked` completed with only pre-existing warnings/notices unrelated to this migration
- post-cleanup live marker query confirmed `unused_event_removed=true`; a second linked DB lint no longer reported `public.video_session_mark_ready_v2`

Boundary:

- This directly addresses the `cac485cd-da3b-475b-aa4c-27b70cd914d6` Ready Gate mark-ready timeout / `ready_b` expiry failure class across all clients that use the shared RPC contract.
- This still is not product-health proof. The fresh disposable two-user production acceptance run remains required from match through survey completion, plus short Daily leave/rejoin under 12 seconds and real prolonged absence terminalization.

### 15. Surface client-identity hardening after route remount audit

Evidence source: attached chronological screenshots/network panels, source review, contract tests, and Supabase linked dry-run/list verification.

Observed risk:

- The UI could enter Ready Gate, `/date/:sessionId`, and Daily, but still show transient "Still connecting your date" / duplicate-owner overlays during route churn.
- Network traces showed repeated `claim_video_date_surface`, `record_heartbeat_v2`, `video_date_transition`, `video-date-snapshot`, and date/session polling while the route remounted.
- Web/native component remounts could create a new server-facing `client_instance_id` for the same user/session while the previous unexpired `video_date` surface claim still existed. That made one logical device look like a duplicate device to the backend.
- A second race existed where stale cleanup could release a fresh remount's surface claim if cleanup only knew the session key, not the specific active owner token.

Design decision:

- Do not solve this by backend same-profile/same-session auto-reclaim. That shortcut would allow a true second browser, mobile web tab, or native device for the same user/session to silently take over and race the original device.
- Keep backend duplicate-device conflict semantics strict: a different `client_instance_id` remains a conflict unless explicit takeover occurs.
- Fix the root cause at the clients by keeping a stable server-facing client identity per user/session and by making cleanup owner-tokened.

Implemented:

- Web `useVideoDateDupTabGuard` now stores a stable server-facing surface client id at `vibely_vd_surface_client:${profileId}:${sessionId}` and sends that id to `claim_video_date_surface` / `release_video_date_surface_claim`.
- Web keeps the tab-local lease owner separate from the server-facing surface client id, so duplicate-tab UX can remain local while the backend sees one stable logical device across remounts.
- Web active surface cleanup is owner-tokened and delayed briefly. It only releases when the cleanup still owns the active marker and no fresh same-client owner has appeared.
- Native/mobile `/date/[id]` mirrors this with `AsyncStorage` key `vibely_vd_native_surface_client:${profileId}:${sessionId}`, stable `vd-native-*` server client ids, owner-tokened active ownership, delayed guarded release, and a hydration gate so native cannot claim with a fallback id and then switch to the persisted id mid-session.
- No new Supabase migration was kept for this pass. A proposed same-session SQL reclaim migration was intentionally deleted after review because it would weaken duplicate-device blocking.

Verification after implementation, with no web or native build run:

- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`
- `npm run typecheck:core`
- `npx tsc --noEmit -p tsconfig.app.json`
- `cd apps/mobile && npm run typecheck`
- `git diff --check -- 'apps/mobile/app/date/[id].tsx' src/hooks/useVideoDateDupTabGuard.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`

Cloud state:

- Linked Supabase dry-run returned `Remote database is up to date`.
- Local/remote migrations stayed aligned through `20260606100511_video_date_mark_ready_lint_cleanup.sql`.
- No additional migration was applied for this client-identity hardening pass.

Boundary:

- This addresses the surface-owner self-conflict/remount-release race across web, mobile web, and native/mobile clients that use the shared surface RPC contract.
- This still is not product-health proof. The fresh disposable two-user production acceptance run remains required from match through survey completion, plus short Daily leave/rejoin under 12 seconds and real prolonged absence terminalization.

---

## Current Architecture Decisions

### Backend owns lifecycle truth

The client should render and retry, not invent lifecycle state. Authoritative truth lives in Supabase-backed session state and RPC responses.

### Mark-ready is a hot path

`video_session_mark_ready_v2` must stay narrow:

- start/recover the idempotent command before taking the session row lock,
- verify participant,
- preserve idempotency,
- persist readiness,
- derive canonical room metadata at both-ready,
- commit the command result before observability, event append, or provider outbox work,
- enqueue provider work fail-soft after readiness is already durable,
- return structured payload.

It must not synchronously create/provider-verify Daily rooms or depend on network/provider latency.

### Daily room metadata must be deterministic

The canonical Daily room for a video session is deterministic (`date-<sessionId-without-dashes>` style, per existing helpers). Missing row metadata must not make the route bounce forever if the canonical room can be derived safely.

### Daily active co-presence is stronger than joined history

`participant_1_joined_at` and `participant_2_joined_at` are latest-state launch evidence, not first-join history. A later Daily `participant.left` / `participant_*_away_at` makes that participant inactive until a newer client/provider join clears the away stamp and clears reconnect grace. `mark_video_date_daily_joined`, Daily webhook repair, reconnect-return, and reconnect-grace expiry must all use the same latest-join-newer-than-away rule.

### Daily start ownership is single-session and nonterminal-call reuse first

For a given `video_session_id`, the client should have one active Daily start pipeline. A same-session, same-room, nonterminal Daily call in `joining` or `joined` state must be reused or waited on, not torn down and rebuilt. Cleanup/rebuild is reserved for terminal, mismatched, or unrecoverable call state and must emit append-only diagnostics.

### Date-route ownership suppresses stale surface bounces

Once `/date/:sessionId` or the native date route owns a same-session active handoff, stale event-lobby or Ready Gate truth must not bounce that client back to `/ready` or lobby while Daily is joining/joined, handshake/date is active, or the same route ownership lease is fresh. Route ownership is client-local and short-lived; terminal survey truth and explicit exits still clear it. Web same-session Daily continuity is not allowed to depend on the optional cross-date warm-handoff feature flag.

### Remote-seen is canonical presence evidence, not only media-element evidence

`mark_video_date_remote_seen` should fire when a remote Daily participant is observed through provider presence, post-join snapshots, shared-call hydration, or mounted media. Media playback events remain valuable first-frame evidence, but canonical `participant_*_remote_seen_at` must not depend solely on a browser/native media element event.

### Historical encounter proof is not current peer presence

`participant_*_remote_seen_at`, `date_started_at`, and confirmed-encounter events prove the date happened and make terminal survey recovery eligible. They do not prove the remote peer is still in the current Daily room after later leave/rejoin churn. First-remote and peer-missing watchdogs may suppress terminal UI only when server truth is already survey-required; otherwise they must treat the peer as currently missing and use post-encounter absence handling when date truth exists.

### Confirmed encounters start the date before deadline fallback

Once both participants have confirmed bilateral remote-media/date-entry evidence and neither side has passed or both-decided, server truth must promote the session to `date` immediately. `mark_video_date_remote_seen` and `video_session_handshake_auto_promote_v2` must both use the shared confirmed-encounter promotion invariant; the handshake deadline finalizer is fallback-only. Deadline cleanup must never end an already confirmed encounter as `handshake_timeout`, and any launch-evidence extension must grant positive remaining time; zero-second extensions are terminal races in disguise.

### Browser lifecycle is not authoritative during handoff

`visibilitychange` is soft telemetry while Daily is joining/joined or while the session is in handoff, handshake, warm-up, or date. It must not call backend `mark_reconnect_self_away`. Hard exits such as real unload and non-persisted pagehide can still send leave signals. Native/mobile background uses local grace first and only sends backend away once the grace expires.

### Daily transport grace precedes backend partner-away authority

A Daily `participant-left` event is first a local transport signal, not immediate canonical absence. Web and native must hold a local 12s Daily transport grace before calling `mark_reconnect_partner_away`. Only the explicit backend reason `daily_transport_grace_expired` should start server reconnect grace. Legacy/null immediate-away calls during fresh warm-up evidence should be suppressed.

### Retryable is not terminal

Any payload with `retryable: true` must keep the user in syncing/retrying posture. "Ready Gate changed" is reserved for true replacement, terminal expiry, or multi-tab handoff.

### Terminal means stop work

Once canonical truth says `ended`, `ready_gate_expired`, forfeited, or replaced, clients must cancel prewarm, permission prewarm, route preload, and Ready Gate retries.

### Survey-required terminal truth is a hard stop

If an ended session has survey-required encounter evidence, `/date/:sessionId` is the survey host. Clients must synchronously stop Daily start/retry, surface claiming, reconnect grace, foreground sync, route/broadcast churn, and peer-missing timers, then open `PostDateSurvey`. Optional profile, observability, and verdict reads are not allowed to block survey entry; only a confirmed completed `date_feedback` row can route away from survey.

### Survey status is sticky until feedback

Client presence writes must not move a participant from `in_survey` to `browsing`, `idle`, or `offline` while a survey-eligible ended session exists for that event/user and the user has no `date_feedback` row. This is not a short grace window; it is a lifecycle invariant.

### Terminal rows retain Daily room forensics

Terminal timeout/replay/already-ended paths must repair deterministic Daily room metadata when possible and return `daily_room_name` / `daily_room_url`. Null terminal room metadata makes later support analysis and room cleanup harder and should be treated as a repairable invariant violation. Daily provider cleanup must stamp `daily_room_provider_deleted_at` / `daily_room_provider_delete_reason` and leave terminal room metadata intact.

### Active video and survey truth owns the route surface

If active session truth says `kind=video`, including `queue_status = in_survey`, `/date/:sessionId` or native `/date/[id]` is the single owner. Lobby and Ready Gate surfaces must yield to that owner, must not run Daily prepare for `in_survey`, and must not reopen stale Ready Gate UI when the same session is already video/survey-owned. Terminal-survey recovery must force navigation past duplicate-navigation/manual-exit suppression on both web and native while preserving same-route no-op protection.

### Exposed lifecycle RPCs are outermost fail-soft

Hot-path browser/native-callable lifecycle RPCs must not leak raw 500s for stale, duplicate, already-terminal, or transient database contention. `claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `get_or_seed_video_session_vibe_questions` are wrapped with outer fail-soft shells that preserve existing base behavior and return retryable JSON with SQLSTATE/message/server time on uncaught errors.

---

## Open Gaps And Risks

These are not claims that the current code is broken; they are the unproven areas that must be validated before declaring recovery complete.

1. **No fresh successful manual E2E proof yet.** The final acceptance run must prove match -> survey completion after the latest deploy.
2. **Production SQLSTATE history is incomplete.** Some earlier fixes were shipped without full log forensics. The newer wrappers should expose future residual SQLSTATE/message, but old failures may remain partly inferred.
3. **Warm-up stability must be observed, not assumed.** Passing requires both users in the same Daily room at the same time, remote tracks mounted, and no backend terminalization from a short provider transport flap.
4. **Static and CI checks passed after the warm-up stabilization patch, but they are not acceptance proof.** The deployed local-grace and terminal-survey hard-stop behavior still needs a real two-user production run.
5. **Native/mobile runtime needs physical-device smoke.** Static parity and contracts are not enough for mobile media permissions, push, Daily transport events, app backgrounding, and route restoration.
6. **Latest-state presence, remote-seen, immediate confirmed-encounter promotion, and deadline fallback rescue migrations are applied, but behavior still needs production proof.** Cloud catalog verification confirms `20260604193140_video_date_latest_presence_grace_repair.sql`, `20260604205645_video_date_remote_seen_latest_state.sql`, `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`, and `20260605115657_video_date_early_confirmed_encounter_promotion.sql`; the next acceptance run must prove they clear grace on return, suppress stale expiry, promote confirmed encounters to `date` immediately after bilateral remote media, and preserve positive launch-evidence extensions in real Daily traffic.
7. **Daily start ownership must be proven under real browser behavior.** Static tests assert same-session reuse, but production must show no same-session `leave()`/`destroy()` churn while joining/joined.
8. **Date-route ownership and live Daily preservation are newly patched, not production-proven.** The next run must show no `/date` <-> `/ready` cycling while a same-session Daily call is joining/joined, and no lobby/Ready Gate surface should prepare Daily or reopen Ready Gate after active `video` / `in_survey` truth exists.
9. **Soft lifecycle suppression must be proven.** The browser should not send `web_visibilitychange` self-away while Daily is active, but hard unload/pagehide should still work.
10. **PostHog rate-limit spam remains noisy.** It is probably not the Video Date root cause, but it can hide useful console signals and should be handled separately.
11. **OneSignal 409 identity noise remains non-blocking but distracting.** It should not block Video Date, but provider health should stay visible.
12. **Manual survey completion still needs proof.** Many recent fixes focused on match -> Ready Gate -> room entry; survey end-to-end persistence must be revalidated.
13. **Post-encounter peer absence needs production proof.** The latest failed test reached `date`, then one peer disappeared. Web/native/mobile now distinguish historical encounter proof from current peer presence and end confirmed peer absence as `partner_absent_after_confirmed_encounter`; a fresh two-user run must prove both users still reach survey.
14. **Sticky survey lifecycle needs production proof.** Cloud function markers prove `update_participant_status` now protects pending survey rows until feedback exists; a fresh run must prove normal web/native/mobile lifecycle writes no longer knock either participant out of survey.
15. **Terminal Daily room repair has cloud data proof, but still needs runtime proof.** Cloud verification restored the failed session and found zero remaining ended survey-eligible rows with missing/non-canonical Daily metadata. A fresh run must prove terminal `date_timeout` and replay/already-ended responses preserve or repair `daily_room_name` / `daily_room_url` naturally.
16. **Lifecycle RPC fail-soft wrappers are cloud-applied but still need runtime proof.** Catalog verification proves the wrappers are installed and call the preserved base implementations, but the next live run must confirm browser/native clients no longer see raw 500s from stale/duplicate/terminal lifecycle calls.
17. **Decisive mark-ready commit is cloud-applied but still needs production proof.** Catalog verification proves `20260606092944_video_date_decisive_mark_ready_commit.sql` and lint cleanup `20260606100511_video_date_mark_ready_lint_cleanup.sql` are live, callable by authenticated clients only, and warning-free in linked lint; the next run must prove both ready taps commit without retry/expiry collapse under real web/native/mobile timing.

---

## Required Acceptance Run

Run this on a fresh disposable test pair after deployment has propagated:

1. Open two distinct browsers, browser profiles, or devices with two test users. If a same-browser disposable test is used, record whether storage/profile context is shared.
2. Register both users into the same live test event.
3. Match them from event lobby.
4. Let one user tap ready first; wait several seconds; then let the second user tap ready.
5. Repeat with reversed order.
6. Repeat with one client refreshed during Ready Gate.
7. Repeat with one duplicate tab open and verify the duplicate-tab copy does not kill the active path for the other participant or the canonical session.
8. Confirm both users land on the same `/date/:sessionId`.
9. Confirm both users join the same Daily room.
10. Confirm local and remote media are visible/audible or intentionally muted.
11. Let the date end or end it explicitly.
12. Complete the post-date survey on both sides.
13. Repeat once with a simulated short Daily leave/rejoin under 12s and confirm no backend `reconnect_grace_expired` terminalization.
14. Confirm terminal survey truth opens `PostDateSurvey` on `/date/:sessionId` without `/date` <-> `/ready` cycling or new Daily/surface churn.
15. Confirm no raw 500s from:
    - `video_session_mark_ready_v2`
    - `ready_gate_transition`
    - `video_date_transition`
    - `claim_video_date_surface`
    - `mark_video_date_daily_joined`
    - `mark_video_date_remote_seen`
    - `get_or_seed_video_session_vibe_questions`
    - `video-date-token-refresh`
    - `daily-room`
16. Confirm no stale "This Ready Gate changed" copy unless there is a real duplicate-tab/session replacement case.
17. Query Supabase and Daily afterward for the exact session timeline.
18. Confirm the Daily webhook ledger has `participant.joined` and `participant.left` rows for both users when they actually join/leave.
19. Confirm `mark_video_date_daily_joined` logged `handshake_started_after_active_daily_copresence` only after both latest Daily presences were active, and `daily_join_waiting_for_active_partner` only when the partner's latest presence was absent or away.
20. Confirm no legacy/null `mark_reconnect_partner_away` starts backend grace during fresh warm-up evidence; explicit `daily_transport_grace_expired` may start backend grace only after local transport grace expires.
21. Confirm same-session Daily start does not repeatedly call `leave()` / `destroy()` while the call is `joining-meeting` or `joined-meeting`; if cleanup happens, inspect `daily_call_cleanup` diagnostics for `caller`, `cleanup_reason`, `meeting_state`, `leave_called`, and `destroy_called`.
22. Confirm `web_visibilitychange` does not produce backend `mark_reconnect_self_away` during active Daily handoff/warm-up/date.
23. Confirm provider/client return clears `reconnect_grace_ends_at` via `reconnect_grace_cleared_by_daily_join`, `reconnect_grace_cleared_by_provider_join`, or `reconnect_grace_cleared_by_return`.
24. Simulate post-encounter peer disappearance after `date_started_at`; confirm the remaining user sees peer-missing, the server ends with a survey-eligible reason, both registrations remain `in_survey` until feedback, and both users can complete survey.
25. Confirm terminal rows retain deterministic Daily room metadata after timeout/replay/already-ended paths.
26. Confirm a real prolonged absence still ends the session with `reconnect_grace_expired`.

Pass condition: both users complete the full journey from match through survey completion without lobby cycling, stale Ready Gate invalidation, or split-room Daily behavior.

---

## Investigation Checklist For The Next Failure

If Video Date fails again, collect this before changing code:

- Event ID.
- Video session ID.
- User IDs for both participants.
- Browser/device/platform for each user.
- Exact screen copy and timestamp.
- Console errors filtered to network/RPC/Daily only.
- Network response bodies for failed or retryable RPCs.
- Daily room name and Daily session IDs.
- Supabase rows for:
  - `video_sessions`
  - `event_registrations`
  - `video_session_commands`
  - `video_date_surface_claims`
  - `video_date_daily_webhook_events`
  - `video_date_provider_outbox`
  - `event_loop_observability_events`
- Whether `daily_room_name` and `daily_room_url` were present at both-ready.
- Whether `ready_participant_1_at` and `ready_participant_2_at` were set.
- Whether `participant_1_joined_at`, `participant_2_joined_at`, `participant_1_away_at`, `participant_2_away_at`, `participant_1_remote_seen_at`, `participant_2_remote_seen_at`, `handshake_started_at`, and `date_started_at` support active co-presence.
- Whether the latest Daily provider event for either participant was `participant.left` after their last `participant.joined`.
- Whether duplicate-tab behavior came from local browser storage, server `video_date_surface_claims`, or a real same-user duplicate surface.
- Whether any payload included:
  - `retryable_command_reopened`
  - `reclaimed_processing_command`
  - `decisive_mark_ready_commit`
  - `expiry_grace_applied`
  - `hot_path`
  - `sqlstate`
  - `legacy_mark_ready_signature_detected`
  - `daily_join_waiting_for_active_partner`
  - `handshake_started_after_active_daily_copresence`
  - `daily_transport_grace_expired`
  - `away_mark_suppressed`
  - `daily_transport_grace_required`
  - `latest_joined_at`
  - `reconnect_grace_cleared`
  - `reconnect_grace_cleared_by_daily_join`
  - `reconnect_grace_cleared_by_provider_join`
  - `reconnect_grace_cleared_by_return`
  - `mark_reconnect_self_away_suppressed_active_daily_presence`
  - `reconnect_grace_expiry_suppressed_latest_presence`
  - `daily_call_cleanup`
  - `daily_call_reuse`
  - `daily_call_busy_internal_retry`
  - `remote_seen_canonical_repair_failed`
  - `remote_seen_canonical_repaired`
  - `latest_remote_seen_at`
  - `previous_remote_seen_at`
  - `peer_missing_suppressed_remote_seen` (legacy allow-list only; current logic should not suppress peer-missing from historical encounter proof)
  - `peer_missing_suppressed_survey_truth`
  - `daily_no_remote_watchdog_historical_truth_requires_current_peer`
  - `partner_absent_after_confirmed_encounter`
  - `historical_remote_seen_truth`
  - `truth_refresh_attempt`
  - `go_survey`
  - `forceSurvey`
  - `daily_call_singleton_eligible`
  - `will_park_singleton`
  - `parked_singleton`
- Whether `ended_reason`, `survey_required`, `date_feedback`, and `forceSurvey` route state support immediate survey recovery.

Do not treat "This Ready Gate changed" as a root cause. Treat it as a symptom and prove why the client selected stale terminal copy.

---

## Primary Files To Inspect For Future Work

Backend / migrations:

- `supabase/migrations/20260604093000_video_date_failsoft_date_room_rpcs.sql`
- `supabase/migrations/20260604094500_video_date_transition_preserve_raise_semantics.sql`
- `supabase/migrations/20260604103000_ready_gate_mark_ready_hot_path_retry_recovery.sql`
- `supabase/migrations/20260604104154_ready_gate_mark_ready_grace_notification_auth.sql`
- `supabase/migrations/20260604142017_video_date_active_presence_join_guard.sql`
- `supabase/migrations/20260604170438_video_date_warmup_reconnect_stability.sql`
- `supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql`
- `supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql`
- `supabase/migrations/20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`
- `supabase/migrations/20260605115657_video_date_early_confirmed_encounter_promotion.sql`
- `supabase/migrations/20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`
- `supabase/migrations/20260605143637_video_date_terminal_room_metadata_backfill.sql`
- `supabase/migrations/20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`
- `supabase/migrations/20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`
- `supabase/migrations/20260605145926_video_date_terminal_room_metadata_final_repair.sql`
- `supabase/migrations/20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`
- `supabase/migrations/20260605152058_video_date_pending_survey_registration_repair.sql`
- `supabase/migrations/20260605170249_video_date_surface_owner_outer_failsoft.sql`
- `supabase/migrations/20260605174703_video_date_vibe_question_outer_base_name_repair.sql`
- `supabase/migrations/20260605200729_video_date_beforeunload_active_presence_repair.sql`
- `supabase/migrations/20260605203904_video_date_remote_seen_grace_payload_preserve.sql`
- `supabase/migrations/20260605211924_video_date_surface_claim_expiry_current_guard.sql`
- `supabase/migrations/20260605221535_review_comments_1199_1204_followups.sql`
- `supabase/migrations/20260605222458_review_comments_helper_name_repair.sql`
- `supabase/migrations/20260605232304_video_date_single_owner_runtime_hardening.sql`
- `supabase/migrations/20260606092944_video_date_decisive_mark_ready_commit.sql`
- `supabase/migrations/20260606100511_video_date_mark_ready_lint_cleanup.sql`
- `supabase/functions/video-date-outbox-drainer/index.ts`
- `supabase/functions/video-date-room-cleanup/index.ts`
- `supabase/functions/video-date-orphan-room-cleanup/index.ts`

Web:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/hooks/useReadyGate.ts`
- `src/pages/VideoDate.tsx`
- `src/hooks/useVideoCall.ts`
- `src/hooks/useVideoDateDupTabGuard.ts`
- `shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`
- `shared/matching/videoSessionDailyGate.test.ts`

Native/mobile:

- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/lib/videoDateApi.ts`

Provider / notification:

- `supabase/functions/daily-room/index.ts`
- `supabase/functions/video-date-token-refresh/index.ts`
- `supabase/functions/video-date-outbox-drainer/index.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/swipe-actions/index.ts`

Contracts:

- `shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`
- `shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`
- `shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `shared/matching/phase2PaymentsDurableNotifications.test.ts`

Runbooks:

- `docs/video-date-diagnostics-runbook.md`
- `docs/video-date-end-to-end-hardening-runbook.md`
- `docs/video-date-hardening-closure-handoff.md`
- `docs/video-date-post-release-monitoring-runbook.md`
- `docs/video-date-daily-webhook-operator-checklist.md`

---

## Update Log

### 2026-06-06

- Implemented the definitive owner/stable-copresence recovery plan in code and a coordinated Supabase migration, without running web or native builds. The new shared client owner contract lives in `shared/matching/videoDateEntryOwner.ts` and keys date-entry ownership by `{session_id,user_id}` plus Daily call ownership by `{session_id,user_id,room_name}`. Web and native/mobile prepare-entry paths now claim the same owner, coalesce duplicate force retries, hand off route state as `navigating`, and keep date route/Daily ownership separate from component-local remounts.
- Web `src/hooks/useVideoCall.ts` and native/mobile `apps/mobile/app/date/[id].tsx` now emit route/session-level Daily owner state, send `mark_video_date_daily_alive` heartbeats after join, stamp `owner_id`, `call_instance_id`, `provider_session_id`, `entry_attempt_id`, and `owner_state`, mark unexpected provider `left-meeting` as `daily_owner_provider_left_unexpected`, and promote owner state to `remote_seen` when canonical remote-seen succeeds. Nonterminal remount cleanup remains a UI detach/parking path; terminal survey, explicit leave/end, room/session mismatch, provider terminal state, or idle expiry remain the destructive disposal boundaries.
- Added migration `20260606180000_video_date_stable_copresence_handshake_guard.sql`. It creates service-only `video_date_presence_events`, adds public RPC `mark_video_date_daily_alive(...)`, adds service helper `video_date_stable_copresence_v1(session_id)`, and replaces the fail-soft `mark_video_date_daily_joined` base so a join records latest evidence but starts handshake only after stable copresence: both latest provider/client joins are active after any later leave, both owners heartbeat after the later join, both heartbeats are fresh within 15 seconds, and stability lasts at least 2 seconds unless remote-seen is already present.
- CTO audit correction: the pending stable-copresence migration now separates latest-heartbeat freshness from first-heartbeat stability. Latest owner heartbeats prove both clients remain fresh within 15 seconds; `stable_copresence_since_at` is anchored to the first qualifying bilateral owner-heartbeat pair after the later join so ongoing heartbeat refreshes cannot keep resetting the 2-second stability window.
- CTO audit also found and corrected a native/mobile lobby parity gap: the deck query gate now requires the resolved event lifecycle to be live before fetching deck data, matching the intended web/Ready Gate pressure behavior. Two stale contract assertions were updated to the current source-aware inactive-reason setter and native deck-gating truth.
- Rollout completed: PR #1212 merged to `main` at `0a85449a0384f257d314a77c5a7fe455a71e2003`, the remote PR branch was deleted, and `20260606180000_video_date_stable_copresence_handshake_guard.sql` was applied to Supabase cloud. Post-apply `supabase migration list --linked` shows `20260606180000` local/remote aligned; `supabase db push --linked --dry-run` reports the remote database is up to date.
- Documentation and rollout guidance were synchronized after the cloud apply in PR #1213 at `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8`. The nested app repo `main` / `origin/main` baseline for this handoff is `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8`; the parent workspace has no configured remote and records the nested pointer locally at `9d0536877ebb9c808abb8b538c68935bf0581702`. Recheck live Git and Supabase before treating these as current in a later session.
- Verification passed without triggering web or native builds: `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated RLS skips, `npm run lint`, full `npm run typecheck` including mobile/core/app typechecks, `git diff --check`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --level error --fail-on error`. Supabase lint returned no error-level findings; existing identifier-truncation notices are from earlier deployed helper names and were not failures.
- Live Supabase marker verification confirmed `video_date_presence_events` exists with RLS enabled, anon/authenticated cannot select it directly, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, and `video_date_stable_copresence_v1` exist, and the helper returns a typed `missing_session` waiting payload for an unknown session.
- Updated evidence vocabulary for the next failure/acceptance run: collect `video_date_presence_events`, `mark_video_date_daily_alive` payloads, `waiting_for_stable_copresence`, `stable_copresence`, `latest_owner_heartbeat_at`, `owner_id`, `owner_state`, `entry_attempt_id`, `call_instance_id`, `provider_session_id`, `daily_owner_provider_left_unexpected`, and any handshake-start reason. A handshake/date promotion from stale joined evidence or from a one-second Daily overlap is now considered a guard regression after the migration is applied.
- Acceptance boundary is unchanged. The implementation can be called verified only at static/database-contract level. Product success still requires a fresh disposable two-user production run through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> survey opens and completes, plus a short Daily leave/rejoin under 12 seconds and a real prolonged absence terminalization check.

- Investigated latest failed two-user production session `cac485cd-da3b-475b-aa4c-27b70cd914d6` for event `21497965-394a-45fe-8700-5d91bf927f65`. This run failed before Daily: participant 2 committed `ready_b`, participant 1's mark-ready attempts returned SQLSTATE `57014` / `READY_GATE_TRANSITION_TIMEOUT`, no `both_ready` or Daily room metadata was created, and the session expired as `ready_gate_expired`.
- Implemented and cloud-applied Supabase migration `20260606092944_video_date_decisive_mark_ready_commit.sql`. The public `video_session_mark_ready_v2` now commits participant readiness and deterministic `both_ready` room metadata before auxiliary observability/event/outbox work, preserves deployed idempotency/replay semantics, reclaims stale processing commands, and remains the target reached by legacy `ready_gate_transition('mark_ready')` bridges.
- Follow-up migration `20260606100511_video_date_mark_ready_lint_cleanup.sql` removes the unused `v_event` variable from the final live function definition after linked DB lint caught it. Reverification showed `unused_event_removed=true`, remote dry-run up to date, and linked DB lint no longer reports `public.video_session_mark_ready_v2`.
- Web `src/hooks/useReadyGate.ts` and native/mobile `apps/mobile/lib/readyGateApi.ts` now retry bounded mark-ready RPC transport errors with the same deterministic idempotency key, matching the existing retryable-payload behavior.
- Verification passed without triggering web or native builds: focused decisive mark-ready, 57014, Phase 3, and start-snapshot contracts; app TypeScript check; mobile typecheck; Supabase cloud apply/list/dry-run; live marker query; no-auth structured-response smoke; and linked DB lint with only pre-existing warnings/notices. This is still not acceptance proof; the fresh two-user production flow through survey completion remains required.
- Event Lobby RLS follow-up: investigated the live-policy proof note and found the real cloud risk is `event_registrations`, where authenticated direct DML grants/policies can bypass the intended registration/status/cancel RPC authority. The other audited authority tables (`event_swipes`, `video_sessions`, `event_deck_card_reservations`, `event_profile_impressions`, and `event_profile_impression_events`) are covered by the new read-only validation pack.
- Implemented and cloud-applied migration `20260606164737_event_registration_rpc_owned_dml_lockdown.sql`, validation SQL `supabase/validation/event_registration_rpc_owned_dml_lockdown.sql`, static authority contract `shared/matching/eventRegistrationRlsAuthority.test.ts`, and env-gated direct-write runtime proof `shared/matching/eventLobbyDirectWriteRlsRuntime.test.ts`. Web, mobile web, and native clients are contract-checked to avoid direct `event_registrations` DML and remain on RPC/service-role paths. Verification passed: focused RLS contracts, full `npm run test:event-lobby-regression`, `git diff --check`, live validation SQL with all seven checks true, raw live policy/privilege query showing `event_registrations` authenticated `SELECT` only with no DML policies, `supabase migration list --linked` aligned through `20260606164737`, post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` reporting the remote database is up to date, and linked public-schema lint with no error-level findings. Optional user-token direct-write runtime proof remains available through `npm run test:event-lobby-runtime-rls:required` when seeded `EVENT_LOBBY_RLS_*` credentials are present.
- Implemented an admission/setup and event-card lifecycle consistency patch. Shared admission readiness now records `payment_status` as diagnostic context only and keeps `admission_status = 'confirmed'` as the sole lobby/deck/Ready Gate readiness signal; web and native registration snapshots now expose `admissionStatus`, `paymentStatus`, `canEnterLobby`, `paidLikeButNotConfirmed`, and `admissionReadinessReason`. The seeded runtime QA pack now requires both smoke users to be confirmed-admitted and flags paid-like but non-confirmed rows as setup failure before deck/Ready Gate triage. Web list/featured cards and native/mobile Events tab featured/rail cards now use shared lifecycle badge resolution instead of raw `status === "live"` or time-window-only checks, terminal `ended_at` / `archived_at` fields flow into card props where available, and native registration-list helpers no longer treat payment-only rows as registered markers. Verification passed focused admission/card lifecycle helper tests, admission/card contract tests, `shared/matching/webEventLobbyGating.test.ts`, `shared/nativeEventPhase.test.ts`, `shared/matching/eventLobbyActiveEventContract.test.ts`, `shared/matching/eventDeckAuthorityContract.test.ts`, full `npm run test:event-lobby-regression`, `npm run test:video-date-ux-contracts`, full `npm run test:video-date-v4` with only the expected env-gated RLS skips, full `npm run typecheck`, `npm run lint`, and `git diff --check`. No Supabase migration, production data mutation, web build, native build, or manual two-user acceptance run was performed; this is not Video Date acceptance proof.

### 2026-06-05

- Review-comments follow-up for the latest 16 merged PRs (#1189 through #1204): unresolved current Codex threads were rechecked against `main`. Older items for route ownership, terminal survey hard-stop, remote-seen restamping, historical remote-seen peer-missing, documentation, and latest joined-at ordering were already covered by later merged work. New branch `codex/review-comments-1189-1204-followups` addresses the remaining live issues: migration `20260605221535_review_comments_1199_1204_followups.sql` authorizes authenticated confirmed-encounter promotion callers before delegating to room-metadata repair and tightens reconnect-grace expiry so only the participant with the latest away marker can satisfy joined-after-away recovery; migration `20260605222458_review_comments_helper_name_repair.sql` renames the preserved promotion base helper to short catalog name `vd_promote_ce_auth_20260605221535_base`; web first-remote terminal survey truth clears connecting state before survey recovery; and native/mobile prejoin now awaits a confirmed surface claim before entering Daily. Static contracts `shared/matching/reviewComments1198_1204Followups.test.ts` and `shared/matching/videoDatePhase5TimelineContracts.test.ts` cover these review follow-ups. Verification passed: focused review tests, `npm run typecheck:core`, `cd apps/mobile && npm run typecheck`, `npx tsc --noEmit -p tsconfig.app.json`, narrow ESLint, `git diff --check`, and `npm run test:video-date-v4` with only the expected env-gated runtime RLS skips. Supabase project `schdyxcunwcvddlcshwd` applied both migrations; post-apply dry-run returned remote up to date, migration list showed local/remote aligned through `20260605222458`, linked DB lint returned no error-level findings, and live catalog markers confirmed the short helper, removal of the truncated helper, participant auth before wrapper delegation, no room repair in the public wrapper, and participant-specific latest-away guards in reconnect expiry. GitHub review threads were not resolved or replied to because the requested workflow did not explicitly ask for GitHub thread write actions.
- Updated the recovery documentation and agent guidance after the ultimate stabilization rollout was merged and synchronized.
- Recorded then-current app `main` / `origin/main` commit `d2c912c873cd3c119b2296a507d5c4b05007f8a9`, PR #1195 final documentation follow-up, successful Vercel production status, deleted rollout branches, and clean app working tree.
- Recorded parent workspace gitlink commit `a50175961b64b5ec18fb5a0f5b3c7d3759ac5193`; the parent workspace has no configured remote, so GitHub push/merge verification applies to the nested `Git/vibelymeet` app repo.
- Reverified Supabase cloud alignment: remote database up to date, migrations `20260604193140` and `20260604205645` present, latest-state presence/remote-seen/transition/reconnect functions installed, and linked advisors returned no error-level issues.
- Clarified for future agents that the current primary work is not another broad Ready Gate rewrite. The next work should begin with fresh production evidence: prove or disprove stable Daily co-presence, local-grace behavior, reconnect grace clearing, terminal-survey hard-stop, and survey completion.
- Investigated the latest two-user failure session `c8027948-bf32-40c5-94a8-09e0d1207290` for event `324e52fc-c88a-4a57-a212-15ae79e0a1cd`. Ready Gate and same Daily room creation succeeded, but web same-session route churn unmounted `useVideoCall` while Daily was `joined-meeting`; cleanup called `leave()`/`destroy()`, provider emitted participant-left, and reconnect terminalization followed. Secondary evidence showed provider/media presence without canonical remote-seen symmetry, so `mark_video_date_remote_seen` needed earlier stamping than media-element first-frame only.
- Implemented web live same-session Daily remount preservation: `useVideoCall.unmount` now parks an eligible same-session `joining-meeting`/`joined-meeting` call for a short live-remount window without `leave()`/`destroy()`, then the next route instance reuses or waits for that call instead of joining again. This same-session continuity is decoupled from the optional cross-date warm-handoff flag. Added diagnostics for `live_same_session_remount`, skipped leave/destroy, singleton joined/in-flight reuse, and destroy-on-idle fallback.
- Implemented web and native/mobile date-route ownership leases. Event lobby, ReadyRedirect/standalone ready, `/date/:sessionId`, and native lobby/ready/date routes now mark fresh date-route ownership, suppress stale Ready Gate/lobby bounces while the date route owns the active handoff, and clear ownership on terminal survey or explicit abort.
- Hardened canonical remote-seen repair on web and native/mobile. Web now calls `mark_video_date_remote_seen` from `participant-joined`, `participant-updated`, and post-join snapshots in addition to first-frame/media playback. Native now bridges `markRemoteSeenOnce` through a ref and stamps from `participant_joined`, `participant_updated`, shared-call hydration, and mounted remote tracks.
- Deep-audited the route-ownership hardening and found two remaining edge cases:
  - `/date/:sessionId` and native `/date/[id]` were marking route ownership on mount before proving the session was actually date-routeable. That could suppress legitimate Ready Gate/lobby recovery for stale direct date entries. Web and native now keep the long entry-pipeline latch on mount but only refresh date-route ownership from explicit pre-navigation handoffs or active Daily startup/date evidence.
  - A handoff marked before the user id was available could leave an anonymous ownership key alive after later user-scoped cleanup. Web and native `clearVideoDateRouteOwnership` now clear the user-scoped key, anonymous key, and any remaining keys for that session.
- Reverified then-current baseline state during the deep audit: nested app repo `HEAD` and `origin/main` were both `d2c912c873cd3c119b2296a507d5c4b05007f8a9`; Supabase project `schdyxcunwcvddlcshwd` migration list showed `20260604142017`, `20260604170438`, `20260604193140`, and `20260604205645` applied remotely. The first parallel CLI check hit a local Supabase telemetry rename race; rerunning with telemetry disabled succeeded.
- Updated static contracts for route ownership, live Daily remount preservation, singleton join wait/reuse, and remote-seen provider-presence stamping across web/native/mobile.
- Verification: focused contracts passed after the native compile fix, web same-session continuity flag-decoupling, route-ownership mount-scope correction, and anonymous ownership cleanup:
  - `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
  - `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
  - `npx tsx shared/matching/videoDateInstantPremiumV2Contracts.test.ts`
  - `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- Verification: full `npm run typecheck` passed after replacing an invalid native `currentPhaseRef` reference with the existing `phaseRef`, passed again after decoupling web same-session continuity from the optional cross-date warm-handoff flag, and passed again after the route-ownership/cleanup deep-audit patch. `git diff --check` also passed. No web or native build was run for this verification.
- CTO audit follow-up: removed obsolete web warm-handoff singleton scaffolding discovered during review. Web Daily continuity is now explicitly same-session live remount only with the 20s idle guard; the optional `video_date.daily_call_singleton_v2` flag remains native/mobile-only for idle/cross-session warm handoff. Contract tests now reject `warm_handoff` in web code so future changes cannot silently reintroduce that misleading branch.
- CTO audit follow-up: closed a native/mobile observability parity gap. If `mark_video_date_remote_seen` exhausts all retries after provider/media evidence, native now emits `remote_seen_canonical_repair_failed` through the same client-stuck observability channel web already uses. This does not change success behavior; it ensures the next native/mobile failure leaves canonical repair evidence instead of debug-only logs.
- Devil's-advocate re-audit found and fixed a native route-ownership self-authorization risk. Native `/date/[id]` was refreshing date-route ownership from the default handshake/date phase before backend route truth marked the route eligible, which could suppress a legitimate stale direct-entry bounce. Native now requires `dateEntryPermissionEligible` before refreshing ownership from active date-route state; explicit pre-navigation ownership still works for real handoffs.
- Devil's-advocate re-audit also found a long-call lease-expiry risk: web/native date-route ownership was refreshed only on state changes, so a stable active call could outlive the 90s local route-ownership TTL and lose stale-bounce protection. Web and native now refresh date-route ownership every 30s while, and only while, the date route is backend-eligible and locally active.
- A further anonymous-ownership pass found that the hydration fallback key should not carry the same authority as a user-scoped route lease. Web and native now cap anonymous route ownership to a 30s bridge while preserving the full 90s TTL plus 30s keepalive for user-scoped active date ownership.
- Expanded 63-file Video Date contract run surfaced a stale brittle assertion in `videoDateSurfaceRenderContracts.test.ts`; the Ready Gate web behavior already filtered actionable diagnostic rows correctly, but the test required both comparisons on one source line. The contract now asserts the behavior across formatting.
- Expanded contract verification also surfaced an over-specific Daily token refresh assertion in `videoDatePhase3PresenceRecoveryContracts.test.ts`. Manual source review confirmed the retryable web token-refresh failure path already clears the connecting state and starts `daily_token_refresh_failed` reconnect grace inside the `!refreshed` branch; the contract now verifies that behavior by branch scope instead of adjacency.
- Extra non-build CTO audit checks found two hook dependency lint warnings and one stale Ready Gate UX contract assertion. The native standalone Ready Gate initial truth effect now declares `cancelTerminalReadyGateWork`, the web pre-date exit callback declares `user?.id` for route-ownership cleanup, and the Ready Gate shared-vibe contract now checks the current snapshot-based partner guard.
- Additional canonical-origin audit found a notification boundary risk outside the Daily handoff itself: `send-notification` accepted legacy/apex app URLs and also used raw `APP_URL` for the OneSignal provider open URL, so a misconfigured apex `APP_URL` could emit non-canonical production notification links. `send-notification` now separates `RAW_APP_URL` for inbound compatibility from canonicalized outbound `APP_URL`; native notification deep-link handling still accepts historical apex links but derives that compatibility origin from the canonical `www` origin. The OneSignal contract now protects this split, and `npm run check:canonical-origin` passes.
- CTO audit verification after the cleanup/parity/route-ownership keepalive patch:
  - `node --import tsx --test shared/matching/videoDate*.test.ts` (569 tests, 567 passed, 2 env-gated runtime RLS skips, 0 failed)
  - `npm run test:daily-room-contract`
  - `npm run test:video-date-ux-contracts`
  - `npm run lint`
  - `npm run typecheck`
  - `git diff --check`
  No web or native build was run.
- Focused notification/canonical verification after the outbound URL fix:
  - `npm run check:canonical-origin`
  - `node --import tsx --test shared/matching/onesignalProviderOperationalQa.test.ts shared/pushDeliveryHealth.test.ts shared/permissions/permissionFlowHardeningContracts.test.ts shared/notificationInboxContracts.test.ts shared/matching/videoDatePhase4TokenPushDedupContracts.test.ts shared/matching/videoDatePushOpenDedupePreloadContracts.test.ts`
- Final non-build audit verification after the native notification allow-list rename and contract correction:
  - `npm run lint`
  - `npm run typecheck`
  - `git diff --check`
  - `npm run check:canonical-origin`
  - `node --import tsx --test shared/matching/onesignalProviderOperationalQa.test.ts shared/permissions/permissionFlowHardeningContracts.test.ts shared/matching/videoDatePhase4TokenPushDedupContracts.test.ts shared/matching/videoDatePushOpenDedupePreloadContracts.test.ts`
  - `node --import tsx --test shared/matching/videoDate*.test.ts` (569 tests, 567 passed, 2 env-gated runtime RLS skips, 0 failed)
  - `npm run test:video-date-ux-contracts`
  - `npm run test:video-date-v4`
- Read-only Supabase baseline sanity check: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` confirmed local/remote alignment through the expected Video Date migrations `20260604142017`, `20260604170438`, `20260604193140`, and `20260604205645`. The installed Supabase CLI is `2.104.0`; the first parallel version probe hit the known local telemetry rename race, and the sequential telemetry-opted-out rerun succeeded.
- Published recovery hardening PR #1196 (`https://github.com/kaanporsuk/vibelymeet/pull/1196`) and squash-merged it into `main` at commit `359fa5c42bd5fcdefef9a8a1fca9396d96194f4f`; source branch `codex/video-date-stability-cloud-sync` was deleted on GitHub and pruned locally.
- Deployed the changed Supabase Edge Function `send-notification` to cloud project `schdyxcunwcvddlcshwd` with explicit `--no-verify-jwt` so its service-to-service auth contract remains unchanged. `supabase functions list --project-ref schdyxcunwcvddlcshwd` showed `send-notification` active at version `813`, updated `2026-06-05 01:59:45 UTC`.
- Post-deploy Supabase verification: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --dry-run --linked` returned `Remote database is up to date`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` still showed local/remote alignment through `20260604205645`. No migration was applied, and no web or native build was run.
- Boundary remains unchanged: these checks do not prove Video Date is fixed. Acceptance still requires a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> survey opens and completes.
- Investigated the latest two-user production test session `26d56372-7505-49ac-b701-c3e7be5c806c` for event `1822440f-e166-4ee4-95d0-6d8097e47e24` with participants `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` and `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`. Local app git was at `63d41b652a7ba7ce0019a6ae11f711d08ac6639b`; `supabase migration list --linked` and `supabase db push --linked --dry-run` confirmed the cloud DB remains aligned through `20260604205645`.
- Latest session evidence: Ready Gate hot path succeeded (`ready_a` at `07:50:32.744162Z`, `both_ready` at `07:50:41.872032Z`, `hot_path=true`, `retryable_command_reopened=false`); canonical Daily room was `date-26d56372750549acb701c3e7be5c806c`. Daily webhooks show both users joined the same room at `07:51:04.388Z` and `07:51:04.390Z`; later participant-left rows were processed only after terminal truth and were recorded as `ignored_terminal_session`.
- Latest session remote-media evidence: `mark_video_date_remote_seen` produced `confirmed_encounter=true` by `07:51:06.776187Z`; latest observed `participant_1_remote_seen_at` was `07:51:15.240947Z` and `participant_2_remote_seen_at` was `07:51:41.629644Z`. `participant_1_away_at`, `participant_2_away_at`, and `reconnect_grace_ends_at` were null, so this failure was not a backend partner-away/reconnect-grace terminalization.
- Failure boundary: warm-up/date-start ownership diverged. No `continue_handshake` command committed. Two `handshake_auto_promote` commands raced at `07:53:00Z`: the first returned `state=handshake`, `extended=true`, `reason=handshake_launch_evidence_extension`, but `seconds_remaining=0`; the second immediately ended the session with `ended_reason=handshake_timeout`, `survey_required=true`, `date_started_at=null`, and no persisted user decisions. One user remained `in_survey`, the other later went `offline`; `date_feedback` had no rows.
- Root cause identified in deployed SQL: `finalize_video_date_handshake_deadline` still uses `handshake_started_at = LEAST(v_now, v_latest_launch_evidence_at)` for launch-evidence extension and does not consult `video_date_session_has_confirmed_encounter`. In this session, latest launch evidence was already more than 60 seconds old by the time the finalizer ran, so the extension returned zero seconds and allowed the peer client to terminalize immediately. Existing contract `shared/matching/videoDateDefinitiveHandoffRecovery.test.ts` currently asserts this flawed `LEAST(...)` pattern.
- Secondary UX/load evidence from the attached Console/Network logs: raw 500s occurred on `video_date_transition`, `claim_video_date_surface`, and `record_video_date_launch_latency_checkpoint`; `video-date-snapshot` returned 503 once; `video-date-token-refresh` returned 429 once. Observability recorded repeated route shells (`date_route_entered` and `video_stage_shell_visible` count 15), `warmup_timer_started` count 9, `daily_reconnect_started`, and `daily_reconnect_failure`. These are secondary stability/noise issues; the decisive terminal cause was confirmed encounter + zero-second extension + auto-promote timeout.
- Current plan boundary: fix the backend first with a new migration that makes confirmed bilateral remote media/date-entry evidence authoritative before handshake timeout, repairs launch-evidence extension to grant positive time or decline extension, and makes paired auto-promote calls idempotent under contention. Then harden web/native/mobile clients so a handshake extension refreshes server truth without immediate stale retry, warm-up timers do not reset backwards from server repairs, token/surface/snapshot telemetry callers back off cleanly, and survey hard-stop remains authoritative. This still must be proven by a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up -> date end -> survey completion.
- Implemented local migration `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`. It wraps `finalize_video_date_handshake_deadline`, restores canonical Daily metadata before deadline decisions, promotes active confirmed-encounter/no-pass/no-both-decided handshakes to `date`, updates both registrations to `in_date`, records `confirmed_encounter_deadline_promoted_to_date`, and replaces the zero-second `LEAST(...)` launch-evidence extension with `handshake_started_at = v_now` plus a positive `seconds_remaining` response.
- Hardened web/native/mobile clients for the repaired deadline contract. Web `VideoDate.tsx` and native `apps/mobile/app/date/[id].tsx` now treat positive `state=handshake, extended=true` responses as real deadline extensions, clear stale retry keys, refresh local countdowns, and avoid immediately retrying an already-repaired deadline. Warm-up `warmup_timer_started` telemetry is session-deduped so server-side `handshake_started_at` repairs do not create repeated timer-start metrics.
- Hardened surface-claim churn across web and native/mobile. `useVideoDateDupTabGuard` and native `/date/[id]` now use single-flight plus bounded backoff for retryable/unknown `claim_video_date_surface` failures while preserving hard duplicate-surface blocking on non-retryable `SURFACE_CLAIM_CONFLICT`. This addresses the secondary 500 retry storm evidence without letting optional ownership telemetry force users out of an active handoff.
- CTO audit follow-up found and fixed one native parity bug in the surface-claim backoff path: a skipped renewal during in-flight/backoff could clear visible duplicate-device blocking even though the server conflict had not been released. Native now mirrors the blocked state into `surfaceClaimBlockedRef`, uses a ref-backed setter, and returns `canContinue` from the latest blocked truth when a renewal is intentionally skipped.
- Reconciled peer-missing suppression contracts with the active recovery theory at the time. This was later superseded by the `782f5eb6-497f-4fd8-9898-2f47cf939751` audit: historical remote-seen/encounter exposure proves survey eligibility, not current peer presence. Current web/native first-remote watchdogs suppress peer-missing only for survey-required terminal truth.
- Tidied generated local output: removed the top-level untracked `dist/` directory left by earlier local work. A post-cleanup scan found no top-level generated `dist`, `.next`, `.turbo`, `coverage`, or `build` folders; the only untracked file is the intended migration `supabase/migrations/20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`.
- Verification after implementation, with no web or native build run: `npx tsx shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`, `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`, `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`, `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`, `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`, `node --import tsx --test shared/matching/videoDate*.test.ts` (570 tests: 568 pass, 2 expected env-gated RLS skips), `npm run test:video-date-ux-contracts`, `npm run typecheck:core`, `cd apps/mobile && npm run typecheck`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, and `git diff --check` all passed.
- Supabase cloud apply: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked` applied `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql` to project `schdyxcunwcvddlcshwd`. Post-apply `supabase migration list --linked` shows local/remote aligned through `20260605085010`, and `supabase db push --linked --dry-run` reports `Remote database is up to date`.
- Supabase live function verification: `supabase db query --linked` against `pg_get_functiondef('public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)'::regprocedure)` returned `has_confirmed_encounter_rescue=true`, `has_positive_extension_v2=true`, `wraps_20260605085010_base=true`, and `old_least_pattern_position=0`.
- Supabase schema lint: first `supabase db lint --linked --level warning` attempt failed before querying due a CLI telemetry file rename race after concurrent CLI commands; rerun alone as `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --level warning --fail-on none` completed. It reported existing unrelated warnings and already-applied identifier-truncation notices; the new migration base name `finalize_vd_handshake_deadline_20260605085010_base` is 50 chars and does not add another overlong identifier.
- Supabase changelog scan (`https://supabase.com/changelog.md`) showed no relevant hosted Postgres migration/PLpgSQL breaking item for this scoped wrapper migration; the visible breaking items were unrelated/self-hosted/API exposure/OAuth/pg_graphql topics.
- Published confirmed-encounter deadline rescue PR #1199 (`https://github.com/kaanporsuk/vibelymeet/pull/1199`) and merged it into `main` at commit `ebe4690467b7956511338d94c5847b88889cd1a8`; source branch `codex/video-date-confirmed-encounter-rescue` was deleted on GitHub and pruned locally.
- Final sync verification after PR #1199: local `main` and `origin/main` aligned at `ebe4690467b7956511338d94c5847b88889cd1a8`; Supabase project `schdyxcunwcvddlcshwd` stayed aligned through `20260605085010`, and `supabase db push --linked --dry-run` reported `Remote database is up to date`.
- Updated active recovery guidance and related runbook overlays to the PR #1199 / `20260605085010` baseline so future agents do not start from the superseded PR #1195 assumptions. Historical rollout sections remain preserved as point-in-time evidence.
- Boundary remains unchanged: this implementation is not proof that Video Date is fixed. Acceptance still requires a fresh disposable production two-user run after migration/deploy through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up -> date end -> survey opens and completes.
- Investigated the latest failed production two-user session `d38e4c62-3cf9-4c98-b6a5-b37b2fe36ef3` for event `5dd6716f-b18b-40b1-b238-21d4eb1bf1d5`. Ready Gate and Daily room creation succeeded, both users joined the same Daily room, canonical remote-seen repair reached `confirmed_encounter=true`, first remote frame/readable evidence existed, and both registrations ended `in_survey`; however `date_started_at` remained null and the final session ended `handshake_timeout`.
- Latest failure boundary: web Daily lifecycle churn still emitted repeated `useVideoCall.unmount` cleanup diagnostics during active `joining-meeting`/`joined-meeting` states, provider join/leave churn emptied the room before deadline cleanup, `video_session_handshake_auto_promote_v2` remained deadline-gated despite confirmed bilateral media, and the deadline rescue ran too late to create a stable date. The final row also had null `daily_room_name`/`daily_room_url` despite earlier room metadata evidence.
- Current next-change plan from this audit: make web unmount cleanup mount-stable/ref-backed, latch same-session Daily continuity once join starts, make same-room `external_call_busy` a reuse/wait path, promote to `date` immediately on confirmed bilateral remote-seen plus joined evidence, add branch diagnostics to deadline cleanup, enforce canonical room metadata persistence, preserve native/mobile lifecycle parity, and structure handoff RPC failures instead of allowing opaque 500s.
- This was an audit-only investigation update. No code changes, migrations, deploys, web build, or native build were run.
- Implemented confirmed-encounter stability branch `codex/video-date-confirmed-encounter-stability`: web `useVideoCall` now uses ref-backed unmount cleanup and a latched same-session Daily continuity guard so React route/state churn parks live same-session Daily calls instead of tearing them down; CSP now allows `https://img.onesignal.com` to remove noisy OneSignal image violations during debugging.
- Added and applied Supabase migration `20260605115657_video_date_early_confirmed_encounter_promotion.sql` to project `schdyxcunwcvddlcshwd`. It creates shared helper `video_date_promote_confirmed_encounter_v1(...)`, wraps `mark_video_date_remote_seen`, `video_session_handshake_auto_promote_v2`, and `finalize_video_date_handshake_deadline`, promotes active confirmed bilateral encounters to `date` before deadline fallback, and repairs canonical Daily room metadata.
- Verification after implementation, with no web or native build run: focused Video Date contract tests, `npm run typecheck:core`, narrow ESLint on touched TS/TSX contract surfaces, `supabase db push --linked --dry-run`, `supabase db push --linked --yes`, `supabase migration list --linked`, and `supabase db lint --linked --schema public --fail-on error` all completed with the new migration aligned locally/remotely and no Supabase error-level lint findings. A live catalog/function marker query also returned true for migration application, the `mark_video_date_remote_seen` early-promotion wrapper, the auto-promote helper-before-base wrapper, the finalizer fallback wrapper, post-base room repair, and the shared helper's `confirmed_encounter_promoted_to_date` / `state = date` markers.
- Updated active recovery guidance and runbook overlays to the `20260605115657` early-promotion invariant. Historical PR #1199 / `20260605085010` rollout evidence remains preserved as point-in-time context.
- Investigated latest failed production test session `782f5eb6-497f-4fd8-9898-2f47cf939751` for event `6c9c647f-242b-463c-8b24-0896f02677e5`. Ready Gate, Daily room creation, bilateral provider joins, canonical remote-seen, and early confirmed-encounter promotion all worked; the session reached `date` at `2026-06-05T13:25:51.75678Z`. The failure was post-date-start lifecycle: both users left Daily around `13:26:48Z`, only participant 2 rejoined at `13:28:09.710Z`, `date_timeout` ended survey-eligible at `13:30:53.723208Z`, final Daily room metadata was null, `date_feedback` had no rows, participant 1 stayed `in_survey`, and participant 2 was later overwritten to `offline`.
- Implemented terminal survey lifecycle hardening in migrations `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, and `20260605152058_video_date_pending_survey_registration_repair.sql`, web `useVideoCall`, web `VideoDate`, native/mobile `/date/[id]`, shared observability, cleanup/outbox Edge Functions, and new/updated contracts. The current invariant is sticky survey until feedback, pending-survey registration repair, terminal room metadata repair/preservation, provider-delete marker tracking, and current-peer-vs-historical-encounter separation.
- Applied all seven terminal-survey lifecycle migrations to Supabase project `schdyxcunwcvddlcshwd`; post-push dry-run reported remote up to date, live function marker query confirmed sticky-survey and terminal-room-repair clauses, linked public-schema lint returned no error-level findings, and the failed session `782f5eb6-497f-4fd8-9898-2f47cf939751` now has canonical `daily_room_name`/`daily_room_url`.
- Backfill learning: helper-based migration `20260605143637` repaired rows, but the old cleanup/outbox workers could re-null terminal room fields because they used null metadata as a provider-delete marker. The final fix adds explicit marker columns, redeploys `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup`, reruns final repair/marker migrations, and verifies zero remaining terminal-room metadata candidates while repaired rows stay preserved and marked. The sticky-survey function prevents future status downgrades, but already-downgraded live registrations required `20260605152058` to restore `in_survey` where no feedback exists.
- Revisited the original `782f5eb6-497f-4fd8-9898-2f47cf939751` failed-session prompt after PR #1202 merged. Local focused contracts passed for terminal-survey lifecycle, warm-up stability, and Daily gate recovery; the full `npm run test:video-date-v4` suite passed with only the expected env-gated runtime RLS skips. Remote Supabase dry-run again reported up to date, migrations through `20260605152058` remained applied, cleanup/outbox functions remained active at versions `video-date-room-cleanup` 437, `video-date-outbox-drainer` 46, and `video-date-orphan-room-cleanup` 38, and the live invariant query showed the failed session is survey-eligible with canonical Daily room metadata preserved, provider-delete markers present, both event registrations `in_survey`, zero remaining terminal metadata candidates, and zero downgraded pending-survey registrations. Audit conclusion: the bugs identified in that prompt are addressed in code and cloud state; the feature still requires the fresh manual two-user acceptance run before calling Video Date product-healthy.
- Implemented the latest `d7507b5c-7837-4310-a52c-ebd10c1ae535` failure plan locally. Web `SessionRouteHydration` now makes any hydrated active `video` session, especially `queueStatus="in_survey"`, the cross-surface route owner and sends stale `/ready` or lobby surfaces back to `/date/:sessionId` with `forceSurvey` state. Web `EventLobby` now treats `in_survey` as date-stack owned without running Daily prepare, suppresses Ready Gate openings when the same session is already video-owned, handles canonical `survey`/`ended` video-session realtime before Ready Gate, and stops deck pressure while video ownership is active. A PR review caught that web survey recovery still passed through duplicate/manual-exit suppression; the final patch gives the web date-navigation guard the same narrow `force` bypass as native and sends `forceSurvey` route state for active-session, registration-realtime, and video-session-realtime survey ownership.
- Added native/mobile parity for the same ownership boundary. `NativeSessionRouteHydration` redirects active video/survey sessions back to `/date/[id]`; native `dateNavigationGuard` supports `force` so terminal survey recovery bypasses duplicate-navigation/manual-exit suppression; native Ready Gate uses that force path for `go_survey`; native EventLobby routes `in_survey` from active-session hydration, registration realtime, video-session realtime, and stale Ready Gate enrichment directly to the date stack; native `/date/[id]` opens terminal survey for explicit `show_terminal`/`go_survey` recovery actions, not only legacy `ended` decisions.
- Created and applied Supabase migration `20260605170249_video_date_surface_owner_outer_failsoft.sql`. It wraps `claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `get_or_seed_video_session_vibe_questions` as outermost fail-soft RPCs, preserving existing base implementations while converting uncaught errors into retryable JSON payloads with `sqlstate`, message, retry delay, and server time. This directly addresses the raw 500s seen in the latest Console/Network evidence.
- The first cloud apply of `20260605170249` exposed a PostgreSQL identifier-truncation notice for the long `get_or_seed_video_session_vibe_questions_20260605170249_outer_base` helper name. Corrective migration `20260605174703_video_date_vibe_question_outer_base_name_repair.sql` repairs cloud and fresh-database state by normalizing that preserved base helper to `vd_vibe_q_outer_20260605170249_base` and repointing the wrapper to the short name.
- Added regression contract `shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts` and wired it into `npm run test:video-date-v4`. Verification run, with no web or native build: `npx tsx shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`, `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`, `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`, `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`, `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`, `npm run typecheck`, narrow `npx eslint` on touched TypeScript/TSX files, and `git diff --check` passed. Supabase linked cloud verification applied `20260605170249` and `20260605174703`, then `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`; `supabase migration list --linked` showed local/remote aligned through `20260605174703`; a live catalog marker query returned true for all four wrappers calling their preserved bases, the short vibe-question base helper existing, and the truncated helper name removed; `supabase db lint --linked --schema public --fail-on error` returned no error-level findings and only pre-existing warnings/notices. Local Supabase status/list could not run because Docker/local Postgres was not running; no web or native build was run.
- Investigated latest failed production test session `f3d1bd2a-5c37-43bb-9a9a-ec3c78fe7442` for event `9ac64807-7fe3-41b1-86db-49a3d4053b56`. The session reached `ready_gate_status=both_ready`, created Daily room `date-f3d1bd2a5c3743bb9a9aec3c78fe7442`, entered `date` at `2026-06-05T19:06:18.40143Z`, recorded both Daily joins, and recorded bilateral remote-media evidence. It still ended `reconnect_grace_expired` at `2026-06-05T19:09:00.570226Z` because a client lifecycle `mark_reconnect_self_away` with `reason=web_beforeunload` opened reconnect grace at `2026-06-05T19:07:43.923740Z` while the date was visibly active. This proves the remaining bug was not Ready Gate, room creation, early date promotion, sticky survey, or room metadata; it was browser lifecycle false-away authority plus too-short surface evidence during launch churn.
- Implemented lifecycle false-away hardening. Web `VideoDate` now treats `beforeunload`, `pagehide`, `visibilitychange`, and `freeze` as soft telemetry while Daily is active/starting or the session is in handshake/date; active soft lifecycle handling no longer stops local tracks. Web and native/mobile `video_date` surface claims now use a 30-second server TTL so route/app churn does not erase active-surface evidence before reconnect-grace expiry. Supabase migration `20260605200729_video_date_beforeunload_active_presence_repair.sql` wraps `video_date_transition`, `mark_video_date_remote_seen`, and `expire_video_date_reconnect_graces` so lifecycle away reasons `web_visibilitychange`, `web_freeze`, `web_beforeunload`, `web_pagehide`, and `app_background` are suppressed or cleared when fresh joined, remote-media, or surface evidence proves the active date is still live.
- Devil's-advocate follow-up: created `20260605203904_video_date_remote_seen_grace_payload_preserve.sql` after noticing the `20260605200729` `mark_video_date_remote_seen` wrapper could overwrite an existing base `reconnect_grace_cleared=true` with `false` when the outer wrapper itself did not update rows. The follow-up preserves the base true value with `v_base_reconnect_grace_cleared OR v_rows_changed > 0`.
- PR review follow-up: created `20260605211924_video_date_surface_claim_expiry_current_guard.sql` after review caught that the expiry wrapper accepted a surface claim valid at `v_latest_away_at` even if it had expired by `v_now`. The corrective wrapper requires `c.expires_at >= v_now` before surface evidence can suppress reconnect-grace expiry, so stale closed-tab claims cannot keep a genuinely disconnected session alive.
- Verification after implementation, with no web or native build run: `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`, `npm run test:video-date-v4` (with only the expected env-gated runtime RLS skips), `npm run typecheck:core`, narrow `npx eslint` on touched web/native/test files, and `git diff --check` passed. Supabase linked cloud verification applied `20260605200729`, `20260605203904`, and `20260605211924`, then `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`; live migration-row query showed all three versions applied; a live catalog marker query returned true for `web_beforeunload` transition handling, base delegation, remote-seen base grace payload preservation, remote-seen outer/base grace OR semantics, expiry surface/recent-media checks, and current unexpired surface-claim enforcement; `supabase db lint --linked --schema public --fail-on error` returned no error-level findings and only pre-existing warnings/notices.
- Documentation lesson from this pass: do not treat navigation/lifecycle events as terminal proof once Daily or the date route has positive active evidence. The backend must re-rank evidence at reconnect-expiry time, and client docs must name all equivalent sources across web and native/mobile (`web_visibilitychange`, `web_freeze`, `web_beforeunload`, `web_pagehide`, and `app_background`). Surface proof at expiry must be current, not merely historically valid near the away event. Static tests, cloud migration markers, and lint are required for release confidence, but the product-health boundary remains a fresh two-user acceptance run through post-date survey completion.
- Investigated latest failed production test session `4082fe36-8480-4d30-9a1d-1de227b855e3` for event `cdb38cb8-acfb-4fa1-b732-10903eccc3b0` after the PR #1204 lifecycle false-away repair and review-comment follow-ups. Before analysis, the parent repo showed only the nested `Git/vibelymeet` pointer changed, nested `main` / `origin/main` were clean at `9fc82b5f9867de0ab9905e64804c3d226a0f065f`, `supabase migration list --linked` showed local and remote aligned through `20260605222458`, and `supabase db push --linked --dry-run` returned `Remote database is up to date`.
- Latest session timeline: match/session created at `2026-06-05T22:14:44.285514Z`; both users marked Ready Gate ready at `22:14:47.530303Z` and `22:14:47.659992Z`; canonical Daily room `date-4082fe3684804d309a1d1de227b855e3` was verified; Daily joins arrived at `22:14:52.071Z` and `22:14:53.163Z`; `handshake_started_after_active_daily_copresence` fired at `22:14:53.504822Z`; `confirmed_encounter_promoted_to_date` fired at `22:14:53.687453Z`; `date_started_at` became `22:14:53.753531Z`.
- The date did not stabilize. Observability recorded 18 `date_route_entered`, 18 `video_stage_shell_visible`, 6 `daily_join_started` / `daily_join_success`, 26 `daily_call_cleanup`, and 7 `daily_call_busy_internal_retry` rows. Screenshots and console/network evidence matched that churn: the UI moved among `/date`, `/ready`, and lobby, showed "Still connecting your date", "This date is already open on another device", "Opening the room", "Opening your date", and "Connection softened. Reconnecting...", and raw browser 500s appeared for `video_date_transition`, `claim_video_date_surface`, `get_video_date_queue_hint_v1`, and `drain_match_queue_v2`.
- Daily provider evidence shows repeated join/leave churn, not one stable room stay: participant 1 joined `82be35b1-8d3b-489b-9fbb-972a8f0a183f`, left, rejoined as `ff11f656-331d-4790-a984-e4ff76f88efb`, left, rejoined as `82653369-97ff-4a71-ad04-35e4a46f5119`, and finally left at `22:16:43.365Z`; participant 2 joined `5b4e5797-2dd0-4842-ade4-e1be13cb568b`, left, rejoined as `51d5c859-3ad3-48c9-8438-1a9944567e4c`, and finally left at `22:16:53.812Z`. Surface claims existed only as current rows updated at `22:16:36.109573Z` and `22:16:37.209746Z`, expiring at `22:17:06.109573Z` and `22:17:07.209746Z`.
- Backend expiry at `2026-06-05T22:18:00.839509Z` ended the session as `reconnect_grace_expired`, `survey_required=true`, `resume_status=in_survey`, with both registrations `in_survey`, canonical Daily URL preserved, provider delete marker at `22:19:02.881Z`, and zero `date_feedback` rows. Given the final evidence at expiry - no current unexpired surface claim and latest provider events being leaves for both participants - the terminalization was consistent with the current guard. The product still failed because the client never maintained a stable active date/survey owner and no user completed the survey.
- Diagnostic gaps found in this audit: `record_video_date_client_stuck_observability` in cloud still rebuilds a narrow JSON detail and drops the current client-sanitized fields `same_session_daily_continuity_latched`, `will_park_singleton`, and `parked_singleton`, so production rows cannot prove whether same-session Daily parking/reuse worked. `video_date_transition` has lifecycle suppression logic but still delegates to its base without an outer `EXCEPTION` fail-soft shell, so console 500s can still surface from transition calls. Reconnect expiry currently logs `latest_away_reason=null` for this terminal event and clears away fields on the final row, leaving no durable explanation of which away marker opened the grace. `video_date_surface_claims` is a current-state table, not append-only history, so it cannot reconstruct earlier surface ownership or duplicate-overlay causes.
- Current implementation plan from this audit: make `/date/:sessionId` the only active owner after Ready Gate or `date_started_at`, and make terminal `in_survey` a hard-stop owner across date, ready, and lobby; move the Daily call object into a route-level/session-level owner so React unmount/remount churn cannot create external-call-busy loops or provider leave/rejoin storms; extend the DB observability function to preserve parking/continuity/owner fields; wrap `video_date_transition`, queue hint, and drain queue paths with true outermost retryable JSON fail-soft behavior; add append-only surface-claim and away/grace audit history; and make terminal survey truth synchronously cancel Daily/surface/reconnect/queue work and render a submit-resilient survey from any surface.
- This was an investigation and documentation update only. No code changes, migrations, web build, native build, or manual acceptance proof were run. The feature remains unproven until the fresh disposable two-user production flow completes match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> survey opens and completes, plus short leave/rejoin and prolonged absence checks.
- Implemented the 2026-06-06 single-owner runtime hardening after the `4082fe36-8480-4d30-9a1d-1de227b855e3` audit. Web and native/mobile now mark active `/date/:sessionId` ownership as soon as an active video session or date route is hydrated; active `in_handshake` / `in_date` handoffs from lobby skip Daily prepare/restart and route directly to the date owner; terminal `in_survey` on web can force same-route survey recovery; native/mobile date recovery hard-stops local joining/reconnect state before showing survey.
- Created and applied Supabase migration `20260605232304_video_date_single_owner_runtime_hardening.sql` to project `schdyxcunwcvddlcshwd`. It adds service-only append-only `video_date_surface_claim_events`, wraps `video_date_transition`, `get_video_date_queue_hint_v1`, `drain_match_queue_v2`, and `claim_video_date_surface` with outermost retryable JSON fail-soft shells, and widens `record_video_date_client_stuck_observability` so production rows preserve route ownership, same-session Daily continuity, singleton parking, truth refresh, and related client-sanitized fields.
- Deep audit follow-up: native/mobile terminal survey recovery originally set `phaseRef.current = "ended"` only inside the survey opener, but a later render assignment could overwrite it before hook/server phase caught up; route ownership refresh could also stop when `dateEntryPermissionEligible=false`. Patched `/date/[id]` with `terminalSurveyHardStopRef`, disabled date-entry eligibility when terminal survey opens, pinned `phaseRef.current` / `latestDateRouteEndedRef` while the survey hard-stop is active, and kept date-route ownership refreshed when `showFeedback`, `phase === "ended"`, or the hard-stop ref is active. Added contract coverage so this cannot silently regress.
- Verification after implementation and deep audit: focused contracts `shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`, `shared/matching/videoDateSurfaceContinuityHardening.test.ts`, and `shared/observability/videoDateClientStuckObservability.test.ts` passed 21/21; the full `npm run test:video-date-v4` passed with only the expected env-gated runtime RLS skips; the combined `npm run typecheck` passed; repo-wide `npm run lint` passed; and `git diff --check` passed. Supabase `db push --linked --yes` had already applied `20260605232304`; fresh post-audit `migration list --linked` showed local/remote aligned through `20260605232304`; fresh dry-run returned `Remote database is up to date`; live marker queries confirmed all four RPC wrappers call the new base helpers, the public wrappers remain executable by `authenticated`, the base helpers are not executable by `anon`/`authenticated` and remain executable by `service_role`, `video_date_surface_claim_events` exists with RLS enabled and service-only insert grants, and `record_video_date_client_stuck_observability` contains the preserved continuity/parking fields. `supabase db lint --linked --schema public --fail-on error` passed with only pre-existing warning/notices; `supabase db advisors --linked --type all --level error --fail-on error` returned `No issues found`. No web build or native build was run.
- This implementation still does not prove Video Date healthy. The fresh disposable two-user production acceptance run remains required, including match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> survey opens and completes, plus short Daily leave/rejoin under 12s and real prolonged absence terminalization.

### 2026-06-04

- Created this dedicated Video Date recovery document.
- Recorded user brief that Video Date has been failing for over a month despite repeated remediation.
- Consolidated same-day fixes:
  - date-room RPC fail-soft wrappers and stuck metadata backfill,
  - transition raise-semantics correction,
  - mark-ready hot-path recovery,
  - mark-ready expiry grace and retryable UX hardening,
  - terminal churn cancellation,
  - notification auth health/classification,
  - recipient/match payload identity cleanup.
- Recorded PR #1188, commit `c532dca0ac324d02f0749a25c06097160357fbfb`, Supabase deployment state, verification commands, and open acceptance gaps.
- Recorded latest failed two-user session `1592aa53-f011-45ab-bcb4-e2685fe172b9`, where Ready Gate and Daily room creation succeeded but active Daily co-presence did not hold.
- Recorded PR #1190, merge commit `b72e487d65972566e63f508d023cf2e1e886734a`, Supabase migration `20260604142017_video_date_active_presence_join_guard.sql`, post-deploy dry-run, direct remote verification, branch cleanup, and remaining manual E2E/native gaps.
- Recorded latest failed two-user session `aac15b03-8de7-45e2-a11b-629cdd9b5b16`, where Ready Gate and Daily room handoff succeeded briefly but a Daily `participant-left` event triggered backend reconnect/terminalization before local transport grace could absorb the flap.
- Implemented the warm-up stabilization patch: local Daily transport grace before backend partner-away marking, explicit `daily_transport_grace_expired` reason, terminal survey hard-stop on web, ReadyRedirect force-survey state, native/mobile parity, peer-missing survey recovery guard, and migration `20260604170438_video_date_warmup_reconnect_stability.sql`. Later audit `782f5eb6-497f-4fd8-9898-2f47cf939751` narrowed the guard so historical remote-seen proof no longer suppresses current peer-missing.
- Recorded PR #1192, squash merge commit `b2a4a10ce22c2f4950b94fa6b9e49aa235c6c7fa`, Supabase migration cloud application, post-push dry-run, direct catalog verification, and branch cleanup state for the warm-up stabilization patch.
- Recorded latest failed two-user session `83e88141-ebab-4254-869a-c69db7bdb107`, where Ready Gate and Daily room handoff succeeded but repeated Daily rebuild/join/leave churn, stale joined presence, uncleared reconnect grace, and soft lifecycle away authority caused `reconnect_grace_expired` despite users staying in flow.
- Implemented the ultimate stabilization branch: same-session Daily call reuse, internal `daily_call_busy` retry, append-only Daily cleanup/reuse diagnostics, visibilitychange suppression while Daily is active, terminal survey hard-stop Daily teardown, native background grace-before-away, canonical remote-seen repair diagnostics, and migration `20260604193140_video_date_latest_presence_grace_repair.sql`.
- Applied `20260604193140_video_date_latest_presence_grace_repair.sql` to Supabase project `schdyxcunwcvddlcshwd`; post-push dry-run and direct catalog verification confirmed remote alignment, and linked advisors returned no error-level issues.
- Recorded PR #1194, squash merge commit `0a160cd975d87cd756e9c399e748810508f005cb`, remote/local branch deletion, Supabase post-merge dry-run, direct migration verification, green PR checks, green post-merge main checks, and production Vercel deployment `HXyMQQUBijhNcDLEfU4FreKuzPye`.
- Addressed PR #1194 review feedback by adding `20260604205645_video_date_remote_seen_latest_state.sql`, which makes canonical remote-seen timestamps latest-state evidence; applied it to Supabase cloud, verified both migration rows and function payload fields, and reran linked advisors with no error-level issues.

---

## Fresh Session Handoff Prompt

Use this prompt when starting a new Codex/agent session:

```text
You are continuing Vibely Video Date recovery in /Users/kaanporsuk/Documents/Vibely/Git/vibelymeet. Start by reading docs/video-date-success-command-center.md, docs/active-doc-map.md, AGENTS.md, CODEX.md, and CLAUDE.md. Treat docs/video-date-success-command-center.md as the active source of truth and update it after every material investigation, code change, migration, deploy, or manual QA result.

Current recovery work builds on PR #1212 merge commit `0a85449a0384f257d314a77c5a7fe455a71e2003` for shared entry/Daily owner plus stable-copresence guard, and PR #1213 commit `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8` for rollout documentation. The parent workspace has no remote; its local submodule-pointer handoff commit is `9d0536877ebb9c808abb8b538c68935bf0581702`. Supabase project `schdyxcunwcvddlcshwd` is currently applied/aligned through `20260606203000_video_date_provider_authoritative_presence.sql`, which makes stable copresence and Daily alive join-stamping provider-authoritative on top of service-only `video_date_presence_events`, `mark_video_date_daily_alive(...)`, and `video_date_stable_copresence_v1(session_id)`. Reverify current Git main/origin-main, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`, and live catalog markers before relying on this baseline.

The feature is still not proven healthy. Do not claim success from static tests, both_ready, route entry, Daily room creation, brief warm-up UI, or a terminal survey row. The required proof remains a fresh disposable two-user production run: match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> post-date survey opens and completes, plus a simulated short Daily leave/rejoin under 12s and a real prolonged absence terminalization check.

Current theory: Ready Gate, Daily room creation, canonical remote_seen, and immediate confirmed-encounter date promotion can succeed. The remaining risk is cross-surface owner churn plus provider-session churn causing stale joined evidence to start or extend handshake/date lifecycle. The latest local fix makes stable copresence provider-authoritative: stale or provider-null client heartbeats are telemetry only and cannot revive a Daily participant after a matching provider leave; web/native/mobile only send `owner_state='joined'` when Daily reports `joined-meeting` and exposes a local provider session id; `in_survey` with cleared `current_room_id` is now treated as active terminal-survey recovery, not lobby/deck ambiguity. The broader implemented fixes enforce same-session Daily start ownership/reuse, ref-backed live same-session Daily remount preservation without leave/destroy, short-lived date-route ownership from explicit handoff or active Daily/date evidence to suppress stale Ready Gate/lobby bounces, active `video` / `in_survey` route ownership across web/native/mobile, shared date-entry ownership keyed by `{session_id,user_id}`, route/session-level Daily ownership keyed by `{session_id,user_id,room_name}`, `mark_video_date_daily_alive` owner heartbeats, stable-copresence gating before handshake start, local Daily transport grace before backend partner-away, soft browser lifecycle handling during active Daily including `web_beforeunload`/`web_pagehide`, latest-state joined/away presence, canonical remote_seen latest-state repair from provider presence/media evidence, immediate confirmed-encounter promotion to date from `mark_video_date_remote_seen` / `video_session_handshake_auto_promote_v2`, confirmed-encounter deadline fallback rescue, positive launch-evidence deadline extension, 30-second video-date surface claims, surface-claim backoff, reconnect grace clearing on return/remote-seen/lifecycle active evidence, reconnect expiry recheck with current unexpired surface-claim proof only, survey-only peer-missing suppression, sticky `in_survey` until feedback, repair of already downgraded pending-survey registrations, terminal Daily room repair/preservation, provider-delete markers that do not null Daily room metadata, post-encounter peer absence reason `partner_absent_after_confirmed_encounter`, terminal-survey hard-stop on /date/:sessionId, outer fail-soft wrappers for exposed lifecycle RPCs, direct active-date handoff without lobby Daily prepare/restart, same-route forced survey recovery, append-only surface-claim audit events, append-only presence events, and preserved client continuity/parking/owner observability fields.

Applied implementation after the `d7507b5c-7837-4310-a52c-ebd10c1ae535` audit adds the missing single-owner route boundary: hydrated active `video` sessions, including terminal `in_survey`, own `/date/:sessionId` across web and native/mobile; lobbies no longer run Daily prepare for `in_survey`; stale Ready Gate opens are suppressed when date/survey ownership is already true; native survey recovery can force past duplicate-navigation/manual-exit suppression; and migration `20260605170249_video_date_surface_owner_outer_failsoft.sql` wraps `claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `get_or_seed_video_session_vibe_questions` with retryable JSON fail-soft shells. Corrective migration `20260605174703_video_date_vibe_question_outer_base_name_repair.sql` normalizes the preserved vibe-question base helper to `vd_vibe_q_outer_20260605170249_base` after the first cloud apply exposed a PostgreSQL identifier-truncation notice. Live verification showed both migrations applied, remote dry-run up to date, all four wrappers calling preserved bases, the short vibe-question helper present, and the truncated helper name removed.

Latest failed production audit after PR #1200: session 782f5eb6-497f-4fd8-9898-2f47cf939751 for event 6c9c647f-242b-463c-8b24-0896f02677e5 proved the remaining failure is no longer Ready Gate, room creation, remote_seen, or early date promotion. The session reached `date_started_at=2026-06-05T13:25:51.75678Z`, both users later left Daily, only participant 2 rejoined, `date_timeout` ended survey-eligible, no `date_feedback` rows existed, participant 1 stayed `in_survey`, and participant 2 was overwritten to `offline`. Before the terminal-survey lifecycle fix the final Daily room metadata was null; migration `20260605144003` repaired it, old cleanup workers re-nullified metadata, then migrations `20260605145306`, `20260605145926`, and `20260605150130` plus redeployed cleanup/outbox functions made the repair durable. Migration `20260605152058` repaired the already-overwritten participant 2 registration back to `in_survey` while no feedback exists. Live verification now shows `date-782f5eb6497f4fd898982f47cf939751` / `https://vibelyapp.daily.co/date-782f5eb6497f4fd898982f47cf939751` preserved with provider-delete markers, zero remaining ended survey-eligible room-metadata candidates, and both failed-session registrations in `in_survey`. The patched boundaries are historical encounter proof vs current peer presence, survey status persistence, pending-survey registration repair, terminal room metadata repair/preservation, cleanup marker semantics, and post-encounter absence handling.

Latest failed production audit after terminal-survey lifecycle hardening: session d7507b5c-7837-4310-a52c-ebd10c1ae535 for event 46c03a11-925f-4678-aab5-874d28500458 shows the previous backend fixes held but the user flow is still not acceptable. Ready Gate committed `ready_b` at `2026-06-05T15:47:17.449329Z` and `both_ready` at `2026-06-05T15:47:18.496863Z`; Daily room `date-d7507b5c78374310a52cebd10c1ae535` was created/preserved; Daily webhooks show both users joined, participant 2 left at `15:48:34.677Z`, participant 1 left at `15:48:50.351Z`, and only participant 1 rejoined before timeout; `mark_video_date_remote_seen` promoted the confirmed encounter to `date`; `date_timeout` ended at `2026-06-05T15:52:53.855203Z` with `survey_required=true`, `survey_eligible=true`, both registrations remained `in_survey`, final room metadata plus provider-delete markers were preserved, and no `date_feedback` rows existed. This proves the old room-metadata and sticky-survey persistence bugs are addressed for this run. The remaining failures are client-side route/surface/Daily churn and survey completion: screenshots showed `/ready`, `/date`, and `/event/.../lobby` churn; observability recorded 27 `date_route_entered`, 21 `daily_join_started`, 54 `daily_call_cleanup`, repeated `external_call_busy`, `peer_missing_suppressed_remote_seen`, and ReadyRedirect later forced `go_survey`, but no feedback was submitted. Console also showed raw 500s for `mark_video_date_remote_seen`, `claim_video_date_surface`, `mark_video_date_daily_joined`, and `get_or_seed_video_session_vibe_questions`; exposed lifecycle RPCs must be outermost fail-soft and non-blocking under stale/duplicate/terminal calls. The next implementation plan should prioritize a single cross-surface date/survey owner, eliminate active same-session Daily unmount churn, make terminal survey recovery visible and submit-resilient from any surface, and harden all exposed lifecycle RPC wrappers.

Latest failed production audit after surface-owner/fail-soft hardening: session f3d1bd2a-5c37-43bb-9a9a-ec3c78fe7442 for event 9ac64807-7fe3-41b1-86db-49a3d4053b56 shows Ready Gate, Daily room creation, `date_started_at`, bilateral joins, and remote-media evidence all worked. The date still ended incorrectly because `mark_reconnect_self_away` with `reason=web_beforeunload` opened reconnect grace while users were visibly in the date; `expire_video_date_reconnect_graces` later treated that lifecycle false-away as terminal. Implementation applied: web lifecycle `beforeunload`/`pagehide`/`visibilitychange`/`freeze` are soft telemetry while Daily is active or starting, active soft lifecycle handling does not stop local tracks, web/native `video_date` surface claims use a 30-second server TTL, migration `20260605200729_video_date_beforeunload_active_presence_repair.sql` suppresses/clears lifecycle reconnect grace when latest joined, remote-media, or active surface evidence proves the session is still live, follow-up migration `20260605203904_video_date_remote_seen_grace_payload_preserve.sql` preserves base `reconnect_grace_cleared=true` in the outer remote-seen response, and corrective migration `20260605211924_video_date_surface_claim_expiry_current_guard.sql` requires surface-claim evidence to still be current at reconnect-expiry time.

Latest failed production audit after PR #1204 and review-comment follow-ups: session `4082fe36-8480-4d30-9a1d-1de227b855e3` for event `cdb38cb8-acfb-4fa1-b732-10903eccc3b0` shows the backend can still reach Ready Gate `both_ready`, canonical Daily room verification, bilateral Daily joins, remote-media evidence, and immediate `date_started_at=2026-06-05T22:14:53.753531Z`. The product still failed because the active client owner was unstable: the UI churned across `/date`, `/ready`, and lobby, observability recorded 18 date route entries, 6 Daily starts, 26 Daily cleanup rows, and 7 `external_call_busy` retries, and Daily webhooks ended with both participants leaving by `22:16:53.812Z`. Surface claims expired at `22:17:06Z` / `22:17:07Z`; reconnect expiry at `22:18:00.839509Z` ended as `reconnect_grace_expired`, `survey_required=true`, and both registrations `in_survey`, but no `date_feedback` rows were created. The next change should focus on single date/survey ownership, route-level Daily lifetime, terminal survey hard-stop recovery, outermost fail-soft `video_date_transition` / queue RPCs, and durable telemetry for Daily parking, surface claims, and away/grace triggers.

Applied implementation after the `4082fe36-8480-4d30-9a1d-1de227b855e3` audit: web and native/mobile now mark `/date/:sessionId` owned on active session/date-route hydration; lobby active `in_handshake` / `in_date` handoffs skip Daily prepare and route directly to the date owner; terminal `in_survey` remains a forced date/survey owner; and native terminal survey recovery clears local joining/reconnect state before rendering survey. Migration `20260605232304_video_date_single_owner_runtime_hardening.sql` is applied to Supabase and adds service-only `video_date_surface_claim_events`, fail-soft wrappers for `video_date_transition`, `get_video_date_queue_hint_v1`, `drain_match_queue_v2`, and `claim_video_date_surface`, plus widened `record_video_date_client_stuck_observability` detail preservation for route ownership, same-session continuity, singleton parking, and truth-refresh fields. Verification passed focused contracts, web/core/mobile typechecks, app typecheck, Supabase post-apply dry-run/list/marker queries, linked public-schema lint, and `git diff --check`. This is still not acceptance proof.

Second-pass CTO audit follow-up on 2026-06-06 found one native/mobile parity gap: pending-survey navigation was represented only as generic `force`, while web uses explicit `forceSurvey` intent. Native event-lobby navigation now accepts `forceSurvey`, treats it as the force bypass plus survey-only prepare suppression, and all native pending-survey call sites pass it (`active_session_hydration`, registration realtime/refetch, video-session update/insert, and Ready Gate canonical survey recovery). The shared contract now asserts the native `forceSurvey` option, `forceNavigation = force || forceSurvey`, `skipPrepare = skipPrepare || forceSurvey`, and every native survey-intent call site. Verification in this audit passed `npx tsx --test shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/observability/videoDateClientStuckObservability.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated RLS skips, `npm run typecheck`, `npm run lint`, `git diff --check`, linked Supabase migration list/dry-run aligned through `20260605232304`, linked public-schema lint with no error-level findings, and linked error-level advisors with `No issues found`. No web or native build was run, and no ignored env/cache/build artifacts were removed.

Third-pass CTO audit follow-up on 2026-06-06 found one additional native/mobile deep-link gap: `adviseVideoSessionTruthRecovery()` could return `go_survey` from the legacy/fallback notification truth path, but `NotificationDeepLinkHandler` only handled `go_date`, `go_ready_gate`, and `go_lobby` after that fallback and could send a pending-survey terminal encounter back to lobby/tabs. Native notification date links now mark `/date/:sessionId` route ownership for both snapshot and fallback truth recovery, and fallback `go_survey` returns `/date/:sessionId` with `pending_survey_terminal_encounter` diagnostics so the Date stack owns terminal survey recovery. The shared Phase 5 contract now asserts snapshot `go_date`/`go_survey` route ownership plus fallback `go_date` and `go_survey` ownership/routing. Verification passed `npx tsx shared/matching/videoDatePhase5TimelineContracts.test.ts`, `npx tsx --test shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts shared/matching/videoDatePhase5TimelineContracts.test.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/observability/videoDateClientStuckObservability.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated RLS skips, `npm run typecheck`, `npm run lint`, `git diff --check`, linked Supabase migration list/dry-run aligned through `20260605232304`, linked public-schema lint with no error-level findings, and linked error-level advisors with `No issues found`. No web or native build was run during that implementation verification pass. A later documentation-only cleanup accidentally invoked the web build via a shell search quoting mistake; it emitted Vite dynamic-import/chunk-size warnings, no native build was run, `git status --short` showed no generated build artifacts, and this accidental build is not acceptance proof. This is still not acceptance proof.

Fourth-pass implementation on 2026-06-06 after failed session `c9dc7af1-1f40-431f-93ed-4435019126aa` for event `43d1614c-9b2d-45d6-be59-c56fa6cb852f`: the latest run proved Ready Gate, same Daily room, visible local/remote media, and date UI could appear, but participant 2's Daily provider session left at `2026-06-06T19:22:52Z` and never had a later provider join. Client heartbeats with missing or stale provider proof then kept the backend believing both sides were active/stable, so the UI showed waiting/current-date surfaces while the provider ledger said one user was gone; the date later timed out survey-required with no feedback rows. Implementation adds applied migration `20260606203000_video_date_provider_authoritative_presence.sql`, which makes `video_date_stable_copresence_v1` provider-authoritative: stable copresence, `remote_seen`, and `already_date` shortcut all require current Daily provider presence or a recent provider-session-backed client alive that is not contradicted by a matching Daily `participant.left`. `mark_video_date_daily_alive(...)` now records every heartbeat but only clears away/join-stamps when `owner_state='joined'`, `provider_session_id` is present, and the current provider ledger supports that provider session. A fresh provider session after an older left is accepted for rejoin/webhook-lag recovery; the same or unknown left provider session is not.

Fourth-pass client changes: web `useVideoCall` and native/mobile `/date/[id]` no longer report Daily owner state `joined` merely because the route is alive. They read the Daily meeting state and local provider session id; only `joined-meeting` plus a non-empty provider session id sends `owner_state='joined'`, otherwise the heartbeat is `joining` or `lost`. Web and native/mobile event lobbies now treat `queue_status='in_survey'` with a cleared `current_room_id` as an active terminal-survey recovery signal: they clear stale Ready Gate state, set post-survey/recovery UI state, refetch active session immediately, and do not fall through to deck/lobby ambiguity.

Fourth-pass verification: initial linked dry-run showed only `20260606203000_video_date_provider_authoritative_presence.sql` pending, then `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes` applied it to project `schdyxcunwcvddlcshwd`. Fresh post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed local/remote aligned through `20260606203000`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`. Local validation passed `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`, full `npm run typecheck`, full `npm run test:video-date-v4` with only the two expected env-gated runtime RLS skips, and `git diff --check`. No web build, native build, or fresh two-user acceptance run was performed in this implementation pass. This is still not acceptance proof.

Before changing code, inspect the latest failed or acceptance session with Supabase/Daily evidence in order. Capture event_id, video_session_id, both user IDs, Ready Gate payloads, video_session_commands, video_date_daily_webhook_events, video_date_surface_claims, video_date_presence_events, event_loop_observability_events, Daily room/session IDs, participant joined/left order, participant_*_away_at, participant_*_remote_seen_at, reconnect_grace_ends_at, latest away reason, ended_reason, survey_required, date_feedback rows, event_registrations queue_status/current_room_id, final daily_room_name/url, daily_room_provider_deleted_at/delete_reason, and any RPC response bodies with sqlstate/message/hot_path/expiry_grace_applied/retryable_command_reopened/daily_transport_grace_expired/away_mark_suppressed/reconnect_grace_cleared/reconnect_grace_cleared_by_remote_seen/latest_remote_seen_at/early_confirmed_encounter_promoted/promotion_reason/confirmed_encounter_promoted_to_date/confirmed_encounter_deadline_rescue/handshake_deadline_extended_for_launch_evidence_v2/surface_claim_backoff/surface_active_near_away/current_unexpired_surface_claim/recent_lifecycle_media/same_session_daily_continuity_latched/parked_singleton/historical_remote_seen_truth/truth_refresh_attempt/partner_absent_after_confirmed_encounter/waiting_for_stable_copresence/stable_copresence/latest_owner_heartbeat_at/owner_id/owner_state/entry_attempt_id/call_instance_id/provider_session_id/daily_owner_provider_left_unexpected.

If the next run fails, decide precisely which boundary diverged from expected behavior: Ready Gate hot path, date route ownership, Daily start ownership, same-session Daily remount parking/reuse, provider join/leave ledger, canonical remote_seen repair, immediate confirmed-encounter promotion, confirmed-encounter deadline fallback rescue, positive launch-evidence extension, browser/native lifecycle-away suppression including `web_beforeunload`, reconnect grace clearing/expiry, active surface-claim continuity, current-peer detection, post-encounter absence ending, sticky survey status, pending-survey registration repair, terminal room repair/preservation, cleanup marker semantics, terminal survey hard-stop, or survey persistence. Propose scoped changes only after that evidence is collected.
```
