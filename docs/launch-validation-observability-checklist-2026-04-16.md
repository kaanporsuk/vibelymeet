# Launch Validation + Observability Checklist (Ready Gate / Date Join)

Status: post-Wave-1 launch-readiness pack (docs-only, no code/deploy actions).

Scope is intentionally narrow to the recently merged fixes:
- Ready Gate permission preflight
- date pre-join timeout/retry recovery
- pending Mystery Match -> Ready Gate promotion behavior
- duplicate session-open protection

---

## 1) Launch validation checklist (operator pass/fail)

Run these as manual smoke checks on production-like builds/accounts.

### A. Ready Gate permission preflight
- [ ] From event lobby -> matched session -> Ready Gate opens before date route.
- [ ] Camera/mic prompt appears at Ready Gate entry (overlay or `/ready/[id]`), not first inside deep date join.
- [ ] If permissions already granted, no blocking permission UI appears.

### B. Date join happy path
- [ ] Both users mark ready -> transition copy shows joining flow.
- [ ] Date route reaches live Daily surface (remote/local video areas visible).
- [ ] No indefinite spinner between Ready Gate dismissal and active call state.

### C. Permission denial recovery
- [ ] Denying camera/mic keeps user in explicit permissions-required state.
- [ ] "Enable permissions" retries cleanly.
- [ ] "Back to lobby" path exits without dead-end.

### D. Token/handshake timeout recovery
- [ ] Simulated delayed/unavailable token or handshake path surfaces retryable terminal state.
- [ ] Retry action restarts join attempt (no app restart needed).
- [ ] Back-to-lobby action exits cleanly.
- [ ] No infinite spinner after timeout/failure.

### E. Pending Mystery Match -> Ready Gate promotion
- [ ] Empty deck -> "Try Mystery Match" -> waiting state appears.
- [ ] While partner becomes available, lobby opens Ready Gate without requiring full app restart.
- [ ] Out-of-order updates (`queue_status` before/after `current_room_id`) still end in Ready Gate open.

### F. Duplicate session-open protection
- [ ] Same `video_sessions.id` does not repeatedly reopen overlay while already active.
- [ ] Closing Ready Gate and receiving repeated realtime updates does not cause looped re-open.

---

## 2) Production observability checklist (exact signals)

Use existing surfaces only: Sentry + DB SQL + existing RC breadcrumbs/messages.

| Signal | Source | What to watch |
|---|---|---|
| `READY_GATE_NOT_READY` occurrences | `daily-room` response code, `video_date_transition` code, mobile classified failures | Rate/day and % of date attempts returning this code |
| Pre-join timeout occurrences | mobile timeout path (`VideoDateRequestTimeoutError`) + pre-join failure UI usage | Count/day and trend after launch |
| Retry usage frequency | date screen retry button path (`handleRetryInitialConnect`) | Retries per successful join; retries per user |
| Permission denial frequency during Ready Gate | RC breadcrumbs: `rc.ready_gate` + `lobby_overlay_permissions_denied` / `standalone_permissions_denied` | % of Ready Gate entries with denial |
| Repeated same-session open attempts | RC breadcrumb `rc.lobby.date_entry` + `navigate_to_video_date` keyed by `session_id` | Duplicate opens for same `session_id` in short window |
| Time from `both_ready` to successful join | `video_sessions` timestamps + first handshake/date transition timestamp | p50/p95 latency from `both_ready` to handshake/date start |
| Users falling back from pending search without reaching Ready Gate | lobby waiting-state behavior + DB queued session outcomes (`queued_ttl_expired` / never promoted) | Drop-off rate from pending search to no Ready Gate |

---

## 3) Stop / patch threshold table

Use these thresholds for launch triage decisions (rolling 24h and 7d trend).

| Condition | Threshold guidance | Decision |
|---|---|---|
| `READY_GATE_NOT_READY` rare and stable | <1% of date attempts, no upward trend | No action |
| Recoverable pre-join failures present but stable | 1-3% retries, users recover on first retry | Monitor |
| `READY_GATE_NOT_READY` clustered near join despite retries | >3% sustained for 2+ days OR clear spike post-release | Tiny backend `both_ready` grace patch candidate |
| Join funnel still shows unresolved dead-end symptoms | Repeated unresolved pre-join failures, increasing abandon after retry | Deeper investigation |
| Pending-search drop-off elevated | Rising queued->expired without Ready Gate while realtime healthy | Deeper investigation |

Notes:
- "Tiny backend grace patch" means only extending `ready_gate_expires_at` refresh at `both_ready` in `ready_gate_transition`.
- Do not trigger broader redesign based on one-day noise; require sustained signal.

---

## 4) Minimal query guide (existing patterns only)

### A. Sentry quick filters

Use message/category filters already emitted by mobile:
- Category: `rc.ready_gate`
- Category: `rc.lobby.date_entry`
- Message contains:
  - `lobby_overlay_permissions_denied`
  - `standalone_permissions_denied`
  - `navigate_to_video_date`
  - `video_date_token_failed`
  - `video_date_enter_handshake_failed`

### B. SQL snippets (Supabase SQL editor)

1) `both_ready` -> handshake/date latency sample
```sql
select
  id,
  ready_gate_expires_at,
  handshake_started_at,
  date_started_at,
  extract(epoch from (coalesce(handshake_started_at, date_started_at) - ready_gate_expires_at + interval '30 seconds')) as approx_seconds_from_both_ready
from video_sessions
where started_at > now() - interval '7 days'
  and ready_gate_status in ('both_ready', 'expired')
order by started_at desc
limit 200;
```

2) Queue drop-off / expiry check
```sql
select
  count(*) filter (where ended_reason = 'queued_ttl_expired') as queued_ttl_expired,
  count(*) filter (where ready_gate_status = 'ready') as currently_ready,
  count(*) filter (where ready_gate_status = 'both_ready') as currently_both_ready
from video_sessions
where started_at > now() - interval '24 hours';
```

3) Ready Gate stale cleanup pressure
```sql
select
  ready_gate_status,
  ended_reason,
  count(*) as sessions
from video_sessions
where started_at > now() - interval '24 hours'
group by 1,2
order by sessions desc;
```

4) Registration side effects check (`in_ready_gate` -> `in_handshake` / `idle`)
```sql
select
  queue_status,
  count(*) as users
from event_registrations
where updated_at > now() - interval '24 hours'
group by 1
order by users desc;
```

Interpretation guidance:
- Look for abnormal growth in `queued_ttl_expired` and `ready_gate_expired`.
- Correlate with Sentry `video_date_token_failed` / `video_date_enter_handshake_failed`.

---

## 5) Final recommendation

- Pause code changes now.
- Proceed with launch validation + observability monitoring for this slice.
- Only consider a tiny backend `both_ready` grace extension if threshold conditions above are met.

