# RHRN Data Model

**Status:** Sprint 0 proposal
**Runtime impact:** none
**Naming rule:** all new RHRN-owned objects should be `rhrn_*`

## Design Decisions

- Use additive RHRN-prefixed tables. Do not overload Events, Event Lobby, Matches, Chat, Profile, or Settings tables with RHRN state except for explicit touchpoints.
- Enable PostGIS/geography for RHRN presence in Sprint 1 if the live Supabase project supports it. RHRN needs meter-level proximity, indexed geospatial filtering, and future operational headroom.
- Keep clients away from raw location tables. Grid payloads should be produced only by SECURITY DEFINER SQL or authenticated Edge Functions.
- Store rolling subscription allowances in usage ledgers. Store purchased credits in RHRN-specific banked balances/ledger, not in legacy video-date-only credit mutation paths.
- Store Google Place ID and Vibely-owned stats durably. Store Google-derived display/address/location/type snapshots with TTL and compliance discipline.

## Proposed Tables

### `rhrn_config`

Admin-controlled configuration and kill switches.

Recommended shape:

- `key text primary key`
- `value jsonb not null`
- `value_type text not null`
- `description text`
- `is_public boolean not null default false`
- `is_sensitive boolean not null default false`
- `updated_by uuid references profiles(id)`
- `updated_at timestamptz not null default now()`

Examples:

- feature flags and kill switches
- radii by tier
- session and Active recently durations
- request expiry and cooldowns
- Vibe Note allowances and max length
- Teleport allowances and durations
- Google Places TTL, rate limits, allowed/blocked types
- accuracy/freshness thresholds
- notification toggles
- ranking weights

### `rhrn_config_audit`

Immutable audit log for config mutations.

Recommended columns:

- `id uuid primary key`
- `config_key text not null`
- `old_value jsonb`
- `new_value jsonb`
- `changed_by uuid not null`
- `reason text`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

### `rhrn_rollout_cohorts`

Optional cohort registry for staged rollout.

Recommended columns:

- `id uuid primary key`
- `slug text unique not null`
- `label text not null`
- `enabled boolean not null default false`
- `countries text[]`
- `cities text[]`
- `features text[]`
- `starts_at timestamptz`
- `ends_at timestamptz`
- `created_by uuid`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `rhrn_rollout_users`

Per-user rollout allowlist.

Recommended columns:

- `user_id uuid not null references profiles(id)`
- `cohort_id uuid references rhrn_rollout_cohorts(id)`
- `features text[]`
- `enabled boolean not null default true`
- `expires_at timestamptz`
- `notes text`
- `created_by uuid`
- `created_at timestamptz not null default now()`
- primary key: `(user_id, cohort_id)` or `(user_id)`

Use this for non-admin testers. Do not use Premium/VIP status as a rollout proxy.

### `rhrn_sessions`

Historical session lifecycle table.

Recommended columns:

- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `mode text not null` - `physical`, `teleport`
- `state text not null` - `live`, `active_recently`, `expired`, `manual_off`, `admin_ended`
- `started_at timestamptz not null default now()`
- `live_expires_at timestamptz`
- `active_recently_expires_at timestamptz`
- `ended_at timestamptz`
- `end_reason text`
- `tier_snapshot text not null`
- `radius_meters integer not null`
- `platform text not null`
- `accuracy_meters numeric`
- `location_timestamp timestamptz`
- `tag text`
- `place_id uuid references rhrn_places(id)`
- `place_mode text` - `at`, `around`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `rhrn_presence_locations`

Query-optimized current/last valid RHRN center.

Recommended columns:

- `user_id uuid primary key references profiles(id)`
- `session_id uuid not null references rhrn_sessions(id)`
- `center geography(Point, 4326) not null` if PostGIS is enabled
- fallback columns only if PostGIS is deferred: `lat numeric`, `lng numeric`, bounding indexes
- `accuracy_meters numeric not null`
- `location_timestamp timestamptz not null`
- `radius_meters integer not null`
- `mode text not null`
- `status text not null`
- `place_id uuid references rhrn_places(id)`
- `platform text not null`
- `updated_at timestamptz not null default now()`

Clients must not select this table directly.

### `rhrn_hides`

RHRN-only bidirectional visibility exclusion.

Recommended columns:

- `id uuid primary key`
- `hider_user_id uuid not null references profiles(id)`
- `hidden_user_id uuid not null references profiles(id)`
- `active boolean not null default true`
- `source_surface text not null default 'rhrn'`
- `created_at timestamptz not null default now()`
- `unhidden_at timestamptz`
- `metadata jsonb not null default '{}'::jsonb`
- unique active pair guard on `(hider_user_id, hidden_user_id)` where active

Filtering must treat a hide in either direction as an RHRN pair exclusion.

### `rhrn_vibes`

RHRN Vibe request lifecycle.

Recommended columns:

