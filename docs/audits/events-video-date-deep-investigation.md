# Events + video-date deep investigation (repo-grounded)

**Date:** 2026-04-11  
**Mode:** investigation only — no code changes, no deploy  

**Scope note:** The file **`Pasted text.txt`** referenced in the brief was **not found** in the workspace. This report treats **`docs/events-hardening-phase1-release-audit.md`**, **`phase2`**, **`phase3`**, **`_cursor_context/vibely_golden_snapshot_audited.md`**, **`_cursor_context/vibely_migration_manifest.md`**, and **`docs/supabase-full-backend-vs-frontend-audit.md`** as the composite “audit narrative” under scrutiny.

---

## Executive summary

1. **Yes — the narrative mixes eras.** The “March 10 frozen ZIP” baseline (per migration manifest: last file `20260310124838`) **does not include** Stream 2 migrations that introduced **`video_date_transition`** (`20260311133000`) and **`ready_gate_transition`** (`20260311153000`). Those are **documented as post-repair** in **`vibely_migration_manifest.md`**, not as contents of the 101-file frozen chain.

2. **`swipe-actions` is real in current HEAD** (`supabase/functions/swipe-actions/index.ts`; `src/hooks/useSwipeAction.ts`). It is **omitted** from **`vibely_golden_snapshot_audited.md` §6** (28-function list). **`git log`** shows the EF predates the March snapshot. Conclusion: **the golden snapshot §6 is not a reliable exhaustive Edge inventory** — treat as **stale/incomplete**, not as proof the EF did not exist.

3. **`mark_lobby_foreground`** and **`expire_stale_video_sessions`** are **real**, introduced in **April 2026** migrations (`20260404191500_*`, `20260404195500_*`), not in the March frozen archive.

4. **Ready Gate + video date** are **mostly robust** at the database layer: **`FOR UPDATE`** on `video_sessions` in transition RPCs, **terminal-state short-circuit**, **idempotent `mark_ready`**, **`expire_stale_video_sessions`** before drain/ready paths, **`SKIP LOCKED`** on queued row selection. **Gaps:** Phase 2 documents a **`sync`** action on `ready_gate_transition`, but **web `useReadyGate` does not invoke it** — polling uses **`select` on `video_sessions`** instead. **Participant presence** still uses **client-driven** `update_participant_status` and **direct `last_active_at` updates** in `useEventStatus`, so “all lifecycle server-owned” is **overstated** for presence/heartbeat.

5. **Queue story (current HEAD)** is **largely accurate** in the Phase 2/3 audits **for the swipe-first path**: queued rows get **`queued_expires_at`**, promotion is **`drain_match_queue`** with **FIFO `started_at ASC`**, **both partners must pass 60s foreground** + browsing/idle, cleanup runs **`expire_stale_video_sessions`**. **Legacy** `join_matching_queue` / `find_video_date_match` are **deprecated no-ops** (Phase 3). **Client triggers drain** when status is **`browsing`/`idle`** (`useMatchQueue`) — not “server-only” promotion.

6. **Critical discrepancy for trusting any single audit as source-of-truth:** **`vibely_golden_snapshot_audited.md` §6–7** under-enumerates Edge Functions and omits **`ready_gate_transition` / `video_date_transition`** from the RPC bullet list while the migration manifest correctly places those **after** the frozen cutoff. **Use migrations + current code over narrative tables.**

---

## 1) Baseline contamination / mixed eras

### 1.1 Claim ledger (summary)

Full row-level table: **`docs/audits/events-video-date-claim-ledger.md`**.

### 1.2 Chronology (authoritative anchors)

| Anchor | Evidence |
|--------|----------|
| Frozen ZIP last migration | `_cursor_context/vibely_migration_manifest.md`: **`20260310124838`** |
| Stream 2A `video_date_transition` | `supabase/migrations/20260311133000_video_date_state_machine.sql` |
| Stream 2B `ready_gate_transition` | `supabase/migrations/20260311153000_ready_gate_transition.sql` |
| Phase 1 presence / foreground | `20260404183000_phase1_presence_atomic_cleanup.sql`, `20260404191500_phase1_1_true_lobby_foreground.sql` |
| Phase 2 TTL + `expire_stale_*` | `20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql` |
| Phase 3 legacy queue deprecation | `20260412143000_phase3_legacy_queue_contract_cleanup.sql` |

