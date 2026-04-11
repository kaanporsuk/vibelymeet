# Email verification settlement — 2026-04-11

**Status:** Code, config, and deploy path are **settled**; **Sign in with Apple + inbox OTP** remain **human QA** (not executable in CI/agent environments without real Apple sessions).

**Authoritative implementation:** `supabase/functions/email-verification/index.ts`, `supabase/functions/_shared/verificationSemantics.ts`.

---

## Backend semantics (evidence-based)

| Requirement | Implementation |
|-------------|----------------|
| Eligibility uses **canonical auth email** only | Send/verify compare `normalizeEmailAddress(requestedEmail)` to `resolveCanonicalAuthEmail(adminUser) ?? jwtEmail`. No `profiles.*` for eligibility. |
| **No** inbox-first / OAuth trust gate on this flow | No `email_confirmed_at` check blocks send/verify; Apple/Google users are gated only by canonical email resolution + match. |
| **bcrypt removed** from send/verify | No `deno.land/x/bcrypt` import; OTP storage uses **HMAC-SHA256** via **Web Crypto** (`crypto.subtle`), prefix `h1:`. |
| **Secret preference** | **Send:** `EMAIL_VERIFICATION_OTP_SECRET` ?? `SUPABASE_SERVICE_ROLE_KEY`. **Verify:** tries **both** distinct secrets (deduped) so rows issued under SRK-only remain valid after adding a dedicated pepper. |
| **Legacy bcrypt rows** | If stored code starts with `$2a$` / `$2b$` / `$2y$`, verify returns `code: "legacy_verification_code"` and user-facing copy to use **Send Code** again (no failed-attempt increment for that branch). |
| **Structured logs** | JSON lines with `source: "email-verification"` and stages (e.g. `send_entered`, `canonical_email_resolved`, `otp_hash_*`, `resend_*`, `verify_legacy_bcrypt_row`). |

**Deploy:** Confirm active revision in Supabase Dashboard → Edge Functions → `email-verification` (version changes on each deploy).

---

## Clients (web + native)

| Concern | Web | Native |
|---------|-----|--------|
| Invoke paths | `email-verification/send`, `email-verification/verify` | Same |
| Error parsing | `resolveSupabaseFunctionErrorMessage` (`src/lib/…` → shared impl) | `shared/supabaseFunctionInvokeErrors.ts` |
| Legacy branch | `isVerifyOtpFailure` + return to send step | `code === 'legacy_verification_code'` → `setStep('send')`, clear OTP |

---

## What this doc does **not** claim

- That production was exercised end-to-end with **Apple** sign-in in a browser or on device (record results in `docs/native-final-blocker-matrix.md` or a dated QA log when available).
- That a specific Edge Function **version number** is current forever (verify in dashboard after each deploy).

---

## Related

- Hardening context: [`repo-hardening-closure-2026-04-11.md`](./repo-hardening-closure-2026-04-11.md)
- Active doc index: [`active-doc-map.md`](./active-doc-map.md)
