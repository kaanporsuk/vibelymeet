# Watchdog & no-remote / peer-missing — operator query pack

For **threshold / cadence decisions** on queue drain and reconnect sync (not watchdog-specific), see [`evidence-led-queue-reconnect-tuning.md`](./evidence-led-queue-reconnect-tuning.md).

**Scope:** Event lobby → ready gate → video date, with emphasis on first-remote presence, join timing, and native peer-missing UI.  
**Out of scope for this file:** changing thresholds, RPC behavior, or product logic. All numbers (e.g. 25s) are **documented for triage only**; do not treat as approval to retune in code from this doc.

## 1) Source-of-truth map (where to look)

| Question | Authoritative for “server / queue” | Authoritative for “client / media” | Product analytics funnel (PostHog) |
|----------|--------------------------------------|-------------------------------------|-------------------------------------|
| Ready gate promoted? queue drained? swipe mutual? | `event_loop_observability_events` (+ views `v_event_loop_*`) | Lobby + Ready Gate UI + RC breadcrumbs | Ready gate / lobby funnel events (`ready_gate_*`, etc.) |
| Session row phase / handshake / date ended? | `video_sessions` + RPC `video_date_transition` outcomes (via logs or DB) | Date route journey events + Daily join diagnostics | `video_date_join_*`, route journey |
| Remote participant present in Daily room? | N/A — provider truth is client-side Daily SDK | **`video-date-daily`** / **`video-date-session`** Sentry breadcrumbs on native; **`vdbg`** on web (`daily_no_remote_watchdog_*`) | Peer-missing / join events when instrumented |
| Native first-connect watchdog fired? | Same as media | **`rc.video_date.entry`** breadcrumbs: `no_remote_watchdog_recovery_start`, **`peer_missing_terminal_watchdog_fire`** | `video_date_peer_missing_*` (see analytics journey doc when present) |
| Native notification tap opened the right surface? | `video_sessions`, `event_registrations`, `date_feedback`, and `event_loop_observability_events` route details | Native notification/deep-link breadcrumbs plus Date route recovery diagnostics | Notification-open and route/survey events when instrumented |

**Correlation rule:** Tie one user session using **`session_id`** (UUID string) consistently across PostHog, Sentry (`session_id` in breadcrumb data where present), and Supabase (`event_loop_observability_events.session_id`, `video_sessions.id`).

---

## 2) Sentry Discover / Issues — filters

### Native RC namespace (`rc.video_date.entry`)

Stable messages (additive as of watchdog diagnostics expansion):

| Message | Meaning |
|---------|---------|
| `daily_join_start` | Coarse pipeline step (see also `create_date_room_*`, `daily_call_join_*` in same category in code path) |
| `daily_join_ok` | Daily `join` completed from client perspective |
| `daily_join_fail` | Daily join failed |
| `no_remote_watchdog_recovery_start` | First 25s window elapsed with no remote; **one** automatic leave/rejoin scheduled (matches `no_remote_auto_recovery_start` in `video-date-daily`) |
| `peer_missing_terminal_watchdog_fire` | Second 25s path or post-recovery still no remote → **peer-missing terminal UI** (`peer_missing_timeout` in `video-date-daily`) |

**Discover filter example (conceptual):**

- Category: `rc.video_date.entry`
- Message: `peer_missing_terminal_watchdog_fire`

Pair with same `session_id` in breadcrumb data.

### Native Daily diagnostics (`video-date-daily`)

| Message | Meaning |
|---------|---------|
| `no_remote_auto_recovery_start` | Watchdog chose auto-recovery path |
| `no_remote_auto_recovery_complete` | Recovery path finished scheduling rejoin |
| `peer_missing_timeout` | Terminal peer-missing state — user sees recovery card |
| `first_remote_observed` | Remote appeared (recovery success or normal late join) |
| `daily_call_join_success` / `daily_call_join_failure` | Transport-level join |

### Web (`vdbg` category / console)

| Message | Meaning |
|---------|---------|
| `daily_no_remote_watchdog_start` | Watchdog armed after join when no remote in snapshot |
| `daily_no_remote_watchdog_timeout` | Timeout path — may trigger one internal rejoin (`no_remote_auto_recovery`) |
| `daily_no_remote_watchdog_recovery` | Rejoin scheduled |

Web does **not** emit `rc.*` breadcrumbs (React web stack); filter **`vdbg`** or console correlation.

---

## 3) PostHog — canonical journey events (PR #465 on `main`)

Use these names (exact strings) for funnels and breakdowns:

**Join funnel**

