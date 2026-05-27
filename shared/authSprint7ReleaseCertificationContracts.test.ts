import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const cert = read("docs/auth/auth-release-certification-2026-05-27.md");
const closure = read("docs/auth/auth-investigation-closure-2026-05-27.md");
const checklist = read("docs/auth/provider-dashboard-checklist.md");
const runner = read("scripts/run_auth_hardening_tests.sh");

test("Sprint 7 certification records production auth rollout evidence without secrets", () => {
  assert.match(cert, /# Auth Release Certification/);
  assert.match(cert, /Production Supabase project `schdyxcunwcvddlcshwd`/);
  assert.match(cert, /https:\/\/github\.com\/kaanporsuk\/vibelymeet\/pull\/1096/);
  assert.match(cert, /9e1046281 Harden auth Sprint 6 data quality/);
  assert.match(cert, /20260527130000_auth_sprint6_data_quality_observability\.sql/);
  assert.match(cert, /Deployed Edge Functions: `email-verification`, `phone-verify`/);
  assert.match(cert, /Final live audit: `0 fail, 0 warn, 40 checks`/);

  assert.doesNotMatch(cert, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]/);
  assert.doesNotMatch(cert, /TWILIO_AUTH_TOKEN\s*[:=]/);
  assert.doesNotMatch(cert, /RESEND_API_KEY\s*[:=]/);
  assert.doesNotMatch(cert, /client_secret\s*[:=]/i);
  assert.doesNotMatch(cert, /-----BEGIN PRIVATE KEY-----/);
});

test("Sprint 7 certification includes the exact targeted automated checks", () => {
  for (const command of [
    "npm run test:auth-redirect-contract",
    "npx tsx shared/authErrorCopy.test.ts",
    "npx tsx shared/matching/resendEmailProviderOperationalQa.test.ts",
    "npx tsx shared/matching/twilioPhoneVerificationQa.test.ts",
    "npx tsx shared/profile/profileDirectPrivacyContracts.test.ts",
    "npx tsx shared/profile/profileWritePrivilegeContracts.test.ts",
    "npx tsx shared/authRefreshPolicy.test.ts",
    "npx tsx shared/accountDeletionReauthContracts.test.ts",
    "npm run test:auth-hardening",
    "npm run typecheck",
  ]) {
    assert.match(cert, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(cert, /Sprint 7 run status: \*\*PASS\*\*/);
  assert.match(cert, /npm run audit:auth-live/);
  assert.match(cert, /Summary: `0 fail, 0 warn, 40 checks`/);
});

test("Sprint 7 manual smoke stays explicit and non-automated", () => {
  for (const flow of [
    "Phone sign-in send/verify/resend/rate-limit",
    "Google web sign-in",
    "Google native sign-in",
    "Apple web sign-in",
    "Apple native iOS sign-in",
    "Email sign-up/confirmation/resend",
    "Password reset web/native",
    "Link/unlink Google, Apple, email, phone",
    "Protected route redirect/session-expired banner",
    "Account deletion reauth email/SMS",
    "Account deletion idempotent retry",
  ]) {
    assert.match(cert, new RegExp(flow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(cert, /Manual smoke status: \*\*not executed by automation\*\*/);
  assert.match(cert, /automated tests must not send real SMS\/email or mutate live OAuth users/);
});

test("Sprint 7 closure and checklist point to current live alignment", () => {
  assert.match(closure, /Sprint 1-7 auth hardening code, migrations, docs, contracts, and release certification/);
  assert.match(closure, /Production Supabase project `schdyxcunwcvddlcshwd` passes the post-Sprint-6 live auth audit with `0 fail, 0 warn, 40 checks`/);
  assert.match(closure, /Certification record: `docs\/auth\/auth-release-certification-2026-05-27\.md`/);
  assert.doesNotMatch(closure, /local repo is ahead of production Supabase/);
  assert.doesNotMatch(closure, /must be applied before the next post-deploy live audit/);

  assert.match(checklist, /`audit:auth-live` should pass with `0 fail, 0 warn, 40 checks`/);
  assert.match(checklist, /sanitize_profile_display_name/);
  assert.match(checklist, /verification_attempts\.flow/);
});

test("Sprint 7 contract is included in the auth hardening runner", () => {
  assert.match(runner, /npx tsx shared\/authSprint7ReleaseCertificationContracts\.test\.ts/);
});
