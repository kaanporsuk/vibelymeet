# Evidence-led tuning — lobby → ready gate → video date

**Purpose:** Decide whether to change **queued-drain cadence**, **reconnect-sync cadence**, or **observability** based on **measured** QA/production behavior — not intuition.

**Status of this document (repo snapshot):** This file records **what to measure** and **how to interpret** results. It does **not** embed live metrics: aggregate evidence lives in PostHog, Sentry, and Supabase (service role). Run the queries below on your environment before any threshold change.

**Related code:** Bounded delays are centralized in `shared/matching/convergenceScheduling.ts` (`nextConvergenceDelayMs`: 1s / 3s / 7s steps vs elapsed time bands — unchanged by this doc).

---

## 1. Evidence summary (static review — not production proof)

### 1.1 What we can infer without dashboards

| Topic | Inference | Strength |
|-------|-----------|----------|
| Queued drain **exists** on both platforms | Web: `useMatchQueue` + `drain_match_queue` when status `browsing`/`idle`; Native: initial drain + adaptive loop while queued/syncing (`queue_drain_*` triggers in lobby) | **Fact (code)** |
| Server-side promotion/drain outcomes | `event_loop_observability_events` + views (`v_event_loop_*`) — operations include drain/promotion paths | **Fact (schema/docs)** |
| Client **product** funnel for lobby | `shared/analytics/lobbyToPostDateJourney.ts` — impressions, ready gate, join, peer-missing | **Fact (taxonomy)** |
| Journey milestones | `shared/matching/videoDateDiagnostics.ts` — `video_date_journey_*` prefix | **Fact** |
| Reconnect sync breadcrumbs (web) | `src/hooks/useReconnection.ts` — `vdbg` → Sentry category `vdbg`, messages `sync_reconnect_*` | **Fact** |
| Reconnect sync breadcrumbs (native date) | `apps/mobile/app/date/[id].tsx` — same message names for parity | **Fact** |

### 1.2 What we **cannot** conclude without dashboards

- Whether users stay queued “too long” (need **time** from `lobby_convergence_impression` or session-level story → `ready_gate_*` / `video_date_journey_*`, correlated with `event_loop_observability_events`).
- Whether drain RPCs are **mostly no-ops** vs **successful promotion** (need Supabase aggregates on `operation` / `outcome` for `drain_match_queue`).
- Whether reconnect loops are **recovering** vs **spinning** (need Sentry: ratio of `sync_reconnect_result` outcomes × counts per session, or distribution of `totalSyncCount` at `sync_reconnect_loop_stop`).
- Whether current cadence is too aggressive (battery/RPC noise) vs too slow (missed promotion feel) — **requires** before/after RPC rates and UX signals.

**Verdict:** In-repo review alone is **inconclusive for numeric tuning**. Treat any threshold change as **invalid** until the queries in §3–§5 are run on a representative window (e.g. last 7–14 days QA + production).

---

## 2. Questions A–C — how to answer them

### A. Queued-drain

| Question | Evidence approach |
|----------|-------------------|
| Users queued longer than expected? | PostHog: time from `lobby_convergence_impression` (or session start) to `ready_gate_impression` / `video_date_journey_ready_gate_opened` where applicable; segment by `platform`, `event_id`. Supabase: rows for `session_id` with `operation` related to drain/promotion and timestamps. |
| Repeated drain, poor conversion? | Supabase: count `event_loop_observability_events` where `operation` = drain-related and `outcome` in (`blocked`, `conflict`, `noop`, … — use actual `reason_code` values in your deployment). Compare to successful ready-gate transitions for same `event_id`. |
| Cadence too aggressive / slow? | **Client:** Sentry search for native lobby (`queue_drain_interval` only exists in breadcrumbs/vdbg if you filter by message text — today there is **no** dedicated PostHog event per drain attempt). **Server:** RPC rate from observability table vs promotion success rate. |
| Recovery / missed promotion? | Correlate `drain_match_queue` outcomes with `video_sessions.ready_gate_status` transitions in SQL; check docs in `docs/audits/events-video-date-deep-investigation.md` for contract. |

**Instrumentation gap (non-blocking for ops):** There is no single PostHog event “drain_attempt_n” per client tick. For strict client-side drain-frequency science, consider a future **additive** counter event — **out of scope** unless product agrees (would be a separate PR).

### B. Reconnect-sync

