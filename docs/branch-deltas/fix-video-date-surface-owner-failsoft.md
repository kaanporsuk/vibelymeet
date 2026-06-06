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

## 2026-06-06 Latest Run Audit Addendum

Latest failed session `4082fe36-8480-4d30-9a1d-1de227b855e3` for event `cdb38cb8-acfb-4fa1-b732-10903eccc3b0` shows the lifecycle false-away and current-surface expiry repairs were necessary but not sufficient for product success. Live Git was clean at `9fc82b5f9867de0ab9905e64804c3d226a0f065f`, and Supabase was aligned through migration `20260605222458` with a clean linked dry-run before this audit.

What worked:

- Ready Gate reached `both_ready`.
- Canonical Daily room `date-4082fe3684804d309a1d1de227b855e3` was verified.
- Both users joined Daily and produced bilateral remote-media evidence.
- `confirmed_encounter_promoted_to_date` fired and `date_started_at` was set to `2026-06-05T22:14:53.753531Z`.
- The final terminal row preserved canonical Daily metadata, provider-delete markers, and sticky `in_survey` registrations.

What failed:

- The active web owner churned across `/date`, `/ready`, and lobby instead of holding one date/survey owner.
- Observability recorded 18 `date_route_entered`, 18 `video_stage_shell_visible`, 6 Daily starts, 26 cleanup rows, and 7 `external_call_busy` retries.
- Daily provider webhooks show repeated leave/rejoin sessions and ended with both participants leaving by `2026-06-05T22:16:53.812Z`.
- Current surface claims expired at `22:17:06Z` / `22:17:07Z`, so reconnect expiry at `22:18:00.839509Z` was allowed to end as `reconnect_grace_expired`, `survey_required=true`.
- No `date_feedback` rows were created, so the acceptance flow still failed.

Additional gaps exposed:

- `record_video_date_client_stuck_observability` still drops the client payload fields needed to prove same-session Daily continuity and singleton parking, including `same_session_daily_continuity_latched`, `will_park_singleton`, and `parked_singleton`.
- `video_date_transition` is not a true outermost fail-soft wrapper; it can still surface raw 500s when delegated base logic throws.
- Reconnect expiry logged `latest_away_reason=null` and cleared final away fields, making the grace trigger non-durable.
- `video_date_surface_claims` is current-state only and cannot reconstruct surface-owner history or duplicate-overlay cause.

Next implementation direction:

- Enforce one route-level date/survey owner after Ready Gate handoff or `date_started_at`.
- Keep the Daily call object under that owner so React unmount/remount churn cannot create provider leave/rejoin storms.
- Make terminal `in_survey` cancel Daily/surface/reconnect/queue work and render a submit-resilient survey from any active surface.
- Extend backend fail-soft coverage to `video_date_transition`, queue hint, and queue drain RPCs.
- Add durable append-only diagnostics for surface ownership, Daily parking/reuse, and away/grace triggers.

## 2026-06-06 Single-Owner Runtime Hardening Implementation

The latest implementation targets the `4082fe36-8480-4d30-9a1d-1de227b855e3` owner-churn failure without claiming manual product success.

Code changes:

- Web `SessionRouteHydration` marks hydrated active video sessions as route-owned immediately and forces same-session terminal survey recovery on `/date/:sessionId`.
- Web `EventLobby` routes active `in_handshake` / `in_date` video sessions directly to `/date/:sessionId` instead of rerunning Daily prepare from the lobby.
- Web `VideoDate` marks the date route owned on mount and keeps terminal survey recovery as a hard owner.
- Native/mobile `NativeSessionRouteHydration`, event lobby, and `/date/[id]` mirror the same route ownership. Native active-date handoffs skip prepare/restart, and terminal survey recovery clears local joining/reconnect state before showing survey.
- Supabase migration `20260605232304_video_date_single_owner_runtime_hardening.sql` adds service-only append-only `video_date_surface_claim_events`, wraps `video_date_transition`, `get_video_date_queue_hint_v1`, `drain_match_queue_v2`, and `claim_video_date_surface` with outermost retryable JSON fail-soft shells, and widens `record_video_date_client_stuck_observability` so production rows preserve route ownership, same-session Daily continuity, singleton parking, and truth-refresh fields.

Deep audit follow-up:

