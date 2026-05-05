# Vibely RHRN Coding and Implementation Plan

**Feature:** Right Here Right Now  
**Abbreviation:** RHRN  
**Target implementation agent:** Codex in VS Code Studio  
**Execution model:** Sprints and batches sized for approximately 60–70% Codex capacity utilization  
**Primary principle:** Build RHRN as a bounded plug-in module; minimize live production risk  
**Status:** Ready for Sprint 0 architecture/reporting work  

---

## 1. Implementation Doctrine

RHRN must be implemented incrementally, behind DB-backed feature flags, with no public exposure until backend, web, native, admin, and safety behavior have been validated.

The engineering doctrine:

1. RHRN is a bounded module, not a scattered Core Vibely change.
2. All RHRN business rules are backend-owned.
3. Clients never compute visibility, radius, entitlement, or cooldown decisions.
4. Clients never receive raw locations, exact distances, nearby counts, or map pins.
5. Core Vibely is touched only through explicit, documented touchpoints.
6. Every branch emits a rebuild delta.
7. Every backend or provider change updates manifests/docs.
8. Every sprint keeps scope small enough for Codex to finish with high quality and margin.
9. RHRN must remain disabled by default until rollout is explicitly approved.

---

## 2. Non-Negotiable Guardrails for Codex

Codex must follow these on every RHRN branch:

```text
Do not scatter RHRN logic into Events, Event Lobby, Matches, Chat, Profile, or Settings.
Use RHRN-prefixed backend objects and frontend/native module boundaries where possible.
Do not change Core Vibely behavior while RHRN is disabled.
Do not reuse Event Lobby deck cards or event swipe logic as RHRN business logic.
Do not use profile city, saved profile location, or event registration location for physical RHRN.
Do not expose raw lat/lng, exact distance, nearby counts, or map pins to clients.
Do not rely on client-side premium flags for entitlement/radius/credit decisions.
Do not send direct chat messages before mutual Vibe unless users are already matched.
Do not expose GOOGLE_PLACES_API_KEY to web or native clients.
Do not introduce background location in v1.
Do not import unsupported native modules.
Do not skip rebuild documentation.
```

---

## 3. Known Repo-Grounded Constraints

Codex investigations identified these implementation realities:

### 3.1 Navigation

Web insertion points:

- route in `src/App.tsx`
- lazy/preload support in `src/lib/routePreload.ts`
- bottom nav insertion in `src/components/navigation/BottomNav.tsx`

Native insertion points:

- add `rhrn` tab under `apps/mobile/app/(tabs)/_layout.tsx`
- add screen under `apps/mobile/app/(tabs)/rhrn`
- align bottom nav order to Now / Events / RHRN / Matches / You

### 3.2 Settings

Web settings insertion:

- near Privacy / Discovery in Settings

Native settings insertion:

- settings stack route `/settings/rhrn`
- row near Privacy / Discovery

### 3.3 Admin

Admin insertion:

- AdminDashboard
- AdminSidebar
- best placement after Events or Tier Config

### 3.4 Profile Reuse

Reuse full-profile surfaces where safe.

Avoid Event Lobby profile cards.

Any reused profile component must suppress distance labels in RHRN context.

### 3.5 Chat Routing

Web and native chat routes open by **other user id**, not match id.

After mutual RHRN Vibe, backend responses must return enough context for:

```text
/chat/:otherUserId
```

### 3.6 Notifications

Unknown notification categories fail closed unless explicitly added to:

- send-notification mapping
- web notification preferences
- native notification preferences

### 3.7 Location

Existing location helpers are profile/event-oriented.

RHRN needs its own foreground precise location capture preserving:

```text
lat
lng
accuracy_meters
timestamp
platform
```

Native already has `expo-location`; do not introduce background location.

### 3.8 Geospatial Backend

PostGIS/geography is not currently enabled.

Existing `haversine_distance` is scalar and event-oriented.

Sprint 0 must recommend:

- enable PostGIS for RHRN, or
- use indexed scalar fallback with careful prefiltering

### 3.9 Payments/Credits

Existing `user_credits` is column-bucket based and video-date oriented.

RHRN should use additive RHRN-specific credit balances/ledgers and rolling usage tables.

Do not extend existing `deduct_credit` for RHRN.

### 3.10 Google Places

