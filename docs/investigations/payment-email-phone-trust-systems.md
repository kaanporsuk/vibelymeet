# Payment, Email, Phone Trust Systems Investigation

Date: 2026-05-01
Branch: `docs/investigate-payment-email-phone-trust-systems`
Base: `main` at `467d26ae6`

## Executive Verdict

PASS.

Streams 9, 14, and 15 are closed on `main` and their expected repo artifacts are present. No Stripe idempotency defect, missing closed-stream artifact, committed secret value, real-provider smoke artifact, or cross-system trust/revenue regression was found by static inspection and local validation.

NOT READY markers: none. Stream 14 (`d96bf4ec9`) and Stream 15 (`3610041c0`) are present in recent `main` history and have branch deltas plus static QA tests.

## Artifacts Inspected

Stream 9:

- `supabase/migrations/20260501220000_premium_credits_observability.sql`
- `supabase/validation/premium_credits_observability.sql`
- `supabase/functions/_shared/paymentObservability.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/create-credits-checkout/index.ts`
- `supabase/functions/create-event-checkout/index.ts`
- `supabase/functions/create-portal-session/index.ts`
- `shared/matching/premiumCreditsObservability.test.ts`
- `docs/branch-deltas/fix-premium-credits-observability.md`

Stream 14:

- `supabase/functions/email-verification/index.ts`
- `supabase/functions/event-notifications/index.ts`
- `supabase/functions/send-email/index.ts`
- `supabase/functions/send-support-reply/index.ts`
- `shared/matching/resendEmailProviderOperationalQa.test.ts`
- `docs/branch-deltas/fix-resend-email-provider-operational-qa.md`
- `docs/notification-system-design.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `supabase/config.toml`

Stream 15:

- `supabase/functions/phone-verify/index.ts`
- `src/components/PhoneVerification.tsx`
- `apps/mobile/components/verification/PhoneVerificationFlow.tsx`
- `src/lib/phoneVerificationState.ts`
- `apps/mobile/lib/profileApi.ts`
- `shared/matching/twilioPhoneVerificationQa.test.ts`
- `docs/branch-deltas/fix-twilio-phone-verification-qa.md`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `supabase/config.toml`

Cross-system:

- `supabase/functions/delete-account/index.ts`
- Web/native payment success pages
- Profile verification guard migrations and profile trust-field readers
- Recent Stream branch deltas and shared matching regression tests

## Stream 9: Premium/Credits Observability and Stripe Idempotency

Verdict: PASS.

Findings:

- `stripe_webhook_events` exists as a service-role ledger keyed by `stripe_event_id`; `payment_observability_events` exists as an append-only service-role observability ledger.
- Both tables enable RLS, revoke client writes from `anon` and `authenticated`, and grant only service-role access required by the functions.
- `stripe-webhook` verifies the raw Stripe signature before constructing idempotency context or running settlement logic.
- Duplicate webhook processing is keyed by Stripe event ID. Duplicate processed/in-flight events return `idempotent: true`, `duplicate: true`, `duplicate_skipped`, and skip the settlement `switch`.
- Failed or `received` ledger rows can be reclaimed for Stripe retry; processed/ignored/processing rows are observed as duplicate replays and do not apply settlement again.
- Credits settlement uses `stripe_credit_checkout_grants` by checkout session before reading/updating `user_credits`; duplicate grants skip balance mutation.
- Paid event settlement remains delegated to the existing `settle_event_ticket_checkout` RPC and preserves duplicate-safe settlement semantics.
- Subscription checkout, subscription update/delete, and invoice payment-failed paths remain present and observed.
- Checkout and portal functions record safe operational observability but still return the existing `{ success: true, url: session.url }` client response.
- Raw Stripe payloads, card details, checkout URLs, and secret values are not persisted to the observability ledgers or logged by the Stream 9 tests.
- Pricing, credit pack IDs, Stripe env names, and entitlement semantics were unchanged.

Missing runtime/manual proof:

- No real Stripe payment, webhook replay, portal session, or dashboard webhook delivery test was run, per prompt.
- Manual Stripe dashboard follow-up remains: confirm endpoint URL, subscribed events, live price IDs, portal configuration, and controlled internal test-mode/live-mode payment QA only with explicit approval.

## Stream 14: Resend Email / Unsubscribe QA

Verdict: PASS.

Findings:

- Stream 14 is closed on `main`; the branch delta and `resendEmailProviderOperationalQa.test.ts` are present.
- Active Resend functions read `RESEND_API_KEY` by name only.
- `email-verification` requires an authenticated user, canonicalizes the account email, generates OTPs server-side, stores HMAC-SHA256 OTP hashes, and expires codes after 10 minutes.
- Verification checks failed-attempt counts through `verification_attempts` and enforces the documented 7-attempt hourly cap.
- Raw OTP values are not logged; the static QA test asserts this.
- `event-notifications` is `verify_jwt = true`, resolves the caller, checks `user_roles.role = admin`, and rate-limits notification requests.
- Event notification recipient queries require verified email and `email_unsubscribed = false`.
- Production event links use `https://www.vibelymeet.com/events/{eventId}`; active email templates use the canonical production origin.
- `email-drip` is intentionally retired from source/config/live inventory. Restoration posture documents `CRON_SECRET`, scheduler, template, dedupe, and domain checks.
- `unsubscribe` is intentionally retired from source/config/live inventory. Restoration posture documents `UNSUB_HMAC_SECRET`, public HMAC endpoint, rate limiting, and template/footer checks.
- No real-email smoke artifacts were found.

