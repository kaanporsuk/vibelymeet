# Activity Status Privacy Boundary Delta

Branch: `fix/activity-status-privacy-boundary`

## Summary

Activity Status is now treated as a backend privacy boundary instead of a cosmetic setting. User-facing clients no longer select raw `profiles.last_seen_at` for chat presence, and normal client SELECT access to raw profile activity columns is revoked by an additive migration.

## Backend Delta

- Added migrations:
  - `20260430201000_activity_status_privacy_boundary.sql`
  - `20260430202000_activity_status_ghost_rpc_lint_fix.sql`
  - `20260430203000_activity_status_ghost_rpc_score_cast.sql`
  - `20260430204000_activity_status_rpc_execute_grants.sql`
- Added masked presence RPCs:
  - `can_view_profile_presence(p_viewer_id, p_target_user_id, p_event_id default null)` as a caller-bound helper; execute is not granted to normal clients.
  - `get_profile_presence_for_viewer(p_target_user_id, p_event_id default null)`
  - `get_chat_partner_presence(p_match_id)`
- Added owner settings RPCs:
  - `get_my_privacy_settings()`
  - `update_my_privacy_settings(p_patch jsonb)`
- Added `mark_my_activity_seen()` so heartbeat writes are server-owned and skipped when the caller has `activity_status_visibility = 'nobody'`.
- Revoked normal client SELECT on `profiles.last_seen_at`, `profiles.activity_status_visibility`, and `profiles.show_online_status`.
- Hardened `detect_ghost_bootstrap_accounts` with an internal `has_role(auth.uid(), 'admin')` SQL guard.
- Tightened RPC execute grants so the internal presence helper is service-role-only and user-facing RPCs are not executable by `anon`.
- Documented event and match-call timestamps as operational presence, not public user-facing activity status.

## Client Delta

- Web and native chat now fetch partner presence through `get_chat_partner_presence`.
- Chat presence fails closed: RPC error or `can_view_presence = false` hides online dots and activity text while preserving messages/profile loading.
- Web and native privacy settings now use the owner-only settings RPCs.
- Web and native Activity Status labels and descriptions share `shared/activityStatusVisibility.ts`.
- Heartbeat hooks now call `mark_my_activity_seen()` instead of directly updating `profiles.last_seen_at`.

## Rebuild / Deploy Delta

- Supabase deploy status: applied to linked project `schdyxcunwcvddlcshwd`.
- Applied command family: `supabase db push --linked`.
- No new env vars, secrets, providers, dashboards, or external services.
- `src/integrations/supabase/types.ts` was regenerated from linked cloud schema with `npm run regen:supabase-types`.

## Verification

- Shared helper tests: `node --import tsx --test shared/activityStatusVisibility.test.ts`
- Typecheck: `npm run typecheck`
- Linked cloud lint: Activity Status migrations clear; remaining `--fail-on error` failures are pre-existing `admin_*event_payment_exception` target-id type issues.
- Staging/cloud seeded SQL verification script: `docs/activity-status-privacy-verification.sql`