RHRN needs dedicated backend provider functions:

```text
rhrn-place-search
rhrn-place-resolve
```

Do not reuse `geocode` or `forward-geocode` directly.

`GOOGLE_PLACES_API_KEY` must be a server-only Supabase Edge secret.

---

## 4. Sprint Structure Overview

Sprints are designed for safe, incremental implementation.

| Sprint | Name | Primary Output |
|---:|---|---|
| 0 | Architecture synthesis | Docs-only architecture/report package |
| 1 | Backend foundation and config | Inert RHRN schema/config/flags |
| 2 | Session and presence engine | Live/Active Recently state machine |
| 3 | Visibility and grid API | Sanitized RHRN grid backend |
| 4 | Web/native UI shell | RHRN tab/page behind flags |
| 5 | Settings and Hide Profile | RHRN settings + RHRN-only hide |
| 6 | Vibe lifecycle | Vibe send/respond/expiry/match creation |
| 7 | Vibe Notes and credits | Notes, allowances, purchase hooks |
| 8 | Google Places and Place Memory | Search/resolve/provider stats/At-Around |
| 9 | Teleport | Teleported sessions and entitlements |
| 10 | Notifications | RHRN notification categories/deep links |
| 11 | Admin dashboard | Config, analytics, stats, kill switches |
| 12 | Hardening and QA | Cross-platform, security, rollout readiness |

---

## 5. Sprint 0 — Architecture Synthesis

### Goal

Create a final architecture/report package before runtime coding.

### Scope

Docs-only.

Produce implementation-ready architecture documents:

```text
docs/rhrn/rhrn-architecture-report.md
docs/rhrn/rhrn-data-model.md
docs/rhrn/rhrn-edge-functions-and-rpcs.md
docs/rhrn/rhrn-ui-map.md
docs/rhrn/rhrn-rollout-and-qa-plan.md
docs/branch-deltas/rhrn-sprint0-architecture.md
```

### Required Content

Sprint 0 docs must include:

- Core Vibely touchpoint map
- proposed `rhrn_*` schema
- proposed Edge Functions/RPCs
- RLS/security posture
- admin config model
- web UI map
- native UI map
- provider/env changes
- Google Places model
- credit/payment model
- notification model
- rollout plan
- QA matrix
- rebuild delta requirements
- implementation sprint plan
- unresolved questions/blockers

### Excluded Scope

- no migrations
- no runtime feature code
- no route insertion
- no Edge Function creation
- no UI implementation

### Validation

Codex should produce a report only.

Human review required before Sprint 1.

### Rebuild Delta

Docs-only delta.

### Rollback

Delete docs if architecture is rejected.

---

## 6. Sprint 1 — Backend Foundation, Config, and Feature Flags

### Goal

Create inert RHRN backend foundation with zero public user-facing behavior.

### Scope

Additive backend foundation:

- `rhrn_config`
- `rhrn_config_audit`
- rollout/allowlist table(s)
- base feature flags
- DB-backed kill switches
- seed default RHRN config values
- RLS skeleton
- admin-only config access posture
- possibly RHRN credit/balance skeleton if architecture confirms
- function manifest/config placeholders for future RHRN functions if appropriate

### Required Defaults

RHRN disabled globally:

```text
rhrn_enabled = false
rhrn_grid_enabled = false
rhrn_vibes_enabled = false
rhrn_vibe_notes_enabled = false
rhrn_teleport_enabled = false
rhrn_google_places_enabled = false
rhrn_notifications_enabled = false
```

Default product values stored but not active:

```text
Free radius: 40m
Premium radius: 70m
VIP radius: 100m
Live session: 60m
Active recently: 30m
Request expiry: 60m
Seen cooldown: 7d
Unseen cooldown: 24h
Premium Vibe Notes: 1/24h
VIP Vibe Notes: 3/24h
VIP Teleport: 1/week
Teleport duration: 60m
```

### Excluded Scope

- no public RHRN route
- no grid logic
- no location logic
- no Google Places calls
- no chat/match writes
- no notifications

### Validation

Run applicable commands:

```bash
npm run build
# plus any repo-specific typecheck/lint commands Codex finds
supabase db push --linked --dry-run  # only if appropriate and after parity check
```

Also validate:

- existing app still builds
- RHRN disabled state has no user-visible impact
- RLS blocks unauthorized config/stats access
- admin can read/write only if intentionally exposed in this sprint

### Rebuild Delta

Must update:

- migration manifest
- schema appendix / generated types note
- machine-readable inventory if required
- branch delta

### Rollback

Disable flags. If necessary, revert additive migration before production rollout only under explicit operator review.

---

## 7. Sprint 2 — Session and Presence Engine

### Goal

Implement backend-owned RHRN session state machine for physical RHRN.

### Scope

Add:

- `rhrn_sessions`
- `rhrn_presence_locations`
- session lifecycle functions
- `rhrn-open-or-refresh`
- `rhrn-turn-off`
- cleanup/expiry routine foundation
- RHRN location payload contract
- server-side accuracy/freshness validation
- Live → Active recently → Off transitions

### Key Rules

Opening RHRN:

```text
creates or refreshes live session
live_expires_at = now + configured duration
```

Manual off:

```text
immediately removes grid access
transitions user to Active recently
sets active_recently_expires_at
stops live location refresh
```

No background tracking.

No profile location fallback.

### Excluded Scope

- no public grid
- no Vibes
- no Teleport
- no Google Places
- no public route if Sprint 4 not reached

### Validation

Test:

- session starts for eligible user
- session refreshes on open
- manual off transitions to Active recently
- expiry transitions work
- paused/suspended user cannot start
- bad accuracy is rejected
- stale timestamp is rejected
- no raw locations exposed through direct client reads

### Rebuild Delta

- migration manifest
- schema appendix
- function manifest if Edge Functions are added
- branch delta

### Rollback

Feature flags remain disabled. Session functions fail closed.

---

## 8. Sprint 3 — Visibility Engine and Grid API

### Goal

Implement sanitized RHRN grid response with all backend filters.

### Scope

Add/complete:

- `rhrn-nearby-grid`
- geospatial filtering
- tier radius field rule
- age/gender/dating preference filters
- block/report/suspension/pause filters
- RHRN Hide placeholder exclusion if table not yet completed
- relationship classifier
- presence chip classifier
- grid ordering
- sanitized card payload

### Required Visibility Rule

Two users are visible if either user’s field reaches the other, subject to all filters.

```text
max_effective_radius = max(viewer_radius, candidate_radius)
visible if distance <= max_effective_radius
```

If PostGIS is enabled, use meter-based geography filtering.

If PostGIS is deferred, use indexed bounding/prefilter + server-side final distance check.

### Sanitized Payload Must Not Include

- candidate lat/lng
- exact distance
- nearby count
- map pin
- raw location object
- hidden candidate hint
- blocked/reported candidate hint

### Required Tags

- Matched
- Met before
- Active recently
- Teleported placeholder if Teleport not yet implemented

### Excluded Scope

- no Vibe send/response yet
- no Vibe Notes
- no Teleport start
- no notifications

### Validation

Test matrix:

- Free/Free 35m visible
- Free/Free 55m not visible
- Premium/Free 60m visible
- VIP/Free 90m visible
- blocked excluded
- reported excluded
- hidden excluded if available
- paused/suspended excluded
- current match tagged Matched
- previous real connection tagged Met before
- event lobby pass no tag
- no distance/count/coords in response

### Rebuild Delta

Update docs/manifests for any new functions, RPCs, schema, generated types.

### Rollback

Disable `rhrn_grid_enabled`.

---

## 9. Sprint 4 — Web and Native RHRN UI Shell

### Goal

Add RHRN UI shell behind feature flags on web and native.

### Scope

Web:

- `/rhrn` route
- RHRN tab in bottom nav between Events and Matches
- route preload support
- first-time education screen
- permission states
- main shell
- toggle
- RHRN tag input
- grid rendering from backend
- card components
- full-profile open path

Native:

- RHRN tab under Expo Router
- native RHRN screen
- first-time education
- foreground location permission flow
- RHRN API client module
- RHRN location helper preserving accuracy/timestamp/platform
- grid rendering
- full-profile open path

### UI Must Show

- RHRN title
- status/toggle
- optional RHRN tag prompt
- cards with tags/chips
- loading state
- empty state
- permission denied state
- weak accuracy state
- disabled-by-admin state

### UI Must Not Show

- distance
- counts
- map
- map pins
- exact coordinates
- “people nearby” count badges

