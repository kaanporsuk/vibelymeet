# Web Mystery Match parity

Branch: `fix/web-mystery-match-parity`
Date: 2026-06-06

## Problem

Native Event Lobby exposed Mystery Match from the empty-deck state, but web only allowed refresh/end-break actions even though the shared analytics contract and backend `find_mystery_match` RPC already support the flow.

## Delta

- Added a web `useMysteryMatch` hook that calls `find_mystery_match`, emits web analytics, supports waiting retries, and cancels polling.
- Patched web Event Lobby so Mystery Match is enabled only behind `lobbySideEffectsEnabled` and routes successful sessions through the existing Ready Gate opener/convergence refresh path.
- Extended the web empty-deck component with Mystery Match CTA, finding, waiting, and cancel states.
- Updated shared empty-deck UI state and focused contracts so generic empty states expose Mystery Match on web and native, while terminal, queued, paused, and error states do not.

## Rebuild Delta

- Backend contracts unchanged.
- Supabase deploy not required.
- Edge Function deploy not required.
- Normal web hosting deployment through PR checks is sufficient.

## Rollback

Revert the PR. No database, Edge Function, or provider rollback is required.