- `id uuid primary key`
- `sender_user_id uuid not null references profiles(id)`
- `receiver_user_id uuid not null references profiles(id)`
- `sender_session_id uuid references rhrn_sessions(id)`
- `receiver_session_id uuid references rhrn_sessions(id)`
- `state text not null`
- `sent_at timestamptz not null default now()`
- `seen_at timestamptz`
- `responded_at timestamptz`
- `expires_at timestamptz not null`
- `accepted_match_id uuid`
- `invalidated_reason text`
- `cooldown_until timestamptz`
- `idempotency_key text`
- `send_context jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Recommended states:

- `sent`
- `seen`
- `accepted`
- `not_now`
- `expired_seen`
- `expired_unseen`
- `invalidated_hidden`
- `invalidated_blocked`
- `invalidated_reported`
- `invalidated_ineligible`
- `match_created`

### `rhrn_vibe_notes`

One optional note per Vibe. Keep separate from `rhrn_vibes` to isolate text moderation, credit source, and first-message conversion.

Recommended columns:

- `id uuid primary key`
- `vibe_id uuid unique not null references rhrn_vibes(id)`
- `sender_user_id uuid not null references profiles(id)`
- `receiver_user_id uuid not null references profiles(id)`
- `note_text text not null`
- `source text not null` - `tier_allowance`, `purchased_credit`, `admin_grant`
- `moderation_status text not null default 'pending'`
- `usage_id uuid references rhrn_vibe_note_usages(id)`
- `created_at timestamptz not null default now()`
- `converted_to_message_id uuid`
- `converted_at timestamptz`

Max length is admin-configured, default 140 chars.

### `rhrn_vibe_note_usages`

Usage ledger for rolling allowances and purchased/banked credits.

Recommended columns:

- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `source text not null` - `tier_allowance`, `purchased_credit`, `admin_grant`
- `tier_snapshot text not null`
- `vibe_id uuid references rhrn_vibes(id)`
- `credit_ledger_id uuid references rhrn_credit_ledger(id)`
- `idempotency_key text unique not null`
- `created_at timestamptz not null default now()`

### `rhrn_teleports`

Teleport session records.

Recommended columns:

- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `session_id uuid references rhrn_sessions(id)`
- `place_id uuid not null references rhrn_places(id)`
- `center geography(Point, 4326) not null` if PostGIS is enabled
- `radius_meters integer not null`
- `tier_snapshot text not null`
- `place_mode text not null default 'around'`
- `started_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- `ended_at timestamptz`
- `status text not null`
- `entitlement_source text not null`
- `extension_count integer not null default 0`
- `metadata jsonb not null default '{}'::jsonb`

### `rhrn_teleport_usages`

Usage ledger for VIP weekly allowance and purchased Teleport credits.

Recommended columns:

- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `teleport_id uuid references rhrn_teleports(id)`
- `source text not null` - `weekly_allowance`, `purchased_credit`, `admin_grant`
- `tier_snapshot text not null`
- `credit_ledger_id uuid references rhrn_credit_ledger(id)`
- `idempotency_key text unique not null`
- `created_at timestamptz not null default now()`

### `rhrn_places`

Vibely RHRN Place Memory.

Recommended columns:

- `id uuid primary key`
- `provider text not null default 'google_places'`
- `provider_place_id text not null`
- `display_name text`
- `short_address text`
- `formatted_address text`
- `center geography(Point, 4326)` if PostGIS is enabled
- `country text`
- `city text`
- `primary_type text`
- `types text[]`
- `status text not null default 'active'` - `active`, `blocked`, `needs_review`, `stale`
- `cache_expires_at timestamptz`
- `first_seen_at timestamptz not null default now()`
- `last_selected_at timestamptz`
- `metadata jsonb not null default '{}'::jsonb`
- unique: `(provider, provider_place_id)`

Do not store photos, reviews, ratings, phone numbers, websites, opening hours, or rich Google metadata in v1.

### `rhrn_place_stats`

Aggregate product-owned place usage stats.

Recommended columns:

- `place_id uuid primary key references rhrn_places(id)`
- `searches_count bigint not null default 0`
- `selections_count bigint not null default 0`
- `physical_sessions_count bigint not null default 0`
- `teleport_sessions_count bigint not null default 0`
- `at_count bigint not null default 0`
- `around_count bigint not null default 0`
- `live_minutes bigint not null default 0`
- `active_recently_minutes bigint not null default 0`
- `vibes_sent_count bigint not null default 0`
- `vibe_notes_sent_count bigint not null default 0`
- `matches_created_count bigint not null default 0`
- `reports_count bigint not null default 0`
- `hides_count bigint not null default 0`
- `premium_upgrades_count bigint not null default 0`
- `vip_upgrades_count bigint not null default 0`
- `teleport_credit_purchases_count bigint not null default 0`
- `updated_at timestamptz not null default now()`

Admin/product intelligence only. Do not expose public heatmaps or public counts in v1.

