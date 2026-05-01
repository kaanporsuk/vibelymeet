# Native Runtime Visual Readiness Closure

Branch: `fix/native-runtime-visual-readiness-closure`
Date: 2026-05-01

## Investigation Source

Investigation report: `docs/investigations/native-runtime-visual-readiness.md`

Source report branch: `docs/investigate-native-runtime-visual-readiness`

## Findings Addressed

### F5 - Legacy Connectivity Hook Cleanup

The investigation found that native date and Ready Gate live surfaces already use the NetInfo-backed `connectivityService`, but two older send/action guards still imported the legacy `useNetworkStatus` hook, which used `expo-network` polling.

Addressed by:

- replacing event-lobby `useIsOffline()` usage with `useConnectivity() === 'offline'`
- replacing chat-thread `useIsOffline()` usage with `useConnectivity() === 'offline'`
- removing obsolete `apps/mobile/lib/useNetworkStatus.ts`

This keeps native connectivity decisions on the existing NetInfo-backed service without changing route, Ready Gate, video-date, chat, or backend semantics.

## Findings Deferred

### F2 - Physical-Device QA Evidence

Physical-device QA remains manual. It was not executed in the investigation environment because available devices were unavailable/offline.

Deferred because it requires unlocked/trusted devices and controlled manual runtime execution.

### F3 - Screenshot-Led Visual Parity Evidence

Screenshot-led visual parity remains manual. No comparable web/native screenshots were present, and Stream 18 intentionally avoided speculative UI changes.

Deferred because it requires actual sanitized web/native captures before visual fixes can be made safely.

## Files Changed

- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/app/chat/[id].tsx`
- `apps/mobile/lib/useNetworkStatus.ts` (removed)
- `shared/matching/nativeRuntimeVisualReadinessClosure.test.ts`
- `docs/branch-deltas/fix-native-runtime-visual-readiness-closure.md`

## Exact Implementation

- Event lobby and chat send/action guards now consume `useConnectivity` from `apps/mobile/lib/useConnectivity.ts`.
- The removed hook was the only remaining native code path importing `expo-network`.
- The existing `connectivityService` remains backed by `@react-native-community/netinfo` and keeps reachability probes disabled.
- No package manifest, native module, backend, Edge Function, migration, or provider behavior changed.

## Tests Added/Updated

Added:

- `shared/matching/nativeRuntimeVisualReadinessClosure.test.ts`

Coverage:

- investigation report and branch delta are linked
- event lobby and chat use the NetInfo-backed connectivity hook
- obsolete `useNetworkStatus.ts` is removed
- no native code imports `expo-network`
- manual physical-device and screenshot proof gaps remain explicit
- no Supabase migration, validation SQL, Edge Function, or config artifact was introduced
- no env vars, native modules, or `expo-av` usage were added
- Stream 10, 16, and 18 artifacts remain present

## Rebuild Impact

Native TypeScript source changed in two screens. No package or native dependency change was made.

## Route/Page Drift

Added: none.

Removed: none.

Changed: none.

## Edge Functions

Edge Functions changed/deployed: not required.

No Edge Function source changed in this closure.

## Schema/Storage

Schema/storage changes: none.

Supabase migration requirement: none.

Production validation SQL requirement: not required.

## Environment Variables

Env vars added/changed: none.

## Provider/Dashboard Changes

Provider/dashboard changes required: none.

No provider dashboard mutation was performed.

## Deployment Requirements

Supabase migration requirement: none.

Edge Function deploy requirement: none.

Web/static deploy requirement: none.

Supabase cloud deployment after merge: not required.

## Local Validation

Passed:

- `npx tsx shared/matching/nativeRuntimeVisualReadinessClosure.test.ts`
- `npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts`
- `npx tsx shared/matching/nativePhysicalDeviceQaReadiness.test.ts`
- `npx tsx shared/matching/screenshotLedNativeVisualParity.test.ts`
- `npx tsx shared/matching/nativeReadyGateParityContract.test.ts`
- `npx tsx shared/matching/readyGateTerminalUxObservability.test.ts`
- all `shared/matching/*.test.ts` via sweep
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`
- `npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run typecheck`
- `npm run build`
- `cd apps/mobile && npm run typecheck`
- `npm run lint` (0 errors, existing 208-warning backlog)
- `git diff --check`

Supabase preflight:

- `supabase/config.toml` points to `schdyxcunwcvddlcshwd`
- `supabase projects list` showed linked `schdyxcunwcvddlcshwd / MVP_Vibe`
- `supabase migration list --linked` completed read-only

## Native

Native module changes: none.

`expo-av`: not used.

`expo-network`: no native code import remains; existing package manifest entries were not changed.

## Production Smoke Limitations

No real physical-device QA was run.

No screenshot capture or visual provider mutation was run.

No production data-mutating smoke was run.

## Remaining Manual Follow-Up

- Execute and log `docs/qa/native-physical-device-qa-runbook.md` on unlocked/trusted physical devices.
- Capture sanitized web/native screenshots from `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`.
- Perform any visual parity repair only after concrete screenshot evidence exists.

## Safety Confirmation

- No Docker used.
- No local Supabase used.
- No Supabase cloud mutation before PR.
- No deploy.
- No env vars changed.
- No unrelated provider/dashboard mutation.
- No native modules added.
- No `expo-av` import/require.
- No production data-mutating smoke run.