### Excluded Scope

- no Vibes if Sprint 6 not complete
- no Teleport if Sprint 9 not complete
- no payment hooks

### Validation

- RHRN hidden when disabled
- admin/test user can open when enabled by allowlist
- opening RHRN starts/refreshes session
- toggle off removes grid access and transitions backend state
- web responsive pass
- native iOS and Android layout pass
- full profile opens without distance label
- no Event Lobby card/deck behavior

### Rebuild Delta

- route map
- native tab route
- docs/inventory
- branch delta

### Rollback

Turn off flags and remove nav exposure if needed.

---

## 10. Sprint 5 — RHRN Settings and Hide Profile

### Goal

Implement RHRN privacy controls and settings.

### Scope

Add:

- `rhrn_hides`
- `rhrn-hide-profile`
- `rhrn-unhide-profile`
- `rhrn-list-hidden-profiles`
- RHRN Settings screen
- Manage hidden profiles
- settings entry from RHRN gear
- settings entry from global settings
- location permission status
- RHRN explainer
- placeholder balances for Vibe Notes/Teleport

### Hide Profile Behavior

If A hides B:

- A and B do not see each other on RHRN
- no RHRN Vibes/Notes/notifications between them
- existing Core match/chat unaffected
- Events and Core discovery unaffected

### Manage Hidden Profiles Must Not Show

- live status
- RHRN tag
- current place
- distance
- nearby hint

### Excluded Scope

- no global Block changes unless wiring existing block action
- no new report system beyond existing report integration
- no Vibe interactions

### Validation

- hide excludes pair both ways on RHRN
- unhide restores eligibility only if other filters pass
- existing chat remains after Hide Profile
- hidden user gets no notification
- hidden list shows only static profile preview

### Rebuild Delta

- schema/docs
- settings route/docs
- branch delta

### Rollback

Disable UI; RHRN hides remain as data but can be ignored only if product explicitly approves. Prefer not to ignore safety data.

---

## 11. Sprint 6 — Vibe Request Lifecycle

### Goal

Implement core RHRN Vibe flow without Vibe Notes first.

### Scope

Add:

- `rhrn_vibes`
- `rhrn-send-vibe`
- `rhrn-respond-vibe`
- `rhrn-mark-vibe-seen` or implicit seen marking
- request expiry
- seen/unseen cooldowns
- incoming/outgoing grid ordering
- Vibe Back
- Not Now
- Core match creation/restoration
- `rhrn_match_context`
- chat handoff
- chat banner

### Vibe States

```text
draft
sent
delivered
seen
accepted
not_now
expired_seen
expired_unseen
invalidated_hidden
invalidated_blocked
invalidated_reported
```

### Match Creation

On mutual Vibe:

- create/restore normal Core Vibely match
- store RHRN match context
- return other_user_id for chat route
- open existing chat

Chat banner:

```text
You met on Right Here Right Now
18:42 · 3 May 2026
```

### Cooldowns

```text
Seen + Not now: 7 days
Seen + ignored until expiry: 7 days
Unseen expiry: 24 hours
```

### Excluded Scope

- no Vibe Notes
- no paid credits
- no push notifications unless simple in-app only is safe
- no Teleport

### Validation

- can send Vibe to eligible candidate
- cannot send to hidden/block/report/excluded candidate
- incoming appears at top
- outgoing appears second
- Not Now silent to sender
- ignored expires correctly
- seen cooldown 7 days
- unseen cooldown 24h
- mutual Vibe creates match once
- simultaneous mutual Vibes handled atomically
- chat opens by other user id
- no direct chat before mutual Vibe

### Rebuild Delta

- schema/RPC/function manifest
- chat context docs
- branch delta

### Rollback

Disable `rhrn_vibes_enabled`.

---

## 12. Sprint 7 — Vibe Notes, Allowances, and Credits

### Goal

Add Premium/VIP Vibe Notes and purchased Vibe Note credits.

### Scope

Add:

- `rhrn_vibe_notes` or note fields on Vibe table
- `rhrn_vibe_note_usages`
- Vibe Note allowance calculation
- purchased credit fallback
- 140-character limit
- moderation filters
- note display in incoming request
- note conversion into first chat message after acceptance
- web purchase surface if approved for this sprint
- native purchase/settlement placeholder if native commerce requires later branch

