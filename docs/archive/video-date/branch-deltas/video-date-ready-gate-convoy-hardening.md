# Branch Delta — fix/video-date-ready-gate-convoy-hardening

Incident: 2026-06-10 two-user production test, event `3f303f62-6c12-4f3e-a6c7-6cc338413db0`, session `927942c2-0704-4e42-a95c-c3fc56accc02`. Both users tapped ready; readiness never landed server-side; ready gate expired (`ended_reason = ready_gate_expired`). Console showed raw HTTP 500s from `video_session_mark_ready_v2`, `ready_gate_transition`, `get_video_date_start_snapshot_v1`, `get_profile_for_viewer`.

Full forensics and evidence live in `docs/video-date-success-command-center.md` (entry "2026-06-10 Ready Gate Lock-Convoy Incident"). Summary: SQLSTATE 57014 statement timeouts (8s `authenticated` ceiling) caused by a lock convoy on the single `video_sessions` row, on chronically CPU-starved default Micro compute. 57014 cannot be caught by `EXCEPTION WHEN OTHERS`, so fail-soft wrappers cannot absorb it.

## Changes

| File | Change |
| --- | --- |
| `supabase/migrations/20260610201512_video_date_ready_gate_convoy_hardening.sql` | Corrective redefinition of `record_video_date_ready_gate_entered_v1` (entry-proof telemetry/TTL stamp): `SELECT ... FOR UPDATE NOWAIT` + `lock_not_available` (55P03) handler returning retryable `READY_GATE_BUSY` JSON instead of queueing behind critical ready-path locks. Plus `ALTER ROLE authenticated SET statement_timeout = '15s'` (was 8s) and `NOTIFY pgrst, 'reload config'`. |
| `shared/matching/readyGateEntryProofContracts.test.ts` | New contract test pinning the NOWAIT/READY_GATE_BUSY shape, preserved authority/actionability guards, and the 15s ceiling. |
| `docs/video-date-success-command-center.md` | Incident entry with full root-cause chain, rejected hypotheses, verification evidence, and open risk. |

No client code changes: all `recordReadyGateEntered` call sites (web `ReadyGateOverlay`, native `ready/[id]` + `ReadyGateOverlay`) are fire-and-forget with analytics-only failure handling, so `READY_GATE_BUSY` is absorbed exactly like today's failures. Function signature, grants, and return contract are unchanged; no Supabase type regen needed.

## Config change documented per rebuild discipline

- `authenticated` role `statement_timeout`: `8s` -> `15s`. Rationale: a mark_ready that survives a 10s transient convoy beats one cancelled at 8s whose retry re-queues at the back of the lock queue; inert on a healthy instance where these calls take milliseconds. Revert path: `ALTER ROLE authenticated SET statement_timeout = '8s'; NOTIFY pgrst, 'reload config';`.

## Cloud state

- Migration `20260610201512` applied to `schdyxcunwcvddlcshwd` on 2026-06-10 (dry-run clean before push).
- Live markers verified: function def contains `FOR UPDATE NOWAIT`, `READY_GATE_BUSY`, `lock_not_available`; `pg_roles.rolconfig` for `authenticated` = `{statement_timeout=15s}`; no-auth probe returns `AUTH_REQUIRED`.

## Known follow-ups (not in this branch)

- Compute upgrade (root capacity fix) deferred by operator decision 2026-06-10; revisit before larger events.
- Pre-existing test failure on `main`: `videoDateSprint5PostDateSurveyContracts.test.ts` "safety reports force a pass before any match or notification path" asserts the removed `submit_post_date_verdict_v2` path (stale after PR #1286 v3-only).
- Realtime `postgres_changes` WAL processing is the top cumulative DB consumer (~5,800s/15d); candidate for broadcast-only migration audit.
