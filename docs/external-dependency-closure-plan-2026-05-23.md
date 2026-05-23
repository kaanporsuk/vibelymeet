# External Dependency Closure Plan - 2026-05-23

This is the closure plan for the 2026-05-22 external-dependency audit. It records only evidence-safe state and operator actions that remain outside repo control. No secrets, HMACs, provider tokens, customer data, or private DSNs are included.

## Issue Table

| Area | Classification | Evidence | Closure action |
|---|---|---|---|
| Supabase project link | closed | CLI linked to `schdyxcunwcvddlcshwd`; config uses the same project ref. | None. |
| Supabase migrations | closed | `supabase migration list --linked` parity; `supabase db push --linked --dry-run` reported remote DB up to date. | None. |
| Supabase DB lint | closed | `supabase db lint --linked --fail-on error --schema public` returned no errors. | Keep warning cleanup separate from release gating. |
| Edge Function source/config/cloud parity | closed | 67 deployable source functions, 67 `supabase/config.toml` entries, 67 active deployed functions. | Keep manifest and inventory at 67. |
| `event_registrations.updated_at` type drift | closed in source | Migration `20260521214500_video_date_phase2_recovery_webhooks_cleanup.sql` adds the column; generated TS types were stale. | Types now include nullable `updated_at` in Row/Insert/Update. True CLI regeneration was blocked by Supabase `524`; rerun later. |
| Daily webhook registration | closed by operator evidence | UUID `a5407924-6f29-4a35-835a-ff5185eeae5c`; URL `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-date-daily-webhook`; events `participant.joined`, `participant.left`; state ACTIVE; `failedCount` 0; signed test probe 200. | Do not recreate or update. Run real join/leave smoke only. |
| Daily real join/leave delivery | pending | `lastMomentPushed` still null until real participant events occur. | Two-user smoke; confirm `lastMomentPushed` non-null, `failedCount` stays 0, Supabase logs show accepted events. |
| Stripe dashboard state | unproven | Source and Supabase secret names exist; no Stripe CLI/API credentials available. | Manual Stripe checklist below. |
| Bunny dashboard state | unproven | Source, Supabase secret names, DNS/TLS/CDN root response exist; no Bunny API credentials available. | Manual Bunny checklist below. |
| OneSignal remote push | unproven | Web service workers return 200; backend secret names exist; provider dashboard access unavailable. | Manual OneSignal checklist below. |
| Twilio Verify | unproven | `phone-verify` source and secret names exist; no Twilio API credentials available. | Manual Twilio checklist below. |
| Resend email | unproven | Current email functions and secret names exist; no Resend API credentials available. | Manual Resend checklist below. |
| RevenueCat native entitlements | unproven | Mobile SDK wrapper, webhook, sync function, and secret names exist; no RevenueCat API credentials available. | Manual RevenueCat checklist below. |
| PostHog | unproven | Web/native/server env paths exist; no PostHog management API credentials available. | Manual PostHog checklist below. |
| Sentry | unproven | Web/native/server DSN paths exist; no `SENTRY_AUTH_TOKEN` available. | Manual Sentry checklist below. |
| Vercel deploy/env freshness | unproven | Public domain probes passed; local CLI missing; Vercel connector returned 403 for project. | Manual Vercel checklist below. |
| Cloudflare Turnstile account deletion | source-confirmed | `/delete-account` renders an explicit Turnstile widget from `VITE_TURNSTILE_SITE_KEY`; `request-account-deletion` verifies `captchaToken` with `TURNSTILE_SECRET_KEY` and uses `ACCOUNT_DELETION_RATE_LIMIT_PEPPER` for hashed rate limits. | Use Managed mode, hostnames `vibelymeet.com` and `www.vibelymeet.com`, and keep pre-clearance off. |
| Cloudflare zone/proxy/SSL mode | unproven | Public DNS/TLS probes passed; Cloudflare dashboard/API unavailable. | Manual Cloudflare checklist below. |
| Retired `email-drip` and `unsubscribe` docs | stale docs | Functions are absent from current source/config/cloud; historical docs still mention them. | Keep marked retired unless product explicitly restores them. |
| Retired `account-pause` / `account-resume` function docs | stale docs | Function directories/config entries are absent; pause behavior is now table/RPC/client-owned in current code. | Mark as retired wherever operator-facing. |
| Twilio SID-like strings in audit docs | conditional security | Filename-only high-confidence scan found SID-like patterns in old audit docs; no auth token exposure was proven. | Review and redact if real. Rotate only if paired auth material was exposed. |

## Source Env Triage

