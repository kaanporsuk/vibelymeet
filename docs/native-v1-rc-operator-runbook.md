# Native v1 RC Operator Runbook

Date: 2026-04-04
Purpose: Execute runtime validation in the highest-signal order and produce actionable findings for Cursor follow-up.

## 1. Operating Principles

- Treat backend-owned chat/event/date flows as canonical: report behavior drift, do not patch runtime assumptions manually.
- Prefer fail-fast ordering: validate auth/session and provider readiness before deep feature traversal.
- Capture evidence at first failure, not after retries only.
- Distinguish issue class early: Native UI vs Shared adapter vs Backend contract vs Provider config.

## 2. Preflight (Before Any Feature Testing)

1. Confirm target branch/build identifier and environment (iOS/Android, debug/release profile).
2. Confirm Supabase project/ref and provider keys used by the build (OneSignal, Daily, RevenueCat, Bunny).
3. Confirm test accounts:
- Account A and Account B for interaction paths (chat/date/ready gate).
- One new account for sign-up/onboarding checks.
4. Enable log capture:
- App logs/device console
- Network inspection where possible
- Screenshot and screen recording availability

Stop immediately if auth bootstrap fails in preflight.

## 3. Exact Test Order (Waste-Reduction Sequence)

1. Auth/session gate
- Sign in
- Sign out
- Sign in again
- Onboarding redirect truth

2. Provider bootstrap gate
- OneSignal initialization and permission behavior
- RevenueCat identity baseline check

3. Events core gate
- Events list -> event details
- Free/paid registration truth path
- Lobby entry and deck/swipe behavior
- Ready Gate transitions
- Date handoff

4. Matches/chat/date gate
- Matches list truth
- Chat send path + media outbox basics
- Video date handshake
- Reconnect grace behavior
- Survey return path

5. Profile/settings baseline gate
- Profile load/edit save
- Settings navigation
- Pause/resume (if enabled)

Rationale:
- Steps 1-2 eliminate most global blockers before spending time in deep event/date scenarios.
- Steps 3-4 exercise highest-risk canonical state machines.
- Step 5 verifies baseline account stability after stress paths.

## 4. Failure Evidence Checklist (Capture on First Repro)

For every FAIL/BLOCKED item capture:
1. Matrix ID and exact screen/path.
2. Device and OS version.
3. Build identifier and branch/commit.
4. Timestamp and timezone.
5. Repro steps (minimal deterministic sequence).
6. Expected vs observed behavior.
7. Screenshot/video showing final incorrect state.
8. Relevant logs:
- App runtime log excerpt
- Network/edge error payload (if visible)
- Provider SDK error output (OneSignal/Daily/RevenueCat)

## 5. Fast Triage: Native UI vs Backend/Provider

Use this decision flow:
1. UI mismatch only, backend state correct:
- Likely Native UI surface.
- Example: incorrect button state despite correct backend payload.

2. Wrong payload/params from app adapter, backend rejects:
- Likely Shared adapter.
- Example: missing required transition action field.

3. Backend returns incorrect state transition despite valid request:
- Likely Backend contract.
- Example: ready/date transition result contradicts canonical state.

4. Provider SDK/init/token issue with otherwise correct app flow:
- Likely Provider config.
- Example: push identity mismatch, Daily token/create room failures, missing offerings in RevenueCat.

## 6. Reporting Format Back to Cursor

Submit one consolidated report grouped by severity:

- P0 blockers
- P1 must-fix
- P2 non-blocking issues

For each issue include:
- Matrix ID
- Severity
- Owner surface guess
- Evidence links/paths
- Minimal repro
- Last known good (if known)
- Recommended next action

## 7. Cursor Follow-up Workflow

After operator report is posted:
1. Cursor converts each P0/P1 into explicit fix tasks scoped by owner surface.
2. Cursor applies minimal patches only in impacted files.
3. Cursor re-runs contract compliance checks (no lifecycle drift).
4. Operator re-tests only impacted matrix IDs first, then run adjacent regression slice.
5. Mark item PASS only with fresh runtime evidence.

## 8. When to Stop Testing and Escalate

Escalate immediately if any of these occur:
- Auth/session gate cannot be completed.
- Provider bootstrap is broken globally (OneSignal/Daily/RevenueCat init failure across accounts).
- Repeated crashes in events/date core flows.
- Evidence shows backend contract regression rather than client-only issue.

## 9. Minimal Device Validation Set (First Pass)

- iOS device/simulator: full sequence through auth -> events core -> chat/date.
- Android device/emulator: repeat critical P0 items at minimum.
- Two-account interaction required for chat/date/reconnect checks.

If time-constrained, run P0-only list first:
- AUTH-1, AUTH-4, AUTH-5
- NOTIF-1, NOTIF-3
- EVT-2, EVT-5, EVT-7, EVT-8
- MCD-2, MCD-3, MCD-4, MCD-5
- PROF-4
