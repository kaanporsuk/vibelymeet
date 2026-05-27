# Auth Investigation Closure Ledger

Date: 2026-05-27

This document consolidates the original Vibely auth investigation with the separate report assessment. It started as a Sprint 0 baseline artifact; the current repo now also carries the Sprint 1-7 auth hardening code, migrations, docs, contracts, and release certification. Production Supabase project `schdyxcunwcvddlcshwd` passes the post-Sprint-6 live auth audit with `0 fail, 0 warn, 40 checks`.

## Findings Carried Forward

Status after the current repo changes and the latest live audit:

- Live-confirmed: `public.profiles` write grants are narrowed to owner-editable columns only.
- Live-confirmed: `phone_number`, `verified_email`, phone/email/photo verification state, proof-selfie references, and photo verification expiry are backend-owned trust fields.
- Live-confirmed: direct profile inserts are blocked unless they come from trusted backend context; auth bootstrap sets that context explicitly.
- Live-confirmed: `bootstrap_profile_from_auth_user()` and `resolve_entry_state()` execute grants are tightened.
- Sprint 2 dated provider closure exists at `docs/auth/provider-live-check-2026-05-27.md`.
- Sprint 3 implemented: web and native Supabase clients explicitly use PKCE, web OAuth callbacks carry provider context, generic email confirmation/email-change auth returns are consumed manually, auth-return URLs are scrubbed after capture, bootstrap refresh runs before entry-state resolution, expired-session redirects surface user copy, and linked-method UI distinguishes confirmed, pending, and session-email-without-password states.
- Still manual: dashboard-only provider settings must be verified for identity linking, same-email account behavior, Google Cloud, Apple Developer, Twilio SID equality, Resend SMTP, redirect allow-list, CAPTCHA dashboard state, and rate limits.
- Sprint 4 implemented: phone OTP first-send and resend paths now use shared cooldowns on web and native, with provider retry hints honored when present.
- Sprint 4 implemented: auth UI exposes forgot-password entry points from the welcome surface and the email sign-in subview.
- Sprint 4 implemented: web auth renders Turnstile for Supabase Auth entry calls and password reauth surfaces; native auth uses `/auth/challenge` with app-scheme return before token-bearing Supabase calls. Expo Go `exp://` callbacks against the production web challenge are intentionally skipped; use installed staging builds or a local challenge origin for native CAPTCHA smoke. Dashboard CAPTCHA state must still be verified and must not be enabled in production until staging smoke passes.
- Sprint 5 implemented: authenticated account deletion now treats the pending deletion request as the idempotency anchor, retries safely after consumed reauth only with fresh proof or same-code recent email proof, aborts before Stripe if request creation fails, cancels non-terminal Stripe subscription states, records Stripe cleanup failures to payment observability, and returns user-safe retry/support copy without losing the pending request.
- Sprint 6 implemented: metadata display names from auth providers are sanitized before profile bootstrap writes.
- Sprint 6 implemented: `ensureProfileReady()` is documented as a defensive, read-only check around the DB trigger and does not client-create profiles.
- Sprint 6 implemented: `email-verification` logs no longer emit recipient/user email values or full Resend response bodies.
- Sprint 6 implemented: `phone-verify` `health_check` has been removed from the client-callable surface.
- Sprint 6 implemented: `verification_attempts` throttling is namespaced by flow so email OTP failures and phone verification sends do not throttle or clear each other.

## Current Live Alignment Note

Production Supabase is aligned with the current repo for Sprints 0-6. The Sprint 6 migration `20260527130000_auth_sprint6_data_quality_observability.sql` has been applied, and the changed `email-verification` and `phone-verify` Edge Functions have been deployed. Post-deploy `npm run audit:auth-live` passes with `0 fail, 0 warn, 40 checks`.

Release-order invariant for future environments: apply the Sprint 6 migration first, then deploy the changed `email-verification` and `phone-verify` Edge Functions, then rerun `npm run audit:auth-live`. Do not deploy the current Edge Function code ahead of the migration, because both functions write `verification_attempts.flow`.

## Supported Current Good State

- Phone sign-in uses Supabase Auth OTP with live `sms_provider = twilio_verify`.
- Google is wired on web through Supabase OAuth and on native through browser OAuth callback hydration.
- Apple is wired on web through Supabase OAuth and on native iOS through `expo-apple-authentication` ID token plus nonce.
- Email sign-in and sign-up use Supabase Auth with confirmation/reset support.
- Web and native email signup pending states include resend.
- Password reset is gated by recovery-ready state, not merely by the presence of any session.
- Web onboarding bypass from the April audit is fixed; routing uses backend `entryState`.
- Admin routes use server verification through `verify-admin`.
- `account_deletion_reauth_challenges` contracts are present and pass.
- Native code and manifests do not import or depend on `expo-av`.

## Stale, Wrong, Or Disgrounded Claims

Do not implement these claims as written:

- "No emergencies." Wrong. The live verified contact trust-field gap is a release-blocking database privilege issue.
- "`delete-account` cancels Stripe before inserting the deletion request." Stale. Current code creates/ensures the deletion request before Stripe cancellation; Sprint 5 has now hardened idempotency and failure recording around that ordering.
- "Native `authUserIdRef` race." Stale. Native sets the ref synchronously inside `applyAuthSession()`.
- "All SECURITY DEFINER functions check `auth.uid()` internally." Disgrounded. There are many definer functions, bootstrap is trigger-owned and does not check `auth.uid()`, and live routine grants still need tightening.
- "Web Supabase JS defaults to PKCE." Wrong for the installed SDK at the time of investigation. Sprint 3 now explicitly configures web and native with `flowType: 'pkce'`.
- "Direct `GET /profiles?id=eq.{uuid}` always returns 403." Overstated. Owner safe-column direct reads exist; cross-user direct profile reads must remain blocked.
- "OAuth params are not stripped." Stale. Current sign-in callback clears params and Sprint 3 carries provider context through redirect before clearing.

## Sprint Mapping

- Sprint 0: audit harness, npm scripts, dashboard checklist, this closure ledger.
- Sprint 1: database privilege hardening, trust-field trigger protection, routine grant tightening, and write-privilege contracts.
- Sprint 2: manual dashboard/provider verification.
- Sprint 3: OAuth, identity linking, web PKCE decision, and session refresh resilience.
- Sprint 4: abuse controls, CAPTCHA, cooldowns, and auth UX.
- Sprint 5: account deletion idempotency and provider side-effect observability.
- Sprint 6: data quality, route hygiene, logging reduction, and throttling namespaces.
- Sprint 7: release certification and rollout. Certification record: `docs/auth/auth-release-certification-2026-05-27.md`.
