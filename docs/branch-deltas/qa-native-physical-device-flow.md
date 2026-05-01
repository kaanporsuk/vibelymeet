# Stream 16 - Native Physical-Device QA Flow

Branch: `qa/native-physical-device-flow`

## Problem

Streams 1-15 hardened the backend contracts and external providers that native runtime flows depend on. Stream 16 turns the prior Ready Gate, video-date, OneSignal, Bunny, Daily, Resend, and Twilio work into a physical-device QA plan for the actual native app, while executing only the local checks available in this environment.

## Scope

This stream covers native runtime QA readiness for:

- sign in/session restore
- Ready Gate stale and terminal recovery
- web-to-native and native-to-native Ready Gate handoff
- web-to-native and native-to-native video-date handoff
- stale `/date/[id]` links before prepare-entry
- event-ended Ready Gate/date recovery
- foreground/focus reconciliation
- reconnect and partner disconnect
- post-date survey recovery
- duplicate Daily join/token suppression
- OneSignal deep links to ready/date/chat
- controlled internal Vibe Video playback/upload smoke

## Files Audited

- `docs/branch-deltas/fix-native-ready-gate-parity-contract.md`
- `docs/branch-deltas/fix-native-video-date-contract-recovery.md`
- `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`
- `docs/branch-deltas/fix-bunny-provider-operational-qa.md`
- `docs/branch-deltas/fix-daily-provider-operational-qa.md`
- `apps/mobile/package.json`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`
- `apps/mobile/lib/useActiveSession.ts`
- `apps/mobile/components/NotificationDeepLinkHandler.tsx`
- `apps/mobile/lib/onesignal.ts`
- `apps/mobile/lib/vibeVideoApi.ts`
- `apps/mobile/lib/vibeVideoState.ts`
- `apps/mobile/lib/vibeVideoPlaybackUrl.ts`

## Device Execution Status

Physical-device runtime QA was not executed in this Codex environment.

What was checked:

- Xcode is installed at `/Applications/Xcode.app/Contents/Developer`.
- `xcrun xctrace list devices` and `xcrun devicectl list devices` were available.
- Xcode saw two iPhones, but both were unavailable/offline:
  - `OKP`, iPhone 15 Pro Max
  - `Zeliha iPhone'u`, iPhone 14 Pro Max
- Because no unlocked/trusted physical device was available, runtime QA could not be honestly executed.

What was executed locally:

- native source/package audit
- static contract audit of Ready Gate/date latches and prepare-entry gates
- local native typecheck as part of validation
- complete manual runbook creation

## QA Matrix

The runbook at `docs/qa/native-physical-device-qa-runbook.md` contains exact device setup, test users, backend truth queries, failure capture, rollback notes, and scenario steps for:

1. native sign in/session restore
2. native `/ready/[id]` stale/terminal recovery
3. web-to-native Ready Gate
4. native-to-native Ready Gate
5. web-to-native video date handoff
6. native-to-native video date handoff
7. direct stale `/date/[id]` before prepare-entry
8. event-ended Ready Gate recovery
9. event-ended stale date handoff
10. app foreground/focus during Ready Gate/date
11. reconnect/partner disconnect
12. post-date survey recovery
13. duplicate Daily join/token suppression
14. OneSignal click deep link to ready/date/chat
15. controlled internal Vibe Video playback/upload smoke

## Bugs Found

No scoped native code defect was found during the static audit.

The audit confirmed:

- standalone native Ready Gate uses `ensureVideoDateStartableBeforeNavigation`
- Ready Gate overlay uses `prepareVideoDateEntry` before date navigation
- duplicate Ready Gate navigation and terminal side effects have session-scoped latches
- native date route has `hasStartedJoinRef`, `prejoinAttemptRef`, `joinAttemptNonce`, reconnect terminal latch, and handshake completion latches
- native date route recovers stale/event-inactive/ended truth without direct backend lifecycle writes
- OneSignal date deep links reconcile backend video-date truth before routing to `/date/[id]`
- Vibe Video upload uses Bunny/TUS native source objects and does not use base64 body materialization
- native playback uses `expo-video`, not `expo-av`

## Fixes Made

No runtime code fixes were made.

Docs/tests added:

- `docs/qa/native-physical-device-qa-runbook.md`
- `shared/matching/nativePhysicalDeviceQaReadiness.test.ts`
- this branch delta document

## Manual User Steps Still Needed

Run the full physical-device matrix on a Mac with at least one unlocked/trusted iPhone and, for native-to-native scenarios, a second physical device.

Minimum manual execution still needed before mobile release:

- sign in/session restore on physical device
- web-to-native and native-to-native Ready Gate
- web-to-native and native-to-native video date
- stale `/ready` and `/date` deep links
- event-ended recovery
- app foreground/reconnect paths
- post-date survey recovery
- controlled OneSignal deep-link click
- controlled Vibe Video upload/playback with test media

## Cloud Deploy Requirements

- Supabase migration deploy: not required.
- Supabase DB push: not required.
- Edge Function deploy: not required.
- Vercel/web deploy: normal PR merge deployment only; no web runtime file changed.
- Provider dashboard change: not required by this stream.

## Explicit Non-Changes

- No Docker used.
- No local Supabase used.
- No Supabase DB push.
- No Supabase migration added.
- No Edge Function changed.
- No Edge Function deployed.
- No env vars changed.
- No native modules added.
- No `expo-av` import or package added.
- No EAS build run.
- No real production media smoke run.
- No real production push smoke run.

## Remaining Deferred Work

- Execute the physical-device QA matrix from `docs/qa/native-physical-device-qa-runbook.md`.
- Screenshot-led native visual parity.
- Controlled internal Bunny media smoke on physical device.
- Controlled internal OneSignal deep-link smoke on physical device.
- Controlled internal Daily reconnect and partner-disconnect smoke on physical device.
- RevenueCat/native entitlement readiness if still incomplete.
