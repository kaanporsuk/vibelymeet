# Vibely Auth Provider Live Check

Date: 2026-05-27

Environment checked: production Supabase project `schdyxcunwcvddlcshwd`

Scope: Sprint 2 provider and dashboard closure for sign-in, sign-up, account linking, reset-password, custom verification email, custom phone verification, CAPTCHA posture, and redirect URL readiness.

This document records names and status only. It intentionally contains no screenshots, OAuth client secrets, Apple P8 material, SMTP passwords, Twilio auth tokens, Supabase service-role keys, provider token digests, or secret values.

## Verification Method

Status labels:

| Status | Meaning |
|---|---|
| `LIVE-CONFIRMED` | Confirmed from live Supabase public Auth settings, Supabase CLI SQL, function inventory, function JWT config, or Edge secret-name inventory. |
| `REPO-CONFIRMED` | Confirmed from current source code/config only. |
| `DASHBOARD-MANUAL` | Must be confirmed in a provider dashboard because repo/public Supabase endpoints do not expose the needed value safely. |
| `CODE-WIRED-SPRINT-4` | Auth CAPTCHA token collection exists in code; dashboard enablement still waits for staging smoke tests. |

Commands run:

```bash
npm run audit:auth-live
```

Result: `0 fail, 0 warn, 41 checks`

The audit confirmed:

- Supabase public project URL/key are present locally without printing key values.
- Supabase project ref is `schdyxcunwcvddlcshwd`.
- Live Supabase Auth provider flags are correct where exposed by `/auth/v1/settings`.
- Live profile grants, protected trigger body, bootstrap trigger, routine grants, verified-contact writer RPCs, Edge Function inventory, Edge Function JWT posture, and Edge secret names are aligned.

No live SMS, email, OAuth login, Apple login, password reset email, or provider account mutation was performed.

## Supabase Auth Settings

| Setting | Expected | Status | Evidence / Follow-up |
|---|---|---|---|
| Signup enabled | `disable_signup = false` | `LIVE-CONFIRMED` | `/auth/v1/settings` returned expected value. |
| Email provider | enabled | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `external.email = true`. |
| Phone provider | enabled | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `external.phone = true`. |
| Google provider | enabled | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `external.google = true`. |
| Apple provider | enabled | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `external.apple = true`. |
| Email autoconfirm | disabled | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `mailer_autoconfirm = false`. |
| Phone autoconfirm | disabled | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `phone_autoconfirm = false`. |
| SMS provider | `twilio_verify` | `LIVE-CONFIRMED` | `/auth/v1/settings` returned `sms_provider = "twilio_verify"`. |
| Manual identity linking | enabled | `DASHBOARD-MANUAL` | Repo uses `supabase.auth.linkIdentity()` for web and native linking, but the dashboard toggle is not exposed by the public settings endpoint used by the audit. Open Supabase Dashboard > Authentication > Providers/Settings and confirm manual linking is enabled. |
| Same-email account behavior | explicit | `DASHBOARD-MANUAL` | Must be verified in Supabase Auth dashboard and documented as either same-email auto-link disabled/blocked or intentionally enabled. No code can prove this setting. |

Decision: Do not treat Sprint 2 as fully provider-certified until the two dashboard-manual rows above are ticked by a human dashboard reviewer.

## Redirect Allow-List

These are the exact callback shapes the current code can emit and therefore the exact shapes that must be present in Supabase Auth URL configuration.

