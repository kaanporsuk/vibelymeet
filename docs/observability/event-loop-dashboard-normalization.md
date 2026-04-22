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
| **`mark_lobby_foreground`** | **`promote_ready_gate_if_eligible`** then **`mark_lobby_foreground`** | Same helper runs first (engine row), then the RPC logs **`mark_lobby_foreground`** with **`outcome` ≈ `success`** when the call completes. Nested **`detail.promotion`** echoes the helper JSON for convenience. |

**Double-logging:** A **`drain_match_queue`** call inserts **two** rows: **`promote_ready_gate_if_eligible`** (engine) then **`drain_match_queue`** (wrapper). **`mark_lobby_foreground`** inserts **two** rows as well — **engine first**, **wrapper second** — because the helper always emits **`promote_*` telemetry** regardless of caller. Counting **`promote_ready_gate_if_eligible`** rows therefore includes both **drain-driven** and **mark_lobby-driven** attempts (**not** “drain volume × 2” alone).

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

---

## Appendix C — Production re-check (linked project, normalized semantics)

**Captured:** 2026-04-22 via `supabase db query --linked` against **MVP_Vibe**. **Window:** last **14 days** unless noted.

**Deploy status (2026-04-22 closure):** Migration **`20260430123100_event_loop_operator_normalized_read_models.sql`** has been applied to the linked project (`supabase db push --linked`). Operators should prefer **`v_event_loop_observability_metric_streams`** and **`v_event_loop_mark_lobby_promotion_normalized`** over re-deriving **`metric_stream`** inline.

Earlier snapshot note (pre-push): normalized views were absent — semantics could be reproduced **inline** (`metric_stream` CASE + same CASE as **`v_event_loop_mark_lobby_promotion_normalized`**).

### C.1 Row arithmetic (why `promote` ≫ `drain`)

| Slice | Count | Notes |
|-------|------:|-------|
| **`drain_match_queue`** (wrapper only) | **108** | User-visible drain RPC attempts. |
| **`promote_ready_gate_if_eligible`** (engine) | **308** | **Every** helper invocation, including those from **`mark_lobby_foreground`**. |
| **`mark_lobby_foreground`** | **200** | Subset with **`reason_code`** echoing nested promotion (**154** `event_not_valid`, **46** `no_queued_session` in primary breakdown); other rows may exist with different echoes. |

**Identity (approximate):** `count(promote_inner) ≈ count(drain_outer) + count(mark_lobby_calls_that_invoke_helper)` → **308 ≈ 108 + 200**. This explains why raw **`promote`** totals looked inflated versus **`drain`** — **not** a duplicate-logging bug, but **two schedulers** (drain + lobby foreground heartbeat) both calling the same helper.

### C.2 Outcome mix (14d, by `metric_stream`)

| Stream | Dominant rows |
|--------|----------------|
| **`drain_rpc_outer`** | **79** `blocked` / **`event_not_valid`**, **28** `no_op` / **`no_queued_session`**, **1** `error` / **`unauthorized`** |
| **`promotion_engine_inner`** | **234** `blocked` / **`event_not_valid`**, **74** `no_op` / **`no_queued_session`** |
| **`mark_lobby_rpc`** | **`outcome`** mostly **`success`** with **`reason_code`** = nested **`event_not_valid`** (**154**) or **`no_queued_session`** (**46**) — **always interpret nested promotion, not `outcome`** |

### C.3 Success / anomaly check

- **`drain_match_queue`** with **`outcome = success`:** **0** (14d).
- **`promote_ready_gate_if_eligible`** with **`outcome = success`:** not fully re-queried in-session (circuit breaker); prior snapshots also showed **no** success in low–live-traffic windows.
- **`mark_lobby`** with **`detail.promotion.promoted = true`:** **0** (14d).

**Interpretation:** Low/zero **`success`** in this window reflects **sparse live queued promotion** + guards (**`event_not_valid`**, **`no_queued_session`**), **not** proof of a broken helper after normalization. Immediate matches remain on **`handle_swipe`** (`match_immediate`), outside this slice.

### C.4 Concentrations

- **`event_not_valid`** (**promote**, 14d): clustered **`event_id`s** (top **42**, **38**, **28**, … hits per event — expected product traffic concentration).
- **`LEFT JOIN public.events`** on **`event_not_valid`**: **214** rows **`(no events row)`**, **20** **`upcoming`**, **`detail_step`** = **`event_share_lock`** — confirms **non-live / visibility** semantics; **full reconciliation** requires **SQL Editor / `postgres`** (management CLI role may not resolve all `event_id`s — see Appendix A).

### C.5 Follow-ups

1. ~~**Apply migration `20260430123100_*`** on production~~ **Done** for linked **MVP_Vibe** (`supabase db push --linked`, 2026-04-22). Other Supabase projects: apply the same migration in each environment’s deploy pipeline.
2. Re-run Appendix A **`LEFT JOIN`** as **`postgres`** if **`(no events row)`** share stays high — distinguishes **RLS/role** vs **deleted events** vs **bad ids**.
