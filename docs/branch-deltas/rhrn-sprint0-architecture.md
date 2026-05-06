# rhrn-sprint0-architecture

## Scope

Created the Sprint 0 Right Here Right Now architecture/report package.

This is a docs-only branch delta. No runtime RHRN feature code, route insertion, migrations, Edge Functions, generated types, provider secrets, native modules, or product behavior changes were introduced.

## Files Changed

- `docs/rhrn/rhrn-architecture-report.md`
- `docs/rhrn/rhrn-data-model.md`
- `docs/rhrn/rhrn-edge-functions-and-rpcs.md`
- `docs/rhrn/README.md`
- `docs/rhrn/rhrn-ui-map.md`
- `docs/rhrn/rhrn-rollout-and-qa-plan.md`
- `docs/branch-deltas/rhrn-sprint0-architecture.md`

## Architecture Decisions Captured

- RHRN remains a bounded plug-in module with RHRN-prefixed backend objects and explicit Core Vibely touchpoints only.
- Web route is `/rhrn`; nav order is Now / Events / RHRN / Matches / You; screen title is Right Here Right Now.
- Physical RHRN requires fresh foreground precise/current location and must not fall back to profile city, saved profile location, or event registration location.
- Clients must never receive raw coordinates, exact distance, nearby counts, or map pins.
- Backend derives tier, radius, eligibility, visibility, cooldowns, and entitlement decisions.
- PostGIS/geography is recommended for RHRN; scalar haversine fallback is only an emergency/deferred option.
- RHRN Vibes use existing Vibely match/chat after mutual consent; no direct pre-match chat is added.
- RHRN Vibe Notes and Teleport credits should use RHRN-specific balances/ledger and usage tables, not legacy video-date credit mutation paths.
- Google Places is backend-only through `rhrn-place-search` and `rhrn-place-resolve`; `GOOGLE_PLACES_API_KEY` is a Supabase Edge secret only.
- RHRN is disabled by default and each backend function must read DB-backed config first and fail closed.

## Rebuild Impact

Docs only.

### Routes

- Added routes/pages: none
- Removed routes/pages: none
- Changed routes/pages: none
- Future route impact documented: `/rhrn`

### Native Tabs / Screens

- Added native tabs/screens: none
- Removed native tabs/screens: none
- Changed native tabs/screens: none
- Future native impact documented: add `apps/mobile/app/(tabs)/rhrn` and update tab order

### Edge Functions

- Edge Function files changed: none
- Edge Function deploy requirement: none
- Future function impact documented: `rhrn-*` user/admin/cleanup functions

### Schema / Storage

- Supabase migrations added: none
- Supabase validation SQL added: none
- Storage changes: none
- Future schema impact documented: proposed `rhrn_*` tables, PostGIS recommendation, RLS posture

### Env Vars / Secrets

- Env vars added/changed: none
- Future secret impact documented: `GOOGLE_PLACES_API_KEY` as Supabase Edge secret only

### Provider / Dashboard Changes

- Provider changes applied: none
- Future provider impact documented: Google Places provider sheet, Stripe RHRN credit packs, RevenueCat RHRN consumables, OneSignal categories

### Generated Types

- Generated Supabase types changed: no
- Future generated type impact documented for implementation migrations

### Rebuild Pack Docs

- Edge Function manifest changed: no
- Migration manifest changed: no
- Schema appendix changed: no
- Machine-readable inventory changed: no
- Future rebuild requirements documented in RHRN rollout/QA plan

## Validation

Required validation for this docs-only branch:

```bash
git diff --check
git status --short
rg -n "rhrn|RHRN|Right Here Right Now" docs/rhrn docs/branch-deltas/rhrn-sprint0-architecture.md
```

Not required for Sprint 0:

- migrations
- Supabase deploy
- Edge Function deploy
- generated types
- web build
- native build
- provider smoke tests

## Unresolved Questions

- Exact RHRN credit table names and product identifiers should be finalized in Sprint 1/Sprint 7 after reviewing current Stripe and RevenueCat settlement branches.
- Exact PostGIS migration should be validated against the linked Supabase project before any cloud deployment.
- Exact RHRN notification preference column names should follow current `notify_*` conventions when Sprint 10 lands.
- RHRN text moderation thresholds for tags and Vibe Notes need product/safety review before enforcement.

## First Safe Implementation Sprint

Sprint 1 should be backend foundation only:

- create inert RHRN config/audit/rollout schema
- seed all kill switches disabled
- add RLS skeleton
- document PostGIS enablement plan or migration
- expose no public route, grid, location capture, Google Places call, Vibe, match, message, notification, or purchase behavior

Rollback for Sprint 1 should be config-first: keep `rhrn_enabled = false`, and use forward migrations for any production correction.
