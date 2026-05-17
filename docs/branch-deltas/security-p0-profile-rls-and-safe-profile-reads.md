# Security Delta: P0 Profile RLS And Safe Reads

Date: 2026-05-17
Branch: `security/p0-profile-rls-and-safe-profile-reads`

## Scope

Closes the source-first audit items VIB-AUD-001 and VIB-AUD-004 for profile privacy:

- Direct `public.profiles` SELECT is no longer a broad authenticated-user read model.
- Normal clients can directly read only a narrow owner projection, and only for `auth.uid() = profiles.id`.
- Private owner fields moved to `get_my_profile_settings()`.
- Other-user profile display is routed through `get_profile_for_viewer()` or client helpers backed by that RPC.

## Database Delta

Migration: `supabase/migrations/20260517123000_profile_direct_select_self_only.sql`

- Drops broad/relationship/event/daily-drop direct profile SELECT policies.
- Recreates `Users can view own profile` as `auth.uid() = id`.
- Resets legacy table and column SELECT grants for `PUBLIC`, `anon`, and `authenticated`.
- Re-grants only safe direct owner columns to `authenticated`.
- Revokes direct grants for PII/backend-owned fields, including `birth_date`, `location_data`, `phone_number`, `verified_email`, `proof_selfie_url`, referral attribution, premium grant dates, suspension details, activity timestamps, and verification timestamps.
- Preserves `service_role` direct SELECT.
- Adds `get_my_profile_settings()` as an owner-only `SECURITY DEFINER` RPC for web/native profile settings.
- Reasserts `get_profile_for_viewer()` as the canonical safe other-user display RPC, including `subscription_tier` only as a display badge field so chat headers keep product parity without reopening direct table reads.
- Adds `get_profiles_for_viewer()` as a capped batch wrapper that delegates each requested row to `get_profile_for_viewer()`, preserving list-surface performance without broad table grants.
- Reloads the PostgREST schema.

Validation pack: `supabase/validation/profile_direct_select_privacy.sql`

- Covers anon, authenticated self, authenticated other-user, blocked/not eligible other-user, admin, service role, direct-table-vs-RPC expectations, and safe batch-RPC list reads.

## Client Delta

- Web and native self profile/settings reads now use `fetchMyProfileSettings()`.
- The web and native profile-settings helpers expose typed owner/settings fields so call sites do not depend on broad casts or direct private-column SELECTs.
- Matched profiles, chat thread headers, schedule hub partner rows, report target pickers, and match-call partner summaries now use canonical safe profile fetch helpers backed by `get_profile_for_viewer()`.
- Match lists, schedule hub lists, and report target pickers use `get_profiles_for_viewer()` through `fetchUserProfiles()` so they retain one network call for profile lists.
- Existing owner updates remain direct `profiles` updates under self RLS and backend field guards.
- Phone-verification, account-break, event-phone-nudge, referral, and profile-studio reads now fail soft through the owner RPC instead of relying on revoked private column grants.

## Final Source Audit

- Re-scanned direct app `profiles` SELECTs and confirmed remaining browser/native reads request only safe self/admin columns covered by the direct owner projection.
- Re-scanned app profile list surfaces and confirmed other-user list/header reads use `fetchUserProfile()` or `fetchUserProfiles()` instead of direct table reads.
- Re-checked migration column revoke/grant coverage against the generated `profiles` type: all current profile columns are explicitly revoked from `PUBLIC`/`anon`/`authenticated`; only the safe owner projection is re-granted to `authenticated`.
- UX latency pass: normal list reads stay batched; missing-batch-RPC fallback is capped to small slices and only used for missing-function/schema-cache deploy windows, avoiding a 100-request burst on mobile/web.
- Removed one ignored local artifact: `docs/.DS_Store`.

## Regression Coverage

New source contract:

- `shared/profile/profileDirectPrivacyContracts.test.ts`
- npm script: `npm run test:profile-privacy-contract`

Updated existing contracts:

- `shared/matching/photoVerificationContracts.test.ts`
- `shared/matching/twilioPhoneVerificationQa.test.ts`
- `shared/profile/canonicalOtherProfileContracts.test.ts`

## Verification

Passed:

- `npm run test:profile-privacy-contract`
- `npm run typecheck`
- `npm run lint`
- `npm run test:referrals`
- `npm run test:chat-media-cache`
- `npm run test:chat-back-navigation`
- `npm run test:chat-scrollability`
- `npm run test:chat-overflow-actions`
- `npm run test:chat-native-lifecycle`
- `npm run test:date-suggestion-contracts`
- `npm run test:event-lobby-regression`
- `npm run test:event-booking-safety`
- `npm run test:vibe-video-contract`
- `npm run test:auth-redirect-contract`
- `npm run test:request-reduction-contract`
- `npm run test:profile-studio-mobile-overflow`
- `npm run test:admin-route-access`
- `npm run test:hardening-contracts`
- `npx tsx shared/matching/photoVerificationContracts.test.ts`
- `npx tsx shared/matching/twilioPhoneVerificationQa.test.ts`
- `npx tsx shared/matching/videoDateLaunchAcceleration.test.ts`
- `npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts`
- `npx tsx shared/profile/canonicalOtherProfileContracts.test.ts`
- `git diff --check`

Build note:

- Web/native builds were intentionally not rerun during the final devil's-advocate pass per manual-test handoff instructions.
