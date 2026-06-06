# Video Date Post-Release Monitoring Runbook

Current recovery overlay (2026-06-06): for active Video Date recovery, start with `docs/video-date-success-command-center.md`. Functional Video Date code landed in PR #1200 at merge commit `fbca4996a096273914ee650b556ba7994477aa5e`; terminal-survey lifecycle hardening adds `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, and `20260605152058_video_date_pending_survey_registration_repair.sql`, plus redeployed cleanup/outbox Edge Functions. The lifecycle false-away and review-comment follow-ups add `20260605200729_video_date_beforeunload_active_presence_repair.sql`, `20260605203904_video_date_remote_seen_grace_payload_preserve.sql`, `20260605211924_video_date_surface_claim_expiry_current_guard.sql`, `20260605221535_review_comments_1199_1204_followups.sql`, and `20260605222458_review_comments_helper_name_repair.sql`; lifecycle reconnect graces must be suppressed or cleared when fresh Daily joined, remote-media, or current unexpired `video_date` surface evidence proves the date is still live. The single-owner runtime hardening adds `20260605232304_video_date_single_owner_runtime_hardening.sql`: active date/survey route ownership must suppress lobby/Ready Gate Daily prepare churn, transition/queue/surface RPCs should return structured retryable JSON instead of raw 500s, `video_date_surface_claim_events` should preserve claim history, and stuck-client observability should retain same-session continuity and singleton parking fields. The latest owner/stable-copresence implementation adds shared date-entry and Daily owner contracts in code plus local migration `20260606180000_video_date_stable_copresence_handshake_guard.sql`, which is dry-run validated but intentionally not cloud-applied until heartbeat-capable web/native/mobile clients are deployed. The third-pass native notification audit adds one monitoring lesson: `/date/:sessionId` notification taps that reconcile to pending-survey terminal truth must mark route ownership and land on the Date stack, not lobby/tabs. Latest failed session `4082fe36-8480-4d30-9a1d-1de227b855e3` remains the failure baseline; the next monitoring focus is whether the new owner boundary holds through survey completion. Verify current Git and deployment state before assuming no docs-only follow-up sits on top. Static/CI/cloud checks can verify implementation only; the fresh manual two-user match -> survey acceptance run is still unproven.

## Release Baseline

Use the current v4.2 baseline for live Video Date rollout, certification, and monitoring. The older PR #562-#568 baseline below is retained only as historical context for the first hardening campaign.

Current 2026-06-05 recovery baseline:

