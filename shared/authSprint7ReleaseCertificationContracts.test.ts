import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const cert = read("docs/auth/auth-release-certification-2026-05-27.md");
const closure = read("docs/auth/auth-investigation-closure-2026-05-27.md");
const checklist = read("docs/auth/provider-dashboard-checklist.md");
const runner = read("scripts/run_auth_hardening_tests.sh");

function walkTs(dir: string): string[] {
  const entries = readdirSync(join(root, dir));
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = join(dir, entry);
    const fullPath = join(root, relativePath);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "_shared") {
        files.push(...walkTs(relativePath));
        continue;
      }
      files.push(...walkTs(relativePath));
      continue;
    }
    if (entry.endsWith(".ts")) files.push(relativePath);
  }
  return files;
}

test("Sprint 7 certification records production auth rollout evidence without secrets", () => {
  assert.match(cert, /# Auth Release Certification/);
  assert.match(cert, /Production Supabase project `schdyxcunwcvddlcshwd`/);
  assert.match(cert, /https:\/\/github\.com\/kaanporsuk\/vibelymeet\/pull\/1096/);
  assert.match(cert, /9e1046281 Harden auth Sprint 6 data quality/);
  assert.match(cert, /20260527130000_auth_sprint6_data_quality_observability\.sql/);
  assert.match(cert, /Deployed Edge Functions: `email-verification`, `phone-verify`/);
  assert.match(cert, /Final live audit: `0 fail, 0 warn, 41 checks`/);

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
  assert.match(cert, /Summary: `0 fail, 0 warn, 41 checks`/);
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
  assert.match(closure, /Production Supabase project `schdyxcunwcvddlcshwd` passes the current live auth audit with `0 fail, 0 warn, 41 checks`/);
  assert.match(closure, /Certification record: `docs\/auth\/auth-release-certification-2026-05-27\.md`/);
  assert.doesNotMatch(closure, /local repo is ahead of production Supabase/);
  assert.doesNotMatch(closure, /must be applied before the next post-deploy live audit/);

  assert.match(checklist, /`audit:auth-live` should pass with `0 fail, 0 warn, 41 checks`/);
  assert.match(checklist, /public deletion lookup follow-up/);
  assert.match(checklist, /sanitize_profile_display_name/);
  assert.match(checklist, /verification_attempts\.flow/);
});

test("Sprint 7 contract is included in the auth hardening runner", () => {
  assert.match(runner, /npx tsx shared\/authSprint7ReleaseCertificationContracts\.test\.ts/);
});

test("native Sentry beforeSend strips sensitive auth and contact data", () => {
  const nativeLayout = read("apps/mobile/app/_layout.tsx");

  assert.match(nativeLayout, /SENSITIVE_SENTRY_KEY_PATTERN/);
  assert.match(nativeLayout, /sanitizeNativeSentryText/);
  assert.match(nativeLayout, /\[redacted-email\]/);
  assert.match(nativeLayout, /\[redacted-phone\]/);
  assert.match(nativeLayout, /Bearer\|Basic/);
  assert.match(nativeLayout, /sanitizeNativeSentryUrl/);
  assert.match(nativeLayout, /parsed\.origin === 'null'/);
  assert.match(nativeLayout, /`\$\{parsed\.protocol\}\$\{host\}\$\{parsed\.pathname\}`/);
  assert.match(nativeLayout, /\^\(url\|filename\|abs_path\|request_url\)\$/);
  assert.match(nativeLayout, /delete request\.headers/);
  assert.match(nativeLayout, /delete request\.cookies/);
  assert.match(nativeLayout, /delete request\.data/);
  assert.match(nativeLayout, /delete request\.query_string/);
  assert.match(nativeLayout, /exception\.values = exception\.values\.map/);
  assert.match(nativeLayout, /sanitizeNativeSentryPayload\(entry\) as Record<string, unknown>/);
  assert.doesNotMatch(nativeLayout, /\.\.\.entry,[\s\S]{0,120}value: sanitizeNativeSentryPayload\(entry\.value\)/);
  assert.match(nativeLayout, /sanitizeNativeSentryEvent/);
  assert.match(nativeLayout, /return sanitizeNativeSentryEvent/);
});

test("auth-critical Edge Functions pin Supabase JS and are Deno checked", () => {
  const denoCheck = read("scripts/deno_check_auth_edge_functions.sh");
  const checkedFunctions = [
    "supabase/functions/email-verification/index.ts",
    "supabase/functions/phone-verify/index.ts",
    "supabase/functions/delete-account/index.ts",
    "supabase/functions/request-account-deletion/index.ts",
    "supabase/functions/sync-revenuecat-subscriber/index.ts",
    "supabase/functions/revenuecat-webhook/index.ts",
    "supabase/functions/stripe-webhook/index.ts",
    "supabase/functions/push-webhook/index.ts",
    "supabase/functions/send-email/index.ts",
    "supabase/functions/create-credits-checkout/index.ts",
    "supabase/functions/get-chat-media-url/index.ts",
    "supabase/functions/video-date-daily-webhook/index.ts",
  ];

  for (const file of checkedFunctions) {
    assert.match(denoCheck, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const source = read(file);
    if (source.includes("@supabase/supabase-js")) {
      assert.match(source, /@supabase\/supabase-js@2\.88\.0/);
      assert.doesNotMatch(source, /@supabase\/supabase-js@2['"]/);
    }
  }
});

test("all Edge Supabase JS imports are version-pinned", () => {
  const edgeFiles = walkTs("supabase/functions");
  for (const file of edgeFiles) {
    const source = read(file);
    if (!source.includes("@supabase/supabase-js")) continue;
    assert.match(source, /@supabase\/supabase-js@2\.88\.0/, `${file} should pin Supabase JS`);
    assert.doesNotMatch(source, /@supabase\/supabase-js@2['"]/, `${file} has a floating Supabase JS import`);
  }
});
