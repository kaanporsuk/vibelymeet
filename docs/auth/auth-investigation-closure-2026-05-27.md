# Auth Investigation Closure Ledger

Date: 2026-05-27

This document consolidates the original Vibely auth investigation with the separate report assessment. It started as a Sprint 0 baseline artifact; the current repo now also carries the Sprint 1 profile write hardening migration and contracts. Live environments still need the migration applied before the audit turns green.

## Findings Carried Forward

Status after the current repo changes:

- Implemented in repo, pending live migration: `public.profiles` write grants are narrowed to owner-editable columns only.
- Implemented in repo, pending live migration: `phone_number`, `verified_email`, phone/email/photo verification state, proof-selfie references, and photo verification expiry are backend-owned trust fields.
- Implemented in repo, pending live migration: direct profile inserts are blocked unless they come from trusted backend context; auth bootstrap sets that context explicitly.
- Implemented in repo, pending live migration: `bootstrap_profile_from_auth_user()` and `resolve_entry_state()` execute grants are tightened.
- Still manual: dashboard-only provider settings must be verified for identity linking, Google, Apple, Twilio, Resend SMTP, redirect allow-list, CAPTCHA, and rate limits.
- Web OAuth callback should not rely on a fixed 100ms sleep and should preserve provider context across redirect.
- Web identity-linking callback must surface OAuth/linking errors before clearing URL parameters.
- Linked-method UI must distinguish confirmed identities from synthetic session-level email/phone entries that may still be pending confirmation.
- `autoRefreshToken:false` is mitigated by managed refresh, but cold-start refresh should happen before protected route data is fetched when a persisted session is expired or near expiry.
- Phone OTP first-send error paths need cooldown behavior on web and native.
- Auth UI should expose forgot-password entry points outside only the email sign-in subview.
- Auth CAPTCHA is not wired in app code yet; dashboard CAPTCHA state must be verified and Sprint 4 should add web/native token collection before enabling it.
- Account deletion already creates/ensures a durable deletion request before Stripe cancellation, but still needs idempotency and better external-side-effect observability.
- Metadata display names from auth providers should be sanitized before profile bootstrap writes.
- `ensureProfileReady()` should be documented as a defensive check around the DB trigger.
- Native `profile-preview` should join the protected root segment list for route consistency.
- `email-verification` logs should avoid recipient PII and full provider response bodies.
- `phone-verify` `health_check` should be admin/service-only or removed.
- `verification_attempts` throttling should be split or namespaced by flow.

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
- "`delete-account` cancels Stripe before inserting the deletion request." Stale. Current code creates/ensures the deletion request before Stripe cancellation. Sprint 5 should harden idempotency and failure recording, not reverse an already-correct order.
- "Native `authUserIdRef` race." Stale. Native sets the ref synchronously inside `applyAuthSession()`.
- "All SECURITY DEFINER functions check `auth.uid()` internally." Disgrounded. There are many definer functions, bootstrap is trigger-owned and does not check `auth.uid()`, and live routine grants still need tightening.
- "Web Supabase JS defaults to PKCE." Wrong for the installed SDK. Web currently uses implicit flow unless explicitly configured; native explicitly sets `flowType: 'pkce'`.
- "Direct `GET /profiles?id=eq.{uuid}` always returns 403." Overstated. Owner safe-column direct reads exist; cross-user direct profile reads must remain blocked.
- "OAuth params are not stripped." Mostly stale. Current sign-in callback clears params, but provider context is lost across full redirect.

## Sprint Mapping

- Sprint 0: audit harness, npm scripts, dashboard checklist, this closure ledger.
- Sprint 1: database privilege hardening, trust-field trigger protection, routine grant tightening, and write-privilege contracts.
- Sprint 2: manual dashboard/provider verification.
- Sprint 3: OAuth, identity linking, web PKCE decision, and session refresh resilience.
- Sprint 4: abuse controls, CAPTCHA, cooldowns, and auth UX.
- Sprint 5: account deletion idempotency and provider side-effect observability.
- Sprint 6: data quality, route hygiene, logging reduction, and throttling namespaces.
- Sprint 7: release certification and rollout.
