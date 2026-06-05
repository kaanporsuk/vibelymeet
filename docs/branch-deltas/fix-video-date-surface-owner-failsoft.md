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

## 2026-06-05 Lifecycle False-Away Follow-Up

Latest failed session `f3d1bd2a-5c37-43bb-9a9a-ec3c78fe7442` for event `9ac64807-7fe3-41b1-86db-49a3d4053b56` showed the previous route/surface fail-soft work was not sufficient. The session reached Ready Gate `both_ready`, Daily room creation, `date_started_at`, bilateral Daily joins, and remote-media evidence, but a client lifecycle `mark_reconnect_self_away` with `reason=web_beforeunload` opened reconnect grace while the date was still visibly active. The grace later expired as `reconnect_grace_expired`, sending both users to survey instead of preserving the live date.

New migration `20260605200729_video_date_beforeunload_active_presence_repair.sql` wraps `video_date_transition`, `mark_video_date_remote_seen`, and `expire_video_date_reconnect_graces` so browser/native lifecycle away signals are not terminal authority when fresh joined, remote-media, or active `video_date` surface evidence exists. Web now treats `beforeunload`, `pagehide`, `visibilitychange`, and `freeze` as soft telemetry while Daily is active or starting, and web/native surface claims now use a 30-second server TTL to survive launch route churn.

Follow-up migration `20260605203904_video_date_remote_seen_grace_payload_preserve.sql` preserves a base `reconnect_grace_cleared=true` response from the existing remote-seen stack when the outer lifecycle wrapper itself has no additional rows to clear.

Corrective migration `20260605211924_video_date_surface_claim_expiry_current_guard.sql` addresses review feedback on reconnect-expiry evidence: `expire_video_date_reconnect_graces()` now requires a `video_date` surface claim to still be unreleased and unexpired at `v_now`, not only valid near the lifecycle-away timestamp, before surface evidence can suppress terminal reconnect expiry.

Verification for this follow-up:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck:core`
- narrow `npx eslint` on touched web/native/test files
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- live catalog marker query for lifecycle wrapper invariants
- live catalog marker query for the current surface-claim expiry guard
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`

Cloud evidence:

- `20260605200729`, `20260605203904`, and `20260605211924` are applied to linked project `schdyxcunwcvddlcshwd`.
- Final linked dry-run returned `Remote database is up to date`.
- Live marker query returned true for migration application, `web_beforeunload` transition handling, base delegation, remote-seen base grace payload preservation, remote-seen outer/base grace OR semantics, reconnect-expiry surface/recent-media checks, and `c.expires_at >= v_now` current-surface evidence enforcement.
- Linked public-schema lint returned no error-level findings; remaining warnings/notices were pre-existing.

No web or native build should be inferred from this branch delta; use focused contracts, type/lint checks, and Supabase dry-run/apply verification, then run the manual two-user acceptance flow separately.

Session lesson:

- Lifecycle events are lossy transport hints, not terminal product truth, once Daily joining/joined, recent bilateral remote media, or active surface claims exist.
- The final backend guard must run at both write time and expiry time: suppress false self-away when possible, then re-check latest joined/remote/surface evidence before any reconnect grace can end the date.
- Web and native/mobile need the same evidence window; keeping surface claims at a shared 30-second server TTL avoids one platform silently losing active-surface proof sooner than the other.
- At expiry time, surface proof must be current, not historical. A stale closed-tab claim that happened to cover the away timestamp cannot keep a genuinely disconnected session alive.
