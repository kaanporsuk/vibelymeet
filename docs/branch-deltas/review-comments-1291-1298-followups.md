# Review Comments 1291-1298 Follow-ups

Date: 2026-06-11

Scope: thread-aware GitHub review-comment follow-up for merged PRs #1291 through #1298.

No Copilot-authored review threads were present in this scan. Codex actionable threads were present on #1291, #1292, #1295, #1296, and #1297.

## Addressed Threads

- #1291 native partner-profile memoization: already addressed by the #1281-#1290 follow-up now on `main`; native caches and in-flight requests are keyed by viewer plus partner.
- #1292 fresh session-row truth: `fetchVideoDateSessionRow(..., { fresh: true })` now bypasses non-fresh in-flight mount reads as well as the 300ms recent cache, while default readers can still reuse an active fresh read.
- #1295 Sprint 7 ops health: forward migration `20260611141603_review_comments_1291_1298_followups.sql` restores real service-role-only health counts for stuck Ready Gate, stuck entry/date, pending survey recovery, safety reports/blocks, webhook DLQ, and orphan-room cleanup after the queued-residue purge accidentally returned zero-only healthy windows.
- #1296 startup snapshot entry timestamps: `videoDateStartSnapshotToDateEntryTruth` now falls back from legacy `handshake_started_at` / `handshake_grace_expires_at` payload keys and normalizes legacy `handshake` phase to canonical `entry`.
- #1297 validation after RPC flattening: Supabase validation packs now inspect `private_video_date` helpers for flattened transition internals instead of casting dropped public helper RPC names.

## Intentional Boundaries

- Queue/drain counters remain removed. The Sprint 7 health repair does not restore `silently_queued_count`, queue-drain misses, queue-drain failures, or any `drain_match_queue` dependency.
- The repair keeps the public RPC signature and service-role-only grants unchanged.
- This is review-comment hardening and cloud-alignment work, not Video Date product acceptance. The acceptance bar remains a fresh disposable two-user production run through persisted `date_feedback`.
