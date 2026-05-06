# RHRN Architecture Report

**Feature:** Right Here Right Now
**Abbreviation:** RHRN
**Status:** Sprint 0 architecture handoff, docs only
**Runtime impact:** none
**Source of truth:** `_cursor_context/rhrn_product_module_spec.md`

## Executive Summary

Right Here Right Now is Vibely's live, consent-based vicinity discovery room. It shows people who are open to connect in the same eligible RHRN vicinity while participating in RHRN. It is not a map, tracker, swipe deck, or generic chat room.

RHRN must be implemented as a bounded plug-in module. It should own its own tables, functions, state machine, screens, settings, admin config, rollout gates, Google Places boundary, stats, and QA surface. Core Vibely should be touched only through explicit adapters for profiles, entitlements, credits, blocks/reports, matches/messages, notifications, admin, and provider configuration.

No exact distance, nearby counts, map pins, or raw coordinates may be returned to clients. Physical RHRN requires fresh foreground precise/current location. Web remains the product, visual, and behavior source of truth for native parity.

## Locked Product Placement

| Surface | Placement |
| --- | --- |
| Web route | `/rhrn` |
| Bottom nav order | Now / Events / RHRN / Matches / You |
| Tab label | RHRN |
| Screen title | Right Here Right Now |
| Web route insertion | `src/App.tsx`, `src/lib/routePreload.ts`, `src/components/navigation/BottomNav.tsx` |
| Native tab insertion | `apps/mobile/app/(tabs)/_layout.tsx`, new `apps/mobile/app/(tabs)/rhrn` |
| Web settings insertion | Settings near Privacy / Discovery |
| Native settings insertion | `/settings/rhrn`, row near Privacy / Discovery |
| Admin insertion | `AdminDashboard` and `AdminSidebar`, preferably after Events or Tier Config |

Native currently labels the `/matches` tab as `Vibe`. RHRN implementation should align the product nav to Now / Events / RHRN / Matches / You carefully, without breaking the existing matches route or chat deep-link behavior.

## Bounded Context

RHRN owns:

- session lifecycle: Off, Live, Active recently, Teleported, Expired, Manual off, Admin ended
- foreground physical presence and Teleport presence
- live and Active recently expiry
- RHRN visibility fields and geospatial visibility decisions
- RHRN-only Hide Profile
- RHRN Vibes, Vibe Notes, expiry, cooldowns, and request ordering
- RHRN match context after mutual Vibe
- Teleport and At/Around mode
- RHRN Place Memory, place stats, and Google Places provider usage
- RHRN settings, admin config, stats, rollout cohorts, and kill switches

Core Vibely owns:

- auth, identity, profile records, and public profile rendering
- subscription tier and entitlement source of truth
- global block/report/suspension/account-pause state
- canonical matches, messages, chat routing, and chat notifications
- existing Events, Daily Drop, video-date, and Event Lobby systems
- notification preferences, OneSignal delivery, quiet hours, mutes, logs
- Stripe and RevenueCat purchase settlement
- admin auth and role checks

RHRN must not:

- reuse Event Lobby cards, deck, swipe, pass, or event queue logic as RHRN business logic
- reuse `get_visible_events` or event registration location for live proximity
- use profile city or saved `profile.location_data` as physical RHRN fallback
- create a parallel chat or match system
- expose Google Places keys to web or native clients
- change Core Vibely behavior while RHRN is disabled

## Core Vibely Touchpoint Map

| Touchpoint | RHRN usage | Boundary rule |
| --- | --- | --- |
| Profiles | Read card/full-profile fields, photos, verification, prompts, dating preferences, account eligibility | Use adapter/query shape that suppresses `distance_label` and does not import Event Lobby card state |
| Subscription tier / entitlements | Derive Free/Premium/VIP radius, Vibe Note allowance, Teleport allowance | Server derives tier and config; client tier state is presentation only |
| RHRN credits and allowances | Track banked Vibe Note and Teleport credits plus rolling allowance usage | Use RHRN-specific ledger/balances; do not extend legacy video-date credit mutation paths |
| Global block/report/suspension/account pause | Exclude unsafe or ineligible users and suppress notifications | Server-side enforcement in every grid/vibe/notification path |
| Match creation/restoration | Mutual RHRN Vibe creates or restores canonical Vibely match | Backend returns `other_user_id` and context for `/chat/:otherUserId` |
| Messages/chat banner/first message | Add RHRN origin banner and accepted Vibe Note first message | No direct pre-match chat; banner never discloses distance/place/Teleport |
| messages/chat banner | Implementation shorthand for the same chat touchpoint | Backend returns `other_user_id` and safe RHRN match context for `/chat/:otherUserId` |
| Notifications/preferences | Add RHRN categories and preference UI | Unknown categories currently fail closed; add categories before sending |
| notifications/preferences | Implementation shorthand for RHRN notification category and preference work | Respect quiet hours, category toggles, hidden/block/report suppression, and no-note-text push rules |
| Admin | Config, kill switches, rollout, stats, provider usage, moderation insight | Admin functions verify admin role; stats never expose raw user coordinates |
| Google Places provider | Backend-only place search/resolve and Place Memory | `GOOGLE_PLACES_API_KEY` is Supabase Edge secret only |
| Stripe/RevenueCat | Sell and settle RHRN consumable credits | RHRN consumables must not create subscription rows |

