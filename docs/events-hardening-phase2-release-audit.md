# Events Hardening — Phase 2 Release Audit

Date: 2026-04-04

## Scope

Correctness packaging only for queued TTL canonicalization, deterministic backend cleanup, Ready Gate sync fallback resilience, and stricter Daily room token issuance.

## Files changed

- `supabase/migrations/20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql`
- `supabase/functions/daily-room/index.ts`
- `src/hooks/useReadyGate.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `_cursor_context/vibely_migration_manifest.md`
- `_cursor_context/vibely_schema_appendix.md`
- `_cursor_context/vibely_machine_readable_inventory.json`

## Migration added

- `20260404195500_phase2_queue_ttl_ready_gate_sync_daily_gate.sql`

## Queued TTL choice

- Canonical queued TTL: 10 minutes (`video_sessions.queued_expires_at`).

## Expiry cleanup behavior

- New RPC: `expire_stale_video_sessions()`
  - expires queued sessions whose `queued_expires_at` elapsed (fallback `started_at + 10 minutes`, then current time if null)
  - expires active ready-gate sessions whose `ready_gate_expires_at` elapsed
  - wakes snoozed sessions when `snooze_expires_at` elapsed
- Cleanup is called in active RPC paths (`drain_match_queue`, `ready_gate_transition`) and is also scheduled every minute via `pg_cron` (best-effort scheduling in environments where cron extension is unavailable).

## Ready Gate polling fallback

- Realtime remains primary.
- Web and native hooks now poll every 2 seconds while gate is active.
- Polling stops when terminal states are reached (`both_ready`, `forfeited`, `expired`).
- `expired` is treated as timeout-terminal in both hooks; native `isForfeited` now includes `expired` for lobby redirect parity.

## Daily token gate: before/after

Before:
- `canIssueVideoDateRoomToken` allowed if not ended and any of:
  - `handshake_started_at` present
  - state was handshake/date
  - phase was handshake/date
  - ready status was `both_ready`

After:
- `canIssueVideoDateRoomToken` allows only if not ended and either:
  - active handshake/date/rejoin path (`state in {handshake,date}` or `handshake_started_at` present), or
  - `ready_gate_status = both_ready` and `ready_gate_expires_at` exists and is still in the future.

## RPC behavior deltas

- `handle_swipe`: queued creation now stamps `queued_expires_at`; immediate-match foreground semantics remain strict from Phase 1.1.
- `drain_match_queue`: runs cleanup first and only promotes queued sessions that have not expired.
- `ready_gate_transition`: adds `sync` action for deterministic state reconciliation in polling fallback.
