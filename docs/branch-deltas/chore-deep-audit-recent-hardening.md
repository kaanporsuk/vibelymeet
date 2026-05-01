# Deep Audit Recent Hardening

Branch: `chore/deep-audit-recent-hardening`

Historical note: this branch delta predates the final Event Lobby Ready Queue,
deck payload/media, observability, regression harness, native contract, native parity,
and closure streams. Use `docs/audits/event-lobby-closure-report.md` plus
`docs/audits/event-lobby-deep-cleanup-audit-2026-05-01.md` for current Event Lobby status.

## Problem

After the Event Lobby active-event, swipe retry, web gating, Ready Gate, Video Date, OneSignal, and payment hardening streams landed, the repo needed one more pass to verify deployed state, tidy stale docs/local artifacts, and close any small client/backend contract drift found during review.

## Audit Summary

- Confirmed Supabase project ref `schdyxcunwcvddlcshwd`.
- Confirmed local and remote migrations match through `20260501224000`.
- Confirmed `supabase db push --linked --dry-run` is clean.
- Confirmed deployed Event Lobby RPC markers for active-event and duplicate-swipe guards.
- Confirmed deployed `swipe-actions` is active.
- Refreshed surface inventory candidates and kept the no-mass-delete caveat.

## Implementation Summary

- Web Event Lobby gating now includes `archived_at` / `ended_at` backend markers via `EventDetails`.
- Native Event Lobby side effects now use one confirmed-live gate before deck fetch, event status writes, foreground heartbeats, queue promotion refresh/drain, and Mystery Match.
- Native lifecycle handling now reacts to ended/completed/cancelled/archived/draft plus `ended_at` / `archived_at`.
- Native event status writes no-op while the hook is disabled.
- Docs now point to the active Event Lobby hardening record and canonical `www` app origin.

## Files Changed

- `src/hooks/useEventDetails.ts`
- `src/lib/eventLobbyGating.ts`
- `shared/matching/webEventLobbyGating.test.ts`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/lib/eventStatus.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `docs/active-doc-map.md`
- `docs/audits/recent-hardening-deep-audit-2026-05-01.md`
- `docs/audits/surface-inventory-candidates-2026-04-14.md`
- `docs/audits/video-date-remote-frame-hardening-2026-04-29.md`
- `docs/branch-deltas/chore-deep-audit-recent-hardening.md`
- `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`

## Deploy Requirements

- Supabase migration deploy: not required.
- Edge Function deploy: not required.
- Environment variables: none.
- Native modules: none.

## Validation

- `npx tsx shared/matching/webEventLobbyGating.test.ts`
- `npm run test:hardening-contracts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run check:canonical-origin`
- `npm run audit:surfaces`
- `git diff --check`
- `supabase migration list --linked`
- `supabase db push --linked --dry-run`
- read-only deployed RPC marker query

## Rollback

Revert this branch. No migrations, Edge Function deploys, environment changes, or production data writes are involved.

## Remaining Deferred Work

- Triage `docs/audits/surface-inventory-candidates-2026-04-14.md` with route/product ownership before deleting any candidate components.
- Separate lint-debt stream for the repo-wide warning backlog.