- `video_date_join_attempt`
- `video_date_join_success`
- `video_date_join_failure`

**Peer-missing (native UX)**

- `video_date_peer_missing_terminal_impression`
- `video_date_peer_missing_retry_tap`
- `video_date_peer_missing_keep_waiting_tap`
- `video_date_peer_missing_back_to_lobby_tap`

**Ready gate terminal / dismiss**

- `ready_gate_timeout`
- `ready_gate_stale_close`
- `ready_gate_not_now_tap`
- (full set: see `docs/analytics-lobby-to-post-date-journey.md` and `shared/analytics/lobbyToPostDateJourney.ts`)

**HogQL-style patterns (adjust project schema / property names to match your PostHog setup):**

```sql
-- Example: counts by day and platform for peer-missing impression (paste into PostHog SQL insight)
SELECT
  toDate(timestamp) AS day,
  properties.platform AS platform,
  count() AS impressions
FROM events
WHERE event = 'video_date_peer_missing_terminal_impression'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day, platform
ORDER BY day DESC;
```

```sql
-- Example: funnel join_attempt → join_success (session-level uniqueness may require window functions in your warehouse export)
SELECT countDistinctIf(person_id, event = 'video_date_join_attempt') AS attempts,
       countDistinctIf(person_id, event = 'video_date_join_success') AS successes
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY;
```

If properties differ (`session_id` vs `session_id` nested), normalize in your warehouse or use PostHog’s **funnel** UI with step filters instead of raw SQL.

---

## 4) Supabase — `event_loop_observability_events` (service role / SQL editor)

**Access:** Table is **not** exposed to `anon`/`authenticated`. Use **service role** or dashboard SQL. See `docs/supabase-cloud-deploy.md`.

### 4.0 Promotion vs drain vs mark_lobby (do not double-count)

**Before** aggregating `operation` totals or mixing hourly rollup views, read **[`event-loop-dashboard-normalization.md`](./event-loop-dashboard-normalization.md)**:

- **`drain_match_queue`** logs **two** rows per attempt (inner **`promote_ready_gate_if_eligible`** + outer drain envelope).
- **`mark_lobby_foreground`** logs **`outcome ≈ success`** for the RPC wrapper; real promotion state is **`detail.promotion`** or **`v_event_loop_mark_lobby_promotion_normalized`**.
- Prefer **`reason_code`** (and **`detail.step`**) over **`outcome`** alone for **`blocked`** rows.

### 4.1 Rows for one session (correlate promotion vs client pain)

```sql
SELECT id, created_at, operation, outcome, reason_code, latency_ms, event_id, actor_id, session_id, detail
FROM public.event_loop_observability_events
WHERE session_id = $1::uuid
ORDER BY created_at ASC;
```

For post-`20260605232304` route-owner churn or duplicate-surface reports, also inspect append-only surface claim history:

```sql
SELECT created_at, session_id, actor_id, surface, action, ok, blocked, retryable, result_code, expires_at, detail
FROM public.video_date_surface_claim_events
WHERE session_id = $1::uuid
ORDER BY created_at ASC;
```

After `20260606180000_video_date_stable_copresence_handshake_guard.sql` is applied, also inspect the service-only stable-copresence ledger. Use dashboard SQL or service-role tooling:

```sql
SELECT
  occurred_at,
  actor_id,
  source,
  event_type,
  owner_id,
  owner_state,
  call_instance_id,
  provider_session_id,
  entry_attempt_id,
  surface_client_id,
  details
FROM public.video_date_presence_events
WHERE session_id = $1::uuid
ORDER BY occurred_at ASC, created_at ASC;
```

Owner churn summary for a single session:

```sql
SELECT
  actor_id,
  owner_id,
  call_instance_id,
  provider_session_id,
  min(occurred_at) AS first_seen_at,
  max(occurred_at) AS last_seen_at,
  count(*) AS events
FROM public.video_date_presence_events
WHERE session_id = $1::uuid
  AND event_type IN ('owner_heartbeat', 'client_daily_alive', 'provider_daily_joined', 'provider_daily_left')
GROUP BY actor_id, owner_id, call_instance_id, provider_session_id
ORDER BY actor_id, first_seen_at;
```

Stable-copresence decisions should separate heartbeat freshness from stability. Latest heartbeat timestamps prove the two owners are still fresh; `stable_copresence_since_at` should point to the first qualifying bilateral owner-heartbeat pair after the later join and must be at least 2 seconds old unless remote-seen is already canonical.

Handshake without stable copresence should be treated as a red-alert regression after `20260606180000`. Start from these filters, then inspect the full session ledger:

