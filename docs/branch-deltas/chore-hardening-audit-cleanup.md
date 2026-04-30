# Hardening Audit Cleanup

Branch: `chore/hardening-audit-cleanup`

## Problem

After Streams 1-11 merged, a final audit found that the implementation had landed correctly but the paper trail still had one stale edge:

- an untracked scratch audit, `docs/audits/event-lobby-deck-deep-dive.md`, remained in the worktree with pre-hardening risk claims
- `docs/audits/event-lobby-production-contract-verification.md` referenced that untracked scratch audit and still read like a current blocker report
- the stream contract tests were present but had no single first-class runner

## Cleanup

- Removed the untracked scratch audit from the working tree instead of committing obsolete claims.
- Marked `docs/audits/event-lobby-production-contract-verification.md` as a historical pre-hardening snapshot superseded by Streams 1-11.
- Added `scripts/run_hardening_contract_tests.sh`.
- Added `npm run test:hardening-contracts`.

## Validation

`npm run test:hardening-contracts` runs the Streams 1-11 source/static contract pack plus `git diff --check`.

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Environment variables: none
- Native modules: none
- Docker/local Supabase: not used

## Remaining Deferred Work

- Physical-device push QA with a controlled internal test user
- Provider-dashboard verification for OneSignal app/key/domain alignment
- Full schema dump only if an operator needs byte-for-byte schema evidence on a machine with Docker available
