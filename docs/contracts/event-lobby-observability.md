# Event Lobby Observability Taxonomy

Date: 2026-05-01
Scope: Event Lobby deck, swipe, queue, Ready Gate, notification, and date-entry diagnostics.

## Goals

- Give operators coarse, live reasons for Event Lobby failures and empty states.
- Keep user-facing behavior and backend authority unchanged.
- Avoid private safety details, profile identifiers, moderation internals, and high-cardinality analytics.

## Event Names

| Event | Emitted by | Purpose |
|---|---|---|
| `lobby_entered` | Web, native | User entered a valid live lobby surface. |
| `lobby_deck_loaded` | Web, native | Deck RPC returned without error. Counts are bucketed. |
| `lobby_deck_empty` | Web, native | Lobby has no swipeable cards or deck is disabled by safe gating. |
| `lobby_deck_error` | Web, native | Deck fetch failed. Reason is `rpc_error` or `network_error`. |
| `lobby_swipe_submitted` | Web, native | Client submitted a swipe action. |
| `lobby_swipe_result` | Web, native, `swipe-actions` logs | Swipe resolved with outcome and notification attempt/suppression metadata. |
| `lobby_swipe_duplicate_suppressed` | Web, native, `swipe-actions` logs | Duplicate/idempotent swipe was detected and notification side effects were suppressed. |
| `ready_gate_shown` | Web, native | In-lobby Ready Gate overlay was shown. |
| `ready_gate_transition` | Web, native | Ready Gate transition RPC resolved or failed. |
| `queue_drain_attempted` | Web, native | Client attempted backend-owned queue drain. |
| `queue_drain_result` | Web, native | Queue drain resolved or failed with coarse outcome. |
| `date_entered_from_lobby` | Web, native | Lobby started a verified date navigation. |
| `notification_suppressed` | `swipe-actions` logs | Notification side effect was intentionally skipped or failed safely. |
| `notification_sent` | `swipe-actions` logs | Notification side effect was sent. |

## Deck Empty Reasons

Only these safe coarse categories are valid:

- `event_not_active`
- `user_not_eligible`
- `no_confirmed_candidates`
- `all_candidates_filtered`
- `all_candidates_seen_locally`
- `all_candidates_busy_or_unavailable`
- `rpc_error`
- `network_error`
- `unknown`

Do not emit exact block/report/moderation reasons, target identifiers, report counts, suspension causes, or candidate-level filter explanations.

## Swipe Result Properties

`lobby_swipe_result` carries:

- `event_id`
- `platform`
- `swipe_type`
- `outcome`
- `reason`
- `session_id_present`
- `notification_attempted`
- `notification_suppressed_reason`
- `duplicate`

It must not carry raw profile/user identifiers or private safety data.

## Queue And Ready Gate Properties

`queue_drain_result` carries:

- `event_id`
- `platform`
- `source_surface`
- `source_action`
- `outcome`: `promoted`, `queued`, `no_match`, or `error`
- `reason`
- `session_id_present`

`ready_gate_transition` carries:

- `event_id`
- `platform`
- `session_id`
- `action`
- `outcome`
- `reason`
- `ready_gate_status`
- `terminal`
- `latency_ms`

## Do Not Emit

- `profile_id`, `target_id`, `actor_id`, or raw `user_id` in analytics payloads.
- Email, phone, private contact info, proof selfie URLs, private verification artifacts.
- Raw moderation, report, block, suspension, or safety internals.
- Freeform server errors to users or analytics. Use sanitized machine-readable reason codes.

## Admin Metrics

Operators can derive low-risk metrics from this taxonomy:

- Active lobby users by status from existing event loop observability tables and foreground markers.
- Deck empty by reason from `lobby_deck_empty`.
- Swipe outcomes by result from `lobby_swipe_result`.
- Queue depth from existing `video_sessions.ready_gate_status = 'queued'` counts plus `queue_drain_result`.
- Queue promotion failures from queue drain and existing backend observability rows.
- Ready Gate expiry/forfeit/both-ready conversion from Ready Gate transition events and existing `event_loop_observability_events`.
- Notification sends/suppression by category from `swipe-actions` structured logs.

## Rebuild Delta

- New shared helper: `shared/observability/eventLobbyObservability.ts`.
- Web surfaces now emit deck, swipe, queue, Ready Gate, and date-entry taxonomy events.
- Native surfaces now emit the same taxonomy where practical.
- Edge Function `swipe-actions` structured logs now include taxonomy event names and sanitized notification suppression metadata.
- No schema change and no Supabase migration in this stream.
- Cloud artifact after merge: deploy only Edge Function `swipe-actions`.
