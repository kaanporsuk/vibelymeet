# Event Lobby Deck Payload Contract

Date: 2026-05-01
Scope: `get_event_deck`, web `LobbyProfileCard`, native Event Lobby card.

## Canonical Surface

`get_event_deck(uuid, uuid, integer)` is the canonical Event Lobby card payload for web and native. Clients must not fetch arbitrary `profiles` columns per card to render premium or verification affordances.

The backend remains responsible for event-active gating, registration eligibility, safety/discoverability filters, and busy-user filtering.

## Safe Payload

The deck may return only viewer-safe rendering fields:

- `profile_id`
- `name`
- `age`
- `gender`
- `avatar_url`
- `photos`
- `primary_photo_path`
- `about_me`
- `job`
- `location`
- `height_cm`
- `tagline`
- `looking_for`
- `queue_status`
- `availability_state`
- `photo_verified`
- `premium_badge`
- `media_version`
- `has_met_before`
- `is_already_connected`
- `has_super_vibed`
- `shared_vibe_count`

`premium_badge` is display-only and limited to `premium`, `vip`, or `null`; clients should not receive billing dates or admin grant metadata in the deck.

`availability_state` is currently `available` for returned cards because Prompt 4 hides busy/non-swipeable candidates backend-side.

`media_version` is a viewer-safe freshness token derived from profile update time. Clients use it only to cache-bust deck-card image URLs and prefetch keys; it must not expose private media metadata.

## Media Fallback

Both platforms should resolve card media in this order:

1. first valid `photos[]` entry
2. `avatar_url`
3. placeholder/initials fallback

Web full-card lobby imagery uses a deck-card image preset, not a thumbnail-sized transform. Native already uses `deckCardUrl` for the same purpose.

Predictive deck prefetch and rendered card URLs should include `media_version` so cached images refresh after profile media changes.

## Forbidden Fields

The deck must not return:

- proof selfie URLs or storage paths
- private verification artifacts
- moderation fields
- suspension reasons
- report/block internals
- phone or email PII
- private contact info
- `photo_verified_at`
- `premium_until`
- admin grant metadata

## Client Expectations

Web and native should render `photo_verified`, `premium_badge`, and `primary_photo_path` from the deck payload. A full profile route may fetch its own authorized profile view, but Event Lobby cards should not issue per-card profile fetches just to decorate the card.