| URL / pattern | Source | Status |
|---|---|---|
| `https://www.vibelymeet.com` | Production canonical origin | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com` | Apex production origin | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/` | Web email sign-up and email-change confirmation root | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/` | Apex web email sign-up and email-change confirmation root | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/auth?provider_callback=true` | Web Google/Apple OAuth callback | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/auth?provider_callback=true&provider=google` | Web Google OAuth callback with Sprint 3 provider context | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/auth?provider_callback=true&provider=apple` | Web Apple OAuth callback with Sprint 3 provider context | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/auth?provider_callback=true` | Apex web Google/Apple OAuth callback | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/auth?provider_callback=true&provider=google` | Apex web Google OAuth callback with Sprint 3 provider context | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/auth?provider_callback=true&provider=apple` | Apex web Apple OAuth callback with Sprint 3 provider context | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/reset-password` | Web password reset | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/reset-password` | Apex web password reset | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/settings?drawer=account&linking=true&provider=google` | Web Google account-linking callback | `DASHBOARD-MANUAL` |
| `https://www.vibelymeet.com/settings?drawer=account&linking=true&provider=apple` | Web Apple account-linking callback | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/settings?drawer=account&linking=true&provider=google` | Apex web Google account-linking callback | `DASHBOARD-MANUAL` |
| `https://vibelymeet.com/settings?drawer=account&linking=true&provider=apple` | Apex web Apple account-linking callback | `DASHBOARD-MANUAL` |
| `http://localhost:8080` | Vite dev server in `vite.config.ts` | `DASHBOARD-MANUAL` |
| `http://localhost:8080/` | Local web email sign-up and email-change confirmation root | `DASHBOARD-MANUAL` |
| `http://localhost:8080/auth?provider_callback=true` | Local web OAuth callback | `DASHBOARD-MANUAL` |
| `http://localhost:8080/auth?provider_callback=true&provider=google` | Local web Google OAuth callback with Sprint 3 provider context | `DASHBOARD-MANUAL` |
| `http://localhost:8080/auth?provider_callback=true&provider=apple` | Local web Apple OAuth callback with Sprint 3 provider context | `DASHBOARD-MANUAL` |
| `http://localhost:8080/reset-password` | Local web password reset | `DASHBOARD-MANUAL` |
| `http://localhost:8080/settings?drawer=account&linking=true&provider=google` | Local web Google account-linking callback | `DASHBOARD-MANUAL` |
| `http://localhost:8080/settings?drawer=account&linking=true&provider=apple` | Local web Apple account-linking callback | `DASHBOARD-MANUAL` |
| `com.vibelymeet.vibely:///` | Native email sign-up and email-change confirmation root emitted by `Linking.createURL("/")` in standalone builds | `DASHBOARD-MANUAL` |
| `com.vibelymeet.vibely://` | Native app-scheme root compatibility if the dashboard normalizes root URLs | `DASHBOARD-MANUAL` |
| `com.vibelymeet.vibely://auth/callback` | Native Google OAuth callback | `DASHBOARD-MANUAL` |
| `com.vibelymeet.vibely://auth/callback?linking=true&provider=google` | Native Google account-linking callback | `DASHBOARD-MANUAL` |
| `com.vibelymeet.vibely://reset-password` | Native password reset | `DASHBOARD-MANUAL` |
| Approved Vercel preview domains | Manual QA previews | `DASHBOARD-MANUAL` |

Repo evidence:

- Web Google/Apple sign-in uses `redirectTo: ${window.location.origin}/auth?provider_callback=true&provider=google|apple`.
- Web Google/Apple account linking uses deterministic `/settings?drawer=account&linking=true&provider=google|apple` redirects.
- Web generic email confirmation, email-change, and magic-link auth returns are manually consumed by `WebAuthReturnHandler` because the web client disables automatic URL parsing for explicit PKCE handling.
- Web Settings opens the account drawer from `drawer=account` so the linking callback hook is mounted on return.
- Web email sign-up and email-change flows use `emailRedirectTo: ${window.location.origin}/`, including the root slash.
- Web password reset uses `redirectTo: ${window.location.origin}/reset-password`.
- Native scheme is `com.vibelymeet.vibely`.
- Native Google OAuth callback is built from `Linking.createURL("auth/callback")`.
- Native Google account linking appends `?linking=true&provider=google` to the same callback path.
- Native password reset callback is built from `Linking.createURL("reset-password")`.
- Native email sign-up and email-change confirmation callbacks are built from `Linking.createURL("/")`; standalone builds can represent that root as `com.vibelymeet.vibely:///`.
- Vite local dev port is `8080`, not `5173`, in the current repo.

Follow-up: the previous checklist mentioned `localhost:5173`; that is stale for the current `vite.config.ts`. Keep `5173` only if another approved local workflow still uses it.

## Google OAuth

