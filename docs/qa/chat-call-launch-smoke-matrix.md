# Chat & match-call launch — go / no-go checklist (2026-04)

**Purpose:** Final manual gate before merge/release. Mark each cell **PASS** or **FAIL** with initials + date. Any **FAIL** in a launch-critical row blocks merge until triaged.

**Architect baseline:** Image / Voice / Vibe Clip = **Green**; Voice / Video call = **Amber / near-Green** (platform + infra constraints called out below).

---

## Preconditions (block release if missing)

- [ ] Two test accounts, **active match**, both with **push enabled** and `notify_messages` **on** (match_call maps here).
- [ ] **Deployed:** `send-message`, `daily-room`, `send-notification` (with `match_call` support), `match-call-room-cleanup` (optional cron path per rollout notes).
- [ ] **OneSignal:** Web + iOS/Android player IDs present for both users on the target environment.
- [ ] **Daily:** `DAILY_API_KEY` / domain valid for the project under test.

---

## 1. Media — go / no-go matrix

**Pass criteria (each cell):** Send succeeds; partner receives; **no duplicate** server message after refresh; retry/outbox states look truthful.

| Feature | web → web | web → native | native → web | native → native |
|---------|------------|--------------|--------------|-----------------|
| **Image** | [ ] | [ ] | [ ] | [ ] |
| **Voice** | [ ] | [ ] | [ ] | [ ] |
| **Vibe clip** | [ ] | [ ] | [ ] | [ ] |

**Extra (web outbox):** [ ] Offline or flaky network: message queues / reconnect send; no duplicate after success.

---

## 2. Match calls — go / no-go matrix

**Pass criteria (each cell):** Caller rings; callee gets **in-app** ringing when foregrounded; **push** fires when backgrounded (where OS allows); answer / decline / missed / end behave; no stuck `ringing` forever (client + DB).

| Call type | web → web | web → native | native → web | native → native |
|-----------|------------|--------------|--------------|-----------------|
| **Voice** | [ ] | [ ] | [ ] | [ ] |
| **Video** | [ ] | [ ] | [ ] | [ ] |

**Scenarios (check all that apply to your environment):**

- [ ] Callee **app open**, not on thread: incoming UI + optional push.
- [ ] Callee **backgrounded**: push (`match_call`) → open → thread reconciles to ringing/active.
- [ ] **Cold start** from tap on push: lands in chat; call state consistent.
- [ ] **Decline** / **miss** / **caller hangup before answer**: terminal state; no zombie UI.
- [ ] **Remote leave** during active call: other side ends cleanly.
- [ ] **Web incoming 30s timeout:** fires **once** (no repeated `mark_missed`); countdown does not reset on unrelated chat re-renders.
- [ ] **Callee answer failure** (revoked token / network): row moves to `missed` (not stuck `ringing`); local overlay clears.
- [ ] **Tab close / refresh mid-call:** best-effort terminal transition (web `pagehide`/`beforeunload` + cleanup; native background + unmount).

---

## 3. Infra & cleanup (not blocking media launch; track for ops)

- [ ] **Terminal call + ~2 min:** Daily room eventually deleted (client path and/or `match-call-room-cleanup` cron, if enabled).
- [ ] **Logs:** `send-notification` / OneSignal no systematic failures for `match_call` on staging.

---

## 4. Explicit non-go conditions

Stop and file an issue if you see any of:

- Duplicate published rows for the same `client_request_id` after a single user action.
- Callee never notified when device has push on and match not muted (verify OS + OneSignal first).
- Call stuck **ringing** in DB past **~90s** without transition to missed (client + `expire_stale_match_calls`).

---

## 5. Sign-off

| Role | Name | Date | GO / NO-GO |
|------|------|------|------------|
| QA / Founder | | | |
| Notes | | | |

---

## Reference (short)

- Full Playwright E2E across web + two native builds is **out of scope** for this checklist; this is the **canonical manual** gate.
- **Acceptable imperfections for launch:** browser/OS may not “ring” like a phone; PWA/iOS web push varies; cron cleanup requires pg_cron + pg_net + vault when using scheduled HTTP.
