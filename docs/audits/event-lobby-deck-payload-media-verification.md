# Event Lobby Deck Payload Media Verification

Date: 2026-05-01
Branch: `fix/event-lobby-deck-payload-media`

## Dependency Verification

- Prompt 1 active-event contract: merged on `main` in `22d30191e`.
- Prompt 2 swipe idempotency/notification dedupe: merged on `main` in `29943772f`.
- Prompt 3 web EventLobby gating: merged on `main` in `5a5a24de9`.
- Prompt 4 Ready Gate / queue contract: merged on `main` in `4cac3cae`.
- Supabase project ref: `schdyxcunwcvddlcshwd`.
- Remote latest migration before patch: `20260501225000`.
- Pre-patch dry-run: `supabase db push --linked --dry-run` reported the remote database was up to date.

## Audit Findings

- `get_event_deck` returned the core card fields, but not `photo_verified`, premium display state, or a normalized primary media field.
- Web `LobbyProfileCard` performed a per-card `profiles` fetch for `subscription_tier` and `photo_verified`.
- Native Event Lobby performed a per-card `get_profile_for_viewer` RPC for `photo_verified`.
- Web `ProfilePhoto` used the first array slot directly and used the thumbnail preset for full-card lobby images. If `photos[0]` was empty or invalid, avatar fallback could be skipped.
- Native already had a full-card `deckCardUrl` preset and used `resolvePrimaryProfilePhotoPath`, but it still needed the shared deck payload fields.

## Patch Summary

- Added migration `20260501230000_event_lobby_deck_payload_media.sql`.
- Recreated `get_event_deck` with the Prompt 4 active/busy filters and four safe additions:
  - `primary_photo_path`
  - `photo_verified`
  - `premium_badge`
  - `availability_state`
- Updated the shared deck adapter to parse the additions, sanitize photo paths, and ignore unknown premium badge values.
- Removed web/native per-card profile fetches for card badges.
- Added web `deckCardUrl` preset and made full lobby cards use it.
- Made web photo fallback resolve first valid `photos[]` entry, then avatar, then placeholder.
- Updated generated Supabase types for the changed RPC return shape.

## Security Boundary

The deck payload intentionally excludes proof selfie URLs, private verification artifacts, moderation fields, suspension reasons, report/block internals, phone/email PII, `photo_verified_at`, `premium_until`, and admin grant metadata.

`premium_badge` is display-only and limited by clients to `premium`/`vip`; unknown values are ignored.

## Rebuild Delta

Backend contract:

- `get_event_deck(uuid, uuid, integer)` return shape changed.
- New fields are additive for clients, but generated TypeScript types were updated.
- Supabase migration deployment is required after merge.

Web/native contract:

- Event Lobby cards should render premium/photo verification/media from the deck payload.
- Event Lobby cards should not perform per-card profile fetches for `subscription_tier` or `photo_verified`.
- Full-card web image URLs use `deckCardUrl` rather than thumbnail transforms.

No Edge Function, route, provider, or environment variable changed.

## Validation Plan

- `npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts`
- `npx tsx shared/profilePhoto/resolvePrimaryProfilePhotoPath.test.ts`
- `npm run test:hardening-contracts`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `supabase db push --linked --dry-run`
- Post-deploy: `supabase/validation/event_lobby_deck_payload_media.sql`

## Validation Results

- `npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts`: passed, 10 tests.
- `npx tsx shared/profilePhoto/resolvePrimaryProfilePhotoPath.test.ts`: passed, 4 tests.
- `npm run test:hardening-contracts`: passed, including the new deck payload/media contract test.
- `npm run typecheck`: passed.
- `npm run build`: passed with existing Vite dynamic-import and chunk-size warnings.
- `npm run lint`: exited 0 with the repository's existing warning backlog.
- `supabase db push --linked --dry-run`: clean; would apply only `20260501230000_event_lobby_deck_payload_media.sql`.