| Question | Evidence approach |
|----------|-------------------|
| How often does sync recover the user? | Sentry: `sync_reconnect_result` with `outcome: ok` leading to stable UI vs subsequent `sync_reconnect_loop_stop` with reason `truth_stable_no_grace`. |
| Redundant / over-active? | Distribution of `totalSyncCount` at loop stop; sessions with high count + `ok` only — possible over-polling. Compare with native `sync_reconnect_schedule.delayMs` in breadcrumb data (matches `nextConvergenceDelayMs`). |
| Cleanup too slow / noisy? | `sync_reconnect_result` `ended` vs `rpc_error` rates; PostHog `video_date_reconnect_grace_expired` (web trackEvent in `useReconnection`) where present. |
| Duplicate sync work? | Code review + PR #467: lobby **deduped** duplicate `refetch` paths; reconnect loop still uses `inFlight` skip — search Sentry for `sync_reconnect_skip` with `skip: in_flight`. |

### C. Observability

| Operator question still hard? | Mitigation |
|------------------------------|------------|
| “Did server block promotion?” | `event_loop_observability_events` + `v_event_loop_promotion_events` — already documented in `watchdog-no-remote-query-pack.md`. |
| “Was reconnect sync useless churn?” | Sentry `vdbg` trail + outcomes — **requires** disciplined session-level export. |
| “Queue vs media failure?” | Runbook correlation: `docs/video-date-diagnostics-runbook.md` § Authoritative layers. |

**Remaining gap:** A **single dashboard** combining PostHog funnel + Supabase drain rate + Sentry reconnect counts per `session_id` is still **manual**. This doc does not add SQL views (would need DB migration + approval).

---

## 3. Recommended decisions (until metrics are collected)

| Area | Recommendation | Rationale |
|------|----------------|-----------|
| Adaptive queue-drain delays (`nextConvergenceDelayMs`) | **No change** | No aggregate latency or conversion evidence in repo; changing bands without histograms violates “no speculative tuning”. |
| Reconnect-sync cadence | **No change** | Same curve as queue-drain by design; tune only with Sentry distributions of `sync_reconnect_*` and RPC error rates. |
| Observability | **Docs/query hardening only** (this file + links) | Closes the “what to run” gap without new events or migrations. |

**After** you have 7–14 days of data:

- If **drain `blocked`/`conflict`** dominates for events with healthy foreground stamps → prioritize **server/contract** investigation, not faster client polling.
- If **time-in-queue** p95 is high but server shows **successful promotion** within seconds → investigate **client navigation** / realtime delivery, not `nextConvergenceDelayMs`.
- If **sync_reconnect** shows **high `totalSyncCount`** with **`ok`** only at end → consider **longer backoff** (evidence-led); if **`rpc_error`** spikes → fix RPC/network before backoff.

---

## 4. Query recipes (copy/paste starting points)

### 4.1 Supabase — drain / promotion volume (last 7 days)

See §4.2–4.3 in `docs/observability/watchdog-no-remote-query-pack.md`.

### 4.2 PostHog — convergence → ready gate lag (conceptual)

Use `LobbyPostDateEvents.LOBBY_CONVERGENCE_IMPRESSION` and ready-gate / journey events from `shared/analytics/lobbyToPostDateJourney.ts` and `videoDateDiagnostics.ts`. Build a funnel or SQL insight in PostHog UI; property names may vary — normalize in warehouse if needed.

### 4.3 Sentry — reconnect sync for one session

Filter breadcrumbs: category `vdbg`, messages prefix `sync_reconnect_`, data field `session_id` = UUID.

---

## 5. Change control

Any future PR that modifies `nextConvergenceDelayMs` or reconnect scheduling must attach:

1. **Before** histograms (queue time, drain outcomes, sync counts).
2. **Hypothesis** tied to evidence class (server-block vs client lag vs RPC errors).
3. **After** snapshot on the same window length.

---

## 6. References

**Production cadence snapshot (dates, tables, replay SQL):** [`evidence-backed-cadence-report-2026-04-22.md`](./evidence-backed-cadence-report-2026-04-22.md).

- `shared/matching/convergenceScheduling.ts`
- `docs/observability/watchdog-no-remote-query-pack.md`
- `docs/video-date-diagnostics-runbook.md`
- `shared/analytics/lobbyToPostDateJourney.ts`
- `shared/matching/videoDateDiagnostics.ts`
