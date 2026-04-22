# Event-loop dashboard normalization (operators)

How to read **`promote_ready_gate_if_eligible`**, **`drain_match_queue`**, and **`mark_lobby_foreground`** telemetry without overstating backend problems.

**Audience:** operators using **service role** or **Supabase SQL Editor** (`postgres`).  
**Related:** [`watchdog-no-remote-query-pack.md`](./watchdog-no-remote-query-pack.md), [`evidence-backed-cadence-report-2026-04-22.md`](./evidence-backed-cadence-report-2026-04-22.md).

---

## 1. How each RPC writes observability

| RPC | `operation` value | What it measures |
|-----|-------------------|------------------|
| **`promote_ready_gate_if_eligible`** (callable directly in theory; usually invoked internally) | `promote_ready_gate_if_eligible` | **Inner promotion engine** — one row per invocation with outcome/reason for the helper. |
| **`drain_match_queue`** | `drain_match_queue`, then **`promote_ready_gate_if_eligible`** | **Drain** runs cleanup, then calls the helper, then writes a **second** row summarizing drain’s envelope (`found`, mapped outcome). |
| **`mark_lobby_foreground`** | `mark_lobby_foreground` | Lobby heartbeat RPC; observability **`outcome` is typically `success`** when the RPC completes. Actual promotion result lives in **`detail.promotion`** (nested JSON from the same helper). |

**Double-logging:** A single **`drain_match_queue`** HTTP/RPC call typically inserts **two** rows: first **`promote_ready_gate_if_eligible`** (engine), second **`drain_match_queue`** (wrapper). **`mark_lobby_foreground`** inserts **one** row for itself; that row’s nested **`detail.promotion`** reflects the helper result without a separate **`promote_*` row** for that call path.

---

## 2. Operator misreads to avoid

1. **Summing `promote_ready_gate_if_eligible` + `drain_match_queue` row counts** as “total promotions” → **double-counts** every drain attempt (engine + wrapper).

2. **Using `drain_match_queue.success` alone** as “promotions worked” → misses **`handle_swipe`** immediate matches and **`mark_lobby_foreground`** successes (nested promotion).

3. **Treating `mark_lobby_foreground.outcome = success` as promotion success** → incorrect; read **`promotion_promoted`** / **`promotion_reason`** or **`v_event_loop_mark_lobby_promotion_normalized`**.

4. **Ignoring `reason_code`** when **`outcome = blocked`** → **`blocked` bundles** event validity, admission, and presence reasons; **`reason_code`** disambiguates.

5. **Hourly rollups:** **`v_event_loop_promotion_outcomes_hourly`** counts **engine** rows only; **`v_event_loop_drain_outcomes_hourly`** counts **drain wrapper** rows only — **do not add the two hour totals** as one funnel without dedupe rules below.

---

## 3. Canonical counting strategies (dedupe)

### 3.1 “What did users invoke?” (RPC surface)

Count by **`operation`** and **do not** add **`promote_ready_gate_if_eligible`** when the question is “how often did clients call drain?”

```sql
-- Drain RPC volume (outer surface only)
SELECT count(*)::bigint
FROM public.event_loop_observability_events
WHERE operation = 'drain_match_queue'
  AND created_at >= now() - interval '7 days';
```

### 3.2 “What did the promotion engine decide?” (inner path)

Use **`operation = 'promote_ready_gate_if_eligible'`** **or** **`v_event_loop_promotion_events`**. Accept that **drain** and **mark_lobby** drive many of these rows indirectly.

### 3.3 “Double-count safe” funnel proxy

If you need **one row per logical drain attempt**, prefer the **drain wrapper** row only:

```sql
SELECT outcome, reason_code, count(*)::bigint AS n
FROM public.v_event_loop_drain_events
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY n DESC;
```

For engine-level reasons with **dedupe**, either:

- Use **drain** rows when analyzing **drain callers** (reason is propagated from promote), **or**
- Use **promote** rows when analyzing **all** promotion attempts (including **`mark_lobby`**-only paths if you correlate by time/actor — not in the same row stream as drain).

### 3.4 `metric_stream` helper view

**`v_event_loop_observability_metric_streams`** adds **`metric_stream`**: `promotion_engine_inner`, `drain_rpc_outer`, `mark_lobby_rpc`, etc. Filter **`metric_stream = 'drain_rpc_outer'`** to exclude inner promote rows when building drain dashboards.

---

## 4. Reason-first interpretation (`reason_code`)

Always bucket by **`reason_code`** (and **`detail.step`** for **`event_not_valid`**) before blaming “queue broken.”

| `reason_code` (promote / echoed on drain) | Typical meaning |
|------------------------------------------|-----------------|
| **`event_not_valid`** | Event not **`live`**, ended, or cancelled — often **pre-live / post-end** browsing. **`detail.step`**: **`event_share_lock`** vs **`revalidate_event`**. |
| **`no_queued_session`** | No eligible **`video_sessions`** row (**`ready_gate_status = queued`**) for this user at pick time — includes **idle drain**, **TTL expiry**, **other worker took SKIP LOCKED**, **not yet queued**. |
| **`session_not_promotable`** | Race: session changed between lock and revalidation (`no_op`). |
| **`self_not_present`**, **`partner_not_present`** | Lobby foreground / queue_status gates — expected under presence rules. |
| **`participant_has_active_session_conflict`** | **`conflict`** outcome — mutual exclusion vs another active session. |
| **`registration_missing`**, **`admission_not_confirmed`** | Registration / admission gates. |

