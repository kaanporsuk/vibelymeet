# Video Date Diagnostics Runbook (G2)

This runbook covers client diagnostics for the journey:

- Event Lobby
- Ready Gate
- Video Date
- Post-Date Survey

Scope is primarily **client-side** (web + native). For **server-side queue / promotion** correlation, operators may use read-only SQL on `event_loop_observability_events` (service role) as documented in `docs/observability/watchdog-no-remote-query-pack.md` — no application RPC contract is implied here.

## Watchdog, no-remote, and peer-missing (native vs web)

### What “no remote” means

- **Daily SDK view:** After local `join`, there may be **zero remote participants** in the room snapshot even when the partner is still connecting (delayed visibility).
- **Not the same as** server `video_sessions.phase` lag — reconcile using DB + client breadcrumbs together.

### Authoritative layers (do not mix meanings)

| Layer | Native | Web |
|-------|--------|-----|
| **RC operator breadcrumbs** | Sentry category `rc.video_date.entry` — control-plane steps (`daily_join_ok`, `enter_handshake_*`, …) plus **`no_remote_watchdog_recovery_start`**, **`peer_missing_terminal_watchdog_fire`** for the first-remote watchdog | No `rc.*` namespace; use **`vdbg`** messages (`daily_no_remote_watchdog_*`) |
| **Daily transport breadcrumbs** | Sentry category **`video-date-daily`** (`videoDateDailyDiagnostic`) — `peer_missing_timeout`, `no_remote_auto_recovery_*`, `first_remote_observed`, join/token messages | Same logging style via `vdbg` / development console for web Daily path |
| **Product analytics** | PostHog events such as `video_date_peer_missing_*`, `video_date_join_*` when the analytics instrumentation PR is present (`shared/analytics/lobbyToPostDateJourney.ts`) | Same event names with `platform: web` |

### Distinguishing “remote truly absent” vs “join lag”

1. **`first_remote_observed`** or **`remote_track_mounted`** before terminal peer-missing → **delayed join**, not a missing partner.
2. **`no_remote_watchdog_recovery_start`** followed by **`first_remote_observed`** → **successful recovery** after one automatic rejoin attempt (native).
3. **`peer_missing_terminal_watchdog_fire`** with no prior remote diagnostics → user-facing **peer-missing terminal**; confirm whether partner opened the date route (PostHog / route journey) and whether promotion rows exist for `session_id` (Supabase observability table).

### Incident triage — order of operations

1. **Session id** — collect UUID from support ticket or analytics.
2. **Sentry** — filter breadcrumbs by `session_id`; review `rc.video_date.entry` then `video-date-daily`.
3. **PostHog** — join funnel + peer-missing taps for the same session (when instrumented).
4. **Supabase (service role)** — `event_loop_observability_events` and `video_sessions` for authoritative queue/session truth.

### Retry / keep waiting / back to lobby (native UX)

Interpret together:

- **`video_date_peer_missing_retry_tap`** (PostHog) → user initiated full retry pipeline (clears terminal and bumps join attempt).
- **`video_date_peer_missing_keep_waiting_tap`** → user dismissed terminal but stays in waiting posture (see code: `peer_missing_keep_waiting`).
- **`video_date_peer_missing_back_to_lobby_tap`** or abort path → exit without survey (pre-connect).

Cross-check **`peer_missing_terminal_watchdog_fire`** in Sentry — if absent, the UI state may be from another branch (e.g. prejoin failure vs peer-missing).

### Evidence that would justify future threshold/cadence tuning

Structured measurement checklist (queue drain, reconnect backoff, dashboards): **[`docs/observability/evidence-led-queue-reconnect-tuning.md`](./observability/evidence-led-queue-reconnect-tuning.md)**.

Document **before** proposing code changes:

- Histogram of **`daily_no_remote_watchdog_timeout` → recovery** vs **terminal** rates per platform.
- Rate of **`peer_missing_terminal_watchdog_fire`** where **`first_remote_observed`** occurs within **X minutes** after (late join) — suggests threshold sensitivity.
- Correlation with **`event_loop_observability_events`** outcomes (`blocked`, `conflict`) — if high, tune queue/server path before media timeouts.

**Concrete query patterns and SQL snippets:** [`docs/observability/watchdog-no-remote-query-pack.md`](./observability/watchdog-no-remote-query-pack.md).

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

Hardening sprint product events added/verified in `shared/analytics/lobbyToPostDateJourney.ts`:

- `video_date_ready_gate_ready`
- `video_date_both_ready`
- `video_date_route_entered`
- `video_date_enter_handshake_success`
- `video_date_enter_handshake_failure`
- `video_date_daily_token_success`
- `video_date_daily_token_failure`
- `video_date_daily_joined`
- `video_date_remote_seen`
- `video_date_handshake_grace_started`
- `video_date_handshake_completed_mutual`
- `video_date_handshake_not_mutual`
- `video_date_extension_attempted`
- `video_date_extension_succeeded`
- `video_date_extension_failed`
- `video_date_reconnect_grace_started`
- `video_date_reconnect_returned`
- `video_date_reconnect_expired`
- `video_date_survey_opened`
- `video_date_survey_submitted`
- `video_date_survey_abandoned`
- `video_date_queue_drain_found`
- `video_date_queue_drain_not_found`
- `video_date_queue_drain_blocked`

Read-only operator SQL for stuck sessions and stale registrations lives in
`supabase/validation/video_date_end_to_end_hardening.sql`.

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
- For native peer-missing incidents, filter **`rc.video_date.entry`** message **`peer_missing_terminal_watchdog_fire`** or **`video-date-daily`** message **`peer_missing_timeout`** (same clock order).
