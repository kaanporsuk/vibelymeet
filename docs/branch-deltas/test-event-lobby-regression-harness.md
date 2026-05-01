# Branch Delta: Event Lobby Regression Harness

Date: 2026-05-01
Branch: `test/event-lobby-regression-harness`
PR title: `Add Event Lobby regression harness`

## Problem

Event Lobby hardening had landed across six streams, but the regression evidence was spread across several individual tests and docs. Operators needed one repeatable entrypoint plus a staging runbook for the flows that cannot be safely automated without dedicated fixtures.

## Pre-audit Summary

- Prompts 1-6 were present on `origin/main`.
- Supabase linked ref verified as `schdyxcunwcvddlcshwd`.
- Local and remote migrations were in parity through `20260501230000`.
- `supabase db push --linked --dry-run` reported the remote database was up to date before implementation.
- Deployed `swipe-actions` was active after the Event Lobby observability deployment.

## Implementation Summary

- Added a focused Event Lobby regression runner.
- Added a harness test that proves the runner, docs, safety gates, and coverage map stay wired together.
- Added a manual staging runbook for mutual vibe, queued match, Super Vibe retry, block/report exclusion, ended-lobby, empty-deck diagnostics, and stale RPC rejection.
- Added package and active-doc-map entrypoints.

## Files / Functions Changed

- `scripts/run_event_lobby_regression.sh`
- `shared/matching/eventLobbyRegressionHarness.test.ts`
- `docs/golden-path-event-lobby-regression-runbook.md`
- `docs/audits/event-lobby-regression-harness-verification.md`
- `docs/branch-deltas/test-event-lobby-regression-harness.md`
- `docs/active-doc-map.md`
- `package.json`

## Migrations Added

None.

## Edge Functions Changed / Deployed

None.

## Validation Plan

- `npm run test:event-lobby-regression`
- `npx tsx shared/matching/eventLobbyRegressionHarness.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `supabase db push --linked --dry-run`

## Deploy Plan

No Supabase deploy is required because this stream adds no migrations and changes no Edge Functions. After merge, checkout/pull `main`, reconfirm the linked Supabase ref, and run a clean DB dry-run to verify local, Git, and cloud remain aligned.

## Rollback Plan

Revert the merge commit. No database rollback or Edge Function rollback is required.

## Rebuild Delta

- New package command: `npm run test:event-lobby-regression`
- New safe shell runner for focused Event Lobby regression checks.
- New source/static test coverage for harness completeness and safety.
- New manual staging smoke runbook.
- No schema, RPC return shape, Edge Function, provider, or env contract changes.

## Out Of Scope

- Creating production test users or fixture data.
- Automating live two-user/three-user staging flows without a safe fixture system.
- Changing Event Lobby backend, web, native, notification, or Ready Gate behavior.
