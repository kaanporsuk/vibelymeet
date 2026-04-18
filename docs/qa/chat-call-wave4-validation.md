# Match calls — Wave 4 repeatable validation (ops + dev)

**Purpose:** Prove chat voice/video call behavior after Waves 1–4 without a full E2E suite. Use on staging or a dedicated test project. Mark **PASS / FAIL / SKIP** with env + date.

**Prereqs:** Two accounts, active match, `daily-room` + `send-notification` deployed, Realtime enabled on `match_calls`, optional `match-call-room-cleanup` + pg_cron for `expire_stale_match_calls` (see `supabase/migrations/`).

---

## A. Log filters (production / Edge)

| What | Search / filter |
|------|-----------------|
| App-level duplicate reject (precheck) | `"create_match_call_rejected"` + `"reject_layer":"precheck"` + `DUPLICATE_ACTIVE_CALL` |
| DB race duplicate | `"create_match_call_duplicate_db"` + `"reject_layer":"db_unique"` |
| Eligibility (archived, block, pause, suspend) | `"create_match_call_rejected"` + code `ARCHIVED_MATCH` / `USERS_BLOCKED` / `PARTICIPANT_PAUSED` / `PARTICIPANT_SUSPENDED` |
| Token after answer transition | `"answer_match_call_token_failed_after_transition"` |
| Answer for missing row | `"answer_match_call_not_found"` |
| Unhandled Edge exception | `"daily_room_unhandled_exception"` |
| Daily room cron batch | `"match_call_room_cleanup_batch"` |
| Postgres stale ring expiry | Server logs: `expire_stale_match_calls expired_count=` |

**Client (dev builds only):** console filter `[match_call_diag]` — abnormal teardown RPC, unload/background keepalive, outbound ring restore.

---

## B. Scenarios

### B1 — Happy path (voice + video)

| Step | Caller | Callee | Pass criteria |
|------|--------|--------|----------------|
| 1 | Start voice call | Receive incoming UI | Ringing state; callee sees overlay |
| 2 | — | Answer | Both `in_call`; audio works |
| 3 | End | — | Both idle; DB terminal |

Repeat with **video** (camera permission as required).

### B2 — Same-match duplicate create race

Two clients (or two tabs with caution) start `create_match_call` for the **same** match within seconds.

- **Expect:** One succeeds; the other **409** with `DUPLICATE_ACTIVE_CALL` (precheck or `db_unique` in logs). No stray Daily room without a `match_calls` row (loser deletes room).

### B3 — Token failure path (callee)

Simulate Daily token failure after answer transition (e.g. invalid `DAILY_API_KEY` on a throwaway env only).

- **Expect:** **503** + `TOKEN_ISSUE_FAILED`; callee UI shows connection message (not “missed” framing); row ended server-side after rollback attempt; logs show `answer_match_call_token_failed_after_transition`.

### B4 — Ringing timeout (callee)

Callee does not answer until **30s** (web) / same policy native.

- **Expect:** Miss path; terminal `missed`; UI clears. Within **~90s** cron may also expire if client missed (check `expire_stale_match_calls` log when `expired_count>0`).

### B5 — Decline

Callee declines.

- **Expect:** `declined` terminal; caller UI clears.

### B6 — Abnormal close / background

| Case | Action | Pass criteria |
|------|--------|----------------|
| Web | Close tab / navigate away during ring or active | Best-effort `match_call_transition` (keepalive or cleanup); dev: `[match_call_diag]` lines |
| Native | Send app to background during ring/active | Background RPC attempted; diag line `background_teardown_rpc` in dev |

### B7 — Eligibility gates

| Gate | How | Expect |
|------|-----|--------|
| Archived match | Archive thread / use archived fixture | 403 + `ARCHIVED_MATCH` |
| Blocked users | Block from settings | 403 + `USERS_BLOCKED` |
| Paused / suspended | Fixture or admin | 403 + `PARTICIPANT_PAUSED` / `PARTICIPANT_SUSPENDED` |

### B8 — Outbound ring restore (Wave 4 client fix)

As **caller**, start a ring, then **reload the app** (web refresh or native kill/reopen) before callee answers.

- **Expect:** “Calling” / ringing UI restores with correct partner; `[match_call_diag] reconcile_outbound_ring_restore` in dev. Realtime still drives transitions.

### B9 — Room cleanup (optional infra)

If `match-call-room-cleanup` cron runs: after a terminal call and **≥2 min** `ended_at`, logs show `match_call_room_cleanup_batch` with `daily_delete_attempts` ≥ 0 when candidates exist.

---

## C. “Done enough” for this wave

- [ ] B1 voice + video PASS on one platform pair you care about (e.g. web–web or web–native).
- [ ] B2 duplicate race shows correct code + log layer.
- [ ] B3 token failure path matches contract + UX.
- [ ] B8 outbound restore PASS if you ship client changes.

---

## D. References

- Lifecycle architecture: `docs/chat-calls-global-lifecycle-hardening.md`
- Launch smoke matrix: `docs/qa/chat-call-launch-smoke-matrix.md`
