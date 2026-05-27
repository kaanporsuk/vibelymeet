# Stream 15 - Twilio Phone Verification Operational QA

Branch: `fix/twilio-phone-verification-qa`

## Problem

Vibely relies on Twilio Verify for SMS OTP delivery and Twilio Lookup for optional line-type checks. A provider drift, unsafe log, stale Verify service, missing Lookup permission, or gateway/auth posture regression can break phone verification without changing app code. Stream 15 audits and hardens this path without changing verification product semantics.

## Files Audited

- `supabase/functions/phone-verify/index.ts`
- `src/components/PhoneVerification.tsx`
- `src/components/PhoneVerificationNudge.tsx`
- `src/lib/phoneVerificationState.ts`
- `src/pages/ProfileStudio.tsx`
- `src/components/settings/AccountSettingsDrawer.tsx`
- `apps/mobile/components/verification/PhoneVerificationFlow.tsx`
- native phone/profile/settings/event surfaces that invoke or display phone verification
- `supabase/config.toml`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- provider and historical docs mentioning `phone-verify`, Twilio Verify, Lookup, or WebOTP

## Read-Only Production Checks

- `supabase projects list`: Supabase linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`: `phone-verify`: active.
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd`: Twilio secret names are present by name. Secret values were not requested or printed.

Visible secret names:

- `TWILIO_ACCOUNT_SID`: present by name.
- `TWILIO_AUTH_TOKEN`: present by name.
- `TWILIO_VERIFY_SERVICE_SID`: present by name.

No real SMS smoke was run.

## JWT Posture

- Gateway JWT posture: `verify_jwt = true` in `supabase/config.toml`.
- The function also resolves the authenticated Supabase user through `supabase.auth.getUser()`.
- Stream 15 originally changed the internal ordering so the dev diagnostic `health_check` required authenticated user context before returning provider configuration booleans.
- Sprint 6 supersedes that posture: the client-callable `health_check` action has been removed entirely, and provider configuration failures now return coarse user-safe copy while logging only a missing-secret count.
- This does not loosen the gateway posture and does not add public phone verification behavior.

## Twilio Secret Posture

`phone-verify` reads only the existing Twilio runtime secret names:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

No new env vars were added. The function still uses Supabase runtime env names already required by the function: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Send and Check Flow

- Web and native invoke the same Edge Function:
  - send: `action: "send_otp"`
  - check: `action: "verify_otp"`
- The function preserves the existing "always HTTP 200" response contract so Supabase client callers can read structured `{ success: false, error }` bodies.
- Twilio Verify send calls `https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/Verifications`.
- Twilio Verify check calls `https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`.
- Verification success updates `profiles.phone_number`, `profiles.phone_verified`, and `profiles.phone_verified_at`.

## Rate-Limit and Attempt Posture

- Send attempts are counted in `verification_attempts` with `flow = 'phone_verify_send'`.
- The existing limit remains max 5 SMS sends per authenticated user per hour.
- The response remains product-compatible with `errorType: "rate_limited"` and `retry_after: 3600`.
- The web/native client-side failed OTP attempt counters are UX-local only and do not replace Twilio Verify's server-side check behavior.

## VoIP and Lookup Posture

- The send path still calls Twilio Lookup V2 with `Fields=line_type_intelligence`.
- `mobile` and `cellphone` line types are accepted.
- Known non-mobile line types are blocked with `errorType: "invalid_number_type"`.
- Lookup failures remain fail-open so a temporary Lookup outage does not block legitimate users from trying Verify.
- Manual provider QA must confirm the Twilio account has Lookup access and that this fail-open posture is still acceptable for launch risk.

## One-User-One-Phone Safety

- Before sending, the function checks for another verified profile with the same `phone_number`.
- Before writing verification success, it repeats the 1:1 association check.
- Existing error surfaces are preserved:
  - `This number is already verified by another account.`
  - `This phone number is already associated with another account.`
  - `errorType: "phone_already_claimed"`

