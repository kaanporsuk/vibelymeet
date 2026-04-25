# Distance Visibility Stage 2 Final Enforcement

Date: 2026-04-26

## Scope

Stage 2 closes the remaining raw coordinate exposure risk after Stage 1 shipped the compatible backend contracts.

Stage 1 is already live:

- Main commit: `4081725331fddc27e2d999897147a2b2a8a84e8f`
- Supabase project: `schdyxcunwcvddlcshwd`
- Stage 1 migration: `supabase/migrations/20260430193000_distance_visibility_privacy_enforcement.sql`

Stage 2 PR moves the final enforcement migration into the deployable migration path:

- `supabase/migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql`

The migration must not be deployed until after PR review and merge.

## Gate

Kaan cleared the native rollout gate on 2026-04-26 by confirming that no native build is in real user hands. This satisfies the Stage 2 requirement that old native clients cannot still depend on direct `profiles.location_data` self-selects.

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

After deployment, run:

```sh
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked --yes
supabase db query --linked -o table -f supabase/validation/distance_visibility_privacy_stage2.sql
```

`supabase/validation/distance_visibility_privacy_stage2.sql` validates:

- direct client `SELECT profiles.location_data` fails for `anon` and `authenticated`;
- `get_my_location_data()` still returns the authenticated user's own exact location;
- `get_profile_for_viewer()` returns no `location_data`, `lat`, or `lng`;
- hidden distance visibility returns no distance label;
- approximate distance visibility returns only an allowed coarse bucket.

## Manual QA After Deploy

- Sign in on production web as the smoke user.
- Confirm Settings -> Privacy & Visibility opens.
- Toggle Distance visibility between `Approximate` and `Hidden`.
- Confirm the setting persists after refresh.
- Open a profile detail surface for another user.
- Confirm `Approximate` shows only a coarse bucket if a user-distance label is present.
- Confirm `Hidden` shows no user-distance label.
- Confirm no raw coordinate terms appear in UI.
- Open Events and confirm nearby/local event discovery still works.
- Confirm event venue distance remains present and distinct from user-to-user distance.
- Check browser console/network for permission, schema-cache, location hydration, and profile load errors.

## Later Cleanup

Do not remove `profiles.show_distance` in Stage 2. Deprecate `show_distance` and its sync trigger later in a separate low-risk cleanup PR after Stage 2 is live and verified.
