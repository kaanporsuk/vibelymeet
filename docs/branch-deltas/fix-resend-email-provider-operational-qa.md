# Stream 14 - Resend Email Provider Operational QA

Branch: `fix/resend-email-provider-operational-qa`

## Problem

Vibely depends on Resend-backed email for current-account OTP verification, admin event email notifications, generic transactional email sends, and support replies. Older provider docs also referenced `email-drip` and `unsubscribe`, so Stream 14 audited whether those paths are still production-active and whether production-domain links, secret posture, and safe logging are verifiable without sending real production email.

## Why This Follows Streams 1-13

Streams 1-13 closed backend contract, Ready Gate, swipe, realtime, payment, native video-date, OneSignal, Bunny, and Daily provider readiness. Resend is the next external provider that can silently fail through wrong secrets, unverified sender domains, stale production links, unsafe logs, or stale function inventory assumptions.

## Files Audited

- `supabase/functions/email-verification/index.ts`
- `supabase/functions/event-notifications/index.ts`
- `supabase/functions/send-email/index.ts`
- `supabase/functions/send-support-reply/index.ts`
- `src/hooks/useEmailVerification.ts`
- `src/components/verification/EmailVerificationFlow.tsx`
- `apps/mobile/components/verification/EmailVerificationFlow.tsx`
- `src/components/admin/AdminEventFormModal.tsx`
- email/profile/account surfaces that read `email_verified`, `verified_email`, or `email_unsubscribed`
- `supabase/config.toml`
- `docs/notification-system-design.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- historical references for `email-drip` and `unsubscribe`

## Read-Only Production Checks

- `supabase projects list`: linked project is `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`: `email-verification`, `event-notifications`, `send-email`, and `send-support-reply` are active. `email-drip` and `unsubscribe` are not active.
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd`: secret names `RESEND_API_KEY`, `EMAIL_VERIFICATION_OTP_SECRET`, `CRON_SECRET`, and `UNSUB_HMAC_SECRET` are present. Only names and digests were viewed; no secret values were printed.
- `curl -I -L https://www.vibelymeet.com/`: HTTP 200 from Vercel.
- `curl -I -L https://vibelymeet.com/`: HTTP 307 to `https://www.vibelymeet.com/`, then HTTP 200.
- `curl -I -L https://www.vibelymeet.com/events`: HTTP 200 from Vercel app shell.

No production email was sent.

## Function Deployment Posture

- `email-verification`: active in Supabase, configured with `verify_jwt = true`.
- `event-notifications`: active in Supabase, configured with `verify_jwt = true`.
- `send-email`: active in Supabase, configured with `verify_jwt = false` and internally authorized.
- `send-support-reply`: active in Supabase, configured with `verify_jwt = true`.
- `email-drip`: retired from current source/config and not active in the linked Supabase function list.
- `unsubscribe`: retired from current source/config and not active in the linked Supabase function list.

## Secret-Name Posture

Visible by name only:

- `RESEND_API_KEY`
- `EMAIL_VERIFICATION_OTP_SECRET`
- `CRON_SECRET`
- `UNSUB_HMAC_SECRET`

No new env vars were added. `CRON_SECRET` and `UNSUB_HMAC_SECRET` remain present for other provider/cron posture and historical email contracts, but there is no active `email-drip` or `unsubscribe` Edge Function in current source or production inventory.

## Email Verification Path

- Web and native invoke `email-verification/send` and `email-verification/verify`.
- The Edge Function requires a logged-in Supabase user.
- The requested email must match the canonical auth email resolved by shared verification semantics.
- OTPs are generated server-side, stored as Web Crypto HMAC-SHA256 values, expire after 10 minutes, and verify through timing-safe comparison.
- Failed verification attempts are counted through `verification_attempts`, capped at 7 attempts per hour.
- Raw OTP values are not logged.
- Resend sends from `Vibely <hello@vibelymeet.com>` unless `EMAIL_VERIFICATION_FROM_EMAIL` overrides it.

## Event Notification Path

- Admin event creation invokes `event-notifications`.
- The function requires an auth header, resolves the caller, checks `user_roles.role = admin`, and rate-limits notification requests.
- The function sends Resend emails from `Vibely <notifications@vibelymeet.com>`.
- Stream 14 hardened the recipient queries to honor `profiles.email_unsubscribed = false`.
- Stream 14 also removed recipient email and raw Resend response bodies from provider failure logs; logs now capture status and response length only.
- Production event links use `https://www.vibelymeet.com/events/{eventId}`.