**Verdict:** The “audited golden snapshot” describes a **repair-aligned** repo state **as of 2026-03-11**, but its **own** §2 migration range and §6–7 inventories are **not aligned** with a strict “only what was inside the March 10 zip SQL files” reading. The **manifest** is the better chronology tool than §6–7 tables.

### 1.3 Specific questions (answers)

| Question | Answer |
|----------|--------|
| Was **`swipe-actions`** part of the “frozen web baseline”? | **Not evidenced by `vibely_golden_snapshot_audited.md` §6** (function not listed). **Present in repo** with long history (`git log -- supabase/functions/swipe-actions/index.ts`). **Classification:** **PRESENT IN HEAD**; **frozen baseline doc incomplete**, not proof of absence. |
| Were **`ready_gate_transition`** / **`video_date_transition`** in the older baseline? | **Not inside the 101-file frozen chain** (manifest). Introduced **2026-03-11** migrations. **Classification:** **PRESENT IN HEAD, NOT PROVEN IN FROZEN ZIP BASELINE**. |
| Is **`mark_lobby_foreground`** real? | **VERIFIED IN MIGRATION + CODE** — April 2026 Phase 1.1. |
| Is **`expire_stale_video_sessions`** real? | **VERIFIED IN MIGRATION** — `20260404195500_*`; called from `drain_match_queue` and `ready_gate_transition` in Phase 2+ chain; **pg_cron** scheduled **best-effort** (`EXCEPTION` handler). |
| Does any audit present later hardening as March baseline? | **Risk:** **`vibely_golden_snapshot_audited.md` §7** lists `handle_swipe`/`drain_match_queue` but **omits** Ready Gate / video-date RPCs — reader may **infer** a single-era RPC set. **Manifest** explicitly adds Stream 2 **after** frozen zip. |

### 1.4 Material misleading patterns

- Treating **`vibely_golden_snapshot_audited.md` §6** as the complete Edge Function manifest.
- Equating **“March 10 frozen ZIP”** with **current** `handle_swipe` / `drain_match_queue` bodies (multiple **April 2026** replacements).
- Assuming **legacy queue RPCs** behave as in old product after **Phase 3** no-ops.

---

## 2) Ready Gate + video-date race semantics

### 2.1 Canonical transition graph (current HEAD, consolidated from SQL + hooks)

**Ready gate (`video_sessions.ready_gate_status` and related columns)** — primary RPC: **`ready_gate_transition`**.

Text diagram:

```
[queued] --(handle_swipe mutual, not both foreground)--> may stay queued
[queued] --(drain_match_queue: both foreground + TTL ok)--> [ready] + ready_gate_expires_at set
[ready] --(mark_ready)--> [ready_a | ready_b] --(other marks ready)--> [both_ready]
[ready|ready_a|ready_b] --(snooze)--> [snoozed] --(expire_stale wakes OR time passes)--> back to ready-family / both_ready per SQL
[ready|ready_a|ready_b|snoozed] --(forfeit)--> [forfeited] + session ended fields + registrations cleared (Phase 2+)
[ready|ready_a|ready_b] --(ready_gate_expires_at passes)--> expire_stale may set [expired] + end session
Terminal for overlay: [both_ready] --> client navigates to /date/:sessionId
```

**Video date (`video_sessions.state` / `phase`)** — primary RPC: **`video_date_transition`**.

```
[both_ready in gate] --(enter_handshake)--> handshake state + event_registrations in_handshake
--(vibe / complete_handshake per actions)--> [date] + in_date
--(end / reconnect grace paths)--> ended + registration cleanup (per action branch)
```

**Ownership:**

| Transition | DB RPC | Client role |
|--------------|--------|-------------|
| Ready timestamps / gate status | **`ready_gate_transition`** | Calls RPC only (`useReadyGate.ts`) |
| Snooze / forfeit | Same | Same |
| `sync` | **`ready_gate_transition('sync')`** | **Not used in web hook** — hook polls `select` |
| Enter handshake / date / end | **`video_date_transition`** | `VideoDate.tsx`, `useReconnection.ts` |
| Daily room token | **`daily-room`** Edge | `useVideoCall` / `daily-room` |
| Participant “browsing/offline/in_ready_gate” | **`update_participant_status`** | **`useEventStatus`**, **`ReadyGateOverlay`** `setStatus` |
| Foreground proof | **`mark_lobby_foreground`** | **`EventLobby.tsx`** |