### Allowances

```text
Free: 0 per rolling 24h
Premium: 1 per rolling 24h
VIP: 3 per rolling 24h
```

Subscription allowances do not roll over.

Purchased credits are banked.

### Consumption

Consume allowance/credit only after successful delivery.

Do not consume on server rejection.

### Excluded Scope

- no Teleport credits unless payment model combines ledgers safely
- no Google Places
- no notifications unless Sprint 10 is pulled earlier

### Validation

- Free cannot attach included note unless purchased credit exists
- Premium can attach 1/24h
- VIP can attach 3/24h
- purchased credits are consumed after included allowance if configured that way, or per architecture decision
- note max 140 chars
- note is not included in push body
- accepted note becomes first chat message
- ignored note does not create chat
- delivered ignored note consumes allowance/credit
- server rejected note does not consume

### Rebuild Delta

- credit docs
- payment docs
- schema/functions
- branch delta

### Rollback

Disable `rhrn_vibe_notes_enabled` and purchases.

---

## 13. Sprint 8 — Google Places and Vibely Place Memory

### Goal

Implement RHRN place search provider boundary, Place Memory, At/Around, and place statistics.

### Scope

Add:

- `rhrn-place-search`
- `rhrn-place-resolve`
- `GOOGLE_PLACES_API_KEY` secret requirement
- `rhrn_places`
- `rhrn_place_stats`
- `rhrn_place_provider_usage_events`
- Place Memory first, Google fallback
- Google session token support
- debounced search contract
- strict field masks
- Google attribution in UI
- type/category filters
- address-only/private/sensitive result rejection
- At/Around selection
- provider usage/cost logging

### Place Search Flow

```text
Client sends query and optional bias
Backend checks Place Memory
Backend calls Google on miss/stale
Backend returns normalized candidates
User selects candidate
Backend resolves minimal fields
Backend stores/updates Place Memory and stats
```

### Data Policy

Durably store:

- Google Place ID
- internal Vibely place id
- Vibely-owned stats
- first/last selected timestamps

Cache with TTL:

- display name
- formatted/short address
- lat/lng
- types
- business status if needed

Do not store:

- photos
- reviews
- ratings
- phone
- website
- opening hours

### Excluded Scope

- Teleport start may wait for Sprint 9
- no arbitrary map pin
- no public place heatmaps

### Validation

- Google key never exposed to clients
- Place Memory hit avoids Google call
- miss calls Google
- resolve stores selected place
- provider usage logged
- Google attribution appears when needed
- address-only/private/sensitive results rejected
- At/Around works in session payload
- feature flag disables Google call

### Docs/Manifests

Must update:

- external dependency ledger
- new Google Places provider sheet
- Supabase provider sheet
- Edge Function manifest
- rebuild runbook
- env/secrets inventory
- branch delta

### Rollback

Disable `rhrn_google_places_enabled`.

---

## 14. Sprint 9 — Teleport

### Goal

Implement Teleport using selected place + tier RHRN field.

### Scope

Add:

- `rhrn_teleports`
- `rhrn_teleport_usages`
- `rhrn-start-teleport`
- `rhrn-extend-teleport`
- `rhrn-end-teleport`
- Teleported chip
- Teleport entitlement logic
- purchased Teleport credit logic
- extension logic
- Teleport expiry
- Teleport stats
- Teleport UI flow

### Entitlements

```text
Free: 0 included/week, purchasable
Premium: 0 included/week, purchasable
VIP: 1 included/rolling week, purchasable extras
Default duration: 60 minutes
```

Tier field while Teleported:

```text
Free: 40m
Premium: 70m
VIP: 100m
```

### UI

Teleport flow:

```text
Search place
Select place
Choose At / Around
Start Teleport
```

Chip:

```text
Teleported
```

No Teleport disclosure in chat banner.

### Excluded Scope

- no arbitrary pin
- no public place heatmap
- no advanced venue recommendation engine

### Validation

- VIP gets one weekly included Teleport
- Free/Premium require purchase/admin grant
- extension consumes correct credit
- Teleport appears as Teleported
- Teleport uses selected place center
- Teleport uses tier field
- users in field see teleported user
- teleported user sees users in field
- expired Teleport stops
- chat banner remains generic RHRN

### Rebuild Delta

