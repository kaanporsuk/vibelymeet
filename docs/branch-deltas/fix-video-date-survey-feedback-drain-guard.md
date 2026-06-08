# Video Date Survey Feedback Drain Guard

Date: 2026-06-09

Status: local implementation evidence only. This is not production-certified until merged, Supabase cloud is applied, deployed clients pick up the web/native changes, and a fresh disposable two-user production run completes through `date_feedback` for both users.

## Problem

`date_feedback` is the Video Date finish line. The reminder/certification layer now detects zero-feedback survey stalls, but queue drain could still be called while a survey screen or escaped lobby session was active. If a queued match became promotable before the actor submitted their own `date_feedback`, web or native could navigate to another Ready Gate and strand the mandatory verdict.

Direct authenticated `date_feedback` insert/update grants also left the mandatory verdict table writeable outside the canonical post-date verdict RPC path.

## Implementation

- Added migration `20260608211359_video_date_survey_feedback_drain_guard.sql`.
- Added service-only helper `video_date_actor_pending_feedback_gate_v1(event_id, actor_id)` that finds any same-event survey-eligible ended Video Date where the actor is a participant and has no `date_feedback` row, excluding blocked/reported pairs.
- Wrapped both public queue-drain RPC names:
  - `drain_match_queue_v2(event_id, idempotency_key)`
  - `drain_match_queue(event_id)`
- Both wrappers return structured `pending_post_date_feedback` with `found=false`, `queued=false`, `blocked=true`, `session_id`, `video_session_id`, and `next_surface.action='survey'` before delegating to Ready Gate promotion.
- Reworked web and native drain handling so pending feedback routes to `/date/:sessionId` or reopens the verdict step before any Ready Gate callback.
- Covered web survey, web event lobby, native survey, native event lobby, and native notification queued-session rescue.
- Hardened `date_feedback` by revoking direct authenticated insert/update/delete and dropping old own-row insert/update policies. Mandatory verdict writes remain backend-owned through `submit_post_date_verdict_v3` / `post-date-verdict`; optional details remain through `update_post_date_feedback_details`.

## Verification

Completed in this local pass:

- `npx tsx shared/matching/videoDateSurveyFeedbackDrainGuard.test.ts`
- `npm run test:video-date:red-flags`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`

Linked Supabase state:

- Remote is aligned through `20260608202749_video_date_missing_feedback_certification_closure.sql`.
- Local migration `20260608211359_video_date_survey_feedback_drain_guard.sql` is pending remotely.
- Linked dry-run planned only `20260608211359_video_date_survey_feedback_drain_guard.sql`.
- Linked DB lint exited 0 with only existing warning/notice-level legacy output, and linked error-level advisors returned `No issues found`.

Still required before calling the implementation shipped:

- `supabase db push --linked --yes` for the new migration.
- Web deployment and native/mobile client rollout so all production users receive the new routing behavior.
- Fresh disposable two-user production acceptance through both users persisting `date_feedback`.
