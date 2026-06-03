# Video Date `date_timeout` ownership — decision log

**Status:** Decided (2026-06-03). Date-phase timeout is **legacy-cron-owned**, not v4-deadline-owned.

## Context

The in-call "Video Date" stage ends in one of these ways:

1. **Client countdown** — the active client reaches the server-derived phase deadline and
   calls `video_date_transition('end', 'date_timeout')` (or `video_session_date_timeout_v2`,
   behind `video_date.outbox_v2.date_timeout`, which itself calls the same transition).
2. **Reconnect-grace end** — `ended_reason = 'reconnect_grace_expired'`, driven either by a
   client calling `video_date_transition` after grace expiry
   (`supabase/migrations/20260409100000_video_date_reconnect_grace_queue_sync.sql`) or, when
   no client is present, by the cron reconciler overlay added in
   `supabase/migrations/20260603150000_video_date_reconnect_grace_expired_date_reconciler.sql`.
3. **Full-budget backstop** — the `expire_stale_video_sessions` / `expire_stale_video_date_phases_bounded`
   pg_cron reconciler ends any `state='date'` session at
   `date_started_at + 300 + date_extra_seconds + 60s` with `ended_reason = 'date_timeout'`.
   This correctly honors paid extensions and skips open reconnect-grace windows.

## The v4 deadline engine does NOT own `date_timeout`

`video_session_deadlines` + `finalize_video_session_deadline_v2`
(`supabase/migrations/20260521203000_video_date_phase2_transaction_engine.sql`) only finalize
**handshake** deadline kinds (`handshake_auto_promote`, `handshake_timeout`). Any other kind —
including `date_timeout` — is explicitly marked `unsupported_deadline_kind`, and no code path
enqueues a `date_timeout` row into `video_session_deadlines`. The snapshot core
(`get_video_date_snapshot_core`) only *reads* a `date_timeout` deadline row if one existed; it
never creates one.

## Decision

**Keep date-phase timeout owned by the legacy `expire_stale_*` cron reconciler. Do NOT add a
parallel v4 `date_timeout` deadline enqueuer/finalizer.**

Rationale:

- The legacy cron path is battle-tested, honors `date_extra_seconds` (extensions), and skips
  active reconnect-grace windows. It is the single source of truth for "the date's time is up."
- Adding a v4 `date_timeout` deadline in parallel would create **two independent terminators**
  for the same session and risk double-ending / racing UPDATEs on a live core flow.
- The v4 deadline engine's value (lease-protected, idempotent finalization) is specifically
  needed for the handshake auto-promote/timeout transitions it already owns; the date timeout is
  a simple time-based sweep that the cron reconciler handles well.

If the date timeout is ever migrated into the v4 engine, the legacy cron date-loop and the
reconnect-grace overlay must be retired in the **same** change to preserve a single terminator.