- schema/functions
- credit/payment docs
- admin config
- branch delta

### Rollback

Disable `rhrn_teleport_enabled`.

---

## 15. Sprint 10 — Notifications

### Goal

Add RHRN notification categories and deep links through existing notification infrastructure.

### Scope

Add:

- notification preference columns/categories
- send-notification category mapping
- web preference UI
- native preference UI
- incoming Vibe push
- incoming Vibe Note push without note text
- RHRN match push
- Teleport ending push
- deep links to `/rhrn`
- chat deep links after match
- suppression by hidden/block/report
- quiet hours/category toggle behavior

### Notification Categories

Suggested semantic categories:

```text
rhrn_vibe
rhrn_vibe_note
rhrn_match
rhrn_teleport_expiring
```

Codex should map exact column names to repo conventions.

### Copy

Incoming Vibe:

```text
Maya vibed you on RHRN.
```

Incoming Vibe Note:

```text
Maya vibed you on RHRN.
```

RHRN Match:

```text
You matched on RHRN.
```

Teleport:

```text
Your Teleport is ending soon.
```

### Excluded Scope

- no public nearby nudges
- no counts
- no note body in push
- no named nearby notification to inactive users

### Validation

- unknown categories no longer fail closed
- preferences work web/native
- hidden pair suppresses
- block/report suppresses
- quiet hours apply
- note text not in push
- deep link opens RHRN
- match deep link opens chat by other user id

### Rebuild Delta

- notification docs
- function manifest
- schema/migration docs
- OneSignal docs if needed
- branch delta

### Rollback

Disable `rhrn_notifications_enabled`.

---

## 16. Sprint 11 — Admin Dashboard and Analytics

### Goal

Make RHRN operable from admin.

### Scope

Add RHRN admin panel for:

- feature flags
- tier radii
- session durations
- Active recently durations
- request expiry
- cooldowns
- Vibe Note allowances
- Teleport allowances
- Google Places controls
- place type filters
- accuracy thresholds
- notification toggles
- ranking weights
- RHRN usage analytics
- place statistics
- Google Places usage/cost stats
- RHRN reports/hides
- Teleport usage
- Vibe conversion
- match conversion

### Admin Metrics

Include:

- active sessions
- active recently users
- Vibes sent
- Vibe Notes sent
- Vibes accepted
- RHRN matches created
- expired requests
- Hide Profile actions
- reports from RHRN
- Teleport sessions
- Teleport extensions
- Google search calls
- Place Memory hit rate
- top places
- premium/VIP upgrades from RHRN

### Excluded Scope

- no public analytics
- no public heatmap
- no live user coordinate display

### Validation

- admin role required
- config changes persist
- config changes affect backend without deploy
- non-admin cannot access
- no raw location overexposure
- audit logs write config changes

### Rebuild Delta

- admin docs
- config docs
- branch delta

### Rollback

Disable admin panel route/link if needed; backend config remains.

---

## 17. Sprint 12 — Cross-Platform Hardening and QA

### Goal

Make RHRN production-ready for controlled rollout.

### Scope

- web responsive pass
- mobile web pass
- native iOS pass
- native Android pass
- tablet sanity pass
- poor location handling
- denied location handling
- permission revoked handling
- Google Places failure handling
- slow network/offline handling
- race conditions
- simultaneous Vibes
- cleanup/expiry correctness
- security validation
- RLS validation
- feature flag leak validation
- docs/manifests finalization
- production rollout checklist

### QA Matrix

Test all combinations:

- Free / Premium / VIP
- physical / teleported
- Live / Active recently / Off
- matched / met before / fresh
- Hide Profile / Block / Report
- Vibe accepted / Not now / ignored / expired
- seen cooldown / unseen cooldown
- Vibe Note included allowance / purchased credit
- Teleport included allowance / purchased credit / extension
- Google Place Memory hit / Google miss / Google failure / rate limit
- At / Around
- web desktop / web mobile / iOS / Android
- location denied / poor accuracy / permission revoked
- all kill switches disabled
- notification preference off / quiet hours / hidden pair suppression

### Validation Commands

Codex should use repo-specific commands, but likely includes:

```bash
npm run build
npm run lint
cd apps/mobile && npm run typecheck # if available
cd apps/mobile && npm run lint      # if available
```

Plus Supabase validation:

