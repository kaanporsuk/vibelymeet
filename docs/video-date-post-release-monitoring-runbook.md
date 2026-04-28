# Video Date Post-Release Monitoring Runbook

## Release Baseline

Use this checklist for the first live event or beta after the Video Date hardening chain in PRs #562 through #568.

- Baseline main HEAD: `e4142cbb3b91a6e5677c17d63b54f369cf4240d5`
- Applied migrations: `20260501131000`, `20260501132000`, `20260501133000`
- Deployed functions from the campaign: `daily-room`, `video-date-room-cleanup`
- Native caveat: mobile runtime changes require normal native delivery before native results are considered representative.
- Do not run Supabase deploys from this checklist.

## Search Keys

Use these keys consistently across PostHog, Sentry, Supabase Edge logs, and support notes:

- `session_id` or `video_session_id`
- `event_id`
- `user_id`
- `entry_attempt_id` when present
- Daily room name when safe, usually `room_name` or `daily_room_name`
- `source_surface`
- `source_action`
- `outcome`
- `reason_code`
- `retryable`

Never paste Daily meeting tokens, auth headers, provider secrets, raw profile objects, or full unbounded error objects into tickets or dashboards.

## Before Event Start

Check:

- Vercel production deployment is healthy for the release commit.
- Supabase functions are ACTIVE: `daily-room`, `video-date-room-cleanup`, `post-date-verdict`, `swipe-actions`, `admin-video-date-ops`.
- Migrations `20260501131000`, `20260501132000`, and `20260501133000` are local and remote.
- Daily dashboard/service status is healthy.
- PostHog/Sentry search by `session_id` and `event_id` is ready.
- Native build or OTA carrying PRs #563, #564, #567, and #568 is delivered before native QA.

Healthy signals:

- No recent `daily-room` auth/config errors.
- No repeated `video-date-room-cleanup` provider-check failures.
- Test accounts can enter the target event lobby.
- Operator knows the event id before users start swiping.

Warning signals:

- Vercel is still building or GitHub checks are pending.
- Supabase function list shows stale or inactive required functions.
- Native users are on a pre-hardening build.

Red-alert signals:

- `daily-room` is not ACTIVE.
- Required migrations are missing remotely.
- Daily provider outage is active before event start.

Immediate action:

- Pause beta start if a red-alert signal is present.
- Use web-only beta if native delivery has not landed.
- Escalate provider outage separately before touching Vibely state.

## Swipe And Ready Gate

Monitor PostHog:

- `ready_gate_impression`
- `ready_gate_ready_tap`
- `video_date_ready_gate_ready`
- `ready_gate_both_ready_observed`
- `ready_gate_handoff_recovery`
- `ready_gate_terminal_action_success`
- `ready_gate_terminal_action_failure`

Monitor backend/support context:

- One active `video_sessions` row per pair.
- `event_registrations.current_room_id` points at the expected session while the gate is active.
- `ready_gate_status` progresses without client-local drift.

Healthy signals:

- Mutual swipe returns a `video_session_id`.
- Both users see the same Ready Gate session.
- Terminal action success is followed by lobby recovery, not silent local close before server success.

Warning signals:

- Multiple `ready_gate_handoff_recovery` events for the same `session_id`.
- Repeated terminal action failures with `retryable: true`.
- One user reports Ready Gate while the other is already in date.

Red-alert signals:

- Users stuck in Ready Gate with `ready_gate_status = both_ready` and no prepare-entry start.
- Duplicate active sessions for the same pair.
- Nonparticipant access or wrong user routed into a session.

Immediate action for users stuck in Ready Gate:

1. Search by `session_id`.
2. Confirm both participants and `event_id`.
3. Check Ready Gate events and `ready_gate_status`.
4. If both-ready exists but prepare never starts, ask users to retry/reopen once.
5. If duplicate sessions exist or route ownership is inconsistent, stop the event slice and escalate engineering with the session ids.

## Daily Prep And Join

Monitor PostHog:

- `video_date_prepare_entry_started`
- `video_date_prepare_entry_success`
- `video_date_prepare_entry_failure`
- `video_date_prepare_entry_failed_no_nav`
- `video_date_daily_token_success`
- `video_date_daily_token_failure`
- `video_date_daily_join_started`
- `video_date_daily_join_success`
- `video_date_daily_join_failure`
- `video_date_remote_seen`
- `video_date_first_remote_frame`

Monitor Edge logs:

- `prepare_date_entry_ok`
- `video_date_provider_room_missing_or_expired_recovering`
- `video_date_provider_room_metadata_recanonicalized`

Healthy signals:

- Each both-ready session has a prepare-entry attempt.
- Prepare success includes `entry_attempt_id`.
- Both users join the same Daily room name.
- `video_date_remote_seen` or `video_date_first_remote_frame` appears after both joins.

Warning signals:

- Provider room recovery appears occasionally but succeeds.
- `video_date_prepare_entry_failed_no_nav` appears and is followed by Ready Gate recovery.
- Join succeeds for one user but remote is not seen within the normal waiting window.

Red-alert signals:

