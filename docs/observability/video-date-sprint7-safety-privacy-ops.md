# Video Date Sprint 7 Safety, Privacy, RLS, And Ops

This is the operator plan for the Sprint 7 launch gate. It covers only the intended Video Date behavior: report/block, privacy boundaries, RLS posture, stuck-state detection, Daily recovery, survey recovery, queue drain health, webhook DLQ, and orphan-room cleanup.

## Source Of Truth

- Primary RPC: `public.get_video_date_sprint7_ops_health(p_event_id uuid default null)`
- Admin bridge: `admin-video-date-ops` returns `windows[].safety_privacy_ops_health`
- Validation pack: `supabase/validation/video_date_sprint7_safety_privacy_ops.sql`
- Contract test: `shared/matching/videoDateSprint7SafetyPrivacyOpsContracts.test.ts`

The Sprint 7 RPC is service-role only. It returns aggregate counts, enum-like reason classes, stable operational ids, timestamps, and dashboard status only. It must not return Daily tokens, provider secrets, auth headers, profile text, names, emails, phone numbers, media URLs, or freeform report details.
When filtered by `p_event_id`, report/block counts include both video-session pairs and lobby-only pairs where both profiles are registered for that event.

## Dashboard

Create a dashboard named `Video Date Safety & Ops`.

Run this query for global health:

```sql
select public.get_video_date_sprint7_ops_health(null);
```

Run this query for a single live event:

```sql
select public.get_video_date_sprint7_ops_health('<event-id>'::uuid);
```

Dashboard tiles:

| Tile | Metric | Alert |
| --- | --- | --- |
| Stuck Ready Gate | `stuck_ready_gate_count` | Critical if greater than 0 for 24h |
| Stuck Handshake | `stuck_handshake_count` | Critical if greater than 0 for 24h |
| Overdue Date | `overdue_date_count` | Critical if greater than 0 for 24h |
| Silently Queued | `silently_queued_count` | Critical if greater than 0 for 24h |
| Prepare Entry Failures | `prepare_entry_failure_count` | Warning if greater than 0, critical if rising |
| Daily Join Failures | `daily_join_failure_count` | Warning if greater than 0, critical if rising |
| Survey Recovery | `pending_survey_recovery_count` | Warning if greater than 0, critical if older than 24h |
| Queue Drain Misses | `queue_drain_miss_count` | Warning if rising above baseline |
| Queue Drain Failures | `queue_drain_failure_count` | Warning if greater than 0, critical if repeated |
| Webhook DLQ | `unresolved_webhook_dlq_count` and `webhook_dlq_error_classes` | Critical if greater than 0 |
| Orphan Rooms | `orphan_room_cleanup_failed_count` and `orphan_room_safety_interlock_skip_count` | Critical on failed cleanup, warning on safety interlock skips |
| Safety Actions | `report_count`, `report_with_block_count`, `block_count`, `pending_report_count` | Warning if pending reports exceed moderation SLO |

Keep these tiles side-by-side with the existing Video Date latency dashboard:

- `ready_tap_to_first_remote_frame_latency`
- `ready_gate_open_to_date_join_latency`
- `queue_drain_failures`
- `daily_performance_decision`
- `daily_performance_emission_health`

## Runbooks

### Daily Outage

Detection:

- `daily_join_failure_count` rises.
- `daily_performance_decision.decision_status` is `critical`.
- Supabase Edge logs for `daily-room`, `prepare-date-entry`, or `video-date-token-refresh` show provider failures.

Action:

1. Confirm `DAILY_API_KEY`, `DAILY_DOMAIN`, and `DAILY_WEBHOOK_SECRET` are configured without printing values.
2. Check Daily status and quota from the provider dashboard.
3. Keep users recoverable through Ready Gate/date retry paths. Do not manually mark sessions as completed.
4. If provider failure persists, pause or roll back the active Video Date rollout flag for new entries.

Recovery:

1. Confirm prepare entry success and Daily join success return to baseline.
2. Confirm no stuck `in_ready_gate`, `in_handshake`, or `in_date` rows remain.
3. Confirm pending survey recovery did not spike from forced exits.

### Webhook Failure

Detection:

- `unresolved_webhook_dlq_count` is greater than 0.
- `webhook_dlq_error_classes` has signature, processing, payload, or persistence errors.
- Daily dashboard shows failed webhook delivery.

Action:

1. Confirm `DAILY_WEBHOOK_SECRET` exists and the provider webhook targets the deployed `video-date-daily-webhook` URL.
2. Inspect `video_date_webhook_dlq` with service role only.
3. Retry only sanitized DLQ rows after the code/config cause is fixed.
4. Never paste raw webhook payloads or headers into tickets, chat, or docs.

Recovery:

1. DLQ unresolved count returns to 0.
2. `video_date_daily_webhook_events` receives fresh accepted events.
3. Room cleanup and survey recovery dashboards stay healthy.

### Queue Backlog

Detection:

- `silently_queued_count`, `queue_drain_miss_count`, or `queue_drain_failure_count` rises.
- Existing queue fairness dashboard shows `starved_slots_120s` or `starved_slots_300s`.

Action:

1. Check that the event is active and participants are confirmed.
2. Confirm `drain_match_queue_v2` is running and using the same eligibility rules as queue hints.
3. Check blocked/reported pair filters before attempting manual rescue.
4. If users are queued but not promotable, leave them in deck/lobby recovery rather than forcing unsafe sessions.

Recovery:

1. Queue drain failures return to 0.
2. No eligible queued session remains stale beyond the TTL.
3. Ready Gate opens for promoted sessions through the canonical route contract.

### Stuck Session

Detection:

- `stuck_ready_gate_count`, `stuck_handshake_count`, `overdue_date_count`, or `client_stuck_observed_count` rises.
- User support reports match a concrete `session_id`.

Action:

1. Open the admin timeline for the `session_id`.
2. Read server phase, deadlines, ready status, Daily proof, and survey eligibility.
3. Prefer existing cleanup/recovery RPCs over direct row mutation.
4. If the session has safety evidence, preserve room and report data until the safety interlock clears.

Recovery:

1. Session lands in `ended`, survey, lobby, chat, or home from server truth.
2. Registration active-session pointers clear where appropriate.
3. No participant remains on a stale ready/date route after reload.

### Missed Survey

Detection:

- `pending_survey_recovery_count` is greater than 0.
- Users report a date ended without a survey.

Action:

1. Confirm the date had real encounter exposure using `video_date_session_is_post_date_survey_eligible`.
2. Confirm `date_feedback` is missing only for the affected participant.
3. Let canonical routing reopen the survey. Do not manually insert feedback unless directed by incident owner.
4. If a report/block exists for the pair, verify next surface is safety-safe and does not route to chat or same-pair active date.

Recovery:

1. Survey opens exactly once for each eligible participant.
2. `resolve_post_date_next_surface` routes to ready gate, lobby/deck, chat, wrap-up, or home from backend truth.
3. Pending survey count returns to 0.

### Event-End Cleanup

Detection:

- Event is inactive but Ready Gate, queued, handshake, or date rows remain active.
- Event-end cleanup dashboards show unresolved rows.

Action:

1. Run the event-end cleanup path only for the affected event.
2. Preserve already prepared/date-capable sessions for normal terminalization.
3. Confirm queue drain and Ready Gate routes stop opening for inactive events.

Recovery:

1. No new Ready Gate/date routes open for inactive events.
2. Existing users recover to survey, wrap-up, lobby ended state, chat, or home.
3. Registration pointers are not left pointing at terminal sessions.

### Room Cleanup

Detection:

- `orphan_room_cleanup_failed_count` rises.
- `orphan_room_safety_interlock_skip_count` rises.
- Daily rooms remain after session end beyond the cleanup window.

Action:

1. Confirm room is not active in Daily and not tied to a live handoff.
2. Run the orphan safety interlock before deletion.
3. If there is a pending report or safety-review event, keep the room/audit evidence until the interlock clears.
4. Log only room names, provider ids, timestamps, counts, and sanitized metadata.

Recovery:

1. Orphan cleanup failure count returns to 0.
2. Safety interlock skips are reviewed and resolved by moderation/ops.
3. Provider rooms are deleted only after server and safety checks agree.

## Launch Checklist

Flags:

- Video Date v4 canonical routing is enabled for web and native cohorts.
- Daily prewarm/prepare entry flags match the Sprint 3 and Sprint 6 contract.
- Safety extension, post-date next-surface, and queue-drain alignment flags are enabled for the same cohort.
- Rollback flag path is known and tested by operators.

Secrets:

- `DAILY_API_KEY`, `DAILY_DOMAIN`, and `DAILY_WEBHOOK_SECRET` are present.
- `SUPABASE_SERVICE_ROLE_KEY` is present only in service-role Edge Functions.
- Notification provider keys are present only in notification Edge Functions.
- No secret values are copied into docs, tickets, logs, screenshots, or dashboards.

SLOs:

- Ready Gate stuck sessions: 0 over 24h.
- Handshake/date stuck sessions: 0 over 24h.
- Unresolved webhook DLQ: 0 over 24h.
- Pending survey recovery: 0 older than 24h.
- Queue drain true failure rate: below 5 percent.
- Daily join failure rate: below 2 percent during live events.
- Safety report moderation pending time: under the current trust-and-safety SLA.

Required dashboards:

- `Video Date Safety & Ops`
- `Video Date Operator Loop`
- `Video Date Daily Performance`
- `Video Date Timeline`
- Supabase Edge Function error logs for Daily, prepare-entry, token-refresh, webhook, and provider workers
- Provider dashboards for Daily and notification delivery

Rollback:

1. Pause new Video Date entry through the rollout flag.
2. Keep existing sessions recoverable through canonical server routing.
3. Roll back Edge Functions only if the incident owner confirms the previous version is compatible with the current schema.
4. Never roll back migrations destructively in production. Use forward repair migrations.
5. Keep safety/report records immutable unless legal/trust leadership approves a retention action.

Incident owners:

- Incident commander: on-call engineering lead
- Product owner: Video Date product lead
- Safety owner: trust and safety lead
- Backend owner: Supabase/Edge owner
- Client owner: web/native owner
- Provider owner: Daily and notifications owner

## Final Certification

Before launch:

- Full typecheck passes.
- Video Date v4 test suite passes.
- Sprint 7 safety/privacy/ops contract test passes.
- Web two-user staging E2E passes.
- iOS two-user manual run passes.
- Android two-user manual run passes.
- No known path leaves users stuck in `in_ready_gate`, `in_handshake`, `in_date`, `queued`, or pending survey.
- Operators can detect and triage stuck Ready Gate, prepare-entry failures, Daily join failures, survey recovery, queue drain misses, webhook DLQ, and orphan rooms from dashboards.