```sql
SELECT created_at, operation, outcome, reason_code, session_id, actor_id, detail
FROM public.event_loop_observability_events
WHERE created_at > now() - interval '24 hours'
  AND (
    reason_code = 'handshake_started_after_active_daily_copresence'
    OR detail::text LIKE '%handshake_started_after_active_daily_copresence%'
    OR detail::text LIKE '%handshake_started_after_stable_copresence%'
    OR detail::text LIKE '%handshake_started_after_stable_daily_alive%'
  )
ORDER BY created_at DESC
LIMIT 200;
```

Provider-left after a route/session owner believed it was joined should emit client observability before any user-facing stuck state:

```sql
SELECT created_at, operation, outcome, reason_code, session_id, actor_id, detail
FROM public.event_loop_observability_events
WHERE created_at > now() - interval '24 hours'
  AND (
    reason_code = 'daily_owner_provider_left_unexpected'
    OR detail::text LIKE '%daily_owner_provider_left_unexpected%'
  )
ORDER BY created_at DESC
LIMIT 200;
```

For native notification `/date/:sessionId` reports, classify route-owner recovery before blaming Daily or the watchdog. An ended survey-eligible session with no `date_feedback` should produce Date-stack recovery, and the client fallback path should emit details such as `pending_survey_terminal_encounter` / `navigate_date` instead of routing to lobby/tabs.

### 4.2 Promotion / drain volume (last 7 days)

```sql
SELECT operation, outcome, count(*) AS n
FROM public.event_loop_observability_events
WHERE created_at > now() - interval '7 days'
GROUP BY operation, outcome
ORDER BY n DESC;
```

### 4.3 Ready-gate promotion subset (view wrapper)

```sql
SELECT created_at, outcome, reason_code, session_id, event_id, detail
FROM public.v_event_loop_promotion_events
WHERE created_at > now() - interval '24 hours'
  AND event_id = $1::uuid  -- optional event-scoped triage
ORDER BY created_at DESC
LIMIT 500;
```

### 4.4 Correlation narrative

- **High `promote_ready_gate_if_eligible` success** + **client `peer_missing_terminal_watchdog_fire`** for same `session_id` → often **partner never opened date app** or **Daily room split**, not queue logic failure.
- **`blocked` / `conflict`** on promotion/drain with **no** `daily_join_ok` → investigate registration / queue truth before media.

---

## 5) Recovery vs non-recovery (decision tree)

1. If **`first_remote_observed`** or **`remote_track_mounted`** appears **before** `peer_missing_terminal_watchdog_fire` → **delayed join**, not absent partner (watchdog false positive from user POV is **lag**).
2. If **`no_remote_watchdog_recovery_start`** fires and later **`first_remote_observed`** → **recovery succeeded** after one rejoin.
3. If **`peer_missing_terminal_watchdog_fire`** with **no** prior remote diagnostics → terminal **no-remote** path; user actions split via PostHog peer-missing tap events.
4. If a **native notification tap** for an ended survey-eligible session opens lobby/tabs or Ready Gate → route-owner/survey fallback regression, not a watchdog classification. Check for `pending_survey_terminal_encounter`, `navigate_date`, and absence of `date_feedback` before changing Daily timing.

---

## 6) “False positive” watchdog interpretation

The native watchdog is **time-bounded** (25s per phase of the effect; see `FIRST_CONNECT_TIMEOUT_MS` in `apps/mobile/app/date/[id].tsx`). A **false positive** in product terms usually means:

- Partner joined **after** the terminal card (late network / app backgrounding).
- Evidence: **`first_remote_observed`** shortly after terminal, or duplicate **`daily_join_ok`** on retry.

Do **not** conclude backend bug from watchdog alone without **`event_loop_observability_events`** + **`video_sessions`** row at that timestamp.

---

## 7) Recent triage checklist (copy for incidents)

1. **Sentry:** `session_id` → trace breadcrumbs `rc.video_date.entry` + `video-date-daily`.
2. **PostHog:** same `session_id` → join + peer-missing events.
3. **Supabase:** `event_loop_observability_events` WHERE `session_id` = … ; optional `video_sessions` row by id.
4. Classify: **queue**, **handshake**, **Daily join**, **first remote**, **reconnect** — use runbook section “Authoritative sources” in `docs/video-date-diagnostics-runbook.md`.
5. If the report started from a native notification tap, also classify **route owner / pending survey**: notification payload path, `video_sessions` terminal survey truth, missing/present `date_feedback`, and `pending_survey_terminal_encounter` / `navigate_date` route details.