| Item | Expected | Status | Evidence / Follow-up |
|---|---|---|---|
| Supabase Google provider enabled | enabled | `LIVE-CONFIRMED` | `/auth/v1/settings` confirms `external.google = true`. |
| Web OAuth flow | Supabase OAuth redirect | `REPO-CONFIRMED` | Web auth calls `signInWithOAuth({ provider: "google" })` with `/auth?provider_callback=true&provider=google`. |
| Native OAuth flow | browser OAuth callback hydration | `REPO-CONFIRMED` | Native calls `signInWithOAuth({ provider: "google", skipBrowserRedirect: true })`, opens `WebBrowser.openAuthSessionAsync`, and completes from the returned URL. |
| Google Cloud production web origin | `https://www.vibelymeet.com` and apex if used | `DASHBOARD-MANUAL` | Must be confirmed in Google Cloud Console. |
| Google Cloud redirect/callback URLs | Supabase callback URL plus app callback behavior | `DASHBOARD-MANUAL` | Must be confirmed in Google Cloud Console and Supabase provider settings. |
| Same-email conflict behavior | no accidental account fragmentation | `DASHBOARD-MANUAL` | Requires dashboard setting review plus manual smoke with dedicated test accounts. |

No Google client ID or client secret values were copied into this document.

## Apple Auth

| Item | Expected | Status | Evidence / Follow-up |
|---|---|---|---|
| Supabase Apple provider enabled | enabled | `LIVE-CONFIRMED` | `/auth/v1/settings` confirms `external.apple = true`. |
| Native bundle ID | `com.vibelymeet.vibely` | `REPO-CONFIRMED` | Present in `apps/mobile/app.base.json`. |
| Apple Team ID | `W38S57AM55` | `REPO-CONFIRMED` | Present in `apps/mobile/app.base.json`. |
| Native Apple capability | enabled | `REPO-CONFIRMED` | `usesAppleSignIn = true` and `expo-apple-authentication` plugin are present. |
| Native Apple sign-in | ID token + raw/hashed nonce | `REPO-CONFIRMED` | Native sign-in uses `AppleAuthentication.signInAsync()` then `supabase.auth.signInWithIdToken({ provider: "apple" })`. |
| Native Apple linking | ID token + raw/hashed nonce | `REPO-CONFIRMED` | Native linking uses `supabase.auth.linkIdentity({ provider: "apple", token, nonce })`. |
| Apple Services ID | configured for web OAuth | `DASHBOARD-MANUAL` | Must be confirmed in Apple Developer and Supabase provider settings. |
| Apple Supabase callback URL | registered exactly | `DASHBOARD-MANUAL` | Must be confirmed in Apple Developer Services ID return URLs. |
| Apple P8 key | present in Supabase | `DASHBOARD-MANUAL` | Confirm presence only; do not copy key material. |

No Apple Key ID, Services ID secret, P8 key, or provider secret value was copied into this document.

## Twilio Verify

| Item | Expected | Status | Evidence / Follow-up |
|---|---|---|---|
| Supabase Auth SMS provider | `twilio_verify` | `LIVE-CONFIRMED` | `/auth/v1/settings` confirms `sms_provider = "twilio_verify"`. |
| Edge secret names | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | `LIVE-CONFIRMED` | `npm run audit:auth-live` confirmed secret names are present without printing values. |
| Custom phone verification function | Twilio Verify SID from `TWILIO_VERIFY_SERVICE_SID` | `REPO-CONFIRMED` | `phone-verify` reads the expected secret names and uses Verify endpoints. |
| Supabase Auth Verify Service SID equals Edge `TWILIO_VERIFY_SERVICE_SID` | same SID unless intentionally split | `DASHBOARD-MANUAL` | Supabase dashboard does not expose the SID through the public settings endpoint. Compare dashboard value to Edge secret value manually without copying either value into docs. |
| Country allow-list, templates, sender behavior, rate limits | reviewed | `DASHBOARD-MANUAL` | Must be reviewed in Twilio and Supabase Auth dashboards. |

Operational note: if Supabase Auth and the custom Edge Function use different Verify Services, rate limits, templates, sender identity, country allow-lists, and fraud posture may diverge. Document an intentional split before accepting it.

## Resend And Supabase Auth SMTP

