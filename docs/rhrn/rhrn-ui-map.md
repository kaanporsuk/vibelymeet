# RHRN UI Map

**Status:** Sprint 0 proposal
**Runtime impact:** none
**Source of truth:** web behavior first, native parity second

## Global Placement

Web:

- route: `/rhrn`
- route insertion: `src/App.tsx`
- route preload insertion: `src/lib/routePreload.ts`
- bottom nav insertion: `src/components/navigation/BottomNav.tsx`
- nav order: Now / Events / RHRN / Matches / You
- screen title: Right Here Right Now

Native:

- tab insertion: `apps/mobile/app/(tabs)/_layout.tsx`
- new screen directory: `apps/mobile/app/(tabs)/rhrn`
- nav order: Now / Events / RHRN / Matches / You
- align current `Vibe` label on `matches` to product `Matches` naming carefully
- no unsupported native modules
- no background location

Settings:

- RHRN screen gear
- web Settings near Privacy / Discovery
- native `/settings/rhrn` row near Privacy / Discovery

Admin:

- `AdminDashboard`
- `AdminSidebar`
- preferred placement after Events or Tier Config

## Web `/rhrn` Screen

Primary states:

- disabled by admin
- not eligible / not in rollout
- first-time education
- location permission needed
- permission denied
- weak accuracy
- loading/refreshing session
- Live grid
- Active recently after manual off, no grid access
- Off
- Teleported
- empty eligible grid
- error/retry

On open:

1. check DB-backed RHRN config and rollout eligibility
2. show first-time education if not completed
3. request foreground precise/current location for physical RHRN
4. call `rhrn-open-or-refresh`
5. render sanitized grid from `rhrn-nearby-grid`

Do not show:

- map
- pins
- nearby counts
- exact distance
- raw coordinates
- tracker-like copy

## First-Time Education

Purpose:

- explain that RHRN is live and consent-based
- explain exact distance/location are never shown
- explain opening RHRN starts/refreshes the live window
- explain manual off removes grid access but leaves Active recently visibility for the configured window
- explain Hide Profile, Block, and Report distinction

UX:

- concise modal or first-screen panel
- primary action asks for location only after education
- no marketing landing page before the tool

## Permission and Accuracy States

Web:

- browser geolocation requires secure context
- denied state explains browser/site setting path
- weak accuracy state asks user to retry from current location
- no fallback to profile city or event location

Native:

- use existing `expo-location` foreground permission dependency
- request foreground permission only
- preserve `lat`, `lng`, `accuracy_meters`, `timestamp`, and `platform`
- detect permission revoked on foreground/resume
- no background permission request
- do not call profile-location update helpers for RHRN

## Main Grid

Ordering:

1. people who vibed you
2. people you vibed
3. Live users
4. Active recently users

Card content:

- primary photo
- name
- age
- verification badge
- optional RHRN tag/message
- relationship tag
- presence chip
- CTA

Maximum two visible chips:

- relationship tag counts separately from presence chip
- Matched beats Met before
- Active recently and Teleported are presence chips

Empty state:

- no nearby count
- no distance language
- reassure that RHRN changes as people join
- offer refresh/check again and Teleport only if enabled

## Card States

| State | Relationship/presence | CTA |
| --- | --- | --- |
| Current match | Matched | Message |
| Prior real connection | Met before | Vibe |
| Fresh | no relationship tag | Vibe |
| Candidate Active recently | Active recently chip | Vibe or Message depending relationship |
| Candidate Teleported | Teleported chip | Vibe or Message depending relationship |
| Incoming Vibe | request state visible | View profile / Vibe back / Not now |
| Outgoing Vibe | pending state visible | Vibe sent |

No Pass button and no deck-style rejection flow.

## Full Profile Opening

Every visible RHRN card can open the full profile.

Recommended reuse:

- reuse profile/full-profile surfaces where safe
- suppress `distance_label` and location proximity labels everywhere in RHRN
- keep RHRN-specific actions in an adapter/footer

Avoid:

- Event Lobby profile cards/deck components as business logic
- any component that assumes swipe/pass/nope semantics
- any profile renderer that exposes exact or approximate distance without an explicit RHRN suppression prop

Full profile actions:

- Message for current matches
- Vibe for Fresh/Met-before
- Vibe back / Not now for incoming Vibe
- Hide Profile
- Block
- Report

## Tag Info Popovers

Full profile tags/chips include info popovers that auto-disappear after a few seconds.

Copy:

Matched:

```text
You already have a Vibely match with this person.
```

Met before:

```text
You previously connected through a Vibely moment.
```

Teleported:

```text
This person used Teleport to join this place on RHRN for a limited time.
```

Active recently:

```text
This person was recently live on RHRN here.
```

## Vibe Flow

Fresh and Met-before users:

- primary CTA: Vibe
- optional Vibe Note entry if eligible or banked credit exists
- confirmation: `Vibe sent. If they vibe back, you'll match.`

Incoming Vibe:

- appears at top of grid
- actions: View profile, Vibe back, Not now
- if note exists, show note inside incoming request card

Vibe back:

- backend creates/restores Core Vibely match
- creates RHRN match context
- accepted note becomes first chat message after banner
- navigates to `/chat/:otherUserId`

Not now:

- request disappears
- sender is not notified
- no sender-visible rejection/ignored/seen state
- 7-day same-target cooldown if seen

## Vibe Note Flow

UI language:

```text
Add a note to your Vibe
```

Do not call it:

```text
Send first message
```

Rules:

- max 140 characters by default
- show included allowance and banked balance in RHRN Settings
- Free has no included note allowance
- Premium has 1 per rolling 24h
- VIP has 3 per rolling 24h
- purchased credits are banked
- subscription allowance does not roll over

Push body must not include note text.

## RHRN Settings

Entry points:

- gear on RHRN screen
- global Settings -> RHRN
- native Settings -> RHRN

Rows/sections:

- How RHRN works
- Current status
- Manage hidden profiles
- Location permission status
- RHRN notification preferences
- Vibe Note balance
- Teleport balance
- Teleport purchase/extension entry
- At/Around explanation
- Privacy explanation

Current status should explain Live, Active recently, Teleported, or Off without showing exact location.

## Manage Hidden Profiles

List content:

- static profile preview
- unhide action

Must not show:

- live status
- RHRN tag
- distance
- current place
- nearby hint
- Teleport chip

## Teleport Flow

Entry:

- RHRN screen action if enabled
- RHRN Settings balance/purchase row

Flow:

1. search place
2. backend returns Place Memory/Google candidates
3. UI displays Powered by Google where Google results are shown
4. select result
5. backend resolves place
6. choose At this place or Around this place
7. default Around
8. start Teleport

At:

- explicit check-in
- eligible public venue/POI only

Around:

- privacy-preserving area anchor
- eligible public places plus city/region/area anchors

No arbitrary pin in v1.

## Admin Panel

RHRN admin panel should include:

- global/subfeature kill switches
- rollout cohorts/users
- tier radii
- session durations
- Active recently durations
- request expiry
- cooldowns
- Vibe Note allowances/max length/packs
- Teleport allowances/durations/extensions/packs
- Google Places controls, TTL, limits, type filters, budget
- accuracy/freshness thresholds
- notification toggles
- ranking weights
- place stats
- provider usage stats
- Vibe and match conversion stats
- hides/reports summary

Admin UI must not expose raw live coordinates or a live user map.

## Responsive and Native Parity Notes

Web desktop:

- dense but cinematic grid
- profile drawer/sheet can use wider layout
- no map-like layout

Web mobile:

- bottom nav safe area
- single-column cards or compact grid
- touch-safe actions
- no hover-only controls

iOS/Android:

- foreground location permission copy must mention RHRN live/local discovery
- respect safe areas and Android back
- avoid `expo-av`
- do not request background location
- retry accuracy flow should be obvious and non-scary

Design:

- Neon Noir visual language
- dark cinematic surfaces
- violet/pink accents
- capsule/pill chips
- premium profile cards
- no generic map-app styling