```bash
./scripts/check_migration_parity.sh
supabase db push --linked --dry-run
```

Only run cloud changes when explicitly approved and necessary.

### Rebuild Delta

Final RHRN rollout/rebuild delta.

### Rollback

RHRN can be disabled globally through DB config.

Subfeatures can be disabled independently.

---

## 18. Production Rollout Plan

RHRN must not be exposed publicly immediately.

Rollout sequence:

```text
1. RHRN schema/functions deployed, disabled globally.
2. Admin panel enabled for admins only.
3. RHRN route visible only to admins/test allowlist.
4. Physical RHRN enabled for internal test users.
5. Vibes enabled for internal test users.
6. Vibe Notes enabled for internal test users.
7. Google Places enabled in controlled region.
8. Teleport enabled behind flag.
9. Notifications enabled after preference/suppression QA.
10. Selected city/country rollout.
11. Wider launch-area rollout.
12. Full tier monetization rollout.
```

Kill switches:

```text
rhrn_enabled
rhrn_grid_enabled
rhrn_vibes_enabled
rhrn_vibe_notes_enabled
rhrn_teleport_enabled
rhrn_google_places_enabled
rhrn_notifications_enabled
```

---

## 19. Sprint Acceptance Template

Every sprint should end with a concise acceptance report:

```text
Sprint:
Branch:
Commit hash:
Scope completed:
Scope intentionally excluded:
Files changed:
Migrations added:
Edge Functions added/changed:
Config/env/secrets added:
Docs/manifests updated:
Validation commands run:
Validation results:
Known risks:
Rollback instructions:
Next sprint recommendation:
```

---

## 20. Rebuild Delta Template

Each meaningful branch must include:

```text
### Rebuild Delta — RHRN Sprint X

#### Routes
- added:
- removed:
- changed:

#### Native Tabs / Screens
- added:
- removed:
- changed:

#### Edge Functions
- added:
- removed:
- changed:
- auth posture changes:

#### Schema / Storage
- tables:
- views:
- enums:
- SQL functions:
- buckets:
- RLS / policies:

#### Environment / Secrets
- frontend vars added/removed:
- backend vars added/removed:
- hardcoded runtime values changed:

#### Provider / External Setup
- Google Places:
- Stripe:
- RevenueCat:
- OneSignal:
- Supabase:
- other:

#### Rebuild Pack Docs Updated
- runbook:
- edge function manifest:
- migration manifest:
- schema appendix:
- external dependency ledger:
- provider sheet:
- inventory JSON:

#### Notes / Risks
- replay risks:
- rollout risks:
- rollback notes:
- manual follow-up required:
```

---

## 21. Codex Prompting Strategy

Use one sprint prompt at a time.

Do not combine backend, web, native, payments, Google Places, and admin into one massive coding prompt.

Recommended pattern:

1. Ask Codex for a short pre-change impact audit.
2. Ask Codex to implement only that sprint’s scope.
3. Ask Codex to run validations.
4. Ask Codex to produce rebuild delta.
5. Review before next sprint.

Codex should operate around 60–70% capacity:

- small scope
- explicit exclusions
- no broad cleanup
- no unrelated refactors
- no speculative polish
- no hidden changes

---

## 22. First Safe Implementation Sprint After Sprint 0

After Sprint 0 architecture docs are approved, the first coding sprint should be:

```text
Sprint 1 — Backend Foundation, Config, and Feature Flags
```

Why:

- lowest production risk;
- no public UI exposure;
- establishes DB-backed rollout controls;
- gives every later function a fail-closed config source;
- creates admin-adjustable product variables without enabling behavior;
- allows immediate documentation of new schema/config surfaces.

Sprint 1 must not implement grid, Vibes, Teleport, Google Places, or notifications.

---

## 23. Final Implementation Target

By the end of all sprints, RHRN should be:

- fully backend-authoritative;
- fully responsive on web;
- native-parity-ready on iOS and Android;
- disabled/enabled by admin config;
- safe for production rollout;
- compatible with existing Core Vibely matches/messages/notifications;
- monetizable through Premium/VIP/Vibe Notes/Teleport;
- Google Places-backed with Vibely Place Memory and cost controls;
- privacy-preserving by design;
- documented in rebuild manifests and provider sheets;
- built as a portable plug-in module for future Vibely-like apps.

