# Ready Gate Production Validation

This checklist covers the audit items that cannot be proven from local source alone.
Run it after deploys that touch Ready Gate, queue promotion, Daily handoff, push
delivery, or video-date operator metrics.

## Source and Production Parity

Run local checks:

```bash
npm run verify:ready-gate-prod-parity -- --skip-remote
```

Run linked Supabase checks when credentials are available:

```bash
npm run verify:ready-gate-prod-parity -- --require-remote
```

The remote run must confirm:

- The linked migration history contains the Ready Gate transition, queue drain v2,
  provider reliability, hardened outbox, Sprint 7 ops, and provider idempotency migrations.
- `supabase db push --linked --dry-run` reports no pending repo migrations.
- The linked function catalog includes `daily-room`, `video-date-outbox-drainer`,
  `send-notification`, `push-webhook`, and `admin-video-date-ops`.

## Live QA Matrix

| Scenario | Expected result | Evidence to collect |
| --- | --- | --- |
| Daily provider outage or rate limit during both-ready | Ready Gate stays open or shows retryable prepare-entry copy. No Connecting loop. | `daily-room` logs, `ready_gate_to_date_latency_checkpoint`, admin `daily_performance_*` metrics. |
| Stale push tap after Ready Gate ended | Native/web redirects to the canonical lobby/date/survey state with stale-link copy. | Device screen recording, Ready Gate breadcrumb, `notification_log` row. |
| Event ends during Ready Gate | Session terminalizes, queue state clears, user returns to event/lobby safely. | `ready_gate_transition` event-loop rows, event lifecycle logs, registration queue state. |
| Queued promotion while backgrounded | User is not promoted until foreground/runtime readiness is confirmed. Copy explains to keep lobby open. | `drain_match_queue_v2` reason rows, queue health metrics, device foreground/background timestamps. |
| Multi-device Ready/Snooze/Step away conflict | Server serializes the first action. The losing device shows “Ready Gate changed” conflict copy and syncs latest state. | Two-device recording, `ready_gate_transition` rows, client transition failure telemetry with `multi_device_conflict`. |
| OneSignal send failure or no player ID | Match flow proceeds fail-soft, but operator health surfaces app log/outbox failure state. | `notification_log.data.push_delivery_diagnostic`, `video_date_provider_outbox`, admin `notification_outbox_health`. |

## Operator Health

`admin-video-date-ops` metrics now include `notification_outbox_health` in each
window. Treat its sources separately:

- `app_notification_log` is the transactional app send/suppression ledger.
- `video_date_provider_outbox`, `provider_failure_log`, and `provider_dead_letters`
  are the video-date provider worker queue and retry/dead-letter surfaces.
- `push_provider_telemetry` reads `push_notification_events`; it is not
  authoritative for transactional sends unless production webhook correlation is
  separately confirmed. In event-scoped windows it is visible as global advisory
  context only, because those rows are not event-filtered.

Healthy release gates should show no failed/stale `notification.send` rows, no
provider dead letters, no unexpected provider-error suppression spike, and no
unexplained queue drain backlog.