## Drip Path

`email-drip` is not a current production-active function. It was removed from source/config in commit `177a2d651` as part of dead Edge Function cleanup, and it is not listed in current Supabase function inventory. Historical docs described a CRON_SECRET-gated drip worker with `email_drip_log`, `profile-complete`, and `first-event-nudge` behavior. Restoring it would require a deliberate product/ops decision, review of old semantics, a scheduler, Resend domain verification, and an unsubscribe link posture.

## Unsubscribe Path

`unsubscribe` is not a current production-active function. It was removed from source/config in commit `177a2d651` as part of dead Edge Function cleanup, and it is not listed in current Supabase function inventory. The `email_unsubscribed` column still exists and is now honored by active admin event notification sends. Restoring unsubscribe links would require deliberate reintroduction of a public HMAC-gated endpoint using `UNSUB_HMAC_SECRET`, plus template/link QA.

## Sender and Domain Posture

Active sender examples in source:

- `Vibely <hello@vibelymeet.com>`
- `Vibely <notifications@vibelymeet.com>`
- `Vibely Support <support@vibelymeet.com>`

Active production links use `https://www.vibelymeet.com` for verification assets, app CTAs, and event links. The apex domain redirects to `www`.

## Code Fixes Made

- `supabase/functions/event-notifications/index.ts`
  - added `.eq("email_unsubscribed", false)` to both event-created and capacity-alert recipient queries
  - replaced recipient/raw provider failure logging with sanitized status and body-length metadata

## Tests Added

- `shared/matching/resendEmailProviderOperationalQa.test.ts`

Coverage includes Resend env usage, OTP hashing and expiry/attempt checks, admin authorization for event emails, retired drip/unsubscribe posture, production-domain links, safe logging posture, no new env vars/migrations/native modules, no `expo-av`, and Streams 1-13 artifact presence.

## Manual Resend Dashboard Checklist

1. Confirm the API key behind `RESEND_API_KEY` can send from the production Resend account.
2. Confirm `vibelymeet.com` is verified in Resend with SPF/DKIM records passing.
3. Confirm sender aliases are allowed: `hello@vibelymeet.com`, `notifications@vibelymeet.com`, and `support@vibelymeet.com`.
4. Confirm production links in received test emails resolve to `https://www.vibelymeet.com`.
5. Confirm bounce, complaint, and suppression behavior in Resend dashboard.
6. Decide whether Resend webhooks should feed app observability later.
7. Confirm whether `email-drip` should remain retired or be deliberately restored with scheduler ownership.
8. If restoring drip, confirm `CRON_SECRET` scheduler auth, cadence, templates, and `email_drip_log` dedupe.
9. Confirm whether `unsubscribe` should remain retired or be deliberately restored.
10. If restoring unsubscribe, confirm `UNSUB_HMAC_SECRET` HMAC link generation, public endpoint deployment, rate limiting, and template footer coverage.
11. Run controlled internal email QA only with owned test addresses:
    - email OTP send and verify
    - admin event-created email
    - admin capacity-alert email
    - generic transactional send if still used
    - support reply email
12. Do not send real production test emails to users.

## Deploy Requirements

- Supabase migration requirement: none.
- Edge Function deploy requirement: `event-notifications` changed and must be deployed after merge only:
  - `supabase functions deploy event-notifications --project-ref schdyxcunwcvddlcshwd`
- No other email function changed.
- No DB deploy is required.

## Safety Confirmations

- No Docker used.
- No local Supabase used.
- No production email smoke was run.
- No env vars changed.
- No native modules added.
- No `expo-av` import or package added.
- No Ready Gate, swipe, payment, realtime, OneSignal, Bunny, Daily, RevenueCat, or Twilio changes were made.

## Remaining Deferred Work

- Controlled internal Resend email QA with owned test recipients.
- Manual Resend sender-domain and alias verification.
- Product/ops decision on whether `email-drip` and `unsubscribe` should remain retired or be intentionally restored.
- Resend bounce/complaint/suppression webhook observability if desired.
- Physical-device native email verification QA.
