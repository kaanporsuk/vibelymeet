# Claude Operating Note

## Video Date

For any Vibely Video Date, Ready Gate, Daily.co, event-lobby handoff, notification outbox, or post-date survey task, start with exactly two documents:

- `docs/video-date-architecture.md` — scope boundary, ownership model, rebuilt RPC layer, outbox/crons, shared session controller, contract-to-test map.
- `docs/video-date-runbook.md` — cron set, monitoring/alert posture, validation battery, disposable smoke procedure, deploy discipline.

The curated static battery is `npm run test:video-date-v4` plus the fast subset `npm run test:video-date:red-flags`. Static tests, PR checks, route entry, `both_ready`, Daily room creation, or brief media are never product acceptance. **The acceptance bar is a fresh two-user run from mutual match through both users' persisted `date_feedback` rows**, with provider-backed copresence evidence in the Daily webhook ledger.

Superseded Video Date narratives — the former `video-date-success-command-center.md`, pre-rebuild audits, and pre-rebuild branch deltas — are archived under `docs/archive/video-date/` (provenance only, not current truth). The 2026-06 rebuild's own deltas remain at `docs/branch-deltas/video-date-rebuild-pr*.md`. Schema or Edge Function changes must update the two docs above and `docs/active-doc-map.md` in the same branch.

## General

- Start broader work from `docs/active-doc-map.md`, `AGENTS.md`, and `CODEX.md`.
- Supabase is remote-only (linked project `schdyxcunwcvddlcshwd`). Forward migrations only; never edit an applied migration — correct with a new one, then rerun migration list, dry-run, and DB lint. Refresh generated types with `npm run regen:supabase-types`, never by hand.
- Docs-only PRs can advance source `main`; verify exact source with `git rev-parse HEAD` and `git ls-remote origin refs/heads/main`. The parent workspace has no remote and tracks `Git/vibelymeet` as a nested gitlink; verify it with `git ls-tree HEAD Git/vibelymeet`.