| Item | Expected | Status | Evidence / Follow-up |
|---|---|---|---|
| Custom email Edge secret names | `RESEND_API_KEY`, `EMAIL_VERIFICATION_FROM_EMAIL`, `FROM_EMAIL` | `LIVE-CONFIRMED` | `npm run audit:auth-live` confirmed secret names are present without printing values. |
| Custom profile email verification | Resend API | `REPO-CONFIRMED` | `email-verification` sends through `https://api.resend.com/emails`. |
| Other app email functions | Resend API where active | `REPO-CONFIRMED` | Existing Resend operational QA contracts cover active app email paths. |
| Supabase Auth SMTP | Resend SMTP unless product accepts Supabase sender | `DASHBOARD-MANUAL` | Supabase Auth SMTP provider and sender domain are not exposed by the public settings endpoint. Confirm in Supabase Dashboard > Authentication > Emails/SMTP. |
| SPF, DKIM, DMARC, Resend domain verification | reviewed | `DASHBOARD-MANUAL` | Must be confirmed in Resend DNS/domain dashboard. |

Risk if unresolved: Supabase signup confirmation and password reset email can still be sent by the default Supabase sender even though custom app emails use Resend.

## CAPTCHA And Rate Limits

| Item | Expected | Status | Evidence / Follow-up |
|---|---|---|---|
| Public account deletion Turnstile | enabled | `LIVE-CONFIRMED` | Edge secret name `TURNSTILE_SECRET_KEY` exists; public delete-account route has Turnstile UI and server verification. |
| Supabase Auth CAPTCHA | code wired; dashboard enablement waits for staging smoke | `CODE-WIRED-SPRINT-4` | Web auth renders Turnstile for Supabase Auth entry calls plus admin/settings password reauth; native opens `/auth/challenge` for app-scheme auth calls and passes returned tokens where the Supabase SDK accepts them. Expo Go `exp://` callbacks against production web are intentionally skipped; use installed staging builds or local challenge origin for native CAPTCHA smoke. Do not enable production auth CAPTCHA until staging smoke passes. |
| Phone OTP rate limits | reviewed | `DASHBOARD-MANUAL` | Supabase Auth and Twilio dashboard limits must be reviewed manually. |
| Email signup/reset rate limits | reviewed | `DASHBOARD-MANUAL` | Supabase Auth dashboard limits must be reviewed manually. |
| OAuth attempt rate limits | reviewed | `DASHBOARD-MANUAL` | Supabase Auth and provider dashboard limits must be reviewed manually. |

Sprint 4 gate: token collection paths are implemented in code. Enable Supabase Auth CAPTCHA only after web and native staging smoke tests pass.

## Required Manual Dashboard Checklist

These items remain intentionally open because they cannot be proven from the current repo or the read-only live audit:

- Supabase Auth redirect allow-list contains every URL listed in this document.
- Supabase manual identity linking is enabled.
- Supabase same-email account behavior is explicitly understood and accepted.
- Supabase Auth SMTP is routed through Resend, or product explicitly accepts the Supabase default sender.
- Google Cloud OAuth origins and redirect/callback entries match the current web/native flows.
- Apple Developer Services ID, return URLs, Team ID, bundle ID, and P8 key presence match Supabase provider settings.
- Supabase Auth Twilio Verify Service SID matches Edge `TWILIO_VERIFY_SERVICE_SID`, or an intentional split is documented.
- Twilio country allow-list, templates, sender behavior, fraud controls, and rate limits are reviewed.
- Resend domain verification, SPF, DKIM, and DMARC are healthy.
- Supabase Auth CAPTCHA/rate-limit dashboard values are recorded, with production CAPTCHA left disabled until Sprint 4 staging smoke tests pass.

## Sprint 2 Verdict

Repo-visible and live Supabase-readable provider posture is aligned. Sprint 2 cannot honestly be marked fully dashboard-certified until the `DASHBOARD-MANUAL` rows above are checked by a human with Supabase, Google Cloud, Apple Developer, Twilio, and Resend dashboard access.

The codebase is ready for that manual dashboard pass: exact callback shapes, project identifiers, native identifiers, and provider flow ownership are now recorded in one dated document without secret material.