## Session and Visibility Model

Opening RHRN starts or refreshes a session after first-time education and location permission are complete. Default live duration is 60 minutes. Every RHRN screen check refreshes `live_expires_at`.

Manual off:

- immediately removes grid access
- stops live location refresh
- transitions the user into Active recently for 30 minutes by default
- keeps the user visible and able to receive Vibes/Vibe Notes during Active recently
- then expires to Off

Default RHRN fields:

| Tier | Field |
| --- | ---: |
| Free | 40 meters |
| Premium | 70 meters |
| VIP | 100 meters |

Visibility rule:

```text
Two users can see each other when either user's RHRN field reaches the other,
subject to safety, eligibility, preference, and participation filters.
```

Implementation recommendation:

- Enable PostGIS/geography in Sprint 1 and use meter-based indexes/functions for RHRN.
- Keep the existing scalar `haversine_distance` as event-oriented legacy logic, not the primary RHRN design.
- If PostGIS cannot be enabled immediately, document an indexed bounding-box prefilter plus server-side final distance check as a temporary fallback only.

## Product Actions

Relationship tags:

- current match: Matched
- prior real two-sided connection with no current match: Met before
- fresh/passive exposure/event lobby pass/prior ignored RHRN Vibe: no relationship tag
- Matched beats Met before

Presence chips:

- recently active: Active recently
- Teleport presence: Teleported
- presence chips are separate from relationship tags
- maximum two visible chips on a card

CTAs:

| Candidate state | CTA |
| --- | --- |
| Current match | Message |
| Fresh | Vibe |
| Met before | Vibe |
| Incoming Vibe | View profile / Vibe back / Not now |
| Outgoing Vibe | Vibe sent |

There is no Pass button, no deck-style rejection flow, no read receipts, and no sender-visible seen/ignored state.

## Vibe Notes and Teleport

Vibe Note:

- a 140-character note attached to a Vibe request
- not open messaging
- Free: 0 included per rolling 24h
- Premium: 1 included per rolling 24h
- VIP: 3 included per rolling 24h
- purchased Vibe Note credits are banked
- subscription allowances do not roll over
- if accepted, the note becomes the first chat message after the RHRN match banner

Teleport:

- label: Teleported
- default duration: 60 minutes
- Free/Premium: 0 included per week, purchasable
- VIP: 1 included per rolling week, purchasable extras
- uses selected Google Places-backed place plus tier field
- no arbitrary pin in v1
- default place mode is Around
- chat banner after mutual match must not mention Teleport

## Google Places Architecture

Clients call Vibely backend functions only:

- `rhrn-place-search`
- `rhrn-place-resolve`

Provider key:

- `GOOGLE_PLACES_API_KEY`
- Supabase Edge secret only
- never `VITE_*`
- never `EXPO_PUBLIC_*`

Search sequence:

```text
client query
-> backend checks RHRN Place Memory
-> fresh match returns normalized Vibely result
-> missing/stale match calls Google Places with strict field masks
-> user selects candidate
-> backend resolves minimal fields
-> backend stores allowed Place Memory snapshot and usage stats
-> Teleport or At/Around session starts
```

Durable RHRN data:

- Google Place ID where allowed
- Vibely place id
- first/last selected timestamps
- place status and admin block/review state
- Vibely-owned aggregate usage stats

TTL/careful cache data:

- display name
- address/short address
- lat/lng snapshot
- types/primary type
- business status if needed

Do not store in v1:

- photos
- reviews
- ratings
- phone numbers
- opening hours
- websites
- rich Google metadata

Show Powered by Google attribution where Google search results are displayed.

## Production Safety

RHRN must be disabled by default and fail closed from the backend. Client hiding is not sufficient because native route files cannot be hot-removed after release.

Minimum kill switches:

- `rhrn_enabled`
- `rhrn_grid_enabled`
- `rhrn_vibes_enabled`
- `rhrn_vibe_notes_enabled`
- `rhrn_teleport_enabled`
- `rhrn_google_places_enabled`
- `rhrn_notifications_enabled`

Rollout sequence:

1. schema/functions deployed, disabled globally
2. admin panel enabled for admins only
3. route/screen visible only to admins and rollout users
4. selected internal test users
5. one city/country
6. launch area
7. subfeatures enabled separately

## Production Risks

- Location leakage if raw `rhrn_presence_locations` is readable by clients.
- Core behavior drift if RHRN code is imported into Events, Matches, Chat, Profile, or Settings without adapter boundaries.
- False safety confidence if route/nav hiding is treated as the authority instead of backend config checks.
- Notification suppression failures if RHRN categories are sent before preference columns/mapping are added.
- Payment corruption if RHRN consumables are settled through subscription rows or legacy video-date credit mutation paths.
- Google compliance risk if rich Places metadata is cached indefinitely.
- Native parity drift if web behavior is not treated as source of truth and native uses profile-location helpers.

## Open Questions

- Exact RHRN credit table names should be finalized in Sprint 1 after reviewing the current Stripe/RevenueCat settlement branch shapes.
- Exact PostGIS migration shape should be validated against the live Supabase project before cloud deployment.
- Exact notification preference column names should follow the current `notify_*` naming convention when Sprint 10 lands.
- RHRN moderation text filters for optional tags and Vibe Notes need final policy thresholds before enforcement work.
