# Web Mystery Match parity (superseded)

Branch: `fix/web-mystery-match-parity`
Date: 2026-06-06

Superseded 2026-06-09: Mystery Match was removed from the active web, native, and backend path by `supabase/migrations/20260609152000_remove_mystery_match.sql`. This branch delta is retained only as historical context and must not be used to restore parity unless the product decision changes.

## Problem

At the time of this branch, native Event Lobby exposed Mystery Match from the empty-deck state, but web only allowed refresh/end-break actions even though the shared analytics contract and backend `find_mystery_match` RPC supported the flow. That product/backend path was removed on 2026-06-09.

## Delta

- Historically added a web `useMysteryMatch` hook that called `find_mystery_match`, emitted web analytics, supported waiting retries, and cancelled polling. The hook was later deleted.
- Historically patched web Event Lobby so Mystery Match was enabled only behind `lobbySideEffectsEnabled` and routed successful sessions through the existing Ready Gate opener/convergence refresh path. This wiring was later removed.
- Historically extended the web empty-deck component with Mystery Match CTA, finding, waiting, and cancel states. Current empty-deck UI excludes Mystery Match.
- Historically updated shared empty-deck UI state and focused contracts so generic empty states exposed Mystery Match on web and native, while terminal, queued, paused, and error states did not. Current shared state no longer carries `showMysteryMatch`.

## Rebuild Delta

- Backend contracts were unchanged for this historical parity branch; the later removal migration drops the RPC chain.
- Supabase deploy not required.
- Edge Function deploy not required.
- Normal web hosting deployment through PR checks is sufficient.

## Rollback

Historical rollback was to revert the parity PR. Current rollback guidance must not restore Mystery Match unless the product decision changes.
