# Recent Hardening Deep Audit - 2026-05-01

Branch: `chore/deep-audit-recent-hardening`<br>
Base commit: `5a5a24de92663544c938a39158433a3f74ee915d`<br>
Supabase project ref: `schdyxcunwcvddlcshwd`

> Historical note: this audit was accurate for the `chore/deep-audit-recent-hardening`
> branch at base commit `5a5a24de92663544c938a39158433a3f74ee915d`.
> It predates the later Event Lobby Ready Queue, deck payload/media, observability,
> regression harness, native contract, native parity, and final closure streams.
> For current Event Lobby launch posture, use
> `docs/audits/event-lobby-closure-report.md` and
> `docs/audits/event-lobby-deep-cleanup-audit-2026-05-01.md`.

## Scope

This audit reviewed the recently landed Event Lobby / Ready Gate / Video Date hardening work, with special attention to whether the shipped source, Supabase deployment, docs, and cleanup posture still agree.

## Remote Verification

- Linked Supabase project ref was confirmed as `schdyxcunwcvddlcshwd`.
- `supabase migration list --linked` showed local/remote parity through `20260501224000`.
- `supabase db push --linked --dry-run` returned `Remote database is up to date.`
- Latest local and remote migration: `20260501224000_event_lobby_swipe_already_swiped.sql`.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd` showed `swipe-actions` active at version `470`, updated `2026-05-01 00:23:55 UTC`.
- Read-only catalog marker query confirmed deployed RPCs exist and contain the expected active-event / duplicate-swipe guards:
  - `get_event_deck`: deployed, uses `get_event_lobby_active_state`, contains `event_not_active`
  - `handle_swipe`: deployed, uses `get_event_lobby_active_state`, contains `event_not_active` and `already_swiped`
  - `find_mystery_match`: deployed, uses `get_event_lobby_active_state`, contains `event_not_active`
  - `drain_match_queue`: deployed, uses `get_event_lobby_active_state`, contains `event_not_active`
  - `ready_gate_transition`: deployed, contains `event_not_active`
  - `get_event_lobby_active_state`: deployed

No production data was mutated.

## Findings

- The backend active-event contract is deployed and aligned with the latest migration set.
- Swipe retry/idempotency behavior is deployed and the `swipe-actions` Edge Function is on the expected deployed version.
- The earlier untracked scratch audit `docs/audits/event-lobby-deck-deep-dive.md` is no longer present in the worktree and remains intentionally untracked.
- A local ignored backup file under `apps/mobile/ios/Pods/.../types.h.bak` was removed from the worktree. It was not source-controlled.
- `docs/active-doc-map.md` did not yet make the Event Lobby active-event, swipe retry, and web/native gating closure easy to find.
- Web local gating had a narrow drift from backend truth: event details did not expose `archived_at` and `ended_at`, so the client could only infer archive/end from status or scheduled time.
- Native Event Lobby still allowed deck/status/foreground/queue side effects to initialize before the same confirmed-registration/live-event gate used by web.
- The canonical origin guard found stale apex app-origin links in current docs. Those docs now use `https://www.vibelymeet.com` for canonical app-origin references.
- `npm run audit:surfaces` reports no orphan pages or hooks. It still reports candidate orphan components, mostly shadcn `ui/*`, wizard, safety, and marketing-style components. These are documented as a triage queue, not a safe deletion list, because the script does not analyze dynamic/runtime loaders.

## Cleanup And Patches

- Added `archivedAt` and `endedAt` to web `EventDetails` and taught `getWebEventLobbyGateState` to block on those backend terminal/archive markers.
- Extended the web/native Event Lobby gating regression test to assert `archived_at` / `ended_at` mapping and native side-effect gating.
- Added native `EventRow.archived_at` and `EventRow.ended_at` fields.
- Tightened native Event Lobby local gating so deck fetch, lobby status, foreground heartbeats, queue refresh/drain, and Mystery Match only run after route, user, event, confirmed registration, not-paused status, and local live-window truth are valid.
- Updated native event lifecycle handling for `ended`, `completed`, `cancelled`, `archived`, `draft`, `ended_at`, and `archived_at`.
- Made native `useEventStatus` no-op while disabled, matching the web hook posture.
- Refreshed `docs/audits/surface-inventory-candidates-2026-04-14.md` with the current mechanical inventory and preserved the no-mass-delete interpretation.
- Normalized current docs to the canonical `https://www.vibelymeet.com` app origin.

## Rebuild Delta

Public backend contract surfaces changed: none.

Client contract behavior changed:

- Web Event Lobby local gate now honors `events.archived_at` and `events.ended_at` in addition to status and scheduled end time.
- Native Event Lobby now disables deck/status/foreground/queue/Mystery Match side effects unless the user has a confirmed live seat and the event is locally live.

Cloud deploy requirements:

- Supabase migration deploy: not required.
- Edge Function deploy: not required.
- Web/native hosting or app deploy: normal application release only.

## Validation Results

- `npx tsx shared/matching/webEventLobbyGating.test.ts`: passed, 7 tests.
- `npm run test:hardening-contracts`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with the existing warning backlog, 0 errors.
- `npm run build`: passed with existing Vite chunk/dynamic import warnings.
- `npm run check:canonical-origin`: passed after doc normalization.
- `npm run audit:surfaces`: completed and refreshed the surface inventory candidates doc.
- `git diff --check`: passed.
- `supabase migration list --linked`: local/remote parity through `20260501224000`.
- `supabase db push --linked --dry-run`: remote database up to date.

## Risks And Deferred Work

- The surface inventory candidate list is intentionally not auto-deleted; each candidate needs route/product proof before removal.
- The repo still has a known lint warning backlog. This audit removed warnings introduced in the touched Event Lobby file but did not attempt a broad lint-debt cleanup.
- No production smoke fixture was used. The production verification in this audit was read-only Supabase catalog/deployment inspection.
