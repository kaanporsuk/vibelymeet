# Security Delta: P0 Send Email Auth Bypass

Date: 2026-05-17
Branch: `security/p0-send-email-auth-bypass`

## Scope

Closes source-first audit item VIB-AUD-002 for `send-email`:

- `send-email` remains configured with `verify_jwt = false`.
- Service authority now requires an exact bearer token match to `SUPABASE_SERVICE_ROLE_KEY`.
- Unsigned decoded JWT payload roles are no longer trusted.
- Browser CORS now uses the shared trusted-origin helper instead of wildcard headers.
- Resend provider failures no longer log or return provider response bodies.

## Edge Function Delta

- `supabase/functions/send-email/index.ts` is now a thin runtime wrapper for env, Supabase Auth, CORS, and Resend wiring.
- `supabase/functions/send-email/handler.ts` owns request handling and authorization behind injected dependencies for local contract tests.
- Service-role bearer comparison is exact and timing-safe.
- Runtime request fields are type-checked before authorization/provider send paths use them.
- Normal authenticated callers must resolve through `supabase.auth.getUser()`, may only request the `welcome` template, must target their own canonical auth email, and cannot provide `subject` or `html`.
- The provider send for normal users uses the canonical auth email returned by Auth, not raw request `to`.
- Welcome template display-name input is control-character normalized and HTML-escaped before rendering.
- Service-role callers keep the existing operational custom email capability, but only with the exact service-role secret as the bearer token.

## Regression Coverage

New focused contract:

- `supabase/functions/send-email/sendEmailAuthBypass.test.ts`
- npm script: `npm run test:send-email-auth`

Coverage includes forged `service_role` JWT payload rejection, near-service-token rejection, unsigned-role payload rejection even for an authenticated user token, normal-user arbitrary email rejection, normal-user welcome-to-other-email rejection, normal-user welcome-with-custom-content rejection, malformed runtime payload rejection, welcome-to-self success, welcome template data sanitization, native-style no-Origin success, exact service-role success, trusted-origin CORS, sanitized Resend error logging, and a static guard against `jwtPayloadRole`/`atob` role trust.

## Verification

Passed local checks:

- `npm run test:send-email-auth`
- `npm run test:media-upload-sniffing`
- `npm run test:vibe-clip-upload-contract`
- `npx tsx shared/matching/resendEmailProviderOperationalQa.test.ts`
- `npx tsx shared/matching/paymentEmailPhoneTrustSystemsClosure.test.ts`
- `npx tsx shared/matching/finalReleaseOpsReadinessClosure.test.ts`
- `npx tsx shared/matching/finalHardeningReleaseRehearsal.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm audit --audit-level=high --prefix apps/mobile`
- `git diff --check`

Not run by design:

- Web build
- Native build
- Production email smoke

## Deploy Requirements

- Supabase migration requirement: none.
- Env vars added/changed: none.
- Edge Function deploy requirement: `send-email` changed and must be deployed after merge:
  - `supabase functions deploy send-email --project-ref schdyxcunwcvddlcshwd`
- No production email smoke was run.
- No live/cloud probing or secret changes were performed.
