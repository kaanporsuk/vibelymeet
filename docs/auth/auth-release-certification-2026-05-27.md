# Auth Release Certification

Date: 2026-05-27

Scope: Sprint 7 release certification for the consolidated Vibely auth hardening plan, covering Sprints 0-6 code, migrations, Edge Functions, docs, and contracts.

## Verdict

Automated and live-production certification is **passed**.

Production Supabase project `schdyxcunwcvddlcshwd` is aligned with the current `main` auth hardening state:

- GitHub PR: `https://github.com/kaanporsuk/vibelymeet/pull/1096`
- Merged commit on `main`: `9e1046281 Harden auth Sprint 6 data quality`
- Applied migration: `20260527130000_auth_sprint6_data_quality_observability.sql`
- Deployed Edge Functions: `email-verification`, `phone-verify`
- Final live audit: `0 fail, 0 warn, 40 checks`

## Automated Certification Commands

These commands are non-provider-mutating and do not send real SMS, send real email, create OAuth users, or print secrets:

```bash
npm run test:auth-redirect-contract
npx tsx shared/authErrorCopy.test.ts
npx tsx shared/matching/resendEmailProviderOperationalQa.test.ts
npx tsx shared/matching/twilioPhoneVerificationQa.test.ts
npx tsx shared/profile/profileDirectPrivacyContracts.test.ts
npx tsx shared/profile/profileWritePrivilegeContracts.test.ts
npx tsx shared/authRefreshPolicy.test.ts
npx tsx shared/accountDeletionReauthContracts.test.ts
npm run test:auth-hardening
npm run typecheck
```

Sprint 7 run status: **PASS** for the full targeted suite.

Additional non-build checks run during certification:

```bash
npm run lint
deno check --no-lock supabase/functions/email-verification/index.ts supabase/functions/phone-verify/index.ts
git diff --check
supabase db push --linked --dry-run
supabase migration list --linked
```

Status: **PASS**. Supabase dry-run reported the remote database is up to date after applying the Sprint 6 migration.

## Live Audit Certification

Command:

```bash
npm run audit:auth-live
```

Final result after production migration and Edge Function deploy:

- Auth provider settings: pass
- Function JWT config: pass
- `public.profiles` RLS and grants: pass
- blocked profile trust-field writes: pass
- sensitive profile trigger body and trigger presence: pass
- bootstrap display-name sanitizer: pass
- `sanitize_profile_display_name`: pass
- `verification_attempts.flow`, check constraint, index, and client grant revocation: pass
- verified-contact writer RPC bodies and grants: pass
- required Edge Function presence: pass
- required Edge secret names: pass, names only

Summary: `0 fail, 0 warn, 40 checks`.

## Manual Smoke Matrix

The following checks remain manual because running them automatically would mutate provider accounts or send real messages. Use dedicated staging/provider test accounts and owned phone/email addresses only.

| Flow | Required Manual Result |
|---|---|
| Phone sign-in send/verify/resend/rate-limit | Supabase Auth Twilio Verify sends and verifies correctly; resend and retry copy are user-safe. |
| Google web sign-in | Web PKCE callback completes and routes through backend entry state. |
| Google native sign-in | Native browser OAuth callback hydrates session and routes correctly. |
| Apple web sign-in | Provider redirect completes; provider-specific errors show correct copy. |
| Apple native iOS sign-in | Native ID-token + nonce flow signs in; Android does not show Apple. |
| Email sign-up/confirmation/resend | Confirmation and resend work through the expected Supabase Auth mailer configuration. |
| Password reset web/native | Recovery-ready gate works before password update. |
| Link/unlink Google, Apple, email, phone | Linking errors surface; pending email/phone methods are not labeled confirmed. |
| Protected route redirect/session-expired banner | Expired or invalid sessions route to auth with clear copy. |
| Account deletion reauth email/SMS | Reauth proof is required and short-lived. |
| Account deletion idempotent retry | Repeated requests do not duplicate external side effects. |

Manual smoke status: **not executed by automation**. This is intentional and consistent with the plan requirement that automated tests must not send real SMS/email or mutate live OAuth users.

## Rollout Record

Completed:

- Backward-compatible auth code merged to `main`.
- Sprint 6 database migration applied to production Supabase.
- `email-verification` deployed after the migration.
- `phone-verify` deployed after the migration.
- Production live audit passed after deploy.
- Required GitHub checks and Vercel preview checks passed before merge.

Still manual/dashboard-owned:

- Google Cloud OAuth settings.
- Apple Developer Services ID/P8/callback settings.
- Supabase redirect allow-list review.
- Supabase Auth SMTP through Resend.
- Supabase Auth Twilio Verify SID equality with Edge `TWILIO_VERIFY_SERVICE_SID`, or documented intentional split.
- Supabase Auth CAPTCHA/rate-limit dashboard state.
- Production CAPTCHA enablement only after staging web/native CAPTCHA smoke passes.

## Monitoring

After manual smoke and any CAPTCHA dashboard change, monitor:

- Auth OTP send/verify failures.
- Resend delivery/rejection rates.
- Twilio Verify send/check errors and rate limits.
- OAuth callback/linking errors.
- session refresh and `session_expired` redirects.
- profile-write denials on trust fields.
- account deletion reauth and Stripe cleanup failures.
