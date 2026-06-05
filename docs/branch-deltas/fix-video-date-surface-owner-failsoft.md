# Video Date Surface Owner and RPC Fail-Soft

## Scope

This change closes the failure boundary found in production session `d7507b5c-7837-4310-a52c-ebd10c1ae535`: backend persistence and terminal survey eligibility held, but client surfaces churned between Ready Gate, lobby, and date while exposed lifecycle RPCs could still emit raw 500s.

## Changes

- Web route hydration now treats hydrated active `video` sessions as the single `/date/:sessionId` owner, including terminal `in_survey`.
- Web Event Lobby routes `in_survey` directly to the date stack and does not run Daily prepare for terminal survey recovery.
- Web date navigation can force terminal survey recovery past duplicate-navigation and manual-exit suppression, matching native behavior, while same-route navigation remains a no-op.
- Native route hydration, Event Lobby, Ready Gate, and date route recovery now mirror the same active video/survey ownership.
- Native date navigation can force terminal survey recovery past duplicate-navigation and manual-exit suppression.
- Supabase migration `20260605170249_video_date_surface_owner_outer_failsoft.sql` wraps:
  - `claim_video_date_surface`
  - `mark_video_date_daily_joined`
  - `mark_video_date_remote_seen`
  - `get_or_seed_video_session_vibe_questions`
- Supabase corrective migration `20260605174703_video_date_vibe_question_outer_base_name_repair.sql` normalizes the preserved vibe-question base helper to the short identifier `vd_vibe_q_outer_20260605170249_base` after the first cloud apply exposed a PostgreSQL identifier-truncation notice.

The wrappers preserve the existing base implementations and convert uncaught errors into retryable JSON payloads with SQLSTATE/message/server time instead of raw transport failures.

## Verification

- `npx tsx shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`
- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npm run typecheck`
- narrow `npx eslint` on touched TypeScript/TSX files
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- live catalog marker query for wrapper/base/helper invariants
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`

Cloud evidence:

- `20260605170249` and `20260605174703` are applied to linked project `schdyxcunwcvddlcshwd`.
- Final linked dry-run returned `Remote database is up to date`.
- Live marker query returned true for all four wrappers, all preserved base calls, the short vibe-question helper existing, and the truncated helper name being absent.
- Linked public-schema lint returned no error-level findings; remaining warnings/notices were pre-existing.

No web or native build was run in this implementation pass.

## Acceptance Boundary

This is not product-health proof. The manual acceptance run remains: match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up -> date end -> post-date survey opens and completes across the relevant web/native/mobile paths.
