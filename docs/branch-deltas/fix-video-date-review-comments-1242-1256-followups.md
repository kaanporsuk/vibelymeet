# Video Date Review Comments PR #1242-#1256 Follow-Ups

Date: 2026-06-09

Status: implementation branch with local validation complete and linked Supabase dry-run clean. Fresh two-user production proof through both users persisting `date_feedback` is still required.

## Scope

The GitHub review-comments workflow inspected the last 15 PRs, `#1242` through `#1256`, for Copilot and Codex review comments. No actionable Copilot-authored comments were found. The current actionable Codex comments were addressed in source, docs, and a forward Supabase migration.

## Implementation

- Added migration `20260608224048_review_comments_1242_1256_followups.sql`.
- Scoped zero-feedback reminders to the active survey room by requiring `event_registrations.current_room_id = video_sessions.id`.
- Prevented retryable participant-eligibility failures from terminalizing Ready Gate in `video_date_ready_gate_actionability_v1(...)`.
- Tightened `mark_video_date_remote_seen(...)` so remote media evidence requires both current Daily provider proof and current server-recorded `client_daily_alive` owner/call heartbeat proof.
- Sanitized mark-ready safety-check failures by stripping nested `auxiliary_errors` and raw diagnostic fields before client route payload enrichment.
- Applied certification exceptions to the `survey_pending_feedback_held_in_survey` invariant warning, not only the stale-certification warning.
- Guarded web/native PostDateSurvey queue-drain callbacks so stale same-session `pending_post_date_feedback` no-ops after verdict submission, confirmation, partner-wait, or finish-in-flight state.
- Kept native nonretryable `prepare_date_entry` failures on the failure/recovery surface instead of marking date-route ownership.
- Stopped/transferred the old web Daily alive heartbeat when a parked same-session Daily singleton is consumed.
- Repaired `20260608171837_video_date_active_owner_terminal_truth.sql` with a syntax-only `END;` fix so repository migration replay is not left broken by the earlier source typo.

## Verification

Verification completed during implementation:

- `jq empty package.json`
- `npx tsx shared/matching/reviewComments1242_1256Followups.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`

Publish verification still required before closing the branch:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- Post-apply linked dry-run, migration list alignment, DB lint, DB advisors, and live catalog markers for the new/replaced RPC bodies.

## Proof Boundary

This is source/schema hardening from review comments. It is not Video Date acceptance proof. Do not call the feature fixed until a fresh disposable two-user production run completes match, Ready Gate, Daily/date, terminal survey, and both users' `date_feedback` rows.