### 2.2 Atomicity / locking

| Location | Mechanism |
|----------|-----------|
| `ready_gate_transition` | `SELECT ... FROM video_sessions WHERE id = ... **FOR UPDATE**` (see Phase 2 migration) |
| `video_date_transition` | `FOR UPDATE` on session row (reconnect migration and predecessors) |
| `handle_swipe` mutual block | `FOR UPDATE` on **both** `event_registrations` rows before insert |
| `drain_match_queue` | `FOR UPDATE SKIP LOCKED` on chosen queued `video_sessions` row |
| `expire_stale_video_sessions` | Multiple loops with `FOR UPDATE SKIP LOCKED` |

**VERIFIED IN MIGRATION** — see `20260404195500_*` and `20260412143000_*`.

### 2.3 Idempotency

- **`mark_ready`:** If timestamps already set, logic keeps **terminal `both_ready`** path idempotent-style; RPC returns success with current status (see `ready_gate_transition` — early terminal return).
- **Duplicate room creation:** `daily-room` **`createDailyRoom`** treats Daily **400 already exists** as success path (see `supabase/functions/daily-room/index.ts`).

### 2.4 Race-condition matrix

| Scenario | Current protection | Evidence | Residual risk |
|----------|-------------------|----------|---------------|
| Double **mark_ready** | Same session row `FOR UPDATE`; second call sees updated timestamps | `ready_gate_transition` | Low — may return success with existing `both_ready` |
| **mark_ready** vs **forfeit** | Serialized by `FOR UPDATE` on same row | SQL | Low under normal DB serial isolation |
| Start date when session ended | `enter_handshake` checks `ended_at`; `READY_GATE_NOT_READY` if gate not satisfied | `20260409100000_*` | Low if RPC always used first |
| Stale client shows gate | Realtime + 2s polling on `video_sessions`; terminal dedup in hook | `useReadyGate.ts` | Medium — UI can flash until fetch catches up |
| Duplicate promotion of queue | `SKIP LOCKED` + single-row `LIMIT 1` | `drain_match_queue` | Low for concurrent drains |
| Partner not “present” | Drain requires **both** `last_lobby_foregrounded_at` within 60s + browsing/idle | `handle_swipe`, `drain_match_queue` | **Product risk** if users think they are “in lobby” but visibility not stamped |
| **`sync` RPC unused** | Polling uses direct `select`, not `sync` | `useReadyGate.ts` vs Phase 2 doc | Low functional risk if `select` matches; **doc/code drift** |

### 2.5 Reconnect: server vs UI

**VERIFIED IN CODE:** `useReconnection.ts` polls **`video_date_transition('sync_reconnect')`** every 1s and calls **`mark_reconnect_partner_away`** / **`mark_reconnect_return`**. Expiry of grace is **applied inside SQL** when timestamps elapsed (`20260409100000_*`). **Not “UI-only”** — server columns `reconnect_grace_ends_at`, `participant_*_away_at` are authoritative.

### 2.6 Client writes that undermine “fully server-owned”

- **`useEventStatus`:** `update_participant_status` RPC + **direct** `event_registrations.update({ last_active_at })` heartbeat.
- **`ReadyGateOverlay`:** sets **`in_ready_gate`** via `setStatus` on mount.
- **`VideoDate`:** **`video_date_transition`** for lifecycle (good); **beforeunload** uses **`fetch` to RPC** (keeps JWT; server-owned).

### 2.7 Verdict: robustness

**Verdict: `mostly robust`**

**Reasons:** Strong DB locking on critical RPCs; explicit expiry pipeline; idempotent-friendly gate; reconnect grace server-owned; Daily duplicate-room handled.

**Why not `robust`:** Presence/heartbeat **client writes** to `event_registrations`; **documented `sync` action** not used by web hook; reliance on **foreground stamp** + **60s window** creates user-tunable failure modes that are **product semantics**, not DB bugs.

**Is the audit overstating?** Phase 1–2 audits are **directionally right** on TTL + cleanup + forfeit ownership. Any claim of **“clients never touch registration lifecycle”** is **overstated** given `useEventStatus` heartbeat and status RPCs.

---

## 3) Queue lifecycle truth

