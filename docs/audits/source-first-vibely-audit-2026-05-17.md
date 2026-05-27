# Source-First Vibely Security And Reliability Audit

Date: 2026-05-17
Target: `Git/vibelymeet`
Mode: local source-first review only. No live/cloud probing was performed.

## Executive Summary

This pass reverse-engineered the active web, Expo native, Supabase Edge Function, SQL/RLS, config, dependency, and contract-test surfaces. The highest-risk findings are:

- Critical privacy leak: direct `profiles` table grants/RLS still expose sensitive profile columns to every authenticated user, despite the safe profile RPC masking those fields.
- Critical auth bypass: `send-email` is unauthenticated at the Supabase gateway and trusts an unsigned JWT `role` claim as `service_role`.
- High chat-media integrity gap: message publish accepts media references by path segment only and can re-bind/retain assets without proving owner + match binding.
- Dependency debt: root audit has 21 advisories including 1 critical and 9 high; mobile audit has 8 advisories including 2 high.

No app source, schema, API, or public type behavior was changed by this audit. This document is the deliverable.

## Verification Summary

Passed:

- `npm run build`
  - Passed. Vite emitted only chunk-size warnings for large bundles.
- `npm run typecheck`
  - Passed.
- `npm run lint`
  - Passed on rerun. An earlier run failed with a transient Vite timestamp module `ENOENT` while other long checks were active.
- `npx tsx scripts/securityHeaders.test.ts`
- `npm run test:auth-redirect-contract`
- `npm run test:browser-diagnostics`
- `npm run test:chat-media-cache`
- `npm run test:daily-room-contract`
- `npm run test:hardening-contracts`
- `npm run test:vibe-video-contract`
- `npm run test:event-booking-safety`
- `npm run test:referrals`
- `npm run test:admin-events-p0`
- `npm run test:admin-p1-ui-safety`
- `npm run test:admin-p2-backend-contracts`
- `npm run test:admin-p3-operations`
- `npm run test:admin-p4-intelligence`
- `npm run test:admin-route-access`
- `npm run test:admin-media-lifecycle`
- `npm run test:date-suggestion-contracts`
- `npm run test:vibe-clip-upload-contract`
- `npm run test:web-vibe-video-trust`
- `npm run test:request-reduction-contract`

Audit baselines:

- Root `npm audit --json --audit-level=low`: 21 total vulnerabilities: 1 critical, 9 high, 9 moderate, 2 low.
- `apps/mobile` `npm audit --json --audit-level=low`: 8 total vulnerabilities: 2 high, 6 moderate.
- Tracked env files are limited to `.env.example` and `apps/mobile/.env.example`.
- Secret-pattern scan of tracked files found placeholder/example names and runtime `Deno.env.get(...)` references, but no obvious committed live keys.

## System Map

- Web app: Vite/React in `src`, route protection and admin routing in `src/App.tsx`.
- Native app: Expo Router under `apps/mobile/app`, shared native API clients under `apps/mobile/lib`.
- Supabase Edge Functions: configured in `supabase/config.toml`; most user functions use gateway JWT verification, while cron/webhook/public-capture functions disable gateway JWT and self-authenticate.
- Auth/admin boundary: user JWTs are resolved via Supabase Auth; privileged reads/writes are concentrated in service-role Edge Functions and `SECURITY DEFINER` RPCs.
- Payments: Stripe checkout/webhook, RevenueCat webhook, credits and subscription sync functions.
- Media: Bunny Storage/Stream flows, media lifecycle tables/RPCs, upload functions, chat media proxy, and worker cleanup.
- Core product flows reviewed: auth redirects, onboarding verification, profile visibility, event lobby, swipe/ready gate, video date, chat/media, date suggestions, referrals, admin, account deletion, notifications, and payment contracts.

## Findings

### VIB-AUD-001: Direct `profiles` Grants Expose PII To Every Authenticated User

Severity: Critical
Category: privacy / security

Evidence:

- `supabase/migrations/20251226160948_a55c9710-fd6f-44cf-b89c-447d97a9c5ca.sql:5` creates `Authenticated users can view profiles` with `USING (auth.role() = 'authenticated')`, which allows every signed-in user to read every profile row permitted by grants.
- `supabase/migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql:19` grants direct `SELECT` on many `profiles` columns to `anon, authenticated`.
- The granted columns include sensitive fields such as `birth_date`, `last_seen_at`, `phone_number`, `phone_verified_at`, `proof_selfie_url`, `premium_granted_by`, and `verified_email` at `supabase/migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql:26`, `:51`, `:61`, `:63`, `:74`, `:71`, and `:85`.
- The safe profile RPC explicitly says private PII and `birth_date` are excluded from the user-facing payload at `supabase/migrations/20260512023000_canonical_other_profile_safe_fields.sql:3` and `supabase/migrations/20260512153000_codex_review_comment_followups.sql:174`, but direct table access bypasses that masking.

Impact:

Any authenticated account can query the REST table endpoint or Supabase client for sensitive fields on all RLS-visible profile rows. In a dating app, phone numbers, full birth dates, proof-selfie URLs, verified emails, premium grant metadata, and activity timestamps are high-sensitivity data. This also weakens block/shared-event access rules because the direct table policy is broader than `get_profile_for_viewer`.

Fix Plan:

- Replace the broad profile SELECT policy with explicit self-only direct access, for example `USING (id = auth.uid())`, plus service-role/admin-only paths.
- Revoke authenticated/anon direct column grants for all PII and backend-owned operational fields.
- Move all other-user profile reads through `get_profile_for_viewer` or narrower RPCs that enforce established-access/shared-event/block rules.
- Keep self settings reads working either through a self-only table policy or a dedicated `get_my_profile_settings` RPC.
- Add a migration that revokes stale column grants and `NOTIFY pgrst, 'reload schema'`.

Acceptance Criteria:

- As user A, direct `profiles` SELECT for user B returns no row or permission denied for `phone_number`, `birth_date`, `verified_email`, `proof_selfie_url`, `last_seen_at`, and `premium_granted_by`.
- User A can still read their own settings/profile fields needed by web and native.
- `get_profile_for_viewer(user_b)` returns only the documented safe display payload when access is allowed, and returns `null` when blocked or not eligible.
- Admin read-model RPCs and service-role jobs continue to pass existing admin contract tests.
- Add a focused RLS/SQL regression test that checks direct column privileges and policy behavior for self, other authenticated user, anon, admin, and service_role.

### VIB-AUD-002: `send-email` Accepts Forged Service-Role JWT Payloads

Severity: Critical
Category: security

Evidence:

- `supabase/config.toml:160` sets `[functions.send-email] verify_jwt = false`.
- `supabase/functions/send-email/index.ts:69` defines `jwtPayloadRole` by base64-decoding the JWT payload with `atob`.
- `supabase/functions/send-email/index.ts:94` accepts the request as service-role when `jwtPayloadRole(token) === 'service_role'`.
- Service-role callers may provide arbitrary `to`, `subject`, and `html`; user callers are only restricted after the service-role shortcut at `supabase/functions/send-email/index.ts:107`.
- The function sends the body to Resend at `supabase/functions/send-email/index.ts:176`.
- CORS is wildcard at `supabase/functions/send-email/index.ts:7`, making browser-origin abuse easier once a forged bearer is supplied.

Impact:

An attacker can send a request with any syntactically valid three-part bearer token whose unsigned payload contains `{"role":"service_role"}`. Because gateway JWT verification is disabled and the function does not verify the signature before trusting the role, the request takes the service-role branch and can send arbitrary email through the app's Resend account. Realistic abuse includes phishing, brand impersonation, provider quota/billing damage, reputation harm, and user-targeted spam.

Fix Plan:

- Remove `jwtPayloadRole` from `send-email`.
- Treat service calls as service only when `token === SUPABASE_SERVICE_ROLE_KEY`, or enable gateway `verify_jwt = true` and verify the role with a signed-token-aware helper.
- Keep the normal authenticated-user path using `supabase.auth.getUser()` and preserve its `welcome`-only/self-email restrictions.
- Restrict CORS with the shared origin helper instead of `Access-Control-Allow-Origin: *`.
- Add explicit tests for forged unsigned service-role payloads.

Acceptance Criteria:

- A forged bearer like `x.<base64({"role":"service_role"})>.x` is rejected with 401/403.
- A normal authenticated user can only send the welcome template to their own canonical email and cannot provide custom `subject` or `html`.
- A legitimate internal service-role invocation still succeeds.
- Static test asserts `send-email` does not decode or trust JWT payload roles while `verify_jwt = false`.
- Resend error logging does not include attacker-provided HTML.

### VIB-AUD-003: Chat Media Publish Can Re-Bind Assets Without Owner/Match Proof

Severity: High
Category: security / data integrity / privacy

Evidence:

- `supabase/functions/send-message/index.ts:50` validates media references by checking only whether a path or URL contains a storage segment such as `photos/`, `voice/`, or `chat-videos/`.
- Vibe Clip publish accepts `video_url` and optional `thumbnail_url` when they include `chat-videos` at `supabase/functions/send-message/index.ts:273`.
- Voice publish accepts `audio_url` when it includes `voice` at `supabase/functions/send-message/index.ts:391`.
- Image messages accept a photo marker URL when it includes `photos` at `supabase/functions/send-message/index.ts:503`.
- `sync_chat_message_media` normalizes message URLs and calls `ensure_chat_media_asset` using the message sender as owner at `supabase/migrations/20260419100000_media_lifecycle_chat_account_cleanup.sql:502` and `:518`.
- `ensure_chat_media_asset` finds existing assets only by provider/path at `supabase/migrations/20260419100000_media_lifecycle_chat_account_cleanup.sql:315`, then preserves existing owner with `COALESCE(public.media_assets.owner_user_id, p_owner_user_id)` at `:326`.
- `attach_chat_media_asset_to_match` then attaches retention references for the current match without checking the asset's original owner or match binding at `supabase/migrations/20260419100000_media_lifecycle_chat_account_cleanup.sql:391`.

Impact:

A signed-in participant in one match can submit a known or leaked Bunny storage path from another match/user as the media reference. The message insert will pass segment validation, and lifecycle sync can attach/retain the asset in the new match. Depending on CDN exposure and how old direct URLs circulate, this can leak or keep alive private chat media outside its intended conversation.

Fix Plan:

- Before inserting a media message, require a registered media asset with `owner_user_id = actorId`, expected `media_family`, expected `provider_path`, and `legacy_table = 'matches'` / `legacy_id = match_id`.
- Consider an upload-session or nonce binding: upload returns a server-issued asset/session id, and send-message consumes that id rather than trusting arbitrary paths.
- In `ensure_chat_media_asset` or a wrapper RPC, reject attempts to bind an existing asset to a different owner or match unless an explicit service-role migration/repair mode is active.
- In `attach_chat_media_asset_to_match`, verify the asset belongs to one of the match participants and is already associated with the same match/upload session.

Acceptance Criteria:

- User A cannot send `voice/{other_match}/...`, `chat-videos/{other_match}/...`, or `photos/{other_user}/...` in match A/B.
- User A can send media immediately after uploading it for the same match.
- Existing legitimate legacy messages can be migrated by an explicit service-role repair job without opening the public publish path.
- Regression tests cover voice, Vibe Clip, thumbnail, and image marker paths across same-owner/same-match, same-owner/different-match, different-owner/same-match, and different-owner/different-match cases.

### VIB-AUD-004: Public Profile Reads And Safe RPC Are Inconsistent

Severity: High
Category: privacy / operational risk

Evidence:

- The safe profile RPC gates other-user reads with `profile_has_established_access` or shared-event access at `supabase/migrations/20260512023000_canonical_other_profile_safe_fields.sql:39`.
- It returns `NULL` when access is not allowed at `supabase/migrations/20260512023000_canonical_other_profile_safe_fields.sql:43`.
- Direct table RLS still uses only `auth.role() = 'authenticated'` at `supabase/migrations/20251226160948_a55c9710-fd6f-44cf-b89c-447d97a9c5ca.sql:5`.
- Direct grants include display and operational fields at `supabase/migrations/20260430194000_distance_visibility_privacy_final_enforcement.sql:19`.

Impact:

Even after removing the most sensitive direct columns, a broad direct-table policy would still allow clients to bypass access rules, safety blocks, and shared-event eligibility that the RPC enforces. That creates a recurring privacy regression risk every time a new profile column is added and granted.

Fix Plan:

- Treat direct `profiles` SELECT as self-only by default.
- Add a migration comment and contract test declaring `get_profile_for_viewer` the only supported other-user read surface.
- Add a schema lint test that fails when new profile columns are granted directly to `anon`/`authenticated` without an allowlist and justification.

Acceptance Criteria:

- A non-admin authenticated user cannot direct-select another profile row through Supabase table APIs.
- All web/native other-profile screens still work through `get_profile_for_viewer`.
- New profile columns cannot be accidentally exposed without updating an explicit allowlist test.

### VIB-AUD-005: Root Dependency Audit Contains Critical/High Advisory Debt

Severity: High
Category: dependency / operational risk

Evidence:

- Root `npm audit --json --audit-level=low` reports 21 vulnerabilities: 1 critical, 9 high, 9 moderate, 2 low.
- Critical: `protobufjs`.
- High: `@playwright/test`/`playwright`, `glob`, `lodash`, `minimatch`, `node-fetch`, `picomatch`, `rollup`, `flatted`.
- Moderate direct/runtime-adjacent advisories include `vite`, `postcss`, `esbuild`, and `dompurify`.
- Direct dependencies in `package.json` include `face-api.js` and direct dev/runtime tooling such as `vite`, `postcss`, and `@playwright/test`.

Impact:

Some advisories are build/dev-only, but others are runtime-adjacent or bundled through app dependencies. The critical `protobufjs` cluster includes arbitrary code/code-generation and denial-of-service issues. `node-fetch` header forwarding can leak secure headers across redirects in vulnerable usages. `rollup` and `vite` advisories increase local/dev/CI risk. The current lockfile leaves the project unable to claim a clean high-severity dependency posture.

Fix Plan:

- Update direct dependencies and lockfile in a dedicated dependency PR.
- Upgrade `@playwright/test` to a version containing the browser download verification fix.
- Upgrade Vite/Rollup/esbuild/PostCSS to patched versions compatible with the app.
- Investigate `face-api.js` as the likely source of old TensorFlow/protobuf/node-fetch chains; replace, isolate, or add narrowly justified overrides if no patched upstream exists.
- Use package overrides only after confirming no runtime breakage.

Acceptance Criteria:

- Root `npm audit --audit-level=high` exits clean, or any remaining advisory has an explicit documented non-runtime exception approved by the owner.
- `npm run build`, `npm run typecheck`, `npm run lint`, and the focused contract suite pass after lockfile changes.
- Face/video verification flows that rely on affected packages are manually smoke-tested or covered by a contract test.

### VIB-AUD-006: Mobile Dependency Audit Contains High Advisory Debt

Severity: High
Category: dependency / operational risk

Evidence:

- `npm audit --json --audit-level=low --prefix apps/mobile` reports 8 vulnerabilities: 2 high, 6 moderate.
- High: `@xmldom/xmldom` XML injection/serialization DoS advisories and `picomatch` glob matching/ReDoS advisories.
- Moderate: Expo CLI/Metro chain through `postcss`, `brace-expansion`, and `yaml`.
- `apps/mobile/package.json` uses Expo SDK 55-era dependencies and `patch-package`, so dependency updates need SDK-compatible testing.

Impact:

Mobile build tooling and XML processing dependencies may be reachable during config/plugin/build steps. The practical exploit surface is likely developer/CI input and provider metadata rather than arbitrary end-user runtime, but the mobile app still ships with high advisory debt.

Fix Plan:

- Run an Expo-compatible dependency update pass in `apps/mobile`.
- Upgrade or override `@xmldom/xmldom`, `picomatch`, `postcss`, `brace-expansion`, and `yaml` through the owning Expo/Metro packages where possible.
- Avoid blind `npm audit fix --force` if it crosses Expo SDK compatibility boundaries.

Acceptance Criteria:

- `cd apps/mobile && npm audit --audit-level=high` exits clean, or residual high advisories are documented with reachability analysis.
- `cd apps/mobile && npm run typecheck` passes.
- Native launch preflight and core mobile chat/video/date contract tests pass after lockfile updates.

### VIB-AUD-007: Upload Functions Trust Client MIME Type Without Content Sniffing

Severity: Medium
Category: security / privacy

Evidence:

- `upload-image` accepts image files by `file.type` only at `supabase/functions/upload-image/index.ts:63`.
- It writes the same client-provided `Content-Type` to Bunny Storage at `supabase/functions/upload-image/index.ts:114`.
- `upload-voice` accepts audio by `file.type`/`startsWith("audio/")` at `supabase/functions/upload-voice/index.ts:50`.
- `upload-chat-video` accepts video by `file.type`/`startsWith("video/")` at `supabase/functions/upload-chat-video/index.ts:76`.
- Thumbnail validation in `upload-chat-video` similarly trusts `thumbnailFile.type` at `supabase/functions/upload-chat-video/index.ts:147`.

Impact:

A malicious or compromised client can upload arbitrary bytes while declaring an allowed MIME type. If the CDN or a downstream consumer sniffs, downloads, previews, or rehosts content differently from the declared type, this can become a stored content smuggling/XSS/malware delivery issue. It also weakens moderation and media-lifecycle assumptions.

Fix Plan:

- Add server-side magic-byte validation for JPEG/PNG/WebP/HEIC, common audio containers, MP4/MOV/WebM, and thumbnails.
- Normalize `Content-Type` from sniffed content, not client input.
- Quarantine or reject files whose bytes do not match the claimed type.
- Consider post-upload provider metadata verification for video duration/container if Edge runtime limits prevent deep parsing.

Acceptance Criteria:

- A fake HTML/JS payload uploaded as `image/jpeg`, `audio/webm`, or `video/mp4` is rejected.
- Valid JPEG/PNG/WebP/HEIC, WebM/MP4/MOV, and supported audio samples pass.
- Bunny Storage `Content-Type` matches the server-sniffed type.
- Regression tests exist for image, voice, video, and thumbnail upload paths.

### VIB-AUD-008: Chat Media Proxy Tokens Are Delivered In Query Strings

Severity: Medium
Category: privacy / operational risk

Evidence:

- `get-chat-media-url` issues a five-minute HMAC token at `supabase/functions/get-chat-media-url/index.ts:179`.
- It returns a proxy URL with `?token=...` at `supabase/functions/get-chat-media-url/index.ts:192`.
- The proxy reads the token from `new URL(req.url).searchParams` at `supabase/functions/get-chat-media-url/index.ts:201`.
- Browser resolver caches and renders the returned URL at `src/lib/chatMediaResolver.ts:93`.

Impact:

The token is short-lived and signed, which is good. Query-string bearer material is still prone to leakage through browser history, network/proxy logs, crash reports, analytics breadcrumbs, and `Referer` headers when media loads cause secondary requests. This is a privacy concern for private chat media even with a five-minute TTL.

Fix Plan:

- Prefer an opaque server-side token id or signed path segment over query-string bearer tokens.
- Add `Referrer-Policy: no-referrer` or at least `strict-origin` on app pages and media responses.
- Ensure browser diagnostics/Sentry/PostHog redaction specifically catches `get-chat-media-url?token=`.
- Consider one-time token redemption for especially sensitive media.

