# Vibely Auth Provider Dashboard Checklist

Last updated: 2026-05-27

This checklist is the manual companion to `npm run audit:auth-live`. The audit script can verify repo-visible settings, live Auth settings exposed by Supabase, function JWT config, Edge Function names, Edge secret names, and live database grants when the local Supabase CLI can query the linked project. It cannot prove Google Cloud, Apple Developer, Resend SMTP, or all Supabase dashboard-only settings.

Do not paste provider secrets, P8 keys, OAuth client secrets, SMTP passwords, Twilio auth tokens, or Supabase service-role keys into this document. Record status and names only.

## Supabase Auth

Expected project: `schdyxcunwcvddlcshwd`

Required settings:

| Setting | Expected |
|---|---|
| Signup disabled | `false` |
| Email provider | enabled |
| Phone provider | enabled |
| Google provider | enabled |
| Apple provider | enabled |
| Email autoconfirm | disabled |
| Phone autoconfirm | disabled |
| SMS provider | `twilio_verify` |
| Manual identity linking | enabled |
| Same-email linking behavior | explicitly verified and documented |
| SAML | disabled unless intentionally launched |
| Passkeys | disabled unless intentionally launched |

Record in the dated live check:

- Dashboard path checked.
- Result: pass, fail, or accepted exception.
- Reviewer initials.
- Date and environment.

## Redirect URLs

Supabase Auth URL Configuration must include the production origins, native scheme, reset route, OAuth callback route, local development routes, and approved preview domains.

Required production values:

- `https://www.vibelymeet.com`
- `https://vibelymeet.com`
- `https://www.vibelymeet.com/auth?provider_callback=true`
- `https://vibelymeet.com/auth?provider_callback=true`
- `https://www.vibelymeet.com/reset-password`
- `https://vibelymeet.com/reset-password`
- `com.vibelymeet.vibely://`
- `com.vibelymeet.vibely://auth/callback`
- `com.vibelymeet.vibely://reset-password`

Required development values:

- `http://localhost:5173`
- `http://localhost:5173/auth?provider_callback=true`
- `http://localhost:5173/reset-password`
- any active preview domains used for manual QA.

## Google OAuth

Supabase provider:

- Google provider enabled.
- Client ID is the production Google OAuth client.
- Client secret is present; do not copy it.
- Redirect/callback configuration matches Supabase's callback URL and the app's web/native flows.

Google Cloud Console:

- Production web origin is allowed.
- Production `/auth?provider_callback=true` redirect is allowed where applicable.
- Native callback `com.vibelymeet.vibely://auth/callback` is supported by the configured flow or explicitly documented as Supabase/browser callback mediated.
- Preview and local development callbacks are present only when needed.

## Apple Auth

Native app:

- Bundle ID: `com.vibelymeet.vibely`
- Team ID: `W38S57AM55`
- Sign in with Apple capability enabled.

Apple Developer / Supabase:

- Apple provider enabled in Supabase.
- Services ID is configured for web Apple OAuth.
- Supabase `/auth/v1/callback` return URL is registered exactly.
- P8 key is present in Supabase; do not copy it.
- Key ID and Team ID names are recorded without secret material.

## Twilio

Supabase Auth phone OTP:

- SMS provider is `twilio_verify`.
- Verify Service SID is present in Supabase dashboard.
- Country allow-list, templates, sender behavior, and rate limits are reviewed.

Edge Functions:

- Secret names present: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`.
- Confirm whether Supabase Auth and Edge Functions use the same Verify Service SID.
- If they intentionally differ, document why, including sender/rate-limit/country-list consequences.

## Resend And SMTP

Custom Edge Function email:

- Secret names present: `RESEND_API_KEY`, `EMAIL_VERIFICATION_FROM_EMAIL`, `FROM_EMAIL`.
- Profile email OTP, deletion reauth email, and generic app email use Resend-backed code paths.

Supabase Auth email:

- Custom SMTP should be configured through Resend unless product explicitly accepts Supabase default sender.
- Signup confirmation and password reset sender domain must match the intended Vibely brand domain.
- SPF, DKIM, DMARC, and Resend domain verification are reviewed.

## CAPTCHA And Rate Limits

Before Sprint 4:

- Confirm Supabase Auth CAPTCHA dashboard setting, but do not enable production CAPTCHA until web and native token collection work in staging.
- Confirm rate limits for email signup, password reset, phone OTP, token refresh, and OAuth attempts.
- Record current values and any accepted exceptions.

After Sprint 4:

- CAPTCHA enabled for signup, phone OTP, signup resend, and password reset.
- Web Turnstile works inline.
- Native Turnstile challenge works through app scheme return.

## Live Audit Commands

From repo root:

```bash
npm run audit:auth-live
npm run test:auth-hardening
```

Expected pre-deploy behavior:

- `audit:auth-live` may fail on the known `profiles` grant and verified contact trigger gaps until the auth profile write hardening migration has been applied to that environment.
- The script must not print secret values, OAuth secrets, provider token digests, SMTP passwords, or service-role keys.
- `test:auth-hardening` runs local contract tests only and must not send real SMS/email or mutate provider accounts.