### 3.1 Narrative (current HEAD, swipe-first)

1. **Mutual vibe** in `handle_swipe` inserts **`video_sessions`** with **`ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING`** → **`already_matched`** if duplicate.
2. If **both** users are “present” (queue_status in `browsing`/`idle`, **`last_lobby_foregrounded_at` within 60s**), row is **`ready`** immediately with **`ready_gate_expires_at`**.
3. Otherwise row is **`queued`** with **`queued_expires_at = now() + 10 minutes`** (Phase 2+).
4. **`expire_stale_video_sessions`** expires queued rows past TTL (and other stale gate states) — invoked from **`drain_match_queue`** and **`ready_gate_transition`** (Phase 2+) and optionally **cron**.
5. **`useMatchQueue`** runs **`drain_match_queue`** when **`currentStatus`** is **`browsing` or `idle`** — **client-triggered** drain on those transitions.
6. Realtime on **`video_sessions`** also fires when **`queued` → `ready`** for same event.
7. Legacy **`join_matching_queue` / `find_video_date_match`**: **deprecated no-op** responses (Phase 3) — **do not** use for active flow verification.

### 3.2 Truth table (audit vs repo)

| Audit-style claim | Verdict |
|------------------|---------|
| Queued matches have TTL | **TRUE** — `queued_expires_at` + fallback `started_at + 10m` in cleanup |
| Stale cleanup runs | **TRUE** — `expire_stale_video_sessions()`; cron **best-effort** |
| Promotion ordering | **TRUE: oldest `started_at` first** among user’s eligible queued rows (`ORDER BY started_at ASC LIMIT 1`) |
| FIFO “globally” | **INFERRED: per-user drain** picks one row; **not proven** global strict FIFO across all users |
| Drain is server-side | **PARTIAL** — server RPC does work; **client must call** drain when browsing |
| Legacy queue join path | **FALSE for product** — no-op compatibility |

### 3.3 Top queue inconsistencies / ambiguities (risk list)

1. **Dual trigger:** RPC drain **and** realtime `queued→ready` — both can surface Ready Gate; clients should tolerate duplicate callbacks (overlay/session id handling).
2. **Foreground clock:** Immediate match and drain both depend on **`mark_lobby_foreground`** + 60s — **UX/network** can block promotion without DB “bug.”
3. **Migration churn:** Manifest warns **function rewrite drift** between phases — always read **latest** `CREATE OR REPLACE` in chain.
4. **Test/destructive migrations:** Manifest flags **destructive** historical migrations — **do not** equate clean dev DB with prod behavior.

---

## 4) No-code follow-ups (highest value)

1. **Reconcile documentation:** Update **`vibely_golden_snapshot_audited.md` §6–7** or add a banner: “non-exhaustive; see `supabase/functions` and `types.ts`.”
2. **Clarify `sync`:** Either **call `ready_gate_transition('sync')`** from polling (if desired) **or** remove/adjust Phase 2 audit language.
3. **Inventory narrative docs:** Restore or link missing filenames requested in the brief, or mark them deprecated to reduce **orphan references**.
4. **Operational proof:** Confirm **`pg_cron`** job exists in **production** (migration is best-effort if extension missing).

---

## 5) What the composite audit got right / partially / wrong / unproven

| Bucket | Items |
|--------|--------|
| **Right** | Swipe-first architecture; `queued_expires_at` ~10m; `expire_stale_video_sessions` exists; `drain_match_queue` runs cleanup first; legacy queue RPCs deprecated in Phase 3; web uses **`swipe-actions`** not direct `handle_swipe`; no **`leave_matching_queue`** in active `src`/`apps/mobile` |
| **Partially right** | “Server-owned lifecycle” — **true for gate/date RPCs**; **partially false** for presence/heartbeat client writes; “polling uses `sync`” — **RPC exists, web hook doesn’t use it** |
| **Wrong / unsafe if read literally** | **`vibely_golden_snapshot_audited.md` §6** as complete Edge list; §7 as complete RPC list; “March 10 zip contains Stream 2 RPCs” (**manifest contradicts**) |
| **Unproven without live DB** | Whether **cron** job is active in prod; exact historical behavior **before** each rewrite |

---

## Source map

See **`docs/audits/events-video-date-source-map.md`**.

---

## Claim ledger

See **`docs/audits/events-video-date-claim-ledger.md`**.
