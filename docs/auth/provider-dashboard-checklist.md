# Vibely Auth Provider Dashboard Checklist

Last updated: 2026-05-27

This checklist is the manual companion to `npm run audit:auth-live`. The audit script can verify repo-visible settings, live Auth settings exposed by Supabase, function JWT config, Edge Function names, Edge secret names, and live database grants when the local Supabase CLI can query the linked project. It cannot prove Google Cloud, Apple Developer, Resend SMTP, redirect allow-list contents, manual identity-linking toggles, same-email behavior, Twilio dashboard SID equality, CAPTCHA dashboard state, or all Supabase dashboard-only settings.

Dated Sprint 2 live check: `docs/auth/provider-live-check-2026-05-27.md`.

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
- `https://www.vibelymeet.com/` (web email sign-up and email-change confirmation)
- `https://vibelymeet.com/` (apex web email sign-up and email-change confirmation)
- `https://www.vibelymeet.com/auth?provider_callback=true`
- `https://www.vibelymeet.com/auth?provider_callback=true&provider=google`
- `https://www.vibelymeet.com/auth?provider_callback=true&provider=apple`
- `https://vibelymeet.com/auth?provider_callback=true`
- `https://vibelymeet.com/auth?provider_callback=true&provider=google`
- `https://vibelymeet.com/auth?provider_callback=true&provider=apple`
- `https://www.vibelymeet.com/reset-password`
- `https://vibelymeet.com/reset-password`
- `https://www.vibelymeet.com/settings?drawer=account&linking=true&provider=google`
- `https://www.vibelymeet.com/settings?drawer=account&linking=true&provider=apple`
- `https://vibelymeet.com/settings?drawer=account&linking=true&provider=google`
- `https://vibelymeet.com/settings?drawer=account&linking=true&provider=apple`
- `com.vibelymeet.vibely:///` (native email sign-up and email-change confirmation root)
- `com.vibelymeet.vibely://`
- `com.vibelymeet.vibely://auth/callback`
- `com.vibelymeet.vibely://auth/callback?linking=true&provider=google`
- `com.vibelymeet.vibely://reset-password`

Required development values for the current repo:

- `http://localhost:8080`
- `http://localhost:8080/`
- `http://localhost:8080/auth?provider_callback=true`
- `http://localhost:8080/auth?provider_callback=true&provider=google`
- `http://localhost:8080/auth?provider_callback=true&provider=apple`
- `http://localhost:8080/reset-password`
- `http://localhost:8080/settings?drawer=account&linking=true&provider=google`
- `http://localhost:8080/settings?drawer=account&linking=true&provider=apple`
- any active preview domains used for manual QA.

Historical note: do not keep `localhost:5173` unless another approved local workflow still uses it. Current `vite.config.ts` sets the dev server port to `8080`.

Native root note: `getNativeEmailSignUpRedirectUrl()` calls `Linking.createURL("/")`; standalone Expo builds can emit the app root as `com.vibelymeet.vibely:///`. Keep the double-slash root only as compatibility coverage if the dashboard already normalizes it.

## Google OAuth

Supabase provider:

- Google provider enabled.
- Client ID is the production Google OAuth client.
- Client secret is present; do not copy it.
- Redirect/callback configuration matches Supabase's callback URL and the app's web/native flows.

Google Cloud Console:

- Production web origin is allowed.
- Production `/auth?provider_callback=true&provider=google|apple` redirects are allowed where applicable.
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

Sprint 4 implementation gate:

- Auth code now collects CAPTCHA tokens on web and through native browser challenge return paths.
- Confirm Supabase Auth CAPTCHA dashboard setting, but do not enable production CAPTCHA until web and native token collection pass staging smoke tests.
- Confirm rate limits for email signup, password reset, phone OTP, token refresh, and OAuth attempts.
- Record current values and any accepted exceptions.

After Sprint 4:

- Web Turnstile works inline for phone OTP send/resend, email sign-in/sign-up, signup resend, password reset, admin sign-in, and settings password/phone reauth.
- Native Turnstile challenge works through `/auth/challenge` and returns to the app scheme before phone OTP send/resend, email sign-in/sign-up, signup resend, password reset, settings password reauth, and native Apple ID-token sign-in.
- Native staging smoke should use an installed app build with the `com.vibelymeet.vibely://` scheme, or Expo Go with a local web challenge origin. Expo Go `exp://` callbacks against the production web origin intentionally skip the challenge because the production challenge page only trusts the app scheme.
- Pass `captchaToken` to Supabase Auth calls where the SDK accepts it. OAuth browser redirects remain provider-owned and do not accept CAPTCHA tokens.

## Live Audit Commands

From repo root:

```bash
npm run audit:auth-live
npm run test:auth-hardening
```

Expected behavior:

- `audit:auth-live` should pass with `0 fail, 0 warn, 41 checks` on production after Sprint 1-7 migrations, the public deletion lookup follow-up, and changed Edge Functions are deployed.
- On a fresh staging environment, failures around `profiles` grants, verified contact triggers, verified-contact writer RPCs, `sanitize_profile_display_name`, or `verification_attempts.flow` mean the auth hardening migrations are not fully applied there yet.
- The script must not print secret values, OAuth secrets, provider token digests, SMTP passwords, or service-role keys.
- `test:auth-hardening` runs local contract tests only and must not send real SMS/email or mutate provider accounts.