Provider secret posture:

- Secret names are documented only by name: `RESEND_API_KEY`, `EMAIL_VERIFICATION_OTP_SECRET`, `CRON_SECRET`, `UNSUB_HMAC_SECRET`.
- No Resend secret value was found in source, docs, or logs inspected.

Missing runtime/manual proof:

- No real email was sent, per prompt.
- Manual Resend follow-up remains: verify sender domain, allowed aliases, suppression/bounce behavior, optional webhook observability, and controlled internal email QA with owned test addresses only.

## Stream 15: Twilio Phone Verification QA

Verdict: PASS.

Findings:

- Stream 15 is closed on `main`; the branch delta and `twilioPhoneVerificationQa.test.ts` are present.
- `phone-verify` is configured with `verify_jwt = true` in `supabase/config.toml`.
- The function requires an auth header and resolves the authenticated Supabase user before diagnostics or Twilio provider calls.
- Send and check actions remain `send_otp` and `verify_otp` on the same Edge Function.
- Send attempts are counted in `verification_attempts`; the documented limit remains 5 sends per authenticated user per hour.
- Twilio Lookup V2 is called with `Fields=line_type_intelligence`; non-mobile line types are blocked, and Lookup failures remain fail-open by documented launch-risk choice.
- One-user-one-phone safety is checked before sending and again before marking verification success.
- Verification success writes `profiles.phone_number`, `profiles.phone_verified`, and `profiles.phone_verified_at` through the authenticated service-role Edge path.
- Web OTP entry keeps `autoComplete="one-time-code"` and numeric input mode; native uses numeric OTP inputs and the same backend actions.
- Active phone verification logs mask phone numbers and do not print OTPs, Twilio secret values, full provider URLs, or raw provider response bodies.
- No real-SMS smoke artifacts were found.

Provider secret posture:

- Secret names are documented only by name: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`.
- No Twilio secret value was found in source, docs, or logs inspected.

Missing runtime/manual proof:

- No real SMS was sent, per prompt.
- Manual Twilio follow-up remains: verify account SID, Verify service SID, SMS sender/template, country permissions, fraud guard/rate limits, Lookup access, WebOTP friendliness, and controlled internal SMS QA with owned numbers only.

## Cross-System Findings

Verdict: PASS.

Findings:

- Account deletion Stripe cleanup remains compatible: `delete-account` still reads the user Stripe subscription row, cancels active/trialing Stripe subscriptions when `STRIPE_SECRET_KEY` is configured, then updates local `subscriptions` and profile premium fields.
- Email and phone verification do not conflict with profile trust fields. Direct writes to `email_verified`/`verified_email` and `phone_verified`/`phone_verified_at` were found only in the trusted Edge verification functions and shared backend bootstrap/profile contract code. Existing migrations protect self-service profile writes to trust fields.
- Payment success pages do not become durable entitlement or credit source of truth. Web credit success refetches `user_credits`; web/native event payment success poll `event_registrations.admission_status`; subscription display elsewhere reads backend subscription/profile state. Success pages do not write entitlements or credits.
- Provider secrets are referenced by environment-variable name only. Placeholder entries in `_cursor_context/vibely_rebuild_runbook.md` use blank or `...` examples, not secret values.
- No new env var was added by Streams 14 or 15; Stream 9 reused existing Stripe names and added only DB observability tables.
- No Ready Gate, swipe, realtime, native module, or `expo-av` drift was found in the Stream 9, 14, or 15 closure tests/docs.
- No real payment, email, or SMS smoke was run.

## Validation Results

Passed:

- `npx tsx shared/matching/premiumCreditsObservability.test.ts`
- `npx tsx shared/matching/resendEmailProviderOperationalQa.test.ts`
- `npx tsx shared/matching/twilioPhoneVerificationQa.test.ts`
- `for f in shared/matching/*.test.ts; do npx tsx "$f"; done`
- `npm run typecheck`
- `npm run build`
- `cd apps/mobile && npm run typecheck`
- `npm run lint`
- `git diff --check`

Notes:

- `npm run build` completed with existing Vite chunk-size/dynamic-import warnings.
- `npm run lint` exited 0 with the repo's existing warning backlog: 208 warnings, 0 errors.

## Repair Recommendations

No repair stream is recommended for this investigation batch.

Manual provider follow-ups remain intentionally outside this no-provider-smoke prompt:

- Stripe: confirm live webhook endpoint/events, live price IDs, and portal configuration; run controlled payment/webhook replay QA only after explicit approval.
- Resend: confirm sender domain/aliases, bounce/complaint/suppression posture, and controlled internal email QA with owned recipients only.
- Twilio: confirm Verify/Lookup/SMS dashboard posture, country/fraud settings, WebOTP SMS template, and controlled internal SMS QA with owned numbers only.

## Safety Confirmation

- No Docker used.
- No local Supabase used.
- No Supabase cloud mutation.
- No deploy.
- No real payment.
- No real email.
- No real SMS.
- No secret values printed or committed.
