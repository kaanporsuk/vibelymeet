# RHRN Rollout and QA Plan

**Status:** Sprint 0 proposal
**Runtime impact:** none
**Rollout principle:** disabled by default, backend fail-closed

## Feature Flags and Kill Switches

Minimum DB-backed config keys:

- `rhrn_enabled`
- `rhrn_grid_enabled`
- `rhrn_vibes_enabled`
- `rhrn_vibe_notes_enabled`
- `rhrn_teleport_enabled`
- `rhrn_google_places_enabled`
- `rhrn_notifications_enabled`

Rollout gates:

- `rhrn_enabled_for_admins_only`
- `rhrn_enabled_for_free`
- `rhrn_enabled_for_premium`
- `rhrn_enabled_for_vip`
- `rhrn_enabled_countries`
- `rhrn_enabled_cities`
- rollout cohort/user membership

Hard invariants are not admin-overridable:

- no exact distance shown
- no counts shown
- no raw lat/lng returned to users
- no map pins
- no direct chat before mutual Vibe unless already matched
- Hide Profile excludes both users from each other on RHRN
- Block is global
- Report protects/separates while active
- RHRN grid access requires valid participation state
- client cannot decide radius, entitlement, cooldown, or visibility

## Admin Config Keys

Radius:

- `rhrn_radius_free_meters = 40`
- `rhrn_radius_premium_meters = 70`
- `rhrn_radius_vip_meters = 100`

Sessions:

- `rhrn_session_duration_free_minutes = 60`
- `rhrn_session_duration_premium_minutes = 60`
- `rhrn_session_duration_vip_minutes = 60`
- `rhrn_active_recently_free_minutes = 30`
- `rhrn_active_recently_premium_minutes = 30`
- `rhrn_active_recently_vip_minutes = 30`

Requests:

- `rhrn_request_expiry_minutes = 60`
- `rhrn_same_target_seen_cooldown_days = 7`
- `rhrn_same_target_unseen_cooldown_hours = 24`

Vibe Notes:

- `rhrn_vibe_note_free_per_24h = 0`
- `rhrn_vibe_note_premium_per_24h = 1`
- `rhrn_vibe_note_vip_per_24h = 3`
- `rhrn_vibe_note_max_chars = 140`
- `rhrn_vibe_note_purchasable = true`
- Vibe Note credit pack definitions

Teleport:

- `rhrn_teleport_free_included_per_week = 0`
- `rhrn_teleport_premium_included_per_week = 0`
- `rhrn_teleport_vip_included_per_week = 1`
- `rhrn_teleport_duration_minutes = 60`
- `rhrn_teleport_extension_enabled = true`
- Teleport and extension credit pack definitions

Google Places:

- `rhrn_google_places_cache_ttl_days`
- `rhrn_google_places_max_requests_per_user_per_hour`
- `rhrn_google_places_daily_budget_limit`
- `rhrn_google_places_allowed_place_types`
- `rhrn_google_places_blocked_place_types`
- `rhrn_google_places_disallow_address_only_results`
- `rhrn_google_places_allowed_countries`
- `rhrn_google_places_allowed_cities`

Location quality:

- `rhrn_location_max_accuracy_free_meters`
- `rhrn_location_max_accuracy_premium_meters`
- `rhrn_location_max_accuracy_vip_meters`
- `rhrn_location_max_age_minutes`
- `rhrn_location_revalidate_on_open = true`
- `rhrn_location_revalidate_on_vibe_send = true`

Ranking:

- `rhrn_sort_incoming_vibes_first = true`
- `rhrn_sort_outgoing_vibes_second = true`
- `rhrn_sort_live_before_recently_active = true`
- `rhrn_sort_relationship_weight`
- `rhrn_sort_shared_vibes_weight`
- `rhrn_sort_random_jitter_weight`

Notifications:

- `rhrn_notifications_incoming_vibe_enabled`
- `rhrn_notifications_match_enabled`
- `rhrn_notifications_teleport_expiring_enabled`

Moderation:

- `rhrn_tag_max_length`
- `rhrn_tag_moderation_enabled`
- `rhrn_vibe_note_moderation_enabled`
- `rhrn_block_external_links_in_notes`
- `rhrn_block_phone_numbers_in_notes`
- `rhrn_block_social_handles_in_notes`

## Production Rollout

Sequence:

1. Disabled globally.
2. Backend schema/config/functions deployed but inert.
3. Admin panel enabled for admins.
4. Route/screen visible only to admins.
5. Selected rollout users/cohorts.
6. Selected city/country.
7. Launch area.
8. Vibes enabled separately.
9. Vibe Notes/purchases enabled separately.
10. Google Places enabled with budget/rate limits.
11. Teleport enabled separately.
12. Notifications enabled after preference/suppression QA.
13. Broader tier monetization rollout.

Backend checks remain authoritative at every phase.

## Admin-Only Testing Plan

- Existing admins are detected through `user_roles`/admin role verification.
- Add `rhrn_rollout_users` and optional cohorts for non-admin testers.
- Do not use Premium/VIP or credit balances as beta allowlist state.
- Admin/test users can see the route only when `rhrn_enabled` and rollout gates allow it.
- Normal users calling direct routes/functions while disabled receive stable disabled responses and no data.

## Rollback Plan

Immediate rollback:

1. Set `rhrn_enabled = false`.
2. Set subfeature flags false if partial rollback is enough.
3. Hide route/tab via config-driven client gate.
4. Stop RHRN cleanup cron if a cron issue is involved.
5. Disable Google Places with `rhrn_google_places_enabled = false` for provider/cost incidents.
6. Disable notifications with `rhrn_notifications_enabled = false` for push incidents.

Database rollback:

- Do not destructively revert applied production migrations by default.
- Prefer forward migrations that disable policies/triggers/functions or correct behavior.
- Keep safety data such as hides/reports unless product/legal explicitly approves removal.

Client rollback:

- Web can hide nav/route by deploy or config.
- Native route files cannot be hot-removed, so the screen and backend must fail closed.

## Leak Verification Checklist

Static checks:

- `rg -n "rhrn|RHRN|Right Here Right Now" src apps/mobile supabase`
- RHRN imports should appear only in RHRN modules, admin/config, docs, and approved touchpoints.
- No Event Lobby card/deck logic should be imported into RHRN as business logic.
- No `distance_label` should be returned or rendered in RHRN context.

Route/screen checks:

- `/rhrn` hidden for normal users when disabled.
- Native RHRN tab hidden/disabled for normal users when disabled.
- Direct deep links fail closed.

Backend checks:

- Every `rhrn-*` function reads config first.
- Disabled functions return disabled responses before querying presence/grid/vibes/provider.
- Direct table SELECT under RLS exposes no raw RHRN location.
- Grid payload contains no lat/lng/distance/counts.

Core flow checks:

- Events still use existing event discovery.
- Matches list unchanged while RHRN off.
- Chat list unchanged while RHRN off.
- Notifications do not send unknown RHRN categories before mappings exist.
- Profile/settings behavior unchanged except explicit RHRN settings entry when enabled.

## QA Matrix

Tiers:

- Free
- Premium
- VIP

Presence modes:

- physical
- teleported
- Live
- Active recently
- Off
- manual off
- expired
- admin ended

Relationship states:

- current match -> Matched
- prior real two-sided connection -> Met before
- fresh -> no relationship tag
- event lobby pass -> no tag
- prior ignored/skipped RHRN Vibe -> no tag

Safety:

- RHRN Hide Profile
- global Block
- active Report
- suspended account
- paused account
- deleted/protected account state

Vibes:

- send to eligible user
- send rejected for hidden/block/report/ineligible
- incoming Vibe
- Vibe back accepted
- Not now
- seen ignored until expiry
- unseen expiry
- seen cooldown 7 days
- unseen cooldown 24 hours
- simultaneous mutual Vibes

Vibe Notes:

- Free included allowance 0
- Premium included allowance 1/24h
- VIP included allowance 3/24h
- purchased credit consumed
- server rejection does not consume
- ignored delivered note consumes
- accepted note becomes first chat message after banner
- note text not in push body
- max 140 chars

