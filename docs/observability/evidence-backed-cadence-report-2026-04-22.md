# Evidence-backed cadence snapshot — queue drain & reconnect sync

**Captured:** 2026-04-22 (automated queries via `supabase db query --linked` against linked production project **MVP_Vibe**).

**Dashboard note:** When interpreting totals here (promote vs drain vs hourly rollups), apply **[`event-loop-dashboard-normalization.md`](./event-loop-dashboard-normalization.md)** so counts are not double-counted or misread.

**Limits:** PostHog and Sentry aggregates were **not** exported in this run (`POSTHOG_*` / `SENTRY_AUTH_TOKEN` unavailable in CI/local shell). Rows marked **—** must be filled from dashboard exports using `docs/observability/evidence-led-queue-reconnect-tuning.md`.

---

## 1. Queue-drain evidence (Supabase + gaps)

### 1.1 `event_loop_observability_events` — `drain_match_queue` (production)

Window | Total rows | `blocked` + `event_not_valid` | `no_op` + `no_queued_session` | `error` + `unauthorized` | Notes |
|--------|------------|-------------------------------|-------------------------------|---------------------------|-------|
| **14d** | **107** | **79** (73.8%) | **28** (26.2%) | **1** (0.9%) | No other outcome codes in window. |
| **7d** | **107** *(identical to 14d — all sampled drain rows fall in last 7 days)* | **79** | **28** | **1** | — |

All-time histogram for `drain_match_queue` matches the above three buckets only (**108** rows total — **success** outcomes are **not present** in this dataset for `drain_match_queue`).

### 1.2 Drain attempts per “unit of work” (proxy — session_id absent)

In the **14d** window, **`session_id` is null** on every `drain_match_queue` row sampled. Drain pressure is summarized per **`(actor_id, event_id)`**:

| Metric | Value |
|--------|-------|
| Distinct `(actor_id, event_id)` pairs | **40** |
| Sum of counts (matches row total) | **107** |
| **p50** attempts per pair | **2** |
| **p95** attempts per pair | **8** |
| **Max** attempts (single pair) | **8** |

### 1.3 Promotion vs no-promotion (`promote_ready_gate_if_eligible`, 14d)

| Outcome | Reason | Count | Share |
|---------|--------|-------|-------|
| `blocked` | `event_not_valid` | **234** | ~76% |
| `no_op` | `no_queued_session` | **74** | ~24% |

No `success` rows in **14d** for this operation in this export (low live-event traffic pattern for this snapshot).

### 1.4 PostHog — queued convergence duration (web vs native)

| Metric | Web | Native |
|--------|-----|--------|
| **p50** time lobby convergence → ready gate impression / journey open | **—** | **—** |
| **p95** | **—** | **—** |

**Method:** HogQL / funnels using `LobbyPostDateEvents.LOBBY_CONVERGENCE_IMPRESSION`, `LobbyPostDateEvents.READY_GATE_IMPRESSION`, `video_date_journey_ready_gate_opened` as appropriate — **not run here**.

---

## 2. Reconnect-sync evidence (Sentry — gaps)

Desired table (from `vdbg` breadcrumbs: `sync_reconnect_result`, `sync_reconnect_loop_stop`):

| Metric | Value |
|--------|-------|
| Outcome mix (`ok` / `ended` / `rpc_error`) | **—** |
| Mean / p95 **`totalSyncCount`** at `sync_reconnect_loop_stop` | **—** |
| **`rpc_error` incidence** (% of sync fires) | **—** |
| Sessions with **`totalSyncCount` ≥ threshold** (e.g. noisy loops) | **—** |

**Method:** Sentry Discover — category `vdbg`, message contains `sync_reconnect_`, parse `data.outcome` / `totalSyncCount` — **requires** `SENTRY_AUTH_TOKEN` + scripted export or Issues → query.

---

## 3. Recommendation (evidence-backed)

**Verdict:** **No cadence change** (`nextConvergenceDelayMs` unchanged).

**Reasoning:**

1. **`drain_match_queue` outcomes** are overwhelmingly **`blocked` / `event_not_valid`** or **`no_op` / `no_queued_session`**. There is **no** logged **success/promotion** slice in **`event_loop_observability_events`** for `drain_match_queue` across **all recorded rows** in this database snapshot. Changing client backoff (1s → 3s → 7s) does **not** address **`event_not_valid`** — that is a **server / event-live / admission** gate, not polling speed.
2. **`promote_ready_gate_if_eligible`** shows the same dominant **`event_not_valid` blocked** pattern — reinforces **availability / validity** semantics over cadence.
3. **Reconnect-sync** aggregates are **missing** — we **must not** tune backoff without **Sentry** distributions (per `docs/observability/evidence-led-queue-reconnect-tuning.md`).
4. **PostHog** UX latency (convergence duration) is **missing** — cannot justify cadence tweak from UX p95 without funnel export.

**Optional next step (non-code):** Run PostHog + Sentry exports and attach a successor row to this doc; revisit only if **`rpc_error`** or **`totalSyncCount` p95** spikes, or funnel shows **multi-minute** convergence with **successful** drain rows.

---

## 4. Change control

| Change type | Applied in this snapshot |
|-------------|---------------------------|
| `shared/matching/convergenceScheduling.ts` | **No change** |
| Analytics taxonomy | **No change** |
| Backend contracts | **No change** |

---

## 5. Queries used (replay)

### Drain outcomes (14d)

```sql
SELECT outcome, reason_code, count(*)::bigint AS n
FROM public.event_loop_observability_events
WHERE operation = 'drain_match_queue'
  AND created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY n DESC;
```

### Attempts per `(actor_id, event_id)` (14d)

```sql
WITH per_actor_event AS (
  SELECT actor_id, event_id, count(*)::bigint AS attempts
  FROM public.event_loop_observability_events
  WHERE operation = 'drain_match_queue'
    AND actor_id IS NOT NULL
    AND created_at >= now() - interval '14 days'
  GROUP BY actor_id, event_id
)
SELECT count(*) AS actor_event_pairs,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY attempts) AS p50_attempts,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY attempts) AS p95_attempts,
       max(attempts) AS max_attempts,
       sum(attempts)::bigint AS total_rows
FROM per_actor_event;
```