| Env name | Triage | Notes |
|---|---|---|
| `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | active | Core Edge Function runtime. |
| `DAILY_API_KEY`, `DAILY_DOMAIN`, `DAILY_WEBHOOK_SECRET` | active | Daily room creation plus signed webhook recovery. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID` | active | Web checkout and settlement. |
| `BUNNY_STREAM_*`, `BUNNY_STORAGE_*`, `BUNNY_CDN_HOSTNAME`, `BUNNY_VIDEO_WEBHOOK_TOKEN`, `BUNNY_WEBHOOK_SIGNING_KEY` | active | Stream, Storage, CDN, and webhook verification. |
| `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `PUSH_WEBHOOK_SECRET` | active | Remote push send and receipt/callback path. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | active | Phone verification. |
| `RESEND_API_KEY`, `EMAIL_VERIFICATION_OTP_SECRET`, `FROM_EMAIL`, `EMAIL_VERIFICATION_FROM_EMAIL` | active | Email verification and transactional/admin email sends. |
| `REVENUECAT_WEBHOOK_AUTHORIZATION`, `REVENUECAT_SECRET_API_KEY` | active | Native entitlement webhook and subscriber sync. |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | optional | Server-side analytics/ops events. Product can run without it but observability degrades. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_FLUSH_TIMEOUT_MS`, `SENTRY_TRACES_SAMPLE_RATE` | optional | Error reporting/tracing; release can run without full proof, but incidents are harder to diagnose. |
| `VITE_TURNSTILE_SITE_KEY` | active frontend public env | Public Cloudflare Turnstile site key used by `src/pages/legal/DeleteAccountWeb.tsx` for `/delete-account`. Safe for the browser; value still must not be pasted into docs. |
| `TURNSTILE_SECRET_KEY` | active server secret | Supabase Edge Function secret used only by `request-account-deletion` for Cloudflare Siteverify. Do not prefix with `VITE_`. |
| `ACCOUNT_DELETION_RATE_LIMIT_PEPPER` | active server secret | Supabase Edge Function secret used by `request-account-deletion` to hash IP/email rate-limit keys. Do not prefix with `VITE_`. |
| `BUNNY_ARCHIVE_STORAGE_ZONE`, `BUNNY_ARCHIVE_STORAGE_API_KEY`, `BUNNY_STORAGE_ARCHIVE_ZONE`, `BUNNY_STORAGE_ARCHIVE_API_KEY` | active/optional operator decision | Archive delete/recovery helpers use aliases. Confirm whether archive storage is enabled. |
| `BUNNY_CHAT_STREAM_COLLECTION_ID` | optional/future-only | Current source references chat stream integration; dashboard collection usage needs operator confirmation. |
| `DAILY_DROP_ALERT_EMAILS` | optional | Health/alert recipients only. |
| `SLACK_WEBHOOK_URL`, `VIDEO_DATE_RECOVERY_SLACK_WEBHOOK_URL` | optional | Recovery alert dispatcher can notify Slack if configured. |
| `SB_EXECUTION_ID`, `SB_REGION` | runtime-provided | Supabase runtime metadata, not operator secrets. |
| `ENVIRONMENT` | optional | Runtime labeling. |
| `CRON_SECRET_` | typo/local-only | Use `CRON_SECRET`. Do not create or document the trailing-underscore name. |

## Provider Manual Checklists

### Stripe

1. In Stripe dashboard, confirm monthly and annual price IDs are active and match the Supabase secret names by value without pasting values into docs.
2. Confirm webhook endpoint targets `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/stripe-webhook`.
3. Confirm webhook is enabled and subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
4. Confirm customer portal configuration is enabled if `create-portal-session` is release-gated.
5. Run only an approved non-paid or test-mode checkout smoke; do not create paid transactions in production without approval.

### Bunny

1. Confirm Stream library exists and matches the configured library ID.
2. Confirm Stream CDN hostname resolves and is the intended playback host.
3. Confirm Storage zone exists and maps to the intended CDN hostname, including `cdn.vibelymeet.com`.
4. Confirm Bunny video webhook destination targets `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-webhook`.
5. Confirm webhook token/signing model matches current source without exposing token values.
6. Run an approved test media smoke only with a controlled test account/session.

### OneSignal

1. Confirm web app ID matches frontend `VITE_ONESIGNAL_APP_ID` and backend `ONESIGNAL_APP_ID`.
2. Confirm Web Push is enabled for `vibelymeet.com`.
3. Confirm service worker paths remain `/OneSignalSDK.sw.js` and `/OneSignalSDKWorker.js`.
4. Confirm REST API key has send permissions and is active.
5. Confirm remote push send to an approved test user; local/browser notification permission alone is not remote push proof.
6. Confirm any `push-webhook` receipt source is actually wired, or leave it documented as generic/unproven.

