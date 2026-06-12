# Fix Video Date Stable Bilateral Media Gate

Date: 2026-06-09

## Concern

The latest two-user production run reached the date route but did not become a successful Video Date. The observed flow included `Opening your date`, repeated/pending date-route RPCs, a `mark_video_date_daily_joined` 500, route churn back toward Ready Gate/lobby, and no proven stable bilateral provider-backed media/date.

The failure exposed one remaining ownership split:

- The date route must own the session as soon as access to `/date/:sessionId` is allowed, before Daily connection state exists.
- Daily start must stay single-flight across full web route remounts, not only within one hook instance.
- Native/mobile must preserve an active Daily handoff during pre-date route churn before `dateEstablishedRef` is true.
- Backend promotion must not turn one-sided remote-seen/provider overlap into a real date or survey-eligible encounter.

## Implementation

- Updated web `/date/:sessionId` route ownership in `src/pages/VideoDate.tsx` to mark ownership from allowed route access instead of waiting for `isConnecting`, `isConnected`, `callStarted`, `localInDailyRoom`, or Daily meeting state.
- Added cancellation handling so stale async `startCall(...)` results are ignored after the date route effect cleans up.
- Added a module-scope web Daily start gate in `src/hooks/useVideoCall.ts` keyed by session/user. Full remounts now join the same in-flight start promise; internal retries pass `skipStartGate: true` to avoid self-deadlock.
- Second-pass audit tightened web Daily singleton eligibility so allowed-route preservation is still blocked during feedback, terminal survey recovery, and ended states.
- Devil's-advocate audit found that web remote-render validation could prove a frame with `requestVideoFrameCallback` but only update local playback state. The validator now stamps canonical `mark_video_date_remote_seen(...)` through `markRemoteFirstFrameRendered(...)`, using `request_video_frame_callback` or backend-accepted `first_remote_frame` evidence.
- Updated native/mobile `/date/[id]` ownership in `apps/mobile/app/date/[id].tsx` so eligible date entry marks route ownership pre-join.
- Updated native/mobile active handoff cleanup to preserve live Daily calls before date establishment unless terminal, feedback, `left-meeting`, or error truth is present.
- Added migration `20260609014410_video_date_stable_bilateral_media_gate.sql`.
- Added corrective audit migration `20260609022729_video_date_auto_promote_stable_bilateral_media_gate.sql`.
- Added devil's-advocate corrective migration `20260609031421_video_date_stable_bilateral_media_one_sided_guard.sql`.
- Added `video_date_stable_bilateral_media_gate_v1(...)`.
- Wrapped `video_date_promote_provider_overlap_v1(...)`, `video_date_promote_confirmed_encounter_v1(...)`, and `video_session_handshake_auto_promote_v2(...)` so date promotion requires stable bilateral media.
- Deep audit found the first auto-promote wrapper only tagged `stable_bilateral_media_gate_checked` after delegating to the preserved base. The corrective migration now checks lifecycle eligibility and stable bilateral media before calling `vd_auto_promote_stable_media_base(...)`.
- Second devil's-advocate audit found the first stable media gate could still pass the owner-heartbeat branch when exactly one participant had render-bound remote-seen proof. The one-sided guard migration now makes fresh bilateral owner heartbeat promotion require `AND NOT v_one_remote_seen`, so one-sided render asymmetry waits for bilateral remote-seen instead of becoming a date.
- Preserved the previous promoter implementations behind short base helper names:
  - `vd_provider_overlap_stable_media_base`
  - `vd_promote_ce_stable_media_base`
  - `vd_auto_promote_stable_media_base`
- Added `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`.
- Wired the new contract into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Updated stale contracts that still expected date-route ownership to wait for Daily state.
- Regenerated `src/integrations/supabase/types.ts` from the linked public schema so the new stable gate and short base helper RPCs are typed.

## Verification

Local verification passed:

- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date:red-flags`
- `git diff --check`
- `jq empty package.json`
- `npm run launch:preflight`

Linked Supabase verification passed:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`

Post-apply dry-run returned `Remote database is up to date.` Error-level advisors returned `No issues found.` Public-schema lint exited 0 with only existing warning/notice-level legacy output. After the second devil's-advocate correction, linked Supabase is aligned through `20260609031421_video_date_stable_bilateral_media_one_sided_guard.sql`.

Live catalog verification checked that:

- `video_date_stable_bilateral_media_gate_v1(...)` exists and contains the one-sided remote-seen block.
- Provider-overlap and confirmed-encounter promotion wrappers call `video_date_stable_bilateral_media_gate_v1(p_session_id)`.
- Promotion wrappers emit `promotion_blocked_by_stable_bilateral_media`.
- Provider promotion emits `stable_bilateral_media_promotion_waiting`.
- Confirmed-encounter promotion emits `confirmed_encounter_stable_bilateral_media_waiting`.
- Auto-promote checks lifecycle eligibility, calls `video_date_stable_bilateral_media_gate_v1(p_session_id)`, emits `stable_bilateral_media_auto_promotion_waiting`, returns `promotion_blocked_by_stable_bilateral_media`, and calls `vd_auto_promote_stable_media_base(...)` only after the gate.
- Stable-media helper/base RPC grants remain service-role only; authenticated clients retain only the intended public wrapper access.
- Live catalog verification also checked that `mark_video_date_remote_seen(...)` accepts `request_video_frame_callback` and still requires render evidence before delegating.
- Live catalog verification checked that the deployed `video_date_stable_bilateral_media_gate_v1(...)` heartbeat branch contains `AND NOT v_one_remote_seen`, with the service-only function comment updated accordingly.

