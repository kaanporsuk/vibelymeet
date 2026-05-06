# RHRN Edge Functions and RPCs

**Status:** Sprint 0 proposal
**Runtime impact:** none
**Rule:** all RHRN behavior must fail closed when disabled

## Function Auth Posture

| Function family | Gateway posture | In-function posture |
| --- | --- | --- |
| Authenticated user functions | `verify_jwt = true` | Resolve user from JWT, read DB-backed RHRN config first |
| Admin functions | `verify_jwt = true` | Verify admin role through existing admin role pattern |
| Cleanup/cron functions | `verify_jwt = false` only if needed | Require `CRON_SECRET` or equivalent bearer secret |
| Provider webhooks | not expected in RHRN v1 | If added later, use provider signature/secret and fail closed |

Every `rhrn-*` function must:

1. load RHRN config from DB
2. verify `rhrn_enabled` and relevant subfeature flag
3. verify caller auth/role/rollout eligibility
4. perform server-side safety and entitlement checks
5. return sanitized payloads only

`supabase/config.toml` must be updated in implementation sprints for every new function. Sprint 0 does not add function directories or config entries.

## Proposed User Functions

### `rhrn-get-config`

Purpose:

- return public/sanitized config needed by clients
- include enabled/disabled state, rollout eligibility, copy switches, UI affordance flags, and max note length

Must not return:

- sensitive provider config
- Google Places key
- private rollout notes
- admin-only stats

Disabled behavior:

- returns `enabled: false` plus safe disabled reason

### `rhrn-open-or-refresh`

Purpose:

- start or refresh a physical RHRN session
- validate foreground precise/current location payload
- set `live_expires_at = now + configured session duration`
- write session/presence state

Input:

- `lat`
- `lng`
- `accuracy_meters`
- `timestamp`
- `platform`
- optional RHRN tag

Server checks:

- global and grid flags
- user rollout/tier eligibility
- account active/not paused/not suspended
- location freshness and accuracy threshold
- no profile city or event registration fallback
- tier radius from server config

Output:

- session id
- state
- live expiry
- active recently expiry if relevant
- sanitized status summary

Must not output:

- raw persisted location
- nearby count
- exact radius decision details for other users

### `rhrn-turn-off`

Purpose:

- manual off
- remove grid access immediately
- stop live refresh
- transition to Active recently for configured duration

Output:

- state summary
- active recently expiry

### `rhrn-nearby-grid`

Purpose:

- return sanitized RHRN grid cards
- order by incoming Vibes, outgoing Vibes, Live users, Active recently users

Server checks:

- viewer has valid grid participation state
- all feature flags and rollout gates
- account safety, block/report/suspension/pause/deletion
- RHRN hides in either direction
- dating preference compatibility
- tier radius visibility rule
- candidate participation state
- pending/request context

Payload must include:

- candidate profile card fields
- relationship tag: `matched`, `met_before`, or none
- presence chip: `active_recently`, `teleported`, or none
- CTA state
- sanitized pending Vibe summary where relevant

Payload must not include:

- lat/lng
- exact distance
- nearby count
- raw location object
- hidden/blocked candidate hint
- map pin data

### `rhrn-update-tag`

Purpose:

- update optional "right-now vibe" tag/message while Live or Teleported

Rules:

- optional
- RHRN-only
- max length admin-configured
- moderation filters for links, handles, phone numbers, unsafe content if enabled

### `rhrn-hide-profile`

Purpose:

- create an active RHRN-only Hide Profile edge from hider to hidden
- invalidate pending RHRN Vibes/Notes between the pair
- suppress future RHRN notifications between the pair

Core behavior:

- existing match/chat/events remain unaffected

### `rhrn-unhide-profile`

Purpose:

- deactivate a user's own RHRN hide
- restore only potential eligibility; all other filters still apply

### `rhrn-list-hidden-profiles`

Purpose:

- return static hidden profile previews for Manage hidden profiles

Must not show:

- live status
- distance
- RHRN tag
- current place
- nearby hints

### `rhrn-send-vibe`

Purpose:

- send a Vibe request to an eligible Fresh or Met-before candidate
- optionally attach a Vibe Note

Server checks:

- `rhrn_vibes_enabled`
- sender is Live or Teleported and has grid access
- receiver is Live, Active recently, or Teleported
- pair visibility was valid at send time
- no current match requiring Message instead
- no active cooldown
- no hide/block/report/safety exclusion
- Vibe Note allowance/credit if note exists
- note moderation and max length

Consumption rule:

- consume Vibe Note allowance/credit only after successful Vibe Note delivery/persistence
- do not consume on server rejection

### `rhrn-respond-vibe`

Purpose:

- handle `vibe_back` or `not_now`

`vibe_back`:

- validate request is still valid
- create or restore normal Core Vibely match atomically
- create `rhrn_match_context`
- convert accepted Vibe Note into first chat message after banner
- return `other_user_id`, match id/context, and deep link target for `/chat/:otherUserId`

`not_now`:

- mark request as not now
- no sender notification
- apply seen cooldown if seen

### `rhrn-mark-vibe-seen`

Recommendation:

- keep explicit if the UI needs View Profile to mark seen before response
- otherwise mark seen implicitly when incoming card/profile is opened

Do not expose seen/read status to sender.

### `rhrn-place-search`

Purpose:

- backend-only Google Places-backed search
- Place Memory first, Google fallback

Input:

- query
- optional coarse/bias context
- Google session token reference generated client-side or backend-side, but stored hashed
- requested mode context: Teleport, At, Around

Rules:

- require `rhrn_google_places_enabled`
- rate-limit by user and IP where possible
- check Place Memory first
- call Google only on miss/stale
- use strict field masks
- log usage/cost event
- reject or label unsupported/private/sensitive/address-only results
- return Powered by Google attribution flag when Google results are shown

### `rhrn-place-resolve`

Purpose:

- resolve selected candidate to minimal place fields
- store/update Place Memory
- update selection/provider stats
- enforce At/Around eligibility rules

At:

- explicit check-in
- require eligible public venue/POI

Around:

- privacy-preserving area anchor
- allow eligible public places plus city/region/area anchors

### `rhrn-start-teleport`

Purpose:

- start Teleport session from resolved place and At/Around mode

Server checks:

- `rhrn_teleport_enabled`
- valid resolved RHRN place
- no arbitrary pin
- entitlement/allowance/credit
- tier radius from server config
- duration from server config

Output:

- Teleport state
- expires_at
- sanitized place display

### `rhrn-extend-teleport`

Purpose:

- extend active Teleport using configured extension duration and credit/purchase rules

Rules:

- consume extension credit idempotently
- no extension if feature disabled or Teleport already ended

### `rhrn-end-teleport`

Purpose:

- manually end Teleport and update session/presence state

## Maintenance and Admin Functions

### `rhrn-cleanup-expired`

Purpose:

- transition expired Live sessions to Active recently
- transition expired Active recently and Teleport sessions to Off/expired
- expire pending Vibes and apply seen/unseen cooldown states
- enqueue safe Teleport ending notifications if Sprint 10 has landed

Auth:

- prefer service-only SQL/cron path
- if public Edge Function, `verify_jwt = false` with `CRON_SECRET`

### `rhrn-admin-config`

Purpose:

- read/write admin config
- manage rollout users/cohorts
- write config audit rows

Auth:

- `verify_jwt = true`
- verify admin role inside function

### `rhrn-admin-stats`

Purpose:

- return aggregate RHRN operational stats
- include Place Memory hit rate, provider usage, Vibe conversion, Teleport usage, hides/reports, and match conversion

Must not return:

- raw user coordinates
- live user coordinate list
- public heatmaps
- sensitive provider secrets