### `rhrn_place_provider_usage_events`

Provider usage/cost observability.

Recommended columns:

- `id uuid primary key`
- `user_id uuid references profiles(id)`
- `provider text not null`
- `action text not null` - `search`, `resolve`
- `cache_status text not null` - `hit`, `miss`, `stale`, `bypass`
- `query_hash text`
- `session_token_hash text`
- `result_count integer`
- `field_mask text`
- `http_status integer`
- `latency_ms integer`
- `estimated_cost_bucket text`
- `error_code text`
- `created_at timestamptz not null default now()`

Protect as admin-only or service-only.

### `rhrn_match_context`

Links canonical Core Vibely matches to RHRN origin.

Recommended columns:

- `id uuid primary key`
- `match_id uuid not null`
- `accepted_vibe_id uuid references rhrn_vibes(id)`
- `sender_session_id uuid references rhrn_sessions(id)`
- `receiver_session_id uuid references rhrn_sessions(id)`
- `banner_timestamp timestamptz not null default now()`
- `teleport_involved boolean not null default false`
- `safe_metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Do not expose exact location, place, distance, or Teleport disclosure in chat banner payload.

### `rhrn_credit_balances`

RHRN-specific banked balances.

Recommended columns:

- `user_id uuid primary key references profiles(id)`
- `vibe_note_credits integer not null default 0`
- `teleport_credits integer not null default 0`
- `teleport_extension_credits integer not null default 0`
- `updated_at timestamptz not null default now()`

### `rhrn_credit_ledger`

Idempotent credit settlement and spend audit.

Recommended columns:

- `id uuid primary key`
- `user_id uuid not null references profiles(id)`
- `credit_type text not null` - `vibe_note`, `teleport`, `teleport_extension`
- `delta integer not null`
- `source text not null` - `stripe`, `revenuecat`, `admin_grant`, `spend`, `refund`, `correction`
- `source_event_id text`
- `idempotency_key text unique not null`
- `related_vibe_id uuid references rhrn_vibes(id)`
- `related_teleport_id uuid references rhrn_teleports(id)`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

## RLS and Security Posture

Default posture:

- Enable RLS on every RHRN table.
- Users may read only their own session status, own Vibe states, own hidden profile list, and own RHRN balances through sanitized functions or narrow policies.
- Clients may not read `rhrn_presence_locations`, raw `center`, provider usage events, or place stats directly.
- Grid payload is only through a SECURITY DEFINER RPC or Edge Function that strips lat/lng, exact distance, counts, and raw location objects.
- Server derives tier, radius, entitlement, cooldown, eligibility, visibility, and participation state.
- Server enforces blocks, reports, suspensions, account pause, deletion/protected states, dating preferences, and RHRN hides.
- `rhrn_hides` is user-manageable for own hide/unhide operations, but pair filtering is symmetric.
- Admin config/stats are admin-only.
- Provider usage, cost stats, and place stats are admin/service-only.

Suggested policy split:

| Object family | Client direct read | Client direct write | Access path |
| --- | --- | --- | --- |
| Config public subset | yes, sanitized | no | `rhrn-get-config` preferred |
| Config audit/admin stats | no | no | admin function only |
| Sessions own summary | narrow yes or function | no direct writes | user functions |
| Presence locations | no | no | service/RPC only |
| Hides | own hidden list only | function preferred | hide/unhide/list functions |
| Vibes/notes | own request summaries only | no direct writes | send/respond/seen functions |
| Credits | own balance summary only | no direct writes | settlement/spend/admin functions |
| Places search results | no raw provider table | no | search/resolve functions |
| Place stats/provider usage | no | no | admin stats only |
| Match context | no broad read | no | chat adapter/banner function |

## Core Table Changes

Unavoidable or likely:

- `notification_preferences`: add RHRN `notify_*` columns or equivalent preference group before RHRN sends notifications.
- canonical matches/messages tables: may need no schema change if RHRN match context table and existing message APIs can create banner/first message safely. If current chat banner requires core schema, add the smallest additive metadata field after review.
- Stripe/RevenueCat settlement functions: add RHRN credit product branches, but keep RHRN ledger separate.
- generated Supabase types: regenerate after migrations in implementation sprints.

Avoid:

- adding RHRN visibility/session columns to `profiles`
- adding RHRN location fields to Events tables
- changing Event Lobby swipe/card tables for RHRN
- using `user_credits` legacy columns for RHRN consumables

## Migration Risk Notes

- PostGIS enablement should be additive and verified against the live Supabase project. Do not assume local extension state equals cloud.
- Presence indexes must be designed before scale tests. RHRN fields are small in meters, but query frequency can be high.
- RLS must fail closed before functions are exposed.
- Credit settlement must be idempotent and concurrency-safe before purchases are enabled.
- Place Memory must avoid indefinite caching of Google-derived rich data.
- No migration should be added in Sprint 0.
