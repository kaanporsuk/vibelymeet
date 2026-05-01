# Native Runtime Visual Readiness Investigation

Date: 2026-05-01
Branch: `docs/investigate-native-runtime-visual-readiness`
Base: `main` at `83f3512e0`

## Executive Verdict

WARN.

The repo-side native runtime contracts for Stream 10 are present and pass validation. Streams 16 and 18 are closed as readiness/documentation streams: they landed reproducible physical-device QA and screenshot-led visual parity plans, but they did not execute real physical-device runtime QA or capture screenshot evidence in this environment. No native date or Ready Gate contract regression was found. No `expo-av` package/import was found. No native module, backend, Supabase, or cloud deploy change is required by this investigation.

The remaining release risk is manual proof, not a discovered code defect:

- physical-device QA still needs to be run on unlocked/trusted devices
- screenshot-led parity still needs actual web/native captures before visual fixes
- if the intended native connectivity posture is globally NetInfo-only, the legacy `useNetworkStatus` hook still uses `expo-network` in chat and event-lobby send guards; date/Ready Gate live surfaces use the NetInfo-backed `connectivityService`

## Artifacts Inspected

Stream 10:

- `docs/branch-deltas/fix-native-video-date-contract-recovery.md`
- `shared/matching/nativeVideoDateContractRecovery.test.ts`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`

Stream 16:

- `docs/qa/native-physical-device-qa-runbook.md`
- `docs/branch-deltas/qa-native-physical-device-flow.md`
- `shared/matching/nativePhysicalDeviceQaReadiness.test.ts`
- native Ready Gate/date/push/media surfaces referenced by the runbook and test

Stream 18:

- `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`
- `docs/branch-deltas/fix-screenshot-led-native-visual-parity.md`
- `shared/matching/screenshotLedNativeVisualParity.test.ts`
- Stream 18 commit file list from `a9c20bb77`

Cross-native:

- `apps/mobile/package.json`
- `package.json`
- `apps/mobile/lib/connectivityService.ts`
- `apps/mobile/lib/useNetworkStatus.ts`
- `apps/mobile/components/connectivity/LiveSurfaceOfflineStrip.tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/app/chat/[id].tsx`
- `docs/active-doc-map.md`
- `docs/release/final-hardening-release-rehearsal.md`

## Stream 10 Findings

PASS: Native date route loads backend session truth before routeability.

- `/date/[id]` calls `fetchVideoSessionDateEntryTruthCoalesced(sessionId)`.
- The route classifies truth through `decideVideoSessionRouteFromTruth` and `canAttemptDailyRoomFromVideoSessionTruth`.
- Missing, ended, not-startable, and ready-only truth redirect or recover instead of local-starting a date.

PASS: Participant ownership guard exists.

- `/date/[id]` checks `getVideoSessionPartnerIdForUser(vs, user.id)` and blocks nonparticipants.

PASS: Date route is gated by backend prepare-entry/Daily truth.

- Ready Gate overlay and standalone ready route call `prepareVideoDateEntry` / `ensureVideoDateStartableBeforeNavigation` before native date navigation.
- `apps/mobile/lib/videoDatePrepareEntry.ts` invokes the `daily-room` Edge Function with `prepare_date_entry`.
- Native does not construct Daily rooms locally.

PASS: Lifecycle uses backend RPCs.

- `apps/mobile/lib/videoDateApi.ts` uses `video_date_transition` for enter/sync/reconnect/end/complete-handshake paths.
- `/date/[id]` uses `mark_video_date_daily_joined` for Daily joined stamps.

PASS: Stale, ended, and inactive recovery avoids retry loops.

- `READY_GATE_NOT_READY` is bounded by retry backoffs.
- `EVENT_NOT_ACTIVE` and ended truth are treated as terminal/stale handoff truth.
- Recovery paths clear date-entry latches before redirecting to Ready Gate, lobby, tabs, or survey.

PASS: Duplicate side-effect latches exist and reset by session.

- `hasStartedJoinRef`, `prejoinAttemptRef`, `joinAttemptNonce`, `reconnectEndedHandledRef`, `handshakeCompletionInFlightRef`, `handshakeCompletionDeadlineKeyRef`, and Ready Gate navigation/terminal latches remain present.

PASS: AppState/refetch/reconnect remains present.

- `/date/[id]`, `/ready/[id]`, Ready Gate overlay, and active-session recovery retain AppState foreground reconciliation and backend refetch/sync behavior.

PASS: No forbidden direct lifecycle writes found.

- Static search and tests found no direct native writes to backend-owned `video_sessions` lifecycle fields or Ready Gate-owned `event_registrations` lifecycle fields in the audited native date/Ready Gate surfaces.

PASS: No `expo-av`.

- No package dependency or import/require of `expo-av` was found. Mentions are docs/tests/comments that assert non-use.

## Stream 16 Findings

WARN: Stream 16 is closed as physical-device QA readiness, not executed physical-device proof.

- `docs/qa/native-physical-device-qa-runbook.md` records that Xcode existed locally but available iPhones were unavailable/offline.
- `docs/branch-deltas/qa-native-physical-device-flow.md` explicitly says runtime QA was not executed and lists manual steps still required.

PASS: QA matrix is broad and reproducible.

The runbook covers:

- native sign in/session restore
- stale and terminal `/ready/[id]`
- web-to-native and native-to-native Ready Gate
- web-to-native and native-to-native video date
- direct stale `/date/[id]`
- event-ended Ready Gate/date recovery
- foreground/focus reconciliation
- reconnect and partner disconnect
- post-date survey recovery
- duplicate Daily join/token suppression
- OneSignal ready/date/chat deep links
- controlled Vibe Video playback/upload smoke

PASS: Executed vs deferred status is recorded.

- Local static audits and typechecks are recorded.
- Physical-device execution is deferred honestly.

PASS: Bugs found/fixed status is documented.

- Stream 16 records no scoped native code defect and no runtime code fixes.

PASS: No native module/backend drift.

- Stream 16 commit `cdef0a284` added only docs/tests.
- No migration, Edge Function, env var, native module, EAS build, or `expo-av` change was introduced.

## Stream 18 Findings

WARN: Stream 18 is closed as screenshot-led parity planning, not completed screenshot evidence.

- `docs/qa/screenshot-led-native-visual-parity-capture-plan.md` states no comparable web/native captures were present.
- `docs/branch-deltas/fix-screenshot-led-native-visual-parity.md` states no visual mismatch was fabricated and no native UI fixes were made.
- No screenshot artifacts were found under `docs/qa`.

PASS: Web is explicitly source of truth.

- The capture plan says web is the visual and product source of truth.
- It prohibits visual differences inferred from memory, preference, or taste.

PASS: Target screen matrix exists.

The plan covers 14 screen families:

- auth
- onboarding
- dashboard/home
- events list
- event details
- event lobby
- Ready Gate
- video date
- matches
- chat
- profile studio
- settings
- push/notification surfaces
- Vibe Video surfaces

PASS: No speculative redesign.

- Stream 18 commit `a9c20bb77` added only docs/tests plus active-doc-map entries.
- No native UI files were changed.
- No backend/cloud/native-module changes were introduced.

## Cross-Native Findings

PASS: Native contracts from Streams 6 and 10 remain aligned.

- Ready Gate remains `ready_gate_transition` / `prepareVideoDateEntry` gated.
- Date route remains backend truth / `daily-room prepare_date_entry` gated.
- Stream 6 and 10 tests both pass.

PASS: Visual parity work did not affect runtime contract/recovery logic.

- Stream 18 did not edit native UI/runtime files.

PASS: No new native modules and no `expo-av`.

- `apps/mobile/package.json` does not include `expo-av`.
- Static import scans found no `expo-av` import/require.
- Stream 16 and 18 commits did not edit `apps/mobile/package.json`.

WARN: NetInfo-only connectivity is partially preserved, not global.

- `apps/mobile/lib/connectivityService.ts` is NetInfo-backed and disables reachability probes.
- `LiveSurfaceOfflineStrip` uses `useConnectivity`, and date/lobby live banners render this NetInfo-backed strip.
- Legacy `apps/mobile/lib/useNetworkStatus.ts` still uses `expo-network`; `apps/mobile/app/event/[eventId]/lobby.tsx` and `apps/mobile/app/chat/[id].tsx` still import `useIsOffline` for send/action guards.
- This was not introduced by Streams 10, 16, or 18, and it did not affect the audited native date contract, but it should be resolved in a future cleanup if "NetInfo-only" is intended to mean every native connectivity decision.

PASS: Physical-device QA feeds release gates.

- `docs/release/final-hardening-release-rehearsal.md` lists Stream 16 and Stream 18 artifacts.
- Final hardening docs keep physical-device QA and screenshot-led parity as release/manual follow-ups.

## Validation Results

Passed:

- `npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts`
- `npx tsx shared/matching/nativePhysicalDeviceQaReadiness.test.ts`
- `npx tsx shared/matching/screenshotLedNativeVisualParity.test.ts`
- `npx tsx shared/matching/nativeReadyGateParityContract.test.ts`
- `npx tsx shared/matching/readyGateTerminalUxObservability.test.ts`
- all `shared/matching/*.test.ts`
- `npm run typecheck`
- `npm run build`
- `cd apps/mobile && npm run typecheck`
- `npm run lint` (0 errors, existing 208-warning backlog)
- `git diff --check`

Build note:

- Vite build completed with existing chunk-size/dynamic-import warnings only.

## Release Manual QA Recommendations

Before a mobile release, run and record:

- full `docs/qa/native-physical-device-qa-runbook.md` on at least one unlocked/trusted iPhone
- native-to-native scenarios on a second physical device when available
- controlled OneSignal deep-link clicks to ready/date/chat routes
- controlled Bunny media upload/playback with test-only assets
- controlled Daily reconnect/partner-disconnect paths
- screenshot capture plan from `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`
- a second screenshot-led parity pass using actual sanitized web/native screenshots

## Repair Recommendations

No blocking repo repair is recommended for Streams 10, 16, or 18.

Recommended follow-up streams:

- Execute and log physical-device QA results from the Stream 16 runbook.
- Execute screenshot capture and perform a screenshot-backed visual parity repair pass.
- If desired, consolidate legacy `useNetworkStatus` callers onto `connectivityService` so the native connectivity posture is globally NetInfo-only.

## Safety Confirmation

- Investigation only.
- No native modules added.
- No `expo-av` package/import added.
- No Supabase cloud mutation.
- No Supabase deploy.
- No Edge Function deploy.
- No backend migration.
- No provider mutation.
- No production smoke involving real push, media, Daily rooms, payments, email, or SMS.
