# Branch Delta: Event Lobby Deck Payload Media

Branch: `fix/event-lobby-deck-payload-media`
Date: 2026-05-01

## Problem

Event Lobby cards needed a single safe deck payload for web/native. Web and native were fetching per-card profile data for verification/premium display, and web full-card media could fall back incorrectly or use thumbnail-sized transforms.

## Implementation Summary

- Added migration `20260501230000_event_lobby_deck_payload_media.sql`.
- Extended `get_event_deck` with safe rendering fields: `primary_photo_path`, `photo_verified`, `premium_badge`, and `availability_state`.
- Removed Event Lobby per-card profile fetches for premium/photo verification card badges.
- Updated shared deck adapter parsing and generated Supabase RPC types.
- Added web `deckCardUrl` and made full lobby cards use the full-card preset.
- Documented forbidden fields and media fallback order.

## Files Changed

- `supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql`
- `supabase/validation/event_lobby_deck_payload_media.sql`
- `supabase/validation/event_lobby_ready_queue_contract.sql`
- `supabase/functions/_shared/eventProfileAdapters.ts`
- `src/components/lobby/LobbyProfileCard.tsx`
- `src/components/ui/ProfilePhoto.tsx`
- `src/utils/imageUrl.ts`
- `src/integrations/supabase/types.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `shared/matching/eventLobbyDeckPayloadMedia.test.ts`
- `scripts/run_hardening_contract_tests.sh`
- `docs/contracts/event-lobby-deck-payload-contract.md`
- `docs/audits/event-lobby-deck-payload-media-verification.md`
- `docs/branch-deltas/fix-event-lobby-deck-payload-media.md`
- `docs/active-doc-map.md`

## Migrations

Added:

- `20260501230000_event_lobby_deck_payload_media.sql`

No destructive data changes. Historical migrations are untouched.

## Edge Functions

None changed.

## Rebuild Delta

`get_event_deck` return shape changed and generated Supabase types were updated. Web/native Event Lobby card adapters now consume the shared safe payload shape.

## Rollback Plan

Use a forward migration restoring the previous `get_event_deck` return shape from `20260501225000_event_lobby_ready_queue_contract.sql`, then revert the client adapter usage. Do not edit historical applied migrations.

## Out Of Scope

- No swipe behavior changes.
- No Event Lobby UI redesign beyond media/payload correctness.
- No arbitrary per-card profile field fetching.
- No Edge Function deploy.
