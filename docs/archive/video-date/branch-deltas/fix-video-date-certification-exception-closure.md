# Video Date Certification Exception Closure

Date: 2026-06-09  
Branch: `fix-video-date-certification-exception-closure`

## Status

Source and linked Supabase cloud implementation evidence. Product health is still not proven until a fresh disposable two-user production run completes through persisted `date_feedback` for both users.

## Problem

`date_feedback` is the Video Date finish line. The missing-feedback diagnostics correctly flagged stale survey-required participants with no feedback, but a known historical failed run can continue blocking release certification after operator review.

The unsafe workaround would be to insert synthetic `date_feedback`. This patch does not do that.

## Implementation

- Added migration `20260608215911_video_date_certification_exception_closure.sql`.
- Added service-owned table `video_date_certification_feedback_exceptions`.
- Added service-only operator RPCs:
  - `upsert_video_date_certification_feedback_exception_v1(...)`
  - `revoke_video_date_certification_feedback_exception_v1(...)`
  - `video_date_certification_feedback_exception_active_v1(...)`
- Replaced `video_date_missing_feedback_operator_diagnostics_v1(...)` without changing its return shape. It still returns missing-feedback rows, but `release_blocker` is false when an active exception exists.
- Updated `docs/sql/video-date-invariants.sql` so `stale_survey_pending_feedback_blocks_certification` excludes only active service-owned exceptions.
- Added contract coverage in `shared/matching/videoDateCertificationExceptionClosure.test.ts` and wired it into:
  - `npm run test:video-date:red-flags`
  - `npm run test:video-date-v4`

## Ownership Boundary

- `date_feedback` remains the only product completion truth.
- `event_registrations.queue_status='in_survey'` remains sticky for users without feedback.
- Queue drain and client routing do not read certification exceptions.
- Web, native, and mobile users still route back to `/date/:sessionId` or the native date route when feedback is pending.
- Exceptions are only an operator certification control for known historical failed rows.

## Verification

Completed locally:

- `npx tsx shared/matching/videoDateCertificationExceptionClosure.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`

Completed against linked Supabase:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`
- Live catalog marker query for the migration row, table, RLS/grants, RPC grants, diagnostic body, and no `date_feedback` insert path.
- `npm run check:video-date:invariants -- --warn-as-error`
- Current linked missing-feedback diagnostics return zero rows, so no certification exception row was inserted.

Still required before closure:

- Fresh disposable two-user production acceptance through both users persisting `date_feedback`.
