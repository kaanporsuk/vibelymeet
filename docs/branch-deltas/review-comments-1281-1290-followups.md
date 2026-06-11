# Review Comments 1281-1290 Follow-ups

Date: 2026-06-11
Branch: `codex/review-comments-1281-1290-followups`

## Scope

Thread-aware GitHub review scan covered PRs #1281 through #1290. No Copilot-authored review comments were present. Codex actionable comments were found on #1281, #1283, #1285, #1288, and #1290; PRs #1282, #1284, #1286, #1287, and #1289 had no actionable inline review threads or reported no major issues.

## Implemented

- #1283: `ReadyGateOverlay` now treats terminal truth fetched after a `prepare_date_entry` client exception as non-retryable and closes the stale Ready Gate instead of leaving a retry state open.
- #1285: new forward migration `20260611135321_review_comments_1281_1290_followups.sql` validates the entry RPC wrappers exist and sends `NOTIFY pgrst, 'reload schema'` for warm PostgREST deployments.
- #1288: operator dashboard docs retire the Survey -> Next Ready Gate queue-drain funnel instead of pointing operators at removed `useMatchQueue` / `enableSurveyPhaseDrain` behavior.
- #1290: web and native Video Date partner-profile memoization keys cache and in-flight requests by viewer plus partner, preserving `get_profile_for_viewer` authorization boundaries in shared browser/app runtimes.
- #1290: launch-latency batch flushing now falls back to single-checkpoint RPCs when the batch RPC returns fail-soft success transport with `ok: false` or `success: false`.

## Superseded Or Verified

- #1281 queued fallback comments are superseded by the later queue-source removal and physical queued-state purge: active swipe source no longer returns `match_queued`, `queued_expires_at` is dropped, and queue-drain/fairness surfaces remain removed. This follow-up intentionally does not restore longer queued-style TTL behavior.
- #1282, #1284, #1286, #1287, and #1289 had no actionable Copilot/Codex inline review work in the thread-aware scan.

## Proof Boundary

This is review-comment hardening and cloud-alignment work. It is not Video Date product acceptance. The acceptance bar remains a fresh disposable two-user production run through match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and persisted `date_feedback` for both users.
