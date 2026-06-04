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

---

## Current Architecture Decisions

### Backend owns lifecycle truth

The client should render and retry, not invent lifecycle state. Authoritative truth lives in Supabase-backed session state and RPC responses.

### Mark-ready is a hot path

`video_session_mark_ready_v2` must stay narrow:

- verify participant,
- preserve idempotency,
- persist readiness,
- derive canonical room metadata at both-ready,
- enqueue provider work fail-soft,
- return structured payload.

It must not synchronously create/provider-verify Daily rooms or depend on network/provider latency.

### Daily room metadata must be deterministic

The canonical Daily room for a video session is deterministic (`date-<sessionId-without-dashes>` style, per existing helpers). Missing row metadata must not make the route bounce forever if the canonical room can be derived safely.

### Daily active co-presence is stronger than joined history

`participant_1_joined_at` and `participant_2_joined_at` are historical launch evidence. They are not sufficient proof that both users are currently co-present in Daily. The latest provider presence must still be active for both users: a later Daily `participant.left` / `participant_*_away_at` makes that participant inactive until a newer join clears the away stamp. `mark_video_date_daily_joined` must start or extend the visible handshake only when both participants' latest Daily presence is active.

### Retryable is not terminal

Any payload with `retryable: true` must keep the user in syncing/retrying posture. "Ready Gate changed" is reserved for true replacement, terminal expiry, or multi-tab handoff.

### Terminal means stop work

Once canonical truth says `ended`, `ready_gate_expired`, forfeited, or replaced, clients must cancel prewarm, permission prewarm, route preload, and Ready Gate retries.

---

## Open Gaps And Risks

These are not claims that the current code is broken; they are the unproven areas that must be validated before declaring recovery complete.

1. **No fresh successful manual E2E proof yet.** The final acceptance run must prove match -> survey completion after the latest deploy.
2. **Production SQLSTATE history is incomplete.** Some earlier fixes were shipped without full log forensics. The newer wrappers should expose future residual SQLSTATE/message, but old failures may remain partly inferred.
3. **Daily co-occupancy must be observed, not assumed.** Passing requires both users in the same Daily room at the same time with remote tracks mounted.
4. **Static and CI checks passed after PR #1190, but they are not acceptance proof.** The deployed active-presence guard still needs a real two-user production run.
5. **Native/mobile runtime needs physical-device smoke.** Static parity and contracts are not enough for mobile media permissions, push, app backgrounding, and route restoration.
6. **PostHog rate-limit spam remains noisy.** It is probably not the Video Date root cause, but it can hide useful console signals and should be handled separately.
7. **OneSignal 409 identity noise remains non-blocking but distracting.** It should not block Video Date, but provider health should stay visible.
8. **Manual survey completion still needs proof.** Many recent fixes focused on match -> Ready Gate -> room entry; survey end-to-end persistence must be revalidated.

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
13. Confirm no raw 500s from:
    - `video_session_mark_ready_v2`
    - `ready_gate_transition`
    - `video_date_transition`
    - `claim_video_date_surface`
    - `mark_video_date_daily_joined`
    - `video-date-token-refresh`
    - `daily-room`
14. Confirm no stale "This Ready Gate changed" copy unless there is a real duplicate-tab/session replacement case.
15. Query Supabase and Daily afterward for the exact session timeline.
16. Confirm the Daily webhook ledger has `participant.joined` and `participant.left` rows for both users when they actually join/leave.
17. Confirm `mark_video_date_daily_joined` logged `handshake_started_after_active_daily_copresence` only after both latest Daily presences were active, and `daily_join_waiting_for_active_partner` only when the partner's latest presence was absent or away.

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
  - `expiry_grace_applied`
  - `hot_path`
  - `sqlstate`
  - `legacy_mark_ready_signature_detected`
  - `daily_join_waiting_for_active_partner`
  - `handshake_started_after_active_daily_copresence`

Do not treat "This Ready Gate changed" as a root cause. Treat it as a symptom and prove why the client selected stale terminal copy.

---

## Primary Files To Inspect For Future Work

Backend / migrations:

- `supabase/migrations/20260604093000_video_date_failsoft_date_room_rpcs.sql`
- `supabase/migrations/20260604094500_video_date_transition_preserve_raise_semantics.sql`
- `supabase/migrations/20260604103000_ready_gate_mark_ready_hot_path_retry_recovery.sql`
- `supabase/migrations/20260604104154_ready_gate_mark_ready_grace_notification_auth.sql`
- `supabase/migrations/20260604142017_video_date_active_presence_join_guard.sql`

Web:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/hooks/useReadyGate.ts`
- `src/pages/VideoDate.tsx`
- `src/hooks/useVideoCall.ts`
- `src/hooks/useVideoDateDupTabGuard.ts`

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
- `shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`
- `shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `shared/matching/phase2PaymentsDurableNotifications.test.ts`

Runbooks:

- `docs/video-date-diagnostics-runbook.md`
- `docs/video-date-end-to-end-hardening-runbook.md`
- `docs/video-date-hardening-closure-handoff.md`
- `docs/video-date-post-release-monitoring-runbook.md`
- `docs/video-date-daily-webhook-operator-checklist.md`

---

## Update Log

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