## 2026-06-09 Late Hardening: Definitive Active Media Ownership

The follow-up implementation adds the final ownership and persistence hardening required by the failed `ec02c212-3cee-4af3-9d4d-dc0e9b846188` run analysis.

Additional implementation:

- Added migration `20260609035833_video_date_definitive_active_media_ownership.sql`.
- Added persistent stable-media certification columns on `video_sessions`: `stable_bilateral_media_at`, `stable_bilateral_media_source`, and `stable_bilateral_media_detail`.
- Added service helper `video_date_active_surface_claims_v1(...)` so the stable gate requires both participants to hold current unexpired `video_date` surface claims.
- Added service helper `video_date_mark_stable_bilateral_media_v1(...)` so the first valid stable-media promotion persists a durable certification marker.
- Replaced `video_date_stable_bilateral_media_gate_v1(...)` again so promotion requires active bilateral surface ownership plus heartbeat-backed stable copresence or explicit bilateral render-bound remote-seen proof. Existing `state = 'date'` is accepted only when stable certification already exists.
- Updated provider-overlap, confirmed-encounter, and auto-promote wrappers to mark stable certification before delegating to the preserved base implementations.
- Wrapped `video_date_reconcile_provider_absence_v1(...)` so an uncertified pre-stable provider absence becomes retryable `pre_stable_media_failed` with `survey_required = false`, instead of sending users to survey as if a real date happened.
- Added `pre_stable_media_failed` to the survey-ineligible route-decision ended reasons.
- Added bounded web and native/mobile Daily create retries for `external_call_busy` and `cleanup_pending`.
- Added a same-tab web server surface-claim bridge for hot `/date` remounts.
- Late audit tightened the web Daily start gate: a remounted observer now adopts the current hook owner after awaiting the shared start promise instead of returning success while the current hook has no call/listener ownership.
- Late audit tightened the web surface bridge: it now keeps claims alive only for hot remount/reload recovery and releases the server claim for terminal survey, explicit end, manual exit, or ended route cleanup.
- Devil's-advocate audit found the bridge/release decision ref could be stale during the passive cleanup triggered by `leaseActive` flipping false. The hook now layout-syncs the callback before passive cleanup so terminal survey and explicit-exit transitions release instead of bridging with previous-render truth.
- Widened native/mobile active surface ownership through eligible entry, handshake/date, joining, connecting, and local Daily room presence.
- Added web/native route ownership diagnostics with `routeMountId` and `routeOwnerId`.
- Added web/native `PostDateSurvey` confirmation that the current actor's `date_feedback` row exists and matches before advancing after verdict submission.
- Updated generated Supabase types and the stable bilateral media contract coverage for the new helpers, stable columns, diagnostics, route decision, and survey persistence guard.

Additional verification passed:

- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date-v4`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 npm run regen:supabase-types`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`

After applying `20260609045533`, linked Supabase dry-run returned `Remote database is up to date.` Error-level advisors returned `No issues found.` Public-schema lint exited 0 with only existing warning/notice-level legacy output.

Live catalog verification checked that:

- `video_sessions.stable_bilateral_media_at` exists.
- `video_date_active_surface_claims_v1(...)` exists.
- `video_date_mark_stable_bilateral_media_v1(...)` exists.
- `vd_absence_stable_media_base(...)` exists as the preserved provider-absence base.
- `video_date_stable_bilateral_media_gate_v1(...)` contains `already_date_requires_stable_bilateral_media_certification`.
- `video_date_reconcile_provider_absence_v1(...)` contains `pre_stable_media_failed_no_survey`.
- `video_date_stable_bilateral_media_gate_v1(...)` calls `video_date_active_surface_claims_v1(...)`.
- `video_date_session_is_post_date_survey_eligible(...)` and `_v2(...)` both exclude `pre_stable_media_failed`, so lifecycle terminal context cannot infer survey-required truth after a pre-stable media failure.
- Live `date_feedback` RLS/grants allow the post-date survey confirmation guard to read the actor's own verdict row.
- Live `mark_video_date_daily_joined(uuid,text,text,text,text,text)` is authenticated-callable and wrapped by the last-resort v2 fail-soft shell, preventing the active-path raw 500 class from reaching clients.

Audit lessons captured:

- The stable-media gate must be interpreted from the latest deployed replacement function, not from an earlier same-day migration body. The migration chain intentionally tightens in stages; the final function definition is the runtime truth.
- Same-tab web surface bridging is not the primary safety mechanism. The primary fix is continuous date-route/call ownership; bridging only covers hot remount/reload recovery and must release on terminal survey, manual exit, explicit end, and ended-route cleanup.
- A remounted web route that awaits another owner does not automatically own Daily listeners, call refs, or heartbeats. After awaiting the shared start promise, the observer must adopt the current hook owner or retry internally without creating a second Daily call.
- Survey UI must not treat a successful verdict RPC response as completion proof until the current actor's own `date_feedback` row is visible. This is why both web and native/mobile now confirm the row before advancing.
- Catalog marker checks should be precise but not brittle across wrapper generations. The deployed joined wrapper uses `video_date_lifecycle_exception_payload_v2(...)` and `video_date_lifecycle_enrich_and_sanitize_payload_v2(...)`; older `_v1` marker predicates will produce false negatives.
- Generated Supabase types should be refreshed through `npm run regen:supabase-types`, not by hand-editing or treating raw typegen output as canonical.

## Proof Boundary

This is source, migration, test, and linked-cloud implementation evidence. It does not prove Video Date is healthy.

Acceptance still requires a fresh disposable two-user production run:

match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.
