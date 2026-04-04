# Native v1 Known Runtime Risk List

Date: 2026-04-04
Context: Risks remaining after Sprint 1A merged + Sprint 2 events core closure + Sprint 3 audit closure.

## Risk Register (Runtime-Only or Runtime-Weighted)

## 1) Reset-password deep-link/device flow risk
- Why it remains: Deep-link handoff behavior can differ by platform/app state despite correct code paths.
- Impact: Users may be unable to complete password recovery on device.
- Severity: P0
- Likely owner surface: Native UI + provider/app-link config
- Validation requirement: Real-device deep-link run from email app into app and back.

## 2) OneSignal real-device QA gap
- Why it remains: Code can confirm init/binding attempts but cannot prove delivery semantics and identity hygiene across installs/accounts.
- Impact: Missed notifications or cross-account notification leakage.
- Severity: P0
- Likely owner surface: Provider config + shared adapter login/logout sequencing
- Validation requirement: Real-device permission + send/delivery checks on at least two accounts.

## 3) Daily native runtime/video-call stability risk
- Why it remains: Camera/mic permissions, network churn, and reconnect behavior are runtime-sensitive and provider-SDK-sensitive.
- Impact: Date flow interruption, broken handshake/date transitions, reconnect failures.
- Severity: P0
- Likely owner surface: Provider config + backend contract + native call lifecycle glue
- Validation requirement: Multi-device session with forced disconnect/reconnect scenarios.

## 4) Bunny mobile upload/playback reliability risk
- Why it remains: Media outbox and upload/playback can pass audit but still fail under mobile network variance, backgrounding, and file/codec differences.
- Impact: Stuck media sends, failed playback, misleading outbox states.
- Severity: P0
- Likely owner surface: Shared adapter + native media handling + provider/storage behavior
- Validation requirement: Device tests for photo/voice/video send and hydration under variable network.

## 5) RevenueCat identity/config baseline risk
- Why it remains: Correct SDK calls do not guarantee dashboard/offering/product consistency across envs and account switches.
- Impact: Missing offerings, wrong entitlement state, upgrade flow confusion.
- Severity: P0
- Likely owner surface: Provider config
- Validation requirement: Signed-in account identity validation and offering fetch checks in runtime.

## 6) Event paid-registration runtime truth risk
- Why it remains: Payment-success callbacks and registration state reflection can diverge at runtime due to timing or webhook/provider latency.
- Impact: User pays but sees wrong registration/admission state.
- Severity: P0
- Likely owner surface: Backend contract + provider config
- Validation requirement: End-to-end paid path validation with post-return status reconciliation.

## 7) Ready Gate terminal race risk (residual runtime)
- Why it remains: Sprint hardening reduced races, but timer edge and app-state transitions are still runtime-sensitive.
- Impact: Wrong fallback route or inconsistent terminal messaging.
- Severity: P1
- Likely owner surface: Native UI + backend transition timing
- Validation requirement: Repeated timeout/skip/snooze tests around countdown edge.

## 8) Reconnect grace UX/state drift risk
- Why it remains: Depends on realtime + polling + provider connectivity events; these can diverge by device/network conditions.
- Impact: Premature session end or stale reconnect overlays.
- Severity: P0
- Likely owner surface: Backend contract + native UI synchronization
- Validation requirement: Controlled disconnect tests with grace window observation.

## 9) Cross-account session residue risk after sign-out
- Why it remains: Shared caches/provider identities can persist if cleanup ordering regresses.
- Impact: Wrong user data/notifications visible after account switch.
- Severity: P0
- Likely owner surface: Native UI + provider config + shared adapter cache invalidation
- Validation requirement: Sign in/out multi-account sequence with notifications and chat surfaces.

## 10) Runtime evidence gap risk
- Why it remains: Audit-level closure proves contract alignment, not actual device behavior under OS/provider constraints.
- Impact: False RC confidence without runtime proof.
- Severity: P0 (process risk)
- Likely owner surface: Release process ownership
- Validation requirement: Complete matrix execution with evidence before RC sign-off.
