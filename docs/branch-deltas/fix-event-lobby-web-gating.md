# Web Event Lobby Gating

Branch: `fix/event-lobby-web-gating`

## Problem

Web `EventLobby` could mount the deck shell and start deck polling before the event, registration, and local live-window state were valid. Missing or stale event links could also fall through to a generic lobby shell instead of a clear unavailable state.

## Delta

- Added `src/lib/eventLobbyGating.ts` as the local web route gate.
- Patched `src/pages/EventLobby.tsx` so deck fetches, swipe actions, status heartbeats, queue drains, and stale Ready Gate opens are disabled unless the event is locally live and the user is confirmed/eligible.
- Patched `useEventStatus` so `setStatus` no-ops after the route gate disables lobby side effects.
- Patched `useMatchQueue` with an `enabled` flag that clears queued count and avoids drain/realtime subscriptions when the lobby is not eligible.
- Added focused coverage in `shared/matching/webEventLobbyGating.test.ts`.

## Rebuild Delta

- Route behavior changed: `/event/:eventId/lobby` now renders clear unavailable states for missing, not-started, not-confirmed, cancelled, archived, draft, and ended events.
- Backend contracts unchanged.
- Supabase deploy not required.
- Edge Function deploy not required.
- Normal web hosting deployment through PR checks is sufficient.

## Rollback

Revert the PR. No database or Edge Function rollback is required.
