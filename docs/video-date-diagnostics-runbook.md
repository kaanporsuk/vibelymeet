# Video Date Diagnostics Runbook (G2)

This runbook covers client diagnostics for the journey:

- Event Lobby
- Ready Gate
- Video Date
- Post-Date Survey

Scope is client-side only (web + native). No backend schema or RPC assumptions are changed here.

## Canonical Journey Events

All journey analytics events are emitted as:

- `video_date_journey_<event>`

Canonical event keys are defined in `shared/matching/videoDateDiagnostics.ts`.

Primary milestones:

- `ready_gate_opened`
- `ready_gate_both_ready_handoff_started`
- `ready_gate_dismissed`
- `ready_gate_forfeited`
- `ready_gate_invalidated`
- `date_route_entered`
- `date_route_bounced`
- `date_route_recovered`
- `survey_opened`
- `survey_recovered`
- `survey_lost_prevented`
- `survey_completed`
- `mutual_match_detected`
- `chat_cta_pressed`

## Canonical Fields

Journey events use the same core fields across web and native:

- `platform` (`web` or `native`)
- `session_id`
- `event_id`
- branch-specific context (for example `reason`, `source`, `target`, `outcome`)

Avoid adding PII-heavy fields (message content, media URLs, etc.).

## Media / Reconnect Diagnostics (C1)

Two main diagnostic layers exist:

- `vdbg` breadcrumbs for branch-level flow tracing
- Daily/media diagnostics for transport milestones

Common Daily milestones:

- token lifecycle: `token_fetch_start`, `token_fetch_success`, `token_fetch_failure`
- join lifecycle: `daily_join_start` / `daily_call_join_start`, `daily_join_success` / `daily_call_join_success`, `daily_join_failure` / `daily_call_join_failure`
- track lifecycle: `daily_local_track_mounted` / `local_track_mounted`, `daily_remote_track_mounted` / `remote_track_mounted`
- remote visibility: `first_remote_observed`, `remote_participant_promoted_*`
- watchdog/recovery: `daily_no_remote_watchdog_*`, `no_remote_auto_recovery_*`, `peer_missing_timeout`

Reconnect sync outcomes are normalized in `shared/matching/videoDateDiagnostics.ts`:

- `rpc_error`
- `ended`
- `ok`

## Triage Flow (Quick)

For a failed user journey, walk in this order:

1. **Route entered?**
   - Find `video_date_journey_date_route_entered`.
2. **Ready Gate handoff happened?**
   - Confirm `video_date_journey_ready_gate_both_ready_handoff_started`.
3. **Date join succeeded?**
   - Check token and join diagnostics (`*_token_*`, `*_join_*`).
4. **Remote media became usable?**
   - Confirm `first_remote_observed` and remote track-mounted diagnostics.
5. **Reconnect path (if present)**
   - Inspect `sync_reconnect_result` breadcrumbs and outcome (`rpc_error`, `ended`, `ok`).
6. **Terminal routing**
   - Confirm survey events (`survey_opened`, `survey_recovered`, `survey_completed`) or bounce/recovery (`date_route_bounced`, `date_route_recovered`).

## Query/Filter Suggestions

- Filter by `session_id` first, then sort by timestamp.
- Add `platform` to compare web vs native branch behavior.
- For reconnect incidents, filter message `sync_reconnect_result` and inspect `outcome`.
- For blank-media incidents, filter for `first_remote_observed`, `remote_track_mounted`, and watchdog events in the same session.