### Twilio

1. Confirm account authenticates and is active.
2. Confirm Verify Service SID exists, is active, and is intended for production.
3. Confirm sender/locale/rate-limit settings.
4. Run OTP send/check only with explicit approval and a controlled test number.

### Resend

1. Confirm API key authenticates.
2. Confirm sending domain for `vibelymeet.com` is verified.
3. Confirm expected sender addresses such as no-reply/support addresses are valid.
4. Confirm active functions are `email-verification`, `event-notifications`, `send-email`, and `send-support-reply`.
5. Keep `email-drip` and `unsubscribe` retired unless product deliberately restores them with `CRON_SECRET` and `UNSUB_HMAC_SECRET`.

### RevenueCat

1. Confirm project/apps exist for iOS and Android.
2. Confirm iOS bundle ID and Android package are `com.vibelymeet.vibely`.
3. Confirm offerings/packages include the intended premium entitlement.
4. Confirm webhook destination targets `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/revenuecat-webhook`.
5. Confirm webhook auth header matches `REVENUECAT_WEBHOOK_AUTHORIZATION` without printing it.
6. Run purchase/restore smoke only in an approved sandbox build.

### PostHog

1. Confirm project exists and the intended host is EU (`https://eu.i.posthog.com`) unless product deliberately changed regions.
2. Confirm web/native/server keys are assigned to the same intended project or documented split projects.
3. Confirm consent/session-recording posture matches product policy.
4. Do not send synthetic analytics without approval.

### Sentry

1. Confirm web, native, and Edge DSNs route to intended organization/project(s).
2. Confirm environment naming and release association.
3. Confirm ingest accepts events from production domains/builds.
4. Do not send a test error without approval.

### Vercel

1. Confirm project ID `prj_wk9uN2rld5UmIviuRYUZ6JSG18TF` and team ID `team_Y3YrocJY5g87s6kerpvpMY9A` are the production project/team.
2. Confirm production domain is `vibelymeet.com` with canonical redirect to `www.vibelymeet.com`.
3. Confirm latest production deployment commit equals intended release HEAD.
4. Export/check environment variable names only; do not print values.
5. Confirm service worker cache headers remain compatible with OneSignal.

### Cloudflare

1. Confirm zone is active and authoritative for `vibelymeet.com`.
2. Confirm `vibelymeet.com`, `www.vibelymeet.com`, and `cdn.vibelymeet.com` records match Vercel/Bunny expectations.
3. Confirm proxy mode for each record is intentional.
4. Confirm SSL/TLS mode is strict enough for the Vercel/Bunny/Supabase origin paths.
5. Do not edit DNS during verification.

### Cloudflare Turnstile

1. Widget mode for the public account-deletion flow: Managed.
2. Add allowed hostnames `vibelymeet.com` and `www.vibelymeet.com`; add preview/staging/local hostnames only when those environments intentionally exercise `/delete-account` with this widget.
3. Keep pre-clearance / skip future challenges off; the current flow needs a one-time Turnstile token, not a Cloudflare clearance cookie.
4. Confirm `VITE_TURNSTILE_SITE_KEY` is set in the frontend environment and `TURNSTILE_SECRET_KEY` plus `ACCOUNT_DELETION_RATE_LIMIT_PEPPER` are set as Supabase Edge Function secrets. Check names only; do not print values.
5. Validate `/delete-account` renders the Turnstile widget and submits the callback token as `captchaToken` to `request-account-deletion`.
6. Validate missing or invalid `captchaToken` returns generic success and performs no account-deletion side effect.
7. Validate a valid token allows the request path only for an approved test email; do not use a real user without explicit approval.
8. Validate responses remain enumeration-safe: nonexistent emails, invalid emails, invalid captcha, rate-limit denial, duplicate request, and success all return generic success.

## Daily Real-Event Smoke Only

Do not recreate or update the Daily webhook.

1. Use two approved test users in a real video-date flow.
2. User A and User B join the Daily room through the app.
3. User A and User B leave/end through the app.
4. Confirm Daily webhook UUID `a5407924-6f29-4a35-835a-ff5185eeae5c` remains `ACTIVE`.
5. Confirm `lastMomentPushed` becomes non-null.
6. Confirm `failedCount` remains `0`.
7. Confirm Supabase Dashboard Edge Function logs for `video-date-daily-webhook` show accepted `participant.joined` and `participant.left`.
8. Confirm webhook ledger rows exist without secret-bearing payload fields.

## Non-Actions

This closure plan does not approve deploys, DB resets, destructive SQL, secret setting, secret rotation, provider webhook mutation, paid transactions, real SMS, real email, real push, media upload/delete smoke, commits, merges, or pushes.
