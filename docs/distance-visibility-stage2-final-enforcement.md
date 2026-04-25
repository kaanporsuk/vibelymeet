# Distance Visibility Stage 2 Final Enforcement

Date: 2026-04-26

## Final Status

Stage 2 final enforcement is complete.

- PR #506 merged to `main` at `bf9ee817802320c1843743c598c0cea4ef771bf8`.
- Vercel production deploy for `bf9ee817802320c1843743c598c0cea4ef771bf8` succeeded.
- Supabase project `schdyxcunwcvddlcshwd` applied `20260430194000_distance_visibility_privacy_final_enforcement.sql`.
- `supabase/validation/distance_visibility_privacy_stage2.sql` passed after deploy.
- Issue #504 is closed as completed.

## Scope

Stage 2 closes the remaining raw coordinate exposure risk after Stage 1 shipped the compatible backend contracts.

Stage 1 is already live:

- Main commit: `4081725331fddc27e2d999897147a2b2a8a84e8f`
- Supabase project: `schdyxcunwcvddlcshwd`
- Stage 1 migration: `supabase/migrations/20260430193000_distance_visibility_privacy_enforcement.sql`

Stage 2 moved the final enforcement migration into the deployable migration path:

- `supabase/migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql`

## Gate

Kaan cleared the native rollout gate on 2026-04-26 by confirming that no native build is in real user hands. This satisfied the Stage 2 requirement that old native clients cannot still depend on direct `profiles.location_data` self-selects.

## Changes

Stage 2 removes the temporary self-location compatibility fallback from:

- `src/services/myLocationData.ts`
- `apps/mobile/lib/myLocationData.ts`

Both helpers now call `get_my_location_data()` only.

The Stage 2 migration:

- revokes direct `SELECT(location_data)` from `anon` and `authenticated`;
- reissues safe profile column grants excluding `location_data`;
- drops the legacy `"Anyone can view profiles"` policy defensively;
- keeps `profiles.location_data` for backend/RPC internals;
- keeps event venue `distance_km` unchanged;
- sends `NOTIFY pgrst, 'reload schema'`.

## Validation

`supabase/validation/distance_visibility_privacy_stage2.sql` passed after deploy and confirmed:

- direct client `SELECT profiles.location_data` fails for `anon` and `authenticated`;
- authenticated matched/co-attendee direct `SELECT profiles.location_data` is denied;
- `service_role` keeps operational access;
- `get_my_location_data()` still returns the authenticated user's own exact location;
- `get_profile_for_viewer()` returns no `location_data`, `lat`, or `lng`;
- hidden distance visibility returns no distance label;
- approximate distance visibility returns only an allowed coarse bucket.

## Manual QA

Production smoke account: `kaanporsuk@gmail.com`

Passed checks:

- Settings -> Privacy & Visibility opened.
- Distance visibility toggled `Approximate` -> `Hidden` -> `Approximate`.
- The setting persisted after reload.
- Trigger sync was observed:
  - `Hidden` -> `show_distance = false`
  - `Approximate` -> `show_distance = true`
- Accessible target profile `Direk` loaded.
- Approximate profile display showed only the coarse bucket `<5 km away`.
- No raw coordinate terms appeared in UI.
- Events page loaded without Stage 2 RPC/schema/permission errors.

Manual QA boundaries:

- The local partner smoke password was invalid, so a fresh second-viewer Hidden visual check was not repeated after Stage 2. Stage 2 SQL validation covers the Hidden backend contract, and Stage 1 manual QA already covered Hidden profile UI rendering.
- The smoke account had zero visible events after Stage 2, so event venue distance UI was not re-proved without creating a fixture. Stage 1 fixture QA already covered event venue distance rendering, and Stage 2 did not change event distance behavior.

## Later Cleanup

Do not remove `profiles.show_distance` in this closure. Deprecate `show_distance` and its sync trigger later in a separate low-risk cleanup PR after Stage 2 is live and verified.
