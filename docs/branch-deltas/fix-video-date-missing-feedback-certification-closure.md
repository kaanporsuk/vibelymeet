# Video Date Missing Feedback Certification Closure

Date: 2026-06-08

Status: local implementation evidence only until the migration is applied to Supabase cloud, the Edge Function is deployed, and a fresh two-user production run completes through `date_feedback` for both users.

## Problem

The A-H handoff and Daily/date route can now succeed while the overall Video Date still fails at the real finish line: `date_feedback`. Existing `post_date_pending_verdicts` coverage handles one-sided verdicts after the first participant submits, but a zero-feedback survey-required session can sit in `in_survey` without either user being reminded through the same backend worker path.

That is not an A-H failure, but it can still cause an unsuccessful Vibe Video Date.

## Implementation

- Added migration `20260608202749_video_date_missing_feedback_certification_closure.sql`.
- Added service-owned table `post_date_zero_feedback_reminders`, keyed by `(session_id, missing_user_id)`, so both participants in a zero-feedback survey-required session can be tracked independently.
- Added service-only RPCs:
  - `sync_post_date_zero_feedback_reminders_v1(...)`
  - `claim_post_date_zero_feedback_reminders_v1(...)`
  - `mark_post_date_zero_feedback_reminders_stale_v1(...)`
  - `record_post_date_zero_feedback_reminder_result_v1(...)`
  - `video_date_missing_feedback_operator_diagnostics_v1(...)`
- The sync/claim path only targets ended, survey-eligible, `in_survey` participants with no `date_feedback` rows for the session, and excludes blocked/reported pairs.
- Updated `post-date-verdict-reminders` to claim zero-feedback reminders and send the same canonical `post_date_feedback_reminder` push/deep link to `/date/:sessionId`.
- Added invariant `stale_survey_pending_feedback_blocks_certification`; normal runs show it as a warning, and certification must use `npm run check:video-date:invariants -- --warn-as-error`.
- Validated `video_sessions_ready_gate_timestamp_consistency` in the migration after checking for historical violations.
- Added `shared/matching/videoDateMissingFeedbackCertificationClosure.test.ts` and wired it into `test:video-date:red-flags` and `test:video-date-v4`.

## Web, Native, And Mobile Effect

The reminder/deep-link path is backend-owned and uses the existing notification category and canonical `/date/:sessionId` route. Web, native, and mobile users are all routed back to the Date stack, where terminal survey truth already owns the surface until the user submits feedback.

## Remaining Proof

This does not certify Video Date by itself. Required proof remains:

1. Apply the migration to Supabase cloud.
2. Deploy `post-date-verdict-reminders`.
3. Run linked dry-run, DB lint/advisors, function verification, and catalog marker checks.
4. Run a fresh disposable two-user production flow through match, Ready Gate, Daily/date, PostDateSurvey, and persisted `date_feedback` for both users.

## Verification

Completed locally/read-only:

- `npx tsx shared/matching/videoDateMissingFeedbackCertificationClosure.test.ts`
- `deno check --no-lock supabase/functions/post-date-verdict-reminders/index.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`
- `npm run verify:video-date:functions -- --require-remote --json`
- `npm run check:video-date:invariants`
- `npm run check:video-date:invariants -- --warn-as-error`

`--warn-as-error` intentionally failed because linked Supabase still has stale session `3fabfd4e-523d-4593-bda5-ab6aa20f1005` missing both `date_feedback` rows. That is the desired certification blocker until both users complete feedback or the session is otherwise resolved.