- Functional Video Date code baseline: `fbca4996a096273914ee650b556ba7994477aa5e` (PR #1200 merge).
- Confirmed-encounter stability PR: `https://github.com/kaanporsuk/vibelymeet/pull/1200`.
- Confirmed-encounter deadline rescue PR: `https://github.com/kaanporsuk/vibelymeet/pull/1199`.
- Prior recovery hardening PR: `https://github.com/kaanporsuk/vibelymeet/pull/1196`.
- Functional stabilization PR: `https://github.com/kaanporsuk/vibelymeet/pull/1194`.
- Supabase project: `schdyxcunwcvddlcshwd`.
- Latest applied/expected Video Date recovery migrations: `20260604142017_video_date_active_presence_join_guard.sql`, `20260604170438_video_date_warmup_reconnect_stability.sql`, `20260604193140_video_date_latest_presence_grace_repair.sql`, `20260604205645_video_date_remote_seen_latest_state.sql`, `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`, `20260605115657_video_date_early_confirmed_encounter_promotion.sql`, `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, `20260605152058_video_date_pending_survey_registration_repair.sql`, `20260605170249_video_date_surface_owner_outer_failsoft.sql`, `20260605174703_video_date_vibe_question_outer_base_name_repair.sql`, `20260605200729_video_date_beforeunload_active_presence_repair.sql`, `20260605203904_video_date_remote_seen_grace_payload_preserve.sql`, `20260605211924_video_date_surface_claim_expiry_current_guard.sql`, `20260605221535_review_comments_1199_1204_followups.sql`, `20260605222458_review_comments_helper_name_repair.sql`, and `20260605232304_video_date_single_owner_runtime_hardening.sql`. Coordinated rollout migration `20260606180000_video_date_stable_copresence_handshake_guard.sql` is local/dry-run validated and should be pushed only after matching clients are live.
- Post-deploy database status: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` reported the remote database is up to date after `20260605232304`.
- Supabase schema lint completed after the latest migration with no error-level issues; warning-level items were pre-existing and unrelated to the terminal-survey or lifecycle false-away migrations.
- Acceptance caveat: no fresh deployed manual two-user match -> survey run has passed yet. Treat this runbook as monitoring guidance, not recovery closure.

Current Video Date v4.2 baseline as of 2026-05-22:

- Baseline main HEAD: `be08b60b1` (`Harden profile photo derivatives`). PR #992 at `196fd676a840970c13197eee71a4bbbd78c9dd06` remains the Phase 7/8 automation baseline, and `e6f086eef` remains the Daily webhook signature compatibility baseline.
- Supabase project: `schdyxcunwcvddlcshwd`.
- Latest applied Video Date migration: `20260522150000_video_date_phase8_rollout_readiness_self_check.sql`. Latest applied media/profile derivative migration: `20260522161000_media_derivatives_placeholders_realtime.sql`.
- Latest verified operational functions from the audit closures: `admin-video-date-ops` version `310`, `video-date-daily-webhook` version `8`, and `synthetic-video-date-monitor` version `10`.
- Post-deploy database status: `supabase db push --linked --dry-run` reported the remote database is up to date.
- Manual app smoke remains separate. Do not run web/native builds from this monitoring runbook.
- Do not recreate the Daily webhook or rotate/print `DAILY_WEBHOOK_SECRET`; use webhook UUID `a5407924-6f29-4a35-835a-ff5185eeae5c`.
- Required automated gate: run `npm run certify:video-date:required` before release decisions. This includes live RLS required mode (`npm run test:video-date-runtime-rls:required`) when `VIDEO_DATE_RLS_*` and `VIDEO_DATE_PUBLIC_API_RLS_*` env vars are populated for a seeded staging/synthetic project, plus the Daily config readiness check.
- Daily config is fail-closed for staging/production certification: `DAILY_DOMAIN`, `DAILY_API_KEY`, `DAILY_WEBHOOK_SECRET`, and `CRON_SECRET` or `PHASE8_STAGING_CRON_SECRET` must be present. The `vibelyapp.daily.co` domain fallback is allowed only when `ENVIRONMENT` is explicitly local/dev/test.
- Operator tooling note: Supabase CLI v2.101.0 or newer is recommended. Node `DEP0205` warnings are non-blocking while the Video Date contract and typecheck commands pass; dependency upgrades are tracked separately from runtime reliability.

Historical baseline for the first hardening campaign:

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
- `video_date_trace_id`
- `owner_id`
- `owner_state`
- `entry_attempt_id`
- `call_instance_id`
- `provider_session_id`

Never paste Daily meeting tokens, auth headers, provider secrets, raw profile objects, or full unbounded error objects into tickets or dashboards.

## Before Event Start

Check:

- Vercel production deployment is healthy for the release commit.
- Supabase functions are ACTIVE for the current v4.2 surface: `daily-room`, `video-date-snapshot`, `video-date-outbox-drainer`, `video-date-deadline-finalizer`, `video-date-daily-webhook`, `video-date-orphan-room-cleanup`, `video-date-recovery-alert-dispatcher`, `synthetic-video-date-monitor`, `post-date-verdict`, `swipe-actions`, and `admin-video-date-ops`.
- Current Video Date recovery migrations through `20260605232304_video_date_single_owner_runtime_hardening.sql` are local and remote, and `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup` should be deployed with provider-delete markers instead of room-metadata nulling.
- If `20260606180000_video_date_stable_copresence_handshake_guard.sql` is being prepared, confirm web/native/mobile clients in that environment send `mark_video_date_daily_alive` heartbeats before applying it.
- Daily dashboard/service status is healthy.
- PostHog/Sentry search by `session_id` and `event_id` is ready.
- Native build or OTA carrying the v4.2 Video Date client surface is delivered before native QA; manual native smoke is recorded through the Phase 8 ledger.

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

## Daily Webhook Registration

Daily webhook provider registration is complete. Do not create another webhook and do not rotate or print `DAILY_WEBHOOK_SECRET` during monitoring.

Registered provider state:

- Webhook UUID: `a5407924-6f29-4a35-835a-ff5185eeae5c`
- URL: `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`
- Event types: `participant.joined`, `participant.left`
- State at closure: `ACTIVE`
- Retry type: `exponential`
- Failed count at closure: `0`

Registration proof:

- Signed `{"test":"test"}` probe returned HTTP 200 with `{"ok":true,"test":true}`.
- Daily `POST /webhooks` returned HTTP 200.
- `lastMomentPushed` remains `null` until a real subscribed participant event is delivered.

Real two-user webhook smoke:

1. Use two internal test users in a controlled event and enter a video date through the normal app flow.
2. Record only non-secret identifiers: `event_id`, `video_session_id`, `daily_room_name`, and both participant user ids.
3. User A joins, then User B joins, and both confirm the same Daily room.
4. User A leaves through the normal app path; then User B leaves or ends the date normally.
5. In Daily, confirm `lastMomentPushed` is non-null, `failedCount` remains `0`, and deliveries include `participant.joined` and `participant.left`.
6. In Supabase Edge logs, confirm `video-date-daily-webhook` accepted real-event invocations with HTTP 200.
7. In the webhook ledger, confirm rows exist for the provider event ids, room name, event type, participant ids, and processed result.
8. In `video_sessions`, confirm matched joins set or preserve the participant joined timestamp, and matched leaves set away timestamp only when the session is still non-terminal.

Read-only ledger check shape:

```sql
select
  provider_event_id,
  event_type,
  room_name,
  provider_participant_id,
  provider_user_id,
  processing_state,
  processing_result,
  session_id,
  occurred_at,
  processed_at
from public.video_date_daily_webhook_events
where room_name = '<daily_room_name>'
order by occurred_at desc
limit 20;
```

Read-only session check shape:

```sql
select
  id,
  daily_room_name,
  participant_1_id,
  participant_2_id,
  participant_1_joined_at,
  participant_2_joined_at,
  participant_1_away_at,
  participant_2_away_at,
  participant_1_remote_seen_at,
  participant_2_remote_seen_at,
  handshake_started_at,
  date_started_at,
  state,
  phase,
  ended_at
from public.video_sessions
where id = '<video_session_id>';
```

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
- `daily_call_cleanup`
- `daily_call_reuse`
- `daily_call_busy_internal_retry`
- `remote_seen_canonical_repair_failed`
- `remote_seen_canonical_repaired`
- `daily_owner_provider_left_unexpected`

Monitor Edge logs:

- `prepare_date_entry_ok`
- `video_date_provider_room_missing_or_expired_recovering`
- `video_date_provider_room_metadata_recanonicalized`

Monitor Supabase active-presence evidence:

- `video_sessions.participant_1_joined_at`
- `video_sessions.participant_2_joined_at`
- `video_sessions.participant_1_away_at`
- `video_sessions.participant_2_away_at`
- `video_sessions.participant_1_remote_seen_at`
- `video_sessions.participant_2_remote_seen_at`
- `video_sessions.handshake_started_at`
- `video_sessions.date_started_at`
- `video_date_daily_webhook_events.event_type`
- `event_loop_observability_events.reason_code` / `detail` values `daily_join_waiting_for_active_partner` and `handshake_started_after_active_daily_copresence`
- `event_loop_observability_events.reason_code` / `detail` values `reconnect_grace_cleared_by_daily_join`, `reconnect_grace_cleared_by_provider_join`, `reconnect_grace_cleared_by_return`, `reconnect_grace_expiry_suppressed_latest_presence`, `mark_reconnect_self_away_suppressed_active_daily_presence`, and `daily_transport_grace_expired`
- `event_loop_observability_events.detail` values `same_session_daily_continuity_latched`, `parked_singleton`, `truth_refresh_attempt`, `route_owned`, and `active_call_session_id_matches`
- `video_date_surface_claim_events` rows for `claim` / `claim_exception`, ordered by `created_at`
- `video_date_presence_events` rows for `provider_daily_joined`, `provider_daily_left`, `client_daily_alive`, `owner_heartbeat`, `remote_seen`, and lifecycle decisions after `20260606180000` is applied
- `mark_video_date_daily_alive` responses with `waiting_for_stable_copresence`, `stable_copresence`, `latest_joined_at`, `latest_left_at`, `latest_owner_heartbeat_at`, `owner_id`, `owner_state`, `call_instance_id`, `provider_session_id`, and `entry_attempt_id`

Healthy signals:

- Each both-ready session has a prepare-entry attempt.
- Prepare success includes `entry_attempt_id`.
- Both users join the same Daily room name.
- The latest Daily webhook state for both users is joined, not later left, before handshake starts.
- After stable-copresence rollout, both users keep fresh latest owner heartbeats within 15 seconds after the later joined time, and either the first qualifying bilateral owner-heartbeat pair has been stable for at least 2 seconds or canonical remote-seen exists before handshake starts.
- `video_date_remote_seen` or `video_date_first_remote_frame` appears after both joins.
- Same-session Daily call reuse appears when a second start request occurs while the call is already joining/joined; cleanup diagnostics do not show repeated `leave()` / `destroy()` for the same room.
- Return evidence clears `reconnect_grace_ends_at` before expiry when the user rejoins or remote media is seen.
- Active `in_handshake` / `in_date` session hydration routes directly to `/date/:sessionId`; lobby does not run a new Daily prepare for the same session.
- Native notification taps to `/date/:sessionId` route active date and pending-survey terminal truth to the Date stack with route ownership.
- Transition, queue hint, queue drain, and surface-claim calls return structured JSON with retryability fields under stale/duplicate/terminal churn instead of surfacing raw browser 500s.
- `video_date_surface_claim_events` records claim attempts so duplicate overlay or owner conflicts can be reconstructed after the current claim row expires.

Warning signals:

- Provider room recovery appears occasionally but succeeds.
- `video_date_prepare_entry_failed_no_nav` appears and is followed by Ready Gate recovery.
- Join succeeds for one user but remote is not seen within the normal waiting window.
- `participant_*_joined_at` exists for both users but one user also has a later `participant_*_away_at`; this is stale join history, not active co-presence.
- `daily_call_cleanup` appears repeatedly for the same session and room while meeting state is joining/joined.
- Canonical `remote_seen` repair failures appear after local remote media evidence.
- `waiting_for_stable_copresence` persists longer than 15 seconds even though both users appear to be in the same Daily room.
- `daily_owner_provider_left_unexpected` appears once and is followed by a clean owner restart/rejoin.

Red-alert signals:

- Tokens issued from stale room metadata are suspected.
- Provider 401/403 appears for valid participants.
- High-rate `DAILY_RATE_LIMIT`, `DAILY_PROVIDER_UNAVAILABLE`, or `DAILY_PROVIDER_ERROR`.
- Users join different Daily room names for the same `session_id`.
- `/date/:sessionId`, `/ready/:sessionId`, and event lobby cycle repeatedly for an already active `in_handshake` / `in_date` / `in_survey` session.
- A native notification tap for an ended survey-eligible session with no feedback opens lobby/tabs instead of `/date/:sessionId`.
- `handshake_started_at` advances when one participant's latest provider event is `participant.left`.
- After `20260606180000`, handshake/date promotion starts while `video_date_stable_copresence_v1` would still return `waiting_for_stable_copresence=true` and no canonical remote-seen exists.
- Repeated owner heartbeat rows show multiple active `owner_id` / `call_instance_id` values for the same `{session_id,user_id,room_name}` without terminal/failed/lost release evidence.
- `web_visibilitychange` or native background creates backend away while Daily is active.
- `reconnect_grace_expired` fires despite newer client/provider join or remote-seen evidence.
- Raw HTTP 500s appear from `video_date_transition`, `get_video_date_queue_hint_v1`, `drain_match_queue_v2`, or `claim_video_date_surface`.

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
3. Check `video_date_daily_webhook_events` in timestamp order for both `participant.joined` and later `participant.left`.
4. Check `participant_*_away_at`, `participant_*_remote_seen_at`, `handshake_started_at`, and `date_started_at`.
5. Check `video_date_remote_seen` and `video_date_no_remote_wait_started`.
6. Check Daily cleanup/reuse diagnostics before asking users to retry; normal joining/joined state should not route users into a user-facing retry loop.
7. Ask the missing user to reopen only once if their latest join is absent or stale/away.
8. If both latest presences are active and no remote is seen, escalate with room name and timestamps.

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
- Native notification taps for pending-survey terminal sessions reopen `/date/:sessionId` and then show survey recovery.
- Verdict submission either completes mutual result or enters a clear pending-partner state.

Warning signals:

- Survey recovery fires repeatedly for the same user and session.
- Verdict submit retry is needed but eventually succeeds.
- One user submits while the other remains pending.

Red-alert signals:

- User with ended date and no feedback cannot recover survey.
- Native notification tap routes a pending-survey terminal session to lobby/tabs, or shows Ready Gate, instead of `/date/:sessionId` survey recovery.
- A user with survey-eligible ended date truth is moved from `in_survey` to `offline`, `idle`, or `browsing` before feedback.
- Terminal `video_sessions.daily_room_name` / `daily_room_url` is null even though a deterministic Daily room existed for the date.
- `date_feedback` exists but UI still asks the same user to submit.
- Mutual match creation contradicts blocked/reported state.
- Home shows an active-date banner for a session that is ended, older than the 24-hour survey recovery window, or already has that user's `date_feedback`.

Immediate action for pending survey not recovered:

1. Search by `session_id` and `user_id`.
2. Confirm `date_started_at` and `ended_at` exist.
3. Confirm no `date_feedback` row exists for that user.
4. Confirm route emits no `video_date_survey_recovered`.
5. If recovery was from native notification, confirm the payload targeted `/date/:sessionId` and the reconciler emitted `pending_survey_terminal_encounter` / `navigate_date` rather than `stay_lobby`.
6. Confirm `event_registrations.queue_status` is still `in_survey`; if it is not, inspect `update_participant_status` timing and lifecycle writes.
7. Confirm terminal `daily_room_name` / `daily_room_url` are present or repaired.
8. Escalate as a recovery regression with session id, user id, current `event_registrations` snapshot, and notification tap diagnostics when applicable.

Immediate read-only check for a false home active-session banner:

```sql
select
  er.profile_id,
  er.event_id,
  er.queue_status,
  er.current_room_id,
  er.current_partner_id,
  vs.id as session_id,
  vs.state,
  vs.phase,
  vs.ready_gate_status,
  vs.started_at,
  vs.handshake_started_at,
  vs.date_started_at,
  vs.ended_at,
  vs.ended_reason,
  df.id as my_feedback_id
from public.event_registrations er
left join public.video_sessions vs
  on vs.id = er.current_room_id
left join public.date_feedback df
  on df.session_id = vs.id
 and df.user_id = er.profile_id
where er.profile_id = '<USER_UUID>'
order by er.last_active_at desc nulls last;
```

Interpretation:

- `queue_status = in_survey` should show the home feedback banner only when `vs.ended_at` and `vs.date_started_at` exist, `df.id` is null, and `vs.ended_at` is within 24 hours. It should not be overwritten by later lifecycle `offline` writes until feedback exists.
- Old ended sessions, sessions with existing feedback, and stale non-ended sessions should emit `stale_active_session_detected` and not show active-date copy.

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