- Tokens issued from stale room metadata are suspected.
- Provider 401/403 appears for valid participants.
- High-rate `DAILY_RATE_LIMIT`, `DAILY_PROVIDER_UNAVAILABLE`, or `DAILY_PROVIDER_ERROR`.
- Users join different Daily room names for the same `session_id`.

Immediate action for prepare entry failures:

1. Search `entry_attempt_id` and `session_id`.
2. Compare client event `reason_code` with `daily-room` logs.
3. If retryable/provider unavailable, ask users to retry once and watch recovery.
4. If access denied or blocked pair is unexpected, escalate with participants and session id.

Immediate action for Daily room/token failures:

1. Confirm the user is a participant.
2. Confirm session is not ended and is entry-eligible.
3. Search Edge logs for provider recovery or provider verification failure.
4. Do not manually create provider rooms.
5. If multiple users fail with provider codes, escalate as provider incident.

Immediate action for no remote participant:

1. Search both users by `session_id`.
2. Check `video_date_daily_join_success` for both.
3. Check `video_date_remote_seen` and `video_date_no_remote_wait_started`.
4. Ask the missing user to reopen only once if their join is absent.
5. If both joined and no remote is seen, escalate with room name and timestamps.

## Post-Date Survey And Verdict

Monitor PostHog:

- `video_date_survey_opened`
- `video_date_survey_recovered`
- `post_date_survey_impression`
- `post_date_survey_submit`
- `video_date_survey_submitted`
- `post_date_verdict_submit_failed`
- `post_date_verdict_submit_retry`
- `post_date_verdict_submit_success_after_retry`
- `mutual_vibe_outcome`

Monitor database state through approved read-only tooling:

- `video_sessions.ended_at`
- `video_sessions.date_started_at`
- `event_registrations.queue_status`
- `date_feedback` row for the current user and session

Healthy signals:

- Ended dates with real date evidence show survey.
- Closing/reopening before verdict emits `video_date_survey_recovered`.
- Verdict submission either completes mutual result or enters a clear pending-partner state.

Warning signals:

- Survey recovery fires repeatedly for the same user and session.
- Verdict submit retry is needed but eventually succeeds.
- One user submits while the other remains pending.

Red-alert signals:

- User with ended date and no feedback cannot recover survey.
- `date_feedback` exists but UI still asks the same user to submit.
- Mutual match creation contradicts blocked/reported state.

Immediate action for pending survey not recovered:

1. Search by `session_id` and `user_id`.
2. Confirm `date_started_at` and `ended_at` exist.
3. Confirm no `date_feedback` row exists for that user.
4. Confirm route emits no `video_date_survey_recovered`.
5. Escalate as a recovery regression with session id, user id, and current `event_registrations` snapshot.

## After Event Cleanup

Monitor Edge logs:

- `cleanup_deferred_active_participants`
- `cleanup_deferred_provider_check_failed`
- `cleanup_room_not_found`
- `cleanup_delete_failed`
- `video-date-room-cleanup`

Healthy signals:

- Ended rooms are deleted or metadata is cleared after safe checks.
- Active provider participants defer cleanup.
- Provider 404 only clears local metadata when session state is safe.

Warning signals:

- Repeated provider check deferrals for the same room.
- `cleanup_delete_failed` appears for rooms already safe to delete.
- Cleanup summary shows rising deferred counts.

Red-alert signals:

- Cleanup deletes or clears metadata while users are active.
- Provider 429/5xx is treated as cleanup success.
- Ready Gate expiry is applied to sessions with joined/date evidence.

Immediate action for cleanup deferrals:

1. Search room name and `session_id`.
2. Classify deferral: active participants, provider check failed, missing room, or delete failed.
3. For active participants, wait and recheck after the room quiets.
4. For provider 429/5xx, treat as retryable provider instability.
5. For delete failures, escalate with room name and cleanup log line.

## Rollback And Escalation Map

Web rollback:

- Revert or redeploy the previous known-good Vercel deployment.
- Use when web-only analytics/routing regression is confirmed.

Supabase migration rollback:

- Use forward migration only.
- Do not edit historical migrations or run ad hoc destructive changes.

Function rollback:

- `daily-room`: redeploy previous known-good source if provider verification/recovery regresses.
- `video-date-room-cleanup`: redeploy previous known-good source if cleanup starts deleting or clearing unsafe rooms.
- Do not bulk deploy functions.

Native rollback/update:

- If OTA is available and compatible, publish a corrective OTA bundle.
- If the production binary lacks required native runtime support, use the normal binary release path.
- If native delivery has not landed, mark native monitoring as not representative and prioritize web-only release checks.

Escalate immediately when:

- Users can be stranded without recovery.
- Users are routed into the wrong session or room.
- Tokens fail for valid participants across multiple sessions.
- Cleanup destroys active or recoverable sessions.
- Post-date survey recovery fails for a user with ended date evidence and no feedback.

## Native Delivery Caveat

PRs #563, #564, #567, and #568 changed native runtime files. The post-release monitoring result for native is valid only after the shipped native bundle includes those changes. No new native dependency was added in the hardening chain, so OTA should be sufficient when the currently installed binary already supports the existing native modules.