## RPC vs Edge Function Boundary

Recommended split:

- Use Edge Functions as the public API surface for clients.
- Use SECURITY DEFINER SQL functions for atomic visibility, match creation/restoration, credit spend, and cooldown transitions.
- Keep all SQL functions RHRN-prefixed where they implement RHRN business logic.
- Do not let clients call raw SQL functions that expose coordinates or bypass feature flags.

## Notification Model

Required RHRN categories:

- `rhrn_vibe`
- `rhrn_vibe_note`
- `rhrn_match`
- `rhrn_teleport_expiring`

Implementation notes:

- Add preference columns/UI before any sends because `send-notification` rejects unknown categories.
- Respect master push toggle, quiet hours, paused state, category toggles, mutes, hidden/block/report exclusions, and account state.
- Do not include Vibe Note text in push body.
- Do not include counts, distances, or place-level hints.

Push copy:

| Category | Body |
| --- | --- |
| Incoming RHRN Vibe | `{name} vibed you on RHRN.` |
| Incoming RHRN Vibe Note | `{name} vibed you on RHRN.` |
| RHRN match | `You matched on RHRN.` |
| Teleport ending soon | `Your Teleport is ending soon.` |

Deep links:

- incoming Vibe/Vibe Note: `/rhrn`
- RHRN match: `/chat/:otherUserId`
- Teleport ending soon: `/rhrn`

## Payment and Credit Model

Web Stripe:

- add an RHRN credit pack branch to the existing checkout/settlement model
- identify product family as `rhrn_credits_pack`
- settle into `rhrn_credit_ledger` and `rhrn_credit_balances`
- use source event id/idempotency key from Stripe event/session

Native RevenueCat:

- classify RHRN consumables/non-renewing products separately from subscriptions
- do not create or update subscription rows for RHRN consumables
- settle provider events into the same RHRN ledger with idempotency key

Admin grants:

- grant through admin function/panel
- write ledger entries with `source = admin_grant`
- never mutate balances without a ledger row

Concurrency:

- spend credits in a transaction
- lock balance row or use atomic update with sufficient-balance predicate
- idempotency key required for every provider settlement and spend

## Google Places Provider Model

Secret/env:

- `GOOGLE_PLACES_API_KEY`
- Supabase Edge secret only
- add to provider docs/secrets inventory during implementation
- no frontend or native env var

Cost controls:

- debounce client search
- minimum query length
- per-user/hour rate limit
- daily budget config
- Place Memory first
- strict Google field masks
- log cache hit/miss and latency
- return capped result count
- use session tokens for autocomplete/resolve cost control where supported

Allowed/blocked results:

- block address-only/private-ish results for Teleport/At
- block sensitive categories by config
- allow eligible public venues/POIs for At
- allow eligible public places and city/region/area anchors for Around

Docs affected later:

- Edge Function manifest
- Supabase provider sheet
- external dependency ledger/provider sheet for Google Places
- env/secrets inventory
- rebuild runbook
- machine-readable inventory

## Sanitized Card Payload Contract

Recommended shape:

```ts
type RhrnGridCard = {
  user_id: string;
  display_name: string;
  age: number | null;
  photo_url: string | null;
  photos: string[];
  photo_verified: boolean;
  relationship_tag: "matched" | "met_before" | null;
  presence_chip: "active_recently" | "teleported" | null;
  chips: Array<"matched" | "met_before" | "active_recently" | "teleported">;
  cta: "message" | "vibe" | "vibe_back" | "not_now" | "vibe_sent";
  pending_vibe_id?: string;
  rhrn_tag?: string | null;
  place_context?: { mode: "at" | "around"; label: string | null } | null;
};
```

Forbidden fields:

- `lat`
- `lng`
- `location_data`
- `distance`
- `distance_meters`
- `distance_label`
- `nearby_count`
- `exact_place`
- `teleport_disclosed_in_chat`
