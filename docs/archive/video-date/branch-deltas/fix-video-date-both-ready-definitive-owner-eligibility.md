# Video Date Both Ready Definitive Owner And Eligibility Patch

Date: 2026-06-08

Status: local implementation and verification evidence only. This is not production-certified until the migration is applied to Supabase cloud and a fresh disposable two-user production run completes through `date_feedback` for both users.

## Problem

The audited `both_ready + canonical Daily room` boundary still had failure risk even after earlier routeable-entry and Daily-owner work:

- `both_ready` needed to be an explicit date-owner route decision in every shared public payload, including the interval where Daily provider room creation or token minting is pending or degraded.
- Ready Gate/date entry needed a final shared eligibility recheck before provider work so deleted, suspended, hidden, or underage participants could not progress to Daily.
- Notification and provider work around the second ready tap needed to remain fail-soft after the durable ready commit.
- Terminal survey truth needed to dominate stale Ready Gate/lobby recovery until `date_feedback` persists.
- Operators needed a direct service-only diagnostic for stuck `both_ready`, Daily-room, remote-seen, promotion, and survey-feedback drift.

## Implementation

- Added migration `20260608193915_video_date_both_ready_definitive_owner_eligibility.sql`.
- Preserved the existing public RPC names by renaming the current implementations to short service-only bases and recreating wrappers:
  - `video_date_ready_gate_actionability_v1(...)`
  - `video_session_mark_ready_v2(...)`
  - `get_video_date_start_snapshot_v1(...)`
  - `video_date_transition(...)`
- Added service-only `video_date_participant_eligibility_v1(...)` for deleted-user, suspension, hidden-profile, and age checks before Ready Gate/date provider entry.
- Added service-only `video_date_both_ready_route_payload_v1(...)` to return route/terminal truth consistently: `route_decision`, `next_surface`, `ready_gate_completed`, `ready_gate_terminal`, `date_terminal`, `date_owned`, `both_ready_date_owned`, and canonical Daily room metadata.
- Kept the second ready tap durable first. On `both_ready`, the wrapper adds fail-soft `date_starting` notifications that point to `/date/:sessionId`, but degraded notification/outbox work cannot poison the ready commit.
- Added service-only `video_date_both_ready_operator_diagnostics_v1(...)` for the five support categories: `both_ready_without_bilateral_join`, `daily_room_domain_mismatch`, `joined_without_bilateral_remote_seen`, `remote_seen_without_date_promotion`, and `survey_required_without_bilateral_feedback`.
- Added `shared/matching/bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts` and wired it into `test:video-date:red-flags` and `test:video-date-v4`.

## Web, Native, And Mobile Effect

No separate client source edit was needed for this pass because the existing web and native/mobile route hydrators, active-session recovery, Ready Gate handoff, and `daily-room` prepare-entry path already consume these public RPCs and shared route decisions. The migration makes that shared server truth unambiguous:

- non-ended `both_ready` is `/date/:sessionId` owned,
- Daily provider delay is retryable date-entry work, not Ready Gate/lobby ownership,
- terminal survey truth routes through `/date/:sessionId` until feedback persists,
- invalid participant eligibility stops before Daily provider room/token work.

## Verification

Completed locally:

- `npx tsx shared/matching/bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts`
- `npm run test:daily-room-contract`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`

Linked dry-run planned only `20260608193915_video_date_both_ready_definitive_owner_eligibility.sql`. Linked DB lint exited 0 with existing warning-only legacy noise. Linked DB advisors returned `No issues found`.

## Remaining Proof

This patch is source-level closure for the `both_ready + canonical Daily room` ownership and eligibility contract. It is not product-health proof.

Required acceptance remains:

1. Apply the migration to Supabase cloud.
2. Verify post-apply dry-run, DB lint/advisors, and live catalog markers for the new wrappers/helpers/grants.
3. Deploy any required web/native/mobile builds.
4. Run a fresh disposable two-user production flow through match -> Ready Gate -> `both_ready` -> same Daily room -> stable bilateral media/date -> date end -> PostDateSurvey -> persisted `date_feedback` for both users.