Acceptance Criteria:

- Chat media URLs no longer expose bearer tokens in query strings, or redaction/referrer controls are verified end to end.
- Browser diagnostics tests include `get-chat-media-url?token=SECRET` and assert the token is redacted.
- Media still streams with Range support and expires as expected.

### VIB-AUD-009: Resolved HTTP Chat Media URLs Bypass The Signed Proxy

Severity: Medium
Category: privacy / data integrity

Evidence:

- `src/lib/chatMediaResolver.ts:30` treats any `http(s)` URL as already resolved.
- `src/lib/chatMediaResolver.ts:44` and `:55` return already-resolved HTTP refs directly instead of calling `get-chat-media-url`.
- `upload-voice` still returns both `path` and full `url` at `supabase/functions/upload-voice/index.ts:163`.
- `upload-chat-video` still returns full `url` and `thumbnail_url` at `supabase/functions/upload-chat-video/index.ts:234`.

Impact:

Current clients often prefer `path`, but legacy rows, old native clients, or crafted service paths can keep full CDN URLs in message rows. The resolver then bypasses the signed proxy and any future access checks/redaction for those rows. This creates inconsistent privacy guarantees and makes public CDN URL cleanup harder.

Fix Plan:

- Stop returning full CDN URLs for new chat uploads, or mark them compatibility-only and remove after client cutoff.
- Change chat media display to proxy any known Bunny chat-media URL, not only raw storage paths.
- Add a migration/repair job to normalize existing message `audio_url`, `video_url`, and thumbnail payload fields from full CDN URLs to provider paths.

Acceptance Criteria:

- Existing full Bunny URLs in chat message rows resolve through `get-chat-media-url` rather than rendering directly.
- New upload responses used by web/native send paths store only provider paths.
- Regression tests cover raw path, Bunny CDN URL, unrelated external URL, local preview URL, and invalid message id cases.

### VIB-AUD-010: Email Verification Logs Raw Email Addresses And Provider Bodies

Severity: Medium
Category: privacy / operational risk

Original Evidence:

- Before Sprint 6, `email-verification` logged Resend request metadata with raw `to` email at `supabase/functions/email-verification/index.ts:187`.
- Before Sprint 6, it logged the full parsed provider response body at `supabase/functions/email-verification/index.ts:240`.
- Before Sprint 6, it logged canonical/requested email values in `send_user_resolved` at `supabase/functions/email-verification/index.ts:326`.
- Before Sprint 6, it logged `OTP sent successfully to ${authEmail}` at `supabase/functions/email-verification/index.ts:453`.
- Before Sprint 6, it logged `Verifying OTP ... email: ${authEmail}` at `supabase/functions/email-verification/index.ts:504`.

Impact:

The function did not log the raw OTP, which was good. Before Sprint 6, it did put email addresses and arbitrary provider response bodies into function logs. Logs often have wider retention and audience than primary data stores, and provider errors can include request fragments. This was unnecessary PII exposure.

Fix Plan:

- Replace raw email logs with a stable hash prefix or masked address.
- Log provider status, id presence, error code, and safe category only; do not log full provider response bodies.
- Keep request ids and user ids for debugging, but avoid raw contact values.

Acceptance Criteria:

- Static test fails if `email-verification` logs `authEmail`, `requestedEmail`, `canonicalAuthEmail`, or Resend `body` directly.
- Operational logs still show request id, user id, stage, provider status, and safe error category.
- Manual OTP send/verify failure still has enough diagnostics without raw email addresses.

Status update (2026-05-27):

- Remediated in Sprint 6. `email-verification` now logs Resend status, ok flag, provider id/request id when present, and body length only.
- User/canonical/requested email values are represented as presence/match booleans in logs, not raw addresses.
- `shared/matching/resendEmailProviderOperationalQa.test.ts` and `shared/authSprint6Contracts.test.ts` guard this posture.

### VIB-AUD-011: Phone Verification Health Check Leaks Provider Configuration State