- Native/mobile terminal survey recovery now holds an explicit `terminalSurveyHardStopRef` after terminal survey truth opens. This prevents the render-time `phaseRef.current = phase` assignment from temporarily un-ending the route before hook/server phase catches up.
- The same hard-stop disables date-entry eligibility and keeps route ownership refreshing while the survey is visible or the hard-stop is active, so terminal survey recovery cannot fall back into Ready Gate/lobby ownership churn.
- Contracts now cover the hard-stop ref, phase pin, ended-ref pin, and survey-owner route refresh gate.
- Second-pass CTO audit added native/mobile `forceSurvey` parity with web. Native event-lobby navigation now treats `forceSurvey` as the explicit survey-intent bypass plus survey-only prepare suppression, and all native pending-survey route paths pass it: active-session hydration, registration realtime/refetch, video-session update/insert, and Ready Gate canonical survey recovery.
- Contracts now also assert the native `forceSurvey` option, `forceNavigation = force || forceSurvey`, `skipPrepare = skipPrepare || forceSurvey`, and `forceSurvey: true` on every native survey-intent call site.
- Third-pass CTO audit found a native notification fallback gap: snapshot `go_survey` links were handled, but legacy/fallback truth recovery from `NotificationDeepLinkHandler` did not handle `adviseVideoSessionTruthRecovery()` returning `go_survey`.
- Native notification `/date/:sessionId` reconciliation now marks route ownership for snapshot `go_date`/`go_survey`, marks route ownership for fallback `go_date`, and routes fallback `go_survey` to `/date/:sessionId` with `pending_survey_terminal_encounter` diagnostics so the Date stack owns survey recovery.
- Phase 5 contracts now lock the notification-deep-link route-ownership and fallback `go_survey` behavior.

Verification:

- `npx tsx --test shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsx shared/matching/videoDatePhase5TimelineContracts.test.ts`
- `npx tsx --test shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts shared/matching/videoDatePhase5TimelineContracts.test.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/observability/videoDateClientStuckObservability.test.ts`
- `npm run test:video-date-v4` (passed with only the expected env-gated runtime RLS skips)
- `npm run typecheck`
- `npm run lint`
- `npm run typecheck:core`
- `cd apps/mobile && npm run typecheck`
- `npx tsc --noEmit -p tsconfig.app.json`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- live marker queries for the four fail-soft wrappers, `video_date_surface_claim_events` RLS, and widened stuck-observability fields
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- second-pass `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --type all --level error --fail-on error`

Cloud evidence:

- `20260605232304` is applied to linked project `schdyxcunwcvddlcshwd`.
- Final linked dry-run returned `Remote database is up to date`.
- Live marker query returned true for all four public RPC wrappers calling their new single-owner base helpers.
- Public fail-soft wrappers remain executable by `authenticated`; the renamed base helpers are not executable by `anon` or `authenticated` and remain executable by `service_role`.
- `public.video_date_surface_claim_events` exists with RLS enabled and service-role-only grants.
- `record_video_date_client_stuck_observability` now contains `same_session_daily_continuity_latched`, `parked_singleton`, and `truth_refresh_attempt` markers.
- Fresh post-audit linked migration list/dry-run stayed aligned through `20260605232304`.
- Linked public-schema lint returned no error-level findings; remaining warnings/notices were pre-existing.
- Linked advisors returned no error-level findings; warning-level advisor debt remains broad pre-existing schema debt outside this Video Date fix.
- No web or native build was run during the implementation verification pass. A later documentation-only search command accidentally invoked the web build through shell backticks; no native build was run, no generated build artifacts appeared in `git status --short`, and this accidental build is not acceptance proof.
- Second-pass Supabase verification on 2026-06-06 stayed aligned through `20260605232304`: linked migration list matched local/remote, linked dry-run returned `Remote database is up to date`, linked public-schema lint had no error-level findings, and error-level advisors returned `No issues found`.
- Third-pass Supabase verification on 2026-06-06 stayed aligned through `20260605232304`: linked migration list matched local/remote, linked dry-run returned `Remote database is up to date`, linked public-schema lint had no error-level findings, and error-level advisors returned `No issues found`.

Acceptance boundary:

- This is still not product-health proof. The next required proof is a fresh disposable two-user production run through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> post-date survey completion, plus short Daily leave/rejoin under 12s and real prolonged absence terminalization.
