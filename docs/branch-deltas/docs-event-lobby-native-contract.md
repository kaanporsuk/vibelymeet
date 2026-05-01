# Branch Delta: Native Event Lobby Contract

Date: 2026-05-01
Branch: `docs/event-lobby-native-contract`
PR title: `Define native Event Lobby contract`

## Problem

Event Lobby backend, web, and native behavior had been hardened across active-event enforcement, swipe idempotency, web gating, queue policy, deck payload, observability, and regression harness streams. Native needed a single implementation-ready contract so future work does not reverse-engineer web behavior or accidentally reintroduce client-owned business logic.

## Pre-Audit Summary

- Prompts 1-7 were present on `origin/main` before branching.
- Supabase linked ref verified as `schdyxcunwcvddlcshwd`.
- Local and remote migrations were in parity through `20260501230000`.
- `supabase db push --linked --dry-run` reported the remote database was up to date before implementation.
- Current Event Lobby backend, deck payload, swipe outcome, queue, Ready Gate, observability, native lobby, and regression docs/code were inspected.

## Implementation Summary

- Added the canonical Event Lobby native/backend contract.
- Documented backend ownership, entry eligibility, deck RPC, swipe API, Super Vibe policy, Ready Gate, queueing, media, realtime/polling, observability, security/privacy, and Prompt 9 native implementation checklist.
- Updated native and canonical project docs to make the new contract discoverable.
- Corrected the canonical project reference for current `get_event_deck` inactive-event behavior.
- Added audit verification and rebuild delta traceability.

## Files / Functions Changed

- `docs/contracts/event-lobby-native-contract.md`
- `docs/audits/event-lobby-native-contract-verification.md`
- `docs/branch-deltas/docs-event-lobby-native-contract.md`
- `docs/active-doc-map.md`
- `docs/vibely-canonical-project-reference.md`
- `docs/native-backend-contract-matrix.md`
- `docs/native-sprint0-architecture-lock.md`
- `docs/native-screen-contract-map.md`

## Migrations Added

None.

## Edge Functions Changed / Deployed

None.

## Validation Results

- `git diff --check`: passed.
- Link/path existence checks for the docs referenced by this stream: passed.
- `npm run test:event-lobby-regression`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with existing warnings only.
- `supabase db push --linked --dry-run`: remote database is up to date.

## Deploy Plan

No Supabase deploy is required because this stream changes docs only. After merge, checkout/pull `main`, reconfirm the linked Supabase ref, and run a clean DB dry-run to verify local, Git, and cloud remain aligned.

## Rollback Plan

Revert the merge commit. No database rollback or Edge Function rollback is required.

## Rebuild Delta

- New canonical contract for native Event Lobby implementation.
- New audit verification and branch delta docs.
- Canonical and native doc maps now point to the contract.
- No schema, RPC return shape, Edge Function, provider, env, or public runtime behavior changes.

## Out Of Scope

- Implementing Prompt 9 native UI changes.
- Changing backend eligibility, swipe, queue, Ready Gate, or media behavior.
- Deploying Supabase migrations or Edge Functions.
- Creating staging fixtures or mutating production data.