---

## 5. `detail.step` for `event_not_valid` and `no_queued_session`

| `detail.step` (promote rows) | Branch |
|-----------------------------|--------|
| **`event_share_lock`** | Failed **`FOR SHARE`** on **`events`** — event not promotable **before** any queue pick. |
| **`revalidate_event`** | Failed second **`events`** existence check mid-function. |
| **`pick_queued_session`** | No queued session passed the SQL filter (`no_queued_session`). |
| **`revalidate_session`** | Session no longer queued / TTL (`session_not_promotable`). |
| **`presence_self`**, **`presence_partner`** | Presence failure after session pick. |

---

## 6. Reading `mark_lobby_foreground`

- Use **`v_event_loop_mark_lobby_events`** or **`v_event_loop_mark_lobby_promotion_normalized`**.
- **`promotion_derived_outcome`** (normalized view): maps nested JSON to **`success` / `no_op` / `blocked` / `conflict` / `other` / `unknown`**, aligned with engine taxonomy.
- **`rpc_completed_observability_outcome`** in the normalized view keeps the literal wrapper column (usually “success”) so it is obvious it is **not** promotion success.

---

## Appendix A — Full-privilege correlation (SQL Editor / postgres)

Run with a role that can **`SELECT`** all of **`public.events`** (service role or `postgres`). **LEFT JOIN** catches orphan `event_id`s in telemetry.

### A.1 `event_not_valid` by actual `events.status`

```sql
SELECT
  COALESCE(e.status::text, '(no events row)') AS event_status,
  o.detail->>'step' AS detail_step,
  count(*)::bigint AS n
FROM public.event_loop_observability_events o
LEFT JOIN public.events e ON e.id = o.event_id
WHERE o.operation = 'promote_ready_gate_if_eligible'
  AND o.reason_code = 'event_not_valid'
  AND o.created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY n DESC;
```

### A.2 `no_queued_session` concentration by `event_id`

```sql
SELECT
  event_id,
  count(*)::bigint AS n,
  count(DISTINCT actor_id)::bigint AS distinct_actors
FROM public.event_loop_observability_events
WHERE operation = 'promote_ready_gate_if_eligible'
  AND reason_code = 'no_queued_session'
  AND created_at >= now() - interval '14 days'
GROUP BY 1
ORDER BY n DESC
LIMIT 50;
```

### A.3 Repeated clusters: `(actor_id, event_id)` (drain wrapper)

```sql
SELECT
  actor_id,
  event_id,
  count(*)::bigint AS attempts,
  min(created_at) AS first_at,
  max(created_at) AS last_at
FROM public.event_loop_observability_events
WHERE operation = 'drain_match_queue'
  AND actor_id IS NOT NULL
  AND created_at >= now() - interval '14 days'
GROUP BY 1, 2
HAVING count(*) >= 5
ORDER BY attempts DESC
LIMIT 100;
```

### A.4 Observability `event_id` orphan check (LEFT JOIN)

```sql
SELECT
  count(*) FILTER (WHERE e.id IS NULL)::bigint AS rows_without_events_row,
  count(*)::bigint AS total_rows
FROM public.event_loop_observability_events o
LEFT JOIN public.events e ON e.id = o.event_id
WHERE o.created_at >= now() - interval '14 days';
```

### A.5 `mark_lobby` nested promotion distribution

```sql
SELECT
  promotion_derived_outcome,
  promotion_reason,
  count(*)::bigint AS n
FROM public.v_event_loop_mark_lobby_promotion_normalized
WHERE created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY n DESC;
```

Alternative without migration (same logic):

```sql
SELECT
  CASE
    WHEN detail->'promotion'->>'promoted' = 'true' THEN 'success'
    WHEN detail->'promotion'->>'reason' IS NULL THEN 'unknown'
    WHEN detail->'promotion'->>'reason' IN ('no_queued_session', 'session_not_promotable') THEN 'no_op'
    WHEN detail->'promotion'->>'reason' = 'participant_has_active_session_conflict' THEN 'conflict'
    WHEN detail->'promotion'->>'reason' IN (
      'event_not_valid', 'registration_missing', 'admission_not_confirmed',
      'self_not_present', 'partner_not_present'
    ) THEN 'blocked'
    ELSE 'other'
  END AS promotion_derived_outcome,
  detail->'promotion'->>'reason' AS promotion_reason,
  count(*)::bigint AS n
FROM public.event_loop_observability_events
WHERE operation = 'mark_lobby_foreground'
  AND created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY n DESC;
```

---

## Appendix B — Objects added for normalization

| Object | Purpose |
|--------|---------|
| **`v_event_loop_mark_lobby_promotion_normalized`** | **`mark_lobby`** rows with **`promotion_derived_outcome`** and renamed wrapper outcome column. |
| **`v_event_loop_observability_metric_streams`** | All core operations plus **`metric_stream`** for dedupe-friendly filters. |

Existing views remain unchanged; comments on hourly rollups clarify double-count context.