Teleport:

- Free purchasable only
- Premium purchasable only
- VIP 1/week included
- purchased extra
- extension credit
- expired Teleport
- manual end
- Teleported chip
- no Teleport disclosure in chat banner

Google Places:

- Place Memory hit
- Place Memory stale
- Google miss/fallback
- resolve success
- provider failure
- rate limit
- budget disabled
- address-only/private-ish blocked
- sensitive type blocked
- Powered by Google attribution

Platforms:

- web desktop
- web mobile
- mobile browser
- native iOS
- native Android
- tablet sanity

Location:

- permission granted
- location denied
- permission denied
- permission revoked after session
- poor accuracy
- weak accuracy
- stale timestamp
- services disabled
- slow location
- no profile city fallback
- no event-registration fallback
- no background location prompt

Feature flags:

- all disabled
- RHRN flags disabled
- global enabled with grid disabled
- Vibes disabled
- Vibe Notes disabled
- Teleport disabled
- Google Places disabled
- notifications disabled

## Validation Commands by Sprint

Docs-only Sprint 0:

```bash
git diff --check
git status --short
rg -n "rhrn|RHRN|Right Here Right Now" docs/rhrn docs/branch-deltas/rhrn-sprint0-architecture.md
```

Implementation sprints should select repo-appropriate commands, likely:

```bash
npm run build
npm run lint
```

Native when touched:

```bash
cd apps/mobile && npm run lint
cd apps/mobile && npm run typecheck
```

Supabase when migrations/functions are touched:

```bash
./scripts/check_migration_parity.sh
supabase db push --linked --dry-run
```

Only run cloud-mutating deploy commands when explicitly approved.

## Rebuild Delta Requirements

Every implementation sprint must update the relevant rebuild package:

- routes
- native tabs/screens
- migrations
- generated Supabase types
- `supabase/config.toml`
- Edge Function manifest
- migration manifest
- schema appendix
- external dependency ledger
- Google Places provider sheet
- Supabase provider sheet
- machine-readable inventory
- notification preferences docs
- static inventory tests that assert function count/config parity
- branch delta

## Implementation Sprint Plan

Sprints are sized for roughly 60-70% Codex capacity. Each sprint should end with a branch delta, validation log, rollback notes, and intentionally excluded scope.

### Sprint 1 - Backend Foundation and Config

Scope:

- inert `rhrn_config`, audit, rollout users/cohorts
- DB-backed default flags all disabled
- RLS skeleton
- admin config access posture
- PostGIS extension decision and migration plan

Excluded:

- no route
- no grid
- no location capture
- no Google calls
- no matches/messages

Validation:

- migration parity/dry-run where appropriate
- RLS access checks
- build/typecheck if generated types touched

Docs/rebuild:

- migration manifest
- schema appendix
- branch delta

Rollback:

- keep disabled flags
- forward-disable if deployed

### Sprint 2 - Session and Presence Engine

Scope:

- `rhrn_sessions`
- `rhrn_presence_locations`
- `rhrn-open-or-refresh`
- `rhrn-turn-off`
- cleanup foundation
- location freshness/accuracy validation

Excluded:

- no public grid
- no Vibes
- no Teleport
- no Google Places

Validation:

- start/refresh/manual off/expiry tests
- stale/weak location rejection
- no raw location reads

Rollback:

- disable global/grid flags

### Sprint 3 - Visibility and Grid API

Scope:

- `rhrn-nearby-grid`
- geospatial visibility rule
- tier radii
- preference/safety/account filters
- relationship/presence classifier
- sanitized payload

Excluded:

- no Vibe send/respond
- no Vibe Notes
- no Teleport start

Validation:

- Free/Premium/VIP radius cases
- hidden/block/report exclusions
- no coords/distance/counts in response

Rollback:

- disable `rhrn_grid_enabled`

### Sprint 4 - Web and Native UI Shell

Scope:

- `/rhrn` route
- tab/nav insertion
- first-time education
- permission states
- disabled state
- grid shell
- full profile open path

Excluded:

- no Vibes if Sprint 6 not complete
- no Teleport if Sprint 9 not complete
- no purchases

Validation:

- hidden when disabled
- admin/test visibility only
- responsive web pass
- native iOS/Android layout pass

Rollback:

- hide route/tab through flags

### Sprint 5 - RHRN Settings and Hide Profile

Scope:

- `rhrn_hides`
- hide/unhide/list functions
- RHRN settings
- Manage hidden profiles
- privacy/location/status explanations

Excluded:

- no new global block/report system
- no Vibes

Validation:

- bidirectional RHRN exclusion
- core match/chat/events unaffected
- hidden list has no live/distance/place hints

Rollback:

- disable UI; retain safety data

### Sprint 6 - Vibe Lifecycle

Scope:

- `rhrn_vibes`
- send/respond/seen or implicit seen
- expiry/cooldowns
- incoming/outgoing ordering
- Core match creation/restoration
- `rhrn_match_context`
- chat handoff/banner

Excluded:

- no Vibe Notes
- no paid credits
- no Teleport

Validation:

- accepted/not now/ignored/expired
- seen/unseen cooldown
- simultaneous mutual Vibes
- chat opens by other user id

Rollback:

- disable `rhrn_vibes_enabled`

### Sprint 7 - Vibe Notes and Credits

Scope:

- `rhrn_vibe_notes`
- `rhrn_vibe_note_usages`
- allowance calculation
- banked credit fallback
- moderation
- accepted note first-message conversion

Excluded:

- no Teleport credits unless shared ledger foundation is already safe
- no Google Places

Validation:

- tier allowance cases
- credit consumption idempotency
- no note text in push

Rollback:

- disable `rhrn_vibe_notes_enabled`

### Sprint 8 - Google Places and Place Memory

Scope:

- `rhrn-place-search`
- `rhrn-place-resolve`
- `rhrn_places`
- `rhrn_place_stats`
- `rhrn_place_provider_usage_events`
- server-only `GOOGLE_PLACES_API_KEY`
- At/Around selection model

Excluded:

- Teleport start can wait for Sprint 9
- no arbitrary pin
- no public heatmaps

Validation:

- cache hit/miss
- resolve/store
- blocked/private/sensitive rejection
- attribution
- rate-limit and budget

Rollback:

- disable `rhrn_google_places_enabled`

### Sprint 9 - Teleport

Scope:

- `rhrn_teleports`
- `rhrn_teleport_usages`
- start/extend/end
- Teleported chip
- entitlement and credit logic
- expiry

Excluded:

- no arbitrary pin
- no public place recommendations

Validation:

- VIP included weekly
- Free/Premium purchasable
- extension spend
- tier radius around selected place
- generic chat banner

Rollback:

- disable `rhrn_teleport_enabled`

### Sprint 10 - Notifications

Scope:

- RHRN notification categories
- preference columns/UI web/native
- send-notification mapping
- deep links
- suppression gates

Excluded:

- no public nearby nudges
- no counts
- no note body in push

Validation:

- unknown categories resolved
- quiet hours/category off/mutes
- hidden/block/report suppression
- deep links

Rollback:

- disable `rhrn_notifications_enabled`

### Sprint 11 - Admin Dashboard

Scope:

- RHRN admin panel
- config edits and audit
- rollout users/cohorts
- stats
- provider usage/cost visibility
- place controls

Excluded:

- no public analytics
- no live coordinate map

Validation:

- admin-only
- config applies without deploy
- non-admin blocked
- no raw coordinate exposure

Rollback:

- hide admin panel, keep backend config

### Sprint 12 - Hardening and QA

Scope:

- cross-platform QA
- RLS/security validation
- provider/payment/notification smokes
- leak checks
- performance and cleanup checks
- final docs/manifests

Excluded:

- no new product expansion beyond v1

Validation:

- full QA matrix
- web/mobile/native
- all flags disabled regression

Rollback:

- global kill switch and subfeature flags
