# Distance Visibility Stage 1 Rollout

Date: 2026-04-26

## Scope

PR #503 merged as Stage 1 only at main commit `4081725331fddc27e2d999897147a2b2a8a84e8f`.

Stage 1 migration is deployed to Supabase project `schdyxcunwcvddlcshwd`:

- `supabase/migrations/20260430193000_distance_visibility_privacy_enforcement.sql`

Stage 2 remains pending only and must not be deployed yet:

- `supabase/pending_migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql`

Issue #504 tracks Stage 2 revoke/drop work.

## Stage 1 Status

Stage 1 is production-QA complete. No further Stage 1 action is required.

Completed checks:

- Distance visibility setting toggles `Approximate` to `Hidden` and back.
- The setting persists after refresh/reopen.
- `get_my_location_data()` is available through PostgREST for authenticated self-location reads.
- `get_profile_for_viewer` returns `display_location` and `distance_label`, and no raw `location_data`, `lat`, or `lng`.
- Approximate other-user profile UI shows only a coarse backend bucket (`<5 km away` in the smoke run).
- Hidden other-user profile UI shows no distance section or bucket.
- No raw coordinate terms appeared in UI: `location_data`, `lat`, `lng`, `latitude`, `longitude`.
- Event venue distance remains separate from user-to-user distance and displays from `distance_km`.
- Temporary QA event fixture was cleaned up.
- Smoke profile `Direk` was restored to `distance_visibility = approximate` and `show_distance = true`.
- Stage 2 migration row count in remote history is `0`.
- No Stage 1 console/RPC/schema-cache/permission errors were observed.

## QA Evidence

Smoke identities:

- Primary viewer: `kaanporsuk@gmail.com`
- Target profile: `Direk` / `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`

Hidden target profile QA:

- Target confirmed as configured smoke partner.
- Before snapshot: `distance_visibility = approximate`, `show_distance = true`.
- Temporary state: `distance_visibility = hidden`; trigger set `show_distance = false`.
- `/user/2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` loaded as the primary smoke user.
- No distance bucket or distance heading appeared.
- Restored state: `distance_visibility = approximate`, `show_distance = true`.

Event venue distance QA:

- Production initially had no visible upcoming events for the primary smoke account.
- Temporary event title prefix: `QA_DO_NOT_USE_DISTANCE_VISIBILITY_STAGE1_`.
- `get_visible_events` returned the fixture with `distance_km = 2.22389853289152`.
- Events UI showed the fixture under `Near You` with rounded venue distance.
- UI did not show precise decimal km or raw coordinate terms.
- Cleanup verification: zero rows remain with prefix `QA_DO_NOT_USE_DISTANCE_VISIBILITY_STAGE1_`.

Validation and safety:

- `supabase/validation/distance_visibility_privacy_stage1.sql` passed.
- `git status --short` was clean after QA.
- `supabase migration list --linked` showed `20260430193000` applied.
- Remote history check showed Stage 2 migration version `20260430194000` count `0`.

## Stage 2 Gate

Stage 2 remains blocked. Do not move or deploy the pending migration until the native rollout risk is closed by one of:

- native adoption confirmed for a build that uses `get_my_location_data()`;
- proof that no native build using the old direct self `profiles.location_data` read path is in users' hands; or
- a minimum supported native build/version is enforced.

Current repo evidence does not confirm any of those conditions. Native launch docs still track native build/install/provider validation as open launch work, especially `docs/native-final-blocker-matrix.md`.

Stage 2 work remains:

- Move `supabase/pending_migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql` into `supabase/migrations`.
- Deploy Stage 2 only after the gate above is satisfied.
- Run `supabase/validation/distance_visibility_privacy_stage2.sql`.
- Remove temporary self-only `location_data` fallback helpers from:
  - `src/services/myLocationData.ts`
  - `apps/mobile/lib/myLocationData.ts`
- Confirm direct client `SELECT(location_data)` fails for anon/authenticated.
- Confirm `get_my_location_data()` still works for self.

## Later Cleanup

- Deprecate and remove legacy `profiles.show_distance`.
- Remove the sync trigger once all clients and generated types use `distance_visibility` only.