## WebOTP Posture

- Web OTP fields keep `autoComplete="one-time-code"` on the first OTP input and numeric input mode.
- The current Verify SMS copy is owned by Twilio Verify service configuration rather than this repo; dashboard QA must confirm the message body remains WebOTP-friendly for the target platforms and sender settings.
- Native uses numeric OTP inputs and the same backend `verify_otp` action.

## Safe Logging and Debuggability

Code fixes made:

- `supabase/functions/phone-verify/index.ts`
  - added structured log events with `requestId`
  - masked phone metadata before logging
  - removed partial Twilio secret, auth token length, full phone number, Verify URL, provider response body/message, and raw exception-object logging
  - kept Twilio status/error-code observability without printing OTPs or secret values
  - Sprint 6 later removed the client-callable `health_check` action completely
- `src/components/PhoneVerification.tsx`
  - removed full phone number and full function response logging
  - kept sanitized failure categories for local diagnosis
  - Sprint 6 later removed the dev-only `__vibely_diag=1` health check call

OTP values, Twilio secret values, full phone numbers, provider URLs, and raw provider responses are not logged by the audited active phone verification paths.

## Tests Added

- `shared/matching/twilioPhoneVerificationQa.test.ts`

Coverage includes gateway JWT posture, Twilio env usage, unsupported-action rejection before provider config checks, send/check actions, flow-scoped rate limiting and attempt tracking, Lookup/VoIP blocking posture, one-user-one-phone checks, WebOTP entry support, safe logging, no new env vars/native modules, no `expo-av`, and Streams 1-14 artifact presence.

## Manual Twilio Dashboard Checklist

1. Confirm the Twilio account matches `TWILIO_ACCOUNT_SID`.
2. Confirm the secret behind `TWILIO_AUTH_TOKEN` is active and has access to Verify and Lookup APIs.
3. Confirm the Verify service SID matches `TWILIO_VERIFY_SERVICE_SID`.
4. Confirm SMS channel is enabled for the Verify service.
5. Confirm the Verify service friendly name, template, and sender configuration match Vibely production expectations.
6. Confirm Verify service rate limits and fraud guard settings are appropriate for launch countries.
7. Confirm Twilio geo permissions allow only intended countries.
8. Confirm Lookup API and `line_type_intelligence` are enabled/available for the production account.
9. Confirm the Verify SMS body remains WebOTP-friendly for supported browsers/devices where Twilio dashboard configuration allows it.
10. Confirm Twilio logs do not need app-side OTP logging for support; use Twilio dashboard audit trails instead.
11. Run controlled internal SMS QA only with owned test numbers:
    - send OTP
    - verify correct OTP
    - wrong-code handling
    - resend/rate-limit posture
    - duplicate phone association posture
    - VoIP/landline rejection if a safe test number is available
12. Do not send SMS to real production users as a smoke test.

## Deploy Requirements

- Supabase migration requirement: Sprint 6 adds `verification_attempts.flow`; apply `20260527130000_auth_sprint6_data_quality_observability.sql` before deploying the current `phone-verify` code.
- Edge Function deploy requirement: `phone-verify` changed and must be deployed after merge only:
  - `supabase functions deploy phone-verify --project-ref schdyxcunwcvddlcshwd`
- No other Edge Function changed.

## Safety Confirmations

- No Docker used.
- No local Supabase used.
- No Supabase DB push.
- No Supabase migration was added.
- No production SMS was sent.
- No new env vars were added.
- No native modules were added.
- No `expo-av` import or package was added.
- No Ready Gate, swipe, payment, realtime, OneSignal, Bunny, Daily, Resend, RevenueCat, or unrelated provider changes were made.

## Remaining Deferred Work

- Controlled internal Twilio SMS QA with owned test numbers.
- Manual Twilio Verify service, Lookup, country, sender, and fraud-guard dashboard verification.
- Physical-device native phone verification QA.
- Broader provider observability review if support wants cross-linking to Twilio request IDs later.