Severity: Low
Category: operational risk / privacy

Original Evidence:

- Before Sprint 6, `phone-verify` required a valid user token, then returned `hasSid`, `hasToken`, and `hasVerify` for `action === "health_check"` at `supabase/functions/phone-verify/index.ts:79`.
- Before Sprint 6, the web phone verification UI called this path at `src/components/PhoneVerification.tsx:146`.

Impact:

Before Sprint 6, any authenticated user could learn whether Twilio account, auth token, and verify-service secrets were configured in the current environment. This did not reveal the secret values, but it leaked operational state and could help attackers time abuse or social-engineering reports.

Fix Plan:

- Remove the public health check, or restrict it to admin/service-role callers.
- If the client needs UX readiness, expose a coarse `smsAvailable` boolean from an admin-safe or feature-config endpoint without naming missing secrets.

Acceptance Criteria:

- Non-admin authenticated callers cannot retrieve `hasSid`, `hasToken`, or `hasVerify`.
- Phone verification UI still shows a user-friendly unavailable state when SMS is not configured.
- Admin/ops diagnostics can still inspect provider setup through an admin-only surface.

Status update (2026-05-27):

- Remediated in Sprint 6. The client-callable `health_check` action was removed from `phone-verify`, and the web phone verification component no longer calls it.
- Provider config failures now return coarse user-safe copy and log only `missingCount`, not missing secret names or secret presence booleans.
- `shared/matching/twilioPhoneVerificationQa.test.ts` and `shared/authSprint6Contracts.test.ts` guard this posture.

### VIB-AUD-012: `ready_gate_transition` Grants Execute To `anon`

Severity: Concern
Category: security / operational risk

Evidence:

- Latest wrapper migration grants `ready_gate_transition(uuid, text, text)` to `anon, authenticated, service_role` at `supabase/migrations/20260505214500_video_date_rpc_short_circuit_and_daily_keepwarm.sql:56`.
- The hardened base function sets `v_actor := auth.uid()` and returns unauthorized when null at `supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql:28` and `:48`.

Impact:

The current body appears to fail closed for unauthenticated callers, so this is not an active bypass. The unnecessary anon grant widens the callable surface, complicates access review, and creates risk if future wrappers accidentally perform side effects before delegating to the auth-guarded base.

Fix Plan:

- Revoke anon execute from `ready_gate_transition`.
- Keep grants only for `authenticated` and `service_role`.
- Add a contract test so future wrapper migrations cannot reintroduce anon execute.

Acceptance Criteria:

- Anonymous RPC invocation fails at privilege level before function body execution.
- Authenticated participants can still mark ready/snooze/forfeit.
- Existing Ready Gate web/native contract tests continue to pass.

## Non-Findings And Positive Controls

- `request-account-deletion` is intentionally unauthenticated but uses Turnstile, origin checks, hashed IP/email rate limiting, and enumeration-safe responses.
- `get-chat-media-url` is unauthenticated at gateway for GET proxying, but POST resolves a real user token and GET requires an HMAC token.
- `chat-thread-page` uses gateway JWT, resolves the user, verifies match membership, then uses service role for the data read.
- Stripe and RevenueCat webhooks are unauthenticated at gateway but validate provider signatures/secrets in-function.
- Admin surfaces are largely RPC-backed and heavily covered by contract tests.
- Focused contract coverage for event lobby, Ready Gate, video date, Daily rooms, date suggestions, referrals, admin, media lifecycle, and diagnostics is strong and passed locally.

## Immediate Triage Order

1. Patch `profiles` direct RLS/grants and add regression coverage.
2. Patch `send-email` service-role authorization and CORS.
3. Patch chat media asset binding checks in `send-message` and lifecycle RPCs.
4. Start dependency update PRs for root and mobile.
5. Harden upload MIME sniffing and chat media proxy/referrer handling.
6. Clean up privacy/ops concerns in verification logs, phone health checks, and anon Ready Gate grants.
